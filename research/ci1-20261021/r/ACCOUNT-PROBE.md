# Where the account address in `claude -p` builders comes from, and what removes it (diagnostic, 2026-11-04)

*CI-1 review finding 6; compromise C7 (`research/compromises-20261021/REGISTER.md`). Probe: `experiments/ci1-r/probe-account-context.mjs`.
Raw counts: [`account-probe.json`](account-probe.json). Cost: $0.001 (6 Haiku calls). This is not a capability comparison. The address
is compared in memory and never printed or written.*

## Method

Haiku was asked, through the policy's claude-cli route, to copy every e-mail address it could see outside the message. We ran two
calls in each of three conditions:

| Condition | Calls | Account address listed | Other non-fixture address |
|---|---|---|---|
| Environment as inherited (how every earlier CI-1 arm ran) | 2 | **2 of 2** | 0 |
| `CLAUDE_CODE_USER_EMAIL`, `CLAUDE_CODE_ACCOUNT_UUID` and `CLAUDE_CODE_ORGANIZATION_UUID` removed | 2 | **2 of 2** | 0 |
| Those removed, plus an empty, throwaway `CLAUDE_CONFIG_DIR` (nothing copied into it) | 2 | **0 of 2** | 0 |

All six calls succeeded. With the empty configuration directory, authentication still comes from the host, and the cost per call did
not change ($0.00016 to $0.00029).

## Reading

- The cloud session exports the address as `CLAUDE_CODE_USER_EMAIL`, and the provider does not scrub that variable
  (`src/executors/claude-code.mjs` `SCRUBBED_ENV`). Even so, the variable is **not** the route by which the address reaches the
  model's context. The negative result stays recorded.
- The route is the CLI's own configuration directory: the account record of the managed login. Running the child with an empty
  `CLAUDE_CONFIG_DIR` removes the address from the model's context.

## What changed

**Applied, without editing `src/`, so the engine v2 series is untouched.** The CI-1 review runner (`experiments/ci1-r/run-r.mjs`) and
the blind-card writer run every builder call with two changes:

- the account variables removed;
- an empty, throwaway configuration directory, deleted at the end of the run.

They also scrub records before writing them, and check and scrub the journal at the end. See `env-guard.mjs` and `run-r.mjs`.

**Handed to the engine.** The same two changes belong in the claude-cli provider:

- add the three account variables to the scrub list;
- give every `claude -p` child an empty `CLAUDE_CONFIG_DIR`.

This closes C7 for every arm and not only for CI-1. The change is about one line plus a temporary directory.

**Earlier arms.** Every earlier CI-1 arm, and every other track that builds through `claude -p`, ran with the address in context. In
CI-1 it surfaced once, in dev build 18832-k0's `envelope.risks`. It affected no test or wave-2 effect. The two local files that held
it were scrubbed on 2026-11-04 (`RESULT-CI1.md` §8, D20).
