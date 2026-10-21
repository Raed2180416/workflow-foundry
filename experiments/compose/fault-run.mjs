// Run one subject under every fault of the harness and judge it on every signal (research/composition-20261021/
// HARNESS.md §4). $0 for code subjects (no model calls).
//   node experiments/compose/fault-run.mjs --subject ref[:variant] | program:<dir> | solver:<file.mjs>
//        [--worlds 1161:2:40,1164:5:60] [--faults none,restart,crash,dup-delayed,dup-same,downstream] [--mode strict]
//        [--set-key saga.mjs:KEYED=time] [--out <json>]
// Worlds: dev seeds only (E-bed dev block 1001-1199) or the E8 dev rehearsal block 1232-1234 (the paired B1L-H worlds);
// never held-out or sealed seeds. A program subject is bundled by the harness (bundle.mjs) and run in the sandbox arm;
// a solver subject (a monolith tick/1 solver.mjs) runs in the sandbox arm as built. The `restart` fault also checks that
// the journal's behaviour is identical to the fault-free run (a solver keeping state only where the interface allows).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { behaviourDigest } from '../../beds/ebed/e8/defects.mjs';
import { readProgram, bundle } from './bundle.mjs';
import { withRestart, withCrash, faultedWorld, FAULTS } from './faults.mjs';
import { poolsFor, runArm, runComposedReference, assess, brief } from './run.mjs';
import { manifestFor } from './reference.mjs';

const ALLOWED = s => (s >= 1001 && s <= 1199) || (s >= 1232 && s <= 1234);

/** A subject: { label, manifest, make(world) → arm, inProcess } */
export function subjectOf(spec, { mode = 'strict', setKey = null } = {}) {
  if (spec === 'ref' || spec.startsWith('ref:')) {
    const variant = spec.split(':')[1] ?? null;
    return { label: spec, manifest: manifestFor(variant), ref: { variant, mode } };
  }
  if (spec.startsWith('program:')) {
    const dir = spec.slice(8);
    const prog = readProgram(dir);
    if (setKey) {                                   // a probe switch (fixtures only): replace `const NAME = '...'` in one file
      const [file, kv] = setKey.split(':'); const [name, value] = kv.split('=');
      const f = Object.keys(prog.sources).find(x => x.endsWith(file));
      prog.sources[f] = prog.sources[f].replace(new RegExp(`const ${name} = '[^']*';`), `const ${name} = '${value}';`);
    }
    const b = bundle({ ...prog, mode }, { item: e8 });
    if (b.problems.length) throw new Error(`program problems: ${b.problems.join('; ')}`);
    return { label: spec + (setKey ? `[${setKey}]` : ''), manifest: prog.manifest, source: b.source };
  }
  if (spec.startsWith('solver:')) return { label: spec, manifest: null, source: readFileSync(spec.slice(7), 'utf8') };
  throw new Error(`unknown subject ${spec}`);
}

/** Run a subject on one world under one fault; returns { status, rows, faults, binding }. */
export async function runUnder(subject, W, fault) {
  const { world, binding } = faultedWorld(W, fault);
  const wrap = (arm, factory) => (fault === 'restart' ? withRestart(arm, factory) : fault === 'crash' ? withCrash(arm, factory) : arm);
  if (subject.ref) {
    let wrapped = null;
    const r = await runComposedReference({ world, binding, variant: subject.ref.variant, mode: subject.ref.mode, wrap: (a, f) => (wrapped = wrap(a, f)) });
    return { world, binding, status: r.status, rows: r.rows, faults: wrapped?.faults ?? [] };
  }
  const make = () => sandboxArm({ id: subject.label.slice(0, 60), solverSource: subject.source, timeoutMs: 20_000 });
  const arm = wrap(make(), make);
  try {
    const r = await runArm({ world, arm, binding, callTimeoutMs: 25_000 });
    return { world, binding, status: r.status, rows: r.rows, faults: arm.faults ?? [] };
  } finally { arm.close?.(); }
}

export async function faultRun({ subject, worlds, faults = FAULTS, log = console.log }) {
  const out = { subject: subject.label, date: new Date().toISOString().slice(0, 10), evidence: 'development (dev worlds); $0', worlds: [], results: [] };
  for (const w of worlds) {
    if (!ALLOWED(w.seed)) throw new Error(`seed ${w.seed}: dev (1001-1199) or E8 dev rehearsal (1232-1234) seeds only`);
    const W = e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail', ...(w.size ? { size: w.size } : {}) });
    out.worlds.push(w);
    let baseDigest = null;
    for (const fault of faults) {
      const t = Date.now();
      const r = await runUnder(subject, W, fault);
      const { pools } = await poolsFor(r.world, { binding: r.binding });
      const a = assess({ world: r.world, rows: r.rows, pools, manifest: subject.manifest });
      const digest = behaviourDigest(r.rows);
      if (fault === 'none') baseDigest = digest;
      const row = { seed: w.seed, d: w.d, size: w.size ?? null, fault, status: r.status, ms: Date.now() - t, injected: r.faults.length,
        sameJournalAsFaultFree: fault === 'restart' && baseDigest ? digest === baseDigest : null,
        oracle: { completed: a.oracle.completed, passed: a.oracle.passed, critical: a.oracle.critical, codes: a.oracle.codes },
        capabilities: { completed: a.capabilities.completed, passed: a.capabilities.passed, byCapability: a.capabilities.byCapability },
        exactlyOnce: { duplicates: a.faults.exactlyOnce.duplicates.length, money: a.faults.exactlyOnce.money, examples: a.faults.exactlyOnce.duplicates.slice(0, 5) },
        compensation: { due: a.faults.compensation.due, complete: a.faults.compensation.complete, incomplete: a.faults.compensation.incomplete.slice(0, 5) },
        interface: a.interface ? { violations: a.interface.violations, byCode: a.interface.violationsByCode, dropped: a.interface.dropped, integrity: a.interface.integrity.length } : null,
        armErrors: a.armErrors };
      out.results.push(row);
      log(`${subject.label} ${w.seed} d${w.d} ${fault} [${r.status}, ${row.injected} injected, ${row.ms} ms${row.sameJournalAsFaultFree !== null ? `, same journal ${row.sameJournalAsFaultFree}` : ''}]: ${brief(a)}`);
    }
  }
  return out;
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const subject = subjectOf(arg('--subject', 'ref'), { mode: arg('--mode', 'strict'), setKey: arg('--set-key', null) });
  const worlds = arg('--worlds', '1161:2:40,1164:5:60').split(',').map(s => { const [seed, d, size] = s.split(':').map(Number); return { seed, d, size }; });
  const faults = arg('--faults', FAULTS.join(',')).split(',');
  const res = await faultRun({ subject, worlds, faults });
  const o = arg('--out', null);
  if (o) { mkdirSync(path.dirname(o), { recursive: true }); writeFileSync(o, JSON.stringify(res, null, 1)); }
}
