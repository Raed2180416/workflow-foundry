// Runs one planned scenario end to end under the frozen runtime and returns what the healer's checks decided.
//   1. earlier runs of the same workflow (the journal the failure is judged against): each passes or fails as the plan's
//      prior pattern says; a passing run leaves its environment fingerprint behind
//   2. the failing run, with a fingerprint taken just before it starts (the pre-failure environment diff)
//   3. the failure itself: the node that stopped the run, its attempts, its error code and message, the last events
//   4. routing by code: model-output and budget failures are decided before F1 is asked and return no label
//   5. the healer's checks (exec/healer.mjs): the first that fires is the label; the injected cause is only compared
//      afterwards (`agree`)
import { mkErr, RECIPES } from './recipes.mjs';
import { diagnose } from './healer.mjs';
import { makeRnd } from './util.mjs';
import { World } from './world.mjs';
import { buildWorkflow } from './workflow.mjs';

import { BUDGET_CODES, MODEL_OUTPUT_CODES, routeByCode } from '../judges/failures.mjs';
export { BUDGET_CODES, MODEL_OUTPUT_CODES, routeByCode };

// facet kinds a pre-failure environment capture can read (directory permissions and free space are only seen by the healer)
export const INFRA_CODES = Object.freeze(['CODE_TIMEOUT', 'SANDBOX_UNAVAILABLE', 'CANCELLED', 'DEADLINE', 'TOOL_TIMEOUT']);
export const PRE_KINDS = Object.freeze(['module', 'credential', 'service', 'tool']);

export function planP(plan) {
  return { rnd: makeRnd(`${plan.key}|recipe`), A: plan.A, svc: plan.svc, gateway: plan.gateway, module: plan.module, dir: plan.dir, credential: plan.credential,
    labels: plan.labels, truth: plan.truth, instruction: plan.instruction, pFail: plan.pFail, ids: plan.ids, payload: plan.payload, knobs: plan.knobs, sut: plan.sut, env: plan.env };
}

// ---- runs ---------------------------------------------------------------------------------------------------------------
function flatten(ins) {
  const nodes = {};
  for (const [id, n] of Object.entries(ins.nodes ?? {})) nodes[`root/${id}`] = n;
  for (const [fk, f] of Object.entries(ins.frames ?? {})) for (const [id, n] of Object.entries(f.nodes ?? {})) nodes[`${fk}/${id}`] = n;
  return nodes;
}
const outputs = ins => {
  const out = {};
  for (const [id, v] of Object.entries(ins.outputs ?? {})) out[id] = v;
  return out;
};
export async function execute(world, wfId, input, { salt, mode = 'live', kind }) {
  world.beginRun(kind);
  const run = world.foundry.createRun(wfId, input, { sampleSalt: salt, modelMode: mode });
  await world.foundry.startRun(run.id);
  const ins = world.foundry.inspectRun(run.id);
  world.logRun({ id: run.id, kind, mode, salt, status: ins.status });
  // a sandbox that timed out or could not start is the host's fault, never an injected cause: the scenario is retried
  if (INFRA_CODES.includes(ins.error?.code)) throw Object.assign(new Error(`infrastructure fault (${ins.error.code}) during a ${kind} run`), { code: 'EXEC_INFRA' });
  return { id: run.id, status: ins.status, error: ins.error ?? null, nodes: flatten(ins), outputs: ins.outputs ?? {}, events: ins.events };
}

// the failed node of a run: the first node whose status is failed, in event order; a run that failed only at acceptance
// has the workflow itself as its failing "node"
export function failedNode(sum) {
  const ev = sum.events.find(e => e.type === 'node.failed');
  if (ev) { const n = sum.nodes[ev.nodeKey]; if (n) return { key: ev.nodeKey, ...n }; }
  const key = Object.keys(sum.nodes).find(k => sum.nodes[k].status === 'failed');
  if (key) return { key, ...sum.nodes[key] };
  if (sum.status === 'failed' && sum.error?.code === 'ACCEPTANCE_FAILED') return { key: 'root', kind: 'workflow', status: 'failed', attempts: 1, error: sum.error };
  return null;
}
const outcomeIn = (sum, key) => {
  if (key === 'root') return sum.status === 'succeeded' ? 'pass' : 'fail';
  const n = sum.nodes[key];
  return n?.status === 'completed' ? 'pass' : n?.status === 'failed' ? 'fail' : 'none';
};

// the last journal events before (and including) the failure, as a healer reads them
const KEEP = new Set(['tool.intent', 'tool.failed', 'node.started', 'node.completed', 'node.failed', 'node.skipped', 'context.compiled', 'model.called', 'model.retry',
  'model.resampled', 'model.escalated', 'verify.failed', 'oracle.dispatched', 'map.item.completed']);
export function eventsOf(sum, upto = 5) {
  const out = [];
  for (const e of sum.events) {
    if (!KEEP.has(e.type)) continue;
    const key = e.nodeKey ?? '';
    const node = key ? key.split('/').pop() : null;
    const n = sum.nodes[key];
    out.push({ type: e.type, node, kind: n?.kind ?? e.kind ?? null, code: e.error?.code ?? e.errorCode ?? null });
  }
  return out.slice(-upto);
}

// ---- the scenario ---------------------------------------------------------------------------------------------------------
// opts: { reference: true } also returns the reference-run summary (tests)
export async function runScenario(rt, plan) {
  const recipe = RECIPES[plan.recipe], rb = recipe.build(planP(plan));
  const world = await new World(plan, rt, rb).open();
  const out = { key: plan.key, cause: plan.cause, recipe: plan.recipe, shapeId: plan.shapeId, shape: plan.shapeStr, stats: { runs: 0 } };
  try {
    const wf = buildWorkflow(plan, rb, { fixed: false });
    world.foundry.save(wf);
    const input = { rows: plan.payload.rows, total: plan.payload.rows.reduce((s, r) => s + r.amount, 0), source: plan.payload.source };
    const stochastic = rb.fault.type === 'stochastic';
    const runs = [];                                    // earlier runs: { ok, code }
    let lastPassFp = null;
    const targetKey = recipe.targetRoot ? 'root' : plan.shape.wrap === 'map' ? `root/${plan.ids.map}:0/${plan.ids.core}` : `root/${plan.ids.core}`;
    // earlier runs of the node
    for (let i = 0; i < plan.prior.pattern.length; i++) {
      const wantPass = plan.prior.pattern[i] === 'P';
      if (stochastic) world.force(wantPass ? 'pass' : 'fail'); else world.setPhase(wantPass ? 'healthy' : 'faulty');
      const sum = await execute(world, plan.workflowId, input, { salt: `prior${i}`, kind: 'prior' });
      out.stats.runs++;
      const oc = outcomeIn(sum, targetKey);
      if (oc === 'pass') { runs.push({ ok: true, code: null }); lastPassFp = world.fingerprint(); }
      else if (oc === 'fail') runs.push({ ok: false, code: (sum.nodes[targetKey]?.error ?? sum.error)?.code ?? 'ERROR' });
      world.force(null);
    }
    // an unrelated environment change (a bystander facet) happens in some scenarios of every cause but env
    if (plan.knobs.bystanderChange) flipBystander(world, plan);
    // the pre-failure capture: before the break when the break is late, after it otherwise
    if (stochastic) world.force('fail');
    const lateBreak = plan.knobs.lateBreak && PRE_KINDS.includes(String(rb.scope[0] ?? '').split(' ')[0]);
    let pre;
    if (lateBreak) { pre = world.fingerprint({ kinds: PRE_KINDS }); world.setPhase('faulty'); }
    else { world.setPhase('faulty'); pre = world.fingerprint({ kinds: PRE_KINDS }); }
    const failSalt = 'fail';
    const failing = await execute(world, plan.workflowId, input, { salt: failSalt, kind: 'failing' });
    out.stats.runs++;
    world.force(null);
    const node = failedNode(failing);
    if (!node) { out.invalid = 'no-failure'; out.status = failing.status; return out; }
    if (plan.cause !== 'routed' && node.key !== targetKey && !(recipe.targetRoot && node.key === 'root')) { out.invalid = `unexpected-failure-node:${node.key}`; out.failure = { node: node.key, code: node.error?.code }; return out; }
    const code = node.error?.code ?? failing.error?.code ?? 'ERROR';
    out.audit = { runs: [...world.runLog] };                               // every run in creation order, with its kind
    out.failure = { node: { kind: node.kind, attempts: node.attempts ?? 0, error: { code, message: world.clean(node.error?.message ?? failing.error?.message ?? '') } }, events: eventsOf(failing),
      priorRuns: runs, envDiff: lastPassFp ? World.diff(Object.fromEntries(Object.entries(lastPassFp).filter(([k]) => PRE_KINDS.includes(k.split(' ')[0]))), pre) : [] };
    const route = routeByCode(code);
    if (route) { out.routed = route; return out; }
    // the healer's checks
    const target = { key: targetKey, rootNode: recipe.targetRoot ? plan.ids.up.at(-1) ?? plan.ids.core : plan.shape.wrap === 'map' ? plan.ids.map : plan.ids.core, outcome: s => outcomeIn(s, targetKey) };
    const diag = await diagnose({
      world, rb, plan, wf, wfId: plan.workflowId, input, target, execute, rt, lastPassFp, failSalt,
      makeReference: () => reference(rt, plan, rb, input),
    });
    out.label = diag.label; out.checks = diag.checks; out.agree = diag.label === plan.cause;
    return out;
  } finally { await world.close(); }
}

// A reference run: the repaired workflow in a healthy world with the previous build and a truthful model. Its node
// outputs are the "known-good example" the deployed contract is checked against.
async function reference(rt, plan, rb, input) {
  const refRb = { ...rb, fault: { type: 'none' }, models: [] };
  const w = await new World({ ...plan, key: `${plan.key}|ref` }, rt, refRb).open();
  try {
    w.useBuild('N-1');
    const wf = buildWorkflow(plan, rb, { fixed: true });
    wf.id = `ref-${wf.id}`;
    w.foundry.save(wf);
    const sum = await execute(w, wf.id, input, { salt: 'reference', kind: 'reference' });
    if (sum.status !== 'succeeded') throw Object.assign(new Error(`reference run did not succeed: ${sum.status} ${JSON.stringify(sum.error)}`), { code: 'REFERENCE_FAILED' });
    return { ctx: { input, nodes: sum.outputs }, summary: sum };
  } finally { await w.close(); }
}

function flipBystander(world, plan) {
  const vis = plan.env.bystanders.filter(([k]) => PRE_KINDS.includes(k));
  if (!vis.length) return;
  const [kind, name] = vis[0], was = world.facets[kind][name];
  world.facets[kind][name] = ({ up: 'down', present: 'missing', set: 'unset' })[was] ?? was;
}

export { mkErr };
