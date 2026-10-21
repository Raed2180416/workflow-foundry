# Site test fixtures

Synthetic files written for the onboarding journeys on 2026-10-21. Every name, address and amount is invented; the
domains are under `.example` (RFC 2606), so nothing can reach a real mailbox.

| File | What it exercises |
|---|---|
| `invoices-accounting-export.csv` | the P2 reference journey: an accounting export with extra columns, a quoted amount with a thousands comma, and day-first dates that are all ambiguous (both parts at most 12), so Foundry must ask the date order. Read day first on 2026-10-21, three invoices are due a reminder and one (INV-2046, 8 November) is not due yet; read month first, INV-2046 would get a final notice. |
| `invoices-odd-statuses.csv` | statuses that are not open/paid/disputed ("Overdue", "Part paid", "Sent"): Foundry must ask which mean "still open" |
| `invoices-all-paid.csv` | nothing to chase: the test passes with zero reminders |
| `refunds-no-receipt.csv` | the P3 walkthrough's refunds export (added 2026-10-21 after the walkthrough): no receipt, category or description column, headers that are not Foundry's words. Foundry must match the columns, say that without a receipt column every claim goes to the approver, and never call this a match for a refund card it does not have. |
| `n8n-synthetic.json` | a small n8n workflow written by us (webhook, a field mapping, an HTTP call, an e-mail send) for the import page |
| `managed/etc-claude-code/` | a stand-in managed Claude Code policy folder for the IT persona (`FOUNDRY_MANAGED_DIR`) |
