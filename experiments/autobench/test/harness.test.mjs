// Tests for arm A1, the Foundry harness (experiments/autobench/harness, run.mjs --harness foundry) and the host-side
// step accounting both arms use (accounting.mjs). No model is called anywhere ($0).
//   node --test experiments/autobench/test/harness.test.mjs
// The end-to-end tests need the AutomationBench venv and skip without it; the sandboxed one also needs user namespaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, VENV_PY, adapterText, listTasks, readJson } from '../lib.mjs';
import { DEFAULTS, TEST_RUN_TOKEN, runTasks } from '../run.mjs';
import { auditSession, commandFlags, sessionResponses, worldUsage } from '../accounting.mjs';
import { LEDGER_FILE, SECTION_BEGIN, SECTION_END, collectLedger, harnessConfig, harnessManifest, harnessSection, harnessSystemPrompt, ledgerStats, manifestFiles, policyEntries, writeCliGuard } from '../harness/foundry.mjs';
import { scriptedHarnessRunner } from '../harness/scripted-session.mjs';
import { procedureScript } from '../harness/smoke.mjs';
import { runClaudeCode, sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadSplit } from '../split.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-h-${p}-`));
const HAVE_VENV = existsSync(VENV_PY);
const quiet = () => {};
const PHONE_TASK = 'simple.email_sf_contact_phone_update';
const CAT = [{ name: 'api_fetch', description: 'Call an API endpoint', parameters: { type: 'object' } }];

// ---------------------------------------------------------------------------------------------------------------
// The prompt: official text verbatim + A0's tool section + one delimited, task-agnostic harness section.

test('harness section: delimited, identical for every task, no grading vocabulary, no domain or app names', () => {
  const s = harnessSection({ maxSteps: 50 });
  assert.ok(s.startsWith(SECTION_BEGIN + '\n') && s.endsWith('\n' + SECTION_END));
  assert.equal(s.split(SECTION_BEGIN).length, 2);
  assert.match(s, /At most 49 such responses run/);
  assert.match(s, new RegExp(LEDGER_FILE.replace('.', '\\.')));
  for (const phase of ['Discover (read only)', 'Requirement ledger', 'Plan', 'Act', 'Verify', 'Stop']) assert.ok(s.includes(phase), phase);
  // Nothing about grading, and nothing domain-, app- or task-specific.
  assert.doesNotMatch(s, /assert|rubric|grade|grading|score|partial.credit|task_name|oracle|benchmark|automationbench/i);
  assert.doesNotMatch(s, /\b(sales|marketing|operations|finance|hr|crm|contacts?|gmail|slack|salesforce|hubspot|zendesk|jira|quickbooks|xero|stripe|notion|confluence|calendar|invoice|ticket|deal|lead|currency|EUR|USD)\b/i);
  // Only the step limit (a protocol constant) varies.
  assert.equal(harnessSection({ maxSteps: 50 }), s);
  assert.equal(harnessSection({ maxSteps: 4 }).replace('At most 3 such', 'At most 49 such'), s);
});

test('A1 system prompt = official system prompt verbatim + A0 tool section + harness section, in that order', () => {
  const official = 'You are a workflow automation agent. Execute the requested tasks using the available tools.';
  const p = harnessSystemPrompt(official, CAT, 50);
  assert.equal(p, `${official}\n\n${adapterText(CAT, 50)}\n\n${harnessSection({ maxSteps: 50 })}`);
  assert.ok(p.startsWith(official + '\n\n## Tools in this environment'));
  assert.ok(p.endsWith(SECTION_END));
  assert.throws(() => harnessSystemPrompt('', CAT, 50), /official system prompt/);
});

test('dry run (A0 vs A1, same task): A0 prompt unchanged; A1 = A0 + the harness section; user message identical', { skip: !HAVE_VENV && 'AutomationBench venv missing' }, async () => {
  const live = tmp('dry');
  const a0 = (await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], dryRun: true, runner: async () => ({}), liveRoot: path.join(live, 'a0'), outDir: null, log: quiet })).summary;
  const a1 = (await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], dryRun: true, harness: 'foundry', runner: async () => ({}), liveRoot: path.join(live, 'a1'), outDir: null, log: quiet })).summary;
  const prep = path.join(live, 'a0', 'prep', PHONE_TASK);
  const official = readJson(path.join(prep, 'prompt.json')), cat = readJson(path.join(prep, 'catalog.json'));
  assert.equal(a0.systemPrompt, `${official.system}\n\n${adapterText(cat, 50)}`);
  assert.equal(a1.systemPrompt, `${a0.systemPrompt}\n\n${harnessSection({ maxSteps: 50 })}`);
  assert.equal(a1.user, official.user);
  assert.equal(a0.user, official.user);
  // What the harness adds carries no task identity and no grading data: no assertion type anywhere after the official
  // system prompt, and no assertion value in the harness section (the tool section and catalog are A0's, from the env).
  const added = a1.systemPrompt.slice(official.system.length), section = a1.systemPrompt.slice(a0.systemPrompt.length);
  const info = JSON.parse(readJson(path.join(prep, 'input.json')).info);
  const values = new Set();
  const walk = v => { if (typeof v === 'string' && v.length >= 6) values.add(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  const types = new Set(info.assertions.map(a => a.type));
  info.assertions.forEach(a => { const { type, ...rest } = a; walk(rest); });
  assert.ok(types.size > 0 && values.size > 0);
  for (const t of types) assert.ok(!added.includes(t), `assertion type reachable from the session: ${t}`);
  for (const v of values) assert.ok(!section.includes(v), `assertion value in the harness section: ${v}`);
  assert.ok(!a1.systemPrompt.includes(PHONE_TASK) && !a1.user.includes(PHONE_TASK));
});

test('L1: no public task name in any file of the A1 manifest', { skip: !HAVE_VENV && 'AutomationBench venv missing' }, async () => {
  const names = (await listTasks(['sales', 'marketing', 'operations', 'support', 'finance', 'hr', 'simple'], { liveDir: tmp('l1') })).map(t => t.task);
  assert.equal(names.length, 800);
  const files = manifestFiles();
  assert.ok(files.includes('experiments/autobench/harness/foundry.mjs') && files.includes('experiments/autobench/accounting.mjs') && files.includes('experiments/autobench/run.mjs'));
  const hits = files.flatMap(f => { const text = readFileSync(path.join(REPO, f), 'utf8'); return names.filter(n => text.includes(n)).map(n => `${f}: ${n}`); });
  assert.deepEqual(hits, []);
});

test('manifest: covers what run.mjs loads; the hash pins files and settings', () => {
  const files = manifestFiles();
  for (const f of ['experiments/autobench/run.mjs', 'experiments/autobench/lib.mjs', 'experiments/autobench/split.mjs', 'experiments/autobench/bridge.py', 'experiments/autobench/tool.mjs',
    'experiments/autobench/accounting.mjs', 'experiments/autobench/harness/foundry.mjs', 'src/executors/claude-code.mjs', 'src/models/policy.mjs', 'src/data.mjs']) assert.ok(files.includes(f), f);
  const cfg = harnessConfig({ ...DEFAULTS, model: 'claude-haiku-5-5', effort: 'high', cliMaxTurns: 49, cli: null });
  const a = harnessManifest(cfg), b = harnessManifest(cfg);
  assert.equal(a.sha256, b.sha256);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(harnessManifest({ ...cfg, effort: 'low' }).sha256, a.sha256);
  assert.notEqual(harnessManifest({ ...cfg, cliMaxTurns: 48 }).sha256, a.sha256);
  // §7 / H8: the config pins the policy entries the run uses, the CLI child environment, the corpus and the knowledge.
  assert.equal(cfg.policy.model.id, 'claude-haiku-5-5');
  assert.equal(cfg.policy.provider.kind, 'claude-cli');
  assert.deepEqual(Object.keys(cfg.childEnv).sort(), ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_AUTOUPDATER', 'DISABLE_ERROR_REPORTING', 'DISABLE_TELEMETRY', 'FORCE_PROMPT_CACHING_5M']);
  assert.ok(cfg.knowledge.length >= 1);
  assert.notEqual(harnessManifest({ ...cfg, childEnv: { ...cfg.childEnv, FORCE_PROMPT_CACHING_5M: cfg.childEnv.FORCE_PROMPT_CACHING_5M === '1' ? null : '1' } }).sha256, a.sha256);
  assert.notEqual(harnessManifest({ ...cfg, corpus: { ...cfg.corpus, commit: '0'.repeat(40) } }).sha256, a.sha256);
  // An edit elsewhere in the policy file leaves the hash alone; an edit to the run's model entry changes it.
  const dir = tmp('pol');
  const pol = JSON.parse(readFileSync(path.join(REPO, 'policy/models.json'), 'utf8'));
  writeFileSync(path.join(dir, 'other.json'), JSON.stringify({ ...pol, policyVersion: 'x', notes: [...(pol.notes ?? []), 'unrelated'], models: [...pol.models, { id: 'other-model', provider: 'claude-cli' }] }));
  writeFileSync(path.join(dir, 'haiku.json'), JSON.stringify({ ...pol, models: pol.models.map(m => (m.id === 'claude-haiku-5-5' ? { ...m, price: { ...m.price, inputPerMTok: 9 } } : m)) }));
  assert.equal(harnessManifest({ ...cfg, policy: policyEntries('claude-haiku-5-5', path.join(dir, 'other.json')) }).sha256, a.sha256);
  assert.notEqual(harnessManifest({ ...cfg, policy: policyEntries('claude-haiku-5-5', path.join(dir, 'haiku.json')) }).sha256, a.sha256);
});

// ---------------------------------------------------------------------------------------------------------------
// Host-side accounting (both arms).

const iso = ms => new Date(ms).toISOString();
const asst = (id, blocks, ms) => ({ type: 'assistant', timestamp: iso(ms), message: { id, content: blocks } });
const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
const res = (ids, ms) => ({ type: 'user', timestamp: iso(ms), message: { content: ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })) } });

test('accounting: one response per assistant message id (repeated blocks and parallel tool calls are one response); world steps mapped by time', () => {
  const T = 1_800_000_000_000;
  const events = [
    { type: 'system', subtype: 'init' },
    asst('m1', [{ type: 'thinking' }], T), asst('m1', [bash('t1', 'node tool.mjs call api_search \'{}\'')], T), asst('m1', [bash('t2', 'cat > REQUIREMENTS.md <<EOF\nx\nEOF')], T),
    res(['t1'], T + 1000), res(['t2'], T + 1100),
    asst('m2', [bash('t3', 'for i in 1 2; do node tool.mjs call api_fetch "{}"; done')], T + 2000), res(['t3'], T + 4000),
    asst('m3', [{ type: 'text', text: 'Done.' }], T + 5000),
    { type: 'result', subtype: 'success', num_turns: 4 },
  ];
  assert.deepEqual(sessionResponses(events).map(r => [r.id, r.toolUseIds.length, r.text]), [['m1', 2, false], ['m2', 1, false], ['m3', 0, true]]);
  const calls = [{ step: 1, t: (T + 500) / 1000, calls: [] }, { step: 2, t: (T + 2500) / 1000, calls: [] }, { step: 3, t: (T + 3500) / 1000, calls: [] }];
  const a = auditSession({ events, calls, maxSteps: 50 });
  assert.equal(a.modelResponses, 3);           // the official count: API responses
  assert.equal(a.numTurns, 4);                 // the CLI's count, reported beside it (it counts tool results + 1)
  assert.equal(a.toolResponses, 2);
  assert.equal(a.parallelToolResponses, 1);
  assert.equal(a.mapping, 'timestamps');
  assert.equal(a.maxWorldResponse, 2);
  assert.deepEqual(a.violations, []);
  // The same session under a cap of 2: response 2 issued world steps, which the official loop would never run.
  assert.deepEqual(auditSession({ events, calls, maxSteps: 2 }).violations, ['model responses 3 > 2', '2 world step(s) issued by response >= 2']);
  // A step still running when the session was cut is attributed to the last response.
  assert.equal(auditSession({ events, calls: [...calls, { step: 4, t: (T + 9000) / 1000, calls: [] }], maxSteps: 50 }).maxWorldResponse, 3);
  // No transcript: the runner's turn count is the only evidence.
  const none = auditSession({ events: [], calls, maxSteps: 3, fallbackTurns: 4 });
  assert.equal(none.mapping, 'none');
  assert.deepEqual(none.violations, ['model responses 4 > 3']);
});

test('accounting: world usage classifies reads, searches, writes, helpers and invalid calls', () => {
  const f = (method, url = 'https://x.example/a') => ({ name: 'api_fetch', arguments: JSON.stringify({ method, url }) });
  const u = worldUsage([
    { calls: [{ name: 'api_search', arguments: '{"query":"q"}' }, f('GET'), f('get')] },
    { calls: [f('POST'), f('PATCH'), f('DELETE'), f('PUT'), { name: 'base64_encode', arguments: '{"text":"a"}' }] },
    { calls: [{ name: 'api_fetch', arguments: '{"method": ' }, { name: 'no_such_tool', arguments: '{}' }] },
  ]);
  assert.deepEqual(u, { worldSteps: 3, worldCalls: 10, reads: 2, searches: 1, writes: 4, helpers: 1, invalid: 2 });
});

// ---------------------------------------------------------------------------------------------------------------
// Ledger collection and the step guard.

test('ledger: copied host-side with statistics; a planted symlink, FIFO, directory or hard link is refused; size capped', () => {
  const root = tmp('ledger');
  const work = path.join(root, 'w'), host = path.join(root, 'host');
  mkdirSync(work);
  const text = ['# Requirements', '- [ ] R1: notify the owner (source: message 12; date: 2026-01-03)', '- [ ] R2: old threshold (superseded by R3: newer) (source: doc; date: 2025-01-01)',
    '- [ ] R3: new threshold (source: doc v2; date: 2026-01-01)', '- [ ] F1: do not contact the archived record (flag: duplicate; rely on the active record instead)', '', '## Plan', '- W1 POST ... satisfies R1',
    '', '## Verification', '- [x] R1: done', '- R2: not needed (superseded)'].join('\n');
  writeFileSync(path.join(work, LEDGER_FILE), text);
  const r = collectLedger(work, host);
  assert.equal(r.present, true);
  assert.equal(readFileSync(path.join(host, 'ledger.md'), 'utf8'), text);
  assert.deepEqual([r.items, r.requirements, r.forbidden, r.superseded, r.flagged, r.withSource, r.withDate, r.hasPlan, r.planItems, r.hasVerification, r.verificationItems, r.checked],
    [4, 3, 1, 1, 1, 3, 3, true, 1, true, 2, 1]);
  assert.deepEqual(ledgerStats(''), { lines: 1, items: 0, requirements: 0, forbidden: 0, superseded: 0, flagged: 0, withSource: 0, withDate: 0, checked: 0, hasPlan: false, planItems: 0, hasVerification: false, verificationItems: 0 });
  const secret = path.join(root, 'host-secret.json');
  writeFileSync(secret, '{"assertions": ["hidden"]}');
  const planted = name => { const w = path.join(root, name); mkdirSync(w); return w; };
  const w1 = planted('w-link'); symlinkSync(secret, path.join(w1, LEDGER_FILE));
  const w2 = planted('w-fifo'); assert.equal(spawnSync('mkfifo', [path.join(w2, LEDGER_FILE)]).status, 0);
  const w3 = planted('w-dir'); mkdirSync(path.join(w3, LEDGER_FILE));
  const w4 = planted('w-hard'); linkSync(secret, path.join(w4, LEDGER_FILE));
  for (const w of [w1, w2, w3, w4]) {
    const h = path.join(w, 'host');
    assert.deepEqual(collectLedger(w, h), { present: false, reason: 'refused: not a regular file' }, w);
    assert.ok(!existsSync(path.join(h, 'ledger.md')));
  }
  assert.deepEqual(collectLedger(planted('w-none'), path.join(root, 'h5')), { present: false, reason: 'absent' });
  const w6 = planted('w-big'); writeFileSync(path.join(w6, LEDGER_FILE), 'x'.repeat(5000));
  const big = collectLedger(w6, path.join(root, 'h6'), { maxBytes: 1000 });
  assert.deepEqual([big.present, big.bytes, big.truncated, readFileSync(path.join(root, 'h6', 'ledger.md'), 'utf8').length], [true, 5000, true, 1000]);
});

test('step guard: the wrapper runs the CLI with --max-turns before the executor arguments; refuses a non-positive limit', () => {
  const dir = tmp('guard');
  const target = path.join(dir, 'echo-args.sh');
  writeFileSync(target, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  const g = writeCliGuard(path.join(dir, 'bin'), { maxTurns: 49, target });
  const out = spawnSync(g.binary, ['-p', '--model', 'm', '--tools', 'Bash'], { encoding: 'utf8' });
  assert.equal(out.stdout, '--max-turns\n49\n-p\n--model\nm\n--tools\nBash\n');
  assert.match(readFileSync(g.binary, 'utf8'), /exec 'claude' --max-turns 49|exec '.*echo-args\.sh' --max-turns 49/);
  assert.match(readFileSync(writeCliGuard(path.join(dir, 'b2'), { maxTurns: 3 }).binary, 'utf8'), /exec 'claude' --max-turns 3 "\$@"/);
  assert.throws(() => writeCliGuard(path.join(dir, 'b3'), { maxTurns: 0 }), /positive integer/);
});

// ---------------------------------------------------------------------------------------------------------------
// Guards before any work: dev tasks only (unless the frozen hash is given and matches), one rollout, guard never looser.

test('A1 refuses test-split tasks without the frozen harness hash, a wrong hash, k > 1 and a looser step guard, before any work', async () => {
  const testTask = loadSplit().test[0]; // a name only: nothing of the task is opened
  const runner = async () => { throw new Error('must not run'); };
  const base = { harness: 'foundry', runner, liveRoot: tmp('guards'), outDir: null, log: quiet };
  await assert.rejects(runTasks({ ...base, tasks: [testTask] }), /not dev-split tasks/);
  await assert.rejects(runTasks({ ...base, tasks: ['sales.__not_a_task__'] }), /not dev-split tasks/);
  await assert.rejects(runTasks({ ...base, tasks: [testTask], harnessHash: 'f'.repeat(64) }), /harness hash mismatch/);
  await assert.rejects(runTasks({ ...base, tasks: [PHONE_TASK], k: 2 }), /forked rehearsal/);
  await assert.rejects(runTasks({ ...base, tasks: [PHONE_TASK], cliMaxTurns: 50 }), /cli-max-turns/);
  await assert.rejects(runTasks({ ...base, harness: 'other', tasks: [PHONE_TASK] }), /unknown harness/);
  // The matching hash lifts the dev-only guard (shown on an unknown name, so no test task is touched): the run gets
  // past the guards and fails later, in the official dataset build.
  const hash = harnessManifest(harnessConfig({ ...DEFAULTS, cliMaxTurns: DEFAULTS.maxSteps - 1, cli: null })).sha256;
  await assert.rejects(runTasks({ ...base, tasks: ['sales.__not_a_task__'], harnessHash: hash }), e => !/not dev-split|hash mismatch/.test(e.message));
});

// ---------------------------------------------------------------------------------------------------------------
// End to end through the real bridge with a scripted A1 session (no model).

const sf = (id, field, v) => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'PATCH', url: `https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Contact/${id}`, body: JSON.stringify({ [field]: v }) }) });
const read = () => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_3001' }) });
const LEDGER = '# Requirements\n- [ ] R1: update the contact phone (source: trigger message; date: undated)\n\n## Plan\n- W1 PATCH Contact satisfies R1';

test('end to end (A1, scripted): procedure-shaped session passes; steps, responses, usage and the ledger are recorded host-side; the workdir holds only the client', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 300_000 }, async () => {
  const live = tmp('e2e');
  const seen = [];
  let sys = null, user = null;
  const inner = scriptedHarnessRunner(() => [
    { calls: [read()] },                                              // 1 discover
    { write: { content: LEDGER }, calls: [sf('003001', 'Phone', '+1-555-0101')] }, // 2 ledger + plan, then act, in one command
    { calls: [read()] },                                              // 3 verify (re-read)
    { write: { append: true, content: '\n## Verification\n- [x] R1: done' } }, // 4 verification note (no world call)
  ]);
  const runner = async args => { seen.push(...readdirSync(args.workdir)); sys = args.systemPrompt; user = args.prompt; return inner(args); };
  const { summary, results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'foundry', runner, det: 'record', liveRoot: live, outDir: path.join(live, 'out'), log: quiet });
  const r = results[0], f = r.forks[0];
  assert.equal(r.final.task_completed_correctly, 1);
  assert.equal(f.steps, 3);                                  // bridge steps
  assert.equal(f.session.modelResponses, 5);                 // 4 command responses + the final text
  assert.equal(f.session.toolResponses, 4);
  assert.equal(f.session.mapping, 'timestamps');
  assert.equal(f.session.maxWorldResponse, 3);
  assert.deepEqual(f.session.violations, []);
  assert.deepEqual(f.usage, { worldSteps: 3, worldCalls: 3, reads: 2, searches: 0, writes: 1, helpers: 0, invalid: 0 });
  assert.deepEqual([f.ledger.present, f.ledger.items, f.ledger.requirements, f.ledger.hasPlan, f.ledger.hasVerification, f.ledger.checked], [true, 1, 1, true, true, 1]);
  assert.ok(readFileSync(path.join(live, 'host', PHONE_TASK, 'fork-0', 'ledger.md'), 'utf8').includes('R1: update the contact phone'));
  assert.equal(summary.arm, 'A1 (harness)');
  assert.match(summary.harness.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(summary.harness.cliMaxTurns, 49);
  assert.equal(summary.accounting.ledger.collected, 1);
  assert.equal(summary.accounting.capViolations, 0);
  assert.equal(summary.mean_cost_per_task_usd, 0);
  // The session saw the official text and nothing host-side.
  assert.ok(sys.endsWith(harnessSection({ maxSteps: 50 })) && sys.startsWith('You are a workflow automation agent.'));
  assert.deepEqual([...new Set(seen)].sort(), ['.tools', 'tool.mjs', 'tools.json']);
  assert.ok(!sys.includes(PHONE_TASK) && !user.includes(PHONE_TASK));
  // The repo copy holds statistics only: no ledger text, no assertions.
  const copied = readFileSync(path.join(live, 'out', 'results.jsonl'), 'utf8');
  assert.ok(!copied.includes('update the contact phone') && !copied.includes('assertion_results'));
});

test('step cap (A1): the guard stops the session at max-steps - 1 responses; a session that ignores it is failed host-side even when the bridge served it', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 300_000 }, async () => {
  // (a) A session that honours the guard (as the CLI does): maxSteps 4 -> at most 3 responses; the 4th (the write) never runs.
  const s4 = [{ calls: [read()] }, { write: { content: LEDGER } }, { calls: [read()] }, { calls: [sf('003001', 'Phone', '+1-555-0101')] }];
  const a = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'foundry', runner: scriptedHarnessRunner(() => s4), det: 'record', maxSteps: 4, liveRoot: tmp('cap-a'), outDir: null, log: quiet });
  assert.equal(a.results[0].forks[0].session.modelResponses, 3);
  assert.equal(a.results[0].forks[0].session.stopReason, 'max_turns');
  assert.equal(a.results[0].final.task_completed_correctly, 0);
  assert.equal(a.results[0].headlineOverride, undefined);
  assert.equal(a.summary.accounting.stoppedByStepGuard, 1);
  // (b) A session that ignores the guard: two ledger-only responses, then a read and the write in response 4. The bridge
  // counts only world steps (2 <= 3) and serves both, so the live grade passes; the official loop would never have run
  // response 4, so the headline fails it (H3) and keeps the live grade beside it.
  const s4b = [{ write: { content: LEDGER } }, { write: { append: true, content: '- [ ] R2: x' } }, { calls: [read()] }, { calls: [sf('003001', 'Phone', '+1-555-0101')] }];
  const b = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'foundry', runner: scriptedHarnessRunner(() => s4b, { honorMaxTurns: false }), det: 'record', maxSteps: 4, liveRoot: tmp('cap-b'), outDir: null, log: quiet });
  const rb = b.results[0];
  assert.equal(rb.forks[0].steps, 2);
  assert.equal(rb.liveFinal.task_completed_correctly, 1);
  assert.equal(rb.final.task_completed_correctly, 0);
  assert.equal(rb.final.partial_credit, 0);
  assert.match(rb.headlineOverride, /H3 step cap: model responses 5 > 4; 1 world step\(s\) issued by response >= 4/);
  assert.deepEqual([b.summary.pass_rate, b.summary.live_pass_rate, b.summary.accounting.capViolations], [0, 1, 1]);
  // (c) The bridge's own limit still holds: world steps beyond max-steps - 1 are refused whatever the session does.
  const s5 = [{ calls: [read()] }, { calls: [read()] }, { calls: [read()] }, { calls: [sf('003001', 'Phone', '+1-555-0101')] }];
  const c = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'foundry', runner: scriptedHarnessRunner(() => s5, { honorMaxTurns: false }), det: 'record', maxSteps: 4, liveRoot: tmp('cap-c'), outDir: null, log: quiet });
  assert.equal(c.results[0].forks[0].steps, 3);
  assert.equal(c.results[0].liveFinal.task_completed_correctly, 0);
});

test('smoke script uses only the session-visible user message', () => {
  const steps = procedureScript({ prompt: 'Please update the record. You must notify the owner. Never email the vendor.' });
  assert.equal(steps.length, 5);
  assert.ok(steps[2].write.content.includes('R2: You must notify the owner.'));
  assert.ok(steps.every(s => !s.calls || s.calls.every(c => ['api_search', 'api_fetch'].includes(c.name) && !/"method":"(POST|PUT|PATCH|DELETE)"/.test(c.arguments))));
});

// ---------------------------------------------------------------------------------------------------------------
// Inside the real executor sandbox: the step guard wrapper is what runs, read-only, outside the workdir; the session
// reaches the world only through the mailbox; host-only directories stay hidden; the ledger is collected host-side.

const STANDIN = String.raw`#!/bin/sh
cat > /dev/null
args="$1 $2 $3 $4 $5"
if touch "$(dirname "$0")/planted" 2>/dev/null; then g=guard-writable; else g=guard-readonly; fi
if [ -e "$AB_PROBE_HOST" ]; then h=host-visible; else h=host-hidden; fi
if [ -e "$AB_PROBE_PREP" ]; then p=prep-visible; else p=prep-hidden; fi
# L4 (PREREG §8): the corpus, research/, the families, other runs' live directories and the agent transcript store.
l4=ok; for d in "$AB_PROBE_CORPUS" "$AB_PROBE_RESEARCH" "$AB_PROBE_FAMILIES" "$AB_PROBE_RUNS" "$AB_PROBE_TRANSCRIPTS"; do if [ -e "$d" ]; then l4="visible:$d"; fi; done
printf '{"type":"system","subtype":"init","session_id":"standin"}\n'
printf '{"type":"assistant","timestamp":"%s","message":{"id":"m1","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"node tool.mjs call ..."}}]}}\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
printf -- '- [ ] R1: update the phone (source: trigger; date: undated)\n' > REQUIREMENTS.md
node tool.mjs call api_fetch '{"method": "GET", "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_3001"}' > read.out 2>&1
node tool.mjs call api_fetch '{"method": "PATCH", "url": "https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Contact/003001", "body": "{\"Phone\": \"+1-555-0101\"}"}' > patch.out 2>&1
printf '{"type":"user","timestamp":"%s","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
printf '{"type":"assistant","message":{"id":"m2","content":[{"type":"text","text":"Done."}]}}\n'
printf '{"type":"result","subtype":"success","is_error":false,"result":"%s %s %s l4=%s %s","total_cost_usd":0,"num_turns":2}\n' "$g" "$h" "$p" "$l4" "$args"
`;

test('sandboxed (A1): the step-guard wrapper runs read-only in the executor sandbox, with --max-turns; ledger collected; accounting from the executor transcript', { skip: (!HAVE_VENV && 'AutomationBench venv missing') || (!sandboxAvailable() && 'no user namespaces'), timeout: 300_000 }, async () => {
  const live = tmp('sbx');
  const bin = path.join(live, 'harness-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'standin.sh'), STANDIN, { mode: 0o755 });
  let result = null, binary = null;
  const runner = async args => {
    binary = args.binary;
    const r = await runClaudeCode({ ...args, env: { AB_PROBE_HOST: path.join(live, 'host'), AB_PROBE_PREP: path.join(live, 'prep'), AB_PROBE_CORPUS: path.join(REPO, 'corpus/AutomationBench'),
      AB_PROBE_RESEARCH: path.join(REPO, 'research'), AB_PROBE_FAMILIES: path.join(REPO, 'experiments/autobench/families'), AB_PROBE_RUNS: '/var/tmp/foundry-work/autobench', AB_PROBE_TRANSCRIPTS: path.join(os.homedir(), '.claude') }, timeoutMs: 120_000 });
    result = r.result;
    return r;
  };
  const { results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'foundry', runner, cliTarget: path.join(bin, 'standin.sh'), model: 'stand-in', det: 'record', liveRoot: live, outDir: null, log: quiet });
  assert.equal(binary, path.join(bin, 'claude-a1'));
  assert.equal(result, 'guard-readonly host-hidden prep-hidden l4=ok --max-turns 49 -p --model stand-in');
  const r = results[0], f = r.forks[0];
  assert.equal(f.sessionError, null);
  assert.equal(f.steps, 2);
  assert.equal(r.final.task_completed_correctly, 1);
  assert.deepEqual([f.session.modelResponses, f.session.toolResponses, f.session.mapping, f.session.maxWorldResponse, f.session.violations.length], [2, 1, 'timestamps', 1, 0]);
  assert.deepEqual([f.ledger.present, f.ledger.items, f.ledger.requirements], [true, 1, 1]);
  assert.ok(!existsSync(path.join(bin, 'planted')));
});

// ---------------------------------------------------------------------------------------------------------------
// Integrity review (2026-10-15): L5 audit, split hygiene for every arm and mode, sealed runs.

test('L5: network and package commands, network code and benchmark references are flagged; request bodies and ledger text are not', () => {
  const clean = [
    `node tool.mjs call api_fetch '{"method":"POST","body":"we use git and curl; fetch( automationbench"}'`,
    "cat > REQUIREMENTS.md <<'EOF'\n- [ ] R1: curl the vendor (source: doc; date: undated)\n- [ ] F1: git\nEOF\nnode tool.mjs batch @step.json",
    'for i in 1 2; do node tool.mjs call api_fetch "{}"; done | jq .',
    'echo "curl" && grep -i git out.txt',
    "node tool.mjs call api_fetch - <<'EOF'\n{\"body\": \"fetch( automationbench\"}\nEOF",
  ];
  for (const c of clean) assert.deepEqual(commandFlags(c), [], c);
  const bad = {
    'curl -s https://example.org/x': "network command 'curl'", 'cd x && git clone https://example.org/r': "network command 'git'",
    'sudo -E pip install requests': "network command 'pip'", 'timeout 5 wget http://x': "network command 'wget'", 'FOO=1 env npx thing': "network command 'npx'",
    '/usr/bin/curl x': "network command 'curl'", 'x=$(curl -s y)': "network command 'curl'", 'python3 -c "import urllib.request"': 'network code',
    "node -e \"fetch('https://x')\"": 'network code', 'python3 -m pip install x': 'network code', "cat > a.py <<'EOF'\nimport requests\nEOF\npython3 a.py": 'network code',
    'ls ~/.cache/automation_bench': 'benchmark reference',
  };
  for (const [c, f] of Object.entries(bad)) assert.ok(commandFlags(c).includes(f), `${c} -> ${commandFlags(c)}`);
});

test('L5 in the audit: another model, a flagged command and a compaction count; synthetic error messages do not', () => {
  const T = 1_800_000_000_000;
  const base = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', timestamp: iso(T), message: { id: 'm1', model: 'claude-haiku-5-5', content: [bash('t1', 'node tool.mjs call api_search \'{}\'')] } },
    res(['t1'], T + 100),
    { type: 'assistant', timestamp: iso(T + 200), message: { id: 'syn', model: '<synthetic>', content: [{ type: 'text', text: 'API Error' }] } },
  ];
  const ok = auditSession({ events: [...base, { type: 'result', subtype: 'success', num_turns: 2, modelUsage: { 'claude-haiku-5-5': {} } }], expectModel: 'claude-haiku-5-5' });
  assert.deepEqual([ok.violations, ok.models, ok.compactions, ok.l5Flags], [[], ['claude-haiku-5-5'], 0, 0]);
  const other = auditSession({ events: [...base, { type: 'result', subtype: 'success', modelUsage: { 'claude-haiku-5-5': {}, 'claude-sonnet-5-5': {} } }], expectModel: 'claude-haiku-5-5' });
  assert.deepEqual(other.violations, ['L5: model claude-sonnet-5-5 reported (run model claude-haiku-5-5)']);
  assert.deepEqual(auditSession({ events: base, expectModel: 'claude-haiku-5-5-20261001' }).violations.length, 1);
  const net = auditSession({ events: [...base, { type: 'assistant', message: { id: 'm2', model: 'claude-haiku-5-5', content: [bash('t2', 'curl -s https://example.org')] } }] });
  assert.deepEqual(net.violations, ["L5: network command 'curl' in response 3"]);
  const comp = auditSession({ events: [...base, { type: 'system', subtype: 'compact_boundary' }], maxSteps: 2 });
  assert.equal(comp.compactions, 1);
  assert.equal(comp.modelResponses, 3);
  assert.deepEqual(comp.violations, ['model responses 3 > 2']);
});

test('split hygiene, every arm and mode: test tasks refused for A0 model, scripted and dry runs; only --test-run AB-v1 (A0 model run) or the frozen hash (A1) lifts it', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 120_000 }, async () => {
  const testTask = loadSplit().test[0]; // a name only: nothing of the task is opened
  const never = async () => { throw new Error('must not run'); };
  const base = { liveRoot: tmp('split-guard'), outDir: null, log: quiet };
  await assert.rejects(runTasks({ ...base, tasks: [testTask], runner: never }), /not dev-split tasks/);                         // scripted A0
  await assert.rejects(runTasks({ ...base, tasks: [testTask], runner: never, testRun: TEST_RUN_TOKEN }), /not dev-split tasks/);  // scripted A0 + token
  await assert.rejects(runTasks({ ...base, tasks: [testTask], dryRun: true }), /not dev-split tasks/);                          // dry run
  await assert.rejects(runTasks({ ...base, tasks: [testTask], dryRun: true, runner: never, harness: 'foundry', harnessHash: 'f'.repeat(64) }), /hash mismatch/);
  await assert.rejects(runTasks({ ...base, tasks: [testTask], model: 'claude-haiku-5-5', capUsd: 1 }), /not dev-split tasks/);   // A0 model run, no token
  await assert.rejects(runTasks({ ...base, tasks: [PHONE_TASK], model: 'claude-haiku-5-5', capUsd: 1, testRun: 'yes' }), /--test-run must be AB-v1/);
  // With the token, an A0 model run gets past the split guard (shown on an unknown name, so no test task is touched and
  // no session starts: the official dataset build refuses the name).
  await assert.rejects(runTasks({ ...base, tasks: ['sales.__not_a_task__'], model: 'claude-haiku-5-5', capUsd: 1, testRun: TEST_RUN_TOKEN }), e => !/not dev-split/.test(e.message) && /bridge prepare failed|not found/.test(e.message));
});

test('sealed run (devCheck or test tasks): no per-task grade in the log; the repo copy keeps per-task records in results.sealed.jsonl', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 300_000 }, async () => {
  const live = tmp('sealed'), lines = [];
  const runner = scriptedHarnessRunner(() => [{ calls: [sf('003001', 'Phone', '+1-555-0101')] }]);
  const { summary } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'foundry', runner, det: 'record', sealed: true, liveRoot: live, outDir: path.join(live, 'out'), log: m => lines.push(m) });
  assert.equal(summary.sealed, true);
  assert.ok(lines.some(l => l.includes(`${PHONE_TASK}: graded (sealed run`)));
  assert.ok(!lines.some(l => /pc=|pass=/.test(l)), lines.join('\n'));
  assert.ok(existsSync(path.join(live, 'out', 'results.sealed.jsonl')) && !existsSync(path.join(live, 'out', 'results.jsonl')));
  // devCheck and test membership seal a run by default (computed from the split, before any work).
  const s = loadSplit();
  assert.ok(s.devCheck.length === 60 && s.test.length === 300);
});
