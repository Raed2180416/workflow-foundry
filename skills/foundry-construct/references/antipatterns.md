# Failure modes seen in our runs (each with its count and source)

| Failure | Seen | Fix |
|---|---|---|
| A self-graded repair reports success | 8/8 "pass" vs oracle 0/8 (`research/heal-20261008/DESIGN.md`) | Independent check gates every patch |
| Frontier agent trips one host rule repeatedly | 17 of 18 and 13 of 13 errors from one refusal (`research/org-20261021/RESULT-OT0.md`) | Validate effects against the host contract before commit (P3) |
| Workflow frozen with known dev misses | 3 of the 6 SOP workflows under 90% on sealed rows had missed dev rows (`research/sopbench-20261021/RESULT-p2.md`) | Freeze only clean, or declare the gap unsupported |
| Effect committed twice after a duplicate or crash | Only composed builds; 1 of 6 collapsed after a crash post-apply (`research/composition-20261021/RESULT-COMP1.md`) | Idempotency keys, reconcile before retry (P10) |
| Keyword routing that fits its author's phrasing | Recall 0.80 on the author's own wording, 0.41 on another model's (branch `worktree-wf_0f86d12b-ab5-1`) | Model-judged routing (P6) |
| Paid model pass where code would do | Model extraction did not beat a regex; rules found 80/83 (MOVE0-CERTIFY.md) | Code first, model for the residue (P5) |
| Outcome monitor raising alarms in steady state | 8 false alarms in 71 tasks (`research/jit-20261008/DEV-NOTES.md`) | Input-profile checks at the envelope |
| A gate that cannot fail | E8 oracle: mutants survived until the mutation ledger forced fixes (`beds/ebed/e8/README.md`) | Mutation-test every gate in practice |
| Coverage counted by hand-written code | Our own exemplar's reconcile counted distinct ids seen, so an invented id hid a unit never read, and double reads were computed but never gated (found 2026-11-04) | `verify` with `method: "ledger"` (`scale.md` step 5) |
| Validator limits discovered late | `map.maxItems` caps at 1,000 (schema) | Nest maps or enlarge shards (`scale.md`) |

Published, for large jobs: premature termination and missing verification (MAST, arXiv 2503.13657); no exit
mechanism in 34% of agent repos (arXiv 2607.01641).
