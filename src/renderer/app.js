// 应用外壳：视图切换、设置页、Onboarding 向导、任务/素材视图。
// 画布编辑器逻辑在 canvas.js。
const api = window.arkStudio;

const views = ['pipeline', 'modules', 'tasks', 'assets', 'settings'];

function switchView(name) {
  for (const v of views) {
    document.getElementById(`view-${v}`).classList.toggle('active', v === name);
  }
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'modules') loadModules();
  if (name === 'tasks') loadTasks();
  if (name === 'assets') loadAssets();
  if (name === 'settings') loadSettings();
}

document.querySelectorAll('.nav-item').forEach((b) => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});

// ---------- arkcli 状态 ----------
async function refreshArkcliStatus() {
  const footer = document.getElementById('arkcli-status');
  const s = await api.arkcliStatus();
  if (!s.installed) {
    footer.className = 'arkcli-status err';
    footer.innerHTML = '<span class="status-dot"></span><span>Ark CLI 未安装</span>';
    footer.removeAttribute('data-tip');
  } else if (!s.auth.loggedIn) {
    footer.className = 'arkcli-status err';
    footer.innerHTML = '<span class="status-dot"></span><span>Ark CLI 未登录</span>';
    footer.removeAttribute('data-tip');
  } else {
    footer.className = 'arkcli-status ok';
    footer.innerHTML = '<span class="status-dot"></span><span>Ark CLI 已登录</span>';
    const bits = [s.auth.account, s.auth.profile, s.auth.ssoRemaining ? `SSO 剩余 ${s.auth.ssoRemaining}` : null].filter(Boolean);
    footer.setAttribute('data-tip', bits.join(' · ') || '已登录');
  }
  return s;
}

// 无边框窗口控制
document.getElementById('win-min').addEventListener('click', () => api.winMinimize());
document.getElementById('win-max').addEventListener('click', () => api.winToggleMaximize());
document.getElementById('win-close').addEventListener('click', () => api.winClose());

// ---------- 设置页 ----------
async function loadSettings() {
  const [settings, arkcli] = await Promise.all([api.getSettings(), api.arkcliStatus()]);

  // API Key 分区
  const keyState = document.getElementById('apikey-state');
  keyState.textContent = settings.apiKeyConfigured
    ? `已配置 ${settings.apiKeyMasked}${settings.keyEncrypted ? '（已加密存储）' : ''}`
    : '未配置（提示词助手将不可用）';
  keyState.style.color = settings.apiKeyConfigured ? 'var(--green)' : 'var(--amber)';

  // 已保存的 Key 以掩码形式留在输入框中；聚焦全选，输入即视为新 Key
  const keyInput = document.getElementById('apikey-input');
  keyInput.value = settings.apiKeyMasked || '';
  keyInput.dataset.masked = settings.apiKeyConfigured ? '1' : '';

  document.getElementById('baseurl-input').value = settings.baseUrl || settings.defaultBaseUrl || '';

  await refreshTextModels(settings.defaultTextModel);

  // arkcli 分区
  renderArkcliCard(arkcli);

  // 关于分区
  const info = await api.appInfo();
  document.getElementById('about-body').innerHTML = [
    `Sanmao Video Studio <b>v${info.appVersion}</b>`,
    `arkcli ${info.arkcli.installed ? `v${info.arkcli.version}` : '未安装'} · ${info.arkcli.loggedIn ? '已登录' : '未登录'}`,
    `Electron ${info.electron} · Chromium ${info.chromium} · Node ${info.node}`,
    `${info.platform}`,
  ].join('<br>');

  // 计费通道（profile）选择
  const profileSel = document.getElementById('profile-select');
  const profileHint = document.getElementById('profile-hint');
  try {
    const data = await api.listProfiles();
    profileSel.innerHTML = '';
    for (const p of data.profiles) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = `${p.displayName}（${p.type}）`;
      profileSel.appendChild(o);
    }
    profileSel.value = data.current;
    profileHint.textContent = data.current
      ? `当前: ${data.current}。切换后画布中的模型下拉会按新通道刷新`
      : '';
  } catch {
    profileSel.innerHTML = '<option value="">（arkcli 未就绪）</option>';
    profileHint.textContent = '';
  }
}

document.getElementById('profile-select').addEventListener('change', async (e) => {
  const hint = document.getElementById('profile-hint');
  if (!e.target.value) return;
  try {
    await api.switchProfile(e.target.value);
    hint.textContent = `已切换到 ${e.target.value}`;
    hint.style.color = 'var(--green)';
    window.dispatchEvent(new CustomEvent('profile-changed'));
    refreshArkcliStatus();
  } catch (err) {
    hint.textContent = `切换失败: ${err.message}`;
    hint.style.color = 'var(--red)';
  }
});

async function refreshTextModels(current) {
  const modelSel = document.getElementById('text-model-select');
  const fetchResult = document.getElementById('models-fetch-result');
  modelSel.innerHTML = '';
  if (current) {
    const o = document.createElement('option');
    o.value = current; o.textContent = current;
    modelSel.appendChild(o);
  }
  let models = [];
  let fetchError = null;
  try {
    models = await api.listTextModels();
  } catch (err) {
    fetchError = err.message;
  }
  for (const id of models) {
    if (id === current) continue;
    const o = document.createElement('option');
    o.value = id; o.textContent = id;
    modelSel.appendChild(o);
  }
  if (!modelSel.options.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '（先保存并测试连接，再点刷新拉取模型）';
    modelSel.appendChild(o);
  }
  if (fetchResult) {
    if (fetchError && /API Key/.test(fetchError)) {
      fetchResult.textContent = '未配置 Key，保存后自动拉取';
      fetchResult.style.color = 'var(--amber)';
    } else if (fetchError) {
      fetchResult.textContent = `模型列表拉取失败: ${fetchError}`;
      fetchResult.style.color = 'var(--red)';
    } else if (models.length) {
      fetchResult.textContent = `已拉取 ${models.length} 个模型`;
      fetchResult.style.color = 'var(--green)';
    } else {
      fetchResult.textContent = '';
    }
  }
  return models;
}

document.getElementById('models-refresh').addEventListener('click', async () => {
  await refreshTextModels(document.getElementById('text-model-select').value);
});

function renderArkcliCard(s) {
  const stateEl = document.getElementById('arkcli-state');
  const loginBtn = document.getElementById('arkcli-login-btn');
  const guideBtn = document.getElementById('arkcli-guide-btn');
  if (!s.installed) {
    stateEl.innerHTML = '<span style="color:var(--red)">未安装 arkcli</span>';
    loginBtn.classList.add('hidden');
    guideBtn.classList.remove('hidden');
  } else if (!s.auth.loggedIn) {
    stateEl.innerHTML = `<span style="color:var(--amber)">已安装 v${s.version} · 未登录</span>`;
    loginBtn.classList.remove('hidden');
    guideBtn.classList.add('hidden');
  } else {
    const bits = [`已安装 v${s.version}`, s.auth.account, s.auth.profile, s.auth.ssoRemaining ? `SSO 剩余 ${s.auth.ssoRemaining}` : null].filter(Boolean);
    stateEl.innerHTML = `<span style="color:var(--green)">${bits.join(' · ')}</span>`;
    loginBtn.classList.add('hidden');
    guideBtn.classList.add('hidden');
  }
}

document.getElementById('apikey-toggle').addEventListener('click', () => {
  const inp = document.getElementById('apikey-input');
  const btn = document.getElementById('apikey-toggle');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '显示' : '隐藏';
});

document.getElementById('apikey-input').addEventListener('focus', (e) => {
  if (e.target.dataset.masked === '1') e.target.select();
});
document.getElementById('apikey-input').addEventListener('input', (e) => {
  e.target.dataset.masked = '';
});

// 保存 = Base URL + API Key 一起落盘，然后自动拉取该端点的模型列表
document.getElementById('apikey-save').addEventListener('click', async () => {
  const inp = document.getElementById('apikey-input');
  const result = document.getElementById('apikey-test-result');
  try {
    await api.setBaseUrl(document.getElementById('baseurl-input').value);
    const key = inp.dataset.masked === '1' ? '' : inp.value.trim();
    if (key) {
      const r = await api.saveApiKey(key);
      result.textContent = `已保存 ${r.apiKeyMasked}，正在拉取模型列表...`;
    } else {
      result.textContent = 'Base URL 已保存（未填写新 Key，保留原有 Key）';
    }
    result.style.color = 'var(--green)';
    await loadSettings();
  } catch (err) {
    result.textContent = err.message;
    result.style.color = 'var(--red)';
  }
});

document.getElementById('apikey-test').addEventListener('click', async () => {
  const result = document.getElementById('apikey-test-result');
  result.textContent = '测试中...';
  result.style.color = 'var(--text-dim)';
  try {
    // 先落盘当前输入，避免测的是旧配置；掩码未动则保留原 Key
    const keyInput = document.getElementById('apikey-input');
    await api.setBaseUrl(document.getElementById('baseurl-input').value);
    if (keyInput.dataset.masked !== '1' && keyInput.value.trim()) {
      await api.saveApiKey(keyInput.value.trim());
    }
    const probeModel = document.getElementById('text-model-select').value || undefined;
    const r = await api.testApiKey(probeModel);
    result.textContent = `连接成功 · ${r.baseUrl} · 探活模型 ${r.model} · ${r.latencyMs}ms`;
    result.style.color = 'var(--green)';
    loadSettings();
  } catch (err) {
    result.textContent = `连接失败: ${err.message}`;
    result.style.color = 'var(--red)';
  }
});

document.getElementById('apikey-clear').addEventListener('click', async () => {
  await api.clearApiKey();
  loadSettings();
});

document.getElementById('text-model-select').addEventListener('change', async (e) => {
  if (e.target.value) await api.setDefaultModel(e.target.value);
});

document.getElementById('arkcli-recheck').addEventListener('click', async () => {
  const s = await refreshArkcliStatus();
  renderArkcliCard(s);
});

document.getElementById('arkcli-guide-btn').addEventListener('click', async () => {
  const btn = document.getElementById('arkcli-guide-btn');
  const log = document.getElementById('install-log');
  btn.disabled = true;
  log.classList.remove('hidden');
  log.innerHTML = '';
  const off = api.onSetupProgress((p) => {
    const line = document.createElement('div');
    line.textContent = (p.status === 'done' ? '✓ ' : '… ') + p.detail
      + (p.percent !== undefined && p.percent !== null ? ` ${p.percent}%` : '');
    if (p.status === 'done') line.style.color = 'var(--green)';
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  });
  try {
    await api.setupInstallAll();
    const s = await refreshArkcliStatus();
    renderArkcliCard(s);
  } catch (err) {
    const line = document.createElement('div');
    line.style.color = 'var(--red)';
    line.textContent = `安装失败: ${err.message}`;
    log.appendChild(line);
    document.getElementById('arkcli-guide').classList.remove('hidden');
  } finally {
    off();
    btn.disabled = false;
  }
});

document.getElementById('check-update').addEventListener('click', async () => {
  const result = document.getElementById('about-result');
  const btn = document.getElementById('check-update');
  btn.disabled = true;
  result.textContent = '正在检查更新...';
  result.style.color = 'var(--text-dim)';
  try {
    const r = await api.checkUpdate();
    if (r.status === 'latest') {
      result.textContent = `已是最新版本（v${r.current}）`;
      result.style.color = 'var(--green)';
      return;
    }
    const notes = r.notes ? `\n更新内容：${r.notes}` : '';
    const ok = await showConfirm(`发现新版本 v${r.latest}（当前 v${r.current}）。${notes}\n现在下载并安装？`);
    if (!ok) { result.textContent = '已取消更新'; return; }
    const off = api.onUpdateProgress((p) => {
      result.textContent = `下载更新包 v${r.latest}... ${p.percent}%`;
    });
    try {
      const dl = await api.downloadUpdate({ msiUrl: r.msiUrl, version: r.latest });
      result.textContent = '下载完成，即将启动安装（系统可能请求管理员权限）...';
      await api.installUpdate({ path: dl.path });
    } finally {
      off();
    }
  } catch (err) {
    result.textContent = err.message;
    result.style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('copy-diagnostics').addEventListener('click', async () => {
  const result = document.getElementById('about-result');
  const info = await api.appInfo();
  const text = [
    `Sanmao Video Studio v${info.appVersion}`,
    `arkcli: ${info.arkcli.installed ? `v${info.arkcli.version}` : 'not installed'} (${info.arkcli.loggedIn ? 'logged in' : 'not logged in'})`,
    `Electron ${info.electron} / Chromium ${info.chromium} / Node ${info.node}`,
    `OS: ${info.platform}`,
    `time: ${new Date().toISOString()}`,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  result.textContent = '诊断信息已复制到剪贴板';
  result.style.color = 'var(--green)';
});

document.getElementById('copy-install-cmd').addEventListener('click', () => {
  navigator.clipboard.writeText('npm install -g @volcengine/ark-cli');
});

document.getElementById('arkcli-login-btn').addEventListener('click', async () => {
  await api.arkcliLogin();
  document.getElementById('login-waiting').classList.remove('hidden');
  pollLogin();
});

document.getElementById('login-done').addEventListener('click', async () => {
  document.getElementById('login-waiting').classList.add('hidden');
  const s = await refreshArkcliStatus();
  renderArkcliCard(s);
});

let loginPollTimer = null;
async function pollLogin() {
  clearTimeout(loginPollTimer);
  const s = await api.arkcliStatus();
  if (s.installed && s.auth.loggedIn) {
    document.getElementById('login-waiting').classList.add('hidden');
    renderArkcliCard(s);
    refreshArkcliStatus();
    return;
  }
  loginPollTimer = setTimeout(pollLogin, 4000);
}

// ---------- 模块库 / 任务 / 素材 ----------
async function loadModules() {
  const grid = document.getElementById('module-grid');
  const modules = await api.listModules();
  grid.innerHTML = '';
  for (const m of modules) {
    const card = document.createElement('div');
    card.className = 'module-card';
    const inputs = (m.inputs || []).map((i) => i.label || i.name).join('、') || '无';
    const outputs = (m.outputs || []).map((o) => o.label || o.name).join('、') || '无';
    card.innerHTML = `
      <div class="category">${m.category}</div>
      <h3>${m.name} <small style="color:var(--text-dim)">v${m.version}</small></h3>
      <p>${m.description}</p>
      <div class="io"><span>输入: ${inputs}</span><span>输出: ${outputs}</span></div>
    `;
    grid.appendChild(card);
  }
}

async function loadTasks() {
  const list = document.getElementById('task-list');
  renderTasks(list, await api.listTasks());
}

function renderTasks(list, tasks) {
  if (!tasks.length) { list.innerHTML = '<div class="empty-hint">暂无任务</div>'; return; }
  list.innerHTML = tasks.map((t) => `
    <div class="task-row">
      <span class="status-pill ${t.status}">${t.status}</span>
      <span class="label">${t.label}</span>
      <span style="color:var(--text-dim)">${new Date(t.createdAt).toLocaleTimeString()}</span>
    </div>
  `).join('');
}

function updateBadge(tasks) {
  const active = tasks.filter((t) => t.status === 'running' || t.status === 'pending').length;
  const badge = document.getElementById('task-badge');
  badge.classList.toggle('hidden', active === 0);
  badge.textContent = active;
}

async function loadAssets() {
  const assets = await api.listAssets();
  renderAssetColumn('asset-col-image', assets.filter((a) => a.type === 'image'), '暂无生成图片');
  renderAssetColumn('asset-col-video', assets.filter((a) => a.type === 'video'), '暂无生成视频');
}

function renderAssetColumn(elId, items, emptyText) {
  const col = document.getElementById(elId);
  col.innerHTML = '';
  if (!items.length) {
    col.innerHTML = `<div class="empty-hint">${emptyText}</div>`;
    return;
  }
  // 列内按生成时间倒序，组内按工作流分组
  const groups = new Map();
  for (const a of items) {
    const key = a.workflow || '未关联工作流';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  for (const [wf, group] of groups) {
    const gh = document.createElement('div');
    gh.className = 'asset-group-title';
    gh.textContent = wf;
    col.appendChild(gh);
    for (const a of group) col.appendChild(assetRow(a));
  }
}

function assetRow(a) {
  const row = document.createElement('div');
  row.className = 'task-row clickable';
  row.title = '点击打开';
  const fileUrl = 'file:///' + encodeURI(a.path.replace(/\\/g, '/'));
  const preview = a.type === 'image'
    ? `<img class="asset-thumb" src="${fileUrl}" />`
    : `<video class="asset-thumb" src="${fileUrl}" preload="metadata" muted></video>`;
  row.innerHTML = `
    ${preview}
    <span class="label">${a.name}</span>
    <span style="color:var(--text-dim)">${(a.size / 1024).toFixed(0)} KB</span>
  `;
  row.addEventListener('click', async () => {
    try { await api.openAsset(a.path); }
    catch (err) { alert(`打开失败: ${err.message}`); }
  });
  // 在文件管理器中定位
  const reveal = document.createElement('button');
  reveal.className = 'btn icon-btn';
  reveal.title = '打开所在文件夹';
  reveal.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
  reveal.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await api.revealAsset(a.path);
  });
  row.appendChild(reveal);
  // 单个删除：免确认（PM 定案）
  const del = document.createElement('button');
  del.className = 'btn icon-btn danger';
  del.title = '删除素材';
  del.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
  del.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await api.deleteAsset(a.id);
    loadAssets();
  });
  row.appendChild(del);
  return row;
}

// 应用内圆角确认弹窗（替代系统 confirm）
function showConfirm(text) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-text').textContent = text;
    modal.classList.remove('hidden');
    const done = (v) => {
      modal.classList.add('hidden');
      document.getElementById('confirm-ok').onclick = null;
      document.getElementById('confirm-cancel').onclick = null;
      resolve(v);
    };
    document.getElementById('confirm-ok').onclick = () => done(true);
    document.getElementById('confirm-cancel').onclick = () => done(false);
  });
}

document.getElementById('assets-clear').addEventListener('click', async () => {
  const assets = await api.listAssets();
  if (!assets.length) return;
  const ok = await showConfirm(`将删除全部 ${assets.length} 个生成产物，文件将从磁盘移除，不可恢复。`);
  if (!ok) return;
  await api.clearAssets();
  loadAssets();
});

api.onTaskUpdate(async () => {
  const tasks = await api.listTasks();
  updateBadge(tasks);
  if (document.getElementById('view-tasks').classList.contains('active')) {
    renderTasks(document.getElementById('task-list'), tasks);
  }
});

// ---------- Onboarding ----------
async function maybeOnboard() {
  const [arkcli, settings] = await Promise.all([api.arkcliStatus(), api.getSettings()]);
  const needArkcli = !arkcli.installed;
  const needLogin = arkcli.installed && !arkcli.auth.loggedIn;
  const needKey = !settings.apiKeyConfigured;
  if (!needArkcli && !needLogin && !needKey) return;

  const overlay = document.getElementById('onboarding');
  const body = document.getElementById('wizard-body');
  const title = document.getElementById('wizard-title');
  overlay.classList.remove('hidden');

  const steps = [];
  if (needArkcli) steps.push('install');
  if (needLogin) steps.push('login');
  if (needKey) steps.push('apikey');
  let idx = 0;

  function renderStep() {
    const step = steps[idx];
    document.getElementById('wizard-next').textContent = idx === steps.length - 1 ? '完成' : '下一步';
    if (step === 'install') {
      title.textContent = '第一步：安装 arkcli';
      body.innerHTML = `
        <p>生成图片和视频依赖 arkcli（运行在 Node.js 上）。点击按钮自动完成全部安装：</p>
        <p><button id="wizard-install" class="btn primary">一键安装运行环境</button></p>
        <div id="wizard-install-log" class="install-log hidden"></div>`;
      body.querySelector('#wizard-install').addEventListener('click', async () => {
        const logEl = body.querySelector('#wizard-install-log');
        logEl.classList.remove('hidden');
        const off = api.onSetupProgress((p) => {
          const line = document.createElement('div');
          line.textContent = (p.status === 'done' ? '✓ ' : '… ') + p.detail
            + (p.percent !== undefined && p.percent !== null ? ` ${p.percent}%` : '');
          if (p.status === 'done') line.style.color = 'var(--green)';
          logEl.appendChild(line);
          logEl.scrollTop = logEl.scrollHeight;
        });
        try {
          await api.setupInstallAll();
        } catch (err) {
          const line = document.createElement('div');
          line.style.color = 'var(--red)';
          line.textContent = `安装失败: ${err.message}`;
          logEl.appendChild(line);
        } finally {
          off();
        }
      });
    } else if (step === 'login') {
      title.textContent = '第二步：登录火山引擎';
      body.innerHTML = `
        <p>点击下方按钮唤起 SSO 登录，在浏览器中完成授权。</p>
        <p><button id="wizard-login" class="btn primary">登录火山引擎</button> <span id="wizard-login-result"></span></p>`;
      body.querySelector('#wizard-login').addEventListener('click', async () => {
        await api.arkcliLogin();
        body.querySelector('#wizard-login-result').textContent = '等待授权完成...';
        const timer = setInterval(async () => {
          const s = await api.arkcliStatus();
          if (s.auth.loggedIn) {
            clearInterval(timer);
            body.querySelector('#wizard-login-result').textContent = '登录成功';
          }
        }, 4000);
      });
    } else {
      title.textContent = '第三步：配置 API Key';
      body.innerHTML = `
        <p>用于提示词润色等文本能力（可稍后在设置页配置）。</p>
        <p><input id="wizard-key" type="password" placeholder="粘贴 API Key" style="width:100%" /></p>
        <p><button id="wizard-save-key" class="btn">保存</button>
           <button id="wizard-test-key" class="btn">测试连接</button>
           <span id="wizard-key-result"></span></p>`;
      body.querySelector('#wizard-save-key').addEventListener('click', async () => {
        try {
          const r = await api.saveApiKey(body.querySelector('#wizard-key').value.trim());
          body.querySelector('#wizard-key-result').textContent = `已保存 ${r.apiKeyMasked}`;
        } catch (err) {
          body.querySelector('#wizard-key-result').textContent = err.message;
        }
      });
      body.querySelector('#wizard-test-key').addEventListener('click', async () => {
        const el = body.querySelector('#wizard-key-result');
        try {
          const r = await api.testApiKey();
          el.textContent = `成功 · ${r.model} · ${r.latencyMs}ms`;
        } catch (err) {
          el.textContent = `失败: ${err.message}`;
        }
      });
    }
  }

  document.getElementById('wizard-next').onclick = () => {
    if (idx < steps.length - 1) { idx++; renderStep(); }
    else overlay.classList.add('hidden');
  };
  document.getElementById('wizard-skip').onclick = () => overlay.classList.add('hidden');
  renderStep();
}

// ---------- 启动 ----------
refreshArkcliStatus();
CanvasEditor.init();
maybeOnboard();
