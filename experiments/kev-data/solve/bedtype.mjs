// State-only solver for X5 bedtype and C9 (JUDGE-PROGRAM.md §2.7 step 1: "solve/<port>.mjs reads only the exported state and question").
// It is the second code path of the decidability audit: it never sees a family id, a seed or a world. It knows (a) the
// texts a kept workflow may state as its assumption (family descriptions and README task paragraphs: the port's allowed
// knowledge, passed in as `corpus`) and (b) the opening of each family's task statement, which is what a reader of the state
// recognises a family by. The label of a record is recomputed from the question and the state alone and compared with the
// generator's.
//
// X5: the assumption's family from the question text; the state's family from the first sentence of its task statement; a
// state whose statement opens like no family's has no task content (not_stated). A negated framing flips holds and violated.
// C9: the families of both prompts; same iff equal.
import { HEADERS } from '../judges/bedtype.mjs';
import { questionOf } from '../lib/render.mjs';

// the opening of each family's task statement (prompt head), as the beds write it
export const OPENINGS = Object.freeze({
  records: /migrating customer and supplier records from \d+ legacy systems/,
  incident: /on-call SRE for an online shop/,
  synth: /curating a reference table of measured properties from a corpus of \d+ documents/,
  kinetics: /initial-rate enzyme-kinetics study \(/,
  runbook: /on-call site reliability engineer executing change ticket/,
  gameqa: /QA tester for ".+" by .+, build [\d.]+/,
  gridquest: /You are exploring .+, a ruined keep laid out as an? \dx\d grid of rooms/,
  codefix: /You are maintaining [\w.]+, a small Python 3 library/,
  ownerci: /You are a maintainer of workflow-foundry/,
});
const NEGATION = /(does not belong|is not an instance|is not of the type|is not covered|falls outside|a different kind of task from|does not correspond|is not the same sort of work)/i;

// the primary task statement of a state: after "Task statement:", before the inputs and any reference block
export function primaryStatement(sourceText) {
  const t = String(sourceText ?? '');
  const from = t.startsWith(HEADERS.task) ? HEADERS.task.length : 0;
  const ends = [t.indexOf(`\n\n${HEADERS.inputs}`), t.indexOf(`\n\n${HEADERS.reference}`)].filter(i => i >= 0);
  return t.slice(from, ends.length ? Math.min(...ends) : undefined).trim();
}
export function familyOfStatement(statement) {
  const hits = Object.entries(OPENINGS).filter(([, re]) => re.test(statement.slice(0, 400))).map(([bed]) => bed);
  return hits.length === 1 ? hits[0] : hits.length === 0 ? null : 'ambiguous';
}
// corpus: [{bed, text}] the assumption texts a kept workflow may state (trailing full stops dropped)
export function assumptionBedOf(instructions, corpus) {
  const q = questionOf(instructions).replace(/\s+/g, ' ');
  const hits = corpus.filter(c => q.includes(c.text.replace(/[.\s]+$/, ''))).sort((a, b) => b.text.length - a.text.length);
  if (!hits.length) return { bed: null };
  const at = q.indexOf(hits[0].text.replace(/[.\s]+$/, ''));
  return { bed: hits[0].bed, before: q.slice(Math.max(0, at - 220), at) };
}
export function solveX5(state, question, { corpus }) {
  const a = assumptionBedOf(question.instructions, corpus);
  if (!a.bed) return { label: null, reason: 'the assumption is not a known family statement' };
  const s = familyOfStatement(primaryStatement(state.source_text));
  if (s === 'ambiguous') return { label: null, reason: 'the statement opens like two families' };
  const negated = NEGATION.test(a.before);
  const label = s === null ? 'not_stated' : (s === a.bed) !== negated ? 'holds' : 'violated';
  return { label, assumptionBed: a.bed, stateBed: s, negated };
}
export function solveC9(state) {
  const a = familyOfStatement(state.task_a.replace(/\s+/g, ' ')), b = familyOfStatement(state.task_b.replace(/\s+/g, ' '));
  if (!a || !b || a === 'ambiguous' || b === 'ambiguous') return { label: null, reason: 'a prompt opens like no (or two) known families' };
  return { label: a === b ? 'same' : 'different', a, b };
}
