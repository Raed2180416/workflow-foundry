import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { checkData, FoundryError, digest, references } from './data.mjs';
import { analyzeDataflow, bindOutput, OUTPUT_KEY } from './dataflow.mjs';
import { portableSchemaViolations, quarantinedSchemaViolations } from './schema-subset.mjs';
import { inheritedLabel, joinLabels } from './context.mjs';
import { classIndex, modelById, modelsForClass } from './models/policy.mjs';
import { lintWorkflow } from './lint.mjs';
import { correlateTemplates, isSignalWait, parseAt, routeOf, subscriptionsOf, timeoutMode } from './signals.mjs';
import { CURSOR_ORDERS, instantNanos, isStateWrite, slotOf, STATE_ARGS, STATE_LIMITS, STATE_OPS } from './state.mjs';
import { principalProblems, roleMatrix, satisfiability } from './principals.mjs';
import { BLOB_LIMITS, isHandle } from './blobs.mjs';

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
// State nodes (src/state.mjs): read or write the workflow's cross-run state.
export function stateNodes(flow, found = []) {
  for (const node of flow.nodes ?? []) { if (node.kind === 'state') found.push(node); if (node.body) stateNodes(node.body, found); }
  return found;
}
// The argument templates of a state node (key, value, by, ifVersion), as written.
export const stateArgs = node => Object.fromEntries(STATE_ARGS.filter(name => Object.hasOwn(node, name)).map(name => [name, node[name]]));
// Which arguments each state operation takes.
const STATE_OP_ARGS = Object.freeze({ get: ['key'], put: ['key', 'value', 'ifVersion'], add: ['key', 'ifVersion'], incr: ['key', 'by', 'ifVersion'], delete: ['key', 'ifVersion'] });
export const stateLabelMessage = (slot, slotLabel, label, via = []) => `State slot ${slot} is labelled ${slotLabel}, but this write carries ${label} data${via.length ? ` (${via.join('; ')})` : ''}. Label the slot with that source (its reads then carry it) or route the decision through a human node or a quarantined judgment`;
export const VERIFY_RETURNS = Object.freeze({ type: 'object', additionalProperties: false, required: ['pass', 'score', 'reasons'], properties: {
  pass: { type: 'boolean' }, score: { type: 'number', minimum: 0, maximum: 1 },
  reasons: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 1000 } } } });
const verifyFields = { code: ['lang', 'source'], agent: ['instructions', 'context', 'model', 'decoding', 'escalation'], capability: ['tool', 'args'], ledger: ['ledger'] };
const describe = violations => violations.slice(0, 5).map(v => `${v.path}${v.keyword ? ` ${v.keyword}` : ''}: ${v.problem}`).join('; ');
// Context input refs are plain strings in the IR; inspection uses the {$ref} form.
export const contextRefs = node => (node.context?.inputs ?? []).filter(spec => Object.hasOwn(spec, 'ref')).map(spec => ({ $ref: spec.ref }));
const labelOf = (template, scope) => joinLabels(references(template).map(ref => inheritedLabel(ref, scope)));
const only = (scope, prefix) => Object.fromEntries(Object.entries(scope).filter(([key]) => key === prefix || key.startsWith(`${prefix}.`)));
const entry = (key, label) => label === 'trusted' ? {} : { [key]: label };

const common = new Set(['id', 'kind', 'needs', 'description', 'when', 'join']);
const fields = {
  task: ['tool', 'args', 'timeoutMs', 'retry', 'onError'], assert: ['checks'],
  human: ['question', 'answerSchema', 'principal'], wait: ['delayMs', 'at', 'signal', 'race', 'correlate', 'schema', 'timeoutMs', 'onTimeout', 'label'],
  map: ['items', 'maxItems', 'body', 'input', 'concurrency', 'failure'],
  loop: ['maxIterations', 'body', 'until', 'initial', 'input'],
  agent: ['role', 'instructions', 'context', 'returns', 'model', 'decoding', 'checks', 'escalation', 'quarantined', 'timeoutMs', 'onError'],
  code: ['lang', 'source', 'args', 'returns', 'timeoutMs'],
  verify: ['method', 'subject', 'independence', 'gate', 'timeoutMs', 'role', ...new Set(Object.values(verifyFields).flat())],
  state: ['slot', 'op', ...STATE_ARGS, 'onError']
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
// skip and iteration decisions are. Wait delays are schema literals, so there is nothing to taint; a signal wait's output (and
// so whatever reads its outcome) carries its declared label joined with the labels of what its correlation keys and its `at`
// are computed from (they decide which signal it takes and when it times out), and a wait whose onTimeout names a branch
// decides whether each direct dependent runs, so its label is control for them, as a predecessor's data is under onError.
// A map with failure "collect" turns termination into a skip: a failing body node ends only its item, the rest of the item
// does not run, and the run goes on with the failure recorded as an $error entry and a failed count. So inside such a body
// every label that can decide a body failure (each body node's failure label: its data for task, code, verify and agent
// nodes, an assert's checks, a nested fail_fast body's failures and acceptance) is control for the whole body, and the map's
// output carries those labels and the body's own acceptance (the runtime adds every label the item could read once an item
// has failed; the static label matches it). A nested collect map contains its own failures. Conservative: an effect that
// runs before every fallible body node (an ancestor of all of them) is controlled too.
// An agent's checks are read by the node: a failed check escalates, resamples or fails it, so the labels of what its checks
// read (other than its own output) join its data label, quarantined or not; a quarantine declassifies only its inputs.
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
    // fail: the join of every label that decides whether a node of this flow fails (each node's failure label, below); failBy
    // names up to three of the nodes it comes from.
    let fail = TRUSTED;
    const failBy = [], failing = (label, why) => { if (label === TRUSTED) return; fail = joinLabels([fail, label]); if (failBy.length < 3) failBy.push(why()); };
    const visit = id => {
      if (outs.has(id)) return;
      outs.set(id, TRUSTED); data.set(id, TRUSTED); control.set(id, NO_CONTROL);
      const node = byId.get(id);
      for (const dep of node.needs) visit(dep);
      const own = { ...scope, ...outEntries(outs) };
      let nodeControl = joinControl([pc, controlFrom(node.when ? labelOf(node.when, own) : TRUSTED, () => `${node.id} is guarded by a when that reads ${untrustedRefs(node.when, own)}`),
        ...((node.join ?? 'all_success') === 'all_success' ? node.needs.map(dep => {
          const through = joinControl([control.get(dep), byId.get(dep).onError === 'continue' ? controlFrom(data.get(dep), () => `${dep} continues on error over ${data.get(dep)} data`)
            : routeOf(byId.get(dep)) ? controlFrom(data.get(dep), () => `${dep} routes its timeout over ${data.get(dep)} data`) : NO_CONTROL]);
          return through.label === TRUSTED ? through : { label: through.label, via: through.via.map(step => `${node.id} needs ${dep} <- ${step}`.slice(0, 300)) };
        }) : [])]);
      // label: the node's data label. failure: what decides whether the node fails, beyond its control label (a when that cannot be
      // evaluated fails the node): its data for task, code, verify and agent nodes, the checks of an assert, the items, input and
      // initial of a map or loop, and the failure and acceptance of a body whose failure propagates (not of a collect body).
      let label = TRUSTED, failure = TRUSTED;
      const inputs = () => joinLabels((node.context?.inputs ?? []).map(spec => joinLabels([spec.label ?? TRUSTED, Object.hasOwn(spec, 'ref') ? inheritedLabel(spec.ref, own) : TRUSTED])));
      if (node.kind === 'agent') label = joinLabels([node.quarantined === true ? TRUSTED : inputs(), labelOf(bindOutput(node.checks ?? []), own)]);
      else if (node.kind === 'assert') failure = labelOf(node.checks, own);
      else if (node.kind === 'verify') label = joinLabels([labelOf(node.subject, own), labelOf(node.args ?? null, own), labelOf(node.ledger?.inventory ?? null, own), inputs(),
        node.method === 'capability' ? registry?.get(node.tool)?.outputLabel ?? TRUSTED : TRUSTED]);
      // A task's output carries its arguments' label joined with the capability's declared output label (capabilities.mjs).
      else if (node.kind === 'task') label = joinLabels([labelOf(node.args ?? null, own), registry?.get(node.tool)?.outputLabel ?? TRUSTED]);
      else if (node.kind === 'code') label = labelOf(node.args ?? null, own);
      else if (isSignalWait(node) || node.at !== undefined) label = joinLabels([node.label ?? TRUSTED, labelOf(node.at ?? null, own), ...correlateTemplates(node).map(t => labelOf(t, own))]);
      else if (node.kind === 'state') {
        // A read carries the slot's label (what earlier runs wrote) and its key's; a write may not carry more taint than the slot's label, in
        // its data or in what decided that it runs, or a later run would read untrusted data as trusted.
        const slotLabel = slotOf(workflow, node.slot)?.label ?? TRUSTED, argsLabel = labelOf(stateArgs(node), own);
        label = joinLabels([slotLabel, argsLabel]);
        const flowing = joinLabels([argsLabel, nodeControl.label]);
        if (isStateWrite(node.op) && joinLabels([slotLabel, flowing]) !== slotLabel) findings.push(
          { code: 'LABEL_POLICY', message: stateLabelMessage(node.slot, slotLabel, flowing, nodeControl.via), location: `${prefix}.${node.id}`, extra: { rule: 'UNTRUSTED_STATE_WRITE', label: flowing } },
          { code: 'UNTRUSTED_STATE_WRITE', message: stateLabelMessage(node.slot, slotLabel, flowing, nodeControl.via), location: `${prefix}.${node.id}` });
      }
      else if (node.body) {
        const input = Object.hasOwn(node, 'input') ? entry('input', labelOf(node.input, own)) : only(own, 'input');
        const bodyPrefix = `${prefix}.${node.id}.body`;
        if (node.kind === 'map') {
          const items = labelOf(node.items, own), childScope = { ...input, ...entry('item', items) };
          const base = joinControl([nodeControl, controlFrom(items, () => `map ${node.id} iterates over ${untrustedRefs(node.items, own)}`)]);
          let collected = NO_CONTROL, child = walk(node.body, childScope, bodyPrefix, base);
          if (node.failure === 'collect') {
            // The body's control includes what decides a body failure, and the body's labels depend on its control: a fixpoint.
            for (let pass = 0; ; pass++) {
              const decides = child.fail, known = joinLabels([base.label, collected.label]);
              if (joinLabels([known, decides]) === known) break;
              if (pass >= FIXPOINT_PASSES) throw new FoundryError('TAINT_FIXPOINT', `Label analysis of map ${node.id} did not converge in ${FIXPOINT_PASSES} passes`);
              collected = joinControl([collected, controlFrom(decides, () => `map ${node.id} collects item failures, so a body failure over ${decides} data stops the rest of its item and the run goes on (${child.failBy.join('; ')}); fail_fast would end the run instead`.slice(0, 300))]);
              child = walk(node.body, childScope, bodyPrefix, joinControl([base, collected]));
            }
          }
          findings.push(...child.findings);
          failure = joinLabels([items, Object.hasOwn(node, 'input') ? labelOf(node.input, own) : TRUSTED, ...(node.failure === 'collect' ? [] : [child.fail, child.accept])]);
          label = node.failure === 'collect' ? joinLabels([items, child.label, child.fail, child.accept, ...Object.values(childScope)]) : joinLabels([items, child.label]);
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
          failure = joinLabels([labelOf(node.initial, own), Object.hasOwn(node, 'input') ? labelOf(node.input, own) : TRUSTED, child.fail, child.accept]);
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
      if (['task', 'code', 'verify', 'agent', 'state'].includes(node.kind) || (isSignalWait(node) && timeoutMode(node) === 'fail')) failure = joinLabels([failure, label]);
      // Any wait fails over what its timer and keys are computed from (WAIT_AT, WAIT_DEADLINE, WAIT_KEY when it starts), whatever its onTimeout.
      else if (node.kind === 'wait') failure = joinLabels([failure, labelOf(node.at ?? null, own), ...correlateTemplates(node).map(t => labelOf(t, own))]);
      failing(joinLabels([failure, nodeControl.label]), () => node.kind === 'assert' && failure !== TRUSTED ? `assert ${node.id} reads ${untrustedRefs(node.checks, own)}` : `${node.id} can fail over ${joinLabels([failure, nodeControl.label])} data`);
    };
    for (const id of byId.keys()) visit(id);
    // accept: the label of this flow's acceptance, which decides whether the flow (a map item, a loop iteration) fails.
    const accept = labelOf(flow.acceptance ?? [], { ...scope, ...outEntries(outs) });
    const result = { label: joinLabels([...outs.values()]), outs, findings, fail, failBy, accept };
    memo.get(flow).set(memoKey, result);
    return result;
  };
  for (const { code, message, location, extra } of walk(workflow, { ...(workflow.labels ?? {}) }, 'workflow', NO_CONTROL).findings) report(code, message, location, extra);
}

// Wait nodes (src/signals.mjs): a timer (delayMs or the absolute at) or a signal wait (signal or race, with one timer: timeoutMs or
// at; an unbounded wait is refused, L0). `signalSchemas` collects the payload schemas each signal name is declared with: one name has
// one payload type in a workflow, because a delivery is validated before any wait takes it.
// A literal timeoutMs at or above the workflow's maxDurationMs can never be honoured: the wait starts after the run did, so its timer
// falls at or after the run deadline and the runtime refuses it when it starts (WAIT_DEADLINE); it is refused here first.
function checkWait(node, at, add, signalSchemas, budget) {
  const has = key => Object.hasOwn(node, key), shape = message => add('WAIT_SHAPE', message, at);
  if (typeof node.at === 'string' || typeof node.at === 'number') try { parseAt(node.at); } catch (e) { add(e.code ?? 'WAIT_AT', e.message, `${at}.at`); }
  if (isSignalWait(node) && Number.isSafeInteger(node.timeoutMs) && Number.isSafeInteger(budget?.maxDurationMs) && node.timeoutMs >= budget.maxDurationMs)
    add('WAIT_DEADLINE', `timeoutMs ${node.timeoutMs} is not below the workflow's budget.maxDurationMs ${budget.maxDurationMs}: the timer would fall after the run deadline; raise maxDurationMs (and the runtime policy's) or shorten the timer`, `${at}.timeoutMs`);
  if (!isSignalWait(node)) {
    if (has('delayMs') === has('at')) shape('A timer wait has exactly one of delayMs (relative) or at (absolute)');
    for (const key of ['timeoutMs', 'correlate', 'schema', 'onTimeout', 'label']) if (has(key)) shape(`${key} belongs to a signal wait (signal or race)`);
    return;
  }
  if (has('signal') && has('race')) shape('A signal wait has one signal or a race, not both');
  if (has('delayMs')) shape('A signal wait times out with timeoutMs or at, not delayMs');
  if (has('timeoutMs') && has('at')) shape('A signal wait has one timer: timeoutMs or at');
  if (!has('timeoutMs') && !has('at')) add('WAIT_UNBOUNDED', 'A signal wait needs a timer (timeoutMs or at); a wait with no timeout is refused', at);
  if (has('race') && (has('correlate') || has('schema'))) shape('A race declares correlate and schema on each raced signal, not on the wait');
  const subscriptions = subscriptionsOf(node), names = subscriptions.map(s => s.signal);
  if (new Set(names).size !== names.length) shape('A race names each signal once');
  subscriptions.forEach((s, index) => {
    if (s.schema !== undefined) try { compileDataSchema(s.schema); } catch (e) { add(e.code ?? 'INVALID_SCHEMA', e.message, `${has('race') ? `${at}.race.${index}` : at}.schema`); }
    const seen = signalSchemas.get(s.signal) ?? new Map();
    seen.set(digest(s.schema ?? null), at); signalSchemas.set(s.signal, seen);
  });
}
// onTimeout naming a node: that node is the timeout branch, so it must be a node of the same flow that needs the wait and joins
// all_success (an all_resolved join runs whatever the wait's outcome).
function checkWaitRoute(node, byId, at, add) {
  const target = isSignalWait(node) ? routeOf(node) : null;
  if (!target) return;
  const branch = byId.get(target);
  if (!branch || target === node.id || !branch.needs.includes(node.id)) add('WAIT_ROUTE', `onTimeout names ${target}, which must be a node of the same flow that needs ${node.id}`, at);
  else if ((branch.join ?? 'all_success') !== 'all_success') add('WAIT_ROUTE', `${target} joins all_resolved, so it would run whatever ${node.id}'s outcome; a timeout branch joins all_success`, at);
}

// strict: also run the construction lint (lint.mjs). Its error findings make the workflow invalid, its warnings are
// appended to `warnings`, and the structured report is returned as `lint`. Default validation is unchanged.
// principals: the host's role matrix (src/principals.mjs roleMatrix, or a constitution document). With it, a workflow whose human nodes and
// segregation rules can never be satisfied by the principals it lists is invalid (SOD_UNSATISFIABLE, PRINCIPAL_ROLE_UNHELD); without it only
// the structure of principals and segregation rules is checked. Workflows without principals are unaffected either way.
// Data handles: the shape of an author-written {"$read": ..., "as": ..., "maxBytes": ...} in task or code args (runtime.mjs readArgs).
const READ_AS = ['text', 'json', 'lines'];
function readProblems(template, at = 'args', out = []) {
  if (Array.isArray(template)) { template.forEach((v, i) => readProblems(v, `${at}[${i}]`, out)); return out; }
  if (!template || typeof template !== 'object' || Object.hasOwn(template, '$ref')) return out;
  if (Object.hasOwn(template, '$read')) {
    const extra = Object.keys(template).filter(k => !['$read', 'as', 'maxBytes'].includes(k));
    if (extra.length) out.push(`${at}: a $read takes only $read, as and maxBytes (found ${extra.join(', ')})`);
    if (template.as !== undefined && !READ_AS.includes(template.as)) out.push(`${at}: as must be one of ${READ_AS.join(', ')}`);
    if (template.maxBytes !== undefined && !(Number.isSafeInteger(template.maxBytes) && template.maxBytes >= 1 && template.maxBytes <= BLOB_LIMITS.maxReadBytes)) out.push(`${at}: maxBytes must be an integer from 1 to ${BLOB_LIMITS.maxReadBytes}`);
    const target = template.$read;
    if (!target || typeof target !== 'object' || Array.isArray(target) || !(Object.hasOwn(target, '$ref') || isHandle(target))) out.push(`${at}: $read must be a reference to a blob handle or view, or a handle`);
    return out;
  }
  for (const [k, v] of Object.entries(template)) readProblems(v, `${at}.${k}`, out);
  return out;
}

export function validateWorkflow(workflow, { registry, maxNodes = 2000, modelPolicy = null, strict = false, principals = null } = {}) {
  const errors = [], warnings = [];
  try { checkData(workflow); } catch (e) { return { valid: false, errors: [{ code: e.code, message: e.message }], warnings }; }
  if (!shape(workflow)) return { valid: false, errors: shape.errors.map(e => ({ code: 'SCHEMA', path: e.instancePath, message: `${e.message} ${JSON.stringify(e.params)}` })), warnings };
  let total = 0;
  const add = (code, message, location, extra = {}) => errors.push({ code, message, path: location, ...extra });
  const signalSchemas = new Map();
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
  // State nodes (src/state.mjs). Writers are collected per slot: only the nodes its declaration names write a slot, each from one place.
  const stateWriters = new Map(), writersOf = slot => [slot.writer].flat();
  const literal = template => { try { return references(template).length === 0; } catch { return false; } };
  const checkStateNode = (node, at) => {
    const slot = slotOf(workflow, node.slot);
    if (!slot) add('STATE_SLOT_UNKNOWN', `State slot ${node.slot} is not declared in the workflow's state`, at);
    else if (!STATE_OPS[slot.type]?.includes(node.op)) add('STATE_OP', `${node.op} is not an operation of a ${slot.type} slot (${STATE_OPS[slot.type]?.join(', ')})`, at);
    else if (slot.monotonic === true && node.op === 'delete') add('STATE_OP', `Slot ${node.slot} is a monotonic cursor: a delete would let it move back, so it has none`, at);
    if (isStateWrite(node.op)) {
      stateWriters.set(node.slot, [...(stateWriters.get(node.slot) ?? []), { id: node.id, at }]);
      if (slot && !writersOf(slot).includes(node.id)) add('STATE_WRITER', `${node.id} writes slot ${node.slot}, whose declared writer${writersOf(slot).length === 1 ? ' is' : 's are'} ${writersOf(slot).join(', ')}`, at);
    }
    for (const name of STATE_ARGS) if (Object.hasOwn(node, name) && !STATE_OP_ARGS[node.op].includes(name)) add('WRONG_NODE_FIELD', `${name} does not belong to a state ${node.op}`, at);
    if (node.op === 'put' && !Object.hasOwn(node, 'value')) add('STATE_VALUE_REQUIRED', 'A state put needs a value', at);
    // An overwrite names the version it read, so two writers of one key cannot both succeed (0: the key must be absent).
    if (node.op === 'put' && !Object.hasOwn(node, 'ifVersion')) add('STATE_CAS_REQUIRED', 'A state put overwrites its key, so it names the version it read (ifVersion; 0 when the key must be absent)', at);
    // Literal arguments are checked now; computed ones when the node runs (a refusal then).
    if (literal(node.key) && (typeof node.key !== 'string' || !node.key || !node.key.isWellFormed() || Buffer.byteLength(node.key) > STATE_LIMITS.keyBytes)) add('STATE_KEY', `A state key is a non-empty, well-formed string of at most ${STATE_LIMITS.keyBytes} bytes`, `${at}.key`);
    if (Object.hasOwn(node, 'by') && literal(node.by) && !Number.isSafeInteger(node.by)) add('STATE_SCHEMA', 'A counter increment is a safe integer', `${at}.by`);
    if (Object.hasOwn(node, 'ifVersion') && literal(node.ifVersion) && !(Number.isSafeInteger(node.ifVersion) && node.ifVersion >= 0)) add('STATE_SCHEMA', 'ifVersion is a non-negative integer', `${at}.ifVersion`);
    if (slot && node.op === 'put' && Object.hasOwn(node, 'value') && literal(node.value)) {
      if (slot.type === 'counter') { if (!Number.isSafeInteger(node.value)) add('STATE_SCHEMA', 'A counter holds a safe integer', `${at}.value`); }
      else if (slot.schema) try { validateData(slot.schema, node.value, `state ${node.slot} value`); } catch (e) { add(e.code === 'SCHEMA_MISMATCH' ? 'STATE_SCHEMA' : (e.code ?? 'STATE_SCHEMA'), e.message, `${at}.value`); }
      if (slot.monotonic === true && ((slot.order ?? 'number') === 'instant' ? instantNanos(node.value) === null : !(typeof node.value === 'number' && Number.isFinite(node.value))))
        add('STATE_SCHEMA', `A monotonic cursor in order ${slot.order ?? 'number'} holds ${(slot.order ?? 'number') === 'instant' ? 'ISO 8601 date-times with an explicit offset' : 'numbers'}`, `${at}.value`);
    }
    if (node.onError === 'continue') warnings.push({ code: 'ERROR_CONTINUATION', path: at, message: 'Independent acceptance must detect failures hidden by continuation' });
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
      if (node.kind === 'task' || node.kind === 'code') for (const problem of readProblems(node.args)) add('BLOB_READ', problem, `${prefix}.${node.id}`);
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
      if (node.kind === 'wait') checkWait(node, `${prefix}.${node.id}`, add, signalSchemas, workflow.budget);
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
      if (node.kind === 'state') checkStateNode(node, at);
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
      // Schemas are not templates (a JSON schema's own $ref is not a data reference): a wait's payload schemas are left out.
      const { body, until, answerSchema, returns, context, instructions, source, model, decoding, escalation, schema, ...own } = node;
      if (node.kind === 'wait' && Array.isArray(own.race)) own.race = own.race.map(({ schema: _, ...rest }) => rest);
      if (node.kind === 'wait') checkWaitRoute(node, byId, `${prefix}.${node.id}`, add);
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
  for (const [name, schemas] of signalSchemas) if (schemas.size > 1) add('SIGNAL_SCHEMA_CONFLICT', `Signal ${name} is declared with ${schemas.size} different payload schemas (${[...new Set(schemas.values())].join(', ')}); one signal name has one payload schema`, 'workflow');
  for (const [name, slot] of Object.entries(workflow.state ?? {})) {
    if (slot.schema) try { compileDataSchema(slot.schema); } catch (e) { add(e.code ?? 'INVALID_SCHEMA', e.message, `state.${name}.schema`); }
    // A monotonic cursor compares in one declared order and is never reset: no TTL (an expired cursor would restart anywhere), no delete.
    if (slot.order !== undefined && slot.monotonic !== true) add('STATE_MONOTONIC', `Slot ${name} declares an order but is not a monotonic cursor`, `state.${name}`);
    if (slot.monotonic === true) {
      const order = slot.order ?? 'number', types = [slot.schema?.type ?? []].flat();
      if (!CURSOR_ORDERS.includes(order)) add('STATE_MONOTONIC', `Slot ${name}: a cursor order is one of ${CURSOR_ORDERS.join(', ')}`, `state.${name}.order`);
      if (slot.ttlMs !== undefined || slot.ttlDays !== undefined) add('STATE_MONOTONIC', `Slot ${name} is a monotonic cursor: it never expires (a TTL would let it restart behind its position)`, `state.${name}`);
      const allowed = order === 'instant' ? ['string'] : ['number', 'integer'];
      if (!types.length || types.some(type => !allowed.includes(type))) add('STATE_MONOTONIC', `Slot ${name} is a monotonic cursor in order ${order}: its schema type is ${order === 'instant' ? '"string" (ISO 8601 date-times with an explicit offset)' : '"number" or "integer"'}`, `state.${name}.schema`);
    }
    const writers = stateWriters.get(name) ?? [];
    for (const id of writersOf(slot)) {
      const places = writers.filter(w => w.id === id).map(w => w.at);
      if (!places.length) add('STATE_WRITER', `Slot ${name} names ${id} as a writer, but no state node ${id} writes it`, `state.${name}`);
      else if (places.length > 1) add('STATE_WRITER', `Writer ${id} of slot ${name} is one node, but ${places.length} nodes of that id write it (${places.join(', ')})`, `state.${name}`);
    }
  }
  if (workflow.inputSchema) try { compileDataSchema(workflow.inputSchema); } catch (e) { add(e.code ?? 'INVALID_SCHEMA', e.message, 'inputSchema'); }
  // Principals and segregation of duties (compromise D1, src/principals.mjs).
  let principalAssignment;
  for (const p of principalProblems(workflow)) add(p.code, p.message, p.path);
  if (principals && !errors.some(e => e.code === 'SOD_NODE')) {
    let matrix = null;
    try { matrix = principals.hash && principals.roles instanceof Set ? principals : roleMatrix(principals); } catch (e) { add(e.code ?? 'PRINCIPALS_INVALID', e.message, 'principals'); }
    if (matrix) {
      const solved = satisfiability(workflow, matrix);
      for (const { severity, ...p } of solved.problems) (severity === 'error' ? errors : warnings).push({ code: p.code, message: p.message, path: p.path });
      principalAssignment = solved.assignment;
    }
  }
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
  return { valid: errors.length === 0, errors, warnings, nodeCount: total, ...(strict ? { strict: true, lint } : {}), ...(errors.length ? {} : { hash: digest(workflow) }),
    ...(principalAssignment && Object.keys(principalAssignment).length ? { principalAssignment } : {}) };
}

export function requireWorkflow(workflow, options) {
  const result = validateWorkflow(workflow, options);
  if (!result.valid) throw new FoundryError('INVALID_WORKFLOW', 'Workflow validation failed', result.errors);
  return result;
}
