// Tests for arm A1-C, the code-owned harness (experiments/autobench/harness/codeowned.mjs, run.mjs --harness codeowned).
// No model is called anywhere ($0): model nodes and sessions are scripted stand-ins (harness/codeowned-stubs.mjs).
//   node --test experiments/autobench/test/codeowned.test.mjs
// The end-to-end tests need the AutomationBench venv and skip without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO, VENV_PY, readJson } from '../lib.mjs';
import { runTasks } from '../run.mjs';
import { loadSplit } from '../split.mjs';
import { findSpan, copyLiteral, normalizeLedger, mergeLedgers, settleByCode, applyDecisions, readDecisions, sourceMap, ledgerPrompt, parseJsonReply, LEDGER_SYSTEM, ADJUDICATE_SYSTEM } from '../harness/ledger.mjs';
import { postconditionsFromLedger, evaluate, worldDiff, CHECKER_SYSTEM, PCMAP_SYSTEM } from '../harness/postconditions.mjs';
import { terminationDecision, briefSection } from '../harness/checker.mjs';
import { auditPipeline, codeownedConfig, codeownedManifest, manifestFiles, nodeModels, parseNodeModels, HARNESS_ID } from '../harness/codeowned.mjs';
import { entityTerms, listOf, renderInventory, ENUM_PLAN } from '../harness/inventory.mjs';
import { stubNodeRunner, stubSessionRunner } from '../harness/codeowned-stubs.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-c-${p}-`));
const HAVE_VENV = existsSync(VENV_PY);
const quiet = () => {};
const PHONE_TASK = 'simple.email_sf_contact_phone_update';
const HARNESS_FILES = ['codeowned.mjs', 'inventory.mjs', 'ledger.mjs', 'postconditions.mjs', 'checker.mjs', 'bridge-client.mjs'].map(f => path.join(REPO, 'experiments/autobench/harness', f));

// ---------------------------------------------------------------------------------------------------------------
// LEDGERS: verbatim copying, negatives, union, dedup, conflicts

const rec = (ptr, data, date = null) => ({ ptr, app: ptr.split(':')[0], kind: ptr.split(':')[1], id: ptr.split(':').slice(2).join(':'), date, data });
const INV = { connected: ['gmail', 'slack', 'salesforce'], outOfScope: ['xero'], truncated: [], precedents: [], records: [
  rec('gmail:message:m1', { from: 'boss@corp.example', subject: 'Routing policy', body_plain: 'Send the weekly summary to ops@corp.example with subject "Weekly Ops Digest".\nNever email vendor@out.example.' }, '2026-03-01'),
  rec('gmail:message:m2', { from: 'boss@corp.example', subject: 'Routing policy (update)', body_plain: 'Correction: the summary goes to ops-team@corp.example from now on.' }, '2026-03-05'),
  rec('slack:channel_list:C1', { id: 'C1', name: 'ops' }),
  rec('salesforce:Contact:003A', { Id: '003A', Name: 'Jordan Lee', Phone: '555-0100' }),
] };
const REQUEST = 'Please send this week\'s ops summary as our routing policy says.';
const SRC = sourceMap(REQUEST, INV);

test('verbatim: code copies the literal from the cited span (case, whitespace, typographic quotes), never the model\'s paraphrase', () => {
  assert.equal(findSpan('weekly  OPS digest', 'subject "Weekly Ops Digest".'), 'Weekly Ops Digest');
  assert.equal(findSpan('the “Q3 Budget” review', 'see the "Q3 Budget"\n review'), 'the "Q3 Budget"\n review');
  assert.equal(findSpan('Weekly Operations Digest', 'subject "Weekly Ops Digest".'), null);           // a paraphrase is not a span
  assert.deepEqual(copyLiteral('weekly ops digest', 'gmail:message:m1', SRC), { value: 'Weekly Ops Digest', verified: 'cited', source: 'gmail:message:m1' });
  assert.deepEqual(copyLiteral('ops-team@corp.example', 'gmail:message:m1', SRC), { value: 'ops-team@corp.example', verified: 'other', source: 'gmail:message:m2' }); // wrong pointer: found elsewhere
  assert.equal(copyLiteral('Weekly Operations Digest', 'gmail:message:m1', SRC).verified, false);
  const L = normalizeLedger({ requirements: [{ id: 'R1', polarity: 'positive', action: 'send_email', app: 'gmail', target: 'ops', statement: 's', source: 'gmail:message:m1',
    fields: [{ name: 'subject', quote: 'weekly ops digest', source: 'gmail:message:m1' }, { name: 'body', quote: 'Weekly Operations Digest', source: 'gmail:message:m1' }, { name: 'amount', derived: { value: '$1,100', method: 'x', inputs: [{ quote: 'Weekly Ops', source: 'gmail:message:m1' }] } }] }] }, SRC, { reader: 1 });
  const f = Object.fromEntries(L.requirements[0].fields.map(x => [x.name, x]));
  assert.equal(f.subject.value, 'Weekly Ops Digest');
  assert.equal(f.subject.verified, 'cited');
  assert.equal(f.body.verified, false);
  assert.equal(f.body.modelText, 'Weekly Operations Digest');
  assert.equal(f.amount.derived, true);
  assert.equal(f.amount.verified, 'derived');
});

test('negatives: a "must not" item survives only with an explicit rule found verbatim in a source; "not requested" is dropped', () => {
  const L = normalizeLedger({ requirements: [
    { id: 'R1', polarity: 'negative', action: 'send_email', app: 'gmail', target: 'vendor@out.example', statement: 'no vendor mail', rule_quote: 'never email vendor@out.example', rule_source: 'gmail:message:m1' },
    { id: 'R2', polarity: 'negative', action: 'post_message', app: 'slack', target: '#ops', statement: 'do not post in #ops (not requested)' },
    { id: 'R3', polarity: 'negative', action: 'send_email', app: 'gmail', target: 'cfo@corp.example', statement: 'no cfo', rule_quote: 'Do not copy the CFO', rule_source: 'gmail:message:m1' },
  ] }, SRC, { reader: 1 });
  assert.deepEqual(L.requirements.map(r => r.id), ['L1.R1']);
  assert.equal(L.requirements[0].rule.quote, 'Never email vendor@out.example');
  assert.deepEqual(L.dropped.map(d => d.reason), ['no cited rule', 'rule text not found in any source']);
});

const ledgerOf = (reader, reqs) => normalizeLedger({ today: { value: '2026-03-05', source: 'gmail:message:m2', quote: 'Routing policy (update)' }, requirements: reqs }, SRC, { reader });
const send = (to, src, extra = {}) => ({ id: 'R', polarity: 'positive', action: 'send_email', app: 'gmail', target: to, statement: `email ${to}`, source: src, fields: [{ name: 'to', quote: to, source: src }, { name: 'subject', quote: 'Weekly Ops Digest', source: 'gmail:message:m1' }], ...extra });

test('union / dedup / support: the same effect from K readers is one item with support K; a single reader\'s item is kept for recall', () => {
  const L1 = ledgerOf(1, [send('ops-team@corp.example', 'gmail:message:m2')]);
  const L2 = ledgerOf(2, [send('OPS-TEAM@corp.example', 'gmail:message:m2'), { id: 'R9', polarity: 'positive', action: 'post_message', app: 'slack', target: '#ops', statement: 'post in #ops', source: 'request', fields: [] }]);
  const L3 = ledgerOf(3, [send('ops-team@corp.example', 'gmail:message:m2')]);
  const m = mergeLedgers([L1, L2, L3], { sources: SRC });
  assert.equal(m.items.length, 2);
  assert.deepEqual(m.items.map(i => [i.action, i.support]), [['send_email', 3], ['post_message', 1]]);
  assert.deepEqual(m.items[0].fields.find(f => f.name === 'subject'), { name: 'subject', value: 'Weekly Ops Digest', verified: 'cited', source: 'gmail:message:m1', derived: false, support: 3 });
  assert.equal(m.today.value, '2026-03-05');
  assert.equal(m.today.votes, 3);
  // Majority items give hard checks; the single-reader item an advisory one.
  const pcs = postconditionsFromLedger(m, INV);
  assert.deepEqual(pcs.map(p => [p.type, p.hard]), [['gmail_sent', true], ['slack_posted', false]]);
  assert.deepEqual(pcs[0].params, { to: ['ops-team@corp.example'], cc: [], subject: ['Weekly Ops Digest'], body: [] });
});

test('conflicts: disagreeing single-valued fields, eligibility and polarity become conflicts; code settles by verified source, the request, then the newer source; adjudication only for the rest', () => {
  const upd = (v, src) => ({ id: 'R', polarity: 'positive', action: 'update_record', app: 'salesforce', target: 'salesforce:Contact:003A', statement: 'update phone', source: 'request', fields: [{ name: 'phone', quote: v, source: src }] });
  // Value conflict: one value is found verbatim in a source, the other is not -> code picks the verified one.
  let m = mergeLedgers([ledgerOf(1, [upd('555-0100', 'salesforce:Contact:003A')]), ledgerOf(2, [upd('555-9999', 'gmail:message:m1')])], { sources: SRC });
  assert.equal(m.conflicts.length, 1);
  let s = settleByCode(m.conflicts, SRC);
  assert.equal(s.settled[0].choice.value, '555-0100');
  assert.match(s.settled[0].rule, /copied from a source/);
  // Both verified, different dates -> the newer source wins.
  const recip = (v, src) => ({ ...upd(v, src), fields: [{ name: 'owner', quote: v, source: src }] });
  m = mergeLedgers([ledgerOf(1, [recip('ops@corp.example', 'gmail:message:m1')]), ledgerOf(2, [recip('ops-team@corp.example', 'gmail:message:m2')])], { sources: SRC });
  s = settleByCode(m.conflicts, SRC);
  assert.equal(s.settled[0].choice.value, 'ops-team@corp.example');
  assert.match(s.settled[0].rule, /newer source \(2026-03-05\)/);
  applyDecisions(m, s.settled.map(x => ({ conflict: x.conflict, choice: x.choice, by: 'code', rule: x.rule })));
  assert.equal(m.items[0].fields.find(f => f.name === 'owner').value, 'ops-team@corp.example');
  assert.equal(m.adjudications[0].by, 'code');
  // Eligibility disagreement and a positive/negative pair are left to the adjudication call; its reply is mapped back.
  const elig = e => ({ ...send('ops-team@corp.example', 'gmail:message:m2'), candidates: [{ record: 'salesforce:Contact:003A', eligible: e, deciding_field: 'Phone', value: '555-0100', rule_source: 'gmail:message:m1' }] });
  const neg = { id: 'N', polarity: 'negative', action: 'send_email', app: 'gmail', target: 'ops-team@corp.example', statement: 'no mail', source: 'gmail:message:m1', rule_quote: 'Never email vendor@out.example', rule_source: 'gmail:message:m1' };
  m = mergeLedgers([ledgerOf(1, [elig(true)]), ledgerOf(2, [elig(false), neg])], { sources: SRC });
  assert.deepEqual(m.conflicts.map(c => c.kind).sort(), ['eligibility', 'polarity']);
  s = settleByCode(m.conflicts, SRC);
  assert.equal(s.open.length, 2);
  const ds = readDecisions({ decisions: [{ point: 1, option: 2, why: 'rule' }, { point: 2, option: 'none' }] }, s.open);
  assert.equal(ds[0].by, 'adjudication');
  assert.equal(ds[1].choice, null);
  applyDecisions(m, ds);
  assert.equal(m.adjudications.length, 2);
});

test('ledger prompt: the request verbatim and the inventory; no grading vocabulary; JSON replies parse from fences or braces', () => {
  const p = ledgerPrompt({ request: REQUEST, inventoryText: renderInventory(INV), precedents: [{ ptr: 'gmail:message:m1' }] });
  assert.ok(p.startsWith(`<request>\n${REQUEST}\n</request>`));
  for (const s of [p, LEDGER_SYSTEM, ADJUDICATE_SYSTEM, CHECKER_SYSTEM, PCMAP_SYSTEM]) assert.doesNotMatch(s, /assert|rubric|grade|grading|score|partial.credit|oracle|benchmark|automationbench/i);
  assert.deepEqual(parseJsonReply('x ```json\n{"a": 1}\n``` y'), { a: 1 });
  assert.deepEqual(parseJsonReply('Here: {"a": {"b": 2}} done'), { a: { b: 2 } });
  assert.equal(parseJsonReply('no json'), null);
});

// ---------------------------------------------------------------------------------------------------------------
// POSTCONDITIONS: evaluation over world reads (before vs after)

test('postcondition evaluation: sent / not sent / posted / field / created / row, with evidence', () => {
  const after = { records: [...INV.records.map(r => (r.ptr === 'salesforce:Contact:003A' ? rec(r.ptr, { ...r.data, Phone: '555-0199' }) : r)),
    rec('gmail:message:new1', { to: ['ops-team@corp.example'], subject: 'Weekly Ops Digest — week 10', body_plain: 'Total: $1,100' }),
    rec('slack:message:C1/1.0', { channel: 'C1', name: 'ops', text: 'Digest sent' }),
    rec('salesforce:Task:00T1', { Subject: 'Follow up with Jordan Lee', Status: 'Open' }),
    rec('google_sheets:row:ss1/Log#5', { spreadsheetId: 'ss1', worksheet: 'Log', Name: 'Jordan Lee', Amount: '1100' })] };
  const pc = (type, params, hard = true) => ({ id: 'P', type, params, hard, statement: '' });
  const ev = (t, p) => evaluate(pc(t, p), INV, after);
  assert.equal(ev('gmail_sent', { to: ['ops-team@corp.example'], cc: [], subject: ['weekly ops digest'], body: ['$1,100'] }).pass, true);
  const miss = ev('gmail_sent', { to: ['ops-team@corp.example'], cc: [], subject: [], body: ['$1,200'] });
  assert.equal(miss.pass, false);
  assert.match(miss.evidence, /lacks "\$1,200"/);
  assert.match(ev('gmail_sent', { to: ['cfo@corp.example'], cc: [], subject: [], body: [] }).evidence, /no new message to cfo@corp.example/);
  assert.equal(ev('gmail_not_sent', { to: ['vendor@out.example'] }).pass, true);
  assert.equal(ev('gmail_not_sent', { to: ['ops-team@corp.example'] }).pass, false);
  assert.equal(ev('slack_posted', { channel: { id: 'C1', name: 'ops' }, text: ['digest'] }).pass, true);
  assert.equal(ev('slack_not_posted', { channel: { id: 'C1', name: 'ops' } }).pass, false);
  assert.equal(ev('record_field', { ptr: 'salesforce:Contact:003A', field: 'phone', value: '555-0199' }).pass, true);
  assert.equal(ev('record_field', { ptr: 'salesforce:Contact:003A', field: 'Phone', value: '555-0100' }).pass, false);
  assert.equal(ev('record_created', { app: 'salesforce', kind: 'Task', values: ['Jordan Lee'] }).pass, true);
  assert.equal(ev('sheet_row', { spreadsheetId: 'ss1', values: ['Jordan Lee', '1,100'] }).pass, true);
  assert.equal(ev('judged', {}).pass, null);
  // Before acting nothing positive holds; negatives hold.
  assert.equal(evaluate(pc('gmail_sent', { to: ['ops-team@corp.example'], cc: [], subject: [], body: [] }), INV, INV).pass, false);
  assert.equal(evaluate(pc('gmail_not_sent', { to: ['vendor@out.example'] }), INV, INV).pass, true);
  assert.deepEqual(worldDiff(INV, after).added.map(r => r.ptr).length, 4);
});

// ---------------------------------------------------------------------------------------------------------------
// TERMINATION (code-owned)

test('termination: repair only on a failing hard check and only while a round fits every budget; never on belief', () => {
  const res = (hard, pass) => ({ pc: { hard }, pass });
  const base = { responsesUsed: 20, maxResponses: 50, stepsUsed: 10, maxWorldSteps: 49, round: 0, maxRounds: 2, usdLeft: 0.5, msLeft: 600_000 };
  assert.deepEqual(terminationDecision({ ...base, results: [res(true, true), res(false, true)] }), { repair: false, reason: 'all checks pass' });
  assert.equal(terminationDecision({ ...base, results: [res(true, true), res(false, false)] }).reason, 'only advisory checks fail');
  assert.equal(terminationDecision({ ...base, results: [res(true, false)] }).repair, true);
  assert.equal(terminationDecision({ ...base, round: 2, results: [res(true, false)] }).reason, 'max repair rounds reached');
  assert.equal(terminationDecision({ ...base, responsesUsed: 46, results: [res(true, false)] }).reason, 'response budget exhausted');
  assert.equal(terminationDecision({ ...base, stepsUsed: 46, results: [res(true, false)] }).reason, 'world-step budget exhausted');
  assert.equal(terminationDecision({ ...base, usdLeft: 0, results: [res(true, false)] }).reason, 'money budget exhausted');
  assert.equal(terminationDecision({ ...base, msLeft: 1000, results: [res(true, false)] }).reason, 'time budget exhausted');
  // A judged check the checker could not decide (pass null) neither passes nor triggers a repair.
  assert.equal(terminationDecision({ ...base, results: [res(true, null)] }).repair, false);
});

// ---------------------------------------------------------------------------------------------------------------
// ACCOUNTING over the whole pipeline (H3 on the sum, L5 on every transcript)

function writeTranscript(dir, name, { responses, model = 'claude-haiku-5-5', t0, stepEvery = 0, cmd = 'node tool.mjs batch @x.json' }) {
  const ev = [{ type: 'system', subtype: 'init' }];
  for (let i = 0; i < responses; i++) {
    const t = new Date(t0 + i * 1000).toISOString();
    if (stepEvery && i < responses - 1) {
      ev.push({ type: 'assistant', timestamp: t, message: { id: `${name}-${i}`, model, content: [{ type: 'tool_use', id: `${name}-t${i}`, name: 'Bash', input: { command: cmd } }] } });
      ev.push({ type: 'user', timestamp: new Date(t0 + i * 1000 + 500).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: `${name}-t${i}`, content: 'ok' }] } });
    } else ev.push({ type: 'assistant', timestamp: t, message: { id: `${name}-${i}`, model, content: [{ type: 'text', text: '{}' }] } });
  }
  ev.push({ type: 'result', subtype: 'success', num_turns: responses, modelUsage: { [model]: {} } });
  mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  writeFileSync(path.join(dir, 'nodes', `${name}.jsonl`), ev.map(e => JSON.stringify(e)).join('\n') + '\n');
  return `nodes/${name}.jsonl`;
}

test('auditPipeline: responses summed over every model call in order; the cap applies to the sum; code steps and session steps checked; L5 per node', () => {
  const dir = tmp('audit'), T = 1_800_000_000_000;
  const mk = (name, kind, responses, startMs, extra = {}) => ({ name, kind, model: extra.model ?? 'claude-haiku-5-5', role: kind === 'session' ? 'act' : 'ledger', started: startMs / 1000, ended: (startMs + responses * 1000 + 900) / 1000,
    transcript: kind === 'code' ? null : writeTranscript(dir, name, { responses, t0: startMs, stepEvery: kind === 'session' ? 1 : 0, model: extra.reported ?? extra.model ?? 'claude-haiku-5-5', cmd: extra.cmd }), responses });
  const nodes = [{ name: 'inventory', kind: 'code', started: T / 1000, ended: (T + 500) / 1000 }, mk('ledger-1', 'model', 1, T + 1000), mk('ledger-2', 'model', 1, T + 3000), mk('ledger-3', 'model', 1, T + 5000), mk('act', 'session', 6, T + 10_000)];
  const calls = [{ t: (T + 200) / 1000 }, { t: (T + 10_300) / 1000 }, { t: (T + 11_300) / 1000 }];
  const clientLog = [{ node: 'inventory', responsesAtIssue: 0, refused: false }];
  let a = auditPipeline({ nodes, clientLog, calls, maxSteps: 50, hostDir: dir });
  assert.equal(a.modelResponses, 9);                                  // 3 ledger calls + 6 session responses
  assert.deepEqual(a.nodes.map(n => [n.name, n.responses, n.offset ?? null]), [['inventory', 0, null], ['ledger-1', 1, 0], ['ledger-2', 1, 1], ['ledger-3', 1, 2], ['act', 6, 3]]);
  assert.equal(a.codeSteps, 1);
  assert.equal(a.sessionSteps, 2);
  assert.equal(a.maxWorldResponse, 5);                                // the session's 2nd response, after 3 ledger responses
  assert.deepEqual(a.violations, []);
  assert.equal(a.extraModelCalls, 3);
  // The same pipeline under a cap of 8: the SUM (9) is over, and the session's step at pipeline response 5 is fine,
  // but under a cap of 5 the step issued by pipeline response 5 is late.
  a = auditPipeline({ nodes, clientLog, calls, maxSteps: 8, hostDir: dir });
  assert.deepEqual(a.violations, ['model responses 9 > 8 (sum over 4 model call(s))']);
  a = auditPipeline({ nodes, clientLog, calls, maxSteps: 5, hostDir: dir });
  assert.ok(a.violations.some(v => /world step\(s\) issued by pipeline response 5 >= 5 \(act\)/.test(v)), a.violations.join('; '));
  // A code step issued after the budget is spent is a violation too.
  assert.ok(auditPipeline({ nodes, clientLog: [{ node: 'inventory', responsesAtIssue: 50, refused: false }], calls, maxSteps: 50, hostDir: dir }).violations[0].includes('code-issued'));
  // L5 per node: a ledger node that reports another model; a session with a network command; a node without transcript.
  const bad = [mk('ledger-x', 'model', 1, T + 1000, { reported: 'claude-sonnet-5-5' }), mk('act-x', 'session', 2, T + 5000, { cmd: 'curl -s https://example.org' }), { name: 'ledger-y', kind: 'model', model: 'claude-haiku-5-5', started: T / 1000, ended: T / 1000, transcript: null, responses: 1 }];
  a = auditPipeline({ nodes: bad, calls: [], maxSteps: 50, hostDir: dir });
  assert.ok(a.violations.some(v => /L5: model claude-sonnet-5-5 reported .*\(ledger-x\)/.test(v)));
  assert.ok(a.violations.some(v => /L5: network command 'curl' .*\(act-x\)/.test(v)));
  assert.ok(a.violations.some(v => /no host transcript for ledger-y/.test(v)));
  assert.equal(auditPipeline({ nodes: bad, calls: [], maxSteps: 50, hostDir: dir, scripted: true }).violations.filter(v => /no host transcript/.test(v)).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Configuration, manifest, isolation

test('config: model per node role (Haiku/Sonnet), recorded and pinned in the manifest hash; unknown roles refused', () => {
  assert.deepEqual(nodeModels('claude-haiku-5-5', parseNodeModels('checker=claude-sonnet-5-5')), { ledger: 'claude-haiku-5-5', adjudicate: 'claude-haiku-5-5', pcmap: 'claude-haiku-5-5', checker: 'claude-sonnet-5-5', act: 'claude-haiku-5-5', repair: 'claude-haiku-5-5' });
  assert.throws(() => nodeModels('m', { planner: 'x' }), /unknown node role/);
  const base = { model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.75, timeoutMin: 20, maxSteps: 50, tools: ['Bash'], det: 'record', k: 1, concurrency: 4, cli: null, dateNote: true };
  const a = codeownedConfig(base), b = codeownedConfig({ ...base, nodeModels: { ledger: 'claude-sonnet-5-5' } });
  assert.equal(a.harness, HARNESS_ID);
  assert.equal(a.version, 'a1c-v1');
  assert.ok(a.policy.models['claude-haiku-5-5'] && b.policy.models['claude-sonnet-5-5']);
  assert.notEqual(codeownedManifest(a).sha256, codeownedManifest(b).sha256);
  assert.notEqual(codeownedManifest(a).sha256, codeownedManifest({ ...a, pipeline: { ...a.pipeline, K: 1 } }).sha256);
  const files = manifestFiles();
  for (const f of ['experiments/autobench/run.mjs', 'experiments/autobench/harness/codeowned.mjs', 'experiments/autobench/harness/inventory.mjs', 'experiments/autobench/harness/ledger.mjs',
    'experiments/autobench/harness/postconditions.mjs', 'experiments/autobench/harness/checker.mjs', 'experiments/autobench/harness/bridge-client.mjs', 'experiments/autobench/accounting.mjs', 'experiments/autobench/bridge.py', 'experiments/autobench/tool.mjs']) assert.ok(files.includes(f), f);
  assert.ok(!files.includes('experiments/autobench/harness/codeowned-stubs.mjs'));
});

test('isolation: no harness module reads task files, assertions, grades or host data; the enumeration plan names no task', () => {
  for (const f of HARNESS_FILES) {
    const s = readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(s, /assertion|rubric|grade\.json|world0|input\.json|meta\.json|prompt\.json|\bprep\b|SPLIT-v1|loadSplit|families|RECURRING-DESIGN/i, f);
  }
  const plan = JSON.stringify(ENUM_PLAN.map(p => p.l0));
  assert.doesNotMatch(plan, /meridian|acme corp|jordan|sarah/i);
  assert.ok(ENUM_PLAN.length >= 45);
  assert.deepEqual(entityTerms('Email jordan.lee@corp.example about INV-FX-001 and the "FX Impact" sheet for Meridian Corp by 2026-03-24.'),
    ['jordan.lee@corp.example', 'INV-FX-001', 'FX Impact', '2026-03-24', 'Meridian Corp']);
  assert.equal(listOf({ data: { business: { customers: { edges: [{ node: { id: 'a' } }] } } } })[0].id, 'a');
});

test('briefs: the act brief is code-generated from inventory, ledger and checks; minority items are marked possible', () => {
  const m = mergeLedgers([ledgerOf(1, [send('ops-team@corp.example', 'gmail:message:m2')]), ledgerOf(2, [send('ops-team@corp.example', 'gmail:message:m2'), send('ops@corp.example', 'gmail:message:m1')]), ledgerOf(3, [send('ops-team@corp.example', 'gmail:message:m2')])], { sources: SRC });
  const pcs = postconditionsFromLedger(m, INV).map((p, i) => ({ ...p, id: `P${i + 1}` }));
  const b = briefSection({ inv: INV, merged: m, pcs, stepsLeft: 40, responseCap: 39, inventoryText: renderInventory(INV) });
  assert.match(b, /Today's date for this task: 2026-03-05/);
  assert.match(b, /M1 \[MUST; send_email in gmail; found by 3\/3 readers/);
  assert.match(b, /M2 \[POSSIBLE: only one reader found it/);
  assert.match(b, /P2 \(M2, advisory\)/);
  assert.match(b, /Not connected \(calls fail with 401; do not use\): xero/);
  assert.doesNotMatch(b, /assert|rubric|grade|score|benchmark/i);
});

test('L1: no public task name in any file of the A1-C manifest (or in its scripted stand-ins)', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 120_000 }, async () => {
  const { listTasks } = await import('../lib.mjs');
  const names = (await listTasks(['sales', 'marketing', 'operations', 'support', 'finance', 'hr', 'simple'], { liveDir: tmp('l1') })).map(t => t.task);
  assert.equal(names.length, 800);
  const files = [...manifestFiles(), 'experiments/autobench/harness/codeowned-stubs.mjs', 'experiments/autobench/harness/codeowned-smoke.mjs'];
  const hits = files.flatMap(f => { const text = readFileSync(path.join(REPO, f), 'utf8'); return names.filter(n => text.includes(n)).map(n => `${f}: ${n}`); });
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------------------------------------------------------
// Guards before any work

test('A1-C refuses test-split tasks (no frozen hash), a wrong hash, k > 1 and unknown node roles, before any work', async () => {
  const testTask = loadSplit().test[0]; // a name only: nothing of the task is opened
  const never = async () => { throw new Error('must not run'); };
  const base = { harness: 'codeowned', runner: never, nodeRunner: never, liveRoot: tmp('guards'), outDir: null, log: quiet };
  await assert.rejects(runTasks({ ...base, tasks: [testTask] }), /not dev-split tasks/);
  await assert.rejects(runTasks({ ...base, tasks: [testTask], dryRun: true }), /not dev-split tasks/);
  await assert.rejects(runTasks({ ...base, tasks: [testTask], harnessHash: 'f'.repeat(64) }), /harness hash mismatch/);
  await assert.rejects(runTasks({ ...base, tasks: [PHONE_TASK], k: 2 }), /forked rehearsal/);
  await assert.rejects(runTasks({ ...base, tasks: [PHONE_TASK], nodeModels: { planner: 'x' } }), /unknown node role/);
  await assert.rejects(runTasks({ ...base, tasks: [PHONE_TASK], model: 'claude-haiku-5-5', runner: undefined, nodeRunner: undefined, capUsd: 1, nodeModels: { checker: 'not-a-policy-model' } }), /not-a-policy-model|not listed|unknown model/i);
});

// ---------------------------------------------------------------------------------------------------------------
// End to end through the real bridge with scripted nodes and sessions (no model)

/** A scripted ledger reader for the phone task, built ONLY from its prompt (request + records): the contact pointer and the
 * number in the email, quoted loosely (lower case, extra space) so that code must copy the literal from the span. */
function phoneLedger(prompt) {
  const recs = prompt.split('\n').filter(l => l.startsWith('['));
  const contact = recs.find(l => /^\[salesforce:Contact:/.test(l) && /Jordan Lee/.test(l))?.match(/^\[([^\]]+)\]/)[1];
  const mail = recs.find(l => /^\[gmail:message:/.test(l) && /Jordan/.test(l) && /phone/i.test(l));
  const mptr = mail?.match(/^\[([^\]]+)\]/)[1];
  const number = mail?.match(/(\+?\d[\d\s().-]{6,}\d)/)?.[1];
  return { today: null, requirements: contact && number ? [{ id: 'R1', polarity: 'positive', action: 'update_record', app: 'salesforce', target: contact, statement: 'update the contact phone from the email', source: 'request', fields: [{ name: 'Phone', quote: ` ${number} `, source: mptr }] }] : [], conflicts: [] };
}

test('end to end (A1-C, scripted): pipeline order, verbatim literal, checks before acting, act, check, termination; accounting on the sum; nothing grader-side reaches any node', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const live = tmp('e2e');
  const seenNodes = [], seenSessions = [];
  const { summary, results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned', det: 'record', liveRoot: live, outDir: path.join(live, 'out'), log: quiet, dateNote: true,
    runner: stubSessionRunner({ seen: seenSessions }), nodeRunner: stubNodeRunner({ seen: seenNodes, replies: { ledger: phoneLedger } }) });
  const r = results[0], f = r.forks[0], p = f.pipeline;
  assert.equal(r.final.task_completed_correctly, 1, JSON.stringify(f.session?.violations));
  // Order: inventory (code) -> 3 ledgers -> act -> check (code), and nothing else was needed.
  assert.deepEqual(f.session.nodes.map(n => n.name), ['inventory', 'ledger-1', 'ledger-2', 'ledger-3', 'act', 'check-0']);
  assert.deepEqual(seenNodes.map(s => s.node), ['ledger', 'ledger', 'ledger']);
  assert.ok(seenNodes.every(s => s.tools.length === 0 && s.maxTurns === 1));
  assert.equal(f.session.modelResponses, 3 + 2);                           // 3 ledger responses + act (1 command + final text)
  assert.deepEqual(f.session.violations, []);
  assert.equal(f.steps, f.session.codeSteps + f.session.sessionSteps);       // every bridge step attributed to a node
  assert.ok(f.session.codeSteps >= 3 && f.session.sessionSteps === 1);
  assert.equal(p.ledger.items, 1);
  assert.equal(p.ledger.hardChecks, 1);
  assert.deepEqual(p.checks.map(c => [c.pass, c.hardFail]), [[1, 0]]);
  assert.equal(p.termination.reason, 'all checks pass');
  // The literal in the check is the email's text, copied by code (the reader quoted it with stray spaces).
  const pcs = readJson(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', 'postconditions.json')).pcs;
  assert.equal(pcs[0].type, 'record_field');
  assert.equal(pcs[0].params.value, pcs[0].params.value.trim());
  // The acting session: official system prompt first, official user message verbatim, the brief appended.
  const prep = path.join(live, 'prep', PHONE_TASK);
  const official = readJson(path.join(prep, 'prompt.json'));
  assert.ok(seenSessions[0].system.startsWith(official.system + '\n\n## Tools in this environment'));
  assert.equal(seenSessions[0].prompt, official.user);
  assert.match(seenSessions[0].system, /## Work brief \(begin\)/);
  // No grader-side text reaches any node: no assertion type anywhere; every assertion value a node saw came through the
  // official prompt or a bridge result served during the run.
  const info = JSON.parse(readJson(path.join(prep, 'input.json')).info);
  const served = readFileSync(path.join(live, 'host', PHONE_TASK, 'fork-0', 'calls.jsonl'), 'utf8');
  const inputs = [...seenNodes, ...seenSessions].map(s => `${s.system}\n${s.prompt}`).join('\n');
  for (const a of info.assertions) {
    assert.ok(!inputs.includes(a.type), `assertion type reachable: ${a.type}`);
    const vals = []; const walk = v => { if (typeof v === 'string' && v.length >= 6) vals.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    const { type, ...rest } = a; walk(rest);
    for (const v of vals) if (inputs.includes(v)) assert.ok(official.user.includes(v) || served.includes(v) || served.includes(JSON.stringify(v).slice(1, -1)), `value reached a node from outside the world: ${v}`);
  }
  assert.ok(!inputs.includes(PHONE_TASK));
  // The repo copy holds statistics only.
  const copied = readFileSync(path.join(live, 'out', 'results.jsonl'), 'utf8');
  assert.ok(!copied.includes('assertion_results') && !copied.includes('Jordan'));
  assert.equal(summary.arm, 'A1-C (code-owned harness)');
  assert.equal(summary.harness.id, 'codeowned');
  assert.equal(summary.accounting.modelResponses.max, 5);
});

test('end to end (A1-C, scripted): a failing hard check triggers a repair round given only the failures; the act cap leaves the reserve; a session that ignores its cap fails H3 on the sum', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  // Two requirements (the phone update and an email to the contact); the act session leaves the last one undone.
  const two = prompt => {
    const l = phoneLedger(prompt);
    const addr = prompt.match(/\[salesforce:Contact:[^\]]+\][^\n]*Jordan Lee[^\n]*?"Email":"([^"]+)"/)?.[1];
    if (addr) l.requirements.push({ id: 'R2', polarity: 'positive', action: 'send_email', app: 'gmail', target: addr, statement: 'confirm to the contact', source: 'request', fields: [{ name: 'to', quote: addr, source: 'request' }] });
    return l;
  };
  const seen = [];
  const a = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned', det: 'record', liveRoot: tmp('repair'), outDir: null, log: quiet,
    runner: stubSessionRunner({ skipLast: true, seen }), nodeRunner: stubNodeRunner({ replies: { ledger: two } }) });
  const f = a.results[0].forks[0];
  const names = f.session.nodes.map(n => n.name);
  assert.equal(f.pipeline.ledger.hardChecks, 2);
  assert.deepEqual(names, ['inventory', 'ledger-1', 'ledger-2', 'ledger-3', 'act', 'check-0', 'repair-1', 'check-1']);
  assert.deepEqual(f.pipeline.checks.map(c => c.hardFail), [1, 0]);
  assert.equal(f.pipeline.termination.reason, 'all checks pass');
  assert.match(seen[1].system, /repair round 1/);
  assert.match(seen[1].system, /FAILED/);
  assert.doesNotMatch(seen[1].system, /### Requirements/);                 // only the failing items, not the whole brief
  assert.equal(seen[1].prompt, seen[0].prompt);                            // the official user message again, verbatim
  assert.ok(seen[1].system.startsWith(seen[0].system.slice(0, seen[0].system.indexOf('## Work brief'))));
  assert.deepEqual(f.session.violations, []);
  assert.equal(a.results[0].final.task_completed_correctly, 1);
  // Act cap: with maxSteps 14 and 3 ledger responses, the act session may use at most 14 - 3 - 8 = 3 responses.
  const capSeen = [];
  const b = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned', det: 'record', maxSteps: 14, liveRoot: tmp('cap'), outDir: null, log: quiet,
    runner: stubSessionRunner({ seen: capSeen, extraResponses: 5 }), nodeRunner: stubNodeRunner({ replies: { ledger: phoneLedger } }) });
  assert.equal(capSeen[0].maxTurns, 3);
  assert.ok(b.results[0].forks[0].session.modelResponses <= 14);
  assert.deepEqual(b.results[0].forks[0].session.violations, []);
  // A session that ignores its cap: 3 ledger responses + 12 session responses > 14 -> the task-run fails in the headline.
  const c = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned', det: 'record', maxSteps: 14, liveRoot: tmp('cap2'), outDir: null, log: quiet,
    runner: stubSessionRunner({ honorMaxTurns: false, extraResponses: 10 }), nodeRunner: stubNodeRunner({ replies: { ledger: phoneLedger } }) });
  const rc = c.results[0];
  assert.match(rc.headlineOverride, /H3 step cap: model responses \d+ > 14 \(sum over 4 model call\(s\)\)/);
  assert.equal(rc.final.task_completed_correctly, 0);
  assert.equal(rc.liveFinal.task_completed_correctly, 1);
});

test('end to end (A1-C, scripted): an environment fault in any model node stops the pipeline before acting and is the task\'s session error (not a task outcome)', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const stub = stubNodeRunner({ replies: { ledger: phoneLedger } });
  let calls = 0;
  const limited = async args => { const n = ++calls; const r = await stub(args); return n === 2 ? { ...r, ok: false, error: { code: 'MODEL_RATE_LIMIT' }, result: null } : r; };
  const seen = [], live = tmp('fault');
  const { summary, results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned', det: 'record', liveRoot: live, outDir: null, log: quiet,
    runner: stubSessionRunner({ seen }), nodeRunner: limited });
  assert.equal(seen.length, 0);                                               // no act session after the fault
  const nodes = readJson(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', 'nodes.json'));
  assert.deepEqual(nodes.map(n => n.name), ['inventory', 'ledger-1', 'ledger-2', 'ledger-3']);
  assert.equal(nodes.find(n => n.error)?.error, 'MODEL_RATE_LIMIT');
  // The runner sees the fault as the session error (a runner with the environment-fault rule defers the task instead).
  if (results.length) assert.equal(results[0].forks[0].sessionError, 'MODEL_RATE_LIMIT');
  else assert.match(String(summary.stopped), /MODEL_RATE_LIMIT/);
});

// The runner as it was before the A1-C wiring (the last commit that changed run.mjs before it), loaded from git into a
// temporary module whose relative imports point back into the repository.
const RUN_BASE = '4049b06';
async function baseRunner() {
  let src;
  try { src = execFileSync('git', ['-C', REPO, 'show', `${RUN_BASE}:experiments/autobench/run.mjs`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  const here = pathToFileURL(path.join(REPO, 'experiments/autobench')).href + '/';
  const srcDir = pathToFileURL(path.join(REPO, 'src')).href + '/';
  const fixed = src.replaceAll("from '../../src/", `from '${srcDir}`).replaceAll("from './", `from '${here}`).replaceAll("import('./", `import('${here}`)
    .replaceAll("new URL('./accounting.mjs', import.meta.url)", `new URL('${here}accounting.mjs')`);
  const f = path.join(tmp('base-runner'), 'run-base.mjs');
  writeFileSync(f, fixed);
  return import(pathToFileURL(f).href);
}

test('A0 and A1 sessions are byte-identical to the pre-A1-C runner (git ' + RUN_BASE + '): every runner argument, with and without --date-note', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async t => {
  const base = await baseRunner();
  if (!base) return t.skip('git history unavailable');
  const capture = seen => async args => { seen.push(args); return { ok: true, error: null, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: 0, durationMs: 1, toolUses: [], label: 'capture' }; };
  for (const variant of [{}, { dateNote: true }, { harness: 'foundry' }, { harness: 'foundry', dateNote: true }]) {
    const out = [];
    for (const impl of [base.runTasks, runTasks]) {
      const live = tmp('ident'), seen = [];
      const { summary } = await impl({ tasks: [PHONE_TASK], domains: ['simple'], det: 'record', liveRoot: live, outDir: null, log: quiet, runner: capture(seen), ...variant });
      // Paths differ only by the run's live directory.
      out.push({ args: JSON.parse(JSON.stringify(seen).replaceAll(live, '<live>')), arm: summary.arm, harness: summary.harness && { ...summary.harness, manifestSha256: typeof summary.harness.manifestSha256 } });
    }
    assert.equal(out[0].args.length, 1);
    assert.deepEqual(out[1], out[0], JSON.stringify(variant));
  }
});

test('A0 and A1 are untouched by the A1-C wiring: same prompts in a dry run; the codeowned modules are not loaded for them', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 300_000 }, async () => {
  const live = tmp('dry');
  const a0 = (await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], dryRun: true, runner: async () => ({}), liveRoot: path.join(live, 'a0'), outDir: null, log: quiet })).summary;
  const a1c = (await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], dryRun: true, harness: 'codeowned', runner: async () => ({}), liveRoot: path.join(live, 'a1c'), outDir: null, log: quiet })).summary;
  assert.ok(a1c.systemPrompt.startsWith(a0.systemPrompt + '\n\n'));
  assert.equal(a1c.user, a0.user);
  const runSrc = readFileSync(path.join(REPO, 'experiments/autobench/run.mjs'), 'utf8');
  assert.doesNotMatch(runSrc, /from '\.\/harness\/codeowned/);              // loaded only when selected (dynamic import)
});
