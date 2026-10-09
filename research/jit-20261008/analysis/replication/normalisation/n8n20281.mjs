// Declared normalisations for n8n:20281. Frozen before scoring.
//   G: item-agnostic. Text normalisation only; the logs are untimed, so each mail's stream is a sequence; raw keys, raw texts.
//   I: "facts". The effects of this item carry model-authored text (titles, summaries, company, product area, confidence), which a
//      correct design legitimately words differently, so I compares FACTS of each effect instead of its text:
//        - ticket keys are canonicalised to the mail that created them (seeded tickets keep their key);
//        - jira.create: project, issue type, priority, label set (summary and description are model/mail text: opaque);
//        - jira.comment: target ticket, whether the comment names the sender;
//        - slack.post: channel, first line, the set of channel-wide mentions, ticket keys named, whether the sender is named;
//        - teams.post: webhook, ticket keys named;  mail: kind, provider, recipients, whether inside the mail's thread, ticket keys named;
//        - sheet.row: the audit columns that are classification or bookkeeping (model-authored columns are dropped);
//        - allowlisted deviation classes (approved improvements): the review message may name the sender without an address;
//          a channel-wide mention is allowed on the message about a Critical follow-up.
export const G = { name: 'G', timeTolerance: null, order: 'auto' };

const KEY = /\bSUP-\d+\b|\bnew#\w+/g;   // the item's Jira project key at difficulty 3 (declared; a mail may quote other ticket-like tokens, e.g. HP-2231)
const MODEL_COLUMNS = new Set(['Logged At', 'Received At', 'Confidence', 'Customer Company', 'Product Area', 'Sentiment', 'Ticket Title', 'Summary', 'Notes', 'Jira URL', 'Email Link']);
const keysIn = s => [...new Set(String(s ?? '').match(KEY) ?? [])].sort();

export const I = {
  name: 'I:n8n20281 (facts)', timeTolerance: null, order: 'auto',
  fieldRules: { to: 'set', cc: 'set', labels: 'set', keys: 'set', pings: 'set' },
  prepare(log) {
    const created = new Map();
    for (const e of log) if (e.type === 'jira.create' && e.key.issueKey && !created.has(e.key.issueKey)) created.set(e.key.issueKey, `new#${e.stream}`);
    const sub = s => (typeof s === 'string' ? s.replace(/\bSUP-\d+\b/g, k => created.get(k) ?? k) : s);
    const deep = v => (typeof v === 'string' ? sub(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
    return log.map(e => ({ ...e, key: deep(e.key) }));
  },
  keyMap(type, k, ev) {
    const m = ev.meta ?? {};
    switch (type) {
      case 'jira.create': return { project: k.project, issuetype: k.issuetype, priority: k.priority, labels: k.labels };
      case 'jira.comment': return { issueKey: k.issueKey, namesSender: String(k.body ?? '').includes(m.sender ?? '\u0000') };
      case 'slack.post': {
        const t = String(k.text ?? '');
        const head = t.split('\n')[0].replace(/^<!(here|channel)> /, '');
        let pings = t.match(/<!(?:channel|here|everyone)[^>]*>/g) ?? [];
        if (head.startsWith(':speech_balloon:')) pings = pings.filter(p => !/^<!(here|channel)>$/.test(p));        // allowlisted: ping on a Critical follow-up
        return { channel: k.channel, head: k.text && t.startsWith(':warning:') || t.includes('New customer') ? t.split('\n')[0] : head, pings, keys: keysIn(t), namesSender: t.includes(m.sender ?? '\u0000') || t.includes(m.name ?? '\u0000') };
      }
      case 'teams.post': return { url: k.url, keys: keysIn(k.text) };
      case 'mail': return { kind: k.kind, provider: k.provider, to: k.to, cc: k.cc, inThread: k.threadId === m.thread, keys: keysIn(k.text) };
      case 'sheet.row': return { row: Object.fromEntries(Object.entries(k.row ?? {}).filter(([c]) => !MODEL_COLUMNS.has(c)).map(([c, v]) => [c, typeof v === 'string' ? v.replace(/\bSUP-\d+\b/g, x => x) : v])) };
      default: return k;
    }
  },
};
