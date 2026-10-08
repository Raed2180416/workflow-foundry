// The injected causes of F1's exec-injected family (JUDGE-PROGRAM.md §1.2 F1 "Families"): one recipe per way a tiny
// Foundry workflow node fails for a given cause. A recipe says how the cause is injected (the fault the World
// applies, the core node, the contract), never what the healer will conclude: the label is the outcome of the
// healer's checks (exec/healer.mjs), cross-checked against `cause`.
//
//   flake       a transient outage (ECONNRESET and kin) that is over when the healer replays the node
//   variance    a scripted model whose answer is wrong on 30-60% of samples, caught by a node check or an assert
//   defect      the workflow's own logic is wrong: a dangling reference, a bad argument, a code node reading a missing
//               key (Python KeyError, JavaScript TypeError), a comparison across types, a result outside its schema
//   env         the environment changed: a service down, a helper module deleted, an output directory that stopped being
//               one, a full disk, a credential gone, the model gateway down
//   impossible  a contract that nothing can satisfy: contradictory checks, an unsatisfiable acceptance, an empty schema
//   finding     the system under test misbehaves on the build under test and not on the previous build
import { MODEL_DOWN, MODEL_TRANSIENT, MISSING_FIELDS, PERSISTENT_DOWN, PY_DEFECTS, JS_DEFECTS, STORE_TRANSIENT, TRANSIENT } from './vocab.mjs';
import { SUT_CRASHES } from './sut.mjs';
import { APP_ROOT } from './world.mjs';
import { R } from './workflow.mjs';

export const CAUSES = Object.freeze(['flake', 'variance', 'defect', 'env', 'impossible', 'finding']);
export const mkErr = (code, message) => Object.assign(new Error(message), { code });
const task = (id, needs, description, tool, args, extra = {}) => ({ id, kind: 'task', needs, description, tool, args, timeoutMs: 3000, retry: { maxAttempts: 1, backoffMs: 0 }, ...extra });
const withRetry = (P, extra = {}) => ({ retry: { maxAttempts: P.A, backoffMs: 0 }, ...extra });
const rowsRef = c => (c.inMap ? R('item') : R(`${c.P}.rows`));
const codeNode = (c, lang, source, extra = {}) => ({ id: c.id, kind: 'code', needs: c.needs, description: 'Compute a derived value from the rows', lang, source, timeoutMs: 20000,
  args: { rows: R(`${c.P}.rows`), total: R(`${c.P}.total`), source: R(`${c.P}.source`) }, ...extra });
const fill = (src, vars) => src.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
const agentCore = (c, P, checks) => ({ id: c.id, kind: 'agent', needs: c.needs, description: 'Choose a label for the batch', role: 'classify', instructions: P.instruction,
  returns: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { enum: P.labels } } }, model: { class: 'M' },
  context: { inputs: [{ name: c.inMap ? 'row' : 'rows', ref: c.inMap ? 'item' : `${c.P}.rows` }], history: 'none' }, escalation: { schemaRetries: 0, onCheckFail: 'fail' }, ...(checks ? { checks } : {}) });

// contradictory contracts over a number x and a string s (assert checks)
function contradictions(P, x, s) {
  const T = P.payload.rows.reduce((a, r) => a + r.amount, 0), hi = T + P.rnd.int('hi', 20, 200);
  return [
    () => [{ op: 'gt', left: x, right: hi }, { op: 'lt', left: x, right: hi - P.rnd.int('d', 1, 15) }],
    () => [{ op: 'eq', left: x, right: hi }, { op: 'eq', left: x, right: hi + P.rnd.int('d2', 1, 9) }],
    () => [{ op: 'gte', left: x, right: hi }, { op: 'lte', left: x, right: P.rnd.int('lo', 0, 9) }],
    () => [{ op: 'in', left: x, right: [hi, hi + 2] }, { op: 'in', left: x, right: [hi + 1, hi + 3] }],
    () => [{ op: 'eq', left: s, right: 'orders' }, { op: 'eq', left: s, right: 'tickets' }],
    () => [{ op: 'contains', left: s, right: P.payload.source.slice(0, 3) }, { op: 'not', condition: { op: 'contains', left: s, right: P.payload.source.slice(0, 3) } }],
  ];
}

export const RECIPES = {
  // ---- flake ----------------------------------------------------------------------------------------------------------
  'flake.fetch': {
    cause: 'flake', weight: 5, kind: 'task', label: 'task:fetch', mapOk: true, persistence: 'transient',
    build(P) {
      const t = P.rnd.pick('t', TRANSIENT), svc = P.svc;
      return {
        fault: { type: 'transient', cap: 'fetch', length: P.A * (P.knobs.longOutage ? 4 : 1), make: () => mkErr(t.code, t.msg(svc)) },
        scope: [`service ${svc.name}`],
        core: c => [task(c.id, c.needs, `Fetch rows from ${svc.name}`, 'fx.fetch', c.inMap ? { source: R('item.source'), count: 1 } : { source: c.plan.payload.source, count: c.plan.payload.rows.length }, withRetry(P))],
      };
    },
  },
  'flake.store': {
    cause: 'flake', weight: 2, kind: 'task', label: 'task:store', mapOk: true, persistence: 'transient',
    build(P) {
      const t = P.rnd.pick('t', STORE_TRANSIENT), svc = P.svc, name = P.rnd.pick('n', ['state', 'queue', 'cache', 'index']);
      return {
        fault: { type: 'transient', cap: 'store', length: P.A * (P.knobs.longOutage ? 4 : 1), make: () => mkErr(t.code, t.msg({ ...svc, name })) },
        scope: [`service ${svc.name}`],
        core: c => [task(c.id, c.needs, 'Read the batch from the state store', 'fx.store', { key: name, count: 3 }, withRetry(P))],
      };
    },
  },
  'flake.model': {
    cause: 'flake', weight: 3, kind: 'agent', label: 'agent', persistence: 'transient',
    build(P) {
      const t = P.rnd.pick('t', MODEL_TRANSIENT);
      return {
        fault: { type: 'transient', cap: 'agent', length: P.knobs.longOutage ? 4 : 1, make: () => mkErr(t.code, t.msg(P.gateway)) },
        scope: ['service model_gateway'], models: [[P.ids.core, { kind: 'transient', labels: P.labels, truth: P.truth }]],
        core: c => [agentCore(c, P)],
      };
    },
  },
  // ---- variance -------------------------------------------------------------------------------------------------------
  'variance.agent': {
    cause: 'variance', weight: 5, kind: 'agent', label: 'agent', mapOk: true, persistence: 'stochastic',
    build(P) {
      return {
        fault: { type: 'stochastic', cap: 'agent' }, scope: ['service model_gateway'],
        models: [[P.ids.core, { kind: 'stochastic', labels: P.labels, truth: P.truth, p: P.pFail }]],
        core: c => [agentCore(c, P, [{ op: 'eq', left: R('output.label'), right: P.truth }])],
      };
    },
  },
  'variance.gate': {
    cause: 'variance', weight: 4, kind: 'assert', label: 'assert', forceTail: 'agent-stochastic', persistence: 'stochastic',
    build(P) {
      const agentId = P.ids.up.at(-1);
      return {
        fault: { type: 'stochastic', cap: 'agent' }, scope: [],
        models: [[agentId, { kind: 'stochastic', labels: P.labels, truth: P.truth, p: P.pFail }]],
        core: c => [{ id: c.id, kind: 'assert', needs: c.needs, description: 'The batch must carry the expected label', checks: [{ op: 'eq', left: R(`nodes.${agentId}.label`), right: P.truth }] }],
        contract: [{ type: 'condition', cond: { op: 'eq', left: R(`nodes.${agentId}.label`), right: P.truth } }],
      };
    },
  },
  // ---- defect ---------------------------------------------------------------------------------------------------------
  'defect.wiring': {
    cause: 'defect', weight: 3, kind: 'task', label: 'task:identity', mapOk: true, persistence: 'persistent',
    build(P) {
      const bad = P.rnd.pick('f', MISSING_FIELDS);
      return {
        fault: { type: 'none' }, scope: [],
        core: c => [task(c.id, c.needs, 'Carry the items forward', 'core.identity', { items: c.inMap ? R(c.fixed ? 'item.id' : `item.${bad}`) : R(c.fixed ? `${c.P}.rows` : `${c.P}.${bad}`) })],
      };
    },
  },
  'defect.args': {
    cause: 'defect', weight: 2, kind: 'task', label: 'task:aggregate', persistence: 'persistent',
    build(P) {
      const op = P.rnd.pick('op', ['median', 'avg', 'mean', 'average', 'product', 'count_distinct']);
      return { fault: { type: 'none' }, scope: [],
        core: c => [task(c.id, c.needs, 'Aggregate the amounts', 'core.aggregate', { operation: c.fixed ? 'sum' : op, values: R(`${c.P}.rows`), field: 'amount' })] };
    },
  },
  'defect.template': {
    cause: 'defect', weight: 2, kind: 'task', label: 'task:template', persistence: 'persistent',
    build(P) {
      const miss = P.rnd.pick('v', ['city', 'owner', 'region', 'currency', 'customer', 'batch_id']);
      return { fault: { type: 'none' }, scope: [],
        core: c => [task(c.id, c.needs, 'Render the notification text', 'core.template', { text: `Batch {{src}} for {{${miss}}} holds {{total}} units`,
          variables: { src: R(`${c.P}.source`), total: R(`${c.P}.total`), ...(c.fixed ? { [miss]: 'all' } : {}) } })] };
    },
  },
  'defect.aggregate': {
    cause: 'defect', weight: 2, kind: 'task', label: 'task:aggregate', persistence: 'persistent',
    build() {
      return { fault: { type: 'none' }, scope: [],
        core: c => [task(c.id, c.needs, 'Sum the amount column', 'core.aggregate', { operation: 'sum', values: R(`${c.P}.rows`), ...(c.fixed ? { field: 'amount' } : {}) })] };
    },
  },
  'defect.condition': {
    cause: 'defect', weight: 2, kind: 'assert', label: 'assert', persistence: 'persistent',
    build() {
      return { fault: { type: 'none' }, scope: [],
        core: c => [{ id: c.id, kind: 'assert', needs: c.needs, description: 'The batch must be big enough',
          checks: [{ op: 'gt', left: c.fixed ? R(`${c.P}.total`) : R(`${c.P}.source`), right: 0 }] }] };
    },
  },
  'defect.py': {
    cause: 'defect', weight: 5, kind: 'code', label: 'code:python', sandbox: true, persistence: 'persistent',
    build(P) {
      const t = P.rnd.pick('t', PY_DEFECTS), vars = { k: P.rnd.pick('k', MISSING_FIELDS), n: P.payload.rows.length + P.rnd.int('n', 1, 6), big: 100000 };
      return { fault: { type: 'none' }, scope: [],
        core: c => [codeNode(c, 'python', c.fixed ? 'def main(inp):\n    return {"total": inp["total"]}' : fill(t.src, vars))] };
    },
  },
  'defect.js': {
    cause: 'defect', weight: 3, kind: 'code', label: 'code:js', sandbox: true, persistence: 'persistent',
    build(P) {
      const t = P.rnd.pick('t', JS_DEFECTS), vars = { k: P.rnd.pick('k', MISSING_FIELDS) };
      return { fault: { type: 'none' }, scope: [],
        core: c => [codeNode(c, 'js', c.fixed ? 'export default (inp) => ({ total: inp.total });' : fill(t.src, vars))] };
    },
  },
  'defect.codeout': {
    cause: 'defect', weight: 2, kind: 'code', label: 'code:python', sandbox: true, persistence: 'persistent',
    build() {
      const returns = { type: 'object', additionalProperties: false, required: ['total'], properties: { total: { type: 'integer' } } };
      return { fault: { type: 'none' }, scope: [],
        core: c => [codeNode(c, 'python', c.fixed ? 'def main(inp):\n    return {"total": int(inp["total"])}' : 'def main(inp):\n    return {"total": str(inp["total"])}', { returns })] };
    },
  },
  // ---- env ----------------------------------------------------------------------------------------------------------------
  'env.service': {
    cause: 'env', weight: 5, kind: 'task', label: 'task:fetch', mapOk: true, persistence: 'persistent', needsPass: true,
    build(P) {
      const d = P.rnd.pick('d', PERSISTENT_DOWN), svc = P.svc;
      return {
        fault: { type: 'service', cap: 'fetch', facet: svc.name, make: () => mkErr(d.code, d.msg(svc)) }, scope: [`service ${svc.name}`],
        core: c => [task(c.id, c.needs, `Fetch rows from ${svc.name}`, 'fx.fetch', c.inMap ? { source: R('item.source'), count: 1 } : { source: c.plan.payload.source, count: c.plan.payload.rows.length }, withRetry(P))],
      };
    },
  },
  'env.store': {
    cause: 'env', weight: 2, kind: 'task', label: 'task:store', persistence: 'persistent', needsPass: true,
    build(P) {
      const d = P.rnd.pick('d', PERSISTENT_DOWN), svc = P.svc;
      return {
        fault: { type: 'service', cap: 'store', facet: svc.name, make: () => mkErr(d.code, d.msg(svc)) }, scope: [`service ${svc.name}`],
        core: c => [task(c.id, c.needs, 'Read the batch from the state store', 'fx.store', { key: 'state', count: 3 }, withRetry(P))],
      };
    },
  },
  'env.module': {
    cause: 'env', weight: 3, kind: 'task', label: 'task:module', persistence: 'persistent', needsPass: true,
    build(P) {
      const m = P.module;
      return { fault: { type: 'module', cap: 'module', facet: m }, scope: [`module ${m}`],
        core: c => [task(c.id, c.needs, `Load the ${m} helper`, 'fx.load_module', { module: m }, withRetry(P))] };
    },
  },
  'env.dir': {
    cause: 'env', weight: 3, kind: 'task', label: 'task:write', persistence: 'persistent', needsPass: true,
    build(P) {
      const d = P.dir, name = `report-${P.rnd.int('n', 1, 99)}.json`;
      return { fault: { type: 'dir', cap: 'write', facet: d }, scope: [`dir ${d}`],
        core: c => [task(c.id, c.needs, `Write the report into ${d}/`, 'fx.write_report', { dir: d, name, rows: R(`${c.P}.rows`) }, withRetry(P))] };
    },
  },
  'env.disk': {
    cause: 'env', weight: 2, kind: 'task', label: 'task:write', persistence: 'persistent', needsPass: true,
    build(P) {
      const d = P.dir, name = `report-${P.rnd.int('n', 1, 99)}.json`;
      return { fault: { type: 'disk', cap: 'write', facet: APP_ROOT }, scope: [`disk ${APP_ROOT}`],
        core: c => [task(c.id, c.needs, `Write the report into ${d}/`, 'fx.write_report', { dir: d, name, rows: R(`${c.P}.rows`) }, withRetry(P))] };
    },
  },
  'env.cred': {
    cause: 'env', weight: 3, kind: 'task', label: 'task:api', persistence: 'persistent', needsPass: true,
    build(P) {
      const cred = P.credential, svc = P.svc, m = P.rnd.pick('m', [
        () => mkErr('EAUTH', `HTTP 401 Unauthorized from ${svc.host}: credential ${cred} is not set`),
        () => mkErr('HTTP_401', `HTTP 401 Unauthorized: the ${cred} has expired or was revoked`),
        () => mkErr('AUTH_REQUIRED', `${svc.name}: missing credentials (${cred} is empty)`),
        () => mkErr('EAUTH', `HTTP 403 Forbidden from ${svc.host}: invalid token (${cred})`)]);
      return { fault: { type: 'credential', cap: 'api', facet: cred, make: m }, scope: [`credential ${cred}`, `service ${svc.name}`], apiCredential: cred,
        core: c => [task(c.id, c.needs, `Call the ${svc.name} API`, 'fx.call_api', { service: svc.name, op: 'sync', count: 3 }, withRetry(P))] };
    },
  },
  'env.model': {
    cause: 'env', weight: 3, kind: 'agent', label: 'agent', persistence: 'persistent', needsPass: true,
    build(P) {
      const d = P.rnd.pick('d', MODEL_DOWN);
      return { fault: { type: 'service', cap: 'agent', facet: 'model_gateway', make: () => mkErr(d.code, d.msg(P.gateway)) }, scope: ['service model_gateway'],
        models: [[P.ids.core, { kind: 'service', labels: P.labels, truth: P.truth }]], core: c => [agentCore(c, P)] };
    },
  },
  // ---- impossible --------------------------------------------------------------------------------------------------------
  'impossible.assert': {
    cause: 'impossible', weight: 6, kind: 'assert', label: 'assert', persistence: 'persistent',
    build(P) {
      const deployed = c => { const pick = contradictions(P, R(`${c.P}.total`), R(`${c.P}.source`)); return [...pick[P.rnd.int('c', 0, pick.length - 1)](), ...(P.rnd.chance('extra', 0.5) ? [{ op: 'gte', left: R(`${c.P}.total`), right: 0 }] : [])]; };
      const cache = new Map(), checksOf = c => { if (!cache.has(c.P)) cache.set(c.P, deployed(c)); return cache.get(c.P); };
      return { fault: { type: 'none' }, scope: [],
        core: c => [{ id: c.id, kind: 'assert', needs: c.needs, description: 'The batch must satisfy the delivery contract',
          checks: c.fixed ? [{ op: 'gte', left: R(`${c.P}.total`), right: 0 }] : checksOf(c) }],
        contractOf: c => checksOf(c).map(cond => ({ type: 'condition', cond })) };
    },
  },
  'impossible.accept': {
    cause: 'impossible', weight: 3, kind: 'workflow', label: 'workflow', targetRoot: true, persistence: 'persistent',
    build(P) {
      const cache = new Map(), pickOf = c => { if (!cache.has(c.P)) { const set = contradictions(P, R(`${c.P}.total`), R(`${c.P}.source`)); cache.set(c.P, set[P.rnd.int('c', 0, set.length - 1)]()); } return cache.get(c.P); };
      return { fault: { type: 'none' }, scope: [],
        core: c => [task(c.id, c.needs, 'Carry the totals forward', 'core.identity', { rows: R(`${c.P}.rows`), total: R(`${c.P}.total`), source: R(`${c.P}.source`) })],
        acceptance: c => pickOf(c), intendedAcceptance: c => [{ op: 'exists', value: R(`nodes.${c.id}`) }],
        contractOf: c => pickOf(c).map(cond => ({ type: 'condition', cond })) };
    },
  },
  'impossible.schema': {
    cause: 'impossible', weight: 2, kind: 'code', label: 'code:python', sandbox: true, persistence: 'persistent',
    build(P) {
      const hi = P.rnd.int('hi', 20, 90), schemas = [
        { type: 'object', additionalProperties: false, required: ['total'], properties: { total: { type: 'integer', minimum: hi, maximum: hi - P.rnd.int('d', 1, 9) } } },
        { type: 'object', additionalProperties: false, required: ['total', 'verdict'], properties: { total: { type: 'integer' } } }];
      const bad = schemas[P.rnd.int('s', 0, schemas.length - 1)], good = { type: 'object', additionalProperties: false, required: ['total'], properties: { total: { type: 'integer' } } };
      return { fault: { type: 'none' }, scope: [],
        core: c => [codeNode(c, 'python', 'def main(inp):\n    return {"total": int(inp["total"])}', { returns: c.fixed ? good : bad })],
        contractOf: c => [{ type: 'schema', schema: bad, node: c.id }] };
    },
  },
  // ---- finding ---------------------------------------------------------------------------------------------------------------
  'finding.assert': {
    cause: 'finding', weight: 5, kind: 'assert', label: 'assert', forceTail: 'sut', persistence: 'persistent',
    build(P) {
      const sutId = P.ids.up.at(-1), cond = { op: 'eq', left: R(`nodes.${sutId}.result`), right: P.sut.expected };
      return { fault: { type: 'sut' }, scope: [], sut: { crash: null },
        core: c => [{ id: c.id, kind: 'assert', needs: c.needs, description: `The ${P.sut.op} result must match the specification`, checks: [cond] }],
        contract: [{ type: 'condition', cond }] };
    },
  },
  'finding.verify': {
    cause: 'finding', weight: 3, kind: 'verify', label: 'verify', forceTail: 'sut', persistence: 'persistent',
    build(P) {
      const sutId = P.ids.up.at(-1), cond = { op: 'eq', left: R(`nodes.${sutId}.result`), right: P.sut.expected };
      return { fault: { type: 'sut' }, scope: [], sut: { crash: null },
        core: c => [{ id: c.id, kind: 'verify', needs: c.needs, description: `Check the ${P.sut.op} result against the specification`, method: 'capability', tool: 'fx.oracle', timeoutMs: 5000,
          args: { expected: P.sut.expected, result: R(`nodes.${sutId}.result`) }, subject: R(`nodes.${sutId}.result`), independence: 'execution' }],
        contract: [{ type: 'condition', cond }] };
    },
  },
  'finding.crash': {
    cause: 'finding', weight: 4, kind: 'task', label: 'task:sut', persistence: 'persistent',
    build(P) {
      const cr = P.rnd.pick('cr', SUT_CRASHES), code = P.rnd.pick('code', [undefined, undefined, 'SUT_ERROR', 'SUT_CRASH']);
      return { fault: { type: 'sut' }, scope: [], sut: { crash: { code, message: `${cr.name}: ${cr.msg}` } },
        core: c => [task(c.id, c.needs, `Call the system under test: ${P.sut.op}`, 'fx.sut', { op: P.sut.op, args: P.sut.args }, withRetry(P))] };
    },
  },
};
// ---- routed by code (never an F1 row): schema-invalid model output and budget exhaustion ------------------------------
Object.assign(RECIPES, {
  'routed.schema': {
    cause: 'routed', weight: 1, kind: 'agent', label: 'agent', persistence: 'persistent',
    build(P) {
      const bad = P.rnd.pick('bad', ['invalid', 'truncated', 'refusal']);
      return { fault: { type: 'none' }, scope: [], models: [[P.ids.core, { kind: bad, labels: P.labels, truth: P.truth }]], core: c => [agentCore(c, P)] };
    },
  },
  'routed.budget': {
    cause: 'routed', weight: 1, kind: 'task', label: 'task:identity', persistence: 'persistent',
    build() {
      return { fault: { type: 'none' }, scope: [], budget: { maxSteps: 2 },
        core: c => [task(c.id, c.needs, 'Carry the rows forward', 'core.identity', { rows: R(`${c.P}.rows`) })] };
    },
  },
});
export const RECIPE_IDS = Object.freeze(Object.keys(RECIPES));
export const recipesOf = cause => RECIPE_IDS.filter(id => RECIPES[id].cause === cause);
// the code that a plan of this recipe reaches the sandbox with (cost accounting and the sandbox gate)
export const usesSandbox = id => RECIPES[id].sandbox === true;
