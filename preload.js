/**
 * LocalBeam — Preload / Context Bridge
 * Exposes a locked-down API surface to the renderer via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Device ──────────────────────────────────────────────────────────────
  getDeviceInfo:   ()       => ipcRenderer.invoke('get-device-info'),
  setDeviceName:   name     => ipcRenderer.invoke('set-device-name', name),

  // ── Signaling ────────────────────────────────────────────────────────────
  /** Send an HTTP signal to another device's signaling server */
  sendSignal: (ip, port, url, data) =>
    ipcRenderer.invoke('send-signal', { ip, port, url, data }),

  /** Register handler for incoming signals from remote devices */
  onSignalIn: cb => ipcRenderer.on('signal-in', (_, d) => cb(d)),

  /** Reply to a received signal (resolves the pending HTTP response) */
  respondToSignal: (reqId, data) =>
    ipcRenderer.send('signal-response', { reqId, data }),

  // ── Discovery events ─────────────────────────────────────────────────────
  onDeviceDiscovered: cb => ipcRenderer.on('device-discovered', (_, d) => cb(d)),

  // ── File I/O ─────────────────────────────────────────────────────────────
  readFile:       filePath  => ipcRenderer.invoke('read-file', filePath),
  saveFile:       fileData  => ipcRenderer.invoke('save-file', fileData),
  openFileDialog: ()        => ipcRenderer.invoke('open-file-dialog'),
  showInFolder:   filePath  => ipcRenderer.invoke('show-in-folder', filePath),

  // ── Clipboard ────────────────────────────────────────────────────────────
  getClipboard:   ()    => ipcRenderer.invoke('get-clipboard'),
  setClipboard:   text  => ipcRenderer.invoke('set-clipboard', text),

  // ── Window controls ──────────────────────────────────────────────────────
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),

  // ── Theme ────────────────────────────────────────────────────────────────
  getTheme:  ()     => ipcRenderer.invoke('get-theme'),
  setTheme:  theme  => ipcRenderer.send('set-theme', theme),

  // ── Notifications ────────────────────────────────────────────────────────
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),

  // ── Auto-update ──────────────────────────────────────────────────────────
  onUpdateStatus:  cb => ipcRenderer.on('update-status', (_, d) => cb(d)),
  installUpdate:   ()  => ipcRenderer.send('install-update'),

  // ── Cleanup ──────────────────────────────────────────────────────────────
  removeAllListeners: channel => ipcRenderer.removeAllListeners(channel)
});
