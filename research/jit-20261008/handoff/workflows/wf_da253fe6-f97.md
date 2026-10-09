# Workflow  (wf_da253fe6-f97)

status: running (no final record yet); finished agents: 9

## Script

```js
(script not recorded)
```

## Agent result 1

# Cluster dossier: diversity and statistics (B2 common-mode failures, B9 lineage variance and small-K evaluation validity)

*Read-only pass, 2026-10-09. Tags:*
- *[M] means I recomputed it this session from the cited repo file.*
- *[D] means it is documented in the repo and I did not re-measure it.*
- *[paper] and [practice/docs] are external sources I opened or saw in search this session. Where only the abstract or a reference-list entry was visible, the entry says so.*
- *[inference] is my reasoning.*

*Every repo number is dev-split evidence from K=1 streams. Nothing here is a claim. The parallel sweep already covers Knight & Leveson 1986, Kim et al. 2025, Dawid–Skene, Snorkel, Weaver, Fellegi–Sunter, metamorphic testing, Daikon, query-by-committee, REx and self-preference. They are not repeated here except as anchors.*

---

## B2. Common-mode failures across independently compiled variants (D8)

### 1. Mechanism

**Fact 1: errors coincide far more than independence predicts.** Source: research/jit-20261008/nversion-records-dev.json, recomputed [M].
- Take the two strongest deployed solvers, `opusV2` and `sonnetV1`, on the 20 tasks both answered.
  - Wrong answers: 5 and 4.
  - Both wrong: 3. Independence predicts 1.0.
  - Exact one-sided Fisher test: p ≈ 0.032.
  - A crude beta factor, P(both fail)/P(one fails), is about 0.15/0.20 ≈ 0.7. With n = 20 its interval is very wide.
- Parent and child fail identically. `opusV1`→`opusV2` failed together on 2 tasks against 0.67 expected, with byte-identical scores both times (s212 0.723, s214 0.892). So the lineage passes its errors down to the child.
- s214 (D1 under-merge) shows the pattern across interpreters. All three answering solvers, compiled from Opus, Sonnet and Haiku traces, scored exactly 0.892, which means the same wrong answer. In the live streams, s214 also failed in both the S/H and O/H arms (experiments/runs/jit/jit-dev-records-1/*/results.jsonl).

**Fact 2: refusals also coincide, but that common mode is benign.** [M]
- On d4, `sonnetV1` refused 4 tasks, and `haikuV1` and `opusV1` refused every one of the same 4. Independence predicts 2.5 and 4.0.
- `opusV2` never refused (D9). Its 4 "singleton" answers (s217, s218, s220, s222) were all wrong.
- Reading: coincident refusal is a safe failure. Coincident wrong answers are the dangerous one. A lone answer where its siblings refuse marks a widened guard.

**Why it happens.** Errors are driven by the input, not by the compiler's randomness. In Eckhardt–Lee terms, each input x has a "difficulty" θ(x): the probability that a randomly drawn version fails on it. For two versions drawn independently, P(both fail) = E[θ²] = E[θ]² + Var(θ). Independence holds only when every input is equally hard. Records inputs are not:
- near-threshold one-typo twins (D1);
- global `rules` readings (D11);
- unseen d4 shapes (D5).

Three shared causes push θ toward 1 on the same inputs, for every variant:
- (a) the same spec text, read the same way: a hard identity threshold, `partDist ≤ 1`;
- (b) the same compiler model (Haiku 5.5 for all four), the same prompt (`experiments/jit/prompts.mjs`) and the same SDK idioms (`flow.mjs`);
- (c) overlapping traces, plus parent-to-child inheritance through recompiles.

**Why it matters in the system.**
- SPEC §6.2 adjudicates only on disagreement. `stream.mjs:533-547` lets majority-of-same deliver, so a unanimous wrong answer is delivered silently.
- THESIS-JIT §6.1 proposes "trust agreement only as far as it has been earned". Nothing yet measures how much agreement has earned.

### 2. Ideological root

The assumption is that **diversity is a property of the producers**: variants that are built separately count as independent witnesses. Under that assumption, agreement can replace an oracle, since unanimity of k versions with error e would give error e^k.

For the assumption to hold, three things must be true:
1. errors come mostly from variance (compiler noise), not from bias (shared spec reading, shared inputs that are hard for everyone);
2. versions come from genuinely different methods;
3. input difficulty is homogeneous.

None of the three holds in this repo. D8's 6/7 unanimous-correct (86%) is mostly the easy inputs being easy.

This undercuts the full e2e vision in three places:
- **Reuse.** The vision lets a "proven" workflow be reused elsewhere. If "proven" means "agreed with its siblings and its shadows", the evidence record over-states durability exactly on the inputs most likely to move between programs, the near-boundary ones.
- **Swarms, boards and subagents as an adjudication layer** (THESIS-JIT §6.9). All are Claude-family, so the board inherits the same common mode (sweep J5).
- **Cost/reliability slider.** If it buys reliability with more variants, it buys less than it reports. The non-monotone voting result (below) shows that more votes can even make hard inputs worse.

### 3. Frontier

- **[paper] Ron, Baudry, Monperrus, "N-Version Programming with Coding Agents", arXiv 2606.20158, June 2026.** https://arxiv.org/abs/2606.20158
  - 48 agent-written implementations of Knight–Leveson's Launch Interceptor spec, run on 1M inputs.
  - "Substantial common-mode failure". Co-failures trace to spec parts that are "particularly hard or ambiguous".
  - Yet 3-version majority voting cut mean failures from 387.44 to 130.99. Voting helps on average while leaving a common-mode floor.
- **[paper] Nogueira, Pattabiraman, Vieira, Campos, "A Systematic Methodology for Evaluating Failure Independence in LLM-Generated Code", arXiv 2607.02808, July 2026.** https://arxiv.org/abs/2607.02808
  - 224 problems, 12 models.
  - 3- and 5-version ensembles reach only 0.43 and 0.44 of the independence-predicted reliability gain. Same-model ensembles reach below 0.3.
  - Different failure patterns often share root causes.
  - **This is the closest external analogue to D8: our four variants are all same-compiler.**
- **[paper] Ron et al., "Galápagos: Automated N-Version Programming with LLMs", arXiv 2408.09536.** https://arxiv.org/abs/2408.09536v2
  - LLM-generated variants that are checked for equivalence, stay statically different, and protect against real Clang miscompilations.
  - Diversity there is in the implementation of a fixed, verified semantics. Ours is diversity in reading an ambiguous spec, which is the harder case.
- **[paper] Goel et al., "Great Models Think Alike and this Undermines AI Oversight", ICML 2025.** https://arxiv.org/abs/2502.04313
  - CAPA, a chance-adjusted agreement over mistakes.
  - Judges favour similar models, and mistakes grow more similar as capability rises.
  - Seen as abstract only.
- **[paper] Chen, Davis, Hanin, Bailis, Stoica, Zaharia, Zou, "Are More LLM Calls All You Need?", NeurIPS 2024.** https://arxiv.org/abs/2403.02419
  - Voting improves easy queries and *degrades hard ones*, so performance is non-monotone in the number of calls.
  - This is Eckhardt–Lee's difficulty function rediscovered for LLMs [inference].
- **[paper] Wood, Mu, Webb, Reeve, Luján, Brown, "A Unified Theory of Diversity in Ensemble Learning", JMLR 24, 2023.** https://jmlr.org/papers/v24/23-0041.html
  - Diversity is a hidden term in the bias–variance decomposition.
  - For 0/1 loss it has no additive form, and its effect depends on the label distribution.
  - The goal is managing a bias/variance/diversity trade-off, not maximising diversity.

### 4. Niche verticals

**(a) N-version theory beyond Knight–Leveson: Eckhardt & Lee 1985 and Littlewood & Miller 1989.**
- Sources:
  - [paper] Eckhardt & Lee, "A theoretical basis for the analysis of multiversion software subject to coincident errors", IEEE TSE SE-11(12), 1985. https://ntrs.nasa.gov/citations/19870030726
  - [paper] Littlewood & Miller, "Conceptual modeling of coincident failures in multiversion software", IEEE TSE 15(12), 1989. https://ntrs.nasa.gov/citations/19900036555
  - [paper] Feldt 1998 tested forced diversity on 435 versions. https://www.cse.chalmers.se/~feldt/publications/feldt_1998_forcing_design_diversity.pdf
- How the field solved it:
  - Littlewood–Miller treats a *methodology as a sequence of decision outcomes*. Versions built from different decisions have different difficulty functions. Their correlation can then fall below independence, and can even turn negative.
  - Feldt found the decision-independence assumption held on average for 74% of test cases.
- Mechanism that transfers: **forced diversity by decision vector**, as opposed to hoping for diversity from repeated sampling.
- Adaptation for Foundry:
  - The compiler prompt takes a mandated decision vector. Three binary axes:
    - identity: deterministic threshold, or a per-pair `flow.judge`;
    - blocking: name-key, or phone/date-key;
    - conflict resolution: recency-first, or source-reliability-first.
  - Each variant gets a distinct vector and a distinct trace subset. Where the budget allows, one variant gets a different compiler tier, Sonnet 5.5, which policy lists.

**(b) Common-cause failure in reliability engineering: beta-factor and alpha-factor models.**
- Sources:
  - [practice/docs] NUREG/CR-5485, *Guidelines on Modeling Common-Cause Failures in PRA*, 1998. Seen only through citing papers, e.g. https://www.nrc.gov/docs/ML1518/ML15189A361.pdf
  - [practice/docs] IEC 61508-6 Annex D: a 37-question checklist over 8 defence measures (separation, diversity and others) that scores β. The β for dangerous-undetected (DU) failures is distinct from the β for dangerous-detected (DD) failures. Seen via https://www.es.mdu.se/pdf_publications/7020.pdf and https://ntnuopen.ntnu.no/ntnu-xmlui/handle/11250/240909. Exact point values are unverified.
- How the field solved it:
  - Redundancy credit is never computed as p^k. A β fraction of failures is assumed to hit every channel.
  - β is estimated from a checklist of shared attributes and calibrated on field data.
  - Failures are classified by mode, and **only DU common cause is the dangerous one**.
- Mechanisms that transfer:
  1. A **β-ledger**: each pair of variants gets an a-priori β from shared attributes, calibrated on the dev slice. The router credits agreement only as (1−β)·independent + β·single.
  2. A **mode split**: coincident deopts are DD/safe (good, as seen on d4). Coincident wrong answers are DU. Only β_DU discounts agreement.
- Adaptation for Foundry. The checklist items are:
  - same compiler model;
  - same prompt version;
  - shared traces (Jaccard overlap);
  - parent/child lineage, where β → about 1 as the [M] parent/child data shows;
  - same SDK idiom on the decision path;
  - same interpreter family behind the traces.

**(c) Epidemiology of combining imperfect diagnostic tests.**
- Sources:
  - [paper] Hui & Walter, "Estimating the error rates of diagnostic tests", *Biometrics* 36(1), 1980. https://jhanley.biostat.mcgill.ca/bios601/CandH-ch0102/HuiWalter1980.pdf
    - Two tests applied in two populations with different prevalence identify both tests' sensitivity and specificity without a gold standard, *if* the tests are conditionally independent.
  - [paper] Vacek, "The effect of conditional dependence on the evaluation of diagnostic tests", *Biometrics* 41, 1985. Citation confirmed via reference lists only.
    - Ignoring dependence biases those estimates.
  - [paper] Hadgu, "The discrepancy in discrepant analysis", *Lancet* 348:592, 1996. Citation only.
    - Resolving only discordant results with a reference test biases accuracy estimates, usually upward. https://www.ncbi.nlm.nih.gov/pubmed/9550567
  - [paper] Begg & Greenes, "Assessment of diagnostic tests when disease verification is subject to selection bias", *Biometrics* 39(1), 1983.
    - Correct by inverse probability of verification, under missing-at-random given the test result. Or design it away by verifying a random sample.
    - https://en.wikipedia.org/wiki/Verification_bias (via the search summary).
- How the field solved it. SPEC §6.2 is *exactly* discrepant analysis:
  - only disagreements reach the adjudicator;
  - concordant results are assumed true;
  - so any oracle-free durability metric (THESIS-JIT §6.8, "silent misses per 100 tasks") will be biased optimistic.
- Mechanisms that transfer:
  - **Verify a random sample of concordant results** (a uniform shadow floor on unanimous answers), with known probabilities.
  - Apply **Begg–Greenes/IPW weighting** to estimate the silent-miss rate.
  - Use **Hui–Walter's two-population identification**: d3 and d4 are two "populations" with very different failure prevalence. The covariance terms must be modelled only between same-family members, with their size bounded from the dev oracle slice at design time.

**(d) Data diversity / N-copy programming.**
- Source: [paper] Ammann & Knight, "Data diversity: an approach to software fault tolerance", 1988. https://libraopen.lib.virginia.edu/public_view/x920fw89s. The venue, IEEE Trans. Computers 37(4), is unverified.
- How the field solved it: run *one* program on re-expressed inputs, then vote. This attacks the fact that faults fire only under special-case conditions.
- Transfer to Foundry: for records, re-express by row order, case, Unicode normalisation and whitespace. A near-threshold under-merge often flips under re-expression.
- Difference from the sweep's metamorphic relations: data diversity is a *runtime* fault-tolerance mechanism (vote across copies), not a test.

### 5. Creative options

1. **Forced-diversity portfolio with a β-ledger** (patch, strong). Compile 3 variants from orthogonal decision vectors and disjoint trace subsets. The router delivers unanimous answers with credit discounted by the calibrated β_DU, and escalates disagreement and lone answers.
2. **Change the problem: use diversity to find ambiguity, not to vote.**
   - Ron et al. 2026 locate co-failures at hard or ambiguous spec points.
   - So run the variants *offline* on archived and perturbed inputs. Collect the inputs and output fields where they disagree. Cluster them into **decision points**: threshold, void marker, date order.
   - Ask the strong adjudicator once per decision point, with spec citation (THESIS-JIT §6.2 and §6.5).
   - Freeze the answers as explicit spec rules and tests. Recompile one solver against them.
   - Diversity is then spent where it is strong, exposing the decision surface, and never trusted where it is weak, at the common-mode floor. The deployed system is a single solver plus explicit decisions plus near-boundary flags (D1, Fellegi–Sunter).
3. **"Fail-safe common mode" as a design goal.** Make variants agree on *refusing*, not on answering:
   - each variant ships its runtime-learned input profile (THESIS-JIT §6.4);
   - the portfolio answers only inside the *intersection* of member profiles;
   - a lone answerer means a guard was widened and triggers escalation.

   This turns D9's dangerous mode into a detected one at $0.
4. **Kev or a local open-weight model as a deliberately different voter** [inference]. A different training lineage is a cheap source of independence (CAPA). It is too weak to break ties, so it only triggers alarms. Model ids would come from the policy file (Kev is parked or laptop-bridged there).

### 6. Experiments (ranked)

**E2-1. Coincidence audit, difficulty function and β-ledger calibration. Cost: $0–4, hours.**
- Build `experiments/jit/audit/coincidence.mjs`:
  - run all 9 archived records versions (H v1–v3, O v1–v3, S v1, v2, v2-opus) on dev seeds 201–224, journal-replaying wherever the replay key hits;
  - emit the version × task outcome table with status, pass, score and canonical answer.
- Metrics:
  - θ̂(x) per task, and Var(θ̂);
  - per-pair observed/expected joint wrong answers;
  - CAPA-style error agreement;
  - β_DU and β_DD per checklist attribute (same parent, overlapping traces, same interpreter);
  - majority-vote and disagreement-escalation accuracy, against the independence prediction.
- Baseline: the independence model p^k.
- Preregistration: none. This is dev diagnostics. The β values are frozen into PREREG-stream as *design parameters* before any held-out run.
- Cost: under $4 live (about $0.004–0.045 per compiled run, D8/D10); quota is minimal (Haiku judges, plus one Opus `rules` judge in the S variants).
- Kill or falsify: if observed/expected joint failure is ≤ 1.2 for non-parent pairs, common mode is not a blocker on records. Downgrade B2 and record that negative result.

**E2-2. Forced versus unforced diversity. Cost: about $20–35, about one day.**
- Build:
  - add `diversityVector` and `traceSubset` options to `experiments/jit/compile.mjs` and `prompts.mjs`;
  - write `experiments/jit/portfolio.mjs`, which runs k variants and applies the delivery rule.
- Arms, both from the same archived Sonnet traces:
  - (A) 4 unforced Haiku compiles, which differ only by sampling;
  - (B) 4 forced compiles, with distinct decision vectors and disjoint 3-of-8 trace subsets, one of them with a Sonnet compiler.
- Metrics, on dev 201–224, oracle used only for scoring:
  - joint-wrong ratio;
  - fraction of tasks with a correct minority answer;
  - delivered accuracy under "deliver unanimous, escalate otherwise" (the escalation counted at its archived interpreter outcome);
  - escalation rate.
- Preregistration: freeze the vectors, the subset assignment and the rule before running (a dev-level prereg note).
- Cost: 8 compiles at about $2–4 each (D10: builder $2.25 plus gateway test runs; enable the tier-down and tolerant checks first), plus about $5 of runs. The Sonnet-compiler variant is the main quota draw.
- Kill rule:
  - if (B)'s joint-wrong ratio is not at most half of (A)'s, and (B) does not answer s214 correctly in at least one member, forced diversity does not buy independence here;
  - then pivot to option 2 (decision-point extraction).
- Falsifier: if (B) equals (A), common mode is spec-driven, which matches Ron et al. 2026 and Nogueira et al. 2026, and the fix belongs upstream.

**E2-3. Discrepant-analysis bias, measured counterfactually. Cost: $0, hours.**
- Build `experiments/jit/audit/verification-bias.mjs` over the archived `events.jsonl` and results:
  - (i) the naive oracle-free silent-miss estimate, which assumes concordant answers are correct;
  - (ii) the IPW estimate under a simulated uniform 15% floor on concordant answers, with Begg–Greenes weights;
  - (iii) the dev-oracle truth.
- Metric: the bias of (i) and of (ii) against (iii), and the variance of (ii) across 1,000 simulated floor draws.
- Kill or falsify:
  - if the naive bias is under 1 silent miss per 24 tasks, the floor is not worth its quota;
  - otherwise the floor and the IPW estimator go into the router and the durability metric.

---

## B9. Lineage variance and evaluation validity at small K (D12)

### 1. Mechanism

**A JIT arm is a stochastic program generator whose path depends on rare events.** One compile draw and one heal decide most of an arm's outcome:
- O/H's v1 judge check was over-strict (D3);
- its v2 heal widened a guard (D9);
- in S/H, the Haiku recompile was rejected and the Opus fallback was adopted (D10).

**The arm outcomes are confounded with the lineage draw.** [M]
- S/H 22/24 against O/H 18/24 splits as 5 tasks S-only and 1 task O-only.
- Exact McNemar test: p = 0.22. That is a lineage draw, not evidence about interpreter strength.
- Correctness of a single compiled solver on the tasks it answered ranges from 6/14 to 16/20 across four compiles from the same compiler (nversion summary).

**The evaluation instruments disagree on what "noise" means.**
- `experiments/jit/report.mjs:10` sets `NOISE_SUCCESSES = 3` *tasks*. The reports therefore print "no" (not noise) for any gap of 3 or more tasks. 22 vs 18 would read as a real difference.
- PREREG-stream §4 says "under 3 points (≈1.5 tasks of 48)".
- ROADMAP §4.3 says "gaps over 3 points are not thereby real", and requires "at least 3 random stream orders" and a family-clustered paired bootstrap.
- PREREG-stream §8 fixes one seed order "identical across arms".

**The single-arm standard error is far larger than the noise rule.**
- At n = 24 and p ≈ 0.8, the single-arm SE is about 8 points (Wilson CI for 22/24: 74–98%).
- A 3-point rule therefore sits at about 0.4 SE.
- It is a floor, not a test.

**The effective sample size is a few lineages, not 48 tasks.** [inference, illustrative]
- Tasks are clustered within a lineage. Version-level defects hit every matching input (sweep L2: compiling turns random errors into systematic ones).
- With K = 2 streams per arm, the design effect is 1 + (m−1)ρ. With m = 24 and an assumed ρ = 0.1, that is 3.3, so 48 tasks behave like about 15 independent ones.
- ρ has never been measured.

**Diagnosis leaks into the comparison.**
- D1–D12 were diagnosed with the dev oracle and became v2, v2.1 and v2.2 compile guidance.
- That is legitimate development, but it means the dev streams cannot also validate those versions.

### 2. Ideological root

The assumption is that **an arm is a configuration with a performance number**. In fact a JIT arm is a *process* whose outcome is a random variable with large between-lineage variance and path dependence, and the vision makes things worse in two ways:
- **Promotion and reuse select on noisy estimates.** Picking the best lineage after 24 tasks invites the winner's curse. The same applies to the evidence record that gates reuse.
- **Heals are sequential decisions.** A stream is an adaptive experiment, not i.i.d. trials. Peeking at it, which the kill rules require, invalidates fixed-n p-values.

For the assumption to hold, compiles would need to be near-deterministic (lineage ICC ≈ 0) and heals would need to be rare and benign. The dev evidence contradicts both.

The deeper conflict with the e2e vision: the product promise is about *durability across many future streams*, and that quantity is an expectation over lineages. One lineage per arm measures one sample of it.

### 3. Frontier

- **[paper] Agarwal, Schwarzer, Castro, Courville, Bellemare, "Deep RL at the Edge of the Statistical Precipice", NeurIPS 2021.** https://arxiv.org/abs/2108.13264. OSS: `rliable`.
  - With few runs per task, use interval estimates, performance profiles and the interquartile mean.
  - The seed-variance problem in RL is our lineage-variance problem [inference].
- **[paper] Bouthillier et al., "Accounting for Variance in Machine Learning Benchmarks", MLSys 2021.** https://arxiv.org/abs/2103.03098
  - Data sampling, initialisation and hyperparameters each move results markedly.
  - Randomising *more* sources of variation in each run approximates the ideal estimator at about 51× less compute.
  - For us: randomise compile seed, trace subset *and* stream order together, instead of fixing them.
- **[paper] Miller, "Adding Error Bars to Evals", arXiv 2411.00640, 2024.** https://arxiv.org/abs/2411.00640. Recommends paired differences, clustered SEs and power planning.
- **[paper] Bowyer, Aitchison, Ivanova, "Position: Don't Use the CLT in LLM Evals With Fewer Than a Few Hundred Datapoints", ICML 2025.** https://proceedings.mlr.press/v267/bowyer25a.html
  - CLT intervals are too narrow at small n. Use Bayesian or exact alternatives.
  - The Wilson interval in report.mjs is one acceptable choice. The bigger issue is clustering.
- **[paper] Wang, "Measuring all the noises of LLM Evals", arXiv 2512.21326, 2025/2026.** https://arxiv.org/abs/2512.21326
  - Paired prediction noise usually exceeds paired data noise, so averaging repeated runs buys real power.
  - Our analogue: replicate lineages before adding tasks.
- **[paper] Ramdas, Grünwald, Vovk, Shafer, "Game-theoretic statistics and safe anytime-valid inference", arXiv 2210.01948.** https://arxiv.org/abs/2210.01948v2. Venue not confirmed.
  - E-processes allow peeking and optional stopping with Type-I control.

### 4. Niche verticals

**(a) Cluster-randomised trials and survey sampling.**
- Source: [practice/docs] Kish (1965) design effect 1 + (m−1)ρ; Donner and Klar's use of it in cluster trials. Via https://en.wikipedia.org/wiki/Design_effect, a secondary source.
- How the field solved it:
  - the cluster is the unit of randomisation;
  - power comes from the *number of clusters*;
  - analysis keeps J−2 degrees of freedom.
- Transfer: the **lineage is the cluster**.
- Adaptation for Foundry:
  - the preregistration powers on the number of lineages per arm;
  - the analysis is a mixed model, pass ~ arm + (1 | lineage) + (1 | task), or a lineage-clustered paired bootstrap;
  - extend ROADMAP's "add families before tasks" to **add lineages before tasks**.

**(b) Algorithm configuration racing: F-Race and irace.**
- Source: [paper/practice] López-Ibáñez, Dubois-Lacoste, Pérez Cáceres, Stützle, Birattari, "The irace package", *Operations Research Perspectives* 3, 2016; Birattari et al., "F-race and iterated F-race: An overview", 2010. https://iridia.ulb.ac.be/irace/
- How the field solved it: candidate configurations of a stochastic solver are run instance by instance, and a Friedman-type test drops the losers as soon as the evidence allows. The budget goes to contenders.
- Transfer: **lineage selection is algorithm configuration**.
- Adaptation for Foundry:
  - at warmup, compile M = 3 lineages;
  - race them on the stream's own compiled runs, using disagreement-adjudicated outcomes, never the oracle;
  - eliminate losers sequentially.
  - The system then absorbs lineage variance instead of exposing it. The same machinery allocates evaluation quota across arms.

**(c) Sequential testing: SPRT and e-values.**
- Source: Ramdas et al., above.
- How the field solved it: anytime-valid evidence accumulates over a stream, so you can stop when e ≥ 1/α or at futility.
- Transfer: streams are sequential. Kill rules ("stop an arm at 2× budget", the Day-2 pivot rule) are optional stopping in disguise.
- Adaptation for Foundry: a paired e-process on the per-task difference between JIT and agent, with a non-inferiority margin δ (ROADMAP requires δ). It saves usage quota on held-out runs, which is the true currency (THESIS-JIT §6.6).

**(d) Plant breeding: multi-environment trials and BLUP.**
- Source: [paper] Piepho, Möhring, Melchinger, Büchse, "BLUP for phenotypic selection in plant breeding and variety testing", *Euphytica* 161:209–228, 2008. Seen as a citation only; contents unverified.
- How the field solved it: breeders select genotypes from noisy trials across environments. Line means are shrunk toward the population mean (BLUP), and genotype×environment variance is estimated before any line is promoted.
- Transfer:
  - lineage = genotype;
  - family or calling program = environment;
  - **reuse promotion = variety release**.
- Adaptation for Foundry:
  - the evidence record of a reusable workflow (THESIS-JIT §6.7) reports a *shrunk* success estimate (beta-binomial empirical Bayes over the lineage population);
  - it also reports a G×E term, measured when a second program calls the workflow;
  - promotion uses the shrunk estimate, which counters the winner's curse.

### 5. Creative options

1. **Make the system variance-reducing.** The arm becomes a *portfolio policy*: race M lineages, keep ancestors alive, and on a deopt try a sibling before the interpreter. The unit under evaluation becomes the policy, whose between-replicate variance should fall. This is a patch with structural payoff.
2. **Change the problem: evaluate on a crossed outcome table plus a stream simulator.**
   - Compiled solvers are code plus journaled judges, so any version can be replayed on any task at about $0.
   - Build the full version × task table, plus an interpreter × task table from the archived agent arms.
   - Then *simulate* the stream logic (`stream.mjs` semantics: shadow schedule, adjudication, recompile triggers restricted to versions that exist) over hundreds of random orders and shadow seeds.
   - Only *generating new lineages* costs quota. Order variance and shadow-schedule variance become free to estimate.
   - This is off-policy evaluation of the router.
   - Caveat: recompiles not in the table cannot be simulated. That limit must be stated.
3. **Fix the instrument first.** Replace `NOISE_SUCCESSES` with ROADMAP-conformant output:
   - an exact McNemar test for each paired arm comparison;
   - a lineage-clustered paired bootstrap CI;
   - a verdict that reads "directional / no decision / decision vs δ".

   Also reconcile PREREG-stream §4 and §8 with ROADMAP: points vs tasks, and 3 random orders.
4. **Shrinkage-gated reuse.** No workflow is promoted for reuse on its raw record. It needs the BLUP-style lower bound plus a measured G×E.

### 6. Experiments (ranked)

**E9-1. Variance components and a power table. Cost: about $0 beyond E2-1's table, hours.**
- Build `experiments/jit/audit/variance.mjs` on E2-1's version × task table and the archived results:
  - fit a beta-binomial or logistic mixed model with lineage and task random effects (plain JS, exact-pinned deps or none);
  - estimate ρ, the design effect, and the number of lineages per arm needed for a δ = 10-point non-inferiority test at 80% power;
  - patch `report.mjs` (an experiments-side change) to print an exact McNemar test and a clustered CI.
- Baseline: the current K=2, fixed-order PREREG design.
- Preregistration: the result *feeds* the prereg (§4 power), and is frozen before any test seed runs.
- Quota: none.
- Falsifier: if ρ̂ < 0.02 with an upper CI bound below 0.05, D12's lineage-variance reading is wrong and K = 2 is adequate. Record that.
- Kill: if the required number of lineages exceeds about 6 per arm at δ = 10, held-out comparisons of single-lineage arms become "directional, no decision" by rule. Only portfolio arms (E9-2) are worth sealing.

**E9-2. Portfolio racing against a single lineage, across replicates. Cost: about $40–70, about one day; quota-heavy because interpreters and shadows run.**
- Arms on dev seeds, each with R = 3 random stream orders:
  - (A) the current S/H JIT, single lineage;
  - (B) S/H with M = 3 forced-diverse Haiku lineages (reusing E2-2's vectors), raced, with sibling-before-interpreter fallback.
- Metrics:
  - mean successes;
  - between-replicate SD of successes, the primary dev metric;
  - $/success;
  - quota-meter share per arm-hour;
  - silent misses.
- Preregistration: required before the held-out version. Dev runs are labelled development.
- Kill rule: if (B)'s replicate SD is not below (A)'s and its mean is below (A)'s, or its cost exceeds 1.5× (A)'s, drop portfolios. Lineage variance then has to be handled statistically, not architecturally.
- Falsifier: (B) has variance no lower than (A).

**E9-3. Simulated streams and an anytime-valid analysis. Cost: $0, hours.**
- Build `experiments/jit/simulate-stream.mjs`, which replays `stream.mjs` decisions over the crossed tables from E2-1 and the agent arms.
- Use it to:
  1. estimate order and shadow-schedule variance;
  2. compute the expected sample size of a paired e-process (δ = 10, α = 0.05) against fixed n = 48.
- Validation: the simulated S/H run with the archived order must reproduce the real 22/24 within one task. If it does not, the simulator is invalid and nothing built on it counts.
- Kill rule: if the e-process does not save at least 25% expected quota, keep the fixed-n design.

---

## Cluster-level interaction

B2 and B9 are the same covariance seen from two sides.
- **B9 is variance across lineages.** That is exactly the raw material N-version voting needs.
- **B2 is the covariance that caps what voting can extract.** Ensemble error is roughly average member error minus diversity, but only the *variance* part of the error is reducible. The shared-difficulty part (Eckhardt–Lee E[θ]², the s214 floor) is untouched by any number of same-spec votes.

Turning B9's variance into B2's diversity (portfolios, racing) helps only if the diversity is *forced* (Littlewood–Miller). Otherwise one gets Nogueira et al.'s 0.3–0.44 of the theoretical gain.

The two blockers also share an instrument bug. Discrepant-only adjudication (Hadgu, Begg–Greenes) biases the system's own durability estimates, and lineage clustering (Kish) biases the experimenter's. Both make the evidence look stronger than it is, and both are fixed by the same artefact:
- a crossed version × task outcome table;
- a uniform verification floor with known probabilities;
- analysis clustered by lineage.

Heals connect the two. D9's guard-widening heal was at once:
- a lineage-variance event, accounting for most of O/H's deficit;
- a common-mode destroyer, since `opusV2` stopped refusing alongside its siblings and its lone answers were all wrong.

So "a recompile must not widen the domain" (v2.2) and "a lone answerer escalates" are one rule seen from the two blockers.

The suggested order is E2-1 → E9-1 → E2-3 → E9-3, all at about $0, before any quota-heavy work (E2-2, E9-2). If E2-1 shows a non-parent β near 0 and E9-1 shows ρ near 0, both blockers shrink to an instrument fix. If not, the portfolio-with-decision-extraction design (B2 option 2 plus B9 option 1) is the structural answer, and single-lineage held-out claims should be reported as "no decision" by rule.

No files were written. The repo paths cited are:
- /home/user/workflow-foundry/research/jit-20261008/nversion-records-dev.json
- /home/user/workflow-foundry/research/jit-20261008/DEV-NOTES.md
- /home/user/workflow-foundry/research/jit-20261008/PREREG-stream.md
- /home/user/workflow-foundry/experiments/jit/report.mjs (line 10)
- /home/user/workflow-foundry/experiments/jit/stream.mjs (lines 533–547)
- /home/user/workflow-foundry/experiments/runs/jit/jit-dev-records-1/*/results.jsonl
- /home/user/workflow-foundry/docs/ROADMAP.md (around lines 880–891)

## Agent result 2

# Decision-verification cluster: B1 silent compiled misses, B7 answer equivalence without an oracle

*Read-only dossier, 2026-10-09. No repository edits and no model calls. Tags: **[repo]** means read in this repository this session (dev split, K=1, directional only). **[paper]** and **[practice/docs]** mark sources I opened or saw in search this session. **[inference]** is my reasoning. "Unverified" means I could not check it.*

*This dossier builds on the earlier frontier sweep and does not repeat it. The sweep already covered Fellegi–Sunter's three regions, Splink, the margin audit (X-A1a), metamorphic relations MR1–4 (X-A1b), Daikon sample bounds, conformal and selective prediction, Weaver and Dawid–Skene, CodeT, and Kim et al. on correlated errors. Everything below is either new or goes further on those points.*

---

## B1: Silent compiled misses at near-threshold identity and merge decisions

### 1. Mechanism

- **The rule is a hard conjunction with no abstain region [repo].** In `experiments/runs/jit/jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5/versions/v1-haiku55/solve.mjs:493-498`:
  - names must satisfy `partDist(given)+partDist(family) <= 1`, using OSA edit distance over rendering variants;
  - then the DOB must be equal if both rows have one, otherwise the phone must be equal;
  - then union-find runs over all pairs (lines 500-503).

  Every pair is decided link or non-link. A pair at total distance 2 ("Bneoit N." against a full family name, or a one-typo given name plus a one-typo family name) becomes a non-link. A pair whose DOBs disagree only because a judge-supplied date order (`RULES.date_order.*`, lines 407-426) was misread is also a non-link.
- **The outcome is under-merging with precision 1.0 and recall below 1 [repo].**
  - s205: predicted 36 against 34 entities, recall 0.970.
  - s214: 40 against 36, recall 0.873.
  - The wrong country, phone and amount then follow from the split entity. For example, entity 1130 got CA/+1604… instead of NL/+3120…. The amount is drawn from whichever fragment holds the money row (`results.jsonl` oracleDetails).
- **Why nothing fired [repo].**
  - Conservation invariants still hold for a missed merge.
  - Quote checks only verify the parsed fields.
  - The v1 prompt had no notion of a "flag".
  - Shadows ran every 4th task and missed both seeds.
  - The N-version probe shows the miss is common-mode: s214 was under-merged identically by three independently compiled solvers (`nversion-records-dev.json`, D8). The compilers share a reading of "one typing error", so they share the boundary.
- **Compounding [inference].** The identity decision sits downstream of other decisions: a date-order judge, nickname folding, phone normalisation. A small error upstream moves a pair across the boundary, so the risk surface is the composition of several thresholds, not one.
- **The grader has a cliff of its own [repo].** s205 failed because of `entitySlack 0.02`: 2 extra entities out of 34, while fieldAccuracy was 0.979 and pairF1 0.985. B1 misses are therefore also near the oracle's own threshold. That is A7's threshold noise appearing in the B1 measurements.
- **v2 is a partial patch [repo].**
  - `prompts.mjs:45-50` now says to "decide clear cases in code, send near-threshold candidates to one narrow flow.judge… flow.flag weak evidence".
  - `flow-v2.mjs:78-84,191,223` implements flags.
  - The compiler still decides where "near" ends. That band is authored, not calibrated, and nothing measures its miss rate.

### 2. Ideological root

The assumption is that **compiling a judgment means replacing it with a rule fitted to traces, and that the rule's residual errors are rare and loud**. THESIS-JIT §2.3 counted on "mined invariants catch silent errors at $0", and §6.6 makes "the share of decisions made by code or Kev" the objective.

Judged against the full end-to-end vision, that objective rewards exactly this blocker. A compiler maximising the code share has every incentive to turn borderline judgments into thresholds. Nothing in the objective prices the consumer's risk of each threshold [inference].

For the assumption to hold, three things would all have to be true:
1. Decision inputs have a **margin gap**: almost no probability mass near the threshold.
2. That gap survives drift.
3. It survives **reuse by other programs** (§6.7).

Real name data has heavy mass near edit-distance thresholds: transliteration, particles, initials. The records bed is built with near-miss typos. Reuse moves the input distribution by definition. The runtime-learned input profile (§6.4) guards *shapes*, not *margin distributions*. A reused records workflow fed Vietnamese or Arabic names passes every shape guard and lands at the boundary [inference].

The deeper error is treating **the task as the unit of verification**. Risk is concentrated in a handful of decisions per task, around 2–4 pairs out of hundreds. Verifying whole answers, by shadowing, spends roughly 50× too much on the wrong thing (§6.2).

### 3. Frontier (record linkage, beyond the sweep)

- **Estimating error rates without truth.**
  - Belin & Rubin, "A Method for Calibrating False-Match Rates in Record Linkage", *JASA* 1995, pp. 694–707 [paper]. They fit a two-component mixture to the observed match weights and read off a false-match rate at each cutoff. It needs some truth data to fit (Census CARRA working paper 2014-02, https://www.census.gov/library/working-papers/2014/adrm/carra-wp-2014-02.html [practice/docs]).
  - Winkler (2007) proposed a no-training-data variant for well-separated cases (https://www.census.gov/library/working-papers/2007/adrm/rrs2007-05.html [practice/docs]).
  - Enamorado, Fifield & Imai, "Using a Probabilistic Model to Assist Merging of Large-scale Administrative Records", *APSR* 113(2), 2019 (fastLink, https://imai.fas.harvard.edu/research/linkage.html) [paper]. It reports **estimated FDR and FNR from the posterior**, and the authors' simulations show the estimates track the true rates.
  - Transfer: a compiled identity step can emit a match *weight* and report an estimated missed-link rate per task, with no oracle.
- **Pairwise decisions ignore global consistency.** Wang et al., "Match, Compare, or Select? An Investigation of Large Language Models for Entity Matching", COLING 2025, arXiv 2405.16884, code `tshu-w/ComEM` [paper]. Binary pairwise matching "ignores the global consistency between record relationships". Their *select* strategy, which picks the matching record among candidates, plus a compound framework, improves both quality and cost. For Foundry, the narrow judge should be "which of these k candidates, if any, is this row?" rather than k yes/no calls [inference].
- **Active labelling of the uncertain band.** The `dedupe` library's `uncertain_pairs()` / `mark_pairs()` loop (https://docs.dedupe.io/en/latest/API-documentation.html, MIT) [practice/docs] is the OSS form of "send the band to the adjudicator, learn from the labels". The labels are the Kev training targets that THESIS-JIT §2.6 wants.

### 4. Niche verticals

**(a) Risk-limiting election audits: verification effort scales with 1/margin, and decision-level records make it cheap.**
- Lindeman & Stark, "A Gentle Introduction to Risk-Limiting Audits", *IEEE Security & Privacy* 2012, https://www.stat.berkeley.edu/~stark/Preprints/gentle12.pdf (text extracted and read) [paper]. Three statements matter:
  - "Smaller (percentage) margins require more evidence… the audit examines more ballots if the margin is 1% than if it is 10%."
  - The audit escalates toward "a full hand tally" until the risk limit is met.
  - The most efficient form, **comparison audits**, needs "the voting system interpretation of every ballot" (cast-vote records). With a parallel unofficial system that agrees, "either both are right or both are wrong", which is the paper's own common-mode warning.
- Transfer:
  - A compiled solver that logs every identity decision with its margin is a cast-vote record.
  - Audit decisions with probability inversely proportional to their margin, and escalate to a full interpreter re-solve (the "hand count") only when band audits find discrepancies.
  - The owner's cost/reliability slider becomes the **risk limit α**: the largest chance that a wrong merge decision ships unaudited [inference].
- Foundry adaptation:
  - `flow.decide(name, {candidates, margin, chosen})` writes a decision record.
  - The stream samples decisions with P ∝ min(1, c/margin) for narrow Opus adjudication.
  - A discrepancy escalates that task to a full shadow.

**(b) Clinical laboratory QC: Westgard multirules, patient-based real-time QC and delta checks.**
- Sources:
  - Westgard, Barry, Hunt & Groth, "A multi-rule Shewhart chart for quality control in clinical chemistry", *Clin Chem* 27:493–501, 1981 [paper]. Control materials of known value run beside patient samples, and a run is judged by combined rules (1-3s, 2-2s, R-4s, 4-1s, 10-x) to separate random from systematic error (https://casrai.org/guides/westgard-rules [practice/docs]).
  - Badrick et al., "Patient-Based Real-Time Quality Control: Review and Recommendations", *Clin Chem* 2019;65:962–71 (IFCC) [paper; abstract-level only]. Moving averages and medians of *patient results themselves* detect systematic shift without control material.
  - Delta checks: CLSI EP33 (2nd ed. 2023) [practice/docs] compares a patient's result with their previous one. The reference change value comes from Harris & Yasaka, *Clin Chem* 1983;29:25–30 [paper]; the formula RCV = z·√2·√(CVa²+CVi²) is from my own knowledge (unverified).
- Transfer:
  - Westgard: inject **known-truth control items** into every run.
  - PBRTQC: monitor a **moving statistic of outputs** over the stream. For records, use merge ratio = entities/rows and the share of entities with a single source row. Systematic under-merging shifts both.
  - Delta: compare a run's statistic with the same source's history.
- Adaptation: `experiments/jit/qc/`.
  - A per-family statistic vector is computed from every delivered answer.
  - An EWMA with limits is learned from interpreter-delivered tasks, which are the stream's "normal" population.
  - Westgard-style rules (one point beyond 3σ, two consecutive beyond 2σ) raise `flow.flag`-equivalent stream events that force a shadow.
  - This is $0 per task and catches **systematic** bias, the error class sampling-based uncertainty misses (sweep §0.1).

**(c) Financial audit sampling and materiality: monetary-unit sampling with a zero-error bound.**
- Monetary-unit sampling selects items with probability proportional to their value. When zero misstatements are found, the upper misstatement limit is the sampling interval × 3.0 at 95% (Poisson: 1−e⁻³≈0.95). That factor is from my general knowledge, but the evaluation logic is documented in the CRAN `MUS` package and HighBond's MUS evaluation (https://help.highbond.com/helpdocs/analytics/15/en-us/Content/analytics/data_preparation/sampling_data/evaluating_errors_in_a_monetary_unit_sample.htm) [practice/docs].
- Transfer: sample decisions proportional to **leverage**, the downstream output leaves that depend on them (D11 already defines leverage). A wrongly split entity corrupts about 4–6 leaves. Then state **promotion as an upper bound**: "n audited band decisions, 0 errors ⇒ error rate ≤ 3/n at 95%".
- For the reuse gate (§6.7), "durable" stops being an adjective and becomes a number with a confidence level, comparable against a declared tolerable rate [inference].

**(d) Double-entry bookkeeping: the errors a trial balance cannot see.**
- A trial balance only tests that debits equal credits. Errors of **omission, commission, principle, compensating errors, original entry and reversal** pass it (TutorChase CIE notes, https://www.tutorchase.com/notes/cie-a-level/accounting/1-4-3-trial-balance-errors; Tally guide, https://tallysolutions.com/accounting/types-of-errors-in-accounting-a-complete-guide-with-examples/) [practice/docs].
- Our conservation invariant (rows in = rows assigned) is a trial balance, and an under-merge is an error of commission: it posts to the wrong account and the totals still agree.
- Bookkeeping's answer is reconciliation against an **independently produced** record, as in bank reconciliation.
- Transfer: compute a load-bearing quantity, such as the entity count, by a **second, structurally different path**, and treat disagreement as a reconciliation item. Examples of a second path: a blocking-key count over (DOB, phone) or (phone) alone; clusters from a looser rule; or a Kev or Haiku count of "distinct people" on a cheap projection. In this setting, "double entry" means two independent derivations, not two copies of one [inference].

**(e) Airport threat image projection, as a control that keeps the checker calibrated.**
- Hofer & Schwaninger, "Using Threat Image Projection Data for Assessing Individual Screener Performance", WIT Press 2005, doi:10.2495/SAFE050411 [paper; abstract and secondary summaries]. Fictional threats are projected into live bags, and misses are logged. They warn that hit rate alone is invalid and that signal-detection measures (hits *and* false alarms) are needed.
- The audit-world twin is the **Integrated Test Facility**: a fictitious entity processed alongside live transactions, whose effects are removed afterwards (https://en.wikipedia.org/wiki/Integrated_test_facility) [practice/docs].
- Transfer: add a **fictitious person** (2–3 rows: one exact, one with a typo, one with an initial) in the formats of the structured systems already present. Delete it from the output. Score the merge of the fictitious person, which is known by construction, so no oracle is involved.
- This differs from the sweep's MR3, which twins an *existing* row and checks the count. ITF measures **in-situ recall per typo class** with the task's own conventions, every run, and feeds Westgard rules over the stream.

### 5. Creative options

1. **Decision ledger with a margin-proportional audit (RLA for compiled code).**
   - Every threshold decision records its margin.
   - Audits are sampled at P ∝ leverage / margin.
   - Narrow Opus "select among candidates" questions use the ComEM form.
   - Adjudicated decisions become Kev labels and regression cases.
   - Patch-level, but it converts §6.2 into machinery with a stated risk limit.
2. **Calibrated three-region identity with posterior error reporting (fastLink-style).**
   - The compiler emits a scored matcher: per-feature agreement levels and weights fitted by EM on the task's *own* pairs, which is unsupervised and needs no oracle.
   - It also emits two cutoffs derived from a declared FDR/FNR target, not one hand-picked cutoff.
   - The answer ships with estimated FNR. If that exceeds the materiality target, the task is flagged.
3. **Change the problem: precedents, not thresholds.**
   - The stream keeps a *precedent register* of adjudicated borderline decisions, keyed by feature pattern. One example key: "given-name transposition + family initial-only + same DOB".
   - Compiled code applies a precedent when a new pair matches its pattern, and escalates when no precedent covers the pair.
   - The threshold disappears. The boundary is learned case by case, the way case law grows, and the precedent register *is* the domain of validity for reuse. A second program inherits the precedents, and novel patterns refuse.
   - Real recurring work (CRM, patient-index style) also repeats the *same entities* across tasks, so cached adjudications amortise directly. The records bed draws independent seeds and cannot test that part [inference].
4. **Change the problem: deliver provisional merges and settle them later.**
   - The output carries a `possible_links` section: the abstain region as a first-class output.
   - Recurring work settles possible links when later tasks bring more evidence, like a delta check.
   - This needs output-contract support and an owner decision on whether provisional answers are acceptable [inference].

### 6. Experiments (ranked)

**E1. Decision-ledger replay: are the misses actually near the boundary, and what does the band cost? ($0 offline, then ≤$3 live).**
- **Build:**
  - `experiments/jit/audit/decisions.mjs` makes a variant of each archived `solve.mjs` that wraps `linked()` to log `{i, j, dGiven, dFamily, dobRel (equal/differ/missing), phoneEq, linked}`. Reuse the variant-and-rerun machinery in `tierdown-e2e.mjs`, with model calls replayed from the arm journal. Replay-key validity is unverified, so check it first.
  - Run it on dev seeds 201–224 for S/H v1, O/H v1/v2 and H/H v1.
  - Map each known miss to its unlinked pair(s), using the dev oracle offline, for scoring only.
- **Metric:**
  - the share of known missed links with margin ≤ m, for m = 1, 2, 3;
  - band size per task (pairs within margin);
  - the share of misses caused by an upstream DOB disagreement rather than name distance.
- **Live step (records dev seeds only):** send band pairs as batched "select among candidates" questions to the strongest policy tier. Measure precision and recall of the corrected merges against the dev oracle.
- **Baselines:** the v2 authored-band flags as compiled, and uniform shadow at 0.25 (caught 0/2 in S/H).
- **Preregistration:** none for the dev diagnostic. The margin definition must be frozen *before* the pairs are listed. The miss names are already known (D1), so mark that contamination.
- **Cost:**
  - Offline is $0 if replay hits, otherwise about $0.005 per run.
  - Live: roughly 24 tasks × ≤10 band pairs × about $0.01 per batch, an estimate [inference], so ≤$3. That is low quota, far below one Opus shadow per task (about $0.45).
- **Kill rule:** if catching ≥3 of 4 known misses needs a band of >25 pairs per task, or narrow adjudication is below 90% correct on band pairs, then decision-level verification is not cheaper than shadowing for records.
- **Falsifier:** if most misses come from a DOB disagreement, meaning an upstream date-order judge error, then "near-threshold identity" is the wrong diagnosis. The fix belongs in upstream checks (consequence checks, sweep X-A5a).

**E2. ITF fictitious-entity controls with Westgard rules, plus a PBRTQC merge-ratio monitor ($0–$0.5).**
- **Build:** `experiments/jit/qc/itf.mjs` injects one fictitious person with 3 rows across 2 structured systems. Each row clones the format of an existing row, uses a synthetic name, and draws one of {transposition, substitution, diacritic drop, initial-only} with an equal DOB. It removes that person from the output before delivery. `qc/pbrtqc.mjs` computes the merge-ratio EWMA from interpreter-delivered tasks.
- **Metric:**
  - ITF recall per typo class across archived compiled versions;
  - Spearman correlation between per-run ITF failure and oracle failure on the untransformed task;
  - PBRTQC alarm hits and false alarms over the 17 compiled deliveries.
- **Baseline:** current detectors (0/6 flagged, per the sweep inventory).
- **Preregistration:** the typo model and the Westgard limits must be frozen from the spec text and dev seeds 201–212, then evaluated on 213–224. Label that within-dev split as diagnostic.
- **Cost:** $0 if the injected rows touch only code-parsed systems. Otherwise there are extra judge calls at about $0.0014 each.
- **Kill rule:** ITF recall ≥0.95 on solvers that the oracle shows under-merging means the controls do not represent the real boundary, because the typo model misses the hard cases. Stop.
- **Falsifier:** if ITF failure does not rank the failing versions (H/H, O/H v2) below S/H v1, controls do not predict field performance.

**E3. Double-entry entity count ($0).** Compute an independent entity count with a DOB+phone blocking estimator and a looser union-find, and log the reconciliation gap per run. The metric is the gap's AUROC for oracle failure on the 17 compiled deliveries. The kill rule is AUROC < 0.7.

---

## B7: Answer equivalence without an oracle

### 1. Mechanism

- **Exact canonical comparison is the default everywhere [repo].**
  - `experiments/jit/stream.mjs:112-121` `sameAnswer` has only `canonical` and `unordered` modes.
  - `check-traces.mjs:36-81` uses exact canonical JSON plus leaf-partial.
- **Kinetics answers are fitted reals, so exact comparison always disagrees [repo, D7].**
  - The prompt states the grading rule, which is ±10% relative to the truth (`beds/kinetics/README.md:21-22,69-71`).
  - The bed guarantees that the reference NLLS fit is within 5% of the truth and a replicate-mean fit within 8% (README:95-98).
  - So **two correct answers can differ by about 13% by method choice alone, and by up to about 20% while both pass** [inference from the stated bounds].
  - Hence D7: the Opus shadow disagreed with a correct compiled answer, the adjudicator was `unresolved`, and $1.13 bought nothing. Exact agreement in check-traces was 0 by construction (sweep F7), which would make D4's stricter acceptance reject good solvers.
- **The v2.1 fix (worktree `wf_eb243b06-14f-1/experiments/jit/compare.mjs`) is necessary but under-specified [repo].**
  - It is a single symmetric `relTol` with **default 0.01**, plus multiset bipartite matching.
  - Against a 13–20% legitimate spread, 0.01 still produces false disagreements.
  - Loosening it to 0.20 approaches the bed's decision spacing: "any two conditions differ by at least 30%" (README:84). Beyond that point the comparator cannot tell a mis-attached condition from method noise.
  - The comparator's discrimination has never been measured.
- **Tolerance is not transitive [repo + inference].**
  - `compare.mjs` handles non-transitivity correctly inside array matching.
  - The stream's majority-of-three (`stream.mjs:536-537`) treats `sameAnswer` as an equivalence relation. With a ≈ b, b ≈ c and a ≉ c, the outcome depends on the order of the checks, and the compiled answer is tested first, so the bias favours it.
- **Representation mismatches look like disagreements [repo, D6].** `"env":"sandbox"` against `sandbox` caused leaf-agreement to under-count equal judgments, which is the same disease at a string leaf.
- **Records equivalence needs entity alignment [inference].** Comparing two records answers with different entity sets requires aligning entities, which is itself entity resolution, B1's problem.

### 2. Ideological root

The assumption is that **an answer has a canonical identity, so equality is a property of values**. That holds only when the task is a function onto a discrete, uniquely determined output, as with codefix or enumerations.

The vision targets *arbitrary recurring work*: estimates, merged datasets, summaries, plans, replicated human workflows. There, many outputs are correct, and "the same" means **no difference that matters to the consumer**. Equivalence is a property of the *use*: materiality.

Two consequences follow:
1. The comparator is part of the specification, as much as the solver is, and it needs its own evidence (§6.5's "spec first" must include it).
2. Every oracle-free mechanism in the vision is built on the comparator: shadows, adjudication, N-version voting, reject-if-worse, tier-down screens, reuse checks and the replication goal "durable state equal or better than the human's". If the comparator is wrong, all of them are wrong together.

For the assumption to hold, the output space would have to be discrete, every correct procedure would have to give byte-identical results, and representation would have to be normalised. None of these holds for numeric, textual or set-valued families [inference].

### 3. Frontier (answer equivalence)

- Bulian, Buck, Gajewski, Börschinger & Schuster, "Tomayto, Tomahto. Beyond Token-level Answer Equivalence for Question Answering Evaluation", EMNLP 2022, arXiv 2202.07654 [paper].
  - Their equivalence is **one-directional**: a candidate is acceptable if it matches *or improves on* the reference.
  - Token F1 gives "a misleading sense of graded correctness" and ignores the question.
  - A trained BERT matcher (BEM) tracks human judgments better.
  - Lesson: equivalence is question-conditioned and asymmetric. Our symmetric `relTol` is neither.
- Hugging Face **Math-Verify** (https://github.com/huggingface/Math-Verify) [practice/docs] runs an escalation ladder: string compare, then SymPy equality, then a numeric check at set precision, then symbolic simplification of the difference, with relation flipping and set/interval semantics. It is a compare cascade analogous to a judge tier ladder.
- Minerva (arXiv 2206.14858) [paper] used SymPy simplify with a 5 s timeout and counted a timeout as *not equivalent*. That silently converts "cannot decide" into "different", the same defect that made D7 unresolvable.
- **Observational equivalence** in enumerative synthesis groups programs by their outputs on example inputs (ECOOP 2025 SObEq, https://drops.dagstuhl.de/storage/00lipics/lipics-vol333-ecoop2025/LIPIcs.ECOOP.2025.10/LIPIcs.ECOOP.2025.10.pdf) [paper]. The lesson: equivalence of *procedures* can be tested on chosen inputs where answers are discrete, even when final outputs are continuous.

### 4. Niche verticals

**(a) Metrology: En numbers, gauge R&R and guard-banded decision rules.**
- **En number.** ISO 13528 proficiency testing scores a lab against a reference with En = (x − x_ref)/√(U_x² + U_ref²), satisfactory if |En| ≤ 1 (NIST Dataplot, https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/enscore.htm) [practice/docs]. The tolerance is **per comparison, from each result's own uncertainty**, not a family constant.
- **Gauge R&R.** The AIAG MSA criteria are %GRR <10% acceptable, 10–30% marginal, >30% unacceptable, and number of distinct categories ndc = 1.41·PV/GRR ≥ 5 (secondary summaries, e.g. https://help.sigmazone.com/quantum-xl/v17/statistical-tools/msa/msa-statistics) [practice/docs; edition and page unverified]. Before a gauge is used, it must be shown to resolve the differences that matter.
- **Decision rules.** JCGM 106:2012 and ILAC-G8 define guard bands, plus consumer's and producer's risk (probability of false accept and false reject). "Guarded rejection" requires clear evidence before a negative action (secondary sources, https://mhforce.com/guarded-rejection/) [practice/docs; normative text unverified].
- **Transfer:**
  1. Answers carry uncertainty, for example a fit's standard error or a bootstrap interval, and the comparator uses En.
  2. Run a **comparator gauge study** before deploying any comparator. Its variance between correct answers (R&R) must be small relative to the spacing of *wrong* answers (here the ≥30% condition spacing), ndc ≥ 5.
  3. A disagreement escalates only under guarded rejection: |En| clearly > 1. The middle band is "indeterminate", not "disagree".

**(b) Bioequivalence: equivalence must be *proved*, within a margin fixed in advance.**
- Schuirmann, "A comparison of the Two One-Sided Tests Procedure and the Power Approach for assessing the equivalence of average bioavailability", *J Pharmacokinet Biopharm* 15(6):657–680, 1987 [paper]. In current practice, ABE is shown when the 90% CI of the ratio lies in [0.80, 1.25] (Stata `pkequiv` manual, https://www.stata.com/manuals/rpkequiv.pdf) [practice/docs].
- Transfer: the comparison becomes **three-valued**: *equivalent* (interval inside the margin), *different* (interval outside), *indeterminate* (straddling). The margin is declared from the consumer's need before data.
- Indeterminate routes to evidence gathering. Examples: ask the producers to emit their decision ledgers, or re-derive both answers through a shared fitter. It never routes to a re-solve majority vote, which is what wasted $1.13 in D7.

**(c) Method comparison in clinical measurement: limits of agreement, not correlation.**
- Bland & Altman, "Statistical methods for assessing agreement between two methods of clinical measurement", *Lancet* 1986;1(8476):307–10 (https://www-users.york.ac.uk/~mb55/meas/ba.htm) [paper]. They reject correlation for agreement and use the mean ± 1.96 SD of the paired differences. The formula is from my own knowledge, consistent with the source summary.
- Transfer: estimate the **limits of agreement between solver families**, for example compiled vs Opus interpreter, from paired dev answers. Set the shadow tolerance from those limits, measured, rather than from an assumed 1%.

**(d) Statistical-software accuracy: certified values and log relative error.**
- McCullough, "Assessing the Reliability of Statistical Software: Part I", *Am Stat* 52(4):358–366, 1998 [paper]. NIST StRD nonlinear-regression problems carry certified values at 11 significant digits (https://itl.nist.gov/div898/strd/), and accuracy is scored as LRE = −log10(|q−c|/|c|), the number of correct digits [practice/docs, via the gretl supplement].
- Transfer:
  - Compare in *digits of agreement* (LRE) against the precision the task actually needs. That is 1 digit for ±10%, so LRE ≥ 1 between correct fits should be expected and required.
  - Seed **certified control datasets** (Westgard-style) into the kinetics stream to check the fitter itself.

**(e) Audit materiality.**
- In monetary-unit sampling, misstatements are projected and the upper error limit is compared with *materiality*, the size that would change a user's decision (the HighBond MUS guide above) [practice/docs].
- Transfer: the tolerance per output leaf is "the difference that would change a downstream decision". For kinetics, a mis-attachment means ≥30% and a wrong exclusion moves Km by some measurable amount. The tolerance is derived from the consumer contract, and in the replication vision, from what the human workflow's consumer acts on.

### 5. Creative options

1. **Comparator as a spec artifact, with a gauge study.**
   - Spec-first (§6.5): the strong model writes a per-family comparator spec: leaf types, materiality per leaf, asymmetric "improves on" rules à la BEM, and representation normalisers.
   - The comparator ships only after a dev gauge study shows ndc ≥ 5 and a false-disagreement rate within budget.
2. **Three-valued, guarded comparisons (TOST / JCGM).** `sameAnswer` returns `equivalent | different | indeterminate`. `indeterminate` never triggers re-solve majority voting. It triggers ledger comparison (option 3) or is delivered with a flag. Adjudication then works on equivalence *classes* built by single-linkage over `equivalent` with a diameter check, which removes the order dependence.
3. **Change the problem: compare causes, then canonicalise consequences.**
   - Kinetics answers decompose into discrete decisions (excluded wells, row-to-condition attachment, shared-Vmax pairing) plus a deterministic consequence (a fit).
   - Make both producers emit the decision set. Compare decisions **exactly**, since they are discrete.
   - Then **re-derive both answers through one shared canonical fitter**, a composed, guarded module (§6.7 composition), and compare those outputs exactly. Equal decisions then give byte-equal answers.
   - Any residual disagreement is localised to a named decision, which is exactly the "verify decisions, not answers" input that B1's ledger needs.
   - The analogue is audit "re-performance" and canonical forms (canonical SMILES/InChI) [inference].
   - This removes B7 for every family whose output is "decisions + deterministic computation", which covers most recurring business work.
4. **Answers carry uncertainty (En).** `flow.done(answer, {uncertainty})`: fits report standard errors, and identity steps report estimated FNR (B1 option 2). Comparison is then |En| ≤ 1. A producer whose stated uncertainty fails proficiency (|En| > 1 against adjudicated truths) loses trust: the uncertainty is itself audited.

### 6. Experiments (ranked)

**E4. Comparator gauge study on archived multi-arm answers ($0).**
- **Build:** `experiments/jit/audit/comparator-gauge.mjs`.
  - For each kinetics dev seed, collect every archived answer: agent Haiku, Sonnet, Opus and the JIT interpreters' traces and shadows (`trace.json` `answer`). Verify that answers are persisted; compiled outputs are not (sweep note).
  - Label each answer pass or fail with the dev oracle, offline and for scoring only.
  - Form pairs (correct, correct) and (correct, wrong).
  - Evaluate these comparators: exact; `relTol` 0.01 (v2.1 default); 0.10; 0.20; excluded-set-exact plus numbers at 0.20; Bland–Altman limits fitted on half the seeds.
  - Repeat on records with `unordered` against entity-aligned comparison.
- **Metrics:**
  - false-disagreement rate P(¬agree | both correct), which is wasted adjudication;
  - false-agreement rate P(agree | one wrong), which is a hidden miss;
  - ndc-style separation;
  - counterfactual adjudication $ saved on archived `events.jsonl`.
- **Baseline:** exact canonical (the current default).
- **Preregistration:** none (dev). The winning comparator must be **frozen into PREREG-stream** before any held-out stream, as a declared design parameter.
- **Cost:** $0 and no quota.
- **Kill rule:** if no comparator reaches false-disagreement ≤10% with false-agreement ≤20%, answer-level comparison is unusable for kinetics, and E5 becomes mandatory.
- **Falsifier of the B7 diagnosis:** if exact comparison already has false-disagreement <20% on (correct, correct) pairs, D7 was a one-off rather than structural.

**E5. Decision-first comparison with canonical re-derivation (≤$1).**
- **Build:**
  - `experiments/jit/audit/kinetics-decisions.mjs` extracts decision sets from answers: `excluded_samples` is already in the output; attachment is inferred by matching conditions.
  - Write one canonical NLLS fitter module. It must be written from the SOP text, never from `fit.mjs` or oracle code.
  - Refit both answers' decision sets, then compare exactly.
- **Metric:** the share of (correct, correct) disagreements that vanish after canonicalisation, and the share of (correct, wrong) disagreements localised to a named decision.
- **Baseline:** the E4 winner.
- **Cost:** $0 compute. About $0.5 of Haiku if the attachment decision needs a judge.
- **Kill rule:** if canonical refits of identical decision sets differ by >1% because of a fitter-initialisation sensitivity, the shared module is not canonical. Fix the fitter or stop.
- **Falsifier:** if most correct-correct numeric disagreements come from *different but both acceptable* exclusion sets, decisions are not unique either, and materiality has to be defined at the decision level.

**E6. Order-independence audit of adjudication ($0).** Re-run all archived shadow/adjudication triples under single-linkage equivalence classes, and count the outcomes that change against the current check order. If more than 0 change, merge the class-based rule before PREREG.

---

## How the two blockers interact

- **Each contains the other.**
  - B7's comparator is itself a threshold decision ("within tolerance?"). It has B1's near-threshold failure: a relTol of 0.01 against a 13–20% legitimate spread.
  - Comparing records answers requires aligning entities, which is entity resolution, B1's own problem.
- **One mechanism covers both.** Every oracle-free safety net in the vision (shadows, N-version disagreement, adjudication, reject-if-worse, tier-down screens, reuse checks, replication "equal or better than the human") is a *comparator applied to outputs*.
  - B1 says the dangerous errors are a few silent decisions that whole-answer comparison catches only by luck of sampling.
  - B7 says whole-answer comparison is also *miscalibrated*: it disagrees on correct answers, which wastes the shadow budget that would have found B1 misses, and with loose tolerances it agrees on wrong ones.
- **The joint fix is to move verification from answers to decisions.** It has four parts:
  1. compiled code emits a decision ledger with margins and leverage, the cast-vote record;
  2. decisions are audited with probability ∝ leverage/margin under a declared risk limit, which is the owner's slider;
  3. answers are compared by decisions first, with numeric consequences canonicalised through shared, composed modules;
  4. a spec-first materiality contract gives the consumer's risk per decision and per leaf.
- **The vision side.** Westgard/ITF controls and PBRTQC monitors give a $0 continuous signal for *systematic* error, which neither sampling nor self-consistency can see.
  - The audited band decisions are exactly the Kev training targets.
  - The precedent register plus the margin distribution becomes the domain-of-validity record that makes reuse safe.
  - Kill condition for the whole cluster: if E1 shows the misses are not near any measurable boundary, and E4 shows no comparator separates correct from wrong, then oracle-free decision verification is not yet achievable in this stack. The honest fallback is a higher shadow rate with a strong, *different-model* adjudicator, priced in quota.

**Unverified items:** the AIAG edition and page; the JCGM 106 normative text; the RCV formula and the MUS 3.0 factor (from my own knowledge); the PBRTQC paper body (I saw only the abstract and podcast page); journal replay validity under perturbed inputs; and whether kinetics answers are persisted per arm (`trace.json`).

**Files read:**
- `/home/user/workflow-foundry/research/jit-20261008/{THESIS-JIT,SPEC,DEV-NOTES,CALIBRATION}.md`
- `/home/user/workflow-foundry/research/jit-20261008/nversion-records-dev.json`
- `/home/user/workflow-foundry/research/jit-20261008/tierdown/*.md`
- `/home/user/workflow-foundry/experiments/jit/{stream,prompts,flow-v2,check-traces}.mjs`
- `/home/user/workflow-foundry/.claude/worktrees/wf_eb243b06-14f-1/experiments/jit/compare.mjs`
- `/home/user/workflow-foundry/experiments/runs/jit/jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5/{results.jsonl,versions/v1-haiku55/solve.mjs}`
- `/home/user/workflow-foundry/experiments/runs/jit/jit-dev-kinetics-1/report.md`
- `/home/user/workflow-foundry/beds/kinetics/README.md`

## Agent result 3

# Teachers and labels: dossier on B3 (the weak-demonstrator trap) and B17 (human adjudication of unresolved cases)

*2026-10-09. Read-only pass, $0, no live model calls. All repo numbers are development evidence: dev seeds, K=1 streams, K_c=1 compiles. Nothing here supports a claim. Tags: **[M]** recomputed from `experiments/runs/jit/jit-dev-records-1/*/results.jsonl` and `versions/*/BUILD-NOTES.md`; **[D]** documented in the cited file; **[paper]**, **[practice/docs]**, **[inference]** as briefed. The prior sweep (journal `wf_d0427e6d-ceb`, "noisy demonstrations", "cascades") already covered Dawid–Skene, Snorkel, Weaver, PoLL, 2IWIL, weak-to-strong, Sheng's selective relabelling, DAgger, STaR, Mozannar–Sontag, Trust-or-Escalate, PPI, CoAnnotating, the cascade demonstrator, code as a labeller and field-local adjudication (P8). I cite those only by name and build on them.*

---

## B3. The weak-demonstrator trap

### 1. Mechanism

**One model supplies three signals.** In a `jit:<m>/<c>` arm the interpreter model `m` produces three things:
- the training labels: warmup traces and deopt fallbacks;
- the error signal: shadows;
- the tie-break: the adjudicator.

All three come from `stream.mjs:525-547`, which passes the same `model` to `interpret(..., 'shadow' | 'adjudicator', model)`. The Haiku→Haiku (H/H) arm shows what happens [M]:

- **The label pool is noisy.** 2 of the 7 interpreter deliveries were oracle-wrong: s202 at 0.973 (a warmup trace) and s205 at 0.981 (a deopt fallback). That is about 29% label noise, all of it near-misses that look right.
- **The compiled answers are worse.** Only 4 of 11 compiled outputs passed. The failing scores were 0.979, 0.985, 0.967, 0.773, 0.979, 0.711 and 0.704.
- **The error signal saw the problem but could not act on it.** Haiku shadows disagreed with the compiled answer on s208 and s214. Both adjudications ended `unresolved`, and line 547 delivered the wrong compiled answer both times.
- **The loop then had nothing to learn from.** Neither case became a regression. The v2 and v3 BUILD-NOTES both say: "No `regressions/` directory, so the regression gate is vacuous."

**The compiler does override labels, but with no confidence attached.** SPEC Addenda 4 makes the spec authoritative over traces, and the H/H compiler used that. The v1–v3 BUILD-NOTES overrode the agent on 16, 9 and 17 `amount_usd` signs ("Saldo changes sign in the master"). The Opus-arm and Sonnet-arm compilers also apply per-system sign flips [M, their BUILD-NOTES], so this override was probably *correct* [inference; dev-oracle check pending, E-B3-1]. The trap is subtler than "bad labels":
- Where the spec states a rule verbatim, the compiler can out-read its teacher. This is the weak-to-strong pattern, and S/H shows it: compiled 17/19 against the Sonnet agent's 13/24.
- Where the spec is silent or ambiguous, the compiler substitutes its own Haiku-grade ruling. v3 says: "Row 1751 links to two birth dates; the first link in row order wins (**my choice**)."
- Labels, overrides and invented rulings all reach the code with equal weight and no provenance.

**The noise comes in two kinds, and redundancy fixes only one** [M]:
- *Random noise.* The Haiku agent arm and the H/H interpreter ran the same seeds in different sessions and disagree on pass/fail at s201 (agent fail, interpreter pass) and s202 (agent pass, interpreter fail). This part changes from session to session, so voting or compiling averages it out.
- *Systematic noise.* The Sonnet agent passed 5/16 at d3 and 8/8 at d4, per-seed string `0100100010101000|11111111`. That is a difficulty-specific trap it falls into consistently [inference]. Voting cannot remove this part, and it gets worse under voting on hard items (Chen et al., prior sweep).

**Admission to the trace pool is confirmatory.** Line 529 adds a shadow trace to the pool *when it agrees* with the compiled answer. A common-mode error (D8, s214 unanimous-wrong) therefore gets reinforced, while disagreements that end unresolved leave nothing behind. The pool can only drift toward the lineage's own beliefs. This is a closed epistemic loop, and Shumailov's collapse argument applies to it directly.

### 2. Ideological root

The assumption is that **a teacher is one entity with one trust level, and a label is an answer.** Arms are named by teacher (`jit:haiku/haiku`). Labels are whole `answer.json` files. Trust is implicit and uniform. Addenda 4 patches this with "the spec is authoritative", which quietly assumes three things:
1. every decisive rule is written in the spec;
2. the compiler reads the spec better than the teacher does;
3. teacher errors are random.

All three fail in the evidence:
1. Kinetics fails on implicit exclusions (THESIS-JIT §6.5).
2. The compiler is the same model family as the teacher.
3. Sonnet's d3 failures and Haiku's conflict rule are systematic (D2).

Against the full vision this matters beyond Haiku:
- R-bench T1 grades fidelity to a human workflow "**its defects included**", and T3 grades "intent plus improvements" (`research/replicate-20261008/DESIGN.md` §0.1). The human author is also a weak demonstrator, with defects mixed into intent.
- Kev is meant to be "trained on judgments the stream actually needed" (§2.6). That makes Kev a student of whichever teacher produced them.

The vision therefore needs **trust indexed by (teacher × decision class)**, with labels decomposed into decisions that carry provenance. Per-arm trust fails as soon as a teacher is reliable on parsing but not on interpretation, and that is the common case.

### 3. Frontier (beyond the prior sweep)

- **GLAD** [paper]: Whitehill, Ruvolo, Wu, Bergsma & Movellan, *Whose Vote Should Count More*, NIPS 2009 (https://proceedings.neurips.cc/paper/2009/hash/f899139df5e1059396431415e770c6dd-Abstract.html). It infers labeller ability *and per-item difficulty* jointly and beats majority vote, robust to adversarial labellers. Crowd-Kit implements it [practice/docs] (https://toloka.ai/docs/crowd-kit/reference/crowdkit.aggregation.classification.glad.GLAD). Dawid–Skene lacks the difficulty term, and that is the term Foundry needs: errors concentrate on near-threshold merges (D1).
- **MACE** [paper]: Hovy, Berg-Kirkpatrick, Vaswani & Hovy, *Learning Whom to Trust with MACE*, NAACL 2013 (https://aclanthology.org/N13-1132). It estimates annotator competence and detects "spammers", annotators who answer by a default strategy. The analogue is a demonstrator that takes a shortcut, such as a default conflict order.
- **Second-order aggregation for LLMs** [paper]:
  - Prelec, Seung & McCoy, *A solution to the single-question crowd wisdom problem*, Nature 541:532–535, 2017 (https://gwern.net/doc/statistics/prediction/2017-prelec.pdf). The "surprisingly popular" answer beats majority when an informed minority exists: 21.3% fewer errors than majority, as reported in the search snippet.
  - Ai, Pan, Simchi-Levi, Tambe & Xu, *Beyond Majority Voting: LLM Aggregation by Leveraging Higher-Order Information*, ICML 2026 (https://arxiv.org/abs/2510.01499). Plain SP is *worse* than majority for correlated LLMs. Their Optimal Weight and Inverse-SP methods beat majority. I saw the abstract only. **Implication:** do not adopt naive SP. Correlation-aware weighting is the move.
- **Kappa paradox** [paper]: Feinstein & Cicchetti, *High agreement but low kappa I/II*, J Clin Epidemiol 43:543–558, 1990 (bibliographic record via https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/1471-2288-14-100). Raw agreement is inflated when one category dominates. They propose separate positive and negative agreement indexes. This explains D6/D11 exactly: leaf agreement was 0.966 while end-to-end was 5/8, because most leaves are trivially easy.
- **Krippendorff's α** [practice/docs, secondary]: α ≥ 0.800 is reliable, 0.667–0.800 supports only tentative conclusions, and the bar should rise with stakes (https://en.wikipedia.org/wiki/Krippendorff%27s_alpha). I could not verify the primary 2004 text.

### 4. Niche verticals

**(a) Crowdsourcing: gold questions plus item difficulty (GLAD).**
- *How the field solved it:* platforms seed known-answer "test questions" to measure each worker continuously, and GLAD routes by difficulty.
- *Transferable mechanism:* measure each labeller against items whose answer is settled by a *stronger, independent* process, and weight per item by difficulty.
- *Foundry adaptation:* every Opus-adjudicated decision becomes a **runtime gold item** with no oracle access. This uses the Opus agent's 24/24 dev record as justification (S4); it is not a runtime input. Haiku trace decisions are scored against those gold items per decision class. Difficulty is a feature computed by code, for example the edit distance of a candidate merge pair to the threshold. The compiler receives `decisions.json` with (class, difficulty, teacher, posterior). Hard and low-posterior decisions are marked "route to judge, do not fit".

**(b) Medical residency: entrustable professional activities (EPAs).**
- *How the field solved it:* ten Cate's EPAs (Med Educ 39:1176–1177, 2005) entrust a trainee *per activity*, not per person or year. Supervision levels run from "observe only" through "supervision on request" to "supervise others" (https://jgme.kglmeridian.com/view/journals/jgme/8/2/article-p261.xml). The level descriptors come from secondary sources [paper].
- *Mechanism:* trust is granular, earned from observed performance on that activity, and revocable.
- *Adaptation:* an **entrustment matrix** `trust[teacher][decisionClass] → level 1–5`, with classes such as parse/format, phone/date normalisation, same-entity merge, sign/date "law" and conflict order.
  - At level ≤ 2, a teacher's decisions in that class are *masked* in the compile bundle, and the class must come from a stronger source or a checked judge.
  - At level 4, its traces are fitted directly.
  - Promotion needs n ≥ 8 decisions in the class at α ≥ 0.8 against gold items.
  - Demotion is automatic on two gold disagreements in five, borrowing the ISO 2859 rule below.

  Haiku can then remain a cheap demonstrator for the 80% of decisions it gets right without poisoning the 20% it gets systematically wrong.

**(c) Appellate law: the law/fact split.**
- *How the field solved it:* appellate courts review questions of *law* de novo and findings of *fact* deferentially. US Supreme Court Rule 10 says the Court "rarely" grants review for "erroneous factual findings or the misapplication of a properly stated rule of law" (https://www.law.cornell.edu/rules/supct/rule_10) [practice/docs].
- *Mechanism:* separate the questions where the decider's errors are systematic and propagate (law) from those where they are local (facts), and spend the strongest decider only on the first.
- *Adaptation:* records already has this split. The per-task `rules` judge (sign flips, date orders, void markers, unreliable dates) is "law". D11 measured it as high-leverage: Haiku in place of Opus went 5/8 against 7/8 end to end. Row-level parsing and merging are "facts". A **ruled demonstrator** gives the Haiku interpreter the Opus `rules` output, which costs about $0.034 per call [D: `tierdown/live-rules-*.md`], as binding rulings. Haiku then demonstrates facts only. This is the change-the-problem option below.

**(d) Inter-rater reliability.**
- *How the field solved it:* chance-corrected agreement, reported separately for positive and negative decisions, over units where disagreement is possible.
- *Adaptation:* every promotion metric that compares a teacher, judge tier or compile with a reference is computed **on the contested subset**. The contested subset is the decisions where at least one source differs, or where difficulty exceeds τ. Report α with a bootstrap CI. Leaf agreement over all fields is retired as a promotion metric, because D6's 0.966 was the paradox in action.

### 5. Creative options

1. **(Changes the problem) Law/fact bifurcation.**
   - Stop asking a weak model to *demonstrate the task*. Ask it to demonstrate *facts under rulings*.
   - The strong model's per-task cost drops from a full trace (about $0.56 for Opus) to one ruling call (about $0.034).
   - The demonstrator's errors then become mostly random, the averageable kind.
2. **Noise-type triage from session instability.**
   - Run the Haiku interpreter twice per warmup task and decompose both answers into decisions.
   - Decisions that *flip* across sessions are random noise: vote, or send them to a judge.
   - Decisions that are *stable but contradict a gold ruling* are systematic: mask the class and demote the entrustment level.
   - This differs from the prior sweep's cascade demonstrator, which only escalates on disagreement. Here the flip pattern classifies the *type* of noise, and only the systematic type changes trust.
3. **Provenance-carrying labels.**
   - `answer.json` becomes `decisions.jsonl`: decision, value, source, class, difficulty, quote.
   - The compiler prompt forbids fitting masked classes.
   - BUILD-NOTES must list every "my choice" ruling. Such rulings are filed as open questions of law and go to B17's queue, not into code.
4. **Correlation-aware weighting rather than voting.**
   - Use Ai et al.-style optimal weights across {Haiku trace, compiled lineages, Opus ruling}, with Claude agents treated as one correlated block (Bach et al., prior sweep).
   - Keep the H/H arm as the negative control (D2).

### 6. Experiments (ranked)

**E-B3-1. Law/fact error ledger, override audit and entrustment table.** $0, about 3 hours.
- *Build:* `experiments/jit/audit/teacher-ledger.mjs`, analyst-side, using the dev oracle's per-field mismatches (D-notes precedent).
- *Inputs:* every trace in `jit-dev-records-1/*/traces`, the 24-seed agent arms (Haiku, Sonnet, Opus), and every BUILD-NOTES "disagreement" item.
- *Outputs:*
  - (i) Each wrong field classed as law-derived (sign, date order, void, conflict order) or fact (parse, merge, normalise).
  - (ii) Override accuracy: for each compiler override of a trace label, was the compiler right?
  - (iii) A trust matrix teacher × class with α on the contested subset.
  - (iv) A flip-versus-stable split, using pairs of seeds solved in two sessions (Haiku agent arm against H/H interpreter on 201–203, 205, 211, 212, 217).
- *Preregistered decision rules, written before reading:*
  - If ≥ 60% of the Haiku *stable* errors are law-class, E-B3-2 runs.
  - If compiler-override accuracy is ≥ 0.8, Addenda 4 stands for stated rules. If it is below 0.6, overrides need a quote plus an Opus ruling.
- *Kill rule:* fewer than 15 classifiable wrong fields means the result is reported as anecdote and not used.
- *Falsifier:* if Haiku errors are mostly *fact*-class and unstable, the law/fact split is the wrong lever, and plain self-consistency is enough.

**E-B3-2. Ruled demonstrator.** About $6–8, about 1.5 Opus-agent-equivalents of quota.
- *Build:* a `--rulings` flag in `interpret.mjs`. It calls the existing S/H v1 `rules` judge (Opus, schema reused, $0.034) and prepends its JSON to the Haiku agent prompt as binding rulings with quotes. The text is Claude-written, so D10 is not triggered.
- *Design:* dev seeds 201–216, K=2 sessions per seed, two arms:
  - plain Haiku interpreter (baseline, about $0.10 per task);
  - ruled Haiku.
- *Total:* about 64 runs, about $7.
- *Metric:* trace pass rate and wrong-field count on law-class fields (dev oracle, analyst-side).
- *Prereg:* a dev-diagnostic note in `DEV-NOTES` with the rule written first. Ruled must beat plain by ≥ 3 tasks of 32 *and* cut law-class wrong fields by ≥ 50%.
- *Kill rule:* stop after 16 runs if ruled is not ahead.
- *Falsifier:* no gain, which would mean Haiku's errors are not about reading the law but about applying it. In that case move to E-B3-3's masking without rulings.

**E-B3-3. Compile from ruled or masked traces.** About $8–12, conditional on E-B3-2.
- *Arms:* H/H plain against H/H with ruled traces plus `decisions.json` masking, K_c=2 compiles each, 3 warmup traces each, scored on compiled pass over the next 8 dev tasks (204–211). The S/H archived v1 is the reference.
- *Falsifier:* no improvement over plain H/H at K_c=2 means the trap lives in the compiler, not the labels. Then the next step is Opus fallback compile, not better teachers.
- *Prereg needed* before any held-out use: a PREREG-stream amendment, seeds ≥ 8000.

---

## B17. Human-in-the-loop adjudication for unresolved cases

### 1. Mechanism

**An unresolved case is a silent default.** `stream.mjs:547` writes `{outcome:'none'}`, logs `unresolved`, and delivers the compiled answer. No regression, queue, flag or later correction follows. Of 6 disagreements so far, 3 were unresolved (FRONTIER-GAPS S3):
- H/H s208 (0.773) and s214 (0.711): both wrong, both delivered;
- kinetics O/H: an exact-compare artefact (D7) in which the right answer was delivered.

**No human channel exists per case.** THESIS-JIT §6.9 names "the human … final adjudicator for unresolved cases, as one setting on the owner's slider", but nothing implements it. The heal design has an owner-review queue (`promote.mjs`, `Lineage`), but only for *version* promotions (`heal-20261008/DESIGN.md` §513, §563). Per-case disputes have no route.

**Unresolved cases are the hardest items by construction** (the GLAD difficulty tail). Every automated source is least reliable exactly there, so a human is most valuable there. That creates three problems:
1. *Selection bias.* Human labels taken only on disputes cannot estimate the stream's silent-miss rate. S1 found 14 of 17 wrong compiled outputs were silent, and no dispute was ever raised on them. Promotion evidence built from dispute-only human labels is therefore biased.
2. *Latency.* The stream is sequential (SPEC §6.2 step 5). A blocking human wait stalls the arm.
3. *Waste.* One ruling fixes one case. The v3 "my choice" linking rule shows that the real unresolved object is often a **question** that recurs across tasks.

**Human time is a separate currency.** It does not consume the account quota, which is the binding throughput cap (§6.6). It is also the only source with **no common mode** with the Claude family [inference].

### 2. Ideological root

The assumption is **"verification is automatable; the human is an exception handler for individual cases."** For arbitrary recurring work, and for replicating a real user's workflow, *intent* is owned by the user. R-bench T2 grades against "the author's intent", and no model can settle intent. That makes the human the authority on questions of law, not a fallback for hard facts. The assumption holds only if:
- (i) unresolved cases are rare and unrelated to one another;
- (ii) automated adjudicators are calibrated on them;
- (iii) a ruling's value is confined to its case.

(i) and (iii) are contradicted: rulings recur, as with sign rules, linking rules and date cutoffs. (ii) is contradicted by S4: Sonnet's reference is inverted at 8/9 and Haiku's does not resolve. The vision needs the human as a **source of precedent**, budgeted in minutes, asynchronous, and audited for its own reliability.

### 3. Frontier

- **Learning to defer to *multiple* experts** [paper]: Verma, Barrejón & Nalisnick, AISTATS 2023 (https://proceedings.mlr.press/v206/verma23a.html). It gives consistent surrogates and a conformal method for choosing *which subset* of experts to query. Read for Foundry, the experts are {compiled, Opus field-local, owner}.
- **Active testing** [paper]: Kossen, Farquhar, Gal & Rainforth, ICML 2021 (https://proceedings.mlr.press/v139/kossen21a.html). Choosing test points to label actively introduces bias, which they correct with importance weights. That is the fix for dispute-only labelling.
- **Active statistical inference** [paper]: Zrnic & Candès, ICML 2024 (https://proceedings.mlr.press/v235/zrnic24a.html). It labels where the model is uncertain and relies on predictions elsewhere, with valid confidence intervals. PPI (Angelopoulos et al., https://arxiv.org/abs/2301.09633) is the non-adaptive base case, already in the prior sweep.
- **Automation bias** [paper]: Goddard, Roudsari & Wyatt, *Automation bias: a systematic review*, JAMIA 19:121–127, 2012 (https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751). Reviewers over-accept system output. A human shown "the system's answer" is not an independent adjudicator.
- **Practice** [practice/docs]: LangSmith annotation queues (https://docs.langchain.com/langsmith/annotation-queues) offer single-run and *pairwise* queues, rubrics, and N reviewers per item with reservations. These are the UI primitives a review queue needs. The prior sweep covered durable awaitables (Restate, OpenAI Agents SDK).

### 4. Niche verticals

**(a) Appellate courts: error correction, certiorari and precedent.**
- *How the field solved it:* Shavell, *The Appeals Process as a Means of Error Correction*, J Legal Stud 24:379, 1995 (https://chicagounbound.uchicago.edu/jls/vol24/iss2/4) [paper]. Appeals harness the losing party's *private information* about error, and the higher court sits on only a subset of cases. That is cheaper than raising trial quality everywhere. Rule 10(a) grants review for a **conflict between circuits** "on the same important matter".
- *Transferable mechanism:*
  - standing: the party with information files;
  - discretionary review, triggered by splits on important questions;
  - **binding precedent**: one ruling decides a class of cases.
- *Adaptation, a certiorari queue:*
  - **Standing:** the compiled solver's own `flow.flag` and near-miss detectors (D1) file the petition.
  - **Grant criteria:** a "circuit split" (two independent sources still disagree after Opus field-local adjudication, e.g. compiled lineages, D8, or code against agent) on a *high-leverage* question (D11 leverage = downstream leaves affected).
  - **The ruling is written as law:** a typed rulebook entry (question, scope guard, quote, answer). It enters the compile bundle as a spec addendum, a regression case and a guard predicate. Later compiles must *follow* it or *distinguish* it, meaning the guard refuses outside its scope (D9).

**(b) Breast screening: from double reading to AI-triaged reading.**
- *How the field solved it:* the MASAI trial (Lång et al., Lancet Oncology 2023; https://ascopost.com/news/august-2023/ai-supported-screen-reading-vs-standard-double-reading-in-mammography-screening-for-breast-cancer) [paper, via summaries]. AI risk scores sent low-risk exams to single reading and high-risk exams to double reading. Detection was 6.1 against 5.1 per 1000, a non-inferior safety result, with about 44% fewer screen readings (46,345 against 83,231).
- *Mechanism:* spend the second expert in proportion to risk, not uniformly, and keep a pre-specified safety floor.
- *Adaptation:* the human reads only the top-risk slice of unresolved disputes. Risk = leverage × (1 − adjudicator posterior). The safety floor is a preregistered minimum human-audit rate, below.

**(c) Acceptance sampling: ISO 2859-1 switching rules** [practice/docs, secondary; verify against the standard] (https://www.sqconline.com/switching-rules-iso-2859-1).
- *How the field solved it:* normal → tightened inspection when 2 of 5 consecutive lots are rejected; tightened → normal after 5 consecutive acceptances; discontinue after 5 rejections on tightened; reduced inspection only after a sustained run.
- *Mechanism:* a hysteresis state machine for inspection intensity that bounds inspector load and reacts quickly to quality loss.
- *Adaptation:* a per-lineage human-audit state machine:
  - **reduced:** 2% random audit;
  - **normal:** 5%;
  - **tightened:** every unresolved case plus 15%;
  - **discontinued:** route to the interpreter and stop delivering compiled output.

  The two-in-five and five-consecutive rules come from the standard and need no tuning. This is the owner's "slider" expressed as a legible policy.

**(d) Residency supervision: "supervision available on request" and co-signature.** EPA level 4 means the trainee acts and the supervisor is reachable rather than present.
- *Adaptation:* asynchronous provisional delivery. The compiled answer is delivered marked `unattested`. The owner's queue drains in batches. A reversal produces a correction event, a regression case and a precedent.
- *Metric:* the **exposure window**, the time a wrong answer stays live.

**(e) Inter-rater reliability for the human.** Measure owner–Opus α on contested items before letting Opus stand in for the owner on a class. This entrusts the *adjudicator* by EPA level, the same way B3 entrusts teachers.

### 5. Creative options

1. **(Changes the problem) Rule on questions, not cases: the precedent compiler.**
   - The human never adjudicates `answer.json`. They answer typed questions mined from disputes and from "my choice" lines in BUILD-NOTES.
   - Each answer is a reusable ruling with a scope guard.
   - Value per human minute is multiplied by recurrence.
2. **Intent pre-registration.**
   - After warmup, cluster the open questions (law-class disagreements, invented rulings).
   - Ask the owner 3–5 of them *before* compiling. This is spec-first (§6.5) with the human as source of law.
3. **Blind field-local review cards.**
   - Show a pairwise card (LangSmith PAQ-style) with two values, authorship hidden, in random order.
   - Require a quoted sentence, as P8 does for Opus.
   - Track seconds per ruling. This counters automation bias.
4. **Split the human budget.** Use 70% for decisions (risk-ranked disputes) and 30% for audit (random draws with logged propensities). Active-testing and PPI estimators make the audit slice valid evidence for promotion. Dispute-only labels never count toward promotion.

### 6. Experiments (ranked)

**E-B17-1. Certiorari and precedent replay.** $0, about 4 hours.
- *Build:* `experiments/jit/audit/cert-sim.mjs`. It replays `events.jsonl` from all records and kinetics arms plus `nversion-records-dev.json`.
- *Simulated human:* the dev oracle, analyst-side only and never fed to any system component, with an injected human error rate e_h ∈ {0, 0.1, 0.2}.
- *Policies, at a budget B ∈ {1, 2, 4} rulings per 24-task stream:*
  - (A) the baseline, line 547 (no human);
  - (B) human on every unresolved case, case-only;
  - (C) cert queue (split + leverage), case-only;
  - (D) C plus precedent propagation: a ruling is applied to every later task with the same decision class and value pattern, through the decision extractors from the prior sweep's E-DS.
- *Metrics:* wrong deliveries prevented per ruling; precedent multiplier (cases fixed per ruling); new wrong deliveries caused by over-broad precedent.
- *Rule written before reading:* D must beat B by ≥ 2 prevented misses per stream at B=2, with harm ≤ 1, or precedent propagation is shelved.
- *Falsifier:* rulings do not recur (multiplier ≈ 1), meaning disputes are idiosyncratic facts and not law.

**E-B17-2. Owner calibration session.** $0 in models, about 30 minutes of owner time, owner sign-off needed. The bed text is Claude-written, so D10 is not triggered.
- *Cards:* 16 field-local cards from archived dev disputes and known misses:
  - 8 blind;
  - 8 showing "system answer: X";
  - each type balanced over correct and wrong compiled answers.
- *Metrics:*
  - seconds per ruling;
  - accuracy against the dev oracle;
  - the automation-bias gap (labelled-card accuracy on wrong-compiled items against blind);
  - owner–Opus α, against the archived P8 verdicts where available.
- *Prereg:* the card set is frozen and hashed before the session.
- *Kill rule:* if median time per card is over 3 minutes, the card format is wrong; redesign before scaling.
- *Falsifier:* owner accuracy on blind cards ≤ Opus field-local accuracy. Then the human's role is intent rulings only (option 2), not fact adjudication.

**E-B17-3. Unbiased silent-miss estimation from a split budget.** $0, about 3 hours.
- *Data:* on the archived records streams, the Opus agent's per-seed answers (24/24 on dev) stand in for human labels.
- *Comparison:* (i) dispute-only labelling against (ii) a 70/30 split with a propensity-logged random audit and the Kossen/PPI estimator, using 1000 resampled label budgets of 4 per stream.
- *Metrics:* bias and 90% CI coverage of the silent-miss-rate estimate against the dev-oracle truth (17/56).
- *Rule written before reading:* adopt the split if coverage is ≥ 85% and dispute-only is biased by more than 2×.
- *Falsifier:* at budget 4, CI width exceeds 0.3. Then human audit cannot certify promotion at this scale, and certification must rest on Opus audits with owner spot checks.

---

## Cluster: how B3 and B17 interact

They are one problem, **teacher reliability**, at two price points.
- B3 is what happens when the cheapest teacher grades its own pupil. It *produces* B17's cases: H/H's two unresolved wrong deliveries are B3's failure showing up as B17's.
- B17's resolutions are the only labels that can break B3's closed loop, because only an independent source can add information that the confirmatory pool admission (line 529) cannot.

**The shared object is the ruling.** A question of law, settled by Opus (cheap, per task) or by the owner (scarce, per class), should flow into:
- the demonstrator's prompt (E-B3-2);
- the compile bundle (masked classes, spec addenda);
- the guard set (scope of precedent);
- the gold items that score teachers (entrustment matrix).

That suggests one shared module, `trust.mjs`: a ledger of teacher × decision class → {level, α, n, rulings}. It would drive which labels the compiler may fit, the shadow and audit rates (the ISO-style state machine), who adjudicates (multi-expert deferral) and what reaches the owner (the cert queue).

**The main hazard is selection.** Humans and Opus see only hard, disputed items, so trust tables calibrated on them overstate error on easy items, and silent misses stay invisible. The audit slice with logged propensities therefore has to exist before any trust level is used as promotion evidence.

**Order:** E-B3-1, E-B17-1 and E-B17-3 cost $0 and settle whether "law" is where systematic errors live and whether rulings recur. E-B3-2 and E-B17-2 then test the two cheapest independent teachers: an Opus ruling at about $0.034, and an owner card at about one minute. No held-out claim follows without a PREREG-stream amendment, K ≥ 2 and seeds ≥ 8000.

## Sources (opened or seen in search this session)
- [paper] Whitehill et al. 2009, GLAD — https://proceedings.neurips.cc/paper/2009/hash/f899139df5e1059396431415e770c6dd-Abstract.html; Crowd-Kit GLAD [practice/docs] — https://toloka.ai/docs/crowd-kit/reference/crowdkit.aggregation.classification.glad.GLAD
- [paper] Hovy et al. 2013, MACE — https://aclanthology.org/N13-1132
- [paper] Prelec, Seung & McCoy 2017 — https://gwern.net/doc/statistics/prediction/2017-prelec.pdf
- [paper] Ai et al. 2026, Beyond Majority Voting — https://arxiv.org/abs/2510.01499 (abstract only)
- [paper] Feinstein & Cicchetti 1990 (bibliographic, secondary) — https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/1471-2288-14-100
- [practice/docs, secondary] Krippendorff's α thresholds — https://en.wikipedia.org/wiki/Krippendorff%27s_alpha (primary 2004 text unverified)
- [paper] ten Cate 2005, Med Educ 39:1176 (catalogue records); entrustment levels — https://jgme.kglmeridian.com/view/journals/jgme/8/2/article-p261.xml
- [paper] Shavell 1995 — https://chicagounbound.uchicago.edu/jls/vol24/iss2/4
- [practice/docs] US Supreme Court Rule 10 — https://www.law.cornell.edu/rules/supct/rule_10
- [paper] Lång et al. 2023, MASAI (via summaries) — https://ascopost.com/news/august-2023/ai-supported-screen-reading-vs-standard-double-reading-in-mammography-screening-for-breast-cancer
- [practice/docs, secondary] ISO 2859-1 switching rules — https://www.sqconline.com/switching-rules-iso-2859-1 (verify against the standard)
- [paper] Verma, Barrejón & Nalisnick 2023 — https://proceedings.mlr.press/v206/verma23a.html
- [paper] Kossen et al. 2021, Active Testing — https://proceedings.mlr.press/v139/kossen21a.html
- [paper] Zrnic & Candès 2024 — https://proceedings.mlr.press/v235/zrnic24a.html
- [paper] Angelopoulos et al. 2023, PPI — https://arxiv.org/abs/2301.09633
- [paper] Goddard, Roudsari & Wyatt 2012 — https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751
- [practice/docs] LangSmith annotation queues — https://docs.langchain.com/langsmith/annotation-queues

Repo evidence: `/home/user/workflow-foundry/experiments/jit/stream.mjs` (lines 517–547), `/home/user/workflow-foundry/experiments/runs/jit/jit-dev-records-1/jit-claude-haiku-5-5--claude-haiku-5-5/{results.jsonl,versions/v1..v3-haiku55/BUILD-NOTES.md}`, `/home/user/workflow-foundry/research/jit-20261008/{DEV-NOTES.md,THESIS-JIT.md,SPEC.md,tierdown/live-rules-*.md,nversion-records-dev.json}`, `/home/user/workflow-foundry/research/replicate-20261008/DESIGN.md`, `/home/user/workflow-foundry/research/heal-20261008/DESIGN.md`.

## Agent result 4

# Domain-of-validity cluster: B4 (a heal widened the input domain, D9) and B11 (applicability gating for reuse)

*Dossier dated 2026-10-09. Read-only pass; no live model calls. Every repo number is development evidence (dev split, K=1). Tags: **[M]** measured this session or recomputed from a cited file. **[D]** documented in the repo. **[paper]** and **[practice/docs]** are external sources whose URL I opened or saw in search. **[inference]** is my reasoning. The numbering follows the computed task. The sweep inventory's "B4" is a different blocker (interpreter amnesia) and is not covered here.*

## 0. New $0 measurements behind this dossier

- **M1. Offline profile replay.** I ran `node experiments/jit/eval-profiles.mjs experiments/runs/jit/jit-dev-records-1 --nversion research/jit-20261008/nversion-records-dev.json` (dev only, offline, nothing written). [M]
  - **Every detection comes from size features.** With all features, a frozen warmup-3 profile flags d4 8/8 and d3 0/13. The reasons are always `line-count` and `string-length` on `inputs.export`. Without the size features, **0 of 21 tasks are novel in every arm and every policy.**
  - **D9 replay:** opusV2's own version profile would have refused **6 of its 9 wrong answers**, at the cost of 2 of its 10 right answers. Without size features it refuses 0 of 9.
  - **Static C0 solver:** a frozen profile catches 6 of 7 silent misses with 2 false alarms out of 14 passes, again by size alone.
  - **In-stream `version` policy:** it catches **0 of 6** silent misses in O/H and 0 of 2 in S/H.
  - `experiments/jit/profile.mjs` is being edited by another lane right now. `PARAMS.numMargin` at line 68 changed while I was reading, so these numbers belong to the version on disk at run time.
- **M2. The router's reuse key cannot see difficulty.** `shapeKey` (`experiments/jit/router.mjs:16`) gives **one key** for records dev seeds 201–204 at d3 and 217–220 at d4 (8 tasks, 1 key) [M, scratch script]. Shape-keyed reuse would therefore send d4 tasks to a solver proven only on d3. That is the static C0 solver's path: 14/16 at d3, then 2/8 at d4, silently (D5).
- **M3. One example widens the profile too far.** In the O/H records arm, v2's first d4 task (idx 16) was adjudicated wrong and became a regression. v3 was compiled with that single d4 case. Its version profile then marks only 1 of the 8 d4 tasks as novel, yet v3 silently missed 2 of its 7 d4 deliveries (idx 17 and 22) [M, `jit-claude-opus-5-5--claude-haiku-5-5/{events,results}.jsonl`]. One confirmed example widened the fence over the whole d4 region.
- **M4. The real drift is semantic, and paraphrase hides it.** Per `beds/records/README.md` (lines 91–110 and 225–232) [D], d4 adds:
  - a third status value;
  - an ATLAS date-order swap after a dated vendor move, plus an irrelevant second date;
  - more namesake pairs and d-m swap traps.

  These are new rules stated in prose. The profile's prompt-sentence feature uses a Good-Turing threshold. The notes are drawn from up to 8 paraphrases per meaning, so that path churns heavily, the threshold sits near its loose maximum, and a new rule looks like one more paraphrase [inference from `profile.mjs` header + README].

---

## B4. A heal widened the input domain and turned refusals into silent failures (D9)

### 1. Mechanism

The steps, in order:

1. **An over-strict check deopts in-domain tasks.** The O/H v1 judge `vendex-entries` failed its own check on every tier (D3). It deopted d3 tasks at idx 4 and 5, and the Opus interpreter re-solved both correctly.
2. **The recompile prompt orders the widening.** `experiments/jit/prompts.mjs:96-101` says: *"the new cases must run without a deopt or crash … When a guard stopped a shape that the new traces show is legitimate, widen that guard."* Acceptance requires "clean = no crash, deopt or timeout on any case" (`stream.mjs:151`). Every pressure on the compiler points toward answering. Nothing in the objective rewards a correct refusal.
3. **Reject-if-worse only checks agreement on old cases.** `rejectReason` (`stream.mjs:162-168`) compares exact agreement on the old labelled cases. Inputs the old version refused are not labelled cases unless the interpreter happened to solve them, and inputs no trace contains are not checked at all. A version that answers more cannot score worse under this rule.
4. **The over-strict check was also the d4 detector.** v1's check was doing two jobs: judging check quality, and fencing the domain without anyone having designed it to. Loosening it removed a fence nobody had represented, so nothing could preserve it.
   - **Outcome in the N-version probe** (`nversion-records-dev.json`): opusV1 refused 15 of 24 tasks; opusV2 answered 24 of 24, with 15 correct.
   - On the d4 drift tasks, opusV2 was wrong on 5 of 7 (D9).
   - In the stream, the O/H arm finished 18/24, below the Sonnet arm's 22/24 (D12).
5. **The two subsystems follow opposite rules.** The heal design says "With no oracle, a heal may only add guards, never relax them" (`research/heal-20261008/DESIGN.md:74`; also §587). The JIT recompile prompt tells the compiler to widen. The sweep's F16 found that recompile has none of heal's code-enforced anti-gaming gates.
6. **The runtime profile widens too readily.** One interpreter-confirmed example stretches the range features by a margin proportional to the observed span (M3). Domain growth follows the number of examples, not the evidence that the solver is correct there.
7. **Adoption ignores acceptance.** S/H v2 was adopted with `accepted: false` (exact 0.143, Opus fallback; `events.jsonl` idx 18), because rejection only fires on "not clean" or "fewer exact" [M]. A version can take over the whole domain without passing its own acceptance. It was lucky here: 6/6 on d4.

### 2. Ideological root

**The assumption:** *a deopt is a defect of the compiled code, and the trace pool is a representative sample of the domain, so making every pool case answerable generalises.*

**The ledger behind it:**
- The system prices refusals: a deopt costs about 130× a compiled run under an Opus interpreter (sweep F9), and "quota is the currency" (THESIS-JIT §6.6).
- It does not price silent misses, because nobody inside the system ever observes them.
- So the optimisation is Goodharted toward answering. A refusal is visible and charged; a silent miss is invisible and free [inference].

**For the assumption to hold, all of these would need to be true:**
- (a) the stream is exchangeable, which D5 and the d4 segment break by design;
- (b) correctness on the pool implies correctness on the region between pool points, which D1's near-threshold under-merges contradict even inside d3;
- (c) refusal capacity is represented explicitly somewhere the compiler cannot edit. Today the guards are the only record of the domain, and they live in the code the compiler rewrites.

**Against the full vision:**
- Durability, reuse by other programs and promotion "governed by executable contracts" all need a version's domain to be explicit, versioned, auditable and **monotone unless evidence says otherwise**. Heal-by-widening makes the domain implicit and non-monotone.
- Owner sliders and boards cannot reason about a boundary that exists only as side effects of `flow.judge` checks.
- The "three roles" reframing (§6.3) implies a fourth artifact that is neither demonstrator, adjudicator nor executor: **the fence**.

### 3. Frontier

- **Behavioural subtyping.** A subtype may weaken a precondition only if the postcondition still holds on the enlarged domain. A recompile is a subtype of its predecessor. Widening the domain is legitimate only with postcondition evidence on the added region.
  - Liskov & Wing, "A behavioral notion of subtyping", TOPLAS 1994. I could not open the paper itself and saw the rule via https://en.wikipedia.org/wiki/Behavioral_subtyping [paper, secondary]. D9 is a precondition weakened with no evidence for the postcondition.
- **Learn preconditions from where correctness was observed, not from where inputs were seen.**
  - Padhi, Sharma, Millstein, "Data-Driven Precondition Inference with Learned Features" (PIE), PLDI 2016, https://pldi16.sigplan.org/details/pldi-2016-papers/45/Data-Driven-Precondition-Inference-with-Learned-Features [paper].
  - PIE learns preconditions that separate passing from failing tests and adds features on demand when the current feature set cannot separate them. That is the missing distinction: `profile.mjs` learns the *support of the observed inputs*, not a *precondition sufficient for correctness*. D1's in-domain misses show the gap.
- **Inferred schemas whose evolution is a reviewed act.**
  - "Data Validation for Machine Learning" (Breck, Polyzotis, Roy, Whang, Zinkevich; SysML 2019), https://research.google/pubs/data-validation-for-machine-learning/ [paper/practice].
  - TFX infers a schema from data and flags anomalies. Schema changes for "natural evolution", such as new domain values, are *suggested* to users, not applied automatically.
  - The OSS is TensorFlow Data Validation. Deequ is the AWS analogue (https://cdn.amazon.science/9f/b6/15099d504c54bec20ec6a6c2eb3d/deequ-data-quality-validation-for-machine-learning-pipelines.pdf) [practice/docs].
- **Coverage under shift.**
  - Gibbs & Candès, "Adaptive Conformal Inference Under Distribution Shift", NeurIPS 2021, https://arxiv.org/abs/2106.00170 [paper]. It treats shift as a one-parameter online learning problem and keeps long-run coverage without exchangeability. This is the right shape for a widening rule that tracks the shadow-measured miss rate after a widening.
  - Selective prediction (Geifman & El-Yaniv) is already in the sweep and is not repeated here.

### 4. Niche verticals

1. **Statistical process control: limits are never recomputed to absorb out-of-control points.**
   - Phase I sets the limits from historical data. Phase II monitors against them (NIST/SEMATECH e-Handbook, https://itl.nist.gov/div898/handbook/pmc/section5/pmc5432.htm) [practice/docs].
   - Limits are revised only after investigating out-of-control points for an *assignable cause*, removing those points and recomputing (Montgomery's procedure, seen via lecture material at https://eclass.aueb.gr/modules/document/file.php/STAT247/Part-III-Control%20charts%20for%20variables.pdf) [practice/docs, secondary].
   - **Transferable mechanism:** a signal outside the limits is never a reason to widen them. Re-baselining is a deliberate Phase I event with a stated cause and a fresh baseline sample.
   - **Foundry adaptation:**
     - A deopt never widens the domain by itself.
     - Widening is a *re-baseline event*: a named cause (for example "d4 adds an ATLAS date-swap rule"), at least n confirmed tasks in the new region (n from item 2's leverage rule), and a fresh Phase I window in which the new region is shadowed at p=1.
     - Before that, the new region runs on the interpreter.
2. **FDA Predetermined Change Control Plans (AI-enabled device software functions, final guidance Dec 2024).**
   - Manufacturers pre-specify which modifications they will make and *how they will be implemented and validated*, including whether each is automatic or manual. Changes outside the plan need a new authorisation. (Ropes & Gray summary: https://ropesgray.com/en/insights/alerts/2024/12/fda-finalizes-guidance-on-predetermined-change-control-plans-for-ai-enabled-device; Foley summary: https://www.foley.com/insights/publications/2025/01/fda-final-guidance-ai-device-software-predetermined-change-control-plan/) [practice/docs, secondary].
   - Whether a change to *intended use* can sit inside a PCCP is **unverified**: the summaries I saw do not say.
   - **Foundry adaptation:** a per-workflow **heal change-control plan**, checked by code rather than by prompt:
     - automatic: tighten a check, add a guard, k-sample agreement;
     - adjudicated: loosen a check, widen a guard, change a judge tier on a high-leverage judgment (D11);
     - forbidden: delete a guard, special-case a literal.

     The recompile diff is classified against the plan, so the JIT inherits the heal rule at `DESIGN.md:74` and the contradiction disappears.
3. **QSAR applicability domain: the boundary width depends on how much evidence you have.**
   - OECD validation principle 3 requires "a defined domain of applicability" (agreed November 2004), defined over both structure (x) and response (y) space (https://www2.oecd.org/chemicalsafety/risk-assessment/37849783.pdf) [practice/docs].
   - The leverage warning threshold is h* = 3p/n (p = model parameters, n = training compounds); predictions beyond it are extrapolations (gaQSAR manual, https://cran.r-universe.dev/gaQSAR/doc/manual.html; Enalos APD, https://enalosplus.novamechanics.com/index.php/enalos-nodes/applicability-domain-apd-based-euclidean-distances) [practice/docs].
   - **Transferable mechanism:**
     - The domain tightens as the feature space grows and loosens only as the training set grows.
     - A single new compound adds coverage only near itself. It does not stretch a bounding box.
   - **Foundry adaptation:**
     - Replace the span-proportional margins with evidence-scaled, density-style coverage: an input is in the domain if its k nearest confirmed tasks in feature space are within a radius r(n) that shrinks as 1/√n.
     - Count only tasks where the *version* was confirmed (shadow agreement or recompile pool with exact agreement), never mere interpreter handling. M3 is exactly the bounding-box failure.
4. **SAE J3016 ODD and the minimal-risk fallback.**
   - The ODD is the set of conditions a feature is designed to function under. On ODD exit or a relevant failure, a DDT fallback brings the vehicle to a minimal risk condition.
   - Level 4 requires the system to reach that condition automatically in *every* case that demands it within its ODD. Achieving it only sometimes does not count. (CCAM taxonomy: https://taxonomy.connectedautomateddriving.eu/dynamic-driving-task-fallback; arXiv 2605.29818) [practice/docs, secondary].
   - ISO 34503:2023 standardises the ODD taxonomy and explicitly does **not** cover monitoring of ODD attributes (https://www.ccam.eu/new-iso-standard-regarding-specification-for-operational-design-domain/) [practice/docs].
   - **Transferable mechanism:** fallback is a *certified capability with its own test obligations*, separate from driving performance.
   - **Foundry adaptation:**
     - A deopt is the workflow's minimal-risk manoeuvre.
     - Every version must pass a **refusal suite** (all inputs any ancestor refused, plus synthesised out-of-domain probes) as an acceptance criterion separate from check-traces.
     - The ISO exclusion is a warning: describing the domain (profile) is not the same as monitoring it, which needs a runtime check the solver cannot edit.

### 5. Creative options

- **(a) Patch: monotone refusal suite (v2.2, task #41).**
  - Any input that version k refused must, under k+1, still deopt or match an *independent* adjudication. A same-model shadow is not enough: D2 and the sweep's correlated-error results apply.
  - Change the prompt at `prompts.mjs:99-100` from "widen" to "split": handle the new shape in a new guarded branch and keep the old guard for every other unseen shape.
- **(b) Move the fence out of the solver.**
  - The domain becomes its own versioned artifact: profile, concept set (option d), refusal suite and evidence record.
  - The runtime owns and enforces it before `solve.mjs` runs. The compiler can propose a widening but cannot apply one.
  - Promotion needs two independent keys: shadow evidence in the new region and a change-control classification. This is the AML-list model (B11 §4.1), applied over time.
- **(c) Change the problem: heals add siblings, they do not replace.**
  - A recompile triggered by deopts produces a *new solver for the region its predecessor refused*. The predecessor keeps its proven region.
  - Dispatch is by domain membership, like separate stacks for separate ODDs. Widening becomes union of guarded components, so a widened guard can never take over the old region silently.
  - This fits THESIS-JIT §6.1 ("a workflow is a portfolio"). It also kills D12's lineage variance at the source: a bad heal can only damage its own new region.
- **(d) Change the problem: define the domain by concepts, not by surface.**
  - Concepts are the decisions the spec makes: date-order conventions, status meanings, which system is re-stamped.
  - A cheap, checked `flow.judge` extracts a concept vector from the notes per task (enum per decision, quote-checked). Novelty is a concept the version has never been confirmed on.
  - M4 says this is the only route to d4's real shift. Size features catch it only by accident, because d4 has more rows. That correlation does not hold when another program sends small tasks with new rules.
- **(e) Price silent misses inside the system.**
  - Charge every compiled answer outside the confirmed domain its expected silent-miss cost: shadow-estimated error rate × the cost of delivering a wrong answer, which the owner's slider sets.
  - Deopt versus answer then becomes a priced decision instead of a cost the system cannot see.

### 6. Experiments, ranked

**X-B4-1. Counterfactual refusal-preservation on archived lineages. $0, about 3 hours.**
- **Build:** `experiments/jit/refusal-replay.mjs`, reading `nversion-records-dev.json` and both dev streams' `versions/*/compile.json`.
  - For every adopted recompile, take the inputs the predecessor refused, then apply the rule (still deopts, or agrees with the archived interpreter or adjudicated answer).
  - Counterfactual stream: when a version is rejected, the predecessor stays, its refusals go to the interpreter, and the archived interpreter outcome and cost are used.
- **Metrics:**
  - counterfactual pass/24 and $/success per arm;
  - refusal-flip precision: of the inputs the new version newly answers, the share it answers correctly (experimenter's oracle view).
- **Baseline:** the actual arms (O/H 18/24 at $7.53; S/H 22/24 at $8.99).
- **Prereg:** none, because this is dev diagnosis. State that before running.
- **Kill:** the rule rejects every recompile in both families. Then it is too strict as written, and option (c) is required.
- **Falsified if:** counterfactual O/H gains fewer than 3 passes. Gaps under 3 points are noise, so domain preservation would not be the lever D12 claims.
- Note: archived interpreter answers exist only for tasks the stream actually interpreted. Where they are missing, mark the task "unknown" rather than imputing.

**X-B4-2. Profile ablation: evidence-scaled density and concept features versus the current profile. Under $1, about a day.**
- **Build:**
  - add `checkProfile` options `margin: 'span' | 'leverage'` and a kNN mode in a copy (`experiments/jit/profile-ad.mjs`), so as not to collide with the lane editing `profile.mjs`;
  - add a concept extractor as a Haiku `flow.judge` over the notes. Only this costs money: about 48 tasks × about $0.003.
- **Metrics:**
  - silent-miss recall and false-alarm rate on compiled passes;
  - re-routed cost, priced at the arm's interpreter rate.
- **Baseline:** current `version` policy (0/6 recall in O/H) and `frozen` (2/6 at 42% false alarms).
- **Prereg:** freeze thresholds on the records dev stream, then score unchanged on the kinetics dev stream. Records-only success counts for nothing.
- **Kill:** with size features ablated, no variant beats 1/3 recall at 20% false alarms on kinetics.
- **Falsified if:** concept features add nothing over size on kinetics d5 drift. Then semantic drift is not detectable from the notes at this cost, and bridging shadows (B11) must carry the load.

**X-B4-3. Live K=2 dev streams, v2.2 versus v2.1 on O/H records. About $15–30, moderate Opus quota. Run off-peak.**
- Freeze the config first.
- Seed an over-strict check deliberately so the D3→D9 chain reproduces. The intervention is the refusal suite plus the change-control classifier.
- **Kill:** v2.2 is more than 3 points below v2.1 on d3 pass, which would mean it over-refuses.
- **Falsified if:** d4 silent misses do not fall.
- This uses the dev split only. Held-out evidence waits for PREREG-stream, whose test seeds must first be moved off Kev's 7000–7039 reserve (sweep F13).

---

## B11. Reuse of a proven workflow by another program: applicability gating

### 1. Mechanism

1. **Reuse does not exist yet.** Task #43 and Phase 5 are pending, and the vision's proposed gate is the input profile (THESIS-JIT §6.7). The only reuse key in code is `shapeKey` (`router.mjs:16`): a hash of the output schema, the input skeleton and the masked prompt. M2 shows d3 and d4 share it, so shape-keyed reuse reproduces D5's silent collapse (2/8).
2. **The repo has already been burned by wrong applicability.** A skills arm scored **0/21 with 21 false successes** against a baseline of 7/21 on a wrong-type follow-on (`docs/RESEARCH.md:98`). THESIS lists false reuse as a top risk (`docs/THESIS.md:223-225`) and names "does this procedure apply?" as the repo's sharpest judgment failure (§7).
3. **The proposed gate measures the wrong thing on two axes.**
   - It sees **covariate** novelty mostly through size (M1, no-size 0/21). It misses **concept** novelty (M4).
   - "In domain" is not "correct": D1's under-merges are in-domain silent misses that no profile flags (d3 0/13 novel, while 4 misses sat in d3).
   - So the evidence record (silent-miss rate, shadow agreement) must travel with the domain, as §6.7 says. Today nothing serialises it.
4. **What a borrowing program brings that a drift segment does not:**
   - its own acceptance semantics behind the same schema (for example "per person" versus "per household" merge);
   - its own conventions in the prose;
   - its own verification budget. Program A's shadow record says nothing about B's error cost.

   A drift segment at least keeps the caller's intent fixed. Reuse changes it.
5. **Borrowers would pollute the lender's compile pool.** If the borrower's out-of-domain tasks deopt and their traces join the lender's pool, the lender's next recompile widens toward the borrower's distribution. That is the B4 mechanism, driven from outside.

### 2. Ideological root

**The assumption:** *evidence is a property of the workflow, so a workflow proven in program A carries its proof into program B.* In fact the evidence belongs to the triple (workflow, input distribution, the caller's notion of correct).

**For the assumption to hold:**
- (a) B's inputs lie inside A's confirmed support;
- (b) B's correctness relation equals A's on that support;
- (c) the workflow's unmodelled dependencies match: paraphrase conventions, model versions behind its judges, tolerance choices (D7).

Only (a) can even be observed today.

**Against the e2e vision:**
- Reuse exists to amortise construction. THESIS P5 already warns that reuse must pay and that on diverse work it "rarely triggers" (`docs/THESIS.md:157`).
- If proving applicability costs as much as re-interpreting, as with full shadows at about $0.3 per task (sweep F5), reuse loses the utility race.
- So the gate must be *cheap in the common case and rigorous on admission*. That is a two-phase design, not a per-task classifier.

### 3. Frontier

- **SkillApt** ("Towards Strategy-Level RSI for Skill-Augmented Agents: Learning When to Reuse Skills from Execution Feedback", Guo et al., arXiv 2609.26863, Sep/Oct 2026, https://arxiv.org/abs/2609.26863) [paper, abstract].
  - "Relevance is not applicability." It estimates a skill's conditional marginal utility from *paired* with/without runs on the same state.
  - On 160 held-out states, success rose from 81.9% to 91.3% while activating on only 26.3% of states, against 98.8% for a zero-shot controller.
  - A history of only successful with-skill runs makes the policy load skills almost everywhere. That is the same survivor bias as admitting reuse from a lender's success record.
- **SkillOps** (Pu, Song, Zhao, arXiv 2605.13716, May 2026, https://arxiv.org/abs/2605.13716) [paper, abstract]. Typed skill contracts and library health over utility, compatibility, risk and validation. The field semantics of its contracts are **unverified**: the abstract does not define them.
- **Model Cards** (Mitchell et al., FAT* 2019, https://research.google/pubs/pub48120/) [paper]. Intended use and **out-of-scope uses** are first-class fields. I saw this through secondary sources.
- **Failing Loudly** (Rabanser, Günnemann, Lipton, NeurIPS 2019, https://arxiv.org/abs/1810.11953) [paper].
  - Two-sample tests on reduced representations detect shift best. Domain classifiers help characterise whether a shift is harmful.
  - These are **batch** tests, suited to admitting a whole program, unlike per-task profiles.
- **Conformal prediction under covariate shift** (Tibshirani, Barber, Candès, Ramdas, NeurIPS 2019, https://arxiv.org/abs/1904.06019) [paper]. Likelihood-ratio weighting from *unlabelled* target inputs transfers coverage. Program A's labelled evidence, reweighted by B's unlabelled inputs, estimates B's expected miss rate before any reuse.
- **Generalized OOD detection survey** (Yang, Zhou, Li, Liu; arXiv 2110.11334, IJCV 2024 per the HKBU record) [paper]. The covariate-versus-semantic shift distinction is exactly M1 versus M4.
- APC, AWM and ASI are covered in the sweep and not repeated.

### 4. Niche verticals

1. **Aviation: the Approved Model List STC (FAA AC 20-180).**
   - One set of baseline compliance data serves several aircraft models. Another model is added by **amending the AML, not reissuing the STC**, and only for identical or similar installations. Installations that differ too much need a separate Part 21 approval. (https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_20-180.pdf; CASA bulletin https://www.casa.gov.au/sites/default/files/2021-09/airworthiness-bulletin-02-062-use-of-approved-model-list-aml-supplemental-type-certificates-stc.PDF) [practice/docs].
   - **Transferable mechanism:** eligibility is a list of *admitted callers*, each with its own substantiation. It is not a similarity score computed at install time.
   - **Foundry adaptation:**
     - A reusable workflow carries an **Approved Caller List**, entries `{programId, admitted domain slice, substantiation run ids, version range}`.
     - The router reuses only for listed callers, inside the admitted slice.
     - Admitting a caller amends the list without recompiling. A caller that differs too much triggers a new compile (the "Part 21" path).
2. **Pediatric extrapolation (ICH E11A, Step 4 August 2024).**
   - The framework is a *pediatric extrapolation concept* (synthesise what is known about "similarity of disease, drug pharmacology, and response to treatment" between the reference and target populations, and identify gaps), then a *pediatric extrapolation plan* whose study designs "depend on the gaps in knowledge and the level of uncertainty". Extrapolation is a *continuum* from full extrapolation to an independent program. (EMA PDF, text extracted this session: https://www.ema.europa.eu/en/documents/scientific-guideline/ich-guideline-e11a-pediatric-extrapolation-step-5_en.pdf, lines on "continuum of similarity/dissimilarity" and the plan) [practice/docs].
   - **Transferable mechanism:** the amount of bridging evidence is *sized by the measured dissimilarity*, never all-or-nothing.
   - **Foundry adaptation:** reuse admission produces an **extrapolation concept**: a profile distance, concept overlap (B4 option d) and an output-contract diff. That concept sets the **bridging plan**:
     - full reuse with base shadow rate;
     - reuse with p=1 shadows on the first N tasks, where N comes from a sequential test;
     - or "no extrapolation", meaning compile anew, warm-started from A's traces.
3. **QSAR, OECD principle 3: the domain covers response as well as structure.**
   - The applicability domain is defined over *both* structure and response space (OECD 2004, URL above).
   - **Transferable mechanism:** a domain is not just "inputs like these" but "inputs like these, *for an endpoint like this*".
   - **Foundry adaptation:** the caller's output contract and its acceptance tests are part of the domain key. A caller that reuses the records solver with the same schema but different merge semantics (the response axis) is out of domain even when every input is in profile.
4. **Drug labelling and off-label use.**
   - An indication is the regulated statement of where evidence exists. Off-label use is possible but carries no label evidence [inference from general regulatory practice; I did not open a primary FDA source this session, so treat this as **unverified**].
   - **Foundry adaptation:** reuse outside the admitted slice is allowed only as **off-label mode**:
     - forced shadow at p=1;
     - results tagged `off-label` in the journal;
     - never counted toward the workflow's evidence record until adjudicated.

     This turns "missed reuse" into a measured, bounded experiment instead of a refusal.
5. **Safety cases (GSN v3, SCSC-141C, 2021, https://scsc.uk/scsc-141c) and dynamic safety cases** (Denney, Pai, Habli, ICSE 2015, https://dblp.org/pid/30/1320) [practice/docs; paper abstract only].
   - The dynamic-safety-case idea re-evaluates design-time assumptions at runtime.
   - **Transferable mechanism:** the reused component's argument depends on context and assumption nodes that the *new system* must discharge.
   - **Foundry adaptation:** a promoted workflow ships with a machine-checkable assurance stub, a list of assumptions such as:
     - "date orders are stated in notes";
     - "export rows ≤ N";
     - "judges on claude-haiku-5-5 per `policy/models.json`".

     Each has a runtime monitor. Reuse in B means discharging each assumption on B's admission sample. A failed monitor invalidates the reuse lazily, which matches the sweep's "not-entrant" idea.

### 5. Creative options

- **(a) Patch: a three-part gate.**
  - Profile (covariate), concept set (semantic) and output-contract diff (response), all at $0–$0.003 per task.
  - Plus the evidence record (silent-miss rate with a CI) attached to the workflow.
- **(b) Admission by bridging study, then a cheap per-task gate.**
  - The first N tasks of program B run the reused workflow *and* the interpreter, paired as in SkillApt.
  - A Wald SPRT on disagreement admits or rejects the caller, with N sized E11A-style by the extrapolation concept.
  - After admission, only the $0 profile and concept gate plus the base shadow rate run per task.
  - This matches the per-task gate's cost to its job and puts the rigour in admission [inference].
- **(c) Change the problem: reuse evidence, not workflows.**
  - What moves between programs is A's **trace pool, regression suite and refusal suite**. B compiles its own variant warm-started from them, at Haiku compile cost of about $2–5 against the full arm.
  - Applicability becomes a testable question: does A's suite pass under B's spec and contract?
  - This mirrors consumer-driven contract testing in microservices, where the consumer supplies the tests the provider must pass [inference; practice not verified this session].
  - It also removes the cross-program pool pollution of §1.5 by construction.
- **(d) Change the problem: let the borrower carry the fence.** The caller declares its own acceptance contract and risk budget, and the reused workflow runs it as an invariant. Reuse then runs under the borrower's terms, not the lender's.

### 6. Experiments, ranked

**X-B11-1. Offline reuse confusion matrix. About $1–3, a few hours, low Haiku quota.**
- **Lender:** S/H v1 and O/H v3 records solvers, proven on the dev stream.
- **Borrower "programs"**, all records dev seeds not yet used:
  - P-sub: d2, a strict subset with fewer systems. Correct reuse is expected.
  - P-drift: d5.
  - P-alien: kinetics d4. Refusal is expected.
- **Cost:** compiled runs cost $0.004–0.04 each. 2 solvers × 3 programs × 10 tasks ≈ $1–3.
- **Gates compared:** shapeKey (baseline), profile-all, profile-no-size, profile+concept, and profile+concept+contract-diff.
- **Metrics (THESIS-JIT §6.7):** correct reuse, wrong reuse, missed reuse, and savings over Haiku-agent re-interpretation at $0.062 per task (sweep F5). The oracle is the experimenter's view only.
- **Prereg:** freeze gates and thresholds in a short PREREG-reuse-dev note before running. This is dev evidence, K=2 lenders.
- **Kill:** the best gate's wrong-reuse rate is above 10% while missed reuse is under 50%. Per-task input gating is then insufficient, and only (b) or (c) remain.
- **Falsified if:** shapeKey and the best gate differ by under 3 correct-reuse points. The gate would be adding nothing.

**X-B11-2. Bridging-study admission versus per-task gate only. About $8–15, moderate Sonnet quota.**
- **Build:** `experiments/jit/admit.mjs`, an SPRT over paired shadows that plugs into the stream as a "program B" segment.
- **Setup:** a two-program stream: 16 records d3 tasks (A), then 12 tasks from B (d5 or a perturbed-convention variant).
- **Arms:** gate-only, admission+gate, and always-interpret.
- **Metrics:** wrong reuse per 100 tasks, $/success and admission cost.
- **Kill:** admission costs more than always-interpret over the 12 B tasks. Reuse does not pay at this stream length, which is a P5 negative result and should be preserved.

**X-B11-3. Evidence-transfer compile (option c) versus as-is reuse. About $5–10.**
- B compiles from A's suites plus 2 of its own traces. Compare pass rate and total cost against X-B11-2's best arm.
- **Falsified if:** the warm-started compile costs as much as a cold one. Check the compile memo the sweep flagged first.

---

## Cluster: how B4 and B11 interact

B4 and B11 are **one missing object seen along two axes**: a version's domain of validity.
- **B4 is the time axis:** the domain moves under a fixed caller because a heal rewrote it.
- **B11 is the space axis:** the caller moves under a fixed version because another program borrowed it.

Today the only record of the domain is the guards inside `solve.mjs`, the one artifact the compiler is instructed to rewrite. That is why both blockers end the same way: silent answers outside the confirmed domain. M1–M4 show why the current proposed remedy, the runtime profile, is necessary but not sufficient:
- it sees covariate shift mostly through input size;
- it is blind to the semantic shift that actually broke d4;
- one confirmed example stretches it over a whole region;
- it cannot express the caller's notion of correct.

**The coupling is concrete:**
- **Unfixed B4 poisons B11.** A heal in the lender silently changes the domain every borrower relies on. In aviation terms, amending the STC would change eligibility for every installer without anyone amending the AML.
- **Unfixed B11 drives B4.** Borrowers' out-of-domain tasks deopt, their traces enter the lender's pool, and the next recompile widens toward the borrower's distribution.

**The shared fix is a first-class, runtime-owned domain artifact:**
- covariate profile with evidence-scaled coverage;
- concept set;
- output-contract key;
- refusal suite;
- evidence record;
- approved caller list.

It is monotone by default. It widens only through an SPC-style re-baseline or an E11A-style bridging plan, under a code-checked change-control plan that also makes JIT recompile obey heal's "add guards, never relax" rule.

**The slider then gets a cleaner meaning:** shadow probability becomes a function of distance from the confirmed domain, not a fixed rate. That spends verification budget where both blockers create risk, in newly widened regions and newly admitted callers. It is the cheapest route to keeping the vision's promise that executable contracts and independent evidence govern every promotion, including the quiet promotions that today happen through a widened guard.

**Files cited:**
- `/home/user/workflow-foundry/experiments/jit/prompts.mjs`
- `/home/user/workflow-foundry/experiments/jit/stream.mjs`
- `/home/user/workflow-foundry/experiments/jit/router.mjs`
- `/home/user/workflow-foundry/experiments/jit/profile.mjs`
- `/home/user/workflow-foundry/experiments/jit/eval-profiles.mjs`
- `/home/user/workflow-foundry/research/jit-20261008/{DEV-NOTES.md,THESIS-JIT.md,SPEC.md,nversion-records-dev.json}`
- `/home/user/workflow-foundry/research/heal-20261008/DESIGN.md`
- `/home/user/workflow-foundry/docs/THESIS.md`
- `/home/user/workflow-foundry/docs/RESEARCH.md`
- `/home/user/workflow-foundry/beds/records/README.md`
- `/home/user/workflow-foundry/experiments/runs/jit/jit-dev-records-1/`

The scratch script for M2 is `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/sk.mjs`.

## Agent result 5

# Dossier: semantics and acceptance (B6 kinetics compile failures and the composer question; B8 compile acceptance without ground truth)

*2026-10-09. Read-only pass: no edits, no git, no model calls. All repo numbers are development evidence from K=1 streams on dev seeds. None of them supports a claim.*

**Tags**
- **[M]** I recomputed it this pass from `experiments/runs/jit/jit-dev-kinetics-1/*/{events,results}.jsonl` and `versions/*/BUILD-NOTES.md`, `compile.json`.
- **[D]** It is documented in the cited repo file.
- **[paper]**, **[practice/docs]**: external sources I saw this pass, through search-result abstracts or listings unless stated otherwise.
- **[inference]**: my own reasoning.

FRONTIER-GAPS already covers metamorphic relations, CodeT, Daikon, Dawid–Skene, Fellegi–Sunter, GEPA, ASI and AlphaCodium. This dossier cites them only to build on them.

---

## 0. New $0 measurements that change how both blockers read

| # | Fact [M] | Source |
|---|---|---|
| N1 | Kinetics compile attempts: **Haiku 6, of which 1 accepted and 3 clean. Opus 5, of which 2 accepted and 4 clean.** Opus fallbacks are also "not accepted" 3 of 5 times. Acceptance rejects both compilers at similar rates. | `compile-attempt` events, all three JIT arms |
| N2 | The recurring per-case `partial = 0.533` is **16/30 leaves**. My reading [inference]: every condition id and every excluded id agree, and each `vmax`/`km` differs only in late digits. A numerically identical solver therefore scores about 0.53 under check-traces. | `perCase` in O/H v1-opus55 (0.533 ×3); BUILD-NOTES "differ by ≤1e-5 relative" |
| N3 | The O/H v2 Haiku compile ($1.58, `compile.json`) was **clean and numerically matched 4/5 traces**. It argued its one real disagreement (trace-3) with a quoted SOP sentence. It was rejected only because its notes wrote "Trace-0, 2, 4 differ by ≤1e-5", and the acceptance regex `\btrace-2\b` (`stream.mjs:172-181`) is case-sensitive and needs the literal token. The Opus fallback followed; idx 9 cost $3.51 in total. | `versions/v2-haiku55/BUILD-NOTES.md`; events |
| N4 | **Acceptance does not predict downstream success.** Versions marked accepted delivered compiled passes 8/12 times (H/H v1 3/5, O/H v2 5/6, S/H v1 0/1). Versions adopted although not accepted delivered 4/5 (O/H v1-opus 4/4, S/H v2 0/1). n=17, so this only shows that there is no visible signal. | `results.jsonl` × version |
| N5 | Compiled cost per run spans **$0.011 to $0.43** within one family and one compiler. Haiku-built H/H judges are per-document and see every document, at about $0.23–0.25 per run. That is more than the Haiku agent's whole task ($0.088). | `compiled` events |
| N6 | The live semantic dispute is a **scope question**. Does "Block read 23.7 °C during this read" exclude all nine wells of the read under SOP 2.4, or one? The two readings move one condition's Km by +2.8%, inside the 10% numeric tolerance. But they change the `excluded_samples` set, and the grader compares that set exactly. | O/H v2-haiku BUILD-NOTES |

**Reading.** B6 ("Haiku compile often rejected") is at least half a measurement artefact, made of exact float comparison (D7), a $1.5 gateway cap and prose-regex acceptance. B8 is the part underneath it that is real and general.

---

## B6. Compile failures on semantics-heavy families

### 1. Mechanism

There are three layers. They interact, and only the third is about semantics.

1. **Instrument layer (artefact).**
   - `check-traces` compares canonically and exactly (`check-traces.mjs:33-81`; tolerant comparison is v2.1 work that has not landed, #36). A correct kinetics solver therefore scores 0 exact and about 0.53 partial (N2).
   - Acceptance then depends on whether model-written prose names each case id (N3).
   - Reject-if-worse compares exact counts (`stream.mjs:162`), so on kinetics it is vacuous: 0 against 0 always (C2 in FRONTIER-GAPS).
2. **Budget layer.**
   - check-traces pays live judge calls for every case. Kinetics cases carry 8–12 documents.
   - Two of the three not-clean Haiku builds say in their notes that they ran out of the $1.5 cap before validating: O/H v1 "gateway refused a call"; S/H v1 "build budget ran out".
   - The Opus fallback therefore fires on unvalidated builds, not on bad ones [D, BUILD-NOTES]. Kinetics compiles cost $3.2–8.1 against $2.10 for the Haiku agent's entire stream [D, FRONTIER-GAPS §0.1].
3. **Semantic layer (real).** The kinetics bed (`beds/kinetics/README.md`, *Where the exclusion evidence sits*) is built from defeasible rules with exceptions:
   - silent exclusions reported only in later chat;
   - corrections moved to another well;
   - order-of-events notes ("popped the bubble only after the read started");
   - negated notes and side remarks in the vocabulary of the opposite outcome;
   - scope ambiguity (N6);
   - wells named by ordinal position.

   The compiler has to decide which of these become code and which become `flow.judge`.
   - Haiku builds put "decide everything" into one wide per-document judge that sees every document. That is costly (N5), nondeterministic ("Judge output varies between runs on the same document", S/H v1 notes) and escalates to Opus often (about $0.10–0.20 per call).
   - The traces do not carry the exclusion *reasons*. `agent-work.md` holds scripts and 200-character command prefixes (SPEC §3.2). So the compiler re-derives SOP semantics from scratch: foresight again (FRONTIER-GAPS B2).

Numeric tolerance is a separate semantic of its own:
- The grading rule is ±10% on fitted parameters and an exact set on exclusions.
- Two correct fits agree to about 1e-5.
- The system has no declared per-field equivalence, so it cannot tell "same answer" from "different answer" (D7).

### 2. Ideological root

**Assumption A6a: "a compile failure is a compiler-skill failure, so the remedy is a stronger or trained compiler."**
- N1 and N3 refute it on this data: Opus is "rejected" at a similar rate, and at least one rejected Haiku build was numerically right.
- For the assumption to hold, three things would have to be true:
  - the acceptance instrument would have to be accurate;
  - compile budget would have to be adequate for the family;
  - failures would have to cluster by builder model.

  None holds.

**Assumption A6b: "the family's semantics can be induced from three answer-labelled traces plus the documents."**
- This is THESIS-JIT §2.1, "construction is distillation of evidence".
- For a family whose difficulty *is* defeasible exceptions, the answers are compatible with many rule sets. Three traces underdetermine which exception fired.
- §6.5 of THESIS-JIT already proposes "spec first, then compile". The deeper root is treating the **SOP as context** rather than as a **program to be formalised once**.

**Against the full e2e vision.**
- Real recurring work (lab SOPs, finance close rules, compliance policies, the R-bench hand-built workflows) is *more* exception-heavy than kinetics.
- If each new family needs either an Opus compile at $3–8, or a Haiku compile that cannot verify itself, then cheap construction never happens where it matters.
- The vision needs the semantic decisions to be *made once, audited once and owned*, with cheap models filling facts into them.

### 3. Frontier

- **Detecting ambiguity by the disagreement of generated programs, then clarifying.** ClarifyGPT (Mu et al., FSE 2024; https://arxiv.org/pdf/2310.10996) runs a code-consistency check over generated test inputs, asks targeted clarifying questions only when flagged, and lifts GPT-4 on MBPP-sanitized from 70.96% to 80.80% pass@1 [paper].
  - For Foundry: disagreement among K cheap compiles on a *decision* (not an answer) is the trigger for one Opus "interpretive ruling", not for a full Opus compile [inference].
- **Turning NL intent into checkable postconditions.** nl2postcond (Endres, Fakhoury, Chakraborty, Lahiri, FSE 2024; https://arxiv.org/abs/2310.01831v2): LLM-generated postconditions were generally correct, discriminated buggy code, and caught 64 historical Defects4J bugs [paper].
- **Small-model distillation, for the owner's question.** Distilling step-by-step (Hsieh et al., Findings of ACL 2023; https://research.google/pubs/distilling-step-by-step-outperforming-larger-language-models-with-less-training-data-and-smaller-model-sizes/): a 770M T5 trained with LLM rationales beat few-shot 540B PaLM on a benchmark, using 80% of its data [paper].
  - The precondition is a fixed task with thousands of labelled examples.
  - Foundry has about 11 kinetics and about 15 records compile attempts, about half of them validated [M/D].
- **Verified skills beat self-generated ones.** SkillsBench (2026) found self-generated skills give no average benefit [paper, as reported by the synthesis sweep, not re-opened here].

### 4. Niche verticals

**(a) Statutory drafting: Catala and the negative-implication canon.**
- Catala (Merigoux, Chataing, Protzenko, ICFP 2021; https://arxiv.org/abs/2103.03198v2) is built on *prioritised default logic*. Each statute paragraph maps to a code fragment, and base rules and their exceptions are written in different places, mirroring statute structure. The team reportedly found a bug in the official French family-benefits implementation [paper; press].
- Courts handle implied exclusion through the negative-implication canon (*expressio unius*). Scalia and Garner, *Reading Law* (2012), stress applying it "with great caution": only when the listed items "can reasonably be thought to be an expression of all that shares in the grant" [practice/docs, via secondary sources: https://constitutionallaw.substack.com/p/negative-implications-canon].
- *Transferable mechanism:* (i) exceptions are first-class and prioritised, not buried in prose; (ii) interpretive choices (scope, implied exclusion) are named canons applied explicitly and recorded.
- *Adaptation:*
  - The SOP becomes a **default-logic rulebook**: `exclude(well) :- bubble_present_during_read(well)`, with `exception: removed_before_read`, `exception: author_withdraws`, and so on.
  - Each rule carries the quoted SOP sentence.
  - Each scope ambiguity (N6: "during this read" applies to the whole read or to one well) becomes a named **interpretive ruling**, made once per family by Opus or the owner, quoted and versioned.
  - Haiku then only extracts *facts* (bubble at t, read window, author confirms X). Code applies the rulebook.

**(b) Requirements engineering: NASA FRET.**
- FRET writes requirements in FRETish, a restricted NL with fields (scope, condition, component, shall, response). It produces an NL and diagram explanation of the exact meaning, formalises the requirement in temporal logic, simulates it interactively and checks realizability (https://ntrs.nasa.gov/citations/20200001989; OSS at github.com/nasa-sw-vnv/fret) [practice/docs].
- *Mechanism:* force each requirement into a template whose slots *cannot* be left implicit (scope, trigger), then show the author the formal reading back in plain words.
- *Adaptation:*
  - The rulebook's grammar has mandatory `scope` (well / row / read / plate / condition) and `trigger-time` (before / during / after the read window) slots.
  - An unfilled slot is a compile-time error, not a judge prompt.
  - The rulebook is rendered back to NL for owner sign-off (the NL → proposal → approval rule).

**(c) Decision tables: DMN completeness and overlap.**
- Calvanese, Dumas, Laurson, Maggi, Montali, Teinemaa ("Semantics and Analysis of DMN Decision Tables", BPM 2016, best paper; https://arxiv.org/pdf/1603.07466) map rules to hyper-rectangles. They detect *overlapping* rules (ambiguity) and *missing* rules (gaps) with scalable geometric algorithms [paper].
- *Adaptation:*
  - Exclusion rules over discrete facts (event type × timing × polarity × confirmation) form a decision table.
  - Missing-rule detection lists fact combinations the SOP does not decide, for example "colleague reports, author silent". These are exactly the cases where traces disagree.
  - Overlap detection lists contradictory rules.
  - Both are $0 and static, and they run *before* any model compile.

**(d) Analytical method validation, certified datasets and manufactured solutions (the numeric half).**
- ICH Q2(R2) (adopted 1 Nov 2023; https://www.ema.europa.eu/en/documents/scientific-guideline/ich-q2r2-guideline-validation-analytical-procedures-step-5-revision-2_en.pdf) validates a procedure for its *intended use* through declared characteristics: specificity/selectivity, reportable range, robustness. It ties system-suitability tests to ICH Q14 [practice/docs].
- NIST StRD certifies nonlinear-regression reference values (computed in 128-bit precision, rounded to 11 significant digits). Software is graded by LRE, about the number of correct significant digits (https://www.stata.com/support/cert/nist/). In one comparison, none of five packages consistently reached 3 digits [practice/docs].
- The method of manufactured solutions (Salari and Knupp, SAND2000-1444; https://www.osti.gov/biblio/759450) verifies code where no real answers exist: manufacture a problem with a known solution and check the code recovers it [paper].
- *Adaptation:*
  - Split the solver into a **semantic front end** (which wells, which values, which units) and a **numeric back end** (the Michaelis–Menten NLLS fit).
  - Certify the back end once per family with manufactured datasets the system itself generates: draw Vmax and Km, synthesise rates, require LRE ≥ 4 on noise-free data and recovery within tolerance under declared noise.
  - Reuse that certified module across compiles, so the fitter is never re-compiled or re-judged.
  - Numeric tolerance is declared per field in the contract, from the task prompt's stated grading rule. **Not** from the bed README: the README describes the generator and is off-limits to the system.

### 5. Creative options

1. **(Patch) Fix the instrument before judging the compiler.**
   - Per-field equivalence in check-traces, shadows and reject-if-worse: relative tolerance for numbers, sets for set-typed fields.
   - Acceptance computed from structured per-case verdicts, never by regex over prose.
   - Validation budget priced per document: the cap scales with documents × cases.
2. **(Patch) Certified-module library.** The fitter, unit parser and number-format parser are compiled once, certified by manufactured solutions, and imported read-only by every kinetics compile. This is composition in the owner's sense: guarded sub-modules. Haiku's compile surface shrinks to the family-specific front end.
3. **(Change the problem) The rulebook is the program; there is no model compiler for semantics.**
   - Opus writes a typed default-logic rulebook from the SOP once per family. It has quoted rules, interpretive rulings, DMN gap and overlap reports, and worked-example tests.
   - The owner signs off the rendered NL.
   - A **deterministic** rulebook interpreter (code) applies it. Cheap models only do fact extraction with literal-quote checks.
   - "Compile" then means writing rulebook + extractor schema, and a new task shape is a rulebook diff.
   - This removes Haiku's hardest job rather than training a model to do it [inference].
4. **(Change the problem) Disagreement-triggered rulings instead of fallback compiles.**
   - Run K=3 cheap compiles or extractions.
   - Only where they disagree on a *decision* (well X excluded or not) is one narrow, quoted question sent to Opus. The answer is added to the rulebook as a ruling.
   - Following ClarifyGPT, Opus spend scales with ambiguity, not with document count.
5. **On "train a small composer vs Haiku?"**
   - **Not now** [inference, from N1–N4]. The failures are not yet attributable to compiler skill.
   - There are about 26 compile records, against the thousands that step-by-step distillation assumes.
   - The SDK target (`flow.mjs`) is still changing (#36, `flow.flag`).
   - If option 3 holds, the composer's job becomes a narrow, well-posed **rulebook → extractor-schema** translation with a deterministic checker. That is a port a small model *could* learn, and it saves quota (THESIS-JIT §6.6) rather than dollars.
   - Revisit when at least 300 oracle-validated, independently accepted compile records exist across at least 3 families.

### 6. Experiments (ranked)

**E6.1 Instrument-corrected re-acceptance of all archived kinetics compiles (highest value per $).**
- *Build:* `experiments/jit/equiv.mjs`, a per-field comparator declared in a family `contract.json`: `vmax`/`km` at relative 1e-3 (agreement band, far inside the prompt's 10% grading rule); `excluded_samples` as a set; ids exact. Add `experiments/jit/reaccept.mjs`, which reruns acceptance over the 11 kinetics `compile-attempt` records with structured verdicts and no regex. Where `journal.sqlite` replay covers the cases, outputs come at $0. Otherwise rerun each `solve.mjs` on its traces.
- *Metric:* accepted fraction per builder (Haiku against Opus), and the acceptance verdict against downstream compiled oracle pass (N4).
- *Baseline:* the current verdicts (N1).
- *Prereg:* a dev diagnostic; freeze the comparator and the tolerance source (the prompt's grading rule) in the file before running.
- *Cost:* $0 if the journal covers it; otherwise about $0.2 × 4 cases × 11 builds ≈ $9, Haiku/Sonnet judge quota only.
- *Kill/falsify:* if Haiku's corrected acceptance stays below Opus's by at least 2 of about 5 attempts, the Haiku gap is real semantics: go to E6.2. If the gap closes, the B6 claim "Haiku compile often rejected" is withdrawn as an artefact.

**E6.2 Rulebook-first compile (tests option 3; directly answers the composer question).**
- *Build:*
  - `experiments/jit/rulebook/` with a schema for default rules, exceptions, interpretive rulings and quoted provenance;
  - `rulebook-lint.mjs`, the DMN-style missing and overlap check over discrete fact slots;
  - a deterministic `apply.mjs`.
  - Opus writes the kinetics rulebook from the SOP and documents of the 3 warmup traces only. No README, no bed code.
- *Arms (K_c = 3 each):*
  - A: Haiku compile, current prompt;
  - B: Haiku compile given the rulebook and the certified fitter module;
  - C: Opus compile, current prompt (reference);
  - D: rulebook + `apply.mjs` + Haiku fact extractors, with no free-form compile.
- *Eval:* the same 8 archived dev tasks (dev seeds 205–212, already diagnostic), scored by the bed oracle as the experimenter's scorer.
- *Metric:*
  - compiled pass over 24 solver-task pairs per arm;
  - compile $ and compiled $/run;
  - Opus calls as a quota proxy.
- *Prereg:* a short frozen note with arms, seeds and the threshold. Dev-labelled.
- *Cost:* one Opus rulebook session about $3; 9 Haiku compiles × $1.5 = $13.5; 3 Opus compiles about $15; eval about $10. **About $40**, Opus-heavy only in arm C.
- *Kill:* if B and D both trail C by at least 3 of 24 pairs, the semantics cannot be externalised this way. If D is within 3 of C at less than a third of C's per-run cost, Haiku plus rulebook replaces Opus compiles, and the trained-composer question is moot for this family.
- *Falsifier of option 3:* D's lint reports no gaps, yet its misses concentrate in fact extraction. Then the bottleneck is reading, not rules.

**E6.3 Disagreement-triggered rulings (option 4), $0 first.**
- Replay the per-well decisions of the archived kinetics compiled versions across lineages (H/H, O/H, S/H on shared seeds 204–212).
- Measure how many delivered misses (s206, s209, s216) involve a well on which lineages disagree.
- If at least 2 of 3 do, build the live arm. If 0 of 3 do, disagreement is not the trigger (common mode, as in D8), and option 4 is dropped.

---

## B8. Compile acceptance without ground truth

### 1. Mechanism

- The acceptance rule (SPEC addendum 4, `compile.mjs:174-185`) is "clean + regressions pass + every diff case id named in BUILD-NOTES".
- Measured failures, in both directions:
  - false accepts: records S/H at 0/3 exact with "Known miss, not fixed"; kinetics H/H at partial 0.546 (D4);
  - false rejects: N3, and O/H v1-opus adopted although not accepted, then 4/4;
  - no predictive signal (N4).
- **Causes:**
  1. Agreement is measured against single interpreter runs, whose repeatability nobody has measured (D7: correct fits differ; S4: the Sonnet reference is worse than its distillate).
  2. A disagreement can be "explained" by prose, which is self-certification. Konstantinou et al.: model-written oracles copy actual behaviour [paper, via sweep].
  3. All evidence is end-to-end answers on n = 3–5 inputs. Nothing checks the *decisions* or the *components*.
  4. The rule is a pass/fail gate with no cost term, so solvers costing more per run than the agent are accepted (N5).

### 2. Ideological root

**Assumption B8a: "agreement with demonstrations is evidence of correctness, and explaining away disagreement is evidence too."** For this to hold:
- the demonstrator would have to be repeatable well within the tolerance (it is not on numbers);
- the demonstrator would have to be more accurate than the candidate (inverted for Sonnet, S4);
- explanations would have to be checked by a party that is not the author (they are not).

**Assumption B8b: "acceptance is a one-shot gate at compile time."** Mature industries split acceptance into four separate things:
- qualifying the *gauge*;
- qualifying the *method*;
- *first-article* inspection of the product;
- *ongoing* conformance monitoring.

Foundry runs all four as one gate on 3 inputs.

**Against the e2e vision.** "Executable contracts and independent evidence govern every promotion" (AGENTS.md) is not met. The current acceptance is neither executable (it reads prose) nor independent (the compiler grades itself). For real users' workflows, where no label exists at all, acceptance has to come from three things:
- an owner-approved contract;
- conformance of the solver's *decisions* to that contract;
- consensus among independent references whose own error has been measured.

### 3. Frontier

- **The test-oracle problem from specifications.** Jdoctor (Blasi et al., ISSTA 2018; https://homes.cs.washington.edu/~mernst/pubs/comments-specs-issta2018-abstract.html) turns semi-structured comments into executable pre- and postconditions at about 92% precision and 83% recall. Fed to Randoop, these produce fewer false alarms and find more defects [paper].
  - nl2postcond (above) extends this to LLMs, with metrics for both *correctness* and *discriminative power* of the generated checks [paper].
  - Transfer: an acceptance check must be scored on whether it discriminates known-bad solvers, not only on whether it passes good ones.
- **Learned verifiers over execution results.** LEVER (Ni et al., ICML 2023; https://proceedings.mlr.press/v202/ni23b.html) trains a verifier on (NL, program, execution result) and pools programs with identical execution results. It gains 4.6–10.9% over base code LLMs when tests are unavailable [paper].
  - This is the principled future home for Kev in acceptance: a small judge over (rulebook, decision log, outputs), trained on the oracle-labelled dev slice [inference].

### 4. Niche verticals

**(a) Measurement system analysis (Gauge R&R).**
- Before measuring parts, manufacturing qualifies the gauge. By the AIAG rule of thumb, %GRR (gauge variation against tolerance) under 10% is adequate, 10–30% is conditional, and over 30% is unacceptable; the number of distinct categories should be at least 5 (https://www.spcforexcel.com/knowledge/measurement-systems-analysis/acceptance-criteria-for-MSA) [practice/docs].
- *Mechanism:* never judge a product with an instrument whose repeatability is comparable to the tolerance.
- *Adaptation:*
  - The interpreter is the gauge. Foundry already has repeated interpretations of the same seeds: agent arms, warmup traces and shadows across arms.
  - Compute per-field repeatability: numeric spread, set Jaccard and ordering variance.
  - A field whose %GRR exceeds 30% of its tolerance cannot be used for acceptance. It becomes "unmeasurable by this gauge", and acceptance must use a better gauge (an Opus decision query) or none.
  - This turns D7's tolerance from a guess into a measurement.

**(b) Proficiency testing with consensus assigned values (ISO 13528).**
- When no certified reference exists, the assigned value is a robust consensus of participants. Algorithm A starts from the median and 1.483·MAD, clips at ±1.5 s*, and iterates. Each lab gets z = (x − assigned)/σ_pt, with |z| ≤ 2 satisfactory and ≥ 3 an outlier. Practitioners warn that consensus and CRM-based assigned values give significantly different z-scores (https://archimer.ifremer.fr/doc/00693/80492; https://annals.fih.upt.ro/pdf-full/2023/ANNALS-2023-3-26.pdf) [practice/docs].
- *Adaptation:*
  - For each trace input, the "labs" are independent references: interpreter traces, other lineages' compiled outputs (`nversion-records-dev.json` already has 4 solvers × 24 tasks) and the candidate.
  - Numeric fields get a robust consensus with σ_pt from the gauge study. Set and enum fields get per-element vote shares.
  - The candidate is accepted if |z| ≤ 2 on numeric leaves and it agrees with every element whose consensus share is at least 0.8.
  - Elements in the 0.2–0.8 band are *contested decisions*. They go to one Opus ruling (B6 option 4), never to prose.
  - Caveat inherited from N-version (D8): consensus cannot detect common-mode error (s214). Hence (c) and (d).

**(c) First article inspection (AS9102) and its partial re-inspection.**
- Aerospace requires FAI when a part is new or revised, before production. Customer flow-downs distinguish full FAI (new part or supplier) from partial FAI (a drawing revision on an approved part). Acceptance of the first article "shall not be considered a blanket acceptance of subsequent production" (https://www.gd-ots.com/wp-content/uploads/2023/08/QCSD-012_AS9102-First-Article-Inspection-Report.pdf) [practice/docs; the partial-FAI scope in AS9102 itself is unverified].
- *Mechanism:* acceptance is against the *drawing* (spec), characteristic by characteristic, with a ballooned list proving every characteristic was inspected. A change re-inspects only the affected characteristics.
- *Adaptation:*
  - The rulebook (B6 option 3) is the drawing, and each rule is a "characteristic".
  - First-article acceptance requires a **coverage ledger**: every rule fired at least once on the trace pool or on a manufactured canary, with its decision matching the rule's declared outcome.
  - A recompile is a partial FAI that re-verifies only the rules its diff touches, plus refusal replay (#41).
  - Ongoing production is monitored separately (shadows), never assumed from the first article.

**(d) Process-mining conformance checking.**
- Conformance relates a model to a log along fitness (can the model replay the log?) and precision (does the model allow behaviour never observed?). Alignments are the accurate method (Carmona, van Dongen, Solti, Weidlich, *Conformance Checking*, Springer 2018; Adriansyah et al., https://www.vdaalst.com/publications/p818.pdf). pm4py implements token replay and alignments (https://arxiv.org/abs/2007.14237v1) [paper; practice/docs].
- *Adaptation:*
  - The compiled solver emits a **decision log**: per well, the facts extracted, the rule applied, the quote.
  - Align each log against the rulebook. *Fitness* below 1 means a decision no rule licenses. *Precision* problems mean the rulebook permits paths the solver never exercises, which marks untested characteristics for the FAI ledger.
  - The interpreter's typed decision log ("declare-your-rules", FRONTIER-GAPS B2) is aligned against the same rulebook. A compiled-vs-trace disagreement is then settled by **which side conforms**, an oracle-free and decision-level adjudication.
  - This catches common-mode errors that consensus cannot, *if* the rulebook is right. The rulebook's own correctness is then the single thing the owner and Opus certify.

**(e) GD&T: per-feature tolerances and stack-up.**
- Tolerances are declared per feature against datums. Worst-case stack-up needs no distribution knowledge, while RSS assumes independent, centred, comparable-quality contributors (https://support.ptc.com/help/creo/creo_pma/usascii/model_analysis/eztol/summary_of_tol_stackup.html) [practice/docs].
- *Adaptation:*
  - The output contract gives every field a class: *datum* (ids: exact), *toleranced* (vmax, km: band), *attribute* (excluded set: exact).
  - A worst-case **materiality** pass computes whether a semantic disagreement can move a toleranced field out of band. N6's scope dispute moves Km by 2.8%: immaterial for the numbers, material for the attribute set.
  - Acceptance and shadows then spend Opus only on material disagreements.

### 5. Creative options

1. **(Patch) Structured acceptance record.** It contains per-case per-field verdicts under declared equivalence, a cost term (reject if the per-run cost on traces exceeds a declared fraction of the cheapest agent's cost), and no prose. BUILD-NOTES becomes documentation, never a gate.
2. **(Patch) Gauge-qualified references.** A trace field enters acceptance only if its measured repeatability passes the %GRR rule. Otherwise that field's acceptance comes from an Opus decision query, or it is marked unverified.
3. **(Change the problem) Accept the rulebook, not the solver.** Owner and Opus certify one artefact per family: the rulebook plus its manufactured canaries. Every compiled version is then accepted mechanically by three things:
   - decision-log conformance (fitness = 1 on traces and canaries);
   - the FAI coverage ledger;
   - proficiency-style numeric agreement.

   Ground truth is replaced by *contract truth*, which is exactly what an owner can approve. This also repairs the NL → proposal → approval gap (FRONTIER-GAPS H4).
4. **(Change the problem) Acceptance as a two-stage sampling plan.** Acceptance-sampling practice gives a provisional accept (canary + conformance) and then a mandated early-production sample: the first N compiled runs all decision-shadowed, with the rate decaying only as the silent-miss upper bound tightens. Acceptance stops being a gate and becomes a monitored state. *(The ISO 2859 analogy is not verified this pass.)*

### 6. Experiments (ranked)

**E8.1 Gauge study plus acceptance-predictiveness audit ($0).**
- *Build:* `experiments/jit/gauge.mjs`, which collects every pair of runs on the same seed and difficulty (agent arms, interpreter traces, shadows, adjudicators across records and kinetics arms) and computes per-field %GRR against the family tolerance. Then `experiments/jit/accept-audit.mjs` scores all archived compile attempts, records and kinetics (about 26), under four rules:
  - current;
  - tolerant exact-rate (D4/v2.1);
  - proficiency z-rule;
  - leave-one-trace-out.

  Each is compared with the oracle pass of that version's next ≤ 8 compiled deliveries.
- *Metric:* %GRR per field; rank correlation and AUC of each rule against downstream pass.
- *Baseline:* the current rule (N4: no signal).
- *Prereg:* the dev audit is frozen in the script header before it runs.
- *Cost:* $0; no quota.
- *Kill:* if no rule reaches AUC 0.7 on about 26 versions, end-to-end answer agreement is declared unfit as the acceptance basis, and E8.3 becomes the only path. If the proficiency rule wins, adopt it in v2.1.
- *Falsifier of option 2:* %GRR is under 10% on every field. Then the gauge is fine and the problem is only the comparator.

**E8.2 Proficiency-test acceptance on records with existing N-version data (about $0–5).**
- Use `nversion-records-dev.json` (4 solvers × 24 tasks) plus the archived agent answers as labs.
- Compute Algorithm A consensus, z-scores and per-element vote shares.
- *Metric:* recall of the 17 known wrong compiled outputs flagged as contested or outliers, at what share of tasks sent to Opus. Compare with FRONTIER-GAPS' uniform-shadow line (recall ≈ budget).
- *Baseline:* uniform 25% shadowing.
- *Kill:* recall at 25% Opus budget ≤ 0.3. That would show consensus is dominated by common mode (D8's s214), and the effort moves to (d) conformance.
- *Cost:* $0 for records; about $5 to add K=2 kinetics compiled reruns.

**E8.3 Rulebook-conformance acceptance with manufactured canaries (about one day, about $15–25; requires E6.2's rulebook).**
- *Build:*
  - `experiments/jit/conform.mjs`, which aligns `flow` decision events against the rulebook (a small hand-written aligner; pm4py is optional and must be pinned per AGENTS.md if used);
  - `experiments/jit/canary.mjs`, which plants rulebook-templated sentences into copies of trace inputs:
    - an excluding bubble note;
    - its negated twin;
    - a withdrawn report;
    - a moved correction;
    - a manufactured MM dataset for the fitter.

    The templates are written from the SOP and the rulebook, never from bed code.
- *Evaluate on:*
  - known-good versions: O/H v1-opus, v2-opus, records S/H v1;
  - known-bad versions: H/H v1, the records H/H conflict error;
  - mutants of known-good solvers built from the observed error classes (under-merge, flipped scope, dropped exception, unit slip).
- *Metric:* mutant kill rate, false-reject rate on the 3 known-good versions, Opus $ per acceptance.
- *Prereg:* freeze the mutant list and the canary templates first.
- *Kill:* known-good false-rejects ≥ 1 of 3, or kill rate < 50%.
- *Falsifies option 3* if conformance passes versions whose decisions the oracle shows wrong, beyond the rulebook's measured gaps. In that case the contract-truth substitute leaks.

---

## Cluster level: how B6 and B8 interact

- **The two blockers are one loop seen from two ends.**
  - B8's broken instrument manufactures B6. Exact comparison and prose-regex acceptance rejected numerically correct Haiku builds (N2, N3) and triggered Opus fallbacks.
  - That made "Haiku cannot compile kinetics" look like a compiler-skill problem, which is the premise behind "train a small composer".
  - B6's real semantic difficulty, defeasible exclusions and scope, is in turn exactly what B8 cannot verify. Answer agreement on 3 traces cannot tell a right exception from a wrong one when the numbers stay inside tolerance (N6).
- **The shared root is the absence of a certified, explicit statement of the family's semantics.**
  - Without it, compile must induce semantics from noisy answers, and acceptance must compare against the same noisy answers.
  - With it, as a rulebook with quoted rules, interpretive rulings, declared per-field tolerances, certified numeric modules and canaries:
    - compile becomes extraction plus a deterministic interpreter, which is cheap and Haiku-feasible;
    - acceptance becomes conformance plus coverage plus gauge-qualified consensus, which is executable and independent of the compiler;
    - Opus spend moves from per-compile ($3–8) to per-family plus per-ambiguity;
    - the owner approves contracts rather than code.
- **Sequencing:** E6.1 and E8.1 together ($0, hours) decide whether B6 is mostly instrument. E6.2 and E8.3 share one rulebook and decide whether contract truth can replace ground truth. The composer question waits on both. If the rulebook path works, a small composer has a narrow, checkable port worth training for quota reasons. If it fails, no amount of composer training fixes an acceptance signal that carries no information.

## Agent result 6

# Cascade economics: dossier on B5 (tiering a high-leverage judge), B15 (Kev from traces) and B16 (router and slider)

*Read-only pass, 2026-10-09. I made no repository edits, no git operations and no model calls. All numbers are dev split and K=1, so they are development evidence and support no claim.*

**Tags**
- **[M]**: I measured it this pass, at $0, with scripts in the scratchpad (`…/scratchpad/cb/xsource.py`), reading only dev task inputs and archived traces.
- **[D]**: documented in the repo or in the prior frontier sweep (journal `wf_d0427e6d-ceb`).
- **[paper] / [practice/docs]**: a source I opened or saw in search.
- **[inference]**: my own reasoning.

**What the sweep already covered, and is not repeated here:** FrugalGPT, RouteLLM, Dekoninck, Trust-or-Escalate, PPI/LTT, Online Cascade Learning, the Kev label-source facts K1–K6, the X1–X11 experiments, and the P1–P12 plan. This dossier adds the three measurements below, the vertical mechanisms, and new experiments.

## 0. Three new $0 measurements that change the cluster

**N1. D11 is partly confounded [M].**
- `tierdown-e2e` reruns the variant fresh but reuses the archived original. Every Haiku `vendex-*` judge is therefore re-sampled on the variant side.
- Diffing the `rules` values per task (`/var/tmp/foundry-work/jit/tierdown-e2e/*/runs/i00N-variant/trace.jsonl` against the archived compiled traces):
  - **Haiku (one pass→fail, s208):** caused by one leaf. `date_order.BRIGHTDESK` came back DMY where Opus said MDY, although the notes contain the worked example "dob=07/08/1986 is 8 July 1986". On the excluded s204, Haiku also misread `ATLAS`.
  - **Sonnet (four pass→fail):**
    - s206: omitted the VENDEX void marker;
    - s207 and s208: BRIGHTDESK date order;
    - s209: the `rules` value is identical up to marker spelling (`"env":"sandbox"` vs `sandbox`; both match the JSON `struct`). The failure is an unmerged "Matthias Krueger" after the `vendex-*` extractions changed. This one is noise from re-sampled judges, not the tier swap.
- Corrected attribution: Sonnet loses 3 tasks to the swap, Haiku loses 1. The mechanism in D11 survives; its size shrinks.

**N2. The leverage of `rules` sits in unchecked leaves [M].**
- The schema has about 15 decision units: 3 date orders, 4 sign flips, about 7 void markers, and the unreliable-update list (`versions/v1-haiku55/solve.mjs:262-301`).
- The `check` verifies only void-marker *provenance* (the marker and its quote occur in the notes).
- Date order, sign flip and the unreliable list have **no check at all**. Void-marker *completeness* is not checked either, so Sonnet's s206 omission passed.
- One date-order leaf governs 7–23 numeric birth dates per task. Those dates feed identity merging, so one flip also breaks merges: the s208 variant diffs are missing `source_rows`. This is an interaction effect, not just a first-order one.

**N3. The highest-leverage leaves can be checked from the data at $0 [M].**
- For BRIGHTDESK and ATLAS I scored each date-order hypothesis by the number of numeric birth dates that equal an unambiguous birth date (VERITAS ISO, LEDGR d.m.y, KOBO y/m/d) on a row sharing a name token.
- **d3 (13 tasks, 26 leaves):**
  - decisive (margin ≥ 1) on 25 of 26, and all 25 agree with Opus;
  - at margin ≥ 2, 23 of 23 agree.
- **d4 (8 tasks, 16 leaves):**
  - 11 of 14 agree;
  - the 3 disagreements are all ATLAS near-ties (3:4, 4:3, 4:7). That is where K5 notes a date cutoff that makes a single label lossy, so flagging them is the right behaviour. I did not adjudicate which side is right.
- **The check catches all 3 observed cheap-tier date-order errors:**
  - s204, ATLAS: data 4:1 against Haiku;
  - s207, BRIGHTDESK: 1:3 against Sonnet;
  - s208, BRIGHTDESK: 0:6 against both.
- Bonus: across 24 tasks, the 61 date-convention sentences take only **36 distinct forms** once digits are masked. A sentence-keyed cache of strong reads would hit about 41% of the time even at the bed's template diversity.

---

## B5. Tiering a high-leverage judge breaks the solver (D11)

### 1. Mechanism
- **The task is a series system.** Success needs all ~15 units of `rules` right, and the high-leverage units fan out into hundreds of output leaves.
- **The per-unit tolerance is far below what a cheap tier delivers.**
  - With task-level α = 5% spread over about 15 units, each unit needs an error rate of roughly 0.3%.
  - Haiku's per-leaf date-order rate is about 3% (32/33, K5 [D]).
  - So the expected per-task loss from the three date leaves alone is about 9%. That matches 1 lost task in 7 [inference].
- **Leaf agreement averages over leaves, but the loss is a maximum over leaves.** Field-level agreement of 0.966 (D6) is therefore the wrong statistic.
- **The cheap tiers fail on implicit readings, not on extraction:** the worked example in s208, and indirect cues such as "the country where its servers stand" or a team "in Boston".
- **The same leaves have zero check coverage (N2).** High leverage combined with zero detection is what makes the error silent rather than a deopt.
- **The measuring tool adds noise from other judges (N1).** Tier-down is never measured with the rest of the solver held fixed (#42 is still open).

### 2. Ideological root
The assumption is that **judge quality is one number per tier, and a tier is a property of the judge**. The e2e vision has cheap models executing almost everything with frontier models adjudicating rarely. That holds only if:
- (a) errors spread evenly across decisions, or
- (b) every high-leverage decision carries an independent check.

Neither is true. Leverage is concentrated: one global read conditions every row. The compiler wrote checks where checking was easy (quotes), not where the stakes were.

For the assumption to hold, every judgment would need a declared *authority level* matched to its exposure, plus a detection mechanism whose strength scales with leverage. The current design ties tier to the cost of the judge, when it should be tied to what the decision puts at risk [inference].

### 3. Frontier
- **Deferral is right only where the expert is better.** It must be calibrated against gold, not against the teacher: Trust-or-Escalate, Dekoninck et al. 2025, and Jitkrittum et al. 2023 [paper, via sweep].
- **Multi-expert deferral.** Verma, Barrejón and Nalisnick (AISTATS 2023) give consistent surrogates for deferring to *several* experts, and a conformal rule for choosing *which subset* to query. Here the experts are Haiku, Sonnet, Opus and a data-consistency check, and the choice of subset is per decision [paper].
- **Global sensitivity screening.** Morris (Technometrics 33(2), 1991) screens p inputs for importance with r·(p+1) one-at-a-time runs. The R `sensitivity` package implements it [paper, practice/docs]. With journal replay, Foundry's p ≈ 15 leaves × r = 4 is 64 code-only replays per task at $0.

### 4. Niche verticals
- **Emergency triage (ESI decision point B).**
  - *How the field solved it:* in the AHRQ ESI flowchart, a "high-risk situation" assigns level 2 *whatever the resource count* [practice/docs]. It is a trump rule that overrides the average-case score.
  - *How the field measures it:* the ACS treats under-triage below 5% and over-triage below 35% as acceptable, and audits with the Cribari matrix [paper]. Across 5.3M Kaiser encounters, ESI under-triaged 3.3% and over-triaged 28.9% (JAMA Netw Open 2023) [paper]. The field accepts about 9:1 over-escalation to hold under-escalation down.
  - *Mechanism:* classify by *decision class*, not by average model accuracy, and price the two errors asymmetrically.
  - *Adaptation:*
    - global conventions, data-dropping operations and sign rules are "decision point B" classes;
    - a cheap tier may answer them only with an independent confirmation;
    - Foundry reports its own Cribari matrix: escalated × needed, where "needed" is defined by outcome (adjudicated wrong), NFTI-style, not by a leaf-disagreement proxy [inference].
- **Insurance underwriting authority limits and referral rules.**
  - *How the field solved it:* in accelerated underwriting, straight-through issue is bounded by knock-out referral triggers. Monitoring uses *random holdouts* that go to full underwriting. 81% of randomly audited cases kept their accelerated risk class (Munich Re, 33,000 lives, 30 programmes, via the SOA newsletter) [practice/docs].
  - *Mechanism:* authority scales with exposure: junior authority covers small face amounts [practice, unverified as a cited standard].
  - *Adaptation:*
    - each `flow.judge` leaf gets a leverage value;
    - Haiku has authority below L_H, Sonnet below L_S, and above that Opus or data confirmation is required;
    - the authority table is part of the solver's manifest and is checked statically, like E3/X7.
- **Audit materiality and assertions.**
  - *How the field solved it:* ISA 320 sets *performance* materiality below overall materiality, so that undetected misstatements *added together* stay under the threshold. ISA 450's "clearly trivial" amounts are not even accumulated [practice/docs, secondary]. PCAOB AS 2315 treats tolerable misstatement as a sampling-plan input [practice/docs].
  - *A second mechanism:* auditors test *existence* and *completeness* separately.
  - *Adaptation:*
    - per-leaf tolerances are derived from task α divided across leverage-weighted leaves (§1's ~0.3%);
    - the `rules` check gains a completeness assertion: every notes sentence with void vocabulary ("void", "must not be migrated", "do not keep", "never onboarded") must be cited by a marker or explicitly ruled out. That would have caught s206.
- **Leverage scoring (FMEA, AIAG-VDA 2019).**
  - *How the field solved it:* the handbook replaced RPN = S×O×D with an Action Priority lookup, because multiplying lets "a high severity be multiplied away" [practice/docs].
  - *Adaptation:* tier-down priority is a lookup on (leverage, cheap-tier occurrence, detection coverage), with severity dominating, rather than cost share.

### 5. Creative options
1. **Consequence-likelihood gate.** This changes the problem.
   - Treat a global read as a *hypothesis* and the data as its likelihood: posterior ∝ LLM read (prior) × consistency score (likelihood).
   - The cheap tier proposes and code confirms. Escalate only on a tie or a contradiction.
   - N3 shows this is free and perfect on d3 date order. The best place to verify a high-leverage decision is where its consequences are densest: high leverage brings high observability [inference].
2. **Leverage-weighted authority manifest** (underwriting plus FMEA AP). This is static and enforced at acceptance.
3. **Memoise strong reads keyed by sentence hash, with a stream delta check** (from laboratory practice).
   - Opus pays once per distinct convention sentence (about 59% of reads miss the cache on this bed; in a real recurring programme the notes rarely change).
   - A changed read under an unchanged hash escalates.
4. **Parameterise, don't judge.** This also changes the problem. For a recurring programme, the global read becomes **contract configuration**, settled once by the adjudicator or the owner and guarded by the delta check, instead of a per-task inference.

### 6. Experiments (ranked)

**X5-1. Consequence gate plus completeness assertion (half a day).**
- *Build:*
  - `experiments/jit/consequence.mjs`, which ports N3, scores void markers by row hits, and adds the completeness assertion;
  - `experiments/jit/audit/gate-replay.mjs`.
- *Inputs:*
  - the archived Opus `rules` values for 24 tasks;
  - fresh Haiku k=3 and Sonnet k=1 on the 24 archived `rules` prompts (about 100 calls).
- *Gate:* accept a cheap leaf iff it equals the data argmax at margin ≥ 2. Otherwise escalate.
- *Metrics:*
  - undetected wrong leaves, against Opus and against generator labels (analyst side, dev);
  - escalation rate and $/task;
  - after #42 lands, e2e oracle pass with the other judges served from the journal.
- *Baselines:* Opus-only and ungated Haiku.
- *Prereg:* dev diagnostic. Margin and LF definitions are frozen from tasks i003–i009 before i010–i023 are read.
- *Cost:* about $0.6 of Haiku and Sonnet (low quota), plus about $0.034 per Opus escalation.
- *Kill:* escalation above 60% (no saving), or any accepted cheap leaf wrong on d3.
- *Falsifier:* decisive data margins disagree with Opus on more than 1 of the d3 leaves, or the gate passes a wrong date leaf.

**X5-2. Controlled leverage screen, Morris style, at $0 (half a day; it is #42).**
- *Build:*
  - an `override` hook in flow-v3 (`FLOW_OVERRIDE=<judge>.<path>=<value>`);
  - memo replay from `journal.sqlite`;
  - `experiments/jit/leverage.mjs`, which flips each decision unit one at a time on 24 dev tasks.
- *Metrics:*
  - leverage = output leaves changed (oracle-free), with the analyst-side oracle Δ alongside;
  - an FMEA-AP table;
  - D11 rerun with the other judges replayed (expected: Sonnet loss attributable to the swap is 3, not 4).
- *Cost:* $0, no quota.
- *Kill:* journal coverage below 90% of calls.
- *Falsifier:* leverage rank fails to predict which tier-downs lose tasks. For example, if Spearman ρ < 0.3 across judges in both arms, leverage is the wrong targeting variable.

---

## B15. Kev small judges trained from traces (volume and quality)

### 1. Mechanism
- **Volume [D, sweep K1–K2]:** 695 unique judge calls across 71 names reduce to 51 Kev questions, all from `date-order`. `rules` yields 0 rows because `kevRecords` reads only top-level enums (`tierdown.mjs:88-99`).
- **Quality [D, K3]:**
  - the factory's `LABEL_SOURCES` forbid LLM labels, but trace harvest *is* LLM labels;
  - the teacher's leaf error on the cheap tiers is 3% or more per leaf (N1).
- **Surface diversity [D]:**
  - R1 has 44 label-bearing forms in 900 worlds;
  - a bag-of-words probe scores 0.885–1.000 in-family;
  - a form-clustered CI is ±27 pp (`JUDGE-PROGRAM.md` §0);
  - 0.8B composes rules badly (0.422) and loses on "none" options (0.472 vs 0.861).
- **Fit to the work:** the decisions Kev could learn are the low-leverage ones. The ones that fail are high-leverage and inferential (B5). And the stream's silent misses sit in *code with no judge* (K6).
- **Selection bias [inference]:** traces exist only where the system chose to interpret or shadow. Harvested states are therefore biased towards warmup and drift tasks, not the steady-state distribution Kev would serve.

### 2. Ideological root
The assumption is **"labels are a by-product of running."** The e2e vision has Kev replacing quota-consuming calls in arbitrary user workflows, where no generator exists. For trace-harvested data to suffice, three things would have to hold:
- the teacher is right far more often than Kev needs to be;
- harvested states cover the serving distribution;
- each programme produces hundreds of labels per port before Kev pays off.

On this repo's numbers none of the three holds. The deeper error is treating supervision as *teacher values*, when the system already owns cheaper and better supervision: the consistency checks it runs anyway (N3), adjudicated disagreements, and the stream's own stable repetitions.

### 3. Frontier
- **Industrial weak supervision.** Snorkel DryBell (Bach et al., SIGMOD 2019) turns *existing organisational resources* into labelling functions. A generative label model weights them, matching classifiers trained on "tens of thousands of hand-labeled examples", with a 52% average gain from converting non-servable resources into servable models [paper].
- **Students and teachers.** Weak-to-strong generalisation, and the finding that fidelity is not accuracy (Burns 2024; Stanton 2021), make agreement with the teacher the wrong objective [paper, via sweep].
- **Ditto and entity matching.** These favour Kev on local pairwise decisions [paper, via sweep].

### 4. Niche verticals
- **Clinical lab autoverification (CLSI AUTO10).**
  - *How the field solved it:* each lab builds its own release rules (reference ranges, QC, instrument flags, **delta checks** against the same patient's previous result) and holds the rest for a technologist [practice/docs]. Published rates are study-specific:
    - 78.8–83.7% autoverified for HbA1c, with about 2 h saved in turnaround (Biochemia Medica 2024);
    - CBC autoverification rose from 53.4% to 60% while non-conforming product fell from 0.065% to 0.0036% after the delta filter was tuned [paper].
  - *Mechanism:* per-entity history is the cheapest independent reference.
  - *Adaptation:*
    - in a recurring programme, the delta check against the *same programme's* previous reads labels Kev data for free;
    - a stable read equals the label, and a delta is a hold;
    - Kev gets a **per-programme adapter**, not only a global one [inference].
- **Accelerated underwriting holdouts.**
  - *How the field solved it:* random holdouts and post-issue audits are kept apart from targeted audits, because targeted ones "skew towards cases more likely to be misclassified" and cannot measure slippage. Earlier Munich Re work cited in the 2024 article found that post-issue audits (a cheaper proxy) show about 15% average mortality slippage, higher than the random-holdout average [practice/docs].
  - *Adaptation:*
    - Kev's evaluation set must come from a *random* holdout of compiled decisions, adjudicated by Opus;
    - flag-triggered shadows are the "targeted audits" and are biased;
    - a cheap verify-shadow is the "post-issue audit" proxy, so calibrate it against full holdouts before trusting it.
- **Weak supervision label models.**
  - *Mechanism:* treat Haiku, Sonnet and Opus outputs as *noisy labelling functions* with estimated confusion, alongside code LFs (N3 likelihood, void-row hits, X2 blocking on shared DOB or phone). The posterior is the label, and the factory's rule against LLM labels is satisfied in spirit: no single LLM is the label source.
  - *Adaptation:* this is the only label route that survives in the wild, where there is no generator [inference].

### 5. Creative options
1. **A label model over LFs plus tiers.** It replaces "teacher value = label".
2. **Kev verifies instead of deciding.** This changes the problem.
   - Train Kev to score plausibility and consistency of a proposed local fact: "does row r's date under hypothesis h match reference row s?", "is this near-pair the same entity?". These are low-leverage, high-volume and Ditto-shaped.
   - Code aggregates them, so individual Kev errors are diluted by the law of large numbers rather than amplified by the series structure.
   - Kev never decides a global read.
3. **Aim Kev at the cache-miss residual.** With B5's sentence cache, Kev's real workload is only the novel forms, which are the hardest. Measure that volume before training anything.
4. **Price Kev in quota** [D, sweep J4]. Its value is cheap-tier calls moved off the account limit, not cents.

### 6. Experiments

**X15-1. Label-model harvest (half a day).**
- *Build:* `experiments/jit/labelmodel.mjs`: about 150 lines of Dawid–Skene EM in JS, no new dependency. LFs are N3, void-row hits, the completeness assertion, X2 blocking, and the Haiku k=3, Sonnet and Opus values.
- *Metrics:*
  - labels per task by port;
  - accuracy against generator labels (dev, analyst only).
- *Baselines:* Opus value as the label, and generator-only.
- *Prereg:* LF set frozen before scoring.
- *Cost:* shares X5-1's calls, about $0 extra.
- *Kill:* coverage below 3 labels per task, or accuracy more than 2 pp below Opus-as-label on R1/R3.
- *Falsifier:* if the label model never beats the best single source, weak supervision adds nothing here and the factory stays the only Kev source.

**X15-2. Novel-form residual study (half a day).**
- *Build:* simulate a 300-world R1/R3 stream from the factory with an Opus read cache keyed by masked sentence. Record the novel-form rate against stream position, and Haiku accuracy (and stock Kev, through the bridge `audit-archive` job) on novel forms vs cached forms, using generator labels.
- *Cost:* about $1.5 for one Opus read per distinct form (about 44 forms × $0.034), about $0.3 of Haiku, laptop hours for Kev.
- *Kill:* if the novel-form rate after 50 tasks is below 5%, Kev for global reads has no workload. Stop and keep Kev on X2 pairs.
- *Falsifier:* if Kev's novel-form accuracy beats Haiku's, there is a case for Kev on reads after all; the prediction is that it will not.

---

## B16. The router and slider deciding interpret, run or compile under uncertainty

### 1. Mechanism
- **The router has no quality term.**
  - `router.mjs` `decide()` compiles only when `expectedRemaining × (agentCost − compiledCost) ≥ payback × compileCost`.
  - It has no p(success), no value of a success V, and no uncertainty. Its defaults are a $3 compile and a $0.05 compiled run.
- **On records it would pick the worse option.**
  - At slider 0.5 against the Haiku agent ($0.103/task), the savings are 21 × $0.053 = $1.1, below $4.5, so it interprets with Haiku: 15/24.
  - The JIT S/H arm scored 22/24 [M, from D10 numbers].
- **On kinetics it is right for the wrong reason.**
  - It also declines to compile against the Haiku agent: 17/24 for $2.10, while the JIT arms cost $12–18 for 8–17 tasks [M, `results.jsonl`].
  - The choice is correct only because cost alone happens to coincide with value there.
- **The slider is implemented as process knobs, not as value.**
  - In `decide()` it sets warmup, payback and shadow rate.
  - THESIS defines the slider as "the dollar value of one verified success".
  - `stream.mjs` does not import the router at all: `DEFAULT_JIT` is fixed, line 23 [M grep].
- **Missing counterfactuals.** The outcomes of the mode not chosen are never observed, so every estimate it could learn is selection-biased.

### 2. Ideological root
The assumption is **"routing is cost arithmetic once quality is equal."** In the e2e vision quality is *not* equal, and it is not observed:
- compiled code can beat its interpreter (22 vs 13 on records);
- the Opus agent beats both;
- silent misses are invisible without random audits.

For v0's rule to hold, every mode would have to share one known success rate. Routing is really a sequential decision under uncertainty: a value-of-information and exploration problem with a value-of-success objective.

### 3. Frontier
- **Learning-augmented ski rental.** Purohit, Svitkina and Kumar (NeurIPS 2018) use predictions in *ski rental*: rent = interpret, buy = compile. The algorithms improve with prediction quality and degrade boundedly when predictions are bad, with a trust parameter trading consistency against robustness [paper; exact bounds not checked this pass]. That trust parameter *is* a principled slider for the compile decision.
- **Knowledge gradient.** Frazier, Powell and Dayanik (SIAM J. Control Optim. 2008) choose the measurement with the largest expected value-of-information increment. It is optimal at a one-step horizon and in the limit [paper]. Here: "one more trace, one more shadow, or commit".
- **Partial EVPI.** Strong, Oakley and Brennan (Med Decis Making 2014; review in arXiv 1507.02513) estimate partial EVPI by regression on a probabilistic-sensitivity-analysis sample, to rank which uncertainty is worth resolving [paper].

### 4. Niche verticals
- **Credit scoring reject inference.**
  - *The problem:* the outcomes of rejected applicants are never observed. Hand and Henley argued, per secondary sources, that the only robust remedy is to *accept a random sample of rejects* (Banasik and Crook; Hand and Adams 2014) [paper, secondary].
  - *Adaptation:* keep ε-random *reverse shadows*, running the compiled solver on interpreted tasks.
  - *Why this is the cheap direction:* $0.008–0.04 per task, against $0.3–0.5 for a forward shadow. Propensities are logged so the router learns p(compiled ok) without bias.
- **Acceptance sampling (ANSI/ASQ Z1.4, MIL-STD-105E).**
  - *How the field solved it:* switching rules on a continuing stream of lots [practice/docs]:
    - normal → tightened after 2 of 5 lots are rejected;
    - tightened → normal after 5 consecutive accepts;
    - normal → reduced after 10 accepts;
    - reduced → normal on 1 reject.
  - *Adaptation:* the shadow rate becomes a state machine driven by adjudicated outcomes. Reduced inspection is earned; tightened is triggered. This replaces the static `shadowBase + shadowGain·disagree`.
- **Underwriting appetite.** The owner states an appetite (V, α, quota envelope). The router *quotes* each task (mode, expected cost, estimated risk class), and a referral is any quote outside the appetite [inference from AUW practice].
- **Triage asymmetry.** An explicit 9:1 ratio of over- to under-escalation tolerance (Kaiser ESI data) sets α and the over-shadow budget jointly.

### 5. Creative options
1. **V-aware Bayesian router.**
   - It chooses argmax over modes of V·p̂ − E[cost].
   - p̂ is a Beta posterior per (shape, mode), fed only by random holdouts and reverse shadows.
   - Compiling is ski rental with predictions, with λ set by the slider.
2. **The router buys evidence; it does not choose modes.** This changes the problem.
   - Compiled runs cost about 1% of interpretation, so always run the compiled solver (when it exists) and always log it.
   - The router's only decision becomes *how much verification to buy*, by knowledge gradient over (shadow, verify-shadow, consequence check, Opus field query).
   - Interpretation is then a verification purchase, not a mode.
3. **Three instruments** (underwriting): random holdout (monitoring), targeted audit (protection) and reverse shadow (counterfactual). Each has its own budget line, and only the first feeds the reported silent-miss rate.
4. **Z1.4 switching** as the slider's dynamics, with V and α as the slider's statics.

### 6. Experiments

**X16-1. V-aware router replay ($0, half a day).**
- *Build:*
  - `experiments/jit/router-v1.mjs` (Beta posteriors, ski rental with λ ∈ {0.25, 0.5, 1}, V ∈ {0.1, 1, 10});
  - `router-replay.mjs` over archived records and kinetics arms plus the CALIBRATION families, using agent-arm rows as interpret outcomes and JIT rows as compiled outcomes. Compile decisions are restricted to indices with observed outcomes.
- *Metrics:* net value Σ(V·pass − cost), regret against the best fixed arm in hindsight, and a quota proxy in Opus-equivalent tokens.
- *Baselines:* v0 and every fixed arm.
- *Prereg:* grids and priors frozen; dev diagnostic.
- *Kill:* v1 regret ≥ v0 at V=1 on both families.
- *Falsifier:* the best fixed arm beats v1 on every family at every V. Then routing adds nothing at a 24-task horizon, which is Dekoninck's poor-estimator regime, and the router should wait for X16-2's estimators.

**X16-2. Instrument split and switching schedule (half a day, about $1).**
- *Live part:* reverse-shadow the archived S/H v1 and O/H v2 solvers on all 24 dev inputs, if X1's replay is not ready.
- *Offline part:* simulate, on archived data with the oracle as evaluator only, three shadow policies:
  - fixed `shadowEvery` 4;
  - Z1.4 switching;
  - ε ∈ {0.05, 0.1} random holdout plus targeted flags.
- *Metrics:*
  - detection latency of the first silent miss;
  - shadow $ and quota;
  - bias and CI coverage of the IPW silent-miss estimate.
- *Kill:* switching gives no spend reduction at equal latency.
- *Falsifier:* the random-holdout CI fails to cover the true dev miss rate (6/24, sweep F1). That would mean the estimator is unusable at stream scale.

---

## How the three blockers interact

All three lack the same object: **a per-decision record of (leverage, tier, check and consistency coverage, random-audit outcome)**. Without it, each blocker drifts to its own proxy:
- tier-down (B5) uses leaf agreement with a teacher;
- Kev (B15) uses teacher values as labels;
- the router (B16) uses cost, with quality assumed equal.

The three proxies share one fallacy: agreement with whatever answered first. They are also coupled through selection bias:
- the router decides which paths get observed;
- that sets which states become Kev data, and which judges ever get a leverage measurement;
- tier-down then changes the cost the router sees.

Two mechanisms cut the loop:
- **Consequence checks (N3).** They are free, independent and strongest exactly where leverage is highest. They gate B5, label B15 and feed B16's p̂.
- **A random-holdout floor with reverse shadows.** It gives unbiased estimates to all three.

Economically, B5 sets the compiled cost floor: Opus `rules` is about 90% of S/H compiled cost. B15 decides whether a tier below Haiku exists at all. B16 can only route as well as the other two estimate. The build order is therefore X5-2 (replay and leverage), then X5-1 and X15-1 (shared calls), then X16-2, then X16-1. Kev training waits on X15-2's kill rule.

---

### Sources
**Opened or seen in search this pass**
- [paper] Purohit, Svitkina, Kumar, *Improving Online Algorithms via ML Predictions*, NeurIPS 2018. https://proceedings.neurips.cc/paper/2018/hash/73a427badebe0e32caa2e1fc7530b7f3-Abstract.html
- [paper] Frazier, Powell, Dayanik, *A Knowledge-Gradient Policy for Sequential Information Collection*, SIAM J. Control Optim. 47(5), 2008. https://optimallearning.princeton.edu/Papers/Frazier%20Powell%20-%20Knowledge%20gradient%20policy.pdf
- [paper] Heath, Manolopoulou, Baio, *A Review of Methods for the Analysis of the Expected Value of Information*, 2015. https://arxiv.org/abs/1507.02513. Also Strong, Oakley, Brennan 2014: https://eprints.whiterose.ac.uk/id/eprint/87841
- [paper] Verma, Barrejón, Nalisnick, *Learning to Defer to Multiple Experts*, AISTATS 2023. https://proceedings.mlr.press/v206/verma23a.html
- [paper] Morris, *Factorial Sampling Plans for Preliminary Computational Experiments*, Technometrics 33(2), 1991. https://abe.ufl.edu/faculty/jjones/ABE_5646/2010/Morris.1991%20SA%20paper.pdf
- [practice/docs] R `sensitivity::morris`: https://rdrr.io/cran/sensitivity/man/morris.html
- [paper] Bach et al., *Snorkel DryBell*, SIGMOD 2019. https://arxiv.org/abs/1812.00417
- [practice/docs] SOA, *Accelerated Underwriting: Mortality Slippage Study and Monitoring Best Practices*, 2024. https://www.soa.org/sections/product-dev/product-dev-newsletter/2024/august/pm-2024-08-seeman/
- [practice/docs] SOA, *AUW Reinsurer Practices Survey*: https://www.soa.org/sections/reinsurance/reinsurance-newsletter/2024/february/rsn-2024-02-klein/
- [practice/docs] Munich Re: https://munichre.com/us-life/en/perspectives/2024/mortality-slippage-study-and-monitoring-best-practices.html
- [practice/docs] AHRQ *ESI Handbook*: https://emscimprovement.center/documents/2177/Emergency_Severity_Index_Handbook.pdf
- [paper] *Evaluation of the ESI in US EDs for the Rate of Mistriage*, JAMA Netw Open 2023. https://pubmed.ncbi.nlm.nih.gov/36930151/
- [paper] Taipei trauma activation study (ACS <5% / <35% benchmarks): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11752106/
- [paper] *Cribari, does it apply in real time?*: https://scholarlycommons.pacific.edu/cop-facarticles/897
- [practice/docs] PCAOB AS 2315: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2315
- [practice/docs] AU 350.18: https://pcaobus.org/Standards/Auditing/Pages/AU350_18.aspx
- [practice/docs] ISA 320 performance materiality, secondary only, IAASB text not opened: https://www.accountingweb.co.uk/practice/general-practice/performance-materiality-whats-all-that-about
- [practice/docs] AIAG-VDA Action Priority vs RPN: https://www.pharmaceuticalonline.com/doc/is-it-time-to-say-goodbye-to-fmea-risk-priority-number-rpn-scores-0001
- [practice/docs] CLSI AUTO10: https://clsi.org/shop/standards/auto10/
- [paper] HbA1c autoverification, Biochemia Medica 2024: https://hrcak.srce.hr/en/321338
- [paper] CBC autoverification (Colombia): https://www.redalyc.org/pdf/3935/393542989003.pdf
- [practice/docs] Z1.4 / MIL-STD-105E switching rules: https://www.sqconline.com/switching-rules-mil-std-105e-z14 ; https://asq.org/quality-press/display-item?item=T1164
- [paper] Banasik and Crook, reject inference: https://cer.business-school.ed.ac.uk/wp-content/uploads/sites/55/2017/02/workingpaper03_2-1.pdf
- [paper] Hand and Adams 2014: https://ideas.repec.org/a/pal/jorsoc/v65y2014i3p408-415.html
- Hand and Henley 1993: seen only through secondary descriptions (**unverified**).

**Via the prior sweep** (verified there, not re-opened): Dekoninck et al. 2025; Jung et al. (Trust or Escalate) 2025; Jitkrittum et al. 2023; Burns et al. 2024; Stanton et al. 2021; Ditto (Li et al. 2021).

### Repo paths
- `/home/user/workflow-foundry/experiments/jit/{router.mjs,stream.mjs:23,tierdown.mjs:88-99,tierdown-e2e.mjs}`
- `/home/user/workflow-foundry/experiments/runs/jit/jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5/versions/v1-haiku55/solve.mjs:262-301`
- `/home/user/workflow-foundry/research/jit-20261008/{DEV-NOTES.md,tierdown/live-rules-*.json,CALIBRATION.md}`
- `/home/user/workflow-foundry/research/kev-20261007/JUDGE-PROGRAM.md` §0
- `/home/user/workflow-foundry/experiments/runs/jit/jit-dev-kinetics-1/*/results.jsonl`
- Scratch script: `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/cb/xsource.py`

## Agent result 7

# Discovery and meta cluster: B14 (replicating hand-built workflows) and B18 (a compiler that improves itself)

*Written 2026-10-09 from a read-only pass over the repo. All repo numbers are development evidence from K=1 dev streams. Tags used below:*
- **[repo]** measured or documented in this repo, with a path;
- **[paper]** or **[practice/docs]** an external source, cited by URL;
- **[inference]** my reasoning.

*The frontier sweep (FRONTIER-GAPS, journal `wf_d0427e6d-ceb`) already covers these, so they are not repeated here:*
- ADAS, AFlow, GEPA, ACE, DGM, AlphaEvolve, Voyager, ASI, SkillWeaver, AWM and Reflexion;
- TheAgentCompany;
- the "Recompile is self-improvement" critique (Huang, Olausson, Tyen, Shumailov).

*None of the verticals below appear in that sweep: process mining, RPA, product lines, program repair, continual learning, adaptive data analysis, compiler validation and lexicase/MAP-Elites.*

---

## B14. Replicating real users' hand-built complex workflows, and reaching a durable state equal to or better than the human version

### 1. Mechanism (why it is blocked today)

1. **No arm has run on any replication item.**
   - R-bench has 5 pilot harnesses and 0 arm runs. The 1,559-item corpus has 0 items compiled and 0 executed [repo: research/replicate-20261008/DESIGN.md §0; research/corpus-20261006/COVERAGE.md header].
   - The JIT line never touches the corpus. The critique lists this as "Replicating real users' workflows has gone quiet" [repo: journal r23 #10].
2. **The expensive part is replicating the oracle, not the workflow.**
   - Each pilot harness cost about **$11 and 66 agent-minutes**: a Sonnet build ($6.2) plus an Opus adversarial verify ($4.6) [repo: DESIGN §0.8, §7].
   - Verification changed every item:
     - **18** classes of wrong solution passed oracle v1;
     - **11** correct designs failed v1;
     - **5** wrong-solution classes still pass after v2 (DESIGN §2.1).
   - Every pilot wrote its own interpreter of the original platform: two n8n executors, an HA engine, a Galaxy emulator, a YAML subset and a bash runner (L10).
   - Platform semantics recalled from memory were wrong. The HA repeat rule is the example (L3).
3. **The task shapes do not fit the JIT model.**
   - 4 of the 5 pilots need triggers, durable waits, human steps or effects (DESIGN §6.2).
   - `flow.mjs` is a pure function from `task.json` to `flow.done` (SPEC §2). It has no effect, wait or approval primitive [repo: journal r02 H2].
4. **D10 forbids the interpreter.**
   - No executor may read third-party text (THESIS D10, default no).
   - The JIT interpreter is a Claude Code executor, so it cannot legally interpret R-bench items (r02 H5).
   - Builders may read the text only under D15: provenance taint, no effects, no egress.
5. **"Durable and equal or better" has no operational definition for replication.**
   - `durability.mjs` measures whether a JIT arm's compiled path settles, using the oracle view or shadow agreement [repo: experiments/jit/durability.mjs header].
   - R-bench measures one-shot pass, CPS_N and T3 ratios (DESIGN §5).
   - Nothing measures whether a replica stays equivalent to the human's version over the original's natural run cadence.
   - The original itself is not a fixed point either. The pilots found **22 candidate defects in the originals** (n8n:20281 alone has 8: non-idempotent Jira retry, an unreachable error branch, unescaped Slack text) (§2.2). "Equal" and "better" pull in opposite directions on exactly those cases: T1 fidelity versus T3 intent.
6. **Latency structurally disfavours Foundry on small jobs.** Foundry takes 1.1–2.5 s per run against 0.19–0.37 s for the original bash, so **0/14** runs met the T3 latency target (L9).
7. **Recall contaminates rebuilds.** All pilot sources are public, and only 5 of the 30 selected items post-date the builder cutoff (DESIGN §9).

**Net mechanism [inference].** Replication needs four things, and every one is currently hand-made per item by frontier agents:
- (a) a behavioural spec of the original;
- (b) a world in which to run it;
- (c) an equivalence relation that forgives benign differences;
- (d) a durability horizon.

That puts the marginal cost of one replication item at about $11 of frontier time *before any candidate runs*. It is the same price tag as the problem being solved.

### 2. Ideological root

**Assumption:** replication means *rebuild from a description or definition, then score once against a hand-built oracle*. That is the C0 construction frame carried over to real workflows: T1, T2 and T3 are each one build followed by one hidden battery.

**Why it fails against the full vision [inference].** THESIS-JIT §2.1 already reframed workflows as "a cache of work you have already done". For a real user's workflow, the human has already done the work. The running original is simultaneously:
- the reference implementation (the interpreter);
- the trace source (its execution logs);
- the incumbent the replica must beat.

R-bench treats it only as a text to translate and a behaviour to emulate in a mock. The vision says "equal to or better than the human version, durably". That is a *relation between two running systems over time*, not a property of one artifact on one battery.

**What would have to be true for the current assumption to hold:**
- authors' descriptions suffice to rebuild intent (the T2 sufficiency check exists because they often do not);
- mocks are faithful (L3 says they are not);
- the oracle is independent of the builder (one model family built and verified every harness, §9);
- a battery written once predicts behaviour over months of real runs (C0 showed that probes did not predict evaluation: 9/9 construction defects came from cases no probe contained [repo: construction-20261006/REPORT-dev.md]).

None of these hold in the pilots.

### 3. Frontier (own field: workflow and SOP understanding)

- **WONDERBREAD** (Wornow et al., Stanford, NeurIPS 2024 D&B; https://hazyresearch.stanford.edu/wonderbread-website) **[paper]**.
  - Data: 2,928 demonstrations of 598 real workflows.
  - Foundation models recall about **88%** of the steps when *documenting* a workflow from a demonstration, but score **F1 < 0.3** when *validating* whether an execution completed the workflow.
  - This is the same asymmetry Foundry hit: writing the SOP is easy and checking conformance is hard. It argues against having LLMs write the replication oracle.
- **PatchDiff / "Are 'Solved Issues' in SWE-bench Really Solved Correctly?"** (Wang, Pradel, Liu, ICSE 2026; https://arxiv.org/abs/2503.15223) **[paper]**.
  - 29.6% of plausible patches behave differently from the ground truth under differential testing.
  - 28.6% of those divergent patches are certainly incorrect.
  - Reported solve rates are inflated by 6.2 points.
  - Transfer: replication equivalence should be judged by *differential execution against the original*, not by a fixed battery.
- **Robotic process mining and SmartRPA** are covered below as verticals.

### 4. Niche verticals

**(a) Process mining: discovery, conformance and Celonis practice.**
- **How the field solved it.**
  - Process models are discovered from event logs, not specified. The Inductive Miner guarantees a *sound, fitting, block-structured* model in polynomial time and states when the result is language-equivalent to the generating process (Leemans, Fahland, van der Aalst, PETRI NETS 2013, https://vdaalst.com/publications/p719.pdf) **[paper]**.
  - Model quality is four-dimensional: fitness, precision, generalization and simplicity. "It only makes sense to consider precision, generalization and simplicity if the replay fitness is acceptable" (Buijs, van Dongen, van der Aalst, IJCIS 2014, https://vdaalst.com/publications/p801.pdf) **[paper]**.
  - Conformance checking aligns observed traces against a model and itemises each deviation (Carmona, van Dongen, Solti, Weidlich, *Conformance Checking*, Springer 2018, https://link.springer.com/book/10.1007/978-3-319-99414-7) **[paper]**.
  - Celonis's Conformance Checker lists both "observed behavior the model does not permit" and "modeled behavior that never occurs". A user can **allowlist** a violation class so it stops counting against the conformance ratio (https://docs.celonis.com/en/conformance-checker.html) **[practice/docs]**. The docs and the community forum disagree on how allowlisted violations enter the calculation (unverified which is current).
- **Transferable mechanism.** Equivalence is replay fitness of the candidate's event log against the original's log. "Better" is a set of *named, approved deviations*, not a free-form score.
- **Exact adaptation for Foundry.**
  1. Emit an object-centric event log, with one event per effect (`{case, activity, object ids, payload hash, t}`). Emit it from two sides:
     - the engine journal and the JIT trace (Foundry side);
     - each pilot's existing original interpreter (original side, L10). Those interpreters already exist at no extra cost.
  2. Conformance is an alignment over each case's ordered effect sequence: an edit distance with typed move costs, own code in Node. PM4Py is AGPL-3.0 (https://pypi.org/project/pm4py), so do not vendor it. Use it at most as an offline reference.
  3. "Equal" means replay fitness ≥ τ on the core scenarios and precision ≥ τ, so the replica does no extra effects.
  4. "Better" means every deviation falls into an **allowlisted improvement class**. Each class is tied to one of the 22 documented original defects, for example "no duplicate Jira create on retry", and is approved by the owner before the run (H4's contract-first rule).
  5. This replaces the hand-written oracle for T1 fidelity. The oracle work then shrinks to the allowlist and the intent probes.

**(b) Robotic process automation and task mining.**
- **How the field solved it.**
  - Robotic process mining discovers automatable routines from UI interaction logs: segmentation, then simplification, then routine identification, then script generation (Leno, Polyvyanyy, Dumas, La Rosa, Maggi, BISE 2021, https://ideas.repec.org/a/spr/binfse/v63y2021i3d10.1007_s12599-020-00641-4.html) **[paper]**.
  - SmartRPA generates *executable* RPA scripts from UI logs. The 2022 follow-up handles **unsegmented** logs, which means working out which actions belong to which routine (Agostinelli, Lupia, Marrella, Mecella, BPM 2020 RPA Forum, https://research.uniroma1.it/node/48233) **[paper]**.
- **Transferable mechanism.** Segmentation and routine identification come *before* synthesis, and frequency in the log decides what is worth automating.
- **Exact adaptation.**
  - The owner's own agent session history (decision O7 in r23) is a UI-equivalent log.
  - Segment it into recurring routines, using the router's recurrence feature (G2 shape census), before choosing what to replicate.
  - This fixes the blind spot that R-bench covers "jobs people built" and not "jobs the owner repeats" (DESIGN §0.12).
  - It needs owner sign-off: the census is owner data, read-only.

**(c) Legacy modernization: strangler fig plus parallel run (GitHub Scientist).**
- **How the field solved it.**
  - Strangler fig replaces a running system piecemeal while it stays in service (Fowler, https://martinfowler.com/bliki/StranglerFigApplication.html) **[practice/docs]**.
  - GitHub's Scientist pattern runs the old path (control) and the new path (candidate) on live inputs, compares them, records mismatches and timings, and **always returns the control's result** (https://pypi.org/project/laboratory/0.4.0, Python port of github/scientist) **[practice/docs]**.
- **Transferable mechanism.** Equivalence is earned on *real* inputs over time. The incumbent is the oracle for fidelity, and promotion follows a mismatch-free window.
- **Exact adaptation.**
  - Run the replica as a shadow candidate behind the human workflow. In R-bench this means the pilot's original interpreter on generated event streams. On real owner workflows it would need owner sign-off and D10 review.
  - Mismatches become the JIT's deopts and regression cases.
  - `durability.mjs`'s time-to-durable applies unchanged, with "agrees with control, or deviation allowlisted" in place of the oracle pass.

**(d) Software product lines: clone-and-own variability mining.**
- **How the field solved it.** BUT4Reuse mines features, their locations and their constraints *bottom-up from existing product variants* (Martinez, Ziadi, Bissyandé, Klein, Le Traon, SPLC 2015, https://hal.archives-ouvertes.fr/hal-01214869) **[paper]**.
- **Transfer.**
  - The corpus is full of clone-and-own variants: 135 n8n items, many forked from templates, plus GitHub Actions and Airflow examples [repo: COVERAGE.md §2].
  - Replicate a *family*: mine the common core and its variation points, then build one parameterised Foundry workflow plus a feature model.
  - The feature model *is* the reuse domain of validity (THESIS-JIT §6.7). A new variant inside the feature model reuses the core; one outside it is refused.

### 5. Creative options

1. **Invert the problem: replication as parallel-run distillation, not rebuild** (this changes the problem).
   - The original is the T0 interpreter. Its I/O and effect logs are the traces. Foundry compiles from those logs, so no description is needed and recall matters less.
   - It is promoted by conformance plus a mismatch-free window.
   - This also sidesteps D10 for the interpreter role: no Claude executor reads third-party instructions. Only the builder reads data under D15 taint.
   - "Better than human" becomes a strangler step: once fidelity is durable, apply one allowlisted improvement at a time, each with its own mismatch window.
2. **Turn harness interpreters into discoverers.**
   - The five ad-hoc interpreters (L10) already produce effect sequences. Feed generated scenario logs through an inductive-miner-style block-structure discovery: sequence, xor, parallel and loop map to IR `seq`, `branch`, `map` and `retry`.
   - The result is a *sound-by-construction* IR skeleton, the C-det converter of DESIGN §6.1 obtained without hand-writing one.
   - Model nodes fill only the data transforms the miner cannot express.
3. **Make "better" a Pareto front, not a scalar.**
   - Keep a MAP-Elites archive of replicas over (fidelity-conformance, external calls, model $, latency net of overhead).
   - "Equal or better" means the human's point is weakly dominated (Mouret & Clune 2015, https://arxiv.org/abs/1504.04909) **[paper]**.
   - The L9 latency penalty becomes visible as one axis instead of a 0/14 failure.
4. **Use the defect ledger as the curriculum.**
   - The 22 candidate original defects become flaw suites (injected redelivery, concurrent edit, missing field).
   - "Durable" means zero new deviations on core scenarios plus monotone improvement on the flaw suites across versions.

### 6. Experiments (ranked)

**E14-1. Conformance evaluator against the hand-built oracles ($0, about 4–6 h, dev only).**
- **Build:** `experiments/replicate/conformance.mjs` (event-log extraction from each item's `original-emulator` / `controls` / `reference` / `independent-solve` outputs, plus typed-alignment fitness and precision) and `conformance.test.mjs`.
- **Inputs:** existing controls on dev seeds 0–27. These are burned, which is fine for a diagnostic.
- **Metric:** classification of {reference, alternative designs, the 11 v1-rejected correct designs} versus {broken controls, the 18 v1 wrong classes, the 5 residual wrong classes} at a threshold frozen *before* scoring. Where wrong classes exist only as prose, encode them as controls first; this is dev work.
- **Baseline arm:** oracle v1 verdicts (29 errors in total) and v2 (5 residual).
- **Preregistration:** a frozen τ and move costs in a dev note. No claim follows.
- **Kill rule:** the evaluator misclassifies more designs than oracle v1, or it cannot express a pilot's effects (Galaxy tables may need a per-case output-diff event).
- **Falsifies:** "generic effect-log conformance can replace most per-item oracle authoring". If it holds, the $11/item harness cost should drop by roughly the $4.6 verify share [inference].

**E14-2. Parallel-run JIT replication on two pure-ish items (about $15–30 in model spend, 1 day; needs owner sign-off under D10/D15).**
- **Items:** Galaxy (native, shipped data) and selenium (real bash control).
- **Setup:**
  1. Stream 24 generated instances: dev seeds 9001+, then 8 at a higher difficulty or variant as drift.
  2. The "interpreter" is the original (emulator or bash), and its outputs are the traces.
  3. A Haiku builder (prompt v3, `policy/models.json` ids only) compiles `solve.mjs` from those traces.
  4. Shadows compare against the original by conformance (E14-1).
- **Metrics:**
  - time-to-durable, from `durability.mjs` with the conformance agreement in the system view;
  - fidelity pass on fresh test seeds 10001+ generated at freeze;
  - CPS_N at N = 1, 10 and N_item.
- **Baseline arms:** R-bench T1 F-opus→haiku and B0-haiku (DESIGN §4), on the same instances.
- **Preregistration:** required before any test-seed read. Use the rbench-r1 skeleton (§10), K=2 lineages, and treat gaps under 3 points as noise.
- **Kill rule:** on dev, the compiled replica fails to reach a mismatch-free window of 6 within 16 instances on either item.
- **Falsifies:** "the original is a sufficient interpreter for distillation".
- **Cost basis:** Haiku records compiles cost $0.27–2.19 [repo: compile.json].

**E14-3. Variant-family census ($0, about 2 h).**
- Cluster the corpus normalized graphs by template lineage and graph edit distance. Count families with ≥ 3 variants that have a shipped oracle (n8n has 25 with oracles, Airflow 69 [repo: COVERAGE §2]).
- **Kill rule:** fewer than 10 families. Then option (d) has no material, and the product-line vertical is parked.

---

## B18. The compiler improving itself from its own failure history

### 1. Mechanism

1. **Today's improvement loop is a human reading oracle diffs.**
   - D1–D12 were diagnosed by reading the dev oracle's per-field mismatches [repo: DEV-NOTES preamble].
   - They became prompt v2 (near-threshold judge, flags), v3 (near-miss scan, quotes, deopt reading), `flow-v2.mjs` and strict acceptance by hand [repo: experiments/jit/prompts.mjs:6–16].
   - In the wild, no oracle exists to diagnose from.
2. **The failure history is tiny and narrow.**
   - It holds **21 compile records**: 8 roots and 13 recompiles, over **2 families** (records and kinetics), for **$44.30** of compile spend [repo: `experiments/runs/jit/*/*/versions/*/compile.json`, recomputed].
   - Kinetics never compiled well: **no kinetics compile exceeded 0.547 mean partial agreement** with its own traces, across 11 attempts and both builders.
   - Records lineages diverge: 22/24 vs 18/24 on the same setup (D12).
   - The sweep already warned that about 10 histories will overfit (r20 row 42).
3. **Recompile is optimised toward a gameable target.**
   - "No deopt on any case" rewarded guard widening.
   - D9: O/H v2 answered 24/24 in the N-version probe and failed 5 of 7 drift tasks.
   - Reject-if-worse looked only at old labelled cases.
   - The heal subsystem has the right constraints (no check removal, a literal-leak scan, add-only without an oracle [repo: heal DESIGN §11]), but recompile does not inherit them.
4. **Integrity noise is in the history itself.** `hiddenPathAttempts` is nonzero on **11 of 21** compile records, with **41** attempts in total (records H/H v3 alone: 17) [repo: compile.json, recomputed]. Learning from those histories without screening them means learning from contaminated episodes.
5. **Lessons do not generalise by construction.** Heal's lessons L-1 to L-3 "describe those artifacts and predict nothing" until they fire on artifacts built after they were frozen [repo: heal DESIGN §10].
6. **No ledger links diagnosis, change and effect.** `compile.json` has `promptSha256`, `traceIds` and `parentSha`, but no record of which diagnosis motivated a prompt change and no counterfactual score of the change on earlier histories.

### 2. Ideological root

**Assumption:** improvement is *accumulating a fix per observed failure*, judged on the cases that motivated it. That is monotone patching evaluated on its own training set.

It hides three further assumptions:
1. fixes compose without interference (D9 shows a fix to D3 caused a new silent-failure mode);
2. the evaluation set can be reused adaptively without leaking;
3. the failure signal available in development (the oracle) exists in production.

For the maximalist vision, "self-improving" means the system gets better on *future, unseen* workflows from *system-observable* failures: deopts, shadow disagreements, adjudications and owner overrides.

**What would have to be true:**
- enough independent compile histories across many families that a held-out slice stays fresh;
- fixes evaluated for backward transfer (no regressions on old histories);
- a failure signal the runtime can see.

Today none holds. It is 2 families, there is no backward-transfer check, and the signal is oracle-derived.

### 3. Frontier (own field: self-improving program generators)

- **STOP** (Zelikman, Lorch, Mackey, Kalai, COLM 2024; https://arxiv.org/abs/2310.02304) **[paper]**.
  - A scaffold improves its own improver code against a utility function, and the improved improver beats the seed.
  - The paper *measures how often generated code bypasses its sandbox*. That is the analogue of our 41 hidden-path attempts, and it says to track integrity as a first-class metric of self-improvement.
- **FunSearch** (Romera-Paredes et al., Nature 625, 2024; https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10794145/) **[paper]** and **OpenEvolve** (https://github.com/codelion/openevolve; island populations plus a MAP-Elites archive per its README, unverified) **[practice/docs]**.
  - Both rest on the same premise: progress comes from an LLM proposer *paired with a systematic, trusted evaluator*.
  - The evaluator is the asset. Foundry's evaluator for compilers today is a K=1 live stream plus a human reading the oracle.

### 4. Niche verticals

**(a) Program repair benchmarks: plausible versus correct.**
- **How the field met it.**
  - Defects4J supplied a database of real bugs, each with an exposing test, so repair studies became reproducible (Just, Jalali, Ernst, ISSTA 2014, https://people.cs.umass.edu/~rjust/publ/defects4j_issta_2014.pdf) **[paper]**.
  - Qi, Long, Achour and Rinard showed that most reported GenProg/RSRepair/AE patches were not correct. The overwhelming majority were "equivalent to a single modification that simply deletes functionality", and **Kali**, which only deletes, matched them (https://www.cs.toronto.edu/~fanl/papers/kali-issta2015.pdf) **[paper]**.
  - Smith, Barr, Le Goues and Brun: patches judged on *independent* tests rarely improve, and patch quality tracks repair-suite coverage (FSE 2015, https://www.cs.washington.edu/homes/brun/pubs/pubs/Smith15fse.pdf) **[paper]**.
- **Transfer.** D9's widened guard is a Kali patch: it deleted the refusal behaviour to make deopts disappear.
- **Exact adaptation.**
  1. A **deletion-equivalence detector** on recompiles: AST-diff `solve.mjs` v(n) against v(n−1) for removed or loosened `flow.guard` / `flow.invariant` / check predicates and widened profile ranges. Any such edit needs strong-tier confirmation on the refusal replay set (task #41).
  2. Compiler changes are scored on held-out compile histories that did *not* motivate them (Smith's independent tests).
  3. Build a **Foundry-Defects4J**: every system-observed failure (a deopt, a shadow disagreement that adjudication confirmed) is frozen as (trace set, failing input, parent solver) and becomes a reproducible compiler test case.

**(b) Continual learning: catastrophic forgetting.**
- **How the field solved it.** GEM keeps an episodic memory of past tasks and accepts an update only if the loss on that memory does not rise. It also introduced the **backward-transfer (BWT)** and forward-transfer metrics (Lopez-Paz & Ranzato, NeurIPS 2017, https://arxiv.org/abs/1706.08840) **[paper]**.
- **Transfer.** Accept an improvement only under a non-regression constraint on memory, and report BWT separately from new-task gain.
- **Exact adaptation.**
  - The compiler's episodic memory is the compile-history ledger: every (family, trace set, regression set) with its frozen evaluation tasks.
  - A candidate compiler change (prompt, SDK or acceptance rule) is adopted only if:
    - BWT ≥ 0 on every memory slice, per slice and not on average (the D12 lineage variance makes averages meaningless);
    - forward transfer is > 0 on new histories.
  - This is task #41's refusal-preservation rule lifted from versions of one solver to versions of the compiler.

**(c) Adaptive data analysis: the reusable holdout.**
- **How the field solved it.** Reusing a holdout adaptively overfits it. Answering holdout queries through a differentially-private mechanism lets the holdout be reused safely many times (Dwork, Feldman, Hardt, Pitassi, Reingold, Roth, *Science* 349:636, 2015, as cited in https://www.cs.columbia.edu/~toni/publications.html) **[paper; I did not open the full text, and the Thresholdout details are unverified]**.
- **Transfer.** With about 20 histories, every look at "held-out compile histories" (THESIS-JIT §6.10) spends validity.
- **Exact adaptation.**
  - The compiler-improvement loop sees held-out histories only through a thresholded or noised accept/reject interface with a fixed query budget.
  - Heal already sends back "only an accept/reject bit" (heal DESIGN §11.2). Extend that to compiler search and log every query against a budget in the seed ledger.

**(d) Evolutionary program search: lexicase selection and quality-diversity.**
- **How the field solved it.**
  - Lexicase selection filters candidates on test cases one at a time, in random order, instead of on an aggregate score. That keeps *specialists* alive and population diversity high on "uncompromising" problems, where every case must pass (Helmuth, Spector, Matheson, IEEE TEC 2015, https://www.cs.hamilton.edu/~thelmuth/Pubs/lexicase-IEEETEC-2014.pdf) **[paper]**.
  - MAP-Elites keeps the best candidate per cell of behaviour descriptors (https://arxiv.org/abs/1504.04909) **[paper]**.
- **Transfer.** Our recompile keeps the single top lineage, which is the GEPA/REx local-optimum failure the sweep named.
- **Exact adaptation.**
  - Select compiler variants (prompt × SDK × acceptance) by lexicase over compile histories as cases. A variant that is uniquely good on kinetics survives even if its mean is lower.
  - Keep a MAP-Elites archive keyed by (family type, guard width, judge-tier share).

**(e) Compiler validation: equivalence modulo inputs (EMI).**
- **How the field solved it.** EMI profiles a program on inputs, then generates variants that are equivalent on those inputs (by pruning unexecuted code) and differentially tests the compiler on them. It found 147 confirmed GCC/LLVM bugs (Le, Afshari, Su, PLDI 2014, https://www.cs.ucdavis.edu/~su/publications/emi.pdf) **[paper]**.
- **Transfer.** Measure the compiler's stability with metamorphic inputs instead of waiting for natural failures.
- **Exact adaptation.**
  - Generate trace-set variants that should compile to equivalent solvers: rename entities, permute trace order, drop one redundant trace, inject a near-twin consistent with the spec.
  - Compile each one. Semantic disagreement between the resulting solvers, on tasks run without an oracle, is a direct, system-observable measure of lineage variance (D12) and a source of compiler failure cases.

### 5. Creative options

1. **Compile-history ledger with GEM-constrained, holdout-budgeted adoption** (the patch-level fix). This makes §6.10 measurable without fooling ourselves.
2. **Change the problem: stop improving the compiler and evolve the evaluator plus a population.**
   - The FunSearch lesson is that the evaluator is the asset.
   - Invest the self-improvement budget in the system-view evaluator: mined invariants, EMI twins, refusal replay and conformance (B14).
   - Replace "the compiler" with a lexicase-selected *population* of cheap compiler variants. Improvement then becomes selection pressure over a growing failure-case database, never a rewrite of one lineage. No single prompt accumulates per-failure rules, so ACE-style context collapse cannot happen.
3. **Turn each diagnosis into a mutation operator, not a prompt rule.**
   - Every D-entry becomes an *input-mutation operator* applied to future trace sets and check suites. D1 becomes "inject one-typo near-twins with a shared secondary attribute"; D7 becomes "perturb numerics within tolerance".
   - The compiler is scored by the mutation kill rate of the solvers it produces.
   - Lessons then generalise to families that never had the bug, which is what heal's L-1 to L-3 could not do.
4. **Treat integrity as part of fitness.** Any compile with `hiddenPathAttempts > 0` is excluded from the improvement memory, and its rate is a tracked objective, as in STOP's sandbox-bypass measurement.

### 6. Experiments (ranked)

**E18-1. Retrospective backward-transfer and deletion audit over the existing ledger ($0 or about $3, 4–6 h, dev only).**
- **Build:**
  - `experiments/jit/compile-ledger.mjs`: joins `compile.json`, `results.jsonl` and `nversion-records-dev.json` into per-(version, task) outcomes.
  - `experiments/jit/deletion-diff.mjs`: an AST diff of guards, invariants, checks and profile bounds, parent to child.
- **Run:** apply to the 13 recompile edges. Where outcomes are missing, rerun the archived `solve.mjs` versions on the 24 records dev tasks; the N-version sweep cost $2.50.
- **Metric:** whether "BWT < 0 on parent-won cases, or any refusal lost on the parent's deopt inputs, or any deletion-equivalent edit" flags the known-bad recompile (O/H records v2, D9) while passing the known-good ones (S/H v2, the D3 heal that fixed over-strictness).
- **Baseline:** current acceptance, which accepted all of them.
- **Preregistration:** freeze the flag rule before computing.
- **Kill rule:** the rule flags ≥ 50% of good recompiles, or misses D9.
- **Falsifies:** "GEM/Kali-style non-regression is a sufficient adoption gate".

**E18-2. EMI-style metamorphic compile stability (about $12–25 and 12–16 Haiku builder sessions, 1 day; dev seeds only).**
- **Setup:**
  - Take 3 records trace sets. For each, make 3 metamorphic variants (rename, permute, near-twin injection) plus **2 identical-input recompiles** as the noise control.
  - That is 15 Haiku compiles with prompt v3 and `policy/models.json` ids. Records Haiku compiles cost $0.27–2.19 each.
  - Score every solver on 16 dev tasks.
- **Metrics:**
  - the SD of pass across variants against the SD across identical reruns;
  - whether system-view disagreement between twins predicts oracle failures (precision and recall).
- **Preregistration:** a dev-diagnostic note with frozen metrics. K is about 3 per cell, so no claims.
- **Kill rule:** twin disagreement predicts no better than uniform shadows.
- **Falsifies:**
  - "lineage variance is driven by trace content", if the variant SD is no larger than the rerun SD;
  - "EMI twins are a usable system-view failure source", if they lack predictive precision.

**E18-3. Lexicase population against latest-lineage on a held-out compile slice (about $60–120 and about 40 builder sessions, 1–2 days; gated on E18-1 and E18-2 passing).**
- **Setup:**
  1. Three compiler variants: prompt v2, v3 and v3 plus mutation-operator checks.
  2. Use the records and kinetics histories as memory.
  3. Use a **new third family** as the held-out slice. A generated or R-bench item from E14-2 fits, because it is not Claude-authored by the same process. Access it only through a budgeted accept/reject interface.
- **Metric:** held-out stream success and silent-miss rate for the lexicase-selected compiler against "latest version".
- **Preregistration:** required (PREREG-stream template, test seeds ≥ 7001, K=2).
- **Kill rule:** under a 3-point gain, or negative BWT on memory.
- **Falsifies:** "self-improvement via selection beats per-failure patching".

---

## How B14 and B18 interact

The two blockers are one problem seen from two sides: **neither has a trusted, cheap evaluator that is not reused adaptively.**
- B14 pays about $11 of frontier time per item to hand-build one, and the result still admits 5 wrong classes.
- B18 has none and borrows the experimenter's oracle.

The coupling is productive in both directions:
- **Conformance against a running human original (B14's parallel-run inversion) is exactly the system-observable failure signal B18 lacks.** Every mismatch is a reproducible, non-Claude-authored compiler test case: a Foundry-Defects4J entry.
- **R-bench's 100-item plan, split 60 dev / 40 sealed, is the only realistic source of enough diverse compile histories** to escape the 21-history, 2-family overfitting trap. That makes B18 depend on B14 actually running.
- **B18's discipline is what makes B14's "durable equal or better" claim honest.** That means GEM backward transfer, deletion detection, budgeted holdout access and integrity-as-fitness. A replica that "improves" by deleting a refusal is D9 again, at the level of a real user's workflow.
- **The danger:** improving the compiler on R-bench items burns them, the way inspected seeds are burned (L5). The item split and the holdout query budget therefore have to be frozen *before* the first self-improvement step touches replication data.

**Recommended order:** E14-1 and E18-1 are both $0 and both build the evaluator. E14-2 then produces real mismatch histories, and E18-2 and E18-3 consume them. That turns "discovery" (B14) into the supply of training signal for "meta" (B18).

**Key paths:**
- `/home/user/workflow-foundry/research/replicate-20261008/DESIGN.md`
- `/home/user/workflow-foundry/research/jit-20261008/DEV-NOTES.md`
- `/home/user/workflow-foundry/experiments/jit/prompts.mjs`
- `/home/user/workflow-foundry/experiments/jit/durability.mjs`
- `/home/user/workflow-foundry/experiments/runs/jit/*/*/versions/*/compile.json`
- `/home/user/workflow-foundry/research/heal-20261008/DESIGN.md`
- `/home/user/workflow-foundry/research/corpus-20261006/COVERAGE.md`

## Agent result 8

# Dossier: composition and control (B12 composition from guarded sub-modules; B13 interactive environments and game loops)

*2026-10-09. Read-only pass; no live model calls; development evidence only. Tags: **[repo]** I measured it this pass from the cited file; **[doc]** it is documented in the cited repo file; **[paper]**, **[practice/docs]** and **[inference]** as the task requires. "Unverified" means I saw only an abstract or a secondary summary. The earlier sweep (`frontier:interactive-and-composition` and the synthesis in the workflow journal) already covers DAgger, options, Simplex and Neural Simplex, shielding, Voyager, ASI, SkillWeaver, AWM, Code as Policies, WorldCoder, PIRL, BALROG, Temporal and LangGraph. I cite those only to tell them apart from this dossier. Everything below is new to the sweep.*

---

## B12. Composition from guarded sub-modules

### 1. Mechanism (repo evidence)

- **No composition primitive exists anywhere in the JIT.**
  - The SDK has only `createFlow`/`step`/`judge`/`guard`/`invariant`/`map`/`flag`/`done` (`experiments/jit/flow-v2.mjs`, 239 lines).
  - The sandbox copies in only `solve.mjs`, `tools/model.mjs`, `tools/gateway.json` and the task files (`run-compiled.mjs:49`), so a solver cannot even import a sibling module.
  - Across all 21 archived compiled solvers, **0 import anything** besides flow, model and `node:` modules [repo].
  - The engine IR has "static nesting only (depth ≤ 6)" and no `call` (README layer table; `src/validate.mjs`) [doc]. Lane 2 counts **214 corpus items that need `subworkflow-call`, and for 102 it is the only blocker** (`research/review-20261007/02-ir-expressiveness.md` §A1) [doc].
- **Every compile re-derives the same sub-procedures.** In the 10 records solver versions under `experiments/runs/jit/jit-dev-records-1/*/versions/`, `parseDate`, `osa`, `normPhone`, `namesMatch`, `linked`, `isoOf` and `parseLine` are each written **10/10 times**, and `parseMoney`/`partDist`/`splitName` 7/10 [repo]. The solvers are 311–629-line monoliths [repo].
- **The error locus is a module that nobody guards.**
  - Every silent records miss is an under-merge (D1; inventory F2).
  - In S/H v1 the decision is a hard threshold, `namesMatch = partDist(g)+partDist(f) <= 1` plus `linked(...)` (`.../jit-claude-sonnet-5-5--claude-haiku-5-5/versions/v1-haiku55/solve.mjs:493-494`) [repo].
  - The only checks near it are whole-output invariants (`rows-in-one-record`, `one-dob-per-person`, `entity-ids-unique`, lines 539–541). None can see a pair that was never merged.
- **Common mode follows from shared module logic.** In the four-solver N-version probe, the one unanimous wrong answer (s214) was an under-merge (D8, `nversion-records-dev.json`) [doc]. Independently written monoliths still converge on the same identity heuristic.
- **Healing has a global blast radius.**
  - Recompile rewrites the whole program. The v2 heal fixed `vendex-entries` (D3) and silently removed refusals elsewhere: O/H v2 answered and failed 5/7 d4 tasks (D9) [doc].
  - Heal's closed patch grammar "cannot iterate over array items" (heal DESIGN B.5) [doc], so neither repair path can make a *local* edit.
- **Leverage is not contained.** One global `rules` judge conditions every row: D11 tier-down kept 95% of leaves but lost tasks, 5/8 vs 7/8 [doc]. Without module boundaries, leverage cannot be measured or capped.

### 2. Ideological root

The assumption is that **the unit of compilation, verification and healing is the task.** Traces are task-level (SPEC §4: answer + scripts + commands), acceptance is task-level (check-traces), shadows compare whole answers, and the input profile (`profile.mjs`) fences the *task* input. Composition needs contracts at *interior* boundaries. Traces never show those, because an interpreter's scripts have no stable interfaces.

For the assumption to hold against the e2e vision, three things would all have to be true:
1. Recurring tasks share no sub-procedures across families.
2. Module defects are independent across compiles.
3. Heals only ever touch one decision.

The repo falsifies each one:
- 10/10 helper duplication;
- s214 common mode;
- D9 collateral widening.

A second root is that **contracts emerge from traces.** Task-level guards can be mined from inputs (type feedback), but a module contract also needs a *postcondition*, and nothing in an end-to-end answer labels whether a sub-step was right. THESIS-JIT §6.7 defines composition ("guarded and healed as modules; the heal localiser picks the module") without saying where module-level evidence comes from. That is the real blocker [inference].

### 3. Frontier (cited)

- **Test-constrained composition.**
  - Parsel decomposes a task into hierarchical function descriptions, implements each with a code LLM and searches over *combinations* of implementations using tests. Reported gains: APPS pass rate >75% over prior direct sampling; HumanEval pass@1 67%→85% with generated tests (Zelikman et al., NeurIPS 2023) [paper].
  - LLM4PLC makes the plan explicit as functions + variables + FSM states before it generates Structured Text, then checks with grammar checkers, compilers and SMV model checking; generation success 47%→72% (Fakih et al., ICSE-SEIP 2024) [paper].
- **Library learning by refactoring.** ReGAL refactors existing programs into helper functions verified *by execution against the original outputs*, then prunes or edits over-specific helpers. CodeLlama-13B: +11.5 (LOGO), +26.1 (date understanding), +8.1 (TextCraft) absolute (Stengel-Eskin, Prasad, Bansal, ICML 2024) [paper]. *Date reasoning is one of its five domains, and dates are exactly the helper our solvers re-derive.*
- **Sound use of approximate decompositions.** ChatHTN tries symbolic methods first, asks the LLM only when no method applies, and stays sound despite approximate LLM output. A follow-up learns verified LLM decompositions as reusable methods (Muñoz-Avila, Aha, Rizzo, 2025; follow-up unverified) [paper].
- **Contracts and blame.** Findler & Felleisen made runtime-checked contracts at higher-order boundaries assign *blame* to the party that broke them (ICFP 2002) [paper]. Assume/guarantee contracts give an algebra for composing and refining components (Benveniste et al., *Contracts for System Design*, FnT EDA 2018) [paper].

### 4. Niche verticals

**(a) Robotics: sequential composition by funnels, skill chaining and behaviour trees.**
- *How it was solved.* Burridge, Rizzi and Koditschek compose feedback controllers by *domains*: controller i may hand off to j only if i's goal set lies inside j's domain of attraction. The result is a partition of state space that funnels to the goal (IJRR 1999) [paper]. Skill chaining learns each skill so that it ends inside its successor's initiation set (Konidaris & Barto, NIPS 2009) [paper]. Colledanchise & Ögren show that behaviour trees generalise sequential composition, subsumption and decision trees, and that key properties (robustness, safety) carry over when trees are composed (IEEE T-RO 2017) [paper].
- *Transferable mechanism.* A module is the pair (domain D, goal set G), not a function. Composition is legal when G_producer ⊆ D_consumer, and that is checkable before running.
- *Adaptation for Foundry.*
  - Every module carries two learned profiles: `profile.mjs` over its inputs (D) and the same learner over its outputs (G).
  - At link time, `checkProfile(D_consumer, sample of G_producer)` must pass, or the link is refused and routed to interpreter or adapter.
  - This is the reuse gate of THESIS §6.7 moved down to sub-module granularity. The same machinery serves reuse and composition, while each keeps its own definition.

**(b) PLC and industrial control: IEC 61131-3 and IEC 61499 function blocks, adapters and permissives.**
- *How it was solved.* IEC 61499 function blocks expose *event* and *data* ports. `WITH` constraints bind which data accompany which event. Composite blocks are networks of blocks, and adapter interfaces separate the specification from the implementation (IEC 61499 overview; Eclipse 4diac library docs) [practice/docs]. Interlocks are evaluated outside the logic they gate [inference from general practice; I did not open IEC 61511, unverified].
- *Transferable mechanism.* Typed ports plus an adapter type: the caller binds to an interface, never to an implementation. Effects and data drops pass through permissive conditions that the module cannot override.
- *Adaptation for Foundry.*
  - `flow.module(name, {iface, version})`. The iface is the adapter: a JSON-schema in/out plus a `WITH`-style list of which inputs a decision may read.
  - Data-dropping outputs (void rows, sign flips; inventory I3) need a host-evaluated permissive keyed to contract-declared rule ids, never to quoted note text.

**(c) Supervisory control theory (modular).**
- *How it was solved.* Ramadge & Wonham reduce supervision to the supremal controllable sublanguage of the legal language (SIAM J. Control Optim. 1987). Wonham & Ramadge give conditions under which a specification that is an intersection of component restrictions can be enforced by *modular* supervisors (MCSS 1988). Modular supervisors can *conflict*, meaning their composition blocks even though each alone does not [paper].
- *Transferable mechanism.* Check nonconflict after composing.
- *Adaptation for Foundry.* Each module's guard set is a local supervisor. After linking, replay the trace pool through every module's guards in sequence and count inputs that no path accepts (blocking). A composed workflow that refuses inputs the monolith answered correctly has conflicting guards. This is the composition analogue of D9, which concerned silent widening.

**(d) Fault-tolerant control: analytical redundancy.**
- *How it was solved.* Blanke, Kinnaert, Lunze and Staroswiecki use structural models to locate redundancy in a process and to test whether a fault is detectable and isolable (*Diagnosis and Fault-Tolerant Control*, 3rd ed., Springer 2015; details of the analytical-redundancy-relation treatment unverified) [paper].
- *Transferable mechanism.* A residual is computed from redundant information. When residuals break, the *pattern* of broken residuals isolates which component failed.
- *Adaptation for Foundry.* Give every module boundary residuals:
  - money: Σamount conserved across currency conversion;
  - phone: country-code prefix consistent with the resolved country;
  - identity: no two entities share a phone and a DOB.

  Then build a fault-signature matrix (module × residual), so a failed residual names a module with no oracle needed.

**(e) Game AI: HTN method libraries (SHOP-style, applied in games).**
- *Transferable mechanism.* Methods are guarded decompositions. If a method's precondition fails, the planner tries the next one. ChatHTN adds an LLM fallback when no method applies (above).
- *Adaptation for Foundry.* Compiled modules become methods with preconditions, and the interpreter becomes the "no applicable method" case, scoped to one compound task, not the whole job.

### 5. Creative options

1. **Patch: contracted modules with blame.**
   - `flow.module` + iface + pre/post contracts + residuals.
   - A violation emits `deopt{kind:'contract', module, blame:'caller'|'callee'}`.
   - Recompile then targets one module, and reject-if-worse runs *per module* on that module's recorded boundary inputs. That is a much sharper regression set than whole tasks.
2. **Refactor, don't synthesise (the free oracle).**
   - ReGAL's insight applied here: a *behaviour-preserving* refactor of an existing solver has an exact oracle, namely the old program on the same inputs.
   - Mine the 21 archived solvers for shared helpers and require byte-identical outputs on every archived input before a helper enters the library. No hidden truth, no shadow, no interpreter.
   - Module-level N-version then comes free: 10 implementations of `namesMatch` already exist.
3. **Change the problem: composition as planning over funnels (GOAP/HTN), not program writing.**
   - Modules declare preconditions and effects over typed facts (profiles). A generic code planner (A*, as in F.E.A.R.) composes a pipeline per task. The cheap model writes *modules and their contracts*, never the glue.
   - Composition correctness becomes a reachability check, so "write a correct 600-line program" turns into "add one verified edge".
4. **Change the problem: put N-version diversity at the module boundary, where answers are small.**
   - Disagreement between whole tasks is noisy (D8: 5/13 with no majority).
   - Disagreement on a *pair decision* ("same entity?") is binary and cheap to adjudicate narrowly. It turns §6.2 "verify decisions, not answers" into an architecture.

### 6. Experiments (ranked)

**E12-1. Module-level N-version census at $0 (3–4 h; first).**
- *Build:* `experiments/jit/module-census.mjs`.
  - Extract top-level function declarations, with their closure constants, from the 10 records `solve.mjs` versions by brace matching (no new dependencies). Load them in `node:vm` with `flow` stubbed.
  - Harvest module inputs from the 24 dev tasks (`makeTasks`/`solverView`; task inputs only):
    - every date string × each judge-settable `order` value;
    - every phone × country;
    - every candidate name pair within blocking distance.
  - Run all 10 implementations of each module.
- *Metric:*
  - **Recall:** the share of the known silent misses (F1's 6; the D1 pairs `de Vreis`, `Anook`, `Bneoit N.`, `Sanne P.`) whose responsible module decision shows a cross-version disagreement. Scored analyst-side only.
  - False-disagreement rate on decisions of passing tasks.
  - Disagreement-set size per task, a proxy for adjudication cost.
- *Baseline:* whole-task N-version (D8: 11/13 disagreements contained a right answer; 5 had no majority; s214 was unanimous-wrong).
- *Preregistration:* diagnostic, dev split, declared as such. No system component reads the oracle.
- *Cost:* $0 and zero quota.
- *Kill rule:* if extraction fails on ≥3 of 10 versions, report that as the negative ("compiled monoliths are not decomposable post hoc") and move to E12-2's refactor-by-builder.
- *Falsifier:* if recall on the known misses is <50%, or s214 is also unanimous at module level, then module-level diversity is no better than task-level, and the common mode sits in the *spec reading*, not the module.

**E12-2. Behaviour-preserving refactor + one-module heal (about 1 day; second).**
- *Build:*
  - `experiments/jit/refactor.mjs`: a Haiku builder (policy ids only) refactors S/H v1, O/H v1 and H/H v1 into `lib/{dates,phones,money,identity}.mjs` + thin `solve.mjs`. `run-compiled.mjs` gets a `lib/` copy (backwards compatible; the `MODEL_TOOL` bytes stay unchanged).
  - Acceptance: exact output equality with the monolith on all archived inputs, with judges served by a salt-free memo. That memo needs N2; until N2 exists, re-run live at about $0.004–0.04/task.
  - Then apply the D1 fix *once*: a near-miss band → same-entity `flow.judge` + flag, inside `identity.mjs`. Relink all three solvers.
- *Arms:* one-module fix relinked ×3 vs the existing whole-program recompile per arm (D10/D12 path).
- *Metric:*
  - dev pass (analyst-side) on seeds 201–224;
  - **collateral change:** the count of non-identity output fields that differ, which should be 0;
  - refusals preserved on the D9 inputs;
  - fix $.
- *Preregistration:* dev now. A PREREG with seeds ≥ 8000 (avoiding F13's 7000–7039 collision) before any held-out read, K ≥ 2 lineages.
- *Cost:* about $3–8. Low quota (Haiku), plus one Opus fallback at most.
- *Kill rule:* if refactor equivalence stays below 95% of archived inputs after 2 builder attempts, stop.
- *Falsifier:* the module fix causes as much collateral change or refusal loss as a whole recompile.

**E12-3. Blame accuracy on mutants ($0–1, 3 h; third).**
- On E12-2's modular solver, inject 20 single-module mutants:
  - threshold 1→0 or 1→2;
  - DMY↔MDY;
  - drop the E.164 prefix;
  - swap the rounding mode.
- Measure:
  - detection by boundary contracts + residuals against today's whole-output invariants;
  - blame accuracy (correct module named).
- *Kill rule:* blame accuracy < 70%.
- *Falsifier:* whole-output invariants detect as many mutants. In that case boundaries add no observability.

---

## B13. Interactive environments and game loops

### 1. Mechanism (repo evidence)

- **Compiled code cannot drive an environment.**
  - `solve.mjs` is one-shot: `task.json` in, `flow.done` out, run with `network:false` and only the gateway socket (`run-compiled.mjs:46-52`).
  - `flow` has no env primitive. The env port (`reset/step/observe/snapshot/restore`) is M13-ENV on the frozen E2 branch (`11-NEXT.md` rows M13-ENV, C5 pilot W6) [doc].
- **The trace format cannot express a policy.** Traces are final answer + scripts + commands (SPEC §4), not (observation, action) pairs. The compiler has nothing to distil per step [doc].
- **Whole-task deopt is not just expensive in gridquest; it breaks the environment's semantics.**
  - The env has a **lifetime ledger that `reset()`/`restore()` never refund**.
  - "a harness that hands the solver several envs … re-opens blind search" (`beds/gridquest/README.md`, Interface and Known limitations) [doc].
  - SPEC §6.2's "on deopt: interpret" would therefore hand the interpreter either a depleted ledger or an illegal fresh env.
- **Shadowing and adjudication are ill-defined.** Two solvers cannot act in one episode. A second env is a second ledger, and majority-of-answers needs re-runnable tasks [inference from the ledger semantics].
- **Perception is the difficulty; control is codable** (`gridquest/README.md` diagnostics, dev/test per level):
  - the certifying explorer, with perfect perception and no map, solves 30/30 at every level;
  - `regexAgentV2` scores 0/1 at d4 and 0/0 at d5;
  - the white-box `templateAwareAgent` scores 4/8 at d4;
  - `snapshotSearch` scores 0 under the default ledger.

  Episodes run to 8.5–13K tokens at d3 and 19–27K at d5 [doc].
- **No LLM has run on gridquest yet.** gameqa is unaudited; `sealed-3` is unread [doc].
- **Guards are learned from task inputs** (`profile.mjs` header: "profiles see input shape"). In an episode the input arrives over time, so a one-shot input fence cannot guard observation 37 [doc + inference].

### 2. Ideological root

The assumption is that **a task is a pure function from input to answer, and time is not part of the contract.** Every verification device we built depends on referential transparency:
- check-traces re-runs;
- shadows re-solve;
- adjudication takes a majority of answers;
- N-version compares outputs;
- reject-if-worse replays old cases.

Environments break this in three ways:
1. Actions are irreversible (trap chutes, coupled switches).
2. Budgets are consumed and never refunded.
3. Error compounds over T steps (T²ε, covered by the prior sweep).

For the assumption to hold, environments would need free reset, a refundable ledger, deterministic replay *and* short horizons. Gridquest grants the first and third (sealed snapshots, determinism class D0). It denies the second by design, and it is long-horizon.

There is a deeper version of this root. **We located verification in answers. Environments locate it in transitions:** every step is a labelled example (s, a) → o, observable to the system without hidden truth. The JIT discards the densest oracle-free signal in the whole vision [inference].

### 3. Frontier (cited)

- **Program-level policies with debugging against training tasks.** Silver et al. have GPT-4 write Python *generalized plans* for PDDL domains from about 2 training tasks, with CoT summarisation and **automated debugging** against the training tasks. Debugging matters a great deal, and GPT-4 ≫ GPT-3.5 (AAAI 2024) [paper].
- **Compile the world model, then plan.** Code World Models has an LLM translate rules and trajectories into an executable Python simulator. Unit tests are auto-generated from offline trajectories, MCTS/IS-MCTS plans on top, and it beats thinking-LLM baselines (Lehrach et al., DeepMind, ICLR 2026; figures unverified) [paper].
- **Behaviour trees as the policy language at scale.** PORTAL generates BT-DSL policies with hybrid rule and neural nodes across thousands of 3D games. Feedback is dual (game metrics + VLM analysis), and online LLM latency is avoided (Xu et al., Tencent, 2025; abstract-level, numbers unverified) [paper]. BTGenBot fine-tunes ≤7B models to emit BTs and validates them statically, in simulation and on a robot (Izzo et al., 2024) [paper]; BTGenBot-2's 1B claims are unverified.
- **FSM grounding with an LLM inside each state.** StateFlow separates process grounding (states and transitions) from sub-task solving. Over ReAct it reports +28% on ALFWorld and +13% on InterCode-SQL at about 3× and 5× lower cost (Wu et al., 2024) [paper].
- **Self-verifying failure artefacts.** Delta debugging minimises a failing action sequence by automated re-runs (Mozilla: 95 user actions → 3) (Zeller & Hildebrandt, IEEE TSE 2002) [paper]. That is directly the gameqa output, "minimal reproducing action sequence".

### 4. Niche verticals

**(a) Behaviour trees and subsumption.**
- *How it was solved.*
  - BTs tick from the root every cycle. Fallback nodes try children in order, and RUNNING lets multi-step actions persist (Colledanchise & Ögren 2017) [paper].
  - In Brooks' subsumption, higher layers *suppress* lower outputs while the lower layers keep running, and the lowest layer is never altered after it is debugged (IEEE J. Robotics & Automation 1986) [paper].
- *Transferable mechanism.* Fallback is a scoped, per-tick deopt: only the failing subtree hands over, and control returns on the next tick when conditions hold again (native reverse switching). Subsumption gives a code safety layer that can veto *both* the compiled controller and the agent.
- *Adaptation for Foundry.*
  - The compiled artefact is `controller.mjs` exporting `tick(obs, mem) → {action} | {fallback: subtree}`.
  - The agent is the Fallback child for one named subtree (`find-exit`, `which-key`), with a step cap. It is never a whole-episode restart.
  - A layer-0 code supervisor (permissives, below) suppresses irreversible actions from either source.

**(b) PLC scan cycle + ISA-88/PackML state model.**
- *How it was solved.*
  - The scan cycle is read inputs → evaluate → write outputs, with all state explicit in memory.
  - ISA-88 phases go Running → Holding → Held → Restarting → Running. PackML (ISA-TR88.00.02) has Execute, Holding, Held, Unholding and others, and the OPC PackML analyser spec requires that Execute **sub-state be kept** while Held so execution resumes from a restart point (OPC Foundation PackML reference; secondary vendor notes) [practice/docs].
- *Transferable mechanism.* A standard *handoff protocol with preserved sub-state*, plus separate acting and wait states, so a takeover is never half-done.
- *Adaptation for Foundry.*
  - `mem` must be JSON-serialisable (enforced). On deopt, the controller enters Holding: it writes `{snapshot, mem, subtree, stepIndex}`.
  - The interpreter acts in Held *in the same env* (same ledger) and must end at a declared re-entry condition (Unholding) to hand back.
  - These states go in the journal, so the UI's run-view shows a PackML-like timeline.

**(c) Game AI: GOAP (F.E.A.R.).**
- *How it was solved.* Orkin's soldiers have a 3-state FSM (Goto, Animate, UseSmartObject) and use A* over actions with preconditions and effects. They **replan** when the world contradicts the plan, for example a door slammed shut, fire through the window (GDC 2006) [paper/practice].
- *Transferable mechanism.* Keep the controller generic and tiny. Put the domain into action schemas and a fact extractor, and make replanning on contradiction the default.
- *Adaptation for Foundry.* This is gridquest exactly: the certifying explorer is already a code planner over a belief state.
  - Compile the **fact extractor** (exits, keys, switches, one-way passages from prose) and the **action schemas** (`use key` requires holding the colour; `toggle` flips the named bridge).
  - A* runs over facts. `flow.expect(predicted, observed)` triggers a replan first and a deopt only when replanning fails.

**(d) Supervisory control theory + run-time assurance.**
- *How it was solved.*
  - SCT splits events into controllable and uncontrollable and disables controllable ones to keep behaviour legal *and nonblocking* (a marked state stays reachable) (Ramadge & Wonham 1987) [paper].
  - ASTM F3269 run-time assurance bounds a complex function with a safety monitor, recovery functions and a switch, and places the certification burden on the **monitor** (ASTM store summary; CISPA papers) [practice/docs].
- *Transferable mechanism.* Make nonblocking a permissive, and certify the monitor, not the controller.
- *Adaptation for Foundry.*
  - **Nonblocking permissive:** before a one-way move or a coupled-switch toggle, code checks on the belief map that the treasure frontier stays reachable. If it cannot show that, it holds and hands off.
  - In gameqa, agent moves are controllable and crawler moves are not, so the supervisor is the dodge check.
  - Promotion evidence is about the monitor (guards/expect): precision and lead time, not controller success alone.

**(e) Fault-tolerant control.**
- *Transferable mechanism.* The residual between a model's predicted observation and the actual one is a fault detector, and the lead time to unrecoverability is the figure of merit (Blanke et al.) [paper].
- *Adaptation for Foundry.* `flow.expect` residuals, logged per step, give both a detector and the training signal for the perception judge.

### 5. Creative options

1. **Patch: an env port + `tick` controller + a PackML-style hold/unhold handoff in the same env.** This differs from the prior sweep's H1-a by its explicit sub-state protocol, scoped subtree fallback and nonblocking permissive.
2. **Change the problem: compile the world model, not the policy.**
   - Haiku compiles `world.mjs` (perception parser + transition predictor) from interpreter traces. A generic planner does control.
   - Every observed step is a free, oracle-free test of `world.mjs`, so acceptance becomes next-observation accuracy on held-out *steps* of dev episodes. This is the dense label stream batch tasks never had.
   - It also makes shadowing legal: the "shadow" runs in the compiled simulator, not in a second real env.
3. **Change the problem: compile the verifier for exploration tasks (gameqa).** Exploration stays agentic. The compiled parts are the repro replayer and delta-debugging minimiser, which check every candidate bug in fresh envs. These outputs verify themselves, so agent noise costs only exploration budget.
4. **Generalise the root: treat batch tasks as episodes of decisions.** Records' merge decisions become steps, and the near-miss band becomes the Fallback subtree. Batch-side "verify decisions" (§6.2) and interactive Fallback are then one mechanism (see the cluster section).

### 6. Experiments (ranked)

**E13-1. Handoff-protocol headroom at $0 (3–4 h; first, decides what to build).**
- *Build:* `experiments/jit/env-handoff-sim.mjs` (analyst-side diagnostic; it imports `beds/gridquest/diagnostics.mjs`/`solver.mjs` and is never a system component).
  - Controller stand-in: `regexAgentV2`, honest code-only perception.
  - Resumer stand-ins:
    - (i) `templateAwareAgent`, amnesiac and env-driven;
    - (ii) an explorer-from-current-state upper bound (a `navigate` wrapper; oracle-side, upper bound only).
- *Protocols:*
  - P0: no fallback;
  - P1: whole-task restart in a fresh env (today's SPEC semantics, illegal under the ledger; counterfactual);
  - P2: restart in the same env with the residual ledger;
  - P3: hold-and-resume at the first refuted expectation (snapshot + `mem` handed over);
  - P4: P3 + a nonblocking permissive before one-way or coupled actions.
- *Data:* 30 dev seeds × d3–d5.
- *Metric:* pass rate, actions spent, and deopt lead time (steps between handoff and the last recoverable state).
- *Preregistration:* diagnostic, dev split, stand-ins disclosed.
- *Cost:* $0 and zero quota.
- *Kill rule:* if P3 and P4 are within 3 points of P2 at every level with resumer (ii), mid-episode handoff buys nothing on gridquest. In that case skip the PackML machinery and build only the env port.
- *Falsifier:* P2 ≈ P4, meaning the ledger rather than state preservation is what binds.

**E13-2. World-model compile vs policy compile (about 1 day; second).**
- *Build:*
  - an env port (`experiments/jit/env-port.mjs`, host-side, routed like the gateway; the bed code stays out of the workdir per SPEC §3.2);
  - `flow-v3` with `env`, `expect`, `tick`;
  - trace records gain `steps:[{obs, action}]`.
- *Arms on 12 dev tasks d3–d4:*
  - Haiku agent;
  - Sonnet agent;
  - JIT-policy: Sonnet traces → Haiku compiles `controller.mjs` with Haiku perception judges;
  - **JIT-world:** Sonnet traces → Haiku compiles `world.mjs` facts + schemas, played by a code A* planner (GOAP), with replan on `expect` and P4 handoff.
- *Metrics:*
  - levels per $ and quota per level;
  - one-step prediction accuracy of `world.mjs` on held-out dev *steps*, which is environment-labelled and oracle-free;
  - residual lead time before failure.
- *Preregistration:* `PREREG-env.md` before any held-out read; seeds ≥ 8000 from a global ledger; K ≥ 3 streams; arms and kill rules frozen.
- *Cost:* about $12–25. Quota is dominated by the Sonnet traces and agent arm, so run off-peak (F10: a 3 h stall).
- *Kill rule:* JIT-world one-step accuracy <90% after one recompile, or levels/$ below the Haiku agent's.
- *Falsifier:* JIT-policy ≥ JIT-world on success, so a world model brings no verification advantage.

**E13-3. gameqa: compile the verifier (half a day after the gameqa audit; third).**
- *Prerequisite:* gameqa is unaudited, so audit first (kill if the audit's triviality attack passes more than 20%).
- *Arms:* Haiku agent alone vs Haiku agent + a compiled replay/ddmin verifier (code, $0 per check).
- *Metric:* bugs passing the oracle per $, and false reports.
- *Cost:* about $5–10.
- *Falsifier:* the verifier arm's false-report rate is no better than the agent's.

---

## Cluster: how B12 and B13 interact

The two blockers are one missing primitive seen along two axes. **B12 lacks a boundary in space** (a module edge with a contract), and **B13 lacks a boundary in time** (a tick, or a held state, with a handoff). Every niche field that solved one also solved the other with the same object:
- Burridge's funnels and Konidaris' chains compose controllers *over time* by domain containment.
- BTs are composition (subtrees) *and* reactive control (ticks).
- PackML's held sub-state is a module boundary with preserved state.
- SCT's modular supervisors raise the nonconflict question for both pipelines and plants.

So Foundry should build **one** construct, a guarded region:

```
flow.region(name, {pre: profile/contract, post: contract + residuals, fallback, permissive, mem})
```

It serves as a sub-module boundary in batch work (blame, local heal, module N-version) and as a hold/unhold handoff in episodes (scoped deopt, same env, reverse switching). The domain-of-validity gate that THESIS §6.7 already assigns to *reuse* is the same check at every boundary. Reuse and composition stay distinct ideas that share one mechanism.

The interaction is not only synergy:
- Error compounds across composition depth and across time (T²ε). A chain of k regions each wrong at rate ε fails at about kε unless every boundary checks. Unchecked composition will look worse than the monolith, and **E12-3's blame accuracy is the gate for E13-2's controllers**.
- Interactive environments supply the module-level labels that batch composition lacks: each step labels the perception module. **E13-2 is the cheapest source of evidence that boundary verification works at all**, and it can then justify the harder batch case.
- Both blockers sit on frozen engine work (IR `call` S1 and M13-ENV on E2). Build both in `experiments/jit/` against `flow-v3`, at $0 first: E12-1 and E13-1 together cost no quota and decide which half of this design is worth a day.

---

### Sources
- Brooks, "A Robust Layered Control System for a Mobile Robot", IEEE J. Robotics & Automation 2(1), 1986. https://ieeexplore.ieee.org/document/1087032 [paper]
- Colledanchise & Ögren, "How Behavior Trees Modularize Hybrid Control Systems and Generalize Sequential Behavior Compositions, the Subsumption Architecture, and Decision Trees", IEEE T-RO 33(2), 2017; book arXiv: https://arxiv.org/pdf/1709.00084v2 [paper]
- Burridge, Rizzi, Koditschek, "Sequential Composition of Dynamically Dexterous Robot Behaviors", IJRR 18(6), 1999. https://kodlab.seas.upenn.edu/sequential-composition-of-dynamically-dexterous-robot-behaviors/ [paper]
- Konidaris & Barto, "Skill Discovery in Continuous RL Domains using Skill Chaining", NIPS 2009. https://all.cs.umass.edu/pubs/2009/konidaris_b_09d.pdf [paper]
- Ramadge & Wonham, "Supervisory Control of a Class of Discrete Event Processes", SIAM J. Control Optim. 25(1), 1987; Wonham & Ramadge, "Modular Supervisory Control of Discrete-Event Systems", MCSS 1(1), 1988. https://collaborate.princeton.edu/en/publications/supervisory-control-of-a-class-of-discrete-event-processes/ ; https://collaborate.princeton.edu/en/publications/modular-supervisory-control-of-discrete-event-systems/ [paper]
- Blanke, Kinnaert, Lunze, Staroswiecki, *Diagnosis and Fault-Tolerant Control*, 3rd ed., Springer 2015. https://www.springer.com/978-3-662-47942-1 [paper; ARR details unverified]
- ASTM F3269-21 (run-time assurance). https://store.astm.org/f3269-21.html ; CISPA: https://finkbeiner.groups.cispa.de/publications/DFS21.pdf [practice/docs; standard text not read]
- IEC 61499 overview https://en.wikipedia.org/wiki/IEC_61499 ; Eclipse 4diac LIB https://eclipse.dev/4diac/en_lib.php [practice/docs]
- PackML / ISA-TR88.00.02 via OPC Foundation reference https://reference.opcfoundation.org/PackML/v101/docs/?r=10&t=2 ; ISA-88 phase states https://etechgroup.com/blog/general/part-3-of-3-understanding-s88-states [practice/docs]
- Fakih et al., "LLM4PLC", ICSE-SEIP 2024. https://arxiv.org/html/2401.05443v1 [paper]
- Orkin, "Three States and a Plan: The AI of F.E.A.R.", GDC 2006. https://pages.cs.wisc.edu/~dyer/cs540/handouts/gdc2006_orkin_jeff_fear.pdf [practice]
- Muñoz-Avila, Aha, Rizzo, "ChatHTN", PMLR 288, 2025. https://arxiv.org/abs/2505.11814v1 [paper]
- Findler & Felleisen, "Contracts for Higher-Order Functions", ICFP 2002. https://users.cs.northwestern.edu/~robby/pubs/papers/ho-contracts-techreport.pdf [paper]
- Benveniste et al., *Contracts for System Design*, FnT EDA 12(2-3), 2018. https://nowpublishers.com/article/Details/EDA-053 [paper]
- Zelikman et al., "Parsel", NeurIPS 2023. https://arxiv.org/abs/2212.10561v3 [paper]
- Stengel-Eskin, Prasad, Bansal, "ReGAL", ICML 2024. https://arxiv.org/abs/2401.16467 [paper]
- Silver et al., "Generalized Planning in PDDL Domains with Pretrained LLMs", AAAI 2024. https://arxiv.org/abs/2305.11014v2 [paper]
- Lehrach et al., "Code World Models for General Game Playing", 2025/ICLR 2026. https://arxiv.org/abs/2510.04542v1 [paper; numbers unverified]
- Xu et al., "Agents Play Thousands of 3D Video Games" (PORTAL), 2025. https://arxiv.org/abs/2503.13356v1 [paper; numbers unverified]
- Izzo, Bardaro, Matteucci, "BTGenBot", 2024. https://arxiv.org/abs/2403.12761v2 ; BTGenBot-2 https://arxiv.org/html/2602.01870v1 [paper; BTGenBot-2 claims unverified]
- Wu et al., "StateFlow", 2024. https://arxiv.org/abs/2403.11322v4 [paper]
- Zeller & Hildebrandt, "Simplifying and Isolating Failure-Inducing Input", IEEE TSE 28(2), 2002. https://www.st.cs.uni-saarland.de/papers/tse2002/tse2002.pdf [paper]
- Armstrong, PhD thesis 2003 (supervision trees). https://mirror.its.dal.ca/freebsd/distfiles/erlang-doc/r13/armstrong_thesis_2003.pdf [paper; I read about it but did not use it above]

### Repo files cited
All under `/home/user/workflow-foundry/`:
- `experiments/jit/flow-v2.mjs`
- `experiments/jit/run-compiled.mjs`
- `experiments/jit/profile.mjs`
- `experiments/runs/jit/jit-dev-records-1/*/versions/*/solve.mjs`
- `research/jit-20261008/{THESIS-JIT,SPEC,DEV-NOTES}.md`
- `research/jit-20261008/nversion-records-dev.json`
- `research/jit-20261008/tierdown/live-rules-haiku.md`
- `beds/gridquest/README.md`
- `beds/gridquest/diagnostics.mjs`
- `beds/gridquest/solver.mjs`
- `beds/gameqa/README.md`
- `research/review-20261007/02-ir-expressiveness.md`
- `research/review-20261007/11-NEXT.md`
- `README.md`

## Agent result 9

# Dossier: throughput under quota (B10 and scheduling on a 4-vCPU VM)

*Evidence class: development and diagnostic only. Repo numbers marked **[repo]** were recomputed read-only at $0 on 2026-10-09 from `experiments/runs/jit/*/{results,faults}.jsonl` and `traces/`. Nothing below is claim-bearing. Tags: **[paper]**, **[practice/docs]**, **[inference]**. This builds on FRONTIER-GAPS without repeating it. FRONTIER-GAPS already has J3, J4, O6, the quota proxy per arm, D14, "Opus-heavy work off-peak" and RouteLLM's strong-model-percentage knob, and none of that is restated here.*

---

## Blocker B10: the account usage quota caps throughput

### 1. Mechanism

**Timeline [repo].**
- 252 stream rows were written across 12 arms in two families.
- The first row landed at 2026-10-08T23:37:03Z. By 23:47:23, 88 rows had landed, about $19 at list price in roughly 10 minutes. That was the peak burn rate.
- Between 23:47 and 23:51, 74 faults were logged, 71 of them `MODEL_RATE_LIMIT`.
- The next row landed at 02:54:24. That is a **187-minute gap**, which is the "about 3 h" figure in FRONTIER-GAPS J4.
- Hour 03 then wrote 117 rows, so the work was queued and ready. Nothing ran in between.

**The limit covers every model.** The faults hit the Haiku agent arms (19 fault rows in records, 20 in kinetics) as much as the Opus and Sonnet arms.
- Claude Code's docs say the session and weekly limits on a subscription are "shared across all models, so the developer can't restore access by switching models" [practice/docs: Claude Code, *Manage costs*].
- So during a lockout, cheap models buy no throughput at all. Before a lockout, they help only in proportion to their weight in the quota, and nobody has measured that weight.

**Most of the demand comes from other tenants.** Orchestration consumes most of the quota, and experiments are a small share.
- `research/review-20261007/10-STATE.md` §3.10 records 255 subagents at $1,820 list (Opus $1,142, Sonnet $678), against about $100 of experiment calls. That is about 20×.
- On 10-08 alone, 138 agents spent $1,213 [repo].
- The README records an earlier full stop, 2026-10-06 20:00 to 10-07 11:00, in which 14 agents failed. The 7-day meter has sat at `allowed_warning` until 2026-10-14 11:00 (`research/review-20261007/01-requirements.md` #20).
- So the experiment streams stall because of load from orchestration in the same session.

**The code treats exhaustion as an outside event.**
- `MODEL_RATE_LIMIT` is classed as an environment fault (`experiments/lib/runner.mjs:19`, `src/verdict.mjs:16`).
- `stream.mjs` retries once and then raises `EnvFault` (`stream.mjs:383-405`).
- The flat pool keeps draining after that (`stream.mjs:703-708`). Every queued agent job starts a sandbox and a CLI process, fails, retries, and is written as a fault row. That is where the 19–20 fault rows per Haiku agent arm come from, all inside 4 minutes.
- A JIT stream stops at its first fault (`stream.mjs:718`). Resuming is manual: `resume-streams.mjs` says it is "used after an environment stop".
- There is no circuit breaker, no awareness of when the window resets, and no automatic resume.

**A meter exists, but Foundry throws it away.**
- Earlier agent transcripts carried rate-limit events with five-hour and seven-day utilisation:
  - `research/core-20261006/diagnosis-workflow-agent.md:164`: up to 0.91 and 0.90, status `allowed_warning`;
  - `research/construction-20261006/diagnosis/B0-haiku-records.md:72`: 7-day 0.51–0.52.
- `src/executors/claude-code.mjs` asks for `stream-json` (line 145), but it parses only assistant `usage`, `result` and `init` events (lines 114–172).
- The gateway provider runs `--output-format json` (`policy/models.json`), so it sees no meter at all.
- The system therefore runs blind until the 429 arrives.

**The stall also damages the measurements.**
- The 187-minute stall outlives every cache TTL, so every resumed arm starts with a cold cache. That is J3's problem, now made concrete.
- Arms resumed at different task indices and clock times, which adds a time-of-day confound between arms.
- PREREG-stream:59 says "an arm whose environment faults exceed 25% of its tasks is reported as invalid". It does not say whether that means fault *events* or *unresolved* faults. Under the first reading, the records Haiku agent arm (19 fault events on 24 tasks) is invalid. Under the second, it is clean. The ambiguity needs resolving before the held-out run [inference].

**The same interpretations are paid for twice.** This is new.
- JIT roles `interpreter`, `shadow`, `adjudicator` and `fallback` all call the same `interpret()` as the `agent:<model>` arms (`stream.mjs:393-399` into `interpret.mjs` `b0Agent({id:'jit-interpreter', …})`). Task, budget, timeout and effort come from the same config.
- A JIT arm's Opus interpretation of seed *s* is therefore a draw from the same distribution as the Opus agent arm's run on seed *s*, and it is bought again.
- Upper bound on JIT spend that a same-model agent arm could have served [repo]:

| arm | shareable spend | share of arm spend |
|---|---|---|
| records O/H | $5.16 of $7.53 | 69% |
| records S/H | $3.27 of $8.99 | 36% |
| records H/H | $0.81 | 14% |
| kinetics S/H | $1.88 | 10% |
| kinetics O/H | none | no Opus agent arm in kinetics |

### 2. Ideological root

The blocker exposes three linked beliefs:
1. **The meter is dollars.**
2. **Parallelism is free.** Concurrent work adds cost but not contention.
3. **A 429 is an outage, not a signal.**

All three come from building a measurement harness, not an economy.

**Measured against the end-to-end vision:**
- The vision's economic claim is that code and cheap models make most decisions, and frontier models demonstrate or adjudicate rarely.
- Foundry's own development runs as "Opus or Sonnet agent every time": 20× orchestration, in the costliest arm shape. The quota stall is the thesis's argument turned on the system that builds it.
- The vision also promises a cost/reliability slider, swarms, async work and replication of users' recurring workflows. A real subscription user shares one window across chat, Claude Code and Foundry. A Foundry that cannot pace itself under a shared, all-model, rolling window cannot serve "arbitrary recurring work" for that user [inference].

**For the assumption to hold, one of these would have to be true:**
- (a) Demand stays below the window's refill rate at all times.
- (b) A lockout costs only the reset wait, with automatic resume and no harm to validity.
- (c) Quota weight per model and token class tracks list dollars, so the dollar proxy is enough.

None has been measured. (b) is already contradicted: the resume was manual, caches went cold, and arms drifted out of step in time.

### 3. Frontier

**Provider mechanics** [practice/docs]:
- Anthropic's API rate limits use a **token bucket**: "capacity is continuously replenished up to your maximum limit, rather than being reset at fixed intervals". Short bursts can trip per-second enforcement of a per-minute limit.
- Limits are **cache-aware**. For most models, `cache_read_input_tokens` do not count toward ITPM. 429s carry `retry-after`, and responses carry `anthropic-ratelimit-*-remaining/reset` headers.
- The Batch API bills at 50%. Cache writes cost 1.25× (5-minute TTL) or 2× (1-hour TTL). Cache reads cost 0.1× [practice/docs, seen in search].
- On subscriptions, Claude Code describes a rolling five-hour window plus a weekly window. `/usage` attributes usage to subagents and flags cache misses. An `autoContinueAtUsageLimit` setting waits for the reset and continues. The cache lifetime is "an hour on a subscription".
- **Unavailable here:** there is no API key (README D1-aws; the credentials rule), so headers and the Batch API cannot be reached on this route. Only the CLI's stream events can be.

**Fair sharing of LLM serving:**
- **VTC** (Sheng et al., OSDI 2024) [paper] replaces per-client request limits with token-weighted fair queuing. It is work-conserving and bounds the service gap between backlogged clients to 2× a tight bound.
- **QLM** (Patke et al., SoCC 2024) [paper] puts batch and interactive requests in one queue. A request-waiting-time estimator drives pulling, eviction and model swapping, reported at +40–90% SLO attainment.

**Overload practice:**
- **Google SRE, "Handling Overload"** [practice/docs]:
  - client-side adaptive throttling: a client keeps sending until `requests` reaches K × `accepts` over 2 minutes, with K = 2 preferred, then rejects locally;
  - four criticality classes, CRITICAL_PLUS down to SHEDDABLE;
  - per-customer quotas that are deliberately oversubscribed.
- **Brooker, "Exponential Backoff and Jitter"** [practice/docs]: full jitter cuts total work against synchronised retries.

### 4. Niche verticals

**(a) Ad-tech budget pacing.**
- Agarwal, Ghosh, Wei, You (KDD 2014) [paper, abstract level]: in per-impression auctions, "high-performing advertisers exhaust their budgets early and leave the auction". Pacing spreads spend over the period using a forecast of supply.
- That is our pattern exactly: a 10-minute burn, then 3 hours locked out.
- **Mechanism:** a throttle probability per campaign makes cumulative spend follow a target curve up to the end of the period.
- **Adaptation:**
  - The target curve for the 5-hour window is u*(t) = u₀ + (1 − m − u₀)·(t − t₀)/(reset − t₀), where m is a reserve margin of about 0.1. The weekly curve is an outer constraint.
  - Each arm gets a multiplicative pacing factor that falls while its meter-attributed burn is ahead of the curve.
  - A SHEDDABLE job is admitted only while u(t) < u*(t).

**(b) Carbon-aware temporal shifting.**
- Radovanović et al., "Carbon-Aware Computing for Datacenters" (Google, 2021) [paper]: daily *Virtual Capacity Curves* cap hourly capacity for workloads that can be delayed but must finish within 24 hours. Search, YouTube and other serving traffic is never shifted.
- **Adaptation:** a *quota capacity curve* for each window.
  - Reserve capacity for owner-interactive work and in-flight preregistered runs.
  - Shift work that can wait (review lanes, dossier sweeps like this one, Opus family generation for Bet B) into windows forecast to have headroom.
- Weekly reset times differ by account, per the third-party guides found in search (unverified), so the curve should be keyed to the reset time the meter reports.

**(c) SRE criticality with oversubscribed tenant quotas.** Each Foundry tenant gets a class and a quota share.

| class | Foundry tenant |
|---|---|
| CRITICAL_PLUS | owner-interactive sessions |
| CRITICAL | in-flight preregistered or held-out arms |
| SHEDDABLE_PLUS | dev streams |
| SHEDDABLE | reviews, sweeps, Kev data factories |

- Shares may sum to more than 1, as the SRE text allows.
- When the meter warns, shed by class, not first-in-first-out.

**(d) FinOps unit economics and showback.**
- The FinOps Framework's unit-economics capability [practice/docs, via Microsoft Learn and finops.org]: choose the business unit, map it to the services that support it, split shared costs by measured use, and report unit cost as a KPI.
- **Adaptation:**
  - The unit is one *accepted success*. Its cost is in quota units, not dollars.
  - Orchestration (subagents, the main session) is the shared cost, split over the experiments it served.
  - run-view shows quota per success for each workflow and each tenant.
- This turns the 20× from an aside in 10-STATE into a line item someone is accountable for.

**(e) Common random numbers from simulation methodology** [inference; textbook technique, no citation verified here].
- Comparing simulated systems by driving them with the same random draws lowers the variance of the *difference*.
- **Adaptation:** a *draw ledger*. JIT interpreter, shadow and adjudicator roles take an unused draw of the same (task, model, interpreter-config) from the agent arms instead of buying a new one.
- This saves quota and also tightens paired comparisons. See experiment QE1.

**(f) Cache economics.**
- In the API, cached reads are exempt from ITPM. Whether the subscription meter discounts them is **unverified**.
- Repo facts:
  - the policy forces `FORCE_PROMPT_CACHING_5M=1` (cheaper list-price writes);
  - the subscription default TTL is 1 h;
  - "an identical request repeated still writes ~1,200 cache tokens and reads only the CLI's constant ~883" (`04-efficiency-rust.md:157`).
- So Foundry's prompts have **no stable cacheable prefix** across calls.
- **Adaptation:** order every builder, interpreter and judge prompt static-first (SDK docs, family spec, schema, then the variable task). Measure quota per call under a 5-minute versus 1-hour TTL only after the meter exists (QE2).

### 5. Creative options

1. **A quota governor in the port and executor.** This is a patch.
   - Pacing curve, as in (a).
   - Criticality classes, as in (c).
   - SRE throttling: after K = 2 consecutive `MODEL_RATE_LIMIT`, park every SHEDDABLE job.
   - Full-jitter backoff.
   - Automatic resume at the meter's `resetsAt`.
2. **Evaluation by shared draws.** This changes the problem.
   - Evaluation cost becomes the cost of the *union* of draws, not Σ over arms.
   - J2 already requires K ≥ 2 agent streams per arm. Those two draws per (task, model) then *are* the shadow and adjudicator pool for every JIT arm on that model. The K ≥ 2 requirement and the shadow budget become the same spend.
3. **Run Foundry's own orchestration as Foundry streams.** This changes the problem.
   - Dossier sweeps, review-of-review passes, hidden-path scans and audit packs recur constantly, and they are the 20×.
   - Make them the first real-world stream: interpret with Opus once, compile the sweep and audit procedure, run Haiku and code, and shadow-sample with Opus.
   - The quota blocker becomes the vision's first owner-relevant capability number: the share of orchestration decisions made by code or Haiku at equal review acceptance.
4. **A shadow price on the slider.**
   - The pacing controller keeps a Lagrange multiplier λ(t) on quota.
   - The router (FRONTIER G1) prices an interpretation, shadow or compile as quota × λ(t). When the window runs ahead of its curve, λ rises, and the system automatically shadows less and interprets less.
   - The slider stays a declared W (FRONTIER G4). λ is the live exchange rate.
5. **Window anchoring.**
   - If the 5-hour window starts at first use (third-party guides say so; unverified), a $0.0005 Haiku probe can open it deliberately so that its reset lands where heavy work will need the room [inference].

### 6. Experiments, ranked

**QE1. Shared-draw audit and design amendment.** $0, no quota, 2–3 h.
- **Build:** `experiments/jit/audit/draws.mjs`.
  - Over `traces/*.json`, test request equivalence: model, effort, `budgetUsd`, `timeoutMs`, `taskSha256`, interpreter id, CLI version and `policyVersion`. All are in the trace (`interpret.mjs:126-140`) or the arm config.
  - Compute the share of JIT interpreter-role spend a same-model agent draw could replace.
  - Tabulate pass rates of JIT-role draws against agent-arm draws on the same (task, model) pairs. This is descriptive, with small n.
- **Metric:** replaceable spend and quota per arm. The upper bounds above are 69% for O/H and 36% for S/H.
- **Baseline:** independent draws, as now.
- **Preregistration:** the shared-draw design and a paired analysis must be written into the P10 PREREG-stream amendment *before* any held-out run, including the rule that the 2nd and 3rd draws per (task, model) come from K = 2–3 agent streams.
- **Kill rule:** do not adopt if any config field differs, or if JIT-role and agent-arm draws on the same pairs differ by ≥ 3 passes (the noise band).
- **Falsified if:** the requests are not equivalent (for example, JIT interpreters see extra context), or the draw distributions measurably differ.

**QE2. Meter capture and a fitted quota weight per token class.** About $1–3, low quota, half a day.
- **Build:**
  - `experiments/lib/meter.mjs`, which pulls rate-limit events out of `stream-json` transcripts. Do it there first, because `src/` sits under frozen-kit discipline.
  - `experiments/lib/quota-probe.mjs`: one Haiku `stream-json` call every 10 minutes, logging (t, five-hour utilisation, seven-day utilisation, reset time).
  - Regress Δutilisation between probes on tokens by model × {input, output, cache write, cache read}. The token counts come from gateway journals plus `research/replicate-20261008/harness-cost.mjs` run over subagent transcripts.
- **Metric:** mean absolute error of the Δu prediction on held-back intervals; weight ratios Opus:Sonnet:Haiku; the weight of a cache read.
- **Baseline:** list dollars as the only predictor.
- **Preregistration:** diagnostic only. Freeze the fitting procedure and the train/test split by time before reading results.
- **Kill rule:** if `-p` sessions on this account emit no utilisation field, or its resolution is ≥ 1% per step against an expected Δu of a few % per interval, the meter cannot drive pacing. Fall back to AIMD driven by faults.
- **Falsified if:** list dollars predict Δu within 20% of the fitted model. Then the dollar proxy in FRONTIER J4 is enough, which is the simpler answer.

**QE3. Governor A/B across windows.** $0 simulation, then about $20–40 list, medium quota, 1–2 days of wall clock.
- **Build:** `experiments/lib/quota-governor.mjs`:
  - a token bucket in QE2 quota units;
  - the pacing curve;
  - classes;
  - a breaker at K = 2;
  - jittered auto-resume.
  - Hook it into `stream.mjs`'s `pool()` and the JIT loop, and retire the manual `resume-streams.mjs`.
- **Step 1, $0:** a discrete-event replay of the 10-08/09 load (252 stream rows plus subagent token timelines) under the governor and as it actually happened. Output: predicted stall minutes and finished tasks.
- **Step 2, live:** ABAB across four consecutive 5-hour windows with identical queued dev work (records fresh dev seeds 249–272, Haiku agent plus JIT S/H). These seeds must not overlap P4b's 225–248.
- **Metrics:**
  - tasks finished per 10 h;
  - stall minutes;
  - outcome invariance: pass rates must sit within the noise band, because the governor should not change outcomes.
- **Kill rule:** if the governed windows finish fewer tasks than the ungoverned ones.
- **Falsified if:** automatic resume plus the breaker alone (arm C) captures ≥ 80% of the gain. Then pacing is unnecessary machinery.

---

## Blocker B10b: scheduling many concurrent streams and workflows on 4 vCPUs

### 1. Mechanism

**Per-call CPU is the fixed cost.**
- One `claude -p` start costs about 0.85 core-seconds, and about 0.56–0.67 with the 2026-10-08 flags.
- This VM tops out at 2.3 calls/s, or 3.4 with the flags. Throughput by concurrency: K=1 0.52, K=4 1.49, K=6 1.89, K=8 2.34 calls/s, sublinear past about K = 4–6 [repo: `research/review-20261007/04-efficiency-rust.md` lines 36–37, 160–161].

**There is no admission control at machine level.**
- `stream.mjs:693` builds one ModelPort per arm with `concurrency: {'claude-cli': 16}`. Flat agent jobs run at `config.concurrency` (3).
- `resume-streams.mjs` starts every arm as its own detached process, so the semaphores are per process. Thirteen arms × 16 slots are "allowed".
- On the same VM at the same time:
  - other workflows' `node --test` suites (THESIS-JIT §3.3: "six node test processes and a heal trial at once");
  - sandbox launches (about 200 ms of CPU each);
  - the heal probe at load average about 8 (`heal-20261008/DESIGN.md:783`).
- From in-flight intervals rebuilt from `at − latencyMs`, the peak was **19 concurrent task rows**, each possibly running several CLI children [repo].

**Queueing amplifies this.**
- Kingman's VUT approximation [paper: Kingman 1961, via secondary sources]: W_q ≈ (ρ/(1−ρ)) · ((c_a² + c_s²)/2) · E[S]. Waiting time explodes as ρ approaches 1, and bursty arrivals (whole stream batches starting together, then a resume surge) multiply it.
- In Foundry, latency feeds hard timeouts (`agentMinutes` 15, `compiledMinutes` 20). `EXECUTOR_TIMEOUT` is **not** in `ENV_FAULTS` (`runner.mjs:19`), so CPU contention can become task *failures* charged to whichever arm ran long.
- Descriptively [repo, confounded by task mix and arm]:

| in-flight concurrency | rows | pass | median latency |
|---|---|---|---|
| ≤ 6 | 37 | 29/37 (78%) | 84 s |
| ≥ 10 | 206 | 149/206 (72%) | 109 s |

  The difference is not causal evidence, but nothing currently rules it out.
- An earlier case: core REPORT row 2 scored timeouts as failures (b0ncall lost 42% of trials), and the cause was never measured.
- `latencyMs` mixes service time with queueing time, so any feature built on latency (router inputs, durability's time-to-durable) is contaminated.
- The rate-limit drain (B10) also spent CPU starting sessions that could not run.

### 2. Ideological root

**Assumption:** the VM is a neutral substrate, each workflow effectively owns the machine, and concurrency is a parameter local to each component.

**Measured against the vision:** swarms, subagents, a board, async streams, many concurrent workflows, and reuse by *other programs*. That is a multi-tenant runtime. Foundry's runtime is single-tenant per process, with tenancy implied by the process boundary.

**For the assumption to hold, one of these would have to be true:**
- one Foundry process per machine;
- every tool (CLI, node test runner, sandboxes) honours one shared limit;
- the offered load stays below the knee at about K = 6.

None holds today. The deeper error is the same as in B10: a capacity limit is treated as noise in the environment, when it is a resource the system itself must schedule.

### 3. Frontier

- **Adaptive concurrency limits.** Netflix `concurrency-limits` [practice/docs] applies TCP congestion-control ideas to find the largest in-flight limit before latency degrades, instead of hand-tuned caps.
- **One queue for mixed work.** QLM [paper] puts batch and interactive work in a single queue, driven by a waiting-time estimate.
- **Backfilling.** HPC batch schedulers fill holes in the machine without delaying the job at the head of the queue (Mu'alem and Feitelson, IEEE TPDS 2001) [paper]. Two counter-intuitive findings:
  - EASY (aggressive) backfilling wins on SP2-typical workloads;
  - backfilling did better when users *overestimated* runtimes.
- **Cost-of-delay ordering.** Reinertsen's WSJF (cost of delay ÷ duration) beats FIFO, highest-value-first and shortest-job-first when delay costs and durations vary [practice/docs, secondary sources; book not opened].

### 4. Niche verticals

**(a) The GNU make jobserver.**
- [practice/docs, via LLVM `Jobserver.h`, the Rust `jobslot` crate and GNU make `posixos.c`] A FIFO pre-loaded with one token per job slot. Every cooperating process, including nested and independent tools, reads a token to take a slot and writes it back to release it.
- Each child has one implicit slot that it never returns. Clients must return tokens on every exit path. Discovery is through `MAKEFLAGS` (`--jobserver-auth=fifo:PATH`).
- This is exactly the missing piece: limits that cross processes and tools without a daemon.
- **Adaptation:** `.foundry/jobserver.fifo` holding N tokens, with N starting at 6 (the measured knee).
  - ModelPort's `Semaphore.acquire` and `runClaudeCode` also take a token before spawning.
  - The test runner wrapper passes `--test-concurrency` equal to the tokens it obtained.
  - Leases time out so a crashed holder cannot deadlock the pool.

**(b) HPC backfilling** [paper].
- Opus agent sessions (median 108 s, maximum 182 s) and builder sessions are the "big jobs". Haiku gateway calls (about 1 s) are the backfill.
- Under EASY, a short call may jump ahead only if it does not delay the reserved start of the job at the head of the queue.
- Following the paper's estimate result, use generous runtime estimates taken from each role's p90 latency.

**(c) Linux cgroup v2 CPU weights per criticality class** [inference; standard kernel feature, documentation not opened in this pass]. Run each class in its own slice with `cpu.weight`:

| class | weight |
|---|---|
| owner-interactive | 1000 |
| held-out arms | 400 |
| dev arms | 100 |
| tests and reviews | 25 |

Contention then lands on SHEDDABLE work, not on timed experiment arms. This is the SRE criticality scheme from B10(c), applied to CPU.

**(d) Lot sizing (job-shop setup costs)** [inference; economic-order-quantity reasoning, citation not verified].
- When every job carries a fixed setup cost (0.85 core-seconds per CLI start), the optimal batch size balances setup cost against waiting cost.
- **Adaptation:** a `flow.judgeBatch` path that sends B low-leverage per-item judgments in one call. That divides start-up CPU and request count by B.
- D11's leverage rule limits which judgments can be batched. Global readings never are.

**(e) WSJF on the cross-experiment queue.**
- Order runnable work by expected decision value ÷ expected quota-and-CPU cost.
- For example, FRONTIER §4.3's advice to finish kinetics O/H before S/H becomes a computed priority, not a note.

### 5. Creative options

1. **Host jobserver plus adaptive N.** This is a patch.
   - The FIFO from (a), with N adjusted by AIMD on p90 latency of trivial probe calls: add 1 while latency stays flat, halve on a 1.5× jump.
2. **A second worker node.** This changes the problem.
   - Compiled solver runs, `check-traces`, test suites and $0 replays need no model quota. They can run on the owner's laptop over the existing Kev bridge, which already has a nonce journal and caps.
   - The VM becomes the model-call node only.
   - This needs owner sign-off on scope, and it keeps D10: no third-party text reaches executors.
3. **Batched judgments.** As in (d). This changes the shape of the work, not the scheduler.
4. **Timeouts as environment faults where contention is likely.**
   - Record host load (`load1`, CPU busy share, number of `claude` children) on every row.
   - Reclassify a timeout that happens under load above threshold T as an environment fault.
   - Preregister T. It must not be chosen after seeing outcomes.

### 6. Experiments, ranked

**CE1. Contention-confound audit.** $0, no quota, 2 h.
- **Build:** `experiments/jit/audit/contention.mjs`.
  - Rebuild in-flight concurrency per row from `(at − latencyMs, at)` across *all* arms and families.
  - Model pass and timeout against concurrency, stratified by arm × difficulty.
  - Add `host:{load1, cpuBusy, claudeChildren}` to future rows. That is a `stream.mjs` `finish()` change, opt-in, so existing config hashes do not move.
- **Metric:** odds ratio for timeout or failure at concurrency ≥ 10 versus ≤ 6, within strata.
- **Baseline:** none. This is diagnostic.
- **Kill rule:** none, because it is $0.
- **Falsified if:** within strata, the odds ratio's CI includes 1 *and* no timeout rows sit at high concurrency. Then contention is not a validity threat for these families and CE2 is only a throughput fix.

**CE2. Jobserver against per-process semaphores.** About $0.05 of trivial Haiku calls or a $0 stub CLI, about half a day.
- **Build:** `experiments/lib/jobserver.mjs`, a token FIFO with leases. Wire it optionally into the ModelPort and `runClaudeCode`.
- **Test:** reuse the b22 harness from `04-efficiency-rust` with 4 processes offering a total K of 4, 8, 16 and 32.
  - Arm A: per-process semaphores.
  - Arm B: jobserver at N = 6.
  - Arm C: jobserver with AIMD.
- **Metrics:** calls/s, p50/p95 latency, and the share of calls above a 30 s synthetic timeout.
- **Preregistration:** freeze N, the AIMD constants and the load levels beforehand.
- **Kill rule:** any token-leak deadlock in 1,000 calls.
- **Falsified if:** B and C are within 10% of A on p95 at offered K ≥ 16. That would mean the CLI already back-pressures itself.

**CE3. Batched low-leverage judgments.** About $1–2, low quota.
- On archived records traces, replay the `vendex-entries` or same-entity judge with B = 1 against B = 10 using `tierdown-e2e.mjs`.
- **Metrics:** end-to-end dev-oracle pass (analyst side only), CPU-seconds and quota per task.
- **Kill rule:** end-to-end pass drops by ≥ 1 of 8 tasks.
- **Falsified if:** batching changes decisions on any task where the per-item version was right.

---

## How the two blockers interact

**One fault, two meters.** Both blockers come from one design fault: Foundry has **no scheduler for shared resources**, only local semaphores and an exception path. Quota and CPU are each a shared bucket that every tenant can drain. Neither is metered at the point of admission, and neither runs out in a way that is "environmental".

**They amplify each other:**
- CPU contention stretches session wall time. That raises the quota held per minute of useful work and pushes runs into timeouts that are then retried.
- The quota cliff then turns into a resume surge. Thirteen detached arm processes and the queued agent jobs restart together. That bursty arrival is exactly what Kingman's variability term punishes, so the first minutes after a reset are CPU-saturated.
- On the evidence side, the 3-hour stall plus uneven CPU load add timing and contention confounds that the preregistration does not model. That makes K = 1 dev comparisons even weaker than their sample size suggests.

**One fix covers both.** A single admission layer carries two meters (quota units from QE2 and CPU tokens from CE2), one set of criticality classes, one pacing curve and one WSJF-ordered queue. It turns both blockers from stalls into prices.

**The changes to the problem are what carry the vision forward:**
- Shared draws cut quota per comparison and tighten paired analysis.
- Compiling Foundry's own orchestration attacks the 20× directly, on the workload the owner actually runs. It is the closest thing the project has to the "real users' recurring workflows" in the e2e vision, and success there would be the first capability number measured in the currency that actually binds.

---

## Sources

**[paper]**
- Sheng et al., "Fairness in Serving Large Language Models", OSDI 2024. https://usenix.org/conference/osdi24/presentation/sheng and https://arxiv.org/abs/2401.00588v2 (seen in search)
- Patke et al., "Queue Management for SLO-Oriented Large Language Model Serving" (QLM), SoCC 2024. https://arxiv.org/abs/2407.00047v2 (seen)
- Mu'alem & Feitelson, "Utilization, Predictability, Workloads, and User Runtime Estimates in Scheduling the IBM SP2 with Backfilling", IEEE TPDS 12(6), 2001. https://www.cse.huji.ac.il/~feit/papers/SP2backfil01TPDS.pdf (seen)
- Radovanović et al. (Google), "Carbon-Aware Computing for Datacenters", 2021. https://arxiv.org/abs/2106.11750 (seen)
- Agarwal, Ghosh, Wei, You, "Budget Pacing for Targeted Online Advertisements at LinkedIn", KDD 2014. https://doi.org/10.1145/2623330.2623366 (seen; abstract level only)
- Kingman, "The single server queue in heavy traffic", 1961, via https://en.wikipedia.org/wiki/Kingman%27s_formula (secondary)

**[practice/docs]**
- Anthropic, "Rate limits". https://platform.claude.com/docs/en/api/rate-limits (opened)
- Claude Code, "Manage costs effectively". https://code.claude.com/docs/en/costs (opened)
- Anthropic, batch processing and prompt caching docs. https://platform.claude.com/docs/en/build-with-claude/batch-processing and https://docs.claude.com/en/docs/build-with-claude/prompt-caching (seen in search)
- Google SRE Book, "Handling Overload". https://sre.google/sre-book/handling-overload/ (opened)
- Brooker, "Exponential Backoff and Jitter", AWS Architecture Blog. https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ (seen)
- Netflix, `concurrency-limits` and "Performance Under Load". https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581 (seen)
- GNU make jobserver, via LLVM `Jobserver.h` (https://llvm.org/doxygen/Jobserver_8h_source.html) and GNU make `posixos.c` (https://gnu.googlesource.com/make/+/7d484017077089a/src/posixos.c) (seen; official manual section not opened)
- FinOps unit economics. https://learn.microsoft.com/en-us/cloud-computing/finops/framework/quantify/unit-economics (seen)
- Reinertsen WSJF, via https://blackswanfarming.com/wsjf-weighted-shortest-job-first/ (secondary; book not opened)

**Unverified:** subscription window anchoring and weekly reset rules (third-party guides only); whether the subscription meter discounts cache reads; the common-random-numbers and lot-sizing textbook citations; cgroup `cpu.weight` documentation (not opened in this pass).

**Repo files cited:**
- `/home/user/workflow-foundry/experiments/jit/stream.mjs`
- `/home/user/workflow-foundry/experiments/jit/interpret.mjs`
- `/home/user/workflow-foundry/experiments/jit/resume-streams.mjs`
- `/home/user/workflow-foundry/experiments/lib/runner.mjs`
- `/home/user/workflow-foundry/src/executors/claude-code.mjs`
- `/home/user/workflow-foundry/src/models/port.mjs`
- `/home/user/workflow-foundry/policy/models.json`
- `/home/user/workflow-foundry/research/review-20261007/10-STATE.md`
- `/home/user/workflow-foundry/research/review-20261007/04-efficiency-rust.md`
- `/home/user/workflow-foundry/research/core-20261006/diagnosis-workflow-agent.md`
- `/home/user/workflow-foundry/research/jit-20261008/{THESIS-JIT,DEV-NOTES,FRONTIER-GAPS,PREREG-stream}.md`
- `/home/user/workflow-foundry/experiments/runs/jit/jit-dev-{records,kinetics}-1/*/{results,faults}.jsonl`
