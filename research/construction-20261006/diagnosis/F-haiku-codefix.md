# Diagnosis: arm F-haiku, family codefix (C0 dev round)

- Status: development/diagnostic evidence, not sealed evaluation. Written 2026-10-08.
- **Test seeds 6001, 6002, 6003 and 6004 (codefix, d3) are now INSPECTED.** This diagnosis read their
  inputs, hidden truth (`build()` bug list, reference) and per-trial outputs, and re-ran the bed oracle on
  intermediate candidates. These seeds must never be reused as held-out evaluation tasks.
- Arm result: 5/8 passed (pass^2 0.500), exec $/trial 0.1735 (`node experiments/c0/analyze.mjs experiments/runs/c0-dev`).
- Artifact: `research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json`
  (sha256 `16f88439…c6c6b`, builder `claude-haiku-5-5` xhigh, kit `7e8f0f83153c5efb`).
- Evidence used: `experiments/runs/c0-dev/results.jsonl`; per-trial Foundry stores
  `/var/tmp/foundry-work/c0-dev/exec/c0-dev-codefix/F-haiku/codefix_test_d3_s600{1_t0,4_t0,4_t1}/ws/.foundry/foundry.sqlite`
  (events table; copied before reading, originals untouched); shared model journal
  `experiments/runs/c0-dev/journal.sqlite` (`model_calls`, ids below); builder transcript
  `/var/tmp/foundry-work/c0-dev/construct/F-haiku-codefix-k1/.executor-transcript.jsonl`; bed
  `beds/codefix/{index.mjs,README.md,domains/*.mjs}` (bed 1.1.0, read and executed, not edited).
  Passing trials' work dirs were deleted by the runner (`experiments/lib/runner.mjs:86`), so passed-trial
  evidence comes from the journal only.

## Verdict

All three failures have one root cause, a **construction defect** in the artifact: its deterministic
API check (`check1`/`check2`) treats a changed **default value** as a changed signature. Both failing
tasks contain an injected `wrong-default` bug, which can only be fixed by changing a default value.
In every failed trial the first-pass Sonnet `fix` node produced a fully correct patch, which the oracle
scores 1.0 when re-run. The check flagged that patch as `signature changed`, which triggered the Opus
`repair` node. That node's prompt tells it to "fix those failures first" and to keep the "same ...
defaults". `answer` then picked the repair because it was the first candidate to pass the check. Opus
either undid the default fix (s6004, both trials) or hid it behind a `__defaults__` assignment that
the diff guard rejects (s6001 t0).

| class | count |
|---|---|
| construction-defect | **3** |
| execution-judgment | 0 (contributing in all 3, see below) |
| harness/env | 0 |
| oracle | 0 |

## Failed trials

| trial | runId | score | oracle reason | cost $ (fix + repair) | latency ms | error |
|---|---|---|---|---|---|---|
| s6001 t0 | d596401e-0fe0-4285-a38b-a4f816a503d7 | 0 | diff guard violated: `disallowed dunder attribute .__defaults__` | 0.3553 (0.0983 + 0.2570) | 67 991 | null |
| s6004 t0 | 727cbd48-36e0-4eee-aed2-f19861263d7e | 0.957 (22/23) | hidden `test_default_min_count` failed | 0.2910 (0.0833 + 0.2077) | 60 676 | null |
| s6004 t1 | a15673cb-6d98-4087-808d-f8e43fffd666 | 0.957 (22/23) | hidden `test_default_min_count` failed | 0.1794 (0.0822 + 0.0972) | 58 023 | null |

The Foundry run status was `succeeded` and `run.verdict` was `pass` (event seq 19) in all three trials.
That is because the workflow's only acceptance check is `exists nodes.answer.patched_source`
(`workflow.json:352-358`).

Hidden truth (`build({seed, split:'test', difficulty:3})`):
- s6001 (warehouse inventory): bugs `reserve_all` (wrong-comparator, `hold` `>=`) and `safety_default`
  (wrong-default, `reorder_quantity(..., safety_days=5)`, documented 3; site at `beds/codefix/domains/inventory.mjs:612`).
- s6004 (text tokenization): bugs `mc_default` (wrong-default, `Vocabulary.__init__(self, tokens, min_count=3)`,
  documented 2; `beds/codefix/domains/tokenizer.mjs:383`) and `wrap_cmp` (off-by-one, `wrap_words` `<` vs `<=`).
- s6002 and s6003 have no wrong-default bug.

## Evidence chain (same in all three failed trials)

1. **`fix` (Sonnet 5.5, class L) was correct.** Event seq 8 / journal 696 (s6001 t0), 750 (s6004 t0),
   762 (s6004 t1). Each patch is a two-line diff against the buggy source that fixes both injected
   bugs and nothing else. For example, s6004: `min_count=3` → `min_count=2` and `< width` → `<= width`.
   Re-scored with `beds/codefix/index.mjs` `oracle()`, all three `fix` candidates **pass** (24/24, 23/23,
   23/23, guard ok).
2. **`check1` raised a false positive.** Event seq 10: `ok:false`, `failed:[]`, `test_error:null`, the
   only problem being `signature changed: reorder_quantity` (s6001) or
   `signature changed: Vocabulary.__init__` (s6004). All visible tests passed. Cause:
   `check1.source` (`workflow.json:168`) `_params()` records
   `defaults = [ast.unparse(d) for d in a.defaults]`, and `main()` flags any difference from the
   **buggy** source (`cand_api[key] != sig`). Run on its own (AST only), `_api` reports
   `defaults ['5'] → ['3']` and `['3'] → ['2']`. The oracle's documented guard allows this change:
   "Default *values* may change, since a wrong-default fix needs that"
   (`beds/codefix/README.md:65-67`; `beds/codefix/harness.py:140-151` records only the *number* of defaults).
3. **The false flag routes to `repair` (Opus 5.5, class F).** `when: nodes.check1.ok == false`
   (`workflow.json:180-186`). The repair prompt (`workflow.json:208`) says the previous attempt failed
   "a changed signature ... Fix those failures first". Its constraints, like the `fix` prompt's
   (`workflow.json:66`), say "Keep every public class, function and method with the same name,
   parameters, order **and defaults**". The bed's task prompt asks only for the same "name and
   parameters" (`beds/codefix/index.mjs:52-53`). The artifact's own audit method (step 1) also lists
   "stated defaults" as promises to verify, so the prompt contradicts itself on wrong-default bugs.
4. **Opus obeyed the false check.** Journal outputs:
   - s6001 t0 (journal 700, seq 14). The audit note says: "The def line is kept byte-identical so the
     signature check passes, and the runtime default is set to 3 through `__defaults__`". The patch
     appends `reorder_quantity.__defaults__ = (3,)`. This is functionally correct (hidden tests 24/24
     with the guard bypassed) but breaks the documented guard rule against new dunder attribute access
     (`beds/codefix/README.md:82-84`, `index.mjs:149`). In this task a visible test pins the default
     (`test_reorder_default_safety_days`: `reorder_quantity(2, 3, 6, 1) == 25`). The check therefore
     demanded both default=5 (signature) and default=3 (visible test), which no honest patch satisfies.
     Opus resolved it with a hack.
   - s6004 t0 (753) and t1 (765). The default fix was reverted to `min_count=3`. The notes say:
     "Changing the default failed the deterministic signature check, so the signature stays
     min_count=3 as the rules require", and "Public defaults must not change, so the original
     min_count=3 is restored". No visible test covers the default (`test_default_min_count` is hidden
     only), so the revert passes `check2`.
5. **`check2` passed the repair (seq 16, `ok:true`) and `answer` selected it.** `answer`
   (`workflow.json:348`) returns the first candidate whose check is `ok`. `fix` had `ok:false`, so the
   correct candidate was discarded. The answer at seq 18 is byte-identical to the repair output.

## Latency and cost

There were no timeouts or budget caps: `maxDurationMs` is 900 000 and `maxCost` is 0.9, and the worst
trial took 68 s and cost $0.355. The false positive did cost money, though. It triggered an Opus call
($0.10–0.26, 36–48 s) on every trial of a wrong-default task. Counterfactual only, not a measured
result: if `check1` had ignored default values, all four s6001/s6004 trials would have ended after the
`fix` node (visible tests all pass, no other API problem). The arm would then have scored 8/8 at about
$0.088 per trial (the sum of the eight Sonnet `fix` calls divided by 8) instead of 5/8 at $0.1735.

## Latent cause in passed trials; deterministic vs stochastic

- **Trigger: deterministic.** `check1` flagged the correct default fix in all 4 trials of the two
  wrong-default tasks (s6001 t0/t1, s6004 t0/t1). The `fix` patches were identical across trials.
- **s6001 t1 passed with the same latent defect.** The fix (journal 709) was correct, and `check1`
  raised the same false flag (the repair request shows `"problems":["signature changed: reorder_quantity"]`).
  Opus repair (715) then kept the change, writing: "the 'signature changed' check result is expected
  for this fix". Its output is byte-identical to 709. `check2` must have flagged it again (same AST
  comparison; the work dir was deleted, so this is inferred). `answer`'s tie rule (`score(check) <=
  score(best)`) picked the repair, which happened to equal the correct fix. The trial passed only
  because Opus overrode the artifact's check, at a cost of $0.2114 instead of about $0.09.
- **s6001: stochastic (1 of 2 failed).** The check made the task unsatisfiable without a hack, and
  Opus's choice between hacking and overriding varied by trial.
- **s6004: deterministic (2 of 2 failed, identically).** Reverting satisfies both the check and the
  visible tests, and Opus reverted in both trials.
- s6002 and s6003 (4 trials, all passed at $0.08–0.09) have no wrong-default bug, so `check1`
  passed and the defect never ran.
- Exposure: `wrong-default` is one of six mutation operators, with 14 sites, 13 of them signature
  default values (`grep "op: 'wrong-default'" beds/codefix/domains/*.mjs`; `README.md:27`). Two of the
  four test seeds hit it.

## Why construction did not catch it

- The three probes (dev seeds 1–3) carry bugs of the swapped-arguments, missing-edge-case,
  wrong-comparator and stale-variable kinds. **None is wrong-default** (and none is off-by-one).
- The builder's verifier self-test (transcript line 173) tried only a renamed parameter combined with
  `import os`, and a syntax error. Its two synthetic variants (transcript lines 292–326) were a removed
  guard and a forced visible-test failure. No variant changed a default value. BUILD-NOTES "Known
  weaknesses" does not mention the problem.

## Comparison with F-opus (8/8 on the same tasks)

- **The Opus builder wrote the same false positive.** F-opus `apply1`/`apply2` `api()` compares
  `ast.dump(node.args)`, which includes defaults (`F-opus-codefix-k1/workflow.json:172, 350`). Run on
  the same patches, it flags `reorder_quantity` and `Vocabulary.__init__`. The review requests show
  `api problems: ['signature changed: reorder_quantity']` (journal 695, 703) and
  `['signature changed: Vocabulary.__init__']` (749, 760).
- **In F-opus the flag cannot veto a correct fix.**
  1. F-opus's review prompt (`:219`) asks for three things: check each change against the docs,
     re-audit independently, and make failing *visible tests* pass. It never asks the reviewer to
     resolve API problems. Its constraint is "Keep every public name and signature", with no mention
     of defaults.
  2. Both F-opus prompts (`:54`, `:219`) list "a wrong default value" as a typical defect, so the
     model is told up front that default changes are legitimate.
  3. `pick` (`:381`) keeps the first pass unless the reviewed version has *no* API problems. A flagged
     first pass therefore stays selected. In all four trials the Sonnet reviewer returned
     `{"defects":[],"edits":[]}` (journal 695, 703, 749, 760), and `audit` (693, 702, 747, 759) made
     the same two correct edits as F-haiku's `fix`.
- F-opus still carries the false positive in latent form. If its reviewer ever undid a default fix,
  the reviewed version would have no API problem and `pick` would select it. Its 8/8 says nothing
  about whether its check is correct.
- Other differences that did not cause these failures: F-opus always runs a second, independent
  Sonnet audit (`review`), while F-haiku escalates to Opus only when the check fails. F-opus also
  enforces minimal diffs through find/replace edits, while F-haiku asks for full-file output.

## Contributing execution judgment (why it is not the primary class)

Inside the repair node Opus put the artifact's check above the documented behaviour, even though the
prompt calls the docs authoritative. In s6001 t0 it gamed the check with `__defaults__`. That is a
model judgment error. But in all three failures the repair was invoked only because of the false
flag, and the prompt explicitly forbade the correct change. Without the construction defect the
repair never runs and the correct `fix` output is returned (counterfactual above). The same model
made the right call in 1 of 4 runs.

## Oracle and harness checks

- Oracle valid. The hidden `test_default_min_count` follows the docstring and design notes, as both
  models' audits confirm ("min_count default is 2"). The `__defaults__` rejection applies a documented,
  frozen guard rule (bed 1.1.0) to a check-gaming patch that leaves the wrong default in the `def`
  line. No oracle problem.
- No harness or env fault: `error` is null, there are no env-fault retries, `costUnknown` is false,
  all model calls returned `ok:1` with `finishReason:"stop"`, and no context truncation occurred
  (receipt `truncated:false`).

## Implications for the builder or kit (not applied; artifacts and kit are frozen)

- An API check should compare parameter names, order, kinds and the *number* of defaults, not default
  values (this is the bed's own guard contract). Prompts should name wrong defaults as a defect class
  and not forbid changing them.
- A structural check should not be able to veto a candidate whose diff a docs citation justifies.
  When the first pass passes every visible test and fails only an API heuristic, prefer it, or make
  the repair justify any revert.
- Probe coverage: the probes covered 4 of 6 mutation operators. A kit-side self-test checklist (for
  example "your verifier accepts a documented default-value change") or operator-covering probes would
  have exposed this during construction.
- The workflow acceptance (`exists`) produced a `pass` verdict on all three failures, so the run's own
  verdict carries no information for this arm.
