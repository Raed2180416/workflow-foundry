# When a run fails, and when a workflow is reused

## Failure handling, in order
1. **Classify** from the journal: input outside the envelope, tool or host refusal, a model output outside its schema,
   a wrong value caught by a gate, a timeout, or an effect with unknown outcome.
2. **Unknown effect:** reconcile first (re-read the world). Never retry blind; a retry of a non-idempotent effect
   is a second effect.
3. **Transient (timeouts, rate limits):** bounded retry with backoff is fine; it fixed none of the recurring
   failures in our heal experiment (0%).
4. **Recurring wrong result:** patch the workflow, then replay the recorded failing cases plus a regression set.
   Accept the patch only if an independent contract check passes all of them and no regression appears.
   Evidence (dev): 75.2% of recurring failing cases removed, 0 regressions, $1.14, versus retry 0% and regeneration
   ~6% (branch `worktree-wf_0f86d12b-ab5-2`). A repair whose own verdict was trusted said pass 8/8 while the oracle
   said 0/8 (`research/heal-20261008/DESIGN.md`): the patcher never grades its patch.
5. **Certify narrowly:** a patch proven on one injected error class is certified for that class only. Say so.
6. Every patch is a new version; runs stay bound to the version they started on.

## Detecting change while running
Outcome monitors are noisy when the in-control disagreement rate is high (25–60% in our streams); a count rule caught
3 of 4 drifts with 8 false alarms in 71 tasks, CUSUM 0 of 4. A frozen profile of the inputs flagged the drift one
task after it with no false alarm, post hoc only (`research/jit-20261008/DEV-NOTES.md`). Prefer input-profile checks
at the envelope boundary; treat outcome monitors as advisory.

## Reuse in another program
Do not trust that "its inputs look like ours". Run the workflow on the new program's own labelled history; accept it
only for input types where it was right; rebuild elsewhere. Evidence (dev): profile gate 85% vs rebuild 98%; history
gate 0 wrong in 98 accepted (branch `worktree-wf_0f86d12b-ab5-3`).
