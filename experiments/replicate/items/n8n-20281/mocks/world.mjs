// One scenario's world: the six mock services, the model, a small key-value state port and the cost bookkeeping.
// `call(name, args)` is the whole interface a solver has. Every call returns {response:{status, body}, meta} where meta carries the host-side facts
// (latency, model usage and cost, the effects that were actually COMMITTED, whatever the response said).
import { clone, ok, fail, isObj } from './common.mjs';
import { Jira } from './jira.mjs';
import { Slack } from './slack.mjs';
import { Teams } from './teams.mjs';
import { Sheets } from './sheets.mjs';
import { Gmail } from './gmail.mjs';
import { Outlook } from './outlook.mjs';
import { Model, companyOf, pricedAnswer } from './model.mjs';
import { LATENCY_MS, CATEGORY_KEY, threadLabelOf } from '../spec.mjs';

export const API_OPS = Object.freeze(['gmail.reply', 'gmail.createDraft', 'outlook.reply', 'jira.search', 'jira.createIssue', 'jira.addComment', 'jira.getIssue',
  'slack.postMessage', 'teams.post', 'sheets.appendRow', 'sheets.appendRows', 'state.get', 'state.put', 'model.complete']);
export const WRITE_OPS = new Set(['gmail.reply', 'gmail.createDraft', 'outlook.reply', 'jira.createIssue', 'jira.addComment', 'slack.postMessage', 'teams.post', 'sheets.appendRow', 'sheets.appendRows']);
const latencyOf = name => name.startsWith('jira.') ? (LATENCY_MS[name] ?? LATENCY_MS['jira.search']) : LATENCY_MS[name.split('.')[0]] ?? 200;

// Registry entry of a mail (what the mail services know about messages in the mailbox).
export function registryEntry(entry) {
  const m = entry.mail;
  if (entry.provider === 'gmail') return { id: m.id, threadId: m.threadId, fromEmail: m.from.value[0].address, to: m.to.value.map(a => a.address), cc: (m.cc?.value ?? []).map(a => a.address), subject: m.subject };
  return { id: m.id, threadId: m.conversationId, fromEmail: m.from.emailAddress.address, to: m.toRecipients.map(r => r.emailAddress.address), cc: (m.ccRecipients ?? []).map(r => r.emailAddress.address), subject: m.subject };
}
export function infoOf(entry) {
  const m = entry.mail;
  const addr = entry.provider === 'gmail' ? m.from.value[0].address : m.from.emailAddress.address;
  const name = entry.provider === 'gmail' ? m.from.value[0].name : m.from.emailAddress.name;
  return { subject: m.subject, fromName: name, fromAddress: addr, company: companyOf(addr), plain: entry.plain };
}

export function seedFields(t, config) {
  const type = { Bug: config.bugIssueType, Issue: config.issueIssueType, 'New Requirement': config.requirementIssueType }[t.category];
  return {
    project: { key: config.jiraProjectKey }, issuetype: { name: type }, summary: t.summary, description: '(opened before this run)',
    labels: ['customer-email', CATEGORY_KEY[t.category], threadLabelOf(t.threadId)], priority: { name: 'Medium' },
    status: { name: t.status, statusCategory: { key: t.statusCategory, name: { new: 'To Do', indeterminate: 'In Progress', done: 'Done' }[t.statusCategory] } },
    created: '2026-10-05T09:00:00.000+0000',
  };
}

export class World {
  constructor({ config, entries, recordings, seeds = [], nextIssueNumber, faults = {}, modelBackend = null, modelTape = null }) {
    this.cfg = config; this.entries = entries; this.faults = faults;
    const messages = entries.map(registryEntry);
    const infoByRef = Object.fromEntries(entries.map(e => [e.ref, infoOf(e)]));
    const own = 'support@brightlane.example';
    this.jira = new Jira({ projectKey: config.jiraProjectKey, issueTypes: [config.bugIssueType, config.issueIssueType, config.requirementIssueType],
      seedTickets: seeds.map(t => ({ n: t.n, fields: seedFields(t, config) })), nextNumber: nextIssueNumber, faults: faults.jira ?? {} });
    this.slack = new Slack({ channels: [config.bugSlackChannel, config.issueSlackChannel, config.requirementSlackChannel, config.reviewSlackChannel] });
    this.teams = new Teams({ webhookUrl: config.teamsWebhookUrl });
    this.sheets = new Sheets({ faults: faults.sheets ?? {} });
    this.gmail = new Gmail({ messages: messages.filter((_, i) => entries[i].provider === 'gmail'), ownAddress: own });
    this.outlook = new Outlook({ messages: messages.filter((_, i) => entries[i].provider === 'outlook'), ownAddress: own });
    this.model = new Model({ recordings: recordings.byRef, infoByRef });
    this.modelBackend = modelBackend; this.modelTape = modelTape ? [...modelTape] : null;
    this.kv = { data: {} };
    this.stats = { calls: 0, externalCalls: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 };
  }

  #counts() { return { jira: this.jira.state.events.length, slack: this.slack.state.messages.length, teams: this.teams.state.posts.length, rows: this.sheets.state.rows.length,
    gs: this.gmail.state.sent.length, gd: this.gmail.state.drafts.length, os: this.outlook.state.sent.length, od: this.outlook.state.drafts.length }; }
  #effects(b, a) {
    const e = [];
    for (const x of this.jira.state.events.slice(b.jira, a.jira)) e.push({ type: x.type === 'create' ? 'jira.create' : 'jira.comment', key: x.key });
    for (const x of this.slack.state.messages.slice(b.slack, a.slack)) e.push({ type: 'slack', channel: x.channel, text: x.text, broadcasts: x.broadcasts });
    for (const x of this.teams.state.posts.slice(b.teams, a.teams)) e.push({ type: 'teams', url: x.url, text: JSON.stringify(x.body) });
    if (a.rows > b.rows) e.push({ type: 'sheet.rows', n: a.rows - b.rows });
    for (const x of this.gmail.state.sent.slice(b.gs, a.gs)) e.push({ type: 'mail.send', provider: 'gmail', to: x.to, cc: x.cc, text: x.text, threadId: x.threadId });
    for (const x of this.gmail.state.drafts.slice(b.gd, a.gd)) e.push({ type: 'mail.draft', provider: 'gmail', to: x.to, cc: [], text: x.text, threadId: x.threadId, subject: x.subject });
    for (const x of this.outlook.state.sent.slice(b.os, a.os)) e.push({ type: 'mail.send', provider: 'outlook', to: x.to, cc: x.cc, text: x.comment, threadId: x.conversationId });
    for (const x of this.outlook.state.drafts.slice(b.od, a.od)) e.push({ type: 'mail.draft', provider: 'outlook', to: x.to, cc: x.cc, text: x.comment, threadId: x.conversationId });
    return e;
  }

  call(name, args) {
    const a = isObj(args) ? clone(args) : {};
    const [svc, op] = String(name).split('.');
    const before = this.#counts();
    let res, latencyMs = latencyOf(String(name)), usage = null, costUsd = 0;
    this.stats.calls++;
    switch (name) {
      case 'gmail.reply': res = this.gmail.reply(a); break;
      case 'gmail.createDraft': res = this.gmail.createDraft(a); break;
      case 'outlook.reply': res = this.outlook.reply(a); break;
      case 'jira.search': res = this.jira.search(a); break;
      case 'jira.createIssue': res = this.jira.createIssue(a); break;
      case 'jira.addComment': res = this.jira.addComment(a); break;
      case 'jira.getIssue': res = this.jira.getIssue(a); break;
      case 'slack.postMessage': res = this.slack.postMessage(a); break;
      case 'teams.post': res = this.teams.post(a); break;
      case 'sheets.appendRow': res = this.sheets.appendRow(a); break;
      case 'sheets.appendRows': res = this.sheets.appendRows(a); break;
      case 'state.get': {
        const rec = this.kv.data[String(a.key)];
        res = rec ? ok(200, { value: clone(rec.value), version: rec.version }) : fail(404, 'NOT_FOUND', 'no such key');
        break;
      }
      case 'state.put': {
        const key = String(a.key); const rec = this.kv.data[key];
        if (a.ifVersion !== undefined && (rec?.version ?? 0) !== a.ifVersion) res = fail(409, 'VERSION_CONFLICT', `current version is ${rec?.version ?? 0}`);
        else if (JSON.stringify(a.value ?? null).length > 100000) res = fail(413, 'TOO_LARGE', 'value larger than 100 KB');
        else { this.kv.data[key] = { value: clone(a.value ?? null), version: (rec?.version ?? 0) + 1 }; res = ok(200, { version: this.kv.data[key].version }); }
        break;
      }
      case 'model.complete': {
        this.stats.modelCalls++;
        let r;
        // A replayed tape supplies only the answer (status, content); usage, cost and latency are recomputed from the request and that content.
        if (this.modelTape) r = pricedAnswer(a, this.modelTape.shift() ?? fail(500, 'TAPE_EXHAUSTED', 'replay has no recorded model answer left'));
        else if (this.modelBackend) r = this.modelBackend(a);
        else r = this.model.complete(a);
        res = { status: r.status, body: r.body };
        latencyMs = r.latencyMs ?? 600;
        usage = r.body?.usage ?? null; costUsd = r.body?.costUsd ?? 0;
        break;
      }
      default: res = fail(400, 'UNKNOWN_CALL', `unknown call "${name}"; calls are ${API_OPS.join(', ')}`);
    }
    const effects = this.#effects(before, this.#counts());
    const isModel = name === 'model.complete', isState = svc === 'state', known = API_OPS.includes(name);
    if (known && !isModel && !isState) this.stats.externalCalls++;
    if (usage) { this.stats.inputTokens += usage.inputTokens ?? 0; this.stats.outputTokens += usage.outputTokens ?? 0; }
    this.stats.costUsd += costUsd; this.stats.latencyMs += known ? latencyMs : 0;
    return { response: clone(res), meta: { latencyMs: known ? latencyMs : 0, usage, costUsd, effects, known } };
  }

  dump() {
    return { jira: this.jira.dump(), slack: clone(this.slack.state.messages), teams: clone(this.teams.state.posts), rows: clone(this.sheets.state.rows),
      gmail: clone(this.gmail.state), outlook: clone(this.outlook.state), kv: clone(this.kv.data), stats: { ...this.stats } };
  }
  snapshot() {
    return clone({ jira: this.jira.state, slack: this.slack.state, teams: this.teams.state, sheets: this.sheets.state, gmail: this.gmail.state, outlook: this.outlook.state,
      model: this.model.state, kv: this.kv, stats: this.stats, tape: this.modelTape });
  }
  restore(s) {
    const c = clone(s);
    this.jira.state = c.jira; this.slack.state = c.slack; this.teams.state = c.teams; this.sheets.state = c.sheets; this.gmail.state = c.gmail; this.outlook.state = c.outlook;
    this.model.state = c.model; this.kv = c.kv; this.stats = c.stats; this.modelTape = c.tape;
  }
}
