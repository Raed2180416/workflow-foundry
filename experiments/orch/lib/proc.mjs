// Child-process helpers for the chaos scenarios: spawn lib/owner.mjs with a spec, read its JSON lines, kill it at a chosen
// moment. Every spawned process is tracked and SIGKILLed by reapAll() (the runner calls it after each scenario).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ORCH, tmp } from './harness.mjs';

const spawned = new Set();
export function reapAll() { for (const c of spawned) { try { c.kill('SIGCONT'); c.kill('SIGKILL'); } catch {} } spawned.clear(); }

/** Start lib/owner.mjs on `spec`. -> {child, lines(), done: Promise<{code, signal, lines}>, waitFor(phase, ms)} */
export function startOwner(spec, { env = {}, wrap = null, nodeArgs = [] } = {}) {
  const file = path.join(tmp('orch-spec-'), 'spec.json');
  writeFileSync(file, JSON.stringify(spec));
  const argv = [...nodeArgs, path.join(ORCH, 'lib/owner.mjs'), file];
  const [cmd, args] = wrap ? [wrap[0], [...wrap.slice(1), process.execPath, ...argv]] : [process.execPath, argv];
  const child = spawn(cmd, args, { env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  spawned.add(child);
  let out = '', err = '';
  const rows = [];
  const waiters = [];
  child.stdout.on('data', d => {
    out += d;
    let i;
    while ((i = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, i); out = out.slice(i + 1);
      try { rows.push(JSON.parse(line)); } catch { rows.push({ raw: line }); }
      for (const w of [...waiters]) if (w.test()) { waiters.splice(waiters.indexOf(w), 1); w.resolve(); }
    }
  });
  child.stderr.on('data', d => { if (err.length < 100000) err += d; });
  const done = new Promise(resolve => child.on('close', (code, signal) => { spawned.delete(child); for (const w of waiters.splice(0)) w.resolve(); resolve({ code, signal, lines: rows, stderr: err }); }));
  const waitFor = (phase, ms = 30000) => new Promise(resolve => {
    const test = () => rows.some(r => r.phase === phase);
    if (test()) return resolve(true);
    const w = { test, resolve: () => resolve(test()) };
    waiters.push(w);
    setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) waiters.splice(k, 1); resolve(test()); }, ms).unref();
  });
  return { child, pid: child.pid, lines: () => rows, stderr: () => err, done, waitFor, last: () => rows.at(-1) };
}
/** Run lib/owner.mjs to its end. */
export async function owner(spec, opts) { const o = startOwner(spec, opts); const r = await o.done; return { ...r, last: r.lines.at(-1) ?? null, result: r.lines.find(l => l.phase === 'result' || l.phase === 'error') ?? null }; }

/** A deterministic PRNG (mulberry32) for kill times. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
