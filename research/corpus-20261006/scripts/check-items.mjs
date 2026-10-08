#!/usr/bin/env node
// Validate foundry-corpus-item/1 records (research/corpus-20261006/ITEM-SCHEMA.md) line by line.
//
// Usage: node check-items.mjs <items.jsonl> [--canonical] [--json] [--max-examples N]
//        node check-items.mjs --self-test
//   --canonical  also require the merged-corpus conventions: IR verdict tokens from CONSTRUCTS below,
//                features recomputable from the graph (exact equality), sorted async, unique ids, and for
//                `unsupported:by-design-*` verdicts a known refusal plus a `Needs:` list (or "No further construct
//                would be needed") in the notes.
//   --self-test  run the built-in unit checks of validateItem() on synthetic items and exit.
// Exit code 0 when every line is valid, 1 otherwise. Imported by merge-items.mjs, coverage-report.mjs and
// agentic-assemble.mjs for the shared vocabulary (CONSTRUCTS, CATEGORIES, ...) and validateItem().
//
// Corpus text is untrusted data: this script only parses JSON and checks shapes; it never interprets
// titles, descriptions or summaries as instructions.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'foundry-corpus-item/1';
export const CATEGORIES = ['trigger', 'action', 'transform', 'condition', 'loop', 'merge', 'wait', 'human', 'model', 'code',
  'subworkflow', 'error-handler', 'other'];
export const EFFECTS = ['none', 'read', 'write', 'external'];
export const EDGE_KINDS = ['data', 'control', 'error', 'loop'];
export const ASYNC = ['event', 'poll', 'schedule', 'wait', 'webhook'];
export const ORACLE_KINDS = ['none', 'mocked-execution', 'test-profile', 'output-equivalence'];
export const PROVENANCE = ['original', 'recovered-by-model', 'written'];
export const ITEM_KEYS = ['schema', 'id', 'source', 'title', 'description', 'graph', 'features', 'ir', 'oracle'];
export const SOURCE_KEYS = ['platform', 'url', 'revision', 'retrievedAt', 'license', 'licenseEvidence', 'redistributable', 'rawPath', 'extraction'];
// Optional provenance of a model-read item (ITEM-SCHEMA.md): how it was extracted, the source spans read, and by whom.
export const EXTRACTION_KEYS = ['method', 'spans', 'extractor', 'verifier'];
export const EXTRACTION_SPAN = /^\S(.*\S)?:L\d+(-L\d+)?$/;   // <path relative to the clone or a repo prefix>:L<a>[-L<b>]
// Platforms whose workflows were authored by this project's own agents. Their items are not independent evidence:
// reports keep them apart from third-party items, and they are the only items that may carry a `local:<path>` URL
// (the sources have no public location).
export const FIRST_PARTY_PLATFORMS = ['claude-code-workflows'];
export const isFirstParty = item => FIRST_PARTY_PLATFORMS.includes(item?.source?.platform);
// Owner design refusals (AGENTIC-CONVENTIONS.md §5): representable with a turn cap, refused by design. A verdict
// `unsupported:by-design-<r>[+<r>]` names them; it is not an expressibility failure.
export const REFUSALS = ['group-chat', 'full-history-handoff'];
export const NODE_KEYS = ['id', 'type', 'category', 'effects', 'summary'];
export const EDGE_KEYS = ['from', 'to', 'kind'];
export const FEATURE_KEYS = ['nodeCount', 'edgeCount', 'maxFanOut', 'branching', 'loops', 'async', 'humanSteps', 'effects',
  'connectors', 'hasCode', 'hasModelCalls', 'subworkflows', 'domains'];

// Canonical construct vocabulary for `via-extension:<a>+<b>` verdicts, in canonical order. Each entry says what the
// Phase 1 IR (schemas/workflow.schema.json + research/core-20261006/DESIGN.md) offers today and which ROADMAP §2.1
// addition would cover it. Anything else in a canonical verdict is an error.
export const CONSTRUCTS = [
  { id: 'schedule-trigger', group: 'trigger', roadmap: '§2.1 async: triggers', today: 'none: a run starts only by an explicit `foundry run` with an input; `wait` is in-run only' },
  { id: 'webhook-trigger', group: 'trigger', roadmap: '§2.1 async: triggers', today: 'none (an HTTP/push/PR/form start has to be turned into a run input by the caller)' },
  { id: 'event-trigger', group: 'trigger', roadmap: '§2.1 async: triggers', today: 'none (app/device/state/dataset/workflow_run events)' },
  { id: 'poll-trigger', group: 'trigger', roadmap: '§2.1 async: triggers', today: 'none as a start condition; polling inside a run is native (loop over wait + task + until)' },
  { id: 'chat-session', group: 'interaction', roadmap: '§2.1 signals/updates/queries + triggers', today: 'none: each chat turn would be a separate run without session state' },
  { id: 'signal-wait', group: 'async', roadmap: '§2.1 generalized wait (timer or event) + declared signals', today: 'only `human` suspends a run for external input; no wait-for-event' },
  { id: 'durable-wait', group: 'async', roadmap: '§2.1 generalized wait', today: '`wait.delayMs` is capped at 3,600,000 (1 h) by the schema; timers are already durable' },
  { id: 'run-concurrency-policy', group: 'async', roadmap: '§2.1 signals `concurrentInput` policy', today: 'none (restart/queued/parallel/single policy for overlapping runs of one workflow)' },
  { id: 'stream', group: 'async', roadmap: '§2.1 bounded streams with back pressure', today: 'none (continuous message streams / topic consumers)' },
  { id: 'subworkflow-call', group: 'composition', roadmap: '§2.1 `call` (child workflow by hash)', today: 'inline at compile time when the callee is available (loses reuse and the separate run record)' },
  { id: 'parametric-action-input', group: 'composition', roadmap: 'none (closest: `plan/expand` or compile-time templating)', today: 'none (an input that is itself an action list)' },
  { id: 'flow-size>500', group: 'limits', roadmap: 'schema bound (`nodes.maxItems` = 500 per flow) or `call`', today: 'split into map/loop bodies or child workflows' },
  { id: 'error-branch', group: 'failure', roadmap: 'none explicit (§2.1 saga roles cover compensation only)', today: 'partial: node-level routes via `onError:"continue"` (output `{ok:false,error}`) + `when` guards on that output' },
  { id: 'completion-hook', group: 'failure', roadmap: 'none explicit', today: 'partial: `join:"all_resolved"` runs a final node only if every upstream node uses `onError:"continue"`' },
  { id: 'adaptive-retry', group: 'failure', roadmap: 'none', today: '`retry {maxAttempts<=10, backoffMs<=60000}` with fixed args; no attempt-dependent resources or error-class conditions' },
  { id: 'dynamic-dag', group: 'dynamism', roadmap: '§2.1 `plan/expand`', today: '`map` over runtime items (<=1000) and bounded `loop` only' },
  { id: 'agent-tool-loop', group: 'agentic', roadmap: '§2.1 `executor` or agent `tools`', today: '`agent` is one narrow typed call without tools' },
  { id: 'cross-run-state', group: 'state', roadmap: 'none (Phase 6 board is in-run)', today: 'none: state lives inside one run (conversation memory, key-value stores, static data)' },
  { id: 'unstructured-cycle', group: 'control', roadmap: 'none (rewrite into `loop`)', today: 'DAG + structured `loop` only' },
  // Agentic constructs (AGENTIC-CONVENTIONS.md §3.2-§3.3; definitions and rule codes there), after the 19 above so the
  // order of the original ids is unchanged. roadmap/today are §3.3's text; group is 'agentic' for all twelve.
  { id: 'state-reducer', group: 'agentic', roadmap: '§2.2 board topics with reducers', today: 'none: map outputs are index-ordered arrays folded by code' },
  { id: 'interrupt-resume', group: 'agentic', roadmap: '§2.1 human with resume tokens inside approval-gated agent tools', today: '`human` suspends only at node boundaries' },
  { id: 'checkpoint-rewind', group: 'agentic', roadmap: '§2.3 checkpoint and fork', today: 'resume at the latest durable point only' },
  { id: 'agent-as-tool', group: 'agentic', roadmap: '§2.1 `executor` / agent `tools` with `call` entries', today: 'none: `agent` has no tools' },
  { id: 'shared-scratchpad', group: 'agentic', roadmap: '§2.2 run board', today: 'none: no board in src/' },
  { id: 'guardrail-tripwire', group: 'agentic', roadmap: 'none explicit (verify gating inside executor/agent tools)', today: 'sequential checks only (code/assert/verify + when)' },
  { id: 'partial-output-stream', group: 'agentic', roadmap: '§2.1 bounded streams', today: 'none: outputs are delivered on node completion' },
  { id: 'model-generated-code-exec', group: 'agentic', roadmap: 'none explicit (sandboxed code from a model output, tainted)', today: '`code` runs authored source only' },
  { id: 'multimodal-io', group: 'agentic', roadmap: 'none (typed media inputs)', today: 'agent inputs and outputs are JSON/text' },
  { id: 'dynamic-agent-spawn', group: 'agentic', roadmap: '§2.1 plan/expand + detach/await handles', today: 'agents are fixed nodes; map over runtime items only' },
  { id: 'context-compaction', group: 'agentic', roadmap: '§2.2 onOverflow summarizeWith/dropLowestPriority', today: '`onOverflow: truncate` on explicit inputs only' },
  { id: 'env-session', group: 'agentic', roadmap: '§2.1 env capability contract', today: 'none: capabilities are stateless; no acquire/release or replay rule' },
];
// The registry before the agentic extension (the vocabulary of the four original clusters).
export const ORIGINAL_CONSTRUCT_COUNT = 19;
export const CONSTRUCT_IDS = CONSTRUCTS.map(c => c.id);
const CONSTRUCT_ORDER = new Map(CONSTRUCT_IDS.map((id, i) => [id, i]));
export const sortConstructs = list => [...new Set(list)].sort((a, b) => CONSTRUCT_ORDER.get(a) - CONSTRUCT_ORDER.get(b));

// Credential-shaped strings that must never appear in committed corpus text. Incoming-webhook URLs carry their secret in
// the path (Slack, Discord, Teams, Telegram bot), so they count as credentials too.
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAIza[0-9A-Za-z_-]{35}\b/, /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/-]{8,}/i, /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/i,
  /\.webhook\.office\.com\/webhookb2\/[^\s"'<>]{20,}/i, /api\.telegram\.org\/bot\d{6,}:[A-Za-z0-9_-]{30,}/i,
  /\bhf_[A-Za-z0-9]{30,}/, /\b[rs]k_live_[A-Za-z0-9]{16,}/,
];
export const findSecret = s => SECRET_PATTERNS.find(rx => rx.test(String(s ?? '')));
// Every string value of an item with its JSON path (the secret scan covers all of them, notes included).
const stringLeaves = (v, p = '', out = []) => {
  if (typeof v === 'string') out.push([p, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => stringLeaves(x, `${p}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) stringLeaves(x, p ? `${p}.${k}` : k, out);
  return out;
};

// One redistribution policy for every cluster (the conservative one the orchestration and science converters used):
// copyleft, share-alike and non-commercial licences keep only URL + derived graph + features, like unknown/ToS items.
export const NON_REDISTRIBUTABLE_LICENCE = /^(A?GPL|LGPL|EPL|MPL|EUPL|CC-BY(-[0-9.]+)?-(NC|SA|ND)|CC-BY-NC|CC-BY-SA)|^unknown$|^ToS:/;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNat = v => Number.isInteger(v) && v >= 0;
const isStr = (v, min = 0) => typeof v === 'string' && v.length >= min;

export function parseVerdict(v) {
  if (v === 'native') return { kind: 'native', tokens: [] };
  if (typeof v !== 'string') return null;
  if (v.startsWith('via-extension:')) {
    const tokens = v.slice('via-extension:'.length).split('+');
    return tokens.every(t => t.length) ? { kind: 'via-extension', tokens } : null;
  }
  if (v.startsWith('unsupported:') && v.length > 'unsupported:'.length) {
    const reason = v.slice('unsupported:'.length);
    const refusals = reason.startsWith('by-design-') ? reason.slice('by-design-'.length).split('+') : null;
    return { kind: 'unsupported', reason, tokens: [], ...(refusals ? { byDesign: true, refusals } : { byDesign: false }) };
  }
  return null;
}

// The `Needs: a, b.` list of an unsupported item's notes (the first one), [] for "No further construct would be needed",
// null when neither is present. Tokens are returned as written (the original clusters list converter tokens here).
export function notesNeeds(notes) {
  const m = /Needs: ([^.]+)\./.exec(String(notes ?? ''));
  if (m) return m[1].split(',').map(t => t.trim()).filter(Boolean);
  return /No further construct would be needed/.test(String(notes ?? '')) ? [] : null;
}

// Graph-derived feature values (the merge recomputes these; --canonical requires equality).
export function graphFeatures(item) {
  const nodes = item.graph.nodes, edges = item.graph.edges;
  const succ = new Map();
  for (const e of edges) {
    if (!succ.has(e.from)) succ.set(e.from, new Set());
    succ.get(e.from).add(e.to);
  }
  const count = c => nodes.filter(n => n.category === c).length;
  const eff = { read: 0, write: 0, external: 0 };
  for (const n of nodes) if (n.effects in eff) eff[n.effects]++;
  return {
    nodeCount: nodes.length, edgeCount: edges.length,
    maxFanOut: Math.max(0, ...[...succ.values()].map(s => s.size)),
    humanSteps: count('human'), effects: eff,
    hasCode: nodes.some(n => n.category === 'code'), hasModelCalls: nodes.some(n => n.category === 'model'),
    conditionNodes: count('condition'), loopNodes: count('loop'), subworkflowNodes: count('subworkflow'),
    waitNodes: count('wait'),
  };
}

export function validateItem(item, { canonical = false } = {}) {
  const errors = [];
  const err = (rule, msg) => errors.push({ rule, msg });
  if (!isObj(item)) { err('item.object', 'line is not a JSON object'); return errors; }
  for (const k of Object.keys(item)) if (!ITEM_KEYS.includes(k)) err('item.extra-key', `unexpected top-level key ${k}`);
  for (const k of ITEM_KEYS) if (!(k in item)) err('item.missing-key', `missing ${k}`);
  if (item.schema !== SCHEMA) err('schema', `schema must be ${SCHEMA}`);

  const s = item.source;
  if (!isObj(s)) err('source.object', 'source must be an object');
  else {
    for (const k of Object.keys(s)) if (!SOURCE_KEYS.includes(k)) err('source.extra-key', `unexpected source.${k}`);
    if (!isStr(s.platform, 1) || !/^[a-z0-9][a-z0-9-]*$/.test(s.platform)) err('source.platform', 'platform must be a lower-case slug');
    if (isStr(s.url) && s.url.startsWith('local:')) {
      if (!FIRST_PARTY_PLATFORMS.includes(s.platform)) err('source.url', `url must be an http(s) URL (local: only for first-party platforms ${FIRST_PARTY_PLATFORMS.join(', ')})`);
      else if (!/^local:[^\s/][^\s]*$/.test(s.url)) err('source.url', 'a first-party local: url must be local:<relative path> without whitespace');
    } else if (!isStr(s.url) || !/^https?:\/\/\S+$/.test(s.url)) err('source.url', 'url must be an http(s) URL');
    if (!isStr(s.revision, 1)) err('source.revision', 'revision must be non-empty');
    if (!isStr(s.retrievedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(s.retrievedAt)) err('source.retrievedAt', 'retrievedAt must be YYYY-MM-DD');
    if (!isStr(s.license, 1)) err('source.license', 'license must be non-empty (SPDX id, unknown or ToS:<url>)');
    else if (s.license.startsWith('ToS:') && !/^ToS:https?:\/\//.test(s.license)) err('source.license', 'ToS licence must carry a URL');
    if (!isStr(s.licenseEvidence, 1)) err('source.licenseEvidence', 'licenseEvidence must say where the licence was read');
    if (typeof s.redistributable !== 'boolean') err('source.redistributable', 'redistributable must be boolean');
    else if (s.redistributable && isStr(s.license) && (s.license === 'unknown' || s.license.startsWith('ToS:')))
      err('source.redistributable', 'an unknown or ToS-governed licence cannot be redistributable');
    else if (canonical && s.redistributable && isStr(s.license) && NON_REDISTRIBUTABLE_LICENCE.test(s.license))
      err('source.redistributable', `licence ${s.license} is copyleft/share-alike/non-commercial: not redistributable under the merged policy`);
    if (!isStr(s.rawPath) || !s.rawPath.startsWith('/opt/corpus/')) err('source.rawPath', 'rawPath must point under /opt/corpus/ (outside git)');
    if (isStr(item.id) && isStr(s.platform) && !item.id.startsWith(`${s.platform}:`)) err('id.platform', 'id must start with <source.platform>:');
    if ('extraction' in s) {
      const x = s.extraction;
      if (!isObj(x)) err('source.extraction', 'extraction must be an object {method, spans, extractor[, verifier]}');
      else {
        for (const k of Object.keys(x)) if (!EXTRACTION_KEYS.includes(k)) err('source.extraction', `unexpected source.extraction.${k}`);
        if (!isStr(x.method) || !/^[a-z][a-z0-9-]{0,63}$/.test(x.method)) err('source.extraction', 'extraction.method must be a lower-case slug (e.g. model-read-source)');
        if (!Array.isArray(x.spans) || x.spans.length < 1 || x.spans.length > 200) err('source.extraction', 'extraction.spans must list 1..200 source spans');
        else {
          const bad = x.spans.filter(p => !isStr(p) || p.length > 300 || !EXTRACTION_SPAN.test(p) || findSecret(p));
          if (bad.length) err('source.extraction', `extraction.spans entries must be <path>:L<a>[-L<b>] (<=300 chars), e.g. ${JSON.stringify(bad[0]).slice(0, 80)}`);
          if (new Set(x.spans).size !== x.spans.length) err('source.extraction', 'extraction.spans must be distinct');
        }
        if (!isStr(x.extractor, 1) || x.extractor.length > 100) err('source.extraction', 'extraction.extractor must be a non-empty model or tool id (<=100 chars)');
        if ('verifier' in x && (!isStr(x.verifier, 1) || x.verifier.length > 200)) err('source.extraction', 'extraction.verifier, when present, must be a non-empty string (<=200 chars)');
      }
    }
  }
  if (!isStr(item.id) || !/^[a-z0-9-]+:\S/.test(item.id) || /\s/.test(item.id)) err('id', 'id must be <platform>:<stable id> without whitespace');
  else if (/%(?![0-9A-Fa-f]{2})/.test(item.id)) err('id', 'a % in an id must start a percent-encoded octet (paths are encoded like source.url)');
  if (!isStr(item.title, 1) || item.title.length > 300) err('title', 'title must be 1..300 chars');
  if (findSecret(item.title)) err('secret', 'credential-shaped string in title');

  const d = item.description;
  if (!isObj(d) || typeof d.text !== 'string' || !PROVENANCE.includes(d.provenance) || Object.keys(d).some(k => !['text', 'provenance'].includes(k)))
    err('description', 'description must be {text, provenance: original|recovered-by-model|written}');
  else {
    if (s && s.redistributable === false && d.text && d.provenance !== 'written')
      err('description.redistribution', 'non-redistributable items may keep only a written description');
    if (findSecret(d.text)) err('secret', 'credential-shaped string in description');
  }

  const g = item.graph;
  let ids = new Set();
  if (!isObj(g) || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) err('graph', 'graph must be {nodes:[], edges:[]}');
  else {
    if (g.nodes.length === 0) err('graph.empty', 'graph has no nodes');
    for (const k of Object.keys(g)) if (!['nodes', 'edges'].includes(k)) err('graph.extra-key', `unexpected graph.${k}`);
    g.nodes.forEach((n, i) => {
      if (!isObj(n)) { err('node.object', `node ${i} is not an object`); return; }
      for (const k of Object.keys(n)) if (!NODE_KEYS.includes(k)) err('node.extra-key', `node ${i} has key ${k}`);
      if (!isStr(n.id, 1)) err('node.id', `node ${i} id must be non-empty`);
      else if (ids.has(n.id)) err('node.id-unique', `duplicate node id ${n.id}`);
      else ids.add(n.id);
      if (!isStr(n.type, 1)) err('node.type', `node ${i} type must be non-empty`);
      if (!CATEGORIES.includes(n.category)) err('node.category', `node ${i} category ${n.category}`);
      if (!EFFECTS.includes(n.effects)) err('node.effects', `node ${i} effects ${n.effects}`);
      if (typeof n.summary !== 'string' || n.summary.length > 200) err('node.summary', `node ${i} summary must be a string of <=200 chars`);
      if (findSecret(n.summary)) err('secret', `credential-shaped string in node ${i} summary`);
    });
    const seen = new Set();
    g.edges.forEach((e, i) => {
      if (!isObj(e)) { err('edge.object', `edge ${i} is not an object`); return; }
      for (const k of Object.keys(e)) if (!EDGE_KEYS.includes(k)) err('edge.extra-key', `edge ${i} has key ${k}`);
      if (!ids.has(e.from) || !ids.has(e.to)) err('edge.dangling', `edge ${i} ${e.from}->${e.to} names an unknown node`);
      if (!EDGE_KINDS.includes(e.kind)) err('edge.kind', `edge ${i} kind ${e.kind}`);
      const key = `${e.from}\u0000${e.to}\u0000${e.kind}`;
      if (seen.has(key)) err('edge.duplicate', `edge ${i} duplicates ${e.from}->${e.to} (${e.kind})`);
      seen.add(key);
    });
  }

  const f = item.features;
  if (!isObj(f)) err('features', 'features must be an object');
  else {
    for (const k of Object.keys(f)) if (!FEATURE_KEYS.includes(k)) err('features.extra-key', `unexpected features.${k}`);
    for (const k of ['nodeCount', 'edgeCount', 'maxFanOut', 'branching', 'loops', 'humanSteps', 'subworkflows'])
      if (!isNat(f[k])) err('features.type', `features.${k} must be a non-negative integer`);
    if (!Array.isArray(f.async) || f.async.some(a => !ASYNC.includes(a)) || new Set(f.async).size !== f.async.length)
      err('features.async', `async must be distinct values of ${ASYNC.join('|')}`);
    if (!isObj(f.effects) || !['read', 'write', 'external'].every(k => isNat(f.effects[k])) || Object.keys(f.effects).length !== 3)
      err('features.effects', 'effects must be {read, write, external} counts');
    if (!Array.isArray(f.connectors) || f.connectors.some(c => !isStr(c, 1))) err('features.connectors', 'connectors must be strings');
    if (!Array.isArray(f.domains) || f.domains.some(c => !isStr(c, 1))) err('features.domains', 'domains must be strings');
    if (typeof f.hasCode !== 'boolean' || typeof f.hasModelCalls !== 'boolean') err('features.type', 'hasCode/hasModelCalls must be boolean');
    if (isObj(g) && Array.isArray(g.nodes) && Array.isArray(g.edges) && errors.every(e => !e.rule.startsWith('node') && !e.rule.startsWith('edge'))) {
      const gf = graphFeatures(item);
      if (f.nodeCount !== gf.nodeCount) err('features.nodeCount', `nodeCount ${f.nodeCount} != ${gf.nodeCount} nodes`);
      if (f.edgeCount !== gf.edgeCount) err('features.edgeCount', `edgeCount ${f.edgeCount} != ${gf.edgeCount} edges`);
      if (f.branching < gf.conditionNodes) err('features.branching', `branching ${f.branching} < ${gf.conditionNodes} condition nodes`);
      if (f.loops < gf.loopNodes) err('features.loops', `loops ${f.loops} < ${gf.loopNodes} loop nodes`);
      if (f.subworkflows < gf.subworkflowNodes) err('features.subworkflows', `subworkflows ${f.subworkflows} < ${gf.subworkflowNodes} subworkflow nodes`);
      if (canonical) {
        for (const k of ['maxFanOut', 'humanSteps', 'hasCode', 'hasModelCalls'])
          if (f[k] !== gf[k]) err(`features.${k}`, `${k} ${f[k]} != graph value ${gf[k]}`);
        if (isObj(f.effects) && ['read', 'write', 'external'].some(k => f.effects[k] !== gf.effects[k])) err('features.effects', 'effects counts differ from the graph');
        if (Array.isArray(f.async) && f.async.join() !== [...f.async].sort().join()) err('features.async', 'async must be sorted');
        if (gf.waitNodes && Array.isArray(f.async) && !f.async.includes('wait')) err('features.async', 'graph has wait nodes but async lacks wait');
      }
    }
  }

  const ir = item.ir;
  if (!isObj(ir) || typeof ir.notes !== 'string' || Object.keys(ir).some(k => !['verdict', 'notes'].includes(k))) err('ir', 'ir must be {verdict, notes}');
  else {
    const v = parseVerdict(ir.verdict);
    if (!v) err('ir.verdict', `verdict ${JSON.stringify(ir.verdict)} must be native | via-extension:<f>[+<f>] | unsupported:<reason>`);
    else if (canonical) {
      const bad = v.tokens.filter(t => !CONSTRUCT_IDS.includes(t));
      if (bad.length) err('ir.vocabulary', `non-canonical construct(s) ${bad.join(', ')}`);
      if (v.tokens.join('+') !== sortConstructs(v.tokens).join('+')) err('ir.order', 'constructs must be distinct and in canonical order');
      if (isObj(f) && Array.isArray(f.async)) {
        const need = { 'schedule-trigger': 'schedule', 'webhook-trigger': 'webhook', 'event-trigger': 'event', 'poll-trigger': 'poll' };
        for (const [t, a] of Object.entries(need)) if (v.tokens.includes(t) && !f.async.includes(a)) err('ir.async', `${t} without ${a} in features.async`);
      }
      if (isObj(f) && f.nodeCount > 500 && v.kind === 'native') err('ir.size', 'more than 500 nodes cannot be native (nodes.maxItems)');
      if (v.kind === 'unsupported' && v.reason.startsWith('by-design')) {
        const rs = v.refusals ?? [];
        if (!rs.length || rs.some(r => !REFUSALS.includes(r))) err('ir.refusal', `unknown design refusal in ${ir.verdict} (known: ${REFUSALS.map(r => `by-design-${r}`).join(', ')})`);
        else if (rs.join('+') !== [...new Set(rs)].sort((a, b) => REFUSALS.indexOf(a) - REFUSALS.indexOf(b)).join('+')) err('ir.refusal', 'refusals must be distinct and in REFUSALS order');
        const needs = notesNeeds(ir.notes);
        if (needs === null) err('ir.needs', 'a refused item must list `Needs: a, b.` or say "No further construct would be needed" in its notes');
        else if (needs.some(t => !CONSTRUCT_IDS.includes(t))) err('ir.needs', `non-canonical construct(s) in Needs: ${needs.filter(t => !CONSTRUCT_IDS.includes(t)).join(', ')}`);
        else if (needs.join('+') !== sortConstructs(needs).join('+')) err('ir.needs', 'Needs constructs must be distinct and in canonical order');
      }
    }
  }

  const o = item.oracle;
  if (!isObj(o) || !ORACLE_KINDS.includes(o.kind) || typeof o.notes !== 'string' || Object.keys(o).some(k => !['kind', 'notes'].includes(k)))
    err('oracle', `oracle must be {kind: ${ORACLE_KINDS.join('|')}, notes}`);
  // The secret scan above names the common text fields; this covers every other string (ir.notes, oracle.notes, licence
  // evidence, node types, connectors, ...), which the model-read agentic items fill with long free text.
  const named = /^(title|description\.text|graph\.nodes\[\d+\]\.summary|source\.extraction\.spans\[\d+\])$/;
  const leak = stringLeaves(item).find(([p, v]) => !named.test(p) && findSecret(v));
  if (leak) err('secret', `credential-shaped string or webhook URL in ${leak[0]}`);
  return errors;
}

export function checkFile(file, { canonical = false } = {}) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const ids = new Map();
  const results = [];
  lines.forEach((line, i) => {
    let item, errors;
    try { item = JSON.parse(line); errors = validateItem(item, { canonical }); }
    catch (e) { errors = [{ rule: 'json', msg: `not JSON: ${e.message.slice(0, 120)}` }]; }
    if (item && typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push({ rule: 'id.unique', msg: `id also on line ${ids.get(item.id) + 1}` });
      else ids.set(item.id, i);
    }
    results.push({ line: i + 1, id: item?.id ?? null, errors });
  });
  return results;
}

// Unit checks on synthetic items (no corpus data): the base item is valid in both modes, and each mutation must
// raise exactly the rule named next to it.
export function selfTest() {
  const base = () => ({
    schema: SCHEMA, id: 'demo:repo/flow.py#main',
    source: { platform: 'demo', url: 'https://example.org/repo/blob/abc/flow.py', revision: 'abc', retrievedAt: '2026-10-08',
      license: 'MIT', licenseEvidence: 'LICENSE', redistributable: true, rawPath: '/opt/corpus/demo/flow.py' },
    title: 'demo', description: { text: 'demo flow', provenance: 'original' },
    graph: { nodes: [{ id: 'a', type: 't', category: 'model', effects: 'none', summary: '' }, { id: 'b', type: 't', category: 'action', effects: 'write', summary: '' }],
      edges: [{ from: 'a', to: 'b', kind: 'data' }] },
    features: { nodeCount: 2, edgeCount: 1, maxFanOut: 1, branching: 0, loops: 0, async: [], humanSteps: 0, effects: { read: 0, write: 1, external: 0 },
      connectors: [], hasCode: false, hasModelCalls: true, subworkflows: 0, domains: [] },
    ir: { verdict: 'native', notes: '' }, oracle: { kind: 'none', notes: '' },
  });
  const extraction = { method: 'model-read-source', spans: ['flow.py:L1-L9', '@lib/x.py:L3'], extractor: 'claude-sonnet' };
  const cases = [
    ['base item', it => it, []],
    ['extraction allowed', it => { it.source.extraction = { ...extraction }; }, []],
    ['extraction with verifier', it => { it.source.extraction = { ...extraction, verifier: 'independent model pass, 2026-10-08' }; }, []],
    ['extraction extra key', it => { it.source.extraction = { ...extraction, model: 'x' }; }, ['source.extraction']],
    ['extraction not an object', it => { it.source.extraction = 'model-read-source'; }, ['source.extraction']],
    ['extraction bad method', it => { it.source.extraction = { ...extraction, method: 'Model Read' }; }, ['source.extraction']],
    ['extraction empty spans', it => { it.source.extraction = { ...extraction, spans: [] }; }, ['source.extraction']],
    ['extraction span without lines', it => { it.source.extraction = { ...extraction, spans: ['flow.py'] }; }, ['source.extraction']],
    ['extraction duplicate spans', it => { it.source.extraction = { ...extraction, spans: ['flow.py:L1', 'flow.py:L1'] }; }, ['source.extraction']],
    ['extraction missing extractor', it => { it.source.extraction = { method: 'model-read-source', spans: ['flow.py:L1'] }; }, ['source.extraction']],
    ['other unknown source key still rejected', it => { it.source.notes = 'x'; }, ['source.extra-key']],
    ['local: url for a third-party platform', it => { it.source.url = 'local:repo/flow.py'; }, ['source.url']],
    ['local: url for a first-party platform', it => { it.id = 'claude-code-workflows:s/flow.js'; it.source.platform = 'claude-code-workflows'; it.source.url = 'local:s/flow.js';
      it.source.license = 'unknown'; it.source.redistributable = false; it.description.provenance = 'written'; }, []],
    ['absolute local: url', it => { it.id = 'claude-code-workflows:s/flow.js'; it.source.platform = 'claude-code-workflows'; it.source.url = 'local:/root/s/flow.js'; }, ['source.url']],
    ['percent-encoded id', it => { it.id = 'demo:repo/Coding%20Assistant/a.ipynb#x'; }, []],
    ['malformed % in id', it => { it.id = 'demo:repo/100%/a.py'; }, ['id']],
    ['agentic construct is canonical', it => { it.ir.verdict = 'via-extension:agent-tool-loop+agent-as-tool+env-session'; }, []],
    ['agentic constructs out of order', it => { it.ir.verdict = 'via-extension:env-session+agent-tool-loop'; }, ['ir.order']],
    ['retired topology token', it => { it.ir.verdict = 'via-extension:llm-router'; }, ['ir.vocabulary']],
    ['refusal with needs', it => { it.ir.verdict = 'unsupported:by-design-full-history-handoff'; it.ir.notes = 'Refused. Needs: chat-session, agent-tool-loop, cross-run-state.'; }, []],
    ['refusal without further needs', it => { it.ir.verdict = 'unsupported:by-design-group-chat'; it.ir.notes = 'No further construct would be needed.'; }, []],
    ['both refusals', it => { it.ir.verdict = 'unsupported:by-design-group-chat+full-history-handoff'; it.ir.notes = 'Needs: agent-tool-loop.'; }, []],
    ['refusals out of order', it => { it.ir.verdict = 'unsupported:by-design-full-history-handoff+group-chat'; it.ir.notes = 'Needs: agent-tool-loop.'; }, ['ir.refusal']],
    ['unknown refusal', it => { it.ir.verdict = 'unsupported:by-design-swarm'; it.ir.notes = 'Needs: agent-tool-loop.'; }, ['ir.refusal']],
    ['refusal without a needs statement', it => { it.ir.verdict = 'unsupported:by-design-group-chat'; it.ir.notes = 'free group chat'; }, ['ir.needs']],
    ['refusal with a retired token in needs', it => { it.ir.verdict = 'unsupported:by-design-group-chat'; it.ir.notes = 'Needs: llm-router.'; }, ['ir.needs']],
    ['refusal with needs out of order', it => { it.ir.verdict = 'unsupported:by-design-group-chat'; it.ir.notes = 'Needs: cross-run-state, chat-session.'; }, ['ir.needs']],
    ['expressibility failure keeps its own form', it => { it.ir.verdict = 'unsupported:interactive-dashboard-state'; it.ir.notes = 'Needs: external-state-store.'; }, []],
    ['token in ir.notes', it => { it.ir.notes = `uses ${'ghp_'}${'a'.repeat(36)} to push`; }, ['secret']],
    ['webhook URL in oracle notes', it => { it.oracle.notes = `posts to https://${'hooks.slack.com'}/services/T0000/B0000/${'x'.repeat(24)}`; }, ['secret']],
    ['webhook URL in a node summary', it => { it.graph.nodes[1].summary = `POST https://discord.com/api/webhooks/123456/${'y'.repeat(30)}`; }, ['secret']],
    ['webhook host without a path is fine', it => { it.ir.notes = 'notifies a Slack channel through hooks.slack.com (URL not recorded)'; }, []],
  ];
  let failed = 0, run = 0;
  for (const [name, mutate, want] of cases) {
    const it = base(); mutate(it);
    for (const canonical of [false, true]) {
      run++;
      const got = [...new Set(validateItem(it, { canonical }).map(e => e.rule))].sort();
      const expect = canonical ? want : want.filter(r => !['ir.order', 'ir.vocabulary', 'ir.refusal', 'ir.needs'].includes(r));
      if (got.join() !== [...expect].sort().join()) { failed++; console.log(`FAIL ${name} (${canonical ? 'canonical' : 'plain'}): got [${got}] want [${expect}]`); }
    }
  }
  if (CONSTRUCT_IDS.slice(0, ORIGINAL_CONSTRUCT_COUNT).join() !== ['schedule-trigger', 'webhook-trigger', 'event-trigger', 'poll-trigger', 'chat-session', 'signal-wait',
    'durable-wait', 'run-concurrency-policy', 'stream', 'subworkflow-call', 'parametric-action-input', 'flow-size>500', 'error-branch', 'completion-hook',
    'adaptive-retry', 'dynamic-dag', 'agent-tool-loop', 'cross-run-state', 'unstructured-cycle'].join()) { failed++; console.log('FAIL the 19 original constructs changed order'); }
  run++;
  if (new Set(CONSTRUCT_IDS).size !== CONSTRUCT_IDS.length || CONSTRUCTS.some(c => !c.roadmap || !c.today || !c.group)) { failed++; console.log('FAIL registry ids must be unique with group/roadmap/today'); }
  run++;
  console.log(`self-test: ${run - failed} of ${run} checks passed; registry ${CONSTRUCT_IDS.length} constructs (${ORIGINAL_CONSTRUCT_COUNT} original + ${CONSTRUCT_IDS.length - ORIGINAL_CONSTRUCT_COUNT} agentic)`);
  return failed === 0;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: node check-items.mjs <items.jsonl> [--canonical] [--json] [--max-examples N]'); process.exit(2); }
  const canonical = args.includes('--canonical');
  const maxIdx = args.indexOf('--max-examples');
  const maxExamples = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 5;
  const results = checkFile(file, { canonical });
  const invalid = results.filter(r => r.errors.length);
  const byRule = {};
  for (const r of invalid) for (const e of r.errors) (byRule[e.rule] ??= []).push(`line ${r.line} ${r.id ?? ''}: ${e.msg}`);
  const summary = { file: path.resolve(file), canonical, lines: results.length, valid: results.length - invalid.length, invalid: invalid.length,
    rules: Object.fromEntries(Object.entries(byRule).map(([k, v]) => [k, { count: v.length, examples: v.slice(0, maxExamples) }])) };
  if (args.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`${summary.file}: ${summary.lines} lines, ${summary.valid} valid, ${summary.invalid} invalid${canonical ? ' (canonical mode)' : ''}`);
    for (const [rule, { count, examples }] of Object.entries(summary.rules)) {
      console.log(`  ${rule}: ${count}`);
      for (const x of examples) console.log(`    ${x.slice(0, 220)}`);
    }
  }
  process.exit(invalid.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv);
