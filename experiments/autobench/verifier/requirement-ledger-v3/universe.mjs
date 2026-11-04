// requirement-ledger-v3 (Δ* v1): code-enumerated universes.
//
// A universe is one collection of the world, enumerated by CODE: the rows of one worksheet, the messages of one channel,
// the records of one app collection. Every member carries a stable identity (its pointer and an entity key), a flat
// attribute map (the SQL row), a label (the name a message would use for it), the label's mention forms and the e-mail
// addresses it holds. Readers never list members: they write predicates and SELECTs over these tables (sqlsafe.mjs), and
// code disposes every member (dstar.mjs). Two sources build the same shape:
//   - universesFromInventory(inventory): the A1-C pipeline's stored inventory.json (what an in-pipeline actor read);
//   - universesFromWorld(world): an initial world (what an independent verifier reads); `meta` is never read (it holds
//     the simulator's hidden clock and bookkeeping, which the clock ruling D28 keeps hidden).
// Generic by construction (PREREG-AB-v1 H7/H8): nothing here names a task, a grader check or a hidden assertion. Every
// string is untrusted data; nothing here executes or follows it.
import { emailsIn, indexWorld, isObj, norm } from './lib.mjs';

export const UNIVERSE_VERSION = 'rl3-universe-v1';

// Inventory kinds that describe containers or the workspace rather than members of a collection.
const CONTAINER_KINDS = new Set(['spreadsheet', 'worksheet', 'me', 'calendar_list']);
// Flattened attribute keys that carry no business meaning for a predicate.
const SKIP_ATTR = /^(spreadsheet|spreadsheetId|worksheet|row|uri|envelopeUri|certificateUri|documentsUri|recipientsUri|label_ids|attachment_ids|thread_id|internal_date|is_read|object|success|backgroundColor|background_color|formatting|overwrite|headers)$/;
const LABEL_PREF = /^(name|full_?name|display_?name|real_?name|title|subject|topic|summary|vendor|vendor_?name|customer|customer_?name|company|company_?name|client|account|account_?name|employee|employee_?name|candidate|contact|contact_?name|department|project|project_?name|platform|channel|product|item|keyword|query|campaign|team|requester|person|member|dealname|carrier|dock|location|site|program|course|event|event_?name)$/i;
const LABEL_SOFT = /(name|title|subject|vendor|customer|company|client|account|employee|candidate|department|project|platform|product|keyword|campaign|team|carrier)/i;
const ORG_SUFFIX = new Set(['inc', 'inc.', 'llc', 'ltd', 'ltd.', 'corp', 'corp.', 'co', 'co.', 'corporation', 'company', 'group', 'gmbh', 'plc', 'limited', 'holdings', 'solutions', 'consulting', 'freelance', 'partners', 'services', 'analytics', 'technologies', 'systems', 'labs', 'studio', 'shop', 'agency', 'enterprises', 'industries', 'international', 'global', 'supplies', 'supply', 'logistics', 'pro', 'media']);
// Common words that must never serve as a mention form on their own (a form is matched as a whole word).
const COMMON = new Set(['the', 'and', 'for', 'new', 'old', 'global', 'general', 'metro', 'central', 'national', 'united', 'first', 'prime', 'premier', 'summit', 'pacific', 'atlantic', 'north', 'south', 'east', 'west', 'blue', 'green', 'red', 'data', 'cloud', 'tech', 'digital', 'smart', 'total', 'team', 'office', 'support', 'sales', 'marketing', 'finance', 'operations', 'customer', 'service', 'product', 'project', 'account', 'contact', 'review', 'report', 'update', 'meeting', 'event', 'order', 'request', 'status', 'note', 'notes', 'open', 'closed', 'pending', 'active', 'test', 'feature', 'invoice', 'billing', 'general', 'urgent']);
const PERSON_KIND = /(contact|user|employee|candidate|people|person|customer|member|lead|recipient|invitee|registrant|staff|starter|hire|participant|attendee|signer|agent)/i;
const PERSON_COL = /(^|[^a-z])(name|employee|candidate|contact|person|starter|hire|rep|owner|manager|assignee|member|participant|attendee)([^a-z]|$)/i;
const NOT_PERSON_COL = /(company|vendor|account|business|organi[sz]ation|org|product|project|campaign|event|team|department|channel|platform|title|subject)/i;
const PERSON_LABEL = /^[A-Z][a-z'’.-]+( [A-Z][a-z'’.-]+){1,2}$/;

const str = v => (v === null || v === undefined ? '' : String(v));
const isDateText = s => /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(s);
const isNumText = s => /^[-−]?[$€£]?\s?\d{1,3}(,\d{3})*(\.\d+)?%?$|^[-−]?[$€£]?\s?\d+(\.\d+)?%?$/.test(s.trim());

/** Flatten a record into scalar attributes: nested objects become dotted keys (two levels), lists of scalars a comma list,
 *  lists of objects their JSON text (for mention search, not for predicates). */
export function flatAttrs(data, { skip = SKIP_ATTR } = {}) {
  const out = {};
  const put = (k, v) => { if (!(k in out)) out[k] = v; };
  const walk = (o, prefix, depth) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (skip.test(k)) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (v === null || v === undefined) put(key, null);
      else if (typeof v === 'boolean') put(key, v ? 'true' : 'false');
      else if (typeof v === 'number' || typeof v === 'bigint') put(key, Number(v));
      else if (typeof v === 'string') put(key, v);
      else if (Array.isArray(v)) put(key, v.every(x => x === null || typeof x !== 'object') ? v.map(str).join(', ') : JSON.stringify(v).slice(0, 4000));
      else if (isObj(v) && depth < 2) walk(v, key, depth + 1);
      else put(key, JSON.stringify(v).slice(0, 4000));
    }
  };
  walk(data, '', 0);
  return out;
}

/** The label column of a universe: a mostly unique, mostly filled, short text column, preferring name-like headers. */
export function labelColumn(members) {
  if (!members.length) return null;
  const cols = new Map();
  for (const m of members) for (const [k, v] of Object.entries(m.attrs)) {
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k).push(v);
  }
  const cand = [];
  let order = 0;
  for (const [k, vs] of cols) {
    order++;
    const texts = vs.map(str).map(s => s.trim()).filter(Boolean);
    if (texts.length < Math.max(1, Math.ceil(0.8 * members.length))) continue;
    if (texts.some(s => s.length > 120 || s.startsWith('{') || s.startsWith('['))) continue;
    if (texts.every(s => isNumText(s) || isDateText(s) || emailsIn(s).length || /^[0-9a-f-]{16,}$/i.test(s))) continue;
    const distinct = new Set(texts.map(norm)).size / texts.length;
    if (members.length > 1 && distinct < 0.8) continue;
    const leaf = k.split('.').at(-1);
    const score = (LABEL_PREF.test(leaf) ? 100 : LABEL_SOFT.test(leaf) ? 50 : 0) + (/^(id|ts|uuid)$/i.test(leaf) ? -200 : 0) - order * 0.01 - (k.includes('.') ? 5 : 0);
    cand.push({ k, score });
  }
  cand.sort((a, b) => b.score - a.score);
  return cand[0]?.k ?? null;
}

const personName = a => {
  const f = a.first_name ?? a.FirstName ?? a.firstname ?? a.firstName ?? a['First Name'] ?? null;
  const l = a.last_name ?? a.LastName ?? a.lastname ?? a.lastName ?? a['Last Name'] ?? null;
  return f && l ? `${str(f).trim()} ${str(l).trim()}` : null;
};

/** Mention forms of a label: the normalized label, the label without trailing organisation words, and, for a person or a
 *  distinctive first word, the shorter forms a message would use. A form must be unique among the universe's labels
 *  (`others`) and at least 3 characters; common words never stand alone. Matching is whole-word (dstar.mjs). */
export function mentionForms(label, { person = false, others = [] } = {}) {
  const full = norm(label);
  if (!full) return [];
  const forms = new Set([full]);
  const words = full.split(' ').filter(Boolean);
  const raw = str(label).trim().split(/\s+/);
  let k = words.length;
  while (k > 1 && ORG_SUFFIX.has(words[k - 1])) k--;
  if (k < words.length) forms.add(words.slice(0, k).join(' '));
  if (person && words.length >= 2) forms.add(words[0]);
  else if (words.length >= 2) {
    const w = words[0], r = raw[0] ?? '';
    const distinctive = /[a-z][A-Z]/.test(r) || /\d/.test(r);
    if (distinctive && !COMMON.has(w)) forms.add(w);
  }
  const otherNorm = others.map(norm).filter(o => o && o !== full);
  const clash = f => otherNorm.some(o => new RegExp(`(?<![a-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(o));
  return [...forms].filter(f => f.length >= 3 && !COMMON.has(f) && (f === full || !clash(f)));
}

function finishUniverse(u) {
  const col = labelColumn(u.members);
  u.labelColumn = col;
  for (const m of u.members) {
    const p = personName(m.attrs);
    m.label = p ?? (col ? str(m.attrs[col]).trim() : '') ?? '';
    if (!m.label) m.label = str(m.attrs.name ?? m.attrs.title ?? m.attrs.subject ?? m.id);
    // a person: first and last name fields, or a two- or three-word capitalised label in a people collection or column
    m.person = Boolean(p) || (PERSON_LABEL.test(m.label) && (PERSON_KIND.test(u.kind) || (col && PERSON_COL.test(col) && !NOT_PERSON_COL.test(col))));
    m.emails = emailsIn(Object.values(m.attrs).map(str).join(' '));
  }
  const labels = u.members.map(m => m.label);
  for (const m of u.members) m.forms = mentionForms(m.label, { person: m.person, others: labels });
  // A member is also named by a distinctive value of its own: a short multi-word or CamelCase text that no other member
  // of the universe carries in any column (a platform, a product, a campaign name in a row whose label column is not
  // unique). Dates, numbers, addresses and common words never qualify.
  const seen = new Map();
  for (const m of u.members) for (const [k, v] of Object.entries(m.attrs)) {
    if (typeof v !== 'string' || k.startsWith('_')) continue;
    const t = v.trim();
    if (t.length < 4 || t.length > 60 || t.split(/\s+/).length > 6 || /[.!?;:]\s/.test(t) || isNumText(t) || isDateText(t) || emailsIn(t).length) continue;
    if (!(/\s/.test(t) || /[a-z][A-Z]/.test(t))) continue;
    if (!/[A-Z]/.test(t)) continue;
    const n = norm(t);
    if (!seen.has(n)) seen.set(n, new Set());
    seen.get(n).add(m.mid);
  }
  for (const m of u.members) {
    for (const [n, owners] of seen) if (owners.size === 1 && owners.has(m.mid) && !COMMON.has(n) && !m.forms.includes(n)) m.forms.push(n);
  }
  const types = new Map();
  for (const m of u.members) for (const [k, v] of Object.entries(m.attrs)) {
    const t = typeof v === 'number' ? 'num' : 'text';
    types.set(k, types.get(k) === 'text' || t === 'text' ? (v === null && types.has(k) ? types.get(k) : t) : 'num');
  }
  u.columns = [...types].map(([name, type]) => ({ name, type }));
  return u;
}

const uidOf = (app, kind, container) => `${app}.${kind}${container ? `[${container}]` : ''}`;

/** A short form (a person's first name, an organisation's first word) names a member only if no other label of the
 *  task, in any universe, carries it as a word; otherwise the form is dropped (the full label stays). */
export function refineForms(universes) {
  const labels = universes.flatMap(u => u.members.map(m => ({ m, l: norm(m.label) })));
  for (const u of universes) for (const m of u.members) {
    const full = norm(m.label);
    m.forms = (m.forms ?? []).filter(f => f === full || !labels.some(x => x.l !== full && x.m !== m && new RegExp(`(?<![a-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(x.l)));
  }
  return universes;
}

/** Universes from an A1-C inventory (inventory.json): one per (app, kind, container). */
export function universesFromInventory(inventory) {
  const by = new Map();
  for (const r of inventory?.records ?? []) {
    if (!r || CONTAINER_KINDS.has(r.kind)) continue;
    const d = r.data ?? {};
    let container = null, title = null;
    if (r.app === 'google_sheets' && r.kind === 'row') {
      const m = /^google_sheets:row:([^/]+)\/([^#]+)#(\d+)$/.exec(r.ptr ?? '');
      container = m ? `${m[1]}/${m[2]}` : `${d.spreadsheetId ?? '?'}/${d.worksheet ?? '?'}`;
      title = `${str(d.spreadsheet)} / ${str(d.worksheet)}`;
    } else if (r.app === 'slack' && r.kind === 'message') { container = str(d.channel ?? d.channel_id); title = `#${str(d.name ?? d.channel)}`; }
    const uid = uidOf(r.app, r.kind, container);
    if (!by.has(uid)) by.set(uid, { uid, app: r.app, kind: r.kind, container, title: title ?? `${r.app} ${r.kind}`, source: 'inventory', members: [] });
    const attrs = flatAttrs(d);
    if (r.app === 'google_sheets' && r.kind === 'row') attrs._row = Number(d.row);
    by.get(uid).members.push({ mid: by.get(uid).members.length + 1, ptr: r.ptr, app: r.app, kind: r.kind, id: str(r.id), key: r.ptr, attrs, text: Object.values(attrs).map(str).join('\n') });
  }
  return refineForms([...by.values()].map(finishUniverse));
}

/** Universes from an initial world (meta skipped): one per (app, collection, container). Pointers are the world index's
 *  ('app.coll:id'); a sheet row also carries its stable key 'google_sheets:row:<ss>/<ws>#<row>', the inventory pointer. */
export function universesFromWorld(world, idx = indexWorld(world)) {
  const by = new Map();
  for (const r of idx.recs) {
    const rec = r.record;
    let container = null, title = null, attrs, key = r.ptr;
    if (r.app === 'google_sheets' && r.coll === 'rows') {
      container = `${str(rec.spreadsheet_id)}/${str(rec.worksheet_id)}`;
      attrs = flatAttrs(rec.cells ?? {});
      attrs._row = Number(rec.row_id);
      key = `google_sheets:row:${container}#${rec.row_id}`;
      const ws = (world?.google_sheets?.worksheets ?? []).find(w => w?.id === rec.worksheet_id);
      const ss = (world?.google_sheets?.spreadsheets ?? []).find(s => s?.id === rec.spreadsheet_id);
      title = `${str(ss?.title)} / ${str(ws?.title)}`;
    } else {
      if (['spreadsheets', 'worksheets'].includes(r.coll) && r.app === 'google_sheets') continue;
      if (r.app === 'slack' && r.coll === 'messages') { container = str(rec.channel_id ?? rec.channel); title = `#${container}`; }
      attrs = flatAttrs(rec);
    }
    const uid = uidOf(r.app, r.coll, container);
    if (!by.has(uid)) by.set(uid, { uid, app: r.app, kind: r.coll, container, title: title ?? `${r.app} ${r.coll}`, source: 'world', members: [] });
    by.get(uid).members.push({ mid: by.get(uid).members.length + 1, ptr: r.ptr, alias: r.aliasPtr ?? null, app: r.app, kind: r.coll, id: r.id, key, attrs, text: Object.values(attrs).map(str).join('\n') });
  }
  return refineForms([...by.values()].map(finishUniverse));
}

/** SQL tables of universes for sqlsafe: table u<i> per universe, with _mid, _label and every attribute column; a catalog
 *  maps table names to universes. Column names are kept as written (the reader quotes them: "Due Date"). Money and
 *  percent texts become numbers in a parallel column "<name>#num" so a reader can compare amounts without parsing. */
export function sqlTables(universes) {
  const catalog = [], tables = [];
  universes.forEach((u, i) => {
    const name = `u${i + 1}`;
    const cols = [{ name: '_mid', type: 'num' }, { name: '_label', type: 'text' }];
    const numCols = [];
    for (const c of u.columns) {
      cols.push({ name: c.name, type: c.type });
      if (c.type === 'text' && u.members.some(m => typeof m.attrs[c.name] === 'string' && isNumText(m.attrs[c.name]) && /[$€£,%]/.test(m.attrs[c.name]))) { cols.push({ name: `${c.name}#num`, type: 'num' }); numCols.push(c.name); }
    }
    const rows = u.members.map(m => cols.map(c => {
      if (c.name === '_mid') return m.mid;
      if (c.name === '_label') return m.label;
      if (c.name.endsWith('#num') && numCols.includes(c.name.slice(0, -4))) { const s = str(m.attrs[c.name.slice(0, -4)]).replace(/[$€£,%\s]/g, '').replace('−', '-'); const n = Number(s); return s && Number.isFinite(n) ? n : null; }
      const v = m.attrs[c.name];
      return v === undefined ? null : v;
    }));
    tables.push({ name, columns: cols, rows });
    catalog.push({ table: name, uid: u.uid, title: u.title, members: u.members.length, labelColumn: u.labelColumn, columns: cols.map(c => c.name) });
  });
  return { tables, catalog };
}

/** Find the member of a universe list that a pointer names (exact pointer, alias, or stable key). */
export function memberByPtr(universes, ptr) {
  for (const u of universes) for (const m of u.members) if (m.ptr === ptr || m.alias === ptr || m.key === ptr) return { u, m };
  return null;
}
