const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('arkStudio', {
  listModules: () => ipcRenderer.invoke('registry:list'),
  arkcliStatus: () => ipcRenderer.invoke('arkcli:status'),
  arkcliLogin: () => ipcRenderer.invoke('arkcli:login'),
  setupCheck: () => ipcRenderer.invoke('setup:check'),
  setupInstallAll: () => ipcRenderer.invoke('setup:installAll'),
  onSetupProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('setup:progress', listener);
    return () => ipcRenderer.removeListener('setup:progress', listener);
  },
  listProfiles: () => ipcRenderer.invoke('arkcli:profiles'),
  switchProfile: (name) => ipcRenderer.invoke('arkcli:switchProfile', name),
  listResources: (modality) => ipcRenderer.invoke('arkcli:resources', modality),
  listEndpoints: () => ipcRenderer.invoke('arkcli:endpoints'),
  getModelParams: (model) => ipcRenderer.invoke('arkcli:modelParams', model),
  runPipeline: (pipeline) => ipcRenderer.invoke('pipeline:run', pipeline),
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  listAssets: () => ipcRenderer.invoke('assets:list'),
  openAsset: (p) => ipcRenderer.invoke('assets:open', p),
  revealAsset: (p) => ipcRenderer.invoke('assets:reveal', p),
  deleteAsset: (id) => ipcRenderer.invoke('assets:delete', id),
  clearAssets: () => ipcRenderer.invoke('assets:clear'),
  pickFile: (kind) => ipcRenderer.invoke('dialog:pickFile', { kind }),
  // 拖入的 OS 文件对象转绝对路径（新版 Electron 移除了 File.path）
  getFilePath: (file) => webUtils.getPathForFile(file),
  runModule: (payload) => ipcRenderer.invoke('module:run', payload),
  winMinimize: () => ipcRenderer.invoke('window:minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  winClose: () => ipcRenderer.invoke('window:close'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (payload) => ipcRenderer.invoke('update:download', payload),
  installUpdate: (payload) => ipcRenderer.invoke('update:install', payload),
  onUpdateProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveApiKey: (key) => ipcRenderer.invoke('settings:saveKey', key),
  clearApiKey: () => ipcRenderer.invoke('settings:clearKey'),
  testApiKey: (model) => ipcRenderer.invoke('settings:testKey', model),
  setDefaultModel: (model) => ipcRenderer.invoke('settings:setDefaultModel', model),
  setBaseUrl: (url) => ipcRenderer.invoke('settings:setBaseUrl', url),
  listTextModels: () => ipcRenderer.invoke('models:text'),
  saveWorkflow: (doc) => ipcRenderer.invoke('workflows:save', doc),
  listWorkflows: () => ipcRenderer.invoke('workflows:list'),
  getWorkflow: (name) => ipcRenderer.invoke('workflows:get', name),
  deleteWorkflow: (name) => ipcRenderer.invoke('workflows:delete', name),
  onTaskUpdate: (cb) => {
    const listener = (_e, job) => cb(job);
    ipcRenderer.on('task:update', listener);
    return () => ipcRenderer.removeListener('task:update', listener);
  },
  onNodeStatus: (cb) => {
    const listener = (_e, evt) => cb(evt);
    ipcRenderer.on('pipeline:node', listener);
    return () => ipcRenderer.removeListener('pipeline:node', listener);
  },
});
