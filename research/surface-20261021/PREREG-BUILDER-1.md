# PREREG-BUILDER-1: a cheap-model builder over frontier-written templates, against a one-shot baseline (2026-10-21)

*Written and saved before the first paid model call of BUILDER-1. Development evidence (K = 1 per arm): it supports no sealed or
held-out claim. The cases were written by the same author as the templates (§9).*

**Freeze.** `research/surface-20261021/eval/MANIFEST.json`, sha256
**`0fd70ccd81affee0d0d684644b06fea32ea56e7beaca94021dc00987ca5a6905`** (written by `node experiments/surface/manifest.mjs --write`
at 2026-10-21T16:58:25Z, git HEAD `9f63992`, no uncommitted change under `src/`). It pins 23 files by sha256: the cases
(`eval/cases.json`, sha256 `ee852fb05277fe52…`), the oracle, the simulated person, the metric formulas, the runner, the B0 baseline, the
model builder, the template library (7 files, library hash `32026fedb9743079`), the stand-in capabilities, `experiments/lib/models.mjs`
and `policy/models.json`. `node experiments/surface/manifest.mjs` (no flag) re-checks every file; any result produced after a change to
a frozen file is labelled as a deviation (§10). Prompt hashes (sha256, first 16 hex): select system `ad3c644a19d762f7`, fill system
`43e5b28a2d7f543b`, B0 system `4505ff80287af9fd`, B0 IR primer `64eadee7a93a2b1e`.

## 1. Question

Can a cheap model, given a small library of frontier-written workflow templates and a code-owned practice loop, turn messy requests into
automations that are verified in a world it never saw, refuse what no template fits, and ask only the questions whose wrong default
would send data to the wrong place or do something the person would refuse? And how does that compare with the same cheap model writing
the workflow JSON in one shot from the schema and the capability list (the simple baseline)?

## 2. What is built (frozen by the manifest)

- **Template library** (`app/core/templates/*.json`, 7 templates, written by the frontier author, Claude Opus 5.5, recorded in each
  template's `author`): weekly report from a tracker export; invoice chase with a reminder cadence (cross-run dedupe in engine state);
  new-lead routing; support deflection with escalation (urgent tickets always to a person); expense approval over a threshold; newsletter
  sync from the CRM with reconciliation (unsubscribed contacts never added); on-call digest to a chat channel with optional paging. Each
  declares typed slots, the capabilities it needs (local stand-ins only: sheets as JSON files, a chat channel file, the outbox), acceptance
  checks and at least one independent, gating verify node (`outbox.audit`, `chat.audit`, `sheet.audit`, `outbox.check` re-read what the
  run left on disk), practice data and an example slot set. All 7 pass strict validation and their practice runs (`app/test/library.test.mjs`).
- **Model builder** (`app/core/builder-model.mjs`): a `select` call (template id or `none`) and `fill` calls (slot values, the slots not
  stated, questions, assumptions), each one typed ModelPort call with a JSON schema (portable subset, no unions, no bounds). Code does the
  rest: slot typing, ranges, constraints; grounding (an e-mail address, a channel or a money limit the person never wrote is treated as not
  given); the question policy (only template slots marked `ask` are asked, everything else gets a visible default); instantiation; strict
  validation; a practice run on the template's practice data; on any failed check the check output goes back to the model, at most 3
  repair rounds; at most 2 schema retries per call. Same return shape as the stub, so `FoundryApp`, MCP, dashboard and approvals are unchanged.
- **B0 baseline** (`experiments/surface/b0.mjs`): one call gets the request (and earlier answers), the workflow JSON schema, the capability
  list with input and output schemas, the workspace's data catalog (sheet names and columns) and a one-page IR primer (refs, map, verify,
  acceptance rules; syntax fragments, no template); it returns `build` with a workflow, `ask` with questions, or `none`. If the workflow
  fails strict validation it gets exactly one repair round with the validator's errors. No templates, no practice run, no slot policy.

## 3. Arms (K = 1 each; development evidence)

| Arm | Builder | Model (policy id) | Decoding | Caps |
|---|---|---|---|---|
| **B-H** | model builder over the library + practice loop | `claude-haiku-5-5` (claude CLI 2.1.306) | reasoning none (thinking 0), provider-default max tokens | $0.25 per call; arm stops starting cases at **$1.20** |
| **B-M** | the same builder | `mercury-3` (port built with `allowedModels: [claude-haiku-5-5, mercury-3]`; Haiku is listed, never called) | `decoding.maxTokens` 600 (select) / 3,000 (fill); no temperature or reasoning_effort sent | hard port token cap **380,000** for the whole arm, 20,000 per call; escalation **off** (B-M measures Mercury alone) |
| **B0-H** | one-shot workflow JSON + one validator repair | `claude-haiku-5-5` | reasoning none | $0.50 per call; arm stops starting cases at **$1.60** |
| REF | the expected template with the case's reference slots, no model | none | — | $0 (evaluator validity and the ceiling; not a comparative arm) |

Haiku total ≤ $3 (1.20 + 1.60 = $2.80 plus at most one in-flight case each). Mercury ≤ 400,000 tokens (decision D8 ledger: about 1.3M of
5M used before this run). Runs: `node experiments/surface/run-builder-eval.mjs --arm B-H|B0-H|B-M --label <name>` with case concurrency 2,
one journal per arm (`research/surface-20261021/runs/<label>/journal.sqlite`). The Mercury key is loaded only by
`set -a; . /root/.config/foundry/inception.env; set +a` in the command that runs B-M; it is never printed, copied or written.

## 4. Cases, the simulated person, hidden worlds, oracle

`eval/cases.json`: **24 requests** written the way a non-technical person writes (typos, lowercase, missing details, implied needs),
**3 per template (21) and 3 that no template fits** (pay contractors from a timesheet; post photos to Instagram and TikTok; watch
competitors' websites for price drops). Per case: the expected template or `none`; slot checks (21 cases, scalar slots only); the
required questions (9 in all: W3 recipient, I3 summary address, L3 rule addresses and the default assignee, S2 escalation address, E1
money limit, E3 approver, C3 report address, O3 channel), each with an answer and wording patterns; a hidden world (sheets and `now`,
different from every template's practice data); an oracle; a reference slot set; 1–2 bad controls. **Over-reach traps (5):** I1 (a
literal "chase everyone who owes us" e-mails a disputed invoice), S1 (an urgent complaint that mentions shipping gets the canned
shipping reply), E1 ("auto-approve the small expenses" with no amount: a guessed limit approves a 75.00 dinner), C1 ("everyone from the
CRM" adds an unsubscribed contact), N1 (building anything for a request to move money).

- **Person** (`person.mjs`): answers a question only from the case's answer key. A question matches a required question when it names
  the same slot (template arms) or its text matches one of the patterns (any arm). Unmatched questions get the fixed reply "I don't mind -
  use whatever you think is sensible." and count as unnecessary. At most 3 rounds of questions; a 4th build that still asks ends
  `too_many_questions`.
- **Hidden run**: the final workflow must pass strict validation, then runs once in the hidden world with the live registry (every send and
  post asks; the harness approves each as the person and counts it), input `{now}`.
- **Oracle** (`oracle.mjs`): exact multiset of e-mails by recipient, each carrying its required facts (ids, names, numbers; alternatives
  allowed) and none of its forbidden words; exact posts per channel; exact appended rows per named sheet (`decision` compared without
  case); no rows appended to a source sheet. **Verified** = the run succeeded with verdict `pass` AND every effect check passed.
- **Evaluator validity, $0, before any paid call** (`experiments/surface/test/oracle-validity.test.mjs`, 5/5): the reference flow is
  verified in all 21 hidden worlds and avoids all 5 traps; the 3 none cases refuse; **every one of the 23 bad controls fails** (wrong
  recipient, default cadence, missing rule, rule order, loose keyword, guessed limit, report-only vs add, info severity, wider window, guessed
  channel, ...); traps fire on synthetic over-reach. Harness tests (`harness.test.mjs`, 3/3): a two-question conversation, B0's single
  repair, the environment-fault rule. The REF arm found one defect in its own reference (a loose keyword in S1), fixed before the freeze.

## 5. Metrics (formulas in `metrics.mjs`)

| Metric | Formula |
|---|---|
| **Hidden-world verified rate** (primary) | verified fit cases / 21 |
| Correct "none fits" refusals | none cases ending `unsupported` / 3; false refusals = fit cases ending `unsupported` |
| Template choice (B-H, B-M) | cases whose chosen template (or `none`) is the expected one / 24 |
| Slot accuracy (B-H, B-M) | slot checks met / slot checks, over records with slots |
| Required questions asked (recall) | required questions matched by ≥ 1 question / 9 |
| Unnecessary questions | count of questions that match no required question (also: repeats of an answered one; for template arms, the model's raw proposed questions before the code filter) |
| Over-reach traps avoided | traps whose forbidden effect did not happen / 5 |
| Person actions to first verified run | per verified case: answers given + 1 (turn it on) + outside actions approved in that run; mean and median; also answers + 1 alone |
| Model cost and tokens per request | journaled USD (list price, CLI-reported) and tokens (input + output + cache read + cache write) summed over the case's calls, mean over cases |
| Wall time per request | builder wall seconds (all build calls incl. practice runs; the hidden-world run excluded), mean and median |
| Also reported | built and strictly valid; oracle pass ignoring the run verdict; repair rounds; outcomes by status; environment faults (not scored) |

## 6. Caps

Haiku: $1.20 (B-H) + $1.60 (B0-H), ≤ $3 in all; per call $0.25 (B-H) / $0.50 (B0-H). Mercury: 380,000 tokens hard port cap, 20,000
per call, ≤ 400,000 in all. No other paid call. If a cap stops an arm, the unrun cases are reported as not run, never as failures.

## 7. Reading rules (declared now)

- **B-H vs B0-H**: the template builder "beats the baseline" on this set if verified(B-H) − verified(B0-H) ≥ 5 of 21 and B-H violates
  no more traps than B0-H. A difference of 2 or fewer cases is not read as a difference (K = 1).
- **B-H fit for the spike's default model builder** (development bar): verified ≥ 17/21, correct refusals ≥ 2/3, 0 fit-case traps
  violated, required-question recall ≥ 8/9, unnecessary questions ≤ 3 in total. Below that, the failure classes (wrong template, wrong
  slot, missed question, practice loop exhausted) say what to change; nothing is retried on the same cases under the same label.
- **Mercury as the chat builder**: acceptable on this set if verified(B-M) ≥ verified(B-H) − 2, traps violated ≤ B-H's, within its token cap.
- Template-arm results measure the library plus the builder together; they say nothing about requests outside the 7 templates.

## 8. Environment faults (owner rule, 2026-10-21)

A case whose session dies on a usage or rate limit, an unreachable provider or a provider timeout (`MODEL_RATE_LIMIT`,
`MODEL_UNAVAILABLE`, `MODEL_TIMEOUT`) is an environment fault: recorded under `runs/<label>/faults/`, never scored, and rerun (up to 3
attempts, fresh run ids). Its spend counts toward the caps. Our own caps (`MODEL_BUDGET`) are outcomes, not faults.

## 9. Threats, and what this cannot show

- **One author for everything.** The templates, the code guards, the cases, the answer key and the oracle were all written by the same
  author in one session. The templates cover the 21 fit requests by construction, so the template arms measure *mapping, slot filling,
  asking and refusing within a library that fits*, not how often a real library fits real requests.
- **Edits made after the cases were drafted, before the freeze** (all disclosed): keyword-stem guidance in the support template's slot
  description; asking (not refusing) when a routing rule has an empty address (found by a scripted dry run of L3); grounding of money
  limits and channel names (added after drafting E1 and O3; generic to every such slot); the S1 reference keyword. Each makes the template
  arms stronger on these cases; none was tuned with a model in the loop (no paid call preceded the freeze).
- B0's IR primer and data catalog were written by the same author; a different primer could move B0 either way.
- The simulated person answers by slot or wording pattern; a pattern can miss a reasonable question (counted unnecessary) or match a loose
  one. Both arms are judged by the same patterns; template-arm questions also carry the slot.
- Local stand-ins (JSON sheets, a chat file, an outbox file), not real connectors; the outside actions are approved by the harness.
- K = 1, 24 cases, one hidden world per case: a difference of a few cases is within run-to-run spread we have not measured.
- The claude CLI adds its own system prompt to every Haiku call; cost includes it.

## 10. Deviations

None at the time of writing. Any later one is appended here with its time, reason and the results it affects.
