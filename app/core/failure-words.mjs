// What a failure means to a person, in the site's and the service's words. app/core/explain.mjs words the engine's codes and is frozen by
// the BUILDER-1 manifest (experiments/surface/manifest.mjs, research/surface-20261021/eval/MANIFEST-fix.json), so the wording the
// onboarding work changed lives here instead, over it (fix round 2026-10-21, review:honesty new defect 7: the fix rounds had edited the
// frozen file, which the same reasoning had been used to keep stand-ins.mjs unchanged). Everything else is explain.mjs's own.
//
//   VERIFY_FAILED     "written to send", not "delivered" (honesty review minor 16: Foundry writes a draft; it cannot see delivery)
//   SHEET_NOT_FOUND   plain words, and where to give the list again (walkthroughs P2 M16, P5 minor 11)
//   PRACTICE_ONLY     never nudges someone to switch a pilot's control off (walkthrough P4 M8)
//   TURNED_OFF, DRAFT_REMOVED, NOT_ON   the service's own codes (UX review M7)
import * as frozen from './explain.mjs';

export const FAILURE_WORDS = Object.freeze({
  VERIFY_FAILED: ['The final check failed: what was written to send is not exactly what was saved.', 'Open the run and compare the two. Do not resend until you know why.'],
  SHEET_NOT_FOUND: ['Foundry couldn\'t find the list this automation reads.', 'Nothing was made. Give it the list again on the automation\'s page (developers: a JSON list of rows in the workspace world/sheets folder).'],
  PRACTICE_ONLY: ['Practice-only mode is on, so nothing runs for real here.', 'Foundry can still show what a run would make on your list, without making it. Ask whoever set up the pilot before turning it off.'],
  TURNED_OFF: ['This automation is turned off, so it does not run.', 'Turn it on again on its page in Foundry if you want it to run.'],
  DRAFT_REMOVED: ['This draft was removed, so it cannot be turned on.', 'Make the automation again from its card if you want it.'],
  NOT_ON: ['This automation is not on.', 'Nothing needed turning off.']
});

/** { code, what, next } for an error (or its data), in these words where they differ from explain.mjs's. */
export function failureText(error) {
  if (!error) return null;
  const own = FAILURE_WORDS[error.code];
  return own ? { code: error.code, what: own[0], next: own[1] } : frozen.failureText(error);
}
/** A problem that explain.mjs already worded ({ code, what, next }), reworded where these words differ. */
export const reword = problem => (problem?.code && FAILURE_WORDS[problem.code] ? failureText(problem) : problem ?? null);
/** explain.mjs's explainRun, with the problem in these words. */
export function explainRun(run, workflow, events = []) {
  const out = frozen.explainRun(run, workflow, events);
  return { ...out, problem: failureText(run.error) };
}
export const { describeWorkflow, checkText, checkResults } = frozen;
