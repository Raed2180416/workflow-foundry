// CI-1 review: the oracle false-negative probe, oracle v3, the skipped-read validator rule and the freeze-gate signature, on the
// synthetic fixture item and hand-made workflows ($0; no bed, no corpus: runs on a fresh clone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureOracle } from '../../ci1-w2/test/fixture-item.mjs';
import { probeItem, REWRITES, MUST_FAIL, nameFor } from '../fn-probe.mjs';
import { equivalentV3, canonLowerAddresses } from '../oracle-v3.mjs';
import { equivalentV2 } from '../../ci1-posthoc/oracle-v2.mjs';
import { skipRefFindings, maySkip } from '../skip-ref-rule.mjs';
import { signature, ambiguityFlags } from '../freeze-gates-replay.mjs';

const oracle = await fixtureOracle();

test('probe on the fixture: no oracle fails the unmodified reference; v1 and v2 fail an address written in another case, v3 does not', () => {
  const rows = probeItem(oracle, 'fixture-overdue');
  assert.equal(rows.filter(r => r.rewrite === 'identity').length, 0, 'identity never fails');
  const caseRows = rows.filter(r => r.rewrite === 'address-case-cells');
  assert.ok(caseRows.length, 'the rewrite applies (owner_email cells in the written sheet)');
  for (const v of ['v1', 'v2']) assert.ok(caseRows.filter(r => r.oracle === v).every(r => !r.pass), `${v} fails it`);
  assert.ok(caseRows.filter(r => r.oracle === 'v3').every(r => r.pass), 'v3 passes it');
  for (const r of rows.filter(x => x.oracle === 'v3' && x.rewrite && !['settings-mention'].includes(x.rewrite))) assert.equal(r.pass, true, `${r.rewrite} in ${r.world}: ${r.reasons.join('; ')}`);
});

test('probe teeth: every must-fail mutation that applies is caught by v3 on the fixture', () => {
  const rows = probeItem(oracle, 'fixture-overdue', {}, MUST_FAIL).filter(r => r.oracle === 'v3');
  const kinds = new Set(rows.map(r => r.mutation));
  for (const k of ['drop-message', 'wrong-recipient', 'change-sheet-cell']) assert.ok(kinds.has(k), `${k} applies`);
  assert.deepEqual(rows.filter(r => !r.caught).map(r => `${r.mutation} ${r.world}`), []);
});

test('rewrites and v3 helpers', () => {
  const world = { sheets: { s: { rows: [{ first_name: 'Ana Maria', email: 'ana@x.example' }] } } };
  assert.equal(nameFor(world, 'ana@x.example'), 'Ana');
  assert.equal(nameFor(world, 'nobody@x.example'), null);
  const dmy = REWRITES['dmy-dates']({ mail: [{ to: 'a@x.example', subject: 's', body: 'due 2026-03-05, sent 2026-03-05T08:00:00Z' }], chat: [] });
  assert.equal(dmy.mail[0].body, 'due 05/03/2026, sent 2026-03-05T08:00:00Z', 'dates only, not date-times');
  assert.equal(REWRITES['number-comma']({ mail: [{ to: 'a', subject: '', body: 'on 6 June 2026 we had 3 items' }], chat: [] }).mail[0].body, 'on 6 June 2026, we had 3, items', 'a day before a month name is left alone');
  const c = canonLowerAddresses({ mail: [], chat: [], respond: [{ code: 200, body: { who: ['X@Y.EXAMPLE'], n: 'Not An Address' } }], sheets: { s: [{ e: ' A@B.example ', n: 'Ann' }] } });
  assert.deepEqual(c.respond[0].body, { who: ['x@y.example'], n: 'Not An Address' }); assert.deepEqual(c.sheets.s[0], { e: 'a@b.example', n: 'Ann' });
  const ref = { ok: true, mail: [], chat: [], respond: [], sheets: { log: [{ email: 'noor@x.example', total: 5 }] } }, cand = { ...ref, sheets: { log: [{ email: 'NOOR@X.EXAMPLE', total: 5 }] } };
  const decl = { vocab: new Set(), rowsWithAddresses: [] };
  assert.equal(equivalentV2(ref, cand, decl).pass, false); assert.equal(equivalentV3(ref, cand, decl).pass, true);
  assert.equal(equivalentV3(ref, { ...ref, sheets: { log: [{ email: 'noor@x.example', total: 6 }] } }, decl).pass, false, 'v3 still compares values');
});

const wf = (nodes, acceptance) => ({ nodes, acceptance });
test('skipped-read rule: acceptance reads of a guarded node (or one downstream of it) are flagged unless protected', () => {
  const nodes = [{ id: 'plan', needs: [] }, { id: 'send', needs: ['plan'], when: { op: 'gt', left: { $ref: 'nodes.plan.count' }, right: 0 } }, { id: 'audit', needs: ['send'] }];
  assert.deepEqual([...maySkip(nodes)].sort(), ['audit', 'send']);
  assert.deepEqual([...maySkip([...nodes.slice(0, 2), { id: 'audit', needs: ['send'], join: 'all_resolved' }])].sort(), ['send'], 'a non-default join stops skip propagation');
  assert.equal(skipRefFindings(wf(nodes, [{ op: 'eq', left: { $ref: 'nodes.audit.pass' }, right: true }])).length, 1, 'downstream of a when');
  assert.equal(skipRefFindings(wf(nodes, [{ op: 'eq', left: { $ref: 'nodes.send.delivered', default: true }, right: true }])).length, 0, 'default protects');
  assert.equal(skipRefFindings(wf(nodes, [{ op: 'exists', value: { $ref: 'nodes.send.delivered' } }])).length, 0, 'exists protects');
  const guarded = [{ op: 'any', conditions: [{ op: 'eq', left: { $ref: 'nodes.plan.count' }, right: 0 }, { op: 'eq', left: { $ref: 'nodes.send.delivered' }, right: true }] }];
  assert.equal(skipRefFindings(wf(nodes, guarded)).length, 0, 'short-circuit guard (heuristic)');
  assert.equal(skipRefFindings(wf(nodes, guarded), { guards: false }).length, 1, 'strict variant ignores the guard');
  assert.equal(skipRefFindings(wf(nodes, [{ op: 'eq', left: { $ref: 'nodes.plan.count' }, right: 1 }])).length, 0, 'never-skipped node');
  const map = [{ id: 'm', kind: 'map', needs: [], body: { nodes: [{ id: 'x', needs: [], when: { op: 'eq', left: 1, right: 1 } }], acceptance: [{ op: 'eq', left: { $ref: 'nodes.x.ok' }, right: true }] } }];
  assert.deepEqual(skipRefFindings(wf(map, [])).map(f => f.frame), ['top/m'], 'map bodies are checked');
});

test('freeze-gate signature: values are dropped, recipients and columns kept; two identical failures flag an item', () => {
  assert.equal(signature('chat to #deadlines: 1 sent, expected 2'), 'chat to #deadlines: N sent, expected N');
  assert.equal(signature('sheet log: no row matches reference row {"a":1,"b":"x"} (first differing columns: b)'), 'sheet log: no row matches reference row (b)');
  const rec = (item, k, pass, reason) => ({ item, k, pass, firstFailure: pass ? null : { world: 'c01', reasons: [reason] } });
  const flags = ambiguityFlags({ records: [rec('1', 0, false, 'chat to #a: 1 sent, expected 2'), rec('1', 1, false, 'chat to #a: 3 sent, expected 2'), rec('2', 0, false, 'x'), rec('2', 1, true), rec('3', 0, false, 'y 1'), rec('3', 1, false, 'z 1'), rec('1', 2, true)] });
  assert.deepEqual(flags.map(f => f.item), ['1']);
});

test('failure classifier: known classes by rule, anything else is listed for reading', async () => {
  const { classify } = await import('../classify-r.mjs');
  assert.match(classify('the built workflow did not finish: failed: MISSING_REFERENCE Missing value at nodes.x.sent', { item: '1' }), /skipped branch/);
  assert.match(classify('response 1: body.missing has 1 entries, expected 2', { item: '18281' }), /18281/);
  assert.match(classify('', { item: '1', outcome: 'build_failed' }), /no valid workflow/);
  assert.match(classify('chat to #a: 1 sent, expected 2', { item: '1' }), /^read: count/);
  assert.equal(classify('something new', { item: '1' }), 'read: other');
});

test('model-checked skipped-read rule: catches an exclusive-branch disjunction, accepts a real guard and a count guard', async () => {
  const { modelFrame, modelFindings } = await import('../skip-ref-rule.mjs');
  const kindIs = v => ({ op: 'eq', left: { $ref: 'nodes.prep.kind' }, right: v });
  const nodes = [{ id: 'prep', needs: [] }, { id: 'urgent', needs: ['prep'], when: kindIs('urgent') }, { id: 'warning', needs: ['prep'], when: kindIs('warning') }];
  // 15238's bug: with kind "warning" the first two disjuncts are false and the skipped urgent node is read before the warning one
  const bad = [{ op: 'any', conditions: [kindIs('none'), { op: 'eq', left: { $ref: 'nodes.urgent.posted' }, right: true }, { op: 'eq', left: { $ref: 'nodes.warning.posted' }, right: true }] }];
  assert.ok(modelFrame(nodes, bad).length > 0);
  const good = [{ op: 'any', conditions: [{ op: 'ne', left: { $ref: 'nodes.prep.kind' }, right: 'urgent' }, { op: 'eq', left: { $ref: 'nodes.urgent.posted' }, right: true }] }];
  assert.deepEqual(modelFrame(nodes, good), [], 'a guard that is the negation of the when');
  const count = [{ id: 'plan', needs: [] }, { id: 'send', needs: ['plan'], when: { op: 'gt', left: { $ref: 'nodes.plan.count' }, right: 0 } }];
  assert.deepEqual(modelFrame(count, [{ op: 'any', conditions: [{ op: 'eq', left: { $ref: 'nodes.plan.count' }, right: 0 }, { op: 'eq', left: { $ref: 'nodes.send.delivered' }, right: true }] }]), [], 'a count is not negative');
  assert.ok(modelFrame(count, [{ op: 'eq', left: { $ref: 'nodes.send.delivered' }, right: true }]).length > 0, 'an unguarded read');
  assert.deepEqual(modelFrame(count, [{ op: 'eq', left: { $ref: 'nodes.send.delivered', default: true }, right: true }]), [], 'default');
  assert.equal(modelFindings({ nodes: count, acceptance: [{ op: 'eq', left: { $ref: 'nodes.send.delivered' }, right: true }] }).length, 1);
});
