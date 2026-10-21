// Nodecap I9 across processes (ARCHITECTURE.md §2.1): the person approved a lock that pins each member. In a later process the host
// qualifies the servers afresh; if a server now serves different definitions (with the very same command line), the launch preflight
// refuses (DEFINITION_CHANGED, the entry quarantined) and, for a registry compiled from the stored lock without a launch (a resume or a
// replay), every call is refused before it is sent. The host's own fresh qualification is never the reference. $0, fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { checkCatalog, catalogDigest } from '../src/capabilities/catalog.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope } from '../src/capabilities/envelope.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { NodecapHost, memberDrift } from '../src/capabilities/host.mjs';
import { loadTypes } from '../src/capabilities/types.mjs';
import { construct, launch, subjectOf, executeRun, runtimeFor } from '../src/capabilities/launcher.mjs';
import { FIXTURES, catalogOf, crmEntry, ledgerLines, workspace } from './support/nodecap.mjs';

const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const workflow = { schemaVersion: '1.0', id: 'NodecapDrift', version: 1, title: 'Drift probe', goal: 'Read one contact', domain: 'diagnostic',
  envelope: { assumptions: ['fixture servers'], risks: [], successCriteria: ['typed answer'] }, budget: { maxSteps: 200, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 },
  nodes: [{ id: 'work', kind: 'agent', needs: [], description: 'Tool node', role: 'extract', instructions: 'Read contact c-1 and give its email.', model: { class: 'M' },
    returns: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', maxLength: 200 } } } }],
  acceptance: [{ op: 'exists', value: { $ref: 'nodes.work' } }] };
const sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { acquire: { systems: ['crm'], objects: ['contact'], effectsMax: 'none', max: 2 }, maxTurns: 4 } } };
const SCRIPT = [step({ action: 'read', tool: 'crm_get_contact', args: { id: 'c-1' } }), step({ action: 'done', answer: { email: 'ada@analytical.example' } })];
// The same catalog entry (same command line) in every process; the definitions come from the host env (NODECAP_FIXTURE_VARIANT).
const catalog = checkCatalog(catalogOf(crmEntry({ ledgerName: 'crm', variant: null })));
const hostIn = (t, ledger, dir, variant) => { const host = new NodecapHost({ catalog, ledger, envelope, env: { NODECAP_LEDGER_DIR: dir, NODECAP_FIXTURE_VARIANT: variant } }); t.after(() => host.close()); return host; };
const modelsFor = (store, script) => { const provider = new ScriptedProvider({ [M]: script }); return { provider, models: new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) }) }; };

test('drift: a definition change after approval refuses the launch (DEFINITION_CHANGED, quarantined) and every call of a stored-lock registry', async t => {
  const dir = workspace(t), store = new Store(dir), ledger = new NodecapLedger(dir);
  t.after(() => { store.close(); ledger.close(); });
  // Process 1: construct, approve, run. Definitions "a".
  const host1 = hostIn(t, ledger, dir, 'a'), first = modelsFor(store, SCRIPT);
  const construction = await construct({ workflow, sidecar, host: host1, envelope, types, catalogDigest: catalogDigest(catalog) });
  ledger.approveLock(subjectOf(construction), { channel: 'cli' });
  const run1 = await (await launch({ store, ledger, host: host1, construction, envelope, models: first.models, modelPolicy: loaded })).execute();
  assert.equal(run1.status, 'succeeded', JSON.stringify(run1.error));
  assert.equal(ledgerLines(path.join(dir, 'crm.jsonl')).length, 1);
  // Process 2: the same command line now serves a changed get_contact description ("c"). Qualification alone accepts it.
  const host2 = hostIn(t, null, dir, 'c');
  await host2.qualify();
  const member = 'mcp.crm.get_contact';
  assert.ok(host2.member(member), 'a fresh qualification has no reference of its own and accepts the new definition');
  assert.deepEqual(memberDrift(construction.lock.members[member], host2.member(member)), { code: 'DEFINITION_CHANGED', fields: ['pins'] });
  // A registry compiled from the stored lock (a resume or a replay path, no launch): the call is refused before it is sent.
  const second = modelsFor(store, [SCRIPT[0], step({ action: 'stuck' })]);
  const { runtime } = runtimeFor({ store, host: host2, ledger: null, construction, envelope, models: second.models, modelPolicy: loaded });
  const run2 = await executeRun({ runtime, host: host2, runId: runtime.create(construction.lowered, {}).id });
  assert.equal(run2.error?.code, 'NODE_STUCK');
  assert.deepEqual([run2.frames['root/work__loop:0'].outputs.do.ok, run2.frames['root/work__loop:0'].outputs.do.code], [false, 'DEFINITION_CHANGED']);
  assert.equal(ledgerLines(path.join(dir, 'crm.jsonl')).length, 1, 'the changed server received no call');
  // Through launch (process 3, with the ledger): the preflight refuses and quarantines the entry.
  const host3 = hostIn(t, ledger, dir, 'c');
  await host3.qualify();
  await assert.rejects(launch({ store, ledger, host: host3, construction, envelope, models: second.models, modelPolicy: loaded }), error => {
    assert.equal(error.code, 'PREFLIGHT_FAILED');
    assert.ok(error.details.problems.some(p => p.code === 'DEFINITION_CHANGED' && p.member === member), JSON.stringify(error.details.problems));
    return true;
  });
  assert.equal(ledger.status('crm').status, 'quarantined');
  assert.ok(ledger.quarantineLog('crm').some(q => q.code === 'DEFINITION_CHANGED' && q.since === 'lock'));
  // Back to "a" in a fresh process: no drift, but the entry stays quarantined until the owner reactivates it (status machine, CAS).
  const host4 = hostIn(t, ledger, dir, 'a');
  await host4.qualify();
  assert.equal(host4.member(member), null, 'a quarantined entry contributes no members');
  ledger.setStatus('crm', { to: 'active', expectedRev: ledger.status('crm').rev, actor: 'owner', reason: 'reviewed' });
  const host5 = hostIn(t, ledger, dir, 'a');
  await host5.qualify();
  assert.equal(memberDrift(construction.lock.members[member], host5.member(member)), null);
  await assert.rejects(host5.invoke(member, { id: 'c-1' }, { approved: { ...construction.lock.members[member], viewHash: 'sha256:0', implementation: 'sha256:1' } }), code('LOCK_STALE'), 'a changed view with the same pins is a stale lock, not drift');
});
