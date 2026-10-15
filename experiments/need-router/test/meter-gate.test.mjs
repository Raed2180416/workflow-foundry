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

test('meterGateDecision: refuses an agent stage while blocked, allows without an agent arm, with a clear gate, or with a passing verification record', () => {
  const agent = { factory: 'b0Agent' }, call = { factory: 'b0Call' }, built = { build: { factory: 'construct' }, run: { factory: 'b1Script' } }, guided = { build: { factory: 'procedureWriter' }, run: { factory: 'b0Agent' } };
  assert.deepEqual([agent, call, built, guided, { factory: 'static@v3' }].map(G.isAgentArmDef), [true, false, true, true, false]);
  const no = G.meterGateDecision({ gate: BLOCK, arms: [call, agent] });
  assert.equal(no.allow, false); assert.match(no.why, /block-until-verified.*OUTPUT_TOKENS_UNDER_RECORDED/);
  assert.equal(G.meterGateDecision({ gate: BLOCK, arms: [call] }).allow, true, 'a calls-only stage (M1) does not need the agent meter');
  assert.equal(G.meterGateDecision({ gate: CLEAR, arms: [agent] }).allow, true);
  assert.equal(G.meterGateDecision({ gate: null, arms: [agent] }).allow, false, 'no gate on file: the gate fails closed (it used to allow, which let a partial diagnostics.json switch it off)');
  assert.equal(G.meterGateDecision({ gate: null, arms: [call] }).allow, true, 'a calls-only stage needs no gate');
  const good = { schema: G.VERIFICATION_SCHEMA, sessions: [{ method: 'per-message', recorded: 990, final: 1000 }, { method: 'per-message', recorded: 5000, final: 5100 }] };
  assert.equal(G.meterGateDecision({ gate: BLOCK, verification: good, arms: [agent] }).allow, true);
  for (const bad of [null, { ...good, passed: true, sessions: [good.sessions[0]] }, { ...good, passed: true, sessions: [...good.sessions, { method: 'per-message', recorded: 100, final: 1000 }] },
    { ...good, passed: true, sessions: [...good.sessions, { method: 'unverified', recorded: 100, final: 100 }] }, { schema: 'x', sessions: good.sessions }]) {
    assert.equal(G.meterGateDecision({ gate: BLOCK, verification: bad, arms: [agent] }).allow, false, JSON.stringify(bad)?.slice(0, 60));
  }
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
  // Per-message lines that agree with the final usage: a plain re-price, no flag.
  const good = [[10, 12000, 50000, 8000, 'claude-opus-5-5'], [3, 14553, 60000, 0, 'claude-opus-5-5']];
  const v = LR.priceSession(P, 'claude-opus-5-5', { messageUsage: good, reportedUsd: 99, finalUsage: { output_tokens: 26553 }, meter: { tolerance: 0.05 } });
  assert.equal(v.meterUnverified, undefined); assert.equal(v.imputed, 0); assert.equal(v.meterCheck.ok, true);
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

test('the 30% imputed rule sees the gap: a guarded agent mode is unlabelled where the unguarded re-price would have been trusted', async () => {
  const { needTable, needLabels, makeCell } = await import('../metrics.mjs');
  const mk = (guarded) => {
    const rows = [];
    for (let t = 0; t < 6; t++) {
      for (const mode of ['agent-H', 'agent-O']) {
        const o = mode === 'agent-O';
        const c = LR.priceSession(P, o ? 'claude-opus-5-5' : 'claude-haiku-5-5', { messageUsage: [[10, o ? 40 : 300, 30000, 0, null]], reportedUsd: o ? 0.90 : 0.02, finalUsage: { output_tokens: o ? 26000 : 310 }, meter: guarded ? { tolerance: 0.05 } : null });
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
  const ok = LR.matrixRow({ ...rec, meta: { ...rec.meta, messageUsage: [[10, 19800, 50000, 8000, 'claude-opus-5-5']] } }, { stage: 'NL0', job, armDef, priceTable: P, book: null, taskInfo: { seed: 610, difficulty: 3 }, meter: { tolerance: 0.05 } });
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
  const good = { schema: G.VERIFICATION_SCHEMA, sessions: [{ method: 'per-message', recorded: 99, final: 100 }, { method: 'final-output', final: 5000, reportedUsd: 1, pricedUsd: 1.05 }] };
  assert.deepEqual(run(['construct-H'], { meterGate: () => BLOCK, meterVerification: () => good }), []);
  assert.equal(run(['construct-H', 'agent-H+proc', 'build-O'], { meterGate: () => BLOCK, meterVerification: () => null }).length, 1);
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
  assert.ok(rec.sessions.every(s => s.ok && /^[0-9a-f]{16}$/.test(s.sha256) && s.relGap <= 0.05));
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
    line({ type: 'result', total_cost_usd: (10 * 4 + 20000 * 20 + 700000 * 8) / 1e6, usage: { output_tokens: 20000, cache_creation: { ephemeral_1h_input_tokens: 700000, ephemeral_5m_input_tokens: 0 } } })].join('\n'));
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
  assert.equal(G.meterGateDecision({ gate: BLOCK, verification: G.readVerification(out), arms: [{ factory: 'b0Agent' }] }).allow, true);
  const no = spawnSync(process.execPath, [cli, '--verify', good1, snap], { encoding: 'utf8' });
  assert.equal(no.status, 1); assert.equal(JSON.parse(no.stdout).passed, false);
  const status = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(status.status, 1, 'the committed gate blocks and no record is on file (or there is no committed gate to read: refused either way)');
  const rep = JSON.parse(status.stdout);
  if (rep.gate) assert.equal(rep.gate.status, 'block-until-verified'); else assert.match(rep.problem, /not committed at HEAD|no d6|does not parse/i);
  assert.equal(rep.agentStage.allow, false);
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
