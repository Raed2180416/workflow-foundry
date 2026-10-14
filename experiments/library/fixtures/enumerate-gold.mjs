// Gold for the M4 enumeration coverage measurement (ATTACK-20261014 §3 M4; PROOF-LEDGER K6; $0). Written and committed
// BEFORE experiments/library/enumerate.mjs existed or ran on any task, and frozen: the result JSON records this file's
// sha256, and a change after the first run is a new gold that must be reported beside the old one, never in its place.
//
// Four definitions. The first two are primary (the M4 kill rule's "coverage" reads them); the others are reported.
//
// 1. CARD FIXTURES (primary; 15 tasks). The `positive` fixture of every executable card (cards/Pxx/fixtures/positive.json)
//    is a task whose correct composition is that card alone: T4 (cards.test.mjs, ebed-cards.test.mjs) runs it with the
//    card's worked-example slots and gets the expected output. Gold: [card]. The task's output type is the expected
//    output's shape (code-derived), and its input type is the inputs' shape (no TaskSpec exists for a card fixture).
//
// 2. W-BED CORE (primary; 18 tasks = R1, R2, R3 x dev seeds 373-378, the step-6 fixture tasks). Rule, fixed before any
//    enumeration: take the JUDGED steps of the rung's reference outline (W-BED.md §3.1-3.3 "Reference outline"; the bed's
//    `structure.outline`), map each to the executable card whose skeleton holds that judge, keep the outline's order; for
//    R3, the fan-out / fan-in rung, add the code fan-in that ends its outline. A candidate covers the task when it
//    contains one of the rung's cores as an ORDERED SUBSEQUENCE. Every other card in the candidate is glue (the spine
//    that reshapes the inputs, a code reduce that shapes the output); the enumerator has already type-checked the whole
//    sequence. Child plans of P54 are not enumerated, so a decomposed solution ([P01, P54] with the judged work inside the
//    child) does not cover a core; that is a stated limit of the measurement, not a gold choice.
//    - R1 "ledger close": the outline's judges are "judge per system on the convention note" (P03 CONV_JUDGE: read once
//      per source, quote-checked) and "judge on band pairs" after "cluster with a borderline band" (P16 SAME over BAND),
//      in that order. The "attach invoices ... and payments" step and the report are code (glue). Core [P03, P16].
//    - R2 "inbox router": the outline's kind judge ("judge kind ... enum of routes incl. review + quoted cue") with
//      "flag + review queue when the kind judge says review or its samples split", then "JS switch on kind -> per-kind
//      handler". The card algebra splits this one judge into P07 (judged classify, then dispatch to per-kind handlers,
//      which may be called children) and P09 (judge -> confidence gate -> review queue); P07's J3 adds P09. No text
//      orders the two, so both orders are accepted. The per-kind fact readers are P07 handler children (not enumerated).
//      Cores [P07, P09] and [P09, P07].
//    - R3 "statement audit": the outline's only judge is "judge per remaining difference: PRICE / FX / MISSING_CREDIT /
//      UNEXPLAINED with the quoted note" after "match statement and ledger" (P17: MATCH, EXPLAIN per difference, ADJUST,
//      the difference identity), then "step reduce (code): per supplier per reason sum ... totals" with "Z3 fan-in
//      conservation" (P15, whose checklist names "W-bed R3: Σ adjusted = ledger difference"; or P12's code REDUCE, which
//      BUILD-ORDER §4 also lists for R3). Cores [P17, P15] and [P17, P12].
//
// 3. W-BED DECLARED (secondary): BUILD-ORDER §4's pattern column for the rung (= experiments/library/l2.mjs WBED_GOLD, the
//    gold of step 5's retrieval numbers), executable members only (P05 and P14 have no card). It is a set of patterns
//    the rung needs, not a plan, and R1's six members cannot fit in four positions. Reported: the best single
//    candidate's recall of the set, and whether full containment is possible at depth <= 4.
//
// 4. SCRIPTED PLANS (soundness, not coverage): the step-6 scripted plans (fixtures/construct-scripts.mjs S5), which
//    assemble, pass the composition checker and smoke-run schema-valid at $0 (construct.test.mjs T2 full). They are not
//    R1-R3 solutions (no oracle was run), but they are known to be type-valid, so an enumerator that prunes one is
//    unsound. R3's plan is the parent level of S5b: [P01, P54].
export const WBED_RUNGS = Object.freeze(['r1', 'r2', 'r3']);
export const WBED_SEEDS = Object.freeze([373, 374, 375, 376, 377, 378]);

export const WBED_CORE = Object.freeze({
  r1: Object.freeze([Object.freeze(['P03', 'P16'])]),
  r2: Object.freeze([Object.freeze(['P07', 'P09']), Object.freeze(['P09', 'P07'])]),
  r3: Object.freeze([Object.freeze(['P17', 'P15']), Object.freeze(['P17', 'P12'])]),
});

export const WBED_DECLARED = Object.freeze({   // BUILD-ORDER §4 (l2.mjs WBED_GOLD); P05, P14: no executable card
  r1: Object.freeze(['P01', 'P03', 'P13', 'P16', 'P17', 'P20']),
  r2: Object.freeze(['P07', 'P08', 'P09', 'P05']),
  r3: Object.freeze(['P12', 'P14', 'P15', 'P17']),
});

export const SCRIPTED_PLANS = Object.freeze({   // fixtures/construct-scripts.mjs S5 (parent level)
  r1: Object.freeze(['P01', 'P03', 'P12']),
  r2: Object.freeze(['P01', 'P07', 'P12']),
  r3: Object.freeze(['P01', 'P54']),
});

// Card fixtures: the gold of the positive fixture of card `id` is exactly [id] (a one-card candidate equal to it; a longer
// candidate that merely contains the card does not count). W-bed cores match as ordered subsequences (definition 2).
export const fixtureGold = id => Object.freeze([Object.freeze([id])]);
export const MATCH = Object.freeze({ fixture: 'exact', wbed: 'subsequence' });

// Does `seq` contain `core` as an ordered subsequence?
export function containsInOrder(seq, core) {
  let i = 0;
  for (const id of seq) if (id === core[i]) i++;
  return i === core.length;
}
