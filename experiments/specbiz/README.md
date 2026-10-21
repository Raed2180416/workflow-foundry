# specbiz: E8 as a messy business (SPEC-0), and its four-layer intent truth

FIRST-CLASS-PROGRAMS §4.4 "F4 Spec from a messy business", first stage, built 2026-10-21 at $0 (no model call). The design
and the results are in [research/intent-20261021/DESIGN.md](../../research/intent-20261021/DESIGN.md). Development and
diagnostic material only: nothing here is evidence about any arm, and no arm has run on it.

E8's perfect rulebook (`beds/ebed/e8/spec/SPEC-E.md`) is split into units, each unit is assigned by code (seeded) to one
carrier of a messy business, and a deterministic renderer writes the business: an outdated and a current SOP page, e-mail
threads that correct the SOP, an e-mail from someone with no authority, precedent exports whose outcomes reveal a rule,
near-duplicate and irrelevant documents, and an owner who knows the rest. CONTRACT.md and the API schemas stay exact, and
so does SPEC-E's platform part (§1–§3, as `PLATFORM.md`).

| carrier | gold ids per pack | what the builder sees |
|---|---|---|
| sop | 16 | `wiki/SOP-order-handling-v3.md` states the rule |
| override | 3 | SOP v3 states a stale version; a later e-mail from Mara or Joost quotes it and gives the current one ("I'll fix the wiki after go-live") |
| email | 4 | only an e-mail from Mara or Joost states it |
| records | 4 | only a precedent export (`records/*.csv`) reveals it; the rows fit the rule and contradict each named alternative |
| owner | 3 | only the owner knows it: answerable by asking |

Every pack also has SOP v2 (a near-duplicate with every stale variant), one unauthorised e-mail (a carrier's account manager,
a temp or a marketing intern; seeded), and six fixed distractors (the outlet shop's policy, a never-adopted draft, the old
app, a carrier product the shop does not use, a newsletter with tempting bad advice, office chatter).

## Files

| file | does |
|---|---|
| `spec-units.mjs` | SPEC-E zones and units (30 gold ids R1.1–R7.2, S1–S9; extras U12, NTF, S10–S15); `PLATFORM.md` with its listed edits |
| `content.mjs` | the analyst-written texts: one paraphrase, anchor, subject terms and eligibility per unit, stale variants, cast, request, unauthorised senders, distractors, owner extras |
| `carriers.mjs` | the seeded carrier assignment with fixed quotas; allowed carriers and provenance tags |
| `precedent.mjs` | the six precedent templates (R1.2, R1.4, R4.3, R4.5, S1, S6), each with the rule, named alternatives and `discriminates()` |
| `render.mjs` | the truth-first renderer: a content-addressed pack (files, carriers, fragments, owner records, digest) |
| `leak.mjs` | the leak gates: L1 8-word SPEC-E shingles, L2 placements, L3 unit anchors; verbatim share |
| `coverage.mjs` | the coverage gate through the author-written mapping (documents and owner routes) |
| `owner-sim.mjs` | the owner simulator: closed-list match, pre-rendered answers, seeded withholding unless the subject is named, 20-question budget, journal and byte-identical replay, Ask-F1 and wasted questions |
| `truth-e8.mjs` | the four-layer truth: 30 gold ids by layer (6 stated, 8 implied, 16 latent), 16 extra units, 23 not-wanted items with side-effect classes and checks |
| `predicates.mjs` | effect-history predicates for the not-wanted layer, over the host journal |
| `attribute.mjs` | from an oracle verdict to the SPEC-E ids a failing case implicates; requirement recall |
| `cli.mjs` | `gates`, `render`, `truth` |
| `test/*.test.mjs` | units, assignment, renderer, leak (with planted leaks), coverage (with broken carriers), precedents, owner simulator, truth references, predicates on reference runs, controls and planted over-reach, attribution |

## Run

```sh
node experiments/specbiz/cli.mjs gates --seeds 1-20                 # leak, coverage, precedent and quota gates (~1 s)
node experiments/specbiz/cli.mjs render --seed 1 --out DIR          # DIR/files = what a builder sees; DIR/pack-truth.json = analyst side
node experiments/specbiz/cli.mjs truth --seed 1 --json FILE         # the four-layer truth of that pack
node --test --test-concurrency=1 experiments/specbiz/test/pack.test.mjs       # ~2 s
node --test --test-concurrency=1 experiments/specbiz/test/owner-sim.test.mjs  # <1 s
node --test --test-concurrency=1 experiments/specbiz/test/truth.test.mjs      # ~12 s (runs the E8 host on small dev worlds)
```

## Not built here (SPEC-1 needs them)

- The SPEC-1 runner. It must bind the host with `specE: ''`: `beds/ebed/host/host.mjs:435` otherwise puts
  `spec/SPEC-E.md` into every tick's `ctx.files`, which would hand the perfect spec to an S-derive solver at run time.
- The Haiku typed judgment behind `ask()` (`owner-sim.mjs` `MATCH_JUDGMENT` documents its interface).
- An S-derive TASK.md and an agent-arm variant that read the pack instead of SPEC-E.
- A second, independent rater for the layer of each truth item.
