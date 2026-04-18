/**
 * LocalBeam — Main Process
 * Handles: window management, UDP device discovery, HTTP signaling server, IPC
 */

const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  Notification, dialog, shell, nativeTheme, clipboard
} = require('electron');
const path  = require('path');
const os    = require('os');
const crypto = require('crypto');
const dgram = require('dgram');
const http  = require('http');
const fs    = require('fs');
let autoUpdater = null;

// ── Constants ────────────────────────────────────────────────────────────────
const DISCOVERY_PORT   = 53317;
const SIGNAL_PORT      = 53318;
const MULTICAST_ADDR   = '224.0.0.251';
const DISCOVERY_MS     = 2000;
const APP_VERSION      = '1.0.0';

// ── Globals ──────────────────────────────────────────────────────────────────
let mainWindow  = null;
let udpSocket   = null;
let httpServer  = null;
let deviceId    = null;
let deviceName  = null;
let signalPort  = SIGNAL_PORT;

const pendingSignals = new Map(); // reqId → { resolve, reject, timer }

// ── Device identity ──────────────────────────────────────────────────────────
function getOrCreateDevice() {
  const idFile = path.join(app.getPath('userData'), 'device.json');
  if (fs.existsSync(idFile)) {
    try { return JSON.parse(fs.readFileSync(idFile, 'utf8')); } catch {}
  }
  const id   = crypto.randomBytes(8).toString('hex');
  const name = os.hostname().replace(/\.local$/, '');
  fs.writeFileSync(idFile, JSON.stringify({ id, name }));
  return { id, name };
}

// ── Network helpers ──────────────────────────────────────────────────────────
function getLocalIPs() {
  const result = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) result.push(a.address);
    }
  }
  return result;
}

// ── UDP Device Discovery ─────────────────────────────────────────────────────
function startDiscovery() {
  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  udpSocket.on('error', err => console.error('[UDP]', err.message));

  udpSocket.on('message', (msg, rinfo) => {
    try {
      const d = JSON.parse(msg.toString());
      if (d.id === deviceId) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device-discovered', {
          id: d.id, name: d.name, ip: rinfo.address,
          port: d.port, os: d.os, lastSeen: Date.now()
        });
      }
    } catch {}
  });

  udpSocket.bind(DISCOVERY_PORT, () => {
    try { udpSocket.addMembership(MULTICAST_ADDR); } catch {}
    udpSocket.setMulticastTTL(1);
    broadcast();
  });

  setInterval(broadcast, DISCOVERY_MS);
}

function broadcast() {
  if (!udpSocket) return;
  const buf = Buffer.from(JSON.stringify({
    id: deviceId, name: deviceName,
    port: signalPort, os: process.platform, v: APP_VERSION
  }));
  // Multicast
  udpSocket.send(buf, 0, buf.length, DISCOVERY_PORT, MULTICAST_ADDR, () => {});
  // Broadcast fallback
  try {
    udpSocket.setBroadcast(true);
    for (const ip of getLocalIPs()) {
      const bcast = ip.split('.').slice(0, 3).join('.') + '.255';
      udpSocket.send(buf, 0, buf.length, DISCOVERY_PORT, bcast, () => {});
    }
  } catch {}
}

// ── HTTP Signaling Server ─────────────────────────────────────────────────────
function startSignalingServer() {
  httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    if (req.method !== 'POST')    { res.writeHead(404); res.end('{}'); return; }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const reqId = crypto.randomBytes(4).toString('hex');

        const timer = setTimeout(() => {
          if (!pendingSignals.has(reqId)) return;
          pendingSignals.delete(reqId);
          res.writeHead(408); res.end(JSON.stringify({ error: 'timeout' }));
        }, 30000);

        pendingSignals.set(reqId, {
          resolve(d) {
            clearTimeout(timer); pendingSignals.delete(reqId);
            res.writeHead(200); res.end(JSON.stringify(d));
          },
          reject(e) {
            clearTimeout(timer); pendingSignals.delete(reqId);
            res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
          }
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('signal-in', { reqId, url: req.url, data });
        } else {
          pendingSignals.get(reqId)?.reject(new Error('window not ready'));
        }
      } catch {
        res.writeHead(400); res.end(JSON.stringify({ error: 'bad json' }));
      }
    });
  });

  const tryBind = (port) => {
    httpServer.listen(port, '0.0.0.0', () => {
      signalPort = httpServer.address().port;
      console.log(`[HTTP] Signaling on :${signalPort}`);
    });
    httpServer.once('error', err => {
      if (err.code === 'EADDRINUSE' && port === SIGNAL_PORT) {
        httpServer.removeAllListeners('error');
        tryBind(0);
      }
    });
  };
  tryBind(SIGNAL_PORT);
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────
function setupIPC() {
  // Respond to incoming signal
  ipcMain.on('signal-response', (_, { reqId, data }) => {
    pendingSignals.get(reqId)?.resolve(data);
  });

  // Send signal HTTP request to another device
  ipcMain.handle('send-signal', (_, { ip, port, url, data }) =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
      const req  = http.request(
        { hostname: ip, port, path: url, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        res => {
          let rb = '';
          res.on('data', c => rb += c);
          res.on('end', () => { try { resolve(JSON.parse(rb)); } catch { resolve({}); } });
        }
      );
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body); req.end();
    })
  );

  // Device / session info
  ipcMain.handle('get-device-info', () => ({
    id: deviceId, name: deviceName,
    ips: getLocalIPs(), port: signalPort, os: process.platform
  }));

  ipcMain.handle('set-device-name', async (_, name) => {
    deviceName = name;
    const idFile = path.join(app.getPath('userData'), 'device.json');
    fs.writeFileSync(idFile, JSON.stringify({ id: deviceId, name }));
    return true;
  });

  // File I/O
  ipcMain.handle('read-file', async (_, filePath) => {
    const buf  = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    return { name: path.basename(filePath), size: stat.size, data: buf.toString('base64') };
  });

  ipcMain.handle('save-file', async (_, { name, data }) => {
    const dir  = app.getPath('downloads');
    let   dest = path.join(dir, name);
    let   n    = 1;
    while (fs.existsSync(dest)) {
      const ext  = path.extname(name);
      dest = path.join(dir, `${path.basename(name, ext)} (${n++})${ext}`);
    }
    fs.writeFileSync(dest, Buffer.from(data, 'base64'));
    const notif = new Notification({ title: 'File received', body: `${name} → Downloads` });
    notif.on('click', () => shell.showItemInFolder(dest));
    notif.show();
    return { path: dest, success: true };
  });

  ipcMain.handle('open-file-dialog', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
    return r.filePaths;
  });

  ipcMain.handle('show-in-folder', (_, p) => shell.showItemInFolder(p));

  // Clipboard
  ipcMain.handle('get-clipboard', () => clipboard.readText());
  ipcMain.handle('set-clipboard', (_, t) => { clipboard.writeText(t); return true; });

  // Window controls
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
  ipcMain.on('window-close',    () => { app.isQuitting = true; app.quit(); });

  // Theme
  ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  ipcMain.on('set-theme', (_, t) => { nativeTheme.themeSource = t; });

  // Notifications
  ipcMain.on('notify', (_, { title, body }) => new Notification({ title, body }).show());

  // Auto-update: install now (quits and relaunches)
  ipcMain.on('install-update', () => {
    app.isQuitting = true;
    autoUpdater.quitAndInstall();
  });
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820, height: 560,
    minWidth: 640, minHeight: 440,
    frame: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Check for updates after the window is visible (skip in dev mode)
    if (!process.argv.includes('--dev')) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });
  mainWindow.on('close', e => { if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); } });
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Lazy-load electron-updater now that app is ready
  autoUpdater = require('electron-updater').autoUpdater;

  autoUpdater.on('update-available', info => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', { status: 'available', version: info.version });
    }
  });
  autoUpdater.on('update-downloaded', info => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', { status: 'ready', version: info.version });
    }
  });
  autoUpdater.on('error', err => console.error('[updater]', err.message));
  const dev  = getOrCreateDevice();
  deviceId   = dev.id;
  deviceName = dev.name;

  setupIPC();
  createWindow();
  startSignalingServer();
  setTimeout(startDiscovery, 600);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', () => {
  app.isQuitting = true;
  try { udpSocket?.close(); }  catch {}
  try { httpServer?.close(); } catch {}
});
