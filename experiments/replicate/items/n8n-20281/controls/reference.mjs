// Faithful reference re-implementation of the author's workflow, written as a plain handler (event, api) -> void.
// It is OUR transcription of what the definition does (flow, rules, retries, the audit row), not the original's text: prompts, reply texts and
// message layouts are re-worded where the original is not redistributable (n8n ToS). It is the T3 cost baseline and one of the "known good" controls.
// The original definition itself is executed separately (n8n-emulator.mjs) and the two traces are compared (run-controls.mjs).
import { threadKeyOf, threadLabelOf, JIRA_PRIORITY, CATEGORY_KEY } from '../spec.mjs';

export const CLASS_SCHEMA = {
  type: 'object',
  properties: {
    isCustomerRequest: { type: 'boolean' }, category: { type: 'string', enum: ['New Requirement', 'Issue', 'Bug', 'Other'] }, priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 }, productArea: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, customerName: { type: 'string' },
    customerCompany: { type: 'string' }, sentiment: { type: 'string', enum: ['Positive', 'Neutral', 'Negative', 'Angry'] }, stepsToReproduce: { type: 'string' }, reasoning: { type: 'string' },
  },
  required: ['isCustomerRequest', 'category', 'priority', 'confidence', 'productArea', 'title', 'summary', 'customerName', 'customerCompany', 'sentiment', 'stepsToReproduce', 'reasoning'],
};

// Re-worded system prompt of comparable size and the same rules as the author's (categories, priorities, field rules).
export const SYSTEM_PROMPT = `You are a senior customer-support triage analyst at a B2B software company. You read ONE inbound email and decide whether it is a genuine customer request and, if so, what kind of request it is.

Categories (choose exactly one):
- "New Requirement": the customer wants something that does not exist today: a feature, an enhancement, a change request, an integration, a report or a customisation.
- "Issue": something does not work the way the customer expects, but it is NOT clearly a software defect. Typical cases are access or login trouble, configuration or data questions, how-to confusion, performance complaints, outages of the service, and billing or account problems.
- "Bug": a reproducible software defect, such as error messages, crashes, wrong calculations, broken screens, or functions that contradict their documented behaviour.
- "Other": newsletters, marketing, sales pitches, vendor or recruiter outreach, supplier invoices, automatic replies, thank-you notes, meeting logistics, spam, and anything else that needs no product or support action.

Priority:
- "Critical": production is down, data is lost or corrupted, there is a security incident, many users are blocked, or the customer names a severe business impact or a deadline today.
- "High": an important workflow is blocked for some users with no workaround, or the language is strongly urgent or escalating.
- "Medium": a workaround exists or the impact is limited; most feature requests from active customers belong here.
- "Low": cosmetic issues, nice-to-have wishes and general questions.

Rules:
- isCustomerRequest is true only for a New Requirement, Issue or Bug that comes from a customer, client or end user, never from vendors, recruiters or marketing.
- If the email mixes several asks, classify by the most severe one (Bug before Issue before New Requirement) and mention the others in the summary.
- title: an actionable ticket title of at most 100 characters, without the customer's name.
- summary: two to four sentences a developer can act on; include versions, modules, identifiers and error texts when present.
- stepsToReproduce: only for a Bug, otherwise an empty string.
- productArea: the module or feature mentioned (for example "Billing", "Login", "Reports", "API", "Mobile App"), or "General".
- customerCompany: infer it from the signature or the sender's domain if you can, otherwise an empty string.
- confidence: a number from 0 to 1 for how sure you are about the category.
- Ignore signatures, legal disclaimers and quoted earlier messages.
- Answer ONLY with the structured output.`;

const lower = v => String(v ?? '').toLowerCase();
const stripHtml = h => String(h ?? '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

export function normalize(event) {
  const m = event.data;
  if (event.trigger === 'gmail-new-email') {
    const from = m.from?.value?.[0] || {};
    return {
      source: 'Gmail', messageId: m.id || m.messageId || '', threadId: m.threadId || '', receivedAt: m.date ? new Date(m.date).toISOString() : event.at,
      fromName: from.name || '', fromEmail: lower(from.address), to: m.to?.text || '', subject: m.subject || '(no subject)', body: m.text || stripHtml(m.html),
      link: m.threadId ? `https://mail.google.com/mail/u/0/#all/${m.threadId}` : '', hasAttachments: Object.keys(m).some(k => k.startsWith('attachment')) || (m.attachments?.length > 0),
    };
  }
  const from = m.from?.emailAddress || m.sender?.emailAddress || {};
  const html = m.body?.content || '';
  const text = m.body?.contentType === 'text' ? html : String(html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ');
  return {
    source: 'Outlook', messageId: m.id || '', threadId: m.conversationId || '', receivedAt: m.receivedDateTime || event.at, fromName: from.name || '', fromEmail: lower(from.address),
    to: (m.toRecipients || []).map(r => r.emailAddress?.address).join(', '), subject: m.subject || '(no subject)', body: text || m.bodyPreview || '', link: m.webLink || '', hasAttachments: !!m.hasAttachments,
  };
}

export function prepare(e, cfg) {
  const list = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const domain = e.fromEmail.split('@')[1] || '';
  let skipReason = '';
  if (!e.fromEmail) skipReason = 'No sender address';
  else if (list(cfg.internalDomains).includes(domain)) skipReason = 'Internal sender (' + domain + ')';
  else if (list(cfg.ignoreSenderPatterns).some(p => e.fromEmail.includes(p))) skipReason = 'Automated / no-reply sender';
  let body = String(e.body || '');
  const cut = body.search(/\n(On .{0,200}wrote:|-{2,}\s*Original Message|From:\s.+\n(Sent|Date):)/i);
  if (cut > 0) body = body.slice(0, cut);
  body = body.split('\n').filter(l => !l.trim().startsWith('>')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const max = Number(cfg.maxBodyChars) || 6000;
  if (body.length > max) body = body.slice(0, max) + '\n...[truncated]';
  return { ...e, body, skipAI: !!skipReason, skipReason };
}

const validClass = c => c && typeof c === 'object' && CLASS_SCHEMA.required.every(k => k in c) && CLASS_SCHEMA.properties.category.enum.includes(c.category)
  && CLASS_SCHEMA.properties.priority.enum.includes(c.priority) && typeof c.confidence === 'number' && typeof c.isCustomerRequest === 'boolean';

export function skipped(p) {
  return { ...p, isCustomerRequest: false, category: 'Other', priority: 'Low', confidence: 1, productArea: '', title: p.subject, summary: 'Skipped: ' + p.skipReason, customerName: p.fromName,
    customerCompany: '', sentiment: 'Neutral', stepsToReproduce: '', reasoning: p.skipReason, needsReview: false, classifiedBy: 'rules' };
}

export function classify(p, api, { tries = 3, tier = 'standard', system = SYSTEM_PROMPT } = {}) {
  const user = `Classify this inbound email.\n\nReceived via: ${p.source}\nFrom: ${p.fromName} <${p.fromEmail}>\nSubject: ${p.subject}\nHas attachments: ${p.hasAttachments}\n\nBody:\n"""\n${p.body}\n"""`;
  let ai = null, err = 'no output';
  for (let i = 0; i < tries && !ai; i++) {
    const r = api.model.complete({ system, prompt: user, schema: CLASS_SCHEMA, tier });
    if (r.status === 200 && validClass(r.body?.content)) ai = r.body.content; else err = r.body?.error?.message || r.body?.error || `status ${r.status}`;
  }
  const ok = !!ai?.category;
  const a = ai ?? {};
  return { ...p, isCustomerRequest: ok ? !!a.isCustomerRequest : false, category: ok ? a.category : 'Unclassified', priority: a.priority || 'Medium', confidence: typeof a.confidence === 'number' ? a.confidence : 0,
    productArea: a.productArea || '', title: a.title || p.subject || '(no subject)', summary: a.summary || '', customerName: a.customerName || p.fromName || '', customerCompany: a.customerCompany || '',
    sentiment: a.sentiment || 'Neutral', stepsToReproduce: a.stepsToReproduce || '', reasoning: a.reasoning || (ok ? '' : 'AI classification failed: ' + err), needsReview: !ok, classifiedBy: 'AI' };
}

export const routeOf = (c, cfg) => {
  if (c.isCustomerRequest === true && ['New Requirement', 'Issue', 'Bug'].includes(c.category) && Number(c.confidence) >= Number(cfg.minConfidence)) return 'escalate';
  if (c.needsReview === true || (c.isCustomerRequest === true && Number(c.confidence) < Number(cfg.minConfidence))) return 'review';
  return 'ignore';
};

function jiraRoute(e, cfg) {
  const ROUTES = {
    Bug: { issueType: cfg.bugIssueType || 'Bug', assigneeAccountId: cfg.bugAssigneeAccountId, slackChannel: cfg.bugSlackChannel, labels: ['customer-email', 'bug'] },
    Issue: { issueType: cfg.issueIssueType || 'Task', assigneeAccountId: cfg.issueAssigneeAccountId, slackChannel: cfg.issueSlackChannel, labels: ['customer-email', 'issue'] },
    'New Requirement': { issueType: cfg.requirementIssueType || 'Story', assigneeAccountId: cfg.requirementAssigneeAccountId, slackChannel: cfg.requirementSlackChannel, labels: ['customer-email', 'requirement'] },
  };
  const route = { ...(ROUTES[e.category] || ROUTES.Issue) };
  route.slackChannel = String(route.slackChannel || '').replace('#', '');
  route.owner = `${e.category} owner (#${route.slackChannel})`;
  return route;
}

export function escalate(e, api, cfg, { createTries = 2 } = {}) {
  const route = jiraRoute(e, cfg);
  const threadKey = threadKeyOf(e);
  const threadLabel = threadLabelOf(threadKey);
  const description = [`*Source:* customer email via ${e.source}`, `*From:* ${e.fromName || ''} <${e.fromEmail}>${e.customerCompany ? ' - ' + e.customerCompany : ''}`, `*Received:* ${e.receivedAt}`,
    `*Category / priority:* ${e.category} / ${e.priority} (confidence ${Math.round((e.confidence || 0) * 100)}%)`, `*Product area:* ${e.productArea || 'General'}  |  *Sentiment:* ${e.sentiment}`,
    '', 'h3. Summary', e.summary || '', e.stepsToReproduce ? '\nh3. Steps to reproduce\n' + e.stepsToReproduce : '', '', 'h3. Original email', `*Subject:* ${e.subject}`,
    '{noformat}', String(e.body || '').slice(0, 20000), '{noformat}'].join('\n');
  const fields = { project: { key: cfg.jiraProjectKey }, issuetype: { name: route.issueType }, summary: String(e.title || e.subject || 'Customer request').slice(0, 250), description, labels: [...route.labels, threadLabel] };
  if (cfg.setJiraPriority && JIRA_PRIORITY[e.priority]) fields.priority = { name: JIRA_PRIORITY[e.priority] };
  if (route.assigneeAccountId) fields.assignee = { accountId: route.assigneeAccountId };
  const dedupEnabled = cfg.dedupByThread !== false && !!threadKey;
  const jql = `labels = "${threadLabel}" AND statusCategory != Done ORDER BY created DESC`;

  let found = '';
  if (dedupEnabled) { const s = api.jira.search({ jql, fields: 'key,status', limit: 1 }); if (s.status === 200) found = s.body.issues[0]?.key || ''; }
  let jiraKey = '', isFollowUp = false, jiraError = '';
  if (found) {
    isFollowUp = true;
    const c = api.jira.addComment({ issueKey: found, body: [`Follow-up email from ${e.fromName || ''} <${e.fromEmail}> at ${e.receivedAt}`, `Assessment: ${e.category} / ${e.priority} - ${e.summary || ''}`, '{noformat}', String(e.body || '').slice(0, 15000), '{noformat}'].join('\n') });
    if (c.status >= 200 && c.status < 300) jiraKey = found; else jiraError = c.body?.message || `status ${c.status}`;
  } else {
    for (let i = 0; i < createTries && !jiraKey; i++) {
      const r = api.jira.createIssue({ fields });
      if (r.status >= 200 && r.status < 300) jiraKey = r.body.key; else jiraError = r.body?.message || r.body?.error || `status ${r.status}`;
    }
  }
  const jiraUrl = jiraKey ? `${String(cfg.jiraBaseUrl).replace(/\/$/, '')}/browse/${jiraKey}` : '';
  const icon = { Bug: ':beetle:', Issue: ':warning:', 'New Requirement': ':bulb:' }[e.category] || ':envelope:';
  const urgent = e.priority === 'Critical' && !isFollowUp ? '<!channel> ' : '';
  const slackText = [isFollowUp ? `:speech_balloon: *Customer follow-up* on ${jiraKey} - ${e.category} / ${e.priority}` : `${urgent}${icon} *New customer ${e.category}* - *${e.priority}* priority`,
    `*${e.title}*`, `>${String(e.summary || '').replace(/\n/g, '\n>')}`, `*Customer:* ${e.customerName || e.fromName} <${e.fromEmail}>${e.customerCompany ? ' (' + e.customerCompany + ')' : ''}`,
    `*Area:* ${e.productArea || 'General'} | *Sentiment:* ${e.sentiment}`, jiraKey ? `*Jira:* <${jiraUrl}|${jiraKey}>` : `:x: *Jira not created:* ${(jiraError || 'Jira issue not created').slice(0, 300)}`,
    e.link ? `<${e.link}|Open email>` : `_via ${e.source}_`].join('\n');
  const slack = api.slack.postMessage({ channel: route.slackChannel, text: slackText });
  const slackSent = slack.status === 200 && slack.body?.ok === true;
  let teamsSent = false;
  if (cfg.teamsWebhookUrl) {
    const card = { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [{ type: 'TextBlock', size: 'Medium', weight: 'Bolder', wrap: true, text: isFollowUp ? `Customer follow-up on ${jiraKey}` : `New customer ${e.category} - ${e.priority}` },
        { type: 'TextBlock', wrap: true, weight: 'Bolder', text: e.title }, { type: 'TextBlock', wrap: true, text: e.summary || '' },
        { type: 'FactSet', facts: [{ title: 'Customer', value: `${e.customerName || e.fromName} <${e.fromEmail}>` }, { title: 'Area', value: e.productArea || 'General' }, { title: 'Jira', value: jiraKey || 'not created' }] }],
      actions: jiraUrl ? [{ type: 'Action.OpenUrl', title: 'Open in Jira', url: jiraUrl }] : [] } }] };
    api.teams.post({ url: cfg.teamsWebhookUrl, body: card });
    teamsSent = true;
  }
  return { ...e, jiraKey, jiraUrl, jiraError, isFollowUp, assignedTo: route.owner, slackChannel: route.slackChannel, slackSent, teamsSent,
    escalationStatus: !jiraKey ? 'Escalation failed - check Jira' : (isFollowUp ? 'Follow-up added to ' + jiraKey : 'Escalated') };
}

export function acknowledge(e, api, cfg) {
  const mode = String(cfg.ackMode || 'off').toLowerCase();
  let skip = '';
  if (!['draft', 'send'].includes(mode)) skip = 'Acknowledgement disabled';
  else if (e.isFollowUp) skip = 'Follow-up on existing ticket';
  else if (!e.jiraKey) skip = 'No ticket created';
  else if (!e.messageId) skip = 'No message ID';
  if (skip) return { ...e, ackStatus: 'Skipped: ' + skip };
  const RESPONSE_TIME = { Critical: '2 business hours', High: '1 business day', Medium: '2 business days', Low: '3 business days' };
  const first = String(e.customerName || e.fromName || '').trim().split(/\s+/)[0] || 'there';
  const what = { Bug: 'bug report', Issue: 'support request', 'New Requirement': 'feature request' }[e.category] || 'request';
  const company = cfg.companyName || 'our team';
  const text = [`Hi ${first},`, '', `Thank you for contacting ${company}. We have received your ${what} (reference: ${e.jiraKey}) and passed it to the right team.`,
    `You can expect an update within ${RESPONSE_TIME[e.priority] || '2 business days'}. Just reply to this email if you have anything to add.`, '', 'Kind regards,', `${company} ${cfg.ackSignature || ''}`.trim()].join('\n');
  let r;
  if (e.source === 'Outlook') r = api.outlook.reply({ messageId: e.messageId, comment: text.split('\n').map(l => `<p style="margin:0">${l || '&nbsp;'}</p>`).join(''), saveAsDraft: mode === 'draft', replyToSenderOnly: true });
  else if (mode === 'send') r = api.gmail.reply({ messageId: e.messageId, text, replyToSenderOnly: true });
  else r = api.gmail.createDraft({ to: e.fromEmail, subject: e.subject.startsWith('Re:') ? e.subject : 'Re: ' + e.subject, text, threadId: e.threadId });
  const okCall = r.status >= 200 && r.status < 300;
  return { ...e, ackStatus: !okCall ? 'Failed: ' + (r.body?.message || r.status) : (mode === 'draft' ? 'Draft created' : 'Sent') };
}

export function review(e, api, cfg) {
  const reason = e.needsReview ? 'AI classification failed' : `Low confidence (${Math.round((e.confidence || 0) * 100)}% < ${Math.round((cfg.minConfidence || 0) * 100)}%)`;
  const text = [`:mag: *Email needs manual triage* - ${reason}`, `*AI guess:* ${e.category} / ${e.priority}${e.productArea ? ' / ' + e.productArea : ''}`, `*From:* ${e.fromName || ''} <${e.fromEmail}>  |  *Subject:* ${e.subject}`,
    e.summary ? `>${String(e.summary).replace(/\n/g, '\n>')}` : '', e.reasoning ? `_Why:_ ${e.reasoning}` : '', e.link ? `<${e.link}|Open email>` : `_Source: ${e.source}_`].filter(Boolean).join('\n');
  const r = api.slack.postMessage({ channel: String(cfg.reviewSlackChannel || 'triage-review').replace('#', ''), text });
  return { ...e, reviewReason: reason, reviewAlertSent: r.status === 200 && r.body?.ok === true, escalationStatus: 'Sent to review (' + reason + ')' };
}

export function auditRow(e, at) {
  return {
    'Logged At': at, 'Received At': e.receivedAt || '', Source: e.source || '', 'From Name': e.fromName || '', 'From Email': e.fromEmail || '', 'Customer Company': e.customerCompany || '', Subject: e.subject || '',
    'Customer Request': e.isCustomerRequest ? 'Yes' : 'No', Category: e.category || '', Priority: e.priority || '', Confidence: e.confidence ?? '', 'Product Area': e.productArea || '', Sentiment: e.sentiment || '',
    'Ticket Title': e.title || '', Summary: e.summary || '', 'Routed To': e.assignedTo || '', 'Jira Key': e.jiraKey || '', 'Jira URL': e.jiraUrl || '', 'Follow-up': e.isFollowUp ? 'Yes' : '',
    'Slack Sent': e.slackSent ? 'Yes' : '', 'Customer Ack': e.ackStatus || '', Status: e.escalationStatus || (e.isCustomerRequest ? 'Not escalated' : 'Ignored - not a customer request'),
    Notes: e.skipReason || e.reasoning || e.jiraError || '', 'Classified By': e.classifiedBy || '', 'Email Link': e.link || '', 'Message ID': e.messageId || '',
  };
}

// The whole faithful flow for one mail.
export function makeFaithful(cfg, opts = {}) {
  return function handle(event, api) {
    const p = prepare(normalize(event), cfg);
    let c = p.skipAI ? skipped(p) : classify(p, api, opts);
    const route = routeOf(c, cfg);
    if (route === 'escalate') c = acknowledge(escalate(c, api, cfg), api, cfg);
    else if (route === 'review') c = review(c, api, cfg);
    api.sheets.appendRow({ row: auditRow(c, event.at) });
  };
}
