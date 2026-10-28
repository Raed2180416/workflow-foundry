// FH-1 grading ($0): run any E8 subject (a composed program directory or a monolith solver.mjs) through the unchanged E8
// host in the out-of-process sandbox arm, and judge every completed case two ways:
//   - the E8 oracle (beds/ebed/e8 `oracle`, unchanged): the GRADER, used only on grading worlds and in analysis;
//   - the 13 capability contracts (experiments/compose/capabilities.mjs, unchanged): the VERIFIER the heal arm may use, written from
//     SPEC-E rules and independent of the oracle's step-by-step expectation; used on practice worlds.
// Per case it keeps pass/fail, class and first divergence (oracle) and the failing contracts with their first violations
// (contracts), so arms can be compared case by case (recoveries, regressions) on identical worlds.
// Reference pools (two reference runs per world) are deterministic; they are cached on disk keyed by world and a digest of the
// bed's code, so a changed bed never reuses a stale pool.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { evaluateCapabilities, DEFAULT_RULES } from '../compose/capabilities.mjs';
import { readProgram, bundle } from '../compose/bundle.mjs';
import { signatures } from '../tracker/nversion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const WORK = process.env.FH_WORK ?? '/var/tmp/foundry-work/fh';

// Worlds. Grading: the B1/COMP-1 dev rehearsal block (1232-1234 x d2, d3, d5), the denominator of every recorded build. Practice:
// the build loop's practice worlds (1235-1237), disjoint from grading. Never held-out or sealed seeds.
export const GRADING = Object.freeze([1232, 1233, 1234].flatMap(seed => [2, 3, 5].map(d => Object.freeze({ seed, d }))));
export const PRACTICE = Object.freeze([{ seed: 1235, d: 2 }, { seed: 1236, d: 3 }, { seed: 1237, d: 5 }].map(Object.freeze));
const ALLOWED = s => (s >= 1232 && s <= 1237);
export const worldKey = w => `${w.seed}:d${w.d}${w.size ? `:s${w.size}` : ''}`;

const sha = s => createHash('sha256').update(s).digest('hex');
const walk = d => readdirSync(d).sort().flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? (n === 'test' ? [] : walk(p)) : (p.endsWith('.mjs') || p.endsWith('.md') || p.endsWith('.json') ? [p] : []); });
let bedDigestCache = null;
export function bedDigest() {
  if (bedDigestCache) return bedDigestCache;
  const files = ['beds/ebed/e8', 'beds/ebed/oracle', 'beds/ebed/host', 'beds/ebed/lib'].flatMap(d => walk(path.join(ROOT, d)));
  bedDigestCache = sha(files.map(f => `${path.relative(ROOT, f)}\0${sha(readFileSync(f))}`).join('\n')).slice(0, 16);
  return bedDigestCache;
}

export function worldOf(w) {
  if (!ALLOWED(w.seed)) throw new Error(`FH_SEED_REFUSED: seed ${w.seed} is not a dev rehearsal or practice world`);
  return e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail', ...(w.size ? { size: w.size } : {}) });
}

const poolMem = new Map();
export async function poolsOf(w, world = worldOf(w)) {
  const key = `${worldKey(w)}@${bedDigest()}`;
  if (poolMem.has(key)) return poolMem.get(key);
  const file = path.join(WORK, 'pools', `${key.replaceAll(':', '_').replace('@', '-')}.json`);
  if (existsSync(file)) { const p = JSON.parse(readFileSync(file, 'utf8')); poolMem.set(key, p); return p; }
  const { pools } = await e8.referenceRuns(world);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(pools));
  poolMem.set(key, pools);
  return pools;
}

/**
 * A subject from a spec: `program:<dir>` (composed; bundled with the harness runtime) or `solver:<file>` (monolith).
 * Returns { spec, kind, source, digest, problems, manifest }.
 */
export function subjectOf(spec) {
  if (spec.startsWith('program:')) {
    const dir = path.resolve(ROOT, spec.slice(8));
    const prog = readProgram(dir);
    if (!prog.manifest) return { spec, kind: 'composed', dir, source: null, digest: null, problems: prog.problems, manifest: null };
    const b = bundle(prog, { item: e8 });
    return { spec, kind: 'composed', dir, source: b.source, digest: sha(b.source).slice(0, 16), problems: [...prog.problems, ...b.problems], manifest: prog.manifest };
  }
  if (spec.startsWith('solver:')) {
    const file = path.resolve(ROOT, spec.slice(7));
    const source = readFileSync(file, 'utf8');
    return { spec, kind: 'monolith', file, source, digest: sha(source).slice(0, 16), problems: [], manifest: null };
  }
  throw new Error(`unknown subject ${spec}`);
}

const journalDigest = rows => sha(JSON.stringify(rows.map(r => [r.type, r.at ?? null, r.instance ?? null, r.key ?? null, r.system ?? null, r.op ?? null, r.committed ?? null, r.status ?? null])));

/** Run a subject on one world and judge it. `judge`: 'oracle', 'contracts' or 'both'. */
export async function runWorld(subject, w, { judge = 'both', label = 'fh', worldTimeoutMs = 600_000, withSignatures = false, withRows = false } = {}) {
  const world = worldOf(w);
  const pools = await poolsOf(w, world);
  if (!subject.source) return { world: worldKey(w), status: 'not-loadable', problems: subject.problems, cases: [], armErrors: 0, digest: null };
  const arm = sandboxArm({ id: label.slice(0, 60), solverSource: subject.source, timeoutMs: 20_000 });
  const host = createHost({ item: e8.binding, world, arm, callTimeoutMs: 25_000, maxWakeups: 30_000 });
  let status, timer;
  const t0 = Date.now();
  try {
    status = (await Promise.race([host.run(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`world took longer than ${worldTimeoutMs / 1000} s`)), worldTimeoutMs); })])).status;
  } catch (e) { status = `stopped: ${String(e?.message ?? e).slice(0, 200)}`; } finally { clearTimeout(timer); arm.close(); }
  const rows = host.journal.contentRows();
  const armErrors = rows.filter(r => r.type === 'arm.error');
  const byCase = new Map();
  let critical = null;
  if (judge === 'oracle' || judge === 'both') {
    const v = e8.oracle(world, rows, { pools, arm: label });
    for (const c of v.cases.filter(x => x.pool === 'completed')) {
      const f = c.firstDivergence;
      byCase.set(c.case, { case: c.case, order: world.truth?.cases?.[c.case]?.subject ?? null, class: c.class, oracle: c.pass, first: f ? { layer: f.layer, code: f.code, rule: f.rule ?? null, lid: f.lid ?? null } : null });
    }
    critical = v.critical.length;
  }
  if (judge === 'contracts' || judge === 'both') {
    const caps = evaluateCapabilities(world, rows, { pools, rules: DEFAULT_RULES, canonicalArgs: e8.oracleItem.canonicalArgs });
    for (const c of caps.cases.filter(x => x.pool === 'completed')) {
      const rec = byCase.get(c.case) ?? { case: c.case, order: world.truth?.cases?.[c.case]?.subject ?? null, class: c.class };
      rec.contracts = c.pass;
      rec.failedContracts = c.failed;
      rec.violations = Object.fromEntries(Object.entries(c.violations).map(([cap, vs]) => [cap, vs.slice(0, 3).map(([rule, detail]) => [rule, String(detail).slice(0, 220)])]));
      byCase.set(c.case, rec);
    }
  }
  return { world: worldKey(w), status, ms: Date.now() - t0, armErrors: armErrors.length, armErrorSamples: armErrors.slice(0, 4).map(e => `${e.instance ?? ''} ${e.code ?? ''} ${JSON.stringify(e.detail ?? e.error ?? '').slice(0, 200)}`),
    critical, digest: journalDigest(rows), cases: [...byCase.values()].sort((a, b) => a.case.localeCompare(b.case)),
    ...(withSignatures ? { signatures: Object.fromEntries(signatures(rows)) } : {}), ...(withRows ? { rows } : {}) };
}

/** Grade a subject on a set of worlds; returns { spec, digest, worlds: [...], totals }. */
export async function gradeSubject(spec, { worlds = GRADING, judge = 'both', label = 'fh', log = () => {}, withSignatures = false } = {}) {
  const subject = typeof spec === 'string' ? subjectOf(spec) : spec;
  const out = [];
  for (const w of worlds) {
    const r = await runWorld(subject, w, { judge, label, withSignatures });
    out.push(r);
    log(`  ${r.world}: ${summarise([r]).oracle ?? '-'} oracle, ${summarise([r]).contracts ?? '-'} contracts, arm errors ${r.armErrors}, ${Math.round((r.ms ?? 0) / 1000)} s`);
  }
  return { spec: subject.spec, kind: subject.kind, digest: subject.digest, problems: subject.problems, worlds: out, totals: totals(out) };
}

export function totals(worlds) {
  const cases = worlds.flatMap(w => w.cases.map(c => ({ ...c, world: w.world })));
  const n = cases.length;
  const oracle = cases.filter(c => c.oracle !== undefined), contracts = cases.filter(c => c.contracts !== undefined);
  return { completed: n, oraclePassed: oracle.filter(c => c.oracle).length, oracleN: oracle.length, contractsPassed: contracts.filter(c => c.contracts).length, contractsN: contracts.length,
    armErrors: worlds.reduce((s, w) => s + (w.armErrors ?? 0), 0), critical: worlds.reduce((s, w) => s + (w.critical ?? 0), 0) };
}
export function summarise(worlds) {
  const t = totals(worlds);
  return { oracle: t.oracleN ? `${t.oraclePassed}/${t.oracleN}` : null, contracts: t.contractsN ? `${t.contractsPassed}/${t.contractsN}` : null };
}

/** Case-level comparison of two gradings on the same worlds: recoveries (fail -> pass), regressions (pass -> fail). */
export function compare(before, after, { by = 'oracle' } = {}) {
  const idx = g => new Map(g.worlds.flatMap(w => w.cases.map(c => [`${w.world}/${c.case}`, c])));
  const B = idx(before), A = idx(after);
  const out = { recovered: [], regressed: [], stillFailing: [], missing: [] };
  for (const [k, b] of B) {
    const a = A.get(k);
    if (!a) { out.missing.push(k); continue; }
    if (!b[by] && a[by]) out.recovered.push({ key: k, class: b.class });
    else if (b[by] && !a[by]) out.regressed.push({ key: k, class: b.class });
    else if (!b[by] && !a[by]) out.stillFailing.push({ key: k, class: b.class });
  }
  return { ...out, nRecovered: out.recovered.length, nRegressed: out.regressed.length, nStillFailing: out.stillFailing.length, net: out.recovered.length - out.regressed.length };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const spec = arg('--subject');
  const worlds = arg('--worlds', 'grading') === 'practice' ? PRACTICE : arg('--worlds', 'grading') === 'grading' ? GRADING
    : arg('--worlds').split(',').map(s => { const [seed, d, size] = s.split(':').map(Number); return { seed, d, ...(size ? { size } : {}) }; });
  const g = await gradeSubject(spec, { worlds, judge: arg('--judge', 'both'), label: arg('--label', 'fh-grade'), log: console.log });
  const out = arg('--out', null);
  if (out) { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ ...g, bedDigest: bedDigest(), at: new Date().toISOString() }, null, 1)); }
  console.log(JSON.stringify({ spec, digest: g.digest, totals: g.totals }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
