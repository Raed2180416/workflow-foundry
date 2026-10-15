// Command line of the cost-meter gate (experiments/need-router/meter-gate.mjs):
//   node experiments/need-router/meter-gate-cli.mjs                         print the committed gate (the HEAD blob label-run reads) and the verification record and
//        whether a paid agent stage may start; exit 1 when it may not (blocked, or no gate on file without the owner's waiver, or an uncommitted diagnostics.json)
//   node experiments/need-router/meter-gate-cli.mjs --verify <transcript.jsonl>... [--write FILE]
//        verify saved CLI transcripts ($0; `.executor-transcript.jsonl` in a session's work directory): each is priced by label-run's own priceSession
//        with the pinned table and accepted per-message, from the final usage, or not at all; --write saves the record (research/need-router-20261014/
//        analysis/m0/meter-verification.json is the file label-run reads). Exit 0 when the record passes.
// A separate entry file because label-run.mjs imports meter-gate.mjs: an entry that awaited label-run from inside meter-gate.mjs would wait on itself.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { verifyTranscripts, readCommittedMeterGate, readCommittedWaiver, readVerification, verificationPasses, meterGateDecision } from './meter-gate.mjs';
import { priceSession } from './label-run.mjs';
import { STAGES_FILE } from './prereg-check.mjs';

const args = process.argv.slice(2), arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
if (args.includes('--verify')) {
  const files = args.slice(args.indexOf('--verify') + 1).filter(a => !a.startsWith('--') && a !== arg('--write'));
  const table = JSON.parse(readFileSync(STAGES_FILE, 'utf8')).priceTable;
  const rec = verifyTranscripts(files, { priceSession, table });
  console.log(JSON.stringify(rec, null, 1));
  if (arg('--write')) { mkdirSync(path.dirname(path.resolve(arg('--write'))), { recursive: true }); writeFileSync(path.resolve(arg('--write')), JSON.stringify(rec, null, 1) + '\n'); }
  process.exit(rec.passed ? 0 : 1);
}
const committed = readCommittedMeterGate(), v = readVerification();
const decision = meterGateDecision({ gate: committed.gate, verification: v, arms: [{ factory: 'b0Agent' }], waiver: readCommittedWaiver(), problem: committed.problem, dirty: committed.dirty });
console.log(JSON.stringify({ gate: committed.gate, problem: committed.problem, dirty: committed.dirty, verification: v ? { passed: verificationPasses(v), sessions: v.sessions?.length ?? 0 } : null, agentStage: { allow: decision.allow, why: decision.why } }, null, 1));
process.exit(decision.allow ? 0 : 1);
