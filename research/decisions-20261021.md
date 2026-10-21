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
