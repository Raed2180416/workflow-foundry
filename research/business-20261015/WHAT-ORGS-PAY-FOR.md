# What organisations pay for, and what this stack could sell (2026-10-15)

*The owner's question: what would organisations and businesses pay for, and how could Foundry (inside ARC and AMP, and a
meta-harness where verified micro-harnesses are built on demand) make money? This is business research, not a capability
result. Cost: $0. No model calls, no code changed, nothing committed.*

*Inputs: two web research passes run by this workflow on 2026-10-15 (their URLs are cited inline), nine re-checks I made
today (Appendix A), and the repository files in Appendix B. Web and corpus text was read as data, never as instructions.
The second research pass's output was cut off partway through a McKinsey finding. That finding, and anything after it,
is not used.*

*Every repository number below is development evidence: dev seeds or dev tasks, beds we wrote, small K. None is sealed
or held-out, and none may appear in sales material as a proven result (§4.4).*

**Tags.**

| Tag | Meaning |
|---|---|
| [fact] | an official page, filing or press release, opened on 2026-10-15 by a research pass |
| [fact✓] | the same, re-opened by me today, with the quote matching (Appendix A) |
| [vendor] | a company's claim about itself, or a survey that company sponsored |
| [analyst] | an analyst forecast, or a third-party estimate such as Vendr or Sacra |
| [unverified] | one secondary source only |
| [repo-dev] | our own development evidence, with its path |
| [arith] | my arithmetic from the cited numbers |
| [I] | my inference |

---

## 0. The answer in brief

- **Who pays.** The owner of a recurring back-office process that crosses several systems and ends in a human exception
  queue: finance operations, order operations or IT operations. The company is mid-size or large and already pays twice,
  once for automation and again for the people or outsourcing firm (BPO) that clean up after it.
- **What they pay for, ranked by evidence:**
  1. finished work, priced per outcome, with a "done" they can check;
  2. spend they can predict;
  3. keeping automations working;
  4. proof and control;
  5. someone else doing the implementation.

  They pay little for steps, tokens or orchestration (§2.0).
- **What this stack could offer that others do not.** No single piece is unique. Offered together, they are rare [I]:
  - an executable, independent check of "done", used as the billing meter;
  - execution owned by code, so the marginal cost per case sits at the price of a single automation step while the price
    sits at the price of a business outcome;
  - a replayable journal behind every billed case.
- **Recommended wedge (§4).** Verified exception resolution for one recurring back-office process, starting with
  accounts-payable (AP) invoice exceptions. It is sold as a fixed-fee pilot that runs in shadow mode on the buyer's own
  history (it reads exported records and takes no action). The pilot then converts to an annual commit plus a price per
  verified case.
- **What not to sell.** Not "cheap models", not customer-service (CX) chat, not small-business self-serve automation, and
  not a standalone governance product or testing product.
- **90 days (§4.3).**
  1. Finish the development experiments that a buyer's questions depend on: spec from a messy business, automatic mocks,
     drift, and the strongest agent baseline. All four are already planned and budgeted.
  2. Build an AP bed from public rulebooks and the public BPI 2019 purchase-to-pay log.
  3. Run 15 discovery interviews.
  4. Sign one paid design partner.

  First revenue is the pilot fee. The real test is whether the pilot converts to a contract.
- **Main risks (§5).**
  - Deriving the spec and building the mock for each customer may cost so much engineering that this becomes a services
    business.
  - Incumbents bundle healing and agents into contracts the buyer already has.
  - The vendor could be liable for wrong payments.
  - A solo operator may not get access to the customer's data.

  Section 5.2 gives dated kill criteria.
- **Self-critique (§6).** I attacked the first draft as a sceptical VC and a sceptical CFO would, and it changed seven
  things (§6.3).

---

## 1. The buyer and the job to be done

The buyer is the person accountable for a recurring cross-system process at a company with roughly 1,000 to 20,000
employees: an AP or finance-operations lead, an order-operations lead, or the head of an automation centre of excellence.
The economic signer is usually the controller, the CFO's operations deputy, or the COO or CIO.

These buyers already pay for:
- RPA (robotic process automation), iPaaS (integration platform) or ERP workflow licences;
- the services needed to keep those working, which cost about 2.7 to 3.4 times the software (§2.3);
- the people or BPO who handle the exceptions, which is where the cost per case concentrates. For AP, the average cost
  per invoice is $9.90 against $2.67 for the best performers, and 19.9% of invoices hit an exception [vendor-sponsored
  survey, fact✓].

Their job is: *"Take this recurring process that today ends in a human queue, run it end to end across our systems, show
me per case that it was done right, quote me the cost in advance, and keep it working when a system or a policy changes,
without hiring people to babysit bots or agents."*

They have reasons to be sceptical:
- Gartner predicts that more than 40% of agentic AI projects will be cancelled by the end of 2027 [analyst].
- In S&P's survey, 42% of companies abandoned most of their AI initiatives in 2025 [fact].
- CIOs say they are "still uncomfortable with how outcome metrics are set, measured, and billed" [fact, a16z 2025-06-10].

So the job includes making the outcome measurable, not only producing it.

---

## 2. Five things organisations demonstrably pay for, and what this stack could supply

### 2.0 The price ladder: what one unit of work sells for

| Unit | Price | Source |
|---|---|---|
| Durable-execution action | $0.000025–0.00005 | Temporal $25–50 per million actions [fact]; Inngest from $0.000015 per execution [fact] |
| iPaaS task or run | $0.0017–0.027 per task; €0.0133 per run | Zapier tiers; n8n Business overage €4,000 per 300K runs [fact, arith] |
| Deterministic agent-flow step | $0.0013 | Copilot Studio, 13 credits per 100 flow actions at $0.01 per credit [fact✓, arith] |
| Agentic action | $0.05–0.10 | Copilot Studio agent action, 5 credits [fact✓]; Agentforce action, 20 Flex Credits at $500 per 100K [fact, arith] |
| AI conversation or resolution | $0.99–2.00 | Fin $0.99 per outcome [fact✓]; Agentforce $2 per conversation [fact]; Zendesk about $1.50–2.00 [unverified, eesel.ai] |
| Verified UI heal | about $1 | UiPath Self-Healing add-on, "$5K / 5K heals" [fact✓] |
| Human live contact | $8.01 (2019) | Gartner 2019 poll [fact, dated] |
| AP invoice processed | $9.90 average, $2.67 best in class | Ardent Partners, sponsored by Medius [vendor-sponsored survey, fact✓] |
| Unattended RPA bot | $150–215 a month | Power Automate Process and Hosted Process [fact] |
| Process discovery | $5,000 per tenant per month | Power Automate Process Mining add-on [fact] |

**Reading [I, arith].** From an orchestration step to a business outcome, the price per unit of work rises four to five
orders of magnitude. Foundry's own cost sits at the step end:
- On E8, our order-fulfilment saga bed, three Haiku builds plus two repairs cost $1.70 in total. That reached 1,022 of
  1,022 completed dev cases, about $0.0017 per case amortised. After the build, each world runs as code in seconds
  [repo-dev, `research/enterprise-20261014/B1-E8-DEV.md`].
- That figure excludes the cost of building the world, which was frontier-built and never recorded (F5).

To make money, Foundry has to price at the outcome end, per verified case or per maintained process, and never per step
or token.

**A correction to the input evidence [fact✓].** Microsoft's rate page says its rates "apply to all language models that
Copilot Studio provides". It also says they "exclude bring-your-own-model configurations, including Azure Foundry models,
which are billed separately". So a Copilot Studio customer can bring a cheap model, but then pays for it on a separate
meter. The research pass's reading, that a customer gets nothing back for routing work to a cheap model, holds only for
the models Microsoft provides.

### 2.1 Finished work, priced per outcome, with a "done" the buyer can check

**What buyers pay today.**
- **Intercom Fin: $0.99 per outcome** [fact✓, intercom.com/pricing]. An outcome counts when:
  - the customer confirms the issue is resolved;
  - they "don't ask for more help after Fin responds";
  - Fin "completes a workflow (Procedure), including handoffs".

  It is charged once per conversation, with a minimum monthly commitment ("e.g. 50 outcomes").
- **Zendesk** bills an automated resolution only after "a verification process is performed by an LLM". Conversations
  that fail "do not consume an automated resolution", and escalated conversations are not evaluated [fact✓,
  support.zendesk.com/hc/en-us/articles/5352026794010]. Rates are not published; a third party reports about $1.50
  committed and $2.00 pay-as-you-go [unverified].
- **Sierra**: "gets paid only when we complete a task for you", for example a resolved conversation, a saved
  cancellation or an upsell. "If the conversation is unresolved, in most cases, there's no charge" [fact✓, blog
  2024-12-10]. Sacra estimates Sierra's annual recurring revenue (ARR) at about $200M in May 2026 [analyst].

**What buyers say they want.**
- IDC's CIO quick poll (N = 72) found CIOs prefer "a fee based on achieving a specific predefined business target"
  [fact].
- Orb found outcome pricing at only 3.8% of 80 AI-agent companies, and puts the gap down to instrumentation [analyst].
- ICONIQ reports 18% [analyst]. Sources define "outcome-based" loosely.
- Bessemer's conditions for outcome pricing, per secondary summaries: the outcome is unambiguous, measurable and
  cleanly attributable [analyst].

**The gap [I].** Today's "done" is one of three things:
- customer silence (Fin);
- a language-model grade (Zendesk);
- criteria agreed per contract (Sierra).

None is an executable check that the buyer can rerun.

**What this stack could supply:**
- frozen acceptance contracts made of executable postconditions;
- verifiers labelled by how independent they are of what they check;
- oracle controls: bad, gaming and necessity arms that must fail;
- a mutation score for the grader itself.

**How much is shown [repo-dev].**
- Our own evidence on self-checks is negative, which is the point:
  - In C0 dev, the workflow's own run verdict said "pass" on 32 of 32 trials, including the 5 that the oracle failed.
  - In P1, the workflow passed its own only failure (README "Results").
  - The README still lists "Honest run verdicts" as broken in the product runtime.
- What held up was always an independent check:
  - E8's oracle with its controls;
  - N-version disagreement, which localised every defective order with precision 1.00
    (`research/architecture-20261015/FABLE-WHAT-WE-MISS.md` I-1).
- So the sellable property exists in the beds, not yet in the product.

### 2.2 Spend they can predict and cap

**What buyers pay today.**
- **Salesforce** moved from $2 per conversation, to Flex Credits, to per-user licences, to a flat-fee "Agentic
  Enterprise License Agreement" (AELA). Its chief revenue officer: "Customers don't want to count tokens. They want
  predictability" [vendor, Constellation Research 2025-10-16]. Forrester: buyers now ask about "ROI and IRR" and the
  "useful life of the agent" [analyst, 2025-12-17].
- **Copilot Studio** disables custom agents when a tenant reaches 125% of its prepaid capacity [fact✓].
- **Cursor's** June 2025 switch to usage billing caused a public apology and refunds [fact, TechCrunch 2025-07-07].
- **ICONIQ:** 40% of AI-builder executives cite customer demand for predictability [analyst].

**The gap [I].** Agent meters charge per action, so the bill grows when the agent wanders. The caps work by switching the
agent off.

**What this stack could supply.**
- Once built, a workflow is code. The model calls inside it are narrow typed calls: a Haiku 5.5 typed call takes about
  1–1.5 s and costs under $0.001 (README).
- So the cost of a run can be bounded before it starts.
- The SPINE-0 meter reserves each call's worst case and books a timed-out call at its bound instead of at $0
  (`research/architecture-20261015/FIRST-CLASS-PROGRAMS.md` §0.3; landed in `a2afd63`).

**How much is shown [repo-dev].**
- **E8, sized world (21 orders, 14 completed cases):**

  | Arm | Passed | Cost | Time |
  |---|---|---|---|
  | Built workflows | 14/14 | $0.39–0.73 to build once, then $0 per world | seconds |
  | Agent with no workflow | 10/14 | $1.45 | about 1.5 h |

  On these 14 cases, that is about $0.145 per verified success for the agent [arith]. The workflow's build cost spreads
  over every later case. The difference is not significant: exact McNemar p = 0.125.
- **P1:** a hand-written workflow on Haiku scored 35/36 at $0.0162 per success. One Sonnet call scored 28/36 at $0.3175
  per success. The cost-per-success ratio is 0.051, but the success gap is "largely an artefact" of timeouts (README).
  The honest reading is "cheaper at equal success".
- **Caveat:** none of these figures counts the cost of the world or the spec.

### 2.3 Keeping automations working: breakage, exceptions and upkeep

**What buyers pay today.**
- **Licences are a minority of the cost.** They are 25–30% of RPA total cost of ownership [analyst, HFS 2018].
- **Services cost more than the software:**
  - $3.41 of services for every $1 of RPA software, mostly spent maintaining bots, not building them [analyst,
    Forrester keynote recap; Tricentis-sponsored, 2019];
  - a forecast of $16B services against $6B software for 2025 [analyst, Forrester via iTnews 2022-03-02].
- **Bots break often:**
  - 45% of firms deal with bot breakage weekly or more often [vendor, Forrester for Tricentis 2020];
  - 69% see broken bots weekly, and 41% say a fix takes more than 5 hours [vendor, Robocorp 2022].
- **Much of the cost goes untracked:** up to 65% of automation total cost of ownership [analyst, Everest 2023].
- **Healing already has a price.** UiPath sells Self-Healing at "$5K / 5K heals" as a Test Cloud Standard add-on, and
  includes it in Enterprise [fact✓].
- **UiPath's Healing Agent** repairs selectors, pop-ups and waits, and logs each heal [fact].

**The gap [I].** Healing at the UI level shows that the bot runs again. It does not show that the business outcome is
still right.

**What this stack could supply.** Healing against the contract:
- a failure goes to a fresh cheap builder that sees only the evidence;
- the fix is promoted only after the independent check and a replay of a regression slice pass;
- N-version disagreement localises defects without truth labels.

**How much is shown [repo-dev].**
- **Shown, once:** in E8's N-version repair (B1N), two flawed lineages at 95.3% and 99.3% were repaired to 100% for $0.16
  in total, with no oracle in the loop.
- **Not shown: upkeep over time.** F7's DRIFT-1 has not run.
- **The product heal kit is blocked** by `HEAL_POLICY_DRIFT`, with 66 tests skipped (README).
- **In the JIT dev stream:**
  - a static solver failed silently on d4 drift, passing only 2 of 8 tasks;
  - a heal that widened a guard turned refusals into silent failures (`docs/RESEARCH.md`, JIT rows).
- **The M9 drift detector**, a risk-adjusted CUSUM chart, detected 0 of 4 drifts at its target false-alarm rate
  (`research/jit-20261008/analysis/cusum/REPORT.md`).

**Self-healing is the least-proven property we would sell.**

### 2.4 Proof and control: audit evidence, least privilege, guarantees

**What buyers pay today.**
- **Governance as a SKU.** Microsoft Agent 365 (agent registry, observability, access control, audit) costs $15 per user
  per month, and is included in the $99 Microsoft 365 E7 bundle [fact].
- **Guarantees.** Fin pays $1M if an enrolled high-volume customer misses a 65% resolution rate. Its guarantee page does
  not say how that rate is measured [vendor].
- **Oversight as a budget line.** Gartner predicts "guardian agents" will be 10–15% of agentic AI markets by 2030
  [analyst, 2025-06-11].
- **Human review is still the norm:**
  - 74% of practitioners with deployed agents rely mainly on human evaluation, and 68% of agents run 10 steps or fewer
    before a human steps in [fact, Pan et al., arXiv 2512.04123];
  - 89% of teams have observability, but only 37% run online evaluations, and LLM-as-judge is used by 53% of those who
    evaluate [vendor, LangChain survey].

**The gap [I].**
- Governance SKUs inventory agents and trace them. They do not certify the outcome.
- Guarantees exist, but the measure behind them is undefined.

**What this stack could supply.**
- a hash-chained run journal, checked by `foundry verify-run`, with external anchors;
- record and replay of every model call;
- taint labels on untrusted data, with control-flow taint enforced;
- least-privilege capability grants (F2);
- approvals bound to an exact digest, an expiry and a cost quote (the K-Dense pattern,
  `research/harness-deconstruct-20261015/SYNTHESIS.md` item 2).

**How much is shown [repo-dev, README].**
- **Exists:** `verify-run` and its anchors. Control-flow taint landed, and newly rejected 0 of 393 suite workflows.
- **Not built:** the capability broker and the digest-bound approvals. LP-1, the least-privilege experiment, is planned.
- **Not reviewed:** the owner has not yet reviewed the run viewer.

**Positioning [I].** Register each micro-harness as a governed agent in the buyer's control plane, and export its evidence
there. Do not compete with Agent 365.

### 2.5 Done-for-you implementation, tied to the outcome

**What buyers pay today.**
- **Sierra** sells outcomes together with forward-deployed implementation in multi-year contracts. It raised a $950M
  Series E at a $15.8B valuation in May 2026 [analyst, Sacra].
- **Buying beats building.** MIT NANDA's preliminary study found that bought or partnered solutions succeed about 67% of
  the time, and internal builds a third as often. It found the best returns in back-office automation that replaces BPO
  and agency spend [analyst, Fortune 2025-08-18].
- **Typical annual contract values (ACV):**

  | Vendor or segment | ACV | Source |
  |---|---|---|
  | Workato (integration) | median $64.5K a year, 343 purchases | [analyst, Vendr] |
  | UiPath (RPA) | median $45.7K | [analyst, Vendr] |
  | Decagon (AI customer service) | about $50K platform fee plus usage; median about $386K | [analyst, partly from a competitor] |
  | ServiceNow Now Assist | 35 deals above $1M in Q4 2025 | [fact] |

**What this stack could supply.** Construction cheap enough to repeat:
- Haiku with a practice world built E8's solver for $0.39–0.62 per lineage, so an engineer's hours go into the contract
  and the world, not the code.
- Three independent cheap builds, enough for N-version checking, cost less than one frontier one-shot build. Opus's
  one-shot build cost $7.63 and passed 27.5%.

**Not shown.** How many hours it takes to derive the spec from a real business (F4, SPEC-1) and to build its world (F5,
FID-1). E8's world took 63 commits, and its cost was never recorded.

### 2.6 Readiness: what a buyer would ask for, and what exists today

This is the commercial answer to "where are we against the vision".

| Buyer asks for | What exists | Status |
|---|---|---|
| A signed, executable definition of "done" per process | the requirement tracker (S4); E8's oracle and controls; AutomationBench's reusable assertion grammar (112 types over 60 dev tasks, FABLE I-4) | development; deriving it from a messy business (SPEC-1) has not run |
| A verifier with a known false-pass rate | E8 oracle with controls; mutation score ≥ 0.95 in progress (#59) | partial; the product's own run verdicts are still listed as broken |
| Cheap, repeatable builds | E8: 3 of 3 Haiku lineages at 95–100%, all 100% after $0.16 of repair | development, one bed we wrote, K = 3 |
| Works on systems we did not write | AutomationBench dev60: Haiku + prose harness 22/60 (36.7%) vs raw Haiku 12/60 (20.0%), McNemar p = 0.013 (`research/automationbench-20261014/runs/DEV60-A0-A1.md`) | development; the held-out AB-v1 run has not happened; the code-owned A1-C is in build |
| Mocks of their systems | E8's hand-built systems; FID-0 and FID-1 planned | not measured; world cost unrecorded |
| Survives change | the N-version repair path | upkeep not measured; heal kit blocked; M9 negative |
| Cost per verified case, all costs in | SPINE-0 claim row and meter (1,514 rows back-filled) | built as dev tooling; world and upkeep columns empty |
| Audit evidence per case | `verify-run` hash chain, anchors, run viewer prototype | built; not reviewed by the owner |
| Least privilege | control-flow taint | broker not built; LP-1 planned |
| Long-running enterprise semantics (durable waits, signals, compensation) | engine column E3 in progress | `state`, `wait.signal` and `compensate` are not in the product IR (`research/enterprise-20261014/BAR-SET.md`) |
| Evidence that the method knows when not to build | stream calibration: when a Haiku agent solves a family for a few cents, compiling cannot pay (`docs/RESEARCH.md`); F1 earned structure | designed; EARN-1 planned |
| A real customer's process | none | missing (F6 owner rung) |

---

## 3. Three candidate offers

### 3.1 Offer A: Verified Operations, a reliability layer priced per verified outcome

**Pitch.** "Point us at a recurring process, or at recurring work your agents already do. Together we write down what
'done' means as checks you sign. We build a small workflow that runs it, prove each case, and keep it working when your
systems change. You pay per verified case."

The owner's meta-harness is the factory behind this offer. The micro-harness is the unit sold: one recurring job, one
signed contract, one evidence trail, one price per verified completion.

**Packaging [I].**
- **An annual platform commit.** It covers the governed harness: journals, evidence export, least-privilege grants, and
  approvals bound to a digest and a cost quote. It runs self-hosted or in our cloud, with the customer's choice of model.
- **Per process:**
  - an onboarding fee for the contract, the world and the build;
  - then a price per verified case.
- **Upkeep:** included up to a stated budget of heals per process per quarter, then a price per verified heal.
- **Ownership:** the customer owns its contracts and workflows, as typed JSON and code. This answers Gartner's "Who owns
  what the system learns from you?" clause [analyst, 2026-07-01].
- **Later, a clawback, not a guarantee.** A billed case that the agreed check later finds wrong is credited. No guarantee
  on resolution rate until false-pass rates have been measured on real data (§4.4 rule 7).

**Pricing hypothesis [I, untested].**
- **Commit:** $40–80K a year, between UiPath's and Workato's medians.
- **Per verified case:** 20–35% of the buyer's measured current cost per case.
- **Per verified heal:** a few dollars. UiPath's roughly $1 per UI heal sets the floor, and a heal that comes with proof of
  the outcome may command more.
- **Land:** $50–150K in year one for one or two processes, consistent with the ACV bands in §2.5.

**ICP (ideal customer profile).**
- A company with roughly 1,000–20,000 employees.
- One process with at least 2,000 cases a month that crosses at least two systems.
- A written SOP and a human exception queue.
- A process owner who reports cost per case or exception rate.
- An existing automation whose breakage they pay to fix.
- Not CX chat.

**Competitors, and why they could lose.**

| Competitor | How it competes | Why it could lose here [I] | Where it wins |
|---|---|---|---|
| UiPath (agents, Maestro, Healing Agent) | installed RPA base; ARR $1.938B; 97% gross retention [fact] | heals the UI, not the outcome; meters per LLM call, except bring-your-own-model runs, which are per run | owns the bots; buyers rarely rip it out. Sell beside it and call its bots as nodes |
| Microsoft (Power Automate, Copilot Studio, Agent 365) | bundles and credits | meters actions; disables agents at 125% of capacity; certifies no outcome | distribution and the existing tenant |
| Salesforce Agentforce, plus Fin | AELA flat fees; Fin outcome pricing | defines "done" inside its own CRM; Fin's outcome counts customer silence | owns the CRM's system of record |
| ServiceNow Now Assist | AI in every tier, "assist" top-ups | ITSM home turf; done defined inside one platform | owns ITSM; more than $1M per deal |
| Celonis | process intelligence, plus an orchestration engine and an MCP server [vendor] | claims value, not independent verification | already has the event logs and the KPI baseline. Possibly a partner: its MCP server is a natural F4 input |
| Workato; n8n (being embedded in SAP Joule Studio) | per-task or per-run iPaaS | no verification; per-step economics | integration catalogues; n8n's OEM route |
| BPOs and outsourced shared services | price per FTE or per transaction | labour-priced; no per-case proof [I, not researched] | trust, scale, liability already absorbed |

The common weakness [I]: none of them prices on an executable, independent per-case check, and system-of-record vendors
cannot define "done" across systems they do not own. Their common strength: distribution, bundled prices, security
certifications and trust. A solo vendor cannot out-sell them. It has to be invited in where they are weak: across
systems, on exceptions, and where proof is needed.

**What a buyer needs proven, before signing a commit:**
1. On their own historical cases, held back from the build:
   - the share of cases the workflow closes;
   - the share the independent check certifies;
   - agreement with what their staff actually did.
2. The check's false-pass rate on a random sample their staff audit.
3. Cost per verified case, with every cost in: build, world, model and upkeep.
4. What a change costs: time and money to a verified heal.
5. Wall time per case.
6. A security story: least privilege, no write access during the pilot, and data kept in their environment.

**Which of our experiments produce it** (dev unless noted; all are on the existing F roadmap,
`FIRST-CLASS-PROGRAMS.md` §10):

| Experiment | What it answers |
|---|---|
| E8 B1L and B1N | build and repair |
| AGENTV-E8 | whether a workflow is needed at all, or a validated agent is enough |
| SPEC-1 | how much survives a messy business |
| FID-1 and FID-2 | whether automatically built mocks can be trusted |
| DRIFT-1a and DRIFT-1b | upkeep |
| EARN-1 and EARN-W | when building pays |
| LP-1 | least privilege |
| OUT-2 | real recurrence, from BPI logs |
| SPINE-0 | cost per verified success |

None of them produces items 1 or 2 on a real customer. Only a pilot does.

### 3.2 Offer B: Practice Worlds, agent testing on stateful mocks with executable graders

**Pitch.** "Before your agent touches production, it runs a thousand cases in a twin of your systems, graded by checks a
wrong answer cannot pass."

**Packaging and pricing hypothesis [I].**
- A system twin with a per-endpoint fidelity report, using tiers M0–M3 (`FIRST-CLASS-PROGRAMS.md` §5.4).
- A CI gate for agent changes, and certification reports.
- $10–30K per twin, plus 15–25% a year for maintenance, or a subscription per twin. Certification runs are metered.

**ICP.**
- Platform teams building internal agents on enterprise systems.
- Agent startups selling into enterprises.
- Systems integrators.
- Labs that need training environments.

**Competitors.**

| Competitor | What it offers | Tag |
|---|---|---|
| Patronus AI | $50M Series B on 2026-06-25, $70M in total. Its "Digital World Models" replicate "websites and internal systems"; revenue grew "15-fold over the past year"; an investor says "virtually every frontier AI lab" is a customer | [fact✓ for the round; vendor or investor for the rest] |
| Deeptune | $43M Series A led by a16z, March 2026; one aggregator reports an acquisition by Mercor | [unverified] |
| Bespoke Labs | reinforcement-learning environments | [unverified, aggregator] |
| Evaluation and observability platforms | e.g. LangSmith, $39 per seat with 10K base traces a month [fact✓]; Braintrust | tracing is near-universal and commoditising: 89% of teams have it [vendor] |

**Why they could lose [I, not checked against their documentation].** Fidelity numbers per endpoint, measured against a
reference, and graders that carry controls and mutation scores, are not what these vendors advertise.

**Why we lose.**
- They are funded, staffed, and already selling to the largest buyers of environments, the labs.
- Environments for labs behave like a data-labelling business, with a few large buyers we cannot reach.

**Proof.**
- FID-1: the same verdict on at least 0.95 of cases, and no leniency flip.
- FID-2: against AutomationBench's own implementation.
- E8's oracle mutation score at 0.95 or above.
- The build cost per twin.

**Verdict.** Not a standalone business for us now. The practice world is the engine inside Offer A: it is what took a
Haiku build on E8 from 0% to 100%. It is also a deliverable within A, since the customer keeps its twin. Revisit if both
FID-1 and FID-2 pass and a design partner asks for it.

### 3.3 Offer C: the AP Exception Desk, a vertical wedge

**Pitch.** "Every invoice that fails matching comes back resolved, or routed with the reason, with a proof pack: the match
computation, the tolerance rule applied, the documents used and the approvals. Payments stay with your people until you
say otherwise."

**Packaging and pricing hypothesis [I].**
- **Pilot:** a fixed-fee pilot in shadow mode on exported history, $15–25K.
- **After the pilot:** a platform commit plus a price per verified exception closed, in the range of $2–5, to be
  validated in discovery.
- **Price anchor:** Ardent's figures, $9.90 average against $2.67 best in class per invoice, with exception rates of 19.9%
  against 11.8% [vendor-sponsored survey, fact✓]. At 50,000 invoices a year, that gap is about $360K a year [arith].
- **ERP:** one ERP first. D365 is the engineering choice, because its AP documentation is CC BY 4.0 with worked numeric
  examples. The market choice needs discovery.

**ICP.** AP teams that:
- process at least 5,000 invoices a month;
- have an exception rate of 15% or more;
- already have a capture tool;
- use an ERP with two- and three-way matching.

**Competitors.**
- ERP-native matching and holds: D365, SAP, Oracle.
- AP automation suites such as Medius, Coupa, Basware, Tipalti and Stampli [recalled, not researched]. In the Ardent
  report, 58% of AP organisations already use or pilot AI, mainly for capture, exception management and fraud [vendor].
- RPA.
- BPO and shared-service centres.

**Why they could lose [I, unverified per vendor].** Capture is solved. Exceptions are where the cost concentrates. The
suites handle exceptions inside one product, with no executable proof per case.

**Why we lose.**
- They own the AP workflow and the relationship.
- The data sits in the ERP.
- A wrong payment is a liability.
- They are adding exception agents quickly.

**What a buyer needs proven.** On N held-back historical exceptions:
- the share resolved the same way their staff resolved it;
- the share escalated with the right reason;
- zero payments wrongly approved;
- a proof pack their auditor accepts;
- cost per exception, against theirs.

**Our assets.**
- **E1:** P2P three-way matching with the D365 tolerance hierarchy, calibrated against BPI 2019 (251,734 purchase-order
  items, 11,973 variants). It is designed in `research/enterprise-20261014/BAR-SET.md` but **not built**.
- **AB-R `abr-fin-apintake`:** invoice extraction, three-way match, payment approval with "human approval before payment",
  and duplicate-payment detection. It is a **held-out** family and must not be used for development (§4.4 rule 4).
- **AutomationBench finance dev:** raw Haiku passed 4 of 10 tasks, Haiku with the prose harness 7 of 10. The sample is
  far too small to read.
- OUT-2 (BPI recurrence) and SPEC-1.

**Verdict.** This is the best first process for Offer A, for five reasons:
- a public benchmark states the money per case;
- the end state is checkable, since a match either holds within tolerance or it does not;
- the rules are public, with worked examples;
- a real event log exists for calibration;
- the irreversible step, payment, can stay human.

### 3.4 Considered and set aside

| Option | Why not now |
|---|---|
| A horizontal meta-harness or developer platform, priced per seat or per run | Orchestration and tracing are commodities: Temporal charges $50 per million actions, Inngest and LangSmith are cheap. The labs already ship dynamic workflows (THESIS §3). Buyers buy outcomes over toolkits (MIT, §2.5). Keep the meta-harness as the factory behind A, and consider OEM later on the n8n route: SAP's investment at a $5.2B valuation on 2026-05-12, and the Joule Studio embed [fact] |
| CX resolution agents | Priced at $0.99–2 by vendors that are consolidating: Salesforce is buying Fin for about $3.6B [fact✓]; Sierra is valued at $15.8B [analyst]. Silence-based "done" is accepted there |
| Small-business self-serve automation | Zapier's median contract is $15K a year [analyst, Vendr]. Per-task commodity pricing |
| Standalone agent governance | Agent 365 at $15 per user per month, and in the E7 bundle [fact] |
| A contract library sold on its own (FABLE I-4) | Promising as the reusable asset: checks recur where workflows do not. Sell it inside A first |

---

## 4. Recommended wedge and a 90-day plan to first revenue

### 4.1 The wedge

**Offer A, delivered through Offer C's process first. Offer B stays internal.**

**Positioning sentence.** "Verified completions for recurring back-office exceptions. We bill only the cases our
independent check certifies, and you can replay any of them."

**Why this wedge.**
- It sells the property the evidence ranks highest: a checkable "done" as the meter (§2.1).
- It targets the largest pool of money: exceptions and upkeep, which are the 70–75% of automation cost that sits
  outside the licence (§2.3).
- It avoids every consolidating market.
- It reuses the assets that exist: E8's build loop, the tracker, the SPINE-0 meter and `verify-run`.

**Alternates if AP discovery fails.**
1. Order-to-cash and fulfilment fallout, closest to E8. The money evidence there is vendor-only: 10–20% fallout and $3–10
   per correction [vendor].
2. ITSM (E7), which is the incumbent's home turf.

### 4.2 Owner decisions needed first

Nothing in this document authorises any of these.

1. **Whether to commercialise at all, and through which entity.** AGENTS.md forbids account changes, publishing and
   production interventions in this project. A pilot needs those boundaries changed for a separate engagement, by the
   owner.
2. **Customer data.** A pilot receives exported business records. They must stay out of this repository and live in a
   separate workspace under a data-processing agreement [I].
3. **Model access for commercial use.** Experiments run through `claude -p` on a subscription, where list price is "a
   yardstick, not a charge" (README cost ledger). A commercial pilot needs a proper API route and terms. The owner's
   standing rule against new credentials blocks that today.
4. **Time.** A solo owner selling and delivering draws on the same weekly allowance as the research roadmap.

### 4.3 The plan (2026-10-15 → 2027-01-13)

| Weeks | Dates | What | Reuses | Output | Gate |
|---|---|---|---|---|---|
| 1–2 | 10-15 → 10-29 | Finish the dev rows a buyer's questions map onto: AGENTV-E8 (paused, resumable), SPEC-0/1, FID-0/1, DRIFT-0/1a, OUT-2. All are on the F roadmap and inside the adopted $2,700 cap-basis soft cap, so no new spend. At $0: an evidence-pack template, the pricing-hypothesis sheet, an interview script and an ICP list | E8 bed and builds, tracker, SPINE-0, `verify-run`, `tools/run-view/`, BPI 2019 | readings: supported, refuted or inconclusive | **G0 (10-29):** the K2–K4 readings in §5.2 |
| 3–6 | 10-29 → 11-26 | 15 discovery interviews: 10 AP or finance-ops leads, 3 automation CoE leads, 2 integrators. Record stated cost per exception, volume, tools, who signs, whether data can be exported, and security requirements. In parallel, **E1-lite**: P2P matching with the D365 tolerance hierarchy, a world generator calibrated on BPI 2019, an oracle with bad, gaming and necessity controls, then B1L-H and B1N-H builds. Its own preregistration and cap; estimate $5–15 [I] | D365 docs (CC BY 4.0), BAR-SET E1 card, E8 build loop, N-version repair | the first construction number not on E8 (dev); an interview table | **G1 (11-26):** K1 and K5 |
| 7–10 | 11-26 → 12-24 | One paid design-partner pilot at a fixed fee, run as described below | everything above | pilot results | — |
| 11–13 | 12-24 → 01-13 | Readout against the pre-agreed metrics. Conversion proposal: commit, per verified case and upkeep. **First revenue is the pilot fee**, invoiced at signature | — | readout; a signed or declined conversion | **K6 and K7** |

**How the pilot runs:**
1. The buyer exports several months of exception history.
2. We write the acceptance checks together and both sign them, before the build sees the held-back months.
3. The build uses the earlier months only.
4. It runs in shadow mode: no write access and no payment action.
5. Results are scored against what their staff did, plus a staff audit of a random sample of the cases the check
   certified.

**Realism [I].** Enterprise buying cycles are usually longer than 90 days. The realistic first signer is a mid-market AP
team, or an integrator's client brought in through the integrator. If nothing is signed by day 75, the first-revenue
goal has failed and §5.2 applies.

### 4.4 Rules that keep the research honest

1. **A claims register.** Only S1 claim rows may be quoted outside the repository, each with its evidence class, K, bed
   origin and cost split. Development numbers always carry "development, one bed we wrote".
2. **Pilots are preregistered with the buyer.** The contract, metrics, held-back months and thresholds are frozen before
   the build sees anything held back.
3. **Pilot data never enters the repository or any development set.** A pilot's results count as F6 owner-rung evidence
   only with the customer's written permission. Otherwise the record says only that a private pilot happened, with no
   numbers.
4. **Commercial work never touches protected material:** stamped trees, AB-v1 harness files, held-out families such as
   `abr-fin-apintake`, or `beds/sealed/`.
5. **Commercial work has its own budget line.** No research row is re-scoped to make a demo look good.
6. **Negative pilot results are recorded** like any other result.
7. **No guarantee or clawback is offered** until a false-pass rate has been measured on real held-back cases, with an
   interval.

---

## 5. Risks and kill criteria

### 5.1 Risks

| Risk | Evidence | Mitigation [I] |
|---|---|---|
| Incumbents bundle it | UiPath Healing Agent, bundled or $1 per heal [fact✓]; Agentforce AELA flat fees [vendor]; ServiceNow puts AI in every tier [unverified]; Agent 365 [fact]; SAP embeds n8n [fact]; Salesforce buys Fin [fact✓] | Stay cross-system and on exceptions. Bring-your-own model, self-host, and customer-owned contracts as JSON. Plug into control planes; consider OEM later |
| Liability for a wrong payment or effect | Irreversible effects; Fin's guarantee shows buyers expect risk reversal [vendor] | No payment execution in v1. Propose plus prove; a human releases. Capped liability; a per-case clawback only after K6 |
| Data access and security review | A solo operator has no SOC 2 [I]. Regulated enterprises plan approvals (42% against 16% of unregulated) [vendor, Cleanlab] | Exported history in shadow mode; the buyer's tenancy; least privilege (F2); mid-market first |
| The spec from a messy business costs too much (F4) | Every E8 arm got a perfect 9K-token rulebook (OWNER-DECISIONS F4). A ledger's existence is not requirement recall: 0/6 on AB first6 | SPEC-1 measures it. The tracker and precedent records (FABLE I-6). Kill criterion K2 |
| Mocks cost too much (F5) | E8's world cost is unrecorded (63 commits) | FID-1 measures it; mock cost goes into every S1 row; K3 |
| It becomes a services business | Sierra and Decagon bundle implementation [analyst]; the RPA services multiplier [analyst] | Record engineer-hours per process from the first pilot; K7 |
| Upkeep is unproven | DRIFT not run; heal kit blocked; M9 negative [repo-dev] | DRIFT-1a/1b before any upkeep price is quoted; K4 |
| Many recurring processes do not need a workflow | A Haiku agent solved several stream families for 2–4 cents, so compiling cannot pay (`docs/RESEARCH.md`) | Sell only where state, time, irreversibility or exactness force structure (F1's hard primitives); the router says "no build" honestly |
| Outcome pricing is rare and hard to procure | 3.8% (Orb) [analyst]; "Procurement teams don't yet have the frameworks" (CRN partner quote via the evidence) [unverified] | Hybrid: commit plus per verified case, with a fixed-fee pilot |
| Model dependency and terms | Experiments run on a subscription CLI; Haiku 5.5 list price is $0.10/$0.50 per MTok (README) | Bring-your-own model; model ids only from policy; workflows run as code |
| Commercial pressure bends the research | The AutomationBench plan already notes a "publishable score" pull (FABLE I-7) | §4.4 rules; a separate budget line |
| A solo operator's bandwidth | THESIS §6 red team | Through an integrator or a design partner; one process at a time |

### 5.2 Kill criteria

Each criterion is read by the rule FIRST-CLASS uses: supported, refuted, or inconclusive when below the minimum
detectable effect. "Kill" means stop that line of commercial work. The research continues.

| # | When | Criterion | If it fires |
|---|---|---|---|
| K1 | day 45 (11-26) | Fewer than 5 of 15 qualified interviewees can state a cost per exception, would pay per verified case, and could export history | Drop AP and try the order-fallout alternate once. If that also fails by day 75, stop commercial work |
| K2 | after SPEC-1 (about 10-26) | S-derive scores below S-none-agent on the shared cases (SPEC-1's own refutation), or its spec recovery ratio is below 0.6 | No per-outcome pricing: building from a messy business is not yet reliable. At most, offer A as a services-priced engagement |
| K3 | after FID-1 (about 10-23) | Docs + traffic + probes gives the same verdict on fewer than 0.9 of cases, or flips any necessity control to pass | Offer B is dead. Offer A needs hand-built worlds, so price onboarding as services and watch K7 |
| K4 | after DRIFT-1b (about 11-02) | Agent-adapt reaches a higher cumulative pass rate at no more than 2× WF-heal's total cost (DRIFT-1's refutation) | Drop upkeep from the offer; sell builds and verification only |
| K5 | 11-26 | AGENTV-E8 reaches 14/14 (its refutation) *and* the E1-lite workflow does not beat the agent-plus-validator arm on cost per verified case | The workflow is not the product; the verifier is. Re-cut A as "verified outcomes for your existing agents": the contract library plus independent checks, with no workflow construction |
| K6 | pilot readout | On the held-back cases, the check's false-pass rate exceeds 1% in the staff audit, or the verified-case rate is below the buyer's current straight-through rate | No conversion and no guarantee. Record it as a negative result |
| K7 | pilot readout | Onboarding takes more than about 80 engineer-hours per process, which puts gross margin below 50% at the price the buyer accepts [I threshold] | It is a services business. Either price it as one, or stop |

---

## 6. Adversarial critique, and the revision it caused

### 6.1 A sceptical VC

1. **"Your evidence is one synthetic bed you wrote, with three lineages, dev only. Nobody buys on that."** Accepted. The
   first draft led with E8's 100%. The revision leads with a pilot on the buyer's own history, and uses E8 only to
   illustrate the method (§4.3, §4.4 rule 1).
2. **"Where is the moat? Haiku is available to everyone, UiPath ships healing, Patronus has $70M for worlds. Cheap
   construction is not defensible."** Accepted in part. Cheapness is the margin engine, not the moat. The candidate moats
   are three:
   - a contract library per system, because checks recur where workflows do not (FABLE I-4);
   - each customer's history of earned workflows and evidence, which creates switching cost;
   - independence semantics that the buyer can audit.

   All three are unproven as moats. The pitch no longer says "cheap models" (§0, §4.1).
3. **"This is a consultancy in disguise. Forward-deployed engineers, no software leverage."** Accepted as the main risk.
   K7 was added; F4 and F5 costs must enter every S1 row; Offer B was demoted to the internal engine.
4. **"A solo founder cannot sell to enterprises. Cycles run 6–12 months, and SOC 2 is table stakes."** Accepted in part
   [I, not evidenced here]. The revision targets mid-market AP teams and integrators' clients, uses exported data in
   shadow mode, and lists the owner's commercial decision first (§4.2).
5. **"Outcome pricing is under 4% of the market."** Rebutted in part. The 3.8% is attributed to instrumentation, which is
   exactly what we would supply. The offer is hybrid anyway: commit plus per verified case, with a fixed-fee pilot.

### 6.2 A sceptical CFO

6. **"If your 'verified' invoice is wrong and we pay twice, who pays?"** Accepted. Version 1 never executes payments, and
   no clawback or guarantee is offered before K6 has been read on real cases (§4.4 rule 7). The first draft offered a
   guarantee from day one.
7. **"How do I know 'verified' is not your grader grading itself, like Zendesk's LLM?"** Accepted. The buyer signs the
   checks, the buyer's staff audit a random sample, and the false-pass rate is reported with an interval. Our own runs
   show self-verdicts lie (C0: 32/32 "pass" with 5 failures), so this is the condition we hold ourselves to as well.
8. **"I can't tell you my cost per exception."** Then you are not the ICP yet. K1 requires a stated cost.
9. **"What happens when the model is deprecated or repriced?"** The workflows are code, and the model calls inside them
   are narrow and swappable: bring your own model, with ids from the policy file and every escalation logged.
10. **"Lock-in: what if you disappear?"** The customer owns its contracts and workflows as typed JSON and code, and can
    self-host.

### 6.3 What changed in revision 1

1. The lead claim moved from "cheap models build reliable workflows" to "a checkable 'done' as the billing meter".
2. Offer B moved from a standalone offer to Offer A's internal engine.
3. The guarantee moved from the launch package to after K6, and became a per-case clawback, not a rate guarantee.
4. The first draft used `abr-fin-apintake` as the AP development bed, which would have burned a held-out family. The
   revision builds E1-lite from public rulebooks instead (§3.3, §4.4 rule 4).
5. K5 (the agent-plus-validator baseline) and K7 (engineer-hours per process) were added.
6. The 90-day plan now starts with the owner's commercial and data decisions (§4.2), which were missing.
7. Self-healing is now described as the least-proven property (§2.3), not as a headline feature.

### 6.4 Critiques rejected

- **"Sell CX resolution: that is where the money is."** Rejected. The market is consolidating at $0.99–2 per outcome
  (§3.4), and customer-silence "done" is accepted there, so our differentiator is not valued.
- **"Raise money and build the platform first."** Rejected. Buyers buy outcomes over toolkits (§2.5), and the platform
  without a process attached is the commodity layer (§2.0).
- **"Price per step, like Zapier."** Rejected. That captures the step tier of the price ladder, where our cost advantage
  is worth fractions of a cent (§2.0).

---

## Appendix A. Spot checks made today (2026-10-15)

| URL | What was checked | Result |
|---|---|---|
| https://www.intercom.com/pricing | Fin price, outcome definition, minimum commitment | matches: "$0.99 per outcome"; includes "don't ask for more help" and "including handoffs"; "e.g. 50 outcomes" |
| https://www.uipath.com/pricing | Self-healing price | matches: "Self-Healing — $5K / 5K heals" (Test Cloud Standard add-on; "Included" in Enterprise) |
| https://support.zendesk.com/hc/en-us/articles/5352026794010 | LLM verification as the billing gate | matches, including "Only conversations that were not escalated are evaluated" |
| https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management | Rates, model independence, 125% enforcement | matches (page updated 2026-10-01). **Correction:** the rates exclude bring-your-own-model setups, which are billed separately (§2.0) |
| https://investor.salesforce.com/news/news-details/2026/Salesforce-Signs-Definitive-Agreement-to-Acquire-Fin/default.aspx | Date, value, customers, closing | matches: June 15, 2026; about $3.6B; more than 30,000 companies; expected close in Q4 of FY27. The reported 2026-09-10 close is still unverified |
| https://www.medius.com/resources/guides-reports/ardent-partners-accounts-payable-metrics-that-matter/ | AP cost and exception rates | matches: $9.90 and $2.67; 19.9% and 11.8%; "nearly 200" respondents |
| https://sierra.ai/blog/outcome-based-pricing-for-ai-agents | Outcome pricing wording and date | matches: December 10, 2024 |
| https://techcrunch.com/2026/06/25/patronus-ai-lands-50m-to-build-digital-worlds-that-stress-test-ai-agents/ | Patronus round | $50M Series B, $70M total, Greenfield Partners; "15-fold" revenue growth (company claim); no pricing |
| https://www.langchain.com/pricing | Seat price and traces | $39 per seat per month, 10K base traces included. The per-1K trace price is not on the page; the third-party figure of $2.50 per 1K is unverified |

Searches with no page opened: Deeptune and Bespoke Labs funding (aggregators only, so tagged [unverified]).

## Appendix B. Files read

`AGENTS.md`, `README.md`, `docs/THESIS.md`, `docs/RESEARCH.md` (the auto-heal and JIT stream rows),
`research/architecture-20261015/{OWNER-DECISIONS,FABLE-WHAT-WE-MISS}.md`, `FIRST-CLASS-PROGRAMS.md` (owner summary,
§0, §4.4, §5, §6.4, §7, §10–12), `research/harness-deconstruct-20261015/SYNTHESIS.md`,
`research/enterprise-20261014/{B1-E8-DEV,CATALOGUE (§0–1),BAR-SET (§0)}.md`, the `AGENTV-E8-PREREG.md` reading rules,
`research/automationbench-20261014/{NOTES.md §1–7, runs/DEV60-A0-A1.md}`, the `RECURRING-DESIGN.md` family rows for
apintake and receipts, `research/jit-20261008/analysis/cusum/REPORT.md` §0, and `git log` (to `d0509cf`). No credential
file, `beds/sealed/` or held-out task was read.
