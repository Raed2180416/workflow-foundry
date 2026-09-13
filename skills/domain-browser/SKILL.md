---
name: domain-browser
description: Build verifiable browser and desktop automation workflows for navigation, extraction, forms, uploads, downloads and multi-page interactions. Use when a task requires grounding actions in live page state, handling stale elements and human takeover, or proving an external effect occurred exactly as intended.
metadata:
  version: "0.1.0"
  evidence-date: "2026-09-13"
---

# Browser workflow construction

Build around observed page state and independently checkable outcomes. Read [source-derived constraints](references/evidence.md) when choosing action batching, caching, recovery and judges. A successful click or a generated completion message does not establish the requested outcome.

## Define the target and acceptance

Resolve the authorized site, account/session, tenant, tab and task. Specify which domains, filesystem destinations and effects the host permits. Obtain credentials through the host's existing mechanism; never put credentials, cookies or recovery codes in a workflow, prompt, screenshot log or generated skill. Raw JavaScript, CDP, shell, upload and HTTP capabilities require separate host policy even when exposed through one browser tool.

Define acceptance before selecting actions. Extraction requires a schema plus evidence of page/record provenance and coverage, including pagination. A download requires the expected artifact, complete bytes and an identity/content check. A form submission requires the resulting record or receipt and relevant submitted values. A reservation, purchase, send or destructive change needs target-side confirmation and an operation identity where supported. A screenshot can support visible-state claims but cannot prove an unseen transaction committed.

Record the supported environment: browser/profile, authentication assumptions, permitted origins, viewport if relevant, frame/shadow-DOM support, output destinations, limits on pages/items/time/cost, and escalation route. State unsupported environments explicitly. An inaccessible page, bot challenge or missing authenticated session is a blocked prerequisite; do not manufacture a bypass or success result.

## Observe, act and verify

Create an initial observation with tab/frame identity, URL, relevant accessible/DOM content and screenshot when visual grounding is required. Every action names a target and the observation on which it depends. Prefer stable semantic locators that select the intended element uniquely. Check current frame, focus, enabled state and destination before effectful actions.

Batch actions only while they share a stable page and target context. Navigation, tab/frame switch, modal replacement, ambiguous click outcome or material DOM change invalidates the remaining batch. Re-observe and replan. A stable URL alone does not imply stable DOM or account context.

Use a workflow of observe → select/resolve → act → verify, with explicit branches for known alternatives and bounded pagination/iteration. Include per-step deadlines and a total deadline; progress updates do not renew the total budget indefinitely. Skipped branches have no result. A failed iteration cannot inherit the last successful row, download or extraction.

Preserve `all_success` joins for steps requiring a successful guard or observation. A skipped or handled-error prerequisite must not release its dependent action. Use `all_resolved` only for an explicit recovery/alternative branch, checking the available outputs before selecting a new action.

For human intervention pause before the next effect, capture the current question and run identity, then validate the answer. Human takeover may change focus, navigation, content or session; always re-observe before resuming. A natural-language request to change the workflow creates a versioned proposal and new evidence requirements. Human answers and model text cannot grant tool privileges.

## Recovery and reuse

Classify stale locator, navigation timeout, session disconnection, policy denial, challenge, invalid data, budget exhaustion and uncertain effect separately. Refresh a stale observation once under a declared retry budget, then use a genuinely different supported strategy or stop. Do not loop on the same failed locator until the model expresses confidence.

Use cache/replay only with a recorded source identity, request parameters, schema, relevant page state and invalidation conditions. Recheck cached locators and verify the resulting state. Replaying the first action of a sequence and failing on the second may already have changed the site: reconcile before falling back to a fresh whole-sequence plan. Do not automatically retry a payment, send, deletion or submission after an ambiguous timeout.

An interrupted CDP/session operation may still finish. Distinguish cancellation requested, cancellation confirmed and effect unknown. Reconnect only after determining whether the same browser/session remains valid. Restored transport connectivity is not evidence that the previous task failed or that the tab is unchanged.

Load only the domain instructions and references required by the task. Start with a direct deterministic interaction when its target and behavior are known; use model planning or reflection for unresolved ambiguity. Additional planners, judges, screenshots and trajectory candidates must justify their cost in comparison runs. Persist compact evidence references instead of repeatedly injecting full histories.

## Falsify the workflow

At minimum test the relevant cases among: stale element after navigation; same URL with different tenant/content; iframe or new tab; missing optional versus required field; partial pagination; duplicate records; delayed download; session loss; human changes the page; action succeeds but reply is lost; challenge/blocked access; judge unavailable; malformed structured result; and an agent reporting success with an unmet target-side condition.

Freeze the oracle, starting session and task data, executor model, budgets and human assistance before comparisons. Keep self-report, model-judge verdict and deterministic/task-side oracle as separate fields. Judge failure is unknown, not pass. Report exposure of task cases during iteration. Reusable workflow status requires successful checks in the stated envelope, not a claim of coverage of every website or worst case.

## Required output

Return typed workflow nodes, allowed bindings, grounding and invalidation rules, completion oracle, retry/reconciliation policy, human pause points, budgets and unsupported cases. Include the evidence observed and what remains unexecuted. Public browser SDK code does not establish the behavior of a hosted browser service or private cache implementation.
