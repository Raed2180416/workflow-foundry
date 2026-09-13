// Conservative structural analysis. It rejects only paths that cannot exist
// under declared contracts. Unknown schemas remain unknown; this is not an
// outcome oracle or a proof that a producer's data is current/true.
import { refParts, condition } from './data.mjs';

const unknown = () => ({});
const record = properties => ({ type: 'object', properties, additionalProperties: false });
const union = schemas => schemas.length === 1 ? schemas[0] : { anyOf: schemas };
const escapePointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const schemaRoots = new WeakMap();
const unknowable = Symbol('unknown first-iteration value');
function firstExit(expression) {
  const value = template => {
    if (template && typeof template === 'object') {
      if (Object.hasOwn(template, '$ref')) return template.$ref === 'iteration' ? 0 : unknowable;
      const entries = Array.isArray(template) ? template.map(child => value(child)) : Object.entries(template).map(([key, child]) => [key, value(child)]);
      if (Array.isArray(template)) return entries.includes(unknowable) ? unknowable : entries;
      return entries.some(([, child]) => child === unknowable) ? unknowable : Object.fromEntries(entries);
    }
    return template;
  };
  if (expression.op === 'all' || expression.op === 'any') {
    const results = expression.conditions.map(firstExit);
    if (expression.op === 'all') return results.includes(false) ? false : results.every(x => x === true) ? true : undefined;
    return results.includes(true) ? true : results.every(x => x === false) ? false : undefined;
  }
  if (expression.op === 'not') { const result = firstExit(expression.condition); return result === undefined ? undefined : !result; }
  const evaluated = value(expression);
  if (evaluated === unknowable) return undefined;
  try { return condition(evaluated, {}); } catch { return undefined; }
}

function literalSchema(value, depth = 0) {
  if (depth > 20) return unknown();
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', items: value.map(v => literalSchema(v, depth + 1)), minItems: value.length, maxItems: value.length, additionalItems: false };
  if (typeof value === 'object') return record(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, literalSchema(child, depth + 1)])));
  return { type: typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value };
}

function localRef(root, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return null;
  let value = root;
  for (const part of reference.slice(2).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return null;
    value = value[part];
  }
  return value;
}

// Schemas from independent capabilities may use the same local definition names.
// Keep their roots attached; never resolve one producer's $ref in another root.
const bound = schema => ({ schema, root: schema });
function choices(results) {
  if (results.every(r => r.state === 'missing')) return { state: 'missing', schemas: [], reason: results[0]?.reason ?? 'The declared alternatives exclude this path' };
  return {
    state: results.every(r => r.state === 'known') ? 'known' : 'unknown',
    schemas: results.flatMap(r => r.schemas),
    possibleMissing: results.some(r => r.state === 'missing' || r.possibleMissing)
  };
}

function descend({ schema, root }, parts, depth = 0) {
  if (schema && typeof schema === 'object') root = schemaRoots.get(schema) ?? root;
  if (depth > 24 || schema === undefined || schema === true) return { state: 'unknown', schemas: [bound(unknown())] };
  if (schema === false) return { state: 'missing', schemas: [], reason: 'The schema forbids this value' };
  if (!parts.length) return { state: 'known', schemas: [{ schema, root }] };
  if (!schema || typeof schema !== 'object') return { state: 'unknown', schemas: [bound(unknown())] };
  if (schema.$ref) {
    const target = localRef(root, schema.$ref);
    return target === null ? { state: 'unknown', schemas: [bound(unknown())] } : descend({ schema: target, root }, parts, depth + 1);
  }
  if (Object.hasOwn(schema, 'const')) return descend(bound(literalSchema(schema.const)), parts, depth + 1);
  if (Array.isArray(schema.enum) && schema.enum.length <= 50) return choices(schema.enum.map(value => descend(bound(literalSchema(value)), parts, depth + 1)));
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) return choices(alternatives.map(child => descend({ schema: child, root }, parts, depth + 1)));
  if (Array.isArray(schema.allOf)) {
    const results = schema.allOf.map(child => descend({ schema: child, root }, parts, depth + 1));
    const absent = results.find(r => r.state === 'missing');
    if (absent) return absent;
    const known = results.filter(r => r.state === 'known');
    return known.length ? { state: 'known', schemas: known.flatMap(r => r.schemas) } : { state: 'unknown', schemas: [bound(unknown())] };
  }
  const [key, ...rest] = parts;
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null;
  if (types && !types.includes('object') && !types.includes('array')) return { state: 'missing', schemas: [], reason: `Cannot traverse property ${key} of declared ${types.join('|')}` };
  if (types?.includes('array') && !types.includes('object')) {
    // Native own-property traversal exposes array length as well as indices.
    if (key === 'length') return descend(bound({ type: 'integer' }), rest, depth + 1);
    if (!/^(0|[1-9][0-9]*)$/.test(key)) return { state: 'missing', schemas: [], reason: `Array traversal requires an explicit numeric index, not ${key}` };
    const index = Number(key);
    if (!Number.isSafeInteger(index) || (Number.isFinite(schema.maxItems) && index >= schema.maxItems)) return { state: 'missing', schemas: [], reason: 'Array index exceeds its declared maximum length' };
    let item;
    if (Array.isArray(schema.items)) item = schema.items[index] ?? schema.additionalItems;
    else item = schema.items;
    const result = descend({ schema: item, root }, rest, depth + 1);
    return { ...result, possibleMissing: result.possibleMissing || (schema.minItems ?? 0) <= index };
  }
  if (types?.includes('object') && !types.includes('array')) {
    const property = schema.properties?.[key];
    if (property !== undefined) {
      const result = descend({ schema: property, root }, rest, depth + 1);
      return { ...result, possibleMissing: result.possibleMissing || !schema.required?.includes(key) };
    }
    // patternProperties/conditional schemas make the set of legal keys less
    // obvious. Do not claim that an unlisted property is impossible in that case.
    if (schema.patternProperties || schema.if || schema.then || schema.else) return { state: 'unknown', schemas: [bound(unknown())] };
    if (schema.additionalProperties === false) return { state: 'missing', schemas: [], reason: `Closed object has no property ${key}; declared keys: ${Object.keys(schema.properties ?? {}).join(', ') || '(none)'}` };
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') return descend({ schema: schema.additionalProperties, root }, rest, depth + 1);
  }
  return { state: 'unknown', schemas: [bound(unknown())] };
}

function lookup(reference, context) {
  const [base, ...parts] = refParts(reference);
  const schemas = context[base];
  if (!schemas) return { state: 'unknown', schemas: [bound(unknown())] }; // scope validation is owned by validateWorkflow
  return choices(schemas.map(schema => descend(schema, parts)));
}
function infer(template, context, depth = 0) {
  if (depth > 20) return unknown();
  if (template && typeof template === 'object' && Object.hasOwn(template, '$ref')) {
    try {
      const result = lookup(template.$ref, context);
      if (result.state === 'missing' && Object.hasOwn(template, 'default')) return literalSchema(template.default);
      // Preserve $ref roots by resolving into structural shapes only as needed.
      // A referenced schema with local refs cannot be transplanted losslessly.
      const schemas = result.schemas.map(s => s.schema === s.root ? s.schema : (s.schema?.$ref ? unknown() : s.schema));
      if (Object.hasOwn(template, 'default')) schemas.push(literalSchema(template.default));
      return schemas.length ? union(schemas) : unknown();
    } catch { return unknown(); }
  }
  if (Array.isArray(template)) return { type: 'array', items: template.length ? union(template.map(v => infer(v, context, depth + 1))) : unknown(), minItems: template.length, maxItems: template.length };
  if (template && typeof template === 'object') return record(Object.fromEntries(Object.entries(template).map(([key, value]) => [key, infer(value, context, depth + 1)])));
  return literalSchema(template);
}

export function analyzeDataflow(workflow, registry) {
  const errors = [], warnings = [], outputCache = new WeakMap();
  const nodeOutput = node => {
    if (node.kind === 'task') {
      const schema = registry?.get(node.tool)?.outputSchema ?? unknown();
      if (schema && typeof schema === 'object') schemaRoots.set(schema, schema);
      return node.onError === 'continue' ? union([schema, record({ ok: { const: false }, error: record({ code: { type: 'string' }, message: { type: 'string' } }) })]) : schema;
    }
    if (node.kind === 'assert') return record({ passed: { const: true } });
    if (node.kind === 'human') return record({ answer: node.answerSchema });
    if (node.kind === 'wait') return record({ waitedMs: { type: 'integer' } });
    if (node.kind === 'map') return record({ items: { type: 'array', items: outputs(node.body), maxItems: node.maxItems }, count: { type: 'integer' } });
    if (node.kind === 'loop') return record({ iterations: { type: 'integer' }, last: outputs(node.body) });
    return unknown();
  };
  const outputs = flow => {
    if (!outputCache.has(flow)) outputCache.set(flow, record(Object.fromEntries(flow.nodes.map(n => [n.id, nodeOutput(n)]))));
    return outputCache.get(flow);
  };
  const inspect = (value, context, location, phaseContexts = null, guarded = false, asCondition = false) => {
    if (!value || typeof value !== 'object') return;
    // exists is explicitly a missing-value probe in the native interpreter. A
    // missing path here returns false; it is not an unconditional dereference.
    if (asCondition && value.op === 'exists' && Object.hasOwn(value, 'value')) return;
    // Later boolean terms may never execute because the interpreter short-circuits.
    // Keep their diagnostics visible without pretending to prove reachability.
    if (asCondition && ['all', 'any'].includes(value.op) && Array.isArray(value.conditions)) {
      value.conditions.forEach((child, index) => inspect(child, context, `${location}/conditions/${index}`, phaseContexts, guarded || index > 0, true));
      return;
    }
    if (asCondition && value.op === 'not') { inspect(value.condition, context, `${location}/condition`, phaseContexts, guarded, true); return; }
    if (Object.hasOwn(value, '$ref')) {
      if (Object.keys(value).some(key => key !== '$ref' && key !== 'default')) {
        errors.push({ code: 'INVALID_REFERENCE', path: location, message: 'Reference objects contain only $ref and an optional literal default' }); return;
      }
      let result;
      try { result = lookup(value.$ref, context); } catch { return; }
      if (result.state === 'missing' && !Object.hasOwn(value, 'default')) (guarded ? warnings : errors).push({ code: guarded ? 'CONDITIONAL_REFERENCE_GAP' : 'IMPOSSIBLE_REFERENCE', path: location, reference: value.$ref, message: `${value.$ref} cannot exist under the declared data contract if this read is reached. ${result.reason ?? 'All declared alternatives exclude this path'}` });
      if (phaseContexts && value.$ref.startsWith('previous.') && !Object.hasOwn(value, 'default')) {
        const phaseResults = phaseContexts.map(c => lookup(value.$ref, c));
        const requiredGap = phaseResults.some((r, index) => r.state === 'missing' && phaseContexts[index].requiredPhase !== false);
        if (phaseResults.some(r => r.state === 'missing') && !phaseResults.every(r => r.state === 'missing')) (guarded || !requiredGap ? warnings : errors).push({ code: 'RECURRENCE_PATH_GAP', path: location, reference: value.$ref, message: 'This carried-state contract is absent in the initializer or a possible later body result. Preserve body node wrappers or provide an explicit phase guard/default. A maximum iteration count alone does not prove a later iteration executes.', guarded, requiredPhaseGap: requiredGap });
      }
      return; // Defaults are literal fallbacks; they are never recursively resolved.
    }
    for (const [key, child] of Object.entries(value)) inspect(child, context, `${location}/${escapePointer(key)}`, phaseContexts, guarded, asCondition && Array.isArray(value));
  };
  const walk = (flow, input, locals, location, phaseLocals = null, inheritedGuard = false) => {
    const context = { input: [bound(input)], nodes: [bound(outputs(flow))], ...locals };
    const phases = phaseLocals?.map(local => ({ ...context, ...local }));
    for (let index = 0; index < flow.nodes.length; index++) {
      const node = flow.nodes[index], nodePath = `${location}/nodes/${index}`;
      for (const key of ['when', 'args', 'checks', 'items', 'input', 'initial']) if (Object.hasOwn(node, key)) inspect(node[key], context, `${nodePath}/${key}`, phases, inheritedGuard || (key !== 'when' && !!node.when), key === 'when' || key === 'checks');
      if (!node.body) continue;
      const childInput = Object.hasOwn(node, 'input') ? infer(node.input, context) : input;
      if (node.kind === 'map') {
        const items = infer(node.items, context);
        const element = Array.isArray(items.items) ? union(items.items) : items.items ?? unknown();
        walk(node.body, childInput, { item: [bound(element)], index: [bound({ type: 'integer' })] }, `${nodePath}/body`, null, inheritedGuard || !!node.when);
      } else {
        const initial = bound(infer(node.initial, context)), recurrent = bound(outputs(node.body));
        const childLocals = { iteration: [bound({ type: 'integer' })], previous: node.maxIterations === 1 ? [initial] : [initial, recurrent] };
        const phaseBindings = node.maxIterations === 1 ? null : [{ previous: [initial], requiredPhase: true }, { previous: [recurrent], requiredPhase: firstExit(node.until) === false }];
        walk(node.body, childInput, childLocals, `${nodePath}/body`, phaseBindings, inheritedGuard || !!node.when);
        const untilContext = { input: [bound(childInput)], nodes: [recurrent], ...childLocals };
        inspect(node.until, untilContext, `${nodePath}/until`, phaseBindings?.map(phase => ({ ...untilContext, ...phase })) ?? null, inheritedGuard || !!node.when, true);
      }
    }
    inspect(flow.acceptance, context, `${location}/acceptance`, phases, inheritedGuard, true);
  };
  walk(workflow, workflow.inputSchema ?? unknown(), {}, '');
  return { errors, warnings, scope: 'Declared structural output paths only; unknown schemas, optional values, causal handoff and task outcomes need executable checks.' };
}
