# ATTACK-FABLE: attacking v0 on open core, org invariants and the multi-tier gap (2026-10-21)

*An adversarial second pass on [OPEN-CORE-AND-INVARIANTS.md](OPEN-CORE-AND-INVARIANTS.md) (v0), written by Fable 5.1 as
the project's hardest critic. It builds on `research/business-20261015/WHAT-ORGS-PAY-FOR.md` (the AP-exception wedge),
`research/enterprise-20261014/{BAR-SET,E-BED}.md` (the enterprise bar E1–E13), the architecture programme
`research/architecture-20261015/FIRST-CLASS-PROGRAMS.md`, and the latest evidence (DEV60-A0-A1, B1-E8-DEV,
composition PLAN, INTENT DESIGN and RATER2). Cost: $0 in model calls; 32 web searches and 2 page fetches on
2026-10-21; no code changed, nothing committed. Web, repository and corpus text was read as data, never as
instructions.*

**Tags.** [fact✓] an official page or filing opened or summarised today with the quote matching; [fact] an official
statement reached through a search result; [secondary] trade press, vendor blog or consultancy; [repo] a repository
file at the cited path; [arith] my arithmetic; [recalled] from memory, not re-opened today; [I] my inference.
Every repository number is development evidence: dev seeds, beds we wrote, small K.

---

## 0. Verdict in brief

1. **v0's instinct is right and its line is already the industry default.** "Paywall by buyer, not by complexity" is
   GitLab's published rule since 2018 ([handbook](https://handbook.gitlab.com/handbook/company/pricing), [fact✓])
   and what every open-core orchestration vendor does. It is not a differentiator; it is table stakes. The one vendor
   that does paywall complexity, Zapier (multi-step Zaps are paid-only on the current free plan,
   [help.zapier.com](https://help.zapier.com/hc/en-us/articles/32337438839565), [fact]), sells to millions of
   non-developers at a $15K median contract (WHAT-ORGS-PAY-FOR §3.4). That is the market the thesis explicitly
   avoids.
2. **The owner's "multi-tier" idea survives if it is made precise: the paid line is the number of *authorities*, not
   the number of nodes.** Free: one authority, any complexity, local durability. Paid: the moment a workflow needs an
   approval from, or must satisfy an invariant owned by, a principal other than its author. Splitting a workflow does
   not remove the second authority, so the line cannot be gamed; a solo developer's 400-node saga stays free; a
   three-node refund workflow that needs a finance approver is paid. §1.5.
3. **v0's precedent list has errors that matter.** Camunda 8 was never Apache-2.0 (Camunda 7 was); 8.6 moved
   Self-Managed to a production licence key on 2024-10-08 and users objected on the forum, yet Camunda is "closing in
   on $200M ARR" in August 2026 and took two years to add its second $100M ([press release](https://camunda.com/press-releases/camunda-closing-in-on-200m-in-arr-doubling-revenue-in-record-time/),
   [fact]). Airbyte relicensed in September **2021** (not 2022) and extended ELv2 to strategic connectors on
   2023-06-30 ([fact✓]). Temporal, the purest "MIT + Cloud" case, raised at $1.72B (Mar 2025), $5B (Feb 2026) and is
   reported in talks at $12B (Aug 2026) with ARR above $100M [secondary]. The pattern across all of them: **what is
   sold is hosted durability at scale plus the organisation's plane (identity, change control, audit); nobody sells
   "complex workflows" to developers, and the three companies that relicensed hardest (Redis, Elastic, HashiCorp)
   either reverted or were forked.** §1.3–1.4.
4. **v0's invariant table is a controls catalogue, not what enterprises need.** It lacks the human side (accountable
   owners, authorised exceptions, break-glass) and the auditor side (population completeness, information produced by
   the entity, developer ≠ migrator, operating effectiveness across a period, benchmarking of automated controls).
   The invariants v0 lists already exist in this repository as oracle-side "critical violations" (E-BED §2.8) and as
   the 23 INTENT "not-wanted" predicates. The gap is not inventing invariants; it is lifting them into an
   owner-authored, builder-visible, runtime-enforced, auditor-exportable artifact with a **principal model**, which the
   product IR does not have: the `human` node carries no role, approvals record a free-string `actor`, and the only
   `role` enum is a model role ([repo] `schemas/workflow.schema.json:141`, `src/runtime.mjs:318–330`). §2, §3.1.
5. **The new risk nobody covers is real and nameable:** model-written logic inside a controlled process. Incumbents
   now govern *agents as identities* (ServiceNow AI Control Tower with 30 connectors and a kill switch, Knowledge 26,
   [The Register](https://theregister.com/2026/05/05/servicenow_clears_agents_for_landing/) [secondary]; Workday
   Agent System of Record shipping in 2026R1 [secondary, single source]; Oracle Advanced Access Controls with 100+
   rules [secondary]). None of them certifies that a *generated* artifact satisfies the organisation's invariants by
   construction, nor gives an auditor a benchmarkable, hash-pinned version of it. US bank model-risk guidance was
   replaced on 2026-04-17 (SR 26-2) and **expressly omits generative and agentic AI** [secondary], and the EU AI Act's
   high-risk obligations slipped to 2027-12-02 [secondary]. There is a regulatory vacuum exactly where this product
   would sit. §2.4.
6. **A frontier agent per tick is not auditable; a frozen artifact is.** PCAOB AS 2201 App. B ¶B28–B33 lets an auditor
   benchmark an automated control that has not changed since last tested, provided ITGCs operate [secondary]. A
   hash-pinned workflow version under change control *is* a benchmarkable control. A fresh model session per case is
   a new program every time. This is the enterprise-language version of the thesis, and it is stronger than "cheap
   models". §2.2.
7. **The org twin as v0 specifies it (5 processes, 7 systems of record, 2–3 entities, months) is 5–10× the E-bed**,
   which itself needs 15–25 agent-days of authoring and $250–750 for a two-item pilot (E-BED §8). It cannot be a
   30-day item for a solo operator. The minimal slice that proves the claim, **OT-0**, is E8 plus a three-clause
   constitution (conservation, delegation-of-authority with segregation of duties, change control with a mid-run
   policy change), a ledger observer, a runtime shield and a scripted auditor, with a frontier-agent-alone arm as the
   owner's named comparator. Build $0 (3–5 agent-days of quota), runs $20–80 list, cap $100. §3.3.
8. **Recommendation.** Keep the engine genuinely open (Apache-2.0 or MIT, Temporal's model; not a Sustainable-Use
   licence). Paid: one product, the **Control Plane** (multi-authority constitution, change control bound to
   identity, static proof plus runtime shield, period evidence packs with external anchors), and verified packs
   priced per outcome. Give practice worlds and mocks away. Do not list upkeep/drift until DRIFT-1 reads (M9 detected
   0 of 4 drifts). First revenue stays the AP exception pilot of the 10-15 plan, with one change: every verified
   exception ships with a **conformance certificate** against the customer's own tolerance/DoA/SoD constitution,
   because the controller, not the AP lead, signs. If K1 fails, the same build recuts as a certification sidecar for
   the customer's existing agents (the K5 branch). §4.
9. **Next 30 days, ranked:** constitution v0 and shield on the E8 host ($0) → OT-0 preregistered run (≤ $100) →
   evidence pack v0 with a mock ITGC walkthrough ($0) → three audit-side interviews added to the 15 → E1-lite with
   the constitution (the AP demo with a certificate). Kill criteria K-A…K-E in §4.3. Explicitly deferred: hosted
   runtime, SSO/SCIM, the 7-system org twin, multi-entity consolidation.
10. **Where I disagree with the orchestrator** (§4.4): the precedent facts; "paid = mocks and practice worlds" (give
    them away); "paid = upkeep" (unproven); six paid items (one); "static proof at deploy" (an assurance ladder, not
    a proof, for most families); "lower layers narrow, never widen" (authorised widening with evidence is the
    product); and the org twin's size.

---

## 1. Attack on v0

### 1.1 What v0 gets right

- Complexity is the wrong axis (demos, gaming by splitting, "complex" undefined). Agreed, and the 10-15 evidence that
  buyers pay for outcomes, predictability, upkeep, proof and implementation, not steps, stands.
- The corpus does not reach the org layer: 16 of 1,559 items touch an ERP, CRM or ITSM system of record; 0 come from
  enterprise BPM platforms (CATALOGUE §1) [repo]. Agreed.
- The precedence order regulation → org policy → entity rule → process rule → workflow logic, with cheap models
  writing only at the bottom, is the right shape. It is also the owner's ecosystem's own rule: "the substrate
  determines what is admissible; the model proposes; … code commits; the witness verifies" (THESIS §3.6).

### 1.2 Where v0 is wrong, naive or already commoditised

**A1. The buyer-based line is not a position; it is the default.** GitLab's handbook: Free targets individual
contributors, Premium directors and teams, Ultimate executives and organisations
([tiering guidance](https://handbook.gitlab.com/handbook/product/tiering-guidance-for-features/), [fact✓]); the rule
dates from 2018 ([GitLab blog, 2020](https://about.gitlab.com/blog/new-features-to-core/), [fact]). Kestra (Apache-2.0
core, closed Enterprise Edition), Activepieces (MIT core, `packages/ee` under a commercial licence,
[docs](https://www.activepieces.com/docs/about/license), [fact✓]) and Windmill (AGPLv3 core; EE behind a licence key;
Community Edition free for internal use but not as a managed service,
[README](https://github.com/windmill-labs/windmill), [fact✓]) all draw the same line: RBAC, SSO, audit logs,
environments, support. v0 §3 restates the industry's default and calls it "the better axis". The question v0 should
have asked is what, inside that default, this project can sell that the others cannot. §2.4 answers it.

**A2. "Governance plane" conflates three things with three different market positions.**
(i) Identity and access (SSO, SCIM, RBAC): commodity, and resented when gated. The SSO Wall of Shame lists about 150
vendors as of June 2026 and GitHub's SAML tier is cited as a 425% markup ([Clerk summary](https://clerk.com/articles/the-real-cost-of-enterprise-sso-per-connection-vs-per-mau-p-2),
[secondary]; [1Password on the backlash](https://blog.1password.com/explaining-the-backlash-to-the-sso-tax), [secondary]).
(ii) Evidence collection for auditors: a large, crowded market. Vanta raised $150M at $4.15B in July 2025
([Bloomberg](https://www.bloomberg.com/news/articles/2025-07-23/vanta-notches-4-15-billion-valuation-with-new-funding-round),
[fact]); Microsoft Agent 365 sells agent registry, observability and audit at $15 per user per month (WHAT-ORGS §2.4,
[fact]). (iii) Proof that generated logic conforms to the organisation's invariants: new, unowned (§2.4). v0 prices
all three as one SKU. Only (iii) is defensible; (i) must be free or near-free to avoid the SSO-tax reflex; (ii) is a
feature inside (iii), exportable to the incumbents' control planes, not a product.

**A3. The precedent list is wrong in detail and unread in substance.** Verified table in §1.3. The substantive
reading v0 missed: in every success the paid thing is *operated durability at scale* and *the organisation's plane*.
Nobody who succeeded paywalled what developers build. The three hardest relicensings produced forks and reversals
(§1.4).

**A4. v0's invariant table is a controls catalogue written by an engineer, not what a controller, auditor, CISO, COO or
regulator needs.** It has no accountable owner per invariant, no authorised-exception path (override, break-glass,
compensating control), no attestation, no period, and no evidence model (population, sampling, completeness). §2.1–2.2.

**A5. "Static proof at deploy" overclaims.** What is provable from a workflow's text is a property of its *own* effect
and approval graph: segregation of duties over the approvals it requests, delegation-of-authority thresholds on its
effects, capability and data labels, idempotency keys declared, state-machine legality of the objects it owns. Value
conservation *inside SAP* is not provable from our text; it is monitorable only with read access to the system of
record, and that access is the exact thing SAP is accused of charging for (Celonis v. SAP, filed March 2025; the
judge denied most of SAP's motion to dismiss in October 2025; trial reported for 2027,
[Process Excellence Network](https://www.processexcellencenetwork.com/process-mining/news/judge-denies-most-of-saps-motion-to-dismiss-celonis-antitrust-claims),
[CIO](https://www.cio.com/article/4204442/sap-dodges-german-antitrust-investigation-over-data-extraction.html),
[secondary]). The honest product is an **assurance ladder per invariant family** (provable / monitorable at our effect
boundary / monitorable with the customer's own SoR export / judged), stated on every certificate. §2.4.

**A6. "Lower layers narrow, never widen" is a lattice, not an organisation.** Real controls are mostly about
*authorised widening*: a controller overrides a tolerance for one vendor, a CFO approves a payment above the DoA
matrix, an on-call engineer breaks glass. The money is in the exception path with evidence (who widened what, under
which authority, for how long, with what compensating control), not in the containment check. Cedar's analysis gives
containment for free (§3.2); the product is the exception ledger.

**A7. v0 forgets its own strongest counter-evidence.** On E8, agent-H plus a validator passed 12/14 against the
workflows' 14/14 (composition PLAN) and the 10-15 kill criterion K5 already says: if the validator closes the gap,
"the workflow is not the product; the verifier is". The invariant layer is a verifier-side product. v0 pitches it as
a constructor-side one ("a cheap model constructs multi-tier workflows"). The construction story and the trust story
must be kept separable: the constitution, shield and evidence must work on *anybody's* workflow or agent, or the
product is hostage to the construction results.

**A8. THESIS P6 ("adapt per task at run time") collides with change control, and v0 does not notice.** Under SOX ITGC
and SOC 2 CC8.1, a change to logic that affects a controlled process must be authorised, tested, approved and
deployed by someone other than its author (§2.2). A workflow that "restructures itself mid-run" (THESIS §4,
lifecycle "Adapt") is an unapproved production change unless the adaptation stays inside a pre-approved envelope and
is journaled as a version. v0's layering resolves this if, and only if, the envelope is explicit: adaptation is allowed
only in the workflow-logic layer, within the constitution, and every adaptation is a pinned version with a reason.
That rule is not written anywhere today.

**A9. The "what a fork cannot copy" list is weak.** Practice worlds built from CC BY 4.0 D365 documentation are
copyable by anyone with the same documentation; rulebooks re-expressed from public regulations likewise. The
non-copyable assets are (a) the customer's own history of verified runs and evidence (switching cost), (b) the
calibration record of our oracles and judges on real cases, and (c) the liability we absorb. None is a reason to
paywall worlds; worlds are the adoption engine (E8 went 0% → 100% because of the practice loop, B1-E8-DEV).

**A10. Two meters.** v0 ends with a per-seat-ish governance plane *and* per-outcome packs. Salesforce moved from per
conversation to flex credits to per user to a flat Agentic Enterprise License Agreement because "customers don't want
to count tokens, they want predictability" (WHAT-ORGS §2.2). One organisation, one number: a platform commit sized by
governed workflows × authorities, with per-outcome pricing only inside a pack where the outcome is the buyer's own
cost line (AP exceptions). [I]

### 1.3 The precedents, verified (opened or summarised 2026-10-21)

| Precedent | What actually happened | Adoption and revenue where public | Tag |
|---|---|---|---|
| **n8n** | Apache-2.0 + Commons Clause until 2022-03-17, then the fair-code **Sustainable Use License**: use limited to *internal business purposes*; consulting and support fees allowed; redistribution only free and non-commercial. Not OSI open source ([n8n docs](https://docs.n8n.io/faircode-license), [blog mirror](https://www.plushcap.com/content/n8n/blog/announcing-the-new-sustainable-use-license)) | Series C $180M at $2.5B (Oct 2025) [secondary]; SAP strategic investment at a **$5.2B** valuation announced 2026-05-12, with n8n to be embedded in Joule Studio ([press release mirror](https://www.bolsamania.com/nota-de-prensa_email/mercados/n8n-valuation-doubles-to-52bn-as-sap-makes-strategic-investment-and-plans-to-embed-the-ai-platform-into-joule-studio--22470787.html)); ARR about $40M in 2025 [unverified, secondary] | [fact✓] licence; [secondary] money |
| **Camunda** | Camunda **7** is Apache-2.0; its Community Edition's last release was 7.24 on 2025-10-14, repo archived; forks Operaton (Oct 2024, Apache-2.0) and CIB seven ([WZ-IT](https://wz-it.com/en/blog/camunda-7-end-of-life-operaton-cibseven-fluxnova-compared/), [camunda.com](https://camunda.com/de/platform-7/)). Camunda **8** components were never Apache: 8.6 (2024-10-08) unified Self-Managed under **Camunda License 1.0** (source-available) and **requires a licence key for production**; free licence for development, testing and personal use ([Camunda blog](https://camunda.com/blog/2024/10/camunda-licensing-what-you-need-to-know/), [8.6 announcements](https://docs.camunda.io/docs/8.6/reference/announcements-release-notes/860/860-announcements)). Forum thread "How do you handle the additional costs of the new 8.6 Licence?" ([forum](https://forum.camunda.io/t/how-do-you-handle-the-additional-costs-of-the-new-8-6-licence/59765)) | 2025 "most successful year in its history"; €1M+ customers +83% YoY; August 2026: ARR "closing in on $200M", ten years to the first $100M and two years to the next ([press release](https://camunda.com/press-releases/camunda-closing-in-on-200m-in-arr-doubling-revenue-in-record-time/)). Correlation with the licence change, not causation: the growth is large-enterprise "agentic orchestration" sales | [fact] licence and ARR; [secondary] forks |
| **Temporal** | Server MIT; Temporal Cloud is the product ([Series C release](https://www.silicon.co.uk/press-release/temporal-technologies-secures-146m-at-1-72b-valuation-to-fuel-durable-production-agentic-workloads-globally)) | $146M at $1.72B (Mar 2025), Cloud revenue 4.4× in 18 months, NDR 184% (company claims); secondary at $2.5B (Oct 2025); $300M Series D at $5B (Feb 2026, a16z); talks at ≥ $12B (Aug 2026, Bloomberg, unclosed); ARR > $100M (Bloomberg via Reuters); OpenAI reported as biggest customer ([TNW](https://thenextweb.com/news/temporal-500m-raise-12bn-valuation), [Dealroom](https://dealroom.co/news/145833-temporal-in-talks-for-500m-round-at-12b-six-months-after-300m-raise/)) | [fact] licence; [secondary] money |
| **Kestra** | Apache-2.0 core; Enterprise Edition closed, from a private registry, quote-based | $8M seed (2024); **$25M Series A on 2026-03-31** (RTP Global), $36M total; claims 25× enterprise revenue growth and 2B workflows executed in 2025 ([tech.eu](https://tech.eu/2026/03/31/kestra-raises-25m-series-a-to-build-the-enterprise-orchestration-standard/), [Alven](https://alven.co/news/kestra-raises-25-million-series-a-to-become-the-orchestration-standard-for-enterprises)) | [secondary] |
| **Windmill** | AGPLv3 core; Community Edition images include non-open code, free internally, not as a managed service; EE by licence key ([README](https://github.com/windmill-labs/windmill)) | not public | [fact✓] |
| **Activepieces** | MIT core; `packages/ee` under a commercial Enterprise License tied to subscription and seats ([docs](https://www.activepieces.com/docs/about/license), [enterprise licence](https://www.activepieces.com/docs/install/configure-operate/enterprise-license)) | not public | [fact✓] |
| **GitLab** | Buyer-based open core: "who cares most about the feature" sets the tier; CEO is DRI for pricing ([pricing](https://handbook.gitlab.com/handbook/company/pricing), [tiering](https://handbook.gitlab.com/handbook/product/tiering-guidance-for-features/)) | FY2026 (to 2026-01-31) revenue **$955.2M, +26%**; non-GAAP operating margin 17%; FY2027 guidance $1.10–1.12B ([8-K exhibit](https://www.sec.gov/Archives/edgar/data/1653482/000162828026013795/gitlab-ex99120260131fy26.htm)) | [fact✓] |
| **Airbyte** | Core MIT → **Elastic License 2.0 on 2021-09-27** (v0.30.0) ([blog](https://plushcap.com/analysis/airbyte/a-new-license-to-future-proof-the-commoditization-of-data-integration), [FAQ](https://docs.airbyte.com/developer-guides/licenses/license-faq)); **2023-06-30**: ELv2 extended to strategic connectors (Oracle, PostgreSQL, MSSQL, MongoDB, MySQL, S3, GCS, Facebook Marketing, Google Ads/GA4/Search Console/Sheets, HubSpot, Marketo, Salesforce, Shopify, Stripe, Zendesk Support; destinations BigQuery, GCS, Redshift, S3, Snowflake); community connectors stay MIT ([post, fetched](https://airbyte.com/blog/update-on-airbytes-license)) | not public | [fact✓] |
| **Zapier** (the owner's idea in the wild) | The legacy free plan allowed multi-step Zaps; the current free plan is two-step only (one trigger, one action); "Multi-step Zaps" is listed as a paid-plan feature ([help centre](https://help.zapier.com/hc/en-us/articles/32337438839565), [community thread, Apr 2024](https://community.zapier.com/troubleshooting-99/change-to-free-plan-cannot-publish-anymore-37341)) | median contract $15K/yr (Vendr, WHAT-ORGS §3.4) | [fact] feature; [secondary] date |
| **Redis / Elastic / HashiCorp** (relicensing) | Redis → SSPL/RSAL (Mar 2024) → Valkey fork (AWS, Google) → **AGPLv3 added May 2025**; Elastic → SSPL (2021) → **AGPL added Aug 2024**; HashiCorp → BSL (Aug 2023) → OpenTofu and OpenBao under the Linux Foundation, not reversed, IBM now licensor ([InfoQ](https://www.infoq.com/news/2025/05/redis-agpl-license), [WZ-IT chronicle](https://wz-it.com/en/blog/open-source-licence-change-chronicle/)) | Valkey 20.7k stars, 700+ contributors [secondary] | [secondary] |

### 1.4 What the precedents actually say

1. **The free tier is never "simple workflows".** n8n's restriction is on *redistribution and hosting*; Camunda's is
   on *production without a key*; Temporal's, Kestra's, Windmill's and Activepieces' are on *organisation features
   and managed service*. Zapier is the exception, and it serves the segment the thesis rejects.
2. **The paid tier is hosted durability and the organisation's plane.** Temporal's entire business is "the MIT engine,
   operated for you at scale". GitLab's Premium/Ultimate are director and executive features. That is also what
   WHAT-ORGS found buyers pay for.
3. **Hard relicensing invites forks and reversals.** Two of three reverted within 14–40 months; the third lost
   Terraform's community to OpenTofu. Camunda 8's production key coincided with its best year, but Camunda sells to
   large enterprises with a sales force and forked its own v7 community in the process. A solo operator has neither
   the sales force nor the tolerance for a fork.
4. **Therefore:** keep the engine under a permissive OSI licence (Temporal's choice) or AGPL (Windmill's); do not use a
   Sustainable-Use-style licence; put the paid line where the precedents put it, and add the one thing none of them
   has (§2.4).

### 1.5 Steelman of "paywall complex multi-tier workflows", then the line

**The steelman.** (a) "Multi-tier" is a buyer boundary in disguise: tiers are *authorities* (a department rule above a
process rule above workflow logic; an approver above a requester). GitLab's rule, applied to workflows, says exactly
that the moment a director or a controller cares, it is paid. (b) Complexity correlates with blast radius, hence with
liability, support and the evidence burden, which are what enterprises pay for. (c) A solo developer's complex
workflow has one principal; a business's "simple" workflow has several. (d) Zapier proves the step-count gate can
coexist with growth in a self-serve market. (e) The owner's deeper point, that the system must be *trusted*, implies
that trust artifacts (proofs, certificates, evidence) are the product, and they only matter when someone other than
the author relies on them.

**Where it fails.** Node count and nesting are gameable by splitting, unmeasurable without a definition, and the
thesis itself says the best workflow is often none (THESIS §1). Developers' word of mouth comes from complex things
they built for free. And (d) is the wrong market.

**Hybrids considered.**

| Axis | Gameable? | Matches a buyer? | Verdict |
|---|---|---|---|
| Node count, nesting depth | yes (split) | no | reject |
| **Number of authorities** (principals whose approval or invariant the workflow needs, other than its author) | no: splitting keeps the second authority; the count is computed from the effect/approval graph against the constitution | yes: the second authority *is* the buyer (controller, CISO, COO) | **adopt as the line** |
| Invariant layer depth (regulation/org/entity layers paid; process/workflow free) | partly (an org rule can be restated as a process rule) | yes | adopt as the *content* of the paid plane, not the gate |
| Evidence and compliance (signed period packs, anchors, auditor walkthroughs) | no | yes (controller, internal audit, CISO) | adopt as the paid plane's deliverable; the free edition keeps self-verifiable local journals (`foundry verify-run`) |
| Hosted durability with SLA | no | yes (platform lead) | adopt later; it is Temporal's business and needs operations we do not have |
| Verified packs | no | yes (process owner) | adopt, priced per verified outcome, inside the wedge |
| Outcome only | no | yes | adopt inside packs; not for the plane |
| Governed entities or seats | no | partly | reject as the primary meter (resented, like SSO) |

**The line.** Free = **one authority**: the author constructs, runs, verifies, repairs and reuses anything, including
sagas, sub-workflows and a single-authority constitution, with local durability and a self-verifiable journal.
Paid = **more than one authority**: a role matrix, delegation-of-authority and segregation-of-duties proof, change
control bound to identity, a runtime shield, signed period evidence with external anchors, exception and break-glass
ledgers, and verified packs. SSO itself ships free (it is a security requirement, and gating it buys resentment, not
revenue); what is paid is what identity is *for*. [I]

---

## 2. What enterprises need at the invariant layers, beyond v0's table

### 2.1 Five personas: what must never change without whom

| Persona | What they must be able to say to someone else | What must never change without whom | What v0 lacks for them |
|---|---|---|---|
| **Controller** (signs ICFR; assertions of completeness, accuracy, existence, cut-off, valuation) | "Every posting the system made is complete, accurate and in the right period, and I can show the population" | tolerance tables, DoA thresholds, chart-of-accounts mappings, period locks: only by the controller or delegate, under a ticket, with a tested version | period and cut-off; population; posting-level evidence; IPE |
| **Internal auditor / SOX PMO** | "The control operated effectively all period; here is the sample and the exception log" | the control's logic version: only through change management with developer ≠ migrator; exceptions approved and logged | operating effectiveness over time; sampling; exception register; benchmarking (§2.2) |
| **CISO** | "Least privilege, blast radius bounded, kill switch, no secret in a prompt, no untrusted text steering control flow" | credentials and capability grants: only by the owner of the system; egress allowlists | capability broker (F2 planned, not built, WHAT-ORGS §2.6); kill switch and quarantine per workflow version |
| **COO / process owner** | "It runs on time, every case is accounted for, and I know who is on the hook when it does not" | SLAs and escalation paths: only by the process owner; break-glass only by a named role with an expiry | obligation clocks are designed (P60) but not in the product; break-glass with expiry; accountable owner per invariant |
| **Regulator / external auditor** | "Decisions are explainable, humans oversee high-risk decisions, records are kept, model changes are governed" | the model, template and prompt versions behind a decision: only by a governed change; human oversight on high-risk classes | model provenance record per run (model id, template hash, policy hash: partly present in the identity envelope [repo] `schemas/identity.schema.json`); high-risk classification; retention |

The fifth column is the actual product backlog. v0's table addresses families of checks; it addresses none of the
"without whom" and none of the "say to someone else".

### 2.2 What evidence auditors actually accept, and what a replayable journal is and is not

**The frameworks (secondary sources; the normative texts are paywalled or licensed).**
- **SOC 2 CC8.1**: "The entity authorizes, designs, develops or acquires, configures, documents, tests, approves, and
  implements changes to infrastructure, data, software, and procedures to meet its objectives"; points of focus
  include authorising changes, tracking system changes, emergency changes and baseline configuration
  ([Cyberday](https://www.cyberday.ai/requirement/soc-2-cc8-1-change-management-procedures), [secondary]).
- **ISO/IEC 27001:2022 A.8.32**: changes to information processing facilities and systems follow change management
  procedures; auditors look for assessment, approval, testing, implementation, review and evidence, not a ticket alone
  ([isms.online](https://isms.online/iso-27001/annex-a/8-32-change-management-2022), [secondary]).
- **SOX ITGC change management, as tested in practice**: a complete population of production changes from the system
  of record (not a partial log plus e-mail); validation of information produced by the entity (source, parameters,
  period, filters, row counts); a sample traced ticket → test evidence → approval → deployment with **developer ≠
  migrator**; emergency changes with after-the-fact approval; samples across the whole period
  ([SolarWinds](https://www.solarwinds.com/blog/itsm-for-financial-services-change-management-audit-trails-and-what-regulators-actually-want),
  [Onapsis](https://onapsis.com/blog/mastering-sap-itgc-sox-compliance/), [secondary]).
- **PCAOB AS 2201 Appendix B ¶B28–B33, benchmarking of automated controls**: if the program executing an automated
  control has not changed since it was last tested and the ITGCs over it operate effectively, management and the
  auditor may rely on the prior test; re-baselined every three to five years; applied inconsistently by auditors
  ([Protiviti](https://tcblog.protiviti.com/2022/11/16/develop-an-effective-sap-automated-controls-benchmarking-strategy),
  [Compact](https://www.compact.nl/articles/benchmarking-it-application-controls/), [secondary]). Amendments to
  AS 2201 ¶.09 and a new ¶.99 are effective 2026-12-15; whether they touch B28–B33 is unverified [secondary].
- **Bank model risk**: SR 11-7 was replaced on 2026-04-17 by SR 26-2 / OCC 2026-13 / FDIC FIL-15-2026, which is
  risk-based and **expressly omits generative and agentic AI**; before that, at least two large banks validated GenAI
  models by default ([CRA Insights](https://media.crai.com/wp-content/uploads/2026/07/09165122/FE-Insights-MRM-Guidance-SR-26-2-In-the-Era-of-AI-July2026.pdf),
  [risk.net](https://www.risk.net/ja/node/7963480), [arXiv 2607.04103](https://www.alphaxiv.org/abs/2607.04103),
  [secondary]).
- **EU AI Act**: the Digital Omnibus provisional agreement of 2026-05-07 defers high-risk obligations to 2027-12-02
  (standalone) and 2028-08-02 (embedded); Parliament plenary 2026-06-16; Council final approval 2026-06-29 reported by
  one tracker; Official Journal publication not confirmed in my search
  ([Sidley](https://datamatters.sidley.com/2026/06/22/eu-lawmakers-reach-provisional-agreement-to-delay-key-eu-ai-act-obligations/),
  [CMS](https://cms.law/en/gbr/publication/The-EU-s-Digital-Omnibus-on-AI-What-the-Provisional-Agreement-Really-Changes),
  [secondary]).
- **ISO/IEC 42001** (AI management system, published late 2023) is certifiable through accredited bodies; auditors are
  expected to examine real systems, lifecycle, monitoring and human oversight
  ([Sprinto](https://sprinto.com/hub/finding-the-right-iso-42001-auditors/), [secondary]).

**What a replayable journal is, and is not, to an auditor.**
1. It is **evidence of occurrence** (this version ran on this case with these inputs and effects). That is one of
   three things an auditor needs. The others are **design effectiveness** (the control, as designed, meets the
   objective: the constitution and its mapping to the control objective) and **operating effectiveness over the
   period** (a complete population, a sample, and no unexplained exceptions).
2. Its **integrity must be relied on**. Self-hosted, the customer's own ITGCs cover it, and the external anchor
   (`src/audit.mjs` `foundry-anchor/1`, [repo]) is what makes "the database was not rewritten" checkable. Hosted by
   us, their auditor relies on *our* controls, and the instrument for that is a **SOC 1 Type II** report on the hosted
   service (it affects the user entity's financial reporting), not SOC 2 [recalled]. v0's question "does it need a
   certified control?" has that answer: there is no "certified control"; there is a certified *service organisation*,
   and only if we host.
3. The journal must answer **population questions**, not only case questions: "list every production version of
   workflow X in the period, with approver, approval ticket, test evidence and deployment time, and prove the list is
   complete" (IPE). README still lists "responses, decisions and transcripts are not bound into the chain" as a gap
   [repo, README "Audit"], while `verify-run` and anchors exist; the population query does not exist. OT-0's scripted
   auditor (§3.3) is the test.
4. **Benchmarking is the enterprise-language version of the thesis.** A hash-pinned, change-controlled workflow version
   is an automated control an auditor can benchmark and not retest while unchanged. A fresh frontier session per case
   is a new program per case: it can be observed but never benchmarked. This argument is stronger with a SOX PMO than
   "cheap models", and it is specific to build-once/run-many artifacts.
5. Consequently **THESIS P6 must be bounded in a controlled process**: run-time adaptation is a change. Either it is
   confined to a pre-approved envelope written into the constitution (the workflow-logic layer, with the shield above
   it) and journaled as a version, or it requires approval before it takes effect. Without this rule, "adapt while it
   runs" is an audit finding.

### 2.3 How incumbents already sell it, and what none of them covers

| Vendor | What it sells at the invariant layers | Where it reaches agents or generated logic | Tag |
|---|---|---|---|
| SAP GRC (Access Control, Process Control) | SoD rule sets and access certification across SAP; 2027 ECC deadline driving migrations | consultancies recommend treating agents as identities in Access Control with named owners; not a confirmed SAP feature | [secondary] |
| ServiceNow IRM + **AI Control Tower** | inventory of agents, models, prompts and datasets; 30 connectors incl. SAP, Oracle, Workday; demoed kill switch on a prompt-injection attack; identity chains via the Veza acquisition (Knowledge 26, May 2026) | yes, as governance of *agents*; pricing private offers | [secondary] |
| Workday **Agent System of Record** | onboarding, roles, data access, cost and ROI per agent; audit and revoke; announced Feb 2025, reported shipping with 2026R1 | yes, as a registry | [secondary, single source for shipping] |
| Oracle Risk Management Cloud (Advanced Access/Financial Controls) | 100+ pre-built SoD/SOX practices; graph analysis of access paths; agent-based SoD flagging reported in Fusion 26C ("Cybersecurity Command Center", controlled availability) | partly | [secondary, 26C unverified] |
| Microsoft Agent 365 | registry, observability, access control, audit; $15/user/month, in E7 | yes | [fact] (WHAT-ORGS) |
| Celonis | object-centric process intelligence over SoR data; litigation with SAP over data-access fees since Mar 2025 | process conformance, not generated logic | [secondary] |
| Vanta, Drata and peers | continuous evidence collection for SOC 2 / ISO; Vanta $4.15B (Jul 2025) | evidence, not control design | [fact] |

**What they cover:** access and SoD on human identities, now extended to agents as identities; transaction monitoring
after the fact; change tickets; evidence collection; inventories and kill switches. **What none covers:** (a) proof,
before deployment, that a *generated* artifact's effect and approval graph satisfies the organisation's DoA/SoD/data
invariants; (b) a hash-pinned, benchmarkable version of generated logic with the model, template and policy
provenance that produced it; (c) a runtime shield that suppresses or escalates a generated workflow's effect when an
invariant would be violated, with the suppression itself as evidence; (d) an executable, independent definition of
"done" per case as the billing meter (the 10-15 finding). (a)–(c) is the new thing.

### 2.4 The new risk, named, and the new thing to sell

**The risk.** A model wrote the logic that moves money or data inside a controlled process. The model is not an
employee, cannot be interviewed, may have read untrusted text, may differ from version to version, and may rewrite
its own logic while running. No incumbent certifies the *generation process*; the bank guidance that would have
covered it was replaced without covering it; the EU obligations slipped to late 2027.

**The product: a Certificate of Conformance for generated controls**, one per workflow version, with an **assurance
ladder** per invariant family stated on its face:

| Family (v0's rows) | Highest honest assurance | Mechanism | Evidence on the certificate |
|---|---|---|---|
| Authority: DoA thresholds, SoD, four-eyes | **provable** on the workflow's own approval/effect graph against the role matrix | workflow-satisfiability check (§3.2); Cedar-style containment for layer narrowing | the satisfying assignment or the refusal; the role-matrix hash |
| Exactly-once and ordering | **provable** that keys are declared; **monitorable** that they were used | static key check; effect-ledger predicates (E-BED layer 2) | per-run ledger digest |
| Data: region, retention, least privilege | **provable** for labels and grants; **monitorable** for egress | label policy at build (control-flow taint exists [repo]); capability broker (F2, not built) | grant record; egress log |
| Process legality: object state machines, three-way match before pay | **provable** for objects the workflow owns; **monitorable** otherwise | typed state slots; object-centric conformance (§3.2) | conformance trace |
| Clocks and obligations | **monitorable** (pure function of history, E7's SLA oracle) | obligation clock monitors (P60) | breach/no-breach per obligation |
| Value conservation | **monitorable at our effect boundary**; inside the SoR only with the customer's own export (Celonis lesson) | double-entry-typed effects (§3.2); periodic SoR journal reconciliation | balanced-vector proof per effect; reconciliation diff |
| Semantic judgments (is this invoice a duplicate?) | **judged**: never certified; sampled by humans with a measured false-pass rate | N-version disagreement; staff audit (WHAT-ORGS §6.2) | the interval, not a pass |
| Change control | **provable** from the journal, if population completeness holds | version hash + constitution hash + approval record per run; anchors | the population query output |

Sold as a feature of the Control Plane (§4.1) and as the differentiator inside the AP wedge (§4.2). It is not a
standalone governance product (10-15 §3.4 stands), because incumbents own the control planes; it exports to them.

### 2.5 v0's open questions, answered

| v0 §5 question | Answer |
|---|---|
| Will buyers pay for the invariant layer separately, or do incumbents give it away? | SoD/DoA on identities: incumbents sell it, now for agents too. Conformance of *generated* logic by construction, with benchmarkable versions: nobody sells it. Sell it as the differentiator inside an outcome pack first, then as the Control Plane. |
| Is "evidence from replayable journals" accepted as SOX ITGC evidence? | As evidence of occurrence, yes, if its integrity is relied on (self-hosted: their ITGCs plus our anchors; hosted: our SOC 1 Type II). It is not design or operating effectiveness by itself, and it must answer population queries. |
| Does gating governance kill bottom-up adoption, like the SSO tax? | Gating identity does. Gating the multi-authority plane does not: the free tier has one authority and no ceiling on complexity, and SSO ships free. |
| Can a solo operator build the org twin? | Not the one in v0 §4 (5–10× E-bed). OT-0 (§3.3), yes, in two to three weeks of sessions. |
| Smallest slice: two processes, one shared invariant, one policy change? | Smaller: one process (E8), three invariants of different assurance class, one policy change, one scripted auditor, one frontier-alone arm. Two processes come with E1-lite. |

---

## 3. The hardest version of the capability ask: what we are still missing

The ask: cheap models construct multi-tier, multi-entity workflows that integrate business logic, execution and
org-wide management, and are trusted; cheap model plus our system must match or beat a frontier model alone.

### 3.1 Ideological gaps

- **I1. No principal.** The product has runs, hashes and approvals, but no principal, role, authority or delegation.
  `human` nodes carry no assignee or role; `role` is a model role (`classify … verify`); approvals record a free-string
  `actor` with digest binding and taint labels but no role matrix ([repo] `schemas/workflow.schema.json:141`,
  `src/runtime.mjs:318–330`). The E-bed *host* contract does have `humanTasks[{ role, excludeUsers }]` and grades SoD
  as a critical violation (E-BED §2.2, §2.8) [repo], so the concept exists in the bed and not in the product. Nothing
  "multi-tier" can be represented until it does.
- **I2. The constitution is oracle-side.** The invariants v0 wants are already written: E-BED's critical violations
  (duplicate money movement, effect requiring approval without approval, SoD violation, orphaned charge, missing or
  duplicated filing, an effect that follows an injected instruction) and INTENT's 23 not-wanted predicates with
  proven teeth (`experiments/specbiz/predicates.mjs`) [repo]. They are analyst-side, never shown to arms. The gap is
  a *first-class, owner-authored artifact* that the builder reads (so it can comply), the shield enforces (so it
  cannot game) and the auditor receives (so it can be relied on), with an owner and a layer per clause.
- **I3. Trust is defined as "the oracle passed"; organisations define it as "the control operated, all period, with an
  accountable owner, and the evidence is complete".** The time dimension (period, operating effectiveness), the
  population dimension (IPE) and the human dimension (attestation, authorised exceptions) are absent from THESIS and
  from v0.
- **I4. Adaptation versus change control** (A8): THESIS P6 needs a written envelope rule.
- **I5. Constructor versus configurer.** Organisations do not want new logic; they want their rules configured and
  their exceptions handled. E-BED's Track C ("configure the documented product from memos, cases and an SME") is the
  closer analogue to the ask than Track P, and v0's org twin should weight it. Decision tables are central in 8 of 9
  bar items and are where rule engines already do well (BAR-SET §1), so construction's value lies in the exception
  handling around them, not in re-implementing them.
- **I6. Cross-workflow state.** Org invariants are over many workflows and systems. THESIS D11 forbids a mutable
  cross-run store in Foundry; that is compatible with an **observer port**: a read-only, object-centric view of the
  systems of record and of Foundry's own effect ledgers, consumed by monitors. It is not Foundry's store; it is the
  world's.

### 3.2 Technical gaps and the prior art to take

| Need | Prior art (verified today unless marked) | Take | Reject or limit |
|---|---|---|---|
| Static authority proof: DoA, SoD, four-eyes over a generated approval graph | **Workflow Satisfiability Problem**: NP-hard even with binary SoD constraints, fixed-parameter tractable in the number of steps (Wang & Li 2010, as cited in [arXiv 1306.3649](https://arxiv.org/pdf/1306.3649); Crampton et al. [arXiv 1504.02420](https://arxiv.org/pdf/1504.02420.pdf)) | a solver that returns a satisfying principal assignment for each workflow version against the role matrix, or a named refusal; steps are few, users many, so FPT applies | nothing for dynamic SoD on case history; that is the monitor's job |
| Layer narrowing and policy analysis | **Cedar** (OOPSLA 2024, DOI 10.1145/3649835): formal model in Lean, sound and complete SMT encoding enabling "refactoring leaves permissions unchanged" analysis; validator; proofs found 4 validator bugs, differential testing 21 ([arXiv 2403.04651](https://arxiv.org/abs/2403.04651v2), [FSE companion](https://arxiv.org/html/2407.01688v1)) | Cedar's semantics for the authority layer: "a lower layer may only narrow" becomes a decidable containment query; use Cedar itself for the policy store rather than inventing a DSL | OPA/Rego is less analysable; keep for ops glue only |
| Temporal obligations and legality as declarative constraints | **DecSerFlow/Declare** (van der Aalst & Pesic 2006, mapped to LTL, reused for runtime monitoring and enactment; finite-trace fix by Pešić, Bošnački, van der Aalst 2009) ([Dagstuhl](https://drops.dagstuhl.de/entities/document/10.4230/DagSemProc.06291.10)); **LTLf/LDLf** (De Giacomo & Vardi, IJCAI 2013) ([paper](https://www.diag.uniroma1.it/~degiacomo/papers/2013/IJCAI13dv.pdf)) | constitution clauses as LTLf over the object-centric event log; monitors synthesised, not hand-written | model checking the full process is NP-complete (Governatori's group); monitor per clause, per case |
| Norms with violations and reparations (Reg E: "if late, then notify within 2 days") | **Compliance by design** (Governatori & Sadiq; Regorous checker; non-monotonic deontic logic of violations; polynomial gap diagnosis in one setting) ([chapter](https://igi-global.com/chapter/journey-business-process-compliance/19704), [arXiv 1403.6865](https://ar5iv.labs.arxiv.org/html/1403.6865)) | obligation chains with reparations as the clause type for clocks; it is exactly P60's shape | the full annotation methodology is heavy; take the clause semantics only |
| Runtime enforcement that edits, not only halts | **Edit automata** (Ligatti, Bauer, Walker, IJIS 4(1–2):2–16, 2005: truncation, suppression, insertion) ([Princeton](https://www.cs.princeton.edu/research/techreps/375)); **shielding** (Alshiekh et al., AAAI 2018: a monitor synthesised from a temporal specification corrects an action iff it is unsafe; CACM 2025 "Shields for safe RL") ([AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/11797/11656)) | the shield sits between the workflow and the effect port: allow, suppress, or insert an escalation; every intervention is journaled evidence; the "post-posed" placement means the builder's artifact is unchanged and benchmarkable | pre-posed shields that restrict the action set change the artifact; use post-posed only |
| Org-wide ground truth across objects | **OCEL 2.0** (spec 2023-10-16; objects, object-to-object relations, qualifiers; SQLite/XML/JSON; PM4Py object-centric conformance) ([arXiv 2403.01975](https://arxiv.org/pdf/2403.01975)) | the observer port emits OCEL 2.0; monitors and the twin's oracle read it; real BPI logs calibrate | B10/B11 OCEL datasets are simulated and one mislabels two-way match (BAR-SET §6): calibration only |
| Composition without re-running everything | **Contracts for System Design** (Benveniste et al., FnT EDA 12(2–3), 2018: assume/guarantee meta-theory) ([now](https://nowpublishers.com/article/Details/EDA-053)); **P2P / projection inheritance** (van der Aalst & Weske: agree a public workflow, partition, refine privately; projection inheritance guarantees the public behaviour is realised) ([vdaalst.com p191](https://www.vdaalst.com/publications/p191.pdf)) | each workflow publishes assumptions on SoR state and guarantees on its effects; org invariants are proved from contracts; a lower layer is a *subclass* of the public process, which is "narrowing" with a 25-year-old proof technique | contract theories assume well-defined interfaces; effects through opaque connectors need the ledger as the interface |
| Conservation as a type | **Pacioli group** (Ellerman: double entry as the group of differences of pairs, generalised to multi-dimensional vectors) ([arXiv 1407.1898](https://arxiv.org/abs/1407.1898)); **Daml** authorisation (a contract is created only with all signatories' authority; a choice is exercised only by its controllers) ([docs.daml.com](https://docs.daml.com/1.9.0/daml/intro/6_Parties.html)) | money-moving effects typed as balanced vectors over (entity, account, period, currency), rejected at validation if unbalanced or in a closed period; authority as part of the effect type, Daml-style | nothing for valuation judgments; conservation is the easy half of accounting |
| Information flow | labels and control-flow taint exist (README) [repo]; CaMeL-style structure (THESIS P9) | extend labels to the constitution's data clauses | sink-field policy and declassification budget are still open (README) |
| A frame for the organisation itself | Beer's Viable System Model (System 2 coordination, 3* audit, 4 intelligence, 5 policy) and Simons' four levers (boundary systems = invariants, diagnostic = monitors, interactive = exceptions, belief = intent); Ashby's requisite variety [recalled] | as a design frame: the exception channel must carry the variety the invariants remove, or work stops | not a formalism; do not build a "VSM engine" |
| Model provenance as a governed change | SR 26-2 omits GenAI [secondary]; ISO 42001 lifecycle expectations [secondary] | the identity envelope already pins `workflowHash`, `engineHash`, `policyHash`, `registryHash` [repo]; add template hash, prompt hash and model id per build, and treat a rebuild as a change | validation of judgments stays sampled, never certified |

### 3.3 OT-0: the minimal org-twin slice

**Claim it tests.** With a constitution the builder can read and a shield that enforces it, cheap-built workflows on
E8 violate no org invariant across a mid-run policy change, produce auditor-answerable evidence, and do so at least as
well as a frontier agent given the same constitution, at lower cost per case.

**Bed (reuses what exists; E8-only, so design validation, no claim: FIRST-CLASS §0.3).**
- E8 worlds 1232–1234 (d2, d3, d5) and the sized world 1232 d2 size 12 (14 shared cases) [repo].
- **Constitution v0**, three clauses with owner, layer and assurance class:
  - **C1 conservation + exactly-once** (layer: org policy; owner: controller; class: monitorable at the effect
    boundary): per order, Σ captured − Σ refunded = net; a refund never exceeds captures; at most one charge per key.
    E8's oracle already checks these as critical violations, which gives a $0 validity test: the observer's verdict
    must equal the oracle's on every already-graded run.
  - **C2 authority** (layer: entity rule; owner: finance; class: provable + monitorable): a refund above T requires
    approval by a principal holding `finance-approver`, who is not the principal who amended or cancelled the order
    (SoD). Needs the overlay to add roles to E8's scripted actors (the host contract already has `role` and
    `excludeUsers`) and a `human` approval in the spec.
  - **C3 change control** (layer: org policy; owner: controller; class: provable from the journal): T changes from
    T₁ to T₂ at day 7 under an approved constitution v2; a planted attempt by an unauthorised actor to change T at
    day 9 must be refused; every run is pinned to the constitution hash in force at the order's placement.
- **Observer**: maps E8's effect ledger and human tasks to an OCEL-2.0-shaped log (objects: order, payment,
  fulfilment, principal) and evaluates C1–C3; built from the INTENT predicates (`refund without charge`, `wrong
  amount`, `double charge` already exist and fire on mirrored controls) [repo].
- **Shield**: a post-posed edit automaton in the E8 host at the effect port: allow / suppress-and-escalate / insert
  an approval request; every intervention journaled with the clause id.
- **Scripted auditor**: five population queries (versions of the workflow in the period; constitution versions and
  their approvers; refunds above T with approver and SoD check; shield interventions; runs whose constitution hash
  mismatches the one in force) and a sample walkthrough of 10 cases. Pass = every query answered from the journal
  alone, and the population matches the oracle's ground truth.

**Arms.**

| Arm | What | Cost basis |
|---|---|---|
| W-blind | the existing three B1L-H lineages, re-graded with the observer ($0): what happens when org rules live outside the process spec | $0 |
| W-C | B1L-H with the constitution in the build inputs, K = 3 | 3 × $0.39–0.62 |
| W-S | W-blind builds + shield (enforcement only) | $0 runs |
| W-CS | W-C + shield | $0 runs |
| A-HV | agent-H + validator (existing arm) with the constitution in its prompt, sized world | ≈ $2 |
| **A-F** | **frontier agent alone** (Sonnet 5.5 per tick; Opus 5.5 if budget) with the constitution in its prompt, sized world: the owner's named comparator | Sonnet ≈ $9–12; Opus ≈ $30–50 [arith from agent-H $1.45 at 143 ticks and dev60 price ratios] |
| G | necessity control: a 30-line host guard (threshold + role check, no model) | $0 |

**Metrics.** E8 oracle pass (existing); violations per clause per lineage (any/none, and count); shield interventions
and resulting escalations (an intervention is evidence the builder did not comply); stale-rule window after the
day-7 switch (cases handled under T₁ after T₂ took effect); auditor pass (5 queries, 10-case walkthrough); cost per
completed case all-in (build + runs + shield + repair); the paired comparison W-CS vs A-F on the 14 shared cases.

**Predictions, declared before the run (to be copied into a PREDICTION.md before any code).**
- P1: all three W-blind lineages violate C2 on at least one refund above T (they cannot know the rule). Trivially
  expected; it fixes the baseline and shows that a perfect process oracle says nothing about org invariants.
- P2: at least one of three W-C lineages violates C2 or C3 without the shield (the E8 pattern: each imperfect
  lineage missed one whole requirement, B1-E8-DEV); W-CS has zero violations in every lineage, with ≥ 1 intervention
  in each lineage that W-C alone would have failed.
- P3: A-F with the constitution in its prompt violates C3 (stale threshold after day 7) or C2 (wrong approver) in at
  least one of the 14 cases. **Refutation:** A-F has zero violations and ≥ 12/14 on the oracle at ≤ 2× W-CS's cost per
  case. Then the enforcement layer buys nothing a frontier agent does not do at this scale, and the paid plane is
  evidence and benchmarkability only.
- P4: G alone reaches zero violations on C2 and C3. Expected true; the reading is that *enforcement is cheap* and the
  product's value is the certificate, the evidence and the builder's compliance rate (fewer interventions), not the
  mechanism. If G fails (dynamic SoD needs case history the guard lacks), the shield's state is justified.
- P5: the scripted auditor's population queries fail on the current journal for at least one query (README's
  unbound-decisions gap). Refutation: all five pass; then the evidence pack is closer than README says.

**Resolution.** 14 shared cases and K = 3: violations read per lineage as any/none (0/3 vs 3/3 informative), oracle
differences only when ≥ 4 discordant cases (McNemar at this n), cost directional. Dev evidence; E8-only; one
generator we wrote. The claim-bearing version runs on E1-lite (P2P tolerance as a constitution layer, DoA by amount)
and SOP-Bench's sealed rows once their beds exist.

**Cost.** $0: constitution schema and three instances; observer; shield; overlay (roles, day-7 switch, planted
unauthorised change); scripted auditor; preregistration with MDE. About 3–5 agent-days of session quota [I]. Paid:
W-C builds $1.2–1.9, N-version repair ≈ $0.3, A-HV ≈ $2, A-F Sonnet ≈ $9–12, A-F Opus optional ≈ $30–50. **Total ≈
$15–20 list without Opus, $45–70 with; cap $100.** Under the $500 pause; adds to the cap-basis soft cap (FIRST-CLASS
§11) and must be booked as its own line.

**What OT-0 cannot show.** Real systems of record; real auditors; multi-entity consolidation; period cut-off across
ledgers; operating effectiveness over a real period; anything about SAP, NetSuite or D365 behaviour; that the
constitution can be *derived* from a messy organisation (that is INTENT/SPEC-1's question, and RATER2's κ = 0.57 on
implied-versus-latent warns that even labelling which rules are "org rules" is unreliable between raters).

**The full org twin (v0 §4), costed honestly.** E-BED's nine single-process items need 15–25 agent-days of authoring,
$250–750 for a two-item pilot and $1.1–3.8K for the rest (E-BED §8) [repo]. v0's twin adds composition across five
processes, seven systems, two or three entities and simulated months: at least the full E-bed plus a composition
layer, roughly 30–60 agent-days and $2–5K list [I]. It is a sealed-bed artifact for after OT-0 and E1-lite validate
the design, not a 30-day item, and not before SPEC-1 has shown whether a constitution can be recovered from a mess.

---

## 4. Recommendation

### 4.1 The open-core line

- **Licence:** Apache-2.0 or MIT for the engine, IR, constructor, verify nodes, local journal, viewer and the
  single-authority constitution (Temporal's choice). AGPL is acceptable if the owner fears hyperscaler hosting
  (Windmill's choice). No Sustainable-Use or source-available licence: the precedent record is forks and reversals,
  and a solo operator cannot survive a fork.
- **Free (one authority):** everything a developer builds, however complex; sagas, sub-workflows, practice worlds
  and mocks; local invariants; `foundry verify-run` and anchors; SSO.
- **Paid, one product, the Control Plane (more than one authority):** role matrix and delegation of authority;
  static SoD/DoA proof per version; change control bound to identity with developer ≠ approver and benchmarkable
  version hashes; the runtime shield with its intervention ledger; authorised exceptions and break-glass with expiry;
  signed period evidence packs with external anchors and population queries; export to Agent 365, ServiceNow AI
  Control Tower and Workday ASOR rather than competing with them.
- **Paid, verified packs:** the AP exception pack first, priced per verified outcome, each outcome carrying a
  certificate of conformance against the customer's constitution.
- **Not paid, not listed:** practice worlds and mocks (adoption fuel; K3 pending); upkeep and drift (M9 detected 0 of
  4 drifts; DRIFT-1 unrun); hosted durability (deferred until there is an operations capability and a customer who
  asks).
- **Pricing hypothesis [I, untested]:** one platform commit per organisation sized by governed workflows × authorities,
  in the $40–80K band the 10-15 pass derived; packs per outcome at 20–35% of the buyer's measured cost per case. One
  number per buyer.

### 4.2 The first paid product

**Keep the AP Exception Desk pilot of the 10-15 plan (fixed fee, shadow mode, exported history, preregistered with
the buyer), with one change:** every verified exception ships with a conformance certificate against the customer's
own tolerance hierarchy, DoA matrix and SoD rules, and the pilot readout includes the scripted auditor's population
queries. Reasons: the controller or CFO deputy is the economic signer (WHAT-ORGS §1) and the certificate is what they
can show their auditor; E1's tolerance hierarchy *is* a constitution layer; and the same build serves the second
product.

**Second product, and the branch if K1 fails:** the Control Plane as a **certification sidecar for the customer's
existing agents and bots** (UiPath, Copilot Studio, Agentforce): constitution, shield at their effect boundary,
evidence pack. This is the 10-15 K5 recut ("verified outcomes for your existing agents") made concrete, and it does
not depend on our construction results at all.

### 4.3 The next 30 days (2026-10-21 → 2026-11-20), ranked

| # | Days | Work | Cost | Gate / kill criterion |
|---|---|---|---|---|
| 1 | 1–7 | **Constitution v0** (JSON schema: clause, owner, layer, assurance class, check, evidence fields; three E8 instances C1–C3) and the **overlay** (roles on actors, day-7 switch, planted unauthorised change). **Observer** from the INTENT predicates; $0 validity test: observer ≡ oracle critical violations on all graded E8 runs. **Shield** as a post-posed edit automaton in the E8 host. Tests: fires on mirrored controls, silent on both reference runs. New directory, nothing under `src/` (engine freeze) | $0; 3–5 agent-days | **K-E:** if C2 cannot be expressed without a principal-bearing `human` node, record it as the 11-04 engine-bump item and run OT-0 with the host-side role; no authority claims before the IR carries principals |
| 2 | 6–12 | **OT-0** preregistered run (PREDICTION.md before code; MDE printed; arms and predictions of §3.3; own budget line) | ≤ $100 cap; ≈ $15–70 | **K-B:** A-F has zero violations and ≥ 12/14 at ≤ 2× W-CS cost per case → the enforcement plane is not the product at this scale; sell evidence and benchmarkability only. **K-C:** G alone reaches zero violations and W-C's compliance rate is no better than W-blind's → construction does not learn the constitution; the product is the sidecar (§4.2 second product), not the constructor |
| 3 | 8–14 | **Evidence pack v0**: per-period population of workflow and constitution versions, approvers, shield interventions, constitution-hash mismatches, from journals and anchors; the five scripted-auditor queries run against our own repository's E8 runs; a one-page "ITGC walkthrough" template | $0 | **K-D:** if any population query cannot be answered completely from the journal, the evidence product waits for the engine bump that binds decisions into the chain; say so in README |
| 4 | parallel to 11-26 | Add to the 15 discovery interviews: 2 internal auditors or SOX PMO leads and 1 ITGC tester, plus three questions for everyone: who owns the DoA/SoD rules; what evidence the auditor took for RPA bots last cycle; whether a vendor certificate of conformance for model-written logic would be accepted or wanted | owner time | **K-A (11-20):** fewer than 3 of 8 finance or audit interviewees say model-written logic is, or will be, a control they need specific evidence for → the "new risk" is not a budget line yet; sell outcomes, keep the constitution as internal quality |
| 5 | 15–30 | **E1-lite with the constitution**: P2P tolerance hierarchy as a layer, DoA by amount, SoD vendor-master ≠ approver ≠ releaser; the AP demo with a certificate; B1L-H and N-version builds as the 10-15 plan already budgets | $5–15 | the 10-15 gates G0/G1 and K2 (SPEC-1) apply unchanged |
| — | deferred | hosted runtime, SSO/SCIM, the seven-system org twin, multi-entity consolidation, drift and upkeep pricing, a Cedar integration beyond the containment check | — | revisit after OT-0 and E1-lite read |

Budget: all of this fits inside the $2,700 cap-basis soft cap recommended in FIRST-CLASS §11 only if booked as its own
line and if the Opus arm of A-F waits for the Sonnet reading. Usage, not money, remains the binding limit (README
"Cost ledger"), and OT-0's agent arms are the quota hog: run the sized world only.

### 4.4 Where I disagree with the orchestrator

1. **Precedents.** Camunda 8 was never Apache-2.0; Airbyte relicensed in 2021 and extended in 2023; Zapier, the one
   real test of "paywall complexity", was missing; the forks (Operaton, CIB seven, Valkey, OpenTofu) and the
   reversals (Redis, Elastic) were missing, and they are the lesson.
2. **"Paid = practice worlds and mocks of SAP, NetSuite, D365."** No: give them away; they are the adoption loop and
   the one mechanism that took a Haiku build from 0% to 100%.
3. **"Paid = upkeep: drift detection and repair."** Unproven (M9 0/4; DRIFT-1 unrun; the heal kit blocked). Do not
   list it.
4. **Six paid items.** One product and one pack. A solo operator cannot sell six.
5. **"Static proof at deploy."** An assurance ladder per family; most families are monitorable, not provable, and
   value conservation inside the SoR depends on data access the SoR vendor controls.
6. **"Lower layers narrow, never widen."** Authorised widening with evidence is the product; containment is free
   (Cedar).
7. **The org twin.** 5–10× E-bed; not a 30-day item; OT-0 instead, then E1-lite, then a sealed twin.
8. **"An org invariant layer is these pieces composed into a constitution"** understates the missing piece: there is
   no principal in the product IR, and the invariants exist today only oracle-side. The work is a principal model and
   a lifting, not composition.
9. **Trust framing.** Benchmarkable, hash-pinned versions versus an un-benchmarkable fresh session per case is the
   enterprise argument for the thesis; v0 does not use it, and THESIS P6 needs an envelope rule to keep it.
10. **The invariant layer's home.** v0 places it on the constructor side; the evidence (agent-H + validator 12/14; K5)
    says it must work on anybody's workflow or agent, so it lives on the verifier side and the constructor is a
    customer of it.

### 4.5 Owner decisions this needs

1. Licence choice for the engine (Apache-2.0 / MIT versus AGPL) and the statement that the free tier has no
   complexity ceiling.
2. The paid line as "more than one authority", and SSO free.
3. OT-0's budget line (cap $100) and whether the Opus comparator runs.
4. Whether the IR gains a principal-bearing `human` node and a constitution reference at the 11-04 engine bump.
5. Which three audit-side interviewees, and whether the interview script may name "model-written logic" as a control.
6. The commercial-entity, customer-data and model-terms decisions of WHAT-ORGS §4.2 are unchanged and still open.

---

## Appendix A. Verification table (2026-10-21)

| Claim | Source | Result |
|---|---|---|
| n8n SUL since 2022-03-17; internal business purposes; consulting allowed; non-commercial redistribution | [docs.n8n.io/faircode-license](https://docs.n8n.io/faircode-license); [blog mirror](https://www.plushcap.com/content/n8n/blog/announcing-the-new-sustainable-use-license) | matches |
| n8n $5.2B SAP investment 2026-05-12; Joule Studio embed | [press release mirror](https://www.bolsamania.com/nota-de-prensa_email/mercados/n8n-valuation-doubles-to-52bn-as-sap-makes-strategic-investment-and-plans-to-embed-the-ai-platform-into-joule-studio--22470787.html) | matches; ARR figures conflict across secondary sources |
| Camunda 8.6 production licence key, Camunda License 1.0, 2024-10-08 | [Camunda blog](https://camunda.com/blog/2024/10/camunda-licensing-what-you-need-to-know/); [8.6 announcements](https://docs.camunda.io/docs/8.6/reference/announcements-release-notes/860/860-announcements) | matches |
| Camunda ARR nearing $200M, Aug 2026; 2025 record year | [press release](https://camunda.com/press-releases/camunda-closing-in-on-200m-in-arr-doubling-revenue-in-record-time/) | matches |
| Camunda 7 CE EOL 7.24 on 2025-10-14; Operaton fork Apache-2.0 | [WZ-IT](https://wz-it.com/en/blog/camunda-7-end-of-life-operaton-cibseven-fluxnova-compared/); [camunda.com](https://camunda.com/de/platform-7/) | secondary; dates single-source |
| Temporal $146M at $1.72B; Cloud 4.4×, NDR 184%; MIT | [release](https://www.silicon.co.uk/press-release/temporal-technologies-secures-146m-at-1-72b-valuation-to-fuel-durable-production-agentic-workloads-globally) | matches (company claims) |
| Temporal $5B (Feb 2026), ≥ $12B talks (Aug 2026), ARR > $100M | [TNW](https://thenextweb.com/news/temporal-500m-raise-12bn-valuation); [Dealroom](https://dealroom.co/news/145833-temporal-in-talks-for-500m-round-at-12b-six-months-after-300m-raise/) | secondary; talks unclosed |
| Kestra $25M Series A 2026-03-31; Apache-2.0 + closed EE | [tech.eu](https://tech.eu/2026/03/31/kestra-raises-25m-series-a-to-build-the-enterprise-orchestration-standard/); [Alven](https://alven.co/news/kestra-raises-25-million-series-a-to-become-the-orchestration-standard-for-enterprises) | secondary |
| Windmill AGPLv3; CE free internally, not as a managed service; EE licence key | [GitHub README](https://github.com/windmill-labs/windmill) (fetched) | matches |
| Activepieces MIT core; `packages/ee` commercial licence | [docs](https://www.activepieces.com/docs/about/license) | matches |
| GitLab buyer-based tiering; Free = individual contributors, Premium = directors, Ultimate = executives | [handbook pricing](https://handbook.gitlab.com/handbook/company/pricing); [tiering](https://handbook.gitlab.com/handbook/product/tiering-guidance-for-features/) | matches |
| GitLab FY2026 revenue $955.2M, +26% | [SEC 8-K exhibit](https://www.sec.gov/Archives/edgar/data/1653482/000162828026013795/gitlab-ex99120260131fy26.htm) | matches |
| Airbyte ELv2 2021-09-27; connectors extended 2023-06-30 | [FAQ](https://docs.airbyte.com/developer-guides/licenses/license-faq); [post](https://airbyte.com/blog/update-on-airbytes-license) (fetched) | matches |
| Redis AGPL May 2025; Elastic AGPL Aug 2024; HashiCorp BSL and OpenTofu | [InfoQ](https://www.infoq.com/news/2025/05/redis-agpl-license); [chronicle](https://wz-it.com/en/blog/open-source-licence-change-chronicle/) | secondary |
| SSO tax catalogue ~150 vendors (Jun 2026); GitHub 425% | [Clerk](https://clerk.com/articles/the-real-cost-of-enterprise-sso-per-connection-vs-per-mau-p-2); [1Password](https://blog.1password.com/explaining-the-backlash-to-the-sso-tax) | secondary |
| Zapier multi-step Zaps paid-only on the current free plan | [help centre](https://help.zapier.com/hc/en-us/articles/32337438839565); [community](https://community.zapier.com/troubleshooting-99/change-to-free-plan-cannot-publish-anymore-37341) | feature matches; change date secondary |
| SOC 2 CC8.1 wording and points of focus | [Cyberday](https://www.cyberday.ai/requirement/soc-2-cc8-1-change-management-procedures) | secondary; AICPA text not opened |
| ISO 27001:2022 A.8.32 | [isms.online](https://isms.online/iso-27001/annex-a/8-32-change-management-2022) | secondary |
| ITGC testing practice (population, IPE, developer ≠ migrator) | [SolarWinds](https://www.solarwinds.com/blog/itsm-for-financial-services-change-management-audit-trails-and-what-regulators-actually-want); [Onapsis](https://onapsis.com/blog/mastering-sap-itgc-sox-compliance/) | secondary |
| AS 2201 App. B ¶B28–B33 benchmarking | [Protiviti](https://tcblog.protiviti.com/2022/11/16/develop-an-effective-sap-automated-controls-benchmarking-strategy); [Compact](https://www.compact.nl/articles/benchmarking-it-application-controls/) | secondary; PCAOB text not opened |
| SR 11-7 replaced by SR 26-2 on 2026-04-17; GenAI omitted | [CRA Insights](https://media.crai.com/wp-content/uploads/2026/07/09165122/FE-Insights-MRM-Guidance-SR-26-2-In-the-Era-of-AI-July2026.pdf); [arXiv 2607.04103](https://www.alphaxiv.org/abs/2607.04103); [risk.net](https://www.risk.net/ja/node/7963480) | secondary; primary text not opened |
| EU AI Act Digital Omnibus dates | [Sidley](https://datamatters.sidley.com/2026/06/22/eu-lawmakers-reach-provisional-agreement-to-delay-key-eu-ai-act-obligations/); [CMS](https://cms.law/en/gbr/publication/The-EU-s-Digital-Omnibus-on-AI-What-the-Provisional-Agreement-Really-Changes) | secondary; OJ publication unconfirmed |
| ServiceNow AI Control Tower, Knowledge 26, 30 connectors, kill switch, Veza | [The Register](https://theregister.com/2026/05/05/servicenow_clears_agents_for_landing/) | secondary |
| Workday ASOR announced Feb 2025; shipping 2026R1 | [IT Brief](https://itbrief.com.au/story/workday-unveils-platform-to-manage-ai-in-digital-workforces); [Enterprise DNA](https://enterprisedna.co/resources/news/workday-agent-system-of-record-sana-2026) | secondary; shipping single-source |
| Oracle AAC 100+ practices, graph access paths; 26C agents | [Enterprise Times 2018](https://www.enterprisetimes.co.uk/2018/10/04/oracle-risk-management-gets-new-access-controls/); [erpresearch](https://erpresearch.com/erp-add-ons/audit-management/oracle-risk-management-cloud) | secondary; 26C unverified |
| Celonis v. SAP: filed Mar 2025; stipulation Jun 2025; MTD mostly denied Oct 2025; trial 2027; trade-secret claims Jun 2026 | [Celonis release](https://www.celonis.com/news/press/legal-update-sap-agrees-to-not-interfere-with-celonis-extractor-in-antitrust-litigation); [PEX](https://www.processexcellencenetwork.com/process-mining/news/judge-denies-most-of-saps-motion-to-dismiss-celonis-antitrust-claims); [CIO](https://www.cio.com/article/4204442/sap-dodges-german-antitrust-investigation-over-data-extraction.html) | secondary |
| Vanta $150M at $4.15B, Jul 2025 | [Bloomberg](https://www.bloomberg.com/news/articles/2025-07-23/vanta-notches-4-15-billion-valuation-with-new-funding-round) | matches (headline) |
| Cedar OOPSLA 2024, Lean, SMT analysis | [arXiv 2403.04651](https://arxiv.org/abs/2403.04651v2); [SPLASH](https://2024.splashcon.org/details/splash-2024-oopsla/25/Cedar-A-New-Language-for-Expressive-Fast-Safe-and-Analyzable-Authorization) | matches |
| WSP NP-hard, FPT (Wang & Li 2010 via later work) | [arXiv 1306.3649](https://arxiv.org/pdf/1306.3649) | secondary citation; the 2010 paper not opened |
| OCEL 2.0 spec 2023-10-16 | [arXiv 2403.01975](https://arxiv.org/pdf/2403.01975) | matches |
| P2P / projection inheritance (van der Aalst & Weske) | [vdaalst.com p191](https://www.vdaalst.com/publications/p191.pdf) | abstract-level |
| Compliance by design, Regorous | [chapter](https://igi-global.com/chapter/journey-business-process-compliance/19704); [arXiv 1403.6865](https://ar5iv.labs.arxiv.org/html/1403.6865) | abstract-level |
| Shielding AAAI 2018; edit automata IJIS 2005 | [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/11797/11656); [Princeton](https://www.cs.princeton.edu/research/techreps/375) | matches |
| DecSerFlow 2006; LTLf IJCAI 2013; Benveniste 2018 | [Dagstuhl](https://drops.dagstuhl.de/entities/document/10.4230/DagSemProc.06291.10); [De Giacomo](https://www.diag.uniroma1.it/~degiacomo/papers/2013/IJCAI13dv.pdf); [now](https://nowpublishers.com/article/Details/EDA-053) | matches |
| Ellerman Pacioli group; Daml authorisation | [arXiv 1407.1898](https://arxiv.org/abs/1407.1898); [docs.daml.com](https://docs.daml.com/1.9.0/daml/intro/6_Parties.html) | matches |
| ISO/IEC 42001 certifiable via accredited bodies | [Sprinto](https://sprinto.com/hub/finding-the-right-iso-42001-auditors/) | secondary |

Not verified and not used: a reported SailPoint acquisition of Drata; Oracle's 26C agent feature beyond a profile
page; Windmill and Activepieces revenue; any PCAOB, AICPA or ISO primary text.

## Appendix B. Files read

`AGENTS.md`; `README.md` (status, results, cost ledger, decisions); `docs/THESIS.md`; `docs/ROADMAP.md` §6;
`docs/RESEARCH.md` ("What is still unproven"); `research/business-20261021/OPEN-CORE-AND-INVARIANTS.md`;
`research/business-20261015/WHAT-ORGS-PAY-FOR.md`; `research/enterprise-20261014/{BAR-SET,E-BED (§0–3, §8, §10–11),
CATALOGUE (§0–1), B1-E8-DEV}.md`; `research/architecture-20261015/FIRST-CLASS-PROGRAMS.md` (headers, owner summary,
§0); `research/automationbench-20261014/runs/DEV60-A0-A1.md`; `research/composition-20261021/PLAN.md`;
`research/intent-20261021/{DESIGN,RATER2}.md`; `research/benchmarks-20261015/CONSTRUCTION-BENCHMARKS.md` ("no
benchmark"); `schemas/{workflow,identity}.schema.json`; `src/runtime.mjs:318–330`; `src/audit.mjs` (anchors);
directory listings of `beds/wbed/r4/`, `beds/ebed/e8/`, `experiments/specbiz/`, `experiments/tracker/`; `git log`.
No credential file, `beds/sealed/` or held-out task was read.
