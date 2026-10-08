// The plan of one scenario: a pure function of its key and cause. Cheap (no execution), so a generator can draw
// thousands of plans and keep only those whose workflow shape falls in a slice's skeleton bucket (§3.3).
import { skeletonBucket } from '../lib/hash.mjs';
import { AGENT_INSTRUCTIONS, BYSTANDER_FACETS, CREDENTIALS, DIRS, IDS, LABEL_SETS, MODULES, PAYLOAD_SOURCES, ROW_OWNERS, SERVICES } from './vocab.mjs';
import { RECIPES, recipesOf, usesSandbox } from './recipes.mjs';
import { sutCall, SUT_OP_NAMES } from './sut.mjs';
import { shapeId, shapeString, STAGE_TYPES } from './workflow.mjs';
import { makeRnd, sha } from './util.mjs';

export const EXEC_VERSION = 'exec@1';

const ROLE_OF_LABEL = { 'task:fetch': 'fetch', 'task:store': 'fetch', agent: 'agent', assert: 'gate', 'code:python': 'code', 'code:js': 'code', 'task:identity': 'ident', 'task:aggregate': 'agg',
  'task:template': 'tmpl', 'task:module': 'module', 'task:write': 'write', 'task:api': 'api', 'task:sut': 'sut', workflow: 'ident', verify: 'gate' };
const ROLE_OF_STAGE = { load: 'fetch', ident: 'ident', agg: 'agg', pluck: 'pluck', tmpl: 'tmpl', json: 'json', agent: 'agent', 'agent-stochastic': 'agent', gate: 'gate', sut: 'sut' };
const PAYLOAD_STAGES = new Set(['load', 'ident']);

function uniqueIds(rnd, wants) {
  const used = new Set(), out = [];
  wants.forEach(([role, tag], i) => {
    let id = rnd.pick(`id|${tag}`, IDS[role]);
    for (let k = 2; used.has(id); k++) id = `${rnd.pick(`id|${tag}`, IDS[role])}_${k}`;
    used.add(id); out.push(id);
  });
  return out;
}

// Earlier runs of the same node: a regime drawn independently of the cause (an env change needs a passing run to compare
// with; a persistent cause shows its passes before its failures). Returns { regime, n, pattern: 'PPFF', noiseCodes }.
export function drawPrior(rnd, { needsPass = false, persistent = false } = {}) {
  let regime = rnd.weighted('regime', [['fresh', 2], ['healthy', 3], ['mixed', 4], ['failing', 3]]);
  if (needsPass && (regime === 'fresh' || regime === 'failing')) regime = regime === 'fresh' ? 'healthy' : 'mixed';
  const n = regime === 'fresh' ? 0 : regime === 'healthy' ? rnd.int('np', 1, 5) : regime === 'mixed' ? rnd.int('np', 2, 6) : rnd.int('np', 1, 4);
  let pattern = regime === 'healthy' ? 'P'.repeat(n) : regime === 'failing' ? 'F'.repeat(n) : '';
  if (regime === 'mixed') {
    const a = rnd.int('npass', 1, n - 1);
    pattern = 'P'.repeat(a) + 'F'.repeat(n - a);
    if (!persistent) pattern = rnd.shuffle('pat', pattern.split('')).join('');
  }
  return { regime, n, pattern };
}

export function planScenario(key, { cause, recipe: only = null, noSandbox = false } = {}) {
  const rnd = makeRnd(key);
  const ids = recipesOf(cause).filter(id => !(noSandbox && usesSandbox(id)));
  if (!ids.length) throw new Error(`no recipe for cause ${cause}`);
  const recipeId = only ?? rnd.weighted('recipe', ids.map(id => [id, RECIPES[id].weight]));
  const def = RECIPES[recipeId];
  // environment: the service the node talks to, the model gateway, helper modules, credentials, output directories
  const svc = rnd.pick('svc', SERVICES.filter(s => s.name !== 'model_gateway')), gateway = SERVICES.find(s => s.name === 'model_gateway');
  const services = [svc, gateway, ...rnd.sample('svc2', SERVICES.filter(s => s !== svc && s !== gateway), 1)];
  const modules = rnd.sample('mods', MODULES, 3), credentials = rnd.sample('creds', CREDENTIALS, 2), dirs = rnd.sample('dirs', DIRS, 2);
  const bystanders = rnd.sample('by', BYSTANDER_FACETS, 3);
  const env = { services, modules, credentials, dirs, bystanders };
  // the fixture data
  const source = rnd.pick('source', PAYLOAD_SOURCES), nrows = rnd.int('nrows', 3, 6);
  const payload = { source, rows: Array.from({ length: nrows }, (_, i) => ({ id: `${source[0].toUpperCase()}-${rnd.int(`rid${i}`, 100, 899)}`, amount: rnd.int(`amt${i}`, 5, 120), owner: rnd.pick(`own${i}`, ROW_OWNERS), source })) };
  const labels = rnd.pick('labels', LABEL_SETS), truth = rnd.pick('truth', labels);
  // the shape
  const wrap = def.mapOk && rnd.chance('map', 0.2) ? 'map' : 'none';
  let nUp = rnd.weighted('nup', [[0, 1.2], [1, 2], [2, 2.4], [3, 1.6], [4, 0.8]]);
  if (def.forceTail) nUp = Math.max(1, nUp);
  const fork = nUp >= 2 && rnd.chance('fork', 0.18);
  const up = Array.from({ length: nUp }, (_, i) => {
    if (def.forceTail && i === nUp - 1) return { t: def.forceTail };
    let t = rnd.pick(`stage${i}`, STAGE_TYPES);
    if (fork && i === nUp - 1 && PAYLOAD_STAGES.has(t)) t = rnd.pick(`stageNP${i}`, ['agg', 'pluck', 'tmpl', 'agent', 'gate', 'json']);
    return { t };
  });
  const down = Array.from({ length: rnd.weighted('ndown', [[0, 1], [1, 2], [2, 1]]) }, (_, i) => rnd.pick(`down${i}`, ['json', 'gate']));
  const shape = { up, fork, wrap, coreLabel: def.label, down };
  const wants = [...up.map((s, i) => [ROLE_OF_STAGE[s.t], `up${i}`]), [ROLE_OF_LABEL[def.label] ?? 'code', 'core'], ['map', 'map'], ...down.map((_, i) => ['sink', `down${i}`])];
  const got = uniqueIds(rnd, wants);
  const idsOf = { up: got.slice(0, up.length), core: got[up.length], map: got[up.length + 1], down: got.slice(up.length + 2) };
  const prior = drawPrior(rnd, { needsPass: def.needsPass, persistent: def.persistence === 'persistent' });
  const plan = {
    version: EXEC_VERSION, key, cause, recipe: recipeId, kind: def.kind, shape, shapeStr: shapeString(shape), shapeId: shapeId(shape),
    ids: idsOf, env, payload, labels, truth, instruction: rnd.pick('instr', AGENT_INSTRUCTIONS), agentLabels: labels,
    svc, gateway, module: rnd.pick('module', modules), dir: rnd.pick('dir', dirs), credential: rnd.pick('cred', credentials),
    A: def.kind === 'task' ? rnd.weighted('A', [[1, 3], [2, 2], [3, 2]]) : 1, pFail: 0.3 + 0.3 * rnd.unit('pfail'),
    knobs: {
      longOutage: cause === 'flake' && rnd.chance('long', 0.03), scopeGap: cause === 'env' && rnd.chance('gap', 0.03), lateBreak: cause === 'env' && rnd.chance('late', 0.2),
      bystanderChange: cause !== 'env' && rnd.chance('bystander', 0.35),
    },
    prior,
    workflowId: `wf-${sha(`${key}|wf`).slice(0, 8)}`, title: `${source[0].toUpperCase()}${source.slice(1)} batch check`,
  };
  if (cause === 'finding') {
    const op = rnd.pick('op', SUT_OP_NAMES), s = sutCall(op, key);
    plan.sut = { op, args: s.args, expected: s.expected, buggy: s.buggy };
  }
  return plan;
}

// The slice's skeleton bucket of a plan's shape (§3.3: 0-20% test-ood, 20-30% dev-ood, 30-40% calib-ood, 40-100% train).
export const bucketOf = plan => skeletonBucket(plan.shapeId);
