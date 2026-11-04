---
name: ticket-triage
description: Label a support ticket with the house taxonomy (billing, bug, question, refund).
metadata:
  owner: fixture-owner
---
# Ticket triage (fixture)

Pick exactly one label:
- refund: the customer asks for money back, or mentions a cancellation with a charge.
- billing: a charge, invoice or payment is wrong, but no money back is requested (double charges are billing).
- bug: the product misbehaves.
- question: anything else.
Set the label with the ticket tool; never close a ticket while triaging.
