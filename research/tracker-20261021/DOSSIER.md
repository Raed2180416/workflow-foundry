# Tracker (A7, task #60): research dossier and build/measurement plan, 2026-10-21

*The research phase's hand-off, committed with the build it led to ([RESULT-TRACKER.md](RESULT-TRACKER.md)). Text as handed over,
lightly reformatted. The hand-off was cut off in §8 after "T1 … gets the same condition list plus the workflow or solver and"; the
end of §8 (marked) is the build phase's completion, as preregistered in [PREREG-TRACKER.md](PREREG-TRACKER.md).*

This was a research phase only. Nothing in the repo was edited, no commit and no paid calls were made, and scratch files were deleted.
Exa returned HTTP 402 (out of credits), so the web research used WebSearch and WebFetch. Labels used below: **[obs]** is something
seen in the repo, in a run record or in npm metadata. **[doc]** is a claim from a paper or vendor documentation. **[inf]** is
inference or proposal.

## 0. Bottom line

- **Logging the user's conditions is solved and cheap. Checking them is not, and the cause is known.** In the E8 run, Haiku-written
  free-form JS properties raised 16 false-alarming requirements on a correct build, left 44 of 78 untested and scored 0.16 on mutation
  [obs]. Every false alarm came from the property writer inventing names that are not in the trace. The contrast-pair guard (G2) could
  not catch this, because the writer built both mini-traces from the same guesses.
- **Core recommendation [inf]: replace free-form properties with a closed set of about 8 check templates.** Each template is filled by
  pointing into an enumerated vocabulary: the API schemas, the registry capabilities, sheet columns, observed trace shapes, and
  literals copied from the user's words by pointer. Code owns the semantics. The model only picks a template and points, the same rule
  the repo already uses for quotes. This removes invented names by construction, and it needs no sandbox for most checks. Free-form JS
  stays as a labelled `custom` escape hatch.
- **Status semantics come from three mature fields:** declarative process mining (vacuous satisfaction), BDD (undefined/pending), and
  contract and compliance models (discharge, waiver, risk acceptance). "Unknown" must be split by reason. A condition that was never
  triggered must never read as met.
- **The second bed should be BUILDER-1** (the app's own path). It has hidden-world executable oracles, 23 controls, and 5 archived arms
  whose effects were recorded, so checks can be replayed at $0 [obs]. The no-tracker baseline already exists in that data: in B0-H,
  the build's own checks passed on 10 builds the oracle failed [obs].
- **Proposed capability number [inf]:** defective builds caught before the live run, at alarm precision ≥ 0.95 and zero false alarms on
  known-good builds, against two baselines:
  - no tracker: the builder's own acceptance checks and practice-run verdict;
  - a prose checklist: an LLM reviewer ticking the same condition list.

  Each arm also reports cost per build.

## 1. What exists, and what it taught

| Asset | State | Lesson |
|---|---|---|
| `experiments/tracker/` (trace v1, quotes-by-pointer ledger, sandbox, G1–G4, report) | Built; one paid run, $0.128 per ledger | Pass 1 (extraction) works. Pass 2 (property writing) fails on vocabulary. Re-checks cost $0. |
| `research/need-router-20261014/tracker-e8/REPORT.md` | 1 of 3 defects caught (line 162). B1-O was missed because its reserves sat only in `t.refused`. 21 false alarms on the reference runs, which turned out to be invalid known-good traces. | Checks must read refused proposals. The reference runs are not valid known-good traces; use specificity solvers s1–s3 and lineage 1. |
| Branch `worktree-wf_630f3979-599-3`, REPORT §10/§10.1 (read-only) | $0 rule "every coverage-list sentence becomes an entry" takes s0 from 23/30 to 28/30 ids. The Haiku gleaning call adds no recall. | Use the $0 rule as the extraction baseline. The model is only a precision filter, and that value is still unmeasured. S2 and S4 need unit segmentation (FIXES E1). |
| `research/need-router-20261014/N-VERSION-TRACKER.md` | K=3 majority vote: precision 1.00, recall 1.00 on 20 failures. B1N-H repair reached 1022/1022 for $1.70. | An independent oracle-free signal. Use it to validate checks and as a pointer. Do not rebuild it. |
| `experiments/autobench/harness/ledger.mjs` (A1-C) | Prose and requirement-ledger checks went wrong in both directions: 15 false acceptances, 9 false rejections (`A1C-NEARMISS-20261021.md`) | A natural prose-checklist baseline. Also motivates a "scope" template: a closed-world in/out list of entities. |
| `experiments/specbiz/ledger-review.mjs` | Derive-ledger plus owner review | Reuse the owner-review mechanics to simulate user edits. |
| `app/core/{ledger,service,explain}.mjs`, `app/mcp/server.mjs` | CAS on `rev`, `HUMAN_CHANNELS`, MCP elicitation for approval, plain-language checks; a structured `condition()` language in `src/data.mjs:73` with no quantifiers | Reuse these patterns for confirm and waive. Do not edit `src/`. |
| BUILDER-1 (`research/surface-20261021/`, eval cases, `experiments/surface/oracle.mjs`) | 24 requests, hidden worlds, 23 bad-slot controls. Records hold workflow plus `hidden.effects` {outbox, chat, appended}. | Supports a $0 replay of checks over about 100 archived builds with oracle verdicts. |

## 2. Frontier work, 2025–2026

- **Kiro (AWS) [doc].** Acceptance criteria become textual properties ("for any …"), then Hypothesis property tests. Hovering a property
  shows its link to the requirement. When a check fails, Kiro offers to fix the spec, the implementation or the test. The docs say it
  determines which requirements "can be logically tested", but do not say how untestable ones are labelled. Sources: blog 2025-11-17;
  docs updated 2026-08-04. *Take:* the traceability UX, and the three-way choice on failure (spec, build or check is wrong).
- **OpenSpec 1.14.3 (MIT, npm modified 2026-10-17) [obs/doc].** Changes are expressed as ADDED/MODIFIED/REMOVED deltas against current
  specs, and archiving merges them. GitHub Spec Kit (MIT, roughly 115–120K stars per secondary reports) has a specify → plan → tasks
  flow. Neither one checks a running build against requirements. *Take:* the delta format for version-bound condition proposals. No
  dependency.
- **nl2postcond (Endres et al., FSE 2024) [doc].** Two metrics: *test-set correctness* (the check holds on the reference implementation)
  and *bug-completeness* (share of mutants the check kills). GPT-4 reached accept@1 0.77 and completeness 0.85. *Take:* these are
  exactly our "check precision" and "teeth". Adopt the definitions.
- **Konstantinou et al. (arXiv 2410.21136) [doc].** LLM-generated oracles tend to encode actual rather than expected behaviour. Ma &
  Eisty (2607.10277, 2026-07) is a 10-bug pilot in which requirement-derived oracles align more with the requirement than with the code.
  *Take:* keep G1. Checks are written from the user's words and the vocabulary, never from the build.
- **Agentic property-based testing (Maaz, DeVoe, Hatfield-Dodds, Carlini; arXiv 2510.09907) [doc].** 56% of raw reports were valid
  bugs, and 86% of the 21 top-ranked by a rubric. *Take:* LLM-written properties produce many false alarms without a triage gate. This
  supports a precision gate before "unmet" is shown.
- **AutoIF (2406.13542) and IFBench (2507.02833, NeurIPS 2025) [doc].** LLMs write verification functions plus unit tests and filter
  them by execution. IFBench finds verifiers overfit to known constraint types. *Take:* validate checks against real executions, not
  against self-made examples.
- **CodeT (2207.10397) [doc].** "Dual agreement" between generated tests and generated solutions. *Take:* cross-validate checks against
  K diverse builds and the N-version consensus.
- **Checklist judges [doc].** TICK (2410.03608) raised LLM-to-human exact agreement from 46.4% to 52.2%. RLCF (2507.18624) combines AI
  judges with verifier programs per checklist item. Soft-SVeRL (2605.28561) finds averaging item-level judgments reduces verifier noise.
  Agent-as-a-Judge (2410.10934, DevAI with 365 requirements) reports about 90% human agreement, via a secondary summary. *Take:* this
  defines the prose-checklist baseline. It is cheap and roughly 50–90% accurate, not a verdict.
- **2026 delivery benchmarks [doc].** AgentSWE (2610.13361, 2026-10-09): failure modes are "overfitting to visible cases", "hollow
  runtimes" and unsupported completion claims. PACE (2610.26394, 2026-10-19): 750 audited code points, best complete delivery 14.0%,
  95.2% agreement with experts. TraceDev (2607.18886, ISSTA 2026): a traceability graph across requirements, design and code. *Take:*
  practice worlds are not live worlds, so checks must keep running on live runs.
- **AgentSpec (2503.18666, ICSE 2026) [doc].** Trigger, predicate and enforce rules. o1-generated rules reached 95.56% precision and
  70.96% recall on embodied tasks. *Take:* a trigger/predicate template is the right shape, and generated rules trade recall for
  precision.
- **Laban et al., "LLMs Get Lost in Multi-Turn Conversation" (2505.06120, ICLR 2026) [doc].** Performance drops 39% when an instruction
  is sharded across turns, and models commit early to assumptions. *Take:* an explicit, versioned condition ledger across turns is the
  countermeasure for "later edits".

## 3. Niche and adjacent fields

1. **Declarative process mining (Declare / LTLf) [doc].** Constraint templates (response, precedence, existence, absence) have
   activation and target semantics. *Vacuous satisfaction* (Di Ciccio, Maggi, Montali, Mendling, IS 2018) is the theory behind
   "untested is never pass". Text-to-Declare extraction has existed since van der Aa et al. 2019 (P 0.77, R 0.72), and LLM versions
   appeared in 2024–2025 (2407.18540, 2510.07161). *Take:* templates instead of free code. The tracker's kinds (`must`, `never`,
   `when-then`, `order`, `deadline`) are Declare templates already.
2. **Systems engineering verification (NASA SE Handbook; EARS from Rolls-Royce, RE'09) [doc].** Every requirement carries a
   *verification method*: Test, Analysis, Inspection or Demonstration. This is the principled form of "unverifiable, with why": the
   condition gets method = inspection by the person, not silence. EARS sentence patterns (ubiquitous, event-driven "When", state-driven
   "While", unwanted "If/then", optional "Where") give a plain-language rendering of each check that the person can read back.
3. **Contract and compliance monitoring [doc/obs].** Symboleo (SoSym 2022) obligation lifecycle has states InEffect, Fulfillment,
   Violation, Suspension and Discharge. Discharge, when an antecedent expires, is "cancelled, not unsuccessfully terminated" [obs: PDF
   text, §3]. OSCAL and FedRAMP findings are satisfied / not-satisfied, with risk acceptance recorded as a POA&M response; the exact
   enumerations were not confirmed. *Take:* waived is a recorded, attributed decision tied to a version. It re-opens when the condition or
   the build changes.
4. **BDD / Cucumber [doc].** Step statuses: success, failed, undefined (no step definition), pending, skipped, ambiguous. *Take:*
   "undefined" means a condition has no check yet, and "ambiguous" means two checks claim one condition. Both are first-class unknown
   reasons.
5. **Clinical-trial eligibility prescreening [doc].** 2023 physician-in-the-loop study: trial-level recall 1.0 and precision 0.71 with
   the physician, recall 0.5 without. 2024–25 deployment (medRxiv 2026.03.20.26348890): criterion accuracy 0.94, and 27 criteria prompts
   were updated from coordinator feedback. *Take:* the person's correction of a check is the main precision lever. Log it as a
   version-bound edit.
6. **nl2spec (CAV 2023) [doc].** The LLM maps sub-formulas back to input fragments, and the user edits those fragments. *Take:* keep
   edits at the quote-to-check level.

## 4. Adoptable OSS

Versions, licences and dates are npm metadata observed on 2026-10-21.
- **Adopt now: no new dependency.** Reuse `@modelcontextprotocol/sdk` 1.30.0 (already pinned) for the tools and elicitation,
  `node:sqlite`, and `experiments/tracker/*`.
- **Adopt later, only if scenario generation needs it: `fast-check` 4.10.2** (MIT, modified 2026-09-19). It could generate
  condition-targeted practice rows and shrink failures. Pin it exactly if added.
- **Considered, not needed (the templates replace an expression language):** `@marcbachmann/cel-js` 8.0.0 (MIT, 2026-07); `jsonata`
  2.2.2 (MIT, 2026-07); `json-logic-js` 2.0.5 (MIT, stale since 2024-07).
- **Concept-only, no code import:** OpenSpec 1.14.3 (MIT): delta format; `@cucumber/gherkin` 42.0.1 (MIT): status vocabulary; Kiro
  (proprietary): UX only; Declare4Py (licence unconfirmed; its LTLf backend needs Docker); pm4py: rejected earlier for AGPL (FIXES E2).

## 5. What to build from scratch

**Condition ledger.** Two tables in the app workspace, keyed `(flowId)`: `conditions` (id, version, rev (CAS); `source {turn, span,
quote}` copied by pointer from the request, answers or later chat; `origin` user | suggested, a suggested condition never auto-confirmed;
`confirmed`; `check`; `verification` test | inspection | unverifiable with a `why`) and `condition_results`, keyed `(conditionVersion,
workflowHash, runId)`. Edits arrive as ADDED/MODIFIED/REMOVED proposals; the person confirms them through `HUMAN_CHANNELS`. Waive needs a
human channel and a reason, and is bound to `(conditionVersion, workflowHash)`.

**Check templates.** About 8, evaluated by code over a run's effects, including refused or proposed ones: `present` and `absent`;
`count` (exactly / at most N per subject); `field` (value equals or contains a literal copied by pointer); `when-then` (trigger
predicate leads to a response, with an optional inclusive window); `order` (A before B per subject); `scope` (for each entity matching
a filter there is an effect naming it, and no effect for the others); `custom` (sandboxed JS from the existing tracker code, labelled
"unconfirmed check"). The binding call is Haiku by default, with Mercury as an arm. It returns `{template, bindings}` through an
enum-constrained schema built from the vocabulary. A $0 lint rejects any name outside the vocabulary.

**Validity gates ($0), replacing G2:** real-shape contrast (the check must activate on at least one real practice trace from any build;
a violating twin is then made by mutating that real instance, and the check must fail on the twin); a check never activated on any
build reports `unknown (not exercised)`; the G3 cross-build flag, plus disagreement with the N-version consensus, marks a check
`suspect`.

**Statuses shown to the person and the builder:** `met` (at least one decided activation and no violation; thin when n < 3); `unmet`
(only from a grounded template check, with an evidence excerpt and the three-way choice: build, check or my words are wrong);
`unknown` with a reason (not-exercised, no-check, check-suspect, unverifiable (why), or not-run); `waived` (by whom, why, which
version).

**Condition-targeted scenarios.** Boundary values at the edges of each template window, for example invoice due ±1 day, to shrink
not-exercised on the practice data. E8 keeps `generateWorld`.

**Product surface.** `FoundryApp` gains `conditions()`, `proposeConditionEdit()`, `decideCondition()` and `checkConditions()`. MCP gains
`conditions` (read) and `edit_conditions` (propose); waiving goes only through elicitation or the dashboard: the model can never
waive. The dashboard gets a "What you asked for" panel. New files plus narrow hooks in `app/core/service.mjs`, no `src/runtime.mjs`
edits.

**Not built (the over-engineering line):** no temporal-logic DSL, no LLM judge deciding status, no automatic check repair after a build
has been seen, no pattern-library auto-conditions.

## 6. Risks

1. **Precision bought by abstention.** "Unknown" can hide everything. Always report the abstention rate beside precision.
2. **Template expressiveness.** Some conditions will need `custom`. Measure the share; if it exceeds about 20%, the template set is
   wrong. [inf]
3. **Practice ≠ live** (AgentSWE). Checks must also run over every live run journal; untested on practice is not safety.
4. **Goodhart.** Once checks feed the builder they become development evidence. Grading stays with the bed oracle on disjoint worlds.
5. **In-sample beds.** BUILDER-1's author wrote the templates and the cases, and SPEC-E has been read by the gleaning prompt. A fresh
   held-out request set by a separate author is needed before any claim.
6. **Waiver authority.** The dashboard does not stop a same-OS-user agent (its own DESIGN §6 says so). A waive is only as trustworthy as
   the approval path.
7. **Unobservable conditions** (e.g. SPEC-E "reason `fraud`" has no API field) must surface as unverifiable with a reason, not as
   `untested`.
8. **Disk and CPU.** Replays are small. Run E8 worlds one at a time with `nice -n 15`.

## 7. Build plan

All in the worktree, $0 first. 1. Vocabulary extractor (E8 API schemas plus trace shapes; app registry plus sheet schemas) and the
lint. 2. Template evaluators, including refused proposals and vacuity; port the E8 probe's three properties to templates and require
the same verdicts on lineages 1 and 3 and on B1-O, B1-O now failing via refused proposals. 3. Real-shape contrast gate and suspect
flags. 4. Ledger with CAS, deltas, confirm and waive, and tests. 5. App, MCP and dashboard hooks, with a scripted-model end-to-end
test. 6. BUILDER-1 replay adapter over the archived records, and the E8 adapter (reuse `trace.mjs`). 7. Prose-checklist baseline
runner. 8. Prereg freeze, then paid runs.

## 8. Measurement plan

**Simple baselines:**
- **T0, no tracker:** the build's own acceptance checks and practice-run verdict.
- **T1, prose checklist:** a Haiku reviewer gets the same condition list plus the workflow or solver and *[hand-off ends here; the rest
  is the build phase's completion, as preregistered]* what it did on practice data (BUILDER-1: the effects and the sample data; E8: run
  health), and ticks each condition met / unmet / cannot tell. A build is flagged when any condition is unmet.

**Measures:** condition recall vs a gold list written before scoring; check precision (a check that fails must mean the condition is
unmet; adjudicated per alarm); defective builds caught before the run and false alarms on known-good builds, per arm; abstention by
reason; the share of conditions no template can express; cost per build. Development evidence only (risk 5).
