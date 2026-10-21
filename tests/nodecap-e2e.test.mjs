// Nodecap P7 end to end: ONE tool node, nothing pre-bound, acquires an MCP read (L1), an owner skill (L1) and computer use on the
// Stockroom app (L1 observe/act, L2 commit after runtime.approve), through the real Runtime, ModelPort and a scripted model that reads
// its own prompt (basis, indices, held request) like a model would. Then the acquisitions are re-verified independently.
// Skips with a reason without Chromium. $0; development evidence, not a capability claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { Store } from '../src/store.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { checkCatalog, catalogDigest } from '../src/capabilities/catalog.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope } from '../src/capabilities/envelope.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { NodecapHost } from '../src/capabilities/host.mjs';
import { loadTypes } from '../src/capabilities/types.mjs';
import { chromiumPath } from '../src/capabilities/cua.mjs';
import { construct, launch, subjectOf, executeRun } from '../src/capabilities/launcher.mjs';
import { nodecapDecisions } from '../src/capabilities/journal.mjs';
import { verifyAcquisitions } from '../experiments/nodecap/verify-acquisitions.mjs';
import { startStockroom } from '../experiments/nodecap/fixtures/stockroom/app.mjs';
import { FIXTURES, catalogOf, crmEntry, skillEntry, ledgerLines, workspace } from './support/nodecap.mjs';

const skip = chromiumPath() ? false : 'no Chromium executable installed';
const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const PASSWORD = `pw-${randomUUID()}`;
const RETURNS = { type: 'object', additionalProperties: false, required: ['email', 'starterDailyRate', 'street'], properties: {
  email: { type: 'string', maxLength: 200 }, starterDailyRate: { type: 'number', minimum: 0, maximum: 1000 }, street: { type: 'string', maxLength: 200 } } };
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const last = (prompt, re) => { const all = [...prompt.matchAll(re)]; return all.at(-1); };
// A scripted "model" that reads the transcript in its prompt (canonical JSON) to find the basis, element indices and the held request.
function script(args, index) {
  const p = args.prompt, basis = () => last(p, /"basis":"(sha256:[0-9a-f]{64})"/g)?.[1], idx = (role, name) => Number(last(p, new RegExp(`\\{"i":(\\d+),"name":"${name}","nth":0,"role":"${role}"`, 'g'))?.[1]);
  switch (index) {
    case 0: return step({ action: 'read', tool: 'crm_search_contacts', args: { query: 'Analytical' } });
    case 1: return step({ action: 'read', tool: 'skill_refund_policy', args: { reference: 'references/RATES.md' } });
    case 2: return step({ action: 'read', tool: 'stockroom_ui_observe', args: { path: '/vendors/V-9' } });
    case 3: return step({ action: 'read', tool: 'stockroom_ui_act', args: { basis: basis(), index: idx('textbox', 'Street'), op: 'fill', value: '7 New Street' } });
    case 4: return step({ action: 'read', tool: 'stockroom_ui_act', args: { basis: basis(), index: idx('button', 'Save address'), op: 'click' } });
    case 5: {
      const held = last(p, /"pending":\[\{"bodyHash":"([0-9a-f]{64})","bodyPreview":"[^"]*","id":"([^"]+)","method":"([A-Z]+)","origin":"([^"]+)","path":"([^"]+)"\}/g);
      return step({ action: 'act', tool: 'stockroom_ui_commit', args: { id: held[2], method: held[3], origin: held[4], path: held[5], bodyHash: held[1] } });
    }
    case 6: return step({ action: 'read', tool: 'stockroom_ui_assert', args: { textPresent: '7 New Street, Leeds' } });
    case 7: {
      const email = last(p, /"email":"([^"]+@analytical\.example)"/g)?.[1], rate = Number(last(p, /\| starter \| 29\.00 +\| ([0-9.]+)/g)?.[1]);
      return step({ action: 'done', answer: { email, starterDailyRate: rate, street: '7 New Street' } });
    }
    default: throw new Error(`unexpected call ${index}`);
  }
}

test('e2e: one tool node acquires an MCP read (L1), a skill (L1) and computer use with an approved commit (L2)', { skip, timeout: 120000 }, async t => {
  const { chromium } = await import('playwright');
  const dir = workspace(t), crmLedger = path.join(dir, 'crm.jsonl');
  const app = await startStockroom({ password: PASSWORD });
  t.after(() => app.close());
  const catalog = checkCatalog(catalogOf(crmEntry({ ledger: crmLedger }), skillEntry('refund-policy'),
    { id: 'stockroom-ui', kind: 'cua', trust: 'T0', status: 'active', dev: true, source: { backend: 'playwright-local', origins: [app.origin], profile: 'S0' },
      login: { path: '/login', user: { env: 'STOCKROOM_USER' }, password: { env: 'STOCKROOM_PASSWORD' } }, limits: { maxSteps: 40, observationTokens: 2500 } }), { allowDev: true });
  const store = new Store(dir), ledger = new NodecapLedger(dir);
  const host = new NodecapHost({ catalog, ledger, envelope, chromium, env: { STOCKROOM_USER: 'ops@stockroom.test', STOCKROOM_PASSWORD: PASSWORD } });
  const provider = new ScriptedProvider({ [M]: script });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const workflow = { schemaVersion: '1.0', id: 'NodecapE2E', version: 1, title: 'Vendor update with acquired tools', goal: 'Look up, read the house rate, and update the vendor address', domain: 'diagnostic',
    envelope: { assumptions: ['fixture world'], risks: ['a held write'], successCriteria: ['address changed once'] }, budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 },
    nodes: [{ id: 'work', kind: 'agent', needs: [], description: 'Do the task with acquired tools', role: 'plan', instructions: 'Find the Analytical Engines contact email, the starter daily rate, and change vendor V-9 street to 7 New Street.',
      returns: RETURNS, model: { class: 'M' } }], acceptance: [{ op: 'eq', left: { $ref: 'nodes.work.street' }, right: '7 New Street' }] };
  const sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { acquire: { systems: ['crm', 'policy', 'stockroom-ui'], objects: ['contact', 'refund', 'page'], effectsMax: 'non-idempotent', max: 8 }, maxTurns: 10 } } };
  const construction = await construct({ workflow, sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  assert.deepEqual(construction.lint.errors, []);
  assert.deepEqual(construction.lock.nodes.work.bound, [], 'nothing is pre-bound: every capability is acquired');
  ledger.approveLock(subjectOf(construction), { channel: 'dashboard' });
  const { runtime, run: created, execute } = await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  let run = await execute();
  assert.equal(run.status, 'awaiting_approval', JSON.stringify(run.error));
  assert.equal(app.ledger.writes.length, 0, 'the held write did not reach the server before the approval');
  const [approvalId] = Object.keys(run.approvals);
  assert.match(JSON.stringify(run.approvals[approvalId].args), /stockroom_ui_commit/);
  runtime.approve(run.id, approvalId, true, 'user');
  run = await executeRun({ runtime, host, runId: created.id });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(run.outputs.work, { email: 'ada@analytical.example', starterDailyRate: 0.9673, street: '7 New Street' });
  assert.deepEqual(app.ledger.writes, [{ kind: 'vendor.address', vendor: 'V-9', street: '7 New Street', city: 'Leeds' }], 'exactly one write, the approved one');
  assert.equal(ledgerLines(crmLedger).filter(l => l.tool === 'search_contacts').length, 1);
  const decisions = nodecapDecisions(store, run.id).filter(d => d.action.result === 'granted').map(d => [d.action.member, d.action.level]);
  assert.deepEqual(decisions, [['mcp.crm.search_contacts', 'L1'], ['skill.refund-policy', 'L1'], ['ui.stockroom-ui.observe', 'L1'], ['ui.stockroom-ui.act', 'L1'],
    ['ui.stockroom-ui.commit', 'L2'], ['ui.stockroom-ui.assert', 'L1']]);
  const report = verifyAcquisitions({ store, runId: run.id, lock: construction.lock, envelope });
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.recomputed, 6);
  assert.equal(report.calls, 7, "search, skill, observe, fill, click (held), commit, assert");
  // The node's close exported the UI trace as an artifact (hash-named, receipt in the ledger); it never holds the login secret.
  const [receipt] = ledger.receipts('ui.trace');
  assert.equal(receipt.runId, run.id);
  const artifacts = path.join(dir, '.foundry', 'artifacts', run.id);
  assert.ok(readdirSync(artifacts).includes(receipt.file), JSON.stringify({ files: readdirSync(artifacts), receipt }));
  assert.equal(execFileSync('unzip', ['-p', path.join(artifacts, receipt.file)], { maxBuffer: 64 * 1024 * 1024 }).toString('latin1').includes(PASSWORD), false);
  for (const call of provider.calls) assert.equal(call.prompt.includes(PASSWORD), false);
});
