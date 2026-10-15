// AGENTV-E8 at $0: the validator, the arm (scripted sessions, no model), the §12 meter and the resumable runner.
// Run alone: node --test --test-concurrency=1 experiments/agentv/test/agentv.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { createHost, bindItem } from '../../../beds/ebed/host/host.mjs';
import { validateCaseOutput } from '../../../beds/ebed/host/output.mjs';
import { contractText } from '../../ebed/build.mjs';
import { TICK_PROMPT } from '../../ebed/agent-arm.mjs';
import { validateDraft, MERGE_NOTE } from '../validator.mjs';
import { agentVArm, VALIDATOR_PROMPT } from '../arm.mjs';
import { makeMeter, runWorldV, preregBanner, mcnemarExact, paired, validatorStats, PREREG_FILE } from '../run.mjs';
import { conformance, AGENTH_JOURNAL } from '../conformance.mjs';
import { summarize } from '../../ebed/run-agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const SCHEMAS = bindItem(e8.binding).schemas;
const PRICES = JSON.parse(readFileSync(path.join(ROOT, 'research/need-router-20261014/prereg/stages.json'), 'utf8')).priceTable;
const BATCH = 'a batch op keys its items, not the batch';
const CLOSE = 'close: must be true when present';
const tmp = p => mkdtempSync(path.join(os.tmpdir(), `agentv-${p}-`));

// The two observed error classes (B1-E8-DEV: 25 of agent-H's 27 invalid outputs keyed the inventory.reserve batch; 2 put
// close: false), on otherwise well-formed outputs.
const reserve = (subject, batchKey) => ({ ...(batchKey ? { key: `${subject}-F1:reserve` } : {}), system: 'inventory', op: 'reserve',
  args: { orderId: subject, fulfilmentId: `${subject}-F1`, location: 'WH-RTM', items: [{ key: `${subject}-F1:reserve:SKU-1`, sku: 'SKU-1', qty: 1 }] } });
const good = subject => ({ decisions: { subject }, effects: [{ key: `${subject}:create`, system: 'orders', op: 'create', args: { orderId: subject } }, reserve(subject, false)], carry: { subject } });

test('validator: flags both observed error classes in the host\'s own words, and passes a well-formed output', () => {
  const v = d => validateDraft(d, { schemas: SCHEMAS, self: 'i-000001', openInstances: [] });
  assert.deepEqual(v(good('O1')), { valid: true, problems: [], notes: [] });
  const batchKeyed = { ...good('O1'), effects: [good('O1').effects[0], reserve('O1', true)] };
  assert.deepEqual(v(batchKeyed).problems, [`effects[1].key: ${BATCH}`]);
  assert.deepEqual(v({ ...good('O1'), close: false }).problems, [CLOSE]);
  assert.deepEqual(v({ ...batchKeyed, close: false }).problems, [`effects[1].key: ${BATCH}`, CLOSE]);
  assert.equal(v({ ...good('O1'), close: true }).valid, true);
  assert.deepEqual(v({ decisions: {}, carry: null }).problems, ['decisions.subject: required, a business key or null']);
  assert.deepEqual(v({ decisions: { subject: null } }).problems, ['carry: required (null for none)']);
  // The same words the host gives at commit (same function, same item schemas).
  const host = validateCaseOutput({ ...batchKeyed, close: false }, { schemas: SCHEMAS, round: 1, inbound: true, instances: new Map(), self: 'i-000001' });
  assert.deepEqual(v({ ...batchKeyed, close: false }).problems, host.errors);
});

test('validator: merge is checked as far as the arm can see (self, open target) and is never refused on round or inbound', () => {
  const m = (into, open) => validateDraft({ decisions: { subject: 'O1' }, merge: { into }, carry: null }, { schemas: SCHEMAS, self: 'i-000002', openInstances: open });
  assert.deepEqual(m('i-000002', [{ instance: 'i-000001' }]).problems, ['merge: into itself']);
  assert.deepEqual(m('i-000009', [{ instance: 'i-000001' }]).problems, ['merge: target is not an open instance']);
  const ok = m('i-000001', [{ instance: 'i-000001' }]);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.notes, [MERGE_NOTE]);
  assert.equal(m('i-000001', null).valid, true, 'unknown open set: permissive');
});

test('validator conformance on the recorded agent-H s12 run: every host refusal flagged, no false refusal, identical text', { skip: !existsSync(AGENTH_JOURNAL) && 'agent-H s12 journal not on this machine' }, () => {
  const rows = readFileSync(AGENTH_JOURNAL, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const c = conformance(rows, SCHEMAS);
  assert.equal(c.calls, 143);
  assert.equal(c.hostRefused, 27);
  assert.equal(c.flaggedRefused, 27);
  assert.equal(c.flaggedAccepted, 0);
  assert.equal(c.exactProblemText, c.calls, JSON.stringify(c.disagreements.slice(0, 2)));
  assert.deepEqual(Object.keys(c.refusedClasses).sort(), [CLOSE, `effects[i].key: ${BATCH}`].sort());
});

// Static import closure (relative specifiers; node: builtins and packages skipped). Dynamic import() is refused outright.
function importClosure(entry) {
  const seen = new Set(), stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('.')) stack.push(path.resolve(path.dirname(f), spec));
    }
  }
  return [...seen].map(f => path.relative(ROOT, f));
}

test('no oracle import: the validator and the arm never reach the oracle, the reference transition, the grader or the item module', () => {
  const v = importClosure(path.join(ROOT, 'experiments/agentv/validator.mjs'));
  assert.deepEqual(v.sort(), ['beds/ebed/host/output.mjs', 'beds/ebed/host/schema.mjs', 'beds/ebed/host/time.mjs', 'beds/lib/canonical.mjs', 'experiments/agentv/validator.mjs'].sort());
  const a = importClosure(path.join(ROOT, 'experiments/agentv/arm.mjs'));
  const banned = a.filter(f => /^beds\/ebed\/(oracle|e8|e7)\//.test(f) || /transition|golden|grade|oracle|referenc|controls|defects|metamorphic|run-agent|run\.mjs$/.test(f));
  assert.deepEqual(banned, []);
  for (const f of ['validator.mjs', 'arm.mjs']) assert.doesNotMatch(readFileSync(path.join(ROOT, 'experiments/agentv', f), 'utf8'), /\bimport\s*\(/);
});

/** Run `node <args>` in dir (as the agent's Bash tool would); resolves { code, out }. */
const runNode = (dir, args) => new Promise((res, rej) => {
  const c = spawn(process.execPath, args, { cwd: dir });
  let out = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
  c.on('error', rej); c.on('close', code => res({ code, out }));
});

/**
 * A scripted agent (no model). mode 'uses-validator': drafts the two observed errors, runs validate.mjs, fixes what it
 * reports, checks again, writes output.json. mode 'ignores': writes the erroneous output straight to output.json unless
 * its prompt carries a refusal (then behaves as 'uses-validator'). mode 'never-fixes': always writes the erroneous output.
 * The reserve effect goes out only on an instance's first tick (no carry), so effect results cannot chain forever.
 */
function scripted(mode, log) {
  return async ({ workdir, prompt, budgetUsd }) => {
    const input = JSON.parse(readFileSync(path.join(workdir, 'task.json'), 'utf8'));
    for (const f of ['CONTRACT.md', 'ctx.mjs', 'validate.mjs']) assert.ok(existsSync(path.join(workdir, f)), f);
    const placed = input.events.find(e => e.payload?.orderId);
    const subject = placed?.payload?.orderId ?? input.carry?.subject ?? null;
    const first = input.carry === null;
    const bad = { decisions: { subject }, effects: first ? [reserve(subject ?? 'none', true)] : [], close: false, carry: { subject } };
    const fixed = { decisions: { subject }, effects: first ? [reserve(subject ?? 'none', false)] : [], carry: { subject } };
    const isRetry = /rejected-output\.json/.test(prompt);
    const entry = { instance: input.instance, isRetry, prompt, budgetUsd, checks: [], rejectedSeen: existsSync(path.join(workdir, 'rejected-output.json')) };
    if (mode === 'uses-validator' || (mode === 'ignores' && isRetry)) {
      writeFileSync(path.join(workdir, 'draft.json'), JSON.stringify(bad));
      entry.checks.push(await runNode(workdir, ['validate.mjs', 'draft.json']));
      writeFileSync(path.join(workdir, 'draft.json'), JSON.stringify(fixed));
      entry.checks.push(await runNode(workdir, ['validate.mjs', 'draft.json']));
      writeFileSync(path.join(workdir, 'output.json'), JSON.stringify(fixed));
    } else writeFileSync(path.join(workdir, 'output.json'), JSON.stringify(bad));
    log.push(entry);
    return { costUsd: 0.01, turns: 3, error: null, streamUsage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 } };
  };
}
const fakeCtx = (costs = []) => ({ files: {}, recordCost: c => costs.push(c), query() { return []; }, status() { return 'not-found'; }, instances() { return []; } });
const tickInput = (instance, carry = null) => ({ kind: 'case', item: 'ebed-e8', instance, now: '2026-03-02T00:00:00+01:00', events: [{ id: 'e1', type: 'order.placed', payload: { orderId: 'ORD-1' } }], carry });

test('arm on a real host: the session reaches validate.mjs through the mailbox, sees the host\'s words, fixes, and no output is refused', async () => {
  const work = tmp('host'), log = [];
  const valJournal = path.join(work, 'validator.jsonl'), ticks = path.join(work, 'ticks.jsonl');
  const arm = agentVArm({ id: 'agent-HV-test', model: 'claude-haiku-5-5', workRoot: path.join(work, 'w'), contract: contractText(), runner: scripted('uses-validator', log),
    journal: ticks, validatorJournal: valJournal, schemas: SCHEMAS, budgetUsdPerTick: 0.4 });
  const w = e8.generateWorld({ seed: 1235, difficulty: 2, mix: 'tail', size: 4 });
  const host = createHost({ item: e8.binding, world: w, arm, callTimeoutMs: 60_000, maxWakeups: 400 });
  const r = await host.run();
  assert.equal(r.status, 'complete');
  const rows = host.journal.contentRows(), calls = rows.filter(x => x.type === 'call');
  assert.ok(calls.length >= 4 && calls.length === log.length, `${calls.length} calls, ${log.length} sessions`);
  assert.equal(rows.filter(x => x.type === 'arm.error').length, 0, JSON.stringify(rows.find(x => x.type === 'arm.error')));
  assert.ok(log.every(l => l.prompt.startsWith(TICK_PROMPT) && l.prompt.includes(VALIDATOR_PROMPT) && !l.isRetry && l.budgetUsd === 0.4));
  // First check: INVALID with the host's words (both classes on a first tick); second: VALID.
  for (const l of log) {
    assert.equal(l.checks[0].code, 1); assert.match(l.checks[0].out, /^INVALID/m); assert.ok(l.checks[0].out.includes(CLOSE));
    assert.equal(l.checks[1].code, 0, l.checks[1].out); assert.match(l.checks[1].out, /^VALID/m);
  }
  assert.ok(log.some(l => l.checks[0].out.includes(`effects[0].key: ${BATCH}`)));
  const v = readFileSync(valJournal, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(v.length, calls.length);
  assert.ok(v.every(x => x.validateCalls === 2 && x.validateInvalid === 1 && x.retries === 0 && x.final === 'valid' && x.sessions.length === 1));
  const s = validatorStats(v);
  assert.equal(s.ticksUsingValidator, calls.length);
  assert.ok(s.inSessionProblemClasses[CLOSE] >= calls.length && s.inSessionProblemClasses[`effects[i].key: ${BATCH}`] >= 1);
  assert.ok(calls.every(c => c.costs.length === 1 && c.costs[0].costUsd === 0.01));
  assert.equal(readFileSync(ticks, 'utf8').trim().split('\n').length, calls.length, 'agent-H\'s own tick journal is kept');
});

test('pre-commit gate: an output the host would refuse gets one retry carrying the refusal text; the fixed output is what the host gets', async () => {
  const work = tmp('gate'), log = [], costs = [], vj = path.join(work, 'v.jsonl');
  const arm = agentVArm({ id: 'g', model: 'claude-haiku-5-5', workRoot: work, contract: 'c', runner: scripted('ignores', log), schemas: SCHEMAS, validatorJournal: vj });
  const out = await arm.tick(tickInput('i-000001'), fakeCtx(costs));
  assert.equal(log.length, 2);
  assert.equal(log[0].isRetry, false);
  assert.ok(log[1].isRetry && log[1].rejectedSeen, 'the retry sees its refused output as rejected-output.json');
  assert.ok(log[1].prompt.includes(`- effects[0].key: ${BATCH}`) && log[1].prompt.includes(`- ${CLOSE}`), 'the refusal text, verbatim');
  assert.deepEqual(validateCaseOutput(out, { schemas: SCHEMAS, round: 1, inbound: true, instances: new Map(), self: 'i-000001' }).errors, []);
  assert.equal(costs.length, 2, 'both sessions are recorded');
  assert.equal(costs[0].refusedByGate, true);
  const [row] = readFileSync(vj, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(row.retries, 1); assert.equal(row.final, 'valid'); assert.equal(row.gates[0].kind, 'invalid'); assert.equal(row.sessions.length, 2);
});

test('the wrapper never repairs: an output still refused after the retry goes to the host unchanged; retries 0 means one session', async () => {
  for (const retries of [1, 0]) {
    const log = [], costs = [];
    const arm = agentVArm({ id: 'n', model: 'claude-haiku-5-5', workRoot: tmp('never'), contract: 'c', runner: scripted('never-fixes', log), schemas: SCHEMAS, retries });
    const out = await arm.tick(tickInput('i-000001'), fakeCtx(costs));
    assert.equal(log.length, 1 + retries);
    assert.equal(out.close, false);
    assert.equal(out.effects[0].key, 'ORD-1-F1:reserve', 'the batch key is still there: the host will refuse it');
    assert.deepEqual(validateCaseOutput(out, { schemas: SCHEMAS, round: 1, inbound: true, instances: new Map(), self: 'i-000001' }).errors, [`effects[0].key: ${BATCH}`, CLOSE]);
    assert.equal(costs.length, 1 + retries);
  }
});

test('an environment fault is not retried; a session that throws still settles its reservation at the bound', async () => {
  const calls = [];
  const arm = agentVArm({ id: 'env', model: 'claude-haiku-5-5', workRoot: tmp('env'), contract: 'c', schemas: SCHEMAS,
    runner: async () => { calls.push(1); return { costUsd: null, error: { code: 'MODEL_RATE_LIMIT' } }; } });
  await assert.rejects(arm.tick(tickInput('i-000001'), fakeCtx()), /no output\.json/);
  assert.equal(calls.length, 1);
  const dir = tmp('throw');
  const meter = makeMeter({ capUsd: 5, stage: 's', spendFile: path.join(dir, 'spend.jsonl'), priceTable: PRICES });
  const arm2 = agentVArm({ id: 't', model: 'claude-haiku-5-5', workRoot: path.join(dir, 'w'), contract: 'c', schemas: SCHEMAS, meter, budgetUsdPerTick: 0.4,
    runner: async () => { throw Object.assign(new Error('no sandbox'), { code: 'SANDBOX_UNAVAILABLE' }); } });
  await assert.rejects(arm2.tick(tickInput('i-000001'), fakeCtx()), /no sandbox/);
  assert.equal(meter.budget.reservedUsd, 0);
  assert.equal(meter.budget.spentUsd, 0.4);
});

test('§12 meter: bound reserved before launch, a start that does not fit is a QuotaStop, unknown cost at its bound, resume from the ledger', () => {
  const dir = tmp('meter'), spendFile = path.join(dir, 'spend.jsonl');
  const m = makeMeter({ capUsd: 1, stage: 'agentv-test', spendFile, priceTable: PRICES });
  const info = a => ({ model: 'claude-haiku-5-5', bound: 0.4, instance: 'i-1', now: 'n', attempt: a });
  for (let a = 1; a <= 4; a++) { const t = m.before(info(a)); assert.equal(m.after(t, { costUsd: 0.2, streamUsage: null }), 0.2); }
  assert.ok(Math.abs(m.budget.spentUsd - 0.8) < 1e-9);
  assert.throws(() => m.before(info(5)), e => e.quota === true && /cap \$1/.test(e.message));
  // Resume: what was spent is on the meter; a reservation left unsettled (the process died in flight) counts at its bound.
  const m2 = makeMeter({ capUsd: 3, stage: 'agentv-test', spendFile, priceTable: PRICES });
  assert.ok(Math.abs(m2.prior.totalUsd - 0.8) < 1e-9);
  m2.before(info(6));
  const m3 = makeMeter({ capUsd: 3, stage: 'agentv-test', spendFile, priceTable: PRICES });
  assert.ok(Math.abs(m3.prior.totalUsd - 1.2) < 1e-9);
  const t = m3.before(info(7));
  assert.equal(m3.after(t, { costUsd: null, error: { code: 'EXECUTOR_TIMEOUT' } }), 0.4, 'a timeout is charged its bound');
  // max(reported, re-priced): a session whose tokens price above its report is charged the re-price.
  const t2 = m3.before(info(8));
  const charged = m3.after(t2, { costUsd: 0.0001, streamUsage: { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  assert.ok(Math.abs(charged - 0.05) < 1e-9, `charged ${charged}`);
});

test('runner: a run stopped mid-world resumes from its journal and ends where an uninterrupted run ends', async () => {
  const opts = { seed: 1235, d: 2, size: 4, concurrency: 2, callTimeoutMs: 60_000 };
  const armFor = (meter, log) => workRoot => agentVArm({ id: 'agentv-resume', model: 'claude-haiku-5-5', workRoot, contract: 'c', runner: scripted('ignores', log), schemas: SCHEMAS, meter, budgetUsdPerTick: 0.1 });
  // Uninterrupted reference.
  const refDir = tmp('ref'), refLog = [];
  const ref = await runWorldV({ ...opts, liveDir: refDir, armFor: armFor(makeMeter({ capUsd: 100, stage: 'r', spendFile: path.join(refDir, 'spend.jsonl'), priceTable: PRICES }), refLog) });
  assert.equal(ref.status, 'complete');
  const refSum = summarize(ref.world, ref.host.journal.contentRows(), ref.pools, 'agentv-resume');
  // Interrupted: a cap that binds part-way (each tick is two sessions at $0.01, bound $0.1).
  const dir = tmp('resume'), spendFile = path.join(dir, 'spend.jsonl'), log1 = [], log2 = [];
  const first = await runWorldV({ ...opts, liveDir: dir, armFor: armFor(makeMeter({ capUsd: 0.4, stage: 's', spendFile, priceTable: PRICES }), log1) });
  assert.equal(first.status, 'frozen');
  assert.ok(existsSync(first.journalFile));
  const m2 = makeMeter({ capUsd: 100, stage: 's', spendFile, priceTable: PRICES });
  assert.ok(m2.prior.totalUsd > 0.2, `resumed meter starts at ${m2.prior.totalUsd}`);
  const second = await runWorldV({ ...opts, liveDir: dir, armFor: armFor(m2, log2) });
  assert.equal(second.resumed, true);
  assert.equal(second.status, 'complete');
  assert.ok(log2.length < refLog.length, `the committed prefix replayed at $0 (${log2.length} live sessions after resume, ${refLog.length} uninterrupted)`);
  const sum = summarize(second.world, second.host.journal.contentRows(), second.pools, 'agentv-resume');
  for (const k of ['completed', 'passed', 'armErrors', 'ticks', 'critical']) assert.equal(sum[k], refSum[k], k);
  assert.deepEqual(sum.byClass, refSum.byClass);
  assert.equal(sum.armErrors, 0);
});

test('preregistration banner is required and carries the MDE, the prediction and the refutation; paired statistics', () => {
  const b = preregBanner();
  assert.match(b.text, /MDE/); assert.match(b.text, /PREDICTION/); assert.match(b.text, /REFUTED/); assert.match(b.text, /cap \$5/);
  assert.match(b.sha256, /^[0-9a-f]{64}$/);
  const f = path.join(tmp('pre'), 'P.md'); writeFileSync(f, '# no banner\n');
  assert.throws(() => preregBanner(f), /no prereg-banner/);
  assert.throws(() => preregBanner(path.join(tmp('pre2'), 'missing.md')), /no preregistration/);
  assert.ok(existsSync(PREREG_FILE));
  assert.equal(mcnemarExact(4, 0), 0.125); assert.equal(mcnemarExact(5, 0), 0.0625); assert.equal(mcnemarExact(6, 0), 0.03125); assert.equal(mcnemarExact(0, 0), 1);
  const A = [{ case: 'a', pass: true }, { case: 'b', pass: true }, { case: 'c', pass: false }, { case: 'd', pass: false }];
  const B = [{ case: 'a', pass: true }, { case: 'b', pass: false }, { case: 'c', pass: true }, { case: 'd', pass: false }];
  const p = paired(A, B);
  assert.deepEqual([p.n, p.both, p.aOnly, p.bOnly, p.neither], [4, 1, 1, 1, 1]);
  mkdirSync(tmp('x'), { recursive: true });
});
