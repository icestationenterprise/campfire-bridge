/**
 * mock-bridge.js
 * Simulates the Raspberry Pi bridge API for local development.
 * Run with: npm run mock
 * Listens on http://localhost:3000
 */
const express = require('express');
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ── In-memory state ──────────────────────────────────────────────────────────

let status = {
  device: 'Mock Bridge',
  connected: true,
  playing: false,
  track: { title: '—', artist: '—', position_ms: 0, duration_ms: 180000 },
  volume: 60,
};

const btDevices = [
  { mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room Speaker', connected: true },
  { mac: 'AA:BB:CC:DD:EE:02', name: 'Bedroom Speaker',     connected: false },
];

// Advance playhead every second while playing
setInterval(() => {
  if (status.playing) {
    status.track.position_ms += 1000;
    if (status.track.position_ms >= status.track.duration_ms) {
      status.track.position_ms = 0;
      status.playing = false;
    }
  }
}, 1000);

// ── Helpers ──────────────────────────────────────────────────────────────────

function nextTrack(title, artist, duration = 210000) {
  status.track = { title, artist, position_ms: 0, duration_ms: duration };
  status.playing = true;
}

// ── Status ───────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => res.json(status));

// ── Playback controls (individual routes, matching BridgeContext) ─────────────

app.post('/api/play', (_req, res) => {
  status.playing = true;
  res.json({ ok: true, status });
});

app.post('/api/pause', (_req, res) => {
  status.playing = false;
  res.json({ ok: true, status });
});

app.post('/api/next', (_req, res) => {
  nextTrack('Next Track', 'Mock Artist');
  res.json({ ok: true, status });
});

app.post('/api/previous', (_req, res) => {
  nextTrack('Previous Track', 'Mock Artist');
  res.json({ ok: true, status });
});

app.post('/api/seek', (req, res) => {
  const position_ms = Number(req.body?.position_ms);
  if (!Number.isFinite(position_ms)) return res.status(400).json({ error: 'position_ms required' });
  status.track.position_ms = Math.max(0, Math.min(position_ms, status.track.duration_ms));
  res.json({ ok: true, status });
});

app.post('/api/volume', (req, res) => {
  const volume = Number(req.body?.volume ?? req.body?.level);
  if (!Number.isFinite(volume)) return res.status(400).json({ error: 'volume required' });
  status.volume = Math.max(0, Math.min(100, volume));
  res.json({ ok: true, status });
});

// Bridge connect/disconnect (bridge-level, not BT)
app.post('/api/connect', (_req, res) => {
  status.connected = true;
  res.json({ ok: true, status });
});

app.post('/api/disconnect', (_req, res) => {
  status.connected = false;
  res.json({ ok: true, status });
});

// ── Bluetooth device management ───────────────────────────────────────────────

app.get('/api/bt/devices', (_req, res) => res.json({ devices: btDevices }));

app.post('/api/bt/connect', (req, res) => {
  const { mac } = req.body || {};
  const dev = btDevices.find(d => d.mac === mac);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  dev.connected = true;
  res.json({ ok: true, device: dev });
});

app.post('/api/bt/disconnect', (req, res) => {
  const { mac } = req.body || {};
  const dev = btDevices.find(d => d.mac === mac);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  dev.connected = false;
  res.json({ ok: true, device: dev });
});

app.post('/api/bt/pair', (req, res) => {
  const { mac } = req.body || {};
  if (!mac) return res.status(400).json({ error: 'mac required' });
  const exists = btDevices.find(d => d.mac === mac);
  if (!exists) btDevices.push({ mac, name: `Device ${mac}`, connected: false });
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => console.log(`Mock bridge listening on http://localhost:${PORT}`));

module.exports = app; // exported for tests
