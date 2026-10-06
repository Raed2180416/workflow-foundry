# Ancestor binding correction

Independent worker-6 review, relayed by prime, identified a gap in the original
151-line inspector. Its main observation proposal checked `proposal.baseHash`
against `request.baseHash`, but ancestor proposals omitted that equality. It also
checked each child repair against its predecessor workflow, without checking an
intermediate repair's goal and success criteria against its own applied proposal.

The original source, 55-test source and original FINALIZED descriptor are archived
in this directory. Original source SHA-256:
`023921bb5bd99982c821b9fc9ec28e68763f8344ea53e57c824e6e0608f75610`.
The original `../FINALIZED.json` remains at its original path and exact hash
`0323ee7b8cd0aefcddec506199efeb6084bc8427f1ae5edac48b6e252d93ea1c`.

## Executed counterexamples

Three new tests construct fresh native depth-two repair histories, then deliberately
alter only those disposable fixture databases. They test:

1. An ancestor proposal's `baseHash` differs from its own request's base hash while
   the selected observation is correctly rehashed and its other links remain intact.
2. An intermediate repair goal differs from its own applied proposal. Earlier
   workflow/proposal hashes and the intermediate base links are coherently changed
   so the independent intent gap is isolated from the base-hash gap.
3. The analogous intermediate success-criteria disagreement, with coherent earlier
   hashes and base links.

Against the exact old source, all three refusal tests fail with `Missing expected
exception`: **0 passed, 3 failed**, exit one. Raw output is `pre-fix.stdout`.
The historical reports unexpectedly returned by that inspector are preserved at:

```text
pre-fix-evidence/foundry-history-r9HvNt/UNEXPECTED-HISTORY.json
pre-fix-evidence/foundry-history-QOjQb1/UNEXPECTED-HISTORY.json
pre-fix-evidence/foundry-history-ukOZeE/UNEXPECTED-HISTORY.json
```

These controls establish missing consistency checks in the old inspector. They
do not allege corruption of any real saved model trajectory or establish resistance
to a database administrator who forges all records consistently.

## Minimal change and observed result

The ancestor loop now requires `prior.baseHash === parent.baseHash` for every
ancestor. Where the parent is itself a repair, it also requires its goal and
success criteria to match its own applied proposal. No old observer, core,
provider or CLI source was changed by worker-4.

The same three counterexample tests now pass, and the complete expanded history
suite passes **58/58**, zero failures/cancellations/skips, exit zero. Raw output is
`post-fix.stdout`; native evidence is under `post-fix-evidence/`. Final module
SHA-256: `4caa2bce1e7b55226367ac0b5178d51af92ac1d145b48b5b820e584476b08b8a`.
The 58-test source is identical in the pre-fix and post-fix experiment:
`da0c63da47850ff40e11a2e6fd515f9388ecdac4cb3aa7b2b31f7b618a1c8c27`.

The patched source/hash was sent to prime before completion for worker-6 replay.
Prime owns the final combined full regression. No duplicate full suite was run
after this fix. Historical/current separation, all producer evidence, absence and
unavailable distinctions, SELECT-only inspection, and typed non-repair report IDs
remain in force.
