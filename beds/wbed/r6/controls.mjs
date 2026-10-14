// Bad controls and structure-necessity controls of W-bed R6. Most are the bed's pipeline with one option set, so each has
// a full trace for the composed oracle. The generator re-draws the world until every applicable control fails the
// oracle (world.mjs setVerifier, installed by index.mjs).
//
// kind 'stage':    a mistake one stage oracle sees (plan recall or duplicates, a worker's scope verdict or cell).
// kind 'relation': every stage oracle and the reduce stage's local checks pass on the control's own trace; only a
//                  cross-item relation (Y1-Y5) and the end-to-end oracle catch it.
// kind 'heuristic': the keyword script (heuristic.mjs), reading the task text only.
// NECESSITY_DEFS (the B6 comparison's size stand-ins): one sequential context that runs out of budget, and best_of_n at
// equal tokens with the same verifier. Both fail only through the 32K-token attention hypothesis (budget.mjs); they are
// not evidence that separates `wide` from a single context or from an agent (review 2026-10-14, finding 4).
//
// Review 2026-10-14 (W-BED-R6-NOTES §13). Two former necessity controls are gone from the necessity list:
//   - 'necessity:no-plan-fixed-list' failed by construction (the generator keeps >= 2 in-scope compounds out of the lab's
//     register entries), so it showed nothing about the plan. It stays as the bad control 'plan-register-list' (a
//     plausible mistake). The plan is not necessary for correctness: a map over every indexed compound and a code plan
//     both solve every dev task (index.mjs `planAblation`, verify.mjs `codePlan`; reported, finding 2).
//   - 'no-workflow:grep-agent' grepped only the lab's full name although it read the notices that give the other names.
//     An agent that greps every name and both strings of each compound solves every task when it reads everything it
//     retrieves (index.mjs `grepAgentRun`; reported, finding 4). The weak version duplicated 'scope-alias-missed'.
export const CONTROL_DEFS = [
  { name: 'empty', kind: 'stage' },
  { name: 'shuffled-or-corrupted', kind: 'stage', why: 'right compounds and properties; values scaled and sources rotated by one row' },
  // plan / scope (the discovery)
  { name: 'scope-by-publication-date', kind: 'stage', stage: 'worker', opts: { byPubDate: true },
    why: 'a compound counts when the lab X document was published on/after the date, not tested on/after it (T1 compounds tested before Y, published after)' },
  { name: 'scope-mentions-counted', kind: 'stage', stage: 'worker', opts: { mentionsCounted: true },
    why: 'any compound a lab X document mentions counts as tested, including values it quotes from other groups (T2)' },
  { name: 'scope-void-kept', kind: 'stage', stage: 'worker', opts: { scopeVoidKept: true },
    why: 'a test reported only in a retracted lab X document still puts the compound in scope (T3)' },
  { name: 'scope-plans-counted', kind: 'stage', stage: 'worker', opts: { plansCounted: true },
    why: '"will be tested in the next phase" read as a test (T4)' },
  { name: 'scope-alias-missed', kind: 'stage', stage: 'plan', minDifficulty: 3, opts: { aliasMissed: true },
    why: 'only documents that print lab X\'s full name are lab X\'s; its abbreviation (d3) and former name (d4) are missed, so compounds tested only under them drop out' },
  { name: 'scope-namesake-lab', kind: 'stage', stage: 'worker', minDifficulty: 4, opts: { namesakeLab: true },
    why: 'an organisation sharing lab X\'s stem counts as lab X (T6)' },
  { name: 'scope-code-and-name-twice', kind: 'stage', stage: 'plan', minDifficulty: 3, opts: { codeAndNameTwice: true },
    why: 'a compound named by code in one lab X document and by name in another is listed twice, so its rows appear twice' },
  { name: 'plan-register-list', kind: 'stage', stage: 'plan', opts: { fixedList: true },
    why: 'the register\'s compounds registered by lab X taken as the entity list, with exact workers that confirm scope; compounds lab X tested but did not register are missed (by construction >= 2 per task)' },
  // worker / resolution (synth's policy)
  { name: 'retracted-claims-used', kind: 'stage', stage: 'worker', opts: { retractedKept: true }, why: 'retraction notices ignored (claims used, document not excluded)' },
  { name: 'superseded-kept', kind: 'stage', stage: 'worker', opts: { supersededKept: true }, why: 'version 1 kept next to version 2 (and a preprint next to its journal version)' },
  { name: 'errata-skipped', kind: 'stage', stage: 'worker', opts: { errataSkipped: true }, why: 'the printed value used where an erratum corrects it' },
  { name: 'erratum-cited', kind: 'stage', stage: 'worker', opts: { erratumCited: true }, why: 'the corrected value cited as the erratum, not as the corrected document' },
  { name: 'nonstandard-counted', kind: 'stage', stage: 'worker', opts: { nonstdCounted: true }, why: 'values under another condition (buffer, rat plasma, log D, 37 °C) count as claims' },
  { name: 'quotes-counted', kind: 'stage', stage: 'worker', opts: { quotesCounted: true }, why: 'a value a document quotes from another group counts as that document\'s claim' },
  { name: 'predictions-counted', kind: 'stage', stage: 'worker', opts: { predictionsCounted: true }, why: 'a model prediction counts as a claim' },
  { name: 'bounds-counted', kind: 'stage', stage: 'worker', opts: { boundsCounted: true }, why: '"below the quantification limit of 0.05 mg/mL" read as 0.05 mg/mL' },
  { name: 'no-unit-conversion', kind: 'stage', stage: 'worker', opts: { noUnitConversion: true }, why: 'the printed number reported without converting its unit (K, °F, µg/mL, min, µM, pM, kg/m³)' },
  { name: 'recency-only', kind: 'stage', stage: 'worker', opts: { recencyOnly: true }, why: 'the most recent claim wins, whatever the ranking policy says' },
  { name: 'concern-voids', kind: 'stage', stage: 'worker', minDifficulty: 3, opts: { concernVoids: true }, why: 'an expression of concern read as a retraction' },
  { name: 'retraction-by-title', kind: 'stage', stage: 'worker', minDifficulty: 4, opts: { retractionByTitle: true },
    why: 'a retraction of a different, out-of-corpus article with the same title (other author and year) voids the corpus document' },
  { name: 'excluded-corpus-wide', kind: 'relation', opts: { excludedCorpusWide: true }, why: 'every void document of the corpus listed, not only those that mention a compound in scope; breaks Y4' },
  { name: 'one-excluded-missing', kind: 'relation', opts: { oneExcludedMissing: true }, why: 'one void document missing from excluded_doc_ids; breaks Y4' },
  // relation mistakes (pass every stage oracle and the reduce stage's local checks)
  { name: 'map-null-filtered', kind: 'relation', opts: { nullFiltered: true },
    why: 'one in-scope worker failed and its null result was filtered out (Claude Code `parallel` + `.filter(Boolean)`); the table is consistent with what is left; breaks Y2' },
  { name: 'reduce-lost-item', kind: 'relation', opts: { lostItem: true }, why: 'the reducer drops the last in-scope item ("in view" fan-in); breaks Y3' },
  { name: 'reduce-cells-misjoined', kind: 'relation', opts: { misjoin: true }, why: 'cells attached to the wrong compound (two lists zipped in different orders); breaks Y3' },
  { name: 'reduce-excluded-all-candidates', kind: 'relation', opts: { excludedAll: true }, why: 'void documents of every candidate listed, in scope or not; breaks Y4' },
  { name: 'heuristic:keyword-script', kind: 'heuristic',
    why: 'the keyword script: full-name affiliation and publication date for scope, first number after the property keyword, journal-then-recent ranking, title-matched voids (heuristic.mjs)' },
];

export const NECESSITY_DEFS = [
  { name: 'sequential-single-context', kind: 'necessity', attention: 'sequential',
    why: 'one context reads the corpus in id order; past the 32K-token budget it reads nothing more (stand-in, under the attention hypothesis, for the size failure of a one-call or one-agent solve; sizes in the notes)' },
  { name: 'best-of-n:equal-tokens', kind: 'necessity', attention: 'best-of-n',
    why: 'N = max(3, N at equal tokens, one inline call per candidate) single-context solves, each starting at a different place in the corpus, the same verifier selecting (code unit checks plus a perfect panel on a 20% sample of rows); fails only under the 32K-token attention hypothesis' },
];

export const appliesAt = (def, difficulty) => difficulty >= (def.minDifficulty ?? 0);
