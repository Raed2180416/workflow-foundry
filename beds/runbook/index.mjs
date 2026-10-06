// `runbook` bed: ops runbook execution as an interactive saga. See README.md for the contract,
// knobs, oracle pass rule and adversarial content. Trusted host code: agents never see the
// oracle, the hidden failure plan or the reference solver.
import { buildWorld, KNOBS, MAX_WAIT, WORLD_VERSION } from './world.mjs';
import { renderTicket, renderRunbook, renderInventory, renderChangeLog, renderPrompt, renderHandover, renderPostmortem, renderReleaseNotes, logInjections } from './render.mjs';
import { Sim, OPS } from './sim.mjs';
import { judge } from './judge.mjs';
import { referenceActions, unsafeGoalReached, skipCompensation, shuffled } from './solve.mjs';

export const family = {
  id: 'runbook',
  domain: 'ops runbook execution / sagas',
  version: WORLD_VERSION,
  kind: 'interactive',
  description: 'Execute a change ticket against a simulated site (LB pool, workers, primary/replica database, flags, config store, change window) by following a prose runbook with conditionals, safety rules and compensations; seeded transient/permanent failures; the episode record is replayed by the oracle.',
};

export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actions'],
  properties: {
    actions: {
      type: 'array',
      maxItems: 600,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op'],
        properties: {
          op: { type: 'string', enum: OPS },
          target: { type: 'string', maxLength: 200 },
          node: { type: 'string', maxLength: 100 },
          service: { type: 'string', maxLength: 100 },
          name: { type: 'string', maxLength: 200 },
          key: { type: 'string', maxLength: 200 },
          value: { type: ['string', 'number', 'boolean'], maxLength: 200 },
          seconds: { type: 'integer', minimum: 1, maximum: MAX_WAIT },
          reason: { type: 'string', maxLength: 1000 },
        },
      },
    },
  },
};

// Minimal validator for the portable subset used by outputSchema.
// Non-finite numbers (NaN, Infinity) are not JSON values and never match a number type (audit fix F3).
const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v === 'number' && !Number.isFinite(v) ? 'non-finite number' : typeof v;
export function schemaErrors(schema, value, path = '$', out = []) {
  if (out.length > 20) return out;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    const ok = types.some(x => x === t || (x === 'number' && t === 'integer'));
    if (!ok) { out.push(`${path}: expected ${types.join('|')}, got ${t}`); return out; }
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: not one of the allowed values`);
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${path}: longer than ${schema.maxLength}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => schemaErrors(schema.items, v, `${path}[${i}]`, out));
  }
  if (typeOf(value) === 'object') {
    for (const r of schema.required ?? []) if (!Object.hasOwn(value, r)) out.push(`${path}: missing ${r}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) schemaErrors(schema.properties[k], v, `${path}.${k}`, out);
      else if (schema.additionalProperties === false) out.push(`${path}: unexpected property ${k}`);
    }
  }
  return out;
}

function checkArgs(seed, split, difficulty) {
  if (!Number.isSafeInteger(seed) && typeof seed !== 'string') throw new Error('runbook: seed must be an integer or string');
  if (split !== 'dev' && split !== 'test') throw new Error("runbook: split must be 'dev' or 'test'");
  if (!KNOBS[difficulty]) throw new Error('runbook: difficulty must be 1..5');
}

export function makeWorld(seed, split, difficulty) {
  checkArgs(seed, split, difficulty);
  const world = buildWorld(seed, split, difficulty);
  world.seed = seed; world.split = split; world.difficulty = difficulty;
  world.spec.logInjection = logInjections(world, difficulty);
  return world;
}

export function generate({ seed, split = 'dev', difficulty = 3 }) {
  const world = makeWorld(seed, split, difficulty);
  const inputs = {
    ticket: renderTicket(world, difficulty),
    runbook: renderRunbook(world, difficulty),
    inventory: renderInventory(world, difficulty),
  };
  if (difficulty >= 3) inputs.releaseNotes = renderReleaseNotes(world, difficulty);
  if (world.K.handover) inputs.handover = renderHandover(world, difficulty);
  if (world.K.postmortem) inputs.postmortem = renderPostmortem(world, difficulty);
  if (world.K.changelog) inputs.changeLog = renderChangeLog(world, difficulty);
  return {
    id: `runbook/${split}/d${difficulty}/${seed}`,
    family: family.id,
    seed, split, difficulty,
    prompt: renderPrompt(world, difficulty),
    inputs,
    budget: { maxActions: world.K.budget },
  };
}

const worldOf = task => makeWorld(task.seed, task.split, task.difficulty);

export function oracle(task, output) {
  const world = worldOf(task);
  const errors = schemaErrors(outputSchema, output);
  if (errors.length) return { pass: false, score: 0, details: { schemaErrors: errors.slice(0, 10) } };
  if (output.actions.length > world.K.budget) return { pass: false, score: 0, details: { overBudget: true, actions: output.actions.length, budget: world.K.budget } };
  return judge(world, output.actions);
}

export function referenceSolve(task) {
  return referenceActions(worldOf(task));
}

export const badControls = [
  { name: 'empty', make: () => ({ actions: [] }) },
  { name: 'shuffled-or-corrupted', make: task => { const w = worldOf(task); return shuffled(w, referenceActions(w)); } },
  { name: 'goal-reached-unsafe', make: task => { const w = worldOf(task); return unsafeGoalReached(w, referenceActions(w)); } },
  { name: 'skip-compensation', make: task => { const w = worldOf(task); return skipCompensation(w, referenceActions(w)); } },
];

// Judgment probes (not part of the bad-control contract because they only differ from the
// reference when the ticket thread contains outcome-changing amendments, i.e. difficulty >= 2).
export const judgmentProbes = [
  {
    name: 'stale-ticket', minDifficulty: 2,
    description: 'follows the ticket description and header window literally, ignoring authorised amendments',
    make: task => {
      const w = worldOf(task), sp = w.spec;
      const belief = { ...sp,
        versionTo: sp.versionBase, targets: sp.descTargets, excludedNode: null, window: sp.headerWindow,
        maxInflight: sp.maxInflightDesc, slowStart: sp.slowDesc, workMem: sp.dbStep ? sp.workMemDesc : null };
      return referenceActions(w, belief);
    },
  },
];

export function createEnv(task) {
  const world = worldOf(task), budget = world.K.budget, sp = world.spec;
  let sim, record, last;
  const snaps = new Map();
  let nextSnap = 1;
  const intro = () => `Session opened for ${sp.ticketId} (${sp.site.name}). Tools: query, drain, undrain, restart, set_flag, apply_config, rollback_config, wait, page_human. Budget: ${budget} actions.`;
  const reset = () => { sim = new Sim(world); record = []; last = intro(); return { observation: last, done: false, reward: 0, info: { index: 0 } }; };
  reset();
  const itemSchema = outputSchema.properties.actions.items;
  return {
    determinism: 'D0',
    reset,
    step(action) {
      if (record.length >= budget) return { observation: 'ERROR: action budget exhausted', done: true, reward: 0, info: { index: record.length, ok: false, recorded: false } };
      const errs = schemaErrors(itemSchema, action);
      if (errs.length) return { observation: `ERROR: invalid action (not recorded): ${errs.slice(0, 3).join('; ')}`, done: false, reward: 0, info: { index: record.length, ok: false, recorded: false } };
      const a = JSON.parse(JSON.stringify(action));
      record.push(a);
      const r = sim.step(a);
      last = r.observation;
      return { observation: r.observation, done: record.length >= budget, reward: 0, info: { index: record.length, ok: r.ok, recorded: true } };
    },
    observe() { return { observation: last, actionsTaken: record.length, budget }; },
    snapshot() {
      const token = Object.freeze({ snapshot: nextSnap++ });
      snaps.set(token, { state: sim.snapshot(), record: structuredClone(record), last });
      return token;
    },
    restore(token) {
      const s = snaps.get(token);
      if (!s) throw new Error('runbook env: unknown snapshot token');
      sim.restore(s.state); record = structuredClone(s.record); last = s.last;
    },
    actions() {
      const s = sim.s;
      const hosts = Object.keys(s.hosts);
      const pools = [...new Set(Object.values(s.hosts).map(h => h.pool).filter(Boolean))];
      const services = [...new Set(Object.values(s.hosts).flatMap(h => Object.keys(h.services)))];
      return [
        { op: 'query', args: { target: ['clock', 'db', 'lb', ...pools.map(p => `lb:${p}`), ...hosts.map(h => `node:${h}`), ...services.map(x => `service:${x}`), 'flags', ...Object.keys(s.flags).map(f => `flag:${f}`), 'config', ...Object.keys(s.config).map(k => `config:${k}`), 'queue'] } },
        { op: 'drain', args: { node: hosts } }, { op: 'undrain', args: { node: hosts } },
        { op: 'restart', args: { service: services, node: hosts } },
        { op: 'set_flag', args: { name: Object.keys(s.flags), value: [true, false] } },
        { op: 'apply_config', args: { key: Object.keys(s.config), value: 'string' } },
        { op: 'rollback_config', args: { key: Object.keys(s.config) } },
        { op: 'wait', args: { seconds: `integer 1..${MAX_WAIT}` } },
        { op: 'page_human', args: { reason: 'string' } },
      ];
    },
    record() { return { actions: structuredClone(record) }; },
  };
}
