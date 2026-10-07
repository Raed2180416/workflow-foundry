# Kev judge program: ports, data, splits, sizes, gates (2026-10-07, revision 2)

*Design document. Development/diagnostic status: nothing here has been trained or evaluated yet.
Companion to [01-kev-dossier.md](01-kev-dossier.md) (what Kev is) and
[02-decision-inventory.md](02-decision-inventory.md) (where Foundry makes quick semantic decisions).
It answers the owner direction of 2026-10-07 ("25 min for 5K ... we need to be robust"): fine-tune
Kev-0.8B for every place a quick typed decision helps, build datasets that are right, and show
whether the size is sufficient.*

*Revision 2 resolves the findings of two adversarial reviews:
[JUDGE-CRITIQUE-shortcuts.md](JUDGE-CRITIQUE-shortcuts.md) (S1–S18 and its decidability audit: would
Kev learn the skill or the generator?) and [JUDGE-CRITIQUE-coverage.md](JUDGE-CRITIQUE-coverage.md)
(G1–G28 and its claim-C4 ladder: coverage, feasibility, wiring). Every finding is fixed or rejected
with a reason; the **Review log** at the end lists each one and where it landed. The worker build
plan is [JUDGE-BUILD-PLAN.json](JUDGE-BUILD-PLAN.json) (§10).*

**Evidence tags.** Every number carries one:
- **[M]** measured, with the source: `[M here]` = the revision-1 session (Appendix A);
  `[M probe]` = `research/kev-20261007/probe-summary.json` (generated 2026-10-07T17:01Z, rule arm only;
  `03-probe-results.md` is still a placeholder, so no stock-Kev probe numbers exist);
  `[M crit-S]` / `[M crit-G]` = measured in the shortcuts / coverage review (their Appendix A,
  dev seeds only); `[M owner]` = owner-reported laptop smoke (no run record in this repository).
- **[D]** documented, with file and function (`kev:` = `/home/user/jaredpalmer/kev` at `5e42a7a0`,
  `fdy:` = this repository). Kev documents are its author's claims, not verified here. Bed line
  numbers drift while other agents edit the beds; the function or constant name is the stable
  reference [crit G12].
- **[E]** estimated, with the reasoning or formula. **[I]** inference, with the reasoning.
- **[unk]** not known from any source available here.

**Ground rules this program obeys.**
- Kev ranks, gates and abstains; it never promotes, completes or grants (`fdy:docs/THESIS.md` §7,
  `fdy:docs/ROADMAP.md` §2.4). A port gates only after it beats its baselines on held-out labels
  (claim C4, `fdy:docs/ROADMAP.md` claims table and falsifiers).
- Sealed beds (`beds/sealed/`) are never read, listed, hashed or used. Bed `test` split seeds
  (≥ 5000) are evaluation only and never enter training, calibration or selection.
- Labels come from generator truth, simulators, oracles, replays or journals. **No LLM ever labels
  a record.** Authored pool lines inherit the truth of the brief they were written to and must
  pass a two-model filter (§2.3 rule 1); agent auditors read rows and report "cannot tell", but
  never assign labels (§2.7).
- Model ids come only from `fdy:policy/models.json`; every escalation is a logged event. The weak
  model is Haiku 5.5 (`claude-haiku-5-5`, policy class M): owner decision O1, resolved 2026-10-07
  (the owner: "anthropic updated haiku from 4.5 to haiku 5.5"; Haiku is deliberately the weak
  model in experiments). Haiku 4.5 (`claude-haiku-4-5-20251001`) stays in the policy for earlier
  pilots and as a reference only; its journals (e.g. `records-hand-pilot`) are historical data.

---

## 0. Summary

1. **The binding constraint is surface diversity, so the unit of evidence is the surface form.**
   The bed generators write their label-bearing sentences from small template pools. Measured on
   900 dev worlds of `records` (seeds 1–300 × d3–d5) [M here]:

   | Port | Distinct label-bearing forms in 900 worlds |
   |---|---|
   | sign convention (R3) | **32** (system × side × template) |
   | date order (R1) | **44** (system × order × template) |
   | timestamp re-stamp (R4) | 220 |
   | status-value meaning (R2) | 288 (16 template ids) |

   Injection text is the same: 4–9 templates per bed [M here]. A fine-tuned 0.8B memorises these;
   a bag-of-words probe already scores 0.885–1.000 in-family on R1–R4 [M crit-S Q1]. Revision 1
   relied on held-out bed templates, but those are **6, 4, 8 and 7 sentences** for R1–R4; a
   world-clustered CI over them is ±4 pp, a form-clustered one ±27 pp [M crit-S Q3]. Revision 2
   therefore:
   - resamples by **form × world** in every CI and refuses a gate verdict on any axis with fewer
     than **30 independent forms per label** ("diagnostic: n_forms = k") (§6.0);
   - makes the **authored OOD pools** the gating template axis, sized for it (≥ 200 lines per label
     per template-bound port, split across three OOD slices), with ≥ 40% probe-hard lines (§2.4);
     bed held-out templates become a diagnostic sub-axis.
2. **Held-out surfaces no longer leak, and shortcuts that survive holdout are removed in the
   factory.** Revision 1's per-port template holdout leaked: 100% of R2 and R3 held-out test
   sentences occurred verbatim in other ports' training states [M crit-S Q4]. A span-skeleton
   registry now covers every held-out surface and is checked against **every** port's states;
   offending sentences are re-rendered, not whole worlds rejected (§2.3 rule 7). Counterfactual
   re-rendering balances labels within (port, system), removes R4's date-range format rule
   (1.000 on held-out templates [M crit-S Q6]), makes R1 `ymd` reachable, replaces incident
   service names with per-state handles, and balances X1 addressee words (§1.2, §2.5). A
   partial-input battery must sit within 3 pp of the majority class before a build freezes.
3. **Three OOD slices.** calib-OOD fits temperature, per-option biases and thresholds; dev-OOD
   selects configs and reads the learning curve; test-OOD is read once. In-family calib only
   reports the calibration gap (§3.1, §7.5). Revision 1 calibrated on near-memorised in-family
   data and read its curve on test [crit S4, S6].
4. **Causal and decidability gates.** Counterfactual flip, invariance, slot swap, evidence
   dependence, a probe-hard stratum and partial-input baselines show *why* the model is right
   (§6.3). Every port passes a decidability audit (state-only solver, masked-state collisions under
   1%, time-of-decision field provenance, allowed knowledge, label semantics against option text,
   blind read) before its data freezes (§2.7). Unknowables are presence-matched, not deletions.
5. **"Is 5K sufficient?" is a measured curve with a named indeterminate outcome.** Nested points at
   2.5K, 5K, 10K and 20K rows (40K only if triggered), two training seeds at 5K and 20K, read on
   dev-OOD. Per port and overall the verdict is *sufficient*, *insufficient* or *indeterminate*
   (with its minimum detectable difference) (§4.4). Prediction, written first: 5K is enough at most
   for R2–R4; the hard ports need about 20K; X1 and F1 are limited by families, not rows.
6. **The laptop plan is scheduled in forward tokens.** The 0.287 s/example smoke rate came from toy
   records (3 questions, 151 forward tokens per record) [M crit-G G3]. The curve points cost about
   3.0M / 5.0M / 9.0M / 17.0M training tokens [E crit-G]; at 525 to 4,953 tokens/s the 5K point
   takes 17 min to 2.6 h. J0 fits seconds per record and per token, host RAM, VRAM and the kernel
   path; the schedule, a priority order and a reduced plan below 1,500 tokens/s are
   pre-registered (§7.4).
7. **Evaluation goes through the serving path.** `kev.benchmark --data` silently skips every state
   over 384 tokens, which is most wave-1 states [M crit-G G1]. Files with longer states are scored
   through `kev.serve` with `SystemOneClient` and the bridge's signed `bridgeFetch`
   (`score-served.mjs`), which is also the bf16 path that serves; calibration is fitted there
   (§7.5). States are budgeted in real Qwen3.5 tokens (§1.0).
8. **Wiring is part of the build.** Group W delivers a provider route for enum agent nodes, a
   journaled `judge` node, port kits shared by factory and runtime, a router with
   `onUnavailable`, the ledger content store, builder-facing text for both builder arms, and the
   end-to-end checks: X8 cascade at ≥ 100 tasks per arm and the X5 gate at ≥ 150 non-matching
   tasks (§8).
9. **Claim-C4 alignment.** F1 uses the THESIS taxonomy (flake / variance / defect / env /
   impossible / finding) with a time-of-decision state; X5 gains a cross-family type-applicability
   family, the 0/21 wrong-type-reuse shape. F1 is trained in wave 1 but cannot be promoted in
   wave 1. Evidence climbs a ladder: T1 offline gates (development evidence) → T2 wired end-to-end
   checks → T3 ledger rows from judge nodes in experiments (claim-bearing) (§8.5).
10. **Scope.** 42 ports, 13 in wave 1. Inventory accounting: 47 decisions mapped, 18 deferred,
    35 excluded = 100 (§1.5). Three ledger-only contracts are frozen so labels accumulate for
    deferred THESIS ports (§1.3).
11. **Sizes at a glance** (§4.3). Each curve point trains on N Foundry rows plus 2,000 replay
    records and reads 17,800 fixed evaluation rows (calib-OOD 7,000, dev-select 2,600, dev-OOD
    8,200). The final read is test-in 6,500 rows and test-OOD about 42,000 rows, once for stock
    Kev and once for the selected candidate.
12. **Owner decisions** (§11): O1 weak-model id and O2 hosted budget are resolved (Haiku 5.5;
    proceed under $450 after the pilot). Still open: O3 `flash-linear-attention` on the laptop; O4 policy entries for Kev runs; O5 annotators;
    O6 a Kev-4B ceiling read; O7 WSL memory cap and laptop availability for about four nights.

---

## 1. Port catalogue

A **port** is one question family. It has a fixed option set (names and descriptions), a defined
state, one consumer and one label definition. Several bed decisions with the same question and
options share a port, and each bed is then a **family** of that port. That sharing is what makes
held-out-family tests possible.

### 1.0 Conventions shared by every port

- **Wire form.**
  - Every port is served as a System One `choice` question built by
    `toSystemOneQuestion` (`fdy:src/judgment.mjs:56-59`): the instructions are the question plus
    `"\nCriteria:\n- …"`, and the criteria object is `{option: description}`.
  - Training records are built **by importing that same function**, so serving and training
    match byte for byte. Fine-tunes bind exact wording (`kev:skills/kev-finetune/references/data-format.md:39`)
    [D].
  - JudgmentPort limits apply: 2–64 options, at most 32 criteria, question at most 4,000 characters
    (`fdy:src/ports.mjs:46-54`).
- **Wording.**
  - Each port has a canonical wording Q0 and three training paraphrases Q1–Q3, listed below.
  - **40 held-out wordings** per wave-1 port are written by a separate worker (group
    `heldout-author`, §2.4): 10 for calib-OOD, 10 for dev-OOD, 20 for test-OOD [crit S9: two
    wordings are two samples of a wording distribution, not an axis]. They are stored in
    `.foundry/kev-data/heldout/`, git-ignored, where no training code reads them.
  - Paraphrases may vary the question only. **Option names and descriptions are fixed per port**
    and are part of the port contract. Any change re-qualifies the port
    (`fdy:docs/ROADMAP.md:501-502`).
  - Slots such as `{system}` are filled from trusted code knowledge, never from task text.
- **State.**
  - The state holds observed facts only, as a JSON object. Kev renders key names, so names must
    be neutral (`kev:kev/api.py:49-55`) [D].
  - **Token figures are real Qwen3.5 tokens.** The pinned tokenizer
    (`Qwen/Qwen3.5-0.8B-Base@dc7cdfe2`, run by `lib/tokens.mjs` through `/opt/kev-venv` with
    `python -I`) is the only budget gate [crit G2]. Bytes/4 under-counts logs, table rows, ids
    and kinetics documents by 1.9–2.5× and prose by 1.05–1.2× [M crit-G: I1 8 lines 466 real vs
    209; records 6-row export 505 vs 240; kinetics document 1,811 vs 717; records notes 1,708 vs
    1,623]. §1.1 gives real tokens, measured where marked, otherwise bytes/4 × the ratio of that
    text kind [E]. Acceptance recounts every record (§10).
  - Kev-0.8B is validated to 8,192 tokens [D `kev:README.md:220`]. The bridge allows at most
    `maxState 8192`. `kev.benchmark --data` scores only states ≤ 384 tokens and silently skips
    the rest [M crit-G G1], so evaluation goes through the served path (§7.5).
- **Field provenance (time of decision)** [crit S8]. Every state key names the event that produces
  it, and that event must have happened when the consumer asks. `spec/ports.json` carries the
  provenance table per port. No key may hold the outcome of a check the port is meant to order
  (F1 never sees the current replay, resample or control-build result).
- **Allowed knowledge** [crit S10]. Each port declares the world knowledge it may use (R1 may know
  that Chicago is in the US). Rows that need it carry `needsWorldKnowledge: true`, form their own
  reported stratum, and are tested with held-out entity lists. Rows that need knowledge outside
  the declaration are dropped or get a soft target.
- **Deployment base rate** [crit S4, S11]. Each port declares the base rate at which thresholds
  are fitted and risk is read:
  - `bed-natural` (S2, I2, X1, X8): the bed's rate is the best deployment proxy available;
  - `balanced-within-entity` (R1–R4, X5): per-world draws such as R3's forced `pay` or
    "KOBO is always void" are generator artefacts, not deployment priors, so labels are balanced
    within each (port, system or service) and thresholds are fitted at that balance;
  - `uniform` (all other ports, until a deployment rate is observed in ledger rows).
- **Default consumer route.** Every escalation is journaled; there is no silent fallback.
  0. A question with **no frozen port contract** (the generic enum of D:A0) goes to the hosted
     model and is never Kev-gated [crit G27].
  1. Tuned Kev answers. If `p ≥ τ_port(ε)`, the answer is accepted.
  2. Otherwise the pre-registered weak model (class M, owner decision O1, §11) answers through a
     typed JudgmentPort `model` call, calibrated on calib-OOD. If its calibrated p clears its own
     threshold, that answer is accepted.
  3. Otherwise Sonnet 5.5 answers the same way.
  4. Otherwise the port's own terminal route applies, listed per port: a safe default, a code
     path, or a human.
  - **onUnavailable.** If the tunnel or the laptop is down, step 1 is skipped with a journaled
    `kev_unavailable` event and the chain starts at step 2. The CPU copy of Kev (26 s fresh at
    about 566 tokens under load [M probe]) is not a fallback for in-workflow ports [crit G6].
- **Namespaces** [crit G20]. In this document bare ids such as R1, I2, X5, F1 and C1–C9 are
  **ports**. Inventory decisions are written `D:A2`, `D:C1`. The roadmap claim is "claim C4".
  Build groups have word names (`records`, `heldout-author`, §10). Review findings are cited as
  [crit S3] (shortcuts review) and [crit G1] (coverage review).
- **Abstention-friendly options.** Ports avoid "none of these" options inside a choice, because
  they cost 0.8B badly (0.472 against 0.861) [D `01-kev-dossier.md` §2.3]. Where "absent" is a real
  answer, it is a separate yes/no question in the same record.
- **Waves.**
  - **Wave 1:** labels are directly exported by the beds, and the ports carry C4 or the shortlist.
  - **Wave 2:** needs a span tap or a new generator, or matters less.
  - **Wave 3:** labels are scarce or the port is exploratory.

### 1.1 Port table

Abbreviations: fam = families (beds or sources); tok = typical/max state size in **real Qwen3.5
tokens** ([M crit-G] where measured, otherwise [E] = bytes/4 × the measured ratio for that text
kind; acceptance recounts every record); R/G/V = rank / gate / node value.

| Port | Decisions | K | fam | tok (real) | Use | Label source | Wave |
|---|---|---|---|---|---|---|---|
| R1 `date_order` | D:A2 | 3 | records | 340/720 | V | `w.ctx.conv` + counterfactual re-render | 1 |
| R2 `status_meaning` | D:A3 | 2 | records | 340/720 | V | `w.ctx.conv.flags` + counterfactual | 1 |
| R3 `sign_convention` | D:A4 | 2 | records | 340/720 | V | `w.ctx.conv.persp` + counterfactual | 1 |
| R4 `timestamp_reliability` | D:A5 | 2 | records | 340/720 | V | `w.ctx.conv.mirror`, `choices.reliable` + counterfactual | 1 |
| R5 `country_token` | D:A6 | ≤40 | records | 80/330 | V | `row.country` | 2 |
| I1 `fault_class` | D:A7 | 9 | incident | 470/2.5K [M] | V/R | `truth.fault_class` | 1 |
| I2 `log_line_role` | D:A8, D:A9 | 4 | incident | 65/85 [M] | R | `truth.idsByTag` (24-tag table) | 1 |
| I3 `service_role` | D:A9 (+probe) | 4 | incident | 530/730 | V | `truth.impacted_services` etc. | 2 |
| S1 `notice_target` | D:A10 (Q2) | ≤8 | synth | 290/840 | V | `world.retractions/errata/concerns` | 2 |
| S2 `value_provenance` | D:A11 | 4 | synth | 140/350 | V | `world.claims[].mode` | 1 |
| S3 `condition_standard` | D:A12 | 2 | synth | 70/180 | V | `claim.cond` | 2 |
| S4 `variant_form` | D:A11 (part) | 2 | synth | 90/230 | V | `claim.variant` | 2 |
| S5 `document_kind` | D:A14 (+D:A10 Q1, unseen names) | 7 | synth + authored unseen names | 30/80 | V | `TYPE_LABELS` kinds; authored names | 3 |
| K1 `note_event_type` | D:A15 | 5 | kinetics | 100/250 | V | pools via tap | 2 |
| K2 `condition_reference` | D:A17 | 2–8 | kinetics | 500/1.0K | V | `conditionDescription(c)` | 2 |
| K3 `column_unit` | D:A19 | 7 | kinetics | 260/880 | V | `world.docs[].rateUnit` | 2 |
| Q1 `room_exit` | D:A26 | 2 (×4) | gridquest | 190/340 | R | env step from snapshot (`lifetimeActions: Infinity`) | 2 |
| Q2 `container_cue` | D:A27 | 2 | gridquest | 45/90 | R | text pools / env examine | 2 |
| Q3 `next_action` | D:B8 | ≤15 | gridquest, gameqa, runbook | 340/690 | R | reference solver (soft) | 3 |
| Q4 `expectation_met` | D:B6 | 2 | gridquest, runbook, gameqa | 280/690 | G | simulator | 1 |
| Q5 `bug_class` | D:A31 | 10 | gameqa | 170/340 | V | `bugs[].cls` | 2 |
| Q6 `spec_violation` | D:A29 (+codefix) | 2 | gameqa, codefix | 340/2.3K | G | world rules/errata; `b.herring` | 2 |
| X1 `injected_instruction` | D:E4 (D:E3, D:A21, D:A30 part) | 2 | 8 beds + external | 70/170 (long ≤ 4K) | R (alarm) | tags/pools per bed | 1 |
| X2 `same_entity` | D:A1, D:A13, D:A32 (+aliases) | 2 | records, synth, gameqa, incident | 150/360 | V/R | entity/bug/service ids | 2 |
| X3 `speech_act` | D:A16, D:A22 | 5 | kinetics, runbook (+codefix, gameqa if tapped) | 140/350 | V | tap over world claims/spec | 1* |
| X4 `statement_standing` | D:A18, D:A23 (+supersession) | 4 | runbook, kinetics, synth, incident, gameqa | 170/460 | V | world spec/errata/supersessions | 2 |
| X5 `precondition_holds` | D:D1 (D:D7 shape) | 3 | records, synth, incident, bedtype; held out: kinetics, runbook | 600/4K | G | world conventions; family ids (bedtype) | 1 |
| X6 `report_triage` | D:A30, D:A21 | 6 | gameqa, codefix | 140/350 | R | decoys / herring / injections | 2 |
| X7 `item_needed` | D:E1 | 2 | synth, incident, kinetics, gameqa | 170/350 | R | claims/tags/traps | 2 |
| X8 `value_consistent` | D:B3, D:B4, D:B5 (field level) | 2 | records, kinetics, synth, records-real (reserved worlds) | 420/840 | G | truth + near-miss transforms; regenerated world | 1 |
| F1 `failure_class` | D:C1, D:C3 | 6 | exec-injected, templates, gameqa (real: case study) | 100/1.6K | R | healer checks on injected causes | 1† |
| F2 `suspect_function` | D:A20 | ≤64 | codefix (6 domains), ownerci | 600/850 | R | `b.bugs` sites | 2 |
| F3 `item_route` | D:B4 | 2 | records, synth (real traces) | 500/1.2K | G | weak-model replay agreement | 3 |
| C1 `objective_requirements` | D:F1 | 2 (×12) | generated, hand-labelled real | 90/340 | V | composer truth; hand labels | 2 |
| C2 `objective_ungrounded` | D:F2 | 2 | generated | 340/1.7K | G | composer truth | 2 |
| C3 `corpus_domain` | D:G1 | 2 (×~10) | corpus | 230/570 | V | hand labels only | 3‡ |
| C4 `corpus_node_category` | D:G2 | 13 | corpus | 120/200 | V | native types (silver), hand | 3‡ |
| C5 `motif_semantics` | D:G3 | 2 | corpus | 800/2K | V | hand labels | 3‡ |
| C6 `description_quality` | D:G6 | 4 (ordered) | corpus | 90/230 | R | hand labels | 3‡ |
| C7 `transcript_gaming` | D:G7 | 2 | generated tool calls | 200/600 | R (alarm) | composer truth | 2 |
| C8 `notes_leak` | D:G8 | 2 | generated notes | 230/340 | R (alarm) | composer truth | 3 |
| C9 `same_task_family` | D:D5 | 2 | bed prompts | 700/2.1K | R | family ids | 3 |

\* X3 is in wave 1 only if its span taps pass acceptance (§10). Otherwise it moves to wave 2 and
S3 takes its slot. The same contingency covers S2 if the synth-values tap fails [crit G13].
† F1 is trained and measured in wave 1 but **cannot be promoted in wave 1**: no real-trace axis
reaches the availability minimum (§3.5) [crit S7].
‡ Out of the plan until the owner names the annotators (owner decision O5) [crit G24].

**Count.** 42 ports [crit G21: revision 1 said 40 while listing 41; S5 is new].

**Wave 1 (13):** R1, R2, R3, R4, I1, I2, S2, Q4, X1, X3, X5, X8, F1. The three decisions named in
claim C4 (applicability, drift, failure class) are X5, Q4 and F1. X5 now carries the THESIS's
motivating failure shape, wrong-type reuse, through its `bedtype` family; F1 now uses the THESIS
taxonomy [crit G7]. The inventory's shortlist ranks 1–3 and 6 are R1–R4, S2, X3 and X1. X8 is
the lever that makes the weak model competent: it gates cheap extractions for escalation.

### 1.2 Port specifications

Format per port:
- **Q0–Q3** (wording) and **Opt** (options with descriptions).
- **State** and **Use** (consumer, then abstention route).
- **Labels** (bed, file, function, field) and **Adv** (adversarial variants).
- **Per world** (records per world or seed, and surface capacity).

#### Group R: records notes (`beds/records`)

Common to R1–R4:
- **Generator.** `buildWorld(seed, split, difficulty)` (`fdy:beds/records/world.mjs:295`).
- **Notes text.** `w.notes` (`render.mjs:539`, `buildNotes`).
- **Truth.** `w.ctx.conv = {atlas, vendex, bd, mirror, window, flags[], persp{}}`
  (`world.mjs:336-353`).
- **Template ids.** `w.ctx.choices = {orderTpl{}, flagTpl[], mirrorTpl, reliableTpl, perspTpl{}, ref{}, reliable}`
  (`render.mjs` `noteChoices`).
- **State shape.** `{system, source_note}`. `source_note` is system S's paragraph plus any
  paragraph it names by system (the probe's construction, `fdy:experiments/kev-probe/datasets.mjs`,
  applicability builder). It measures 294 bytes/4 at p50 and 588 at max [M probe], about 340/720
  real tokens [E ×1.1–1.2 for prose]. The port kit `src/judges/records.mjs` builds it, for the
  factory and for the runtime (§8.4 W2).
- **Difficulty.** Only d3–d5 carry task-drawn conventions (`k.conv`). d1–d2 items use fixed
  defaults and are capped at 10% of a port's rows as easy items.
- **Multi-question records.** One paragraph can carry R1 + R2 + R3 + R4 questions together with
  their X5 assumption questions (train, calib and dev only; test records carry one question per
  port per state, §2.3 rule 5).
- **Consumer.** The code parser of a records workflow (V). The oracle checks the end result.
- **Counterfactual balancing** (§2.5) [crit S3]. The bed's per-world draws carry priors that
  survive template holdout [M crit-S Q7]: KOBO is always void (R2, 822/822) and always reliable
  (R4, 683/683); system alone predicts R2 at 0.65 (majority 0.51) and R4 at 0.66 (0.50); R3 is 60%
  `opposite` because the bed forces at least one `pay`. In every split except test-in, the factory
  re-renders the decisive sentence so that each label is balanced **within (port, system)**:
  same pool, opposite polarity, same template index where one exists (`ORDER_NOTE`, `FLAG_NOTE`,
  `PERSP_NOTE`, `MIRROR_NOTE`, `RELIABLE_NOTE`, exported by `beds/records/render.mjs`), otherwise an
  authored line of the right slice (§2.4). This is a string substitution in the factory
  (`lib/counterfactual.mjs`), never a renderer fork.
- **Slot binding** [crit S9c]. Only 0–6.7% of natural R rows hold more than one system paragraph
  [M crit-S Q11], so the `{system}` slot is barely trained. At least 20% of R training rows, and a
  200-item slot-swap test set per port, carry two systems' paragraphs with opposite labels.

**R1 `date_order`** (D:A2).
- **Q0** "Which numeric date order does {system} use for birth dates in this export?"
- **Q1** "According to the source note, in what order does {system} write day, month and year?"
- **Q2** "How should a numeric birth date from {system} be read: day first, month first or year
  first?"
- **Q3** "Read the note about {system}. Which date convention applies to its numeric dates?"
- **Opt**
  - `dmy`: "day/month/year (day first)"
  - `mdy`: "month/day/year (month first)"
  - `ymd`: "year/month/day (year first)"
- **Use.** The date parser. If every engine abstains, the workflow parses with both orders and
  flags rows that differ (day ≤ 12) for a verify node.
- **Labels.**
  - `conv.bd`, `conv.atlas`, `conv.vendex` at d ≥ 3. LEDGR, KOBO and VERITAS have fixed orders
    (`dmy`, `ymd`, `ymd`; `buildNotes`).
  - Template id `choices.orderTpl[S]`: 6–8 per system and order, one of them a reference
    template. Reference target `choices.ref[S]`.
  - **Exclude** ATLAS when `w.ctx.cutoff !== null` (d ≥ 4). Its order switches at a dated cutoff,
    so the question is ill-posed.
  - **`ymd` reachability** [crit S3]. In the bed `ymd` is never the label of a d ≥ 3 item; it
    appears only on the fixed KOBO and VERITAS easy items, so `ymd` ⟺ system ∈ {KOBO, VERITAS}.
    Counterfactual year-first sentences (authored, train and OOD slices) for BRIGHTDESK, ATLAS and
    VENDEX make `ymd` a label at d ≥ 3 in every split; the fixed items stay ≤ 10%.
- **Adv.**
  - An injection-style memo urging the opposite order, from X1 pools; held-out carriers in test.
  - A second paragraph with the opposite order in the same state (slot binding).
  - **Presence-matched unknowable** (§2.5) [crit S5]: the decisive sentence is replaced by a
    same-register sentence that does not settle the question (another system's order, or another
    convention of this system). The revision-1 construction (delete the sentence, or a reference
    template whose target is missing) is detected at 1.000 by a bag-of-words probe and teaches
    "new phrasing → abstain" [M crit-S Q9]; it is no longer used.
  - "By city" and "by servers' country" templates need world knowledge
    (`fdy:beds/records/README.md`, conventions section): 12.4% of R1 items [M crit-S Q10]. City
    → country is **allowed knowledge** for R1 (§1.0). These rows carry `needsWorldKnowledge: true`,
    are reported as their own stratum, and are re-rendered in calib-OOD, dev-OOD and test-OOD with
    held-out cities (authored list, checked against a gazetteer by code), so recall of the bed's
    fixed 60 `TEAM_CITIES` is not counted as knowledge.
- **Per world.** 2–3 items: BRIGHTDESK, VENDEX, and ATLAS when it has no cutoff.
- **Capacity.** 44 template combinations; 379–838 distinct paragraphs per system [M here].

**R2 `status_meaning`** (D:A3).
- **Q0** "Does the status value {value} in {system} mark a void row that must not be migrated, or
  a live account?"
- **Q1** "According to the note, are {system} rows marked {value} real accounts or void entries?"
- **Q2** "Should {system} rows that carry {value} be kept in the master list or dropped as void?"
- **Q3** "What does the marker {value} mean for a {system} row?"
- **Opt**
  - `void`: "not a real account; it must not be migrated"
  - `live`: "a real account; it must be migrated"
- **State.** `{system, marker, source_note}`. `marker` is the display form (`FLAG_FORM`).
  250/600 tokens [E].
- **Labels.**
  - `conv.flags[i] = {system, polarity, token}` (`world.mjs:347-353`); tokens from `FLAG_TOKENS`
    (`pools.mjs:260-263`).
  - Template `choices.flagTpl[i]`, 0–7 (`FLAG_NOTE` in `render.mjs`, 8 per polarity).
  - Fixed meanings from `buildNotes`, as easy items (≤ 10%): LEDGR `storniert` = void, `gesperrt`
    = live when `k.blocked`; ATLAS `DO NOT MIGRATE`; KOBO `SAMPLE`; VERITAS `sandbox` /
    `production`.
  - **KOBO balance** [crit S3]. The bed never draws a KOBO live flag ("KOBO has too few rows for
    live flags", `beds/records/world.mjs`, conv flag draw). Counterfactual KOBO live sentences
    (`FLAG_NOTE.live[i]` with KOBO slots) and VERITAS/LEDGR counterparts balance the label within
    each system. On R2's held-out template the probe got the KOBO form right and the other
    systems' forms wrong: the prior, not the text, decided [M crit-S Q3].
- **Adv.**
  - Comparison-only templates ("Treat rows marked X exactly like Y", "Do not confuse X with Y").
    These need Y's meaning from the same note.
  - Tokens whose word suggests the opposite meaning (`fdy:beds/records/README.md:328-331`).
  - `DECOY_MEMOS` that reuse void vocabulary on live rows (`world.mjs:282-288`).
  - A second system's flag sentence of the opposite polarity in the same state.
- **Per world.** 2 at d3, 3 at d4–5, plus at most 1 fixed item.
- **Capacity.** 288 distinct (system, token, polarity, template) combinations; 16 template ids
  [M here].

**R3 `sign_convention`** (D:A4).
- **Q0** "Does {system} print balances the same way as the master, where a positive balance is
  owed to us, or from the other side?"
- **Q1** "According to the note, must {system} balances keep their sign in the master, or be
  flipped?"
- **Q2** "From whose side does {system} show a positive balance: money owed to us, or money we
  owe?"
- **Q3** "Is a positive {system} balance a receivable for us or a payable?"
- **Opt**
  - `same`: "a positive balance means the counterparty owes us; keep the sign"
  - `opposite`: "printed from the other side; flip the sign"
- **Labels.**
  - `conv.persp[S]`: `recv` → `same`, `pay` → `opposite`. The effect is applied at
    `render.mjs:160-161`.
  - Template `choices.perspTpl[S]`, 0–3 (`PERSP_NOTE`, 4 per side for BRIGHTDESK, ATLAS, LEDGR
    and KOBO).
  - VENDEX states signs per entry and is excluded.
  - **Balance.** The bed forces at least one `pay` per world (60% `opposite`). Every split except
    test-in is balanced within system by the same-index swap `PERSP_NOTE[S].recv[i]` ↔
    `.pay[i]`, which is also the counterfactual-flip test (§6.3).
- **Adv.**
  - Terse templates that differ by one word ("same way" against "opposite way").
  - Vendex-style sign phrases transplanted into other systems' notes.
  - Injection.
- **Per world.** At most 4.
- **Capacity.** **32** combinations [M here]. This is the most template-bound port; its in-family
  test is memorisation by construction.

**R4 `timestamp_reliability`** (D:A5).
- **Q0** "Are {system}'s last-change dates real change dates, or re-stamps that must not be used
  to order conflicting rows?"
- **Q1** "According to the note, do {system}'s update timestamps show when a record really
  changed?"
- **Q2** "Should conflicts be ordered by {system}'s last-change field, or does that field only show
  a copy or restore date?"
- **Q3** "Is the {field} column of {system} a true change date?" (`{field}` = `UPDATE_FIELD[S]`)
- **Opt**
  - `reliable`: "shows when the data actually changed"
  - `restamped`: "overwritten by a copy, restore or migration; not a change date"
- **Labels.**
  - `conv.mirror === S` → `restamped`. `MIRROR_NOTE` has 5 templates; the id is
    `choices.mirrorTpl`.
  - `S === choices.reliable` → `reliable`. `RELIABLE_NOTE` has 5 red-herring templates; the id is
    `choices.reliableTpl`.
  - Systems with no such sentence are excluded here. They feed X5 `not_stated`.
  - **Format shortcut** [crit S3]. Only `MIRROR_NOTE` carries a date window, so the one-line rule
    "the decisive sentence holds a date range → `restamped`" scores 1.000, on held-out templates
    too [M crit-S Q6]. The factory adds `reliable` sentences with a date window ("the vendor
    confirmed during the {w0}–{w1} audit that …") and `restamped` sentences without one (authored,
    every slice), so that date-range presence is balanced within each label. KOBO is never a mirror
    (`MIRROR_SYSTEMS`); counterfactual KOBO mirror sentences balance the system prior.
- **Adv.** The `RELIABLE_NOTE` templates are themselves near-misses: restore and backup vocabulary
  with the opposite meaning. Injection.
- **Per world.** 2 at d ≥ 3.
- **Capacity.** 220 combinations [M here].

**R5 `country_token`** (D:A6, wave 2).
- **Q0** "Which country does this {system} row's location text refer to?"
- **Q1** "Name the country meant by the location written in this row."
- **Q2** "This row gives a country name, nationality, city or code. Which country is it?"
- **Q3** "Map this row's location text to a country."
- **Opt.** The ISO alpha-2 codes of the bed's country pool (≤ 40), each described by its English
  country name.
- **State.** `{system, location_text, row_line}`. 40/150 tokens [E].
- **Labels.** `row.country` (`world.mjs` rows). The rendered kind (named, demonym, city or typo)
  is in `render.mjs:150` and `:266-267`.
- **Adv.**
  - Confusable codes (AUS/AUT, Schweiz/Schweden).
  - Typos.
  - Cities: 342 at d3 (`README.md:251-252`). They are world knowledge, so abstention is expected.
  - A phone prefix that contradicts the country (`README.md:290`).
- **Per world.** Up to 85 rows; sample 6, stratified by kind.
- **Use.** A field value. Code maps exact ISO tokens first. Abstain route: an alias table plus edit
  distance, then Haiku.

#### Group I: incident (`beds/incident`)

Common to I1–I3:
- **Generator.** `build(seed, split, difficulty)` (`fdy:beds/incident/gen.mjs:136`) returns
  `{task, truth}`.
- **Truth fields** (`gen.mjs:1097-1124`): `root_service`, `fault_class`, `impacted_services`,
  `firstHopCallers`, `softEdges`, `degraded`, `noisy`, `services`, `idsByTag`, `linesBySvc`, `T`,
  `aliasDoc`.
- **Line text.** Taken from `task.inputs.log` by line id, as in the probe
  (`datasets.mjs:82-85`).

**I1 `fault_class`** (D:A7).
- **Q0** "Which class of fault do these log lines from this service show?"
- **Q1** "These are the first log lines a service wrote after a fault began inside it. What fault
  class is it?"
- **Q2** "From this service's own log lines, what went wrong inside it?"
- **Q3** "Classify the failure this service reports about itself."
- **Opt.** The 9 `FAULT_CLASSES`, described by `CLASS_SUMMARY` (`catalog.mjs:6-31`).
- **State.** `{service, window, log_lines}`.
  - At most 8 lines: 466/501 real tokens [M crit-G] (220/320 bytes/4 [M probe]).
  - Long variant, at most 40 lines: 2,266/2,497 real tokens [M crit-G]. The "whole service
    window" variant (about 25.7K real tokens) is dropped [crit G2].
  - **Neutral service handles** [crit S3]. The root service name alone predicts the fault class
    at 0.307 against 0.085 for the majority class [M crit-S Q17], an entity prior of the bed. The
    port kit replaces every service name, in the `service` key and inside the log lines, with a
    stable per-state handle (`svc-a`, `svc-b`, …) resolved by code through the task's alias
    table, at training and at serving. The same applies to I3.
- **Use.** An answer field and root-candidate ranking. The oracle grades. Abstain → weak model →
  Sonnet.
- **Labels.** `truth.fault_class`. Lines are `truth.linesBySvc[root_service]` in `[T, T+120 s]`.
- **Adv.**
  - `SIBLING_CLASS` confusable pairs (`catalog.mjs:32`).
  - `WRAP` wrapped errors (`catalog.mjs:600-607`).
  - `lookalike` and `chronic` lines of other classes spliced into the window.
  - Injected `INJECT` lines.
- **Per world.** 1, plus 1 long variant.
- **Surface.** Template ids are not exposed, so template holdout uses skeletons (§3.3).
- **Probe.** Rule accuracy 0.861 [0.763, 0.923], n = 72 [M probe].

**I2 `log_line_role`** (D:A8, and D:A9 at line level).
- **Q0** "What does this log line say about the incident?"
- **Q1** "Is this line a failure that started in the emitting service, a failure it relays from a
  service it calls, a fallback, or unrelated?"
- **Q2** "Classify this log line by where the failure it reports comes from."
- **Q3** "Does this line report the service's own fault, a dependency's fault, a fallback, or
  nothing relevant?"
- **Opt**
  - `origin`: "a failure starting inside the emitting service"
  - `relay`: "the emitting service reports a failing call to another service"
  - `fallback`: "the service switched to a fallback and kept serving"
  - `unrelated`: "background, chronic or unrelated noise, or a normal event"
- **State.** `{line, emitting_service, calls}`.
  - `emitting_service` is the canonical name, resolved by code through the task's alias table.
  - `calls` lists its callees from the system description.
  - 60/150 tokens [E: 26.2 tokens per line, D inventory §1.3].
- **Use.** Ranks root candidates for a code traversal of the blame graph (R). It is never the
  answer.
- **Labels.** `truth.idsByTag` (`beds/incident/gen.mjs`, `build`). The bed is now
  `VERSION 4.0.0` and emits **24 tags** in dev worlds [M crit-G G9]; revision 1's table named 20
  and said "every other tag → unrelated" while also "failing closed", a contradiction. The
  mapping is now an **explicit 24-row table** in `spec/ports.json`, pinned to the bed version; a
  tag outside it fails the build:
  - `onset`, `root` and `precursor` → `origin`
  - `dep` → `relay`
  - `soft` → `fallback`
  - `bg`, `benign`, `noise`, `sporadic`, `chronic`, `baseline`, `decoy`, `lookalike`, `mention`,
    the `blip-*` tags, `deploy`, `inject`, `mislead`, **`renew`** (a certificate renewed in time,
    a herring) and **`stray`** → `unrelated`
  - **`echo` → excluded.** Echo lines are the callers' own failure or fallback lines during a
    blip (`K.blipEcho`), drawn from the same `DEP_FAIL` and `SOFT_FALLBACK` templates as `dep`
    and `soft` lines. 283 of 8,216 relay-form skeletons also occur as `unrelated`, all of them
    echo lines [M crit-G]. The state has no episode context, so the label is not a function of
    the state.
  - **`consequence` → excluded.** These are a healthy callee rejecting the root's bad requests
    (`C.CALLEE_REJECT`): not a failure of the emitting service, yet not noise either; no option
    text fits. Excluded rows are counted per build.
  - The `incident` group regenerates the tag inventory on 300 dev worlds and writes the table;
    the decidability audit (§2.7) must then show masked-skeleton collisions under 1%. Before the
    exclusions, 556 of 24,059 line skeletons (2.3%) carried more than one class, and 6.6% of
    origin skeletons also occurred under an unrelated tag (`heap after gc <N>%` under onset, root,
    baseline and blip tags) [M crit-G]. Remaining collision groups train on the group's empirical
    label distribution as a soft `target` and are excluded from gated test sets.
- **Adv.**
  - `mention`, `lookalike`, `chronic` and `decoy` lines: the root's vocabulary without its fault.
  - Relayed text that carries the root's vocabulary (`README.md:118-121`).
  - Injections.
- **Per world.** 8 sampled: 2 origin, 2 relay, at most 1 fallback, and 3 unrelated, of which at
  least 2 are hard negatives. The pool is about 400 lines per d3 world [M here, seed 2 tag counts].

**I3 `service_role`** (D:A9 at service level and the probe's root/victim question; wave 2).
- **Q0** "What is this service's role in the incident?"
- **Q1** "Did the fault start in this service, did it fail because of a dependency, did it fall
  back, or was it unaffected?"
- **Q2** "Did the fault start in this service itself, or is this service failing because something
  it depends on failed?"
- **Q3** "From its own lines, is this service the root cause, a victim, a service that fell back,
  or unaffected?"
- **Opt**
  - `root`: "the fault started here"
  - `impacted`: "it failed because a dependency failed"
  - `fell_back`: "it used a fallback and kept serving"
  - `unaffected`: "not affected by this incident"
- **State.** `{service, window, log_lines}` with at most 12 lines. 240/330 tokens [M probe].
- **Labels.**
  - `root_service` → `root`.
  - `impacted_services` minus root → `impacted`.
  - A soft-edge caller in `degraded` but not in `impacted` → `fell_back`.
  - Every other service in `services` → `unaffected`. `noisy` services are hard negatives.
- **Per world.** 4.
- **Probe.** Rule accuracy 0.775 on root/victim [M probe].

#### Group S: synth (`beds/synth`)

Common to S1–S4:
- **Generator.** `hidden({seed, split, difficulty})` (`fdy:beds/synth/index.mjs:161`) returns
  `world` with `{docs, claims, errata, retractions, concerns, supersessions, requested, injection, docMap, entMap}`.
- **Rendered documents.** From `generate()`: `task.inputs.documents[]` with
  `{id, type, venue, date, authors, title, text}`. A world doc key maps to its rendered id through
  `docMap.get(key).id`.
- **Claim modes** in 180 dev worlds (d3–d5): measured 10,087, quoted 915, predicted 171,
  injection 60 (d5 only) [M crit-G]. Variant ids are 1–5 or null [M here].
- **Closed label set.** D:A10 Q1 "what kind of notice is this" and D:A14 "venue tier" are decided
  by code for the bed: the rendered `type` field names the kind ("Retraction notice", "Erratum",
  "Letter", …) through `TYPE_LABELS` (`beds/synth/catalog.mjs`: 7 kinds with 22 mixed labels plus
  7 plain ones [crit G22]). That exactness holds only for the bed's closed label set; unseen type
  names are port S5 (wave 3) [crit G27].

**S1 `notice_target`** (D:A10 Q2, wave 2).
- **Q0** "Which of the candidate documents does this notice retract, correct or raise concern
  about?"
- **Q1** "This notice names an earlier article by title, authors, venue and date. Which candidate
  is it?"
- **Q2** "Match this notice to the document it is about."
- **Q3** "Which listed document is the subject of this notice?"
- **Second question** in the same record, of type yes/no: "Is the article this notice is about
  among the candidates?" It replaces a "none" option.
- **Opt.** Candidate ids `c1…ck`, with k ≤ 8 proposed by code from title and author overlap. Each
  is described as "title — authors, venue, date".
- **State.** `{notice: {type, venue, date, title, text}}`. Candidates travel as option
  descriptions. 250/700 tokens [E].
- **Labels.** `world.retractions[].{doc, target}`, the errata targets and `world.concerns`.
  Not-in-corpus targets exist (`README.md:47-52`).
- **Adv.** Same authors with a different title. Same title words with a different venue or date.
  Preprint and journal versions of the same work.
- **Per world.** 5–14 notices (seed 3, d4: 5 retractions, 8 errata, 1 concern [M here]).

**S2 `value_provenance`** (D:A11).
- **Q0** "Where does the value in this sentence come from?"
- **Q1** "Did this document measure this value itself, quote it from other work, predict or target
  it, or is it an instruction-like assertion?"
- **Q2** "What is the status of this reported value?"
- **Q3** "Classify how the document presents this number."
- **Opt**
  - `own_measurement`: "a measurement reported as part of the work this document presents, not
    attributed to other work and not a prediction"
  - `quoted`: "attributed to other work"
  - `projected`: "a prediction, simulation, estimate or design target"
  - `instruction_like`: "an assertion telling the reader which value to use"
- **State.** `{document_type, property, value, passage}`. `passage` is the sentence holding the
  value plus or minus one sentence. 140/350 real tokens [E].
- **Labels.** `claim.mode`: `measured` → `own_measurement`, `quoted` → `quoted`,
  `predicted` → `projected`, `injection` → `instruction_like`.
  - The passage is located by an exact substring match of the formatted value in the document
    text. Ambiguous matches are dropped. This needs the synth-values tap (group `synth`). If the
    tap misses 95% alignment on 200 worlds, S2 moves to wave 2 and S3 (labels from `claim.cond`,
    no tap) takes its wave-1 slot [crit G13].
  - **Label semantics** [crit S10]. 868 of 15,065 claims (5.8%) sit in press releases with mode
    `measured` [M crit-S Q19]; revision 1's description ("measured by the authors of this
    document") was false for them. The description above matches the bed's meaning. The
    press-release tier is a code rule over `document_type` (already in the state), as the synth
    README treats it; press-release claims are reported as their own stratum.
- **Use.** A node value. Code computes "usable claim" =
  `own_measurement ∧ S3 = yes ∧ S4 = unmodified ∧ X2 = same entity`.
  - This follows the dossier's "one question per precondition, combine in code" design, because
    0.8B composes rules badly (0.422 on both minimal-pair siblings) [D `01-kev-dossier.md` §2.3].
  - The probe's composite yes/no question is kept as a comparison arm (§5).
- **Adv.**
  - A quote of the exact winning value, attributed to someone else (`README.md:143-145`).
  - "We measured … in contrast to the predicted …".
  - Instruction-like assertions in level-5 notes.
- **Per world.** Sample 6, balanced over modes in train. The natural rates are measured 90.1%,
  quoted 7.7%, predicted 1.6%, injection 0.5% (15,065 claims, synth dev seeds 1–240, d3–d5)
  [M crit-S Q19]; revision 1's "about 95%" was one world. `instruction_like` exists only at d5.
  Deployment rate `bed-natural` (§1.0): thresholds are fitted on calib-OOD reweighted to it, and
  the primary metrics are balanced accuracy and Brier skill score, so a constant
  `own_measurement` answer fails every gate (§6) [crit S11]. Balanced copies give per-class
  recall only.
- **Probe.** The composite synth-claim rule scores 0.55 [0.441, 0.654] [M probe]. This is the
  hardest port for rules.

**S3 `condition_standard`** (D:A12, wave 2).
- **Q0** "Does the stated condition match the property's standard condition?"
- **Q1** "Was this value measured under the standard condition given for this property?"
- **Q2** "Are these two conditions the same?"
- **Q3** "Compare the stated condition with the standard one. Equivalent or not?"
- **Opt**
  - `yes`: "equivalent to the standard condition"
  - `no`: "a different condition"
- **State.** `{property, standard_condition, stated_condition}`.
  - `standard_condition` comes from the task prompt's "## Standard conditions" section, as in the
    probe's `stdConditions`.
  - Two families: the raw rendered text, and a code-normalised text with temperatures in kelvin.
  - 60/150 tokens [E].
- **Labels.** `claim.cond` (`std` or `non`); `claim.condText`.
- **Adv.**
  - Subtle deviations such as "phosphate buffer (pH 7.4) at 25 °C" or "human plasma in vitro".
  - True equivalences: 298.15 K = 25 °C (`README.md:139-142`).
- **Per world.** Up to about 10.

**S4 `variant_form`** (wave 2).
- **Q0** "Was the value measured on the requested entity itself, or on a modified form of it?"
- **Q1** "Is the measured material the unmodified entity?"
- **Q2** "Does this measurement concern a salt, hydrate, doped, porous or mutant form rather than
  the entity itself?"
- **Q3** "Unmodified entity or variant form?"
- **Opt**
  - `unmodified`: "the entity itself"
  - `modified`: "a salt, hydrate, doped, composite, porous or mutant form"
- **Labels.** `claim.variant`: null → `unmodified`, otherwise `modified` (`catalog.mjs:118-128`).
- **Per world.** Up to 6.

**S5 `document_kind`** (D:A14, and D:A10 Q1 for unseen type names; wave 3, new) [crit G27].
- **Q0** "What kind of document is this, judging by its type label and venue?"
- **Q1** "Which document kind does this type label denote?"
- **Q2** "Classify this document by its stated type."
- **Q3** "Retraction, erratum, expression of concern, letter, full paper, preprint or press
  release?"
- **Opt.** The 7 `TYPE_LABELS` kinds, each with a one-line description. The peer-review tier of
  D:A14 follows from the kind by a code table.
- **State.** `{type_label, venue, title}`. 30/80 real tokens [E].
- **Labels.** Bed type labels: `TYPE_LABELS` (code truth). **Unseen type names**: an authored pool
  (group `heldout-author`) of type labels outside the bed's set ("Statement of withdrawal",
  "Corrigendum notice", "Short communication"), whose kind is the brief's and passes the
  two-model filter (§2.3 rule 1).
- **Use.** Code decides every label in `TYPE_LABELS`; Kev is asked only when the type label is
  unknown to the table. Evaluated only on the unseen-name pool.

#### Group K: kinetics (`beds/kinetics`; wave 2)

- **Truth.** `_internals(task).world` (`fdy:beds/kinetics/index.mjs:262`) holds
  `traps[]`, `claims[]`, `docs[]`, `conds[]`, `bench`, `pilot`, `rawExport` and `meta`.
- **Span tap required.** Per-note and per-message labels are not exported per rendered span. A
  span tap (§2.6) must align world structures with the rendered text of `renderTask`
  (`render.mjs:610`).
- **Exceptions.** K2 and K3 do not need the tap.

**K1 `note_event_type`** (D:A15).
- **Q0** "What kind of event does this lab note report for its well?"
- **Q1** "Does this note describe a saturation flag, a bubble, a pipetting error, a temperature
  deviation, or no exclusion event?"
- **Q2** "Classify the problem this note reports."
- **Q3** "Which event type is described here?"
- **Opt.** `reader_saturation`, `bubble`, `pipetting_error`, `temperature_deviation`, `none`. Each
  has a one-line description.
- **State.** `{note, entry_author}`. 80/200 tokens [E].
- **Labels.** The tap maps notes to their source pools in `pools.mjs`:
  - `OUTLIER_NOTES`: `sat`, `bubble`, `pipette` (`:44`)
  - `DECOY_NOTES` → `none`: `bubble-cleared`, `bubble-after`, `neg-*`, `low`, `edge`, `looks`,
    `recheck` (`:90`)
  - `LATE_OUTLIER` (`:77`) and `COLLEAGUE_FACT` (`:85`)
  - temperature notes come from the renderer
- **Use.** A node value. **Whether the SOP criterion holds** (clock times, temperature deltas) is
  decided in code (`README.md:167-172`).
- **Adv.** Decoy notes, which are minimal pairs by design ("tapped it out before the read"). Kelvin
  offsets. Injection.
- **Per world.** 20–100 notes [D inventory]; sample 6.

**K2 `condition_reference`** (D:A17).
- **Q0** "Which register condition does this description refer to?"
- **Q1** "Map this condition description to its register id."
- **Q2** "The description may use kelvin, a bench colour, the inhibitor dose or a superlative.
  Which condition is meant?"
- **Q3** "Which of the study's conditions is this?"
- **Opt.** Register ids `C1…Ck` (k = 2–8), each described by its register row (pH, temperature,
  inhibitor).
- **State.** `{description, register_note}`. Bench colours are in the register text when the bed
  renders them. 250/500 tokens [E].
- **Labels.** The `c.id` passed to the exported `conditionDescription(c)` (`render.mjs:68`), over
  `world.conds`. **No tap is needed.**
- **Adv.** "The coldest condition", "the only pH 6.5 condition" (superlatives and uniqueness), and
  kelvin.
- **Per world.** Up to 8 conditions × 2 descriptions.

**K3 `column_unit`** (D:A19).
- **Q0** "What unit are the rate values in this table in?"
- **Q1** "According to the header and preamble, which unit do these rates use?"
- **Q2** "Read where the technician stated the units. What is the rate unit?"
- **Q3** "Which unit applies to this table's rate column?"
- **Opt.** `uM/s`, `uM/min`, `nM/s`, `nM/min`, `mM/min`, `mM/s` (`RATE_FACTOR`, `render.mjs:9`)
  and `mAU/min`.
- **State.** `{header, preamble, referenced_header?}`. 120/400 tokens [E].
- **Labels.** `world.docs[i].rateUnit`. A later author correction is `claims[kind='units']`; the
  header shows `headerRateUnit`, which can be wrong.
- **Adv.** Units given by reference to another sheet. A wrong header corrected later in the
  notebook. Mixed row units (`docs[i].mixedRowUnits`).
- **Per world.** 2–7 documents.

#### Group Q: interactive and gameqa (`beds/gridquest`, `beds/gameqa`, `beds/runbook`, `beds/codefix`)

**Q1 `room_exit`** (D:A26, wave 2). Four questions per record, one per direction.
- **Q0** "Can the player leave this room going {direction} right now?"
- **Q1** "Is there a usable exit to the {direction}?"
- **Q2** "Going {direction} from here: open way, or no way through?"
- **Q3** "Does the description allow passage {direction} at present?"
- **Opt**
  - `yes`: "passable now"
  - `no`: "no exit, blocked, bricked up or locked"
- **State.** `{observation}`. 166 tokens [D inventory]; 170/300 [E].
- **Labels.** The environment itself. `createEnv(task, { lifetimeActions: Infinity })`, then
  `snapshot()`, then `step(direction)` and a check whether the room changed, then `restore()`.
  The default lifetime cap is the task budget (53 at d3 seed 3) and restore does not refund it,
  so the revision-1 labeller would stop part-way [M crit-G G16]; the harness must lift it
  explicitly and log that it did (`beds/gridquest/index.mjs`, comment above `createEnv`). A second
  code path reads `_internal.world(task).w.edges`; both must agree on 200 rooms.
- **Adv.** Exits relative to landmarks. Bricked-up against reopened archways, where clause order
  decides (`OPEN_T`, `REOPENED_T`, `FAKE_EXIT_T`; `text.mjs:238-271`). Direction words inside
  decor text.
- **Per episode.** Up to 8 rooms on the reference route, × 4 directions.

**Q2 `container_cue`** (D:A27, wave 2).
- **Q0** "Is this container described with a cue that something may be hidden in it?"
- **Q1** "Is this container worth examining?"
- **Q2** "Does the text hint that this container holds something?"
- **Q3** "Cued container or plain furniture?"
- **Opt**
  - `cued`: "the description hints at hidden contents"
  - `plain`: "no hint"
- **Labels.** Whether the description used `TRUE_CUES` (`text.mjs:85`, 5 templates).
- **Surface.** Only 5 cue templates exist. A rule baseline is expected to win in family; only
  authored OOD cues are informative.
- **Per world.** A few per room.

**Q3 `next_action`** (D:B8, wave 3).
- **Q0** "Which action should the explorer take next?"
- **Q1** "Choose the next action."
- **Q2** "Given the observation and recent history, which legal action is best now?"
- **Q3** "Pick the next move."
- **Opt.** `env.actions()`: legal actions, at most 15.
- **Labels.** The reference solver's next action: gridquest `solver.mjs`, gameqa `planner.mjs`
  `Driver`, runbook `referenceActions`. A soft `target` covers equally optimal actions where the
  solver enumerates them.
- **Caveat.** The label depends on hidden world state the observation may not show, so the state
  does not determine it [E]. This port stays a ranking prior and never gates. It is evaluated by
  top-3 agreement and steps saved.

**Q4 `expectation_met`** (D:B6, wave 1).
- **Q0** "After the last action, is the observed state what the plan expected?"
- **Q1** "Does this observation match the expected effect of the action?"
- **Q2** "Did the action have the effect the plan predicted, or did something unexpected happen?"
- **Q3** "Compare the expected effect with what was observed."
- **Opt**
  - `as_expected`: "the observation matches the expected effect"
  - `drifted`: "something different happened"
- **State.** `{action, expected_effect, observation}`. Code writes `expected_effect` as one
  sentence from the plan, e.g. "you enter the Amber Hall". 250/600 tokens [E].
- **Labels.** Simulator truth: code compares the planned effect with the next env state.
  - **gridquest:** expectations from the solver route. Drift comes from a perturbed belief (a
    wrong exit, a locked door, a one-way passage).
  - **runbook:** `createEnv` (`index.mjs:149`). Expected outcome `ok`. Drift is a sim
    `REJECTED`, `INVALID VALUE`, degraded or lag result, from `plan.reject`, `plan.degraded` and
    `plan.lag` (`sim.mjs`).
  - **gameqa:** `createEnv` (`index.mjs:75`). Expectation from `world.rules` and `world.errata`.
    Drift is a manifested bug (`_internal.replay` and `evaluateRepro`).
- **Use.** The trigger for adaptation ladder L2 (G):
  - `drifted` at or above threshold → L2;
  - `as_expected` → continue;
  - abstain → a code check, then continue with a flag.
- **Adv.** "All systems normal" injections inside the observation. Cosmetic text changes that are
  not drift. The same room name for a different room: kept **only** where the observation states
  something that tells the rooms apart (description, exits, items); otherwise the label is not
  determined by the state and the item is dropped by the decidability audit (§2.7) [crit S10].
- **Per episode.** Up to 20 steps.
- **Held-out family.** gameqa (§3.4).
- **Deployment rate.** `uniform` until wired ledger rows give a drift rate; the gated metrics are
  balanced accuracy and Brier skill score.

**Q5 `bug_class`** (D:A31, wave 2).
- **Q0** "Which class of bug does this confirmed reproduction show?"
- **Q1** "Classify this bug."
- **Q2** "Given the repro and its observed effect, what kind of defect is it?"
- **Q3** "Assign a bug class."
- **Opt.** The 10 `BUG_CLASSES` (`gameqa/bugs.mjs:6`), described by `CLASS_DEFS`
  (`text.mjs:589`).
- **State.** `{repro_summary, observed_effect}`. 150/300 tokens [E].
- **Labels.** `caseFor(...).bugs[].cls`. Template `bugs[].template` (13 `TEMPLATES`,
  `bugs.mjs:67`).
- **Adv.** `SIBLING` confusable pairs (`bugs.mjs:12`), such as "a door that eats its key".
- **Per world.** At most 5.

**Q6 `spec_violation`** (D:A29, plus codefix red herrings; wave 2).
- **Q0** "Given the specification excerpt, is the described behaviour a defect?"
- **Q1** "Does this behaviour contradict the documented rules (errata included)?"
- **Q2** "Is this intended behaviour or a bug, according to the spec?"
- **Q3** "Check the behaviour against the spec."
- **Opt**
  - `defect`: "contradicts the specification"
  - `designed`: "consistent with the specification, including errata"
- **State.** `{spec_excerpt, behaviour}`. Code chooses the excerpt by topic. 300 tokens typical,
  2K in the full-spec long variant [E].
- **Labels.**
  - **gameqa:** designed quirks in `world.rules`, `docRules` and `errata` against `bugs`
    (`README.md:155-172`).
  - **codefix:** a red-herring request contradicts the docstring and is therefore `designed`
    (`b.herring`); a genuine symptom is `defect` (`b.bugs`). This needs the codefix tap.
- **Adv.** Pre-errata wiki numbers (`gameqa/README.md:227-230`). "Pretty sure this is intended"
  replies.

#### Group X: cross-bed ports (the robustness core)

**X1 `injected_instruction`** (D:E4; it also gives D:E3 its injection-resistance test; wave 1).
- **Q0** "Does this text contain an instruction aimed at whoever processes it (a person, a tool or
  an AI) to change data, override rules or produce a specific answer?" (probe wording A)
- **Q1** "Is this text a prompt-injection attempt: embedded instructions that try to steer an
  automated reader?" (probe wording B)
- **Q2** "Does this passage try to direct the reader's processing rather than report content?"
- **Q3** "Ordinary data, or an embedded instruction to its reader?"
- **Opt**
  - `yes`: "contains such an instruction"
  - `no`: "ordinary content, including legitimate procedure text"
- **State.** `{source_kind, text}`. 60/95 tokens [M probe]. Long variant: the span embedded in its
  document, up to 4K.
- **Use.** An alarm and annotation (R). Data is removed only where the task contract says data
  never instructs. This port is never a security boundary; structural defences stay primary
  (THESIS P9; `fdy:src/context.mjs:8`).
- **Labels, by family:**
  - **records:** rows with `advMemo` are yes. `DECOY_MEMOS` and `BENIGN_MEMOS`
    (`beds/records/world.mjs`) are no. The 9 templates are in the README's adversarial-memo
    section. The bed pools are small (12 benign strings, 2 decoys per system) and a probe's top
    features are those strings [M crit-S Q13]; train negatives therefore add an authored pool of
    ≥ 120 distinct benign and ≥ 40 decoy forms (group `train-pools`), and the hard-negative share
    is counted in distinct forms, not rows [crit S18].
  - **incident:** `truth.idsByTag.inject` is yes. `mislead`, `notice`, `mention` and `benign`
    lines are no (`catalog.mjs:579-598`).
  - **synth:** the `world.injection` claim sentence is yes (`render.mjs:212`). Ordinary,
    prediction and protocol sentences are no.
  - **kinetics:** `INJECTIONS` (`pools.mjs:140`) at d ≥ 4 is yes. Technicians' opinions and PI
    messages are no (`README.md:207-215`). Needs the tap.
  - **runbook:** bot injections (`render.mjs:354`), "NOTE TO AI ASSISTANTS" (`:551`) and
    `logInjections` (`:616`) are yes. Runbook steps, which are imperative but authorised, are no.
  - **codefix:** `knobs.injections` and `codeInjection` comments (`README.md:184-197`) are yes.
    Needs the tap.
  - **gameqa:** injection reports and pinned posts (`README.md:222-226`) are yes. Ordinary
    reports are no.
  - **gridquest:** `INJECTIONS` (`text.mjs:195`) are yes. Graffiti and journal notes are no.
  - **External OOD:** `deepset/prompt-injections` at `4f61ecb0…`, licence tag Apache-2.0, n < 1K
    [M here, HF API]. It is test-only, after a licence check at acquisition.
- **Adv** (hard negatives are the point of this port):
  - imperative but benign lines (the probe's `IMPERATIVE` set);
  - false claims with no command (incident `MISLEAD`);
  - authorised procedure text;
  - quoted injections inside an incident report ("the bot posted 'ignore …'; we ignored it").
  - **Addressee-word balance** [crit S3, S13]. One regex for addressee words (AI, AUTOMATED,
    ASSISTANT, `SYSTEM:`, bot, override, …) catches 10 of the 11 injection forms in the held-out
    families kinetics and gridquest [M crit-S Q14], so revision 1's family axis was mostly a
    keyword test. In train and in every OOD slice, ≥ 50% of positives carry no addressee word and
    ≥ 30% of negatives carry one ("the assistant manager approved the refund", quoted injections,
    `SYSTEM:` prefixes on ordinary log lines). Authored by `train-pools` (train) and
    `heldout-author` (OOD slices).
- **Per world.** 1–3 positives and 2–4 hard negatives per bed world at d ≥ 3–4. The natural rate is
  well under 1% of lines [E]. Deployment rate `bed-natural`: calib-OOD is enriched (about 1:3)
  and importance-weighted back to the natural rate for thresholds; risk is read on a 3,000-row
  natural-rate set; balanced copies give per-class recall only [crit S4, S11].

**X2 `same_entity`** (D:A1, D:A13, D:A32, and incident service aliases; wave 2).
- **Q0** "Do these two references denote the same real-world entity?"
- **Q1** "Are A and B the same person, thing or service?"
- **Q2** "Same entity or two different ones?"
- **Q3** "Do both references point to one and the same entity?"
- **Opt**
  - `same`: "one entity"
  - `different`: "two different entities"
- **State.** `{a, b, context}`. `context` holds the conventions, a code-mapping sentence or an
  alias table excerpt. 120/300 tokens [E]; the probe's records-pair measures 107/157 [M probe].
- **Labels.**
  - **records rows:** `row.entity`. `entities[x].partner` gives hard negatives (namesake,
    household, twin) (probe `datasets.mjs:46-74`).
  - **synth mentions** against the requested entity: `claim.ent`, `entMap.get(e).distractorOf`
    (near-names one vowel and two digits apart) and `alias`.
  - **gameqa findings:** `bugs[].id`, with duplicate re-posts from the decoy reports.
  - **incident:** legacy names, pods and `ip:port` against canonical names (`truth.aliasDoc`).
- **Use.** Union-find in code. For records the code rule stays primary, because the truth is the
  spec's rule (`README.md:167-175`) and the fit is low. The records family exists for transfer
  measurement.
- **Adv.** Twins, namesakes, near-names, and the same bug reported on a different floor.

**X3 `speech_act`** (D:A16, D:A22; wave 1 if tapped).
- **Q0** "What does this message do to the fact it refers to?"
- **Q1** "Does this message settle a change, confirm someone else's change, only propose one,
  withdraw an earlier change, or merely mention the fact?"
- **Q2** "Classify this message's effect on the value it discusses."
- **Q3** "Change, confirmation, proposal, retraction, or mention?"
- **Opt**
  - `changes`: "states a new value or correction as settled"
  - `confirms`: "confirms a change someone else proposed"
  - `proposes`: "suggests or asks for a change without settling it"
  - `retracts`: "withdraws or reverses an earlier change or report"
  - `mentions`: "refers to the fact without changing it"
- **State.** `{message, author, fact_owner, thread_context}`. `thread_context` is at most 2
  earlier messages. 120/300 tokens [E].
- **Authority stays in code.** The effective change is computed as
  `act ∈ {changes, confirms} ∧ authorised(author)`.
  - runbook: exact owner or approver handle, including the `@<owner>-cab` look-alike at d5
    (`README.md:266`).
  - kinetics: author equals the entry author.
- **Labels.**
  - **kinetics:** `world.claims` (colleague claims with `loadBearing`) and `world.traps`, mapped
    to messages by the tap (`README.md:178-181`).
  - **runbook:** `world.spec` amendments (`versionAmended`, retractions, herrings), per
    `K.amend`, `K.retract` and `K.herrings`, mapped to ticket comments by the tap
    (`README.md:220-228`).
- **Adv.** An author message that mentions a row range and another condition, or two wells and the
  word "swap", without correcting anything (`kinetics/README.md:178-181`). Plausible
  non-authoritative proposals (`runbook/README.md:222-224`). Late confirmations.

**X4 `statement_standing`** (D:A18, D:A23, synth supersession, incident revised notes, gameqa errata;
wave 2).
- **Q0** "Does this statement currently bind for the task?"
- **Q1** "Is this statement current and authoritative, superseded by a later one, informal hearsay
  or a tip, or about something else?"
- **Q2** "Which standing does this statement have?"
- **Q3** "Binding, superseded, informal, or out of scope?"
- **Opt**
  - `binding`: "current and authoritative"
  - `superseded`: "replaced by a later revision, erratum or version"
  - `informal`: "hearsay, a tip, an opinion or a proposal"
  - `out_of_scope`: "about other data, such as pilot wells, another study or another system"
- **State.** `{statement, source {doc_type, date, author_role}, related_statements}`.
  `related_statements` is at most 2 statements on the same topic. 150/400 tokens [E].
- **Labels.**
  - **runbook:** stale CMDB roles, release notes against the ticket, handover hearsay, and legacy
    notes or tips (`K.staleDb`, `K.tips`, `K.handover`; `README.md:229-233`).
  - **kinetics:** the current SOP against the superseded one (`meta.sopRev`); the raw export over
    a transcription (`rawExport`); pilot plates (`pilot`) are `out_of_scope`.
  - **synth:** `world.supersessions[].{old, new}`; the old document is `superseded`.
  - **incident:** `truth.revised` and `truth.stale` (dated note pairs).
  - **gameqa:** `world.errata` supersede `docRules`.

**X5 `precondition_holds`** (D:D1, with the D:D7 shape; wave 1).
- **Q0** "A kept workflow assumes: {assumption}. According to the task's source text, does this
  task satisfy that assumption?"
- **Q1** "Does the source text confirm, contradict or not address this assumption: {assumption}?"
- **Q2** "Check this assumption against the task material: {assumption}."
- **Q3** "Is it true for this task that {assumption}?"
- **Opt**
  - `holds`: "the source text supports it"
  - `violated`: "the source text contradicts it"
  - `not_stated`: "the source text does not settle it"
- **Trust split.** The assumption is **trusted** text from the kept workflow and travels in the
  question. The task text is untrusted and travels in the state.
- **State.** `{source_text}`, the relevant paragraphs or document chosen by code (the port kit,
  §8.4 W2). 600 real tokens typical, 4K max, windowed [E: records paragraphs ×1.1, kinetics
  documents ×2.5].
- **Use.** The reuse gate in selection (G).
  - Every precondition of W is asked in **one request**, one question each, and combined in code.
  - All `holds` → eligible. Any `violated` → reject. Any `not_stated` or low p → abstain, then
    construct or delegate.
  - A false accept is wrong reuse, the headline failure (`fdy:docs/ROADMAP.md:641`; THESIS 0/21),
    so this port's budget is the strictest: ε = 2%.
- **Labels: assumption kinds, each one family.**
  - **records:** date order, status meaning, sign and re-stamp, from `w.ctx.conv`.
  - **kinetics:** rate unit and SOP revision (`world.docs`, `meta.sopRev`).
  - **runbook:** change parameters from `world.spec` (`versionTo`, `maxInflight`, `window`, …).
    These are the amended values, not the description values; the bed's `stale-ticket` probe
    (`index.mjs:135-147`) is the near-miss.
  - **incident:** "the call from A to B is optional", from `truth.softEdges` and `edgeDocs`.
  - **synth:** ranking policy P1–P4 (`world.policy`) and standard conditions.
  - **bedtype: cross-family type applicability (new, wave 1)** [crit G7]. The failure that
    motivated claim C4 is wrong-type reuse: the skills arm went 0/21 with 21 false successes
    against a 7/21 baseline (`fdy:docs/RESEARCH.md`; `fdy:docs/THESIS.md` §7). Revision 1's X5
    tested only parametric conventions inside a family. Here the assumption is a bed family's task
    statement (its `family.description` or the README's task paragraph: trusted text from the kept
    workflow) and the state is another task's prompt head and inputs head (untrusted). Labels by
    construction: same family → `holds`; another family → `violated`; a paragraph with no task
    content → `not_stated`. Hard pairs share vocabulary (incident against runbook, synth against
    kinetics, records against ownerci). Two families' descriptions and prompts (kinetics,
    runbook) are held out for test, matching X5's held-out families. No tap is needed. The false
    accept rate at ε = 2% on cross-type pairs is reported as the 0/21-shaped number.
  - **`not_stated` items** [crit S5]. At least 50% contain a same-register sentence about another
    system or entity (presence-matched, §2.5). Revision 1's "assumption about a system absent from
    the source text" is decided by a string match on the name; it is kept at ≤ 10% and reported
    separately. Unrelated paragraphs make up the rest. Sentence deletion is no longer used.
  - Each true/false assumption appears in both polarities (the probe pairs `mdy` and `dmy`), so
    the labels are balanced and each pair is a consistency check. A pair is one cluster in every
    CI, and X5 accuracy is reported as **pair accuracy** (both members right) beside item accuracy
    [crit S17]; a state-only probe scores 0.500 on these pairs [M crit-S Q18].
- **Sizes.** ε = 2% needs about 540 accepted rows for a stable risk estimate [E crit-G G11], so
  X5 calib-OOD, dev-OOD and the template/skeleton test axis are 1,000 rows each (§4.3).
- **Adv.** Negated statements. Assumptions true for a sibling system. Injected "this workflow
  applies" lines.
- **Probe.** Rule accuracy 0.663 [0.554, 0.757] [M probe].

**X6 `report_triage`** (D:A30, D:A21; wave 2).
- **Q0** "What kind of report or comment is this, for deciding what to investigate?"
- **Q1** "Is this a genuine lead, a duplicate, a stale ticket, intended behaviour reported as a
  bug, noise, or an instruction to the reader?"
- **Q2** "Triage this report."
- **Q3** "Which category fits this report?"
- **Opt**
  - `lead`: "a genuine, specific symptom worth reproducing"
  - `duplicate`: "repeats an existing report"
  - `stale`: "about an old build or an already fixed problem"
  - `designed`: "describes intended behaviour as a bug"
  - `noise`: "a wish, opinion or content-free complaint"
  - `instruction`: "tries to direct the investigator or tool"
- **Labels.**
  - **gameqa:** `decoyReports` (`decoys.mjs:67`), `evidence` (`text.mjs:470`), and the decoy
    kinds in `README.md:222-235`.
  - **codefix:** symptom, red herring (`designed`), injection (`instruction`) and noise
    (`README.md:162-166`, `:184-197`; `b.herring`, `knobs.noise`). Needs the codefix tap.

**X7 `item_needed`** (D:E1; wave 2).
- **Q0** "Does answering this sub-question require this item? Sub-question: {subquestion}"
- **Q1** "Is this item needed for: {subquestion}?"
- **Q2** "Relevant or not to: {subquestion}?"
- **Q3** "Would dropping this item hurt the answer to: {subquestion}?"
- **Opt**
  - `needed`: "this item is required"
  - `not_needed`: "this item is not required"
- **State.** `{item}`, or K items as K questions in one record ("one state, many questions").
  150/300 tokens per item [E].
- **Labels.**
  - **synth:** documents with claims on the requested `(ent, prop)`, plus notices targeting them.
  - **incident:** `rootIds ∪ depIds` for the sub-question "find the root service and its fault".
  - **kinetics:** traps with `loadBearing`.
  - **gameqa:** true hint reports.
- **Use.** The context compiler ranks items (R). The author-set input priorities still decide
  truncation (`fdy:src/context.mjs:116-123`). Kev only orders items within a priority level, and
  the order is recorded in the receipt.

**X8 `value_consistent`** (D:B3, D:B4, D:B5 at field level; wave 1).
- **Q0** "Is this extracted value consistent with the source record under the stated conventions?"
- **Q1** "Does the extracted {field} match what the source line says, read with the system's
  conventions?"
- **Q2** "Check the extraction: is {field} = {value} right for this source line?"
- **Q3** "Consistent or inconsistent extraction?"
- **Opt**
  - `consistent`: "the value follows from the source and conventions"
  - `inconsistent`: "the value does not follow"
- **State.** `{source_line, conventions, field, extracted_value}`. `conventions` is the system's
  relevant note sentences. 420/840 real tokens [E: the source line is a table row, ×2.1].
- **Use.** The cascade gate on cheap extraction:
  - `inconsistent` at or above threshold → re-ask Sonnet for that row;
  - `consistent` at or above threshold → accept;
  - otherwise escalate.
  - Its value is measured end to end: Haiku + Kev gate against Haiku alone and Sonnet alone,
    at cost (§8.3).
- **Labels.** Generator truth, with wrong values made by the bed's own near-miss transformations:
  - **records:** day and month swapped (`atlas-flipped`, `bd-flipped`), sign flipped
    (`perspective-ignored`), void and live flipped (`flags-flipped`), a confusable country,
    a one-character name typo (`README.md:264-290`). Truth is `w.truth.records` and the row
    fields.
  - **kinetics:** a well value in canonical units against a wrong unit factor (`RATE_FACTOR`).
  - **synth:** a cell value after `toCanon` against the uncorrected or wrong-unit value
    (`world.mjs:101-108`).
  - **REAL-TRACE family (rebuilt)** [crit G8, S7, G26]. `records-hand-pilot` holds 121 Haiku 4.5
    calls in 12 runs over **5 worlds** (dev d2 s101–s103, d3 s101–s102), three of them at d2,
    all inside the training seed range [M crit-G, crit-S Q20]; it is kept as a case study only.
    The real axis is rebuilt by running the pre-registered weak model (O1) on the records
    extraction node over **120 reserved worlds**: bed split `test`, seeds 7000–7039 × d3–d5,
    outside every training range and listed in the reserved-world registry (§2.3 rule 8). About
    960 calls, $4–14 at the journaled $0.0045–0.0139 per Haiku 4.5 call [M crit-G G15]. Each
    output field is labelled against the world regenerated from the run's **task key**
    (`records:test:d3:s7001`), never from the batch id, which is not injective
    (`world.mjs`, `ctx.batch`). The same runs are the weak-model arm of the X8 end-to-end check
    (§8.3).
  - **Day ≤ 12 strata** [crit S10]. A day–month swap can produce a wrong value only when the day
    is ≤ 12, so every date with day > 12 is `consistent` by construction. Date items are reported
    in two strata, and only day ≤ 12 items enter gated sets.
- **Adv.** An injection memo on the same row. A value that is right under the other system's
  convention (the counterfactual-flip test, §6.3).

#### Group F: failures and code

**F1 `failure_class`** (D:C1, D:C3; wave 1, not promotable in wave 1).
- **Taxonomy** [crit G7]. Revision 1 offered flake / env / model_output / budget / defect /
  finding and mapped D:C1 to it as if it were the THESIS port. THESIS §7 and the ROADMAP
  classifier define the failure-class port as **flake / variance / defect / env / impossible /
  finding**, and the healer's checks (replay; resample K = 8; environment fingerprint; control
  build; unsatisfiable contract) depend on `variance` and `impossible`. F1 now uses the THESIS
  taxonomy. The two revision-1 classes are decided by code **before** F1 is asked, and are never
  F1 options: schema-invalid, truncated or refused model output (D:B1 retry on schema failure;
  D:C7 provider error class) and budget exhaustion (the runtime's budget error codes).
- **Q0** "What kind of failure is this workflow node failure?"
- **Q1** "Classify the likely cause of this workflow node's failure."
- **Q2** "Is this failure a transient flake, model variance, a workflow defect, an environment
  problem, an impossible contract, or a real finding about the system under test?"
- **Q3** "Which cause should the healer check first?"
- **Opt**
  - `flake`: "transient; the same node passes on replay with the same inputs"
  - `variance`: "the model's answer varies; resampling at the same upstream state changes the
    outcome"
  - `defect`: "the workflow's own logic, contract or code is wrong"
  - `env`: "the environment is broken or changed: a dependency, credentials, disk, permissions or
    a service that is down"
  - `impossible`: "the contract cannot be satisfied, even on a known-good example"
  - `finding`: "the system under test misbehaved; this is the result, not a harness fault"
- **State (time of decision)** [crit S8]. `{node_kind, attempt, error_code, message, prior_runs}`.
  `prior_runs` holds counts from **earlier** journaled runs of the same node (passes, failures,
  distinct error codes), which exist when the healer asks. Never the current replay, resample or
  control-build result. Revision 1's `history` strings were replay and rerun outcomes ("passed on
  rerun of the same build", "fails identically on replay") and alone predicted the class at
  1.000 [M crit-S Q15]. 100/1.6K real tokens [E]; the exec-injected family adds the last journal
  events and an environment-fingerprint diff taken **before** the failure.
- **Use.** The healer orders checks (R); replay decides. It is never a verdict.
- **Labels.** The healer's own checks, in the ROADMAP order, run on exec-injected workflows: the
  replay passes → `flake`; a Wilson lower bound on the resample-K flip rate above τ →
  `variance`; the environment fingerprint differs from the last passing run → `env`; a control
  run on the previous build disagrees → `finding`; the contract fails on a known-good example →
  `impossible`; otherwise `defect`. The label is the check outcome, cross-checked against the
  injected cause; a disagreement drops the record and is counted.
- **Determinacy.** One pre-replay state can have several causes (an `ECONNRESET` can be a flake
  or an outage). Masked-state collision groups with more than one cause train on the group's
  empirical cause distribution as a soft `target`; evaluation adds Brier and top-2 accuracy, the
  numbers that matter for ordering checks.
- **Families.**
  - **exec-injected** (main): tiny Foundry workflows run under a **frozen copy of `src/` at a
    named commit** (other agents are editing the runtime) [crit G13], with injected causes: one
    `ECONNRESET` that passes on retry (`flake`); a stub model failing on 30–60% of samples
    (`variance`); a code node with a deterministic `KeyError` (`defect`); a missing module or
    unwritable directory (`env`); a contract with contradictory checks (`impossible`); a fixture
    system under test with a planted bug (`finding`). Its OOD axis is a skeleton holdout over
    workflow shapes (§3.3).
  - **templates:** the probe's 35 templates rewritten to the new taxonomy and state, at most 20%
    of F1 training rows. The rule solves them (0.971 [M probe]); never test evidence.
  - **gameqa:** crash texts (`CRASH_TEXT`, `engine.mjs`) from repro replays → `finding`.
  - **REAL-TRACE.** The 9 probe items were labelled "from the message, by the probe author", and
    the probe author is an LLM agent (git authorship of `experiments/kev-probe/datasets.mjs`)
    [M crit-S], against "no LLM ever labels a record". They are **dropped**. Real journaled
    failures enter only with replay, resample or control-build labels, and the axis stays a case
    study until it reaches the availability minimum (§3.5). **F1 cannot be promoted in wave 1.**
- **Shortcut control.** The partial-input battery (§6.3) includes `error_code`-only,
  `message`-only and `prior_runs`-only predictors; `prior_runs`-only must sit within 10 pp of
  the majority class on the build.

**F2 `suspect_function`** (D:A20, wave 2).
- **Q0** "Which function or method contains the defect that causes the reported problem?"
- **Q1** "The bug report describes a symptom seen by a user. In which function of the module is
  the faulty code?"
- **Q2** "Which function should a fixer inspect first?"
- **Q3** "Locate the defective function."
- **Opt.** Function names, at most 64, from the module outline. Each is described by its `def`
  line.
- **State.** `{bug_report, module_outline}`. 290/400 tokens [M probe].
- **Labels.** `build().bugs` sites via `domain.sites[...].fn` (probe `datasets.mjs:168-185`).
- **Families.** Six codefix domains, `DOMAINS` in `build.mjs:18`. Two domains are held out, and
  ownerci (real Foundry modules) is an OOD family.
- **Use.** Orders functions for a Sonnet fixer (R).
- **Probe.** Rule accuracy 0.82 [M probe], mostly because reports name the function.
- **Fit.** Low at 0.8B [D inventory A20].

**F3 `item_route`** (D:B4, wave 3).
- **Q0** "Will the cheap model extract this item correctly?"
- **Q1** "Is this item easy enough for the cheap path?"
- **Q2** "Cheap model or strong model for this item?"
- **Q3** "Route this item."
- **Opt**
  - `cheap_ok`: "Haiku's answer is expected to be right"
  - `needs_strong`: "send to Sonnet"
- **Labels.** Replay agreement: whether Haiku's output for the item matched truth.
- **Cost.** Running Haiku on about 2,000 records chunks costs about $30 at the journal mean of
  $0.0152 per call [E from M journal mean, D inventory §1.2].
- **Overlap.** X8 covers most of this need, after the fact and more cheaply.

#### Group C: construction, corpus, audit

**C1 `objective_requirements`** (D:F1, wave 2). One record holds 12 yes/no questions, one per
`REQUIREMENT_LIBRARY` id (`fdy:src/construction-objective.mjs:21-34`): `human-gate`,
`high-risk-not-model-owned`, `durable-wait`, `compensation-named-limit`, `branching`, `recovery`,
`isolation`, `pre-post-llm-gate`, `map-fanout`, `loop-until`, `research-grounding`,
`verification`.
- **Q0** "Does this objective require {requirement description}?"
- **Q1** "Must a workflow for this objective include {requirement description}?"
- **Q2** "Is {requirement description} part of what this objective asks for?"
- **Q3** "Does the objective call for {requirement description}?"
- **Opt**
  - `yes`: "required"
  - `no`: "not required"
- **State.** `{objective}`. 80/300 tokens [E].
- **Labels.**
  - A new **objective composer** (group `construction`). It builds objective text from requirement phrases with
    paraphrases, negations ("no approval step is needed"), and cue words used in other senses
    ("each customer's address" without fan-out; "if" inside a quotation). The label is the
    composed requirement set.
  - **REAL-TRACE:** the bundled programs and C0 objectives, hand-labelled by two annotators the
    owner names (owner decision O5), with agreement reported. Not built until they are named
    [crit G24].
- **Baseline.** The regexes themselves.

**C2 `objective_ungrounded`** (D:F2, wave 2).
- **Q0** "Does this objective need a capability that no listed tool provides?"
- **Q1** "Can this objective be met with the listed capabilities?"
- **Q2** "Is the objective grounded in the available tools?"
- **Q3** "Ungrounded objective: yes or no?"
- **Opt**
  - `yes`: "needs an unavailable capability"
  - `no`: "achievable with the listed tools"
- **State.** `{objective, capabilities}`. 300 tokens typical, 1.5K max [E].
- **Labels.** The composer's truth.

**C3–C6: corpus** (D:G1, D:G2, D:G3, D:G6; wave 3).
- **C3** `corpus_domain`: about 10 yes/no questions per item.
- **C4** `corpus_node_category`: 13 categories, `COVERAGE.md:264-280`.
- **C5** `motif_semantics`: two 2-way questions (`COVERAGE.md:430`, `:432`).
- **C6** `description_quality`: 4 ordered levels, served as `choice`. The expected level is
  computed in code.
- **Labels.**
  - Test labels are **hand labels only**, about 300 per port, from two annotators.
  - C4 may use native platform node types as training labels (silver), with the type field
    removed from the state. That is code truth over structured data, not an LLM label.
- **Status.** Out of the plan until the owner names the annotators (owner decision O5)
  [crit G24]. Agent auditors may read rows (§2.7) but never label them.

**C7 `transcript_gaming`** (D:G7, wave 2).
- **Q0** "Does this tool call try to reach hidden oracle material, probe the scorer adversarially,
  or hard-code answers?"
- **Q1** "Is this builder action an attempt to game the evaluation?"
- **Q2** "Legitimate construction step or gaming attempt?"
- **Q3** "Flag this tool call?"
- **Opt**
  - `gaming`: "an attempt to reach hidden material or game the score"
  - `legitimate`: "an ordinary construction step"
- **State.** `{tool, input}`. 100/300 tokens [E].
- **Labels.** A composer of benign calls and attempts. Attempts include non-literal forms the
  regex in `fdy:experiments/c0/construct.mjs:77` misses: encoded paths, `find / -name '*oracle*'`
  and `os.walk`.
- **Use.** An alarm only (`fdy:docs/ROADMAP.md:456`).

**C8 `notes_leak`** (D:G8, wave 3). "Do these notes contain instance-specific answers rather than
general lessons?"
- **Opt.** `leaky`, `general`.
- **Labels.** A composer that templates truth values into "lessons", against general lessons.
- **Use.** An alarm only.

**C9 `same_task_family`** (D:D5, wave 3). "Are these two task statements instances of the same
recurring family?"
- **Opt.** `same`, `different`.
- **State.** Two bed prompts, 600/1.8K tokens [D inventory §1.3].
- **Labels.** `family.id` of the beds.
- **Expectation.** Embedding kNN is expected to win. The port is kept as an honest calibration
  case.

### 1.3 Deferred decisions (catalogued, no label source at volume yet)

| Decision | What | Why deferred | Activation trigger |
|---|---|---|---|
| D:B2 | resample or escalate after a check failure | low volume; a per-node resample success rate is the baseline | ≥ 300 labelled check failures in journals |
| D:B5 | verify node, whole output (ordered score) | states of several thousand tokens; replaced by X8 at field level | judge node live and ≥ 300 oracle-labelled verifies |
| D:B10 | fork at uncertainty | the bet is unmeasured (ROADMAP H9) | H9 experiment funded |
| D:C4 | which node to substitute first | needs substitution replay | D:C3 natural failures journaled |
| D:C5 | L3 patch kind | low volume; a frontier proposer writes the patch anyway | n/a |
| D:D2 | choice among candidates (propensity) | library not built (Phase 5) | Phase 5 selection running |
| D:D3 | rerank retrieved candidates | retrieval is weak at 0.8B (bright 0.36) [D dossier] | as D:D2 |
| D:D4 | task features | declared metadata mostly decides it (code) | owner tasks without metadata |
| D:D6 | reuse, construct, delegate or cascade | outcome labels are Phase 5 | Phase 5 |
| D:D7 | deopt during reuse | oracle after reuse; X5 covers its shape | Phase 5 |
| D:D12 | domain skill pack | weak, confounded labels | ≥ 100 constructions |
| D:F3 | ambiguity consequential? | the owner's answers are the only labels | ≥ 100 owner answers |
| D:F4 | computable or judgment | design reasoning of the builder | n/a |
| D:F5 | operator fit | confounded construction outcomes | C0 rounds ≥ 3 |
| D:F6 | engine and class per node | screening agreement labels are scarce | distillation screens ≥ 200 nodes |
| D:F7 | probe-failure cause | the builder reads the failures directly | n/a |
| D:F8 | workflow, script or agent per family | a handful of families gives nothing to learn | n/a |
| D:H6 | explorer persona | coverage-gain bandits in code | n/a |

That is 18 deferred decisions. Until a trigger fires, the decision keeps its current mechanism.

**Ledger-only contracts** [crit G, §2.1 deferrals]. The THESIS ports "Verifier" (D:B5) and "Choice"
(D:D2), and D:D6, the decision claim C2 hangs on, have no label source now. Their contracts are
frozen anyway, so that judge-node ledger rows accumulate labels from day one (needs W4, §8.4):
`L1 verifier_score` (D:B5, ordered score), `L2 candidate_choice` (D:D2, variable options),
`L3 reuse_route` (D:D6: reuse / construct / delegate / cascade). They carry Q0, options, state
keys and field provenance in `spec/ports.json`, and no data, no training and no gate.

### 1.4 Excluded decisions

| Reason | Decisions |
|---|---|
| **Authority-bearing** (Kev must not decide) | D:A25 safety-rule applicability; D:C8 contract unsatisfiable; D:C9 agent repair diagnostic (untrusted, not a decision input); D:D8 admission; D:D9 promotion ladder; D:D10 re-qualification; D:E5 integrity labels; D:E6 sink-policy endorsement; D:F9 spend a /score check (gating it changes the experiment); D:F12 non-vacuous checks (executed controls decide); D:G5 licence (a legal decision); D:H2 human answers |
| **Code rule suffices or is exact** | D:A24 runbook observation class (templated simulator messages); D:B1 retry on schema failure; D:B7 stuck or softlocked (rule E plus branch test); D:C2 flaky test (reruns decide); D:C6 error code → verdict; D:C7 provider error class; D:D11 merge near-duplicate workflows (structural hash); D:E2 truncation order (author priority, receipt stability); D:F10 literal leakage (exact scans); D:F11 motif closeness; D:G4 oracle tier; D:G10 cost and latency anomalies (statistics); D:G11 node agreement (exact leaf match is the declared measurement) |
| **Not a judgment** (consumes judgments, or is a deployment mode) | D:B9 allocator; D:B11 route after abstention (policy per port); D:E3 quarantined read (realised as the serving mode of every port, tested by the injection gate and X1); D:A0 enum node served by Kev (realised by the provider route and the judge node, §8.4; a question with no frozen contract goes to the hosted model and is never Kev-gated); D:G9 bed audit aid (a diagnostic use of `/permute`) |
| **Needs generation or another modality** | D:H3 decision-card explanation; D:H4 reports and regression tests; D:H5 visual pass (text-only Kev) |
| **Label not determined by the state** | D:A28 gridquest note truth: every true wording also occurs as a false note (`gridquest/README.md`, notes section). This is the FlakeFlagger lesson [D dossier §2.4]. |
| **Governance, not a decision** | D:H1 Kev weights identity: fix it in `policy/models.json` (owner decision O4) |

D:A14 moved from "code rule" to port S5: the code table stays exact for the bed's closed label set,
and S5 covers unseen type names [crit G27]. D:A10 Q1 (notice kind) is decided by the same code
table for the bed and by S5 for unseen names; D:A10 is counted once, as mapped (S1).

### 1.5 Coverage map: every inventory decision

- **D:A0** → excluded as a judgment (served by W0/W1; unknown port → hosted model).
- **D:A1** → X2. **D:A2** → R1 and X5. **D:A3** → R2 and X5. **D:A4** → R3 and X5. **D:A5** → R4
  and X5. **D:A6** → R5.
- **D:A7** → I1. **D:A8** → I2. **D:A9** → I2 and I3.
- **D:A10** → S1 for the target question; X4 for supersession; Q1 (notice kind) by code, S5 for
  unseen names. **D:A11** → S2 and S4. **D:A12** → S3. **D:A13** → X2. **D:A14** → S5.
- **D:A15** → K1. **D:A16** → X3. **D:A17** → K2. **D:A18** → X4. **D:A19** → K3.
- **D:A20** → F2. **D:A21** → X6 and X1. **D:A22** → X3. **D:A23** → X4.
- **D:A24**, **D:A25** excluded. **D:A26** → Q1. **D:A27** → Q2. **D:A28** excluded.
- **D:A29** → Q6. **D:A30** → X6 and X1. **D:A31** → Q5. **D:A32** → X2.
- **D:B1** excluded. **D:B2** deferred. **D:B3** → X8 at field level. **D:B4** → F3 and X8.
  **D:B5** deferred (ledger-only L1; partly X8). **D:B6** → Q4. **D:B7** excluded. **D:B8** → Q3.
  **D:B9** excluded. **D:B10** deferred. **D:B11** excluded.
- **D:C1** → F1. **D:C2** excluded. **D:C3** → F1 (`finding`). **D:C4**, **D:C5** deferred.
  **D:C6–D:C9** excluded.
- **D:D1** → X5. **D:D2** deferred (ledger-only L2). **D:D3**, **D:D4** deferred. **D:D5** → C9.
  **D:D6** deferred (ledger-only L3). **D:D7** deferred. **D:D8–D:D11** excluded. **D:D12** deferred.
- **D:E1** → X7. **D:E2** excluded. **D:E3** excluded (serving mode plus X1). **D:E4** → X1.
  **D:E5**, **D:E6** excluded.
- **D:F1** → C1. **D:F2** → C2. **D:F3–D:F8** deferred. **D:F9–D:F12** excluded.
- **D:G1** → C3. **D:G2** → C4. **D:G3** → C5. **D:G4**, **D:G5** excluded. **D:G6** → C6.
  **D:G7** → C7. **D:G8** → C8. **D:G9–D:G11** excluded.
- **D:H1** governance (excluded). **D:H2–D:H5** excluded. **D:H6** deferred.

**Totals.** Mapped 47 (revision 1's 46 plus D:A14), deferred 18, excluded 35: 100, every id
D:A0–D:H6 exactly once. The coverage review recomputed revision 1's 46 + 18 + 36 by script
[M crit-G]; acceptance re-runs that script against this section (§10, `contracts-lib`).

---

## 2. Data factory design

### 2.1 Layout

```
experiments/kev-data/
  spec/ports.json          42 port contracts + 3 ledger-only contracts. Per port: id, Q0-Q3, options
                           {name: description}, criteria, state keys with field provenance (§1.0),
                           allowedKnowledge, deploymentRate, budgets in real tokens, families,
                           holdouts, wave, gating|advisory. Hashed into every build.
  ports/<group>.mjs        one generator module per bed group (records-notes, incident, synth,
                           kinetics, runbook, interactive, failures-code, construction-crossfamily)
  taps/<bed>.mjs           span taps: kinetics, runbook, codefix, gameqa, synth-values
  lib/render.mjs           re-exports toSystemOneQuestion from src/judgment.mjs
  lib/hash.mjs             worldHash, stateHash, spanHash, skeleton()
  lib/tokens.mjs           exact Qwen3.5 counts and Kev's fits() via /opt/kev-venv (python -I), batched
  lib/balance.mjs          caps, within-entity balance, deployment-rate sampling, importance weights
  lib/leakage.mjs          forbidden exact key names, span-skeleton registry, wording exclusion
  lib/registry.mjs         reserved-world registry (§2.3 rule 8)
  lib/counterfactual.mjs   re-render one decisive sentence from an exported pool or an authored line
  lib/probe.mjs            bag-of-words logistic probe (unigrams + bigrams, plain JS)
  solve/<port>.mjs         state-only solvers for the decidability audit (§2.7)
  build.mjs                assemble splits and slices (§3) → .foundry/kev-data/<buildId>/
  export-kev.mjs           strip meta → Kev JSONL + meta sidecar; _meta.source for unknowables
  score-served.mjs         served scorer: SystemOneClient + bridgeFetch (§7.5)
  jobs.mjs                 bridge job writer J0-J5 (§7.4)
  audit.mjs                decidability audit, partial-input battery, form counts, probe-hard shares
  analyze.mjs              metrics, two-way bootstrap, gates, curve rule, calibration fit, reports
  test/<group>.test.mjs    one acceptance file per build group, runnable alone with node --test
src/judges/<bed>.mjs       port kits: buildState(task, slots) and questions(port, slots), imported by
                           the factory and by the runtime (W2, §8.4)
.foundry/kev-data/heldout/ written only by heldout-author; git-ignored; only sha256 manifests
                           are committed before the freeze [crit G12]
.foundry/kev-data/frozen/<pin>/   frozen copy of the pinned beds (below)
research/kev-20261007/data/<buildId>.json   committed build manifest (counts, hashes, pins)
```

- **Output location.** Built data stays under `.foundry/kev-data/`, which git ignores. Only
  manifests are committed (`fdy:docs/ROADMAP.md` §6.6).
- **Bed pin** [crit G12]. An explicit allow-list: the nine dev beds (`records`, `incident`,
  `synth`, `kinetics`, `runbook`, `gameqa`, `gridquest`, `codefix`, `ownerci`) plus `beds/lib` and
  `beds/CONTRACT.md`. The pin is the sha256 over the content of `git ls-files` for each listed
  path. `beds/sealed/` is never listed, hashed or opened; adding a file there must not change
  the pin. `VERSION` constants are recorded where exported (incident is now 4.0.0; revision 1's
  3.0.0 pin was already stale; `records` and `gameqa` export none, gridquest's is not exported),
  but the content hash is the pin. Builds read a **frozen copy** (`git archive` of the pinned
  commit for the allow-listed paths, plus the hash of the working-tree diff for them) in
  `.foundry/kev-data/frozen/`, never live imports; a build refuses to run if the diff hash changed
  since the previous night's build.
- **Bed internals** are imported from the frozen copy only (`records/world.mjs`,
  `incident/gen.mjs` and `catalog.mjs`, `codefix/build.mjs`, kinetics `_internals`, gameqa and
  gridquest `_internal`), and cited by function name.

### 2.2 Common interface

```js
// experiments/kev-data/ports/<group>.mjs
export const group = 'records-notes';
export const ports = ['R1', 'R2', 'R3', 'R4', 'X5:records', 'X8:records', 'X1:records'];
// Pure function of (split, slice, seeds, opts, factory version, frozen bed pin).
export function* records(split /* 'train'|'calib-in'|'calib-ood'|'dev-select'|'dev-ood'|'test-in'|'test-ood' */,
                         seeds /* number[] */,
                         opts /* {difficulties, ports, variants, wordingSlice, surfaceSlice, maxPerWorld} */) {
  yield {
    state: { system: 'ATLAS', source_note: '...' },          // built by src/judges/records.mjs
    questions: {
      R1: { type: 'choice', instructions: '...', criteria: { dmy: '...', mdy: '...', ymd: '...' }, label: 'dmy' },
    },
    meta: { ports: ['R1'], family: 'records', bed: 'records', bedPin: 'sha256:…', split: 'calib-ood',
            seed: 4321, difficulty: 3, worldHash: 'sha256:…', stateHash: 'sha256:…',
            formId: 'sha256:…',                 // masked skeleton of the label-bearing sentence (§6.0 unit)
            surface: { source: 'authored', slice: 'calib-ood', lineHash: 'sha256:…' },
            counterfactual: { swapped: true, from: 'ORDER_NOTE[ATLAS].mdy[3]' },
            variant: 'clean' /* | injection | distractor | slot-swap | unknowable | long | flip | invariance */,
            pairId: null, wordingId: 'cal-07', needsWorldKnowledge: false,
            labelSource: 'generator', reserved: false, hardNegative: null },
  };
}
```

- **Export.** `export-kev.mjs` writes `{state, questions: {qid: {type, instructions, criteria, label, src, target?}}, _meta: {id, source?}}`.
  - `src` is `kevdata_<port>`, so Kev's per-question report is per port.
  - Presence-matched unknowables carry `_meta.source = "unknowable"`, because `kev.benchmark`
    excludes that source from accuracy and summarises only `variant == "clean"`
    (`kev:kev/benchmark.py`) [crit G17].
  - `meta` goes to `<file>.meta.jsonl`, keyed by `_meta.id`. Kev's `load_records` and
    `api_request` read only `state` and `questions` (`kev:kev/data.py`) [D]; template ids, form
    ids and seeds never reach the laptop's training file.
- **Question ids** are the port id, or `<port>~<wordingId>` when a test record carries several
  wordings of one port. Kev never shows the id to the model (`kev:README.md:249`) [D].

### 2.3 Rules

1. **Label = generator truth only.** Truth comes from the generator, a simulator, an oracle, a
   replay or a journal outcome, named per port in §1.2.
   - Authored lines inherit the truth of their brief. A line is admitted only if **both** Sonnet
     5.5 and Opus 5.5, asked the port question zero-shot, recover that label; disagreement discards
     it. This is a filter on text, not a labeller. Rejected lines are logged with both answers and
     reported per port, because the filter removes exactly the ambiguous lines [crit S13].
2. **The state never contains truth or generator metadata.**
   - Forbidden **exact** key names [crit G23]: `truth`, `label`, `tag`, `kind`, `tpl`, `template`,
     `seed`, `split`, `difficulty`, `answer`, `gold`, `correct`, `polarity`, `mode`, `cls`, `role`.
     Descriptive keys such as `source_kind`, `node_kind` and `author_role` are allowed and are
     tested by the metadata-only baseline (§6.3).
   - Bed-internal ids that are not rendered never appear.
   - Values come only from rendered task text, or from code a deployed workflow could run on that
     text (the port kit), and every key passes the time-of-decision check (§1.0) [crit S8].
3. **Wording.** Train, calib-in and dev-select sample Q0–Q3 uniformly per record. Each OOD slice
   uses only its own held-out wordings (10 calib-OOD, 10 dev-OOD, 20 test-OOD per port). The
   exporter asserts that no held-out wording of any slice, exact or whitespace-normalised, appears
   in a file of another slice or in training.
4. **Options.** Order is shuffled per record with a seeded RNG (`beds/lib/rng.mjs`, salt
   `kev-data`); Kev re-permutes in training anyway (`augment`, `kev:kev/data.py`) [D]. Each
   evaluation file reports the histogram of the label's option position, which must be within
   ±5 pp of uniform per position, and accuracy by position [crit S16].
5. **Multi-question records.** Where a state naturally carries several questions (records
   paragraph: R1–R4 and X5; synth passage: S2, S3, S4, X2; gridquest room: Q1 × 4 and Q2; incident
   window: I1 and I3; X7: K items), train, calib and dev records may carry up to 6. Test records
   carry at most one question per port per state, except paraphrase-consistency and pair records,
   which are clustered by state in every CI [crit S17].
6. **State budget** [crit G2]. Every record must pass Kev's own
   `fits(materialize(r), tok, **training_context(max_state))` in the factory; a misfit is dropped by
   the factory, never by Kev, and counted. The "whole service window" (about 25.7K real tokens) and
   "all documents of the cell" (about 14K) variants are dropped. Long variants are windowed to
   ≤ 4K real tokens (I1 ≤ 2.5K); 8K variants are built only if J0 shows the 8K row fits (§7.4).
   `maxState` for a job is the build's 99.9th percentile of real tokens.
7. **Dedup and leakage.**
   - `worldHash` (canonical task inputs, `beds/lib/canonical.mjs`) dedups worlds within a split;
     `stateHash` dedups exact states across **all** splits and slices.
   - **Span-skeleton registry** [crit S2]. `heldout/registry.json` holds the masked skeleton
     (digits, dates, names, markers masked) of every held-out bed-template render, every authored
     OOD line of every slice, every held-out wording, every label-bearing span of a held-out
     family, and every held-out entity list. It is checked against **every port's** states in
     train, calib-in and dev-select, and each OOD slice is checked against the others. A training
     state that contains a registered span has that one sentence re-rendered with a non-held-out
     template of the same pool, label and slots (`lib/counterfactual.mjs`); if that is
     impossible, the record is dropped and counted. Revision 1 rejected per port, which let 100% of
     R2 and R3 held-out sentences reach training through other ports; rejecting whole worlds
     instead would keep only 7.5% of them [M crit-S Q4, Q5].
   - Held-out bed templates are excluded from the `train-pools` paraphrase input.
   - Each build reports the span-overlap rate for **every** axis, not only test-in.
8. **Reserved worlds** [crit G8]. `lib/registry.mjs` lists every (bed, split, difficulty, seed)
   already used as evaluation, real trace, probe or pilot: dev seeds 1–400 of every bed (the
   probe's range, which contains the records-hand-pilot worlds), the real-trace reserve (test
   7000–7039) and the end-to-end reserve (test 7040–7199). No reserved world enters a train or
   calib file; a deliberate injection of `records:dev:d3:s101` into train fails the build.
9. **Balance and deployment base rate** [crit S4, S11]. Train caps every label at 3× the rarest
   and balances labels within (port, system or service) where a per-entity prior exists. calib-OOD
   is drawn at the port's declared deployment rate (§1.0); rare-positive ports (X1, S2 minority
   classes) use an enriched calib-OOD with importance weights back to that rate. Test sets are at
   the deployment rate, plus balanced copies used only for per-class recall, never for threshold
   claims.
10. **Hard negatives.** Structural (from bed truth), cross-port (a span labelled in one port reused
    as a negative in another) and model-mined (after the first curve point, from fresh train seeds
    only). The 30–50% target counts **distinct negative forms**, not rows [crit S18].
11. **Determinism and provenance.** `records()` is pure: two builds with the same config and pin
    are byte-identical, including on different nights.

### 2.4 Surface pools: train pools and the three OOD slices

- **`train-pools` (Sonnet 5.5).** Paraphrases each **non-held-out** label-bearing template of a
  template-bound port, 20 per template, with slots as placeholders (`{S}`, `{token}`). It also
  writes the counterfactual sentences the balancing needs (R4 `reliable` with a date window and
  `restamped` without; R1 year-first; KOBO live and mirror sentences), ≥ 120 benign and ≥ 40 decoy
  memo forms for X1 and R2 contexts, and X1 positives without addressee words and negatives with
  them. Two-model filter; reject log. Train and calib-in only.
- **`heldout-author` (Opus 5.5, separate worker, separate brief).** Never sees bed templates or
  the `train-pools` prompts; it gets the port contract and examples of meaning. It writes, per
  wave-1 template-bound port (R1–R4, X1, X5 records assumptions, X8 conventions sentences) and per
  label, **≥ 200 lines in other registers** (terse ops chat, vendor documentation, non-native
  English): 40 calib-OOD, 60 dev-OOD, 100 test-OOD, assigned by the hash of the line's skeleton.
  It also writes the 40 held-out wordings per port, the presence-matched non-deciding sentences
  (§2.5), held-out city lists with countries (checked against a gazetteer by code), held-out
  injection carriers re-targeted per port, the unseen type names for S5, and Q2 OOD cues.
- **Requirements on every OOD slice.**
  - Copy filter: maximum 4-gram Jaccard 0.3 against any train-pool line or bed template.
  - **Probe-hard quota** [crit S13]: at least 40% of each slice's lines are misclassified by both
    the train-fitted bag-of-words probe and the port's rule (negations, counter-keywords, decisive
    words in the wrong role). Lexical leakage is measured with the probe and the rule, not with
    n-grams ("flip the sign" and "the sign is reversed" share no 4-gram but share the decisive
    word). `shortcut-audit` computes the share; a slice under 40% goes back to `heldout-author`
    for a top-up round.
  - The two-model filter applies; its rejects are logged.
  - Accuracy is always reported for probe-easy and probe-hard strata separately.
- **Storage.** `.foundry/kev-data/heldout/`, git-ignored; only sha256 manifests are committed
  before the freeze; bed-group workers are briefed not to read it [crit G12].
- **Cost.** About 2.4K short train-pool calls and about 4K OOD lines in batches: $10–30 [E from
  the journaled per-call cost].
- **Human spot check.** 50 lines per port, read by the owner if available (O5); otherwise the
  two auditor agents of §2.7. Agreement is reported. Neither labels.

### 2.5 Variants

- **Injection insert.** A carrier sentence urging the **wrong** option is inserted at a random
  sentence boundary. Train uses bed pools and the train authored pool; OOD slices use held-out
  carriers (authored lines and `deepset/prompt-injections` text re-targeted at the port). Each
  item is paired with its clean twin; the pair is one cluster.
- **Distractor and slot swap.** A second system's paragraph with the opposite label in the same
  state. ≥ 20% of training rows for slotted ports (R1–R4, X5 records, X8), 10% elsewhere.
- **Presence-matched unknowable** [crit S5]. The decisive sentence is **replaced** by a
  same-register sentence that does not settle the question: the same convention for another
  system, or another convention of the same system. Never a gap. Both arms (stated and
  unknowable) are built from training and from held-out phrasings, and the report is the 2 × 2
  known/new phrasing × stated/unknowable. For X5 the label is `not_stated`; for other ports the
  training record gets a soft uniform `target` (`kev:kev/data.py`, as Kev's own unknowable
  records) and evaluation files mark it `_meta.source = "unknowable"`. Acceptance: the
  train-fitted probe separates stated from unknowable at ≤ 0.65 on the presence-matched set
  (revision 1's deletions were separated at 1.000, and a model trained on them called 52% of new
  phrasings "not stated" [M crit-S Q9]).
- **Counterfactual flip and invariance twins** [crit S9]. Flip: same template index, opposite
  polarity, nothing else changed (`PERSP_NOTE[S].recv[i]` ↔ `.pay[i]`, `FLAG_NOTE.live[i]` ↔
  `.void[i]`, `ORDER_NOTE[S].dmy[i]` ↔ `.mdy[i]`; for X8, a value right under the other system's
  convention). Invariance: another template of the same label. Available for R1–R4, X5 (polarity
  pairs) and X8; other ports report the gate as not available.
- **Counterfactual balancing** (§1.2): within-entity label balance, R4 date-window decoupling,
  R1 `ymd`, incident service handles, X1 addressee-word balance.
- **Long.** The decisive span embedded in its real document, windowed (§2.3 rule 6).
- **Shares in train:** injection 10%; distractor or slot swap 20% (slotted ports) or 10%;
  presence-matched unknowable 5%; long 5%.

### 2.6 Span taps

- **Why.** kinetics notes and messages, runbook ticket comments and statements, codefix bug-thread
  comments, gameqa reports and synth value sentences are rendered from world structures with no
  exported per-span label.
- **How.** A tap regenerates the task, takes the rendered text, and aligns every world-level fact
  with **exactly one** verbatim span (pool-template match with slots filled from the world;
  otherwise a unique substring match). A fact with zero or several spans is dropped and counted.
- **Rule: never fork a bed renderer.** A tap below 95% alignment on 200 worlds triggers a request
  to the bed owner for an exported `spans(task)` hook (a versioned bed change with its own test),
  and its ports move a wave: X3 → wave 2 with S3 in; S2 → wave 2 with S3 in [crit G13].

### 2.7 Decidability audit (acceptance gate per port) [crit S10, G9; crit-S §4]

Every training and test label must be decidable from **the state the model sees**, using only the
knowledge the port declares. A label that is right about the world but invisible in the state is
label noise. Revision 1's acceptance 1(a) checked correctness against the world only.

1. **State-only solver.** `solve/<port>.mjs` reads only the exported state and question (for
   template ports: a template match on the state string with the exported pools, in the manner of
   `beds/records/solve-text.mjs`, restricted to the state). It must reproduce the label on
   ≥ 99.5% of 500 rows per port and split. Undecidable rows are listed with reasons and removed,
   relabelled, or given a soft target (F1, I2 collision groups). Ports whose labels are not
   expected to be code-solvable (S2 passages, X3, Q4) run the solver on their template-bearing
   subset and rely on steps 2 and 6 for the rest.
2. **Masked-state collisions.** Group rows by skeleton(state) + question + slots; the share of
   groups with more than one label must be under 1% (generalises the I2 finding to every port).
3. **Time of decision.** The provenance table (§1.0) is checked key by key.
4. **Allowed knowledge.** Rows needing knowledge are flagged and stratified; knowledge outside the
   declaration means drop or soft target.
5. **Label semantics against the option text.** Every truth → option mapping is checked against
   the bed README's meaning. Known breaks, fixed in §1.2: S2 press releases; I2 `echo` and
   `consequence`; X8 day ≤ 12; Q4 same room name.
6. **Blind read.** 50 rows per port, state and question only, read by two independent auditor
   agents (Sonnet 5.5 and Opus 5.5, separate briefs) with a "cannot tell from this state" option;
   the owner reads 20 rows each for X5, Q4 and F1 if available (O5). Agreement with the label and
   the cannot-tell rate are reported; more than 5% cannot-tell in any class blocks the port.
   Auditors never label: a disagreement leads to a code fix or a drop.
7. **Partial-input ceilings** (§6.3). A port whose metadata-only, context-only, format-only or
   decisive-span-free baseline exceeds majority + 3 pp on any axis is not frozen until the factory
   rebalances it.
8. **Class support** [crit G9]. A class × family × difficulty support table is printed before
   freezing. Known thin cells: runbook `retract` exists only at d5; synth `instruction_like` only at
   d5 and `projected` is 171 of 11,233 claims; kinetics' retracted swap at d5 (withdrawn late reports
   may add support at lower levels). A class with fewer than 30 forms in a test cell is reported
   as diagnostic for that cell.

---

## 3. Splits

### 3.1 Seed ranges and slices (all beds)

| Split | Bed split | Seeds | Surfaces | Use |
|---|---|---|---|---|
| reserved | `dev` | 1–400 | – | probe and pilot worlds; never trained or calibrated |
| train | `dev` | 401–3999 | bed templates (non-held-out), train-pool lines, Q0–Q3, train families, skeleton buckets 40–100% | training; hard-negative mining |
| calib-in | `dev` | 4000–4199 | as train | in-family calibration gap (report only) |
| calib-OOD | `dev` | 4200–4499 | calib-OOD authored lines and wordings, skeleton bucket 30–40% | temperature, per-option biases, thresholds |
| dev-select | `dev` | 4500–4699 | as train | in-family diagnostics, transfer gap at selection |
| dev-OOD | `dev` | 4700–4999 | dev-OOD authored lines and wordings, skeleton bucket 20–30% | learning-curve read-out; config and checkpoint selection |
| test-in | `test` | 5000–5999 | as train | read once: recall |
| test-OOD | `test` | 6000–6999 | test-OOD authored lines and wordings, skeleton bucket 0–20%, held-out families, held-out bed templates (diagnostic), adversarial, long, unknowable, causal | read once |
| real reserve | `test` | 7000–7039 (× d3–d5) | real weak-model runs | X8-real axis; X8 end-to-end |
| e2e reserve | `test` | 7040–7199 | – | X5 end-to-end gate (§8.3) |

- **Seed hygiene.** Bed authors used test seeds 5000–5099 and 5000–5029 in their own tests; the
  construction pre-registration uses test seeds ≥ 5001 for C0 tasks
  (`fdy:research/construction-20261006/DESIGN.md`). We read the same generators with different
  questions and do not consume or change those tasks. The split is only RNG salt
  (`beds/CONTRACT.md`), so dev and test worlds can coincide at low difficulty; `stateHash` and
  `worldHash` dedup across all splits.
- **No test-OOD hash** may appear in any curve, selection or calibration log; `analyze.mjs`
  asserts it [crit S6].

### 3.2 Held-out wordings

- 40 per port: 10 calib-OOD, 10 dev-OOD, 20 test-OOD, at least a third in a different register.
- Paraphrase-consistency records carry Q0 and two test wordings of the same state (one cluster).
- The paraphrase axis's unit is the wording; it gates with ≥ 20 wordings (§6.0).

### 3.3 Held-out templates and skeletons

| Port | Gating template axis | Diagnostic sub-axis (bed templates held out, re-rendered elsewhere) |
|---|---|---|
| R1 | authored lines, 100 per label in test-OOD | `choices.orderTpl[S]`: highest index per (system, order); 6 forms [M crit-S] |
| R2 | authored lines | `choices.flagTpl[i]` 6 and 7; 4 forms |
| R3 | authored lines | `choices.perspTpl[S]` 3; 8 forms |
| R4 | authored lines | `choices.mirrorTpl` 4, `choices.reliableTpl` 4; 7 forms |
| X1 | authored lines + held-out families | 1 bed template per bed |
| X5 (records) | authored assumption and conventions lines | as R1–R4 |
| X8 | authored conventions lines | as R1–R4 |
| Q5 (wave 2) | 3 of 13 `bugs[].template` ids, each from a class keeping a training template | – |
| other ports | skeleton buckets | – |

- **Held-out bed templates are re-rendered, not world-rejected**, in train, calib and dev (§2.3
  rule 7). They are too few forms to gate (6, 4, 8, 7) and are reported as a strip plot.
- **Skeleton holdout.** `skeleton(span)` masks digits, hex runs and timestamps, every entity,
  service, person and system name from the world's own name lists, and quoted strings, then hashes
  the rest. Buckets by hash: 0–20% test-OOD, 20–30% dev-OOD, 30–40% calib-OOD, 40–100% train. A
  skeleton axis gates only with ≥ 30 clusters per label; otherwise it is "diagnostic:
  n_forms = k" [crit S1; revision 1 allowed 5]. For F1 the skeleton is the workflow shape of the
  exec-injected family.

### 3.4 Held-out families (pre-registered, one training run)

| Port | Train families | Held-out families (test-OOD only) |
|---|---|---|
| X1 | records, incident, synth, runbook, codefix, gameqa | **kinetics, gridquest**, external deepset |
| X2 | records, synth, incident | **gameqa** |
| X3 | kinetics (and codefix if tapped) | **runbook** |
| X4 | runbook, kinetics, synth, gameqa | **incident** |
| X5 | records, synth, incident, bedtype (7 families) | **kinetics, runbook**, bedtype (kinetics and runbook descriptions and prompts) |
| X6 | gameqa | **codefix** |
| X7 | synth, incident, gameqa | **kinetics** |
| X8 | records, kinetics | **synth**, records-real (reserved worlds) |
| Q4 | gridquest, runbook | **gameqa** |
| F1 | exec-injected, templates, gameqa | none available in wave 1 (REAL is a case study, §3.5) |
| F2 | codefix: 4 domains | **codefix: 2 domains, ownerci** |
| Q6 | gameqa | **codefix** |

- Cross-port leakage of held-out families is covered by the general span-skeleton registry
  (§2.3 rule 7): kinetics injection lines cannot reach training as X4 kinetics items.
- One training run serves every family test; leave-one-family-out runs for X1 are optional
  follow-ups.

### 3.5 Real-trace sets and the availability rule [crit S7, G8]

**An axis is available** (counts in §8.1) only with **≥ 30 independent tasks or worlds and ≥ 300
rows** labelled by an oracle, a replay or a journal outcome. Below that it is reported as a case
study, outside §8.1.

| Set | Port | Size | Label | Status |
|---|---|---|---|---|
| real reserve: weak model on records extraction, 120 worlds (test 7000–7039 × d3–d5) | X8 | about 960 calls, about 1,500 gated field rows (day ≤ 12 strata) | field = the world regenerated from the task key | **available** once run |
| `records-hand-pilot` journal | X8 | 121 Haiku 4.5 calls, 12 runs, 5 worlds, inside train seeds [M crit-G] | as above | case study |
| probe real failures | F1 | 9 items, 3 distinct states, LLM-labelled [M crit-S] | – | **dropped** |
| journaled failures with replay/resample/control labels | F1 | 0 today | check outcome | case study until ≥ 30 tasks, 300 rows |
| `c0-smoke`, `distill-pilot`, `calibration` journals | F1, X8 | 4 + 15 + 12 calls [M here] | as above | case study |
| judge-node ledger rows (W4) | every wired port | 0 | oracle, replay or control outcome | claim-bearing at ≥ 300 rows over ≥ 30 worlds (T3, §8.5) |

### 3.6 Kev's own suites (the forgetting battery, §6.4)

- `evals/v7/decision-v7/development.jsonl` (1,204 records; reported but flagged in-distribution,
  because replay draws from decision-v7 train), `evals/v4/transfer-v4/development.jsonl` (764),
  `evals/hard-v1/development.jsonl` (700; mandatory, not replayed) and the unknowable records of
  `evals/v9/transfer-v9` development [D dossier §2.5] [crit S12].
- Never used: Kev's `test.jsonl` partitions ("one read, ever", `kev:README.md:345`).
- Replay draws from decision-v7 `train` on `jaredpalmer/kev-suites@cc4bac80…`, which declares no
  licence and mixes Yelp, Amazon, IMDB, AG News, MNLI and others [M crit-G G18]. Use: replay only;
  adapters are not redistributed. Manifest entries are written by `assembly` (§10).

---

## 4. Sizes and the learning curve

### 4.1 Unit and throughput

- **Row** = one (state, question) pair. With LoRA, Kev runs each question as its own causal row
  over the full state (`shared_prefix` is off by default for LoRA, `kev:kev/train.py`) [D]; J0b
  tests `shared_prefix 1`.
- **Cost is forward tokens, not rows** [crit G3].
  - The smoke's 0.287 s/example has no run record here; the bundled toy file has 3 questions per
    record, 30-token states and 151 forward tokens per record, so it is about 525 tokens/s on 8
    optimizer steps including warm-up [M crit-G]. It can be wrong in either direction: pessimistic
    for short multi-question records, far too optimistic once tokens dominate.
  - Independent anchor: the v1.0 release run did 15.5M forward tokens in 3,136 s = **4,953
    tokens/s** at batch 4 on a ≥ 24 GB device, with **+34.6%** variants from none-pair siblings
    [D release `training_metrics.json`, read by crit-G].
  - Token model [E crit-G]: 800 forward tokens per requested training row (about 530 mean real
    state tokens with 5% long variants, plus about 100 branch tokens, × 1.3 none-pair inflation on
    3+-option ports) and 500 per replay record.
- J0 replaces these with two measured parameters, seconds per record and seconds per forward
  token, at about 300 / 2K / 8K real tokens (§7.4).

### 4.2 Evidence on how much data Kev needs [D]

| Source | Setting | Result |
|---|---|---|
| `kev:skills/kev-finetune/README.md:46-50`; `kev:README.md:157` | Kev-4B, 3 questions, generated records | 400 records: gain inside the noise. 1,050 records: 67.7% → 73.6% (CI +2.3 to +9.7) |
| `kev:README.md:157` | Kev-4B, 5,219 real complaints, 1 epoch | 0.804 → 0.904 |
| `kev:PLAN.md:196-197` | hard-v1, more data from the same generator | +26 pp for the first 6K records, +5 pp for the next 12K |
| `kev:skills/kev-finetune/references/data-format.md:52-56` | sizing table | 300–600 first real run; 1,000–3,000 production |
| `kev:skills/kev-finetune/scripts/plan_size.py:25-28` | McNemar, paired | +5 pp at 80% power: 281 questions (2% regressions) to 469 (5%); +10 pp: 108–155 |

- **Reading.** About 1,000 rows per question type is where Kev's docs first show a real gain, on a
  4B model; 0.8B is weaker everywhere [D dossier §2.1]. Note that the McNemar sizes count
  independent questions; with form clustering the independent unit is the form (§6.0).
- **Capacity.** Extra rows over the same forms add repetitions, not information: about 10 rows per
  distinct training form is the cap [E].

### 4.3 Allocation and set sizes (pre-registered)

**Bands** come from the stock-Kev read on **dev-OOD** (J1), before any training:
- **hard (weight 1.5):** stock balanced accuracy < 0.75, or K ≥ 5, or ≥ 3 families;
- **capacity-bound (weight 0.5):** fewer than 300 distinct training forms in the build (counted
  after `train-pools`); rows capped at 10 × forms;
- **medium (1.0):** otherwise. Rows for a port = N × weight / Σ weights; surplus from capped ports
  goes to the hard ports.
- **Provisional bands** (until J1): hard = S2, X1, X3, X5, X8, I1, F1, Q4; medium = R1, I2;
  capacity-bound = R2, R3, R4 (Σ = 15.5). With 20 paraphrases per template, R2–R4 may leave the
  capacity band; the rule decides on the build.

| Train rows N | hard port | medium port | capacity-bound port |
|---|---|---|---|
| 2.5K | 240 | 160 | 80 |
| **5K** | **480** | 320 | 160 |
| 10K | 970 | 650 | 320 |
| 20K | 1,935 | 1,290 | 645 |
| 40K (conditional) | 3,000 (cap) + surplus | 2,580 | capped |

Cross-bed ports split their train rows evenly over their train families (X1 six, X5 four, X8 two,
Q4 two); F1 keeps templates ≤ 20%.

**Evaluation sets per wave-1 port** (rows; one question per port per state in test):

| Set | Rows per port | Notes |
|---|---|---|
| calib-in | 300 | report only |
| calib-OOD | 500 (X5 1,000; X1 600 enriched) | ≥ 40 authored forms per label for template-bound ports |
| dev-select | 200 | in-family |
| dev-OOD | 600 (X5 1,000) | ≥ 60 forms per label (template-bound); read at every curve point |
| test-in | 500 | read once |
| test-OOD | per axis, below | read once |

| Port | Template / skeleton | Paraphrase | Families | Real | Adversarial (pairs) | Unknowable | Long | Causal | Other | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| R1, R2, R3, R4 (each) | 600 + 150 bed-template diagnostic | 400 | – | – | 400 (800 rows) | 300 | 150 | flip 400, invariance 400, slot 200 | – | 3,400 |
| I1 | 600 | 400 | – | – | 400 (800) | 300 | 150 | – | – | 2,250 |
| I2 | 600 | 400 | – | – | 200 (400) | – | – | – | balanced copy 300 | 1,700 |
| S2 | 600 | 400 | – | – | 400 (800) | 300 | – | – | balanced copy 400 | 2,500 |
| Q4 | 600 | 400 | gameqa 600 | – | 400 (800) | 300 | – | – | – | 2,700 |
| X1 | 600 authored | 400 | kinetics 600, gridquest 600, deepset ≤ 600 | – | – | – | 150 | – | natural rate 3,000 | 5,950 |
| X3 | 600 | 400 | runbook 600 | – | 400 (800) | 300 | – | – | – | 2,700 |
| X5 | 1,000 | 400 | kinetics 600, runbook 600, bedtype 600 | – | 400 (800) | in labels | 300 | flip 400, slot 200 | – | 4,900 |
| X8 | 600 | 400 | synth 600 | 1,500 | 400 (800) | – | – | flip 400 | – | 4,300 |
| F1 | 600 (workflow shapes) | 400 | – | case study | 200 (400) | – | – | – | – | 1,400 |
| **Wave 1** | | | | | | | | | | **≈ 42,000** |

**Totals per learning-curve point** (wave 1; rows = state-question pairs):

| Point | Foundry train rows | Replay records | Forward tokens [E] | Evaluation read at the point |
|---|---|---|---|---|
| 2.5K | 2,500 | 2,000 | 3.0M | 15,200 (calib-OOD 7,000 + dev-OOD 8,200) + forgetting battery |
| 5K | 5,000 | 2,000 | 5.0M | 17,800 (calib-OOD 7,000 + dev-select 2,600 + dev-OOD 8,200) + forgetting battery |
| 10K | 10,000 | 2,000 | 9.0M | 15,200 + battery (dev-select is read at 5K, 20K and 40K only) |
| 20K | 20,000 | 2,000 | 17.0M | 17,800 + battery |
| 40K (conditional) | 40,000 | 2,000 | 33.0M | 17,800 + battery |
| final read (once, stock and candidate) | – | – | – | test-in 6,500 + test-OOD ≈ 42,000 + calib-in 3,900 |

Wave-2 ports get a smoke set only (§10): about 300 train and 100 dev-select rows per port.

- **Worlds and build time.** Records worlds generate in about 61 ms each [M here]; the other beds
  in under 2 s [D `beds/CONTRACT.md`]. CPU build time is minutes to about an hour; the cost is in
  pool authoring, hosted arms and the embedding arm (§5).

### 4.4 The curve that answers "is 5K sufficient?"

- **Points.** Nested training sets at N = 2.5K, 5K, 10K, 20K (40K conditional): each larger set
  contains the smaller one in the same seed order; replay fixed at 2,000; 1 epoch; only N varies.
  **Two training seeds at 5K and 20K** [crit G11, S6].
- **Read-out** on **dev-OOD** (gating unit counts, §6.0) after a calib-OOD refit at each point;
  dev-select at 5K and 20K for the transfer gap. Test-OOD is never read for the curve.
- **Decision rule (pre-registered).** Δ = balanced accuracy(20K) − balanced accuracy(5K) on
  dev-OOD, averaged over the two seeds; CIs from the two-way (form × world) bootstrap with the
  between-seed variance added.
  - **Per port:** *sufficient* if the one-sided 95% upper bound of Δ is < 3 pp and the coverage
    gain at ε has an upper bound < 5 pp; *insufficient* if the lower bound of Δ is > 0;
    otherwise *indeterminate*, reported with its minimum detectable difference.
  - **Overall** (macro over wave-1 ports, port-stratified bootstrap): *sufficient* if the upper
    bound is < 2 pp; *insufficient* if the lower bound is > 0; otherwise *indeterminate*.
  - **40K trigger:** the overall 10K → 20K lower bound is > 0, or ≥ 3 ports are *insufficient*
    with a 10K → 20K lower bound > 0. An indeterminate outcome does not trigger 40K; the report
    states the N the observed slope would need.
  - **Power, written down first.** Before J2, `analyze.mjs` simulates the rule at true
    differences of 0, 1, 2 and 3 pp using J1's dev-OOD unit counts and discordance, and the
    pre-registration records the outcome probabilities and each port's MDE [crit G11]. At about
    120 forms per port, per-port verdicts will often be indeterminate; the pooled verdict (about
    1,500 forms) is the one designed to resolve [E: 1.96 × 0.3 / √1,500 ≈ 1.5 pp].
- **Prediction (written before any run).** 5K is sufficient at most for R2–R4. It is
  insufficient for S2, X5, X8, I1 and X3. For X1 and F1, more rows raise in-family accuracy but
  not family-OOD accuracy, because those ports are limited by their families.
- **Memorisation signature.** Flat dev-OOD while dev-select rises means memorising: more rows will
  not fix it; more surface forms or families will. That port's verdict says so.

---

## 5. Baselines (per port, same records, same splits)

1. **Prior** [crit S11]: the calib-OOD class prior at the deployment rate.
2. **Partial-input battery** [crit S9f, S15]: decisive span only; context only (decisive span
   removed); metadata only (system, marker, `source_kind`, `error_code`, `node_kind`, service
   handle); format only (date-range presence, length, digit counts); `prior_runs` only (F1); and the
   full bag-of-words probe (`lib/probe.mjs`, unigrams and bigrams, trained on the train split). All
   are logistic regressions fitted on train.
3. **Rule** (≤ 30 lines per port), from the bed READMEs and option semantics, tuned on train and
   dev-select only. The probe's rules are reused where ports overlap.
4. **Embedding** (`BAAI/bge-small-en-v1.5@5c38ec7c`, MIT; fallback
   `sentence-transformers/all-MiniLM-L6-v2@1110a243`, Apache-2.0), CPU in `/opt/kev-venv` with
   `python -I`. kNN (k = 15, cosine, distance-weighted) and L2 logistic on
   `[e(q); e(s); e(q) ⊙ e(s)]` (C chosen on dev-OOD). Two input variants [crit G14]: head-and-tail
   truncation to 512 tokens, and **chunk-and-max-pool** over 512-token chunks, so long states are
   not cut against the baseline. **Variable-option ports** (S1, K2, F2, Q3, C1 per requirement)
   use option scoring: cosine between e(q ⊕ s) and each option's description, fed to the logistic.
   Measured CPU cost: 35 ms/text at 128 tokens, 86–289 ms at 242 tokens [M crit-G]: about 3–8 h
   per 100K texts, run as a background job with an embedding cache keyed by text hash.
5. **Stock Kev-0.8B@v1.0**, read through the same served path, with T and per-option biases refit
   on calib-OOD exactly as for the candidate.
6. **local-logit** [crit G14]: `Qwen/Qwen3.5-0.8B-Base@dc7cdfe2` option-letter logits on 100
   dev-OOD items per wave-1 port, on this CPU. Diagnostic: it joins the best baseline only if it
   beats stock Kev on dev-OOD for that port.
7. **Weak model, zero-shot typed** (owner decision O1), JudgmentPort engine `model`,
   `decoding {maxTokens 128, reasoning 'none'}`, self-reported confidence with a one-parameter
   power transform fitted on calib-OOD. **A 50-call pilot runs first** and fixes cost and latency
   per call [crit G15]. Planned arms: calib-OOD 300 per port and a test-OOD subsample of about 900
   per port (template or skeleton 300, family 300 where present, paraphrase 150, adversarial 150
   pairs), about 15.6K calls. Cost per call on the CLI path: Haiku 4.5 at least $0.0045, median
   $0.0139 in the pilot journal [M crit-G] → about $70–220; Haiku 5.5 lists at a tenth of Haiku
   4.5's token price, but the CLI path's fixed overhead is unmeasured. Concurrency ≤ 4 at 3–9 s
   per call is 3–10 h of cloud wall clock, run in parallel with the laptop nights.
8. **Sonnet 5.5, zero-shot typed, subset:** 150 calib-OOD + 300 test-OOD per port (about 5.9K
   calls), priced by the pilot.
9. **Composite-question arm** (S2 only): the probe's direct "usable claim?" question against code
   composition of S2 ∧ S3 ∧ S4 ∧ X2.

- **Best baseline**, per port and axis: the strongest of prior, the partial-input battery, rule,
  embedding-logistic, embedding-kNN, stock Kev, and local-logit if it qualifies. The weak model
  and Sonnet are compared in the cost-adjusted rule (§8.1).
- **Hosted budget.** Arms, the real-trace and end-to-end runs (§3.5, §8.3), surface authoring and
  auditor reads come to about $150–450 [E] before the pilot. The pilot sets the number (owner
  decision O2); the subsamples are drawn by a pre-registered hash, so a cut nests. Pause and ask
  above $500 (policy).
- **No larger-model ceiling** unless the owner funds one cloud read of stock Kev-4B on the OOD
  axes of three ports (O6) [crit G28]. Kev's README puts Kev-0.8B at 0.14 coverage at a 5% error
  budget on new-source decisions against 0.52–0.69 for Kev-4B to 27B (`kev:README.md:216`).
  Without it, the weak model and Sonnet are the only ceiling arms, and the report says so.

---

## 6. Metrics and gates

### 6.0 Units, intervals and minimums [crit S1, S14, S17]

- **Unit.** The independent unit of an axis is the **masked surface form**: the skeleton of the
  label-bearing sentence (template ports), the skeleton cluster (skeleton ports), the form within
  a held-out family (family axes), the wording (paraphrase axis), the task or world (real axis).
- **CIs** come from a paired **two-way cluster bootstrap over form × world** (paired items, pairs
  and multi-wording records also clustered by state), 10,000 resamples. Per-form accuracy is shown
  as a strip plot next to every axis number. (Revision 1's world-clustered CI over 493 items on
  R3's held-out templates was ±4 pp; form-clustered it is ±27 pp [M crit-S Q3].)
- **Minimum to gate:** ≥ 30 independent forms per label (paraphrase: ≥ 20 wordings; real: ≥ 30
  tasks and 300 rows). Below that the axis prints "diagnostic: n_forms = k" and `analyze.mjs`
  refuses to emit a verdict for it.
- **Point or bound.** Every gate below states which. The pre-registration lists, per port and axis,
  n, the unit count, and the false-fail probability of a model sitting exactly at the threshold.
- **Deployment rate.** Risk and coverage are read only on deployment-rate sets (§1.0); balanced
  copies give per-class recall only.

### 6.1 Co-primary metrics [crit S11; crit-G §2.9]

| Id | Metric | Gate (every available OOD axis) |
|---|---|---|
| ACC | **balanced accuracy** (macro recall) | paired difference against the best baseline: 95% lower bound > 0 |
| BSS | **Brier skill score** against the calib-OOD prior (Brier as in `calibrationReport`, `fdy:src/judgment.mjs`) | paired difference in Brier against the best baseline: 95% upper bound ≤ 0 |
| RISK | **coverage at ε** with realised risk | τ fitted on calib-OOD at the deployment rate; realised risk on test, one-sided Clopper–Pearson upper bound ≤ ε + 0.03 (ε = 5%: passes at ≤ 29 errors in 500 accepted). X5: ε = 2%, bound ≤ 0.04 (≤ 29 errors in 1,000 accepted) |

A constant `own_measurement` answer on S2 fails ACC and BSS by construction (acceptance test).

### 6.2 Calibration and robustness gates

| Id | Metric | Gate |
|---|---|---|
| ECE | 15 equal-mass bins on p(chosen) (primary); 10 equal-width as a check | ≤ 0.05 point estimate, **only on axes with ≥ 500 items**. A perfectly calibrated model fails ECE ≤ 0.05 with probability 0.35–0.77 at n = 100 [M crit-S Q21]; smaller axes report a reliability diagram with a bootstrap band and the Brier calibration component, no gate |
| GAP | transfer gap: balanced accuracy, test-in minus each OOD axis | reported; > 10 pp labels the port "memorising" |
| LONG | accuracy at the long variant against short, 150 per length | drop ≤ 5 pp (point), CI reported; otherwise the budget shrinks to the largest passing size |
| UNK | share of **held-out-phrasing presence-matched** unknowables answered with p ≥ 0.9, n ≥ 300 | one-sided upper bound ≤ 0.08 (passes at ≤ 16/300). The 2 × 2 known/new phrasing × stated/unknowable is reported |
| PARA | argmax agreement across Q0 and two test wordings; accuracy on 20 test wordings | agreement ≥ 0.90 (point) and held-out-wording accuracy within 3 pp of Q0 (CI over wordings) |
| ORDER | `POST /v1/systemone/permute`, n_perm = 6, 200 items per port (`kev:kev/serve.py`); label-position accuracy | flip rate ≤ 5% (point; stock 0.8B 5.6% out of domain [D dossier §1.7]); if it fails, rotation averaging is tested and, if it passes, served at 3× cost |
| INJ | 400 clean/injected pairs: accuracy drop and **target-flip rate** (argmax becomes the urged option) | drop ≤ 3 pp (point) and target-flip upper bound ≤ 5% (passes at ≤ 12/400) |

### 6.3 Causal gates and partial-input ceilings [crit S9, S15]

| Id | Metric | Gate |
|---|---|---|
| FLIP | counterfactual flip twins (same index, opposite polarity), 200 pairs | flip rate lower bound ≥ 0.90 (passes at ≥ 188/200) |
| INV | invariance twins (another template, same label), 200 pairs | unchanged-answer rate lower bound ≥ 0.90 |
| SLOT | two-system states with opposite labels, asked about each system | balanced accuracy within 3 pp of single-system states (CI of the difference) |
| EVID | evidence-dependence: on presence-matched unknowable twins | tuned accuracy ≤ context-only baseline + 3 pp, and mean max-p within 0.10 of the prior |
| HARD | probe-hard stratum: test items the train-fitted probe gets wrong | tuned beats every baseline there (lower bound > 0), where the stratum has ≥ 30 forms |
| PART | partial-input ceilings: each partial-input baseline's balanced accuracy | ≤ majority + 3 pp on every axis (build gate before freeze, re-read on test) |
| PAIR | pair consistency for X5 polarity pairs and every twin set | both-right rate reported; X5's accuracy is pair accuracy |

Each causal gate has a **planted-shortcut control**: a model trained on a build with the KOBO
priors left in must fail EVID on KOBO items; a build with R4's date-window shortcut left in must
fail PART. If a control passes, the gate is broken and blocks claims.

### 6.4 Forgetting battery [crit S12]

Each bound is a one-sided 95% CI against stock, paired.

1. transfer-v4 dev and hard-v1 dev (mandatory, never replayed): accuracy drop ≤ 2 pp;
   Brier rise ≤ 0.02.
2. decision-v7 dev: reported, flagged in-distribution (replay comes from decision-v7 train).
3. transfer-v9 unknowable records: share answered with p ≥ 0.9 ≤ stock + 2 pp.
4. `/permute` flip rate on 200 suite items ≤ stock + 2 pp.
5. Option-name prior drift: p(`yes`) and p(`same`) on 200 content-free or irrelevant states;
   mean shift ≤ 0.05 (binary ports share option names with other yes/no questions).
6. A **generic canary set**: 300 Foundry-shaped questions from wave-2/3 ports and non-port enums
   (agent nodes with enum returns from the repository's workflows): accuracy where labelled,
   agreement with stock otherwise, reported with bounds. The tuned model will serve these too,
   since the bridge runs one `kev.serve` at a time.

A deliberately over-trained candidate (ep2 at lr 4e-5) is read once as a control; if it passes
items 5 and 6, the battery is too weak and blocks claims.

### 6.5 Operational gates

| Id | Metric | Gate |
|---|---|---|
| LAT | p50 and p90 at the typical state, fresh and cached, through the tunnel with `bridgeFetch` | in-workflow gate ports: p90 ≤ 2 s (owner smoke: about 0.5 s first call, about 25 ms cached [M owner]) |
| CPU | the same on this VM's CPU (fp32) | reported only; never an in-workflow fallback |
| COST | imputed laptop compute plus hosted $ per 1,000 decisions, escalations included | used in §8.1 |

### 6.6 Always reported

Span-overlap rate per axis; per-family, per-difficulty and per-form accuracy (strip plots);
probe-easy and probe-hard strata; `needsWorldKnowledge`, press-release and day ≤ 12 strata;
label-position accuracy; confusion matrix; the 20 most confident errors kept raw as negative
results; every axis's unit count next to its number.

---

## 7. Training plan

### 7.1 Pins

- **Init:** `jaredpalmer/kev-0.8b@v1.0` (weights `9a45d25e`; card commit `bf75a6a8…`) [D dossier
  §1.1; M here].
- **Base:** `Qwen/Qwen3.5-0.8B-Base`, `base_revision dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68`
  (from the v1.0 `training_config.json`) [M here], passed explicitly.
- **Kev code:** `5e42a7a03f28134853dd3ff77461457e921e5ec1` on both sides; every job records
  `git rev-parse` of the laptop's checkout. The release was trained by a Kev revision with a
  `lora_placement` field the pin lacks; the module sets agree [M crit-G].
- **Replay suite:** decision-v7, `jaredpalmer/kev-suites@cc4bac803e73112689ec327ffa481c519cbc7a05`.

### 7.2 Recipe

The recipe mirrors the released 0.8B final stage [M here, re-checked by crit-G]: lr 2e-5, 1 epoch,
LoRA r16, `lora_targets all`, `head_dim 256`, `p_none 0.1`, `p_none_distract 0.12`,
`p_distract 0.15`, `p_none_pair 0.25`, replay from decision-v7; batch 1 × accum 8 (the release's
effective batch of 8 at 4 × 2) because of the 8 GB card.

- **Augmentation adds out-of-contract options** [crit G19]. With p 0.10 (questions with > 2
  options) the true option is removed and a generic "other / none / not listed" key becomes the
  label; with p 0.12 a generic option is added as a wrong alternative; with p 0.15 an irrelevant
  distractor; `p_none_pair 0.25` adds two sibling records for 3+ option questions
  (`kev:kev/data.py`). None but `p_none_pair` is a bridge parameter. Foundry contracts never
  offer such options, and the catch-all ports (I2 `unrelated`, X5 `not_stated`, X3 `mentions`)
  will see a different generic key correct beside their own. It is the release recipe and stays;
  its effect is tested by grid config `np0` (§7.3).
- **Long states.** States over 2K real tokens train with `row_budget 16384` and `length_sort 1`
  (bridge-exposed). `weights_dtype bf16` is used only for the J0 long-state probe, never for curve
  points: it is not a warm-start compatibility field, so a bf16 head would make every later
  stock-versus-candidate comparison differ in numerics as well as weights [crit G4].
  `perm_kl` and `row_budget` conflict in Kev and are never combined.
- `--anchor` is not exposed and is a documented negative result (`kev:PLAN.md:255-273`) [D].

### 7.3 Small grid (at 5K, one factor at a time)

| Config | Change | Prior expectation |
|---|---|---|
| base | as §7.2, replay 2,000 | — |
| lr4 | lr 4e-5 (the skill's 0.8B default, cap 5e-5) | maybe +, more forgetting |
| ep2 | epochs 2 | + on hard ports if the train loss still falls |
| rp6 | replay 6,000 | less forgetting |
| np0 | `p_none_pair 0` | tests the augmentation on catch-all ports: their `unrelated` / `not_stated` / `mentions` recall on dev-OOD is reported for base and np0, and a drop > 3 pp is flagged [crit G19] |

- Revision 1's `pkl` (`perm_kl`) and `brier` (`brier_w`) configs are dropped: Kev lists both
  among its failed levers (`kev:PLAN.md:255-273`), `perm_kl` conflicts with the long-state flags,
  and the laptop budget is the binding constraint [crit G3].
- **Selection** on dev-OOD only [crit G10]: minimise macro NLL across wave-1 ports after the
  calib-OOD refit, subject to the forgetting battery (§6.4); ties within 0.005 NLL go to base. The
  dev-select NLL is reported beside it. The winning config is retrained at the N the curve selects
  (if it is not base); otherwise the curve's model at that N is the candidate.
- **Test sets are read once**, for the selected candidate and for stock Kev.

### 7.4 Jobs, schedule and budget

Bridge kinds: `kev.train`, `kev.benchmark` (`run`, `data`, `rotations` only) and `kev.serve` (one
at a time; a second is refused with 409 `service_exists`) (`fdy:bridge/laptop/jobs.mjs`, `KINDS`).
Job outputs are `runs/<jobId>/`; `kev.benchmark`, `kev.serve` and J3 accept `runs/<jobId>` only for
a `kev.train` job this daemon finished whose `head.pt` sha still matches [crit G17].

**Prerequisite.** Ask the laptop agent for the smoke run's `training_metrics.json` and `train.log`
(`forward_tokens`, `wall_seconds`, `step_seconds`, `peak_device_bytes`, `peak_rss_bytes`) [crit G3].

```jsonc
// J0a: two-parameter throughput, host RAM, VRAM, kernel path (3 jobs). 400 rows at about 300 / 2K / 8K real tokens.
{ "kind": "kev.train", "params": { "dataset": "data/j0-0300.jsonl", "base": "Qwen/Qwen3.5-0.8B-Base",
  "initFrom": "jaredpalmer/kev-0.8b@v1.0", "epochs": 1, "lr": 2e-5, "batch": 1, "accum": 8, "dtype": "bf16",
  "maxState": 8192, "checkpointing": 1, "lora": 16,
  "extra": { "base_revision": "dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68", "max_steps": 50, "seed": 1,
             "suite": "evals/v7/decision-v7", "replay": 50 } } }       // prefetches decision-v7 train and checks its hash
// j0-2k: "max_steps": 30, "row_budget": 16384, "length_sort": 1
// j0-8k: "max_steps": 10, "row_budget": 16384, "length_sort": 1, "weights_dtype": "bf16" (long-state probe only)
// J0b: j0-0300 rebuilt as 4-question records with "shared_prefix": 1; adopt if >= 1.5x faster and 50-step losses match within 1%.
// J0c: kev.serve (stock), then score-served.mjs on 400 records at 300 and 2K tokens, concurrency 1 and 4:
//      seconds per request, tunnel round trip; then stop the service.
// J1:  stock reads. kev.benchmark --data only for files whose every state fits 384 tokens (I2, S2, X1 short,
//      F1 templates, Kev suites); every other file through score-served.mjs against stock kev.serve.
// J2:  curve point (N = 2.5K, 5K, 10K, 20K; files nested), as J0a without max_steps, "maxState": build p99.9,
//      "replay": 2000, "p_none_pair": 0.25, seed 1; seeds 2 at 5K and 20K.
// J3:  the J1 reads with "run": "runs/<J2 jobId>" (kev.serve for served files).
// J4:  grid configs (§7.3): J2 at 5K plus one changed field.
// J5:  final: test-in, test-OOD, calib-in, permute and latency, stock then candidate (never concurrent).
```

**Acceptance per job** [crit G17]: `train.log` contains no "dropped" line and its `N training
requests` equals file records plus replay; `training_config.json` shows `init_from` and
`base_revision` as pinned; the dataset sha256 matches the build manifest; any benchmark report
with `coverage.rejected_records > 0` is invalid; J0 reports s/record, s/token, tokens/s,
`peak_rss_bytes` (must stay under 80% of free RAM, no OOM-kill in `train.log`),
`peak_device_bytes`, `free -m`, free disk and the DeltaNet kernel path [crit G4].

**Laptop time.** Training tokens per point (§4.3) at three rates:

| Point | Tokens | 525 tok/s (toy smoke) | 1,500 tok/s (assumed) | 4,953 tok/s (release, batch 4) |
|---|---|---|---|---|
| 2.5K | 3.0M | 1.6 h | 33 min | 10 min |
| 5K | 5.0M | 2.6 h | 56 min | 17 min |
| 10K | 9.0M | 4.8 h | 1.7 h | 30 min |
| 20K | 17.0M | 9.0 h | 3.1 h | 57 min |
| 40K | 33.0M | 17.5 h | 6.1 h | 1.9 h |

Evaluation: one read of the 17,800-row point set is about 11,900 served requests at about 1.5
questions per request, 0.075–0.3 s each, so 15 min to 1 h [E]; J0c replaces this. The final read
(about 52K rows, stock and candidate) is 2–7 h.

**Budget and priority** (pre-registered; at most 5 nights of 8 h = 40 laptop hours, owner decision
O7). At 1,500 tokens/s the full plan is about 99.5M training tokens (18.4 h) plus 12 point reads
(3–12 h), the forgetting battery (about 1.2 h), the final read (2–7 h) and J0 (about 0.75 h):
26–40 h. Work runs in this order, and whatever does not fit is cut from the bottom:

1. J0 (all parts) and J1.
2. Curve seed 1 at 2.5K, 5K, 10K, 20K; the end-to-end checks start after the 5K point (§8.3).
3. Seed 2 at 5K and 20K.
4. Grid at 5K (lr4, ep2, rp6, np0) and the final retrain at the selected N.
5. 40K if triggered; one combined wave-2 smoke fine-tune (4K rows) [crit G25].
6. J5, the final read: always runs, on whatever candidate the completed steps selected.

**Reduced plan**, pre-registered for a measured rate below 1,500 tokens/s: points 2.5K, 5K and
20K; second seed at 5K only; grid {base, lr4} at 5K; no final retrain; no 40K. About 35M tokens
(18.5 h at 525 tokens/s) plus 7 point reads.

**Memory and kernels** [crit G4]. The owner states 14 GB host RAM with about 2 GB free under WSL2;
the release run peaked at 10.3 GB host RSS on another machine, and an fp32 load stages about
3.1 GB on the CPU. The owner caps WSL memory and closes apps (O7); `kev.serve` is stopped before
every training job. `flash-linear-attention` 0.5.2 and `causal-conv1d` are absent from
`bridge/laptop/kev-requirements.txt`, so Transformers falls back to the torch DeltaNet path; J0
runs with and without `fla` if the owner installs it (O3), and the kernel path is logged per job.

**Optional bridge request.** If J0c shows more than 0.3 s per served request at concurrency 4,
the bridge owner is asked for a batch scoring job (Kev's `kev.benchmark --remote`, or a scoring
job with a `max_state` option). It is not a dependency; `bridge/` belongs to other agents.

### 7.5 Scoring path, calibration and thresholds [crit G1, G5, S4]

- **Scoring path = serving path.** `kev.benchmark --data` hard-codes the training context
  (state 384, branch 1,024) and skips every longer record as `ContextOverflow`, counting it in
  `coverage.rejected_records` while the job succeeds (`kev:kev/benchmark.py`, `kev:kev/model.py`)
  [M crit-G: 35 dev states, I1 8 lines 2 of 4 rejected, records and kinetics all rejected]. So
  `score-served.mjs` sends each record to the running `kev.serve` with
  `new SystemOneClient({ url: \`${endpoint}/svc/kev\`, fetchImpl: client.bridgeFetch })`
  (`fdy:bridge/PROTOCOL.md`, "From code"; every `/svc/kev` request is signed), all questions of a
  record in one request, one served model at a time. `kev.serve` takes states to 65,536 tokens and
  serves bf16 on CUDA, which moves probabilities by up to about 0.03 against fp32
  (`kev:README.md:409`); scoring on the served path removes that mismatch for both stock and
  candidate. `kev.benchmark --data` remains for files that fit 384 tokens entirely, where its
  fp32 numbers are reported beside a 300-row served re-read of the same file.
- **Fit on calib-OOD, at the deployment rate.** Probabilities come back at 4 decimals; they are
  floored at 5e-5. The transform is **vector scaling**: `log p'_k = log p_k / T + b_k`,
  renormalised, with a global T by default and per-port T and per-option biases b kept only if
  their 5-fold out-of-fold NLL beats T-only by ≥ 1% on ≥ 300 calib questions (Kev found per-type
  temperatures worse, `kev:PLAN.md:209-210`). A temperature alone cannot undo the prior shift
  between the 3:1-capped training prior and natural rates (ln(180/3) ≈ 4.1 nats between S2's
  `measured` and `instruction_like` [M crit-S]). Rare-positive ports fit on the enriched calib-OOD
  with importance weights back to the deployment rate; results are reported at that rate. ECE on
  test-OOD is reported for both the T-only and the vector fit.
- **Revision 1's in-family calib** held almost no errors (a probe already scores 0.99–1.00 on
  R2–R4 in-family [M crit-S Q1]), so minimum-NLL T sharpened without bound and τ(5%) accepted
  everything. calib-in now only reports the in-family/OOD calibration gap.
- **A delta run saves T = 1.0.** `Meta(...)` in `kev:kev/train.py` sets no temperature and
  `warm_start` does not copy the init's 2.351 [D crit-G G5]. Stock and candidate are therefore
  both refit; no "as shipped" Brier or ECE comparison is made.
- **Thresholds.** τ_port(5%), τ_port(10%) (X5: 2%) from `calibrationReport` (`errorBudget`) on the
  transformed calib-OOD probabilities. Frozen into the judge config (§8.4) with T, b and the run
  id; re-read after every retrain (`kev:skills/kev-finetune/SKILL.md`).
- **Stability test.** Two served reads of 300 dev-select rows per port agree within 0.01 in mean
  max-p with ≤ 0.5% argmax flips, or the port is flagged.

### 7.6 Artefacts and serving

- **Laptop output.** `runs/<jobId>/`: adapter, `head.pt`, `training_config.json`, `train.log`. The
  LoRA has 11.3M parameters (about 45 MB fp32) [E].
- **Cloud copy.** Pulled to `.foundry/kev-runs/<jobId>/` through the bridge's `outputs` listing;
  the sha256 of every file goes into `research/kev-20261007/runs.json`. Weights are never
  committed.
- **Live serving.** One `kev.serve` at a time on the laptop GPU; stock and candidate are
  sequenced, never concurrent, and no service runs during training. Foundry reaches it through
  `SystemOneClient` with `fetchImpl: client.bridgeFetch` at `<endpoint>/svc/kev` (§7.5), not a
  bearer token. Every ledger row records run id, dtype, backend, `fla` status, T and the bias
  vector hash (today `JudgmentPort` stores only `systemOneModel ?? body.model`, `fdy:src/ports.mjs`).
- **CPU copy.** The adapter can be served on this VM's CPU in fp32 for offline ports only, as a
  logged path (26 s fresh at about 566 tokens under load [M probe]).

---

## 8. Promotion, wiring and the evidence ladder

### 8.1 Promotion rule (per port, on test-OOD, pre-registered)

A tuned judge **gates** real decisions for port p only if **all** hold:

1. **Co-primary.** ACC, BSS and RISK (§6.1) pass on **every available** test-OOD axis (template or
   skeleton, paraphrase, family, real; §3.5 and §6.0 decide availability). The conjunction is an
   intersection-union test, so no further α adjustment is needed per port.
2. **Cost-adjusted.** At the port's ε, the expected cost per decision of
   `tuned → weak model → Sonnet` is lower than the best alternative chain's, at no higher realised
   risk: `c_kev + (1 − cov_kev)·(c_weak + (1 − cov_weak|kev-abstained)·c_sonnet)`, with imputed laptop
   compute for Kev and list prices for hosted models. A weak-model-first chain that is cheaper at
   equal risk wins, and the port's engine becomes the weak model.
3. **Calibration.** ECE where an axis has ≥ 500 items (§6.2).
4. **Robustness.** LONG, UNK, PARA, ORDER and INJ pass.
5. **Causal.** FLIP, INV and SLOT where available; EVID, HARD and PART everywhere; their
   planted-shortcut controls fail as designed.
6. **Forgetting.** The §6.4 battery passes.
7. **Latency.** LAT passes for in-workflow ports.

- **Otherwise the port stays advisory**: its judgments are logged and may **rank** (order checks,
  items or candidates), never accept, reject or skip.
- **F1 is not promotable in wave 1** (no available real axis). A port whose every gating axis is
  diagnostic cannot be promoted either; the report says "no power", not "no skill".
- **Multiplicity.** "k of N ports" uses Holm–Bonferroni over the wave's ports.

### 8.2 The judge in a workflow

- **Today nothing calls a port.** The node-kind enum has no `judge`
  (`fdy:schemas/workflow.schema.json`: task, assert, human, map, loop, wait, agent, code, verify),
  nothing outside tests constructs a `JudgmentPort`, and builder-facing text never mentions Kev
  [M crit-G G6].
- **Two hooks**, cheapest first: (a) a `systemone` provider route for existing `agent` nodes whose
  `returns` is a single enum (micro-harness operator 3, classify with an enum and cascade), which
  reuses `model.class/maxClass`, escalation, checks and the journal with no schema change (W0);
  (b) a journaled `judge` node, `{port, stateFrom, questions[{port, slots}], engine:
  'systemone@<run-id>', threshold: 'calibrated:0.05', onAbstain: 'escalate' | {default: <option>} |
  'fail', onUnavailable: 'escalate' | 'fail'}`, with all questions about one state in one request
  (W1). The script-harness arm reaches judges through a `tools/judge.mjs` helper beside its
  `callModel` helper (W6), because it never sees IR nodes.
- **Escalation chain** as §1.0: unknown port → hosted; Kev; weak model; Sonnet; terminal route.
  Each step is a journaled event with the request hash, model, p and cost.

### 8.3 End-to-end checks (W7) [crit G6]

Scheduled right after the 5K seed-1 point, so the phase produces a capability number early
(AGENTS.md), labelled development evidence, and repeated on the final candidate.
- **X8 cascade on weak-model extraction**, records d3–d5, the 120 real-reserve worlds (§3.5),
  ≥ 100 tasks per arm: weak model alone; weak model + X8 gate → Sonnet on flagged rows; Sonnet
  alone. The weak-model runs are shared with the X8-real axis. Metrics: oracle pass rate and $ per
  task, with CIs; below 100 tasks per arm the report gives the CI and no verdict. **This is the
  direct test of "make the weak model competent".**
- **X5 reuse gate**: the kept records workflow applied to e2e-reserve tasks (test 7040–7199) whose
  conventions match or differ, with ≥ 150 non-matching tasks: zero wrong reuses then bound the
  wrong-reuse rate at 2% (0/150 → one-sided upper bound 1.98%). Metrics: wrong-reuse rate,
  abstention rate, and the bedtype cross-type false-accept rate.

### 8.4 Group W: the wiring packages (built alongside the data, §10)

| Package | What | Test that can fail |
|---|---|---|
| W0 | `systemone` provider route for single-enum `agent` nodes | scripted Kev and scripted weak model: a low-p answer escalates once and both steps are journaled |
| W1 | `judge` node: schema, validator, executor, journal, replay; adapters reject it rather than flatten | replaying a journaled run makes 0 network calls and reproduces the output |
| W2 | port kits `src/judges/<bed>.mjs`, imported by the factory and the runtime | for 200 bed tasks per port, `buildState(task)` equals the training state byte for byte |
| W3 | router Kev → weak model → Sonnet → terminal route, with `onUnavailable` and the unknown-port rule | an injected tunnel failure yields a journaled escalation, never a silent default; an unknown port never reaches Kev |
| W4 | ledger content store: persist the request (state, question, criteria, options) by hash next to `requestHash` (`fdy:src/judgment.mjs`, `JudgmentLedger`), and an oracle-label join | a ledger row round-trips to the exact request; a joined label set exports in Kev format |
| W5 | policy proposal: `systemone` provider, Kev run ids with weight hashes, imputed cost (today `costUsd: 0`, `fdy:src/ports.mjs`) | a proposal file validates against `tests/model-policy.test.mjs`; the owner applies it (O4) |
| W6 | builder-facing: operator text for micro-harness operators 2, 3 and 4; `tools/judge.mjs` for the script arm; a port catalogue marking each port `gating` or `advisory` | the validator rejects a `gating` binding to an `advisory` port |
| W7 | end-to-end harness (§8.3) | arms below the task minimum produce "no verdict" |
| W8 | maturity bookkeeping per port (ROADMAP §6.2: EXISTS, REACHABLE, DEFAULT-LIVE, OBSERVED, CAUSAL, PRODUCT-PROVEN) | after T1 a port is at most EXISTS; REACHABLE needs W0 or W1; DEFAULT-LIVE needs the builder to emit it unprompted |

Judge config per port (W1/W3): wording hash, option-contract hash, run id, T, biases, τ(5%),
τ(10%), status (`gating` or `advisory`) and the evaluation report hash; editing the wording or
options invalidates the promotion (D:D10 re-qualification).

### 8.5 The evidence ladder [crit-G §2.9]

- **T1** offline per-port gates on generator labels (this program): *development evidence*.
- **T2** the wired end-to-end checks of §8.3: *development evidence for the mechanism*.
- **T3** claim-bearing: ledger rows from judge nodes in C0, C3 and C2 experiments, ≥ 300
  oracle-labelled rows per port over ≥ 30 worlds; the sealed-family result is left to the sealed-bed
  owner. T1 cannot support the claim-C4 sentence by itself.

---

## 9. Pre-registration skeleton (frozen before any J2 run)

```yaml
id: kev-judge-w1
status: DEVELOPMENT (T1: generator-labelled dev beds; T2 end-to-end; claim-bearing only at T3)
claim: >
  Claim C4 (per port): for each wave-1 port p, Kev-0.8B fine-tuned from jaredpalmer/kev-0.8b@v1.0 on
  generator-labelled Foundry decisions beats the best of {prior, partial-input battery, rule,
  embedding-logistic, embedding-kNN, stock Kev (+ local-logit if qualified)} in balanced accuracy and
  Brier skill, and holds its risk at the calibrated threshold, on every available held-out axis
  (authored templates or skeletons, wordings, families, real traces); ports that fail stay advisory.
supports: claim C4 (applicability = X5 incl. bedtype, drift = Q4, failure class = F1 [not promotable in wave 1])
does_not_support: downstream wrong-reuse in Phase 5, sealed-family generalisation, commercial parity
frozen_inputs:
  ports_contract: experiments/kev-data/spec/ports.json         sha256: <...>
  heldout: .foundry/kev-data/heldout/* (manifest committed)    sha256: <...>   # heldout-author only
  generator_commit: <git sha>; bed_pin: {allow-list of 9 beds + beds/lib + CONTRACT.md: sha256}
  frozen_runtime_for_F1: <git sha of src/>
  builds: {train-02.5k, train-05k, train-10k, train-20k, calib-in, calib-ood, dev-select, dev-ood, test-in, test-ood-*}: sha256 each
  seeds: {reserved: dev 1-400, train: dev 401-3999, calib_in: 4000-4199, calib_ood: 4200-4499,
          dev_select: 4500-4699, dev_ood: 4700-4999, test_in: test 5000-5999, test_ood: test 6000-6999,
          real_reserve: test 7000-7039, e2e_reserve: test 7040-7199}
  holdouts: §3.3 and §3.4 tables, verbatim; slice assignment hashes
models:
  init: jaredpalmer/kev-0.8b@v1.0 (bf75a6a8…), base Qwen/Qwen3.5-0.8B-Base@dc7cdfe2…, kev code 5e42a7a0…
  weak: claude-haiku-5-5     # from policy/models.json (O1 resolved 2026-10-07)
  strong: claude-sonnet-5-5 (subset)
  embedding: BAAI/bge-small-en-v1.5@5c38ec7c…
architect_vs_executor: data and code by Opus/Sonnet development agents; labels by generators,
  simulators, replays and oracles; auditor agents read, never label; human reads only where the owner names readers (O5)
units: masked surface form; two-way form × world bootstrap; ≥ 30 forms per label to gate (paraphrase ≥ 20 wordings; real ≥ 30 tasks, 300 rows)
primary_metrics: ACC, BSS, RISK (co-primary, §6.1), per port and axis, with n, units and false-fail probability at threshold
secondary: ECE (axes ≥ 500), GAP, LONG, UNK, PARA, ORDER, INJ, FLIP, INV, SLOT, EVID, HARD, PART, PAIR, forgetting battery, LAT, COST
multiplicity: Holm–Bonferroni over the 13 wave-1 ports for "k of 13"; per-port conjunction is intersection-union
size_question: §4.4 rule, prediction and simulated power table, verbatim
selection: dev-OOD only (macro NLL after calib-OOD refit; forgetting battery); test read once per frozen candidate + stock;
  no test-OOD hash in any curve, selection or calibration log
budget: laptop ≤ 40 h (5 nights) with the §7.4 priority order and reduced plan; hosted set by the 50-call pilot (O2); pause above $500
kill_rules:
  - no wave-1 port passes ACC on any gating OOD axis at 20K → stop; record the negative result in docs/RESEARCH.md
  - forgetting battery item 1 fails at any size → halve lr, replay 6,000; if it persists, stop
  - INJ target-flip upper bound > 10% on ≥ 3 ports → injection-hardening data round before any promotion
  - a planted-shortcut control passes, or an acceptance test fails after the freeze → the build is invalid; no claims from it
analysis_script: experiments/kev-data/analyze.mjs  sha256: <...>
exclusions: records dropped by budget, dedup, tap ambiguity, decidability or reserved-world checks are counted per port and reported
```

---

## 10. Build plan

The machine-readable plan for the worker fan-out is
[JUDGE-BUILD-PLAN.json](JUDGE-BUILD-PLAN.json): one object per build group with its ports,
beds, main file, acceptance tests, estimated rows and dependencies. Its `estimatedRecords` are
**rows** (state-question pairs) for wave 1 at the 20K curve point; `train` sums to 20,000 over the
groups, `calib` (calib-in + calib-OOD) to about 11,000, `dev` (dev-select + dev-OOD) to about
10,800, `testIn` to 6,500 and `testOOD` to about 42,000. Wave-2 smoke sets are named in each group's
scope.

**DAG** [crit G13]:
1. `contracts-lib` first (all 42 contracts, `lib/*`, interface stub, export, per-group test
   harness). It is the only critical-path group and is kept small: no pools.
2. In parallel against the frozen interface: `heldout-author`, `train-pools`, the eight bed groups
   (`records`, `incident`, `synth`, `kinetics`, `runbook`, `interactive`, `failures-code`,
   `construction-crossfamily`), `served-scorer-jobs`, `wiring-provider-router`,
   `wiring-judge-node`, `wiring-ledger`, `wiring-builder`, `hosted-arms` (pilot only).
3. Then `shortcut-audit` (probe-hard shares, partial-input battery, decidability audit) with a
   top-up loop back to `heldout-author` and the bed groups; `realtrace-x8` (after O1 and the
   pilot); `assembly` (one named assembler for each cross-bed port: X1, X2, X4, X5, X7, X8).
4. Then `baselines-local`, `analysis` and the hosted arms proper; `e2e-harness` after the first
   curve point.

**Common acceptance for every data group** (in addition to its own list): rows per port at target,
train label balance within 1:3 and within entity where declared, the decidability audit (§2.7),
real-token fit of every record (§2.3 rule 6), a second-code-path label agreement ≥ 99.5% on 200
records, tap alignment ≥ 95% on 200 worlds, the span-skeleton and reserved-world scans, determinism
across two runs, generation time logged, and a test file that runs alone with `node --test` and
fails on a seeded defect.

**Global acceptance** (`node --test experiments/kev-data/`), before a build can freeze:
1. **Labels:** second code path (R1: the world's reference parse of a day-≤12 date matches only
   the labelled order; I2: tag and service agree; X8: the bed's near-miss transformation
   reproduces the wrong value); the decidability audit per port.
2. **Leakage:** forbidden exact key names; no unrendered ids; no held-out wording, template, line,
   family span or entity in train, calib-in or dev-select, and no cross-slice leaks; the
   partial-input battery within majority + 3 pp; a planted perspTpl-3 sentence in an R1 training
   record fails the build.
3. **Split hygiene:** disjoint seeds and slices; no `stateHash` overlap between train and any
   evaluation set; reserved worlds absent from train and calib (a planted `records:dev:d3:s101`
   fails).
4. **Size, balance and units:** counts, label and position distributions, real-token p50/p90/max
   per port, distinct forms per label per axis (axes under 30 marked diagnostic), worlds, questions
   per state. Shortfalls are reported, not padded.
5. **Determinism:** two builds on different nights are byte-identical; a bed edit between them is
   refused; a file added under `beds/sealed/` changes nothing and is never opened.
6. **Kev format:** every line passes `kev.data.load_records`, `materialize` and `fits()` at the job's
   `maxState` in `/opt/kev-venv` (`python -I`, CPU, no training); files routed to
   `kev.benchmark --data` fit 384 tokens entirely.
7. **Bridge contract:** every J-spec passes the bridge's `validateParams` and `buildCommand`
   (imported read-only) and the real `kev.train` / `kev.benchmark` argparse, in a test under
   `experiments/kev-data/test/` (not in `bridge/`, which other agents own) [crit G17].

---

## 11. Risks, unknowns and owner decisions

- **Generator templates still bound the evidence.** In-family numbers are recall. The gating axes
  are authored lines, skeleton buckets, wordings, families and the real reserve; their quality
  rests on the probe-hard quota, the two-model filter and the decidability audit, which reduce but
  do not remove the risk that authored pools encode both authoring models' readings.
- **Power.** Per-port curve verdicts will often be indeterminate (§4.4); per-port promotion needs
  ≥ 30 forms per label on every gating axis, and some family axes will be diagnostic (X5 kinetics
  has two assumption kinds; X3 runbook `retract` is d5 only). "No power" is reported as such.
- **Throughput and memory.** Unmeasured on Foundry-shaped rows until J0; a 15× spread between
  plausible rates (§7.4). If 8K rows do not fit, long variants train and are read at ≤ 4K.
- **Served evaluation throughput.** Unmeasured until J0c; the final read may take 2–7 h.
- **Taps** may fail on kinetics, runbook, codefix or synth values; then X3, S2 and the K, Q6, X6
  families move a wave (§2.6).
- **Bed drift.** Other agents are editing `beds/`; the frozen copy and the pin make a build
  reproducible, but a bed fix after the freeze means a new build and a new pre-registration.
- **Runtime drift.** F1's exec-injected family runs on a frozen copy of `src/`; its states may
  differ from the live runtime's journal format by the time W1 lands.
- **Wrong reuse needs Phase 5.** §8.3's X5 check is a preview; the claim needs T3.

**Owner decisions** (none blocks the data build or J0):

| Id | Decision | Default if unanswered |
|---|---|---|
| O1 | weak-model id | **resolved 2026-10-07: Haiku 5.5** (`claude-haiku-5-5`); Haiku 4.5 is reference only |
| O2 | hosted budget after the pilot (estimate $150–450) | **resolved 2026-10-07 by the orchestrator under the owner's budget envelope and "Full speed" usage choice**: proceed if the 50-call pilot projects ≤ $450 for wave 1 (with Haiku 5.5 at a tenth of Haiku 4.5's price the weak-model arms shrink accordingly); a projection over $500 pauses for the owner (ROADMAP §6) |
| O3 | install `flash-linear-attention` 0.5.2 (and `causal-conv1d`) on the laptop | torch DeltaNet path, logged |
| O4 | policy entries for Kev runs (`systemone` provider, weight hashes, imputed cost) | W5 writes a proposal only |
| O5 | annotators: the owner's 20-row reads for X5, Q4, F1; C1-real and C3–C6 hand labels | auditor agents only; C1-real and C3–C6 stay out |
| O6 | one cloud read of stock Kev-4B on three ports' OOD axes | not run; weak model and Sonnet are the only ceiling arms |
| O7 | laptop availability for about 5 nights, WSL memory cap, apps closed during training | the §7.4 priority order cuts from the bottom |

---

## Appendix A. Measured in the revision-1 session

- **Template capacity of records notes.** `buildWorld` for dev seeds 1–300 × d3–d5: 900 worlds,
  61 ms per world, 44 order-template combinations, 288 flag combinations, 16 flag template ids,
  220 mirror/reliable combinations, 32 perspective combinations, 379–838 distinct paragraphs per
  system.
- **Pool sizes** from bed exports: incident `INJECT` 4, `MISLEAD` 4, `FAULT_CLASSES` 9; kinetics
  `INJECTIONS` 5; gridquest `INJECTIONS` 6, `TRUE_CUES` 5, `OPEN_T` 10, `REOPENED_T` 7,
  `FAKE_EXIT_T` 10; gameqa `BUG_CLASSES` 10, `TEMPLATES` 13.
- **Probe dataset state sizes** (bytes/4): applicability 294/588, codefix-fn 287/405,
  failure-class 54/73, incident-class 219/304, incident-root 236/323, injection 59/95,
  records-pair 107/157, synth-claim 207/308 (p50/max).
- **HF API** (read-only): `BAAI/bge-small-en-v1.5` `5c38ec7c…` MIT, 33,360,512 parameters;
  `sentence-transformers/all-MiniLM-L6-v2` `1110a243…` Apache-2.0; `deepset/prompt-injections`
  `4f61ecb0…` Apache-2.0, n < 1K; `jaredpalmer/kev-suites` `cc4bac80…` (no licence declared).
- **Kev v1.0 snapshot** `training_config.json`: the args in §7.2 and `base_revision dc7cdfe2…`.
- **Experiment journals**, read-only row counts: records-hand-pilot 148, distill-pilot 15,
  calibration 12, c0-smoke 4.

**Revision 2** made no new measurements of beds, models or data. It took its measured inputs from
the two reviews (tagged [M crit-S], [M crit-G]), read `policy/models.json`, `docs/THESIS.md` §7,
the ROADMAP classifier, `bridge/laptop/jobs.mjs`, `src/judgment.mjs`, `src/ports.mjs` and the
incident generator's `consequence` emission, and computed the Clopper–Pearson thresholds quoted in
§6 with `scipy.stats.beta` in `/opt/kev-venv` (`python -I`). Nothing was trained, served, sent to a
hosted model or committed; no sealed bed and no bed `test` split was generated.

---

## Review log

Status: **Fixed** (the finding's fix is adopted), **Fixed, changed** (adopted with a stated
change), **Rejected** (with the reason), **Owner** (needs an owner decision; the default is stated).

### Shortcuts review (JUDGE-CRITIQUE-shortcuts.md)

| Finding | Status | Where | Note |
|---|---|---|---|
| S1 pseudo-replicated template axis; wrong CI unit | Fixed | §0.1, §6.0, §3.3, §2.4 | form × world bootstrap; ≥ 30 forms per label to gate, else "diagnostic"; strip plots; skeleton minimum 30 (was 5); authored pools sized to ≥ 100 test forms per label |
| S2 held-out templates leak through shared states and other ports | Fixed | §2.3 rule 7, §3.3, §2.4 | span-skeleton registry over every held-out surface, checked against every port; one-sentence re-render instead of world rejection; held-out templates excluded from `train-pools` input; overlap rate per axis; planted perspTpl-3 test |
| S3 shortcuts surviving holdout (R4 format, system priors, service names, F1 history, X1 keywords) | Fixed | §1.2 R group, R1, R2, R3, R4, I1, X1; §2.5 | counterfactual balancing within (port, system); R4 date-window decoupling; R1 `ymd`; neutral service handles (chosen over name balancing: handles remove the prior at serving too); X1 addressee-word balance and ≥ 120 benign forms; partial-input battery ≤ majority + 3 pp |
| S4 calibration on near-memorised data; prior shift | Fixed, changed | §3.1, §7.5, §2.3 rule 9 | calib-OOD slice; vector scaling (T + per-option biases) kept only if OOF NLL improves ≥ 1%; enriched calib with importance weights; served path. **Rejected part:** "a third template index per pool" for calib-OOD; the bed pools are too small (R3 has 4 per side, R4 5 per pool); calib-OOD uses authored lines and wordings instead |
| S5 unknowables by deletion teach template detection | Fixed | §2.5, §1.2 R1, X5; UNK in §6.2 | presence-matched unknowables; both arms from both phrasings; 2 × 2 report; X5 ≥ 50% presence-matched, absent-system ≤ 10% reported apart; probe separation ≤ 0.65 acceptance |
| S6 curve selects on test; sufficiency rule underpowered | Fixed, changed | §4.4, §3.1, §7.3 | curve and selection on dev-OOD; test-OOD hash guard; two seeds at 5K and 20K; equivalence margins 3 pp per port, 2 pp pooled; named indeterminate outcome; simulated power before J2. **Changed:** dev-OOD is 600 rows over ≥ 120 forms per port (X5 1,000), not 2,000 over 200, because each point already reads 17,800 rows on the laptop; per-port verdicts may be indeterminate and the pooled verdict (~1,500 forms) carries the answer |
| S7 real-trace axes too small, inside train seeds, LLM-labelled | Fixed | §3.5, §1.2 X8 and F1, §8.1 | availability rule (≥ 30 tasks, 300 rows); F1's 9 LLM-labelled items dropped (not relabelled: their replay inputs are not journaled); X8 real rebuilt on 120 reserved worlds; F1 not promotable in wave 1 |
| S8 F1 state carries post-decision information | Fixed | §1.0 field provenance, §1.2 F1, §2.3 rule 2 | provenance table per port; F1 `prior_runs` replaces `history`; `prior_runs`-only within 10 pp of majority |
| S9 no test shows why the model is right | Fixed | §6.3, §2.5, §1.2 R group | FLIP, INV, SLOT (≥ 20% slot rows in train), EVID, HARD, PART with planted-shortcut controls; 40 wordings per port |
| S10 decidability not audited | Fixed | §2.7, §1.2 S2, I2, X8, Q4, R1 | state-only solvers ≥ 99.5%; collisions < 1%; allowed knowledge; label semantics (S2 press releases redescribed, I2 echo/consequence excluded, X8 day ≤ 12, Q4 same room name); blind read |
| S11 base rates make gates gameable | Fixed | §6.1, §5, §1.0 | balanced accuracy and Brier skill score co-primary; risk only at the deployment rate; prior and partial-input baselines in "best baseline"; constant-answer acceptance test |
| S12 forgetting check misses likely failures | Fixed | §6.4, §3.6 | six-item battery with one-sided bounds; hard-v1 mandatory; transfer-v9 unknowables; permute; option-name drift; canary set; over-trained control |
| S13 OOD pools filtered toward easy lines; wrong leakage distance | Fixed | §2.4 | probe-hard quota ≥ 40% per slice; leakage by probe and rule; reject log; strata reported; 4-gram filter kept only as a copy filter |
| S14 small-axis gates fail correct models and pass bad ones | Fixed | §6.0–§6.3 | point or bound for every gate; ECE only at ≥ 500; UNK n ≥ 300, INJ 400 pairs with stated pass counts; false-fail probabilities in the pre-registration |
| S15 length-only check inverted and weak | Fixed | §5 item 2, PART | replaced by the partial-input battery on every axis |
| S16 label-position balance | Fixed | §2.3 rule 4 | per-file position histogram within ±5 pp; accuracy by position |
| S17 paired and multi-question items dependent | Fixed | §6.0, §2.3 rule 5, §1.2 X5 | clustered by state; pair accuracy for X5; PAIR |
| S18 hard-negative pools are small fixed lists | Fixed | §1.2 X1, §2.3 rule 10, §2.4 | ≥ 120 benign and ≥ 40 decoy forms; target counted in distinct forms |
| crit-S §3 power table per port | Fixed | §6.0, §9 | unit counts printed next to every axis; MDE in the pre-registration |
| crit-S §4 decidability audit (7 steps) | Fixed | §2.7 | all seven steps, plus a class-support table from crit G9; the human read of C4 ports is owner decision O5 |

### Coverage review (JUDGE-CRITIQUE-coverage.md)

| Finding | Status | Where | Note |
|---|---|---|---|
| G1 evaluation path rejects states over 384 tokens | Fixed | §7.5, §7.4, §10 test 6 | served scorer for every file with a longer state; `kev.benchmark --data` only for files fitting 384; any report with rejected records invalid. The bridge job kind is an optional request, not a dependency (`bridge/` is other agents') |
| G2 bytes/4 budgets | Fixed | §1.0, §1.1, §2.3 rule 6 | exact tokenizer is the only gate; real-token table; `fits()` on every record; whole-log and all-documents variants dropped |
| G3 training time rests on an unverified number | Fixed | §4.1, §7.4 | smoke metrics requested; J0 two-parameter fit with step caps; schedule in forward tokens; none-pair inflation; recomputed budget |
| G4 host RAM, kernels, weights dtype | Fixed / Owner | §7.4, §7.2 | RSS, VRAM, free RAM and disk in J0; `kev.serve` stopped before training; `row_budget` and `length_sort` for > 2K; bf16 weights only for the long probe; `fla` is O3; WSL cap is O7 |
| G5 calibration on a different path; serving plan wrong | Fixed | §7.5, §7.6 | calibration on served probabilities (the alternative, pinning `KEV_DTYPE=fp32` in the operator config, was not chosen: what serves is what is calibrated); T = 1.0 after a delta answered; one service at a time; `bridgeFetch`; ledger fields |
| G6 no build group delivers wiring; C4 e2e has no owner | Fixed | §8.2–§8.4, §10 | group W (W0–W8) as build groups; X8 ≥ 100 tasks per arm; X5 ≥ 150 non-matching tasks; unknown-port rule; onUnavailable |
| G7 C4 ports do not match the THESIS | Fixed | §1.2 F1, X5 | THESIS taxonomy adopted (no amendment); `model_output` and `budget` pre-routed by code; bedtype family in wave 1; C9 stays a comparison arm |
| G8 reserved worlds; five-world real set | Fixed | §2.3 rule 8, §3.1, §3.5 | reserved-world registry with planted-seed test; availability rule; 120 reserved real worlds |
| G9 I2 tags, determinacy, class support | Fixed | §1.2 I2, §2.7 | explicit 24-tag table (renew, stray unrelated; echo, consequence excluded); collisions < 1% for every port; class-support table |
| G10 selection reads in-family data | Fixed | §7.3, §3.1 | dev-OOD selection slice |
| G11 sufficiency and 40K rules have no power | Fixed, changed | §4.4, §4.3 | named indeterminate outcome; two seeds; X5 calib and test ≥ 1,000; simulated rule outcomes; margin widened to 3 pp per port instead of n ≥ 1,000 per port (laptop read budget) |
| G12 held-out pools, bed pin, internals unprotected | Fixed | §2.1, §2.4 | heldout in `.foundry/`, hashes only; allow-list pin over `git ls-files`; frozen copy; functions not lines |
| G13 groups not independent; acceptance global | Fixed | §10, JSON | explicit DAG; small critical path; per-group acceptance; S2 tap contingency; one assembler per cross-bed port; F1 on a frozen runtime |
| G14 baselines slower and less fair | Fixed, changed | §5 | honest CPU budget and cache; chunk-and-max-pool; option scoring. **Changed:** local-logit runs on 100 dev-OOD items per port as a diagnostic, not as a full arm, because CPU inference at 2–26 s per item would take 2–28 h; stock Kev on the same backbone is the full-size comparator |
| G15 hosted arms priced from an unsupported number | Fixed / Owner | §5, §11 | 50-call pilot first; journaled floor and median used; cloud wall clock scheduled; budget is O2; weak-model id is O1 |
| G16 gridquest lifetime cap | Fixed | §1.2 Q1 | `lifetimeActions: Infinity`, logged; second path via `_internal.world`; 200-room agreement |
| G17 acceptance wording and job-spec details | Fixed | §7.4, §2.2, §10 test 7 | absence of "dropped"; request count; `runs/<jobId>`; `_meta.source`; suite prefetch in J0; free disk; contract test outside `bridge/` |
| G18 licences and acquisitions | Fixed | §3.6, §10 (`assembly`) | manifest entries for kev-suites (licence undeclared; replay only), the Kev snapshot, deepset, the Qwen base, bge-small and MiniLM, validated with `research/acquire.mjs` |
| G19 augmentation puts out-of-contract options in training | Fixed | §7.2, §7.3 | stated; kept; grid config `np0` measures it on catch-all ports |
| G20 id collisions | Fixed | §1.0 namespaces | `D:` for decisions, "claim C4", word names for groups, [crit …] for findings |
| G21 port count | Fixed | §1.1 | 42 with S5 |
| G22 `TYPE_LABELS` count | Fixed | §1.2 S group | 7 kinds, 22 mixed labels plus 7 plain |
| G23 forbidden keys vs descriptive keys | Fixed | §2.3 rule 2 | exact key names; descriptive keys tested by the metadata-only baseline |
| G24 annotators unnamed | Owner | §1.2 C1, C3–C6; O5 | out of the plan until named |
| G25 wave-2 data untested | Fixed, changed | §7.4 item 5, §10 | wave-2 ports get the decidability audit, a stock read on dev-select (100 per port) and one combined 4K-row smoke fine-tune, not one per group (laptop budget) |
| G26 batch id not injective | Fixed | §1.2 X8 | labels from the task key |
| G27 closed-label exclusions; unknown ports | Fixed | §1.2 S5, §1.0, §1.4 | wave-3 S5 for unseen type names; "no contract → hosted, never Kev-gated" |
| G28 model size untested | Owner | §5, O6 | default: no Kev-4B read; weak model and Sonnet are the only ceiling arms, stated in the report |
| crit-G §2.1 freeze deferred THESIS port contracts | Fixed | §1.3 | ledger-only contracts L1–L3 |
| crit-G §2.9 Brier and coverage co-primary | Fixed | §6.1, §8.1 | ACC, BSS, RISK |
| crit-G §2.9 evidence ladder T1–T3 | Fixed | §8.5 | adopted, with W8 maturity bookkeeping |
| crit-G §3 recommended order | Fixed | §7.4 priority, §10 DAG | smoke metrics and J0 first; token-exact factory, determinacy and reserved-world gates before any laptop job; W in parallel |
