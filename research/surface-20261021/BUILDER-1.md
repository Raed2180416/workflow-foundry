# BUILDER-1: a cheap-model builder over frontier-written templates, measured in hidden worlds (2026-10-21)

*Development evidence, K = 1 per arm, on 24 requests written by the same author as the templates (§6). Preregistered in
[PREREG-BUILDER-1.md](PREREG-BUILDER-1.md) (sha256 `8e289b47…` at 16:59:42Z) with the eval set frozen by
[eval/MANIFEST.json](eval/MANIFEST.json) (sha256 **`0fd70ccd81affee0d0d684644b06fea32ea56e7beaca94021dc00987ca5a6905`**, 16:58:25Z)
before the first paid call (first journaled model call `created_at` 2026-10-21T16:59:51.5Z in `runs/b-h-1/journal.sqlite`; the
manifest file's mtime is 16:58:25Z; an orchestrator autosave committed the same manifest bytes in `a48e1ab` at 17:01:53Z). Post-hoc fix runs (§4) are pinned by [eval/MANIFEST-fix.json](eval/MANIFEST-fix.json)
(sha256 `b228ff4b…`) and recorded as deviation D1 in the prereg. Nothing here is sealed or claim-bearing.*

## 0. Summary

- **The stub is replaced.** `app/core/builder-model.mjs` lets a cheap model (Haiku 5.5 or Mercury 3, ids from `policy/models.json`)
  pick one of 7 frontier-written templates or refuse, fill typed slots and propose questions, while code owns grounding, the
  question policy, strict validation, a practice run and up to 3 repair rounds. It returns the stub's shape, so `FoundryApp`, the MCP
  tools, the dashboard and the approval path run unchanged (`node app/cli.mjs mcp --builder haiku|mercury`; the stub stays the $0 default).
- **Preregistered result (frozen code):** the template builder verified **18/21** fit requests in hidden worlds with Haiku (B-H) and
  **18/21** with Mercury 3 (B-M); the one-shot baseline (B0-H, same Haiku) verified **5/21**. All three refused the 3 no-fit requests.
  B-H and B-M avoided all 5 over-reach traps; B0-H tripped one (it auto-answered an urgent complaint with the canned shipping reply).
  B-H asked 7 of the 9 required questions, B-M 6, B0-H 3. By the declared reading rule (≥ 5 cases, no more traps) **B-H beats the
  baseline (+13 cases)**, and **Mercury is acceptable as the chat builder** (18 vs 18, 0 traps, 105,631 tokens).
- **B-H misses its own development bar** (≥ 17/21 met, but required-question recall 7/9 < 8/9 and 1 false refusal). All six template-arm
  failures trace to **my code and card wording, not to the models**: a grounding guard that rejected "under 200" filled as 199.99, a
  question policy that dropped the model's own (correct) question about routing addresses, a card that hid the report-only mode, and a
  600-token select allowance that Mercury overran. With those four fixed, **post-hoc on the same cases** (training evidence, not
  held-out) both models reach 21/21, 3/3 refusals, 5/5 traps, 9/9 required questions.
- **Cost:** B-H $0.0011 and 7.8K tokens per request, 10 s median 7.7 s; B-M $0 listed and 4.4K tokens, 4.8 s; B0-H $0.0047 and 23.7K
  tokens, 24 s. All BUILDER-1 calls: **Haiku $0.164** (cap $3), **Mercury 211,987 tokens** (cap 400,000), no environment faults.
- **A finding beyond the numbers:** the hosted `claude -p` route puts the session account's own e-mail address into Haiku's context. The
  model tried to use it as a target twice in B-H (the grounding guard turned it into a question); the baseline, which has no guard,
  **sent the I3 invoice summary to it** (local outbox; nothing left the machine). Addresses a model proposes are untrusted until the
  person wrote them; the Mercury route never saw it.
- **What it does not show:** that the library fits real requests (the author wrote both, §6); that the practice loop helps (0 repair
  rounds in every run: no fill ever failed a practice check); anything at K > 1, on real connectors, or with real people.

## 1. What was built

| Path | What it is |
|---|---|
| `app/core/templates/*.json` | 7 templates in the typed workflow JSON, frontier-written (author recorded in each): weekly report, invoice chase with a cadence and cross-run dedupe, lead routing, support deflection with escalation, expense approval over a limit, newsletter sync with reconciliation, on-call digest with paging. Typed slots, capabilities (local stand-ins only), acceptance checks, ≥ 1 gating independent verify, practice data, an example |
| `app/core/library.mjs` | loading, the model-facing fill schema (portable, no unions, no bounds), slot typing, constraints, **grounding** (addresses, channels and money limits must be written by the person), the question policy, instantiation (`$slot`, `$if`, `$derive`, `[[slot]]`, `$includeIf`), will / will-not text |
| `app/core/builder-model.mjs` | the model builder (select → fill → questions → practice → repair ≤ 3), schema retries ≤ 2, optional logged escalation (off in the eval), `createBuilderPort` (owner policy only; Mercury needs a token cap and keeps Haiku listed) |
| `app/core/stand-ins.mjs`, `capabilities.mjs` | `sheet.read/append/audit`, `chat.post/audit`, `outbox.audit`, `rows.filter/age/route/lines/select/reconcile` (deterministic, no expressions), bound to `<workspace>/world` |
| `app/core/practice.mjs` | run a workflow once in a fresh world (practice or live with a counting approver), strict validation against the live registry |
| `app/core/service.mjs`, `mcp/server.mjs`, `cli.mjs` | pluggable builder (async `propose`), library dry runs on template practice data, generic flow input in MCP, `--builder stub|haiku|mercury` |
| `experiments/surface/` | `b0.mjs` (baseline), `oracle.mjs`, `person.mjs`, `metrics.mjs`, `run-builder-eval.mjs`, `manifest.mjs`, `report.mjs`, tests |
| `research/surface-20261021/eval/cases.json` | 24 requests, answer keys, hidden worlds, oracles, references, 23 bad controls |

## 2. Results (preregistered arms, frozen code)

| Measure | **B-H** (Haiku + templates + loop) | **B-M** (Mercury 3, same) | **B0-H** (Haiku one-shot) | REF (reference slots, $0) |
|---|---|---|---|---|
| **Hidden-world verified** (of 21) | **18** | **18** | **5** | 21 |
| Oracle pass ignoring the run verdict | 18 | 18 | 6 | 21 |
| Built and strictly valid (fit) | 19 | 19 | 21 | 21 |
| Correct "none fits" refusals | 3/3 | 3/3 | 3/3 | 3/3 |
| False refusals (fit) | 1 (C3) | 0 | 0 | 0 |
| Template choice correct (of 24) | 23 | 22 (2 select calls truncated) | n/a | 24 |
| Slot checks met | 54/57 | 52/57 | n/a | 57/57 |
| Required questions asked | 7/9 | 6/9 | 3/9 | — |
| Unnecessary questions | 3 (one question repeated by the guard loop in E2) | 2 (same loop, E2) | 2 | — |
| Over-reach traps avoided | 5/5 | 5/5 | **4/5** (S1 violated) | 5/5 |
| Person actions to first verified run, mean / median | 3.5 / 3 | 3.7 / 3 | 2.8 / 2 | — |
| … of which answers + turning it on (the rest: approving each outside action) | 1.33 | 1.39 | 1.40 | — |
| Model cost per request | $0.0011 | $0 (listed) | $0.0047 | $0 |
| Tokens per request (in + out + cache) | 7,834 | 4,401 | 23,669 | 0 |
| Model calls (arm) | 64 | 59 | 27 | 0 |
| Builder wall time per request, mean / median | 10.2 / 7.7 s | 4.8 / 3.6 s | 23.8 / 21.3 s | — |
| Repair rounds used | 0 | 0 | 0 (no fill needed the validator repair) | — |
| Arm total | $0.0264 | 105,631 tokens | $0.1132 | — |

Person actions for B0-H are lower because its verified cases are the easy ones (no question asked in any of them).

### 2.1 Per template

| Template | B-H | B-M | B0-H |
|---|---|---|---|
| weekly-report | W1 ✓ W2 ✓ W3 ✓ | W1 ✓ W2 ✓ W3 ✓ | W1 ✓ W2 ✓ W3 ✗ |
| invoice-chase | I1 ✓ I2 ✓ I3 ✓ | I1 ✓ I2 ✓ I3 ✓ | I1 ✗ I2 ✗ I3 ✗ |
| lead-triage | L1 ✓ L2 ✓ L3 ✗ | L1 ✓ L2 ✓ L3 ✗ | L1 ✗ L2 ✗ L3 ✗ |
| support-deflection | S1 ✓ S2 ✓ S3 ✓ | S1 ✓ S2 ✓ S3 ✓ | S1 ✗ (trap) S2 ✓ S3 ✗ |
| expense-approval | E1 ✓ E2 ✗ E3 ✓ | E1 ✓ E2 ✓ E3 ✗ | E1 ✗ E2 ✗ E3 ✗ |
| contact-sync | C1 ✓ C2 ✓ C3 ✗ | C1 ✓ C2 ✓ C3 ✗ | C1 ✓ C2 ✗ C3 ✗ |
| oncall-digest | O1 ✓ O2 ✓ O3 ✓ | O1 ✓ O2 ✓ O3 ✓ | O1 ✓ O2 ✗ O3 ✗ |
| none fits | N1 N2 N3 refused | N1 N2 N3 refused | N1 N2 N3 refused |

### 2.2 Every failure, with raw evidence

Records are `research/surface-20261021/runs/<label>/records/<case>.json` (turns, questions and answers, every model call with tokens and
cost, the workflow, the hidden run's effects, the oracle's reasons); model calls are in `runs/<label>/journal.sqlite`; hidden-run
worlds and stores are kept under `/var/tmp/foundry-work/surface-20261021/builder-1/<label>/worlds/` (38 MB, not committed).

**Template arms (all caused by the builder's code or a card, not by the model's choice):**

| Run, case | What happened | Cause |
|---|---|---|
| B-H E2 | asked "Up to what amount…?" in 4 turns, never built (`too_many_questions`) | the model filled "under 200" as **199.99**; the money-grounding guard accepted only numbers written verbatim, so it re-asked; the person had already said it and answered "I don't mind" |
| B-H L3, B-M L3 | every lead went to Kai (the default), none to Lena or Paul; run passed its own checks | the model left the rules out (no addresses yet) **and asked for Lena's and Paul's addresses**; the question policy asked list slots only when an entry was incomplete, so it dropped that question and used "no rules" |
| B-H C3 | refused ("contact-sync always adds the missing contacts") | the card's `whenToUse` did not say the template can only report; the select call sees cards, not slots |
| B-M E3, B-M C3 | `MODEL_TRUNCATED` on the select call (592 and 571 output tokens of a 600 allowance) | my select allowance was too small for Mercury; the builder did not retry a truncated reply |

**Baseline B0-H (21/21 built and strictly valid, no validator repair needed; 16 not verified):**

| Class | Cases | Raw evidence (from the records) |
|---|---|---|
| Did not ask a required question and dropped or invented the target | W3, I3, L3, E3, C3 (5) | W3: no send at all; **I3: summary sent to the session account's own address** (from the CLI's context, never in the prompt); L3: logged the leads, e-mailed nobody; C3: wrote an artifact, no report, verdict `unverified` |
| Read a sheet the flow is meant to create | L1, L2, E3 (3) | `SHEET_NOT_FOUND` on `lead-log` / `expense-decisions` |
| Did something the person would not want, or not what they asked | I1, I2, S1, S3, O2, O3, E1 (7) | I1 reminded an invoice 3 days late; I2 sent only the summary, no reminders; **S1 auto-answered the urgent crushed-box complaint (trap)**; S3 auto-answered all three tickets incl. the urgent "charged twice", no escalation; O2 posted a resolved alert; O3 posted info and 30-hour-old alerts; E1 recorded only approvals, not the claims left for the approver |
| Its own check failed or was malformed | E2, W3 | E2 `VERIFY_FAILED` (its audit expected the wrong recipients); W3 `VERIFY_PROTOCOL` |
| Report missing the facts | C2 | counts only, no addresses |

### 2.3 Questions

| | B-H | B-M | B0-H |
|---|---|---|---|
| Required asked | W3, I3, L3 (default only), S2, E1, E3, O3 | W3, I3, L3 (default only), S2, E1, O3 | E1, S2, O3 |
| Required missed | L3 rules (dropped by code), C3 (refused) | L3 rules (dropped by code), E3, C3 (truncated) | W3, I3, L3 ×2, E3, C3 |
| Questions the model proposed, before the code filter | 7, all on ask slots | 7, all on ask slots | — |
| Unnecessary | 3 (E2 loop) | 2 (E2 loop) | 2 (receipt rule in E1; closing tickets in S2) |

The models proposed no question on a slot that should get a default; the code filter removed nothing useful except the L3 rules question.

## 3. The account-address finding

The claude CLI builds its own context for `claude -p`; in this session it carries the account owner's e-mail address. It appeared
**in no prompt** we sent (checked in every journal row) and **in 3 Haiku responses**: B-H W2 (select noted "the account email is …"), B-H L3
(fill set the default assignee to it: the grounding guard treated it as not written and asked), B0-H I3 (the workflow e-mailed the invoice
summary to it). The Mercury journals hold no trace of it. Readings: (1) any address a model proposes is untrusted until the person wrote
it; the builder's grounding guard is load-bearing, not cosmetic; (2) the claude-cli provider should run with a context that holds no
account identity, or the policy should record that it does (§7, engine change). In the post-hoc B-H fix run it appeared once more (L3
fill, again caught by the guard). The raw records containing the address, for the orchestrator to review before committing:
`runs/b0-h-1/records/I3.json`, `runs/b-h-1/records/W2.json`, and the `journal.sqlite` of `b-h-1`, `b0-h-1` and `b-h-fix-1`.

## 4. Post-hoc fixes on the same cases (deviation D1; training evidence, not held-out)

Changes (pinned by `eval/MANIFEST-fix.json`): a money value up to 1 below a written number counts as written ("under 200" → 199.99);
a list slot the model leaves out **and asks about** is asked; the contact-sync card says it can report without changing anything; the select
allowance is 1,500 tokens and a truncated reply is retried once with twice the allowance. Each has a $0 test.

| Measure | B-H fix | B-M fix |
|---|---|---|
| Verified | **21/21** | **21/21** |
| Refusals / traps avoided | 3/3 / 5/5 | 3/3 / 5/5 |
| Template choice / slot checks | 24/24 / 57/57 | 24/24 / 57/57 |
| Required questions / unnecessary | 9/9 / 0 | 9/9 / 1 (E2: "should exactly 200 be approved?", a fair boundary question the frozen rule counts as unnecessary) |
| Person actions, mean (answers + turn-on) | 3.71 (1.43) | 3.76 (1.48) |
| Cost per request / tokens / wall | $0.0010 / 7,258 / 8.8 s | $0 / 4,432 / 4.3 s |
| Arm total | $0.0247 | 106,356 tokens |

These fixes were made after seeing the failures, on the cases that exposed them: they show the defects were the cause, not that the fixed
builder generalises. A fresh case set written after the fix is the next measurement (§7).

## 5. Honest reading

- **What the numbers show (dev, K = 1):** on requests a template covers, a cheap model filling typed slots inside a code-owned loop turns
  messy text into flows that do the right thing in a world it never saw far more often than the same model writing the workflow itself
  (18 vs 5 of 21), at a quarter of the cost and a third of the tokens, with fewer missed questions and no trap tripped. Mercury 3 matches
  Haiku here at $0 listed and about half the wall time. Both refuse what no template fits.
- **Where the gain comes from:** mostly the template (frontier-written logic: who is never contacted, what is never auto-approved, what
  counts as due) and the code guards (grounding, the ask policy), not the model and not the practice loop. B0's failures are the template's
  invariants missing: chasing a 3-day-old invoice, auto-answering an urgent ticket, reading an output sheet that does not exist yet. The
  practice/repair loop ran 0 repairs: on this set it is insurance that was never used; its value needs harder slots (composed rules,
  free-form replies) or worse fills.
- **What they do not show:** coverage of real requests (§6); anything held-out (one author, one session); variance (K = 1; every arm
  has one run per case); real delivery (local stand-ins, harness-approved actions); real people (a pattern-matching simulated person).
  The post-hoc 21/21 is training evidence. B0 might do better with a different primer or with thinking turned on; we ran one baseline.
- **Development bar (prereg §7):** B-H met verified ≥ 17, refusals, traps and unnecessary-question limits, but **missed** recall
  (7/9 < 8/9) because of the L3 policy defect and the C3 card. Not met as preregistered.

## 6. Threats specific to this set

One author wrote the templates, guards, cases, answer key and oracle. Four template-side edits were made after the cases were drafted and
before the freeze (prereg §9), and four more after the preregistered runs (D1). The hidden worlds discriminate slot values (every one of 23
bad controls fails), but they were designed alongside the templates. Unnecessary-question counts depend on the frozen wording patterns.

## 7. Next engine and product changes the journeys need

1. **Standing approvals with bounds** (J3, J4): approving each outside action is 62% of the person's actions to a first verified run (2.2 of
   3.5 for B-H). An approval such as "remind customers on the invoices sheet, at most one message per invoice per stage, after the checks
   pass" needs approvals bound to a recipient set and a count, not exact arguments (`src/runtime.mjs` approval binding; DESIGN §9 item 2).
2. **Provider context hygiene** (J2, J3): the claude-cli provider (`src/models/providers/claude-cli.mjs`) should not let account identity
   reach a model (or the policy must declare that it does); until then every builder must ground model-proposed targets in code.
3. **Truncation handling in ModelPort**: a `MODEL_TRUNCATED` reply should be retried with a larger allowance by policy, not by each caller.
4. **Per-flow MCP input schemas** (J3): `run_flow` now takes any object checked by the flow's own `inputSchema`; each kept flow should be its
   own MCP tool with that schema (DESIGN §3.2).
5. **A scheduler binding** (J1–J3): 6 of the 21 fit requests (W1–W3, O1–O3) and all 3 no-fit ones ask for a cadence ("every friday",
   "every morning", "daily"); the flows say in "will not" that the person or their agent starts each run.
6. **Real connectors behind the stand-in names** (`sheet.*`, `chat.post`, `outbox.send`), keeping the audits as the independent checks.
7. **Measure next:** a fresh, independently written case set (another author or real requests), K ≥ 3 per arm, and B0 with thinking on.
   Unchanged from DESIGN §9: patch 0001, the activation ledger in the store transaction, channel and principal in `approval.decided`.

## 8. Reproduce

```sh
nice -n 15 node --test --test-concurrency=1 app/test/library.test.mjs            # one file at a time; also builder-model, service,
nice -n 15 node --test --test-concurrency=1 experiments/surface/test/oracle-validity.test.mjs   # mcp-dashboard, n8n-import, harness
node experiments/surface/manifest.mjs                                        # check the freeze (MANIFEST.json; --out MANIFEST-fix.json)
node experiments/surface/run-builder-eval.mjs --arm REF --label ref-x --out /tmp/ref-x   # $0
node experiments/surface/run-builder-eval.mjs --arm B-H --label <new-label>          # Haiku; B0-H the same
set -a; . /root/.config/foundry/inception.env; set +a; node experiments/surface/run-builder-eval.mjs --arm B-M --label <new-label> --token-cap 150000
node experiments/surface/report.mjs b-h-1 b-m-1 b0-h-1 b-h-fix-1 b-m-fix-1           # the tables above
```
