// The free-form builder (app/core/builder-freeform.mjs) with a SCRIPTED ModelPort ($0, no network): one typed call returns a whole
// workflow and its practice cases; code checks and practises it; at most two bounded repairs with the check output; caps stop a build;
// the model id comes only from the owner policy; FoundryApp checks the result again before anything is proposed.
// node --test app/test/builder-freeform.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Journal } from '../../src/journal.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { FreeformBuilder, FREEFORM_SYSTEM, DEFAULT_FREEFORM_MODEL } from '../core/builder-freeform.mjs';
import { FoundryApp } from '../core/service.mjs';
import { reconciliation, strangerTarget, needsSms } from '../demo/workflows.mjs';

const build = (workflow, practice) => ({ decision: 'build', reason: 'scripted', workflowJson: JSON.stringify(workflow), practiceJson: JSON.stringify(practice ?? []), missingCapabilities: [] });
/** A ModelPort over a scripted claude-cli provider: `answers` are returned in order (the last one repeats). */
function scripted(answers, usage = { inputTokens: 1000, outputTokens: 200 }) {
  const seen = [];
  const provider = new ScriptedProvider(args => { seen.push(args); return { value: answers[Math.min(seen.length - 1, answers.length - 1)], usage, costUsd: 0.001 }; });
  return { port: new ModelPort({ policy: loadPolicy().policy, providers: { 'claude-cli': provider }, journal: new Journal(new DatabaseSync(':memory:')) }), seen };
}
const good = build(reconciliation.workflow, reconciliation.practiceInput);
const ungrounded = build(strangerTarget.workflow, strangerTarget.practiceInput);

test('one shot + one practice run: a workflow that passes the checks and practice is ready, built from the skill core and the capability catalogue', async () => {
  const { port, seen } = scripted([good]);
  const b = new FreeformBuilder({ port });
  assert.match(b.id, /^freeform-builder\/1 \(claude-haiku-5-5/);
  const r = await b.build({ request: reconciliation.request });
  assert.equal(r.status, 'ready', r.reply); assert.equal(r.freeform, true);
  assert.equal(r.workflow.id, 'bank-ledger-reconciliation'); assert.equal(r.workflow.version, 1);
  assert.deepEqual(r.practice.map(c => c.name), ['a month with every kind of difference']);
  assert.equal(r.buildReport.calls, 1); assert.equal(r.buildReport.practiceRuns.length, 1); assert.deepEqual(r.buildReport.repairs, []);
  assert.equal(seen.length, 1); assert.equal(seen[0].modelEntry?.id ?? seen[0].modelId ?? DEFAULT_FREEFORM_MODEL, DEFAULT_FREEFORM_MODEL);
  assert.match(seen[0].system, /# Construct a workflow/); assert.match(seen[0].system, /# The workflow IR/); assert.match(seen[0].system, /every e-mail address, chat channel or sheet/i);
  assert.match(seen[0].prompt, /"name":"outbox\.send"/); assert.doesNotMatch(seen[0].prompt, /fixture\./);
  assert.match(seen[0].prompt, /finance@acme\.example/, 'the person\'s words are in the prompt (as data)');
  assert.equal(FREEFORM_SYSTEM(), seen[0].system);
});

test('a failed check goes back with its output; at most two bounded repairs; then build_failed', async () => {
  const { port, seen } = scripted([ungrounded, good]);
  const r = await new FreeformBuilder({ port }).build({ request: reconciliation.request });
  assert.equal(r.status, 'ready'); assert.equal(r.buildReport.calls, 2);
  assert.match(seen[1].prompt, /UNGROUNDED_TARGET: The e-mail “cfo@acme\.example”/); assert.match(seen[1].prompt, /Previous workflowJson:/);
  const always = scripted([ungrounded]);
  const f = await new FreeformBuilder({ port: always.port }).build({ request: reconciliation.request });
  assert.equal(f.status, 'build_failed'); assert.equal(always.seen.length, 3, '1 build + 2 repairs, no more'); assert.match(f.reply, /after 2 repair/);
  const none = scripted([ungrounded]);
  assert.equal((await new FreeformBuilder({ port: none.port, maxRepairs: 0 }).build({ request: reconciliation.request })).status, 'build_failed');
  assert.equal(none.seen.length, 1);
  assert.throws(() => new FreeformBuilder({ port: none.port, maxRepairs: 3 }), e => e.code === 'BUILDER_REPAIRS');
});

test('practice failures are repaired too; "cannot" is an honest refusal; caps stop a build; the model id comes only from the policy', async () => {
  const broken = JSON.parse(JSON.stringify(reconciliation.workflow));
  broken.nodes.find(n => n.id === 'compare').args.compare = ['amount', 'date'];   // the comparison now differs from the recount on dates
  const practice = [{ name: 'dates differ', input: {}, sheets: { bank: [{ txn: 'T', amount: 1, date: '2026-01-01' }], ledger: [{ txn: 'T', amount: 1, date: '2026-01-02' }] } }];
  const { port, seen } = scripted([build(broken, practice), good]);
  const r = await new FreeformBuilder({ port }).build({ request: reconciliation.request });
  assert.equal(r.status, 'ready'); assert.match(seen[1].prompt, /Practice case "dates differ" ended failed/);
  const cannot = scripted([{ decision: 'cannot', reason: 'texting needs an SMS capability', workflowJson: '', practiceJson: '[]', missingCapabilities: ['sms.send'] }]);
  const u = await new FreeformBuilder({ port: cannot.port }).build({ request: needsSms.request });
  assert.equal(u.status, 'unsupported'); assert.deepEqual(u.missing, ['sms.send']); assert.match(u.reply, /cannot build that yet.*sms\.send/);
  const capped = scripted([ungrounded], { inputTokens: 1000, outputTokens: 100 });
  const c = await new FreeformBuilder({ port: capped.port, maxTotalTokens: 1000 }).build({ request: reconciliation.request });
  assert.equal(c.status, 'build_failed'); assert.equal(capped.seen.length, 1, 'over the token cap after one call: no repair call'); assert.match(c.reply, /1100 tokens, over its cap of 1000/);
  const later = scripted([ungrounded], { inputTokens: 1000, outputTokens: 100 });
  const l = await new FreeformBuilder({ port: later.port, maxTotalTokens: 1500 }).build({ request: reconciliation.request });
  assert.equal(l.status, 'build_failed'); assert.equal(later.seen.length, 2, 'the cap is checked after every call'); assert.match(l.reply, /2200 tokens, over its cap of 1500/);
  const dollars = scripted([ungrounded]);
  assert.equal((await new FreeformBuilder({ port: dollars.port, maxUsd: 0.0005 }).build({ request: reconciliation.request })).status, 'build_failed');
  assert.throws(() => new FreeformBuilder({ port, model: 'gpt-9' }), e => e.code === 'MODEL_NOT_IN_POLICY');
  const json = scripted([{ ...good, workflowJson: '{not json' }, good]);
  assert.equal((await new FreeformBuilder({ port: json.port }).build({ request: reconciliation.request })).status, 'ready');
  assert.match(json.seen[1].prompt, /not valid JSON/);
});

test('words only through FoundryApp: the builder\'s workflow takes the same checks and practice as an agent\'s, and its proposal names the builder', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'freeform-app-'));
  const { port } = scripted([good]);
  const app = new FoundryApp({ workspace: dir, builder: new FreeformBuilder({ port }) });
  try {
    const p = await app.propose({ request: reconciliation.request });
    assert.equal(p.status, 'proposed', JSON.stringify(p.blockers ?? p.problem)); assert.match(p.builder, /^freeform-builder/);
    assert.equal(p.build.calls, 1); assert.equal(app.ledger.freeform(p.proposalId).body.cases.length, 1);
    const d = await app.dryRun({ proposalId: p.proposalId });
    assert.equal(d.passed, true);
    // A builder whose answer the app's own checks refuse cannot slip past them: same request, the person never wrote the CFO's address.
    const sneaky = { id: 'sneaky', async build() { return { status: 'ready', freeform: true, builder: 'sneaky', workflow: { ...strangerTarget.workflow, id: 'other-flow' }, practice: strangerTarget.practiceInput }; }, rebase: x => x };
    const app2 = new FoundryApp({ workspace: path.join(dir, 'two'), builder: sneaky });
    try { const s = await app2.propose({ request: reconciliation.request }); assert.equal(s.status, 'refused'); assert.ok(s.blockers.some(x => x.code === 'UNGROUNDED_TARGET')); }
    finally { await app2.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
