# Critique of the Kev judge program: coverage and feasibility (revision 2, 2026-10-07)

*Development/diagnostic review. Target: [JUDGE-PROGRAM.md](JUDGE-PROGRAM.md) (1,994 lines, last
modified 17:43Z). Nothing was trained, served, sent to a hosted model or committed. No sealed bed was
opened and no bed `test` split was generated (one disclosure in Appendix A). Companions:
[01-kev-dossier.md](01-kev-dossier.md), [02-decision-inventory.md](02-decision-inventory.md),
[probe-summary.json](probe-summary.json) (rule arm only; `03-probe-results.md` is still a placeholder,
so no stock-Kev numbers exist yet).*

**Revision note.** This file replaces the 18:10Z write-up. I re-ran its load-bearing measurements
against the current tree (the bridge and `beds/incident` changed in between) and corrected three
points: the 0.287 s unit argument (G3) is now framed in both directions, the total laptop time is
15-30 GPU-hours, not "12-31", and the embedding timing was re-measured (G14). New findings: G1 (the
benchmark path rejects any state over 384 tokens), the I2 tag audit against `beds/incident` v4.0.0
(G9), the stale bed pin (G12), the 5-world real-trace set (G8), the hosted-arm cost floor (G15), the
augmentation interaction (G19), the signed transport (G5) and the two builder arms (G6).

**Evidence tags.** **[M here]** measured or executed in this review (Appendix A). **[D]** read in a
file, with path and line (`kev:` = `/home/user/jaredpalmer/kev` at `5e42a7a`, `fdy:` = this
repository). **[E]** estimate, with the arithmetic. Line numbers drift in beds other agents are
editing; function names are the stable reference.

---

## 0. Verdict

The program's accounting is sound and its label sources are real. Its weak layers are the ones the
owner asked about: whether the evaluation and the laptop plan are *robust*, and whether any judge can
*reach a workflow*.

1. **Coverage accounting holds.** 41 ports (the text says 40) map or exclude all 100 inventory
   decisions: 46 mapped + 18 deferred + 36 excluded, no overlaps, recomputed [M here]. Each exclusion
   I checked against bed code holds; two rest on closed label sets (G27).
2. **Label sources exist** in every bed named, with the truth fields as described (2.2). Problems are
   in how they are used: the I2 tag table is out of date against the current bed, I2's labels are not
   a function of its state for blip-echo lines, and no port has a determinacy audit (G9).
3. **Job specs match** the real `kev.train` argparse and the bridge validators for all 10 train
   variants derived from the program, and for J1 (2.7). But the evaluation job
   (`kev.benchmark --data`) cannot score the program's own data: it skips every record over 384
   tokens (G1). That is the most damaging new finding.
4. **Not robust yet, in order of damage:**
   - evaluation drops long states silently (G1) and state budgets are in bytes/4, wrong by about 2x
     for logs, tables and ids (G2);
   - the laptop schedule rests on one unverified number, ignores host RAM, the missing DeltaNet
     kernels and none-pair inflation, and totals 15-30 GPU-hours against a 24-hour cap (G3, G4);
   - calibration is fitted on a different numeric path than the one that serves, and the serving
     transport in the program does not work with the bridge (G5);
   - **nothing in the build plan makes a judge usable in a workflow**; C4's end-to-end checks have no
     owner (G6);
   - the failure-class port is not the THESIS port, and the THESIS's motivating failure (wrong-type
     reuse, 0/21) is absent from the X5 data (G7);
   - real-trace data is five worlds, and they sit inside the training seed range (G8).
5. **"Is 5K sufficient?"** The measured-curve design is the right instrument and its prior (5K is a
   smoke test for the hard ports) agrees with Kev's own docs (no gain at 400 records, +5.9 pp at
   1,050 on a 4B model [D `kev:skills/kev-finetune/README.md:46-50`]). But the time for the 5K point
   is anywhere from 17 minutes to 2.6 hours until J0 measures it (G3), and the sufficiency rule
   cannot certify "5K is enough" nor trigger the 40K run at its own sample sizes (G11).

---

## 1. Prioritised gaps and fixes

**P0** invalidates a number, a schedule or the stated goal. **P1** weakens a claim or wastes laptop
nights. **P2** hygiene. Every fix names a test that can fail.

### P0

#### G1. The evaluation path rejects every state over 384 tokens (new)

- **Gap.** Every Kev read in the plan (stock bands §4.3, curve §4.4, calibration §7.5, J1, J3) uses
  `kev.benchmark --data`. In that mode Kev hard-codes the *training* context, so any record whose
  state exceeds 384 tokens is skipped, not scored, and the job still succeeds.
- **Evidence.**
  - `kev:kev/benchmark.py:192-193`: for `--data`, `context, skip_overlong = CONTEXT, True`;
    `CONTEXT = {**training_context(), "truncate": False}` = state 384, branch 1,024, packed 2,048
    (`kev:kev/suite.py:22`, `kev/model.py:14,31-38`). `LocalPredictor` encodes strictly with it
    (`kev:kev/predictors.py:108`). An over-length record raises `ContextOverflow`, which
    `evaluate_records` counts in `coverage.rejected_records`, lists in `rejected.json` and skips
    (`benchmark.py:139-141`, `kev/model.py:50-53`).
  - `kev.benchmark` has no state-limit flag, and the bridge job takes only `run`, `data`, `rotations`
    and runs `--run --data --out --device` (`bridge/laptop/jobs.mjs`, `KINDS['kev.benchmark']` and
    `buildCommand`). `--suite` with a manifest `context` and `--remote` are not exposed.
  - [M here] 35 dev-world states, Qwen3.5 tokenizer, `fits()` at the benchmark context against
    `training_context(8192)`:

    | State | n | Tokens (median / max) | Rejected by benchmark | Rejected at max_state 8192 |
    |---|---|---|---|---|
    | incident I1, 8 lines | 4 | 466 / 501 | 2 of 4 | 0 |
    | incident I1, 40 lines | 4 | 2,266 / 2,497 | 4 of 4 | 0 |
    | records, 6 export rows | 3 | 505 / 523 | 3 of 3 | 0 |
    | records, full notes | 3 | 1,708 / 1,734 | 3 of 3 | 0 |
    | kinetics, one document | 6 | 1,811 / 1,944 | 6 of 6 | 0 |
    | incident I2, one line | 4 | 64 / 82 | 0 | 0 |
    | synth, one document | 8 | 132 / 210 | 0 | 0 |
    | incident, whole log | 4 | 25,701 / 27,815 | 4 of 4 | 4 of 4 |

  - Consequence: the J1 bands, every curve point and the temperature fit would be computed on the
    short subset of exactly the hard ports (I1, X5, X8, the R group, kinetics), with survivor bias.
    The program's acceptance line "rows.json count equals the file's question count" would catch it,
    but the plan offers no remedy. §7.5 also says T is fitted from `rows.json` logits, which only a
    local `kev.benchmark --run` writes.
- **Fix.**
  1. Make the served path the evaluation path, which also removes G5's dtype mismatch. Add
     `experiments/kev-data/score-served.mjs`: it sends each record to the running `kev.serve` through
     `SystemOneClient` with `bridgeFetch` against `<endpoint>/svc/kev` (`bridge/PROTOCOL.md`, "From
     code"), one served model at a time, all questions of a record in one request. Probabilities (4
     decimals) suffice for accuracy, Brier, ECE, coverage and the power-transform T fit that §7.5
     already uses. `kev.serve` takes states to 65,536 tokens.
  2. Keep `kev.benchmark --data` for files whose every state fits 384 tokens (R5, I2, S2, X1, F1
     templates) and for Kev's own suite files (admitted at 384).
  3. Optional bridge change: a `kev.benchmark --remote http://127.0.0.1:<service port>` job kind
     (Kev already supports `--remote`, `benchmark.py:174`).
  4. J0 measures tunnel round-trip and per-request latency. The program's 15-35 minutes of evaluation
     per curve point assumed local batch scoring; served scoring of about 10K rows is roughly 3-4K
     requests at 0.5-1 s, so 0.5-1.2 h per point [E].
- **Test that can fail.** A 200-record file with 40% of states between 400 and 2,000 tokens. Through
  `kev.benchmark --data` it must show `rejected_records > 0` (documents the limit). Through the served
  scorer it must show 0 rejections, and 20 records re-read through the raw API agree to
  |dp| < 0.01. Any J1 or J3 report with `rejected_records > 0` is invalid.

#### G2. Every state budget is bytes/4, and real tokens are about twice that for logs and tables

- **Gap.** `beds/lib/canonical.mjs` `estimateTokens` is bytes/4. The program calls the Qwen ratio
  "unmeasured [unk]" (§1.0). Real Qwen3.5 tokens are 1.9-2.5x for logs, table rows, ids and kinetics
  documents, and 1.05-1.2x for prose. `maxState`, the "long" variants, training time, the embedding
  truncation and the 8,192 ceiling are all mis-sized.
- **Evidence.** [M here] median real tokens against bytes/4 for the same samples: incident I1 8 lines
  466 vs 209 (2.2x); records 6-row export 505 vs 240 (2.1x); kinetics document 1,811 vs 717 (2.5x);
  records notes 1,708 vs 1,623 (1.05x); whole incident log 25.7K vs 13.0K. "All documents of the cell"
  (kinetics, about 14K) and "the whole service window" exceed 8,192. The runbook triple (6K by bytes/4)
  is probably 8-10K real. Kev silently drops what exceeds `maxState`, which would remove exactly the
  long variants that gate 6.6 needs.
- **Fix.** Make the exact tokenizer (`/opt/hf-cache/hub/models--Qwen--Qwen3.5-0.8B-Base@dc7cdfe2`, on
  this VM) the only gate. Restate each port's typical and maximum in real tokens. Run Kev's own
  `fits(materialize(r), tok, **training_context(max_state))` on **every** record of every file, not 100
  lines. Window or drop the "whole log" and "all documents" long variants.
- **Test.** Acceptance 6 (§10) fails on any record that does not fit; a token histogram per port is
  reproduced from the tokenizer; a unit test pins the 2x ratio for log and table states so a bed
  change that moves it is visible.

#### G3. The training-time model rests on an unverified number and omits cost drivers

- **Gap.** The schedule multiplies rows by 0.287 s. That figure has no run record in this repository
  (the program says so), Kev's `s/rec` is per *record variant* over the training loop including CUDA
  warm-up (`kev:kev/train.py:604,639`), and the bundled toy file has 3 questions per record, 30-token
  states and 151 forward tokens per record [M here, `bridge/laptop/smoke/toy-train.jsonl`, 64 records].
  If the owner's file looked like that, 0.287 s is about 525 tokens/s on 8 optimizer steps, an
  overhead-bound number. The program's linear model (a record with q questions costs q rows at 0.287 s)
  can be wrong in **either** direction: too pessimistic for short multi-question records, far too
  optimistic once tokens dominate (2K-8K states).
- **Independent anchor.** The v1.0 release run: 15,531,716 forward tokens in 3,136 s = **4,953
  tokens/s** at batch 4 on a CUDA device with at least 24 GB (peak 23.9 GB; the metrics do not name
  it), 30,329 variants for 22,539 requested records
  (**+34.6%** from none-pair siblings), 512 tokens per variant [D release `training_metrics.json`,
  read in the HF snapshot].
- **Token model [E].** Assume 800 forward tokens per requested training row (about 530 mean state
  including 5% long variants, plus 100 branch, times 1.3 for none-pair inflation on 3+ option ports)
  and 500 per replay row. Training tokens per curve point: 2.5K = 3.0M, 5K = 5.0M, 10K = 9.0M,
  20K = 17.0M (total 34M).

  | Rate | Source | 5K point | Four curve points |
  |---|---|---|---|
  | 525 tok/s | owner smoke, toy rows, warm-up included | 2.6 h | 18.0 h |
  | 1,500 tok/s | assumed laptop rate at 500-token rows | 56 min | 6.3 h |
  | 4,953 tok/s | release run, batch 4 | 17 min | 1.9 h |

  The program's 34-70 minutes for 5K sits inside that 15x spread; only J0 can place it.
- **Totals, recomputed.** Training alone for the four points is 45.5K rows: 3.6 h at 0.287 s, 7.6 h at
  0.6 s. Night 1 with J0, J1 and four evaluations is 5.4-10.9 h, not "3.6-7.6 h with evaluations"
  (§7.4). Night 2's five grid configs (ep2 doubles rows, pkl adds a second pass on 30%, rp6 adds 4K):
  7.6-16.2 h with evaluation. Night 3: 2-3 h, plus 3.4-7.0 h for the conditional 40K run. **Total
  15.0-30.1 GPU-hours (18.4-37.1 with 40K)** against the pre-registered 24, before long variants,
  thermal throttling and any retry.
- **Fix.** Ask the laptop agent for the smoke run's `training_metrics.json` and `train.log`
  (`forward_tokens`, `wall_seconds`, `step_seconds`, `peak_device_bytes`, `peak_rss_bytes`). Redesign
  J0 to fit **two parameters** (fixed s per record, s per forward token) at about 300 / 2K / 8K tokens
  and schedule in forward tokens, not rows. Cap the 8K probe at `max_steps` 8-12: 400 rows of 8K at
  525 tok/s would take about 1.7 h, not "about 10 minutes for 3 jobs". Add none-pair inflation to the
  row table (the bridge rejects `none_pair_max_state` and `p_none`).
- **Test.** The J0 report states s/record, s/token, tokens/s, kernel path and `peak_rss`; the schedule
  table is regenerated from them and the first real curve point lands within 20% of its prediction.

#### G4. Laptop memory, kernels and the weights-dtype confound

- **Gap.** Host RAM is never mentioned (no "RAM", `peak_rss` or `row_budget` in the program). The
  owner states 14 GB with about 2 GB free, under WSL2 (`docs/laptop-agent-kickoff.md`). The release
  run peaked at **10.3 GB host RSS** and 23.9 GB device (batch 4, max_state 7,552, another machine)
  [D `training_metrics.json`]. Loading the 773M-parameter text model in fp32 stages about 3.1 GB on the
  CPU before the GPU copy [E from the safetensors header, M here]. On the GPU the frozen fp32 backbone
  is about 3.1 GB of the 3.4 GB peak, which leaves about 4 GB less whatever Windows holds; a 6-question
  record at 8K tokens becomes six 8K rows in one pass unless `row_budget` is set.
- **DeltaNet kernels.** `flash-linear-attention` and `causal-conv1d` are absent from
  `bridge/laptop/kev-requirements.txt` and from this VM's venv [M here]. Transformers then silently
  uses `torch_chunk_gated_delta_rule` (`modeling_qwen3_5.py:300,639`), while Kev's README says to
  install `flash-linear-attention` on CUDA for Qwen3.5 (`kev:README.md:396`; `fused_qwen35.py:53` pins
  0.5.2). Toy-length speeds say nothing about 2K-8K on that path.
- **Weights-dtype confound.** `weights_dtype bf16` is not a warm-start compatibility field
  (`COMPAT_FIELDS`, `kev:kev/checkpoint.py:316`), so it trains, but head.pt then records `bf16` and
  every later load uses a bf16 backbone with an unmerged adapter (`checkpoint.py:298-303`) while stock
  is read fp32. Stock-versus-candidate then differs in numerics as well as in weights.
- **Fix.** J0 records `peak_rss_bytes`, `peak_device_bytes` and `free -m`. The owner caps WSL memory
  and closes apps, and stops `kev.serve` before training (`LAPTOP-HANDOFF.md` T1). For states over 2K
  use `row_budget 16384` (and `length_sort 1`), both bridge-exposed, and use `weights_dtype bf16` only
  for the long-state probe, not for curve points. Owner decision: install `flash-linear-attention`
  0.5.2 on the laptop and compare J0 with and without it. `perm_kl` and `row_budget` conflict in Kev
  (verified), so the `pkl` grid config cannot use the long-state flags.
- **Test.** J0 completes at 8K with `peak_rss` under 80% of free RAM and no OOM-kill in `train.log`;
  the kernel path is logged per job; a stock read and a candidate read use the same dtype or the
  report says they do not.

#### G5. Calibration is fitted on a different path than serves; the serving plan does not work as written

- **Gap.**
  - `kev.benchmark` loads fp32 (`LoadOptions.from_env()`, dtype None). `kev.serve` forces bf16 on CUDA
    (`kev:kev/serve.py:327`), which Kev says moves probabilities by up to about 0.03 and the top answer
    on about 1 in 300 questions (`kev:README.md:409`). T and tau (5% and 2% budgets) are fitted on
    benchmark rows (§7.5) and applied to served p.
  - A delta run saves T = 1.0: `Meta(...)` in `kev:kev/train.py:549` sets no temperature and
    `warm_start` does not copy the init's 2.351. The program lists this as [unk]; the code answers it.
    It also means a raw "as shipped" Brier or ECE comparison of stock against candidate is unfair by
    construction. Refit both, as §7.5 intends.
  - "Stock on 8008, candidate on 8009" (§7.6) is impossible: the bridge refuses a second `kev.serve`
    (409 `service_exists`, `JobManager#reserveService` in `bridge/laptop/jobs.mjs`), and a service holds
    VRAM that a training job needs.
  - §7.6 says `SystemOneClient` reaches the laptop "with a bearer token". Every `/svc/kev` request must
    be signed (`bridge/PROTOCOL.md`, route table); the supported call is `new SystemOneClient({url:
    `${endpoint}/svc/kev`, fetchImpl: client.bridgeFetch})` (`PROTOCOL.md` "From code";
    `bridge/test/e2e.test.mjs:78`).
- **Fix.** Fit T and tau on probabilities read through the serving path (G1's scorer), or pin the same
  dtype on both sides with `KEV_DTYPE=fp32` in the laptop operator's `bridge-config.json` `env` (an
  operator setting, not a job parameter). Record dtype, backend, fla status, run and T in every ledger
  row (today `JudgmentPort` stores only `systemOneModel ?? body.model`). Sequence stock and candidate
  serving, never concurrent. Rewrite §7.6 around `bridgeFetch`.
- **Test.** A served replay of 300 dev-select rows per port differs from the fitting rows by less than
  0.01 in mean max-p and has at most 0.5% argmax flips, or the port is flagged.

#### G6. No build group delivers the path from judge to workflow (wiring), and C4's end-to-end checks have no owner

- **Gap.** §8.4 lists five Foundry changes "not made by this program document". G0a-G9 build data,
  baselines and analysis only.
- **Evidence [M here].**
  - The node-kind enum has no `judge` (`schemas/workflow.schema.json:99`: task, assert, human, map,
    loop, wait, agent, code, verify).
  - Nothing outside tests constructs a `JudgmentPort`; `src/ports.mjs` is the only file under `src/`
    that names it.
  - Builder-facing text never mentions Kev or a judge node: the micro-harness skill's agent `role`
    list contains "judge" as a model role only (`skills/micro-harness/references/ir.md:29`); the
    construction pre-registration mentions "typed judgments" as prose.
  - There are **two** builder arms. The micro-harness builds IR workflows; the script-harness builds
    Node scripts that may call models "only through the session's `callModel` helper"
    (`skills/script-harness/SKILL.md`). A judge reachable only through a new IR node cannot serve the
    script arm.
  - The inventory itself offers a cheaper first hook: A0 says "a `judge` node kind (or an `agent`
    engine field) with `threshold` and `onAbstain`", and micro-harness operators 2 (raw-and-reading
    extraction), 3 (classify with an enum, cascade) and 4 (pairwise judgment) are exactly where R1-R4,
    I1 and X2 plug in.
- **Missing pieces.** (i) A **port kit** per port: the state builder and slot filler that the data
  factory uses must be the code the runtime calls (R1's `source_note` is "the system's paragraph plus
  any it names"; X5's state is "paragraphs chosen by code"), otherwise train and serve diverge.
  (ii) Behaviour when the tunnel or laptop is down; the CPU fallback takes 26 s at 566 tokens (§7.6),
  so it is not a fallback. (iii) Journaling for deterministic replay without the laptop. (iv) A rule
  for enums with no port (inventory A0, the generic case): unknown port means hosted model, never
  Kev-gated. (v) The ledger stores `requestHash` only (`src/judgment.mjs:80-85`), so wired ports
  produce no training or real-trace data. (vi) The X8 end-to-end test uses 30 tasks per arm, too few
  to see a Haiku versus gated-Haiku difference; a wrong-reuse bound of 2% needs **at least 150**
  opportunities with zero errors (rule of three: 3/150 = 2%).
- **Fix.** Add **group W (wiring)** with these packages, each with a test:
  - **W0** a `systemone` provider route for existing `agent` nodes whose `returns` is a single enum
    (operator 3): reuses `model.class/maxClass`, `escalation`, `checks` and the journal, no schema
    bump. Test: a scripted Kev client plus a scripted Haiku, a low-p answer escalates once and both
    steps appear in the journal.
  - **W1** `judge` node (multi-question, one request per state): schema, validator, executor, journal
    and replay; adapters reject it. Test: replaying a journaled run makes 0 network calls and
    reproduces the output.
  - **W2** `src/judges/<port>.mjs` port kits imported by both the factory and the runtime. Test: for
    200 bed tasks per port, `buildState(task)` equals the training state byte for byte.
  - **W3** router Kev, Haiku, Sonnet, terminal route, with `onUnavailable`. Test: an injected tunnel
    failure yields a journaled escalation to Haiku, never a silent default.
  - **W4** ledger content store and oracle-label join. **W5** policy entries (`systemone` provider,
    run id, imputed cost; today `costUsd: 0`, `src/ports.mjs:80`).
  - **W6** builder-facing: operator text for 2, 3 and 4, a `tools/judge.mjs` beside `tools/model.mjs`
    for the script arm, and a port catalogue marking each port `gating` or `advisory`. Test: a
    validator rejects a `gating` binding to an `advisory` port.
  - **W7** end-to-end harness for the X8 cascade (at least 100 tasks per arm, otherwise report the CI
    and stop short of a verdict) and the X5 gate (at least 150 non-matching tasks). Schedule it right
    after the first curve point; AGENTS.md says every phase must produce a capability number.
  - **W8** maturity bookkeeping per port against ROADMAP §6.2 (EXISTS, REACHABLE, DEFAULT-LIVE,
    OBSERVED, CAUSAL, PRODUCT-PROVEN). After T1 a port is EXISTS (dev evidence); it is REACHABLE only
    after W0 or W1; DEFAULT-LIVE only if the builder emits it unprompted.

#### G7. The two named C4 ports do not match the THESIS

- **Gap.** (a) **F1** offers flake / env / model_output / budget / defect / finding. THESIS §7 and
  ROADMAP §2.6 define the failure-class port as **flake / variance / defect / env / impossible /
  finding**, and the healer's checks (replay; resample K=8 for variance; control build; unsatisfiable
  contract) depend on `variance` and `impossible`. The program silently drops two and adds two, then
  maps inventory C1 to F1 as if equal. (b) **X5** trains parametric conventions inside a family
  ("ATLAS dates are dmy"). The failure that motivated C4 is **wrong-type reuse**: the matched incident
  pair's follow-on, skills arm 0/21 with 21 false successes, baseline 7/21 [D `docs/RESEARCH.md:98`;
  `docs/THESIS.md:205-207`]. The nearest port, C9 `same_task_family`, is wave 3 and "expected to lose
  to kNN". The 21 cases are not in this repository, so no real set exists.
- **Fix.** (a) Adopt the THESIS taxonomy (add `variance`, `impossible`; label them from the resample-K
  harness and from unsatisfiable contracts) or record an owner-approved amendment and keep both label
  sets. (b) Add a **cross-family type-applicability family to X5**: assumption = a bed family's task
  statement (`family.description`, the README), state = another bed's prompt and inputs head; labels
  by construction (same family `holds`, other family `violated`, an unrelated paragraph `not_stated`).
  It is cheap, label-exact and needs no tap. Move it into wave 1; keep C9 as a comparison arm.
- **Test.** Leave-one-family-out accuracy on the type-applicability family is above the embedding
  baseline with the CI above 0; the false-accept rate at ε = 2% is reported on 0/21-style cross-type
  cases.

#### G8. Reserved worlds, and the real-trace set is five worlds

- **Gap.** The only real-trace X8 data (`records-hand-pilot`) cover tasks `records:dev:d2:s101`,
  `s102`, `s103` and `records:dev:d3:s101`, `s102` [M here, `results.jsonl`]. They sit inside the
  training seed range 1-3999 (§3.1); the same worlds' note sentences would be in X8-records and R1-R4
  training. The span registry (§3.4) guards held-out *families* and exact spans, not worlds. Separately,
  the journal's 121 Haiku calls are 12 runs and 80 distinct prompts over **five worlds** [M here,
  `journal.sqlite`, read-only]. Under a world-clustered bootstrap (§6) that is n = 5 clusters, so the
  promotion rule's real-trace axis (§8.1 item 1) cannot be satisfied meaningfully. Three of the five
  are d2, where conventions are fixed defaults. The same applies to the `calibration`, `distill-pilot`
  and `c0-smoke` journals.
- **Fix.** (1) A **reserved-world registry**: every (bed, split, difficulty, seed) already used as
  evaluation, real trace or probe is excluded from every training file, enforced in `build.mjs`.
  (2) A real-trace axis counts only at 30 or more distinct worlds. (3) Build the X8 "real errors"
  family now by running Haiku on the records extraction node over about 60 fresh dev worlds outside
  1-3999 (about 480 calls, roughly $7 at the journal mean of $0.015): these are genuine model errors,
  not synthetic near-misses. This is F3's replay-agreement idea, moved forward.
- **Test.** Acceptance 3: zero reserved worlds in any train or calib file; a deliberate injection of
  seed 101 into train fails the build.

### P1

#### G9. Label determinacy, tag coverage and class support

- **Gap.** The I2 table was not built from the current bed. `beds/incident/gen.mjs` is now
  `VERSION = '4.0.0'` and emits **24** tags in dev worlds [M here, 90 worlds]. The program's mapping
  names 20 and says "every other tag → unrelated" while also saying the build "fails closed on an
  unknown tag". Not in the table: `echo` (2,671 lines in 300 worlds), `stray` (1,053), `consequence`
  (331), `renew` (256). `echo` is the dangerous one: it is the callers' own failure or fallback lines
  during a *blip* (`gen.mjs:787-804`, `K.blipEcho`), drawn from the same `DEP_FAIL` and `SOFT_FALLBACK`
  templates as `dep` and `soft` lines (`gen.mjs:800`), but not part of the incident.
- **Evidence [M here, dev seeds 1-150 × d4-d5 = 300 worlds, 24,059 digit- and name-masked line
  skeletons].** 556 skeletons (2.3%) carry more than one label class under the program's mapping.
  Among skeletons that contain an origin line, 208 of 3,128 (6.6%) also occur under an unrelated tag
  (e.g. `I: heap after gc <N>% (pause <N>ms)` is tagged onset, root, baseline and three blip tags).
  Among relay-form skeletons, 283 of 8,216 (3.4%) also occur as `unrelated`, and **all 283 are echo
  lines**. The I2 state `{line, emitting_service, calls}` has no time or episode context, so for these
  lines the label is not a function of the state. The program has no determinacy audit for any port.
- **Class support.** Held-out-family designs need a class-by-family-by-difficulty support table before
  freezing. Known thin cells: runbook `retract` is true only at d5 [M here, `makeWorld` K by
  difficulty]; synth `instruction_like` exists only at d5 (60 of 180 dev worlds) and `projected` is
  171 of 11,233 claims; kinetics' `retracted swap` is d5 [D README:133], while withdrawn late reports
  (README:126) may add support at lower levels, which is what the table must count. X3 trains kinetics
  and tests runbook, so its `retracts` class may rest on d5-only supply in both.
- **Fix.** Classify the four new tags explicitly: `renew` and `stray` unrelated; `echo` either
  `unrelated` with episode context in the state (seconds since window start, first caller failure) or
  excluded from I2; decide `consequence` (a decoy callee's reaction, not an origin or relay). Add the
  determinacy audit for **every** port: group records by masked state; the share of states carrying two
  labels must be under 1%, otherwise the port is flagged "label not determined by state" (as A28 was).
  Add the support table to acceptance 4.
- **Test.** The audit passes per port or the port is demoted; a build run against bed v4.0.0 either
  maps all 24 tags or fails closed.

#### G10. Selection reads in-family data; promotion reads out-of-distribution data

- **Gap.** Config choice (§7.3) is on dev-select (seeds 4500-4999, same templates as train). Gates
  6.1-6.10 are on held-out templates, paraphrases and families. Selecting by in-family NLL favours the
  memorising config (ep2, lr4).
- **Fix.** Give selection its own **dev-OOD** slice (a disjoint part of G0b's pool and a second
  held-out template index) that is not part of the final gate; seal the test-OOD pool.
- **Test.** The selected config's dev-OOD macro NLL is reported next to its dev-select NLL.

#### G11. The sufficiency and 40K rules have no power at their own sample sizes

- **Gap.** With n = 500 paired items and discordance d, SE = sqrt(d/n). At d = 6%, SE is 1.1 pp. The
  "5K is sufficient" rule (one-sided 95% bound on acc(20K) − acc(5K) below 2 pp) passes a true 0 pp
  difference only while d is below about 7%, and fails a true +0.5 pp (bound 2.3 pp). The 40K trigger
  (gain of at least 2 pp with a CI excluding 0) needs an *observed* gain above about 2.2 pp, which
  needs a true gain near 3 pp. Between them lies a zone, "not certified, not triggered", that the
  program does not name. Each curve point is one training seed. X5's 2% budget with 400 calib rows
  leaves about 5 accepted errors for tau, which is noise; a stable 2% risk estimate needs about 540
  *accepted* rows [E: n = (1−p)/(0.09p)], so about 900 calib rows at 60% coverage.
- **Fix.** Raise per-axis n to at least 1,000 for the 5K-versus-20K comparison or widen the margin to
  3 pp and say so; add the named indeterminate outcome and what it triggers; train **two seeds** at 5K
  and 20K (+2.3 h at 0.287 s/row, +5 h at 0.6); make X5 calib and test at least 1,000.
- **Test.** The pre-registration records the minimum detectable difference per port and a simulated
  rule outcome at true differences of 0, 1, 2 and 3 pp.

#### G12. Held-out pools, the bed pin and bed internals are not protected

- **Gap.**
  - `experiments/kev-data/heldout/` lives in the same working tree as the G1-G8 workers; "never
    imported" is not "never read".
  - The pin is already stale. §2.1 pins incident 3.0.0; `beds/incident/gen.mjs` is 4.0.0 [M here].
    `beds/records` and `beds/gameqa` export no VERSION and gridquest's is not exported
    (`const VERSION`, `index.mjs:14`), so a VERSION pin cannot cover the highest-priority bed.
  - The pin is "sha256 of each bed directory's tracked files". `beds/` also holds `sealed/`, `lib/`
    and `CONTRACT.md`; a glob over `beds/*` would sweep in the sealed bed.
  - Label sources import bed *internals*: `records/world.mjs`, `incident/gen.mjs` and `catalog.mjs`,
    `codefix/build.mjs`, `kinetics _internals`, `gameqa _internal`, `gridquest _internal`. Line numbers
    in §1.2 have already drifted by up to about 20 lines.
- **Fix.** Author G0b's pools to an ignored location (`.foundry/kev-data/heldout/`), commit only their
  sha256 until after the freeze, and brief G9 not to read it. Pin with an **explicit allow-list of the
  nine dev beds**, hashing `git ls-files` of each, never the sealed directory. Build from a **frozen
  copy** (`git archive` of the pinned commit plus the working-tree diff hash), not live imports. Cite
  functions, not line numbers.
- **Test.** Two builds on different nights are byte-identical; a bed edit between them is refused; a
  file added under `beds/sealed/` does not change the pin hash and is never opened.

#### G13. The build-plan groups are not independent, and acceptance is global

- **Gap.** G0a is the critical path (all 41 contracts, `lib/*`, `build.mjs`, export, acceptance
  harness and LLM pools "in under an hour"). G0b needs G0a's contracts. G1-G8 import `lib/*` and
  `spec/ports.json`. G9 tunes rules and runs baselines on G1-G8 output. Six cross-bed ports (X1, X2,
  X4, X5, X7, X8) are assembled from 3-7 groups with no assembling owner except `build.mjs`. G7's
  exec-injected F1 family depends on a runtime other agents are changing. **S2 (wave 1) needs the
  synth value-sentence tap** (§2.6) but the tap-risk fallback (§11) and G3's cut line name only X3, S1
  and X7. Acceptance tests (§10) are global; per-group criteria are absent.
- **Fix.** Make the DAG explicit: G0a contracts and lib first; G0b and G1-G8 in parallel against a
  frozen interface stub; then G9 and assembly. Per-group acceptance: rows per port at target, label
  balance within 1:3, determinacy audit (G9), real-token fit (G2), second-code-path label agreement at
  least 99.5% on 200, tap alignment at least 95% on 200 worlds, leak scan, generation time. Add an S2
  tap contingency. Name one assembler per cross-bed port. Halve G0a (contracts and lib first, pools
  later).
- **Test.** Each group's test file runs alone with `node --test` and fails on a seeded defect.

#### G14. Baselines are runnable but slower and less fair than stated

- **Embedding speed.** `BAAI/bge-small-en-v1.5@5c38ec7c` downloaded in 3 s and loads under `python -I`
  in `/opt/kev-venv` with scikit-learn 1.9.1 [M here]. Re-measured at 4 threads, load about 5.5 on 4
  cores: **35 ms/text at 128 tokens, 86-289 ms/text at 242 tokens** (two repeats of one input). The
  earlier pass saw 1.0-1.7 s/text at load 15. The program's 20-50 ms holds only for short texts on an
  idle box. At 100-300 ms, 100K texts take 3-8 h of shared CPU, not 0.5-1.5 h.
- **Truncation is unfair.** The embedding sees at most 512 tokens (head and tail) where Kev sees up to
  8K. For X5 (2K), the long variants and the I1 long state, the decisive span can be cut out, which
  inflates Kev's margin.
- **Variable-option ports** (S1, K2, F2, Q3, Q1) have per-record option sets; a fixed-label logistic
  cannot answer them.
- **`local-logit`** is the second comparator ROADMAP §2.4 names ("compare against stock Jev and
  `local-logit` per port") and a Phase 4 build item; it is absent.
- **Fix.** Budget CPU honestly or run it as a nightly background job; give the embedding arm a
  chunk-and-max-pool variant reported beside the truncated one; specify option scoring (cosine between
  the state or question and each option text) for variable-option ports; add a stock Qwen3.5-0.8B-Base
  `local-logit` arm over option-letter logits, or record why stock Kev replaces it.
- **Test.** The embedding arm reproduces a hand-computed kNN accuracy on 50 records.

#### G15. The hosted arms are priced from a number the repository does not support

- **Gap.** §5 prices Haiku at $0.001-0.003 per typed call ($26-78 for about 26K calls) and the
  hosted budget at about $150. Every hosted call in the three experiment journals I read
  (`records-hand-pilot`, `distill-pilot`, `c0-smoke`) went through the `claude-cli` provider; the 125
  Haiku calls cost **$0.0045 at minimum** and $0.0139 at the median of the 121-call pilot (output is
  about 1,000 tokens per call there, so typed calls will be cheaper, but the CLI path's fixed overhead
  is unmeasured) [M here, journals read-only]. At the observed floor, 26K calls cost $117; at the
  median $361, which approaches the $500 pause line. Median latency was 9.4 s per call there; at
  concurrency 4 and 3-9 s per call, 26K calls is 5-17 h of wall clock, which the schedule does not
  carry.
- **Fix.** Run a 50-call pilot of the actual typed Haiku and Sonnet calls first; report cost and
  latency per call; then set the hosted budget and schedule the arm in the cloud in parallel with the
  laptop nights. Confirm the Haiku arm with the owner (already listed in §11).
- **Test.** The 50-call pilot fixes cost per call and wall clock within a stated range before any
  full arm is launched.

#### G16. The gridquest Q1 label procedure hits a lifetime cap

- **Gap.** `createEnv(task)` stops executing actions after `lifetimeActions` (default: the task
  budget, 53 at d3 seed 3 [M here]) and restore does not refund them (`beds/gridquest/index.mjs`,
  comment above `createEnv`). Probing 4 directions in up to 8 rooms by step and restore exhausts it.
- **Fix.** Use `createEnv(task, { lifetimeActions: Infinity })` (the file says a harness must say so
  explicitly and log it) or read `_internal.world(task).w.edges` directly.
- **Test.** Q1 labels agree between the two methods on 200 rooms.

#### G17. Acceptance wording and job-spec details

- `train.log` prints `dropped N of M` only when records are dropped (`kev:kev/train.py:103-109`).
  Accept on the **absence** of "dropped" and on the `N training requests` line equalling file records
  plus replay.
- Job outputs are `runs/<jobId>` (`jobs.mjs`, `outRel`), not `runs/<name>`.
- `kev.benchmark` summarises only `variant == "clean"` and excludes `source == "unknowable"` from
  accuracy (`benchmark.py:76,87`). The exporter writes `_meta: {id}` only, so evidence-removed files
  must also carry `_meta.source = "unknowable"` or their arbitrary `label` pollutes accuracy.
- J3 and `kev.serve` accept `runs/<jobId>` only for a `kev.train` job this daemon ran whose `head.pt`
  sha still matches (the F1 guard). My contract script, using a stand-in directory, was refused, as
  designed. Extend `bridge/test/kev-contract.test.mjs` with the J-specs through the real job path so
  the bridge cannot drift away from the program while F1-F5 land.
- J0 runs without `--suite`, so the first fetch of `decision-v7/train.jsonl` (gitignored locally; 18.7
  MB from the Hub) happens inside the first J2. Add `suite` and `replay 50` to J0 so the fetch and its
  hash check are exercised in the first 15 minutes.
- The bridge's per-kind timeouts (kev.train 12 h, kev.benchmark 4 h) are sufficient; `minFreeMiB`
  2,048 refuses jobs when the laptop disk is low, so J0 should report free disk.

#### G18. Licences and acquisitions

- `jaredpalmer/kev-suites` is public and ungated with **no licence declared** (tags: `region:us`
  only; [M here, HF API]). decision-v7 mixes Yelp, Amazon, IMDB, AG News, MNLI and others. Its
  `train.jsonl` is fetched by the laptop at training time (`fetch_partition`, pinned `cc4bac80`).
  AGENTS.md requires URL, SHA, date, licence and outcome per import; the program plans an entry for
  bge-small only. Checked and fine [M here]: Kev (`kev-0.8b@bf75a6a8`), Qwen3.5-0.8B-Base
  (`dc7cdfe2`) and `deepset/prompt-injections` (`4f61ecb0`) are Apache-2.0; bge-small (`5c38ec7c`) is
  MIT; all-MiniLM-L6-v2 (`1110a243`) is Apache-2.0.
- **Fix.** Add manifest entries for `kev-suites@cc4bac80` (licence "undeclared; sources mixed"; use:
  replay only, adapters not redistributed), the Kev snapshot, the deepset set and the Qwen base.
- **Test.** The `research/manifests` entries validate with `research/acquire.mjs`.

#### G19. Kev's augmentation puts out-of-contract options into about a third of training questions

- **Gap.** Kev's recipe applies, on every choice question (`kev:kev/data.py:320-343`): with p 0.10 on
  questions with more than 2 options, the true option is removed and a generic "other / none / not
  listed" key becomes the label; with p 0.12 a generic option is added as a wrong alternative; with p
  0.15 an irrelevant distractor is added. `p_none_pair 0.25` adds two more sibling records for 3+
  option questions (`data.py:346-359`). None of these are bridge parameters, so they cannot be turned
  off per port. Foundry ports never offer such an option (§1.0 deliberately avoids "none of these").
  Ports with a catch-all (`unrelated`, `not_stated`, `mentions`, `out_of_scope`, K1's own `none`) will
  see records where a different generic key is correct beside their catch-all. The label stays
  defensible, but it is supervision that the served contract never uses.
- **Fix.** State this in §7.2 (it is the release recipe), keep it, and test its effect: evaluation is
  unaugmented, so a per-port comparison of a run with `p_none_pair 0` against the base on the catch-all
  ports (I2, X3, X4, X5, X6, K1) shows whether it helps or hurts there.
- **Test.** The catch-all ports' `unrelated` / `not_stated` recall on dev-select is reported for both
  runs; a drop of more than 3 pp on any of them is flagged.

### P2

| ID | Gap | Fix |
|---|---|---|
| **G20** | Port ids collide with other id spaces: port C1-C9 vs inventory C1-C9 (failure class vs objective requirements), port F1-F3 vs inventory F1-F3, port C4 vs ROADMAP claim C4, and §1.3's deferred "C4" vs port C4. §1.5 reads correctly only if the reader tracks which space is meant. | Prefix `P:` for ports, `D:` for inventory decisions, "claim C4" for the roadmap. |
| **G21** | The catalogue holds 41 ports (R5, I3, S4, K3, Q6, X8, F3, C9 included); §0.6 and G0a say 40. | Correct the count. |
| **G22** | `TYPE_LABELS` has 7 kinds with 22 mixed labels plus 7 plain ones (`beds/synth/catalog.mjs:175-183`), not "25 entries". | Fix the number. |
| **G23** | The forbidden-key list (§2.3 rule 2) includes `kind` and `role`, yet port states use `source_kind` (X1), `node_kind` (F1) and `author_role` (X4). | Say "exact key names", or rename. |
| **G24** | §3.5 and the pre-registration say "no human labels except C1 real set"; C3-C6 need "about 300 hand labels from two annotators" (§1.2). Nobody is named. | Name the annotators (owner? two agents with agreement reported?) or move C3-C6 out of the plan. |
| **G25** | Wave 2 builds data for 28 ports (G3-G8) that no night trains or evaluates; "the data is right" is untested for them. | One cheap check per wave-2 group: a stock-Kev read on dev-select (through G1's scorer) plus a 2K-row smoke fine-tune. |
| **G26** | The batch id in records specs (`<D|T><difficulty>-<1000 + hash % 9000>`, e.g. `D4-3073`, `world.mjs:731`) is not injective; the program labels X8 real traces "from the world regenerated from the batch id". | Regenerate from the run's task key (`records:dev:d3:s101`), which `results.jsonl` already has. |
| **G27** | A10 Q1 and A14 are excluded because `TYPE_LABELS` names the kind. That is exact only for the bed's closed label set; the inventory itself says Kev's value would be "unseen type names" (A14). A0 is "realised by the judge node", but only the 41 contracts can gate. | Keep the exclusion for the bed, add a wave-3 held-out-type-name port for robustness outside it, and state the rule "unknown port means hosted model, never Kev-gated". |
| **G28** | Model size is not tested. Kev's own README puts Kev-0.8B at 0.14 coverage at a 5% error budget on new-source decisions against 0.52-0.69 for Kev-4B/9B/27B and 0.70 for Jev (`kev:README.md:216`). The program has no larger-model ceiling arm, so "is 0.8B enough?" has no upper reference besides Haiku and Sonnet. | Owner decision: one cloud read of stock Kev-4B on the OOD axes of three ports (it cannot be fine-tuned on the 8 GB laptop and does not fit this VM). Otherwise state that Haiku/Sonnet are the only ceiling arms. |

---

## 2. Check-by-check results

### 2.1 Does every inventory decision map to a port or an explicit, sound exclusion?

- **Count.** Mapped to a port: A1-A13, A15-A23, A26, A27, A29-A32, B3, B4, B6, B8, C1, C3, D1, D5, E1,
  E4, F1, F2, G1, G2, G3, G6, G7, G8 = **46**. Deferred: B2, B5, B10, C4, C5, D2, D3, D4, D6, D7, D12,
  F3-F8, H6 = **18**. Excluded or realised elsewhere: **36** (12 authority-bearing, 14 code-rule, 5
  not-a-judgment including A0, E3 and G9, 3 needs-generation, A28, H1). Total 100; every id A0-H6
  appears exactly once, no overlaps [M here, script over the inventory headings and §1.5].
- **Exclusions checked and sound.** A28 (`beds/gridquest/README.md:199-201`: every true note wording
  also occurs as a false note); A24 (simulator messages are enumerated); the 12 authority-bearing
  decisions (A25, C8, C9, D8-D10, E5, E6, F9, F12, G5, H2) have inventory fit "none" (G5 "low"); the code-rule
  set (B1, B7, C2, C6, C7, D11, E2, F10, F11, G4, G10, G11) has fit "none" or "low". A10 Q1 and A14 hold
  for the bed's closed label set only (G27).
- **Deferrals.** All 18 name a trigger. B5 (verify, inventory fit "medium") is deferred for label
  scarcity yet every bed ships `referenceSolve` and `badControls` with oracle scores, so a field- or
  window-level wave-2 port is possible; THESIS ports "Choice" (D2) and "Verifier" (B5) therefore have no
  path now, and D6 (reuse, construct, delegate) is the decision claim C2 hangs on. That is defensible
  before Phase 5, but freeze their port contracts now so ledger labels accumulate from day one (needs
  W4).
- **Mapping quality.** Inventory "high-fit" A27 and F1 are wave 2 and G1 is wave 3 for label supply
  (5-template pool; composer needed; hand labels). Fair, but §1.1 should say so. The shortlist ranks
  1-7 map to R1-R4, S2 (A10 Q1 excluded), X3, C1 (wave 2), C3 (wave 3), X1 and F1.

### 2.2 Do the label sources exist? (bed code opened and run on dev seeds)

| Bed | Claim in program | Result [M here] |
|---|---|---|
| records | `buildWorld` (`world.mjs`), `w.ctx.conv {atlas,vendex,bd,mirror,window,flags[],persp}`, `ctx.choices {orderTpl,flagTpl,mirrorTpl,reliableTpl,perspTpl,ref,reliable}`, `ctx.cutoff`, `ctx.batch` | **Exists** and exported; `flags[0] = {system, polarity, token}`. `badControls` are `{name, make}` whole-output controls (`atlas-order-flipped`, `status-meaning-flipped`, ...), so X8's per-field near-misses come from diffing against truth. No VERSION constant. Batch id not injective (G26). |
| incident | `build(seed, split, difficulty)` returns `{task, truth}`; `idsByTag`, `linesBySvc`, `aliasDoc`, `impacted_services`, `softEdges`, ... | **Exists** in `gen.mjs` (not `index.mjs`); `truth` also carries `revised`, `stale`, `edgeDocs`. v4.0.0; tag table out of date (G9). |
| synth | `hidden()` world with `claims[].{mode,variant,cond,condText}`, `docMap`, `entMap`, `retractions`, `errata`, `concerns`, `supersessions`, `injection` | **Exists** under `hidden(...).world`. Modes in 180 dev worlds (d3-d5): measured 10,087, quoted 915, predicted 171, injection 60 (d5 only). S2 and the others need the synth tap (G13). |
| kinetics | `_internals(task).world.{traps,claims,docs,conds,bench,pilot,rawExport,meta}`, `conditionDescription`, `RATE_FACTOR` | **Exists**; `conditionDescription` and `RATE_FACTOR` are exported from `render.mjs`, not `index.mjs`. K1/X3 labels need the tap, as stated. |
| runbook | `makeWorld`, `spec`, `K`, `judgmentProbes` | **Exists**; `retract` is true only at d5. |
| gameqa | `_internal.{caseFor, evaluateRepro, replay, decoyReports}` | **Exists**. |
| gridquest | `createEnv`, `snapshot`, `restore`, `_internal.world` | **Exists**; lifetime cap breaks the step/restore labeller (G16). |
| codefix, ownerci | `build()` sites, `DOMAINS`, `b.herring` | **Exists** in `codefix/build.mjs` (internal, `build({seed, split, difficulty})`); ownerci VERSION 1.1.0. |
| kev suites | decision-v7 dev 1,204 records, transfer-v4 dev 764 | **Confirmed**: both load through `kev.data.load_records`. |

### 2.3 Do state sizes fit Kev-0.8B (8,192 tokens validated)?

Kev-0.8B was trained mostly on states of at most 384 tokens with longer ones up to 7,552 in its
document and skill stages; 8,192 is its validated serving length, and the server refuses (422) beyond
65,536 [D `kev:README.md:220`]. The program cites this correctly. The numbers it applies it to are
bytes/4 (G2). With real tokens, no wave-1 *short* state exceeds 8,192 (I1 40 lines is 2.5K; X5 at "2K"
is about 2-4K), but "all documents of the cell" (kinetics, about 14K), "the whole service window"
(25.7K) and probably the runbook triple are over, and everything above 384 is invisible to the
evaluation path (G1). Per-row VRAM at 8K is unmeasured (G4).

### 2.4 Is the laptop schedule realistic?

Not as stated. Totals and drivers are in G3 and G4: 15-30 GPU-hours against a 24-hour budget, a 15x
rate uncertainty at the 5K point, no host-RAM accounting, no fast DeltaNet kernels, serving and
training mutually exclusive on 8 GB. Data build is not a bottleneck: 1-80 ms per world across the
beds under a load average of 8 [M earlier pass, `timing.mjs`; not re-run]; the cost is LLM pool
generation, hosted baselines and the embedding arm.

### 2.5 Is the embedding baseline runnable?

Yes. Measured today: model download 3 s, `python -I` with transformers 5.17.0, torch 2.8.0+cpu,
scikit-learn 1.9.1, 384-dimensional vectors [M here]. Licence MIT. Open items are throughput,
truncation fairness, variable-option ports and `local-logit` (G14).

### 2.6 Are the Kev suites obtainable?

Public and ungated, 125 files, pinned `cc4bac80` [M here]. `decision-v7` dev (1.76 MB), calibration
(1.45 MB) and test (1.71 MB) are in the Kev git checkout; `decision-v7/train.jsonl` (about 18.7 MB,
12,576 records) is gitignored and downloaded by the laptop through `fetch_partition` during `--suite
... --replay` (G17: prefetch in J0). `transfer-v4` dev is 0.80 MB and its train file is empty
(eval-only). No licence is declared on the mirror (G18). The decision-v7 manifest pins only the Qwen3
0.6B and 4B bases, so `--base_revision` is required for Qwen3.5-0.8B, and the program passes it.
Kev's `test.jsonl` files are on the laptop checkout but unreachable through the bridge (no `--suite`).

### 2.7 Do the job specs match `kev.train` and `kev.benchmark` exactly?

Yes for training, no for evaluation data. I ran every spec through the bridge's `validateParams` and
`buildCommand`, then through the real `kev.train` / `kev.benchmark` argparse at the pinned commit (no
model loaded) [M here, re-run today against the current bridge and Kev checkout]:

| Spec | Result |
|---|---|
| J0a (maxState 8192, max_steps 50, base_revision, seed), J0b (+ `shared_prefix 1`) | accepted |
| J2 (maxState 2048; suite, replay 2000, p_none_pair 0.25) and J2 at maxState 8192 | accepted |
| grid: lr4, pkl (`perm_kl 0.1`, `perm_frac 0.3`), brier (`brier_w 0.25`), ep2, rp6 | accepted |
| `weights_dtype bf16` + `row_budget 16384` (long states) | accepted |
| `perm_kl` + `row_budget` | **Kev rejects** (conflict): never combine |
| `none_pair_max_state`, `p_none` | **bridge rejects** (not exposed), as §7.2 says |
| J1 (`kev.benchmark`, stock) | accepted, **but cannot score states over 384 tokens (G1)** |
| J3 and `kev.serve` with `runs/<jobId>` | accepted only for a real finished `kev.train` job (G17) |

Recipe cross-check against the v1.0 `training_config.json`: lr 2e-5, epochs 1, LoRA r16, `lora_targets
all` (12 modules, identical to the release `adapter_config.json`), head_dim 256, p_none 0.1,
p_none_distract 0.12, p_distract 0.15, p_none_pair 0.25, replay 6000, max_state 7,552, batch 4 × accum
2, base_revision `dc7cdfe2`: all match §7.2 and Kev's defaults. The release config also carries
`lora_placement: full`, a field the pinned Kev does not have; the module sets agree, so it is
harmless, but the release was trained by a different Kev revision than the pin.

### 2.8 Are the build-plan groups independent, with testable acceptance?

No, not as written (G13).

| Group | Hard dependency | Can start on a stub? |
|---|---|---|
| G0a | none, and everything depends on it | n/a (critical path) |
| G0b | contracts from `spec/ports.json`; hash and leak libs | yes, if its brief carries the contracts |
| G1-G8 | `spec/ports.json`, `lib/*`, export format, the §2.2 interface | against the interface only |
| G9 | exported format and G1-G8 data to tune rules and run baselines; G0b pools for OOD runs | rules can be drafted from READMEs |
| cross-bed ports | an assembling owner and `build.mjs` caps | needs integration tests |

The global acceptance tests (§10) are good and testable (determinism, split hygiene, leakage scan,
Kev format). Missing: per-group criteria, a determinacy audit (G9), the real-token fit over whole files
(G2), the benchmark-context check (G1) and the reserved-world check (G8).

### 2.9 Wiring and the C4 claim

- **Wiring:** designed in §8.2 and §8.4, built by nobody (G6). The deployed path also needs the laptop
  up, the single-service limit and the signed transport (G5), and the ledger to store request content
  (it stores `requestHash` only).
- **C4 as written** (`docs/ROADMAP.md:643`): Jev-gated applicability, drift and failure-class
  decisions are calibrated and beat code and embedding baselines; metrics Brier, false
  accepts/abstains, downstream wrong-reuse; falsifier (`:732`): a port that does not beat its baseline
  stays advisory. The program honours the falsifier, the Brier gate (6.2) and the false-accept and
  false-abstain family (6.4), and says downstream wrong-reuse and sealed families are out of reach. That
  is honest. Three adjustments:
  1. The pre-registered **primary** metric is accuracy (§9); the roadmap's is Brier and false
     accepts/abstains. For a gate, selective accuracy matters more than top-1: make Brier and coverage
     at ε co-primary.
  2. The X5 and F1 definitions must match the THESIS (G7), otherwise C4 is tested on different
     decisions from those named.
  3. A staged ladder removes the ambiguity about what each result supports:
     - **T1** offline per-port gates on generator labels (the program's plan): *development evidence*;
     - **T2** the wired end-to-end checks, powered as in G6: *development evidence for the mechanism*;
     - **T3** claim-bearing: ledger rows from judge nodes in C0, C3 and C2 experiments, at least 300
       oracle-labelled rows per port over at least 30 worlds (the program's own trigger plus G8), with
       the sealed-family result left to the sealed-bed owner. T1 cannot support the C4 sentence by
       itself.

### 2.10 What holds up (so it is not re-checked)

- All 100 decisions are accounted for; the wave-1 set and band assumptions are internally consistent
  (8 hard × 1.5 + 2 medium + 3 capacity × 0.5 = 15.5; the training-time table rows recompute).
- Truth fields named in the beds exist and generate in milliseconds (2.2).
- Training job specs are accepted by the real parsers (2.7).
- The release recipe, base revision, Kev commit and weight pins in §7.1-7.2 match the snapshot.
- Splits, seed ranges, the span registry and the held-out-family tables are coherent, and the program
  says plainly that in-family numbers are recall.
- Cost figures recompute arithmetically, subject to G15; Opus 5.5, Sonnet 5.5 and Haiku 4.5 ids are in
  `policy/models.json`.
- Licences other than the kev-suites mirror are Apache-2.0 or MIT (G18).

---

## 3. Recommended order of work

1. **Today, before building the 41-port factory:** get the smoke run's `training_metrics.json` and log
   (G3); decide on `fla` (G4); run J0 with the two-parameter model, RAM and VRAM readings and the
   long-state flags; build the served scorer (G1) and measure tunnel latency.
2. Make the factory token-exact and add the determinacy, class-support and reserved-world gates (G2,
   G8, G9); fix the bed pin to an allow-list (G12). These are cheap and stop a bad build reaching the
   laptop.
3. Fix the F1 taxonomy and add the cross-family type-applicability data to X5 (G7).
4. Start **group W** in parallel with G1-G8 (G6): W0, W1, W2 and W7 first; run the 50-call hosted pilot
   (G15).
5. Run the curve with two seeds at 5K and 20K and a dev-OOD selection slice (G10, G11); calibrate on
   the serving path (G5).
6. Everything else (P1, P2) alongside.

---

## Appendix A. What I ran (revision 2)

Commands were read-only except scratchpad outputs. Scripts are in the session scratchpad
(`.../scratchpad/crit-cov2/`, not committed).

- Read the whole of `JUDGE-PROGRAM.md`, the inventory headings and shortlist, `src/judgment.mjs`,
  `src/ports.mjs`, `bridge/laptop/{jobs,config}.mjs`, `bridge/PROTOCOL.md`, `LAPTOP-HANDOFF.md`,
  `docs/laptop-agent-kickoff.md`, ROADMAP §2.4, §4.1, §5.4, §6, THESIS §7, and Kev's `train.py`,
  `benchmark.py`, `data.py`, `model.py`, `checkpoint.py`, `suite.py`, `predictors.py`, `serve.py`.
- `cover.mjs`: recomputed 46 + 18 + 36 = 100 and 41 ports from the inventory and the program tables.
- `jspec-contract.mjs` (earlier pass, re-run): 13 job-spec variants through the bridge validators and
  the real Kev argparse.
- `overflow.py`: 35 samples (`tok-samples.jsonl`, from the earlier pass) through `fits()` at the
  benchmark context and at `training_context(8192)`. `toy-tokens.py`: 151 forward tokens per smoke
  record. `hdr.py`: Qwen3.5-0.8B parameter split from the safetensors header (text 773M, visual 101M).
- `truth.mjs`, `truth2.mjs`, `modes.mjs`, `bad.mjs`: bed exports and truth fields on dev seeds only.
- `i2det.mjs`, `inc-ambig.mjs`, `inc-tags.mjs`: I2 tag inventory and skeleton collisions on 300 dev
  worlds (seeds 1-150, d4-d5).
- `journal.mjs`, `cost.mjs`: read-only SQLite reads of the experiment journals (model, cost, tokens,
  latency, run and prompt counts).
- `emb-test.py`: bge-small CPU timing. This downloaded the model into the shared `/opt/hf-cache`; I
  removed that directory afterwards, so the cache is as I found it.
- HF API GETs: licences, revisions and parameter counts for `kev-suites`, `kev-0.8b`,
  `deepset/prompt-injections`, Qwen3.5-0.8B-Base, bge-small and MiniLM.
- Not re-run from the earlier pass: per-world generation timing (`timing.mjs`).
- **Disclosure.** While checking whether a directory-wide bed hash would reach it, I listed the file
  names inside `beds/sealed/` (a manifest, a loader and three `.sealed` files). I opened none of
  them. Nothing sealed was read or used.
- One git-ignored bytecode cache in the Kev clone may have been refreshed by imports; `git status`
  there is clean. Nothing was committed or pushed.
