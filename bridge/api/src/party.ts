/**
 * Party Mode — synchronized multi-speaker audio.
 *
 * Uses a virtual null sink (campfire_party) as the input point, with one
 * loopback module per speaker. Each loopback's buffer is sized so that all
 * speakers play in sync: PulseAudio's reported A2DP presentation delay is read
 * for each sink, and faster speakers receive enough extra buffering to match
 * the slowest one.
 *
 * Signal path:
 *   librespot → campfire_party (null sink)
 *               └─ loopback (latency_msec = max - own + BASE) → bluez_sink.MAC.a2dp_sink
 *               └─ loopback (latency_msec = max - own + BASE) → bluez_sink.MAC.a2dp_sink
 *               └─ ...
 *
 * Requires: PulseAudio with module-null-sink and module-loopback (standard on
 * Raspberry Pi OS).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs   from 'fs';
import * as path from 'path';
import type { SpeakerState, PartyStatus } from './types';

const execAsync = promisify(exec);

const xdgRuntime = process.env.XDG_RUNTIME_DIR ?? '/run/user/1000';
const PULSE_ENV = { ...process.env, PULSE_SERVER: `unix:${xdgRuntime}/pulse/native` };

async function pactl(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`pactl ${cmd}`, { env: PULSE_ENV });
    return stdout.trim();
  } catch {
    return '';
  }
}

// ── Sink utilities ─────────────────────────────────────────────────────────────

async function findSinkForMac(mac: string): Promise<string> {
  const macUnderscore = mac.replace(/:/g, '_');
  const sinks = await pactl('list short sinks');
  for (const line of sinks.split('\n')) {
    const name = line.split('\t')[1];
    if (name?.includes(`bluez_sink.${macUnderscore}`)) return name;
  }
  return `bluez_sink.${macUnderscore}.a2dp_sink`;
}

function macToSinkName(mac: string): string {
  return `bluez_sink.${mac.replace(/:/g, '_')}.a2dp_sink`;
}

/**
 * Read the latency PulseAudio reports for a BT A2DP sink (ms).
 * This reflects the A2DP presentation delay the speaker advertises to BlueZ —
 * i.e. how long after receiving audio the speaker will actually play it.
 * Speakers with large internal buffers (e.g. DSP-heavy models) report higher values.
 */
async function getSinkLatencyMs(mac: string): Promise<number> {
  const macUnderscore = mac.replace(/:/g, '_');
  const out = await pactl('list sinks');
  let inBlock = false;
  for (const line of out.split('\n')) {
    if (/^\s*Sink #/.test(line)) inBlock = false;
    if (line.includes(`bluez_sink.${macUnderscore}`)) inBlock = true;
    if (inBlock && /Latency:/.test(line)) {
      const m = line.match(/Latency:\s+(\d+)/);
      if (m) return Math.ceil(parseInt(m[1]) / 1000);
    }
  }
  return 100; // fallback when sink not yet active
}

// ── Latency calibration ───────────────────────────────────────────────────────
// Stores the loopback buffer size (ms) per speaker MAC, persisted to disk.
// PulseAudio's reported A2DP latency only captures the codec buffer (~50ms),
// not the speaker's internal hardware delay. Calibration fills this gap.

const CAL_PATH = path.join(
  process.env.HOME ?? '/home/pi',
  '.campfire-bridge',
  'latency-cal.json',
);

/** mac → loopbuf ms override */
let calibration: Record<string, number> = {};

function loadCalibration(): void {
  try { calibration = JSON.parse(fs.readFileSync(CAL_PATH, 'utf8')); } catch { /* ok */ }
}

function saveCalibration(): void {
  try {
    fs.mkdirSync(path.dirname(CAL_PATH), { recursive: true });
    fs.writeFileSync(CAL_PATH, JSON.stringify(calibration, null, 2));
  } catch (e) { console.error('[audio] failed to save calibration:', e); }
}

loadCalibration();

export function setLatencyCalibration(mac: string, loopbufMs: number): void {
  calibration[mac] = Math.max(10, Math.round(loopbufMs));
  saveCalibration();
  console.log(`[audio] calibration saved: ${mac} → ${calibration[mac]}ms`);
}

export function getLatencyCalibration(): Record<string, number> {
  return { ...calibration };
}

// ── Module state ──────────────────────────────────────────────────────────────

let partySinkId: number | null = null;
let loopbackIds: number[]       = [];
let speakerStates: SpeakerState[] = [];

// ── Setup / teardown ──────────────────────────────────────────────────────────

/**
 * Load a virtual null sink and one latency-compensated loopback per speaker.
 * The slowest speaker (highest reported latency) sets the target; every faster
 * speaker gets enough extra buffering to arrive at the same time.
 */
async function loadPartySink(macs: string[]): Promise<void> {
  const measured = await Promise.all(
    macs.map(async mac => ({ mac, latencyMs: await getSinkLatencyMs(mac) })),
  );
  const maxLatency = Math.max(...measured.map(s => s.latencyMs));
  const BASE_MS    = 50; // minimum loopback buffer to keep PulseAudio happy

  // Virtual input — librespot outputs here
  const sinkOut = await pactl(
    'load-module module-null-sink sink_name=campfire_party ' +
    'sink_properties=device.description=CampfireParty',
  );
  partySinkId = parseInt(sinkOut, 10);
  if (isNaN(partySinkId)) throw new Error('Failed to load campfire_party null sink');

  // One loopback per speaker, compensating for latency differences.
  // Prefer stored calibration over PulseAudio-reported values (PA only sees
  // the codec buffer, not the speaker's internal hardware delay).
  loopbackIds = [];
  for (const { mac, latencyMs } of measured) {
    const sink  = await findSinkForMac(mac);
    const delay = calibration[mac] ?? (maxLatency - latencyMs + BASE_MS);
    const loopOut = await pactl(
      `load-module module-loopback ` +
      `source=campfire_party.monitor sink=${sink} latency_msec=${delay} adjust_time=10`,
    );
    const loopId = parseInt(loopOut, 10);
    if (!isNaN(loopId)) loopbackIds.push(loopId);
    const src = calibration[mac] ? 'calibrated' : 'auto';
    console.log(`[audio] ${mac} → ${sink}  hw=${latencyMs}ms  loopbuf=${delay}ms (${src})`);
  }
}

async function applyStates(states: SpeakerState[]): Promise<void> {
  for (const s of states) {
    await pactl(`set-sink-volume ${macToSinkName(s.mac)} ${s.volume}%`);
    await pactl(`set-sink-mute   ${macToSinkName(s.mac)} ${s.muted ? '1' : '0'}`);
  }
}

async function tearDownSink(): Promise<void> {
  for (const id of loopbackIds) {
    await pactl(`unload-module ${id}`).catch(() => {});
  }
  loopbackIds = [];

  if (partySinkId !== null) {
    await pactl(`unload-module ${partySinkId}`).catch(() => {});
    partySinkId  = null;
    speakerStates = [];
  }

  // Clean up any stale campfire_party modules from a previous bridge run
  // (null-sink and loopbacks both reference "campfire_party" in their args)
  const mods = await pactl('list short modules');
  for (const line of mods.split('\n')) {
    if (!line.includes('campfire_party')) continue;
    const id = parseInt(line.split('\t')[0], 10);
    if (!isNaN(id)) await pactl(`unload-module ${id}`).catch(() => {});
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Set a Bluetooth device as the default PulseAudio audio output (single-speaker
 * mode). Forces A2DP profile first. Skipped when party mode is active — the
 * campfire_party sink stays as default in that case.
 */
export async function setDefaultAudioSink(mac: string): Promise<void> {
  const cardName = `bluez_card.${mac.replace(/:/g, '_')}`;
  await pactl(`set-card-profile ${cardName} a2dp_sink`);
  await new Promise(r => setTimeout(r, 500));
  if (partySinkId === null) {
    const sink = await findSinkForMac(mac);
    await pactl(`set-default-sink ${sink}`);
    console.log(`[audio] default sink → ${sink} (A2DP)`);
  }
}

/**
 * Start (or restart) party mode with the given MACs.
 * Automatically compensates for differing speaker latencies.
 * Preserves existing volume/mute state for speakers already tracked.
 */
export async function enablePartyMode(macs: string[]): Promise<void> {
  if (macs.length === 0) throw new Error('At least one speaker MAC is required');
  const previousStates = [...speakerStates]; // capture before tearDownSink clears them
  await tearDownSink();
  await loadPartySink(macs);
  await pactl('set-default-sink campfire_party');

  speakerStates = macs.map(mac => {
    const existing = previousStates.find(s => s.mac === mac);
    return existing ?? { mac, volume: 80, muted: false };
  });
  await applyStates(speakerStates);
}

/**
 * Add a speaker to an already-running party without disrupting others.
 * Recreates all loopbacks (brief gap) with the updated speaker list so
 * latency compensation is recalculated for the new group.
 */
export async function addSpeakerToParty(mac: string): Promise<void> {
  if (partySinkId === null) throw new Error('Party is not active');
  if (speakerStates.some(s => s.mac === mac)) return;
  const allMacs = [...speakerStates.map(s => s.mac), mac];
  await enablePartyMode(allMacs);
}

/**
 * Stop party mode and restore the first available BT sink as default output.
 */
export async function disablePartyMode(): Promise<void> {
  await tearDownSink();
  const sinks   = await pactl('list short sinks');
  const firstBt = sinks
    .split('\n')
    .map(l => l.split('\t')[1])
    .find(name => name?.startsWith('bluez_sink'));
  if (firstBt) await pactl(`set-default-sink ${firstBt}`);
}

// ── Per-speaker controls ──────────────────────────────────────────────────────

export async function setSpeakerVolume(mac: string, volume: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, volume));
  await pactl(`set-sink-volume ${macToSinkName(mac)} ${clamped}%`);
  const s = speakerStates.find(s => s.mac === mac);
  if (s) s.volume = clamped;
}

export async function setSpeakerMuted(mac: string, muted: boolean): Promise<void> {
  await pactl(`set-sink-mute ${macToSinkName(mac)} ${muted ? '1' : '0'}`);
  const s = speakerStates.find(s => s.mac === mac);
  if (s) s.muted = muted;
}

export async function setGroupVolume(volume: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, volume));
  for (const s of speakerStates) {
    await pactl(`set-sink-volume ${macToSinkName(s.mac)} ${clamped}%`);
    s.volume = clamped;
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

export function getPartyStatus(): PartyStatus {
  return {
    active: partySinkId !== null,
    speakers: speakerStates.map(s => ({
      ...s,
      calibration_ms: calibration[s.mac] ?? 0,
    })),
  };
}
