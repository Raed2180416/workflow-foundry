// Port kit for the incident bed (JUDGE-PROGRAM.md §1.2 group I and the incident families of X1, X2, X4, X5, X7; §8.4 W2).
// RELOCATED from src/judges/incident.mjs until the frozen C0 and P1 experiments finish (any file added under src/
// changes their construction-kit hash); it moves to src/judges/ afterwards, unchanged.
//
// The factory (experiments/kev-data/ports/incident.mjs) and the runtime import this same module, so a training state
// and a served state come from one function (W2: kit.buildState(task, slots) is the factory state byte for byte).
// The kit works on the TASK it is given and imports no bed (the runtime has no frozen copy of the beds): a task is the
// bed's task object, { inputs: { system, ticket, log } }. Only inputs.system and inputs.log are read, plus inputs.ticket
// for nothing. Nothing here reads a seed, a split, a difficulty, a task id or a truth field.
//
// The alias table. Every log line names its source as a pod (`<service>-<suffix>`), a data-store pod (`<service>-0`)
// or, for one service at d5, its legacy application name; message text names other services by canonical name, FQDN,
// legacy alias or `ip:port`. All of that is documented in the task's own system document (the dependency table's
// "Other names in logs" column, the "Service addresses" section, and the prose notes that give an old name or name a
// shadow pod), and the kit resolves it from that text alone: the same code a deployed workflow could run.
//
// Neutral handles (I1, I3; [crit S3]). The root service name alone predicts the fault class at 0.307 against 0.085 for
// the majority class (an entity prior of the bed). A state that shows a service's lines replaces every reference to
// a service in them (pod names, canonical names, FQDNs, legacy aliases, `ip:port`) and the third-party providers'
// names and hosts with a stable handle, `svc-a`, `svc-b`, ..., assigned in order of first appearance with the service
// whose lines are shown first. No name of the world ever reaches the model.
//
// States (frozen contracts, spec/ports.json state.keys):
//   I1, I3   { service, window, log_lines }          service: handle of the emitting service; window: "<from> to <to>"
//   I2       { line, emitting_service, calls }       line: one log line as rendered (without its line id); canonical names
//   X1       { source_kind, text }                   one log line (or a window of neighbouring lines), or a literal span
//   X5       { source_text }                         overview sentences, table rows and the notes of the service map
//   X2       { a, b, context }                       two references to services and their alias-table rows
//   X7       { item }                                one log line
//   X4       { statement, source: {doc_type, date, author_role}, related_statements }
//
// Slots (all trusted code knowledge, never task text):
//   port        which port's state to build (added by kit.buildState / kit.request)
//   service     canonical name of the emitting service (I1, I3)
//   from, to    ISO times of the window (I1, I3); maxLines (8 for I1, 12 for I3, 40 with long); maxTokens budget of the lines
//   long        I1: the long variant (at most 40 lines, 2,300 estimated tokens)
//   triage      I3: the window's WARN and ERROR lines first, then its earliest others, in time order (a service's problems are in its warnings)
//   ids         explicit ordered list of line ids shown (the factory's context filter), instead of the window rule
//   line        a line id (I2, X1, X7)
//   text        X1: a literal span (an authored line is placed in the log by the factory; this is the fall-back)
//   context     X1: neighbouring lines of the bundle on each side of the line (the long variant)
//   handles     false: show names as written (never used for I1, I3)
//   edge        X5: { from, to } canonical names of the call the assumption concerns
//   a, b        X2: the two references as written
//   note        X4: the index of the note in the notes section; ticket: true takes the on-call guess of the ticket instead
//   notes       X5: the indices of the notes shown (default: every note)
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';

export const KIT_VERSION = 'incident@1';
export const KIT_SOURCE_KIND = 'log line';
export const MAX_LINES = 40;
// Budgets in estimated tokens (estimateTokens below), calibrated on 7,101 handle-replaced lines against the pinned Qwen3.5
// tokenizer (least squares, rmse 1.35 tokens per line): a state's other keys and the record format add 59-87 real tokens
// (measured on 60 I1 states), so the line budget keeps a state under the contract's real-token maximum (I1 501 at 8 lines,
// 2,497 long; I3 730 at 12 lines).
export const LINE_BUDGET = Object.freeze({ I1: { lines: 8, tokens: 380 }, I1long: { lines: 40, tokens: 2300 }, I3: { lines: 12, tokens: 600 } });
export function estimateTokens(str) {
  const t = String(str);
  const digits = (t.match(/\d/g) ?? []).length, words = t.match(/[A-Za-z]+/g) ?? [];
  const alpha = words.reduce((a, w) => a + w.length, 0), punct = (t.match(/[^A-Za-z0-9\s]/g) ?? []).length, spaces = (t.match(/\s/g) ?? []).length;
  return Math.ceil(1.23 * digits + 0.8 * words.length + 0.017 * alpha + 0.43 * punct + 0.26 * spaces) + 1;
}

const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };
const need = (v, what) => { if (typeof v !== 'string' || !v.length) throw fail('KIT_SLOT', `incident kit: ${what} must be a non-empty string`); return v; };
const text = (task, key) => {
  const v = task?.inputs?.[key];
  if (typeof v !== 'string') throw fail('KIT_TASK', `incident kit: task.inputs.${key} must be a string`);
  return v;
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- the system document ------------------------------------------------------------------------------------
const TABLE_ROW = /^\|\s*([a-z][a-z0-9-]*)\s*\|\s*([a-z0-9-]+)\s*\|\s*([a-z]+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/;
const NAME_TOKEN = /^[a-z][a-z0-9-]*$/;
const POD = /(?<![A-Za-z0-9_.-])([a-z][a-z0-9-]*)-([0-9a-f]{5})(?![A-Za-z0-9_-])/g;
const SHADOW_WORDS = /\b(shadow|load-test|capacity tests?|soak-tested|excluded from production traffic|outside the load balancer)\b/i;
const NOTES_HEADING = '## Notes and recent changes';

const MEMO = new Map();
// parseSystem(systemText) -> { services: [{name, team, tier, calls: [name], host, legacy, ip}], names, byName,
//   providers: [{name, what, host, caller}], notes: [text], overview: {name: sentence}, shadowPods: [pod],
//   legacySource: name|null, aliases: [{alias, service, kind}] }
export function parseSystem(systemText) {
  if (typeof systemText !== 'string') throw fail('KIT_TASK', 'incident kit: the system document must be a string');
  if (MEMO.has(systemText)) return MEMO.get(systemText);
  const lines = systemText.split('\n');
  const services = [], byName = new Map();
  for (const l of lines) {
    const m = TABLE_ROW.exec(l);
    if (!m || m[1] === 'service' || /^-+$/.test(m[2])) continue;
    const [, name, team, tier, calls, other] = m;
    const svc = { name, team, tier, calls: calls === '-' ? [] : calls.split(',').map(s => s.replace(/\(optional\)/, '').trim()).filter(Boolean), host: null, legacy: null, ip: null, port: null, row: l.trim() };
    for (const part of other.split(',').map(s => s.trim()).filter(Boolean)) {
      const q = /^'([^']+)'$/.exec(part);
      if (q) svc.legacy = q[1]; else if (!svc.host) svc.host = part;
    }
    services.push(svc); byName.set(name, svc);
  }
  if (!services.length) throw fail('KIT_TASK', 'incident kit: the system document has no dependency table');
  // third-party providers: "- Name (what, host): called by svc"
  const providers = [];
  for (const l of lines) {
    const m = /^- (.+?) \(([^,()]+), ([a-z0-9.-]+)\): called by ([a-z][a-z0-9-]*)$/.exec(l);
    if (m) providers.push({ name: m[1], what: m[2], host: m[3], caller: m[4] });
  }
  // addresses: "- name: ip:port"
  for (const l of lines) {
    const m = /^- ([a-z][a-z0-9-]*): (\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(l);
    if (m && byName.has(m[1])) { byName.get(m[1]).ip = m[2]; byName.get(m[1]).port = m[3]; }
  }
  // notes
  const at = lines.findIndex(l => l.trim() === NOTES_HEADING);
  const notes = [];
  if (at >= 0) for (let i = at + 1; i < lines.length && !lines[i].startsWith('## '); i++) if (lines[i].startsWith('- ')) notes.push(lines[i].slice(2).trim());
  // overview sentences: "<name> (team <t>) provides <what>..." (the gateway's sentence names its routes instead)
  const overviewAt = lines.findIndex(l => l.trim() === '## Overview');
  const overviewText = overviewAt >= 0 ? (lines.slice(overviewAt + 1).find(l => l.trim()) ?? '') : '';
  const overview = {};
  for (const s of overviewText.split(/(?<=\.)\s+(?=[a-z][a-z0-9-]* \(team )/)) {
    const m = /^([a-z][a-z0-9-]*) \(team [a-z0-9-]+\)/.exec(s.trim());
    if (m && byName.has(m[1])) overview[m[1]] = s.trim();
  }
  const gw = services.find(s => s.tier === 'edge');
  if (gw && overviewText) { const g = /^(Public traffic for .+?\.)(?:\s|$)/.exec(overviewText); if (g) overview[gw.name] = g[1]; }
  // aliases only given in notes: a quoted single token in a note that names exactly one service
  const names = services.map(s => s.name);
  let legacySource = null;
  const shadow = new Set();
  for (const n of notes) {
    const named = names.filter(x => new RegExp(`(?<![A-Za-z0-9_-])${esc(x)}(?![A-Za-z0-9_-])`).test(n.replace(POD, ' ')));
    const quoted = [...n.matchAll(/'([a-z][a-z0-9-]*)'/g)].map(m => m[1]);
    if (/old name|pre-migration name|before the platform migration|old application name|\(its old application name\)/.test(n) && quoted.length === 1 && NAME_TOKEN.test(quoted[0]) && named.length === 1) {
      const s = byName.get(named[0]); if (!s.legacy) s.legacy = quoted[0];
      if (/application name|carry the source|ships its logs/.test(n)) legacySource = named[0];
    }
    if (SHADOW_WORDS.test(n)) for (const m of n.matchAll(POD)) { if (byName.has(m[1])) shadow.add(`${m[1]}-${m[2]}`); }
  }
  const aliases = [];
  for (const s of services) {
    aliases.push({ alias: s.name, service: s.name, kind: 'name' });
    if (s.host) aliases.push({ alias: s.host, service: s.name, kind: 'host' });
    if (s.legacy) aliases.push({ alias: s.legacy, service: s.name, kind: 'legacy' });
    if (s.ip) aliases.push({ alias: `${s.ip}:${s.port}`, service: s.name, kind: 'address' });
  }
  const out = Object.freeze({ services, names, byName, providers, notes, overview, shadowPods: [...shadow].sort(), legacySource, aliases });
  if (MEMO.size > 16) MEMO.clear();
  MEMO.set(systemText, out);
  return out;
}

// ---- the log ------------------------------------------------------------------------------------------------
const LEVELS = { d: 'DEBUG', i: 'INFO', w: 'WARN', e: 'ERROR' };
const unesc = s => s.replace(/\\(["\\])/g, '$1');
// body = what follows the source column: "LEVEL msg", "[LEVEL] msg", `level=x msg="..."`, `{"k":"x","k2":"..."}`, "X: msg"
export function parseBody(body) {
  let m;
  if ((m = /^(DEBUG|INFO|WARN|ERROR) (.*)$/s.exec(body))) return { style: 'plain', level: m[1], message: m[2] };
  if ((m = /^\[(DEBUG|INFO|WARN|ERROR)\] (.*)$/s.exec(body))) return { style: 'bracket', level: m[1], message: m[2] };
  if ((m = /^level=(debug|info|warn|error) msg="(.*)"$/s.exec(body))) return { style: 'kv', level: m[1].toUpperCase(), message: unesc(m[2]) };
  if ((m = /^\{"([a-z_]+)":"([^"]*)","([a-z_]+)":"(.*)"\}$/s.exec(body))) return { style: 'json', level: m[2].toUpperCase(), message: unesc(m[4]), keys: [m[1], m[3]] };
  if ((m = /^([DIWE]): (.*)$/s.exec(body))) return { style: 'short', level: LEVELS[m[1].toLowerCase()], message: m[2] };
  return { style: null, level: null, message: body };
}
// renderBody(style, level, message, keys): the inverse of parseBody (the factory places authored lines with it)
export function renderBody({ style, level, message, keys }) {
  const lower = level.toLowerCase(), e = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  switch (style) {
    case 'bracket': return `[${level}] ${message}`;
    case 'kv': return `level=${lower} msg="${e}"`;
    case 'json': return `{"${keys[0]}":"${keys[0] === 'severity' ? level : lower}","${keys[1]}":"${e}"}`;
    case 'short': return `${level[0]}: ${message}`;
    default: return `${level} ${message}`;
  }
}
const LINE = /^(L\d+) (\S+) (\S+) (.*)$/s;
const LOG_BY_TEXT = new Map();
// parseLog(logText) -> { lines: [{id, ts, source, body, style, level, message, raw}], byId: Map, index: Map }
export function parseLog(logText) {
  if (typeof logText !== 'string') throw fail('KIT_TASK', 'incident kit: the log must be a string');
  const hit = LOG_BY_TEXT.get(logText);
  if (hit) return hit;
  const lines = [];
  for (const raw of logText.split('\n')) {
    if (!raw) continue;
    const m = LINE.exec(raw);
    if (!m) throw fail('KIT_TASK', `incident kit: not a log line: ${raw.slice(0, 80)}`);
    lines.push({ id: m[1], ts: m[2], source: m[3], body: m[4], ...parseBody(m[4]), raw });
  }
  const out = { lines, byId: new Map(lines.map((l, i) => [l.id, l])), index: new Map(lines.map((l, i) => [l.id, i])) };
  if (LOG_BY_TEXT.size > 8) LOG_BY_TEXT.clear();
  LOG_BY_TEXT.set(logText, out);
  return out;
}
export const lineText = l => `${l.ts} ${l.source} ${l.body}`;     // a line as the model reads it (no line id)
const ISO_MS = ts => Date.parse(ts);

// the service a source column names: a pod (`<service>-<suffix>`), a data-store pod, or the legacy application name
export function serviceOfSource(sys, source) {
  if (sys.byName.has(source)) return source;
  const m = /^([a-z][a-z0-9-]*)-([0-9a-f]{5}|\d+)$/.exec(source);
  if (m && sys.byName.has(m[1])) return m[1];
  const leg = sys.services.find(s => s.legacy === source);
  return leg ? leg.name : null;
}
export const isShadowSource = (sys, source) => sys.shadowPods.includes(source);

// ---- references and handles ---------------------------------------------------------------------------------
const REF_MEMO = new WeakMap();
// One regex over every way a line names a service or a provider: longest first. kinds: 'svc' (service) or 'ext'.
function referenceRegex(sys) {
  if (REF_MEMO.has(sys)) return REF_MEMO.get(sys);
  const entries = [];
  for (const a of sys.aliases) entries.push({ text: a.alias, svc: a.service, kind: 'svc', ref: a.kind });
  for (const p of sys.providers) { entries.push({ text: p.host, ext: p.name, kind: 'ext' }); entries.push({ text: p.name, ext: p.name, kind: 'ext' }); }
  entries.sort((x, y) => y.text.length - x.text.length || (x.text < y.text ? -1 : 1));
  const byText = new Map(); for (const e of entries) if (!byText.has(e.text)) byText.set(e.text, e);
  const re = new RegExp(`(?<![A-Za-z0-9_-])(?:${[...byText.keys()].map(esc).join('|')})(?:-(?:[0-9a-f]{5}|\\d+)(?![A-Za-z0-9_-])|(?![A-Za-z0-9_]))`, 'g');
  const out = { re, byText };
  REF_MEMO.set(sys, out);
  return out;
}
// references in a text, in order of position: [{index, text, kind, svc|ext}]
export function referencesIn(sys, str) {
  const { re, byText } = referenceRegex(sys), out = [];
  for (const m of String(str).matchAll(re)) {
    let t = m[0], e = byText.get(t);
    let pod = null;
    if (!e) { const p = /^(.*)-([0-9a-f]{5}|\d+)$/.exec(t); if (p && byText.get(p[1])) { e = byText.get(p[1]); pod = p[2]; t = p[1]; } }
    if (e) out.push({ index: m.index, length: m[0].length, text: t, pod, ...e });
  }
  return out;
}
const letters = n => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(97 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// Replace every reference in the given texts by handles. `subject` is the canonical name whose lines are shown: it
// gets `svc-a`. Returns { texts, handleOf: Map(service -> handle), extOf }.
export function applyHandles(sys, texts, subject) {
  const handleOf = new Map(), extOf = new Map();
  const handle = svc => { if (!handleOf.has(svc)) handleOf.set(svc, `svc-${letters(handleOf.size)}`); return handleOf.get(svc); };
  if (subject) handle(subject);
  const ext = name => { if (!extOf.has(name)) extOf.set(name, `ext-${letters(extOf.size)}`); return extOf.get(name); };
  const out = texts.map(t => {
    const refs = referencesIn(sys, t);
    let res = '', at = 0;
    for (const r of refs) {
      res += t.slice(at, r.index);
      res += r.kind === 'ext' ? ext(r.ext) : `${handle(r.svc)}${r.pod ? `-${r.pod}` : ''}`;
      at = r.index + r.length;
    }
    return res + t.slice(at);
  });
  return { texts: out, handleOf, extOf };
}

// ---- window selection -------------------------------------------------------------------------------------------
// The service's own lines with from <= ts <= to (shadow pods excluded: "their lines are neither the fault nor an
// impact", the task statement), the first `maxLines`, within a character budget.
export function selectLines(task, slots, defaults) {
  const sys = parseSystem(text(task, 'system')), log = parseLog(text(task, 'log'));
  const service = need(slots.service, 'slots.service');
  if (!sys.byName.has(service)) throw fail('KIT_SLOT', `incident kit: ${service} is not a service of this task`);
  let pick;
  if (Array.isArray(slots.ids)) {
    pick = slots.ids.map(id => log.byId.get(id) ?? (() => { throw fail('KIT_SLOT', `incident kit: no line ${id}`); })());
    for (const l of pick) if (serviceOfSource(sys, l.source) !== service) throw fail('KIT_SLOT', `incident kit: line ${l.id} is not a line of ${service}`);
  } else {
    const from = ISO_MS(need(slots.from, 'slots.from')), to = ISO_MS(need(slots.to, 'slots.to'));
    if (!(from <= to)) throw fail('KIT_SLOT', 'incident kit: slots.from is after slots.to');
    pick = log.lines.filter(l => { const t = ISO_MS(l.ts); return t >= from && t <= to && serviceOfSource(sys, l.source) === service && !isShadowSource(sys, l.source); });
  }
  // never more than 40 lines: the whole-service-window variant (about 25.7K real tokens) does not exist (§1.2 I1)
  const maxLines = Math.min(MAX_LINES, Number.isInteger(slots.maxLines) ? slots.maxLines : defaults.lines);
  const maxTokens = Number.isInteger(slots.maxTokens) ? slots.maxTokens : defaults.tokens;
  if (slots.triage && !Array.isArray(slots.ids)) pick = triage(pick, maxLines);
  const chosen = [];
  let tokens = 0;
  for (const l of pick) {
    if (chosen.length >= maxLines) break;
    const n = estimateTokens(lineText(l)) + 1;
    if (chosen.length && tokens + n > maxTokens) break;
    chosen.push(l); tokens += n;
  }
  return { sys, log, service, lines: chosen, window: pick };
}

// A triage view of a window: its WARN and ERROR lines first, then the earliest of the others up to `n` lines, in time order.
// (A service's problems are in its warnings; a fault announced at INFO level, such as a rollout, is at the window's start.)
export function triage(lines, n) {
  const loud = lines.filter(l => l.level === 'WARN' || l.level === 'ERROR');
  const take = new Set(loud.slice(0, n));
  for (const l of lines) { if (take.size >= n) break; take.add(l); }
  return lines.filter(l => take.has(l));
}
function windowState(task, slots, defaults) {
  const { sys, service, lines } = selectLines(task, slots, defaults);
  const from = slots.from ?? lines[0]?.ts, to = slots.to ?? lines.at(-1)?.ts;
  if (!lines.length) throw fail('KIT_EMPTY', `incident kit: ${service} wrote no line in the window`);
  const raw = lines.map(lineText);
  if (slots.handles === false) return { service, window: `${from} to ${to}`, log_lines: raw };
  const { texts } = applyHandles(sys, [service, ...raw], service);
  return { service: texts[0], window: `${from} to ${to}`, log_lines: texts.slice(1) };
}

// ---- X5: the service map as the model reads it ------------------------------------------------------------------------
export function edgeText(task, edge, { notes = null } = {}) {
  const sys = parseSystem(text(task, 'system'));
  if (Array.isArray(notes)) notes = notes.map(i => { if (!Number.isInteger(i) || i < 0 || i >= sys.notes.length) throw fail('KIT_SLOT', 'incident kit: slots.notes must index the notes section'); return sys.notes[i]; });
  const a = need(edge?.from, 'slots.edge.from'), b = need(edge?.to, 'slots.edge.to');
  for (const n of [a, b]) if (!sys.byName.has(n)) throw fail('KIT_SLOT', `incident kit: ${n} is not a service of this task`);
  const rows = [sys.byName.get(a).row, sys.byName.get(b).row];
  const overview = [sys.overview[a], sys.overview[b]].filter(Boolean);
  return [
    'Service map excerpt',
    ...overview, '',
    '| Service | Team | Tier | Calls | Other names in logs |', '|---|---|---|---|---|', ...rows, '',
    'Notes and recent changes:', ...(notes ?? sys.notes).map(n => `- ${n}`),
  ].join('\n');
}

// ---- X2: references to services and the alias-table rows that settle them ----------------------------------------------------
// the service a reference names: an alias of the table, or a pod (`<service>-<suffix>`)
export function resolveReference(sys, ref) {
  const hit = sys.aliases.find(x => x.alias === ref);
  if (hit) return sys.byName.get(hit.service);
  const m = /^([a-z][a-z0-9-]*)-([0-9a-f]{5}|\d+)$/.exec(ref);
  return m && sys.byName.has(m[1]) ? sys.byName.get(m[1]) : null;
}
export function aliasContext(task, a, b) {
  const sys = parseSystem(text(task, 'system'));
  const rows = [], addr = [];
  for (const ref of [a, b]) {
    const svc = resolveReference(sys, ref);
    if (svc && !rows.includes(svc.row)) rows.push(svc.row);
    if (svc?.ip && !addr.some(l => l.startsWith(`- ${svc.name}:`))) addr.push(`- ${svc.name}: ${svc.ip}:${svc.port}`);
  }
  const header = ['| Service | Team | Tier | Calls | Other names in logs |', '|---|---|---|---|---|'];
  const prose = sys.notes.filter(n => [a, b].some(r => new RegExp(`'${esc(r)}'`).test(n)));
  return [...header, ...rows, ...(addr.length ? ['', 'Service addresses:', ...addr] : []), ...(prose.length ? ['', 'Notes:', ...prose.map(n => `- ${n}`)] : []),
    ...(rows.length ? [] : ['', '(neither reference appears in the service map)'])].join('\n');
}

// ---- the state of each port -------------------------------------------------------------------------------------------
export function buildState(task, slots = {}, port = slots.port) {
  switch (port) {
    case 'I1': return windowState(task, slots, slots.long ? LINE_BUDGET.I1long : LINE_BUDGET.I1);
    case 'I3': return windowState(task, slots, LINE_BUDGET.I3);
    case 'I2': {
      const sys = parseSystem(text(task, 'system')), log = parseLog(text(task, 'log'));
      const l = log.byId.get(need(slots.line, 'slots.line'));
      if (!l) throw fail('KIT_SLOT', `incident kit: no line ${slots.line}`);
      const svc = serviceOfSource(sys, l.source);
      if (!svc) throw fail('KIT_SLOT', `incident kit: the source ${l.source} of ${l.id} is not a service of this task`);
      return { line: lineText(l), emitting_service: svc, calls: [...sys.byName.get(svc).calls] };
    }
    case 'X1': {
      if (slots.text !== undefined && slots.line === undefined) return { source_kind: KIT_SOURCE_KIND, text: need(slots.text, 'slots.text') };
      const log = parseLog(text(task, 'log'));
      const l = log.byId.get(need(slots.line, 'slots.line'));
      if (!l) throw fail('KIT_SLOT', `incident kit: no line ${slots.line}`);
      const n = Number.isInteger(slots.context) ? slots.context : 0;
      if (!n) return { source_kind: KIT_SOURCE_KIND, text: lineText(l) };
      const i = log.index.get(l.id), lo = Math.max(0, i - n), hi = Math.min(log.lines.length, i + n + 1);
      return { source_kind: KIT_SOURCE_KIND, text: log.lines.slice(lo, hi).map(lineText).join('\n') };
    }
    case 'X7': {
      const log = parseLog(text(task, 'log'));
      const l = log.byId.get(need(slots.line, 'slots.line'));
      if (!l) throw fail('KIT_SLOT', `incident kit: no line ${slots.line}`);
      return { item: lineText(l) };
    }
    case 'X5': return { source_text: edgeText(task, slots.edge, { notes: slots.notes ?? null }) };
    case 'X2': {
      const a = need(slots.a, 'slots.a'), b = need(slots.b, 'slots.b');
      return { a, b, context: aliasContext(task, a, b) };
    }
    case 'X4': {
      const sys = parseSystem(text(task, 'system'));
      if (slots.ticket) {
        const guess = text(task, 'ticket').split('\n').find(l => /first guess is/.test(l));
        if (!guess) throw fail('KIT_SLOT', 'incident kit: the ticket holds no guess');
        return { statement: guess, source: { doc_type: 'incident ticket', date: 'undated', author_role: 'on-call engineer' }, related_statements: [] };
      }
      const i = slots.note;
      if (!Number.isInteger(i) || i < 0 || i >= sys.notes.length) throw fail('KIT_SLOT', 'incident kit: slots.note must index the notes section');
      const rel = sys.notes.filter((n, j) => j !== i && relatedNote(sys, sys.notes[i], n)).slice(0, 2);
      return { statement: sys.notes[i], source: { doc_type: 'service map note', date: monthOf(sys.notes[i]) ?? 'undated', author_role: 'platform team' }, related_statements: rel };
    }
    default: throw fail('KIT_PORT', `incident kit: no state for port ${port}`);
  }
}
const MONTH = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
export const monthOf = note => MONTH.exec(note)?.[1] ?? null;
// two notes are about one topic when they name the same pair of services (by name)
function relatedNote(sys, a, b) {
  const pair = n => { const f = sys.names.filter(x => new RegExp(`(?<![A-Za-z0-9_-])${esc(x)}(?![A-Za-z0-9_-])`).test(n.replace(POD, ' '))); return f; };
  const pa = pair(a), pb = pair(b);
  return pa.length >= 2 && pa.length === pb.length && pa.every(x => pb.includes(x));
}

const { contracts: ALL } = loadSpec();
export const PORTS = Object.freeze(['I1', 'I2', 'I3', 'X1', 'X2', 'X4', 'X5', 'X7']);
const base = definePortKit({ bed: 'incident', contracts: Object.fromEntries(PORTS.map(p => [p, ALL[p]])), buildState: (task, slots) => buildState(task, slots) });

// kit.buildState(task, slots, port) and kit.request(port, task, slots, opts) pass the port to the state builder (the
// interface carries one buildState per kit; the states of this bed differ by port).
export const kit = Object.freeze({
  ...base,
  buildState: (task, slots = {}, port = slots.port) => base.buildState(task, { ...slots, port }),
  request: (port, task, slots = {}, opts = {}) => base.request(port, task, { ...slots, port }, opts),
});
