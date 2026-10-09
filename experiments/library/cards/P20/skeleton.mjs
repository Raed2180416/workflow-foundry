// P20 generate -> verify -> retry (bounded) — L1-PATTERNS §4. Fragment (flow, task, x, S) -> {result, tries} | {result: null, review}.
// Slots: GEN (judge over {input, problem}), VERIFY (fn (out, input) -> null | problem string; prefer code), MAX_TRIES
// (int[1,4]), FEEDBACK (bool: the last problem is passed back as data, never as instructions), ON_FAIL ('deopt' | 'review').
// The verifier gates: an unverified result is never returned as a result.
export default async function P20(flow, task, x, S) {
  let out = null, problem = 'not-run', tries = 0;
  for (let i = 0; i < S.MAX_TRIES && problem; i++) {   // cap: MAX_TRIES, int[1,4]
    tries++;
    out = await flow.judge(`gen#${i}`, judgeSpec(S.GEN, { input: x, problem: S.FEEDBACK && i ? problem : null }));
    problem = S.VERIFY(out, x);
    if (problem) flow.note('verify-failed', { i, problem });
  }
  flow.guard('verified', !problem || S.ON_FAIL === 'review', { problem, tries });
  return problem ? { result: null, review: { problem, tries } } : { result: out, tries };
}
