const path = require('path');
const os = require('os');
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const { createContext } = require('./core/context');
const { registerIpc } = require('./ipc');
const { applyAcrylicBlur } = require('./core/win-blur');

let mainWindow = null;
let tray = null;
let needNativeBlur = false;
let isQuitting = false;

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
    icon: path.join(__dirname, '../../build/icon.ico'),
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
  // 关闭 = 最小化到系统托盘后台运行，生成任务不中断；托盘菜单里才能真退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // 托盘图标与应用 logo 一致
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../build/icon.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Sanmao Video Studio（后台运行中）');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      },
    },
    { type: 'separator' },
    {
      label: '退出 Sanmao Video Studio',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// 单实例锁：托盘常驻时重复点击桌面图标，不再新开进程，
// 而是把已运行实例的窗口唤到前台
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

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
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 托盘常驻：窗口全关也不退出，等托盘菜单显式退出
});
}
