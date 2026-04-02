/**
 * Wrapper around `bluetoothctl` for managing Bluetooth devices on the Pi.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { BluetoothDevice, DiscoveredDevice } from './types';

const execAsync = promisify(exec);

async function btctl(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`bluetoothctl ${cmd}`);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Returns all paired Bluetooth devices with their current connection status.
 */
export async function listDevices(): Promise<BluetoothDevice[]> {
  const output = await btctl('devices Paired');

  const macs: { mac: string; name: string }[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^Device\s+([A-F0-9:]{17})\s+(.+)$/);
    if (match) macs.push({ mac: match[1], name: match[2].trim() });
  }

  const devices = await Promise.all(
    macs.map(async ({ mac, name }) => {
      const info = await btctl(`info ${mac}`);
      return { mac, name, connected: info.includes('Connected: yes') };
    }),
  );

  return devices;
}

/**
 * Run a timed Bluetooth scan and return all discovered devices (paired and new).
 * Uses `bluetoothctl --timeout` which exits cleanly after the scan period.
 */
export async function scanDevices(durationSec = 5): Promise<DiscoveredDevice[]> {
  const paired = await listDevices();
  const pairedMacs = new Set(paired.map(d => d.mac));

  // Run a timed scan (bluetoothctl --timeout N scan on exits when done)
  try {
    await execAsync(`bluetoothctl --timeout ${durationSec} scan on 2>/dev/null`, {
      timeout: (durationSec + 5) * 1000,
    });
  } catch {
    // timeout exit is expected and normal
  }

  // Retrieve all devices the adapter has seen (persists after scan ends)
  const devicesOut = await btctl('devices');

  const seen = new Set<string>();
  const discovered: DiscoveredDevice[] = [];

  for (const line of devicesOut.split('\n')) {
    const match = line.match(/^Device\s+([A-F0-9:]{17})\s+(.+)$/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      discovered.push({
        mac:    match[1],
        name:   match[2].trim(),
        paired: pairedMacs.has(match[1]),
      });
    }
  }

  return discovered;
}

export async function connectDevice(mac: string): Promise<void> {
  const out = await btctl(`connect ${mac}`);
  if (out.includes('Failed') || out.includes('not available')) {
    throw new Error(`Failed to connect to ${mac}`);
  }
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
