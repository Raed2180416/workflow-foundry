import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { checkData, FoundryError, digest, references } from './data.mjs';
import { analyzeDataflow, bindOutput, OUTPUT_KEY } from './dataflow.mjs';
import { portableSchemaViolations, quarantinedSchemaViolations } from './schema-subset.mjs';
import { inheritedLabel, joinLabels } from './context.mjs';
import { classIndex, modelById, modelsForClass } from './models/policy.mjs';
import { lintWorkflow } from './lint.mjs';

export { bindOutput, OUTPUT_KEY };

const readSchema = name => JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), 'utf8'));
export const workflowSchema = readSchema('workflow.schema.json');
export const identitySchema = readSchema('identity.schema.json');
export const decisionSchema = readSchema('decision.schema.json');
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
// Host-owned trace contracts (DESIGN §6): one compiler that knows the identity schema by $id.
const traceAjv = new Ajv({ allErrors: true, strictSchema: true, strictTypes: false, strictTuples: false, strictRequired: false, allowUnionTypes: true, ownProperties: true });
traceAjv.addSchema(identitySchema);
const identityTest = traceAjv.getSchema(identitySchema.$id), decisionTest = traceAjv.compile(decisionSchema);
const traceCheck = (test, value, label) => {
  checkData(value);
  if (test(value) !== true) throw new FoundryError('SCHEMA_MISMATCH', `${label} does not satisfy its schema`, test.errors);
  return value;
};
export const validateIdentity = identity => traceCheck(identityTest, identity, 'identity envelope');
export const validateDecision = decision => traceCheck(decisionTest, decision, 'decision record');

// Model-using nodes: agent, and verify with method agent.
export const usesModel = node => node.kind === 'agent' || (node.kind === 'verify' && node.method === 'agent');
export function modelNodes(flow, found = []) {
  for (const node of flow.nodes ?? []) { if (usesModel(node)) found.push(node); if (node.body) modelNodes(node.body, found); }
  return found;
}
export const VERIFY_RETURNS = Object.freeze({ type: 'object', additionalProperties: false, required: ['pass', 'score', 'reasons'], properties: {
  pass: { type: 'boolean' }, score: { type: 'number', minimum: 0, maximum: 1 },
  reasons: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 1000 } } } });
const verifyFields = { code: ['lang', 'source'], agent: ['instructions', 'context', 'model', 'decoding', 'escalation'], capability: ['tool', 'args'] };
const describe = violations => violations.slice(0, 5).map(v => `${v.path}${v.keyword ? ` ${v.keyword}` : ''}: ${v.problem}`).join('; ');
// Context input refs are plain strings in the IR; inspection uses the {$ref} form.
export const contextRefs = node => (node.context?.inputs ?? []).filter(spec => Object.hasOwn(spec, 'ref')).map(spec => ({ $ref: spec.ref }));
const labelOf = (template, scope) => joinLabels(references(template).map(ref => inheritedLabel(ref, scope)));
const only = (scope, prefix) => Object.fromEntries(Object.entries(scope).filter(([key]) => key === prefix || key.startsWith(`${prefix}.`)));
const entry = (key, label) => label === 'trusted' ? {} : { [key]: label };

const common = new Set(['id', 'kind', 'needs', 'description', 'when', 'join']);
const fields = {
  task: ['tool', 'args', 'timeoutMs', 'retry', 'onError'], assert: ['checks'],
  human: ['question', 'answerSchema'], wait: ['delayMs'],
  map: ['items', 'maxItems', 'body', 'input', 'concurrency', 'failure'],
  loop: ['maxIterations', 'body', 'until', 'initial', 'input'],
  agent: ['role', 'instructions', 'context', 'returns', 'model', 'decoding', 'checks', 'escalation', 'quarantined', 'timeoutMs', 'onError'],
  code: ['lang', 'source', 'args', 'returns', 'timeoutMs'],
  verify: ['method', 'subject', 'independence', 'gate', 'timeoutMs', 'role', ...new Set(Object.values(verifyFields).flat())]
};

// Static integrity labels (DESIGN §4): a conservative over-approximation of the runtime join.
// An approval gate is requiresApproval, or risk "high" (the runtime requires approval for both).
export const approvalGated = cap => cap.requiresApproval === true || cap.risk === 'high';
export const labelPolicyMessage = (tool, label) => `${tool} has effects and no approval gate, but its arguments depend on ${label} data`;
export const controlPolicyMessage = (tool, label, via = []) => `${tool} has effects and no approval gate, but whether it fires depends on ${label} data${via.length ? ` (${via.join('; ')})` : ''}. Route the decision through a human node or a quarantined judgment with a bounded enum, or gate the capability`;

// Control-flow (program-counter) taint, ROADMAP §2.9 and review-20261007/07 S2. A node's CONTROL label is the join of
// the labels that decide whether it runs at all: the guard (`when`) of the node, the iteration condition (`until`) and
// the item array (cardinality) of every enclosing loop/map, and the control label of every predecessor whose skip
// would skip this node (`needs` under join all_success; onError "continue" also lets the predecessor's DATA decide).
// What every reference to a node sees is its OUT label, data joined with control: a skipped node's output is absent,
// and absence (exists, default) is itself a read of the guard. A quarantined judgment declassifies its data, never the
// control that decided whether it ran. Termination (a failed assert or verify stops the run) is not tracked; only
// skip and iteration decisions are. Wait delays are schema literals, so there is nothing to taint.
const TRUSTED = 'trusted';
const NO_CONTROL = Object.freeze({ label: TRUSTED, via: Object.freeze([]) });
const joinControl = parts => {
  const live = parts.filter(part => part.label !== TRUSTED), via = [];
  for (const part of live) for (const step of part.via) if (!via.includes(step) && via.length < 6) via.push(step);
  return live.length ? { label: joinLabels(live.map(part => part.label)), via } : NO_CONTROL;
};
const untrustedRefs = (template, scope) => [...new Set(references(template ?? null).filter(ref => inheritedLabel(ref, scope) !== TRUSTED))].slice(0, 3).join(', ');
const controlFrom = (label, via) => label === TRUSTED ? NO_CONTROL : { label, via: [via()] };
const outEntries = outs => Object.fromEntries([...outs].filter(([, label]) => label !== TRUSTED).map(([id, label]) => [`nodes.${id}`, label]));
const FIXPOINT_PASSES = 32;
function effectTaint(workflow, registry, add) {
  const seen = new Set(), report = (code, message, location, extra) => {
    const key = `${code}|${location}|${extra?.rule ?? ''}`;
    if (!seen.has(key)) { seen.add(key); add(code, message, location, extra); }
  };
  const memo = new WeakMap();
  // Returns { label, outs, findings } for one flow under the control label `pc` of its enclosing node. Findings are
  // returned, not reported, so that the passes of a loop fixpoint that are later superseded report nothing.
  const walk = (flow, scope, prefix, pc) => {
    const memoKey = `${prefix}|${JSON.stringify(scope)}|${pc.label}|${pc.via.join('|')}`;
    if (!memo.has(flow)) memo.set(flow, new Map());
    if (memo.get(flow).has(memoKey)) return memo.get(flow).get(memoKey);
    const byId = new Map(flow.nodes.map(n => [n.id, n])), data = new Map(), control = new Map(), outs = new Map(), findings = [];
    const visit = id => {
      if (outs.has(id)) return;
      outs.set(id, TRUSTED); data.set(id, TRUSTED); control.set(id, NO_CONTROL);
      const node = byId.get(id);
      for (const dep of node.needs) visit(dep);
      const own = { ...scope, ...outEntries(outs) };
      let nodeControl = joinControl([pc, controlFrom(node.when ? labelOf(node.when, own) : TRUSTED, () => `${node.id} is guarded by a when that reads ${untrustedRefs(node.when, own)}`),
        ...((node.join ?? 'all_success') === 'all_success' ? node.needs.map(dep => {
          const through = joinControl([control.get(dep), byId.get(dep).onError === 'continue' ? controlFrom(data.get(dep), () => `${dep} continues on error over ${data.get(dep)} data`) : NO_CONTROL]);
          return through.label === TRUSTED ? through : { label: through.label, via: through.via.map(step => `${node.id} needs ${dep} <- ${step}`.slice(0, 300)) };
        }) : [])]);
      let label = TRUSTED;
      const inputs = () => joinLabels((node.context?.inputs ?? []).map(spec => joinLabels([spec.label ?? TRUSTED, Object.hasOwn(spec, 'ref') ? inheritedLabel(spec.ref, own) : TRUSTED])));
      if (node.kind === 'agent') label = node.quarantined === true ? TRUSTED : inputs();
      else if (node.kind === 'verify') label = joinLabels([labelOf(node.subject, own), labelOf(node.args ?? null, own), inputs()]);
      else if (node.kind === 'task' || node.kind === 'code') label = labelOf(node.args ?? null, own);
      else if (node.body) {
        const input = Object.hasOwn(node, 'input') ? entry('input', labelOf(node.input, own)) : only(own, 'input');
        const bodyPrefix = `${prefix}.${node.id}.body`;
        if (node.kind === 'map') {
          const items = labelOf(node.items, own);
          const child = walk(node.body, { ...input, ...entry('item', items) }, bodyPrefix, joinControl([nodeControl, controlFrom(items, () => `map ${node.id} iterates over ${untrustedRefs(node.items, own)}`)]));
          findings.push(...child.findings);
          label = joinLabels([items, child.label]);
        } else {
          // The body's control label includes what decides how many iterations run (the until label), and until reads body
          // outputs, so the two feed each other; the label lattice is finite, so a fixpoint exists.
          let previous = labelOf(node.initial, own), until = TRUSTED, child = null, settled = false;
          const untilScope = () => ({ ...input, ...entry('previous', previous), ...outEntries(child?.outs ?? new Map()) });
          const exits = () => controlFrom(until, () => `loop ${node.id} exits on ${untrustedRefs(node.until, untilScope())}`);
          for (let pass = 0; pass < FIXPOINT_PASSES && !settled; pass++) {
            child = walk(node.body, { ...input, ...entry('previous', previous) }, bodyPrefix, joinControl([nodeControl, exits()]));
            const nextUntil = joinLabels([until, labelOf(node.until, untilScope())]), nextPrevious = joinLabels([previous, child.label]);
            settled = nextPrevious === previous && nextUntil === until; previous = nextPrevious; until = nextUntil;
          }
          if (!settled) throw new FoundryError('TAINT_FIXPOINT', `Label analysis of loop ${node.id} did not converge in ${FIXPOINT_PASSES} passes`);
          findings.push(...child.findings);
          label = previous; nodeControl = joinControl([nodeControl, exits()]);
        }
      }
      if (node.kind === 'task') {
        const cap = registry?.get(node.tool), argsLabel = labelOf(node.args, own);
        if (cap && cap.effects !== 'none' && !approvalGated(cap)) {
          // LABEL_POLICY is the policy code; the rule code (UNTRUSTED_EFFECT_ARGS, UNTRUSTED_CONTROL) names the rule and is kept as a code of its own.
          if (argsLabel !== TRUSTED) findings.push(
            { code: 'LABEL_POLICY', message: labelPolicyMessage(node.tool, argsLabel), location: `${prefix}.${node.id}`, extra: { rule: 'UNTRUSTED_EFFECT_ARGS', label: argsLabel } },
            { code: 'UNTRUSTED_EFFECT_ARGS', message: labelPolicyMessage(node.tool, argsLabel), location: `${prefix}.${node.id}` });
          if (nodeControl.label !== TRUSTED) findings.push(
            { code: 'LABEL_POLICY', message: controlPolicyMessage(node.tool, nodeControl.label, nodeControl.via), location: `${prefix}.${node.id}`, extra: { rule: 'UNTRUSTED_CONTROL', label: nodeControl.label, via: nodeControl.via } },
            { code: 'UNTRUSTED_CONTROL', message: controlPolicyMessage(node.tool, nodeControl.label, nodeControl.via), location: `${prefix}.${node.id}` });
        }
      }
      data.set(id, label); control.set(id, nodeControl); outs.set(id, joinLabels([label, nodeControl.label]));
    };
    for (const id of byId.keys()) visit(id);
    const result = { label: joinLabels([...outs.values()]), outs, findings };
    memo.get(flow).set(memoKey, result);
    return result;
  };
  for (const { code, message, location, extra } of walk(workflow, { ...(workflow.labels ?? {}) }, 'workflow', NO_CONTROL).findings) report(code, message, location, extra);
}

// strict: also run the construction lint (lint.mjs). Its error findings make the workflow invalid, its warnings are
// appended to `warnings`, and the structured report is returned as `lint`. Default validation is unchanged.
export function validateWorkflow(workflow, { registry, maxNodes = 2000, modelPolicy = null, strict = false } = {}) {
  const errors = [], warnings = [];
  try { checkData(workflow); } catch (e) { return { valid: false, errors: [{ code: e.code, message: e.message }], warnings }; }
  if (!shape(workflow)) return { valid: false, errors: shape.errors.map(e => ({ code: 'SCHEMA', path: e.instancePath, message: `${e.message} ${JSON.stringify(e.params)}` })), warnings };
  let total = 0;
  const add = (code, message, location, extra = {}) => errors.push({ code, message, path: location, ...extra });
  const policy = modelPolicy?.policy ?? modelPolicy;
  if (!policy && modelNodes(workflow).length) add('MODEL_POLICY_REQUIRED', 'Agent and model-verifier nodes are validated against the owner model policy; none was supplied', 'workflow');
  const candidates = node => {
    const { id, class: cls, maxClass } = node.model, entry = id === undefined ? null : modelById(policy, id);
    if (cls !== undefined) classIndex(policy, cls);
    if (entry && cls !== undefined && entry.class !== cls) throw new FoundryError('MODEL_CLASS_MISMATCH', `Model ${id} is class ${entry.class}, not ${cls}`);
    const base = cls ?? entry.class, top = maxClass ?? base;
    if (classIndex(policy, top) < classIndex(policy, base)) throw new FoundryError('MODEL_CLASS_ORDER', `maxClass ${top} is below the starting class ${base}`);
    if (!entry && !modelsForClass(policy, base).length) throw new FoundryError('MODEL_CLASS_EMPTY', `The model policy lists no model for class ${base}`);
    return { entry, first: entry ?? modelsForClass(policy, base)[0], range: policy.classOrder.slice(classIndex(policy, base), classIndex(policy, top) + 1) };
  };
  if (/^[0-9a-f]{64}$/.test(workflow.id)) add('AMBIGUOUS_WORKFLOW_ID', 'Workflow ids cannot use the immutable SHA-256 address namespace', '/id');
  if (policy && workflow.defaultClass !== undefined) try { classIndex(policy, workflow.defaultClass); } catch (e) { add(e.code ?? 'MODEL_POLICY', e.message, '/defaultClass'); }
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
      const at = `${prefix}.${node.id}`;
      if (node.kind === 'verify') {
        for (const key of Object.keys(node)) if (Object.values(verifyFields).flat().includes(key) && !verifyFields[node.method].includes(key)) add('WRONG_NODE_FIELD', `${key} does not belong to a ${node.method} verifier`, at);
        if ((node.method === 'agent') === (node.independence === 'execution')) add('VERIFY_INDEPENDENCE', node.method === 'agent' ? 'A model verifier is labelled different-model or same-model, never execution' : 'Code and capability verifiers are execution checks', at);
        if (node.method === 'capability') {
          const cap = registry?.get(node.tool);
          if (registry && !cap) add('UNKNOWN_TOOL', `Capability is not registered: ${node.tool}`, at);
          if (cap && cap.effects !== 'none') add('VERIFY_EFFECTS', 'A verification oracle must not have effects', at);
          if (cap && (node.timeoutMs ?? 60000) > cap.maxTimeoutMs) add('TIMEOUT_POLICY', 'Node timeout exceeds capability limit', at);
        }
      }
      if (node.kind === 'agent') {
        const portable = portableSchemaViolations(node.returns);
        if (portable.length) add('SCHEMA_NOT_PORTABLE', `Output schema is outside the portable subset: ${describe(portable)}`, `${at}.returns`);
        else {
          try { compileDataSchema(node.returns); } catch (e) { add(e.code ?? 'INVALID_SCHEMA', e.message, `${at}.returns`); }
          const quarantine = node.quarantined === true ? quarantinedSchemaViolations(node.returns) : [];
          if (quarantine.length) add('QUARANTINE_SCHEMA', `Quarantined output schema may contain only booleans, string enums and bounded numbers: ${describe(quarantine)}`, `${at}.returns`);
        }
        if (node.onError === 'continue') warnings.push({ code: 'ERROR_CONTINUATION', path: at, message: 'Independent acceptance must detect failures hidden by continuation' });
      }
      if (usesModel(node)) {
        const names = (node.context?.inputs ?? []).map(input => input.name);
        if (new Set(names).size !== names.length) add('CONTEXT_INPUT', 'Context input names must be unique', `${at}.context`);
        if (node.kind === 'verify' && names.includes('subject')) add('CONTEXT_INPUT', 'The context input name subject is reserved for the verified value', `${at}.context`);
        if (policy) try { candidates(node); } catch (e) { add(e.code ?? 'MODEL_POLICY', e.message, `${at}.model`); }
      }
      if (node.kind === 'code' && node.returns) try { compileDataSchema(node.returns); } catch (e) { add(e.code ?? 'INVALID_SCHEMA', e.message, `${at}.returns`); }
      if (node.kind === 'map') {
        if ((node.concurrency ?? 1) > workflow.budget.maxConcurrency) warnings.push({ code: 'MAP_CONCURRENCY_CAPPED', path: at, message: `concurrency ${node.concurrency} exceeds budget.maxConcurrency ${workflow.budget.maxConcurrency}; at most ${workflow.budget.maxConcurrency} items run at once` });
        if (node.failure === 'collect') warnings.push({ code: 'ERROR_COLLECTION', path: at, message: 'Collected item failures become $error entries; acceptance must inspect the failed count' });
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
      const { body, until, answerSchema, returns, context, instructions, source, model, decoding, escalation, ...own } = node;
      const outputChecks = node.kind === 'agent' ? own.checks : undefined;
      if (outputChecks) delete own.checks;
      inspectRefs(own, `${prefix}.${node.id}`, ancestors.get(node.id) ?? new Set());
      inspectRefs(contextRefs(node), `${prefix}.${node.id}.context`, ancestors.get(node.id) ?? new Set());
      if (outputChecks) inspectRefs(bindOutput(outputChecks), `${prefix}.${node.id}.checks`, new Set([...(ancestors.get(node.id) ?? []), OUTPUT_KEY]));
      if (node.kind === 'verify' && node.independence === 'different-model' && policy) {
        try {
          const producers = references(node.subject).map(ref => ref.split('.')).filter(([root, id]) => root === 'nodes' && byId.get(id)?.kind === 'agent').map(([, id]) => byId.get(id));
          const used = new Set(producers.map(p => candidates(p).first.family));
          const { entry, range } = candidates(node);
          const eligible = entry ? !used.has(entry.family) : range.some(cls => modelsForClass(policy, cls, { excludeFamily: used }).length);
          if (!eligible) add('VERIFY_INDEPENDENCE', `No verifier model outside the producer famil${used.size === 1 ? 'y' : 'ies'} ${[...used].join(', ')} is available`, `${prefix}.${node.id}`);
        } catch {}
      }
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
    try { effectTaint(workflow, registry, add); } catch (e) { add(e.code ?? 'VALIDATION_ERROR', e.message, 'workflow'); }
  }
  if (total > workflow.budget.maxSteps) warnings.push({ code: 'SMALL_BUDGET', message: 'The declared step budget is smaller than the static node count' });
  let lint;
  if (strict) {
    lint = lintWorkflow(workflow, { modelPolicy: policy });
    // The strict ERROR_COLLECTION and ERROR_CONTINUATION rules replace the advisory warnings of the same codes: each is an error when
    // the outcome is not gated and silent when it is, so keeping both would report one problem twice under one code.
    for (let i = warnings.length - 1; i >= 0; i--) if (warnings[i].code === 'ERROR_COLLECTION' || warnings[i].code === 'ERROR_CONTINUATION') warnings.splice(i, 1);
    for (const { severity, ...finding } of lint.findings) (severity === 'error' ? errors : warnings).push({ ...finding, severity });
  }
  return { valid: errors.length === 0, errors, warnings, nodeCount: total, ...(strict ? { strict: true, lint } : {}), ...(errors.length ? {} : { hash: digest(workflow) }) };
}

export function requireWorkflow(workflow, options) {
  const result = validateWorkflow(workflow, options);
  if (!result.valid) throw new FoundryError('INVALID_WORKFLOW', 'Workflow validation failed', result.errors);
  return result;
}
