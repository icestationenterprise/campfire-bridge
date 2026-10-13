/**
 * Party Mode — synchronized multi-speaker audio.
 *
 * Signal path:
 *   shairport-sync (AirPlay) → campfire_party (null sink)
 *       └─ loopback (latency_msec = per-speaker) → bluez_sink.MAC.a2dp_sink
 *       └─ loopback (latency_msec = per-speaker) → bluez_sink.MAC.a2dp_sink
 *       └─ loopback (latency_msec = per-speaker) → <built-in sink>   (optional)
 *
 * Design rules, all in service of "the music never stops":
 *   - The null sink is created once and left alone. shairport-sync writes to
 *     it; tearing it down mid-stream is an audible gap and risks the stream
 *     being rescued onto some other sink. Adding, removing or re-timing a
 *     speaker touches only that speaker's loopback.
 *   - Loopbacks are created with sink_dont_move. When a speaker drops off,
 *     PulseAudio would otherwise move its loopback to the default sink — which
 *     is campfire_party itself, i.e. a feedback loop. With dont_move the
 *     loopback just unloads.
 *   - All graph edits are serialized through one lock, so two taps on the
 *     app cannot interleave.
 *   - On startup the module adopts whatever graph PulseAudio still has, so an
 *     API restart is invisible: the party keeps playing and status stays true.
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as pulse from './pulse';
import { Lock, delay } from './exec';
import type { SpeakerState, PartyStatus } from './types';

export const PARTY_SINK   = 'campfire_party';
export const BUILTIN_ID   = 'builtin';
/** PulseAudio sink driving the hardwired speaker. Unset → no built-in output. */
const BUILTIN_SINK_NAME   = process.env.BUILTIN_SINK_NAME?.trim() || null;

const BASE_MS             = 50;   // minimum loopback buffer PulseAudio is happy with
const DEFAULT_LOOPBACK_MS = 150;  // starting point for an uncalibrated speaker
const ADJUST_TIME_SEC     = 2;    // how often module-loopback re-trims its rate
const RECONCILE_MS        = 10_000;

const graph = new Lock();

// ── Sink names ────────────────────────────────────────────────────────────────

const macToSinkName = (mac: string): string =>
  mac === BUILTIN_ID ? (BUILTIN_SINK_NAME ?? '') : `bluez_sink.${mac.replace(/:/g, '_')}.a2dp_sink`;

const sinkNameToMac = (sink: string): string | null => {
  if (BUILTIN_SINK_NAME && sink === BUILTIN_SINK_NAME) return BUILTIN_ID;
  const m = sink.match(/^bluez_sink\.([0-9A-Fa-f]{2}(?:_[0-9A-Fa-f]{2}){5})/);
  return m ? m[1].replace(/_/g, ':').toUpperCase() : null;
};

/** Resolve the live sink name for a speaker (BlueZ sinks can carry a profile suffix). */
async function findSink(mac: string, sinks?: pulse.Sink[]): Promise<string | null> {
  const list = sinks ?? await pulse.listSinks();
  if (mac === BUILTIN_ID) {
    return BUILTIN_SINK_NAME && list.some(s => s.name === BUILTIN_SINK_NAME) ? BUILTIN_SINK_NAME : null;
  }
  const prefix = `bluez_sink.${mac.replace(/:/g, '_')}`;
  return list.find(s => s.name.startsWith(prefix))?.name ?? null;
}

// ── Latency calibration (persisted) ───────────────────────────────────────────
// Loopback buffer size (ms) per speaker MAC. PulseAudio's reported A2DP latency
// only covers the codec buffer; the speaker's own DSP delay is invisible, so
// the user dials this in with the Earlier/Later buttons and we keep it.

const CAL_PATH = path.join(process.env.HOME ?? '/home/pi', '.campfire-bridge', 'latency-cal.json');

let calibration: Record<string, number> = {};

function loadCalibration(): void {
  try { calibration = JSON.parse(fs.readFileSync(CAL_PATH, 'utf8')); } catch { /* first run */ }
}

function saveCalibration(): void {
  try {
    fs.mkdirSync(path.dirname(CAL_PATH), { recursive: true });
    fs.writeFileSync(CAL_PATH, JSON.stringify(calibration, null, 2));
  } catch (e) { console.error('[party] failed to save calibration:', e); }
}

loadCalibration();

/**
 * Below ~50 ms a Bluetooth sink cannot keep its buffer fed and crackles on its
 * own, so Earlier stops there. If a speaker seems to need less, the other
 * speakers need to be Later instead.
 */
export function setLatencyCalibration(mac: string, loopbufMs: number): void {
  calibration[mac] = Math.max(BASE_MS, Math.round(loopbufMs));
  saveCalibration();
  console.log(`[party] calibration saved: ${mac} → ${calibration[mac]}ms`);
}

export function getLatencyCalibration(): Record<string, number> {
  return { ...calibration };
}

// ── Graph state ───────────────────────────────────────────────────────────────

type Loop = { module: number; sink: string; latencyMs: number };

let sinkModule: number | null = null;
const loops  = new Map<string, Loop>();          // mac → loopback
const states = new Map<string, SpeakerState>();  // mac → volume/mute while attached
const remembered = new Map<string, SpeakerState>(); // last known volume/mute, survives detach

function stateFor(mac: string): SpeakerState {
  return states.get(mac) ?? remembered.get(mac) ?? { mac, volume: 80, muted: false };
}

async function pushState(s: SpeakerState): Promise<void> {
  const sink = loops.get(s.mac)?.sink ?? macToSinkName(s.mac);
  if (!sink) return;
  await pulse.pactl('set-sink-volume', sink, `${s.volume}%`);
  await pulse.pactl('set-sink-mute', sink, s.muted ? '1' : '0');
}

function targetMacs(macs: string[]): string[] {
  const unique = [...new Set(macs.map(m => (m === BUILTIN_ID ? m : m.toUpperCase())))];
  if (BUILTIN_SINK_NAME && !unique.includes(BUILTIN_ID)) unique.unshift(BUILTIN_ID);
  return unique;
}

// ── Low-level graph edits (callers hold the lock) ─────────────────────────────

async function ensureSink(): Promise<void> {
  if (sinkModule !== null) return;
  // A previous bridge process may have left the sink behind — adopt, don't duplicate.
  const existing = (await pulse.listModules()).find(m =>
    m.name === 'module-null-sink' && m.args.includes(`sink_name=${PARTY_SINK}`));
  if (existing) { sinkModule = existing.id; return; }

  const id = await pulse.loadModule('module-null-sink', [
    `sink_name=${PARTY_SINK}`,
    'sink_properties=device.description=CampfireParty',
  ]);
  if (id === null) throw new Error('Failed to load campfire_party null sink — is PulseAudio running?');
  sinkModule = id;
}

/**
 * Loopback buffer for a speaker: its calibration if the user set one, otherwise
 * enough extra buffering to line up with the slowest speaker in the group.
 */
function loopbackMs(mac: string, own: number, groupMax: number): number {
  return calibration[mac] ?? Math.max(BASE_MS, groupMax - own + BASE_MS);
}

async function attach(mac: string, sinks: pulse.Sink[], latencies: Map<string, number>, groupMax: number): Promise<boolean> {
  if (loops.has(mac)) return true;
  const sink = await findSink(mac, sinks);
  if (!sink) {
    console.warn(`[party] ${mac}: no PulseAudio sink (speaker not connected?) — skipped`);
    return false;
  }
  const own = mac === BUILTIN_ID ? 0 : (latencies.get(sink) ?? 100);
  const ms  = loopbackMs(mac, own, groupMax);
  const id  = await pulse.loadModule('module-loopback', [
    `source=${PARTY_SINK}.monitor`,
    `sink=${sink}`,
    `latency_msec=${ms}`,
    `adjust_time=${ADJUST_TIME_SEC}`,
    'sink_dont_move=true',
    'source_dont_move=true',
  ]);
  if (id === null) {
    console.warn(`[party] ${mac}: failed to load loopback → ${sink}`);
    return false;
  }
  loops.set(mac, { module: id, sink, latencyMs: ms });
  const s = stateFor(mac);
  states.set(mac, s);
  await pushState(s);
  console.log(`[party] ${mac} → ${sink}  hw=${own}ms  loopbuf=${ms}ms (${calibration[mac] ? 'calibrated' : 'auto'})`);
  return true;
}

async function detach(mac: string): Promise<void> {
  const loop = loops.get(mac);
  if (!loop) return;
  await pulse.unloadModule(loop.module);
  loops.delete(mac);
  const s = states.get(mac);
  if (s) remembered.set(mac, s);
  states.delete(mac);
}

/** Move any client stream (shairport-sync) onto the party sink. Loopbacks are never moved. */
async function routeClientStreams(): Promise<void> {
  const sinks = await pulse.listSinks();
  const party = sinks.find(s => s.name === PARTY_SINK);
  if (!party) return;
  for (const input of await pulse.listSinkInputs()) {
    if (input.sink === party.index) continue;
    if (!input.driver.startsWith('protocol-native')) continue;
    await pulse.pactl('move-sink-input', String(input.index), PARTY_SINK);
  }
}

async function measure(macs: string[]): Promise<{ sinks: pulse.Sink[]; latencies: Map<string, number>; groupMax: number }> {
  const [sinks, latencies] = await Promise.all([pulse.listSinks(), pulse.sinkLatencies()]);
  let groupMax = 0;
  for (const mac of macs) {
    if (mac === BUILTIN_ID) continue;
    const sink = await findSink(mac, sinks);
    if (sink) groupMax = Math.max(groupMax, latencies.get(sink) ?? 100);
  }
  return { sinks, latencies, groupMax };
}

async function tearDownAll(): Promise<void> {
  for (const mac of [...loops.keys()]) await detach(mac);
  if (sinkModule !== null) { await pulse.unloadModule(sinkModule); sinkModule = null; }
  // Sweep anything from a previous run that still references the party sink.
  for (const m of await pulse.listModules()) {
    if (m.args.includes(PARTY_SINK)) await pulse.unloadModule(m.id);
  }
  states.clear();
}

async function restoreDefaultSink(): Promise<void> {
  const sinks  = await pulse.listSinks();
  const target = sinks.find(s => s.name.startsWith('bluez_sink'))?.name
              ?? (BUILTIN_SINK_NAME && sinks.some(s => s.name === BUILTIN_SINK_NAME) ? BUILTIN_SINK_NAME : null);
  if (target) await pulse.pactl('set-default-sink', target);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isActive(): boolean { return sinkModule !== null; }

/**
 * Start party mode with exactly these speakers (plus the built-in sink when
 * configured). Speakers already attached are left running; only the
 * difference is applied. Safe to call while audio is playing.
 */
export async function enablePartyMode(macs: string[]): Promise<void> {
  if (macs.length === 0) throw new Error('At least one speaker MAC is required');
  return graph.run(async () => {
    const targets = targetMacs(macs);
    await ensureSink();
    for (const mac of [...loops.keys()]) if (!targets.includes(mac)) await detach(mac);
    const { sinks, latencies, groupMax } = await measure(targets);
    for (const mac of targets) await attach(mac, sinks, latencies, groupMax);
    await pulse.pactl('set-default-sink', PARTY_SINK);
    await routeClientStreams();
    startReconcile();
  });
}

/** Add one speaker to a running party without touching the others. */
export async function addSpeakerToParty(mac: string): Promise<void> {
  return graph.run(async () => {
    if (sinkModule === null) throw new Error('Party is not active');
    const key = mac === BUILTIN_ID ? mac : mac.toUpperCase();
    if (loops.has(key)) return;
    const { sinks, latencies, groupMax } = await measure([...loops.keys(), key]);
    await attach(key, sinks, latencies, groupMax);
  });
}

/** Drop one speaker from a running party. No-op if it is not in the party. */
export async function removeSpeakerFromParty(mac: string): Promise<void> {
  return graph.run(() => detach(mac === BUILTIN_ID ? mac : mac.toUpperCase()));
}

/** Stop party mode and hand the default sink back to a real output. */
export async function disablePartyMode(): Promise<void> {
  return graph.run(async () => {
    stopReconcile();
    await tearDownAll();
    await restoreDefaultSink();
  });
}

/**
 * Set a speaker's loopback buffer to an absolute value (ms). Persists the
 * calibration and, if the speaker is in the party, rebuilds only its loopback.
 */
export async function setSpeakerLatency(mac: string, ms: number): Promise<void> {
  const key = mac === BUILTIN_ID ? mac : mac.toUpperCase();
  setLatencyCalibration(key, ms);
  return graph.run(async () => {
    if (!loops.has(key)) return;
    await detach(key);
    const { sinks, latencies, groupMax } = await measure([...loops.keys(), key]);
    await attach(key, sinks, latencies, groupMax);
  });
}

/** Nudge a speaker's timing by delta_ms (positive = later). Used by the Earlier/Later buttons. */
export async function nudgeSpeakerSync(mac: string, deltaMs: number): Promise<void> {
  const key = mac === BUILTIN_ID ? mac : mac.toUpperCase();
  const current = calibration[key] ?? loops.get(key)?.latencyMs ?? DEFAULT_LOOPBACK_MS;
  return setSpeakerLatency(key, current + deltaMs);
}

/**
 * Called once a speaker has connected: make sure its PulseAudio sink exists
 * on the A2DP profile, then either add it to the running party or make it the
 * default output. Waits briefly for PulseAudio to create the sink.
 */
export async function onSpeakerConnected(mac: string, waitMs = 6_000): Promise<void> {
  const key  = mac.toUpperCase();
  const card = `bluez_card.${key.replace(/:/g, '_')}`;
  const deadline = Date.now() + waitMs;
  let sink: string | null = null;
  while (Date.now() < deadline) {
    await pulse.pactl('set-card-profile', card, 'a2dp_sink');
    sink = await findSink(key);
    if (sink) break;
    await delay(500);
  }
  if (!sink) { console.warn(`[party] ${key}: sink never appeared after connect`); return; }
  if (isActive()) {
    await addSpeakerToParty(key);
  } else {
    await pulse.pactl('set-default-sink', sink);
    console.log(`[party] default sink → ${sink}`);
  }
}

/** Startup: make sure a connected speaker's card is on A2DP (PulseAudio forgets on restart). */
export async function ensureA2dp(mac: string): Promise<void> {
  await pulse.pactl('set-card-profile', `bluez_card.${mac.toUpperCase().replace(/:/g, '_')}`, 'a2dp_sink');
}

/** Startup: point the default sink at something audible when no party is running. */
export async function chooseDefaultSink(connectedMacs: string[]): Promise<void> {
  if (isActive()) return;
  for (const mac of connectedMacs) {
    const sink = await findSink(mac);
    if (sink) { await pulse.pactl('set-default-sink', sink); return; }
  }
  await restoreDefaultSink();
}

/**
 * Startup: if PulseAudio still has a party graph from a previous bridge
 * process, take it over instead of reporting "inactive" while audio plays.
 */
export async function adoptExistingGraph(): Promise<boolean> {
  return graph.run(async () => {
    const mods = await pulse.listModules();
    const sink = mods.find(m => m.name === 'module-null-sink' && m.args.includes(`sink_name=${PARTY_SINK}`));
    if (!sink) return false;
    sinkModule = sink.id;
    for (const m of mods) {
      if (m.name !== 'module-loopback' || !m.args.includes(`source=${PARTY_SINK}.monitor`)) continue;
      const sinkName = m.args.match(/sink=(\S+)/)?.[1];
      const mac = sinkName ? sinkNameToMac(sinkName) : null;
      if (!sinkName || !mac) continue;
      const latencyMs = parseInt(m.args.match(/latency_msec=(\d+)/)?.[1] ?? '', 10) || DEFAULT_LOOPBACK_MS;
      loops.set(mac, { module: m.id, sink: sinkName, latencyMs });
      states.set(mac, {
        mac,
        volume: (await pulse.getSinkVolume(sinkName)) ?? 80,
        muted:  (await pulse.getSinkMute(sinkName)) ?? false,
      });
    }
    console.log(`[party] adopted existing graph: ${loops.size} speaker(s)`);
    startReconcile();
    return true;
  });
}

// ── Reconcile: keep status honest when speakers drop off ──────────────────────

let reconcileTimer: NodeJS.Timeout | null = null;

async function reconcile(): Promise<void> {
  if (sinkModule === null) return;
  await graph.run(async () => {
    if (sinkModule === null) return;
    const ids = new Set((await pulse.listModules()).map(m => m.id));
    if (!ids.has(sinkModule)) {
      console.warn('[party] party sink vanished (PulseAudio restarted?) — party is over');
      sinkModule = null;
      loops.clear();
      states.clear();
      stopReconcile();
      return;
    }
    for (const [mac, loop] of loops) {
      if (ids.has(loop.module)) continue;
      console.warn(`[party] ${mac} dropped out of the party (sink went away)`);
      const s = states.get(mac);
      if (s) remembered.set(mac, s);
      loops.delete(mac);
      states.delete(mac);
    }
  });
}

function startReconcile(): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => { reconcile().catch(() => {}); }, RECONCILE_MS);
  reconcileTimer.unref();
}

function stopReconcile(): void {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
}

// ── Per-speaker and group controls ────────────────────────────────────────────

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export async function setSpeakerVolume(mac: string, volume: number): Promise<void> {
  const s = states.get(mac.toUpperCase()) ?? states.get(mac);
  if (!s) return;
  s.volume = clamp(volume);
  await pushState(s);
}

export async function setSpeakerMuted(mac: string, muted: boolean): Promise<void> {
  const s = states.get(mac.toUpperCase()) ?? states.get(mac);
  if (!s) return;
  s.muted = muted;
  await pushState(s);
}

export async function setGroupVolume(volume: number): Promise<void> {
  for (const s of states.values()) { s.volume = clamp(volume); await pushState(s); }
}

/** Shift the master volume (the party sink) by delta points, keeping per-speaker balance. */
export async function shiftGroupVolume(delta: number): Promise<void> {
  const sink = isActive() ? PARTY_SINK : '@DEFAULT_SINK@';
  const current = (await pulse.getSinkVolume(sink)) ?? 50;
  await pulse.pactl('set-sink-volume', sink, `${clamp(current + delta)}%`);
}

export async function setGroupMuted(muted: boolean): Promise<void> {
  for (const s of states.values()) { s.muted = muted; await pushState(s); }
}

// ── Status ────────────────────────────────────────────────────────────────────

export function getPartyStatus(): PartyStatus {
  return {
    active:   isActive(),
    speakers: [...states.values()].map(s => ({
      ...s,
      calibration_ms: loops.get(s.mac)?.latencyMs ?? calibration[s.mac] ?? 0,
    })),
  };
}

/** Test hook: wipe in-memory state. */
export function _resetForTests(): void {
  stopReconcile();
  sinkModule = null;
  loops.clear();
  states.clear();
  remembered.clear();
  calibration = {};
}
