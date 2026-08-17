const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// arkcli 命令行桥接层：统一 spawn、JSON 解析、错误归一化。
// 所有对 arkcli 的调用都必须经过这里，模块不允许自己起进程。
// 注意：arkcli 的 JSON 输出标志是 --format json（默认即 json），
// 业务错误时把 {"ok":false,"error":{...}} 写到 stderr 并以非零码退出。
class ArkcliBridge {
  constructor(bin = 'arkcli') {
    this.bin = bin;
    this._entry = undefined; // undefined=未探测, null=回退 shell 模式
  }

  // 解析 arkcli 的真实入口脚本（npm 全局包），成功后用 node 直调，
  // 避免 shell 拼接导致带空格/特殊字符的路径和提示词被截断。
  _resolveEntry() {
    if (this._entry !== undefined) return this._entry;
    try {
      const root = execSync('npm root -g', { encoding: 'utf8', windowsHide: true }).trim();
      const entry = path.join(root, 'node_modules', '@volcengine', 'ark-cli', 'scripts', 'run.js');
      this._entry = fs.existsSync(entry) ? entry : null;
    } catch {
      this._entry = null;
    }
    return this._entry;
  }

  exec(args, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve, reject) => {
      const entry = this._resolveEntry();
      const child = entry
        ? spawn('node', [entry, ...args], { windowsHide: true, env: process.env })
        : spawn(this.bin, args.map(quoteForShell), { shell: true, windowsHide: true, env: process.env });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`arkcli 超时: ${args.join(' ')}`));
      }, timeoutMs);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`无法执行 arkcli: ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  // 优先解析 JSON；解析失败时回退为原始文本，保证框架期健壮
  async execJson(args, opts) {
    const { code, stdout, stderr } = await this.exec(args, opts);
    const data = parseJsonBlock(stdout) || parseJsonBlock(stderr) || { raw: stdout };
    if (code !== 0) {
      const msg = (data.error && data.error.message) || stderr || `arkcli 退出码 ${code}`;
      const err = new Error(msg);
      err.data = data;
      err.code = code;
      throw err;
    }
    return data;
  }

  // 静默追加 --format json，除非调用方已显式指定 format
  jsonArgs(args) {
    return args.includes('--format') ? args : [...args, '--format', 'json'];
  }

  async version() {
    try {
      const { code, stdout } = await this.exec(['--version'], { timeoutMs: 10000 });
      if (code !== 0) return null;
      const m = stdout.match(/(\d+\.\d+\.\d+)/);
      return m ? m[1] : stdout;
    } catch {
      return null;
    }
  }

  async authStatus() {
    try {
      const data = await this.execJson(this.jsonArgs(['auth', 'status']), { timeoutMs: 15000 });
      return normalizeAuth(data);
    } catch (err) {
      // auth status 在未登录 / token 失效时以非零码退出，错误体仍是结构化 JSON
      const data = err.data || {};
      return { loggedIn: false, ...normalizeAuth(data), error: err.message };
    }
  }

  // 唤起 SSO 登录：非阻塞 spawn，浏览器授权流程由用户完成，
  // UI 侧轮询 authStatus 观察状态变化
  login() {
    const child = spawn(this.bin, ['auth', 'login', 'volc-sso'], {
      shell: true,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    child.unref();
    return { started: true, pid: child.pid };
  }

  async listProfiles() {
    const data = await this.execJson(this.jsonArgs(['profile', 'list']));
    return {
      current: data.default_profile || null,
      profiles: (data.profiles || []).map((p) => ({
        name: p.name,
        displayName: p.display_name || p.name,
        type: p.type,
        isDefault: !!p.is_default,
      })),
    };
  }

  async switchProfile(name) {
    return this.execJson(this.jsonArgs(['profile', 'use', name]));
  }

  // 接入点清单：EP id -> 名称 / 绑定模型，用于模型下拉的友好显示
  async listEndpoints() {
    const data = await this.execJson(this.jsonArgs(['infer', 'endpoint', 'list', '--page-size', '100']));
    return (data.Items || []).map((it) => ({
      id: it.Id,
      name: it.Name || it.Id,
      model: (it.ModelReference && it.ModelReference.FoundationModel
        && it.ModelReference.FoundationModel.Name) || null,
      status: it.Status,
    }));
  }

  // Step 1: 列出当前 profile 可用模型 / 接入点
  async listResources(modality) {
    return this.execJson(this.jsonArgs(['resources', 'list', '--modality', modality]));
  }

  // Step 2: 查模型 supported_params
  async getSupportedParams(model) {
    return this.execJson(this.jsonArgs(['models', 'get', model, '--transform', 'supported_params']));
  }

  // Step 3: 生成（图片同步返回；视频异步返回 task_id）
  async gen({ model, prompt, inputs = [], params = {}, saveTo, modality }) {
    const args = this.jsonArgs(['+gen', '--model', model, '--no-open']);
    // EP（ep-xxx）无法从 id 推断模态，必须显式指定
    if (modality) args.push('--modality', modality);
    for (const f of inputs) {
      // 支持 { role, path }：seedance 2.0 要求图片输入显式带角色（first:/last:/ref:）
      if (f && typeof f === 'object') args.push('--input', `${f.role}:@${f.path}`);
      else args.push('--input', `@${f}`);
    }
    if (saveTo) args.push('--save-to', saveTo);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      args.push(`--${k}`, String(v));
    }
    args.push(prompt);
    return this.execJson(args, { timeoutMs: 600000 });
  }

  // Step 4: 轮询异步任务，succeeded 时 arkcli 会自动下载产物并回传 local_path
  async genGet(taskId, saveTo) {
    const args = this.jsonArgs(['gen', 'get', taskId, '--no-open']);
    if (saveTo) args.push('--save-to', saveTo);
    return this.execJson(args, { timeoutMs: 600000 });
  }

  async genList() {
    return this.execJson(this.jsonArgs(['gen', 'list']));
  }

  // 提示词助手等开放式对话
  async chat(prompt, { model, system } = {}) {
    const args = this.jsonArgs(['+chat']);
    if (model) args.push('--model', model);
    if (system) args.push('--system', system);
    args.push(prompt);
    return this.execJson(args, { timeoutMs: 300000 });
  }
}

// 回退模式（shell:true）下给含空格/特殊字符的参数加引号
function quoteForShell(arg) {
  const s = String(arg);
  return /[\s&|<>^%"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 从 CLI 输出中提取第一个完整 JSON 对象/数组（stdout / stderr 都可能携带）
function parseJsonBlock(text) {
  if (!text) return null;
  let start = -1;
  let openCh = '';
  let closeCh = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') {
      start = i;
      openCh = text[i];
      closeCh = text[i] === '{' ? '}' : ']';
      break;
    }
  }
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    if (text[i] === closeCh) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeAuth(data) {
  if (!data || typeof data !== 'object') return { loggedIn: false };
  if (data.logged_in === true || data.ok === true) {
    const profile = data.active_profile || null;
    const identity = (data.volc_sso && data.volc_sso.identity) || null;
    const cpa = data.control_plane_auth || null;
    return {
      loggedIn: true,
      profile: profile ? profile.name : null,
      profileType: profile ? profile.type : null,
      account: identity ? identity.name : null,
      ssoRemaining: data.volc_sso ? data.volc_sso.remaining : null,
      // SSO 续期失败时 logged_in 仍为 true（本地 key 兜底），但控制面已不可用
      needsLogin: !!(cpa && cpa.status === 'needs_login'),
      controlPlaneReason: cpa ? cpa.reason : null,
    };
  }
  return { loggedIn: false };
}

module.exports = { ArkcliBridge };
