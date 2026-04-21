/**
 * Wrapper around `playerctl` for controlling librespot playback.
 *
 * playerctl talks to librespot via the MPRIS2 D-Bus interface.
 * All commands are targeted at the librespot player specifically
 * to avoid accidentally controlling other media players.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Track } from './types';

const execAsync = promisify(exec);
const PLAYER = 'librespot';

const xdgRuntime = process.env.XDG_RUNTIME_DIR ?? '/run/user/1000';
const PULSE_ENV = { ...process.env, PULSE_SERVER: `unix:${xdgRuntime}/pulse/native` };

async function run(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`playerctl --player=${PLAYER} ${cmd}`);
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function play(): Promise<void> {
  await run('play');
}

export async function pause(): Promise<void> {
  await run('pause');
}

export async function next(): Promise<void> {
  await run('next');
}

export async function previous(): Promise<void> {
  await run('previous');
}

/** positionMs — milliseconds from start of track */
export async function seek(positionMs: number): Promise<void> {
  // playerctl position takes seconds
  await run(`position ${(positionMs / 1000).toFixed(3)}`);
}

/** volume — 0 to 100 */
export async function setVolume(volume: number): Promise<void> {
  // Use PulseAudio directly — librespot doesn't expose MPRIS2 volume
  try {
    await execAsync(`pactl set-sink-volume @DEFAULT_SINK@ ${Math.round(volume)}%`, { env: PULSE_ENV });
  } catch {
    // fallback: try playerctl
    await run(`volume ${(volume / 100).toFixed(2)}`);
  }
}

export async function isPlaying(): Promise<boolean> {
  const status = await run('status');
  return status === 'Playing';
}

/** Returns current volume as 0–100 integer */
export async function getVolume(): Promise<number> {
  try {
    const { stdout } = await execAsync('pactl get-sink-volume @DEFAULT_SINK@', { env: PULSE_ENV });
    const match = stdout.match(/(\d+)%/);
    if (match) return parseInt(match[1], 10);
  } catch { /* fall through */ }
  const raw = await run('volume');
  const f = parseFloat(raw);
  return isNaN(f) ? 50 : Math.round(f * 100);
}

/** Returns current playback position in milliseconds.
 *  Throws if playerctl cannot reach the player (e.g. no MPRIS2),
 *  so the caller's catch block can use an increment fallback instead. */
export async function getPosition(): Promise<number> {
  const raw = await run('position');
  const secs = parseFloat(raw);
  if (isNaN(secs)) throw new Error('playerctl position unavailable');
  return Math.round(secs * 1000);
}

/** Reads full track metadata from MPRIS */
export async function getTrack(): Promise<Track> {
  const [title, artist, album, artUrl, lengthUs, positionSecs] =
    await Promise.all([
      run('metadata title'),
      run('metadata artist'),
      run('metadata album'),
      run('metadata mpris:artUrl'),
      run('metadata mpris:length'), // microseconds
      run('position'),              // seconds (float)
    ]);

  const durationMs = lengthUs
    ? Math.round(parseInt(lengthUs, 10) / 1000)
    : 0;
  const positionMs = positionSecs
    ? Math.round(parseFloat(positionSecs) * 1000)
    : 0;

  return {
    title:       title   || 'Unknown',
    artist:      artist  || 'Unknown',
    album:       album   || undefined,
    art_url:     artUrl  || undefined,
    position_ms: positionMs,
    duration_ms: durationMs,
  };
}
