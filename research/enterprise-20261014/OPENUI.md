# OPENUI: thesysdev/openui for Foundry nodes and widgets — evaluation and spike plan

*Final version, 2026-10-14, about 14:15 UTC, branch `claude/intelligent-hamilton-vg1f9a` at `48ac5d1`. The owner asked
us to "look at https://github.com/thesysdev/openui if needed for generating UI/UX for nodes/widgets". This merges the
OpenUI evaluation (source 3), the E-bed design's UI section and the critique's UI finding, with a consolidation
spot-check of the code claims (§11). Development and diagnostic evidence only.*

*$0: no model calls, nothing installed, built or executed from OpenUI; `beds/sealed/` and credential files not read; web
and clone text treated as data. Imports are recorded in [ACQUISITIONS.json](ACQUISITIONS.json).*

**Evidence tags.** [code] observed in the OpenUI clone at `39ce989`; [data] computed from the vendor's committed result
files; [doc] a vendor or web-page claim; [M] a Foundry repo file; [I] inference; [n/a] unavailable; [✓] spot-checked
again in the consolidation pass.

---

## 0. Verdict

1. **Do not adopt OpenUI as a Foundry dependency or UI language now.** It is a competent MIT project, but React-centred,
   released as Lang 1.0 on 2026-10-12, and the vendor's own benchmark shows small models complete only 25.1% of screens;
   there is no Haiku data at all [data].
2. **(a) Run and stream UI: no.** `tools/run-view` already renders the deterministic, hash-chained event data as text
   under a strict CSP with no dependencies; nothing there needs model-generated layout.
3. **(b) Human-task UI (approvals, review queues, exception screens): yes, but Foundry-native.** Compile the form from
   the task's `answerSchema` by code (tier 0); let a cheap model fill only a small, checked JSON hint layer (tier 1).
   The host re-validates every answer.
4. **(c) A typed L0 construct: yes**, as presentation-only `ui.form` / `ui.view`, folded into existing rows 16/17/9 as an
   optional attribute (≤ 70 card tokens, paid for by an equal cut), with a static checker and an executable oracle.
5. **(d) The enterprise bed uses it on the critical path**: a share of scripted human answers passes through the
   rendered tier-0 form and an OpenUI-shaped `formState` adapter, so UI defects show up as case failures (E-BED §2.7).
6. **Borrow, do not depend**: OpenUI's component and validation-rule vocabulary, its error object (code, statement id,
   hint), its conformance-fixture layout (`input`, `expected`, `interactions`), and its per-unit recovery idea.
7. **Revisit OpenUI Lang** only as an optional authoring surface for read-only worklists, and only if Haiku 5.5 passes
   the preregistered kill rule (§8, spike B2).

---

## 1. Import record

| id | url | commit | date | licence | outcome |
|---|---|---|---|---|---|
| openui | https://github.com/thesysdev/openui | `39ce9899f9d06ff764934d7f1f160936efc348e6` (2026-10-14T12:28Z) | 2026-10-14 | MIT, root LICENSE "Copyright (c) 2011-2024 Thesys Inc."; packages have a licence field but no per-package LICENSE; `@openuidev/react-email` has no licence field [code] | shallow clone, 567 MB, read statically, never installed or built (`/var/tmp/foundry-work/enterprise-src/openui`) |
| generative-ui-bench | https://github.com/thesysdev/generative-ui-bench | `fcca05af68dc3acc5b04660531509b4aed861c7e` (2026-09-08) | 2026-10-14 | **none found**; treated as all rights reserved | shallow clone, 99 MB; committed `results/*.json` read, aggregates derived only; scorer not run |

Pages opened (WebFetch): the OpenUI GitHub page; google/A2UI; a2ui.org; ag-ui-protocol/ag-ui; idosal/mcp-ui;
modelcontextprotocol/ext-apps; vercel-labs/json-render; rjsf-team/react-jsonschema-form; eclipsesource/jsonforms. npm
registry metadata (no tarballs) for the pinned versions. The `gh` API was refused (repo not attached), so star, fork and
commit counts come from a summariser's reading of the HTML page [doc]: 10.9k stars, 733 forks, 1,030 commits.

---

## 2. What OpenUI is [code unless tagged]

- **Input and output.** A developer defines a component library with Zod → JSON Schema → LibrarySpec;
  `generateSystemPrompt` turns it into a system prompt (a local string function); any LLM writes **OpenUI Lang**, a
  line-oriented DSL (`root = Card([header])`, `Button("Save", @ToAssistant("x"))`) with positional arguments and hoisted
  names (forward references allowed); the client parses against the JSON Schema. Spec, prompt and fixtures are in
  `spec/language.md`, `spec/prompt.md`, `spec/fixtures/1.0`.
- **Runtime model.** State is `$vars` with two-way input binding; a closed expression grammar plus `@Count`, `@Filter`,
  `@Sort`, `@Each`; custom functions pure by contract. `Query(tool, args)` runs when streaming ends and when a literal
  `$variable` in its args changes; `Mutation` runs only via `@Run`. Actions: `@ToAssistant`, `@OpenUrl`, `@Set`,
  `@Reset`, `@Run`, custom `@Name(args)` (§6.3). Edits are patches merged by statement name; errors are recovered per
  statement. React renderer at 1.0; Vue, Svelte and Angular at 0.4.x on Lang 0.x.
- **Validation** (`spec/language.md:378–382`) [✓]: rules `required`, `email`, `url`, `numeric`, `minLength`,
  `maxLength`, `min`, `max`, `pattern`; **`numeric` passes any non-blank string whose `parseFloat` is not NaN, so
  `"12abc"` passes**; every rule except `required` skips empty values; a form submits only when every field passes. All
  validation is post-hoc against JSON Schema; there is no grammar or constrained decoding (grep for grammar/GBNF found
  nothing).
- **Events** (`:427–446`) [✓]: custom actions send `{type, params}`; every event carries `formName` and `formState`,
  where inside a form each field is `{ value, componentType }`.
- **Dependencies and licences** (pinned in `pnpm-lock.yaml`, licences checked in the registry): `lang-core@1.0.0` has 1
  dependency (`ci-info` 4.4.0, MIT), peer `zod` 4.4.3 (MIT), 1.4 MB unpacked; `react-ui@0.18.0` has 34 direct
  dependencies, 15 MB (Radix, `@tanstack/react-table`, `d3-*`, `lucide-react`, `react-markdown`, `remark-*`,
  `rehype-katex`, `date-fns`, `lodash-es`, `zustand`), all MIT or ISC; React 19.2.4 MIT. `@ag-ui/core@0.0.57` and
  `@openuidev/react-email@0.4.0` have no licence field.
- **Hosted pieces.** Parse and render need no key. The quickstart and benchmark use `OPENAI_API_KEY`. Gateway, Autofix,
  Cloud, `generateSystemPrompt({cloud:true})` and Reliability Monitoring are optional hosted Thesys services
  (`THESYS_API_KEY`) [doc, code]. Autofix can be reproduced with parser error objects and our own model.
- **Telemetry.** `@openuidev/lang-core` has `"postinstall": "node ./postinstall.cjs"` (package.json:56) [✓], which sends
  install telemetry to PostHog unless `OPENUI_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`; runtime telemetry is opt-in; in
  `NODE_ENV=development` react-lang auto-mounts DevTools, which fetches a CDN build. `npm ci --ignore-scripts` neutralises
  the first; the second needs `NODE_ENV=production` and network-blocked tests.
- **Maturity.** Spec 1.0 dated 2026-10-12; npm latest equals the repo (lang-core 1.0.0, react-lang 1.0.0, react-ui
  0.18.0, a2ui 0.5.0 experimental); 137 test files, about 1,062 test cases; 59 conformance fixture folders (58 with
  `expected.json`, 12 with interaction scripts); CI with a frozen lockfile; 8 self-reported adopters. A listed breaking
  change: a program whose `root` is written last renders nothing while streaming.

---

## 3. Reliability evidence (the vendor's committed results, recomputed) [data]

70-component catalog, 46 briefs × 4 runs, temperature 0.7. "Complete" = parses, has a root, every reference resolves,
enums and required props valid, a component-count floor met. It does not check semantic correctness.

| model class | runs | complete |
|---|---|---|
| 10 frontier API models | 1,840 | 97.5% |
| mid/open (Qwen3.8-27B at 4 efforts, DeepSeek flash/pro, GLM-5.3, Gemini flash-lite) | 1,470 | 84.5% |
| small/open (Gemma-4 31B and A4B, Phi-4, Ministral 8B, Granite 8B, Ling-tiny, LFM2.5) | 1,288 | 25.1% |

- Easiest band (B1, 2–3 requirements): Gemma-4 31B 42.5%, Ministral 8B 52.5%, Granite 8B 37.5%, Ling-tiny 30%, Phi-4
  77.5%, Qwen3.8-27B 85–90%, Sonnet 5 100%. **Haiku is absent** [n/a].
- Failure classes among small-model incomplete runs (overlapping): reference-graph 53%, positional-signature mismatch
  43%, enum mismatch 42%.
- Vendor claims about 7% first-pass production failures with repair recovering about 9 in 10 [doc]. Its system prompt is
  5,031 tokens at 70 components [doc]; the bundled default prompt (53 signatures) is 13,194 characters, about 3.8K tokens
  at chars/3.5 [I], a floor for Haiku's tokenizer. Foundry's constructor cap is 8K input tokens per call (D2) with the L0
  card already at 2,962 of 3,000 [M].
- The "up to 67% fewer tokens than JSON" claim comes from a benchmark where only OpenUI Lang is generated and the other
  formats are projections of the parsed result [code]: it measures encoding size, not generation reliability.

---

## 4. Security notes (read, not exercised) [code, spot-checked ✓]

- No `eval`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML`, `v-html`, `{@html}` or `bypassSecurityTrust` in
  non-test runtime source; model output is data for a bounded interpreter. Markdown uses `react-markdown` without
  `rehype-raw`; links get `noopener noreferrer`.
- URL guards are used at 4 consumer call sites [✓]: `safeUrl` in `EditableTable/.../TextBaseEditableCell.tsx:127`,
  `safeOpenUrl` in `Sources/SourceContext.tsx:19`, `toCssUrl` in `VisualCardBlock.tsx:29` and `ContextCardBlock.tsx:33`.
- `Image` and `ImageBlock` pass the model's `src` straight to `<img>`: a GET exfiltration and tracking channel unless CSP
  `img-src` blocks it.
- `react-ui/src/components/OpenUIChat/utils/actionMessage.ts:28` calls `window.open(url, "_blank")` with no scheme check
  and no `noopener` [✓]; the assistant-ui and a2ui renderers pass `noopener,noreferrer` but do not check the scheme.
- `lang-core/src/utils/validation.ts:122` builds `new RegExp(arg)` from a model-supplied `pattern` with no complexity
  bound [✓]: a client-side ReDoS risk [I].
- Queries auto-run model-chosen tools and arguments from the browser; the vendor's docs say to treat them as untrusted
  [doc]. No sandbox or iframe in the core path.
- No automated accessibility tests found (grep for axe); label association via `htmlFor` in `genui-lib/FormControl`.

---

## 5. Fit by use

### 5.1 (a) Run and stream UI: poor fit
- `tools/run-view` is a deterministic fold over hash-chained events: no dependencies, no network, text nodes only,
  hashed CSP with `connect-src 'none'`, opens from `file://`; about 8,000 lines in 22 files [M]. Graph, timeline,
  1,000-item replay and live feed need no model-generated layout. OpenUI has no graph or DAG primitive; its nearest
  components are `Steps`, `Tabs`, `Table` and charts. The browser bundle is about 2.2 MB raw / 650 KB gzipped [doc],
  against the rule of minimal exact-pinned dependencies.
- A viewer that can act turns untrusted text into authority (06-ui §6 [M]); generated UI makes that harder.
- Kit hash `a572eeee1ac237aa` covers `package.json bin src schemas policy skills web node_modules`; touching any voids the
  engine freeze. `style-src 'self'` may collide with Radix style injection [I].

### 5.2 (b) Human-task UI: real need, Foundry-native design `foundry-ui/1`
- Today a `human` node has `question` + `answerSchema`; `web/app.js:594–616` renders enum/boolean as a select, number as
  a number input, and string or object as a textarea — object answers are a raw-JSON textarea [M]. Approvals show exact
  tool arguments, risk and workflow hash, rendered by code (`web/app.js:654`) [M]. Server authority is
  `validateData(state.answerSchema, answer)` at `src/runtime.mjs:294` [M]; OpenUI's client validation could only be
  advisory.
- **Tier 0 (code only, no model)**: compile `answerSchema` + `question` into a form — objects → field groups, arrays →
  repeaters, enums → select or radio, booleans → toggles, bounds mirrored. Deterministic; also the fallback.
- **Tier 1 (cheap model)**: a flat optional hint object — labels, help text, ordering, grouping, widget choice among 2–3
  allowed per type, and evidence blocks sourced by JSON-ref from run state (never typed by the model). The hint schema
  stays inside the portable subset (`src/schema-subset.mjs` rejects `oneOf`, `anyOf`, `$ref`, `pattern`, `format` [M]),
  so output can be constrained: a `kind` enum plus flat optional fields. One retry on checker codes, then drop to tier 0;
  cosmetic failure never blocks a human.
- **Tier 2 (optional)**: an allowlisted OpenUI Lang subset lowered into the same spec (spike S-O).
- **Closed vocabulary**: text, field, group, evidence (table, kv, list, quote), stat, decision (enum button group), submit.
  No URLs, images, HTML or markdown; no regexes in hints (constraints come only from `answerSchema`); no actions except
  submit; all text as text nodes with a trust chip; approval cards stay code-rendered with model prose beside them
  labelled "model-written, untrusted". Review queues follow P09: each item shows a quote and reason; the decision enum
  comes from the answer schema; no bare ids.
- **Where it lives**: a sidecar keyed by workflow hash + node key — `tools/ui/` (code), `experiments/ui/` (evals),
  `tests/` (regressions). `schemas/workflow.schema.json` has `additionalProperties:false` on nodes and `schemas/` is in the
  kit hash, so an in-IR `ui` field waits for an engine re-stamp (E2). The UI spec never changes workflow identity.
- **Capability number vs baseline** (AGENTS: every phase yields a number): *completability* (exact; every valid answer is
  enterable and every mutated-invalid answer is rejected, matching the server — a differential oracle) and *decision-fact
  coverage* (share of required evidence paths per task present in the rendered DOM; tier 0 scores 0 beyond the question
  text, the baseline to beat). Jev is not independent (E1), so it does not score.

### 5.3 (c) Typed L0 construct `ui.form` / `ui.view`
- `ui.form`: the presentation contract of a `human` node (rows 16 `approve`, 17 `ask`); its output is the answer,
  validated against `answerSchema`. `ui.view`: a read-only projection of a `done` output (row 9) with stat, table,
  bar/line, list, badge and **no actions**. Dashboard interactivity is only a `ui.form`, a signal (row 19) or a webhook
  start (row 24).
- **Card budget**: fold `ui` into rows 16/17/9 as an optional attribute at ≤ 70 tokens and cut an equal amount elsewhere;
  the 30-construct denominator is unchanged; T2 phrase assertions updated.
- **Checker codes** (one mutant each, T3 style): `UI_PATH_UNKNOWN`, `UI_REQUIRED_UNCOVERED`, `UI_WIDGET_TYPE_MISMATCH`,
  `UI_SOURCE_UNRESOLVED`, `UI_FORBIDDEN_KIND`, `UI_ACTION_FORBIDDEN`, `UI_LIMIT`, `UI_TEXT_CONTROL_CHARS`; schema check
  with ajv 8.20.0 (already a dependency); a DOM-contract test that rendered fields equal declared fields.
- **The Node-RED "interactive dashboard" refusal is closed only partly** [data, 3,129-flow local listing, 3,091 parsed;
  licence unknown, aggregates only]: 919 flows (29.7%) have a dashboard widget; 603 (65.6%) use only a 19-type closed set;
  270 (29.4%) use `ui_template` (raw HTML/JS, stays refused); 74 use other out-of-set widgets; 540 have an input widget; of
  75 flows with ≥ 20 widgets, 36 are closed-set only and 30 use `ui_template`. Those flows also use `inject` (62%),
  `function` (70%) and `mqtt in` (26%), i.e. L0 rows 24–28 (all N). The refusal criterion becomes "any widget outside the
  closed set, or any `ui_template`". These counts are widget types only, an upper bound on what the construct explains.

### 5.4 (d) The enterprise bed (E-BED §2.7, §7)
- Every E-bed item with human tasks needs object-valued answers (hold release with reason and amount; dispute
  dispositions; SLA reassignment): gap G21 (BAR-SET §5).
- A declared share of scripted answers is delivered through the rendered tier-0 form as `formState`
  (`{ value, componentType }` per field), mapped by a host adapter to the typed answer and re-validated against
  `answerSchema`. Planted invalid entries (e.g. `"12abc"` in an amount) must be rejected by the host even where an
  OpenUI-style client rule would accept them.
- Read-only worklists (E2 hold list, E7 SLA board, E5 dispute timeline) are tier-1/2 candidates; never authority.

---

## 6. How we test it (all offline)

1. **Schema**: `ui.schema.json` with ≥ 80 positive and negative cases under strict ajv.
2. **Checker mutants**: one per code; each fires exactly its own code.
3. **Property tests**: a seeded generator of 1,000 portable answer schemas; compile gives 100% leaf coverage, is
   deterministic and idempotent.
4. **Differential validator fuzz**: about 10,000 schema/answer pairs (salted seeds, E-BED §6); client accept/reject must
   equal server `validateData`. Known divergence to include: HTML `maxlength` counts UTF-16 units while JSON Schema
   `maxLength` counts code points [I, to be verified by the test]; min/max off-by-one and unicode boundaries.
5. **Browser conformance** via Playwright 1.63.0 with `/opt/pw-browsers/chromium` (`executablePath`, `--no-sandbox`, as
   `headless-check.mjs` does [M]): served under the exact CSP from `src/http.mjs:35` [M]; every non-loopback request
   aborted; zero console errors, page errors, CSP violations and failed requests; keyboard-only completion; Tab order =
   spec order; errors linked via `aria-describedby`.
6. **Accessibility**: ARIA-snapshot goldens (`locator.ariaSnapshot()`); computed WCAG contrast (code exists in
   `headless-check.mjs`); name/role/value rules; reflow at 320 px; reduced motion. No a11y engine installed; adding
   `axe-core` (MPL-2.0 from general knowledge, not checked) is an owner licence decision.
7. **Hostile content**: about 40 payloads (HTML, script, bidi, zero-width, 10⁶-character strings, deep nesting,
   `javascript:` text, CSS injection) in every text field; assert text only, no extra elements, no navigation, no network
   (the `headless-adversarial.mjs` pattern [M]).
8. **Pixel goldens as a tripwire only**: a probe in this container produced byte-identical PNGs across three fresh
   contexts (sha256 prefix `7ca8a4667d363a30`, 11,811 bytes) and identical ARIA snapshots at 640×400, scale 1,
   `reducedMotion:'reduce'`, `animations:'disabled'`, UTC, en-US [data]. Re-baseline per image; ARIA goldens are the
   portable oracle.
9. **Scale**: 60 fields, a 500-row evidence table, queue pagination within budgets.
10. **End-to-end** through the real runtime with the scripted provider in `tools/run-view/make-fixtures.mjs` [M]:
    `awaiting_human` → render → submit → `validateData` → run completes.
11. **E-bed form route**: the `formState` adapter round-trips every actor answer on dev worlds; invalid planted entries
    are rejected by the host.
12. **Model-in-the-loop** (paid, small, §8 B2): dev and sealed splits frozen first.

---

## 7. Alternatives, compared

| option | model emits | constraint and security | fit to Foundry human tasks | cheap-model fit | maturity and licence |
|---|---|---|---|---|---|
| **JSON-Schema forms (own renderer; RJSF and JSON Forms as references)** | `answerSchema` + flat hint | closed by code; text-only rendering | **best now**: reuses `answerSchema` and ajv, no new dependency; evidence blocks need our vocabulary | strong: constrained-decoding friendly | RJSF Apache-2.0, React, ajv8, 15.9k stars [doc]; JSON Forms MIT, React/Angular/Vue, 2.7k stars [doc]; references, not dependencies |
| **A2UI** (+ AG-UI transport) | flat JSON component list with ids, `updateComponents`, data model, actions | trusted client catalog; "declarative data format, not executable code" [doc]; the default renderer blanked 35 of 1,104 runs in vendor data [doc] | good protocol fit for multi-client later; keep `foundry-ui/1` losslessly mappable | moderate: ID-reference failure class | v0.9.1 production, v1.0 candidate, "early stage public preview", Apache-2.0, 16.7k stars [doc]; AG-UI ~16 event types, MIT, 16.5k stars [doc] |
| **MCP-UI / MCP Apps** | HTML resources (`ui://`) in sandboxed iframes with a postMessage bridge | iframe sandbox and CSP are the whole defence | later, for showing Foundry tasks inside a host harness (G1), **only with Foundry-authored static HTML** | poor if model-written | MCP Apps spec 2026-01-26 Stable, Apache-2.0, ~3k stars; MCP-UI Apache-2.0, 5.2k stars [doc] |
| json-render (Vercel) | flat `elements` map | catalog + Zod | weak | 80.2% structural validity in vendor data, mostly reference-graph errors [doc] | Apache-2.0, 18.7k stars [doc] |
| **OpenUI Lang** | positional DSL with expressions and tools | component catalog; no sandbox; model-chosen tool calls in the browser | OK for chat-like surfaces; wrong power level for approvals | poor below mid-size models; Haiku unknown | MIT, 1.0, large conformance suite, hosted extras |

---

## 8. Spike plan (order, cost, gate, kill)

| # | spike | cost | does | gate / kill |
|---|---|---|---|---|
| S-A | run-view mapping | 0.5 agent-day, $0 | map each element type in `run-view`, `history`, `streams` to an OpenUI component; count elements with no equivalent; check 06-ui's diagnosis-reach metric (6 of 7 questions within 2 clicks) on one sample | **kill** OpenUI for (a) unless it beats the existing view on that metric (expected: it does not) |
| **B1** | tier 0 `tools/ui/{compile,check,render}.mjs` | ~2 agent-days, $0 | 40 fixtures: P09 queue, P32 approval, P55 ask-validate-use, P10 menu, an exception screen, object-valued answers; plus the E-bed `formState` adapter | all §6 suites 1–11 pass; completability = 100% on fixtures; the E-bed form route round-trips |
| **C1** | L0 card attribute + checker | ~1 agent-day, $0 | write the `ui` card text, measure with `experiments/library/tokens.mjs` (card ≤ 3,000), implement the checker + 24 mutants, a 40-case L1 fixture set | card within budget after an equal cut; every mutant fires exactly its code |
| **B2** | model-in-the-loop (paid, tiny) | ≈ $0.5, cap $2 [I from D22's $0.00011 per 60-token call], metered | Haiku 5.5 vs one open-weight model, 30 frozen briefs × 4 runs, K = 2; arms tier 0, tier-1 hint, OpenUI Lang with a 12-component catalog; scored on completability and decision-fact coverage | **preregistered kill rule for OpenUI Lang**: keep it only as a frontier/mid-model surface unless it is ≥ 90% complete on the 12-component catalog with a prompt ≤ 2K tokens **and** within 10 points of the JSON-hint arm, in both lineages; else drop it |
| C2 | Haiku builds human-in-the-loop workflows with `ui` hints (paid, tiny) | ≈ $1–3 [I] | 20 workflows; compare against tier 0 on completability and decision-fact coverage | tier 1 must beat tier 0 on decision-fact coverage at equal completability |
| S-O | lower vendor outputs into the allowlisted subset | $0, **needs owner consent** to install OpenUI with `npm ci --ignore-scripts`, `OPENUI_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, `NODE_ENV=production`, network-blocked, in its own `experiments/ui/` package with a lockfile | measure what share of model-written screens Foundry could admit | informs tier 2 only |

Order: B1 → C1 → S-A (cheap, may be skipped) → B2 → C2 → S-O (only if B2 keeps OpenUI Lang alive). B1 is also E-bed
build step 8 (E-BED §8.1).

---

## 9. Risks that matter

1. **Engine freeze**: any change to `src/`, `schemas/`, `web/`, `package.json` or `node_modules` voids kit
   `a572eeee1ac237aa`. Spikes stay in `tools/` and `experiments/` with their own lockfile, installed with
   `--ignore-scripts`.
2. **Telemetry and network**: install-time telemetry (default on), dev-mode DevTools CDN fetch, hosted optional services.
3. **UI as untrusted content with authority risk**: closed vocabulary, submit-only actions, code-rendered approvals, trust
   chips; never `@OpenUrl`, `Query`, `Mutation` or `@ToAssistant`.
4. **Cheap-model reliability** is poor in the vendor's data, and Haiku is unknown.
5. **Vendor-run benchmark**: first-party; "complete" is not task success; its repo has no licence (aggregates only).
6. **Licence hygiene**: MIT notice retention if anything is copied; `react-email` and `ag-ui/core` lack licence fields.
7. **Version churn**: spec 1.0 is two days old; non-React runtimes lag on Lang 0.x.

---

## 10. Not done, and unavailable

- OpenUI was not run or installed: parser, renderer, CSP behaviour with React/Radix and the §4 security gaps are read,
  not exercised.
- The benchmark was not replicated and its scorer not run; numbers are recomputed from committed results.
- No Haiku 5.5 or Foundry-task data for OpenUI Lang exists.
- Release cadence and contributor counts: not on the pages opened; API refused.
- AG-UI event names and A2UI v0.9 message schemas were not on the pages opened; the A2UI v1.0 envelope names
  (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`) come from openui's `packages/a2ui` README
  [code]. JSON Forms' schema/uischema split was not confirmed on its page.

---

## 11. Consolidation spot-checks

| claim | result |
|---|---|
| validation rules and `"12abc"` passing `numeric` (`spec/language.md:378–382`) | confirmed [✓] |
| `formState` shape `{ value, componentType }` (`:442–446`); custom actions `@Name(args)` (`:427`) | confirmed [✓] |
| URL guards at 4 call sites | confirmed: `safeUrl` ×1, `safeOpenUrl` ×1, `toCssUrl` ×2 (a plain grep for `safeUrl(` finds 3 lines because two of them are inside the guard module itself) [✓] |
| `window.open(url,"_blank")` without scheme check or `noopener` | confirmed at `react-ui/src/components/OpenUIChat/utils/actionMessage.ts:28` [✓] |
| model `pattern` into `new RegExp` | confirmed at `lang-core/src/utils/validation.ts:122` [✓] |
| postinstall telemetry hook | confirmed, `packages/lang-core/package.json:56` [✓] |
