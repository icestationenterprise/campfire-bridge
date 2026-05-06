/**
 * Wrapper around `bluetoothctl` for managing Bluetooth devices on the Pi.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { BluetoothDevice, DiscoveredDevice } from './types';
import { getAssignedHcis } from './adapters';

const execAsync = promisify(exec);

async function btctl(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`bluetoothctl ${cmd}`);
    return stdout;
  } catch {
    return '';
  }
}

/** All HCI adapters with hciId and BD address. */
async function getAdapters(): Promise<{ hciId: string; mac: string }[]> {
  try {
    const { stdout } = await execAsync('hciconfig -a');
    const adapters: { hciId: string; mac: string }[] = [];
    for (const block of stdout.split(/(?=^hci\d+:)/m).filter(Boolean)) {
      const idM  = block.match(/^(hci\d+):/);
      const macM = block.match(/BD Address:\s+([0-9A-Fa-f:]{17})/);
      if (idM && macM) adapters.push({ hciId: idM[1], mac: macM[1].toUpperCase() });
    }
    return adapters.length > 0 ? adapters : [{ hciId: 'hci0', mac: '' }];
  } catch { return [{ hciId: 'hci0', mac: '' }]; }
}

/**
 * Query paired devices for one adapter using interactive bluetoothctl.
 * The CLI `-a` flag is ignored on some BlueZ builds; `select <mac>` is reliable.
 */
function pairedForAdapter(adapterMac: string): Promise<Map<string, string>> {
  return new Promise(resolve => {
    const result = new Map<string, string>();
    const proc   = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let   out    = '';

    const done = () => {
      clearTimeout(timer);
      for (const line of out.split('\n')) {
        const m = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s+(.+)/);
        if (m) result.set(m[1].toUpperCase(), m[2].trim());
      }
      resolve(result);
    };

    const timer = setTimeout(() => { proc.kill('SIGTERM'); resolve(result); }, 4000);
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', done);
    proc.on('error',  () => resolve(result));

    setTimeout(() => {
      const selectCmd = adapterMac ? `select ${adapterMac}\n` : '';
      proc.stdin?.write(`${selectCmd}devices Paired\nquit\n`);
      proc.stdin?.end();
    }, 300);
  });
}

/**
 * Returns true if the device is connected on ANY adapter.
 * Uses `hcitool con` which lists all ACL connections system-wide.
 */
async function isConnected(mac: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('hcitool con');
    return stdout.toUpperCase().includes(mac.toUpperCase());
  } catch {
    const info = await btctl(`info ${mac}`);
    return info.includes('Connected: yes');
  }
}

/**
 * Returns all paired Bluetooth devices across all adapters with their
 * current connection status.
 *
 * Queries each adapter non-interactively via `bluetoothctl -a <hciId> devices Paired`.
 * Non-interactive mode does not emit [CHG]/[NEW]/[DEL] event noise.
 */
export async function listDevices(): Promise<BluetoothDevice[]> {
  const adapters = await getAdapters();
  const seen = new Map<string, string>(); // mac → name, merged across adapters

  for (const adapter of adapters) {
    const paired = await pairedForAdapter(adapter.mac);
    for (const [mac, name] of paired) {
      seen.set(mac, name);
    }
  }

  const devices = await Promise.all(
    [...seen.entries()].map(async ([mac, name]) => ({
      mac, name, connected: await isConnected(mac),
    })),
  );

  return devices;
}

/**
 * Run a timed Bluetooth scan on ALL adapters simultaneously and return
 * all discovered devices (paired and new) merged from every adapter.
 */
export async function scanDevices(durationSec = 5): Promise<DiscoveredDevice[]> {
  const [paired, adapters] = await Promise.all([listDevices(), getAdapters()]);
  const pairedMacs = new Set(paired.map(d => d.mac.toUpperCase()));

  // Only scan on adapters that have no speaker assigned to them.
  // Running inquiry on an adapter that is streaming A2DP audio causes
  // the radio to interleave discovery packets with audio packets → dropouts.
  const assignedHcis = getAssignedHcis();
  const freeAdapters = adapters.filter(a => !assignedHcis.has(a.hciId));
  const scanAdapters = freeAdapters.length > 0 ? freeAdapters : adapters;

  // Scan on free adapters in parallel
  await Promise.allSettled(
    scanAdapters.map(({ hciId }) =>
      execAsync(`bluetoothctl -a ${hciId} --timeout ${durationSec} scan on 2>/dev/null`, {
        timeout: (durationSec + 5) * 1000,
      }),
    ),
  );

  // Collect discovered devices from every adapter's cache
  const seen = new Set<string>();
  const discovered: DiscoveredDevice[] = [];

  for (const { hciId } of adapters) {
    const devicesOut = await btctl(`-a ${hciId} devices`);
    for (const line of devicesOut.split('\n')) {
      const match = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s+(.+)/);
      if (!match) continue;
      const mac = match[1].toUpperCase();
      if (seen.has(mac)) continue;
      seen.add(mac);
      discovered.push({
        mac,
        name:   match[2].trim(),
        paired: pairedMacs.has(mac),
      });
    }
  }

  return discovered;
}

/**
 * Attempt to connect a device via interactive bluetoothctl.
 * Optionally selects a specific adapter first.
 * Resolves true on success, false on failure or timeout.
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
    const timer = setTimeout(() => done(false), 7000);
    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes('Connection successful')) done(true);
      else if (out.includes('Failed to connect') || out.includes('not available')) done(false);
    });
    proc.on('close', () => { if (!settled) resolve(out.includes('Connection successful')); });
    proc.on('error', () => done(false));
    setTimeout(() => {
      const cmd = adapterMac ? `select ${adapterMac}\nconnect ${deviceMac}\n` : `connect ${deviceMac}\n`;
      proc.stdin?.write(cmd);
    }, 300);
  });
}

export async function connectDevice(mac: string): Promise<void> {
  // Try default adapter first (fast path — works for most USB dongle devices)
  if (await attemptConnect(null, mac)) return;

  // Default adapter failed — find which adapter has this device paired and retry
  const adapters = await getAdapters();
  for (const adapter of adapters) {
    const paired = await pairedForAdapter(adapter.mac);
    if (!paired.has(mac.toUpperCase())) continue;
    if (await attemptConnect(adapter.mac, mac)) return;
    break;
  }
  throw new Error(`Failed to connect to ${mac}`);
}

export async function disconnectDevice(mac: string): Promise<void> {
  await btctl(`disconnect ${mac}`);
}

/**
 * Pair and trust a new device so it auto-reconnects in the future.
 * Pairing must complete before trusting — bluetoothctl handles the PIN exchange.
 */
export async function pairDevice(mac: string): Promise<void> {
  await btctl(`pair ${mac}`);
  await btctl(`trust ${mac}`);
}

export async function trustDevice(mac: string): Promise<void> {
  await btctl(`trust ${mac}`);
}
