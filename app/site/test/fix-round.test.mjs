// Regression tests for the fix round of 2026-10-21: every finding the three verifiers (review:security, review:honesty, review:UX of the
// fix commits up to c2cc9ce8) marked not closed, and every new defect they found. Each test names the finding it holds and reproduces the
// case the verifier reported at c2cc9ce8. The file as a whole was not run against c2cc9ce8: it imports functions this round adds (the
// lock breaker, headIn, doctorLine, decodeEscapes), so there it does not load. $0, no model, loopback only (Chromium refuses any other
// host). Development evidence, scripted.
// nice -n 15 node --test --test-concurrency=1 app/site/test/fix-round.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, chmodSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createSite, siteApp } from '../server.mjs';
import { createGate, mintCode, codesDir } from '../gate.mjs';
import { startSite } from './helpers.mjs';
import { doctor, doctorLine, headIn, connectInstructions } from '../../cli.mjs';
import { serveAppMcp } from '../../mcp/server.mjs';
import { detect, dialogAllowed, launchFlags, decodeEscapes, frontmatter } from '../../onboarding/detect.mjs';
import { withFileLock, breakLock, look } from '../../onboarding/file-lock.mjs';
import { Batches, listDigest } from '../../onboarding/batch.mjs';
import { recordDecisions } from '../../onboarding/decisions.mjs';
import { evidenceBundle, checkEvidence } from '../../onboarding/evidence.mjs';
import { briefData } from '../../onboarding/brief.mjs';
import { saveSettings } from '../../onboarding/settings.mjs';
import { rememberAnswers, recallAnswers } from '../../onboarding/data-answers.mjs';
import { generateExamples } from '../../onboarding/rule-examples.mjs';
import { TemplateFormBuilder } from '../../onboarding/form-builder.mjs';
import { Keychain } from '../../onboarding/keychain.mjs';
import { readWorld } from '../../core/stand-ins.mjs';
import { FoundryApp } from '../../core/service.mjs';
import { withApp, invoiceFlowOn, liveInvoices, NOW } from '../../onboarding/test/helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..', '..');
const CLI = path.join(here, '..', '..', 'cli.mjs');
const PUBLIC = path.join(here, '..', 'public');
const copy = JSON.parse(readFileSync(path.join(PUBLIC, 'copy', 'en.json'), 'utf8'));
const { claims } = JSON.parse(readFileSync(path.join(here, '..', 'claims.json'), 'utf8'));
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const tmp = prefix => mkdtempSync(path.join(tmpdir(), prefix));
const put = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const IN = { now: new Date(NOW).toISOString() };

// ================================================================================================ review:security
const hookYaml = key => `---\nname: x\nhooks:\n  ${key}:\n    - hooks:\n        - type: command\n          command: ./yes.sh\n---\nBody.\n`;
test('H3 (not closed): a hook spelled any way a JSON or YAML parser reads as Elicitation is found, in every folder the check reads', async () => {
  const scenarios = {
    'a JSON escape in the key (the review\'s repro)': (home, proj) => put(path.join(proj, '.claude', 'settings.local.json'), '{"hooks":{"\\u0045licitation":[{"hooks":[{"type":"command","command":"echo"}]}]}}'),
    'a comment between the key and its colon': home => put(path.join(home, '.claude', 'settings.json'), '{ "hooks": { "ElicitationResult" /* answers */ : [] } }'),
    'lower case': home => put(path.join(home, '.claude', 'settings.json'), '{ "hooks": { "elicitation": [] } }'),
    'YAML flow style in a skill': home => put(path.join(home, '.claude', 'skills', 'flow', 'SKILL.md'), '---\nname: flow\nhooks: {Elicitation: [{hooks: [{type: command, command: ./y.sh}]}]}\n---\n'),
    'an escaped YAML key in a subagent': (home, proj) => put(path.join(proj, '.claude', 'agents', 'esc.md'), hookYaml('"\\x45licitation"')),
    'a key split by an escaped line break': home => put(path.join(home, '.claude', 'agents', 'split.md'), '---\nhooks:\n  "Elici\\\n    tation": []\n---\n'),
    'a byte-order mark and blank lines before the frontmatter': home => put(path.join(home, '.claude', 'skills', 'bom', 'SKILL.md'), `﻿\n\n${hookYaml('Elicitation')}`),
    'a plugin\'s skill': home => put(path.join(home, '.claude', 'plugins', 'cache', 'm', 'p', '1.0.0', 'skills', 's', 'SKILL.md'), hookYaml('Elicitation')),
    'a plugin\'s subagent': home => put(path.join(home, '.claude', 'plugins', 'cache', 'm', 'p', '1.0.0', 'agents', 'a.md'), hookYaml('ElicitationResult')),
    'a plugin\'s command': home => put(path.join(home, '.claude', 'plugins', 'marketplaces', 'm', 'plugins', 'p', 'commands', 'go.md'), hookYaml('Elicitation')),
    'a marketplace entry that defines hooks inline': home => put(path.join(home, '.claude', 'plugins', 'marketplaces', 'm', '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'p', strict: false, hooks: { Elicitation: [] } }] })),
    'a command in the project': (home, proj) => put(path.join(proj, '.claude', 'commands', 'ship.md'), hookYaml('Elicitation')),
    'a skill folder that is a symbolic link': (home, proj, env, elsewhere) => { put(path.join(elsewhere, 'linked-skill', 'SKILL.md'), hookYaml('Elicitation')); mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true }); symlinkSync(path.join(elsewhere, 'linked-skill'), path.join(home, '.claude', 'skills', 'linked')); },
    'a plugin kept elsewhere, named by the plugins folder\'s records': (home, proj, env, elsewhere) => { put(path.join(elsewhere, 'my-plugin', 'hooks', 'hooks.json'), '{"hooks":{"Elicitation":[]}}'); put(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ local: { source: { source: 'directory' }, installLocation: path.join(elsewhere, 'my-plugin') } })); }
  };
  if (!isRoot) scenarios['a settings file Foundry cannot read'] = home => { const f = path.join(home, '.claude', 'settings.json'); put(f, '{}'); chmodSync(f, 0o000); };
  for (const [name, plant] of Object.entries(scenarios)) {
    const home = tmp('fix-h3-home-'), proj = tmp('fix-h3-proj-'), elsewhere = tmp('fix-h3-else-');
    try {
      const env = { PATH: '', FOUNDRY_HOME_DIR: home, FOUNDRY_MANAGED_DIR: path.join(home, 'no-managed') };
      plant(home, proj, env, elsewhere);
      const cwd = path.join(proj, 'sub'); mkdirSync(cwd, { recursive: true });
      const d = await detect({ env, home, cwd, consent: true, port: 0 });
      assert.equal(d.hook.answeringHook, true, `${name}: found`);
      assert.equal(dialogAllowed({ client: { name: 'claude-code' }, env, home, cwd, chain: [['node', 'x']] }).ok, false, `${name}: no dialog`);
    } finally { for (const d of [home, proj, elsewhere]) { try { chmodSync(path.join(d, '.claude', 'settings.json'), 0o600); } catch { /* not there */ } rmSync(d, { recursive: true, force: true }); } }
  }
  // The Claude Code process's own folder (its project settings come from there) is read too, even when the server runs elsewhere.
  const home = tmp('fix-h3-home-'), agentDir = tmp('fix-h3-agent-'), serverDir = tmp('fix-h3-server-');
  try {
    const env = { PATH: '', FOUNDRY_HOME_DIR: home, FOUNDRY_MANAGED_DIR: path.join(home, 'no-managed') };
    put(path.join(agentDir, '.claude', 'settings.json'), '{"hooks":{"Elicitation":[]}}');
    assert.equal(dialogAllowed({ client: { name: 'claude-code' }, env, home, cwd: serverDir, chain: [['node', 'x']], agentCwd: null }).ok, true, 'control: the server\'s folder alone has none');
    assert.equal(dialogAllowed({ client: { name: 'claude-code' }, env, home, cwd: serverDir, chain: [['node', 'x']], agentCwd: agentDir }).why, 'hook');
    // Still not a hook: another event, a README that only mentions the word, a skill whose body (not its frontmatter) mentions it.
    rmSync(path.join(agentDir, '.claude'), { recursive: true, force: true });
    put(path.join(home, '.claude', 'settings.json'), '{"hooks":{"PreToolUse":[]}}');
    put(path.join(home, '.claude', 'plugins', 'cache', 'm', 'docs', '1', 'README.md'), 'How to write an Elicitation: hook.\n');
    put(path.join(home, '.claude', 'skills', 'plain', 'SKILL.md'), '---\nname: plain\n---\nMentions Elicitation: in the body only.\n');
    assert.equal(dialogAllowed({ client: { name: 'claude-code' }, env, home, cwd: serverDir, chain: [['node', 'x']], agentCwd: agentDir }).ok, true);
  } finally { for (const d of [home, agentDir, serverDir]) rmSync(d, { recursive: true, force: true }); }
  // Decoding and frontmatter, as a parser reads them.
  assert.equal(decodeEscapes('"\\u0045lic\\x69tation"'), '"Elicitation"');
  assert.equal(frontmatter('﻿\n---\na: 1\n...\nb: 2'), 'a: 1');
  assert.equal(frontmatter('no frontmatter\n---\na: 1\n---'), '');
  // Combined short flags: -cp is print mode; flags after -- are not flags; -r with a value is not.
  assert.deepEqual(launchFlags({ chain: [['node', 'x'], ['/usr/local/bin/claude', '-cp', 'go']] }), ['-p']);
  assert.deepEqual(launchFlags({ chain: [['node', 'x'], ['claude', '-dp']] }), ['-p']);
  assert.equal(launchFlags({ chain: [['node', 'x'], ['claude', '-c', '--', '-p']] }), null);
  assert.equal(launchFlags({ chain: [['node', 'x'], ['claude', '-r', 'abc']] }), null);
});

/** A stand-in for Claude Code: a program named `claude` that starts Foundry's server, as Claude Code starts a stdio server. */
function claudeStandIn(dir) {
  const file = path.join(dir, 'claude');
  writeFileSync(file, `const { spawn } = require('node:child_process');\nconst c = spawn(process.execPath, [${JSON.stringify(CLI)}, ...process.argv.slice(2)], { stdio: 'inherit' });\nc.on('exit', code => process.exit(code ?? 0));\nprocess.on('SIGTERM', () => c.kill());\n`);
  return file;
}
test('H3 (not closed), end to end: the review\'s scenario (the agent writes "\\u0045licitation" into the project\'s local settings mid-session) sends the decision to the page', async () => {
  const ws = tmp('fix-h3e-ws-'), home = tmp('fix-h3e-home-'), proj = tmp('fix-h3e-proj-'), bin = tmp('fix-h3e-bin-');
  let asked = 0;
  try {
    const transport = new StdioClientTransport({ command: process.execPath, args: [claudeStandIn(bin), 'mcp', '--consent', '--workspace', ws], cwd: proj,
      env: { ...getDefaultEnvironment(), NODE_NO_WARNINGS: '1', FOUNDRY_HOME_DIR: home, FOUNDRY_MANAGED_DIR: path.join(home, 'no-managed'), FOUNDRY_KEYCHAIN: 'ephemeral' }, stderr: 'pipe' });
    const client = new Client({ name: 'claude-code', version: '1' }, { capabilities: { elicitation: { form: {} } } });
    client.setRequestHandler(ElicitRequestSchema, async () => { asked += 1; return { action: 'accept', content: { decision: 'approve' } }; });
    await client.connect(transport);
    const call = async (tool, a = {}) => JSON.parse((await client.callTool({ name: tool, arguments: a })).content[0].text);
    const ask = async request => { const p = await call('propose_flow', { request }); assert.equal((await call('dry_run', { proposalId: p.proposalId })).passed, true); return call('ask_person_to_turn_on', { proposalId: p.proposalId }); };
    try {
      const first = await ask('send my boss a weekly summary of what the Platform team finished, only to boss@example.com');
      assert.equal(first.status, 'approved', JSON.stringify(first)); assert.equal(asked, 1, 'control: with no hook the dialog decides');
      put(path.join(proj, '.claude', 'settings.local.json'), '{"hooks":{"\\u0045licitation":[{"hooks":[{"type":"command","command":"echo {\\"action\\":\\"accept\\"}"}]}]}}');
      const second = await ask('send my boss a weekly summary of what the Ops team finished, only to cto@example.com');
      assert.equal(second.status, 'awaiting_human', JSON.stringify(second)); assert.equal(asked, 1, 'no dialog: the person decides in the page');
    } finally { await client.close(); }
  } finally { for (const d of [ws, home, proj, bin]) rmSync(d, { recursive: true, force: true }); }
});

test('H3, new defect 1: the Trust page says what the hook check reads and what it can\'t see, without suggesting more', () => {
  const body = copy.trust.hooks.body;
  assert.match(body, /any mention of the name Elicitation/); assert.match(body, /however it is spelled or escaped/);
  assert.match(body, /plugin, skill or command kept outside the folders it reads/); assert.match(body, /adds hooks in its own code/); assert.match(body, /between Foundry's look and the dialog/);
  const review = readFileSync(path.join(here, 'review-security.test.mjs'), 'utf8');
  assert.doesNotMatch(review, /covers every place Claude Code takes hooks from/, 'the test name no longer claims every place');
});

test('security new defect 2: a second Foundry start on the same workspace leaves the other start\'s codes working; only expired codes are swept', () => {
  const ws = tmp('fix-gate-');
  try {
    let t = 1000;
    const site = createGate({ workspace: ws, instance: 'site-A', now: () => t });
    const code = mintCode(ws, { instance: 'site-A', now: t });
    createGate({ workspace: ws, instance: 'dashboard-B', now: () => t }); // `start`, or `mcp` with FOUNDRY_UI=dashboard, in the same folder
    const r = site.open(code);
    assert.equal(r.ok, true, `the code for the site still works (${r.code})`);
    mintCode(ws, { instance: 'site-A', now: t });
    t += 61000;
    createGate({ workspace: ws, instance: 'site-C', now: () => t });
    assert.deepEqual(readdirSync(codesDir(ws)), [], 'an expired code file is swept');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('security new defect 3: a stale lock is broken only while it is still the lock that was judged stale; processes never overlap', async () => {
  const dir = tmp('fix-lock-');
  try {
    const deadPid = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
    const file = path.join(dir, 'records.json'), lock = `${file}.lock`;
    writeFileSync(lock, JSON.stringify({ pid: deadPid, token: 'dead', at: 0 }));
    const judged = look(lock);
    // Before this process breaks it, another one broke it and took the lock: that live lock must survive this break.
    rmSync(lock); writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'live', at: Date.now() }));
    breakLock(lock, judged, 30000);
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).token, 'live', 'a lock taken after the judgment is left alone');
    assert.equal(existsSync(`${lock}.break`), false, 'the breaker is released');
    rmSync(lock);
    // Six processes start together on a lock whose holder died: none is ever inside while another is.
    writeFileSync(lock, JSON.stringify({ pid: deadPid, token: 'dead', at: 0 }));
    const worker = path.join(dir, 'worker.mjs');
    writeFileSync(worker, `import { withFileLock } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'app', 'onboarding', 'file-lock.mjs')).href)};
import { openSync, closeSync, rmSync, appendFileSync } from 'node:fs';
const [file, inside, out] = process.argv.slice(2);
for (let i = 0; i < 5; i++) withFileLock(file, () => {
  let fd; try { fd = openSync(inside, 'wx'); } catch { appendFileSync(out, 'OVERLAP\\n'); return; }
  closeSync(fd); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15); rmSync(inside); appendFileSync(out, 'ok\\n');
});\n`);
    const out = path.join(dir, 'out.txt'), inside = path.join(dir, 'inside');
    const codes = await Promise.all(Array.from({ length: 6 }, () => new Promise(resolve => spawn(process.execPath, [worker, file, inside, out], { stdio: 'ignore' }).on('exit', resolve))));
    assert.deepEqual(codes, [0, 0, 0, 0, 0, 0]);
    const lines = readFileSync(out, 'utf8').trim().split('\n');
    assert.equal(lines.filter(l => l === 'OVERLAP').length, 0); assert.equal(lines.length, 30);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('security new defects 4, 5 (and honesty new defect 6): a warning is printed as "warn", not "ok"; the CLI header says what a terminal test can and can\'t tell', () => {
  const repo = tmp('fix-warn-');
  try {
    assert.equal(doctorLine({ ok: true, say: 'fine' }), 'ok    fine');
    assert.equal(doctorLine({ ok: true, optional: true, warn: true, say: 'look' }), 'warn  look');
    assert.equal(doctorLine({ ok: false, optional: true, say: 'absent' }), 'note  absent');
    if (spawnSync('git', ['init', '-q', repo]).status === 0) {
      const ws = path.join(repo, 'foundry-data');
      const r = spawnSync(process.execPath, [CLI, 'doctor', '--workspace', ws], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: repo, FOUNDRY_HOME_DIR: repo, NODE_NO_WARNINGS: '1' } });
      assert.match(r.stdout, /^warn {2}Your Foundry folder .* is inside a git repository/m, r.stdout);
      assert.doesNotMatch(r.stdout, /^ok {2,}Your Foundry folder .* inside a git repository/m);
      assert.equal(doctor({ workspace: ws }).items.find(i => i.check === 'Workspace location').warn, true);
    }
    const header = readFileSync(CLI, 'utf8').split('\nimport ')[0];
    assert.doesNotMatch(header, /never when the output is piped or\n\/\/ captured/); assert.match(header, /pseudo-terminal/); assert.match(header, /same-account limit/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('security new defect 6: "approved by" on the automation page carries "not a checked identity", as does "turned off by"', () => {
  assert.match(copy.automation.decisionList, /\{who\} \(not a checked identity\)/);
  assert.match(copy.automation.offNow, /\{who\} \(not a checked identity\)/);
});

// ================================================================================================ review:honesty
/** A run started from an approved list, with every decision logged. */
async function listRun(app) {
  recordDecisions(app);
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  const b = await batches.preview(p.flowId);
  const r = await batches.approve(b.batchId, { listDigest: listDigest(b) });
  return { p, batches, r, bundle: () => JSON.parse(JSON.stringify(evidenceBundle(app, r.runId, { batches }))) };
}
const tampered = (bundle, change) => { const x = structuredClone(bundle); change(x); return checkEvidence(x); };

test('honesty new defect 1 (major): a genuine evidence file stays consistent after 205 later lists; only lists nobody decided on are trimmed', async () => withApp(async app => {
  const { p, batches, bundle } = await listRun(app);
  assert.equal(checkEvidence(bundle()).ok, true, 'control: fresh');
  // 205 later previews, as pressing "Make the list" or run_flow would leave them (written directly, then one real preview saves the file).
  const file = path.join(app.root, 'batches.json'), list = JSON.parse(readFileSync(file, 'utf8'));
  for (let i = 0; i < 205; i++) list.push({ batchId: `later-${i}`, flowId: p.flowId, status: 'replaced', decision: null, items: [], createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW).toISOString() });
  writeFileSync(file, JSON.stringify(list));
  await batches.preview(p.flowId);
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(after.filter(b => !b.decision).length <= 200, 'undecided lists are trimmed');
  assert.ok(after.some(b => b.decision?.approved), 'the approved list is kept');
  const r = checkEvidence(bundle());
  assert.equal(r.ok, true, r.problems.join('; '));
}));

test('honesty new defects 2, 3: how Foundry knew who decided is compared with the logged line, and "not turned on" must agree with the log', async () => withApp(async app => {
  const { bundle } = await listRun(app);
  const good = bundle();
  assert.equal(checkEvidence(good).ok, true);
  const cases = {
    'turnedOn.identityVerified': [x => { x.turnedOn.identityVerified = true; }, /how Foundry knew who decided/],
    'turnedOn.howKnown (a passkey)': [x => { x.turnedOn.howKnown = 'A passkey only this person holds.'; }, /how Foundry knew who decided/],
    'turnedOn.channelWords': [x => { x.turnedOn.channelWords = 'a signed approval'; }, /how Foundry knew who decided/],
    'turnedOn.note': [x => { x.turnedOn.note = 'Approved by the board'; }, /or its note does not/],
    'run.identityVerified': [x => { x.run.identityVerified = true; }, /how Foundry knew who started the run/],
    'run.howKnown': [x => { x.run.howKnown = 'Signed with a passkey.'; }, /how Foundry knew who started the run/],
    'run.startedNote': [x => { x.run.startedNote = 'Started by Ravi, verified.'; }, /how Foundry knew who started the run/],
    'batch.decision.who': [x => { x.batch.decision.who = { ...x.batch.decision.who, name: 'Mallory' }; }, /the list: who decided, or how, does not match/],
    'turnedOn: null': [x => { x.turnedOn = null; }, /says this version was not turned on, but log line \d+ turned it on/]
  };
  for (const [name, [change, problem]] of Object.entries(cases)) {
    const r = tampered(good, change);
    assert.equal(r.ok, false, `${name} must not be consistent`);
    assert.ok(r.problems.some(x => problem.test(x)), `${name}: ${r.problems.join('; ')}`);
  }
  const ok = checkEvidence(good);
  assert.ok(ok.checked.sections.some(s => /how Foundry knew who it was \(not a verified identity\)/.test(s)));
  assert.ok(ok.checked.notChecked.some(s => /requestedAt, decidedAt/.test(s)), 'it names the turn-on fields it does not check');
}));

test('honesty new defect 4: a decision-log head copied earlier is found among a later file\'s links (check-evidence --head), and the advice says so', async () => withApp(async app => {
  const { bundle } = await listRun(app);
  const early = bundle(), earlyLogHead = early.personDecisions.check.head;
  app.decisions.append({ kind: 'name-changed', decision: 'changed', from: null, to: 'Ravi', channel: 'dashboard' }); // a later decision
  const later = bundle();
  assert.notEqual(later.personDecisions.check.head, earlyLogHead, 'the log grew');
  assert.match(headIn(later, earlyLogHead), /^decision-log line \d+ of \d+; the file's log continues from it$/);
  assert.equal(headIn(later, later.chain.head), 'the run\'s chain head');
  assert.match(later.howToCheck, /must appear among personDecisions\.links at the place it had then, not as the last link/);
  const dir = tmp('fix-head-');
  try {
    const f = path.join(dir, 'later.json'); writeFileSync(f, JSON.stringify(later));
    const run = (...heads) => spawnSync(process.execPath, [CLI, 'check-evidence', f, ...heads.flatMap(h => ['--head', h])], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, NODE_NO_WARNINGS: '1' } });
    const ok = run(earlyLogHead, later.chain.head);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /must appear among this file's decision-log links, at the place it had then, not as its last link/);
    assert.match(ok.stdout, /the file's log continues from it/);
    const no = run('f'.repeat(64));
    assert.equal(no.status, 1); assert.match(no.stdout, /NOT in this file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(copy.run.decisionsHeadNote, /--head/); assert.match(copy.runs.auditorBody, /among its links, not at the end/);
}));

test('honesty new defect 5: "Nothing else" is gone; the Trust page and the IT brief say the AI builders send too', async () => withApp(async (app, dir) => {
  assert.doesNotMatch(copy.trust.leaves.body, /Nothing else/); assert.match(copy.trust.leaves.body, /An AI builder is the one other thing that sends/);
  const leaves = briefData(app, { connect: connectInstructions(dir), date: new Date(NOW) }).sections.find(s => s.title === 'What leaves this computer');
  assert.ok(leaves.lines.every(l => !/Nothing else/.test(l)), leaves.lines.join('\n'));
  assert.ok(leaves.lines.some(l => /An AI builder .* is the one other thing that sends/.test(l)));
}));

test('honesty new defect 7: the frozen files are as frozen (MANIFEST-fix.json); the site\'s wording and the plain-text check live outside them and still hold', async () => {
  const m = spawnSync(process.execPath, [path.join(ROOT, 'experiments', 'surface', 'manifest.mjs'), '--out', 'MANIFEST-fix.json'], { encoding: 'utf8' });
  assert.equal(m.status, 0, m.stdout); assert.match(m.stdout, /frozen files unchanged/);
  const { failureText } = await import('../../core/failure-words.mjs');
  assert.match(failureText({ code: 'VERIFY_FAILED' }).what, /written to send/); assert.match(failureText({ code: 'PRACTICE_ONLY' }).next, /Ask whoever set up the pilot/);
  // A model builder's settings get the same check as the form's (L8): a direction mark in a one-line setting is refused at propose.
  const form = new TemplateFormBuilder();
  const forger = { id: 'model-stand-in', async build(a) {
    const built = form.build({ template: 'weekly-report', settings: { team: 'Platform', recipient: 'boss@example.com' }, origin: 'site-form' });
    const tag = built.workflow.metadata.tags.findIndex(x => x.startsWith('slots:'));
    built.workflow.metadata.tags[tag] = `slots:${JSON.stringify({ ...JSON.parse(built.workflow.metadata.tags[tag].slice(6)), team: 'Plat‮form' })}`;
    return { ...built, builder: 'model-stand-in' };
  }, rebase: b => b };
  const dir = tmp('fix-l8-');
  const app = new FoundryApp({ workspace: dir, builder: forger });
  try {
    const r = await app.propose({ request: 'weekly report' });
    assert.equal(r.status, 'build_failed', JSON.stringify(r)); assert.match(r.problems.join(' '), /team must be one line of plain text/);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('honesty older defects: C08 says verified packs are paid too; the dialog names the data the practice ran on; tokenCap is not a setting', async () => withApp(async (app, dir) => {
  assert.match(claims.C08.text, /verified packs/); assert.doesNotMatch(claims.C08.text, /Paid only when/); assert.match(copy.pricing.h1, /verified packs/);
  assert.throws(() => saveSettings(dir, { tokenCap: 5000 }), e => e.code === 'SETTINGS' && /--token-cap/.test(e.message));
  // The practice ran on the person's own list: the dialog says so, not "pretend data".
  const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' });
  liveInvoices(app);
  const d = await app.dryRun({ proposalId: p.proposalId, sheets: { invoices: readWorld(app.worldDir).sheets.invoices }, input: IN });
  assert.equal(d.passed, true); assert.equal(d.dataSource, 'your-data');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await serveAppMcp(app, { transport: serverSide, dialog: true });
  let message = null;
  const client = new Client({ name: 'claude-code', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, async req => { message = req.params.message; return { action: 'cancel' }; });
  await client.connect(clientSide);
  try {
    await client.callTool({ name: 'ask_person_to_turn_on', arguments: { proposalId: p.proposalId } });
    assert.match(message, /^Practice run on your own list \(nothing was made or sent\): passed/m); assert.doesNotMatch(message, /pretend data/);
  } finally { await client.close(); }
}));

test('keychain wording (security L11 note): the basis of the macOS claim is said as it is, not as Apple\'s documentation', () => {
  assert.doesNotMatch(copy.trust.keys.body, /from Apple's documentation;/); assert.match(copy.trust.keys.body, /not checked against Apple's documentation/);
  assert.doesNotMatch(claims.C10.qualifier, /from Apple's documentation of that command;/);
});

// ================================================================================================ review:UX (and the browser parts above)
let browserPromise = null;
const browser = () => (browserPromise ??= chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-background-networking', '--disable-sync', '--proxy-server=http://127.0.0.1:9'] }));
after(async () => { if (browserPromise) await (await browserPromise).close(); });
/** A site over a fresh workspace and a page opened with its one-time code at `route`. setup(app, dir) prepares it. */
async function withSite({ setup = null, route = null, siteOptions = {}, home = null } = {}, fn) {
  const dir = tmp('fix-ux-');
  const before = process.env.HOME;
  if (home) { chmodSync(dir, 0o755); process.env.HOME = dir; } // the workspace is the home folder: Foundry leaves its mode as it is
  let app;
  try { app = await siteApp({ workspace: dir }); } finally { if (home) process.env.HOME = before; }
  const ids = (await setup?.(app, dir)) ?? {};
  const site = createSite(app, { workspace: dir, now: () => NOW, keychain: new Keychain({ backend: 'ephemeral' }), ...siteOptions });
  const { port } = await site.listen(0);
  const context = await (await browser()).newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', r => { const u = new URL(r.request().url()); return ['blob:', 'data:'].includes(u.protocol) || u.hostname === '127.0.0.1' ? r.continue() : r.abort(); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const go = async r => {
    await page.evaluate(() => document.querySelectorAll('main h1').forEach(h => h.setAttribute('data-old', '')));
    await page.evaluate(x => { location.hash = x; }, r);
    await page.waitForFunction(() => document.querySelector('main h1:not([data-old])') && !document.getElementById('view').hasAttribute('aria-busy'), null, { timeout: 15000 });
  };
  try {
    await page.goto(site.openUrl(typeof route === 'function' ? route(ids) : route));
    await page.waitForSelector('main h1');
    await fn({ page, app, site, go, ids, dir, base: `http://127.0.0.1:${port}` });
    assert.deepEqual(errors, [], 'no page errors');
  } finally { await context.close(); await site.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('honesty minor 6 (not closed): the Trust page says "only your user" only when the folder is private now', async () => {
  await withSite({ home: true, route: '/trust' }, async ({ page }) => {
    const p = page.locator('[data-trust="where"] [data-workspace-private]');
    assert.equal(await p.getAttribute('data-workspace-private'), 'false');
    assert.match(await p.innerText(), /Other users of this computer may be able to open it \(mode 0755\)/);
    assert.doesNotMatch(await page.locator('[data-trust="where"]').innerText(), /private to your user|Only your user/);
  });
  await withSite({ route: '/trust' }, async ({ page }) => {
    assert.match(await page.locator('[data-trust="where"] [data-workspace-private="true"]').innerText(), /^Only your user can open it \(mode 0700\)/);
  });
});

test('UX new defects 1, 8: the AI keys page shows no "null", and a saved key redraws its card (Remove, no paste field)', async () => {
  const provider = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  try {
    await withSite({ setup: app => saveSettings(app.root, { allowedAI: 'mercury' }), route: '/keys', siteOptions: { keyCheckBaseUrl: `http://127.0.0.1:${provider.address().port}/v1` } }, async ({ page }) => {
      await page.waitForSelector('#key-inception');
      assert.doesNotMatch(await page.locator('main').innerText(), /\bnull\b/, 'no "null" under the heading');
      await page.fill('#key-inception', 'TESTKEY-fix-round-0000-wxyz');
      await page.locator('[data-provider="inception"] button.primary').click();
      await page.waitForSelector('[data-provider="inception"] [data-key-saved]');
      assert.match(await page.locator('[data-provider="inception"] [data-key-saved]').innerText(), /wxyz/);
      assert.equal(await page.locator('#key-inception').count(), 0, 'no paste field beside "Saved"');
      assert.equal(await page.locator('[data-action="remove-key"]').count(), 1, 'Remove is there at once');
      assert.doesNotMatch(await page.locator('main').innerText(), /\bnull\b/);
    });
  } finally { await new Promise(r => provider.close(r)); }
});

test('UX new defect 2: a removed draft\'s test result offers neither Turn it on nor Remove, and a second remove says nothing changed', async () => withSite({
  setup: async app => {
    const keep = await app.propose({ template: 'weekly-report', settings: { recipient: 'me@example.com' }, origin: 'site-form' });
    await app.dryRun({ proposalId: keep.proposalId });
    const gone = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' });
    await app.dryRun({ proposalId: gone.proposalId });
    app.withdraw({ proposalId: gone.proposalId, channel: 'dashboard' });
    return { keep: keep.proposalId, gone: gone.proposalId };
  }, route: ids => `/checked/${ids.gone}`
}, async ({ page, go, app, ids }) => {
  await page.waitForSelector('[data-draft-removed]');
  assert.match(await page.locator('[data-draft-removed]').innerText(), /This draft was removed by .* \(not a checked identity\)/);
  for (const sel of ['[data-action="to-turn-on"]', '[data-turn-on]', '[data-action="remove-draft"]', '[data-next-step]'])
    assert.equal(await page.locator(sel).count(), 0, `${sel} is not offered`);
  // The other draft: its strip link stays on this page (review:UX nit), and a remove after another tab removed it says nothing changed.
  await go(`#/checked/${ids.keep}`);
  assert.equal(await page.locator('[data-action="to-turn-on"]').getAttribute('href'), `#/checked/${ids.keep}`);
  app.withdraw({ proposalId: ids.keep, channel: 'dashboard' });
  await page.locator('[data-action="remove-draft"]').click();
  await page.waitForSelector('[data-error-panel]');
  const panel = await page.locator('[data-error-panel]').innerText();
  assert.match(panel, /Nothing changed: it had been removed already\./); assert.doesNotMatch(panel, /The draft was not removed\./);
}));

test('UX new defect 3: each "Remove this draft" button says which draft it is for', async () => withSite({
  setup: async app => {
    await app.propose({ template: 'weekly-report', settings: { recipient: 'me@example.com' }, origin: 'site-form' });
    await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' });
  }, route: '/automations'
}, async ({ page }) => {
  const described = await page.$$eval('[data-action="remove-draft"]', bs => bs.map(b => { const id = b.getAttribute('aria-describedby'); return id ? document.getElementById(id)?.textContent.trim() : null; }));
  assert.equal(described.length, 2); assert.ok(described.every(Boolean), JSON.stringify(described)); assert.notEqual(described[0], described[1]);
}));

test('UX new defect 4: a name that was not saved is put back to the one in force', async () => withSite({ setup: app => saveSettings(app.root, { yourName: 'Ravi Patel' }), route: '/settings' }, async ({ page }) => {
  await page.fill('#your-name', 'Ravi <script>');
  await page.locator('[data-action="save-name"]').click();
  await page.waitForSelector('[data-saved="name"] [data-error-panel]');
  assert.equal(await page.inputValue('#your-name'), 'Ravi Patel');
}));

test('UX new defect 5: what is already waiting when a page opens is said once (the notice sits above the heading); polls do not repeat it', async () => withSite({
  setup: async app => { const p = await invoiceFlowOn(app); liveInvoices(app); await new Batches(app, { now: () => NOW }).preview(p.flowId); }, route: '/automations'
}, async ({ page }) => {
  const said = [];
  await page.exposeFunction('noteSaid', text => said.push(text));
  await page.evaluate(() => new MutationObserver(() => window.noteSaid(document.getElementById('live-polite').textContent)).observe(document.getElementById('live-polite'), { childList: true, characterData: true, subtree: true }));
  await page.waitForFunction(() => !document.getElementById('notice').hidden, null, { timeout: 15000 });
  await page.waitForTimeout(11000); // two polls
  const notices = said.filter(s => /waiting for you/i.test(s));
  assert.ok(notices.length <= 1, JSON.stringify(said));
  // The page opened afresh at a page with the notice (a reload keeps this tab's key) says it exactly once, then never again on a poll.
  await page.addInitScript(() => { window.__said = []; document.addEventListener('DOMContentLoaded', () => { const live = document.getElementById('live-polite');
    new MutationObserver(() => { if (live.textContent) window.__said.push(live.textContent); }).observe(live, { childList: true, characterData: true, subtree: true }); }); });
  await page.goto(page.url().replace(/#.*$/, '#/runs'));
  await page.reload();
  await page.waitForSelector('main h1');
  await page.waitForTimeout(12000); // the first check, then two polls
  const once = await page.evaluate(() => window.__said.filter(x => /waiting for you/i.test(x)));
  assert.equal(once.length, 1, JSON.stringify(once));
  const harness = readFileSync(path.join(here, 'journeys', 'harness.mjs'), 'utf8');
  assert.match(harness, /Outside main too/, 'the fallback check looks outside main');
}));

test('UX new defect 6: remembered answers keep the ticked values only (the rest as fingerprints), and "Delete my lists" deletes them', async () => {
  const s = await startSite();
  try {
    const q = [{ id: 'values:status', kind: 'many', choices: [{ value: 'Overdue' }, { value: 'Part paid' }, { value: 'Sent' }] }];
    rememberAnswers(s.app.root, { template: 'invoice-chase', sheet: 'invoices', header: ['Status', 'Total'], questions: q, answers: { 'values:status': ['Overdue'] } });
    const file = path.join(s.app.root, 'site', 'data-answers.json'), text = readFileSync(file, 'utf8');
    assert.match(text, /Overdue/); assert.doesNotMatch(text, /Part paid|"Sent"/);
    assert.deepEqual(recallAnswers(s.app.root, { template: 'invoice-chase', sheet: 'invoices', header: ['Total', 'Status'], questions: q })[0].remembered.value, ['Overdue'], 'still offered for the same file');
    const wider = [{ ...q[0], choices: [...q[0].choices, { value: 'Disputed' }] }];
    assert.equal(recallAnswers(s.app.root, { template: 'invoice-chase', sheet: 'invoices', header: ['Status', 'Total'], questions: wider })[0].remembered, undefined, 'asked afresh when a new value appears');
    assert.equal((await s.post('/api/data/forget', { confirm: 'delete my lists' })).status, 200);
    assert.equal(existsSync(file), false, 'Delete my lists deletes the remembered answers');
    assert.match(copy.settings.forgetBody, /answers Foundry remembered about your files/);
  } finally { await s.close(); }
});

test('UX new defect 7: an automation that is turned off shows "Turn on" as the step to do, not done', async () => withSite({
  setup: async app => { const p = await invoiceFlowOn(app); await app.turnOff({ flowId: p.flowId, channel: 'dashboard' }); return { flowId: p.flowId }; }, route: ids => `/go-live/${ids.flowId}`
}, async ({ page }) => {
  const steps = await page.$$eval('.stepper li', ls => ls.map(l => ({ text: l.textContent, current: l.getAttribute('aria-current') === 'step', done: l.classList.contains('done') })));
  const turnOn = steps.find(s => /Turn on/i.test(s.text));
  assert.ok(turnOn, JSON.stringify(steps)); assert.equal(turnOn.current, true); assert.equal(turnOn.done, false); assert.doesNotMatch(turnOn.text, /\(done\)/);
}));

test('UX nit: an example amount in yen has no decimals (one yen either side of the limit)', () => {
  const map = { parameters: { p: { value: 250, unit: 'JPY' } }, approvals: [], principals: [] };
  const labels = generateExamples({ check: { kind: 'approval-above-threshold', parameter: 'p' } }, map).map(x => x.label);
  assert.ok(labels.every(l => !/\d\.\d/.test(l)), labels.join(' | ')); assert.ok(labels.includes('249 JPY') && labels.includes('251 JPY'), labels.join(' | '));
  const eur = generateExamples({ check: { kind: 'approval-above-threshold', parameter: 'p' } }, { ...map, parameters: { p: { value: 250, unit: 'EUR' } } }).map(x => x.label);
  assert.ok(eur.includes('€249.99'), eur.join(' | '));
  assert.match(copy.settings.whereNote, /light or dark look/); assert.match(copy.trust.data.body, /light or dark look/);
});
