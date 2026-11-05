# PREREG-TRACKER-H2: the corrected re-measure on the opened held-out set (A7, review 2026-11-04)

*Written 2026-11-04, after the adversarial review of the held-out result and before any of the paid calls below. Frozen by the commit
that adds this file together with the runner (`experiments/tracker-v2/remeasure.mjs`), the paid script
(`experiments/tracker-v2/paid-remeasure.sh`) and the recorded deviations D4 (`deviations.json`) and HD1 (`heldout/deviations-h.json`):
both freeze checks pass at that commit, and the paid script stops on any later drift. **This is not a fresh held-out test.** The 14
requests, worlds, gold and labels were opened on 2026-11-04 when PREREG-TRACKER-H was scored, so every number here is a corrected
measurement of the same set, labelled development-grade for any claim. A claim needs a fresh held-out set.*

## 1. Why

The review found two leaks and two evaluator bugs that bear on the PREREG-TRACKER-H numbers:

- **B2: the host account's e-mail reached the Haiku calls.** Root-caused on 2026-11-04 (RESULT-TRACKER §11): the `claude -p` CLI adds a
  user-context block "The user's email address is ..." from the account kept in its global config, and `--system-prompt` does not
  remove it. Canary (`identity-canary-before.json`): the address came back on 6 of 6 calls, with or without the three identity
  variables; with an empty config directory, on 0 of 2 (`identity-canary-empty-config.json`). The provider now isolates every child by
  default (`src/models/providers/claude-cli.mjs`, `identity: 'isolated'`); after the fix, 0 of 2 (`identity-canary-after.json`). B0-H
  builds HI1, HL2, HO1, HO2 and HW2 hard-coded or asked about that address, so the B0-H arm and the H7 repairs are contaminated.
- **M1: the tracker and T1 were given the whole answer key.** `wordsFor(case)` feeds every answer of the key to capture, bind and T1,
  while a model build only received the answers to the questions it asked. 16 of 42 model builds had different words (12 of them
  missed an answer the tracker had; all 12 are defective).
- **M3: two evaluator bugs** (scenario copy names, per-run counts): fixed as semantics **v4** (deviation D4), with tests where each fix
  must not fire.
- **M4 / m2 / m5**: no $0 literal baseline, G3 pooled the reference and the controls, T1 was a single sample.

## 2. What is re-run (paid, Haiku only; no Mercury)

1. **B0-H2**: the 14 B0-H builds again, same writer and prompt (`b0-one-shot/1`), through the isolated provider, each run once in its
   hidden world and labelled by the same oracle (`runs/b0-h2/records`). Every record is scanned for the host identity by hash.
2. **Own words** (the product's input): each model build's words are the request plus the answers it actually received
   (`record.questions[].answer`, in the order asked). A build whose answers are the key's (as a multiset) keeps the key's capture and
   bind (identical input). Each distinct other conversation gets capture K = 3 (s0, s1, s2) and one Haiku bind per sample, with the
   prompts unchanged (`tracker-capture/1`, `tracker-bind/1`), in `heldout/h2/own-words/`. REF and CONTROL keep the key (they are the
   answer key's own builds).
3. **T1, K = 3, own words**: the prose checklist (`tracker-prose-checklist/1`) on capture s0's list of each build's own words, three
   samples per build over REF, CONTROL, B-H, B-M and B0-H2. Sample 0 reuses the PREREG-TRACKER-H T1 result where the inputs are
   byte-identical (REF, CONTROL, and B-H / B-M builds whose words are the key's).
4. **H7 again** on the B0-H2 builds: the same three feedback arms (t2 from T2solo-v3 own words s0, t1 from T1 own words sample 0,
   none), same writer, same wording of the feedback.

$0 steps: every build judged on practice data under v3 (the preregistered product) and v4 (the product default from D4), T2solo per
build; G3 pooled over the model builds only (B-H, B-M, B0-H2) per request; the $0 literal baseline T-lit; scoring.

## 3. Settings and arms reported

| setting | builds | words the tracker and T1 get |
|---|---|---|
| **orig-key** | the 97 PREREG-TRACKER-H builds | the whole key (as preregistered; an upper bound for model builds) |
| **corr-key** | B0-H2 in place of B0-H | the whole key |
| **corr-own** (the product setting) | B0-H2 in place of B0-H | each build's own conversation |

Arms per setting and sample: T0; T1 (each of K = 3, and the majority of 3); **T2solo v3** and **T2solo v4**; T0+T2solo;
**T-lit** ($0, no model: flag a build when any e-mail address, #channel or number of two or more digits in the words is absent from the
workflow JSON, case ignored); G3 over the model pool (key settings). Each also on the model-built subset (B-H, B-M, B0-H2), which the
review asked to lead with, because the 41 controls are analyst-made single-slot defects.

## 4. Decision rules

The PREREG-TRACKER-H thresholds, recomputed per setting and sample with nothing changed: H1 precision ≥ 0.95; H2 zero false alarms;
H3 +10 catches over T0; H4 T2solo precision ≥ T1's and false alarms ≤ T1's, **now against each of T1's three samples and their
majority**; H5 (pointer recall) is reported for the key captures only (the gold anchors sit on the key's turns). H6 is not recomputed
(v1 is not re-run). Added, no threshold: T2solo against T-lit (catches and false alarms), on all builds and on the model-built subset.
Every rule is reported for v3 and v4. v4 is designed on this set (its two fixes come from this set's adjudication), so a v4 pass is
development evidence only.

## 5. Budget, faults, order

Haiku: B0-H2 builds ≤ $0.20; own-words captures ≤ $0.05; own-words binds ≤ $0.40; T1 ≤ $0.45; H7 ≤ $0.21 ($0.07 per arm). The program
total stays under the $3 cap ($1.4749 spent before this file: $1.4723 by PREREG-TRACKER-H and $0.0026 by the 12 canary calls). Order (`paid-remeasure.sh`, detached): B0-H2
builds; conversations; own captures; own binds s0-s2; T1 samples; judges ($0); H7 repairs; score. Rate or usage limits and provider
outages are environment faults: the step stops, nothing from it is scored, it resumes after 30 minutes from the files already written.

## 6. Threats (stated now)

- The set is open: the analyst has read every build, label and alarm. v4 and these settings were chosen after that.
- One build per arm per request (K = 1 builds); B0-H2 is a new draw of the same writer, so its builds differ by sampling as well as
  by the identity fix. Both versions are reported.
- The own-words captures are new model samples; their differences from the key captures mix the word change with sampling noise.
- The analyst labels nothing new for this re-measure: condition-level precision is reported only where the existing labels cover the
  groups (new groups are counted as unlabelled, never guessed).
