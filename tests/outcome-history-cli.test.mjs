import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Foundry } from '../src/foundry.mjs';
import { OutcomeRepairCoordinator } from '../src/outcome-repair.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin/foundry.mjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const task = 'Write record.json containing exactly input.record.';
const input = { record: { label: 'required', active: true } };
function harness(t) {
  const parent = process.env.FOUNDRY_HISTORY_CLI_EVIDENCE ?? tmpdir();
  mkdirSync(parent, { recursive: true });
  const workspace = mkdtempSync(path.join(parent, 'foundry-history-cli-'));
  const transcript = [];
  t.after(() => {
    if (process.env.FOUNDRY_HISTORY_CLI_EVIDENCE) writeFileSync(path.join(workspace, 'CLI-TRANSCRIPT.json'), JSON.stringify({ test: t.name, transcript }, null, 2) + '\n', { flag: 'wx' });
    else rmSync(workspace, { recursive: true, force: true });
  });
  const invoke = (args, { code = 0, preload, target = workspace } = {}) => {
    const command = [...(preload ? ['--import', preload] : []), cli, ...args, '--workspace', target];
    const result = spawnSync(process.execPath, command, { cwd: root, env: { PATH: '/usr/bin:/bin', HOME: workspace, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 15000 });
    transcript.push({ command, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.equal(result.status, code, result.stderr || result.stdout);
    return JSON.parse(code ? result.stderr : result.stdout);
  };
  return { workspace, invoke, database: path.join(workspace, '.foundry/foundry.sqlite') };
}
async function fixture(t, { correct = false, missing = false } = {}) {
  const h = harness(t), f = new Foundry(h.workspace);
  try {
    const workflow = { schemaVersion: '1.0', id: 'history-cli-control', version: 1, title: 'Supplied historical CLI control',
      goal: task, domain: 'software', envelope: { assumptions: ['Local JSON'], risks: ['Wrong content'], successCriteria: [task], unsupported: ['General intent'] },
      inputSchema: { type: 'object', required: ['record'], properties: { record: { type: 'object' } }, additionalProperties: false },
      budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 10000, maxCost: 0 },
      nodes: [
        { id: 'encode', kind: 'task', needs: [], description: 'Encode controlled content.', tool: 'core.json', args: { value: correct ? { $ref: 'input.record' } : { label: 'wrong' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
        { id: 'file', kind: 'task', needs: ['encode'], description: 'Write controlled content.', tool: 'core.artifact', args: { name: 'record.json', content: { $ref: 'nodes.encode.text' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }
      ], acceptance: [{ op: 'exists', value: { $ref: 'nodes.file.sha256' } }] };
    const request = f.store.createRequest({ text: task });
    const observer = new OutcomeRepairCoordinator(f);
    const contract = observer.registerContract({ requestId: request.id, input, artifactName: 'record.json', expected: input.record, evaluatorId: 'supplied-history-cli-fixture' });
    const proposal = f.propose({ requestId: request.id, workflow, rationale: 'Supplied deterministic control.' }); f.apply(proposal.id);
    const run = await f.startRun(f.runtime.create(workflow, input).id);
    h.artifact = path.join(f.store.directory, 'artifacts', run.id, 'record.json');
    if (missing) unlinkSync(h.artifact);
    h.receipt = observer.observe({ requestId: request.id, proposalId: proposal.id, runId: run.id, contractId: contract.id });
    h.request = request; h.proposal = proposal; h.run = run;
  } finally { await f.close(); }
  return h;
}
function guard(h) {
  const file = path.join(h.workspace, 'read-only-guard.mjs');
  writeFileSync(file, `import {registerHooks,syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs';import net from 'node:net';import child from 'node:child_process';
const no=()=>{throw new Error('Read-only history forbids host dispatch and JS writes');};
globalThis.fetch=no;net.Socket.prototype.connect=no;
for(const key of ['writeFileSync','appendFileSync','mkdirSync','unlinkSync','rmSync','chmodSync'])fs[key]=no;
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[key]=no;
syncBuiltinESMExports();
registerHooks({load(url,context,next){if(url===${JSON.stringify(new URL('../src/components.mjs', import.meta.url).href)})return{format:'module',shortCircuit:true,source:'export async function loadComponents(){throw new Error("Components must not be loaded")}'};return next(url,context);}});
`, { flag: 'wx' }); return file;
}

for (const correct of [false, true]) test(`history CLI is read-only with ${correct ? 'satisfied' : 'unsatisfied'} preserved bytes`, async t => {
  const h = await fixture(t, { correct }), preload = guard(h);
  const before = sha(readFileSync(h.database)), bytes = sha(readFileSync(h.artifact));
  const result = h.invoke(['outcome-history', '--receipt', h.receipt.id], { preload });
  assert.equal(result.historicalAssessment.outcome, correct ? 'satisfied' : 'unsatisfied');
  assert.equal(result.currentWorldQualification, false); assert.equal(result.currentEvidenceCheck.status, 'unverified');
  assert.match(result.id, /^outcome-history:[a-f0-9]{64}$/);
  assert.equal(sha(readFileSync(h.database)), before); assert.equal(sha(readFileSync(h.artifact)), bytes);
});
test('changed or deleted live bytes do not become a current evidence check', async t => {
  const h = await fixture(t);
  const expected = h.invoke(['outcome-history', '--receipt', h.receipt.id]);
  writeFileSync(h.artifact, JSON.stringify(input.record));
  assert.deepEqual(h.invoke(['outcome-history', '--receipt', h.receipt.id]), expected);
  unlinkSync(h.artifact);
  assert.deepEqual(h.invoke(['outcome-history', '--receipt', h.receipt.id]), expected);
});
test('recorded producer loss stays unknown in the CLI', async t => {
  const h = await fixture(t, { missing: true });
  const result = h.invoke(['outcome-history', '--receipt', h.receipt.id]);
  assert.equal(result.historicalAssessment.outcome, 'unknown');
  assert.equal(result.historicalAssessment.basis, 'recorded-observer-evidence-only');
});
test('historical report cannot open an outcome repair', async t => {
  const h = await fixture(t), report = h.invoke(['outcome-history', '--receipt', h.receipt.id]);
  const result = h.invoke(['outcome-repair-request', '--receipt', report.id, '--request', h.request.id, '--run', h.run.id, '--expected-hash', h.proposal.workflowHash], { code: 1 });
  assert.equal(result.error.code, 'OUTCOME_ARGUMENT');
});
for (const extra of [['--components', '/not-a-component'], ['--agent', 'opencode-v2-free'], ['--auto-apply'], ['--request', 'other'], ['extra-position']]) {
  test(`history CLI rejects operational arguments ${extra[0]} before opening a workspace`, t => {
    const h = harness(t), target = path.join(h.workspace, 'must-not-exist');
    const result = h.invoke(['outcome-history', '--receipt', 'a'.repeat(64), ...extra], { code: 1, target });
    assert.equal(result.error.code, 'OUTCOME_CLI_ARGUMENT'); assert.equal(existsSync(target), false);
  });
}
test('history CLI cannot create an absent workspace', t => {
  const h = harness(t), target = path.join(h.workspace, 'absent');
  h.invoke(['outcome-history', '--receipt', 'a'.repeat(64)], { code: 1, target });
  assert.equal(existsSync(target), false);
});
test('history CLI never initializes missing outcome tables', t => {
  const h = harness(t); mkdirSync(path.dirname(h.database));
  const db = new DatabaseSync(h.database); db.exec('CREATE TABLE unrelated(value TEXT)'); db.close();
  const before = sha(readFileSync(h.database));
  h.invoke(['outcome-history', '--receipt', 'a'.repeat(64)], { code: 1 });
  assert.equal(sha(readFileSync(h.database)), before);
});
for (const type of ['directory', 'database', 'wal']) test(`history CLI rejects symlinked ${type}`, async t => {
  const h = await fixture(t), alias = path.join(h.workspace, 'alias'); mkdirSync(alias);
  if (type === 'directory') symlinkSync(path.join(h.workspace, '.foundry'), path.join(alias, '.foundry'));
  else {
    mkdirSync(path.join(alias, '.foundry'));
    if (type === 'database') symlinkSync(h.database, path.join(alias, '.foundry/foundry.sqlite'));
    else { writeFileSync(path.join(alias, '.foundry/foundry.sqlite'), readFileSync(h.database)); symlinkSync(h.database, path.join(alias, '.foundry/foundry.sqlite-wal')); }
  }
  const result = h.invoke(['outcome-history', '--receipt', h.receipt.id], { code: 1, target: alias });
  assert.equal(result.error.code, 'STATE_PATH');
});
