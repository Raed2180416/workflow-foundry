// The need router's decision card, `need-decision/1` (research/need-router-20261014/DESIGN.md §1 "Output", §3;
// PREREG-NEED-V1.md §6: the sealed envelope holds one card per held-out decision). $0, no model calls. The only I/O is
// reading this router's own module sources to hash them (routerSha).
//
// A card records, for one job at one (V, N, W) cell: the trusted features and their hash; the guard block (typed
// requirements, engine support, "ask the user" reasons); the structural rule's reading; the probe, if one ran (its bundle,
// and per observed mode its passes, trials, deployable signal kind and the probe rows it read); per mode
// the predicted p (verified success), q (delivered wrong), abstain share (1 − p − q, charged nothing beyond dollars),
// c ($ per task), F (build $), $ per task at N and the expected utility EU in success-equivalents per task; the δ
// acceptable set; the choice (a cascade only when the chosen mode is that cascade, priced as such; the task-4 checkpoint
// only on the construct-H cascade); needsWorkflow (the C7a call:
// guard or structure, not economics; cell-independent); the class and kind of the chosen mode; askFlag; any abstention;
// the routing cost (a probe's dollars included; a probe without a stated cost is refused, never booked at $0); and
// routerSha = sha256 over the code shas and the fitted parameters (which include the cascades, the checkpoint and every
// mode's class and kind), so a card names exactly the router that wrote it. The code shas are taken when this module
// loads, and every card first checks that the sources on disk still match them.
//
// Untrusted text (the task prompt) is read for word cues only (REQUIREMENT_LIBRARY ids and shapeOf word classes); cues
// can raise "ask", never force or change a mode, and the text itself never enters the card.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { REQUIREMENT_LIBRARY } from '../../src/construction-objective.mjs';
import { shapeOf } from '../library/index.mjs';
import { HEADLINE } from './metrics.mjs';
import { bestProbe, bundleValue } from './voi.mjs';
import { TRUSTED_FEATURES, CUE_HINTS, REQUIREMENT_TYPES, ENGINE_CONSTRUCTS, PROBEABLE, PROBE_BUNDLE, PROBE_SIGNALS, FROZEN_FILES, resolveCell, probeProblems } from './router.mjs';

export const CARD_SCHEMA_ID = 'need-decision/1';
/**
 * The module sources whose shas enter routerSha: router.mjs FROZEN_FILES, the PREREG §6 "Shas" seven (the A-Freeze
 * analysis stamp), the same array evaluate.mjs seals in the envelope as ROUTER_FILES (third review R4). It holds every
 * experiments/need-router module in this card's and router.mjs's static import graph (test/router-review.test.mjs D4 walks
 * the graph) and also features.mjs, which computes the inputs, and evaluate.mjs, which fits the policies and seals the
 * decisions (third review R7). The word-cue sources (REQUIREMENT_LIBRARY, shapeOf) change only "ask", which is logged,
 * not scored.
 */
export const CODE_FILES = FROZEN_FILES;
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

const hashCodeFiles = () => Object.freeze(Object.fromEntries(CODE_FILES.map(f => [f, sha256(readFileSync(new URL(`./${f}`, import.meta.url)))])));
// Taken when this module loads, right after its static imports (router, voi, metrics, prereg-rules) were evaluated: the
// shas name the code that runs. A lazy first-card read could hash a file edited after import while the old code ran.
// features.mjs and evaluate.mjs are not imported here; their shas name the sources on disk at load.
const CODE_SHAS = hashCodeFiles();
/** sha256 of each CODE_FILES source, as loaded. */
export const codeShas = () => CODE_SHAS;
/** Throws when a CODE_FILES source on disk no longer matches the loaded code (a card would name code not in the tree). */
export function assertCodeUnchanged() {
  const now = hashCodeFiles(), changed = CODE_FILES.filter(f => now[f] !== CODE_SHAS[f]);
  if (changed.length) throw new Error(`router sources changed on disk since they were loaded (${changed.join(', ')}): reload before writing decision cards`);
}
/** routerSha = sha256(canonical { code shas, sha of the fitted parameters }). */
export function routerSha(router) {
  const code = codeShas(), fitted = sha256(canonicalJson(router.fitted));
  return { sha: sha256(canonicalJson({ code, fitted })), code, fitted };
}

/** Policy labels a card may carry: NR-probe iff a probe ran; NR-probe and NR-static on the leaf stage, NR-knn on kNN. */
function policyMismatch(policy, stage, probed) {
  if ((policy === 'NR-probe') !== probed) return probed ? `a probed card must be labelled NR-probe, not ${policy}` : 'an NR-probe card needs the probe it ran';
  if (probed && stage !== 'leaf') return 'a probe updates the leaf calculator; the kNN stage takes no probe';
  if ((policy === 'NR-static' || policy === 'NR-probe') && stage !== 'leaf') return `${policy} is the leaf stage, but the router's stage is ${stage}`;
  if (policy === 'NR-knn' && stage !== 'knn') return `NR-knn is the kNN stage, but the router's stage is ${stage}`;
  return null;
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
 * The card for one job at one cell (a makeCell result or a plain { V, N, W? | wOverV? }, router.resolveCell). `router`
 * is fitNeedRouter's result; `job` = { id, features, requirements, verifier, modes, cues?, text?, engine? } (text is
 * read for cues only). `probe` = { observations: {<mode>: {passes, n}}, costUsd, k?, signals?, disagree? } as recorded by
 * whoever ran it; the card charges its cost as routing dollars, and a probe without a finite cost (> 0 once it drew or
 * observed anything) is refused (router.probeRecord). A probe belongs to NR-probe on the leaf stage only.
 */
export function decisionCard(router, job = {}, cell = HEADLINE, { policy = null, text = null, probe = null } = {}) {
  assertCodeUnchanged();
  const c = resolveCell(cell);
  const { text: jobText, ...rest } = job;
  const cues = [...new Set([...(job.cues ?? []), ...textCues(text ?? jobText ?? null), ...proseCues(job.features)])].sort();
  const d = router.decide({ ...rest, cues }, c, { probe });
  const name = policy ?? (d.probe ? 'NR-probe' : d.stage === 'knn' ? 'NR-knn' : 'NR-static');
  const policyProblem = policyMismatch(name, d.stage, d.probe !== null);
  if (policyProblem) throw new Error(`decisionCard: ${policyProblem}`);
  const sha = routerSha(router);
  const pred = Object.fromEntries(Object.entries(d.pred).map(([m, x]) => [m, { ...x, EU: d.U[m] }]));
  return {
    schema: CARD_SCHEMA_ID,
    policy: name,
    job: { id: String(job.id ?? 'job'), N: c.N, V: c.V, W: c.W, verifier: d.verifier, requirements: [...d.guard.requirements], modes: job.modes ? [...job.modes] : [...router.order] },
    cell: { key: c.key, V: c.V, N: c.N, W: c.W, wOverV: c.wOverV },
    features: { ...d.features },
    featuresHash: sha256(canonicalJson({ ...d.features })),
    guard: d.guard,
    structure: {
      intrinsic: d.structure.intrinsic, reason: d.structure.reason, thresholds: thresholdsOut(router.rule.thresholds), stage: d.stage,
      leaf: d.source.leaf ?? null, leafJobs: d.source.jobs ?? null, neighbours: d.source.neighbours ?? null,
    },
    probe: d.probe ? {
      ran: true, bundle: d.probe.bundle, modes: [...d.probe.modes], k: d.probe.k,
      observations: Object.fromEntries(Object.entries(d.probe.observations).map(([m, o]) => [m, { passes: o.passes, n: o.n, signal: o.signal, rows: [...o.rows] }])),
      signals: d.probe.signals, costUsd: d.probe.costUsd, disagree: d.probe.disagree,
    } : null,
    pred,
    U: { ...d.U },
    acceptable: [...d.acceptable],
    choice: {
      mode: d.mode, best: d.best, tie: d.tie, rule: router.delta > 0 ? `δ ties: the cheapest mode within ${router.delta} of the best predicted utility` : 'exact: the best predicted utility, ties to the cheaper',
      delta: router.delta, acceptDelta: router.acceptDelta, cascade: d.cascade, checkpoint: d.checkpoint,
    },
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
    probe: nullOr(obj({
      ran: { const: true }, bundle: { const: PROBE_BUNDLE.id }, modes: { type: 'array', items: { enum: [...PROBEABLE] }, minItems: 1 }, k: { type: 'integer', minimum: 1 },
      observations: { type: 'object', additionalProperties: obj({ passes: { type: 'integer', minimum: 0 }, n: { type: 'integer', minimum: 1 }, signal: { enum: Object.keys(PROBE_SIGNALS) },
        rows: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 } }) },
      signals: {}, costUsd: usd, disagree: bool,
    })),
    pred: { type: 'object', additionalProperties: obj({ p: prob, q: prob, abstain: prob, c: usd, F: usd, usdPerTask: usd, n: { type: 'integer', minimum: 1 }, EU: num }) },
    U: { type: 'object', additionalProperties: num },
    acceptable: strs,
    choice: obj({
      mode: { type: 'string', minLength: 1 }, best: { type: ['string', 'null'] }, tie: bool, rule: str, delta: { type: 'number', minimum: 0 }, acceptDelta: { type: 'number', minimum: 0 },
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
  if (card.probe && (card.probe.k > 0 || card.probe.modes.length > 0) && !(card.probe.costUsd > 0)) problems.push('a probe that drew or observed anything must carry its cost (costUsd > 0)');
  if (card.probe) {
    // The probe's provenance (third review R3): probeable modes, the preregistered bundle's draws, a signal kind and the
    // probe rows per observation, one job; the same rules router.probeRecord applies (probeProblems).
    for (const x of probeProblems(card.probe.observations, { k: card.probe.k })) problems.push(`probe: ${x}`);
    if (canonicalJson([...card.probe.modes].sort()) !== canonicalJson(Object.keys(card.probe.observations).sort())) problems.push('probe.modes and probe.observations name different modes');
  }
  const pm = policyMismatch(card.policy, card.structure.stage, card.probe !== null);
  if (pm) problems.push(pm);
  if (card.job.V !== card.cell.V || card.job.N !== card.cell.N || card.job.W !== card.cell.W) problems.push('job and cell disagree on V, N or W');
  return { ok: !problems.length, problems };
}

// Review of voi.mjs against DESIGN §3 (2026-10-14):
//   V1 its utility U = H·(V·p − c) − F had no silent-miss term (W/V)·q and no routing term, and probePlan folded W·q into
//      c, so every non-deliverable probe was priced k·W·q too high (review 2026-10-15: 12 times the true $0.05 for a
//      direct-H draw with q 0.55 at W = V), biasing NR-probe toward never probing. Fixed: voi.mjs takes a per-mode `wq`
//      ($ of silent misses per task) that its utilities subtract and its probe price leaves out unless the probe is
//      delivered; probePlan passes c and W·q separately. The routing term is common to every mode: it moves no choice.
//   V2 FIXED (third review R2): a probe that is not delivered (examples, not the job's tasks) caps k by kMax, never by H,
//      so at N = 1 the two-draw direct-H probe is priced.
//   V3 an observed probe success is treated as a true success; DESIGN observes deployable signals only (schema validity,
//      agreement of two draws, turns, family tests), and the signal-to-success mapping is TBD-FREEZE (router.mjs
//      PROBE_MAPPING, in routerSha). The EVSI is optimistic by however far that mapping is from the oracle.
//   V4 `best` keeps the first mode on an exact utility tie (array order), not the cheaper one (DESIGN §2 tie rule), and
//      has no δ acceptable set; the router's own decision after a probe uses decideModes, so this only affects EVSI.
//   V5 sound as written: Beta-Binomial pmf, exact enumeration over s, the build cost F sunk once a probed build is kept,
//      the deliverable variant, and net > 0 as the run condition.
//   V6 FIXED (third review R2): the gate priced single-mode plans (it could recommend two agent-H runs, which label-run
//      never draws) and never the preregistered bundle; probePlan now prices PROBE_BUNDLE jointly (voi.mjs bundleValue).
/**
 * NR-probe's plan (DESIGN §3, PREREG §6 "kMax 2 (two direct-H draws, one agent-H run) ... probe iff net EVSI > 0"): the
 * ONE plan label-run.mjs runProbes draws, router.mjs PROBE_BUNDLE, priced jointly by voi.mjs bundleValue over the
 * router's predictions for this job: EVSI over the joint posterior update, cost the sum of its draws, examples only (not
 * deliverable, so k is not bounded by N). The bundle is restricted to the probeable modes the router prices for this job
 * (a masked or unsupported mode is not drawn). Priors are the router's own (decide's `priors`, router.mjs probePriors: the
 * same prior the probe update starts from). Each mode carries its dollars c and its silent-miss charge wq = W·q
 * separately: the decision after the probe charges both, the probe's own price only c (plus cVerify, plus F for a build).
 * `probe` is { id, draws } when the bundle's net value is > 0, else null: the gate. `plans` are the single-mode plans
 * (k = 1..kMax), a sensitivity only, never the gate. Leaf stage only.
 */
export function probePlan(router, job, cell = HEADLINE, { kMax = 2, cVerify = 0, tasksPerJob = router.tasksPerJob, probeable = PROBEABLE } = {}) {
  if (router.stage !== 'leaf') throw new Error('probePlan: NR-probe plans over the leaf calculator; the kNN stage takes no probe');
  if (tasksPerJob !== router.tasksPerJob) throw new Error(`probePlan: tasksPerJob ${tasksPerJob} differs from the router's ${router.tasksPerJob} (the prior must match the update)`);
  for (const m of probeable) if (!PROBEABLE.includes(m)) throw new Error(`probePlan: ${m} is not a probeable mode (${PROBEABLE.join(', ')})`);
  const c = resolveCell(cell);
  const d = router.decide(job, c);
  const modes = Object.entries(d.pred).map(([id, x]) => {
    const pr = d.priors?.[id];
    if (!pr) throw new Error(`probePlan: the router has no probe prior for ${id}`);
    return { id, a: pr.a, b: pr.b, c: x.c, wq: c.W * x.q, F: x.F };
  });
  const draws = Object.fromEntries(Object.entries(PROBE_BUNDLE.draws).filter(([m]) => probeable.includes(m) && Object.hasOwn(d.pred, m)));
  if (!modes.length || !Object.keys(draws).length) return { probe: null, net: 0, evsi: 0, cost: 0, priorChoice: null, bundle: null, plans: [], modes };
  const B = bundleValue(modes, draws, { V: c.V, H: c.N, cVerify, deliverable: false });
  const plans = bestProbe(modes, { V: c.V, H: c.N, kMax, cVerify, deliverable: false, probeable: probeable.filter(m => Object.hasOwn(d.pred, m)) }).plans;
  return { probe: B.net > 1e-12 ? { id: PROBE_BUNDLE.id, draws } : null, net: Math.max(0, B.net), evsi: B.evsi, cost: B.cost, priorChoice: B.priorChoice, bundle: B, plans, modes };
}
