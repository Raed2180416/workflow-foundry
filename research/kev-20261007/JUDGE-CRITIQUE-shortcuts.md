# Critique of the Kev judge program: will it learn the skill or the generator? (2026-10-07)

*Adversarial development review. Target: [JUDGE-PROGRAM.md](JUDGE-PROGRAM.md) (1,994 lines). Companion
to [JUDGE-CRITIQUE-coverage.md](JUDGE-CRITIQUE-coverage.md), which covers coverage, feasibility and wiring.
This review covers one question only: would a Kev-0.8B fine-tuned on these datasets learn the decision
(the skill), or the bed generators' templates, word lists, formats and priors (the generator)? And
could the program's evaluation tell the two apart?*

*Nothing was trained, served, sent to a hosted model or committed. I did not read sealed beds. I did not
generate any bed `test` split (seeds ≥ 5000). Every check uses dev seeds. Dev seeds 4500–4999 stand
in for test seeds. That is valid for template questions, because the split is only RNG salt
(`beds/CONTRACT.md`) and both splits draw from the same template pools. Scripts are in the session
scratchpad (Appendix A).*

**Evidence tags.**
- **[M here]**: measured in this review.
- **[D]**: read in a file, with path and line. `JP:` = JUDGE-PROGRAM.md.
- **[E]**: estimate, with the arithmetic.
- **[I]**: inference, with the reasoning.

**Limits of the shortcut probe.** It is a plain-JS bag-of-words logistic regression over unigrams and
bigrams, trained on a few thousand rows. It sets a **lower bound** on how far shortcuts go: a 0.8B
transformer can also use word order, formats, position and co-occurrence. When this probe does well,
the data is shortcut-solvable. When it does poorly, that proves nothing about Kev.

---

## 0. Verdict

The program already admits that test-in-family measures recall ("Only held-out templates, held-out
paraphrases, held-out families and real traces can show robustness", `JP:47-49`). It rests all its
claims on those held-out axes. As specified, the axes cannot carry that weight. Six reasons:

1. **The held-out-template axes are a handful of sentences.**
   - The §3.3 holdouts give the R ports only **6, 4, 8 and 7** distinct held-out label-bearing forms
     (R1–R4) [M here]. The "500 per axis" items are hundreds of copies of those few sentences.
   - On one R3 test set the probe scores 0.621. Clustered by world, as the program specifies, the 95% CI
     is [0.58, 0.66]. Clustered by form, it is **[0.35, 0.90]** [M here].
   - At that precision no gate in §6 or §8.1 means anything.
2. **The held-out templates leak into training.**
   - Records share one paragraph across R1–R4 and X5 (`JP:1217`). Templates are rejected per port.
   - So **100%** of R2 and R3 held-out test sentences, 63% of R1's and 48% of R4's occur verbatim in
     training states of other questions [M here].
   - Rejecting whole worlds instead would keep only **7.5%** of worlds [M here].
3. **Several shortcuts survive template holdout.** All measured here:
   - **R4 format.** A one-line rule ("the sentence holds a date range → re-stamped") scores **1.000**,
     on held-out templates too.
   - **System name.** System alone predicts R2 at 0.65 against a 0.51 majority, and R4 at 0.66 against
     0.50. KOBO is always void and always reliable.
   - **Service name.** Root service name alone predicts the incident fault class at 0.307 against
     0.085 for the majority class.
   - **F1 history.** The F1 `history` field alone predicts the class at **1.000**. It holds the replay
     outcome, which the healer does not have when it asks.
   - **X1 keywords.** One regex catches 10 of the 11 injection forms in X1's held-out families.
4. **Calibration is fitted on near-memorised data.**
   - Calib uses the training templates. The probe gets 0.99–1.00 on R2–R4 in-family, so calib holds
     almost no errors: the minimum-NLL temperature degenerates and τ(5%) accepts everything.
   - Train is capped at 3:1 per label while calib keeps natural rates (S2: 90 / 7.7 / 1.6 / 0.5%
     [M here]). A scalar temperature cannot correct that prior shift.
5. **The unknowable and `not_stated` items are made by deleting a known sentence.**
   - The probe tells them apart from intact states at **1.000** in-family [M here].
   - On new phrasings it calls **52%** of valid statements "not stated" [M here].
   - So gate 6.7 is passed by template recognition, and training teaches "new phrasing → abstain".
6. **The curve selects on test, and the real-trace axes are too small.**
   - The curve reads test-OOD-template at every point and sets N from it (`JP:1504-1510`), against
     "Test sets are read once" (`JP:1672`).
   - The real-trace axes are 5 worlds (X8) and 3 distinct states (F1). The F1 real labels were written
     by an LLM agent, against the program's own rule (`JP:26`).

**Answer to "skill or generator?"**
- **As written:** the generator for R2–R4, F1, Q2 and much of X1. The program would probably *see*
  memorisation (its transfer-gap flag, 6.5), but it could not *certify* skill on any port. Its gates
  are too noisy at these unit counts, so a promotion would be a coin flip and a rejection would not
  separate "no skill" from "no power".
- **With the fixes in §2 and the audit in §4:** it can certify skill. The main fixes are form-level
  units, span-level holdout across ports, counterfactual twins, partial-input baselines, a
  surface-disjoint calib slice, presence-matched unknowables, and real-trace minimums.

---

## 1. Quick checks run

Probe = bag-of-words logistic regression (§0 above). Train/test splits are by seed. Accuracies are on
the test side.

| # | Data | Check | Result | Reading |
|---|---|---|---|---|
| Q1 | R1–R4 built to §1.2's state `{system, source_note}` (paragraph plus named paragraphs); records dev seeds 1–1600 (train) and 4500–4999 (test); d3:d4:d5 = 2:1:1; 17,600 + 5,500 rows | probe on the full state, in-family | R1 **0.885**, R2 **0.994**, R3 **0.999**, R4 **1.000** | In-family is solved by words, as the program says |
| Q2 | same | probe trained on non-held-out templates, tested on §3.3 held-out templates | R1 0.697, R2 0.716, R3 0.621, R4 0.651 | The template holdout does hurt the probe. But see Q3 |
| Q3 | same | distinct held-out forms; accuracy per form; form-clustered bootstrap | forms **6 / 4 / 8 / 7**; per-form accuracy is bimodal (0.00–1.00); 95% CIs R1 [0.32, 0.95], R2 [0.53, 0.88], R3 [0.35, 0.90], R4 [0.25, 0.91] | The axis measures a few sentences, not a skill |
| Q4 | same | held-out test sentence found verbatim in any training state (other ports' records of the same paragraph) | R1 0.63, **R2 1.00, R3 1.00**, R4 0.48; 25–31% of each port's training states hold some held-out sentence | Template holdout leaks across ports |
| Q5 | same | worlds left if any world with a held-out template in any R port is rejected | **120 of 1,600 (7.5%)** | Wholesale rejection is not an option |
| Q6 | same | R4 rule: the decisive sentence contains a date range → `restamped` | **1.000** on all test items and on held-out templates | A format shortcut that template holdout cannot catch |
| Q7 | same | label by system (train and test pooled; system-only accuracy on test) | R2: KOBO void **822/822**, system-only **0.65** (majority 0.51). R4: KOBO reliable **683/683**, system-only **0.66** (0.50). R3: `opposite` 60% (the bed forces at least one `pay`) | System-name priors |
| Q8 | same | probe on the state with the decisive sentence removed (context only) | R1 0.55, R2 0.565, R3 0.48, R4 **0.647** | The label leaks partly from context that is not the evidence |
| Q9 | R1 paragraphs | "stated" (intact) against "not stated" (decisive sentence deleted) | in-family **1.000**; held-out-template stated items **0.483** (52% called "not stated") | The deletion construction teaches template detection |
| Q10 | R1 | items whose label needs world knowledge (team city, server country) | **12.4%**; city lists are 30 US and 30 EU names, fixed (`beds/records/render.mjs` `TEAM_CITIES`) | Labelled hard, yet "abstention is expected" (`JP:245-246`) |
| Q11 | R1–R4 | records whose state contains more than one system paragraph | R1 6.7%, R2 2.1%, R3 2.3%, R4 0% | The `{system}` slot is redundant in ≥ 93% of rows; slot binding is barely trained |
| Q12 | R1–R4 | option-description word overlap as a rule | 0.30–0.59 | Not a shortcut. The bed builds counter-keywords |
| Q13 | probe `injection` (X1 proxy; 200 items, dev 1–400) | probe in-family; leave-one-family-out | 0.87; records 0.60, incident 0.76, synth 0.66. Top features are benign-memo strings ("key account, quarterly review" → no) | Negatives come from fixed small pools (12 benign, 10 decoy memos) |
| Q14 | bed pools | regex for addressee words (AI, AUTOMATED, ASSISTANT, SYSTEM:, bot, override, …) on X1's held-out-family positives (kinetics 5, gridquest 6) | **10 of 11** (recall only; precision on those families' negatives not measured) | X1's family-OOD axis is mostly a keyword test |
| Q15 | probe `failure-class` (F1 proxy; 200 synthetic + 9 real) | probe; probe without `error_code`; `history` only; `error_code` only; template-cluster holdout; real slice | 1.000; 1.000; **1.000**; 0.71; 0.60; real **1 of 9** | `history` decides the class. The templates do not transfer to real failures |
| Q16 | probe `incident-class` (I1 proxy; 144 items) | probe; digits masked | 0.903; 0.958 | Class vocabulary is lexical (expected for I1) |
| Q17 | incident dev 1–1200 (train), 4500–4899 (test) | root service name → fault class | **0.307** against 0.085 majority (9 classes, chance 0.11) | Entity-name prior in I1 and I3 states |
| Q18 | probe `applicability` (X5 proxy) | probe on state only; probe on state × assumed order | 0.500; 0.713 (80 training items) | Polarity pairing defeats state-only priors (good) |
| Q19 | synth dev 1–240, d3–d5; 15,065 claims | claim mode by document kind | measured 90.1%, quoted 7.7%, predicted 1.6%, injection 0.5%. **868 press-release claims (5.8%) have mode `measured`** | S2 prior shift; label-definition mismatch (§4) |
| Q20 | `experiments/runs/records-hand-pilot` | real-trace units | 121 Haiku calls in 12 runs on **5 worlds** (d2 s101–s103, d3 s101–s102), all inside train seeds 1–3999 | X8 real axis = 5 clusters |
| Q21 | simulation | ECE of a **perfectly calibrated** binary model; pass rates of the gates | ECE > 0.05 with probability 0.63–0.91 at n = 60, 0.35–0.77 at n = 100, 0.08–0.39 at n = 200, ≤ 0.01 at n = 500. The sufficiency rule passes a true-zero gain only 31–72% of the time at n = 500 | Gates on small axes are noise |

---

## 2. Findings

Severity:
- **P0** invalidates a claim the program intends to make.
- **P1** lets a shortcut through or wastes the laptop budget.
- **P2** hygiene.

Each finding quotes the program, gives the evidence, a fix, and a test that can fail. Where
JUDGE-CRITIQUE-coverage.md already covers a point (its G-numbers), this file only adds to it.

### P0

**S1. The held-out-template axis is pseudo-replicated, and the CI unit is wrong.**
- **Program:**
  - "Why 500 per test axis. It detects +5 pp at 80% power … Test records allow at most 1 question per
    port per world, so clustering does not inflate n" (`JP:1492-1494`).
  - "CIs come from a paired world-clustered bootstrap" (`JP:1596-1597`).
  - §3.3 holds out one index per pool: R2 "6 and 7", R3 "3", R4 "4 and 4" (`JP:1348-1353`).
- **Evidence:**
  - The held-out sentences are the generalisation unit, and there are 6, 4, 8 and 7 of them (Q3).
  - Per-form probe accuracy is bimodal: R3's 8 forms score 1.00, 0.13, 0.95, 0.78, 0.24, 1.00, 1.00
    and 0.00.
  - The world-clustered CI on 493 items is ±4 pp; the form-clustered CI is ±27 pp.
  - With per-form SD of about 0.35, half-widths are ±24 pp at 8 forms, ±9 pp at 60 forms (G0b's
    minimum of 30 lines per label, binary port) and ±3.4 pp at 400 forms [M here, simulation].
  - Gate 8.1 needs the paired CI to exclude 0, and the curve rule needs a 2 pp bound. Neither can be
    met at fewer than about 400 independent forms. Every R port therefore fails for lack of power, or
    passes by luck.
- **Fix:**
  - Make the surface form the resampling unit. Use a two-way bootstrap over form × world, or
    form-level means.
  - Pre-register a minimum of **30 independent forms per label** for an axis to gate. Below that the
    axis is "diagnostic: n_forms = k".
  - Grow the forms with the G0b pool and with counterfactual re-rendering (S3).
  - Report per-form accuracy as a strip plot next to every axis number.
  - The skeleton holdout's "not measurable … fewer than 5 skeleton clusters per label"
    (`JP:1365-1367`) should read 30.
- **Test:** `analyze.mjs` refuses to emit a gate verdict for an axis with fewer than 30 forms per label.
  On the R3 probe output it reproduces CI [0.35, 0.90].

**S2. Held-out templates reach training through shared states and other ports.**
- **Program:**
  - "Worlds whose label-bearing sentence uses a held-out template are rejected in train, calib and
    dev" (`JP:1358-1359`).
  - "records paragraph: R1–R4 and X5" (`JP:1217`).
  - X5 records kinds are "date order, status meaning, sign and re-stamp, from w.ctx.conv" (`JP:828`).
  - X8's `conventions` is "the system's relevant note sentences" (`JP:891-892`).
  - G0a "paraphrases each label-bearing template of a template-bound port" (`JP:1259`). Held-out
    templates are not excluded.
- **Evidence:**
  - If "label-bearing sentence" is read per port, other questions about the same paragraph carry the
    held-out sentence into training (Q4: 100% of R2 and R3 held-out test sentences occur verbatim in
    training states).
  - Through X5 and X8, the same sentence also arrives with a label whose meaning is equivalent (X5
    `holds` for "ATLAS dates are dmy" is R1 `dmy`).
  - If it is read per world, 92.5% of worlds are lost (Q5).
  - The §3.4 span registry covers held-out *families* only.
- **Fix:**
  - Extend `heldout/ood-spans.json` to every held-out template render and every G0b line: a registry
    of span skeletons (digits, dates, names and markers masked), checked against **every** port's
    states.
  - When a training state contains a registered span, re-render that one sentence. Use a non-held-out
    template of the same pool, the same label and the same slots. The pools are exported (`ORDER_NOTE`,
    `FLAG_NOTE`, `PERSP_NOTE`, `MIRROR_NOTE`, `RELIABLE_NOTE` in `beds/records/render.mjs`), so this is
    a string substitution in the factory, not a renderer fork.
  - Exclude held-out templates from G0a's paraphrase input.
  - Report the span-overlap rate (`JP:1235-1237`) for **every** axis, not only test-in-family.
- **Test:** acceptance 2 fails if any masked held-out skeleton occurs in any train, calib or dev state.
  A planted perspTpl-3 sentence in an R1 training record must fail the build.

**S3. Shortcuts that survive template holdout: formats, system and entity priors, keywords.**
- **Program:**
  - R4 "Systems with no such sentence are excluded here" (`JP:319`). Every R4 item therefore carries
    one of two pools, and only the MIRROR pool has a date window.
  - R2 per-world sampling follows bed truth.
  - I1 state `{service, window, log_lines}` (`JP:362`).
  - X1 family holdout "kinetics, gridquest" (`JP:1375`).
- **Evidence:**
  - **R4.** The date-range rule scores 1.000 on held-out templates (Q6).
  - **R2 and R4: KOBO.** The bed never makes KOBO a live flag ("KOBO has too few rows for live flags",
    `beds/records/world.mjs` conv flags) and never a mirror (`MIRROR_SYSTEMS` excludes it). So KOBO
    means void (R2) and reliable (R4) with certainty (Q7). On R4's held-out template the probe gets
    the KOBO form right (1.00) and the other systems' forms wrong (0.00–0.13) (Q3): the prior, not
    the text, decides.
  - **R3.** The bed forces at least one `pay`, so `opposite` is 60%.
  - **R1.** `ymd` is an option but is never the label of a d ≥ 3 item. It appears only for the fixed
    KOBO and VERITAS easy items (`JP:234-235`), so `ymd` ⟺ system ∈ {KOBO, VERITAS}.
  - **I1.** Root service name predicts the class at 3× chance (Q17).
  - **X1.** Held-out-family positives carry addressee keywords (Q14). Training negatives are fixed memo
    strings the probe memorises (Q13).
- **Fix: counterfactual re-rendering in the factory, using exported pools only.**
  - R4: add reliable sentences that carry a date window ("the vendor confirmed during the {w0}–{w1}
    audit that …") and mirror sentences without one.
  - R2 and R4: render KOBO live flags and KOBO mirror sentences, and VERITAS/LEDGR counterparts, so the
    label is balanced **within each (port, system)**.
  - R1: make `ymd` reachable in d ≥ 3 items (a counterfactual year-first sentence for VENDEX), or drop
    it from R1's options for those systems and document why.
  - I1 and I3: replace service names with neutral handles (`service A`), resolved by code, in both
    training and serving states. Or keep names and balance class against name.
  - X1: authored held-out-family positives without addressee words, and negatives *with* them (benign
    "the assistant manager approved…", quoted injections). Draw benign memos from a pool at least 10×
    larger than today's 12.
- **Test:** the partial-input battery (S9) on each training build. System-only, marker-only,
  service-name-only and format-only predictors must sit within 3 pp of the majority class on every
  axis.

**S4. Calibration and thresholds are fitted on the wrong split.**
- **Program:**
  - calib = dev seeds 4000–4499, "temperature and thresholds (never training)" (`JP:1322`). Same
    templates as train.
  - "The cloud fits a global T and a per-port T by minimum NLL" (`JP:1725`).
  - "Train caps every label at 3× the rarest. Calib and test-in-family keep natural rates"
    (`JP:1239-1241`).
  - "thresholds are fit on the natural-rate calib" (`JP:1243`).
- **Evidence:**
  - **Near-zero calib errors.** In-family R2–R4 are at 0.994–1.000 for the probe (Q1); a tuned Kev
    will be no worse. With almost no calib errors, minimum-NLL T sharpens without bound and τ(5%) is
    the lowest threshold, so every answer is accepted.
  - **OOD risk then follows OOD accuracy.** At the probe's held-out-template accuracies (0.62–0.72),
    that is 28–38%. Gate 6.4 would catch this on test, so the port fails; but the fault is in the
    calibration design, not in the model.
  - **Prior shift.** S2 natural rates are 90.1 / 7.7 / 1.6 / 0.5% (Q19); the program's "about 95%" is
    one world (`JP:492`). The trained prior is capped at 3:1. The log-odds shift between `measured`
    and `instruction_like` is ln(180/3) ≈ 4.1 nats. A temperature rescales logits but cannot add a
    per-option offset.
  - **X1.** A 400-row natural-rate calib (`JP:1486`) holds about 4 positives (rate under 1%,
    `JP:731`), so τ for `yes` cannot be fitted.
- **Fix:**
  - Add a **calib-OOD** slice, surface-disjoint from train and test: a third template index per pool,
    a third of the G0b pool, and held-out paraphrase Q5. Fit T, per-option biases and τ there.
  - Keep the in-family calib only to report the in-family/OOD calibration gap.
  - Extend the Foundry-side transform (`JP:1729-1733`) from p' ∝ p^(1/T) to vector scaling: one
    T plus one bias per option, per port, fitted on calib-OOD at deployment base rates.
  - For rare-positive ports, fit on an enriched calib with importance weights back to the natural
    rate, and report the natural-rate result.
  - Fit on the serving path (coverage G4).
- **Test:** on calib-OOD, out-of-fold NLL with biases beats T-only by ≥ 1% or the biases are dropped.
  ECE on test-OOD is reported for both fits.

**S5. The unknowable and `not_stated` constructions teach template detection.**
- **Program:**
  - "Evidence removed. The decisive sentence is deleted. For X5 the label becomes `not_stated`. …
    In training such records get a soft uniform target" (`JP:1287-1292`).
  - Gate 6.7: "share of evidence-removed items answered with p ≥ 0.9 … ≤ 5%" (`JP:1609`).
  - X5 `not_stated` sources include "an assumption about a system or entity absent from the source
    text" (`JP:835-837`).
- **Evidence:**
  - Deleting a known template is detected at 1.000 by the probe (Q9).
  - Trained that way, the probe calls 52% of valid held-out-phrasing statements "not stated". A model
    that learns this abstains on new phrasings (lost coverage) and passes 6.7 in-family without any
    sense of what it does not know.
  - The "system absent from the text" source is decided by a string match on the system name.
- **Fix:**
  - **Presence-matched unknowables.** Replace the decisive sentence with a same-register sentence that
    does not settle the question: the same convention for *another* system, or a different convention
    of the same system. Never leave a gap.
  - Build both arms, stated and unknowable, from held-out templates as well as training templates.
    Report a 2×2: known/new phrasing × stated/unknowable.
  - X5: at least 50% of `not_stated` items must contain an order sentence about another system in
    the same state. Drop the absent-system source, or keep it at ≤ 10% and report it separately.
- **Test:** the probe trained on build data separates stated from unknowable at ≤ 0.65 on the
  presence-matched set. Gate 6.7 is read on held-out-phrasing unknowables.

**S6. The curve selects on test, and the sufficiency rule is underpowered.**
- **Program:**
  - "Measured per point and per port, on dev-select and on test-OOD-template" (`JP:1504`).
  - "5K is sufficient if acc(20K) − acc(5K) on test-OOD-template has a 95% upper bound < 2 pp"
    (`JP:1508-1509`).
  - "Test sets are read once, for the selected config and for stock Kev" (`JP:1672`).
- **Evidence:**
  - N, and hence the grid's base, is chosen from test-OOD-template. That axis is then reused for
    promotion.
  - Power at n = 500 paired items and a true gain of **zero**: the one-sided upper bound is below
    2 pp only 72%, 48% and 31% of the time at 4%, 8% and 15% discordance [M here, normal
    approximation]. With form clustering (S1), never.
  - Coverage G11 notes the low power; this adds the selection-on-test problem and the form unit.
- **Fix:**
  - Read the curve on a **dev-OOD** slice: its own held-out template indices, paraphrases and G0b
    lines, disjoint from both calib-OOD and test-OOD. Read test-OOD once.
  - Pre-register an equivalence margin per port (3–5 pp) with ≥ 2,000 paired items over ≥ 200 forms,
    and two training seeds at 5K and 20K.
  - Coverage G9 asked for a dev-OOD slice for config selection; the same slice serves the curve.
- **Test:** the analysis script asserts that no test-OOD file hash appears in any curve or selection
  log.

**S7. The real-trace axes are too small, inside the training seeds, and partly LLM-labelled.**
- **Program:**
  - "On every available test-OOD axis (paraphrase, template or skeleton, family, real-trace), the
    paired, world-clustered 95% CI … is above 0" (`JP:1766-1768`).
  - F1's held-out family is "REAL-TRACE journals" (`JP:1384`).
  - F1 real labels are "cause from the message, by the probe author" (`JP:1403`).
  - "No LLM ever labels a record" (`JP:26`).
- **Evidence:**
  - **F1 real:** 9 items with only 3 distinct states (three messages) (Q15).
  - **F1 labels:** git authorship of `experiments/kev-probe/datasets.mjs` is "Claude" (commits
    `cd28d4b`, `5a98209`) [M here]. The "probe author" is an LLM agent.
  - **F1 transfer:** the template-trained probe gets 1 of 9 real items right. Real states have
    `history: unknown`, and the templates rely on `history` (Q15).
  - **X8 real:** 5 worlds, 3 of them at d2, where conventions are fixed defaults (`JP:215-216`), and
    all inside train seeds 1–3999 (Q20; coverage G7).
  - A world-clustered CI over 5 clusters cannot exclude 0 unless all 5 agree.
- **Fix:**
  - Define **available**: at least 30 independent tasks and 300 rows with oracle, replay or journal
    labels. Below that, report the axis as a case study, outside 8.1.
  - Relabel F1 real from the healer's replay outcome (pass on retry → `flake`; same failure on replay
    → `defect`, and so on), or drop the 9 items.
  - For X8 real, run Haiku extraction on 30–60 reserved d3–d5 records seeds outside every training
    range (≈ $3–6 at the pilot's per-call cost, [E] 121 calls ≈ 6 per task).
  - F1's family-OOD axis is "unavailable" until journals reach the minimum. **Say that F1 cannot be
    promoted in wave 1.**
- **Test:** 8.1's evaluator lists each axis with its cluster count and refuses to count an axis under
  the minimum.

### P1

**S8. F1's state carries information from after the decision.**
- **Program:**
  - "The healer orders checks (R); replay decides" (`JP:933`).
  - Shortcut control: swap in a code "for both a flake and a defect, decided by `history`"
    (`JP:947-949`).
- **Evidence:**
  - The probe's `history` strings are replay and rerun outcomes: flake "the same test passed on rerun
    of the same build", defect "fails identically on replay with the recorded inputs"
    (`experiments/kev-probe/datasets.mjs:228-271`).
  - `history` alone predicts the class at 1.000 (Q15).
  - When the healer asks, the replay has not run.
- **Fix:**
  - A **time-of-decision audit** for every port: each state field names the event that produces it
    and must exist before the consumer asks.
  - For F1: error code, message, node kind, attempt number, and counts from earlier journaled runs of
    the same node. Never the current replay's result.
- **Test:** a field-provenance table per port in `spec/ports.json`. The F1 `history` probe is at most
  0.10 above majority on the build.

**S9. No test can show *why* the model is right.**
- **Program:** gates 6.1–6.14 (`JP:1601-1616`) measure accuracy, calibration, transfer gap, long state,
  unknowables, paraphrase, option order, injection, forgetting and latency.
- **Evidence:**
  - Nothing checks that the prediction depends on the evidence, flips when the evidence flips, or
    binds the `{system}` slot.
  - The slot is redundant in ≥ 93% of R rows (Q11).
  - The paraphrase axis has 2 wordings per port (`JP:1610`), and a model can ignore a question whose
    port is identified by its state shape and options.
- **Fix: six causal gates, cheap because the pools are exported.**
  - (a) **Counterfactual flip.** Same template index, opposite polarity, nothing else changed:
    `PERSP_NOTE[S].recv[i]` ↔ `.pay[i]`, `FLAG_NOTE.live[i]` ↔ `.void[i]`, `ORDER_NOTE[S].dmy[i]` ↔
    `.mdy[i]`. Flip rate ≥ 95%.
  - (b) **Invariance.** Swap in another template of the same label. Unchanged answers ≥ 95%.
  - (c) **Slot swap.** A state with two systems' paragraphs and opposite labels, asked about each
    system. Accuracy within 3 pp of single-system states. Train with ≥ 20% such rows.
  - (d) **Evidence dependence.** On evidence-removed twins, tuned accuracy ≤ the context-only baseline
    + 3 pp, and mean max-p falls to within 0.1 of the prior.
  - (e) **Probe-hard stratum.** Accuracy on test items the train-fitted probe gets wrong. Tuned Kev
    must beat every baseline there, not only on the whole axis.
  - (f) **Partial-input baselines** in acceptance, per port and per axis: decisive span only, context
    only, metadata only (system, marker, `source_kind`, `error_code`, service), length only, full
    probe.
- **Test:** each gate has a planted-shortcut control. A model trained on a build with KOBO priors left
  in must fail (d) on KOBO items.

**S10. Decidability is not audited. Acceptance 1(a) checks correctness against the world, not
against the state.**
- **Program:** "the label is re-derived by a second code path: R1: the world's reference parse of a
  day-≤12 date for that system matches only the labelled order" (`JP:1904-1906`). That proves the
  label is right about the world. It does not prove the state determines it.
- **Evidence (cases found):**
  - **R1:** 12.4% of items need world knowledge (Q10) and are labelled hard, against "Abstention is
    expected there" (`JP:245-246`). The 60 city names are fixed, so a model memorises them.
  - **S2:** press releases. 868 of 15,065 claims sit in press releases with mode `measured` (Q19). The
    synth README treats press releases as a separate, last-resort tier (`beds/synth/README.md:57-58`).
    The option `own_measurement` says "measured by the authors of this document". For a press release
    that is false, or at best undecidable.
  - **I2:** onset-like blip lines (coverage G8, 6.3% skeleton collisions).
  - **Q4:** "The same room name for a different room" (`JP:655`). If the observation shows only the
    name, `drifted` cannot be decided from the state.
  - **Q3:** acknowledged (`JP:628-630`).
- **Fix:** the audit in §4. It is an acceptance gate per port.
- **Test:** §4 step 1 reproduces at least 99.5% of labels from the state alone on 500 rows per port.
  Otherwise the undecidable rows are listed and removed or relabelled.

**S11. Base rates make the gates gameable.**
- **Program:**
  - "The best baseline is the strongest of rule, embedding-logistic, embedding-kNN and stock Kev"
    (`JP:1769`).
  - Tests use natural rates plus balanced copies, with thresholds from natural-rate calib
    (`JP:1242-1243`).
- **Evidence:**
  - S2 is 90% `measured` (Q19), so a constant answer beats a weak rule on natural-rate accuracy.
  - X1 is under 1% positive (`JP:731`).
  - The baseline set has no prior or majority baseline, and none of the partial-input baselines of
    S9(f).
  - Thresholds fitted at natural rates do not give the stated risk on a 1:1 copy.
- **Fix:**
  - Primary metrics on natural-rate sets: balanced accuracy or macro-F1, plus Brier skill score
    against the calib prior.
  - Read risk and coverage at τ only on natural-rate data.
  - Use balanced copies only for per-class recall, with no threshold claims.
  - Add the prior and partial-input baselines to "best baseline".
- **Test:** on S2, a constant `own_measurement` predictor fails every accuracy gate.

**S12. The forgetting check misses the failures most likely to hurt Foundry.**
- **Program:**
  - "decision-v7 dev and transfer-v4 dev accuracy against stock, paired; drop ≤ 2 pp on each; Brier
    rise ≤ 0.02" (`JP:1613`).
  - Replay draws from decision-v7 `train` (`JP:1422`).
  - hard-v1 is "optional" (`JP:1417-1418`).
- **Evidence and reasoning [I]:**
  - **Replay flatters decision-v7.** Replay comes from decision-v7, so retention on its dev split is
    in-distribution; transfer-v4 is the only check off the replay distribution.
  - **The tuned model will serve everything.** The bridge runs one `kev.serve` at a time (coverage G4),
    so generic and non-port questions (inventory A0) go to the tuned model too.
  - **Shared option names bias other questions.** Binary ports share option names (`yes`/`no` in X1,
    S3, Q1, C1, C2, C7; `same`/`different`). Per-port priors on those names are the most likely
    interference with other yes/no questions, and Kev's suites do not use Foundry's option contracts.
  - **The gate checks only accuracy and Brier.** Unknowable behaviour (stock 0% at p ≥ 0.9
    [D dossier §2.3]), permutation consistency and ECE on the suites are not checked.
  - **Power is not the problem.** About 1,468 and 764 suite questions give a paired SE of about
    0.6–0.9 pp.
- **Fix:** the forgetting battery is:
  1. transfer-v4 and hard-v1 (mandatory, not replayed);
  2. decision-v7 dev (reported, flagged in-distribution);
  3. Kev's own unknowable records, p ≥ 0.9 share ≤ stock + 2 pp;
  4. `/permute` flip rate on 200 suite items ≤ stock + 2 pp;
  5. option-name prior drift: p(`yes`) and p(`same`) on 200 content-free or irrelevant states, mean
     shift ≤ 0.05;
  6. a **generic canary set** of 300 Foundry-shaped questions from wave-2/3 ports and non-port enums,
     stock against tuned.
  Every bound is a one-sided 95% CI, not a point estimate.
- **Test:** a deliberately over-trained candidate (ep2, lr4) fails item 5 or item 6.

**S13. The OOD pools are filtered toward easy, keyword-bearing lines, and the leakage distance is
wrong.**
- **Program:**
  - "A pool line is admitted only if both Sonnet 5.5 and Opus 5.5 … recover the inherited label"
    (`JP:1195-1196`).
  - OOD lines need "a maximum 4-gram Jaccard of 0.3 against any train-pool or bed template"
    (`JP:1268-1269`).
- **Evidence:**
  - 4-gram Jaccard catches copied strings, not shared decisive words. "flip the sign" and "the sign is
    reversed" share no 4-gram but both carry "sign".
  - Bed held-out forms are bimodal for the probe (Q3). The X1 held-out families fall to one regex
    (Q14).
  - The two-model filter removes exactly the hard, ambiguous lines [I].
- **Fix:**
  - Measure lexical leakage with the train-fitted probe and the port rule, not n-grams.
  - Require ≥ 40% of each OOD pool to be **probe-hard**: misclassified by both, through negations,
    counter-keywords (the bed's own "never adopted the month-first habit" style) or decisive words in
    the wrong role.
  - Keep the two-model filter, but log the lines it rejects.
  - Report OOD accuracy for the probe-easy and probe-hard strata separately.
- **Test:** pool acceptance computes the probe-hard share and fails under 40%.

**S14. Small-axis gates fail correct models and pass bad ones.**
- **Program:**
  - ECE ≤ 0.05 "on every test-OOD axis" (`JP:1605`, `:1777`).
  - Unknowables "≤ 5%" on 100 items (`JP:1491`, `:1609`).
  - Target-flip "≤ 2%" on 200 pairs (`JP:1612`).
  - Long state 50 × 2.
- **Evidence:**
  - A perfectly calibrated model fails ECE ≤ 0.05 with probability 0.63–0.91 at n = 60 and 0.35–0.77
    at n = 100 (Q21).
  - Point or bound is unspecified. As a bound, "≤ 5% of 100" passes only with 0 or 1 confident errors
    (5/100 has a one-sided upper bound of 10.2%). Target-flip ≤ 2% on 200 needs ≤ 2 flips (upper
    bound 3.1%).
- **Fix:**
  - State point or bound for every gate.
  - Require ECE only on axes with ≥ 500 items, using the equal-mass bins as primary. On smaller
    axes, report reliability with a bootstrap band and the Brier calibration component.
  - Size unknowables and adversarial pairs for the bound (≥ 300 and ≥ 400).
- **Test:** the pre-registration lists n, unit count and the false-fail probability of each gate for a
  model at the threshold.

### P2

**S15. The length-only acceptance check is inverted and too weak.**
- **Program:** "Two shortcut checks flag a port 'rule-solvable' and demote its in-family numbers to
  diagnostic: a length-only logistic predicts the label with AUC ≤ 0.65; the port's rule scores < 0.98
  on train" (`JP:1917-1921`).
- **Evidence:**
  - The conditions read as passes, not flags.
  - Length-only scores 0.50–0.63 on R1–R4 [M here] while a format rule gets R4 to 1.000 and `history`
    gets F1 to 1.000.
  - Demoting *in-family* numbers changes nothing: they are already recall.
- **Fix:** replace both checks with the S9(f) battery on every axis.

**S16. Option order is handled; add label-position balance.**
- Kev permutes options every epoch (`kev:kev/data.py:320-343`) and evaluation files are shuffled
  (`JP:1211-1215`). Gate 6.9 measures flips.
- Missing: a per-file histogram of the label's option position, and accuracy by position.
- Option-description overlap is not a shortcut in R1–R4 (Q12).

**S17. Paired and multi-question items are dependent.**
- X5 polarity pairs (`JP:838-839`) and multi-question records share one reading of one state.
- Cluster paired items by state as well as by form.
- Report the pair-consistency rate. Both members right is the X5 accuracy that matters.

**S18. Hard-negative pools are small fixed lists.**
- records `BENIGN_MEMOS` has 12 strings and `DECOY_MEMOS` has 2 per system (`beds/records/world.mjs`).
  The probe's top X1 features are these strings (Q13).
- The "30–50% hard negatives" target (`JP:1245-1246`) should be counted in *distinct* negative forms,
  not rows.

---

## 3. Statistical power per wave-1 port at the proposed sizes

- **Unit** = what varies independently on an axis. A world is not the unit when every world reuses
  the same few sentences.
- **Half-width** = 95% half-width of accuracy at about 0.8, with per-unit SD 0.35 for form units
  [E, formula 1.96 × 0.35 / √units].

| Port | Axis (program) | Independent units | Half-width | Can 8.1 ("CI of diff > 0") resolve +5 pp? |
|---|---|---|---|---|
| R1 | template (highest index) | 6 forms [M] | ±28 pp | no |
| R1 | G0b pool (≥ 30/label, 3 options; `ymd` has no in-bed d ≥ 3 items) | ≈ 60–90 lines | ±7–9 pp | no |
| R2 | template 6, 7 | 4 forms [M] | ±34 pp | no |
| R3 | template 3 | 8 forms [M] | ±24 pp | no |
| R4 | template 4, 4 | 7 forms [M], and the date-format shortcut | ±26 pp | no, and not interpretable |
| I1 | skeleton holdout | ≥ 5 clusters/label × 9 (minimum allowed) = 45 | ±10 pp | no |
| I2 | skeleton holdout | unknown; blip collisions (G8) | [unk] | unknown |
| S2 | skeleton holdout; natural rate | injection 0.5% → about 2–3 positives per 500 [E] | per-class recall unmeasurable | no for minority classes |
| X1 | family (kinetics, gridquest) | **11 positive forms**, 10 regex-solvable (Q14) | ±21 pp on positives | no |
| X1 | external deepset (< 1K, test-only) | hundreds of texts | ±4–6 pp | yes, if retargeting keeps it decidable |
| X3 | family runbook (tap) | runbook comment pools [unk] | [unk] | unknown |
| X5 | family kinetics, runbook | assumption kinds × templates; kinetics has 2 kinds (`JP:829`) | probably < 30 units [I] | probably no |
| X8 | family synth | many value cells | ±4 pp | yes |
| X8 | REAL | **5 worlds** (Q20) | undefined | no |
| Q4 | family gameqa | bug manifestations × worlds [unk] | [unk] | check |
| F1 | family REAL | **3 distinct states** (Q15) | undefined | no |
| all | paraphrase | 2 wordings | n/a (2 samples of a wording distribution) | no, for generalisation over wordings |
| all | in-family 500 | about 500 rows over the same templates | ±3.5 pp | yes, but it measures recall |

**Reading.**
- Under the program's own rule, only X8-synth, the external X1 set and in-family can resolve +5 pp.
- 8.1 requires "every available axis". So, as written, no template-bound port can be promoted on
  evidence. Any promotion would come from noise, or from treating small axes as "unavailable".
- Fixes S1, S3 and S13 raise the form count. The pre-registration should print each axis's unit count
  next to its gate.

---

## 4. Decidability audit (proposed acceptance gate, per port)

Purpose: every training and test label must be decidable from the **state the model sees**, using
only knowledge the port contract allows. Labels that are correct about the world but not visible in
the state are label noise for Kev.

1. **Re-derive from the state only.** An independent code solver reads only the exported state and
   question.
   - For template ports it parses the state with the exported pools: a template match on the state
     string, in the manner of `beds/records/solve-text.mjs` but limited to the state.
   - It must reproduce the label on at least 99.5% of 500 rows per port and split.
   - Rows it cannot decide are listed, with reasons.
   - Acceptance 1(a)'s world-based check stays, as a separate correctness test.
2. **Masked-state collisions.** Group rows by skeleton(state) + question + slots, with digits, dates,
   names and markers masked. The share of groups with more than one label must be under 1%. This
   generalises coverage G8 from I2 to every port.
3. **Time of decision.** Each state field names its producing event and must exist when the consumer
   asks (S8).
4. **Allowed knowledge.** Each port declares which world knowledge it may use.
   - Example: R1 may know that Chicago is in the US. Rows that need it carry
     `needsWorldKnowledge: true`, are evaluated separately, and use held-out entity lists (held-out
     cities) so recall of a 60-city list is not mistaken for knowledge.
   - Otherwise they get a soft target or are excluded, in line with "abstention is expected".
5. **Label semantics against the option text.** For every mapping from bed truth to an option, check
   the description against the bed's README meaning.
   - Known breaks: S2 press-release claims (Q19); I2 `renew` and `consequence` (coverage G8).
   - Expected: X8 day-≤12 asymmetry [I]. Day-month swaps can only produce wrong values for days ≤ 12,
     so every date with day > 12 is `consistent` by construction. Restrict consistent date items to
     day ≤ 12, or report the two strata.
6. **Blind read.** 50 rows per port, state and question only, read by two independent readers with a
   "cannot tell from this state" option.
   - Readers may be agents acting as **auditors**, not labellers; the labels stay generator truth.
     Add a human for 20 rows on the C4 ports.
   - Report agreement with the label and the cannot-tell rate. Over 5% cannot-tell in any class blocks
     the build for that port.
7. **Partial-input ceilings** (S9f) are reported with the audit. A port whose metadata-only or
   context-only ceiling exceeds majority + 5 pp is not frozen until the factory rebalances it.

---

## 5. Changes to the program, in order

1. **Units and power** (S1, S14, §3): form-clustered CIs; ≥ 30 forms per label per gating axis; an
   n, units and false-fail table in the pre-registration.
2. **Span-level holdout across ports** (S2), and no held-out templates in G0a input.
3. **Counterfactual re-rendering and balancing** in the factory (S3): KOBO, the R4 date format, R3's
   forced `pay`, R1 `ymd`, I1 names, X1 addressee words, larger benign pools.
4. **Three OOD slices**: calib-OOD, dev-OOD and test-OOD, disjoint in templates, pool lines and
   paraphrases. Calibrate with per-option biases on calib-OOD; read the curve on dev-OOD; read
   test-OOD once (S4, S6).
5. **Presence-matched unknowables** and hard `not_stated` items (S5).
6. **Causal gates and partial-input baselines** (S9, S11, S15).
7. **The decidability audit** (§4), including time of decision (S8) and label semantics (S10).
8. **Real-trace minimums** (S7): relabel or drop F1 real; collect 30–60 reserved X8 tasks; F1 is not
   promotable in wave 1.
9. **Forgetting battery** (S12).
10. **Probe-hard quota** for OOD pools (S13).

None of these needs a bed change. They are factory transformations over exported pools, analysis
code, and new seed reservations.

---

## 6. What holds up (not re-checked further)

- The program states plainly that in-family numbers are recall, and reports a transfer gap
  (`JP:44-49`, 6.5).
- X5 polarity pairing defeats state-only priors: the probe on state only scores 0.500 (Q18).
- Option order is permuted in training and shuffled in evaluation. Option-description overlap is not
  a shortcut (Q12).
- The bed authors built counter-keyword templates on purpose ("Every keyword that could decide a
  class also occurs in a paraphrase of the opposite class", `beds/records/render.mjs:298-301`). That
  is why the probe falls to 0.62–0.72 on held-out templates and to 0.30 on R1's negated forms. The
  remaining problem is the number of such forms, not their quality.
- The injection gate's target-flip rate (6.10) is the right metric for the injection risk.

---

## Appendix A. What I ran

- Scripts are in the session scratchpad `…/scratchpad/sc/`, not committed: `bow.mjs` (logistic
  regression), `rgroup.mjs` (R1–R4 builder), `ranalyze.mjs`, `rform.mjs`, `notstated.mjs`,
  `overlap.mjs`, `probebuild.mjs`, `probeanalyze.mjs` and `power.mjs`.
- Probe builders were imported from `experiments/kev-probe/datasets.mjs` with `KEV_PROBE_RUN_DIR`
  pointed at the scratchpad, so nothing was written under `experiments/runs/`.
- **Generated (dev split only):**
  - records seeds 1–1,600 and 4,500–4,999 (d = [3, 3, 4, 5][seed mod 4]);
  - the probe sets (seeds 1–400);
  - incident seeds 1–1,200 and 4,500–4,899;
  - synth seeds 1–240 at d3–d5.
- **Read-only:**
  - `records-hand-pilot` `results.jsonl` and `journal.sqlite` (`model_calls` grouped by model);
  - `git log` of `experiments/kev-probe/datasets.mjs`;
  - the pools `ORDER_NOTE`, `FLAG_NOTE`, `PERSP_NOTE`, `MIRROR_NOTE`, `RELIABLE_NOTE`, `TEAM_CITIES`
    and `FLAG_TOKENS`, plus `world.mjs` conv draws and memo pools (records);
  - `INJECT` (incident), `INJECTIONS` (kinetics, gridquest);
  - `kev/data.py` `augment` and `none_pair`.
- **Simulations** (`power.mjs`):
  - ECE of perfectly calibrated binary predictors at n = 60–1,000, 4,000 replicates each;
  - Clopper–Pearson pass rates for gate 6.4;
  - normal-approximation pass rates for the sufficiency rule;
  - form-clustered half-widths.
- **Not done:** no Kev, embedding or hosted model was run. The probe is the only learner used. No bed
  `test` split and no sealed bed was touched.
