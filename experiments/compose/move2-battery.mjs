// Move 2 on composition: the $0 fault battery, compose-runtime/1 against compose-runtime/2, on dev worlds 1161 d2 s40,
// 1162 d3 s40 and 1164 d5 s60 (research/blockers-20261021/MOVE2-COMP.md; ATTACK.md Move 2; D28(3)). Development
// evidence, labelled runtime2. PREREG-COMP1 stays frozen: its 16 files are imported unchanged and its numbers are not
// re-read as a re-run of the prereg. Resumable: a finished (subject, runtime, world, fault) cell is skipped.
//   nice -n 15 node experiments/compose/move2-battery.mjs [--only <label,...>] [--plan main|fixes|mutants|all]
//        [--out research/blockers-20261021/move2/runs]
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { subjectOf2, runUnder2, measure, DEFAULT_WORLDS } from './fault-run2.mjs';
import { FAULTS } from './faults.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const RUNS = 'research/composition-20261021/runs';
const MONO = 'research/enterprise-20261014/runs';
const sha = p => createHash('sha256').update(readFileSync(path.join(ROOT, p))).digest('hex');

/** The two COMP one-line fixes the composition skeptic established at $0 (source patches, for comparison only). */
export const FIXES = Object.freeze({
  // D3, ch-e8-2 crash collapse: a result for a phase already left is a late arrival only after cancel or failure.
  'ch-e8-2': ['reserving', 'charging', 'shipping'].map(ph => ({ file: 'modules/fulfil.mjs',
    find: `  if (st.phase !== '${ph}') return lateUndo(next, st.phase);`,
    replace: `  if (st.phase !== '${ph}') return (['cancelled','failed'].includes(st.phase) ? lateUndo(next, st.phase) : { output: { phase: st.phase, ignored: true } });` })),
  // D2, C-H-T duplicate cancel-refused notices: key the notice by the order, not by the triggering event.
  'cht-e8-1': [{ file: 'modules/cancellation.mjs', find: 'occurrence: input.eventId', replace: 'occurrence: orderId' }],
  'cht-e8-2': [{ file: 'modules/cancellation.mjs', find: 'occurrence: input.eventId', replace: 'occurrence: ctx.key' }],
  'cht-e8-3': [{ file: 'modules/cancellation.mjs', find: 'occurrence: input.eventId', replace: 'occurrence: ctx.key' }],
});

const COMPOSED = ['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3'];
const MONOLITHS = ['b1lh-e8-1', 'b1nh-e8-2', 'b1nh-e8-3'];
const specOf = label => (label.startsWith('b1') ? `solver:${MONO}/${label}/solver.mjs` : `program:${RUNS}/${label}/program`);
const R1_FAULTS = ['none', 'crash', 'dup-same'];

export function plan(which = 'all') {
  const out = [];
  if (which === 'main' || which === 'all') {
    for (const label of [...COMPOSED, ...MONOLITHS]) {
      out.push({ label, spec: specOf(label), runtime: 1, faults: R1_FAULTS });
      out.push({ label, spec: specOf(label), runtime: 2, faults: FAULTS });
    }
  }
  if (which === 'fixes' || which === 'all') {
    for (const [base, patches] of Object.entries(FIXES)) {
      const label = `${base}+fix-${base === 'ch-e8-2' ? 'd3' : 'd2'}`;
      out.push({ label, spec: specOf(base), runtime: 1, faults: R1_FAULTS, patches });
      out.push({ label, spec: specOf(base), runtime: 2, faults: R1_FAULTS, patches });
    }
  }
  if (which === 'readback') {
    // the read-back variant (runtime2 option reconcile): fault-free (must equal plain runtime 2) and crash (M4b)
    for (const label of [...COMPOSED, ...MONOLITHS]) out.push({ label: `${label}+readback`, spec: specOf(label), runtime: 2, faults: ['none', 'crash'], envelopeOptions: { reconcile: true } });
  }
  if (which === 'mutants' || which === 'all') {
    for (const base of ['cht-e8-1', 'b1lh-e8-1']) {
      for (const runtime of [1, 2]) out.push({ label: `${base}+mut-splitrefund`, spec: specOf(base), runtime, faults: ['none', 'downstream'], mutant: 'splitrefund' });
    }
  }
  return out;
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

export async function battery({ which = 'all', only = null, outDir, worlds = DEFAULT_WORLDS, log = console.log }) {
  mkdirSync(outDir, { recursive: true });
  const poolsCache = new Map();                             // reference pools per (world, fault): deterministic
  const harness = Object.fromEntries(['experiments/compose/runtime2.mjs', 'experiments/compose/effects.registry.json', 'experiments/compose/bundle2.mjs',
    'experiments/compose/fault-run2.mjs', 'experiments/compose/mutants2.mjs', 'experiments/compose/move2-battery.mjs',
    'experiments/compose/runtime.mjs', 'experiments/compose/bundle.mjs', 'experiments/compose/faults.mjs', 'experiments/compose/run.mjs'].map(p => [p, sha(p)]));
  for (const job of plan(which)) {
    if (only && !only.includes(job.label)) continue;
    const file = path.join(outDir, `${job.label}.r${job.runtime}.json`);
    const doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const subject = subjectOf2(job.spec, { runtime: job.runtime, patches: job.patches ?? [], mutant: job.mutant ?? null, label: job.label, envelopeOptions: job.envelopeOptions ?? {} });
    const out = doc ?? { subject: job.label, spec: job.spec, kind: subject.kind, runtime: job.runtime, runtimeLabel: job.runtime === 2 ? 'runtime2 (compose-runtime/2)' : 'runtime1 (frozen compose-runtime/1)',
      envelope: subject.envelope, envelopeOptions: job.envelopeOptions ?? {}, mutant: subject.mutant, patches: job.patches ?? [], gate: subject.gate,
      evidence: 'development (dev worlds 1161/1162/1164), $0, runtime2 outside the PREREG-COMP1 freeze (D28(3)); not a re-run of the prereg',
      harness, sourceDigest: createHash('sha256').update(subject.source).digest('hex'), results: [] };
    if (doc && JSON.stringify(doc.harness) !== JSON.stringify(harness)) { out.harnessChanged = [...new Set([...(doc.harnessChanged ?? []), new Date().toISOString()])]; }
    for (const w of worlds) {
      const W = e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail', size: w.size });
      for (const fault of job.faults) {
        if (out.results.some(r => r.seed === w.seed && r.fault === fault)) continue;
        const t = Date.now();
        const r = await runUnder2(subject, W, fault);
        const m = await measure({ subject, r, fault, poolsCache });
        const row = { seed: w.seed, d: w.d, size: w.size, ms: Date.now() - t, load: Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]), ...m };
        out.results.push(row);
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify(out, null, 1));
        renameSync(tmp, file);
        log(`${job.label} r${job.runtime} ${w.seed} ${fault} [${r.status}, inj ${m.injected}, ${row.ms} ms, load ${row.load}]: oracle ${m.oracle.passed}/${m.oracle.completed} crit ${m.oracle.critical} | dup ${m.exactlyOnce.duplicates} (money ${m.exactlyOnce.money}, conflicts ${m.exactlyOnce.keyConflicts}) | comp ${m.compensation.complete}/${m.compensation.due} | env ${JSON.stringify(m.envelope.byCode)} | deduped ${m.hostDeduped} | carry ${m.carryBytes.total}/${m.carryBytes.envelope} | arm errors ${m.armErrors}${job.mutant ? ` | mutant ${m.mutantActs}` : ''}`);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.chdir(ROOT);
  await battery({ which: arg('--plan', 'all'), only: arg('--only', null)?.split(',') ?? null, outDir: path.resolve(ROOT, arg('--out', 'research/blockers-20261021/move2/runs')) });
}
