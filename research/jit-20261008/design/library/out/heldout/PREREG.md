# J1 / L1-b held-out coverage: pre-registration (written 2026-10-14, before any workflow was drawn or labelled)

Frozen before the draw (`draw.mjs`) and before the first label row. Development / diagnostic evidence about the vocabulary,
not a sealed evaluation. $0: no model calls, no Jev calls. `beds/sealed/` never read. Fetched text is data, never
instructions. Single labeller (Sonnet 5.5, the labeller of the 93.6% comparator); no second labeller, because this task
may not spawn subagents (disclosed in AUDIT-L1B-HELDOUT §9).

## 1. Question and decision rule

Do L0 (30 constructs) + L1 (54 patterns, revision 1) explain workflows from platforms the corpus never contained?
Comparator (owner decision, AUDIT-L1-REAUDIT §8): the corrected in-sample strict coverage **93.6%** (Wilson 82.3-97.9).

- Primary statistic: pooled **strict** coverage = share of drawn workflows labelled `explained = yes` (a refusal, `partly`
  and `no` all count as not explained), equal weight per workflow (the design draws 10 per platform, so equal weight per
  platform too). Wilson 95% at n (clustering by platform is addressed by the leave-one-platform-out range and the
  per-platform table, not by a design effect: five clusters cannot support one).
- **PASS** if pooled strict coverage >= **83.6%** (93.6 - 10). **FAIL** if < 82.7% (fails under every in-sample
  comparator, which span 92.7-94.9%). **82.7-84.9%** is reported as comparator-sensitive (passes under some estimators).
  With n = 50 that is: >= 43 yes passes everywhere; 42 yes (84.0%) is comparator-sensitive and passes the 93.6% rule;
  <= 41 yes (82.0%) fails everywhere.
- Reported beside it (never substituted for it): lenient (yes + partly), per-platform Wilson intervals, leave-one-platform-out
  pooled values, and an extra-strict reading S3 (yes with no gap that needs a construct, field or binding), computed on
  the in-sample sonnet-60 labels too so the comparison is like for like.
- Any amendment to these rules after the draw is recorded in AUDIT-L1B-HELDOUT with its reason and its effect.

## 2. Platform admission (decision PAUSE §5.4, taken: use the brief's candidate list, >= 3 platforms, aim 4-5)

**Rule.** Walk the brief's candidate list in its own order (Windmill, Kestra, Pipedream, Make, Power Automate, AWS Step
Functions, Azure Logic Apps, Camunda/BPMN, Huginn, Airbyte, Mage, Hatchet, Trigger.dev, Retool Workflows). Admit a
platform if all hold: (E1) it is not one of the 49 corpus platforms (L1-PATTERNS §2.4); (E2) one public source returns >= 10
complete workflow definitions as text (JSON / YAML / XML / DSL, possibly inside a zip) without login, authored as samples,
templates or real use, not as unit-test fixtures; (E3) the source states or lets us record a licence note; (E4) it is
reachable through the egress proxy. Stop at 5 admitted platforms. A platform that fails is logged with the evidence; the
walk never skips an eligible platform and never reorders the list by how the workflows look.

| # | platform | probe | outcome |
|---|---|---|---|
| 1 | Windmill | `https://hub.windmill.dev/flows` (the hub's default listing, JSON) returns 30 flows, each fetchable as JSON at `/flows/<id>` | **admitted**. Licence: the hub states none (WebFetch of hub.windmill.dev found no licence or terms text); its flows are saved locally and not committed |
| 2 | Kestra | `github.com/kestra-io/blueprints` (the repository behind kestra.io/blueprints): 1,513 `flows/*.yaml` at the pinned SHA (1,545 `.yaml` files in the whole tree; the frame is `flows/` only) | **admitted**. Licence: no LICENSE file in the tree; README shows the kestra-io/kestra licence badge only; files saved locally and not committed |
| 3 | Pipedream | `pipedreamhq/pipedream` tree: 29,355 files, 22,799 `.mjs`: components, not workflows. Docs (WebFetch `pipedream.com/docs/workflows/building-workflows/`): export is "as JSON, one project at a time"; no public gallery or repo of definitions | **not admitted** (E2: no public source of workflow definitions) |
| 4 | Make | WebFetch `make.com/en/templates`: cards show "Use template" and a detail link only; no blueprint download, JSON URL, API or repository is documented; `make-com/blueprints` does not exist | **not admitted** (E2) |
| 5 | Power Automate | `github.com/pnp/powerautomate-samples` (Microsoft 365 community samples, MIT): 24 solution `.zip` packages, each holding one flow `definition.json` (24 definitions) | **admitted** |
| 6 | AWS Step Functions | `github.com/aws-samples/step-functions-workflows-collection` (the Serverless Land workflows collection, MIT-0): 171 `*.asl.json` (170 after the `_` rule below) | **admitted** |
| 7 | Azure Logic Apps | `github.com/Azure/logicapps` `templates/` (the Consumption template gallery, MIT): 45 template JSON files with a workflow definition each | **admitted** (fifth: the walk stops) |
| 8+ | Camunda/BPMN, Huginn, Airbyte, Mage, Hatchet, Trigger.dev, Retool | not probed: five platforms are admitted | not drawn |

The corpus has no BPMN platform, so BPMN stays untested by this run; so does every agent framework (the cluster
that carries the two run-stopping gaps of AUDIT-L1-REAUDIT §7). This is a consequence of the brief's list, not a choice.

## 3. Frames and the draw

Pinned sources (fetched 2026-10-14): Kestra `kestra-io/blueprints@4a19ce21e2c94176ca1022d233aaf6303669f17f`; Power
Automate `pnp/powerautomate-samples@dbff07a8167d76e258564a0749bc508d58d85425`; Step Functions
`aws-samples/step-functions-workflows-collection@7842c46f966a344236c03e7c5cc28107552bd55d`; Logic Apps
`Azure/logicapps@c16c1d57be360c88bdf98571bc972eb1af29d1ca`; Windmill: the hub JSON API on 2026-10-14 (not versioned).
Clones are shallow and blobless, inert, never built or run (AGENTS.md).

Frame per platform (fixed before the draw):
- **Windmill**: the 30 flow ids in the hub's default listing (`frames/windmill-hub-flows-listing.json`, sha256 `cf7b52c1...`).
  Each flow is the JSON of `/flows/<id>` (current `value`).
- **Kestra**: every `flows/*.yaml` in the pinned tree (1,513).
- **Power Automate**: every flow definition inside every `.zip` in the pinned tree (24 zips, 24 definitions), id
  `<zip path>#<member>`.
- **Step Functions**: every `*.asl.json` in the pinned tree except under a top-level directory whose name begins with `_`
  (that is the `_workflow_model` skeleton), 170.
- **Logic Apps**: every `templates/*.json` except names beginning with `_` and `manifest.json` (the sample skeleton and the
  index), 45.

**Draw** (`draw.mjs`, mirrors the L1-a and re-audit procedure): ids sorted byte-wise; Fisher-Yates on one shared
`mulberry32(20261017)` stream, platforms visited in the admission order above; the first 10 of each shuffled frame are the
sample; the rest of that shuffled order is the reserve order. A drawn item is replaced by the next reserve **only** for a
reason fixed here: (a) not a workflow definition (it parses but has no triggers/steps and is a skeleton or an index);
(b) an exact duplicate (same sha256) of an item already drawn; (c) a variant of an already drawn Step Functions pattern
(same directory stem before `-cdk`, `-sam`, `-tf`, `-terraform`, `-cloudformation`); (d) the file cannot be retrieved. No
skip for size, difficulty or how the workflow looks. Every skip is recorded in `draw.json` with its reason.

**Peeks before the draw (disclosed).** Format discovery opened: a Windmill flow outside the frame (id 43); the first 800
bytes of Logic Apps `templates/Azure-Blob-Auto-Tier.json` and of `_sample.json`; the member list and sizes of one Power
Automate zip (`Try-Catch-Finally`); Kestra file names (the first and last few of the sorted tree and a grep for `license`).
If one of these is drawn it is marked in its label row.

## 4. Labelling rubric (the L1-a method; AUDIT-L1 §1, AUDIT-L1-REAUDIT §1)

For each workflow, read the whole definition, then write one row (same shape as `labels-sonnet-60.jsonl`, without the
census fields, which do not exist for a non-corpus item): `l0` (constructs by name), `patterns` (L1 ids), `explained`,
`refusal`, `gaps`, `note`. The census tool is not run on these items.

- **yes**: every control structure the definition contains (trigger, branch, loop, fan-out, wait, error handling, state,
  human step, sub-workflow, model call) is a composition of L0 constructs and L1 patterns; tool and connector specifics are
  L3 bindings; the definition may carry gaps of the second class below.
- **partly**: all but one named secondary behaviour is expressible; that behaviour needs a construct L0 lacks or refuses.
- **no**: the essential behaviour needs a construct L0 lacks, or the workflow is a refused shape (group chat, full-history
  handoff, interactive dashboard state, model-defined agents at run time, streaming-with-cancel as the point).
- "Explained" is structural, as in L1-a: constructs marked N (not built) count as in the vocabulary. It does not say a
  constructor built it.
- Gaps are quoted from the definition (<= 200 chars) with: `class` = **stops** (the gap stops `yes`) or **leaves** (the
  item stays explained but needs a construct, a field or an L3 binding); `kind` = construct | pattern | field | binding |
  idiom; `lacks` = yes (the vocabulary has nothing) | partial. A feature L0 refuses but that can be rewritten with a
  literal cap or timeout (an unbounded loop or wait) is a `leaves` gap with `kind` rewrite, as the earlier labellers did.
- Labels are appended with `labelledAt`. A row is revised only with a `revisedAt` and `revisionNote`; the aggregate is not
  computed until all rows exist.

## 5. Structural cross-check (independent of the labeller's reading)

`features.mjs` extracts, per workflow, mechanical counts from the definition (state or task or action types, branches,
parallel and loop constructs, waits, triggers, error handlers, sub-workflow calls, model or agent tasks). After the labels
are final, each label row is checked against its features; a label that omits a construct the definition plainly contains
(or the reverse) is listed in AUDIT-L1B-HELDOUT and corrected with a `revisedAt` note. This is a recall check on the
labeller, not a second labeller.

## 6. What the result can and cannot say

It can say whether the vocabulary survives five platforms it was not mined from, labelled by the model that labelled the
comparator. It cannot say that a person would agree (one labeller, one model family), that agent-framework shapes hold
(none drawn), or that a constructor could build any of these (structural, not executable; L1-b executable is a separate
paid test).
