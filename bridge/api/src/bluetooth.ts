/**
 * Bluetooth speaker management across multiple adapters.
 *
 * The device's radios: one USB dongle per external speaker (the SoC's UART
 * adapter is disabled). Each speaker is bonded to exactly one adapter and
 * stays there; the adapter a speaker lives on is simply the adapter BlueZ
 * reports it under (`Device1.Adapter`). There is no in-memory assignment
 * table to rehydrate or get stale — hci numbers can reshuffle on every boot
 * and nothing here cares.
 *
 * Rules that keep audio clean:
 *   - Never run inquiry while any speaker is connected or a party is active.
 *     Inquiry on one dongle chops A2DP on the neighbouring dongles.
 *   - Abort any running scan before a connect or pair.
 *   - Radio operations are serialized (one at a time).
 */

import * as bluez from './bluez';
import * as btctl from './btctl';
import { Lock, delay } from './exec';
import type { BluetoothDevice, DiscoveredDevice, AdapterStatus } from './types';

const radio = new Lock();

/** Injected by index.ts so this module does not depend on party.ts. */
let partyActive: () => boolean = () => false;
export function setPartyActiveProbe(fn: () => boolean): void { partyActive = fn; }

// ── Snapshot helpers ──────────────────────────────────────────────────────────

const norm = (mac: string): string => mac.toUpperCase();

/**
 * Pick the BlueZ object for a MAC. A speaker should exist under one adapter
 * only, but after re-pairing it can briefly exist under two; prefer the one
 * it is connected on, then the one it is bonded on.
 */
function pickDevice(snap: bluez.Snapshot, mac: string): bluez.Device | null {
  const matches = snap.devices.filter(d => d.address === norm(mac));
  if (matches.length === 0) return null;
  const rank = (d: bluez.Device) => (d.connected ? 2 : 0) + (d.paired ? 1 : 0);
  return [...matches].sort((a, b) => rank(b) - rank(a))[0];
}

function adapterOf(snap: bluez.Snapshot, hciId: string): bluez.Adapter | undefined {
  return snap.adapters.find(a => a.hciId === hciId);
}

/** Adapters eligible for speakers: powered, USB if any USB adapter exists. */
function speakerAdapters(snap: bluez.Snapshot): bluez.Adapter[] {
  const up  = snap.adapters.filter(a => a.powered);
  const usb = up.filter(a => a.bus === 'usb');
  if (usb.length === 0 && up.length > 0) {
    console.warn('[bt] no USB adapters — using the built-in radio (expect WiFi interference)');
  }
  return usb.length > 0 ? usb : up;
}

// ── Listing ───────────────────────────────────────────────────────────────────

/** All bonded speakers across all adapters. */
export async function listDevices(): Promise<BluetoothDevice[]> {
  const snap = await bluez.snapshot();
  const byMac = new Map<string, BluetoothDevice>();
  for (const d of snap.devices) {
    if (!d.paired) continue;
    const prev = byMac.get(d.address);
    byMac.set(d.address, {
      mac:       d.address,
      name:      d.name,
      connected: d.connected || (prev?.connected ?? false),
      adapter:   d.connected || !prev ? d.hciId : prev.adapter,
    });
  }
  return [...byMac.values()];
}

export async function getAdapterStatus(): Promise<AdapterStatus> {
  const snap = await bluez.snapshot();
  return {
    adapters: snap.adapters.map(a => ({
      hciId:   a.hciId,
      address: a.address,
      bus:     a.bus,
      powered: a.powered,
      devices: snap.devices
        .filter(d => d.adapterPath === a.path)
        .map(d => ({ mac: d.address, name: d.name, paired: d.paired, connected: d.connected })),
    })),
  };
}

// ── Discovery ─────────────────────────────────────────────────────────────────

const AUDIO_VIDEO_MAJOR = 0x04;
const SERVICE_RENDERING = 1 << 18;
const SERVICE_AUDIO     = 1 << 21;

/** Keep the pairing list to things that can actually play audio. */
function looksLikeSpeaker(d: bluez.Device): boolean {
  if (d.paired) return true;
  if (d.classOfDevice === null) return false;                 // BLE-only, no Class of Device
  const major = (d.classOfDevice >> 8) & 0x1f;
  return major === AUDIO_VIDEO_MAJOR
      || (d.classOfDevice & SERVICE_RENDERING) !== 0
      || (d.classOfDevice & SERVICE_AUDIO) !== 0;
}

/**
 * Discover nearby speakers.
 *
 * Inquiry is RF-hostile on this hardware: three dongles sit next to each
 * other and next to the Pi's WiFi antenna, so inquiry on ANY dongle chops the
 * A2DP links on the others and degrades the AirPlay stream. It therefore only
 * runs when no speaker is connected anywhere and no party is active — i.e.
 * during setup. Otherwise the result is what BlueZ already knows and
 * `scanned` is false.
 */
export async function scanDevices(durationSec = 6): Promise<{ devices: DiscoveredDevice[]; scanned: boolean }> {
  return radio.run(async () => {
    const before = await bluez.snapshot();
    const quiet  = !partyActive() && !before.devices.some(d => d.connected);
    const free   = quiet ? before.adapters.filter(a => a.powered) : [];

    if (free.length > 0) {
      console.log(`[bt] inquiry on ${free.map(a => a.hciId).join(', ')} for ${durationSec}s`);
      await Promise.allSettled(free.map(a =>
        btctl.runSession(a.address, [
          { cmd: 'scan on',  waitMs: durationSec * 1000 },
          { cmd: 'scan off', waitMs: 500 },
        ], (durationSec + 10) * 1000),
      ));
    }

    const after = free.length > 0 ? await bluez.snapshot() : before;
    const seen  = new Map<string, DiscoveredDevice>();
    for (const d of after.devices) {
      if (!looksLikeSpeaker(d)) continue;
      const prev = seen.get(d.address);
      seen.set(d.address, { mac: d.address, name: d.name, paired: d.paired || (prev?.paired ?? false) });
    }
    return { devices: [...seen.values()], scanned: free.length > 0 };
  });
}

// ── Connect ───────────────────────────────────────────────────────────────────

/**
 * Why a connect failed. BlueZ reports these differently and they need
 * different handling, so classify rather than collapse to a boolean:
 *
 *   unreachable         — off, out of range, or held by another host
 *   refused             — link came up, then profiles were refused. Almost
 *                         always a STALE BOND: we hold a link key the speaker
 *                         forgot. Also reported as "key missing".
 *   profile-unavailable — link fine, but no local A2DP endpoint (PulseAudio down)
 *   busy                — adapter mid-operation or not powered yet
 *   not-paired          — no object for this address on any adapter
 */
export type ConnectFailureReason =
  | 'unreachable' | 'refused' | 'profile-unavailable' | 'busy' | 'not-paired' | 'unknown';

export class ConnectError extends Error {
  constructor(
    readonly deviceMac: string,
    readonly hciId:     string,
    readonly reason:    ConnectFailureReason,
    readonly raw:       string,
  ) {
    super(`Failed to connect ${deviceMac} via ${hciId} (${reason})`);
    this.name = 'ConnectError';
  }

  /** Text safe to show a customer who has no terminal and no BlueZ knowledge. */
  get userMessage(): string {
    switch (this.reason) {
      case 'unreachable':
        return "The speaker didn't respond. Make sure it's switched on, nearby, " +
               "and not already connected to your phone or another device.";
      case 'refused':
        return "The speaker refused the connection. Put it in pairing mode " +
               "(usually hold its Bluetooth button until it flashes), then try again.";
      case 'profile-unavailable':
        return "The bridge's audio service isn't ready yet. Wait a few seconds and try again.";
      case 'busy':
        return "The bridge is busy finishing another operation. Try again in a few seconds.";
      case 'not-paired':
        return "This speaker isn't paired with the bridge yet. Tap Pair to set it up.";
      default:
        return "Couldn't connect to the speaker. Switch it off and on, then try again.";
    }
  }

  /** What the app should offer the user next. */
  get action(): 'retry' | 'pairing-mode' | 'pair' | 'wait' {
    switch (this.reason) {
      case 'refused':             return 'pairing-mode';
      case 'not-paired':          return 'pair';
      case 'busy':
      case 'profile-unavailable': return 'wait';
      default:                    return 'retry';
    }
  }
}

/** Map a BlueZ error message (new `br-connection-*` codes or older errno text). */
export function classifyConnectFailure(message: string): ConnectFailureReason {
  const m = message.toLowerCase();
  if (/already connected/.test(m))                                             return 'unknown'; // treated as success by caller
  if (/page-timeout|page timeout|host is down|timed out|timeout/.test(m))      return 'unreachable';
  if (/profile-unavailable|not available|no such profile/.test(m))            return 'profile-unavailable';
  if (/refused|key-missing|key missing|authentication/.test(m))                return 'refused';
  if (/busy|in progress|not ready|operation already/.test(m))                  return 'busy';
  if (/unknown object|does not exist|not found/.test(m))                       return 'not-paired';
  return 'unknown';
}

async function tryConnect(dev: bluez.Device): Promise<{ ok: true } | { ok: false; reason: ConnectFailureReason; raw: string }> {
  const r = await bluez.connect(dev.path);
  if (r.ok) return { ok: true };
  if (/already connected/i.test(r.message)) return { ok: true };
  return { ok: false, reason: classifyConnectFailure(r.message), raw: r.message };
}

/**
 * Connect a bonded speaker on whichever adapter it is bonded to.
 *
 * Recovers from a stale bond automatically: on a refusal we retry once (a
 * speaker mid-handoff from a phone refuses transiently), then drop our half of
 * the bond and pair again — the only cure when the speaker has forgotten us.
 */
export async function connectDevice(mac: string): Promise<void> {
  return radio.run(async () => {
    btctl.abortAll();
    let snap = await bluez.snapshot();
    let dev  = pickDevice(snap, mac);
    if (!dev) throw new ConnectError(norm(mac), '-', 'not-paired', 'no BlueZ device object for this address');
    if (dev.connected) return;

    let r = await tryConnect(dev);
    if (r.ok) return;

    if (r.reason === 'refused') {
      console.warn(`[bt] ${mac} refused on ${dev.hciId} — retrying before bond repair`);
      await delay(2_000);
      r = await tryConnect(dev);
      if (r.ok) return;
    }

    if (r.reason === 'refused' && dev.paired) {
      console.warn(`[bt] ${mac} has a stale bond on ${dev.hciId} — removing and re-pairing`);
      await bluez.removeDevice(dev.adapterPath, dev.path);
      await delay(1_000);
      try {
        await pairOn(mac, adapterOf(snap, dev.hciId) ?? null);
        snap = await bluez.snapshot();
        dev  = pickDevice(snap, mac) ?? dev;
        r = await tryConnect(dev);
        if (r.ok) { console.log(`[bt] ${mac} recovered by re-pairing on ${dev.hciId}`); return; }
      } catch (e) {
        console.error(`[bt] ${mac} re-pair failed — speaker likely needs pairing mode: ${(e as Error).message}`);
        throw new ConnectError(norm(mac), dev.hciId, 'refused', (e as Error).message);
      }
    }

    throw new ConnectError(norm(mac), dev.hciId, r.reason, r.raw);
  });
}

// ── Pair ──────────────────────────────────────────────────────────────────────

/** Adapter with the fewest bonded speakers, so each speaker gets its own radio. */
function leastLoadedAdapter(snap: bluez.Snapshot): bluez.Adapter | null {
  const candidates = speakerAdapters(snap);
  if (candidates.length === 0) return null;
  const load = (a: bluez.Adapter) => snap.devices.filter(d => d.paired && d.adapterPath === a.path).length;
  return [...candidates].sort((a, b) => load(a) - load(b))[0];
}

async function pairOn(mac: string, adapter: bluez.Adapter | null): Promise<void> {
  const snap    = await bluez.snapshot();
  const target  = adapter ?? leastLoadedAdapter(snap);
  if (!target) throw new Error('No powered Bluetooth adapter available');

  // Each adapter has its own discovery cache: a device found by hci0 is
  // unknown to hci1. Discover on the target first when it has never seen it.
  const known = snap.devices.some(d => d.address === norm(mac) && d.adapterPath === target.path);
  const steps: btctl.Step[] = known
    ? [
        { cmd: `pair ${mac}`,  waitMs: 20_000 },
        { cmd: `trust ${mac}`, waitMs: 1_500 },
      ]
    : [
        { cmd: 'scan on',      waitMs: 12_000 },
        { cmd: `pair ${mac}`,  waitMs: 20_000 },
        { cmd: `trust ${mac}`, waitMs: 1_500 },
        { cmd: 'scan off',     waitMs: 500 },
      ];
  if (!known) console.log(`[bt] ${mac} unknown to ${target.hciId} — discovering before pair`);

  const out = await btctl.runSession(target.address, steps, 60_000);
  if (!/Pairing successful|already paired|Paired: yes/i.test(out)) {
    const why = /not available/i.test(out)
      ? 'device not found by this adapter — is it in pairing mode and in range?'
      : /AuthenticationFailed|Authentication Failed/i.test(out)
        ? 'the device rejected pairing'
        : 'no pairing confirmation from BlueZ';
    console.error(`[bt] pair ${mac} on ${target.hciId} failed: ${why}\n${out}`);
    throw new Error(`Failed to pair ${mac}: ${why}`);
  }
  // `trust` inside the session is best-effort; make sure via D-Bus.
  await bluez.setTrusted(bluez.devicePath(target.path, mac), true);
  console.log(`[bt] paired and trusted ${mac} on ${target.hciId}`);
}

/** Pair and trust a new speaker on the least-loaded USB adapter. Idempotent. */
export async function pairDevice(mac: string): Promise<void> {
  return radio.run(async () => {
    btctl.abortAll();
    const snap = await bluez.snapshot();
    const existing = pickDevice(snap, mac);
    if (existing?.paired) {
      if (!existing.trusted) await bluez.setTrusted(existing.path, true);
      return;
    }
    await pairOn(mac, null);
  });
}

// ── Disconnect / remove ───────────────────────────────────────────────────────

export async function disconnectDevice(mac: string): Promise<void> {
  return radio.run(async () => {
    const snap = await bluez.snapshot();
    const targets = snap.devices.filter(d => d.address === norm(mac) && d.connected);
    for (const d of targets) {
      const r = await bluez.disconnect(d.path);
      if (!r.ok) console.warn(`[bt] disconnect ${mac} on ${d.hciId}: ${r.message}`);
    }
  });
}

/** Forget the speaker on every adapter that knows it. Must be re-paired afterwards. */
export async function removeDevice(mac: string): Promise<void> {
  return radio.run(async () => {
    btctl.abortAll();
    const snap = await bluez.snapshot();
    for (const d of snap.devices.filter(d => d.address === norm(mac))) {
      const r = await bluez.removeDevice(d.adapterPath, d.path);
      if (!r.ok) console.warn(`[bt] remove ${mac} on ${d.hciId}: ${r.message}`);
    }
  });
}
