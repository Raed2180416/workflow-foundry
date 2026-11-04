# A1-C check precision on dev60 (in-sample development evidence, 2026-10-21)

*Run `a1c-dev60-dn` (Haiku 5.5 in every role, harness a1c-v1, 60 devTrain tasks, seed 21, k = 1). Development evidence on
devTrain tasks read as the developer (PREREG-AB-v1 §5); in-sample (the pipeline was probed on these tasks while it was
built). One annotator (this study) aligned every compiled check with the grader's assertions; the per-check labels and
their reasons are in `labels.py` beside this file, so every number below can be re-derived and disputed line by line.*

## Method

- **Grader truth at every check round.** The live run grades only the final world. To know what the grader would have said
  before and after each repair, every task was replayed through the bridge's own `Rollout` (`experiments/autobench/bridge.py`,
  read-only) from `prep/<task>/world0.json`, applying the recorded `calls.jsonl` steps up to the start of each repair node
  (`nodes.json` timing) and grading there. The generator values (uuid, clock, random) recorded in `generated.json` are played
  back in order, and grading draws live values as the live run did. **Validation: 60/60 tasks reproduce the live final grade
  exactly (per-assertion), and every replayed step returns byte-identical tool results.** The initial world was graded the
  same way to separate action assertions (false at start) from guards (true at start).
- **Alignment.** Each of the 618 checks in `pipeline/postconditions.json` was aligned with the grader assertion(s) it
  tests: *full* (same entity and effect, asserted value tested), *partial* (same entity/effect, asserted value not tested)
  or none. Each check's verdict in `check-N.json` was then compared with grader truth at that round:
  TA (check passes, assertion passes), TR (both fail), **FA** (check passes, an aligned assertion fails),
  **FR** (check fails, aligned assertions pass; or check fails and has no graded counterpart, "unaligned"),
  neutral pass (passes, no graded counterpart), undecided (judged check not re-run after round 0).
- Scored assertions = the grader's denominator: 567 action assertions plus 25 guards the agent broke (592). 388 intact
  guards are excluded by the grader and reported separately.
- Scripts and intermediate data: `bin/playback.py`, `cuts.py`, `labels.py`, `analyze.py`, `coverage.py`, `failing.py`,
  `fixmap.py`, `tables.py`; replays in `replay3/` (per round) and `replay0/` (initial world), all in this directory. `replay/` and `replay2/` are
  superseded first attempts (grading consumed played-back generator values, which produced one spurious 0.0 grade); do not use them.

## Headline

- **A failing hard check is usually wrong.** At round 0 (the act world) 137 hard checks failed; 120 of them (88%) failed a
  world the grader passes or demanded something the grader does not ask. Of the 17 that agreed with the grader, 16 agreed
  by accident (the re-read was blind to the app, the check was compiled to the wrong app, or it compared a whole text field
  to a phrase on the wrong record). **One** hard check in 60 tasks (finance.ap_aging_report)
  rejected a failing world for the right reason.
- **A passing hard check is usually right but often too weak.** 207 of 235 passing hard checks were correct (88%); 28 (12%)
  passed a world that fails the grader. Most false accepts are checks that do not carry the value the grader tests (weak),
  or checks that faithfully encode a wrong requirement the ledger produced, which the agent then carried out.
- **87 of 592 scored assertions (15%) have no check at all; 44 of the 121 failing assertions (36%) are among them.**
  A further 101 scored assertions (32 failing) are only partially covered.
- **Task-level gate at round 0:** of 21 worlds the grader passes, the gate rejected 13 (62%); of 39 failing worlds it
  accepted 18 (46%) and rejected 21, 20 of them only through wrong or blind checks.
- **Repairs never turned a failing world into a passing one** (0 of 21 rejected failing worlds, 42 rounds) and **broke one
  passing world** (support.intercom_multi_product_routing: 1.00 -> 0.94, a hard check demanded a tag the routing rules
  exclude). 23 repair rounds ran on worlds the grader already passed; 14 of them changed the world.
- **Stale/true-at-start checks: none.** The diff-based evaluation means no positive check was true in the initial world
  (all 54 checks true at start are the intended negatives).

## Tables

### T1. Check verdicts against the grader (618 compiled checks, 372 hard)

| Checks | Round | n | correct accept (TA) | correct reject (TR) | neutral pass (no graded counterpart) | **false accept** | **false reject** (aligned / unaligned) | undecided |
|---|---|---|---|---|---|---|---|---|
| all | 0 (act world) | 618 | 307 | 31 | 73 | **38** | **169** (115 / 54) | 0 |
| all | final | 618 | 266 | 22 | 66 | **40** | **135** (97 / 38) | 89 |
| hard | 0 (act world) | 372 | 179 | 17 | 28 | **28** | **120** (97 / 23) | 0 |
| hard | final | 372 | 200 | 10 | 34 | **30** | **98** (81 / 17) | 0 |
| advisory | 0 (act world) | 246 | 128 | 14 | 45 | **10** | **49** (18 / 31) | 0 |
| advisory | final | 246 | 66 | 12 | 32 | **10** | **37** (16 / 21) | 89 |

### T2. Round-0 verdict quality by check type

| Check type | n | hard | TA | TR | neutral | FA | FR | P(correct \| check fails) | P(correct \| check passes) |
|---|---|---|---|---|---|---|---|---|---|
| judged | 136 | 0 | 88 | 6 | 28 | 4 | 10 | 0.38 (6/16) | 0.97 |
| record_created | 107 | 71 | 20 | 7 | 4 | 6 | 70 | 0.09 (7/77) | 0.80 |
| gmail_sent | 94 | 86 | 62 | 0 | 7 | 15 | 10 | 0.00 (0/10) | 0.82 |
| sheet_row | 94 | 66 | 51 | 0 | 19 | 4 | 20 | 0.00 (0/20) | 0.95 |
| record_field | 78 | 61 | 40 | 10 | 5 | 2 | 21 | 0.32 (10/31) | 0.96 |
| slack_posted | 55 | 48 | 11 | 8 | 2 | 7 | 27 | 0.23 (8/35) | 0.65 |
| gmail_not_sent | 49 | 37 | 33 | 0 | 5 | 0 | 11 | 0.00 (0/11) | 1.00 |
| slack_not_posted | 5 | 3 | 2 | 0 | 3 | 0 | 0 | – | 1.00 |

### T3. Grader assertions and the checks that cover them

Scored assertions = assertions false in the initial world (action) plus guards (true at start) that the agent broke. "Full" = a check on the same entity and effect that tests the asserted value; "partial" = same entity/effect, asserted value not tested; "missing" = no check at all.

| Assertions | n | full, hard | full, judged | full, advisory | partial only | **missing** |
|---|---|---|---|---|---|---|
| action, passed | 471 | 317 | 12 | 30 | 69 | **43** |
| action, failed | 96 | 23 | 11 | 1 | 32 | **29** |
| guards broken (failed) | 25 | 5 | 1 | 4 | 0 | **15** |
| guards intact (not scored) | 388 | 44 | 84 | 7 | 1 | **252** |
| **all scored** | 592 | 345 | 24 | 35 | 101 | **87** |

### T4. False rejects by cause (a check that fails a world the grader passes, or demands an effect nobody asked for)

| Cause | checks ever FR | of them hard | tasks | tasks with a hard FR | hard FR at round 0 |
|---|---|---|---|---|---|
| wrong app/record kind in the compiled check | 53 | 42 | 11 | 10 | 36 |
| instruction/rationale sentence compiled as a literal | 10 | 10 | 8 | 8 | 10 |
| app not re-read by the check (blind) | 23 | 23 | 7 | 7 | 23 |
| values from another item merged into the check | 14 | 14 | 3 | 3 | 14 |
| field semantics (tag list vs equality; verb as field) | 14 | 13 | 3 | 3 | 13 |
| excluded-recipient list overlaps a required recipient | 4 | 4 | 3 | 3 | 4 |
| requirement the grader does not test | 17 | 3 | 5 | 1 | 3 |
| negative content rule compiled as a recipient ban | 7 | 2 | 2 | 1 | 2 |
| over-strict: sheet-wide literal required in every row | 6 | 5 | 1 | 1 | 5 |
| literal the target record does not store | 5 | 4 | 1 | 1 | 4 |
| prompt placeholder kept as a literal | 3 | 2 | 1 | 1 | 2 |
| wrong literal value | 2 | 2 | 1 | 1 | 2 |
| check mechanics (DM channel) | 1 | 1 | 1 | 1 | 1 |
| wrong entity | 1 | 1 | 1 | 1 | 1 |
| demands an effect the grader forbids | 13 | 0 | 2 | 0 | 0 |
| judged-check (checker) error | 1 | 0 | 1 | 0 | 0 |
| check of something not asked | 1 | 0 | 1 | 0 | 0 |
| **total** | 175 | 126 | 31 | 29 | 120 |

### T5. Why the 121 failing scored assertions were not fixed

| Class | assertions | tasks | causes (assertions) |
|---|---|---|---|
| missing | 44 | 18 | M-world 21; M-negative-content 8; M-wrongdecision 8; M-negative(world) 2; M-noposcheck+derived 1; M-count 1; M-convention 1; M-noposcheck+format 1; M-scope 1 |
| FA-partial | 30 | 16 | weak: graded literal/aspect not in the check 19; weak: derived value (count/total/date math) not compiled 11 |
| FA-full | 20 | 12 | check encodes a wrong entity/scope (ledger error), agent complied 10; check encodes a wrong value (ledger error), agent complied 5; checker accepted a wrong world 4; weak: graded literal/aspect not in the check 1 |
| caught-hard | 18 | 5 | TR-wrongreason 18 |
| caught-advisory | 9 | 5 | advisory-noaddr 5; advisory judged 2; TR-wrongreason 1; advisory-negative 1 |

### T6. Task-level gate decisions

| | grader passes the world | grader fails the world |
|---|---|---|
| **round 0: gate accepts** (no hard check fails) | 8 | **18** false accepts (15 "all checks pass" + 3 "only advisory checks fail") |
| **round 0: gate rejects** (repair) | **13** false rejects | 21 (20 rejected only by wrong or blind checks; 1 for the right reason) |
| **final: accepted** | 9 + 1 advisory-only | **16** "all checks pass" + 3 advisory-only (ap_aging_report became an FA after its repair) |
| **final: stopped at max rounds** | **10** | 21 (incl. multi_product_routing, passing at round 0) |

Passing worlds falsely rejected at round 0 (13), and which fix clears every hard false reject (letters as in "Fixes" below):
soft_matching A; docusign_sequential_signing A+C; social_content_calendar C; zoom_training_setup B+C;
overtime_threshold_monitoring A; asana_safety_walk_log B+C; intercom_reactivation_campaign A; reamaze_cross_platform_dedup A;
helpcrunch_usage_alerts A+B+C+G; intercom_multi_product_routing A+F; vendor_payment_approval C; travel_advance_settlement C;
salary_adjustment_processing D. **A+B+C alone clear 10 of 13.**

False accepts (16 "all checks pass" + 3 advisory-only), decisive cause of the failing assertions:

| Decisive cause | Tasks |
|---|---|
| Check enforces a wrong requirement from the ledger, agent complied (newest policy missed, wrong target in a selection, eligibility exclusion missed, resource conflict not re-planned, wrong signer/scope) | qualify_lead, advance_opportunity_stage, partnership_contract, featured_snippet, loading_dock_scheduling, vendor_1099_prep, capex_approval (scope: notify every requestor) |
| Check too weak: the graded value is not in the check (subject word, per-item amounts, dates) | win_loss_analysis, community_engagement, gorgias_quality_audit, hiver_mailbox_audit, customer_feedback_aggregation (no positive e-mail check), competitive_displacement_outreach (partly) |
| Derived value (sum, count, day difference) not compiled because it is not verbatim in a source | quarterly_tax_estimate, ap_aging_report |
| Exclusion not enforced (excluded entity named in the report) | project_profitability (judged check accepted "Delta Integration excluded" in the body), budget_variance_analysis (no negative item) |
| Correct verdict ignored because the check was advisory | competitive_displacement_outreach (no recipient address), bad_debt_writeoff (negative), plus a policy action not in the ledger |
| Convention not checked (open the record you act on) | customer_story_intake |

Sonnet + A1 (contrast arm) passes 7 of the 16 false-accept tasks (qualify_lead, advance_opportunity_stage, gorgias_quality_audit,
hiver_mailbox_audit, vendor_1099_prep, project_profitability, budget_variance_analysis) and 8 of the 10 false-reject tasks.

### T7. Repair damage (grader truth before and after every repair round, from the replays)

| | rounds | tasks | rounds that changed the world | graded effect |
|---|---|---|---|---|
| Repair on a world the grader already passes | 23 | 13 | 14 | 1 pass -> fail (intercom_multi_product_routing), 0 improved |
| Repair on a failing world | 42 | 22 | 28 | partial credit up in 4 rounds (+10 assertions: social_contest +1, intercom_demo_scheduling +6, ap_aging_report +2, monday_onboarding_pipeline +1), down in 1 (linkedin_company_update: a second LinkedIn post broke `linkedin_post_count`), 0 tasks reached a pass |
| All | 65 | 34 | 42 | net partial credit +0.61 over 34 tasks (+0.018 per task); 3 graded assertions broken (multi_product_routing tag guard, linkedin post count, ap_aging_report "Acme" guard) |

**Wrong checks the repair satisfied:** 31 checks in 8 tasks went from false reject to pass because the repair bent the world
to the wrong check: instruction sentences written into customer e-mails and records (docusign_sequential_signing,
customer_milestone, zoom_training_setup, vendor_payment_approval, travel_advance_settlement), pre-existing "trial" tags deleted
from 5 HelpCrunch customers to satisfy a list-equality check, 3 e-mails sent to customers another ledger item said not to
contact (helpcrunch_usage_alerts), Zoho records written with two account names (helpcrunch_zoho_desk_bridge), an excluded tag
added (intercom_multi_product_routing).

**Ungraded side effects on worlds the grader already passed:** duplicate payment confirmations to vendors (vendor_payment_approval, 3),
duplicate settlement e-mail (travel_advance_settlement), 4 duplicate SMS to managers (overtime_threshold_monitoring), 13 duplicate
Salesforce tasks (helpcrunch_usage_alerts), duplicate Salesforce notes (soft_matching, 2), duplicate Asana tasks
(asana_safety_walk_log), duplicate Monday items and Airtable records (zoom_training_setup), an extra calendar row
(social_content_calendar). On failing worlds: duplicate calendar events (calendar_airtable_maintenance, 2), duplicate DocuSign
envelopes (docusign_contractor_offboard, 2), a second Zoom meeting and e-mails (zoom_dr_drill), duplicate Salesforce tasks
(zoom_meeting_followup). The grader does not see most of these; a real deployment would.

## Fixes, ranked by tasks affected (all generic: no task names, no benchmark values, no grader knowledge; H7/H8)

Tasks affected = tasks where the fix turns at least one wrong check verdict (FR or FA, any round) into a right one, turns a
right-for-the-wrong-reason verdict into a grounded one, or adds a check for a failing assertion that has none.

| Rank | Fix | Tasks | Effect on gate decisions |
|---|---|---|---|
| 1 | **A+B. Typed, observable effect model.** Compile each requirement through a per-app effect table derived from the shipped API schemas (H8 "endpoint notes"): which app and record kind an action writes, whether it is a child of an existing record (reply, note, tag, comment, event) or a new record, list vs scalar fields (tag membership, not equality; text fields: contains, not equality), DM vs channel. Verify by reading back the written record by the id the write returned; an app the re-read cannot see is never a hard code check. Today `post_message` always becomes `slack_posted` (`postconditions.mjs:69`), record kind is guessed by regex on the statement (`:95`), `record_field` is whole-value equality (`:199`, `:229`) and asana/monday/notion/jira/airtable records, Salesforce tasks and secondary calendars are not re-read (`appsToRead`, `:151`; `ENUM_PLAN` in `inventory.mjs`). | **22** (17 with a hard false reject; 68+24 checks) | clears hard false rejects in 9 of 13 falsely rejected passing worlds (sole fix for 4); 6 "right for the wrong reason" rejects become grounded |
| 2 | **E. Literal completeness, with derived values computed by code.** Every value the requirement names (entity names, per-item amounts, dates, subject/title words from the request or the governing policy) becomes a checked literal; derived values (sums, counts, day differences) are recomputed by code from the cited source fields instead of being dropped as unverified (`usable`, `postconditions.mjs:25`). Every message requirement gets a positive check. | **17** (15 with a false accept) | exposes the failure in 9 of 19 accepted failing worlds (sole fix for 6) |
| 3 | **F. Ledger scope and precedence.** Closed-world in/out classification of every candidate entity with the rule applied (near-miss note); the newest policy found in the world overrides older ones (the H7 example); a selection with a singular target yields one target (tie-break); a precedent artifact of the same kind fixes the format (e.g. a prior follow-up's subject prefix); excluded entities produce negative checks. | **15** (10 with a false accept) | exposes the failure in 7 of 19 accepted failing worlds (sole fix for 6) |
| 4 | **C. Literal hygiene.** A literal must be a value (name, id, number, date, enum) found in a record field: reject sentences from instructions, rationales or policy text (they pass `verified: cited` today because the request itself is a source), template placeholders (`<System>`, `[Area]`), and literals drawn from another ledger item (all literals of one check must co-occur in one source record or the item's target); a sheet-wide value (a contest code) is checked on the sheet, not on every row. | **13** (13 with a hard false reject; 41 checks) | clears hard false rejects in 7 of 13 falsely rejected passing worlds (sole fix for 3); with A+B, 10 of 13 |
| 5 | **D. Negative compile.** "X must not appear in the message/report/sheet" compiles to body/row-must-not-contain(X's name) on the same artifact, hard; never to `gmail_not_sent` to the required recipient (`postconditions.mjs:62`); excluded-candidate recipient lists subtract every address another item must reach (`:65`). | **11** (5 with a false reject, 3 with a false accept) | clears the only hard false reject of 1 passing world; exposes the failure in 3 accepted failing worlds (sole fix for 2) |

Next after the top five: **J** policy/config recall (every action a policy or config document prescribes becomes a requirement:
tag after scheduling, log a bridge event, file a Jira issue for bugs, update the source row; 8 tasks, all missing assertions),
**G** demote requirements no source asks for (5 tasks), **H** advisory checks with a correct fail verdict are ignored (2 tasks).

**Loop-level fix (independent of the ranking):** repair only on hard checks that pass a health test (observable app, schema-valid
effect type, value-only literals), never re-create an effect that already exists (repairs were not idempotent: duplicate
e-mails, SMS, tasks, envelopes, posts), never delete or rewrite pre-existing data to satisfy a check, and stop when a repair
round leaves every failing check unchanged. On this run repairs bought +0.018 partial credit per task, no new pass, one lost
pass, three broken graded assertions and at least 10 tasks with ungraded duplicate side effects.

## Per-task appendix

Letters: fix that would remove the wrong verdict (A typed effect, B observable, C literal hygiene, D negative compile, E literal completeness, F ledger scope/precedence, G ungraded inventions, H advisory ignored, I convention, J policy recall, R repair idempotency). "FA-full" = a check on the asserted entity passed a failing world; "FA-partial" = only a weaker check covered it; "caught-hard" = a hard check failed it but repairs did not fix it.

| # | Task | r0 grade (pc) | final grade (pc) | termination | rounds | hard checks FR @r0 (fix) | failing assertions: class (fix) | repair rounds that changed the world |
|---|---|---|---|---|---|---|---|---|
| 0 | sales.chatgpt_lead_summary_generator | PASS (1.00) | PASS (1.00) | only advisory checks fail | 0 | – | – | 0/0 |
| 1 | sales.qualify_lead | fail (0.80) | fail (0.80) | all checks pass | 0 | – | 1× FA-full (F) | 0/0 |
| 2 | sales.soft_matching | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 1×A | – | 2/2 |
| 3 | sales.docusign_sequential_signing | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 1×C, 1×A | – | 1/2 |
| 4 | sales.advance_opportunity_stage | fail (0.80) | fail (0.80) | all checks pass | 0 | – | 1× FA-full (F) | 0/0 |
| 5 | sales.vendor_review_prep | fail (0.86) | fail (0.86) | max repair rounds reached | 2 | 2×D | 1× missing (E) | 0/2 |
| 6 | sales.competitive_displacement_outreach | fail (0.53) | fail (0.53) | only advisory checks fail | 0 | – | 5× caught-advisory (H), 3× FA-partial (E) | 0/0 |
| 7 | sales.zoom_meeting_followup | fail (0.75) | fail (0.75) | max repair rounds reached | 2 | 2×A | 2× FA-full (F) | 1/2 |
| 8 | sales.partnership_contract | fail (0.25) | fail (0.25) | all checks pass | 0 | – | 1× FA-partial (E), 1× FA-full (E+F), 2× FA-full (F), 2× missing (J) | 0/0 |
| 9 | sales.chatgpt_proposal_customization | fail (0.20) | fail (0.20) | max repair rounds reached | 2 | – | 12× caught-hard (A), 3× missing (J), 1× caught-advisory (-) | 0/2 |
| 10 | marketing.linkedin_company_update | fail (0.80) | fail (0.60) | max repair rounds reached | 2 | 1×A | 1× missing (R), 1× caught-advisory (A) | 2/2 |
| 11 | marketing.win_loss_analysis | fail (0.69) | fail (0.69) | all checks pass | 0 | – | 5× FA-partial (E) | 0/0 |
| 12 | marketing.customer_story_intake | fail (0.67) | fail (0.67) | all checks pass | 0 | – | 1× missing (I) | 0/0 |
| 13 | marketing.customer_feedback_aggregation | fail (0.97) | fail (0.97) | only advisory checks fail | 0 | – | 1× missing (E) | 0/0 |
| 14 | marketing.engagement_optimization | fail (0.45) | fail (0.45) | max repair rounds reached | 2 | 1×C | 1× FA-partial (E), 3× FA-full (F), 2× missing (D) | 0/2 |
| 15 | marketing.social_contest | fail (0.75) | fail (0.88) | max repair rounds reached | 2 | 5×C | 1× missing (J) | 1/2 |
| 16 | marketing.community_engagement | fail (0.73) | fail (0.73) | all checks pass | 0 | – | 3× FA-partial (E) | 0/0 |
| 17 | marketing.featured_snippet | fail (0.50) | fail (0.50) | all checks pass | 0 | – | 2× FA-full (F) | 0/0 |
| 18 | marketing.customer_milestone | fail (0.88) | fail (0.88) | max repair rounds reached | 2 | 2×D, 1×C | 2× FA-partial (E) | 2/2 |
| 19 | marketing.social_content_calendar | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 1×C | – | 1/2 |
| 20 | operations.parking_allocation_management | fail (0.77) | fail (0.77) | max repair rounds reached | 2 | 2×C | 3× FA-partial (E) | 0/2 |
| 21 | operations.zoom_dr_drill | fail (0.86) | fail (0.86) | max repair rounds reached | 2 | 2×C, 3×B | 1× caught-hard (B) | 2/2 |
| 22 | operations.cross_training_assignment | fail (0.86) | fail (0.86) | max repair rounds reached | 2 | 2×B | 1× missing (D) | 2/2 |
| 23 | operations.loading_dock_scheduling | fail (0.75) | fail (0.75) | all checks pass | 0 | – | 2× missing (F), 1× FA-full (F) | 0/0 |
| 24 | operations.docusign_contractor_offboard | fail (0.80) | fail (0.80) | max repair rounds reached | 2 | 2×A, 1×B | 1× FA-partial (E) | 2/2 |
| 25 | operations.zoom_training_setup | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 1×C, 2×B | – | 2/2 |
| 26 | operations.overtime_threshold_monitoring | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 4×A | – | 1/2 |
| 27 | operations.calendar_airtable_maintenance | fail (0.00) | fail (0.00) | max repair rounds reached | 2 | – | 1× caught-hard (B), 1× caught-advisory (-) | 2/2 |
| 28 | operations.invoice_shipping_trigger | fail (0.67) | fail (0.67) | max repair rounds reached | 2 | – | 2× caught-hard (B) | 2/2 |
| 29 | operations.asana_safety_walk_log | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 1×B | – | 2/2 |
| 30 | support.intercom_reactivation_campaign | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 4×A | – | 0/2 |
| 31 | support.intercom_zoho_customer_360 | fail (0.65) | fail (0.65) | max repair rounds reached | 2 | 5×C | 7× missing (D), 2× missing (J) | 0/2 |
| 32 | support.intercom_demo_scheduling | fail (0.55) | fail (0.74) | max repair rounds reached | 2 | 6×A | 6× missing (J), 1× FA-partial (E), 1× missing (F) | 2/2 |
| 33 | support.intercom_sentiment_escalation | fail (0.56) | fail (0.56) | max repair rounds reached | 2 | 6×A | 3× missing (J), 3× missing (F), 1× FA-partial (E) | 2/2 |
| 34 | support.gorgias_quality_audit | fail (0.89) | fail (0.89) | all checks pass | 0 | – | 2× FA-partial (E) | 0/0 |
| 35 | support.reamaze_cross_platform_dedup | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 8×A | – | 0/2 |
| 36 | support.helpcrunch_usage_alerts | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 8×B, 5×A, 1×C, 3×G | – | 2/2 |
| 37 | support.intercom_multi_product_routing | PASS (1.00) | fail (0.94) | max repair rounds reached | 2 | 1×F, 10×A | 1× FA-full (F) | 2/2 |
| 38 | support.helpcrunch_zoho_desk_bridge | fail (0.82) | fail (0.82) | max repair rounds reached | 2 | 13×C | 3× missing (J) | 2/2 |
| 39 | support.hiver_mailbox_audit | fail (0.94) | fail (0.94) | all checks pass | 0 | – | 1× FA-partial (E) | 0/0 |
| 40 | finance.vendor_payment_approval | PASS (1.00) | PASS (1.00) | all checks pass | 1 | 3×C | – | 1/1 |
| 41 | finance.bad_debt_writeoff | fail (0.71) | fail (0.71) | only advisory checks fail | 0 | – | 1× missing (J), 1× caught-advisory (H) | 0/0 |
| 42 | finance.vendor_1099_prep | fail (0.57) | fail (0.57) | all checks pass | 0 | – | 3× FA-full (F) | 0/0 |
| 43 | finance.forex_gain_loss | PASS (1.00) | PASS (1.00) | all checks pass | 0 | – | – | 0/0 |
| 44 | finance.project_profitability | fail (0.83) | fail (0.83) | all checks pass | 0 | – | 1× FA-full (D) | 0/0 |
| 45 | finance.budget_variance_analysis | fail (0.83) | fail (0.83) | all checks pass | 0 | – | 1× FA-partial (D) | 0/0 |
| 46 | finance.travel_advance_settlement | PASS (1.00) | PASS (1.00) | all checks pass | 1 | 1×C | – | 1/1 |
| 47 | finance.ap_aging_report | fail (0.20) | fail (0.50) | all checks pass | 1 | – | 2× FA-partial (E), 1× FA-full (D) | 1/1 |
| 48 | finance.capex_approval | fail (0.67) | fail (0.67) | all checks pass | 0 | – | 1× missing (F) | 0/0 |
| 49 | finance.quarterly_tax_estimate | fail (0.67) | fail (0.67) | all checks pass | 0 | – | 1× FA-partial (E) | 0/0 |
| 50 | hr.anniversary_recognition | PASS (1.00) | PASS (1.00) | all checks pass | 0 | – | – | 0/0 |
| 51 | hr.visa_expiry_tracking | fail (0.43) | fail (0.43) | max repair rounds reached | 2 | 1×D | 1× FA-full (F), 1× missing (F), 2× FA-partial (E) | 0/2 |
| 52 | hr.monday_onboarding_pipeline | fail (0.25) | fail (0.50) | max repair rounds reached | 2 | – | 2× caught-hard (B) | 2/2 |
| 53 | hr.candidate_rejection_followup | PASS (1.00) | PASS (1.00) | all checks pass | 0 | – | – | 0/0 |
| 54 | hr.employee_request_routing | PASS (1.00) | PASS (1.00) | all checks pass | 0 | – | – | 0/0 |
| 55 | hr.referral_bonus_tracking | PASS (1.00) | PASS (1.00) | all checks pass | 0 | – | – | 0/0 |
| 56 | hr.recruitment_channel_roi | PASS (1.00) | PASS (1.00) | all checks pass | 0 | – | – | 0/0 |
| 57 | hr.equipment_provisioning | fail (0.83) | fail (0.83) | max repair rounds reached | 2 | 6×B | 1× missing (F) | 2/2 |
| 58 | hr.salary_adjustment_processing | PASS (1.00) | PASS (1.00) | max repair rounds reached | 2 | 1×D | – | 0/2 |
| 59 | hr.disciplinary_action_tracking | PASS (1.00) | PASS (1.00) | all checks pass | 0 | – | – | 0/0 |