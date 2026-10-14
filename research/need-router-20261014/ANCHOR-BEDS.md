# Need-router anchor beds (2026-10-14, reviewed)

Routing anchors for the need-router benchmark (DESIGN.md §4.3): the negative class (tasks where one call should be enough) and
shortcut-breakers. They are not Tier-A beds (the bed contract's "a 20-line script must not solve it" rule is waived on purpose;
each README says so) and every class label below is a hypothesis until the label factory measures it.

| bed | what one task is | intended class (hypothesis) | tests | review |
|---|---|---|---|---|
| `need-qa` | short exact-match question: aggregate, two-table lookup, fictional-calendar date arithmetic, unit conversion | one call | 24 | clean |
| `need-constraint` | one-off generation checked by constraints: names, a sentence, an ordering, a schedule (any valid answer passes) | one call | 26 | minors open: sentence comma form stricter than the prompt; names trimmed before checking |
| `need-stage` | one stage of a W-bed rung (R1 normalise one list, R2 route one document, R3 classify one difference, R6 one worker slice) with the rung's rules text | one call despite a workflow-like surface | 19 | minors open: nested record schemas accept extra keys |
| `need-r0pad` | wbed-r0's task plus 10–20 irrelevant documents (15–25K tokens) | one call (length without structure) | 36 | clean |
| `need-r3mini` | wbed-r3 restricted to 2–3 statements | one call (structure without length) | 23 | clean |
| `need-codefix-noverifier` | codefix with every visible test removed | agent, but without a verifier | 23 | 2 minors open |
| `need-nospec-records` | records with the rules removed; k solved examples instead | exploratory: build-from-examples vs clarify | 26 | clean |

Build and review: workflow `need-router-anchor-families` (26 agents: builder, adversarial verifier, fixer per bed; no blocker or
major open). Metamorphic pairs: need-r0pad vs wbed-r0 (same core task, longer input) and need-r3mini vs wbed-r3 (same rules,
smaller): a router that follows length rather than structure routes these pairs differently.
