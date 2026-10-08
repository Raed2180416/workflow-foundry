// Port kit for the runbook bed (JUDGE-PROGRAM.md §1.2 Q4, X1, X3, X4, X5; §2.1, §8.4 W2).
// A kit turns a runbook task (the bed's {prompt, inputs: {ticket, runbook, inventory, releaseNotes?,
// handover?, postmortem?, changeLog?}}) and the caller's slots into the state a judgment port reads. The
// factory (experiments/kev-data/ports/runbook.mjs) and the runtime import the same functions, so a trained
// state and a served state are built by one code path.
//
// Relocated: until the C0 and P1 experiments finish this file lives in experiments/kev-data/judges/;
// it moves to src/judges/runbook.mjs afterwards with no change to the interface.
//
// A kit works on the task text only. It never imports a bed (the runtime has no frozen copy), never reads
// seed, split, difficulty or any world structure, and uses no clock or random source. Where a port needs
// the identity of a span (which comment, which document line), the caller passes it in `slots`; span ids are
// `<document>#<line>` with the 0-based line of the document text (`ticket#412`, `inventory#17`):
//   Q4  { action, effect: {kind, ...params}, observation, phrasing? }   one step of an episode (the plan's
//       expected effect is a sentence written from `effect` by `expectedEffect`; the observation comes from the
//       environment, so it is passed in)
//   X1  { span, long?, maxChars? } | { text, source_kind } | { log, context?, long? }
//   X3  { comment, authority? }                       a ticket comment
//   X5  { topic: 'version'|'max_inflight'|'slow_start'|'work_mem', comments? }
//   X4  { statement }                                 a line of a document
// and `port` selects the state shape in the aggregate kit (the per-port kits in `kits` need none).
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';

export const KIT_VERSION = 1;
export const DOC_KEYS = Object.freeze(['ticket', 'runbook', 'inventory', 'releaseNotes', 'handover', 'postmortem', 'changeLog']);
// OPS of beds/runbook/sim.mjs (a copy: a kit cannot import a bed; the test pins it against the frozen bed)
export const OPS = Object.freeze(['query', 'drain', 'undrain', 'restart', 'set_flag', 'apply_config', 'rollback_config', 'wait', 'page_human']);
const ACTION_KEYS = Object.freeze(['op', 'target', 'node', 'service', 'name', 'key', 'value', 'seconds', 'reason']);

const fail = (code, message, details) => { const e = new Error(`${code}: ${message}`); e.code = code; if (details !== undefined) e.details = details; return e; };
const need = (slots, key) => {
  if (slots?.[key] === undefined || slots[key] === null || slots[key] === '') throw fail('KIT_SLOT', `the runbook kit needs slot ${key}`);
  return slots[key];
};
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------------
// Parsing the task text (beds/runbook/render.mjs renderTicket, renderRunbook, renderInventory, ...)
const COMMENT_HEAD = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC\] (.+?) \(@([\w-]+)\):$/;
const OWNER_LINE = /^Change owner: (.+?) \(@([\w-]+)\) · Approver \(CAB\): (.+?) \(@([\w-]+)\)$/;
const REQUESTER_LINE = /^Requested by: (.+?) \(@([\w-]+)\), (.+?) team$/;
const CREATED_LINE = /^Created: (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC$/;
export const VERSION_RE = /\b\d+\.\d+\.\d+(?:-rc\d+)?\b/g;

function parseTicket(doc) {
  const L = doc.lines;
  const ownerAt = L.findIndex(l => OWNER_LINE.test(l));
  const descAt = L.indexOf('Description'), commentsAt = L.indexOf('Comments (oldest first)');
  if (ownerAt < 0 || descAt < 0 || commentsAt < 0) throw fail('KIT_TASK', 'a runbook ticket has a "Change owner ... Approver (CAB)" line, a Description and a comment thread');
  const om = OWNER_LINE.exec(L[ownerAt]), rm = REQUESTER_LINE.exec(L.find(l => REQUESTER_LINE.test(l)) ?? ''), cm = CREATED_LINE.exec(L.find(l => CREATED_LINE.test(l)) ?? '');
  let descEnd = descAt + 1;
  while (descEnd < L.length && L[descEnd] !== '' && descEnd < commentsAt) descEnd++;
  const description = [];
  for (let i = descAt + 1; i < descEnd; i++) description.push({ id: `ticket#${i}`, line: i, text: L[i] });
  const comments = [];
  for (let i = commentsAt + 1; i + 1 < L.length; i += 2) {
    const m = COMMENT_HEAD.exec(L[i]);
    if (!m) throw fail('KIT_TASK', `ticket line ${i} is not a comment header`);
    comments.push({ id: `ticket#${i + 1}`, headLine: i, line: i + 1, index: comments.length, date: m[1], time: m[2], ts: `${m[1]} ${m[2]} UTC`,
      name: m[3], handle: m[4], text: L[i + 1].replace(/^ {2}/, '') });
  }
  return {
    title: L[0], titleLine: 0, ownerLine: ownerAt, ownerName: om[1], ownerHandle: om[2], approverName: om[3], approverHandle: om[4],
    requesterName: rm?.[1] ?? null, requesterHandle: rm?.[2] ?? null, created: cm?.[1] ?? null,
    descriptionStart: descAt, descriptionEnd: descEnd, description, commentsAt, comments,
  };
}

// the runbook's sections: every line gets its section heading and, where it has one, its kind
function parseRunbook(doc) {
  const out = []; let section = '';
  doc.lines.forEach((text, line) => {
    if (/^## /.test(text)) section = text.slice(3);
    let kind = 'text';
    if (/^Step \d+\. /.test(text)) kind = 'runbook step';
    else if (/^Safety rules/.test(section) && /^\d+\. /.test(text)) kind = 'runbook safety rule';
    else if (/^Legacy notes/.test(section) && /^- /.test(text)) kind = 'runbook legacy note';
    else if (/^Field tips/.test(section) && /^- /.test(text)) kind = 'runbook field tip';
    else if (/^Troubleshooting/.test(section) && /^\| /.test(text) && !/^\| (?:What you see|---)/.test(text)) kind = 'runbook troubleshooting row';
    out.push({ id: `runbook#${line}`, line, text, section, kind });
  });
  return out;
}
function parseInventory(doc) {
  const rows = [];
  doc.lines.forEach((text, line) => {
    if (/^#|^host \| /.test(text) || !text.trim()) return;
    const c = text.split(' | ');
    if (c.length < 10) return;
    rows.push({ id: `inventory#${line}`, line, text, host: c[0].trim(), aka: c[1].trim(), site: c[2].trim(), role: c[3].trim(), services: c[4].trim(), pool: c[5].trim(), rack: c[6].trim(), os: c[7], team: c[8], patched: c[9], notes: (c[10] ?? '').trim() });
  });
  return rows;
}
function parseDated(doc, key, rx) {
  const out = [];
  doc.lines.forEach((text, line) => { const m = rx.exec(text); if (m) out.push({ id: `${key}#${line}`, line, text, date: m[1] }); });
  return out;
}
function parseSectioned(doc, key) {
  const out = []; let section = '';
  doc.lines.forEach((text, line) => {
    if (/^#{2,} /.test(text)) section = text.replace(/^#+ /, '');
    out.push({ id: `${key}#${line}`, line, text, section });
  });
  return out;
}

export function parseTask(task) {
  const inputs = task?.inputs;
  if (!inputs || typeof inputs !== 'object' || typeof inputs.ticket !== 'string' || typeof inputs.runbook !== 'string' || typeof inputs.inventory !== 'string') throw fail('KIT_TASK', 'a runbook task has inputs.ticket, inputs.runbook and inputs.inventory');
  const docs = {};
  for (const key of DOC_KEYS) if (typeof inputs[key] === 'string') docs[key] = { key, text: inputs[key], lines: inputs[key].split('\n') };
  const ticket = parseTicket(docs.ticket);
  const inventory = parseInventory(docs.inventory);
  const exported = /^# exported by cmdb-sync (\d{4}-\d{2}-\d{2})/m.exec(docs.inventory.text)?.[1] ?? null;
  const runbook = parseRunbook(docs.runbook);
  const changeLog = docs.changeLog ? parseDated(docs.changeLog, 'changeLog', /^(\d{4}-\d{2}-\d{2})  (.+)$/) : [];
  const handover = docs.handover ? parseSectioned(docs.handover, 'handover') : [];
  const handoverDate = docs.handover ? /^# On-call handover — .+? — (\d{4}-\d{2}-\d{2})/.exec(docs.handover.lines[0])?.[1] ?? null : null;
  const releaseNotes = docs.releaseNotes ? parseSectioned(docs.releaseNotes, 'releaseNotes') : [];
  const postmortem = docs.postmortem ? parseSectioned(docs.postmortem, 'postmortem') : [];
  const pmDate = docs.postmortem ? /\((\d{4}-\d{2}-\d{2})\)/.exec(docs.postmortem.lines[0])?.[1] ?? null : null;
  const commentById = Object.fromEntries(ticket.comments.map(c => [c.id, c]));
  const hostIds = new Set(inventory.map(r => r.host));
  return { docs, ticket, comments: ticket.comments, commentById, inventory, exported, runbook, changeLog, handover, handoverDate, releaseNotes, postmortem, pmDate, hostIds };
}
const parsedCache = new WeakMap();
export function parsed(task) {
  let p = parsedCache.get(task);
  if (!p) { p = parseTask(task); parsedCache.set(task, p); }
  return p;
}

// who a handle is on this ticket
export function roleOfHandle(p, handle) {
  const t = p.ticket;
  if (handle === t.ownerHandle) return 'change owner';
  if (handle === t.approverHandle) return 'approver';
  if (handle === t.requesterHandle) return 'requester';
  if (handle === 'deploy-bot') return 'automation bot';
  return 'engineer';
}
export const isAuthorised = (p, handle) => handle === p.ticket.ownerHandle || handle === p.ticket.approverHandle;

// ---------------------------------------------------------------------------------------------
// Thread context for X3: the comments a comment answers or reverses (at most 2, oldest first).
// Rules, in order: the latest earlier comment of each @handle the comment mentions; earlier comments of the
// same author that share a topic (a config key, a version, the window, a node); and for a comment that points
// back ("my earlier comment", "scratch my ...", "forget what I said") the author's latest earlier comments.
const KEY_TOPICS = [['max_inflight', /max_inflight/i], ['slow_start', /slow[_ ]start/i], ['work_mem', /work_mem/i], ['window', /\bwindow\b|\bstart time\b|\bbegin\b/i]];
export function topicTokens(text) {
  const out = new Set();
  for (const [name, re] of KEY_TOPICS) if (re.test(text)) out.add(name);
  for (const v of text.match(VERSION_RE) ?? []) out.add(`v:${v}`);
  return out;
}
const POINTS_BACK = /\bearlier comment\b|\bscratch my\b|\bforget what i said\b|\bdisregard my\b|\bi'll post here\b/i;
export function threadContext(p, c, { max = 2 } = {}) {
  const earlier = p.comments.filter(x => x.index < c.index);
  const picked = [];
  for (const h of [...c.text.matchAll(/@([\w-]+)/g)].map(m => m[1])) {
    if (h === c.handle || picked.length >= max) continue;
    const hit = [...earlier].reverse().find(x => x.handle === h);
    if (hit && !picked.includes(hit)) picked.push(hit);
  }
  const mine = topicTokens(c.text);
  if (mine.size) for (const x of [...earlier].reverse()) {
    if (picked.length >= max) break;
    if (picked.includes(x) || x.handle !== c.handle) continue;
    if ([...topicTokens(x.text)].some(t => mine.has(t))) picked.push(x);
  }
  if (!picked.length && POINTS_BACK.test(c.text)) {
    for (const x of [...earlier].reverse()) { if (picked.length >= max) break; if (x.handle === c.handle) picked.push(x); }
  }
  return picked.sort((a, b) => a.index - b.index).slice(-max);
}

// ---------------------------------------------------------------------------------------------
// X3 speech_act: { message, author, fact_owner, thread_context }
//   author       the comment's handle ("@ambeki-cab" for a look-alike account)
//   fact_owner   the handle of the change owner named in the ticket header: the parameters of the change are
//                the owner's facts; whether an author may change them is decided in code (isAuthorised)
export function buildX3(task, slots) {
  const p = parsed(task), c = p.commentById[need(slots, 'comment')];
  if (!c) throw fail('KIT_SLOT', `no ticket comment ${slots.comment}`);
  const context = threadContext(p, c).map(x => `@${x.handle}: ${x.text}`);
  // slots.authority === false leaves author and fact_owner out (authority stays in code)
  if (slots.authority === false) return { message: c.text, thread_context: context };
  return { message: c.text, author: `@${slots.author ?? c.handle}`, fact_owner: `@${slots.fact_owner ?? p.ticket.ownerHandle}`, thread_context: context };
}

// ---------------------------------------------------------------------------------------------
// X1 injected_instruction: { source_kind, text }
export const SOURCE_KINDS = Object.freeze(['ticket comment', 'ticket description line', 'inventory row', 'change log entry', 'handover note', 'release notes line',
  'postmortem line', 'runbook step', 'runbook safety rule', 'runbook legacy note', 'runbook field tip', 'runbook troubleshooting row', 'log line', 'node status output', 'text']);
export function spanInfo(p, id) {
  const [key, ln] = String(id).split('#'), line = Number(ln);
  const doc = p.docs[key];
  if (!doc || !Number.isInteger(line) || line < 0 || line >= doc.lines.length) throw fail('KIT_SLOT', `no span ${id}`);
  const text = doc.lines[line];
  if (key === 'ticket') {
    const c = p.commentById[id];
    if (c) return { id, doc: key, line, text: c.text, sourceKind: 'ticket comment', comment: c };
    if (line >= p.ticket.descriptionStart + 1 && line < p.ticket.descriptionEnd) return { id, doc: key, line, text, sourceKind: 'ticket description line' };
    return { id, doc: key, line, text, sourceKind: 'text' };
  }
  if (key === 'runbook') { const r = p.runbook[line]; return { id, doc: key, line, text, sourceKind: r.kind === 'text' ? 'text' : r.kind, section: r.section }; }
  if (key === 'inventory') { const r = p.inventory.find(x => x.line === line); return { id, doc: key, line, text, sourceKind: r ? 'inventory row' : 'text', row: r }; }
  if (key === 'changeLog') { const r = p.changeLog.find(x => x.line === line); return { id, doc: key, line, text, sourceKind: r ? 'change log entry' : 'text', date: r?.date }; }
  const kindOf = { handover: 'handover note', releaseNotes: 'release notes line', postmortem: 'postmortem line' }[key];
  const sec = (p[key] ?? [])[line]?.section ?? '';
  return { id, doc: key, line, text, sourceKind: /^- /.test(text) ? kindOf : 'text', section: sec };
}
// a window of consecutive lines around line i, at most maxChars (the long variant: the span in its document)
export function windowLines(lines, i, maxChars = 4000) {
  let lo = i, hi = i, size = lines[i].length, turn = 0;
  for (;;) {
    const canLo = lo > 0 && size + lines[lo - 1].length + 1 <= maxChars, canHi = hi < lines.length - 1 && size + lines[hi + 1].length + 1 <= maxChars;
    if (!canLo && !canHi) break;
    if (canLo && (turn % 2 === 0 || !canHi)) size += lines[--lo].length + 1; else size += lines[++hi].length + 1;
    turn++;
  }
  return { text: lines.slice(lo, hi + 1).join('\n'), from: lo, to: hi };
}
const WINDOW_KIND = Object.freeze({ ticket: 'ticket', inventory: 'inventory', changeLog: 'change log', runbook: 'runbook', handover: 'handover', releaseNotes: 'release notes', postmortem: 'postmortem' });
export function buildX1(task, slots) {
  if (typeof slots?.log === 'string') {
    // a log line of a node status observation (the environment's output; not part of the task text)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z (?:INFO|WARN|ERROR|DEBUG)\b/.test(slots.log)) throw fail('KIT_SLOT', 'a log line starts with an ISO timestamp and a level');
    if (slots.long) {
      const ctx = need(slots, 'context');
      if (typeof ctx !== 'string' || !ctx.includes(slots.log) || ctx.length > 6000) throw fail('KIT_SLOT', 'the log context is the status output that holds the line (at most 6000 characters)');
      return { source_kind: 'node status output', text: ctx };
    }
    return { source_kind: 'log line', text: slots.log };
  }
  if (typeof slots?.text === 'string') {
    const kind = need(slots, 'source_kind');
    if (!SOURCE_KINDS.includes(kind)) throw fail('KIT_SLOT', `source_kind ${kind} is not one of ${SOURCE_KINDS.join(', ')}`);
    return { source_kind: kind, text: slots.text };
  }
  const p = parsed(task), info = spanInfo(p, need(slots, 'span'));
  if (!slots.long) return { source_kind: info.sourceKind, text: info.text };
  const doc = p.docs[info.doc], w = windowLines(doc.lines, info.line, slots.maxChars ?? 4000);
  return { source_kind: WINDOW_KIND[info.doc] ?? 'text', text: w.text };
}

// ---------------------------------------------------------------------------------------------
// X5 precondition_holds: { source_text } = the ticket's title and owner/approver line, its Description, and the
// comments that can settle one parameter: every comment of the change owner or the approver (authority is
// in the header) and every other comment that mentions the topic.
export const TOPICS = Object.freeze({
  version: /\b\d+\.\d+\.\d+(?:-rc\d+)?\b|\brelease\b|\bbuild\b|\bpatch\b|\bversion\b/i,
  max_inflight: /max_inflight/i,
  slow_start: /slow[_ ]start/i,
  work_mem: /work_mem/i,
});
export function selectComments(p, topic) {
  const re = TOPICS[topic];
  if (!re) throw fail('KIT_SLOT', `unknown X5 topic ${topic} (one of ${Object.keys(TOPICS).join(', ')})`);
  return p.comments.filter(c => isAuthorised(p, c.handle) || re.test(c.text));
}
export function buildX5(task, slots) {
  const p = parsed(task), topic = need(slots, 'topic'), t = p.ticket, L = p.docs.ticket.lines;
  const ids = slots.comments ?? selectComments(p, topic).map(c => c.id);
  const picked = ids.map(id => p.commentById[id]);
  if (picked.some(c => !c)) throw fail('KIT_SLOT', 'X5 comments name ticket comments');
  picked.sort((a, b) => a.index - b.index);
  const parts = [L[t.titleLine], L[t.ownerLine], ...L.slice(t.descriptionStart, t.descriptionEnd), 'Comments (oldest first)'];
  for (const c of picked) parts.push(L[c.headLine], L[c.line]);
  const text = parts.join('\n');
  if (text.length > 12000) throw fail('KIT_SLOT', 'the X5 window exceeds 12000 characters');
  return { source_text: text };
}

// ---------------------------------------------------------------------------------------------
// X4 statement_standing: { statement, source: {doc_type, date, author_role}, related_statements }
export const DOC_TYPE = Object.freeze({
  'ticket comment': 'change ticket comment', 'ticket description line': 'change ticket description', 'inventory row': 'CMDB export row', 'change log entry': 'change log entry',
  'handover note': 'on-call handover note', 'release notes line': 'vendor release notes line', 'postmortem line': 'postmortem line', 'runbook step': 'runbook procedure step',
  'runbook safety rule': 'runbook safety rule', 'runbook legacy note': 'runbook legacy note', 'runbook field tip': 'runbook field tip', 'runbook troubleshooting row': 'runbook troubleshooting row', text: 'document text',
});
const ROLE_OF_DOC = { inventory: 'cmdb-sync export', runbook: 'platform SRE', handover: 'outgoing on-call engineer', releaseNotes: 'vendor', changeLog: 'change log', postmortem: 'incident review' };
const topicLines = (p, re, skip) => {
  const out = [];
  for (const [key, list] of [['changeLog', p.changeLog], ['handover', p.handover]]) for (const x of list) if (x.id !== skip && re.test(x.text)) out.push({ id: x.id, text: x.text, date: x.date ?? p.handoverDate });
  for (const c of p.comments) if (c.id !== skip && re.test(c.text)) out.push({ id: c.id, text: `@${c.handle}: ${c.text}`, date: c.date });
  return out;
};
export function relatedStatements(p, info, { max = 2 } = {}) {
  if (info.comment) {
    const c = info.comment, mine = topicTokens(c.text), out = [];
    const linked = p.comments.filter(x => x.index !== c.index && (
      (new RegExp(`@${escapeRe(c.handle)}\\b`).test(x.text)) || (new RegExp(`@${escapeRe(x.handle)}\\b`).test(c.text)) ||
      (x.handle === c.handle && mine.size && [...topicTokens(x.text)].some(t => mine.has(t)))));
    // the closest comments in the thread (by position), later ones first when they reverse this one
    linked.sort((a, b) => Math.abs(a.index - c.index) - Math.abs(b.index - c.index));
    for (const x of linked.slice(0, max)) out.push(x);
    return out.sort((a, b) => a.index - b.index).map(x => `[${x.ts}] @${x.handle}: ${x.text}`);
  }
  if (info.row && /role: (?:primary|replica)/.test(info.row.notes)) {
    const cluster = /cluster (\S+?);/.exec(info.row.notes)?.[1];
    if (!cluster) return [];
    return topicLines(p, new RegExp(`${escapeRe(cluster)}\\b.*(?:failover|swapped|roles?\\b)`, 'i'), info.id).slice(0, max).map(x => `[${x.date ?? 'undated'}] ${x.text}`);
  }
  if (info.doc === 'releaseNotes' && /max_inflight/.test(info.text)) {
    const d = p.ticket.description.find(x => /max_inflight/.test(x.text));
    return d ? [`[${p.ticket.created}] ${d.text}`] : [];
  }
  return [];
}
export function statementSource(p, info) {
  if (info.comment) return { doc_type: DOC_TYPE[info.sourceKind], date: info.comment.date, author_role: roleOfHandle(p, info.comment.handle) };
  const date = info.doc === 'ticket' ? p.ticket.created : info.doc === 'inventory' ? p.exported : info.doc === 'changeLog' ? info.date : info.doc === 'handover' ? p.handoverDate : info.doc === 'postmortem' ? p.pmDate : null;
  return { doc_type: DOC_TYPE[info.sourceKind] ?? DOC_TYPE.text, date: date ?? 'undated', author_role: info.doc === 'ticket' ? roleOfHandle(p, p.ticket.requesterHandle ?? '') : (ROLE_OF_DOC[info.doc] ?? 'unknown') };
}
export function buildX4(task, slots) {
  const p = parsed(task), info = spanInfo(p, need(slots, 'statement'));
  return { statement: info.text, source: statementSource(p, info), related_statements: relatedStatements(p, info) };
}

// ---------------------------------------------------------------------------------------------
// Q4 expectation_met: { action, expected_effect, observation }
// The plan's expected effect is one indicative sentence written from a small effect description. Each effect has
// several cores and several leads; core x lead is a phrasing (the factory samples one per record, a runtime node
// uses phrasing 0). The sentence names no outcome of the check: it is what the plan expects, whatever happens.
const num = x => String(x);
export const LEADS = Object.freeze(['', 'the plan expects that ', 'as planned, ', 'at this step, ', 'per the runbook, ', 'by design, ', 'in this change, ', 'once the action is done, ']);
const on = v => (v === true || v === 'true' ? 'on' : 'off');
export const EFFECTS = Object.freeze({
  restart: { params: ['service', 'node'], cores: [
    e => `${e.service} restarts on ${e.node} and the process comes back up`,
    e => `the restart of ${e.service} on ${e.node} succeeds`,
    e => `${e.node} accepts the ${e.service} restart and starts the process`,
    e => `${e.service} is running again on ${e.node} after the restart`,
    e => `restarting ${e.service} on ${e.node} completes without an error`,
    e => `${e.service} on ${e.node} restarts cleanly`,
    e => `the ${e.service} restart on ${e.node} goes through`,
    e => `${e.node} restarts ${e.service} and reports the process as started`,
  ] },
  apply: { params: ['key', 'value'], cores: [
    e => `the config store applies ${e.key} = ${e.value}`,
    e => `${e.key} is set to ${e.value}`,
    e => `the config store accepts ${e.value} for ${e.key}`,
    e => `applying ${e.value} to ${e.key} succeeds and the old and new values are reported`,
    e => `${e.key} takes the value ${e.value}`,
    e => `the change of ${e.key} to ${e.value} is stored`,
    e => `${e.key} becomes ${e.value}`,
    e => `apply_config writes ${e.value} to ${e.key}`,
  ] },
  'node-verify': { params: ['node', 'service', 'version'], cores: [
    e => `${e.node} reports ${e.service} ${e.version} with health=ok`,
    e => `${e.node} runs build ${e.version} and the service is healthy`,
    e => `${e.service} on ${e.node} is on ${e.version} and reads health=ok`,
    e => `${e.node} shows version ${e.version} and health ok after the restart`,
    e => `${e.node} is back on ${e.version} with a healthy service`,
    e => `the restarted node ${e.node} serves ${e.version} in good health`,
    e => `after its restart ${e.node} reports version ${e.version} and is healthy`,
    e => `the status of ${e.node} reads version ${e.version}, health ok`,
  ] },
  lag: { params: ['limit'], cores: [
    e => `replication lag is at or below ${num(e.limit)} s`,
    e => `the replica is within ${num(e.limit)} seconds of the primary`,
    e => `lag on the replica does not exceed ${num(e.limit)} s`,
    e => `replication lag is at most ${num(e.limit)} s`,
    e => `the replica has caught up to ${num(e.limit)} s or less`,
    e => `replica lag reads ${num(e.limit)} s or lower`,
    e => `the replication delay is no more than ${num(e.limit)} seconds`,
    e => `the replica lags the primary by ${num(e.limit)} s at most`,
  ] },
  'error-rate': { params: ['service', 'limit'], cores: [
    e => `the error rate of ${e.service} stays at or below ${num(e.limit)}%`,
    e => `${e.service} shows no more than ${num(e.limit)}% errors`,
    e => `error_rate for ${e.service} does not exceed ${num(e.limit)}%`,
    e => `the error rate for ${e.service} is ${num(e.limit)}% or lower`,
    e => `${e.service} keeps its errors at ${num(e.limit)}% or less after the flag is on`,
    e => `errors on ${e.service} remain within ${num(e.limit)}%`,
    e => `no more than ${num(e.limit)}% of requests to ${e.service} fail`,
    e => `${e.service} error rate stays within the ${num(e.limit)}% limit`,
  ] },
  drain: { params: ['node', 'pool'], cores: [e => `${e.node} leaves ${e.pool} and takes no new connections`, e => `drain stops new connections to ${e.node}`, e => `${e.node} goes out of rotation in ${e.pool}`] },
  undrain: { params: ['node', 'pool'], cores: [e => `${e.node} returns to ${e.pool}`, e => `undrain puts ${e.node} back into rotation`, e => `${e.node} is serving in ${e.pool} again`] },
  flag: { params: ['name', 'value'], cores: [e => `the flag ${e.name} is switched ${on(e.value)}`, e => `${e.name} is ${on(e.value)} afterwards`, e => `set_flag turns ${e.name} ${on(e.value)}`] },
  rollback: { params: ['key'], cores: [e => `${e.key} goes back to its previous value`, e => `rollback_config restores ${e.key}`, e => `the earlier value of ${e.key} is back`] },
  // an effect about something the observation does not show (the presence-matched unknowable of Q4)
  unobserved: { params: ['subject', 'attribute'], cores: [
    e => `${e.subject} shows ${e.attribute}`, e => `${e.subject} reports ${e.attribute}`, e => `${e.subject} is confirmed to have ${e.attribute}`,
    e => `${e.subject} comes with ${e.attribute}`, e => `${e.attribute} is present on ${e.subject}`, e => `${e.subject} is found with ${e.attribute}`,
  ] },
  page: { params: [], cores: [() => 'the page reaches the on-call escalation', () => 'the on-call engineer is paged', () => 'page_human raises the incident bridge'] },
  wait: { params: ['seconds'], cores: [e => `${e.seconds} seconds pass`, e => `the clock moves ahead by ${e.seconds} s`, e => `waiting ${e.seconds} s lets time pass`] },
});
export const phrasingCount = kind => (EFFECTS[kind]?.cores.length ?? 0) * LEADS.length;
export function expectedEffect(effect, phrasing = 0) {
  const spec = EFFECTS[effect?.kind];
  if (!spec) throw fail('KIT_SLOT', `unknown effect kind ${JSON.stringify(effect?.kind)} (one of ${Object.keys(EFFECTS).join(', ')})`);
  for (const k of spec.params) if (effect[k] === undefined || effect[k] === null || effect[k] === '') throw fail('KIT_SLOT', `effect ${effect.kind} needs ${k}`);
  if (!Number.isInteger(phrasing) || phrasing < 0) throw fail('KIT_SLOT', 'phrasing is a non-negative integer');
  const p = phrasing % phrasingCount(effect.kind), n = spec.cores.length;
  return `${LEADS[Math.floor(p / n)]}${spec.cores[p % n](effect)}`;
}
export function normalizeAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || !OPS.includes(action.op)) throw fail('KIT_SLOT', `an action is an object with op in ${OPS.join(', ')}`);
  const out = {};
  for (const k of ACTION_KEYS) if (action[k] !== undefined) out[k] = action[k];
  const extra = Object.keys(action).filter(k => !ACTION_KEYS.includes(k));
  if (extra.length) throw fail('KIT_SLOT', `unknown action keys ${extra.join(', ')}`);
  return out;
}
export function buildQ4(task, slots) {
  const p = parsed(task), action = normalizeAction(need(slots, 'action')), obs = need(slots, 'observation');
  if (typeof obs !== 'string' || obs.length > 6000) throw fail('KIT_SLOT', 'the observation is a string of at most 6000 characters');
  if (action.node !== undefined && !p.hostIds.has(action.node)) throw fail('KIT_SLOT', `the action names ${JSON.stringify(action.node)}, which is not a host of the inventory`);
  return { action, expected_effect: expectedEffect(need(slots, 'effect'), slots.phrasing ?? 0), observation: obs };
}

// ---------------------------------------------------------------------------------------------
// The kits. `kits[port]` binds one port; `kit` binds them all and reads the port from slots.port.
const { contracts: CONTRACTS } = loadSpec();
export const BUILDERS = Object.freeze({ Q4: buildQ4, X1: buildX1, X3: buildX3, X5: buildX5, X4: buildX4 });
export const kits = Object.freeze(Object.fromEntries(Object.entries(BUILDERS).map(([port, f]) => [port,
  definePortKit({ bed: 'runbook', contracts: { [port]: CONTRACTS[port] }, buildState: (task, slots) => f(task, slots) })])));
export const kit = definePortKit({
  bed: 'runbook', contracts: Object.fromEntries(Object.keys(BUILDERS).map(port => [port, CONTRACTS[port]])),
  buildState(task, slots) {
    const f = BUILDERS[slots?.port];
    if (!f) throw fail('KIT_SLOT', `the aggregate runbook kit needs slots.port (one of ${Object.keys(BUILDERS).join(', ')})`);
    return f(task, slots);
  },
});
