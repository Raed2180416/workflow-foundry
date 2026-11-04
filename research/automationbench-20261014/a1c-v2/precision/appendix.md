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