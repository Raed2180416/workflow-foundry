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

