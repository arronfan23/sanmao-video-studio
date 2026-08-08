const { ipcMain, dialog, shell, BrowserWindow } = require('electron');

function registerIpc(ctx) {
  ipcMain.handle('registry:list', () => ctx.registry.list());

  ipcMain.handle('arkcli:status', async () => {
    const [version, auth] = await Promise.all([
      ctx.arkcli.version(),
      ctx.arkcli.authStatus(),
    ]);
    return { installed: version !== null, version, auth };
  });

  ipcMain.handle('arkcli:login', () => ctx.arkcli.login());

  ipcMain.handle('arkcli:profiles', () => ctx.arkcli.listProfiles());
  ipcMain.handle('arkcli:switchProfile', (_e, name) => ctx.arkcli.switchProfile(name));

  ipcMain.handle('arkcli:resources', async (_e, modality) => {
    return ctx.arkcli.listResources(modality);
  });

  ipcMain.handle('arkcli:endpoints', () => ctx.arkcli.listEndpoints());

  ipcMain.handle('arkcli:modelParams', (_e, model) => ctx.arkcli.getSupportedParams(model));

  // ---- 凭据 / 设置（密钥不出主进程，渲染进程只拿到 masked 与布尔） ----
  ipcMain.handle('settings:get', () => ({
    apiKeyConfigured: !!ctx.credentials.getApiKey(),
    apiKeyMasked: ctx.credentials.maskedKey(),
    keyEncrypted: ctx.credentials.encrypted,
    defaultTextModel: ctx.credentials.getDefaultTextModel(),
    baseUrl: ctx.credentials.getBaseUrl(),
    defaultBaseUrl: require('./core/llm-api').DEFAULT_BASE_URL,
  }));

  ipcMain.handle('settings:saveKey', (_e, key) => {
    if (!key || typeof key !== 'string' || key.length < 8) {
      throw new Error('API Key 格式不正确');
    }
    // Key 变更后旧的默认模型不再可信（可能是上一家厂商的）
    const prevKey = ctx.credentials.getApiKey();
    if (prevKey !== null && prevKey !== key.trim()) {
      ctx.credentials.setDefaultTextModel(null);
    }
    ctx.credentials.setApiKey(key.trim());
    return { apiKeyMasked: ctx.credentials.maskedKey() };
  });

  ipcMain.handle('settings:clearKey', () => {
    ctx.credentials.clearApiKey();
    return { cleared: true };
  });

  ipcMain.handle('settings:testKey', async (_e, model) => {
    return ctx.llmApi.testConnection(model);
  });

  ipcMain.handle('settings:setDefaultModel', (_e, model) => {
    ctx.credentials.setDefaultTextModel(model);
    return { saved: true };
  });

  ipcMain.handle('settings:setBaseUrl', (_e, url) => {
    const v = String(url || '').trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//.test(v)) throw new Error('Base URL 必须以 http(s):// 开头');
    // Base URL 变更后旧的默认模型不再可信
    const prevUrl = ctx.credentials.getBaseUrl();
    if ((prevUrl || null) !== (v || null)) {
      ctx.credentials.setDefaultTextModel(null);
    }
    ctx.credentials.setBaseUrl(v || null);
    return { saved: true, baseUrl: v || null };
  });

  ipcMain.handle('models:text', async () => ctx.llmApi.listModels());

  // ---- 工作流持久化 ----
  ipcMain.handle('workflows:save', (_e, doc) => {
    if (!doc || !doc.name) throw new Error('工作流缺少名称');
    return ctx.projects.saveWorkflow(doc);
  });
  ipcMain.handle('workflows:list', () => ctx.projects.listWorkflows());
  ipcMain.handle('workflows:get', (_e, name) => ctx.projects.getWorkflow(name));
  ipcMain.handle('workflows:delete', (_e, name) => {
    ctx.projects.deleteWorkflow(name);
    return { deleted: true };
  });

  ipcMain.handle('pipeline:run', async (_e, pipeline) => {
    return ctx.engine.run(pipeline);
  });

  ipcMain.handle('tasks:list', () => ctx.taskQueue.list());
  ipcMain.handle('assets:list', () => ctx.assets.list());

  ipcMain.handle('assets:open', async (_e, assetPath) => {
    const result = await shell.openPath(assetPath);
    if (result) throw new Error(result);
    return { opened: true };
  });

  // 在文件管理器中定位素材文件
  ipcMain.handle('assets:reveal', (_e, assetPath) => {
    shell.showItemInFolder(assetPath);
    return { revealed: true };
  });

  ipcMain.handle('assets:delete', (_e, id) => {
    return { deleted: ctx.assets.remove(id) };
  });

  ipcMain.handle('assets:clear', () => {
    return { deleted: ctx.assets.clear() };
  });

  // 文件选择器：图生视频等节点导入本地素材用
  ipcMain.handle('dialog:pickFile', async (_e, { kind } = {}) => {
    const filters = kind === 'image'
      ? [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }]
      : kind === 'video'
        ? [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'mkv'] }]
        : [{ name: '所有文件', extensions: ['*'] }];
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
  });

  // 单模块独立运行（参数面板的「生成」按钮等预览场景）
  ipcMain.handle('module:run', (_e, { moduleId, params, inputs }) => {
    return ctx.engine.run({
      name: '模块预览',
      nodes: [{ id: 'preview', moduleId, params: params || {}, inputs: inputs || {} }],
    });
  });

  // 无边框窗口控制
  ipcMain.handle('window:minimize', (e) => { BrowserWindow.fromWebContents(e.sender).minimize(); });
  ipcMain.handle('window:toggleMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.handle('window:close', (e) => { BrowserWindow.fromWebContents(e.sender).close(); });
}

module.exports = { registerIpc };
