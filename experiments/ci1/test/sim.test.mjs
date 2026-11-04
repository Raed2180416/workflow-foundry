// n8n-sim on FIRST-PARTY fixtures (written for these tests; not corpus items). Each test pins one node semantics the bed relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInProcess, runSandboxed, bundle } from '../sim/run.mjs';
import { sandboxStatus } from '../../../src/sandbox.mjs';

const N = (name, type, parameters = {}, extra = {}) => ({ name, type: `n8n-nodes-base.${type}`, typeVersion: extra.v ?? 1, position: extra.pos ?? [0, 0], parameters, ...extra });
const C = (...edges) => { const c = {}; for (const [from, to, out = 0, inp = 0] of edges) { c[from] ??= { main: [] }; while (c[from].main.length <= out) c[from].main.push([]); c[from].main[out].push({ node: to, type: 'main', index: inp }); } return c; };
const cond = (left, op, right, type = 'number') => ({ id: 'c', leftValue: left, rightValue: right, operator: { type, operation: op } });
const world = (extra = {}) => ({ id: 'w1', now: '2026-03-15T10:00:00Z', event: null, sheets: {}, ...extra });

test('webhook -> set -> if v2 -> gmail / slack; expressions, paired items and strict types', async () => {
  const wf = { nodes: [
    N('Hook', 'webhook', { path: 'x', httpMethod: 'POST' }, { v: 2 }),
    N('Shape', 'set', { assignments: { assignments: [{ id: 'a', name: 'amount', value: '={{ $json.body.amount }}', type: 'number' }, { id: 'b', name: 'who', value: '={{ $json.body.name.toTitleCase() }}', type: 'string' }] }, options: {} }, { v: 3.4 }),
    N('Big?', 'if', { conditions: { options: { caseSensitive: true, typeValidation: 'strict' }, conditions: [cond('={{ $json.amount }}', 'gt', 100)], combinator: 'and' } }, { v: 2.2 }),
    N('Mail', 'gmail', { sendTo: 'boss@acme.example', subject: '=Big order from {{ $json.who }}', message: '=<p>{{ $json.who }} ordered {{ $json.amount }} (email {{ $(\'Hook\').item.json.body.email }})</p>', options: {} }, { v: 2.1, pos: [0, 0] }),
    N('Post', 'slack', { select: 'channel', channelId: { __rl: true, value: 'C1', mode: 'list', cachedResultName: 'small-orders' }, text: '=small: {{ $json.who }}' }, { v: 2.2, pos: [0, 200] }),
  ], connections: C(['Hook', 'Shape'], ['Shape', 'Big?'], ['Big?', 'Mail', 0], ['Big?', 'Post', 1]) };
  const big = await runInProcess(wf, world({ event: { body: { amount: '250', name: 'ada lovelace', email: 'ada@x.example' } } }));
  assert.equal(big.ok, true, JSON.stringify(big.error));
  assert.deepEqual(big.effects.map(e => e.kind), ['mail']);
  assert.deepEqual(big.effects[0].to, ['boss@acme.example']);
  assert.equal(big.effects[0].subject, 'Big order from Ada Lovelace');
  assert.equal(big.effects[0].body, 'Ada Lovelace ordered 250 (email ada@x.example)');
  const small = await runInProcess(wf, world({ event: { body: { amount: 40, name: 'bo', email: 'b@x.example' } } }));
  assert.deepEqual(small.effects.map(e => [e.kind, e.channel, e.text]), [['chat', '#small-orders', 'small: Bo']]);
  // strict type validation: a string where the If expects a number stops the workflow (the Set node converts, so bypass it)
  const raw = { ...wf, connections: C(['Hook', 'Big?'], ['Big?', 'Mail', 0], ['Big?', 'Post', 1]) };
  raw.nodes = raw.nodes.map(n => n.name === 'Big?' ? { ...n, parameters: { conditions: { ...n.parameters.conditions, conditions: [cond('={{ $json.body.amount }}', 'gt', 100)] } } } : n);
  const bad = await runInProcess(raw, world({ event: { body: { amount: '250' } } }));
  assert.equal(bad.ok, false); assert.match(bad.error.message, /Wrong type/);
});

test('sheets: read with filter, code over all items, append and update by key and by row_number; frozen clock', async () => {
  const wf = { nodes: [
    N('Every day', 'scheduleTrigger', {}, { v: 1.2 }),
    N('Read', 'googleSheets', { documentId: { __rl: true, value: 'D', mode: 'list' }, sheetName: { __rl: true, value: 'gid=0', mode: 'list' }, filtersUI: { values: [{ lookupColumn: 'status', lookupValue: 'open' }] }, options: {} }, { v: 4.5 }),
    N('Age', 'code', { jsCode: `const out = [];\nfor (const it of $input.all()) { const days = Math.floor((Date.now() - new Date(it.json.due).getTime()) / 864e5); out.push({ json: { ...it.json, days, stamp: $now.toFormat('yyyy-MM-dd') } }); }\nreturn out;` }, { v: 2 }),
    N('Late', 'filter', { conditions: { options: { typeValidation: 'strict' }, conditions: [cond('={{ $json.days }}', 'gte', 7)], combinator: 'and' } }, { v: 2.2 }),
    N('Mark', 'googleSheets', { operation: 'update', documentId: { __rl: true, value: 'D', mode: 'list' }, sheetName: { __rl: true, value: 'gid=0', mode: 'list' }, columns: { mappingMode: 'defineBelow', value: { row_number: '={{ $json.row_number }}', status: 'late', checked: '={{ $json.stamp }}' }, matchingColumns: ['row_number'] }, options: {} }, { v: 4.5, pos: [0, 0] }),
    N('Log', 'googleSheets', { operation: 'append', documentId: { __rl: true, value: 'D', mode: 'list' }, sheetName: { __rl: true, value: 'gid=1', mode: 'list' }, columns: { mappingMode: 'defineBelow', value: { invoice: '={{ $json.invoice }}', days: '={{ $json.days }}' } }, options: {} }, { v: 4.5, pos: [0, 100] }),
  ], connections: C(['Every day', 'Read'], ['Read', 'Age'], ['Age', 'Late'], ['Late', 'Mark'], ['Late', 'Log']) };
  const binding = { sheetKeys: { 'D|gid=0': 'invoices', 'D|gid=1': 'late-log' } };
  const w = world({ sheets: { invoices: { columns: ['invoice', 'due', 'status', 'checked'], rows: [
    { invoice: 'A', due: '2026-03-01', status: 'open', checked: '' }, { invoice: 'B', due: '2026-03-12', status: 'open', checked: '' }, { invoice: 'C', due: '2026-01-01', status: 'paid', checked: '' }, { invoice: 'D', due: '2026-03-08', status: 'open', checked: '' }] },
  'late-log': { columns: ['invoice', 'days'], rows: [] } } });
  const r = await runInProcess(wf, w, binding);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.sheets.invoices.rows.map(x => [x.invoice, x.status, x.checked]), [['A', 'late', '2026-03-15'], ['B', 'open', ''], ['C', 'paid', ''], ['D', 'late', '2026-03-15']]);
  assert.deepEqual(r.sheets['late-log'].rows, [{ invoice: 'A', days: 14 }, { invoice: 'D', days: 7 }]);
  // v1 order: Mark (higher on the canvas) finishes before Log starts
  assert.deepEqual(r.trace.map(t => t.node), ['Every day', 'Read', 'Age', 'Late', 'Mark', 'Log']);
  const again = await runInProcess(wf, w, binding);
  assert.deepEqual(again, r, 'a rerun is identical (frozen clock, seeded random)');
});

test('merge by key, split out, summarize, switch fallback and respond to webhook', async () => {
  const wf = { nodes: [
    N('Hook', 'webhook', {}, { v: 2 }),
    N('Lines', 'splitOut', { fieldToSplitOut: 'body.lines', options: {} }, { v: 1 }),
    N('Prices', 'googleSheets', { documentId: { __rl: true, value: 'D' }, sheetName: { __rl: true, value: 'P' }, options: {} }, { v: 4.5, executeOnce: true }),
    N('Join', 'merge', { mode: 'combine', fieldsToMatchString: 'sku', options: {} }, { v: 3.2 }),
    N('Cost', 'set', { assignments: { assignments: [{ id: 'x', name: 'cost', value: '={{ $json.qty * $json.price }}', type: 'number' }] }, includeOtherFields: true, options: {} }, { v: 3.4 }),
    N('Total', 'summarize', { fieldsToSummarize: { values: [{ aggregation: 'sum', field: 'cost' }, { aggregation: 'count', field: 'sku' }] }, options: {} }, { v: 1.1 }),
    N('Tier', 'switch', { rules: { values: [{ conditions: { options: { typeValidation: 'strict' }, conditions: [cond('={{ $json.sum_cost }}', 'gte', 100)], combinator: 'and' }, renameOutput: true, outputKey: 'big' }] }, options: { fallbackOutput: 'extra' } }, { v: 3.2 }),
    N('Big', 'respondToWebhook', { respondWith: 'json', responseBody: '={{ { "tier": "big", "total": $json.sum_cost, "lines": $json.count_sku } }}', options: {} }, { v: 1.1 }),
    N('Small', 'respondToWebhook', { respondWith: 'text', responseBody: '=small {{ $json.sum_cost }}', options: { responseCode: 202 } }, { v: 1.1 }),
  ], connections: C(['Hook', 'Lines'], ['Hook', 'Prices'], ['Lines', 'Join', 0, 0], ['Prices', 'Join', 0, 1], ['Join', 'Cost'], ['Cost', 'Total'], ['Total', 'Tier'], ['Tier', 'Big', 0], ['Tier', 'Small', 1]) };
  const binding = { sheetKeys: { 'D|P': 'prices' } };
  const sheets = { prices: { columns: ['sku', 'price'], rows: [{ sku: 'a', price: 10 }, { sku: 'b', price: 25 }] } };
  const r = await runInProcess(wf, world({ event: { body: { lines: [{ sku: 'a', qty: 3 }, { sku: 'b', qty: 4 }] } }, sheets }), binding);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.effects.filter(e => e.kind === 'respond').map(e => [e.code, e.body]), [[200, { tier: 'big', total: 130, lines: 2 }]]);
  const s = await runInProcess(wf, world({ event: { body: { lines: [{ sku: 'a', qty: 1 }] } }, sheets }), binding);
  assert.deepEqual(s.effects.filter(e => e.kind === 'respond').map(e => [e.code, e.body]), [[202, 'small 10']]);
});

test('loop over items (splitInBatches v3) sends one message per batch and then continues on done', async () => {
  const wf = { nodes: [
    N('Go', 'manualTrigger'),
    N('Make', 'code', { jsCode: 'return [1,2,3].map(n => ({ json: { n, chat: 77 } }));' }, { v: 2 }),
    N('Loop', 'splitInBatches', { options: {} }, { v: 3 }),
    N('Say', 'telegram', { chatId: '={{ $json.chat }}', text: '=item {{ $json.n }}', additionalFields: {} }, { v: 1.2 }),
    N('Done', 'emailSend', { fromEmail: 'bot@x.example', toEmail: 'me@x.example, you@x.example', subject: 'done', emailFormat: 'text', text: '={{ $("Loop").all().length }} sent' }, { v: 2.1, executeOnce: true }),
  ], connections: C(['Go', 'Make'], ['Make', 'Loop'], ['Loop', 'Done', 0], ['Loop', 'Say', 1], ['Say', 'Loop']) };
  const r = await runInProcess(wf, world());
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.effects.map(e => e.kind === 'chat' ? `${e.channel} ${e.text}` : `${e.to.join(',')} ${e.body}`), ['#77 item 1', '#77 item 2', '#77 item 3', 'me@x.example,you@x.example 3 sent']);
  // without executeOnce an e-mail node sends once PER ITEM (n8n semantics): the done branch carries 3 items
  const each = { ...wf, nodes: wf.nodes.map(n => n.name === 'Done' ? { ...n, executeOnce: false } : n) };
  assert.equal((await runInProcess(each, world())).effects.filter(e => e.kind === 'mail').length, 3);
});

test('corpus-style runs happen in the sandbox and match the in-process result', { skip: false }, async t => {
  const status = await sandboxStatus().catch(e => ({ available: false, reason: e.message }));
  if (status?.available === false) { t.skip(`sandbox unavailable: ${status.reason}`); return; }
  const wf = { nodes: [N('Go', 'manualTrigger'), N('Code', 'code', { jsCode: 'return [{ json: { t: $now.toISO(), r: Math.random(), probe: typeof process } }];' }, { v: 2 }),
    N('Post', 'slack', { channelId: { __rl: true, value: 'C9', cachedResultName: 'ops' }, text: '={{ $json.t }} {{ $json.probe }}' }, { v: 2.2 })], connections: C(['Go', 'Code'], ['Code', 'Post']) };
  const [boxed] = await runSandboxed({ workflows: [wf], worlds: [world()] });
  const local = await runInProcess(wf, world());
  assert.equal(boxed.ok, true, JSON.stringify(boxed.error));
  assert.deepEqual(boxed.effects, local.effects);
  assert.equal(boxed.effects[0].text, '2026-03-15T10:00:00.000Z undefined', 'frozen clock; no process object in the Code realm');
  assert.ok(bundle().bytes < 256 * 1024, 'the bundle fits the sandbox source limit');
});

test('an HTML e-mail reads as text with its link targets kept (a link the request asks for is content); images and styles dropped', async () => {
  const wf = { nodes: [
    N('Go', 'manualTrigger'),
    N('Mail', 'gmail', { sendTo: 'a@x.example', subject: 'News', message: '<style>p{color:red}</style><p>Lamp</p><img src="https://cdn.x.example/i.jpg"><a href="https://shop.x.example/p/42" style="x">Learn more</a>', options: {} }, { v: 2.1 }),
  ], connections: C(['Go', 'Mail']) };
  const r = await runInProcess(wf, world());
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.effects[0].body, 'Lamp\nLearn more (https://shop.x.example/p/42)');
});
