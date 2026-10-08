#!/usr/bin/env node
// Merge the cluster parts (research/corpus-20261006/parts/*.jsonl) into items.jsonl.
//
// Usage: node merge-items.mjs [--parts DIR] [--out FILE] [--log FILE]
// Defaults: ../parts, ../items.jsonl, ../merge-log.json (relative to this script).
//
// Steps (every change is counted in merge-log.json, with examples):
//   1. parse each line; unparseable lines are dropped
//   2. repair what can be repaired without guessing: strip keys outside ITEM-SCHEMA (the optional provenance object
//      source.extraction is part of it and kept), percent-encode URLs,
//      trim node summaries to 200 chars, drop dangling edges, de-duplicate identical edges, blank any
//      non-written description of a non-redistributable item, and apply one redistribution policy (copyleft,
//      share-alike and non-commercial licences are not redistributable; their node summaries become type-level)
//   3. recompute the graph-derived features (nodeCount, edgeCount, maxFanOut, humanSteps, effects, hasCode,
//      hasModelCalls) and floor the source-derived ones (branching >= condition nodes, loops >= loop nodes,
//      subworkflows >= subworkflow nodes); make async agree with wait nodes and trigger constructs
//   4. recompute the IR verdict with one vocabulary (check-items.mjs CONSTRUCTS) from the converter's tokens
//      (mapped per cluster, see TOKEN_MAP) plus graph evidence (error edges, by-reference sub-workflow nodes,
//      >500 nodes); converter verdict and notes are kept in ir.notes. The agentic cluster (parts/agentic.jsonl, from
//      agentic-assemble.mjs) is different: its verdicts are model readings of the source, re-labelled to
//      AGENTIC-CONVENTIONS.md, already in the registry vocabulary. Its tokens map by identity (an unknown or retired
//      token is an error), and error edges and sub-workflow nodes are not turned into constructs, because the readers
//      judged them (e.g. onError:"continue" retries, sub-applications inlined as a map body); the graph evidence is
//      recorded in ir.notes and merge-log.json instead. `unsupported:by-design-*` verdicts are kept with their Needs list
//   5. validate with check-items.mjs in canonical mode; lines that still fail are dropped
//   6. drop duplicates: same platform, identical normalized graph (types, categories, summaries, edges) and the
//      same normalized title or the same non-empty description; the better-documented item is kept
// Nothing in the corpus is executed or followed as an instruction; titles/descriptions are data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateItem, graphFeatures, parseVerdict, sortConstructs, CONSTRUCT_IDS, ITEM_KEYS, SOURCE_KEYS, NODE_KEYS, EDGE_KEYS,
  FEATURE_KEYS, ASYNC, NON_REDISTRIBUTABLE_LICENCE, FIRST_PARTY_PLATFORMS, isFirstParty } from './check-items.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const PARTS = path.resolve(arg('--parts', path.join(HERE, '..', 'parts')));
const OUT = path.resolve(arg('--out', path.join(HERE, '..', 'items.jsonl')));
const LOG = path.resolve(arg('--log', path.join(HERE, '..', 'merge-log.json')));
const CLUSTER_ORDER = ['automation', 'orchestration', 'science', 'consumer-creative', 'agentic'];
const MODEL_READ_CLUSTERS = ['agentic'];   // verdicts read from the source by a model and harmonised; no graph-evidence rewrite
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------- logging
const log = { fixes: {}, drops: [], featureChanges: {}, verdict: { changed: 0, byCluster: {}, kindTransitions: {}, tokenMap: {} }, dedupe: { dropped: [], shapeTwinsKept: [] }, cycleArtifacts: [],
  agentic: { graphEvidenceNotApplied: [], modelDrivenCycles: [] } };
function fix(rule, id, detail, cluster) {
  const r = (log.fixes[rule] ??= { count: 0, examples: [], byCluster: {} });
  r.count++;
  r.byCluster[cluster] = (r.byCluster[cluster] ?? 0) + 1;
  if (r.examples.length < 8) r.examples.push(detail ? `${id}: ${detail}` : id);
}

// ---------------------------------------------------------------- verdict canonicalization
// Converter token -> canonical construct (string), null (native under the Phase 1 IR, with the reason), or a function.
const NATIVE = reason => ({ native: reason });
const TOKEN_MAP = {
  'schedule-trigger': 'schedule-trigger', 'webhook-trigger': 'webhook-trigger', 'event-trigger': 'event-trigger', 'poll-trigger': 'poll-trigger',
  'chat-session': 'chat-session', 'signal-wait': 'signal-wait', 'signal-resume': 'signal-wait', 'durable-wait>1h': 'durable-wait',
  'run-mode-parallel': 'run-concurrency-policy', 'run-mode-queued': 'run-concurrency-policy', 'run-mode-restart': 'run-concurrency-policy',
  'stream': 'stream', 'subworkflow-call': 'subworkflow-call', 'parametric-action-input': 'parametric-action-input',
  'split-over-500-nodes': 'flow-size>500', 'error-branch': 'error-branch', 'error-branches': 'error-branch',
  'finally(error-branches)': 'completion-hook', 'completion-hook': 'completion-hook',
  'setup-teardown(as all_resolved join; teardown scoping is an extension)': 'completion-hook',
  'dynamic-dag': 'dynamic-dag', 'agent-tool-loop': 'agent-tool-loop', 'conversation-state': 'cross-run-state',
  'external-state-store': 'cross-run-state', 'unstructured-cycle': 'unstructured-cycle',
  'subworkflow-call(inlined at compile time)': NATIVE('sub-workflows inlined at compile time'),
  'dynamic-fan-out': NATIVE('runtime fan-out over a list maps to `map` (maxItems <= 1000)'),
  // automation: n8n retryOnFail (<=5 tries, <=5 s), Activepieces retryOnFailure, Dify retry_config (<=10, <=5 s) fit IR `retry`;
  // science: nf-core/Snakemake retries that raise resources with task.attempt / attempt do not.
  'retry-policy': cluster => cluster === 'science' ? 'adaptive-retry' : NATIVE('fixed-count retry maps to IR `retry`'),
  'triggers': 'TRIGGERS', 'signals': 'SIGNALS',
};
// The agentic cluster's tokens are already registry ids (AGENTIC-CONVENTIONS.md §3): identity map, nothing else. Retired
// topology labels (llm-router, supervisor-delegation, handoff, group-chat) and new-* proposals are rejected loudly.
const TOKEN_MAPS = { agentic: Object.fromEntries(CONSTRUCT_IDS.map(id => [id, id])) };
const tokenMapFor = cluster => TOKEN_MAPS[cluster] ?? TOKEN_MAP;

function splitTokens(body) {
  // orchestration/science use ',' and may nest commas in parentheses; automation/consumer use '+'
  const out = []; let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if ((ch === '+' || ch === ',') && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(t => t.trim()).filter(Boolean);
}

// Orchestration's generic `triggers` token: classify the trigger nodes it inserted (see orchestration-*.py).
function orchestrationTriggerKinds(item) {
  const kinds = new Set(), notes = [];
  const p = item.source.platform;
  for (const n of item.graph.nodes.filter(x => x.category === 'trigger')) {
    const t = n.type, s = n.summary;
    if (p === 'github-actions') {
      if (t === 'workflow_dispatch' || t === 'workflow_call') continue;
      if (t === 'schedule') kinds.add('schedule');
      else if (t === 'repository_dispatch' || t === 'workflow_run' || /^event /.test(s)) kinds.add('event');
      else kinds.add('webhook');
    } else if (p === 'gitlab-ci') {
      const m = /pipeline sources referenced: (.*)$/.exec(s);
      if (!m) continue;
      for (const src of m[1].split(',')) {
        if (src === 'schedule') kinds.add('schedule');
        else if (src === 'push' || src === 'merge_request_event') kinds.add('webhook');
        else if (['trigger', 'pipeline', 'api', 'parent_pipeline'].includes(src)) kinds.add('event');
      }
    } else if (p === 'airflow') {
      if (t === 'schedule:@once') { notes.push('schedule @once is a one-shot start (a run input), not a recurring trigger'); continue; }
      if (t.startsWith('schedule')) kinds.add('schedule');
      if (t.includes('event')) kinds.add('event');
    } else if (p === 'dagster') {
      if (t === 'schedule') kinds.add('schedule');
      else if (t === '@sensor') kinds.add('poll');
      else kinds.add('event');
    } else if (/cron|schedule|interval|rrule/i.test(t)) kinds.add('schedule');
    else if (/trigger|event/i.test(t)) kinds.add('event');
  }
  if (!kinds.size && !notes.length) for (const a of item.features.async) if (['schedule', 'webhook', 'event'].includes(a)) kinds.add(a);
  return { kinds, notes };
}

const isInlinedComfySubgraph = (item, n) => item.source.platform === 'comfyui' && n.type.startsWith('subgraph:');

function hasCycleOutsideLoopEdges(item) {
  const adj = new Map(item.graph.nodes.map(n => [n.id, []]));
  for (const e of item.graph.edges) if (e.kind !== 'loop' && e.from !== e.to) adj.get(e.from).push(e.to);
  const color = new Map();
  for (const s of adj.keys()) {
    if (color.get(s)) continue;
    const stack = [[s, 0]]; color.set(s, 1);
    while (stack.length) {
      const fr = stack[stack.length - 1]; const nb = adj.get(fr[0]);
      if (fr[1] < nb.length) {
        const w = nb[fr[1]++]; const c = color.get(w) ?? 0;
        if (c === 1) return true;
        if (c === 0) { color.set(w, 1); stack.push([w, 0]); }
      } else { color.set(fr[0], 2); stack.pop(); }
    }
  }
  return false;
}

// Category -> Phase 1 IR element (informational, recorded in ir.notes).
function irMapping(item) {
  const c = { task: 0, codePure: 0, agent: 0, human: 0, loopOrMap: 0, wait: 0, whenGuards: 0, joins: 0, starts: 0, inputs: 0, calls: 0, errorRoutes: 0 };
  for (const n of item.graph.nodes) {
    switch (n.category) {
      case 'action': c.task++; break;
      case 'transform': case 'code': if (n.effects === 'none') c.codePure++; else c.task++; break;
      case 'model': c.agent++; break;
      case 'human': c.human++; break;
      case 'loop': c.loopOrMap++; break;
      case 'wait': c.wait++; break;
      case 'condition': c.whenGuards++; break;
      case 'merge': c.joins++; break;
      case 'trigger': c.starts++; break;
      case 'subworkflow': c.calls++; break;
      case 'error-handler': c.errorRoutes++; break;
      default: if (n.effects === 'none') c.inputs++; else c.task++;
    }
  }
  return `task ${c.task}, code ${c.codePure}, agent ${c.agent}, human ${c.human}, loop/map ${c.loopOrMap}, wait ${c.wait}, ` +
    `when-guards ${c.whenGuards}, joins ${c.joins}, run starts ${c.starts}, inputs/params ${c.inputs}, sub-workflow nodes ${c.calls}, error handlers ${c.errorRoutes}`;
}

function canonicalVerdict(item, cluster) {
  const orig = item.ir.verdict;
  const pv = parseVerdict(orig) ?? (() => { // orchestration/science verdicts joined with ','
    if (typeof orig === 'string' && orig.startsWith('via-extension:')) return { kind: 'via-extension', tokens: splitTokens(orig.slice(14)) };
    throw new Error(`${item.id}: unparseable verdict ${orig}`);
  })();
  let rawTokens = pv.kind === 'via-extension' ? splitTokens(orig.slice(14)) : [];
  if (pv.kind === 'unsupported') { const m = /Needs: ([^.]+)\./.exec(item.ir.notes); if (m) rawTokens = m[1].split(',').map(t => t.trim()); }
  const out = new Set(), native = [], derived = [];
  for (const tok of rawTokens) {
    let m = Object.hasOwn(tokenMapFor(cluster), tok) ? tokenMapFor(cluster)[tok] : undefined;
    if (m === undefined) throw new Error(`${item.id}: unmapped ${cluster} token "${tok}" ` + (TOKEN_MAPS[cluster]
      ? '(this cluster takes registry ids only: add a construct to check-items.mjs CONSTRUCTS, or relabel; retired labels are native patterns, AGENTIC-CONVENTIONS.md §4)'
      : '(add it to TOKEN_MAP)'));
    if (typeof m === 'function') m = m(cluster);
    let mapped;
    if (m === 'TRIGGERS') {
      const { kinds, notes } = orchestrationTriggerKinds(item);
      mapped = [...kinds].map(k => `${k}-trigger`);
      native.push(...notes);
      if (!mapped.length && !notes.length) native.push('generic `triggers` token without a recurring or event start');
    } else if (m === 'SIGNALS') {
      mapped = [];
      const p = item.source.platform;
      if (p === 'github-actions' || p === 'gitlab-ci') mapped.push('event-trigger'); // repository_dispatch/workflow_run/pipeline triggers start a run
      else if (p === 'airflow') {
        if (item.graph.nodes.some(n => n.category === 'wait')) mapped.push('signal-wait'); // deferrable / external-task sensors
        if (item.graph.nodes.some(n => n.category === 'trigger' && n.type.includes('event'))) mapped.push('event-trigger'); // asset-scheduled DAG
        if (!mapped.length) mapped.push('signal-wait');
      } else mapped.push('signal-wait');
    } else if (typeof m === 'string') mapped = [m];
    else { native.push(`${tok}: ${m.native}`); mapped = []; }
    for (const t of mapped) out.add(t);
    log.verdict.tokenMap[`${cluster}|${tok}`] ??= new Set();
    for (const t of mapped.length ? mapped : ['(native)']) log.verdict.tokenMap[`${cluster}|${tok}`].add(t);
  }
  // uniform graph evidence (converter clusters); recorded but not applied for model-read clusters
  const modelRead = MODEL_READ_CLUSTERS.includes(cluster);
  const notApplied = [];
  const errorEdges = item.graph.edges.filter(e => e.kind === 'error').length;
  if (errorEdges && !out.has('error-branch')) {
    if (modelRead) notApplied.push(`${errorEdges} error edge${errorEdges > 1 ? 's' : ''}`);
    else { out.add('error-branch'); derived.push(`error-branch (${errorEdges} error edges)`); }
  }
  const byRef = item.graph.nodes.filter(n => n.category === 'subworkflow' && !isInlinedComfySubgraph(item, n));
  const inlinedComfy = item.graph.nodes.filter(n => n.category === 'subworkflow' && isInlinedComfySubgraph(item, n)).length;
  if (byRef.length && !out.has('subworkflow-call')) {
    if (modelRead) notApplied.push(`${byRef.length} sub-workflow node${byRef.length > 1 ? 's' : ''}`);
    else { out.add('subworkflow-call'); derived.push(`subworkflow-call (${byRef.length} by-reference sub-workflow nodes)`); }
  }
  if (!byRef.length && out.has('subworkflow-call') && inlinedComfy) { out.delete('subworkflow-call'); native.push(`${inlinedComfy} ComfyUI subgraph instance(s) whose definitions are inlined in the file`); }
  if (notApplied.length) log.agentic.graphEvidenceNotApplied.push({ id: item.id, verdict: pv.kind === 'unsupported' ? orig : null, evidence: notApplied });
  const n = item.graph.nodes.length;
  if (n > 500 && !out.has('flow-size>500')) { out.add('flow-size>500'); derived.push(`flow-size>500 (${n} nodes)`); }
  if (n <= 500 && out.has('flow-size>500')) { out.delete('flow-size>500'); native.push(`converter counted >500 source actions; the normalized graph has ${n} nodes`); }
  const cyclic = hasCycleOutsideLoopEdges(item);
  if (cyclic && !out.has('unstructured-cycle')) (modelRead ? log.agentic.modelDrivenCycles : log.cycleArtifacts).push(item.id);

  const constructs = sortConstructs([...out]);
  const verdict = pv.kind === 'unsupported' ? orig : constructs.length ? `via-extension:${constructs.join('+')}` : 'native';
  const parts = [
    `Canonical verdict (merge-items.mjs; Phase 1 IR = schemas/workflow.schema.json + core-20261006/DESIGN.md): ${verdict}` +
      (pv.kind === 'unsupported' && constructs.length ? `; also needs ${constructs.join(', ')}` : '') + '.',
    `IR mapping: ${irMapping(item)}.`,
  ];
  if (native.length) parts.push(`Native under Phase 1: ${native.join('; ')}.`);
  if (derived.length) parts.push(`From graph evidence: ${derived.join('; ')}.`);
  if (notApplied.length) parts.push(`Graph evidence judged by the readers, not re-derived: ${notApplied.join(', ')}.`);
  if (cyclic && !out.has('unstructured-cycle')) parts.push(modelRead
    ? 'Cycle without loop edges: a model-driven loop that the verdict carries (rules BL, UC).'
    : 'The normalized graph has a cycle over data/control edges that comes from static edge inference (wildcard matching, may-flow channels, subgraph wiring or stage barriers), not from a loop in the source; treated as a DAG.');
  if (orig !== verdict) parts.push(`Converter verdict: ${orig}.`);
  parts.push(`${modelRead ? 'Extractor notes (harmonised)' : 'Converter notes'}: ${item.ir.notes}`);
  let notes = parts.join(' ');
  if (notes.length > 2000) notes = notes.slice(0, 1999) + '…';
  return { verdict, notes, constructs };
}

// ---------------------------------------------------------------- repairs
const URL_SAFE = /[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g;
function repair(item, cluster) {
  const id = item.id;
  for (const k of Object.keys(item)) if (!ITEM_KEYS.includes(k)) { delete item[k]; fix('strip-extra-key', id, k, cluster); }
  for (const k of Object.keys(item.source)) if (!SOURCE_KEYS.includes(k)) { delete item.source[k]; fix('strip-extra-key', id, `source.${k}`, cluster); }
  if (typeof item.source.url === 'string' && new RegExp(URL_SAFE.source).test(item.source.url)) {
    item.source.url = item.source.url.replace(URL_SAFE, ch => encodeURIComponent(ch));
    fix('url-percent-encoded', id, undefined, cluster);
  }
  if (item.source.redistributable && NON_REDISTRIBUTABLE_LICENCE.test(item.source.license)) {
    // consumer-creative treated GPL-3.0 as redistributable; the other clusters did not. Apply the conservative policy everywhere:
    // keep URL, title, a written description, the derived graph with type-level summaries, and the features.
    item.source.redistributable = false;
    for (const n of item.graph.nodes) n.summary = String(n.type).slice(0, 80);
    fix('copyleft-made-non-redistributable', id, item.source.license, cluster);
  }
  if (!item.source.redistributable && item.description.text && item.description.provenance !== 'written') {
    item.description = { text: '', provenance: 'written' };
    fix('description-blanked-not-redistributable', id, undefined, cluster);
  }
  for (const n of item.graph.nodes) {
    for (const k of Object.keys(n)) if (!NODE_KEYS.includes(k)) { delete n[k]; fix('strip-extra-key', id, `node.${k}`, cluster); }
    if (typeof n.summary === 'string' && n.summary.length > 200) { n.summary = n.summary.slice(0, 199) + '…'; fix('summary-trimmed', id, undefined, cluster); }
  }
  const ids = new Set(item.graph.nodes.map(n => n.id));
  const seen = new Set();
  item.graph.edges = item.graph.edges.filter(e => {
    for (const k of Object.keys(e)) if (!EDGE_KEYS.includes(k)) { delete e[k]; fix('strip-extra-key', id, `edge.${k}`, cluster); }
    if (!ids.has(e.from) || !ids.has(e.to)) { fix('edge-dangling-dropped', id, `${e.from}->${e.to}`, cluster); return false; }
    const key = `${e.from}\u0000${e.to}\u0000${e.kind}`;
    if (seen.has(key)) { fix('edge-duplicate-dropped', id, `${e.from}->${e.to} ${e.kind}`, cluster); return false; }
    seen.add(key);
    return true;
  });
}

function recomputeFeatures(item, cluster, constructs) {
  const f = item.features, g = graphFeatures(item);
  const next = { ...f };
  for (const k of ['nodeCount', 'edgeCount', 'maxFanOut', 'humanSteps', 'hasCode', 'hasModelCalls']) next[k] = g[k];
  next.effects = g.effects;
  next.branching = Math.max(f.branching, g.conditionNodes);
  next.loops = Math.max(f.loops, g.loopNodes);
  next.subworkflows = Math.max(f.subworkflows, g.subworkflowNodes);
  const asy = new Set(f.async.filter(a => ASYNC.includes(a)));
  if (g.waitNodes || constructs.includes('signal-wait') || constructs.includes('durable-wait')) asy.add('wait');
  for (const [t, a] of [['schedule-trigger', 'schedule'], ['webhook-trigger', 'webhook'], ['event-trigger', 'event'], ['poll-trigger', 'poll']])
    if (constructs.includes(t)) asy.add(a);
  next.async = [...asy].sort();
  const templated = f.connectors.filter(c => /\{[%{]/.test(String(c)));   // Jinja fragments mis-read as connector names
  if (templated.length) fix('connector-template-fragment-dropped', item.id, templated.join(', ').slice(0, 80), cluster);
  next.connectors = [...new Set(f.connectors.map(c => String(c).trim()).filter(c => c && !/\{[%{]/.test(c)))].sort();
  next.domains = [...new Set(f.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean))];
  const ordered = {};
  for (const k of FEATURE_KEYS) ordered[k] = next[k];
  for (const k of FEATURE_KEYS) {
    if (JSON.stringify(f[k]) !== JSON.stringify(ordered[k])) {
      const fc = (log.featureChanges[k] ??= {});
      fc[cluster] = (fc[cluster] ?? 0) + 1;
    }
  }
  item.features = ordered;
}

// ---------------------------------------------------------------- dedupe
const normTitle = t => String(t).toLowerCase().replace(/\([^)]*\)/g, '').replace(/\.latest\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const PROV_RANK = { original: 3, 'recovered-by-model': 2, written: 1 };
const better = (a, b) => // true when a should be kept over b
  (a.source.redistributable !== b.source.redistributable) ? a.source.redistributable
    : (PROV_RANK[a.description.provenance] !== PROV_RANK[b.description.provenance]) ? PROV_RANK[a.description.provenance] > PROV_RANK[b.description.provenance]
      : (a.description.text.length !== b.description.text.length) ? a.description.text.length > b.description.text.length
        : a.id.length !== b.id.length ? a.id.length < b.id.length : a.id < b.id;
function contentKey(item) {
  const lab = new Map(item.graph.nodes.map(n => [n.id, `${n.type}|${n.category}|${n.effects}|${n.summary}`]));
  const nodes = [...lab.values()].sort();
  const edges = item.graph.edges.map(e => `${lab.get(e.from)}>${lab.get(e.to)}>${e.kind}`).sort();
  return sha256(JSON.stringify([item.source.platform, nodes, edges]));
}

// ---------------------------------------------------------------- main
const rank = f => { const i = CLUSTER_ORDER.indexOf(f.slice(0, -6)); return i < 0 ? CLUSTER_ORDER.length : i; };
const partFiles = fs.readdirSync(PARTS).filter(f => f.endsWith('.jsonl')).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const inputs = [];
const kept = [];
for (const file of partFiles) {
  const cluster = file.slice(0, -6);
  const raw = fs.readFileSync(path.join(PARTS, file));
  const lines = raw.toString('utf8').split('\n').filter(l => l.trim());
  inputs.push({ part: `parts/${file}`, cluster, lines: lines.length, bytes: raw.length, sha256: sha256(raw) });
  lines.forEach((line, i) => {
    let item;
    try { item = JSON.parse(line); } catch (e) { log.drops.push({ part: file, line: i + 1, id: null, reason: 'json', detail: e.message.slice(0, 160) }); return; }
    const pre = validateItem(item);
    const structural = pre.filter(e => ['item.object', 'item.missing-key', 'source.object', 'graph', 'features', 'ir', 'description', 'oracle'].includes(e.rule));
    if (structural.length) { log.drops.push({ part: file, line: i + 1, id: item?.id ?? null, reason: 'shape', detail: structural.map(e => e.msg).join('; ').slice(0, 300) }); return; }
    repair(item, cluster);
    const before = item.ir.verdict;
    const { verdict, notes, constructs } = canonicalVerdict(item, cluster);
    item.ir = { verdict, notes };
    if (before !== verdict) { log.verdict.changed++; log.verdict.byCluster[cluster] = (log.verdict.byCluster[cluster] ?? 0) + 1; }

    recomputeFeatures(item, cluster, constructs);
    const errors = validateItem(item, { canonical: true });
    if (errors.length) { log.drops.push({ part: file, line: i + 1, id: item.id, reason: 'invalid-after-repair', detail: errors.map(e => `${e.rule}: ${e.msg}`).join('; ').slice(0, 400) }); return; }
    kept.push({ item, cluster, part: file, line: i + 1, before });
  });
}

// exact id collisions across parts: keep the first (clusters were acquired independently)
const byId = new Map();
for (const k of kept) {
  if (byId.has(k.item.id)) { log.drops.push({ part: k.part, line: k.line, id: k.item.id, reason: 'duplicate-id', detail: `also in ${byId.get(k.item.id).part}` }); k.drop = true; }
  else byId.set(k.item.id, k);
}
// content duplicates
const groups = new Map();
for (const k of kept.filter(k => !k.drop)) {
  const key = contentKey(k.item);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(k);
}
for (const members of groups.values()) {
  if (members.length < 2) continue;
  const alive = [...members];
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i].item, b = alive[j].item;
      const sameTitle = normTitle(a.title) && normTitle(a.title) === normTitle(b.title);
      const sameDesc = a.description.text && a.description.text === b.description.text;
      if (!sameTitle && !sameDesc) continue;
      const [keep, drop] = better(a, b) ? [alive[i], alive[j]] : [alive[j], alive[i]];
      drop.drop = true;
      log.dedupe.dropped.push({ dropped: drop.item.id, kept: keep.item.id, why: sameTitle ? 'same graph and title' : 'same graph and description' });
      alive.splice(alive.indexOf(drop), 1);
      i = -1; break;
    }
  }
  if (alive.length > 1) log.dedupe.shapeTwinsKept.push(alive.map(k => k.item.id));
}

const final = kept.filter(k => !k.drop)
  .sort((a, b) => rank(a.part) - rank(b.part) || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
const kindOf = v => String(v).split(':')[0];
for (const k of final) { // after de-duplication, so the counts describe items.jsonl
  const tr = `${k.cluster}: ${kindOf(k.before)} -> ${kindOf(k.item.ir.verdict)}`;
  log.verdict.kindTransitions[tr] = (log.verdict.kindTransitions[tr] ?? 0) + 1;
}
const body = final.map(k => JSON.stringify(k.item)).join('\n') + '\n';
fs.writeFileSync(OUT, body);

for (const [k, v] of Object.entries(log.verdict.tokenMap)) log.verdict.tokenMap[k] = [...v].sort();
const out = {
  generator: 'research/corpus-20261006/scripts/merge-items.mjs',
  generatedAt: new Date().toISOString().slice(0, 10),
  inputs,
  output: { path: path.relative(path.join(HERE, '..'), OUT), items: final.length, bytes: Buffer.byteLength(body), sha256: sha256(body),
    byCluster: Object.fromEntries(CLUSTER_ORDER.map(c => [c, final.filter(k => k.cluster === c).length])),
    firstParty: { platforms: FIRST_PARTY_PLATFORMS, items: final.filter(k => isFirstParty(k.item)).length } },
  constructs: CONSTRUCT_IDS,
  ...log,
};
fs.writeFileSync(LOG, JSON.stringify(out, null, 1) + '\n');
console.log(`items: ${final.length} written to ${OUT} (${(Buffer.byteLength(body) / 1e6).toFixed(1)} MB); dropped ${log.drops.length} invalid, ${log.dedupe.dropped.length} duplicates; ` +
  `verdicts changed ${log.verdict.changed}; fixes ${Object.entries(log.fixes).map(([k, v]) => `${k}=${v.count}`).join(', ') || 'none'}`);
