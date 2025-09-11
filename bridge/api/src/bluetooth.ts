import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function pairDevice(mac: string): Promise<void> {
await execAsync(bluetoothctl pair ${mac});
}

export async function connectDevice(mac: string): Promise<void> {
await execAsync(bluetoothctl connect ${mac});
}

export async function disconnectDevice(mac: string): Promise<void> {
await execAsync(bluetoothctl disconnect ${mac});
}

export async function scanDevices(): Promise<string[]> {
const { stdout } = await execAsync('bluetoothctl devices');
return stdout.split('\n').filter(line => line.trim() !== '');
}
