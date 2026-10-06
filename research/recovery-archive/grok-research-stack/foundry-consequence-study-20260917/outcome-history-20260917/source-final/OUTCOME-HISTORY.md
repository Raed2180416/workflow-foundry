# Inspect a historical outcome

`inspectOutcomeHistory` rechecks a retained observation even when the current
capability registry has changed. It reads existing database records and preserved
artifact bytes. It creates no schema, writes no records, invokes no provider, and
does not probe the live artifact directory.

```js
import { inspectOutcomeHistory } from './src/outcome-history.mjs';

const history = inspectOutcomeHistory(foundry.store, {
  receiptId: recordedObservation.id,
  currentRegistryHash: foundry.registry.hash()
});
console.log(history.historicalAssessment);
console.log(history.currentEvidenceCheck);
// Always false, including when the historical assessment is satisfied:
console.log(history.currentWorldQualification);
```

The function also accepts `{ db }` backed by an already-open read-only SQLite
connection. Only `db.prepare(...).get/all` SELECT operations are used. The caller
owns the connection and can use a read transaction for a consistent concurrent
snapshot. Inspection does not automatically persist its report.

The explicit CLI command reads an existing workspace:

```bash
node bin/foundry.mjs outcome-history --receipt "$RECEIPT_ID" --workspace "$WORKSPACE"
```

This route opens read-only SQLite with `query_only` in a read transaction before
component loading or Foundry/Store initialization. It creates no workspace,
schema, ledger entry, or artifact. Ordinary SQLite WAL reader machinery may still
be used. Component, provider, execution, and promotion options are rejected.
The CLI supplies the hash of the built-in capability catalog only; it loads no
external component to reconstruct a current registry. This comparison remains
metadata with `currentWorldQualification: false`.

For `present` artifacts, the inspector independently decodes the preserved bytes,
checks every completed producer, and repeats the pinned `exact-json-artifact/2`
comparison. Object key order is ignored; array order is retained. Invalid or
unsupported JSON remains unsatisfied. The frozen host expectation is not certified
as independently correct.

For recorded absence or an unavailable observer, `historicalAssessment.basis` is
`recorded-observer-evidence-only`. This checks the recorded evidence's consistency;
it does not repeat the old physical observation. Missing bytes after a completed
producer remain unknown. A missing run directory after a producer wrote a different
filename also remains unknown. Confirmed absence at an accessible required path
remains the recorded unsatisfied outcome. Later live file changes never upgrade
these historical results.

The inspector checks the raw contract and receipt hashes, ledger keys, complete
request/proposal/root lineage, immutable workflow, historical run/input/registry/
policy/engine bindings, full event chain, and all completed artifact producers.
Only the frozen observer source `8de15af4…924f1fd`, data source
`50049ae8…4e7680c`, and the receipt's exact Node version are supported. Local source
identities are captured at module load. Other evaluator versions fail closed.
Bounds are 512 KiB per artifact/expectation, 100,000 events, 32 MiB of event JSON,
16 MiB per stored JSON record, and ten parent links.

`currentEvidenceCheck.status` is always `unverified`. Its registry comparison uses
the **caller-supplied** current hash and establishes no capability compatibility,
current artifact condition, execution authority, or policy compliance. The new
`outcome-history:<hash>` ID cannot be used as an outcome receipt or repair permit.
Existing repair and promotion checks stay in effect, including registry mismatch
refusals. Cross-world repair needs a separate explicit lineage and fresh qualification.

The database, source loader, and host remain trusted. Integrity hashes do not prove
that a privileged administrator never forged all records consistently. Missing or
changed historical records cause refusal; the inspector does not reconstruct them
from the current world.
