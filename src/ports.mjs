import { performance } from 'node:perf_hooks';
import { compileContext } from './context.mjs';
import { checkData, clone, digest, FoundryError } from './data.mjs';
import { toSystemOneQuestion, fromSystemOneAnswer } from './judgment.mjs';

// DESIGN §6. Native implementations of the three seams; ARC/AMP/Jev adapters implement the same shapes.
export class ContextPort {
  #compile;
  constructor(compile = compileContext) {
    if (typeof compile !== 'function') throw new FoundryError('PORT_CONFIG', 'ContextPort needs a compile function');
    this.engine = compile === compileContext ? 'native' : 'custom'; this.#compile = compile;
  }
  compile(request) { return this.#compile(request); }
}

const KEY = /^[A-Za-z0-9_.:\/+=-]{1,256}$/;
export class EffectPort {
  #registry; #allowed; #context; #ledger = new Map();
  constructor(registry, { allowedCapabilities, context = {}, maxLedger = 4096 } = {}) {
    if (!registry || typeof registry.execute !== 'function' || typeof registry.get !== 'function') throw new FoundryError('PORT_CONFIG', 'EffectPort needs a capability registry');
    this.engine = 'native'; this.#registry = registry; this.#context = context; this.maxLedger = maxLedger;
    this.#allowed = allowedCapabilities ? new Set(allowedCapabilities) : null;
  }
  // The idempotency key is the effect's identity: a repeat returns the first result without a
  // second dispatch; the same key with different arguments is a conflict, never a new effect.
  async run({ capability, args, idempotencyKey, signal } = {}) {
    if (typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey)) throw new FoundryError('EFFECT_IDEMPOTENCY_KEY', 'An idempotency key of 1-256 safe characters is required');
    if (this.#allowed && !this.#allowed.has(capability)) throw new FoundryError('CAPABILITY_DENIED', `Capability ${capability} is not permitted through this port`);
    const cap = this.#registry.get(capability);
    if (!cap) throw new FoundryError('UNKNOWN_TOOL', `Unregistered capability: ${capability}`);
    const argsHash = digest(args), prior = this.#ledger.get(idempotencyKey);
    if (prior) {
      if (prior.capability !== capability || prior.argsHash !== argsHash) throw new FoundryError('EFFECT_IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different effect');
      return { ...clone(await prior.result), replayed: true };
    }
    const result = this.#registry.execute(capability, args, { ...this.#context, signal, idempotencyKey })
      .then(output => ({ capability, effects: cap.effects, idempotencyKey, argsHash, output, outputHash: digest(output), engine: this.engine }));
    this.#ledger.set(idempotencyKey, { capability, argsHash, result });
    if (this.#ledger.size > this.maxLedger) this.#ledger.delete(this.#ledger.keys().next().value);
    try { return { ...clone(await result), replayed: false }; }
    catch (error) { if (this.#ledger.get(idempotencyKey)?.result === result) this.#ledger.delete(idempotencyKey); throw error; }
  }
}

const PORT = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
function judgmentRequest({ port, question, criteria = [], state = {}, options }) {
  if (!PORT.test(port ?? '')) throw new FoundryError('JUDGMENT_INPUT', 'port must be an identifier');
  if (typeof question !== 'string' || !question.trim() || question.length > 4000) throw new FoundryError('JUDGMENT_INPUT', 'question must be a non-empty string of at most 4000 characters');
  const list = typeof criteria === 'string' ? [criteria] : criteria;
  if (!Array.isArray(list) || list.length > 32 || !list.every(c => typeof c === 'string' && c.trim())) throw new FoundryError('JUDGMENT_INPUT', 'criteria must be strings');
  if (!Array.isArray(options) || options.length < 2 || options.length > 64 || !options.every(o => typeof o === 'string' && o.length > 0 && o.length <= 200) || new Set(options).size !== options.length) throw new FoundryError('JUDGMENT_INPUT', 'options must be 2-64 unique non-empty strings');
  checkData(state);
  return { port, question, criteria: list, state, options };
}
const argmax = (options, p) => options.reduce((best, o) => p[o] > p[best] ? o : best, options[0]);

export class JudgmentPort {
  constructor({ engine, rule, model, modelId, decoding = { maxTokens: 128, reasoning: 'none' }, classBudget, runId = 'judgment', systemOne, systemOneModel = null, ledger = null } = {}) {
    if (engine === 'rule' && typeof rule !== 'function') throw new FoundryError('PORT_CONFIG', 'The rule engine needs a rule function');
    if (engine === 'model' && (typeof model?.call !== 'function' || typeof modelId !== 'string')) throw new FoundryError('PORT_CONFIG', 'The model engine needs a ModelPort with call() and a policy model id');
    if (engine === 'systemone' && typeof systemOne?.ask !== 'function') throw new FoundryError('PORT_CONFIG', 'The systemone engine needs a System One client (Jev or Kev)');
    if (!['rule', 'model', 'systemone'].includes(engine)) throw new FoundryError('PORT_CONFIG', 'engine must be rule, model or systemone');
    if (ledger != null && typeof ledger.record !== 'function') throw new FoundryError('PORT_CONFIG', 'ledger must have record()');
    Object.assign(this, { engine, rule, model, modelId, decoding, classBudget, runId, systemOne, systemOneModel, ledger });
  }
  // With a ledger, every answer is recorded (ledgerId in the result) so its verified outcome can be
  // attached later with ledger.label(id, truth).
  async judge(request) {
    const req = judgmentRequest(request ?? {}), started = performance.now();
    const out = this.engine === 'rule' ? await this.#rule(req) : this.engine === 'systemone' ? await this.#systemOne(req, request) : await this.#model(req, request);
    const result = { ...out, engine: this.engine, latencyMs: Math.round(performance.now() - started) };
    if (this.ledger) result.ledgerId = this.ledger.record({ port: req.port, engine: this.engine, model: result.model, request: req, result, split: request.split ?? 'unspecified', meta: request.meta ?? {} });
    return result;
  }
  // Calibrated probabilities from a System One server; the state goes in as data and the answer is
  // a distribution over the offered options only, so nothing free-form flows back.
  async #systemOne(req, { signal, optionDescriptions } = {}) {
    const body = await this.systemOne.ask({ state: req.state, questions: { [req.port]: toSystemOneQuestion({ ...req, optionDescriptions }) }, signal });
    const out = fromSystemOneAnswer(body?.answers?.[req.port], req.options);
    return { ...out, model: this.systemOneModel ?? body?.model ?? null, costUsd: 0, receiptHash: null, serverLatencyMs: body?.latency_ms ?? null };
  }
  async #rule(req) {
    const raw = await this.rule(clone(req));
    const scores = Array.isArray(raw) ? Object.fromEntries(raw.map((v, i) => [req.options[i], v])) : raw;
    if (!scores || typeof scores !== 'object' || (Array.isArray(raw) && raw.length !== req.options.length) || Object.keys(scores).some(k => !req.options.includes(k))) throw new FoundryError('JUDGMENT_PROTOCOL', 'A rule must score exactly the offered options');
    const values = req.options.map(o => scores[o] ?? 0);
    if (!values.every(v => Number.isFinite(v) && v >= 0)) throw new FoundryError('JUDGMENT_PROTOCOL', 'Rule scores must be nonnegative finite numbers');
    const total = values.reduce((a, b) => a + b, 0);
    if (!(total > 0)) throw new FoundryError('JUDGMENT_PROTOCOL', 'Rule scores must not all be zero');
    const probabilities = Object.fromEntries(req.options.map((o, i) => [o, values[i] / total])), chosen = argmax(req.options, probabilities);
    return { probabilities, chosen, confidence: probabilities[chosen], model: null, costUsd: 0, receiptHash: null };
  }
  // Self-reported confidence only (uncalibrated; calibrated engines are Phase 4). The output is
  // an enum plus a bounded number, so the call is quarantined and its result declassified.
  async #model(req, { stateLabel = 'untrusted:judgment-state', signal, nodeKey, attempt = 1, sampleIndex = 0 }) {
    const schema = { type: 'object', additionalProperties: false, required: ['choice', 'confidence'], properties: {
      choice: { type: 'string', enum: req.options }, confidence: { type: 'number', minimum: 0, maximum: 1 } } };
    const node = { id: `judge-${req.port}`, kind: 'agent', description: req.question, quarantined: true, returns: schema,
      instructions: `Answer one typed judgment question for the "${req.port}" port. Choose exactly one value from the options input as "choice", and give "confidence": the probability, from 0 to 1, that your choice is correct.${req.criteria.length ? `\nCriteria:\n${req.criteria.map(c => `- ${c}`).join('\n')}` : ''}` };
    const compiled = compileContext({ node, classBudget: this.classBudget, inputs: [
      { name: 'options', value: req.options, label: 'trusted', render: 'json' },
      { name: 'state', value: req.state, label: stateLabel, render: 'json' }] });
    const r = await this.model.call({ runId: this.runId, nodeKey: nodeKey ?? `judgment/${req.port}`, attempt, sampleIndex, modelId: this.modelId,
      system: compiled.system, prompt: compiled.prompt, schema, decoding: this.decoding, receiptHash: compiled.receiptHash, signal });
    if (!r?.ok) throw new FoundryError(r?.error?.code ?? 'MODEL_FAILED', r?.error?.message ?? 'Judgment model call failed', { receiptHash: compiled.receiptHash });
    const { choice, confidence } = r.value ?? {};
    if (!req.options.includes(choice) || !(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) throw new FoundryError('JUDGMENT_PROTOCOL', 'The model did not return one offered option with a confidence in [0, 1]');
    const n = req.options.length;
    const probabilities = Object.fromEntries(req.options.map(o => [o, (o === choice ? confidence : 0) + (1 - confidence) / n]));
    return { probabilities, chosen: choice, confidence, model: r.modelId ?? this.modelId, costUsd: r.costUsd ?? 0, receiptHash: compiled.receiptHash };
  }
}
