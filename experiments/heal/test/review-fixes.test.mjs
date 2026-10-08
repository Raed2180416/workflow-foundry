// Regression tests for the defects the adversarial review of the live heal runs found (2026-10-08). None calls a model.
//   1. codefix fresh draws were deduplicated only against earlier FRESH draws, never against the inspected/used tasks; and a seed a stratum
//      vetoed was cached and then skipped forever as a "duplicate" of itself
//   2. the scanner's template-constant exemption accepted text from ANY other task (now: only text every other task has), and exempted
//      value bounds (`minimum`/`maximum`) as structure
//   3. verification replicas journaled their live calls only into throwaway copies; they are now kept in an evidence journal
//   4. the first V3 replica was not budget-reserved
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { draw, INITIAL, referenceHash, usedTaskKeys } from '../seeds.mjs';
import { bedsLib, openCtx, replayRun, acceptedCalls, keepLiveRows } from '../replay.mjs';
import { compileOps } from '../ops.mjs';
import { scanLeaks, buildLeakIndex } from '../scan.mjs';
import { Budget } from '../budget.mjs';
import { world, byKey, skipReason } from './helpers.mjs';
import { incidentFor, recordsFlip, proposalFrom, runVerify } from './fixtures.mjs';

const makeTaskFor = family => async seed => (await (await bedsLib()).makeTasks(family, { split: 'dev', seeds: [seed], difficulty: 3 }))[0];
const envOf = (kit, gate) => { const policy = kit.sessionPolicy(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']); return { classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong }; };

test('seeds: a codefix draw skips a fresh seed whose task equals an already-used (inspected) task, and a vetoed seed stays drawable', { skip: skipReason }, async () => {
  const ledger = { schema: 'x', entries: structuredClone(INITIAL), referenceHashes: {} };
  assert.ok(usedTaskKeys(ledger, 'codefix').some(u => u.key === 'test:d3:s6001'), 'the inspected C0 test tasks are used tasks');
  // simulate the dev/test overlap (beds/codefix AUDIT F2): the inspected test task 6001 has the same reference as dev seed 1001
  const h1001 = await referenceHash('codefix', (await makeTaskFor('codefix')(1001)).task);
  ledger.referenceHashes.codefix = { 'test:d3:s6001': h1001 };
  const a = await draw({ ledger, family: 'codefix', difficulty: 3, n: 2, by: 'test', makeTask: makeTaskFor('codefix') });
  assert.deepEqual(a, [1002, 1003], 'the dev task that duplicates an inspected test task is never served as fresh');
  assert.ok(Object.keys(ledger.referenceHashes.codefix).includes('test:d1:s1') === false && Object.keys(ledger.referenceHashes.codefix).includes('dev:d3:s1'), 'used tasks were hashed (C0 probes dev d3 1-3)');
  // a stratum veto leaves the seed unused AND drawable later (it used to be skipped forever as a duplicate of its own cached hash)
  const fresh = { schema: 'x', entries: structuredClone(INITIAL), referenceHashes: {} };
  let first = true;
  const b = await draw({ ledger: fresh, family: 'codefix', difficulty: 3, n: 1, by: 'veto', makeTask: makeTaskFor('codefix'), keep: async () => { if (first) { first = false; return false; } return true; } });
  assert.deepEqual(b, [1002], 'the first candidate (1001) was vetoed');
  const c = await draw({ ledger: fresh, family: 'codefix', difficulty: 3, n: 1, by: 'after veto', makeTask: makeTaskFor('codefix') });
  assert.deepEqual(c, [1001], 'the vetoed seed is still fresh and is drawn next');
});

test('scan: a template constant must occur in EVERY other task of the family; value bounds are not structure', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), env = envOf(kit, gate);
  const failing = { prompt: 'Merge the legacy lists.', inputs: { source_notes: 'The system\'s name is printed first. Ledger writes day before month like the zebra office. Born 1977.' }, files: {} };
  const t1 = { prompt: 'Merge the legacy lists.', inputs: { source_notes: 'The system\'s name is printed first. Ledger writes day before month like the zebra office.' }, files: {} };
  const t2 = { prompt: 'Merge the legacy lists.', inputs: { source_notes: 'The system\'s name is printed first. Ledger writes month before day.' }, files: {} };
  const texts = t => [t.prompt, ...Object.values(t.inputs)];
  const index = buildLeakIndex({ tasks: [failing], familyTasks: [texts(t1), texts(t2)], baseWorkflow: null });
  const scan = ops => { const c = compileOps(wf.records, ops, env); assert.deepEqual(c.errors, [], JSON.stringify(c.errors)); return scanLeaks(wf.records, c.workflow, index); };
  assert.deepEqual(scan([{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'Quote how the system\'s name is printed.' }]), [], 'a phrase every other task has is a template constant');
  const leak = scan([{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'Ledger writes day before month like the zebra office.' }]);
  assert.equal(leak[0]?.rule, 1, 'a convention sentence that only SOME other tasks share is still copied task text');
  // value bounds carry task values; size bounds do not
  const bounded = compileOps(wf.records, [{ op: 'add_evidence_field', node: 'conf', field: 'order_quote', maxLength: 600, instruction: 'Copy the deciding sentence.', source: 'input.inputs.source_notes' }], env);
  assert.deepEqual(bounded.errors, []);
  const withYear = structuredClone(bounded.workflow); withYear.nodes.find(n => n.id === 'conf').returns.properties.order_quote.minimum = 1977;
  const r = scanLeaks(wf.records, withYear, index);
  assert.equal(r[0]?.rule, 2, 'a minimum equal to a number of the failing task is a literal leak');
  assert.deepEqual(scanLeaks(wf.records, bounded.workflow, buildLeakIndex({ tasks: [{ prompt: '600 rows', inputs: {} }], baseWorkflow: null })), [], 'maxLength stays structural');
});

test('evidence: the live calls of a verification replica are kept after its journal copy is deleted (and replays are not)', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const t = byKey(trials, 'F-haiku/records:test:d3:s6001/0');
  const peek = await openCtx(t.source, { kit, name: 'r' });
  const recorded = acceptedCalls(peek.journal, t.runId).find(r => r.nodeKey === 'root/conf').response.value; peek.close();
  const provider = new kit.ScriptedProvider(() => ({ value: recorded, costUsd: 0.0042 }));
  const ctx = await openCtx(t.source, { kit, name: 'keep', providers: { 'claude-cli': provider } });
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'heal-keep-')), 'v3.sqlite');
  let r;
  try {
    const edited = structuredClone(wf.records); edited.nodes.find(n => n.id === 'conf').model = { class: 'L', maxClass: 'L' };
    r = await replayRun(ctx, edited, t, { mode: 'replay-or-live' });
    assert.equal(keepLiveRows(ctx, file, { stage: 'V3', replica: 0 }), r.liveCalls);
  } finally { ctx.close(); }
  assert.equal(existsSync(ctx.file), false, 'the throwaway copy is gone');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT model_id, cost_usd, request FROM model_calls').all();
    assert.equal(rows.length, 1); assert.equal(rows[0].model_id, 'claude-sonnet-5-5'); assert.ok(Math.abs(rows[0].cost_usd - 0.0042) < 1e-9);
    assert.deepEqual(JSON.parse(rows[0].request).healEvidence, { stage: 'V3', replica: 0 });
  } finally { db.close(); }
});

test('V3: the first replica is budget-reserved too (a run cannot start a live replica it could not pay for)', { skip: skipReason }, async () => {
  const w = await incidentFor('F-haiku/records:test:d3:s6001/0', 'records', recordsFlip), { wf } = w;
  const proposal = proposalFrom(w, wf.records, [{ op: 'k_sample_agreement', node: 'conf', k: 2, onDisagree: 'escalate' }]);
  let called = 0;
  const providers = { 'claude-cli': new w.kit.ScriptedProvider(() => { called++; return { value: null }; }) };
  const v = await runVerify(w, { base: wf.records, proposal, extra: { budget: new Budget(0.01), providers, stages: ['V0', 'V1', 'V2', 'V3'], policy: { lintDebt: 'defer' } } });
  const v3 = v.stages.find(s => s.id === 'V3');
  assert.ok(v3, JSON.stringify(v.stages.map(x => [x.id, x.ok, x.code])));
  assert.equal(v3.ok, null); assert.equal(v3.code, 'HEAL_BUDGET_EXHAUSTED');
  assert.equal(called, 0, 'no live call was started');
});

test('approve: an owner can approve a verified blocked or owner-review candidate, never a pending or rejected one', { skip: skipReason }, async () => {
  const { kit, wf } = await world();
  const { Lineage, decide } = await import('../promote.mjs');
  const { digest, clone } = await import('../ir.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'heal-approve-')), lineage = new Lineage({ kit, dir: path.join(dir, 'state'), file: path.join(dir, 'lineage.jsonl') });
  try {
    const head0 = lineage.open(wf.codefix);
    const cand = clone(wf.codefix); cand.version = 2; cand.nodes.find(n => n.id === 'fix').instructions += '\nReviewed.';
    const proposal = { id: 'pa', kind: 'defect', ops: [{ op: 'relax_check' }], workflow: cand, proposer: { mechanical: ['x'] } };
    const ok = { schema: 'heal-verification/1', ok: true, pending: false, rejectCode: null, lintDebtOpen: true, costRatio: 0.6, baseHash: head0.hash, candidateHash: digest(cand), stages: [{ id: 'V0', ok: true }] };
    const pending = { ...ok, ok: false, pending: true, stages: [{ id: 'V3', ok: null, code: 'HEAL_BUDGET_EXHAUSTED' }] };
    const rejected = { ...ok, ok: false, rejectCode: 'HEAL_REGRESSION' };
    assert.throws(() => lineage.approveReview({ proposal, verification: pending, owner: 'owner', decision: decide(pending, proposal) }), /HEAL_NOT_VERIFIED/);
    assert.throws(() => lineage.approveReview({ proposal, verification: rejected, owner: 'owner', decision: decide(rejected, proposal) }), /HEAL_NOT_VERIFIED/);
    const d = decide(ok, proposal); assert.equal(d.decision, 'blocked');
    assert.equal(lineage.head(wf.codefix.id).workflow.version, 1);
    const r = lineage.approveReview({ proposal, verification: ok, owner: 'owner', decision: d });
    assert.equal(r.version, 2);
    const line = lineage.lines().at(-1);
    assert.deepEqual(line.approval, { owner: 'owner', over: 'blocked' }); assert.match(line.reasons.join(' '), /over the gate's block: lint errors remain/);
  } finally { lineage.close(); }
});

test('relax proof: a relaxed check that crashes where the old one judged (a function that became a class) is not proven', { skip: skipReason }, async () => {
  const { codefixFlip } = await import('./fixtures.mjs');
  const { relaxProof, mutantBattery } = await import('../proofs.mjs');
  const w = await incidentFor('F-haiku/codefix:test:d3:s6004/0', 'codefix', codefixFlip), { kit, wf, incident } = w;
  const node = wf.codefix.nodes.find(n => n.id === 'check1'), { args, moduleSource, texts } = incident.checkInputs.check1;
  assert.ok(mutantBattery(moduleSource).some(m => m.class === 'kind_changed'), 'the battery turns a public top-level function into a class');
  const quote = (w.task.task.inputs.bug_report.split('\n').find(l => /default/.test(l) && l.length > 40) ?? '').trim();
  const shape = 'def _shape(sig):\n    return {"args": sig["args"], "ndefaults": len(sig["defaults"]), "kwonly": sig["kwonly"], "star": sig["star"], "kw": sig["kw"]}\n\n\ndef _run_tests(';
  const crashy = node.source.replace('def _run_tests(', shape).replace('elif sig != "class" and cand_api[key] != sig:', 'elif sig != "class" and _shape(cand_api[key]) != _shape(sig):');
  const guarded = crashy.replace('def _shape(sig):\n', 'def _shape(sig):\n    if not isinstance(sig, dict):\n        return sig\n');
  const proof = after => ({ type: 'relax', node: 'check1', target: 'source', before: node.source, after, quote, battery: 'python-signature', justifiedClass: 'default-value-changed', lang: 'python' });
  const bad = await relaxProof({ proof: proof(crashy), kit, node, args, moduleSource, taskTexts: texts });
  assert.equal(bad.ok, false); assert.ok(bad.violations.some(v => /crashes/.test(v)), JSON.stringify(bad.violations));
  const good = await relaxProof({ proof: proof(guarded), kit, node, args, moduleSource, taskTexts: texts });
  assert.equal(good.ok, true, JSON.stringify(good.violations));
});
