// Tests for the AutomationBench bridge harness (experiments/autobench). No model is called anywhere ($0).
//   node --test experiments/autobench/test/
// The end-to-end tests need the AutomationBench venv (uv sync inside corpus/AutomationBench) and skip without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync, cpSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VENV_PY, TOOL_CLIENT, adapterText, bridgeJson, materializeWorkdir, readJson, scriptedRunner, startServe, stratifiedSubset, writeJson } from '../lib.mjs';
import { makeLedger, runTasks } from '../run-a1c-wip.mjs';
import { runClaudeCode, sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { parity } from '../parity.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-${p}-`));
const HAVE_VENV = existsSync(VENV_PY);
const run = (args, { cwd, input, env } = {}) => new Promise(res => {
  const c = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let o = '', e = '';
  c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { e += d; });
  c.stdin.end(input ?? '');
  c.on('close', code => res({ code, stdout: o, stderr: e }));
});

/** A fake environment for tool.mjs unit tests: answers every complete request with an echo. */
function fakeServer(dir, answer) {
  const box = path.join(dir, '.tools');
  const seen = [];
  const t = setInterval(() => {
    for (const f of readdirSync(box)) {
      const m = /^req-(\d+)\.json$/.exec(f);
      if (!m || existsSync(path.join(box, `res-${m[1]}.json`)) || seen.includes(m[1])) continue;
      seen.push(m[1]);
      const req = JSON.parse(readFileSync(path.join(box, f), 'utf8'));
      writeFileSync(path.join(box, `res-${m[1]}.json.tmp`), JSON.stringify(answer(req, Number(m[1]))));
      renameSync(path.join(box, `res-${m[1]}.json.tmp`), path.join(box, `res-${m[1]}.json`));
    }
  }, 20);
  return { seen, stop: () => clearInterval(t) };
}

test('tool.mjs: call/batch go through the mailbox with the raw argument string; parallel calls get distinct slots', async () => {
  const dir = tmp('tool');
  materializeWorkdir(dir, [{ name: 'api_search', description: 'd', parameters: {} }]);
  const reqs = [];
  const srv = fakeServer(dir, req => { reqs.push(req); return { results: req.calls.map(c => ({ name: c.name, content: `echo:${c.arguments}` })) }; });
  try {
    const one = await run(['tool.mjs', 'call', 'api_search', '{"query": "x"}'], { cwd: dir });
    assert.equal(one.code, 0, one.stderr);
    assert.equal(one.stdout, 'echo:{"query": "x"}\n'); // the exact string, not a re-serialization
    const bad = await run(['tool.mjs', 'call', 'api_fetch', '{"method": '], { cwd: dir });
    assert.equal(bad.stdout, 'echo:{"method": \n'); // malformed JSON is passed through for the env to reject, as in the official loop
    const b = await run(['tool.mjs', 'batch', '-'], { cwd: dir, input: JSON.stringify([{ name: 'a', arguments: { q: 1 } }, { name: 'b', arguments: '{"z":2}' }]) });
    assert.equal(b.code, 0, b.stderr);
    assert.match(b.stdout, /### result 1: a\necho:\{"q":1\}\n### result 2: b\necho:\{"z":2\}\n/);
    writeFileSync(path.join(dir, 'args.json'), '{"query": "from file"}');
    assert.equal((await run(['tool.mjs', 'call', 'api_search', '@args.json'], { cwd: dir })).stdout, 'echo:{"query": "from file"}\n');
    const par = await Promise.all(Array.from({ length: 8 }, (_, i) => run(['tool.mjs', 'call', 't', `{"i":${i}}`], { cwd: dir })));
    assert.ok(par.every(p => p.code === 0));
    assert.deepEqual(par.map(p => p.stdout).sort(), Array.from({ length: 8 }, (_, i) => `echo:{"i":${i}}\n`).sort());
    assert.equal(new Set(srv.seen).size, srv.seen.length);
    const list = await run(['tool.mjs', 'list'], { cwd: dir });
    assert.deepEqual(JSON.parse(list.stdout), [{ name: 'api_search', description: 'd', parameters: {} }]);
    assert.equal((await run(['tool.mjs', 'batch', '{"not": "an array"}'], { cwd: dir })).code, 2);
  } finally { srv.stop(); }
});

test('tool.mjs: a refused step exits 1 with the reason; no answer times out', async () => {
  const dir = tmp('tool2');
  materializeWorkdir(dir, []);
  const srv = fakeServer(dir, () => ({ error: 'step budget exhausted' }));
  try {
    const r = await run(['tool.mjs', 'call', 'x', '{}'], { cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /step budget exhausted/);
  } finally { srv.stop(); }
  const r2 = await run(['tool.mjs', 'call', 'x', '{}'], { cwd: dir, env: { AUTOBENCH_TOOL_WAIT_MS: '300' } });
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /did not answer/);
});

test('stratifiedSubset: equal shares per domain, deterministic for a seed, different for another', () => {
  const tasks = ['a', 'b', 'c'].flatMap(d => Array.from({ length: 20 }, (_, i) => ({ task: `${d}.t${i}`, domain: d })));
  const s1 = stratifiedSubset(tasks, 7, 's1', ['a', 'b', 'c']);
  assert.equal(s1.length, 7);
  assert.deepEqual(['a', 'b', 'c'].map(d => s1.filter(t => t.startsWith(`${d}.`)).length), [3, 2, 2]);
  assert.deepEqual(stratifiedSubset(tasks, 7, 's1', ['a', 'b', 'c']), s1);
  assert.notDeepEqual(stratifiedSubset(tasks, 7, 's2', ['a', 'b', 'c']), s1);
});

test('ledger: a hard cap over reserved budgets; waits for in-flight sessions, refuses when nothing can fit', async () => {
  const l = makeLedger(1.0);
  assert.ok(await l.reserve(0.4));
  assert.ok(await l.reserve(0.4));
  const third = l.reserve(0.4); // 0.8 reserved: must wait
  setTimeout(() => l.settle(0.4, { costUsd: 0.1 }), 50); // one session settles at 0.1 -> 0.1 + 0.4 + 0.4 <= 1
  assert.ok(await third);
  l.settle(0.4, { costUsd: null, costUpperUsd: 0.4 }); // unknown cost counts at its budget
  l.settle(0.4, { costUsd: 0.3 });
  assert.equal(Number(l.spent.toFixed(6)), 0.8);
  assert.equal(l.unknown, 1);
  assert.equal(await l.reserve(0.4), false); // 0.8 + 0.4 > 1 with nothing in flight
});

test('runTasks refuses model ids outside the policy and model runs without a cap, before any work', async () => {
  await assert.rejects(runTasks({ model: 'gpt-5-mini', tasks: ['x.y'], capUsd: 1, liveRoot: tmp('pol'), outDir: null, log: () => {} }), /not listed in the model policy/);
  await assert.rejects(runTasks({ model: 'claude-haiku-5-5', tasks: ['x.y'], liveRoot: tmp('pol2'), outDir: null, log: () => {} }), /--cap/);
});

test('adapter text: the official catalog verbatim and the step limit', () => {
  const cat = [{ name: 'api_fetch', description: 'Call an API endpoint', parameters: { type: 'object' } }];
  const t = adapterText(cat, 50);
  assert.match(t, /at most 49 steps/);
  assert.ok(t.includes(JSON.stringify(cat, null, 1)));
});

// ---------------------------------------------------------------------------------------------------------------
// End to end through the real bridge (AutomationBench venv), scripted agent, no model.

const PHONE_TASK = 'simple.email_sf_contact_phone_update';
const sf = (id, field, v) => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'PATCH', url: `https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Contact/${id}`, body: JSON.stringify({ [field]: v }) }) });
const sfTask = () => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Task', body: JSON.stringify({ Subject: 'Phone updated', WhoId: '003001' }) }) });
const mail = () => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', body: JSON.stringify({ raw: Buffer.from('To: jordan.lee@acmecorp.example.com\r\nSubject: Updated\r\n\r\nDone.').toString('base64url') }) }) });
const read = () => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_3001' }) });

test('end to end: scripted session through mailbox -> official rubric; grades stay host-only; the workdir holds only the client', { skip: !HAVE_VENV && 'AutomationBench venv missing' }, async () => {
  const live = tmp('e2e');
  const seenInWorkdir = [];
  const inner = scriptedRunner(() => [{ calls: [read()] }, { calls: [sf('003001', 'Phone', '+1-555-0101')] }]);
  const runner = async args => {
    seenInWorkdir.push(...readdirSync(args.workdir));
    assert.ok(!args.prompt.includes(PHONE_TASK) && !args.systemPrompt.includes(PHONE_TASK), 'the task name is not shown to the agent');
    assert.ok(!/salesforce_field_equals|assertion/.test(args.systemPrompt + args.prompt), 'no grading information in the prompt');
    assert.ok(args.systemPrompt.startsWith('You are a workflow automation agent.'), 'official system prompt first');
    const r = await inner(args);
    seenInWorkdir.push(...readdirSync(path.join(args.workdir, '.tools')).map(f => `.tools/${f}`));
    return r;
  };
  const { summary, results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], runner, det: 'record', liveRoot: live, outDir: path.join(live, 'out'), log: () => {} });
  assert.equal(summary.n_graded, 1);
  assert.equal(results[0].final.task_completed_correctly, 1);
  assert.equal(results[0].forks[0].steps, 2);
  assert.deepEqual([...new Set(seenInWorkdir.filter(f => !f.startsWith('.tools/') && !f.startsWith('.step-')))].sort(), ['.tools', 'tool.mjs', 'tools.json']);
  assert.ok(seenInWorkdir.filter(f => f.startsWith('.tools/')).every(f => /^\.tools\/(req|res)-\d+\.(json|claim)$/.test(f)), seenInWorkdir.join(','));
  const host = path.join(live, 'host', PHONE_TASK, 'fork-0');
  for (const f of ['grade.json', 'final-world.json', 'calls.jsonl', 'generated.json']) assert.ok(existsSync(path.join(host, f)), f);
  assert.ok(existsSync(path.join(live, 'out', 'summary.json')) && existsSync(path.join(live, 'out', 'results.jsonl')));
  assert.equal(readJson(path.join(host, 'final-world.json')).salesforce.contacts.find(c => c.id === '003001').phone, '+1-555-0101');
});

test('end to end: the step limit mirrors max_turns (50 model steps -> 49 tool steps; here 3 -> 2)', { skip: !HAVE_VENV && 'AutomationBench venv missing' }, async () => {
  const live = tmp('steps');
  const runner = scriptedRunner(() => [{ calls: [read()] }, { calls: [read()] }, { calls: [sf('003001', 'Phone', '+1-555-0101')] }]);
  const { results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], runner, det: 'record', maxSteps: 3, liveRoot: live, outDir: null, log: () => {} });
  assert.equal(results[0].forks[0].steps, 2);
  assert.equal(results[0].final.task_completed_correctly, 0); // the write in step 3 was refused, as the official loop would drop it
});

test('end to end: k=3 forks vote on masked final-state diffs (fresh ids and creation order do not split a group)', { skip: !HAVE_VENV && 'AutomationBench venv missing' }, async () => {
  const live = tmp('vote');
  const steps = {
    0: [{ calls: [sf('003001', 'Phone', '+1-555-0101'), sfTask(), mail()] }],
    1: [{ calls: [mail()] }, { calls: [sfTask(), sf('003001', 'Phone', '+1-555-0101')] }], // same effects, other order and steps
    2: [{ calls: [sf('003001', 'Phone', '+1-555-9999'), sfTask(), mail()] }],               // a different decision
  };
  const runner = scriptedRunner(({ fork }) => steps[fork]);
  const { results, summary } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], runner, det: 'record', k: 3, concurrency: 3, liveRoot: live, outDir: null, log: () => {} });
  const r = results[0];
  assert.deepEqual(r.vote.groups, [[0, 1], [2]]);
  assert.equal(r.vote.winner, 0);
  assert.equal(r.vote.majority, true);
  assert.ok(Math.abs(r.vote.agreement - 2 / 3) < 1e-9);
  assert.equal(r.final.task_completed_correctly, 1);
  assert.deepEqual(r.forks.map(f => f.task_completed_correctly), [1, 1, 0]);
  assert.equal(summary.fork0_pass_rate, 1);
  // The forks started from copies of one exported world and really drew different fresh ids.
  const w = f => readJson(path.join(live, 'host', PHONE_TASK, `fork-${f}`, 'final-world.json'));
  const ids = f => w(f).salesforce.tasks.map(t => t.id).join();
  assert.notEqual(ids(0), ids(1));
});

test('parity (2 tasks): bridge path == official evaluate() path, exactly; the recording shim changes only generator draws', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const live = tmp('parity');
  const r = await parity({ tasks: ['simple.email_sf_contact_phone_update', 'sales.multi_hop_lookup'], live, out: null, log: () => {} });
  assert.equal(r.all_exact, true, JSON.stringify(r.rows.map(x => [x.task, x.checks])));
  assert.equal(r.shim_neutrality.ok, true, JSON.stringify(r.rows.map(x => x.neutral)));
  assert.ok(r.rows.every(x => x.toolCalls > 5));
});

// A stand-in for `claude -p` (runClaudeCode's `binary`), run inside the real executor sandbox: it reaches the bridge
// only through the mailbox in its workdir, and the host-only directories (grades, prepared task with assertions,
// other forks) are invisible to it. Prints a stream-json result like the CLI, so runClaudeCode parses it.
const STANDIN = String.raw`#!/bin/sh
cat > /dev/null
node tool.mjs call api_fetch '{"method": "GET", "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_3001"}' > read.out 2>&1 && r=read-ok || r=read-failed
node tool.mjs call api_fetch '{"method": "PATCH", "url": "https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Contact/003001", "body": "{\"Phone\": \"+1-555-0101\"}"}' > patch.out 2>&1
if [ -e "$AB_PROBE_HOST" ]; then h=host-visible; else h=host-hidden; fi
if [ -e "$AB_PROBE_PREP" ]; then p=prep-visible; else p=prep-hidden; fi
siblings=$(ls .. | wc -l)
printf '{"type":"system","subtype":"init","session_id":"standin"}\n'
printf '{"type":"result","subtype":"success","is_error":false,"result":"%s %s %s siblings=%s","total_cost_usd":0,"num_turns":2}\n' "$r" "$h" "$p" "$siblings"
`;

test('sandboxed: a stand-in CLI inside the executor sandbox reaches the bridge via the mailbox and cannot see host-only files', { skip: (!HAVE_VENV && 'AutomationBench venv missing') || (!sandboxAvailable() && 'no user namespaces') }, async () => {
  const live = tmp('sbx');
  let result = null;
  const runner = async args => {
    const bin = path.join(args.workdir, 'claude-standin.sh');
    writeFileSync(bin, STANDIN, { mode: 0o755 });
    const r = await runClaudeCode({ ...args, binary: bin, env: { AB_PROBE_HOST: path.join(live, 'host'), AB_PROBE_PREP: path.join(live, 'prep') }, timeoutMs: 120_000 });
    result = r.result;
    return r;
  };
  const { results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], runner, model: 'stand-in', det: 'record', liveRoot: live, outDir: null, log: () => {} });
  assert.equal(result, 'read-ok host-hidden prep-hidden siblings=1');
  assert.equal(results[0].forks[0].sessionError, null);
  assert.equal(results[0].forks[0].steps, 2);
  assert.equal(results[0].final.task_completed_correctly, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Adversarial review 2026-10-15: the mailbox is agent-writable and the bridge runs OUTSIDE the sandbox with the host's
// rights, so it must never follow anything the agent planted there (confused deputy). Exercised on the bridge directly:
// the host test plants exactly what an agent could plant in its workdir.

const waitFile = async (p, ms = 30_000) => { const t0 = Date.now(); while (!existsSync(p)) { if (Date.now() - t0 > ms) throw new Error(`no ${p}`); await new Promise(r => setTimeout(r, 50)); } await new Promise(r => setTimeout(r, 50)); return p; };
const putReq = (box, n, calls) => { writeFileSync(path.join(box, `req-${n}.json.tmp`), JSON.stringify({ v: 1, calls })); renameSync(path.join(box, `req-${n}.json.tmp`), path.join(box, `req-${n}.json`)); };

test('mailbox: planted symlinks, FIFOs, directories and hard links are refused uniformly; answers never write through a link; a swapped mailbox directory is not followed', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 180_000 }, async () => {
  const live = tmp('mbox');
  const prep = path.join(live, 'prep');
  await bridgeJson(['prepare', '--domains', 'simple', '--tasks', PHONE_TASK, '--out', prep], { liveDir: live });
  const canary = path.join(live, 'canary.txt'), probeDir = path.join(live, 'host-probe');
  writeFileSync(canary, 'ORIGINAL');
  mkdirSync(probeDir);
  const box = path.join(live, 'w', '.tools');
  mkdirSync(box, { recursive: true });
  const b = startServe({ liveDir: live, input: path.join(prep, PHONE_TASK, 'input.json'), world: path.join(prep, PHONE_TASK, 'world0.json'), mailbox: box, hostDir: path.join(live, 'host') });
  try {
    await b.ready;
    // 1. write-through: the answer's temp name and the answer itself pre-planted as links to a host file
    symlinkSync(canary, path.join(box, 'res-1.json.tmp'));
    putReq(box, 1, [read()]);
    const r1 = JSON.parse(readFileSync(await waitFile(path.join(box, 'res-1.json')), 'utf8'));
    assert.equal(readFileSync(canary, 'utf8'), 'ORIGINAL');
    assert.ok(lstatSync(path.join(box, 'res-1.json')).isFile());
    assert.deepEqual(Object.keys(r1), ['results']); // no step count in what the agent can read
    assert.match(r1.results[0].content, /msg_3001|Jordan|phone/i);
    // 2. requests that are not plain files: same refusal whatever they point at (no existence oracle for host paths)
    symlinkSync(canary, path.join(box, 'req-2.json'));
    symlinkSync(canary + '.missing', path.join(box, 'req-3.json'));
    assert.equal(spawnSync('mkfifo', [path.join(box, 'req-4.json')]).status, 0);
    mkdirSync(path.join(box, 'req-5.json'));
    linkSync(canary, path.join(box, 'req-6.json'));
    const refusals = [];
    for (const n of [2, 3, 4, 5, 6]) refusals.push(readFileSync(await waitFile(path.join(box, `res-${n}.json`)), 'utf8'));
    assert.deepEqual(new Set(refusals), new Set(['{"error": "ValueError: request refused: not a regular file"}']));
    // 3. the mailbox directory swapped for a link to a host directory: the bridge keeps serving the original one
    renameSync(box, box + '-moved');
    symlinkSync(probeDir, box);
    putReq(box + '-moved', 7, [read()]);
    await waitFile(path.join(box + '-moved', 'res-7.json'));
    writeFileSync(path.join(probeDir, 'req-8.json'), JSON.stringify({ v: 1, calls: [read()] }));
    await new Promise(r => setTimeout(r, 500));
    assert.deepEqual(readdirSync(probeDir), ['req-8.json']); // never answered there
    const done = await b.stop();
    assert.equal(done.steps, 2); // only the two real requests ran
    assert.equal(readFileSync(canary, 'utf8'), 'ORIGINAL');
  } finally { b.kill(); }
});

// Synthetic worlds for the vote: a fork's signature must keep the text around a fresh id (else different decisions
// merge) and must mask ids that were generated from non-uuid draws (else identical work splits).
const u32 = c => c.repeat(32).slice(0, 32);
const dashed = u => `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
const gen = (uuid = []) => ({ mode: 'record', seed: 0, uuid, rand: [], clock: [], wall0: 0, wall1: 0 });
async function voteOn(base, forks) {
  const dir = tmp('votesyn');
  writeJson(path.join(dir, 'world0.json'), { task: 'synthetic', world: base });
  const hosts = forks.map(([world, g], i) => { const h = path.join(dir, `fork-${i}`); writeJson(path.join(h, 'final-world.json'), world); writeJson(path.join(h, 'generated.json'), g); return h; });
  await bridgeJson(['vote', '--base', path.join(dir, 'world0.json'), '--forks', hosts.join(','), '--out', path.join(dir, 'vote.json')], { liveDir: dir });
  return readJson(path.join(dir, 'vote.json'));
}

test('vote: text around a fresh id is compared (different decisions do not merge); hex-randint ids and <x>_id record keys are matched', { skip: !HAVE_VENV && 'AutomationBench venv missing' }, async () => {
  const msg = (u, prio) => ({ slack: { messages: [{ id: `m_${u.slice(0, 12)}`, text: `Ticket ${dashed(u)} created: priority ${prio}` }] } });
  const [a, b, c] = ['a1', 'b2', 'c3'].map(u32);
  const v1 = await voteOn({ slack: { messages: [] } }, [[msg(a, 'High'), gen([a])], [msg(b, 'Low'), gen([b])], [msg(c, 'High'), gen([c])]]);
  assert.deepEqual(v1.groups.map(g => g.forks), [[0, 2], [1]]);
  const old = { contact_id: '11111111-2222-3333-4444-555555555555', name: 'Old' };
  const xero = list => ({ xero: { contacts: list } });
  const v2 = await voteOn(xero([old]), [
    [xero([old, { contact_id: '05f5e100-03e8-04d2-0b9a-00174876e800', name: 'Acme' }, { contact_id: '05f5e1aa-03e8-04d2-0b9a-00174876e801', name: 'Beta' }]), gen()],
    [xero([{ contact_id: '0a0a0a0a-0fff-0eee-0ddd-001748760000', name: 'Beta' }, old, { contact_id: '0b0b0b0b-0fff-0eee-0ddd-001748760001', name: 'Acme' }]), gen()],
    [xero([{ ...old, name: 'Renamed' }, { contact_id: '0c0c0c0c-0fff-0eee-0ddd-001748760002', name: 'Acme' }, { contact_id: '0d0d0d0d-0fff-0eee-0ddd-001748760003', name: 'Beta' }]), gen()],
  ]);
  assert.deepEqual(v2.groups.map(g => g.forks), [[0, 1], [2]]);
  assert.equal(v2.majority, true);
});

test('cost: a runner that throws after it started is counted at its budget (unknown), not at $0; a nested model use voids the run', { skip: !HAVE_VENV && 'AutomationBench venv missing' }, async () => {
  const { summary, results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], runner: async () => { throw new Error('boom after start'); }, budgetUsd: 0.5,
    det: 'record', liveRoot: tmp('cost'), outDir: null, log: () => {} });
  assert.match(results[0].forks[0].harnessError, /boom after start/);
  assert.equal(results[0].forks[0].costUnknown, true);
  assert.equal(results[0].costUsd, 0.5);
  assert.deepEqual([summary.cost.spentUsd, summary.cost.knownUsd, summary.cost.unknownUpperUsd, summary.cost.unknownCostSessions], [0.5, 0, 0.5, 1]);
  assert.equal(summary.void, null);
  const inner = scriptedRunner(() => [{ calls: [read()] }]);
  const nested = async args => ({ ...(await inner(args)), costUsd: 0.01, toolUses: [{ name: 'Bash', input: { command: 'claude -p "do it for me"' } }] });
  const s2 = (await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], runner: nested, det: 'record', liveRoot: tmp('void'), outDir: null, log: () => {} })).summary;
  assert.equal(s2.nestedModelUses, 1);
  assert.match(s2.void, /nested model use/);
  assert.equal(s2.cost.knownUsd, 0.01);
});
