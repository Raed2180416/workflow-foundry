# Diagnosis: arm B1-opus, family codefix (C0 dev round)

- Status: development/diagnostic evidence, not sealed evaluation. Written 2026-10-08.
- **Test seeds 6001, 6002, 6003 and 6004 (codefix, `test` split, d3) are now INSPECTED.** This diagnosis
  read their inputs, their hidden truth (`build()` bug list, reference, hidden suite) and every per-trial
  output. It also re-ran the bed oracle on intermediate candidates and replayed all eight trials. These
  seeds must never be reused as held-out evaluation tasks. PREREG-dev.md:17 lists them as "never
  inspected", which is no longer true.
- Arm result: 4/8 passed (pass^2 0.500), exec $/trial 0.3684, CPS exec 0.7367
  (`node experiments/c0/analyze.mjs experiments/runs/c0-dev`).
- Artifact: `research/construction-20261006/artifacts/B1-opus-codefix-k1/solve.mjs`
  (sha256 `1ba24799…02be`; builder `claude-opus-5-5` xhigh; kit `6bc6b06eccf45cae`). The copy in each
  failed trial's work dir has the same hash.
- Evidence used:
  - `experiments/runs/c0-dev/results.jsonl`.
  - Per-trial work dirs `/var/tmp/foundry-work/c0-dev/exec/c0-dev-codefix/B1-opus/codefix_test_d3_s600{1,4}_t{0,1}/`,
    specifically `task.json`, `.solve.stderr`, `.solve.stdout` and `tools/calls.jsonl`. Passed trials'
    work dirs were deleted by the runner, so their evidence is the journal plus `stderrTail`.
  - The shared model journal `experiments/runs/c0-dev/journal.sqlite` (`model_calls`; ids below). It
    was copied before reading, and the original was not touched.
  - The builder transcript `/var/tmp/foundry-work/c0-dev/construct/B1-opus-codefix-k1/.executor-transcript.jsonl`.
  - Bed `beds/codefix/` (1.1.0), read and executed but not edited.
  - Kit `/opt/foundry-kit/6bc6b06eccf45cae/skills/script-harness/`.

## Verdict

All four failures have the same deterministic cause, a **construction defect** in `solve.mjs` made of two
parts that compound:

1. **The API check rejects any change to a default value** (`solve.mjs:114`, `:136`). `sig()` appends
   `ast.dump(d) for d in a.defaults` (and the kw-only defaults), so `safety_days=5 → 3` or
   `min_count=3 → 2` is reported as `signature/defaults changed`. The bed's guard allows this
   explicitly: "Default *values* may change, since a wrong-default fix needs that"
   (`beds/codefix/README.md:65-67`). Its `sig()` records only the *number* of defaults
   (`beds/codefix/harness.py:140-150`). The task prompt asks only for the "same name and parameters"
   (`beds/codefix/index.mjs:53`). Both failing tasks contain a `wrong-default` bug in a signature.
2. **When no candidate passes, the fallback returns the unpatched module** (`solve.mjs:337-341`,
   `:418-419`). `best` starts as `{src: original, score: -1}`, and the original is never scored. A
   candidate replaces it only if `(ok?1000:0) − 10·failedTests − 50·apiProblems − 5·witnessProblems > −1`.
   One API flag scores ≤ −50, so every flagged candidate loses to the original, even one that passes
   every visible test and every witness. In s6001 the script emitted a module it had itself measured
   as failing a visible test (`baseline: FAILED test_reorder_default_safety_days`, `.solve.stderr`
   line 1). This goes against the kit rule "always print the best complete answer"
   (`script-harness/SKILL.md:58`).

The model did not err. In all 8 failed-trial find calls (two per trial), Opus returned a correct
two-edit patch, and each of those patches scores **1.0** on the bed oracle. In all 16 repair calls,
Opus kept the documented default, often stating outright that the check was wrong. The artifact gives
it no way to contest a check, and it threw the correct patch away.

| class | count |
|---|---|
| construction-defect | **4** |
| execution-judgment | 0 |
| harness/env | 0 |
| oracle | 0 |

## Failed trials

| trial | result `at` | score | oracle reason (hidden failures) | cost $ | latency ms | calls | error |
|---|---|---|---|---|---|---|---|
| s6001 t0 | 07:14:07Z | 0.667 (16/24) | `test_reserve_everything_available`, `test_reorder_default_safety_days`, `test_reorder_values_{3,6,9,12}`, `test_reorder_plan_matches_reorder_quantity`, `test_low_stock_explicit_zero_threshold` | 0.5533 | 125 619 | 6 | null |
| s6001 t1 | 07:15:45Z | 0.667 (16/24) | same 8 | 0.5942 | 141 551 | 6 | null |
| s6004 t0 | 07:26:36Z | 0.870 (20/23) | `test_default_min_count`, `test_wrap_exact_width`, `test_detokenize_values_6` | 0.5388 | 136 760 | 6 | null |
| s6004 t1 | 07:30:03Z | 0.870 (20/23) | same 3 | 0.4355 | 129 411 | 6 | null |

- Guard `ok:true` in all four. `meta.errors {}`, `refusals {}`, `unknownCalls 0`, `overshootUsd 0`.
- In every case `.solve.stdout`'s `patched_source` is **byte-identical to the buggy input**
  (`task.inputs.source`). Each oracle score is exactly the buggy module's score: re-running `oracle()`
  on the original gives 16/24 and 20/23 with the same failing tests.
- stderr ends with `[solve] final: no candidate; returning original` in all four.

Hidden truth (`build({seed, split:'test', difficulty:3})`):
- s6001 (`depot_stock.py`): `reserve_all` (wrong-comparator in `Storeroom.hold`, `>=` instead of `>`)
  and `safety_default` (wrong-default, `reorder_quantity(..., safety_days=5)`, documented 3;
  `beds/codefix/domains/inventory.mjs:612`). A visible test covers `safety_default`
  (`coveredBugs = ["safety_default"]`).
- s6004 (`lexis_tools.py`): `mc_default` (wrong-default, `Vocabulary.__init__(self, tokens, min_count=3)`,
  documented 2; `beds/codefix/domains/tokenizer.mjs:383`) and `wrap_cmp` (off-by-one in `wrap_words`,
  `<` instead of `<=`). No visible test covers either bug.
- s6002 (`join_end`, `wrap_cmp`) and s6003 (`pack_round`, `receive_zero`) have no wrong-default bug.

## Evidence chain (identical in all four failed trials)

Journal ids, in call order, for run_id `B1-opus:codefix:test:d3:<seed>:<trial>:…`:

| trial | find (medium) | repair 1 | repair 2 | find (high) | repair 1 | repair 2 |
|---|---|---|---|---|---|---|
| s6001 t0 (`d209d2b0…`) | 694 | 699 | 701 | 704 | 706 | 707 |
| s6001 t1 (`aae0ccad…`) | 705 | 708 | 710 | 711 | 714 | 716 |
| s6004 t0 (`2db4f001…`) | 748 | 751 | 752 | 754 | 757 | 758 |
| s6004 t1 (`8e2edf6b…`) | 761 | 763 | 764 | 766 | 767 | 768 |

1. **The find call was correct every time** (`solve.mjs:351`).
   - In all 8 find calls (694, 704, 705, 711, 748, 754, 761, 766), Opus returned exactly the two
     injected bugs, each with a verbatim edit and a witness:
     - s6001: `if qty >= line.available:` → `if qty > line.available:`, and `safety_days=5` → `safety_days=3`.
     - s6004: `min_count=3` → `min_count=2`, and `< width` → `<= width`.
   - The edits applied cleanly. No witness passed on the original: there is no `note: witness … already
     passes` line (`:355`).
   - Re-evaluated with the artifact's own checker (extracted verbatim from `solve.mjs:35-139`), every
     candidate passes **all 6 visible tests**. Its only problem is one API flag.
   - Re-scored with `beds/codefix/index.mjs` `oracle()`, every one of the 8 candidates **passes (1.0)**:
     24/24 for s6001 and 23/23 for s6004, guard ok.
2. **`evaluate()` failed the candidate on the API flag alone.** `ok = api.ok && …` (`:179`). The
   repair prompt's PROBLEMS section reads only `API/IMPORT PROBLEMS: signature/defaults changed:
   reorder_quantity` (s6001) or `…: Vocabulary.__init__` (s6004). There were no failed tests and no
   witness problems.
3. **Repairs could not clear the flag, and Opus correctly refused to revert.**
   - The repair prompt (`:297-311`) says only "Fix the problems above". The SYSTEM prompt says "keep
     every public name, parameter **and default**" (`:257`), while FIND_INSTR lists "wrong default
     values" as a typical defect (`:286`), so the artifact contradicts itself.
   - In all 16 repair calls Opus kept the documented default. It returned either an empty list (706,
     751, 757, 758, 763, 764, 767, 768) or no-op restatements with `old === new` (699, 701, 708, 710,
     714, 716, 752). `applyEdits` silently skips no-op edits (`:216`), so the candidate never changed.
   - Some of the model's explanations:
     - 701: "The candidate's default of 3 is required by the docs and the visible test …, even though
       this changes the literal default value."
     - 714: "intentionally kept despite the signature checker, because the docs are authoritative."
     - 752: "reverting to 3 to satisfy the signature check would contradict the authoritative docs."
   - The one exception is 707 (s6001 t0, last call). Opus tried a sentinel, `safety_days=None` with
     `if safety_days is None: safety_days = 3`. The flag remains (None ≠ 5), but the module is still
     correct: oracle 1.0, guard ok.
4. **Escalation re-ran the same failure.** The ladder's second step (`:343-346`) runs find again at
   `high` reasoning from the original. It produced the same patch, and the same deterministic check
   flagged it. The 6-call cap (`:327`) was then used up.
5. **The fallback emitted the original.** `passed` was never set (`:376`). Every candidate scored
   ≤ −50 < −1 in `consider` (`:338-341`), so `best.ev` stayed undefined. The script printed
   `no candidate; returning original` and emitted the buggy input (`:418-419`).

**Replay check.** Each trial was replayed through the unmodified `solve.mjs`. A mock
`tools/model.mjs` returned the journal's recorded values in order and compared each incoming prompt
with the recorded one. All 8 trials reproduced exactly:
- every prompt matched byte for byte (6 calls in each failed trial, 2 in each passed trial);
- the four failed trials emitted output byte-identical to the recorded `.solve.stdout`, with oracle
  scores 0.667 and 0.870;
- the four passed trials scored 1.0.

Given the model outputs, the code path is fully deterministic.

## Is the cause latent in the passed trials? Deterministic or stochastic?

- **Deterministic.** Both trials of both wrong-default tasks failed the same way: same check message,
  same `returning original`, same oracle failures.
- **Structurally certain.** On a task with a signature wrong-default bug the artifact cannot pass, no
  matter what the model returns:
  - An honest fix changes the default literal, which sets `apiProblems ≥ 1`. The candidate is then
    never accepted (`:376`) and never beats the original in the fallback (score ≤ −50).
  - The only ways to clear the flag also fail the oracle. Reverting the default fails the hidden
    default test. A `__defaults__` hack violates the guard.
- **Latent in the passed trials, but never triggered.**
  - s6002 and s6003 contain no wrong-default bug. Both trials of each passed with 2 calls (find +
    audit; journal 717/719, 724/726, 736/737, 743/744) and logged `API unchanged`.
  - The same two defects are present in those runs. An audit-found default fix would also be rejected,
    because audit acceptance requires `ev.ok` (`:408`).
  - Any other check failure that repairs cannot clear (for example a test needing a shim feature)
    would also hit the fallback and return zero fixes.
- **Exposure.** `wrong-default` is one of the bed's mutation operators (`README.md:27`: 14 sites). 13 of
  those sites are signature default values: billing ×3, inventory ×2, ratelimit, routing ×3,
  scheduling, tokenizer ×3. The one body-level site is tokenizer `unk_id`. This was checked by
  grepping each site's `m('<id>'…)` line in `beds/codefix/domains/*.mjs`. Two of the four test seeds
  hit it.

## Cost and latency

- No cap was reached. B1 caps are a $1 gateway cap and 20 minutes (PREREG-dev.md:38, :96). The worst
  trial cost $0.594 and took 142 s. All 32 of the arm's gateway calls (24 of them in failed trials) returned
  200 ok.
- The defect still made failures expensive:
  - Failed trials used the whole 6-call cap: mean $0.530 and 133 s, against $0.206 and 37 s for passed
    trials.
  - Failed trials account for $2.12 of the arm's $2.95 execution spend.
  - About $1.84 of that came after the first, correct find call.
  - Every call is Opus. The kit says to start at the cheapest plausible model
    (`SKILL.md` step 4), but that did not cause these failures.
- **Counterfactual (not a measured result).** I replayed the same journal through a copy of `solve.mjs`
  with one change: `sig()` records `len(a.defaults)` and kw-default presence instead of the default
  values, which is what the bed guard does.
  - All four failed trials then accept the first find candidate and go straight to the audit call.
  - The audit was never recorded for these trials, so the mock returned an empty list. In all four
    passed trials the real audit returned 0 defects.
  - With that change all 8 trials pass at oracle 1.0.
  - Estimated arm cost is about $0.20 per trial: find ($0.03–0.12) plus about $0.13 for the audit.

## Why construction did not catch it

- **The probes contain no default bugs.** The probes (dev seeds 1–3) have bugs of the swapped-arguments,
  missing-edge-case, wrong-comparator and stale-variable kinds, with **no wrong-default**.
- **The synthetic test did not either.** The builder's synthetic "harder task" (transcript line 234)
  injected a comparator change (`qty <= 0` → `qty < 0`) and a wrong-variable change into probe-1.
  Neither touches a default.
- **The repair and fallback paths never ran during construction.** Every `[solve] final:` line in the
  transcript (16 of them) reads `all 6 visible tests pass; API unchanged`. No `repair round` output
  appears.
- **The check was in the first draft.** The default-sensitive `apicheck.py` was present in the first
  draft of the script (transcript line 92). BUILD-NOTES "Known weaknesses" mentions neither
  `apicheck.py` nor the fallback.

## Comparison with the other codefix artifacts on the same tasks

On the two wrong-default tasks (4 trials per arm):

| arm (builder) | signature check | what a flagged correct fix leads to | wrong-default trials passed | arm total |
|---|---|---|---|---|
| B1-haiku (Haiku) | parameter **names** only (`B1-haiku…/solve.mjs:156-164`, `:188-192`) | never flagged; 2 calls per trial (journal 697/698, 712/713, 745/746, 755/756) | 4/4 | 8/8 |
| F-opus (Opus) | `ast.dump(node.args)`, which includes defaults (`F-opus…/workflow.json`) | flag raised, but the review prompt never asks the model to resolve API problems, so the fix survives (see `F-haiku-codefix.md`) | 4/4 | 8/8 |
| F-haiku (Haiku) | defaults included (`check1`/`check2`) | Opus repair obeys the check: it reverts the default or adds a `__defaults__` hack (`F-haiku-codefix.md`) | 1/4 | 5/8 |
| **B1-opus (Opus)** | defaults included (`solve.mjs:114`) | hard gate, then the fallback returns the **original** | **0/4** | 4/8 |

Here the Haiku builder did better than the Opus builder in two ways:

1. **Its check matches the oracle's contract.** It compares parameter names and order, not defaults.
2. **Its fallback cannot regress below the patch.** `best` starts with the patched candidate and keeps
   the one with the fewest problems (`:314`, `:321`). It prints the original only on a fatal error
   (`:337-340`).

The Opus artifact is more elaborate: witnesses, a two-step ladder and a witness-gated audit. But its
gates are strict enough that one false positive vetoes a fully verified patch. It also ignores the
positive evidence it collects itself: both witnesses fail on the original and pass on the candidate.
Three of the four codefix builders wrote a default-sensitive signature check (F-haiku, F-opus,
B1-opus). The consequence depended entirely on how much authority the check had.

## Fixes (for builder guidance or kit, not applied: the artifact is frozen)

1. Signature checks should compare names, order, kinds and the *number* of defaults, not default values.
   More generally, a builder-written check must not be stricter than the task's stated contract (here:
   "same name and parameters").
2. The fallback must score the original with the same function as every candidate, and it must count
   positive evidence (witnesses that fail before and pass after). It must never emit the original
   when a candidate is strictly better on every measured axis except a disputed check.
3. Give repairs a typed way to contest a check (for example `{contest: {check, reason}}`) and settle
   that in code. Detect all-no-op repairs (`old === new`) and stop early instead of spending the
   remaining calls.
4. Remove "and default" from the SYSTEM rule (`:257`), which contradicts FIND_INSTR (`:286`).
5. Kit (generic, not bed-specific): before delivering, exercise every verify, repair and fallback
   branch once on a synthetic failure, including a check you expect to give a false positive.
