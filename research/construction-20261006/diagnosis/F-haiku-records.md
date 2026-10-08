# Diagnosis: arm F-haiku, family records (C0 dev round)

- Status: development/diagnostic evidence, not sealed evaluation. Written 2026-10-08.
- **Test seeds 6001, 6002, 6003 and 6004 (records, d3) are now INSPECTED.** This diagnosis read their
  inputs (source notes), hidden truth (`buildWorld()` conventions and records), the bad controls, and
  per-trial outputs. It also re-ran the artifact's `merge` code and the bed oracle on recorded model outputs.
  These seeds must never be reused as held-out evaluation tasks.
- Arm result: 6/8 passed (pass^2 0.750), exec $/trial 0.0390 (`node experiments/c0/analyze.mjs experiments/runs/c0-dev`).
- Artifact: `research/construction-20261006/artifacts/F-haiku-records-k1/workflow.json`
  (sha256 `eaa901a4…784a9`, equal to `artifactSha256` in its `construction.json`). Builder `claude-haiku-5-5`
  at xhigh, kit `7e8f0f83153c5efb`. Sources are in `/var/tmp/foundry-work/c0-dev/construct/F-haiku-records-k1/solver/`.
- Evidence used:
  - `experiments/runs/c0-dev/results.jsonl`.
  - Per-trial Foundry stores `/var/tmp/foundry-work/c0-dev/exec/c0-dev-records/F-haiku/records_test_d3_s6001_t{0,1}/ws/.foundry/foundry.sqlite`
    (`events`, `runs`, `decisions`; copied before reading, originals untouched).
  - The shared model journal `experiments/runs/c0-dev/journal.sqlite` (`model_calls`, ids below).
  - The builder transcript `/var/tmp/foundry-work/c0-dev/construct/F-haiku-records-k1/.executor-transcript.jsonl`.
  - The bed `beds/records/{index.mjs,world.mjs,README.md,AUDIT.md}` (v3.0.0; read and executed, not edited).
  - Retention limits: the runner deletes passing trials' work dirs (`experiments/lib/runner.mjs:86`), so evidence
    for passing trials comes from the journal only. F trials write no stdout/stderr files; the work dir holds only `ws/.foundry`.

## Verdict

Both failures are the same trial outcome, from one cause. The artifact's single **`conf`** agent node
(Haiku, class M, `reasoning: low`) read **BRIGHTDESK's numeric birth-date order as MDY**. The task's notes
make it **DMY**: they say so only by example, and the system header says "US sales CRM". The
deterministic `merge` code parses every numeric BRIGHTDESK date with that order. This swapped day and
month on all 11 numeric BRIGHTDESK birth dates. As a result, 5 BRIGHTDESK fragments split off from their
people and one row joined a planted namesake. The output is identical to the bed's pre-registered bad
control `brightdesk-order-flipped`.

The model error happens at run time, but this is classed as a **construction defect**, for these reasons:
- The artifact routes the one decisive per-task reading to the cheapest model at low reasoning.
- That reading has no evidence field, no worked-example rule, no check and no live escalation path.
- The builder's own notes name it as a single point of failure.
- Two other constructions solved this task 2/2 with different construction choices. One is the
  Opus-built F artifact. The other was built by the same Haiku builder in the B1 arm.

| class | count |
|---|---|
| construction-defect | **2** (mechanism: run-time judgment error by Haiku in `root/conf`) |
| execution-judgment | 0 (contributing in both, see "Classification") |
| harness/env | 0 |
| oracle | 0 |

## Failed trials

| trial | runId | score | oracle details | cost $ | latency ms | calls | error |
|---|---|---|---|---|---|---|---|
| s6001 t0 | 2fb12d69-12dd-4413-9b6a-36167a36bbe2 | 0.789197 | 37 entities, 42 predicted, extra 5, missing 0; pairF1 0.881 (P 0.981, R 0.800); fieldAccuracy 0.946 (thresholds 0.95 / 0.97) | 0.0293 | 56 864 | 7 Haiku, 0 escalations | null |
| s6001 t1 | 57218389-6ceb-4657-b301-20d4caa0345a | 0.789197 | identical to t0 (same 12 mismatches) | 0.0298 | 58 485 | 7 Haiku, 0 escalations | null |

Mismatches, the same in both trials:
- `entity_id`: 2843→3359, 3171→4852, 3837→4953, 9317→1390, 1390→2256.
- `birth_date` day and month swapped: 3171 (2000-09-12 → 2000-12-09), 3837 (1977-09-05 → 1977-05-09), 3042 (1951-08-09 → 1951-09-08).
- 3837 took its country, phone and amount from the wrong fragment (JP → US, `+819086761580` → `+18425550154`,
  -168.16 → 23761.68).
- 3171 amount 163.48 → 73.32.

Both runs had status `succeeded`. The Foundry `run.verdict` was **`pass`** ("Run succeeded and its acceptance
checks held", event seq 53 in both stores; decision `…:verdict:52`) and the `verify` node returned
`pass: true, score: 1` (seq 50). Both are false passes. The only acceptance check is
`exists nodes.answer.records` (`workflow.json:417-422`). `verify` checks only structure and has `gate: false`
(`workflow.json:383-398`).

## Evidence chain

1. **Truth.** `buildWorld(6001,'test',3).ctx.conv` gives `bd: 'dmy'`, `atlas: 'dmy'`, `vendex: 'mdy'`;
   perspective BRIGHTDESK recv, ATLAS pay, LEDGR pay, KOBO recv; mirror BRIGHTDESK; flags ATLAS `DORMANT` void,
   VERITAS `backfill` live. The BRIGHTDESK paragraph of the notes states the order only by example:
   *"A customer with dob=06/01/1999 was born in January."* The opening line calls the system "BRIGHTDESK (US sales CRM)".
2. **`root/conf` misread it, in both trials.** Event seq 8 (node.completed). Journal call **432** (t0) and
   **472** (t1) are separate live calls: different replay keys and 1053 vs 934 output tokens, so neither is a cache
   replay. Both return `BRIGHTDESK numeric_order: "MDY"`. Every other value is correct: ATLAS DMY, VENDEX MDY,
   LEDGR DMY, sign flips BRIGHTDESK +1, LEDGR -1, ATLAS -1, KOBO +1.
3. **Code applied the wrong order to every numeric BRIGHTDESK date.** `merge` takes the order from `conf`
   (`solver/merge.js:163`) and parses numeric dates with it (`solver/merge.js:116-135`, used at `:185`). The
   extractor's own `birth_date` reading is only a fallback. `merge.debug.date_orders` records `BRIGHTDESK: "MDY"` (seq 48).
4. **Wrong dates broke identity linking.** Rule 3a links two rows only if their birth dates are equal
   (`solver/merge.js:206-208`). Compared with the corrected run, the failed output shows:
   - **Five splits.** BRIGHTDESK fragments 8866, 2843, 4852+7503, 4953+9024 and 7312 each stand apart from a
     same-name record whose birth date is their day/month swap.
   - **One wrong join.** 1390 (`01/04/1990`, read as 1990-01-04) joined the planted namesake 9317
     (ATLAS, Lucas Ibáñez, 1990-01-04, MX). That left its own VERITAS row 2256 (1990-04-01) alone.
   - The result is 42 records instead of 37 (extra 5), with the wrong winners and entity ids listed above.
5. **Counterfactual replay (decisive).** The recorded `split`, `extract` and `conf` outputs were fed to the
   artifact's own `merge` source. With the original `conf` this reproduces the recorded `merge` and `answer`
   records exactly (canonical JSON equality, both trials), and the oracle returns 0.789197. Changing only
   `BRIGHTDESK → DMY` gives **score 1.0, pass** (37/37 matched, pairF1 1, fieldAccuracy 1) in both trials.
   Nothing else in the run is wrong: extraction, void markers, flips, mirror and FX are all correct.
6. **Oracle cross-check.** The bed's bad control `brightdesk-order-flipped` on s6001 scores exactly 0.789197,
   with the same 12 mismatches, extra 5 and pairF1 0.8814. The oracle behaves as designed; this is not an
   oracle problem. No error, timeout or budget cap was hit: about $0.03 of maxCost $0.6, about 57 s of 900 s,
   0 escalations. This is not harness/env.

## Why nothing caught it

- **The `conf` node has no checks** (`workflow.json:33-118`; `solver/build.mjs:71-109`). It is configured
  `model {class: M, maxClass: L}` and `escalation {onCheckFail: "escalate", maxEscalations: 1}`. Escalation
  fires only on schema failure or a failed check, so without checks the `maxClass: L` path is dead.
  It runs at `reasoning: "low"` (1024 thinking tokens) with no evidence or quote field.
- **The prompt has no rule for worked examples.** It defines the codes ("08/09/1988 is August 9") and mentions
  "copies another system's order" and "configured for another locale" (`solver/build.mjs:77-78`). It says
  nothing about notes that state the order by example ("dob=X was born in <month>").
- **The second reading fails the same way, so cross-checking would not help.** The `extract` node also has the
  notes in context and asks for a per-row `birth_date` reading "under that system's date convention". It read
  all **11/11** numeric BRIGHTDESK dates as MDY in both trials (journal 443/445/444/446/453/448 and 473–478).
  Two different Haiku prompts made the same error.
- **Verification is structural only.** `verify` checks shapes and ids with `gate: false`, and acceptance checks
  only `exists`. The workflow therefore reports `pass` on a wrong answer.
- **The probes could not reveal the gap.** All three probe tasks (dev 1–3) have BRIGHTDESK = MDY, and
  their by-example sentences ("dob=08/09/1988 was born in August", "dob=04/01/1975 was born in April") agree
  with the "US CRM" prior. A model that ignores the example still scores 1.0 on them. The builder saw that
  ATLAS and VENDEX orders vary across probes (transcript #66) but never saw BRIGHTDESK vary. Its BUILD-NOTES
  say: "The conf call is a single point of failure: a misread date order or flip changes a whole system.
  Only three tasks were tested." It shipped without a mitigation.

## Deterministic or stochastic

Deterministic in what was observed: 2 of 2 independent live `conf` calls returned the same wrong value, and
`merge` is pure. Replaying all 8 F-haiku trials from journal outputs reproduces every recorded score exactly.
At the model level the error is stochastic and looks biased, but the sample is one note on one task: Haiku read
it wrong in 3 of 4 observed readings. B0-haiku (Haiku solving directly, xhigh) made the same BRIGHTDESK misread on
s6001 t1: its oracle shows the same entity_id and birth_date mismatch signature (score 0.756). It read the date
correctly on t0. Inference, not measured: Haiku's prior for "US sales CRM" outweighs the by-example statement.

## Latent in the passed trials?

Yes, the same weak point is present in all six passed trials. They passed because their paraphrases are ones
Haiku reads correctly, or that agree with its prior:

| seed | truth (BD / ATLAS / VENDEX) | BRIGHTDESK paraphrase | `conf` (journal id, per trial) |
|---|---|---|---|
| 6002 | DMY / MDY / MDY | explicit: "does not keep its vendor's American defaults: the day comes before the month" | correct (496, 525) |
| 6003 | MDY / DMY / DMY | example agreeing with the US prior ("08/05/1976 … born in August") | correct (545, 579) |
| 6004 | MDY / DMY / MDY | negation: "does not use the British order" | correct (633, 664) |

All flips were correct in all 8 trials. Passing on an MDY task does not show that the model read the note,
because the prior gives the same answer. The exposure is any task whose BRIGHTDESK (or ATLAS/VENDEX) order is
stated indirectly *against* the system's locale prior. The bed draws such paraphrases on purpose (AUDIT A3: 6+6
BRIGHTDESK paraphrases, by example, by negation, by locale).

There is a second, unrelated latent risk, which was handled. In s6004 t1, Haiku dropped row 6778 from batch
`extract:3` (journal 667: 15 of 16 ids). The id-echo check fired and Sonnet re-did the batch (journal 671),
raising that trial to $0.1018 from about $0.03. Per BUILD-NOTES, a batch that fails after escalation would drop
rows silently; `verify` does not gate on `missing_rows`.

## Comparison with the Opus-built artifact (F-opus, 8/8) and B1-haiku (8/8)

F-opus (`artifacts/F-opus-records-k1/workflow.json`) has the same architecture in outline: one config read of the
notes, cheap extraction, deterministic resolve. Its config node differs in the ways that matter here:
- **Runtime model class F** (Opus) for the config node, `class F, maxClass F` (`workflow.json:177`). Only this one
  call is frontier; the rest is Haiku. It cost about $0.03–0.055 per run, so F-opus spends $0.046 per trial against
  F-haiku's $0.039.
- **Explicit decoding rule for worked examples and locale** (`workflow.json:51`): "examples like 'dob=08/09/1988 was
  born in August' => MDY; a country/locale whose people write day first => DMY; US/American conventions => MDY".
  It also warns about distractors.
- **A required `evidence` field** with "short quote(s) from the notes" per system (`workflow.json:111-118`).
  On s6001 it quoted *"A customer with dob=06/01/1999 was born in January"* and answered DMY in both trials
  (journal 434, 461).

The same Haiku builder, in the B1 arm (`artifacts/B1-haiku-records-k1/solve.mjs:101-114`), routed the config read
to **Sonnet → Opus** (`judge([MID, TOP], …)`). Its prompt says "a worked example (a sample numeric date and the month
or day it stands for) decides it" (`:108`), and it passed s6001 2/2. So Haiku as a builder can produce the right
design (one construction each, K_c = 1: this shows it is possible, not how often it happens). In the F arm it followed the kit's "start every agent node at the cheapest class" rule
(`skills/micro-harness/SKILL.md:41-47`) for a node where escalation can never fire.

## Classification

**construction-defect: 2, execution-judgment: 0, harness/env: 0, oracle: 0.**

The trigger is a run-time model judgment error, so a proximate-cause count would put both under
execution-judgment. They are filed as construction defects because a better builder or kit fixes them, on
the evidence above:
- The node is the only one whose single output conditions every row of a system.
- The artifact gives it the weakest model, no evidence field, no example rule and no check, so escalation is dead.
- The construction-time probes never exercised the failing value.
- Two other constructions avoid the failure 4/4 on this task.

The kit shares the blame. It says to start each agent node at the cheapest class with `maxClass` headroom. It does
not say that escalation needs a check to fire, or that a global configuration judgment needs a stronger model,
an evidence quote, or a consistency check.

## Fix candidates (not applied; artifacts and kit are frozen for this round)

1. **Kit guidance (micro-harness).** Treat "global configuration judgments" as a distinct operator: one read of
   prose rules that conditions every item. Give it a stronger class or k-sample agreement with
   escalate-on-disagreement, a required verbatim evidence quote before the decision, and explicit decoding of
   worked examples. Add a validator warning for `onCheckFail: escalate` or `maxClass` above `class` on a node with no `checks`.
2. **Executable consistency check (artifact level).** Counterfactual re-clustering: re-run the deterministic
   merge with each system's numeric order flipped. If the flip yields fewer records, escalate `conf`. On the
   recorded outputs of all 8 trials (replayed), this flags s6001 only:
   - s6001: BRIGHTDESK MDY→DMY gives 42 → 37 records (score 0.789 → 1.0).
   - Every passing trial: the chosen BRIGHTDESK and ATLAS orders give strictly fewer records than the flip
     (6002 39 vs 46/46, 6003 46 vs 49/49, 6004 41 vs 43/44).
   - VENDEX is not always decisive (42 vs 42 on s6001).
   This was derived on now-inspected seeds and must be validated on dev seeds before use. Use it as an escalation
   trigger, not an override, because the bed plants day/month-swap namesake traps.
3. **Probe coverage (protocol).** All three probes shared BRIGHTDESK = MDY. For the sealed round, prefer probe sets
   in which each per-task convention takes both values, or record per family which convention values the probes
   covered.

## Side observation for the bed audit (unverified beyond these 4 tasks)

AUDIT A4 removed per-row evidence of date order (numeric forms only for day ≤ 12). The generator's
decisiveness rule then forces a misread to change clustering (`beds/records/world.mjs:681-711`). Together these
seem to make the BRIGHTDESK and ATLAS orders recoverable from the data by clustering parsimony: on 4/4 test tasks
the true order gave strictly fewer records. If that holds on dev seeds, a solver could choose those two orders
without reading the notes, which weakens the bed's claim that the convention cannot be read off the data.
This should be checked as an attack in `beds/records/attacks/` and is not a cause of these failures.

## Appendix: replay procedure

The scripts were in the session scratchpad and are not committed. To reproduce:
1. Copy `foundry.sqlite*` and `journal.sqlite*` to a scratch dir.
2. Write `workflow.json`'s `merge.source` (and `split.source`) to `.mjs` files.
3. For each run, take the last ok `model_calls.response.value` per `node_key` (`root/conf`, `root/extract:<i>/rows`).
   Build `items = batches.map((b,i) => ({rows: value_i}))` and call
   `merge({results: items, config: conf.orders, spec, expected_ids})`.
4. Score with `oracle(generate({seed, split:'test', difficulty:3}), {records})` from `beds/records/index.mjs`.
5. Flip one system's `numeric_order` and score again.
