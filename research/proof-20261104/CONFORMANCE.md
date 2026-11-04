# Guarantees conformance: Foundry against LangGraph (2026-11-04, $0, no model calls)

**Evidence level: by construction.** These are executable attacks, run on this machine, not vendor claims. Each
property, its attack and its oracle are in `experiments/conformance/properties.json`.
- **Foundry side:** `experiments/conformance/run.mjs` runs Foundry's own attack test for each property; the result is
  `conformance-foundry.json`.
- **LangGraph side:** the same attacks, written against LangGraph's own recommended durability features:
  - the SQLite checkpointer for durable runs;
  - `interrupt()` and `Command(resume=…)` for human steps;
  - `recursion_limit` for bounds;
  - `Send` for fan-out.

  The script is `experiments/conformance/competitors/langgraph_attacks.py`, the result is `conformance-langgraph.json`,
  and the pinned environment is `experiments/conformance/competitors/langgraph.lock.txt`: langgraph 1.2.19,
  langgraph-checkpoint 4.3.1, langgraph-checkpoint-sqlite 3.1.3, langchain-core 1.7.5, wheels only, in a venv outside
  the repo. That venv was deleted after the run to free disk; the script's header gives the commands that rebuild it
  from the lock file.

| Property | Attack | Foundry | LangGraph 1.2.19 |
|---|---|---|---|
| P1 rejectable artifact | a workflow whose only check inspects nothing | **refused** (strict lint) | absent: `compile()` accepts it |
| P2 engine bounds | a loop that never exits | **enforced** | **native**: `GraphRecursionError` at `recursion_limit` |
| P3 no duplicated effect after a crash | process killed right after a node's side effect, then resumed | **once** (idempotent effects, main) | **twice**: the node re-ran on resume and paid again |
| P4 resume only under identical semantics | change the code of a paused run (pay ×1 became pay ×10), resume | **refused** (`ENGINE_DRIFT`) | **resumed silently under the new code: paid 1,000, not 100** |
| P5 tamper-evident record | edit a finished run's stored state (total 42 → 41) | **detected** (hash chain, outside anchors) | served `total = 41` with no error |
| P6 independent verification | a verifier of the producer's model family | **refused / re-picked** | not applicable: no verifier concept |
| P7 coverage proof | a fan-out reader drops a unit | **run fails its ledger gate** | run succeeds; unit `c` never read; nothing notices |
| P8 approval roles and segregation | the requester approves their own $50,000 refund | **refused** | accepted: `interrupt()` has no principal |
| P9 refusal without fallback | unknown agent or unverified model | **typed refusal** | not applicable: no provider layer |
| P10 information-flow control | uploaded text with an injected instruction flows into an email-sending node | **workflow refused at validation** | the email node ran with the injected text |
| P11 engine identity covers every semantic module | add an unhashed module | **closure test fails** | not applicable (see P4) |

**Score:** Foundry passes 11 of 11 attacks. LangGraph is native on 1 of the 8 that apply (P2); on the other 7 the
attack succeeds.

## Fair reading
- **Each LangGraph gap can be closed by hand-written code.** Idempotency keys, a version check on resume, a signed
  log, a coverage count, roles on resume, taint labels: a careful builder can write all of them. The claim is that
  Foundry makes these guarantees by construction, so neither a model building a workflow nor a builder in a hurry can
  forget them. It is not that LangGraph cannot do them.
- **P3 is limited.** Foundry's P3 holds for idempotent effects on main, through engine-supplied idempotency keys.
  Exactly-once for non-idempotent effects (runtime2 and the effect registry) is on an unmerged branch.
- **P5 compares unlike goals.** LangGraph's checkpointer is built for resumption, not audit. The row says what a
  team gets if it uses the checkpoint as its record.
- **What this does not show.** Nothing here says Foundry gets better task outcomes; that is P1's held-out result and
  later measurements. LangGraph's strengths stand: ecosystem, integrations, adoption, LangSmith tracing and
  evaluation, a mature hosted platform.
- **Temporal was not executed.** Its SDK (temporalio 1.35.0, wheel) installed, but starting its local test server
  means downloading and running an external binary, which this session's permission classifier refused. Its expected
  behaviour, from its documentation [doc] and not proven here:
  - P4: workflow code changed under an in-flight run is caught by deterministic replay (a non-determinism error). It
    would be native, and better than LangGraph.
  - P3: activities run at least once, so a crash after an effect re-runs it unless the activity is idempotent
    (hand-written).
  - P2: loops are bounded only by optional timeouts and history limits.
  - P5, P7, P8, P10: no built-in equivalent.
  Running it needs the owner to allow the Temporal dev-server download in the session's permission settings.
- **Next systems to attack, offline:** the OpenAI Agents SDK and CrewAI (pip wheels). n8n needs its full
  application install.
