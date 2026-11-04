// AppWorld bed (breadth bed 3) tests. Pure tests always run; tests that need the pinned venv and data
// (/var/tmp/foundry-work/benches/appworld) skip when it is absent.
//   nice -n 15 node --test --test-concurrency=1 experiments/breadth/appworld/test/appworld.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Host-only and live roots of this test process live in a private temp directory (set before the modules load).
const TMP = mkdtempSync(path.join('/var/tmp/foundry-work', 'appworld-test-'));
process.env.FOUNDRY_APPWORLD_HOST = path.join(TMP, 'host');
process.env.FOUNDRY_APPWORLD_LIVE = path.join(TMP, 'live');
const L = await import('../lib.mjs');
const R = await import('../split-rule.mjs');
const S = await import('../split.mjs');
const M = await import('../mcp.mjs');
const F = await import('../facade.mjs');
const RUN = await import('../run.mjs');
const P = await import('../parity.mjs');
const LP = await import('../leakprobe.mjs');
const IL = await import('../interleave.mjs');
test.after(() => rmSync(TMP, { recursive: true, force: true }));

const HAVE_BED = existsSync(L.VENV_PY) && existsSync(L.DATA_DIR);
const split = S.loadSplit();

// ---- split -------------------------------------------------------------------------------------------------------------
test('SPLIT.json reproduces from its recorded salt and the rule', () => {
  assert.equal(split.rule, 'aw-split-v1');
  assert.equal(split.splitSha256, 'cf47942cb49ee65fdeb321f91f2463faf110c14a95c5904f60d22170ae027caf');
  assert.equal(split.beacon.round, R.roundAt(split.ruleCommitTime));
  assert.deepEqual(split.counts, { devTrain: 90, devCheck: 57, sealed: 168, sealedScenarios: 56, sonnetDefault: 64, opusAnchors: 20, testChallengeUsed: 0 });
});

test('split rule file is byte-identical to its rule commit', () => {
  const info = S.ruleCommitInfo();
  assert.equal(info.sha, split.ruleCommit);
});

test('sealed subsets: <= 2 variants per scenario for A-S, anchors nested, every scenario covered', () => {
  const as = split.sealed.sonnetDefault;
  const per = new Map();
  for (const id of as) per.set(R.scenarioOf(id), (per.get(R.scenarioOf(id)) ?? 0) + 1);
  assert.equal(per.size, 56);
  assert.ok([...per.values()].every(n => n >= 1 && n <= 2));
  assert.equal([...per.values()].filter(n => n === 2).length, 8);
  assert.equal(new Set(split.sealed.opusAnchors.map(R.scenarioOf)).size, 20);
  assert.ok(split.sealed.opusAnchors.every(a => as.includes(a)));
  assert.ok(as.every(id => split.roles.sealed.includes(id)));
  assert.ok(split.pilotOrder.every(id => split.roles.devTrain.includes(id)));
  for (const r of ['devTrain', 'devCheck']) assert.ok(split.roles[r].every(id => !split.roles.sealed.includes(id)));
});

test('A-S cut from the ICC: n_eff 60 rule', () => {
  assert.equal(R.sonnetK(1 / 3), 64);
  assert.equal(R.sonnetK(0), 60);
  assert.equal(R.sonnetK(0.5), 68);
  assert.equal(R.sonnetK(1), 112); // cannot reach 60 at icc 1: capped at 2 variants per scenario
  assert.ok(R.nEff(48, 8, 1 / 3) >= 60 - 1e-9);
  assert.deepEqual(S.sonnetSubset(split), split.sealed.sonnetDefault);
});

test('the rule refuses a different population', () => {
  const lists = { train: split.roles.devTrain, dev: split.roles.devCheck, test_normal: split.roles.sealed.slice(1) };
  assert.throws(() => R.buildSplit(lists, { ruleCommit: 'x', ruleCommitTime: 1, beaconRound: { round: 1, randomness: 'a', signature: 'b' } }), /population differs/);
});

// ---- relay -----------------------------------------------------------------------------------------------------------
test('relay lists exactly the arm tools and rejects unknown tools', async () => {
  const box = path.join(TMP, 'relay-box');
  const replies = [];
  const h = M.makeServer({ tools: M.armTools(false), box, waitMs: 2000, write: m => replies.push(m) });
  await h({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(replies[0].result.tools.map(t => t.name), ['execute', 'api_docs', 'python']);
  await h({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'grade', arguments: {} } });
  assert.equal(replies[1].result.isError, true);
  assert.match(replies[1].result.content[0].text, /Unknown tool/);
  assert.deepEqual(M.armTools(true).map(t => t.name), ['execute', 'api_docs', 'python', 'read_notes', 'write_notes']);
});

test('relay -> mailbox -> facade round trip (fake world)', async () => {
  const wd = path.join(TMP, 'rt');
  mkdirSync(wd, { recursive: true });
  const calls = [];
  const bridge = { execute: async (h, code) => { calls.push(['execute', code]); return { output: `ran ${code.length}`, completed: code.includes('complete_task'), refused: false }; },
    docs: async (h, a, b) => { calls.push(['docs', a, b]); return { output: `docs ${a}/${b}` }; } };
  const facade = new F.Facade({ workdir: wd, bridge, handle: 'h1', maxExecutes: 2, python: async () => ({ stdout: 'py', error: null }) }).start();
  const replies = [];
  const relay = M.makeServer({ tools: M.armTools(false), box: path.join(wd, '.tools'), waitMs: 10_000, write: m => replies.push(m) });
  await relay({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute', arguments: { code: 'print(1)' } } });
  await relay({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'api_docs', arguments: { app_name: 'spotify' } } });
  await relay({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'execute', arguments: { code: 'apis.supervisor.complete_task()' } } });
  await relay({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'execute', arguments: { code: 'x' } } });
  await relay({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'python', arguments: { code: 'print(2)' } } });
  const st = await facade.stop();
  assert.equal(replies[0].result.content[0].text, 'ran 8');
  assert.equal(replies[1].result.content[0].text, 'docs spotify/null');
  assert.match(replies[3].result.content[0].text, /limit of 2 execute calls/);
  assert.equal(replies[4].result.content[0].text, 'py');
  assert.equal(st.executes, 2); assert.equal(st.completed, true); assert.equal(st.docs, 1); assert.equal(st.pythonRuns, 1);
  assert.deepEqual(calls.map(c => c[0]), ['execute', 'docs', 'execute']);
});

test('facade: a bridge failure is reported as an environment failure, never as a tool output', async () => {
  const wd = path.join(TMP, 'fault');
  mkdirSync(wd, { recursive: true });
  const facade = new F.Facade({ workdir: wd, bridge: { execute: async () => { throw new Error('bridge exited (1)'); } }, handle: 'h' });
  const r = await facade.answer({ execute: 'print(1)' });
  assert.equal(r.error, 'the environment failed to answer this request');
  assert.match(facade.bridgeError, /bridge exited/);
  assert.ok(RUN.isEnvFault({ facade: { bridgeError: facade.bridgeError } }));
});

// ---- runner hygiene -------------------------------------------------------------------------------------------------
test('runner refuses test_challenge, mixed roles, sealed without a freeze, and a 4th devCheck look', () => {
  assert.throws(() => RUN.assertUnits(split, ['0000000_1']), /test_challenge is never run/);
  assert.throws(() => RUN.assertUnits(split, [split.roles.devTrain[0], split.roles.devCheck[0]], { armFamily: 'A-H', look: 1 }), /mix roles/);
  assert.equal(RUN.assertUnits(split, [split.roles.devTrain[0], split.roles.devCheck[0]]).role, 'dev'); // scripted train + dev
  assert.throws(() => RUN.assertUnits(split, [split.roles.devTrain[0], split.roles.sealed[0]]), /mix roles/);
  assert.throws(() => RUN.assertUnits(split, [split.roles.sealed[0]]), /--sealed --freeze/);
  assert.throws(() => RUN.assertUnits(split, [split.roles.devTrain[0]], { sealed: true }), /test_normal units only/);
  const dc = [split.roles.devCheck[0]];
  assert.throws(() => RUN.assertUnits(split, dc, { armFamily: 'A-H' }), /--look 1\|2\|3/);
  for (const look of [1, 2, 3]) RUN.assertUnits(split, dc, { armFamily: 'A-H', look });
  assert.throws(() => RUN.assertUnits(split, dc, { armFamily: 'A-H', look: 3 }), /already recorded/);
  assert.throws(() => RUN.assertUnits(split, dc, { armFamily: 'A-H', look: 4 }), /--look 1\|2\|3/);
  assert.equal(RUN.assertUnits(split, dc).role, 'devCheck'); // scripted: no look accounting
  // a resumed run continues its recorded look (not a new one); resuming a look that was never recorded is refused
  assert.equal(RUN.assertUnits(split, dc, { armFamily: 'A-H', look: 2, record: false }).role, 'devCheck');
  assert.throws(() => RUN.assertUnits(split, dc, { armFamily: 'A-S', look: 1, record: false }), /not recorded/);
  const fz = path.join(TMP, 'freeze.json');
  writeFileSync(fz, JSON.stringify({ kind: 'appworld-sealed-freeze', splitSha256: split.splitSha256 }));
  assert.equal(RUN.assertUnits(split, split.roles.sealed.slice(0, 2), { sealed: true, freeze: fz }).role, 'sealed');
  writeFileSync(fz, JSON.stringify({ kind: 'appworld-sealed-freeze', splitSha256: 'other' }));
  assert.throws(() => RUN.assertUnits(split, split.roles.sealed.slice(0, 2), { sealed: true, freeze: fz }), /does not freeze this split/);
});

test('ids for a CLI invocation: pilot prefixes, sealed subsets, dev only for scripted', () => {
  assert.deepEqual(RUN.idsFor({ arm: 'A-S', pilot: true }, split), split.pilotOrder.slice(0, 12));
  assert.throws(() => RUN.idsFor({ arm: 'A-H', split: 'dev' }, split), /scripted policies/);
  assert.equal(RUN.idsFor({ scripted: 'null', split: 'dev' }, split).length, 147);
  const fz = path.join(TMP, 'freeze2.json');
  writeFileSync(fz, JSON.stringify({ kind: 'appworld-sealed-freeze', splitSha256: split.splitSha256 }));
  assert.equal(RUN.idsFor({ sealed: true, freeze: fz }, split).length, 168);
  assert.deepEqual(RUN.idsFor({ sealed: true, freeze: fz, subset: 'A-S' }, split), split.sealed.sonnetDefault);
  assert.deepEqual(RUN.idsFor({ sealed: true, freeze: fz, subset: 'A-O' }, split), split.sealed.opusAnchors);
  assert.throws(() => RUN.idsFor({ subset: 'A-S' }, split), /sealed runs only/);
});

test('scripted policies never run sealed units', async () => {
  await assert.rejects(RUN.runUnits({ ids: split.roles.sealed.slice(0, 1), policy: 'null', log: () => {} }), /--sealed --freeze/);
});

test('model arms need a cap and a policy-listed model', async () => {
  await assert.rejects(RUN.runUnits({ ids: split.roles.devTrain.slice(0, 1), armName: 'A-H', log: () => {} }), /--cap/);
  await assert.rejects(RUN.runUnits({ ids: split.roles.devTrain.slice(0, 1), armName: 'F-H', capUsd: 1, log: () => {} }), /unknown arm/);
});

test('outcome: TGC, sub-goal share, collateral (no_op_pass failures), L5 violation fails the unit', () => {
  const v = { success: true, passCount: 4, failCount: 0, failures: [] };
  assert.deepEqual(RUN.outcome(v, { violations: [] }), { tgc: true, subGoal: 1, collateral: false });
  const w = { success: false, passCount: 3, failCount: 1, failures: [{ label: 'no_op_pass' }] };
  assert.deepEqual(RUN.outcome(w, { violations: [] }), { tgc: false, subGoal: 0.75, collateral: true });
  assert.deepEqual(RUN.outcome(v, { violations: ['L5: x'] }), { tgc: false, subGoal: 0, collateral: false });
  const s = RUN.summarize([{ scenario: 'a', outcome: { tgc: true, subGoal: 1 } }, { scenario: 'a', outcome: { tgc: false, subGoal: 0.5 } }, { scenario: 'b', outcome: { tgc: true, subGoal: 1 } }]);
  assert.equal(s.tgc, 2 / 3); assert.equal(s.sgc, 0.5); assert.equal(s.scenarios, 2);
});

test('L5 audit flags out-of-set tools and benchmark or network references in code', () => {
  const tools = M.armTools(false);
  const a = RUN.auditSession({ toolUses: [{ name: 'Bash', input: {} }, { name: 'mcp__appworld__execute', input: { code: "open('/var/tmp/foundry-work/benches/appworld/root/data/tasks/x/ground_truth/answer.json')" } }], nestedModelUses: 0 }, tools);
  assert.equal(a.violations.length, 2);
  assert.equal(RUN.auditSession({ toolUses: [{ name: 'mcp__appworld__execute', input: { code: '# AppWorld: find the song\nprint(apis.spotify.show_song(song_id=1))' } }] }, tools).violations.length, 0);
  for (const code of ['import appworld', 'from appworld.task import Task', "__import__('appworld')", "__import__('subprocess')", 'import socket']) {
    assert.equal(RUN.auditSession({ toolUses: [{ name: 'mcp__appworld__execute', input: { code } }] }, tools).violations.length, 1, code);
  }
});

test('prompts: AppWorld convention, date note, card appended', () => {
  const p = RUN.taskPrompt({ supervisor: { first_name: 'A', last_name: 'B', email: 'a@b', phone_number: '1' }, instruction: 'do X' });
  assert.match(p, /^My name is A B\. My personal email is a@b and my phone number is 1\.\n\nTask: do X$/);
  const s = RUN.systemPrompt({ card: 'CARD' });
  assert.match(s, /## Date/); assert.match(s, /## Bed card\nCARD$/); assert.doesNotMatch(s, /## Notes/);
  assert.match(RUN.systemPrompt({ notes: true }), /## Notes/);
});

// ---- interleaving (PLAN §5.2) ---------------------------------------------------------------------------------------
test('interleave: whole-scenario blocks in hashed order, rotating arm order, each arm only its own units, a stop stops all', async () => {
  const fz = path.join(TMP, 'freeze-il.json');
  writeFileSync(fz, JSON.stringify({ kind: 'appworld-sealed-freeze', splitSha256: split.splitSha256 }));
  const a = { arms: 'A-H,A-HN,A-S,A-O', sealed: true, freeze: fz, caps: 'A-H=1,A-HN=1,A-S=1,A-O=1', block: '5', 'run-id': 'il-test' };
  const per = IL.armIds(a, ['A-H', 'A-HN', 'A-S', 'A-O'], split);
  assert.deepEqual(per['A-H'], split.roles.sealed); assert.deepEqual(per['A-S'], split.sealed.sonnetDefault); assert.deepEqual(per['A-O'], split.sealed.opusAnchors);
  const blocks = IL.scenarioBlocks(per, split.salt, 5);
  assert.equal(blocks.flat().length, 168); assert.equal(new Set(blocks.flat()).size, 168);
  const blockOf = new Map(); blocks.forEach((b, k) => b.forEach(id => { const s = L.scenarioOf(id); assert.ok(!blockOf.has(s) || blockOf.get(s) === k, 'a scenario straddles blocks'); blockOf.set(s, k); }));
  assert.ok(blocks.every(b => new Set(b.map(L.scenarioOf)).size <= 5));
  assert.deepEqual(blocks.flat().map(L.scenarioOf).filter((s, i, xs) => xs.indexOf(s) === i), S.runOrder(split.roles.sealed, split.salt).map(L.scenarioOf).filter((s, i, xs) => xs.indexOf(s) === i));
  const calls = [];
  const fake = async o => { calls.push(o); return { summary: { meter: { last: { n: calls.length } } }, stopped: null }; };
  const r = await IL.interleave({ ...a, splitObject: split }, { runUnitsImpl: fake, graderImpl: { tag: 'shared' }, log: () => {} });
  assert.equal(r.stopped, null); assert.equal(r.blocks, blocks.length);
  const ran = {}; for (const c of calls) { ran[c.armName] ??= []; ran[c.armName].push(...c.onlyIds); assert.deepEqual(c.ids, per[c.armName]); assert.equal(c.grader.tag, 'shared'); assert.equal(c.runId, `il-test-${c.armName.toLowerCase()}`); }
  for (const arm of Object.keys(per)) assert.deepEqual([...ran[arm]].sort(), [...per[arm]].sort(), arm);
  assert.deepEqual(calls.slice(0, 4).map(c => c.armName), ['A-H', 'A-HN', 'A-S', 'A-O']);
  const second = calls.filter(c => blocks[1].includes(c.onlyIds[0])).map(c => c.armName);
  assert.equal(second[0], 'A-HN'); // rotated
  assert.deepEqual(calls[1].meterSeed, { n: 1 }); // the meter reading carries to the next arm and block
  calls.length = 0;
  const stopAt = async o => { calls.push(o); return { summary: {}, stopped: calls.length === 3 ? 'the cap' : null, stopKind: calls.length === 3 ? 'cap' : null }; };
  const s = await IL.interleave({ ...a, splitObject: split }, { runUnitsImpl: stopAt, graderImpl: {}, log: () => {} });
  assert.equal(s.stopKind, 'cap'); assert.equal(calls.length, 3);
  await assert.rejects(IL.interleave({ ...a, caps: 'A-H=1', splitObject: split }, { runUnitsImpl: fake, graderImpl: {}, log: () => {} }), /--caps needs a USD cap for A-HN/);
  await assert.rejects(IL.interleave({ ...a, arms: 'A-H,F-H', splitObject: split }, { runUnitsImpl: fake, graderImpl: {}, log: () => {} }), /--arms/);
});

test('runUnits refuses onlyIds outside the run', async () => {
  await assert.rejects(RUN.runUnits({ ids: split.roles.devTrain.slice(0, 2), onlyIds: [split.roles.devTrain[5]], policy: 'null', runId: 'only-test', log: () => {} }), /outside this run/);
});

// ---- parity helpers -------------------------------------------------------------------------------------------------
test('parity comparison and mutation score', () => {
  const row = (success, post) => ({ success, passCount: success ? 2 : 1, failCount: success ? 0 : 1, passSha256: 'p', failSha256: 'f', postDigest: { sha256: post } });
  const a = new Map([['t/gold@verify', row(true, 'x')]]), b = new Map([['t/gold@verify', row(true, 'y')]]);
  assert.deepEqual(P.compareRows(a, b, ['t/gold@verify']).mismatches, [{ key: 't/gold@verify', fields: ['post'] }]);
  assert.equal(P.compareRows(a, a, ['t/gold@verify']).equal, 1);
  const off = new Map([['t/gold@verify', row(true, 'g')], ['t/mut:a', row(true, 'g')], ['u/gold@verify', row(true, 'h')], ['u/mut:a', row(false, 'm')], ['v/gold@verify', row(true, 'i')], ['v/mut:a', row(true, 'n')]]);
  const ms = P.mutationScore(off, off, ['t', 'u', 'v'], ['mut:a']);
  assert.deepEqual({ gen: ms.byOp['mut:a'].generated, eq: ms.byOp['mut:a'].equivalent, killed: ms.killed, scored: ms.scored, survived: ms.byOp['mut:a'].survived }, { gen: 3, eq: 1, killed: 1, scored: 2, survived: ['v'] });
  assert.equal(P.batteryDigest(a, ['t/gold@verify']), P.batteryDigest(new Map(a), ['t/gold@verify']));
});

test('leak verdict: empty masks and the way to a kept path are not leaks', () => {
  const kept = ['/var/tmp/foundry-work/benches/appworld/venv'];
  assert.deepEqual(LP.leakedPaths({ '/var/tmp': [], '/var/tmp/foundry-work/benches/appworld': ['venv'], '/home/user': null }, kept), []);
  assert.deepEqual(LP.leakedPaths({ '/var/tmp/foundry-work/benches/appworld': ['root', 'venv'] }, kept), ['/var/tmp/foundry-work/benches/appworld']);
});

test('bridge.py plan helpers: write rule, endpoint matching, extra-field choice (system python, no appworld import)', () => {
  const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(L.HERE)}); import bridge as b
docs = {'simple_note': {'update_note': {'method': 'PATCH', 'path': '/simple_note/notes/{note_id}', 'parameters': [
  {'name': 'note_id', 'type': 'integer', 'required': True, 'default': None}, {'name': 'access_token', 'type': 'string', 'required': True, 'default': None},
  {'name': 'title', 'type': 'string', 'required': False, 'default': None}, {'name': 'pinned', 'type': 'boolean', 'required': False, 'default': None}]}}}
w = [{'method': 'patch', 'url': '/simple_note/notes/7', 'data': {'title': 'x'}}]
print(json.dumps([b.is_write(w[0]), b.is_write({'method': 'post', 'url': '/supervisor/message', 'data': {}}), b.is_write({'method': 'post', 'url': '/spotify/auth/token', 'data': {}}),
  b.match_api(docs, 'patch', '/simple_note/notes/7')[1], b.extra_field_choice(docs, w), b.extra_field_choice(docs, [])]))`;
  const out = JSON.parse(execFileSync('/usr/bin/python3', ['-I', '-c', code], { encoding: 'utf8' }).trim());
  assert.deepEqual(out, [true, false, false, 'update_note', { k: 1, api: 'simple_note.update_note', field: 'pinned', value: true }, null]);
});

test('mutant prelude: replays send the body with its access token (prepare() pops it from the dict it is given)', () => {
  // a fake requester whose write methods pop access_token like appworld's requester.prepare and record what they sent
  const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(L.HERE)}); import bridge as b
class R:
    def __init__(self): self.sent = []
    def _call(self, m, url, data=None, raise_on_failure=None, **kw):
        d = data or {}
        tok = d.pop('access_token', None)
        self.sent.append([m, url, tok, dict(d)])
        class Resp: status_code = 200 if (tok or url.startswith('/supervisor/')) else 401
        return Resp()
    def _post(self, url, data=None, **kw): return self._call('post', url, data, **kw)
    def _put(self, url, data=None, **kw): return self._call('put', url, data, **kw)
    def _patch(self, url, data=None, **kw): return self._call('patch', url, data, **kw)
    def _delete(self, url, data=None, **kw): return self._call('delete', url, data, **kw)
out = {}
for op in ('repeat-last-write', 'touch-other-record'):
    ns = {'requester': R()}
    exec(b.MUTANT_PRELUDE + b.MUTANT_OPS[op], ns)
    rq = ns['requester']
    rq._post('/venmo/payments/7', data={'access_token': 'T', 'amount': 5})
    rq._post('/supervisor/message', data={'message': 'done'})
    out[op] = rq.sent
print(json.dumps(out))`;
  const out = JSON.parse(execFileSync('/usr/bin/python3', ['-I', '-c', code], { encoding: 'utf8' }).trim());
  // repeat: the gold write, its authenticated replay, then completion
  assert.deepEqual(out['repeat-last-write'], [['post', '/venmo/payments/7', 'T', { amount: 5 }], ['post', '/venmo/payments/7', 'T', { amount: 5 }], ['post', '/supervisor/message', null, { message: 'done' }]]);
  // touch: the gold write, then the first neighbour (id 8) with the token, accepted, then completion
  assert.deepEqual(out['touch-other-record'].slice(0, 2), [['post', '/venmo/payments/7', 'T', { amount: 5 }], ['post', '/venmo/payments/8', 'T', { amount: 5 }]]);
  assert.equal(out['touch-other-record'].length, 3);
});

// ---- committed evidence matches the committed code ------------------------------------------------------------------
test('parity.json and bg8.json: produced by the committed code and passing', { skip: !existsSync(path.join(L.RESEARCH, 'parity.json')) && 'parity.json not written yet' }, () => {
  const pj = L.readJson(path.join(L.RESEARCH, 'parity.json'));
  assert.equal(pj.codeSha256, P.codeSha256(), 'the code that produced parity.json differs from the committed code: rerun parity.mjs');
  assert.equal(pj.splitSha256, split.splitSha256);
  for (const k of ['BG-0 install and data pinned', 'BG-1 gold 147/147 on both paths (verify.py settings)', 'gold under the arm settings: run.mjs = upstream', 'BG-2 null 0/147 on every path', 'docs-only replay 0/147',
    'parity: ours = upstream on every compared item', 'upstream evaluate_tasks on our snapshots agrees', 'BG-4 determinism']) assert.equal(pj.checks[k], true, k);
  const bg8 = L.readJson(path.join(L.RESEARCH, 'bg8.json'));
  assert.equal(bg8.pass, true);
  assert.equal(bg8.positiveControl.ok, true);
  assert.equal(bg8.codeSha256, LP.bg8CodeSha256(), 'the code that produced bg8.json differs from the committed code: rerun leakprobe.mjs');
});

// ---- integration (pinned venv and data) -----------------------------------------------------------------------------
test('BG-0: the install matches the pinned wheels and the unpacked app source', { skip: !HAVE_BED && 'AppWorld bench not installed' }, async () => {
  const v = await L.verifyInstall();
  assert.equal(v.pass, true, JSON.stringify(v).slice(0, 500));
  assert.equal(v.pinned, 80);
  assert.equal(v.unpackedManifestSha256, L.PIN.unpackedAppsManifestSha256);
});

test('public view holds no ground truth and no split lists', { skip: !HAVE_BED && 'AppWorld bench not installed' }, () => {
  const id = split.roles.devTrain[0];
  const pub = L.buildPublicView(path.join(TMP, 'pubcheck'), [id]);
  assert.ok(existsSync(path.join(pub, 'data/tasks', id, 'specs.json')));
  assert.ok(!existsSync(path.join(pub, 'data/tasks', id, 'ground_truth')));
  assert.ok(!existsSync(path.join(pub, 'data/datasets')));
  assert.ok(existsSync(path.join(pub, 'data/base_dbs')));
});

test('end to end through run.mjs: scripted gold passes, null fails, serve and grader agree on the post-state', { skip: !HAVE_BED && 'AppWorld bench not installed', timeout: 30 * 60_000 }, async () => {
  const id = split.pilotOrder[0];
  const log = () => {};
  const gold = await RUN.runUnits({ ids: [id], policy: 'gold', profile: 'arm', runId: 'test-gold', concurrency: 1, maxTurns: 0, maxExecutes: 1e9, timeoutMin: 20, outDir: null, log });
  const nul = await RUN.runUnits({ ids: [id], policy: 'null', profile: 'arm', runId: 'test-null', concurrency: 1, maxTurns: 0, maxExecutes: 1e9, timeoutMin: 20, outDir: null, log });
  assert.equal(gold.stopped, null, gold.stopped);
  const g = gold.results[0], n = nul.results[0];
  assert.equal(g.outcome.tgc, true); assert.equal(n.outcome.tgc, false);
  assert.equal(g.completed, true); assert.equal(n.completed, false);
  assert.equal(g.postDigest, g.verdict.gradedPostDigest);
  assert.equal(n.postDigest, n.preDigest);
  assert.ok(existsSync(path.join(g.hostDir, 'verdict.json')) && existsSync(path.join(g.hostDir, 'output', 'dbs')));
  assert.ok(!existsSync(path.join(L.LIVE_ROOT, 'test-gold')), 'live data is removed after the run');
});
