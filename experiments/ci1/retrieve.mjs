// CI-1 leave-one-out corpus retrieval for the A2 arm (research/ci1-20261021/DOSSIER.md §3 items 2-3, §4 item 6; PREREG-CI1.md §3).
// Pure code, $0, deterministic.
//
// Library (built once, cached outside git, hashed into the manifest):
//   - corpus exemplars: every local or fetched n8n template with no model or agent node (the builder has no model capability), each
//     reduced to its STRUCTURE: trigger kind, step kinds and operations, condition operators, effect fan-out. Names, texts, code
//     bodies, sticky notes, column names and values are never rendered (corpus text is untrusted data);
//   - pattern cards: the corpus-derived L1 catalog (experiments/library/cards/catalog.json) with a frontier-written realisation hint in
//     the Foundry IR for the patterns a sheet/mail/chat/webhook automation can use (library/pattern-hints.json).
// Retrieval for a target item (DAIL-SQL style): mask addresses, numbers, dates and quoted text in the request; BM25 over the masked
// request + workspace against each exemplar's search text (its n8n.io title and its step vocabulary, never shown to the builder);
// rerank by shape (trigger kind and effect kinds named in the request, plus a draft's tools on repair rounds); keep the top k.
// Leave-one-out: never the target, an item with the same structure hash, an item at Jaccard >= 0.6 on Weisfeiler-Lehman features, or
// (strict, the default) an item by the target's author.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflowOf } from '../../app/importers/n8n.mjs';
import { loadRaw } from './pool.mjs';
import { bm25Index } from '../library/retrieve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RETRIEVE_VERSION = 'ci1-retrieve/1';
export const POOL_FILE = '/var/tmp/foundry-work/ci1-20261021/pool.json';
export const INDEX_FILE = process.env.CI1_INDEX ?? '/var/tmp/foundry-work/ci1-20261021/retrieval-index.json';
export const CATALOG = path.join(here, '../library/cards/catalog.json');
export const HINTS = path.join(here, 'library/pattern-hints.json');
export const NEAR_JACCARD = 0.6;
const sha = t => createHash('sha256').update(t).digest('hex');
const base = n => String(n.type).split('.').pop();
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ------------------------------------------------------------------------------------------------ structure
const TRIG = { scheduleTrigger: 'schedule', cron: 'schedule', interval: 'schedule', webhook: 'webhook', formTrigger: 'form', manualTrigger: 'manual', start: 'manual',
  gmailTrigger: 'new-email', telegramTrigger: 'chat-message', googleSheetsTrigger: 'sheet-rows', emailReadImap: 'new-email' };
/** A short structural label per node: type + operation (+ resource). No names or texts. */
export function nodeLabel(n) {
  const b = base(n), p = n.parameters ?? {};
  if (TRIG[b]) return `trigger:${TRIG[b]}`;
  const op = p.operation ?? (b === 'googleSheets' ? 'read' : b === 'gmail' ? 'send' : null);
  return [b, p.resource && !['message', 'sheet'].includes(p.resource) ? p.resource : null, op].filter(Boolean).join(':');
}
const realNodes = wf => (wf.nodes ?? []).filter(n => !String(n.type).endsWith('stickyNote') && !n.disabled);
function edges(wf) {
  const names = new Set(realNodes(wf).map(n => n.name)), out = [];
  for (const [src, conns] of Object.entries(wf.connections ?? {})) {
    if (!names.has(src)) continue;
    (conns.main ?? []).forEach((list, port) => { for (const t of list ?? []) if (names.has(t.node)) out.push({ from: src, to: t.node, port }); });
  }
  return out;
}
/** Weisfeiler-Lehman labels (rounds 0..2) over node labels and directed edges: { hash, features: Set }. */
export function wl(wf, rounds = 2) {
  const nodes = realNodes(wf), E = edges(wf);
  let lab = new Map(nodes.map(n => [n.name, nodeLabel(n)]));
  const features = new Set([...lab.values()].map(l => `0:${l}`));
  for (let r = 1; r <= rounds; r++) {
    const next = new Map();
    for (const n of nodes) {
      const ins = E.filter(e => e.to === n.name).map(e => `<${e.port}${lab.get(e.from)}`).sort();
      const outs = E.filter(e => e.from === n.name).map(e => `>${e.port}${lab.get(e.to)}`).sort();
      next.set(n.name, sha(`${lab.get(n.name)}|${ins.join(',')}|${outs.join(',')}`).slice(0, 16));
    }
    lab = next;
    for (const l of lab.values()) features.add(`${r}:${l}`);
  }
  const multiset = [...lab.values()].sort();
  return { hash: sha(multiset.join(',')).slice(0, 24), features };
}
export const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; const u = a.size + b.size - i; return u ? i / u : 0; };

const EFFECT_OF = l => /^(gmail|emailSend)(:send|:reply|$)/.test(l) ? 'mail' : /^(slack|telegram|discord)/.test(l) ? 'chat' : /^respondToWebhook/.test(l) ? 'respond'
  : /^googleSheets:(append|appendOrUpdate|update|clear|delete)/.test(l) ? 'sheet-write' : null;
/** Shape of a corpus workflow: trigger kinds and effect kinds (the rerank features). */
export function shapeOfWorkflow(wf) {
  const labels = realNodes(wf).map(nodeLabel), s = new Set();
  for (const l of labels) { if (l.startsWith('trigger:')) s.add(l); const e = EFFECT_OF(l); if (e) s.add(`effect:${e}`); if (/^(code|function)/.test(l)) s.add('logic:code'); if (/^(if|switch|filter)/.test(l)) s.add('logic:branch'); if (/^(removeDuplicates|compareDatasets)/.test(l) || /lookup|appendOrUpdate/.test(l)) s.add('logic:match'); }
  return s;
}

const ROLE = { set: 'set fields', if: 'condition', switch: 'route by rules', filter: 'keep matching items', merge: 'merge streams', code: 'code (JavaScript)', function: 'code (JavaScript)', functionItem: 'code per item (JavaScript)',
  splitOut: 'split a list into items', aggregate: 'collect items into one', itemLists: 'list operation', sort: 'sort', limit: 'limit count', removeDuplicates: 'remove duplicates', dateTime: 'date maths',
  noOp: 'no-op', splitInBatches: 'loop in batches', wait: 'wait', respondToWebhook: 'answer the caller', summarize: 'summarise (group and count/sum)', renameKeys: 'rename fields',
  compareDatasets: 'compare two lists', stopAndError: 'stop with an error', httpRequest: 'call an outside API (HTTP)', markdown: 'markdown/html conversion', html: 'html extract', crypto: 'hash/crypto' };
function describe(n) {
  const b = base(n), p = n.parameters ?? {}, l = nodeLabel(n);
  if (l.startsWith('trigger:')) return `trigger (${l.slice(8)})`;
  if (b === 'googleSheets') return `sheet ${p.operation ?? 'read'}${p.operation === 'update' || p.operation === 'appendOrUpdate' ? ' (matched on a key column)' : ''}`;
  if (b === 'gmail' || b === 'emailSend') return `send e-mail${p.operation && p.operation !== 'send' ? ` (${p.operation})` : ''}`;
  if (['slack', 'telegram', 'discord'].includes(b)) return 'post a chat message';
  const ops = [];
  const visit = v => { if (Array.isArray(v)) v.forEach(visit); else if (isObj(v)) { if (isObj(v.operator) && v.operator.operation) ops.push(`${v.operator.type ?? ''}.${v.operator.operation}`.replace(/^\./, '')); Object.values(v).forEach(visit); } };
  visit(p);
  const lines = typeof (p.jsCode ?? p.functionCode) === 'string' ? String(p.jsCode ?? p.functionCode).split('\n').length : 0;
  return `${ROLE[b] ?? b}${ops.length ? ` [${[...new Set(ops)].slice(0, 4).join(', ')}${p.conditions?.combinator ? `; ${p.conditions.combinator}` : ''}]` : ''}${lines ? ` (${lines} lines)` : ''}${n.alwaysOutputData ? ' (always continues)' : ''}${n.onError && n.onError !== 'stopWorkflow' ? ` (on error: ${n.onError})` : ''}`;
}
/** Render a corpus workflow as a numbered step list: structure only. */
export function skeleton(wf) {
  const nodes = realNodes(wf), E = edges(wf);
  const start = nodes.filter(n => nodeLabel(n).startsWith('trigger:'));
  const order = [], seen = new Set(), q = [...start];
  while (q.length) { const n = q.shift(); if (seen.has(n.name)) continue; seen.add(n.name); order.push(n); for (const e of E.filter(e => e.from === n.name)) q.push(nodes.find(x => x.name === e.to)); }
  for (const n of nodes) if (!seen.has(n.name)) order.push(n);
  const num = new Map(order.map((n, i) => [n.name, i + 1]));
  return order.map((n, i) => {
    const outs = E.filter(e => e.from === n.name), ports = [...new Set(outs.map(e => e.port))];
    const next = ports.length > 1 ? ` -> ${ports.map(p => `${p === 0 && base(n) === 'if' ? 'true' : p === 1 && base(n) === 'if' ? 'false' : `out${p}`}: ${outs.filter(e => e.port === p).map(e => num.get(e.to)).join(',')}`).join('; ')}`
      : outs.length ? ` -> ${outs.map(e => num.get(e.to)).join(',')}` : '';
    return `${i + 1}. ${describe(n)}${next}`;
  }).join('\n');
}

// ------------------------------------------------------------------------------------------------ library index
/** Build (or load) the exemplar index. Each entry: { id, author, createdAt, hash, features[], shape[], text, skeleton }. */
export function buildIndex({ out = INDEX_FILE, rebuild = false } = {}) {
  if (!rebuild && existsSync(out)) return JSON.parse(readFileSync(out, 'utf8'));
  const pool = JSON.parse(readFileSync(POOL_FILE, 'utf8')).filter(r => r.parse !== false);
  const entries = [];
  for (const r of pool) {
    if (r.blockers.some(b => b.includes('langchain')) || (r.types ?? []).some(t => /openAi|anthropic|lmChat|agent/i.test(t))) continue;
    const raw = loadRaw(r.id); if (!raw) continue;
    let wf; try { wf = workflowOf(raw.doc); } catch { continue; }
    if (realNodes(wf).length < 3) continue;
    const { hash, features } = wl(wf);
    const title = String(raw.doc?.workflow?.name ?? raw.doc?.name ?? '');
    const vocab = realNodes(wf).map(n => `${nodeLabel(n).replace(/[:]/g, ' ')} ${ROLE[base(n)] ?? ''}`).join(' ');
    entries.push({ id: r.id, author: r.author ?? null, createdAt: r.createdAt ?? null, hash, features: [...features], shape: [...shapeOfWorkflow(wf)], text: `${title}\n${vocab}`, skeleton: skeleton(wf), nodes: realNodes(wf).length });
  }
  const index = { version: RETRIEVE_VERSION, built: new Date().toISOString(), entries };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(index));
  return index;
}
export const indexHash = (file = INDEX_FILE) => sha(readFileSync(file));

/** Leave-one-out exclusions for a target corpus item: { ids: Set, reasons: {id: why} }. */
export function exclusionsFor(targetId, index, { strict = true } = {}) {
  const t = index.entries.find(e => e.id === String(targetId));
  const ids = new Set([String(targetId)]), reasons = { [String(targetId)]: 'target' };
  if (!t) {
    // the target may be outside the index (it has a model node, say): compute its structure from the raw file
    const raw = loadRaw(targetId); if (!raw) return { ids, reasons, target: null };
    const s = wl(workflowOf(raw.doc));
    return exclusionsFor(targetId, { entries: [...index.entries, { id: String(targetId), author: null, hash: s.hash, features: [...s.features] }] }, { strict });
  }
  const tf = new Set(t.features);
  for (const e of index.entries) {
    if (e.id === t.id) continue;
    if (e.hash === t.hash) { ids.add(e.id); reasons[e.id] = 'same structure hash'; continue; }
    const j = jaccard(tf, new Set(e.features));
    if (j >= NEAR_JACCARD) { ids.add(e.id); reasons[e.id] = `near duplicate (Jaccard ${j.toFixed(2)})`; continue; }
    if (strict && t.author && e.author === t.author) { ids.add(e.id); reasons[e.id] = 'same author'; }
  }
  return { ids, reasons, target: t };
}

// ------------------------------------------------------------------------------------------------ query
/** Mask what identifies an item in the request (DAIL-SQL): addresses, URLs, numbers, dates, quoted text. */
export const maskRequest = text => String(text ?? '')
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ADDRESS ').replace(/https?:\/\/\S+/g, ' URL ').replace(/"[^"]{0,200}"|“[^”]{0,200}”/g, ' TEXT ')
  .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' DATE ').replace(/[$€£]?\d[\d,.]*%?/g, ' NUMBER ');
/** Shape features a request (and its workspace) names: trigger kind and the kinds of effects it asks for. */
export function shapeOfRequest(request, workspace = {}) {
  const t = String(request).toLowerCase(), s = new Set();
  const k = workspace.trigger?.kind;
  s.add(`trigger:${k === 'sheet-rows-added' ? 'sheet-rows' : k ?? 'manual'}`);
  if (/e-?mail(ed)?\b|send (?:them|him|her|me|it)\b|inbox/.test(t)) s.add('effect:mail');
  if (/slack|telegram|discord|#[a-z0-9-]+|chat|channel/.test(t)) s.add('effect:chat');
  if (/answer|respond|reply to the (?:form|caller|webhook)|waits for|json answer/.test(t)) s.add('effect:respond');
  if (/update|mark|record|append|add (?:a |the |it to )?row|log |write|save|change (?:their|its|the) status|set (?:the )?\w+ to/.test(t)) s.add('effect:sheet-write');
  if (/duplicate|already|dedup|existing|returning|again/.test(t)) s.add('logic:match');
  if (/\bif\b|only|unless|skip|when/.test(t)) s.add('logic:branch');
  return s;
}
const TOOL_SHAPE = { 'outbox.send': 'effect:mail', 'chat.post': 'effect:chat', 'reply.send': 'effect:respond', 'sheet.append': 'effect:sheet-write', 'sheet.update': 'effect:sheet-write', 'sheet.upsert': 'effect:sheet-write' };
/** Shape features of a Foundry draft (rerank on repair rounds). */
export function shapeOfDraft(workflow) {
  const s = new Set(), walk = nodes => { for (const n of nodes ?? []) { if (TOOL_SHAPE[n.tool]) s.add(TOOL_SHAPE[n.tool]); if (n.kind === 'code') s.add('logic:code'); if (n.when) s.add('logic:branch'); if (n.tool === 'sheet.upsert') s.add('logic:match'); if (n.body) walk(n.body.nodes); } };
  walk(workflow?.nodes); return s;
}

// ------------------------------------------------------------------------------------------------ patterns
export function loadPatterns() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')).patterns;
  const hints = JSON.parse(readFileSync(HINTS, 'utf8'));
  return catalog.filter(p => hints.patterns[p.id]).map(p => ({ id: p.id, name: p.name, support: p.support?.items ?? null, ...hints.patterns[p.id] }));
}

/**
 * Retrieve for one target: { exemplars: [{id, score, skeleton}], patterns: [{id, name, hint}], excluded: n, block: text }.
 * targetId: the corpus id of the item being built (for leave-one-out); draft: a Foundry draft for the rerank (repair rounds).
 */
export function retrieve({ request, workspace, targetId, index = buildIndex(), k = 3, kPatterns = 3, draft = null, strict = true, drop = [] }) {
  const ex = exclusionsFor(targetId, index, { strict });
  const pool = index.entries.filter(e => !ex.ids.has(e.id));
  const query = `${maskRequest(request)}\n${Object.keys(workspace?.sheets ?? {}).length ? 'sheet' : ''} ${workspace?.trigger?.kind ?? ''}`;
  const bm = bm25Index(pool.map(e => ({ id: e.id, text: e.text }))).score(query);
  const max = Math.max(1e-9, ...bm.values());
  const shape = shapeOfRequest(request, workspace);
  if (draft) for (const f of shapeOfDraft(draft)) shape.add(f);
  const scored = pool.map(e => { const es = new Set(e.shape); const sj = jaccard(shape, es); return { id: e.id, bm25: (bm.get(e.id) ?? 0) / max, shape: sj, score: (bm.get(e.id) ?? 0) / max + sj, e }; })
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const exemplars = scored.slice(0, k).map(s => ({ id: s.id, score: Math.round(s.score * 1000) / 1000, bm25: Math.round(s.bm25 * 1000) / 1000, shape: Math.round(s.shape * 1000) / 1000, skeleton: s.e.skeleton }));
  // patterns: BM25 over name + cue words, plus rule hits from the request shape
  const pats = loadPatterns();
  const pbm = bm25Index(pats.map(p => ({ id: p.id, text: `${p.name} ${p.cues ?? ''}` }))).score(maskRequest(request));
  const pmax = Math.max(1e-9, ...pbm.values());
  const patterns = pats.map(p => ({ p, s: (pbm.get(p.id) ?? 0) / pmax + (p.shape ?? []).filter(f => shape.has(f)).length * 0.5 }))
    .sort((a, b) => b.s - a.s || (a.p.id < b.p.id ? -1 : 1)).slice(0, kPatterns).map(({ p, s }) => ({ id: p.id, name: p.name, hint: p.hint, support: p.support, score: Math.round(s * 1000) / 1000 }))
    // leave-one-pattern-out attribution: a dropped pattern is removed from the retrieved set (not replaced by the next one)
    .filter(p => !drop.includes(p.id));
  const block = ['Patterns from similar automations (retrieved for this request from a public workflow corpus; the corpus examples are structure only, written for another platform, with every name and text removed). Use what applies to THIS request; ignore the rest.',
    ...patterns.map(p => `Pattern ${p.id} "${p.name}"${p.support ? ` (seen in ${p.support} corpus workflows)` : ''}: ${p.hint}`),
    ...exemplars.map((e, i) => `Corpus example ${i + 1} (steps; "-> n" is the next step):\n${e.skeleton}`)].join('\n\n');
  return { exemplars: exemplars.map(({ skeleton: _s, ...x }) => x), patterns: patterns.map(({ hint: _h, ...x }) => x), excluded: ex.ids.size - 1, exclusionReasons: ex.reasons, block, shape: [...shape].sort() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'build') { const i = buildIndex({ rebuild: true }); console.log(JSON.stringify({ entries: i.entries.length, hashes: new Set(i.entries.map(e => e.hash)).size, sha256: indexHash() })); }
  else console.log('usage: retrieve.mjs build');
  void args;
}
