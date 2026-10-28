// Regression tests for the honesty review of 2026-10-21 (onboarding workflow, review:honesty; B1, M1-M11, minors 1-17). Each test names
// the finding it holds; the behavioural ones (B1, M1, M2 in mcp-dashboard.test.mjs, M7, M8, M10, minors 6 and 16) fail when their fix is
// put back to the code before it (commit cd0dc23d). Wording findings are also held by the overclaim lint (copy-lint.test.mjs), the claims
// test (claims.test.mjs) and the journeys (crawl: claims with status and qualifier; import; keys; p5-auditor). $0, no model, loopback only.
// nice -n 15 node --test --test-concurrency=1 app/site/test/review-honesty.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, statSync, chmodSync, chownSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSite } from './helpers.mjs';
import { FoundryApp, privateWorkspace, workspacePrivacy } from '../../core/service.mjs';
import { failureText } from '../../core/explain.mjs';
import { Batches, listDigest } from '../../onboarding/batch.mjs';
import { DecisionLog, recordDecisions, linkHash } from '../../onboarding/decisions.mjs';
import { evidenceBundle, checkEvidence } from '../../onboarding/evidence.mjs';
import { importReport } from '../../onboarding/importers.mjs';
import { admission } from '../../onboarding/detect.mjs';
import { briefData, PILOT_TERMS, SAME_USER_LIMIT, GAPS } from '../../onboarding/brief.mjs';
import { connectInstructions, doctor } from '../../cli.mjs';
import { withApp, invoiceFlowOn, liveInvoices, NOW } from '../../onboarding/test/helpers.mjs';
import { digest } from '../../../src/data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', '..', 'cli.mjs');
const PUBLIC = path.join(here, '..', 'public');
const ROOT = path.join(here, '..', '..', '..');
const copy = JSON.parse(readFileSync(path.join(PUBLIC, 'copy', 'en.json'), 'utf8'));
const { claims } = JSON.parse(readFileSync(path.join(here, '..', 'claims.json'), 'utf8'));
const view = name => readFileSync(path.join(PUBLIC, 'views', `${name}.js`), 'utf8');

/** A run started from an approved list, with every decision logged: the evidence file the review tampered with. */
async function listRun(app) {
  recordDecisions(app);
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  const b = await batches.preview(p.flowId);
  const r = await batches.approve(b.batchId, { listDigest: listDigest(b) });
  return { p, batches, r, bundle: JSON.parse(JSON.stringify(evidenceBundle(app, r.runId, { batches }))) };
}
const tampered = (bundle, change) => { const x = structuredClone(bundle); change(x); return checkEvidence(x); };

test('B1: check-evidence checks who decided, the list and the turn-on history against the logged decisions, and names what it did not check', async () => withApp(async app => {
  const { bundle } = await listRun(app);
  assert.equal(bundle.schema, 'foundry-evidence/4');
  const good = checkEvidence(bundle);
  assert.equal(good.ok, true, good.problems.join('; '));
  for (const s of [/^turned on: /, /^turn-on history/, /^the list \(4 items\) and who started the run/, /^decisions on paused actions \(4\)/, /^decision log/, /^practice run: it is the one the logged turn-on rests on/])
    assert.ok(good.checked.sections.some(x => s.test(x)), `checked: ${s}\n${good.checked.sections.join('\n')}`);
  assert.ok(good.checked.notChecked.some(x => /practice run's result/.test(x)), 'it says what it could not check');
  // The review's reproduction: approvers rewritten to "Mallory", a recipient changed, a decision line deleted. Each was "ok": true.
  const cases = {
    'turnedOn.by': [x => { x.turnedOn.by = 'Mallory'; }, /turned on: who, how or which version does not match/],
    'run.startedBy': [x => { x.run.startedBy = 'Mallory'; }, /started by: it does not match/],
    'ledger[].by': [x => { x.ledger[0].by = 'Mallory'; }, /turn-on history: .* does not match/],
    'batch.decision.by': [x => { x.batch.decision.by = 'Mallory'; }, /the list: who decided, or how, does not match/],
    'batch.list[0].to': [x => { x.batch.list[0].to = 'mallory@example.invalid'; }, /the list: its items .* are not the ones the person decided on/],
    'a deleted decision line': [x => { x.personDecisions.lines.splice(1, 1); }, /belongs to this automation but is not in the file/],
    'a list item it says was applied': [x => { x.actionDecisions.find(d => d.fromList).fromList.item = 99; }, /does not say which list item it applied/],
    'an action decision dropped': [x => { x.actionDecisions = x.actionDecisions.filter(d => d.type !== 'approval.decided'); }, /not the ones the run's events record|leaves out the decision/],
    'the practice run swapped': [x => { x.practice.dryRunId = 'another'; }, /not the practice run the logged turn-on rests on/]
  };
  for (const [name, [change, problem]] of Object.entries(cases)) {
    const r = tampered(bundle, change);
    assert.equal(r.ok, false, `${name} must not be consistent`);
    assert.ok(r.problems.some(x => problem.test(x)), `${name}: ${r.problems.join('; ')}`);
  }
}));

test('B1: every decision-log link can be checked from its parts, so a hidden line\'s automation cannot be changed to hide it from the file', async () => withApp(async app => {
  const { bundle } = await listRun(app);
  const links = bundle.personDecisions.links;
  assert.ok(links.length >= 6 && links.every(l => l.v === 2 && linkHash(l) === l.hash), 'each link\'s hash covers its place, automation and content');
  assert.ok(bundle.personDecisions.lines.some(l => l.kind === 'list-item'), 'the yeses applied from the list name their automation now, so the file carries them');
  // Hide a line by relabelling its link as another automation's: the link no longer checks.
  const r = tampered(bundle, x => { const l = x.personDecisions.lines.pop(); x.personDecisions.links[l.seq - 1].flowId = 'someone-else'; });
  assert.equal(r.ok, false); assert.ok(r.problems.some(p => /does not cover its place, automation and content/.test(p)), r.problems.join('; '));
  // An older log (lines without v) still verifies, and its links say they cannot be proved.
  const dir = mkdtempSync(path.join(tmpdir(), 'honesty-oldlog-'));
  try {
    mkdirSync(path.join(dir, 'site'), { recursive: true });
    const old = { seq: 1, at: '2026-10-20T10:00:00.000Z', kind: 'turn-on', decision: 'approved', flowId: 'x', prev: null };
    writeFileSync(path.join(dir, 'site', 'decisions.jsonl'), `${JSON.stringify({ ...old, hash: digest(old) })}\n`);
    const log = new DecisionLog(dir);
    log.append({ kind: 'name-changed', decision: 'changed', channel: 'dashboard' });
    assert.equal(log.verify().ok, true, log.verify().reason);
    assert.deepEqual(log.links().map(l => l.v ?? 1), [1, 2]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}));

test('B1: `check-evidence` prints exactly which sections it checked and which it could not', async () => withApp(async app => {
  const { bundle } = await listRun(app);
  const dir = mkdtempSync(path.join(tmpdir(), 'honesty-cli-'));
  try {
    const good = path.join(dir, 'good.json'), bad = path.join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify(bundle));
    writeFileSync(bad, JSON.stringify({ ...bundle, turnedOn: { ...bundle.turnedOn, by: 'Mallory' } }));
    const run = f => spawnSync(process.execPath, [CLI, 'check-evidence', f], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: '1' } });
    const ok = run(good);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^Consistent\. Checked:\n- run events/m); assert.match(ok.stdout, /^- turned on: /m); assert.match(ok.stdout, /^- the list \(4 items\)/m);
    assert.match(ok.stdout, /^Not checked:\n- /m); assert.match(ok.stdout, /practice run's result/); assert.match(ok.stdout, /copies kept somewhere else/);
    assert.doesNotMatch(ok.stdout, /each linked to the one before\b(?!.*events)/, 'no blanket claim about the decisions');
    const no = run(bad);
    assert.equal(no.status, 1); assert.match(no.stdout, /^Not consistent:\n- turned on: /m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}));

test('M1: an n8n import shows ✓ only for what Foundry did; running it and calling it in n8n are not offered as done', () => {
  const node = (name, type, parameters = {}) => ({ name, type, typeVersion: 1, position: [0, 0], parameters });
  const main = (...pairs) => Object.fromEntries(pairs.map(([from, to]) => [from, { main: [[{ node: to, type: 'main', index: 0 }]] }]));
  // Lowers to Foundry steps (app/test/n8n-import.test.mjs "callback"), with a Slack step that has no host adapter.
  const flow = { name: 'Callback', nodes: [node('Hook', 'n8n-nodes-base.webhook', { path: 'x', httpMethod: 'POST' }), node('Wait for payment', 'n8n-nodes-base.wait', { resume: 'webhook' }),
    node('Tell', 'n8n-nodes-base.slack', { resource: 'message', operation: 'post', text: '={{ $json.body.note }}' })], connections: main(['Hook', 'Wait for payment'], ['Wait for payment', 'Tell']) };
  const r = importReport(JSON.stringify(flow));
  const by = Object.fromEntries(r.lines.map(l => [l.key, l]));
  assert.equal(by.translated.status, 'yes'); assert.match(by.translated.text, /Not run/);
  assert.equal(by.run.status, 'no'); assert.match(by.run.text, /can't run it yet: it needs connectors .*slack/);
  assert.equal(by.wrap.status, 'planned'); assert.equal(by.wrap.yes, false, 'calling it in n8n is designed, not built'); assert.match(by.wrap.text, /designed, not built/);
  assert.equal(r.lines.some(l => l.yes && /can run|can be called/i.test(l.text)), false);
  assert.match(view('import'), /status === 'planned'/); assert.match(view('import'), /l\.status === 'yes' \? '✓'/);
  assert.match(claims.C06.text, /0 were run/); assert.doesNotMatch(claims.C06.text, /came over exactly|can be called as they are/);
});

test('M2: Codex is not said to lack a dialog, and a declined dialog is not the person\'s no (the MCP test holds the behaviour)', () => {
  assert.match(copy.connect.codex.note, /mcp_elicitations/); assert.doesNotMatch(copy.connect.codex.note, /no documented dialog/);
  assert.match(readFileSync(path.join(here, '..', '..', 'test', 'mcp-dashboard.test.mjs'), 'utf8'), /declined_by_client/);
});

test('M3, M9: what Claude Code asks about, and the hooks Foundry cannot see, are said as they are', async () => withApp(async (app, dir) => {
  assert.match(copy.connect.claudeCode.note, /always asks you before ask_person_to_turn_on/); assert.match(copy.connect.claudeCode.note, /may run without asking/);
  assert.match(copy.trust.hooks.body, /can't see hooks/); assert.match(copy.trust.hooks.body, /If you use plugins, ask IT to turn on allowManagedHooksOnly/);
  const note = connectInstructions(dir).note;
  assert.doesNotMatch(note, /always asks you, never your agent/); assert.match(note, /A hook Foundry cannot see could still answer/);
  assert.ok(PILOT_TERMS.some(t => /allowManagedHooksOnly/.test(t) && /plugins/.test(t) && !/no hook on the machine can/.test(t)));
}));

test('M4: pricing says what decision D2 is (reversible, no price) and no more', () => {
  assert.equal(copy.pricing.freeTitle, 'Free for one person'); assert.match(copy.pricing.decidedNote, /reversible/); assert.match(copy.pricing.decidedNote, /No price is set/);
  assert.match(view('pricing'), /t\('pricing\.decidedNote'\)/);
  assert.match(copy.pricing.undecided, /a recommendation, not the owner's decision/);
  assert.match(claims.C08.qualifier, /reversible/);
});

test('M5, minors 1-5: each claim\'s status and words match its evidence', () => {
  for (const id of ['C04', 'C05', 'C07']) assert.equal(claims[id].status, 'Research result', id);
  assert.equal(claims.C11.status, 'Literature'); assert.equal(claims.C02.status, 'Not re-tested');
  // C12 was measured on the earlier prototype, like C02, so it is not "Works now" either; C01 cites the current product's design table.
  assert.equal(claims.C12.status, 'Not re-tested'); assert.match(claims.C12.qualifier, /not been re-measured/);
  assert.equal(claims.C01.source.path, 'research/onboarding-20261021/DESIGN.md');
  assert.match(claims.C03.text, /your own list/);
  assert.match(claims.C01.text, /^Nothing real is made or sent until you say yes/);
  assert.match(claims.C07.text, /973 of 1022/); assert.match(claims.C07.text, /41 of 45/);
  assert.match(claims.C04.qualifier, /11 arm errors/); assert.match(claims.C04.qualifier, /complete, correct specification/);
  assert.equal(claims.C13.evidence, 'design'); assert.match(claims.C13.text, /has not been tried there/);
  assert.doesNotMatch(claims.C14.text, /unless you ask for it/);
});

test('M6: a claim used in a page carries its status and qualifier (the crawl journey checks every page)', () => {
  const site = readFileSync(path.join(PUBLIC, 'site.js'), 'utf8');
  assert.match(site, /claimQualifier/); assert.doesNotMatch(site, /c\.status !== 'Works now'/);
  assert.match(readFileSync(path.join(here, 'journeys', 'crawl.mjs'), 'utf8'), /claims shown without their status or qualifier/);
});

test('M7, M8: a key is sent to be checked only when Allowed AI includes its provider, and the limit is per build, not daily', async () => {
  const seen = [];
  const provider = createServer((req, res) => { seen.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  const s = await startSite({ keyCheckBaseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  try {
    const before = await s.get('/api/keys');
    assert.equal(before.providers.find(p => p.provider === 'inception').allowed, false);
    assert.equal(before.tokenCap, 200000, 'the per-build limit this start uses');
    const refused = await s.post('/api/keys', { provider: 'inception', key: 'CANARY-honesty-0000-1111' });
    assert.equal(refused.status, 409); assert.equal(refused.error.code, 'KEY_NOT_ALLOWED');
    assert.equal(seen.length, 0, 'nothing left the computer while Allowed AI was none');
    await s.post('/api/settings', { allowedAI: 'mercury' });
    assert.equal((await s.get('/api/keys')).providers.find(p => p.provider === 'inception').allowed, true);
    const saved = await s.post('/api/keys', { provider: 'inception', key: 'CANARY-honesty-0000-1111' });
    assert.equal(saved.saved, true); assert.equal(seen.length, 1);
  } finally { await s.close(); await new Promise(r => provider.close(r)); }
  assert.match(copy.trust.leaves.body, /^Foundry itself sends one thing: when you press Check and save on an AI key/);
  assert.match(copy.keys.limit, /\{cap\}/); assert.match(copy.keys.limit, /There is no daily limit/);
});

test('M7: the IT brief lists the key check among what leaves the computer', async () => withApp(async (app, dir) => {
  const b = briefData(app, { connect: connectInstructions(dir), date: new Date(NOW) });
  const leaves = b.sections.find(x => x.title === 'What leaves this computer').lines.join('\n');
  assert.match(leaves, /one request \(GET <provider>\/models, with the key\)/); assert.match(leaves, /only if Allowed AI includes that provider/);
}));

test('M10: every allowlist entry Foundry gives sets allowManagedMcpServersOnly, and an approved catalog that lists Foundry admits it', async () => withApp(async (app, dir) => {
  const c = connectInstructions(dir), argv = c.allowlist.serverCommand;
  assert.deepEqual(c.allowlist.managedSettings, { allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverCommand: argv }] });
  assert.match(view('trust'), /c\.allowlist\.managedSettings/);
  const b = briefData(app, { connect: c, date: new Date(NOW) }), entry = b.sections.find(x => x.title === 'Allowlist entry (exact)');
  assert.equal(JSON.parse(entry.code).allowManagedMcpServersOnly, true); assert.ok(entry.lines.some(l => /soft allowlist/.test(l)));
  // Before: allowManagedMcpServersOnly answered "no" without looking at the list, so the recommended entry read as a refusal.
  assert.equal(admission({ settings: { allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverCommand: argv }] } }, argv).admitted, 'yes');
  assert.equal(admission({ settings: { allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverCommand: ['/other'] }] } }, argv).admitted, 'no');
  assert.match(admission({ settings: { allowedMcpServers: [{ serverCommand: argv }] } }, argv).why, /soft allowlist/);
}));

test('minor 6: a workspace that already existed is made private (0700) when Foundry starts, and "only your user" is said only when it is', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'honesty-mode-'));
  chmodSync(dir, 0o755);
  try {
    // Before Foundry starts: the doctor (Settings, the IT brief) says the folder is open, with its mode.
    const before = doctor({ workspace: dir });
    assert.equal(before.workspacePrivate, false); assert.match(before.items.find(i => i.check === 'Workspace privacy').say, /may be able to open .* \(mode 0755\)/);
    const app = new FoundryApp({ workspace: dir });
    try {
      assert.equal(statSync(dir).mode & 0o777, 0o700);
      assert.equal(doctor({ workspace: dir }).workspacePrivate, true);
      const kept = briefData(app, { connect: connectInstructions(dir), date: new Date(NOW) }).sections.find(x => x.title === 'Data kept, and how to delete it').lines.join('\n');
      assert.match(kept, /This workspace now: private \(mode 0700\)/);
    } finally { await app.close(); }
    // A folder of another account is left as it is, and nothing claims it is private.
    chmodSync(dir, 0o755); chownSync(dir, 65534, 65534);
    assert.equal(privateWorkspace(dir), false); assert.equal(statSync(dir).mode & 0o777, 0o755);
    assert.deepEqual(workspacePrivacy(dir), { private: false, mode: '0755', mine: false });
    assert.equal(doctor({ workspace: dir }).workspacePrivate, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(view('settings'), /workspacePrivate === true \? 'settings\.where' : 'settings\.whereOpen'/);
  assert.match(copy.settings.whereOpen, /Other users of this computer may be able to open it/);
  assert.doesNotMatch(JSON.stringify(PILOT_TERMS) + JSON.stringify(GAPS), /folders 0700, files 0600/);
});

test('minors 7-10, 12-13, 15: what is kept elsewhere, options vs plans, consistent statuses, no publishing implied, practice-only is no sandbox', async () => withApp(async (app, dir) => {
  assert.match(copy.settings.whereNote, /keychain/); assert.match(copy.settings.whereNote, /download/);
  assert.match(copy.trust.data.body, /if it isn't, nothing does/);
  assert.match(SAME_USER_LIMIT, /none of them is built or scheduled/); assert.match(copy.trust.limit.closes, /none of them is built or scheduled/);
  const items = copy.trust.before.items, status = copy.trust.before.status;
  assert.equal(status[items.findIndex(x => /leavers/.test(x))], 'undecided'); assert.equal(status[items.findIndex(x => /signed, pinned build/i.test(x))], 'undecided');
  const open = briefData(app, { connect: connectInstructions(dir), date: new Date(NOW) }).sections.find(x => x.title === 'Still open').lines.join('\n');
  assert.match(open, /leavers: not decided/); assert.match(open, /Signed, pinned builds: not decided/); assert.doesNotMatch(open, /when Foundry is published/);
  assert.match(PILOT_TERMS[0], /not a sandbox/); assert.match(copy.trust.pilot.items[0], /not a sandbox/);
  assert.match(copy.home.trust, /any other program running as you/);
  assert.match(copy.org.starters.refund.body, /not checked yet/);
}));

test('minor 11: status chips match what they mark (a saved Mercury key is Preview; a check result and a self-approved version are not "Decided")', () => {
  assert.doesNotMatch(view('keys'), /statusChip\('works'\)/);
  assert.doesNotMatch(view('run'), /statusChip\('decided'\)/);
  assert.doesNotMatch(view('org').match(/savedVersion[^\n]*/)[0], /statusChip\('decided'\)/);
});

test('minor 16: the record\'s word "delivered" is explained wherever the record is shown; the frozen stand-in keeps its words', async () => withApp(async app => {
  const { bundle } = await listRun(app);
  // The outbox check's words come from app/core/stand-ins.mjs, which the BUILDER-1 manifest freezes, so they stay in the hashed events...
  assert.match(JSON.stringify(bundle.events), /delivered/);
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'research', 'surface-20261021', 'eval', 'MANIFEST-fix.json'), 'utf8'));
  assert.equal(createHash('sha256').update(readFileSync(path.join(ROOT, 'app', 'core', 'stand-ins.mjs'))).digest('hex'), manifest.files['app/core/stand-ins.mjs'], 'stand-ins.mjs is unchanged since the freeze');
  // ...and the file says what they mean in its gaps, as do the IT brief (GAPS) and the run page.
  assert.ok(bundle.gaps.some(g => /"delivered"/.test(g) && /outbox on this computer/.test(g) && /cannot see whether the person sent it/.test(g)), bundle.gaps.join('\n'));
  assert.ok(GAPS.some(g => /"delivered"/.test(g)));
  assert.match(copy.run.gaps.delivered, /"delivered"/); assert.match(view('run'), /'delivered'/);
  // What the person reads when that check fails says "written", not "delivered".
  const failed = failureText({ code: 'VERIFY_FAILED' });
  assert.match(failed.what, /written to send/); assert.doesNotMatch(`${failed.what} ${failed.next}`, /delivered/);
}));

test('minor 17: the design notes say what was measured and what is Preview', () => {
  const design = readFileSync(path.join(ROOT, 'research', 'onboarding-20261021', 'DESIGN.md'), 'utf8');
  assert.doesNotMatch(design, /Codex documents no elicitation/); assert.doesNotMatch(design, /\| P1 Cursor or Codex \(no dialog\) \|/);
  assert.match(design, /\| Turn on \| Version-bound yes in the page \(`dashboard` channel\) or in the terminal \(`cli`\) \| The agent's dialog/);
  assert.doesNotMatch(design, /grounding check; elicitation approve;/, 'the Developers row does not list the dialog as Real');
  assert.match(design, /learn\.chatgpt\.com\/docs\/config-file\/config-reference/);
  assert.match(readFileSync(path.join(ROOT, 'research', 'onboarding-20261021', 'WALKTHROUGH.md'), 'utf8'), /Corrected by the honesty review \(B1/);
});
