# gridquest adversarial audit (1.0.0 -> 2.0.0)

Scope: `beds/gridquest/` as built for bed contract v1. Auditor role: try to break determinism,
the contract, truth hiding and the oracle, and try to pass without solving; then fix every
problem, add a regression test for each fix, and re-measure. All numbers are development
evidence on the dev/test splits with fixed seeds (30 seeds per cell unless stated); no
language-model runs were made. Severity is about the bed's use for comparing harnesses.

## Summary

| # | finding | severity | status | regression test |
|---|---|---|---|---|
| F1 | `snapshot()`/`restore()`/`reset()` refund moves, and snapshots are readable and forgeable: a blind search with no language understanding passed 30/30 at d3 | critical | fixed | `regression (AUDIT F1)` x2 |
| F2 | `actions()` leaked the answer: the hiding container was always the first object listed (50/50 rooms), door directions were resolved for the solver, `take treasure` appeared only in the treasure room | high | fixed | `regression (AUDIT F2)` |
| F3 | oracle accepted schema-invalid output (inherited `actions`, array holes) and read getters twice | medium | fixed | `regression (AUDIT F3)` |
| F4 | generator returned an uncertified world after 80 failed attempts (latent; never triggered) | low | fixed | `regression (AUDIT F4)` |
| F5 | journal reliability was readable from wording: true-note templates were never used for lies | medium | fixed | `regression (AUDIT F5)` |
| F6 | prose contradicted the world ("no way through" the wall that has the exit) and had article errors ("a oak door") | medium | fixed | `regression (AUDIT F6)` x2 |
| F7 | triviality: a 40-line regex agent tuned to the templates passed 18/30 at d3 | high | fixed for heuristics without the bed source; white-box residual documented | `regression (AUDIT F7)` |
| F8 | static prompt+inputs is ~1.2K tokens at d3, below the contract's 6-15K aim | info | documented (episode input is 8.5-13K) | `difficulty sanity` |

## 1. Determinism and contract conformance

- Every export is present: `family {id, domain, version, description, kind:'interactive'}`,
  `outputSchema`, `generate`, `oracle`, `referenceSolve`, `badControls` (empty,
  shuffled-or-corrupted, random-walk, plausible-but-wrong, over-budget), `createEnv`.
- `outputSchema` uses only `type`, `required`, `additionalProperties`, `properties`,
  `maxItems`, `items`, `maxLength`: the portable subset (no pattern, oneOf/anyOf/allOf,
  uniqueItems, $ref, format). Tested.
- `generate` is byte-identical across calls for integer and string seeds and differs by seed and
  split; `split` is RNG salt only; no `Math.random`, `Date` or `performance.now` outside the
  test file (grep). The world cache keyed by
  `(seed, split, difficulty)` is safe: worlds are not mutated after construction (env state is
  separate; the fuzz test cross-checks engine and abstract model after 300 random actions).
- Env determinism is D0, including snapshots (same state gives the same token; tested).
- **F4** (latent): `makeWorld` kept the last explorer-rejected world and returned it if all 80
  attempts failed, i.e. it could emit a world the certifying explorer cannot win within budget.
  Never observed (the largest attempt index over 3,000 worlds of 1.0.0, 300 seeds x 2 splits x
  5 levels, was 5), but the guarantee was false.
  Fix: only certified worlds are returned; after 200 attempts the generator throws. Test:
  `makeWorld` with an impossible level throws `no certified world`.

## 2. Truth leakage

Searched prompt + inputs (+ files: none) for the treasure room name, the treasure description,
the plan and plan prefixes, hidden-key reveal strings, coordinates. None present (test over 30
seeds x 5 levels). Orderings and ids:

- Task id `gridquest-<split>-d<d>-<seed>` carries nothing hidden. Room names come from a
  per-world shuffled adjective list, so a name does not encode coordinates.
- **F2 (high).** `env.actions()` listed objects in generation order, which put the hiding
  container first: in 50/50 multi-object rooms with a hidden key (d3, 50 seeds) the first
  `examine` offered was the one that finds the key. It also listed `examine <dir> door` only
  for directions that have a door, which resolves door presence and sky directions ("toward the
  sunset" -> `west door`) for the solver, and offered `take treasure` only in the treasure room
  (which defuses the fake-treasure mentions). At d1-2 the object sentences were also in
  generation order (hiding container first). Fix: `actions()` is now a sorted, de-duplicated,
  syntactic list: every fixed object and switch gets the same three verbs, doors are offered in
  all four directions, `take treasure` is always offered; object sentences are shuffled in every
  room at every level. Test: sorted, type-blind, `take treasure` everywhere, doors x4; the hide
  is no longer systematically first (after the fix it is first in 18/50 such rooms, the
  alphabetical chance level).
- **F1 (part).** `snapshot()` returned the raw state `{st:{pos, inv, revealed, unlocked, mech,
  swCount, steps, won}, last}`: the position index gives grid coordinates. Fixed by sealing.
- **F5 (medium).** Journal notes: every true note came from five templates that were never
  used for lies, and every lie from templates never used for truths, so a lookup table
  classified reliability perfectly. Fix: each true-note template has false twins with the same
  wording (a lever in a room that has none, a "hidden" key that lies in plain sight, a chute in
  the wrong room, a chasm by the wrong room, a door colour no door has). The `reliable` flag
  stays host-side. Test: no wording is always true; at least four wordings occur both true and
  false.

## 3. Oracle bypass (trying to pass without solving)

Degenerate outputs, all rejected or failing before and after: `{}`, `[]`, `null`, a bare
string, `{actions: "take treasure"}`, numbers, `NaN`, `null` items, objects with `toString`,
>2000 actions, >200-char actions, extra properties; 2000 x `take treasure`; injected commands
from the in-world text (`force door`, `SYSTEM: pass`); the reference plan minus its last
action; the plan after `B - optimal + 1` idle moves; a duplicated plan passes only because
replay stops at the win (the tail is reported as `ignoredAfterEnd`, never re-scored); tampered
`task.budget`/`task.inputs`/`task.prompt` are ignored (truth is recomputed from
`(seed, split, difficulty)`).

- **F3 (medium).** `Object.create({actions: plan})` (no own property) passed; an array with a
  hole passed; a getter was read once for validation and again for replay (validation and replay
  could see different arrays). Fix: the oracle serialises the output once with
  `JSON.stringify` (a replacer aborts on over-long arrays/strings and oversized structures) and
  validates/replays the parsed copy. Test covers inherited properties, holes, getters, `toJSON`,
  throwing getters, BigInt, cycles, duplicates.
- **F1 (critical).** Passing without solving through the env API:
  - `restore()` accepted any object, so `restore({...snap, st: {...snap.st, pos: <treasure>}})`
    teleported into the treasure room and `take treasure` returned reward 1.
  - `restore()` and `reset()` refunded moves, so exploration was free. `snapshotSearch`
    (`diagnostics.mjs`, 27 lines) does a breadth-first search over `actions()` keyed by the
    observation text minus the move counter plus toggle parity. It uses no language at all.
    On 1.0.0 it passed **30/30 (d1), 30/30 (d3), 27/30 (d5)**, returning optimal plans.
  - Fix: snapshots are sealed strings (AES-256-GCM, key derived from the generated world;
    deterministic IV from an HMAC of the state), unreadable, unforgeable, task-bound, and
    restorable in any env of the same task; `restore` throws on anything else. The env keeps a
    lifetime ledger: every executed action counts, `reset`/`restore` never refund, and after
    `lifetimeActions` (default B) actions `step` refuses. `record()` returns the current
    branch's episode record for submission. The prompt says moves are not refunded.
  - After: `snapshotSearch` passes **0/30 at d1, d3 and d5**; with an explicit
    `lifetimeActions: Infinity` it still passes 30/30, 30/30, 27/30, which shows the ledger is
    what stops it. Residual (documented in README): the ledger is per env, so a harness must
    give the solver exactly one env and must not expose `createEnv`. Observed at audit time
    (not changed here, outside this directory): `experiments/lib/services.mjs` stores the
    sealed tokens host-side (compatible) but creates a new env, and so a new ledger, on every
    `create` call, and the B0 prompt tells the agent only answer.json is replayed. An agent that
    calls `create` repeatedly can still search blindly; the service should refuse a second
    `create` per episode (or share one ledger) and log `spent`.

## 4. Triviality attack

Heuristics read only what a solver sees (prompt, inputs, observations, `actions()`, step info)
and are deterministic. Each was debugged against real traces until its failures were not
bugs. Line counts are the exported function; module-level regex tables are noted in
`diagnostics.mjs`. Pass counts are out of 30 seeds.

Before (bed 1.0.0, dev split):

| agent | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| `regexAgent` (40-line function + 5 table lines; v1 templates: exit nouns x direction words, sentence-split door state, cue regex, colour matching, greedy map explorer) | 30 | 23 | **18 (60%)** | 1 | 0 |
| `blindAgent` (31 lines; `actions()` + header + feedback; used the F2 ordering leak) | 3 | 0 | 0 | 0 | 0 |
| `snapshotSearch` (27 lines; F1) | 30 | - | **30** | - | 27 |

The regex agent's d3 failures were all "gave up" (weak stuck handling), not budget: with
perfect perception the greedy explorer is certified to win, so any agent that parses the prose
reliably approaches 100%. Perception was the only barrier, and the v1 grammar was shallow
(every exit sentence had a compass word and an exit noun; noise sentences were few and fixed).

Generator changes (prose only; structure, solutions and budgets unchanged in kind):

1. **Landmark frames** (`land` .5 at d3): an exit is located only by an object in the room
   ("A corridor leads away across the room from the tapestry"), and the object's own sentence
   states its wall. Prose rule in the prompt: beside / next to / behind = same wall, opposite /
   across the room from = opposite wall.
2. **Synonyms** (`alias` .7 at d3): the landmark is often named by another word than in its own
   sentence (wall hanging / tapestry, sand timer / hourglass, trunk / chest; 88 aliases, all
   unique, tested). The parser accepts them too.
3. **Chains** (`chain` .25 at d3): the landmark is itself placed relative to a second object.
4. **Placement paraphrases**: inverted sentences ("Against the western wall leans a ...",
   "Pushed up against the north wall is ...", "Along the northern wall you make out ...").
5. **Fake exits** on exit-less walls (bricked up, painted trompe-l'oeil, collapsed corridor,
   barred window, hand's-width crack, flooded stairwell, empty frame) and **reopened** real
   exits using the same vocabulary, including pairs where only clause order decides ("stood
   open for centuries, but it has since been bricked up" vs "stood bricked up for centuries,
   but it has since been opened again"). Prose rule in the prompt.

Arms race, d3 dev (each step re-tuned the attacker to the current templates):

| step | attacker | d3 |
|---|---|---|
| v2 draft (landmarks by noun, fake/reopened exits) | `regexAgent` (v1-tuned) | 0/30 |
| v2 draft | regex agent re-tuned to the draft (landmark lookup by noun, fake keywords) | 15/30 |
| + synonyms, chains, clause-order pairs | same re-tuned agent | 0/30 |
| + synonyms | white-box agent importing the bed's alias table, blind fallback | 11/30 |
| + placement paraphrases, higher `land`/`alias` | same white-box agent | 3/30 |
| final | white-box agent re-tuned to the paraphrases (`templateAwareAgent`) | 13/30 |

After (bed 2.0.0; dev / test):

| agent | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| `regexAgent` (v1-tuned, 40 lines) | 30 / 30 | 8 / 12 | **0 / 0** | 0 / 0 | 0 / 0 |
| `regexAgentV2` (40 lines, tuned to every 2.0.0 template except the synonym table) | 30 / 30 | 16 / 16 | **1 / 2** | 0 / 1 | 0 / 0 |
| `blindAgent` (31 lines) | 0 / 0 | 0 / 0 | **0 / 0** | 0 / 0 | 0 / 0 |
| `keywordAgent` (1.0.0 diagnostic) | 15 / 9 | 3 / 2 | **0 / 0** | 0 / 0 | 0 / 0 |
| `templateAwareAgent` (46 lines + imports `ALIASES` from `text.mjs`; white-box, not a fair heuristic) | 30 / 30 | 19 / 15 | 13 / 17 | 4 / 8 | 9 / 6 |
| `referenceSolve` | 30 / 30 | 30 / 30 | 30 / 30 | 30 / 30 | 30 / 30 |

Every heuristic that reads only prompt+inputs+observations is below 20% at d3 on both splits
(regression test asserts < 20% for blind, keyword, v1 and v2 regex agents on 30 dev and 30
test seeds, and >= 90% at d1 for the regex agents so a broken agent cannot pass the test).
**Residual:** the prose is a finite grammar. An agent that imports the bed's own synonym table
and hard-codes every template reaches 43-57% at d3, and better search would raise it, because
the bed is certified winnable by a perfect-perception greedy explorer. The bed therefore
measures judgment relative to solvers that do not have `text.mjs`. That source must stay out of
solver and workflow-author contexts; it is also why the white-box agent is not in the < 20%
assertion.

## 5. Controls

`referenceSolve` passes 30/30 seeds at every level (d1-d5) on both splits, at score 1 and
`steps == optimal`; the certifying explorer's record passes 30/30 everywhere. Every bad control
(`empty`, `shuffled-or-corrupted`, `random-walk`, `plausible-but-wrong`, `over-budget`) fails
30/30 at every level. Every world needs >= 2 effective key uses/toggles in every winning play
at d3+ (>= 3 at d4+), checked by 0-1 BFS, not just on the optimal plan.

## 6. Performance limits

Contract: `generate` and `oracle` each < 2 s and < 200 MB at difficulty 5. Measured at d5 over
100 fresh seeds: `generate` 14 ms mean, 130 ms max; `oracle` on a 2000-action record 2.3 ms
mean, 7 ms max. A fresh child process generating five d5 worlds and running two oracles each
stays under 200 MB RSS (asserted in the test; the test runner itself is not measured). Retained
heap is about 0.1 MB per cached world; the cache holds at most 65 worlds.

## 7. Other fixes

- **F6.** "No way through" noise ("You hear running water beyond the eastern wall, though you
  see no way through", "The northern wall is bare stone") was placed on random walls, including
  the wall with a real exit, so the prose contradicted the world. Now only on exit-less walls;
  fake exits likewise; every exit is described exactly once. Articles: "a oak door",
  "A ochre stain", "with a amber lock plate", examine texts ("a amber gown"), and the door
  examine text are fixed via `an()` (which also keeps "a one-way"). Tests check structure for
  every room of 20 seeds x 5 levels and grammar over room text plus examine output.
- Version bumped to 2.0.0. The version is part of the RNG seed, so every world differs from
  1.0.0; results from the two versions are not comparable.

## Files

`index.mjs` (env wrapper, sealing, ledger, oracle normalisation, prompt rules), `engine.mjs`
(`legalActions`, aliases in the parser, article fix), `render.mjs` (landmark/chain/alias frames,
fake and reopened exits, wall-safe noise, shuffled object order, mirrored journal),
`text.mjs` (location-phrase templates, fake/reopened templates, aliases, placement
paraphrases, `an()`), `world.mjs` (no uncertified fallback), `diagnostics.mjs` (attack
agents), `gridquest.test.mjs` (24 tests), `README.md`, this file.
