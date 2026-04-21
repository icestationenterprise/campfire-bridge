/**
 * AirPlay receiver control via shairport-sync.
 *
 * shairport-sync is managed as a user systemd service. When running it
 * advertises itself as an AirPlay device named "Campfire Bridge" over mDNS,
 * so any iOS device on the same network can AirPlay audio directly to it.
 * Audio is routed into the campfire_party PulseAudio sink so the existing
 * party mode loopbacks distribute it to all paired speakers in sync.
 *
 * Enable → start party mode first (so campfire_party exists), then start the service.
 * Disable → stop the service (mDNS advertisement disappears immediately).
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SERVICE = 'shairport-sync';

export async function startAirplay(): Promise<void> {
  await execAsync(`systemctl --user start ${SERVICE}`);
}

export async function stopAirplay(): Promise<void> {
  await execAsync(`systemctl --user stop ${SERVICE}`).catch(() => {});
}
