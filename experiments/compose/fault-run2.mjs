// Run one subject under the fault harness with compose-runtime/1 or /2 (research/blockers-20261021/MOVE2-COMP.md;
// development evidence, $0, dev seeds only). fault-run.mjs (frozen by PREREG-COMP1) is imported, not edited.
//   node experiments/compose/fault-run2.mjs --subject program:<dir> | solver:<file.mjs> --runtime 1|2
//        [--worlds 1161:2:40,1162:3:40,1164:5:60] [--faults none,crash,dup-same] [--mode strict] [--out <json>]
// runtime 1: the frozen bundle (composed) or the solver as built (monolith), exactly as fault-run.mjs runs them.
// runtime 2: a composed program is bundled by bundle2.mjs (the envelope runs inside the sandbox, around the composed
// runtime); a monolith runs behind the same envelope host-side (withEnvelope around its sandbox arm), so both kinds of
// arm meet the same identity keys and inbox. Beyond fault-run.mjs's row, each row records the logical digest (the
// journal with effect keys renamed by first appearance and the envelope's own carry and findings removed: equal
// digests mean the envelope changed nothing the host or the program can observe), the envelope's findings by code,
// the host's deduplicated re-emissions, key conflicts, duplicates by case, cases bound to more than one instance (the
// same-instant start race D4 shows up as extra ones under dup-same), the largest carry (and the envelope's share), and
// the per-case pass vector. The composed reference (reference.mjs) is not run under runtime 2: it reads the host's
// journal directly, so re-keyed journal rows would confound it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { behaviourDigest } from '../../beds/ebed/e8/defects.mjs';
import { readProgram, bundle } from './bundle.mjs';
import { bundle2, E8_REGISTRY } from './bundle2.mjs';
import { withEnvelope, envCanonical, R2_CARRY, singleWriterMessages } from './runtime2.mjs';
import { MUTANTS } from './mutants2.mjs';
import { withRestart, withCrash, faultedWorld } from './faults.mjs';
import { poolsFor, runArm, assess } from './run.mjs';

const ALLOWED = s => (s >= 1001 && s <= 1199) || (s >= 1232 && s <= 1234);
const sha = s => createHash('sha256').update(s).digest('hex');
export const DEFAULT_WORLDS = Object.freeze([{ seed: 1161, d: 2, size: 40 }, { seed: 1162, d: 3, size: 40 }, { seed: 1164, d: 5, size: 60 }]);

/** Apply in-memory source edits to a program: [{ file (suffix), find, replace }] (each `find` must occur exactly once). */
export function patchSources(prog, patches = []) {
  const sources = { ...prog.sources };
  for (const p of patches) {
    const f = Object.keys(sources).find(x => x.endsWith(p.file));
    if (!f) throw new Error(`patch: no file ending ${p.file}`);
    const n = sources[f].split(p.find).length - 1;
    if (n !== 1) throw new Error(`patch: ${p.file}: the text to replace occurs ${n} times (must be exactly once)`);
    sources[f] = sources[f].replace(p.find, () => p.replace);
  }
  return { ...prog, sources };
}

/**
 * A subject: { label, runtime, kind, manifest, source, envelope: null | 'bundle' | 'host', mutant, registry, gate }.
 * Under runtime 2 a composed program carries the envelope inside its bundle; a monolith, and any subject with an
 * arm-boundary mutant (mutants2.mjs, which plays the program and so must sit inside the envelope), gets it host-side.
 * `envelope: 'host'` forces the host-side gateway for a composed program too (the two sites must agree).
 */
export function subjectOf2(spec, { mode = 'strict', runtime = 2, patches = [], registry = E8_REGISTRY, label = null, mutant = null, envelope = null, envelopeOptions = {} } = {}) {
  if (![1, 2].includes(runtime)) throw new Error(`runtime must be 1 or 2: ${runtime}`);
  if (mutant !== null && !MUTANTS[mutant]) throw new Error(`unknown mutant ${mutant} (${Object.keys(MUTANTS).join(', ')})`);
  const site = runtime === 1 ? null : envelope ?? (spec.startsWith('program:') && !mutant ? 'bundle' : 'host');
  if (spec.startsWith('program:')) {
    let prog = readProgram(spec.slice(8));
    if (prog.problems.length) throw new Error(`program problems: ${prog.problems.join('; ')}`);
    if (patches.length) prog = patchSources(prog, patches);
    // gate 'report': the stored COMP-1 programs were built before the gate existed; a replay runs them and records it
    const b = site === 'bundle' ? bundle2({ ...prog, mode }, { item: e8, registry, envelopeOptions, gate: 'report' }) : bundle({ ...prog, mode }, { item: e8 });
    if (b.problems.length) throw new Error(`program problems: ${b.problems.join('; ')}`);
    const gate = site ? singleWriterMessages(prog.manifest, registry) : null;
    return { label: label ?? spec, runtime, kind: 'composed', manifest: prog.manifest, source: b.source, envelope: site, envelopeOptions, mutant, registry, gate, gateMode: site ? 'report' : null, patches: patches.length };
  }
  if (spec.startsWith('solver:')) {
    if (patches.length) throw new Error('patches apply to composed programs only');
    return { label: label ?? spec, runtime, kind: 'monolith', manifest: null, source: readFileSync(spec.slice(7), 'utf8'), envelope: site, envelopeOptions, mutant, registry, gate: null, patches: 0 };
  }
  throw new Error(`unknown subject ${spec} (program:<dir> or solver:<file>)`);
}

/** Run a subject on one world under one fault; returns { world, binding, status, rows, faults, mutantActs }. */
export async function runUnder2(subject, W, fault) {
  const { world, binding } = faultedWorld(W, fault);
  const counter = { n: 0 };
  const make = () => {
    let a = sandboxArm({ id: subject.label.slice(0, 60), solverSource: subject.source, timeoutMs: 20_000 });
    if (subject.mutant) a = MUTANTS[subject.mutant](a, { counter });
    return subject.envelope === 'host' ? withEnvelope(a, { registry: subject.registry, id: `${a.id}+env2`, ...(subject.envelopeOptions ?? {}) }) : a;
  };
  const arm = fault === 'restart' ? withRestart(make(), make) : fault === 'crash' ? withCrash(make(), make) : make();
  try {
    const r = await runArm({ world, arm, binding, callTimeoutMs: 25_000 });
    return { world, binding, status: r.status, rows: r.rows, faults: arm.faults ?? [], mutantActs: counter.n, sorTables: sorTablesDigest(r.host) };
  } finally { arm.close?.(); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Journal measures

const KEY_FIELDS = new Set(['key', 'after', 'compensates']);

/**
 * The journal as the host and the program observe it, independent of key spelling: run start/end and the arm label
 * dropped (as behaviourDigest does), call rows without their input digest (a function of the delivered events and the
 * previous carry, both compared directly), the envelope's carry unwrapped to the program's own carry, the envelope's
 * findings removed, carry.commit digests dropped, and every effect key (key, after, compensates) renamed by order of
 * first appearance.
 */
export function logicalRows(rows) {
  const ren = new Map();
  const rk = v => { if (!ren.has(v)) ren.set(v, `k${ren.size + 1}`); return ren.get(v); };
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = KEY_FIELDS.has(k) && typeof v[k] === 'string' ? rk(v[k]) : walk(v[k]);
      return o;
    }
    return v;
  };
  return rows.filter(r => r.type !== 'run.start').map(({ arm, ...r0 }) => {
    let r = r0;
    if (r.type === 'run.end') {
      // Both end digests hash idempotency keys (the ledger rows, and each mock's key table inside the SoR digest), so
      // they are dropped here; the business state is compared key-free by sorTablesDigest (measure's digest.sorTables).
      const { digests, ...rest } = r;
      r = { ...rest, pending: (r.pending ?? []).map(k => (typeof k === 'string' ? rk(k) : k)) };
    }
    if (r.type === 'call') {
      const { inputDigest, ...rest } = r;
      r = rest;
      if (r.output && typeof r.output === 'object') {
        const o = { ...r.output };
        if (o.carry && typeof o.carry === 'object' && o.carry.cv === R2_CARRY) o.carry = o.carry.c ?? null;
        if (o.decisions && typeof o.decisions === 'object' && o.decisions.envelope) { const { envelope, ...d } = o.decisions; o.decisions = d; }
        r = { ...r, output: o };
      }
    }
    if (r.type === 'carry.commit') { const { digest, ...rest } = r; r = rest; }
    // A batch item's ledger digest hashes the item with its key (mocks.mjs itemDigest); its arguments are compared
    // through the call row's effects, so the digest is dropped. A single op's digest hashes its arguments only and stays.
    if (r.type === 'ledger' && typeof r.batchIndex === 'number') { const { argsDigest, ...rest } = r; r = rest; }
    return walk(r);
  });
}
export const logicalDigest = rows => sha(envCanonical(logicalRows(rows)));

/** The systems of record at the end of a run without their idempotency-key tables: business rows and id counters. */
export function sorTablesDigest(host) {
  if (!host?.systems) return null;
  return sha(envCanonical([...host.systems.values()].map(sys => { const { tables, counters } = sys.state(); return [sys.id, { tables, counters }]; })));
}

/** The envelope's findings in a journal, by code. */
export function envelopeFindings(rows) {
  const byCode = {}, examples = [];
  for (const r of rows) {
    const env = r.type === 'call' ? r.output?.decisions?.envelope : null;
    if (!env) continue;
    for (const f of env.findings ?? []) { byCode[f.code] = (byCode[f.code] ?? 0) + 1; if (examples.length < 6) examples.push(f); }
  }
  return { byCode, examples };
}

/** Cases with more than one instance bound to them (a duplicate start message opened a second instance: D4). */
export function twinCases(rows) {
  const n = new Map();
  for (const r of rows) if (r.type === 'instance.open' && r.binding !== null && r.binding !== undefined) n.set(r.binding, (n.get(r.binding) ?? 0) + 1);
  return [...n].filter(([, k]) => k > 1).map(([c]) => c).sort();
}

const bytesOf = v => Buffer.byteLength(JSON.stringify(v ?? null));
/** The largest carry a call returned, and the largest envelope share of one. */
export function carryBytes(rows) {
  let total = 0, envelope = 0;
  for (const r of rows) {
    if (r.type !== 'call' || r.output?.carry === undefined) continue;
    const c = r.output.carry;
    total = Math.max(total, bytesOf(c));
    if (c && typeof c === 'object' && c.cv === R2_CARRY) envelope = Math.max(envelope, bytesOf(c.x));
  }
  return { total, envelope };
}

/** Every measure of one run. */
export async function measure({ subject, r, fault, poolsCache = null }) {
  const ck = `${r.world.id}|${fault}`;
  if (poolsCache && !poolsCache.has(ck)) poolsCache.set(ck, (await poolsFor(r.world, { binding: r.binding })).pools);
  const pools = poolsCache ? poolsCache.get(ck) : (await poolsFor(r.world, { binding: r.binding })).pools;
  const a = assess({ world: r.world, rows: r.rows, pools, manifest: subject.kind === 'composed' ? subject.manifest : null });
  const completed = Object.entries(pools).filter(([, p]) => p === 'completed').map(([c]) => c);
  const failing = new Set(a.oracle.failing.map(f => f.case));
  const eo = a.faults.exactlyOnce;
  return {
    fault, status: r.status, injected: r.faults.length, mutantActs: r.mutantActs ?? 0,
    oracle: { completed: a.oracle.completed, passed: a.oracle.passed, critical: a.oracle.critical, codes: a.oracle.codes },
    capabilities: { completed: a.capabilities.completed, passed: a.capabilities.passed },
    exactlyOnce: { duplicates: eo.duplicates.length, money: eo.money, keyConflicts: eo.keyConflicts, dupCases: [...new Set(eo.duplicates.map(d => d.case))].sort(), examples: eo.duplicates.slice(0, 6) },
    compensation: { due: a.faults.compensation.due, complete: a.faults.compensation.complete },
    interface: a.interface ? { violations: a.interface.violations, dropped: a.interface.dropped, integrity: a.interface.integrity.length } : null,
    armErrors: a.armErrors,
    envelope: envelopeFindings(r.rows),
    hostDeduped: r.rows.filter(x => x.type === 'effect.deduped').length,
    multiInstanceCases: twinCases(r.rows),
    carryBytes: carryBytes(r.rows),
    digest: { raw: behaviourDigest(r.rows), logical: logicalDigest(r.rows), sorTables: r.sorTables ?? null },
    passing: completed.filter(c => !failing.has(c)).sort(),
    failingCases: [...failing].sort(),
  };
}

export async function faultRun2({ subject, worlds = DEFAULT_WORLDS, faults = ['none', 'crash', 'dup-same'], log = console.log }) {
  const out = { subject: subject.label, kind: subject.kind, runtime: subject.runtime, envelope: subject.envelope, mutant: subject.mutant, patches: subject.patches, gate: subject.gate, date: new Date().toISOString().slice(0, 10),
    evidence: 'development (dev worlds); $0; compose-runtime/2 is a new harness version outside the PREREG-COMP1 freeze (D28(3))',
    sourceDigest: sha(subject.source), worlds: [], results: [] };
  for (const w of worlds) {
    if (!ALLOWED(w.seed)) throw new Error(`seed ${w.seed}: dev (1001-1199) or E8 dev rehearsal (1232-1234) seeds only`);
    const W = e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail', ...(w.size ? { size: w.size } : {}) });
    out.worlds.push(w);
    for (const fault of faults) {
      const t = Date.now();
      const r = await runUnder2(subject, W, fault);
      const m = await measure({ subject, r, fault });
      const row = { seed: w.seed, d: w.d, size: w.size ?? null, ms: Date.now() - t, ...m };
      out.results.push(row);
      log(`${subject.label} r${subject.runtime} ${w.seed} d${w.d} ${fault} [${r.status}, ${row.injected} injected, ${row.ms} ms]: oracle ${m.oracle.passed}/${m.oracle.completed} crit ${m.oracle.critical} | dup ${m.exactlyOnce.duplicates} (money ${m.exactlyOnce.money}, conflicts ${m.exactlyOnce.keyConflicts}) | comp ${m.compensation.complete}/${m.compensation.due} | env ${JSON.stringify(m.envelope.byCode)} | hostDeduped ${m.hostDeduped} | multi-instance cases ${m.multiInstanceCases.length} | carry ${m.carryBytes.total} B (envelope ${m.carryBytes.envelope}) | arm errors ${m.armErrors}${subject.mutant ? ` | mutant acts ${m.mutantActs}` : ''}`);
    }
  }
  return out;
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const subject = subjectOf2(arg('--subject', ''), { mode: arg('--mode', 'strict'), runtime: Number(arg('--runtime', '2')), label: arg('--label', null), mutant: arg('--mutant', null), envelope: arg('--envelope', null) });
  const worlds = arg('--worlds', null)?.split(',').map(s => { const [seed, d, size] = s.split(':').map(Number); return { seed, d, size }; }) ?? DEFAULT_WORLDS;
  const faults = arg('--faults', 'none,crash,dup-same').split(',');
  const res = await faultRun2({ subject, worlds, faults });
  const o = arg('--out', null);
  if (o) { mkdirSync(path.dirname(o), { recursive: true }); writeFileSync(o, JSON.stringify(res, null, 1)); }
}
