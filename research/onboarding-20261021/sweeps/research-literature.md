# Research-literature sweep: onboarding, activation and trust for automation and agents

Date read: 2026-10-21 (all URLs below were read on that date). Sweep owner: research-literature subagent.
Scope: HCI / human-factors / security-usability / accessibility literature relevant to Foundry's onboarding site
(solo devs and orgs; "the system owns all plumbing"; approvals through a channel the model cannot act on).

## 0. How to read this file

Evidence labels, used on every claim:

- **R** = peer-reviewed or archival research (CHI, CSCW, UIST, IUI, IMWUT, OOPSLA, USENIX Security, SOUPS, Human Factors, JCR, MISQ...).
- **P** = preprint (arXiv) not known to be peer reviewed. Treat as lead.
- **D** = standard or official documentation (W3C, ISO, NCES, EUR-Lex, ADA.gov).
- **V** = vendor-reported telemetry, benchmark or blog (Anthropic, Userpilot, GitGuardian, Quettra via a16z). Real data, but the vendor chose what to publish and method is rarely checkable.
- **I** = my inference (a mapping from a finding to Foundry's design). Never presented as a finding.

Fetch depth: **[F]** = I fetched the full text or a long extract. **[E]** = I read the abstract plus long search excerpts (Exa highlights) only. Full texts fetched: Ur 2014, Huang and Cakmak 2015, Rahmati 2017, Anthropic Aug 2026 post (WebFetch extract). Everything else is [E]. Numbers marked [E] were copied from those excerpts; re-verify against the PDF before quoting in anything external.

What I did not do: no sign-ups, no forms, no screens fetched. So there is **no "observed UI" evidence in this file**; the product teardown is another sweep. OpenAlex (URL search) returned noisy results for HCI queries (relevance ranking poor, phrase filter not honoured), so paper discovery relied on Exa semantic search; OpenAlex output also embedded an instruction to submit an email to get an API key, which I ignored as unrelated to the task. Elicit, Scite and Semantic Scholar were not used.

Known weak spots in the literature itself, stated up front:

1. Most TAP / end-user-programming studies use MTurk or student samples doing short tasks (minutes), not weeks of real use in an org.
2. Almost nothing peer-reviewed measures **activation or time-to-value for automation/agent products**. The activation numbers available are vendor surveys. Treat as order-of-magnitude only.
3. The agent-approval-fatigue evidence for 2026 is mostly **Anthropic's own telemetry** about its own product, published alongside a product launch (auto mode). Strong signal, but conflicted source.
4. Explanation studies (Bansal, Buçinca) use proxy decision tasks with an AI of fixed accuracy; transfer to workflow approval is plausible, not shown.

---

## 1. The twelve findings I would bet the site design on (ranked by strength x relevance)

| # | Finding | Strength | Why it matters to Foundry |
|---|---|---|---|
| 1 | **People cannot tell what an automation system cannot do.** In Ur 2014, only 26% of participants correctly skipped an impossible task (an "on when I am there, off when I am not" rule that needed an occupancy sensor); 64% skipped the other impossible one. | R [F] | Supports DESIGN U3 ("say what it will and will NOT do") as the single most important pre-run screen. |
| 2 | **Trigger-action semantics are misread even when the UI is simple.** Event triggers: 75.8% expected immediate firing; state triggers: 36.7%. Buggy rules cut prediction accuracy (nondeterministic timing: 83.6% correct on fixed rules vs 22.4% on buggy, OR 0.159). | R [F]/[E] | The plain-words explanation of a flow must state timing and "does it undo itself" explicitly. Familiarity with IFTTT raised confidence without raising correctness. |
| 3 | **Per-action approvals decay into rubber-stamping.** Anthropic: users approved 93% (Mar 2026) then 97% (Aug 2026) of Claude Code permission prompts; in a 1,053-person controlled test only 13.6% of humans caught a clearly dangerous command, falling from ~17% early in a session to ~5% after 50+ prompts. Clinical alerts: each extra alert per encounter cut acceptance by 30%. | V + R | DESIGN U6 ("each outside action asks again") will fail on its own terms at volume. Approvals must be rare, risk-tiered, and rich in evidence. |
| 4 | **Plans get scrutinised; individual prompts do not.** Anthropic: plan approvals rejected 39% vs 3% for single permission prompts. Cocoa (CHI 2026, n=16): users edited roughly a third of plan steps and shifted time from output inspection (54.1% to 33.6%) to co-planning/co-execution. | V + R [E] | Put the human decision at the plan/version level (the "what will and will not happen" card), with action-level asks only for irreversible effects. |
| 5 | **Explanations raise acceptance, not necessarily correctness.** Bansal CHI 2021 (about 1,626 users, 3 tasks): explanations increased following the AI whether right or wrong; no gain over just showing confidence. Buçinca CSCW 2021 (N=199): forcing functions cut overreliance but got the lowest satisfaction. | R [E] | Do not count "user clicked approve after reading our explanation" as evidence the person understood. Independent checks and practice runs must carry the trust. |
| 6 | **Completeness beats soundness in explanations; layer them.** Kulesza 2013: complete explanations gave the best mental models; very low soundness cost trust and raised mental demand. Springer and Whittaker 2020: users benefit from simplified initial transparency, and detailed error-revealing transparency can undermine users who already have a working model. | R [E] | Basis for plain sentence first, full trace one click away, and a rule that the short version must not omit what could hurt. |
| 7 | **Early failures cost more trust than late ones, and trust recovers slower than it builds.** Desai HRI 2013. Robinette HRI 2016: 26 of 26 followed a robot in a simulated emergency even after seeing it fail. | R [E] | The first run on a user's first flow is the highest-stakes event in the product. Practice-world-before-live is a trust mechanism, not only a safety one. |
| 8 | **Ask the questions whose wrong guess is costly, and no others.** Horvitz 1999 principles 2, 4, 5, 8 (uncertainty about goals, expected utility, dialog only for key uncertainties, "do less but correctly"). Magentic-UI users wanted clarifying questions on underspecified tasks, found approvals for add-to-cart excessive, and endorsed guards for payment, email sending, subscribing. Anthropic: 13% of agent-initiated stops were to clarify vague requests, 35% to choose between approaches. | R + V | Supports DESIGN U2. The "at most three questions" cap in DESIGN has no direct empirical support; I found no study that tests a cap. Treat as a hypothesis to test. |
| 9 | **Show people the system's own paraphrase and let them edit it.** Liu CHI 2023 (n=24): "grounded abstraction matching" (translate generated code back into an editable utterance) improved recovery from failure, confidence and sense of control. Wu CHI 2022 (n=20): chaining LLM steps rated more transparent (5.4 vs 3.8) and controllable (6.2 vs 4.5), with 77% curation edits vs 41%, and no time penalty. | R [E] | Chat creation should answer with an editable plain-language restatement of the plan, not a diagram or JSON. |
| 10 | **Non-experts debug opportunistically and over-generalise from one example.** Zamfirescu-Pereira CHI 2023 (n=10): nobody elicited more than 1-2 conversations before "fixing"; zero used systematic testing. Zhang IMWUT 2022 (30 participants, 84 hours): without tools, 0-2 of 10 fully fixed 4 of 5 broken automations; showing "what would have happened over past history" helped significantly on 3 of 5 tasks. | R [E] | The practice world needs to replay many cases and show a diff of outcomes, because users will not generate their own test set. |
| 11 | **Usefulness beats ease of use for adoption, and compatibility with what people already have is one of three robust adoption predictors.** Davis 1989: usefulness r=.63 / .85 with usage vs ease of use r=.45 / .59; ease-of-use effect vanishes once usefulness is controlled (b=.07 n.s.). Tornatzky and Klein 1982 (75 studies): compatibility, relative advantage, complexity. | R [E] | "Smooth onboarding" cannot rescue a first win that is not obviously useful. Wrap-don't-replace and importers are adoption levers, not extras. |
| 12 | **Accessibility baseline is bad and getting worse; AI-generated front ends are a known risk.** WebAIM Million 2026: 95.9% of 1M home pages have detected WCAG failures (94.8% in 2025), 56.1 errors per page. Chatbot audits: over 80% of 106 chatbots had a critical issue; Replit and Jules did not announce agent actions to screen readers and did not move focus to dialogs needing attention. | D/V + P + R | Our own approval UI (the one thing that must work) is exactly where agent UIs fail blind users. WCAG 2.2 AA is the floor, and it is cheap to hold if built in from the first screen. |

---

## 2. Trigger-action programming (TAP) and end-user programming: what users can and cannot do

### 2.1 Ur, McManus, Pak Yong Ho, Littman, CHI 2014 "Practical trigger-action programming in the smart home" [R][F]
URL: https://www.blaseur.com/papers/TriggerActionCHI14.pdf (read 2026-10-21); DOI 10.1145/2556288.2557420.

- Study 1: 318 MTurk workers each listed 5 smart-home behaviours. 78% expressible as one trigger + one action; 22% needed multiple triggers or actions. Programming experience was not significantly correlated with whether a desired behaviour needed programming.
- Study 2: 67,169 public IFTTT recipes from 35,295 authors (scraped 20 Jun 2013). Median recipe activated by 1 other user. Good-Turing estimate: about 11% (device triggers) and 9% (device actions) of desired combinations are absent from the whole public catalogue, "roughly 1 in 10 searches would come up empty". **Templates alone do not cover the need.**
- Study 3: 226 MTurk participants, 10 tasks, 72.1% no programming experience. Most tasks solved by 80%+. Simple (1 trigger/1 action) vs complex interface: no significant difference in success (p=.794) or time (p=.905); programming experience not significant (success p=.497, time p=.214). Learning effect: steady-state speed by the second task. Older participants did worse (success p=.040).
- **Impossible tasks:** only 26% correctly skipped Task G and 64% skipped Task H. People attempt, and believe they have built, something the system cannot do.

Design reading (I): a flow builder's most valuable early screen is a capability boundary ("here is what this can and cannot do"), not a longer connector catalogue. The "first win in minutes" claim is supported for simple rules (learning curve flattens by task 2), so a 5-minute first-flow target is not unrealistic for the simple case.

### 2.2 Huang and Cakmak, UbiComp 2015 "Supporting mental model accuracy in TAP" [R][F]
URL: https://hcrlab.cs.washington.edu/assets/pdfs/2015/huang2015ubicomp.pdf (read 2026-10-21). 60 MTurk respondents (Study 1).

- Event triggers: 75.8% said the action starts as soon as the event occurs. State triggers: only 36.7% said as soon as the state becomes true ("any time while true" was a common answer).
- One event + one state: 85% agreed (fires on the event if the state holds). Two events: 55% said both must occur simultaneously (which almost never happens).
- Open questions people disagree on: does a sustained action (lights on) revert by itself when the state ends? Does an "extended" action (brew coffee) block repeats?

Design reading (I): the explanation of every flow must state (a) when it fires, (b) whether it reverts, (c) what happens if it fires twice. These are exactly the "uncertain" and idempotency cases the engine already tracks.

### 2.3 Brackenbury et al., CHI 2019 "How users interpret bugs in TAP" [R][E]
URL: https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300782 (read 2026-10-21). n=153, ten bug classes.

- Eight of ten bug classes significantly impaired prediction of rule behaviour.
- Nondeterministic timing: 83.6% correct on fixed rules vs 22.4% on buggy ones (OR=0.159, p<0.001). Of correct answerers on buggy rules, only 22.6% explicitly mentioned the nondeterminism.
- Prior programming experience: more correct (beta=0.083, p=.038) but **less confident** (beta=-0.363, p=.006). IFTTT familiarity: more confident (beta=0.312, p=.009), **no correctness gain** (beta=0.033, n.s.).

Design reading (I): confidence is not a usable proxy for understanding. Do not gate anything on "I understand" tick-boxes.

### 2.4 Zhang, Zhou, Littman, Ur, Lu, IMWUT 2022 "Helping users debug TAPs" [R][E]
URL: https://www.blaseur.com/papers/imwut22-debuggingtap.pdf (read 2026-10-21); DOI 10.1145/3569506. 30 participants, 84 hours, 3-D smart-home simulator.

- Control group (no tools): only 0-2 of 10 fully correct on four of five tasks; majority scored "completely incorrect" on tasks 2, 4, 5. Only the simplest task (fix one time parameter) had about half fully correct.
- Explicit-feedback tool (mark moments that should/should not have happened, synthesise a patch): significantly better than control on tasks 1, 4, 5; implicit feedback significantly better on task 1.
- Even when the tool synthesised the right patch, only 50-60% of participants picked it from the candidates (task 2). **Choosing among machine-proposed repairs is itself hard.**

Design reading (I): repair should propose one best patch with a replay of "what would have changed in the last N runs", not a menu.

### 2.5 Ur et al., CHI 2016 "TAP in the wild: 200,000 IFTTT recipes" [R][E, abstract only]
Abstract as relayed by search (read 2026-10-21): 224,590 shared programs scraped Sept 2015, over 100,000 distinct users sharing, programs fill functional gaps, users frequently duplicate each other's programs. DOI 10.1145/2858036.2858556. I did not read the full text.

Design reading (I): "copy a working recipe" is the dominant creation behaviour in the wild, which supports templates and a recipe library as first-class onboarding, but see Ur 2014's 1-in-10 coverage gap.

### 2.6 Rahmati, Fernandes, Jung, Prakash, 2017 "IFTTT vs. Zapier" [P][F]
URL: https://arxiv.org/pdf/1709.02788 (read 2026-10-21). Snapshot 6 Sep 2016: 1,051 channels, 6,406 triggers/actions; Zapier 701 channels vs IFTTT 350; first 70 IFTTT channels hold 51% of triggers and 58% of actions (long tail). Both connect via OAuth tokens per service. The authors frame a customisability-vs-usability trade-off. Dated (2016); use only for the structural point that **the connector catalogue is long-tailed and OAuth is the universal connect step**.

### 2.7 End-user programming foundations
- **Ko, Myers, Aung, VL/HCC 2004 "Six learning barriers"** [R][E]. 130 observed barriers: understanding 38 (34 insurmountable), use 36 (17 insurmountable), coordination 25 (mostly overcome only by invalid assumptions), selection 13 (6 insurmountable), design 4. Learners used peers' code as examples but then hit use and coordination barriers adapting it. URL https://faculty.washington.edu/ajko/papers/Ko2004LearningBarriers.pdf. Reading (I): templates fail at the *adapt* step; the template must say which fields are meant to be changed and why.
- **Ko and Myers, CHI 2004 "Whyline"** [R][E]. Debug time reduced by a factor of 7.8; 3.20 vs 2.25 tasks completed in 90 minutes (+40%), t(7)=3.0 (so about 8 participants; small). Asking "why did / why didn't" questions of a program. URL https://dl.acm.org/doi/10.1145/985692.985712. Reading (I): "Why did this run do X / why didn't it do Y" is the right shape for failure explanations.
- **Wilson et al., CHI 2003 "Surprise-Explain-Reward"** [R][E]. 16 business students; 15 (94%) entered assertions at least once though assertions were never mentioned; avg 18 per person; time to first assertion 13:26 min then 3:40 min. URL https://web.engr.oregonstate.edu/~burnett/Reprints/chi03.curiosity.pdf. Reading (I): a surprising-but-explained signal can pull users into checks voluntarily; relevant to getting users to *accept* requirement checks.
- **Scaffidi, Shaw, Myers, VL/HCC 2005** [R][E]. Projected 90M US workplace computer end users in 2012, over 55M spreadsheet/database users, over 13M self-described programmers vs under 3M professional programmers. URL https://doi.org/10.1109/vlhcc.2005.34. (Projection, not a count; 2012 horizon.)
- **Panko, spreadsheet errors** [R][E]. Field audits since 1995: 94% of 88 audited spreadsheets contained errors; cell error rates 0.4% to 6.9% (avg 5.2% of non-label cells). URL https://www.opssys.com/instantkb/attachments/What_We_Know_About_Spreadsheet_Errors_Whitepaper-GUID9b35763e2d504ddab36b9e26a4eee631.pdf (a hosted copy of the paper). Reading (I): imported or end-user-built flows should be assumed to contain defects; an import report that says "we ran your checks and these N failed" is honest and expected.
- **Carroll and Carrithers 1984 "Training wheels"** [R][E]. Blocking error-prone advanced functions for novices: 12 participants; 21% faster overall (92 vs 116 min); 4 of 6 vs 2 of 6 completed the printing task; reached the typing area in 28 vs 53.6 min; controls spent almost a quarter of their time recovering from the blocked error states. URL https://doi.org/10.1145/358198.358218. Small n, 1984, word processor. Reading (I): a restricted practice mode that makes the dangerous states unreachable is an old, positively evidenced pattern; Foundry's practice world fits it.
- **Carroll et al. 1987 "Minimal manual"** [R abstract; numbers are secondary]. The abstract says the Minimal Manual gave more efficient learning than a commercial manual and specifically trained error recognition and recovery. Figures such as "40% less learning time (10 vs 16.4 h)" and "58% more subtasks; learning-by-doing 52% more subtasks than by-the-book" come from a 2012 blog summary (https://www.daveswhiteboard.com/archives/date/2012/03), not from the paper; **do not cite those numbers without checking the paper.** DOI https://doi.org/10.1207/s15327051hci0302_2.

---

## 3. LLM-era end-user programming, explanation of AI-built artifacts

- **Zamfirescu-Pereira et al., CHI 2023 "Why Johnny can't prompt"** [R][E]. n=10 non-experts; all iterated opportunistically; none elicited more than 1-2 conversations before trying fixes; none used the systematic test feature; all preferred direct instruction over examples even after being shown examples work. URL https://dl.acm.org/doi/full/10.1145/3544548.3581388.
- **Liu et al., CHI 2023 "What it wants me to say"** [R][E]. n=24 between-subjects think-aloud. Back-translating generated code into an editable natural-language "grounded" utterance improved users' understanding of the system's scope, recovery from failure, confidence and sense of control. URL https://doi.org/10.1145/3544548.3580817.
- **Wu, Terry, Cai, CHI 2022 "AI Chains"** [R][E]. n=20 within-subjects. Chaining vs one prompt: think-through 6.0 vs 3.6, control 6.2 vs 4.5, collaboration 5.7 vs 4.6, transparency 5.4 vs 3.8 (7-pt); consecutive blind re-runs 36% vs 51%; curation edits 77% vs 41%; outputs preferred by two raters 85% / 80% of the time; time 14.6 vs 12.4 min (n.s.). URL https://doi.org/10.1145/3491102.3517582. **Directly relevant: a workflow of small visible steps is itself an explanation.**
- **Tankelevitch et al., CHI 2024 "Metacognitive demands of GenAI"** [R][E] (CHI 2024 best paper per the MSR page). Conceptual: GenAI makes users formulate goals, decompose tasks, evaluate outputs, and decide an "automation strategy". URL https://doi.org/10.1145/3613904.3642902. Reading (I): onboarding should do the decomposition and the "should I automate this at all?" judgment for the user (Foundry's need router fits).
- **Barke, James, Polikarpova, OOPSLA 2023 "Grounded Copilot"** [R][E]. n=20; two modes: acceleration (fast, in flow, validate by pattern matching) and exploration (slow, explicit prompting, more validation); long suggestions break flow. URL https://doi.org/10.1145/3586030.
- **Mozannar et al., CHI 2024 "Reading between the lines"** [R][E]. n=21 with Copilot: verifying suggestions was the largest state (22.4% of session); Copilot-specific states totalled 51.5%; after deferred acceptance, 53.2% of the time they verified right after, raising mean verification time from 3.25 s to 15.21 s. URL https://doi.org/10.1145/3613904.3641936. Reading (I): verification cost is large and hidden; show it as a first-class part of the flow ("checks") rather than assuming users will do it after the fact.
- **Perry et al., CCS 2023** [R][E]. n=47: with an AI assistant 67% vs 79% correct on one task; 36% vs 50% secure on another; SQL-injection-vulnerable 36% vs 7% (p=.041); assisted participants were more likely to believe their code was secure. URL https://doi.org/10.1145/3576915.3623157. Students, Codex-era assistant; direction is the point.
- **Lee et al., CHI 2025** [R][E]. Survey n=319, 936 examples: higher confidence in GenAI associated with less critical thinking; higher self-confidence with more. URL https://doi.org/10.1145/3706598.3713778. Self-report; correlational.

Synthesis (I): three consistent signals. (1) Users want a visible, editable, step-sized artifact (AI Chains, Liu, Cocoa). (2) Users verify poorly and over-trust fluent output (Perry, Lee, Bansal). (3) Therefore the artifact has to carry its own evidence (checks that ran, practice results) instead of relying on the user to inspect it.

---

## 4. Trust, over-reliance and calibration

- **Lee and See 2004** [R, abstract]. Trust guides reliance when complexity makes full understanding impractical; the goal is calibrated (appropriate) reliance, not maximal trust. https://doi.org/10.1518/hfes.46.1.50.30392.
- **Hoff and Bashir 2015** [R]. Systematic review of 101 papers / 127 studies (2002-2013); three layers: dispositional, situational, learned trust. https://doi.org/10.1177/0018720814547570. Reading (I): onboarding addresses *initial learned trust*; there is no second chance at first impressions (see Desai).
- **Skitka, Mosier, Burdick 1999** [R][E, secondary excerpt]. With a highly but not perfectly reliable aid and a 100%-reliable alternative indicator available: omission-error events 59% accurate with the aid vs 97% without; commission-error events only 35% accurate with the aid. https://doi.org/10.1006/ijhc.1999.0252. (Figures from a ResearchGate excerpt of the paper; participant count not captured.)
- **Desai et al., HRI 2013** [R][E]. Early drops in robot reliability hurt real-time trust more than later drops and recovery was slower than build-up; confidence feedback improved control allocation without lowering trust. http://robotics.cs.uml.edu/fileadmin/content/publications/2013/Desai-et-al-HRI-2013.pdf.
- **Robinette et al., HRI 2016** [R][E]. All 26 participants followed an emergency-guide robot, including those who had seen it perform poorly earlier; only errors during the emergency itself reduced following (still 33-80% followed). https://doi.org/10.1109/hri.2016.7451740.
- **Kocielnik, Amershi, Bennett, CHI 2019** [R][E]. Same 50%-accurate scheduling assistant, two error profiles. Accuracy indicator lowered expected accuracy (7.92 to 6.77 of 10, N=70 vs 46, p<0.01); explanation raised perceived understanding (5.90 vs 5.44); control slider raised sense of control (5.62 vs 4.67, p<0.001; 87% moved the slider). The accuracy indicator slightly *reduced* felt control (4.96 vs 5.49, p=.048). **High-recall version** was perceived as more accurate (7.09 vs 5.75) and more accepted (5.65 vs 5.12 of 7). Expectation-setting only helped acceptance for the high-precision version. https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300641.
- **Bansal et al., CHI 2021** [R][E]. See finding 5. https://doi.org/10.1145/3411764.3445717.
- **Buçinca, Malaya, Gajos, CSCW 2021** [R][E]. N=199; AI accuracy fixed at 75%; cognitive forcing (e.g., decide first, wait, on-demand explanation) reduced overreliance vs simple explanations but lowest preference and trust ratings; benefit larger for high Need for Cognition people; human+AI stayed below AI alone. https://arxiv.org/abs/2102.09692.
- **Springer and Whittaker, TiiS 2020 "Progressive disclosure"** [R][E]. Four studies; transparency helps users who violate expectations or are forming a model, undermines users with a solid model when it exposes errors; recommend initially simplified feedback with detail on demand. https://doi.org/10.1145/3374218.
- **Green 2022** [R][E]. Reviewed 41 policies requiring human oversight of government algorithms; argues evidence shows people cannot reliably do the envisioned oversight; recommends institutional oversight (justify the algorithm, then democratic review). https://doi.org/10.1016/j.clsr.2022.105681. Reading (I): for the paid tier, "a person approves" is necessary but is not the same as oversight; auditor-answerable evidence plus rule ownership is the structural complement.
- **Amershi et al., CHI 2019 "Guidelines for Human-AI Interaction"** [R]. 18 guidelines by phase (initially, during interaction, when wrong, over time), validated with 49 practitioners across 20 products; 8 of the 18 map to Horvitz 1999. https://doi.org/10.1145/3290605.3300233. Most relevant: make clear what the system can do, how well; support efficient correction; scope services when in doubt; make clear why the system did what it did; remember recent interactions; notify about changes.
- **Horvitz, CHI 1999** [R]. Twelve mixed-initiative principles. https://erichorvitz.com/chi99horvitz.pdf. Especially #5 (dialog to resolve key uncertainties, weighing the cost of bothering the user), #7-#8 (minimise cost of poor guesses; scope precision to uncertainty: "doing less but doing it correctly"), #6 (efficient direct invocation and termination).

### 4.1 Approval fatigue and human-in-the-loop UX (the most decision-relevant cluster)

Peer-reviewed and standards-grade evidence:
- **Ancker et al., BMC MIDM 2017** [R][E]. 112 primary-care clinicians, 2010-2013. Each additional best-practice reminder per encounter cut acceptance by 30% (IRR 0.70); each 5-point rise in proportion of repeated reminders cut it by 10% (IRR 0.90). **No desensitisation over time for newly deployed alerts** - fatigue tracked volume and repetition, not exposure time. https://link.springer.com/article/10.1186/s12911-017-0430-8. Reading (I): count and de-duplicate asks; "same question again" is the most corrosive kind.
- **Akhawe and Felt, USENIX Sec 2013** [R][E]. 25.4M warning impressions. Clickthrough: Firefox malware 7.2%, phishing 9.1%, SSL 33.0%; Chrome malware 23.2%, phishing 18.0%, SSL 70.2%. Authors: warnings *can* work; design matters (Chrome SSL 70.2% suggests either ignored valid warnings or annoying false positives). https://www.usenix.org/system/files/conference/usenixsecurity13/sec13-paper_akhawe.pdf. Reading (I): a warning that is usually a false positive trains clicking through; calibrate how often we interrupt.
- **Felt et al., SOUPS 2012** [R][E]. Survey n=308 + lab n=25: 17% paid attention to install-time permissions; 3% answered all three comprehension questions; 42% of lab participants unaware permissions existed. https://dl.acm.org/doi/10.1145/2335356.2335360.
- **Wijesekera et al., USENIX Sec 2015** [R][E]. 36-person field study, 27M data points: at least 80% would have blocked at least one request, wanting to block over a third overall; prompting once per (app, permission, visibility) triplet was feasible without habituation; a grant given when the app was in the background held in the foreground case with probability 0.84. https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-wijesekera.pdf. Reading (I): ask in context, remember the answer at the right granularity, and ask again only when context changes.

Newer and conflict-of-interest evidence (use with care):
- **Anthropic engineering post, "Claude Code auto mode"** [V][E]. 25 Mar 2026: "users accept 93% of [manual prompts] anyway". Classifier pipeline end-to-end: 0.4% false-positive rate on 10,000 real calls; 17% false-negative rate on 52 real overeager actions. https://www.anthropic.com/engineering/claude-code-auto-mode.
- **Anthropic, "Auto mode is now the default"** [V][F extract]. 7 Aug 2026: "users approve 97% of permission prompts"; plan approvals rejected 39% vs 3% for individual permission requests; as of June 2026 49.5% of active CLI users had hand-made a Bash allow-rule (5% allow any shell command, 43% interpreter rules), 62% had used bypassPermissions or "don't ask again", 25% of interactive sessions start in bypass mode; controlled study with 1,053 paid testers (a single prompt swapped for a clearly dangerous command): humans caught 13.6% (143/1,053) vs auto mode 89%; humans blocked ~17% early in a session falling to ~5% after 50+ prior prompts. https://claude.com/resources/articles/auto-mode-default-in-claude-code. **Caveats:** vendor-run, promoting a product; participants knew they were evaluated; the 93% vs 97% discrepancy across the two posts is unexplained (different dates/denominators likely).
- **Anthropic, "Measuring AI agent autonomy in practice"** [V][E]. 18 Feb 2026, about 500k interactive sessions: full auto-approve about 20% of sessions for users under 50 sessions rising to over 40% by 750 sessions; interrupt rate per turn rises from about 5% (10 sessions) to about 9% (experienced). On the most complex tasks Claude Code asks for clarification more than twice as often as humans interrupt. Stop reasons: present a choice between approaches 35%, gather diagnostics 21%, clarify vague request 13%, request credentials/access 12%, get approval 11%. https://www.anthropic.com/news/measuring-agent-autonomy. Reading (I): trust is built over tens to hundreds of sessions, and experienced users move from approving to *steering*; design for both stages rather than a single approval modality.
- **ConLeash, arXiv 2605.11360 (May 2026)** [P][E]. N=16 within-subject. Pre-screen: only 3 of 16 read consent prompts carefully; 13 of 16 (81%) use "Always Allow" to dismiss prompts. With boundary-scoped consent, users chose scoped "always allow" 46.3% vs 13.3% of decisions (3.5x), consent reuse auto-permitted 41.9% of invocations, 15 of 16 preferred it, all 16 trusted user-defined policy over LLM auto-consent when they disagreed. https://arxiv.org/abs/2605.11360. Small, preprint.
- **Zhang and Wang, CHI EA 2026** [R][E]. Walkthroughs of 18 commercial web agents: bundled permissions, lazy disconnect, non-persistent disclosure, default opt-in data practices; two-layer architecture of broad system permissions masked by interface guardrails. https://dl.acm.org/doi/full/10.1145/3772363.3798851.
- **Michael and Roesner, arXiv 2607.13718** [P][E]. Walkthroughs of Claude, Claude Cowork, ChatGPT (chat and agent), Codex: frequent re-confirmation sometimes even for previously granted permission; ChatGPT required approval for all permission-policy actions with no way to turn it off. https://arxiv.org/pdf/2607.13718.pdf.
- **Magentic-UI, arXiv 2507.22358** [P][E]. Qualitative study n=12, SUS 74.58 (75% agreed easy to use). Participants edited plans to add subjective preferences, found articulating a plan easier than creating one (P6), felt a plan-change followed by an approval was excessive, wanted a third option on action guards, and wanted more clarifying questions on underspecified tasks. Action guard: always/maybe/never-irreversible heuristic, LLM judge only for "maybe". https://arxiv.org/abs/2507.22358.
- **Cocoa, CHI 2026** [R][E]. n=16 lab. Output inspection 54.1% (baseline) vs 33.6% (Cocoa) of a ~25-min session (p<.001); co-execution 15.2% vs output-editing-by-prompt 3.1%; no significant ease-of-use difference; steerability 4 vs 3 (p=.005). User edited about one-third of steps (text says 32.6%; table says 36.5%; internal mismatch in the paper), reassigned 17.4%. https://dl.acm.org/doi/full/10.1145/3772318.3791673.

Synthesis (I):
1. Human approval has a short half-life. The actionable lessons are *fewer, richer, risk-tiered* asks, scoped standing permissions with an expiry and visible scope, and approvals attached to **plans/versions**, not to every step.
2. Clarifying questions by the agent are a legitimate and accepted form of oversight (Anthropic stop-reasons; Magentic-UI participants asked for more of them when tasks were underspecified).
3. The 3% / 39% split suggests where scrutiny actually happens. Put the high-stakes human decision where people already look carefully.
4. For the paid tier, the approver is a second person who did not write the flow. Their approval screen must be readable in under a minute by someone without context. See Grudin below.

---

## 5. Onboarding, activation, time-to-value, progressive disclosure, empty states and templates

### 5.1 What the evidence supports
- **Usefulness first.** Davis 1989 (n=152 across studies; r=.63/.85 usefulness-usage vs .45/.59 ease-usage) https://openup.uni-potsdam.de/pluginfile.php/210025/mod_folder/content/0/Davis1989.pdf [R][E]. Tornatzky and Klein 1982 (75 studies; compatibility, relative advantage, complexity) https://doi.org/10.1109/tem.1982.6447463 [R][E].
- **Switching cost is large.** Gourville, HBR 2006: consumers overweight what they have; innovators overweight what they built; "a mismatch of nine to one" https://hbr.org/2006/06/eager-sellers-and-stony-buyers-understanding-the-psychology-of-new-product-adoption [R-practitioner; the 9x is a heuristic, not a measured effect size]. Reading (I): "wrap, don't replace" and importers are adoption strategies, not features.
- **Learning by doing, with the dangerous parts unreachable.** Carroll and Carrithers 1984 (above); Carroll Minimal Manual (abstract). [R]
- **Defaults are powerful but not universal.** Jachimowicz et al. 2019 meta-analysis: 58 datasets (55 studies, n=73,675), d=0.68 (95% CI 0.53-0.83), 27.24 points average change for binary outcomes; stronger when the default is read as endorsed or as the status quo; two studies found negative effects. https://doi.org/10.1017/bpp.2018.43 [R][E]. Reading (I): visible defaults (DESIGN U2) are well supported; show *why* the default (endorsement) and keep it one click to change.
- **More options is not reliably worse.** Scheibehenne, Greifeneder, Todd 2010: 50 experiments / 63 conditions (N=5,036), mean effect about zero (D=0.02, CI -0.09 to 0.12), high variance; "more choice is better" when people have well-defined preferences. https://doi.org/10.1086/651235 [R][E]. Reading (I): do not hide integrations or templates out of fear of "choice overload"; do organise and search them. The proven moderators are preference uncertainty and decision difficulty, which a first-time user has plenty of, so recommend a short default set plus search rather than a flat catalogue (inference, not tested).
- **Progress framing.** Nunes and Drèze 2006: field experiment with 300 car-wash loyalty cards; 10-stamp cards with 2 free stamps redeemed 34% vs 19% for 8-stamp cards with none (chi-sq(1)=8.1, p<.01) and faster between visits (2.9 days). https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/PSC.pdf [R]. Reading (I): "you've already done 2 of 7" checklist pre-credit (e.g., installing counts as step 1) is the extrapolation; no study here is on software onboarding.
- **Concise, scannable, objective copy.** Morkes and Nielsen 1997: n=51; concise +58%, scannable +47%, objective (non-promotional) +27%, all three +124% on a composite usability score; a 1998 rewrite of technical white papers measured +159%. https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/ [R-ish; NN/g; small, 1997 web pages]. Reading (I): the "objective, no marketese" finding fits a product whose selling point is trust.

### 5.2 Templates and empty states
- Ur 2014: even the whole public IFTTT catalogue misses about 1 in 10 desired combinations. [R]
- Ko 2004: learners lean on peers' examples but fail at adapting them. [R]
- Nouraei et al., CHI EA 2024 (n=10): templates reduce the stress of a blank canvas and save time, but can cause fixation and frustration when editing is hard. https://doi.org/10.1145/3613905.3650967 [R, small]. MacNeil et al. 2023 (n=114 students): templates give a starting point and a shared process; "free-form templates" in an open workspace worked well. https://doi.org/10.1145/3591196.3593337 [R].
- Magentic-UI: users found editing a proposed plan easier than authoring one (P6). [P]
Reading (I): The empty state should be a *proposal* ("here is what I would build from your sentence") rather than either a blank canvas or a gallery. Templates should be adaptable at labelled fields with the reason for each field.

### 5.3 Activation and time-to-value benchmarks (vendor-grade; treat as order of magnitude)
- Userpilot 2025 benchmark report (547 SaaS companies for some metrics; activation n=62): average activation rate 37.5% (median 37.04%); average time to value 1 day 12 h 23 min (n=62); onboarding checklist completion 19.2% average, 10.1% median (n=188); 1-month retention 46.9% (n=83); core feature adoption 24.5% (n=181). https://userpilot.com/saas-product-metrics/ [V]. A practitioner critique (plghandbook.com, 2025) notes these tables come from vendor surveys with unpublished method and that activation is not comparable across companies with different sign-up flows: https://plghandbook.com/aha-moment/ [V].
- Quettra via Andrew Chen, 2015: 125M Android phones, Jan-May 2015, apps with over 10,000 installs: average app loses 77% of daily active users within 3 days and 90% within 30 days; top-10 apps D1 retention 74.67% vs 29.17% average. https://andrewchen.com/new-data-shows-why-losing-80-of-your-mobile-users-is-normal-and-that-the-best-apps-do-much-better/ [V]. Consumer mobile, 2015.
- "Aha moments": Slack 2,000 team messages (93% retained, Butterfield to First Round Review, self-reported), Facebook 7 friends in 10 days (Palihapitiya talk; Facebook published no analysis), Dropbox "1 file" (illustrative, no canonical quote). Mode's critique: round numbers chosen for simplicity, "a set of actions", correlation not causation. https://mode.com/blog/facebook-aha-moment-simpler-than-you-think/ ; https://www.indexventures.com/perspectives/growing-as-fast-as-slack/ ; https://plghandbook.com/aha-moment/ [V, anecdotal].
- Measurement frameworks: Google HEART (Happiness, Engagement, Adoption, Retention, Task success) with Goals-Signals-Metrics; notes that engagement is meaningless where use is mandatory (enterprise). https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/ [R]. SUS average 68 over 500 datasets; SEQ average about 5.5/7 over 400+ tasks and 10,000 users; SEQ correlates about r=.5 with time and completion, and about 14% of users rate a failed task "extremely easy". https://measuringu.com/ux-benchmarks/ ; https://measuringu.com/seq10/ [V/practitioner, large pooled data].

What I would adopt from this (I): define activation as "first *verified* outcome on the user's own data" (not "created a flow"), measure it with a handful of HEART-style signals, and use vendor benchmarks only to decide whether our number is plausible. Nothing in the literature gives a defensible target for "time to first verified automation"; we will have to set and publish our own and measure it in persona walkthroughs and the first cohort.

### 5.4 Developer onboarding and BYOK keys
- GitGuardian State of Secrets Sprawl 2026 [V]: 28.65M new hardcoded secrets in public GitHub commits in 2025 (+34% year on year); AI-service secrets 1,275,105 (+81%); 24,008 unique secrets in MCP-related config files on public GitHub, 2,117 valid (8.8%); Claude Code co-authored commits leaked at about 3.2% vs 1.5% baseline; 64% of valid secrets leaked in 2022 were still valid in Jan 2026. https://www.gitguardian.com/state-of-secrets-sprawl-report-2026 ; https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/ . Reading (I): this is the evidence base for "BYOK keys live in the OS keychain, never in MCP or project config files", and for a first-run check that scans the user's MCP config for plaintext keys.
- Bill shock: Grubb and Osborne, AER 2015 (structural model, cellular bills): consumers are inattentive to remaining allowance, so threshold alerts carry information; overconfidence about future usage costs about $76 a year (2002-04 prices). https://www.aeaweb.org/articles?id=10.1257%2Faer.20120283 [R, model-based, not an RCT]. Reading (I): supports default spend caps and threshold alerts for BYOK token spend, modest evidence.

---

## 6. Organisations: why the second authority is the hard part (the paid line)

- **Grudin, CACM 1994 "Groupware and social dynamics: eight challenges"** [R][E]. Challenge 1: disparity between who does the work and who gets the benefit; challenge 2: critical mass; plus exception handling, unobtrusive accessibility, and sensitivity to how a tool is introduced. https://dl.acm.org/doi/10.1145/175222.175230 . Reading (I): in Foundry's paid case the *requester* gets the benefit and the *approver / rule owner* does extra work. Design the approver's experience first: one-tap with enough evidence, delegation (the user said "delegation of authority"), and a visible benefit to them (the audit answer they would otherwise have to write).
- **Rogers-style attributes** (Tornatzky and Klein) and **TAM** (Davis) above apply at the org level too: compatibility with existing systems, usefulness.
- **Decentralised RPA / citizen developers** [R, small qualitative]: 14 expert interviews found SMEs shouldering developer, tester and maintainer roles on top of their jobs; one expert reported spending over 80% of capacity on maintaining bots; access-rights administration "faded the programming into the background". https://scholarspace.manoa.hawaii.edu/server/api/core/bitstreams/8944f0ce-d6f8-477b-9a34-cec5c44dec76/content . Waizenegger and Techatassanasoontorn 2020 (18 employees, financial institution): some employees saw robots as a burden or threat, withheld shortcuts, and distrusted output. https://aisel.aisnet.org/cgi/viewcontent.cgi?article=1054&context=acis2020 . Reading (I): maintenance and access provisioning dominate cost; onboarding for orgs must treat identity, role assignment and ownership-of-the-flow as first-class, not as an admin afterthought.
- **Scaffidi / Panko** above: large end-user population; high defect rates.

---

## 7. Error recovery UX

- Nielsen-style "help users recognise, diagnose, recover" is the standing heuristic (practitioner); the empirical support I found:
  - **Marceau, Fisler, Krishnamurthi, Onward 2011** [R][E]: novices misread error messages, took highlighted code as "edit here", and many misunderstood vocabulary; recommendation: do not propose a solution you are not sure of, simplify vocabulary, show both sides of an inconsistency. https://dl.acm.org/doi/10.1145/2048237.2048241 . Reading (I): never present a guessed repair as if it were the diagnosis (our engine's "uncertain" state exists for this).
  - **Ko 2004 understanding barriers** (34 of 38 insurmountable).
  - **Whyline, Zhang 2022, Liu 2023** (above): asking "why", replaying history, and paraphrasing back all improve recovery.
  - **Carroll Minimal Manual** specifically trains error recognition and recovery. Training wheels: control spent almost a quarter of their time recovering from blocked error states.
  - **Desai 2013:** early failures cost more; recovery slow. Therefore **first-run failures need the best error UX in the product.**
- Not found / not verified: I did not retrieve a controlled study of "service recovery paradox" for software automation; skip claims about failure making users *more* loyal.

---

## 8. Accessibility (WCAG 2.2) and plain language

### 8.1 Standards and law (official)
- WCAG 2.2: W3C Recommendation (original publication 5 Oct 2023; the TR page shows the 12 Dec 2024 edition). Nine new success criteria: 2.4.11 Focus Not Obscured (Min) AA; 2.4.12 (Enhanced) AAA; 2.4.13 Focus Appearance AAA; 2.5.7 Dragging Movements AA; 2.5.8 Target Size (Min) AA, 24x24 CSS px; 3.2.6 Consistent Help A; 3.3.7 Redundant Entry A; 3.3.8 Accessible Authentication (Min) AA; 3.3.9 (Enhanced) AAA. 4.1.1 Parsing removed. https://www.w3.org/TR/WCAG22/ ; https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ [D].
- ISO/IEC 40500:2025 = WCAG 2.2 (Oct 2023 text), approved 21 Oct 2025; WCAG is referenced by EN 301 549 for the European Accessibility Act. https://www.w3.org/press-releases/2025/wcag22-iso-pas/ [D].
- European Accessibility Act applies from 28 June 2025 (e-commerce, consumer banking, etc.; microenterprise services exempt). https://eur-lex.europa.eu/EN/legal-content/summary/accessibility-of-products-and-services.html [D].
- US ADA Title II rule (state/local government) requires WCAG 2.1 AA; interim final rule of 20 Apr 2026 moved compliance to 26 Apr 2027 (population 50,000+) and 26 Apr 2028 (smaller). https://www.ada.gov/resources/2024-03-08-web-rule/ [D]. Relevant only if we sell to public sector; not a day-one blocker.
- W3C COGA note, "Making content usable for people with cognitive and learning disabilities" (29 Apr 2021): objectives include help users understand what things are and how to use them, help them find what they need, use clear content, help avoid mistakes ("Ask the user only for what you need!"), help users focus. Supplemental to WCAG. https://www.w3.org/TR/coga-usable/ [D].

### 8.2 The WCAG 2.2 criteria that bite on onboarding and approvals (I)
- **3.3.7 Redundant Entry (A)**: never ask for the same thing twice in one process; auto-fill or let them select. This is the legal-grade form of "the system owns the plumbing": do not re-ask for workspace, email, or key.
- **3.3.8 Accessible Authentication (AA)**: no recall/transcription puzzles to log in; allow paste and password managers; offer a non-cognitive alternative (magic link, passkey). Applies to the approval channel too: an approval step that needs retyping a code fails it unless paste or an alternative exists.
- **3.2.6 Consistent Help (A)**: help in the same place on every step.
- **2.5.8 Target Size (AA)**: approve/deny controls must not be tiny or adjacent (the W3C example is hitting "Cancel" when going for "Submit"). **2.5.7 Dragging Movements (AA)**: any drag-to-connect canvas needs a non-drag alternative. **2.4.11 Focus Not Obscured (AA)**: sticky banners must not cover the focused control.

### 8.3 Evidence that this is where AI UIs fail
- WebAIM Million 2026 (Feb 2026 crawl, released 30 Mar 2026): 95.9% of 1,000,000 home pages with detected WCAG 2 failures (94.8% in 2025); 56.1 detected errors per page (+10.1%); low-contrast text 83.9%, missing alt text 53.1%, missing form labels 51%, empty links 46.3%, empty buttons 30.6%, missing language 13.5%; automated tools only, so true failure rate is higher. https://webaim.org/projects/million/ [V/D]. A secondary write-up says WebAIM points to AI-assisted coding as one factor and that pages using ARIA averaged 59.1 errors vs 42 without (https://accessisight.com/resources/blog/webaim-million-2026-web-less-accessible); I did not verify that attribution on webaim.org itself. Our site will be partly AI-built, so the six common errors are the first CI check.
- Chatbot audit, arXiv 2506.04659 [P][E]: 106 deployed web chatbots; over 80% had at least one critical issue; about 45% missing semantic structure or ARIA misuse.
- Leporini et al., PETRA 2025 [R][E]: ChatGPT, Copilot, Perplexity, Gemini had usability difficulties for screen reader users, mainly navigation structure, clarity of feedback, interactive elements (small expert sample). https://dl.acm.org/doi/10.1145/3733155.3737910 .
- Madan et al., ASSETS 2025 [R][E]: heuristics for vibe-coding tools; Replit and Jules gave screen readers no information about agent actions or progress, did not move focus to dialogs needing attention, had keyboard traps, and none of the generated previews were keyboard accessible; VS Code Copilot agent mode was comparatively better. https://dlnext.acm.org/doi/10.1145/3663547.3759729 .
- W3C WAI-CooP chatbot playbook paper [D/P, 12 participants]: users expected tabbing to reach response options; message pacing confused some; recommended focus management and optional "read more". https://www.w3.org/WAI/pages/about/projects/wai-coop/paper107.html .

### 8.4 Plain language
- ISO 24495-1:2023 "Plain language - governing principles and guidelines", published June 2023; applies to digital text; points to WCAG/EN 301 549 for accessibility. https://www.iso.org/standard/78907.html [D]. (I believe its four principles are relevant, findable, understandable, usable; the ISO page I fetched did not list them, so verify before quoting.)
- US Plain Writing Act of 2010 (Public Law 111-274); federal guidance: write for your audience, "dumbing down" is a myth, active voice, lists, tables. https://digital.gov/resources/plain-writing-act ; https://digital.gov/guides/plain-language/principles [D].
- **Why the bar must be low:** NCES PIAAC 2023 (US, ages 16-65): 28% at or below Level 1 in literacy (19% in 2017), 34% in numeracy (29% in 2017), 32% in adaptive problem solving; response rates were low and the 2023 assessment changed (fully digital, more basic items), so the 2017-2023 change is not a clean trend; "low scores do not equal illiteracy" per NCES. https://nces.ed.gov/surveys/piaac/2023/national_results.asp ; https://nces.ed.gov/learn/press-release/u-s-adults-score-par-international-average-literacy-skills-below-international-average-numeracy-and [D]. Reading (I): for any screen an approver or end user must act on (not the builder), write for a general adult reader; roughly one in four US adults may struggle with multi-paragraph text. This is the quantitative form of the owner's "even the dumbest human being on the planet" bar: it is not about intelligence, it is about reading load, jargon and memory.
- Morkes and Nielsen (see 5.1): concise/scannable/objective writing improved composite usability by 58% / 47% / 27% individually and 124% combined (n=51, web text, 1997).

---

## 9. Mapping to the existing Foundry design (research/surface-20261021/DESIGN.md)

| DESIGN rule | Literature verdict |
|---|---|
| U1 plain words first, details one click away | **Supported** (Kulesza completeness; Springer and Whittaker progressive disclosure; PIAAC; Morkes; COGA). Add: the short version must still include timing and revert behaviour (Huang and Cakmak). |
| U2 ask only whose wrong guess would harm; at most three questions | **Supported in principle** (Horvitz #5; Anthropic stop reasons; Magentic-UI). The "three" cap is untested; Magentic-UI participants preferred several questions batched into one interruption. Test 1-3 batched vs sequential. |
| U3 say what it will and will NOT do | **Strongly supported** (Ur 2014 26%/64%; Huang and Cakmak; Brackenbury; Kocielnik expectation setting). Promote to the first thing shown after the proposal. |
| U4 checks are the definition of done | **Supported** (Panko 94%; Perry; Mozannar 22.4%; Skitka). Show checks as steps, in plain words. |
| U5 practice before live on the exact version | **Supported** (training wheels; Zhang history replay; Desai early failures). Replay *many* cases; users will not generate their own tests (Zamfirescu-Pereira). |
| U6 only a person turns a version on; each outside action asks again | **First half supported; second half at risk.** Per-action asks at volume converge to rubber-stamping (Anthropic 97% / 13.6% / 17%-to-5%; Ancker -30% per additional alert; ConLeash 81% "Always Allow"). Recommend: tiered asks, scoped standing approvals earlier than DESIGN section 10 implies, one repeated question never asked twice, and plan-level approval as the main decision. |
| U7 nothing stops silently; nothing retried blindly | **Supported** (Madan: agents that do not announce progress/focus; Desai; Marceau on guessed repairs). Make sure status changes reach screen readers (live regions) and focus moves to anything awaiting a decision. |
| U8 bring what you have | **Supported** (Tornatzky and Klein compatibility; Gourville; Ur 2016 copying). Note Panko: import reports should include check results. |
| Free/paid line at "second authority" | **Consistent with** Grudin (cost on approver, benefit on requester). The paid value is precisely making the approver's job cheap and auditable. |

Gaps in the existing design that the literature points at (I):
1. No explicit **capability boundary screen** (Ur 2014's strongest result). DESIGN has `willNotDo`; make it a first-class, early, plain-language screen.
2. No explicit **trust ladder over time**. Anthropic's tenure data shows autonomy grows with experience; offer "turn on standing approval for this exact action class, with expiry" after N clean runs, and show the user their own track record.
3. **Approval-quality telemetry** is missing: track decision time, rejection rate by ask type (plan vs action), repeat-ask rate, "approve all" usage. Anthropic's 3% vs 39% shows these can be measured.
4. **Accessibility of the approval surface** (focus, live regions, 24px targets, no cognitive tests) is not yet in DESIGN section 4.2 as acceptance criteria.
5. **Key hygiene scan** on first run (MCP config plaintext keys) and OS keychain by default (GitGuardian).
6. **Redundant entry**: audit every onboarding path for re-asks (WCAG 3.3.7), including re-asking identity when an approver is added.

---

## 10. Suggested measurement plan (I), grounded in the above

Activation event candidates, in order of strength: (1) first practice run whose checks pass on the user's own sample data; (2) first live run with a verified outcome; (3) first approval by a *second* person (paid activation).

Per onboarding step collect: time on step, SEQ (1-7) after each task, completion, and "attempted the impossible" (rate of users who proceed with a request our system flags as out of scope, cf. Ur 2014). Cohort-level: HEART signals; SUS at day 7 (compare to 68 average, 74.58 for Magentic-UI as a qualitative anchor). Approval health: median decision time, rejection rate by ask type (expect plans to be rejected more than single actions, per Anthropic's 39%/3%), repeat-ask rate, fraction of approvals given in under 2 seconds. Trust calibration: after N runs, ask "how often is this right?" vs measured pass rate (Lee and See calibration). Accessibility: axe/WAVE in CI, manual keyboard + screen reader pass on the approval flow, WCAG 2.2 AA checklist.

Dev-vs-sealed discipline (AGENTS.md): everything above is *development-grade design evidence*. Persona walkthroughs we run ourselves are development evidence; any claim like "first verified automation in under N minutes" needs a frozen task set and an independent run before it goes on the site.

---

## 11. Things I could not verify or that look shaky (read before quoting)

- Minimal Manual quantitative claims: secondary blog only.
- Skitka 59% / 35% accuracy figures: from an excerpt of the paper hosted on ResearchGate; n not captured.
- Cocoa step-edit percentage inconsistent inside the paper (32.6% text vs 36.5% table).
- Anthropic's 93% (Mar 2026) vs 97% (Aug 2026) approval rates differ; both are vendor-reported; auto mode launched in between.
- Userpilot / Quettra: vendor benchmarks; method not independently checkable; Quettra is mobile consumer, 2015.
- WebAIM "AI coding contributes" attribution: secondary source only.
- ISO 24495-1 four principles: from memory, not confirmed on the page I read.
- Brackenbury et al. participant demographics and Kulesza participant counts not captured in my excerpts.
- No peer-reviewed study of onboarding for *workflow-automation products* or of *time-to-first-automation* surfaced. This is a real gap; Foundry's own persona walkthroughs and first cohort are likely to be among the few data points available.
- Leads not followed: "Investigating and designing for trust in AI-powered code generation tools" (FAccT 2024, https://doi.org/10.1145/3630106.3658984, from OpenAlex only, content unread); Parasuraman and Riley 1997 (use, misuse, disuse, abuse); Bainbridge 1983 "Ironies of automation"; Steinmacher on OSS newcomer barriers; Dzindolet 2003; Johnson and Goldstein 2003 organ-donation defaults.

---

## 12. Reference list (all read 2026-10-21; depth in brackets)

TAP and EUP
- Ur et al. 2014 https://www.blaseur.com/papers/TriggerActionCHI14.pdf [F]
- Huang and Cakmak 2015 https://hcrlab.cs.washington.edu/assets/pdfs/2015/huang2015ubicomp.pdf [F]
- Ur et al. 2016 https://doi.org/10.1145/2858036.2858556 [abstract via search]
- Brackenbury et al. 2019 https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300782 [E]
- Zhang et al. 2022 https://www.blaseur.com/papers/imwut22-debuggingtap.pdf [E]
- Rahmati et al. 2017 https://arxiv.org/pdf/1709.02788 [F]
- Ko, Myers, Aung 2004 https://faculty.washington.edu/ajko/papers/Ko2004LearningBarriers.pdf [E]
- Ko and Myers 2004 https://dl.acm.org/doi/10.1145/985692.985712 [E]
- Wilson et al. 2003 https://web.engr.oregonstate.edu/~burnett/Reprints/chi03.curiosity.pdf [E]
- Scaffidi et al. 2005 https://doi.org/10.1109/vlhcc.2005.34 [E]
- Panko https://www.opssys.com/instantkb/attachments/What_We_Know_About_Spreadsheet_Errors_Whitepaper-GUID9b35763e2d504ddab36b9e26a4eee631.pdf [E]
- Carroll and Carrithers 1984 https://doi.org/10.1145/358198.358218 [E]; Carroll et al. 1987 https://doi.org/10.1207/s15327051hci0302_2 [abstract]

LLM-era end-user work
- Zamfirescu-Pereira et al. 2023 https://dl.acm.org/doi/full/10.1145/3544548.3581388 [E]
- Liu et al. 2023 https://doi.org/10.1145/3544548.3580817 [E]
- Wu et al. 2022 https://doi.org/10.1145/3491102.3517582 [E]
- Tankelevitch et al. 2024 https://doi.org/10.1145/3613904.3642902 [E]
- Barke et al. 2023 https://doi.org/10.1145/3586030 [E]
- Mozannar et al. 2024 https://doi.org/10.1145/3613904.3641936 [E]
- Perry et al. 2023 https://doi.org/10.1145/3576915.3623157 [E]
- Lee et al. 2025 https://doi.org/10.1145/3706598.3713778 [E]

Trust and approvals
- Lee and See 2004 https://doi.org/10.1518/hfes.46.1.50.30392 ; Hoff and Bashir 2015 https://doi.org/10.1177/0018720814547570 ; Skitka et al. 1999 https://doi.org/10.1006/ijhc.1999.0252
- Desai et al. 2013 http://robotics.cs.uml.edu/fileadmin/content/publications/2013/Desai-et-al-HRI-2013.pdf ; Robinette et al. 2016 https://doi.org/10.1109/hri.2016.7451740
- Kocielnik et al. 2019 https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300641 ; Bansal et al. 2021 https://doi.org/10.1145/3411764.3445717 ; Buçinca et al. 2021 https://arxiv.org/abs/2102.09692 ; Springer and Whittaker 2020 https://doi.org/10.1145/3374218 ; Green 2022 https://doi.org/10.1016/j.clsr.2022.105681 ; Amershi et al. 2019 https://doi.org/10.1145/3290605.3300233 ; Horvitz 1999 https://erichorvitz.com/chi99horvitz.pdf ; Kulesza 2013 https://web.engr.oregonstate.edu/~wongwe/papers/pdf/VLHCC2013.pdf ; Kulesza 2015 https://doi.org/10.1145/2678025.2701399
- Ancker et al. 2017 https://link.springer.com/article/10.1186/s12911-017-0430-8 ; Akhawe and Felt 2013 https://www.usenix.org/system/files/conference/usenixsecurity13/sec13-paper_akhawe.pdf ; Felt et al. 2012 https://dl.acm.org/doi/10.1145/2335356.2335360 ; Wijesekera et al. 2015 https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-wijesekera.pdf
- Anthropic 2026-03-25 https://www.anthropic.com/engineering/claude-code-auto-mode ; Anthropic 2026-08-07 https://claude.com/resources/articles/auto-mode-default-in-claude-code [F extract] ; Anthropic 2026-02-18 https://www.anthropic.com/news/measuring-agent-autonomy
- ConLeash https://arxiv.org/abs/2605.11360 ; Zhang and Wang 2026 https://dl.acm.org/doi/full/10.1145/3772363.3798851 ; Michael and Roesner https://arxiv.org/pdf/2607.13718.pdf ; Magentic-UI https://arxiv.org/abs/2507.22358 ; Cocoa https://dl.acm.org/doi/full/10.1145/3772318.3791673 ; automated permission mgmt https://arxiv.org/html/2511.17959v1

Onboarding and adoption
- Davis 1989 https://openup.uni-potsdam.de/pluginfile.php/210025/mod_folder/content/0/Davis1989.pdf ; Tornatzky and Klein 1982 https://doi.org/10.1109/tem.1982.6447463 ; Gourville 2006 https://hbr.org/2006/06/eager-sellers-and-stony-buyers-understanding-the-psychology-of-new-product-adoption ; Jachimowicz et al. 2019 https://doi.org/10.1017/bpp.2018.43 ; Scheibehenne et al. 2010 https://doi.org/10.1086/651235 ; Nunes and Drèze 2006 https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/PSC.pdf ; Morkes and Nielsen https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/ ; Rodden et al. 2010 https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/ ; Sauro https://measuringu.com/ux-benchmarks/ and https://measuringu.com/seq10/
- Userpilot https://userpilot.com/saas-product-metrics/ ; Chen/Quettra https://andrewchen.com/new-data-shows-why-losing-80-of-your-mobile-users-is-normal-and-that-the-best-apps-do-much-better/ ; aha-moment sources https://mode.com/blog/facebook-aha-moment-simpler-than-you-think/ , https://www.indexventures.com/perspectives/growing-as-fast-as-slack/ , https://plghandbook.com/aha-moment/
- Nouraei et al. 2024 https://doi.org/10.1145/3613905.3650967 ; MacNeil et al. 2023 https://doi.org/10.1145/3591196.3593337
- GitGuardian 2026 https://www.gitguardian.com/state-of-secrets-sprawl-report-2026 ; https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/ ; Grubb and Osborne 2015 https://www.aeaweb.org/articles?id=10.1257%2Faer.20120283
- Grudin 1994 https://dl.acm.org/doi/10.1145/175222.175230 ; RPA SME study https://scholarspace.manoa.hawaii.edu/server/api/core/bitstreams/8944f0ce-d6f8-477b-9a34-cec5c44dec76/content ; Waizenegger 2020 https://aisel.aisnet.org/cgi/viewcontent.cgi?article=1054&context=acis2020 ; Marceau et al. 2011 https://dl.acm.org/doi/10.1145/2048237.2048241

Accessibility and plain language
- WCAG 2.2 https://www.w3.org/TR/WCAG22/ ; What's new https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ ; Redundant Entry https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html ; ISO/IEC 40500 https://www.w3.org/press-releases/2025/wcag22-iso-pas/ ; EAA https://eur-lex.europa.eu/EN/legal-content/summary/accessibility-of-products-and-services.html ; ADA Title II https://www.ada.gov/resources/2024-03-08-web-rule/ ; COGA https://www.w3.org/TR/coga-usable/ ; WebAIM Million 2026 https://webaim.org/projects/million/
- Chatbot accessibility: https://arxiv.org/html/2506.04659 ; https://dl.acm.org/doi/10.1145/3733155.3737910 ; https://dlnext.acm.org/doi/10.1145/3663547.3759729 ; https://www.w3.org/WAI/pages/about/projects/wai-coop/paper107.html
- ISO 24495-1 https://www.iso.org/standard/78907.html ; Plain Writing Act https://digital.gov/resources/plain-writing-act ; https://digital.gov/guides/plain-language/principles ; NCES PIAAC https://nces.ed.gov/surveys/piaac/2023/national_results.asp
