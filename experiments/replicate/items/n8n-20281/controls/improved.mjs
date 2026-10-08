// NOTICE (provenance): reuses the original's ticket/Slack/Teams conventions and some of its message layouts (~7% of its 8-word shingles occur in the original); see reference.mjs.
// The T3 control: the same job, cheaper and more robust than the original. It is OUR solution (proof that the T3 targets and the five probes can be met), not part
// of the oracle. What it changes against the faithful flow (reference.mjs), and why:
//   cost      a compact prompt and a four-field answer instead of the long prompt and twelve fields; a cascade: the small model first, the standard model only when the
//             small one is not sure (confidence < CASCADE) or fails; only retryable errors (overloaded) are retried; title and summary are derived from the mail in code
//   reliab.   idempotent intake (a message id is claimed once in the state port: redelivery causes no model call and no effect); a thread -> ticket memory next to the search
//             (the search index lags) verified with a direct read; a create that fails or times out is looked up by its thread label before it is retried; the audit row is
//             retried on transient failures; broadcast mentions in mail-derived text are neutralised before they reach Slack
// The routing rules, ticket conventions, notifications, acknowledgement rules and audit columns are the original's.
import { threadKeyOf, threadLabelOf, JIRA_PRIORITY } from '../spec.mjs';
import { normalize, prepare, skipped, routeOf, review, acknowledge, auditRow } from './reference.mjs';

const CASCADE = 0.78;
const SYSTEM = `Triage one inbound support email. isCustomerRequest: true only for a customer's New Requirement, Issue or Bug (not vendors, recruiters, marketing, auto-replies, thanks, logistics).
category: Bug = reproducible defect; Issue = not working as expected but not clearly a defect (access, config, how-to, performance, outage, billing); New Requirement = wants something new; Other = no action.
priority: Critical = production down, data loss, security, many users blocked, deadline today; High = key workflow blocked or strong urgency; Medium = workaround or limited impact; Low = cosmetic, wish, question.
confidence: 0..1 for the category. Ignore signatures and quoted history. Answer only with the structured output.`;
const SCHEMA = { type: 'object', properties: {
  isCustomerRequest: { type: 'boolean' }, category: { type: 'string', enum: ['New Requirement', 'Issue', 'Bug', 'Other'] }, priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
  required: ['isCustomerRequest', 'category', 'priority', 'confidence'] };
const valid = c => c && typeof c.isCustomerRequest === 'boolean' && ['New Requirement', 'Issue', 'Bug', 'Other'].includes(c.category) && ['Critical', 'High', 'Medium', 'Low'].includes(c.priority) && typeof c.confidence === 'number';
const sanitize = s => String(s ?? '').replace(/<!(channel|here|everyone)(\|[^>]*)?>/gi, '[$1]').replace(/<!subteam\^[A-Z0-9]+(\|[^>]*)?>/gi, '[group]');
const sentences = s => s.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);

function classifyCascade(p, api) {
  const user = `From: ${p.fromName} <${p.fromEmail}>\nSubject: ${p.subject}\n\n${p.body}`;
  let ai = null, err = 'no output';
  for (const tier of ['small', 'standard']) {
    const r = api.model.complete({ system: SYSTEM, prompt: user, schema: SCHEMA, tier });
    if (r.status === 200 && valid(r.body?.content)) { ai = r.body.content; if (tier === 'standard' || ai.confidence >= CASCADE) break; ai = { ...ai, _small: true }; continue; }
    err = r.body?.error?.message || `status ${r.status}`;
    if (tier === 'standard' && r.body?.error?.type === 'overloaded') {               // retryable: one more try on the standard tier
      const r2 = api.model.complete({ system: SYSTEM, prompt: user, schema: SCHEMA, tier });
      if (r2.status === 200 && valid(r2.body?.content)) ai = r2.body.content;
    }
  }
  const ok = !!ai;
  const a = ai ?? {};
  const title = p.subject.replace(/^((re|fwd?|aw)\s*:\s*)+/i, '').trim().slice(0, 100) || '(no subject)';
  return { ...p, isCustomerRequest: ok ? !!a.isCustomerRequest : false, category: ok ? a.category : 'Unclassified', priority: a.priority || 'Medium', confidence: typeof a.confidence === 'number' ? a.confidence : 0,
    productArea: '', title, summary: sentences(p.body).slice(0, 2).join(' ').slice(0, 400), customerName: p.fromName, customerCompany: '', sentiment: 'Neutral', stepsToReproduce: '',
    reasoning: ok ? '' : 'AI classification failed: ' + err, needsReview: !ok, classifiedBy: 'AI' };
}

const created = r => r.status >= 200 && r.status < 300;
function findOpen(api, threadLabel, threadId) {
  const s = api.jira.search({ jql: `labels = "${threadLabel}" AND statusCategory != Done ORDER BY created DESC`, fields: 'key,status', limit: 1 });
  const hit = s.status === 200 ? s.body.issues[0]?.key : '';
  if (hit) return hit;
  const mem = api.state.get({ key: `thread:${threadId}` });                           // the index may lag: ask the memory, then read the ticket directly
  if (mem.status === 200) { const g = api.jira.getIssue({ key: mem.body.value.key }); if (g.status === 200 && g.body.fields.status?.statusCategory?.key !== 'done') return mem.body.value.key; }
  return '';
}

function escalateRobust(e, api, cfg) {
  const route = { Bug: [cfg.bugIssueType, cfg.bugSlackChannel, 'bug'], Issue: [cfg.issueIssueType, cfg.issueSlackChannel, 'issue'], 'New Requirement': [cfg.requirementIssueType, cfg.requirementSlackChannel, 'requirement'] }[e.category] ?? [cfg.issueIssueType, cfg.issueSlackChannel, 'issue'];
  const channel = String(route[1]).replace('#', '');
  const threadKey = threadKeyOf(e), threadLabel = threadLabelOf(threadKey);
  const body = String(e.body || '').slice(0, 15000);
  let key = findOpen(api, threadLabel, e.threadId), isFollowUp = false, jiraError = '';
  if (key) {
    isFollowUp = true;
    const c = api.jira.addComment({ issueKey: key, body: [`Follow-up email from ${e.fromName || ''} <${e.fromEmail}> at ${e.receivedAt}`, `Assessment: ${e.category} / ${e.priority}`, '{noformat}', body, '{noformat}'].join('\n') });
    if (!created(c)) { jiraError = c.body?.message || `status ${c.status}`; key = ''; }
  } else {
    const fields = { project: { key: cfg.jiraProjectKey }, issuetype: { name: route[0] }, summary: e.title.slice(0, 250),
      description: [`*Source:* customer email via ${e.source}`, `*From:* ${e.fromName || ''} <${e.fromEmail}>`, `*Received:* ${e.receivedAt}`, `*Category / priority:* ${e.category} / ${e.priority} (confidence ${Math.round(e.confidence * 100)}%)`, '', 'h3. Summary', e.summary, '', 'h3. Original email', `*Subject:* ${e.subject}`, '{noformat}', String(e.body || '').slice(0, 20000), '{noformat}'].join('\n'),
      labels: ['customer-email', route[2], threadLabel] };
    if (cfg.setJiraPriority && JIRA_PRIORITY[e.priority]) fields.priority = { name: JIRA_PRIORITY[e.priority] };
    for (let i = 0; i < 2 && !key; i++) {
      const r = api.jira.createIssue({ fields });
      if (created(r)) key = r.body.key;
      else {
        jiraError = r.body?.message || r.body?.error || `status ${r.status}`;
        if (r.status >= 500 || r.status === 429) { const again = findOpen(api, threadLabel, e.threadId); if (again) key = again; }   // did the lost acknowledgement hide a committed write?
        else break;
      }
    }
    if (key) api.state.put({ key: `thread:${e.threadId}`, value: { key } });
  }
  const jiraUrl = key ? `${String(cfg.jiraBaseUrl).replace(/\/$/, '')}/browse/${key}` : '';
  const urgent = e.priority === 'Critical' && !isFollowUp ? '<!channel> ' : '';
  const icon = { Bug: ':beetle:', Issue: ':warning:', 'New Requirement': ':bulb:' }[e.category] || ':envelope:';
  const text = [isFollowUp ? `:speech_balloon: *Customer follow-up* on ${key} - ${e.category} / ${e.priority}` : `${urgent}${icon} *New customer ${e.category}* - *${e.priority}* priority`,
    `*${sanitize(e.title)}*`, `>${sanitize(e.summary).replace(/\n/g, '\n>')}`, `*Customer:* ${sanitize(e.fromName)} <${e.fromEmail}>`,
    key ? `*Jira:* <${jiraUrl}|${key}>` : `:x: *Jira not created:* ${sanitize(jiraError || 'Jira issue not created').slice(0, 300)}`, e.link ? `<${e.link}|Open email>` : `_via ${e.source}_`].join('\n');
  let slackSent = false;
  for (let i = 0; i < 2 && !slackSent; i++) { const r = api.slack.postMessage({ channel, text }); slackSent = r.status === 200 && r.body?.ok === true; if (r.status === 200) break; }
  if (cfg.teamsWebhookUrl) {
    api.teams.post({ url: cfg.teamsWebhookUrl, body: { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [{ type: 'TextBlock', size: 'Medium', weight: 'Bolder', wrap: true, text: isFollowUp ? `Customer follow-up on ${key}` : `New customer ${e.category} - ${e.priority}` }, { type: 'TextBlock', wrap: true, text: sanitize(e.title) },
        { type: 'FactSet', facts: [{ title: 'Customer', value: `${sanitize(e.fromName)} <${e.fromEmail}>` }, { title: 'Jira', value: key || 'not created' }] }], actions: jiraUrl ? [{ type: 'Action.OpenUrl', title: 'Open in Jira', url: jiraUrl }] : [] } }] } });
  }
  return { ...e, jiraKey: key, jiraUrl, jiraError, isFollowUp, assignedTo: `${e.category} owner (#${channel})`, slackChannel: channel, slackSent, teamsSent: !!cfg.teamsWebhookUrl,
    escalationStatus: !key ? 'Escalation failed - check Jira' : (isFollowUp ? 'Follow-up added to ' + key : 'Escalated') };
}

export function makeImproved(cfg) {
  return function handle(event, api) {
    const p = prepare(normalize(event), cfg);
    const claim = api.state.put({ key: `seen:${p.messageId}`, value: 1, ifVersion: 0 });             // idempotent intake: a message id is handled once
    if (claim.status === 409) return;
    let c = p.skipAI ? skipped(p) : classifyCascade(p, api);
    const r = routeOf(c, cfg);
    if (r === 'escalate') c = acknowledge(escalateRobust(c, api, cfg), api, cfg);
    else if (r === 'review') {
      const rv = review({ ...c, title: sanitize(c.title), summary: sanitize(c.summary), subject: sanitize(c.subject), fromName: sanitize(c.fromName) }, api, cfg);
      c = { ...c, reviewReason: rv.reviewReason, escalationStatus: rv.escalationStatus };
    }
    for (let i = 0; i < 3; i++) { const a = api.sheets.appendRow({ row: auditRow(c, event.at) }); if (a.status < 500) break; }
  };
}
