# DUR-1 change-operator API (frozen at F-A; shown to the sealed author)

## Bundle (`bundle.json`)

```json
{ "schema": "dur1-sealed/1",
  "changes": {
    "R2s": { "label": "...", "prediction": "...", "onset": { "day": 5 }, "publish": { "day": 2, "time": "09:00" },
             "transition": [{ "from": "<text occurring once in transition.base.mjs>", "to": "<replacement>" }],
             "spec": [{ "from": "<text occurring once in SPEC-E.md>", "to": "<replacement>" }],
             "worldOp": "function (W, api) { ...; return W; }" },
    "E2s": { "label": "...", "prediction": "...", "onset": { "day": 4 },
             "edition": { "id": "ed-2026-4", "policy": { "customerActionHours": 5 }, "feeDelta": 50, "codeRenames": { "PARCELLA": { "IN_TRANSIT": "MOVING" } } },
             "renames": [{ "system": "notify", "op": "send", "from": "text", "to": "message" }] },
    "U1s": { "label": "...", "prediction": "...", "onset": { "day": 3 },
             "transition": [{ "from": "...", "to": "..." }], "worldOp": "function (W, api) { ... }",
             "complaintTemplates": ["... {order} ...", "...", "..."], "complaintTopic": "notice" } } }
```

- Days are world-days 1-14 of a 14-day world starting 2026-03-02T00:00+01:00.
- **Transition edits** replace text that occurs exactly once; R2s's edits are applied after R1's and before U1s's, each
  anchor once in the text as it stands then. Gate every rule edit by the order's placement: `p >= __durEff(world, '<id>')`
  (`__durEff` returns the effective time in ms, or Infinity in a world where the change is not in force).
- **Spec edits** (R2s only) replace text that occurs exactly once in SPEC-E.md; a change notice with the publication and
  effective times is added by the platform.
- **Edition** (E2s): a new rulebook edition effective from the onset day for orders placed from then (`policy` overrides
  `policy.json` keys, `feeDelta` is added to every location's fee in minor units, `codeRenames` renames carrier codes per
  carrier). **Renames** (E2s): from the onset the system accepts only the new argument name (`400 field-renamed` otherwise)
  and its API schema file shows the new name.

## World operators (`worldOp`)

A JavaScript function source `(W, api) => W'`, run in an isolated context (no require, import or process; 2 s limit) on a
deep copy of the generated world. Return the changed world. Use it to make sure enough orders meet your rule (e.g. turn
some straight orders into fraud reviews, add customer actions). Keep worlds valid: every arrival needs `W.truth.eventCase`
for its id; keep `W.arrivals` sorted by `at`.

`api`: `rng(...parts)` (a seeded generator: `.next()` in [0, 1), `.int(lo, hi)`), `minutesOf(iso)`, `isoLocal(ms)`,
`dayStart(d)` (ms), `collectionRuns(location)` (minutes from t0 of a location's carrier collections), `eff` (the change's
effective time in ms).

World fields you may read and edit: `W.arrivals` (inbound messages: `order.placed`, `customer.action`, carrier reports),
`W.truth.cases[c]` (`subject`, `class`, `placedAt`, `review`, `actions`, `fulfilments`), `W.truth.eventCase`,
`W.sor['fraud.verdicts']`, `W.sor['inventory.allocations']`, `W.rulebook.editions`, `W.faults`.
