// The CI-1 oracle on FIRST-PARTY fixtures: an n8n graph (run by n8n-sim) and a hand-written Foundry workflow (run by the engine)
// must agree in the same world; each kind of wrong built workflow must be refused, for the stated reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInProcess } from '../sim/run.mjs';
import { runBuilt } from '../foundry-world.mjs';
import { canonFromSim, canonFromFoundry, equivalent, staticVocabulary, rowIdentities, tokens, factsOf, normCell } from '../canon.mjs';

const N = (name, type, parameters = {}, extra = {}) => ({ name, type: `n8n-nodes-base.${type}`, typeVersion: extra.v ?? 1, position: extra.pos ?? [0, 0], parameters, ...extra });
const C = (...edges) => { const c = {}; for (const [from, to, out = 0] of edges) { c[from] ??= { main: [] }; while (c[from].main.length <= out) c[from].main.push([]); c[from].main[out].push({ node: to, type: 'main', index: 0 }); } return c; };
// Reference: every morning, e-mail the owner the open tickets older than 2 days, and mark them "escalated" in the sheet.
const ref = { nodes: [
  N('Morning', 'scheduleTrigger', {}, { v: 1.2 }),
  N('Tickets', 'googleSheets', { documentId: { __rl: true, value: 'D' }, sheetName: { __rl: true, value: 'T' }, options: {} }, { v: 4.5 }),
  N('Stale', 'code', { jsCode: 'return $input.all().filter(i => i.json.status === "open" && (Date.now() - Date.parse(i.json.opened)) / 864e5 > 2);' }, { v: 2 }),
  N('Escalate', 'googleSheets', { operation: 'update', documentId: { __rl: true, value: 'D' }, sheetName: { __rl: true, value: 'T' }, columns: { mappingMode: 'defineBelow', value: { id: '={{ $json.id }}', status: 'escalated' }, matchingColumns: ['id'] }, options: {} }, { v: 4.5, pos: [0, 0] }),
  N('Digest', 'code', { jsCode: 'const lines = $input.all().map(i => `- ${i.json.id} ${i.json.customer} (opened ${i.json.opened})`);\nreturn [{ json: { text: lines.join("\\n"), n: lines.length } }];' }, { v: 2, pos: [0, 200] }),
  N('Mail', 'gmail', { sendTo: 'owner@shop.example', subject: '={{ $json.n }} stale tickets', message: '=Stale tickets:\n{{ $json.text }}', emailType: 'text', options: {} }, { v: 2.1, pos: [0, 200] }),
], connections: C(['Morning', 'Tickets'], ['Tickets', 'Stale'], ['Stale', 'Escalate'], ['Stale', 'Digest'], ['Digest', 'Mail']) };
const binding = { sheetKeys: { 'D|T': 'tickets' } };
const world = { id: 'w1', now: '2026-03-15T10:00:00Z', event: null, sheets: { tickets: { columns: ['id', 'customer', 'opened', 'status'], rows: [
  { id: 'T-1', customer: 'Brightwater', opened: '2026-03-10', status: 'open' }, { id: 'T-2', customer: 'Kestrel', opened: '2026-03-14', status: 'open' },
  { id: 'T-3', customer: 'Lumen', opened: '2026-03-01', status: 'closed' }, { id: 'T-4', customer: 'Quarry', opened: '2026-03-11', status: 'open' }] } } };
const IN = { type: 'object', additionalProperties: false, required: ['now'], properties: { now: { type: 'string' } } };
const built = (code, extraNodes = [], mailTo = 'owner@shop.example') => ({ schemaVersion: '1.0', id: 'built', version: 1, title: 't', goal: 'g', domain: 'general',
  envelope: { assumptions: [], risks: [], successCriteria: ['s'] }, inputSchema: IN, budget: { maxSteps: 60, maxConcurrency: 2, maxDurationMs: 300000, maxCost: 0 },
  nodes: [
    { id: 'read', kind: 'task', needs: [], description: 'read', tool: 'sheet.read', args: { sheet: 'tickets' }, timeoutMs: 10000, retry: { maxAttempts: 2 } },
    { id: 'pick', kind: 'code', needs: ['read'], description: 'pick', lang: 'js', source: code, args: { rows: { $ref: 'nodes.read.rows' }, now: { $ref: 'input.now' } }, timeoutMs: 10000 },
    { id: 'mark', kind: 'task', needs: ['pick'], description: 'mark', tool: 'sheet.update', args: { sheet: 'tickets', key: 'id', rows: { $ref: 'nodes.pick.updates' } }, timeoutMs: 10000, retry: { maxAttempts: 2 } },
    { id: 'send', kind: 'task', needs: ['pick'], description: 'send', tool: 'outbox.send', args: { to: mailTo, subject: { $ref: 'nodes.pick.subject' }, body: { $ref: 'nodes.pick.body' } }, timeoutMs: 10000, retry: { maxAttempts: 1 } },
    ...extraNodes],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.send.delivered' }, right: true }] });
const GOOD = `export default function main({ rows, now }) {
  const stale = rows.filter(r => r.status === 'open' && (Date.parse(now) - Date.parse(r.opened)) / 864e5 > 2);
  return { updates: stale.map(r => ({ id: r.id, status: 'escalated' })), subject: 'Stale support tickets: ' + stale.length,
    body: 'These tickets need attention:\\n' + stale.map(r => r.customer + ' - ' + r.id + ', opened ' + r.opened).join('\\n') };
}`;

async function judge(wf, w = world) {
  const r = await runInProcess(ref, w, binding);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const vocab = staticVocabulary(ref);
  const decl = { vocab: [...vocab], rows: rowIdentities(w, vocab) };
  const c = canonFromFoundry(await runBuilt(wf, w), { sheets: ['tickets'] });
  return { ...equivalent(canonFromSim(r, { sheets: ['tickets'] }), c, decl), ref: r };
}

test('facts are the world values in a message, not the wording; dates and numbers are normalised', () => {
  const vocab = staticVocabulary(ref);
  assert.ok(vocab.has('stale') && vocab.has('tickets') && vocab.has('opened'), 'words written in the definition are static');
  assert.deepEqual(factsOf('2 stale tickets\nStale tickets:\n- T-1 Brightwater (opened 2026-03-10)', vocab).sort(), ['2', 't-1', 'D:2026-03-10', 'brightwater'].sort(), 'a count computed at run time is a fact even though 2 is a constant of the logic');
  assert.ok(!vocab.has('2') && vocab.has('stale'), 'numbers in code logic are not wording; words are');
  assert.deepEqual(tokens('INV-1002 and SKU_42a cost -3'), ['inv-1002', 'sku_42a', '-3', 'and', 'cost']);
  assert.deepEqual(tokens('Due March 10, 2026: $1,200.50'), ['D:2026-03-10', '1200.5', 'due']);
  assert.equal(normCell('2026-03-15T10:00:30.000Z'), normCell('2026-03-15T10:00:00Z'));
  assert.equal(normCell(' 42.0 '), normCell(42));
});

test('a differently worded but equivalent Foundry workflow passes in the same world', async () => {
  const j = await judge(built(GOOD));
  assert.deepEqual(j.reasons, []);
  assert.equal(j.pass, true);
});

test('wrong built workflows fail, each for its reason', async t => {
  const cases = [
    ['off-by-one threshold (>= 1 day instead of > 2)', built(GOOD.replace('> 2', '>= 1')), /rows|facts|row/],
    ['wrong recipient', built(GOOD, [], 'boss@shop.example'), /e-mail to (owner|boss)@shop\.example: (0|1) sent/],
    ['drops a fact (no customer name)', built(GOOD.replace("r.customer + ' - ' + ", '')), /facts \[brightwater|facts \[quarry/],
    ['dumps every ticket (leak)', built(GOOD.replace("body: 'These tickets need attention:\\n' + stale.map", "body: 'These tickets need attention:\\n' + rows.map")), /row\(s\) the reference leaves out/],
    ['does not update the sheet', { ...built(GOOD), nodes: built(GOOD).nodes.filter(n => n.id !== 'mark') }, /sheet tickets: no row matches/],
    ['writes an extra column', built(GOOD.replace("status: 'escalated' }", "status: 'escalated', note: 'auto' }")), /columns the reference never fills \[note\]/],
    ['sends an extra message', built(GOOD, [{ id: 'cc', kind: 'task', needs: ['pick'], description: 'cc', tool: 'outbox.send', args: { to: 'owner@shop.example', subject: 'copy', body: 'copy' }, timeoutMs: 10000, retry: { maxAttempts: 1 } }]), /2 sent, expected 1/],
  ];
  for (const [label, wf, why] of cases) {
    const j = await judge(wf);
    assert.equal(j.pass, false, `${label} must fail`);
    assert.match(j.reasons.join(' | '), why, label);
  }
  void t;
});

test('an empty world: the reference sends "0 stale tickets"; a built flow that sends nothing fails', async () => {
  const empty = { ...world, id: 'w0', sheets: { tickets: { columns: world.sheets.tickets.columns, rows: [] } } };
  const r = await runInProcess(ref, empty, binding);
  assert.equal(canonFromSim(r).mail.length, 0, 'n8n: a Code node returning no items stops the branch, so nothing is sent');
  const j = await judge(built(GOOD), empty);
  assert.equal(j.pass, false, 'the built flow sends an empty digest where the reference sends none');
  assert.match(j.reasons.join(' '), /1 sent, expected 0/);
});
