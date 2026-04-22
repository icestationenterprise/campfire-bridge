/**
 * Multi-adapter Bluetooth routing.
 *
 * Detects all HCI adapters (the Pi's built-in chip + any USB BT dongles)
 * and distributes speakers across them so each one gets a dedicated radio.
 * With one adapter the behaviour is identical to before — no distribution
 * happens until a second adapter is plugged in.
 *
 * How it works:
 *   1. listAdapters()      — parse `hciconfig` to find every hciN device
 *   2. assignAdapter(mac)  — pick the least-loaded adapter for a new speaker
 *   3. connectDevice(mac)  — open bluetoothctl targeting that adapter
 *   4. releaseAdapter(mac) — free the slot when the speaker disconnects
 *
 * Integration: index.ts uses this module for connect / disconnect / pair.
 * bluetooth.ts still handles listing paired devices and scanning.
 */

import { spawn } from 'child_process';
import { exec }  from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Types ─────────────────────────────────────────────────────────────────────

export type HciAdapter = {
  hciId: string;  // e.g. "hci0"
  mac:   string;  // adapter BD address, e.g. "88:A2:9E:6A:CC:9D"
  bus:   string;  // "USB" | "UART" | "Unknown"
  up:    boolean; // whether the adapter is currently powered on
};

// ── State ─────────────────────────────────────────────────────────────────────

/** speaker MAC → hciId it is currently assigned to */
const assignments = new Map<string, string>();

// ── Adapter discovery ─────────────────────────────────────────────────────────

/** Return all HCI adapters visible to the OS. */
export async function listAdapters(): Promise<HciAdapter[]> {
  try {
    const { stdout } = await execAsync('hciconfig -a');
    return parseHciconfig(stdout);
  } catch {
    // hciconfig not available or no adapters — return a stub so the rest of
    // the code keeps working in single-adapter environments.
    return [{ hciId: 'hci0', mac: '', bus: 'Unknown', up: true }];
  }
}

function parseHciconfig(raw: string): HciAdapter[] {
  const adapters: HciAdapter[] = [];
  // Split on lines that open a new adapter block ("hci0:", "hci1:", …)
  const blocks = raw.split(/(?=^hci\d+:)/m).filter(Boolean);
  for (const block of blocks) {
    const idMatch  = block.match(/^(hci\d+):/);
    const macMatch = block.match(/BD Address:\s+([0-9A-Fa-f:]{17})/);
    const busMatch = block.match(/Bus:\s+(\w+)/);
    if (!idMatch || !macMatch) continue;
    adapters.push({
      hciId: idMatch[1],
      mac:   macMatch[1].toUpperCase(),
      bus:   busMatch?.[1] ?? 'Unknown',
      up:    block.includes('UP'),
    });
  }
  return adapters;
}

// ── Assignment ────────────────────────────────────────────────────────────────

/**
 * Assign a speaker to the least-loaded USB adapter.
 * USB-only policy: built-in UART adapter (shares chip with WiFi) is excluded
 * to avoid A2DP interference. Falls back to all adapters only if no USB
 * adapters are up (e.g. development environment without a dongle).
 */
export async function assignAdapter(deviceMac: string): Promise<string> {
  if (assignments.has(deviceMac)) return assignments.get(deviceMac)!;

  const allUp    = (await listAdapters()).filter(a => a.up);
  const usbUp    = allUp.filter(a => a.bus === 'USB');
  const adapters = usbUp.length > 0 ? usbUp : allUp; // USB-preferred; fall back if no dongle present
  if (usbUp.length === 0 && allUp.length > 0) {
    console.warn('[adapters] No USB BT adapters found — falling back to built-in adapter (expect WiFi interference)');
  }
  if (adapters.length === 0) {
    assignments.set(deviceMac, 'hci0');
    return 'hci0';
  }

  // Count how many speakers are already assigned to each adapter
  const load = new Map<string, number>(adapters.map(a => [a.hciId, 0]));
  for (const hci of assignments.values()) {
    load.set(hci, (load.get(hci) ?? 0) + 1);
  }

  // Choose the adapter with the fewest assignments (round-robin across adapters)
  let best     = adapters[0].hciId;
  let bestLoad = Infinity;
  for (const [hci, count] of load) {
    if (count < bestLoad) { bestLoad = count; best = hci; }
  }

  assignments.set(deviceMac, best);
  console.log(`[adapters] ${deviceMac} → ${best} (${adapters.length} adapter(s), load ${bestLoad}→${bestLoad + 1})`);
  return best;
}

/** Free the adapter slot when a speaker disconnects or is removed. */
export function releaseAdapter(deviceMac: string): void {
  const was = assignments.get(deviceMac);
  assignments.delete(deviceMac);
  if (was) console.log(`[adapters] released ${deviceMac} from ${was}`);
}

/** Returns the hciId a speaker is assigned to, or null if not assigned. */
export function getAdapterForDevice(deviceMac: string): string | null {
  return assignments.get(deviceMac) ?? null;
}

/**
 * Re-assign already-connected speakers after a bridge restart
 * (in-memory state is lost on restart, so we rebuild it here).
 * Call this during the startup recovery pass.
 */
export async function rehydrateAssignments(connectedMacs: string[]): Promise<void> {
  const adapters = (await listAdapters()).filter(a => a.up);
  for (const mac of connectedMacs) {
    if (assignments.has(mac)) continue;
    // Detect which adapter the speaker is actually connected on so we route
    // future connect/disconnect calls through the correct radio.
    let found = false;
    for (const adapter of adapters) {
      try {
        const { stdout } = await execAsync(`hcitool -i ${adapter.hciId} con`);
        if (stdout.toUpperCase().includes(mac.toUpperCase())) {
          assignments.set(mac, adapter.hciId);
          console.log(`[adapters] rehydrated ${mac} → ${adapter.hciId}`);
          found = true;
          break;
        }
      } catch { /* ignore */ }
    }
    if (!found) await assignAdapter(mac);
  }
  console.log(`[adapters] rehydrated ${connectedMacs.length} speaker(s)`);
}

/** Status snapshot used by GET /api/adapters. */
export async function getStatus(): Promise<{
  adapters:    HciAdapter[];
  assignments: Record<string, string>;
}> {
  return {
    adapters:    await listAdapters(),
    assignments: Object.fromEntries(assignments),
  };
}

// ── Bluetoothctl targeted at a specific adapter ───────────────────────────────

async function adapterMacForHci(hciId: string): Promise<string | null> {
  const adapters = await listAdapters();
  return adapters.find(a => a.hciId === hciId)?.mac ?? null;
}

/**
 * Run a sequence of bluetoothctl commands scoped to one adapter.
 *
 * Opens bluetoothctl in interactive mode, optionally prefixes with
 * "select <adapter-mac>" to target a non-default adapter, then sends
 * each command and waits for a terminal result before quitting.
 *
 * Falls back gracefully when only one adapter is present (select is
 * a no-op because it's already the default).
 */
async function btctlOn(
  hciId:      string,
  commands:   string[],
  timeoutMs = 20_000,
): Promise<string> {
  const adapterMac = await adapterMacForHci(hciId);
  const prefix     = adapterMac ? [`select ${adapterMac}`] : [];
  const script     = [...prefix, ...commands, 'quit'].join('\n') + '\n';

  return new Promise(resolve => {
    const proc = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';

    const finish = () => {
      clearTimeout(timer);
      resolve(out);
    };

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve(out);
    }, timeoutMs);

    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', finish);
    proc.on('error', finish);

    // Give bluetoothctl ~300 ms to start up and print its banner,
    // then stream all commands at once.
    setTimeout(() => {
      proc.stdin?.write(script);
      proc.stdin?.end();
    }, 300);
  });
}

// ── Public BT operations (adapter-aware) ──────────────────────────────────────

/**
 * Find which adapter has this device in its paired list.
 * Queries each adapter sequentially to avoid overwhelming bluetoothd.
 */
async function findAdapterForPairedDevice(deviceMac: string): Promise<string | null> {
  const all = await listAdapters();
  const mac = deviceMac.toUpperCase();
  for (const adapter of all) {
    const out = await btctlOn(adapter.hciId, ['devices Paired'], 5000);
    if (out.toUpperCase().includes(mac)) return adapter.hciId;
  }
  return null;
}

/**
 * Attempt a BT connect scoped to one adapter.
 * Does NOT send 'quit' — bluetoothctl must stay alive to receive the async
 * "Connection successful" notification from BlueZ. Kills the process once
 * a terminal result (success or failure) or the timeout is reached.
 */
function attemptConnect(adapterMac: string | null, deviceMac: string): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;

    const done = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill('SIGTERM');
      resolve(success);
    };

    const timer = setTimeout(() => done(false), 12_000);

    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes('Connection successful') || out.includes('already connected')) done(true);
      else if (out.includes('Failed to connect') || out.includes('not available')) done(false);
    });
    proc.on('close', () => { if (!settled) resolve(out.includes('Connection successful')); });
    proc.on('error', () => done(false));

    setTimeout(() => {
      const cmd = adapterMac
        ? `select ${adapterMac}\nconnect ${deviceMac}\n`
        : `connect ${deviceMac}\n`;
      proc.stdin?.write(cmd);
      // Do NOT end stdin or send quit — connection result arrives asynchronously
    }, 300);
  });
}

/**
 * Connect a Bluetooth speaker via its assigned adapter.
 * First checks which adapter has the device paired (reliable), then falls
 * back to load-balanced assignment if not found.
 */
export async function connectDevice(deviceMac: string): Promise<void> {
  if (!assignments.has(deviceMac)) {
    const hci = await findAdapterForPairedDevice(deviceMac);
    if (hci) {
      assignments.set(deviceMac, hci);
      console.log(`[adapters] ${deviceMac} → ${hci} (found via paired list)`);
    } else {
      await assignAdapter(deviceMac);
    }
  }

  const hci = assignments.get(deviceMac)!;
  const adapterMac = await adapterMacForHci(hci);
  const ok = await attemptConnect(adapterMac, deviceMac);
  if (!ok) {
    releaseAdapter(deviceMac);
    throw new Error(`Failed to connect ${deviceMac} via ${hci}`);
  }
}

/**
 * Pair and trust a new Bluetooth device via its assigned adapter.
 * Falls back to hci0 if the assigned adapter fails (e.g. device not in its cache).
 * Pairing can take up to 30 s so we use a longer timeout.
 */
export async function pairDevice(deviceMac: string): Promise<void> {
  // Non-interactive commands are required here: btctlOn sends `pair`, `trust`,
  // and `quit` in one shot, so bluetoothctl exits before BlueZ finishes writing
  // the pairing record to disk — the device appears to pair then immediately
  // reverts. Running each command as a separate process waits for full completion.
  //
  // USB-only policy: pair through the first available USB adapter.
  const allUp = (await listAdapters()).filter(a => a.up);
  const usbUp = allUp.filter(a => a.bus === 'USB');
  const firstUsb = (usbUp.length > 0 ? usbUp : allUp)[0]?.hciId ?? 'hci0';
  assignments.set(deviceMac, firstUsb);
  try {
    const pairResult = await execAsync(`bluetoothctl pair ${deviceMac}`, { timeout: 30_000 })
      .catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }));
    const out = pairResult.stdout;
    if (out.includes('Failed') || out.includes('not available')) {
      throw new Error(`Failed to pair ${deviceMac}`);
    }
    await execAsync(`bluetoothctl trust ${deviceMac}`, { timeout: 5_000 }).catch(() => {});
    console.log(`[adapters] paired and trusted ${deviceMac}`);
  } catch (e) {
    releaseAdapter(deviceMac);
    throw e;
  }
}

/**
 * Disconnect a Bluetooth device and release its adapter slot.
 */
export async function disconnectDevice(deviceMac: string): Promise<void> {
  const hci = assignments.get(deviceMac);
  if (hci) {
    await btctlOn(hci, [`disconnect ${deviceMac}`]);
  }
  releaseAdapter(deviceMac);
}
