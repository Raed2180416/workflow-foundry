// Build-loop feedback for B1 builders (B1-E8-DEV "next lever": a build loop with the smoke runner). The builder stays in
// its sandbox and sees no bed code: it writes solver.mjs and runs `node smoke.mjs`, which drops a request file into
// .smoke/ in its own workdir and waits. This host-side service picks the request up, runs the CURRENT solver.mjs out of
// process (beds/ebed/host/sandbox-arm.mjs) through the real host on PRACTICE worlds (seeds disjoint from every grading
// world: SEED-LEDGER ebed-e8-rehearsal 1235-1237), and writes back a report:
//   smoke   what an arm author may see (beds/ebed/e8/tools/arm-smoke.mjs): run status, wake-ups, ticks, instances,
//           arm errors, and the effect results the solver received, by system.op, status and error code. No grading.
//   graded  smoke plus the oracle's completed-case pass count and the first divergence (rule, lid, layer, code) of up to
//           `show` failing cases, on the practice worlds only.
// Every request is journaled (smoke.jsonl in the run's output directory). $0 (no model calls).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';

export const PRACTICE = { seeds: [1235, 1236, 1237], difficulties: [2, 3, 5] };

/** The client the builder runs (inside its sandbox): file mailbox only, no network, no bed code. */
export const CLIENT = `// Ask the platform to run ./solver.mjs on practice worlds and print what happened. Usage: node smoke.mjs
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
mkdirSync('.smoke', { recursive: true });
const n = readdirSync('.smoke').filter(f => f.startsWith('req-')).length + 1;
writeFileSync(\`.smoke/req-\${n}.json\`, JSON.stringify({ n }));
process.stdout.write(\`smoke request \${n} queued; waiting (up to 15 min)\\n\`);
const t = Date.now();
while (Date.now() - t < 15 * 60_000) {
  if (existsSync(\`.smoke/res-\${n}.txt\`)) { process.stdout.write(readFileSync(\`.smoke/res-\${n}.txt\`, 'utf8')); process.exit(0); }
  await new Promise(r => setTimeout(r, 1000));
}
console.log('no answer within 15 min'); process.exit(1);
`;

export function clientInstructions(mode) {
  return `
## Feedback (build loop: ${mode})

You may run your solver on practice worlds through the real platform as often as you like: write \`solver.mjs\`, then run
\`node smoke.mjs\`. It prints the run status, wake-up and tick counts, every arm error (invalid output, crash, timeout)
and the effect results your solver received, by system.op, status and error code${mode === 'graded'
    ? ', plus how many completed cases of the practice worlds pass the business rules and, for a few failing cases, the first rule broken (rule, effect id, what was expected)'
    : ' (no grading: it does not say whether the rules were followed)'}. A run takes one to a few minutes. The practice worlds are not the worlds your solver is judged on.
`;
}

const asText = x => (typeof x === 'string' ? x : JSON.stringify(x));

/** Run one solver source on the practice worlds; returns the report text and a summary row. */
export async function smokeReport(item, solverSource, { mode = 'smoke', practice = PRACTICE, show = 6, maxWakeups = 30_000, worldTimeoutMs = 240_000 } = {}) {
  const lines = [], summary = { worlds: [] };
  for (const d of practice.difficulties) {
    const seed = practice.seeds[practice.difficulties.indexOf(d)] ?? practice.seeds[0];
    const w = item.generateWorld({ seed, difficulty: d, mix: 'tail', ...(practice.size ? { size: practice.size } : {}) });
    const arm = sandboxArm({ id: 'smoke', solverSource, timeoutMs: 20_000 });
    const host = createHost({ item: item.binding, world: w, arm, callTimeoutMs: 25_000, maxWakeups });
    let status, timer;
    try {
      status = (await Promise.race([host.run(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`world took longer than ${worldTimeoutMs / 1000} s`)), worldTimeoutMs); })])).status;
    } catch (e) { status = `stopped: ${String(e?.message ?? e).slice(0, 200)}`; } finally { clearTimeout(timer); arm.close(); }
    const rows = host.journal.contentRows();
    const errors = rows.filter(r => r.type === 'arm.error');
    const results = {};
    let emitted = 0;
    for (const r of rows) {
      if (r.type === 'call' && Array.isArray(r.output?.effects)) emitted += r.output.effects.length;
      if (r.type === 'deliver' && r.event?.type === 'effect.result') {
        const p = r.event.payload;
        for (const it of p.items ?? [{ status: p.status, error: p.error }]) {
          const k = `${p.system}.${p.op} ${it.status}${it.error ? ` ${it.error.code ?? ''} ${it.error.reason ?? ''}`.trimEnd() : ''}`;
          results[k] = (results[k] ?? 0) + 1;
        }
      }
    }
    const ticks = rows.filter(r => r.type === 'call').length, wakeups = rows.filter(r => r.type === 'wakeup.commit').length;
    const instances = rows.filter(r => r.type === 'instance.open').length;
    lines.push(`== practice world ${seed} (difficulty ${d}): ${status}; ${wakeups} wake-ups, ${ticks} ticks, ${instances} instances, ${emitted} effects emitted`);
    lines.push(`arm errors: ${errors.length}`);
    for (const e of errors.slice(0, 6)) lines.push(`   ${e.instance ?? ''} ${e.code ?? ''} ${asText(e.detail ?? e.error ?? '').slice(0, 300)}`);
    lines.push('effect results your solver received:');
    const keys = Object.keys(results).sort();
    if (!keys.length) lines.push('   (none)');
    for (const k of keys) lines.push(`   ${String(results[k]).padStart(5)}  ${k}`);
    const ws = { seed, d, status, wakeups, ticks, emitted, armErrors: errors.length };
    if (mode === 'graded') {
      const { pools } = await item.referenceRuns(w);
      const v = item.oracle(w, rows, { pools, arm: 'smoke' });
      const comp = v.cases.filter(c => c.pool === 'completed');
      const fails = comp.filter(c => !c.pass);
      lines.push(`business rules: ${comp.length - fails.length}/${comp.length} completed cases pass; critical violations ${v.critical.length}`);
      for (const c of fails.slice(0, show)) {
        const f = c.firstDivergence;
        lines.push(`   case ${c.case}: ${f ? `rule ${f.rule ?? '?'} ${f.code}${f.lid ? ` (${f.lid})` : ''}${f.field ? ` field ${f.field}` : ''} at ${f.at ?? '?'}${f.expected !== undefined ? `; expected ${asText(f.expected).slice(0, 160)}` : ''}${f.got !== undefined ? `; got ${asText(f.got).slice(0, 160)}` : ''}` : 'still open at the horizon'}`);
      }
      Object.assign(ws, { completed: comp.length, passed: comp.length - fails.length, critical: v.critical.length });
    }
    summary.worlds.push(ws);
    lines.push('');
  }
  return { text: lines.join('\n'), summary };
}

/**
 * Serve smoke requests from a builder's workdir until stop() is called. Requests are handled one at a time, in order.
 * Returns { stop: async () => count }.
 */
export function serveMailbox({ item, workdir, mode, journal, practice = PRACTICE, pollMs = 1000 }) {
  const box = path.join(workdir, '.smoke');
  mkdirSync(box, { recursive: true });
  let busy = false, stopped = false, count = 0;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const reqs = readdirSync(box).filter(f => /^req-\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)));
      for (const f of reqs) {
        const n = f.slice(4, -5), res = path.join(box, `res-${n}.txt`);
        if (existsSync(res)) continue;
        const sol = path.join(workdir, 'solver.mjs');
        const t = Date.now();
        let text, summary = null;
        if (!existsSync(sol)) text = 'no solver.mjs in the working directory\n';
        else {
          try { ({ text, summary } = await smokeReport(item, readFileSync(sol, 'utf8'), { mode, practice })); }
          catch (e) { text = `the platform could not run solver.mjs: ${String(e?.message ?? e).slice(0, 400)}\n`; }
        }
        writeFileSync(`${res}.tmp`, text);
        renameSync(`${res}.tmp`, res);
        count += 1;
        if (journal) appendFileSync(journal, JSON.stringify({ n: Number(n), mode, ms: Date.now() - t, summary }) + '\n');
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, pollMs);
  return { stop: async () => { stopped = true; clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 200)); return count; } };
}
