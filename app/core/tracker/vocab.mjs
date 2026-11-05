// The tracker's vocabulary: every name a check may use, enumerated from what exists, never from what a model guesses (the E8 run's
// false alarms all came from invented names: research/need-router-20261014/tracker-e8/REPORT.md §5). A vocabulary is
//   { kind, channels: { <channel>: { describe, fields: [path] } }, sources: { <source>: { describe, columns: { <path>: { values?, unique? } } } } }
// The app's vocabulary comes from its effect channels (e-mail, chat, sheet rows) and the person's data catalog and sheets; a bed
// builds its own (experiments/tracker-v2/e8.mjs builds E8's from the systems' op schemas and the world's inbound messages).
//
// lintCheck() is the $0 gate between a binder and the ledger: a check naming anything outside the vocabulary, or a literal the person
// never wrote (and that is not one of their data's own values), is refused with the reasons.
import { TEMPLATE_NAMES, OP_NAMES, LINK_OPS, normText } from './checks.mjs';
import { grounded, numbersIn } from './words.mjs';

export const VOCAB_VERSION = 'tracker-vocab/1';

/** Column names and enumerated values from a data-catalog line: "one row per lead: name, email, ..., status (new | contacted | spam)". */
export function parseCatalogLine(text) {
  const body = String(text ?? '').split(':').slice(1).join(':');
  const columns = {};
  // Split at commas that are not inside parentheses.
  let depth = 0, cur = '';
  const parts = [];
  for (const c of body) { if (c === '(') depth++; if (c === ')') depth = Math.max(0, depth - 1); if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c; }
  parts.push(cur);
  for (const p of parts) {
    const m = p.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\b(.*)$/);
    if (!m) continue;
    const name = m[1], rest = m[2];
    const paren = rest.match(/\(([^)]*)\)/);
    const values = paren ? paren[1].split(/\s*\|\s*|\s+or\s+/).map(s => s.trim().replace(/^'|'$/g, '')).filter(s => s && !/^e\.g\b|^number|^text|^id$|^yyyy|^iso|customer e-mail|of employees/i.test(s)) : [];
    columns[name] = values.length > 1 ? { values } : {};
    if (/;/.test(rest)) break;   // "...; the flow appends missing contacts": prose after a semicolon is not a column list
  }
  return columns;
}

const SCALAR = v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
/** The app vocabulary: channels of the app's effect capabilities, sources = the person's sheets (catalog + observed rows). */
export function appVocabulary({ catalog = {}, sheets = {} } = {}) {
  const sources = {};
  const names = new Set([...Object.keys(catalog), ...Object.keys(sheets)]);
  for (const name of [...names].sort()) {
    const cols = parseCatalogLine(catalog[name] ?? '');
    const rows = sheets[name] ?? [];
    for (const r of rows) for (const k of Object.keys(r)) cols[k] ??= {};
    for (const [k, def] of Object.entries(cols)) {
      const seen = rows.map(r => r[k]).filter(SCALAR);
      if (seen.some(x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x))) { def.type = 'date'; continue; }   // dates are compared by age, never enumerated
      if (seen.length && seen.every(x => typeof x === 'number')) def.type = 'number';
      if (seen.length) {
        const distinct = [...new Set(seen.map(String))];
        def.unique = distinct.length === seen.length && seen.length > 1;
        if (!def.values && distinct.length <= 6 && distinct.length < seen.length) def.values = distinct;
        else if (def.values) def.values = [...new Set([...def.values, ...distinct.filter(x => distinct.length <= 6)])];
      }
    }
    sources[name] = { describe: catalog[name] ?? `${name} sheet`, columns: cols, written: /appends|writes/.test(catalog[name] ?? '') };
  }
  const rowFields = ['sheet', ...new Set(Object.entries(sources).filter(([, s]) => s.written).flatMap(([, s]) => Object.keys(s.columns).map(c => `row.${c}`)))];
  return {
    kind: 'app', version: VOCAB_VERSION,
    channels: {
      email: { describe: 'an e-mail the flow sends (outbox.send)', fields: ['to', 'subject', 'body', '*'] },
      chat: { describe: 'a chat post (chat.post)', fields: ['channel', 'text', '*'] },
      row: { describe: 'a row the flow appends to a sheet (sheet.append)', fields: [...rowFields, '*'] },
    },
    sources,
  };
}

/** Every field path of every channel, and every column of every source (for the model-facing enums). */
export const effectPaths = vocab => [...new Set(Object.values(vocab.channels).flatMap(c => c.fields))].sort();
export const itemPaths = vocab => [...new Set(Object.values(vocab.sources).flatMap(s => Object.keys(s.columns)))].sort();

/** The values the person's own data has for a source column (allowed as literals without being written by the person). */
function dataValues(vocab, source, path) {
  if (source && vocab.sources[source]?.columns?.[path]?.values) return vocab.sources[source].columns[path].values;
  return [];
}
function rowColumnValues(vocab, path) {
  const col = String(path).replace(/^row\./, '');
  return Object.values(vocab.sources).flatMap(s => s.columns?.[col]?.values ?? []);
}

/**
 * lintCheck(check, { vocab, words }) → [reason]. Empty means the check names only vocabulary and grounded literals.
 * Literal rule: a text value must be written by the person (words) or be one of their data's own values for that column; a number
 * other than 0 or 1 must be one the person wrote.
 */
export function lintCheck(check, { vocab, words }) {
  const errs = [];
  if (!check || typeof check !== 'object') return ['no check'];
  if (!TEMPLATE_NAMES.includes(check.template)) return [`template ${JSON.stringify(check.template)} is not one of ${TEMPLATE_NAMES.join(', ')}`];
  const nums = numbersIn(words);
  const numOk = n => n === 0 || n === 1 || nums.has(n);
  const chanOk = (c, where) => { if (!vocab.channels[c]) { errs.push(`${where}: channel ${JSON.stringify(c)} is not in the vocabulary`); return false; } return true; };
  const srcOk = (s, where) => { if (!vocab.sources[s]) { errs.push(`${where}: source ${JSON.stringify(s)} is not in the vocabulary`); return false; } return true; };
  const literal = (v, where, allowed) => {
    if (typeof v === 'number') { if (!numOk(v)) errs.push(`${where}: the number ${v} is not one the person wrote`); return; }
    if (typeof v === 'boolean') return;
    if (typeof v !== 'string' || !v.trim()) { errs.push(`${where}: empty value`); return; }
    if (allowed.some(a => normText(a) === normText(v))) return;
    if (!grounded(words, v)) errs.push(`${where}: ${JSON.stringify(v)} is not in the person's words or their data's values`);
  };
  const conds = (list, where, { channel = null, source = null, itemSource = null } = {}) => {
    if (list == null) return;
    if (!Array.isArray(list)) { errs.push(`${where}: must be a list`); return; }
    list.forEach((c, i) => {
      const at = `${where}[${i}]`;
      if (!c || typeof c !== 'object') { errs.push(`${at}: not a condition`); return; }
      if (!OP_NAMES.includes(c.op)) { errs.push(`${at}: op ${JSON.stringify(c.op)} is not one of ${OP_NAMES.join(', ')}`); return; }
      const paths = channel ? vocab.channels[channel]?.fields ?? [] : vocab.sources[source]?.columns ? Object.keys(vocab.sources[source].columns) : [];
      if (!paths.includes(c.path) && !(channel && c.path === '*')) { errs.push(`${at}: path ${JSON.stringify(c.path)} is not a field of ${channel ?? source}`); return; }
      const allowed = channel ? (c.path.startsWith('row.') ? rowColumnValues(vocab, c.path) : []) : dataValues(vocab, source, c.path);
      if (['eq', 'ne', 'contains', 'notContains'].includes(c.op)) literal(c.value, at, allowed);
      if (['in', 'notIn'].includes(c.op)) { if (!Array.isArray(c.values) || !c.values.length) errs.push(`${at}: ${c.op} needs values`); else c.values.forEach((v, k) => literal(v, `${at}.values[${k}]`, allowed)); }
      if (['lt', 'lte', 'gt', 'gte', 'ageDaysGte', 'ageDaysLte', 'ageHoursGte', 'ageHoursLte'].includes(c.op)) {
        const n = c.n ?? c.value;
        if (typeof n !== 'number' || !Number.isFinite(n)) errs.push(`${at}: ${c.op} needs a number`); else literal(n, at, []);
      }
      if (['inColumn', 'notInColumn'].includes(c.op)) {
        if (!vocab.sources[c.source]) errs.push(`${at}: source ${JSON.stringify(c.source)} is not in the vocabulary`);
        else if (!vocab.sources[c.source].columns[c.column]) errs.push(`${at}: column ${JSON.stringify(c.column)} is not in ${c.source}`);
        else conds(c.filter, `${at}.filter`, { source: c.source });
      }
      if (c.op === 'subsetOf') {
        if (!itemSource) errs.push(`${at}: subsetOf is only for when-then require`);
        else if (!vocab.sources[itemSource]?.columns?.[c.itemPath]) errs.push(`${at}: itemPath ${JSON.stringify(c.itemPath)} is not in ${itemSource}`);
      }
    });
  };
  const linkOk = (l, src, ch, where) => {
    if (l == null) return;
    if (!LINK_OPS[l.op]) errs.push(`${where}: link op ${JSON.stringify(l.op)} is not one of ${Object.keys(LINK_OPS).join(', ')}`);
    if (src && l.item !== '@subject' && !vocab.sources[src]?.columns?.[l.item]) errs.push(`${where}: link item ${JSON.stringify(l.item)} is not a column of ${src}`);
    if (ch && !['*', '@subject'].includes(l.effect) && !(vocab.channels[ch]?.fields ?? []).includes(l.effect)) errs.push(`${where}: link effect ${JSON.stringify(l.effect)} is not a field of ${ch}`);
  };
  switch (check.template) {
    case 'present': case 'absent':
      if (chanOk(check.channel, check.template)) conds(check.where, 'where', { channel: check.channel });
      break;
    case 'field':
      if (chanOk(check.channel, 'field')) { conds(check.where, 'where', { channel: check.channel }); conds(check.require, 'require', { channel: check.channel }); }
      if (!Array.isArray(check.require) || !check.require.length) errs.push('field: require is empty');
      break;
    case 'count':
      if (chanOk(check.channel, 'count')) conds(check.where, 'where', { channel: check.channel });
      if (!['atMost', 'atLeast', 'exactly'].includes(check.op)) errs.push(`count: op ${JSON.stringify(check.op)} is not atMost, atLeast or exactly`);
      if (!Number.isInteger(check.n) || check.n < 0) errs.push('count: n must be a whole number'); else if (!numOk(check.n)) errs.push(`count: the number ${check.n} is not one the person wrote`);
      if (check.source != null) { if (srcOk(check.source, 'count')) { conds(check.filter, 'filter', { source: check.source }); if (!check.link) errs.push('count: a per-item count needs a link'); linkOk(check.link, check.source, check.channel, 'count'); } }
      break;
    case 'when-then': case 'scope':
      if (srcOk(check.source, check.template)) conds(check.filter, 'filter', { source: check.source });
      if (chanOk(check.channel, check.template)) { conds(check.where, 'where', { channel: check.channel }); conds(check.require, 'require', { channel: check.channel, itemSource: check.source }); }
      if (!check.link) errs.push(`${check.template}: a link between the item and the effect is required`); else linkOk(check.link, check.source, check.channel, check.template);
      if (check.template === 'scope' && !(check.filter?.length)) errs.push('scope: filter is empty (everything would be in scope)');
      if (check.within) {
        if (check.within.anchor !== '@at' && !vocab.sources[check.source]?.columns?.[check.within.anchor]) errs.push(`within: anchor ${JSON.stringify(check.within.anchor)} is not a column of ${check.source}`);
        for (const k of ['min', 'max']) if (typeof check.within[k] !== 'number') errs.push(`within: ${k} must be a number`); else literal(check.within[k], `within.${k}`, []);
      }
      if (check.forbidBefore) { if (chanOk(check.forbidBefore.channel, 'forbidBefore')) conds(check.forbidBefore.where, 'forbidBefore.where', { channel: check.forbidBefore.channel }); }
      break;
    case 'order':
      for (const k of ['first', 'then']) if (!check[k] || !chanOk(check[k].channel, `order.${k}`)) errs.push(`order: ${k} needs a channel`); else conds(check[k].where, `order.${k}.where`, { channel: check[k].channel });
      if (!check.link || !(vocab.channels[check.first?.channel]?.fields ?? []).includes(check.link.first) || !(vocab.channels[check.then?.channel]?.fields ?? []).includes(check.link.then)) errs.push('order: link.first and link.then must be fields of the two channels');
      break;
  }
  return errs;
}
