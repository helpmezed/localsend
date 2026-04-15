# LocalBeam

Instant peer-to-peer file & clipboard transfer — no cloud, no accounts.
Premium bento-box UI with glassmorphism, spring animations, and a live radar.

## Quick start

```bash
npm install
npm start          # launch the app
npm run dev        # launch with DevTools open
```

## How it works

| Layer | Technology |
|---|---|
| Desktop shell | Electron 28 |
| Device discovery | UDP multicast `224.0.0.251:53317` — broadcasts every 2 s |
| Signaling | Tiny HTTP server `0.0.0.0:53318` — one round-trip offer/answer |
| Transfer | WebRTC DataChannel (64 KB chunks, flow-controlled) |
| Clipboard sync | WebRTC DataChannel (JSON message) |

## Usage

1. Open LocalBeam on two or more devices **on the same Wi-Fi / LAN**
2. Devices appear automatically in the radar panel within 2–3 seconds
3. **Send a file**: drag it onto the drop zone → click the target device chip
4. **Send clipboard**: type or paste text → click **Send**
5. Right-click any device for ping / rename / remove options

## Building a Windows installer

```bash
npm run build
# Produces dist/LocalBeam Setup x.x.x.exe
```
