// State-only solvers for the kinetics ports (JUDGE-PROGRAM.md §2.7 step 1, the decidability audit). A solver
// reads the exported state and the question's slots, never the world: it must reproduce the label on
// >= 99.5% of the rows it decides. A solver returns { label, basis } or { label: null, reason } for a row it
// cannot decide (listed, never forced). Ports whose labels are semantic (X3 content classes, K1, X7) run the
// solver on their template-bearing subset only; the rest relies on the masked-state collision audit.
import { COMPILED, CHAT_INJECTIONS, NOTEBOOK_INJECTIONS, withoutDecoys } from '../taps/kinetics-frames.mjs';
import { RATE_FACTOR, RATE_LABELS, RATE_WORDS, CONC_LABELS, CONC_WORDS, rowCells, parseRate, resolveCondition, UNIT_CODES } from '../judges/kinetics.mjs';
import { skeletonText } from '../lib/hash.mjs';
import { stringLeaves } from '../lib/leakage.mjs';

const decided = (label, basis) => ({ label, basis });
const undecided = reason => ({ label: null, reason });

// ---- units ---------------------------------------------------------------------------------------
const RATE_BY_LABEL = new Map(), RATE_BY_WORDS = new Map(), CONC_BY_LABEL = new Map(), CONC_BY_WORDS = new Map();
for (const [code, labels] of Object.entries(RATE_LABELS)) { for (const l of labels) RATE_BY_LABEL.set(l, code); RATE_BY_LABEL.set(code, code); RATE_BY_WORDS.set(RATE_WORDS[code], code); }
for (const [code, labels] of Object.entries(CONC_LABELS)) { for (const l of labels) CONC_BY_LABEL.set(l, code); CONC_BY_WORDS.set(CONC_WORDS[code], code); }
RATE_BY_LABEL.set('mAU/min', 'mAU/min');
export const rateUnitOfLabel = t => RATE_BY_LABEL.get(String(t).trim()) ?? RATE_BY_WORDS.get(String(t).trim()) ?? null;
export const concUnitOfLabel = t => CONC_BY_LABEL.get(String(t).trim()) ?? CONC_BY_WORDS.get(String(t).trim()) ?? null;

// The rate unit a header or preamble states: a table header cell "v0 (LABEL)", a units comment, a column name
// rate_uM_per_min, "Units on this sheet", a unit sentence, a reader "Slope(mAU/min)". Returns a unit code or null.
export function rateUnitStated(text) {
  const t = String(text);
  const cells = [
    /v0 \(([^)]+)\)/, /# units: .*?rate in ([^\n]+)$/m, /Units on this sheet: rates in (.+?), \[S\]/, /Slope\(([^)]+)\)/,
    /initial rates in (.+?)\. I did not repeat/, /rates below are (.+?) and substrate/, /rates in (.+?) throughout this page/,
  ];
  for (const re of cells) { const m = re.exec(t); if (m) { const u = rateUnitOfLabel(m[1].replace(/\.$/, '')); if (u) return u; } }
  const col = /\brate_([A-Za-z]+)_per_(s|min)\b/.exec(t);
  if (col) { const u = `${col[1]}/${col[2]}`; if (RATE_FACTOR[u]) return u; }
  // units written after the values (a bench log): "37413 nM min⁻¹", "1.71 µM/min"
  const labels = [...RATE_BY_LABEL.keys()].sort((a, b) => b.length - a.length).map(l => l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  const post = new RegExp(`\\d[\\d.,e+×^-]*\\s(${labels.join('|')})(?![\\w/])`).exec(t);
  return post ? RATE_BY_LABEL.get(post[1]) : null;
}
export function concUnitStated(text) {
  const t = String(text);
  for (const re of [/\[S\] \(([^)]+)\)/, /# units: S in (.+?),/, /\[S\] in ([^,.;)\n]+)/, /substrate is given in (.+?), as on/, /substrate in (.+?) and rates/]) {
    const m = re.exec(t); if (m) { const u = concUnitOfLabel(m[1]); if (u) return u; }
  }
  const col = /\bS_([A-Za-z]+)\b/.exec(t);
  if (col && CONC_FACTOR_CODES.includes(col[1])) return col[1];
  // units written after each value (a bench log): "VN-0285 (5 µM):", "at 20 µM gave", "[S] 300 µM, v0", "80 µM → ", "at 40 µM."
  const labels = [...CONC_BY_LABEL.keys()].sort((a, b) => b.length - a.length).map(l => l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  const num = '\\d[\\d.,eE+×^-]*';
  const found = new Set();
  for (const re of [`[A-Z]{2}-\\d{4} \\(${num} (${labels})\\):`, `\\bat ${num} (${labels}) gave\\b`, `\\[S\\] ${num} (${labels}), v0\\b`, `(?:^|[.:] )${num} (${labels}) → `, `\\bat ${num} (${labels})\\.(?:\\s|$)`]) {
    for (const m of t.matchAll(new RegExp(re, 'gm'))) found.add(concUnitOfLabel(m[1]));
  }
  return found.size === 1 ? [...found][0] : null;
}
const CONC_FACTOR_CODES = ['uM', 'mM', 'nM'];

// ---- X8 ------------------------------------------------------------------------------------------
// consistent iff extracted_value = the printed rate converted by the sheet's rate unit (within the 4 significant
// figures the extraction is rounded to)
export function solveX8(state) {
  const line = String(state.source_line);
  const format = line.startsWith('|') ? 'mdtable' : /^[A-Z]{2}-\d{4};/.test(line) ? 'semicolon' : /^[A-Z]{2}-\d{4},/.test(line) ? 'csv' : null;
  if (!format) return undecided('unknown row format');
  const printed = parseRate(rowCells(format, line).rate), u = rateUnitStated(state.conventions), v = Number(state.extracted_value);
  if (printed === null || !u || !Number.isFinite(v)) return undecided('no parsable rate or unit statement');
  const expected = printed / RATE_FACTOR[u];
  return decided(Math.abs(v - expected) <= 2e-3 * Math.abs(expected) ? 'consistent' : 'inconsistent', { unit: u, printed, expected });
}

// ---- K3 ------------------------------------------------------------------------------------------
export function solveK3(state) {
  for (const text of [state.header, state.preamble, state.referenced_header]) {
    if (text === undefined) continue;
    if (text === state.preamble && /Same reader template as |Units: as on |set up the template for both of us;/.test(text) && state.referenced_header) {
      const u = rateUnitStated(state.referenced_header); if (u) return decided(u, 'referenced sheet');
    }
    if (text === state.preamble) {
      const keep = String(text).split('\n').filter(l => /^\(Units today: |^Same template as last week|^I'm writing substrate in |^Slopes are ΔA340 in mAU\/min/.test(l)).join('\n');
      const u = /^Slopes are ΔA340 in mAU\/min/m.test(keep) ? 'mAU/min' : rateUnitStated(keep);
      if (u) return decided(u, 'preamble');
    } else { const u = rateUnitStated(text); if (u) return decided(u, text === state.header ? 'header' : 'referenced sheet'); }
  }
  return undecided('no unit statement');
}

// ---- K2 ------------------------------------------------------------------------------------------
export function parseRegister(note) {
  const conds = [], bench = {};
  for (const l of String(note).split('\n')) {
    const m = /^(C\d+): pH ([\d.]+), (\d+) °C, (?:no inhibitor|(.+?) (\d+(?:\.\d+)?) µM)$/.exec(l);
    if (m) conds.push({ id: m[1], pH: Number(m[2]), tempC: Number(m[3]), inhibitor: m[4] ? { name: m[4], uM: Number(m[5]) } : null });
    const b = /^- (\S+) block = (.+)$/.exec(l);
    if (b) bench[b[1]] = b[2];
  }
  const byDesc = {};
  for (const c of conds) { const d = `pH ${c.pH.toFixed(1)}, ${c.tempC} °C, ${c.inhibitor ? `${c.inhibitor.name} ${c.inhibitor.uM} µM` : 'no inhibitor'}`; (byDesc[d] ??= []).push(c.id); }
  const codes = Object.fromEntries(Object.entries(bench).filter(([, d]) => byDesc[d]?.length === 1).map(([code, d]) => [code, byDesc[d][0]]));
  return { conds, bench: Object.keys(codes).length ? codes : null };
}
export function solveK2(state) {
  const { conds, bench } = parseRegister(state.register_note);
  const id = resolveCondition(state.description, conds, bench);
  return id ? decided(id, 'register') : undecided('names no single register condition');
}

// ---- X3 ------------------------------------------------------------------------------------------
const X3_FRAMES = [
  ['retracts', ['retractSwap', 'withdraw']],
  ['proposes', ['qReassign', 'qSwap', 'qUnitsConfirm', 'qUnitsDeny', 'qColleague', 'doseQuestion']],
  ['confirms', ['answerConfirm', 'aReassignConfirm', 'aUnitsConfirm']],
  ['mentions', ['answerDeny', 'aReassignDeny', 'aUnitsDeny', 'aSwapDeny', 'addendumClaim', 'herringRange', 'herringSwap', 'herringUnits', 'herringReaderLog', 'doseAnswer']],
  ['changes', ['corrSwap', 'corrReassign', 'corrOmitted', 'corrUnits', 'lateRowflag', 'lateMisattributed', 'doseCorrection', 'latePost']],
];
// the speech act of a message, from the bed's message frames; the author does not enter (authority stays in code)
export function solveX3(state) {
  if (COMPILED.redirect.matches(state.message)) return undecided('withdraws and re-assigns');
  const hits = [];
  for (const [label, names] of X3_FRAMES) for (const n of names) if (COMPILED[n].matches(state.message)) hits.push({ label, frame: n });
  if (!hits.length) return undecided('no frame');
  const labels = [...new Set(hits.map(h => h.label))];
  return labels.length === 1 ? decided(labels[0], hits[0].frame) : undecided(`frames disagree: ${hits.map(h => h.frame).join(', ')}`);
}

// ---- X1 ------------------------------------------------------------------------------------------
export function solveX1(state) {
  const long = String(state.text).includes('\n');
  const lines = String(state.text).split('\n');
  const hit = lines.some(l => CHAT_INJECTIONS.some(i => l.endsWith(i)) || NOTEBOOK_INJECTIONS.includes(l));
  if (long) return hit ? decided('yes', 'injection line in the window') : decided('no', 'no injection line in the window');
  return CHAT_INJECTIONS.includes(state.text) || NOTEBOOK_INJECTIONS.includes(state.text) ? decided('yes', 'pool line') : decided('no', 'not a pool line');
}

// ---- X5 ------------------------------------------------------------------------------------------
// the assumption (question slot) against the document window
export function solveX5(state, { assumption }) {
  const a = String(assumption), t = withoutDecoys(state.source_text);
  const sop = /(SOP-[A-Z]{2}-\d+) (?:rev|revision) (\d+)|revision (\d+) of (SOP-[A-Z]{2}-\d+)/.exec(a);
  if (sop) {
    const code = sop[1] ?? sop[4], n = Number(sop[2] ?? sop[3]);
    if (!t.includes(code)) return decided('not_stated', 'the window does not mention the SOP');
    const head = /^# SOP-[A-Z]{2}-\d+ rev (\d+)/m.exec(t), superseded = /^STATUS: SUPERSEDED by rev (\d+)/m.exec(t);
    if (!head) return undecided('no SOP head');
    if (superseded) return decided(n === Number(superseded[1]) ? 'holds' : 'violated', 'superseded head');
    return decided(n === Number(head[1]) ? 'holds' : 'violated', 'current head');
  }
  const rateAssumed = [...RATE_BY_LABEL.keys(), ...RATE_BY_WORDS.keys()].sort((x, y) => y.length - x.length).find(l => a.includes(l));
  const concAssumed = [...CONC_BY_LABEL.keys(), ...CONC_BY_WORDS.keys()].sort((x, y) => y.length - x.length).find(l => a.includes(l));
  const wantsConc = /substrate|\[S\]/.test(a);
  if (wantsConc) {
    const stated = concUnitStated(t), assumed = concAssumed ? concUnitOfLabel(concAssumed) : null;
    if (!stated) return /Same reader template as |Units: as on |set up the template for both of us;/.test(t) || !/\[S\]|substrate/.test(t) ? decided('not_stated', 'no [S] unit statement') : decided('not_stated', 'no [S] unit statement');
    return decided(stated === assumed ? 'holds' : 'violated', 'concentration unit');
  }
  const stated = rateUnitStated(t), assumed = rateAssumed ? rateUnitOfLabel(rateAssumed) : null;
  if (!stated) return decided('not_stated', 'no rate unit statement');
  return decided(stated === assumed ? 'holds' : 'violated', 'rate unit');
}

// ---- X4 ------------------------------------------------------------------------------------------
export function solveX4(state) {
  const type = state.source?.doc_type, text = String(state.statement), related = state.related_statements ?? [];
  if (type === 'pilot plate' || /\bPLT-\d+/.test(text)) return decided('out_of_scope', 'pilot plate');
  if (/^\| BLK-|^BLK-/.test(text)) return decided('out_of_scope', 'blank well');
  if (type === 'standard operating procedure') {
    const other = related.map(r => /^\[standard operating procedure, (\d{4}-\d{2}-\d{2})\]/.exec(r)?.[1]).find(Boolean);
    if (!other) return decided('binding', 'only revision');
    return decided(state.source.date < other ? 'superseded' : 'binding', 'revision dates');
  }
  if (type === 'instrument raw export') return decided('binding', 'raw export wins over a transcription');
  if (type === 'technician notebook sheet') return related.some(r => r.startsWith('[instrument raw export')) ? decided('superseded', 'the raw export value is used') : undecided('a plain sheet row');
  if (type === 'memo' && /should probably drop LOW wells/.test(text)) return decided('informal', 'opinion about the next study');
  if (type === 'lab chat message') {
    if (COMPILED.piPressure.matches(text)) return decided('informal', 'request');
    if (COMPILED.piRule.matches(text)) return decided('binding', 'PI restates the SOP');
    if (['qReassign', 'qSwap', 'qUnitsConfirm', 'qUnitsDeny', 'qColleague', 'doseQuestion'].some(f => COMPILED[f].matches(text))) return decided('informal', 'question or hedged report');
  }
  return undecided('no rule');
}

// ---- masked-state collisions (§2.7 step 2) ------------------------------------------------------------
// Group rows by skeleton(state) + question + slots (JUDGE-PROGRAM.md §2.7 step 2: the slot fillings are part of the
// key, unmasked; for X8 they are the field and the extracted value); the share of groups with more than one label.
export function collisions(rows, { exact = false } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const sk = exact ? JSON.stringify(r.state) : stringLeaves(r.state).map(l => skeletonText(l.text, r.masks ?? {})).join(' | '), key = `${sk}|${r.question}|${JSON.stringify(r.slots ?? {})}`;
    const g = groups.get(key) ?? { labels: new Set(), n: 0, example: r.id };
    g.labels.add(r.label); g.n++; groups.set(key, g);
  }
  const mixed = [...groups.values()].filter(g => g.labels.size > 1);
  return { groups: groups.size, mixed: mixed.length, share: groups.size ? mixed.length / groups.size : 0, examples: mixed.slice(0, 5).map(g => g.example) };
}

// ---- K1 -------------------------------------------------------------------------------------------
// The note's event type from the bed's own note pools (pools.mjs OUTLIER_NOTES, DECOY_NOTES, orderedBubble),
// indexed by sampling each pool function with a seeded generator: a note decides when it contains exactly one
// label's strings. Sampling cannot enumerate the combinatorial pools, so a note outside the index is undecided
// (coverage is reported next to accuracy).
function poolRng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = { next, pick: l => l[Math.floor(next() * l.length)], chance: p => next() < p, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), float: (lo, hi) => lo + next() * (hi - lo),
    normal: () => 0, sample: (l, k) => { const c = [...l], o = []; while (o.length < k && c.length) o.push(c.splice(Math.floor(next() * c.length), 1)[0]); return o; }, shuffle: l => [...l].sort(() => next() - 0.5) };
  return r;
}
export function buildK1Index(pools, { samples = 600, seed = 7 } = {}) {
  const by = new Map(), add = (text, label) => { const t = String(text).trim(); if (!t) return; const s = by.get(t) ?? new Set(); s.add(label); by.set(t, s); };
  const r = poolRng(seed);
  const run = (fn, label, n = samples) => { for (let i = 0; i < n; i++) add(fn(r), label); };
  const { OUTLIER_NOTES: O, DECOY_NOTES: D, orderedBubble } = pools;
  for (const f of O.sat.flags) add(f, 'reader_saturation');
  for (const t of O.sat.text) run(t, 'reader_saturation');
  for (const t of O.bubble.text) run(t, 'bubble');
  for (const v of O.pipette.variants) for (const t of v.text) run(t, 'pipetting_error');
  for (const [kind, fn] of Object.entries(D)) { if (typeof fn === 'function') run(fn, 'none'); }
  add('LOW', 'none');
  run(rr => orderedBubble(rr, 'during', null), 'bubble', samples * 5);
  run(rr => orderedBubble(rr, 'before', null), 'none', samples * 5);
  run(rr => orderedBubble(rr, 'after', null), 'none', samples * 5);
  return [...by.entries()].filter(([, s]) => s.size === 1).map(([t, s]) => [t, [...s][0]]).sort((a, b) => b[0].length - a[0].length);
}
export function solveK1(state, index) {
  const note = String(state.note), hits = new Set();
  if (/\b(?:block read|block temp|block probe said|logged) [\d.]+ ?[°K]|on the block probe/.test(note)) hits.add('temperature_deviation');
  for (const [text, label] of index) if (text.length <= 4 ? note === text : note.includes(text)) hits.add(label);
  if (hits.size === 1) return decided([...hits][0], 'pool');
  return undecided(hits.size ? `pools disagree: ${[...hits].join(', ')}` : 'note outside the sampled pools');
}

// ---- the audit ---------------------------------------------------------------------------------------
// rows: [{state, label, slots?, id}] -> { rows, decided, agree, accuracy, coverage, wrong: [...], undecided: {reason: n} }
export function audit(rows, solver, { slotsOf = () => ({}) } = {}) {
  let decidedN = 0, agree = 0; const wrong = [], und = {};
  for (const r of rows) {
    const out = solver(r.state, slotsOf(r));
    if (out.label === null) { und[out.reason] = (und[out.reason] ?? 0) + 1; continue; }
    decidedN++;
    if (out.label === r.label) agree++; else wrong.push({ id: r.id, solved: out.label, truth: r.label, basis: out.basis });
  }
  return { rows: rows.length, decided: decidedN, agree, accuracy: decidedN ? agree / decidedN : null, coverage: rows.length ? decidedN / rows.length : null, wrong, undecided: und };
}
export { UNIT_CODES };
