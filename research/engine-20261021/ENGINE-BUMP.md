# Engine bump 2026-10-21 (PLAN-3DAY Day 2, pulled forward from 11-04)

*Development evidence. Everything here was built and tested in an isolated worktree with synthetic capabilities and scripted
models ($0); no paid call was made. Inputs: [../orch-20261021/GAPS-AND-PLAN.md](../orch-20261021/GAPS-AND-PLAN.md),
[../compromises-20261021/REGISTER.md](../compromises-20261021/REGISTER.md) (C2, C6, D1),
[../business-20261021/ATTACK-FABLE.md](../business-20261021/ATTACK-FABLE.md) §2-§3.1, [../decisions-20261021.md](../decisions-20261021.md) (D15).*

## 1. Engine compatibility ranges (gap rank 5)

**Problem.** A run records `engineHash`, the sha256 of a descriptor of every engine source file plus the Node version, platform,
architecture and validator version (`src/engine.mjs`). Resume refused any other hash (`ENGINE_DRIFT`), so every engine change,
including each fix in this bump, stranded every in-flight and parked run (incident I8).

**Mechanism (the smallest sound one).** Temporal's answer is `patched()`: new code keeps the old branch under a marker so an old
history replays the same way. Foundry does not replay code (it resumes from a checkpoint and a journal), so the requirement is
weaker: the new engine must read an old run's record correctly. That is a property of a release, reviewed once, so it is declared
once per release rather than per branch:

1. **Lineage, in the engine.** `src/engine-lineage.json` holds this engine's `version` (an integer), `resumesFrom` (the oldest
   version whose runs it may resume) and, for each predecessor, its exact file map (name to sha256). The file is in the hashed
   set of `src/engine.mjs`, so changing a declared range is itself an engine change, and it is reviewed source: no model, run or
   host option can widen it. `src/engine.mjs` validates it at import (a malformed lineage fails like a syntax error).
2. **Recognition is exact.** A recorded hash is a predecessor only if the predecessor's file map, combined with *this host's*
   Node version, platform, architecture and validator, hashes to it (`engineOf`). Nothing is trusted from the run record. A run
   created under another Node or validator version is not recognised: a platform change is not a declared migration.
3. **Resume.** `Runtime.execute`: same engine, as before. A recognised predecessor with `version >= resumesFrom`: the run resumes,
   and the same store transaction that takes ownership (`runner.acquired`) appends `engine.migrated {from, to, fromVersion,
   toVersion, resumesFrom}` and moves the record's `engineHash` to this engine, compare-and-swap on the old value
   (`STATE_CONFLICT` if another process moved it). Anything else: `ENGINE_DRIFT`, now naming the recorded version and the range.
4. **One way.** Because the record then names the newer engine, an older engine refuses the run (`ENGINE_DRIFT`): it cannot
   resume a record a newer engine has written.
5. **The chain decides.** `engineBinding(events)` (`src/audit.mjs`) is the engine the chain binds: the birth engine, then each
   migration, each of which must start from the engine bound before it. The runtime (`ENGINE_BINDING_CORRUPT`), `identityChanges`
   and `verify-run` compare the record with it, so an edited `engineHash` without a migration event is still caught.
   `verify-run` reports each migration (`ENGINE_MIGRATED`, info), an inconsistent migration chain (`ENGINE_MIGRATION_INVALID`,
   error), and judges "same engine" (verdict recompute, wait replay) against every engine the run ran under.

**This bump.** Version 1 is commit 96cab64 (the engine of every run in flight on 2026-10-21; on the owner's host,
node v24.21.0 / linux x64 / ajv 8.20.0, its hash is `358cb020…caad9f6`, and `engineOf` recognises it). Version 2 is this bump and
declares `resumesFrom: 1`, because every change in it reads version-1 records as version 1 wrote them (section 2 lists them and
why). Release procedure: `node tools/engine-lineage.mjs` on version N prints the entry to freeze into N+1's `predecessors`; set
`version` and `resumesFrom`; list the changes.

**Tests.** `tests/engine-binding.test.mjs` (6/6): version 1 recognised on this host; the chain decides the bound engine; and an
end-to-end run in three real engine copies (child processes): a run created by a predecessor resumes under a successor that
declares it compatible, with exactly one `engine.migrated` committed just before `runner.acquired`; a successor that lists the
predecessor but no longer resumes its version refuses without writing; the predecessor refuses the migrated run; the run then
completes and `verify-run` is `ok` with `ENGINE_MIGRATED`.

**Limits.** (a) Platform drift (a Node upgrade) still strands runs; a lineage could later declare platforms too. (b) The
historical-outcome observers (`src/outcome-repair.mjs`, `src/outcome-history.mjs`) pin their own bytes and `src/data.mjs`, and
compare the birth engine with the record: they refuse a migrated run (`OUTCOME_EVIDENCE`), which fails closed; they were left
unchanged on purpose. (c) A declared range is a reviewer's judgement that the new engine reads old records correctly; the tests
check the mechanism, not that judgement.
