// Build-loop feedback for composed builders (arms C-H, C-H-T; research/composition-20261021/HARNESS.md §7). The same
// loop as B1L-H (experiments/ebed/smoke-service.mjs: file mailbox, practice worlds 1235-1237, out-of-process sandbox
// arm, effect results and arm errors, no grading), except that the HARNESS bundles the builder's program files
// (composition.json, parent.mjs, modules/) with its composition runtime before each run, and the report adds what the
// runtime enforced: program problems and interface violations (by code and module, with the first few details). $0.
import { writeFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { practiceFor } from '../ebed/smoke-service.mjs';
import { readProgram, bundle } from './bundle.mjs';
import { interfaceReport } from './trace.mjs';

export function composedClientInstructions(mode = 'smoke') {
  return `
## Feedback (build loop: ${mode})

You may run your program on practice worlds through the real platform as often as you like: write composition.json,
parent.mjs and modules/, then run \`node smoke.mjs\`. The platform bundles your files with its composition runtime and
runs them. It prints any problem with the program's files, the run status, wake-up and tick counts, every arm error
(invalid output, crash, timeout), the effect results your program received, by system.op, status and error code, and the
interface violations the runtime recorded (by code and module, with the first few in detail)${mode === 'graded'
    ? ', plus how many completed cases of the practice worlds pass the business rules and, for a few failing cases, the first rule broken'
    : ' (no grading: it does not say whether the rules were followed)'}. A run takes one to a few minutes. The practice worlds are not the worlds your program is judged on.
`;
}

const asText = x => (typeof x === 'string' ? x : JSON.stringify(x));

/** Bundle and run a program (from a directory) on the practice worlds; returns { text, summary }. */
export async function composedSmokeReport(item, dir, { mode = 'smoke', practice = practiceFor(item), show = 6, maxWakeups = 30_000, worldTimeoutMs = 240_000 } = {}) {
  const prog = readProgram(dir);
  const lines = [], summary = { worlds: [], problems: [] };
  if (!prog.manifest) { summary.problems = prog.problems; return { text: `the program cannot be read: ${prog.problems.join('; ')}\n`, summary }; }
  const b = bundle(prog, { item });
  summary.problems = [...prog.problems, ...b.problems];
  if (summary.problems.length) {
    lines.push(`program problems (${summary.problems.length}); the platform will not run a program that does not load:`);
    for (const p of summary.problems.slice(0, 12)) lines.push(`   - ${p}`);
    lines.push('');
    if (prog.problems.length || !prog.manifest?.modules) return { text: lines.join('\n'), summary };
  }
  for (const d of practice.difficulties) {
    const seed = practice.seeds[practice.difficulties.indexOf(d)] ?? practice.seeds[0];
    const w = item.generateWorld({ seed, difficulty: d, mix: 'tail', ...(practice.size ? { size: practice.size } : {}) });
    const arm = sandboxArm({ id: 'smoke', solverSource: b.source, timeoutMs: 20_000 });
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
    const ifc = interfaceReport(rows, prog.manifest, { keepTicks: true });
    lines.push(`== practice world ${seed} (difficulty ${d}): ${status}; ${wakeups} wake-ups, ${ticks} ticks, ${instances} instances, ${emitted} effects emitted`);
    lines.push(`arm errors: ${errors.length}`);
    for (const e of errors.slice(0, 6)) lines.push(`   ${e.instance ?? ''} ${e.code ?? ''} ${asText(e.detail ?? e.error ?? '').slice(0, 300)}`);
    lines.push('effect results your program received:');
    const keys = Object.keys(results).sort();
    if (!keys.length) lines.push('   (none)');
    for (const k of keys) lines.push(`   ${String(results[k]).padStart(5)}  ${k}`);
    lines.push(`interface violations: ${ifc.violations} (dropped effects ${ifc.dropped})${ifc.violations ? ` by code ${JSON.stringify(ifc.violationsByCode)}, by module ${JSON.stringify(ifc.violationsByModule)}` : ''}`);
    for (const t of (ifc.perTick ?? []).slice(0, 4)) for (const v of (t.violations ?? []).slice(0, 2)) lines.push(`   ${t.at} ${t.instance} ${v.code} ${v.module}${v.by ? ` (in ${v.by})` : ''}: ${String(v.detail).slice(0, 200)}`);
    lines.push(`calls: ${Object.entries(ifc.calls).map(([k, n]) => `${k} ${n}`).join(', ') || '(none)'}${Object.keys(ifc.callErrors).length ? `; failed or refused: ${JSON.stringify(ifc.callErrors)}` : ''}`);
    const ws = { seed, d, status, wakeups, ticks, emitted, armErrors: errors.length, violations: ifc.violations };
    if (mode === 'graded') {
      const { pools } = await item.referenceRuns(w);
      const v = item.oracle(w, rows, { pools, arm: 'smoke' });
      const comp = v.cases.filter(c => c.pool === 'completed');
      const fails = comp.filter(c => !c.pass);
      lines.push(`business rules: ${comp.length - fails.length}/${comp.length} completed cases pass; critical violations ${v.critical.length}`);
      for (const c of fails.slice(0, show)) { const f = c.firstDivergence; lines.push(`   case ${c.case}: ${f ? `rule ${f.rule ?? '?'} ${f.code}${f.lid ? ` (${f.lid})` : ''}` : 'still open at the horizon'}`); }
      Object.assign(ws, { completed: comp.length, passed: comp.length - fails.length, critical: v.critical.length });
    }
    summary.worlds.push(ws);
    lines.push('');
  }
  return { text: lines.join('\n'), summary };
}

/** Serve smoke requests from a composed builder's workdir until stop() (the mailbox protocol of smoke-service.mjs). */
export function serveComposedMailbox({ item, workdir, mode = 'smoke', journal, practice = practiceFor(item), pollMs = 1000 }) {
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
        const t = Date.now();
        let text, summary = null;
        try { ({ text, summary } = await composedSmokeReport(item, workdir, { mode, practice })); }
        catch (e) { text = `the platform could not run the program: ${String(e?.message ?? e).slice(0, 400)}\n`; }
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
