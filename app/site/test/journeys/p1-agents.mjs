// P1, the developer with a coding agent (SPEC §7.2, §16). The harness plays both the person and a scripted agent (no model, $0):
// it copies the exact line from #/connect-agent, parses it, and spawns that argv over stdio with the MCP SDK client, so the server
// under test is the one the line starts. With form elicitation (Claude Code) the person approves in the client's dialog; without
// it (Cursor, Codex) the browser opens on the yes card. Decisions on the exact list happen in the browser page Foundry opens
// (FOUNDRY_URL_FILE stands in for the browser opener). The agent transcript is rendered to transcript.html and screenshotted.
// Not covered: a real Claude Code, Cursor or Codex client (their own trust and tool prompts are reported, not measured).
// nice node --test --test-concurrency=1 app/site/test/journeys/p1-agents.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { journey, closeBrowser, assertBudget, fixturePath, OUT } from './harness.mjs';
import { preview } from '../../../onboarding/csv.mjs';
import { commit } from '../../../onboarding/data.mjs';

after(closeBrowser);

const NOW = '2026-10-21T09:00:00.000Z';
const BUDGETS = { firstVerified: { steps: 2, asks: 0, since: 'setup' }, firstLive: { steps: 4, asks: 2, since: 'setup' } };

/** A shell line split the way a POSIX shell would for these lines: double-quoted words and bare words. */
export function shellWords(line) {
  const out = []; let cur = null, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"') quoted = false; else if (c === '\\' && /["\\$`]/.test(line[i + 1] ?? '')) cur += line[++i]; else cur += c; continue; }
    if (c === '"') { quoted = true; cur ??= ''; continue; }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? '') + c;
  }
  if (quoted) throw new Error('unterminated quote');
  if (cur !== null) out.push(cur);
  return out;
}

/** The person's invoice list, already in Foundry (precondition: they dropped it once before, e.g. in P2). */
function invoiceListInPlace(app) {
  const text = readFileSync(fixturePath('invoices-accounting-export.csv'), 'utf8');
  const pv = preview({ template: 'invoice-chase', sheet: 'invoices', text });
  commit(app, { template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping, answers: { 'dateOrder:due': 'dmy' }, target: 'live' });
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The transcript as a coding agent's terminal would show it (a stand-in, labelled as one). */
function transcriptHtml(title, entries) {
  const row = e => e.who === 'person' ? `<div class="person"><b>You</b><p>${esc(e.text)}</p></div>`
    : e.who === 'dialog' ? `<div class="dialog"><b>${esc(e.title)}</b><pre>${esc(e.text)}</pre><p class="choice">${esc(e.choice)}</p></div>`
      : e.who === 'tool' ? `<div class="tool"><code>foundry · ${esc(e.name)}(${esc(JSON.stringify(e.args))})</code><pre>${esc(e.result)}</pre></div>`
        : `<div class="agent"><b>Agent</b><p>${esc(e.text)}</p></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:15px/1.45 system-ui,sans-serif;background:#111418;color:#e8eaed;margin:0;padding:24px;max-width:1100px}
h1{font-size:18px;margin:0 0 4px}.label{color:#f2c94c;margin:0 0 18px}
div{border-radius:8px;padding:10px 14px;margin:0 0 10px}.person{background:#1f3a5f}.agent{background:#22262c}.tool{background:#181b1f;border:1px solid #333}
.dialog{background:#2b2240;border:2px solid #a78bfa}.choice{color:#a7f3d0;font-weight:600}
pre{white-space:pre-wrap;margin:6px 0 0;font:13px/1.4 ui-monospace,monospace;color:#cfd3d8}code{color:#9cdcfe;font-size:13px;word-break:break-all}p{margin:4px 0 0}
</style></head><body><h1>${esc(title)}</h1><p class="label">Scripted agent transcript: a stand-in for the coding agent's terminal, written by the journey harness. No model was called.</p>${entries.map(row).join('\n')}</body></html>`;
}

/** Spawn the server from the parsed line and wrap the scripted agent's tool calls. */
async function agent(argv, { elicitation, urlFile, transcript, onElicit }) {
  const transport = new StdioClientTransport({ command: argv[0], args: argv.slice(1), env: { ...getDefaultEnvironment(), FOUNDRY_URL_FILE: urlFile, FOUNDRY_KEYCHAIN: 'ephemeral' }, stderr: 'pipe' });
  const client = new Client({ name: elicitation ? 'journey-claude-code-stand-in' : 'journey-cursor-codex-stand-in', version: '1' }, { capabilities: elicitation ? { elicitation: { form: {} } } : {} });
  if (elicitation) client.setRequestHandler(ElicitRequestSchema, async req => onElicit(req.params));
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const out = JSON.parse(r.content[0].text);
    const brief = name === 'list_templates' ? `${out.templates.length} cards: ${out.templates.map(t => t.id).join(', ')}` : JSON.stringify({ status: out.status, say: out.say, ...(out.questions ? { questions: out.questions.map(q => q.question) } : {}), ...(out.where ? { where: out.where } : {}), ...(out.how ? { how: out.how } : {}) }, null, 1);
    transcript.push({ who: 'tool', name, args, result: brief });
    return { ...out, isError: !!r.isError };
  };
  return { client, call, close: () => client.close() };
}

async function waitForFile(file, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (existsSync(file) && readFileSync(file, 'utf8').trim()) return readFileSync(file, 'utf8').trim(); await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`the browser opener never wrote ${file}`);
}

async function connectPage(page, person, shot, agentKey) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${new URL(page.url()).origin}/#/connect-agent`);
  await page.waitForSelector(`[data-agent="${agentKey}"] pre`);
  await shot('connect-page', { note: 'what the agent can and cannot do, then the exact line' });
  await person.click(page.locator(`[data-agent="${agentKey}"] .snippet button`).first());
  return page.evaluate(() => navigator.clipboard.readText());
}

test('P1 Claude Code: one pasted line, then a request; first verified in 2 actions and 0 asks; the exact list decided in the browser', async () => {
  const log = await journey({ name: 'p1-claude-code', budgets: BUDGETS, before: app => invoiceListInPlace(app) }, async ({ page, person, shot, mark, base, dir, log }) => {
    const checks = log.checks = {}, transcript = [];
    const transcriptPage = await page.context().newPage();
    const showTranscript = async (slug, note) => { await transcriptPage.setContent(transcriptHtml('Claude Code (stand-in) — foundry connected', transcript)); await shot(slug, { of: transcriptPage, note }); };
    person.precondition('their invoice list is already in Foundry (dropped once before, as in P2)');
    const connect = await (await page.evaluate(async () => (await fetch('/api/connect', { headers: { 'x-foundry-token': sessionStorage.getItem('foundry-token') } })).json()));
    const line = await connectPage(page, person, shot, 'claudeCode');
    assert.equal(line, connect.claudeCode, 'the copied line is the one the API prints');
    const words = shellWords(line);
    assert.deepEqual(words.slice(0, 6), ['claude', 'mcp', 'add', '--transport', 'stdio', 'foundry']);
    const argv = words.slice(words.indexOf('--') + 1);
    assert.deepEqual(argv, connect.allowlist.serverCommand, 'the pasted line starts exactly the allowlisted argv');
    checks.argv = argv.map(a => a.replace(dir, '<ws>'));
    person.external('pastes the line into a terminal (Claude Code then shows its own trust prompt for the server: not counted, not verified)');
    const urlFile = path.join(dir, 'browser-url.txt');
    let elicited = null;
    const a = await agent(argv, { elicitation: true, urlFile, transcript, onElicit: async params => {
      elicited = params;
      // Turning on is a decision on what was tested, not a question whose wrong answer harms (it makes and sends nothing): a step,
      // not an ask, the same as the "Turn it on" button in the page (P2, P3, Cursor/Codex).
      person.external('approves "Turn on" in the agent\'s dialog');
      transcript.push({ who: 'dialog', title: 'Foundry asks you (shown by the client, not the model)', text: params.message, choice: 'You chose: approve' });
      return { action: 'accept', content: { decision: 'approve' } };
    } });
    try {
      mark('setup');
      const request = 'use Foundry to chase my unpaid invoices, summary to me@example.com';
      person.external(`types to the agent: "${request}"`);
      transcript.push({ who: 'person', text: request });
      const cards = await a.call('list_templates');
      const card = cards.templates.find(t => /invoice/i.test(t.title + t.whenToUse));
      const p = await a.call('propose_flow', { request, template: card.id, settings: { summaryTo: 'me@example.com' } });
      assert.equal(p.status, 'proposed', JSON.stringify(p));
      const d = await a.call('dry_run', { proposalId: p.proposalId });
      assert.equal(d.passed, true);
      transcript.push({ who: 'agent', text: d.say });
      mark('firstVerified');
      checks.dryRunSay = d.say;
      await showTranscript('agent-request-and-test', 'first verified: list_templates, propose_flow, dry_run');
      const ok = await a.call('approve', { proposalId: p.proposalId });
      assert.equal(ok.status, 'approved'); assert.ok(elicited, 'the client showed the dialog');
      checks.elicitation = elicited.message.split('\n')[0];
      transcript.push({ who: 'agent', text: ok.say });
      await showTranscript('elicitation-accepted', 'the person approved in the client dialog (channel mcp-elicitation)');
      const r = await a.call('run_flow', { flowId: p.flowId, input: { now: NOW } });
      assert.equal(r.status, 'awaiting_human', JSON.stringify(r)); assert.equal(r.count, 4);
      assert.equal(/#t=|token/i.test(JSON.stringify(r)), false, 'the tool result never carries the browser key');
      transcript.push({ who: 'agent', text: r.say });
      await showTranscript('run-waits-for-you', 'run_flow: the exact list waits for the person in the browser');
      const url = await waitForFile(urlFile);
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/#t=[^&]+&r=%2Fwaiting$/);
      await page.goto(url);
      await page.waitForSelector('[data-action="batch-approve"]');
      await shot('browser-waiting', { note: 'the page Foundry opened: the exact list' });
      await person.click(page.locator('[data-action="batch-approve"]'));
      await page.waitForSelector('[data-draft]');
      mark('firstLive', { accounts: 0, keys: 0, connections: 0 });
      await shot('drafts');
      checks.notCounted = ['Claude Code trust prompt for a new stdio server (setup)', 'Claude Code permission prompt for the approve tool (anthropic/requiresUserInteraction): +1 click per approval, not verified in a real client'];
    } finally { await a.close(); }
    writeFileSync(path.join(OUT, 'p1-claude-code', 'transcript.html'), transcriptHtml('Claude Code (stand-in) — foundry connected', transcript));
  });
  assertBudget(log, 'firstVerified', BUDGETS.firstVerified); assertBudget(log, 'firstLive', BUDGETS.firstLive);
});

test('P1 ungrounded: the agent fills an address the person never wrote; Foundry asks instead (+1 ask) and nothing is made until answered', async () => {
  const log = await journey({ name: 'p1-ungrounded' }, async ({ page, person, shot, mark, app, dir, log }) => {
    const checks = log.checks = {}, transcript = [];
    const transcriptPage = await page.context().newPage();
    const showTranscript = async (slug, note) => { await transcriptPage.setContent(transcriptHtml('Claude Code (stand-in) — the agent guessed an address', transcript)); await shot(slug, { of: transcriptPage, note }); };
    const line = await connectPage(page, person, shot, 'claudeCode');
    const words = shellWords(line), argv = words.slice(words.indexOf('--') + 1);
    person.external('pastes the line into a terminal');
    const a = await agent(argv, { elicitation: true, urlFile: path.join(dir, 'browser-url.txt'), transcript, onElicit: async () => ({ action: 'decline' }) });
    try {
      mark('setup');
      const request = 'use Foundry to chase my unpaid invoices';
      person.external(`types to the agent: "${request}"`);
      transcript.push({ who: 'person', text: request });
      const p = await a.call('propose_flow', { request, template: 'invoice-chase', settings: { summaryTo: 'boss@example.com' } });
      assert.equal(p.status, 'needs_answers', JSON.stringify(p));
      assert.equal(p.questions[0].slot ?? p.questions[0].id, 'summaryTo');
      assert.deepEqual(p.notWritten?.map(x => x.value) ?? [], ['boss@example.com']);
      const l = app.list();
      assert.equal(l.flows.length + l.proposals.length, 0, 'nothing was made from the guessed address');
      checks.refused = { status: p.status, question: p.questions[0].question, notWritten: p.notWritten };
      transcript.push({ who: 'agent', text: `${p.say} ${p.questions[0].question}` });
      await showTranscript('asked-not-guessed', 'the guessed address was not used; the template\'s own question is relayed');
      person.external('answers the agent: "me@example.com"', { ask: true });
      transcript.push({ who: 'person', text: 'me@example.com' });
      const p2 = await a.call('propose_flow', { request, template: 'invoice-chase', settings: { summaryTo: 'boss@example.com' }, answers: { summaryTo: 'me@example.com' } });
      assert.equal(p2.status, 'proposed', JSON.stringify(p2));
      const d = await a.call('dry_run', { proposalId: p2.proposalId });
      assert.equal(d.passed, true);
      assert.ok(d.wouldDo.some(w => w.to === 'me@example.com') && !d.wouldDo.some(w => w.to === 'boss@example.com'), 'the summary goes to the address the person gave');
      transcript.push({ who: 'agent', text: d.say });
      mark('firstVerified');
      await showTranscript('answered-and-tested', 'first verified after one extra ask');
    } finally { await a.close(); }
  });
  assertBudget(log, 'firstVerified', { steps: 3, asks: 1, since: 'setup' });
});

test('P1 Cursor or Codex: the install link and the line both decode to the same server; without a dialog the browser opens on the yes card', async () => {
  const budgets = { firstLive: { steps: 5, asks: 2, since: 'setup' } };
  const log = await journey({ name: 'p1-cursor-codex', budgets, before: app => invoiceListInPlace(app) }, async ({ page, person, shot, mark, dir, log }) => {
    const checks = log.checks = {}, transcript = [];
    const transcriptPage = await page.context().newPage();
    const showTranscript = async (slug, note) => { await transcriptPage.setContent(transcriptHtml('Codex (stand-in, no dialog support) — foundry connected', transcript)); await shot(slug, { of: transcriptPage, note }); };
    person.precondition('their invoice list is already in Foundry (dropped once before, as in P2)');
    const connect = await page.evaluate(async () => (await fetch('/api/connect', { headers: { 'x-foundry-token': sessionStorage.getItem('foundry-token') } })).json());
    // Cursor: the install link's config is the server entry, base64 of its JSON (cursor.com/docs/context/mcp/install-links).
    const config = new URL(connect.cursorLink.replace('cursor://', 'https://')).searchParams.get('config');
    assert.deepEqual(JSON.parse(Buffer.from(config, 'base64').toString('utf8')), connect.cursorJson.mcpServers.foundry);
    const line = await connectPage(page, person, shot, 'codex');
    const words = shellWords(line);
    assert.deepEqual(words.slice(0, 4), ['codex', 'mcp', 'add', 'foundry']);
    const argv = words.slice(words.indexOf('--') + 1);
    assert.deepEqual(argv, [connect.cursorJson.mcpServers.foundry.command, ...connect.cursorJson.mcpServers.foundry.args]);
    checks.sameServer = true;
    person.external('pastes the line into a terminal');
    const urlFile = path.join(dir, 'browser-url.txt');
    const a = await agent(argv, { elicitation: false, urlFile, transcript });
    try {
      mark('setup');
      const request = 'use Foundry to chase my unpaid invoices, summary to me@example.com';
      person.external(`types to the agent: "${request}"`);
      transcript.push({ who: 'person', text: request });
      const p = await a.call('propose_flow', { request, template: 'invoice-chase', settings: { summaryTo: 'me@example.com' } });
      const d = await a.call('dry_run', { proposalId: p.proposalId });
      assert.equal(d.passed, true);
      mark('firstVerified');
      const ok = await a.call('approve', { proposalId: p.proposalId });
      assert.equal(ok.status, 'awaiting_human'); assert.match(ok.how, /opened in your browser/);
      transcript.push({ who: 'agent', text: `${ok.say} ${ok.how}` });
      await showTranscript('approve-awaits-you', 'no dialog: the agent cannot approve; the browser opens');
      const url = await waitForFile(urlFile);
      await page.goto(url);
      await page.waitForSelector('[data-activation]');
      await shot('browser-yes-card', { note: 'the yes card, opened by Foundry' });
      await person.click(page.locator('[data-activation] .decision button.primary'));
      await page.waitForSelector('main .banner.ok');
      await shot('turned-on');
      person.external('tells the agent: "done, go ahead"');
      transcript.push({ who: 'person', text: 'done, go ahead' });
      const r = await a.call('run_flow', { flowId: p.flowId, input: { now: NOW } });
      assert.equal(r.status, 'awaiting_human');
      transcript.push({ who: 'agent', text: r.say });
      await showTranscript('run-waits-for-you', 'the exact list waits in the same browser page');
      await page.waitForFunction(() => !document.getElementById('waiting-count')?.hidden, null, { timeout: 15000 });
      await person.click(page.locator('[data-nav="waiting"]'));
      await page.waitForSelector('[data-action="batch-approve"]');
      await shot('browser-waiting');
      await person.click(page.locator('[data-action="batch-approve"]'));
      await page.waitForSelector('[data-draft]');
      mark('firstLive', { accounts: 0, keys: 0, connections: 0 });
      await shot('drafts');
    } finally { await a.close(); }
  });
  assertBudget(log, 'firstLive', budgets.firstLive);
});

