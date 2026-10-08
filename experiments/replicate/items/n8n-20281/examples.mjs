// The worked examples shown to T2 solvers: 10 mails of a different (fictional) customer base, each with the classifier's answer and what the automation did with it.
// The outcomes come from running the faithful reference on the example mailbox in its own mock world (separate seeds, recordings and ticket numbers), so
// they are the behaviour of the original, not a statement of the oracle. Example mails are never part of a scored stream.
import { World } from './mocks/world.mjs';
import { readJson, CONFIG_PRESETS } from './spec.mjs';
import { makeFaithful } from './controls/reference.mjs';

export const EXAMPLE_CONFIG = () => ({ ...CONFIG_PRESETS().base, ackMode: 'send', teamsWebhookUrl: '' });

export function buildExamples() {
  const fx = readJson('./fixtures/example-mails.json');
  const rec = readJson('./fixtures/model-recordings.json');
  const cfg = EXAMPLE_CONFIG();
  const entries = fx.mails.map((m, i) => {
    const mail = structuredClone(m.mail);
    const at = new Date(Date.UTC(2026, 9, 7, 8, 0, 0) + i * 600_000).toISOString();
    if (m.provider === 'gmail') mail.date = at; else mail.receivedDateTime = at;
    return { ...m, mail, at };
  });
  const world = new World({ config: cfg, entries, recordings: rec, seeds: fx.seeds, nextIssueNumber: 960 });
  const handler = makeFaithful(cfg);
  const out = [];
  for (const [i, e] of entries.entries()) {
    const calls = [];
    const api = {};
    for (const name of ['gmail.reply', 'gmail.createDraft', 'outlook.reply', 'jira.search', 'jira.createIssue', 'jira.addComment', 'jira.getIssue', 'slack.postMessage', 'teams.post', 'sheets.appendRow', 'sheets.appendRows', 'state.get', 'state.put', 'model.complete']) {
      const [svc, op] = name.split('.');
      (api[svc] ??= {})[op] = args => { const r = world.call(name, args); calls.push({ name, args, response: r.response, effects: r.meta.effects }); return r.response; };
    }
    handler({ seq: i, trigger: e.provider === 'gmail' ? 'gmail-new-email' : 'outlook-new-email', at: e.at, data: e.mail }, api);
    const jira = world.jira.dump();
    const effects = calls.flatMap(c => c.effects);
    const created = effects.find(x => x.type === 'jira.create');
    const model = calls.find(c => c.name === 'model.complete' && c.response.status === 200)?.response.body.content ?? null;
    const row = world.sheets.state.rows.at(-1);
    out.push({
      n: i + 1, trigger: e.provider === 'gmail' ? 'gmail-new-email' : 'outlook-new-email', mail: e.mail,
      outcome: {
        modelCalls: calls.filter(c => c.name === 'model.complete').length,
        modelAnswer: model && { isCustomerRequest: model.isCustomerRequest, category: model.category, priority: model.priority, confidence: model.confidence, productArea: model.productArea, title: model.title },
        jira: created ? { created: (({ key, fields }) => ({ key, issuetype: fields.issuetype.name, priority: fields.priority?.name, labels: fields.labels, summary: fields.summary }))(jira.find(j => j.key === created.key)) }
          : effects.some(x => x.type === 'jira.comment') ? { commentedOn: effects.find(x => x.type === 'jira.comment').key } : null,
        slack: effects.filter(x => x.type === 'slack').map(x => ({ channel: x.channel, text: x.text })),
        teams: effects.filter(x => x.type === 'teams').length,
        reply: effects.filter(x => x.type.startsWith('mail.')).map(x => ({ kind: x.type === 'mail.send' ? 'sent' : 'draft', through: x.provider, to: x.to, text: x.text })),
        auditRow: { ...row, 'Logged At': '(time of processing)', 'Received At': e.at },
      },
    });
  }
  return { config: cfg, seededTickets: fx.seeds.map(s => ({ key: `${cfg.jiraProjectKey}-${s.n}`, summary: s.summary, status: s.status, note: 'open before the examples start; belongs to the thread of the example named in outcome.jira.commentedOn' })), examples: out };
}
