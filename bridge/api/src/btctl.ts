/**
 * Interactive `bluetoothctl` sessions — used only where D-Bus alone is not
 * enough: pairing (needs an agent to answer the handshake) and discovery
 * (bluetoothctl keeps the discovery session alive for exactly as long as the
 * process lives, which is the lifetime we want).
 *
 * Every session targets one adapter via `select <address>`. Commands are sent
 * with a wait after each because BlueZ holds discovered-but-unbonded devices as
 * temporary entries: "scan on" immediately followed by "pair" pairs against a
 * device the adapter has not found yet.
 */

import { spawn, ChildProcess } from 'child_process';

export type Step = { cmd: string; waitMs: number };

const active = new Set<ChildProcess>();

/** Kill every running session. Called before a connect or pair so no inquiry is in flight. */
export function abortAll(): void {
  for (const proc of active) proc.kill('SIGTERM');
  active.clear();
}

export function runSession(adapterAddress: string | null, steps: Step[], timeoutMs = 60_000): Promise<string> {
  return new Promise(resolve => {
    const proc = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    active.add(proc);
    let out = '';
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(proc);
      proc.kill('SIGTERM');
      resolve(out);
    };

    const timer = setTimeout(finish, timeoutMs);
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', finish);
    proc.on('error', finish);

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    void (async () => {
      await sleep(300);                                   // let the banner print
      if (adapterAddress && !settled) {
        proc.stdin?.write(`select ${adapterAddress}\n`);
        await sleep(1_500);
      }
      for (const step of steps) {
        if (settled) return;
        proc.stdin?.write(`${step.cmd}\n`);
        await sleep(step.waitMs);
      }
      if (!settled) proc.stdin?.write('quit\n');
    })();
  });
}
