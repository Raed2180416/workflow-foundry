// INVENTORY node of arm A1-C (harness/codeowned.mjs): code, no model. Reads the world through the bridge mailbox the
// agent uses (bridge-client.mjs), in a few batched world steps, and returns a structured inventory with a source pointer
// for every record. Nothing is searched by a model-chosen query.
//
//   L0  one batch: the top-level list endpoint(s) of every app the environment ships (the enumeration plan below);
//       an app that answers 401 ("no account is connected") is out of scope and never called again.
//   L1  children of non-empty lists (message bodies, spreadsheet tabs, channel histories, calendar events, ...).
//   L2  grandchildren (worksheet values, thread replies, table records, ...).
//   L3  entity look-ups: one term per call for each entity the trigger names, on the apps whose enumeration was cut by a
//       cap or that can only be searched; spreadsheets opened by a title the request or a record names.
//   then precedents: the k most recent existing records of each kind the request asks to create or change (sent emails,
//       channel posts, sheet rows, CRM tasks, notes, cases, tickets, invoices, ...), selected by code from L0-L2, which
//       enumerate every such kind (no extra step).
// Every level is optional and the whole inventory stops at a step budget (default 16 of the 49 world steps).
//
// The enumeration plan (ENUM_PLAN) is architect-written from the API schemas shipped with the environment (the index
// api_search searches) and the URL routing the environment documents for api_fetch; it is identical for every task and
// names no task, entity or value. Declared in codeowned.mjs KNOWLEDGE (H8).
import { fetchCall, parseResult, resultStatus, toolCall } from './bridge-client.mjs';

const G = (url, params = null) => fetchCall('GET', url, { params });
const P = (url, body) => fetchCall('POST', url, { body });
const enc = encodeURIComponent;
const SF = 'https://yourinstance.salesforce.com/services/data/v61.0';
const SF_OBJECTS = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'CaseComment', 'Task', 'Event', 'Campaign', 'CampaignMember', 'Note', 'User', 'Document', 'Folder', 'Attachment'];
const XERO = 'https://api.xero.com/api.xro/2.0';
const XERO_LISTS = ['Invoices', 'Contacts', 'Accounts', 'Items', 'Payments', 'CreditNotes', 'PurchaseOrders', 'Quotes', 'BankTransactions', 'BankTransfers', 'Employees', 'Organisation'];
const QBO = 'https://quickbooks.api.intuit.com/v3/company/1';
const QBO_ENTITIES = ['Customer', 'Vendor', 'Invoice', 'Bill', 'Payment', 'Item', 'Account', 'Estimate', 'Employee', 'Purchase', 'JournalEntry', 'CreditMemo', 'SalesReceipt', 'PurchaseOrder'];
const BHR = 'https://api.bamboohr.com/api/gateway.php/company/v1';
const RCT = 'https://api.recruitee.com/c/company';
const WAVE = 'https://gql.waveapps.com/graphql/public';
const DS = 'https://demo.docusign.net/restapi/v2.1/accounts/me';

/**
 * The enumeration plan: per app, L0 calls ({kind, call}); expand(kind, json, ctx) -> child calls for the next level.
 * `probe` marks apps with no list endpoint (write targets): one GET that tells connected from not connected.
 * Kinds name record types; a record pointer is `${app}:${kind}:${id}`.
 */
export const ENUM_PLAN = Object.freeze([
  { app: 'gmail', l0: [{ kind: 'message_list', call: G('https://gmail.googleapis.com/gmail/v1/users/me/messages', { maxResults: 500 }) },
    { kind: 'draft_list', call: G('https://gmail.googleapis.com/gmail/v1/users/me/drafts', { maxResults: 100 }) }],
  expand: (kind, j, cap) => kind === 'message_list' ? (j.messages ?? []).slice(0, cap.messages).map(m => ({ kind: 'message', call: G(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${enc(m.id)}`) }))
    : kind === 'draft_list' ? (j.drafts ?? []).slice(0, 30).map(d => ({ kind: 'draft', call: G(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${enc(d.id)}`) })) : [],
  truncated: (kind, j, cap) => kind === 'message_list' && (j.messages ?? []).length > cap.messages },
  { app: 'google_drive', l0: [{ kind: 'file_list', call: G('https://www.googleapis.com/drive/v3/files', { pageSize: 1000 }) }],
    expand: (kind, j) => {
      if (kind === 'file_list') return (j.files ?? []).flatMap(f => (/spreadsheet/.test(f.mimeType ?? '') ? [{ app: 'google_sheets', kind: 'spreadsheet', call: G(`https://sheets.googleapis.com/v4/spreadsheets/${enc(f.id)}`) }]
        : /folder/.test(f.mimeType ?? '') ? [] : [{ kind: 'file', call: G(`https://www.googleapis.com/drive/v3/files/${enc(f.id)}`) }])).slice(0, 60);
      return [];
    } },
  // Spreadsheets are listed through Drive; their tabs and values are expanded under google_sheets.
  { app: 'google_sheets', l0: [], expand: (kind, j) => {
    if (kind === 'spreadsheet' && j.spreadsheetId) {
      const titles = (j.sheets ?? []).map(s => s.properties?.title).filter(Boolean);
      return titles.length ? [{ kind: 'values', call: G(`https://sheets.googleapis.com/v4/spreadsheets/${enc(j.spreadsheetId)}/values:batchGet`, { ranges: titles }), meta: { spreadsheetId: j.spreadsheetId, title: j.properties?.title ?? null } }] : [];
    }
    return [];
  } },
  { app: 'google_calendar', l0: [{ kind: 'calendar_list', call: G('https://www.googleapis.com/calendar/v3/users/me/calendarList') },
    { kind: 'event_list', call: G('https://www.googleapis.com/calendar/v3/calendars/primary/events', { maxResults: 250 }) }],
  expand: (kind, j) => kind === 'calendar_list' ? (j.items ?? []).filter(c => c.id && c.id !== 'primary' && !c.primary).slice(0, 20).map(c => ({ kind: 'event_list', call: G(`https://www.googleapis.com/calendar/v3/calendars/${enc(c.id)}/events`, { maxResults: 250 }) })) : [] },
  { app: 'slack', l0: [{ kind: 'channel_list', call: G('https://slack.com/api/conversations.list', { types: 'public_channel,private_channel,mpim,im', limit: 1000 }) },
    { kind: 'user_list', call: G('https://slack.com/api/users.list', { limit: 1000 }) }],
  expand: (kind, j) => {
    if (kind === 'channel_list') return (j.channels ?? []).slice(0, 40).map(c => ({ kind: 'history', call: G('https://slack.com/api/conversations.history', { channel: c.id, limit: 1000 }), meta: { channel: c.id, name: c.name ?? null } }));
    if (kind === 'history') return (j.messages ?? []).filter(m => (m.reply_count ?? 0) > 0 && m.ts).slice(0, 20).map(m => ({ kind: 'replies', call: G('https://slack.com/api/conversations.replies', { channel: j.__channel, ts: m.ts }), meta: { channel: j.__channel } }));
    return [];
  } },
  { app: 'salesforce', l0: SF_OBJECTS.map(o => ({ kind: o, call: G(`${SF}/query`, { q: `SELECT FIELDS(ALL) FROM ${o} LIMIT 200` }) })), expand: () => [],
    truncated: (kind, j) => (j.totalSize ?? 0) > (j.records ?? []).length },
  { app: 'hubspot', l0: ['contacts', 'companies', 'deals', 'tickets'].map(o => ({ kind: o, call: G(`https://api.hubapi.com/crm/v3/objects/${o}`, { limit: 100 }) })), expand: () => [] },
  { app: 'zendesk', l0: ['tickets', 'users', 'organizations', 'groups'].map(o => ({ kind: o, call: G(`https://yoursubdomain.zendesk.com/api/v2/${o}`) })),
    expand: (kind, j) => kind === 'tickets' ? (j.tickets ?? []).slice(0, 60).map(t => ({ kind: 'comments', call: G(`https://yoursubdomain.zendesk.com/api/v2/tickets/${enc(t.id)}/comments`), meta: { ticket: t.id } })) : [] },
  { app: 'freshdesk', l0: ['tickets', 'contacts', 'companies'].map(o => ({ kind: o, call: G(`https://yoursubdomain.freshdesk.com/api/v2/${o}`) })),
    expand: (kind, j) => kind === 'tickets' ? (Array.isArray(j) ? j : j.tickets ?? []).slice(0, 60).map(t => ({ kind: 'conversations', call: G(`https://yoursubdomain.freshdesk.com/api/v2/tickets/${enc(t.id)}/conversations`), meta: { ticket: t.id } })) : [] },
  { app: 'intercom', l0: ['contacts', 'companies', 'conversations'].map(o => ({ kind: o, call: G(`https://api.intercom.io/${o}`) })), expand: () => [] },
  { app: 'helpscout', l0: ['mailboxes', 'customers', 'conversations', 'users'].map(o => ({ kind: o, call: G(`https://api.helpscout.net/v2/${o}`) })), expand: () => [] },
  { app: 'hiver', l0: [{ kind: 'inboxes', call: G('https://api2.hiverhq.com/v1/inboxes') }],
    expand: (kind, j) => kind === 'inboxes' ? listOf(j).slice(0, 20).flatMap(b => [{ kind: 'conversations', call: G(`https://api2.hiverhq.com/v1/inboxes/${enc(b.id)}/conversations`), meta: { inbox: b.id } }, { kind: 'users', call: G(`https://api2.hiverhq.com/v1/inboxes/${enc(b.id)}/users`), meta: { inbox: b.id } }]) : [] },
  { app: 'zoho_desk', l0: ['tickets', 'contacts', 'accounts'].map(o => ({ kind: o, call: G(`https://desk.zoho.com/api/v1/${o}`) })), expand: () => [] },
  { app: 'reamaze', l0: ['conversations', 'contacts'].map(o => ({ kind: o, call: G(`https://company.reamaze.io/api/v1/${o}`) })), expand: () => [] },
  { app: 'gorgias', l0: [{ kind: 'tickets', call: G('https://company.gorgias.com/api/tickets') }], expand: () => [] },
  { app: 'helpcrunch', l0: [{ kind: 'customers', call: G('https://api.helpcrunch.com/v1/customers') }], expand: () => [] },
  { app: 'calendly', l0: [{ kind: 'scheduled_events', call: G('https://api.calendly.com/scheduled_events', { count: 100 }) }, { kind: 'event_types', call: G('https://api.calendly.com/event_types') }, { kind: 'users', call: G('https://api.calendly.com/users') }],
    expand: (kind, j) => kind === 'scheduled_events' ? listOf(j).slice(0, 40).map(e => idOf(e)).filter(Boolean).map(id => ({ kind: 'invitees', call: G(`https://api.calendly.com/scheduled_events/${enc(String(id).split('/').pop())}/invitees`), meta: { event: id } })) : [] },
  { app: 'zoom', l0: [{ kind: 'meetings', call: G('https://api.zoom.us/v2/users/me/meetings', { page_size: 300 }) }, { kind: 'recordings', call: G('https://api.zoom.us/v2/users/me/recordings') }],
    expand: (kind, j) => kind === 'meetings' ? listOf(j).slice(0, 30).flatMap(m => [{ kind: 'registrants', call: G(`https://api.zoom.us/v2/meetings/${enc(m.id)}/registrants`), meta: { meeting: m.id } }]) : [] },
  { app: 'docusign', l0: [{ kind: 'envelopes', call: G(`${DS}/envelopes`) }, { kind: 'templates', call: G(`${DS}/templates`) }, { kind: 'workspaces', call: G(`${DS}/workspaces`) }],
    expand: (kind, j) => kind === 'envelopes' ? listOf(j).slice(0, 30).map(e => ({ kind: 'recipients', call: G(`${DS}/envelopes/${enc(e.envelopeId ?? e.id)}/recipients`), meta: { envelope: e.envelopeId ?? e.id } })) : [] },
  { app: 'trello', l0: [{ kind: 'boards', call: G('https://api.trello.com/1/members/me/boards') }],
    expand: (kind, j) => kind === 'boards' ? listOf(j).slice(0, 20).flatMap(b => [{ kind: 'lists', call: G(`https://api.trello.com/1/boards/${enc(b.id)}/lists`), meta: { board: b.id } }, { kind: 'cards', call: G(`https://api.trello.com/1/boards/${enc(b.id)}/cards`), meta: { board: b.id } }]) : [] },
  { app: 'airtable', l0: [{ kind: 'bases', call: G('https://api.airtable.com/v0/meta/bases') }],
    expand: (kind, j, _cap, meta) => kind === 'bases' ? listOf(j).slice(0, 10).map(b => ({ kind: 'tables', call: G(`https://api.airtable.com/v0/meta/bases/${enc(b.id)}/tables`), meta: { base: b.id } }))
      : kind === 'tables' ? listOf(j).slice(0, 20).map(t => ({ kind: 'records', call: G(`https://api.airtable.com/v0/${enc(meta?.base ?? '')}/${enc(t.id ?? t.name)}`), meta: { base: meta?.base, table: t.name ?? t.id } })) : [] },
  { app: 'mailchimp', l0: [{ kind: 'lists', call: G('https://us1.api.mailchimp.com/3.0/lists') }],
    expand: (kind, j) => kind === 'lists' ? listOf(j).slice(0, 10).map(l => ({ kind: 'members', call: G(`https://us1.api.mailchimp.com/3.0/lists/${enc(l.id)}/members`, { count: 1000 }), meta: { list: l.id } })) : [] },
  { app: 'jira', l0: [{ kind: 'projects', call: G('https://company.atlassian.net/rest/api/3/project/search') }], expand: () => [] },
  { app: 'linkedin', l0: ['me', 'connections', 'organizations', 'jobs'].map(o => ({ kind: o, call: G(`https://api.linkedin.com/v2/${o}`) })), expand: () => [] },
  { app: 'twitter', l0: [{ kind: 'me', call: G('https://api.twitter.com/2/users/me') }], expand: () => [] },
  { app: 'buffer', l0: [{ kind: 'profiles', call: G('https://api.bufferapp.com/1/profiles.json') }],
    expand: (kind, j) => kind === 'profiles' ? listOf(j).slice(0, 10).map(p => ({ kind: 'sent_updates', call: G(`https://api.bufferapp.com/1/profiles/${enc(p.id)}/updates/sent.json`), meta: { profile: p.id } })) : [] },
  { app: 'canva', l0: [{ kind: 'designs', call: G('https://api.canva.com/rest/v1/designs') }], expand: () => [] },
  { app: 'facebook_pages', l0: [{ kind: 'accounts', call: G('https://graph.facebook.com/v25.0/me/accounts') }],
    expand: (kind, j) => kind === 'accounts' ? listOf(j).slice(0, 10).map(p => ({ kind: 'feed', call: G(`https://graph.facebook.com/v25.0/${enc(p.id)}/feed`), meta: { page: p.id } })) : [] },
  { app: 'xero', l0: XERO_LISTS.map(o => ({ kind: o, call: G(`${XERO}/${o}`) })), expand: () => [] },
  { app: 'quickbooks', l0: QBO_ENTITIES.map(o => ({ kind: o, call: G(`${QBO}/query`, { query: `SELECT * FROM ${o} MAXRESULTS 1000` }) })), expand: () => [] },
  { app: 'wave', l0: [{ kind: 'businesses', call: P(WAVE, { query: 'query { businesses { edges { node { id name } } } }' }) }],
    expand: (kind, j) => {
      if (kind !== 'businesses') return [];
      const ids = JSON.stringify(j).match(/"id"\s*:\s*"([^"]+)"/g)?.map(s => s.replace(/.*:\s*"|"$/g, '')).slice(0, 3) ?? [];
      return ids.flatMap(id => ['customers', 'invoices', 'products'].map(k => ({ kind: k, call: P(WAVE, { query: `query ($businessId: ID!) { business(id: $businessId) { ${k} { edges { node { id } } } } }`, variables: { businessId: id } }), meta: { business: id } })));
    } },
  { app: 'bamboohr', l0: [['directory', 'employees/directory'], ['time_off_requests', 'time_off/requests'], ['whos_out', 'time_off/whos_out'], ['time_off_policies', 'meta/time_off/policies'], ['time_off_types', 'meta/time_off/types'],
    ['applications', 'applicant_tracking/applications'], ['jobs', 'applicant_tracking/jobs'], ['benefit_plans', 'benefitplans'], ['training_types', 'training/type'], ['employees', 'employees']].map(([k, p]) => ({ kind: k, call: G(`${BHR}/${p}`) })), expand: () => [] },
  { app: 'recruitee', l0: ['offers', 'candidates', 'interview/events', 'departments', 'locations'].map(o => ({ kind: o.replace('/', '_'), call: G(`${RCT}/${o}`) })), expand: () => [] },
  // Apps the environment serves with no list endpoint (write targets): one probe tells connected from not connected.
  ...[['asana', 'https://app.asana.com/api/1.0/projects/probe/sections'], ['monday', 'https://api.monday.com/v2/items/probe'], ['notion', 'https://api.notion.com/v1/pages/probe'],
    ['confluence', 'https://company.atlassian.net/wiki/api/v2/pages/probe'], ['pipefy', 'https://api.pipefy.com/graphql/tables/probe/records:find'], ['google_ads', 'https://googleads.googleapis.com/v19/customers/probe/campaigns/probe'],
    ['instagram', 'https://graph.facebook.com/v25.0/probe'], ['facebook_lead_ads', 'https://graph.facebook.com/v25.0/probe/leads'], ['twilio', 'https://api.twilio.com/2010-04-01/Accounts/probe/Messages.json'],
    ['chatgpt', 'https://api.openai.com/v1/models'], ['basecamp3', 'https://3.basecampapi.com/probe/projects.json'], ['linkedin_ads', 'https://api.linkedin.com/rest/adAccounts'],
    ['linkedin_conversions', 'https://api.linkedin.com/rest/conversionEvents'], ['facebook_conversions', 'https://graph.facebook.com/v17.0/probe/events']]
    .map(([app, url]) => ({ app, probe: true, l0: [{ kind: 'probe', call: G(url) }], expand: () => [] })),
]);

export const DEFAULT_CAPS = Object.freeze({ messages: 150, callsPerStep: 220, recordChars: 6000, terms: 10 });

// ---------------------------------------------------------------------------------------------------------------
// Record extraction (generic over response shapes)

const ID_KEYS = ['id', 'Id', 'ID', 'gid', 'uuid', 'uri', 'envelopeId', 'InvoiceID', 'ContactID', 'AccountID', 'ItemID', 'PaymentID', 'CreditNoteID', 'PurchaseOrderID', 'QuoteID', 'BankTransactionID', 'BankTransferID', 'EmployeeID', 'OrganisationID', 'ts', 'key', 'email', 'Name', 'name'];
export const idOf = o => { for (const k of ID_KEYS) if (o && (typeof o[k] === 'string' || typeof o[k] === 'number') && String(o[k]).length) return String(o[k]); return null; };
const DATE_KEYS = ['date', 'Date', 'created_at', 'createdAt', 'CreatedDate', 'created', 'created_time', 'createdTime', 'updated_at', 'LastModifiedDate', 'modifiedTime', 'start_time', 'start', 'start_date', 'due_date', 'DueDate', 'ActivityDate', 'CloseDate', 'internal_date', 'sent_at', 'timestamp'];
const msIso = v => (typeof v === 'number' && v > 1e11 && v < 1e14 ? new Date(v).toISOString() : null);
export function dateOf(o) {
  for (const k of DATE_KEYS) {
    let v = o?.[k];
    if (v && typeof v === 'object') v = v.dateTime ?? v.date ?? null;
    if (msIso(v)) return msIso(v);
    if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v)) return v;
  }
  if (typeof o?.ts === 'string' && /^\d{9,10}(\.\d+)?$/.test(o.ts)) return new Date(Number(o.ts) * 1000).toISOString();
  return null;
}
/** The arrays of objects in a response (depth <= 3), largest first; a bare object with an id is itself a record. */
export function listOf(j) {
  if (Array.isArray(j)) return j.filter(x => x && typeof x === 'object');
  const found = [];
  const walk = (v, d) => {
    if (!v || typeof v !== 'object' || d > 3) return;
    for (const x of Object.values(v)) {
      if (Array.isArray(x) && x.length && x.every(e => e && typeof e === 'object' && !Array.isArray(e))) found.push(x);
      else if (x && typeof x === 'object' && !Array.isArray(x)) walk(x, d + 1);
    }
  };
  walk(j, 0);
  if (!found.length) return [];
  found.sort((a, b) => b.length - a.length);
  // GraphQL edges: unwrap node.
  return found[0].map(e => (e.node && typeof e.node === 'object' ? e.node : e));
}

/** Drop empty and noisy fields; cap long strings (the full value stays in the raw response). */
export function compactRecord(o, maxChars = DEFAULT_CAPS.recordChars) {
  const DROP = new Set(['body_html', 'size_estimate', 'internal_date', 'attachment_ids', 'has_attachments', 'is_starred', 'kind', 'etag', 'iconLink', 'thumbnailLink', 'attributes']);
  const clean = v => {
    if (Array.isArray(v)) { const a = v.map(clean).filter(x => x !== undefined); return a.length ? a : undefined; }
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) { if (DROP.has(k)) continue; const c = clean(x); if (c !== undefined) out[k] = c; }
      return Object.keys(out).length ? out : undefined;
    }
    if (v === null || v === '' || v === false) return undefined;
    return v;
  };
  const c = clean(o) ?? {};
  if (typeof c.body_plain === 'string' && typeof c.snippet === 'string' && c.body_plain.includes(c.snippet.slice(0, 40))) delete c.snippet;
  let s = JSON.stringify(c);
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…(truncated)';
  return s;
}

/** Plain text of a record: every string/number value, one per line (what verbatim quotes are matched against). */
export function recordText(o) {
  const out = [];
  const walk = (v, k) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(x => walk(x, k));
    if (typeof v === 'object') return Object.entries(v).forEach(([kk, x]) => walk(x, kk));
    out.push(String(v));
  };
  walk(o, null);
  return out.join('\n');
}

function recordsFromResponse(app, kind, j, meta = null) {
  if (j === null || j === undefined) return [];
  if (app === 'google_sheets' && kind === 'values') {
    const out = [];
    for (const vr of j.valueRanges ?? []) {
      const [header, ...rows] = vr.values ?? [];
      const tab = String(vr.range ?? '').replace(/!.*$/, '').replace(/^'|'$/g, '');
      rows.forEach((r, i) => {
        const data = Object.fromEntries((header ?? []).map((h, c) => [h, r[c] ?? '']));
        out.push({ kind: 'row', id: `${j.spreadsheetId}/${tab}#${i + 2}`, data: { spreadsheet: meta?.title ?? j.spreadsheetId, spreadsheetId: j.spreadsheetId, worksheet: tab, row: i + 2, ...data } });
      });
      if (!rows.length) out.push({ kind: 'worksheet', id: `${j.spreadsheetId}/${tab}`, data: { spreadsheet: meta?.title ?? j.spreadsheetId, spreadsheetId: j.spreadsheetId, worksheet: tab, header: header ?? [], rows: 0 } });
    }
    return out;
  }
  if ((app === 'gmail' && (kind === 'message' || kind === 'draft')) || (app === 'google_sheets' && kind === 'spreadsheet') || (app === 'google_drive' && kind === 'file')) {
    const id = idOf(j) ?? j.spreadsheetId ?? null;
    return id ? [{ kind, id, data: j }] : [];
  }
  const items = listOf(j);
  const extra = meta ? Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== null && v !== undefined)) : {};
  if (!items.length) {
    if (kind === 'me' || kind === 'Organisation' || kind === 'organisation') return Object.keys(j).length ? [{ kind, id: idOf(j) ?? kind, data: j }] : [];
    return [];
  }
  return items.map((o, i) => ({ kind: kind === 'history' || kind === 'replies' ? 'message' : kind, id: kind === 'history' || kind === 'replies' ? `${meta?.channel ?? ''}/${o.ts ?? i}` : idOf(o) ?? `${kind}#${i}`, data: { ...extra, ...o } }));
}

// ---------------------------------------------------------------------------------------------------------------
// Entities named in the trigger (code, no model)

const STOP = new Set(['The', 'This', 'That', 'These', 'Those', 'Please', 'We', 'Our', 'You', 'Your', 'I', 'If', 'When', 'Then', 'Also', 'Make', 'Send', 'Post', 'Use', 'For', 'And', 'Or', 'To', 'In', 'On', 'At', 'Of', 'A', 'An', 'Each', 'All', 'Any', 'No', 'Do', 'Not', 'It', 'Hi', 'Hello', 'Thanks', 'Note', 'After', 'Before', 'From', 'With']);
/** Entity terms from the trigger: email addresses, ids, quoted strings, dates, capitalized names (one term per search). */
export function entityTerms(text, max = DEFAULT_CAPS.terms) {
  const t = String(text ?? '');
  const out = [];
  const add = s => { const v = String(s).trim().replace(/[.,;:]+$/, ''); if (v.length >= 3 && v.length <= 80 && !out.some(x => x.toLowerCase() === v.toLowerCase())) out.push(v); };
  for (const m of t.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) add(m[0]);
  for (const m of t.matchAll(/\b(?=[A-Z0-9_-]*\d)[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+\b|\b[A-Z]{2,}\d+\b|\b\d{3,}[-/]\d+[\w-]*\b/g)) if (!/^\d{4}-\d{2}-\d{2}$/.test(m[0])) add(m[0]);
  for (const m of t.matchAll(/["“']([^"”'\n]{3,60})["”']/g)) add(m[1]);
  for (const m of t.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add(m[0]);
  for (const m of t.matchAll(/\b(?:[A-Z][a-zA-Z&'-]+)(?:\s+(?:[A-Z][a-zA-Z&'-]+|of|and|&)){1,4}/g)) {
    const words = m[0].split(/\s+/).filter(w => !STOP.has(w));
    if (words.length >= 2 || (words.length === 1 && words[0].length >= 4 && m[0] === words[0])) add(words.join(' '));
  }
  return out.slice(0, max);
}

/** Names of spreadsheets/trackers a text refers to ("the X sheet", "X spreadsheet", quoted names). */
export function sheetTitleCandidates(text) {
  const t = String(text ?? '');
  const out = new Set();
  for (const m of t.matchAll(/["“']([^"”'\n]{3,60})["”']\s*(?:spread)?sheet/gi)) out.add(m[1].trim());
  for (const m of t.matchAll(/\b((?:[A-Z][\w&-]*\s){0,4}[A-Z][\w&-]*)\s+(?:spreadsheet|sheet|tracker|log|roster|register)\b/g)) out.add(m[1].trim());
  return [...out].filter(s => s.length >= 3).slice(0, 8);
}

// ---------------------------------------------------------------------------------------------------------------
// Precedents: the kinds of record the request asks to create or change, and existing ones of each kind.

export const TARGET_KINDS = Object.freeze([
  { re: /\b(e-?mail|send|reply|notify|inform|message)\b/i, app: 'gmail', kinds: ['message'], sent: true },
  { re: /\b(slack|post|channel|announce)\b/i, app: 'slack', kinds: ['message'] },
  { re: /\b(row|sheet|spreadsheet|log|tracker|record in)\b/i, app: 'google_sheets', kinds: ['row'] },
  { re: /\btask\b/i, app: 'salesforce', kinds: ['Task'] },
  { re: /\b(case|escalat)/i, app: 'salesforce', kinds: ['Case', 'CaseComment'] },
  { re: /\bnote\b/i, app: 'salesforce', kinds: ['Note'] },
  { re: /\b(opportunit|deal)/i, app: 'salesforce', kinds: ['Opportunity'] },
  { re: /\b(lead)\b/i, app: 'salesforce', kinds: ['Lead'] },
  { re: /\b(contact)\b/i, app: 'salesforce', kinds: ['Contact'] },
  { re: /\b(event|meeting|calendar|schedule|invite)\b/i, app: 'google_calendar', kinds: ['event_list'] },
  { re: /\b(ticket)\b/i, app: '*', kinds: ['tickets', 'conversations'] },
  { re: /\b(invoice|bill)\b/i, app: '*', kinds: ['Invoices', 'Invoice', 'Bill', 'invoices'] },
  { re: /\b(card|board)\b/i, app: 'trello', kinds: ['cards'] },
]);

/** k most recent existing records per target kind the request names (from the inventory; no world step). */
export function precedents(inv, request, k = 3) {
  const out = [];
  for (const t of TARGET_KINDS) {
    if (!t.re.test(request)) continue;
    const recs = inv.records.filter(r => (t.app === '*' || r.app === t.app) && t.kinds.includes(r.kind) && (!t.sent || /SENT/.test(JSON.stringify(r.data.label_ids ?? r.data.labelIds ?? ''))));
    const sorted = [...recs].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    for (const r of sorted.slice(0, k)) if (!out.some(p => p.ptr === r.ptr)) out.push({ ptr: r.ptr, app: r.app, kind: r.kind, reason: `existing ${r.app} ${r.kind} (the request may create or change one)` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The inventory node

/**
 * buildInventory({ request, client, maxSteps, caps, node }) -> inventory.
 * request: the official user message (the only task text code reads). client: bridge-client.mjs. maxSteps: the world-step
 * budget of this node. Returns { apps, records, outOfScope, connected, truncated, entities, entityIndex, precedents,
 * steps, calls, errors }.
 */
export async function buildInventory({ request, client, maxSteps = 16, caps = DEFAULT_CAPS, node = 'inventory', log = () => {}, only = null } = {}) {
  const inv = { apps: {}, records: [], outOfScope: [], connected: [], truncated: [], entities: [], entityIndex: {}, precedents: [], steps: 0, calls: 0, errors: [], titleProbes: [] };
  const plan = new Map(ENUM_PLAN.map(p => [p.app, p]));
  const appState = app => (inv.apps[app] ??= { status: 'unknown', kinds: {}, records: 0 });
  const INDEX_KINDS = new Set(['gmail:message_list', 'gmail:draft_list']);
  const addRecords = (app, kind, j, url, meta) => {
    if (INDEX_KINDS.has(`${app}:${kind}`)) return;
    for (const r of recordsFromResponse(app, kind, j, meta)) {
      if (app === 'google_drive' && /spreadsheet/.test(String(r.data?.mimeType ?? ''))) continue; // listed again as a spreadsheet
      // Epoch-millisecond dates are shown as ISO beside the raw value (records carry their own dates; the host's is not the task's).
      if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) for (const k of ['date', 'internal_date', 'created_at', 'timestamp']) { const iso = msIso(r.data[k]); if (iso && !r.data[`${k}_iso`]) r.data[`${k}_iso`] = iso; }
      const ptr = `${app}:${r.kind}:${r.id}`;
      if (inv.records.some(x => x.ptr === ptr)) continue;
      inv.records.push({ ptr, app, kind: r.kind, id: r.id, url, date: dateOf(r.data), data: r.data });
      appState(app).records += 1;
    }
  };
  const run = async (items) => {
    // items: [{app, kind, call, meta}] -> runs them in as few steps as the per-step cap allows; returns [{...item, status, json}]
    const out = [];
    for (let i = 0; i < items.length; i += caps.callsPerStep) {
      if (inv.steps >= maxSteps) { inv.errors.push(`step budget ${maxSteps} reached: ${items.length - i} call(s) not issued`); break; }
      const chunk = items.slice(i, i + caps.callsPerStep);
      const r = await client.batch(chunk.map(c => c.call), { node });
      if (r.error) { inv.errors.push(`step refused: ${String(r.error).slice(0, 200)}`); break; }
      inv.steps += 1;
      inv.calls += chunk.length;
      r.results.forEach((res, k) => { const it = chunk[k]; out.push({ ...it, status: resultStatus(res.content), json: parseResult(res.content), raw: res.content }); });
    }
    return out;
  };
  const urlOf = c => { try { return JSON.parse(c.arguments).url; } catch { return null; } };
  const absorb = (results) => {
    const next = [];
    for (const x of results) {
      const st = appState(x.app);
      if (x.status === 401) { st.status = 'not_connected'; continue; }
      if (st.status !== 'connected') st.status = 'connected';
      const ok = x.status === 200 && x.json !== null;
      st.kinds[x.kind] = (st.kinds[x.kind] ?? 0) + (ok ? 1 : 0);
      if (!ok) { if (!x.probe) inv.errors.push(`${x.app} ${x.kind}: ${x.status}`); continue; }
      const json = x.json;
      if (x.kind === 'history' && x.meta?.channel) json.__channel = x.meta.channel;
      if (!x.probe) addRecords(x.app, x.kind, json, urlOf(x.call), x.meta);
      const p = plan.get(x.app);
      if (p?.truncated?.(x.kind, json, caps)) inv.truncated.push(`${x.app}:${x.kind}`);
      for (const c of p?.expand?.(x.kind, json, caps, x.meta) ?? []) next.push({ ...c, app: c.app ?? x.app });
      delete json.__channel;
    }
    return next;
  };

  // L0
  // `only` (a re-read for the checks): the listed apps' enumeration, no probes, look-ups or precedents.
  let items = ENUM_PLAN.filter(p => !only || (only.includes(p.app) && !p.probe)).flatMap(p => p.l0.map(c => ({ app: p.app, probe: Boolean(p.probe), ...c })));
  let level = 0;
  while (items.length && level < 4 && inv.steps < maxSteps) {
    const res = await run(items);
    items = absorb(res);
    level += 1;
    log(`[inventory] level ${level - 1}: ${res.length} calls, ${inv.records.length} records`);
  }
  for (const [app, st] of Object.entries(inv.apps)) {
    if (st.status === 'not_connected') inv.outOfScope.push(app); else if (st.status === 'connected') inv.connected.push(app);
  }
  inv.outOfScope.sort(); inv.connected.sort();
  // Sheets with no Drive listing: inherit the status of google_drive (they are served together); probe if unknown.
  if (!inv.apps.google_sheets && inv.apps.google_drive) inv.apps.google_sheets = { status: inv.apps.google_drive.status, kinds: {}, records: 0 };

  if (only) return inv;
  // L3: entity look-ups and spreadsheets by title.
  inv.entities = entityTerms(request, caps.terms);
  const lookups = [];
  if (inv.connected.includes('gmail') && inv.truncated.some(t => t.startsWith('gmail:'))) for (const term of inv.entities) lookups.push({ app: 'gmail', kind: 'message_list', call: G('https://gmail.googleapis.com/gmail/v1/users/me/messages', { q: term, maxResults: 50 }), term });
  if (inv.connected.includes('twitter')) for (const term of inv.entities.slice(0, 5)) lookups.push({ app: 'twitter', kind: 'tweets', call: G('https://api.twitter.com/2/tweets/search/recent', { query: term }), term });
  if (inv.connected.includes('linkedin')) for (const term of inv.entities.slice(0, 5)) lookups.push({ app: 'linkedin', kind: 'people', call: G('https://api.linkedin.com/v2/people', { keywords: term }), term });
  if (inv.apps.google_sheets?.status !== 'not_connected' && (inv.connected.includes('google_drive') || inv.connected.includes('google_sheets') || !inv.apps.google_drive)) {
    const known = new Set(inv.records.filter(r => r.app === 'google_sheets' && r.kind === 'spreadsheet').map(r => String(r.data.properties?.title ?? '').toLowerCase()));
    const texts = [request, ...inv.records.filter(r => r.app === 'gmail' || r.app === 'slack').map(r => recordText(r.data))].join('\n');
    for (const title of sheetTitleCandidates(texts)) if (!known.has(title.toLowerCase())) { inv.titleProbes.push(title); lookups.push({ app: 'google_sheets', kind: 'spreadsheet', call: G(`https://sheets.googleapis.com/v4/spreadsheets/${enc(title)}`), term: title }); }
  }
  if (lookups.length && inv.steps < maxSteps) {
    const res = await run(lookups);
    const more = [];
    for (const x of res) {
      if (x.status !== 200 || !x.json) continue;
      if (x.app === 'gmail') { for (const m of (x.json.messages ?? []).slice(0, 20)) if (!inv.records.some(r => r.ptr === `gmail:message:${m.id}`)) more.push({ app: 'gmail', kind: 'message', call: G(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${enc(m.id)}`) }); }
      else if (x.app === 'google_sheets') { if (x.json.spreadsheetId) more.push(...absorb([x])); }
      else addRecords(x.app, x.kind, x.json, urlOf(x.call), { term: x.term });
    }
    if (more.length && inv.steps < maxSteps) { const r2 = await run(more); const r3 = absorb(r2); if (r3.length && inv.steps < maxSteps) absorb(await run(r3)); }
  }
  // Entity index: which records mention each term (local search over everything read; no world step).
  for (const term of inv.entities) {
    const needle = term.toLowerCase();
    inv.entityIndex[term] = inv.records.filter(r => recordText(r.data).toLowerCase().includes(needle)).map(r => r.ptr).slice(0, 25);
  }
  inv.precedents = precedents(inv, request);
  inv.latestRecordDate = inv.records.map(r => r.date).filter(Boolean).sort().at(-1) ?? null;
  return inv;
}

/** The inventory as prompt text: connected apps, out-of-scope apps, then every record as `[ptr] {compact json}`, grouped by
 * app and kind, newest first within a kind. `order` (a seed) shuffles the app order for independent ledger readers. */
export function renderInventory(inv, { maxChars = 150_000, order = null } = {}) {
  const lines = [`Connected apps: ${inv.connected.join(', ') || '(none)'}`, `Not connected (no account; out of scope): ${inv.outOfScope.join(', ') || '(none)'}`];
  if (inv.truncated.length) lines.push(`Listings cut by a cap: ${inv.truncated.join(', ')}`);
  const groups = new Map();
  for (const r of inv.records) { const k = `${r.app} / ${r.kind}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  let keys = [...groups.keys()];
  if (order !== null) { let s = Number(order) + 1; keys = keys.map(k => [k, (s = (s * 9301 + 49297) % 233280) / 233280]).sort((a, b) => a[1] - b[1]).map(x => x[0]); }
  let used = lines.join('\n').length;
  let cut = 0;
  for (const k of keys) {
    const recs = groups.get(k).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    const head = `\n## ${k} (${recs.length})`;
    lines.push(head); used += head.length + 1;
    for (const r of recs) {
      const l = `[${r.ptr}] ${compactRecord(r.data)}`;
      if (used + l.length + 1 > maxChars) { cut += 1; continue; }
      lines.push(l); used += l.length + 1;
    }
  }
  if (cut) lines.push(`\n(${cut} record(s) left out of this listing for size; they are in INVENTORY.json)`);
  return lines.join('\n');
}

export const _internal = { recordsFromResponse };
