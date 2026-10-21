// INVENTORY node of arm A1-C v2 (harness/v2/codeowned.mjs): copy-on-change of harness/inventory.mjs. Everything not
// listed here is v1's, imported unchanged.
//   - buildInventory returns clock {t0, t1} (host epoch ms at start and end of the node).
//   - dateOf skips a value v with t0 - 12 h <= v <= t1 + 5 min when the date note is on (M5: a load-time stamp the
//     environment wrote when the world was loaded is not the task's business date). A test on the VALUE, never on the
//     field name; date-only values (no time of day) are never load stamps.
//   - ride-along 5: calendar lists read `items`, then `calendars`, then any list.
//   - ride-along 6: sheet cells beyond the header are kept as col_<n> (1-based column number).
//   - ride-along 8: a second pass for single capitalized tokens (>= 4 characters, not sentence-initial, not stop words);
//     the cap stays at 10 terms.
import { ENUM_PLAN as ENUM_PLAN_V1, DEFAULT_CAPS, idOf, listOf, compactRecord, recordText, sheetTitleCandidates, precedents, renderInventory, entityTerms as entityTermsV1, _internal } from '../inventory.mjs';
import { fetchCall, parseResult, resultStatus } from '../bridge-client.mjs';
import { isMachineValue } from './literals.mjs';

export { DEFAULT_CAPS, idOf, listOf, compactRecord, recordText, sheetTitleCandidates, precedents, renderInventory };

const G = (url, params = null) => fetchCall('GET', url, { params });
const enc = encodeURIComponent;

/** v1's plan with the calendar-list fix (ride-along 5); every other entry is v1's object. */
export const ENUM_PLAN = Object.freeze(ENUM_PLAN_V1.map(p => (p.app !== 'google_calendar' ? p : {
  ...p,
  expand: (kind, j) => kind === 'calendar_list' ? (j.items ?? j.calendars ?? listOf(j)).filter(c => c && c.id && c.id !== 'primary' && !c.primary).slice(0, 20)
    .map(c => ({ kind: 'event_list', call: G(`https://www.googleapis.com/calendar/v3/calendars/${enc(c.id)}/events`, { maxResults: 250 }) })) : [],
})));

// ---------------------------------------------------------------------------------------------------------------
// Dates: business dates only when the date note is on

const DATE_KEYS = ['date', 'Date', 'created_at', 'createdAt', 'CreatedDate', 'created', 'created_time', 'createdTime', 'updated_at', 'LastModifiedDate', 'modifiedTime', 'start_time', 'start', 'start_date', 'due_date', 'DueDate', 'ActivityDate', 'CloseDate', 'internal_date', 'sent_at', 'timestamp'];
const msIso = v => (typeof v === 'number' && v > 1e11 && v < 1e14 ? new Date(v).toISOString() : null);
export const LOAD_STAMP_AFTER_MS = 5 * 60_000;
/** Epoch ms of a value that carries a time of day (ISO datetime, epoch s or ms, a Slack ts), else null. */
export function instantOf(v) {
  if (typeof v === 'number') return v > 1e11 && v < 1e14 ? v : v > 1e8 && v < 1e11 ? v * 1000 : null;
  const s = String(v ?? '').trim();
  if (!isMachineValue(s) && !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/^\d{9,10}\.\d+$/.test(s)) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return instantOf(Number(s));
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}
/** A load stamp: a value with a time of day inside [t0 - window, t1 + 5 min] of the host clock at inventory time. */
export function isLoadStamp(v, clock, windowMs = 43_200_000) {
  if (!clock || !Number.isFinite(clock.t0)) return false;
  const t = instantOf(v);
  return t !== null && t >= clock.t0 - windowMs && t <= (clock.t1 ?? clock.t0) + LOAD_STAMP_AFTER_MS;
}
/** v1's dateOf; with `stamp` (date note on) a load-stamp value is skipped and the next date key is tried. */
export function dateOf(o, { stamp = null } = {}) {
  const skip = v => Boolean(stamp && stamp(v));
  for (const k of DATE_KEYS) {
    let v = o?.[k];
    if (v && typeof v === 'object') v = v.dateTime ?? v.date ?? null;
    if (skip(v)) continue;
    if (msIso(v)) return msIso(v);
    if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v)) return v;
  }
  if (typeof o?.ts === 'string' && /^\d{9,10}(\.\d+)?$/.test(o.ts) && !skip(o.ts)) return new Date(Number(o.ts) * 1000).toISOString();
  return null;
}
/** Plain text of a record without its load-stamp values (and their ISO copies): what "today" and "shown" are checked on. */
export function businessText(o, stamp = null) {
  if (!stamp) return recordText(o);
  const out = [];
  const walk = v => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === 'object') return Object.values(v).forEach(walk);
    if (stamp(v)) return;
    out.push(String(v));
  };
  walk(o);
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Records from responses (v1's, with col_<n> for cells beyond the header)

function recordsFromResponse(app, kind, j, meta = null) {
  if (app === 'google_sheets' && kind === 'values' && j) {
    const out = [];
    for (const vr of j.valueRanges ?? []) {
      const [header, ...rows] = vr.values ?? [];
      const tab = String(vr.range ?? '').replace(/!.*$/, '').replace(/^'|'$/g, '');
      const tabId = String(meta?.sheetIds?.[tab] ?? tab).replace(/\s+/g, '_');
      rows.forEach((r, i) => {
        const data = Object.fromEntries((header ?? []).map((h, c) => [h, r[c] ?? '']));
        for (let c = (header ?? []).length; c < (r ?? []).length; c++) if (r[c] !== undefined && r[c] !== '') data[`col_${c + 1}`] = r[c];
        out.push({ kind: 'row', id: `${j.spreadsheetId}/${tabId}#${i + 2}`, data: { spreadsheet: meta?.title ?? j.spreadsheetId, spreadsheetId: j.spreadsheetId, worksheet: tab, row: i + 2, ...data } });
      });
      if (!rows.length) out.push({ kind: 'worksheet', id: `${j.spreadsheetId}/${tabId}`, data: { spreadsheet: meta?.title ?? j.spreadsheetId, spreadsheetId: j.spreadsheetId, worksheet: tab, header: header ?? [], rows: 0 } });
    }
    return out;
  }
  return _internal.recordsFromResponse(app, kind, j, meta);
}

// ---------------------------------------------------------------------------------------------------------------
// Entity terms (ride-along 8)

const STOP = new Set(['The', 'This', 'That', 'These', 'Those', 'Please', 'We', 'Our', 'You', 'Your', 'I', 'If', 'When', 'Then', 'Also', 'Make', 'Send', 'Post', 'Use', 'For', 'And', 'Or', 'To', 'In', 'On', 'At', 'Of', 'A', 'An', 'Each', 'All', 'Any', 'No', 'Do', 'Not', 'It', 'Hi', 'Hello', 'Thanks', 'Note', 'After', 'Before', 'From', 'With']);
/** v1's terms, then single capitalized tokens (>= 4 characters, not sentence-initial, not stop words), capped at `max`. */
export function entityTerms(text, max = DEFAULT_CAPS.terms) {
  const t = String(text ?? '');
  const out = entityTermsV1(t, max);
  for (const m of t.matchAll(/\b[A-Z][a-zA-Z&'-]{3,}\b/g)) {
    if (out.length >= max) break;
    const before = t.slice(0, m.index);
    if (!before.trim() || /[.!?:]\s*$|\n\s*$/.test(before)) continue;   // sentence-initial (or line-initial)
    const w = m[0];
    if (STOP.has(w) || out.some(x => x.toLowerCase().includes(w.toLowerCase()))) continue;
    out.push(w);
  }
  return out.slice(0, max);
}

// ---------------------------------------------------------------------------------------------------------------
// The inventory node (v1's, with the clock, the v2 plan, records and terms, and business dates)

/**
 * buildInventory({ request, client, maxSteps, caps, node, only, dateNote, windowMs }) -> v1's inventory plus
 * clock {t0, t1}. With dateNote, record dates skip load stamps (after the node, once t1 is known).
 */
export async function buildInventory({ request, client, maxSteps = 16, caps = DEFAULT_CAPS, node = 'inventory', log = () => {}, only = null, dateNote = false, windowMs = 43_200_000, now = Date.now } = {}) {
  const inv = { apps: {}, records: [], outOfScope: [], connected: [], truncated: [], entities: [], entityIndex: {}, precedents: [], steps: 0, calls: 0, errors: [], titleProbes: [], clock: { t0: now(), t1: null } };
  const plan = new Map(ENUM_PLAN.map(p => [p.app, p]));
  const appState = app => (inv.apps[app] ??= { status: 'unknown', kinds: {}, records: 0 });
  const INDEX_KINDS = new Set(['gmail:message_list', 'gmail:draft_list']);
  const addRecords = (app, kind, j, url, meta) => {
    if (INDEX_KINDS.has(`${app}:${kind}`)) return;
    for (const r of recordsFromResponse(app, kind, j, meta)) {
      if (app === 'google_drive' && /spreadsheet/.test(String(r.data?.mimeType ?? ''))) continue;
      if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) for (const k of ['date', 'internal_date', 'created_at', 'timestamp']) { const iso = msIso(r.data[k]); if (iso && !r.data[`${k}_iso`]) r.data[`${k}_iso`] = iso; }
      const ptr = `${app}:${r.kind}:${String(r.id).replace(/\s+/g, '_')}`;
      if (inv.records.some(x => x.ptr === ptr)) continue;
      inv.records.push({ ptr, app, kind: r.kind, id: r.id, url, date: dateOf(r.data), data: r.data });
      appState(app).records += 1;
    }
  };
  const run = async items => {
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
  const absorb = results => {
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
  // After the node's last world step: the clock closes and, with the date note, record dates skip load stamps.
  const close = () => {
    inv.clock.t1 = now();
    if (dateNote) {
      const stamp = v => isLoadStamp(v, inv.clock, windowMs);
      for (const r of inv.records) r.date = dateOf(r.data, { stamp });
    }
  };
  const finish = () => { inv.latestRecordDate = inv.records.map(r => r.date).filter(Boolean).sort().at(-1) ?? null; return inv; };

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
  if (!inv.apps.google_sheets && inv.apps.google_drive) inv.apps.google_sheets = { status: inv.apps.google_drive.status, kinds: {}, records: 0 };

  if (only) { close(); return finish(); }
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
  close();
  for (const term of inv.entities) {
    const needle = term.toLowerCase();
    inv.entityIndex[term] = inv.records.filter(r => recordText(r.data).toLowerCase().includes(needle)).map(r => r.ptr).slice(0, 25);
  }
  inv.precedents = precedents(inv, request);
  return finish();
}

export const _internalV2 = { recordsFromResponse };
