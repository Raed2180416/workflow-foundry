// LOCALISE (DESIGN §6): counterfactual replay. Replay the recorded run from its journal, substitute ONE node output at a time,
// re-run everything downstream deterministically, and rank the substitutions that turn a failure into a pass (with an oracle)
// or change the answer without any guard noticing (without one). $0: nothing here reaches a provider, except `varianceTest`.
//
// Two substitution mechanisms (both on copies, never on the recorded files):
//   inject  an agent node: a newer journal row with the same replay key and the flipped value, so the node's own checks and
//           escalation stay live. A flipped value that fails the node's checks needs a live escalation: `needsLive`.
//   pin     a code node: replaced by a constant that keeps every ref the original read (P-1).
//
// Output: `heal-localization/1`. The model (proposer) later sees typed facts from it, never the oracle or hidden truth.
import { loadKit } from './kit.mjs';
import { openCtx, replayRun, fidelity, pinNode, injectRow, uninject, sameKeyCount, acceptedCalls, oracleOf, taskOf, allTrials } from './replay.mjs';
import { resolveNode, topFrame, topoOrder, ancestorsOf, enumLeaves, booleanLeaves, getAt, setAt, downstreamFields, nodeRefs, refsIn, nodeRef, canonical, changedShare, locusOf, cloneGroups, checkTrace, decisionFields } from './ir.mjs';

export const LOCALISATION = 'heal-localization/1';
export const DEFAULTS = Object.freeze({ concurrency: 3, maxCandidates: 96, capRootAgent: 64, capBodyAgent: 16, capCode: 16, capAlt: 2, fragileShare: 0.05, tau: 0.2 });

// Short string fields next to a flipped leaf (the `system` of `orders[0].numeric_order`): what the leak scanner and the stratifier call
// the identifier of the flip. Never the flipped field itself.
// A string enum that names each entry of an array of objects (orders[].system) is the entry's identity, not a decision: never flipped.
function isIdentifier(value, leaf) {
  if (leaf.path.length < 2 || typeof leaf.value !== 'string') return false;
  const items = getAt(value, leaf.path.slice(0, -2));
  if (!Array.isArray(items) || items.length < 2) return false;
  const keys = items.map(it => it?.[leaf.path.at(-1)]);
  return keys.every(k => typeof k === 'string') && new Set(keys).size === keys.length;
}
function identityOf(value, path) {
  const parent = path.length > 1 ? getAt(value, path.slice(0, -1)) : null;
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return undefined;
  const id = Object.fromEntries(Object.entries(parent).filter(([k, v]) => k !== path.at(-1) && typeof v === 'string' && v.length <= 40).slice(0, 3));
  return Object.keys(id).length ? id : undefined;
}

// ---- candidate generation (no oracle truth is used) ------------------------------------------------------------------
// Fields read downstream come first, then leaves with fewer alternatives (a boolean before a ten-way enum), then recorded order.
function rankLeaves(leaves, downstream) {
  const read = l => downstream.has('*') || downstream.has(String(l.path[0])) ? 0 : 1;
  return leaves.map((l, i) => ({ l, i })).sort((a, b) => read(a.l) - read(b.l) || a.l.domain.length - b.l.domain.length || a.i - b.i).map(x => x.l);
}

export function generateCandidates({ workflow, trial, journal, baseOutputs, siblingValues = {}, opts = {} }) {
  const o = { ...DEFAULTS, ...opts }, order = topoOrder(workflow), out = [];
  // Agent nodes: flip enum / boolean leaves of each accepted model value.
  const perNode = new Map();
  for (const row of acceptedCalls(journal, trial.runId)) {
    const node = resolveNode(workflow, row.nodeKey);
    if (!node || node.kind !== 'agent' || !node.returns) continue;
    const value = row.response?.value, inBody = row.nodeKey.split('/').length > 2, frame = topFrame(row.nodeKey);
    const downstream = downstreamFields(workflow, inBody ? frame : node.id);
    for (const leaf of rankLeaves(enumLeaves(node.returns, value).filter(l => !isIdentifier(value, l)), downstream)) for (const to of leaf.domain.filter(v => canonical(v) !== canonical(leaf.value))) {
      const list = perNode.get(`${frame}|${node.id}`) ?? []; perNode.set(`${frame}|${node.id}`, list);
      list.push({ type: 'inject', node: node.id, frame, nodeKey: row.nodeKey, rowId: row.id, path: leaf.path, from: leaf.value, to, inBody, value: setAt(value, leaf.path, to), alternatives: leaf.domain.length - 1, identity: identityOf(value, leaf.path) });
    }
    // Recorded alternatives: the same call in a sibling trial of the same task (a different sample of the same prompt).
    for (const alt of (siblingValues[row.nodeKey] ?? []).slice(0, o.capAlt)) if (canonical(alt) !== canonical(value)) {
      const list = perNode.get(`${frame}|${node.id}|alt`) ?? []; perNode.set(`${frame}|${node.id}|alt`, list);
      list.push({ type: 'recorded-alt', node: node.id, frame, nodeKey: row.nodeKey, rowId: row.id, path: [], from: null, to: null, inBody, value: alt, alternatives: 1 });
    }
  }
  for (const [key, list] of perNode) out.push(...list.slice(0, list[0].type === 'recorded-alt' ? o.capAlt : list[0].inBody ? o.capBodyAgent : o.capRootAgent));
  // Code nodes at the root: flip boolean leaves of the recorded output (a guard or a check verdict).
  for (const n of workflow.nodes) {
    if (!(n.kind === 'code' || (n.kind === 'verify' && n.method === 'code')) || !baseOutputs?.[n.id] || typeof baseOutputs[n.id] !== 'object') continue;
    for (const leaf of booleanLeaves(baseOutputs[n.id]).slice(0, o.capCode)) out.push({ type: 'pin', node: n.id, frame: n.id, nodeKey: `root/${n.id}`, path: leaf.path, from: leaf.value, to: !leaf.value, inBody: false, value: setAt(baseOutputs[n.id], leaf.path, !leaf.value), alternatives: 1 });
  }
  out.sort((a, b) => (order.get(a.frame) ?? 1e6) - (order.get(b.frame) ?? 1e6));
  return out.slice(0, o.maxCandidates).map((c, i) => ({ id: `c${i}`, ...c }));
}

// ---- running candidates ----------------------------------------------------------------------------------------------
async function pool(items, ctxs, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(ctxs.map(async ctx => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], ctx); } }));
  return results;
}

async function runCandidate(ctx, workflow, trial, cand, base, task) {
  let r;
  try {
    if (cand.type === 'pin') r = await replayRun(ctx, pinNode(workflow, cand.node, cand.value), trial, { task });
    else { injectRow(ctx.db, cand.rowId, cand.value); try { r = await replayRun(ctx, workflow, trial, { task }); } finally { uninject(ctx.db, cand.rowId); } }
  } catch (error) { return { id: cand.id, error: { code: error.code ?? 'CANDIDATE_ERROR', message: String(error.message).slice(0, 200) }, pass: false, score: 0, needsLive: false, ran: false }; }
  const miss = r.error?.code === 'REPLAY_MISS';
  return { id: cand.id, ran: true, pass: r.pass, score: r.score, status: r.status, verdict: r.verdict, errorCode: r.error?.code ?? null, calls: r.calls, needsLive: miss,
    missNode: miss ? r.error?.details?.nodeKey ?? null : null, changedShare: r.answer == null ? 1 : changedShare(base.answer, r.answer), ms: r.ms };
}

// ---- the localisation record -----------------------------------------------------------------------------------------
export async function localise({ trial, workflow, kit = null, concurrency = DEFAULTS.concurrency, opts = {}, only = null, trials = null, onProgress = null } = {}) {
  kit ??= await loadKit();
  const o = { ...DEFAULTS, ...opts }, started = Date.now();
  const ctxs = await Promise.all(Array.from({ length: Math.max(1, concurrency) }, (_, i) => openCtx(trial.source, { kit, name: `loc${i}` })));
  try {
    const task = await taskOf(trial);
    const base = await replayRun(ctxs[0], workflow, trial, { task });
    const fid = fidelity(trial, base);
    const head = { schema: LOCALISATION, trial: { key: trial.key, runId: trial.runId, family: trial.family, split: trial.split, difficulty: trial.difficulty, seed: trial.seed }, workflowHash: base.workflowHash,
      base: { pass: base.pass, score: base.score, verdict: base.verdict, status: base.status, calls: base.calls, fullUsd: base.fullUsd }, fidelity: fid };
    if (!fid.identical) return { ...head, blocked: 'REPLAY_INFIDELITY', candidates: [], suspects: [], root: null, ms: Date.now() - started };
    // Sibling trials of the same task and arm: other samples of the same prompt (generator 2).
    const pop = trials ?? allTrials();
    const siblings = pop.filter(t => t.source === trial.source && t.armId === trial.armId && t.taskKey === trial.taskKey && t.runId !== trial.runId);
    const siblingValues = {};
    for (const s of siblings) for (const row of acceptedCalls(ctxs[0].journal, s.runId)) (siblingValues[row.nodeKey] ??= []).push(row.response?.value);
    let cands = generateCandidates({ workflow, trial, journal: ctxs[0].journal, baseOutputs: base.outputs, siblingValues, opts: o });
    if (only) cands = cands.filter(only);
    const shared = Object.fromEntries(cands.filter(c => c.rowId).map(c => [c.id, sameKeyCount(ctxs[0].db, c.rowId)]));
    let done = 0;
    const results = await pool(cands, ctxs, async (c, ctx) => { const r = await runCandidate(ctx, workflow, trial, c, base, task); onProgress?.(++done, cands.length, c, r); return r; });
    const rows = cands.map((c, i) => ({ id: c.id, node: c.node, nodeKey: c.nodeKey, type: c.type, path: c.path.join('.'), pathArr: c.path, rowId: c.rowId, from: c.from, to: c.to, identity: c.identity, sharedKey: shared[c.id] > 1 ? shared[c.id] : undefined, ...results[i],
      deltaScore: +(results[i].score - base.score).toFixed(4), flips: base.pass ? !results[i].pass && results[i].ran && !results[i].needsLive : results[i].pass && !results[i].needsLive }));
    const intermediates = await scoreIntermediates(trial, task, base);
    return finish({ head, rows, workflow, base, intermediates, o, ms: Date.now() - started });
  } finally { for (const c of ctxs) c.close(); }
}

// Oracle on any node output that carries the answer's own keys (dev beds only): is the defect upstream of the answer?
async function scoreIntermediates(trial, task, base) {
  const answerKeys = base.answer && typeof base.answer === 'object' && !Array.isArray(base.answer) ? Object.keys(base.answer) : [];
  if (!answerKeys.length) return [];
  const out = [];
  for (const [id, value] of Object.entries(base.outputs ?? {})) {
    if (id === 'answer' || !value || typeof value !== 'object' || !answerKeys.every(k => Object.hasOwn(value, k))) continue;
    const v = await oracleOf(trial.family, task.task, Object.fromEntries(answerKeys.map(k => [k, value[k]])));
    out.push({ node: id, pass: !!v.pass, score: v.score });
  }
  return out;
}

// Rank flippers, pick the root, classify. Pure: tested on synthetic rows.
export function finish({ head, rows, workflow, base = {}, intermediates = [], o = DEFAULTS, ms = 0 }) {
  const order = topoOrder(workflow), basePass = head.base.pass;
  const flippers = rows.filter(r => r.ran !== false && !r.needsLive && (basePass ? false : r.pass));
  const fragile = rows.filter(r => r.ran !== false && !r.needsLive && basePass && r.changedShare >= o.fragileShare);
  const live = rows.filter(r => r.needsLive && !basePass && r.verdict !== 'pass').length;
  const key = r => r.nodeKey.split('/')[1]?.replace(/:\d+$/, '') ?? r.node;
  const pool = basePass ? fragile : flippers;
  const frames = [...new Set(pool.map(key))].sort((a, b) => (order.get(a) ?? 1e6) - (order.get(b) ?? 1e6));
  const suspects = frames.map(frame => {
    const mine = pool.filter(r => key(r) === frame), first = mine.find(r => r.type !== 'recorded-alt') ?? mine[0], node = workflow.nodes.find(n => n.id === frame);
    return { node: frame, kind: node?.kind ?? null, locus: locusOf(workflow, frame), evidence: mine.map(r => r.id), flips: mine.map(r => ({ id: r.id, node: r.node, nodeKey: r.nodeKey, path: r.path, from: r.from, to: r.to, identity: r.identity, deltaScore: r.deltaScore, changedShare: r.changedShare, type: r.type })),
      sample: { id: first.id, type: first.type, node: first.node, nodeKey: first.nodeKey, path: first.path, pathArr: first.pathArr, rowId: first.rowId, from: first.from, to: first.to, identity: first.identity } };
  });
  let confidence = 'none';
  if (suspects.length === 1) confidence = 'high';
  else if (suspects.length > 1) { const root = suspects[0].node; confidence = suspects.slice(1).every(s => ancestorsOf(workflow, s.node).has(root)) ? 'medium' : 'low'; }
  const root = suspects[0] ?? null;
  const classes = root ? defectClasses({ root, rows, workflow, head, basePass, intermediates }) : [];
  // Offline variance evidence: the same call, other recorded samples of the same prompt. Decisive only with 4+ samples (the live test uses 8).
  const alts = root ? rows.filter(r => r.type === 'recorded-alt' && r.ran !== false && !r.needsLive && r.node === root.sample.node) : [];
  const variance = alts.length ? { source: 'recorded', n: alts.length, hits: alts.filter(r => r.pass).length, wilsonLower: +wilsonLower(alts.filter(r => r.pass).length, alts.length).toFixed(4), tau: o.tau, decisive: alts.length >= 4 } : null;
  return { ...head, candidates: rows, intermediates, flippers: pool.map(r => r.id), suspects, root: root ? { node: root.node, confidence, locus: root.locus, sample: root.sample, flips: root.flips.length } : null,
    classes, variance, needsLive: live, coverage: { candidates: rows.length, ran: rows.filter(r => r.ran !== false).length, needsLive: rows.filter(r => r.needsLive).length },
    mode: basePass ? 'latent' : 'failure', ms,
    ...(!root && !basePass ? { unknown: true, note: live ? `${live} candidates need a live escalation (rerun with --live)` : 'no single-node substitution turns the failure into a pass' } : {}) };
}

// Defect classes (DESIGN §6.6): rules over the localisation record and the workflow structure.
export function defectClasses({ root, rows, workflow, head, basePass, intermediates = [] }) {
  const node = workflow.nodes.find(n => n.id === root.node), out = [], sample = rows.find(r => r.id === root.sample.id);
  const routed = workflow.nodes.filter(n => n.when && refsIn(n.when).some(r => nodeRef(r)?.id === root.node)).map(n => n.id);
  if (node && (node.kind === 'code' || node.kind === 'verify')) {
    if (root.sample.type === 'pin' && root.sample.from === false && root.sample.to === true) {
      out.push({ code: 'OVERSTRICT_CHECK', node: root.node, locus: root.locus, evidence: root.flips.map(f => f.id), routedTo: routed });
      if (routed.length) out.push({ code: 'CHECK_VETO_ROUTING', node: root.node, routedTo: routed });
    } else out.push({ code: 'CODE_NODE_SENSITIVE', node: root.node, evidence: root.flips.map(f => f.id) });
    const upstream = intermediates.filter(i => i.pass).map(i => i.node);
    if (upstream.length && !basePass) out[0].intermediatesPassing = upstream;
  } else if (node?.kind === 'agent') {
    const hasChecks = (node.checks ?? []).length > 0;
    // The flipped value was accepted by the node's own checks (no live escalation needed): nothing guards that field.
    out.push({ code: hasChecks ? 'CHECK_ESCAPE_HATCH' : 'UNGUARDED_GLOBAL_READ', node: root.node, field: root.sample.path, locus: root.locus, evidence: root.flips.map(f => f.id), guardedFields: [] });
  } else if (node?.kind === 'map') {
    const body = node.body.nodes.find(b => b.id === sample?.node);
    out.push({ code: (body?.checks ?? []).length ? 'CHECK_ESCAPE_HATCH' : 'UNGUARDED_ITEM_READ', node: root.node, bodyNode: body?.id ?? null, field: root.sample.path, evidence: root.flips.map(f => f.id) });
  }
  return out;
}

// ---- model variance (needs a provider; live): resample the root node at the same prompt (DESIGN §5 step 6) ---------------
export const wilsonLower = (hits, n, z = 1.96) => { if (!n) return 0; const p = hits / n, d = 1 + z * z / n; return Math.max(0, (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d); };

// K fresh samples of one recorded model call (same system, prompt, schema, decoding), through a journaled port (`port` must have a live
// provider and its own journal: the spend must be durable). `journal` is the recorded journal, read for the call's request. A hit is a
// sample that carries the counterfactual-passing value at the localised path.
export async function varianceTest({ journal, port, workflow, trial, rowId, path, passingValue, k = 8, tau = DEFAULTS.tau }) {
  const row = journal.get(rowId), node = resolveNode(workflow, row.nodeKey);
  let hits = 0, cost = 0, errors = 0;
  for (let i = 1; i <= k; i++) {
    const r = await port.call({ runId: `heal-resample:${trial.runId}`, nodeKey: row.nodeKey, attempt: 0, sampleIndex: i, modelId: row.modelId, system: row.request.system, prompt: row.request.prompt,
      schema: row.request.schema, decoding: node?.decoding ?? {}, mode: 'live', salt: `heal-variance:${rowId}` });
    cost += r.costUsd ?? 0;
    if (!r.ok) { errors++; continue; }
    if (canonical(getAt(r.value, path)) === canonical(passingValue)) hits++;
  }
  const lower = wilsonLower(hits, k - errors);
  return { k, errors, hits, rate: k - errors ? hits / (k - errors) : 0, wilsonLower: +lower.toFixed(4), tau, class: lower > tau ? 'model-variance' : 'workflow-defect', costUsd: cost };
}
