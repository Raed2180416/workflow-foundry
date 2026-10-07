#!/usr/bin/env node
// Validate foundry-corpus-item/1 records (research/corpus-20261006/ITEM-SCHEMA.md) line by line.
//
// Usage: node check-items.mjs <items.jsonl> [--canonical] [--json] [--max-examples N]
//   --canonical  also require the merged-corpus conventions: IR verdict tokens from CONSTRUCTS below,
//                features recomputable from the graph (exact equality), sorted async, unique ids.
// Exit code 0 when every line is valid, 1 otherwise. Imported by merge-items.mjs and coverage-report.mjs
// for the shared vocabulary (CONSTRUCTS, CATEGORIES, ...) and validateItem().
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
export const SOURCE_KEYS = ['platform', 'url', 'revision', 'retrievedAt', 'license', 'licenseEvidence', 'redistributable', 'rawPath'];
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
];
export const CONSTRUCT_IDS = CONSTRUCTS.map(c => c.id);
const CONSTRUCT_ORDER = new Map(CONSTRUCT_IDS.map((id, i) => [id, i]));
export const sortConstructs = list => [...new Set(list)].sort((a, b) => CONSTRUCT_ORDER.get(a) - CONSTRUCT_ORDER.get(b));

// Credential-shaped strings that must never appear in committed corpus text.
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAIza[0-9A-Za-z_-]{35}\b/, /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
];
export const findSecret = s => SECRET_PATTERNS.find(rx => rx.test(String(s ?? '')));

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
  if (v.startsWith('unsupported:') && v.length > 'unsupported:'.length) return { kind: 'unsupported', reason: v.slice('unsupported:'.length), tokens: [] };
  return null;
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
    if (!isStr(s.url) || !/^https?:\/\/\S+$/.test(s.url)) err('source.url', 'url must be an http(s) URL');
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
  }
  if (!isStr(item.id) || !/^[a-z0-9-]+:\S/.test(item.id) || /\s/.test(item.id)) err('id', 'id must be <platform>:<stable id> without whitespace');
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
    }
  }

  const o = item.oracle;
  if (!isObj(o) || !ORACLE_KINDS.includes(o.kind) || typeof o.notes !== 'string' || Object.keys(o).some(k => !['kind', 'notes'].includes(k)))
    err('oracle', `oracle must be {kind: ${ORACLE_KINDS.join('|')}, notes}`);
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

function main(argv) {
  const args = argv.slice(2);
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
