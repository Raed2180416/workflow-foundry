# ROUTER-1 gold-label rubric (written 2026-10-21, before any router code or score existed)

**What a label means.** The label says what a careful operator, following the owner's stated taxonomy, would set up
*before starting* the request: nothing, a short checklist, a workflow, or a recurring workflow. It is a **normative**
label (the owner's classification, applied by hand), not a counterfactual outcome. Whether a workflow actually raises
success or lowers cost on a task is a different question, settled only by running modes against an oracle (the label
factory in [DESIGN.md](../DESIGN.md) §2; M1 found one Haiku call solving tasks that look procedural). ROUTER-1 measures
whether a cheap router reproduces the owner's classification; it does not measure the value of the workflows.

Owner sources for the taxonomy (verbatim in `research/requirements-20261021/OWNER-MESSAGES.md`):
- [62] "the goal ... is to detect if a certain task needs a workflow or not. And testing is the biggest part"
- [74] "figure out primitives which warrant a workflow, and then create something sort of generalised formula/threshold
  ... tune it so all tasks which you pre classify as not needing a workflow never trigger a workflow, and the ones
  needing it trigger workflows"
- [75] "routine coding and shit probably doesn't need a workflow ... even heavy coding mostly won't need it, but say
  it's a proper startup coding, then initially for mvp you might not need a complex workflow but later on it might
  become necessary if ci cd ..., or say an oss product the entire cycle of reviewing, maintaing etc as needed, or say a
  research program which needs you to follow a set of rules"
- [20] "a slider to its sensitivity when it comes to recommending if it should trigger a workflow creation"

## Modes

Precedence: the first mode whose definition holds.

1. **`recurring`**: the job repeats and each run does work (applies rules, touches systems, produces artifacts):
   - an explicit schedule (daily, every Friday, monthly, each quarter, nightly, at 9 every Monday), or
   - an explicit trigger or standing duty (whenever, every time, each new X, as they come in, from now on, going
     forward, keep an eye on, monitor, keep in sync), or
   - the request names itself as one run of a repeated process ("this week's update, same format as last time",
     "the latest batch, same workflow as last time", "the monthly scan").
   A bare reminder to oneself (a timer, a repeating reminder) is not a recurring workflow: a scheduler primitive covers
   it (label `none`, medium confidence).
2. **`workflow`**: a one-off or bounded job that needs a durable, checkable process because at least one holds:
   - **W1 waits**: it spans time or waits on another party or event (approval, signature, reply, a later date, the end
     of a billing period) and acts after the wait;
   - **W2 policy over items with effects**: it applies a written policy or rulebook to a set of items and writes
     effects to two or more external systems or notifies two or more parties (a business-process instance);
   - **W3 rule-bound program**: a multi-stage program whose rules must be followed and shown to have been followed
     (preregistered evaluation, systematic review protocol, regulated procedure);
   - **W4 staged rollout**: a change applied across many units with gates between them (service-by-service deploys
     that stop on failure, a migration in waves).
3. **`checklist`**: one-off, one sitting, none of W1-W4, but with a high-stakes irreversible effect (a production
   change, a destructive deletion, a large money movement, a mass communication) where an explicit short plan and a
   verify step are warranted.
4. **`none`**: everything else. Questions, explanations, advice; analysis or transformation of material given in the
   request, however long or rule-dense; writing and editing; routine and heavy coding in a repository (local tests are
   the check); writing a config file for some other system's scheduler or CI; one-off single low-stakes effects
   (one email, one record, one meeting, one small refund).

**Binary label:** `needsWorkflow` is true exactly for `workflow` and `recurring`. `checklist` is in the no-workflow
class: the never-trigger requirement covers `none` and `checklist`.

## Edge principles (applied before the modes)

- **Mention is not use.** Explaining, comparing or writing about workflows, CI, schedules, approvals or compliance is
  `none`.
- **Hypotheticals and questions about effects** ("what happens if I delete prod?") are `none`.
- **Length and rule density alone** do not make a workflow (the need-router anchor beds: one call is the hypothesis).
- **Configure, don't run.** Writing a CI file, cron line or alert rule that another system executes is `none`
  (routine coding); owning an ongoing process with gates, approvals, waits or production effects is `recurring` or
  `workflow`, even if it will later be implemented in a CI system.
- **Periodic wording without a repetition cue.** "Close the books for September", "calculate March commissions" are
  one run of something periodic but carry no explicit repetition cue: `workflow` (mode confidence medium), not
  `recurring`.
- **Retrospective frequency words** ("what did I spend each month last year") are `none`.
- **Artifacts named after plans** ("make me a weekly meal plan", "make a checklist for onboarding") are writing: `none`.

## Confidence

`high`: one rule applies clearly. `medium`: two rules compete or the text is ambiguous; the reason is recorded in
`why`. Primary metrics use every item; a sensitivity analysis uses high-confidence items only.

## Who labelled what, and when

Every gold label in `SET.jsonl` was written by the ROUTER-1 author (Claude Opus 5.5) before the router code, its
parameters or any judge output existed (git history: the set is committed and hashed before `src/need/`). The author
also wrote the router, so the set's authored slice shares the author's phrasing: the independent-text slices
(AutomationBench public prompts, Mercury-authored requests, other agents' anchor beds, family policies and E-bed specs)
are reported separately so this bias is visible.
