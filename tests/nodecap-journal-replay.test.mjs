// Nodecap P7: journaling and replay of acquisitions (ARCHITECTURE.md §2.9, I10). A scripted run, then the same version replayed with
// modelMode "replay" on a FRESH world (new fixture server processes, new server ledgers) and a provider that fails if called: the same
// decisions, outcome and server ledger at $0 model cost. The independent verifier recomputes every member decision; tampering is caught.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { verifyRun } from '../src/verify-run.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { checkCatalog, catalogDigest } from '../src/capabilities/catalog.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope } from '../src/capabilities/envelope.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { NodecapHost } from '../src/capabilities/host.mjs';
import { loadTypes } from '../src/capabilities/types.mjs';
import { construct, launch, subjectOf, executeRun, runtimeFor } from '../src/capabilities/launcher.mjs';
import { nodecapDecisions } from '../src/capabilities/journal.mjs';
import { verifyAcquisitions } from '../experiments/nodecap/verify-acquisitions.mjs';
import { FIXTURES, catalogOf, crmEntry, sheetsEntry, skillEntry, ledgerLines, workspace, openLedger, approveVersion, approveCall } from './support/nodecap.mjs';

const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const SCRIPT = [step({ action: 'find', need: { verb: 'search', object: 'contact', system: 'crm', kind: 'tool', why: 'who owns the account' } }),
  step({ action: 'read', tool: 'crm_search_contacts', args: { query: 'Analytical' } }),
  step({ action: 'read', tool: 'skill_refund_policy', args: {} }),
  step({ action: 'read', tool: 'sheets_append_row', args: { cells: ['wrong path'] } }),
  step({ action: 'act', tool: 'sheets_append_row', args: { cells: ['42', 'ada@analytical.example'] } }),
  step({ action: 'done', answer: { email: 'ada@analytical.example' } })];
const workflow = { schemaVersion: '1.0', id: 'NodecapReplay', version: 1, title: 'Replay probe', goal: 'Record the account owner in the sheet', domain: 'diagnostic',
  envelope: { assumptions: ['fixture world'], risks: [], successCriteria: ['row appended once'] }, budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 },
  nodes: [{ id: 'work', kind: 'agent', needs: [], description: 'Tool node', role: 'plan', instructions: 'Find the owner email and append it to the sheet with ticket 42.',
    returns: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', maxLength: 200 } } }, model: { class: 'M' } }],
  acceptance: [{ op: 'exists', value: { $ref: 'nodes.work.email' } }] };
const sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { acquire: { systems: ['crm', 'sheets', 'policy'], objects: ['contact', 'row', 'refund'], effectsMax: 'non-idempotent', max: 5 }, maxTurns: 8 } } };
// A world's ledgers live in a directory named by the host env, so the servers' command lines (and so their pins) are the same in every
// world: the approved lock must match the fresh world's servers, or the replay would rightly be refused (DEFINITION_CHANGED).
const world = () => checkCatalog(catalogOf(crmEntry({ ledgerName: 'crm' }), sheetsEntry({ ledgerName: 'sheets' }), skillEntry('refund-policy')));
const envOf = dir => ({ ...process.env, NODECAP_LEDGER_DIR: dir });
async function approveAndFinish(runtime, host, run, ledger, lock) {
  while (run.status === 'awaiting_approval') {
    for (const id of Object.keys(run.approvals).filter(id => run.approvals[id].status === 'pending')) await approveCall({ runtime, ledger, host, lock, run, approvalId: id });
    run = await executeRun({ runtime, host, runId: run.id });
  }
  return run;
}
// Approval ids bind the run (its idempotency key), so only their presence is compared.
const comparable = decisions => decisions.map(({ kind, action, features }) => ({ kind, action, features: { ...features, approvalId: features.approvalId ? 'present' : null } }));

test('replay: a fresh world replays the run at $0 with the same decisions, outcome and ledger; the verifier recomputes every decision', async t => {
  const dir = workspace(t), store = new Store(dir), ledger = openLedger(dir);
  const firstWorld = path.join(dir, 'w1'), secondWorld = path.join(dir, 'w2');
  const { mkdirSync } = await import('node:fs'); mkdirSync(firstWorld); mkdirSync(secondWorld);
  const catalog = world(), host = new NodecapHost({ catalog, ledger, envelope, env: envOf(firstWorld) });
  const provider = new ScriptedProvider({ [M]: SCRIPT });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const construction = await construct({ workflow, sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  approveVersion(ledger, construction);
  const { runtime, execute } = await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  const first = await approveAndFinish(runtime, host, await execute(), ledger, construction.lock);
  assert.equal(first.status, 'succeeded', JSON.stringify(first.error));
  assert.equal(provider.calls.length, 6);
  const report = verifyAcquisitions({ store, runId: first.id, lock: construction.lock, envelope });
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.ok(report.recomputed >= 3);
  // Fresh world: new server processes and ledgers; same lock (same pins), so the same registry hash. The provider must never be called.
  const host2 = new NodecapHost({ catalog: world(), ledger, envelope, env: envOf(secondWorld) });
  t.after(() => host2.close());
  await host2.qualify();
  const never = new ScriptedProvider(() => { throw new Error('replay must not call a provider'); });
  const replayModels = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': never, 'llama-server': never }, journal: new Journal(store) });
  const replayRuntime = runtimeFor({ store, host: host2, ledger, construction, envelope, models: replayModels, modelPolicy: loaded }).runtime;
  const replayRun = replayRuntime.create(construction.lowered, {}, { modelMode: 'replay', sampleSalt: store.rows.header(first.id).sampleSalt });
  assert.equal(store.rows.header(replayRun.id).registryHash, store.rows.header(first.id).registryHash);
  const replayed = await approveAndFinish(replayRuntime, host2, await replayRuntime.execute(replayRun.id), ledger, construction.lock);
  assert.equal(replayed.status, 'succeeded', JSON.stringify(replayed.error));
  assert.equal(never.calls.length, 0);
  assert.equal(new Journal(store).forRun(replayRun.id).reduce((sum, row) => sum + (row.costUsd ?? 0), 0), 0, '$0 model cost');
  assert.deepEqual(replayed.outputs.work, first.outputs.work);
  assert.deepEqual(comparable(nodecapDecisions(store, replayRun.id)), comparable(nodecapDecisions(store, first.id)));
  const rows = file => ledgerLines(file).map(({ at, ...rest }) => rest);
  assert.deepEqual(rows(path.join(secondWorld, 'sheets.jsonl')), rows(path.join(firstWorld, 'sheets.jsonl')));
  assert.deepEqual(rows(path.join(secondWorld, 'crm.jsonl')), rows(path.join(firstWorld, 'crm.jsonl')));
  assert.equal(verifyAcquisitions({ store, runId: replayRun.id, lock: construction.lock, envelope }).ok, true);
});

test('replay: tampering a decision row is caught by verify-run and by the acquisition audit; an edited lock is caught too', async t => {
  const dir = workspace(t), store = new Store(dir), ledger = openLedger(dir);
  const catalog = world(), host = new NodecapHost({ catalog, ledger, envelope, env: envOf(dir) });
  const provider = new ScriptedProvider({ [M]: [SCRIPT[1], SCRIPT[5]] });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const construction = await construct({ workflow, sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  approveVersion(ledger, construction);
  const run = await (await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded })).execute();
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(verifyAcquisitions({ store, runId: run.id, lock: construction.lock, envelope }).ok, true);
  // An edited lock (a member that was never in it) no longer matches the decisions' lockHash.
  const edited = structuredClone(construction.lock); edited.nodes.work.bound.push('mcp.crm.update_contact');
  assert.ok(verifyAcquisitions({ store, runId: run.id, lock: edited, envelope }).findings.some(f => f.code === 'LOCK_MISMATCH'));
  // Flip the recorded grant into a refusal in the database: the chain's decision hash and the recomputation both disagree.
  const [row] = store.decisionRows(run.id).filter(r => JSON.parse(r.body).action?.result === 'granted');
  const body = JSON.parse(row.body); body.action = { ...body.action, result: 'refused', code: 'NEED_TRUST' };
  const { canonical } = await import('../src/data.mjs');
  store.db.prepare('UPDATE decisions SET body=? WHERE id=?').run(canonical(body), row.id);
  assert.equal(verifyRun(store, run.id).ok, false);
  const audit = verifyAcquisitions({ store, runId: run.id, lock: construction.lock, envelope });
  assert.equal(audit.ok, false);
  assert.ok(audit.findings.some(f => f.code === 'DECISION_MISMATCH'), JSON.stringify(audit.findings));
  assert.ok(audit.findings.some(f => f.code === 'UNGRANTED_CALL'), 'with the grant gone, the call it allowed is ungranted');
});
