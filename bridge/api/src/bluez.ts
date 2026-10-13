/**
 * BlueZ access via D-Bus (`busctl`).
 *
 * The one thing the old code got wrong over and over was *parsing bluetoothctl
 * output*: its startup banner lists every device on every adapter, so any
 * "does this adapter's output mention MAC X" check matched devices paired
 * elsewhere, and `-a` is bluetoothctl's *agent* flag, not an adapter selector,
 * so "scan on hci2" always scanned the default adapter.
 *
 * BlueZ's D-Bus ObjectManager returns the real state in one call: every
 * adapter, every device, and which adapter each device belongs to. That is the
 * source of truth here. Connect / Disconnect / RemoveDevice / Trusted are also
 * plain D-Bus calls. Only pairing and discovery still go through an
 * interactive bluetoothctl session (see btctl.ts) because pairing needs a
 * registered agent to answer the speaker's handshake.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { run } from './exec';

export type Bus = 'usb' | 'uart' | 'unknown';

export type Adapter = {
  hciId:       string;  // "hci0"
  path:        string;  // "/org/bluez/hci0"
  address:     string;  // adapter BD address, upper-case
  powered:     boolean;
  discovering: boolean;
  bus:         Bus;
};

export type Device = {
  address:       string;  // upper-case MAC
  name:          string;
  path:          string;  // "/org/bluez/hci0/dev_AA_BB_..."
  adapterPath:   string;
  hciId:         string;
  paired:        boolean;
  trusted:       boolean;
  connected:     boolean;
  /** Bluetooth Class of Device, when the device has been seen over BR/EDR. */
  classOfDevice: number | null;
  addressType:   string;  // "public" | "random" | ""
};

export type Snapshot = { adapters: Adapter[]; devices: Device[] };

const OBJECT_MANAGER = ['/', 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects'];

// ── Parsing ───────────────────────────────────────────────────────────────────
//
// busctl's --json output fails on the Pi's systemd (252) with "Failed to create
// new json object: Invalid argument" whenever any device carries a dictionary
// with non-string keys (ManufacturerData is a{qv}). Its --verbose text dump has
// no such limitation, so that is what we parse: a brace-indented tree of
// ARRAY / DICT_ENTRY / VARIANT nodes with typed leaves.

type Props = Record<string, unknown>;

const isEntry = (v: unknown): v is { __entry: true; k: unknown; v: unknown } =>
  !!v && typeof v === 'object' && (v as { __entry?: boolean }).__entry === true;

/**
 * Turn `busctl --verbose call …` output into plain JS values: dictionaries
 * become objects, arrays become arrays, variants are unwrapped. Returns the
 * message's first argument.
 */
export function parseVerboseCall(text: string): unknown {
  type Frame = { kind: string; sig: string; children: unknown[] };
  const stack: Frame[] = [];
  let root: unknown;

  const leaf = (v: unknown) => { stack[stack.length - 1]?.children.push(v); };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (line === '};' || line === '}') {
      const frame = stack.pop();
      if (!frame) continue;
      let value: unknown;
      switch (frame.kind) {
        case 'DICT_ENTRY': value = { __entry: true, k: frame.children[0], v: frame.children[1] }; break;
        case 'VARIANT':    value = frame.children[0]; break;
        case 'ARRAY':
          value = frame.sig.startsWith('{')
            ? Object.fromEntries(frame.children.filter(isEntry).map(e => [String(e.k), e.v]))
            : frame.children;
          break;
        default:           value = frame.children;            // MESSAGE, STRUCT
      }
      if (stack.length) stack[stack.length - 1].children.push(value); else root = value;
      continue;
    }

    const open = line.match(/^(MESSAGE|ARRAY|DICT_ENTRY|VARIANT|STRUCT)\s+"([^"]*)"\s*\{$/);
    if (open) { stack.push({ kind: open[1], sig: open[2], children: [] }); continue; }

    const str = line.match(/^(?:STRING|OBJECT_PATH|SIGNATURE)\s+"(.*)";$/);
    if (str) { leaf(str[1]); continue; }
    const bool = line.match(/^BOOLEAN\s+(true|false);$/);
    if (bool) { leaf(bool[1] === 'true'); continue; }
    const num = line.match(/^(?:BYTE|INT16|UINT16|INT32|UINT32|INT64|UINT64|DOUBLE)\s+(-?[\d.]+);$/);
    if (num) { leaf(Number(num[1])); continue; }
    // anything else (UNIX_FD, …) is ignored
  }
  return Array.isArray(root) ? root[0] : root;
}

const str  = (v: unknown): string        => (typeof v === 'string' ? v : '');
const bool = (v: unknown): boolean       => v === true;
const num  = (v: unknown): number | null => (typeof v === 'number' ? v : null);

const hciIndex = (hciId: string): number => parseInt(hciId.replace(/^hci/, ''), 10) || 0;

/**
 * Build a Snapshot from the GetManagedObjects dictionary
 * ({ objectPath: { interface: { property: value } } }). Pure; unit-tested.
 */
export function parseManagedObjects(objects: unknown, busOf: (hciId: string) => Bus = () => 'unknown'): Snapshot {
  if (!objects || typeof objects !== 'object' || Array.isArray(objects)) {
    throw new Error('unexpected busctl GetManagedObjects output');
  }

  const adapters: Adapter[] = [];
  const devices:  Device[]  = [];

  for (const [objPath, ifaces] of Object.entries(objects as Record<string, Record<string, Props>>)) {
    if (!ifaces || typeof ifaces !== 'object') continue;
    const a = ifaces['org.bluez.Adapter1'];
    if (a) {
      const hciId = path.posix.basename(objPath);
      adapters.push({
        hciId,
        path:        objPath,
        address:     str(a.Address).toUpperCase(),
        powered:     bool(a.Powered),
        discovering: bool(a.Discovering),
        bus:         busOf(hciId),
      });
      continue;
    }
    const d = ifaces['org.bluez.Device1'];
    if (d) {
      const address     = str(d.Address).toUpperCase();
      const adapterPath = str(d.Adapter);
      devices.push({
        address,
        name:          str(d.Name) || str(d.Alias) || address,
        path:          objPath,
        adapterPath,
        hciId:         path.posix.basename(adapterPath),
        paired:        bool(d.Paired),
        trusted:       bool(d.Trusted),
        connected:     bool(d.Connected),
        classOfDevice: num(d.Class),
        addressType:   str(d.AddressType),
      });
    }
  }

  adapters.sort((x, y) => hciIndex(x.hciId) - hciIndex(y.hciId));
  return { adapters, devices };
}

// ── Adapter bus type (sysfs) ──────────────────────────────────────────────────

/**
 * USB dongle or the SoC's UART radio? Read from sysfs rather than the
 * deprecated `hciconfig`. The UART adapter shares an antenna with WiFi, which
 * is why speaker traffic is kept off it.
 */
export function busOfHci(hciId: string): Bus {
  try {
    const subsystem = path.basename(fs.realpathSync(`/sys/class/bluetooth/${hciId}/device/subsystem`));
    if (subsystem === 'usb') return 'usb';
    if (subsystem === 'serial' || subsystem === 'serdev') return 'uart';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Current adapters and devices as BlueZ sees them. One D-Bus round trip. */
export async function snapshot(): Promise<Snapshot> {
  const r = await run('busctl', ['--system', '--no-pager', '--verbose', 'call', 'org.bluez', ...OBJECT_MANAGER], { timeoutMs: 10_000 });
  if (!r.ok) throw new Error(`busctl GetManagedObjects failed: ${r.stderr.trim() || r.error}`);
  return parseManagedObjects(parseVerboseCall(r.stdout), busOfHci);
}

export const devicePath = (adapterPath: string, mac: string): string =>
  `${adapterPath}/dev_${mac.toUpperCase().replace(/:/g, '_')}`;

// ── Writes ────────────────────────────────────────────────────────────────────

export type CallResult =
  | { ok: true;  stdout: string }
  | { ok: false; message: string };

async function call(objPath: string, iface: string, method: string, sigAndArgs: string[] = [], timeoutSec = 25): Promise<CallResult> {
  const r = await run(
    'busctl',
    ['--system', `--timeout=${timeoutSec}s`, 'call', 'org.bluez', objPath, iface, method, ...sigAndArgs],
    { timeoutMs: (timeoutSec + 5) * 1000 },
  );
  if (r.ok) return { ok: true, stdout: r.stdout };
  const m = r.stderr.match(/Call failed:\s*(.+)/);
  const message = (m?.[1] ?? r.stderr).trim() || r.error || 'unknown error';
  return { ok: false, message };
}

/** org.bluez.Device1.Connect — blocks until BlueZ reports success or a reason. */
export const connect = (devPath: string): Promise<CallResult> =>
  call(devPath, 'org.bluez.Device1', 'Connect', [], 20);

export const disconnect = (devPath: string): Promise<CallResult> =>
  call(devPath, 'org.bluez.Device1', 'Disconnect', [], 10);

/** Drop the bond. The device object disappears; it must be paired again to connect. */
export const removeDevice = (adapterPath: string, devPath: string): Promise<CallResult> =>
  call(adapterPath, 'org.bluez.Adapter1', 'RemoveDevice', ['o', devPath], 10);

export async function setTrusted(devPath: string, trusted: boolean): Promise<boolean> {
  const r = await run('busctl', ['--system', 'set-property', 'org.bluez', devPath, 'org.bluez.Device1', 'Trusted', 'b', String(trusted)]);
  return r.ok;
}
