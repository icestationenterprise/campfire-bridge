/**
 * Wrapper around `bluetoothctl` for managing Bluetooth devices on the Pi.
 *
 * Parses the text output of bluetoothctl commands into structured data.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { BluetoothDevice } from './types';

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
 * Checking each device's status is done in parallel for speed.
 */
export async function listDevices(): Promise<BluetoothDevice[]> {
  const output = await btctl('paired-devices');

  const macs: { mac: string; name: string }[] = [];
  for (const line of output.split('\n')) {
    // Format: "Device AA:BB:CC:DD:EE:FF Device Name"
    const match = line.match(/^Device\s+([A-F0-9:]{17})\s+(.+)$/);
    if (match) {
      macs.push({ mac: match[1], name: match[2].trim() });
    }
  }

  // Check connection status for all devices in parallel
  const devices = await Promise.all(
    macs.map(async ({ mac, name }) => {
      const info = await btctl(`info ${mac}`);
      const connected = info.includes('Connected: yes');
      return { mac, name, connected };
    }),
  );

  return devices;
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

export async function trustDevice(mac: string): Promise<void> {
  await btctl(`trust ${mac}`);
}

export async function pairDevice(mac: string): Promise<void> {
  await btctl(`pair ${mac}`);
}
