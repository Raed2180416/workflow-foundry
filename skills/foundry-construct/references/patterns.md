# Construction patterns, with the evidence behind each

Each pattern lists: when to use it, what to build, and its evidence level. The levels are **sealed**, **held-out**,
**dev** and **design**. Prefer the strongest pattern that fits. Paths are repository-relative.

## P1. Compile a specified procedure into code once, then run it many times
- **When:** the task follows a written procedure (an SOP, a runbook, a policy) over many similar items.
- **Build:**
  - write the procedure as `code`/`task` nodes from the procedure text, the tool specs and a few worked rows;
  - repair it on development rows until none fail;
  - freeze it, and keep a model node only for irreducible judgment.
- **Evidence (sealed):** build-once workflows reached 87.6% [85.6, 89.5] reliability over three runs on 1,693 sealed
  rows, against 67.1% for a cheap agent acting per row. Amortised cost was about 1/3 of the agent's per run, and 11
  of 12 workflows made no model call at run time. The three workflows frozen with dev misses were among the six
  below 90%. `research/sopbench-20261021/RESULT-p2.md`.

## P2. Practise against an executable world before freezing
- **When:** construction by a cheap model; any non-trivial procedure.
- **Build:** run candidates against a practice world or recorded cases with an oracle, feed the failures back, and
  freeze the version that passes.
- **Evidence (dev):**
  - a cheap builder with a practice loop scored 14/14, against 5/14 for a frontier model building in one shot;
  - a template-based builder scored 18/21, against 5/21.

  Sources: `research/REQUIREMENTS-COVERAGE-20261021.md` row A3 and `research/surface-20261021/BUILDER-1.md`.

## P3. Validate effects against the host's contract before committing
- **When:** any workflow that writes to systems with rules: approvals, limits, state machines.
- **Build:** a validator step that returns the host's refusals before the effect is applied. Apply only what passes.
- **Evidence (dev):** a cheap model with such a validator scored 14/14 on an order-handling world with a policy
  overlay. Frontier agents working freely scored 5/14 and 6/14, and almost all of their errors (17 of 18, and 13 of
  13) were one host refusal. `research/org-20261021/RESULT-OT0.md`.

## P4. Bind tools to nodes when the workflow is built
- **When:** nodes need MCP servers, skills, computer use or connections.
- **Build:** each node declares the capabilities it needs, resolved and approved at construction, with an authority
  filter before any ranking.
- **Evidence (dev, weak):** the pre-bound arm was not beaten by runtime acquisition (8/12 against 6/12). The review
  traced part of the gap to broker defects, which have since been fixed. Branch `worktree-wf_c56a08f8-048-15`.

## P5. Extract with code first
- **When:** pulling fields, requirements or facts out of documents.
- **Build:** structure, section and cue rules in code. Add a model only for the residue, and measure it against the
  code-only baseline.
- **Evidence (dev):** on 83 gold requirements, section-plus-cue rules with no model found 80 [0.898, 0.993]. A cheap
  model did not beat the plain regex baseline (68–70 against 62, not significant). A paid gleaning pass raised
  precision, not recall. Branch `worktree-wf_bba577b8-b58-1`, `research/blockers-20261021/MOVE0-CERTIFY.md`.

## P6. Route "does this need a workflow?" with a cheap model, not keyword rules
- **When:** deciding the mode: none, checklist, workflow or recurring.
- **Build:** ask a cheap model with a short rubric. Use code features only as a free pre-filter.
- **Evidence (dev, labels written by us):** on a held-out split of 193 requests:

  | Router | False triggers | Recall | Cost per decision |
  |---|---|---|---|
  | Keyword/feature rules | 9/132 | 0.67 | — |
  | Asking Haiku directly | 5/132 | 0.97 | $0.00026 |

  Rules break on other people's phrasing. Branch `worktree-wf_0f86d12b-ab5-1`. See `need.md`.

## P7. Heal by a verified patch, not by retry
- **When:** an applied workflow fails repeatedly on a recurring case.
- **Build:**
  - classify the failure;
  - patch the workflow;
  - replay the recorded failing cases plus a regression set;
  - accept only if a contract check, not the patcher, passes them.
- **Evidence (dev):** one cheap session per program removed 75.2% of recurring failing cases with 0 regressions,
  for $1.14. Retry fixed 0% and regeneration about 6%. Branch `worktree-wf_0f86d12b-ab5-2`. See `heal-reuse.md`.

## P8. Reuse only after checking against the new program's own history
- **When:** a proven workflow is offered to a different program.
- **Build:** run it on the new program's labelled history first, and accept it for input types where it was right.
- **Evidence (dev):**

  | Gate | Result |
  |---|---|
  | Comparing new inputs with the original profile | Worse than rebuilding: 85% against 98%, with 32 of 112 accepted items wrong |
  | History check, post hoc | 0 wrong in 91 accepted |
  | History check, preregistered | 0 wrong in 98 accepted |

  Branch `worktree-wf_0f86d12b-ab5-3`.

## P9. Partition, ledger, second reader for large jobs
- **When:** more than about 50 units, or more than one context.
- **Build:** see `scale.md`.
- **Evidence:** public results (MAST; evidence-carrying termination; recursive LMs), plus **design** here.

## P10. Make effects exactly-once at composition boundaries
- **When:** a workflow calls another, or an effect may be retried after a crash.
- **Build:** idempotency keys per effect, reconcile an unknown outcome before any retry, and use a single writer.
- **Evidence (dev):**
  - a crash right after an effect collapsed 1 of 6 composed builds;
  - a same-instant duplicate made only composed builds commit an effect twice.

  Source: `research/composition-20261021/RESULT-COMP1.md`. The exactly-once runtime is on branch
  `worktree-wf_bba577b8-b58-3`.

## What frontier systems add
- **Explicit effort scaling** (Anthropic multi-agent research system, 2025): simple lookups get 1 agent and 3–10
  calls; comparisons get 2–4 subagents; complex research gets 10 or more with divided responsibilities. Token spend
  explained most of the performance variance, so spend where the measured difficulty is.
- **Curated beats self-written** (SkillsBench, arXiv 2602.12670): curated skills added about +16 points, while
  self-written ones were neutral to harmful. Do not let the executing model write its own procedure notes in place
  of practice against an oracle.
