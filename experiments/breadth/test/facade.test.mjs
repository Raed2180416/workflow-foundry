// Breadth facade unit tests ($0, no model, no bed): MCP relay protocol, host mailbox hardening, init check, meter.
//   nice -n 15 node --test --test-concurrency=1 experiments/breadth/test/facade.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { MAX_REQUEST_BYTES, STOPPED_TEXT, startFacadeHost, trajectoryFromCalls } from '../facade/host.mjs';
import { armExpectation, compareFingerprint, fingerprintHash, initFingerprint } from '../facade/init-check.mjs';
import { claim, makeServer, PROTOCOL_VERSIONS } from '../facade/mcp-relay.mjs';
import { doseSummary, gate, meterReading } from '../facade/meter.mjs';
import { HARDENED_FLAGS, SAFE_MODE_FLAGS, relayMcpConfig, sessionArgs } from '../facade/session.mjs';
import { FAULT_TEXT, applyFaultToCatalog, faultState, normalizeFault } from '../facade/faults.mjs';
import { PYTHON_TOOL, runPythonTool } from '../facade/python-tool.mjs';

const made = [];
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'wf-facade-test-')); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('relay: initialize negotiates a known protocol version, lists tools, ignores notifications', async () => {
  const sent = [];
  const h = makeServer({ tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object' } }], box: tmp(), write: m => sent.push(m) });
  await h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(sent[0].result.protocolVersion, '2025-06-18');
  await h({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(sent[1].result.protocolVersion, PROTOCOL_VERSIONS.at(-1));
  await h({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(sent.length, 2);
  await h({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.deepEqual(sent[2].result.tools.map(t => t.name), ['a']);
  await h({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
  assert.equal(sent[3].error.code, -32601);
});

test('relay: an unknown tool never reaches the mailbox; a known one round-trips through it', async () => {
  const box = tmp(), sent = [];
  const h = makeServer({ tools: [{ name: 'a', description: '', inputSchema: { type: 'object' } }], box, write: m => sent.push(m), waitMs: 5000 });
  await h({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zzz', arguments: {} } });
  assert.equal(sent[0].result.isError, true);
  assert.equal(existsSync(path.join(box, 'req-1.json')), false);
  const p = h({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'a', arguments: { x: 1 } } });
  for (let i = 0; i < 100 && !existsSync(path.join(box, 'req-1.json')); i++) await sleep(10);
  const req = JSON.parse(readFileSync(path.join(box, 'req-1.json'), 'utf8'));
  assert.deepEqual([req.name, req.arguments], ['a', { x: 1 }]);
  writeFileSync(path.join(box, 'res-1.json'), JSON.stringify({ text: 'ok', isError: false }));
  await p;
  assert.deepEqual(sent[1].result, { content: [{ type: 'text', text: 'ok' }], isError: false });
});

test('relay: request numbers are claimed exclusively', () => {
  const box = tmp();
  const ns = Array.from({ length: 5 }, () => claim(box));
  assert.deepEqual(ns, [1, 2, 3, 4, 5]);
});

function fakeBed(script = {}) {
  const calls = [];
  return { calls, request: async req => { calls.push(req); return script[req.name] ?? { kind: 'call', text: `did ${req.name}`, action: `${req.name}.func()`, write: req.name.includes('send'), fatal: false }; } };
}
async function hostRound(files, { bed = fakeBed(), catalog = [{ name: 'email_send_email', bedName: 'email.send_email', write: true }, { name: 'email_search', bedName: 'email.search', write: false }], runPython, fault = null } = {}) {
  const box = tmp(), hostDir = tmp();
  for (const [name, content] of Object.entries(files)) {
    if (content?.symlinkTo) symlinkSync(content.symlinkTo, path.join(box, name)); else writeFileSync(path.join(box, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  const host = startFacadeHost({ mailbox: box, hostDir, catalog, bed, runPython, pollMs: 5, fault });
  await sleep(150);
  const summary = await host.stop();
  const res = n => (existsSync(path.join(box, `res-${n}.json`)) ? JSON.parse(readFileSync(path.join(box, `res-${n}.json`), 'utf8')) : null);
  return { box, hostDir, summary, res, bed };
}

test('host: maps MCP names to bed names, journals world actions in order, counts writes', async () => {
  const r = await hostRound({ 'req-1.json': { name: 'email_search', arguments: { query: 'x' } }, 'req-2.json': { name: 'email_send_email', arguments: { recipient: 'a@b.co' } } });
  assert.deepEqual(r.bed.calls.map(c => c.name), ['email.search', 'email.send_email']);
  assert.equal(r.summary.worldCalls, 2); assert.equal(r.summary.writes, 1);
  const t = trajectoryFromCalls(path.join(r.hostDir, 'calls.jsonl'));
  assert.deepEqual(t.actions, ['email.search.func()', 'email.send_email.func()']);
  assert.equal(r.res(1).text, 'did email.search');
});

test('host: rejects unknown tools, planted links, oversize and malformed requests; never follows a planted response link', async () => {
  const outside = path.join(tmp(), 'secret.json'); writeFileSync(outside, JSON.stringify({ name: 'email_search' }));
  const big = JSON.stringify({ name: 'email_search', arguments: { q: 'x'.repeat(MAX_REQUEST_BYTES) } });
  const target = path.join(tmp(), 'victim.txt'); writeFileSync(target, 'untouched');
  const r = await hostRound({ 'req-1.json': { name: 'not_a_tool' }, 'req-2.json': { symlinkTo: outside }, 'req-3.json': big, 'req-4.json': '{nope', 'req-5.json': { name: 'email_search', arguments: [1] },
    'res-6.json': { symlinkTo: target }, 'req-6.json': { name: 'email_search', arguments: {} } });
  for (const n of [1, 2, 3, 4, 5]) assert.equal(r.res(n).isError, true, `req ${n}`);
  assert.equal(r.bed.calls.length, 1);
  assert.equal(readFileSync(target, 'utf8'), 'untouched');
  assert.equal(r.res(6).text, 'did email.search');
  assert.equal(r.summary.rejected, 5);
});

test('host: after a fatal tool error the world refuses further calls (the official loop ends there)', async () => {
  const bed = fakeBed({ 'email.send_email': { kind: 'call', error: 'TypeError: unexpected keyword', action: 'email.send_email.func(x="1")', write: true, fatal: true } });
  const r = await hostRound({ 'req-1.json': { name: 'email_send_email', arguments: { x: 1 } }, 'req-2.json': { name: 'email_search', arguments: {} } }, { bed });
  assert.equal(r.res(1).isError, true);
  assert.equal(r.res(2).text, STOPPED_TEXT);
  assert.equal(r.summary.refused, 1);
  assert.equal(trajectoryFromCalls(path.join(r.hostDir, 'calls.jsonl')).fatal, 'TypeError: unexpected keyword');
});

test('host: python calls go to the sandboxed tool, a sandbox failure is an environment fault', async () => {
  const ok = await hostRound({ 'req-1.json': { name: 'python', arguments: { code: 'print(1)' } } }, { runPython: async () => ({ text: '1\n', isError: false }) });
  assert.equal(ok.res(1).text, '1\n'); assert.equal(ok.summary.pythonCalls, 1); assert.equal(ok.summary.envFault, null);
  const bad = await hostRound({ 'req-1.json': { name: 'python', arguments: { code: 'print(1)' } } }, { runPython: async () => { throw Object.assign(new Error('no ns'), { code: 'SANDBOX_UNAVAILABLE' }); } });
  assert.match(bad.summary.envFault, /SANDBOX_UNAVAILABLE/);
});

test('python tool: argument checks; real sandbox when available (network off, no host paths)', async () => {
  assert.equal((await runPythonTool({})).isError, true);
  assert.equal((await runPythonTool({ code: 'x'.repeat(70_000) })).isError, true);
  assert.equal(PYTHON_TOOL.inputSchema.required[0], 'code');
  let r;
  try { r = await runPythonTool({ code: 'import os\nprint(sum(range(10)), os.path.exists("/var/tmp/foundry-work"))' }, { timeoutMs: 30_000 }); }
  catch (e) { if (e.code === 'SANDBOX_UNAVAILABLE') return; throw e; }
  assert.equal(r.isError, false); assert.equal(r.text.trim(), '45 False');
  const err = await runPythonTool({ code: 'raise ValueError("boom")' }, { timeoutMs: 30_000 });
  assert.equal(err.isError, true); assert.match(err.text, /ValueError: boom/);
});

test('session: hardened flags exclude --safe-mode (it drops --mcp-config servers on CLI 2.1.307 and 2.1.312) and set no setting sources', () => {
  assert.ok(!HARDENED_FLAGS.includes('--safe-mode'));
  assert.ok(SAFE_MODE_FLAGS.includes('--safe-mode'));
  const i = HARDENED_FLAGS.indexOf('--setting-sources');
  assert.equal(HARDENED_FLAGS[i + 1], '');
  for (const f of ['--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config']) assert.ok(HARDENED_FLAGS.includes(f), f);
  const mcp = relayMcpConfig({ serverName: 'workbench', relayScript: '/k/mcp-relay.mjs', toolsFile: '/k/tools.json', mailbox: '/w/.facade' });
  const a = sessionArgs({ model: 'claude-haiku-5-5', mcpConfig: mcp, builtinTools: [], budgetUsd: 0.25, maxTurns: 20, systemPrompt: 'S', effort: 'high' });
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.equal(a[a.indexOf('--max-turns') + 1], '20');
  assert.equal(a[a.indexOf('--effort') + 1], 'high');
  assert.deepEqual(Object.keys(JSON.parse(a[a.indexOf('--mcp-config') + 1]).mcpServers), ['workbench']);
  assert.ok(a.includes('--strict-mcp-config'));
});

test('init check: fingerprint, comparison and arm expectation', () => {
  const init = { type: 'system', subtype: 'init', claude_code_version: '2.1.307', model: 'claude-haiku-5-5', permissionMode: 'bypassPermissions', tools: ['mcp__workbench__b', 'mcp__workbench__a'],
    mcp_servers: [{ name: 'workbench', status: 'connected' }], slash_commands: [], skills: [], plugins: [{ name: 'p1' }], agents: ['claude'], output_style: 'default', apiKeySource: 'none' };
  const fp = initFingerprint(init);
  assert.deepEqual(fp.tools, ['mcp__workbench__a', 'mcp__workbench__b']);
  assert.equal(fingerprintHash(fp).length, 64);
  const exp = armExpectation({ model: 'claude-haiku-5-5', mcpServers: ['workbench'], tools: ['mcp__workbench__a', 'mcp__workbench__b'], frozen: { plugins: ['p1'], cliVersion: '2.1.307' } });
  assert.deepEqual(compareFingerprint(exp, fp), []);
  const failed = initFingerprint({ ...init, mcp_servers: [{ name: 'workbench', status: 'failed' }] });
  assert.match(compareFingerprint(exp, failed)[0], /mcpServers/);
  assert.match(compareFingerprint(exp, initFingerprint({ ...init, skills: ['x'] })).join(), /skills/);
  assert.deepEqual(compareFingerprint(exp, null), ['no init event']);
});

test('meter: reading, gates and dose summary', () => {
  const ev = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.42, resetsAt: 1 }, seven_day: { utilization: 0.7 }, seven_day_opus: { utilization: 0.1 } } } };
  const m = meterReading(ev);
  assert.equal(m.fiveHour, 0.42); assert.equal(m.sevenDay, 0.7); assert.ok(m.otherWindows.seven_day_opus);
  assert.equal(meterReading({ type: 'assistant' }), null);
  assert.equal(gate(null).ok, true);
  assert.equal(gate(m).ok, true);
  assert.equal(gate({ ...m, fiveHour: 0.61 }, { wave: true }).ok, false);
  assert.equal(gate({ ...m, sevenDay: 0.81 }, { wave: true }).ok, false);
  assert.equal(gate({ ...m, fiveHour: 0.8 }).ok, false);
  assert.equal(gate({ ...m, status: 'rejected' }).ok, false);
  const d = doseSummary([{ fiveHour: 0.1, sevenDay: 0.2 }, { fiveHour: 0.13, sevenDay: 0.21 }], 0.06);
  assert.equal(d.fiveHourDelta, 0.03); assert.equal(d.usdPerFiveHourTick, 0.02); assert.equal(d.usdPerSevenDayTick, 0.06);
  assert.equal(doseSummary([{ fiveHour: 0.1 }], 1).usdPerFiveHourTick, null);
});

// --- fault and drift injection (faults.mjs) -------------------------------------------------------------------------
const SEND = { name: 'email_send_email', description: 'Sends an email. recipient: the address.', inputSchema: { type: 'object', properties: { recipient: { type: 'string' }, subject: { type: 'string' } }, required: ['recipient'] } };
const SEARCH = { name: 'email_search', description: 'Search.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } };
const BED = [{ name: 'email_send_email', bedName: 'email.send_email', write: true }, { name: 'email_search', bedName: 'email.search', write: false }];

test('faults: specs are validated; the catalog view renames a parameter or adds a retired twin, and leaves the input untouched', () => {
  assert.throws(() => normalizeFault({ kind: 'nope' }), /unknown fault kind/);
  assert.throws(() => normalizeFault({ kind: 'rename_param', tool: 'x' }), /needs tool, from, to/);
  assert.deepEqual(normalizeFault({ kind: 'transient' }), { kind: 'transient', target: 'write', nth: 1, times: 1 });
  const base = { mcpTools: [SEND, SEARCH], bedTools: BED };
  const r = applyFaultToCatalog(base, { kind: 'rename_param', tool: 'email.send_email', from: 'recipient', to: 'to' });
  assert.deepEqual(Object.keys(r.mcpTools[0].inputSchema.properties), ['to', 'subject']);
  assert.deepEqual(r.mcpTools[0].inputSchema.required, ['to']);
  assert.match(r.mcpTools[0].description, /to: the address/);
  assert.deepEqual(Object.keys(SEND.inputSchema.properties), ['recipient', 'subject']); // input not mutated
  assert.throws(() => applyFaultToCatalog(base, { kind: 'rename_param', tool: 'email.send_email', from: 'cc', to: 'x' }), /no parameter cc/);
  const d = applyFaultToCatalog(base, { kind: 'distractor', like: 'email.send_email' });
  assert.deepEqual(d.extraToolNames, ['email_send_email_v2']);
  assert.equal(d.mcpTools.at(-1).name, 'email_send_email_v2');
  assert.deepEqual(d.hostCatalog.at(-1), { name: 'email_send_email_v2', bedName: null, write: false, distractor: true });
  assert.deepEqual(applyFaultToCatalog(base, null).mcpTools.map(t => t.name), ['email_send_email', 'email_search']);
});

test('faults: transient refuses the nth matching write without touching the world; a retry goes through', async () => {
  const r = await hostRound({ 'req-1.json': { name: 'email_search', arguments: {} }, 'req-2.json': { name: 'email_send_email', arguments: { recipient: 'a@b.co' } },
    'req-3.json': { name: 'email_send_email', arguments: { recipient: 'a@b.co' } } }, { fault: { kind: 'transient', target: 'write', nth: 1 } });
  assert.equal(r.res(2).text, FAULT_TEXT.transient); assert.equal(r.res(2).isError, true);
  assert.equal(r.res(3).text, 'did email.send_email');
  assert.deepEqual(r.bed.calls.map(c => c.name), ['email.search', 'email.send_email']); // the faulted call never reached the world
  assert.deepEqual(trajectoryFromCalls(path.join(r.hostDir, 'calls.jsonl')).actions, ['email.search.func()', 'email.send_email.func()']);
  assert.deepEqual(r.summary.faultEvents.map(e => e.fault), ['transient']);
  assert.equal(r.summary.envFault, null);
});

test('faults: lost_ack applies the write but answers with a timeout, so a blind retry duplicates it', async () => {
  const r = await hostRound({ 'req-1.json': { name: 'email_send_email', arguments: { recipient: 'a@b.co' } }, 'req-2.json': { name: 'email_send_email', arguments: { recipient: 'a@b.co' } } },
    { fault: { kind: 'lost_ack' } });
  assert.equal(r.res(1).text, FAULT_TEXT.lost_ack); assert.equal(r.res(1).isError, true);
  assert.equal(r.res(2).text, 'did email.send_email');
  assert.equal(r.bed.calls.length, 2);
  assert.deepEqual(trajectoryFromCalls(path.join(r.hostDir, 'calls.jsonl')).actions, ['email.send_email.func()', 'email.send_email.func()']);
});

test('faults: rename_param drift maps the new name back and refuses the old one; a distractor never reaches the world', async () => {
  const fault = { kind: 'rename_param', tool: 'email.send_email', from: 'recipient', to: 'to' };
  const r = await hostRound({ 'req-1.json': { name: 'email_send_email', arguments: { recipient: 'a@b.co' } }, 'req-2.json': { name: 'email_send_email', arguments: { to: 'a@b.co', subject: 's' } } }, { fault });
  assert.equal(r.res(1).text, FAULT_TEXT.unknownParam('recipient', 'to'));
  assert.equal(r.bed.calls.length, 1);
  assert.deepEqual(Object.entries(r.bed.calls[0].args), [['recipient', 'a@b.co'], ['subject', 's']]); // mapped back in place
  const calls = readFileSync(path.join(r.hostDir, 'calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(calls.map(c => [c.kind, c.fault]), [['fault', 'rename_param_old_name'], ['world', 'rename_param_mapped']]);
  const cat = applyFaultToCatalog({ mcpTools: [SEND, SEARCH], bedTools: BED }, { kind: 'distractor', like: 'email.send_email' });
  const d = await hostRound({ 'req-1.json': { name: 'email_send_email_v2', arguments: { recipient: 'a@b.co' } }, 'req-2.json': { name: 'email_send_email', arguments: { recipient: 'a@b.co' } } },
    { catalog: cat.hostCatalog, fault: { kind: 'distractor', like: 'email.send_email' } });
  assert.equal(d.res(1).text, FAULT_TEXT.retired('email_send_email_v2'));
  assert.deepEqual(d.bed.calls.map(c => c.name), ['email.send_email']);
  // without a fault the twin is unknown (rejected before any decision)
  const none = await hostRound({ 'req-1.json': { name: 'email_send_email_v2', arguments: {} } });
  assert.equal(none.summary.rejected, 1);
  assert.equal(faultState(null).decide({ name: 'x', args: { a: 1 } }).action, 'pass');
});

