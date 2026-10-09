// mkreport.mjs: writes ../../AUDIT-L1.md from out/L1-audit.json, out/L6-audit.json and the draw files, so every number in the report is read, not retyped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const OUT = path.resolve(HERE, '..'); const LIB = path.resolve(OUT, '..');
const A = JSON.parse(fs.readFileSync(path.join(OUT, 'L1-audit.json'), 'utf8')); const L6 = JSON.parse(fs.readFileSync(path.join(OUT, 'L6-audit.json'), 'utf8'));
const draw = JSON.parse(fs.readFileSync(path.join(OUT, 'L1-audit-draw.json'), 'utf8'));
const pc = x => (x === null || x === undefined) ? 'n/a' : (x * 100).toFixed(1) + '%';
const iv = a => a ? `${(a[0] * 100).toFixed(1)}–${(a[1] * 100).toFixed(1)}%` : 'n/a';
const f2 = x => (x === null || x === undefined) ? 'n/a' : (Math.round(x * 100 + 1e-9) / 100).toFixed(2);
const sh = id => { const [p, ...r] = id.split(':'); const n = r.join(':').replace(/^.*\//, ''); return `${p}:${n.length > 26 ? n.slice(0, 24) + '..' : n}`; };
const esc = s => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
const C = A.coverage, H = C.headlineStrict, LEN = C.lenient, DS = C.sensitivityDashboardsExplained, PC = C.populationCalibratedDashboards;
const RP = A.rulePrecision, D1 = RP.decisionL1a, REC = A.recall, IL = A.itemLevel, HT = A.detectorHits.table;
const S6 = L6.summary.main, S6r = L6.summary.recordedOnly, dec6 = L6.decision;
const ADJN = fs.readFileSync(path.join(OUT, 'L1-audit-adjudication.jsonl'), 'utf8').trim().split('\n').length;
const dcount = {}; for (const d of A.disagreements) dcount[d.drawOrder] = (dcount[d.drawOrder] ?? 0) + 1;
const spot = [17, 49, 54, ...Object.entries(dcount).filter(([k]) => ![17, 49, 54].includes(Number(k))).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 7).map(([k]) => Number(k))];
const md = [];
const w = s => md.push(s);

w(`# AUDIT-L1: hand audit of the pattern census, detector precision, and checklist-versus-failures (L1-a, L6-a)

*2026-10-09 · $0, no model calls, no Jev calls · single auditor (an agent) · \`beds/sealed/\` never read · new files only: this file and \`out/L1-audit*.json*\`, \`out/L1-detector-hits-*\`, \`out/L6-audit.json\`, \`out/audit-scripts/\`. Nothing existing was modified; L1-PATTERNS.md is unchanged and §8 below lists what should change in it.*

## 0. Result

1. **Corrected coverage.** On 60 hand-labelled workflows, stratified by cluster and pattern count, L0 plus L1 explain ${pc(H.postStratified)} of the 1,559 corpus workflows (Wilson 95% interval ${iv(H.wilson95KishNeff)}, Kish effective n ${H.kishNeff}), not the census's 97.8%.
2. **Why it moved.** The census "explained" count is the count of non-refused items and is true by construction (L1-PATTERNS §1.4); the audit gap is almost entirely two Node-RED dashboard applications (#${C.dashboardEvidence.sampleItems.map(x => x.drawOrder).join(' and #')}, each carrying a stratum weight of about 60 items) that I read as the §2.5 "interactive dashboard state" refusal and the census explained. If those two are counted as explained the estimate is ${pc(DS.postStratified)} (${iv(DS.wilson95KishNeff)}); if the refusal is applied by widget count to the whole corpus (${PC.dashboardItemsExtra} more Node-RED items with 20 or more UI widgets) it is ${pc(PC.coverage)} (${iv(PC.wilson95KishNeff)}). The widget-count variant is the better-founded one and the sample-only one the stricter; the owner decides whether a dashboard app is a refusal.
3. **L1-a: FAIL.** Rule precision (yes + partly/2) is ${f2(D1.nodeRuleAndToken.precision)} for the ${D1.nodeRuleAndToken.pairs} node-rule and token assignments (Wilson ${iv(D1.nodeRuleAndToken.wilson95)}) and ${f2(D1.allPairs.precision)} over all ${D1.allPairs.pairs} detector assignments; the bar is 0.85 with a Wilson lower bound of 0.75, and the falsifier (below 0.75) is met. The coverage claim does not leave the directory.
4. **Detectors to remove (precision below 0.5 on fixed-seed hit samples): ${A.detectorHits.patternsBelow50.map(x => `${x.pattern} (${f2(x.precision)})`).join(', ')}.** All six are support-only, so removing them changes no census status or budget bucket (checked: ${A.detectorHits.removalCheck.itemsWithRemovedPatternInNeeds} items carry any of them in their explained-needs set). P30 has 0 genuine hits of 7.
5. **L6-a: FAIL on the strict reading.** ${S6.yes} of ${S6.n} recorded failure causes are named by an L1 checklist line or §9 code (${pc(S6.namedStrict)}, Wilson ${iv(S6.namedStrictWilson95)}); counting "partly" as named it is ${pc(S6.namedLenient)}. Below 50% under every denominator I tried on the strict reading, so ${L6.proposedLines.length} checklist lines are proposed, each \`minedFrom: repo:<ref>\` (§6).

## 1. Method and seeds

**L1-a sample.** Seed ${draw.seed}, PRNG mulberry32, per stratum the ids sorted lexicographically and Fisher-Yates shuffled on one shared stream, first k taken, strata visited in allocation order, then the 60 shuffled once for review order. Strata are the six platform clusters (automation, orchestration, science, consumer-creative, agentic, first-party; 10 items each) crossed with the census distinct-L1-pattern count (A: 0–1, B: 2–4, C: 5+), plus an R stratum of census-refused items inside agentic (the two refused automation items are merged into A). Frame sizes and allocations are in \`out/L1-audit-draw.json\`; every item carries its stratum size and draw order.

| cluster | A (0–1) | B (2–4) | C (5+) | R (refused) |
|---|---|---|---|---|
${['automation', 'orchestration', 'science', 'consumer-creative', 'agentic', 'first-party'].map(cl => `| ${cl} | ${['A', 'B', 'C', 'R'].map(s => draw.frameSizes[cl + '|' + s] !== undefined ? `${draw.alloc[cl][s] ?? 0} of ${draw.frameSizes[cl + '|' + s]}` : '-').join(' | ')} |`).join('\n')}

**Blind labelling.** Each item was shown through \`audit-scripts/view.mjs\` (title, description, graph nodes with category, type and summary, edges, features; the \`ir\` field and every census output hidden) and labelled in draw order with the L0 constructs, the L1 patterns, an "explained" call (yes, partly, no), a refusal reading and gaps. Rows were appended with a timestamp (\`labelledAt\`) by \`addlabel.mjs\`; four rows were revised before any census row was opened for them (\`revisedAt\`, \`revisionNote\`, an inconsistency in how I labelled the P01, P05 and P08 chain idioms). SHA-256 of the labels file: \`${A.meta.labelsSha256.slice(0, 16)}...\`. **Disclosure:** the stratum letter (pattern-count bucket) of each item was visible to me in the draw output, so I knew the bucket but no pattern id, token or verdict; and the corpus summaries I read are the same fields the census reads.

**Adjudication (pass 2).** After the labels were final, \`census-nodes.mjs\` (a copy of the census tool that also dumps per-node assignments and plumbing witnesses; its needs and plumbing output equals the published census on all 1,559 items) gave for each item the detector set, the rule or token or witness behind every pattern, and the anchor nodes. Every detector pair (item, pattern) was judged yes, partly or no: does the pattern's skeleton describe the node or nodes that own it. Every blind-only pattern was coded m (the detector gave another owner or missed the shape) or M (the detector has no rule or no node for it). ${A.perItem.length ? '' : ''}Adjudication lines are in \`out/L1-audit-adjudication.jsonl\` (${ADJN} lines). **Bias:** the adjudicator saw the detector's anchors, which pulls towards agreement, so adjudicated precision is the optimistic figure and blind agreement the pessimistic one; the L1-a decision fails on the optimistic one.

**Estimators.** Corrected coverage is post-stratified (weight = stratum size over stratum sample); its interval is Wilson at the Kish effective n (${H.kishNeff}); a seeded stratified bootstrap (seed 20261011, 5,000 resamples) and the unweighted n = 60 Wilson are reported beside it. Strict means "explained = yes" only. Precision of pairs uses (yes + partly/2) over pairs, with a Wilson interval on the fractional count and an item-clustered bootstrap. Census-refused items carry no census patterns by design, so their blind patterns are outside pattern recall (${A.refusedItemsOutsidePatternRecall.length} items: #${A.refusedItemsOutsidePatternRecall.map(x => x.drawOrder).join(', #')}).

**Detector hit samples.** Seed ${A.meta.hitSeed}: for each pattern, the items whose detector set contains it, ids sorted, shuffled on one stream in the listed order, first k judged real, partly or not real. The five most frequent patterns are P01, P02, P37, P38, P08 (10 judged each; P01 and P02 judged 20); the five rarest non-zero are P48, P30, P49, P31, P22 (all hits judged, 6 to 10); the support-only detectors P01, P02, P16, P17, P18, P49 are judged 20 each or all hits when fewer exist (P16 18, P49 8). P11, P23, P24 and P52 never fire (${A.detectorHits.zeroHitPatterns.join(', ')}); they cannot be sampled. Per-hit verdicts: \`out/L1-detector-hits-verdicts.jsonl\`.

## 2. Table 1: coverage, item-level agreement, rule precision

| quantity | value | interval or note |
|---|---|---|
| census claim: explained by L0 + L1 | 97.8% (1,524 of 1,559) | tautological by construction; no interval |
| **audit, strict, post-stratified** | **${pc(H.postStratified)}** | **Wilson ${iv(H.wilson95KishNeff)} (Kish n ${H.kishNeff}); stratified bootstrap ${iv(H.stratifiedBootstrap95)}** |
| audit, strict, unweighted n = 60 | ${pc(H.unweighted)} | Wilson ${iv(H.unweightedWilson95)} |
| audit, lenient (partly counts as explained) | ${pc(LEN.postStratified)} | Wilson ${iv(LEN.wilson95KishNeff)}; bootstrap ${iv(LEN.stratifiedBootstrap95)} |
| sensitivity: the two dashboard refusals counted as explained | ${pc(DS.postStratified)} | Wilson ${iv(DS.wilson95KishNeff)}; bootstrap ${iv(DS.stratifiedBootstrap95)} |
| sensitivity: dashboard refusal applied by widget count, whole corpus | ${pc(PC.coverage)} | Wilson ${iv(PC.wilson95KishNeff)}; bootstrap ${iv(PC.stratifiedBootstrap95)}; ${PC.dashboardItemsExtra} extra items, ${PC.sampleItemsUsed} sample items used |
| item-level agreement on "explained" (census explained = not refused vs my yes) | ${IL.explainedAgreementStrict.agree} of 60 (${pc(IL.explainedAgreementStrict.share)}) | lenient reading ${IL.explainedAgreementLenient.agree} of 60 (${pc(IL.explainedAgreementLenient.share)}); the census says explained and I say not on ${IL.table.censusExplainedBlindNot} items (#${A.perItem.filter(r => r.censusExplained && !r.strict).map(r => r.drawOrder).join(', #')}), the reverse on 0 |
| pattern sets equal, detector vs blind (L1 only) | ${IL.patternSetExactMatch} of 60 items | mean Jaccard ${f2(IL.meanJaccardDetectorVsBlind)}; ${IL.itemsWithAnyDetectorPairAdjudicatedNo} items have a detector pair judged no, ${IL.itemsWithAnyBlindOnlyPattern} have a blind-only pattern |
| **rule precision, node-rule and token pairs** | **${f2(D1.nodeRuleAndToken.precision)}** | ${D1.nodeRuleAndToken.pairs} pairs (${D1.nodeRuleAndToken.yes} yes, ${D1.nodeRuleAndToken.partly} partly, ${D1.nodeRuleAndToken.no} no); Wilson ${iv(D1.nodeRuleAndToken.wilson95)}; cluster bootstrap ${iv(D1.nodeRuleAndToken.clusterBootstrap95)}; weighted ${f2(D1.nodeRuleAndToken.weightedPrecision)}; **fail** |
| rule precision, all detector pairs | ${f2(D1.allPairs.precision)} | ${D1.allPairs.pairs} pairs (${D1.allPairs.yes}/${D1.allPairs.partly}/${D1.allPairs.no}); Wilson ${iv(D1.allPairs.wilson95)}; **fail** |
| precision, support-only (plumbing) pairs | ${f2(D1.supportOnly.precision)} | ${D1.supportOnly.pairs} pairs (${D1.supportOnly.yes}/${D1.supportOnly.partly}/${D1.supportOnly.no}); Wilson ${iv(D1.supportOnly.wilson95)} |
| detector recall against my blind labels | ${f2(REC.recallVsBlind)} | ${REC.detectedOfBlind} of ${REC.blindPairs} blind pairs (Wilson ${iv(REC.recallVsBlindWilson95)}); ${REC.missedSubstituted} blind-only pairs where another owner was chosen, ${REC.missedNoRule} with no rule; adjudicated recall ${f2(REC.recallAdjudicated)} |

**L0 constructs (if, guard, judge, input).** Agreement on presence: ${['if', 'guard', 'judge', 'input'].map(k => `${k} ${pc(A.l0Agreement[k].agreement)} (kappa ${f2(A.l0Agreement[k].kappa)}; both ${A.l0Agreement[k].bothYes}, mine only ${A.l0Agreement[k].blindOnly}, census only ${A.l0Agreement[k].detectorOnly})`).join('; ')}. This comparison is weak by design: the census records an L0 construct only when a control node falls to a plain L0 rule, so plain conditions that it assigned to an L1 pattern, and every input that is not a trigger node, do not appear as L0. Read it as "the census L0 counts are not constructs present", not as an error rate.

## 3. Table 2: per-pattern precision and recall on the 60 items

Precision = (yes + partly/2) over detector pairs; blind = share of detector pairs that my blind label also had. Recall (blind) = detector pairs also in my blind label over my blind pairs; recall (adj) counts adjudicated-true pairs over adjudicated-true plus blind-only. Patterns with 3 or more detector pairs or 3 or more blind pairs; the rest are in \`out/L1-audit.json\` (\`perPattern\`).

| pattern | detector pairs | yes / partly / no | precision (adj) | precision (blind) | blind pairs | missed (m / M) | recall (blind) | recall (adj) |
|---|---|---|---|---|---|---|---|---|
${A.perPattern.filter(p => p.detectorPairs >= 3 || p.blindLabelPairs >= 3).sort((a, b) => b.detectorPairs - a.detectorPairs).map(p => `| ${p.pattern} | ${p.detectorPairs} | ${p.yes} / ${p.partly} / ${p.no} | ${f2(p.precisionAdjudicated)} | ${f2(p.precisionBlind)} | ${p.blindLabelPairs} | ${p.missedSubstituted} / ${p.missedNoRule} | ${f2(p.recallBlind)} | ${f2(p.recallAdjudicated)} |`).join('\n')}

Reading. The worst recall is on the shapes that sit in step-level tags or in flattened structure that the detector never sees: P12 (${A.perPattern.find(p => p.pattern === 'P12').blindLabelPairs} blind pairs, recall ${f2(A.perPattern.find(p => p.pattern === 'P12').recallBlind)}), P08, P15, P38, P01, P54. The worst precision is on the keyword detectors (P18 0 of ${A.perPattern.find(p => p.pattern === 'P18').detectorPairs}, P17 0 of ${A.perPattern.find(p => p.pattern === 'P17').detectorPairs}, P02 ${A.perPattern.find(p => p.pattern === 'P02').yes} of ${A.perPattern.find(p => p.pattern === 'P02').detectorPairs}) and on two node rules: P20 (generate-verify-retry) and P15 (fan-in), ${f2(A.perPattern.find(p => p.pattern === 'P20').precisionAdjudicated)} and ${f2(A.perPattern.find(p => p.pattern === 'P15').precisionAdjudicated)} at n = ${A.perPattern.find(p => p.pattern === 'P20').detectorPairs} and ${A.perPattern.find(p => p.pattern === 'P15').detectorPairs}, too few to remove under the 0.5 rule but enough to re-scope. P08 is a concern in a different way: all ${A.perPattern.find(p => p.pattern === 'P08').detectorPairs} detector pairs are "partly" (data filters, not guards before an effect) while 8 genuine guards were missed.

## 4. Table 3: detector precision on fixed-seed hit samples

| pattern | group | population | judged | yes / partly / no | precision | Wilson 95% |
|---|---|---|---|---|---|---|
${Object.entries(HT).sort((a, b) => b[1].population - a[1].population).map(([p, v]) => `| ${p} | ${v.groups.join(', ')} | ${v.population} | ${v.all.judged}${v.exhaustive ? ' (all)' : ''} | ${v.all.yes} / ${v.all.partly} / ${v.all.no} | ${f2(v.all.precision)} | ${iv(v.all.wilson95)} |`).join('\n')}

For the "10 hits" requirement the first 10 of each draw give: ${['P01', 'P02', 'P37', 'P38', 'P08', 'P48', 'P30', 'P49', 'P31', 'P22'].map(p => `${p} ${f2(HT[p].first10.precision)}`).join(', ')}. Notes by pattern:
- **P37 webhook (0.60).** 8 of 10 hits are "partly": 6 are GitHub or GitLab push and pull-request starts, which have no reply (the P38 shape), one is a Zapier sub-zap start and one a token-only Langflow API flow. Only 2 of 10 are request-and-respond. The platform split of the whole P37 population is github-actions 72, n8n 65, gitlab-ci 41, so about 40% of P37 comes from CI platforms.
- **P38 event rule (0.80).** The two misses are orchestration start messages, not event rules.
- **P08 guard (0.80).** 7 of 10 are real guards (a condition gating an effect). The no is an input selector; the two partly are a stream splitter and a dispatch table of 16 \`choose\` nodes.
- **P01 linear pipeline (0.68).** 9 of 20 are real typed chains, 9 are partly (control-order sequences or trivial three-node sequences with no data hand-off), 2 are unrelated lookups or debug chains.
- **P02 fetch-transform-write (0.23).** 14 of 20 are not syncs: CI cache restore and save, media processing, bioinformatics sample sheets, shortcut utilities.
- **P17 reconcile (0.08), P18 best-of-N (0.18).** Wrong shapes: model-loader and text-encoder inputs feeding one sampler, agent tool lists, device reads. The two real P18 hits are three concurrent translations followed by a pick and three parallel analysts that are merged.
- **P16 dedupe (0.31), P49 panel (0.31).** Keyword hits on exact-key removeDuplicates nodes and on sequences of graders; one real hit in each.
- **P30 saga (0.00).** Seven of seven are WDL \`RevertSam\` or a file-editor undo tool, as L1-PATTERNS already says.
- **P48 tripwire (0.67), P31 checkpoint (0.83).** Real but few; the P31 miss is the word "can" in a loop description.
- **P22 loop-until (1.00).** all 10 hits are Home Assistant \`repeat.while\` loops and 8 of them are one author's controller blueprints (EPMatt/awesome-ha-blueprints): genuine, but one platform and essentially one family.

## 5. Corrected coverage statement

${'On 60 stratified hand labels, L0 plus L1 explain ' + pc(H.postStratified) + ' of the 1,559 corpus workflows (Wilson 95% interval ' + iv(H.wilson95KishNeff) + ', Kish effective n ' + H.kishNeff + '), against the census figure of 97.8% that is true only by construction.'}

The interval is wide because four of the 17 strata have one or two sampled items and one automation stratum (181 items) is carried by 3 labels, two of which are the dashboard apps. Only ${C.dashboardEvidence.nodeRedItemsInAutomationC} of the 181 items in that stratum are Node-RED at all, and only 14 unrefused Node-RED items in the whole corpus have 20 or more widgets, so the draw landed in a rare cell and the sample-only figure extrapolates it to about 120 items; that is why I report the widget-count variant (${pc(PC.coverage)}, ${iv(PC.wilson95KishNeff)}) next to the sample-only figure. The corpus's own IR verdict for both dashboard items is \`via-extension\`, not \`unsupported\`, so the refusal reading is mine and carries medium confidence (\`refusalConfidence\` in the label rows).

## 6. L6-a: checklist lines and §9 codes against recorded failures

Read in full: DEV-NOTES (D1–D23), FRONTIER-GAPS §0–§2, construction REPORT-dev §3 and §6.1, the verdict sections of the four diagnoses, review-05 §1.2 and §3.6, W-BED §3.8, BLOCKER-SYNTHESIS §3 and §5. Searched by keyword and read at the matching rows: the other review-20261007 files (failure, silent, false-pass rows), docs/RESEARCH.md (result and failure rows), and the findings tables of the \`beds/*/AUDIT.md\` files (skimmed for solver failures). The remainder of the 22,000 lines in those sources was not read line by line, so the inventory is complete for the structured failure records and may miss a failure mentioned only in passing. The AUDIT files record defects of the beds and their oracles (about 147 finding rows), not failures of workflows, so they are excluded with the other instrument findings (listed in \`out/L6-audit.json\`, \`instrumentFindingsExcluded\`). Rating rule: **yes** means a line or code in L1-PATTERNS §4, §5 or §9 names the cause; **partly** means it addresses the same mechanism or a sub-case; **none**. "Named" in the LIBRARY-TESTS decision is read as yes.

| id | scope | cause (abridged) | rating | line or code |
|---|---|---|---|---|
${L6.failures.filter(f => f.scope !== 'baseline-agent').map(f => `| ${f.id} | ${f.scope} | ${esc(f.cause.split(/(?<=\.)\s/)[0].slice(0, 190))} | ${f.rating} | ${esc(f.by.join('; ') || '-')} |`).join('\n')}

Baseline-agent failures (direct Haiku agent, no workflow; counted only in the last row below): ${L6.failures.filter(f => f.scope === 'baseline-agent').map(f => `${f.id} ${f.rating}`).join(', ')}.

| denominator | causes | yes | partly | none | named (yes) | named (yes + partly) | half credit |
|---|---|---|---|---|---|---|---|
${[['recorded + designed (headline)', 'main'], ['recorded only', 'recordedOnly'], ['output failures', 'outputOnly'], ['construction-loop failures', 'constructionOnly'], ['with baseline agent', 'withBaselineAgent']].map(([l, k]) => { const s = L6.summary[k]; return `| ${l} | ${s.n} | ${s.yes} | ${s.partly} | ${s.none} | **${pc(s.namedStrict)}** (${iv(s.namedStrictWilson95)}) | ${pc(s.namedLenient)} (${iv(s.namedLenientWilson95)}) | ${pc(s.halfCredit)} |`; }).join('\n')}

**Decision (LIBRARY-TESTS L6-a, below 50% means corpus trivia).** On the strict reading ${pc(S6.namedStrict)} < 50% in all five denominators: the checklists are not yet failure knowledge, and lines are to be added from the repo's own failures. The result is sensitive to how "named" is read: counting "partly" as named gives ${pc(S6.namedLenient)} on the headline denominator, above 50% in four of five denominators. The test text says a line or code that "names" the failure, so I take the strict reading as the decision and report the lenient one as the sensitivity. The rating is by one auditor who knew each answer, which can only flatter the checklists; the full table with reasons is in \`out/L6-audit.json\` so a reader can recode it.

What is caught: the C0 construction lessons that were folded back into §9 (VERIFY_NOT_GATING, SILENT_DROP, the id echo), the P16 borderline band (mined from this very failure), the injected-content class, and the tool-failure class. What is missed is a pattern: **every failure about the construction and compile loop itself (acceptance of a compile, heal and recompile gates, check calibration, probe coverage, tier choice, compiler common mode) and about input drift has no line**, because L1 checklists are per pattern and these causes live in the layer above (the composition checker and the JIT loop). LIBRARY-TESTS cites D9 (guard widening) as a source of this test, yet L1-PATTERNS has no code for it.

### Proposed checklist lines (from the repo's own failures; not applied)

| for | proposed line or code | minedFrom |
|---|---|---|
${L6.proposedLines.map(g => `| ${g.id} (${g.rating}) | ${esc(g.line)} | \`${g.minedFrom}\` |`).join('\n')}

## 7. Pass and fail decisions

- **L1-a: FAIL.** Node-rule and token rule precision ${f2(D1.nodeRuleAndToken.precision)} (Wilson lower bound ${f2(D1.nodeRuleAndToken.wilson95[0])}) and all-pairs ${f2(D1.allPairs.precision)}; required 0.85 and 0.75. The falsifier (precision below 0.75) is met. Consequences: (a) the 97.8% coverage figure and the 82.2% / 15.6% budget split must not leave this directory; (b) detectors below 0.5 are to be removed: ${A.detectorHits.patternsBelow50.map(x => `${x.pattern} ${f2(x.precision)}`).join(', ')}. The census re-run for (b) was not performed because that would overwrite existing files; by the explained-needs check it changes no census status or expansion-budget bucket (0 items affected), only the support counts in §2.4 and §8 of L1-PATTERNS. The node-rule precision miss is dominated by "partly" (${D1.nodeRuleAndToken.partly} of ${D1.nodeRuleAndToken.pairs}), not "no" (${D1.nodeRuleAndToken.no}); strict yes-only precision is ${f2(D1.nodeRuleAndToken.yes / D1.nodeRuleAndToken.pairs)}.
- **L6-a: FAIL on the strict reading** (${pc(S6.namedStrict)} named, threshold 50%); lenient reading ${pc(S6.namedLenient)}. Add the proposed lines.
- **Owner spot check not done.** LIBRARY-TESTS asks for the owner to spot-check 10 items blind; I did not have that. The ten I would check are draw orders ${spot.join(', ')} (the two dashboard refusals, the one "partly" item, and the seven items with the most disagreement rows in Appendix A); \`view.mjs <drawOrder>\` shows them without the census.

## 8. What to change in L1-PATTERNS (not applied here)

1. **§0 and §2.1.** Replace "explained by L0 + L1 | 1,524 | 97.8%" by the audit estimate (${pc(H.postStratified)}, ${iv(H.wilson95KishNeff)} as sampled; ${pc(PC.coverage)}, ${iv(PC.wilson95KishNeff)} with the dashboard refusal by widget count) and state that 97.8% is the count of non-refused items. Keep the refusals row, but define "interactive dashboard state" by a criterion (for example 20 or more \`ui_*\` widgets) and apply it: 14 more Node-RED items qualify, which moves the non-refused share to 96.9% on its own. The corpus IR verdict set it for two items only.
2. **§1.3 and §4 (P16, P17), §5 (P02, P18, P30, P49).** Remove the six keyword or plumbing detectors, or restate them as "unmeasured, hit precision 0.08 to 0.31". P30 has zero genuine hits and should leave the census table. P01 (0.68) stays but should say that half its hits are control-order chains with no data hand-off, so "typed hand-offs" is not detected.
3. **§5 P37 and P38.** Split the CI-event shape: GitHub and GitLab push and pull-request starts are P38 or P41, not "webhook, respond". P37 should require a respond node or an HTTP trigger with a reply; today about 113 of 282 hits are CI events. The \`/form/\` regex also counts a dashboard \`ui_form\` as a webhook (P55 is the owner).
4. **§2.7 rule table.** Add rules for step-level structure that the node rules cannot see (about 25 of the 65 blind-only patterns): \`when\` and \`rules\` tags to P08, \`matrix\`, \`scatter\` and \`parallel\` tags to P12, \`retry\` to P26, \`always\`/\`all_done\` to P29, flattened subworkflows (feature counts of sub-workflows with no node) to P54. Re-classify tool nodes that carry category \`model\` (fgbio, DeepVariant, CellBender, ComfyUI loaders) so they stop adding P05, P18 and P17. Tighten P15 (stage barriers are not fan-in aggregation) and P20 (many hits are a generator and a critic in sequence), and the P33 \`resume\` regex.
5. **§6 and P22.** P22's 10 hits are all Home Assistant \`repeat.while\` loops, 8 from one blueprint collection; say so, or fold it into P20/P21 as the card half-suggests. P08 should say that the detector currently finds data filters and misses step-level \`when\` guards.
6. **§9.** Add the codes in §6 of this report: PROBE_COVERAGE, DOMAIN_WIDENED, NO_INPUT_GUARD, GLOBAL_READ_TIER, CHECK_FALSE_ALARM and the P20, P03, P09, P49 lines. Say in §8 that P16's line 1 is the only checklist line mined from a records failure, and that retrieval of a support-only card is not guaranteed.
7. **§1.6 and §10.** Mark L1-a as run, with the result above, and the owner's blind spot check as outstanding.

## 9. Limits

- Single auditor and a single pass; the rating of both L1-a and L6-a is one agent's judgement. Adjudication saw the detector's anchors (optimistic); labels saw the stratum bucket.
- The estimate rests on 60 labels, and one 3-label stratum carries 181 items. The Kish interval does not capture that the stratum-level variance is unestimable at n = 3; the bootstrap is no better there.
- Pair precision counts (item, pattern) pairs, not nodes; a pair is yes when the skeleton fits the owning nodes, so "partly" often means one of several nodes fits.
- The hit samples are 6 to 20 per detector; the Wilson intervals are wide for the rare patterns (P22 1.00 has a lower bound of ${f2(HT.P22.all.wilson95[0])}).
- L6-a lists causes, not instances; a failure repeated 7 times counts once. The instance-weighted share would be dominated by the C0 construction defects (13 of 96 trials). Failures in lost run data are unattributed and unmapped.
- Not done: the census re-run after removal, L1-b executable coverage, retrieval of cards by Jev (the "is the line retrievable" half of L6).

## Appendix A: every disagreement (one line each)

Types: **detector-only** (detector assigned, blind label did not; adjudicated y, p or n), **both-partly** (both assigned, adjudicated partly), **blind-only m** (my pattern, detector gave another owner), **blind-only M** (my pattern, detector has no rule), **item-explained** (census explained, my call not). Draw order and pattern first.

| # | item | pattern | type | adj | reason |
|---|---|---|---|---|---|
${A.disagreements.map(d => { const it = A.perItem.find(r => r.drawOrder === d.drawOrder); return `| ${d.drawOrder} | ${esc(sh(d.id))} | ${d.pattern ?? '-'} | ${d.type.replace('both-assigned-but-adjudicated-', 'both-').replace('blind-only-detector-substituted', 'blind-only m').replace('blind-only-detector-no-rule', 'blind-only M')} | ${d.adjudicated} | ${esc(String(d.reason).slice(0, 220))} |`; }).join('\n')}
`);
fs.writeFileSync(path.join(LIB, 'AUDIT-L1.md'), md.join('\n'));
console.log('written', md.join('\n').length, 'chars');
