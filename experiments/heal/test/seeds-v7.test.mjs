import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { draw, loadLedger, saveLedger, isUsed, INITIAL, POOLS } from '../seeds.mjs';
import { bedsLib } from '../replay.mjs';
import { STRATA } from '../verify.mjs';
import { skipReason } from './helpers.mjs';
import { incidentFor, recordsFlip, proposalFrom, runVerify } from './fixtures.mjs';

const makeTaskFor = family => async seed => (await (await bedsLib()).makeTasks(family, { split: 'dev', seeds: [seed], difficulty: 3 }))[0];

test('seed ledger: the repository\'s consumed seeds are known, a drawn seed is consumed, an exhausted pool is an error', { skip: skipReason }, async () => {
  const ledger = { schema: 'x', entries: structuredClone(INITIAL), referenceHashes: {} };
  for (const s of [1, 2, 3, 101, 160]) assert.equal(isUsed(ledger, 'records', 'dev', 3, s), true, `records dev d3 s${s}`);
  assert.equal(isUsed(ledger, 'records', 'test', 3, 6001), true); assert.equal(isUsed(ledger, 'records', 'test', 3, 5006), true); assert.equal(isUsed(ledger, 'records', 'dev', 3, 1001), false);
  const a = await draw({ ledger, family: 'records', difficulty: 3, n: 3, by: 'test', makeTask: makeTaskFor('records') });
  assert.deepEqual(a, [1001, 1002, 1003]);
  const b = await draw({ ledger, family: 'records', difficulty: 3, n: 2, by: 'test', makeTask: makeTaskFor('records') });
  assert.deepEqual(b, [1004, 1005], 'a seed that reached a gate is never fresh again');
  assert.equal(isUsed(ledger, 'records', 'dev', 3, 1003), true);
  await assert.rejects(draw({ ledger, family: 'records', difficulty: 3, n: 500, by: 'test', makeTask: makeTaskFor('records'), scan: 5 }), /HEAL_SEED_POOL_EXHAUSTED/);
  assert.deepEqual(POOLS.heal.records, [1001, 1100]); assert.ok(POOLS.ex1.records[0] === 2001, 'EX1 owns 2001+');
  await assert.rejects(draw({ ledger, family: 'nope', difficulty: 3, n: 1, by: 't', makeTask: async () => ({}) }), /HEAL_SEED_POOL/);
  const dir = mkdtempSync(path.join(tmpdir(), 'heal-ledger-')), file = path.join(dir, 'ledger.json');
  saveLedger(ledger, file); assert.deepEqual(loadLedger(file).entries.at(-1).seeds, [1004, 1005]);
});

test('seed ledger: codefix tasks are deduplicated by the hash of their reference solution', { skip: skipReason }, async () => {
  const ledger = { schema: 'x', entries: structuredClone(INITIAL), referenceHashes: {} };
  const seeds = await draw({ ledger, family: 'codefix', difficulty: 3, n: 4, by: 'test', makeTask: makeTaskFor('codefix') });
  assert.equal(seeds.length, 4);
  assert.equal(Object.keys(ledger.referenceHashes.codefix).length >= 4, true);
  assert.equal(new Set(Object.values(ledger.referenceHashes.codefix)).size, Object.keys(ledger.referenceHashes.codefix).length, 'no two drawn tasks share a reference');
});

test('records strata: BRIGHTDESK numeric order of a fresh task is read oracle-side, from the hidden world', { skip: skipReason }, async () => {
  const seen = new Set();
  for (const seed of [1001, 1002, 1003, 1004, 1005, 1006]) { const t = await makeTaskFor('records')(seed); seen.add(await STRATA.records(t.task, { system: 'BRIGHTDESK' })); }
  assert.ok([...seen].every(x => x === 'mdy' || x === 'dmy') && seen.size === 2, `both strata exist among six seeds: ${[...seen]}`);
  assert.equal(await STRATA.records((await makeTaskFor('records')(1001)).task, { system: 'LEDGR' }), null);
});

test('V7: paired fresh tasks, stratified; the decision rules reject a worse candidate, a lost task and a worse stratum', { skip: skipReason }, async () => {
  const w = await incidentFor('F-haiku/records:test:d3:s6001/0', 'records', recordsFlip), { wf } = w;
  const proposal = proposalFrom(w, wf.records, [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'A worked example decides a system numeric date order.' }]);
  w.incident.sample = { identity: { system: 'BRIGHTDESK' } };
  const run = async decide => {
    const rank = {}, strata = {};
    const h = { ledger: { schema: 'x', entries: structuredClone(INITIAL), referenceHashes: {} }, saveLedger: () => {},
      runTask: async ({ arm, seed, salt, task }) => { rank[seed] ??= Object.keys(rank).length; strata[seed] ??= await STRATA.records(task.task, { system: 'BRIGHTDESK' }); return { pass: decide({ arm, rank: rank[seed], stratum: strata[seed], i: Number(salt.split(':').at(-1)) }), costUsd: 0.01 }; } };
    const v = await runVerify(w, { base: wf.records, proposal, extra: { stages: ['V7'], providers: {}, hooks: h, policy: { fresh: { enabled: true, n: 6, k: 2 } } } });
    return { v, h, stage: v.stages.at(-1) };
  };
  // equal outcomes pass; both values of the localised field are exercised on three tasks each
  let r = await run(() => true);
  assert.equal(r.stage.ok, true, JSON.stringify(r.stage)); assert.equal(r.stage.seeds, 6); assert.equal(r.stage.base, 12); assert.equal(r.stage.cand, 12);
  assert.equal(r.stage.stratified, true); assert.equal(r.stage.strata.length, 2); assert.ok(r.stage.strata.every(s => s.tasks === 3));
  assert.ok(Math.abs(r.v.costUsd - 0.01 * 24) < 1e-9, 'every fresh run is charged');
  assert.ok(r.h.ledger.entries.at(-1).seeds.every(s => s >= 1001), 'drawn from the heal pool, recorded in the ledger');
  // a candidate with fewer passes
  r = await run(({ arm, i }) => arm === 'base' ? true : i === 0);
  assert.equal(r.stage.code, 'HEAL_FRESH_WORSE'); assert.equal(r.v.rejectCode, 'HEAL_FRESH_WORSE');
  // more passes overall, but one task the base passed 2/2 is now 0/2
  r = await run(({ arm, rank }) => arm === 'base' ? rank < 3 : rank !== 0);
  assert.equal(r.stage.code, 'HEAL_FRESH_LOST_TASK');
  // more passes overall and no lost task, but the stratum the patch targeted got worse: a hard-coded convention
  r = await run(({ arm, stratum, i }) => arm === 'base' ? stratum === 'dmy' : stratum === 'mdy' || i === 0);
  assert.equal(r.stage.code, 'HEAL_FRESH_STRATUM_WORSE', JSON.stringify(r.stage));
  // no hook and no provider: the gate is pending, not passed
  const pending = await runVerify(w, { base: wf.records, proposal, extra: { stages: ['V7'], providers: null, policy: { fresh: { enabled: true } } } });
  assert.equal(pending.pending, true); assert.equal(pending.stages.at(-1).code, 'HEAL_NEEDS_LIVE');
});
