/**
 * Campfire Bridge API Server
 *
 * Exposes the REST API that the Campfire app connects to.
 * Audio playback comes entirely from AirPlay (iOS) / Cast (Android) sessions
 * initiated on the phone — this server does not control playback itself.
 * It manages Bluetooth speaker pairing/connection (BlueZ), the multi-speaker
 * party sink (PulseAudio), and starts/stops the AirPlay receiver
 * (shairport-sync) alongside party mode — see /api/party/enable|disable.
 *
 * All routes match the contract in app/src/context/BridgeContext.tsx.
 *
 * This process is an appliance daemon: it must never exit because of one bad
 * request. Every route is wrapped so a thrown error becomes a JSON 500, and
 * unhandled rejections are logged rather than fatal.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import * as bluetooth from './bluetooth';
import * as party     from './party';
import * as airplay   from './airplay';
import * as network   from './network';
import type { BridgeStatus } from './types';

const PORT        = parseInt(process.env.PORT ?? '3000', 10);
const DEVICE_NAME = process.env.DEVICE_NAME ?? 'Campfire';

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));

bluetooth.setPartyActiveProbe(party.isActive);

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
/** Express 4 does not catch async errors; route them to the error handler. */
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

const isMac = (v: unknown): v is string => typeof v === 'string' && /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A party member: a Bluetooth MAC or the built-in speaker id. */
const isSpeaker = (v: unknown): v is string => isMac(v) || v === party.BUILTIN_ID;

// ── Status ────────────────────────────────────────────────────────────────────

app.get('/api/status', route((_req, res) => {
  const status: BridgeStatus = {
    device:       DEVICE_NAME,
    party:        party.getPartyStatus(),
    network_mode: network.readNetworkMode(),
  };
  res.json(status);
}));

// ── Bluetooth device management ───────────────────────────────────────────────

app.get('/api/bt/devices', route(async (_req, res) => {
  res.json({ devices: await bluetooth.listDevices() });
}));

app.post('/api/bt/connect', route(async (req, res) => {
  const { mac } = req.body as { mac?: unknown };
  if (!isMac(mac)) return res.status(400).json({ error: 'mac is required' });
  try {
    await bluetooth.connectDevice(mac);
  } catch (e) {
    // Connect failures are the one error a customer actually sees, so return a
    // reason the app can act on instead of a raw BlueZ string. `error` stays as
    // the technical message for logs and older app builds.
    if (e instanceof bluetooth.ConnectError) {
      console.error(`[api] connect ${mac} failed (${e.reason}): ${e.raw}`);
      return res.status(502).json({ error: e.message, reason: e.reason, userMessage: e.userMessage, action: e.action });
    }
    throw e;
  }
  // Wait for PulseAudio to expose the sink, then add it to a running party
  // (or make it the default output). Doing this before responding means the
  // app's "connected" state is also "audible".
  await party.onSpeakerConnected(mac);
  res.json({ ok: true, party: party.getPartyStatus() });
}));

app.post('/api/bt/disconnect', route(async (req, res) => {
  const { mac } = req.body as { mac?: unknown };
  if (!isMac(mac)) return res.status(400).json({ error: 'mac is required' });
  await party.removeSpeakerFromParty(mac);
  await bluetooth.disconnectDevice(mac);
  res.json({ ok: true, party: party.getPartyStatus() });
}));

// ── Bluetooth scan & pair ─────────────────────────────────────────────────────

/**
 * Discover nearby speakers. Inquiry runs only on radios with no connected
 * speaker and never during party mode — in that case the known list is
 * returned and `scanned` is false.
 */
app.post('/api/bt/scan', route(async (_req, res) => {
  res.json(await bluetooth.scanDevices());
}));

app.delete('/api/bt/devices/:mac', route(async (req, res) => {
  const { mac } = req.params;
  if (!isMac(mac)) return res.status(400).json({ error: 'invalid mac' });
  await party.removeSpeakerFromParty(mac);
  await bluetooth.removeDevice(mac);
  res.json({ ok: true });
}));

/**
 * Pair (and trust) a new speaker, then connect it. Connecting is best-effort —
 * pairing success is returned regardless.
 */
app.post('/api/bt/pair', route(async (req, res) => {
  const { mac } = req.body as { mac?: unknown };
  if (!isMac(mac)) return res.status(400).json({ error: 'mac is required' });
  await bluetooth.pairDevice(mac);
  try {
    await bluetooth.connectDevice(mac);
    await party.onSpeakerConnected(mac);
  } catch (e) {
    console.warn(`[api] paired ${mac} but auto-connect failed: ${(e as Error).message}`);
  }
  res.json({ ok: true, party: party.getPartyStatus() });
}));

// ── Adapter status ────────────────────────────────────────────────────────────

/** All detected BT adapters and the speakers bonded to each. */
app.get('/api/adapters', route(async (_req, res) => {
  res.json(await bluetooth.getAdapterStatus());
}));

// ── Party mode + AirPlay ──────────────────────────────────────────────────────
// Party mode is the audio path: enabling it loads the campfire_party sink
// (one loopback per speaker) and starts shairport-sync so the bridge appears
// as an AirPlay target. Audio from the phone flows into campfire_party and is
// distributed to all speakers in sync. Disabling stops AirPlay and tears the
// sink down.

app.get('/api/party', route((_req, res) => {
  res.json(party.getPartyStatus());
}));

app.post('/api/party/enable', route(async (req, res) => {
  const { macs } = req.body as { macs?: unknown };
  if (!Array.isArray(macs) || macs.length === 0 || !macs.every(isSpeaker)) {
    return res.status(400).json({ error: 'macs array is required' });
  }
  await party.enablePartyMode(macs);
  await airplay.startAirplay();
  res.json({ ok: true, party: party.getPartyStatus() });
}));

app.post('/api/party/disable', route(async (_req, res) => {
  await airplay.stopAirplay();
  await party.disablePartyMode();
  res.json({ ok: true, party: party.getPartyStatus() });
}));

/**
 * Set the loopback buffer size for a speaker in ms. Persisted — used on every
 * subsequent attach. Applied live if the speaker is in the party.
 */
app.post('/api/party/speaker/latency', route(async (req, res) => {
  const { mac, latency_ms } = req.body as { mac?: unknown; latency_ms?: unknown };
  if (!isSpeaker(mac) || !isNum(latency_ms)) {
    return res.status(400).json({ error: 'mac and latency_ms are required' });
  }
  await party.setSpeakerLatency(mac, latency_ms);
  res.json({ ok: true, calibration: party.getLatencyCalibration(), party: party.getPartyStatus() });
}));

app.get('/api/party/calibration', route((_req, res) => {
  res.json(party.getLatencyCalibration());
}));

/**
 * Nudge a speaker's sync by delta_ms (positive = more delay, negative = earlier).
 * Saves calibration and re-times only that speaker's loopback — the rest of the
 * party, and the AirPlay stream, are untouched. Used by the Earlier/Later buttons.
 */
app.post('/api/party/speaker/sync', route(async (req, res) => {
  const { mac, delta_ms } = req.body as { mac?: unknown; delta_ms?: unknown };
  if (!isSpeaker(mac) || !isNum(delta_ms)) {
    return res.status(400).json({ error: 'mac and delta_ms are required' });
  }
  await party.nudgeSpeakerSync(mac, delta_ms);
  res.json({ ok: true, calibration: party.getLatencyCalibration(), party: party.getPartyStatus() });
}));

app.post('/api/party/speaker/volume', route(async (req, res) => {
  const { mac, volume } = req.body as { mac?: unknown; volume?: unknown };
  if (!isSpeaker(mac) || !isNum(volume)) return res.status(400).json({ error: 'mac and volume are required' });
  await party.setSpeakerVolume(mac, volume);
  res.json({ ok: true, party: party.getPartyStatus() });
}));

app.post('/api/party/speaker/mute', route(async (req, res) => {
  const { mac, muted } = req.body as { mac?: unknown; muted?: unknown };
  if (!isSpeaker(mac) || typeof muted !== 'boolean') return res.status(400).json({ error: 'mac and muted are required' });
  await party.setSpeakerMuted(mac, muted);
  res.json({ ok: true, party: party.getPartyStatus() });
}));

/** Shift every speaker's volume by delta points (preserves relative differences). */
app.post('/api/party/volume/shift', route(async (req, res) => {
  const { delta } = req.body as { delta?: unknown };
  if (!isNum(delta)) return res.status(400).json({ error: 'delta is required' });
  await party.shiftGroupVolume(delta);
  res.json({ ok: true, party: party.getPartyStatus() });
}));

app.post('/api/party/mute', route(async (req, res) => {
  const { muted } = req.body as { muted?: unknown };
  if (typeof muted !== 'boolean') return res.status(400).json({ error: 'muted is required' });
  await party.setGroupMuted(muted);
  res.json({ ok: true, party: party.getPartyStatus() });
}));

app.post('/api/party/volume', route(async (req, res) => {
  const { volume } = req.body as { volume?: unknown };
  if (!isNum(volume)) return res.status(400).json({ error: 'volume is required' });
  await party.setGroupVolume(volume);
  res.json({ ok: true, party: party.getPartyStatus() });
}));

// ── Network mode switching ────────────────────────────────────────────────────
// Writes a request file that camping-mode.sh picks up on its next tick. The
// daemon handles the nmcli calls so the API doesn't need sudo.

app.post('/api/network/mode', route((req, res) => {
  const { mode } = req.body as { mode?: unknown };
  if (mode !== 'home' && mode !== 'camping') {
    return res.status(400).json({ error: 'mode must be "home" or "camping"' });
  }
  network.requestNetworkMode(mode);
  res.json({ ok: true, requested: mode });
}));

// ── Errors ────────────────────────────────────────────────────────────────────

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[api] ${req.method} ${req.path} failed:`, err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message });
});

export default app;

// ── Startup (only when run directly, not when imported by tests) ──────────────

/**
 * Recover audio state after a restart. PulseAudio forgets BT profiles when it
 * restarts, and the bridge forgets its party when *it* restarts — but PulseAudio
 * usually still has the graph. Adopt it, then make sure connected speakers are
 * on A2DP and something sensible is the default sink.
 */
async function recoverOnStartup(): Promise<void> {
  const adopted = await party.adoptExistingGraph();
  if (adopted) await airplay.startAirplay().catch(() => {});

  const devices   = await bluetooth.listDevices();
  const connected = devices.filter(d => d.connected).map(d => d.mac);
  for (const mac of connected) await party.ensureA2dp(mac);
  await party.chooseDefaultSink(connected);
  console.log(`[startup] ${connected.length} speaker(s) connected, party ${adopted ? 'adopted' : 'inactive'}`);
}

if (require.main === module) {
  process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandled rejection:', reason instanceof Error ? reason.stack : reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[process] uncaught exception:', err.stack ?? err.message);
  });

  const server = app.listen(PORT, () => {
    console.log(`Campfire Bridge listening on port ${PORT}`);
  });

  setTimeout(() => { recoverOnStartup().catch(e => console.error('[startup] recovery failed:', e)); }, 5_000);

  const shutdown = (signal: string) => {
    console.log(`[process] ${signal} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}
