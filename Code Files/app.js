/* ═══════════════════════════════════════════════════════════════════════════
   LocalBeam — Renderer Main (app.js)
   State · Device discovery · UI rendering · Drag-and-drop · Clipboard
═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   SKULL SVG — animated morphing skull for brand icon
═══════════════════════════════════════════════════════════════════════════ */
const SKULL_POSES = [
  { skull: "M100,30 C60,30 40,60 40,90 C40,110 50,120 55,145 C57,155 70,165 100,165 C130,165 143,155 145,145 C150,120 160,110 160,90 C160,60 140,30 100,30 Z", eyeL: "M65,85 C55,85 55,110 65,110 C75,110 85,100 80,85 Z", eyeR: "M135,85 C145,85 145,110 135,110 C125,110 115,100 120,85 Z" },
  { skull: "M100,45 C50,45 35,70 35,95 C35,115 50,125 55,145 C57,155 70,160 100,160 C130,160 143,155 145,145 C150,125 165,115 165,95 C165,70 150,45 100,45 Z", eyeL: "M70,90 C50,90 50,120 70,120 C85,120 90,110 85,90 Z", eyeR: "M130,90 C150,90 150,120 130,120 C115,120 110,110 115,90 Z" },
  { skull: "M110,35 C70,30 45,60 45,95 C45,115 45,130 55,150 C57,160 75,165 105,165 C135,165 150,155 150,140 C150,115 160,105 160,85 C160,55 145,40 110,35 Z", eyeL: "M75,90 C60,95 65,115 75,115 C85,115 90,105 85,90 Z", eyeR: "M130,85 C145,85 145,110 135,110 C125,110 115,100 125,85 Z" }
];

function createSkullSVG() {
  const ns  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.style.cssText = 'width:100%;height:100%;filter:drop-shadow(0 0 3px var(--skull-fill));pointer-events:none;';

  const skull = document.createElementNS(ns, 'path');
  skull.setAttribute('fill', 'var(--skull-fill)');
  skull.setAttribute('stroke', 'var(--outline-color)');
  skull.setAttribute('stroke-width', '6');
  skull.setAttribute('d', SKULL_POSES[0].skull);
  skull.style.transition = 'd 0.9s cubic-bezier(0.4,0,0.2,1)';

  const eyeL = document.createElementNS(ns, 'path');
  eyeL.setAttribute('fill', 'var(--socket-color)');
  eyeL.setAttribute('d', SKULL_POSES[0].eyeL);
  eyeL.style.transition = 'd 0.9s cubic-bezier(0.4,0,0.2,1)';

  const eyeR = document.createElementNS(ns, 'path');
  eyeR.setAttribute('fill', 'var(--socket-color)');
  eyeR.setAttribute('d', SKULL_POSES[0].eyeR);
  eyeR.style.transition = 'd 0.9s cubic-bezier(0.4,0,0.2,1)';

  svg.append(skull, eyeL, eyeR);

  let idx = 0;
  setInterval(() => {
    if (!svg.isConnected) return;
    idx = (idx + 1) % SKULL_POSES.length;
    skull.setAttribute('d', SKULL_POSES[idx].skull);
    eyeL.setAttribute('d', SKULL_POSES[idx].eyeL);
    eyeR.setAttribute('d', SKULL_POSES[idx].eyeR);
  }, 2000 + Math.random() * 800);

  return svg;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const el = (tag, cls, html='') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/* ── File type → emoji ────────────────────────────────────────────────────── */
function fileEmoji(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    png:'🖼', jpg:'🖼', jpeg:'🖼', gif:'🖼', webp:'🖼', svg:'🖼', ico:'🖼',
    mp4:'🎬', mkv:'🎬', mov:'🎬', avi:'🎬', webm:'🎬',
    mp3:'🎵', wav:'🎵', flac:'🎵', ogg:'🎵', m4a:'🎵',
    pdf:'📄', doc:'📝', docx:'📝', txt:'📝', md:'📝',
    xls:'📊', xlsx:'📊', csv:'📊',
    ppt:'📊', pptx:'📊',
    zip:'📦', rar:'📦', gz:'📦', '7z':'📦',
    js:'💻', ts:'💻', html:'💻', css:'💻', py:'💻', go:'💻', rs:'💻',
    json:'📋', xml:'📋', yaml:'📋', toml:'📋',
    exe:'⚙', msi:'⚙', dmg:'⚙', pkg:'⚙',
    ttf:'🔤', otf:'🔤', woff:'🔤',
  };
  return map[ext] || '📁';
}

/* ── Format bytes ──────────────────────────────────────────────────────────── */
function fmtBytes(b, dec=1) {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k,i)).toFixed(i===0?0:dec)} ${s[i]}`;
}

function fmtSpeed(bps) {
  return fmtBytes(bps) + '/s';
}

/* ── Device avatar color ────────────────────────────────────────────────────── */
function deviceColor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffffff;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue+40)%360},75%,65%))`;
}

function deviceInitials(name) {
  const parts = name.trim().split(/[\s\-_]+/).filter(p => p.length > 0);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const trimmed = name.trim();
  return trimmed.slice(0, 2).toUpperCase() || '?';
}

/* ── OS icon ─────────────────────────────────────────────────────────────── */
function osIcon(platform) {
  if (platform === 'win32')  return '🪟';
  if (platform === 'darwin') return '🍎';
  if (platform === 'linux')  return '🐧';
  if (platform === 'android')return '🤖';
  return '💻';
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════════════════ */
const state = {
  myDevice:       null,
  devices:        new Map(),       // id → device
  transfers:      new Map(),       // id → transfer
  clipHistory:    [],              // { text, dir, time }[]
  stagedFiles:    [],              // { name, size, path?, data? }[]
  selectedDevice: null,            // id of currently selected device
  theme:          'dark',
  stats:          { sent: 0, recv: 0, upBytes: 0, downBytes: 0 },
};

/* ── Staged file previews (blob URLs for visual files about to be sent) ──── */
const _stagedPreviews = new Map(); // filename → blob URL

const _MIME_QUICK = {
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
  webp:'image/webp', bmp:'image/bmp', svg:'image/svg+xml', avif:'image/avif',
  mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac',
  aac:'audio/aac', m4a:'audio/x-m4a',
};
function _mimeFromName(name) {
  return _MIME_QUICK[(name.split('.').pop() || '').toLowerCase()] || '';
}

/* ── Speed sampling (rolling 2-second window) ─────────────────────────────── */
let _lastUp = 0, _lastDown = 0;
setInterval(() => {
  const up   = state.stats.upBytes   - _lastUp;
  const down = state.stats.downBytes - _lastDown;
  _lastUp   = state.stats.upBytes;
  _lastDown = state.stats.downBytes;
  $('speedUp').textContent   = fmtSpeed(up   / 2);
  $('speedDown').textContent = fmtSpeed(down / 2);
}, 2000);

/* ── Stale device pruning ──────────────────────────────────────────────────── */
setInterval(() => {
  const now     = Date.now();
  const timeout = 8000;
  let   changed = false;
  for (const [id, dev] of state.devices) {
    if (now - dev.lastSeen > timeout) {
      state.devices.delete(id);
      changed = true;
    }
  }
  if (changed) renderDevices();
}, 3000);

/* ═══════════════════════════════════════════════════════════════════════════
   TOAST SYSTEM
═══════════════════════════════════════════════════════════════════════════ */
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success:'✓', error:'✕', info:'◎' };
  const t = el('div', `toast ${type}`);
  t.innerHTML = `<span class="toast-icon">${icons[type] || '◎'}</span><span>${msg}</span>`;
  $('toastContainer').appendChild(t);
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 400);
  }, duration);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PARTICLES (drop zone success burst)
═══════════════════════════════════════════════════════════════════════════ */
function spawnParticles(canvas) {
  const ctx  = canvas.getContext('2d');
  const W    = canvas.width  = canvas.offsetWidth;
  const H    = canvas.height = canvas.offsetHeight;
  const cx   = W / 2, cy = H / 2;
  const particles = [];
  const colors = ['#818cf8','#a78bfa','#34d399','#fbbf24','#f0f0f8'];

  for (let i = 0; i < 30; i++) {
    const angle = (Math.PI * 2 / 30) * i + Math.random() * 0.3;
    const speed = 2 + Math.random() * 5;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r:  2 + Math.random() * 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1
    });
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.12;
      p.life -= 0.025;
      if (p.life <= 0) continue;
      alive = true;
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (alive) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  }
  requestAnimationFrame(frame);
}

/* ═══════════════════════════════════════════════════════════════════════════
   DEVICE RENDERING
═══════════════════════════════════════════════════════════════════════════ */
function renderDevices() {
  const list   = $('deviceList');
  const empty  = $('deviceEmpty');
  const count  = state.devices.size;
  const pill   = $('deviceCountPill');
  const prev   = pill.textContent;

  pill.textContent = count;
  if (String(count) !== prev) pill.style.animation = 'none',
    void pill.offsetWidth,
    pill.style.animation = 'pillBounce 0.4s var(--spring)';

  $('statDevices').textContent = `${count} nearby`;

  // Show/hide empty state
  empty.style.display = count === 0 ? 'flex' : 'none';

  // Keep existing items, add/remove as needed
  const existingIds = new Set([...list.querySelectorAll('.device-item')].map(e => e.dataset.id));
  const currentIds  = new Set(state.devices.keys());

  // Remove stale
  for (const e of list.querySelectorAll('.device-item')) {
    if (!currentIds.has(e.dataset.id)) {
      e.style.animation = 'transferSlideOut 0.3s var(--ease-in-out) forwards';
      setTimeout(() => e.remove(), 300);
    }
  }

  // Add new
  for (const [id, dev] of state.devices) {
    if (existingIds.has(id)) {
      // Update name/info only
      const nameEl = list.querySelector(`[data-id="${id}"] .device-name`);
      if (nameEl) nameEl.textContent = dev.alias || dev.name;
      continue;
    }
    const item = buildDeviceItem(dev);
    list.appendChild(item);
  }

  // Rebuild radar dots
  renderRadarDots();

  // Rebuild target chips in drop zone
  renderTargetChips();
}

function buildDeviceItem(dev) {
  const item = el('div', 'device-item');
  item.dataset.id = dev.id;
  item.innerHTML = `
    <div class="device-avatar" style="background:${deviceColor(dev.id)}">${deviceInitials(dev.alias||dev.name)}</div>
    <div class="device-info">
      <div class="device-name">${dev.alias || dev.name}</div>
      <div class="device-ip">${osIcon(dev.os)} ${dev.ip}</div>
    </div>
    <div class="device-status">
      <span class="device-dot online"></span>
    </div>`;

  // Click to select
  item.addEventListener('click', () => selectDevice(dev.id));

  // Right-click context menu
  item.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, dev.id);
  });

  return item;
}

function selectDevice(id) {
  state.selectedDevice = (state.selectedDevice === id) ? null : id;
  document.querySelectorAll('.device-item').forEach(e => {
    e.classList.toggle('selected', e.dataset.id === state.selectedDevice);
  });
  updatePanelHeader();
  // If files are staged, send them now
  if (state.selectedDevice && state.stagedFiles.length > 0) {
    sendStagedFiles(state.selectedDevice);
  }
}

function updatePanelHeader() {
  const placeholder = $('panelHeaderPlaceholder');
  const deviceRow   = $('panelHeaderDevice');
  if (!placeholder || !deviceRow) return;

  const dev = state.selectedDevice ? state.devices.get(state.selectedDevice) : null;
  if (dev) {
    placeholder.classList.add('hidden');
    deviceRow.classList.remove('hidden');
    $('panelDeviceName').textContent = dev.alias || dev.name;
    $('panelDeviceIP').textContent   = dev.ip;
    const avatar = $('panelDeviceAvatar');
    avatar.textContent = deviceInitials(dev.alias || dev.name);
    avatar.style.background = deviceColor(dev.id);
  } else {
    placeholder.classList.remove('hidden');
    deviceRow.classList.add('hidden');
  }
}

/* ── Radar dots ──────────────────────────────────────────────────────────── */
function renderRadarDots() {
  const container = $('radarDots');
  container.innerHTML = '';
  const devs = [...state.devices.values()];

  devs.forEach((dev, i) => {
    const angle = ((Math.PI * 2) / Math.max(devs.length, 1)) * i - Math.PI / 2;
    const r     = 38;  // % from center of radar
    const cx    = 50, cy = 50;
    const x     = cx + Math.cos(angle) * r;
    const y     = cy + Math.sin(angle) * r;

    const dot = el('div', 'radar-dot');
    dot.style.cssText = `left:${x}%;top:${y}%;background:${deviceColor(dev.id)};`;
    dot.style.setProperty('color', deviceColor(dev.id).match(/#[a-f0-9]{6}/i)?.[0] || '#818cf8');
    dot.title = dev.alias || dev.name;
    dot.addEventListener('click', () => selectDevice(dev.id));
    container.appendChild(dot);
  });
}

/* ── Target chips for drop zone ──────────────────────────────────────────── */
function renderTargetChips() {
  const chips = $('targetChips');
  chips.innerHTML = '';
  for (const [id, dev] of state.devices) {
    const chip = el('button', 'target-chip');
    chip.innerHTML = `
      <span class="chip-avatar" style="background:${deviceColor(id)}">${deviceInitials(dev.alias||dev.name)}</span>
      ${dev.alias || dev.name}`;
    chip.addEventListener('click', () => sendStagedFiles(id));
    chips.appendChild(chip);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTEXT MENU
═══════════════════════════════════════════════════════════════════════════ */
let _ctxDeviceId = null;

function showCtxMenu(x, y, deviceId) {
  _ctxDeviceId = deviceId;
  const menu = $('ctxMenu');
  menu.classList.remove('hidden');
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = 170, mh = 130;
  menu.style.left = `${Math.min(x, vw - mw)}px`;
  menu.style.top  = `${Math.min(y, vh - mh)}px`;
}

document.addEventListener('click', () => $('ctxMenu').classList.add('hidden'));

$('ctxMenu').addEventListener('click', e => {
  const action = e.target.dataset.action;
  const dev    = state.devices.get(_ctxDeviceId);
  if (!dev || !action) return;

  switch (action) {
    case 'ping':
      pingDevice(dev);
      break;
    case 'send':
      selectDevice(_ctxDeviceId);
      $('browseBtn')?.click();
      break;
    case 'rename':
      openRenameDialog(_ctxDeviceId);
      break;
    case 'remove':
      state.devices.delete(_ctxDeviceId);
      renderDevices();
      break;
  }
});

async function pingDevice(dev) {
  const start = Date.now();
  try {
    await window.api.sendSignal(dev.ip, dev.port, '/ping', { type: 'ping' });
    const ms = Date.now() - start;
    toast(`${dev.name}: ${ms}ms`, 'success');
  } catch {
    toast(`${dev.name} unreachable`, 'error');
  }
}

function openRenameDialog(deviceId) {
  const dev = state.devices.get(deviceId);
  if (!dev) return;
  $('renameInput').value = dev.alias || dev.name;
  $('renameModal').classList.add('open');
  $('renameInput').focus();
  $('renameSaveBtn').onclick = () => {
    const alias = $('renameInput').value.trim();
    if (alias) {
      dev.alias = alias;
      renderDevices();
    }
    $('renameModal').classList.remove('open');
  };
  $('renameCancelBtn').onclick = () => $('renameModal').classList.remove('open');
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSFER RENDERING
═══════════════════════════════════════════════════════════════════════════ */

/* Scroll feed to top (newest item) if user hasn't scrolled away */
function scrollFeedToLatest() {
  const feed = document.querySelector('.panel-feed');
  if (!feed) return;
  // Only snap if user is already near the top (within 120px)
  if (feed.scrollTop < 120) {
    feed.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function addTransfer(t) {
  state.transfers.set(t.id, t);
  renderTransfer(t);
  $('transferEmpty').style.display = 'none';
  $('cardTransfers').classList.add('transferring');
  scrollFeedToLatest();
}

function renderTransfer(t) {
  const list  = $('transferList');
  let   item  = list.querySelector(`[data-tid="${t.id}"]`);
  const isNew = !item;

  if (isNew) {
    item = el('div', `transfer-item ${t.status}`);
    item.dataset.tid = t.id;

    // Skull avatar — created once, never replaced on updates
    const skullWrap = el('div', 'msg-skull-wrap');
    skullWrap.appendChild(createSkullSVG());
    item.appendChild(skullWrap);

    // Body container — innerHTML is updated on progress ticks
    item.appendChild(el('div', 'transfer-body'));

    item.classList.add('new-item');
    list.prepend(item);
    // Remove the class after the entrance animation so it won't re-fire on DOM updates
    setTimeout(() => item.classList.remove('new-item'), 800);
  } else {
    item.className = `transfer-item ${t.status}`;
  }

  const pct  = t.total ? Math.round((t.done / t.total) * 100) : 0;
  const dir  = t.direction === 'send' ? '↑' : '↓';
  const peer = t.deviceName || 'Unknown';

  let statusIcon = '';
  if (t.status === 'active')     statusIcon = `<span class="spin">↻</span>`;
  else if (t.status === 'done')  statusIcon = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-6" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  else if (t.status === 'error') statusIcon = `✕`;

  const isImage = t.mimeType?.startsWith('image/');
  const isVideo = t.mimeType?.startsWith('video/');
  const isAudio = t.mimeType?.startsWith('audio/');
  const ext     = (t.name.split('.').pop() || '').toUpperCase().slice(0, 6);

  // Build the preview/icon block
  let previewBlock;
  if (t.previewUrl && isAudio) {
    // Show icon card + inline audio player in the info section
    previewBlock = `<div class="file-icon-card"><span class="file-icon-emoji">${fileEmoji(t.name)}</span><span class="file-icon-ext">${ext}</span></div>`;
  } else if (t.previewUrl && (isImage || isVideo)) {
    previewBlock = `<div class="file-preview-wrap visual">${
      isVideo
        ? `<video class="preview-thumb" src="${t.previewUrl}" muted playsinline preload="auto"></video>`
        : `<img  class="preview-thumb" src="${t.previewUrl}" alt="">`
    }</div>`;
  } else {
    previewBlock = `<div class="file-icon-card"><span class="file-icon-emoji">${fileEmoji(t.name)}</span><span class="file-icon-ext">${ext}</span></div>`;
  }

  item.querySelector('.transfer-body').innerHTML = `
    ${previewBlock}
    <div class="transfer-info">
      <div class="transfer-name" title="${t.name}">${t.name}</div>
      ${t.previewUrl && isAudio ? `<audio class="inline-audio" controls src="${t.previewUrl}"></audio>` : ''}
      <div class="transfer-meta">
        <span>${dir} ${peer}</span>
        <span>${fmtBytes(t.total || 0)}</span>
        ${t.status === 'active' ? `<span>${pct}%</span>` : ''}
        ${t.status === 'error'  ? `<span style="color:var(--error)">${t.errorMsg||'Failed'}</span>` : ''}
      </div>
      ${t.status === 'active' ? `
        <div class="transfer-progress-wrap">
          <div class="transfer-progress-bar active" style="width:${pct}%"></div>
        </div>` : ''}
    </div>
    ${t.savedPath && t.status === 'done' ? `
      <button class="btn-open-folder" data-tid="${t.id}" title="Show in folder">
        <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
          <path d="M1 4a1 1 0 011-1h4l2 2h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        </svg>
      </button>` : ''}
    <div class="transfer-status-icon ${t.status}">${statusIcon}</div>
    ${t.status === 'active' ? `<button class="transfer-cancel" data-tid="${t.id}" title="Cancel">✕</button>` : ''}
  `;

  // Seek video thumbnails to show first frame (Chromium won't decode any frame without a seek)
  const vidThumb = item.querySelector('video.preview-thumb');
  if (vidThumb) {
    const seek = () => { vidThumb.currentTime = 0.1; };
    vidThumb.readyState >= 1 ? seek() : vidThumb.addEventListener('loadedmetadata', seek, { once: true });
  }

  if (t.status === 'done' || t.status === 'error') {
    $('cardTransfers').classList.remove('transferring');
    setTimeout(() => {
      const all = [...state.transfers.values()];
      if (!all.some(x => x.status === 'active')) {
        $('cardTransfers').classList.remove('transferring');
      }
    }, 300);
  }
}

function updateTransferProgress(id, done, total) {
  const t = state.transfers.get(id);
  if (!t) return;
  t.done  = done;
  t.total = total;
  const item = $('transferList').querySelector(`[data-tid="${id}"]`);
  if (!item) return;
  const pct  = total ? Math.round((done / total) * 100) : 0;
  const bar  = item.querySelector('.transfer-progress-bar');
  const meta = item.querySelector('.transfer-meta');
  if (bar) bar.style.width = pct + '%';
  if (meta) {
    const pctSpan = meta.querySelector('span:last-child');
    if (pctSpan && pctSpan.textContent.includes('%')) pctSpan.textContent = pct + '%';
  }
}

// Transfer list button delegation (cancel + open-in-folder)
$('transferList').addEventListener('click', e => {
  const cancelBtn = e.target.closest('.transfer-cancel');
  if (cancelBtn) {
    const tid = cancelBtn.dataset.tid;
    const t   = state.transfers.get(tid);
    if (t) {
      t.status = 'error'; t.errorMsg = 'Cancelled';
      renderTransfer(t);
      window.rtc?.cancelTransfer?.(tid);
    }
    return;
  }

  const folderBtn = e.target.closest('.btn-open-folder');
  if (folderBtn) {
    const tid = folderBtn.dataset.tid;
    const t   = state.transfers.get(tid);
    if (t?.savedPath) window.api.showInFolder(t.savedPath);
  }
});

$('clearTransfers')?.addEventListener('click', () => {
  for (const [id, t] of state.transfers) {
    if (t.status !== 'active') state.transfers.delete(id);
  }
  const list  = $('transferList');
  const items = list.querySelectorAll('.transfer-item:not([data-status="active"])');
  items.forEach(i => {
    i.style.animation = 'transferSlideOut 0.3s forwards';
    setTimeout(() => i.remove(), 300);
  });
  if (state.transfers.size === 0 && state.clipHistory.length === 0) {
    $('transferEmpty').style.display = 'flex';
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   CLIPBOARD
═══════════════════════════════════════════════════════════════════════════ */
const clipTA = $('clipTextarea');

clipTA.addEventListener('input', () => {
  const len = clipTA.value.length;
  $('clipCharCount').textContent = len || '';
  $('sendClipBtn').disabled = len === 0;
});

// Enter to send (Shift+Enter for newline)
clipTA.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!$('sendClipBtn').disabled) $('sendClipBtn').click();
  }
});

$('pasteSystemClip').addEventListener('click', async () => {
  const text = await window.api.getClipboard();
  if (text) { clipTA.value = text; clipTA.dispatchEvent(new Event('input')); }
});

$('sendClipBtn').addEventListener('click', async () => {
  const text = clipTA.value.trim();
  if (!text) return;

  const targets = state.selectedDevice
    ? [state.devices.get(state.selectedDevice)].filter(Boolean)
    : [...state.devices.values()];

  // Always post to local feed first
  const dir = targets.length > 0 ? 'sent' : 'note';
  addClipHistory(text, dir);

  clipTA.value = '';
  $('clipCharCount').textContent = '';
  $('sendClipBtn').disabled = true;
  clipTA.focus();

  // Send to devices if any are available
  if (targets.length > 0) {
    for (const dev of targets) {
      window.rtc.sendClipText(dev, text);
    }
    toast(`Sending to ${targets.length} device${targets.length > 1 ? 's' : ''}…`, 'info', 1500);
  } else {
    toast('Saved as note — no devices connected', 'info', 2000);
  }
});

function addClipHistory(text, dir) {
  const entry = { text, dir, time: Date.now(), id: Math.random().toString(36).slice(2) };
  state.clipHistory.unshift(entry);
  if (state.clipHistory.length > 20) state.clipHistory.pop();
  renderClipHistory();
}

function renderClipHistory() {
  // Render new clip items into the unified transfer feed
  const feed    = $('transferList');
  const existing = new Set([...feed.querySelectorAll('.clip-item')].map(e => e.dataset.cid));
  for (const entry of state.clipHistory) {
    if (existing.has(entry.id)) continue;
    const item = buildClipItem(entry);
    $('transferEmpty').style.display = 'none';
    feed.prepend(item);
    scrollFeedToLatest();
  }
}

function buildClipItem(entry) {
  const item = el('div', 'clip-item new-item');
  item.dataset.cid = entry.id;
  setTimeout(() => item.classList.remove('new-item'), 800);

  // Skull avatar
  const skullWrap = el('div', 'msg-skull-wrap');
  skullWrap.appendChild(createSkullSVG());
  item.appendChild(skullWrap);

  // Content
  const preview = entry.text.length > 140 ? entry.text.slice(0, 137) + '…' : entry.text;
  const body = el('div', 'clip-body');
  body.innerHTML = `
    <div class="clip-text">${escapeHtml(preview)}</div>
    <div class="clip-item-actions">
      <span class="clip-tag ${entry.dir}">${entry.dir === 'note' ? '✎ note' : entry.dir}</span>
      <button class="btn-icon" title="Copy" data-cid="${entry.id}">⎘</button>
    </div>`;
  body.querySelector('.btn-icon').addEventListener('click', async () => {
    await window.api.setClipboard(entry.text);
    toast('Copied!', 'success', 1500);
  });
  item.appendChild(body);

  return item;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ═══════════════════════════════════════════════════════════════════════════
   DRAG AND DROP
═══════════════════════════════════════════════════════════════════════════ */
const dropZone  = $('dropZone');
const cardDrop  = $('cardDropzone');

function setupDragDrop() {
  // Prevent default on window
  window.addEventListener('dragover',  e => { e.preventDefault(); });
  window.addEventListener('drop',      e => { e.preventDefault(); });

  dropZone.addEventListener('dragenter', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
    cardDrop.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', e => {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('drag-over');
      cardDrop.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });

  dropZone.addEventListener('drop', async e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    cardDrop.classList.remove('drag-over');

    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;

    // Use path when available (Electron file-system drag); fall back to FileReader
    const fileRefs = await Promise.all(files.map(async f => {
      if (f.path) return { name: f.name, size: f.size, path: f.path };
      const data = await f.arrayBuffer();
      return { name: f.name, size: f.size, data };
    }));
    await stageFiles(fileRefs);
  });

  // Browse button
  $('browseBtn').addEventListener('click', async () => {
    const paths = await window.api.openFileDialog();
    if (!paths || paths.length === 0) return;
    const files = paths.map(p => ({ path: p, name: p.split(/[/\\]/).pop(), size: 0 }));
    await stageFiles(files);
  });

  $('clearStaged').addEventListener('click', () => {
    state.stagedFiles = [];
    showDropIdle();
  });
}

async function stageFiles(files) {
  state.stagedFiles = files;
  const wrap    = $('stagedFiles');
  wrap.innerHTML = '';

  for (const f of files) {
    const chip = el('div', 'staged-file-chip');
    chip.innerHTML = `
      <span class="staged-file-icon">${fileEmoji(f.name)}</span>
      <span class="staged-file-name">${f.name}</span>
      ${f.size > 0 ? `<span class="staged-file-size">${fmtBytes(f.size)}</span>` : ''}`;
    wrap.appendChild(chip);
  }

  renderTargetChips();

  // Create in-memory preview URLs for visual files that have raw data
  for (const f of files) {
    const mime = _mimeFromName(f.name);
    if (mime && (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/'))) {
      const raw = f.data instanceof ArrayBuffer ? f.data : f.data?.buffer;
      if (raw) {
        try {
          _stagedPreviews.set(f.name, URL.createObjectURL(new Blob([raw], { type: mime })));
        } catch {}
      }
    }
  }

  $('dropIdle').classList.add('hidden');
  $('dropStaged').classList.remove('hidden');

  // Auto-send if a device is already selected
  if (state.selectedDevice) {
    await sendStagedFiles(state.selectedDevice);
  }
}

function showDropIdle() {
  $('dropIdle').classList.remove('hidden');
  $('dropStaged').classList.add('hidden');
}

async function sendStagedFiles(deviceId) {
  const dev   = state.devices.get(deviceId);
  const files = state.stagedFiles;
  if (!dev || files.length === 0) return;

  toast(`Sending ${files.length} file${files.length>1?'s':''} to ${dev.alias||dev.name}…`, 'info');
  showDropIdle();
  state.stagedFiles = [];

  for (const f of files) {
    window.rtc.sendFile(dev, f);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATUS BAR
═══════════════════════════════════════════════════════════════════════════ */
function updateStatus() {
  $('statSent').textContent = fmtBytes(state.stats.sent);
  $('statRecv').textContent = fmtBytes(state.stats.recv);
}

/* ═══════════════════════════════════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════════════════════════════════ */
function applyTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem('lb-theme', t);
  window.api.setTheme(t);
}

$('themeToggle').addEventListener('click', () => {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
});

/* ═══════════════════════════════════════════════════════════════════════════
   SLIDE NOTIFICATION
═══════════════════════════════════════════════════════════════════════════ */
const _SN_ICONS = {
  file: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path fill-rule="evenodd" d="M12 2.25a.75.75 0 01.75.75v11.69l3.22-3.22a.75.75 0 111.06 1.06l-4.5 4.5a.75.75 0 01-1.06 0l-4.5-4.5a.75.75 0 111.06-1.06l3.22 3.22V3a.75.75 0 01.75-.75zm-9 13.5a.75.75 0 01.75.75v2.25a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5V16.5a.75.75 0 011.5 0v2.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V16.5a.75.75 0 01.75-.75z" clip-rule="evenodd"/>
  </svg>`,
  clip: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path fill-rule="evenodd" d="M10.5 3A1.501 1.501 0 009 4.5h6A1.5 1.5 0 0013.5 3h-3zm-2.693.178A3 3 0 0110.5 1.5h3a3 3 0 012.694 1.678c.497.042.992.092 1.486.15 1.497.173 2.57 1.46 2.57 2.929V19.5a3 3 0 01-3 3H6.75a3 3 0 01-3-3V6.257c0-1.47 1.073-2.756 2.57-2.93.493-.057.989-.107 1.487-.15z" clip-rule="evenodd"/>
  </svg>`,
};

let _snTimer = null;

function showSlideNotif(type, title, msg) {
  const notif = $('slideNotif');
  if (!notif) return;

  clearTimeout(_snTimer);

  // Update content
  $('slideNotifIcon').innerHTML  = _SN_ICONS[type] || _SN_ICONS.file;
  $('slideNotifTitle').textContent = title;
  $('slideNotifMsg').textContent   = msg;

  // Reset to base state so re-entrance animation fires cleanly
  notif.classList.remove('sn-open', 'sn-visible');

  // Double rAF: let browser flush the reset before starting transitions
  requestAnimationFrame(() => requestAnimationFrame(() => {
    notif.classList.add('sn-visible');
    // Small pause so the slide-up completes before tray expands
    setTimeout(() => notif.classList.add('sn-open'), 120);
  }));

  // Auto-dismiss after 4.5 s
  _snTimer = setTimeout(_dismissSlideNotif, 4500);
}

function _dismissSlideNotif() {
  const notif = $('slideNotif');
  if (!notif) return;
  notif.classList.remove('sn-open');
  setTimeout(() => notif.classList.remove('sn-visible'), 750);
}

$('slideNotifBtn')?.addEventListener('click', () => {
  clearTimeout(_snTimer);
  _dismissSlideNotif();
});

/* ═══════════════════════════════════════════════════════════════════════════
   WINDOW CONTROLS
═══════════════════════════════════════════════════════════════════════════ */
$('btnMin').addEventListener('click',   () => window.api.minimize());
$('btnMax').addEventListener('click',   () => window.api.maximize());
$('btnClose').addEventListener('click', () => window.api.close());

/* Double-click title bar to maximize */
$('titleBar').addEventListener('dblclick', () => window.api.maximize());

/* ═══════════════════════════════════════════════════════════════════════════
   DEVICE DISCOVERY IPC
═══════════════════════════════════════════════════════════════════════════ */
window.api.onDeviceDiscovered(device => {
  const existing = state.devices.get(device.id);
  state.devices.set(device.id, { ...existing, ...device });
  renderDevices();
  // Refresh panel header if the selected device data changed
  if (state.selectedDevice === device.id) updatePanelHeader();
});

// Scan button
$('scanBtn')?.addEventListener('click', () => {
  const btn = $('scanBtn');
  btn.classList.add('scanning');
  toast('Scanning for devices…', 'info', 2000);
  setTimeout(() => btn.classList.remove('scanning'), 2200);
});

/* ═══════════════════════════════════════════════════════════════════════════
   INCOMING SIGNAL HANDLER (WebRTC signaling from remote devices)
═══════════════════════════════════════════════════════════════════════════ */
window.api.onSignalIn(async ({ reqId, url, data }) => {
  try {
    const response = await window.rtc.handleIncoming(url, data);
    window.api.respondToSignal(reqId, response);
  } catch (err) {
    window.api.respondToSignal(reqId, { error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   INCOMING FILE / CLIPBOARD CALLBACKS (from webrtc.js)
═══════════════════════════════════════════════════════════════════════════ */
window.onTransferStart = (t) => {
  if (t.direction === 'send' && !t.previewUrl && _stagedPreviews.has(t.name)) {
    t.previewUrl = _stagedPreviews.get(t.name);
    _stagedPreviews.delete(t.name);
  }
  addTransfer(t);
};

window.onTransferProgress = (id, done, total) => {
  updateTransferProgress(id, done, total);
  state.stats.downBytes += (done - (state.transfers.get(id)?.done || 0));
};

window.onTransferDone = async (id, fileData, mimeType) => {
  const t = state.transfers.get(id);
  if (!t) return;
  t.status   = 'done';
  t.mimeType = t.mimeType || mimeType;

  if (fileData) {
    // Build an in-memory preview URL for images, GIFs, and short videos (< 50 MB)
    const mime       = t.mimeType || '';
    const isImage    = mime.startsWith('image/');
    const isVideo    = mime.startsWith('video/');
    const isAudio    = mime.startsWith('audio/');
    const smallEnough = (t.total || 0) < 50 * 1024 * 1024;

    if ((isImage || isAudio || (isVideo && smallEnough)) && mime) {
      try {
        // Convert base64 → Uint8Array in chunks to avoid call-stack overflow
        const CHUNK = 8192;
        const raw   = atob(fileData);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += CHUNK) {
          const end = Math.min(i + CHUNK, raw.length);
          for (let j = i; j < end; j++) bytes[j] = raw.charCodeAt(j);
        }
        t.previewUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      } catch (e) {
        console.warn('[preview]', e.message);
      }
    }

    const result = await window.api.saveFile({ name: t.name, data: fileData });
    if (result?.path) t.savedPath = result.path;

    state.stats.recv += t.total || 0;
    updateStatus();
  }

  renderTransfer(t);
  spawnParticles($('dropParticles'));
  showSlideNotif('file', 'File Received', t.name);
};

window.onClipError = (msg) => {
  toast(msg, 'error', 5000);
};

window.onTransferError = (id, msg) => {
  const t = state.transfers.get(id);
  if (!t) return;
  t.status = 'error'; t.errorMsg = msg;
  renderTransfer(t);
  toast(`Transfer failed: ${msg}`, 'error');
};

window.onClipReceived = (text, deviceName) => {
  addClipHistory(text, 'recv');
  window.api.setClipboard(text);
  showSlideNotif('clip', 'Clipboard', `From ${deviceName}`);
};

window.onSendProgress = (id, done, total) => {
  const t = state.transfers.get(id);
  if (t) { t.done = done; t.total = total; }
  updateTransferProgress(id, done, total);
  state.stats.upBytes += (done - (t?.done || 0));
};

window.onSendDone = (id) => {
  const t = state.transfers.get(id);
  if (!t) return;
  t.status = 'done';
  renderTransfer(t);
  state.stats.sent += t.total || 0;
  updateStatus();
};

/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════════════════════════════════ */
function openSettings() {
  $('settingsDeviceName').value = state.myDevice?.name || '';
  $('settingsModal').classList.add('open');
  $('settingsDeviceName').focus();
}

$('settingsBtn').addEventListener('click', openSettings);
$('myDeviceBadge').addEventListener('click', openSettings);

$('settingsCancelBtn').addEventListener('click', () => $('settingsModal').classList.remove('open'));
$('settingsModal').addEventListener('click', e => { if (e.target === $('settingsModal')) $('settingsModal').classList.remove('open'); });

$('settingsThemeBtn').addEventListener('click', () => {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  $('settingsThemeBtn').textContent = state.theme === 'dark' ? 'Dark ✓' : 'Light ✓';
});

$('settingsSaveBtn').addEventListener('click', () => {
  const name = $('settingsDeviceName').value.trim();
  if (name && state.myDevice) {
    state.myDevice.name = name;
    $('myDeviceName').textContent = name;
    window.api.setDeviceName(name);
  }
  $('settingsModal').classList.remove('open');
  toast('Settings saved', 'success', 1800);
});

/* ═══════════════════════════════════════════════════════════════════════════
   INITIALIZE
═══════════════════════════════════════════════════════════════════════════ */
async function init() {
  // Theme
  const savedTheme = localStorage.getItem('lb-theme') || 'dark';
  applyTheme(savedTheme);

  // Device info
  state.myDevice = await window.api.getDeviceInfo();
  $('myDeviceName').textContent = state.myDevice.name;
  $('statIP').textContent       = state.myDevice.ips?.[0] || '—';
  $('statusLed').title          = `Port ${state.myDevice.port}`;

  // Skull brand icon
  const brandContainer = $('brandIconContainer');
  if (brandContainer) brandContainer.appendChild(createSkullSVG());

  // Drop zone
  setupDragDrop();

  // Clipboard
  renderClipHistory();

  // Initial counts
  renderDevices();
  updateStatus();

  toast('System Online', 'success', 3000);
  console.log('[LocalBeam] Ready:', state.myDevice);

  // Auto-update notifications
  window.api.onUpdateStatus?.(({ status, version }) => {
    if (status === 'available') {
      toast(`Update v${version} downloading…`, 'info', 4000);
    } else if (status === 'ready') {
      // Show a persistent banner with a restart button
      const banner = el('div', 'update-banner');
      banner.innerHTML = `
        <span>v${version} ready to install</span>
        <button class="btn-primary small" id="installUpdateBtn">Restart now</button>`;
      document.body.appendChild(banner);
      $('installUpdateBtn').addEventListener('click', () => window.api.installUpdate());
    }
  });
}

init();
