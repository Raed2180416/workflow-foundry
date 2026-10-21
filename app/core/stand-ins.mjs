// Local stand-ins for the connectors the template library needs (research/surface-20261021/BUILDER-1.md): a "sheet" is a JSON file of
// rows in the workspace's world directory (standing in for a spreadsheet, a CSV export or a tracker export), "chat" is a local channel
// file (standing in for Slack), and the existing outbox stands in for e-mail. Nothing here leaves the machine.
//
// Capabilities are trusted host code (docs/ARCHITECTURE.md "Capability and execution boundary"): a workflow names them, never redefines
// them. Three groups:
//   read       sheet.read                                         effects none
//   compute    rows.filter, rows.age, rows.route, rows.lines,     effects none, deterministic, no expressions, no code
//              rows.select, rows.reconcile
//   effects    sheet.append (idempotent: a retry never appends twice), chat.post (live: non-idempotent, asks a person first)
//   verify     outbox.audit, chat.audit, sheet.audit               effects none; re-read what this run delivered from disk
// The audits are the templates' independent checks: they re-read the outbox, channel or sheet file and compare what this run actually
// left there (recipients, counts, content hashes) with what the flow planned, through a different path than the one that wrote it.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, readdirSync, appendFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { FoundryError, canonical } from '../../src/data.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const SHEET = /^[a-z][a-z0-9-]{0,40}$/;
const CHANNEL = /^#[a-z0-9][a-z0-9_-]{0,60}$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const SCALAR = { type: ['string', 'number', 'boolean', 'null'] };
const ROWS = { type: 'array', maxItems: 2000, items: { type: 'object' } };
const ROWS_OUT = { type: 'object', additionalProperties: false, required: ['rows', 'count'], properties: { rows: { type: 'array' }, count: { type: 'integer' } } };
const VERDICT = { type: 'object', additionalProperties: false, required: ['pass', 'score', 'reasons'],
  properties: { pass: { type: 'boolean' }, score: { type: 'number' }, reasons: { type: 'array', items: { type: 'string' } } } };
const FIELD = { anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 200 } }] };
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'not_contains', 'exists', 'missing'];
const CONDITION = { type: 'object', additionalProperties: false, required: ['field', 'op'], properties: { field: FIELD, op: { enum: OPS }, value: {} } };

/** Own-property path lookup ("a.b"); undefined when absent. No prototype traversal. */
export function fieldOf(row, field) {
  let v = row;
  for (const part of String(field).split('.')) {
    if (FORBIDDEN.has(part)) throw new FoundryError('ROWS_FIELD', 'Forbidden field name');
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part)) return undefined;
    v = v[part];
  }
  return v;
}
const lower = v => typeof v === 'string' ? v.trim().toLowerCase() : v;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' ? lower(a) === lower(b) : canonical(a ?? null) === canonical(b ?? null);
/** One condition on one row. Text comparisons ignore case and surrounding spaces; order comparisons need numbers (no coercion). */
export function rowMatches(row, { field, op, value }) {
  const fields = Array.isArray(field) ? field : [field];
  const one = f => {
    const v = fieldOf(row, f);
    switch (op) {
      case 'eq': return same(v, value);
      case 'ne': return !same(v, value);
      case 'gt': case 'gte': case 'lt': case 'lte':
        if (typeof v !== 'number' || typeof value !== 'number') return false;
        return op === 'gt' ? v > value : op === 'gte' ? v >= value : op === 'lt' ? v < value : v <= value;
      case 'in': return Array.isArray(value) && value.some(x => same(v, x));
      case 'not_in': return Array.isArray(value) && !value.some(x => same(v, x));
      case 'contains': return typeof v === 'string' ? lower(v).includes(lower(String(value))) : Array.isArray(v) ? v.some(x => same(x, value)) : false;
      case 'not_contains': return !(typeof v === 'string' ? lower(v).includes(lower(String(value))) : Array.isArray(v) ? v.some(x => same(x, value)) : false);
      case 'exists': return v !== undefined && v !== null && v !== '';
      case 'missing': return v === undefined || v === null || v === '';
      default: throw new FoundryError('ROWS_OP', `Unknown row condition ${op}`);
    }
  };
  // Negative conditions hold when they hold for every named field; positive ones when any field satisfies them.
  return ['ne', 'not_in', 'not_contains', 'missing'].includes(op) ? fields.every(one) : fields.some(one);
}
const parseTime = (text, label) => {
  if (typeof text !== 'string') throw new FoundryError('ROWS_DATE', `${label} is not a date`);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(text) ? Date.parse(text) : NaN;
  if (!Number.isFinite(t)) throw new FoundryError('ROWS_DATE', `${label} is not a YYYY-MM-DD date or an ISO date-time with an offset: ${String(text).slice(0, 40)}`);
  return t;
};
const fill = (line, row) => line.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (_, f) => { const v = fieldOf(row, f); return v === undefined || v === null ? '' : String(v); });

function safeDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink()) throw new FoundryError('WORLD_PATH', 'A world directory must not be a symlink');
  return dir;
}
const sheetFile = (worldDir, sheet) => {
  if (!SHEET.test(sheet ?? '')) throw new FoundryError('SHEET_NAME', 'A sheet name is lowercase letters, digits and dashes');
  return path.join(safeDir(path.join(worldDir, 'sheets')), `${sheet}.json`);
};
const channelFile = (worldDir, channel) => {
  if (!CHANNEL.test(channel ?? '')) throw new FoundryError('CHAT_CHANNEL', 'A channel is # followed by lowercase letters, digits, - or _');
  return path.join(safeDir(path.join(worldDir, 'chat')), `${channel.slice(1)}.json`);
};
const readJson = (file, fallback) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
const writeJson = (file, value) => { const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(tmp, file); };
const effectsLog = worldDir => path.join(safeDir(worldDir), 'effects.jsonl');
const loggedEffects = worldDir => existsSync(effectsLog(worldDir)) ? readFileSync(effectsLog(worldDir), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

/** Every world file a run can change, read back for an oracle or a dry-run report (rows of each sheet, posts of each channel). */
export function readWorld(worldDir) {
  const sheets = {}, chat = {};
  const sd = path.join(worldDir, 'sheets'), cd = path.join(worldDir, 'chat');
  if (existsSync(sd)) for (const f of readdirSync(sd).filter(f => f.endsWith('.json'))) sheets[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(sd, f), 'utf8'));
  if (existsSync(cd)) for (const f of readdirSync(cd).filter(f => f.endsWith('.json'))) chat[`#${f.slice(0, -5)}`] = JSON.parse(readFileSync(path.join(cd, f), 'utf8'));
  return { sheets, chat, effects: existsSync(effectsLog(worldDir)) ? loggedEffects(worldDir) : [] };
}
/** Write a world's sheets (and nothing else) into a fresh world directory. */
export function seedWorld(worldDir, { sheets = {} } = {}) {
  for (const [name, rows] of Object.entries(sheets)) writeJson(sheetFile(worldDir, name), rows);
}
/** Messages in an outbox directory (each file one message). */
export function readOutbox(outboxDir) {
  if (!existsSync(outboxDir)) return [];
  return readdirSync(outboxDir).filter(f => f.endsWith('.json')).map(f => ({ messageId: f.slice(0, -5), ...JSON.parse(readFileSync(path.join(outboxDir, f), 'utf8')) }));
}

export function registerStandIns(registry, { mode, outboxDir, worldDir, base }) {
  const reg = (spec, execute) => registry.register({ ...base, ...spec, execute });
  // ---------- read ----------
  reg({ name: 'sheet.read', implementation: 'foundry-surface/sheet.read', effects: 'none',
    description: 'Read every row of a local sheet (a JSON file of rows in the workspace, standing in for a spreadsheet or an export). Fails if the sheet does not exist.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sheet'], properties: { sheet: { type: 'string', minLength: 1, maxLength: 41 } } },
    outputSchema: ROWS_OUT }, async ({ sheet }) => {
    const file = sheetFile(worldDir, sheet);
    if (!existsSync(file)) throw new FoundryError('SHEET_NOT_FOUND', `There is no sheet named ${sheet}`);
    const rows = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(rows)) throw new FoundryError('SHEET_SHAPE', `Sheet ${sheet} is not a list of rows`);
    return { rows, count: rows.length };
  });
  // ---------- compute ----------
  reg({ name: 'rows.filter', implementation: 'foundry-surface/rows.filter', effects: 'none',
    description: 'Keep the rows that satisfy EVERY condition {field, op, value}. Ops: eq, ne, gt, gte, lt, lte (numbers only), in, not_in (value is a list), contains, not_contains (text, ignoring case), exists, missing. Text equality ignores case. field may be a list: positive ops hold if any field matches, negative ops if all do.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['rows', 'where'], properties: { rows: ROWS, where: { type: 'array', maxItems: 12, items: CONDITION } } },
    outputSchema: ROWS_OUT }, async ({ rows, where }) => { const kept = rows.filter(r => where.every(c => rowMatches(r, c))); return { rows: kept, count: kept.length }; });
  reg({ name: 'rows.age', implementation: 'foundry-surface/rows.age', effects: 'none',
    description: 'Add to every row a whole number field `as`: how many full days (or hours) lie between the row\'s date field and `now` (positive when the date is in the past). Dates are YYYY-MM-DD (midnight UTC) or ISO date-times with an offset; any other value fails.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['rows', 'field', 'now', 'as'], properties: { rows: ROWS, field: { type: 'string', minLength: 1, maxLength: 200 },
      now: { type: 'string', minLength: 10, maxLength: 40 }, unit: { enum: ['days', 'hours'] }, as: { type: 'string', minLength: 1, maxLength: 64 } } },
    outputSchema: ROWS_OUT }, async ({ rows, field, now, unit = 'days', as }) => {
    if (FORBIDDEN.has(as) || as.includes('.')) throw new FoundryError('ROWS_FIELD', 'as is one plain field name');
    const at = parseTime(now, 'now'), size = unit === 'hours' ? 3600000 : 86400000;
    const out = rows.map((r, i) => ({ ...r, [as]: Math.floor((at - parseTime(fieldOf(r, field), `row ${i} ${field}`)) / size) }));
    return { rows: out, count: out.length };
  });
  reg({ name: 'rows.route', implementation: 'foundry-surface/rows.route', effects: 'none',
    description: 'Label every row: the first rule whose condition {field, op, value} holds sets its `set` fields on the row; a row no rule matches gets `otherwise`. Same condition ops as rows.filter. Rows are kept in order; none is dropped.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['rows', 'rules', 'otherwise'], properties: { rows: ROWS,
      rules: { type: 'array', maxItems: 24, items: { type: 'object', additionalProperties: false, required: ['field', 'op', 'set'], properties: { field: FIELD, op: { enum: OPS }, value: {},
        set: { type: 'object', maxProperties: 12, additionalProperties: SCALAR } } } },
      otherwise: { type: 'object', maxProperties: 12, additionalProperties: SCALAR } } },
    outputSchema: ROWS_OUT }, async ({ rows, rules, otherwise }) => {
    const out = rows.map(r => ({ ...r, ...(rules.find(rule => rowMatches(r, rule))?.set ?? otherwise) }));
    return { rows: out, count: out.length };
  });
  reg({ name: 'rows.lines', implementation: 'foundry-surface/rows.lines', effects: 'none',
    description: 'Render one text line per row from a line pattern with {{field}} markers (dotted paths allowed; a missing field renders empty), joined with newlines. With no rows the text is `empty`.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['rows', 'line'], properties: { rows: ROWS, line: { type: 'string', minLength: 1, maxLength: 2000 }, empty: { type: 'string', maxLength: 2000 } } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['text', 'count'], properties: { text: { type: 'string' }, count: { type: 'integer' } } } },
  async ({ rows, line, empty = '(none)' }) => ({ text: rows.length ? rows.map(r => fill(line, r)).join('\n') : empty, count: rows.length }));
  reg({ name: 'rows.select', implementation: 'foundry-surface/rows.select', effects: 'none',
    description: 'Keep only the named fields of every row (a missing field becomes null) and add the constant fields in `set`.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['rows', 'fields'], properties: { rows: ROWS, fields: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 200 } },
      set: { type: 'object', maxProperties: 12, additionalProperties: SCALAR } } },
    outputSchema: ROWS_OUT }, async ({ rows, fields, set = {} }) => {
    const out = rows.map(r => ({ ...Object.fromEntries(fields.map(f => [f.split('.').at(-1), fieldOf(r, f) ?? null])), ...set }));
    return { rows: out, count: out.length };
  });
  reg({ name: 'rows.reconcile', implementation: 'foundry-surface/rows.reconcile', effects: 'none',
    description: 'Compare two row lists by a key field (text keys ignore case and spaces). missing: left rows whose key is not in right; extra: right rows whose key is not in left; changed: one entry {key, field, left, right} per compared field that differs on a matched key.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['left', 'right', 'key'], properties: { left: ROWS, right: ROWS, key: { type: 'string', minLength: 1, maxLength: 200 },
      compare: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200 } } } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['missing', 'extra', 'changed', 'matched', 'counts'], properties: { missing: { type: 'array' }, extra: { type: 'array' },
      changed: { type: 'array' }, matched: { type: 'integer' }, counts: { type: 'object' } } } },
  async ({ left, right, key, compare = [] }) => {
    const k = r => { const v = fieldOf(r, key); return typeof v === 'string' ? lower(v) : canonical(v ?? null); };
    const rightBy = new Map(right.map(r => [k(r), r])), leftKeys = new Set(left.map(k));
    const missing = left.filter(r => !rightBy.has(k(r))), extra = right.filter(r => !leftKeys.has(k(r))), changed = [];
    let matched = 0;
    for (const r of left) {
      const other = rightBy.get(k(r)); if (!other) continue; matched++;
      for (const f of compare) if (!same(fieldOf(r, f), fieldOf(other, f))) changed.push({ key: fieldOf(r, key) ?? null, field: f, left: fieldOf(r, f) ?? null, right: fieldOf(other, f) ?? null });
    }
    return { missing, extra, changed, matched, counts: { missing: missing.length, extra: extra.length, changed: changed.length, matched } };
  });
  // ---------- effects ----------
  reg({ name: 'sheet.append', implementation: `foundry-surface/sheet.append/${mode}`, effects: 'idempotent',
    description: mode === 'live' ? 'Append rows to the end of a local sheet (creates it if absent). Safe to repeat: the same step never appends twice.'
      : 'PRACTICE: append rows to the practice copy of the sheet only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sheet', 'rows'], properties: { sheet: { type: 'string', minLength: 1, maxLength: 41 }, rows: ROWS } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['sheet', 'appended', 'sha256'], properties: { sheet: { type: 'string' }, appended: { type: 'integer' }, sha256: { type: 'string' } } } },
  async ({ sheet, rows }, ctx) => {
    const file = sheetFile(worldDir, sheet), key = String(ctx.idempotencyKey), hash = sha256(canonical(rows));
    const prior = loggedEffects(worldDir).find(e => e.kind === 'sheet.append' && e.key === key);
    if (prior) {
      if (prior.sha256 !== hash || prior.sheet !== sheet) throw new FoundryError('SHEET_CONFLICT', 'A different append already used this step id');
      return { sheet, appended: prior.count, sha256: hash };
    }
    const current = readJson(file, []);
    if (!Array.isArray(current)) throw new FoundryError('SHEET_SHAPE', `Sheet ${sheet} is not a list of rows`);
    writeJson(file, [...current, ...rows]);
    appendFileSync(effectsLog(worldDir), `${JSON.stringify({ kind: 'sheet.append', key, runId: ctx.runId, nodeKey: ctx.nodeKey, sheet, count: rows.length, sha256: hash, rowHashes: rows.map(r => sha256(canonical(r))), mode })}\n`, { mode: 0o600 });
    return { sheet, appended: rows.length, sha256: hash };
  });
  reg({ name: 'chat.post', implementation: `foundry-surface/chat.post/${mode}`,
    effects: mode === 'live' ? 'non-idempotent' : 'idempotent', requiresApproval: mode === 'live',
    description: mode === 'live' ? 'Post one message to a local chat channel (stand-in for Slack). Asks a person before every post.' : 'PRACTICE: record the message that would be posted, in the practice channel only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['channel', 'text'], properties: { channel: { type: 'string', minLength: 2, maxLength: 62 }, text: { type: 'string', minLength: 1, maxLength: 40000 } } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['posted', 'postId', 'sha256', 'channel', 'mode'], properties: { posted: { type: 'boolean' }, postId: { type: 'string' },
      sha256: { type: 'string' }, channel: { type: 'string' }, mode: { enum: ['live', 'practice'] } } } },
  async ({ channel, text }, ctx) => {
    const file = channelFile(worldDir, channel), postId = String(ctx.idempotencyKey).slice(0, 32), hash = sha256(text);
    const posts = readJson(file, []);
    const prior = posts.find(p => p.postId === postId);
    if (prior) { if (prior.sha256 !== hash) throw new FoundryError('CHAT_CONFLICT', 'A different post already holds this id'); }
    else writeJson(file, [...posts, { postId, channel, text, sha256: hash, mode, runId: ctx.runId, nodeKey: ctx.nodeKey }]);
    return { posted: true, postId, sha256: hash, channel, mode };
  });
  // ---------- independent checks ----------
  reg({ name: 'outbox.audit', implementation: `foundry-surface/outbox.audit/${mode}`, effects: 'none',
    description: 'Independent check: re-read every message THIS RUN left in the outbox and compare the recipients with the expected list (each address as many times as listed; lists are flattened), and each message body with its recorded hash.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['to'], properties: { to: { type: 'array', maxItems: 2000, items: { anyOf: [{ type: 'string' }, { type: 'array', maxItems: 2000, items: { type: 'string' } }] } } } },
    outputSchema: VERDICT }, async ({ to }, ctx) => {
    const expected = to.flat().map(lower).sort(), sent = readOutbox(outboxDir).filter(m => m.runId === ctx.runId);
    const actual = sent.map(m => lower(m.to)).sort(), broken = sent.filter(m => sha256(m.body ?? '') !== m.sha256);
    const reasons = [];
    if (canonical(actual) !== canonical(expected)) reasons.push(`This run delivered ${actual.length} message(s) to [${actual.join(', ')}]; expected ${expected.length} to [${expected.join(', ')}]`);
    if (broken.length) reasons.push(`${broken.length} delivered message(s) differ from what was recorded`);
    return reasons.length ? { pass: false, score: 0, reasons } : { pass: true, score: 1, reasons: [`Exactly the ${expected.length} expected message(s) were delivered, each intact`] };
  });
  reg({ name: 'chat.audit', implementation: `foundry-surface/chat.audit/${mode}`, effects: 'none',
    description: 'Independent check: re-read the channel and count the posts THIS RUN left there, each compared with its recorded hash.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['channel', 'posts'], properties: { channel: { type: 'string', minLength: 2, maxLength: 62 }, posts: { type: 'integer', minimum: 0, maximum: 1000 } } },
    outputSchema: VERDICT }, async ({ channel, posts }, ctx) => {
    const file = channelFile(worldDir, channel), mine = readJson(file, []).filter(p => p.runId === ctx.runId);
    const broken = mine.filter(p => sha256(p.text ?? '') !== p.sha256);
    if (mine.length === posts && !broken.length) return { pass: true, score: 1, reasons: [`${posts} post(s) on ${channel}, each intact`] };
    return { pass: false, score: 0, reasons: [`This run left ${mine.length} post(s) on ${channel}; expected ${posts}${broken.length ? `; ${broken.length} differ from what was recorded` : ''}`] };
  });
  reg({ name: 'sheet.audit', implementation: `foundry-surface/sheet.audit/${mode}`, effects: 'none',
    description: 'Independent check: count the rows THIS RUN appended to a sheet and confirm each one is still in the sheet file as written.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sheet', 'rows'], properties: { sheet: { type: 'string', minLength: 1, maxLength: 41 }, rows: { type: 'integer', minimum: 0, maximum: 100000 } } },
    outputSchema: VERDICT }, async ({ sheet, rows }, ctx) => {
    const mine = loggedEffects(worldDir).filter(e => e.kind === 'sheet.append' && e.runId === ctx.runId && e.sheet === sheet);
    const count = mine.reduce((s, e) => s + e.count, 0), file = sheetFile(worldDir, sheet);
    const present = new Map();
    for (const r of readJson(file, [])) { const h = sha256(canonical(r)); present.set(h, (present.get(h) ?? 0) + 1); }
    const missing = mine.flatMap(e => e.rowHashes).filter(h => { const n = present.get(h) ?? 0; if (n > 0) { present.set(h, n - 1); return false; } return true; });
    if (count === rows && !missing.length) return { pass: true, score: 1, reasons: [`${rows} row(s) appended to ${sheet}, each present as written`] };
    return { pass: false, score: 0, reasons: [`This run appended ${count} row(s) to ${sheet}; expected ${rows}${missing.length ? `; ${missing.length} appended row(s) are no longer in the sheet` : ''}`] };
  });
  return registry;
}
