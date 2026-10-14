// m4.mjs: the M4 coverage measurement (ATTACK-20261014 §3 M4; PROOF-LEDGER K6), $0. Task sets, golds and the kill rule
// over enumerate.mjs. No model, Jev or network call; beds are used through generate() and their exported outputSchema
// only (no oracle, reference solver or control is imported or called); no sealed split is touched (dev seeds 373-378).
//
//   const r = await measureM4();   // tools/m4-coverage.mjs writes it to research/.../design/library/out/M4-enumeration.*
//
// Task sets:
//   fixtures  the positive fixture of each executable card (15): input type = the inputs' shape (closed), output type =
//             the expected output's shape (open, like the beds' schemas); gold = [card], matched exactly;
//   wbed      W-bed R1-R3 x dev seeds 373-378 at difficulty 3 (the step-6 fixture tasks, 18): input type = the step-6
//             scripted TaskSpec (fixtures/construct-scripts.mjs S1, the accepted one), cross-checked against the inputs'
//             shape; output type = the bed's outputSchema; gold = fixtures/enumerate-gold.mjs WBED_CORE, matched as an
//             ordered subsequence. Secondary: WBED_DECLARED (best single-candidate recall) and SCRIPTED_PLANS (must be
//             enumerated: soundness).
// The kill rule reads the temporal layer at depth <= 4 over all tasks (33); the 18 W-bed rows are 3 distinct type
// problems repeated over 6 seeds (the TaskSpec and outputSchema are per rung), so the rule is also read over 18 distinct
// problems (15 + 3). Sensitivities and the code-order rank are diagnostics, never part of the rule.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadL1, CARDS_DIR } from './cards.mjs';
import { candidates } from './retrieve.mjs';
import { shapeOf } from './index.mjs';
import { ALWAYS } from './construct.mjs';
import { SCRIPTS } from './fixtures/construct-scripts.mjs';
import { WBED_RUNGS, WBED_SEEDS, WBED_CORE, WBED_DECLARED, SCRIPTED_PLANS, MATCH, fixtureGold } from './fixtures/enumerate-gold.mjs';
import { interfaces, enumerateCompositions, schemaOfValue, taskSpecInputType, listSites, temporalPairs, covering, decide, codeOrder, MAX_DEPTH, KILL, LAYERS } from './enumerate.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const fileSha = rel => sha(readFileSync(new URL(rel, import.meta.url)));
const REPO = new URL('../../', import.meta.url);

// The card files a measurement read (every Pxx/card.json), so a later change to a card is detectable.
export function cardDigests(dir = CARDS_DIR) {
  return Object.fromEntries(readdirSync(dir).filter(d => /^P\d\d$/.test(d) && existsSync(`${dir}/${d}/card.json`)).sort()
    .map(d => [d, sha(readFileSync(`${dir}/${d}/card.json`))]));
}

// S4 as construct.mjs runs it (tier S, effects none/read, plus ALWAYS), as executable card ids in the shown order.
export function s4Shown({ task, taskSpec = null, l1 }) {
  const cand = candidates({ task, taskSpec, l1, host: { tiers: ['S'], effects: ['none', 'read'], project: null }, shape: shapeOf(task) });
  let list = cand.candidates.map(c => c.id);
  for (const id of ALWAYS) if (!list.includes(id)) list = [...list.slice(0, 19), id];
  const exec = new Set(l1.filter(e => e.executable).map(e => e.id));
  return list.filter(id => exec.has(id));
}

export function fixtureTasks(l1 = loadL1()) {
  return l1.filter(e => e.executable).map(e => {
    const fx = e.fixtures.find(f => f.name === 'positive');
    return { set: 'fixtures', id: `fixture:${e.id}`, card: e.id, task: fx.task, input: schemaOfValue(fx.task.inputs, { closed: true }), inputSource: 'inputs (code)',
      output: schemaOfValue(fx.expect.output), golds: fixtureGold(e.id), match: MATCH.fixture, taskSpec: null };
  });
}

export async function wbedTasks({ seeds = WBED_SEEDS, difficulty = 3 } = {}) {
  const out = [];
  for (const r of WBED_RUNGS) {
    const m = await import(new URL(`beds/wbed/${r}/index.mjs`, REPO).href);
    const ts = SCRIPTS[`wbed-${r}`]().S1.at(-1);   // the TaskSpec S1 accepts (R2's first one is rejected by design)
    for (const seed of seeds) {
      const t = m.generate({ seed, split: 'dev', difficulty });
      const task = { prompt: t.prompt, inputs: t.inputs };
      out.push({ set: 'wbed', id: t.id, rung: r, seed, task, taskSpec: ts, input: taskSpecInputType(ts), inputSource: 'TaskSpec (step-6 script)',
        inputCode: schemaOfValue(t.inputs, { closed: true }), output: m.outputSchema, golds: WBED_CORE[r], match: MATCH.wbed,
        declared: WBED_DECLARED[r], scripted: SCRIPTED_PLANS[r] });
    }
  }
  return out;
}

const summary = e => ({ total: e.total, byDepth: e.byDepth, pruned: e.pruned });

// One task: every layer, the sensitivities, coverage and the diagnostics.
export function measureTask(t, { cards, l1 }) {
  const row = { set: t.set, id: t.id, ...(t.card ? { card: t.card } : {}), ...(t.rung ? { rung: t.rung, seed: t.seed } : {}), inputSource: t.inputSource,
    inputListSites: listSites(t.input), layers: {}, sensitivities: {} };
  for (const layer of LAYERS) row.layers[layer] = summary(enumerateCompositions({ input: t.input, output: t.output, cards, layer, keep: false }));
  const main = enumerateCompositions({ input: t.input, output: t.output, cards, layer: 'temporal' });
  const hits = covering(main.candidates, t.golds, t.match);
  row.total = main.total;
  row.covered = hits.length > 0;
  row.covering = { count: hits.length, minDepth: hits.length ? Math.min(...hits.map(s => s.length)) : null, examples: hits.slice(0, 8).map(s => s.join('>')) };
  const shown = s4Shown({ task: t.task, taskSpec: t.taskSpec, l1 });
  const ordered = codeOrder(main.candidates, shown);
  const firstGold = ordered.findIndex(s => t.golds.some(g => covering([s], [g], t.match).length));
  row.codeOrder = { ranking: shown, goldRank: firstGold >= 0 ? firstGold + 1 : null, top5: ordered.slice(0, 5).map(s => s.join('>')) };
  const sens = {
    distinct: { distinct: true },
    s4Alphabet: { alphabet: shown },
    depth3: { maxDepth: 3 },
    all: { distinct: true, alphabet: shown, maxDepth: 3 },
  };
  for (const [k, o] of Object.entries(sens)) {
    const e = enumerateCompositions({ input: t.input, output: t.output, cards, layer: 'temporal', ...o });
    row.sensitivities[k] = { total: e.total, byDepth: e.byDepth, covered: covering(e.candidates, t.golds, t.match).length > 0 };
  }
  if (t.inputCode) {   // the TaskSpec's input type against the inputs' own shape
    const e = enumerateCompositions({ input: t.inputCode, output: t.output, cards, layer: 'temporal', keep: false });
    row.inputCrossCheck = { listSitesTaskSpec: listSites(t.input), listSitesInputs: listSites(t.inputCode), totalFromInputs: e.total, agrees: e.total === main.total };
  }
  if (t.declared) {
    const exec = t.declared.filter(id => cards.some(c => c.id === id));
    const best = Math.max(0, ...main.candidates.map(s => exec.filter(id => s.includes(id)).length));
    row.declared = { members: t.declared, executable: exec, bestCandidateRecall: exec.length ? best / exec.length : null, bestHits: best, fullContainmentPossible: exec.length <= MAX_DEPTH && best === exec.length };
  }
  if (t.scripted) row.scriptedPlanEnumerated = main.candidates.some(s => s.length === t.scripted.length && s.every((id, i) => id === t.scripted[i]));
  return row;
}

export async function measureM4() {
  const l1 = loadL1(), cards = interfaces(l1);
  const tasks = [...fixtureTasks(l1), ...await wbedTasks()];
  const rows = tasks.map(t => measureTask(t, { cards, l1 }));
  const distinct = [...rows.filter(r => r.set === 'fixtures'), ...WBED_RUNGS.map(r => rows.find(x => x.rung === r))];
  const decisionOf = rs => decide(rs.map(r => ({ total: r.total, covered: r.covered })));
  const per = set => decisionOf(rows.filter(r => r.set === set));
  const sensDecision = k => decide(rows.map(r => ({ total: r.sensitivities[k].total, covered: r.sensitivities[k].covered })));
  return {
    schema: 'library-m4-enumeration/1', generatedBy: 'experiments/library/tools/m4-coverage.mjs', costUsd: 0, modelCalls: 0, jevCalls: 0,
    files: { enumerate: fileSha('./enumerate.mjs'), gold: fileSha('./fixtures/enumerate-gold.mjs'), m4: fileSha('./m4.mjs') }, cardDigests: cardDigests(),
    rule: { ...KILL, text: 'kill if > 100 candidates at depth <= 4 on more than half the tasks, or coverage < 80% (ATTACK-20261014 §3 M4)', layer: 'temporal', maxDepth: MAX_DEPTH },
    cards: cards.map(c => ({ id: c.id, readers: c.readers, needsLists: c.needsLists, out: c.out.slotTyped ? 'slot-typed' : Object.keys(c.out.properties) })),
    temporal: temporalPairs(cards).map(p => ({ pair: `${p.before}<${p.after}`, source: p.source })),
    decision: { all: decisionOf(rows), distinctProblems: decisionOf(distinct), fixtures: per('fixtures'), wbed: per('wbed') },
    sensitivityDecisions: Object.fromEntries(['distinct', 's4Alphabet', 'depth3', 'all'].map(k => [k, sensDecision(k)])),
    rows,
  };
}
