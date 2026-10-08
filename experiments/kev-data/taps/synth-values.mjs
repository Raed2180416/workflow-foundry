// The synth-values tap (JUDGE-PROGRAM.md §2.6, §1.2 S2; JUDGE-BUILD-PLAN.json group "synth").
// The bed renders its documents from world structures and exports no per-span label. This tap takes a task
// and its world (beds/synth `hidden(task).world`, passed in: a tap never imports a bed) and aligns every claim of
// the world with exactly one passage of the rendered text:
//   - the claim's value is written by the bed's own number formats (taps/synth-frames.mjs copies them), so the
//     tap enumerates every way the bed can write it (number x unit symbol or word, ± and (n) uncertainty, a
//     duration, a table column, a list of three replicates, a scientific number) and counts the occurrences of
//     each form in the claim's own document text, as a whole token (judges/synth.mjs occurrences);
//   - a claim with exactly one occurrence, that no other claim of the document also reads, is `aligned`: the
//     passage is the sentence holding the value plus or minus one sentence; a claim with none is `missing`,
//     with several `ambiguous`, one whose occurrence another claim shares `shared`. Those are dropped and
//     counted, never kept. The tap never forks the bed's renderer: it reads the rendered text only.
//
// A claim's S2 label is its world mode through the contract's label map (contracts mapLabel); `bound` has no
// option (a bound is not a value the document asserts: README "bounds are not claims") and is excluded here, with
// a count, before the lookup.
//
// tapStatus() is the acceptance measure: >= 95% of the claims of 200 worlds aligned, or S2 moves to wave 2 and S3
// (labels from claim.cond, no tap) takes its wave-1 slot (contingency()).
import { occurrences, parseTask, passageAround, sentenceSpans, isCsvValue } from '../judges/synth.mjs';
import { PROP_FORMS, unitsOf, plain, grouped, sciForms, fmtSd, durationText, TYPE_LABELS, KIND_OF_TYPE } from './synth-frames.mjs';
import { loadSpec, mapLabel } from '../lib/contracts.mjs';

export const TAP_VERSION = 1;
export const TAP_THRESHOLD = 0.95;
export const TAP_WORLDS = 200;
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const f4 = x => Number(x.toPrecision(4));

// ---- how the bed can write a claim's value ------------------------------------------------------------------------------
// Returns [{text, kind}] (kind 'csv' forms may follow a comma) and [{re, kind}] for the forms that cannot be
// enumerated (three replicate results whose mean is the value).
export function valueForms(c) {
  const u = unitsOf(c.prop).find(x => x.id === c.unit);
  if (!u) throw new Error(`unknown unit ${c.unit} for ${c.prop}`);
  const x = c.value, syms = [...new Set([...u.sym, ...u.w])];
  const nums = u.sci ? sciForms(x) : [plain(x), ...(Math.abs(x) >= 10000 ? [grouped(plain(x))] : [])];
  const forms = [];
  for (const num of nums) {
    for (const s of syms) forms.push({ text: `${num} ${s}`, kind: 'plain' });
    // table columns: "value | unit" and the CSV row "value,unit" (symbols only)
    for (const s of u.sym) { forms.push({ text: `${num} | ${s}`, kind: 'pipe' }, { text: `${num},${s}`, kind: 'csv' }); }
    if (!u.sci) {
      const s2 = fmtSd(x, c.sd);
      for (const s of syms) forms.push({ text: `${num} ± ${s2} ${s}`, kind: 'pm' });
      const dec = (num.split('.')[1] || '').length, units = Math.max(1, Math.round(Math.abs(x) * c.sd * 10 ** dec));
      if (!/,/.test(num) && units < 100) for (const s of syms) forms.push({ text: `${num}(${units}) ${s}`, kind: 'concise' });
    }
  }
  const dur = durationText(c.prop, x, c.unit);
  if (dur) forms.push({ text: dur, kind: 'duration' });
  const res = [];
  if (!u.sci) for (const s of syms) res.push({ re: new RegExp(`(?<![\\d.,])(\\d[\\d.]*), (\\d[\\d.]*) and (\\d[\\d.]*) ${esc(s)} (?:\\(three replicates\\)|in three replicate runs)`, 'g'), kind: 'replicates', value: x });
  return { forms, patterns: res };
}

// The comparison sentence "<Property> values (<unit>) <condition>: 12.5 for A and 13.1 for B." prints both values as bare
// numbers in the unit of the first claim (render.mjs comparisonSentence): a claim that is the first of a comparison reads
// as `${value} for`, the comparator's claim as its value converted to that unit.
export function bareNumber(c, claims) {
  const asFirst = claims.some(x => x.compareWith === c.cid);
  if (asFirst) return String(c.value);
  if (c.compareWith != null) {
    const m = claims.find(x => x.cid === c.compareWith);
    if (m) { const u = unitsOf(m.prop).find(x => x.id === m.unit), w = unitsOf(c.prop).find(x => x.id === c.unit); return String(Number(((c.value * w.f + w.o - u.o) / u.f).toPrecision(3))); }
  }
  return null;
}
// all occurrences of a claim's value in its document text: [{start, end, text, kind}] (one per start, longest wins)
export function claimOccurrences(c, text, { bare = null } = {}) {
  const { forms, patterns } = valueForms(c), byStart = new Map();
  const add = o => { const k = byStart.get(o.start); if (!k || o.end > k.end) byStart.set(o.start, o); };
  for (const f of forms) for (const o of occurrences(text, f.text, { csv: isCsvValue(f.text) })) add({ ...o, text: f.text, kind: f.kind });
  if (bare) for (const m of text.matchAll(new RegExp(`(?<=: |\\band )${esc(bare)}(?= for )`, 'g'))) if (occurrences(text, bare).some(o => o.start === m.index)) add({ start: m.index, end: m.index + bare.length, text: bare, kind: 'bare' });
  for (const p of patterns) {
    for (const m of text.matchAll(p.re)) {
      const a = Number(m[1]), b = Number(m[2]), d = Number(m[3]), mean = (f4(a) + f4(b) + f4(d)) / 3;
      if (Math.abs(mean - p.value) <= 0.0015 * Math.abs(p.value) + 1e-12) add({ start: m.index, end: m.index + m[0].length, text: m[0], kind: p.kind });
    }
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

// ---- masks of a world (names for skeletons, §3.3) ---------------------------------------------------------------------
const surname = a => String(a).split(' ').pop();
export function masksOf(world) {
  const names = new Set(), markers = new Set();
  for (const e of world.entities) {
    names.add(e.name); names.add(e.alias); names.add(`isolate ${e.alias}`);
    if (e.kind === 'organism') for (const w of e.name.split(' ')) names.add(w);
    if (e.company) names.add(e.company);
    if (e.institute) names.add(e.institute);
  }
  for (const d of world.docs) {
    for (const a of d.authors ?? []) names.add(surname(a));
    if (d.venue) names.add(d.venue);
    if (d.org) names.add(d.org);
    if (d.id) markers.add(d.id);
  }
  return { names: [...names].filter(Boolean).sort(), markers: [...markers].filter(Boolean).sort() };
}

// ---- the alignment -------------------------------------------------------------------------------------------------
// Returns { claims: [row], stats }. A row: { cid, doc, ent, entityName, prop, mode, cond, variant, press, requested, status,
// label, anchor, kind, sentence, passage, start, end, sentenceIndex }.
const S2_CONTRACT = () => loadSpec().contracts.S2;
export function alignClaims({ task, world, parsed = null }) {
  const p = parsed ?? parseTask(task), contract = S2_CONTRACT();
  const reqProps = new Set(world.requested.map(c => c.prop));
  const rows = [], byDoc = new Map();
  for (const c of world.claims) {
    const d = world.docMap.get(c.doc), id = d.id, doc = p.byId[id];
    const row = { cid: c.cid, doc: id, docKey: c.doc, docKind: d.kind, ent: c.ent, entityName: world.entMap.get(c.ent).name, prop: c.prop, mode: c.mode, cond: c.cond, variant: c.variant,
      press: d.kind === 'press', requested: reqProps.has(c.prop), unit: c.unit, status: null, label: null, excluded: null };
    if (c.mode === 'bound') row.excluded = 'bound';
    else row.label = mapLabel(contract, c.mode).label;
    const occ = doc ? claimOccurrences(c, doc.text, { bare: bareNumber(c, world.claims) }) : [];
    row.occurrences = occ.length;
    if (occ.length === 0) row.status = 'missing';
    else if (occ.length > 1) { row.status = 'ambiguous'; row.candidates = occ; } else { row.status = 'aligned'; Object.assign(row, { anchor: occ[0].text, kind: occ[0].kind, start: occ[0].start, end: occ[0].end }); }
    rows.push(row);
    if (!byDoc.has(id)) byDoc.set(id, []);
    byDoc.get(id).push(row);
  }
  // two claims that read the same span are both dropped
  for (const list of byDoc.values()) {
    const al = list.filter(r => r.status === 'aligned');
    for (const a of al) for (const b of al) if (a !== b && a.start < b.end && b.start < a.end) a.status = 'shared';
    // a claim whose single occurrence is also an occurrence of another claim's value (equal numbers, same unit) is ambiguous
    // for both: the span has two readers
    const spans = new Map();
    for (const r of list) for (const o of (r.status === 'ambiguous' ? r.candidates : r.status === 'aligned' ? [{ start: r.start, end: r.end }] : [])) { const k = o.start; spans.set(k, (spans.get(k) ?? 0) + 1); }
    for (const r of list) if (r.status === 'aligned' && spans.get(r.start) > 1) r.status = 'shared';
  }
  for (const r of rows) {
    if (r.status !== 'aligned') continue;
    const doc = p.byId[r.doc];
    // the kit must find the same single occurrence from the anchor text alone (the runtime has no world)
    const again = occurrences(doc.text, r.anchor, { csv: isCsvValue(r.anchor) });
    if (again.length !== 1 || again[0].start !== r.start) { r.status = 'ambiguous'; continue; }
    const ps = passageAround(doc.text, r.start, r.end);
    r.sentence = ps.sentence; r.passage = ps.passage; r.sentenceIndex = ps.index; r.passFrom = ps.from; r.passTo = ps.to;
  }
  return { claims: rows, stats: statsOf(rows) };
}
export function statsOf(rows) {
  const s = { claims: rows.length, aligned: 0, missing: 0, ambiguous: 0, shared: 0, byMode: {}, byKind: {} };
  for (const r of rows) {
    s[r.status]++;
    const m = (s.byMode[r.mode] ??= { claims: 0, aligned: 0 }); m.claims++; if (r.status === 'aligned') m.aligned++;
    if (r.status === 'aligned') s.byKind[r.kind] = (s.byKind[r.kind] ?? 0) + 1;
  }
  s.rate = s.claims ? s.aligned / s.claims : 0;
  const pop = rows.filter(r => r.requested && r.label);
  s.population = { claims: pop.length, aligned: pop.filter(r => r.status === 'aligned').length };
  s.population.rate = pop.length ? s.population.aligned / pop.length : 0;
  return s;
}

// ---- the acceptance measure and the contingency ------------------------------------------------------------------------
// 200 worlds of the train range: seeds 401.. with the difficulty cycling 3, 4, 5 (the S2 population is d3-d5).
export const tapWorlds = (n = TAP_WORLDS, first = 401) => Array.from({ length: n }, (_, i) => ({ seed: first + Math.floor(i / 3), difficulty: 3 + (i % 3) }));
export async function tapStatus({ beds, worlds = TAP_WORLDS, first = 401, split = 'dev' } = {}) {
  const S = await beds.import('beds/synth/index.mjs');
  const acc = { claims: 0, aligned: 0, missing: 0, ambiguous: 0, shared: 0 }, pop = { claims: 0, aligned: 0 }, byDifficulty = {}, byMode = {}, byKind = {}, byPress = { press: { claims: 0, aligned: 0 }, research: { claims: 0, aligned: 0 } };
  const lost = {};
  for (const w of tapWorlds(worlds, first)) {
    const task = S.generate({ seed: w.seed, split, difficulty: w.difficulty }), { world } = S.hidden({ seed: w.seed, split, difficulty: w.difficulty });
    const { claims } = alignClaims({ task, world });
    const dd = (byDifficulty[w.difficulty] ??= { claims: 0, aligned: 0 });
    for (const r of claims) {
      acc.claims++; acc[r.status]++; dd.claims++;
      const m = (byMode[r.mode] ??= { claims: 0, aligned: 0 }); m.claims++;
      const pr = byPress[r.press ? 'press' : 'research']; pr.claims++;
      if (r.status === 'aligned') { dd.aligned++; m.aligned++; pr.aligned++; byKind[r.kind] = (byKind[r.kind] ?? 0) + 1; } else { const k = `${r.status}:${r.mode}`; lost[k] = (lost[k] ?? 0) + 1; }
      if (r.requested && r.label) { pop.claims++; if (r.status === 'aligned') pop.aligned++; }
    }
  }
  const rate = acc.aligned / acc.claims, popRate = pop.aligned / pop.claims;
  const pass = rate >= TAP_THRESHOLD && popRate >= TAP_THRESHOLD;
  return { tapVersion: TAP_VERSION, threshold: TAP_THRESHOLD, worlds, ...acc, rate, population: { ...pop, rate: popRate }, pass, byDifficulty, byMode, byKind, byPress, lost, ...contingency(pass) };
}
// Tap below 95% on 200 worlds: S2 moves to wave 2 (smoke size) and S3 (labels from claim.cond, no tap) is produced at the
// wave-1 size instead (JUDGE-PROGRAM.md §1.1 footnote, §2.6; JUDGE-BUILD-PLAN.json acceptance 1).
export const contingency = pass => ({ s2Wave: pass ? 1 : 2, s3Wave: pass ? 2 : 1, s3Size: pass ? 'smoke' : 'wave-1', switched: !pass });

export { TYPE_LABELS, KIND_OF_TYPE, PROP_FORMS, sentenceSpans };
