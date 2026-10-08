// Assembles the tiny Foundry workflow of one scenario (JSON IR, schemas/workflow.schema.json at the frozen commit):
// a chain of healthy upstream stages, the core node a recipe injects its cause into, an optional map wrapper, and
// unobserved downstream sinks. The shape of a workflow (what a state can show of it) is the upstream stage kinds,
// the core's kind and the wrapper; the downstream sinks never run in a failing run, so they are not part of it.
import { sha } from './util.mjs';

export const STAGE_TYPES = Object.freeze(['load', 'ident', 'agg', 'pluck', 'tmpl', 'agent', 'gate', 'json']);
// the label a stage shows in the shape string (node kind and, for a task, the tool)
export const STAGE_LABEL = Object.freeze({
  load: 'task:load', ident: 'task:identity', agg: 'task:aggregate', pluck: 'task:pluck', tmpl: 'task:template', json: 'task:json',
  agent: 'agent', gate: 'assert', sut: 'task:sut', 'agent-stochastic': 'agent',
});
const PAYLOAD_STAGES = new Set(['load', 'ident']);

export const R = (path) => ({ $ref: path });
const task = (id, needs, description, tool, args, extra = {}) => ({ id, kind: 'task', needs, description, tool, args, timeoutMs: 3000, retry: { maxAttempts: 1, backoffMs: 0 }, ...extra });

// One upstream stage -> its node. `P` is the payload reference ('input' or 'nodes.<id>').
export function stageNode(stage, id, needs, P, plan) {
  const src = plan.payload.source;
  switch (stage.t) {
    case 'load': return task(id, needs, `Load the ${src} rows`, 'fx.load', { source: src, count: plan.payload.rows.length });
    case 'ident': return task(id, needs, 'Pass the rows through unchanged', 'core.identity', { rows: R(`${P}.rows`), total: R(`${P}.total`), source: R(`${P}.source`) });
    case 'agg': return task(id, needs, 'Sum the amount column', 'core.aggregate', { operation: 'sum', values: R(`${P}.rows`), field: 'amount' });
    case 'pluck': return task(id, needs, 'Collect the amounts', 'core.pluck', { items: R(`${P}.rows`), field: 'amount' });
    case 'tmpl': return task(id, needs, 'Render a one-line summary', 'core.template', { text: 'Batch {{src}} holds {{total}} units', variables: { src: R(`${P}.source`), total: R(`${P}.total`) } });
    case 'json': return task(id, needs, 'Serialise the rows', 'core.json', { value: R(`${P}.rows`) });
    case 'agent': case 'agent-stochastic': return agentNode(id, needs, P, plan.agentLabels, null);
    case 'gate': return { id, kind: 'assert', needs, description: 'The total must not be negative', checks: [{ op: 'gte', left: R(`${P}.total`), right: 0 }] };
    case 'sut': return task(id, needs, `Call the system under test: ${plan.sut.op}`, 'fx.sut', { op: plan.sut.op, args: plan.sut.args });
    default: throw new Error(`unknown stage ${stage.t}`);
  }
}
export function agentNode(id, needs, P, labels, checks) {
  return { id, kind: 'agent', needs, description: 'Choose a label for the batch', role: 'classify', instructions: 'Choose the one label that fits the batch best. Return only the label.',
    returns: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { enum: labels } } }, model: { class: 'M' },
    context: { inputs: [{ name: 'rows', ref: `${P}.rows` }], history: 'none' }, escalation: { schemaRetries: 0, onCheckFail: 'fail' }, ...(checks?.length ? { checks } : {}) };
}

// The shape (observable structure) of a plan: upstream stage labels, the fork flag, the core label and the wrapper.
export function shapeString(shape) {
  const up = shape.up.map(s => STAGE_LABEL[s.t]);
  return `${up.join('>')}${shape.fork ? '/fork' : ''}>[${shape.coreLabel}]${shape.wrap === 'map' ? '^map' : ''}`;
}
export const shapeId = shape => `sha256:${sha(shapeString(shape))}`;

// Build the workflow for a plan and its recipe build. `fixed` builds the reference variant (the defect repaired and
// the contract as intended); it is the "known-good" workflow of the healer's contract check.
export function buildWorkflow(plan, rb, { fixed = false } = {}) {
  const { ids, shape } = plan, nodes = [], up = shape.up, n = up.length, fork = shape.fork && n >= 2;
  const needsOf = i => (fork && i === n - 1 ? (i - 2 >= 0 ? [ids.up[i - 2]] : []) : i === 0 ? [] : [ids.up[i - 1]]);
  let P = 'input';
  const before = [];                                    // the payload reference each stage can see
  up.forEach((stage, i) => {
    before.push(P);
    // a fork's second sibling sees what its sibling saw (it does not need it)
    nodes.push(stageNode(stage, ids.up[i], needsOf(i), fork && i === n - 1 ? before[n - 2] : P, plan));
    if (PAYLOAD_STAGES.has(stage.t)) P = `nodes.${ids.up[i]}`;
  });
  const coreNeeds = n === 0 ? [] : fork ? [ids.up[n - 2], ids.up[n - 1]] : [ids.up[n - 1]];
  const c = { id: ids.core, needs: coreNeeds, P, plan, fixed, inMap: shape.wrap === 'map', itemRef: 'item', upIds: ids.up };
  let tail;
  if (shape.wrap === 'map') {
    const body = rb.core({ ...c, needs: [] });
    nodes.push({ id: ids.map, kind: 'map', needs: coreNeeds, description: 'Run the step once per row', items: R(`${P}.rows`), maxItems: 20, concurrency: 1, failure: 'fail_fast',
      body: { nodes: body, acceptance: [{ op: 'exists', value: R(`nodes.${body.at(-1).id}`) }] } });
    tail = ids.map;
  } else {
    const core = rb.core(c);
    nodes.push(...core);
    tail = core.at(-1).id;
  }
  shape.down.forEach((t, i) => {
    const id = ids.down[i], needs = [i === 0 ? tail : ids.down[i - 1]];
    nodes.push(t === 'json' ? task(id, needs, 'Serialise the input rows', 'core.json', { value: R('input.rows') })
      : { id, kind: 'assert', needs, description: 'The input must hold rows', checks: [{ op: 'exists', value: R('input.rows') }] });
  });
  const last = nodes.at(-1).id;
  const acceptance = fixed ? (rb.intendedAcceptance?.(c) ?? [{ op: 'exists', value: R(`nodes.${last}`) }]) : (rb.acceptance?.(c) ?? [{ op: 'exists', value: R(`nodes.${last}`) }]);
  return {
    schemaVersion: '1.0', id: plan.workflowId, version: 1, title: plan.title, goal: `Process the ${plan.payload.source} batch and report on it.`, domain: 'kev-data-exec',
    envelope: { assumptions: [`the ${plan.payload.source} source is reachable`], risks: [], successCriteria: ['every step completes and the acceptance checks hold'] },
    inputSchema: { type: 'object' }, budget: { maxSteps: rb.budget?.maxSteps ?? 300, maxConcurrency: 2, maxDurationMs: 120000 }, nodes, acceptance,
  };
}
