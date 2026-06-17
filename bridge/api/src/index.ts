/**
 * Campfire Bridge API Server
 *
 * Exposes the REST API that the Campfire app connects to.
 * Audio playback comes entirely from AirPlay (iOS) / Cast (Android) sessions
 * initiated on the phone — this server does not control playback itself.
 * It manages Bluetooth speaker pairing/connection (bluetoothctl) and the
 * multi-speaker party sink (PulseAudio), and starts/stops the AirPlay
 * receiver (shairport-sync) alongside party mode — see /api/party/enable|disable.
 *
 * All routes match the contract in app/src/context/BridgeContext.tsx.
 */

import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync } from 'fs';
import * as bluetooth from './bluetooth';
import * as adapters  from './adapters';
import * as party from './party';
import * as airplay from './airplay';
import type { BridgeStatus, BluetoothDevice } from './types';

const NETWORK_MODE_FILE   = '/tmp/campfire-network-mode';
const NETWORK_MODE_REQUEST = '/tmp/campfire-mode-request';

function readNetworkMode(): 'home' | 'camping' {
  try {
    const raw = readFileSync(NETWORK_MODE_FILE, 'utf8').trim();
    return raw === 'camping' ? 'camping' : 'home';
  } catch {
    return 'home';
  }
}

const app = express();
const PORT        = parseInt(process.env.PORT ?? '3000', 10);
const DEVICE_NAME = process.env.DEVICE_NAME ?? 'Campfire';

app.use(cors());
app.use(express.json());

// ── State cache ───────────────────────────────────────────────────────────────

const state: BridgeStatus = {
  device:       DEVICE_NAME,
  party:        { active: false, speakers: [] },
  network_mode: 'home',
};

// ── Startup audio recovery ────────────────────────────────────────────────────
// PulseAudio forgets BT profiles on restart. After a short delay (to let
// PulseAudio finish loading), find any already-connected speakers and force
// them onto A2DP so audio works without user intervention.
setTimeout(async () => {
  try {
    const devices      = await bluetooth.listDevices();
    const connectedMacs = devices.filter(d => d.connected).map(d => d.mac);
    // Rebuild adapter assignments lost when the bridge restarted
    await adapters.rehydrateAssignments(connectedMacs);
    // Re-apply A2DP profile and default sink for each connected speaker
    for (const mac of connectedMacs) {
      await party.setDefaultAudioSink(mac);
    }
  } catch { /* ignore startup errors */ }
}, 5000);

// ── Status ────────────────────────────────────────────────────────────────────

app.get('/api/status', async (_req, res) => {
  state.party        = party.getPartyStatus();
  state.network_mode = readNetworkMode();
  res.json(state);
});

// ── Bluetooth device management ───────────────────────────────────────────────

app.get('/api/bt/devices', async (_req, res) => {
  try {
    const devices: BluetoothDevice[] = await bluetooth.listDevices();
    res.json({ devices });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post('/api/bt/connect', async (req, res) => {
  const { mac } = req.body as { mac?: string };
  if (!mac) return res.status(400).json({ error: 'mac is required' });
  try {
    await adapters.connectDevice(mac);
    // Give PulseAudio 2 s to register the new sink, then force A2DP + default.
    setTimeout(() => party.setDefaultAudioSink(mac).catch(() => {}), 2000);
    // If party is active, auto-add this speaker so the user doesn't have
    // to manually restart the party after connecting a new device.
    if (party.getPartyStatus().active) {
      await party.addSpeakerToParty(mac);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post('/api/bt/disconnect', async (req, res) => {
  const { mac } = req.body as { mac?: string };
  if (!mac) return res.status(400).json({ error: 'mac is required' });
  try {
    await adapters.disconnectDevice(mac);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── Bluetooth scan & pair ─────────────────────────────────────────────────────

/**
 * Scan for nearby Bluetooth devices (including unpaired ones).
 * Blocks for ~5 s while the adapter discovers devices.
 */
app.post('/api/bt/scan', async (_req, res) => {
  try {
    // Never run inquiry while party mode is active — scanning on a streaming
    // adapter interleaves discovery packets with A2DP data, causing audio dropouts.
    // Return the known paired device list instead (no radio activity needed).
    if (party.getPartyStatus().active) {
      const devices = await bluetooth.listDevices();
      return res.json({ devices: devices.map(d => ({ mac: d.mac, name: d.name, paired: true })) });
    }
    const devices = await bluetooth.scanDevices(10);
    res.json({ devices });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.delete('/api/bt/devices/:mac', async (req, res) => {
  const { mac } = req.params;
  try {
    await adapters.removeDevice(mac);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

/**
 * Pair (and trust) a new Bluetooth device, then auto-connect it.
 * Auto-connect is best-effort — pairing success is returned regardless.
 */
app.post('/api/bt/pair', async (req, res) => {
  const { mac } = req.body as { mac?: string };
  if (!mac) return res.status(400).json({ error: 'mac is required' });
  try {
    await adapters.pairDevice(mac);
    // Auto-connect so the device appears immediately in the paired list
    try {
      await adapters.connectDevice(mac);
      setTimeout(() => party.setDefaultAudioSink(mac).catch(() => {}), 2000);
      if (party.getPartyStatus().active) {
        await party.addSpeakerToParty(mac);
      }
    } catch { /* connect is best-effort; device may be out of range */ }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── Adapter status ────────────────────────────────────────────────────────────

/** Returns all detected BT adapters and which speaker is assigned to each. */
app.get('/api/adapters', async (_req, res) => {
  try {
    res.json(await adapters.getStatus());
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── Party mode + AirPlay ──────────────────────────────────────────────────────
// Party mode is the only audio path now that librespot is gone: enabling it
// loads the campfire_party sink (with one loopback per speaker) and starts
// shairport-sync so the bridge appears as an AirPlay target. Audio from any
// app on the phone flows into campfire_party and is distributed to all
// speakers in sync. Disabling stops AirPlay and tears the sink down.

app.get('/api/party', (_req, res) => {
  res.json(party.getPartyStatus());
});

app.post('/api/party/enable', async (req, res) => {
  const { macs } = req.body as { macs?: string[] };
  if (!Array.isArray(macs) || macs.length === 0) {
    return res.status(400).json({ error: 'macs array is required' });
  }
  try {
    await party.enablePartyMode(macs);
    await airplay.startAirplay();
    res.json({ ok: true, party: party.getPartyStatus() });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post('/api/party/disable', async (_req, res) => {
  try {
    await airplay.stopAirplay();
    await party.disablePartyMode();
    res.json({ ok: true, party: party.getPartyStatus() });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

/**
 * Set the loopback buffer size for a speaker in ms.
 * Persisted to disk — used on every subsequent party mode start.
 * Increase to delay a speaker; decrease to advance it.
 */
app.post('/api/party/speaker/latency', (req, res) => {
  const { mac, latency_ms } = req.body as { mac?: string; latency_ms?: number };
  if (!mac || latency_ms === undefined || isNaN(Number(latency_ms))) {
    return res.status(400).json({ error: 'mac and latency_ms are required' });
  }
  party.setLatencyCalibration(mac, Number(latency_ms));
  res.json({ ok: true, calibration: party.getLatencyCalibration() });
});

/** Get current per-speaker latency calibration. */
app.get('/api/party/calibration', (_req, res) => {
  res.json(party.getLatencyCalibration());
});

/**
 * Nudge a speaker's sync by delta_ms (positive = more delay, negative = earlier).
 * Saves calibration and immediately restarts party mode to apply.
 * Used by the app's Earlier/Later sync buttons.
 */
app.post('/api/party/speaker/sync', async (req, res) => {
  const { mac, delta_ms } = req.body as { mac?: string; delta_ms?: number };
  if (!mac || delta_ms === undefined || isNaN(Number(delta_ms))) {
    return res.status(400).json({ error: 'mac and delta_ms are required' });
  }
  const cal     = party.getLatencyCalibration();
  const current = cal[mac] ?? 150;
  party.setLatencyCalibration(mac, current + Number(delta_ms));
  const status = party.getPartyStatus();
  if (status.active) {
    await party.enablePartyMode(status.speakers.map(s => s.mac));
  }
  res.json({ ok: true, calibration: party.getLatencyCalibration(), party: party.getPartyStatus() });
});

/** Set volume on a single speaker in the party. */
app.post('/api/party/speaker/volume', async (req, res) => {
  const { mac, volume } = req.body as { mac?: string; volume?: number };
  if (!mac || volume === undefined || isNaN(Number(volume))) {
    return res.status(400).json({ error: 'mac and volume are required' });
  }
  try {
    await party.setSpeakerVolume(mac, Number(volume));
    res.json({ ok: true, party: party.getPartyStatus() });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

/** Mute or unmute a single speaker (keeps it in the party). */
app.post('/api/party/speaker/mute', async (req, res) => {
  const { mac, muted } = req.body as { mac?: string; muted?: boolean };
  if (!mac || muted === undefined) {
    return res.status(400).json({ error: 'mac and muted are required' });
  }
  try {
    await party.setSpeakerMuted(mac, Boolean(muted));
    res.json({ ok: true, party: party.getPartyStatus() });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

/** Shift every speaker's volume by delta percentage points (preserves relative differences). */
app.post('/api/party/volume/shift', async (req, res) => {
  const { delta } = req.body as { delta?: number };
  if (delta === undefined || isNaN(Number(delta))) {
    return res.status(400).json({ error: 'delta is required' });
  }
  try {
    await party.shiftGroupVolume(Number(delta));
    res.json({ ok: true, party: party.getPartyStatus() });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

/** Mute or unmute all party speakers simultaneously. */
app.post('/api/party/mute', async (req, res) => {
  const { muted } = req.body as { muted?: boolean };
  if (muted === undefined) return res.status(400).json({ error: 'muted is required' });
  try {
    await party.setGroupMuted(Boolean(muted));
    res.json({ ok: true, party: party.getPartyStatus() });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

/** Move all party speakers to the same volume level. */
app.post('/api/party/volume', async (req, res) => {
  const { volume } = req.body as { volume?: number };
  if (volume === undefined || isNaN(Number(volume))) {
    return res.status(400).json({ error: 'volume is required' });
  }
  try {
    await party.setGroupVolume(Number(volume));
    res.json({ ok: true, party: party.getPartyStatus() });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── Network mode switching ────────────────────────────────────────────────────
// Writes a request file that camping-mode.sh picks up on its next tick (~30 s).
// The daemon handles the actual nmcli calls so the API doesn't need sudo.

app.post('/api/network/mode', (req, res) => {
  const { mode } = req.body as { mode?: string };
  if (mode !== 'home' && mode !== 'camping') {
    return res.status(400).json({ error: 'mode must be "home" or "camping"' });
  }
  try {
    writeFileSync(NETWORK_MODE_REQUEST, mode, 'utf8');
    res.json({ ok: true, requested: mode });
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
