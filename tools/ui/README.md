# tools/ui: tier-0 human-task forms (G21)

*2026-10-14. Gap G21 ([BAR-SET §5](../../research/enterprise-20261014/BAR-SET.md)), tier 0 of
[OPENUI.md](../../research/enterprise-20261014/OPENUI.md) §5.2, tested as in §6, spike B1 (§8); E-bed build step 8
([E-BED §8.1](../../research/enterprise-20261014/E-BED.md), form route §2.7, UI construct §7). Development evidence only:
$0, no model calls, no network beyond 127.0.0.1.*

A human task has a `question` and an `answerSchema`. This sidecar compiles them, by code and with no model, into a
static, accessible HTML form. It maps what comes back to a typed answer and re-validates that answer on the host. The
browser and any OpenUI-shaped client are untrusted. The sidecar lives in `tools/` because `web/` is in the kit hash
([ENGINE-FREEZE](../../research/jit-20261008/ENGINE-FREEZE.md) §1). It changes no file under `src/`, `schemas/`, `web/`
or `package*.json`.

```text
answerSchema + question ──compileForm──▶ form spec (foundry-ui-form/1, specHash)
                                              │
                    renderForm ◀──────────────┤
  browser POST (urlencoded) ──formStateFromSubmission──▶ formState ─┐
  OpenUI-shaped event { formName, formState } ───────────────────────┼─▶ answerFromFormState ─▶ typed answer
                                                                    ┘      (adapter + validateAnswer)
  typed answer (scripted actor) ───────────────────────────────────────▶ validateAnswer
```

## Capability numbers (development, $0)

| measure | tier 0 | baseline | command |
|---|---|---|---|
| completability: generated valid answers whose canonical form round-trips exactly | typed formState **3000/3000**, text formState **3000/3000**, browser POST **2913/3000** (97.1%) | — | `node tools/ui/measure.mjs` (seed 20261014, 1,000 schemas × 3 answers) |
| host validator vs engine validator (`src/validate.mjs`, ajv 8) on schema/answer pairs | **14,000/14,000** agree (7,667 valid, 6,333 invalid) | — | `tests/ui-form-adapter.test.mjs` "differential" (seed 424242) |
| answers accepted by any route that the engine rejects | **0** (3,000 × 3 routes, plus 4,000 mutants × 2 routes, plus 6,000 garbage inputs) | — | `tests/ui-form-adapter.test.mjs` |
| planted number text accepted (20 entries outside strict decimal syntax) | **0/20** | OpenUI `numeric` rule **15/20** (including `"12abc"`, `"1,000"` → 1, `"Infinity"`); `web/app.js` `Number()` **6/20** (including `"0x10"` → 16, `"0b101"` → 5) | `node tools/ui/measure.mjs` |
| leaf fields with their own labelled control, on the 18 compile fixtures | **34/34** | `web/app.js` draftControl: **8/34** (an object answer is one raw-JSON textarea) | `node tools/ui/measure.mjs` |
| conformance fixtures | **68/68** (18 compile with golden HTML, 33 refuse, 17 submit with 86 interactions) | — | `node tools/ui/fixtures.mjs` |

The browser misses (87 of 3,000) are all one known kind: a line break in a value whose field renders as a single-line
input (a string with `maxLength` ≤ 120). The generator puts line breaks in about 5% of characters, so the share says
nothing about real answers. Typed and text formState routes have no misses.

Decision-fact coverage (OPENUI §5.2) is 0 beyond the question text for tier 0 by definition. That is the baseline tier 1
must beat.

## Files

| file | what |
|---|---|
| `compile.mjs` | `compileForm` / `tryCompileForm`: subset check and refusals, the form spec, `specHash` |
| `pattern.mjs` | the admission bound for `pattern` (below) |
| `validate.mjs` | `validateAnswer`: host re-validation of a typed answer; `valueErrors` (raw) |
| `formstate.mjs` | the adapter (`answerFromFormState`), the browser route (`formStateFromSubmission`, `acceptSubmission`), encoders that play the person or a scripted actor (`formStateFromAnswer`, `submissionFromAnswer`), `canonicalAnswer`, `parseNumberText` |
| `render.mjs` | `renderForm`, `renderAccepted`, the CSS, its hash and the CSP (`FORM_CSP`, `FORM_CSP_HEADER`, `FORM_HEADERS`) |
| `host.mjs` | `createFormHandler`: a loopback `node:http` handler for one task |
| `common.mjs` | the error object, escaping, `displayText`, small helpers |
| `fixtures.mjs`, `fixtures/1/` | conformance fixtures and their runner |
| `generate.mjs`, `measure.mjs` | seeded generators and the capability numbers |
| `index.mjs` | re-exports |

## Subset

A portable JSON-Schema subset. Anything else is **refused with a code**, never flattened.

| schema | control (`componentType`) | value in the answer |
|---|---|---|
| `type: string` (`minLength`, `maxLength`, `pattern`) | `Input` when `maxLength` ≤ 120, else `TextArea` | string |
| `type: number` / `integer` (`minimum`, `maximum`, inclusive) | `Input` (text with `inputmode`) | number |
| `type: boolean` | `RadioGroup` Yes / No | boolean |
| `enum` / `const` of scalars (string, number, boolean, null), optional matching `type` | `RadioGroup` (≤ 6 options) or `Select` | the member |
| `type: array`, `items` an enum (`minItems`, `maxItems`) | `CheckBoxGroup` | members in option order |
| `type: object` (`properties`, `required`, `additionalProperties: true/false`) | the form; one nested level is a `<fieldset>` group | object |

`title` (label) and `description` (hint) are allowed anywhere. The limits are 60 fields, 200 options, a 64 KB schema of
depth ≤ 12, a question of 20,000 code points, and a title or description of 2,000. Keys `__proto__`, `constructor` and
`prototype` are refused, as `src/data.mjs` refuses them.

Refusal codes (`source: "schema"`): `unsupported-keyword` (for example `oneOf`, `$ref`, `format`, `default`,
`uniqueItems`, `exclusiveMinimum`, a schema-valued `additionalProperties`), `unsupported-type` (`null`, unions, no type,
enums of objects), `keyword-not-applicable` (`minimum` on a string), `unsupported-nesting` (an object below a group),
`unsupported-array-items` (free-text lists, repeaters), `no-fields`, `required-undeclared`, `enum-duplicate`,
`enum-member-invalid` (a member that fails its own schema could never be accepted), `unsatisfiable` (`minLength` >
`maxLength`, no integer in range, `minItems` > options), `pattern-invalid`, `pattern-unsafe`,
`pattern-needs-max-length`, `schema-limit`, `unsafe-key`, `invalid-schema`, `invalid-question`, `invalid-form-name`,
`invalid-bind`.

Compile warning: `required-text-may-be-blank`. A required string without `minLength ≥ 1` accepts `""`, so "required"
cannot stop a blank entry.

**`pattern`.** The engine refuses `pattern` in untrusted schemas (`src/validate.mjs` `compileDataSchema`). A runtime
`human` node with a pattern is therefore an invalid workflow before any form exists. The sidecar admits a bounded
subset for bed-host human tasks, and `allowPattern: false` gives the engine's profile. The bound is syntactic, not a
proof:
- at most 256 characters, compiled with the `u` flag;
- no backreferences and no lookaround;
- a group may only be optional (`?`, `{0,1}`);
- degree ≤ 2, where the degree is the large quantifiers (`*`, `+`, `{n,}`, `{n,m}` with m > 16), plus 1 when the pattern
  is not anchored by a leading `^` or has a top-level `|`;
- the field must declare `maxLength` ≤ 256, and the validator checks `maxLength` before the pattern runs.

## The form spec (`foundry-ui-form/1`)

`{ kind, formName, question, bind, schemaHash, schema, rootKind, groups, fields, warnings, specHash }`.

Each field has `id` (`f0`, `f1`, …), `name` (`answer` + the JSON pointer of the leaf: `answer`, `answer/amount`,
`answer/release/amount`), `path`, `label`, `description`, `group`, `required`, `valueType`, `componentType`,
`constraints`, and `options` (`{ token, value, label }`, where the token is the option index) where it applies.

`specHash` binds the schema, the question, the form name, the compiler version and `bind` (`workflowHash`, `nodeKey`,
`runId`, `taskId`). The rendered form carries it as `_spec`. A submission made from another version, or for another
task, is refused as `stale-form`: this is the compare-and-swap. The host also accepts at most one answer per task.

## The `formState` adapter

OpenUI 1.0 events carry `formName` and `formState`. Inside a form, the form's fields sit under its name, each as
`{ value, componentType }` (`spec/language.md` §6.3 at openui `39ce989`, read statically). `answerFromFormState(spec,
event)` accepts that event, or the bare `{ [formName]: fields }`.

| component | accepted `value` |
|---|---|
| `Input` / `TextArea` (text) | a string |
| `Input` (number, integer) | a JSON number, or a string in strict decimal syntax `-?(0\|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`; surrounding spaces and tabs are ignored. `"12abc"`, `"0x10"`, `"1,000"`, `"Infinity"`, `".5"`, `"+5"` and non-ASCII digits are `not-a-number`; overflow and underflow are `number-out-of-range`; an integer beyond 2^53 that does not round-trip is `number-precision` |
| `RadioGroup` / `Select` | a member of the enum (strict equality); a boolean field takes `true`/`false` or `"true"`/`"false"` |
| `CheckBoxGroup` | an array of members, or OpenUI's aggregate `{ <option token>: boolean }` |

- **componentType.** It may be absent (OpenUI's react-ui path omits it). If present, it must match the spec, or the
  field fails with `component-mismatch`.
- **Strict shape.** Unknown forms (`unknown-form`), unknown fields (`unknown-field`) and wrappers with other keys
  (`field-shape`) are refused.
- **Blank.** `null`, `""`, `[]`, an all-false aggregate and an absent field all mean "no answer". There are two
  exceptions: a blank required text field is `""`, and the schema decides whether that is acceptable; a blank required
  checkbox group is `[]`. An enum that lists `""` or `null` treats them as real choices. An optional group whose fields
  are all blank is left out.

**The browser route.** The form posts `application/x-www-form-urlencoded`. Option controls carry tokens. Text areas
arrive with CRLF and are normalised to LF. `acceptSubmission` checks `_spec` (`stale-form`), `_token` (`bad-token`,
compared in constant time), unknown and duplicate fields, and unknown option tokens (`source: "host"`). It then runs the
adapter and the validator.

**`createFormHandler({ spec, token, onAnswer })`** responds as follows:
- GET renders the form under the CSP headers;
- a rejected POST re-renders it with the person's entries kept and an error summary (422);
- the first accepted POST calls `onAnswer` once (200);
- every later POST gets 409. If `onAnswer` throws (for example the runtime's `ANSWER_CONFLICT`), the answer is not
  recorded;
- a body over 4 MB gets 413, another content type 415, another method 405.

## The validator and the error object

`validateAnswer(spec, answer)` follows JSON Schema as ajv 8 applies it in the engine's gate (`Runtime.answer` →
`validateData`):
- `integer` is a number with no fraction;
- `enum` and `const` use strict scalar equality;
- `minimum` and `maximum` are inclusive;
- `minLength` and `maxLength` count code points;
- `pattern` is an unanchored `u` RegExp;
- `required` checks own properties;
- `additionalProperties: false` rejects undeclared properties.

The one difference is order, not outcome: `maxLength` is checked before `pattern`. The differential test checks
acceptance against `validateData` itself.

Errors use OpenUI's wire shape (`spec/language.md` §8.3): `{ source, code, statementId, component, path, message, hint
}`.
- `statementId` is the field name, `component` its `componentType`, and `path` a JSON pointer.
- As in OpenUI's fixtures, only `source`, `code`, `statementId`, `component` and `path` are structural. `message` and
  `hint` are text for people.
- Validator codes: `missing-required`, `type-mismatch`, `not-an-integer`, `enum-mismatch`, `too-short`, `too-long`,
  `pattern-mismatch`, `below-minimum`, `above-maximum`, `too-few-items`, `too-many-items`, `unknown-property`,
  `answer-limit`, `unsafe-key`.

## Rendering and accessibility

- **Page.** The page is static HTML with no script, no external asset, no `style` attribute and no URL. It has one
  `<style>` block, allowed by its sha256 in the CSP: `default-src 'none'; style-src 'sha256-…'; img-src 'none';
  script-src 'none'; connect-src 'none'; form-action 'self'; base-uri 'none'`. The header adds `frame-ancestors 'none'`;
  a meta policy may not carry that directive.
- **Structure.** There is one `<h1>`, the question. For a single-answer form, the question is the control's label or the
  group's legend. Every control has a `<label for>`; radio and checkbox groups are `<fieldset>`/`<legend>`; nested
  objects are `<fieldset class="group">`. Requiredness is written out: "(required)", "(optional)", or "(required with
  this group)" inside an optional group.
- **Hints and errors.** Hints and errors are linked with `aria-describedby`, and an invalid control has
  `aria-invalid="true"`. After a rejected submission, an error summary (`role="alert"`, `autofocus`, title prefixed with
  `Error: `) lists every error, each linking to its control. This is the error-summary pattern of the GOV.UK Design
  System, from general knowledge; nothing was read or copied for it.
- **Workflow text** (question, titles, descriptions, option labels, rule text) is escaped. Bidi controls, zero-width,
  control and noncharacter code points and lone surrogates are shown as visible markers `⟦U+XXXX⟧`. A small chip says
  the text comes from the workflow. When an enum mixes JSON types, its labels are JSON text, so `"1"` and `1` differ.
  **Values a person typed** are echoed back escaped and otherwise unchanged. A text area keeps a leading newline.
- **Why the browser does not validate.** The form is `novalidate`, and the host is the only validator. HTML `maxlength`
  counts UTF-16 units where JSON Schema counts code points, and it would block typing a valid answer of emoji. HTML
  `pattern` is anchored and uses the `v` flag. `type=number` silently drops `"12abc"` to `""`, so the host would see
  "missing" instead of "not a number". Limits are written in the hint instead ("Use 1 to 500 characters.").

## Completability

`canonicalAnswer(spec, answer)` is the answer the form produces when a person enters `answer`. It drops undeclared
properties, blank optional text and selections, and untouched optional groups, and puts checkbox selections in option
order. For every generated valid answer, the canonical answer is valid and round-trips exactly through the typed and
text formState routes. Through the browser route it round-trips unless a real widget cannot hold the value. The
encoders report every such case as a gap:
- `line-break-in-single-line-input`;
- `carriage-return` (browsers turn a lone CR into CRLF);
- `lone-surrogate` (form encoding replaces it).

The other gaps (`undeclared-property`, `optional-empty-text`, `optional-empty-selection`, `empty-optional-group`,
`selection-order-or-duplicates`) are representation differences that the canonical answer removes.

## Conformance fixtures (`fixtures/1/`, OpenUI's layout)

One folder per case, `<area>/<NNN-name>/`:
- `compile/` has `input.json`, `expected.json` (fields and warnings) and `expected.html` (the golden page, byte-exact);
- `refuse/` has `expected.json` with the refusal errors;
- `submit/` has `interactions.json`: `{ interactions, expected: { results } }`. A step is `{ formState }`,
  `{ submit: [[name, value], …] }`, `{ submitRaw }` or `{ answer }`. In submit steps, `{{spec}}` and `{{token}}` stand
  for the spec hash and the case token.

Errors are compared as a multiset on the structural keys each expected entry lists. The expectations were written by
hand from the rules above. The golden HTML was generated by `renderForm` and reviewed.

```sh
node tools/ui/fixtures.mjs               # run all cases (exit 1 on a mismatch)
node tools/ui/fixtures.mjs --write-html  # regenerate compile/*/expected.html, then review the diff
node tools/ui/measure.mjs                # capability numbers
```

## Tests

| file | tests | what |
|---|---|---|
| `tests/ui-form.test.mjs` | 75 | every fixture (68), refusal-code coverage, the static page contract (vocabulary, no handler, no style attribute, no URL, CSP hash, labels, ids, aria references, rendered fields = declared fields) on empty and error pages, determinism and one field per leaf on 300 generated schemas, spec-hash binding, limits, relative action |
| `tests/ui-form-adapter.test.mjs` | 10 | the differential with the engine validator; completability; mutant and garbage soundness; planted number text against both baselines; pattern bound timing; 40 hostile payloads in every text slot (the element/attribute skeleton must not change); byte-exact round trips of hostile and 10^6-character values; the loopback host (CSP headers, 422/409/413/415/405, compare-and-swap); end to end through the real `Runtime` (`awaiting_human` → form → host → `Runtime.answer` → `succeeded`, while a planted `"12abc"` never reaches `Runtime.answer`) |
| `tests/ui-form-browser.test.mjs` | 3 | Playwright 1.63.0 with the pre-installed Chromium (`/opt/pw-browsers/chromium`, `--no-sandbox`), offline, with every non-loopback request aborted and counted. (1) Fill with the pointer, a planted `"12abc"` gives a focused, linked error summary with the entries kept, then the corrected form yields the typed answer. (2) Keyboard only: the Tab order equals the spec order, ARIA tree lines are checked, and the form is completed and submitted by keys. (3) Hostile question text stays text, the page loads nothing, it reflows at 320 px, and an injected inline script is blocked by the CSP. Skips with a reason when Playwright or Chromium is missing |

## Not done, deviations and open issues

- **Deviations from OPENUI.md §5.2 / §6.**
  - Booleans are Yes/No radios, not toggles. A checkbox cannot tell "no" from "not answered", and a default `false`
    would let an unread form submit a valid "no".
  - Arrays of objects (repeaters) and nesting below one group are refused rather than rendered.
  - §6 suites 1–2 (`ui.schema.json`, checker mutants `UI_*`) belong to the tier-1 hint layer and the L0 attribute (spike
    C1), which are not built.
  - The ARIA check asserts named lines, not a whole-snapshot golden.
  - No pixel goldens.
  - No axe engine; adding it is an owner licence decision.
  - The scale suite (60 fields, 500-row evidence) is covered only by the limits.
- **The E-bed host is not wired.** `beds/ebed/` is another agent's. The bed host should do three things:
  1. `compileForm` each `humanTasks[]` entry with `bind: { taskId }`;
  2. send its declared share of actor answers through `submissionFromAnswer` (or `formStateFromAnswer`) and
     `acceptSubmission`;
  3. grade against `canonicalAnswer`.
- **Engine and sidecar profiles differ on `pattern`.** Before a runtime host uses a pattern form, either the engine
  gains an isolated pattern validator, or the host compiles with `allowPattern: false`.
- **`web/app.js` `readAnswer` uses `Number()`.** It accepts `"0x10"` (16), `"0b101"` (5) and `"12."`. `Runtime.answer`
  still type-checks, so a wrong number of the right type gets through. `web/` is in the kit hash, so this is recorded
  here and not fixed.
- **Untested shapes.**
  - Single-line inputs cannot hold line breaks (the browser gap above).
  - A required text field without `minLength` accepts a blank entry (compile warning).
  - `title` is accepted although `src/schema-subset.mjs` `PORTABLE_KEYWORDS` lacks it. Model output schemas use that
    list; answer schemas do not.
- **Timing.** The `pattern` bound is checked by a timing test with a generous limit (20 worst-case checks in under
  2 s), not by a proof.
