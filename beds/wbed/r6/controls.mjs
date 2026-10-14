// Bad controls and structure-necessity controls of W-bed R6. Most are the bed's pipeline with one option set, so each has
// a full trace for the composed oracle. The generator re-draws the world until every applicable control fails the
// oracle (world.mjs setVerifier, installed by index.mjs).
//
// kind 'stage':    a mistake one stage oracle sees (plan recall or duplicates, a worker's scope verdict or cell).
// kind 'relation': every stage oracle and the reduce stage's local checks pass on the control's own trace; only a
//                  cross-item relation (Y1-Y5) and the end-to-end oracle catch it.
// kind 'heuristic': the keyword script (heuristic.mjs), reading the task text only.
// NECESSITY_DEFS (W-BED §2.4 item 3 and the B6 comparison): the best workflow WITHOUT the plan (a fixed entity list taken
// from the inputs); one sequential context that runs out of budget; best_of_n at equal tokens with the same verifier;
// and an agent with no workflow that retrieves by keyword (grep) and reads what it found.
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
  { name: 'necessity:no-plan-fixed-list', kind: 'necessity', opts: { fixedList: true },
    why: 'W-BED §2.4 item 3, R6 without a plan: the reference workflow over a fixed entity list taken from the inputs (the register\'s compounds registered by lab X), with exact workers that confirm scope; compounds lab X tested but did not register are missed' },
  { name: 'sequential-single-context', kind: 'necessity', attention: 'sequential',
    why: 'one context reads the corpus in id order; past the token budget it reads nothing more (stand-in for the size failure of a one-call or one-agent solve; sizes in the notes)' },
  { name: 'best-of-n:equal-tokens', kind: 'necessity', attention: 'best-of-n',
    why: 'N = max(3, N at equal tokens) single-context solves, each starting at a different place in the corpus, the same verifier selecting (code unit checks plus a perfect panel on a 20% sample of rows)' },
  { name: 'no-workflow:grep-agent', kind: 'necessity', attention: 'grep', minDifficulty: 3,
    why: 'an agent with tools and no workflow: greps the Affiliation lines for lab X\'s full name, reads those documents, greps each compound it found by the string it saw, reads those documents and every notice, and answers exactly from what it read' },
];

export const appliesAt = (def, difficulty) => difficulty >= (def.minDifficulty ?? 0);
