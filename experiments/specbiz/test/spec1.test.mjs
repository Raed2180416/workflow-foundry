// SPEC-1 / INTENT-1 runner at $0 (no model call, no network): build item 1 (no SPEC-E text reaches a derived solver's or
// agent's files, with controls that prove the checks have teeth), the derived build workspace (B1L-H's files with the
// pack instead of SPEC-E), the ask channel through the journaled ModelPort with the scripted Haiku stand-in, the owner's
// ledger review, the spend caps and the CLI's refusals. About 1-2 min on a loaded machine (sandboxed probe solvers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { createHost, bindItem } from '../../../beds/ebed/host/host.mjs';
import { smokeReport, clientInstructions } from '../../ebed/smoke-service.mjs';
import { buildFiles, taskText } from '../../ebed/build.mjs';
import { TICK_PROMPT } from '../../ebed/agent-arm.mjs';
import { agentVArm, VALIDATOR_PROMPT } from '../../agentv/arm.mjs';
import { dryRunner } from '../../agentv/run.mjs';
import { checkPortableSchema } from '../../../src/models/port.mjs';
import { renderPack } from '../render.mjs';
import { loadSpec, specUnits } from '../spec-units.mjs';
import { shingles, unitShingles } from '../leak.mjs';
import { createOwnerSim, replayOwnerSim, MATCH_JUDGMENT, stubMatcher } from '../owner-sim.mjs';
import { NO_MATCH_ANSWER, BUDGET_ANSWER, UNITS } from '../content.mjs';
import { ARMS, NO_SPEC_BINDING, DERIVE_ITEM, deriveFiles, deriveTaskText, derivePrompt, TASK_EDITS, ASK_SECTION, NO_ASK_SECTION, FORCED_ASK, PRIOR_SECTION, LEDGER_SECTION, SHOP_SECTION } from '../spec1-arms.mjs';
import { ASK_CLIENT, serveAsk, modelMatcher, scriptedPort, serialSim, restoredOwnerSim, matchPrompt, questionOf } from '../ask-service.mjs';
import { extractAndReview, scriptedExtraction, ownerReview, packText } from '../ledger-review.mjs';
import { packPrompt, packSessionRunner, scriptedPackSession, runNode, PACK_STEP, SPEC_STEP } from '../pack-agent.mjs';
import { reserveAll, settle, spendTotals, CapRefused, CAPS, gradeSolver, PACK_DIGESTS } from '../spec1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const HAIKU = 'claude-haiku-5-5';
const pack = renderPack({ seed: 1 });
const spec = loadSpec();
const SPEC_SHINGLES = shingles(spec.text);
const UNIT_SHINGLES = new Set(Object.values(unitShingles(specUnits(spec.text)).specific).flatMap(s => [...s]));
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'spec1-'));
const TINY = { seed: 1241, d: 2, size: 4, set: 'other' };

/** What SPEC-E text a set of files carries: the spec file itself, unit-specific shingles, and any SPEC-E shingle. */
function specIn(files) {
  const out = { specKey: Object.keys(files).filter(k => /spec/i.test(k)), unit: new Set(), any: new Set() };
  for (const [k, v] of Object.entries(files)) for (const s of shingles(String(v))) { if (UNIT_SHINGLES.has(s)) out.unit.add(k); if (SPEC_SHINGLES.has(s)) out.any.add(`${k} :: ${s}`); }
  return out;
}

test('build item 1: a host bound for a derived arm gives no SPEC-E text in ctx.files; E8\'s own binding does (the check has teeth)', async () => {
  assert.equal(bindItem(NO_SPEC_BINDING).specText, '');
  const seen = {};
  for (const [name, binding] of [['derived', NO_SPEC_BINDING], ['control', e8.binding]]) {
    const files = {};
    const arm = { id: 'probe', tick(input, ctx) { Object.assign(files, ctx.files); return { decisions: { subject: null }, effects: [], carry: null }; } };
    const w = e8.generateWorld({ seed: TINY.seed, difficulty: TINY.d, size: TINY.size });
    const { status } = await createHost({ item: binding, world: w, arm, maxWakeups: 2000 }).run();
    assert.equal(status, 'complete');
    seen[name] = specIn(Object.fromEntries(Object.entries(files).filter(([k]) => !k.startsWith('docs/') && !k.startsWith('sor/'))));
  }
  assert.deepEqual(seen.derived.specKey, [], 'no spec/ file');
  assert.deepEqual([...seen.derived.unit], [], 'no unit-specific SPEC-E shingle in any run-time file');
  assert.ok([...seen.derived.any].every(x => x.startsWith('api/')), `only API-schema phrases may match SPEC-E's platform zone: ${[...seen.derived.any].slice(0, 3)}`);
  assert.ok(seen.derived.any.size <= 10);
  assert.deepEqual(seen.control.specKey, ['spec/SPEC-E.md'], 'control: E8\'s binding writes spec/SPEC-E.md (host.mjs:435)');
  assert.ok(seen.control.unit.has('spec/SPEC-E.md') && seen.control.any.size > 1000);
});

// A sandboxed probe solver: it throws SAW-SPEC on any tick whose files hold SPEC-E (the file, or its rules heading).
const PROBE = `export function createSolver() { return { id: 'probe', tick(input, ctx) {
  const f = ctx.files ?? {};
  if (Object.keys(f).some(k => /spec/i.test(k)) || Object.values(f).some(v => String(v).includes('## 4. Rules'))) throw new Error('SAW-SPEC');
  return { decisions: { subject: null }, effects: [], carry: null };
} }; }`;

test('build item 1: the smoke loop and the grading run a derived solver (sandboxed) with no SPEC-E; with E8\'s binding the probe sees it', async () => {
  const practice = { seeds: [TINY.seed], difficulties: [TINY.d], size: TINY.size };
  const derived = await smokeReport(DERIVE_ITEM, PROBE, { practice });
  assert.doesNotMatch(derived.text, /SAW-SPEC/);
  assert.equal(derived.summary.worlds[0].armErrors, 0);
  const control = await smokeReport(e8, PROBE, { practice });
  assert.match(control.text, /SAW-SPEC/, 'control: the smoke service with E8\'s binding hands the spec to the solver');
  const [g] = await gradeSolver({ solverSource: PROBE, label: 'probe', worlds: [TINY], log: () => {} });
  assert.equal(g.armErrors, 0);
  const [gc] = await gradeSolver({ solverSource: PROBE, label: 'probe', worlds: [TINY], binding: e8.binding, log: () => {} });
  assert.ok(gc.armErrors > 0, 'control: grading with E8\'s binding hands the spec to the solver');
});

test('build items 1 and 3: agent sessions get the pack and never SPEC-E; ask works across sessions; with E8\'s binding the session refuses', async () => {
  const dir = tmp();
  try {
    const { port } = scriptedPort({ pack, journalFile: path.join(dir, 'j.sqlite'), modelId: HAIKU });
    const sim = serialSim(createOwnerSim({ pack, matcher: modelMatcher({ port, modelId: HAIKU, runId: 't' }) }));
    const run = async (binding, sub) => {
      const session = scriptedPackSession({ after: dryRunner, askOn: [1] });
      const arm = agentVArm({ id: 'a', model: HAIKU, workRoot: path.join(dir, sub), contract: 'CONTRACT', schemas: bindItem(NO_SPEC_BINDING).schemas, retries: 0,
        runner: packSessionRunner({ inner: session, pack, sim, askJournal: path.join(dir, `${sub}.ask.jsonl`) }), budgetUsdPerTick: 0.01, minutesPerTick: 1 });
      const w = e8.generateWorld({ seed: TINY.seed, difficulty: TINY.d, size: 3 });
      const host = createHost({ item: binding, world: w, arm, concurrency: 1, callTimeoutMs: 60_000, maxWakeups: 400 });
      const { status } = await host.run();
      return { status, session, errors: host.journal.contentRows().filter(r => r.type === 'arm.error') };
    };
    const ok = await run(NO_SPEC_BINDING, 'derived');
    assert.equal(ok.status, 'complete');
    assert.equal(ok.errors.length, 0);
    assert.ok(ok.session.seen.length >= 3 && ok.session.seen.every(s => s.pack && !s.spec && s.packStep && !s.specStep && s.ask));
    assert.match(ok.session.seen[0].answer, /Only Mara \(owner\) and Joost/);
    assert.equal(sim.journal().length, 1);
    const bad = await run(e8.binding, 'control');
    assert.ok(bad.errors.length > 0, 'control: with SPEC-E in ctx.files the pack runner refuses the session');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the derived build workspace: B1L-H\'s files with the pack instead of SPEC-E, byte-equal to the committed pack, no SPEC-E rule text outside it', () => {
  assert.equal(pack.digest, PACK_DIGESTS[1]);
  const committed = path.join(ROOT, 'research/intent-20261021/specbiz-pack-seed1/files');
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const disk = Object.fromEntries(walk(committed).map(f => [path.relative(committed, f), readFileSync(f, 'utf8')]));
  const b1lh = buildFiles(e8, { loop: 'smoke' });
  for (const arm of Object.keys(ARMS).filter(a => ARMS[a].kind === 'build')) {
    const f = deriveFiles(arm, pack, { ledgerMd: '# ledger\n' });
    assert.ok(!f['SPEC-E.md'] && !Object.keys(f).some(k => /spec/i.test(k)), arm);
    const biz = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith('business/')).map(([k, v]) => [k.slice('business/'.length), v]));
    assert.deepEqual(biz, disk, `${arm}: business/ is the committed pack`);
    for (const k of ['CONTRACT.md', 'smoke.mjs', ...Object.keys(b1lh).filter(x => x.startsWith('api/'))]) assert.equal(f[k], b1lh[k], `${arm}: ${k} as B1L-H`);
    const rest = Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('business/')));
    assert.deepEqual([...specIn(rest).unit], [], `${arm}: no SPEC-E rule text outside business/`);
    assert.doesNotMatch(f['TASK.md'], /SPEC-E\.md exactly|in SPEC-E\.md|the spec,/);
    assert.doesNotMatch(derivePrompt(arm, f), /Read SPEC-E/);
  }
});

test('TASK.md per arm: B1L-H\'s text with the listed edits and its smoke paragraph, plus the arm\'s sections', () => {
  const base = taskText(e8);
  for (const [from] of TASK_EDITS) assert.equal(base.split(from).length - 1, 1, from);
  const t = a => deriveTaskText(a);
  for (const a of ['derive', 'derive-ledger', 'derive-prior', 'no-ask', 'always-ask']) {
    assert.ok(t(a).startsWith(base.slice(0, base.indexOf('`tick` is called'))), a);
    assert.ok(t(a).includes(clientInstructions('smoke')) && t(a).includes(SHOP_SECTION), a);
  }
  assert.ok(t('derive').includes(ASK_SECTION) && !t('derive').includes(FORCED_ASK) && !t('derive').includes(PRIOR_SECTION) && !t('derive').includes(LEDGER_SECTION));
  assert.ok(t('no-ask').includes(NO_ASK_SECTION) && !t('no-ask').includes(ASK_SECTION) && !deriveFiles('no-ask', pack)['ask.mjs']);
  assert.ok(t('always-ask').includes(ASK_SECTION + FORCED_ASK));
  const prior = deriveFiles('derive-prior', pack)['PRIOR.md'];
  assert.ok(t('derive-prior').includes(PRIOR_SECTION) && /automation\/event \(n = 108\)/.test(prior) && /orchestration\/event \(n = 133\)/.test(prior) && /ask Mara, don't add it/.test(prior));
  assert.ok(t('derive-ledger').includes(LEDGER_SECTION));
  assert.throws(() => deriveFiles('derive-ledger', pack), /needs the reviewed ledger/);
  assert.throws(() => deriveTaskText('none-agent'), /not a build arm/);
});

test('the agent prompt: SPEC-E\'s step 1 becomes the pack step, the ask paragraph is added, everything else is AGENTV-E8\'s', () => {
  const p = TICK_PROMPT + VALIDATOR_PROMPT;
  const q = packPrompt(p);
  assert.ok(!q.includes(SPEC_STEP) && q.includes(PACK_STEP) && q.includes('node ask.mjs'));
  assert.ok(q.endsWith(VALIDATOR_PROMPT));
  assert.equal(packPrompt(p, { ask: false }), p.replace(SPEC_STEP, PACK_STEP));
  assert.throws(() => packPrompt('no step here'), /no SPEC-E step/);
});

test('ask channel: node ask.mjs -> mailbox -> owner simulator -> typed match through the journaled ModelPort (scripted Haiku stand-in)', async () => {
  const dir = tmp();
  try {
    checkPortableSchema(MATCH_JUDGMENT.schema);
    const { port, provider, db } = scriptedPort({ pack, journalFile: path.join(dir, 'journal.sqlite'), modelId: HAIKU });
    const matchLog = path.join(dir, 'match.jsonl');
    const sim = serialSim(createOwnerSim({ pack, matcher: modelMatcher({ port, modelId: HAIKU, runId: 'spec1-test', logFile: matchLog }) }));
    const work = path.join(dir, 'work');
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(work, 'ask.mjs'), ASK_CLIENT);
    const box = serveAsk({ workdir: work, sim, journalFile: path.join(dir, 'ask.jsonl'), pollMs: 100 });
    let r;
    try { r = await runNode(['ask.mjs', 'How do we handle orders that come in twice?'], work, { timeoutMs: 60_000 }); } finally { await box.stop(); }
    assert.equal(r.code, 0);
    const rec = pack.owner.records.find(x => x.id === 'R1.4');
    assert.equal(r.stdout.trim(), rec.answer);
    assert.equal(provider.calls.length, 1);
    const call = provider.calls[0];
    assert.equal(call.modelId, HAIKU);
    assert.deepEqual(call.schema, MATCH_JUDGMENT.schema);
    assert.equal(questionOf(call.prompt), 'How do we handle orders that come in twice?');
    for (const x of pack.owner.records) { assert.ok(call.prompt.includes(`- ${x.id}: ${x.title}`)); assert.ok(!call.prompt.includes(x.answer), `the judgment never sees answer ${x.id}`); }
    assert.equal(db.prepare('SELECT count(*) AS n FROM model_calls').get().n, 1, 'journaled before the result returned');
    const rows = readFileSync(path.join(dir, 'ask.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].match, ['R1.4']);
    assert.deepEqual(replayOwnerSim(pack, sim.journal()), { ok: true, mismatches: [] });
    assert.equal(JSON.parse(readFileSync(matchLog, 'utf8')).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed match judgment is a no-match for the owner, still charged, and logged', async () => {
  const dir = tmp();
  try {
    const { port } = scriptedPort({ pack, journalFile: path.join(dir, 'j.sqlite'), modelId: HAIKU, failOn: () => true });
    const sim = createOwnerSim({ pack, matcher: modelMatcher({ port, modelId: HAIKU, runId: 't', logFile: path.join(dir, 'm.jsonl') }) });
    assert.equal((await sim.ask('How do we handle orders that come in twice?')).answer, NO_MATCH_ANSWER);
    assert.equal(sim.remaining(), 19);
    const row = JSON.parse(readFileSync(path.join(dir, 'm.jsonl'), 'utf8'));
    assert.equal(row.ok, false);
    assert.ok(row.error);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent sessions: serialSim numbers questions in order; a restored simulator continues the journal exactly, the budget included', async () => {
  let calls = 0;
  const stub = stubMatcher(pack.owner.records);
  const matcher = async (q, l) => { calls += 1; await new Promise(r => setTimeout(r, 5)); return stub(q, l); };
  const sim = serialSim(createOwnerSim({ pack, matcher, maxQuestions: 4 }));
  const qs = ['How do we handle orders that come in twice?', 'Who decides how orders are handled?', 'What about the old app?'];
  const res = await Promise.all(qs.map(q => sim.ask(q)));
  assert.deepEqual(res.map(r => r.n), [1, 2, 3]);
  const rows = sim.journal();
  calls = 0;
  const restored = await restoredOwnerSim({ pack, rows, matcher, maxQuestions: 4 });
  assert.equal(calls, 0, 'the prefix replays from the journal ($0)');
  assert.deepEqual(restored.journal(), rows);
  assert.equal((await restored.ask('Is the draft fraud policy in force?')).n, 4);
  assert.equal(calls, 1);
  assert.equal((await restored.ask('one more?')).answer, BUDGET_ANSWER);
  const bad = structuredClone(rows); bad[1].answer = 'tampered';
  await assert.rejects(restoredOwnerSim({ pack, rows: bad, matcher, maxQuestions: 4 }), /replay differs at question 2/);
});

test('ledger review: stale wordings are corrected, the unauthorised e-mail is struck, current wordings confirmed (scripted extraction)', async () => {
  const dir = tmp();
  try {
    const { port } = scriptedPort({ pack, journalFile: path.join(dir, 'j.sqlite'), modelId: HAIKU, extraction: scriptedExtraction });
    const out = await extractAndReview({ port, modelId: HAIKU, pack, runId: 't' });
    assert.equal(out.failed, null);
    const { counts, entries } = out.review;
    assert.ok(counts.entries > 10 && counts.corrected >= 3 && counts.struck >= 1 && counts.confirmed > 0, JSON.stringify(counts));
    const overrides = Object.entries(pack.assignment.units).filter(([, u]) => u.carrier === 'override').map(([id]) => id);
    for (const id of overrides) {
      const e = entries.find(x => x.status === 'corrected' && x.records.includes(id));
      assert.ok(e, `the stale SOP wording of override ${id} is corrected`);
      assert.equal(e.answer, pack.owner.records.find(r => r.id === id).answer, 'with the owner\'s pre-rendered answer');
    }
    const ua = entries.find(x => x.status === 'struck');
    assert.equal(pack.fileCarrier[ua.file], 'unauthorised');
    assert.ok(entries.filter(x => x.status === 'confirmed').every(x => pack.fileCarrier[x.file] !== 'unauthorised' && pack.fileCarrier[x.file] !== 'distractor'));
    const ownerOnly = Object.entries(pack.assignment.units).filter(([, u]) => u.gold && u.carrier === 'owner').map(([id]) => id);
    assert.ok(!out.markdown.includes(UNITS[ownerOnly[0]].anchor), 'the review never adds an owner-only rule');
    assert.match(out.markdown, /Mara \(correction\)/);
    assert.match(out.markdown, /Mara \(struck\)/);
    // a ledger from another text is refused
    assert.throws(() => ownerReview(pack, { ...out.ledger, source: { sha256: 'x'.repeat(64) } }), /not extracted from this pack/);
    assert.ok(packText(pack).spans.length === Object.keys(pack.files).length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('spend caps: a lineage reserves all its bounds or none; unsettled reservations count at their bound, settled ones at the charge', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'spend.jsonl');
    const caps = { totalUsd: 5, arm: { derive: 4, 'no-ask': 4 } };
    const [a, b] = reserveAll(f, { arm: 'derive', label: 'l1', items: [{ kind: 'build-session', bound: 3 }, { kind: 'owner-matcher', bound: 0.3 }], caps });
    assert.equal(spendTotals(f).totalUsd, 3.3);
    assert.throws(() => reserveAll(f, { arm: 'derive', label: 'l2', items: [{ kind: 'build-session', bound: 3 }], caps }), CapRefused);
    settle(f, a, 0.5); settle(f, b, 0.01);
    assert.equal(spendTotals(f).totalUsd, 0.51);
    reserveAll(f, { arm: 'derive', label: 'l2', items: [{ kind: 'build-session', bound: 3 }], caps });
    assert.throws(() => reserveAll(f, { arm: 'no-ask', label: 'n1', items: [{ kind: 'build-session', bound: 3 }], caps }), /total cap \$5/);
    const before = readFileSync(f, 'utf8');
    assert.throws(() => reserveAll(f, { arm: 'no-ask', label: 'n1', items: [{ kind: 'build-session', bound: 1 }, { kind: 'x', bound: 3 }], caps }), CapRefused);
    assert.equal(readFileSync(f, 'utf8'), before, 'a refused lineage writes nothing');
    assert.equal(CAPS.totalUsd, 25);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI refuses a paid run before any session: draft prereg, model, question budget, arm; a dry run over its cap exits 4 having spent nothing', () => {
  const node = args => spawnSync(process.execPath, [path.join(here, '..', 'spec1.mjs'), ...args], { encoding: 'utf8', timeout: 120_000 });
  const H = ['--model', 'claude-haiku-5-5'];
  assert.match(node(['--arm', 'nope']).stderr, /--arm must be one of/);
  assert.match(node(['--arm', 'derive']).stderr, /--model must be a policy model id/, 'a paid run names its model');
  assert.match(node(['--arm', 'derive', '--model', 'claude-sonnet-5-5']).stderr, /B1L-H conditions: --model claude-haiku-5-5/);
  assert.match(node(['--arm', 'derive', ...H, '--budget', '10']).stderr, /preregistered at 20/);
  assert.match(node(['--arm', 'derive', '--model', 'gpt-4o']).stderr, /policy model id/);
  assert.match(node(['--arm', 'derive', ...H, '--worlds', 'shared']).stderr, /preregistered worlds, concurrency and caps: remove --worlds/);
  assert.match(node(['--arm', 'none-agent', ...H, '--concurrency', '8']).stderr, /remove --concurrency/);
  assert.match(node(['--arm', 'derive', ...H]).stderr, /PREREG-SPEC1.md is a draft|no preregistration/);
  assert.match(node(['--arm', 'none-agent', ...H, '--pack-seed', '1', '--lineages', '2', '--budget', '20']).stderr, /PREREG-SPEC1.md is a draft|no preregistration/);
  const dir = tmp();
  try {
    const r = node(['--arm', 'derive', '--dry', '--lineage', '1', '--root', dir, '--arm-cap', '2']);
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /derive cap \$2/);
    assert.ok(!existsSync(path.join(dir, 'runs', 'spend.jsonl')) || readFileSync(path.join(dir, 'runs', 'spend.jsonl'), 'utf8') === '');
    assert.ok(!existsSync(path.join(dir, 'work')), 'no workdir was created');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the frozen-file table lists files that exist, and a draft prereg is refused', async () => {
  const { table, preregCheck, FROZEN } = await import('../spec1-freeze.mjs');
  const rows = table();
  assert.equal(rows.length, FROZEN.length);
  assert.ok(rows.every(r => /^[0-9a-f]{64}  /.test(r)), rows.find(r => !/^[0-9a-f]{64}  /.test(r)));
  assert.throws(() => preregCheck(), /draft|no preregistration/);
  const dir = tmp();
  try {
    const f = path.join(dir, 'P.md');
    writeFileSync(f, `**Status: FROZEN**\n\n${rows.join('\n')}\n`);
    assert.equal(preregCheck(f).files, FROZEN.length);
    writeFileSync(f, `**Status: FROZEN**\n\n${rows.slice(1).join('\n')}\n`);
    assert.throws(() => preregCheck(f), /does not list every frozen file/);
    writeFileSync(f, `**Status: FROZEN**\n\n${['0'.repeat(64) + rows[0].slice(64), ...rows.slice(1)].join('\n')}\n`);
    assert.throws(() => preregCheck(f), /changed since the prereg/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
