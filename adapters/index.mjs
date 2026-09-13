import { canonical, clone, checkData, FoundryError } from '../src/data.mjs';
import { requireWorkflow, compileDataSchema } from '../src/validate.mjs';
import { schemaSubset, portableHelpers } from './n8n/portable.mjs';
import { langgraphFiles } from './langgraph/export.mjs';
import { n8nFiles } from './n8n/export.mjs';

export const capabilityMatrix = Object.freeze({
  langgraph: Object.freeze({ profile: 'serial-pure-v1', nodeKinds: ['task', 'assert', 'human'],
    conditions: true, maxConcurrency: 1, maxAttempts: 1, effects: ['pure'],
    human: 'separate preparation and interrupt nodes; total-order workflows only',
    persistence: 'caller-supplied checkpointer; no Foundry Store/CAS migration',
    taskTimeout: 'POSIX child process terminated as a process group',
    runtimeParity: false }),
  n8n: Object.freeze({ profile: 'serial-delegated-pure-v1', nodeKinds: ['task', 'assert'],
    conditions: true, maxConcurrency: 1, maxAttempts: 1, effects: ['pure'],
    human: false, persistence: 'n8n execution persistence; no Foundry Store/CAS migration',
    taskTimeout: 'required external sub-workflow contract, checked again on return',
    runtimeParity: false })
});

function stableOrder(nodes) {
  const remaining = [...nodes], done = new Set(), order = [];
  while (remaining.length) {
    const index = remaining.findIndex(n => n.needs.every(id => done.has(id)));
    if (index < 0) throw new FoundryError('CYCLE', 'Workflow cannot be ordered');
    const [node] = remaining.splice(index, 1);
    done.add(node.id); order.push(node);
  }
  return order;
}

/** Export data only. This function never writes files or installs/runs a target. */
export function exportWorkflow(workflow, target, options = {}) {
  const validation = requireWorkflow(workflow);
  checkData(options);
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new FoundryError('UNSUPPORTED_EXPORT', 'Export options must be an object');
  const matrix = Object.hasOwn(capabilityMatrix, target) ? capabilityMatrix[target] : undefined;
  if (!matrix) throw new FoundryError('UNSUPPORTED_EXPORT', `Unknown export target: ${target}`);
  const reasons = [], warnings = [...validation.warnings];
  try { portableHelpers().data(workflow); portableHelpers().data(options); }
  catch (error) { reasons.push(`Portable data profile: ${error.message}`); }
  if (Object.keys(options).some(k => k !== 'bindings')) reasons.push('The only supported export option is bindings');
  if (workflow.budget.maxConcurrency !== 1) reasons.push('maxConcurrency must equal 1');
  if (workflow.nodes.length > 100) reasons.push('This export profile supports at most 100 nodes');
  const order = stableOrder(workflow.nodes), ancestors = new Map();
  for (const node of order) {
    const reachable = new Set(node.needs);
    for (const dep of node.needs) for (const parent of ancestors.get(dep)) reachable.add(parent);
    ancestors.set(node.id, reachable);
    if (!matrix.nodeKinds.includes(node.kind)) reasons.push(`${node.id}: unsupported kind ${node.kind}`);
    if (node.kind === 'task' && node.retry.maxAttempts !== 1) reasons.push(`${node.id}: retries are not supported by this export profile`);
    if (node.onError === 'continue') reasons.push(`${node.id}: onError=continue is unsupported`);
    if (node.answerSchema) reasons.push(...schemaSubset(node.answerSchema, `${node.id}.answerSchema`));
  }
  if (order.some(n => n.kind === 'human') && order.some((n, i) => i && !ancestors.get(n.id).has(order[i - 1].id))) {
    reasons.push('Human workflows must be totally ordered; independent work during a pause is not equivalent to serial LangGraph interruption');
  }
  if (workflow.inputSchema) reasons.push(...schemaSubset(workflow.inputSchema, 'inputSchema'));
  const bindings = options.bindings ?? {};
  if (!bindings || Array.isArray(bindings) || typeof bindings !== 'object') reasons.push('bindings must be an object');
  const tools = [...new Set(order.filter(n => n.kind === 'task').map(n => n.tool))];
  const resolved = {}, missing = [];
  for (const tool of tools) {
    const binding = bindings?.[tool];
    if (!binding) { missing.push(tool); continue; }
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) { reasons.push(`${tool}: invalid binding`); continue; }
    if (binding.effects !== 'pure' || binding.cost !== 0 || binding.risk !== 'low' || binding.requiresApproval !== false) {
      reasons.push(`${tool}: binding must explicitly declare pure, zero-cost, low-risk and no approval requirement`);
    }
    if (!Number.isSafeInteger(binding.maxTimeoutMs) || binding.maxTimeoutMs < 1 || binding.maxTimeoutMs > 3600000) reasons.push(`${tool}: invalid maxTimeoutMs`);
    if (order.some(n => n.tool === tool && n.timeoutMs > binding.maxTimeoutMs)) reasons.push(`${tool}: requested timeout exceeds binding maximum`);
    for (const key of ['inputSchema', 'outputSchema']) {
      if (!binding[key] || typeof binding[key] !== 'object' || Array.isArray(binding[key])) reasons.push(`${tool}: ${key} must be an explicit schema object`);
      else {
        reasons.push(...schemaSubset(binding[key], `${tool}.${key}`));
        try { compileDataSchema(binding[key]); }
        catch (error) { reasons.push(`${tool}: invalid ${key}: ${error.message}`); }
      }
    }
    if (target === 'langgraph') {
      if (typeof binding.entrypoint !== 'string' || !/^[A-Za-z0-9_/-]+\.py:[A-Za-z_][A-Za-z0-9_]*$/.test(binding.entrypoint) || binding.entrypoint.startsWith('/') || binding.entrypoint.includes('..')) reasons.push(`${tool}: entrypoint must be a relative Python file:function`);
      if (!/^[a-f0-9]{64}$/.test(binding.codeSha256 ?? '')) reasons.push(`${tool}: a trusted entrypoint codeSha256 is required`);
    } else {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(binding.workflowId ?? '')) reasons.push(`${tool}: a literal n8n workflowId is required`);
      if (binding.timeoutContract !== 'deadline-and-cancellation-v1') reasons.push(`${tool}: external timeout/cancellation contract must be explicitly declared`);
    }
    resolved[tool] = clone(binding);
  }
  if (reasons.length) throw new FoundryError('UNSUPPORTED_EXPORT', `Workflow cannot be exported to ${target}`, { target, reasons });
  if (missing.length) warnings.push({ code: 'UNBOUND_CAPABILITIES', message: `Runtime execution is blocked until trusted bindings are supplied: ${missing.join(', ')}` });
  warnings.push({ code: 'QUALIFIED_EXPORT', message: 'This target has a limited execution profile. It does not migrate Foundry event chains, authority, CAS state or in-flight runs.' });
  if (target === 'n8n') warnings.push({ code: 'DELEGATED_TIMEOUT', message: 'Sub-workflow bindings must enforce task deadlines and cancellation. Generated guards reject late results but cannot terminate a remote task themselves.' });
  const specification = { workflow: clone(workflow), workflowHash: validation.hash, workflowCanonical: canonical(workflow),
    order: order.map(n => n.id), bindings: resolved, missingBindings: missing,
    profile: matrix.profile };
  const files = target === 'langgraph' ? langgraphFiles(specification) : n8nFiles(specification);
  return { files, supported: { ...clone(matrix), ready: missing.length === 0,
    workflowHash: validation.hash, externalBindings: tools.map(tool => ({ tool, bound: !missing.includes(tool) })),
    joins: ['all_success', 'all_resolved'], schemaProfile: 'portable-draft7-v1',
    numericProfile: 'finite IEEE754 values; integers restricted to safe range',
    stringProfile: 'Unicode scalar values only; unpaired surrogates rejected' }, warnings };
}
