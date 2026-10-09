// prompts-verdicts.mjs (S0-6, opt-in): builder prompt text for acceptanceIds 'structured' (acceptance.mjs). Kept out of
// prompts.mjs, whose prompt versions are pinned by arm-hash tests; nothing imports this yet. To use it, append
// VERDICTS_PROMPT_TEXT to the builder prompt only when compile.acceptanceIds is 'structured', and record
// VERDICTS_PROMPT_VERSION in the compile record, so default prompts and their hashes stay unchanged.
export const VERDICTS_PROMPT_VERSION = 'verdicts-1';

export const VERDICTS_PROMPT_TEXT = `
Per-case verdicts (required). Besides BUILD-NOTES.md, write verdicts.json in the working directory: a JSON array with one
entry for every case that tools/check-traces.mjs reports as a diff (a trace or regression case whose output differs from
the expected answer):
  [{"case": "trace-3", "verdict": "disagree", "reason": "..."}]
- "case" is the case id exactly as check-traces prints it (trace-<n> or case-<n>), one entry per case; no ranges.
- "verdict" is your judgement of the expected (agent) answer for that case:
  - "disagree": the agent answer is wrong and your solver is right to differ. Only this verdict explains a difference.
  - "agree": the agent answer is right, so the difference is a defect in your solver. Fix it if you can.
  - "unsure": you cannot tell.
- "reason" says why, and quotes in double quotes a passage of at least three words copied verbatim from THAT case's own
  task (its prompt, a string in its inputs, or a task file) that decides the case.
Acceptance reads verdicts.json, not the prose, when the file exists.
`;
