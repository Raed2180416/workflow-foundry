# Outcome contracts across registry changes

Worker-4, 2026-09-17. Source-only review of the frozen outcome coordinator and its
product CLI. I authored those modules; this is an author design review, not an
independent qualification. No product edits, workflow execution, test reruns,
provider calls, inference calls, or hidden benchmark reads were performed for
this review. The only new file is this NOTE.md. Source locations below are relative
to `/home/raed/Projects/workflow-foundry`.

The preceding CLI handoff is complete: `../outcome-cli-20260917/NOTE.md` and
`FREEZE.json` exist, and their current hashes and the three product-file hashes
match that handoff. Its accepted tests remain historical evidence; this review
does not add a new test result.

## Finding and exact scope

Adding a valid, otherwise unused capability changes the complete registry digest.
With unchanged original run, artifact bytes, expectation, observer and existing
capability implementations, the current outcome coordinator then refuses
verification and same-goal repair through that changed registry. It also refuses
to register the same root/input/artifact expectation under the new registry.

However, it does **not** erase or rewrite the old contract or receipt.
`contract(id)` remains readable when the observer identity is unchanged;
`receipt(id)` still checks its own content and preserved artifact bytes. Thus
“every old receipt is invalidated” overstates the behavior. The precise finding
is that the current-world registry equality gate blocks semantic re-verification
and operational reuse of old receipts. The stored historical statement survives.

`CapabilityRegistry.register` hashes the handler's function text and stores the
descriptor; `hash()` digests the entire name-sorted descriptor list
(`src/capabilities.mjs:10-35`). Adding one valid unique name changes that list
and, under the normal collision-resistance assumption, its hash. No handler
execution is required by `register` itself.

Let R0 be the original registry hash and R1 the hash after adding the unused
capability. The contract contains R0 (`src/outcome-repair.mjs:100-110`), and its
run and creation event retain R0 (`src/store.mjs:92-107`). The decisive condition
requires both:

```text
run.registryHash == contract.registryHash
current foundry.registry.hash() == contract.registryHash
```

These are separate conjuncts at `src/outcome-repair.mjs:140-142`. For a historical
run under R0, the first still passes and the second fails under R1. The error is
`OUTCOME_CONTRACT_BINDING`, before artifact comparison.

This is already an explicit existing test case: the test titled “registry
implementation drift invalidates observation bindings” registers `audit.unused`
and expects repair refusal (`tests/outcome-repair.test.mjs:383-388`). Its operation
is an unused addition, not replacement of a used implementation. I inspected the
test source; I did not run a new witness.

| Operation under R1, using otherwise intact R0 evidence | Source-derived behavior |
| --- | --- |
| `contract(oldId)` | Returns the original contract; its checks concern stored digest and observer identity, not the current registry (`:121-127`). |
| `receipt(oldId)` | Returns the preserved receipt after checking its digest and, for present artifacts, saved byte length/hash; it does not independently replay the assessment or the event chain (`:279-289`). |
| `observe(oldRun, oldContract)`, including a repeated observation | Refuses `OUTCOME_CONTRACT_BINDING`; binding is checked before existing-receipt lookup (`:262-269`). |
| `verify(oldReceipt)` | Refuses the same error via `#binding` (`:292-299`). |
| `requestRepair(oldReceipt)` | Refuses before repair lookup, including an otherwise idempotent repeat (`:317-330`). |
| Existing repair's context, proposal or application | Refuses through `#repairRecord -> verify` and `#currentRepair` (`:303-313`, `:351-354`, `:381-422`). |
| Same root/input/artifact re-registration under R1 | Refuses `OUTCOME_CONTRACT_CONFLICT`: the body changes but the unique scope does not (`:106-116`). |
| New run created under R1, assessed against the R0 contract | Refuses because the run itself has R1; removing only the current-registry conjunct cannot fix this (`:140-142`). |

The table applies to contracts bound to R0 in the changed coordinator context,
not to unrelated contracts already bound to R1. It is not permanent destruction:
an unchanged observer with an original-registry context still has the original
bindings. Other defects can produce earlier errors; the table holds the other
bindings fixed.

The CLI forwards all outcome operations to these methods and rejects ordinary
`propose`/`apply`/`prompt`/`generate` for an outcome repair
(`bin/foundry.mjs:165-217`). The refusal is therefore user-visible in the supported
CLI path. Bypassing it with a direct library call would not constitute a repaired
outcome qualification.

## Historical facts and future execution answer different questions

For a present, bound artifact, the bounded historical predicate is: the bytes B
preserved from this particular terminal run, decoded and checked using frozen
observer O, equal frozen expected JSON E. Its comparison depends on B, E and O,
not today's list of unrelated callable capabilities. The implementation reflects
this: `#assessment` has no registry lookup (`src/outcome-repair.mjs:250-259`),
while observer identity binds this module, `data.mjs` and Node version
(`:10-15`, `:121-126`). Root, input, artifact name, exact run/proposal/workflow,
policy, engine and event bindings remain necessary to attribute the predicate to
the requested historical execution (`:130-158`).

There are four useful statements to keep distinct:

1. The saved receipt and preserved bytes are intact. The existing `receipt()`
   supplies this limited check.
2. The historical assessment follows from the frozen expectation, bytes and
   recorded execution evidence. The current API has no separate full historical
   verifier that removes only dependence on the live capability catalog.
3. The current filesystem still agrees with the preserved observation. This is
   an additional observation, and can become unavailable or contradict history.
4. A future candidate may be applied or executed under the present environment,
   and its new run satisfies the requested outcome. History alone establishes
   neither authorization nor this future outcome.

For the stipulated inert registry addition, rejecting statement 2 solely because
R1 differs from R0 is unnecessary coupling. Preserving statement 2 must not be
reported as statement 4. A historical unsatisfied outcome can remain useful
repair evidence while current execution remains unqualified.

Live-byte requirements should not disappear as an incidental consequence of this
distinction. This task holds the live artifact fixed. A historical mismatch can
remain true even after its live file disappears, but the current adapter correctly
blocks repair when evidence cannot be reverified. Any future change to that repair
rule is a separate decision. Required-file absence is also time-scoped evidence,
not an eternal property or the same thing as observer unavailability.

Future execution must bind the environment actually used. `Runtime.create` stores
the current registry, policy and engine identity (`src/runtime.mjs:35-51`);
execution checks the registry and, for nonterminal execution, the engine pin
(`:135-147`). The current full-registry refusal is a conservative compatibility
gate. Do not relax it for pending/resumed runs as part of a historical-read fix.
An old run's world must never be relabeled as R1 merely to make a check pass.

Full registry equality is not a mathematical prerequisite for evaluating a new
run's own artifact against the same semantic expectation. It is the current
contract's strict environment rule. A deliberate future contract design can keep
the same semantic expectation while separately binding each new run's complete
world. That requires explicit semantics and fresh evidence, not interpreting an
old strict contract differently without recording the change.

## Smallest defensible design direction

Keep this release frozen. The first prospective change to examine is a separate
historical assessment verifier. It would check the original contract and receipt
digests, exact request/root/proposal/workflow/input bindings, historical registry
and engine identifiers, the full event chain, and the frozen observer's comparison.
It would return the current registry mismatch separately as lack of current
qualification. It must preserve the distinction between record integrity,
historical assessment and live artifact availability. It would not grant apply,
execution or model dispatch by virtue of returning a historical result.

Such a result should be an append-only historical audit with its own identity and
type, outside the existing repair-receipt namespace. It must not be inserted as an
ordinary `outcome_observations` receipt that `requestRepair` could consume, and
must not be accepted as a promotion permit. Preserve the current repair and CLI
checks. A later audit that finds a different interpretation would itself be a
new record with explicit grounds, not an overwrite of the old observation.

Opening repair across registry changes would require a second explicit design.
The existing immutable contract includes R0 and its unique scope prevents an R1
replacement. Do not overwrite that row, alter old receipts, or create a fresh root
task to hide the environment change. An append-only transition/assessment record
could reference the original contract and exact old evidence, the actual new
registry, and the unchanged root, input, expected JSON and observer. A distinct
contract/assessment version would state the revised applicability rule. A recorded
assertion that an extension is “safe” is insufficient; compatibility claims need
the compared dependency material and defined checks, with uncertainty retained.

Repair creation and design would still require an observed unsatisfied result,
the current workflow base, parent/root continuity, fixed goal/success criteria,
bounded depth, and explicit host initiation. An unsatisfied result is evidence to
investigate a cause, not proof of which node is wrong or that the expectation is
independently correct. Current catalog exposure must be explicitly bound in the
new design context. A newly permitted candidate can introduce capabilities that
the old run never used, so candidate validation and authority review must concern
that candidate and the new environment.

Before application, retain evidence verification, exact candidate/request binding,
intent checks and version CAS, with current-environment qualification kept separate.
Before claiming repaired success, require explicit execution and an observation
bound to the new run and its actual registry/policy/engine. Existing static
validation/application is not an automatic guarantee of this broader promotion
property: `Foundry.propose/apply` validate against the current registry
(`src/foundry.mjs:47-54`), and Store preserves workflow/version/intent and CAS
(`src/store.mjs:282-320`); they do not themselves establish new task success.
The generator's optional evaluator checks an exact candidate/current registry
pair (`src/generator.mjs:64-75`). Keep those checks; historical truth must not
silently substitute for a new evaluator receipt.

Per-dependency compatibility is therefore an optional later justification for
reuse. It is not needed to preserve the truth of a bounded old JSON comparison,
and it must not become a prerequisite for admitting that a historical defect
exists. Conversely, preserving that defect does not establish compatibility.

## Counterexamples to plausible narrower scopes

These are source-grounded design counterexamples, not newly executed experiments.
They limit future compatibility and promotion claims unless explicitly stated
otherwise; changes to present code do not retroactively alter preserved old bytes.

| Proposed shortcut | Counterexample and consequence |
| --- | --- |
| Depend only on `core.artifact` | An unchanged writer receives different content from changed `core.json`, aggregate, or an external upstream observation. The old byte comparison remains meaningful; carrying forward workflow correctness does not. Current runtime resolves task arguments and validates/dispatches the selected capability (`src/runtime.mjs:295-325`). |
| Depend only on tools executed in the old trace | A v2 repair fixes a guard, makes a previously empty map nonempty, or adds the missing artifact write. It now reaches a tool absent from that trace. Static nested definitions and the new candidate matter (`src/runtime.mjs:245-248`, `:266-291`; `src/validate.mjs:110-121`). A no-output defect is an especially clear case: no producer dependency does not mean the eventual writer is irrelevant. |
| Depend only on tool names or handler text | Keeping `execute` unchanged while changing `requiresEvidence`, freshness, approval, risk, cost, cancellation or schemas changes valid/authorized execution. The runtime uses these declarations (`src/runtime.mjs:295-338`, `:361-382`); the validator also uses effects, timeout and evidence requirements (`src/validate.mjs:76-82`, `:113-116`). Existing test source changes only evidence freshness and expects paused-run refusal (`tests/evidence-contract-audit.test.mjs:374-382`). |
| Treat equal full descriptors and handler hashes as semantic proof | `handlerHash` hashes `execute.toString()` (`src/capabilities.mjs:30`). Two instances of a handler that captures an offset can have identical function text/metadata but different captured offsets. A live closure can also change without registration. Remote server behavior can change while its advertised version/schema stays fixed. Even the full registry hash cannot prove those semantics; narrower hashing cannot cure that limitation. |
| Treat an unused MCP addition as an inert registration | Component loading connects processes before registration; they retain ordinary user OS permissions. Every selected external capability's implementation digest includes the full manifest hash (`src/components.mjs:64-100`). Adding a server or another selected tool can therefore change old external descriptor identities as well as process/environment behavior. This is not the same intervention as directly registering a fresh inert function. |
| Preserve old input/output behavior and ignore current authority/catalog exposure | A newly constructed runtime derives default allowed capabilities from the complete low-risk catalog (`src/runtime.mjs:35-44`), and model design context includes the entire catalog (`src/foundry.mjs:124-135`). An unused added capability can change the next model's choices and the new runtime's authority surface. Adding after an existing Runtime was constructed does not recompute that object's policy, but a later constructor can differ. Claims that the whole future world is unchanged need this distinction. |
| Depend only on target-file producer events | If the run produced `different.json` and its entire artifact directory later disappears, there may be no target-file producer, but there is evidence of namespace loss. The observer uses all completed artifact producers to distinguish that from confirmed required-file absence (`src/outcome-repair.mjs:165-194`). Dropping non-target producer events can turn unknown integrity loss into fabricated unsatisfied evidence. This directly affects the historical attribution/absence boundary. |
| Keep semantic JSON value/hash and discard exact run, byte or observer bindings | The same JSON can be planted, taken from another run, or parsed under different semantics. Present files require a matching completed producer and exact byte length/hash (`src/outcome-repair.mjs:235-240`), and observer identity/strict UTF-8/data limits are part of interpretation (`:10-30`). Equal JSON alone proves neither origin nor the original observation. |

Dependencies can also be transitive or negative. A capability may read shared
state or retain a reference to the registry in its closure, so “not directly named
by the workflow” does not prove its addition is irrelevant. A consumer's evidence
source is a dependency even when it does not compute the artifact's data value.
Only a justified closed envelope supports a reduced compatibility scope.

The necessary historical descriptor material may also be missing. The inspected
outcome contract, run creation record and tool-intent event store aggregate
registry identity, not a complete per-capability registry snapshot
(`src/outcome-repair.mjs:106-109`; `src/store.mjs:92-107`;
`src/runtime.mjs:316-325`). A full old catalog captured elsewhere and verified
against R0 could support a comparison; its availability must be established.
One cannot derive an authenticated old dependency subset from R0 and today's
registry. A generation context can contain a catalog, but these workflows need
not have been generated through that path. A historical byte audit therefore
must not claim it has established old-versus-new used-tool semantic equivalence
or remote implementation attestation merely by checking the old receipt.

Engine/source identity is a separate axis: `src/engine.mjs:9-15` hashes whole
runtime, Store, capability, dataflow, validator and schema files plus platform
details. Adding a capability by editing `capabilities.mjs` also changes the engine
identity in a new process. The proposed inert witness must use registration on an
unchanged source closure to isolate registry membership. Otherwise registry and
engine drift are confounded. The observer similarly hashes its entire module, so
even an unrelated observer-module edit changes its strict identity; this review
does not redefine observer compatibility.

## Bounded witness prediction for prime

With a present wrong artifact and preserved unsatisfied receipt under R0, add one
unique unused pure capability through registration, leaving files and the existing
Runtime policy alone. Expected from the inspected source: registry hash changes;
old contract/receipt retrieval remains available; historical `verify`, repeated
`observe`, and repair refuse `OUTCOME_CONTRACT_BINDING`; re-registering the same
expectation refuses `OUTCOME_CONTRACT_CONFLICT`. None of these refusals should
change old run bytes, run status, event head or existing receipt bodies. A new
run under R1 cannot be observed under the strict R0 contract. These are predictions
for a separately owned witness, not measurements made here.

The useful next boundary is therefore precise: preserve inspectable historical
outcome evidence across an unrelated registry extension, while keeping any new
execution, compatibility and success claim explicitly qualified in its own world.
The current frozen release is conservative and blocks that operational bridge.

## Validation and source identities

Read-only source inspection, file hashes and existing handoff consistency checks
support this review. Serena `initial_instructions` was attempted and returned
HTTP 404 `tunnel_client_not_seen`; no semantic-tool or independent security pass
is claimed. No CodeGraph index, model call, witness, test execution or product
mutation was added. Prime's separate witness/review remains separate evidence.

SHA-256 identities observed for this review:

```text
d23b59d8d181f9d954463094a9e36bde2d4e7af859b629bf2b34ea4ae21816fb  bin/foundry.mjs
4f3cc76c49e6665b5f88f7dc17daa1835abd02d79747b1cf54f936b6f6e469ac  tests/outcome-cli.test.mjs
ebbda86e7c6d86641fe330574aac3e4e509515187aca03b58701e15ed155f56a  docs/OUTCOME-REPAIR.md
8de15af4b6ce842c3e54039531c651472a9079a231bf31390f4a8f95b924f1fd  src/outcome-repair.mjs
216692223b1f7c081e2a2909f5e28bac94f62a94898731887e5d94b8878e65f3  tests/outcome-repair.test.mjs
1707d4506f50e86498fa471dc3c8714615e6c06a1240014f2515aab58cc3ac49  src/capabilities.mjs
af9fcabde20f706fac8ce2e09c0e646c0f100b301b64d1f6e1e4eb77e0b213db  src/runtime.mjs
6872eecabd6e4ccce58b7db25df82b1a97a292e530e0c38090e15844d5d7ed52  src/engine.mjs
200310319ed0e9026b02e62c4fe36b9bd1023de21f04d84046a1e5c478d66989  src/components.mjs
61288a25c85a8dd1e1e076ca5059aedf80c35dc26bf0ab613c31030743a34732  src/store.mjs
95f102573760ef92cd352813f66b30cd9f83bda05afb97a4cbe1069c8527a878  src/foundry.mjs
3d86d95eaf4a2b6ee83d5fb50696a689926075adae4eeb4d8c25450c442fb11a  src/generator.mjs
8b698d552e151f3380af58cbce5675b0a94c48601c9acd427be71281a3696c33  src/validate.mjs
50049ae8819aa022481faafb435f2887d94fa669ceef1b6375c8d4a664e7680c  src/data.mjs
3c19d6e54de507b19405f36d4dfb253da199f3a58a1b44d305bd994b6d90de8e  ../outcome-cli-20260917/NOTE.md
ccbdf7b2efb3fbc6ca1c5d9515c39c32a92e7671b57120eaae44270b4f0c13b4  ../outcome-cli-20260917/FREEZE.json
```

The last two paths are relative to this study, not the product root. The prior
CLI NOTE/FREEZE are complete and remain untouched.
