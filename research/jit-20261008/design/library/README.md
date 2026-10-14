# Universal workflow library — design

Design of the library a cheap Haiku constructor builds workflows from (2026-10-09; $0, no model or Jev calls). Read in
this order: [`LIBRARY.md`](LIBRARY.md) is the design itself — the five layers L0–L4, entry schemas, the index and the
code-first retrieval with Jev ranking and gating, the constructor loop with its hard per-call context budget, the
composition checker, and the lifecycle construct → shadow → keep → reuse → heal → retire, including the retroactive
sweep after a latent defect. [`L0-VOCABULARY.md`](L0-VOCABULARY.md) is the closed 30-construct vocabulary card as it
sits in the compiler prompt. [`L1-PATTERNS.md`](L1-PATTERNS.md) is the corpus-derived catalog of 54 patterns (coverage,
refusals, 12 full cards, 42 compact cards, composition and buildability tiers, evidence grades), backed by the census
tooling in `tools/` (`pattern-census.mjs`, `render-tables.mjs`, `render-evidence.mjs`) and its outputs in `out/`.
**Coverage:** on 60 hand-audited items L0 + L1 explain **88.4% of the 1,559 corpus workflows (Wilson 75.0–95.1%)**,
reading a Node-RED dashboard app as a refusal, or 96.1% (85.2–99.1%) reading it as explained
([`AUDIT-L1.md`](AUDIT-L1.md) §5; owner decision PAUSE §5.8). The census's 97.8% was the share it does not refuse, not
coverage; after revision 1 (six detectors removed, P37 split, dashboard refusal by criterion) it is a candidate
generator at 96.9% not refused and is never quoted as coverage.
[`JEV-PORTS.md`](JEV-PORTS.md) gives the exact Jev requests for each port (applicability, pattern choice, slot
completeness, risk class, quarantined read, failure class), their baselines, outcome labels, the wrong-reuse kill
threshold and the calibration record. [`LIBRARY-TESTS.md`](LIBRARY-TESTS.md) says how each claim is tested: $0
mechanical tests T1–T10 first, then the research tests L1–L8 with arms, oracles, decision rules, seeds and costs.
[`BUILD-ORDER.md`](BUILD-ORDER.md) orders the build ($0 steps, then paid steps), ties it to the W-bed rungs R0–R8 and
FLOW-V3, lists the engine nodes the library depends on, and records the objections.
