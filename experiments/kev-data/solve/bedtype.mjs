// State-only solver for X5 bedtype and C9 (JUDGE-PROGRAM.md §2.7 step 1: "solve/<port>.mjs reads only the exported state and question").
// It is the second code path of the decidability audit: it never sees a family id, a seed or a world. It knows (a) the
// texts a kept workflow may state as its assumption (family descriptions and README task paragraphs: the port's allowed
// knowledge, passed in as `corpus`), (b) the opening of each family's task statement, which is what a reader of the state
// recognises a family by, and (c) the framing links of the authored pools (their polarity). The label of a record is recomputed
// from the question and the state alone and compared with the generator's.
//
// X5: the assumption's family from the question text; the state's family from the first sentence of its task statement; a
// state whose statement opens like no family's has no task content (not_stated). A filed-task state (judges/bedtype.mjs
// filedState) is read through its pointer: the family of the filed task the pointer names, or not_stated when no listed task
// has that id. A negated framing flips holds and violated.
// C9: the families of both prompts; same iff equal.
import { FILED_ID, HEADERS } from '../judges/bedtype.mjs';
import { questionOf } from '../lib/render.mjs';
import { LINK_TEXTS } from '../ports/crossfamily-pools.mjs';

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
// framing links, longest first (a link may end with another's words)
const LINKS_BY_LENGTH = [...LINK_TEXTS].sort((a, b) => b.text.length - a.text.length);

// the primary task statement of a state: after "Task statement:", before the inputs, any reference block and any filed task
export function primaryStatement(sourceText) {
  const t = String(sourceText ?? '');
  const from = t.startsWith(HEADERS.task) ? HEADERS.task.length : 0;
  const ends = [t.indexOf(`\n\n${HEADERS.inputs}`), t.indexOf(`\n\n${HEADERS.reference}`), t.indexOf(`\n\n${HEADERS.filed} `)].filter(i => i >= 0);
  return t.slice(from, ends.length ? Math.min(...ends) : undefined).trim();
}
// the filed tasks of a filed-task state: [{id, text}]
export function filedTasks(sourceText) {
  const t = String(sourceText ?? ''), re = new RegExp(`(?:^|\\n\\n)${HEADERS.filed} (\\S+):\\n`, 'g'), heads = [...t.matchAll(re)];
  return heads.map((m, i) => ({ id: m[1], text: t.slice(m.index + m[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined).trim() }));
}
export function familyOfStatement(statement) {
  const hits = Object.entries(OPENINGS).filter(([, re]) => re.test(statement.slice(0, 400))).map(([bed]) => bed);
  return hits.length === 1 ? hits[0] : hits.length === 0 ? null : 'ambiguous';
}
// the family the state's request belongs to: a family id, null (no task content, or a pointer to a task not on file), 'ambiguous',
// or { error } when a filed-task state cannot be read
export function stateFamily(sourceText) {
  const filed = filedTasks(sourceText);
  if (!filed.length) return familyOfStatement(primaryStatement(sourceText));
  const ids = primaryStatement(sourceText).match(new RegExp(FILED_ID.source, 'g')) ?? [];
  if (ids.length !== 1) return { error: `a filed-task state whose statement names ${ids.length} ids` };
  const named = filed.find(f => f.id === ids[0]);
  if (!named) return null;
  const fam = familyOfStatement(named.text);
  return fam === null ? { error: 'the named filed task opens like no family' } : fam;
}
// corpus: [{bed, text}] the assumption texts a kept workflow may state (trailing full stops dropped)
export function assumptionBedOf(instructions, corpus) {
  const q = questionOf(instructions).replace(/\s+/g, ' ');
  const hits = corpus.filter(c => q.includes(c.text.replace(/[.\s]+$/, ''))).sort((a, b) => b.text.length - a.text.length);
  if (!hits.length) return { bed: null };
  const at = q.indexOf(hits[0].text.replace(/[.\s]+$/, ''));
  return { bed: hits[0].bed, before: q.slice(Math.max(0, at - 220), at) };
}
// the polarity of the framing: the link the text before the assumption ends with ("<lead> <link>: ")
export function framingPolarity(before) {
  const b = String(before ?? '').replace(/:\s*$/, '').trimEnd();
  const link = LINKS_BY_LENGTH.find(l => b.endsWith(` ${l.text}`));
  return link ? { negated: link.negated, link: link.text } : null;
}
export function solveX5(state, question, { corpus }) {
  const a = assumptionBedOf(question.instructions, corpus);
  if (!a.bed) return { label: null, reason: 'the assumption is not a known family statement' };
  const f = framingPolarity(a.before);
  if (!f) return { label: null, reason: 'the framing is not a known link' };
  const s = stateFamily(state.source_text);
  if (s === 'ambiguous') return { label: null, reason: 'the statement opens like two families' };
  if (s && typeof s === 'object') return { label: null, reason: s.error };
  const label = s === null ? 'not_stated' : (s === a.bed) !== f.negated ? 'holds' : 'violated';
  return { label, assumptionBed: a.bed, stateBed: s, negated: f.negated };
}
export function solveC9(state) {
  const a = familyOfStatement(state.task_a.replace(/\s+/g, ' ')), b = familyOfStatement(state.task_b.replace(/\s+/g, ' '));
  if (!a || !b || a === 'ambiguous' || b === 'ambiguous') return { label: null, reason: 'a prompt opens like no (or two) known families' };
  return { label: a === b ? 'same' : 'different', a, b };
}
