// The healer's checks, in ROADMAP §2.6 order, run against the frozen runtime (JUDGE-PROGRAM.md §1.2 F1 "Labels"):
//   1. replay: the failed node is run again with the same inputs (a model node replays its journaled responses);
//      it passes -> flake
//   2. resample K = 8 at the same upstream state (only when the node or an ancestor calls a model): a Wilson lower
//      bound on the flip rate above tau -> variance
//   3. environment fingerprint, scoped to the node's declared dependencies: it differs from the last passing run's
//      -> env
//   4. control run on the previous build of the system under test: it passes -> finding
//   5. known-good contract check: the deployed contract (assert checks, agent output checks, code result schemas,
//      acceptance) evaluated on the outputs of a reference run of the repaired workflow in a healthy world; a check
//      that is violated (not one that cannot be evaluated) -> impossible
//   6. otherwise -> defect
// The outcome of the first check that fires is the label. Nothing here sees the injected cause.
import { wilsonLower } from './util.mjs';
import { World } from './world.mjs';
import { buildWorkflow } from './workflow.mjs';

export const RESAMPLE_K = 8;
export const TAU = 0.05;

export const dependsOnModel = (wf, rt, targetNode) => {
  const byId = new Map(wf.nodes.map(n => [n.id, n]));
  const seen = new Set(), stack = [targetNode];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (rt.validate.usesModel(n)) return true;
    if (n.kind === 'map' && n.body.nodes.some(b => rt.validate.usesModel(b))) return true;
    stack.push(...n.needs);
  }
  return false;
};

// the deployed contract of a workflow: what an independent reader can check about a node's result
export function contractOf(wf) {
  const items = [];
  for (const n of wf.nodes) {
    if (n.kind === 'assert') for (const cond of n.checks) items.push({ type: 'condition', cond, node: n.id });
    if (n.kind === 'agent' && n.checks) for (const cond of n.checks) items.push({ type: 'output', cond, node: n.id });
    if (n.kind === 'code' && n.returns) items.push({ type: 'schema', schema: n.returns, node: n.id });
  }
  for (const cond of wf.acceptance) items.push({ type: 'condition', cond, node: '(acceptance)' });
  return items;
}

// 'satisfied' | 'violated' | 'error' (the check could not be evaluated: a type error is not an unsatisfiable contract)
export function evaluateContract(rt, items, ctx) {
  let result = 'satisfied';
  const detail = [];
  for (const it of items) {
    try {
      if (it.type === 'condition') { if (!rt.data.condition(it.cond, ctx)) { result = 'violated'; detail.push(it.node); } }
      else if (it.type === 'output') {
        const bound = rt.validate.bindOutput(it.cond);
        if (!rt.data.condition(bound, { ...ctx, nodes: { ...ctx.nodes, [rt.validate.OUTPUT_KEY]: ctx.nodes[it.node] } })) { result = 'violated'; detail.push(it.node); }
      } else if (it.type === 'schema') {
        try { rt.validate.validateData(it.schema, ctx.nodes[it.node], `${it.node} result`); } catch (e) { if (e.code === 'SCHEMA_MISMATCH') { result = 'violated'; detail.push(it.node); } else throw e; }
      }
    } catch (e) { if (result !== 'violated') result = 'error'; detail.push(`${it.node}:${e.code ?? 'ERROR'}`); }
  }
  return { result, detail };
}

// `ctxs`: { world, rb, plan, wf, wfId, input, target, execute, makeReference }
export async function diagnose(ctxs) {
  const { world, rb, plan, wf, wfId, input, target, execute, makeReference, rt } = ctxs;
  const checks = { reached: [] };
  const passes = s => s && target.outcome(s) === 'pass';

  // 1. replay
  checks.reached.push('replay');
  const replay = await execute(world, wfId, input, { salt: ctxs.failSalt, mode: 'replay-or-live', kind: 'replay' });
  checks.replay = { passed: passes(replay) };
  if (checks.replay.passed) return { label: 'flake', checks };

  // 2. resample
  if (dependsOnModel(wf, rt, target.rootNode)) {
    checks.reached.push('resample');
    let flips = 0;
    for (let k = 0; k < RESAMPLE_K; k++) {
      const s = await execute(world, wfId, input, { salt: `resample${k}`, mode: 'live', kind: 'resample' });
      if (passes(s)) flips++;
    }
    const lower = wilsonLower(flips, RESAMPLE_K);
    checks.resample = { k: RESAMPLE_K, flips, wilsonLower: Math.round(lower * 1e4) / 1e4, tau: TAU };
    if (lower > TAU) return { label: 'variance', checks };
  }

  // 3. environment fingerprint (node-scoped, against the last passing run)
  checks.reached.push('fingerprint');
  if (ctxs.lastPassFp) {
    const scope = plan.knobs.scopeGap ? [] : world.scope;
    const base = Object.fromEntries(Object.entries(ctxs.lastPassFp).filter(([k]) => scope.includes(k)));
    const now = world.fingerprint({ scope });
    const diff = World.diff(base, now);
    checks.fingerprint = { baseline: true, diff };
    if (diff.length) return { label: 'env', checks };
  } else checks.fingerprint = { baseline: false, diff: [] };

  // 4. control run on the previous build
  checks.reached.push('control');
  world.useBuild('N-1');
  const control = await execute(world, wfId, input, { salt: 'control', mode: 'live', kind: 'control' });
  world.useBuild('N');
  checks.control = { passed: passes(control) };
  if (checks.control.passed) return { label: 'finding', checks };

  // 5. known-good contract check
  checks.reached.push('knownGood');
  const ref = await makeReference();
  const verdict = evaluateContract(rt, contractOf(wf), ref.ctx);
  checks.knownGood = { result: verdict.result, where: verdict.detail };
  if (verdict.result === 'violated') return { label: 'impossible', checks };

  // 6. otherwise
  return { label: 'defect', checks };
}

export { buildWorkflow };
