// 环境一键安装：检测/安装 Node.js 与 arkcli。
// 面向干净机器（无 Node、无 arkcli）的 Windows 10 1903+ 环境。
// 进度通过 EventEmitter 上报：{ step, status, detail, percent? }
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const NODE_INDEX_URL = 'https://npmmirror.com/mirrors/node/index.json';
const NODE_MSI_TMPL = (v) => `https://npmmirror.com/mirrors/node/v${v}/node-v${v}-x64.msi`;
const ARKCLI_PKG = '@volcengine/ark-cli@^1.0';

class EnvInstaller extends EventEmitter {
  constructor({ dataDir, arkcli } = {}) {
    super();
    this.downloadDir = path.join(dataDir || require('os').tmpdir(), 'downloads');
    this.arkcli = arkcli || null;
  }

  _report(step, status, detail, percent) {
    this.emit('progress', { step, status, detail, percent, at: Date.now() });
  }

  _exec(cmd, args, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, env: process.env },
        (err, stdout) => resolve(err ? null : String(stdout).trim()));
    });
  }

  async checkNode() {
    const out = await this._exec('node', ['--version']);
    return out ? { installed: true, version: out.replace(/^v/, '') } : { installed: false };
  }

  async checkArkcli() {
    // 复用 bridge 的入口解析（.ps1 垫片无法直接 execFile）
    if (this.arkcli) {
      const v = await this.arkcli.version();
      return v ? { installed: true, version: v } : { installed: false };
    }
    const out = await this._exec('arkcli', ['--version']);
    const m = out && out.match(/(\d+\.\d+\.\d+)/);
    return m ? { installed: true, version: m[1] } : { installed: false };
  }

  async check() {
    const [node, arkcli] = await Promise.all([this.checkNode(), this.checkArkcli()]);
    return { node, arkcli };
  }

  _fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
  }

  _download(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const follow = (u) => {
        https.get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return follow(res.headers.location);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
          }
          const total = Number(res.headers['content-length']) || 0;
          let got = 0;
          const file = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            got += chunk.length;
            if (total) onProgress(Math.round((got / total) * 100));
          });
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error', reject);
        }).on('error', reject);
      };
      follow(url);
    });
  }

  // 装完 Node 后当前进程的 PATH 还是旧的，手动补上标准安装位置
  _refreshPath() {
    const nodeDir = 'C:\\Program Files\\nodejs';
    if (fs.existsSync(nodeDir) && !process.env.PATH.includes(nodeDir)) {
      process.env.PATH = `${nodeDir};${process.env.PATH}`;
    }
    const npmGlobal = path.join(process.env.APPDATA || '', 'npm');
    if (fs.existsSync(npmGlobal) && !process.env.PATH.includes(npmGlobal)) {
      process.env.PATH = `${npmGlobal};${process.env.PATH}`;
    }
  }

  async installNode() {
    this._report('node', 'working', '查询最新 LTS 版本...');
    const index = await this._fetchJson(NODE_INDEX_URL);
    const lts = index.find((r) => r.lts);
    if (!lts) throw new Error('未找到 Node.js LTS 版本');
    const version = lts.version.replace(/^v/, '');

    const msi = path.join(this.downloadDir, `node-v${version}-x64.msi`);
    this._report('node', 'working', `下载 Node.js v${version}...`, 0);
    await this._download(NODE_MSI_TMPL(version), msi,
      (p) => this._report('node', 'working', `下载 Node.js v${version}...`, p));

    this._report('node', 'working', '安装中（可能弹出权限确认）...');
    await new Promise((resolve, reject) => {
      const child = spawn('msiexec', ['/i', msi, '/passive', '/norestart'], {
        windowsHide: false,
        env: process.env,
      });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`msiexec 退出码 ${code}`))));
    });

    this._refreshPath();
    const check = await this.checkNode();
    if (!check.installed) throw new Error('安装后仍未检测到 node，请重启应用');
    this._report('node', 'done', `Node.js v${check.version} 就绪`);
    return check;
  }

  async installArkcli() {
    this._refreshPath();
    this._report('arkcli', 'working', 'npm 安装 @volcengine/ark-cli...');
    const npmCmd = 'C:\\Program Files\\nodejs\\npm.cmd';
    const npmBin = fs.existsSync(npmCmd) ? npmCmd : 'npm';
    await new Promise((resolve, reject) => {
      const child = spawn(npmBin, ['install', '-g', ARKCLI_PKG, `--allow-scripts=${ARKCLI_PKG}`], {
        shell: true,
        windowsHide: true,
        env: process.env,
      });
      let errOut = '';
      child.stderr.on('data', (d) => { errOut += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errOut || `npm 退出码 ${code}`))));
    });

    // npm 可能拦了 postinstall（平台二进制没下载），补跑一次
    this._report('arkcli', 'working', '下载平台二进制...');
    const root = await this._exec('npm', ['root', '-g']);
    if (root) {
      const postinstall = path.join(root, 'node_modules', '@volcengine', 'ark-cli', 'scripts', 'postinstall.js');
      const binExe = path.join(root, 'node_modules', '@volcengine', 'ark-cli', 'bin', 'arkcli-windows-amd64.exe');
      if (fs.existsSync(postinstall) && !fs.existsSync(binExe)) {
        await new Promise((resolve) => {
          spawn('node', [postinstall], { windowsHide: true, env: process.env })
            .on('close', () => resolve());
        });
      }
    }

    this._refreshPath();
    // bridge 的入口缓存可能还是“未安装”状态，强制重探测
    if (this.arkcli) this.arkcli._entry = undefined;
    const check = await this.checkArkcli();
    if (!check.installed) throw new Error('arkcli 安装后仍未检测到，请重启应用');
    this._report('arkcli', 'done', `arkcli v${check.version} 就绪`);
    return check;
  }

  // 一键全流程：按需装 Node -> 装 arkcli
  async ensureAll() {
    let state = await this.check();
    if (!state.node.installed) {
      await this.installNode();
    } else {
      this._report('node', 'done', `Node.js v${state.node.version} 已安装`);
    }
    state = await this.check();
    if (!state.arkcli.installed) {
      await this.installArkcli();
    } else {
      this._report('arkcli', 'done', `arkcli v${state.arkcli.version} 已安装`);
    }
    return this.check();
  }
}

module.exports = { EnvInstaller };
