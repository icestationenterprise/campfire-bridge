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
import * as adapters  from './adapters';
import * as party from './party';
import * as airplay from './airplay';
import { LibrespotManager } from './librespot';
import type { BridgeStatus, BluetoothDevice } from './types';

const app = express();
const PORT        = parseInt(process.env.PORT ?? '3000', 10);
const DEVICE_NAME = process.env.DEVICE_NAME ?? 'Campfire';

app.use(cors());
app.use(express.json());

// ── State cache ───────────────────────────────────────────────────────────────

/** Incremented each time a new track starts — prevents stale oEmbed results. */
let artFetchGeneration = 0;

const state: BridgeStatus = {
  device:    DEVICE_NAME,
  connected: false,
  playing:   false,
  track: { title: '', artist: '', position_ms: 0, duration_ms: 0 },
  volume: 50,
  party:   { active: false, speakers: [] },
  offline: false,
};

// ── Librespot ─────────────────────────────────────────────────────────────────

const librespot = new LibrespotManager(DEVICE_NAME, PORT);
librespot.start();
state.connected = true;

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

// ── Internal event hook ───────────────────────────────────────────────────────

app.post('/internal/event', (req, res) => {
  const { event, name, artists, duration_ms, position_ms, track_id } = req.body as {
    event: string;
    name?: string; artists?: string; duration_ms?: string; position_ms?: string; track_id?: string;
  };

  switch (event) {
    case 'playing':
      state.playing = true;
      state.connected = true;
      if (name)        state.track.title       = name;
      if (artists)     state.track.artist      = artists;
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
    case 'track_changed':
      if (name)        state.track.title       = name;
      if (artists)     state.track.artist      = artists;
      if (duration_ms) state.track.duration_ms = parseInt(duration_ms, 10);
      state.track.position_ms = 0;
      state.track.art_url     = undefined;
      state.playing = true;
      if (track_id) {
        const gen = ++artFetchGeneration;
        fetch(`https://open.spotify.com/oembed?url=spotify:track:${track_id}`)
          .then(r => r.ok ? r.json() : Promise.reject(r.status))
          .then((data: { thumbnail_url?: string }) => {
            if (gen === artFetchGeneration && data.thumbnail_url) {
              state.track.art_url = data.thumbnail_url;
            }
          })
          .catch(() => { /* art is optional — music note shown as fallback */ });
      }
      break;
    case 'volume_set':
      if (position_ms) state.volume = parseInt(position_ms, 10);
      break;
  }

  res.json({ ok: true });
});

// ── Position polling ──────────────────────────────────────────────────────────

setInterval(async () => {
  if (!state.playing) return;
  try {
    state.track.position_ms = await playerctl.getPosition();
  } catch {
    state.track.position_ms = Math.min(
      state.track.position_ms + 1000,
      state.track.duration_ms,
    );
  }
}, 1000);

// ── Status ────────────────────────────────────────────────────────────────────

app.get('/api/status', async (_req, res) => {
  state.party  = party.getPartyStatus();
  state.volume = await playerctl.getVolume();
  res.json(state);
});

// ── Playback ──────────────────────────────────────────────────────────────────

app.post('/api/play', async (_req, res) => {
  try {
    await playerctl.play();
    state.playing = true;
    res.json({ ok: true, status: state });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post('/api/pause', async (_req, res) => {
  try {
    await playerctl.pause();
    state.playing = false;
    res.json({ ok: true, status: state });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post('/api/next', async (_req, res) => {
  try {
    await playerctl.next();
    state.playing = true;
    res.json({ ok: true, status: state });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post('/api/previous', async (_req, res) => {
  try {
    await playerctl.previous();
    state.playing = true;
    res.json({ ok: true, status: state });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
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
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
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
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── Bridge connect / disconnect ───────────────────────────────────────────────

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

// ── Party mode ────────────────────────────────────────────────────────────────

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
    res.json({ ok: true, party: party.getPartyStatus() });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post('/api/party/disable', async (_req, res) => {
  try {
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

// ── Offline party mode (AirPlay via shairport-sync) ──────────────────────────

/**
 * Enable offline party mode: start the party sink for the given speakers,
 * then start shairport-sync so iOS devices can see "Campfire Bridge" in the
 * AirPlay picker. Audio from any app on the phone flows into campfire_party
 * and is distributed to all speakers in sync.
 */
app.post('/api/offline/enable', async (req, res) => {
  const { macs } = req.body as { macs?: string[] };
  if (!Array.isArray(macs) || macs.length === 0) {
    return res.status(400).json({ error: 'macs array is required' });
  }
  try {
    await party.enablePartyMode(macs);
    await airplay.startAirplay();
    state.offline = true;
    state.party   = party.getPartyStatus();
    res.json({ ok: true, party: state.party, offline: state.offline });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

/**
 * Disable offline party mode: stop shairport-sync so the AirPlay device
 * disappears from the iOS picker. Party mode (speakers + loopbacks) keeps
 * running so the speakers stay connected and configured.
 */
app.post('/api/offline/disable', async (_req, res) => {
  try {
    await airplay.stopAirplay();
    state.offline = false;
    res.json({ ok: true, party: party.getPartyStatus(), offline: state.offline });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── Export for testing ────────────────────────────────────────────────────────
export default app;

// ── Start (only when run directly, not when imported by tests) ────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Campfire Bridge listening on port ${PORT}`);
  });
}
