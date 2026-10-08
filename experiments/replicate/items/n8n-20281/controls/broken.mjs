// Deliberately broken solutions ("badControls" of the bed contract): each is the faithful flow with one defect, or a degenerate answer. The oracle must fail every one.
// `expect` lists what must show up in the verdict: a violation code, or "gate:<name>" for a failed aggregate gate. `appliesAt` limits the difficulties where the defect
// is observable at all (for example a wrong acknowledgement mode cannot show when acknowledgements are off).
import { driveSync } from '../env.mjs';
import { configFor, PRIORITIES } from '../spec.mjs';
import { makeFaithful, routeOf } from './reference.mjs';

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
];
