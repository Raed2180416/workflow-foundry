// T3 (LIBRARY-TESTS §2; LIBRARY §6; L1-PATTERNS §9): the composition checker catches each violation. A clean composed
// tree (a parent that fans entities out to a child through P54 and checks a quorum with P15; the child is a P01 pipeline
// with a conservation identity) and the 12 first-slice card examples as one-node solvers fire no code; for every code,
// one mutant fires exactly that code. Static, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCard } from '../cards.mjs';
import { openLibrary } from '../store.mjs';
import { registerChildren } from '../run.mjs';
import { resolveRefs } from '../assemble.mjs';
import { checkTree, checkSolver, CODES, fnParts } from '../check.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const card = id => loadCard(id);
const TMP = mkdtempSync(path.join(tmpdir(), 'lib-check-'));
test.after(() => rmSync(TMP, { recursive: true, force: true }));
let libN = 0;
const clone = v => JSON.parse(JSON.stringify(v));
const codes = r => [...new Set(r.findings.map(f => f.code))].sort();

const LINE = { type: 'object', required: ['account', 'amountMinor'], properties: { account: { type: 'string' }, amountMinor: { type: 'integer' } } };
const ENTITY_IN = { type: 'object', required: ['entity', 'currency', 'lines'], properties: { entity: { type: 'string' }, currency: { type: 'string' }, lines: { type: 'array', items: LINE } } };
const ENTITY_OUT = { type: 'object', required: ['totalMinor'], properties: { totalMinor: { type: 'integer' } } };
const entity = (code, currency, ...amounts) => ({ code, currency, lines: amounts.map(a => ({ account: '4000', amountMinor: a })) });

// The clean reference tree.
function reference() {
  return {
    root: 'close-group',
    nodes: {
      'close-group': {
        budgetUsd: 0.5, effects: 'none',
        samples: [
          { prompt: 'Close the month for each entity.', inputs: { entities: [entity('DE01', 'EUR', 12000, 3000), entity('FR01', 'EUR', 500)] } },
          { prompt: 'Close the month for each entity.', inputs: { entities: [entity('NL01', 'EUR', 7000, 2500)] } } ],
        parts: [
          { card: card('P54'), slots: {
            PARTS: "(task, x) => x.entities.map(e => ({ key: e.code, input: { entity: e.code, currency: e.currency, lines: e.lines } }))",
            REF: '@node:entity-close', CHILD_BUDGET: 0.05, ON_REFUSE: 'deopt', CONCURRENCY: 2,
            COMBINE: "(kids, parts) => ({ entities: parts.map((p, i) => ({ id: p.key, currency: p.input.currency, totalMinor: kids[i].totalMinor })) })",
            ARG: ENTITY_IN, READS: ENTITY_OUT } },
          { card: card('P15'), slots: {
            PARTS: 'x.entities', KEY: '(p) => p.currency', AGG: '(ps) => ({ entities: ps.length, totalMinor: ps.reduce((n, p) => n + p.totalMinor, 0) })',
            IDENTITY: '(ps, report) => Object.values(report).reduce((n, g) => n + g.totalMinor, 0) === ps.reduce((n, p) => n + p.totalMinor, 0)', QUORUM: 1 } } ] },
      'entity-close': {
        budgetUsd: 0.05, effects: 'none', contract: { input: ENTITY_IN, output: ENTITY_OUT, taskTemplate: 'Close one entity' },
        samples: [ { entity: 'DE01', currency: 'EUR', lines: [{ account: '4000', amountMinor: 12000 }, { account: '4000', amountMinor: 3000 }] },
          { entity: 'FR01', currency: 'EUR', lines: [{ account: '4000', amountMinor: 500 }] },
          { entity: 'NL01', currency: 'EUR', lines: [{ account: '4100', amountMinor: 7000 }, { account: '4000', amountMinor: 2500 }] },
          { entity: 'BE01', currency: 'EUR', lines: [{ account: '4000', amountMinor: 900 }] } ].map(inputs => ({ inputs })),
        parts: [ { card: card('P01'), slots: {
          STAGES: [
            { name: 'posted', kind: 'step', fn: '(v) => ({ entity: v.entity, lines: v.lines.filter(l => l.account.startsWith(\'4\')) })', out: { type: 'object', required: ['entity', 'lines'] } },
            { name: 'total', kind: 'step', fn: '(v) => ({ totalMinor: v.lines.reduce((n, l) => n + l.amountMinor, 0) })', out: ENTITY_OUT } ],
          CONSERVE: '(input, output) => output.totalMinor === input.lines.reduce((n, l) => n + l.amountMinor, 0)' } } ] },
    },
    effectPlan: [{ binding: 'B:ledger-post', target: 'ledger:group-close', writer: 'close-group' }],
  };
}
const root = t => t.nodes['close-group'].parts[0].slots;
const child = t => t.nodes['entity-close'].parts[0].slots;

// The card examples as one-node solvers (children from each card's positive fixture, registered in a temp library).
function single(id, mutate = null) {
  const c = card(id), fx = c.fixtures.find(f => f.name === 'positive');
  const lib = openLibrary(path.join(TMP, `lib${libN++}`));
  const slots = resolveRefs({ ...clone(c.example.slots), ...(fx.slots ?? {}) }, registerChildren(lib, fx.children ?? []));
  if (mutate) mutate(slots);
  return checkSolver({ parts: [{ card: c, slots }], samples: c.fixtures.map(f => f.task) }, { registry: lib.registry });
}
// A P54 hop: passes its input straight to the next node.
const hop = (next, budgetUsd) => ({ budgetUsd, effects: 'none', contract: { input: ENTITY_IN, output: ENTITY_OUT }, parts: [{ card: card('P54'), slots: {
  PARTS: '(task, x) => [{ key: x.entity, input: x }]', REF: `@node:${next}`, CHILD_BUDGET: budgetUsd / 2, ON_REFUSE: 'deopt', CONCURRENCY: 1,
  COMBINE: '(kids) => kids[0]', ARG: ENTITY_IN, READS: ENTITY_OUT } }] });

test('T3: the clean reference tree fires no code', () => {
  const r = checkTree(reference());
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.edges.map(e => [e.from, e.to, e.depth]), [['close-group', 'node:entity-close', 1]]);
});

test('T3: the 12 first-slice card examples, each as a one-node solver, fire no code', () => {
  for (const id of ['P01', 'P03', 'P07', 'P08', 'P09', 'P12', 'P13', 'P15', 'P16', 'P17', 'P20', 'P54']) {
    const r = single(id);
    assert.deepEqual(r.findings, [], id);
  }
  // P07's map handler declares no argument type: reported as unchecked (the host checks it at run time), not passed.
  assert.deepEqual(single('P07').unchecked.map(u => u.at), ['HANDLERS.receipt']);
});

// One mutant per code. Each returns the check result; the test asserts the code set is exactly [code].
const MUTANTS = {
  CALL_TYPE: () => { const t = reference(); root(t).ARG = { ...ENTITY_IN, required: ['entity', 'lines'] }; return checkTree(t); },
  'CALL_TYPE (reads)': () => { const t = reference(); root(t).READS = { type: 'object', required: ['totalMinor', 'count'], properties: { totalMinor: { type: 'integer' }, count: { type: 'integer' } } }; return checkTree(t); },
  EFFECT_IN_SOLVER: () => { const t = reference(); root(t).COMBINE = "(kids, parts) => { fetch('https://ledger.invalid/post', { method: 'POST' }); return { entities: [] }; }"; return checkTree(t); },
  'EFFECT_IN_SOLVER (node)': () => { const t = reference(); t.nodes['entity-close'].effects = 'write'; return checkTree(t); },
  BUDGET_TREE: () => { const t = reference(); root(t).CHILD_BUDGET = 0.3; return checkTree(t); },
  'BUDGET_TREE (floor)': () => { const t = reference(); t.nodes['entity-close'].minBudgetUsd = 0.08; return checkTree(t); },
  ONE_WRITER: () => { const t = reference(); t.effectPlan.push({ binding: 'B:ledger-post', target: 'ledger:group-close', writer: 'entity-close' }); return checkTree(t); },
  DEPTH: () => { const t = reference(); root(t).REF = '@node:hop1'; Object.assign(t.nodes, { hop1: hop('hop2', 0.04), hop2: hop('hop3', 0.02), hop3: hop('entity-close', 0.01) }); return checkTree(t); },
  RECURSION: () => { const t = reference(); t.nodes['entity-close'] = { ...hop('close-group', 0.04), samples: t.nodes['entity-close'].samples }; return checkTree(t); },
  MUTABLE_TARGET: () => { const t = reference(); root(t).REF = '(task, x) => x.childHash'; return checkTree(t); },
  PROFILE_UNREACHABLE: () => { const t = reference(); t.nodes['close-group'].samples.push({ prompt: 'Close the month for each entity.', inputs: { entities: [
    { code: 'US01', currency: 'USD', lines: [{ account: '4000', amountMinor: 990000000, fxRate: '1.0841', memo: 'intercompany revaluation, see attached schedule' }, { account: '7900', amountMinor: -15, fxRate: '1.0841', memo: 'rounding' }] } ] } }); return checkTree(t); },
  JUDGE_NO_CHECK: () => single('P16', s => { delete s.SAME.check; }),
  ENUM_NO_NONE: () => single('P16', s => { s.SAME.schema.properties.same.enum = ['same', 'different']; }),
  'ENUM_NO_NONE (enum slot)': () => single('P17', s => { s.REASONS = ['timing', 'fee', 'fx']; }),
  BRANCH_ON_TEXT: () => single('P09', s => { s.AGREE = '(votes) => votes.every(v => v.quote === votes[0].quote)'; }),
  UNBOUNDED: () => single('P20', s => { s.MAX_TRIES = 9; }),
  'UNBOUNDED (loop)': () => single('P12', s => { s.BODY = '(it) => { let n = it.amountMinor; while (n > 100) n = Math.floor(n / 2); return n; }'; }),
  VERIFY_NOT_GATING: () => { const t = reference(); child(t).CONSERVE = '() => true'; return checkTree(t); },
  'VERIFY_NOT_GATING (P20)': () => single('P20', s => { s.VERIFY = '(out, x) => null'; }),
  NO_CONSERVATION: () => { const t = reference(); delete child(t).CONSERVE; return checkTree(t); },
  SILENT_DROP: () => single('P08', s => { s.KEEP = "(inv) => Number.isInteger(inv.amountMinor) && inv.amountMinor > 0 && inv.status === 'approved'"; }),
  MAP_NO_ECHO_CHECK: () => single('P13', s => { const it = s.READ.schema.properties.items.items; it.required = it.required.filter(k => k !== 'id'); delete it.properties.id; }),
  REASONING_ON_EXTRACTION: () => single('P03', s => { s.CONV_JUDGE.schema.properties.reasoning = { type: 'string' }; s.CONV_JUDGE.schema.required.push('reasoning'); }),
  CREDENTIAL_LITERAL: () => single('P07', s => { s.HANDLERS.invoice = "(m) => ({ action: 'pay-later', ref: m.id, apiKey: 'sk-test-FAKEFAKEFAKEFAKE0000' })"; }),
};

for (const [name, run] of Object.entries(MUTANTS)) {
  const code = name.split(' ')[0];
  test(`T3 mutant: ${name} fires exactly ${code}`, () => {
    const r = run();
    assert.deepEqual(codes(r), [code], JSON.stringify(r.findings.map(f => `${f.code} ${f.node}${f.slot ? '.' + f.slot : ''}: ${f.detail}`), null, 1));
  });
}

test('T3: every checker code has a mutant', () => {
  const covered = new Set(Object.keys(MUTANTS).map(n => n.split(' ')[0]));
  assert.deepEqual(CODES.filter(c => !covered.has(c)), []);
});

test('check: fnParts reads arrow and function forms', () => {
  assert.deepEqual(fnParts('(a, b = 2) => a + b'), { params: ['a', 'b'], body: 'a + b' });
  assert.deepEqual(fnParts('x => x.id').params, ['x']);
  assert.deepEqual(fnParts('function (r) { return r; }').params, ['r']);
});
