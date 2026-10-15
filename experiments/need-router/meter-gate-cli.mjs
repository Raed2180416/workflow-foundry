// Command line of the cost-meter gate (experiments/need-router/meter-gate.mjs):
//   node experiments/need-router/meter-gate-cli.mjs                         print the committed gate (the HEAD blob label-run reads), whether it is current for the stages.json
//        price table, the committed verification record (the HEAD blob, re-derived from its transcripts) and whether a paid agent stage (every agent arm of stages.json)
//        may start; exit 1 when it may not (blocked, insufficient evidence, stale, or no gate on file without the owner's waiver, or an uncommitted diagnostics.json)
//   node experiments/need-router/meter-gate-cli.mjs --verify <transcript.jsonl>... [--write FILE]
//        verify saved CLI transcripts ($0; `.executor-transcript.jsonl` in a session's work directory): each is priced by label-run's own priceSession
//        with the pinned table and accepted per-message (output tokens and price both within tolerance), from the final usage, or not at all; --write saves the
//        record, with each transcript's path and full sha256, the price table id and the models covered (research/need-router-20261014/analysis/m0/meter-
//        verification.json; label-run reads its HEAD blob, so commit it, and re-derives every session from the transcripts at launch). Exit 0 when the record passes.
// A separate entry file because label-run.mjs imports meter-gate.mjs: an entry that awaited label-run from inside meter-gate.mjs would wait on itself.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { verifyTranscripts, readCommittedMeterGate, readCommittedWaiver, readCommittedVerification, rederiveVerification, gateStaleness, agentModelsOf, isAgentArmDef, meterGateDecision } from './meter-gate.mjs';
import { priceSession } from './label-run.mjs';
import { STAGES_FILE } from './prereg-check.mjs';

const args = process.argv.slice(2), arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const stages = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
if (args.includes('--verify')) {
  const files = args.slice(args.indexOf('--verify') + 1).filter(a => !a.startsWith('--') && a !== arg('--write'));
  const rec = verifyTranscripts(files, { priceSession, table: stages.priceTable });
  console.log(JSON.stringify(rec, null, 1));
  if (arg('--write')) { mkdirSync(path.dirname(path.resolve(arg('--write'))), { recursive: true }); writeFileSync(path.resolve(arg('--write')), JSON.stringify(rec, null, 1) + '\n'); }
  process.exit(rec.passed ? 0 : 1);
}
const committed = readCommittedMeterGate(), v = readCommittedVerification();
const arms = Object.values(stages.arms).filter(isAgentArmDef), priceTableId = stages.priceTable?.id ?? null;
const stale = committed.gate ? gateStaleness(committed.gate, { priceTableId, models: agentModelsOf(arms) }) : null;
const rederive = rec => rederiveVerification(rec, { priceSession, table: stages.priceTable });
const decision = meterGateDecision({ gate: committed.gate, verification: v.record, verificationProblem: v.problem, arms, waiver: readCommittedWaiver(), problem: committed.problem, dirty: committed.dirty, priceTableId, stale, rederive });
console.log(JSON.stringify({
  gate: committed.gate, problem: committed.problem, dirty: committed.dirty, stale,
  verification: v.record ? { source: v.source, problem: null, dirty: v.dirty, sessions: v.record.sessions?.length ?? 0, priceTable: v.record.priceTable?.id ?? null, models: v.record.models ?? null, rederived: rederive(v.record) } : { source: v.source, problem: v.problem },
  agentStage: { allow: decision.allow, why: decision.why, models: agentModelsOf(arms), priceTable: priceTableId },
}, null, 1));
process.exit(decision.allow ? 0 : 1);
