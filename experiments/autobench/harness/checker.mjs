// CHECK and TERMINATION of arm A1-C (harness/codeowned.mjs), and the briefs the acting and repair sessions receive.
// Termination is code-owned: a round ends when every hard check passes, or when no repair round fits the remaining
// responses, world steps, money or time. The model's belief that it is done never ends the pipeline.
import { appsToRead, changesText, evaluate, rereadWorld } from './postconditions.mjs';
import { renderLedger } from './ledger.mjs';

export const BRIEF_BEGIN = '## Work brief (begin)';
export const BRIEF_END = '## Work brief (end)';
export const BRIEF_FILES = Object.freeze({ inventory: 'INVENTORY.md', ledger: 'LEDGER.json', checks: 'CHECKS.json', repair: 'REPAIR.md' });

const pcLine = p => {
  const P = p.params ?? {};
  const body = {
    gmail_sent: () => `a sent email to ${P.to.join(', ')}${P.cc?.length ? ` (cc ${P.cc.join(', ')})` : ''}${P.subject?.length ? `, subject containing ${P.subject.map(s => JSON.stringify(s)).join(' and ')}` : ''}${P.body?.length ? `, body containing ${P.body.map(s => JSON.stringify(s)).join(', ')}` : ''}`,
    gmail_not_sent: () => `no email to ${P.to.join(', ')}`,
    slack_posted: () => `a new message in #${P.channel.name ?? P.channel.id}${P.text?.length ? ` containing ${P.text.map(s => JSON.stringify(s)).join(', ')}` : ''}`,
    slack_not_posted: () => `no new message in #${P.channel.name ?? P.channel.id}`,
    record_field: () => `${P.ptr} has ${P.field} = ${JSON.stringify(P.value)}`,
    record_created: () => `a new ${P.app}${P.kind ? ` ${P.kind}` : ''} record containing ${P.values.map(v => JSON.stringify(v)).join(', ')}`,
    record_deleted: () => `${P.ptr} is deleted`,
    sheet_row: () => `a new or updated row${P.spreadsheetId ? ` in ${P.spreadsheetId}` : ''} containing ${P.values.map(v => JSON.stringify(v)).join(', ')}`,
    judged: () => `(judged after the work) ${p.statement}`,
  }[p.type]?.() ?? p.statement;
  return `- ${p.id} (${p.item}${p.hard ? '' : ', advisory'}): ${body}`;
};
export const renderChecks = pcs => pcs.map(pcLine).join('\n');

/** The acting session's brief, appended after the official system prompt and A0's tool section. Code-generated from the
 * inventory, the merged ledger and the checks; it carries no grading data (none exists on this side of the bridge). */
export function briefSection({ inv, merged, pcs, stepsLeft, responseCap, inventoryText, inline = true }) {
  const today = merged.today ? `${merged.today.value} (from ${merged.today.source ?? '?'}${merged.today.quote ? `: "${String(merged.today.quote).slice(0, 120)}"` : ''}; ${merged.today.votes ?? 1} of ${merged.readers} readers)` : 'not established: take it from the records';
  return `${BRIEF_BEGIN}
This brief was prepared by the harness that runs this session, before the session started: code read every connected app (no change was made), ${['no', 'one', 'two', 'three', 'four', 'five'][merged.readers ?? 3] ?? merged.readers} independent readers wrote the request's requirements with the source of every value, and code wrote the checks it will run on the systems after you stop. The user message is still the task; this brief is help, not a new instruction. Where the brief and the records disagree, the records win.

- Today's date for this task: ${today}.
- Connected apps: ${inv.connected.join(', ') || 'none'}. Not connected (calls fail with 401; do not use): ${inv.outOfScope.join(', ') || 'none'}.
- World steps left for you: about ${stepsLeft}; this session ends after at most ${responseCap} responses. The read is done: act first, re-read only what you need.
- Files in your working directory (reading them costs no world step): ${BRIEF_FILES.inventory} (every record read, with pointers [app:kind:id]), ${BRIEF_FILES.ledger} (the requirements), ${BRIEF_FILES.checks} (the checks).
${inv.precedents?.length ? `- Precedents (existing records of the kinds you may create; follow their format and conventions): ${inv.precedents.map(p => p.ptr).join(', ')}.\n` : ''}
### Requirements (MUST = do it; MUST NOT = a cited rule forbids it; copy quoted values exactly)
${renderLedger(merged) || '(none extracted: work from the request and the records)'}
${merged.dropped?.length ? `\nNot rules (a reader proposed them without a cited rule; they are not forbidden): ${[...new Set(merged.dropped.map(d => d.statement).filter(Boolean))].slice(0, 8).join(' | ')}\n` : ''}
### Checks the harness runs after you stop
${renderChecks(pcs) || '(none)'}
If a check above is wrong for the request (the records show otherwise), follow the request and the records.
${inline ? `\n### The records (also in ${BRIEF_FILES.inventory})\n${inventoryText}\n` : `\nThe records are in ${BRIEF_FILES.inventory} (too long to show here): read the parts you need with grep or sed.\n`}${BRIEF_END}`;
}

/** The repair session's brief: only the failing checks and their evidence; what already passes must not be redone. */
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
 * runChecks({ client, inv, pcs, maxSteps, judge }) -> { results: [{pc, pass, evidence, by}], after, steps }.
 * Code re-reads the apps the checks need (same enumeration code, same mailbox) and evaluates each executable check;
 * judge(items) (the clean-context checker call) decides only the 'judged' ones and the ones code cannot decide.
 */
export async function runChecks({ client, inv, pcs, maxSteps = 3, judge = null, sources = new Map(), node = 'check' }) {
  const apps = appsToRead(pcs, inv);
  const after = await rereadWorld({ client, apps, maxSteps, node });
  const results = pcs.map(pc => ({ pc, ...evaluate(pc, inv, after), by: pc.type === 'judged' ? 'checker' : 'code' }));
  const pending = results.filter(r => r.pass === null);
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

/**
 * Code-owned termination. Repair only when a hard check failed and a repair round still fits: responses for a minimal
 * session plus the next checker call, world steps for the session plus the next re-read, money and time.
 */
export function terminationDecision({ results, responsesUsed, maxResponses, stepsUsed, maxWorldSteps, round, maxRounds, usdLeft, msLeft, minRepairResponses = 4, checkSteps = 3, minRepairUsd = 0.01, minRepairMs = 90_000 }) {
  const hardFail = results.filter(r => r.pc.hard && r.pass === false);
  if (!hardFail.length) return { repair: false, reason: results.some(r => r.pass === false) ? 'only advisory checks fail' : 'all checks pass' };
  if (round >= maxRounds) return { repair: false, reason: 'max repair rounds reached', failing: hardFail.length };
  if (maxResponses - responsesUsed < minRepairResponses + 1) return { repair: false, reason: 'response budget exhausted', failing: hardFail.length };
  if (maxWorldSteps - stepsUsed < 1 + checkSteps) return { repair: false, reason: 'world-step budget exhausted', failing: hardFail.length };
  if (usdLeft < minRepairUsd) return { repair: false, reason: 'money budget exhausted', failing: hardFail.length };
  if (msLeft < minRepairMs) return { repair: false, reason: 'time budget exhausted', failing: hardFail.length };
  return { repair: true, reason: `${hardFail.length} hard check(s) fail`, failing: hardFail.length };
}
