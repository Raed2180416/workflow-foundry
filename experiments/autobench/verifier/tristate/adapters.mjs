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
//   rl2ReaderLedgers(...) one ledger per RL2 reader, compiled from that reader's extraction ALONE (K = 1): an independent
//                        reader, not that reader's share of the merged ledger (review finding 13)
//   ccClock(...)         code-checks run twice: with the world's hidden clock (meta.current_time, as the lab ran) and
//                        clock-blind per D28 (2) ("today" derived from the work items' business dates, else a labelled
//                        null); a check whose decision needed the hidden clock becomes UNKNOWN 'labelled-null'
//
// Review fixes (tristate-adapters-v2, 2026-11-04): a passing positive check explains EVERY effect it matches (v1 cited
// only the first, through its evidence string, so 1 in 3 "unexplained" effects were artefacts, and effects without an id
// could never be explained); a further match with the same recipients and content is a 'duplicate' effect, not an
// unexplained one.
// Generic by construction (PREREG-AB-v1 H7/H8): nothing here names a task, a grader string or a hidden assertion.
import { extractionInput, groundLedger, EXTRACT_VERSION } from '../requirement-ledger-v2/extract.mjs';
import { mergeLedgers } from '../requirement-ledger-v2/compile.mjs';
import { effectsOf, ptrMapper, runCodeChecks } from '../requirement-ledger-v2/check.mjs';
import { combine } from '../requirement-ledger-v2/verify.mjs';
import { containsLiteral, indexWorld, norm } from '../requirement-ledger-v2/lib.mjs';
import { verify as ccVerify } from '../code-checks/verify.mjs';
import { datesIn, dayNumber, leaves } from '../code-checks/lib.mjs';

export const ADAPTERS_VERSION = 'tristate-adapters-v2';
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

/**
 * Reader r's SHARE of the merged ledger (v1's reader signal): r rejects when a check it proposed fails after the 2-of-3
 * merge, deduplication and contradiction drops, or nothing changed. Not an independent reader (it is a component of the
 * aggregate it is compared with): kept only to show the difference; the reader signal is readerAccept on
 * rl2ReaderLedgers.
 */
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
    const costUsd = [...got.values()].reduce((a, j) => a + (Number.isFinite(j.costUsd) ? j.costUsd : 0), 0);
    out.set(task, { merged: mergeLedgers(grounded, { hardSupport }), canonIdx: x.idx, readers: grounded.map(g => g.reader), costUsd });
  }
  return out;
}

// ---- which effects a passing positive check accounts for (the same matching as requirement-ledger-v2/check.mjs
// evaluateCheck, returning every matching effect object instead of the first one's address)
const whereOf = e => `${e.app}.${e.coll}:${e.id}`;
function messagesToAll(target, eff, mapPtr) {
  if (target?.email) {
    const e = target.email;
    return [...eff.created.filter(c => c.recipients.has(e)), ...eff.updated.filter(u => u.reply && u.beforeEmails.has(e))];
  }
  if (target?.channel) {
    const ids = new Set([target.channel.id, target.channel.name].filter(Boolean).map(x => norm(x)));
    return eff.created.filter(c => c.channel && ids.has(norm(c.channel)));
  }
  if (target?.ptr) {
    const r = mapPtr(target.ptr);
    if (!r) return [];
    return [...eff.updated.filter(u => u.app === r.app && u.coll === r.coll && u.id === r.id), ...eff.created.filter(c => c.ids.has(r.id))];
  }
  return [...eff.created, ...eff.updated];
}
const createdMatchingAll = (P, eff) => eff.created.filter(c => (!P.app || c.app === P.app) && (!P.container || c.ids.has(P.container) || norm(c.text).includes(norm(P.container)))
  && (!P.label || containsLiteral(c.text, P.label)));
const hasTarget = t => Boolean(t && (t.email || t.channel || t.ptr));

/**
 * Effects a passing positive check matches, in evaluateCheck's order. A check that constrains nothing (no target, no
 * literal, no container or label) would match every effect: it keeps only its first match, as the frozen evidence does.
 */
export function matchedEffects(check, eff, mapPtr) {
  const P = check.params ?? {};
  let m;
  switch (check.type) {
    case 'msg_to': case 'post_in': m = messagesToAll(P.target, eff, mapPtr); return hasTarget(P.target) ? m : m.slice(0, 1);
    case 'msg_has': m = messagesToAll(P.target, eff, mapPtr).filter(x => containsLiteral(x.text, P.lit, { person: P.person })); return hasTarget(P.target) || P.lit ? m : m.slice(0, 1);
    case 'created_in': m = createdMatchingAll(P, eff); return P.app || P.container || P.label ? m : m.slice(0, 1);
    case 'created_has': m = createdMatchingAll(P, eff).filter(c => containsLiteral(c.text, P.lit, { person: P.person })); return P.app || P.container || P.label || P.lit ? m : m.slice(0, 1);
    case 'rec_changed': case 'rec_field': case 'rec_deleted': {
      const r = P.ptr ? mapPtr(P.ptr) : null;
      if (!r) return [];
      const same = x => x.app === r.app && x.coll === r.coll && x.id === r.id;
      const out = [...eff.updated.filter(same), ...eff.deleted.filter(same)];
      if (check.type === 'rec_changed' && P.scope === 'reply') out.push(...eff.created.filter(c => c.app === r.app && c.ids.has(r.id)));
      return out;
    }
    default: return [];
  }
}
// two created effects are the same effect performed twice when app, collection, recipients, channel and non-empty
// content agree (RL2's own no_dup notion of "the same text", with the addressee added)
const dupKey = e => (e.recipients && norm(e.text) ? `${e.app}.${e.coll}|${[...e.recipients].sort().join(',')}|${e.channel ?? ''}|${norm(e.text)}` : null);

/**
 * RL2 code checks on one candidate, with the effects the passing positive checks account for. Every effect is
 * { key, kind, explained, duplicate }: explained when some passing positive check matches it as a first-of-its-content
 * match; duplicate when it is matched only as a repeat (same recipients and content) of an earlier match of the same
 * check; otherwise unexplained. matchFidelity counts passing message/creation checks whose first match is exactly the
 * frozen evaluator's evidence address (it must equal checked).
 */
export function rl2Check(ledger, { diff, world0, final }) {
  const rowIdx = indexWorld(world0);
  const res = runCodeChecks(ledger.merged, { diff, world0, final, canonIdx: ledger.canonIdx, rowIdx });
  const mapPtr = ptrMapper(ledger.canonIdx, rowIdx);
  const eff = effectsOf(diff, world0);
  const explained = new Set(), duplicate = new Set();
  const fidelity = { checked: 0, agree: 0 };
  res.results.forEach((r, i) => {
    if (i === 0 || r.pass !== true || NEGATIVE.has(r.type)) return;
    const c = ledger.merged.checks[i - 1];
    const m = matchedEffects(c, eff, mapPtr);
    if (['msg_to', 'post_in', 'msg_has', 'created_in', 'created_has'].includes(r.type)) { fidelity.checked++; if (m.length && whereOf(m[0]) === String(r.evidence)) fidelity.agree++; }
    const seen = new Set();
    for (const e of m) {
      const k = dupKey(e);
      if (k && seen.has(k)) duplicate.add(e); else { explained.add(e); if (k) seen.add(k); }
    }
  });
  const effects = [];
  let k = 0;
  for (const kind of ['created', 'updated', 'deleted']) for (const e of eff[kind]) {
    const key = e.id === null || e.id === undefined ? `${e.app}.${e.coll}:#${k++}` : whereOf(e);
    const ex = explained.has(e);
    effects.push({ key, kind, explained: ex, duplicate: !ex && duplicate.has(e) });
  }
  return { results: res.results, effects, judged: ledger.merged.judged ?? [], matchFidelity: fidelity };
}

/**
 * One ledger per reader, each compiled from that reader's extraction alone (K = 1: every surviving item is hard, as
 * mergeLedgers does for one reader). Returns Map reader -> Map task -> ledger (the shape rl2Check takes).
 */
export function rl2ReaderLedgers(extractRows, canonical, { readers = ['haiku:0', 'haiku:1', 'haiku:2'], worldCap = 45000 } = {}) {
  return new Map(readers.map(rd => [rd, rl2Ledgers(extractRows, canonical, { readers: [rd], worldCap })]));
}
/** An independent reader's verdict on one candidate: its own ledger's hard code checks (no judged verdicts: $0). */
export function readerAccept(ledger, cand) {
  if (!ledger || !ledger.readers?.length) return null;
  const r = rl2Check(ledger, cand);
  const c = combine({ code: r.results, judged: r.judged, verdicts: null, readers: ledger.merged.readers });
  return { accept: c.accept, fails: c.hardFails, score: c.score };
}

// ---- the clock (D28 (2)): meta.current_time is hidden; "today" comes from the request, else from the work items'
// business dates, else it is a labelled null
/**
 * The latest date carried by any record of the initial world (the work items' own dates and timestamps; meta excluded),
 * or null: G6's "anchor now to the work items' dates" as code. A heuristic, measured against the hidden clock on dev60
 * (equal on 17 of 60 tasks, earlier on 21, later on 13, none on 9: research/blockers-20261021/MOVE3-4-6-LAB.md §2.6).
 */
export function businessToday(world0) {
  const { meta, ...apps } = world0 ?? {};
  const all = [];
  for (const [app, v] of Object.entries(apps)) leaves(v, app, all);
  const days = [...new Set(all.flatMap(l => datesIn(String(l.value))))].filter(d => Number.isFinite(dayNumber(d))).sort();
  return days.length ? days.at(-1) : null;
}
/** The world as a clock-blind verifier may see it: meta.current_time replaced by the derived date, or removed. */
export function clockBlindWorld(world0, mode = 'derived') {
  if (!world0?.meta || !('current_time' in world0.meta)) return world0;
  const { current_time: _hidden, ...meta } = world0.meta;
  const d = mode === 'derived' ? businessToday(world0) : null;
  return { ...world0, meta: d ? { ...meta, current_time: `${d}T00:00:00Z` } : meta };
}
const DECIDED = new Set(['pass', 'fail']);
/**
 * code-checks v1.1 with the hidden clock (as the verifier lab ran it) and clock-blind (D28 (2)). labelledNull lists the
 * check ids decided with the clock and undecidable without it. Returns { withClock, blind, labelledNull, derivedToday }.
 */
export function ccClock({ view, world0, hf = null }) {
  const withClock = ccVerify({ view, world0, hf });
  const blindWorld = clockBlindWorld(world0, 'derived');
  const blind = blindWorld === world0 ? withClock : ccVerify({ view, world0: blindWorld, hf });
  const st = new Map(blind.checks.map(c => [c.id, c.status]));
  const labelledNull = withClock.checks.filter(c => DECIDED.has(c.status) && !DECIDED.has(st.get(c.id))).map(c => c.id);
  return { withClock, blind, labelledNull, derivedToday: blindWorld?.meta?.current_time?.slice(0, 10) ?? null };
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

/**
 * Code-checks v1.1 as a veto (verify() output checks [{id, hard, status}]). A passing generic sanity check is not a task
 * obligation and is not counted. labelledNull: ids of checks the hidden clock decided and the clock-blind run could not
 * (ccClock): each is an UNKNOWN 'labelled-null' obligation instead.
 */
export function ccObligations(checks, { labelledNull = [] } = {}) {
  const nul = new Set(labelledNull);
  return [
    ...checks.filter(c => c.status === 'fail' && !nul.has(c.id)).map(c => ({ id: `cc:${c.id}`, source: 'cc', decidedBy: 'code', polarity: 'must_not', established: Boolean(c.hard), pass: false, content: false })),
    ...[...nul].map(id => ({ id: `cc:${id}`, source: 'cc', decidedBy: 'code', polarity: 'must_not', established: true, pass: null, content: false, unknownKind: 'labelled-null' })),
  ];
}

/** The A1-C pipeline's own checks (lab row selfCheck.checks: [{id, hard, pass, by: code|checker, polarity}]). */
export function ownObligations(selfCheck) {
  if (!selfCheck || selfCheck.kind !== 'a1c-checks') return [];
  return (selfCheck.checks ?? []).map(c => ({ id: `own:${c.id}`, source: 'own', decidedBy: c.by === 'code' ? 'code' : 'self', polarity: c.polarity === 'must_not' ? 'must_not' : 'must',
    established: Boolean(c.hard), pass: c.pass === true ? true : c.pass === false ? false : null, content: true }));
}
