// The cost-meter gate (DESIGN §2 "One cost meter"; M0 diagnostic D6; research/need-router-20261014/analysis/m0/REPORT.md).
// $0, pure functions plus two small file readers; no model call, no network.
//
// The problem D6 found. label-run prices an agent session from per-message usage lines (messageUsageOf) or, failing that, from the stream
// aggregate. In every archived transcript those lines carry a start-of-message snapshot of the output tokens (a few dozen per session against
// tens of thousands in the CLI's final result usage), so a re-price lands 2.1 to 3 times under the CLI's own figure for Opus agents. The stage
// cap is safe (it meters max(reported, re-priced), prereg-rules.mjs capMeter), but utility uses the re-priced figure, so an under-priced agent-O
// looks cheap and biases the label toward no-workflow; and because label-run books a re-price from message usage as `measured`, the shortfall
// does not count as imputed either, so the 30%-imputed rule never catches it.
//
// What this module adds, in three layers:
//   1. D6 builds `summary.meterGate` here (buildMeterGate): status `block-until-verified` while the archived evidence shows the mismatch.
//   2. label-run refuses to START a paid stage that has an agent arm while the committed gate blocks and no passing verification record is on file
//      (meterGateDecision). A verification record is made at $0 from saved CLI transcripts: `node experiments/need-router/meter-gate-cli.mjs --verify
//      <transcript.jsonl>... --write research/need-router-20261014/analysis/m0/meter-verification.json`.
//   3. label-run checks EVERY priced agent session (outputTokenCheck): per-message output tokens within `OUTPUT_TOLERANCE` of the final result usage.
//      A session that fails is repaired from the one complete count there is, when that can be shown to work: the output tokens the lines miss (final
//      usage minus the lines' sum) are priced at their own tiers' output rates and added to the re-price, and the session is accepted as `measured`
//      (flagged `outputFromFinal`) only if the result lands within `PRICE_BAND` of the CLI-reported cost. Otherwise, or with no final usage to compare
//      with, it is booked at the reported figure: the shortfall of the re-price against it is imputed (guardMeter), flagged `meterUnverified`, and counts
//      toward the 30% rule. Nothing is repaired silently, and nothing is accepted that the CLI's own figure does not corroborate.
//      The same logic decides a verification record, so the gate can clear on real CLI transcripts whether their lines are accurate or snapshots.
//
// The gate fails CLOSED (review of 2026-10-15). A stage with an agent arm is refused when there is no gate to read: a diagnostics.json that is missing, does
// not parse, is a partial run without D6 (run.mjs --only) or carries no recognised gate; a gate whose status is anything but `clear` or `block-until-verified`
// is refused too. The only way past a missing gate is the owner's logged waiver (meter-gate-waiver.json, schema need-meter-gate-waiver/1, by `owner`, with a
// reason and a date), which label-run records in report.deviations. label-run reads the gate from the committed HEAD blob, as it reads the preregistration, and
// refuses an agent stage while the working-tree diagnostics.json differs from that blob, so an uncommitted regeneration cannot change whether a paid stage starts.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const M0_DIR = path.join(REPO, 'research/need-router-20261014/analysis/m0');
export const DIAGNOSTICS_FILE = path.join(M0_DIR, 'diagnostics.json');
export const VERIFICATION_FILE = path.join(M0_DIR, 'meter-verification.json');
export const WAIVER_FILE = path.join(M0_DIR, 'meter-gate-waiver.json');
export const WAIVER_SCHEMA = 'need-meter-gate-waiver/1';
export const METER_GATE_SCHEMA = 'need-meter-gate/1';
export const VERIFICATION_SCHEMA = 'need-meter-verification/1';
export const OUTPUT_TOLERANCE = 0.05;     // per-message output tokens within 5% of the CLI's final result usage
export const PRICE_BAND = 0.10;           // a re-price within 10% of the CLI's own figure, per model and era
export const MIN_ERA_SESSIONS = 3;        // a model-era with fewer sessions does not trip the price band
export const MIN_VERIFY_SESSIONS = 2;     // a verification record needs this many transcripts, all within tolerance
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const round = (x, d = 4) => (num(x) === null ? x : Math.round(x * 10 ** d) / 10 ** d);

/**
 * The gate from D6's evidence (pure). outputRatios: [{label, model, recorded, final}] (output tokens in the stream or per-message record against the
 * CLI's final result usage, where both are known); eraRatios: [{key, sessions, ratio}] (CLI-reported total over the token re-price, summed per model
 * and cache era). status `block-until-verified` when any session records output tokens outside OUTPUT_TOLERANCE of the final figure, or any model-era
 * with at least MIN_ERA_SESSIONS sessions re-prices outside PRICE_BAND of the reported figure.
 */
export function buildMeterGate({ outputRatios = [], eraRatios = [] } = {}) {
  const reasons = [];
  const scored = outputRatios.filter(r => num(r.recorded) !== null && num(r.final) > 0).map(r => ({ ...r, gap: Math.abs(r.final - r.recorded) / r.final }));
  const under = scored.filter(r => r.gap > OUTPUT_TOLERANCE);
  if (under.length) {
    reasons.push({
      code: 'OUTPUT_TOKENS_UNDER_RECORDED',
      detail: `${under.length} of ${scored.length} sessions with a final usage record output tokens in the stream or per-message lines more than ${OUTPUT_TOLERANCE * 100}% away from the CLI's final result usage (median recorded/final ${round(median(scored.map(r => r.recorded / r.final)), 4)})`,
      sessions: under.length, of: scored.length, medianRecordedOverFinal: round(median(scored.map(r => r.recorded / r.final)), 4),
    });
  }
  const off = eraRatios.filter(e => e.sessions >= MIN_ERA_SESSIONS && num(e.ratio) !== null && (e.ratio > 1 + PRICE_BAND || e.ratio < 1 - PRICE_BAND));
  if (off.length) {
    reasons.push({
      code: 'REPRICE_OFF_REPORTED',
      detail: `${off.length} model-era groups re-price outside ${PRICE_BAND * 100}% of the CLI-reported total: ${off.map(e => `${e.key} ${round(e.ratio, 2)}x`).join(', ')}`,
      groups: off.map(e => ({ key: e.key, sessions: e.sessions, ratioReportedOverReprice: round(e.ratio, 3) })),
    });
  }
  return {
    schema: METER_GATE_SCHEMA,
    status: reasons.length ? 'block-until-verified' : 'clear',
    rule: { outputTolerance: OUTPUT_TOLERANCE, priceBand: PRICE_BAND, minEraSessions: MIN_ERA_SESSIONS, minVerifySessions: MIN_VERIFY_SESSIONS },
    reasons,
    blocks: reasons.length ? 'a paid stage with an agent arm (agent-H, agent-O, agent-H+proc, construct-H, build-O): label-run.mjs refuses to start it' : null,
    clearedBy: reasons.length ? `a passing meter-verification record: node experiments/need-router/meter-gate-cli.mjs --verify <transcript>... --write ${path.relative(REPO, VERIFICATION_FILE)}, on at least ${MIN_VERIFY_SESSIONS} saved CLI transcripts, each either with per-message output tokens within ${OUTPUT_TOLERANCE * 100}% of the final result usage or with a re-price that takes its output tokens from the final usage and lands within ${PRICE_BAND * 100}% of the CLI-reported cost; until then every agent session label-run prices is checked individually and a session that passes neither test is booked at the reported figure` : null,
  };
}
function median(xs) { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; }

/**
 * The gate in the text of a diagnostics.json: { gate, problem }. `gate` is D6's summary.meterGate when it carries the gate schema and a status; otherwise null
 * and `problem` says why there is none (it does not parse, it is a partial run, it has no D6 section, the gate is malformed).
 */
export function parseMeterGate(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { gate: null, problem: `diagnostics.json does not parse (${String(e.message).slice(0, 80)})` }; }
  const gate = doc?.d6?.summary?.meterGate ?? null;
  if (gate && typeof gate === 'object' && gate.schema === METER_GATE_SCHEMA && typeof gate.status === 'string') return { gate, problem: null };
  if (gate) return { gate: null, problem: 'diagnostics.json carries a d6.summary.meterGate that is not a need-meter-gate/1 record with a status' };
  if (doc?.partial) return { gate: null, problem: `diagnostics.json is a partial run (${(doc.partial.ran ?? []).join(', ')} only) with no D6 section` };
  return { gate: null, problem: 'diagnostics.json has no d6.summary.meterGate' };
}
/** { gate, problem } of the working-tree diagnostics file (or `file`). */
export function readMeterGateFile(file = DIAGNOSTICS_FILE) {
  if (!existsSync(file)) return { gate: null, problem: 'diagnostics.json is missing' };
  return parseMeterGate(readFileSync(file, 'utf8'));
}
/** The working-tree gate (D6's summary.meterGate), or null when the diagnostics file is absent, unparseable or has no D6. For display: label-run does not trust this (see readCommittedMeterGate). */
export function readMeterGate(file = DIAGNOSTICS_FILE) { return readMeterGateFile(file).gate; }

/** The blob of `file` at HEAD (a Buffer), or null when git or the committed file is not there. */
export function gitHeadBlob(file, { repo = REPO } = {}) {
  try {
    const rel = path.relative(repo, path.resolve(file));
    if (rel.startsWith('..')) return null;
    return execFileSync('git', ['show', `HEAD:${rel.split(path.sep).join('/')}`], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  } catch { return null; }
}
/**
 * The gate label-run trusts: read from the committed HEAD blob of diagnostics.json, the way label-run reads the preregistration. { gate, problem, dirty, source }:
 * `dirty` is a reason when the working-tree file is missing or differs from that blob (an uncommitted regeneration), else null. `file` and `show` (the HEAD reader) are injected by tests.
 */
export function readCommittedMeterGate({ file = DIAGNOSTICS_FILE, repo = REPO, show = gitHeadBlob } = {}) {
  const blob = show(file, { repo });
  if (!blob) return { gate: null, problem: 'diagnostics.json is not committed at HEAD', dirty: null, source: 'HEAD' };
  const { gate, problem } = parseMeterGate(blob.toString('utf8'));
  const work = existsSync(file) ? readFileSync(file) : null;
  const dirty = work === null ? 'the working-tree diagnostics.json is missing (deleted since HEAD)' : Buffer.compare(Buffer.from(blob), work) !== 0 ? 'the working-tree diagnostics.json differs from its committed HEAD blob (an uncommitted regeneration): commit or restore it before a paid stage with an agent arm' : null;
  return { gate, problem, dirty, source: 'HEAD' };
}
/** The owner's waiver for a missing gate: valid only with the schema, `by: 'owner'`, a reason of at least 10 characters and a date. */
export const waiverValid = w => !!w && w.schema === WAIVER_SCHEMA && w.by === 'owner' && typeof w.reason === 'string' && w.reason.trim().length >= 10 && Number.isFinite(Date.parse(w.at));
/** The waiver at HEAD (committed: it is a decision the repository records), or null. */
export function readCommittedWaiver({ file = WAIVER_FILE, repo = REPO, show = gitHeadBlob } = {}) {
  const blob = show(file, { repo });
  if (!blob) return null;
  try { return JSON.parse(blob.toString('utf8')); } catch { return null; }
}
/** The verification record on file (or at `file`), or null. */
export function readVerification(file = VERIFICATION_FILE) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
/** True for an arm definition (stages.json arms[...]) that runs an agent session: b0Agent, a construct-H or build-O builder session, or an agent-H+proc run. */
export const isAgentArmDef = def => !!def && (def.factory === 'b0Agent' || def.run?.factory === 'b0Agent' || def.build?.factory === 'construct');

/**
 * May a paid stage with these arms start? arms: arm definitions (or ids resolved by the caller). Returns { allow, why, gate }.
 * Allowed when no arm is an agent arm, when the gate is clear, or when the gate blocks and a passing verification record is on file. Refused when the
 * working-tree diagnostics.json differs from its committed blob (`dirty`), when there is no gate to read (`problem` says why) unless the owner's logged
 * `waiver` is valid (the result is then `waived: true` and carries the waiver, which label-run records as a deviation), and for any other gate status.
 */
export function meterGateDecision({ gate, verification = null, arms = [], waiver = null, problem = null, dirty = null }) {
  const agent = arms.filter(isAgentArmDef);
  if (!agent.length) return { allow: true, why: 'no agent arm in this stage', gate: gate?.status ?? null };
  if (dirty) return { allow: false, gate: gate?.status ?? null, why: `the cost-meter gate is read from the committed HEAD blob and ${dirty}` };
  if (!gate) {
    const what = `no D6 meter gate on file (${problem ?? 'diagnostics.json has no d6.summary.meterGate'})`;
    if (waiverValid(waiver)) return { allow: true, waived: true, waiver, gate: null, why: `${what}; the owner's waiver of ${waiver.at} is logged: ${waiver.reason}` };
    return { allow: false, gate: null, why: `${what}: a stage with an agent arm is refused without a gate. Run node experiments/need-router/diagnostics/run.mjs --report in full and commit it, or log the owner's waiver (${path.relative(REPO, WAIVER_FILE)}, schema ${WAIVER_SCHEMA}, by owner, with a reason and a date)` };
  }
  if (gate.status === 'clear') return { allow: true, why: `meter gate ${gate.status}`, gate: gate.status };
  if (gate.status !== 'block-until-verified') return { allow: false, gate: gate.status, why: `the cost-meter gate has an unrecognised status ${JSON.stringify(gate.status)} (expected clear or block-until-verified): refused` };
  if (verificationPasses(verification)) return { allow: true, why: `meter gate block-until-verified, cleared by a passing verification record (${verification.sessions.length} transcripts)`, gate: gate.status };
  return { allow: false, gate: gate.status, why: `the cost-meter gate is block-until-verified (${(gate.reasons ?? []).map(r => r.code).join(', ')}) and no passing meter-verification record is on file: ${gate.clearedBy}` };
}

/**
 * Per-session assertion: the output tokens a re-price would see (the sum over per-message usage lines [input, output, cacheRead, cacheWrite, model],
 * else the stream aggregate) against the CLI's final result usage. checked is false when there is nothing to compare with; that is a failure of
 * verification, not a pass.
 */
export function outputTokenCheck({ messageUsage = null, streamUsage = null, finalUsage = null } = {}, { tolerance = OUTPUT_TOLERANCE } = {}) {
  const recorded = Array.isArray(messageUsage) ? messageUsage.reduce((a, m) => a + (num(m[1]) ?? 0), 0) : num(streamUsage?.outputTokens);
  const final = num(finalUsage?.output_tokens) ?? num(finalUsage?.outputTokens);
  if (recorded === null || final === null) return { checked: false, ok: false, recorded, final, reason: recorded === null ? 'no recorded usage' : 'no final result usage to compare with' };
  const relGap = final === 0 ? (recorded === 0 ? 0 : 1) : Math.abs(final - recorded) / final;
  return { checked: true, ok: relGap <= tolerance, recorded, final, relGap: round(relGap, 4) };
}

/**
 * USD of `missing` output tokens, spread over the per-message lines [input, output, cacheRead, cacheWrite, model] in proportion to (output + 1), each at
 * its own request's output rate (outputRateOf(line) -> USD per output token, or null when the model is not priced). null when a rate is unknown.
 */
export function missingOutputUsd(messageUsage, missing, outputRateOf) {
  if (!Array.isArray(messageUsage) || !messageUsage.length || !(missing > 0)) return 0;
  const w = messageUsage.map(m => (num(m[1]) ?? 0) + 1), tot = w.reduce((a, x) => a + x, 0);
  let usd = 0;
  for (let i = 0; i < messageUsage.length; i++) {
    const r = outputRateOf(messageUsage[i]);
    if (num(r) === null) return null;
    usd += (missing * w[i] / tot) * r;
  }
  return usd;
}

/**
 * Apply the per-session check to a priced session ({ measured, imputed, ... } as label-run.priceSession returns it):
 *   - lines within tolerance of the final usage: unchanged (meterCheck attached);
 *   - lines short of the final usage and outputRateOf given: the missing output tokens are priced and added; if the corrected re-price is within `band`
 *     of the reported figure it is accepted as measured, flagged `outputFromFinal`;
 *   - anything else (no final usage, a correction the reported figure does not corroborate): booked at the reported figure, the re-price's shortfall
 *     imputed, flagged `meterUnverified` with the check.
 * Total charged = measured + imputed is never below the reported figure on the unverified path.
 */
export function guardMeter(cost, input, { reportedUsd = 0, tolerance = OUTPUT_TOLERANCE, band = PRICE_BAND, outputRateOf = null } = {}) {
  const check = outputTokenCheck(input, { tolerance });
  if (check.ok) return { ...cost, meterCheck: check };
  const reported = num(reportedUsd) ?? 0;
  if (outputRateOf && check.checked && check.final > check.recorded && Array.isArray(input.messageUsage) && reported > 0 && cost.imputed === 0) {
    const extra = missingOutputUsd(input.messageUsage, check.final - check.recorded, outputRateOf);
    if (extra !== null) {
      const corrected = cost.measured + extra, relErr = Math.abs(corrected - reported) / reported;
      if (relErr <= band) return { ...cost, measured: corrected, ...(cost.tokens ? { tokens: { ...cost.tokens, outputTokens: check.final } } : {}), outputFromFinal: true, meterCheck: { ...check, correctedUsd: round(corrected, 6), reportedUsd: round(reported, 6), relErr: round(relErr, 4) } };
    }
  }
  const total = cost.measured + cost.imputed;
  const gap = Math.max(0, reported - total);
  return { ...cost, imputed: cost.imputed + gap, meterUnverified: true, meterGapUsd: gap, meterCheck: check };
}

// ------------------------------------------------------------------------------------------------ saved transcripts
/** A stream-json transcript: the last usage per assistant message id as [input, output, cacheRead, cacheWrite, model] lines (the shape of messageUsageOf),
 *  the final result event's usage and reported cost, and the model. */
export function transcriptUsage(text) {
  const byMsg = new Map();
  let result = null, model = null;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e?.type === 'assistant' && e.message?.id && e.message.usage) { byMsg.set(e.message.id, { model: e.message.model ?? null, u: e.message.usage }); model ??= e.message.model ?? null; }
    else if (e?.type === 'result') result = e;
  }
  const messageUsage = [...byMsg.values()].map(({ model: m, u }) => [u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, m]);
  return {
    messages: messageUsage.length, messageUsage, recorded: messageUsage.reduce((a, m) => a + (num(m[1]) ?? 0), 0),
    final: num(result?.usage?.output_tokens), finalUsage: result?.usage ?? null, reportedUsd: num(result?.total_cost_usd), hasResult: !!result, model,
    cacheWrite1hShare: cacheWrite1hShare(result?.usage),
  };
}
/** The share of cache-write tokens the CLI's final usage records as 1-hour writes (billed at 2 x input, against 1.25 x for 5-minute writes), or null. */
export function cacheWrite1hShare(usage) {
  const cc = usage?.cache_creation;
  if (!cc) return null;
  const w1 = num(cc.ephemeral_1h_input_tokens) ?? 0, w5 = num(cc.ephemeral_5m_input_tokens) ?? 0;
  return w1 + w5 > 0 ? round(w1 / (w1 + w5), 3) : null;
}
/** A record passes when it has the schema, at least MIN_VERIFY_SESSIONS transcripts, and every session is re-derived as accepted here (not trusted from `ok`):
 *  per-message output tokens within `tolerance` of the final usage, or (method final-output) the corrected re-price within `band` of the reported cost. */
export function verificationPasses(v, { tolerance = OUTPUT_TOLERANCE, band = PRICE_BAND } = {}) {
  if (!v || v.schema !== VERIFICATION_SCHEMA || !Array.isArray(v.sessions) || v.sessions.length < MIN_VERIFY_SESSIONS) return false;
  return v.sessions.every(s => {
    if (s.method === 'per-message') return num(s.recorded) !== null && num(s.final) > 0 && Math.abs(s.final - s.recorded) / s.final <= tolerance;
    if (s.method === 'final-output') return num(s.reportedUsd) > 0 && num(s.pricedUsd) !== null && Math.abs(s.pricedUsd - s.reportedUsd) / s.reportedUsd <= band && num(s.final) > 0;
    return false;
  });
}
/**
 * The verification record for some saved transcripts ($0). Each is priced by the very code label-run uses (priceSession(table, model, input), injected so this
 * module needs no label-run import): accepted as `per-message` when its lines match the final usage, as `final-output` when the missing output tokens
 * priced from the final usage land within the price band of the reported cost, otherwise `unverified`.
 */
export function verifyTranscripts(files, { priceSession, table, tolerance = OUTPUT_TOLERANCE, read = f => readFileSync(f, 'utf8') } = {}) {
  if (typeof priceSession !== 'function') throw new Error('verifyTranscripts needs label-run\'s priceSession and the pinned price table');
  const sessions = files.map(f => {
    const text = read(f), u = transcriptUsage(text);
    const cost = u.hasResult && u.model ? priceSession(table, u.model, { messageUsage: u.messageUsage, reportedUsd: u.reportedUsd ?? 0, finalUsage: u.finalUsage, meter: { tolerance } }) : null;
    const method = !cost ? 'unverified' : cost.meterUnverified ? 'unverified' : cost.outputFromFinal ? 'final-output' : 'per-message';
    const pricedUsd = cost ? cost.measured + cost.imputed : null;
    return {
      file: path.basename(f), sha256: createHash('sha256').update(text).digest('hex').slice(0, 16), model: u.model, messages: u.messages, recorded: u.recorded, final: u.final,
      reportedUsd: u.reportedUsd === null ? null : round(u.reportedUsd, 6), pricedUsd: pricedUsd === null ? null : round(pricedUsd, 6), method,
      relGap: cost?.meterCheck?.relGap ?? null, cacheWrite1hShare: u.cacheWrite1hShare, ok: method !== 'unverified',
      // Why a session whose output tokens were repaired still missed the CLI's figure: the pinned table prices cache writes at the 5-minute rate.
      ...(method === 'unverified' && (u.cacheWrite1hShare ?? 0) >= 0.5 ? { hint: 'the CLI billed the cache writes at the 1-hour rate (2 x input), the pinned table prices them at the 5-minute rate (1.25 x): set FORCE_PROMPT_CACHING_5M=1 in the shell that launches the stage (an executor session keeps only what the shell sets), or revise the table by a recorded deviation' } : {}),
    };
  });
  const record = { schema: VERIFICATION_SCHEMA, tolerance, priceBand: PRICE_BAND, sessions };
  return { ...record, passed: verificationPasses(record, { tolerance }) };
}
