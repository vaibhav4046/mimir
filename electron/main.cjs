const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { fork } = require('node:child_process');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  dialog,
  desktopCapturer,
  globalShortcut,
  nativeImage,
  shell,
} = require('electron');

// MIMIR_* env vars, with the legacy GROKBOT_* names still accepted.
const env = name => process.env[`MIMIR_${name}`] ?? process.env[`GROKBOT_${name}`];

let mainWindow = null;
let spotlightWindow = null;
const popoutWindows = new Map();
let tray = null;
let coordinatorProc = null;
let isQuitting = false;

const coordinatorToken = env('TOKEN') || crypto.randomBytes(24).toString('hex');
let coordinatorInfo = null;
let resolveCoordPromise = null;
const coordReadyPromise = new Promise(resolve => {
  resolveCoordPromise = resolve;
});

function createSolidPng(width, height, [r, g, b, a]) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - width / 2 + 0.5;
      const dy = y - height / 2 + 0.5;
      const inside = dx * dx + dy * dy <= (width * 0.44) ** 2;
      raw[px] = inside ? r : 0;
      raw[px + 1] = inside ? g : 0;
      raw[px + 2] = inside ? b : 0;
      raw[px + 3] = inside ? a : 0;
    }
  }
  const crc32 = buf => {
    let c = 0xffffffff;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const tBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
    return Buffer.concat([len, tBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function getAppUrl(params = {}) {
  const q = new URLSearchParams(params).toString();
  if (env('DEV') === '1') {
    const base = env('DEV_URL') || 'http://127.0.0.1:5173/';
    return q ? `${base}?${q}` : base;
  }
  const distFile = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
  const fileUrl = new URL(`file://${distFile.replace(/\\/g, '/')}`);
  if (q) fileUrl.search = q;
  return fileUrl.toString();
}

function attachWindowSecurity(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (evt, targetUrl) => {
    const allowed =
      targetUrl.startsWith('http://127.0.0.1:5173') ||
      targetUrl.startsWith('file://');
    if (!allowed) {
      evt.preventDefault();
      if (/^https?:\/\//i.test(targetUrl)) shell.openExternal(targetUrl).catch(() => {});
    }
  });
}

function startCoordinatorDaemon() {
  // The daemon ships outside app.asar (asarUnpack): it is run by a plain Node child and spawns
  // real files (Rust sidecar, Python scripts) that cannot live inside an archive.
  const scriptPath = path.join(__dirname, '..', 'daemon', 'coordinator.mjs').replace('app.asar', 'app.asar.unpacked');
  coordinatorProc = fork(scriptPath, [], {
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MIMIR_TOKEN: coordinatorToken,
      MIMIR_PORT: env('PORT') || '0',
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  coordinatorProc.on('message', msg => {
    if (msg?.type === 'COORDINATOR_READY') {
      coordinatorInfo = { port: msg.port, url: msg.url, token: msg.token };
      resolveCoordPromise(coordinatorInfo);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('desktop:coordinator-ready', coordinatorInfo);
        }
      }
    }
  });

  coordinatorProc.stderr?.on('data', chunk => {
    process.stderr.write(`[coordinator] ${chunk}`);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b0f14',
    title: 'Mimir',
    show: env('SMOKE_TEST') !== '1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachWindowSecurity(mainWindow);
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[mimir] did-fail-load (${code}) ${desc}: ${url}`);
  });
  mainWindow.once('ready-to-show', () => {
    console.log('[mimir] mainWindow ready-to-show');
    if (env('SMOKE_TEST') !== '1') {
      mainWindow.show();
    }
  });
  mainWindow.on('close', evt => {
    if (!isQuitting && env('SMOKE_TEST') !== '1') {
      evt.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.loadURL(getAppUrl({ mode: 'main' }));
  return mainWindow;
}

function openSpotlightWindow() {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) {
    if (spotlightWindow.isVisible()) {
      spotlightWindow.hide();
      return spotlightWindow;
    }
    spotlightWindow.show();
    spotlightWindow.focus();
    return spotlightWindow;
  }
  spotlightWindow = new BrowserWindow({
    width: 680,
    height: 460,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#1c1c1c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachWindowSecurity(spotlightWindow);
  spotlightWindow.on('blur', () => {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) spotlightWindow.hide();
  });
  spotlightWindow.once('ready-to-show', () => {
    spotlightWindow.show();
    spotlightWindow.focus();
  });
  spotlightWindow.loadURL(getAppUrl({ mode: 'spotlight' }));
  return spotlightWindow;
}

function openPopoutWindow(botId) {
  const existing = popoutWindows.get(botId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 380,
    minHeight: 460,
    backgroundColor: '#0b0f14',
    title: 'Mimir Popout',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachWindowSecurity(win);
  popoutWindows.set(botId, win);
  win.on('closed', () => popoutWindows.delete(botId));
  win.loadURL(getAppUrl({ mode: 'popout', botId }));
  return win;
}

function createTray() {
  const img = nativeImage.createFromBuffer(createSolidPng(16, 16, [92, 200, 255, 255]));
  tray = new Tray(img);
  tray.setToolTip('Mimir (Local Ollama)');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Mimir',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { label: 'Spotlight Launcher (Alt+Shift+Space)', click: () => openSpotlightWindow() },
    { type: 'separator' },
    {
      label: 'Quit Mimir',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    mainWindow.show();
    mainWindow.focus();
  });
}

function registerIpc() {
  ipcMain.handle('desktop:get-coordinator', () => coordReadyPromise);
  ipcMain.handle('desktop:open-spotlight', () => {
    openSpotlightWindow();
    return true;
  });
  ipcMain.handle('desktop:open-popout', (_e, botId) => {
    openPopoutWindow(String(botId || 'bot-grok-default'));
    return true;
  });
  ipcMain.handle('desktop:hide-current', evt => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    win?.hide();
    return true;
  });
  ipcMain.handle('desktop:open-external', (_e, url) => {
    if (/^https?:\/\//i.test(String(url || ''))) {
      shell.openExternal(String(url));
      return true;
    }
    return false;
  });
  ipcMain.handle('desktop:pick-files', async evt => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    const res = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (res.canceled) return [];
    return res.filePaths.slice(0, 6).map(fp => {
      const buf = fs.readFileSync(fp);
      return {
        name: path.basename(fp),
        size: buf.length,
        contentBase64: buf.toString('base64'),
      };
    });
  });
  ipcMain.handle('desktop:capture-screen', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 800 },
    });
    const first = sources[0];
    if (!first) return null;
    return {
      name: first.name || 'Primary Display',
      dataUrl: first.thumbnail.toDataURL(),
    };
  });
}

if (env('SMOKE_TEST') !== '1') {
  const locked = app.requestSingleInstanceLock();
  if (!locked) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    });
  }
}

app.whenReady().then(async () => {
  startCoordinatorDaemon();
  registerIpc();
  const win = createMainWindow();

  if (env('SMOKE_TEST') === '1') {
    await Promise.all([
      coordReadyPromise,
      new Promise(resolve => win.webContents.once('did-finish-load', resolve)),
    ]);
    for (let i = 0; i < 30; i += 1) {
      const ready = await win.webContents.executeJavaScript(`Boolean(
        document.querySelector('[data-testid="sidebar"]') ||
        document.querySelector('[data-testid="runtime-gate-error"]')
      )`);
      if (ready) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const snapshot = await win.webContents.executeJavaScript(`({
      title: document.title,
      hasDesktopBridge: Boolean(window.desktop && typeof window.desktop.getCoordinator === 'function'),
      rootTextLen: document.getElementById('root')?.innerText?.trim()?.length || 0,
      hasSidebar: Boolean(document.querySelector('[data-testid="sidebar"]')),
      hasComputerPane: Boolean(document.querySelector('[data-testid="computer-pane"]')),
      botNameVisible: document.body?.innerText?.includes('Mimir') || false,
      runtimeGateVisible: Boolean(document.querySelector('[data-testid="runtime-connect-gate"]')),
      gateError: document.querySelector('[data-testid="runtime-gate-error"]')?.innerText || null,
    })`);
    const out = JSON.stringify({
      ok: Boolean(snapshot.hasDesktopBridge && snapshot.hasSidebar && snapshot.rootTextLen > 20),
      coordinator: { port: coordinatorInfo.port, url: coordinatorInfo.url, hasToken: Boolean(coordinatorInfo.token) },
      snapshot,
    });
    console.log('SMOKE_OK ' + out);
    if (env('SMOKE_FILE')) {
      fs.writeFileSync(env('SMOKE_FILE'), out, 'utf8');
    }
    isQuitting = true;
    app.quit();
    return;
  }

  createTray();
  globalShortcut.register('Alt+Shift+Space', () => openSpotlightWindow());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (coordinatorProc && !coordinatorProc.killed) {
    coordinatorProc.kill();
  }
});

app.on('window-all-closed', () => {
  if (isQuitting || env('SMOKE_TEST') === '1') {
    app.quit();
  }
});
