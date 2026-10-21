// requirement-ledger-v2: combine code-check results and judged verdicts into one verdict per candidate.
//
//   accept  no hard check fails (code or judged) and the candidate changed something
//   score   1 - (weighted failures) / (total weight); hard checks weigh 1, soft checks SOFT_W; an "unclear" judged verdict
//           counts UNCLEAR_W of its weight as a failure (the weights were fixed on the design folds before held-out use)
// Generic by construction (PREREG-AB-v1 H7/H8).
export const VERIFY_VERSION = 'rl2-verify-v1';
export const SOFT_W = 0.3;
export const UNCLEAR_W = 0.5;

/** code: [{hard, pass (true|false|null)}]; judged: [{id, hard}]; verdicts: {id -> {verdict}} | null (not judged). */
export function combine({ code, judged = [], verdicts = null, softW = SOFT_W, unclearW = UNCLEAR_W, useJudged = true }) {
  let total = 0, failed = 0, hardFails = 0, softFails = 0, unclear = 0, undecided = 0;
  const failing = [];
  for (const c of code) {
    const w = c.hard ? 1 : softW;
    if (c.pass === null) { undecided++; continue; }
    total += w;
    if (c.pass === false) { failed += w; if (c.hard) hardFails++; else softFails++; failing.push({ key: c.key, hard: c.hard, cat: c.cat, by: 'code', evidence: c.evidence }); }
  }
  if (useJudged && verdicts) for (const j of judged) {
    const w = j.hard ? 1 : softW;
    const v = verdicts[j.id]?.verdict ?? 'unclear';
    total += w;
    if (v === 'not_met') { failed += w; if (j.hard) hardFails++; else softFails++; failing.push({ key: j.id, hard: j.hard, cat: j.cat, by: 'judge', evidence: verdicts[j.id]?.evidence }); }
    else if (v === 'unclear') { failed += unclearW * w; unclear++; }
  }
  const effect = code.find(c => c.key === 'effect_any');
  const accept = hardFails === 0 && effect?.pass !== false;
  return { accept, score: total ? 1 - failed / total : 1, hardFails, softFails, unclear, undecided, failing, judgedUsed: Boolean(useJudged && verdicts) };
}
