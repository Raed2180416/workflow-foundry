// The corpus as an intent prior and as a test source: detectors on hand-made graphs, the prior's arithmetic, and the
// corpus-inversion generator (qualification, ladder, splits, the test-split guard). $0, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, triggerOf, familyOf, FEATURES } from '../features.mjs';
import { corpusPrior, wilson, loadItems } from '../corpus-prior.mjs';
import { invert, manifest, ladder, genericise, qualifies, runnability, split, kindOf } from '../inversion.mjs';

const node = (id, type, category, summary = type, effects = 'none') => ({ id, type, category, effects, summary });
const item = (platform, nodes, edges = [], extra = {}) => ({ id: `${platform}:t`, source: { platform, url: 'https://example.invalid/x' }, title: 't',
  description: { text: 'A pipeline that analyses things for the lab every day.', provenance: 'original' }, graph: { nodes, edges },
  features: { async: [], connectors: [], subworkflows: 0, ...extra }, oracle: { kind: 'none', notes: '' } });

test('detectors: an n8n flow with a schedule, an error trigger feeding Slack, a dedup node and an approval', () => {
  const it = item('n8n', [node('a', 'n8n-nodes-base.scheduleTrigger', 'trigger'), node('b', 'n8n-nodes-base.removeDuplicates', 'transform'),
    node('c', 'n8n-nodes-base.errorTrigger', 'error-handler'), node('d', 'n8n-nodes-base.slack', 'action', 'slack post'),
    node('e', 'n8n-nodes-base.gmail', 'human', 'gmail sendAndWait')], [{ from: 'c', to: 'd', kind: 'control' }]);
  const { has, evidence } = detect(it);
  for (const f of ['recurring-schedule', 'idempotency', 'error-handling', 'failure-notification', 'human-approval']) assert.equal(has[f], true, f);
  assert.equal(has.retries, false);
  assert.match(evidence['failure-notification'], /slack/);
  assert.equal(triggerOf(it), 'schedule');
  assert.equal(familyOf(it), 'automation/schedule');
});

test('detectors: Airflow @once is not recurrence; genomics dedup is not idempotency; Shortcuts alerts are not notifications', () => {
  const af = item('airflow', [node('t', 'schedule:@once', 'trigger', 'DAG trigger (schedule: @once)'), node('x', 'EC2CreateInstanceOperator', 'action', 'EC2CreateInstanceOperator; retries=5')], [], { async: ['schedule'] });
  assert.equal(detect(af).has['recurring-schedule'], false);
  assert.equal(detect(af).has.retries, true);
  assert.notEqual(triggerOf(af), 'schedule');
  const nf = item('nf-core', [node('m', 'PICARD_MARKDUPLICATES', 'action', 'mark duplicates')]);
  assert.equal(detect(nf).has.idempotency, null);
  const sc = item('apple-shortcuts', [node('a', 'is.workflow.actions.alert', 'human', 'alert'), node('b', 'is.workflow.actions.notification', 'action', 'notification')], [{ from: 'a', to: 'b', kind: 'error' }]);
  assert.equal(detect(sc).has['failure-notification'], false);
  assert.equal(detect(sc).has['human-approval'], false);
});

test('Wilson interval: known values and edge cases', () => {
  const [lo, hi] = wilson(10, 100);
  assert.ok(Math.abs(lo - 0.0552) < 1e-3 && Math.abs(hi - 0.1744) < 1e-3);
  assert.deepEqual(wilson(0, 0), [null, null]);
  assert.equal(wilson(0, 20)[0], 0);
});

test('the prior over the real corpus: 1,559 items, every feature counted, cells add up, deterministic audit sample', () => {
  const items = loadItems();
  const p = corpusPrior(items);
  assert.equal(p.items, 1559);
  assert.equal(p.bySlice.reduce((s, c) => s + c.n, 0), 1559);
  assert.equal(p.byProvenance.reduce((s, c) => s + c.n, 0), 1559);
  for (const f of FEATURES) {
    const k = p.bySlice.reduce((s, c) => s + c.features[f].k, 0);
    assert.equal(k, p.overall.features[f].k, f);
    assert.ok(p.audit[f].every(a => a.evidence), f);
  }
  assert.deepEqual(corpusPrior(items).audit, p.audit);
  assert.ok(p.byFamily.every(c => c.n >= 15));
});

test('inversion: qualification, runnability tiers, ladder levels, splits and the test-split guard', () => {
  const items = loadItems();
  const inv = invert(items);
  assert.equal(inv.qualifying, items.filter(qualifies).length);
  assert.equal(inv.qualifying, 213);
  assert.equal(Object.values(inv.byRunnability).reduce((a, b) => a + b, 0), 213);
  assert.ok(inv.rows.every(r => r.split === split(r.id)));
  const dev = inv.rows.filter(r => r.split === 'dev').length / inv.rows.length;
  assert.ok(dev > 0.25 && dev < 0.42, `dev share ${dev}`);
  assert.throws(() => manifest(inv, { split: 'test' }), /prereg/);
  const m = manifest(inv);
  assert.ok(m.rows.filter(r => r.split === 'test').every(r => !r.ladder), 'no test-split request text in the dev manifest');
  assert.ok(m.rows.filter(r => r.split === 'dev').every(r => r.ladder && r.truth));
  for (const r of inv.rows) assert.ok(['offline-light', 'tooling', 'infra', 'unknown'].includes(r.runnability));
  assert.deepEqual(invert(items).rows.map(r => r.requestDigest), inv.rows.map(r => r.requestDigest));
});

test('ladder: specifics stripped, constraints dropped, one line kept; a demo docstring is not a usable request', () => {
  const it = { description: { text: 'Amplicon sequencing analysis workflow using DADA2 and QIIME2 v2.1.0. See https://x.example for more. Requires Docker. Topics: 16s, edna.' }, source: {} };
  const L = ladder(it);
  assert.doesNotMatch(L.P1, /https|v2\.1|Topics|DADA2/);
  assert.doesNotMatch(L.P2, /Requires/);
  assert.match(L.P3, /^Can you set up something for this: Amplicon sequencing analysis workflow/);
  assert.ok(L.P3.split(' ').length <= 8 + 14);
  assert.equal(genericise('Uses `foo_bar` and FooBarOperator from apache/airflow'), 'Uses and a component from a project');
  assert.equal(kindOf({ id: 'airflow:x/tests/system/y', source: { platform: 'airflow', url: 'https://github.com/apache/airflow/tests/system/y.py' } }), 'developer-example');
  assert.equal(runnability({ oracle: { notes: 'Sample ships Go tests using the Temporal testsuite (mocked activities, time skipping).' } }), 'offline-light');
});
