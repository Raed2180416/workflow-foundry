// AGENTV-E8 validator conformance at $0 (MRR change 10: a verifier's miss rate and false-rejection rate are measured
// before its arm runs). Replays every case-tick output recorded in an E8 host journal through the arm-side validator
// (./validator.mjs, with only what the arm can see: its own instance id and the open instances as of the round start) and
// compares the verdict with the host's own refusal recorded right after the call (`arm.error` code `invalid-output`).
// Reads only `call`, `arm.error`, `instance.open` and `instance.close` rows; never the oracle or the truth labels.
//   node experiments/agentv/conformance.mjs [journal.jsonl]   (default: the agent-H s12 journal)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindItem } from '../../beds/ebed/host/host.mjs';
import { binding } from '../../beds/ebed/e8/index.mjs';
import { validateDraft } from './validator.mjs';
import { problemClass } from './arm.mjs';

export const AGENTH_JOURNAL = '/var/tmp/foundry-work/ebed-arms/agenth-e8-s12/journal-w1232-d2.jsonl';

/** Conformance of the arm-side validator with the host's recorded refusals over one journal's rows. */
export function conformance(rows, schemas) {
  const open = new Set();
  let roundKey = null, roundOpen = [];
  const out = { calls: 0, hostRefused: 0, hostAccepted: 0, flaggedRefused: 0, flaggedAccepted: 0, exactProblemText: 0, mergeOutputs: 0, disagreements: [], refusedClasses: {} };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.type === 'instance.open') open.add(r.instance);
    else if (r.type === 'instance.close') open.delete(r.instance);
    if (r.type !== 'call' || r.kind !== 'case' || r.outcome !== 'ok') continue;
    // ctx.instances() answers as of the round start: freeze the open set at the first call row of each round.
    const key = String(r.callId).split('|').slice(0, 2).join('|');
    if (key !== roundKey) { roundKey = key; roundOpen = [...open].map(instance => ({ instance })); }
    const next = rows[i + 1];
    const hostErrors = next?.type === 'arm.error' && next.instance === r.target && next.code === 'invalid-output' ? next.detail : [];
    const v = validateDraft(r.output, { schemas, self: r.target, openInstances: roundOpen });
    out.calls += 1;
    if (r.output && Object.prototype.hasOwnProperty.call(r.output, 'merge')) out.mergeOutputs += 1;
    if (hostErrors.length) { out.hostRefused += 1; if (!v.valid) out.flaggedRefused += 1; for (const p of hostErrors) out.refusedClasses[problemClass(p)] = (out.refusedClasses[problemClass(p)] ?? 0) + 1; }
    else { out.hostAccepted += 1; if (!v.valid) out.flaggedAccepted += 1; }
    if (JSON.stringify(v.problems) === JSON.stringify(hostErrors)) out.exactProblemText += 1;
    else out.disagreements.push({ callId: r.callId, host: hostErrors, validator: v.problems });
  }
  out.missRate = out.hostRefused ? 1 - out.flaggedRefused / out.hostRefused : null;              // P(validator passes | host refuses)
  out.falseRefusalRate = out.hostAccepted ? out.flaggedAccepted / out.hostAccepted : null;       // P(validator refuses | host accepts)
  return out;
}

async function main() {
  const file = process.argv[2] ?? AGENTH_JOURNAL;
  if (!existsSync(file)) throw new Error(`no journal at ${file}`);
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const c = conformance(rows, bindItem(binding).schemas);
  console.log(JSON.stringify({ journal: file, ...c, disagreements: c.disagreements.slice(0, 10) }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
