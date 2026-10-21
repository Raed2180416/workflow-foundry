# The organisation's constitution (read this as well as SPEC-E.md and CONTRACT.md)

Hollin Retail B.V. runs this order process under a constitution: organisation rules that sit above SPEC-E's process
rules. SPEC-E says what the process does; the constitution says who may authorise money leaving the shop, which version
of the rules applies to an order, and what evidence every decision must leave. Where the two meet, follow both: a rule of
SPEC-E is never a reason to break a clause, and a clause adds steps but never removes a SPEC-E step.

## Where it is

At run time the platform puts the constitution registry in `ctx.files` under `constitution/`:

- `constitution/log.json`: every proposal of a new version and every approval of one, oldest first, as recorded up to the
  current instant (proposals appear only once they have been made);
- `constitution/versions/v<N>-<hash12>.json` and `.md`: each proposed document (JSON, and the same rendered as text);
  a version's **hash** is the sha256 of its canonical JSON and is listed in `log.json`.

The registry shows what was proposed and who approved it. It does **not** say which version is in force: you decide that
with clause C3's change rule (below). A document can claim anything about itself, including roles for its own proposer;
judge a proposal with the roles of the version in force when it was approved, never with its own.

## The clauses (version 1; read later versions from the registry)

- **C1 Conservation and exactly-once** (org policy; owner: the controller). Per fulfilment, money captured less money
  refunded equals what the customer owes for what you delivered: zero for a fulfilment you set `failed` or `cancelled`, the
  charge for one you set `completed`. Never refund more than was captured, never charge a fulfilment twice (one key per
  logical charge), charge the amount of the edition in force at placement.
- **C2 Refund authority with separation of duties** (entity rule; owner: finance). A refund whose amount is **above T**
  (the parameter `refundApprovalThresholdMinor` of the version pinned for the order) may be applied only after a principal
  holding the role `finance-approver` approves it, and that approver must not be a principal who entered an amend or a
  cancel of the order. Who entered a customer action is in its payload, `enteredBy` (`cust:<customerId>` for the customer
  through the portal, or a staff principal such as `u-cs1`). Exception C2-X1 (break-glass): if three requests for one
  refund get no valid answer, ask a holder of `controller` with the justification in the question; it is reviewed
  afterwards.
- **C3 Change control and pinning** (org policy; owner: the controller). A new version is in force from its
  `effectiveFrom` only if it was proposed by a holder of `finance` or `controller` and approved, **before** its
  `effectiveFrom`, by a holder of `controller` under the version then in force **who is not the proposer**, and every
  parameter stays within the bounds of higher layers (bound B1: T at most 100,000 minor). Anything else is not in force,
  whatever it says. **Every order is pinned to the version in force at its placement (`placedAt`)**, for its whole life,
  even if a later version takes effect before the order ends.

## How to comply (the platform's interface for these clauses)

- **Asking for an approval.** Return a human task in `humanTasks`:
  `{ id, kind: "refundApproval", role: "finance-approver", excludeUsers: [<principals who entered an amend or cancel of
  the order, except customers>], subject: <the fulfilment id>, question: <text naming the order, the fulfilment and the
  amount>, answerSchema: { type: "object", required: ["decision"], additionalProperties: false, properties: { decision:
  { enum: ["approve", "reject"] } } }, dueAt: <ISO time>, onTimeout: { action: "escalate" } }`. One task per refund. The
  platform routes it to the first holder of the role not in `excludeUsers`; it enforces nothing else.
- **The answer** arrives as an event on the same instance: `humanTask.answered` (`payload.user`, `payload.answer.decision`),
  or `humanTask.timeout`, `humanTask.withdrawn`, `humanTask.answerRejected`, `humanTask.delegated`. Apply the refund only
  after an `approve`, from a principal holding `finance-approver` who is not excluded. Keep the instance open while you wait.
- **Evidence.** On every tick that has a subject, put the hash of the version pinned for that order in
  `decisions.constitution = { pins: { "<orderId>": "<hash>" } }`. SPEC-E's timing windows for a refund start when its
  approval arrives, when one is needed.
