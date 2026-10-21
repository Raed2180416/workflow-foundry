// The need router: does this request need a workflow, and which kind? (ROUTER-1, research/need-router-20261014/router1/)
//
//   needCheck(text, { sensitivity, context })            code only, $0, microseconds: primitives -> calibrated p -> mode
//   needDecide(text, { sensitivity, context, judge })   the same, and a cheap typed judge ONLY when p falls in the middle
//                                                       band [t(s) - delta, t(s)); the judge can raise a request into the
//                                                       workflow class, never lower one (the code's never-trigger guarantee
//                                                       on its calibration set holds for everything above the band)
//
// Modes: none (just do it), checklist (one sitting, but a short plan and a verify step: irreversible effect), workflow (a
// durable, checkable process: waits, policy over items with effects, a rule-bound program, a staged rollout), recurring (a
// workflow that runs on a schedule or trigger). needsWorkflow = mode is workflow or recurring.
//
// The slider: sensitivity s in [0, 1], default 0.5. t(0) = 1 (never triggers), t(0.5) = the calibrated default, t(1) = 0
// (always triggers), linear in between (PREREG-ROUTER-1 §2). The parameters are fitted on the ROUTER-1 dev split only
// (experiments/need-router/router1/fit.mjs) and frozen in params.json; paramsSha names them in every decision.
//
// The request text is data, never instructions: it is matched by the detectors and, in the middle band only, fenced into the
// judge's typed question (judge-prompt.mjs).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { detectPrimitives, FEATURES, PRIMITIVES, DAMPENERS, DETECTOR_VERSION } from './primitives.mjs';
import { SYSTEM, judgePrompt, JUDGE_SCHEMA, readJudgeAnswer, MODES, NEEDS_WORKFLOW } from './judge-prompt.mjs';

export const DECISION_SCHEMA = 'foundry.need-decision/1';
export const DEFAULT_SENSITIVITY = 0.5;
export { MODES, NEEDS_WORKFLOW, PRIMITIVES, DAMPENERS };

const PARAMS_URL = new URL('./params.json', import.meta.url);
let cached = null;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function paramsSha(params) { return createHash('sha256').update(canonical(params)).digest('hex'); }

export function validateParams(params) {
  const problems = [];
  if (!params || typeof params !== 'object') return ['params must be an object'];
  for (const f of FEATURES) if (!Number.isFinite(params.weights?.[f])) problems.push(`weights.${f} must be a number`);
  for (const f of PRIMITIVES) if (params.weights?.[f] < 0) problems.push(`weights.${f} must be >= 0 (a primitive only raises need)`);
  for (const f of DAMPENERS) if (params.weights?.[f] > 0) problems.push(`weights.${f} must be <= 0 (a dampener only lowers need)`);
  if (!Number.isFinite(params.bias)) problems.push('bias must be a number');
  if (!(params.tDefault > 0 && params.tDefault < 1)) problems.push('tDefault must be in (0, 1)');
  if (params.detector !== DETECTOR_VERSION) problems.push(`params were fitted for ${params.detector}, the detectors are ${DETECTOR_VERSION}`);
  const m = params.middle ?? {};
  if (!(Number.isFinite(m.delta) && m.delta >= 0 && m.delta < 1)) problems.push('middle.delta must be in [0, 1)');
  return problems;
}

/** The frozen parameters (params.json next to this file), validated once. */
export function loadParams() {
  if (cached) return cached;
  const params = JSON.parse(readFileSync(PARAMS_URL, 'utf8'));
  const problems = validateParams(params);
  if (problems.length) throw Object.assign(new Error(`need router params invalid: ${problems.join('; ')}`), { code: 'NEED_PARAMS' });
  cached = Object.freeze({ ...params, sha: paramsSha(params) });
  return cached;
}

/** Threshold for a sensitivity s in [0, 1]: t(0) = 1, t(0.5) = tDefault, t(1) = 0, linear in between. */
export function thresholdAt(sensitivity, tDefault) {
  const s = Math.min(1, Math.max(0, Number.isFinite(sensitivity) ? sensitivity : DEFAULT_SENSITIVITY));
  if (s === 0) return 1;
  if (s === 0.5) return tDefault;            // exact at the anchor points (v1 computed 1 - (1 - t), off by one ulp)
  if (s === 1) return 0;
  return s < 0.5 ? tDefault + (1 - tDefault) * (1 - 2 * s) : tDefault * (2 - 2 * s);
}

/** p(needs a workflow) from detector features: logistic in the weighted features. */
export function scoreFeatures(features, params) {
  let z = params.bias;
  for (const f of FEATURES) z += (params.weights[f] ?? 0) * (features[f] ?? 0);
  return 1 / (1 + Math.exp(-z));
}

const LABEL = { recurrence: 'repeats on a schedule or trigger', waits: 'waits on people or events', effects: 'acts on outside systems',
  multiParty: 'involves several systems or people', rules: 'must follow written rules', volume: 'applies to many items', audit: 'needs a record of what was done',
  reuse: 'is likely to be reused', question: 'is a question or a writing/analysis task', mention: 'talks about a process rather than running one',
  hypothetical: 'is hypothetical', singleAction: 'is a single action', coding: 'is a coding or configuration task' };

function explain(mode, primitives, dampeners) {
  const top = primitives.slice(0, 3).map(x => `${LABEL[x.name]} (“${x.cues[0]?.match ?? ''}”)`);
  const damp = dampeners.slice(0, 2).map(x => LABEL[x.name]);
  const head = { none: 'No workflow: just do it.', checklist: 'No workflow, but use a short checklist with a verify step: it has an irreversible effect.',
    workflow: 'Build a workflow first.', recurring: 'Build a recurring workflow.' }[mode];
  return [head, top.length ? `It ${top.join('; ')}.` : '', damp.length ? `Against: it ${damp.join('; ')}.` : ''].filter(Boolean).join(' ');
}

/** Code-only decision. $0; no network. */
export function needCheck(text, { sensitivity = DEFAULT_SENSITIVITY, context = {}, params = loadParams() } = {}) {
  const t0 = process.hrtime.bigint();
  const d = detectPrimitives(text, context);
  const p = scoreFeatures(d.features, params);
  const threshold = thresholdAt(sensitivity, params.tDefault);
  const delta = params.middle?.delta ?? 0;
  const needsWorkflow = p >= threshold;
  const rules = params.modeRules ?? {};
  const strongDampener = ['question', 'mention', 'hypothetical'].some(k => d.features[k] >= (rules.dampenerMax ?? 0.5));
  const mode = needsWorkflow ? (d.features.recurrence >= (rules.recurrenceMin ?? 0.5) ? 'recurring' : 'workflow')
    : (d.irreversible.score >= (rules.irreversibleMin ?? 0.8) && !strongDampener ? 'checklist' : 'none');
  const rank = names => names.map(name => ({ name, score: d.features[name], cues: d.evidence[name].map(h => ({ id: h.id, match: h.match })) }))
    .filter(x => x.score > 0).sort((a, b) => b.score * Math.abs(params.weights[b.name]) - a.score * Math.abs(params.weights[a.name]));
  const primitives = rank(PRIMITIVES), dampeners = rank(DAMPENERS);
  return {
    schema: DECISION_SCHEMA, needsWorkflow, mode, p: round(p), threshold: round(threshold), sensitivity, band: p >= threshold ? 'above' : p >= threshold - delta ? 'middle' : 'below',
    decidedBy: 'code', why: explain(mode, primitives, dampeners), primitives, dampeners, irreversible: d.irreversible.hits.map(h => ({ id: h.id, match: h.match })),
    features: d.features, router: { detector: d.detector, paramsSha: params.sha ?? paramsSha(params), costUsd: 0, latencyMs: Number(process.hrtime.bigint() - t0) / 1e6 }
  };
}

/**
 * Code decision, plus a typed judge for the middle band only.
 * @param {(text: string) => Promise<{mode: string, p: number, costUsd?: number, latencyMs?: number, model?: string}>} [judge]
 *   any judge answering the judge-prompt question (modelJudge below wraps a ModelPort). Omitted or delta 0: code only.
 */
export async function needDecide(text, { sensitivity = DEFAULT_SENSITIVITY, context = {}, params = loadParams(), judge = null, delta = params.middle?.delta ?? 0 } = {}) {
  const card = needCheck(text, { sensitivity, context, params: { ...params, middle: { ...(params.middle ?? {}), delta } } });
  if (!judge || !(delta > 0) || card.band !== 'middle') return card;
  let answer = null, fault = null;
  try { answer = await judge(text); } catch (e) { fault = { code: e.code ?? 'JUDGE_ERROR', message: String(e.message ?? e).slice(0, 200) }; }
  const read = answer && MODES.includes(answer.mode) ? answer : null;
  if (!read) return { ...card, decidedBy: 'code (judge fault)', judge: { fault: fault ?? { code: 'JUDGE_ANSWER', message: 'unreadable answer' } } };
  const judged = NEEDS_WORKFLOW.has(read.mode);
  const out = { ...card, judge: { model: read.model ?? null, mode: read.mode, p: read.p ?? null, costUsd: read.costUsd ?? null, latencyMs: read.latencyMs ?? null } };
  if (!judged) return { ...out, decidedBy: `code (judge agreed: ${read.mode})` };
  return { ...out, needsWorkflow: true, mode: read.mode, decidedBy: `judge:${read.model ?? 'unnamed'}`, why: `${explain(read.mode, card.primitives, card.dampeners)} (Close call: a cheap judge decided.)` };
}

/** A judge over a ModelPort (Haiku via the Claude CLI, or Mercury): the one typed question of judge-prompt.mjs. */
export function modelJudge({ port, modelId, runId = 'need-router', salt = null, maxTokens = 1000 }) {
  let n = 0;
  return async text => {
    const r = await port.call({ runId, nodeKey: 'need-judge', sampleIndex: 0, attempt: n++, modelId, system: SYSTEM, prompt: judgePrompt(text), schema: JUDGE_SCHEMA,
      decoding: { maxTokens, reasoning: 'none' }, ...(salt ? { salt } : {}) });
    const a = r.ok ? readJudgeAnswer(r.value) : null;
    if (!a) throw Object.assign(new Error(r.error?.message ?? 'unreadable judge answer'), { code: r.error?.code ?? 'JUDGE_ANSWER' });
    return { ...a, model: modelId, costUsd: r.costUsd ?? null, latencyMs: r.latencyMs ?? null };
  };
}

function round(x) { return Math.round(x * 1e4) / 1e4; }
