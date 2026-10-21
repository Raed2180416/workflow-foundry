# Composed solver interface

You build the order process as a **composed program**: a parent orchestrator plus sub-workflow modules that you
choose. The platform does not run your files directly: it bundles them with its own composition runtime into one
tick/1 solver (CONTRACT.md) and runs that. The runtime gives each module its own state and its own names, routes
results back to the module that caused them, and holds every module to what it declares.

## Files

| file | what |
|---|---|
| `composition.json` | the manifest: the parent and every module, with its interface |
| `parent.mjs` | exports `tick(input, ctx)` |
| `modules/<id>.mjs` | one file per module; exports `step(input, ctx)` and/or `onEvent(event, ctx)` |
| `tests/<id>.test.mjs` | the module's contract tests (node:test), one file per module |

`node compose-kit/compose.mjs check` checks the manifest and the files as the platform does.
`node compose-kit/compose.mjs test` runs your contract tests. `node smoke.mjs` runs the whole program on practice
worlds (see TASK.md).

## The manifest (`composition.json`)

```json
{
  "version": 1,
  "parent": { "file": "parent.mjs", "calls": ["intake", "payment"], "effects": [] },
  "modules": {
    "payment": {
      "file": "modules/payment.mjs",
      "purpose": "charge one fulfilment and undo the charge",
      "rules": ["R4.2", "R5.1"],
      "input": { "type": "object", "required": ["op"], "properties": { "op": { "enum": ["charge", "refund"] } } },
      "output": { "type": ["object", "null"] },
      "effects": ["billing.charge", "billing.refund"],
      "humanTasks": [],
      "timers": false,
      "calls": [],
      "reads": []
    }
  }
}
```

- **id**: lower case, digits and `-`, starting with a letter, at most 40 characters.
- **rules**: the SPEC-E rule ids the module is responsible for (for example `R4.2`, `S7`). Used to report which module
  owns which rule.
- **input**, **output**: JSON Schemas in the portable subset (`type`, `properties`, `required`,
  `additionalProperties`, `items`, `enum`, `const`, `minimum`, `maximum`, `minItems`, `maxItems`, `minLength`,
  `maxLength`, `description`; `type` may be a list such as `["object", "null"]`). Every call's input is checked against
  `input`; every result's `output` (from `step` and from `onEvent`) against `output`.
- **effects**: the effect kinds the module may emit. A kind is `system.op` (for example `billing.charge`), or a
  narrower kind: `orders.setStatus:order`, `orders.setStatus:fulfilment`, `orders.setStatus:fulfilment:<status>`,
  `orders.setStatus:order:<status>`, `notify.send:<template>`. A declaration covers an effect when it names the effect's
  `system.op` or one of its narrower kinds. Read operations emitted as effects (`inventory.allocate`, `fraud.check`) are
  kinds too.
- **humanTasks**: the task kinds the module may create (`fraudReview`). **timers**: `true` if it sets wake-ups.
- **calls**: the modules it may call (a module may call other modules; the call graph may not have cycles).
- **reads**: systems it may `query` or read `status` from, besides the systems of its effects.
- **parent**: `calls` (the modules the parent may call), and `effects` / `humanTasks` the parent emits itself (normally
  none: the parent reaches systems through modules). The parent may always set wake-ups and read everything.

## The parent

```js
export function tick(input, ctx) {
  // input: { kind, item, world, instance, now, events, state }  (CONTRACT.md's case-tick input, with your parent
  //        state from the last tick of this instance, or null, in place of `carry`)
  return { decisions: { subject }, state, merge?, close?, obligations?, effects?, humanTasks? };
}
```

`ctx` has everything CONTRACT.md's ctx has (`files`, `query`, `status`, `instances`) and:

- `ctx.call(module, key, input)` → the module's `output`. `key` names one **sub-workflow instance** of the module (an
  order id, a fulfilment id, ...: 1–80 characters, no `/`). Each (module, key) pair has its own state.
- `ctx.ownerOf(event)` → `{ module, key }` when the event is an effect result, a timer or a human-task event that a
  module instance caused; otherwise `null` (an inbound message, or something the parent caused itself).
- `ctx.deliver(event)` → hands such an event to its owner's `onEvent` and returns its output.
- `ctx.emit(...effects)` → adds the parent's own (declared) effects to the tick's output at this point.

The tick's output is built by the runtime: `decisions`, `merge`, `close` from your parent's result; effects, human
tasks and wake-ups from every module call, in the order the calls happened (then the parent's own); the carry holds
your parent state and every module instance's state. `obligations` (wake-ups) returned by the parent are the instance's
own; the parent's state, like a module's, must be JSON and the whole carry must stay under 64 KB.

## A module

```js
export function step(input, ctx) { ... }        // called by ctx.call(module, key, input)
export function onEvent(event, ctx) { ... }     // called by ctx.deliver(event), for events this instance caused
// both return { output?, state?, effects?, obligations?: { upsert?, cancel? }, humanTasks? }
```

- `ctx`: `{ module, key, state, now, files, query(table, filter), status(system, key), call(module, key, input), emit(...effects) }`.
  `ctx.state` is this instance's state (null the first time). Return `state` to replace it (omit it to keep it, `null`
  to clear it).
- Synchronous: return the result, not a promise.
- A module file cannot `import` or `require` anything and cannot see another module's code or variables: reach another
  module only with `ctx.call`, and only if it is in your `calls`. Variables at the top of a file do not survive between
  ticks (the process may restart at any time): keep everything you need in `state`.

## Names: keys, timers, tasks

Use **local names**. The runtime prefixes every key (including batch item keys), wake-up id and task id of a module
instance with `<module>/<key>/`, so `key: 'charge'` in module `payment`, instance `ORD-1-F1`, reaches the platform as
`payment/ORD-1-F1/charge`, unique platform-wide; the result comes back to that instance's `onEvent` with
`payload.key: 'charge'` (items, timer ids and task ids likewise localised). `ctx.status(system, key)` takes the local
key. `after` names a key emitted earlier in the same tick: your own local key, or another module's local key. The full
name must stay within 200 characters. Keys must be stable: the same logical effect gets the same key every time it is
emitted (SPEC-E §1), so a re-emission after a restart is recognised.

## What the runtime enforces

Every breach is recorded as an **interface violation** of that tick (the smoke report lists them):

- an effect, human task or wake-up outside the module's declaration is **dropped** (it never reaches the platform);
- a call outside the caller's `calls` (a `deliver` may go to any module the parent can reach), a recursion, an input
  or an `output` that does not match its schema, is **refused**: an error is thrown to the caller;
- a `query` or `status` on a system outside the module's `reads` and effect systems is refused;
- an error your parent does not catch fails the whole tick: nothing of it is applied (an arm error, CONTRACT.md).

## Contract tests

One `tests/<id>.test.mjs` per module, with `node:test`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';
const payment = moduleHarness('payment');
test('charges once', () => {
  const r = payment.step({ op: 'charge' }, { key: 'ORD-1-F1', state: null, now: '2026-03-02T10:00:00+01:00', files: {} });
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects[0].key, 'charge');
  const r2 = payment.onEvent({ type: 'effect.result', payload: { key: 'charge', system: 'billing', op: 'charge', status: 'ok' } }, { key: 'ORD-1-F1', state: r.state });
});
```

`moduleHarness(id).step(input, opts)` and `.onEvent(event, opts)` run the module exactly as the runtime does (isolation,
schemas, declarations); `opts`: `{ key, state, now, files, query, status }`; the result: `{ output, state, effects,
obligations, humanTasks, violations, error }`, with names as you wrote them.
