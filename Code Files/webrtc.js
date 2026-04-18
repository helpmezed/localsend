/* ═══════════════════════════════════════════════════════════════════════════
   LocalBeam — WebRTC Manager (webrtc.js)

   Handles all peer-to-peer connections:
     • File transfer (any type, chunked binary via DataChannel)
     • Text/clipboard transfer
     • Vanilla ICE (wait for full gathering) — no STUN/TURN needed on LAN

   Signaling flow (initiator → receiver):
     1. Initiator creates offer + waits for ICE gathering to complete
     2. Sends  POST /signal  { type:'offer', sdp, candidates, meta }  to peer's HTTP server
     3. Receiver creates answer + waits for ICE
     4. Returns { type:'answer', sdp, candidates }
     5. Initiator applies answer → DataChannel opens → transfer begins

   Message protocol over DataChannel (JSON header + binary payload):
     { type:'file-meta',  tid, name, size, mimeType, totalChunks }
     { type:'chunk',      tid, index }   followed immediately by binary ArrayBuffer
     { type:'file-done',  tid }
     { type:'clip',       text, sender }
     { type:'ping' }
═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const CHUNK_SIZE      = 64 * 1024;        // 64 KB per chunk
const ICE_TIMEOUT_MS  = 6000;             // max wait for ICE gathering
const BUFFER_HIGH     = 2 * 1024 * 1024;  // 2 MB — pause sending
const BUFFER_LOW      = 256 * 1024;       // 256 KB — resume sending

/* ── MIME type detection from file extension ──────────────────────────────── */
function getMimeType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    // Images
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif',  webp: 'image/webp', bmp: 'image/bmp',
    svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
    tiff: 'image/tiff', tif: 'image/tiff',
    // Videos
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    m4v: 'video/x-m4v', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
    // Audio
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/x-m4a',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    // Archives
    zip: 'application/zip', rar: 'application/x-rar-compressed',
    gz: 'application/gzip', '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    // Code / data
    json: 'application/json', xml: 'application/xml',
    html: 'text/html', css: 'text/css', js: 'text/javascript',
  };
  return map[ext] || 'application/octet-stream';
}

/* ── Generate a short session / transfer ID ────────────────────────────── */
function genId() {
  return Math.random().toString(36).slice(2, 10);
}

/* ── WebRTC config ──────────────────────────────────────────────────────── */
const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

/* ═══════════════════════════════════════════════════════════════════════════
   RTCManager class
═══════════════════════════════════════════════════════════════════════════ */
class RTCManager {
  constructor() {
    this.sessions  = new Map();  // sessionId → { peer, channel, role, device }
    this.inbound   = new Map();  // transferId → { chunks[], received, total, name, mimeType }
    this.outbound  = new Map();  // transferId → { buffer, offset, paused }
    this.cancelled = new Set();  // transferId cancel flags
  }

  _createPeer() {
    return new RTCPeerConnection(RTC_CONFIG);
  }

  _waitICE(peer) {
    return new Promise(resolve => {
      if (peer.iceGatheringState === 'complete') { resolve(); return; }
      const done = () => {
        if (peer.iceGatheringState === 'complete') {
          resolve();
          peer.removeEventListener('icegatheringstatechange', done);
        }
      };
      peer.addEventListener('icegatheringstatechange', done);
      setTimeout(resolve, ICE_TIMEOUT_MS);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INITIATOR — send a file to a device
  ═══════════════════════════════════════════════════════════════════════ */
  async sendFile(device, fileRef) {
    const sid  = genId();
    const peer = this._createPeer();
    const chan  = peer.createDataChannel('lb', { ordered: true });

    this.sessions.set(sid, { peer, channel: chan, role: 'initiator', device });

    // ── Read file data ──────────────────────────────────────────────────
    let fileData, fileName, fileSize, _b64Preview;
    try {
      if (fileRef.path) {
        const f  = await window.api.readFile(fileRef.path);
        fileName = f.name;
        fileSize = f.size;
        _b64Preview = f.data;                                    // keep base64 for preview
        fileData = Uint8Array.from(atob(f.data), c => c.charCodeAt(0)).buffer;
        fileSize = fileSize || fileData.byteLength;
      } else if (fileRef.data) {
        fileData = fileRef.data instanceof ArrayBuffer ? fileRef.data : fileRef.data.buffer;
        fileName = fileRef.name;
        fileSize = fileRef.size || fileData.byteLength;
      } else {
        throw new Error('No file data');
      }
    } catch (err) {
      window.onTransferError?.(sid, err.message);
      this._cleanup(sid);
      return;
    }

    const mimeType    = getMimeType(fileName);
    const totalChunks = Math.ceil(fileData.byteLength / CHUNK_SIZE);
    const tid         = genId();

    // ── Build preview data URL (base64 already in memory — no blob needed) ──
    let previewUrl;
    const previewable = mimeType.startsWith('image/') || mimeType.startsWith('audio/') ||
                        (mimeType.startsWith('video/') && fileData.byteLength < 50 * 1024 * 1024);
    if (previewable) {
      if (_b64Preview) {
        previewUrl = `data:${mimeType};base64,${_b64Preview}`;
      } else {
        try { previewUrl = URL.createObjectURL(new Blob([fileData], { type: mimeType })); } catch {}
      }
    }

    window.onTransferStart?.({
      id: tid, sessionId: sid,
      name: fileName, total: fileSize, done: 0,
      direction: 'send', status: 'active',
      mimeType, previewUrl,
      deviceName: device.alias || device.name
    });

    // ── Register channel handlers BEFORE signaling to avoid race on fast LAN ──
    chan.onopen  = () => this._sendFileData(chan, tid, fileData, fileName, fileSize, mimeType, totalChunks);
    chan.onerror = () => { window.onTransferError?.(tid, 'Channel error'); this._cleanup(sid); };

    // ── Create & send offer ─────────────────────────────────────────────
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this._waitICE(peer);

      const resp = await window.api.sendSignal(device.ip, device.port, '/signal', {
        type: 'offer',
        sdp:  peer.localDescription.sdp,
        meta: { tid, fileName, fileSize, totalChunks, mimeType, sender: window._myDevice?.name }
      });

      if (!resp || resp.error) throw new Error(resp?.error || 'No answer');
      await peer.setRemoteDescription({ type: 'answer', sdp: resp.sdp });

    } catch (err) {
      window.onTransferError?.(tid, err.message);
      this._cleanup(sid);
      return;
    }
  }

  /* ── Pump file data over DataChannel with flow control ─────────────────── */
  async _sendFileData(chan, tid, buffer, name, size, mimeType, totalChunks) {
    if (this.cancelled.has(tid)) return;

    chan.send(JSON.stringify({ type: 'file-meta', tid, name, size, mimeType, totalChunks }));

    let offset = 0, index = 0;

    const sendNextChunk = () => {
      if (this.cancelled.has(tid)) { chan.close(); return; }

      while (offset < buffer.byteLength) {
        if (chan.bufferedAmount > BUFFER_HIGH) {
          chan.bufferedAmountLowThreshold = BUFFER_LOW;
          chan.onbufferedamountlow = () => { chan.onbufferedamountlow = null; sendNextChunk(); };
          return;
        }
        const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
        chan.send(JSON.stringify({ type: 'chunk', tid, index }));
        chan.send(chunk);
        offset += chunk.byteLength;
        index++;
        window.onSendProgress?.(tid, offset, size);
      }

      chan.send(JSON.stringify({ type: 'file-done', tid }));
      window.onSendDone?.(tid);
    };

    sendNextChunk();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INITIATOR — send clipboard text
  ═══════════════════════════════════════════════════════════════════════ */
  async sendClipText(device, text) {
    const sid  = genId();
    const peer = this._createPeer();
    const chan  = peer.createDataChannel('lb');

    this.sessions.set(sid, { peer, channel: chan, role: 'initiator', device });

    // ── Register channel handlers BEFORE signaling to avoid race on fast LAN ──
    const openTimeout = setTimeout(() => {
      window.onClipError?.(`Could not connect to ${device.alias || device.name} — check firewall`);
      this._cleanup(sid);
    }, 12000);

    chan.onopen = () => {
      clearTimeout(openTimeout);
      chan.send(JSON.stringify({ type: 'clip', text, sender: window._myDevice?.name }));
      setTimeout(() => { try { chan.close(); } catch {} this._cleanup(sid); }, 2000);
    };

    chan.onerror = () => {
      clearTimeout(openTimeout);
      window.onClipError?.(`Connection error with ${device.alias || device.name}`);
      this._cleanup(sid);
    };

    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this._waitICE(peer);

      const resp = await window.api.sendSignal(device.ip, device.port, '/signal', {
        type: 'offer',
        sdp:  peer.localDescription.sdp,
        meta: { isClip: true, sender: window._myDevice?.name }
      });

      if (!resp || resp.error) throw new Error(resp?.error || 'No answer');
      await peer.setRemoteDescription({ type: 'answer', sdp: resp.sdp });

    } catch (err) {
      clearTimeout(openTimeout);
      window.onClipError?.(`Failed to reach ${device.alias || device.name}: ${err.message}`);
      this._cleanup(sid);
      return;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RECEIVER — handle incoming offer from remote device
  ═══════════════════════════════════════════════════════════════════════ */
  async handleIncoming(url, data) {
    if (url === '/ping' || data?.type === 'ping') {
      return { type: 'pong', ok: true };
    }
    if (data?.type !== 'offer') {
      return { error: 'unknown signal type' };
    }

    const sid  = genId();
    const peer = this._createPeer();
    this.sessions.set(sid, { peer, role: 'receiver', meta: data.meta });

    peer.ondatachannel = e => {
      const chan = e.channel;
      this.sessions.get(sid).channel = chan;
      this._attachReceiverHandlers(chan, sid, data.meta);
    };

    try {
      await peer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await this._waitICE(peer);
      return { type: 'answer', sdp: peer.localDescription.sdp };
    } catch (err) {
      this._cleanup(sid);
      return { error: err.message };
    }
  }

  /* ── Attach message handlers on receiver DataChannel ─────────────────── */
  _attachReceiverHandlers(chan, sid, meta) {
    let currentTid    = null;
    let expectedChunk = 0;

    chan.onmessage = e => {
      const data = e.data;

      // ── Binary chunk payload ──────────────────────────────────────────
      if (data instanceof ArrayBuffer || data instanceof Blob) {
        const processBuffer = async (buf) => {
          if (!currentTid) return;
          const st = this.inbound.get(currentTid);
          if (!st) return;
          st.chunks.push(buf);
          st.received += buf.byteLength;
          expectedChunk++;
          window.onTransferProgress?.(currentTid, st.received, st.total);
        };
        if (data instanceof Blob) data.arrayBuffer().then(processBuffer).catch(err => console.error('[WebRTC] Blob read failed:', err));
        else processBuffer(data);
        return;
      }

      // ── JSON control message ──────────────────────────────────────────
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      switch (msg.type) {

        case 'file-meta': {
          currentTid    = msg.tid;
          expectedChunk = 0;
          this.inbound.set(msg.tid, {
            chunks: [], received: 0,
            total: msg.size,
            name: msg.name,
            mimeType: msg.mimeType || getMimeType(msg.name),
            totalChunks: msg.totalChunks
          });
          window.onTransferStart?.({
            id: msg.tid, sessionId: sid,
            name: msg.name, total: msg.size, done: 0,
            direction: 'recv', status: 'active',
            mimeType: msg.mimeType || getMimeType(msg.name),
            deviceName: meta?.sender || 'Unknown'
          });
          break;
        }

        case 'chunk': {
          currentTid = msg.tid;
          break;
        }

        case 'file-done': {
          const st = this.inbound.get(msg.tid);
          if (!st) break;
          this._reassemble(msg.tid, st);
          this.inbound.delete(msg.tid);
          currentTid = null;
          break;
        }

        case 'clip': {
          window.onClipReceived?.(msg.text, msg.sender || 'Unknown');
          setTimeout(() => { try { chan.close(); } catch {} this._cleanup(sid); }, 500);
          break;
        }

        case 'pong': break;
      }
    };

    chan.onerror = () => {
      if (currentTid) window.onTransferError?.(currentTid, 'Connection lost');
      this._cleanup(sid);
    };
    chan.onclose = () => this._cleanup(sid);
  }

  /* ── Reassemble received chunks ───────────────────────────────────────── */
  async _reassemble(tid, st) {
    try {
      const total  = st.chunks.reduce((s, c) => s + c.byteLength, 0);
      const merged = new Uint8Array(total);
      let   off    = 0;
      for (const chunk of st.chunks) { merged.set(new Uint8Array(chunk), off); off += chunk.byteLength; }

      // Chunked btoa to avoid call-stack overflow on large files
      let base64 = '';
      const BTOA_CHUNK = 8192;
      for (let i = 0; i < merged.length; i += BTOA_CHUNK) {
        base64 += btoa(String.fromCharCode(...merged.subarray(i, i + BTOA_CHUNK)));
      }
      window.onTransferDone?.(tid, base64, st.mimeType);
    } catch (err) {
      window.onTransferError?.(tid, 'Reassembly failed: ' + err.message);
    }
  }

  /* ── Cancel an in-flight transfer ─────────────────────────────────────── */
  cancelTransfer(tid) {
    this.cancelled.add(tid);
    setTimeout(() => this.cancelled.delete(tid), 10000);
  }

  /* ── Cleanup a session ────────────────────────────────────────────────── */
  _cleanup(sid) {
    const s = this.sessions.get(sid);
    if (!s) return;
    try { s.channel?.close(); } catch {}
    try { s.peer?.close(); }    catch {}
    this.sessions.delete(sid);
  }
}

/* Expose as global */
window.rtc = new RTCManager();

/* Store device info once available */
(async () => {
  try { window._myDevice = await window.api.getDeviceInfo(); }
  catch (e) { console.error('[WebRTC] Failed to load device info:', e); }
})();
