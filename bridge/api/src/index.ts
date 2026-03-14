/**
 * Campfire Bridge API Server
 *
 * Exposes the REST API that the Campfire iOS app connects to.
 * Controls librespot (Spotify Connect) via playerctl/MPRIS and
 * manages Bluetooth speakers via bluetoothctl.
 *
 * All routes match the contract in app/src/context/BridgeContext.tsx.
 */

import express from 'express';
import cors from 'cors';
import * as playerctl from './playerctl';
import * as bluetooth from './bluetooth';
import { LibrespotManager } from './librespot';
import type { BridgeStatus, BluetoothDevice } from './types';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const DEVICE_NAME = process.env.DEVICE_NAME ?? 'Campfire';

app.use(cors());
app.use(express.json());

// ── State cache ───────────────────────────────────────────────────────────────
// Updated by librespot event hooks and periodic position polling.

const state: BridgeStatus = {
  device:    DEVICE_NAME,
  connected: false,
  playing:   false,
  track: {
    title:       '',
    artist:      '',
    position_ms: 0,
    duration_ms: 0,
  },
  volume: 50,
};

// ── Librespot ─────────────────────────────────────────────────────────────────

const librespot = new LibrespotManager(DEVICE_NAME, PORT);
librespot.start();
state.connected = true;

// ── Internal event hook ───────────────────────────────────────────────────────
// librespot calls event-hook.sh which POSTs here. Not exposed publicly.

app.post('/internal/event', (req, res) => {
  const { event, name, artists, duration_ms, position_ms } = req.body as {
    event: string;
    name?: string;
    artists?: string;
    duration_ms?: string;
    position_ms?: string;
  };

  switch (event) {
    case 'playing':
      state.playing = true;
      state.connected = true;
      if (name)        state.track.title      = name;
      if (artists)     state.track.artist     = artists;
      if (duration_ms) state.track.duration_ms = parseInt(duration_ms, 10);
      if (position_ms) state.track.position_ms = parseInt(position_ms, 10);
      break;

    case 'paused':
      state.playing = false;
      if (position_ms) state.track.position_ms = parseInt(position_ms, 10);
      break;

    case 'stopped':
      state.playing = false;
      break;

    case 'changed':
      // New track started
      if (name)        state.track.title       = name;
      if (artists)     state.track.artist      = artists;
      if (duration_ms) state.track.duration_ms = parseInt(duration_ms, 10);
      state.track.position_ms = 0;
      state.playing = true;
      break;

    case 'volume_set':
      // librespot reports volume 0–100
      if (position_ms) state.volume = parseInt(position_ms, 10); // env var reuse
      break;
  }

  res.json({ ok: true });
});

// ── Position polling ──────────────────────────────────────────────────────────
// Advance position_ms every second while playing, and sync from playerctl.

setInterval(async () => {
  if (!state.playing) return;
  try {
    state.track.position_ms = await playerctl.getPosition();
  } catch {
    // librespot may not be active yet — just advance locally
    state.track.position_ms = Math.min(
      state.track.position_ms + 1000,
      state.track.duration_ms,
    );
  }
}, 1000);

// ── Public API routes ─────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  res.json(state);
});

app.post('/api/play', async (_req, res) => {
  try {
    await playerctl.play();
    state.playing = true;
    res.json({ ok: true, status: state });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/pause', async (_req, res) => {
  try {
    await playerctl.pause();
    state.playing = false;
    res.json({ ok: true, status: state });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/next', async (_req, res) => {
  try {
    await playerctl.next();
    state.playing = true;
    res.json({ ok: true, status: state });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/previous', async (_req, res) => {
  try {
    await playerctl.previous();
    state.playing = true;
    res.json({ ok: true, status: state });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/seek', async (req, res) => {
  const { position_ms } = req.body as { position_ms?: number };
  if (position_ms === undefined || isNaN(Number(position_ms))) {
    return res.status(400).json({ error: 'position_ms is required' });
  }
  try {
    await playerctl.seek(Number(position_ms));
    state.track.position_ms = Number(position_ms);
    res.json({ ok: true, status: state });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/volume', async (req, res) => {
  const { volume } = req.body as { volume?: number };
  if (volume === undefined || isNaN(Number(volume))) {
    return res.status(400).json({ error: 'volume is required' });
  }
  const clamped = Math.max(0, Math.min(100, Number(volume)));
  try {
    await playerctl.setVolume(clamped);
    state.volume = clamped;
    res.json({ ok: true, status: state });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/connect', (_req, res) => {
  librespot.start();
  state.connected = true;
  res.json({ ok: true, status: state });
});

app.post('/api/disconnect', (_req, res) => {
  librespot.stop();
  state.connected = false;
  state.playing   = false;
  res.json({ ok: true, status: state });
});

// ── Bluetooth routes ──────────────────────────────────────────────────────────

app.get('/api/bt/devices', async (_req, res) => {
  try {
    const devices: BluetoothDevice[] = await bluetooth.listDevices();
    res.json({ devices });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/bt/connect', async (req, res) => {
  const { mac } = req.body as { mac?: string };
  if (!mac) return res.status(400).json({ error: 'mac is required' });
  try {
    await bluetooth.connectDevice(mac);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/bt/disconnect', async (req, res) => {
  const { mac } = req.body as { mac?: string };
  if (!mac) return res.status(400).json({ error: 'mac is required' });
  try {
    await bluetooth.disconnectDevice(mac);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── Export for testing ────────────────────────────────────────────────────────
export default app;

// ── Start (only when run directly, not when imported by tests) ────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Campfire Bridge listening on port ${PORT}`);
  });
}
