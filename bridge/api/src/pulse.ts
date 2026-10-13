/**
 * PulseAudio access via `pactl`, plus parsers for the few listings we need.
 * Every function is safe to call when PulseAudio is down: reads return empty
 * results, writes return false/null. party.ts decides what that means.
 */

import { run } from './exec';

const xdgRuntime = process.env.XDG_RUNTIME_DIR ?? '/run/user/1000';
const PULSE_ENV  = { ...process.env, PULSE_SERVER: `unix:${xdgRuntime}/pulse/native` };

/** Run pactl; returns stdout or null on failure. */
export async function pactl(...args: string[]): Promise<string | null> {
  const r = await run('pactl', args, { env: PULSE_ENV, timeoutMs: 8_000 });
  return r.ok ? r.stdout.trim() : null;
}

export type Sink      = { index: number; name: string; driver: string };
export type Module    = { id: number; name: string; args: string };
export type SinkInput = { index: number; sink: number; driver: string };

export async function listSinks(): Promise<Sink[]> {
  const out = await pactl('list', 'short', 'sinks');
  return parseShortSinks(out ?? '');
}

export function parseShortSinks(out: string): Sink[] {
  const sinks: Sink[] = [];
  for (const line of out.split('\n')) {
    const [index, name, driver = ''] = line.split('\t');
    if (!name) continue;
    sinks.push({ index: parseInt(index, 10), name, driver });
  }
  return sinks.filter(s => !isNaN(s.index));
}

export async function listModules(): Promise<Module[]> {
  const out = await pactl('list', 'short', 'modules');
  return parseShortModules(out ?? '');
}

export function parseShortModules(out: string): Module[] {
  const mods: Module[] = [];
  for (const line of out.split('\n')) {
    const [id, name, args = ''] = line.split('\t');
    const n = parseInt(id, 10);
    if (!isNaN(n) && name) mods.push({ id: n, name, args });
  }
  return mods;
}

/** Client streams only (driver column). Loopbacks are sink-inputs too — never move those. */
export async function listSinkInputs(): Promise<SinkInput[]> {
  const out = await pactl('list', 'short', 'sink-inputs');
  return parseShortSinkInputs(out ?? '');
}

export function parseShortSinkInputs(out: string): SinkInput[] {
  const inputs: SinkInput[] = [];
  for (const line of out.split('\n')) {
    const [index, sink, , driver = ''] = line.split('\t');
    const i = parseInt(index, 10), s = parseInt(sink, 10);
    if (!isNaN(i) && !isNaN(s)) inputs.push({ index: i, sink: s, driver });
  }
  return inputs;
}

/**
 * Reported latency per sink in ms, from `pactl list sinks`. For a BT A2DP
 * sink this is the codec/transport delay the speaker advertises — not its
 * internal DSP delay, which is why manual calibration exists on top.
 */
export async function sinkLatencies(): Promise<Map<string, number>> {
  const out = await pactl('list', 'sinks');
  return parseSinkLatencies(out ?? '');
}

export function parseSinkLatencies(out: string): Map<string, number> {
  const result = new Map<string, number>();
  let name: string | null = null;
  for (const line of out.split('\n')) {
    if (/^\s*Sink #/.test(line)) { name = null; continue; }
    const n = line.match(/^\s*Name:\s+(\S+)/);
    if (n) { name = n[1]; continue; }
    const l = line.match(/^\s*Latency:\s+(\d+)\s+usec/);
    if (l && name) result.set(name, Math.ceil(parseInt(l[1], 10) / 1000));
  }
  return result;
}

export async function loadModule(name: string, args: string[]): Promise<number | null> {
  const out = await pactl('load-module', name, ...args);
  const id = out !== null ? parseInt(out, 10) : NaN;
  return isNaN(id) ? null : id;
}

export async function unloadModule(id: number): Promise<boolean> {
  return (await pactl('unload-module', String(id))) !== null;
}

export async function getSinkVolume(sink: string): Promise<number | null> {
  const out = await pactl('get-sink-volume', sink);
  const m = out?.match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : null;
}

export async function getSinkMute(sink: string): Promise<boolean | null> {
  const out = await pactl('get-sink-mute', sink);
  if (out === null) return null;
  return /Mute:\s*yes/i.test(out);
}
