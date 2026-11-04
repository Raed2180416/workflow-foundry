# Org / enterprise onboarding and buying sweep (read 2026-10-21)

STATUS: COMPLETE for this sweep. Layout: A and B = raw findings with URLs; C = synthesis for Foundry (C0 bottom line, C1 personas, C2 ask ladder, C3 setup links,
C4 security-review kit, C5 approval spec, C6 immutable-rules spec, C7 AI governance, C8 line/open questions, C9 journeys, C10 anti-patterns, C11 caveats, C12 follow-ups).
Sweep owner: org-enterprise. Date read: 2026-10-21 (all URLs). No accounts created, no forms submitted, nothing published (D13).

Evidence tags: [doc] vendor documentation fetched today; [mkt] vendor marketing or press; [obs] public page actually fetched and its
structure observed (trust portals, admin docs describing exact UI labels); [3p] third-party write-up; [inf] my inference.
"Observed UI" here means page text only: no screenshots were available, no accounts were created, no forms were submitted.

## A. Raw findings log (primary sources)

### A1. IT-admin onboarding handoff: WorkOS Admin Portal  [doc]
URL: https://workos.com/docs/admin-portal/guide/introduction (read 2026-10-21)
- The vendor (the SaaS selling to the org) creates an "organization" for the customer, then clicks "Invite IT contact", picks features, and emails
  or copies a setup link. Link lasts 30 days or until setup completes; only one active link at a time. API-generated links expire in 5 minutes.
- Each link is scoped to ONE intent: sso, dsync (directory sync), audit_logs, log_streams, domain_verification, certificate_renewal.
- IT contact does: domain verification (DNS TXT record), SSO (IdP details, status, "Test sign-in", "Edit Metadata Configuration", recent sessions),
  Directory Sync (user and group counts, last sync time, "Edit Attribute Map", "Edit groups sync"). Delete requires typing DELETE CONNECTION.
- "IT contact email collection step is required during setup when the organization has no IT contact": future cert-expiry alerts go to that person.
- Lesson [inf]: the buyer champion (a developer or a manager) never touches SAML. They press one button that sends a scoped, expiring link to the
  person who owns the IdP. The product owns the plumbing; the IT admin gets a guided page with a test button.

### A2. Standardised agent access via the IdP: XAA / ID-JAG / MCP enterprise-managed authorization  [doc]
- MCP extension page: https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization (read 2026-10-21). Extension id
  `io.modelcontextprotocol/enterprise-managed-authorization`. Org IdP (Okta, Entra, corporate SSO) is the decision-maker; client exchanges its ID token
  for an ID-JAG, then exchanges the ID-JAG at the MCP server's authorization server for an access token. IdP "Evaluate Policy" step in the diagram.
  Claims: centralized policy, single sign-on, policy enforcement before token issue, centralized revocation. Opt-in extension, never default.
- WorkOS explainer (marketing, dated 2025-12-10): https://workos.com/blog/id-jag-cross-app-access . Says introduced in MCP 2025-11-25 as SEP-990; spec
  is IETF draft draft-ietf-oauth-identity-assertion-authz-grant-04 (still a draft; page subtitle overstated it as "standardized").
  Admin sees: which client has access to which server as which user with which scopes; allow/deny client-to-server pairings; step-up auth; group gating.
- Anthropic support article (GA for Team and Enterprise, Okta at launch, others "coming soon"): https://support.claude.com/en/articles/15537633-authorize-mcp-connectors-for-your-entire-organization
  Admin flow in Organization settings > Connectors > select connector > "Set up" next to "Managed authorization" > Connect (IdP + test) > Roles
  (pilot with one custom role first) > Scopes > "Save & turn on". Members get the connector automatically on first login; revocation = deprovision in IdP.
  Listed connectors: Asana, Atlassian, Canva, Datadog, Figma, Granola, Linear, Notion, Slack, Supabase.
- Lesson [inf]: for an org, "connect Foundry's MCP server and the systems it touches" should be ONE admin act in the IdP, not N per-user OAuth screens.
  Foundry should declare enterprise-managed authorization support on its own MCP server (as a resource server) and, as a client of other MCP servers,
  prefer ID-JAG where the org offers it.

### A3. What admins can control for MCP and AI apps, per product (observed admin-doc UI terms)  [doc]
- Slack (https://docs.slack.dev/ai/slackbot-mcp-client/admin-approval/ ; help article says feature from 2026-06-18): app declares `mcp:connect` scope;
  if approval is required the app lands in the admin "Requests" queue of the Marketplace management page; admin sees requested scopes AND a "Connected MCP
  Servers" section where EACH server is allowed or denied individually; afterwards Integrations > Installed apps shows server status "ALLOWED" or "INACTIVE".
  Adding an MCP server on a different domain requires re-approval. Without approval, consent screen shows "Review app permissions" + "External MCP servers" URLs.
- Google Workspace (https://knowledge.workspace.google.com/admin/apps/control-which-apps-access-google-workspace-data): Security > Access and data control >
  API controls. Per-app states: Trusted / Specific Google data / Limited / Blocked. Service-level Restricted/Unrestricted. High-risk scopes list for
  Gmail, Drive, Docs, Chat. Unconfigured third-party apps: allow all / allow sign-in only / block all, plus "Apps pending review" queue and a custom
  message shown on denial. Changes can take up to 24h; accessed-app data lags ~48h.
- Atlassian Rovo MCP (https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-rovo-mcp-server-settings/): Atlassian Administration >
  org > Connectors > Atlassian MCP server. OAuth 2.1 default; API token optional ("advanced") with an org-level toggle; domain allowlist ("Allow Atlassian
  supported domains", "Add domain"); IP allowlist applies to both; page itself tells admins to "monitor audit logs" but gives no how-to (a gap).
- Notion (https://www.notion.com/help/notion-mcp): Enterprise owners set "Restrict AI apps members can connect to: Only from approved list" under Connections >
  Permissions; an admin adds a tool by connecting to Notion MCP from it first; existing connections are carried onto the list automatically; admins see
  which AI apps have active connections but NOT yet which users use each; audit log shows the app name as of the event time.
- GitHub (https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/enterprise/mcp-management): policy "MCP servers in Copilot"; a
  `managed-settings.json` allowlist (matches name, URL or stdio command; users cannot override) is the recommended strong form; a custom registry is the
  weaker form (name/ID match only, users can bypass by editing config). OAuth app restrictions: members "request approval from an organization owner";
  owners Review > Grant access under Third-party Access > OAuth app policy.
- Claude Code (https://code.claude.com/docs/en/managed-mcp): the most complete public policy model for MCP. Patterns: Disable MCP; Fixed deployment
  (`managed-mcp.json` at /Library/Application Support/ClaudeCode/, /etc/claude-code/, C:\Program Files\ClaudeCode\); Provided servers
  (`managedMcpServers`); Approved catalog (`allowedMcpServers` + `allowManagedMcpServersOnly: true`); Soft allowlist; Denylist only. Match by `serverUrl`
  (wildcards), `serverCommand`, `serverName` (explicitly NOT a security control). Denylist always wins. Silent disappearance of a blocked server is
  called out by Anthropic as a UX hazard: "tell affected users which servers are blocked". OTEL export can record which MCP servers/tools are invoked.
  Also: project `.mcp.json` servers need user approval in interactive sessions; `claude -p` and cloud sessions load them WITHOUT asking.
  => Foundry must ship an allowlist-friendly identity: a stable serverUrl / serverCommand, so IT can pin it. serverName is not enough.
- Microsoft Entra consent (https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview): user hits "Approval required",
  types a justification, "Request approval"; reviewers notified; requester can only learn the outcome by email (cannot check status in-product, per FAQ);
  reviewers only see requests created after they became reviewers. Out-of-box dialog is "Need admin approval" and "Most users don't know what to do in this
  scenario. They don't know who their admin is" (Microsoft's own words). Admin consent is "a sensitive operation".
  => anti-pattern to avoid: dead-end consent wall with no "who do I ask / what is the status".

### A4. Agent governance planes enterprises are standardising on in 2026  [doc/mkt]
- ServiceNow AI Control Tower (June 2026 release notes: https://www.servicenow.com/community/ai-control-tower-articles/ai-control-tower-what-s-new-in-the-june-2026-release/ta-p/3561445):
  AI Stewards can require formal approval before an MCP server is activated for agent builders; "Unapproved servers are not visible to agent builders";
  intake form with risk questions; asset states Managed/Unmanaged ("only AI Stewards can change an asset's state"); lifecycle Intake > onboarding >
  promotion to Managed > governed monitoring > offboarding; "Use & Purpose" field per asset; deviation detection under Agentic Threat Monitoring;
  compliance packs for California AI Act, Colorado AI Act, EU AI Act (control objectives + citations; one control mapped to many frameworks incl. NIST AI RMF);
  ISO 42001 pack "in legal review".
- Microsoft Entra Agent ID (https://learn.microsoft.com/en-us/entra/id-governance/agent-id-governance-overview, 2026-06-16 ; owners/sponsors page 2026-07-21):
  objects: agent identity blueprint, blueprint principal, agent identity, agent user. REQUIRED human "sponsor" (business accountability, non-technical,
  can only disable/soft-delete) separate from "owner" (technical admin) and "manager". Access via time-bound "access packages" with approval and expiry
  notification to the sponsor; extension request retriggers approval. Admin center: Entra ID > Agents > Agent blueprints > New agent blueprint (Preview):
  Basics > Owners & Sponsors > Review. M365 admin center: Agents > All Agents > Registry with counters "Agents without owners", "Unmanaged agents".
- Okta for AI Agents (GA 2026-04-30; https://www.okta.com/blog/ai/okta-for-ai-agents-general-availability/ ; register page https://help.okta.com/OIE/en-us/content/topics/ai-agents/ai-agent-add-manually.htm):
  agents are first-class identities in Universal Directory, human owners (recommends >= 2), shadow-agent discovery via OAuth consent grants in managed
  Chrome/Edge and CrowdStrike EDR (names Claude Code and Cursor as coding agents it can surface), import from Agentforce / Bedrock AgentCore / ServiceNow,
  user "request access to AI agent" from dashboard with admin approval and time-bound permissions, certification campaigns, "kill switch" (Universal Logout
  for AI Agents), tool-call logs streamed to SIEM, Agent Gateway with virtual MCP server.
  => The three questions Okta frames ("where are my agents / what can they connect to / what can they do") are the IT buyer's mental model [mkt].

### A5. Competing automation vendors' enterprise admin surface (what IT sees when evaluating them)  [mkt/doc]
- Zapier Enterprise (https://zapier.com/enterprise, read 2026-10-21) [mkt]: SSO, SCIM, domain capture, RBAC; "Action Restrictions" (a CRM app can be read-only),
  "App Access Controls", "Domain Restrictions" (block personal accounts connecting to business systems), "Managed Connections" (company-owned, IT-managed),
  "Asset History" audit API, "Log Streaming" to Datadog/Splunk, "AI Guardrails", BYOM (Bedrock), VPC Peering, workspaces with inherited guardrails,
  "Guided Templates" as approved starting points. SOC 2 Type II, SOC 3, GDPR, CCPA. Page does NOT mention a trust centre, security review process,
  pilot, MCP governance or human-in-the-loop approvals. Pitch is "minutes to configure, not months to negotiate".
  => Opening: Zapier sells speed and says nothing about approvals/second-authority; Foundry can own "approval + rules" on the same page.
- n8n security index (https://docs.n8n.io/hosting/securing/overview/): SAML/OIDC SSO, MFA enforcement, security audit, node restrictions, execution-data
  redaction, credential key rotation. Index page does not say which are Enterprise-only (a documentation gap buyers notice).
- Workato (https://www.workato.com/platform/security) [mkt]: "Automation HQ federation: decide exactly which capabilities and connectors each workspace can use,
  set usage limits per team, built-in review and approval workflows on every deployment"; RBAC covering who can create/build/deploy workflows, agents,
  MCP servers; audit logging with 90-day configurable retention + SIEM; "MCP guardrails" (SAML SSO, OAuth2, rate limits, quotas); "Human-in-the-loop:
  route critical AI decisions for approval in Microsoft Teams or Slack"; BYOK keys; PrivateLink; regional data centres; SOC 1/2/3, ISO 27001/27701/42001,
  HIPAA, PCI-DSS 4.0.1, IRAP, NIST 800-171A r2. => the incumbent enterprise iPaaS bar.
- Tines (https://www.tines.com/blog/agentic-workflows-what-they-are-and-how-enterprise-teams-govern-them/ , 2026-06-08) [mkt]: three governance layers:
  policy (what agents may do: allowed/prohibited actions, data domains, risk thresholds that trigger human escalation), operational (agents as identities,
  least privilege, tool allowlists, ability to stop a running agent), lifecycle (design, test, deploy, monitor, review, retire; full tenant audit log;
  record the AI's decision AND reasoning in the same audit trail). Risk-tiered oversight: HITL for irreversible/high-impact, HOTL (sampling, dashboards)
  for routine, and "HOTL only counts as oversight when monitoring and intervention paths are operationally real". Self-hosted "Runner" option.
- Torq (https://torq.io/ai-governance/) [mkt]: SOC 2 Type II, ISO 27001, ISO 42001; "stateless processing", "zero data retention", "cryptographic audit trails".
- LOW-TRUST SOURCE, do not rely: a "Uvik Software" case study about Tines HITL gates (published-date 2020, "updated October 2026", implausible metrics)
  reads like SEO content. I only reuse its design ideas (approval carries reasoning; expiry is a decision: escalate or fail closed), which are independently
  supported by Tines' own blog and by ServiceNow's "due date required or approval waits forever" documentation (see C-section).

### A6. How enterprises actually buy AI automation (numbers; quality varies, flagged)  [3p]
- Mayfield, "The Agentic Enterprise in 2026" (2026-01-19, https://www.mayfield.com/the-agentic-enterprise-in-2026/): 42% of surveyed enterprises have agents in production;
  line-of-business leaders now largest decision-maker group (46%) vs CIO 38%; 84% say security/compliance non-negotiable but 60% have early/no formal AI governance;
  "70% want to test in their environment before committing ... if you can't offer a sandbox, you're not in the deal"; 65% mix build + buy. (survey by a VC; treat as
  directional.)
- Levelpath buyer survey (2026-07-01, https://www.levelpath.com/blog/how-long-should-an-enterprise-software-purchase-take): most common purchase 7-10 weeks; 72% of
  AI purchases over $10k take 11+ weeks (57% for traditional software); 58% of AI purchases involve 7+ people; security review is the top derailer (58%); 25% of
  buyers have seen shadow development of AI tools with no procurement involvement; 39% include a "could we build this?" comparison. (vendor survey; directional.)
- Practitioner 3-tier gate (https://resources.rework.com/libraries/ai-transformation-strategy/ai-approval-gates-and-vendor-review, 2026-05-19) [3p]: Tier 3 auto-approve
  (no integration, no customer data, no Execute capability), Tier 2 department-head + IT security, ~2 weeks (system integration, internal data), Tier 1 full
  CISO/legal review 4-6 weeks (customer PII, customer-facing Execute, autonomous agent loop). "The Generate vs Execute boundary is the primary decision point."
  Tier assignment within 2 business days. => An org will put Foundry in Tier 1 the moment a workflow can Execute against customers, and in Tier 3/2 if it
  can only draft or read. Foundry should SAY which tier each workflow lands in and ship the evidence pack for that tier.
- Low-trust numbers seen but NOT relied on: Cresse Insights (11.3 stakeholders, 7.2-month cycles) and Prosigns (82% stay in pilot) PDFs have no visible methodology.
- SOC 2 economics 2026 [3p, consistent across 5 sources]: Type 1 6-12 weeks and roughly $10k-$40k all-in with automation; Type 2 needs a 3-12 month observation window
  (6 typical), $30k-$120k year one; many buyers below ~$25k ACV accept Type 1 + questionnaire, $25k-250k want Type 2 (6-month window), >$250k or regulated want
  Type 2 + ISO 27001 + named-firm pen test. "Bridge" pack that unblocks procurement: auditor engagement letter, one-page security overview, pre-filled CAIQ-Lite or
  SIG-Lite, dated Type 1 target. (e.g. https://hub.causo.ai/guides/soc2-for-seed-startups-enterprise-deals-2026 ; https://yusmpgroup.com/blog/soc2-type2-saas-startups)
- Honest alternative evidence when SOC 2 is absent [3p]: dated written commitment, technical assessment/pen-test letter with fixes verified, honest questionnaire
  including "not yet", remediation record; "ask the reviewer: is SOC 2 a hard gate or a risk item?" (https://zaaf.ai/blog/do-you-need-soc2-to-sell-to-enterprise.html)

### A7. Questionnaire and assurance standards (what the buyer's security team actually sends)  [doc]
- CSA AI Controls Matrix v1.1 (released 2026-06-22): 247 control objectives in 18 domains incl. Model Security (13 controls); maps to ISO 42001, ISO 27001, NIST AI RMF
  + AI 600-1, EU AI Act, BSI AIC4, AIUC-1. AI-CAIQ v1.1 = 320 questions (released 2026-06-23). "STAR for AI" Level 1 = self-assessment submitted to the STAR registry;
  Level 1 (Valid-AI-ted) = AI-scored; Level 2 = ISO 42001 certificate + Valid-AI-ted AI-CAIQ. Machine-readable bundle (JSON/YAML/OSCAL) released 2026-08-04.
  (https://cloudsecurityalliance.org/artifacts/ai-controls-matrix-v1-1 ; https://cloudsecurityalliance.org/star/ai/ ; https://cloudsecurityalliance.org/blog/2026/07/14/...)
  => Foundry can emit answers to AI-CAIQ from its own runtime records (machine-readable OSCAL-style) rather than hand-written.
- Shared Assessments SIG 2026 workbook (Mitratech summary 2026-03-05, Shared Assessments 2025-07-18): no new domains; deepens AI governance via ISO 42001 mapping across the
  AI lifecycle; scoping presets Lite / Core / Detail; SIG Lite = high-priority subset for lower-tier vendors (2023 Lite was 126 questions, Core 855). "Hover Helpers".
  (https://sharedassessments.org/blog/2026-sig-workbook-updates/ ; https://mitratech.com/resource-hub/blog/sig-2026-key-updates-and-considerations/)
- AIUC-1 (https://www.aiuc-1.com/ ; Q4-2026 update 2026-10-15 https://www.aiuc-1.com/research/2026-q4-standard-update): standard for AI AGENTS: six principles (Data & Privacy,
  Security, Safety, Reliability, Accountability, Society), 50+ controls, quarterly third-party technical testing (1,000-5,000 scenarios), accredited auditor Schellman
  (2026-02-03), one-year certificate. Q4-2026 adds controls for OPEN-WEIGHT model deployments (re-run safety evals after weights/engine change C002.4; model source/integrity/
  licence verification E006.2) and developer-vs-deployer responsibility guidance. AICPA + AIUC joint SOC 2 + AIUC-1 report announced 2026-10-19, full launch early 2027.
  (https://www.aicpa-cima.com/news/article/auditors-meet-urgent-demand-for-ai-assurance-with-new-offering-from-aicpa-and-aiuc)
  => relevant to the Haiku/Mercury/open-weight mix: AIUC-1 explicitly asks for pre-deployment re-testing when a model changes. Foundry's "practice before live, bound to version
  hash" is the same idea; expose it in these words.
- Security-review checklists for AI agents (GreenHat 2026-06-15, OCSA 2026-08-04, Coworker 2026-10-14, Lorikeet) [3p] converge on: (1) data flow diagram, (2) no-training commitment
  AND retention defined for the exact service path, (3) subprocessors incl. model providers + change notice, (4) action inventory = every API the agent can call, with credential
  scope and amount/frequency caps, (5) per-tool-call audit trail exportable to SIEM, (6) kill switch at workflow / channel / whole-agent level and rollback to previous version
  with who-changed-what, (7) prompt-injection testing evidence, (8) incident SLA. Coworker's pilot tests: canary content with two users of different access; remove access and time
  how long until the AI stops using it; build a scheduled agent as user A that posts where B can read ("most teams skip this, and it is where a sound design leaks").
  (https://greenhatsec.com/resources/agentic-ai-security ; https://ocsecurityaudit.com/ai-vendor-security-review-checklist/ ; https://coworker.ai/blog/enterprise-ai-security ;
   https://www.lorikeetcx.ai/articles/ciso-cto-approve-ai-support-agent-security-2026)
  Key quote (OCSA): "'Not used for training' and 'zero data retention' are separate claims. Require the vendor to define each claim for the exact service path."

### A8. Data residency and SSO/SCIM pricing facts  [doc]
- Slack (https://slack.com/help/articles/360035633934-Data-residency-for-Slack): only Primary Owner can enable; Business+ and Enterprise; Sales-assisted; 12 regions; messages, files,
  search index, app/bot data and "any data collected by an app deployed to Slack's managed infrastructure, ...developer secrets, and logs" ARE in region; member profiles, workspace
  membership, usage/analytics logs may NOT be. Existing data stays in US until migration is requested.
- Notion (https://www.notion.com/help/data-residency): Enterprise; default stays US until Notion confirms migration; page content, files, search index, bot-generated content in region; account info,
  usage data, subprocessor-processed data may be elsewhere; org setting Data & Compliance > Data Residency sets default region for NEW workspaces; old US copy deleted after 30 days.
- Atlassian (https://www.atlassian.com/software/data-residency, developer.atlassian.com page "Last updated Oct 21, 2026"): Standard/Premium/Enterprise, pin to US/EU/AU/DE/SG/CA/IN/KR/JP/GB/CH. Third-party apps must
  implement "realm pinning" (`regionBaseUrls`) and a `dare-migration` hook or customers with residency requirements cannot install them. => an integration/automation layer is judged by whether it
  honours the host system's residency.
- GitHub Enterprise Cloud with data residency (https://docs.github.com/enterprise-cloud@latest/admin/data-residency/about-github-enterprise-cloud-with-data-residency): EU, Australia, US, Japan on a dedicated GHE.com
  subdomain; Copilot data, support data, billing data may be stored outside region; "GitHub will document reasons for the transfer ... but does not notify you when transfers occur."
- SSO/SCIM gating: sso.tax wall of shame; SCIM Tax Index (https://www.idenhq.com/en/scim-tax, data CC-BY 4.0, 2026-06): of 267 tracked vendors 178 gate SCIM behind a paid tier, 68 offer none; another
  dataset (scimtax.org) counts 849 vendors, 331 offering SCIM, 278 charging extra, 218 not publishing the price. => D2's "SSO included in FREE" is a real differentiator against the market norm; SCIM should be
  explicitly decided (see synthesis).

## B. Raw findings log, part B (trust, audit, regulation, approvals, rules)

### B1. Trust centres as actually seen (pages fetched 2026-10-21; [obs] = page text, not screenshots)
- OpenAI Trust Portal, SafeBase-hosted (https://trust.openai.com) [obs]: header "Start your security review" + "View & download sensitive information" + "Get access"; left nav Overview / Compliance /
  "trusted by" / Documents (filter All / Public / Private, "Get access", "Bulk download") / Frontier Model Safety & Security (model evaluations, fairness & bias, AI security) / ChatGPT Security
  Features (Enterprise Key Management) / ~20 topic sections each with "View more" / Trust Portal Updates. Documents named: Data Flow Diagram, Pentest Report, ISO SoA, SOC 3, System Cards, VPAT.
  Certs listed: SOC 2 Type 2, SOC 3, PCI DSS, ISO 27001, 27017, 27018, 27701, **42001**, CSA STAR, FedRAMP 20x. "Report issue" -> bug bounty.
- Zapier Trust Center, Conveyor-hosted (https://trust.zapier.com) [obs]: "Everything you need to complete your security review is here"; 8 Documents, 2 FAQs, 4 Badges; **dated announcements feed with
  subprocessor changes posted ~14 days before effective** ("Baseten was added ... AI provider ... effective October 23, 2026" posted 2026-10-09; "Meta was added ... AI provider ... For Enterprise accounts,
  access must be enabled by a company administrator" posted 2026-09-05); "Subscribe" button for email notices; SOC 2 Type II period June 2025-May 2026 published 2026-08-03; SOC 3 public, SOC 2 under in-product NDA
  workflow, self-service ("You do not need to contact Zapier Support or Sales"); launched Aug 2024 with a pre-filled Vendor Security Alliance questionnaire.
- n8n Trust Center, SafeBase (https://trust.n8n.io) [obs]: GDPR, SOC 2 Type 2, SOC 3; docs: SOC 2, SOC 3, pentest report, **two CAIQs (cloud customers vs self-hosted customers)**, ~7 policies; "Select Get access and submit
  the form ... once your request is approved, you can download" (support article updated 2026-10-20).
- Lindy Trust Center, SafeBase (https://trust.lindy.ai) [obs]: HIPAA, PIPEDA, SOC 2 Type 2; policies include Change Management, Data Retention, Breach Notification; Subprocessors, Privacy Policy.
- Vanta help (https://help.vanta.com/en/articles/11345458-trust-center-nda-docusign): private trust centres require an NDA; public ones mark sensitive documents "Requestable" so the NDA is enforced; DocuSign NDA sync;
  buyer subscriptions to updates. (Wolfia comparison is a competitor, so biased: Vanta questionnaire automation plan-limited.)
- Anthropic trust centre: WebFetch returned only a title; Exa fetch returned unrelated spam text (treated as untrusted data and discarded). NOT observed. Cursor's trust centre returned only a title.
- Lessons [inf]: (1) the public face is a document index plus a changelog of subprocessors, not prose; (2) self-service NDA beats "contact sales"; (3) AI providers are listed AS subprocessors with a purpose label;
  (4) the buyer can subscribe to change notices; (5) a self-hosted variant of the questionnaire is a thing buyers get (n8n) - Foundry's local-first product will need exactly that "self-hosted CAIQ".

### B2. AI data handling statements (what IT will read first)
- Notion AI practices (https://www.notion.com/help/notion-ai-security-practices) [doc]: "By default, your customer data is not used to train models"; providers are subprocessors, authoritative list lives on the
  Subprocessor page (changes over time); Enterprise retention "Varies by model: most offer zero data retention ... a small number don't ... **These models are off by default and the workspace owner must opt in**";
  Free/Plus/Business: provider retains <= 30 days; embeddings deleted within 60 days of page deletion; "Notion AI never widens your access"; in scope for SOC 2 Type 2 and ISO 27001.
- Slack AI feature access (https://slack.com/help/articles/39264531104275-...) [doc]: per-feature switch with four scopes: No one / Only specific people and groups / Everyone except specific people and groups / Everyone.
  "Slack does not train generative AI models on Customer Data." Turning AI off does not reduce the price (stated).
- Anti-pattern evidence: Slack's 2024 privacy-principles episode (TechCrunch/Ars 2024-05-17): opt-out of ML-model training required **emailing a magic subject line** to feedback@slack.com; backlash; clarified later. [3p]
- Cursor enterprise (https://cursor.com/docs/enterprise/security-hardening) [doc]: "Enforce Privacy Mode org-wide so members can't disable ... ZDR"; BYOK keys restricted because "with your own keys, zero data
  retention is subject to your own agreement with the model provider, not Cursor's"; "Non-ZDR models require admin approval"; CMEK; audit logs streamed to SIEM; "Steering belongs with [deterministic controls], never instead of
  them"; "Rules are non-deterministic ... treat them as suggestions"; MCP allowlist entries `server:tool`, `server:*`, `*:tool`; higher-priority sources REPLACE lower, no merge.
  => BYOK is a data-handling fork: with BYOK the customer's own provider contract governs. State it in the UI and in the trust sheet.

### B3. Regulation as of 2026-10-21 (EU AI Act and data transfers)  [law-firm summaries; I did not read the Official Journal text]
- Digital Omnibus on AI adopted: Regulation (EU) 2026/1744, published 2026-07-24, in force 2026-07-27 (Orrick 2026-07-29 says "now in force"; number from third-party summary). High-risk Annex III obligations moved to
  **2027-12-02** (was 2026-08-02); Annex I products 2028-08-02; public-authority deployers 2030-08-02. Article 50 transparency applies from **2026-08-02**, except Art 50(2) machine-readable marking has until 2026-12-02 for systems
  already on the market. New Art 5 bans (NCII / nudifier / CSAM) from 2026-12-02. AI literacy (Art 4) softened to "support" rather than guarantee. GPAI obligations not delayed.
  (https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes ; Gibson Dunn 2026-05-27 describes the provisional agreement https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
- Art 50 (https://artificialintelligenceact.eu/article/50/) [doc]: providers of systems that interact with people must make that known unless obvious; synthetic text/audio/image/video marked machine-readable (providers); deployers
  disclose deepfakes and AI-generated text published to inform the public on matters of public interest, **except where text has human review/editorial control with a person holding editorial responsibility**.
- Art 14 (https://artificialintelligenceact.eu/article/14/) [doc]: oversight measures must let the assigned persons (1) understand capacities and limits and monitor/detect anomalies, (2) stay aware of automation bias,
  (3) correctly interpret output, (4) decide not to use / disregard / override / reverse, (5) interrupt via a "stop" button or similar. (Applies to HIGH-RISK systems; use as a design benchmark, not as a claim of applicability.)
- EU-US DPF: General Court upheld it 2025-09-03; appeal Latombe C-703/25 P filed 2025-10-31 and pending; EDPB FAQ (2026-04) says an Art 28 DPA is needed with a US processor regardless of DPF; Norwegian DPA (2026-02-26)
  advises an exit strategy "as there may be no transition period". (https://www.edpb.europa.eu/system/files/2026-04/edpb_dpf_faq-for-businesses_v2_en.pdf ; EUR-Lex OJ C 2025/6610) [doc/3p]
  => local-first with BYOK sidesteps most transfer questions for the free product; the hosted control plane later must offer an EU region and SCCs fallback.
- Colorado/California AI Act "packs" exist in ServiceNow's catalogue (June 2026) but I did not verify those statutes' current effective dates. UNVERIFIED.

### B4. What auditors and ITGC reviewers look for in automations (RPA/bot precedent, applies to agent workflows by analogy [inf])
- Protiviti (https://blog.protiviti.com/2018/10/31/building-bot-boundaries-rpa-controls-in-sox-systems/), IMA RPA controls report, ISACA 2020, LegalClarity 2025-12-07 (3p, weaker): bots need (1) unique non-shared identity per production bot with least privilege,
  credentials in a vault, (2) change management: documented, tested in non-production, formally approved, **developer cannot be the person who migrates to production** (SoD), (3) immutable audit trail: bot ID, start/stop,
  inputs, outputs, errors, retention per mandate (LegalClarity cites 7 years for SOX financial records, unverified), (4) quarterly access reviews of who can trigger the bot AND what the bot can reach, (5) documentation of exception handling,
  (6) "SoD conflicts could arise when ... the initiator and the reviewer" can both trigger the bot: the reviewer must not be able to start the transaction the reviewer approves. External auditors sample change requests and
  trace sampled transactions through the bot's log.
  => this is the checklist the "auditor-answerable evidence" claim must satisfy. Foundry's version hash + CAS activation + hash-chained journal + approver identity covers (2),(3) and part of (6); (1) and (4) need identity work (principal model, patch 0001 in D15).

### B5. How products express "approval needed" (primary docs)
- ServiceNow Flow Designer "Ask for Approval" (https://www.servicenow.com/docs/r/build-workflows/workflow-studio/ask-approval-flow-designer.html) [doc]: inputs Record, Approval Reason (stored for audit), Rules, Due Date; rule types "Anyone approves / All users
  approve / All responded and anyone approves / % of users approve / # of users approve" with OR/AND; **every action needs an Approve rule AND a Reject rule (or else all-rejected returns "cancelled", not "rejected")**; **"If no approver
  approves or rejects, the action remains in the Waiting state forever. Create a Due Date ... "**; output states Not Yet Requested / Requested / Approved / Rejected / Cancelled / No Longer Required / Skipped; inactive approvers still get records by default;
  classic approvals at All > System Policy > Rules > Approvals; users see "My Approvals" (Self-Service) with State, Approving (the record), Comments, and an "Approval Summarizer" formatter.
- Workday (https://doc.workday.com/admin-guide/en-us/manage-workday/business-processes/business-process-step-types/dan1370797855296.html and delegation pages) [doc]: Approval step approves/denies the whole business process; approver = role-based **security group** in the
  Group column; "Maintain Advanced Routing" with **Exclude Initiator** and **Exclude Prior Approvers**; comments can be required; delegation via "Manage Delegations" itself runs a "Request Delegation Change" business process (so delegation can need approval);
  with routing restrictions on, **a delegate who approves counts as a prior approver** (prevents the delegate also acting on later parallel steps); fall back to "Alternate Delegate".
- Microsoft 365 admin center agent governance (https://learn.microsoft.com/en-us/microsoft-365/admin/manage/agent-actions , exercise page) [doc]: Agents > All agents > **Requests** tab; states "Pending review / Pending activation / Pending update";
  tabs **Details / Data & Tools / Security / Permissions** per agent; actions Publish to store, Activate (scoped to users/groups/everyone), Block/Unblock; "approve ... and scope its audience ... to ensure a controlled rollout"; separate rows for
  "Shared by creator" vs "Published by your org".
- Entra access packages for agent identities [doc]: time-bound; sponsor notified before expiry; extension request re-triggers approval.
- Okta access requests with SoD (https://support.okta.com/help/s/article/oig-access-requests-and-workflows-checking-sod-in-an-access-request) [doc]: SoD analysis is posted INTO the request body before the reviewer opens it so "the reviewer has enough
  information to decide"; requests can be raised from web UI, Slack, Teams or API.
- SailPoint ISC community threads (2024-2025) [3p, vendor community]: preventive SoD evaluates access already provisioned, NOT conflicting items requested together (in flight); a detected violation does not stop approval unless "prevent/cancel" is switched on;
  a new policy setting "Violation Prevent" cancels the request, emails the requester with the policy name and records audit evidence. (https://developer.sailpoint.com/discuss/t/new-capability-violation-prevent-setting-in-sod-policy-definition/222420)
- Finance tools (Ramp 2026-09-25, BILL, Brex/Ramp comparison via Stackrate and Indinero 2026-08-20) [mkt/3p]: approval chains by amount, entity, vendor, department; role-based approvers (vendor owner, department owner, manager, manager's manager);
  backup approver per tier; escalation after 24/48h; mobile approval; "design the approval matrix before you configure it ... start with two levels and add friction only where a real control gap exists"; Ramp Bill Pay escalation is a reminder
  to the same person, not a reroute (per the Stackrate summary; unverified).
- Claude Code string seen in docs: "Your organization requires approval for this tool." for connector tools set to `ask`; `blocked` tools are filtered out before the model sees them. [doc]

### B6. How products express "rules that cannot be changed" (primary docs)
- Terraform / HCP policy enforcement (https://developer.hashicorp.com/terraform/cloud-docs/policy-enforcement/manage-policy-sets) [doc]: **Advisory** (failures shown in UI, never stop the run) / **Soft mandatory** or "Mandatory overridable"
  (stops the run; named teams with "Manage Policy Overrides" may override) / **Hard mandatory** or "Mandatory" ("Terraform does not apply runs until a user fixes the issue"); a policy-set option "This policy set can be overridden in the event of
  mandatory failures" takes precedence over each policy's level. => a 3-level vocabulary that non-engineers grasp: tell me / stop unless someone named allows / stop, full stop.
- GitHub rulesets (https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets ; enforcement statuses and bypass list as summarised by a docs mirror, so [3p]):
  enforcement **Active / Evaluate / Disabled**; "Evaluate" logs what WOULD have been blocked in "Rule Insights" (recommended 7-14 days before Active); bypass list with "Always allow" vs "For pull requests only" (bypass preserves auditability);
  rule "Require approval of the most recent reviewable push" (a new push voids earlier approvals) and "Dismiss stale approvals"; official docs confirm approvals are dismissed if the merge base changes.
- GitHub enterprise policies (https://docs.github.com/en/enterprise-cloud@latest/admin/policies/enforcing-policies-for-your-enterprise/about-enterprise-policies ; Copilot policies https://docs.github.com/en/copilot/concepts/enterprise/policies) [doc]: per policy the enterprise either
  "choose[s] to not enforce ... which allows organization owners to configure" or enforces for all orgs; Copilot: "Let organizations decide"; Nov 2025 changelog: Unconfigured enterprise policy now defaults org policy to **Disabled** ("policies remain restricted unless
  the enterprise admin explicitly enables or delegates"); "once an admin sets a policy to Disabled, it cannot be changed at the organization level again unless the enterprise policy is updated"; most-restrictive wins across enterprises; "audit log to monitor changes to policy settings"; **policy drift** is named as a risk.
- Google Admin console OU inheritance [doc]: setting shows **Inherited** or **Locally applied**; button "Override" and "Inherit"; "Many settings allow you to enforce a policy that users cannot change or set a default that users can change";
  group settings override OUs; changes take up to 24 h. (https://support.google.com/chrome/a/answer/2657289)
- AWS SCPs (https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) [doc]: guardrail = maximum permissions; "If a permission is blocked at any level above the account ... a user ... can't use that permission, even if the account administrator attaches AdministratorAccess";
  applies to the member account's root user; does NOT apply to the management account (an honest scope gap to copy: say what the rule does not cover).
- Azure locks and Policy (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources ; denyAction): "The lock overrides any user permissions"; portal names Delete and Read-only (CLI CanNotDelete / ReadOnly); locks apply to control plane not data plane;
  denied request returns 403 and the portal shows "a deployment status that was prevented by the policy assignment"; lockout-prevention exemptions listed explicitly.
- SailPoint "Violation Prevent": a rule that cancels, tells the requester which policy and who owns it, and records evidence (above).
- Claude Code managed settings (https://code.claude.com/docs/en/managed-mcp) [doc]: precedence "managed > local > project > user"; array settings merge so "developers can extend managed lists but not remove from them" (settings page); deny always beats allow;
  Anthropic itself warns: "When a server silently disappears, the user gets no signal that policy is the reason, so tell affected users which servers are blocked".
- OWASP MCP guidance (https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html ; https://owasp.org/projects/mcp-top-10) [doc]: pin a hash of the FULL tool definition including annotations (a flipped readOnlyHint/destructiveHint changes client approval
  behaviour with no visible description change); annotations are hints not enforcement; show full call parameters, never auto-approve; MCP09 "Shadow MCP servers" and MCP08 "Lack of audit and telemetry" are listed risks; "Never let an agent approve or merge its own pull requests" (OWASP DevSecOps).

### B7. Procurement paths and marketplaces  [doc/mkt]
- AWS Marketplace AI Agents & Tools (https://docs.aws.amazon.com/marketplace/latest/buyerguide/buyer-ai-agents-products.html): categories include "Agent tools ... MCP servers, knowledge bases, guardrails"; deployment API / container / SaaS; "Agent Mode" conversational
  procurement (re:Invent 2025); express private offers generated "in minutes"; Forrester-commissioned composite claims 60% faster procurement (vendor-commissioned).
- Google Cloud Marketplace (2025-10-14): agent listings via A2A Agent Card JSON link; employees "request that their IT administrator procure the agents" and add them to the Agent Gallery; administrators manage which agents can be deployed.
- Microsoft Marketplace: self-serve, partner, or private offers; Microsoft manages billing.
- Implication [inf]: when a paid control plane exists, an enterprise buyer will want to spend committed cloud dollars; the MCP/Agent-Card listing is the "catalog entry" the IT admin browses. D13 forbids publishing now; this is a design-time note only.
- Okta OIN (https://developer.okta.com/docs/guides/): SSO and SCIM integrations published to the OIN catalog; WorkOS-style vendors let a tiny SaaS vendor look "enterprise-ready" without building SAML/SCIM.
- Enquiry Tracker (public help doc 2026-09-08) shows the WorkOS flow from the buyer's side: request SSO -> email "Verify Your Domain" (DNS record "usually handled by whoever manages your website or email, often your IT provider") -> second email to the Admin Portal -> pick IdP
  (Entra, Okta, Google Workspace) -> "test signing in ... before making it available to all staff; test with an account that isn't your only admin login". GetWhys docs are the counter-example: SSO "is not a fully self-serve toggle": email the vendor, wait for SP details,
  exchange metadata by email.

### B8. IT-admin mechanics for provisioning, from the admin's side  [doc]
- Entra SCIM to a non-gallery app (https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups, 2026-09-15): admin pastes **Tenant URL** and optional **Secret Token**, presses **Test Connection**
  (Entra queries a random GUID user and expects HTTP 200 with an empty ListResponse), assigns "Users and groups" (provisioning only touches assigned users when scope is "Sync only assigned users and groups"), runs **Provision on-demand** for one test user,
  turns on notification emails for quarantine and **accidental-deletions prevention**, then watches **Provisioning logs**; later syncs about every 40 minutes. => the IT-admin rhythm is: paste, test, one user, watch the log, then everyone.
- Slack MCP admin (https://slack.com/help/articles/52414744085139) [doc]: "Manage MCP server access" with four scopes (Everyone / Everyone with app access except specific people or groups / Only specific people or groups with app access / No one);
  "Manage individual MCP tool access"; **"Default MCP tool permissions" split into "Read-only tools", "Write tools" and "Other tools"**; manageable only by Org Owners/Admins on Enterprise Grid and Enterprise+ ("not possible ... on Pro, Business+ or Enterprise Select").
  The article says nothing about audit logging for MCP access. (A web-search summary gave "from June 18, 2026"; the article itself gives no date, so treat the date as unverified.)
- MCP extension client matrix (https://modelcontextprotocol.io/extensions/client-matrix) [doc]: lists Claude Desktop, Cursor, VS Code Copilot, ChatGPT etc. but the support cells did not render in my fetch, so **which clients implement Enterprise-Managed Authorization is UNVERIFIED**. Extensions are opt-in on both sides.

### B9. Computer-use, browser and mitigating-control governance (added late)  [doc]
- OpenAI Enterprise "Manage browser and computer use" (https://help.openai.com/en/articles/20001510-manage-browser-and-computer-use-in-your-enterprise-workspace): admins can disable the in-app browser, Browser Use, the Chrome-extension path, or native Computer Use;
  **site rules** with default Allow or Block plus exceptions ("To allow only approved sites, set default to Block and add Allow rules"), per-site controls for access / uploads / downloads / Debug-CDP; "If multiple site rules match, Block takes precedence";
  **"Allowing an operation in a policy does not approve it on a member's behalf"**; approval duration "one turn or one thread"; admins decide whether members may save "Always allow" approvals, per site or across sites; "Members cannot use an approval to override an admin restriction";
  Computer Use **app rules** by macOS bundle identifier / Windows AUMID / signed publisher ("a filename alone is not enough"). OpenAI agent-security page (https://learn.chatgpt.com/docs/enterprise/agent-security): `requirements.toml` fields allowed_approval_policies,
  allowed_approvals_reviewers, auto_review, mcp_servers, plugins, rules, hooks; "Environment overrides ... cannot override orchestrator controls".
- Claude in Chrome (https://support.claude.com/en/articles/13065128-claude-in-chrome-admin-controls ; permissions guide 2026-08-12): allowlist/blocklist; three modes **Manually approve / Automatically approve / Skip all approvals**; a blocked URL shows the banner
  "This site is blocked by your organization's policy" and Claude's tools are disabled on that page; some actions are blocked in every mode (purchases, creating accounts, trades, permanent file deletion). Claude Code managed-mcp: Chrome server is blocked by default when `managed-mcp.json` exists
  unless `allowClaudeInChromeWithManagedMcp` is set from device-level policy only.
- Copilot Studio computer use (https://learn.microsoft.com/en-us/microsoft-copilot-studio/computer-use): per-agent **access control** allowlist for websites and desktop apps; honest limit stated: "Access control only prevents the model from taking actions on websites or applications that aren't in the allow list. It doesn't stop the model from opening them";
  "Enforce HTTPS"; credentials from Azure Key Vault; "Use dedicated machines for computer use", least-privilege account, allowlisted web access.
- SAP Access Control 12.0 SP25 (https://help.sap.com/doc/ca8a8544445e47f5bb0cbc8220ae01b2/12.0.25/en-US/loio8bdd50b2b1f34e049c45ded84788789c_EN.pdf ; https://learning.sap.com/courses/discovering-the-main-functionalities-of-sap-access-control/mitigating-risks_c7455ede-e4fd-4553-b4af-4e0e68cc6bcf):
  the approver opens the SAME Access Request screen the requester used, sees "Stage" of the approval workflow, and a **Risk Violations tab**; admins can require approvers to run risk analysis before approving. Remediate first; "use mitigation as a last resort"; a mitigating control has an owner
  ("Mitigating Approver") and a monitor, is preventive or detective, and assignments need periodic review. Emergency access via **Firefighter IDs** with Reason Code and Activity Report, Transaction Log, and owner review of who may use each ID.
  SAP Community (2014, old): the mitigation-assignment workflow was independent of the access-request workflow, so approval could proceed unless configured to wait: tie the two together on purpose.
  => break-glass in Foundry should copy Firefighter: named emergency identity, reason code required, everything logged, owner reviews afterward.

---------------------------------------------------------------------------------------------------------------------------------

## C. SYNTHESIS FOR FOUNDRY (org / enterprise onboarding and buying). Evidence tags: [E] = fetched evidence above, [I] = my inference or proposal.

### C0. Bottom line
1. **Two buyers, one product.** A solo developer or ops lead adopts bottom-up and never needs IT; the paid control plane is bought by the person who becomes the SECOND AUTHORITY (a rule owner or approver: controller, compliance, ops head) with IT as veto holder. [I, from D2 and Mayfield 2026: LOB leaders are now the largest decision-maker group, 46% vs CIO 38%, [E]]. Design two onboarding tracks that meet in the same console: the Champion track (minutes, no IT) and the Org track (days, gated by IT and security).
2. **Make the data path boring.** The strongest enterprise answer a local-first product can give is "Foundry adds zero new data processors": workflows run on the customer's machine or VPC, models are called through a provider the customer already approved (BYOK; Bedrock/Vertex/Foundry-style routes are how Claude Code inherits an org's existing compliance posture [E: code.claude.com admin-setup]), and Mercury/Inception is the only path that adds a new subprocessor, so it is opt-in per org. [I]
3. **Answer IT's three questions statically.** Okta frames the buyer's mental model as "where are my agents / what can they connect to / what can they do". Competitors answer by discovery and gateways AFTER the fact; Foundry's typed IR (effects lattice, capability contracts, version hash) lets it print the action inventory, the Generate-vs-Execute tier and the SoD check BEFORE anything runs. [E for the questions, I for the Foundry advantage]
4. **Never ask IT for anything until a practiced flow exists.** Then ask in a fixed order, one link per person, each link scoped to ONE intent and expiring (WorkOS Admin Portal pattern [E]); every ask has a default, a test button and a "send this to whoever knows" action.
5. **"Approval needed" and "cannot be changed" must be deterministic, named and explained.** Copy the vocabularies buyers already know: Terraform's advisory / overridable / hard-mandatory, GitHub's Evaluate / Active, Google's Inherited / Locally applied, ServiceNow's Approve AND Reject rules plus a due date, Workday's Exclude Initiator / Exclude Prior Approvers. Add what nobody ships: **counterfactual rule preview from the replayable journal** ("this new rule would have stopped 12 of 340 runs last month"). [I]
6. **Evidence must be shaped like an audit request**, not like a log: unique non-shared identity per workflow, developer != deployer, approval bound to the version, population-and-sample queries, immutable trail with retention, access reviews. [E for the checklist, I for the mapping]

### C1. The buying system: who, when, what they need (use for persona walkthroughs)
| # | Persona | What they are trying to do | What stops them | What Foundry must hand them (no jargon) |
|---|---|---|---|---|
| P1 | Champion (dev, ops lead, analyst) | Get a recurring task automated this week | IT might say no; fear of looking reckless | Working practiced flow in minutes; a one-click "Brief my IT/security team" that makes them look careful |
| P2 | Workspace admin / IT generalist | Decide yes/no/with-conditions in days; keep control of identity, MCP servers, model providers, data location | Unknown tool on laptops; no inventory; no revoke path | Admin setup link (domain, SSO test, groups), allowlist snippets for the clients they manage, one list of every workflow with owner and sponsor, kill switch |
| P3 | Security / GRC reviewer (CISO team) | Evidence pack for their questionnaire, tier the tool, record the decision | Vendor answers that are prose, "contact sales", unclear retention, hidden subprocessors | Trust sheet generated from live config, data-flow diagram, action inventory, subprocessor list with change notices, AI-CAIQ / SIG-Lite prefill with honest "not yet" rows |
| P4 | Rule owner (controller, compliance officer, ops head) | State rules once, know they hold, change them with a trail | Rules live in PDFs; fear the agent will "decide" | Rule-by-example confirmation page, enforcement level per rule, preview of impact before activation, owner shown on every block |
| P5 | Approver (manager, finance lead) | Say yes/no fast, from where they already work | Approvals without context; approvals that wait forever | Approval card in Slack/Teams/email/phone with exact action and evidence; escalation; delegate; proof of who approved |
| P6 | Auditor (internal/external) | Sample changes and transactions, test access | Logs that need an engineer to read | Period evidence pack, population queries, chain verification, read-only auditor seat |
| P7 | Procurement and legal | DPA, subprocessors, SLAs, price predictability | Surprise usage bills, unclear liability | One-page terms summary, per-day token caps, subprocessor notice feed, BYOK no-resale statement |
| P8 | The champion's manager / budget owner | Know what it costs and what risk it carries | Fuzzy value | Run ledger: outcomes, cost per run, who approved, time saved estimate with caveats |
Process facts [E]: AI purchases over $10k take 11+ weeks for 72% of buyers (57% for traditional software); 58% involve 7+ people; security review is the top derailer (58%) (Levelpath 2026-07-01). 70% want to test in their own environment first (Mayfield 2026-01). Tiered
review is the practitioner norm: no integration/no Execute = self-serve approval; integration with internal data = ~2 weeks, dept head + IT security; customer PII, customer-facing Execute or autonomous loop = 4-6 weeks CISO/legal (Rework 2026-05-19, [3p]).
=> Foundry should **state its own tier per workflow** so the org does not default everything to the slowest queue.

### C2. The ask ladder (what to ask, in what order, who answers, with what default)
Rule: ask only what a wrong guess would make harmful (DESIGN U2), and ask it of the person who can answer. Everything before rung 3 is solo and free; rung 3 onward is the Org track.
| Rung | Ask | Who answers | Default / derived from | Why this order [E/I] |
|---|---|---|---|---|
| 0 | "Will this touch your employer's systems or data?" (one yes/no) | Champion | No = personal mode | Shadow-agent discovery (Okta names Claude Code and Cursor via EDR and OAuth grants [E]) will find it anyway; yes triggers the IT brief and "practice-only until your org is registered" |
| 1 | Pick a model route: "your existing provider key" (recommended) or Mercury | Champion | BYOK with key in OS keychain (D11) | Keeps the data path inside an already approved contract; Cursor notes ZDR with BYOK is "subject to your own agreement" [E] |
| 2 | Name the one outside action that matters (who gets contacted, what money moves) | Champion | Practice stand-ins | Matches DESIGN U2, three questions max |
| 3 | "Who else must say yes?" (a person or a role, not a mechanism) | Champion | "Me" (free) | Second authority is the paid line (D2); show it as a feature, never a wall (J9) |
| 4 | Organisation domain; claim it | Admin | Derived from the champion's email | Verified domain is the prerequisite for SSO and for domain capture (WorkOS: DNS TXT, "usually handled by whoever manages your website or email" [E]) |
| 5 | Connect the identity provider (SSO), test sign-in with a non-admin account | IT | Provider picked from list (Okta, Entra, Google Workspace) with a guided page | One scoped, expiring link; "Test sign-in" button; WorkOS pattern [E] |
| 6 | Directory groups to roles (deprovisioning, approver groups) | IT | Import groups; propose three roles: Builder, Approver, Auditor | Do not make people type org charts; Ramp-style roles derive from manager chain and department [3p] |
| 7 | Approval matrix for the first 1-3 actions: who approves what, above what amount, with backup and escalation | Rule owner / manager | Two levels only; backup = manager's manager; escalate at 24h, fail closed at 72h | "Start with two levels and add friction only where a real control gap exists" (Indinero 2026) [3p]; Workday/ServiceNow fields |
| 8 | Rule owners and the rules that must never change (in plain words, confirmed by example) | Rule owner | Starter rulebook per pack (e.g. AP exception) | Constitution layers; "Hard / Needs a named override / Tell me only" levels |
| 9 | Which model providers and models are allowed; are non-zero-retention models allowed | IT/security | Off for any provider that retains; per-provider opt-in | Notion: non-ZDR models "off by default and the workspace owner must opt in"; Zapier: new AI provider "must be enabled by a company administrator" [E] |
| 10 | Data location for run records and logs (this machine / org VPC / region) | IT | This machine (free) | Slack/Notion/Atlassian pin at-rest data but name what stays outside; Atlassian requires integrations to honour the host's region [E] |
| 11 | Where audit events go (file, SIEM: Splunk/Datadog/S3) and retention | IT/GRC | Local hash-chained journal; 13 months | Zapier/Cursor/Workato stream to SIEM; WorkOS defaults to 30 days and cannot reduce retention [E] |
| 12 | Which MCP clients are allowed to talk to Foundry (Claude Code, Cursor, Codex) and how it is pinned | IT | Pinned command/URL snippet generated for each | `managed-mcp.json`, Cursor `mcpAllowlist`, GitHub `managed-settings.json` (serverName is not a security control) [E] |
| 13 | Sponsor (business owner) and owner (technical) for every workflow; review cadence | Champion + manager | Champion = owner; manager = sponsor | Entra Agent ID requires at least one sponsor; Okta recommends two owners [E] |
| 14 | Pilot terms: which workflows, which window, success checks | Champion + IT | 30 days, practice world + "Evaluate mode" on real inputs, no outside effects | 70% want to test in their own environment; GitHub recommends 7-14 days in Evaluate before Active [E] |
Things NOT to ask: SAML field names (the page owns them), regions the org has not chosen elsewhere, anything derivable from the IdP, a "security questionnaire" before rung 14 (hand over the generated pack instead). [I]

### C3. The IT-admin handoff: three scoped "setup links" (local now, hosted later)
Pattern: a link carries ONE intent, expires, names who it is for, shows a test, and reports back to the champion (WorkOS: intents sso / dsync / audit_logs / log_streams / domain_verification / certificate_renewal; 30 days or until done; IT contact collected for cert-expiry mail) [E].
1. **Identity link** (IT): domain verification then SSO then groups; "Test sign-in" and "Provision one user on demand" (Entra rhythm: paste, test, one user, watch log, then everyone) [E]; "accidental deletions prevention" ON by default.
2. **Security link** (security reviewer): the trust sheet, data-flow diagram, action inventory, model/provider list, AI-CAIQ and SIG-Lite prefill, the MCP allowlist snippets, the tool-manifest hash. No account needed to read; NDA click only for items that need it (Zapier/Vanta pattern) [E].
3. **Rule link** (rule owner): shows each rule as a sentence plus six auto-generated example cases (allowed / blocked / needs approval) from the practice world; the owner presses "Yes, that is my rule" or edits the example; confirmation is recorded with their identity. [I; built on intent-recovery work]
Local-first free product (D10, D13: nothing is published): the links are LOCAL pages and downloadable files the champion forwards; the hosted version of the same screens is a later control-plane feature. [I]

### C4. The security-review kit Foundry can GENERATE from its own runtime (differentiator; all [I] built on [E] asks)
Buyers' own checklists (GreenHat 2026-06-15, OCSA 2026-08-04, Coworker 2026-10-14, Lorikeet) converge on ten items. Foundry should emit each from facts, not prose:
1. Data-flow diagram generated from actual config: which fields go to which provider, what stays local. BYOK vs Mercury drawn differently.
2. "No training" and "retention" as TWO separate claims per provider path (OCSA: they are separate claims); shows ZDR yes/no/unknown per configured model.
3. Subprocessor list = configured providers only; with a feed and a 14-day notice convention (Zapier posts ~14 days before effect) [E]. Free local mode: Foundry the vendor is not a subprocessor.
4. **Action inventory**: every outside action each workflow can take, with credential, scope, amount and frequency caps, derived from the IR effects. (CISO item 7 in Lorikeet.)
5. **Tier**: Generate / Draft / Execute-reversible / Execute-irreversible / Spends money / Contacts customers; maps to the 3-tier gates enterprises already run.
6. Audit trail description and sample export; hash-chain verification command (`verify-run`, anchors).
7. Kill switch at workflow, connection and whole-org level, and rollback to the previous version with who/when (Lorikeet's three levels; Okta "Universal Logout for AI Agents") [E].
8. Prompt-injection posture: untrusted input is data, outside actions require approval bound to tool+args+hash; show the red-team results when they exist; say "not yet" when they do not (OWASP: do not rely on the model to detect injection [E]).
9. MCP server profile: pinned tool-definition hash (OWASP: hash the whole definition including annotations), person-only tools marked, start read-only, stable `serverCommand`/`serverUrl` for allowlists, no `@latest`. [E/I]
10. Honest assurance statement: what is certified (nothing, today), what is committed with dates, what is self-assessed (AI-CAIQ v1.1 has 320 questions; AICM 247 controls, machine-readable OSCAL bundle exists [E]); AIUC-1 states open-weight and model-change retest controls (C002.4) [E] which Foundry's "practice per version" already approximates.
Note [I]: a local-first free product holds no customer data, so SOC 2 is not the gate for the free product. It becomes the gate when a HOSTED control plane holds approval identities and evidence. Plan: Type 1 plus pen test letter plus "bridge pack" before the first hosted pilot; $10k-$40k and 6-12 weeks with automation, Type 2 needs a 3-12 month window [3p, consistent across 5 sources].

### C5. "Approval needed": the spec Foundry should follow (every point has a precedent)
1. **One queue, plain states.** Pending review / Pending activation / Pending update (M365 [E]) are the right granularity; Foundry adds "Waiting on you" vs "Waiting on Finance lead". Requester can SEE status in-product (Entra gives only email: an anti-pattern [E]).
2. **The card carries the evidence**, not a summary: exact recipient, amount, text, the rule that triggered approval, the practice-run proof, what happens if nobody answers. OWASP: "show exact commands and tool arguments in the approval prompt, not a summary"; Okta posts the SoD result INTO the request before the reviewer opens it [E].
3. **Every approval has an Approve rule, a Reject rule and a due date**; expiry is a decision (escalate, or fail closed) and is recorded. ServiceNow: no due date = "Waiting state forever"; approve-only rules with all-reject yields "cancelled" not "rejected" [E].
4. **Exclusions are first-class**: exclude initiator, exclude prior approvers; a delegate who approves counts as a prior approver (Workday) [E]. Delegation itself can require approval (Workday "Request Delegation Change") [E].
5. **Roles, not people**, resolved at decision time from the directory: vendor owner, department owner, manager, manager's manager (Ramp) [3p]; backup per tier; mobile; escalation timers 24h/48h (BILL/Brex) [mkt].
6. **Bind to the version**: a new push voids earlier approvals ("Require approval of the most recent reviewable push", GitHub) [E] = Foundry's CAS and version-bound approval.
7. **Go where the approver lives**: Slack/Teams/email/phone; Workato routes HITL to Teams or Slack; Okta requests can be raised in Slack/Teams [E].
8. **Time-bound standing approvals** with sponsor renewal: Entra access packages (expiry notice to sponsor; extension re-triggers approval) [E]. Maps to D15 standing approvals: "approve this kind of refund up to $200 for 90 days; sample 5%; renew or lapse".
9. **HITL vs HOTL by risk** (Tines): irreversible/high-impact = HITL; routine = HOTL "only counts as oversight when monitoring and intervention paths are operationally real" so HOTL must come with sampling, a reviewer, and metrics (response time, override rate). [E]
10. **Anti-fatigue**: shrink prompts by allowlisting low-risk actions and sandboxing, not by approving everything (OWASP) [E]. Show approval load per approver so rule owners can tune.
11. **Self-approval is impossible by construction** and says why: "You built this version, so a different person must turn it on" (Windmill precedent in TEARDOWN [E]; RPA SoD [E]).
12. **Model change is a change request.** Swapping Haiku for Mercury or changing a provider creates a new version that needs re-practice and, if rules say so, re-approval (AIUC-1 C002.4: re-run safety evals after weights/engine change [E]; Zapier admin-enabled new providers [E]). [I]

### C6. "Rules that cannot be changed": the spec
Vocabulary to adopt [E where cited]:
- **Level of force per rule**: "Tell me" (advisory) / "Stop unless a named person overrides" (soft-mandatory; override permission is its own grant and every override is logged) / "Stop, full stop" (hard-mandatory). Terraform's three levels, plus the policy-set toggle "can be overridden in the event of mandatory failures".
- **Rollout mode**: "Preview (Evaluate)" then "On (Active)"; Evaluate records what would have been blocked. GitHub recommends 7-14 days. **Foundry can do better: replay the journal.** "This rule would have stopped 12 of 340 runs in the last 30 days" at the moment of drafting. [I]
- **Where a rule comes from, in the UI**: a "Set by" chip with layer and owner (Regulation > Org policy > Entity rule > Process > Workflow), "Locked here / Inherited / Narrowed locally" (Google Admin: Inherited vs Locally applied; GitHub "Let organizations decide" vs enforce; Copilot: unconfigured enterprise policy now defaults the org to Disabled, and "once Disabled it cannot be changed at the org level again") [E]. Lower layers may only NARROW. A lower layer's attempt to widen shows "Not allowed here. Rule owner: Controller. Request a change".
- **Deny always wins**, evaluated before allow; rule not overridable by the workflow author even with admin rights (AWS SCP applies to the account root user; Azure lock overrides user permissions; Claude Code deny beats allow and managed arrays can be extended but not reduced) [E]. Say what the rule does NOT cover (SCP does not apply to the management account; Azure locks cover the control plane not the data plane) [E]: honesty about scope is part of trust.
- **Block messages explain**: which rule, who owns it, what to do next (SailPoint "Violation Prevent": cancel, email the requester with policy name and owner, record audit evidence; Google: custom message on denied app) [E]. Never silent: Anthropic's own docs warn that a silently disappearing blocked server "gives no signal that policy is the reason" [E].
- **Bypass is a recorded, scoped exception**, not a hole: "bypass for pull requests only" (still goes through the audited path) [E-mirror]. Foundry equivalent: "break-glass approval by two named people, expires in 4 hours, shown on the audit pack".
- **Changing a rule is itself an approval** by the authority at that layer, with proposer != approver (already in the constitution registry gate: proposer role, approver holds `controller`, approver != proposer, approval before activation [repo OT-0]); show the same card as any other approval.
- **Not by instruction**: rules are enforced at the effect port, never by telling the model (Cursor: "Steering belongs with [deterministic controls], never instead of them"; rules files are "suggestions") [E].
- **Preventive checks must see the whole graph**: SailPoint's preventive SoD only evaluates provisioned access, so two conflicting entitlements requested together slip through; and approvers may approve despite a warning unless "prevent" is on [E, vendor-community]. Foundry checks the whole workflow's effect and approval graph against the role matrix at proposal time, then again at run time against the actual approver identity. [I]

### C7. AI-specific governance statements and controls to ship (what security and legal ask now)
1. **Model usage ledger** per run: model id and version, provider, tokens, who paid (BYOK/subscription), region if known, retention class. (Everything on the questionnaires: OCSA, Captain Compliance, Lorikeet.) [E/I]
2. **Per-model retention class** shown in the model picker: ZDR / provider retains <= N days / unknown; non-ZDR off by default for org mode (Notion) [E].
3. **AI feature switches** with four audiences: No one / Only specific people and groups / Everyone except / Everyone (Slack AI) [E]. Never opt-out-by-email (Slack 2024 backlash) [3p].
4. **Human oversight map** (design benchmark, not a legal claim): Art 14(4) asks overseers to be able to (a) understand capacities and limits and detect anomalies, (b) stay aware of automation bias, (c) interpret output, (d) override or reverse, (e) stop the system [E]. Foundry features: plain-words run explanation and `uncertain` state; approval card shows evidence not just a recommendation; "Reject" and "Edit" first-class; kill switch. Publish this table as "How Foundry supports human oversight" with an explicit "not legal advice; Art 14 applies to high-risk systems" line. [I]
5. **Transparency (Art 50, applies since 2026-08-02)**: workflows that talk to people (email, chat, calls) should include an AI-disclosure default that an org can edit but not silently remove; synthetic text marking needs thought; human review/editorial responsibility is a statutory exception for public-interest text [E]. Offer a "Disclosure" setting per outbound channel with default ON for external recipients. [I]
6. **High-risk guard**: Annex III uses (employment, credit, essential services, etc.) become obligations 2027-12-02 [E]. Builder should flag "this workflow influences hiring/credit/benefits decisions about people" and route to human decision + extra evidence, rather than refuse. [I]
7. **Data residency honesty**: free mode = "your machine"; list what leaves (model calls) and where; GitHub does not notify on transfers and Slack/Notion exclude profiles/usage from region, so the benchmark for honesty is to list those exclusions yourself [E].
8. **Subprocessor and model-provider change feed** with effective date and "admin must enable" for new AI providers (Zapier) [E].
9. **Transfers**: DPF upheld at General Court (2025-09-03) but appealed; EDPB says a processor DPA is needed regardless; prepare SCC fallback for the hosted plane [E].

### C8. Line-of-business implications for D2 and the open questions in OPEN-CORE-AND-INVARIANTS §5
- **SSO free (D2)** is supported by the market evidence: sso.tax and the SCIM Tax Index show most vendors gate identity features (178 of 267 tracked vendors gate SCIM behind a paid tier; 68 offer none; the steepest taxes are 3x-79x per seat) [E]. Cursor gates SCIM and audit logs to Enterprise, Slack gates MCP server/tool controls to Enterprise Grid and Enterprise+, and Zapier lists SCIM on its Enterprise page (plan gating for Zapier not confirmed) [E].
- **Proposal [I, owner decision needed]:** keep SSO and SCIM *deprovisioning* (leaver loses access) free in the free product because it is a security floor and a trust signal; make **group-to-role mapping, approver routing by directory role, SIEM streaming, rule layers, period evidence packs and read-only auditor seats** part of the paid control plane because each presupposes a second authority. This keeps the line at "second authority", not "security feature".
- Q: "Does gating governance kill bottom-up adoption the way the SSO tax is resented?" Evidence says resentment attaches to gating *basic identity hygiene*; buyers accept paying for governance depth (Workato AHQ federation, ServiceNow AI Control Tower, Okta for AI Agents are all paid) [E/I]. Keep deprovisioning, kill switch and per-workflow audit trail free.
- Q: "Is evidence from replayable journals accepted by auditors as SOX ITGC evidence?" Not answered by any source I found. The ITGC checklist for bots (B4) says what they test: unique identity, SoD in change management, sampled changes and transactions traced through logs, access reviews. A journal can supply the trail; it does not substitute for the access-review and change-approval controls. **Suggested validation:** a 1-day walkthrough with a CPA/ITGC practitioner using the scripted-auditor pack (OT-0). AICPA + AIUC announced (2026-10-19) a joint SOC 2 + AIUC-1 engagement, so CPAs are already building AI-agent assurance programmes [E].
- Q: "Is the org invariant layer table stakes that incumbents give away?" ServiceNow, Okta and Entra sell identity and policy for agents they DISCOVER; none was seen running org rules at the effect port with a counterfactual preview. UNVERIFIED claim of absence; test it against ServiceNow AI Control Tower docs and SAP Access Control mitigating controls before using it in marketing. [I]

### C9. New journeys to add to DESIGN §10 (org track) [I]
- **J11 "My IT team has to say yes"**: champion presses "Brief my IT/security team"; gets a link or a zip: trust sheet, data-flow diagram, action inventory, allowlist snippets, tier; IT replies with conditions (e.g. "only Bedrock route, no Mercury, SIEM stream") which the admin page applies; champion sees status (never the Entra dead end).
- **J12 "Controller states a rule that must never change"**: rule link, six example cases, confirm, preview impact on last 30 days, set force level, activate; later someone tries to widen it at a lower layer and sees owner + request-change.
- **J13 "Auditor arrives"**: read-only auditor seat; population query (all runs that moved money > X in Q3), sample of 25, trace each to approval, version, approver identity, rule version in force; chain verification.
- **J14 "Model or provider changes"**: admin allows a new provider; workflows pinned to old model keep running; new version practiced; approvers renew; subprocessor feed updated.
- **J15 "Something went wrong at 3 a.m."** (org): kill switch at three levels, who got paged, what had and had not happened, rollback with who/when.
- **J16 "Leaver"**: user deprovisioned in IdP; their approvals lapse to the role; their workflows show "no owner" in the registry until a sponsor is named (M365 shows "Agents without owners") [E].

### C10. Anti-patterns collected (each with its source)
See the structured result; short list: dead-end consent wall (Entra "Need admin approval", no status); silent policy removal; "contact us to enable SSO" and opt-out-by-email; SSO/SCIM/audit-log tax; approval with no context or no due date; approve-only rules; approver who can approve own work or a delegate who defeats SoD; preventive SoD that ignores in-flight combinations and approvals that proceed despite a warning; rules enforced by prompt; over-engineered approval chains for small teams; "compliant" used for "certified"; "not used for training" conflated with "zero retention"; trust centres that say nothing until a sales call; data residency claims that omit what stays out; surprise subprocessor additions; approving everything to avoid friction (approval fatigue); Type 1 presented as Type 2.

### C11. Not verified / caveats (read before quoting)
- No screenshots: "observed" means fetched page text of public trust portals and help/admin docs. No accounts created, no forms submitted.
- Anthropic's trust centre was NOT observed (fetch failed; one fetch returned unrelated spam text which I discarded). Cursor's returned only a title.
- Slack's "June 18, 2026" MCP date comes from a search summary; the Slack help article itself gives no date.
- MCP extension client matrix cells did not render: support for Enterprise-Managed Authorization per client is unknown. Claude's connector feature lists Okta only at launch, others "coming soon" [E].
- EU AI Act dates come from law-firm and explainer pages (Orrick 2026-07-29, Gibson Dunn 2026-05-27, others), not the Official Journal. Regulation number 2026/1744 is from a third-party summary. Not legal advice.
- Survey numbers (Mayfield, Levelpath) are vendor/VC surveys: directional only. Cresse Insights and Prosigns PDFs lacked methodology and are not used. The "Uvik/Tines" case study is likely SEO content and is not used for numbers.
- SOC 2 cost/time ranges are consultant blog posts (5 consistent sources) not auditors' price lists.
- ServiceNow, Workday and SAP UI behaviour is from documentation and community posts, not live screens (SAP: help.sap.com Access Control 12.0 SP25 describes the Access Request screen with a Risk Violations tab; no screenshots seen).
- GitHub ruleset enforcement-mode and bypass-list wording is from a docs mirror plus official "Evaluate" mentions; re-check on docs.github.com before quoting verbatim.
- Colorado/California AI Act dates not checked.
- Nothing here changes AGENTS.md boundaries: no publishing (D13), no account changes. All Foundry items above are DESIGN PROPOSALS, development-stage, no capability claim.

### C12. Suggested follow-ups for other sweeps / build steps
1. Prototype `app/cli.mjs doctor` additions: detect an org-managed Claude Code policy file at the known system paths (read-only; these hold policy, not credentials) and, if Foundry's pinned command/URL is not allowed, print "Your organisation's policy does not list Foundry. Send this to IT:" plus the snippet. Same for Cursor `mcpAllowlist` and GitHub `managed-settings.json`. (Anthropic's docs say blocked servers vanish silently; Foundry should be the exception.)
2. Add an "IT brief" generator to the local site: trust sheet + data-flow + action inventory + allowlist snippets + tier, from live config and IR; honest "not yet" rows.
3. Add `effects` to approval cards and a tier chip per workflow, derived from the IR; unit-test that the tier can never be lower than the highest-effect step.
4. Replay-based rule preview: reuse the OT-0 observer and journal replay to compute "would have blocked N of M" for a drafted rule (the core of the paid control plane demo).
5. Pin Foundry's MCP tool-manifest hash (full definition incl. annotations) in each release notes and in `doctor` output; re-hash on startup and warn on drift (OWASP rug-pull control).
6. Persona walkthrough script for P1-P8 using C1/C2; evaluate each rung for "can the person answer it without help" and "does a wrong default do harm".

### C13. How org policy meets the node-capability broker (task #80: "nodes get the MCP servers, skills, connections, computer use they need")  [I built on E]
Principle: **the model never sees a capability the org has not approved, and a capability the org has approved is still granted per node, per version, with the narrowest scope.** Evidence for each piece:
1. **Filter at discovery.** ServiceNow: "Unapproved servers are not visible to agent builders"; Claude Code: a `blocked` connector tool is "filtered out before Claude sees it" [E]. So a cheap builder model (Haiku/Mercury) cannot propose, hallucinate or be prompt-injected into an unapproved server it never learned existed.
   Foundry broker = intersection of {capability the node needs, org-approved catalog, effects the workflow declares, rights of the person who owns the workflow}.
2. **Three classes of tool permission by default**: read-only tools allowed, write tools ask, everything else blocked until classified (Slack "Default MCP tool permissions: Read-only tools / Write tools / Other tools"; Anthropic connector per-tool always allow / needs approval / blocked) [E]. Tool annotations are hints, not enforcement (OWASP), so the class is
   Foundry's own classification from the IR effect, pinned by hash. [I]
3. **When a node needs something not approved, make the request for the human.** Existing precedents: Slack "Requests" queue with scopes and per-server allow/deny; Entra "Approval required" with a justification box; Google "Apps pending review"; M365 "Requests" tab [E]. Adaptive step [I]: the broker detects the gap during practice, writes a request containing
   *which node, which server and tools, which data, why, practice evidence that it works against the stand-in, and the narrowest scope that suffices*, routes it to the right admin, and keeps working on stand-ins meanwhile. The requester can see the status (Entra's email-only status is the anti-pattern).
4. **Time-bound grants with a sponsor**: Entra access packages (expiry, sponsor renewal, extension re-triggers approval) [E]. A workflow's connection grants expire with its approval window unless renewed.
5. **Skills and plugins are supply chain.** Cursor: a plugin "can bundle MCP servers, skills, subagents, rules, and hooks, so review what it installs"; Claude Code `strictPluginOnlyCustomization` and `strictKnownMarketplaces` restrict sources; OWASP: pin versions and hash definitions, review rules files like code [E]. Foundry skill packs need a manifest, a pinned hash and a list of what they bundle.
6. **Computer use is its own class with its own switch and a default of Tier 1.** Every vendor ships separate admin controls for it: site/app allowlists (OpenAI, Anthropic, Microsoft), per-action approval modes, "Block takes precedence", approvals that cannot override admin restrictions, and a stated limit (Microsoft: allowlist stops actions, not opening). A Foundry workflow with a CUA node should show "uses the screen of a real machine" in plain words,
   require an allowlist of sites/apps, run on a dedicated or sandboxed profile, and never inherit saved credentials. [I]
7. **Connections and credentials**: Zapier "agents and MCPs never receive raw third-party tokens" (credentials in account-owned connections); Okta: "ephemeral, secretless tokens"; Workato vault integrations; Copilot Studio uses Azure Key Vault for CUA logins [E]. Foundry already stores keys in the OS keychain (D11); node capability grants should hand nodes a *reference* (connection id) never a secret.
8. **Make "what changed" visible**: when an approved MCP server's tool definitions change (name, schema, annotations), the grant lapses to "needs review" (OWASP rug-pull control: hash the full definition including annotations) [E]. [I]
