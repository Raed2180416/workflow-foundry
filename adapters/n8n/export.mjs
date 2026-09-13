import { readFileSync } from 'node:fs';
import { portableHelpers } from './portable.mjs';

// The exported Code nodes perform JSON operations only. Capability execution is
// an explicit n8n Execute Sub-workflow binding, never eval or an HTTP call here.
function runStage(stage, configuration, h) {
  const entries = $input.all();
  if (entries.length !== 1) h.fail('ITEM_CARDINALITY', 'Exactly one data item is required');
  const received = h.data(entries[0].json);
  const node = configuration.node;
  function guard(state, charge = false) {
    if (state.workflowHash !== configuration.workflowHash) h.fail('WORKFLOW_DRIFT', 'Workflow identity changed');
    if (Date.now() >= state.deadline) h.fail('DEADLINE', 'Run deadline exhausted');
    if (charge && state.steps >= configuration.budget.maxSteps) h.fail('STEP_BUDGET', 'Run step budget exhausted');
  }
  const context = state => ({ input: state.input, nodes: state.outputs });
  const item = state => [{ json: h.data({ state }) }];
  if (stage === 'initialize') {
    if (configuration.missingBindings.length) h.fail('UNBOUND_CAPABILITIES', 'Supply trusted bindings before running this export');
    if (!received || Array.isArray(received) || typeof received !== 'object' || !Object.hasOwn(received, 'input') || Object.keys(received).some(k => k !== 'input')) h.fail('INPUT_ENVELOPE', 'Pass exactly one object containing input');
    if (configuration.inputSchema) h.validate(configuration.inputSchema, received.input);
    return item({ input: received.input, outputs: {}, statuses: {}, steps: 0, cost: 0,
      workflowHash: configuration.workflowHash, runId: String($execution.id),
      deadline: Date.now() + configuration.budget.maxDurationMs, status: 'running' });
  }
  if (stage === 'commit') {
    // The callee cannot rewrite the parent state. Recover it from the preceding
    // trusted prepare node, and accept only its correlated, typed output.
    const prepared = h.copy($(configuration.prepareName).first().json);
    const state = prepared.state, request = prepared.request;
    guard(state);
    if (Date.now() >= request.deadline) h.fail('TOOL_TIMEOUT', 'Sub-workflow returned after its deadline');
    if (received.ok !== true || received.operationKey !== request.operationKey || !Object.hasOwn(received, 'output') || received.cost !== 0) h.fail('BINDING_RESULT', 'Invalid, failed or uncorrelated capability result');
    h.data(received.output, 512 * 1024);
    h.validate(configuration.binding.outputSchema, received.output);
    state.outputs[node.id] = received.output;
    state.statuses[node.id] = 'completed';
    return item(state);
  }
  const state = h.copy(received.state);
  guard(state);
  if (stage === 'accept') {
    if (!configuration.nodeIds.every(id => ['completed', 'skipped'].includes(state.statuses[id]))) h.fail('DEPENDENCY', 'Not all nodes resolved');
    if (!configuration.acceptance.every(check => h.condition(check, context(state)))) h.fail('ACCEPTANCE_FAILED', 'Workflow acceptance failed');
    guard(state);
    state.status = 'succeeded';
    return item(state);
  }
  if (!node.needs.every(id => ['completed', 'skipped'].includes(state.statuses[id]))) h.fail('DEPENDENCY', 'A dependency is incomplete');
  const blocked = (node.join ?? 'all_success') === 'all_success' && node.needs.some(id => state.statuses[id] !== 'completed');
  if (blocked || (node.when && !h.condition(node.when, context(state)))) {
    state.statuses[node.id] = 'skipped';
    return [{ json: h.data({ state, dispatch: false }) }];
  }
  guard(state, true);
  if (stage === 'assert') {
    state.steps++;
    if (!node.checks.every(check => h.condition(check, context(state)))) h.fail('ASSERTION_FAILED', 'Workflow assertion failed');
    state.outputs[node.id] = { passed: true };
    state.statuses[node.id] = 'completed';
    return item(state);
  }
  const binding = configuration.binding;
  if (!binding) h.fail('UNBOUND_CAPABILITIES', 'Capability binding is missing');
  const args = h.resolve(node.args, context(state));
  h.validate(binding.inputSchema, args);
  state.steps++;
  state.statuses[node.id] = 'running';
  const deadline = Math.min(state.deadline, Date.now() + node.timeoutMs);
  return [{ json: h.data({ state, dispatch: true, request: {
    tool: node.tool, args, workflowHash: state.workflowHash, runId: state.runId,
    nodeId: node.id, operationKey: `${state.workflowHash}:${state.runId}:${node.id}`,
    deadline, timeoutMs: Math.max(1, deadline - Date.now()), maxCost: 0
  } }) }];
}

export function n8nFiles(specification) {
  const { workflow, workflowHash, order, bindings, missingBindings } = specification;
  const nodes = [], connections = {};
  let x = 0;
  function add(type, version, name, parameters, extra = {}) {
    nodes.push({ id: `foundry-${nodes.length}`, name, type, typeVersion: version,
      position: [x, 0], parameters, ...extra });
    x += 240;
    return name;
  }
  function edge(from, to, port = 0) {
    connections[from] ??= { main: [] };
    while (connections[from].main.length <= port) connections[from].main.push([]);
    connections[from].main[port].push({ node: to, type: 'main', index: 0 });
  }
  function code(name, stage, configuration = {}) {
    const config = { workflowHash, budget: workflow.budget, ...configuration };
    const source = `const h = (${portableHelpers.toString()})();\nconst configuration = JSON.parse(${JSON.stringify(JSON.stringify(config))});\nreturn (${runStage.toString()})(${JSON.stringify(stage)}, configuration, h);`;
    return add('n8n-nodes-base.code', 2, name,
      { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: source });
  }
  const start = add('n8n-nodes-base.executeWorkflowTrigger', 1.1, 'Foundry Input', { inputSource: 'passthrough' });
  const initial = { missingBindings };
  if (workflow.inputSchema) initial.inputSchema = workflow.inputSchema;
  let previous = code('Foundry Initialize', 'initialize', initial);
  edge(start, previous);
  for (let index = 0; index < order.length; index++) {
    const node = workflow.nodes.find(n => n.id === order[index]);
    if (node.kind === 'assert') {
      const assertion = code(`Foundry Assert ${index}`, 'assert', { node });
      edge(previous, assertion); previous = assertion; continue;
    }
    const binding = bindings[node.tool] ?? null;
    const prepareName = code(`Foundry Prepare ${index}`, 'prepare', { node, binding });
    edge(previous, prepareName);
    const branch = add('n8n-nodes-base.if', 2.2, `Foundry Dispatch ${index}`, {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: `dispatch-${index}`, leftValue: '={{ $json.dispatch }}', rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {}
    });
    edge(prepareName, branch);
    const execute = add('n8n-nodes-base.executeWorkflow', 1.3, `Foundry Capability ${index}`, {
      source: 'database', workflowId: { __rl: true, value: binding?.workflowId ?? `FOUNDRY_BINDING_REQUIRED_${index}`, mode: 'id' },
      mode: 'once', options: { waitForSubWorkflow: true }
    }, { retryOnFail: false, continueOnFail: false, alwaysOutputData: true });
    edge(branch, execute, 0);
    const commit = code(`Foundry Commit ${index}`, 'commit', { node, binding, prepareName });
    edge(execute, commit);
    // Both incoming paths are mutually exclusive. No parallel join is implied.
    const join = add('n8n-nodes-base.noOp', 1, `Foundry Continue ${index}`, {});
    edge(branch, join, 1); edge(commit, join);
    previous = join;
  }
  const acceptance = code('Foundry Acceptance', 'accept', { acceptance: workflow.acceptance, nodeIds: order });
  edge(previous, acceptance);
  const exported = { name: workflow.title, active: false, nodes, connections,
    settings: { executionOrder: 'v1', executionTimeout: Math.ceil(workflow.budget.maxDurationMs / 1000),
      saveExecutionProgress: true },
    meta: { foundry: { profile: specification.profile, workflowHash,
      ready: missingBindings.length === 0, targetRuntimeVerified: false } } };
  return [
    { path: 'workflow.n8n.json', content: JSON.stringify(exported, null, 2) + '\n' },
    { path: 'foundry-source.json', content: JSON.stringify(specification, null, 2) + '\n' },
    { path: 'bindings.json', content: JSON.stringify({ bindings, missingBindings, requiredContract: 'deadline-and-cancellation-v1' }, null, 2) + '\n' },
    { path: 'README.md', content: readFileSync(new URL('README.md', import.meta.url), 'utf8') }
  ];
}
