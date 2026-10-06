import { mkdirSync, lstatSync, realpathSync, openSync, writeFileSync, closeSync, linkSync, unlinkSync, fsyncSync, existsSync, readFileSync, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkData, clone, digest, FoundryError, refParts, resolve } from './data.mjs';
import { validateData, compileDataSchema } from './validate.mjs';

export class CapabilityRegistry {
  #tools = new Map();
  register(spec) {
    const { execute, ...descriptor } = spec;
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(spec.name ?? '') || this.#tools.has(spec.name)) throw new FoundryError('CAPABILITY_NAME', 'Invalid or duplicate capability name');
    if (typeof execute !== 'function') throw new FoundryError('CAPABILITY_IMPLEMENTATION', 'A trusted implementation function is required');
    if (!['none', 'idempotent', 'non-idempotent'].includes(spec.effects)) throw new FoundryError('CAPABILITY_EFFECTS', 'Capability effects must be declared');
    if (!['low', 'high'].includes(spec.risk)) throw new FoundryError('CAPABILITY_RISK', 'Capability risk must be declared');
    if (!Number.isInteger(spec.maxTimeoutMs) || spec.maxTimeoutMs < 1) throw new FoundryError('CAPABILITY_TIMEOUT', 'A positive timeout limit is required');
    if (!Number.isFinite(spec.cost) || spec.cost < 0) throw new FoundryError('CAPABILITY_COST', 'A nonnegative per-dispatch reserved cost is required');
    if (spec.requiresEvidence) {
      if (!Array.isArray(spec.requiresEvidence) || spec.requiresEvidence.length > 30) throw new FoundryError('EVIDENCE_CONTRACT', 'Evidence requirements must be a bounded array');
      const ids = new Set();
      for (const requirement of spec.requiresEvidence) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(requirement.id ?? '') || ids.has(requirement.id)) throw new FoundryError('EVIDENCE_CONTRACT', 'Evidence requirement ids must be unique identifiers');
        ids.add(requirement.id);
        if (typeof requirement.sourceTool !== 'string' || !Object.hasOwn(requirement, 'sourceArgs') || !requirement.schema || !Number.isInteger(requirement.maxAgeMs) || requirement.maxAgeMs < 1 || requirement.maxAgeMs > 86400000) throw new FoundryError('EVIDENCE_CONTRACT', 'Evidence requires source tool/arguments, schema and bounded freshness');
        if (requirement.path) refParts(`input.${requirement.path}`);
        compileDataSchema(requirement.schema);
      }
    }
    checkData(descriptor);
    this.#tools.set(spec.name, Object.freeze({ ...clone(descriptor), handlerHash: createHash('sha256').update(execute.toString()).digest('hex'), execute }));
    return this;
  }
  get(name) { return this.#tools.get(name); }
  list() { return [...this.#tools.values()].map(({ execute, ...rest }) => clone(rest)); }
  hash() { return digest(this.list().sort((a, b) => a.name.localeCompare(b.name))); }
  async execute(name, args, context) {
    const cap = this.get(name);
    if (!cap) throw new FoundryError('UNKNOWN_TOOL', `Unregistered capability: ${name}`);
    validateData(cap.inputSchema, args, `${name} input`);
    const result = await cap.execute(clone(args), context);
    checkData(result, { maxBytes: 512 * 1024 });
    validateData(cap.outputSchema, result, `${name} output`);
    return clone(result);
  }
}

function ensureDirectoryWithoutLinks(directory) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (createError) { if (createError.code !== 'EEXIST') throw createError; }
      stat = lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new FoundryError('ARTIFACT_PATH', 'Artifact ancestors must be real directories, never symlinks');
  }
}

export function createDefaultRegistry() {
  const registry = new CapabilityRegistry();
  const add = (name, description, inputSchema, outputSchema, execute, extra = {}) => registry.register({
    name, description, version: '1', implementation: `workflow-foundry/0.1.0/${name}`,
    inputSchema, outputSchema, effects: 'none', risk: 'low', requiresApproval: false,
    maxTimeoutMs: 60000, cost: 0, cancellation: 'cooperative', execute, ...extra
  });
  add('core.identity', 'Return JSON unchanged. Useful for explicit data bindings, not an external correctness oracle.', {}, {}, async args => args);
  add('core.validate', 'Check JSON against the supported strict schema profile. Returns real type/required-field validation; not merely field existence. Untrusted regex, async or external schemas are rejected.', {
    type: 'object', additionalProperties: false, required: ['value', 'schema'], properties: { value: {}, schema: { type: 'object' } }
  }, { type: 'object', additionalProperties: false, required: ['valid', 'errors'], properties: { valid: { type: 'boolean' }, errors: { type: 'array' } } }, async ({ value, schema }) => {
    const validator = compileDataSchema(schema);
    return validator(value) === true ? { valid: true, errors: [] } : { valid: false, errors: clone(validator.errors ?? []) };
  });
  add('core.json', 'Serialize a JSON value without code execution. Useful for structured artifact content.', {
    type: 'object', additionalProperties: false, required: ['value'], properties: { value: {}, pretty: { type: 'boolean' } }
  }, { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, async ({ value, pretty = false }) => ({ text: JSON.stringify(value, null, pretty ? 2 : 0) }));
  add('core.pluck', 'Project one own-property path from each JSON item. Missing paths fail; no executable expressions or prototype traversal.', {
    type: 'object', additionalProperties: false, required: ['items', 'field'], properties: { items: { type: 'array', maxItems: 1000 }, field: { type: 'string', minLength: 1, maxLength: 512 } }
  }, { type: 'object', additionalProperties: false, required: ['items', 'count'], properties: { items: { type: 'array' }, count: { type: 'integer' } } }, async ({ items, field }) => ({ items: items.map(value => resolve({ $ref: `input.${field}` }, { input: value })), count: items.length }));
  add('core.aggregate', 'Compute one bounded numeric/boolean aggregate from values or an explicitly selected field. No coercion, expressions, shell or arbitrary code.', {
    type: 'object', additionalProperties: false, required: ['operation', 'values'],
    properties: { operation: { enum: ['sum', 'count', 'min', 'max', 'all', 'any'] }, values: { type: 'array', maxItems: 1000 }, field: { type: 'string', maxLength: 512 } }
  }, { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: ['number', 'boolean'] } } }, async ({ operation, values, field }) => {
    const selected = field ? values.map(value => resolve({ $ref: `input.${field}` }, { input: value })) : values;
    if (operation === 'count') return { value: selected.length };
    if (operation === 'all' || operation === 'any') {
      if (selected.some(value => typeof value !== 'boolean')) throw new FoundryError('AGGREGATE_TYPE', 'Boolean aggregates require actual booleans');
      return { value: operation === 'all' ? selected.every(Boolean) : selected.some(Boolean) };
    }
    if (selected.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new FoundryError('AGGREGATE_TYPE', 'Numeric aggregates require finite numbers');
    if (operation !== 'sum' && !selected.length) throw new FoundryError('AGGREGATE_EMPTY', 'min/max require at least one value');
    const result = operation === 'sum' ? selected.reduce((a, b) => a + b, 0) : operation === 'min' ? Math.min(...selected) : Math.max(...selected);
    if (!Number.isFinite(result)) throw new FoundryError('AGGREGATE_OVERFLOW', 'Aggregate is not a finite number');
    return { value: result };
  });
  add('core.template', 'Interpolate named string variables into {{name}} markers, without executing code.', {
    type: 'object', additionalProperties: false, required: ['text', 'variables'],
    properties: { text: { type: 'string', maxLength: 200000 }, variables: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } } }
  }, { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false }, async ({ text, variables }) => ({
    text: text.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_, key) => {
      if (!Object.hasOwn(variables, key)) throw new FoundryError('TEMPLATE_VARIABLE', `Missing variable: ${key}`);
      return String(variables[key]);
    })
  }));
  add('core.collect', 'Collect explicitly supplied dependency values into a named JSON result.', {
    type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', maxItems: 1000 } }
  }, { type: 'object', additionalProperties: false, required: ['items', 'count'], properties: { items: { type: 'array' }, count: { type: 'integer' } } }, async ({ items }) => ({ items, count: items.length }));
  add('core.artifact', 'Write a UTF-8 artifact only inside the current run artifact directory; never a host path.', {
    type: 'object', additionalProperties: false, required: ['name', 'content'],
    properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, content: { type: 'string', maxLength: 400000 } }
  }, { type: 'object', additionalProperties: false, required: ['name', 'sha256', 'bytes'], properties: { name: { type: 'string' }, sha256: { type: 'string' }, bytes: { type: 'integer' } } }, async ({ name, content }, ctx) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name) || name === '.' || name === '..') throw new FoundryError('ARTIFACT_PATH', 'Artifact name must be a single safe basename');
    ensureDirectoryWithoutLinks(ctx.artifactsDir);
    if (lstatSync(ctx.artifactsDir).isSymbolicLink() || realpathSync(ctx.artifactsDir) !== path.resolve(ctx.artifactsDir)) throw new FoundryError('ARTIFACT_PATH', 'Artifact directories cannot contain symlinks');
    const target = path.join(ctx.artifactsDir, name);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new FoundryError('ARTIFACT_PATH', 'Artifact target is a symlink');
    const sha256 = createHash('sha256').update(content).digest('hex');
    // Name reuse with different content is a conflict, not silent last-writer-wins.
    if (existsSync(target)) {
      if (createHash('sha256').update(readFileSync(target)).digest('hex') !== sha256) throw new FoundryError('ARTIFACT_CONFLICT', `Artifact ${name} already has different content`);
    } else {
      const temp = path.join(ctx.artifactsDir, `.tmp-${randomUUID()}`);
      const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
      try { linkSync(temp, target); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (lstatSync(target).isSymbolicLink() || createHash('sha256').update(readFileSync(target)).digest('hex') !== sha256) throw new FoundryError('ARTIFACT_CONFLICT', `Concurrent write conflicted at ${name}`);
      } finally { unlinkSync(temp); }
    }
    return { name, sha256, bytes: Buffer.byteLength(content) };
  }, { effects: 'idempotent' });
  add('core.fail', 'Deliberately fail a diagnostic workflow. Not a production recovery strategy.', {
    type: 'object', additionalProperties: false, properties: { message: { type: 'string', maxLength: 1000 } }
  }, {}, async args => { throw new FoundryError('INJECTED_FAILURE', args.message ?? 'Injected failure'); });
  add('core.sleep', 'Bounded cancellable delay for local execution tests; use wait nodes for durable sleeping.', {
    type: 'object', additionalProperties: false, required: ['ms'], properties: { ms: { type: 'integer', minimum: 0, maximum: 60000 } }
  }, { type: 'object', required: ['sleptMs'], properties: { sleptMs: { type: 'integer' } }, additionalProperties: false }, async ({ ms }, { signal }) => {
    await delay(ms, undefined, { signal }); return { sleptMs: ms };
  });
  add('fixture.observe', 'Read one instrument from the sealed local incident simulator. This is not production telemetry.', {
    type: 'object', additionalProperties: false, required: ['probe'], properties: { probe: { enum: ['metrics', 'deployment', 'logs', 'health'] } }
  }, { type: 'object' }, async ({ probe }, ctx) => {
    const world = ctx.store.fixture(ctx.runId);
    if (!world) throw new FoundryError('NO_FIXTURE', 'No incident simulator is attached to this run');
    if (world.unavailableProbes?.includes(probe)) throw new FoundryError('PROBE_UNAVAILABLE', `Probe ${probe} unavailable`);
    if (probe === 'health') return { healthy: world.healthy === true };
    return clone(world.observations[probe] ?? {});
  });
  add('fixture.diagnose', 'Return supplied hypotheses unchanged for explicit tracking; does not reveal simulator ground truth.', {
    type: 'object', additionalProperties: false, required: ['hypotheses'], properties: { hypotheses: { type: 'array', items: { type: 'string' }, maxItems: 100 } }
  }, { type: 'object', required: ['hypotheses'], properties: { hypotheses: { type: 'array' } }, additionalProperties: false }, async args => args);
  add('fixture.remediate', 'Attempt one remediation only in the local simulator. Idempotency is backed by its transaction ledger.', {
    type: 'object', additionalProperties: false, required: ['action'], properties: { action: { enum: ['rollback', 'scale', 'restart', 'none'] } }
  }, { type: 'object', additionalProperties: false, required: ['attempted'], properties: { attempted: { type: 'string' } } }, async ({ action }, ctx) => ctx.store.fixtureEffect(ctx.runId, ctx.idempotencyKey, action), { effects: 'idempotent' });
  add('fixture.verify', 'Independently observe simulated health and incorrect actions after remediation.', {
    type: 'object', additionalProperties: false, properties: {}
  }, { type: 'object', additionalProperties: false, required: ['healthy', 'wrongActions', 'actionCount'], properties: { healthy: { type: 'boolean' }, wrongActions: { type: 'integer' }, actionCount: { type: 'integer' } } }, async (_, ctx) => {
    const world = ctx.store.fixture(ctx.runId);
    if (!world) throw new FoundryError('NO_FIXTURE', 'No incident simulator is attached');
    return { healthy: world.healthy === true, wrongActions: world.wrongActions ?? 0, actionCount: world.actions?.length ?? 0 };
  });
  return registry;
}
