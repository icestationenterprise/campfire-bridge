/**
 * mock-bridge.js
 * Simulates the Raspberry Pi bridge API for local development.
 * Run with: npm run mock
 * Listens on http://localhost:3000
 *
 * Mirrors bridge/api/src/index.ts: no playback routes (AirPlay/Cast handle
 * playback on-device) — just device status, Bluetooth management, and
 * party mode (which also represents AirPlay being active).
 */
const express = require('express');
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ── In-memory state ──────────────────────────────────────────────────────────

const btDevices = [
  { mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room Speaker', connected: true },
  { mac: 'AA:BB:CC:DD:EE:02', name: 'Bedroom Speaker',     connected: false },
];

let party = { active: false, speakers: [] };

function status() {
  return { device: 'Mock Bridge', party };
}

// ── Status ───────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => res.json(status()));

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

app.post('/api/bt/scan', (_req, res) => {
  res.json({ devices: btDevices.map(d => ({ mac: d.mac, name: d.name, paired: true })) });
});

app.delete('/api/bt/devices/:mac', (req, res) => {
  const idx = btDevices.findIndex(d => d.mac === req.params.mac);
  if (idx !== -1) btDevices.splice(idx, 1);
  res.json({ ok: true });
});

// ── Party mode + AirPlay ───────────────────────────────────────────────────────
// Enabling party mode also represents AirPlay turning on (no separate toggle —
// see bridge/api/src/index.ts POST /api/party/enable|disable).

app.get('/api/party', (_req, res) => res.json(party));

app.post('/api/party/enable', (req, res) => {
  const { macs } = req.body || {};
  if (!Array.isArray(macs) || macs.length === 0) {
    return res.status(400).json({ error: 'macs array is required' });
  }
  party = {
    active: true,
    speakers: macs.map(mac => {
      const existing = party.speakers.find(s => s.mac === mac);
      return existing ?? { mac, volume: 80, muted: false, calibration_ms: 0 };
    }),
  };
  res.json({ ok: true, party });
});

app.post('/api/party/disable', (_req, res) => {
  party = { active: false, speakers: [] };
  res.json({ ok: true, party });
});

app.post('/api/party/speaker/volume', (req, res) => {
  const { mac, volume } = req.body || {};
  const s = party.speakers.find(s => s.mac === mac);
  if (s) s.volume = volume;
  res.json({ ok: true, party });
});

app.post('/api/party/speaker/mute', (req, res) => {
  const { mac, muted } = req.body || {};
  const s = party.speakers.find(s => s.mac === mac);
  if (s) s.muted = muted;
  res.json({ ok: true, party });
});

app.post('/api/party/volume', (req, res) => {
  const { volume } = req.body || {};
  party.speakers.forEach(s => { s.volume = volume; });
  res.json({ ok: true, party });
});

app.post('/api/party/volume/shift', (req, res) => {
  const { delta } = req.body || {};
  party.speakers.forEach(s => { s.volume = Math.max(0, Math.min(100, s.volume + delta)); });
  res.json({ ok: true, party });
});

app.post('/api/party/mute', (req, res) => {
  const { muted } = req.body || {};
  party.speakers.forEach(s => { s.muted = muted; });
  res.json({ ok: true, party });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => console.log(`Mock bridge listening on http://localhost:${PORT}`));

module.exports = app; // exported for tests
