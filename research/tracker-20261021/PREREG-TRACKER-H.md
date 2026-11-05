# PREREG-TRACKER-H: the condition tracker on a held-out request set (A7, task #60)

*Written 2026-10-28 before any build, capture, bind, review or tracker status on the held-out requests. Frozen by the commit that adds
this file; every input, code file, prompt, template and $0 build is hashed in [heldout/freeze-h.json](heldout/freeze-h.json) by
`experiments/tracker-v2/heldout/freeze-h.mjs`, and the paid script checks the freeze before every step. A change after this commit is a
deviation, recorded in `heldout/deviations-h.json` with the file's new hash and reported beside the frozen result.*

## 1. Why this exists

The first measurement ([PREREG-TRACKER.md](PREREG-TRACKER.md)) failed its precision rule under the frozen semantics v1 (23, 18, 26 and 23
false alarms on 83 verified BUILDER-1 builds). Deviations D2 and D3 added evaluation rules (v2, v3), each root-caused on those same
builds and on E8. Rules designed on the data they are scored on are development evidence only. This preregistration tests the tracker
as it now ships (semantics v3, the product default) on requests it was never designed on, with every model prompt unchanged from the
first measurement (`tracker-capture/1`, `tracker-bind/1`, `tracker-prose-checklist/1`, `b0-one-shot/1`).

## 2. The held-out set (frozen inputs)

- **Requests**: 14, two per app template, written by **mercury-3** (`experiments/tracker-v2/heldout/author.mjs`, prompt `tracker-h-author/1`,
  4,943 tokens) from the template cards alone, kept verbatim ([heldout/requests-mercury-3.json](heldout/requests-mercury-3.json)). The
  author never saw the tracker, its prompts or semantics, BUILDER-1's cases or any run; it is a different model family from the tracker's
  capture and bind model (Haiku).
- **Answer key, hidden worlds, oracles, reference slots, 41 bad-slot controls** ([heldout/cases.json](heldout/cases.json)), and the
  **gold condition list** ([heldout/gold-heldout.json](heldout/gold-heldout.json): 58 conditions, 51 testable): written by the analyst
  (who also wrote D2 and D3) BEFORE any build or tracker call on these requests. Same schema and oracle as BUILDER-1
  (`experiments/surface/oracle.mjs`). Validity at $0 (`experiments/tracker-v2/test/heldout-validity.test.mjs`): 12 reference flows verify
  in their hidden worlds; the references of **HL2** ("if budget is above 25k also cc me") and **HO1** ("isnt acknowledged within an hour")
  fail by design, because the words ask for something no template flow does (a defect the person would see; T0 cannot); all 41 controls
  fail; the simulated person answers by wording. Where the words are ambiguous the hidden world avoids the ambiguous item (`oracleNote`).

## 3. Builds and labels

Builds of the 14 requests, each run once in its hidden world and labelled by the oracle (`verified`): **REF** (reference slots, $0),
**CONTROL** (41 bad-slot variants, $0), **B-H** (Haiku template builder, BUILDER-1's fixed builder code), **B-M** (the same with mercury-3),
**B0-H** (Haiku one-shot workflow writer). Only built, strictly valid flows are scored. The tracker and T1 never see a hidden world, an
oracle, a label or a control's description: they see the person's words, the build and its practice runs.

## 4. Arms (all on practice data only, before any live run)

| arm | flags a build when | model calls |
|---|---|---|
| **T0** | its own practice run does not pass (status or its own checks) | none |
| **T1** | a Haiku checklist reviewer marks any condition unmet (person's words + capture s0's conditions + the build + its base practice run) | 1 per build |
| **T2solo** (the product number) | any condition `unmet` under v3, judged on this build alone (the real-shape gate sees only its own runs; no G3) | capture + bind per request; $0 per build |
| T2 / T2noG3 | as T2solo, with the gate over every build of the request, with and without G3 (unmet on every build ≥ 3 → suspect) | same |
| T0+T2solo, T0+T1 | either | same |
| T2-rule | the $0 capture rule (every clause) + Haiku bind | bind only |
| T2-M | capture s0 + mercury-3 bind | Mercury bind |

Haiku capture K = 3 (s0, s1, s2), each bound once by Haiku. Every capture and bind is also judged under v1 and v2 ($0) and reported.

## 5. Measures and decision rules (fixed now)

Build-level, over all scored held-out builds, per Haiku sample (s0, s1, s2); reported also on the model-built subset (B-H, B-M, B0-H)
because the controls are analyst-made:

- **H1 (alarm precision)**: T2solo-v3 precision (defective among flagged) ≥ 0.95 in every sample.
- **H2 (no false alarms)**: T2solo-v3 flags 0 verified builds in every sample.
- **H3 (adds catches)**: T0+T2solo-v3 catches at least 10 more defective builds than T0 alone, in every sample.
- **H4 (vs the prose checklist)**: T2solo-v3 precision ≥ T1's and T2solo-v3 false alarms ≤ T1's (each sample against T1).
- **H5 (capture)**: Haiku capture recall against the held-out gold ≥ 0.90 in every sample (the $0 rule's recall reported beside it).
- **H6 (the fixes generalise)**: on the same bindings, v3's false alarms ≤ v1's, in every sample.

- **H7 (exploratory, the findings back to the builder)**: each B0-H build gets one repair round from the same one-shot writer with one
  feedback arm: **t2** (the conditions T2solo-v3 found unmet on capture s0's binding, with quote and first evidence; flagged builds only),
  **t1** (the conditions T1 ticked unmet, with its why; flagged builds only) or **none** (self-review: "check it does everything the person
  asked"; every B0-H build). Each repaired flow is strictly validated, run once in its hidden world and judged by the oracle. Reported
  per arm: defective builds fixed, verified builds broken, cost. No threshold; the reading is whether specific, grounded findings fix
  more than a generic self-review at equal or lower cost.

Also reported, no threshold: T2 and T2noG3; T2-rule; T2-M; condition-level precision after adjudication (every `unmet` labelled true /
oracle gap / false with a cause, as in PREREG-TRACKER §5; the labels never change the build-level numbers); abstention by reason; the
share of testable gold conditions that got a check (expressiveness); questions per build (v3's R-overlap, R-it and R-qualifier turn some
failures into questions: the person's burden); cost per build; Mercury tokens.

## 6. Budget, faults, order

Haiku ≤ $1.47 for the held-out set (B-H builds ≤ $0.10, B0-H ≤ $0.20, capture ≤ $0.10, binds ≤ $0.46, T1 ≤ $0.40, H7 repairs ≤ $0.27);
the program total stays under the $3 cap. mercury-3 ≤ 220,000 tokens (B-M builds 120,000, bind 100,000) plus the author's 4,943 (D18 per-item cap 0.5M).
Order (`experiments/tracker-v2/heldout/paid-heldout.sh`, detached): builds B-H, B0-H, B-M; capture; binds s0, s1, s2, rule; T1; Mercury
bind; judges ($0); score; H7 repairs (t2, t1, none); score. Rate or usage limits and provider outages are environment faults: the step stops, nothing from it is scored, it
resumes after 30 minutes from the files already written.

## 7. Known threats (stated now)

- **One analyst wrote v3 and the held-out oracles and gold.** The worlds and gold were written before any tracker output on these
  requests, and no tracker code may change after this freeze without a recorded deviation, but the analyst's sense of "what the person
  means" shaped both.
- **Model-written requests.** mercury-3 wrote from template cards, not real people; requests may be cleaner and closer to the templates
  than real ones. Two requests ask for what no template does (HL2, HO1), which real requests also do.
- **Analyst-made controls** are single-slot defects (wrong address, threshold, filter, flag): in-distribution for a template tracker.
- **Same practice workspace and templates** as BUILDER-1: the practice data, not the requests, is shared with the development bed.
- **Correlated builds**: the template arms share templates; K = 1 build per arm per request.
- **Practice is not live**: statuses come from practice runs only.
