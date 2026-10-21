// requirement-ledger-v2: bounded text views of a world (for the requirement extractor) and of a candidate's changes (for
// the judged checks). Generic (PREREG-AB-v1 H7/H8): built only from the request, the initial world and the diff; the
// world's meta block (simulator bookkeeping) is never shown. Every string is untrusted data; rendering only shortens it.
import { BOOKKEEPING_KEY, TOUCH_FIELD, isObj, recordKey } from './lib.mjs';

const HIDE_COL = /^(thread_id|label_ids|is_starred|has_attachments|internal_date|size_estimate|text_format_[a-z]+|timezone|overwrite|is_bot|is_deleted|reply_count|bot_name|snippet|api_version|uri|account_sid|num_segments)$/;
const EPOCH_COL = /^(date|created_at|updated_at|sent_at|received_at|timestamp)$/;

function compact(v) {
  if (Array.isArray(v)) return v.map(compact);
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const y = compact(x);
      if (y === null || y === undefined || y === '' || (Array.isArray(y) && !y.length) || (isObj(y) && !Object.keys(y).length)) continue;
      o[k] = y;
    }
    return o;
  }
  return v;
}
function clip(v, max) {
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…[+${v.length - max} chars]` : v;
  if (Array.isArray(v)) return v.map(x => clip(x, max));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clip(x, max)]));
  return v;
}
const iso = n => { try { return new Date(n).toISOString().replace('.000Z', 'Z'); } catch { return String(n); } };
function flatRow(rec, i, maxStr) {
  const o = { '@id': String(recordKey(rec, i)) };
  for (const [k, v0] of Object.entries(compact(rec))) {
    if (HIDE_COL.test(k) || k === 'id') continue;
    let v = v0;
    if (EPOCH_COL.test(k) && typeof v === 'number' && v > 1e11) v = iso(v);
    if (isObj(v) && Object.values(v).every(x => !isObj(x))) for (const [k2, v2] of Object.entries(v)) o[`${k}.${k2}`] = clip(v2, maxStr);
    else o[k] = clip(v, maxStr);
  }
  return o;
}
const cell = v => (v === undefined ? '' : typeof v === 'string' ? v.replace(/\r?\n/g, '⏎').replace(/\|/g, '¦') : JSON.stringify(v).replace(/\|/g, '¦'));
function table(records, maxStr) {
  const rows = records.map(([r, i]) => flatRow(r, i, maxStr));
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return [`| ${cols.join(' | ')} |`, ...rows.map(r => `| ${cols.map(c => cell(r[c])).join(' | ')} |`)].join('\n');
}

/** The initial records of the connected apps as tables, within capChars. Long strings are shortened first, then fewer
 *  records per collection are shown (each cut is marked). Each table's "@id" column is the record's pointer id. */
export function renderWorld(world, { services = [], capChars = 45000 } = {}) {
  const keep = new Set(services);
  const apps = Object.entries(world ?? {}).filter(([app, v]) => app !== 'meta' && keep.has(app) && isObj(v)).sort(([a], [b]) => a.localeCompare(b));
  const render = (maxStr, maxRecords) => {
    const out = [];
    for (const [app, colls] of apps) for (const [coll, x] of Object.entries(colls)) {
      const list = Array.isArray(x) ? x.map((r, i) => [r, i]).filter(([r]) => isObj(r)) : null;
      if (!list) { const c = compact(x); if (c !== undefined && !(isObj(c) && !Object.keys(c).length)) out.push(`### ${app}.${coll}: ${JSON.stringify(clip(c, maxStr))}`); continue; }
      if (!list.length) continue;
      out.push(`### ${app}.${coll} (${list.length} record${list.length === 1 ? '' : 's'}; pointer ${app}.${coll}:<@id>)`);
      const shown = list.slice(0, maxRecords);
      out.push(table(shown, maxStr));
      if (list.length > shown.length) out.push(`[… ${list.length - shown.length} more ${app}.${coll} records not shown]`);
    }
    return out.join('\n');
  };
  let text = '';
  for (const [maxStr, maxRecords] of [[3000, Infinity], [1500, Infinity], [800, Infinity], [400, Infinity], [400, 60], [250, 40], [200, 25], [150, 15]]) {
    text = render(maxStr, maxRecords);
    if (text.length <= capChars) return { text, truncated: maxStr < 3000 || maxRecords !== Infinity, chars: text.length };
  }
  return { text: `${text.slice(0, capChars)}\n[… records cut at ${capChars} characters]`, truncated: true, chars: capChars };
}

const RULE_WORDS = /\b(polic(?:y|ies)|procedures?|guidelines?|rules?|must|do not|don't|never|always|requires?|required|only|threshold|criteria|exceptions?|override|effective|supersedes?|instead|exempt|exclude[ds]?|approval|escalat\w*|eligib\w*|minimum|maximum|at least|no later|deadline|format|template|cc|copy)\b/gi;
const RULE_TITLE = /(polic|rule|guideline|procedure|criteria|threshold|config|setting|instruction|playbook|sop|standard|matrix|mapping|routing|reference)/i;

/** Pointers of records that likely state rules (policies, procedures, thresholds, overrides): a reading hint only. */
export function ruleSourceHints(idx, world, max = 30) {
  const wsTitle = new Map((world?.google_sheets?.worksheets ?? []).filter(isObj).map(w => [w.id, String(w.title ?? '')]));
  const hits = [];
  for (const r of idx.recs) {
    const words = new Set((r.text.match(RULE_WORDS) ?? []).map(w => w.toLowerCase()));
    const inRuleSheet = r.app === 'google_sheets' && r.coll === 'rows' && RULE_TITLE.test(wsTitle.get(r.record.worksheet_id) ?? '');
    const doc = r.text.length >= 120 && words.size >= 2;
    if (inRuleSheet || doc) hits.push({ ptr: r.ptr, score: words.size + (inRuleSheet ? 3 : 0) + Math.min(3, r.text.length / 600) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, max).map(h => h.ptr);
}

// ---------- a candidate's changes ----------
const line = v => JSON.stringify(v);
function findRecord(world, app, coll, id) {
  const x = world?.[app]?.[coll];
  if (Array.isArray(x)) return x.find(r => isObj(r) && (r.id === id || r.row_id === id)) ?? null;
  return null;
}
function fieldChange(path, before, after, maxStr) {
  if (Array.isArray(before) && Array.isArray(after)) {
    const key = v => JSON.stringify(v);
    const b = new Set(before.map(key)), a = new Set(after.map(key));
    const added = after.filter(v => !b.has(key(v))), removed = before.filter(v => !a.has(key(v)));
    return `${path}: ${added.length ? `added ${line(clip(compact(added), maxStr))}` : ''}${added.length && removed.length ? '; ' : ''}${removed.length ? `removed ${line(clip(compact(removed), maxStr))}` : ''}${!added.length && !removed.length ? 'reordered' : ''}`;
  }
  return `${path}: ${line(clip(before ?? null, maxStr))} → ${line(clip(after ?? null, maxStr))}`;
}
const dropBook = rec => Object.fromEntries(Object.entries(compact(rec ?? {})).filter(([k]) => !BOOKKEEPING_KEY.test(k) || k === 'id'));

/** The candidate's changes as lines: + created, ~ updated (with the record's identifying fields), - deleted. Updates that
 *  only touched read flags or timestamps are counted on one line. */
export function renderChanges(diff, initialWorld, { capChars = 24000, maxStr = 1500 } = {}) {
  const out = [], touched = new Map();
  for (const c of diff?.changes ?? []) {
    const where = `${c.app}.${c.coll}`;
    if (c.op === 'created') out.push(`+ created ${where}:${c.id ?? '?'} ${line(clip(dropBook(c.record), maxStr))}`);
    else if (c.op === 'deleted') out.push(`- deleted ${where}:${c.id} ${line(clip(dropBook(c.record ?? c.ref ?? {}), 300))}`);
    else if (c.op === 'set') out.push(`= replaced ${where}: ${line(clip(c.from ?? null, 300))} → ${line(clip(c.to ?? null, maxStr))}`);
    else if (c.op === 'updated') {
      const fields = Object.entries(c.fields ?? {}).filter(([p]) => !TOUCH_FIELD.test(p));
      if (!fields.length) { touched.set(where, (touched.get(where) ?? 0) + 1); continue; }
      const rec = findRecord(initialWorld, c.app, c.coll, c.id);
      const changed = new Set(fields.map(([p]) => p.split('.')[0]));
      const ident = rec ? Object.fromEntries(Object.entries(dropBook(rec)).filter(([k]) => !changed.has(k))) : (c.ref ?? null);
      out.push(`~ updated ${where}:${c.id} (before: ${line(clip(ident, 160)).slice(0, 600)}): ${fields.map(([p, [b, a]]) => fieldChange(p, b, a, maxStr)).join(' | ')}`);
    }
  }
  for (const [where, n] of touched) out.push(`(${n} ${where} record${n === 1 ? '' : 's'} only had read flags or timestamps changed)`);
  let text = out.join('\n') || '(no changes: the systems are exactly as they were before the run)';
  if (text.length > capChars) text = `${text.slice(0, capChars)}\n[… changes cut at ${capChars} characters]`;
  return { text, n: (diff?.changes ?? []).length };
}
