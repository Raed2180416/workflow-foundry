// Stage contracts, stage oracles and cross-stage relations for W-bed R4 (W-BED §2.1 `stages`, §2.2 items 2-3).
//
// Stage oracles are analyst-side diagnostics, never success criteria. Each scores only what its stage owns:
//   children   each pack's output against its own rung's oracle (R1/R3), every subsidiary once; in the composed oracle
//              each child's trace is also scored by its own rung's composed oracle (child stages + child relations)
//   translate  the intercompany side only: per subsidiary, the schedule's receivables and payables (raw schedule x
//              consolidation-date rates). The external side is the join with the pack outputs: relation W2
//   pair       the intercompany pairs, set-exact (the judged step)
//   eliminate  local to the pair hand-off it was given: one row per pair, at the receivable's translated amount
//   report     local: the stated group currency, every subsidiary once with its pack kind, no schedule item in two
//              eliminations, consolidated = gross - eliminated on both sides, eliminated = sum, counts
// What no stage owns are the joins:
//   W1 pack carried: the report carries each pack's output unchanged, and that output is the child trace's own result
//   W2 pack translation: the external balances are the stated translation of the pack outputs (field, rate date,
//      per-currency rounding), and the report's four balances are the translate hand-off's
//   W3 eliminations carried: the report's eliminations are the eliminate hand-off's
//   W4 group conservation: gross balances of the translate hand-off minus the eliminate hand-off's amounts equal the
//      consolidated receivables and payables, and eliminated_minor is that amount
// The composed oracle is (every child's composed oracle) AND (every parent stage oracle) AND (every relation); on any
// trace it agrees with the end-to-end oracle (tests: reference and every bad control).
import { contract, int, str, arr, obj } from '../lib/contracts.mjs';
import { canonical } from '../lib/prng.mjs';
import { outputSchema, BALANCES, pairKey, elimKey } from './score.mjs';
import { FAMILIES, plantedComposedOracle, childOracle } from './children.mjs';
import { externalOf, icOf, eliminationsOf } from './pipeline.mjs';

const bal = { external_receivables_minor: int, external_payables_minor: int, ic_receivables_minor: int, ic_payables_minor: int };
export const CONTRACTS = {
  input: contract('wbed-r4/input', obj({ subsidiaries: { type: 'object' }, register: str(2e5), intercompany: { type: 'object' }, group_notes: str(2e5), group_spec: str(2e5) })),
  children: contract('wbed-r4/children', obj({ children: arr(obj({ sub_id: str(8), output: { type: 'object' } }), 16) })),
  translate: contract('wbed-r4/translate', obj({ subsidiaries: arr(obj({ sub_id: str(8), ...bal }), 16) })),
  pair: contract('wbed-r4/pair', obj({ pairs: arr(obj({ receivable_item: str(20), payable_item: str(20) }), 400) })),
  eliminate: contract('wbed-r4/eliminate', obj({ eliminations: arr(obj({ receivable_item: str(20), payable_item: str(20), amount_minor: int }), 800) })),
  report: contract('wbed-r4/report', outputSchema),
};

const result = (errors, problems) => (errors.length ? { pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } } : { pass: problems.length === 0, details: { problems: problems.slice(0, 8) } });
const childFinal = (family, trace) => (family === 'wbed-r1' ? trace?.report : trace?.reduce);
const sameIds = (want, got) => want.length === got.length && new Set(got).size === got.length && want.every(id => got.includes(id));

/** Local report checks: the report's own arithmetic and shape against the stated register. */
export function reportLocal(world, rep) {
  const errors = CONTRACTS.report.check(rep);
  if (errors.length) return result(errors, []);
  const problems = [];
  if (rep.group_currency !== world.groupCurrency) problems.push('group_currency');
  if (!sameIds(world.subs.map(s => s.id), rep.subsidiaries.map(s => s.sub_id))) problems.push('subsidiaries');
  for (const s of rep.subsidiaries) { const w = world.subs.find(x => x.id === s.sub_id); if (w && w.pack !== s.pack) problems.push(`pack-${s.sub_id}`); }
  const items = rep.eliminations.flatMap(e => [e.receivable_item, e.payable_item]);
  if (new Set(items).size !== items.length) problems.push('item-in-two-eliminations');
  const sum = f => rep.subsidiaries.reduce((a, s) => a + s[f], 0);
  const el = rep.eliminations.reduce((a, e) => a + e.amount_minor, 0);
  const c = rep.consolidated;
  if (c.eliminated_minor !== el) problems.push('eliminated_minor');
  if (c.eliminations !== rep.eliminations.length) problems.push('eliminations-count');
  if (c.subsidiaries !== rep.subsidiaries.length) problems.push('subsidiaries-count');
  if (c.receivables_minor !== sum('external_receivables_minor') + sum('ic_receivables_minor') - c.eliminated_minor) problems.push('receivables-conservation');
  if (c.payables_minor !== sum('external_payables_minor') + sum('ic_payables_minor') - c.eliminated_minor) problems.push('payables-conservation');
  return result([], problems);
}

const byId = (xs, k = 'sub_id') => new Map((xs ?? []).map(x => [x?.[k], x]));
export const RELATIONS = [
  { id: 'W1-pack-carried', stages: ['children', 'report'],
    text: 'the report carries each pack\'s output unchanged, and that output is the child trace\'s own final result',
    check: (trace, world) => {
      const rep = byId(trace.report.subsidiaries), kids = byId(trace.children);
      const bad = world.subs.filter(s => {
        const k = kids.get(s.id), r = rep.get(s.id);
        if (!k || !r) return true;
        if (k.trace && canonical(childFinal(s.family, k.trace)) !== canonical(k.output)) return true;
        return canonical(r.report) !== canonical(k.output);
      }).map(s => s.id);
      return { pass: bad.length === 0, details: { subsidiaries: bad } };
    } },
  { id: 'W2-pack-translation', stages: ['children', 'translate', 'report'],
    text: 'external balances = the stated translation of each pack output (totals.open or adjusted balances, the pack\'s rate date, per-currency sums); the report\'s balances are the translate hand-off\'s',
    check: (trace, world) => {
      const tl = byId(trace.translate.subsidiaries), rep = byId(trace.report.subsidiaries), kids = byId(trace.children);
      const bad = [];
      for (const s of world.subs) {
        const t = tl.get(s.id), r = rep.get(s.id), k = kids.get(s.id);
        if (!t || !r || !k) { bad.push(s.id); continue; }
        const e = externalOf(world, s, k.output);
        if (t.external_receivables_minor !== e.rec || t.external_payables_minor !== e.pay) bad.push(`${s.id}:external`);
        if (BALANCES.some(f => r[f] !== t[f])) bad.push(`${s.id}:carried`);
      }
      return { pass: bad.length === 0, details: { bad } };
    } },
  { id: 'W3-eliminations-carried', stages: ['eliminate', 'report'],
    text: 'the report\'s eliminations are the eliminate hand-off\'s (pairs and amounts)',
    check: trace => {
      const a = trace.report.eliminations.map(elimKey).sort().join(','), b = trace.eliminate.eliminations.map(elimKey).sort().join(',');
      return { pass: a === b, details: { report: trace.report.eliminations.length, eliminate: trace.eliminate.eliminations.length } };
    } },
  { id: 'W4-group-conservation', stages: ['translate', 'eliminate', 'report'],
    text: 'gross receivables and payables of the translate hand-off minus the eliminate hand-off\'s amounts = consolidated; eliminated_minor = that amount',
    check: trace => {
      const el = trace.eliminate.eliminations.reduce((a, e) => a + e.amount_minor, 0);
      const sum = f => trace.translate.subsidiaries.reduce((a, s) => a + s[f], 0);
      const c = trace.report.consolidated;
      const want = { rec: sum('external_receivables_minor') + sum('ic_receivables_minor') - el, pay: sum('external_payables_minor') + sum('ic_payables_minor') - el };
      const pass = c.receivables_minor === want.rec && c.payables_minor === want.pay && c.eliminated_minor === el;
      return { pass, details: { expected: { ...want, eliminated: el }, got: { rec: c.receivables_minor, pay: c.payables_minor, eliminated: c.eliminated_minor } } };
    } },
];

/** Stage definitions. `truthOf(task)` gives the exact solver's trace; `worldOf(task)` the hidden world. */
export function makeStages(truthOf, worldOf, inputOf) {
  return [
    { id: 'children', inputSchema: CONTRACTS.input.schema, outputSchema: CONTRACTS.children.schema,
      project: task => ({ task, input: inputOf(task) }),
      oracle: (st, out) => {
        const errors = CONTRACTS.children.check(out);
        if (errors.length) return result(errors, []);
        const world = worldOf(st.task), got = byId(out.children), problems = [];
        if (!sameIds(world.subs.map(s => s.id), out.children.map(c => c.sub_id))) problems.push('subsidiaries');
        for (const s of world.subs) {
          const c = got.get(s.id);
          if (!c) continue;
          let v; try { v = childOracle(s, c.output); } catch { v = { pass: false }; }
          if (!v.pass) problems.push(`${s.id}:${s.family}`);
        }
        return result([], problems);
      } },
    { id: 'translate', inputSchema: CONTRACTS.children.schema, outputSchema: CONTRACTS.translate.schema,
      project: task => ({ task, input: { children: truthOf(task).children.map(c => ({ sub_id: c.sub_id, output: c.output })) } }),
      oracle: (st, out) => {
        const errors = CONTRACTS.translate.check(out);
        if (errors.length) return result(errors, []);
        const world = worldOf(st.task), got = byId(out.subsidiaries), problems = [];
        if (!sameIds(world.subs.map(s => s.id), out.subsidiaries.map(s => s.sub_id))) problems.push('subsidiaries');
        for (const s of world.subs) {
          const t = got.get(s.id), ic = icOf(world, s.id);
          if (t && (t.ic_receivables_minor !== ic.rec || t.ic_payables_minor !== ic.pay)) problems.push(`${s.id}:intercompany`);
        }
        return result([], problems);
      } },
    { id: 'pair', inputSchema: CONTRACTS.input.schema, outputSchema: CONTRACTS.pair.schema,
      project: task => ({ task, input: inputOf(task) }),
      oracle: (st, out) => {
        const errors = CONTRACTS.pair.check(out);
        if (errors.length) return result(errors, []);
        const want = worldOf(st.task).pairs.map(pairKey).sort().join(','), got = out.pairs.map(pairKey).sort().join(',');
        return result([], want === got ? [] : ['pairs']);
      } },
    { id: 'eliminate', inputSchema: CONTRACTS.pair.schema, outputSchema: CONTRACTS.eliminate.schema,
      project: task => ({ task, input: truthOf(task).pair }),
      oracle: (st, out) => {
        const errors = CONTRACTS.eliminate.check(out);
        if (errors.length) return result(errors, []);
        let want;
        try { want = eliminationsOf(worldOf(st.task), st.input.pairs).map(elimKey).sort().join(','); } catch { return result([], ['unknown-item']); }
        return result([], out.eliminations.map(elimKey).sort().join(',') === want ? [] : ['eliminations']);
      } },
    { id: 'report', inputSchema: CONTRACTS.eliminate.schema, outputSchema: CONTRACTS.report.schema,
      project: task => ({ task, input: { translate: truthOf(task).translate, eliminate: truthOf(task).eliminate } }),
      oracle: (st, out) => reportLocal(worldOf(st.task), out) },
  ];
}

/** Each child's trace by its own rung's composed oracle (planted children: R1's stages over the planted truth). */
export function childComposed(world, trace, plantedTruthOf) {
  const out = {};
  const kids = byId(trace.children);
  for (const s of world.subs) {
    const k = kids.get(s.id);
    if (!k || !k.trace) { out[s.id] = { pass: false, details: { reason: 'no child trace' } }; continue; }
    try {
      out[s.id] = s.planted
        ? plantedComposedOracle(s.task, k.trace, plantedTruthOf(s), s.task.inputs)
        : FAMILIES[s.family].composedOracle(s.task, k.trace);
    } catch (e) { out[s.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  return out;
}

/** Child composed oracles, parent stage oracles on the trace's own hand-offs, and every relation. */
export function composeOracle(stages, task, trace, world, plantedTruthOf) {
  const children = childComposed(world, trace, plantedTruthOf);
  // Each stage on the trace's own hand-off; the eliminate stage against the pair hand-off the trace produced.
  const handOff = { ...trace, children: { children: (trace.children ?? []).map(c => ({ sub_id: c?.sub_id, output: c?.output })) } };
  const per = {};
  for (const s of stages) per[s.id] = s.oracle(s.id === 'eliminate' ? { task, input: trace.pair } : s.project(task), handOff[s.id]);
  const rel = {};
  for (const x of RELATIONS) {
    try { rel[x.id] = x.check(trace, world); } catch (e) { rel[x.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  const pass = Object.values(children).every(r => r.pass) && Object.values(per).every(r => r.pass) && Object.values(rel).every(r => r.pass);
  return { pass, children, stages: per, relations: rel };
}
