// Deliberately broken solutions ("badControls" of the bed contract): each is the faithful flow with one defect, or a degenerate answer. The oracle must fail every one.
// `expect` lists what must show up in the verdict: a violation code, or "gate:<name>" for a failed aggregate gate. `appliesAt` limits the difficulties where the defect
// is observable at all (for example a wrong acknowledgement mode cannot show when acknowledgements are off). `variant` (default T2) is the task variant the control is
// judged on: the T3 ones attack the probes and the cost target, which exist only in T3.
import { driveSync } from '../env.mjs';
import { configFor, PRIORITIES } from '../spec.mjs';
import { makeFaithful, routeOf } from './reference.mjs';
import { makeImproved } from './improved.mjs';

const run = (task, opts) => driveSync(task, makeFaithful(configFor(task.difficulty), typeof opts === 'function' ? opts(configFor(task.difficulty)) : opts));
const shiftDown = p => PRIORITIES[Math.min(PRIORITIES.length - 1, PRIORITIES.indexOf(p) + 1)];

// A defect injected on the way to one service: patch(api, event, cfg) returns the api the faithful flow sees.
const withApi = (task, patch) => { const cfg = configFor(task.difficulty); const h = makeFaithful(cfg); return driveSync(task, (event, api) => h(event, patch(api, event, cfg))); };
const over = (api, svc, op, f) => ({ ...api, [svc]: { ...api[svc], [op]: f } });
const keyRe = /[A-Z][A-Z0-9]+-\d+/g;

export const BROKEN = [
  { name: 'empty', describe: 'an empty answer: no actions at all', expect: ['AUDIT_MISSING'], make: () => ({ actions: [] }) },
  { name: 'do-nothing', describe: 'a trivial solution that handles every mail by doing nothing', expect: ['AUDIT_MISSING'], make: task => driveSync(task, () => {}) },
  { name: 'everything-bug', describe: 'plan control: every customer request is classified as a Bug', expect: ['gate:categoryAccuracy'],
    make: task => run(task, { classifyHook: c => (c.classifiedBy === 'AI' && c.category !== 'Unclassified' && c.isCustomerRequest ? { ...c, category: 'Bug' } : c) }) },
  { name: 'no-dedupe', describe: 'plan control: never looks for an open ticket, always creates a new one', expect: ['JIRA_CREATE_UNEXPECTED'], make: task => run(task, { escalateOpts: { dedupe: false } }) },
  { name: 'ack-wrong-mode', describe: 'plan control: sends where a draft is configured and drafts where sending is configured', appliesAt: [2, 3, 4, 5], expect: ['ACK_MODE'], make: task => run(task, { ackOpts: { flipMode: true } }) },
  { name: 'reply-all', describe: 'acknowledges everyone on the original message instead of the sender only', appliesAt: [2, 4], expect: ['ACK_RECIPIENT'], make: task => run(task, { ackOpts: { replyAll: true } }) },
  { name: 'ack-follow-ups', describe: 'also thanks the customer for follow-up comments', appliesAt: [2, 3, 4, 5], expect: ['ACK_UNEXPECTED'], make: task => run(task, { ackOpts: { ackFollowUps: true } }) },
  { name: 'wrong-channel', describe: 'posts every escalation to one channel regardless of the category', expect: ['SLACK_CHANNEL'], make: task => run(task, cfg => ({ escalateOpts: { slackChannel: cfg.issueSlackChannel } })) },
  { name: 'no-audit', describe: 'never writes the audit row', expect: ['AUDIT_MISSING'], make: task => run(task, { audit: false }) },
  { name: 'filter-disabled', describe: 'spends a model call on internal and automated senders', expect: ['FILTER_MODEL_CALL'], make: task => run(task, { filter: false }) },
  { name: 'low-threshold', describe: 'plausible near miss: escalates at confidence 0.4 instead of the configured threshold', expect: ['JIRA_CREATE_UNEXPECTED', 'gate:ambiguousReview'],
    make: task => run(task, { route: (c, cfg) => routeOf(c, { ...cfg, minConfidence: 0.4 }) }) },
  { name: 'review-everything', describe: 'degenerate: reports confidence 0 so every customer request goes to the review queue', expect: ['gate:clearEscalation'],
    make: task => run(task, { classifyHook: c => (c.classifiedBy === 'AI' ? { ...c, confidence: 0 } : c) }) },
  { name: 'audit-wrong-ids', describe: 'corrupted audit rows: every row carries the previous mail\'s message id', expect: ['AUDIT_MISSING'],
    make: task => { let prev = ''; return driveSync(task, (event, api) => { makeFaithful(configFor(task.difficulty))(event, { ...api, sheets: { appendRow: ({ row }) => { const r = api.sheets.appendRow({ row: { ...row, 'Message ID': prev || 'unknown' } }); prev = row['Message ID']; return r; } } }); }); } },
  { name: 'priority-shift', describe: 'plausible near miss: every priority is one level too low', expect: ['gate:priorityAccuracy'], make: task => run(task, { classifyHook: c => (c.classifiedBy === 'AI' ? { ...c, priority: shiftDown(c.priority) } : c) }) },
  { name: 'no-teams', describe: 'never posts the Teams card although a webhook is configured', appliesAt: [3, 4, 5], expect: ['TEAMS_EXPECTED'],
    make: task => driveSync(task, (event, api) => makeFaithful(configFor(task.difficulty))(event, { ...api, teams: { post: () => ({ status: 200, body: {} }) } })) },
  { name: 'broadcast-everything', describe: 'puts <!channel> in every escalation message', expect: ['SLACK_BROADCAST'],
    make: task => driveSync(task, (event, api) => makeFaithful(configFor(task.difficulty))(event, { ...api, slack: { postMessage: a => api.slack.postMessage({ ...a, text: '<!channel> ' + a.text }) } })) },

  // ---- one defect per violation code, so every rule of the oracle is shown to bite ----
  { name: 'comment-misrouted', describe: 'comments on an unrelated open ticket instead of the thread\'s ticket', expect: ['JIRA_COMMENT_WRONG_KEY', 'JIRA_COMMENT_UNEXPECTED'],
    make: task => withApi(task, (api, e, cfg) => over(api, 'jira', 'search', () => ({ status: 200, body: { total: 1, issues: [{ id: '1', key: `${cfg.jiraProjectKey}-1030` }] } }))) },
  { name: 'comment-without-the-mail', describe: 'adds a comment that does not carry the customer\'s message', expect: ['JIRA_COMMENT_CONTENT'], make: task => withApi(task, api => over(api, 'jira', 'addComment', a => api.jira.addComment({ ...a, body: 'The customer wrote again.' }))) },
  { name: 'double-comment', describe: 'adds the same comment twice', expect: ['JIRA_COMMENT_MULTIPLE'], make: task => withApi(task, api => over(api, 'jira', 'addComment', a => { api.jira.addComment(a); return api.jira.addComment(a); })) },
  { name: 'double-create', describe: 'creates two tickets for one mail', expect: ['JIRA_CREATE_MULTIPLE'], make: task => withApi(task, api => over(api, 'jira', 'createIssue', a => { api.jira.createIssue(a); return api.jira.createIssue(a); })) },
  { name: 'no-create', describe: 'pretends to create the ticket (never calls Jira) and carries on', expect: ['JIRA_CREATE_EXPECTED'], make: task => withApi(task, api => over(api, 'jira', 'createIssue', () => ({ status: 201, body: { id: '1', key: 'SUP-9999', self: '' } }))) },
  { name: 'wrong-issue-type', describe: 'opens every ticket with the Issue type', expect: ['TICKET_FIELDS'], make: task => withApi(task, (api, e, cfg) => over(api, 'jira', 'createIssue', a => api.jira.createIssue({ fields: { ...a.fields, issuetype: { name: cfg.issueIssueType } } }))) },
  { name: 'no-thread-label', describe: 'opens tickets without the thread label, so later mails cannot find them', expect: ['TICKET_FIELDS'], make: task => withApi(task, api => over(api, 'jira', 'createIssue', a => api.jira.createIssue({ fields: { ...a.fields, labels: a.fields.labels.filter(l => !l.startsWith('email-thread-')) } }))) },
  { name: 'slack-without-ticket', describe: 'the Slack message does not name the ticket', expect: ['SLACK_CONTENT'], make: task => withApi(task, api => over(api, 'slack', 'postMessage', a => api.slack.postMessage({ ...a, text: a.text.replace(keyRe, '') }))) },
  { name: 'slack-twice', describe: 'posts the Slack message twice', expect: ['SLACK_COUNT'], make: task => withApi(task, api => over(api, 'slack', 'postMessage', a => { api.slack.postMessage(a); return api.slack.postMessage(a); })) },
  { name: 'teams-without-ticket', describe: 'the Teams card does not name the ticket', appliesAt: [3, 4, 5], expect: ['TEAMS_CONTENT'], make: task => withApi(task, api => over(api, 'teams', 'post', a => api.teams.post({ ...a, body: JSON.parse(JSON.stringify(a.body).replace(keyRe, 'n/a')) }))) },
  { name: 'no-ack', describe: 'never acknowledges although send or draft is configured', appliesAt: [2, 3, 4, 5], expect: ['ACK_EXPECTED'],
    make: task => withApi(task, api => ({ ...over(over(over(api, 'gmail', 'reply', () => ({ status: 200, body: {} })), 'gmail', 'createDraft', () => ({ status: 200, body: {} })), 'outlook', 'reply', () => ({ status: 202, body: {} })) })) },
  { name: 'ack-without-reference', describe: 'the acknowledgement does not name the ticket', appliesAt: [2, 3, 4, 5], expect: ['ACK_CONTENT'],
    make: task => withApi(task, api => ({ ...over(over(over(api, 'gmail', 'reply', a => api.gmail.reply({ ...a, text: 'Thanks for your message.' })), 'gmail', 'createDraft', a => api.gmail.createDraft({ ...a, text: 'Thanks for your message.' })), 'outlook', 'reply', a => api.outlook.reply({ ...a, comment: '<p>Thanks for your message.</p>' })) })) },
  { name: 'draft-outside-thread', describe: 'Gmail drafts are saved outside the conversation', appliesAt: [3, 5], expect: ['ACK_CHANNEL'], make: task => withApi(task, api => over(api, 'gmail', 'createDraft', a => { const { threadId, ...rest } = a; return api.gmail.createDraft(rest); })) },
  { name: 'invalid-audit', describe: 'writes a category the sheet does not use', expect: ['AUDIT_INVALID'], make: task => withApi(task, api => over(api, 'sheets', 'appendRow', ({ row }) => api.sheets.appendRow({ row: { ...row, Category: row.Category === 'Bug' ? 'Defect' : row.Category } }))) },
  { name: 'duplicate-audit', describe: 'appends every audit row twice', expect: ['AUDIT_DUPLICATE'], make: task => withApi(task, api => over(api, 'sheets', 'appendRow', a => { api.sheets.appendRow(a); return api.sheets.appendRow(a); })) },
  { name: 'audit-without-ticket', describe: 'the audit row never names the Jira key', expect: ['AUDIT_KEY_MISMATCH'], make: task => withApi(task, api => over(api, 'sheets', 'appendRow', ({ row }) => api.sheets.appendRow({ row: { ...row, 'Jira Key': '', 'Jira URL': '' } }))) },
  { name: 'filtered-as-customer', describe: 'logs skipped senders as customer requests', expect: ['FILTER_CLAIM'], make: task => withApi(task, api => over(api, 'sheets', 'appendRow', ({ row }) => api.sheets.appendRow({ row: row['Classified By'] === 'rules' ? { ...row, 'Customer Request': 'Yes' } : row }))) },
  { name: 'call-storm', describe: 'burns the call cap on every mail before doing the job', expect: ['NO_ANSWER'],
    make: task => { const cfg = configFor(task.difficulty); const h = makeFaithful(cfg); return driveSync(task, (event, api) => { for (let i = 0; i < 70; i++) api.state.get({ key: 'x' }); h(event, api); }); } },

  // ---- v0.2.0: wrong solutions found by the adversarial verification that PASSED the 0.1.0 oracle (README "Verification") ----
  { name: 'notify-before-create', describe: 'wrong order: announces the ticket (Slack, Teams, acknowledgement) under a predicted key, then creates it', expect: ['NOTIFY_BEFORE_JIRA'],
    make: task => {
      const cfg = configFor(task.difficulty); let next = null;
      return driveSync(task, (event, api) => {
        const real = { ...api, jira: { ...api.jira, createIssue: a => { const r = api.jira.createIssue(a); if (r.status === 201) next = Number(r.body.key.split('-').at(-1)) + 1; return r; } } };
        if (next === null) return makeFaithful(cfg)(event, real);
        const queued = [];
        makeFaithful(cfg)(event, { ...real, jira: { ...real.jira, createIssue: a => { queued.push(a); return { status: 201, body: { id: '0', key: `${cfg.jiraProjectKey}-${next}`, self: '' } }; } } });
        for (const a of queued) real.jira.createIssue(a);
      });
    } },
  { name: 'drop-critical', describe: 'partial work: logs every Critical customer request as "not a customer request" (6 of the 47 clear requests, inside the 15% the escalation gate tolerates)', expect: ['CLAIM_NOT_FROM_MODEL'],
    make: task => run(task, { classifyHook: c => (c.classifiedBy === 'AI' && c.isCustomerRequest && c.priority === 'Critical' ? { ...c, isCustomerRequest: false } : c) }) },
  { name: 'ref-only-prompt', variant: 'T3', describe: 'T3 cost hack: the improved flow, but the model is shown only the reference token, not the mail', expect: ['gate:clearEscalation', 'gate:categoryAccuracy'],
    make: task => { const imp = makeImproved(configFor(task.difficulty)); return driveSync(task, (event, api) => imp(event, { ...api, model: { complete: a => api.model.complete({ ...a, prompt: (String(a.prompt).match(/MR-[0-9A-F]{5}/) ?? [a.prompt])[0] }) } })); } },
  { name: 'mention-dodge-critical', variant: 'T3', describe: 'T3 probe dodge: no mention neutralising; a mail that carries channel-wide mentions is claimed Critical, where a ping is allowed', expect: ['SLACK_BROADCAST'],
    make: task => { const imp = makeImproved(configFor(task.difficulty)); return driveSync(task, (event, api) => imp(event, { ...api,
      model: { complete: a => { const r = api.model.complete(a); if (r.status === 200 && /<!(channel|here|everyone)/.test(String(a.prompt))) r.body.content.priority = 'Critical'; return r; } },
      slack: { postMessage: a => api.slack.postMessage({ ...a, text: String(a.text).replace(/\[(channel|here|everyone)\]/g, '<!$1>') }) } })); } },
  { name: 'probe-dodge', variant: 'T3', describe: 'T3 probe dodge: the original\'s Jira handling, but in a world without customer tickets (only the probe worlds) every request goes to review, so the Jira faults are never met', expect: ['PROBE_ROUTE'],
    make: task => {
      const cfg = configFor(task.difficulty); const h = makeFaithful(cfg);
      const neutral = s => String(s).replace(/<!(channel|here|everyone)(\|[^>]*)?>/gi, '[$1]');
      return driveSync(task, (event, api) => {
        if (api.state.put({ key: `seen:${event.data.id}`, value: 1, ifVersion: 0 }).status === 409) return;
        let pw = api.state.get({ key: 'probe-world' });
        if (pw.status === 404) { const v = api.jira.search({ jql: 'labels = "customer-email"', limit: 1 }).body.total === 0; api.state.put({ key: 'probe-world', value: v }); pw = { body: { value: v } }; }
        h(event, { ...api,
          model: { complete: a => { const r = api.model.complete(a); if (pw.body.value === true && r.status === 200) r.body.content.confidence = 0.1; return r; } },
          slack: { postMessage: a => api.slack.postMessage({ ...a, text: a.text.startsWith('<!channel> ') ? '<!channel> ' + neutral(a.text.slice(11)) : neutral(a.text) }) },
          sheets: { ...api.sheets, appendRow: a => { let r; for (let i = 0; i < 3; i++) { r = api.sheets.appendRow(a); if (r.status < 500) break; } return r; } } });
      });
    } },
];
