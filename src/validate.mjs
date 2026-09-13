import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { checkData, FoundryError, digest, references } from './data.mjs';
import { analyzeDataflow } from './dataflow.mjs';

export const workflowSchema = JSON.parse(readFileSync(new URL('../schemas/workflow.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, ownProperties: true });
const shape = ajv.compile(workflowSchema);
const dataSchemaCache = new Map();
export function compileDataSchema(schema, { trustedSchema = false } = {}) {
  checkData(schema, { maxBytes: 256 * 1024, maxDepth: 25 });
  let count = 0;
  const inspect = (value, depth = 0) => {
    if (++count > 1000) throw new FoundryError('SCHEMA_LIMIT', 'Schema contains too many sub-schemas');
    if (depth > 25) throw new FoundryError('SCHEMA_LIMIT', 'Schema nesting exceeds the supported limit');
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, '$async')) throw new FoundryError('UNSUPPORTED_SCHEMA', 'Asynchronous schemas cannot be used as synchronous execution gates');
    if (!trustedSchema && (Object.hasOwn(value, 'pattern') || Object.hasOwn(value, 'patternProperties'))) throw new FoundryError('UNSUPPORTED_SCHEMA', 'Untrusted regular expressions require a separately isolated validator capability; they are not executed in the coordinator');
    if (Object.hasOwn(value, 'format')) throw new FoundryError('UNSUPPORTED_SCHEMA', 'Format-dependent checks require an explicitly qualified validator; formats are not silently ignored');
    if (Object.hasOwn(value, '$ref') && (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/'))) throw new FoundryError('UNSUPPORTED_SCHEMA', 'Only local JSON schema references are supported');
    for (const key of ['properties', 'definitions', '$defs', 'patternProperties', 'dependentSchemas']) {
      if (value[key] && typeof value[key] === 'object') for (const child of Object.values(value[key])) inspect(child, depth + 1);
    }
    for (const key of ['additionalProperties', 'additionalItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems']) if (Object.hasOwn(value, key)) inspect(value[key], depth + 1);
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) if (Array.isArray(value[key])) for (const child of value[key]) inspect(child, depth + 1);
    if (Array.isArray(value.items)) for (const child of value.items) inspect(child, depth + 1);
    else if (Object.hasOwn(value, 'items')) inspect(value.items, depth + 1);
    if (value.dependencies && typeof value.dependencies === 'object') for (const child of Object.values(value.dependencies)) if (!Array.isArray(child)) inspect(child, depth + 1);
  };
  inspect(schema);
  const hash = `${trustedSchema ? 'trusted:' : ''}${digest(schema)}`;
  if (dataSchemaCache.has(hash)) return dataSchemaCache.get(hash);
  let test;
  try {
    // Independent compiler avoids cross-request $id collisions and schema poisoning.
    test = new Ajv({ allErrors: true, strictSchema: true, strictTypes: false, strictTuples: false, strictRequired: false, allowUnionTypes: true, ownProperties: true }).compile(schema);
  } catch (error) { throw new FoundryError('INVALID_SCHEMA', error.message); }
  if (test.$async) throw new FoundryError('UNSUPPORTED_SCHEMA', 'Asynchronous validation is not a gate');
  if (dataSchemaCache.size >= 128) dataSchemaCache.delete(dataSchemaCache.keys().next().value);
  dataSchemaCache.set(hash, test); return test;
}
export function validateData(schema, data, label = 'data', options = {}) {
  checkData(schema); checkData(data);
  // Remote schema retrieval/code-valued keywords are deliberately not supported.
  let test;
  try { test = compileDataSchema(schema, options); } catch (e) { throw new FoundryError(e.code ?? 'INVALID_SCHEMA', `${label}: ${e.message}`); }
  const result = test(data);
  if (result !== true) throw new FoundryError('SCHEMA_MISMATCH', `${label} does not satisfy its schema`, test.errors);
  return data;
}

const common = new Set(['id', 'kind', 'needs', 'description', 'when', 'join']);
const fields = {
  task: ['tool', 'args', 'timeoutMs', 'retry', 'onError'], assert: ['checks'],
  human: ['question', 'answerSchema'], wait: ['delayMs'],
  map: ['items', 'maxItems', 'body', 'input'],
  loop: ['maxIterations', 'body', 'until', 'initial', 'input']
};

export function validateWorkflow(workflow, { registry, maxNodes = 2000 } = {}) {
  const errors = [], warnings = [];
  try { checkData(workflow); } catch (e) { return { valid: false, errors: [{ code: e.code, message: e.message }], warnings }; }
  if (!shape(workflow)) return { valid: false, errors: shape.errors.map(e => ({ code: 'SCHEMA', path: e.instancePath, message: `${e.message} ${JSON.stringify(e.params)}` })), warnings };
  let total = 0;
  const add = (code, message, location) => errors.push({ code, message, path: location });
  if (/^[0-9a-f]{64}$/.test(workflow.id)) add('AMBIGUOUS_WORKFLOW_ID', 'Workflow ids cannot use the immutable SHA-256 address namespace', '/id');
  const walk = (flow, prefix, depth = 0, locals = new Set()) => {
    if (depth > 6) { add('NESTING_LIMIT', 'Nested flow depth exceeds 6', prefix); return; }
    const byId = new Map();
    for (const node of flow.nodes) {
      if (++total > maxNodes) { add('NODE_LIMIT', `Total nodes exceed ${maxNodes}`, prefix); return; }
      if (byId.has(node.id)) add('DUPLICATE_NODE', `Duplicate node ${node.id}`, prefix);
      if (['__proto__', 'constructor', 'prototype'].includes(node.id)) add('UNSAFE_NODE_ID', `Reserved node id ${node.id}`, prefix);
      byId.set(node.id, node);
      for (const key of Object.keys(node)) if (!common.has(key) && !fields[node.kind].includes(key)) add('WRONG_NODE_FIELD', `${key} does not belong to ${node.kind}`, `${prefix}.${node.id}`);
      if (node.kind === 'task') {
        const cap = registry?.get(node.tool);
        if (registry && !cap) add('UNKNOWN_TOOL', `Capability is not registered: ${node.tool}`, `${prefix}.${node.id}`);
        if (cap?.effects === 'non-idempotent' && node.retry.maxAttempts > 1) add('UNSAFE_RETRY', 'Non-idempotent capabilities cannot be automatically retried', `${prefix}.${node.id}`);
        if (cap && node.timeoutMs > cap.maxTimeoutMs) add('TIMEOUT_POLICY', 'Node timeout exceeds capability limit', `${prefix}.${node.id}`);
        if (node.onError === 'continue') warnings.push({ code: 'ERROR_CONTINUATION', path: `${prefix}.${node.id}`, message: 'Independent acceptance must detect failures hidden by continuation' });
        if (node.join === 'all_resolved' && cap && cap.effects !== 'none') warnings.push({ code: 'EFFECT_AFTER_RESOLVED_JOIN', path: `${prefix}.${node.id}`, message: 'This effect may follow a skipped/handled-error predecessor. Require an explicit evidence guard for the intended branch.' });
      }
      if (node.kind === 'human') {
        try { compileDataSchema(node.answerSchema); } catch (e) { add(e.code ?? 'INVALID_SCHEMA', e.message, `${prefix}.${node.id}.answerSchema`); }
      }
    }
    const visiting = new Set(), done = new Set(), ancestors = new Map();
    const visit = id => {
      if (visiting.has(id)) { add('CYCLE', `Unbounded dependency cycle at ${id}; use a bounded loop node`, prefix); return new Set(); }
      if (done.has(id)) return ancestors.get(id);
      visiting.add(id); const all = new Set();
      for (const dep of byId.get(id)?.needs ?? []) {
        if (!byId.has(dep)) { add('MISSING_DEPENDENCY', `Node ${id} depends on missing ${dep}`, prefix); continue; }
        all.add(dep); for (const x of visit(dep)) all.add(x);
      }
      visiting.delete(id); done.add(id); ancestors.set(id, all); return all;
    };
    for (const id of byId.keys()) visit(id);
    const inspectRefs = (value, location, allowed, allowedLocals = locals) => {
      try {
        for (const ref of references(value)) {
          const [root, id] = ref.split('.');
          if (root === 'nodes' && !id) add('BROAD_REFERENCE', 'Reference a particular dependency output, not all node state', location);
          else if (root === 'nodes' && !allowed.has(id)) add('UNDECLARED_DATA_DEPENDENCY', `${ref} is not available through needs`, location);
          else if (!['input', 'nodes'].includes(root) && !allowedLocals.has(root)) add('INVALID_LOCAL_REFERENCE', `${root} is unavailable in this flow`, location);
        }
      } catch (e) { add(e.code, e.message, location); }
    };
    for (const node of flow.nodes) {
      const { body, until, answerSchema, ...own } = node;
      inspectRefs(own, `${prefix}.${node.id}`, ancestors.get(node.id) ?? new Set());
      const cap = node.kind === 'task' ? registry?.get(node.tool) : null;
      for (const requirement of cap?.requiresEvidence ?? []) {
        const available = [...(ancestors.get(node.id) ?? [])].some(id => byId.get(id)?.kind === 'task' && byId.get(id)?.tool === requirement.sourceTool);
        if (!available) add('MISSING_EVIDENCE_DEPENDENCY', `${node.tool} requires prior ${requirement.sourceTool} evidence (${requirement.id}) in this flow's dependency chain`, `${prefix}.${node.id}`);
      }
      if (body) {
        const childLocals = new Set(node.kind === 'map' ? ['item', 'index'] : ['iteration', 'previous']);
        walk(body, `${prefix}.${node.id}.body`, depth + 1, childLocals);
        if (until) inspectRefs(until, `${prefix}.${node.id}.until`, new Set(body.nodes.map(n => n.id)), childLocals);
      }
      if (node.kind === 'assert' && node.checks.every(c => references(c).length === 0)) warnings.push({ code: 'CONSTANT_ASSERTION', path: `${prefix}.${node.id}`, message: 'Assertions on constants do not establish task success' });
    }
    inspectRefs(flow.acceptance, `${prefix}.acceptance`, new Set(byId.keys()));
    if (flow.acceptance.every(c => references(c).length === 0)) add('VACUOUS_ACCEPTANCE', 'Acceptance must inspect runtime evidence, not constants', prefix);
  };
  try { walk(workflow, 'workflow'); } catch (e) { add('VALIDATION_ERROR', e.message, 'workflow'); }
  if (workflow.inputSchema) try { compileDataSchema(workflow.inputSchema); } catch (e) { add(e.code ?? 'INVALID_SCHEMA', e.message, 'inputSchema'); }
  if (!errors.length) {
    const dataflow = analyzeDataflow(workflow, registry);
    errors.push(...dataflow.errors); warnings.push(...dataflow.warnings);
  }
  if (total > workflow.budget.maxSteps) warnings.push({ code: 'SMALL_BUDGET', message: 'The declared step budget is smaller than the static node count' });
  return { valid: errors.length === 0, errors, warnings, nodeCount: total, ...(errors.length ? {} : { hash: digest(workflow) }) };
}

export function requireWorkflow(workflow, options) {
  const result = validateWorkflow(workflow, options);
  if (!result.valid) throw new FoundryError('INVALID_WORKFLOW', 'Workflow validation failed', result.errors);
  return result;
}
