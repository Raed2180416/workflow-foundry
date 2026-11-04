// DUR-1 arms and runs ($0 here; model-driven arms are windows.mjs's). A VERSION is one thing that can act for an instance:
//   { kind: 'program', id, source, digest }        a Haiku- or Opus-written E8 program, run out of process in the sandbox
//                                                  arm (beds/ebed/host/sandbox-arm.mjs), exactly as FH-1 graded it;
//   { kind: 'reference', id, timing, armWorld? }    the analyst-side reference policy (oracle core) on the bundle's item;
//                                                  armWorld(W) is the world it believes (R-static: no rule change in force);
//   { kind: 'control', id }                         a bad or gaming control (beds/ebed/e8/controls.mjs);
//   { kind: 'arm', id, make(ctx) }                  any tick/1 arm (stubs, routing arms).
// A TIMELINE is [{ fromMs, version }]: the version in force for a tick is the last entry with fromMs <= the tick's time
// (a promotion at a day boundary). In-flight instances keep their carry across a swap. runBundle runs a timeline (or one
// version) through the unchanged E8 host on a world bundle (changes.mjs), with the bundle's platform faults (F) around it.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { referenceArm } from '../../beds/ebed/oracle/policy.mjs';
import { VARIANTS } from '../../beds/ebed/e8/controls.mjs';
import { subjectOf } from '../fh/grade.mjs';
import { ROOT, WORK } from './changes.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const MIN = 60_000;

/** A program version from `program:<dir>` (composed; bundled with the harness runtime) or `solver:<file>` (monolith). */
export function programVersion(spec, { id = null } = {}) {
  const s = subjectOf(spec);
  if (!s.source) throw new Error(`program ${spec} does not load: ${(s.problems ?? []).join('; ').slice(0, 300)}`);
  const dir = s.dir ?? (s.file ? path.dirname(s.file) : null);
  return Object.freeze({ kind: 'program', id: id ?? spec, spec, programKind: s.kind, dir, source: s.source, digest: sha(s.source).slice(0, 16), problems: s.problems ?? [] });
}
/** A program version from source text (a candidate patch kept in a run directory). */
export function sourceVersion(source, { id, programKind = 'monolith', dir = null } = {}) {
  return Object.freeze({ kind: 'program', id, spec: null, programKind, dir, source, digest: sha(source).slice(0, 16), problems: [] });
}
export const referenceVersion = ({ id = 'reference', timing = 'earliest', armWorld = null, item = null } = {}) => Object.freeze({ kind: 'reference', id, timing, armWorld, item });

const transitionCache = new Map();
/**
 * A version whose program is a transition module (LD-H: the reference policy driven by an edited copy of
 * beds/ebed/e8/transition.mjs, the file a patcher edits). The source is written under WORK/transition/ and imported.
 */
export async function transitionVersion(source, { id }) {
  const digest = sha(source).slice(0, 16);
  if (transitionCache.has(digest)) return Object.freeze({ ...transitionCache.get(digest), id });
  const dir = path.join(WORK, 'transition');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `transition-${digest}.mjs`);
  writeFileSync(file, source);
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.referenceTransition !== 'function' || typeof mod.canonicalArgs !== 'function') throw new Error('transition.mjs must export referenceTransition and canonicalArgs');
  const item = Object.freeze({ ...e8.oracleItem, referenceTransition: mod.referenceTransition, canonicalArgs: mod.canonicalArgs, ...(mod.recordsOf ? { recordsOf: mod.recordsOf } : {}) });
  const v = Object.freeze({ kind: 'reference', id, timing: 'earliest', armWorld: null, item, programKind: 'transition', source, digest, dir: null, spec: null, problems: [] });
  transitionCache.set(digest, v);
  return v;
}
/** A version from a kept program spec: `transition:<file>` (async import), or `program:<dir>` / `solver:<file>`. */
export async function versionOfSpec(spec, { id = null } = {}) {
  if (spec.startsWith('transition:')) return transitionVersion(readFileSync(spec.slice('transition:'.length), 'utf8'), { id: id ?? spec });
  return programVersion(spec, { id });
}
/** R-static's world: the reference believes no rule change is in force (data changes it reads from the world anyway). */
export const baseRules = W => { const w = structuredClone(W); w.truth.dur1Eff = {}; return w; };
export const controlVersion = id => Object.freeze({ kind: 'control', id });
export const armVersion = (id, make) => Object.freeze({ kind: 'arm', id, make });

const STANDALONE = {
  noop: () => ({ id: 'noop', tick: () => ({ decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: null }) }),
  echo: () => ({ id: 'echo', tick: input => {
    const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
    const s = input.carry?.subject ?? input.events.map(ev => norm(ev?.payload?.orderId ?? ev?.payload?.orderRef ?? null)).find(Boolean) ?? null;
    return { decisions: { subject: s }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: { subject: s } };
  } }),
  'declare-every-obligation': () => ({ id: 'declare-every-obligation', tick: input => {
    const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
    const s = input.carry?.subject ?? input.events.map(ev => norm(ev?.payload?.orderId ?? ev?.payload?.orderRef ?? null)).find(Boolean) ?? null;
    const now = Date.parse(input.now);
    const iso = m => `${new Date(m + 60 * MIN).toISOString().slice(0, 19)}+01:00`;
    const upsert = input.carry ? [] : Array.from({ length: 40 }, (_, i) => ({ id: `ob-${i}`, kind: 'any', anchor: null, dueAt: iso(now + (i + 1) * 30 * MIN), onDue: null }));
    return { decisions: { subject: s }, effects: [], obligations: { upsert, cancel: [] }, humanTasks: [], carry: { subject: s } };
  } }),
};
/** The bad and gaming controls V-2 runs on every changed world (prereg §2). */
export const BAD_CONTROLS = Object.freeze(['noop', 'echo', 'declare-every-obligation', 'escalate-everything', 'charge-twice', 'hold-everything']);

/**
 * timelineArm(entries) → arm. entries: [{ fromMs, make: () => arm, id }] sorted by fromMs (the first may be -Infinity).
 * Each entry's arm is made on its first tick and closed once a later entry is in force (time only moves forward).
 */
export function timelineArm(entries, { id = 'timeline' } = {}) {
  const list = [...entries].sort((a, b) => a.fromMs - b.fromMs);
  if (!list.length || list[0].fromMs > -Infinity) list.unshift({ fromMs: -Infinity, make: list[0]?.make ?? (() => STANDALONE.noop()), id: list[0]?.id ?? 'noop' });
  const made = new Map();
  let current = -1;
  const pick = now => { let k = 0; for (let i = 0; i < list.length; i++) if (list[i].fromMs <= now) k = i; return k; };
  const used = [];
  return {
    id,
    used,
    async tick(input, ctx) {
      const k = pick(Date.parse(input.now));
      if (k !== current) {
        for (const [j, a] of made) if (j < k) { try { a.close?.(); } catch { /* gone */ } made.delete(j); }
        current = k;
        used.push({ at: input.now, version: list[k].id });
      }
      if (!made.has(k)) made.set(k, list[k].make());
      return made.get(k).tick(input, ctx);
    },
    close() { for (const a of made.values()) { try { a.close?.(); } catch { /* gone */ } } made.clear(); },
  };
}

/** Make the arm of one version for one run (journal: the host journal accessor reference arms read). */
export function makeVersionArm(v, { bundle, journal, timeoutMs = 20_000 }) {
  if (v.kind === 'program') return sandboxArm({ id: String(v.id).slice(0, 60), solverSource: v.source, timeoutMs });
  if (v.kind === 'reference') {
    const armWorld = v.armWorld ? v.armWorld(bundle.W) : null;
    return referenceArm({ item: v.item ?? bundle.item, world: bundle.W, timing: v.timing, journal, id: v.id, ...(armWorld ? { variant: { armWorld } } : {}) });
  }
  if (v.kind === 'control') {
    if (STANDALONE[v.id]) return STANDALONE[v.id]();
    const V = VARIANTS[v.id];
    if (!V) throw new Error(`unknown control ${v.id}`);
    return referenceArm({ item: bundle.item, world: bundle.W, timing: 'earliest', journal, id: `control-${v.id}`, variant: V.variant(bundle.W) });
  }
  if (v.kind === 'arm') return v.make({ bundle, journal });
  throw new Error(`unknown version kind ${v.kind}`);
}

/**
 * runBundle(bundle, { timeline | version, ... }) → { rows, status, ms, faults, used }. The bundle's platform faults (F) wrap
 * the whole timeline (a crash or restart restarts whatever version is in force).
 */
export async function runBundle(bundle, { timeline = null, version = null, maxWakeups = 40_000, callTimeoutMs = 25_000, worldTimeoutMs = 900_000, timeoutMs = 20_000, hostOptions = {} } = {}) {
  const tl = timeline ?? [{ fromMs: -Infinity, version }];
  if (!tl.length || !tl[0].version) throw new Error('runBundle needs a timeline or a version');
  const holder = {};
  const journal = () => ({ committed: holder.host.journal.rows, staged: holder.host.journal.staged });
  const mk = () => timelineArm(tl.map(e => ({ fromMs: e.fromMs, id: e.version.id, make: () => makeVersionArm(e.version, { bundle, journal, timeoutMs }) })));
  let inner = mk();
  let arm = inner;
  if (bundle.wrapArm) arm = bundle.wrapArm(inner, () => (inner = mk()));
  holder.host = createHost({ item: bundle.binding, world: bundle.W, arm, maxWakeups, callTimeoutMs, ...hostOptions });
  const t0 = Date.now();
  let status, timer;
  try {
    status = (await Promise.race([holder.host.run(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`world took longer than ${worldTimeoutMs / 1000} s`)), worldTimeoutMs); })])).status;
  } catch (e) { status = `stopped: ${String(e?.message ?? e).slice(0, 200)}`; } finally { clearTimeout(timer); try { arm.close?.(); } catch { /* gone */ } }
  const rows = holder.host.journal.contentRows();
  return { rows, status, ms: Date.now() - t0, faults: arm.faults ?? [], used: inner.used ?? [] };
}

/** A digest of a journal's behaviour (FH-1's journalDigest: what was done, when, by whom; not the arm's labels). */
export const journalDigest = rows => sha(JSON.stringify(rows.map(r => [r.type, r.at ?? null, r.instance ?? null, r.key ?? null, r.system ?? null, r.op ?? null, r.committed ?? null, r.status ?? null])));

/**
 * The rows of a journal strictly before time T (by the host's wake-up clock; non-wake-up rows take the time of the last
 * wake-up), for prefix-identity checks and day-by-day monitors. `stamp`: append a synthetic wake-up at T (so an index's
 * "now" is T and deadlines up to T are judged).
 */
export function prefixRows(rows, T, { stamp = false } = {}) {
  const out = [];
  for (const r of rows) {
    if (r.type === 'wakeup' && Date.parse(r.at) >= T) break;
    if (r.type === 'run.end') break;
    out.push(r);
  }
  if (stamp) out.push({ type: 'wakeup', at: new Date(T).toISOString(), synthetic: true });
  return out;
}

/** Prefix identity (V-6): the behaviour of two journals before T is identical. */
export function samePrefix(a, b, T) {
  const pa = prefixRows(a, T), pb = prefixRows(b, T);
  const strip = rows => rows.filter(r => !['run.start', 'run.ready'].includes(r.type)).map(({ arm, ...r }) => r);
  return JSON.stringify(strip(pa)) === JSON.stringify(strip(pb));
}

/** The FH-1-commissioned starting versions (prereg §5 rule; V-11 checks 1,022/1,022 each on the grading worlds). */
export const LINEAGES = Object.freeze({
  'b1lh-e8-1': 'solver:research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs',
  'b1lh-e8-2': 'solver:research/heal-20261021/fh1/runs/b1lh-e8-2.H-C.k1/program/solver.mjs',
  'b1lh-e8-3': 'solver:research/heal-20261021/fh1/runs/b1lh-e8-3.H-C.k1/program/solver.mjs',
  'ch-e8-1': 'program:research/heal-20261021/fh1/runs/ch-e8-1.H-C.k1/program',
  'ch-e8-2': 'program:research/heal-20261021/fh1/runs/ch-e8-2.H-C.k1/program',
  'ch-e8-3': 'program:research/heal-20261021/fh1/runs/ch-e8-3.H-C.k2/program',
  'cht-e8-1': 'program:research/heal-20261021/fh1/runs/cht-e8-1.H-C.k1/program',
  'cht-e8-2': 'program:research/heal-20261021/fh1/runs/cht-e8-2.H-C.k1/program',
  'cht-e8-3': 'program:research/heal-20261021/fh1/runs/cht-e8-3.H-C.k1/program',
});
/** As delivered (S-H, descriptive), from FH-1's BUILDS. */
export const AS_DELIVERED = Object.freeze({
  'b1lh-e8-1': 'solver:research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs',
  'b1lh-e8-2': 'solver:research/enterprise-20261014/runs/b1lh-e8-2/solver.mjs',
  'b1lh-e8-3': 'solver:research/enterprise-20261014/runs/b1lh-e8-3/solver.mjs',
  'ch-e8-1': 'program:research/composition-20261021/runs/ch-e8-1/program',
  'ch-e8-2': 'program:research/composition-20261021/runs/ch-e8-2/program',
  'ch-e8-3': 'program:research/composition-20261021/runs/ch-e8-3/program',
  'cht-e8-1': 'program:research/composition-20261021/runs/cht-e8-1/program',
  'cht-e8-2': 'program:research/composition-20261021/runs/cht-e8-2/program',
  'cht-e8-3': 'program:research/composition-20261021/runs/cht-e8-3/program',
});
/** REF-S: the three blind specificity solvers (Opus-written, 1,749/1,749 each). */
export const REF_SOLVERS = Object.freeze({
  S1: 'solver:beds/ebed/e8/specificity/s1-state-machine.mjs',
  S2: 'solver:beds/ebed/e8/specificity/s2-reconciler.mjs',
  S3: 'solver:beds/ebed/e8/specificity/s3-saga-engine.mjs',
});
export const COMPOSED = Object.freeze(['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3']);
export const CHT = Object.freeze(['cht-e8-1', 'cht-e8-2', 'cht-e8-3']);
export { ROOT };
