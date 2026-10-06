# Bed contract (v1)

A **bed** is a task family with a seeded generator and an executable oracle. Every
comparative experiment in Foundry runs arms (B0, B0+N, B1, B5, F, ceiling) over bed tasks
and scores them with the bed's oracle. Beds are trusted host code: workflows, models and
arms never see the oracle or the reference solver.

## Layout
```
beds/<family>/index.mjs        exports the interface below (Node 24 ESM, no new npm deps)
beds/<family>/README.md        what the family is, knobs, why it needs judgment, oracle rules
beds/<family>/<family>.test.mjs node:test: determinism, controls, schema, difficulty sanity
beds/lib/*.mjs                 shared helpers (seeded RNG, canonical JSON, sandbox runner)
```

## Interface (`beds/<family>/index.mjs`)
```js
export const family = { id, domain, version, description, kind: 'oneshot' | 'interactive' };
export const outputSchema;        // JSON Schema for the final answer (portable subset:
                                  // no pattern / oneOf / uniqueItems / $ref / format)
export function generate({ seed, split, difficulty }) -> Task
  // Task = { id, family, seed, split, difficulty,
  //          prompt,      // natural-language statement a human/agent would receive
  //          inputs,      // JSON-serialisable data the solver may read (may be large)
  //          files?,      // optional { relativePath: textContent } materialised in a workspace
  //          budget? }    // optional suggested limits (actions, tokens)
  // Pure function of (seed, split, difficulty): identical calls give byte-identical tasks.
  // The hidden truth needed by the oracle MUST NOT appear in prompt/inputs/files.
export function oracle(task, output) -> { pass: boolean, score: number /*0..1*/, details }
  // Deterministic. Recomputes the truth from (seed, split, difficulty) itself; never trusts
  // anything in `output` beyond its value. Rejects schema-invalid output (pass:false).
export function referenceSolve(task) -> output     // known-good control: must pass
export const badControls = [{ name, make(task) -> output }]   // known-bad: must fail
                                  // at least: 'empty', 'shuffled-or-corrupted', and one
                                  // 'plausible-but-wrong' near miss
// Interactive beds additionally:
export function createEnv(task) -> { reset(), step(action) -> { observation, done, reward, info },
  observe(), snapshot() -> opaque, restore(snapshot), actions() -> legal action list,
  determinism: 'D0' | 'D1' | 'D2' }
  // and `output` for the oracle is the episode record { actions: [...] } replayed by the
  // oracle in a fresh env.
```

## Rules
- **Seeded and pure.** Use `beds/lib/rng.mjs` (no `Math.random`, no wall clock).
- **Splits.** `split` is `'dev'` or `'test'`; generators may use it only as RNG salt.
  Sealed held-out families live elsewhere (see `beds/sealed/`), authored by a separate agent.
- **Judgment, not just computation.** Each family must contain genuine natural-language
  or perceptual judgment (ambiguous formats, aliases, prose rules, misleading evidence)
  *and* procedural load (many items, long inputs, constraints to track). A family that a
  20-line deterministic script solves from the inputs alone is not acceptable.
- **No contamination.** Use fictional entities, generated text and fresh combinations;
  never copy benchmark data.
- **Difficulty knob.** `difficulty` 1..5 scales size/ambiguity. Document the expected
  input size in tokens per level (aim: level 3 ≈ 6–15K tokens).
- **Oracle health.** The test file must show: determinism (two generations identical),
  `referenceSolve` passes for ≥20 seeds per difficulty used, every bad control fails for
  ≥20 seeds, oracle rejects schema-invalid output, and truth never leaks (assert that no
  hidden-truth string unique to the answer appears verbatim in prompt+inputs+files where
  that is meaningful).
- **Untrusted text.** Task text may contain adversarial strings (prompt-injection lines in
  logs/docs) at higher difficulty; they are data. Mark them in README.
- Runtime limits: `generate` and `oracle` each < 2 s and < 200 MB at difficulty 5.
