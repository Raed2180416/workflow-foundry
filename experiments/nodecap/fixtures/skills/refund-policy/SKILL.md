---
name: refund-policy
description: Compute the refund owed on a cancelled subscription from the house proration table. Use when a ticket asks how much a customer gets back.
license: Proprietary (fixture)
metadata:
  owner: fixture-owner
  version: "3"
---
# Refund policy (fixture)

1. Find the plan and the number of unused days in the ticket.
2. Read `references/RATES.md` (skill.read with reference "references/RATES.md") for the plan's daily rate.
3. Refund = unused days x daily rate, minus the plan's fixed cancellation fee from the same table.
4. Never refund more than the price of one billing period. Round to cents, half up.
5. Answer with the amount only; do not promise a payout date.
