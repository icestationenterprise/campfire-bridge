/**
 * Small child-process helpers shared by the BlueZ and PulseAudio modules.
 *
 * Everything the bridge does to the system goes through external tools
 * (busctl, bluetoothctl, pactl, systemctl). `run` wraps execFile — no shell,
 * so arguments like MAC addresses and sink names never need quoting — and
 * never throws: callers get a result object and decide what a failure means.
 */

import { execFile } from 'child_process';

export type RunResult = {
  ok:     boolean;
  stdout: string;
  stderr: string;
  /** Set when the process could not be started or was killed (timeout). */
  error?: string;
};

export function run(
  cmd:  string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise(resolve => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 10_000, env: opts.env, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const e = err as (Error & { killed?: boolean; code?: number | string }) | null;
        resolve({
          ok:     !e,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          error:  e ? (e.killed ? 'timeout' : typeof e.code === 'string' ? e.code : e.message) : undefined,
        });
      },
    );
  });
}

export const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/**
 * Serialize async work. Used so two app requests can never interleave
 * PulseAudio graph edits or Bluetooth radio operations.
 */
export class Lock {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
