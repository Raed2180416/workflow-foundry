# Batch summarization construction task

Create a reusable workflow for an input object containing only `batches`, an array
of at most 20 arrays. Every inner array contains at most 100 finite JSON numbers.
Negative and fractional numbers and empty arrays are valid. Reject missing fields,
extra top-level fields and string-valued numbers before writing any artifact.

For each batch calculate its sum, then produce a run-scoped UTF-8 `summary.json`
artifact containing exactly `{ "batchCount": <number of batches>, "grandTotal":
<sum of all input numbers> }`. These values must depend on the actual input, not
constants. Empty input batches produce zeros. Use the available bounded native
workflow primitives and real capability contracts; no arbitrary code or external
services. Make dependencies, intermediate validation and final verification clear.
Keep maxSteps at most 150, maxConcurrency at most 2, maxDurationMs at most 60,000,
and maxCost zero. A successful model response is the workflow program, not a claim
that this particular input has already run.
