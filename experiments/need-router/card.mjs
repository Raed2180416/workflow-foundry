// The need router's decision card, `need-decision/1` (research/need-router-20261014/DESIGN.md §1 "Output", §3;
// PREREG-NEED-V1.md §6: the sealed envelope holds one card per held-out decision). $0, no model calls. The only I/O is
// reading this router's own module sources to hash them (routerSha).
//
// A card records, for one job at one (V, N, W) cell: the trusted features and their hash; the guard block (typed
// requirements, engine support, "ask the user" reasons); the structural rule's reading; the probe, if one ran; per mode
// the predicted p (verified success), q (delivered wrong), abstain share (1 − p − q, charged nothing beyond dollars),
// c ($ per task), F (build $), $ per task at N and the expected utility EU in success-equivalents per task; the δ
// acceptable set; the choice with its run-time cascade fallback and the task-4 checkpoint; needsWorkflow (the C7a call:
// guard or structure, not economics); the class and kind of the chosen mode; askFlag; any abstention; the routing cost;
// and routerSha = sha256 over the code shas and the fitted parameters, so a card names exactly the router that wrote it.
//
// Untrusted text (the task prompt) is read for word cues only (REQUIREMENT_LIBRARY ids and shapeOf word classes); cues
// can raise "ask", never force or change a mode, and the text itself never enters the card.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { REQUIREMENT_LIBRARY } from '../../src/construction-objective.mjs';
import { shapeOf } from '../library/index.mjs';
import { HEADLINE, makeCell } from './metrics.mjs';
import { bestProbe } from './voi.mjs';
import { TRUSTED_FEATURES, CUE_HINTS, REQUIREMENT_TYPES, ENGINE_CONSTRUCTS } from './router.mjs';

export const CARD_SCHEMA_ID = 'need-decision/1';
/** The module sources whose shas enter routerSha (the frozen artefact's code, DESIGN §3; features.mjs is hashed by the addendum). */
export const CODE_FILES = Object.freeze(['router.mjs', 'card.mjs', 'voi.mjs', 'metrics.mjs']);
const PROSE_CUES = Object.freeze(['humanWords', 'timeWords', 'effectVerbs']);
const HINT_CUES = REQUIREMENT_LIBRARY.filter(r => Object.hasOwn(CUE_HINTS, r.id));
const finite = Number.isFinite;

export const sha256 = s => createHash('sha256').update(s).digest('hex');

/** Canonical JSON: object keys sorted, undefined dropped, non-finite numbers and non-plain values refused. */
export function canonicalJson(x) {
  if (x === null || typeof x === 'boolean' || typeof x === 'string') return JSON.stringify(x);
  if (typeof x === 'number') { if (!finite(x)) throw new Error('canonicalJson: non-finite number'); return JSON.stringify(x); }
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  const proto = typeof x === 'object' ? Object.getPrototypeOf(x) : undefined;
  if (proto === Object.prototype || proto === null) {
    return `{${Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: unsupported value ${Object.prototype.toString.call(x)}`);
}

let codeCache = null;
/** sha256 of each CODE_FILES source (read once per process). */
export function codeShas() {
  if (!codeCache) codeCache = Object.freeze(Object.fromEntries(CODE_FILES.map(f => [f, sha256(readFileSync(new URL(`./${f}`, import.meta.url)))])));
  return codeCache;
}
/** routerSha = sha256(canonical { code shas, sha of the fitted parameters }). */
export function routerSha(router) {
  const code = codeShas(), fitted = sha256(canonicalJson(router.fitted));
  return { sha: sha256(canonicalJson({ code, fitted })), code, fitted };
}

/** Word-cue ids in untrusted text: REQUIREMENT_LIBRARY cues with a hard-requirement reading, and shapeOf word classes. */
export function textCues(text) {
  if (text == null) return [];
  const t = String(text), ids = HINT_CUES.filter(r => r.cue.test(t)).map(r => r.id), sh = shapeOf({ prompt: t });
  for (const k of PROSE_CUES) if (sh[k].length) ids.push(k);
  return [...new Set(ids)].sort();
}
/** Cue ids from the prose counts features.mjs computes (effectVerbs, timeWords, humanWords): untrusted, ask only. */
export const proseCues = features => PROSE_CUES.filter(k => finite(features?.[k]) && features[k] > 0);

const thresholdsOut = th => Object.fromEntries(Object.entries(th).map(([k, t]) => [k, t === Infinity ? '+inf' : t]));

/**
 * The card for one job at one cell. `router` is fitNeedRouter's result; `job` = { id, features, requirements, verifier,
 * modes, cues?, text?, engine? } (text is read for cues only). `probe` = { observations: {<mode>: {passes, n}}, costUsd,
 * k?, signals?, disagree? } as recorded by whoever ran it; the card charges its cost as routing dollars.
 */
export function decisionCard(router, job = {}, cell = HEADLINE, { policy = null, text = null, probe = null } = {}) {
  const c = cell.key ? cell : makeCell(cell.V, cell.N, cell.wOverV ?? 1);
  const { text: jobText, ...rest } = job;
  const cues = [...new Set([...(job.cues ?? []), ...textCues(text ?? jobText ?? null), ...proseCues(job.features)])].sort();
  const d = router.decide({ ...rest, cues }, c, { probe });
  const sha = routerSha(router);
  const pred = Object.fromEntries(Object.entries(d.pred).map(([m, x]) => [m, { ...x, EU: d.U[m] }]));
  return {
    schema: CARD_SCHEMA_ID,
    policy: policy ?? (probe ? 'NR-probe' : d.stage === 'knn' ? 'NR-knn' : 'NR-static'),
    job: { id: String(job.id ?? 'job'), N: c.N, V: c.V, W: c.W, verifier: d.verifier, requirements: [...d.guard.requirements], modes: job.modes ? [...job.modes] : [...router.order] },
    cell: { key: c.key, V: c.V, N: c.N, W: c.W, wOverV: c.wOverV },
    features: { ...d.features },
    featuresHash: sha256(canonicalJson({ ...d.features })),
    guard: d.guard,
    structure: {
      intrinsic: d.structure.intrinsic, reason: d.structure.reason, thresholds: thresholdsOut(router.rule.thresholds), stage: d.stage,
      leaf: d.source.leaf ?? null, leafJobs: d.source.jobs ?? null, neighbours: d.source.neighbours ?? null,
    },
    probe: probe ? {
      ran: true, modes: Object.keys(probe.observations ?? {}).sort(), k: probe.k ?? Object.values(probe.observations ?? {}).reduce((a, o) => a + (o?.n ?? 0), 0),
      signals: probe.signals ?? null, costUsd: probe.costUsd ?? 0, disagree: probe.disagree === true,
    } : null,
    pred,
    U: { ...d.U },
    acceptable: [...d.acceptable],
    choice: { mode: d.mode, best: d.best, tie: d.tie, rule: router.delta > 0 ? `δ ties: the cheapest mode within ${router.delta} of the best predicted utility` : 'exact: the best predicted utility, ties to the cheaper', delta: router.delta, cascade: d.cascade, checkpoint: d.checkpoint },
    unsupported: [...d.unsupported],
    needsWorkflow: d.needsWorkflow,
    class: d.class,
    kind: d.kind,
    askFlag: d.askFlag,
    ask: [...d.ask],
    abstain: d.abstain,
    routingCostUsd: d.routingCostUsd,
    routerSha: sha.sha,
    routerShaParts: { code: { ...sha.code }, fitted: sha.fitted },
    propensity: 1,
  };
}

// ------------------------------------------------------------------------------------------------------- schema
const num = { type: 'number' }, prob = { type: 'number', minimum: 0, maximum: 1 }, usd = { type: 'number', minimum: 0 }, str = { type: 'string' }, bool = { type: 'boolean' };
const strs = { type: 'array', items: str }, hex = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const nullOr = s => ({ anyOf: [{ type: 'null' }, s] });
const obj = (properties, extra = {}) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...extra });
const REQ_IDS = Object.keys(REQUIREMENT_TYPES);

/** JSON Schema (draft-07 subset) of `need-decision/1`. validateCard checks it plus the cross-field invariants. */
export const CARD_SCHEMA = Object.freeze({
  $id: CARD_SCHEMA_ID,
  ...obj({
    schema: { const: CARD_SCHEMA_ID },
    policy: { type: 'string', pattern: '^NR-[a-z]+$' },
    job: obj({ id: { type: 'string', minLength: 1 }, N: { type: 'number', minimum: 1 }, V: { type: 'number', exclusiveMinimum: 0 }, W: { type: 'number', minimum: 0 }, verifier: str,
      requirements: { type: 'array', items: { enum: REQ_IDS } }, modes: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 } }),
    cell: obj({ key: str, V: { type: 'number', exclusiveMinimum: 0 }, N: { type: 'number', minimum: 1 }, W: { type: 'number', minimum: 0 }, wOverV: { type: 'number', minimum: 0 } }),
    features: { type: 'object', additionalProperties: false, properties: Object.fromEntries(TRUSTED_FEATURES.map(k => [k, num])) },
    featuresHash: hex,
    guard: obj({
      forced: bool, requirement: nullOr({ enum: REQ_IDS }), requirements: { type: 'array', items: { enum: REQ_IDS } },
      engineSupport: obj({ ok: { type: ['boolean', 'null'] }, needed: { type: 'array', items: { enum: [...ENGINE_CONSTRUCTS] } }, missing: { type: 'array', items: { enum: [...ENGINE_CONSTRUCTS] } }, declared: bool }),
      ask: obj({ raised: bool, reasons: strs, cues: { type: 'array', items: { enum: Object.keys(CUE_HINTS) } } }),
    }),
    structure: obj({
      intrinsic: { type: ['boolean', 'null'] }, reason: str, thresholds: { type: 'object', additionalProperties: { anyOf: [num, { const: '+inf' }] } }, stage: { enum: ['leaf', 'knn'] },
      leaf: nullOr({ enum: ['intrinsic', 'not', 'pooled'] }), leafJobs: nullOr({ type: 'integer', minimum: 0 }),
      neighbours: nullOr({ type: 'array', items: obj({ id: str, cluster: str, d: { type: 'number', minimum: 0 } }) }),
    }),
    probe: nullOr(obj({ ran: { const: true }, modes: strs, k: { type: 'integer', minimum: 0 }, signals: {}, costUsd: usd, disagree: bool })),
    pred: { type: 'object', additionalProperties: obj({ p: prob, q: prob, abstain: prob, c: usd, F: usd, usdPerTask: usd, n: { type: 'integer', minimum: 1 }, EU: num }) },
    U: { type: 'object', additionalProperties: num },
    acceptable: strs,
    choice: obj({
      mode: { type: 'string', minLength: 1 }, best: { type: ['string', 'null'] }, tie: bool, rule: str, delta: { type: 'number', minimum: 0 },
      cascade: nullOr(obj({ id: str, primary: str, fallback: str, on: strs })),
      checkpoint: nullOr(obj({ afterTask: { type: 'integer', minimum: 1 }, switchTo: str, when: str })),
    }),
    unsupported: strs,
    needsWorkflow: { type: ['boolean', 'null'] },
    class: { enum: ['workflow', 'no-workflow'] },
    kind: { enum: ['none', 'guided', 'built'] },
    askFlag: bool,
    ask: strs,
    abstain: nullOr(obj({ reasons: { type: 'array', items: str, minItems: 1 }, fallback: nullOr({ enum: ['pooled', 'all-modes', 'default-mode'] }) })),
    routingCostUsd: usd,
    routerSha: hex,
    routerShaParts: obj({ code: { type: 'object', additionalProperties: hex }, fitted: hex }),
    propensity: { const: 1 },
  }),
});

// A small interpreter for the draft-07 keywords CARD_SCHEMA uses (no dependency; test/card.test.mjs cross-checks it
// against Ajv on the same schema).
const typeOk = (t, v) => (t === 'null' ? v === null : t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && finite(v)
  : t === 'array' ? Array.isArray(v) : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : typeof v === t);
function check(s, v, at, out) {
  if (s.type && !(Array.isArray(s.type) ? s.type : [s.type]).some(t => typeOk(t, v))) { out.push(`${at}: expected ${[].concat(s.type).join('|')}`); return; }
  if ('const' in s && v !== s.const) out.push(`${at}: expected ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) out.push(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.join(', ')}`);
  if (s.anyOf && !s.anyOf.some(x => { const o = []; check(x, v, at, o); return !o.length; })) out.push(`${at}: matches no allowed form`);
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${at}: below ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${at}: above ${s.maximum}`);
    if (s.exclusiveMinimum !== undefined && !(v > s.exclusiveMinimum)) out.push(`${at}: must exceed ${s.exclusiveMinimum}`);
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) out.push(`${at}: shorter than ${s.minLength}`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${at}: does not match ${s.pattern}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: fewer than ${s.minItems} items`);
    if (s.items) v.forEach((x, i) => check(s.items, x, `${at}[${i}]`, out));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of s.required ?? []) if (!Object.hasOwn(v, k)) out.push(`${at}: missing ${k}`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties && Object.hasOwn(s.properties, k)) check(s.properties[k], x, `${at}.${k}`, out);
      else if (s.additionalProperties === false) out.push(`${at}: unexpected ${k}`);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(s.additionalProperties, x, `${at}.${k}`, out);
    }
  }
}

/** Schema plus cross-field invariants. Returns { ok, problems }. */
export function validateCard(card) {
  const problems = [];
  check(CARD_SCHEMA, card, '$', problems);
  if (problems.length) return { ok: false, problems };
  const P = Object.keys(card.pred), forcedOut = card.abstain?.reasons.some(r => r.startsWith('forced-without-workflow-mode')) ?? false;
  const fellBack = card.abstain?.fallback === 'default-mode';
  if (!card.job.modes.includes(card.choice.mode)) problems.push(`choice ${card.choice.mode} is not a runnable mode of the job`);
  if (!fellBack && !P.includes(card.choice.mode)) problems.push(`choice ${card.choice.mode} has no prediction`);
  if (canonicalJson(Object.keys(card.U).sort()) !== canonicalJson([...P].sort())) problems.push('U and pred cover different modes');
  for (const m of card.acceptable) if (!P.includes(m)) problems.push(`acceptable mode ${m} has no prediction`);
  if (!fellBack && !card.acceptable.includes(card.choice.mode)) problems.push('the choice is not in the acceptable set');
  for (const [m, x] of Object.entries(card.pred)) {
    if (x.p + x.q > 1 + 1e-9) problems.push(`${m}: p + q > 1`);
    if (Math.abs(x.abstain - Math.max(0, 1 - x.p - x.q)) > 1e-9) problems.push(`${m}: abstain is not 1 − p − q`);
    if (Math.abs(x.EU - card.U[m]) > 1e-12) problems.push(`${m}: EU differs from U`);
  }
  if (card.guard.forced !== card.guard.requirements.length > 0) problems.push('guard.forced must equal "a typed requirement is declared"');
  if (card.guard.forced && card.needsWorkflow !== true) problems.push('a forced job must have needsWorkflow = true');
  if (card.guard.forced && !forcedOut && card.class !== 'workflow') problems.push('a forced job must be routed to the workflow class');
  if (card.askFlag !== card.ask.length > 0) problems.push('askFlag must equal "an ask reason exists"');
  if (card.guard.ask.raised && !card.askFlag) problems.push('a guard ask must raise askFlag');
  if (card.featuresHash !== sha256(canonicalJson(card.features))) problems.push('featuresHash does not match the features');
  if (card.routerSha !== sha256(canonicalJson({ code: card.routerShaParts.code, fitted: card.routerShaParts.fitted }))) problems.push('routerSha does not match its parts');
  if (card.probe && card.routingCostUsd + 1e-12 < card.probe.costUsd) problems.push('the probe cost is not charged as routing dollars');
  if (card.job.V !== card.cell.V || card.job.N !== card.cell.N || card.job.W !== card.cell.W) problems.push('job and cell disagree on V, N or W');
  return { ok: !problems.length, problems };
}

/**
 * NR-probe's plan (DESIGN §3): voi.mjs bestProbe over the router's predictions for this job, priors Beta(1 + s·T,
 * 1 + (1 − s)·T) with T = support jobs × tasksPerJob, probeable {direct-H, agent-H}, kMax 2, examples only (not
 * deliverable). voi's utility has no silent-miss term, so W·q is folded into the per-task cost (exact for the decision,
 * since q is not updated by the probe). Returns bestProbe's result plus the modes it priced.
 */
export function probePlan(router, job, cell = HEADLINE, { probeable = ['direct-H', 'agent-H'], kMax = 2, cVerify = 0, tasksPerJob = 12 } = {}) {
  const c = cell.key ? cell : makeCell(cell.V, cell.N, cell.wOverV ?? 1);
  const d = router.decide(job, c);
  const modes = Object.entries(d.pred).map(([id, x]) => { const T = x.n * tasksPerJob; return { id, a: 1 + x.p * T, b: 1 + (1 - x.p) * T, c: x.c + c.W * x.q, F: x.F }; });
  if (!modes.length) return { probe: null, net: 0, priorChoice: null, plans: [], modes };
  const plan = bestProbe(modes, { V: c.V, H: c.N, kMax, cVerify, deliverable: false, probeable: probeable.filter(m => Object.hasOwn(d.pred, m)) });
  return { ...plan, modes };
}
