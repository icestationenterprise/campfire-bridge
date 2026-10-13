/**
 * Network mode (home WiFi vs. camping hotspot).
 *
 * The switch itself is done by camping-mode.sh (runs as root, owns nmcli).
 * The API only reads the daemon's state file and writes a request file the
 * daemon picks up on its next tick.
 */

import { readFileSync, writeFileSync } from 'fs';

export type NetworkMode = 'home' | 'camping';

const STATE_FILE   = '/tmp/campfire-network-mode';
const REQUEST_FILE = '/tmp/campfire-mode-request';

export function readNetworkMode(): NetworkMode {
  try {
    return readFileSync(STATE_FILE, 'utf8').trim() === 'camping' ? 'camping' : 'home';
  } catch {
    return 'home';
  }
}

export function requestNetworkMode(mode: NetworkMode): void {
  writeFileSync(REQUEST_FILE, mode, 'utf8');
}
