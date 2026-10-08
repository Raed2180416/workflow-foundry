// Incident generator, part 2: X5 (precondition_holds on soft edges), the wave-2 smoke sets I3 (service_role), X2 (same_entity),
// X7 (item_needed) and the held-out test family X4 (statement_standing). See ports/incident.mjs for the interface and rules.
//
// X5  "the call from A to B is optional": the assumption is trusted text of a kept workflow (the question's slot); the state is
//     the service map's excerpt (overview sentences of A and B, their table rows, the dependency notes). Labels come from the
//     bed (truth.edgeDocs: an optional/provider note says soft, a hard note says hard, a mixed note says both for its two
//     edges); the flip twin replaces the decisive note by a note of the opposite kind about the same edge (a task edit with
//     the bed's own NOTES templates); the presence-matched not_stated row removes the decisive note and keeps the others.
//     The dated note pairs (NOTE_DATED), stale-row notes and shadow notes belong to the held-out family X4: no other port's
//     state shows them (family-level exclusion; the span registry check then has nothing to find).
import { kit } from '../judges/incident.mjs';
import { withNotes } from './incident-edit.mjs';
import * as lib from '../solve/incident-lib.mjs';
import * as S2 from '../solve/I2.mjs';
import * as W from './incident-world.mjs';

const { sha, hnum, unit, pick, byHash, bucketAllows, contextAllows, lineForm, formOf, makeRecord, uniformTarget, spanHash, drop, count, isoAt } = W;

// ---- X5 ---------------------------------------------------------------------------------------------------------------------
export const ASSUMPTIONS = Object.freeze([
  (a, b) => `${a}'s calls to ${b} are optional: when ${b} fails, ${a} falls back and keeps serving`,
  (a, b) => `${a} can do without ${b}: a failure of ${b} degrades ${a} but does not make ${a}'s own requests fail`,
  (a, b) => `the dependency of ${a} on ${b} is soft: ${a} survives an outage of ${b}`,
  (a, b) => `if ${b} is down, ${a} still answers its requests successfully`,
]);
const KEEP_KINDS = new Set(['optional', 'hard', 'provider', 'mixed', 'added']);   // notes a state may show
const DEP_KINDS = new Set(['optional', 'hard', 'provider', 'mixed']);
const EDGE_KINDS = new Set(['optional', 'provider', 'hard', 'mixed']);
const roleOf = (B, name) => B.C.ROLES.find(r => r.names.includes(name));

function flipNote(B, Wd, d, key, slice) {
  const role = roleOf(B, d.to);
  let templates, args;
  if (d.soft) {
    const v = `v${1 + hnum(`${key}|v1`) % 7}.${hnum(`${key}|v2`) % 40}.${hnum(`${key}|v3`) % 12}`;
    templates = [...B.C.NOTES.hard, ...B.C.NOTES_MORE.hard]; args = { what: role?.what ?? 'its data', ver: v };
  } else {
    if (!role?.fallback) return null;
    templates = [...B.C.NOTES.optional, ...B.C.NOTES_MORE.optional]; args = { fallback: role.fallback };
  }
  const order = templates.map((t, i) => ({ t, h: sha(`${key}|tpl|${i}`) })).sort((x, y) => byHash(x.h, y.h));
  for (const { t } of order) { const text = t(d.from, d.to, args); if (bucketAllows(slice, formOf(text, Wd.masks))) return text; }
  return null;
}

export function x5Rows(c0, n, out) {
  const { W: Wd, B, slice, opts, contracts, seed, difficulty } = c0, contract = contracts.X5, key = `${slice}|X5|${seed}`;
  const sys = Wd.sys, notes = sys.notes;
  const kindOf = note => B.notes && lib.classifyNote(B.notes, note).kind;
  // usable edges: one decisive note, unique in the document, in the slice's bucket
  const edges = [];
  for (const d of Wd.truth.edgeDocs) {
    if (!EDGE_KINDS.has(d.kind)) continue;
    const idx = notes.indexOf(d.text);
    if (idx < 0 || notes.lastIndexOf(d.text) !== idx) continue;
    if (!bucketAllows(slice, formOf(d.text, Wd.masks))) continue;
    edges.push({ ...d, idx });
  }
  edges.sort((a, b) => byHash(sha(`${key}|${a.from}>${a.to}`), sha(`${key}|${b.from}>${b.to}`)));
  // balance the two polarities: alternate soft and hard
  const soft = edges.filter(e => e.soft), hard = edges.filter(e => !e.soft), base = [];
  for (let i = 0; base.length < n && (i < soft.length || i < hard.length); i++) { if (i < soft.length) base.push(soft[i]); if (base.length < n && i < hard.length) base.push(hard[i]); }
  const shown = (decisiveIdx) => notes.map((t, i) => ({ t, i })).filter(({ t, i }) => i === decisiveIdx || (KEEP_KINDS.has(kindOf(t)) && contextAllows(slice, formOf(t, Wd.masks)))).map(x => x.i);
  const assumption = (a, b, k) => pick(ASSUMPTIONS, `${k}|assume`)(a, b);
  let pairNo = 0;
  base.forEach((e, bi) => {
    const k0 = `${key}|${e.from}>${e.to}`, text = assumption(e.from, e.to, k0), slots = { assumption: text };
    const idxs = shown(e.idx);
    if (idxs.filter(i => DEP_KINDS.has(kindOf(notes[i]))).length < 2) { drop('X5', 'few-dependency-notes'); return; }
    const state = kit.buildState(Wd.task, { edge: { from: e.from, to: e.to }, notes: idxs }, 'X5');
    const label = e.soft ? 'holds' : 'violated', pairId = `X5|${slice}|${seed}|${bi}`;
    const meta = x => ({ seed, difficulty, worldHash: Wd.worldHash, masks: Wd.masks, formId: formOf(e.text, Wd.masks), surface: { source: 'bed', slice, lineHash: spanHash(e.text) }, ...x });
    const natural = makeRecord({ contract, slice, opts, key: k0, state, label, slots, meta: meta({ variant: 'clean', pairId, x5: { kind: 'natural', edgeKind: e.kind, decisive: e.idx }, kit: { port: 'X5', slots: { edge: { from: e.from, to: e.to }, notes: idxs } } }) });
    // the flip twin: a note of the opposite kind about the same edge (one decisive sentence changes, nothing else)
    const flipped = e.kind === 'mixed' ? null : flipNote(B, Wd, e, `${k0}|flip`, slice);
    let twin = null;
    if (flipped) {
      const list = idxs.map(i => (i === e.idx ? flipped : notes[i]));
      const task = withNotes(Wd.task, list);
      const st = kit.buildState(task, { edge: { from: e.from, to: e.to } }, 'X5');
      twin = makeRecord({ contract, slice, opts, key: `${k0}|flip`, state: st, label: e.soft ? 'violated' : 'holds', slots,
        meta: meta({ variant: 'flip', pairId, formId: formOf(flipped, Wd.masks), surface: { source: 'bed', slice, lineHash: spanHash(flipped) }, x5: { kind: 'flip', edgeKind: e.kind === 'hard' ? 'optional' : 'hard' }, kit: { port: 'X5', slots: { edge: { from: e.from, to: e.to } }, edited: true }, edit: { replaced: e.idx } }) });
    }
    out.push(natural); count('X5', `natural-${label}`);
    if (twin) { out.push(twin); count('X5', 'flip'); } else count('X5', 'no-flip');
    // a presence-matched not_stated: the decisive note removed, the other dependency notes kept
    if (bi === 0) {
      const rest = idxs.filter(i => i !== e.idx);
      if (rest.filter(i => DEP_KINDS.has(kindOf(notes[i]))).length >= 2) {
        const task = withNotes(Wd.task, rest.map(i => notes[i]));
        const st = kit.buildState(task, { edge: { from: e.from, to: e.to } }, 'X5');
        out.push(makeRecord({ contract, slice, opts, key: `${k0}|pm`, state: st, label: 'not_stated', slots,
          meta: meta({ variant: 'unknowable', pairId: undefined, x5: { kind: 'presence-matched', edgeKind: e.kind }, kit: { port: 'X5', slots: { edge: { from: e.from, to: e.to } }, edited: true }, edit: { removed: e.idx } }) }));
        count('X5', 'presence-matched');
      } else drop('X5', 'pm-too-few-notes');
    }
    pairNo++;
  });
  // an assumption about a service the map does not describe: reported apart, at most 10% of the not_stated rows
  if (base.length && unit(`${key}|absent`) < 0.08) {
    const present = new Set([...sys.names, ...sys.aliases.map(a => a.alias)]);
    const absent = pick(B.C.ROLES.flatMap(r => r.names).filter(nm => !present.has(nm)), `${key}|absent-name`);
    const e = base[0], text = assumption(e.from, absent, `${key}|absent`), idxs = shown(e.idx);
    if (idxs.filter(i => DEP_KINDS.has(kindOf(notes[i]))).length >= 2) {
      const state = kit.buildState(Wd.task, { edge: { from: e.from, to: e.from === sys.names[0] ? sys.names[1] : sys.names[0] }, notes: idxs }, 'X5');
      out.push(makeRecord({ contract, slice, opts, key: `${key}|absent`, state, label: 'not_stated', slots: { assumption: text },
        meta: { seed, difficulty, worldHash: Wd.worldHash, masks: Wd.masks, variant: 'unknowable', formId: formOf(notes[e.idx], Wd.masks), surface: { source: 'bed', slice, lineHash: spanHash(notes[e.idx]) }, x5: { kind: 'absent-system' }, kit: { port: 'X5', slots: { edge: { from: e.from, to: e.to }, notes: idxs }, wrongEdge: true } } }));
      count('X5', 'absent-system');
    }
  }
}

// ---- I3 (wave-2 smoke) -------------------------------------------------------------------------------------------------------
const I3_LABELS = ['root', 'impacted', 'fell_back', 'unaffected'];
export function i3Rows(c0, n, out) {
  const { W: Wd, B, slice, opts, contracts, seed, difficulty } = c0, contract = contracts.I3, key = `${slice}|I3|${seed}`, tr = Wd.truth;
  const rival = tr.herrings?.rival?.svc ?? tr.herrings?.rival?.[0]?.svc ?? null;
  const roles = (name) => (name === tr.root_service ? 'root' : tr.impacted_services.includes(name) ? 'impacted' : tr.degraded.includes(name) ? 'fell_back' : 'unaffected');
  const need = { root: ['onset', 'root'], impacted: ['dep', 'collateral'], fell_back: ['soft'], unaffected: null };
  const cands = Wd.sys.names.filter(nm => nm !== rival);
  const byRole = Object.fromEntries(I3_LABELS.map(l => [l, cands.filter(nm => roles(nm) === l).sort((a, b) => byHash(sha(`${key}|${a}`), sha(`${key}|${b}`)))]));
  // a service's role shows in its warnings: the window is [T, T+600] in a triage view (WARN and ERROR lines first), at most 12 lines
  const from = isoAt(Wd, tr.T), to = isoAt(Wd, tr.T + 600);
  const rows = [];
  for (const label of I3_LABELS) {
    for (const svc of byRole[label]) {
      if (rows.filter(r => r.label === label).length >= Math.ceil(n / 4)) break;
      const { window } = kitSelect(Wd, svc, from, to);
      const ids = triage(window.filter(l => contextAllows(slice, lineForm(Wd, l.id))), 12).map(l => l.id);
      if (!ids.length) continue;
      const tags = new Set(ids.map(id => Wd.tagOf.get(id)));
      if (need[label] && !need[label].some(t => tags.has(t))) continue;
      rows.push({ label, svc, ids });
    }
  }
  for (const r of rows) {
    const state = kit.buildState(Wd.task, { service: r.svc, from, to, ids: r.ids, triage: true }, 'I3');
    out.push(makeRecord({ contract, slice, opts, key: `${key}|${r.svc}`, state, label: r.label,
      meta: { seed, difficulty, worldHash: Wd.worldHash, masks: Wd.masks, variant: 'clean', formId: formOf(Wd.log.byId.get(r.ids[0]).message, Wd.masks), surface: { source: 'bed', slice, lineHash: spanHash(state.log_lines[0]) },
        hardNegative: r.label === 'unaffected' ? Wd.truth.noisy.includes(r.svc) || (Wd.truth.herrings?.decoys ?? []).some(x => x.svc === r.svc) : null, kit: { port: 'I3', slots: { service: r.svc, from, to, ids: r.ids, triage: true } } } }));
    count('I3', r.label);
  }
}
import { selectLines, triage } from '../judges/incident.mjs';
function kitSelect(Wd, svc, from, to) { return selectLines(Wd.task, { service: svc, from, to, maxLines: 1e6, maxTokens: 1e9 }, { lines: 1e6, tokens: 1e9 }); }

// ---- X2 (wave-2 smoke) ---------------------------------------------------------------------------------------------------------
export function x2Rows(c0, n, out) {
  const { W: Wd, slice, opts, contracts, seed, difficulty } = c0, contract = contracts.X2, key = `${slice}|X2|${seed}`, sys = Wd.sys;
  const svcs = sys.services.filter(s => s.tier !== 'batch' || true);
  const pods = new Map(); for (const l of Wd.log.lines) { const s = WORLD_SERVICE(sys, l.source); if (s && l.source !== s) (pods.get(s) ?? pods.set(s, new Set()).get(s)).add(l.source); }
  const refsOf = s => [s.host, s.legacy, s.ip && `${s.ip}:${s.port}`, ...(pods.get(s.name) ?? [])].filter(Boolean);
  const order = svcs.map(s => ({ s, h: sha(`${key}|${s.name}`) })).sort((a, b) => byHash(a.h, b.h)).map(x => x.s);
  for (let i = 0; i < n && i < order.length; i++) {
    const s = order[i], refs = refsOf(s);
    if (!refs.length) continue;
    const a = pick(refs, `${key}|a|${s.name}`), same = i % 2 === 0;
    let b, label;
    if (same) { b = s.name; label = 'same'; }
    else {
      // a hard negative: a service it calls or is called by, else any other
      const near = [...s.calls, ...svcs.filter(x => x.calls.includes(s.name)).map(x => x.name)].filter(x => x !== s.name);
      b = pick(near.length ? near : svcs.map(x => x.name).filter(x => x !== s.name), `${key}|b|${s.name}`); label = 'different';
    }
    const [x, y] = unit(`${key}|swap|${i}`) < 0.5 ? [a, b] : [b, a];
    const state = kit.buildState(Wd.task, { a: x, b: y }, 'X2');
    out.push(makeRecord({ contract, slice, opts, key: `${key}|${i}`, state, label,
      meta: { seed, difficulty, worldHash: Wd.worldHash, masks: Wd.masks, variant: 'clean', formId: formOf(a, Wd.masks), surface: { source: 'bed', slice, lineHash: spanHash(`${x} ${y}`) }, hardNegative: label === 'different', kit: { port: 'X2', slots: { a: x, b: y } } } }));
    count('X2', label);
  }
}
const WORLD_SERVICE = (sys, source) => { const m = /^([a-z][a-z0-9-]*)-([0-9a-f]{5}|\d+)$/.exec(source); return m && sys.byName.has(m[1]) ? m[1] : (sys.byName.has(source) ? source : (sys.services.find(x => x.legacy === source)?.name ?? null)); };

// ---- X7 (wave-2 smoke) ---------------------------------------------------------------------------------------------------------
export const X7_SUBQUESTION = 'Which service is the root cause of the incident, and which fault class is it?';
const X7_NEEDED = new Set(['onset', 'root', 'precursor', 'dep', 'collateral']);
const X7_SKIP = new Set(['echo', 'consequence', 'shadow']);
export function x7Rows(c0, n, out) {
  const { W: Wd, B, slice, opts, contracts, seed, difficulty } = c0, contract = contracts.X7, key = `${slice}|X7|${seed}`, tr = Wd.truth;
  const cand = { needed: [], not_needed: [] };
  for (const [tag, ids] of Object.entries(tr.idsByTag)) {
    if (X7_SKIP.has(tag)) continue;
    for (const id of ids) cand[X7_NEEDED.has(tag) ? 'needed' : 'not_needed'].push({ id, tag });
  }
  const hardTags = new Set(['lookalike', 'mention', 'chronic', 'decoy', 'blip-root', 'blip-same', 'blip-other', 'blip-rival', 'stray', 'rival', 'deploy', 'renew', 'soft']);
  for (const label of ['needed', 'not_needed']) {
    const order = cand[label].map(c => ({ ...c, h: sha(`${key}|${label}|${c.id}`) })).sort((a, b) => byHash(a.h, b.h));
    let got = 0;
    for (const pass of label === 'not_needed' ? [true, false] : [null]) for (const c of order) {
      if (got >= Math.ceil(n / 2)) break;
      if (pass === true && !hardTags.has(c.tag)) continue;
      if (pass === false && hardTags.has(c.tag)) continue;
      if (!contextAllows(slice, lineForm(Wd, c.id))) continue;
      const i2 = kit.buildState(Wd.task, { line: c.id }, 'I2');
      const v = S2.solve({ state: i2 }, B.sc);
      // decidable: the I2 solver names a role, and 'needed' lines are the origin and relay ones
      if (!v.label) { drop('X7', `solver-${v.reason}`); continue; }
      if ((v.label === 'origin' || v.label === 'relay') !== (label === 'needed')) { drop('X7', 'solver-disagrees'); continue; }
      const state = kit.buildState(Wd.task, { line: c.id }, 'X7');
      out.push(makeRecord({ contract, slice, opts, key: `${key}|${c.id}`, state, label, slots: { subquestion: X7_SUBQUESTION },
        meta: { seed, difficulty, worldHash: Wd.worldHash, masks: Wd.masks, variant: 'clean', formId: lineForm(Wd, c.id), surface: { source: 'bed', slice, lineHash: spanHash(state.item) }, hardNegative: label === 'not_needed' ? hardTags.has(c.tag) : null, kit: { port: 'X7', slots: { line: c.id } } } }));
      got++; count('X7', label);
    }
  }
}

// ---- X4 (held-out test family) -----------------------------------------------------------------------------------------------------
const X4_LABEL = { 'dated-softNow': 'binding', 'dated-hardNow': 'binding', 'dated-softThen': 'superseded', 'dated-hardThen': 'superseded', shadow: 'out_of_scope' };
export function x4Rows(c0, n, out) {
  const { W: Wd, B, slice, opts, contracts, seed, difficulty } = c0, contract = contracts.X4, key = `${slice}|X4|${seed}`, notes = Wd.sys.notes;
  const rows = [];
  notes.forEach((t, i) => { const k = lib.classifyNote(B.notes, t).kind; if (X4_LABEL[k]) rows.push({ label: X4_LABEL[k], slots: { note: i }, text: t, kind: k }); });
  if (/first guess is/.test(Wd.task.inputs.ticket)) rows.push({ label: 'informal', slots: { ticket: true }, text: Wd.task.inputs.ticket.split('\n').find(l => /first guess is/.test(l)), kind: 'ticket-guess' });
  // balance the classes: round robin over the labels, hash order inside
  const by = {}; for (const r of rows) (by[r.label] ??= []).push(r);
  for (const l of Object.keys(by)) by[l].sort((a, b) => byHash(sha(`${key}|${a.text}`), sha(`${key}|${b.text}`)));
  const picked = [];
  for (let i = 0; picked.length < n; i++) { let any = false; for (const l of Object.keys(by).sort()) if (by[l][i]) { picked.push(by[l][i]); any = true; if (picked.length >= n) break; } if (!any) break; }
  for (const r of picked) {
    const state = kit.buildState(Wd.task, r.slots, 'X4');
    out.push(makeRecord({ contract, slice, opts, key: `${key}|${r.text}`, state, label: r.label,
      meta: { seed, difficulty, worldHash: Wd.worldHash, masks: Wd.masks, variant: 'clean', formId: formOf(r.text, Wd.masks), surface: { source: 'bed', slice, lineHash: spanHash(r.text) }, x4: { kind: r.kind }, kit: { port: 'X4', slots: r.slots } } }));
    count('X4', r.label);
  }
}

export const more = Object.freeze({ X5: x5Rows, I3: i3Rows, X2: x2Rows, X7: x7Rows, X4: x4Rows });
