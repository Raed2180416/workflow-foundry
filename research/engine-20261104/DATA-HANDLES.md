# Data handles (engine gap 1): design draft, 2026-11-04

**Status (2026-11-04, late):** built on branch `data-handles`, with tests and mutation checks:
- the store with views (`src/blobs.mjs`, in the engine identity);
- capability output labels (the label prerequisite below);
- the producers `data.import`, `data.split` and `data.inventory` (`src/data-capabilities.mjs`);
- the `$read` consumer in task and code args;
- `render: "blob-text"` agent inputs;
- ledger inventories from a handle.

Tests: `tests/blobs.test.mjs`, `tests/capability-output-label.test.mjs` and `tests/data-handles.test.mjs`. Every
safeguard has a mutant the tests kill (13 mutants in all).

**Not built yet:**
- `verify-run` BLOB_MISSING/BLOB_CORRUPT checks, and blob bundling in `export`;
- a per-node sandbox input cap above 2 MB;
- store garbage collection.

A real large-input run (the 300 GB case) has not been measured.

This addresses research/skillpack-20261104/ANSWER.md gap 1.

## Problem
Values pass between nodes as inline JSON:
- sandbox input is at most 2 MB (`checkData` default);
- code output is at most 512 KB (`MAX_OUTPUT_BYTES`);
- clones and node outputs are at most 16 MB.

A 300 GB research program, or a codebase audit with 100k files, cannot move its data through the graph. Today the
builder hand-rolls references (path plus hash), and nothing checks them: no integrity, no label, no bound on what a
reader pulls into a prompt.

## Shape
- **handle:** `{"$blob": "<sha256 hex>", "bytes": N, "mediaType": "text/plain" | "application/json" | "application/x-ndjson"}`
- **view:** a handle plus either `"range": [start, end]` (bytes, end exclusive) or `"lines": [first, last]` (0-based, end
  exclusive). A view never copies bytes.

Handles are plain data. Validation accepts a `$blob` object only in exactly this shape.

## Store
- Files live at `.foundry/blobs/<aa>/<sha256>`. They are immutable, written atomically (temp file plus rename) and only by
  host code (the store and capabilities), never by the sandbox or a model.
- `putBlob(bytes, mediaType)` returns a handle.
- `readBlob(handle | view, maxBytes)` verifies the size and the full sha256 once per process, then serves bounded ranges
  or lines.
- Quotas come from host policy: the largest blob (default 1 GB) and the store total (default 20 GB). Reaching one is a
  typed refusal: `BLOB_TOO_LARGE` or `BLOB_QUOTA`.

## Producers (v1)
- **`data.import`** (task capability, host side). It reads a file under a root the host policy allows (`allowedRoots`;
  with no allowed root it refuses) and returns a handle labelled `untrusted:import`.
- **`data.split`** (task capability, pure and deterministic). It turns a text or NDJSON handle into views of at most N
  lines or B bytes, cut only at line boundaries. This is the shard plan, with no copying.
- **`data.inventory`** (task capability). It lists files under an allowed root as an NDJSON handle of
  `{id, path, bytes, sha256}`. This is the recon step of `scale.md`.

## Consumers (v1)
- **Code and capability args.** `{"$read": <handle or view ref>, "as": "text" | "json" | "lines", "maxBytes": n}`. The
  runtime resolves it to content just before execution, within the node's declared `maxBytes`. The sandbox input cap
  becomes per-node (default 2 MB, at most 32 MB, inside the 1.25 GB JS data limit).
- **Agent context inputs.** `render: "blob-text"` renders a handle or view as text. The existing token budget bounds it:
  `CONTEXT_OVERFLOW` or the input's `onOverflow`.
- **Ledger verify.** `ledger.inventory` may be a handle to a JSON array or to NDJSON ids.

## Integrity and audit
- The journal records handles, and the sha256 in each binds its content.
- `verify-run` gains `BLOB_MISSING` and `BLOB_CORRUPT`: every blob a run's outputs or inputs reference must exist and
  hash correctly.
- `export` bundles the referenced blobs.

## Labels: a prerequisite found while wiring step 2
Today a task node's output label is the label of its args (`src/validate.mjs:188`, and the runtime matches). A
capability that reads data from disk, given a trusted path, would therefore label the file's content trusted, and a model
prompt would treat untrusted data as instructions-capable context. Before any disk-reading capability ships:
- a capability may declare `outputLabel` (for example `untrusted:import`);
- the validator's dataflow and the runtime join it with the args label for the node's output;
- a test proves that `data.import` content reaches a prompt behind the untrusted preamble, and that the effect gate treats it as untrusted.

A blob carries its producer's label, and views and `$read` results inherit it.

## Engine identity
`src/blobs.mjs` joins the identity. `tests/engine-identity-closure.test.mjs` enforces that.

## Tests (planned, each with a mutant that must fail)
- Content addressing, idempotent put, and tamper detection (one byte flipped gives `BLOB_CORRUPT`).
- Views by range and by lines at the boundaries; a view past the end is refused.
- Quota and size refusals.
- Label propagation through views and `$read`.
- `verify-run` catching a missing or edited blob.
- A ledger inventory from a handle.
- A map over `data.split` views with agent context rendering the slices (scripted model).
- The sandbox input bound.

## Out of scope for v1
- Remote stores and streaming capabilities.
- Automatic spilling of large outputs to blobs (explicit only).
- Blob garbage collection (blobs a run references are kept; a later `gc` keeps whatever a retained run references).
