// The n8n importer: declared verdicts (port of the corpus normaliser), compile verdicts with named reasons, and the wrap contract.
// node --test app/test/n8n-import.test.mjs   ($0; the acquired-sample tests skip with a reason when the sample is not on this machine)
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importN8n, normalise, classifyNode, n8nConnector, BLOCKING } from '../importers/n8n.mjs';
import { runSample, DEFAULT_ACQ, MANIFEST } from '../importers/run-n8n-sample.mjs';
import { createDefaultRegistry } from '../../src/capabilities.mjs';
import { Foundry } from '../../src/foundry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// First-party fixtures written for these tests (not corpus items).
const node = (name, type, parameters = {}, extra = {}) => ({ name, type, typeVersion: 1, position: [0, 0], parameters, ...extra });
const main = (...pairs) => Object.fromEntries(pairs.map(([from, ...to]) => [from, { main: [to.map(t => ({ node: t, type: 'main', index: 0 }))] }]));
const simple = { name: 'Fetch and tidy', nodes: [node('Start', 'n8n-nodes-base.manualTrigger'), node('Get page', 'n8n-nodes-base.httpRequest', { url: 'https://example.invalid/data', method: 'GET' }),
  node('Note', 'n8n-nodes-base.stickyNote', { content: 'docs' }), node('Pause', 'n8n-nodes-base.wait', { amount: 1, unit: 'seconds' })], connections: main(['Start', 'Get page'], ['Get page', 'Pause']) };
const agentFlow = { name: 'Agent', nodes: [node('Chat', '@n8n/n8n-nodes-langchain.chatTrigger'), node('Agent', '@n8n/n8n-nodes-langchain.agent', { options: {} }),
  node('Search', 'n8n-nodes-base.httpRequestTool', { url: 'https://example.invalid' }), node('Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi', { model: 'gpt-4o-mini' })],
  connections: { Chat: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] }, Search: { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] }, Model: { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] } } };
const errorFlow = { name: 'Errors', nodes: [node('Start', 'n8n-nodes-base.manualTrigger'), node('Post', 'n8n-nodes-base.slack', { resource: 'message', operation: 'post' }, { onError: 'continueErrorOutput' }),
  node('Code', 'n8n-nodes-base.code', { jsCode: 'return $input.all()' })], connections: { Start: { main: [[{ node: 'Post', type: 'main', index: 0 }]] }, Post: { main: [[], [{ node: 'Code', type: 'main', index: 0 }]] } } };
const cycle = { name: 'Poll', nodes: [node('Start', 'n8n-nodes-base.manualTrigger'), node('Check', 'n8n-nodes-base.httpRequest', { method: 'GET', url: 'https://example.invalid' }), node('Wait', 'n8n-nodes-base.wait', { amount: 1, unit: 'minutes' })],
  connections: main(['Start', 'Check'], ['Check', 'Wait'], ['Wait', 'Check']) };
const callback = { name: 'Callback', nodes: [node('Hook', 'n8n-nodes-base.webhook', { path: 'x', httpMethod: 'POST' }), node('Wait for payment', 'n8n-nodes-base.wait', { resume: 'webhook' }),
  node('Tell', 'n8n-nodes-base.slack', { resource: 'message', operation: 'post', text: '={{ $json.body.note }}' })], connections: main(['Hook', 'Wait for payment'], ['Wait for payment', 'Tell']) };

test('classification is the corpus normaliser\'s (spot checks of its branch order)', () => {
  assert.deepEqual(classifyNode('n8n-nodes-base.slack', { operation: 'sendAndWait' }).slice(0, 3), ['human', 'write', ['wait']]);
  assert.deepEqual(classifyNode('n8n-nodes-base.httpRequest', { method: 'POST' }).slice(0, 2), ['action', 'external']);
  assert.deepEqual(classifyNode('n8n-nodes-base.googleSheets', { operation: 'append' }).slice(0, 2), ['action', 'write']);
  assert.equal(classifyNode('n8n-nodes-base.stickyNote', {}), null);
  assert.equal(n8nConnector('n8n-nodes-base.googleDriveTrigger'), 'google-drive');
  assert.equal(n8nConnector('n8n-nodes-mcp.mcpClientTool'), 'community:mcp');
  assert.equal(normalise(agentFlow).verdict, 'via-extension:webhook-trigger+chat-session+agent-tool-loop');
});

test('a plain flow lowers to valid IR and runs on the real runtime with stub connectors (behaviour vs n8n not shown)', async () => {
  const r = importN8n(simple, { id: 'fetch-and-tidy' });
  assert.equal(r.compileVerdict, 'lowered');
  assert.deepEqual(r.workflow.nodes.map(n => n.kind), ['task', 'wait']);
  assert.equal(r.workflow.oracle.mode, 'none', 'an import has no definition of done until a person writes one');
  assert.deepEqual(r.needsCapabilities.map(c => [c.name, c.effects]), [['n8n.http-request.get', 'none']]);
  const dir = mkdtempSync(path.join(tmpdir(), 'n8n-run-')), registry = createDefaultRegistry();
  registry.register({ name: 'n8n.http-request.get', version: 'stub', implementation: 'test-stub', description: 'stub', inputSchema: {}, outputSchema: {}, effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 60000, cost: 0, cancellation: 'cooperative', execute: async () => ({ ok: true }) });
  const f = new Foundry(dir, { registry });
  try {
    f.save(r.workflow);
    let run = await f.startRun(f.createRun(r.workflow.id, {}).id);
    assert.equal(run.status, 'waiting', 'the imported pause parks the run on a durable timer');
    await new Promise(resolve => setTimeout(resolve, 1100)); await f.tick();
    run = f.store.run(run.id);
    assert.equal(run.status, 'succeeded');
    assert.equal(run.verdict.verdict, 'unverified', 'no oracle: a succeeded import is unverified, never pass');
  } finally { await f.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('what the IR cannot express is refused with named reasons, never flattened', () => {
  const a = importN8n(agentFlow), e = importN8n(errorFlow), c = importN8n(cycle);
  assert.equal(a.compileVerdict, 'unsupported');
  assert.deepEqual(a.reasons.map(x => x.code).sort(), ['agent-tool-loop', 'chat-session']);
  assert.equal(a.workflow, null);
  assert.deepEqual(e.reasons.map(x => x.code).sort(), ['error-branch', 'n8n-code']);
  assert.deepEqual(c.reasons.map(x => x.code), ['unstructured-cycle']);
  for (const r of [a, e, c]) for (const x of r.reasons) assert.ok(BLOCKING[x.code], `${x.code} has a plain explanation`);
});

test('wait-for-callback lowers to a signal wait; trigger payload reads become input refs labelled untrusted', () => {
  const r = importN8n(callback, { id: 'callback' });
  assert.equal(r.compileVerdict, 'lowered', JSON.stringify(r.reasons));
  const wait = r.workflow.nodes.find(n => n.kind === 'wait');
  assert.ok(wait.signal && wait.timeoutMs);
  assert.deepEqual(r.workflow.labels, { input: 'untrusted:n8n-trigger' });
  const tell = r.workflow.nodes.find(n => n.tool?.startsWith('n8n.slack'));
  assert.deepEqual(tell.args.text, { $ref: 'nodes.n_Wait_for_payment.payload.body.note' }, '$json after the wait is the callback payload');
});

test('wrap, don\'t replace: every flow gets a typed, approval-gated tool contract that registers', () => {
  for (const flow of [simple, agentFlow, errorFlow, callback]) {
    const w = importN8n(flow).wrap;
    assert.equal(w.registers, true);
    assert.equal(w.descriptor.requiresApproval, w.descriptor.effects !== 'none');
  }
  assert.equal(importN8n(agentFlow).wrap.via, 'n8n-chat-webhook');
  assert.throws(() => importN8n({ hello: 'world' }), { code: 'N8N_FORMAT' });
});

const acquired = existsSync(DEFAULT_ACQ);
test('acquired open-licence sample: every file verifies, 2 of 10 lower, 8 are refused with reasons, 10 wrap', { skip: acquired ? false : `sample not on this machine (${DEFAULT_ACQ}); fetch it with app/importers/acquire-n8n-sample.mjs` }, () => {
  const rows = runSample();
  assert.equal(rows.length, 10);
  assert.equal(rows.filter(r => r.missing || r.shaMismatch).length, 0);
  assert.equal(rows.filter(r => r.compileVerdict === 'lowered').length, 2);
  assert.equal(rows.filter(r => r.compileVerdict === 'unsupported' && r.reasons.length).length, 8);
  const committed = JSON.parse(readFileSync(path.join(here, '..', '..', 'research/surface-20261021/n8n-import-results.json'), 'utf8'));
  assert.deepEqual(rows.map(r => [r.id, r.compileVerdict, r.loweredHash]), committed.rows.map(r => [r.id, r.compileVerdict, r.loweredHash]), 'committed results reproduce');
});

const python = spawnSync('python3', ['--version']).status === 0;
test('port fidelity: the original Python normaliser gives the same declared verdict and node classes on the sample', { skip: !acquired ? 'sample not on this machine' : !python ? 'python3 not available' : false }, () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const files = manifest.files.map(f => path.join(DEFAULT_ACQ, f.repo, f.path));
  const out = spawnSync('python3', ['-I', path.join(here, '..', 'importers', 'normaliser-parity.py'), ...files], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(out.status, 0, out.stderr);
  const py = JSON.parse(out.stdout);
  for (const file of files) {
    const js = normalise(JSON.parse(readFileSync(file, 'utf8')));
    assert.equal(js.verdict, py[file].verdict, file);
    assert.deepEqual(js.nodes.map(n => [n.name, n.category, n.effects, n.connectors[0] ?? null]), py[file].nodes.map(n => [n.name, n.category, n.effects, n.connector]), file);
  }
});
