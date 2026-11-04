// Move 3: map stored and recomputed verifier outputs to obligations for verdict.mjs. No model call; the only labels a
// caller may join are for scoring, never passed in here.
//
//   rl2Ledgers(...)      the frozen requirement-ledger-v2 check phase, recomputed at $0 from the stored extractions
//                        (exactly run.mjs --phase check: per task the canonical row's view and initial world, grounding,
//                        the 2-of-3 merge), so the same ledger can be checked against any candidate world: a stored row,
//                        a mutant or a twin
//   rl2Obligations(...)  code checks -> obligations (decided by code); judged checks -> UNKNOWN 'judged-only' (or the
//                        TJ veto); effect_any false -> FAILED; plus each meaningful effect of the diff, explained when a
//                        passing positive check cites it (the closed-world complement)
//   ccObligations(...)   code-checks v1.1 as a veto: a failing hard check is FAILED, a failing soft one UNKNOWN; a
//                        passing generic sanity check is not a task obligation and is not counted
//   ownObligations(...)  the A1-C pipeline's own checks: code-decided ones as decided, checker verdicts as 'self-report'
//                        (reported only to replicate ATTACK's count; D28 (1) and RC3: no release consumes them)
// Generic by construction (PREREG-AB-v1 H7/H8): nothing here names a task, a grader string or a hidden assertion.
import { extractionInput, groundLedger, EXTRACT_VERSION } from '../requirement-ledger-v2/extract.mjs';
import { mergeLedgers } from '../requirement-ledger-v2/compile.mjs';
import { effectsOf, ptrMapper, runCodeChecks } from '../requirement-ledger-v2/check.mjs';
import { indexWorld } from '../requirement-ledger-v2/lib.mjs';

export const ADAPTERS_VERSION = 'tristate-adapters-v1';
const NEGATIVE = new Set(['msg_none', 'post_none', 'msg_lacks', 'created_none', 'rec_unchanged', 'rec_field_not', 'rec_kept', 'no_dup']);
const CONTENT = new Set(['msg_has', 'created_has', 'rec_field']);
const PTR_TYPES = new Set(['rec_changed', 'rec_field', 'rec_deleted']);

/** The canonical row per task as RL2 run.mjs chooses it: the first arm in the lab's order whose initial world was not rebuilt. */
export function canonicalRowsOf(rows, armOrder) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.task)) by.set(r.task, []); by.get(r.task).push(r); }
  const out = new Map();
  for (const [t, rs] of by) {
    const sorted = [...rs].sort((x, y) => armOrder.indexOf(x.arm) - armOrder.indexOf(y.arm));
    out.set(t, sorted.find(r => !r.worlds.initialRebuilt) ?? sorted[0]);
  }
  return out;
}

/** Per-reader verdict of RL2 code results: reader r rejects when a check it proposed fails, or nothing changed. */
export function readerVerdicts(results, merged) {
  const out = {};
  const effect = results.find(r => r.type === 'effect_any');
  for (const rd of new Set(merged.checks.flatMap(c => c.readers ?? []))) {
    let fails = 0;
    results.forEach((r, i) => { if (i > 0 && r.pass === false && (merged.checks[i - 1]?.readers ?? []).includes(rd)) fails++; });
    out[rd] = { accept: fails === 0 && effect?.pass !== false, fails };
  }
  return out;
}

/**
 * Merged RL2 ledgers per task from stored extractions (extract.jsonl rows {task, reader, ok, version, key, value}).
 * canonical: Map task -> canonical row ({ view, world0 }) chosen as run.mjs does. Returns Map task -> { merged, canonIdx }.
 */
export function rl2Ledgers(extractRows, canonical, { readers = ['haiku:0', 'haiku:1', 'haiku:2'], worldCap = 45000, hardSupport = null } = {}) {
  const ext = extractRows.filter(j => j.ok && j.version === EXTRACT_VERSION && readers.includes(j.reader));
  const out = new Map();
  for (const [task, c] of canonical) {
    const x = extractionInput(c.view, c.world0, { capChars: worldCap });
    const got = new Map();
    for (const j of ext) if (j.task === task && j.key.includes(x.key)) got.set(j.reader, j);
    const grounded = [...got.entries()].map(([reader, j]) => ({ reader, ...groundLedger(j.value, { view: c.view, idx: x.idx }) }));
    out.set(task, { merged: mergeLedgers(grounded, { hardSupport }), canonIdx: x.idx, readers: grounded.map(g => g.reader) });
  }
  return out;
}

/** RL2 code checks on one candidate, with the effects each passing positive check accounts for. */
export function rl2Check(ledger, { diff, world0, final }) {
  const rowIdx = indexWorld(world0);
  const res = runCodeChecks(ledger.merged, { diff, world0, final, canonIdx: ledger.canonIdx, rowIdx });
  const mapPtr = ptrMapper(ledger.canonIdx, rowIdx);
  const cites = new Set();
  res.results.forEach((r, i) => {
    if (i === 0 || r.pass !== true || NEGATIVE.has(r.type)) return;
    const m = /^([A-Za-z0-9_-]+)\.([^:\s]+):(\S+)$/.exec(String(r.evidence ?? ''));
    if (m) cites.add(`${m[1]}.${m[2]}:${m[3]}`);
    const c = ledger.merged.checks[i - 1];
    if (PTR_TYPES.has(r.type) && c?.params?.ptr) { const p = mapPtr(c.params.ptr); if (p) cites.add(`${p.app}.${p.coll}:${p.id}`); }
  });
  const eff = effectsOf(diff, world0);
  const effects = [];
  let k = 0;
  for (const kind of ['created', 'updated', 'deleted']) for (const e of eff[kind]) {
    const key = e.id === null || e.id === undefined ? `${e.app}.${e.coll}:#${k++}` : `${e.app}.${e.coll}:${e.id}`;
    effects.push({ key, kind, explained: cites.has(key) });
  }
  return { results: res.results, effects, judged: ledger.merged.judged ?? [] };
}

/** Obligations from RL2's code results (+ judged items with optional stored verdicts {id: {verdict}}). */
export function rl2Obligations(results, { judged = [], verdicts = null } = {}) {
  const out = [];
  for (const r of results) {
    if (r.type === 'effect_any') { if (r.pass === false) out.push({ id: 'rl2:effect_any', source: 'rl2', decidedBy: 'diff', polarity: 'must', established: true, pass: false, content: false }); continue; }
    out.push({ id: `rl2:${r.key}`, source: 'rl2', decidedBy: 'code', polarity: NEGATIVE.has(r.type) ? 'must_not' : 'must', established: Boolean(r.hard), pass: r.pass, content: CONTENT.has(r.type), type: r.type, cat: r.cat });
  }
  for (const j of judged) {
    const v = verdicts?.[j.id]?.verdict;
    out.push({ id: `rl2j:${j.id}`, source: 'rl2-judged', decidedBy: 'judge', polarity: j.kind === 'must_not' ? 'must_not' : 'must', established: Boolean(j.hard),
      pass: v === 'met' ? true : v === 'not_met' ? false : null, content: true, cat: j.cat });
  }
  return out;
}

/** Code-checks v1.1 as a veto (verify() output checks [{id, hard, status}]). */
export function ccObligations(checks) {
  return checks.filter(c => c.status === 'fail').map(c => ({ id: `cc:${c.id}`, source: 'cc', decidedBy: 'code', polarity: 'must_not', established: Boolean(c.hard), pass: false, content: false }));
}

/** The A1-C pipeline's own checks (lab row selfCheck.checks: [{id, hard, pass, by: code|checker, polarity}]). */
export function ownObligations(selfCheck) {
  if (!selfCheck || selfCheck.kind !== 'a1c-checks') return [];
  return (selfCheck.checks ?? []).map(c => ({ id: `own:${c.id}`, source: 'own', decidedBy: c.by === 'code' ? 'code' : 'self', polarity: c.polarity === 'must_not' ? 'must_not' : 'must',
    established: Boolean(c.hard), pass: c.pass === true ? true : c.pass === false ? false : null, content: true }));
}
