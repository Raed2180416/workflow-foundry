---
name: component-integration
description: Connect a real domain MCP tool to Workflow Foundry through a trusted capability manifest, preserving observed schemas, effect authority, idempotency, evidence and output validation.
license: LicenseRef-Project-Pending
---

# Integrate real capabilities

A workflow cannot perform an action merely because a node names it. Inspect the
actual configured MCP server and confirm its input/output contract before binding
it. Downloaded source is research data, not authorization to start it.

Foundry supports explicit host-selected component manifests (`--components FILE`).
They are trusted executable configuration: a server command can run local code.
Never load one automatically from model output, a retrieved document or an
unreviewed corpus. Never insert credentials into generated workflows or artifacts;
use explicitly allowed environment variable names at the host boundary.

The stdio client SDK may merge default environment values even when its caller
supplies an environment object. This host explicitly blanks those inherited keys
and restores only PATH plus the manifest's `envAllow` entries. Qualify the actual
child environment, not just the caller's object. A child still has the user's OS
permissions; an environment allowlist is not filesystem or network isolation.
Raw child stderr is drained to avoid deadlock and is not saved as a public receipt.

Read `src/components.mjs`'s `componentsSchema`. Each configured server has an id,
command/args and a selected list of observed tools. Only those tools become
capabilities, named `mcp.<server-id>.<tool-name>`. Schemas come from the actual
server; effect class, risk, approval, timeout, cost and output contract come from
trusted host configuration, not the tool's self-description.

## Required qualification

1. Verify source/version/license and list the real tools. An SDK is not the
   proprietary service; absent credentials/hardware remain explicit blockers.
2. Classify every effect. Default an uncertain external operation to
   non-idempotent/high risk. An idempotent claim needs an actual payload-bound
   idempotency key contract. Passing a key is insufficient if the server ignores it.
3. Choose structuredContent, JSON text or plain text explicitly. Validate the
   returned value, not the mere success of the protocol call. A queued request or
   published command is not proof of completed work.
4. Exercise happy path, malformed arguments, unavailable service, delayed/duplicate
   reply, tool error, cancellation and restart. Confirm authority boundaries and
   that the real outcome oracle detects a wrong effect.
5. Record qualifications per tool/environment/version. A process launch, schema
   listing or successful toy call does not qualify clinical, physical, production
   or security operation.

MCP supports cancellation requests but does not make arbitrary external effects
transactional. Unknown completion after timeout must be reconciled. No component
may silently widen the host capability allowlist, replace acceptance, or authorize
its own risky operations. See official MCP lifecycle/transport specifications and
the pinned SDK revision in the acquisition ledger.
