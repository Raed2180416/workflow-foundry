# Critique of the Kev judge program: coverage and feasibility (2026-10-07)

*Development/diagnostic review. Target: [JUDGE-PROGRAM.md](JUDGE-PROGRAM.md) (1,994 lines, written
17:43Z). Nothing was trained, served, sent to a hosted model or committed. No sealed bed was read and
no bed `test` split was generated. Companions: [01-kev-dossier.md](01-kev-dossier.md),
[02-decision-inventory.md](02-decision-inventory.md), [probe-summary.json](probe-summary.json)
(rule arm only; `03-probe-results.md` is still a placeholder, so no stock-Kev numbers exist yet).*

**Evidence tags.** **[M here]** measured or executed in this review (commands in Appendix A).
**[D]** read in a file, with path and line (`kev:` = `/home/user/jaredpalmer/kev` at `5e42a7a`,
`fdy:` = this repository). **[E]** estimate, with the arithmetic.

---

## 0. Verdict

The program's accounting is sound and its label sources are real. Its two weakest layers are the
ones the owner is worried about: whether the data and the laptop plan are *robust*, and whether any
judge can actually *reach a workflow*.

1. **Coverage accounting holds.** 41 ports (the text says 40) map or exclude all 100 inventory
   decisions: 46 mapped + 18 deferred + 36 excluded = 100, recomputed from §1.3–1.5 [M here].
   Each exclusion I could check against bed code holds (section 2.1).
2. **Label sources exist** in every bed named (section 2.2), with six concrete problems (G7, G8, G13,
   G14 below).
3. **Job specs are correct.** All 13 spec variants (J0a, J0b, J1, J2, J3, five grid configs, two
   long-state variants) pass the bridge validator *and* the real `kev.train` / `kev.benchmark`
   argparse at the pinned commit [M here, section 2.7].
4. **Not robust yet, in order of damage:**
   - the state-size budgets are in bytes/4 and are wrong by about **2x** for logs, tables and ids
     (G1);
   - the laptop schedule rests on one ambiguous number, ignores host RAM, the missing DeltaNet
     kernels, none-pair inflation and the 24 GPU-hour cap (G2, G3);
   - calibration is fitted on a different numeric path than the one that serves (G4);
   - **nothing in the build plan makes a judge usable in a workflow**, and the C4 end-to-end checks
     have no owner (G5);
   - the failure-class port is not the THESIS port, and the THESIS's motivating failure (wrong-type
     reuse, 0/21) is not in the X5 data (G6);
   - some real-trace worlds sit inside the training seed range (G7).
5. **Answer to "is 5K sufficient?"** The program's measured-curve design is the right instrument, and
   its prior (5K is a smoke test for the hard ports) is consistent with Kev's own docs (no gain at 400
   records, +5.9 pp at 1,050 on a 4B model [D `kev:skills/kev-finetune/README.md:46-50`]). But
   "25 min for 5K" is the best case, not the plan: with replay, none-pair siblings and real token
   counts, plan **45-90 min for the 5K point** until J0 says otherwise (G2). And the sufficiency rule
   cannot certify "5K is enough" at its own sample sizes (G11).

---

## 1. Prioritised gaps and fixes

Severity: **P0** invalidates a number, a schedule or the stated goal; **P1** weakens a claim or wastes
laptop nights; **P2** hygiene. Each fix names a test that can fail.

### P0

| ID | Gap | Evidence | Fix | Test that can fail |
|---|---|---|---|---|
| **G1** | Every state budget is bytes/4 (`beds/lib/canonical.mjs` `estimateTokens`). Real Qwen3.5 tokens are **1.9-2.0x** that for logs, table rows and ids, and 1.05-1.2x for prose. Consequences: `maxState`, the 8,192 "validated" ceiling, the "long" variants, training time and the embedding truncation are all mis-sized. | [M here] table in section 2.3. Example: the incident 8-line state is 209 (bytes/4) vs **404** real; one service's full log is 13.0K vs **25.7K**; kinetics "10 documents" is about 6K vs **about 14K**. The program calls the ratio "unmeasured [unk]" (§1.0). | Make the exact tokenizer (`/opt/hf-cache/.../Qwen3.5-0.8B-Base@dc7cdfe2` is on this VM) the only gate. Restate every per-port typical/max in real tokens. Run Kev's own `fits(materialize(r), tok, **training_context(max_state))` on **every** record of every file, not 100 lines. Drop "whole log" and "all kinetics documents" long variants or window them to the budget. | Acceptance 6 (§10): zero records fail `fits`; token histogram per port reproduced from the tokenizer; a unit test pins the 2x ratio so a future change is visible. |
| **G2** | The training-time model is built on an ambiguous owner number and omits cost drivers. **Unit:** Kev prints `s/rec` per *record variant* (`kev:kev/train.py:638`), and the smoke file has **3 questions per record** (192 rows, mean **151 forward tokens per record**, 30-token states) [M here]. So 0.287 s is per *record*, not "per row". Implied rate 525 tokens/s: fixed overhead, not compute. **Omitted drivers:** (a) `p_none_pair 0.25` adds two sibling variants to 25% of eligible records; the release saw 30,329 records seen for 22,539 requested (+34.6%) [M here, `training_metrics.json`]; for the wave-1 mix (61% of train rows are on 3+ option ports) expect about **+30%** [E]; (b) the real-token factor (G1); (c) `fla` kernels (G3). | `kev:kev/train.py:280-302, 638`; `bridge/laptop/smoke/toy-train.jsonl` (64 x 3); release `training_metrics.json` in the HF snapshot; `none_pair_max_state` and `p_none` are not bridge parameters (the bridge rejects them [M here]). | Ask the laptop agent for the smoke run's `training_metrics.json` (`forward_tokens`, `wall_seconds`, `step_seconds`, `peak_device_bytes`, `peak_rss_bytes`) and `train.log`; that is free and exact. Fit **two parameters** (fixed s/record plus s/token) from J0 at about 300 / 2K / 8K tokens, then schedule in forward tokens. Add none-pair inflation to the row table. Shorten the 8K probe (`max_steps` 8-12): at 525 tok/s, 400 rows x 8K would take about 1.7 h, not "about 10 min for 3 jobs" [E]. | J0 report states s/record, s/token, tokens/s, kernel path and `peak_rss`; the schedule table is regenerated from them and matches the first curve point within 20%. |
| **G3** | Laptop resources: **host RAM is never mentioned** (grep: no "RAM", `peak_rss` or `row_budget` in the program). The owner states 14 GB total with about 2 GB free (WSL2 on Windows [D `docs/laptop-agent-kickoff.md` A]). The release run peaked at **10.3 GB host RSS** and 23.9 GB device (batch 4, max_state 7,552, a different machine) [M here]. VRAM: frozen fp32 backbone is about 3.2 GB of the 3.4 GB peak, leaving about 4 GB; a 6-question record at 8K tokens runs 6 rows of 8K in one pass unless `row_budget` is set [E]. **DeltaNet kernels:** `fla` and `causal-conv1d` are absent from `bridge/laptop/kev-requirements.txt` and from this VM's venv [M here]; transformers silently falls back to the torch chunk loop (`modeling_qwen3_5.py:300,639`), and Kev recommends `flash-linear-attention` 0.5.2 for Qwen3.5 on CUDA [D `kev:README.md:396`, `kev/fused_qwen35.py:53`]. Toy-length speeds say nothing about 2K-8K. | `kev-requirements.txt`; `jobs.mjs:73-80` (`row_budget`, `weights_dtype` are exposed); `LAPTOP-HANDOFF.md` T1. | J0 records `peak_rss_bytes`, `peak_device_bytes` and `free -m`; ask the owner to cap WSL memory and close apps; use `weights_dtype bf16` (not in `COMPAT_FIELDS`, so warm start still works [M here]) and `row_budget 16384` for any job with states over 2K; stop `kev.serve` before training (T1). Owner decision: install `flash-linear-attention==0.5.2` on the laptop (pure-Python wheel; Triton ships with torch) and compare J0 with and without it. | J0 passes at 8K with `peak_rss` under 80% of free RAM; no OOM-kill in `train.log`; kernel path logged per job. |
| **G4** | Calibration is fitted on a different path than serves. `kev.benchmark` loads fp32 (`LoadOptions.from_env()`, `dtype None`); `kev.serve` forces **bf16** on CUDA (`kev:kev/serve.py:327`), which Kev says moves probabilities by up to about 0.03 and flips the top answer on about 1 in 300 [D `kev:README.md:409`]. T and tau (5% / 2% budgets) are fitted on benchmark rows (§7.5) and applied to served p. A delta run also serves at **T = 1.0** (`Meta.temperature` defaults to 1.0 and `warm_start` does not copy the init's 2.351 [M here, `kev:kev/checkpoint.py:61,318-331`]); the program lists this as [unk]. The program's "stock 8008 / candidate 8009" plan (§7.6) is **impossible**: the bridge refuses a second `kev.serve` (409 `service_exists`) [D `bridge/laptop/jobs.mjs:497`]. Training and serving are mutually exclusive on 8 GB (T1). | As cited. | Fit T and tau on rows read **through the serving path** (a served replay of calib and dev-select), or pin the same dtype on both sides with bridge `env: {KEV_DTYPE: "fp32"}` (the job env passes `KEV_*` [D `jobs.mjs:258`]). Record dtype, backend and fla status in every ledger row. Sequence stock and candidate serving; never concurrent. Replace "[unk]" with the code reading above. | A served-path replay of 300 dev-select rows per port differs from the benchmark rows by under 0.01 in mean max-p and 0 argmax flips beyond 0.5%, or the port is flagged. |
| **G5** | **No build group delivers the wiring.** §8.4 lists five Foundry changes "not made by this program document"; G0-G9 (§10) build data, baselines and analysis only. Verified: the node-kind enum has no `judge` (`schemas/workflow.schema.json:99`: task, assert, human, map, loop, wait, agent, code, verify); nothing in `src/` constructs a `JudgmentPort`; neither the micro-harness skill nor the construction design mentions Kev or judge nodes (grep, no hits). So builders cannot author a judge node, runs cannot replay one, and a port cannot reach production. Also missing: (i) a **port kit** per port, shipping the state builder and slot filler the data factory uses, so train and serve cannot diverge (R1's `source_note` is "the system's paragraph plus any it names"; X5's state is "paragraphs chosen by code": a deployed workflow must rebuild exactly that); (ii) behaviour when the tunnel or laptop is down (the CPU fallback takes 26 s at 566 tokens [D §7.6], so it is not a fallback); (iii) judge-node journaling for deterministic replay without the laptop; (iv) what a non-port enum (inventory A0, the generic case) does: it must not gate. The C4 end-to-end checks (§8.3) are unowned and depend on all of this; the X8 test uses 30 tasks per arm, too few to see a Haiku-vs-gated-Haiku difference, and a wrong-reuse bound of 2% needs at least **150** opportunities with zero errors (rule of three). | §8.2, §8.4, §10; `schemas/workflow.schema.json`; `src/ports.mjs:78` (one question per request). | Add **G10 wiring** with these packages and tests: W1 `judge` node (schema, validator, runtime executor, journal record and replay, adapters reject); W2 `src/judges/<port>.mjs` port kits imported by *both* the factory and the runtime; W3 router (Kev, Haiku, Sonnet, terminal route) with `onUnavailable`; W4 ledger content store and oracle label join; W5 policy entries (`systemone` provider, run id, imputed cost); W6 micro-harness operator text and a port catalogue with `gating` / `advisory`; W7 E2E harness for the X8 cascade (at least 100 tasks per arm, or report the CI and stop short of a verdict) and the X5 gate (at least 150 non-matching tasks). Schedule W7 right after the first curve point: AGENTS.md says every phase must produce a capability number. | W1: replaying a journaled run makes 0 network calls and reproduces the output; W2: for 200 bed tasks per port, `buildState(task)` equals the training state byte for byte; W3: injected tunnel failure yields a journaled escalation to Haiku, never a silent default; W6: a validator rejects a `gating` judge bound to an `advisory` port. |
| **G6** | **The two named C4 ports do not match the THESIS.** (a) **F1** has options flake / env / model_output / budget / defect / finding. THESIS §7 and ROADMAP §2.6 define the failure-class port as **flake / variance / defect / env / impossible / finding**, and the healer's checks (replay, resample K=8 for variance, control build, unsatisfiable contract) depend on `variance` and `impossible`. The program silently drops two and adds two, and maps inventory C1 to F1 as if equal. The probe also used 5 classes. (b) **X5** trains parametric conventions inside a family ("ATLAS dates are dmy"). The failure that motivated C4 is **wrong-type reuse (0/21, all false successes)** [D `docs/RESEARCH.md` ledger row 2; `docs/THESIS.md:205-207`]: a procedure for one *kind* of task applied to another. The nearest port, C9 `same_task_family`, is wave 3 and "expected to lose to kNN". | `docs/THESIS.md:213-216`, `docs/ROADMAP.md:421-434`; §1.2 F1, X5, C9. | (a) Either adopt the THESIS taxonomy (add `variance`, `impossible`; label them from the resample-K harness and from unsatisfiable contracts) or record an owner-approved amendment and keep both label sets. (b) Add a **cross-family type-applicability family to X5**: assumption = the bed family's task statement (`family.description`, README), state = another bed's prompt and inputs head; labels by construction (same family `holds`, other family `violated`, unrelated paragraph `not_stated`). It is cheap, label-exact and needs no tap. Move it into wave 1; keep C9 as a comparison. Evaluate it on bed pairs held out of training. | Leave-one-family-out accuracy of the type-applicability family above the embedding baseline with CI > 0; false-accept rate at epsilon 2% reported on the 0/21-style cross-type cases. |
| **G7** | **Reserved-seed leakage.** The only real-trace X8 data (`records-hand-pilot`) are tasks `records:dev:d2:s101..s103` and `records:dev:d3:s101..s102` [M here, `results.jsonl`]. They sit inside the training seed range 1-3999 (§3.1), and the same world's notes sentences would be in X8-records and R1-R4 training. The span registry (§3.4) guards held-out *families* and exact spans, not worlds. The same applies to the `calibration`, `distill-pilot` and `c0-smoke` journals and the probe's dev seeds 1-400 if any of their numbers are reused as references. | `experiments/runs/records-hand-pilot/results.jsonl`; §3.1, §3.4, §3.5. | Add a **reserved-world registry**: every (bed, split, difficulty, seed) already used as evaluation, real trace or probe is excluded from every training file, enforced in `build.mjs`. | Acceptance 3: zero reserved worlds in any train or calib file; a deliberate injection of seed 101 into train fails the build. |

### P1

| ID | Gap | Evidence | Fix | Test |
|---|---|---|---|---|
| **G8** | **I2 label determinacy and tag coverage.** The tag table omits `renew` (69 lines in 90 worlds) and `consequence` (57); with the fail-closed rule the build would stop, or lines would be silently classed `unrelated`. More important, a one-line state `{line, emitting_service, calls}` cannot separate an `onset` line from an onset-like `blip-*` line: the bed deliberately emits `C.BLIP_ONSET[klass]` text (`blipOnset` 0.85 at d4-5, `gen.mjs:791-836`). At digit- and name-masked skeleton level, **209 of 3,317 (6.3%)** origin skeletons also occur under unrelated tags, 97 of them blip tags (e.g. `I: heap after gc <N>% (pause <N>ms)` is tagged onset, root, baseline and three blip tags) [M here, dev seeds 1-150 x d4-5]. Whether the numbers disambiguate is unmeasured. The program has no state-to-label determinacy audit for any port. | [M here] `inc-ambig`, `inc-tags`; tags seen: bg baseline lookalike chronic blip-same benign sporadic noise blip-root blip-other renew decoy deploy mention onset root dep soft consequence precursor mislead inject. | Classify `renew` (`unrelated`) and `consequence` (decide: it is a downstream effect, not an origin or relay). Add the time context (seconds since window start, or first-error time) to the I2 state, or drop blip tags from I2. Add an acceptance test for **every** port: group by masked state; the share of states with two labels must be under 1% (or the port is flagged "label not determined by state", as A28 was). | Determinacy audit passes per port or the port is demoted. |
| **G9** | **Selection reads in-family data; promotion reads OOD data.** Config choice (§7.3) is on dev-select (seeds 4500-4999, same templates as train). Gates 6.1-6.10 are on held-out templates, paraphrases and families. Selecting by in-family NLL favours the memorising config (ep2, lr4). | §3.1, §7.3, §8.1. | Give selection its own **dev-OOD** slice (a disjoint part of G0b's pool and a second held-out template index) that is not part of the final gate; seal the test-OOD pool. | The selected config's dev-OOD macro NLL is reported next to dev-select NLL. |
| **G10** | **Gridquest Q1 label procedure hits a lifetime cap.** `createEnv(task)` stops executing actions after `lifetimeActions` (default: the task budget), and restore does not refund them [D `beds/gridquest/index.mjs:166-180`]. Probing 4 directions x up to 8 rooms by step/restore exhausts it. | Same file; `_internal = { world, LEVELS }` at line 293 gives oracle-side access. | Use `createEnv(task, { lifetimeActions: Infinity })` (the file says a harness must say so explicitly, and log it), or read `_internal.world(task).w.edges` directly. | Q1 labels agree between the two methods on 200 rooms. |
| **G11** | **The sufficiency rule has low power, one seed, and the wrong sample for epsilon = 2%.** "acc(20K) - acc(5K) 95% upper bound under 2 pp" at n = 500 paired items needs about 5-6% discordance to even allow a 0 pp point estimate to pass (SE about 1.1 pp, one-sided bound about 1.8 pp); a +0.5 pp point estimate fails. Each curve point is one training seed. X5's budget of 2% with 400 calib rows leaves about 5 accepted errors for tau, which is noise; stable estimation of a 2% risk needs about 540 *accepted* rows [E: n = (1-p)/(0.09p)], so about 900 calib rows at 60% coverage. | §4.3, §4.4, §6.4. | Raise per-axis n to at least 1,000 for the 5K-vs-20K comparison, or widen the margin to 3 pp and say so; train **two seeds** at 5K and 20K; make X5 calib and test at least 1,000. | Pre-registration records the minimum detectable difference for each port. |
| **G12** | **Held-out pools and the bed pin are not protected.** `experiments/kev-data/heldout/` lives in the same working tree as G9's rule authors and G1-G8; "never imported" is not "never read". Other agents are editing the beds right now (`git status`: `beds/incident/{catalog,gen,index}.mjs` modified; the line numbers in §1.2 already drifted by 1 to 17 lines). The pin by sha256 and `VERSION` constants detects drift; it does not stop the test sets changing between nights 1 and 3. | `git status` [M here]; §2.1. | Author G0b's pools to an ignored location (`.foundry/kev-data/heldout/`), commit only their sha256 until after the freeze, and tell G9 explicitly not to read it. Build from a **frozen copy** of the beds (`git archive` of the pinned commit plus the working-tree diff hash), not live imports. Cite functions, not line numbers. | Two builds on different nights are byte-identical; a bed edit between them is refused. |
| **G13** | **Build-plan independence.** The groups are not independent as written: G0a is the critical path (all 41 contracts, lib, build, export, acceptance harness and LLM pools in "under an hour"); G0b needs G0a's contracts; G1-G8 import `lib/*` and `spec/ports.json`; G9 tunes rules and runs baselines on G1-G8 output; six cross-bed ports (X1, X2, X4, X5, X7, X8) are assembled from 3-7 groups with no assembling owner except `build.mjs`; G7's exec-injected F1 family depends on a runtime that other agents are changing; **S2 (wave 1) needs the synth value-sentence tap** (§2.6 lists it) but the tap-risk fallback (§11) and the G3 cut line name only X3, S1, X7. Acceptance tests (§10) are global; per-group criteria are absent. | §2.6, §10, §11. | Make the DAG explicit (G0a contracts and lib first, then G0b and G1-G8 in parallel against a frozen interface stub, then G9 and assembly). Add per-group acceptance: rows per port at or above the target, label balance within 1:3, determinacy audit, real-token fits, second-code-path label agreement at least 99.5% on 200, tap alignment at least 95% on 200 worlds, leak scan, generation time. Add an S2 tap contingency. Give each cross-bed port one assembling owner. Halve G0a's scope (contracts and lib first; pools later). | Each group's test file runs alone with `node --test` and fails on a seeded defect. |
| **G14** | **Baselines.** (a) **Embedding speed:** bge-small measured **1.0-1.7 s per text** at four threads under a 1-minute load of about 15 on 4 cores [M here]; the program says 20-50 ms. A FLOP estimate gives about 70-110 ms idle in fp32 [E]; 20-50 ms needs bf16/AMX, untested. (b) **Truncation is unfair:** the embedding sees at most 512 tokens (head and tail) while Kev sees up to 8K; for X5 (2K), long variants and the I1 long state, the decisive span can be cut out, which makes Kev's margin look larger. (c) **Variable-option ports** (S1, K2, F2, Q3, Q1 in waves 2-3) have per-record option sets; a fixed-label logistic cannot answer them. (d) **`local-logit`** is the second comparator ROADMAP §2.4 names ("compare against stock Jev and `local-logit` per port") and a Phase-4 build item; absent from the program. | [M here]; `docs/ROADMAP.md:347,366,882`. | (a) Budget CPU honestly (tens of hours of shared CPU at today's load for about 60K texts) or use bf16 and a nightly slot. (b) Give the embedding arm a chunk-and-max-pool variant and report it beside the truncated one. (c) Specify option-scoring (cosine between state or question and each option text) for those ports. (d) Add a stock Qwen3.5-0.8B-Base `local-logit` arm over option-letter logits, or record why stock Kev replaces it. | The embedding arm reproduces a hand-computed kNN accuracy on 50 records. |
| **G15** | **Acceptance wording and small spec errors.** `train.log` never prints `dropped 0 of M`: the line appears only when records are dropped (`kev:kev/train.py:103-109`); accept on the *absence* of "dropped" and on `N training requests` equal to file records plus replay. The J-spec comments say outputs are `runs/<name>/`; the bridge names them `runs/<jobId>` (`jobs.mjs:419`). `jobs.mjs:56` is `:58`. `kev.benchmark` summarises only `variant == "clean"` and treats `source == "unknowable"` specially (`kev:kev/benchmark.py:98-106`): evidence-removed files need `_meta.source = "unknowable"` or their arbitrary `label` pollutes accuracy. Night plan: "3.6-7.6 h with evaluations" is the *training-only* sum from the §4.4 table (45.5K rows x 0.287 or 0.6 s); with evaluations and J0/J1 it is **5.4-10.9 h** [M here, recomputed]. | As cited. | Correct the five items above. | `bridge/test/kev-contract.test.mjs` extended with the J-specs (section 2.7). |
| **G16** | **Licences and acquisitions.** `jaredpalmer/kev-suites` is public, ungated, **no licence declared** (`license: null`, no card) [M here, HF API]. decision-v7 mixes Yelp, Amazon, IMDB, AG News, MNLI and others; its `train.jsonl` (18.7 MB, 12,576 records) is gitignored in the Kev checkout and fetched by the laptop at training time (`fetch_partition`, pinned `cc4bac80`). AGENTS.md requires URL, SHA, date, licence and outcome per import; the program plans an entry for bge-small only. Other licences checked: Kev, Qwen3.5-0.8B-Base, kev-0.8b, `deepset/prompt-injections`: Apache-2.0 [M here]. | `research/manifests/models.json` exists; §3.6, §5. | Add manifest entries for `kev-suites@cc4bac80` (licence "undeclared; sources mixed"; use: replay only, adapters not redistributed), the Kev snapshot and the deepset set. | `research/manifests` entries validate with `research/acquire.mjs`. |

### P2

| ID | Gap | Fix |
|---|---|---|
| **G17** | Port ids collide with other id spaces: port C1-C9 vs inventory C1-C9 (failure class vs objective requirements), port F1-F3 vs inventory F1-F3, port C4 vs ROADMAP claim C4, and §1.3's deferred "C4" vs port C4. §1.5 reads correctly only if the reader tracks which space is meant. | Prefix: `P:` for ports, `D:` for inventory decisions, `claim C4` for the roadmap. |
| **G18** | The catalogue holds 41 ports; §0.6 and G0a say 40. | Correct the count. |
| **G19** | `TYPE_LABELS` has 7 kinds with 22 mixed plus 7 plain labels (`beds/synth/catalog.mjs:175-183`), not "25 entries"; the exclusion of A10 Q1 and A14 still holds. | Fix the number. |
| **G20** | Forbidden-key list (§2.3 rule 2) includes `kind` and `role`, yet port states use `source_kind`, `node_kind` and `author_role`. | Say "exact key names", or rename. |
| **G21** | §3.5 and the pre-registration say "no human labels except C1 real set"; C3-C6 need "about 300 hand labels from two annotators" (§1.2). Nobody is named. | Name the annotators (owner? two agents with agreement reported?) or move C3-C6 out of the plan. |
| **G22** | Wave 2 builds data for 28 ports (G3-G8) that no night trains or evaluates; "the data is right" is untested for them. | Add one cheap check per wave-2 group: a stock-Kev J1 read on dev-select plus a 2K-row smoke fine-tune. |
| **G23** | The batch id in records specs (`D3-1000+hash%9000`) is not injective; the program labels X8 real traces "from the world regenerated from the batch id". | Use the run's task key (`records:dev:d3:s101`) from the journal instead. |

---

## 2. Check-by-check results

### 2.1 Does every inventory decision map to a port or an explicit, sound exclusion?

- **Count.** Mapped to a port: A1-A13, A15-A23, A26, A27, A29-A32, B3, B4, B6, B8, C1, C3, D1, D5, E1,
  E4, F1, F2, G1, G2, G3, G6, G7, G8 = **46**. Deferred: B2, B5, B10, C4, C5, D2, D3, D4, D6, D7, D12,
  F3-F8, H6 = **18**. Excluded or realised elsewhere: **36** (12 authority-bearing, 14 code-rule, 5
  not-a-judgment including A0, E3 and G9, 3 needs-generation, A28, H1). Total 100; every id A0-H6
  appears exactly once [M here].
- **Exclusions checked against bed code and found sound:** A28 (`beds/gridquest/README.md:199-200`:
  every true note wording also occurs as a false one); A10 Q1 and A14 (`TYPE_LABELS` names the kind;
  the table has 7 kinds, 22 mixed labels); A24 (simulator messages are enumerated in `sim.mjs`);
  A25, C8, C9, D8-D10, E5, E6, F9, F12, G5, H2 (authority-bearing); B1, B7, C6, C7, D11, E2, G4, G10,
  G11 (code rules). F10 is "authority" in the inventory but "code rule" here: harmless.
- **Mapping quality, not accounting:**
  - Inventory "high-fit" A27 (container cue) and F1 (objective requirements) are wave 2, and G1
    (corpus domain) is wave 3. The reasons are label supply and a 5-template pool (Q2), which is
    fair, but §1.1 should say it.
  - THESIS port "Verifier" (an ordered score for `verify` nodes) is deferred as B5 for lack of labels,
    yet every bed ships `referenceSolve` and `badControls` with oracle scores. States are long, so
    this is a wave-2 candidate at field or window level, not "labels scarce".
  - THESIS port "Choice" (candidate propensity) is deferred correctly (needs the Phase-5 library).
  - Inventory A0 ("any enum agent node") is "realised by the judge node", but only the 41 contracts
    can gate; a builder-authored enum has no port, no threshold and no calibration. State the rule:
    unknown port means hosted model, never Kev-gated.

### 2.2 Do the label sources exist? (bed code opened)

| Bed | Claim in program | Result |
|---|---|---|
| records | `buildWorld` (world.mjs:295), `w.ctx.conv {atlas,vendex,bd,mirror,window,flags[],persp{}}` (:336), `ctx.choices {orderTpl, flagTpl, mirrorTpl, reliableTpl, perspTpl, ref, reliable}`, `ctx.cutoff`, `ctx.batch` | **Exists**; `buildWorld` is also exported from `index.mjs:189`. Batch id is not injective (G23). |
| incident | `build()` returns `{task, truth}`; `truth.{root_service, fault_class, impacted_services, firstHopCallers, softEdges, degraded, noisy, services, idsByTag, linesBySvc, T, aliasDoc}` | **Exists** (line numbers drifted 1-17). `linesBySvc[svc]` also carries per-line tags directly. Tag table incomplete (G8). |
| synth | `hidden()` world with `claims[].{mode,variant,cond,condText}`, `docMap`, `entMap`, `retractions`, `errata`, `concerns`, `supersessions`, `injection` | **Exists**; modes measured, injected, predicted, quoted, as stated. S2 needs the synth tap (G13). |
| kinetics | `_internals(task).world.{traps,claims,docs,conds,bench,pilot,rawExport,meta}`, `docs[].rateUnit`, `meta.sopRev`, `conditionDescription`, `RATE_FACTOR`, pools | **Exists** and exported. K1/X3 labels need the tap, as stated. |
| runbook | `makeWorld`, `spec.{versionAmended, maxInflightAmend/Herring/Vendor, slowRetracted, ...}`, `K.{amend,herrings,retract,staleDb,tips,handover}`, `judgmentProbes` | **Exists**. `retract` is true only at d5, so X3 `retracts` has data at one difficulty only. |
| gameqa | `_internal.{caseFor, evaluateRepro, replay, decoyReports}`, `bugs[].{cls, template}` | **Exists**. |
| gridquest | `createEnv`, `snapshot`, `restore`, `_internal.world` | **Exists**, but the lifetime action cap breaks the step/restore labeller (G10). |
| codefix, ownerci | `build()` sites, `DOMAINS`, `b.herring` | **Exists** (probe already uses it); tap needed for comment-level labels. |
| kev suites | decision-v7 dev 1,204 records, transfer-v4 dev 764 | **Confirmed**: `kev.data.load_records` loads both (1,468 and 764 questions) [M here]. |

### 2.3 Do state sizes fit Kev-0.8B (8,192 tokens validated)?

Kev-0.8B was trained mostly on states of at most 384 tokens, with long ones up to 7,552 in its
document and skill stages, and is validated to 8,192 at serving [D `kev:README.md:220`]. The program
cites this correctly. The sizes are the problem. Real Qwen3.5 tokens vs bytes/4 on dev worlds
[M here, `tok-count.py`, n per row in the table]:

| State | n | bytes/4 | Qwen tokens | Ratio | Max |
|---|---|---|---|---|---|
| incident I1, 8 lines | 4 | 209 | **404** | 1.93 | 501 |
| incident I1, 40 lines | 4 | 1,141 | **2,286** | 2.00 | 2,497 |
| incident, whole log | 4 | 13,035 | **25,720** | 1.97 | 27,815 |
| incident I2, one line | 4 | 35 | 61 | 1.74 | 82 |
| records, full notes | 3 | 1,623 | 1,708 | 1.05 | 1,734 |
| records, 6 export rows | 3 | 240 | **475** | 1.98 | 523 |
| synth, one document | 8 | 114 | 133 | 1.17 | 210 |
| kinetics, one document | 6 | 717 | **1,412** | 1.97 | 1,944 |

Consequences: no wave-1 *short* state exceeds the ceiling (I1 40 lines is 2.5K; X5 at "2K" is
about 2-4K). But "all documents of the cell" for kinetics (10 documents, about 14K) and "the whole
service window" are over 8,192. The runbook triple (ticket, runbook, inventory) is 6K by bytes/4
and probably 8-10K real. Kev's silent drop (`dropped N of M`) would remove exactly the long
variants that gate 6.6 needs. See G1.

### 2.4 Is the laptop schedule realistic?

Recomputed from the program's own tables:

- Training rows with replay: 4.5K + 7K + 12K + 22K = 45.5K for the four curve points; x 0.287 s =
  **3.6 h**; x 0.6 s = **7.6 h**. These are *training only*.
- Night 1 = J0 (0.25 h) + J1 (0.5-0.75 h) + training (3.6-7.6 h) + evaluation (15-35 min x 4 =
  1.0-2.3 h) = **5.4-10.9 h**. The program says the 3.6-7.6 h figure is "with evaluations" (G15).
- Night 2 grid: five configs (lr4, pkl, brier, ep2, rp6), "at most 4 per night (5 x 1-2 h)": by its
  own numbers 5-10 h; recomputing rows (ep2 doubles, pkl adds a second pass on 30% of records, rp6
  adds 4K) gives 6.3-13.3 h of training plus 1.3-2.9 h of evaluation at 10K. At a 20K base it is
  double.
- Night 3: final candidate and J5 take 2-3 h; the conditional 40K run adds 3.4-7 h.
- **Total 12-31 GPU-hours by the program's own numbers, against a 24-hour budget**, before none-pair
  inflation (G2), long variants, thermal throttling and any retry. At the pessimistic rate the budget
  does not close.
- VRAM and RAM: G3. DeltaNet kernels: G3. Serving and training are exclusive (G4).
- Data build is not a bottleneck: 1-80 ms per world across incident, synth, kinetics, gameqa,
  gridquest and runbook under a load average of 8 [M here]; the cost is LLM pool generation and
  baselines.

### 2.5 Is the embedding baseline runnable?

Yes, with caveats. `BAAI/bge-small-en-v1.5@5c38ec7c` downloaded in 5 s (about 130 MB), loaded with
`transformers` in `/opt/kev-venv` under `python -I`, and returned 384-dimensional CLS vectors;
scikit-learn 1.9.1 is present [M here]. Licence MIT. Open items: throughput and budget, truncation
fairness, variable-option ports and `local-logit` (G14).

### 2.6 Are the Kev suites obtainable?

Public and ungated, 125 files, pinned `cc4bac80`. `decision-v7` dev (1.76 MB) and `transfer-v4` dev
(0.80 MB) are in the Kev git checkout; `decision-v7/train.jsonl` (18.7 MB, 12,576 records, 15,576
questions) is gitignored and downloaded by the laptop through `fetch_partition` during `--suite
... --replay`. No licence is declared on the mirror (G16). The decision-v7 manifest pins only the
Qwen3 0.6B and 4B bases, so `--base_revision` is required for Qwen3.5-0.8B, and the program passes it.

### 2.7 Do the job specs match `kev.train` and `kev.benchmark` exactly?

Yes. I ran each spec through the bridge's `validateParams` and `buildCommand`, then through the real
`kev.train` / `kev.benchmark` argparse (the `bridge/test/kev-contract.test.mjs` method) at the pinned
commit [M here, `jspec-contract.mjs`, no model loaded]:

| Spec | Result |
|---|---|
| J0a (maxState 8192, max_steps 50, base_revision, seed) | accepted |
| J0b (+ `shared_prefix 1`) | accepted |
| J1 (`kev.benchmark`, stock) and J3 (candidate `runs/<dir>`, rotations 3) | accepted |
| J2 (maxState 2048; suite, replay 2000, p_none_pair 0.25) and J2 at maxState 8192 | accepted |
| grid: lr4, pkl (`perm_kl 0.1`, `perm_frac 0.3`), brier (`brier_w 0.25`), ep2, rp6 | accepted |
| `weights_dtype bf16` + `row_budget 16384` (proposed for long states) | accepted |
| `perm_kl` + `row_budget` | **Kev rejects** (they conflict): do not combine for long states |
| `none_pair_max_state`, `p_none` | **bridge rejects** (not exposed), as §7.2 says |

Recipe cross-check against the v1.0 `training_config.json`: lr 2e-5, epochs 1, LoRA r16, `lora_targets
all`, head_dim 256, p_none 0.1, p_none_distract 0.12, p_distract 0.15, p_none_pair 0.25, replay 6000,
max_state 7552, batch 4 x accum 2, base_revision `dc7cdfe2`: all match the program's §7.2 and Kev's
argparse defaults [M here]. Corrections needed: G15.

### 2.8 Are the build-plan groups independent, with testable acceptance?

No, not as written (G13). Dependency table:

| Group | Hard dependency | Can start on a stub? |
|---|---|---|
| G0a | none, and everything depends on it | n/a (critical path) |
| G0b | contracts from `spec/ports.json`; hash/leak libs for the registry | yes, if the brief carries the contracts |
| G1-G8 | `spec/ports.json`, `lib/*`, export format, the §2.2 interface | against the interface only |
| G9 | exported format and G1-G8 data to tune rules and run baselines; G0b pools for OOD runs | rules can be drafted from READMEs |
| cross-bed ports | an assembling owner and `build.mjs` caps | needs integration tests |

The global acceptance tests in §10 are good and testable (determinism, split hygiene, leakage scan,
Kev format). They are missing per-group criteria, a label-determinacy audit, the real-token fit check
over whole files, and the reserved-world check (G7, G8, G1, G13).

### 2.9 Wiring and the C4 claim

- **Wiring:** designed in §8.2 and §8.4, built by nobody (G5). The deployed path also depends on the
  laptop being up, the single-service limit (G4) and the ledger storing request content, which it
  does not today (`src/judgment.mjs:80-85`, `requestHash` only).
- **C4 as written** (`docs/ROADMAP.md:643`): Jev-gated applicability, drift and failure-class
  decisions are calibrated and beat code and embedding baselines; metrics: Brier, false
  accepts/abstains, downstream wrong-reuse; falsifier: a port that does not beat its baseline stays
  advisory. The program honours the falsifier, the Brier gate (6.2) and the false-accept/abstain
  family (6.4), and states that downstream wrong-reuse and sealed families are out of reach. That is
  honest. Three adjustments:
  1. The pre-registered **primary** metric is accuracy (§9); the roadmap's is Brier and false
     accepts/abstains. For a gate, selective accuracy matters more than top-1: make Brier and
     coverage at epsilon co-primary.
  2. The X5 and F1 definitions must match the THESIS (G6); otherwise C4 is tested on different
     decisions from the ones named.
  3. A staged test ladder removes the ambiguity about what each result supports:
     - **T1** offline per-port gates on generator labels (the program's plan): *development
       evidence*;
     - **T2** the wired E2E checks, powered as in G5: *development evidence for the mechanism*;
     - **T3** claim-bearing: on ledger rows from judge nodes in C0, C3 and C2 experiments, at least
       300 oracle-labelled rows per port (the program's own trigger), with the sealed-family result
       left to the sealed-bed owner. Say that T1 cannot support the C4 sentence by itself.

### 2.10 What holds up (so it is not re-checked)

- All 100 decisions are accounted for; the wave-1 set and band assumptions are internally
  consistent (8 hard x 1.5 + 2 medium + 3 capacity x 0.5 = 15.5; table rows recompute).
- Truth fields named in the beds exist (2.2); generation is fast and deterministic.
- J-specs are exactly accepted by the real parsers (2.7).
- The release recipe, base revision, Kev commit and weight pins in §7.1-7.2 match the snapshot.
- Splits, seed ranges, the span registry and the held-out-family tables are coherent and the
  program says plainly that in-family numbers are recall.
- Cost figures recompute ($26-78 Haiku, $8-23 Sonnet, below the $500 pause line in
  `policy/models.json`); Opus 5.5, Sonnet 5.5 and Haiku 4.5 ids are in the policy file.
- Licences: Kev, Qwen3.5-0.8B-Base, kev-0.8b and `deepset/prompt-injections` are Apache-2.0; bge-small
  is MIT [M here].

---

## 3. Recommended order of work

1. **Today, before building the 41-port factory:** get the smoke run's `training_metrics.json` and
   log (G2); decide on `fla` (G3); run J0 with the fitted two-parameter model, RAM and VRAM
   readings, and the long-state flags.
2. Make the factory token-exact and add the determinacy and reserved-world gates (G1, G7, G8). These
   are cheap and prevent a bad build from reaching the laptop.
3. Fix the F1 taxonomy and add the cross-family type-applicability data to X5 (G6).
4. Start **G10 wiring** in parallel with G1-G8 (G5); build W1-W3 and W7 first.
5. Run the curve with two seeds at 5K and 20K and a dev-OOD selection slice (G9, G11); calibrate on
   the serving path (G4).
6. Everything else (P1/P2) alongside.

---

## Appendix A. What I ran

All commands were read-only except downloads into the session scratchpad. Scripts are in the session
scratchpad (not committed). One git-ignored bytecode cache file in the Kev clone,
`kev/__pycache__/data.cpython-313.pyc`, was refreshed by importing `kev.data`; `git status` there is
clean.

- Counted the program's tables and recomputed the 46 / 18 / 36 split against the inventory.
- Read `bridge/laptop/jobs.mjs`, `PROTOCOL.md`, `LAPTOP-HANDOFF.md`, `docs/laptop-agent-kickoff.md`,
  `bridge/test/kev-contract.test.mjs`; read `kev/train.py`, `benchmark.py`, `checkpoint.py`, `data.py`,
  `model.py`, `serve.py`, `suite.py`, `calibrate.py`; read the v1.0 snapshot `training_config.json`
  and `training_metrics.json`.
- `jspec-contract.mjs`: 13 job specs through the bridge validator and the real Kev argparse.
- `tok-samples.mjs` plus `tok-count.py`: real Qwen3.5 token counts vs bytes/4 on dev worlds of
  incident, records, synth and kinetics.
- `toy-tokens.py`: forward tokens of the 64 smoke records (151 per record, 3 questions each).
- `inc-tags.mjs`, `inc-ambig.mjs`: incident tag inventory (90 worlds) and onset-vs-blip skeleton
  collisions (dev seeds 1-150 x d4-5).
- `truth-keys.mjs`: truth field names for kinetics, synth, runbook, gameqa, codefix.
- `timing.mjs`: generation time per world for six beds.
- `emb-test.py`: bge-small download (5 s), load, CPU timing under load.
- `kev.data.load_records` on `decision-v7` and `transfer-v4` development files.
- HF API: licences and sizes of `kev-suites`, `deepset/prompt-injections`, `kev-0.8b`, Qwen3.5.
- `results.jsonl` task keys for every experiment run (real-trace seeds).
