#!/usr/bin/env node
// Coverage report, manifest and git sample for the merged corpus.
//
// Usage: node coverage-report.mjs [--items ../items.jsonl]
// Reads items.jsonl + merge-log.json (from merge-items.mjs) and writes, next to items.jsonl:
//   COVERAGE.md          counts, licences, complexity quantiles, IR verdicts and missing constructs, the 30 most complex
//                        items, mined motifs vs skills/micro-harness/references/operators.md, oracles, pilot shortlist
//                        (sections 1-9: the four original clusters only, so their tables do not move when a cluster is
//                        added); section 10: the agentic cluster, its first-party slice apart, coverage under the 19
//                        original constructs vs all registry constructs, and a combined greedy order
//   MANIFEST.json        sources, revisions, licences, counts, sha256 of items.jsonl and the other files
//   items-sample.jsonl   <= 5 MB of redistributable items for git (written only when items.jsonl > 5 MB)
// Deterministic for a given items.jsonl. Corpus text is untrusted data: descriptions are quoted as data, escaped, cut.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CONSTRUCTS, CONSTRUCT_IDS, ORIGINAL_CONSTRUCT_COUNT, REFUSALS, FIRST_PARTY_PLATFORMS, parseVerdict, notesNeeds, isFirstParty, CATEGORIES } from './check-items.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REPO = path.join(ROOT, '..', '..');
const argIdx = process.argv.indexOf('--items');
const ITEMS = path.resolve(argIdx >= 0 ? process.argv[argIdx + 1] : path.join(ROOT, 'items.jsonl'));
const SAMPLE_LIMIT = 5_000_000;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

const itemsBuf = fs.readFileSync(ITEMS);
const lines = itemsBuf.toString('utf8').split('\n').filter(Boolean);
const allItems = lines.map(l => JSON.parse(l));
const lineOf = new Map(allItems.map((it, i) => [it.id, lines[i]]));
const lineBytes = new Map(allItems.map((it, i) => [it.id, Buffer.byteLength(lines[i]) + 1]));
const mergeLog = JSON.parse(fs.readFileSync(path.join(ROOT, 'merge-log.json'), 'utf8'));
// ORIG_CLUSTERS: the 1,342-item corpus of sections 1-9. AGENTIC: agent frameworks (parts/agentic.jsonl, section 10).
const ORIG_CLUSTERS = ['automation', 'orchestration', 'science', 'consumer-creative'];
const CLUSTERS = [...ORIG_CLUSTERS, 'agentic'];
const clusterOf = new Map();
const partNotes = new Map();   // full ir.notes of agentic items (items.jsonl cuts notes at 2,000 characters)
{
  // cluster membership from the part files (an item's id is unique across parts)
  for (const c of CLUSTERS) {
    const f = path.join(ROOT, 'parts', `${c}.jsonl`);
    if (!fs.existsSync(f)) continue;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l.trim()) { const it = JSON.parse(l); clusterOf.set(it.id, c); if (c === 'agentic') partNotes.set(it.id, it.ir.notes); }
  }
}
for (const it of allItems) it._cluster = clusterOf.get(it.id) ?? 'unknown';
const items = allItems.filter(i => ORIG_CLUSTERS.includes(i._cluster));
const agentic = allItems.filter(i => i._cluster === 'agentic');
const isOrigCluster = c => ORIG_CLUSTERS.includes(c);
const byPlatformOrder = list => {
  const pc = new Map(list.map(i => [i.source.platform, i._cluster]));
  return [...new Set(list.map(i => i.source.platform))].sort((a, b) => CLUSTERS.indexOf(pc.get(a)) - CLUSTERS.indexOf(pc.get(b)) || a.localeCompare(b));
};
const platforms = byPlatformOrder(items);
const allPlatforms = byPlatformOrder(allItems);
const platformCluster = new Map(allItems.map(i => [i.source.platform, i._cluster]));

// ---------------------------------------------------------------- helpers
const count = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
const sortedEntries = m => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
const pct = (a, b) => b ? `${(100 * a / b).toFixed(a / b < 0.1 && a ? 1 : 0)}%` : '-';
// cell: trusted text (this script's own vocabulary). esc: untrusted corpus text, stripped of markup so it renders as plain data.
const cell = s => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const clean = s => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/(^|\s)#+(?=\s)/g, ' ').replace(/[*_]{2,}/g, '').replace(/\s+/g, ' ').trim();
const esc = s => cell(clean(s).replace(/[`<>]/g, '').replace(/\[/g, '(').replace(/\]/g, ')'));
const idc = s => String(s ?? '').replace(/[`|\s]/g, '');
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const row = cells => `| ${cells.join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const fmt = x => Number.isInteger(x) ? String(x) : x >= 100 ? x.toFixed(0) : x.toFixed(1);
const constructsOf = it => parseVerdict(it.ir.verdict)?.tokens ?? [];
const verdictKind = it => parseVerdict(it.ir.verdict)?.kind ?? 'invalid';
// native | via-extension | refused-by-design (owner refusal, representable) | unsupported (not expressible) | invalid
const verdictClass = it => { const v = parseVerdict(it.ir.verdict); return !v ? 'invalid' : v.kind === 'unsupported' && v.byDesign ? 'refused-by-design' : v.kind; };
const REPRODUCE = 'cd research/corpus-20261006 && node scripts/agentic-assemble.mjs && node scripts/merge-items.mjs && node scripts/check-items.mjs items.jsonl --canonical && node scripts/coverage-report.mjs';

function licenceFamily(l) {
  if (l === 'unknown') return 'unknown';
  if (l.startsWith('ToS:')) return 'terms of service';
  if (/NC/.test(l)) return 'non-commercial';
  if (/^(A?GPL|LGPL|MPL|EPL|CC-BY-SA|CC-BY-NC-SA)/.test(l)) return 'copyleft / share-alike';
  if (/^(MIT|Apache|BSD|ISC|CC-BY-[0-9]|CC0|Unlicense|Artistic|Zlib|Python|PSF|0BSD|BSL)/.test(l) || /Public-Domain/i.test(l)) return 'permissive';
  return 'other / custom';
}

// ---------------------------------------------------------------- graph metrics
function graphMetrics(it) {
  const ids = it.graph.nodes.map(n => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const adj = ids.map(() => []);
  const preds = ids.map(() => new Set());
  for (const e of it.graph.edges) {
    if (e.kind === 'loop' || e.kind === 'error' || e.from === e.to) continue;
    adj[index.get(e.from)].push(index.get(e.to));
    preds[index.get(e.to)].add(index.get(e.from));
  }
  // Tarjan SCC (iterative) -> condensation -> longest path (in nodes)
  const n = ids.length; let idx = 0; const ind = new Array(n).fill(-1), low = new Array(n).fill(0), on = new Array(n).fill(false), comp = new Array(n).fill(-1); const st = []; let nc = 0;
  for (let s = 0; s < n; s++) {
    if (ind[s] >= 0) continue;
    const stack = [[s, 0]]; ind[s] = low[s] = idx++; st.push(s); on[s] = true;
    while (stack.length) {
      const fr = stack[stack.length - 1]; const v = fr[0];
      if (fr[1] < adj[v].length) {
        const w = adj[v][fr[1]++];
        if (ind[w] < 0) { ind[w] = low[w] = idx++; st.push(w); on[w] = true; stack.push([w, 0]); }
        else if (on[w]) low[v] = Math.min(low[v], ind[w]);
      } else {
        stack.pop();
        if (stack.length) { const u = stack[stack.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
        if (low[v] === ind[v]) { let w; do { w = st.pop(); on[w] = false; comp[w] = nc; } while (w !== v); nc++; }
      }
    }
  }
  const cadj = Array.from({ length: nc }, () => new Set()), indeg = new Array(nc).fill(0);
  for (let v = 0; v < n; v++) for (const w of adj[v]) if (comp[v] !== comp[w] && !cadj[comp[v]].has(comp[w])) { cadj[comp[v]].add(comp[w]); indeg[comp[w]]++; }
  const depth = new Array(nc).fill(1); const q = []; for (let c = 0; c < nc; c++) if (!indeg[c]) q.push(c);
  let maxDepth = n ? 1 : 0;
  while (q.length) { const c = q.shift(); for (const d of cadj[c]) { depth[d] = Math.max(depth[d], depth[c] + 1); maxDepth = Math.max(maxDepth, depth[d]); if (!--indeg[d]) q.push(d); } }
  return { depth: maxDepth, maxFanIn: Math.max(0, ...preds.map(p => p.size)), categories: new Set(it.graph.nodes.map(x => x.category)).size };
}
for (const it of allItems) it._m = graphMetrics(it);

const log2 = x => Math.log2(1 + x);
function complexity(it) {
  const f = it.features;
  return log2(f.nodeCount) + log2(f.edgeCount) + 1.5 * log2(f.branching) + 1.5 * log2(f.loops) + 2 * log2(f.humanSteps) + f.async.length
    + log2(f.subworkflows) + 0.5 * it._m.categories + 0.5 * constructsOf(it).length + (f.hasModelCalls ? 1 : 0) + (f.hasCode ? 0.5 : 0) + log2(it._m.depth);
}
for (const it of allItems) it._score = complexity(it);

// ---------------------------------------------------------------- motif mining
const LABEL_OF = n => {
  switch (n.category) {
    case 'action': return { read: 'read', write: 'write', external: 'ext-call', none: 'action' }[n.effects];
    case 'code': return n.effects === 'none' ? 'code' : 'script';
    case 'transform': return 'transform';
    case 'condition': return 'branch';
    case 'subworkflow': return 'subflow';
    case 'error-handler': return 'on-error';
    case 'other': return n.effects === 'none' ? null : 'other';   // inputs/parameters are not steps
    default: return n.category;                                      // trigger loop merge wait human model
  }
};
const MAXLEN = 4;
function itemMotifs(it) {
  const lab = new Map(), succ = new Map(), pred = new Map();
  for (const n of it.graph.nodes) { const l = LABEL_OF(n); if (l) { lab.set(n.id, l); succ.set(n.id, new Set()); pred.set(n.id, new Set()); } }
  const ctrlSucc = new Map([...lab.keys()].map(k => [k, new Set()]));
  for (const e of it.graph.edges) {
    if (e.kind === 'error' || e.from === e.to || !lab.has(e.from) || !lab.has(e.to)) continue;
    succ.get(e.from).add(e.to); pred.get(e.to).add(e.from);
    if (e.kind === 'control') ctrlSucc.get(e.from).add(e.to);
  }
  // compressed label sequences along paths (consecutive equal labels merged), length 2..MAXLEN, via a worklist
  const S = new Map([...lab.keys()].map(k => [k, new Set([lab.get(k)])]));
  const work = [...lab.keys()]; const inWork = new Set(work);
  let budget = 3_000_000;
  while (work.length && budget > 0) {
    const u = work.pop(); inWork.delete(u);
    for (const v of succ.get(u)) {
      const lv = lab.get(v); const target = S.get(v); let changed = false;
      for (const seq of S.get(u)) {
        budget--;
        const parts = seq.split('>');
        if (parts.at(-1) === lv) continue;           // compression: seq already ends with this label
        if (parts.length >= MAXLEN) continue;
        const nseq = `${seq}>${lv}`;
        if (!target.has(nseq)) { target.add(nseq); changed = true; }
      }
      if (changed && !inWork.has(v)) { work.push(v); inWork.add(v); }
    }
  }
  const seqs = new Set();
  for (const set of S.values()) for (const s of set) if (s.includes('>')) seqs.add(s);
  const fanOut = new Set(), fanIn = new Set();
  let diamonds = 0, bestOfN = false, menuDispatch = false, bigFanIn = false, modelChain = false;
  for (const [v, ss] of succ) {
    if (ss.size >= 2) fanOut.add(`${lab.get(v)} → {${[...new Set([...ss].map(x => lab.get(x)))].sort().join(', ')}}`);
    if (lab.get(v) === 'human' && ctrlSucc.get(v).size >= 2) menuDispatch = true;
    if (lab.get(v) === 'model' && [...ss].some(x => lab.get(x) === 'model')) modelChain = true;
  }
  for (const [v, ps] of pred) {
    if (ps.size >= 2) fanIn.add(`{${[...new Set([...ps].map(x => lab.get(x)))].sort().join(', ')}} → ${lab.get(v)}`);
    if (ps.size >= 5) bigFanIn = true;
  }
  // scatter-gather: a node whose >=2 successors reach a common join (in-degree >=2) within 3 hops
  for (const [v, ss] of succ) {
    if (ss.size < 2) continue;
    const reach = new Map();
    for (const s of ss) {
      let frontier = [s]; const seen = new Set([s]);
      for (let h = 0; h < 3 && frontier.length; h++) {
        const nxt = [];
        for (const x of frontier) for (const y of succ.get(x)) if (!seen.has(y)) { seen.add(y); nxt.push(y); }
        frontier = nxt;
      }
      for (const y of seen) if (pred.get(y).size >= 2) reach.set(y, (reach.get(y) ?? new Set()).add(s));
    }
    const joins = [...reach.entries()].filter(([, from]) => from.size >= 2);
    if (joins.length) {
      diamonds++;
      if ([...ss].filter(x => lab.get(x) === 'model').length >= 2) bestOfN = true;
    }
  }
  // loop bodies: for each loop edge u->v, nodes on forward paths v ~> u (<= 12 hops); for loop nodes, their direct body successors
  const loopBodies = new Set();
  for (const e of it.graph.edges) {
    if (e.kind !== 'loop' || !lab.has(e.from) || !lab.has(e.to)) continue;
    const dist = new Map([[e.to, 0]]); const q = [e.to];
    while (q.length) { const x = q.shift(); if (dist.get(x) >= 12) continue; for (const y of succ.get(x)) if (!dist.has(y)) { dist.set(y, dist.get(x) + 1); q.push(y); } }
    if (!dist.has(e.from)) continue;
    const back = new Set([e.from]); const q2 = [e.from];
    while (q2.length) { const x = q2.shift(); for (const y of pred.get(x)) if (dist.has(y) && !back.has(y)) { back.add(y); q2.push(y); } }
    const body = [...back].filter(x => dist.has(x)).map(x => lab.get(x));
    loopBodies.add(`{${[...new Set(body)].sort().join(', ')}}`);
  }
  for (const [v, l] of lab) if (l === 'loop' && succ.get(v).size) loopBodies.add(`loop → {${[...new Set([...succ.get(v)].map(x => lab.get(x)))].sort().join(', ')}}`);
  const errorTargets = new Set();
  for (const e of it.graph.edges) if (e.kind === 'error' && lab.has(e.from) && lab.has(e.to)) errorTargets.add(`${lab.get(e.from)} –error→ ${lab.get(e.to)}`);
  return { seqs, fanOut, fanIn, diamonds, bestOfN, menuDispatch, bigFanIn, modelChain, loopBodies, errorTargets };
}
for (const it of items) it._mo = itemMotifs(it);

const has = (it, rx) => [...it._mo.seqs].some(s => rx.test(s));
const loopHas = (it, pred) => [...it._mo.loopBodies].some(pred);
const OPERATORS = [
  { id: 'op1', ref: 'operators.md §1 split → batched extract → assemble', test: it => has(it, /(^|>)(code|transform|read)>loop>(model|code|transform|merge)/) || has(it, /(^|>)(code|transform)>loop>.*(code|transform|merge)$/) },
  { id: 'op1m', ref: 'operators.md §1 with a model in the map body', test: it => loopHas(it, b => b.includes('model')) || has(it, /(^|>)loop>model/) },
  { id: 'op2', ref: 'operators.md §2/§5 model judgment then code (parse, normalise, apply rules)', test: it => has(it, /(^|>)model>(code|transform)/) },
  { id: 'op3', ref: 'operators.md §3 classify then route on the label', test: it => has(it, /(^|>)model>branch/) },
  { id: 'op4', ref: 'operators.md §4 pairwise judgment with blocking', test: () => false, note: 'not separable from §1 by structure alone (needs node semantics)' },
  { id: 'op6', ref: 'operators.md §6 generate → verify → retry (bounded loop)', test: it => loopHas(it, b => b.includes('model') && /branch|code|transform/.test(b)) },
  { id: 'op7', ref: 'operators.md §7 best-of-N: parallel model calls that re-join', test: it => it._mo.bestOfN, note: 'best-of-N and sectioning (different prompts in parallel) look the same structurally' },
  { id: 'op8', ref: 'operators.md §8 evidence → hypothesis → check', test: it => has(it, /(^|>)loop>model>(code|transform|merge)>model/) || has(it, /(^|>)model>(code|transform|merge)>model>branch/) },
  { id: 'op9', ref: 'operators.md §9 structural check before the answer/effect', test: it => has(it, /(^|>)model>(code|branch)>(write|ext-call)$/) },
];
const NEW_OPERATORS = [
  { id: 'etl', name: 'fetch → transform → write (sync/ETL)', test: it => has(it, /(^|>)read>(transform|code)>(write|ext-call)/), irNote: 'task → code → task; native' },
  { id: 'filter-act', name: 'trigger → guard → act (filter then act)', test: it => has(it, /(^|>)trigger>branch>(write|ext-call|action|model)/), irNote: 'run input + `when` guards; trigger itself needs an extension' },
  { id: 'scatter-gather', name: 'scatter → parallel branches → gather (diamond)', test: it => it._mo.diamonds > 0, irNote: 'parallel needs + join, or map + code; native' },
  { id: 'fan-in-report', name: 'many results → one aggregate/report (fan-in ≥ 5)', test: it => it._mo.bigFanIn, irNote: 'needs on all producers + code/task; native' },
  { id: 'rag', name: 'retrieve → generate (read then model)', test: it => has(it, /(^|>)read>(transform>|code>)?model/), irNote: 'task → agent with the retrieved text as an untrusted input; native' },
  { id: 'model-chain', name: 'prompt chain (model → model)', test: it => it._mo.modelChain, irNote: 'agent → agent; native' },
  { id: 'approval-gate', name: 'human approval before an effect', test: it => has(it, /(^|>)human>(branch>)?(write|ext-call)/), irNote: '`human` + `when` on the answer; native (timeouts/escalation are §2.1 extensions)' },
  { id: 'menu-dispatch', name: 'human choice dispatches to branches (menu)', test: it => it._mo.menuDispatch, irNote: '`human` with an enum answer + `when` guards; native' },
  { id: 'poll-until', name: 'poll until ready (wait + check in a loop)', test: it => loopHas(it, b => b.includes('wait')) || has(it, /(^|>)wait>(read|ext-call)>branch/), irNote: '`loop` over wait + task with `until`; native while each wait <= 1 h' },
  { id: 'delay-recheck', name: 'trigger → wait → re-check → act (debounce)', test: it => has(it, /(^|>)trigger>(branch>)?wait>(branch|read)/), irNote: 'trigger extension + wait + `when`' },
  { id: 'notify-on-failure', name: 'on failure → notify/cleanup', test: it => [...it._mo.errorTargets].length > 0, irNote: 'error-branch / completion-hook extension (partial emulation via onError:"continue")' },
];
for (const it of items) {
  it._ops = new Set([...OPERATORS, ...NEW_OPERATORS].filter(o => o.test(it)).map(o => o.id));
  if (constructsOf(it).includes('agent-tool-loop')) it._ops.add('agent-tools');
}

function support(selector) {
  const m = new Map();
  for (const it of items) for (const k of selector(it)) {
    if (!m.has(k)) m.set(k, { items: 0, platforms: new Set(), clusters: new Set(), byCluster: new Map(), examples: [] });
    const r = m.get(k); r.items++; r.platforms.add(it.source.platform); r.clusters.add(it._cluster); r.byCluster.set(it._cluster, (r.byCluster.get(it._cluster) ?? 0) + 1);
    if (r.examples.length < 3 && it.source.redistributable && !r.examples.some(x => x.startsWith(it.source.platform + ':'))) r.examples.push(it.id);
  }
  return [...m.entries()].sort((a, b) => b[1].items - a[1].items || b[1].platforms.size - a[1].platforms.size || a[0].localeCompare(b[0]));
}

// ---------------------------------------------------------------- oracles and pilot
const OFFLINE_ORACLE = it => (it.oracle.kind !== 'none') && (['temporal', 'dagster'].includes(it.source.platform)
  || (it.source.platform === 'n8n' && it.oracle.kind === 'mocked-execution') || (it.source.platform === 'kubeflow' && it.oracle.kind === 'output-equivalence'));
function oracleTier(it) {
  if (it.oracle.kind !== 'none') return OFFLINE_ORACLE(it) ? 'T1' : 'T2';
  if (['comfyui', 'ifttt'].includes(it.source.platform) || it._cluster === 'science') return 'T0';
  return it.features.nodeCount <= 60 ? 'T3' : 'T0';
}
const TIER_TEXT = {
  T1: 'shipped check that runs offline with mocks or local fixtures (Temporal tests with mocked activities, Dagster in-process pytest, n8n pinData replay, KFP compiled goldens)',
  T2: 'shipped check that needs heavy infrastructure (containers/conda/Galaxy server, a Kubernetes cluster, or real credentials)',
  T3: 'no shipped check, but small enough (<= 60 nodes) to author a mocked-connector oracle: record each effectful node as a fixture, compare effect traces and outputs',
  T0: 'no plausible executable oracle at reasonable cost: ComfyUI (GPU and model weights), IFTTT (closed services), science pipelines without shipped tests (mocked bioinformatics tools would check only the call graph), or > 60 nodes without a shipped check',
};
const ORACLE_PLAN = {
  temporal: 'port the sample test (time-skipping server, mocked activities) to a mock capability table; pass = same workflow result and activity-call sequence',
  dagster: 'record the sample pytest asset values once in an owner-approved sandbox; pass = equal asset outputs with the same local resources mocked',
  n8n: 'replay pinData as mock connector responses; pass = same connector calls (node, operation, key fields) and final output',
  kubeflow: 'golden PipelineSpec fixes the component DAG; components become deterministic mocks; pass = same component calls/order constraints and outputs',
  argo: "container steps become deterministic mocks with the example's literal parameters; pass = same output parameters and step set as a Succeeded run",
  tekton: 'tasks become deterministic mocks; pass = same results/step set as a successful PipelineRun',
  airflow: 'operators become mocks with recorded responses; pass = same task-level effect trace and final task states',
  prefect: 'tasks become mocks; pass = same flow result and task-call trace',
  'github-actions': 'steps become mocks; pass = same executed job/step set for a fixed event payload and matrix',
  'gitlab-ci': 'jobs become mocks; pass = same executed job set for a fixed pipeline source and variables',
  galaxy: 'planemo inputs + pinned tool containers; pass = reference outputs/checksums in the -tests.yml (heavy)',
  'nf-core': 'nf-test snapshot md5s on nf-core/test-datasets with containers (heavy)',
  snakemake: '.test/ config + data with conda/apptainer tools; pass = expected outputs where shipped (heavy)',
  cwl: 'job file + tool containers; pass = expected outputs where shipped (heavy)',
  wdl: 'truth-set comparison (WARP Verify*/ENCODE ref_output) with containers (heavy)',
  nextflow: 'test profile with containers; pass = shipped expected outputs (heavy)',
  'home-assistant': 'mock state machine + service registry; scripted entity/event sequence; pass = same service calls (domain, service, target, data) in order',
  'apple-shortcuts': 'device actions become mocks; scripted menu/ask answers; pass = same action/effect trace and final output',
};
const LLM_APP_BUILDERS = ['dify', 'langflow', 'flowise', 'coze', 'activepieces', 'zapier', 'node-red'];
const planFor = it => ORACLE_PLAN[it.source.platform] ?? (LLM_APP_BUILDERS.includes(it.source.platform)
  ? 'LLM nodes get scripted responses (recorded once), code nodes run in the sandbox, connectors are mocked; pass = same final answer/effect trace for fixed inputs'
  : 'mock every effectful node; pass = same effect trace and outputs');
const MOCKABLE = new Set(['schedule-trigger', 'webhook-trigger', 'event-trigger', 'poll-trigger', 'subworkflow-call', 'error-branch', 'completion-hook', 'signal-wait']);
const MOCK_HOW = { 'schedule-trigger': 'trigger -> run input', 'webhook-trigger': 'trigger -> run input', 'event-trigger': 'trigger -> run input',
  'poll-trigger': 'trigger -> run input', 'subworkflow-call': 'inline the callee', 'error-branch': 'onError:"continue" + when', 'completion-hook': 'all_resolved join + onError:"continue"',
  'signal-wait': 'one-shot signal → human node answered by the harness' };
function pilotCandidate(it) {
  const f = it.features, d = it.description, cs = constructsOf(it), tier = oracleTier(it);
  if (!it.source.redistributable || tier === 'T0') return null;
  if (!['original', 'recovered-by-model'].includes(d.provenance) || d.text.trim().length < 60) return null;
  if (f.nodeCount < 4 || f.nodeCount > 60 || verdictKind(it) === 'unsupported') return null;
  if (cs.some(c => !MOCKABLE.has(c))) return null;
  const constructs = [f.branching > 0, f.loops > 0, f.humanSteps > 0, f.hasModelCalls, f.hasCode, f.async.includes('wait'), it._mo.diamonds > 0].filter(Boolean).length;
  const score = { T1: 6, T2: 4, T3: 3 }[tier] + constructs + (d.provenance === 'original' ? 1 : 0) + (f.nodeCount >= 8 && f.nodeCount <= 40 ? 1 : 0) - cs.length * 0.5;
  return { it, tier, score, constructs };
}
const candidates = items.map(pilotCandidate).filter(Boolean).sort((a, b) => b.score - a.score || a.it.id.localeCompare(b.it.id));
const QUOTA = { automation: 8, orchestration: 10, science: 6, 'consumer-creative': 6 };
const PILOT_SIZE = 30;
const PLATFORM_CAP = 3;
let pilot = [];
{
  const perPlat = new Map(), perCluster = new Map();
  const seen = new Set();
  // pass 1 honours the per-cluster quotas; pass 2 fills unused quota with the best remaining candidates
  for (const pass of [1, 2]) {
    for (const c of candidates) {
      if (pilot.length >= PILOT_SIZE) break;
      const p = c.it.source.platform, cl = c.it._cluster;
      if (pilot.includes(c) || (perPlat.get(p) ?? 0) >= PLATFORM_CAP || (pass === 1 && (perCluster.get(cl) ?? 0) >= QUOTA[cl])) continue;
      const shape = `${p}|${[...c.it.graph.nodes.map(n => n.type)].sort().join(',')}`;
      const desc = clean(c.it.description.text).toLowerCase().slice(0, 80);
      if (seen.has(shape) || seen.has(desc)) continue;
      seen.add(shape); seen.add(desc);
      pilot.push(c); perPlat.set(p, (perPlat.get(p) ?? 0) + 1); perCluster.set(cl, (perCluster.get(cl) ?? 0) + 1);
    }
  }
  pilot = pilot.sort((a, b) => ORIG_CLUSTERS.indexOf(a.it._cluster) - ORIG_CLUSTERS.indexOf(b.it._cluster) || a.it.source.platform.localeCompare(b.it.source.platform) || b.score - a.score);
}

// ---------------------------------------------------------------- the 30 most complex
const COMPLEX_CAP = 5;
const ranked = [...items].sort((a, b) => b._score - a._score || a.id.localeCompare(b.id));
const complex30 = [];
{ const per = new Map(); for (const it of ranked) { const p = it.source.platform; if ((per.get(p) ?? 0) >= COMPLEX_CAP) continue; complex30.push(it); per.set(p, (per.get(p) ?? 0) + 1); if (complex30.length === 30) break; } }
function oneLine(it) {
  const t = clean(it.description.text);
  if (t) { const first = /^(.{40,}?[.!?])\s/.exec(t + ' '); return cut(first ? first[1] : t, 150); }
  const f = it.features;
  const why = it.source.redistributable ? 'no description in the source' : `licence ${it.source.license}: no text kept`;
  return `(${why}) ${f.nodeCount}-step ${it.source.platform} workflow; ${f.connectors.slice(0, 3).map(c => cut(c, 40)).join(', ') || 'no named connectors'}`;
}

// ---------------------------------------------------------------- sample for git
let sample = [];
if (itemsBuf.length > SAMPLE_LIMIT) {
  const chosen = new Set(); let bytes = 0;
  const take = it => { if (chosen.has(it.id) || !it.source.redistributable) return; const b = lineBytes.get(it.id); if (b > 250_000 || bytes + b > SAMPLE_LIMIT - 50_000) return; chosen.add(it.id); bytes += b; };
  for (const c of pilot) take(c.it);
  for (const it of complex30) take(it);
  // round-robin over platforms, walking each platform's redistributable items from most to least complex at even strides
  const byPlat = new Map(platforms.map(p => [p, ranked.filter(i => i.source.platform === p && i.source.redistributable)]));
  for (let round = 0; round < 40; round++) {
    for (const p of platforms) {
      const list = byPlat.get(p); if (!list.length) continue;
      const stride = Math.max(1, Math.floor(list.length / 12));
      const pick = list[(round * stride) % list.length];
      if (round * stride < list.length) take(pick);
    }
  }
  sample = items.filter(it => chosen.has(it.id));
  const body = sample.map(it => lineOf.get(it.id)).join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, 'items-sample.jsonl'), body);
}

// ---------------------------------------------------------------- manifest
function originOf(url) {
  let u; try { u = new URL(url); } catch { return 'unparseable'; }
  if (u.protocol === 'local:') return 'local (first-party session scripts, no public location)';
  const seg = u.pathname.split('/').filter(Boolean).map(s => decodeURIComponent(s));
  if (u.hostname === 'github.com' || u.hostname === 'gitlab.com' || u.hostname === 'raw.githubusercontent.com') return `${u.hostname}/${seg.slice(0, 2).join('/')}`;
  if (u.hostname === 'huggingface.co') return `${u.hostname}/${seg.slice(0, seg[0] === 'datasets' ? 3 : 2).join('/')}`;
  if (u.hostname === 'files.pythonhosted.org') return 'pypi.org (sdists)';
  return u.hostname;
}
const SHA_RX = /\b[0-9a-f]{40}\b/g;
const sources = new Map();
for (const it of allItems) {
  const o = originOf(it.source.url);
  const k = `${it.source.platform}|${o}`;
  if (!sources.has(k)) sources.set(k, { platform: it.source.platform, cluster: it._cluster, ...(isFirstParty(it) ? { party: 'first-party' } : {}), origin: o, items: 0, redistributable: 0, licences: {}, revisions: new Set(), retrievedAt: new Set() });
  const s = sources.get(k);
  s.items++; if (it.source.redistributable) s.redistributable++;
  s.licences[it.source.license] = (s.licences[it.source.license] ?? 0) + 1;
  s.retrievedAt.add(it.source.retrievedAt);
  const shas = `${it.source.url} ${it.source.revision}`.match(SHA_RX);
  if (shas) for (const x of shas) s.revisions.add(x); else s.revisions.add(cut(it.source.revision, 80));
}
const fileInfo = p => { const b = fs.readFileSync(p); return { path: rel(p), bytes: b.length, lines: b.toString('utf8').split('\n').filter(Boolean).length, sha256: sha256(b) }; };
const manifest = {
  schema: 'foundry-corpus-manifest/1',
  corpus: 'corpus-20261006',
  itemSchema: 'foundry-corpus-item/1 (ITEM-SCHEMA.md)',
  generatedAt: mergeLog.generatedAt,
  status: 'development/diagnostic corpus; not sealed evaluation evidence. Graphs, features and IR verdicts are static-analysis heuristics, not compiled or executed.',
  generators: ['scripts/agentic-assemble.mjs', 'scripts/merge-items.mjs', 'scripts/check-items.mjs', 'scripts/coverage-report.mjs'],
  reproduce: REPRODUCE,
  restore: 'node research/corpus-20261006/scripts/unpack.mjs (restores items.jsonl and parts/*.jsonl from the .gz copies in git and checks every sha256 below)',
  pack: 'node research/corpus-20261006/scripts/unpack.mjs --pack (rewrites a .gz only when its content differs from the manifest hash; gzip level 9, no name or timestamp)',
  files: {
    items: { ...fileInfo(ITEMS), inGit: itemsBuf.length <= SAMPLE_LIMIT, distribution: itemsBuf.length > SAMPLE_LIMIT
      ? 'too large for git (> 5 MB): publish as a release asset; it includes redistributable:false items reduced to URL + derived graph + features, which needs the owner\'s confirmation before publishing' : 'in git' },
    ...(sample.length ? { sample: { ...fileInfo(path.join(ROOT, 'items-sample.jsonl')), inGit: true,
      selection: 'redistributable items only: the pilot shortlist, the redistributable items among the 30 most complex (lines <= 250 kB), then a round-robin over platforms at even complexity strides, up to 5 MB' } } : {}),
    mergeLog: fileInfo(path.join(ROOT, 'merge-log.json')),
    parts: mergeLog.inputs.map(p => {
      const ledger = path.join(ROOT, 'parts', `${p.cluster}-ledger.md`);
      const lb = fs.existsSync(ledger) ? fs.readFileSync(ledger) : null;
      return { ...p, gz: `${p.part}.gz`, ledger: `parts/${p.cluster}-ledger.md`, ...(lb ? { ledgerBytes: lb.length, ledgerSha256: sha256(lb) } : {}),
        inGit: p.bytes <= SAMPLE_LIMIT ? 'small enough' : 'over 5 MB: release asset recommended' };
    }),
  },
  counts: {
    items: allItems.length,
    byCluster: Object.fromEntries(CLUSTERS.map(c => [c, allItems.filter(i => i._cluster === c).length])),
    byPlatform: Object.fromEntries(allPlatforms.map(p => [p, allItems.filter(i => i.source.platform === p).length])),
    firstParty: { platforms: FIRST_PARTY_PLATFORMS, items: allItems.filter(isFirstParty).length,
      note: 'workflows written by this project\'s own agent: not independent evidence, reported apart from third-party items and never pooled with them' },
    redistributable: allItems.filter(i => i.source.redistributable).length,
    byLicence: Object.fromEntries(sortedEntries(count(allItems, i => i.source.license))),
    byLicenceFamily: Object.fromEntries(sortedEntries(count(allItems, i => licenceFamily(i.source.license)))),
    byVerdict: Object.fromEntries(sortedEntries(count(allItems, verdictClass))),
    byOracle: Object.fromEntries(sortedEntries(count(allItems, i => i.oracle.kind))),
    droppedInvalid: mergeLog.drops.length, droppedDuplicates: mergeLog.dedupe.dropped.length,
    nodes: allItems.reduce((a, i) => a + i.features.nodeCount, 0), edges: allItems.reduce((a, i) => a + i.features.edgeCount, 0),
  },
  sources: [...sources.values()].sort((a, b) => CLUSTERS.indexOf(a.cluster) - CLUSTERS.indexOf(b.cluster) || a.platform.localeCompare(b.platform) || b.items - a.items)
    .map(s => ({ ...s, revisions: [...s.revisions].slice(0, 5), revisionCount: s.revisions.size, retrievedAt: [...s.retrievedAt].sort(),
      licences: Object.fromEntries(Object.entries(s.licences).sort((a, b) => b[1] - a[1])), ledger: `parts/${s.cluster}-ledger.md` })),
  rawData: { root: '/opt/corpus/', inGit: false, note: 'every item records source.rawPath; raw copies stay outside git (each cluster <= 3 GB)' },
};
fs.writeFileSync(path.join(ROOT, 'MANIFEST.json'), JSON.stringify(manifest, null, 1) + '\n');

// ---------------------------------------------------------------- COVERAGE.md
const W = []; const w = (...s) => W.push(...s);
const N = items.length;
const nRedis = items.filter(i => i.source.redistributable).length;
const NA = agentic.length, NFP = agentic.filter(isFirstParty).length;
w('# Workflow corpus coverage (corpus-20261006)', '',
  `*Generated by \`scripts/coverage-report.mjs\` from \`items.jsonl\` (${allItems.length} items, sha256 \`${sha256(itemsBuf).slice(0, 16)}…\`; see MANIFEST.json). ` +
  `Sections 1–9 cover the ${N} items of the four original clusters (automation, orchestration, science, consumer-creative) and are computed ` +
  `from those items only, so adding a cluster does not move them. Section 10 covers the agentic cluster (${NA} items from agent frameworks: ` +
  `${NA - NFP} third-party, and ${NFP} first-party items reported apart because this project's own agent wrote them). ` +
  'Status: development/diagnostic corpus for ROADMAP §4.4, not sealed evaluation evidence. Every graph, feature and IR verdict ' +
  'below is a static-analysis heuristic over normalized graphs. Nothing was compiled into Foundry IR or executed, and no oracle was run.*', '',
  `Reproduce: \`${REPRODUCE}\` (from a fresh clone, first \`node scripts/unpack.mjs\`; without the staging directory the assembler keeps the committed agentic part).`, '');

// merge-log.json restricted to the original clusters (sections 1-9); section 10 reads the agentic share.
const partCluster = new Map(mergeLog.inputs.map(p => [p.part.replace(/^parts\//, ''), p.cluster]));
// (a log written before fixes carried byCluster holds the original clusters only)
const fixCount = (v, keep) => v.byCluster ? Object.entries(v.byCluster).filter(([c]) => keep(c)).reduce((a, [, n]) => a + n, 0) : (keep(ORIG_CLUSTERS[0]) ? v.count : 0);
const mergeLogFor = keep => ({
  inputs: mergeLog.inputs.filter(p => keep(p.cluster)),
  fixes: Object.fromEntries(Object.entries(mergeLog.fixes).map(([k, v]) => [k, { ...v, count: fixCount(v, keep) }]).filter(([, v]) => v.count > 0)),
  drops: mergeLog.drops.filter(d => keep(partCluster.get(d.part))),
  dedupe: { dropped: mergeLog.dedupe.dropped.filter(d => keep(clusterOf.get(d.dropped))), shapeTwinsKept: mergeLog.dedupe.shapeTwinsKept.filter(g => keep(clusterOf.get(g[0]))) },
  featureChanges: Object.fromEntries(Object.entries(mergeLog.featureChanges).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([c]) => keep(c)))]).filter(([, v]) => Object.keys(v).length)),
  verdict: { changed: Object.entries(mergeLog.verdict.byCluster).filter(([c]) => keep(c)).reduce((a, [, n]) => a + n, 0),
    kindTransitions: Object.fromEntries(Object.entries(mergeLog.verdict.kindTransitions).filter(([k]) => keep(k.split(':')[0]))) },
  cycleArtifacts: mergeLog.cycleArtifacts.filter(id => keep(clusterOf.get(id))),
});
const ml = mergeLogFor(isOrigCluster);

w('## 1. Merge', '');
const tr = ml.verdict.kindTransitions;
const toNative = Object.entries(tr).filter(([k]) => k.endsWith('via-extension -> native')).reduce((a, [, v]) => a + v, 0);
w(`- **Inputs:** ${ml.inputs.map(p => `\`${p.part}\` ${p.lines}`).join(', ')} lines (${ml.inputs.reduce((a, p) => a + p.lines, 0)} total).`,
  `- **Checker:** \`scripts/check-items.mjs\` validates every line against ITEM-SCHEMA.md (keys, enums, URL/date/licence fields, dangling or duplicate edges, ` +
  'summary length, credential-shaped strings, non-redistributable text) and, with `--canonical`, the merged conventions below. The only failures in the parts were ' +
  `${ml.fixes['url-percent-encoded']?.count ?? 0} URLs containing spaces (Langflow starter projects, a few ComfyUI files), fixed by percent-encoding. ` +
  `All repairs: ${Object.entries(ml.fixes).map(([k, v]) => `${k} ${v.count}`).join(', ') || 'none'} (examples in merge-log.json).`,
  `- **Dropped:** ${ml.drops.length} invalid lines; ${ml.dedupe.dropped.length} duplicates (same platform, identical normalized graph and the same title or description): ` +
  ml.dedupe.dropped.map(d => `\`${cut(d.dropped, 70)}\``).join(', ') + '. ' +
  `${ml.dedupe.shapeTwinsKept.length} groups of identical graphs with different titles and descriptions were kept (e.g. Argo conditional-artifacts/-parameters).`,
  `- **One redistribution policy:** the consumer-creative converters treated GPL-3.0 as redistributable while the orchestration and science converters ` +
  `did not. The merge applies the conservative rule everywhere (copyleft, share-alike and non-commercial licences keep only URL, title, a written description, ` +
  `the derived graph with type-level summaries and features): ${ml.fixes['copyleft-made-non-redistributable']?.count ?? 0} items changed ` +
  `(ComfyUI and Home Assistant GPL-3.0, one MPL-2.0 GitLab project).`,
  `- **Features recomputed** from the graph for every item: nodeCount, edgeCount, maxFanOut (distinct successors), humanSteps, effects, hasCode, hasModelCalls. ` +
  'Source-derived features (branching guards, runtime fan-outs, inlined sub-workflows, connectors, domains) cannot be recovered from the graph and are carried ' +
  'from the converters, floored at the graph counts (branching >= condition nodes, loops >= loop nodes, subworkflows >= sub-workflow nodes); `async` gains `wait` ' +
  `when the graph has wait nodes and the trigger kind of every trigger construct. Changed values: ${Object.entries(ml.featureChanges).map(([k, v]) => `${k} ${Object.entries(v).map(([c, n]) => `${c} ${n}`).join(', ')}`).join('; ') || 'none'}.`,
  `- **IR verdicts recomputed** with one vocabulary (section 4). ${ml.verdict.changed} verdict strings changed, most of them only renamed or reformatted; ` +
  `${toNative} items moved from via-extension to native and none moved the other way: Airflow \`schedule=@once\` system tests (a one-shot start is a run input), ` +
  'sub-workflows that converters inline at compile time (KFP nested pipelines, ComfyUI subgraphs), fixed-count retries (n8n/Dify/Activepieces fit IR `retry`), ' +
  'runtime list fan-out (IR `map`), and the 500-node limit applied to the normalized graph rather than to the source action count.',
  `- **Graph artefacts:** ${ml.cycleArtifacts.length} graphs have cycles over data/control edges that come from static edge inference (Snakemake wildcard ` +
  'matching, ComfyUI subgraph instance wiring, one GitLab stage barrier), not from loops in the source. They are kept as converted and noted in `ir.notes`; ' +
  'they do not count as `unstructured-cycle`.', '');

w('## 2. Counts', '');
const platRows = platforms.map(p => {
  const its = items.filter(i => i.source.platform === p);
  const lic = sortedEntries(count(its, i => i.source.license)).slice(0, 3).map(([l, n]) => `${cell(cut(l, 40))} ${n}`).join(', ');
  const or = count(its, i => i.oracle.kind);
  return [p, platformCluster.get(p), its.length, its.filter(i => i.source.redistributable).length, lic,
    (or.get('test-profile') ?? 0) + (or.get('output-equivalence') ?? 0) + (or.get('mocked-execution') ?? 0)];
});
w(table(['platform', 'cluster', 'items', 'redistributable', 'top licences', 'with shipped oracle'], platRows), '');
w(`Totals: ${N} items, ${nRedis} redistributable (${pct(nRedis, N)}), ${N - nRedis} kept as URL + derived graph + features only. ` +
  `${items.reduce((a, i) => a + i.features.nodeCount, 0).toLocaleString('en')} nodes and ${items.reduce((a, i) => a + i.features.edgeCount, 0).toLocaleString('en')} edges.`, '');
w(table(['cluster', 'items', 'redistributable', 'native', 'via-extension', 'unsupported', 'description original / recovered / written'], ORIG_CLUSTERS.map(c => {
  const its = items.filter(i => i._cluster === c); const v = count(its, verdictKind); const d = count(its, i => i.description.provenance);
  return [c, its.length, its.filter(i => i.source.redistributable).length, v.get('native') ?? 0, v.get('via-extension') ?? 0, v.get('unsupported') ?? 0,
    `${d.get('original') ?? 0} / ${d.get('recovered-by-model') ?? 0} / ${d.get('written') ?? 0}`];
})), '');
w('**Licences.** Families: ' + sortedEntries(count(items, i => licenceFamily(i.source.license))).map(([k, n]) => `${k} ${n}`).join(', ') + '.', '');
w(table(['licence', 'items', 'redistributable'], sortedEntries(count(items, i => i.source.license)).map(([l, n]) =>
  [cell(cut(l, 70)), n, items.filter(i => i.source.license === l && i.source.redistributable).length])), '');
w('Redistributable means the normalized graph may be committed (ITEM-SCHEMA.md). Unknown, terms-of-service, copyleft and non-commercial items keep ' +
  'only URL, licence evidence, a written description or none, a derived graph (types, categories, effects, type-level summaries) and features. ' +
  'The WorkflowLLM shortcuts are Apache-2.0 as a dataset, but their original RoutineHub authors\' terms were not checked item by item (consumer-creative ledger).', '');

w('## 3. Complexity', '');
const METRICS = [
  ['nodes', it => it.features.nodeCount], ['edges', it => it.features.edgeCount], ['depth (longest path)', it => it._m.depth],
  ['max fan-out', it => it.features.maxFanOut], ['max fan-in', it => it._m.maxFanIn], ['branching', it => it.features.branching],
  ['loops / runtime fan-outs', it => it.features.loops], ['async kinds', it => it.features.async.length], ['human steps', it => it.features.humanSteps],
  ['read effects', it => it.features.effects.read], ['write effects', it => it.features.effects.write], ['external effects', it => it.features.effects.external],
  ['sub-workflows', it => it.features.subworkflows], ['distinct node categories', it => it._m.categories],
];
const QS = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99];
w('Quantiles over all items (p10 … p99, max):', '');
w(table(['metric', 'p10', 'p25', 'p50', 'p75', 'p90', 'p99', 'max', 'mean'], METRICS.map(([name, fn]) => {
  const v = items.map(fn).sort((a, b) => a - b);
  return [name, ...QS.map(q => fmt(quantile(v, q))), v.at(-1), fmt(v.reduce((a, b) => a + b, 0) / v.length)];
})), '');
w('Median / p90 / max per cluster:', '');
w(table(['metric', ...ORIG_CLUSTERS], METRICS.map(([name, fn]) => [name, ...ORIG_CLUSTERS.map(c => {
  const v = items.filter(i => i._cluster === c).map(fn).sort((a, b) => a - b);
  return `${fmt(quantile(v, 0.5))} / ${fmt(quantile(v, 0.9))} / ${v.at(-1)}`;
})])), '');
const PREV = [['branching > 0', i => i.features.branching > 0], ['loops / runtime fan-out > 0', i => i.features.loops > 0], ['any async', i => i.features.async.length > 0],
  ['human steps > 0', i => i.features.humanSteps > 0], ['model calls', i => i.features.hasModelCalls], ['code', i => i.features.hasCode],
  ['external effects', i => i.features.effects.external > 0], ['write effects', i => i.features.effects.write > 0], ['sub-workflows', i => i.features.subworkflows > 0],
  ['error edges', i => i.graph.edges.some(e => e.kind === 'error')], ['> 100 nodes', i => i.features.nodeCount > 100], ['> 500 nodes', i => i.features.nodeCount > 500]];
w('Prevalence (share of items):', '');
w(table(['feature', 'all', ...ORIG_CLUSTERS], PREV.map(([name, fn]) => [name, pct(items.filter(fn).length, N),
  ...ORIG_CLUSTERS.map(c => { const its = items.filter(i => i._cluster === c); return pct(its.filter(fn).length, its.length); })])), '');
w('Async kinds: ' + sortedEntries(count(items.flatMap(i => i.features.async), x => x)).map(([k, n]) => `${k} ${n}`).join(', ') + ' (items).', '');
w('Caveats: definitions of `branching` and `loops` differ by cluster at the source level (guards vs condition nodes; runtime fan-out vs iteration) ' +
  'and are stated in each ledger; Nextflow and Snakemake edges are may-flow over-approximations; Home Assistant node counts include expanded YAML aliases ' +
  '(the largest blueprint expands to thousands of nodes and is excluded from selection); science items count runtime fan-out as `loops`.', '');

w('## 4. IR verdicts and missing constructs', '');
w('Verdicts are computed against the Phase 1 IR (`schemas/workflow.schema.json`, `research/core-20261006/DESIGN.md`): node kinds task, assert, human, ' +
  'map (parallel, `concurrency` <= 16, `failure` fail_fast|collect, `maxItems` <= 1000), loop (bounded, `until`), wait (`delayMs` <= 1 h), agent (one narrow typed ' +
  'model call), code (sandboxed pure JS/Python), verify; per-node `when`, `retry` (<= 10 attempts, <= 60 s backoff), `onError` stop|continue, `join` ' +
  'all_success|all_resolved; <= 500 nodes per flow. `native` = every construct maps onto these by a local rewrite; `via-extension:<a>+<b>` lists the ' +
  'constructs that need an addition; `unsupported:<reason>` = not expressible even with the ROADMAP §2.1 additions.', '');
const V = count(items, verdictKind);
w(`Overall: native ${V.get('native') ?? 0} (${pct(V.get('native') ?? 0, N)}), via-extension ${V.get('via-extension') ?? 0} (${pct(V.get('via-extension') ?? 0, N)}), ` +
  `unsupported ${V.get('unsupported') ?? 0} (${[...new Set(items.filter(i => verdictKind(i) === 'unsupported').map(i => i.ir.verdict))].join(', ')}).`, '');
w(table(['platform', 'items', 'native', 'via-extension', 'unsupported', 'most frequent constructs'], platforms.map(p => {
  const its = items.filter(i => i.source.platform === p); const v = count(its, verdictKind);
  const top = sortedEntries(count(its.flatMap(constructsOf), x => x)).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ');
  return [p, its.length, `${v.get('native') ?? 0} (${pct(v.get('native') ?? 0, its.length)})`, v.get('via-extension') ?? 0, v.get('unsupported') ?? 0, top || '-'];
})), '');
w('### Missing constructs ranked by frequency', '');
w('Items needing each construct (an item can need several). "Only blocker" counts items for which this construct is the single thing between them and `native`. ' +
  'This ranking is the input for schema extensions.', '');
const cFreq = count(items.flatMap(constructsOf), x => x);
const sole = count(items.filter(i => constructsOf(i).length === 1 && verdictKind(i) === 'via-extension'), i => constructsOf(i)[0]);
w(table(['#', 'construct', 'items', 'share', 'only blocker', 'clusters', 'platforms', 'ROADMAP coverage', 'Phase 1 IR today'], sortedEntries(cFreq).map(([c, n], i) => {
  const def = CONSTRUCTS.find(x => x.id === c);
  const its = items.filter(it => constructsOf(it).includes(c));
  return [i + 1, `\`${c}\``, n, pct(n, N), sole.get(c) ?? 0, [...new Set(its.map(x => x._cluster))].length, [...new Set(its.map(x => x.source.platform))].length, cell(def.roadmap), cell(def.today)];
})), '');
// greedy extension order
const remaining = new Set(items.filter(i => verdictKind(i) === 'via-extension').map(i => i.id));
const needs = new Map(items.map(i => [i.id, new Set(constructsOf(i))]));
const added = new Set(); const greedy = []; let nativeNow = V.get('native') ?? 0;
while (remaining.size && greedy.length < CONSTRUCT_IDS.length) {
  let best = null, bestGain = -1, bestFreq = -1;
  for (const c of CONSTRUCT_IDS) {
    if (added.has(c)) continue;
    let gain = 0, freq = 0;
    for (const id of remaining) { const s = needs.get(id); if (!s.has(c)) continue; freq++; if ([...s].every(x => x === c || added.has(x))) gain++; }
    if (gain > bestGain || (gain === bestGain && freq > bestFreq)) { best = c; bestGain = gain; bestFreq = freq; }
  }
  if (!best || bestFreq === 0) break;
  added.add(best); nativeNow += bestGain;
  for (const id of [...remaining]) if ([...needs.get(id)].every(x => added.has(x))) remaining.delete(id);
  greedy.push([greedy.length + 1, `\`${best}\``, bestGain, `${nativeNow} (${pct(nativeNow, N)})`]);
}
w('Greedy extension order (each step adds the construct that makes the most additional items expressible):', '');
w(table(['step', 'add', 'newly expressible', 'cumulative expressible'], greedy), '');
const groups = count(items.flatMap(i => [...new Set(constructsOf(i).map(c => CONSTRUCTS.find(x => x.id === c).group))]), x => x);
w('By group (items needing at least one construct of the group): ' + sortedEntries(groups).map(([g, n]) => `${g} ${n} (${pct(n, N)})`).join(', ') + '.', '');
// bundles: one ROADMAP-sized addition each
const BUNDLES = [
  ['triggers (schedule, webhook, event, poll)', ['schedule-trigger', 'webhook-trigger', 'event-trigger', 'poll-trigger']],
  ['call by reference (+ the 500-node split it enables)', ['subworkflow-call', 'flow-size>500']],
  ['failure handling (error branch, finally, adaptive retry)', ['error-branch', 'completion-hook', 'adaptive-retry']],
  ['generalized wait (signals, > 1 h timers, run-overlap policy, streams)', ['signal-wait', 'durable-wait', 'run-concurrency-policy', 'stream']],
  ['agent sessions (tool loops, chat sessions, cross-run state)', ['agent-tool-loop', 'chat-session', 'cross-run-state']],
  ['runtime dynamism and rewrites (plan/expand, cycles, action inputs)', ['dynamic-dag', 'unstructured-cycle', 'parametric-action-input']],
];
{
  const rem = new Set(items.filter(i => verdictKind(i) === 'via-extension').map(i => i.id));
  const have = new Set(); const rows = []; let cum = V.get('native') ?? 0; const used = new Set();
  while (used.size < BUNDLES.length) {
    let best = null, bestGain = -1;
    for (const [name, cs] of BUNDLES) {
      if (used.has(name)) continue;
      const next = new Set([...have, ...cs]);
      const gain = [...rem].filter(id => [...needs.get(id)].every(x => next.has(x))).length;
      if (gain > bestGain) { best = [name, cs]; bestGain = gain; }
    }
    used.add(best[0]); for (const c of best[1]) have.add(c);
    for (const id of [...rem]) if ([...needs.get(id)].every(x => have.has(x))) rem.delete(id);
    cum += bestGain;
    const touched = items.filter(i => best[1].some(c => constructsOf(i).includes(c))).length;
    rows.push([rows.length + 1, cell(best[0]), touched, bestGain, `${cum} (${pct(cum, N)})`]);
  }
  w('The same greedy order over ROADMAP-sized bundles:', '');
  w(table(['step', 'bundle', 'items needing it', 'newly expressible', 'cumulative expressible'], rows), '');
}
const shareBy = (c, cl) => { const its = items.filter(i => i._cluster === cl); return pct(its.filter(i => constructsOf(i).includes(c)).length, its.length); };
const trigItems = items.filter(i => constructsOf(i).some(c => c.endsWith('-trigger'))).length;
const failItems = items.filter(i => constructsOf(i).some(c => ['error-branch', 'completion-hook', 'adaptive-retry'].includes(c))).length;
const agentItems = items.filter(i => constructsOf(i).some(c => ['agent-tool-loop', 'chat-session', 'cross-run-state'].includes(c)));
w('Reading the tables:', '',
  `- **Triggers are the most common need** (${trigItems} items, ${pct(trigItems, N)}): automation ${pct(items.filter(i => i._cluster === 'automation' && constructsOf(i).some(c => c.endsWith('-trigger'))).length, items.filter(i => i._cluster === 'automation').length)}, ` +
  `consumer-creative ${pct(items.filter(i => i._cluster === 'consumer-creative' && constructsOf(i).some(c => c.endsWith('-trigger'))).length, items.filter(i => i._cluster === 'consumer-creative').length)} and CI items start on a schedule, webhook or event. ` +
  'Phase 1 has no start condition; a `triggers` block is already planned in ROADMAP §2.1. ' +
  `Only ${items.filter(i => constructsOf(i).length && constructsOf(i).every(c => c.endsWith('-trigger'))).length} of the ${trigItems} need nothing else; the rest also need another construct.`,
  `- **\`subworkflow-call\` unlocks the most items on its own** (${sole.get('subworkflow-call') ?? 0} items have it as their only blocker: Apple Shortcuts \`Run Shortcut\`, CWL/Snakemake ` +
  'sub-workflows by reference, n8n Execute Workflow, Home Assistant `script.*`). It is `call` in ROADMAP §2.1; statically resolvable callees can be inlined today, ' +
  'the extension matters for reuse, separate run records and recursion (shortcuts that call themselves).',
  `- **Failure handling** (${failItems} items: \`error-branch\` ${cFreq.get('error-branch') ?? 0}, \`completion-hook\` ${cFreq.get('completion-hook') ?? 0}, \`adaptive-retry\` ${cFreq.get('adaptive-retry') ?? 0}) ` +
  'has no ROADMAP item. Partial emulations exist: the runtime completes a failed node with `onError:"continue"` as `{ok:false,error}` (src/runtime.mjs), so node-level ' +
  'routes can be written as `when` guards on that output, and a teardown can use `join:"all_resolved"` if every upstream node continues on error. There is no ' +
  `status-aware guard, no run-level \`finally\` and no attempt-dependent retry. In nf-core: ${['adaptive-retry', 'completion-hook', 'error-branch'].map(c => `${c} ${items.filter(i => i.source.platform === 'nf-core' && constructsOf(i).includes(c)).length}/${items.filter(i => i.source.platform === 'nf-core').length}`).join(', ')}.`,
  `- **Agent-session constructs** (\`agent-tool-loop\`, \`chat-session\`, \`cross-run-state\`; ${agentItems.length} items) come from ` +
  sortedEntries(count(agentItems, i => i.source.platform)).slice(0, 5).map(([p, n]) => `${p} ${n}`).join(', ') + '. ' +
  'Phase 1 `agent` is deliberately one typed call without tools; tool loops map to the ROADMAP `executor` node, while sessions and cross-run state have no specification yet.',
  `- **Schema bounds hit by real items:** \`flow-size>500\` (${cFreq.get('flow-size>500') ?? 0} items: large shortcuts, ComfyUI and Home Assistant graphs) and \`durable-wait\` ` +
  `(${cFreq.get('durable-wait') ?? 0} Home Assistant items with delays or wait-for-trigger timeouts over 1 h). Not measurable statically: whether runtime fan-outs exceed ` +
  '`map.maxItems` = 1000 (e.g. scatter over genomic intervals) or need more than 16-way concurrency.', '');
w('### Node categories and their Phase 1 IR counterpart', '');
const catCount = count(items.flatMap(i => i.graph.nodes), n => n.category);
const catItems = new Map(CATEGORIES.map(c => [c, items.filter(i => i.graph.nodes.some(n => n.category === c)).length]));
const CAT_IR = { trigger: 'run start (input); recurring/event starts need a trigger construct', action: '`task` over a registered capability',
  transform: '`code` (pure) when effects are none, else `task`', condition: '`when` guards on successors (or `assert`)', loop: '`loop` (bounded) or `map` (runtime list)',
  merge: '`needs` + `join` (all_resolved after exclusive branches)', wait: '`wait` (<= 1 h); longer or event waits need extensions', human: '`human`',
  model: '`agent` (one narrow typed call); tool loops need `executor`', code: '`code` when pure; scripts with effects become `task` over a sandboxed shell/container capability',
  subworkflow: 'inline, or `call` (extension)', 'error-handler': '`onError:"continue"` + `when`, `map failure:"collect"`, or an error-branch/completion-hook extension',
  other: 'workflow inputs/parameters (no node) or `task`' };
w(table(['category', 'nodes', 'items with it', 'Phase 1 IR'], sortedEntries(catCount).map(([c, n]) => [c, n.toLocaleString('en'), catItems.get(c), CAT_IR[c]])), '');

w('## 5. The 30 most complex items', '');
w('Score = log2(1+nodes) + log2(1+edges) + 1.5·log2(1+branching) + 1.5·log2(1+loops) + 2·log2(1+human steps) + |async| + log2(1+sub-workflows) + ' +
  '0.5·distinct categories + 0.5·missing constructs + 1 if model calls + 0.5 if code + log2(1+depth). It rewards variety of constructs over raw size. ' +
  `At most ${COMPLEX_CAP} items per platform so the list spans platforms; uncapped, the top 30 are ` +
  sortedEntries(count(ranked.slice(0, 30), i => i.source.platform)).map(([p, n]) => `${p} ${n}`).join(', ') + '.', '');
w(table(['#', 'item', 'platform', 'licence', 'nodes/edges', 'br', 'loops', 'human', 'async', 'verdict', 'description (one line)'], complex30.map((it, i) => {
  const f = it.features;
  return [i + 1, `[${esc(cut(it.title || it.id, 60))}](${it.source.url.replace(/\)/g, '%29')})`, it.source.platform, cell(cut(it.source.license, 24)),
    `${f.nodeCount}/${f.edgeCount}`, f.branching, f.loops, f.humanSteps, f.async.join(',') || '-',
    verdictKind(it) === 'native' ? 'native' : cell(constructsOf(it).join(', ') || it.ir.verdict), esc(oneLine(it))];
})), '');

w('## 6. Recurring motifs and candidate standard operators', '');
w('Mining is over node labels: the category, with actions split by effect (`read`, `write`, `ext-call`), code split into pure `code` and effectful `script`, ' +
  'conditions as `branch`; workflow inputs/parameters are left out. Path motifs are label sequences along data/control/loop edges with runs of the same label ' +
  'merged (so a chain of ten writes counts as one `write`), length 2–4; support = number of items containing the motif. Each motif is counted once per item.', '');
const seqSupport = support(it => it._mo.seqs);
const TRIVIAL = new Set(['read', 'write', 'ext-call', 'action', 'transform', 'script', 'other']);
const clusterSize = new Map(ORIG_CLUSTERS.map(c => [c, items.filter(i => i._cluster === c).length]));
const macro = key => ORIG_CLUSTERS.reduce((a, c) => a + (key.byCluster.get(c) ?? 0) / clusterSize.get(c), 0) / ORIG_CLUSTERS.length;
const nonTrivial = seqSupport.filter(([s, r]) => s.split('>').length >= 3 && s.split('>').some(l => !TRIVIAL.has(l)) && r.platforms.size >= 3)
  .sort((a, b) => macro(b[1]) - macro(a[1]) || b[1].items - a[1].items);
w('**Top path motifs** (length 3–4, at least one non-plumbing label, >= 3 platforms), ranked by the mean over the four clusters of the share of items ' +
  'containing the motif, so that no cluster dominates by size or graph density:', '');
w(table(['motif', 'items', 'platforms', 'mean cluster share', ...ORIG_CLUSTERS.map(c => `${c} share`), 'examples'], nonTrivial.slice(0, 25).map(([s, r]) =>
  [`\`${s.replace(/>/g, ' → ')}\``, r.items, r.platforms.size, pct(macro(r) * 1000, 1000), ...ORIG_CLUSTERS.map(c => pct(r.byCluster.get(c) ?? 0, clusterSize.get(c))),
    r.examples.map(x => `\`${idc(cut(x, 50))}\``).join(' ')])), '');
w('Top motifs within each cluster (share of the cluster\'s items):', '');
w(table(['cluster', 'top non-plumbing motifs'], ORIG_CLUSTERS.map(c => [c, seqSupport.filter(([s]) => s.split('>').length >= 3 && s.split('>').some(l => !TRIVIAL.has(l)))
  .map(([s, r]) => [s, (r.byCluster.get(c) ?? 0)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
  .map(([s, n]) => `\`${s.replace(/>/g, ' → ')}\` ${pct(n, clusterSize.get(c))}`).join('; ')])), '');
w('**Plumbing motifs** (only fetch/write/call/transform/script labels), for scale: ' + seqSupport.filter(([s]) => s.split('>').length >= 3 && s.split('>').every(l => TRIVIAL.has(l)))
  .slice(0, 8).map(([s, r]) => `\`${s.replace(/>/g, ' → ')}\` ${r.items}`).join(', ') + '.', '');
w('**Fan-out shapes** (a node with >= 2 distinct successors; label → set of successor labels):', '');
w(table(['shape', 'items', 'platforms', 'clusters'], support(it => it._mo.fanOut).slice(0, 15).map(([s, r]) => [`\`${cell(s)}\``, r.items, r.platforms.size, r.clusters.size])), '');
w('**Fan-in shapes** (a node with >= 2 distinct predecessors):', '');
w(table(['shape', 'items', 'platforms', 'clusters'], support(it => it._mo.fanIn).slice(0, 12).map(([s, r]) => [`\`${cell(s)}\``, r.items, r.platforms.size, r.clusters.size])), '');
w('**Loop bodies** (labels on the cycle closed by a loop edge, or the direct body of a loop node):', '');
w(table(['body', 'items', 'platforms', 'clusters'], support(it => it._mo.loopBodies).slice(0, 12).map(([s, r]) => [`\`${cell(s)}\``, r.items, r.platforms.size, r.clusters.size])), '');
const errS = support(it => it._mo.errorTargets);
if (errS.length) w('**Error routes:** ' + errS.slice(0, 8).map(([s, r]) => `\`${cell(s)}\` ${r.items}`).join(', ') + '.', '');
w('### Comparison with `skills/micro-harness/references/operators.md`', '');
w('Structural detectors per operator (heuristic: they see shapes, not intent). Support counts items in which the shape occurs.', '');
const opSupport = id => { const its = items.filter(i => i._ops.has(id)); return { n: its.length, its, plats: new Set(its.map(i => i.source.platform)), clus: new Set(its.map(i => i._cluster)),
  ex: [...new Map(its.filter(i => i.source.redistributable).map(i => [i.source.platform, i.id])).values()].slice(0, 2) }; };
const topCluster = s => { if (!s.n) return '-'; const [c, n] = sortedEntries(count(s.its, i => i._cluster))[0]; return `${c} ${pct(n, s.n)}`; };
w(table(['operators.md', 'items', 'platforms', 'clusters', 'main cluster', 'examples / note'], OPERATORS.map(o => {
  const s = opSupport(o.id);
  return [cell(o.ref), s.n, s.plats.size, s.clus.size, topCluster(s), o.note ? cell(o.note) : s.ex.map(x => `\`${idc(cut(x, 50))}\``).join(' ')];
})), '');
w('**Recurring shapes that operators.md does not have** (candidates for standard operators; each is admitted only through the verify-before-store ' +
  'rules of ROADMAP §2.7, i.e. as a qualified library entry with its own executable check):', '');
w(table(['candidate operator', 'items', 'platforms', 'clusters', 'main cluster', 'Phase 1 IR', 'examples'], [...NEW_OPERATORS, { id: 'agent-tools', name: 'model with tools in a loop (agent-tool-loop)', irNote: 'needs `executor` / agent tools' }].map(o => {
  const s = opSupport(o.id);
  return [cell(o.name), s.n, s.plats.size, s.clus.size, topCluster(s), cell(o.irNote), s.ex.map(x => `\`${idc(cut(x, 50))}\``).join(' ')];
})), '');
const opsN = id => opSupport(id).n;
const opLine = id => { const x = opSupport(id); return `${x.n} items, main cluster ${topCluster(x)}`; };
w('Observations:', '',
  `- **operators.md shapes occur, mostly in the LLM app builders.** model → code: ${opLine('op2')}; classify → route: ${opLine('op3')}; map with a model body: ` +
  `${opLine('op1m')}; generate → verify loop: ${opLine('op6')}; parallel model calls that re-join: ${opLine('op7')}. Evidence → hypothesis → check is rare ` +
  `(${opsN('op8')} items) and pairwise judgment cannot be told apart from map-reduce by structure. The set fits model-heavy workflows; it says little about the ` +
  'plumbing that dominates human-built ones.',
  `- **Plumbing shapes that operators.md does not name dominate.** Scatter → gather: ${opLine('scatter-gather')}; fan-in to one aggregate: ${opLine('fan-in-report')}; ` +
  `fetch → transform → write: ${opLine('etl')}; trigger → guard → act: ${opLine('filter-act')}; poll-until: ${opLine('poll-until')}; approval gate: ` +
  `${opLine('approval-gate')}; menu dispatch: ${opLine('menu-dispatch')}; notify-on-failure: ${opLine('notify-on-failure')}. Almost all are expressible natively today.`,
  '- **Candidate standard operators** are the shapes that carry a check of their own and recur across clusters: poll-until (bounded `loop` over `wait` + task with an ' +
  '`until` and a timeout), approval gate (typed `human` answer, timeout routing), scatter-gather (`map` with `failure:"collect"` and a verify over the aggregate), ' +
  'filter-act (guard in `code`, effect as a task with an idempotency key) and notify-on-failure (needs the failure-handling bundle). Each is admitted only after ' +
  'it passes its own executable check in the library (ROADMAP §2.7), not because it is frequent.',
  `- Retrieve → generate (${opLine('rag')}) and prompt chains (${opLine('model-chain')}) map to agent nodes with untrusted-labelled inputs; ` +
  'they need the context compiler\'s label rules more than a new operator.', '');

w('## 7. Executable oracles', '');
w('Declared by the converters (`oracle.kind`): ' + sortedEntries(count(items, i => i.oracle.kind)).map(([k, n]) => `${k} ${n}`).join(', ') + '. None was run here. ' +
  'Plausibility tiers:', '');
const tierCount = count(items, oracleTier);
w(table(['tier', 'items', 'meaning'], ['T1', 'T2', 'T3', 'T0'].map(t => [t, tierCount.get(t) ?? 0, TIER_TEXT[t]])), '');
w(table(['platform', 'declared oracles', 'T1', 'T2', 'T3', 'T0', 'how'], platforms.map(p => {
  const its = items.filter(i => i.source.platform === p); const tc = count(its, oracleTier);
  const decl = sortedEntries(count(its.filter(i => i.oracle.kind !== 'none'), i => i.oracle.kind)).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
  return [p, decl, tc.get('T1') ?? 0, tc.get('T2') ?? 0, tc.get('T3') ?? 0, tc.get('T0') ?? 0, cell(planFor(its[0]))];
})), '');
w('Notes: running a source\'s own tests means executing downloaded code; that is a separate, owner-approved step in an isolated sandbox and was not done. ' +
  'The practical route for C0 is to derive fixtures once (recorded connector responses, expected outputs) and then judge the constructed Foundry workflow by ' +
  'running it against mocks (effect-trace and output equivalence), which needs no third-party runtime at grading time.', '');

w('## 8. Pilot shortlist: construct this workflow from its description, checked by execution', '');
w(`${candidates.length} items are eligible: redistributable, an original (or dataset-recovered) description of >= 60 characters, 4–60 nodes, an oracle tier ` +
  'of T1–T3, and no missing construct beyond the ones a harness can stand in for (trigger → run input, sub-workflow → inline, error-branch → `onError:"continue"` + `when`, ' +
  `completion-hook → all_resolved join, one-shot signal → \`human\` node answered by the harness). Ranked by oracle tier (T1 > T2 > T3), construct variety (branching, ` +
  `loops/maps, human, model, code, wait, scatter-gather), description quality and size, then picked with per-cluster quotas (${Object.entries(QUOTA).map(([k, v]) => `${k} ${v}`).join(', ')}; ` +
  `unused quota goes to the best remaining items), at most ${PLATFORM_CAP} per platform, no two items with the same node-type multiset or the same description. ` +
  `Shortlist: ${pilot.length} items. Development set only: items used to improve builders are not held-out evidence.`, '');
const t1NoDesc = items.filter(i => oracleTier(i) === 'T1' && i.source.redistributable && clean(i.description.text).length < 60);
w(`The binding constraint is descriptions, not oracles: ${t1NoDesc.length} redistributable T1 items (${sortedEntries(count(t1NoDesc, i => i.source.platform)).map(([p, n]) => `${p} ${n}`).join(', ')}) ` +
  'have no usable source description. Writing and freezing a description for each from its README/docstring (provenance `written`, before any construction run) ' +
  'would roughly triple the offline-gradable pool.', '');
w(table(['#', 'item', 'platform', 'tier', 'nodes', 'constructs', 'mock/rewrite', 'oracle plan', 'description (one line)'], pilot.map((c, i) => {
  const it = c.it, f = it.features;
  const cons = [f.branching && `branch ${f.branching}`, f.loops && `loop ${f.loops}`, f.humanSteps && `human ${f.humanSteps}`, f.hasModelCalls && 'model', f.hasCode && 'code',
    f.async.includes('wait') && 'wait', it._mo.diamonds && 'scatter-gather'].filter(Boolean).join(', ');
  const mock = constructsOf(it).map(x => MOCK_HOW[x]).filter((x, j, a) => a.indexOf(x) === j).join('; ') || '-';
  return [i + 1, `[${esc(cut(it.title, 50))}](${it.source.url.replace(/\)/g, '%29')})`, it.source.platform, c.tier, f.nodeCount, cons || '-', cell(mock), cell(planFor(it)), esc(oneLine(it))];
})), '');
const pilotTier = count(pilot, c => c.tier);
w(`Tier mix: ${['T1', 'T2', 'T3'].map(t => `${t} ${pilotTier.get(t) ?? 0}`).join(', ')}. T1 items can be graded as soon as their shipped tests are ported to mock tables; ` +
  'T3 items need fixtures authored once per item (connector responses and the expected effect trace), from the source\'s documentation and pinned data, ' +
  'before construction runs; T2 items are a stretch set that needs containers. Freeze the shortlist, fixtures and pass criteria before any comparative run.', '');

w('## 9. Limits and unknowns', '',
  '- All verdicts are structural claims from static conversion; no item was compiled into Foundry IR, so expressibility is plausible, not demonstrated. A per-item IR ' +
  'compilation of the pilot shortlist is the next check.',
  '- Converters differ in granularity (steps vs jobs vs tasks; inlined vs referenced sub-workflows), so cross-platform size comparisons are indicative.',
  '- Licences were read from repository LICENSE files, package metadata, dataset cards or platform terms; per-template authors\' terms inside marketplaces were not verified.',
  '- Domain tags are keyword heuristics and over-tag.',
  `- The corpus is development/diagnostic material. Sealed evaluation needs fresh items selected and frozen before any builder is tuned on this set.`, '');
// ---------------------------------------------------------------- 10. agentic cluster
// Third-party and first-party items are never pooled: every count below names its slice.
const tp = agentic.filter(i => !isFirstParty(i)), fp = agentic.filter(isFirstParty);
const NT = tp.length;
const ORIG_IDS = CONSTRUCT_IDS.slice(0, ORIGINAL_CONSTRUCT_COUNT), NEW_IDS = CONSTRUCT_IDS.slice(ORIGINAL_CONSTRUCT_COUNT);
const isNewId = c => NEW_IDS.includes(c);
const fullNotes = it => partNotes.get(it.id) ?? it.ir.notes;
const refusalsOf = it => parseVerdict(it.ir.verdict)?.refusals ?? [];
const needsOf = it => verdictClass(it) === 'refused-by-design' ? (notesNeeds(fullNotes(it)) ?? []) : constructsOf(it);
const cls = list => count(list, verdictClass);
const n = (m, k) => m.get(k) ?? 0;
const with19 = it => verdictClass(it) === 'native' || (verdictClass(it) === 'via-extension' && constructsOf(it).every(c => ORIG_IDS.includes(c)));
const withAll = it => ['native', 'via-extension'].includes(verdictClass(it));
const cnt = (list, fn) => list.filter(fn).length;
const nc = (k, total) => `${k} (${pct(k, total)})`;
const fmtCounts = m => sortedEntries(m).map(([k, v]) => `${k} ${v}`).join(', ');
const mla = mergeLogFor(c => c === 'agentic');
const ga = mergeLog.agentic ?? { graphEvidenceNotApplied: [], modelDrivenCycles: [] };
const agenticPart = mergeLog.inputs.find(p => p.cluster === 'agentic');
const ledgerPath = path.join(ROOT, 'parts', 'agentic-ledger.md');
const assembled = fs.existsSync(ledgerPath) ? /^- Result: (\d+) kept, (\d+) dropped/m.exec(fs.readFileSync(ledgerPath, 'utf8')) : null;
// Where the design refusals are written down. They were proposed in research/review-20261007/ROADMAP-AMENDMENTS.md; the WIP
// commit 8fa9124 (2026-10-08, "amendments applied (design review defaults)", unreviewed) copied them into docs/ROADMAP.md.
const REFUSAL_TEXT = 'docs/ROADMAP.md §2.1 coverage goal and §3, applied from ROADMAP-AMENDMENTS as review defaults in WIP commit 8fa9124, not yet owner-reviewed';
// Stage bundles of the staged plan in research/review-20261007/02b-agentic-constructs.md §5: lane 2's stages S1–S7
// (research/review-20261007/02-ir-expressiveness.md §7) with the twelve agentic constructs placed by mechanism. This
// report only computes their declared coverage; the plan, its order and its reasons are in 02b.
const STAGES = [
  ['S1', 'call by hash, local flows, `self`; flow size', ['subworkflow-call', 'flow-size>500']],
  ['S2', 'error routes, `finally`, adaptive retry; model-written code in the sandbox', ['error-branch', 'completion-hook', 'adaptive-retry', 'model-generated-code-exec']],
  ['S3', 'triggers and run admission', ['schedule-trigger', 'webhook-trigger', 'event-trigger', 'poll-trigger', 'run-concurrency-policy']],
  ['S4', 'signals, event and long waits', ['signal-wait', 'durable-wait']],
  ['S5', 'state capability, chat sessions, capped tool loop', ['agent-tool-loop', 'chat-session', 'cross-run-state']],
  ['S5b', 'inside the tool loop: agents as tools, approvals with resume, guards, compaction', ['agent-as-tool', 'interrupt-resume', 'guardrail-tripwire', 'context-compaction']],
  ['S5c', 'media inputs and outputs', ['multimodal-io']],
  ['S6', 'bounded machine, streams, partial outputs', ['unstructured-cycle', 'stream', 'partial-output-stream']],
  ['S7', 'flow params, plan/expand, agent spawn, fork', ['parametric-action-input', 'dynamic-dag', 'dynamic-agent-spawn', 'checkpoint-rewind']],
  ['S8', 'run board', ['shared-scratchpad', 'state-reducer']],
  ['S9', 'environment sessions', ['env-session']],
];
{
  const staged = STAGES.flatMap(s => s[2]);
  if (staged.length !== CONSTRUCT_IDS.length || new Set(staged).size !== staged.length || staged.some(c => !CONSTRUCT_IDS.includes(c)))
    throw new Error('STAGES must place every registry construct exactly once');
}

w('## 10. Agentic cluster (agent frameworks)', '');
w(`${NA} items: ${NT} third-party items from ${new Set(tp.map(i => i.source.platform)).size} source platforms and ` +
  `${NFP} first-party items (${FIRST_PARTY_PLATFORMS.map(p => `\`${p}\``).join(', ')}). ` +
  'Source: `parts/agentic.jsonl`, assembled by `scripts/agentic-assemble.mjs` from the verified and harmonised staging files; the acquisition record, ' +
  'with a header table per platform (repositories, revisions, licences, items kept and dropped, verification outcome), the harmonisation log and every platform ledger, ' +
  'is `parts/agentic-ledger.md`.', '',
  'How these verdicts differ from sections 1–9: they are **model readings of pinned source** (`source.extraction`: method `model-read-source`, the spans read, the ' +
  'extractor, and a pointer to the independent verifier pass), re-labelled to one convention, `AGENTIC-CONVENTIONS.md`. That convention adds twelve registry ' +
  `constructs after the original ${ORIGINAL_CONSTRUCT_COUNT} (${NEW_IDS.map(c => `\`${c}\``).join(', ')}), retires topology labels as tokens ` +
  '(`llm-router`, `supervisor-delegation`, handoff and chat patterns are native lowerings, counted in 10.8), and introduces owner design refusals, ' +
  '`unsupported:by-design-group-chat` and `unsupported:by-design-full-history-handoff`. A refused item is representable with a turn cap but refused by design ' +
  `("share decisions and artifacts, not transcripts"; ${REFUSAL_TEXT}), so it is counted apart from \`unsupported\` ` +
  'items, which are not expressible at all. Nothing was compiled or executed. **First-party items** are workflow scripts written by this project\'s own ' +
  'orchestrating agent: they are not independent evidence of what workflows need, so every table keeps them in their own row or column (10.9).', '');

w('### 10.1 Merge', '');
const evid = ga.graphEvidenceNotApplied;
const evErr = evid.filter(e => e.evidence.some(x => /error edge/.test(x))).length, evSub = evid.filter(e => e.evidence.some(x => /sub-workflow node/.test(x))).length;
const cutNotes = agentic.filter(i => i.ir.notes.length >= 2000).length;
w(`- **Input:** \`parts/agentic.jsonl\` ${agenticPart?.lines ?? 0} lines (sha256 \`${(agenticPart?.sha256 ?? '').slice(0, 16)}…\`); ${NA} items in \`items.jsonl\`. ` +
  `Dropped by the checker: ${mla.drops.length}${mla.drops.length ? ` (${mla.drops.map(d => `\`${cut(d.id ?? `line ${d.line}`, 60)}\` ${d.reason}: ${cut(d.detail, 120)}`).join('; ')})` : ''}; ` +
  `duplicates: ${mla.dedupe.dropped.length}. ` + (assembled ? `Before the merge, \`agentic-assemble.mjs\` kept ${assembled[1]} and dropped ${assembled[2]} staged items ` +
  '(its checks and any drops are listed in `parts/agentic-ledger.md`).' : 'The assembler ledger `parts/agentic-ledger.md` is missing.'),
  `- **Checker:** canonical mode passes for every agentic item. It now accepts the optional provenance object \`source.extraction\` (method, spans, extractor, verifier; ` +
  'shape validated, other keys still rejected), the twelve agentic registry ids, `unsupported:by-design-*` verdicts with a known refusal and a `Needs:` list or ' +
  '"No further construct would be needed", and `local:<path>` URLs for first-party platforms only (the first-party scripts have no public location).',
  `- **Repairs:** ${Object.entries(mla.fixes).map(([k, v]) => `${k} ${v.count}`).join(', ') || 'none'}. Features recomputed as for every cluster; ` +
  `changed values: ${Object.entries(mla.featureChanges).map(([k, v]) => `${k} ${Object.values(v).reduce((a, b) => a + b, 0)}`).join(', ') || 'none'} ` +
  '(connector lists sorted and de-duplicated).',
  `- **Verdicts:** ${mla.verdict.changed} changed by the merge. Agentic tokens map by identity (\`TOKEN_MAPS.agentic\` in merge-items.mjs; a retired or unknown token ` +
  `stops the merge). Transitions: ${Object.entries(mla.verdict.kindTransitions).map(([k, v]) => `${k.replace(/^agentic: /, '')} ${v}`).join(', ')}.`,
  `- **Graph evidence recorded, not applied:** the converter clusters turn every error edge into \`error-branch\` and every by-reference sub-workflow node into ` +
  `\`subworkflow-call\`. Here the readers judged those nodes (for example \`onError:"continue"\` retries, a workflow-level \`onError\` hook read as \`completion-hook\`, ` +
  `sub-applications inlined as a \`map\` body, agents called as tools), so ${evid.length} items keep their verdicts (${evErr} with error edges, ${evSub} with sub-workflow ` +
  'nodes); `ir.notes` and `merge-log.json` (`agentic.graphEvidenceNotApplied`) record the evidence. Applying the converter rule would add `error-branch` or ' +
  '`subworkflow-call` to them.',
  `- **Cycles:** ${ga.modelDrivenCycles.length} graphs have a cycle over data/control edges without a \`loop\` edge. These are model-driven loops (tool loops, chat ` +
  're-entry, handoff or speaker meshes, capped retries) that the verdict carries through a construct, a refusal or a named cap (rules BL, UC); none is an ' +
  'edge-inference artefact and none counts as `unstructured-cycle`.',
  `- **Notes length:** the merge cuts \`ir.notes\` at 2,000 characters for every cluster; ${cutNotes} of ${NA} agentic notes reach the cut, so part of the ` +
  'extractor and verifier record is missing from `items.jsonl`. The convention header (verdict, refusal, `Needs:`, changes, native patterns) survives in every item, ' +
  'the full notes are in `parts/agentic.jsonl`, and the source spans in `source.extraction.spans`.', '');

w('### 10.2 Counts', '');
const aPlatforms = allPlatforms.filter(p => platformCluster.get(p) === 'agentic').sort((a, b) =>
  Number(FIRST_PARTY_PLATFORMS.includes(a)) - Number(FIRST_PARTY_PLATFORMS.includes(b)) || a.localeCompare(b));
w(table(['platform', 'party', 'items', 'redistributable', 'top licences', 'native', 'via-extension', 'refused: group chat / full-history handoff', 'most frequent constructs (tokens)'],
  aPlatforms.map(p => {
    const its = agentic.filter(i => i.source.platform === p), c = cls(its);
    const lic = sortedEntries(count(its, i => i.source.license)).slice(0, 3).map(([l, k]) => `${cell(cut(l, 40))} ${k}`).join(', ');
    const rf = r => its.filter(i => refusalsOf(i).includes(r)).length;
    const top = sortedEntries(count(its.flatMap(constructsOf), x => x)).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
    return [p, FIRST_PARTY_PLATFORMS.includes(p) ? 'first-party' : 'third-party', its.length, its.filter(i => i.source.redistributable).length, lic,
      n(c, 'native'), n(c, 'via-extension'), `${rf('group-chat')} / ${rf('full-history-handoff')}`, top || '-'];
  })), '');
const sliceRow = (name, its) => {
  const c = cls(its), d = count(its, i => i.description.provenance);
  return [name, its.length, new Set(its.map(i => i.source.platform)).size, its.filter(i => i.source.redistributable).length, n(c, 'native'), n(c, 'via-extension'),
    n(c, 'refused-by-design'), n(c, 'unsupported'), `${n(d, 'original')} / ${n(d, 'recovered-by-model')} / ${n(d, 'written')}`];
};
w(table(['slice', 'items', 'source platforms', 'redistributable', 'native', 'via-extension', 'refused by design', 'unsupported (not expressible)', 'description original / recovered / written'],
  [sliceRow('original corpus (sections 1–9)', items), sliceRow('agentic, third-party', tp), sliceRow('agentic, first-party', fp)]), '');
w(`Licences, third-party: ${fmtCounts(count(tp, i => i.source.license))}; first-party: ${fmtCounts(count(fp, i => i.source.license))} (no licence file; ` +
  'kept as URL + derived graph + features only). Declared oracles: third-party ' + fmtCounts(count(tp, i => i.oracle.kind)) + '; first-party ' +
  fmtCounts(count(fp, i => i.oracle.kind)) + '. None was run.', '');
w('Median / p90 / max:', '');
const mq = (list, fn) => { const v = list.map(fn).sort((a, b) => a - b); return v.length ? `${fmt(quantile(v, 0.5))} / ${fmt(quantile(v, 0.9))} / ${v.at(-1)}` : '-'; };
w(table(['metric', 'original corpus', 'agentic, third-party', 'agentic, first-party'], METRICS.map(([name, fn]) => [name, mq(items, fn), mq(tp, fn), mq(fp, fn)])), '');
w('Prevalence (share of items):', '');
w(table(['feature', 'original corpus', 'agentic, third-party', 'agentic, first-party'], PREV.map(([name, fn]) =>
  [name, pct(cnt(items, fn), N), pct(cnt(tp, fn), NT), pct(cnt(fp, fn), NFP)])), '');

w('### 10.3 Coverage: declared, with the 19 original constructs, with all registry constructs', '');
w(`*Declared native* is the verdict as recorded. *With the ${ORIGINAL_CONSTRUCT_COUNT} original constructs* counts the items that become expressible once every ` +
  `construct of the original registry exists (native, plus via-extension items whose tokens are all among the ${ORIGINAL_CONSTRUCT_COUNT}). *With all ${CONSTRUCT_IDS.length}* ` +
  `adds the twelve agentic constructs (native plus every via-extension item). Refused items stay out of every column; lifting a refusal would need its ` +
  '`Needs:` list plus a construct for the history fork or the shared transcript, which the registry does not have. First-party items are shown but not pooled.', '');
const covRow = (name, its) => {
  const c = cls(its);
  return [name, its.length, nc(n(c, 'native'), its.length), nc(cnt(its, with19), its.length), nc(cnt(its, withAll), its.length), n(c, 'refused-by-design'), n(c, 'unsupported')];
};
const combined = [...items, ...tp];
w(table(['slice', 'items', 'declared native', `with the ${ORIGINAL_CONSTRUCT_COUNT} original constructs`, `with all ${CONSTRUCT_IDS.length} constructs`, 'refused by design', 'unsupported (not expressible)'],
  [covRow('original corpus', items), covRow('agentic, third-party', tp), covRow('combined (original + agentic third-party)', combined), covRow('agentic, first-party (not pooled)', fp)]), '');
const tpVia = tp.filter(i => verdictClass(i) === 'via-extension');
const needNew = tpVia.filter(i => constructsOf(i).some(isNewId));
const onlyNew = tpVia.filter(i => constructsOf(i).every(isNewId));
w(`Of the ${tpVia.length} third-party via-extension items, ${needNew.length} (${pct(needNew.length, tpVia.length)}) need at least one agentic construct and ` +
  `${onlyNew.length} need agentic constructs only; ${tpVia.length - needNew.length} need original constructs only (most often ` +
  sortedEntries(count(tpVia.filter(i => !constructsOf(i).some(isNewId)).flatMap(constructsOf), x => x)).slice(0, 3).map(([k, v]) => `\`${k}\` ${v}`).join(', ') +
  '). The original corpus uses none of the agentic constructs, so its two right-hand columns are equal. Counting the refused items\' `Needs:` lists as if the ' +
  `refusals were lifted (and ignoring the missing transcript construct), ${cnt(tp.filter(i => verdictClass(i) === 'refused-by-design'), i => needsOf(i).some(isNewId))} of ` +
  `${cnt(tp, i => verdictClass(i) === 'refused-by-design')} refused items would need an agentic construct too.`, '');

w('### 10.4 Missing constructs in the agentic slice', '');
w('Third-party items needing each construct (verdict tokens), and in brackets the count when the `Needs:` lists of refused items are added. "Only blocker" ' +
  'counts third-party items for which this construct is the single thing between them and `native`. The original-corpus column is the count from section 4.', '');
const tpFreq = count(tp.flatMap(constructsOf), x => x);
const tpNeedFreq = count(tp.flatMap(needsOf), x => x);
const tpSole = count(tp.filter(i => verdictClass(i) === 'via-extension' && constructsOf(i).length === 1), i => constructsOf(i)[0]);
const fpFreq = count(fp.flatMap(constructsOf), x => x);
const origFreq = count(items.flatMap(constructsOf), x => x);
const consRows = CONSTRUCT_IDS.filter(c => n(tpNeedFreq, c) || n(fpFreq, c) || isNewId(c))
  .sort((a, b) => n(tpFreq, b) - n(tpFreq, a) || n(tpNeedFreq, b) - n(tpNeedFreq, a) || CONSTRUCT_IDS.indexOf(a) - CONSTRUCT_IDS.indexOf(b));
w(table(['#', 'construct', 'registry', 'third-party items (with refused needs)', 'share of third-party', 'only blocker', 'platforms (with refused needs)', 'first-party items', 'original corpus items', 'ROADMAP coverage', 'Phase 1 IR today'],
  consRows.map((c, i) => {
    const def = CONSTRUCTS.find(x => x.id === c);
    const plats = new Set(tp.filter(it => needsOf(it).includes(c)).map(it => it.source.platform)).size;
    return [i + 1, `\`${c}\``, isNewId(c) ? 'agentic' : 'original', `${n(tpFreq, c)} (${n(tpNeedFreq, c)})`, pct(n(tpFreq, c), NT), n(tpSole, c), plats, n(fpFreq, c), n(origFreq, c), cell(def.roadmap), cell(def.today)];
  })), '');
w('The twelve agentic registry constructs and the two design refusals by source platform (third-party items; for a construct, verdict tokens and in ' +
  'brackets the count with the `Needs:` lists of refused items; for a refusal, refused items). First-party items are counted in their own column. ' +
  'The original corpus has none of these tokens (its converters never emitted them; see 02b §6 for a node-type probe).', '');
{
  const byPlat = (list, has, hasNeed) => {
    const m = new Map();
    for (const it of list) { if (!hasNeed(it)) continue; const p = it.source.platform; const e = m.get(p) ?? [0, 0]; e[1]++; if (has(it)) e[0]++; m.set(p, e); }
    return [...m.entries()].sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0] || a[0].localeCompare(b[0]))
      .map(([p, [a, b]]) => a === b ? `${p} ${a}` : `${p} ${a} (${b})`).join(', ') || '-';
  };
  const rows = [...NEW_IDS.map(c => [`\`${c}\``, byPlat(tp, it => constructsOf(it).includes(c), it => needsOf(it).includes(c)),
      new Set(tp.filter(it => needsOf(it).includes(c)).map(it => it.source.platform)).size, n(fpFreq, c)]),
    ...REFUSALS.map(r => { const has = it => refusalsOf(it).includes(r);
      return [`refused: \`${r}\``, byPlat(tp, has, has), new Set(tp.filter(has).map(it => it.source.platform)).size, cnt(fp, has)]; })];
  w(table(['construct or refusal', 'third-party items by platform', 'platforms', 'first-party items'], rows), '');
}

function greedyOrder(pool) {
  const remaining = new Set(pool.filter(i => verdictClass(i) === 'via-extension'));
  const added = new Set(); const steps = []; let cum = cnt(pool, i => verdictClass(i) === 'native');
  while (remaining.size) {
    let best = null, bestGain = -1, bestFreq = -1;
    for (const c of CONSTRUCT_IDS) {
      if (added.has(c)) continue;
      let gain = 0, freq = 0;
      for (const it of remaining) { const t = constructsOf(it); if (!t.includes(c)) continue; freq++; if (t.every(x => x === c || added.has(x))) gain++; }
      if (gain > bestGain || (gain === bestGain && freq > bestFreq)) { best = c; bestGain = gain; bestFreq = freq; }
    }
    if (!best || bestFreq === 0) break;
    added.add(best);
    const newly = [...remaining].filter(it => constructsOf(it).every(x => added.has(x)));
    for (const it of newly) remaining.delete(it);
    cum += newly.length;
    steps.push({ c: best, newly, cum });
  }
  return steps;
}
w('### 10.5 Greedy extension order', '');
w(`Same rule as section 4 (each step adds the construct that makes the most additional items expressible; ties go to the more frequent construct, then registry ` +
  `order), over all ${CONSTRUCT_IDS.length} registry constructs. Refused and unsupported items never become expressible.`, '');
w('Agentic third-party slice:', '');
w(table(['step', 'add', 'registry', 'newly expressible', 'cumulative expressible'], greedyOrder(tp).map((s, i) =>
  [i + 1, `\`${s.c}\``, isNewId(s.c) ? 'agentic' : 'original', s.newly.length, `${s.cum} (${pct(s.cum, NT)})`])), '');
w(`Combined, the original corpus and the agentic third-party slice (${combined.length} items; first-party excluded):`, '');
let cumO = cnt(items, i => verdictClass(i) === 'native'), cumA = cnt(tp, i => verdictClass(i) === 'native');
w(`Start: ${cumO + cumA} declared native (${pct(cumO + cumA, combined.length)}): original ${cumO}, agentic ${cumA}.`, '');
w(table(['step', 'add', 'registry', 'newly expressible: original', 'newly expressible: agentic', 'cumulative: original', 'cumulative: agentic', 'cumulative: combined'],
  greedyOrder(combined).map((s, i) => {
    const o = s.newly.filter(it => isOrigCluster(it._cluster)).length, a = s.newly.length - o;
    cumO += o; cumA += a;
    return [i + 1, `\`${s.c}\``, isNewId(s.c) ? 'agentic' : 'original', o, a, `${cumO} (${pct(cumO, N)})`, `${cumA} (${pct(cumA, NT)})`, `${s.cum} (${pct(s.cum, combined.length)})`];
  })), '');

w('### 10.6 Staged plan to full declared coverage', '');
const pct2 = (a, b) => b ? `${(100 * a / b).toFixed(2)}%` : '-';
const expressibleWith = (it, have) => verdictClass(it) === 'native' || (verdictClass(it) === 'via-extension' && constructsOf(it).every(c => have.has(c)));
const namedRefusals = combined.filter(i => ['refused-by-design', 'unsupported'].includes(verdictClass(i)));
const stageRows = []; const stageJson = [];
{
  const have = new Set();
  let prev = { o: cnt(items, i => expressibleWith(i, have)), a: cnt(tp, i => expressibleWith(i, have)), f: cnt(fp, i => expressibleWith(i, have)) };
  const push = (id, what, cs, cur) => {
    const c = cur.o + cur.a;
    stageRows.push([id, cell(what), cs.length ? cs.map(x => `\`${x}\``).join(', ') : '-', cs.length ? cur.o - prev.o : '-', cs.length ? cur.a - prev.a : '-',
      `${cur.o} (${pct2(cur.o, N)})`, `${cur.a} (${pct2(cur.a, NT)})`, `${c} (${pct2(c, combined.length)})`,
      `${c + namedRefusals.length} (${pct2(c + namedRefusals.length, combined.length)})`, `${cur.f} of ${NFP}`]);
    stageJson.push({ stage: id, adds: cs, original: cur.o, agenticThirdParty: cur.a, combined: c, decided: c + namedRefusals.length, firstParty: cur.f });
  };
  push('S0', 'start: declared native', [], prev);
  for (const [id, what, cs] of STAGES) {
    for (const c of cs) have.add(c);
    const cur = { o: cnt(items, i => expressibleWith(i, have)), a: cnt(tp, i => expressibleWith(i, have)), f: cnt(fp, i => expressibleWith(i, have)) };
    push(id, what, cs, cur);
    prev = cur;
  }
}
w(`Stage bundles from \`research/review-20261007/02b-agentic-constructs.md\` §5 (lane 2's S1–S7 of \`02-ir-expressiveness.md\` §7, with the twelve ` +
  'agentic constructs placed by mechanism); this report only computes their declared coverage. A stage adds its constructs to every earlier one. ' +
  '*Expressible* counts native items plus via-extension items whose tokens are all added. *Decided* adds the items already rejected with a named reason ' +
  `(${namedRefusals.length} in the combined corpus: ${fmtCounts(count(namedRefusals, i => i.ir.verdict.replace(/^unsupported:/, '')))}), which is the ROADMAP ` +
  '§2.1 coverage goal ("represented exactly or rejected with a named reason"). Declared only: nothing here is compiled or executed. First-party items ' +
  'are shown in the last column and are not part of any other column.', '');
w(table(['stage', 'adds (02b)', 'constructs', 'newly expressible: original', 'newly expressible: agentic third-party', 'cumulative: original',
  'cumulative: agentic third-party', 'cumulative: combined expressible', 'combined decided (expressible + named refusals)', 'first-party expressible (not pooled)'], stageRows), '');
{
  const rem = new Set(combined.filter(i => verdictClass(i) === 'via-extension')); const have = new Set(); const used = new Set(); const steps = [];
  let cum = cnt(combined, i => verdictClass(i) === 'native');
  while (used.size < STAGES.length) {
    let best = null, gain = -1;
    for (const s of STAGES) {
      if (used.has(s[0])) continue;
      const next = new Set([...have, ...s[2]]);
      const g = [...rem].filter(i => constructsOf(i).every(c => next.has(c))).length;
      if (g > gain) { gain = g; best = s; }
    }
    used.add(best[0]); for (const c of best[2]) have.add(c);
    for (const i of [...rem]) if (constructsOf(i).every(c => have.has(c))) rem.delete(i);
    cum += gain; steps.push(`${best[0]} +${gain} (${pct(cum, combined.length)})`);
  }
  w(`Greedy order over the same bundles (combined corpus; each step adds the bundle that makes the most additional items expressible): ${steps.join(' → ')}. ` +
    'Where the plan order differs, 02b §5 gives the dependency or capability reason.', '');
}

w('### 10.7 Design refusals', '');
const refused = tp.filter(i => verdictClass(i) === 'refused-by-design');
w(table(['refusal', 'items', 'platforms', 'needs if lifted (most frequent)', 'needing no further construct'], REFUSALS.map(r => {
  const its = refused.filter(i => refusalsOf(i).includes(r));
  return [`\`unsupported:by-design-${r}\``, its.length, fmtCounts(count(its, i => i.source.platform)),
    sortedEntries(count(its.flatMap(needsOf), x => x)).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ') || '-', its.filter(i => !needsOf(i).length).length];
})), '');
w(`${refused.length} third-party items (${pct(refused.length, NT)}) are refused; no first-party item is. Rule GC refuses a shared transcript whose next speaker a model ` +
  'picks; a chat whose speaker order code fixes stays native. Rule HO refuses a model-initiated transfer to an agent that continues the same conversation; ' +
  `transfers chosen by code, typed handoffs without the transcript and transfers into task pipelines are routing. The refusals rest on ${REFUSAL_TEXT}; ` +
  'if the owner lifts one, its items move to via-extension with their `Needs:` list plus a history-fork or shared-transcript construct.', '');

w('### 10.8 Native patterns recorded in the notes', '');
const PATTERNS = ['llm-router', 'supervisor-delegation', 'code-selected-chat', 'task-pipeline transfer', 'typed-handoff'];
const patternText = it => /Native patterns, no token: (.*?)(?: The record below predates|$)/s.exec(fullNotes(it))?.[1] ?? '';
w('Topologies that need no IR mechanism of their own are not verdict tokens; each item names them after "Native patterns, no token:" with source spans ' +
  '(AGENTIC-CONVENTIONS.md §4), so they stay countable. Lowerings: `llm-router` is an `agent` with `role:"route"` and an enum output followed by `when` guards; ' +
  '`supervisor-delegation` is a capped route loop or `agent-tool-loop`+`agent-as-tool`; a code-selected chat is a capped loop over `when`-guarded agents with ' +
  'the transcript as an explicit input; typed and task-pipeline transfers are routing.', '');
w(table(['pattern', 'third-party items', 'platforms', 'of them refused by design', 'first-party items'], PATTERNS.map(p => {
  const its = tp.filter(i => patternText(i).includes(p));
  return [`\`${p}\``, its.length, new Set(its.map(i => i.source.platform)).size, its.filter(i => verdictClass(i) === 'refused-by-design').length, cnt(fp, i => patternText(i).includes(p))];
})), '');
w(`Items naming at least one native pattern: third-party ${cnt(tp, i => patternText(i))}, first-party ${cnt(fp, i => patternText(i))}.`, '');

w('### 10.9 First-party slice (not pooled)', '');
w(`${NFP} \`claude-code-workflows\` items: dynamic workflow scripts written by this project's own orchestrating agent during earlier sessions, read from local ` +
  'copies (`local:` URLs, sha256 revisions). They show what this project\'s agent builds for itself, which is not evidence of what third-party workflows need, ' +
  'and models of the same family wrote, extracted and verified them. Licence unknown (no licence file), so only URL, a written description, the derived graph and ' +
  'features are kept.', '');
w(table(['item', 'nodes / edges', 'verdict', 'description (one line)'], fp.map(it =>
  [`\`${idc(cut(it.id.replace(/^claude-code-workflows:claude-session\/workflows\/scripts\//, ''), 60))}\``, `${it.features.nodeCount} / ${it.features.edgeCount}`,
    verdictKind(it) === 'native' ? 'native' : cell(constructsOf(it).join(', ')), esc(oneLine(it))])), '');

w('### 10.10 Limits', '',
  '- The verdicts are static model readings, checked by a second model pass and re-labelled by a third; none was compiled into Foundry IR or executed. ' +
  'Agreement between passes is not ground truth.',
  '- The items are framework examples, tutorials and templates chosen to cover each framework\'s orchestration features, not a random sample of deployed ' +
  'agent workflows. Construct frequencies describe this purposive sample.',
  '- The convention fixes four contested calls that change counts (AGENTIC-CONVENTIONS.md §9): the refusals rest on ROADMAP text applied as review defaults in an unreviewed WIP commit (8fa9124); three ADK transfers ' +
  'into task pipelines are routing, not refusals; code-selected shared-transcript chats are native; chat history counts as `cross-run-state` and scripted ' +
  'sessions as `chat-session`.',
  `- The registry groups all twelve agentic constructs under \`agentic\`; AGENTIC-CONVENTIONS.md §3.3 proposed state, async and dynamism groups for six of them.`,
  '- `state-reducer` has no item in this slice; it stays in the registry for the planned board mechanism.',
  '- Open rulings that would move single items (not the totals of 10.3 or the last row of 10.6) are listed in 02b §6: the Strands A2A orchestrator ' +
  '(served chat agent, `chat-session`+`cross-run-state` or not) and `guardrail-tripwire` around a tool-free agent.',
  '- The original clusters were labelled before this convention. Their converters never emit agentic tokens or design refusals, so sections 1–9 hold ' +
  'none; 02b §6 lists a node-type probe of the original items the convention would re-label. Any re-labelling of the frozen original corpus needs a ' +
  'pre-registered amendment (02-ir-expressiveness.md §8).', '');
fs.writeFileSync(path.join(ROOT, 'COVERAGE.md'), W.join('\n'));

console.log(JSON.stringify({ items: N, redistributable: nRedis, verdicts: Object.fromEntries(V), pilot: pilot.length, candidates: candidates.length,
  sampleItems: sample.length, sampleBytes: sample.length ? fs.statSync(path.join(ROOT, 'items-sample.jsonl')).size : 0, tiers: Object.fromEntries(tierCount),
  agentic: { items: NA, thirdParty: NT, firstParty: NFP, thirdPartyVerdicts: Object.fromEntries(cls(tp)), firstPartyVerdicts: Object.fromEntries(cls(fp)) },
  coverage: Object.fromEntries([['original', items], ['agenticThirdParty', tp], ['combined', combined], ['firstParty', fp]].map(([k, its]) =>
    [k, { items: its.length, declaredNative: cnt(its, i => verdictClass(i) === 'native'), with19: cnt(its, with19), withAll: cnt(its, withAll),
      refusedByDesign: cnt(its, i => verdictClass(i) === 'refused-by-design'), unsupported: cnt(its, i => verdictClass(i) === 'unsupported') }])),
  stages: stageJson }));
