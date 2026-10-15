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
import * as G from '../meter-gate.mjs';
import * as LR from '../label-run.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const P = JSON.parse(readFileSync(path.join(REPO, 'research/need-router-20261014/prereg/stages.json'), 'utf8')).priceTable;
const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const BLOCK = G.buildMeterGate({ outputRatios: [{ label: 'a', recorded: 150, final: 40000 }, { label: 'b', recorded: 300, final: 60000 }], eraRatios: [{ key: 'opus | post', sessions: 47, ratio: 2.96 }] });
const CLEAR = G.buildMeterGate({ outputRatios: [{ label: 'a', recorded: 39000, final: 40000 }], eraRatios: [{ key: 'opus | post', sessions: 47, ratio: 1.02 }] });

test('buildMeterGate: block-until-verified on output tokens far from the final usage or a re-price off the reported total; clear inside both bands', () => {
  assert.equal(BLOCK.schema, G.METER_GATE_SCHEMA);
  assert.equal(BLOCK.status, 'block-until-verified');
  assert.deepEqual(BLOCK.reasons.map(r => r.code), ['OUTPUT_TOKENS_UNDER_RECORDED', 'REPRICE_OFF_REPORTED']);
  assert.match(BLOCK.blocks, /agent arm/);
  assert.match(BLOCK.clearedBy, /meter-gate\.mjs --verify/);
  assert.equal(CLEAR.status, 'clear'); assert.deepEqual(CLEAR.reasons, []); assert.equal(CLEAR.blocks, null);
  // Only the output rule, only the price rule; a thin model-era (under 3 sessions) does not trip the price band; no evidence is clear.
  assert.deepEqual(G.buildMeterGate({ outputRatios: [{ recorded: 10, final: 1000 }] }).reasons.map(r => r.code), ['OUTPUT_TOKENS_UNDER_RECORDED']);
  assert.deepEqual(G.buildMeterGate({ eraRatios: [{ key: 'k', sessions: 5, ratio: 0.8 }] }).reasons.map(r => r.code), ['REPRICE_OFF_REPORTED']);
  assert.equal(G.buildMeterGate({ eraRatios: [{ key: 'k', sessions: 2, ratio: 3 }] }).status, 'clear');
  assert.equal(G.buildMeterGate().status, 'clear');
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
  assert.equal(G.meterGateDecision({ gate: null, arms: [agent] }).allow, true, 'no gate on file: reported, and the per-session check still applies');
  const good = { schema: G.VERIFICATION_SCHEMA, sessions: [{ recorded: 990, final: 1000 }, { recorded: 5000, final: 5100 }] };
  assert.equal(G.meterGateDecision({ gate: BLOCK, verification: good, arms: [agent] }).allow, true);
  for (const bad of [null, { ...good, passed: true, sessions: [good.sessions[0]] }, { ...good, passed: true, sessions: [...good.sessions, { recorded: 100, final: 1000 }] }, { schema: 'x', sessions: good.sessions }]) {
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
        const c = LR.priceSession(P, o ? 'claude-opus-5-5' : 'claude-haiku-5-5', { messageUsage: [[10, o ? 40 : 300, 30000, 0, null]], reportedUsd: o ? 0.60 : 0.02, finalUsage: { output_tokens: o ? 26000 : 310 }, meter: guarded ? { tolerance: 0.05 } : null });
        rows.push({ job: 'j', mode, task: `t${t}`, rep: 0, pass: true, delivered: true, schemaValid: true, seed: 700 + t, usdRepriced: c.measured, usdImputed: c.imputed, repriced: true });
      }
    }
    return needLabels(needTable(rows, []), { reps: 0, cells: [makeCell(1, 10, 1)] }).at('j', makeCell(1, 10, 1));
  };
  const raw = mk(false), guarded = mk(true);
  assert.equal(raw.unlabelled, null, 'unguarded, the under-priced re-price is booked as measured and the label is trusted');
  assert.ok(raw.u.get('agent-O') > 0.95, 'the unguarded Opus agent looks as cheap as the Haiku agent');
  assert.match(guarded.unlabelled, /imputed dollars over 0\.3 in agent-O/, 'guarded, the gap is imputed and the cell is left unlabelled');
  assert.ok(guarded.u.get('agent-O') < 0.5, 'and its utility charges the reported $0.60 a task');
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
  assert.equal(blocked.length, 1); assert.match(blocked[0], /block-until-verified/); assert.match(blocked[0], /meter-gate\.mjs --verify/);
  assert.deepEqual(run(['direct-H'], { meterGate: () => BLOCK, meterVerification: () => null }), [], 'a stage of single calls does not need the agent meter');
  assert.deepEqual(run(['agent-O'], { meterGate: () => CLEAR, meterVerification: () => null }), []);
  const good = { schema: G.VERIFICATION_SCHEMA, sessions: [{ recorded: 99, final: 100 }, { recorded: 200, final: 200 }] };
  assert.deepEqual(run(['construct-H'], { meterGate: () => BLOCK, meterVerification: () => good }), []);
  assert.equal(run(['construct-H', 'agent-H+proc', 'build-O'], { meterGate: () => BLOCK, meterVerification: () => null }).length, 1);
});

test('transcriptUsage and verifyTranscripts read the last usage per message id and the result event; the CLI record round-trips', () => {
  const line = o => JSON.stringify(o);
  const transcript = (outs, final) => [
    line({ type: 'system', subtype: 'init' }),
    ...outs.flatMap((o, i) => [line({ type: 'assistant', message: { id: `m${i}`, usage: { output_tokens: 3 } } }), line({ type: 'assistant', message: { id: `m${i}`, usage: { output_tokens: o } } })]),
    line({ type: 'result', total_cost_usd: 0.5, usage: { output_tokens: final } }),
  ].join('\n');
  const u = G.transcriptUsage(transcript([100, 200], 300));
  assert.deepEqual([u.messages, u.recorded, u.final, u.hasResult], [2, 300, 300, true], 'a message repeated per content block counts once, at its last usage');
  assert.equal(G.transcriptUsage(transcript([10], 300)).hasResult, true);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'meter-'));
  const files = [transcript([100, 200], 300), transcript([50, 50], 100), transcript([10, 10], 5000)].map((t, i) => { const f = path.join(tmp, `t${i}.jsonl`); writeFileSync(f, t); return f; });
  const rec = G.verifyTranscripts(files.slice(0, 2));
  assert.equal(rec.passed, true); assert.equal(rec.schema, G.VERIFICATION_SCHEMA); assert.ok(rec.sessions.every(s => s.ok && /^[0-9a-f]{16}$/.test(s.sha256)));
  assert.equal(G.verificationPasses(rec), true);
  const snap = G.verifyTranscripts([files[0], files[2]]);
  assert.equal(snap.passed, false, 'one snapshot-style transcript fails the record');
  assert.equal(G.verifyTranscripts([files[0]]).passed, false, 'one transcript is not enough');
  const noResult = path.join(tmp, 'killed.jsonl'); writeFileSync(noResult, line({ type: 'assistant', message: { id: 'm', usage: { output_tokens: 9 } } }));
  assert.equal(G.verifyTranscripts([files[0], noResult]).passed, false, 'a killed session has no final usage to verify against');
});
