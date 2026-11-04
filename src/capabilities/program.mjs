// Program capabilities (CM0), ARCHITECTURE.md §2.2 and §3.9: a frontier- or owner-written JavaScript program, admitted by the owner as a
// catalog entry of kind `program` and pinned by the sha256 of its source, that composes other members (pagination, joins, sums) in ONE
// typed call instead of many model turns. No model sees a tool while it runs (Tier 0 cost: zero tool-definition tokens).
// Rules (v1):
//   - reads only: every member in `uses` must be effects none, so the program's effects (the max over uses) are none;
//   - its output label is the join of its attested label and every used member's label (untrusted data stays untrusted); its data class,
//     its egress, its risk and its approval flag are the maximum over its own attestation and the members it uses, and its trust and
//     custody the WEAKEST of the program entry's and the used members' (review-thesis #9): a T0 program wrapping a T2 third-party tool is
//     a T2 third-party egress, so neither auto-bind nor the Rule of Two can be laundered through it;
//   - its cost is the sum of reservations: maxCalls x the dearest used member;
//   - it can call ONLY the members it lists, each through the host's own gates (pins, schemas, credentials, scrub); anything else is
//     CAPABILITY_DENIED and ends the program; the host counts the calls (maxCalls);
//   - the source is re-hashed before every run (a changed file is PROGRAM_PIN_MISMATCH), and the used members' implementations enter the
//     program's own pins, so a used server's drift is drift of the program too (I9 through the approved lock).
import { readFileSync, lstatSync } from 'node:fs';
import { checkMemberSchema } from './import-mcp.mjs';
import { compileDataSchema } from '../validate.mjs';
import { CUSTODY, EGRESS, fail, FoundryError, joinLabels, sha256, TRUST } from './common.mjs';
import { custodyOf, memberRecord } from './members.mjs';
import { runProgram } from './rpc-sandbox.mjs';

function readSource(entry) {
  const file = entry.source.file;
  let info;
  try { info = lstatSync(file); } catch { fail('PROGRAM_SOURCE', `Program ${entry.id}: source file missing`); }
  if (info.isSymbolicLink() || !info.isFile() || info.size > 256 * 1024) fail('PROGRAM_SOURCE', `Program ${entry.id}: the source must be a regular file of at most 256 KiB`);
  const source = readFileSync(file, 'utf8');
  if (sha256(source) !== entry.source.sha256) fail('PROGRAM_PIN_MISMATCH', `Program ${entry.id}: the source no longer matches its attested sha256`);
  return source;
}

/** The member of one program entry, built from the members already qualified in this host (`members`: Map id -> record). */
export function programMember(entry, members) {
  readSource(entry);
  const [[name, attestation]] = Object.entries(entry.members), uses = entry.uses.map(id => members.get(id));
  entry.uses.forEach((id, i) => { if (!uses[i]) fail('PROGRAM_USES_ABSENT', `Program ${entry.id} uses ${id}, which did not qualify`, { member: id }); });
  for (const m of uses) if (m.effects !== 'none' || m.kind === 'program') fail('PROGRAM_USES_EFFECT', `Program ${entry.id} may use only effects-none, non-program members in v1 (${m.id})`, { member: m.id });
  if (attestation.effects !== 'none') fail('PROGRAM_USES_EFFECT', `Program ${entry.id}: v1 programs are reads only`);
  checkMemberSchema(attestation.view.inputSchema, `${entry.id}/${name} view`);
  compileDataSchema(attestation.outputSchema);
  const maxCalls = entry.limits?.maxCalls ?? 20;
  // Egress is derived like the data class (review M6): a program that calls a third-party egress member IS a third-party egress, whatever
  // its own attestation says, so the Rule of Two sees it.
  const egress = [attestation.egress, ...uses.map(m => m.egress)].reduce((a, b) => EGRESS.indexOf(b) > EGRESS.indexOf(a) ? b : a, 'local');
  const worst = (order, values) => values.filter(v => v !== null && v !== undefined).reduce((a, b) => order.indexOf(b) > order.indexOf(a) ? b : a, null);
  const risk = [attestation.risk, ...uses.map(m => m.risk)].includes('high') ? 'high' : attestation.risk;
  const derived = { ...attestation, effects: 'none', egress, risk, requiresApproval: attestation.requiresApproval === true || risk === 'high' || uses.some(m => m.requiresApproval === true),
    outputLabel: joinLabels([attestation.outputLabel, ...uses.map(m => m.outputLabel)]),
    dataClass: uses.some(m => m.dataClass === 'secret') ? 'secret' : uses.some(m => m.dataClass === 'private') ? 'private' : attestation.dataClass,
    cost: Math.max(attestation.cost ?? 0, maxCalls * Math.max(0, ...uses.map(m => m.cost ?? 0))) };
  const trust = worst(TRUST, [entry.trust, ...uses.map(m => m.trust)]), custody = worst(CUSTODY, [custodyOf(entry), ...uses.map(m => m.custody)]);
  return memberRecord({ entry: { ...entry, trust }, name, id: `program.${entry.id}.${name}`, attestation: derived, adapter: 'nodecap-program/1', custody,
    pins: { source: entry.source.sha256, uses: Object.fromEntries(uses.map(m => [m.id, m.implementation])) },
    extra: { program: { uses: [...entry.uses], maxCalls, lang: entry.source.lang } } });
}

/** Run one program member. `invoke(id, args)` is the host's own member call (its gates apply to every inner call). */
export async function invokeProgram(member, entry, args, { invoke, signal, timeoutMs = member.maxTimeoutMs ?? 30000, unshare } = {}) {
  const source = readSource(entry), allowed = new Set(member.program.uses);
  const { value, calls } = await runProgram({ source, input: args, maxCalls: member.program.maxCalls, timeoutMs, signal, unshare,
    onCall: async ({ tool, args: callArgs }) => {
      if (!allowed.has(tool)) throw new FoundryError('CAPABILITY_DENIED', `The program called ${String(tool).slice(0, 80)}, which it does not list in uses`);
      return invoke(tool, callArgs);
    } });
  return { value, calls };
}
