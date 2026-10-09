import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, HEAL_DIR, KIT_DIR, verifyKit, readPins, blobOf, policyDrift, kitSourceTexts } from '../kit.mjs';
import { freezeSrc } from '../../kev-data/exec/frozen-src.mjs';
import { verifyPinned } from '../pin-gate.mjs';
import { world, skipReason } from './helpers.mjs';

test('the frozen kit has the blob ids of commit 880c6b9 and the owner policy is the kit policy', { skip: skipReason }, async () => {
  const { kit } = await world();
  const check = verifyKit();
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.equal(check.files, 87);
  assert.equal(kit.kitHash, '7e8f0f83153c5efb');
  // "identical" means: no drift that could change a model choice or a replay (the live file may differ in prose and in provider keys
  // the kit never reads; see the policy-drift tests below). The run uses the kit's policy of record, so its hash is the recorded one.
  assert.equal(kit.policyIdentical, true);
  assert.deepEqual(kit.policyDrift.blocking, []);
  assert.equal(kit.ownerPolicyHash, kit.policy.loadPolicy(path.join(KIT_DIR, 'policy/models.json')).hash);
  assert.equal(readPins().kit.commit, '880c6b9');
});

// The policy-drift tests need only the frozen kit's src/ and policy/ at 880c6b9, which regenerate from git (`git archive`, verified
// blob by blob: .foundry/kev-data/frozen-src/<sha>/), so they run without /opt/foundry-kit or the recorded journals.
let frozenSrc = null, frozenSkip = false;
try { frozenSrc = freezeSrc({ commit: readPins().kit.commit }); } catch (e) { frozenSkip = `the frozen kit 880c6b9 cannot be regenerated from git (${e.code ?? e.message})`; }
const frozenPolicy = () => JSON.parse(readFileSync(path.join(frozenSrc.dir, 'policy/models.json'), 'utf8'));
const atCommit = (commit, file) => JSON.parse(execFileSync('git', ['-C', REPO, 'show', `${commit}:${file}`], { encoding: 'utf8' }));
const JEV_COMMIT = '38f74fd';    // Jev (TypeSafe System One) added to the owner policy: judgmentModels + providers.typesafe-systemone

test('the regenerated frozen kit is the heal kit: its src/ and policy/ have the pinned blob ids', { skip: frozenSkip }, () => {
  const want = readPins().kit.files, files = Object.keys(want).filter(f => f.startsWith('src/') || f.startsWith('policy/'));
  assert.ok(files.length > 40);
  for (const f of files) assert.equal(blobOf(path.join(frozenSrc.dir, f)), want[f], f);
});

test('policy drift: prose and a provider key the kit never reads are reported, not blocking', { skip: frozenSkip }, () => {
  const frozen = frozenPolicy(), live = structuredClone(frozen);
  live.policyVersion = '2099-01-01.1'; live.notes = [...live.notes, 'a new note'];
  live.providers['claude-cli'].childEnv = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  const d = policyDrift(live, frozen, { kitSources: ['export const x = 1;'] });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.deepEqual(d.blocking, []);
  assert.deepEqual(d.ignored.sort(), ['notes', 'policyVersion', 'providers.claude-cli.childEnv: no kit source mentions "childEnv"']);
});

test('policy drift: anything that can change a model choice or a call blocks, and the childEnv exemption lapses if the kit reads it', { skip: frozenSkip }, () => {
  const frozen = frozenPolicy(), edit = f => { const live = structuredClone(frozen); f(live); return policyDrift(live, frozen, { kitSources: [] }); };
  const haiku = l => l.models.find(m => m.id === 'claude-haiku-5-5');
  assert.deepEqual(edit(l => { haiku(l).price.inputPerMTok += 1; }).blocking, ['models']);
  assert.deepEqual(edit(l => { haiku(l).class = 'L'; }).blocking, ['models']);
  assert.deepEqual(edit(l => { l.models = l.models.filter(m => m.id !== 'claude-haiku-5-5'); }).blocking, ['models']);
  assert.deepEqual(edit(l => { l.classOrder = [...l.classOrder].reverse(); }).blocking, ['classOrder']);
  assert.deepEqual(edit(l => { l.providers['claude-cli'].invocation = [...l.providers['claude-cli'].invocation, '--verbose']; }).blocking, ['providers.claude-cli.invocation']);
  assert.equal(edit(l => { l.escalation = { ...(l.escalation ?? {}), maxEscalationsPerNode: 0 }; }).ok, false);
  // a kit that mentions childEnv would act on it: a difference there is then blocking
  const live = structuredClone(frozen); live.providers['claude-cli'].childEnv = { A: '1' };
  assert.deepEqual(policyDrift(live, frozen, { kitSources: ['const { childEnv } = config;'] }).blocking, ['providers.claude-cli.childEnv']);
  // a file with no drift at all
  assert.deepEqual(policyDrift(frozen, frozen), { bytesIdentical: false, blocking: [], ignored: [], ok: true });
});

// Q6 (owner decision 2026-10-09, research/heal-20261008/DESIGN.md): a judgment-only addition the frozen kit provably never reads.
test('policy drift (Q6): the Jev policy (38f74fd) against the frozen kit policy passes, with the two judgment-only entries proved unread', { skip: frozenSkip }, () => {
  const kitSources = kitSourceTexts(frozenSrc.dir);
  assert.ok(kitSources.length >= 40);
  for (const s of ['judgmentModels', 'typesafe-systemone', 'childEnv']) assert.ok(kitSources.every(t => !t.includes(s)), s);
  const d = policyDrift(atCommit(JEV_COMMIT, 'policy/models.json'), frozenPolicy(), { kitSources });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.deepEqual(d.blocking, []);
  assert.deepEqual(d.ignored.sort(), [
    'judgmentModels: no kit source mentions "judgmentModels"',
    'notes', 'policyVersion',
    'providers.claude-cli.childEnv: no kit source mentions "childEnv"',
    'providers.typesafe-systemone: no kit source mentions "typesafe-systemone"; no models[] entry names it',
  ]);
});

test('policy drift (Q6): a generative model, a models[] entry on the judgment provider, or a kit that reads the key still blocks', { skip: frozenSkip }, () => {
  const kitSources = kitSourceTexts(frozenSrc.dir), frozen = frozenPolicy(), jev = atCommit(JEV_COMMIT, 'policy/models.json');
  const withJev = f => { const live = structuredClone(jev); f(live); return policyDrift(live, frozen, { kitSources }); };
  const haiku = jev.models.find(m => m.id === 'claude-haiku-5-5');
  // a new generative model (models[] is what ModelPort and class resolution read)
  assert.deepEqual(withJev(l => { l.models.push({ ...structuredClone(haiku), id: 'claude-haiku-5-6' }); }).blocking, ['models']);
  // a generative model routed through the judgment provider: the kit would look that provider up by name, so it is no longer exempt
  assert.deepEqual(withJev(l => { l.models.push({ ...structuredClone(haiku), id: 'jev-gen', provider: 'typesafe-systemone' }); }).blocking,
    ['models', 'providers.typesafe-systemone']);
  // a kit source that mentions the key or the provider name: the exemption lapses and the difference blocks
  assert.deepEqual(policyDrift(jev, frozen, { kitSources: [...kitSources, 'const j = policy.judgmentModels ?? [];'] }).blocking, ['judgmentModels']);
  assert.deepEqual(policyDrift(jev, frozen, { kitSources: [...kitSources, "providers['typesafe-systemone']"] }).blocking, ['providers.typesafe-systemone']);
  // the Jev policy with no kit sources at all is still ok (nothing is read), and a changed Jev entry stays exempt only while unread
  assert.equal(withJev(l => { l.judgmentModels[0].price.inputPerMTok = 1; }).ok, true);
});

test('policy drift: loadKit runs under the policy of record and reports how the live owner file differs (the refusal rules are the unit tests above)', { skip: skipReason }, async () => {
  const { kit } = await world();
  // whatever the live file says today, the kit exposes how it differs from the policy of record
  assert.ok(Array.isArray(kit.policyDrift.ignored) && typeof kit.policyDrift.bytesIdentical === 'boolean');
  assert.equal(kit.policyDrift.ok, true);
  assert.deepEqual(kit.ownerPolicy.providers['claude-cli'].childEnv, undefined);   // the run never carries a key the kit does not implement
});

test('a kit that differs from the pins is refused', { skip: skipReason }, () => {
  const pins = structuredClone(readPins());
  const file = Object.keys(pins.kit.files).find(f => f.endsWith('runtime.mjs'));
  pins.kit.files[file] = '0'.repeat(40);
  const check = verifyKit({ pins });
  assert.equal(check.ok, false);
  assert.deepEqual(check.mismatched, [file]);
  delete pins.kit.files['src/engine.mjs'];
  assert.ok(verifyKit({ pins }).extra.includes('src/engine.mjs'));
});

test('the gate closure is pinned: lint, acceptance and verdict at 13f7664, byte-identical copies', { skip: skipReason }, async () => {
  const { gate } = await world();
  assert.equal(verifyPinned().ok, true);
  assert.equal(gate.source, 'pinned');
  assert.equal(gate.blobs['src/lint.mjs'], '91ff528cbace9176dacbbaf9ef1aa49f64a80bd7');
  assert.equal(blobOf(path.join(HEAL_DIR, 'pinned/src/lint.mjs')), gate.blobs['src/lint.mjs']);
  assert.equal(blobOf(path.join(HEAL_DIR, 'pinned/src/verdict.mjs')), gate.blobs['src/verdict.mjs']);
});

test('the pinned lint reproduces the retro-audit exactly on the three base workflows', { skip: skipReason }, async () => {
  const { gate, kit, wf } = await world();
  const policy = kit.sessionPolicy(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  const audit = JSON.parse(readFileSync(path.join(REPO, 'research/lint-20261008/retro-audit.json'), 'utf8')).lintOver;
  for (const [name, w] of [['F-haiku-codefix-k1', wf.codefix], ['F-haiku-records-k1', wf.records]]) {
    const want = audit.find(a => a.workflow === name), got = gate.lintWorkflow(w, { modelPolicy: policy });
    assert.deepEqual(got.codes, want.codes, name);
    assert.deepEqual(got.counts, want.counts, name);
    assert.deepEqual(got.findings.map(f => [f.code, f.severity, f.path]), want.findings.map(f => [f.code, f.severity, f.path]), name);
  }
  // records-v3 (P1): 11 errors, every one of them acceptance/gating debt
  const p1 = gate.lintWorkflow(wf.p1, { modelPolicy: policy });
  assert.equal(p1.counts.error, 11);
});

test('the pinned verdict re-derives "unverified / ACCEPTANCE_EXISTENCE_ONLY" for a succeeded run of an existence-only workflow', { skip: skipReason }, async () => {
  const { gate } = await world();
  const wf = { acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.x' } }], nodes: [] };
  const v = gate.verdictOf({ status: 'succeeded', nodes: {}, outputs: {}, frames: {} }, { workflow: wf });
  assert.equal(v.verdict, 'unverified');
  assert.equal(v.code, 'ACCEPTANCE_EXISTENCE_ONLY');
});
