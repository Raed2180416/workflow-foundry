// DUR-1 grading wrapper (PREREG-DUR-1 §2; BUILD-PLAN row 4). $0, analyst side only.
//   - pools: both reference timings run on the bundle (its item, binding and platform faults); a case is `completed`
//     iff both complete it (contract §6). The ep4 epoch's cases are exempt (casePools rule, stats-ebed.mjs:252).
//   - per case: pass (complete and no divergence), the first divergence, CRITICAL iff the first divergence is itself a
//     critical violation (the grader keeps counting critical rows after the first divergence, grade.mjs:104,155; those
//     are never counted here), the customer-visible TOPIC of the first divergence (complaints.mjs), the placement time.
//   - K-1 control check: both reference timings pass every completed case with 0 oracle errors.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { gradeStream } from '../../beds/ebed/oracle/grade.mjs';
import { parseLid } from '../../beds/ebed/e8/defects.mjs';
import { runBundle, referenceVersion } from './arms.mjs';
import { WORK } from './changes.mjs';

export const EXEMPT_EPOCHS = Object.freeze(['ep4']);
const COMP_LIDS = /^(rf|rel|csh):/;

/** Is the case's first divergence a critical violation? (money outside the allowed set, a duplicated money effect, or a missed compensation of a fulfilment left orphaned) */
export function criticalAtFirst(v) {
  const f = v.firstDivergence;
  if (!f || !v.critical?.length) return false;
  const atFirst = x => x.at && f.at && Date.parse(x.at) === Date.parse(f.at);
  if (f.code === 'outside-allowed' && v.critical.some(x => x.code === 'money-outside-allowed' && atFirst(x))) return true;
  if (f.code === 'duplicate' && v.critical.some(x => x.code === 'duplicate-money' && x.lid === f.lid)) return true;
  if (f.code === 'missed' && COMP_LIDS.test(f.lid ?? '')) {
    const F = parseLid(f.lid).F;
    return v.critical.some(x => (x.code === 'orphan-charge' || x.code === 'orphan-reservation') && x.fulfilment === F);
  }
  return false;
}

/** The customer-visible topic of a first divergence: charge, refund, notice, status, delivery; null if not visible. */
export function topicOf(f) {
  if (!f) return null;
  if (f.lid) {
    const k = parseLid(f.lid).kind;
    return { chg: 'charge', rf: 'refund', ntf: 'notice', ost: 'status', shp: 'delivery', csh: 'delivery' }[k] ?? null;
  }
  if (f.code === 'outside-allowed') {
    const k = `${f.system}.${f.op}`;
    if (k === 'billing.charge') return 'charge';
    if (k === 'billing.refund') return 'refund';
    if (k === 'notify.send') return 'notice';
    if (k === 'carrier.create' || k === 'carrier.cancel') return 'delivery';
    if (k === 'orders.setStatus' && (f.args?.fulfilmentId === null || f.args?.fulfilmentId === undefined)) return 'status';
  }
  return null;
}

const poolMem = new Map();
/**
 * The bundle's reference runs and pools (cached by world and item digest, in memory and on disk). Returns { pools,
 * control: { ok, problems }, rows: { earliest, latest } (in memory only when keepRows) }.
 */
export async function referencePools(bundle, { keepRows = false } = {}) {
  const key = `${bundle.worldDigest}-${bundle.itemDigest}`;
  if (poolMem.has(key) && (!keepRows || poolMem.get(key).rows)) return poolMem.get(key);
  const file = path.join(WORK, 'pools-v2', `${key}.json`);
  if (!keepRows && existsSync(file)) { const p = JSON.parse(readFileSync(file, 'utf8')); if (p.ends) { poolMem.set(key, p); return p; } }
  const runs = {}, verdicts = {};
  for (const timing of ['earliest', 'latest']) {
    runs[timing] = await runBundle(bundle, { version: referenceVersion({ id: `reference-${timing}`, timing }) });
    verdicts[timing] = gradeStream({ item: bundle.item, world: bundle.W, rows: runs[timing].rows });
  }
  const pools = {};
  for (const cv of verdicts.earliest.cases) {
    const other = verdicts.latest.cases.find(x => x.case === cv.case);
    pools[cv.case] = cv.complete && other?.complete ? 'completed' : 'censored';
  }
  const problems = [];
  for (const timing of ['earliest', 'latest']) {
    const v = verdicts[timing];
    for (const c of v.cases) if (pools[c.case] === 'completed' && !c.pass) problems.push(`${timing} fails ${c.case} (${c.firstDivergence?.code ?? 'unfinished'} ${c.firstDivergence?.lid ?? ''})`);
    if (v.oracleErrors.length) problems.push(`${timing}: ${v.oracleErrors.length} oracle errors (${v.oracleErrors[0].error.slice(0, 120)})`);
    if (!/complete/.test(runs[timing].status)) problems.push(`${timing}: run status ${runs[timing].status}`);
  }
  // The reference's end per completed order case (arm-independent "cases ended so far": false complaints, sweeps).
  const ends = {}, subjects = {};
  for (const cv of verdicts.earliest.cases) {
    const t = bundle.W.truth.cases[cv.case];
    if (!t.subject || pools[cv.case] !== 'completed') continue;
    ends[cv.case] = typeof cv.end?.at === 'number' ? cv.end.at : null;
    subjects[cv.case] = t.subject;
  }
  const out = { key, pools, ends, subjects, control: { ok: problems.length === 0, problems: problems.slice(0, 20), completed: Object.values(pools).filter(p => p === 'completed').length },
    ...(keepRows ? { rows: { earliest: runs.earliest.rows, latest: runs.latest.rows } } : {}) };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ key, pools, ends, subjects, control: out.control }));
  poolMem.set(key, out);
  return out;
}

/**
 * gradeRun(bundle, rows, pools) → { cases: [...], completed, passed, critical (cases), oracleErrors }. Only order cases of
 * the completed pool outside the exempt epoch are `graded`; every case is listed.
 */
export function gradeRun(bundle, rows, pools) {
  const v = gradeStream({ item: bundle.item, world: bundle.W, rows, pools });
  const cases = v.cases.map(c => {
    const t = bundle.W.truth.cases[c.case];
    const graded = c.pool === 'completed' && !EXEMPT_EPOCHS.includes(c.epoch) && t.subject !== null;
    const f = c.firstDivergence;
    return { case: c.case, subject: t.subject, class: c.class, epoch: c.epoch, pool: c.pool, graded, pass: c.pass, complete: c.complete,
      placedAt: t.placedAt ?? t.start, firstAt: f?.at ? Date.parse(f.at) : null,
      first: f ? { layer: f.layer, code: f.code, lid: f.lid ?? null, rule: f.rule ?? null, system: f.system ?? null, op: f.op ?? null } : null,
      critical: criticalAtFirst(c), criticalViolations: c.critical.length, topic: topicOf(f), oracleError: c.oracleError ?? null };
  });
  const g = cases.filter(c => c.graded);
  return { world: bundle.key, cases, completed: g.length, passed: g.filter(c => c.pass).length, critical: g.filter(c => c.critical).length,
    oracleErrors: v.oracleErrors.length, digest: v.digests.journal };
}

/** Index graded cases by id. */
export const byCase = grade => new Map(grade.cases.map(c => [c.case, c]));
