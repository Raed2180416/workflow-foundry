# devCheck looks (PREREG-AB-v1 §5): aggregates only

devCheck is 60 dev tasks (10 per domain) that no harness was developed on. Per PREREG-AB-v1 §5 the developer sees only
aggregates: per-arm and per-domain pass rate, partial credit, cost. Per-task grades stay sealed in the host-only run
directory. At most 3 harness looks; A0 runs twice (K = 2) for its flip rate. Dev ledger before these looks: about $25
of $60.

| Run | Arm | Look | Strict pass | Partial credit | Cost per task | Finished |
|---|---|---|---|---|---|---|
| `a0-devcheck-1` | A0 Haiku 5.5, no harness | A0 run 1 | **13/60 (21.7%)** | 0.555 | $0.012 | 2026-10-21T16:38Z |
| `a1c-devcheck-1` | A1-C Haiku 5.5 (a1c-v1) | look 1 | **20/60 (33.3%)** | 0.734 | $0.030 | 2026-10-21T17:08Z |
| `a1-devcheck-1` | A1 Haiku 5.5 (prose harness a1-v1) | look 2 **20/60 (33.3%)** | 0.615 | $0.015 | 2026-10-21T17:30Z |

**By domain (strict pass):**

| Domain | A0 run 1 | A1-C look 1 | A1 look 2 |
|---|---|---|---|
| sales | 0.0 | 0.2 | 0.3 |
| marketing | 0.2 | 0.3 | 0.5 |
| operations | 0.3 | 0.4 | 0.3 |
| support | 0.3 | 0.1 | 0.3 |
| finance | 0.2 | 0.4 | 0.4 |
| hr | 0.3 | 0.6 | 0.2 |

**Reading (development evidence, out of sample for the harness).**
- A1-C's in-sample dev60 rate (20/60, 33.3%) **held on devCheck** (20/60).
- A1-C is +11.7 points over A0 run 1, above G1's +3. G1 is a *paired* criterion; the runner's paired statistic is not
  yet reported here, so G1 is not yet read. Support is the one domain where A1-C is below A0.
- A0 run 1 here (21.7%) is above A0 on dev60 (15.0%): devCheck may be easier than dev60, or A0 flipped. A0 run 2 (queued)
  measures the flip rate.
- **A1 (prose) ties A1-C on strict pass (20/60 each) at half the cost** ($0.015 vs $0.030 per task); A1-C has the higher partial credit (0.734 vs 0.615). Under the frozen selection rule (highest devCheck strict pass; ties to the lower mean cost) the freeze candidate today is **A1**, not A1-C. One look (look 3) remains, reserved for A1-C v2.
- The domains move in opposite directions (A1-C: hr 0.6, support 0.1; A1: marketing 0.5, hr 0.2) at n = 10 per domain, which is within noise.
- 17:30Z: the disk filled briefly (test temp directories); the chain skipped its last three runs, now relaunched (ab-chain4): Mercury A1-C on dev60, A0 run 2, Sonnet alone on devCheck.
- Remaining looks queued: A1 (prose harness) look 2; then Mercury A1-C on dev60; A0 run 2; Sonnet alone on devCheck
  (informational: the owner's bar).
