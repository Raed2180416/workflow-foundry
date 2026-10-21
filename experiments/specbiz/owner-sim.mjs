// SPEC-0 owner simulator, truth-first (FIRST-CLASS-PROGRAMS §4.4; MRR §3.3 rules 1 and 3). Nothing is generated at run
// time: every answer is a pre-rendered intent record of the pack (render.mjs). The only judgment is which records a
// question is about, chosen from a closed list plus no-match (a typed Haiku call in SPEC-1; `stubMatcher` here and in
// tests). It cannot leak beyond the matched records (BIRD-Interact's function-driven simulator, EXTERNAL-BENCHMARKS.md).
//
// Rules:
//   - at most `maxQuestions` (20) questions; each one is journaled and charged, whatever it returns;
//   - no match: "I don't know, use your judgment"; more than `maxRecordsPerAnswer` (3) matches: "that's a lot at once";
//   - a record marked `reticent` (seeded, p = 0.5 at render time) is withheld unless the question names its subject
//     (one of its `terms` occurs in the question); Sim2Real's "too cooperative" simulator is the failure this avoids;
//   - replay from the journal is byte-identical and makes no matcher call.
// Ask metrics (HiL-Bench Ask-F1, plus our wasted-question count) are computed from the journal and the carrier truth.
import { sha256 } from '../../beds/lib/canonical.mjs';
import { WITHHELD_ANSWER, NO_MATCH_ANSWER, TOO_BROAD_ANSWER, BUDGET_ANSWER } from './content.mjs';

export const SIM_VERSION = 'specbiz-owner-sim/1';
const STOP = new Set(['what', 'when', 'which', 'with', 'that', 'this', 'from', 'into', 'does', 'have', 'about', 'there', 'their', 'they', 'your', 'ours', 'will', 'were', 'been', 'only', 'same']);
const norm = s => ` ${String(s).toLowerCase().replace(/[^\p{L}\p{N}.\-]+/gu, ' ').replace(/(?<!\d)\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** Does the question name the record's subject (one of its terms, as whole words)? Deterministic. */
export function namesSubject(question, rec) {
  const q = norm(question);
  return rec.terms.some(t => q.includes(norm(t)));
}

/**
 * The deterministic stub matcher (tests, and the $0 coverage proof). Score = 3 per term named + 1 per title word of
 * four letters or more (stop words excluded) in the question; returns the ids with the top score (at least 1), at most 5, id-ordered.
 */
export function stubMatcher(records) {
  const byId = new Map(records.map(r => [r.id, r]));
  return async (question, closedList) => {
    const q = norm(question);
    const scored = closedList.map(({ id }) => {
      const r = byId.get(id);
      const named = r.terms.filter(t => q.includes(norm(t))).length;
      const title = r.title.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w) && q.includes(` ${w} `)).length;
      return { id, s: 3 * named + title };
    }).filter(x => x.s >= 1);
    if (!scored.length) return { ids: [] };
    const top = Math.max(...scored.map(x => x.s));
    return { ids: scored.filter(x => x.s === top).map(x => x.id).sort().slice(0, 5) };
  };
}

/** The typed judgment SPEC-1 uses in place of the stub (documented here; no model is called in SPEC-0). */
export const MATCH_JUDGMENT = Object.freeze({
  instruction: 'Which of the listed owner topics does the question ask about? Answer with the topic ids, or an empty list if none fits. Do not answer the question.',
  schema: { type: 'object', required: ['ids'], additionalProperties: false, properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: 5 } } },
  closedList: 'id and title of every owner record (never the answer text)',
});

function answerFor(pack, question, ids, { maxRecordsPerAnswer }) {
  const recs = new Map(pack.owner.records.map(r => [r.id, r]));
  if (!ids.length) return { answer: NO_MATCH_ANSWER, named: [], withheld: [], answered: [] };
  if (ids.length > maxRecordsPerAnswer) return { answer: TOO_BROAD_ANSWER, named: [], withheld: [], answered: [] };
  const named = ids.filter(id => namesSubject(question, recs.get(id)));
  const withheld = ids.filter(id => recs.get(id).reticent && !named.includes(id));
  const answered = ids.filter(id => !withheld.includes(id));
  return { answer: answered.length ? answered.map(id => recs.get(id).answer).join('\n\n') : WITHHELD_ANSWER, named, withheld, answered };
}

export function createOwnerSim({ pack, matcher, maxQuestions = 20, maxRecordsPerAnswer = 3 }) {
  if (typeof matcher !== 'function') throw new Error('matcher required');
  const closedList = pack.owner.records.map(({ id, title }) => ({ id, title }));
  const valid = new Set(closedList.map(x => x.id));
  const journal = [];
  return {
    async ask(question) {
      const n = journal.length + 1;
      if (n > maxQuestions) {
        const row = { n, question, qDigest: sha256(String(question)), match: null, budgetExceeded: true, answer: BUDGET_ANSWER, answerDigest: sha256(BUDGET_ANSWER) };
        journal.push(row);
        return { n, answer: BUDGET_ANSWER };
      }
      const m = await matcher(String(question), closedList);
      const raw = Array.isArray(m?.ids) ? m.ids : [];
      const ids = [...new Set(raw.filter(id => valid.has(id)))];
      const invalid = raw.filter(id => !valid.has(id));
      const a = answerFor(pack, String(question), ids, { maxRecordsPerAnswer });
      const row = { n, question: String(question), qDigest: sha256(String(question)), match: ids, invalidMatch: invalid, ...a, answerDigest: sha256(a.answer) };
      journal.push(row);
      return { n, answer: a.answer };
    },
    journal: () => journal.map(r => ({ ...r })),
    remaining: () => Math.max(0, maxQuestions - journal.length),
    version: SIM_VERSION,
  };
}

/** Replay a journal without a matcher: recompute every answer from the journaled matches; byte-identical or not ok. */
export function replayOwnerSim(pack, journal, { maxQuestions = 20, maxRecordsPerAnswer = 3 } = {}) {
  const mismatches = [];
  for (const row of journal) {
    const a = row.n > maxQuestions ? { answer: BUDGET_ANSWER } : answerFor(pack, row.question, row.match ?? [], { maxRecordsPerAnswer });
    if (sha256(a.answer) !== row.answerDigest || a.answer !== row.answer) mismatches.push(row.n);
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Ask metrics from a journal (HiL-Bench Ask-F1 adapted; EXTERNAL-BENCHMARKS.md):
 *   blockers      gold units whose only carrier is the owner
 *   precision     questions that obtained at least one blocker answer / questions asked
 *   recall        distinct blockers obtained / blockers
 *   wasted        questions whose answered records are all stated in the documents without conflict (sop, email)
 *   confirmations questions whose answered records are all evidenced by records only (asking to confirm an inference)
 */
export function askMetrics(pack, journal) {
  const carrier = id => pack.assignment.units[id]?.carrier ?? null;
  const unitsOf = new Map(pack.owner.records.map(r => [r.id, r.units]));
  const blockers = Object.entries(pack.assignment.units).filter(([, u]) => u.gold && u.carrier === 'owner').map(([id]) => id);
  const asked = journal.length;
  let hitQ = 0, wasted = 0, confirm = 0;
  const got = new Set();
  for (const row of journal) {
    const units = (row.answered ?? []).flatMap(id => unitsOf.get(id) ?? []);
    const b = units.filter(u => blockers.includes(u));
    for (const u of b) got.add(u);
    if (b.length) hitQ += 1;
    if (units.length && units.every(u => ['sop', 'email'].includes(carrier(u)))) wasted += 1;
    else if (units.length && units.every(u => carrier(u) === 'records')) confirm += 1;
  }
  const precision = asked ? hitQ / asked : null, recall = blockers.length ? got.size / blockers.length : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { asked, blockers: blockers.length, blockersObtained: got.size, precision, recall, askF1: f1, wasted, confirmations: confirm,
    withheld: journal.filter(r => r.withheld?.length && !r.answered?.length).length, noMatch: journal.filter(r => Array.isArray(r.match) && r.match.length === 0).length };
}
