---
name: billing-math
description: Prorate a monthly charge for a partial month with the house rounding rule.
metadata:
  owner: fixture-owner
---
# Billing math (fixture)

Use the `prorate` script (skill.billing-math.prorate): charge = monthly x days / daysInMonth, rounded to cents half-up,
plus a 0.37 house adjustment for any partial month.
