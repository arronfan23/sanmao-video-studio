const path = require('path');
const os = require('os');
const { app, BrowserWindow } = require('electron');
const { createContext } = require('./core/context');
const { registerIpc } = require('./ipc');
const { applyAcrylicBlur } = require('./core/win-blur');

let mainWindow = null;
let needNativeBlur = false;

// Windows 11 (build >= 22000)：系统亚克力材质，真磨砂透桌面；
// Windows 10 (1803+)：透明窗口 + SetWindowCompositionAttribute 亚克力模糊；
// 更老环境静默回退为普通半透明。
function windowChromeOptions() {
  const build = Number((os.release().split('.')[2]) || 0);
  const isWin11 = process.platform === 'win32' && build >= 22000;
  if (isWin11) {
    return { transparent: false, backgroundColor: '#14161a', backgroundMaterial: 'acrylic' };
  }
  needNativeBlur = true;
  return { transparent: true, backgroundColor: '#00000000' };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    title: 'Sanmao Video Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...windowChromeOptions(),
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (needNativeBlur) {
    // 必须在窗口真正显示后再调，过早调用 DWM 会静默忽略
    mainWindow.once('ready-to-show', () => applyAcrylicBlur(mainWindow));
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => applyAcrylicBlur(mainWindow), 300);
    });
  }
}

app.whenReady().then(() => {
  // modules 随 asar 打包，asar 内可直接读文件/ require，统一用相对路径
  const modulesDir = path.join(__dirname, '../../modules');
  const dataDir = path.join(app.getPath('userData'), 'data');

  const ctx = createContext({ modulesDir, dataDir });
  ctx.taskQueue.on('update', (job) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task:update', job);
    }
  });
  ctx.engine.events.on('node', (evt) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pipeline:node', evt);
    }
  });

  registerIpc(ctx);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
