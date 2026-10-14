// m4b.mjs: M4 re-measured on the precise card type model (M4b; ATTACK-20261014 §3 M4; PROOF-LEDGER K6), $0. The same
// task sets, the same frozen gold (fixtures/enumerate-gold.mjs), the same kill rule (enumerate.mjs KILL) read at the same
// depth with the same temporal constraints; only the catch-all cards' interfaces change (card-types.mjs PRECISE). No
// model, Jev or network call; beds through generate() and outputSchema only; dev seeds 373-378; nothing sealed.
//
//   const r = await measureM4b();   // tools/m4b-coverage.mjs writes research/.../design/library/out/M4b-enumeration.*
//
// Per task:
//   m4        M4's own number (enumerate.mjs, layer temporal), for the delta;
//   precise   the rule's layer: precise interfaces + temporal constraints, existential reading (as M4);
//   bounds    polymorphicOnly: compositions of the four catch-all cards alone. They type-check whatever types the other
//             eleven cards are given, so this is a lower bound on the count under ANY typing of those eleven;
//             strictOthers: the verifier's bound (a non-catch-all reader only right after a param-carrying output);
//   diagnostics (never the rule): the checked reading; P01 and P54 as type-preserving (a counterfactual: their skeletons
//             reshape, see PRECISE); both; and M4's sensitivities on the precise layer plus the verifier's distinct + depth 3.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadL1 } from './cards.mjs';
import { fixtureTasks, wbedTasks, s4Shown, cardDigests } from './m4.mjs';
import { WBED_RUNGS } from './fixtures/enumerate-gold.mjs';
import { interfaces, enumerateCompositions, covering, decide, codeOrder, KILL, MAX_DEPTH } from './enumerate.mjs';
import { preciseInterfaces, enumeratePrecise, citationProblems, PRECISE, CATCH_ALLS } from './card-types.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const fileSha = rel => sha(readFileSync(new URL(rel, import.meta.url)));

export const DIAGNOSTICS = Object.freeze({
  checked: { mode: 'checked' },
  preserveP01P54: { preserve: ['P01', 'P54'] },
  checkedPreserve: { mode: 'checked', preserve: ['P01', 'P54'] },
});
export const SENSITIVITIES = Object.freeze({
  distinct: { distinct: true },
  s4Alphabet: null,   // the task's S4 shown set, filled per task
  depth3: { maxDepth: 3 },
  distinctDepth3: { distinct: true, maxDepth: 3 },   // the verifier's added row (M4 verdict finding 2)
  all: null,          // distinct + S4 alphabet + depth 3
});
export const BOUNDS = Object.freeze({
  polymorphicOnly: { alphabet: CATCH_ALLS },
  polymorphicOnlyChecked: { alphabet: CATCH_ALLS, mode: 'checked' },
  strictOthers: { strictOthers: true },
});

const coveredBy = (e, t) => covering(e.candidates, t.golds, t.match);

// What the type model reads of each executable card: tier, fragment, slot names and types, temporal rules, and for a
// catch-all its skeleton. A doc or checklist edit leaves it unchanged; an interface change changes it (the reproduction
// test then fails rather than skips). cardDigests (whole card.json) is recorded beside it for information.
export function interfaceDigests(l1 = loadL1()) {
  return Object.fromEntries(l1.filter(e => e.executable).sort((a, b) => (a.id < b.id ? -1 : 1)).map(e => [e.id, sha(JSON.stringify({ tier: e.tier,
    fragment: e.fragment ?? null, slots: (e.slots ?? []).map(d => [d.name, d.type]), temporal: e.temporal ?? null, ...(CATCH_ALLS.includes(e.id) ? { skeleton: e.skeletonSha256 } : {}) }))]));
}

export function measureTaskB(t, { cards, m4cards, l1 }) {
  const run = (o = {}) => enumeratePrecise({ input: t.input, output: t.output, cards, ...o });
  const m4 = enumerateCompositions({ input: t.input, output: t.output, cards: m4cards, layer: 'temporal', keep: false });
  const main = run();
  const hits = coveredBy(main, t);
  const shown = s4Shown({ task: t.task, taskSpec: t.taskSpec, l1 });
  const ordered = codeOrder(main.candidates, shown);
  const firstGold = ordered.findIndex(s => t.golds.some(g => covering([s], [g], t.match).length));
  const row = {
    set: t.set, id: t.id, ...(t.card ? { card: t.card } : {}), ...(t.rung ? { rung: t.rung, seed: t.seed } : {}),
    m4: { total: m4.total, byDepth: m4.byDepth },
    total: main.total, byDepth: main.byDepth, pruned: main.pruned, typedOnly: run({ temporal: false }).total,
    covered: hits.length > 0, covering: { count: hits.length, minDepth: hits.length ? Math.min(...hits.map(s => s.length)) : null, examples: hits.slice(0, 8).map(s => s.join('>')) },
    codeOrder: { ranking: shown, goldRank: firstGold >= 0 ? firstGold + 1 : null, top5: ordered.slice(0, 5).map(s => s.join('>')) },
    bounds: {}, diagnostics: {}, sensitivities: {},
  };
  for (const [k, o] of Object.entries(BOUNDS)) { const e = run({ ...o, keep: false }); row.bounds[k] = { total: e.total, byDepth: e.byDepth }; }
  for (const [k, o] of Object.entries(DIAGNOSTICS)) { const e = run(o); row.diagnostics[k] = { total: e.total, byDepth: e.byDepth, covered: coveredBy(e, t).length > 0 }; }
  const sens = { ...SENSITIVITIES, s4Alphabet: { alphabet: shown }, all: { distinct: true, alphabet: shown, maxDepth: 3 } };
  for (const [k, o] of Object.entries(sens)) { const e = run(o); row.sensitivities[k] = { total: e.total, byDepth: e.byDepth, covered: coveredBy(e, t).length > 0 }; }
  if (t.scripted) row.scriptedPlanEnumerated = main.candidates.some(s => s.length === t.scripted.length && s.every((id, i) => id === t.scripted[i]));
  return row;
}

export async function measureM4b() {
  const bad = citationProblems();
  if (bad.length) throw new Error(`m4b: a skeleton no longer says what card-types.mjs cites: ${bad.join('; ')}`);
  const l1 = loadL1(), cards = preciseInterfaces(l1), m4cards = interfaces(l1);
  const tasks = [...fixtureTasks(l1), ...await wbedTasks()];
  const rows = tasks.map(t => measureTaskB(t, { cards, m4cards, l1 }));
  const distinct = [...rows.filter(r => r.set === 'fixtures'), ...WBED_RUNGS.map(r => rows.find(x => x.rung === r))];
  const decisionOf = rs => decide(rs.map(r => ({ total: r.total, covered: r.covered })));
  const per = set => decisionOf(rows.filter(r => r.set === set));
  const over = (pick, rs = rows) => rs.filter(r => pick(r) > KILL.maxCandidates).length;
  return {
    schema: 'library-m4b-enumeration/1', generatedBy: 'experiments/library/tools/m4b-coverage.mjs', costUsd: 0, modelCalls: 0, jevCalls: 0,
    files: { cardTypes: fileSha('./card-types.mjs'), m4b: fileSha('./m4b.mjs'), enumerate: fileSha('./enumerate.mjs'), m4: fileSha('./m4.mjs'), gold: fileSha('./fixtures/enumerate-gold.mjs') },
    interfaceDigests: interfaceDigests(l1), cardDigests: cardDigests(),
    rule: { ...KILL, text: 'kill if > 100 candidates at depth <= 4 on more than half the tasks, or coverage < 80% (ATTACK-20261014 §3 M4); unchanged from M4', layer: 'precise interfaces + temporal constraints, existential reading', maxDepth: MAX_DEPTH },
    precise: Object.fromEntries(Object.entries(PRECISE).map(([id, p]) => [id, { readers: p.readers, reads: p.reads, out: p.out, preserving: p.preserving, notRead: p.notRead ?? null, claims: p.claims }])),
    cards: cards.map(c => ({ id: c.id, precise: c.precise, readers: c.readers.map(r => r.slot + (r.items ? ' (non-null items)' : '')), anyInput: c.anyInput, check: c.check })),
    decision: { all: decisionOf(rows), distinctProblems: decisionOf(distinct), fixtures: per('fixtures'), wbed: per('wbed') },
    m4Decision: decide(rows.map(r => ({ total: r.m4.total, covered: true }))),
    unchanged: rows.filter(r => r.total === r.m4.total).length,
    boundDecisions: Object.fromEntries(Object.keys(BOUNDS).map(k => [k, { tasksOver100: over(r => r.bounds[k].total), min: Math.min(...rows.map(r => r.bounds[k].total)), max: Math.max(...rows.map(r => r.bounds[k].total)),
      wbedOver100: over(r => r.bounds[k].total, rows.filter(r => r.set === 'wbed')) }])),
    diagnosticDecisions: Object.fromEntries(Object.keys(DIAGNOSTICS).map(k => [k, decide(rows.map(r => ({ total: r.diagnostics[k].total, covered: r.diagnostics[k].covered })))])),
    sensitivityDecisions: Object.fromEntries(Object.keys(SENSITIVITIES).map(k => [k, decide(rows.map(r => ({ total: r.sensitivities[k].total, covered: r.sensitivities[k].covered })))])),
    rows,
  };
}
