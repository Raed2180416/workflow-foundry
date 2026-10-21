// CHECK and TERMINATION of arm A1-C v2 (harness/v2/codeowned.mjs), and the act brief: copy-on-change of
// harness/checker.mjs. Changes (research/automationbench-20261014/A1C-V2-DESIGN.md):
//   M1  terminationDecision: with maxRounds 0 (the v2 default) a hard failure never starts a repair: one pass, the round-0
//       check is recorded as instrumentation, and the brief says no second session follows.
//   M2  a check on an app the re-read cannot list is null ("unobservable") with no checker call.
//   M3/M4 the brief shows values to copy, slots to fill, "may mention" and "leave out" tails; the "Not rules" line is gone
//       (ride-along 3); with the pre-send lint on, one line says the client checks outgoing messages.
import { terminationDecision as terminationDecisionV1, BRIEF_BEGIN, BRIEF_END, BRIEF_FILES } from '../checker.mjs';
import { appsToRead, changesText, evaluate, isObservable, rereadWorld } from './postconditions.mjs';
import { renderLedger } from './ledger.mjs';

export { BRIEF_BEGIN, BRIEF_END, BRIEF_FILES };

const j = v => JSON.stringify(v);
const notTail = P => (P.bodyNot?.length ? `, not containing ${P.bodyNot.map(j).join(', ')}` : '');
export const pcLine = p => {
  const P = p.params ?? {};
  const body = {
    gmail_sent: () => `a sent email to ${P.to.join(', ')}${P.cc?.length ? ` (cc ${P.cc.join(', ')})` : ''}${P.subject?.length ? `, subject containing ${P.subject.map(j).join(' and ')}` : ''}${P.body?.length ? `, body containing ${P.body.map(j).join(', ')}` : ''}${notTail(P)}`,
    gmail_not_sent: () => `no email to ${P.to.join(', ')}`,
    slack_posted: () => `a new message in ${P.channel.dm ? `the direct message with ${P.channel.name}` : `#${P.channel.name ?? P.channel.id}`}${P.text?.length ? ` containing ${P.text.map(j).join(', ')}` : ''}${notTail(P)}`,
    slack_not_posted: () => `no new message in #${P.channel.name ?? P.channel.id}`,
    channel_posted: () => `a new ${P.app} post or message${P.channel ? ` in ${P.channel}` : ''}${P.text?.length ? ` containing ${P.text.map(j).join(', ')}` : ''}${notTail(P)}`,
    record_field: () => `${P.ptr} has ${P.field} = ${j(P.value)}`,
    record_created: () => `a new ${P.app}${P.kind ? ` ${P.kind}` : ''} record${P.values?.length ? ` containing ${P.values.map(j).join(', ')}` : ''}`,
    child_created: () => `a new ${P.kind} on ${P.parent}${P.values?.length ? ` containing ${P.values.map(j).join(', ')}` : ''}`,
    record_deleted: () => `${P.ptr} is deleted`,
    record_unchanged: () => `${P.ptr} is left unchanged`,
    sheet_row: () => `a new or updated row${P.spreadsheetId ? ` in ${P.spreadsheetId}` : ''}${P.values?.length ? ` containing ${P.values.map(j).join(', ')}` : ''}`,
    row_not_exists: () => `no new or updated row${P.spreadsheetId ? ` in ${P.spreadsheetId}` : ''} containing ${P.values.map(j).join(', ')}`,
    judged: () => `(judged after the work) ${p.statement}`,
  }[p.type]?.() ?? p.statement;
  return `- ${p.id} (${p.item}${p.hard ? '' : ', advisory'}${isObservable(p) ? '' : ', not observable here'}): ${body}`;
};
export const renderChecks = pcs => pcs.map(pcLine).join('\n');

/** The acting session's brief (v1's, with the v2 headings and tails). Code-generated from the inventory, the merged ledger
 * and the checks; it carries no grading data (none exists on this side of the bridge). */
export function briefSection({ inv, merged, pcs, stepsLeft, responseCap, inventoryText, inline = true, gate = false, singlePass = true }) {
  const today = merged.today ? `${merged.today.value} (from ${merged.today.source ?? '?'}${merged.today.quote ? `: "${String(merged.today.quote).slice(0, 120)}"` : ''}; ${merged.today.votes ?? 1} of ${merged.readers} readers)` : "not established: take it from the request and the records' business dates (not their system timestamps)";
  return `${BRIEF_BEGIN}
This brief was prepared by the harness that runs this session, before the session started: code read every connected app (no change was made), ${['no', 'one', 'two', 'three', 'four', 'five'][merged.readers ?? 3] ?? merged.readers} independent readers wrote the request's requirements with the source of every value, and code wrote the checks it will run on the systems after you stop. The user message is still the task; this brief is help, not a new instruction. Where the brief and the records disagree, the records win.

- Today's date for this task: ${today}.
- Connected apps: ${inv.connected.join(', ') || 'none'}. Not connected (calls fail with 401; do not use): ${inv.outOfScope.join(', ') || 'none'}.
- World steps left for you: about ${stepsLeft}; this session ends after at most ${responseCap} responses. The read is done: act first, re-read only what you need.
- Files in your working directory (reading them costs no world step): ${BRIEF_FILES.inventory} (every record read, with pointers [app:kind:id]), ${BRIEF_FILES.ledger} (the requirements), ${BRIEF_FILES.checks} (the checks).
${inv.precedents?.length ? `- Precedents (existing records of the kinds you may create; follow their format and conventions): ${inv.precedents.map(p => p.ptr).join(', ')}.\n` : ''}
### Requirements (MUST = do it; MUST NOT = a cited rule forbids it; copy data values exactly (names, addresses, ids, amounts); in messages write machine timestamps as dates in words)
${renderLedger(merged) || '(none extracted: work from the request and the records)'}
${gate ? '- The client in your working directory checks each outgoing message against the "leave out" rules above. It refuses a message that breaks one, once, with "HARNESS GATE" (no world step is used); fix the message, or resend it unchanged if the rule does not apply.\n' : ''}
### Checks the harness runs after you stop${singlePass ? ' (recorded; no second session follows, so finish the work in this one)' : ''}
${renderChecks(pcs) || '(none)'}
If a check above is wrong for the request (the records show otherwise), follow the request and the records.
${inline ? `\n### The records (also in ${BRIEF_FILES.inventory})\n${inventoryText}\n` : `\nThe records are in ${BRIEF_FILES.inventory} (too long to show here): read the parts you need with grep or sed.\n`}${BRIEF_END}`;
}

/** The repair session's brief (v1's text over the v2 check lines; reached only with maxRounds > 0). */
export function repairSection({ failing, passing, stepsLeft, responseCap, round }) {
  return `${BRIEF_BEGIN}
This is repair round ${round}. A previous session worked on this task. The harness re-read the systems and ran its checks: the checks below FAILED. Fix only these; everything that passed is done and must not be repeated (no second copy of a message or record). The user message is still the task.

- World steps left: about ${stepsLeft}; this session ends after at most ${responseCap} responses.
- ${BRIEF_FILES.repair} in your working directory repeats this list; ${BRIEF_FILES.inventory} holds every record read before the work, ${BRIEF_FILES.ledger} the requirements.

### Failing checks, with what the systems show now
${failing.map(f => `${pcLine(f.pc)}\n  evidence: ${f.evidence}${f.sourceText ? `\n  source ${f.pc.source}: ${f.sourceText}` : ''}`).join('\n')}

### Already done (do not redo)
${passing.map(p => pcLine(p.pc)).join('\n') || '(nothing yet)'}
${BRIEF_END}`;
}

/**
 * runChecks({ client, inv, pcs, maxSteps, judge, sources, node }) -> { results: [{pc, pass, evidence, by, observable}], after, steps, apps, judged }.
 * v1's, with v2 evaluation; an unobservable check is null with no checker call.
 */
export async function runChecks({ client, inv, pcs, maxSteps = 3, judge = null, sources = new Map(), node = 'check' }) {
  const apps = appsToRead(pcs, inv);
  const after = await rereadWorld({ client, apps, maxSteps, node });
  const results = pcs.map(pc => { const e = evaluate(pc, inv, after); return { pc, ...e, observable: !e.unobservable, by: e.unobservable ? 'code (unobservable)' : pc.type === 'judged' ? 'checker' : 'code' }; });
  const pending = results.filter(r => r.pass === null && r.observable);
  let judgeCall = null;
  if (pending.length && judge) {
    const items = pending.map(r => ({ id: r.pc.id, hard: r.pc.hard, statement: r.pc.statement, source: r.pc.source, sourceText: r.pc.source === 'request' ? '' : String(sources.get(r.pc.source)?.text ?? '').replace(/\s+/g, ' ').slice(0, 2500), apps: r.pc.app ? [r.pc.app] : apps, changes: changesText(inv, after, r.pc.app ? [r.pc.app] : null) }));
    judgeCall = await judge(items);
    for (const r of pending) {
      const v = judgeCall?.verdicts?.find(x => String(x?.id) === r.pc.id);
      if (v && typeof v.pass === 'boolean') { r.pass = v.pass; r.evidence = `checker: ${String(v.why ?? '').slice(0, 300)}`; }
      else r.evidence = 'checker gave no verdict';
    }
  }
  return { results, after, steps: after.steps ?? 0, apps, judged: pending.length };
}

/** v1's code-owned termination; with maxRounds 0 (repairs off) a hard failure ends the pipeline as "single pass". */
export function terminationDecision(o) {
  const d = terminationDecisionV1(o);
  if (o.maxRounds !== 0) return d;
  const hardFail = o.results.filter(r => r.pc.hard && r.pass === false);
  return hardFail.length ? { repair: false, reason: `single pass (repairs off): ${hardFail.length} hard check(s) fail`, failing: hardFail.length } : { repair: false, reason: d.reason };
}
