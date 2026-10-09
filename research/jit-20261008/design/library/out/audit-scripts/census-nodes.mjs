// pattern-census.mjs: L1 pattern catalog coverage over the workflow corpus ($0, no model calls, no network).
// Design: research/jit-20261008/design/library/L1-PATTERNS.md. Input: research/corpus-20261006/items.jsonl (read only).
// Corpus text is data: only graph structure, node category/effects/type and type-level summaries are read, as features.
//
//   node research/jit-20261008/design/library/tools/pattern-census.mjs            # coverage + per-pattern support + edge cases
//   CLUSTER=1 node --max-old-space-size=2048 research/jit-20261008/design/library/tools/pattern-census.mjs   # + cross-platform clustering (census distance)
//
// What it computes (definitions in L1-PATTERNS.md §1):
// - every CONTROL node (category trigger, condition, loop, human, model, wait, subworkflow, merge, error-handler, or a node with an
//   outgoing error edge) is assigned by a fixed rule list either to an L0 construct (plain judge / if / join / input / notify /
//   media) or to an L1 pattern id; every IR verdict token is assigned to the L1 pattern that provides its construct;
// - an item is DECIDED when it is refused (verdict unsupported:*) or every control node and token is explained by the catalog;
//   COVERED-FLAT when explained with <= BUDGET distinct L1 patterns (the Haiku expansion budget), COVERED-HIER when it needs more
//   (constructed as a parent plus called sub-workflows);
// - the greedy curve: coverage as patterns are added in order of marginal gain;
// - plumbing idioms (linear pipeline, fetch-transform-write, reconcile, dedupe, best-of-N, ...) are detected for support counts
//   only; they never decide coverage (a DAG of steps is always expressible as straight-line code in L0);
// - per pattern: items, platforms, clusters, oracle-bearing items, example ids, and edge-case keyword counts mined from the
//   anchor nodes' type-level summaries (timeouts, retries, fallbacks, ...).
// The rule list is total for non-refused items by construction (every control category has a default); L1-PATTERNS.md §1.3
// says what that does and does not prove, and reports how many nodes fell to a default rule.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../..');
const CORPUS = path.join(ROOT, 'research/corpus-20261006/items.jsonl');
const OUT = path.resolve(HERE, '..');
const BUDGET = Number(process.env.BUDGET ?? 5);

// ------------------------------------------------------------------------------------------------ catalog
// id, name, family. Order here is presentation order, not the greedy order.
export const CATALOG = [
  ['P01', 'linear pipeline with typed hand-offs', 'spine'],
  ['P02', 'fetch -> transform -> write (sync / ETL)', 'spine'],
  ['P03', 'extract -> normalise -> validate (model reading, code parsing)', 'spine'],
  ['P04', 'draft -> check -> deliver (generated content before an effect)', 'spine'],
  ['P05', 'prompt chain with typed hand-offs', 'spine'],
  ['P06', 'retrieve -> generate (untrusted context)', 'spine'],
  ['P07', 'router by kind (judged classify, then dispatch)', 'branch'],
  ['P08', 'guard -> act (filter before an effect)', 'branch'],
  ['P09', 'judge -> confidence gate -> review queue (escalate, never guess)', 'branch'],
  ['P10', 'human menu dispatch (choice -> branches, optional repeat)', 'branch'],
  ['P12', 'map -> code reduce (for-each, typed coverage)', 'fan'],
  ['P13', 'batched extract (map with a judge body, id echo)', 'fan'],
  ['P14', 'scatter -> parallel branches -> gather', 'fan'],
  ['P15', 'fan-in aggregate / report', 'fan'],
  ['P16', 'dedupe by identity (blocking + pairwise judge + union-find)', 'fan'],
  ['P17', 'reconcile two sources (join, diff, classify discrepancies)', 'fan'],
  ['P18', 'best-of-N / sectioning with a verifier', 'fan'],
  ['P19', 'planned fan-out (wide) / bounded expansion (plan)', 'fan'],
  ['P20', 'generate -> verify -> retry (bounded)', 'loop'],
  ['P21', 'poll until ready (wait + check, timeout)', 'loop'],
  ['P22', 'loop until condition / dry (convergence cap)', 'loop'],
  ['P23', 'paginate with a cursor', 'loop'],
  ['P25', 'bounded state machine (cycles with several entries)', 'loop'],
  ['P26', 'retry with backoff / adaptive retry', 'failure'],
  ['P27', 'error route -> notify / cleanup (error workflow)', 'failure'],
  ['P28', 'fallback on error (alternative path, rejoin)', 'failure'],
  ['P29', 'finally / completion hook (teardown always runs)', 'failure'],
  ['P30', 'saga: steps with compensation', 'failure'],
  ['P31', 'checkpoint -> resume / continue-as-new', 'failure'],
  ['P32', 'approval gate before an effect (timeout routing)', 'human'],
  ['P33', 'wait for signal / external event (with timeout)', 'async'],
  ['P34', 'durable delay / debounce -> re-check -> act', 'async'],
  ['P35', 'interrupt -> resume inside an agent node', 'async'],
  ['P36', 'scheduled batch (schedule -> read -> process -> write)', 'trigger'],
  ['P37', 'webhook -> validate -> act -> respond', 'trigger'],
  ['P38', 'event -> guard -> act (automation rule)', 'trigger'],
  ['P39', 'poll -> diff -> notify (cursor in state)', 'trigger'],
  ['P40', 'run admission policy (single / queue / restart / parallel)', 'trigger'],
  ['P41', 'build -> test -> gate -> release (CI stage barrier)', 'trigger'],
  ['P42', 'cross-run state: seen-set / cursor / counter', 'state'],
  ['P43', 'conversational session (turn with bounded memory)', 'state'],
  ['P44', 'bounded stream consumer / partial outputs', 'state'],
  ['P45', 'capped tool loop (agent node + parent-side verify)', 'agentic'],
  ['P46', 'supervisor -> agents as typed tools', 'agentic'],
  ['P47', 'model-written code in a sandbox -> run -> check', 'agentic'],
  ['P48', 'guardrail tripwire (parallel check aborts)', 'agentic'],
  ['P49', 'verify panel (independent verifiers vote)', 'agentic'],
  ['P50', 'evidence -> hypothesis -> check (diagnosis) / env session', 'agentic'],
  ['P51', 'summarise-map-reduce / context compaction', 'agentic'],
  ['P53', 'sub-workflow per item (map over call)', 'compose'],
  ['P54', 'decompose into called sub-workflows (call by hash)', 'compose'],
  ['P55', 'ask -> validate -> use (human input as untrusted data)', 'human'],
  ['P56', 'media generation chain (tool bindings)', 'spine'],
  ['P57', 'caller-supplied action list (typed plan fragment)', 'compose'],
];
const NAME = Object.fromEntries(CATALOG.map(([id, name]) => [id, name]));
const FAMILY = Object.fromEntries(CATALOG.map(([id, , f]) => [id, f]));
const PLUMBING = new Set(['P01', 'P02', 'P16', 'P17', 'P18', 'P30', 'P49', 'P50', 'P51']);   // support-only detectors may also fire

const CLUSTER = {
  automation: ['activepieces', 'coze', 'dify', 'flowise', 'langflow', 'n8n', 'node-red', 'zapier'],
  orchestration: ['airflow', 'argo', 'dagster', 'github-actions', 'gitlab-ci', 'kubeflow', 'prefect', 'tekton', 'temporal'],
  science: ['cwl', 'galaxy', 'nextflow', 'nf-core', 'snakemake', 'wdl'],
  'consumer-creative': ['apple-shortcuts', 'comfyui', 'home-assistant', 'ifttt'],
};
const clusterOf = p => (p === 'claude-code-workflows' ? 'first-party' : Object.entries(CLUSTER).find(([, ps]) => ps.includes(p))?.[0] ?? 'agentic');

// verdict token -> pattern(s) that provide its construct (first listed is the default when none of them fired structurally)
const TOKEN = {
  'webhook-trigger': ['P37'], 'event-trigger': ['P38'], 'schedule-trigger': ['P36'], 'poll-trigger': ['P39'], 'run-concurrency-policy': ['P40'],
  'error-branch': ['P27', 'P28'], 'completion-hook': ['P29'], 'adaptive-retry': ['P26'],
  'subworkflow-call': ['P54', 'P53', 'P46'], 'flow-size>500': ['P54'],
  'cross-run-state': ['P42', 'P43'], 'chat-session': ['P43'], 'agent-tool-loop': ['P45'], 'signal-wait': ['P33'], 'durable-wait': ['P34'],
  stream: ['P44'], 'partial-output-stream': ['P44'], 'unstructured-cycle': ['P25'], 'parametric-action-input': ['P57'], 'dynamic-dag': ['P19'],
  'dynamic-agent-spawn': ['P19'], 'shared-scratchpad': ['P19'], 'state-reducer': ['P19'], 'model-generated-code-exec': ['P47'],
  'agent-as-tool': ['P46'], 'interrupt-resume': ['P35'], 'guardrail-tripwire': ['P48'], 'checkpoint-rewind': ['P31'],
  'context-compaction': ['P51'], 'env-session': ['P50'], 'multimodal-io': ['L0:media'],
};
// Tokens whose pattern is a REWRITE (stated semantic change), not an exact rendering.
const REWRITE_TOKENS = new Set(['shared-scratchpad', 'state-reducer']);

// ------------------------------------------------------------------------------------------------ graph helpers
const norm = s => String(s ?? '').toLowerCase();
function graphOf(it) {
  const nodes = it.graph.nodes, byId = new Map(nodes.map(n => [n.id, n]));
  const succ = new Map(nodes.map(n => [n.id, new Set()])), pred = new Map(nodes.map(n => [n.id, new Set()]));
  const errOut = new Map(nodes.map(n => [n.id, new Set()]));
  for (const e of it.graph.edges ?? []) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    if (e.kind === 'error') { errOut.get(e.from).add(e.to); continue; }
    succ.get(e.from).add(e.to); pred.get(e.to).add(e.from);
  }
  // SCCs (Tarjan, iterative) over control/data/loop edges
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [], scc = new Map(); let idx = 0, sccId = 0;
  for (const start of nodes.map(n => n.id)) {
    if (index.has(start)) continue;
    const work = [[start, [...succ.get(start)], 0]]; index.set(start, idx); low.set(start, idx); idx++; stack.push(start); onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1], [v, ws] = top;
      if (top[2] < ws.length) {
        const w = ws[top[2]++];
        if (!index.has(w)) { index.set(w, idx); low.set(w, idx); idx++; stack.push(w); onStack.add(w); work.push([w, [...succ.get(w)], 0]); }
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u), low.get(v))); }
        if (low.get(v) === index.get(v)) { let w; const members = []; do { w = stack.pop(); onStack.delete(w); members.push(w); } while (w !== v); for (const m of members) scc.set(m, { id: sccId, size: members.length }); sccId++; }
      }
    }
  }
  const within = (start, k, dir) => { const m = dir === 'up' ? pred : succ; const seen = new Set([start]); let front = [start]; for (let d = 0; d < k; d++) { const nx = []; for (const x of front) for (const y of m.get(x)) if (!seen.has(y)) { seen.add(y); nx.push(y); } front = nx; } seen.delete(start); return [...seen].map(id => byId.get(id)); };
  const inCycle = id => (scc.get(id)?.size ?? 1) > 1;
  const sameScc = id => { const s = scc.get(id); return s && s.size > 1 ? nodes.filter(n => scc.get(n.id).id === s.id) : []; };
  return { nodes, byId, succ, pred, errOut, within, inCycle, sameScc };
}
const T = n => norm(n.type), S = n => norm(n.summary), TS = n => `${T(n)} ${S(n)}`;
const isEffect = n => n.effects === 'write' || n.effects === 'external';
const has = (arr, f) => arr.some(f);

// ------------------------------------------------------------------------------------------------ rules
// Each returns {p, rule} where p is an L1 id or an 'L0:*' construct; rule names the branch taken (default rules are flagged).
function triggerKind(n, it) {
  const s = TS(n), a = new Set(it.features.async ?? []);
  if (/@once|manual|executeworkflowtrigger|sub-?workflow.*trigger|workflow_call|\bentry\b|^start|shortcuts\.input|chatinput|chat-?trigger|inputreceiver|workflow_dispatch/.test(s)) return 'input';
  if (/schedul|cron|interval|every_|time_pattern|trigger\.time\b|@daily|@hourly|@weekly|timer/.test(s)) return 'schedule';
  if (/poll|rss|feed/.test(s) && a.has('poll')) return 'poll';
  if (/webhook|http|form|pull_request|\bpush\b|pipeline-source|merge_request|api/.test(s)) return 'webhook';
  if (/trigger|event|state|sensor|mqtt|device|zone|sun|calendar|telegram|slack|gmail|drive|github|issue/.test(s)) return a.has('poll') && !a.has('event') ? 'poll' : 'event';
  for (const k of ['schedule', 'webhook', 'event', 'poll']) if (a.has(k)) return k;
  return 'input';
}
const TRIG = { schedule: 'P36', webhook: 'P37', event: 'P38', poll: 'P39' };

function ruleFor(n, g, it, ctx) {
  const c = n.category, s = TS(n);
  const up2 = g.within(n.id, 2, 'up'), up3 = g.within(n.id, 3, 'up'), dn2 = g.within(n.id, 2, 'down'), dn3 = g.within(n.id, 3, 'down');
  const succN = [...g.succ.get(n.id)].map(id => g.byId.get(id));
  const tok = ctx.tokens;
  switch (c) {
    case 'trigger': { const k = triggerKind(n, it); return k === 'input' ? { p: 'L0:input', rule: 'trigger-as-input' } : { p: TRIG[k], rule: `trigger-${k}` }; }
    case 'condition': {
      const cyc = g.sameScc(n.id);
      if (cyc.length && !has(cyc, x => x.category === 'loop')) {
        if (has(cyc, x => x.category === 'wait')) return { p: 'P21', rule: 'cycle-with-wait' };
        if (has(cyc, x => x.category === 'model')) return { p: 'P20', rule: 'cycle-with-model' };
        if (has(cyc, x => x.category === 'human')) return { p: 'P25', rule: 'cycle-human-menu-machine' };
        return { p: 'P25', rule: 'unstructured-cycle' };
      }
      if (cyc.length && succN.length >= 2 && has(up2, x => x.category === 'model')) return { p: 'P07', rule: 'judged-branch-in-loop-body' };
      if (cyc.length && succN.length >= 2 && has(up3, x => x.category === 'human')) return { p: 'P10', rule: 'menu-in-loop-body' };
      if (cyc.length && succN.length >= 2 && !g.succ.get(n.id).has(cyc.find(x => x.category === 'loop').id)) return { p: 'L0:if', rule: 'code-branch-in-loop-body' };
      if (cyc.length) return { p: ctx.loopPatternOf(cyc.find(x => x.category === 'loop')), rule: 'loop-exit' };
      const trigUp = has(up2, x => x.category === 'trigger');
      if (trigUp && succN.length <= 1) { const k = triggerKind(up2.find(x => x.category === 'trigger'), it); if (k !== 'input') return { p: TRIG[k], rule: 'trigger-guard' }; }
      if (succN.length >= 2) {
        if (has(up3, x => x.category === 'human')) return { p: 'P10', rule: 'human-then-branch' };
        if (has(up2, x => x.category === 'model') || /classif|intent|router|question-classifier|semantic/.test(s)) return { p: 'P07', rule: 'judged-branch' };
        return { p: 'L0:if', rule: 'code-branch' };
      }
      if (/filter/.test(s) || has(dn2, isEffect)) return { p: 'P08', rule: 'guard-before-effect' };
      return { p: 'L0:guard', rule: 'code-guard' };
    }
    case 'loop': return { p: ctx.loopPatternOf(n), rule: ctx.loopRule.get(n.id) };
    case 'human': {
      if (/chat-turn|chat/.test(s)) return { p: 'P43', rule: 'chat-turn' };
      if (/wait_for_trigger|wait_condition|signal/.test(s)) return { p: 'P33', rule: 'human-as-signal' };
      if (/approv|hitl|review|confirm|manual|when: ?manual/.test(s) || ['gitlab-ci', 'github-actions'].includes(it.source.platform)) return { p: 'P32', rule: 'approval-typed' };
      if (has(up3, x => x.category === 'model') && has(up2, x => x.category === 'condition') && !/menu|choosefrom|list|select/.test(s)) return { p: 'P09', rule: 'judge-gate-then-human' };
      const gate = dn2.find(x => x.category === 'condition');
      if (gate && has(g.within(gate.id, 2, 'down'), isEffect) && !/menu|choosefrom|list/.test(s)) return { p: 'P32', rule: 'human-gate-before-effect' };
      if (/menu|choosefrom|choose|list|select/.test(s) || (gate && g.succ.get(gate.id).size >= 2)) return { p: 'P10', rule: 'menu' };
      if (/alert|notification|show|speak|quicklook|vibrate|share|preview/.test(s)) return { p: 'L0:notify', rule: 'output-display' };
      return { p: 'P55', rule: /ask|input|picker|take|scan|file|photo|contact|form|text/.test(s) ? 'ask-input' : 'ask-input(default)' };
    }
    case 'model': {
      if (it.source.platform === 'comfyui' || /ksampler|vae|clip|diffusion|sampler|unet|lora|checkpointloader|controlnet|upscale|image ?gen|text-?to-?(image|speech|video)|tts|whisper|dall/.test(s)) return { p: 'P56', rule: 'media-model' };
      if (tok.has('agent-as-tool') && /supervisor|manager|orchestr|coordinat|triage|planner|router-agent|lead/.test(s)) return { p: 'P46', rule: 'supervisor-agent' };
      if (tok.has('agent-tool-loop') && /agent|tool|react|assistant|crew|swarm|runner/.test(s)) return { p: 'P45', rule: 'agent-with-tools' };
      if (tok.has('model-generated-code-exec') && /code|python|interpreter|exec/.test(s)) return { p: 'P47', rule: 'code-writing-model' };
      if (/embed|vector|retriev|rerank/.test(s)) return { p: 'P06', rule: 'embedding-retrieval' };
      if (/summar|compact|condens/.test(s)) return { p: 'P51', rule: 'summariser' };
      if (/classif|categor|router|sentiment|intent|question-classifier/.test(s) || has(dn2, x => x.category === 'condition' && g.succ.get(x.id).size >= 2)) return { p: 'P07', rule: 'classify-then-route' };
      if (g.inCycle(n.id) && has(g.sameScc(n.id), x => x.category === 'condition' || /verif|check|valid|critic|review|eval|grade|judge/.test(TS(x)))) return { p: 'P20', rule: 'model-in-check-cycle' };
      if (has(up2, x => x.effects === 'read' || /retriev|vector|search|document|loader|knowledge|rag/.test(TS(x)))) return { p: 'P06', rule: 'read-then-model' };
      if (has(dn2, x => x.category === 'model')) return { p: 'P05', rule: 'model-chain' };
      if (has(dn2, x => x.category === 'code' || x.category === 'transform')) return { p: 'P03', rule: 'model-then-code' };
      if (has(dn2, isEffect)) return { p: 'P04', rule: 'model-then-effect' };
      if (tok.has('agent-tool-loop') && /agent/.test(s)) return { p: 'P45', rule: 'agent-default' };
      return { p: 'L0:judge', rule: 'single-judgment' };
    }
    case 'wait': {
      if (g.inCycle(n.id) || /sensor|poke/.test(s)) return { p: 'P21', rule: 'wait-in-loop-or-sensor' };
      if (/wait_for_trigger|signal|wait_condition|await|waittoreturn|resume|webhook|wait_template/.test(s) || tok.has('signal-wait')) return { p: 'P33', rule: 'wait-for-event' };
      if (has(dn2, x => x.category === 'condition')) return { p: 'P34', rule: 'delay-then-recheck' };
      return { p: 'P34', rule: 'durable-delay' };
    }
    case 'subworkflow': {
      if (has(up3, x => x.category === 'loop') || g.inCycle(n.id)) return { p: 'P53', rule: 'call-per-item' };
      if (/toolworkflow|tool$|as.?tool|agent/.test(s)) return { p: 'P46', rule: 'workflow-as-tool' };
      return { p: 'P54', rule: 'call' };
    }
    case 'merge': {
      const preds = [...g.pred.get(n.id)];
      const condAnc = preds.map(p => new Set(g.within(p, 4, 'up').filter(x => x.category === 'condition').map(x => x.id)));
      const shared = condAnc.length >= 2 && [...condAnc[0]].some(id => condAnc.slice(1).every(s => s.has(id)));
      if (shared || /pick_value|variable-aggregator|coalesce/.test(s)) return { p: 'L0:join', rule: 'branch-reconverge' };
      if (preds.length >= 5) return { p: 'P15', rule: 'wide-fan-in' };
      if (/barrier|stage/.test(s) && ['gitlab-ci', 'github-actions', 'tekton', 'argo'].includes(it.source.platform)) return { p: 'P41', rule: 'ci-stage-barrier' };
      return { p: 'P14', rule: 'gather' };
    }
    case 'error-handler': {
      if (tok.has('adaptive-retry') && /retry|attempt/.test(s)) return { p: 'P26', rule: 'retry-handler' };
      if (/teardown|finally|always|post|cleanup|complete/.test(s) || (tok.has('completion-hook') && !/onerror|errortrigger|catch|failure/.test(s))) return { p: 'P29', rule: 'finally' };
      const outs = [...g.succ.get(n.id)].map(id => g.byId.get(id));
      if (has(outs, x => x.category === 'merge') || has(outs, x => x.category !== 'error-handler' && !isEffect(x) && g.pred.get(x.id).size > 1)) return { p: 'P28', rule: 'handler-rejoins' };
      return { p: 'P27', rule: /onerror|errortrigger|catch|stopanderror|exception|failure|fail/.test(s) ? 'error-route' : 'error-route(default)' };
    }
    default: {   // a plumbing node that has an outgoing error edge
      const tgt = [...g.errOut.get(n.id)].map(id => g.byId.get(id));
      if (has(tgt, x => x.category === 'error-handler')) return { p: 'P27', rule: 'error-edge-to-handler' };
      return { p: 'P28', rule: 'error-edge-to-alternative' };
    }
  }
}

function loopRules(g, it, tokens) {
  const pat = new Map(), why = new Map();
  for (const n of g.nodes) if (n.category === 'loop') {
    let body = g.sameScc(n.id).filter(x => x.id !== n.id);
    if (!body.length) body = g.within(n.id, 2, 'down');
    const s = TS(n), any = f => body.some(f);
    let p, r;
    if (any(x => x.category === 'wait')) [p, r] = ['P21', 'loop-with-wait'];
    else if (/continue_as_new|\bcan\b/.test(s)) [p, r] = ['P31', 'continue-as-new'];
    else if (any(x => x.category === 'model') && (any(x => x.category === 'condition') || /until|while|retry|loopagent|loop$/.test(s)) && !/each|items|batch|iteration|split/.test(s)) [p, r] = ['P20', 'model-loop-with-check'];
    else if (any(x => x.category === 'human')) [p, r] = ['P10', 'interactive-repeat'];
    else if (any(x => x.category === 'subworkflow')) [p, r] = ['P53', 'loop-over-call'];
    else if (any(x => x.category === 'model')) [p, r] = ['P13', 'map-with-judge-body'];
    else if (/until|while/.test(s) && any(x => x.effects === 'read') && !any(x => x.effects === 'write')) [p, r] = [/page|cursor|offset|next/.test(body.map(TS).join(' ')) ? 'P23' : 'P22', 'read-loop-until'];
    else if (/until|while/.test(s)) [p, r] = ['P22', 'loop-until'];
    else [p, r] = ['P12', 'for-each(default)'];
    pat.set(n.id, p); why.set(n.id, r);
  }
  return { loopPatternOf: n => pat.get(n?.id) ?? 'P22', loopRule: why };
}

// support-only idiom detectors (never decide coverage)
function plumbing(g, it) {
  const out = new Set(), wit = {}, N = g.nodes;
  const W = (p, ...ns) => { out.add(p); wit[p] ??= ns.flat().filter(Boolean).map(x => N.indexOf(x)); };
  const plumb = x => ['action', 'transform', 'code', 'other'].includes(x.category);
  for (const n of N) if (plumb(n) && g.pred.get(n.id).size <= 1 && g.succ.get(n.id).size === 1) {
    const b = g.byId.get([...g.succ.get(n.id)][0]);
    if (b && plumb(b) && g.succ.get(b.id).size === 1) { const c = g.byId.get([...g.succ.get(b.id)][0]); if (c && plumb(c)) { W('P01', n, b, c); break; } }
  }
  for (const n of N) if (n.effects === 'read') { const d = g.within(n.id, 3, 'down'); const t = d.find(x => (x.category === 'transform' || x.category === 'code') && x.effects === 'none'); const w = d.find(x => x.effects === 'write' || x.effects === 'external'); if (t && w) { W('P02', n, t, w); break; } }
  if (clusterOf(it.source.platform) !== 'science') { const h = N.filter(x => /dedup|duplicate|unique|distinct|union-?find|removeduplicates/.test(TS(x))); if (h.length) W('P16', h.slice(0, 3)); }
  for (const n of N) { const r = g.within(n.id, 2, 'up').filter(x => x.effects === 'read'); if (r.length >= 2 && (has(g.within(n.id, 2, 'down'), x => x.category === 'condition') || /compar|diff|reconcil|match|merge/.test(TS(n)))) { W('P17', n, r.slice(0, 2)); break; } }
  for (const n of N) if ([...g.pred.get(n.id)].filter(id => g.byId.get(id).category === 'model').length >= 2) { W('P18', n, [...g.pred.get(n.id)].map(id => g.byId.get(id)).filter(x => x.category === 'model').slice(0, 3)); break; }
  { const h = N.filter(x => /compensat|rollback|revert|undo/.test(TS(x))); if (h.length) W('P30', h.slice(0, 3)); }
  for (const n of N) if ([...g.pred.get(n.id)].map(id => g.byId.get(id)).filter(x => x.category === 'model' && /judge|critic|review|verif|grade|evaluat/.test(TS(x))).length >= 2) { W('P49', n, [...g.pred.get(n.id)].map(id => g.byId.get(id)).filter(x => x.category === 'model' && /judge|critic|review|verif|grade|evaluat/.test(TS(x)))); break; }
  for (const n of N) if (n.category === 'model' && [...g.pred.get(n.id)].length >= 2 && has(g.within(n.id, 2, 'down'), x => x.category === 'condition') && /diagnos|root|cause|triage|hypothes|incident|analy/.test(TS(n))) { W('P50', n); break; }
  { const h = N.filter(x => x.category === 'model' && /summar|compact|condens/.test(TS(x))); if (h.length) W('P51', h.slice(0, 3)); }
  if (['github-actions', 'gitlab-ci', 'tekton', 'argo'].includes(it.source.platform) && has(N, x => x.category === 'merge' || g.pred.get(x.id).size >= 2) && has(N, x => /deploy|release|publish|push|upload/.test(TS(x)))) W('P41', N.find(x => x.category === 'merge' || g.pred.get(x.id).size >= 2), N.find(x => /deploy|release|publish|push|upload/.test(TS(x))));
  out.wit = wit; return out;
}

// edge-case keywords mined from anchor nodes and their neighbours (type-level summaries only)
const EDGE_KW = [
  ['timeout', /timeout|timed out|time_out/], ['retry', /retry|retries|attempt/], ['backoff/delay between tries', /backoff|waitbetween|retry_delay|delay/],
  ['continue-on-error / fail-fast off', /continue.?on.?(error|fail|timeout)|fail-fast: ?false|failfast|ignore_?errors?/], ['default / fallback value', /default|fallback|else/],
  ['rate limit / throttle', /rate.?limit|throttl|quota|429/], ['batch / chunk size', /batch|chunk|split ?in/], ['dedupe / duplicate', /dedup|duplicate|unique|distinct/],
  ['lock / concurrency', /lock|mutex|concurren|queue|single|restart/], ['cancel', /cancel|abort|stop/], ['approve / reject', /approv|reject|deny/],
  ['validate / schema', /validat|schema|assert|check/], ['checksum / integrity', /checksum|md5|sha|integrity|snapshot/], ['notify (slack/email/chat)', /slack|email|mail|telegram|discord|teams|notify|notification/],
  ['cache', /cache|memo/], ['pagination / cursor', /page|cursor|offset|since|last_?id|next_?token/], ['state store / memory', /memory|store|state|variable|kv|static ?data/],
];

// ------------------------------------------------------------------------------------------------ main
const items = fs.readFileSync(CORPUS, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const tokensOf = it => { const m = /^via-extension:(.*)$/.exec(it.ir.verdict); return new Set(m ? m[1].split('+') : []); };
const per = [];
const ruleCounts = {}, defaultNodes = { n: 0, of: 0 };
for (const it of items) {
  const plat = it.source.platform, cl = clusterOf(plat), hasOracle = (it.oracle?.kind ?? 'none') !== 'none';
  const row = { id: it.id, plat, cl, hasOracle, redistributable: !!it.source.redistributable, n: it.graph.nodes.length, verdict: it.ir.verdict, needs: {}, tokens: [], plumbing: [], status: null, rewrite: false };
  if (it.ir.verdict.startsWith('unsupported')) { row.status = 'refused'; row.refusal = it.ir.verdict.split(/[.\s]/)[0]; per.push(row); continue; }
  const g = graphOf(it), tokens = tokensOf(it);
  const lr = loopRules(g, it, tokens);
  const ctx = { tokens, ...lr };
  const anchors = {};   // pattern -> node ids
  for (const n of g.nodes) {
    const control = ['trigger', 'condition', 'loop', 'human', 'model', 'wait', 'subworkflow', 'merge', 'error-handler'].includes(n.category) || g.errOut.get(n.id).size > 0;
    if (!control) continue;
    const { p, rule } = ruleFor(n, g, it, ctx);
    const key = `${n.category}:${rule}`; ruleCounts[key] = ruleCounts[key] ?? { p, items: new Set(), nodes: 0 }; ruleCounts[key].items.add(it.id); ruleCounts[key].nodes++;
    defaultNodes.of++; if (/default/.test(rule)) defaultNodes.n++;
    (row.needs[p] ??= 0); row.needs[p]++;
    (row.nodeAssign ??= []).push({ idx: g.nodes.indexOf(n), id: n.id, cat: n.category, p, rule });
    (anchors[p] ??= []).push(n.id);
  }
  // tokens: explained by a pattern that fired structurally if possible, else the token's first pattern
  for (const t of tokens) {
    const opts = TOKEN[t];
    if (!opts) { row.tokens.push({ t, p: null }); continue; }
    const p = opts.find(o => row.needs[o]) ?? opts[0];
    row.tokens.push({ t, p });
    if (!row.needs[p]) row.needs[p] = 0;
    if (REWRITE_TOKENS.has(t)) row.rewrite = true;
  }
  const pl = plumbing(g, it); row.plumbing = [...pl]; row.witness = pl.wit;
  row.anchors = Object.fromEntries(Object.entries(anchors).map(([p, ids]) => [p, ids.slice(0, 50)]));
  row.edge = {};
  for (const [p, ids] of Object.entries(anchors)) {
    if (p.startsWith('L0')) continue;
    const near = new Set(ids); for (const id of ids) { for (const x of g.within(id, 1, 'down')) near.add(x.id); for (const x of g.within(id, 1, 'up')) near.add(x.id); for (const x of g.errOut.get(id)) near.add(x); }
    const text = [...near].map(id => TS(g.byId.get(id))).join(' \n ');
    row.edge[p] = EDGE_KW.filter(([, re]) => re.test(text)).map(([k]) => k);
  }
  per.push(row);
}

// ---- audit output: emit rows for the census-equality check and for pair/hit review
fs.writeFileSync(path.join(OUT, 'audit-scripts', 'census-nodes.out.jsonl'), per.map(r => JSON.stringify({ id: r.id, plat: r.plat, cl: r.cl, status: r.status, needs: r.needs, tokens: r.tokens, plumbing: r.plumbing, witness: r.witness ?? {}, nodeAssign: r.nodeAssign ?? [] })).join('\n') + '\n');
console.log('wrote', per.length);
