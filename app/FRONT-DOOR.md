# The free-form front door

*2026-11-05. Development work on the product app (`app/`), $0: every test and the demo use scripted agents, stand-in people and
stand-in outside actions; no model was called. Nothing here is evaluation evidence about how well a model builds.*

## What changed and why

Until now the product path (the onboarding site, the dashboard and the app's MCP server) could only build what seven hand-written
examples could do (`app/core/templates/*.json`, filled in by a form or by the template builder). The owner's ask (2026-11-04): an
agent should be able to build whatever the person needs, with skill packs giving it patterns and taste, not a menu of templates. The
evidence agreed: the examples bind 0 of 33 real corpus items, and the cheapest good builder is one shot plus one practice run
([RESULT-CI1](../research/ci1-20261021/RESULT-CI1.md) §0/§11).

So the app has one front door for any request:

- **An agent-built workflow.** `propose_flow` takes the person's exact words and a typed workflow the calling agent built from
  `construction_guide`, with `practiceInput` cases. `FoundryApp.propose({ request, answers, workflow, practiceInput })` checks it
  (`app/core/freeform.mjs`) and proposes it, or refuses with named blockers.
- **Words only.** Foundry's own builder tries. With `--builder freeform` that is the free-form builder
  (`app/core/builder-freeform.mjs`): one typed ModelPort call that writes a whole workflow from the construction skill's core, the IR
  reference and the capability catalogue, then the same checks and one practice run, then at most 2 bounded repairs with the check
  output, under token and dollar caps; the model id comes only from `policy/models.json` (claude-haiku-5-5). The $0 stub stays the
  default. Whatever a builder returns is checked again by FoundryApp: a builder is never the last word.
- **The seven examples** are now worked examples in `skills/foundry-construct/exemplars/app/` (generated from the frozen cards by
  `tools/skillpack/gen-exemplars.mjs`, practice cases beside them; each one passes the front door). The cards themselves stay where
  the BUILDER-1 and CI-1 manifests freeze them, and the site's gallery still fills them in by form; it now presents them as examples
  you can start from, not as everything Foundry can make.

## The gates (all kept, none flattened)

| Gate | Where | What it does |
|---|---|---|
| Capabilities | `freeform.mjs` | Every tool a step or check names must be in the app registry and offered to automations. A missing one is `MISSING_CAPABILITY`, naming the capability and the step that needs it; nothing is substituted. The engine's diagnostic fixtures are not offered. |
| Semantics the app can run | `freeform.mjs` | No `agent` nodes or agent verifies (the app wires no model into a person's runs): `MODEL_STEP_UNAVAILABLE`. No waits on a signal (nothing can deliver one): `SIGNAL_WAIT_UNSUPPORTED`. Timers (`delayMs`, `at`), human questions, maps, loops and code are fine. |
| Outside-effect targets | `freeform.mjs` | Every recipient (`outbox.send.to`), channel (`chat.post.channel`) and sheet (`sheet.append.sheet`) is a literal the person wrote (request or answers) or comes from the person's data. A target from the run input, or an address-shaped run-input field, is `TARGET_FROM_RUN_INPUT`. Every e-mail address anywhere in the workflow, code included, must be in the person's words (`UNGROUNDED_TARGET`). |
| Independent checks | `freeform.mjs` | Each kind of outside effect needs a gating verify that re-reads what the run left (`outbox.audit`/`outbox.check`, `chat.audit`, `sheet.audit`): `EFFECT_UNCHECKED`. |
| Strict validation and lint | `freeform.mjs` | `foundry.validate(workflow, { strict: true })`: schema, dataflow, capability schemas and the construction lint; acceptance grade must be `gating`. `INVALID_WORKFLOW`, `LINT_FAILED`, `ACCEPTANCE_NOT_GATING`. |
| Identity and versions | `service.mjs` | No `template:`/`slots:` tags (`RESERVED_TAGS`); a change to a flow is version head + 1 (`VERSION_CONFLICT`); apply is compare-and-swap on the head, as before. |
| Practice of the exact version | `freeform-practice.mjs` | Every case runs in a fresh practice world with the practice registry (every outside effect against its stand-in). No cases: a schema-valid input is made by code ($0). Human steps get the case's answers or answers made from the answer schema, and each stand-in answer is reported. A timer due within 3 s is waited out; a longer one stops practice with `PRACTICE_TIMER`. A sheet the workflow reads needs practice rows (`PRACTICE_DATA_MISSING`). The would-do list carries each action's effect digest and a list digest. |
| The person's yes | `service.mjs`, `mcp/server.mjs` | `requestApproval` needs a passing practice run of the SAME hash; the decision comes only from a human channel (page, CLI, or the client's dialog under the H3 check). The turn-on dialog shows the practice would-do list. |
| Each outside action | engine, `human-tasks.mjs`, `onboarding/batch.mjs` | Live sends and posts pause for the person (`list_waiting` / `answer_waiting`, the page). With the site, a free-form automation's run first makes the exact list (a practice-registry run of the turned-on version on the person's live sheets), and the person's one yes applies only to paused actions whose full arguments match an item of that list by digest; an automation that asks or waits while it runs goes action by action (`BATCH_INTERACTIVE`). |

Every refusal is `status: 'refused'` with `blockers: [{ code, what, next, ... }]` and a plain `reply`; nothing is created.

## The MCP tool list (13)

`construction_guide` (new, read-only), `propose_flow` (now `request`, `answers`, `flowId`, `workflow`, `practiceInput`; no more
`template`/`settings`), `explain_flow` (now also the input schema), `dry_run`, `ask_person_to_turn_on`, `run_flow`, `flow_status`,
`list_flows`, `need_check`, `list_waiting`, `answer_waiting`, `conditions`, `edit_conditions`. `list_templates` is gone; the
tracker's two tools came with the requirement-tracker integration.

`construction_guide` returns the skill core (`skills/foundry-construct/SKILL.md`), the app's rules (`FRONT_DOOR_RULES`, kept beside
the code that enforces them), the capability catalogue with schemas, and the names of the references and worked examples; with
`name` it returns one of them (references as text, worked examples with their practice cases). No `say` string, dialog or demo line
uses card or template words.

## Run the demo

```
npm run demo            # or: node app/demo/front-door.mjs [--keep] [--json]
```

It starts the app's MCP server in a temporary workspace, in process, and a scripted agent (no model) reads the guide, builds and
proposes four workflows none of the examples could do (a two-sheet reconciliation with an independent recount; a fan-out over every
supplier with a coverage ledger; a two-step approval chain, practised with stand-in answers; an incident escalation with a timer that
practice exercises by using a clock already past), dry-runs each, has the stand-in person turn the reconciliation on in the client's
dialog, runs it on the person's data with the send waiting for them, prints the audit (checks, verified hash chain, outbox, the
decisions), and shows two refusals (`MISSING_CAPABILITY` for SMS; `UNGROUNDED_TARGET` for an address the person never wrote). The
person acts only where a person acts (the client's dialog, which the server uses because the demo vouches for its client, the same
`dialog: true` path the MCP tests use). `app/test/demo.test.mjs` runs it headless.

Tests: `app/test/front-door.test.mjs` (the four builds, every gate, every refusal code, practice generation and timers, the guide
and the worked examples, the MCP surface, free-form batch lists), `app/test/builder-freeform.test.mjs` (scripted ModelPort: one
shot, repairs, caps, "cannot", policy-only model ids, FoundryApp re-checks), `app/test/demo.test.mjs`.

## Deferred, and known limits

- **No model step in a person's automations.** Agent nodes are refused, not run: the app has no ModelPort wired into live runs, and
  wiring one needs the owner's budget and the Allowed AI setting per workspace. The refusal says so.
- **No signals.** Nothing in the app can deliver a signal to a waiting run (an acknowledgement from outside, say); such waits are
  refused. A timer works; its practice needs `at` taken from the input so a case can use a time already due.
- **Questions inside a map do not show the item.** A human step's question is fixed text, so in the approval chain the person sees
  "Team lead: approve this purchase request?" without which request; the page shows the step and that it is inside a map. An engine
  change (a question built from data, fenced) would fix it.
- **One person decides everything.** Separate approvers (the lead and finance being different people) are not enforced in
  single-person mode; the demo's workflow says so in its envelope.
- **Grounding is literal.** An address or channel must appear in the person's words, or be read from their data. A target computed by
  code from the data is allowed (code cannot introduce an address the person did not write, because every address in the workflow is
  checked), but the code's logic is not proven; practice and the per-action asks are what show it.
- **The organisation's authority map** (never-outside-domain, money limits) is applied to the examples' settings at proposal time,
  not yet to free-form workflows.
- **The free-form builder is untested against a real model.** It is tested only with a scripted ModelPort; its capability is unmeasured.
  A paid run needs a frozen case set and the owner's go-ahead.
- **The site** still builds only from its examples by form; a free-form automation reaches it through the coding agent. The site's
  API lists free-form automations and drafts (no example id, titled by the workflow) and its list card shows a free-form list, but
  no page was redesigned for them. The Playwright journey `app/site/test/journeys/p1-agents.mjs` now drives the front door (the
  scripted agent starts from the invoice worked example, writes in the person's address, proposes; the guessed address is refused;
  the exact list is approved in the browser, for Claude Code and for Cursor/Codex) and its three journeys passed on 2026-11-05 with
  the same person steps and asks as before. Its regenerated screenshots were not committed (about 7 MB): the committed
  `research/onboarding-20261021/shots/p1-*` and their transcripts still show the earlier card path of 2026-10-21. The other
  journeys (P2-P5, which use the site's form) were not re-run.
