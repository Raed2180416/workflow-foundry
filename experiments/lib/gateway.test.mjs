import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';
import { startServices, Ledger } from './services.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const { policy } = loadPolicy();
const workflow = {
  schemaVersion: '1.0', id: 'gw-smoke', version: 1, title: 'gateway smoke', goal: 'classify', domain: 'test',
  envelope: { assumptions: [], risks: [], successCriteria: ['labelled'] },
  budget: { maxSteps: 20, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 1 },
  nodes: [{ id: 'label', kind: 'agent', needs: [], description: 'label it', role: 'classify', instructions: 'Label the text.',
    context: { inputs: [{ name: 'text', ref: 'input.text', label: 'trusted', render: 'text' }] },
    returns: { type: 'object', properties: { team: { type: 'string', enum: ['billing', 'other'] } }, required: ['team'], additionalProperties: false },
    model: { class: 'M', maxClass: 'M' }, timeoutMs: 60000 }],
  acceptance: [{ op: 'exists', value: { $ref: 'nodes.label.team' } }],
};

test('a CLI run inside a sandbox pays for model calls through the host gateway, which enforces the cap', async t => {
  const provider = new ScriptedProvider(() => ({ value: { team: 'billing' }, costUsd: 0.4 }));
  const port = new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': provider, 'llama-server': provider } });
  const ledger = new Ledger({ capUsd: 0.5 });
  const svc = await startServices({ modelPort: port, ledger });
  t.after(() => svc.close());
  const dir = mkdtempSync(path.join(tmpdir(), 'gw-'));
  const file = path.join(dir, 'wf.json'); writeFileSync(file, JSON.stringify(workflow));
  const env = { ...process.env, FOUNDRY_MODEL_GATEWAY_URL: svc.url, FOUNDRY_MODEL_GATEWAY_TOKEN: svc.token };
  // The CLI runs as a child process; the gateway is served by this test's event loop.
  const runAsync = ws => new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(root, 'bin/foundry.mjs'), 'run', file, '--input', '{"text":"refund please"}', '--workspace', ws, '--max-cost', '1'], { env });
    let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
    c.on('close', code => resolve({ code, out }));
  });
  const first = await runAsync(path.join(dir, 'ws1'));
  const r1 = JSON.parse(first.out);
  assert.equal(r1.status, 'succeeded'); assert.equal(r1.outputs.label.team, 'billing');
  assert.equal(provider.calls.length, 1); assert.equal(ledger.spentUsd, 0.4);
  const second = await runAsync(path.join(dir, 'ws2'));
  assert.equal(provider.calls.length, 2); // second call allowed (0.4 < 0.5 cap), now over budget
  const third = await runAsync(path.join(dir, 'ws3'));
  assert.equal(provider.calls.length, 2, 'the gateway refuses calls once the session cap is spent');
  assert.match(third.out, /budget|MODEL_BUDGET|failed/i);
});
