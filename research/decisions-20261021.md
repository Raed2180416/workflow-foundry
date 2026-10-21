# Decisions taken 2026-10-21 under the owner's blanket permission

**The owner (chat, 2026-10-21):**
- "deeply reason creatively; every compromise has a SOTA fix based on frontier research as of today or OSS as of
  today."
- "Keep efficiency and optimisation costs … at the very core of everything."
- "I give you perms to do whatever you could possibly need."

Each decision below was pending. Each is reversible, and the owner may overturn any of them. None publishes anything,
changes an account, or touches real patients, labs or production systems: those AGENTS.md boundaries are not affected
by a general grant.

| # | Pending question | Decision | Why | Reversal cost |
|---|---|---|---|---|
| D1 | Engine licence | **Apache-2.0** for the engine when it is published. No LICENSE change or publication now | ATTACK-FABLE §1.3–1.4: hard relicensings produced forks and reversals; Apache-2.0 carries a patent grant that enterprises prefer to MIT | none until publication |
| D2 | Open-core line | **Free:** one authority, any complexity, SSO included. **Paid:** the control plane once a workflow involves a second authority (an approver or a rule owner), plus verified packs per outcome | ATTACK-FABLE §1.5, §4.1–4.2; it cannot be gamed by splitting workflows | design-only |
| D3 | SOP-Bench `patient_intake` | **Include as a separately reported row** in phase 2. It is not in the 12-SOP primary set, so the primary comparison stays matched to the dev baseline | Its data is synthetic and LLM-generated. AGENTS.md's boundary is real patient or lab *operations*; no patient, clinician or record is touched | drop the row |
| D4 | Tryton `pip install` for the org twin (OT-1) | **Approved** into an isolated, pinned venv with hashes, outside the repo, when OT-1 starts. No package install hook runs beyond pip's wheel install, with `--only-binary :all:` where possible | Tryton is the lightest executable ERP oracle (ORG-SCALE-SOURCES §1) | delete the venv |
| D5 | Heal-kit exemption list (extends owner decision Q6) | **Accepted** for the `executorModels` and `inception` entries, under the same rule as the Jev entries: the frozen kit never reads them | Without it, policy drift fails 5 heal tests for an unrelated reason | revert one list |
| D6 | OT-0 Opus comparator | **Included** within the $100 cap | The owner's bar names Opus | drop the arm |
| D7 | Workflows (multi-agent orchestration) | **Allowed again** under the grant, but only where fan-out is truly parallel and cheaper in wall time than serial agents. Cost-first: Sonnet for research fan-out, Opus for synthesis and building, Fable only for the hardest reasoning | The efficiency instruction | — |
| D8 | Mercury allowance | Still unknown; there is no usage endpoint. **Spend ≤ 5M Mercury tokens in total** until the owner reports the remaining allowance. Every Mercury run carries a token cap | ~97M of ~100M may already be used | raise the limit |

## Added later on 2026-10-21 (product surface, `research/surface-20261021/DESIGN.md` §11)

| # | Pending question | Decision | Why |
|---|---|---|---|
| D9 | Which coding agents first | **Claude Code first, then Cursor, then Codex**, over MCP | MCP is the two-way integration layer; Claude Code supports per-call user-interaction gating and elicitation |
| D10 | Hosting | **Local-first free product now.** A hosted control plane later as the paid product. No hosted runtime until a customer asks for one | D2; cost |
| D11 | BYOK | **Free and first-class**, with keys in the OS keychain and never in the repo or logs | TEARDOWN lesson 6 |
| D12 | Mercury billing | **BYOK first.** A subscription later, priced on daily token caps | A $0 list price and no usage endpoint |
| D13 | Publishing a package, plugin, `.mcpb` or marketplace entry | **Not taken.** AGENTS.md forbids publishing, and publishing is outward-facing and hard to reverse, so a general grant does not cover it. The owner must say "publish" explicitly | Boundary |
| D14 | n8n terms-only templates | **Local use only, for import-coverage counts.** Never committed or redistributed | Their terms give no open licence |
| D15 | Approval ledger and approver identity (surface patch 0001) | **Scheduled for the 11-04 engine bump**, together with the principal model (OT-0, compromise D1). Not applied while paid runs use the runtime | Avoids changing the runtime under running experiments |
