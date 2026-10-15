// Tests for the cost-meter gate (experiments/need-router/meter-gate.mjs; D6 of the M0 diagnostics; label-run.mjs priceSession, matrixRow and
// paidRunChecks). D6 found that an agent session re-priced from its per-message usage lines is under-priced (the lines carry a start-of-message
// snapshot of the output tokens), and that label-run booked the shortfall as `measured`, so neither the utility nor the 30%-imputed rule saw it.
//   node --test experiments/need-router/test/meter-gate.test.mjs
// $0: synthetic usage and transcripts, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as G from '../meter-gate.mjs';
import * as LR from '../label-run.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const P = JSON.parse(readFileSync(path.join(REPO, 'research/need-router-20261014/prereg/stages.json'), 'utf8')).priceTable;
const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPUS = 'claude-opus-5-5', HAIKU = 'claude-haiku-5-5';
const OK_OUT = ['a', 'b', 'c', 'd'].map(label => ({ label, recorded: 39000, final: 40000 }));      // four builder sessions inside the tolerance
const era = (opus, haiku = 1.0, n = 47) => [{ key: `${OPUS} | post-flag`, sessions: n, ratio: opus }, { key: `${HAIKU} | post-flag`, sessions: n, ratio: haiku }];
const EV = { requiredModels: [OPUS, HAIKU], priceTable: P.id };
const BLOCK = G.buildMeterGate({ outputRatios: [{ label: 'a', recorded: 150, final: 40000 }, { label: 'b', recorded: 300, final: 60000 }], eraRatios: era(2.96), ...EV });
const CLEAR = G.buildMeterGate({ outputRatios: OK_OUT, eraRatios: era(1.02), ...EV });
const AGENT_O = { factory: 'b0Agent', model: OPUS };
// A verification record as meter-gate-cli --verify writes it (schema /2): two verifying sessions of the one model, under the stage's table.
const sess = (model, extra = {}) => ({ file: 's.jsonl', path: '/x/s.jsonl', sha256: 'a'.repeat(64), model, recorded: 990, final: 1000, reportedUsd: 1, pricedUsd: 1.02, method: 'per-message', ok: true, ...extra });
const REC = (extra = {}) => ({ schema: G.VERIFICATION_SCHEMA, priceTable: { id: P.id }, models: [OPUS], sessions: [sess(OPUS), sess(OPUS, { recorded: 5000, final: 5100 })], ...extra });
const REDERIVED = () => ({ ok: true, problems: [] });

test('buildMeterGate: block-until-verified on output tokens far from the final usage or a re-price off the reported total; clear only inside both bands and with enough evidence', () => {
  assert.equal(BLOCK.schema, G.METER_GATE_SCHEMA);
  assert.equal(BLOCK.status, 'block-until-verified');
  assert.deepEqual(BLOCK.reasons.map(r => r.code), ['OUTPUT_TOKENS_UNDER_RECORDED', 'REPRICE_OFF_REPORTED']);
  assert.match(BLOCK.blocks, /agent arm/);
  assert.match(BLOCK.clearedBy, /meter-gate-cli\.mjs --verify/);
  assert.equal(CLEAR.status, 'clear'); assert.deepEqual(CLEAR.reasons, []); assert.deepEqual(CLEAR.gaps, []); assert.equal(CLEAR.blocks, null);
  assert.deepEqual([CLEAR.priceTable, CLEAR.requiredModels, CLEAR.rule], [P.id, [HAIKU, OPUS], G.currentRule()]);
  // Only the output rule, only the price rule: a mismatch is a block whatever else is missing.
  assert.deepEqual(G.buildMeterGate({ outputRatios: [{ recorded: 10, final: 1000 }] }).reasons.map(r => r.code), ['OUTPUT_TOKENS_UNDER_RECORDED']);
  assert.deepEqual(G.buildMeterGate({ eraRatios: [{ key: 'k', sessions: 5, ratio: 0.8 }] }).reasons.map(r => r.code), ['REPRICE_OFF_REPORTED']);
  assert.equal(G.buildMeterGate({ outputRatios: OK_OUT, eraRatios: era(3), ...EV }).status, 'block-until-verified');
});

test('buildMeterGate fails closed on no evidence: nothing, a thin model-era, too few builder sessions or a model with no era group is insufficient-evidence, never clear (review of 2026-10-15)', () => {
  // The two cases the old tests locked in as `clear`.
  assert.equal(G.buildMeterGate().status, 'insufficient-evidence');
  const thin = G.buildMeterGate({ eraRatios: [{ key: 'k', sessions: 2, ratio: 3 }] });
  assert.equal(thin.status, 'insufficient-evidence'); assert.deepEqual(thin.reasons, [], 'a model-era under 3 sessions still cannot trip the price band');
  assert.deepEqual(thin.gaps.map(g => g.code), ['TOO_FEW_BUILDER_SESSIONS', 'NO_REQUIRED_MODELS']);
  const status = (x = {}) => G.buildMeterGate({ outputRatios: OK_OUT, eraRatios: era(1.02), ...EV, ...x });
  assert.equal(status().status, 'clear');
  // Each condition on its own.
  const few = status({ outputRatios: OK_OUT.slice(0, G.MIN_BUILDER_SESSIONS - 1) });
  assert.equal(few.status, 'insufficient-evidence'); assert.deepEqual(few.gaps.map(g => g.code), ['TOO_FEW_BUILDER_SESSIONS']); assert.equal(few.gaps[0].have, G.MIN_BUILDER_SESSIONS - 1);
  const unscored = status({ outputRatios: [...OK_OUT.slice(0, 3), { label: 'x', recorded: null, final: 40000 }, { label: 'y', recorded: 5, final: 0 }] });
  assert.equal(unscored.status, 'insufficient-evidence', 'a session with no recorded or no final output is not a scored session');
  const noHaiku = status({ eraRatios: [{ key: `${OPUS} | post-flag`, sessions: 47, ratio: 1.0 }] });
  assert.equal(noHaiku.status, 'insufficient-evidence'); assert.deepEqual(noHaiku.gaps.map(g => [g.code, g.model]), [['NO_ERA_GROUP_FOR_MODEL', HAIKU]]);
  const thinHaiku = status({ eraRatios: era(1.0).map(e => (e.key.startsWith(HAIKU) ? { ...e, sessions: G.MIN_ERA_SESSIONS - 1 } : e)) });
  assert.deepEqual(thinHaiku.gaps.map(g => [g.code, g.model, g.largest]), [['NO_ERA_GROUP_FOR_MODEL', HAIKU, G.MIN_ERA_SESSIONS - 1]]);
  assert.equal(status({ requiredModels: [] }).status, 'insufficient-evidence', 'without the list of models the gate cannot say each is covered');
  assert.equal(status({ eraRatios: [...era(1.0), { key: `${HAIKU} | pre-flag`, sessions: 1, ratio: 1 }] }).status, 'clear', 'any one era group of enough sessions covers the model');
  // An insufficient gate blocks like a blocking one, and says how it is cleared.
  assert.match(few.blocks, /agent arm/); assert.match(few.clearedBy, /meter-gate-cli\.mjs --verify/);
  // The decision refuses it, with the gap named, and a verification record clears it exactly as it clears block-until-verified.
  const d = G.meterGateDecision({ gate: few, arms: [AGENT_O], priceTableId: P.id });
  assert.equal(d.allow, false); assert.match(d.why, /insufficient-evidence \(TOO_FEW_BUILDER_SESSIONS\)/);
  assert.equal(G.meterGateDecision({ gate: few, verification: REC(), arms: [AGENT_O], priceTableId: P.id, rederive: REDERIVED }).allow, true);
  // And the D6 default (no archive, no constructions) writes this gate, not a clear one.
  assert.equal(G.parseMeterGate(JSON.stringify({ d6: { summary: { meterGate: G.buildMeterGate() } } })).gate.status, 'insufficient-evidence');
});

test('the committed diagnostics.json carries the gate D6 emitted, blocking until verified', () => {
  const gate = G.readMeterGate();
  assert.ok(gate, 'analysis/m0/diagnostics.json has d6.summary.meterGate');
  assert.equal(gate.schema, G.METER_GATE_SCHEMA);
  assert.equal(gate.status, 'block-until-verified');
  assert.equal(G.readMeterGate(path.join(os.tmpdir(), 'no-such-diagnostics.json')), null);
});

test('meterGateDecision: refuses an agent stage while blocked, allows without an agent arm, with a clear gate, or with a passing verification record re-derived from its transcripts', () => {
  const agent = AGENT_O, call = { factory: 'b0Call' }, built = { build: { factory: 'construct', builderModel: HAIKU }, run: { factory: 'b1Script' } }, guided = { build: { factory: 'procedureWriter' }, run: { factory: 'b0Agent', model: HAIKU } };
  assert.deepEqual([agent, call, built, guided, { factory: 'static@v3' }].map(G.isAgentArmDef), [true, false, true, true, false]);
  assert.deepEqual(G.agentModelsOf([agent, call, built, guided, { factory: 'static@v3' }]), [HAIKU, OPUS], 'a b0Agent model, a run model and a construct builder model; calls and static arms name none');
  const no = G.meterGateDecision({ gate: BLOCK, arms: [call, agent] });
  assert.equal(no.allow, false); assert.match(no.why, /block-until-verified.*OUTPUT_TOKENS_UNDER_RECORDED/);
  assert.equal(G.meterGateDecision({ gate: BLOCK, arms: [call] }).allow, true, 'a calls-only stage (M1) does not need the agent meter');
  assert.equal(G.meterGateDecision({ gate: CLEAR, arms: [agent] }).allow, true);
  assert.equal(G.meterGateDecision({ gate: null, arms: [agent] }).allow, false, 'no gate on file: the gate fails closed (it used to allow, which let a partial diagnostics.json switch it off)');
  assert.equal(G.meterGateDecision({ gate: null, arms: [call] }).allow, true, 'a calls-only stage needs no gate');
  const clear = (v, extra = {}) => G.meterGateDecision({ gate: BLOCK, verification: v, arms: [agent], priceTableId: P.id, rederive: REDERIVED, ...extra });
  assert.equal(clear(REC()).allow, true);
  assert.match(clear(REC()).why, /re-derived from its 2 transcripts/);
  const good = REC();
  for (const bad of [null, { ...good, passed: true, sessions: [good.sessions[0]] }, { ...good, passed: true, sessions: [...good.sessions, sess(OPUS, { recorded: 100, final: 1000 })] },
    { ...good, passed: true, sessions: [...good.sessions, sess(OPUS, { method: 'unverified' })] }, { ...good, schema: 'need-meter-verification/1' }, { schema: 'x', sessions: good.sessions }]) {
    assert.equal(clear(bad).allow, false, JSON.stringify(bad)?.slice(0, 60));
  }
  assert.match(clear(null).why, /no meter-verification record is committed at HEAD/); assert.match(clear(null, { verificationProblem: 'x is in the working tree but not committed' }).why, /not committed/);
});

test('a forged or foreign verification record clears nothing: no price table id, another table, a model with no passing session, a transcript that does not re-derive (review of 2026-10-15)', () => {
  // The record the review forged: two sessions that say recorded === final, no table, no model, no transcript. It used to pass.
  const forged = { schema: 'need-meter-verification/1', sessions: [{ method: 'per-message', recorded: 100, final: 100 }, { method: 'per-message', recorded: 1, final: 1 }] };
  assert.equal(G.verificationPasses(forged), false, 'wrong schema and no price band evidence');
  assert.equal(G.verificationPasses({ ...forged, schema: G.VERIFICATION_SCHEMA }), false, 'per-message needs the reported and priced dollars: a forged recorded === final is not a verification');
  const dec = (v, extra = {}) => G.meterGateDecision({ gate: BLOCK, verification: v, arms: [AGENT_O], priceTableId: P.id, rederive: REDERIVED, ...extra });
  assert.equal(dec({ ...forged, schema: G.VERIFICATION_SCHEMA }).allow, false);
  // The price table: a record made under one table cannot clear a stage run under another, and one without a table clears nothing.
  assert.equal(dec(REC()).allow, true);
  assert.equal(dec(REC({ priceTable: { id: 'need-v0-prices@2026-01-01' } })).allow, false); assert.match(dec(REC({ priceTable: { id: 'other' } })).why, /made under price table "other", the stage prices with "need-v1-prices@2026-10-14"/);
  assert.equal(dec(REC({ priceTable: undefined })).allow, false); assert.equal(dec(REC({ priceTable: { id: null } }), { priceTableId: null }).allow, false, 'no table id on either side is not a match');
  // The models: Haiku transcripts cannot clear an Opus arm.
  const haikuOnly = REC({ models: [HAIKU], sessions: [sess(HAIKU), sess(HAIKU)] });
  assert.equal(dec(haikuOnly).allow, false); assert.match(dec(haikuOnly).why, /no verifying session for model claude-opus-5-5/);
  const both = G.meterGateDecision({ gate: BLOCK, verification: REC({ sessions: [sess(HAIKU), sess(OPUS)] }), arms: [AGENT_O, { factory: 'b0Agent', model: HAIKU }, { build: { factory: 'construct', builderModel: HAIKU }, run: { factory: 'b1Script' } }], priceTableId: P.id, rederive: REDERIVED });
  assert.equal(both.allow, true, 'one passing session per model is enough');
  const missingOne = G.meterGateDecision({ gate: BLOCK, verification: REC(), arms: [AGENT_O, { factory: 'b0Agent', model: HAIKU }], priceTableId: P.id, rederive: REDERIVED });
  assert.equal(missingOne.allow, false); assert.match(missingOne.why, /no verifying session for model claude-haiku-5-5/);
  assert.equal(G.meterGateDecision({ gate: BLOCK, verification: REC(), arms: [{ factory: 'b0Agent' }], priceTableId: P.id, rederive: REDERIVED }).allow, false, 'an agent arm that names no model cannot be covered');
  // Re-derivation: the record is a claim until its transcripts say the same.
  assert.equal(G.meterGateDecision({ gate: BLOCK, verification: REC(), arms: [AGENT_O], priceTableId: P.id }).allow, false, 'without a re-derivation hook nothing is cleared');
  const bad = dec(REC(), { rederive: () => ({ ok: false, problems: ['session 1 (s.jsonl): transcript /x/s.jsonl is missing'] }) });
  assert.equal(bad.allow, false); assert.match(bad.why, /transcript \/x\/s\.jsonl is missing/);
  assert.equal(dec(REC(), { rederive: () => ({ ok: false }) }).allow, false);
});

test('outputTokenCheck: a start-of-message snapshot fails, matching totals pass, nothing to compare with is a failed verification', () => {
  const snapshot = [[10, 40, 5000, 800, 'claude-opus-5-5'], [3, 25, 6000, 0, 'claude-opus-5-5']];   // 65 output tokens recorded
  const f = G.outputTokenCheck({ messageUsage: snapshot, finalUsage: { output_tokens: 26553 } });
  assert.deepEqual([f.checked, f.ok, f.recorded, f.final], [true, false, 65, 26553]); assert.ok(f.relGap > 0.99);
  const ok = G.outputTokenCheck({ messageUsage: [[1, 12000, 0, 0, null], [1, 14000, 0, 0, null]], finalUsage: { output_tokens: 26500 } });
  assert.equal(ok.ok, true); assert.ok(ok.relGap < 0.02);
  assert.equal(G.outputTokenCheck({ messageUsage: [[1, 950, 0, 0, null]], finalUsage: { output_tokens: 1000 } }).ok, true, 'exactly at 5%');
  assert.equal(G.outputTokenCheck({ messageUsage: [[1, 940, 0, 0, null]], finalUsage: { output_tokens: 1000 } }).ok, false, '6% off');
  assert.equal(G.outputTokenCheck({ streamUsage: { outputTokens: 120 }, finalUsage: { outputTokens: 119 } }).ok, true, 'the stream aggregate stands in for per-message lines');
  const none = G.outputTokenCheck({ messageUsage: snapshot });
  assert.deepEqual([none.checked, none.ok], [false, false]); assert.match(none.reason, /no final result usage/);
  assert.equal(G.outputTokenCheck({ finalUsage: { output_tokens: 5 } }).ok, false);
  assert.equal(G.outputTokenCheck({ messageUsage: [[1, 0, 0, 0, null]], finalUsage: { output_tokens: 0 } }).ok, true);
});

test('priceSession with the meter: an under-priced session is booked at the reported figure (gap imputed, flagged); a verified one and a call without a meter are unchanged', () => {
  // An Opus agent: 26,553 final output tokens (about $0.53 at $20 per million), the per-message lines record 65.
  const msgs = [[10, 40, 50000, 8000, 'claude-opus-5-5'], [3, 25, 60000, 0, 'claude-opus-5-5']];
  const reported = 0.80;
  const plain = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: msgs, reportedUsd: reported });
  assert.ok(plain.measured < 0.3 && plain.imputed === 0 && plain.meterUnverified === undefined, 'without a meter nothing changes: the shortfall would be booked as measured');
  const g = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: msgs, reportedUsd: reported, finalUsage: { output_tokens: 26553 }, meter: { tolerance: G.OUTPUT_TOLERANCE } });
  approx(g.measured, plain.measured); assert.equal(g.meterUnverified, true);
  approx(g.measured + g.imputed, reported, 1e-9);
  approx(g.meterGapUsd, reported - plain.measured, 1e-9);
  assert.equal(g.meterCheck.ok, false);
  // No final usage on the record: cannot be verified, also booked at the reported figure.
  const nf = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: msgs, reportedUsd: reported, meter: { tolerance: 0.05 } });
  assert.equal(nf.meterUnverified, true); approx(nf.measured + nf.imputed, reported, 1e-9);
  // Per-message lines that agree with the final usage AND a re-price that is the CLI figure within the band: a plain re-price, no flag.
  const good = [[10, 12000, 50000, 8000, 'claude-opus-5-5'], [3, 14553, 60000, 0, 'claude-opus-5-5']];
  const goodUsd = (10 * 4 + 12000 * 20 + 50000 * 0.2 + 8000 * 5 + 3 * 4 + 14553 * 20 + 60000 * 0.2) / 1e6;
  const v = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: good, reportedUsd: 0.60, finalUsage: { output_tokens: 26553 }, meter: { tolerance: 0.05 } });
  assert.equal(v.meterUnverified, undefined); assert.equal(v.imputed, 0); assert.equal(v.meterCheck.ok, true); assert.equal(v.meterCheck.priceBandOk, true);
  approx(v.measured, goodUsd, 1e-9); assert.ok(v.meterCheck.relErr < 0.05);
  // A re-price already above the reported figure imputes nothing (the cap meter takes the larger anyway).
  const hi = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: msgs, reportedUsd: 0.01, meter: { tolerance: 0.05 } });
  assert.equal(hi.imputed, 0); assert.equal(hi.meterUnverified, true);
  // The lines are snapshots but the final usage is complete and the corrected price is the CLI's own figure within the band: accepted as measured, flagged.
  const fixed = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: msgs, reportedUsd: 0.60, finalUsage: { output_tokens: 26553 }, meter: { tolerance: 0.05 } });
  assert.equal(fixed.outputFromFinal, true); assert.equal(fixed.meterUnverified, undefined); assert.equal(fixed.imputed, 0);
  approx(fixed.measured, plain.measured + (26553 - 65) * 20 / 1e6, 1e-9); assert.ok(Math.abs(fixed.measured - 0.60) / 0.60 <= G.PRICE_BAND);
  assert.equal(fixed.tokens.outputTokens, 26553, 'the row carries the complete output count');
  assert.equal(fixed.meterCheck.ok, false); assert.ok(fixed.meterCheck.relErr < 0.05);
  // ... and not accepted when the reported figure does not corroborate it (here 0.80 against a corrected 0.59): booked at the reported figure instead.
  const unc = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: msgs, reportedUsd: 0.80, finalUsage: { output_tokens: 26553 }, meter: { tolerance: 0.05 } });
  assert.equal(unc.outputFromFinal, undefined); assert.equal(unc.meterUnverified, true); approx(unc.measured + unc.imputed, 0.80, 1e-9);
  // A killed session keeps its bound: the gap rule never lowers an existing imputation.
  const killed = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: msgs, costUnknown: true, boundUsd: 4, reportedUsd: 0, meter: { tolerance: 0.05 } });
  approx(killed.measured + killed.imputed, 4, 1e-9);
});

test('guardMeter: matching output tokens do not clear a session whose price the CLI figure does not corroborate (1-hour cache writes against the table\'s 5-minute rate)', () => {
  // The review's case: the CLI writes accurate per-message output tokens, the session was billed with 1-hour cache writes (launch-env.json: 336 of 336), the pinned table
  // prices them at 5 minutes. The output check passes; the re-price lands 15-17% under the reported figure. It used to be accepted as `measured` with nothing imputed.
  const lines = [[10, 12000, 50000, 30000, 'claude-opus-5-5'], [3, 14553, 60000, 27000, 'claude-opus-5-5']];
  const priced = (10 * 4 + 12000 * 20 + 50000 * 0.2 + 30000 * 5 + 3 * 4 + 14553 * 20 + 60000 * 0.2 + 27000 * 5) / 1e6;     // the table: 5-minute writes at 1.25 x input
  const billed = priced + 57000 * (8 - 5) / 1e6;                                                                               // the CLI: 1-hour writes at 2 x input
  assert.ok(priced / billed > 0.80 && priced / billed < 0.86, `the planted session sits at ${priced / billed} of the CLI figure`);
  const s = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: lines, reportedUsd: billed, finalUsage: { output_tokens: 26553, cache_creation: { ephemeral_1h_input_tokens: 700000, ephemeral_5m_input_tokens: 0 } }, meter: { tolerance: G.OUTPUT_TOLERANCE } });
  assert.equal(s.meterCheck.ok, true, 'the output tokens match the final usage');
  assert.equal(s.meterUnverified, true); assert.equal(s.meterCheck.priceBandOk, false); assert.match(s.meterCheck.reason, /cache-write rate/);
  approx(s.measured, priced, 1e-9); approx(s.measured + s.imputed, billed, 1e-9); approx(s.meterGapUsd, billed - priced, 1e-9);
  assert.ok(s.imputed > 0.1 * billed, 'the 17% shortfall is now imputed, so the 30%-imputed rule and the utility see it');
  // The same session at the rate the table prices (5-minute writes) is a plain measured re-price.
  const five = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: lines, reportedUsd: priced * 1.04, finalUsage: { output_tokens: 26553 }, meter: { tolerance: G.OUTPUT_TOLERANCE } });
  assert.equal(five.meterUnverified, undefined); assert.equal(five.imputed, 0); assert.equal(five.meterCheck.priceBandOk, true);
  // Above the band too (a re-price over the CLI figure is not corroborated either); the booking never drops below the re-price.
  const over = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: lines, reportedUsd: priced * 0.8, finalUsage: { output_tokens: 26553 }, meter: { tolerance: G.OUTPUT_TOLERANCE } });
  assert.equal(over.meterUnverified, true); assert.equal(over.imputed, 0); approx(over.measured, priced, 1e-9);
  // The edge of the band: 10% inside, 11% outside.
  assert.equal(LR.priceSession(P, 'claude-opus-5-5', { messageUsage: lines, reportedUsd: priced / 0.91, finalUsage: { output_tokens: 26553 }, meter: { tolerance: G.OUTPUT_TOLERANCE } }).meterUnverified, undefined);
  assert.equal(LR.priceSession(P, 'claude-opus-5-5', { messageUsage: lines, reportedUsd: priced / 0.88, finalUsage: { output_tokens: 26553 }, meter: { tolerance: G.OUTPUT_TOLERANCE } }).meterUnverified, true);
  // No reported figure: nothing to corroborate the re-price with, so it is flagged (the numbers stay).
  const none = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: lines, reportedUsd: 0, finalUsage: { output_tokens: 26553 }, meter: { tolerance: G.OUTPUT_TOLERANCE } });
  assert.equal(none.meterUnverified, true); assert.equal(none.imputed, 0); assert.match(none.meterCheck.reason, /no CLI-reported cost/);
  // A killed session keeps its bound whatever its lines say.
  const killed = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: lines, costUnknown: true, boundUsd: 9, reportedUsd: 0, finalUsage: { output_tokens: 26553 }, meter: { tolerance: G.OUTPUT_TOLERANCE } });
  assert.equal(killed.meterUnverified, undefined); approx(killed.measured + killed.imputed, 9, 1e-9);
  // Without a meter (dry runs) nothing changes.
  assert.equal(LR.priceSession(P, 'claude-opus-5-5', { messageUsage: lines, reportedUsd: billed, finalUsage: { output_tokens: 26553 } }).meterUnverified, undefined);
});

test('the 30% imputed rule sees the gap: a guarded agent mode is unlabelled where the unguarded re-price would have been trusted', async () => {
  const { needTable, needLabels, makeCell } = await import('../metrics.mjs');
  const mk = (guarded) => {
    const rows = [];
    for (let t = 0; t < 6; t++) {
      for (const mode of ['agent-H', 'agent-O']) {
        const o = mode === 'agent-O';
        const c = LR.priceSession(P, o ? 'claude-opus-5-5' : 'claude-haiku-5-5', { messageUsage: [[10, o ? 40 : 300, 30000, 0, null]], reportedUsd: o ? 0.90 : 0.000451, finalUsage: { output_tokens: o ? 26000 : 310 }, meter: guarded ? { tolerance: 0.05 } : null });
        rows.push({ job: 'j', mode, task: `t${t}`, rep: 0, pass: true, delivered: true, schemaValid: true, seed: 700 + t, usdRepriced: c.measured, usdImputed: c.imputed, repriced: true });
      }
    }
    return needLabels(needTable(rows, []), { reps: 0, cells: [makeCell(1, 10, 1)] }).at('j', makeCell(1, 10, 1));
  };
  const raw = mk(false), guarded = mk(true);
  assert.equal(raw.unlabelled, null, 'unguarded, the under-priced re-price is booked as measured and the label is trusted');
  assert.ok(raw.u.get('agent-O') > 0.95, 'the unguarded Opus agent looks as cheap as the Haiku agent');
  assert.match(guarded.unlabelled, /imputed dollars over 0\.3 in agent-O/, 'guarded, the gap is imputed and the cell is left unlabelled');
  assert.ok(guarded.u.get('agent-O') < 0.2, 'and its utility charges the reported $0.90 a task');
});

test('matrixRow flags a session the meter check could not verify and keeps its total at the reported figure', () => {
  const armDef = { factory: 'b0Agent', model: 'claude-opus-5-5' }, job = { id: 'j', cluster: 'W', split: 'train', family: 'records' };
  const rec = { arm: 'agent-O', taskKey: 'records:dev:d3:s610', trial: 0, costUsd: 0.7, taskHash: 'h', pass: true, error: null,
    meta: { delivered: true, messageUsage: [[10, 40, 50000, 8000, 'claude-opus-5-5']], finalUsage: { output_tokens: 20000 }, costUpperUsd: 4 } };
  const bad = LR.matrixRow(rec, { stage: 'NL0', job, armDef, priceTable: P, book: null, taskInfo: { seed: 610, difficulty: 3 }, meter: { tolerance: 0.05 } });
  assert.equal(bad.meterUnverified, true);
  approx(bad.usdRepriced + bad.usdImputed, 0.7, 1e-5);
  const off = LR.matrixRow(rec, { stage: 'NL0', job, armDef, priceTable: P, book: null, taskInfo: { seed: 610, difficulty: 3 } });
  assert.ok(!('meterUnverified' in off) && off.usdImputed === 0 && off.usdRepriced < 0.3, 'without a meter (dry runs) the row is as before');
  const ok = LR.matrixRow({ ...rec, costUsd: 0.446, meta: { ...rec.meta, messageUsage: [[10, 19800, 50000, 8000, 'claude-opus-5-5']] } }, { stage: 'NL0', job, armDef, priceTable: P, book: null, taskInfo: { seed: 610, difficulty: 3 }, meter: { tolerance: 0.05 } });
  assert.ok(!('meterUnverified' in ok) && ok.usdImputed === 0);
});

test('paidRunChecks refuses a paid stage with an agent arm while the gate blocks, and names the way out', () => {
  const stages = JSON.parse(readFileSync(path.join(REPO, 'research/need-router-20261014/prereg/stages.json'), 'utf8'));
  const stage = stages.stages.find(s => s.id === 'M1'), plan = { stages, stage, file: 'x', planSha256: 'x' };
  const unitsOf = arms => [{ job: {}, arms, probeArms: [] }];
  const run = (arms, deps) => LR.paidRunChecks({ plan, units: unitsOf(arms), prereg: null, deps: { stampOf: () => null, checkStagesFn: () => ({ errors: [] }), ...deps } }).errors.filter(e => e.startsWith('meter gate:'));
  const blocked = run(['agent-H', 'direct-H'], { meterGate: () => BLOCK, meterVerification: () => null });
  assert.equal(blocked.length, 1); assert.match(blocked[0], /block-until-verified/); assert.match(blocked[0], /meter-gate-cli\.mjs --verify/);
  assert.deepEqual(run(['direct-H'], { meterGate: () => BLOCK, meterVerification: () => null }), [], 'a stage of single calls does not need the agent meter');
  assert.deepEqual(run(['agent-O'], { meterGate: () => CLEAR, meterVerification: () => null }), []);
  const good = REC({ models: [OPUS, HAIKU], sessions: [sess(HAIKU), sess(OPUS, { method: 'final-output', final: 5000 })] });
  assert.deepEqual(run(['construct-H'], { meterGate: () => BLOCK, meterVerification: () => good, meterRederive: REDERIVED }), []);
  assert.equal(run(['construct-H', 'agent-H+proc', 'build-O'], { meterGate: () => BLOCK, meterVerification: () => null }).length, 1);
  // The default re-derivation reads the record's transcripts: these sessions point at a file that is not there, so the record clears nothing.
  const unchecked = run(['construct-H'], { meterGate: () => BLOCK, meterVerification: () => good });
  assert.equal(unchecked.length, 1); assert.match(unchecked[0], /transcript \/x\/s\.jsonl is missing/);
  // Opus-only transcripts cannot clear a stage whose construct-H builds with Haiku, and a record under another table clears nothing.
  const opusOnly = run(['construct-H', 'build-O'], { meterGate: () => BLOCK, meterVerification: () => REC(), meterRederive: REDERIVED });
  assert.equal(opusOnly.length, 1); assert.match(opusOnly[0], /no verifying session for model claude-haiku-5-5/);
  const otherTable = run(['agent-O'], { meterGate: () => BLOCK, meterVerification: () => REC({ priceTable: { id: 'need-v0-prices' } }), meterRederive: REDERIVED });
  assert.equal(otherTable.length, 1); assert.match(otherTable[0], /made under price table "need-v0-prices"/);
});

test('transcriptUsage and verifyTranscripts: lines that match the final usage verify per-message, snapshot lines verify only when the final-usage re-price is the CLI figure, nothing else does', () => {
  const line = o => JSON.stringify(o);
  const transcript = (msgs, final, { cost = 0.5, model = 'claude-opus-5-5' } = {}) => [
    line({ type: 'system', subtype: 'init' }),
    ...msgs.flatMap(([out, cr], i) => [line({ type: 'assistant', message: { id: `m${i}`, model, usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: cr } } }),
      line({ type: 'assistant', message: { id: `m${i}`, model, usage: { input_tokens: 5, output_tokens: out, cache_read_input_tokens: cr } } })]),
    ...(final === null ? [] : [line({ type: 'result', total_cost_usd: cost, usage: { output_tokens: final } })]),
  ].join('\n');
  const u = G.transcriptUsage(transcript([[100, 1000], [200, 2000]], 300));
  assert.deepEqual([u.messages, u.recorded, u.final, u.hasResult, u.model, u.reportedUsd], [2, 300, 300, true, 'claude-opus-5-5', 0.5], 'a message repeated per content block counts once, at its last usage');
  assert.deepEqual(u.messageUsage, [[5, 100, 1000, 0, 'claude-opus-5-5'], [5, 200, 2000, 0, 'claude-opus-5-5']]);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'meter-'));
  const write = (name, text) => { const f = path.join(tmp, name); writeFileSync(f, text); return f; };
  const opusUsd = (inp, out, cr) => (inp * 4 + out * 20 + cr * 0.2) / 1e6;
  // exact lines: cost = priced lines; snapshot lines: small recorded output, large final, reported = the price of the full output
  const exact = write('exact.jsonl', transcript([[10000, 1000], [16000, 2000]], 26000, { cost: opusUsd(10, 26000, 3000) }));
  const exact2 = write('exact2.jsonl', transcript([[500, 100], [500, 200]], 1000, { cost: opusUsd(10, 1000, 300) }));
  const snapA = write('snapA.jsonl', transcript([[20, 50000], [30, 60000]], 26000, { cost: opusUsd(10, 26000, 110000) }));
  const snapB = write('snapB.jsonl', transcript([[10, 40000], [10, 40000]], 9000, { cost: opusUsd(10, 9000, 80000) }));
  const wrong = write('wrong.jsonl', transcript([[20, 50000], [30, 60000]], 26000, { cost: 5 }));    // the CLI says $5: the corrected price does not corroborate it
  const killed = write('killed.jsonl', transcript([[9, 100]], null));
  const verify = (...fs) => G.verifyTranscripts(fs, { priceSession: LR.priceSession, table: P });
  const rec = verify(exact, exact2);
  assert.deepEqual(rec.sessions.map(s => s.method), ['per-message', 'per-message']); assert.equal(rec.passed, true); assert.equal(rec.schema, G.VERIFICATION_SCHEMA);
  assert.ok(rec.sessions.every(s => s.ok && /^[0-9a-f]{64}$/.test(s.sha256) && path.isAbsolute(s.path) && s.relGap <= 0.05), 'full sha256 and the transcript path, so label-run can re-derive the session');
  assert.deepEqual([rec.priceTable, rec.models], [{ id: P.id }, ['claude-opus-5-5']]);
  const snaps = verify(snapA, snapB);
  assert.deepEqual(snaps.sessions.map(s => s.method), ['final-output', 'final-output']); assert.equal(snaps.passed, true, 'snapshot lines verify through the final-usage re-price when it is the CLI figure');
  assert.ok(snaps.sessions.every(s => Math.abs(s.pricedUsd - s.reportedUsd) / s.reportedUsd <= G.PRICE_BAND));
  assert.equal(G.verificationPasses(snaps), true);
  const mixed = verify(exact, snapA); assert.equal(mixed.passed, true);
  const bad = verify(exact, wrong);
  assert.deepEqual(bad.sessions.map(s => s.method), ['per-message', 'unverified']); assert.equal(bad.passed, false, 'a re-price the reported cost does not corroborate fails the record');
  assert.equal(verify(exact).passed, false, 'one transcript is not enough');
  assert.equal(verify(exact, killed).passed, false, 'a killed session has no final usage to verify against');
  assert.equal(verify(exact, killed).sessions[1].method, 'unverified');
  // The record is re-derived, never trusted: a hand-edited ok or passed flag does not pass.
  const forged = { ...bad, passed: true, sessions: bad.sessions.map(s => ({ ...s, ok: true })) };
  assert.equal(G.verificationPasses(forged), false);
  assert.equal(G.verificationPasses({ ...snaps, sessions: snaps.sessions.map(s => ({ ...s, reportedUsd: s.pricedUsd * 2 })) }), false);
  assert.throws(() => G.verifyTranscripts([exact, exact2]), /priceSession/);
  // A session billed with 1-hour cache writes (the CLI's default; an executor session keeps only what the launching shell sets) is not corroborated by the
  // pinned table's 5-minute writes, and the record says why.
  const oneHour = write('onehour.jsonl', [
    line({ type: 'assistant', message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 400000 } } }),
    line({ type: 'assistant', message: { id: 'b', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 300000 } } }),
    line({ type: 'result', total_cost_usd: (10 * 4 + 20000 * 20 + 700000 * 8) / 1e6, usage: { output_tokens: 20000, cache_creation: { ephemeral_1h_input_tokens: 57000, ephemeral_5m_input_tokens: 0 } } })].join('\n'));
  const oh = verify(exact, oneHour);
  assert.equal(oh.passed, false); assert.equal(oh.sessions[1].method, 'unverified'); assert.equal(oh.sessions[1].cacheWrite1hShare, 1);
  assert.match(oh.sessions[1].hint, /FORCE_PROMPT_CACHING_5M=1/); assert.ok(!('hint' in oh.sessions[0]));
  assert.equal(G.cacheWrite1hShare({ cache_creation: { ephemeral_1h_input_tokens: 1, ephemeral_5m_input_tokens: 3 } }), 0.25);
  assert.equal(G.cacheWrite1hShare({}), null); assert.equal(G.cacheWrite1hShare({ cache_creation: {} }), null);
  // The same session billed at the 5-minute rate verifies.
  const fiveMin = write('fivemin.jsonl', [
    line({ type: 'assistant', message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 400000 } } }),
    line({ type: 'assistant', message: { id: 'b', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 300000 } } }),
    line({ type: 'result', total_cost_usd: (10 * 4 + 20000 * 20 + 700000 * 5) / 1e6, usage: { output_tokens: 20000, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 700000 } } })].join('\n'));
  const fm = verify(exact, fiveMin);
  assert.equal(fm.sessions[1].method, 'final-output'); assert.equal(fm.passed, true);
});

test('missingOutputUsd spreads the missing output tokens over the lines at their own tiers; an unpriced line makes the correction impossible', () => {
  const lines = [[10, 0, 1000, 0, 'm'], [10, 99, 1000, 0, 'm']];       // weights 1 and 100
  const rate = ([i]) => (i === 10 ? 0.00002 : 0.00001);
  approx(G.missingOutputUsd(lines, 1000, rate), 1000 * 0.00002, 1e-12);
  const mixedRate = l => (l === lines[0] ? 0.00004 : 0.00001);
  approx(G.missingOutputUsd(lines, 101, mixedRate), 1 * 0.00004 + 100 * 0.00001, 1e-12);
  assert.equal(G.missingOutputUsd(lines, 5, () => null), null);
  assert.equal(G.missingOutputUsd(lines, 0, rate), 0); assert.equal(G.missingOutputUsd([], 5, rate), 0);
  // label-run's outputRateOf: a Haiku request over 100K prompt tokens is priced at the upper tier's output rate.
  approx(LR.outputRateOf(P, 'claude-haiku-5-5', [200000, 0, 0, 0, null]), 2.5 / 1e6, 1e-15);
  approx(LR.outputRateOf(P, 'claude-haiku-5-5', [1000, 0, 0, 0, 'claude-haiku-5-5']), 0.5 / 1e6, 1e-15);
  approx(LR.outputRateOf(P, 'claude-opus-5-5', [1000, 0, 0, 0, 'unpriced-model']), 20 / 1e6, 1e-15, 'an unpriced line model falls back to the session model');
  assert.equal(LR.outputRateOf(P, 'unpriced-session', [1, 0, 0, 0, null]), null);
});

test('meter-gate-cli: --verify writes a record label-run accepts, exits 1 for a record that does not pass, and the bare command reports the gate', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'meter-cli-'));
  const line = o => JSON.stringify(o);
  const tr = (out, final, cost) => [line({ type: 'assistant', message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: out } } }),
    line({ type: 'result', total_cost_usd: cost, usage: { output_tokens: final } })].join('\n');
  const f = (name, text) => { const p = path.join(tmp, name); writeFileSync(p, text); return p; };
  const good1 = f('g1.jsonl', tr(1000, 1000, (10 * 4 + 1000 * 20) / 1e6)), good2 = f('g2.jsonl', tr(2000, 2000, (10 * 4 + 2000 * 20) / 1e6)), snap = f('s.jsonl', tr(5, 9000, 9));
  const cli = path.join(REPO, 'experiments/need-router/meter-gate-cli.mjs');
  const out = path.join(tmp, 'rec.json');
  const ok = spawnSync(process.execPath, [cli, '--verify', good1, good2, '--write', out], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const rec = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rec.passed, true); assert.deepEqual(rec.sessions.map(s => s.method), ['per-message', 'per-message']);
  assert.equal(G.verificationPasses(rec), true);
  const rederive = r => G.rederiveVerification(r, { priceSession: LR.priceSession, table: P });
  assert.equal(G.meterGateDecision({ gate: BLOCK, verification: G.readVerification(out), arms: [AGENT_O], priceTableId: P.id, rederive }).allow, true, 'the record the CLI wrote re-derives from its transcripts and clears the gate');
  assert.equal(G.meterGateDecision({ gate: BLOCK, verification: G.readVerification(out), arms: [AGENT_O], priceTableId: 'need-v0-prices', rederive }).allow, false, 'under another table it does not');
  const no = spawnSync(process.execPath, [cli, '--verify', good1, snap], { encoding: 'utf8' });
  assert.equal(no.status, 1); assert.equal(JSON.parse(no.stdout).passed, false);
  const status = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(status.status, 1, 'the committed gate blocks and no record is on file (or there is no committed gate to read: refused either way)');
  const rep = JSON.parse(status.stdout);
  if (rep.gate) assert.equal(rep.gate.status, 'block-until-verified'); else assert.match(rep.problem, /not committed at HEAD|no d6|does not parse/i);
  assert.equal(rep.agentStage.allow, false);
});

test('verifyTranscripts: a session whose output tokens match but whose cache writes were billed at the 1-hour rate is unverified, per-message included (review of 2026-10-15)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'meter-1h-')), line = o => JSON.stringify(o);
  const write = (name, text) => { const f = path.join(tmp, name); writeFileSync(f, text); return f; };
  const usage = (out, cw, cc) => ({ input_tokens: 5, output_tokens: out, cache_read_input_tokens: 1000, cache_creation_input_tokens: cw, ...(cc ? { cache_creation: cc } : {}) });
  // Per-message lines carry the full output (3000 + 2000 = the final 5000), so the output check passes; the CLI billed 1-hour writes (2 x input).
  const mk = (billedHour, cost) => write(billedHour ? 'hour.jsonl' : 'five.jsonl', [
    line({ type: 'assistant', message: { id: 'a', model: 'claude-opus-5-5', usage: usage(3000, 40000) } }),
    line({ type: 'assistant', message: { id: 'b', model: 'claude-opus-5-5', usage: usage(2000, 30000) } }),
    line({ type: 'result', total_cost_usd: cost, usage: { ...usage(5000, 70000, billedHour ? { ephemeral_1h_input_tokens: 70000, ephemeral_5m_input_tokens: 0 } : { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 70000 }) } })].join('\n'));
  const base = (10 * 4 + 5000 * 20 + 2000 * 0.2) / 1e6;
  const hour = mk(true, base + 70000 * 8 / 1e6), five = mk(false, base + 70000 * 5 / 1e6);
  const verify = (...fs) => G.verifyTranscripts(fs, { priceSession: LR.priceSession, table: P });
  const r1 = verify(five, five), r2 = verify(hour, five);
  assert.deepEqual(r1.sessions.map(s => s.method), ['per-message', 'per-message']); assert.equal(r1.passed, true);
  assert.equal(r2.sessions[0].method, 'unverified', 'lines match the final usage, the price is 14% under the CLI figure: not a verification');
  assert.equal(r2.sessions[0].recorded, r2.sessions[0].final); assert.equal(r2.sessions[0].cacheWrite1hShare, 1); assert.match(r2.sessions[0].hint, /FORCE_PROMPT_CACHING_5M=1/);
  assert.equal(r2.passed, false);
  // verificationPasses re-derives from the stored numbers: the same session recorded as per-message with its recorded === final but a priced figure the band rejects fails,
  // and so does one with no priced or reported dollars at all (the forged shape of the review).
  const m = { file: 'h.jsonl', method: 'per-message', recorded: 5000, final: 5000, model: 'claude-opus-5-5' };
  const rec = sessions => ({ schema: G.VERIFICATION_SCHEMA, sessions });
  assert.equal(G.verificationPasses(rec([{ ...m, reportedUsd: 1, pricedUsd: 0.86 }, { ...m, reportedUsd: 1, pricedUsd: 1 }])), false);
  assert.equal(G.verificationPasses(rec([m, m])), false);
  assert.equal(G.verificationPasses(rec([{ ...m, reportedUsd: 1, pricedUsd: 0.91 }, { ...m, reportedUsd: 1, pricedUsd: 1.09 }])), true, 'inside the 10% band on both sides');
  assert.equal(G.verificationPasses(rec([{ ...m, reportedUsd: 1, pricedUsd: 0.89 }, { ...m, reportedUsd: 1, pricedUsd: 1 }])), false);
  assert.equal(G.verificationPasses(rec([{ ...m, reportedUsd: 1, pricedUsd: 1.11 }, { ...m, reportedUsd: 1, pricedUsd: 1 }])), false);
});

test('rederiveVerification: a record is re-derived from its transcripts at launch; a missing or changed transcript, an edited number or another price table refuses', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'meter-rederive-')), line = o => JSON.stringify(o);
  const write = (name, text) => { const f = path.join(tmp, name); writeFileSync(f, text); return f; };
  const tr = (model, out, cost) => [line({ type: 'assistant', message: { id: 'a', model, usage: { input_tokens: 10, output_tokens: out } } }), line({ type: 'result', total_cost_usd: cost, usage: { output_tokens: out } })].join('\n');
  const opusCost = out => (10 * 4 + out * 20) / 1e6, haikuCost = out => (10 * 0.1 + out * 0.5) / 1e6;
  const a = write('opus-a.jsonl', tr('claude-opus-5-5', 1000, opusCost(1000))), b = write('opus-b.jsonl', tr('claude-opus-5-5', 2000, opusCost(2000))), h = write('haiku.jsonl', tr('claude-haiku-5-5', 4000, haikuCost(4000)));
  const rederive = (r, extra = {}) => G.rederiveVerification(r, { priceSession: LR.priceSession, table: P, ...extra });
  const rec = G.verifyTranscripts([a, b, h], { priceSession: LR.priceSession, table: P });
  assert.equal(rec.passed, true); assert.deepEqual(rec.models, ['claude-haiku-5-5', 'claude-opus-5-5']);
  const ok = rederive(rec);
  assert.equal(ok.ok, true, ok.problems.join('; ')); assert.deepEqual(ok.problems, []); assert.equal(ok.record.sessions.length, 3);
  // Survives the round trip through JSON, as a committed file does.
  assert.equal(rederive(JSON.parse(JSON.stringify(rec))).ok, true);
  // A changed transcript (one more byte), a deleted one.
  const original = readFileSync(a, 'utf8');
  writeFileSync(a, original + '\n');
  const changed = rederive(rec); assert.equal(changed.ok, false); assert.match(changed.problems[0], /session 1 \(opus-a\.jsonl\): transcript .*opus-a\.jsonl changed since the record was made/);
  writeFileSync(a, original);
  assert.equal(rederive(rec).ok, true, 'restored');
  const gone = rederive({ ...rec, sessions: [...rec.sessions.slice(0, 2), { ...rec.sessions[2], path: path.join(tmp, 'deleted.jsonl') }] });
  assert.equal(gone.ok, false); assert.match(gone.problems[0], /session 3 \(haiku\.jsonl\): transcript .*deleted\.jsonl is missing/);
  // A record without a path or a full sha256 cannot be re-derived (the shape of a hand-written record, and of the old /1 records).
  for (const strip of [{ path: undefined }, { sha256: undefined }, { sha256: 'abcd1234abcd1234' }]) {
    const r = rederive({ ...rec, sessions: rec.sessions.map(s => ({ ...s, ...strip })) }); assert.equal(r.ok, false); assert.match(r.problems[0], /records no transcript path and full sha256/);
  }
  // An edited number: the stored pricedUsd or model no longer matches what the transcript gives.
  const edited = rederive({ ...rec, sessions: rec.sessions.map((s, i) => (i === 0 ? { ...s, pricedUsd: s.pricedUsd * 0.5, reportedUsd: s.reportedUsd * 0.5 } : s)) });
  assert.equal(edited.ok, false); assert.match(edited.problems.join(' '), /re-derived pricedUsd/);
  const wrongModel = rederive({ ...rec, sessions: rec.sessions.map((s, i) => (i === 2 ? { ...s, model: 'claude-opus-5-5' } : s)) });
  assert.equal(wrongModel.ok, false); assert.match(wrongModel.problems.join(' '), /the transcript is a claude-haiku-5-5 session, the record says claude-opus-5-5/);
  // Another price table: the session priced under it differs from the record's, and a table that prices Opus at twice the output rate does not re-derive.
  const dearer = { ...P, id: 'dearer', models: { ...P.models, 'claude-opus-5-5': { ...P.models['claude-opus-5-5'], tiers: P.models['claude-opus-5-5'].tiers.map(t => ({ ...t, output: t.output * 2 })) } } };
  const other = rederive(rec, { table: dearer });
  assert.equal(other.ok, false); assert.match(other.problems.join(' '), /re-derived (pricedUsd|method)|does not verify when re-derived/);
  // Not a record at all.
  assert.equal(rederive(null).ok, false); assert.equal(rederive({ schema: 'need-meter-verification/1', sessions: [] }).ok, false);
  // The default path resolves a relative record path against the repository and reads real files (an injected reader stands in here).
  const rel = rederive({ ...rec, sessions: rec.sessions.map(s => ({ ...s, path: 'rel/' + s.file })) }, { read: f => readFileSync(path.join(tmp, path.basename(f)), 'utf8'), exists: f => f.startsWith(REPO) && f.includes(path.join('rel', '')) });
  assert.equal(rel.ok, true, rel.problems.join('; '));
});

test('readCommittedVerification reads the HEAD blob, not the working tree: an uncommitted or hand-edited record clears nothing', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mv-head-')), file = path.join(tmp, 'meter-verification.json');
  const committed = JSON.stringify(REC());
  writeFileSync(file, JSON.stringify(REC({ sessions: [sess(OPUS, { method: 'unverified' }), sess(OPUS)] })));   // the working tree is edited after the commit
  const same = G.readCommittedVerification({ file, show: () => Buffer.from(committed) });
  assert.equal(same.source, 'HEAD'); assert.deepEqual(same.record, REC()); assert.match(same.dirty, /differs from its HEAD blob/);
  writeFileSync(file, committed);
  assert.equal(G.readCommittedVerification({ file, show: () => Buffer.from(committed) }).dirty, null);
  // In the working tree but never committed: no record, and the reason names the commit.
  const untracked = G.readCommittedVerification({ file, show: () => null });
  assert.equal(untracked.record, null); assert.match(untracked.problem, /in the working tree but not committed at HEAD: commit it/);
  assert.match(G.readCommittedVerification({ file: path.join(tmp, 'absent.json'), show: () => null }).problem, /no absent\.json is committed at HEAD/);
  assert.match(G.readCommittedVerification({ file, show: () => Buffer.from('{ no') }).problem, /does not parse/);
  assert.match(G.readCommittedVerification({ file: path.join(tmp, 'gone.json'), show: () => Buffer.from(committed) }).dirty, /deleted/);
  // The decision: a passing record in the working tree only is "not committed", so the stage is refused with that reason.
  const d = G.meterGateDecision({ gate: BLOCK, verification: untracked.record, verificationProblem: untracked.problem, arms: [AGENT_O], priceTableId: P.id, rederive: REDERIVED });
  assert.equal(d.allow, false); assert.match(d.why, /not committed at HEAD: commit it/);
  // And the real reader on this checkout finds no committed record today (the path is outside nothing; git is asked for HEAD:...).
  const real = G.readCommittedVerification();
  assert.ok(real.record === null ? typeof real.problem === 'string' : real.record.schema === G.VERIFICATION_SCHEMA);
});

test('gateStaleness: a committed gate computed under another price table, other rule constants or without a model the stage uses is not current; label-run refuses it (review of 2026-10-15)', () => {
  const models = [HAIKU, OPUS];
  assert.deepEqual(G.gateStaleness(CLEAR, { priceTableId: P.id, models }), []);
  assert.match(G.gateStaleness(CLEAR, { priceTableId: 'need-v2-prices@2026-11-01', models })[0], /computed under price table "need-v1-prices@2026-10-14", the stage prices with "need-v2-prices@2026-11-01"/);
  assert.match(G.gateStaleness({ ...CLEAR, priceTable: undefined }, { priceTableId: P.id, models })[0], /price table null/);
  assert.match(G.gateStaleness(CLEAR, { priceTableId: null, models })[0], /no price table id/);
  const oldRule = { ...CLEAR, rule: { ...CLEAR.rule, priceBand: 0.25, minBuilderSessions: undefined } };
  const st = G.gateStaleness(oldRule, { priceTableId: P.id, models });
  assert.equal(st.length, 1); assert.match(st[0], /another rule \(priceBand 0\.25 against 0\.1 in force, minBuilderSessions absent against 4 in force\)/);
  assert.match(G.gateStaleness({ ...CLEAR, requiredModels: [OPUS] }, { priceTableId: P.id, models })[0], /built for claude-opus-5-5, not for claude-haiku-5-5/);
  assert.equal(G.gateStaleness({ schema: G.METER_GATE_SCHEMA, status: 'clear' }, { priceTableId: P.id, models }).length, 3, 'a gate from before the review (no table, no rule, no models) is stale on all counts');
  // The decision refuses a stale gate even when it says clear, and names the way to refresh it.
  const d = G.meterGateDecision({ gate: oldRule, arms: [AGENT_O], stale: st });
  assert.equal(d.allow, false); assert.match(d.why, /not current for this stage: the gate was computed under another rule/); assert.match(d.why, /run\.mjs --report/);
  assert.equal(G.meterGateDecision({ gate: CLEAR, arms: [AGENT_O], stale: [] }).allow, true);
  assert.equal(G.meterGateDecision({ gate: oldRule, arms: [{ factory: 'b0Call' }], stale: st }).allow, true, 'a stage without an agent arm never reads the gate');
  // paidRunChecks computes it from the committed gate (the default path): a clear gate computed under another table refuses the stage; an injected gate skips the check.
  const stages = JSON.parse(readFileSync(path.join(REPO, 'research/need-router-20261014/prereg/stages.json'), 'utf8'));
  const plan = { stages, stage: stages.stages.find(x => x.id === 'M1'), file: 'x', planSha256: 'x' };
  const run = (arms, deps) => LR.paidRunChecks({ plan, units: [{ job: {}, arms, probeArms: [] }], prereg: null, deps: { stampOf: () => null, checkStagesFn: () => ({ errors: [] }), meterVerification: () => null, ...deps } }).errors.filter(e => e.startsWith('meter gate:'));
  const src = gate => ({ meterGateSource: () => ({ gate, problem: null, dirty: null, source: 'HEAD' }) });
  assert.deepEqual(run(['agent-O', 'agent-H'], src(CLEAR)), [], 'current: computed under the stage table with Haiku and Opus covered');
  const stale = run(['agent-O'], src({ ...CLEAR, priceTable: 'need-v0-prices' }));
  assert.equal(stale.length, 1); assert.match(stale[0], /not current for this stage.*price table "need-v0-prices"/);
  assert.equal(run(['agent-O'], src({ ...CLEAR, rule: { ...CLEAR.rule, outputTolerance: 0.5 } })).length, 1);
  assert.deepEqual(run(['agent-O', 'build-O'], src({ ...CLEAR, requiredModels: [OPUS] })), [], 'build-O builds with Opus: an Opus-only gate covers it');
  assert.equal(run(['construct-H'], src({ ...CLEAR, requiredModels: [OPUS] })).length, 1, 'construct-H builds with Haiku');
  assert.equal(run(['agent-H'], src({ ...CLEAR, requiredModels: [OPUS] })).length, 1);
  assert.deepEqual(run(['agent-O'], { meterGate: () => ({ ...CLEAR, priceTable: undefined }) }), [], 'an injected gate (tests) skips the staleness check unless meterGateStale is injected');
  assert.equal(run(['agent-O'], { meterGate: () => CLEAR, meterGateStale: () => ['injected'] }).length, 1);
  assert.deepEqual(run(['direct-H'], src({ ...CLEAR, priceTable: 'x' })), [], 'a stage of single calls never reads the gate');
});

// ------------------------------------------------------------------------------------------------------------------------------------
// Fail-closed gate (review of 2026-10-15): a missing, unparseable or partial diagnostics.json, an unknown status or an uncommitted regeneration
// refuses a stage with an agent arm; only the owner's logged waiver passes a missing gate.
const AGENT = { factory: 'b0Agent' }, CALL = { factory: 'b0Call' };
const WAIVER = { schema: G.WAIVER_SCHEMA, by: 'owner', at: '2026-10-15T09:00:00Z', reason: 'owner accepts the per-session meter check alone for the NL0 smoke row' };

test('meterGateDecision fails closed: no gate, an unrecognised status or a dirty file refuse an agent stage; only a valid logged owner waiver passes a missing gate', () => {
  const none = G.meterGateDecision({ gate: null, arms: [AGENT], problem: 'diagnostics.json is a partial run (d0 only) with no D6 section' });
  assert.equal(none.allow, false); assert.match(none.why, /no D6 meter gate on file \(diagnostics\.json is a partial run/); assert.match(none.why, /owner's waiver/); assert.match(none.why, /meter-gate-waiver\.json/);
  assert.equal(G.meterGateDecision({ gate: null, arms: [CALL] }).allow, true, 'no agent arm, no gate needed');
  const waived = G.meterGateDecision({ gate: null, arms: [AGENT], waiver: WAIVER, problem: 'diagnostics.json is missing' });
  assert.equal(waived.allow, true); assert.equal(waived.waived, true); assert.deepEqual(waived.waiver, WAIVER); assert.match(waived.why, /waiver of 2026-10-15T09:00:00Z is logged/);
  for (const bad of [{ ...WAIVER, by: 'claude' }, { ...WAIVER, by: undefined }, { ...WAIVER, reason: 'ok' }, { ...WAIVER, reason: '' }, { ...WAIVER, at: 'tomorrow' }, { ...WAIVER, at: undefined }, { ...WAIVER, schema: 'x' }, {}, null, 'owner']) {
    assert.equal(G.waiverValid(bad), false, JSON.stringify(bad)); assert.equal(G.meterGateDecision({ gate: null, arms: [AGENT], waiver: bad }).allow, false, JSON.stringify(bad));
  }
  assert.equal(G.waiverValid(WAIVER), true);
  // A waiver covers a missing gate, never a blocking one and never an uncommitted file.
  assert.equal(G.meterGateDecision({ gate: BLOCK, arms: [AGENT], waiver: WAIVER }).allow, false);
  const odd = G.meterGateDecision({ gate: { ...CLEAR, status: 'blocked' }, arms: [AGENT] });
  assert.equal(odd.allow, false); assert.match(odd.why, /unrecognised status "blocked"/);
  assert.equal(G.meterGateDecision({ gate: { ...CLEAR, status: undefined }, arms: [AGENT] }).allow, false);
  const dirty = G.meterGateDecision({ gate: CLEAR, arms: [AGENT], dirty: 'the working-tree diagnostics.json differs from its committed HEAD blob (an uncommitted regeneration)' });
  assert.equal(dirty.allow, false); assert.match(dirty.why, /committed HEAD blob/);
  assert.equal(G.meterGateDecision({ gate: CLEAR, arms: [AGENT], waiver: WAIVER, dirty: 'x' }).allow, false, 'a waiver does not excuse an uncommitted gate file');
  assert.equal(G.meterGateDecision({ gate: BLOCK, arms: [CALL], dirty: 'x' }).allow, true, 'a calls-only stage does not read the gate at all');
  assert.equal(G.meterGateDecision({ gate: { ...BLOCK, reasons: undefined }, arms: [AGENT] }).allow, false, 'a malformed blocking gate does not throw');
});

test('parseMeterGate and readMeterGateFile say why there is no gate: missing, unparseable, partial, no D6 section, malformed gate', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mg-file-')), f = (name, text) => { const p = path.join(tmp, name); writeFileSync(p, text); return p; };
  assert.equal(G.parseMeterGate(JSON.stringify({ d6: { summary: { meterGate: BLOCK } } })).gate.status, 'block-until-verified');
  assert.equal(G.parseMeterGate(JSON.stringify({ d6: { summary: { meterGate: BLOCK } } })).problem, null);
  assert.match(G.parseMeterGate('{ nope').problem, /does not parse/);
  assert.match(G.parseMeterGate(JSON.stringify({ d0: {} })).problem, /has no d6\.summary\.meterGate/);
  assert.match(G.parseMeterGate(JSON.stringify({ d0: {}, partial: { ran: ['d0', 'd3'], notRun: ['d6'] } })).problem, /partial run \(d0, d3 only\) with no D6 section/);
  assert.match(G.parseMeterGate(JSON.stringify({ d6: { summary: { meterGate: { status: 'clear' } } } })).problem, /not a need-meter-gate\/1 record/, 'a gate without the schema is not a gate');
  assert.match(G.parseMeterGate(JSON.stringify({ d6: { summary: { meterGate: { schema: G.METER_GATE_SCHEMA } } } })).problem, /with a status/);
  assert.match(G.readMeterGateFile(path.join(tmp, 'absent.json')).problem, /is missing/);
  assert.equal(G.readMeterGate(f('partial.json', JSON.stringify({ d0: {}, partial: { ran: ['d0'] } }))), null);
  // The failure the review reproduced: a file without D6 used to read as "no gate", which allowed the stage; the decision now refuses it.
  const r = G.readMeterGateFile(f('d0only.json', JSON.stringify({ d0: {}, partial: { ran: ['d0'], notRun: ['d6'] } })));
  assert.equal(G.meterGateDecision({ gate: r.gate, problem: r.problem, arms: [AGENT] }).allow, false);
});

test('readCommittedMeterGate reads the HEAD blob, not the working tree, and names an uncommitted difference; the waiver is read from HEAD too', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mg-head-')), file = path.join(tmp, 'diagnostics.json');
  const committed = JSON.stringify({ d6: { summary: { meterGate: BLOCK } } });
  writeFileSync(file, committed);
  const same = G.readCommittedMeterGate({ file, show: () => Buffer.from(committed) });
  assert.equal(same.gate.status, 'block-until-verified'); assert.equal(same.dirty, null); assert.equal(same.source, 'HEAD');
  // The working tree was regenerated by `run.mjs --only d0` into a file without D6: HEAD still has the gate, and the file differs.
  writeFileSync(file, JSON.stringify({ d0: {}, partial: { ran: ['d0'] } }));
  const dirty = G.readCommittedMeterGate({ file, show: () => Buffer.from(committed) });
  assert.equal(dirty.gate.status, 'block-until-verified', 'the gate is the committed one');
  assert.match(dirty.dirty, /differs from its committed HEAD blob/);
  assert.equal(G.meterGateDecision({ gate: dirty.gate, arms: [AGENT], dirty: dirty.dirty, verification: null }).allow, false);
  // Deleted from the working tree; not committed at all.
  assert.match(G.readCommittedMeterGate({ file: path.join(tmp, 'gone.json'), show: () => Buffer.from(committed) }).dirty, /missing/);
  const nowhere = G.readCommittedMeterGate({ file, show: () => null });
  assert.equal(nowhere.gate, null); assert.match(nowhere.problem, /not committed at HEAD/);
  // The real reader on a path outside the repository finds nothing.
  assert.equal(G.gitHeadBlob(path.join(os.tmpdir(), 'x.json')), null);
  assert.equal(G.readCommittedWaiver({ show: () => Buffer.from(JSON.stringify(WAIVER)) }).by, 'owner');
  assert.equal(G.readCommittedWaiver({ show: () => null }), null); assert.equal(G.readCommittedWaiver({ show: () => Buffer.from('{ no') }), null);
  // And the real HEAD blob of the committed diagnostics.json carries a gate (the file was committed with D6).
  const real = G.readCommittedMeterGate();
  assert.ok(real.gate || real.problem, 'git is reachable in this checkout, or the reason is given');
});

test('paidRunChecks fails closed on a missing gate (waiver logged as a deviation), on an uncommitted gate file, and not for a stage of single calls', () => {
  const stages = JSON.parse(readFileSync(path.join(REPO, 'research/need-router-20261014/prereg/stages.json'), 'utf8'));
  const stage = stages.stages.find(s => s.id === 'M1'), plan = { stages, stage, file: 'x', planSha256: 'x' };
  const run = (arms, deps) => LR.paidRunChecks({ plan, units: [{ job: {}, arms, probeArms: [] }], prereg: null, deps: { stampOf: () => null, checkStagesFn: () => ({ errors: [] }), meterVerification: () => null, ...deps } });
  const gateErrors = r => r.errors.filter(e => e.startsWith('meter gate:'));
  // The reproduced failure: the gate reads as null (a partial or missing diagnostics.json).
  const closed = gateErrors(run(['agent-H', 'direct-H'], { meterGate: () => null }));
  assert.equal(closed.length, 1); assert.match(closed[0], /no D6 meter gate on file/); assert.match(closed[0], /owner's waiver/);
  assert.deepEqual(gateErrors(run(['direct-H'], { meterGate: () => null })), [], 'single calls need no agent meter');
  const waived = run(['agent-H'], { meterGate: () => null, meterGateWaiver: () => WAIVER });
  assert.deepEqual(gateErrors(waived), []);
  assert.deepEqual(waived.deviations.map(d => d.kind), ['meter-gate-waiver']); assert.match(waived.deviations[0].text, /waiver of 2026-10-15T09:00:00Z is logged/); assert.equal(waived.deviations[0].waiver.by, 'owner');
  assert.equal(gateErrors(run(['agent-H'], { meterGate: () => null, meterGateWaiver: () => ({ ...WAIVER, by: 'agent' }) })).length, 1, 'only an owner waiver counts');
  // A clear gate in a file that differs from HEAD still refuses.
  assert.deepEqual(gateErrors(run(['agent-O'], { meterGate: () => CLEAR })), []);
  const dirty = gateErrors(run(['agent-O'], { meterGate: () => CLEAR, meterGateDirty: () => 'the working-tree diagnostics.json differs from its committed HEAD blob (an uncommitted regeneration): commit or restore it' }));
  assert.equal(dirty.length, 1); assert.match(dirty[0], /committed HEAD blob/);
  // An unknown status is refused too.
  assert.equal(gateErrors(run(['agent-O'], { meterGate: () => ({ ...CLEAR, status: 'ok' }) })).length, 1);
  // The default path reads the COMMITTED file (meterGateSource, the HEAD blob), not the working tree: its gate, its reason for having none and its dirty flag decide.
  const src = (gate, problem = null, dirty = null) => ({ meterGateSource: () => ({ gate, problem, dirty, source: 'HEAD' }) });
  assert.deepEqual(gateErrors(run(['agent-O'], src(CLEAR))), []);
  const blocked = gateErrors(run(['agent-O'], src(BLOCK)));
  assert.equal(blocked.length, 1); assert.match(blocked[0], /block-until-verified/);
  const partial = gateErrors(run(['agent-O'], src(null, 'diagnostics.json is a partial run (d0 only) with no D6 section')));
  assert.equal(partial.length, 1); assert.match(partial[0], /partial run \(d0 only\)/);
  const stale = gateErrors(run(['agent-O'], src(CLEAR, null, 'the working-tree diagnostics.json differs from its committed HEAD blob (an uncommitted regeneration)')));
  assert.equal(stale.length, 1); assert.match(stale[0], /committed HEAD blob/);
  assert.deepEqual(gateErrors(run(['agent-O'], { ...src(null, 'diagnostics.json is missing'), meterGateWaiver: () => WAIVER })), [], 'the logged owner waiver passes a missing committed gate');
  assert.deepEqual(gateErrors(run(['direct-H'], src(null, 'diagnostics.json is missing'))), []);
});

test('meter-gate-cli reports whether an agent stage may start and exits 1 when it may not', () => {
  const status = spawnSync(process.execPath, [path.join(REPO, 'experiments/need-router/meter-gate-cli.mjs')], { encoding: 'utf8' });
  const out = JSON.parse(status.stdout);
  assert.equal(typeof out.agentStage.allow, 'boolean'); assert.ok('problem' in out && 'dirty' in out);
  assert.equal(status.status, out.agentStage.allow ? 0 : 1, 'the exit code is the decision');
});
