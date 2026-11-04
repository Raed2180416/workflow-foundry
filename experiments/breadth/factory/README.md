# Family factory prototype for node V (Tier-1 item T1-4)

PLAN §6 (`research/breadth-20261021/PLAN.md`). Three recurring enterprise-stream families built from one `family.spec`
each, with N-version truth, generated controls, oracle-validity gates, a frozen sealed split and a runner for the paid
arms. Everything here is $0; no model was called. Results and evidence: `research/breadth-20261021/factory/README.md`.

## Layout

| Path | What |
|---|---|
| `experiments/autobench/abr/lib/{common,host}.py` | B0: the shared helpers the 12 AB-R families carried as identical copies (`abr/tools/b0_extract.py`) |
| `experiments/autobench/abr/lib/factory/` | the factory: `spec.py` (family.spec -> POLICY.md + compiled.json, G0 lint), `genbase.py` + `world.py` + `clock.py` (generator scaffolding, AutomationBench world shape, pure clock engine), `store.py` (WorldStore = abr-apply, ToolStore = the app's own model path), `oracle.py`, `harness.py`, `controls.py`, `gates.py` (G0-G12), `intake.py` (messy requests), `holidays.json` (frozen, from holidays 0.107) |
| `experiments/autobench/families/abr-{reg-incident-clock,itsm-queue,p2p-audit}/` | per family: `family.spec.json` (the spec), `POLICY.md` + `compiled.json` (compiled), `model.py` (generator + truth engine over latent state), `reference.py` (observable-only reference, own parsing; switches build the controls), `naive.py` (<= 40-line control), `phrasebank.json` (messy intake) |
| `experiments/breadth/factory/` | `split.py` (frozen sealed split rule), `seal.py` (sealed streams host-only + hashes), `run.mjs` (arms runner), `step.py` (host-side steps), `builder-kit.md` (F-H / wf-O kit), `baselines.sh`, `params/` (D16 parameter extraction), `test/` |
| `experiments/autobench/abr/tools/` | `b0_extract.py`, `b0_equivalence.py`, `import_check.py`, `b4_distinct.py`, `holiday_table.py` |

## $0 commands

```sh
PY=corpus/AutomationBench/.venv/bin/python          # needed for G1 round trip, G10 ab_disagree, G12 parity and --mode ab
F=experiments/autobench/abr/lib/factory
python3 -I $F/spec.py experiments/autobench/families/abr-p2p-audit --check     # compile check + G0 static lint
python3 -I $F/harness.py --family abr-p2p-audit run --solver reference --seeds 2113-2116 [--failures]
python3 -I $F/harness.py --family abr-p2p-audit run --solver trap_no_sod --seeds 2113    # any control in compiled.json
$PY -I -B $F/gates.py --family abr-itsm-queue [--only G2,G5] --out DIR                  # G0-G12; G8/G9/G11 print commands
python3 -I $F/intake.py lint --family abr-itsm-queue                                    # answerability + classification
python3 -I experiments/breadth/factory/split.py                                         # the frozen split (SPLIT.json)
python3 -I experiments/breadth/factory/seal.py --verify                                 # sealed hashes reproduce
bash experiments/breadth/factory/baselines.sh 2113-2120                                 # scripted baselines
FACTORY_AB_PY=python3 node experiments/breadth/factory/run.mjs --arm scripted --solver reference --family abr-p2p-audit --seeds 2119
nice -n 15 node --test --test-concurrency=1 experiments/breadth/factory/test/factory.test.mjs
/var/tmp/foundry-work/benches/factory/venv/bin/python -I experiments/breadth/factory/test/clock_props.py   # Hypothesis + holidays
```

## Paid commands (not run; estimates [I] from policy/models.json prices and per-session token assumptions in run.mjs)

| Step | Command | Estimate |
|---|---|---|
| Phrase panel (F3; Haiku, Sonnet, Mercury; 69 phrases) | `python3 -I $F/intake.py panel-prompts --family <f> --out DIR`, then one call per (phrase, model) through the policy's executors; admit at 2 of 3 | about $2 |
| G8 blind arm | `node experiments/breadth/factory/run.mjs --arm blind-H --family all --seeds 2113 --cap 0.5` (runner mode `blind` is declared, its session wiring is not built yet) | $0.05-0.15 |
| G9 second reader | a session that did not write the families derives 20 practice outcomes (seeds 2101-2104) from POLICY.md and the world; compare with the truth host-side | about $1 |
| G11 differential tier | `node experiments/breadth/factory/run.mjs --arm A-H --family <f> --seeds 2113 --cap 2` and `--arm A-S ... --cap 25` | $5-24 per family |
| Dev look before freeze | `node experiments/breadth/factory/run.mjs --arm A-H --family all --seeds 2113-2116 --cap 10` | $2-8 |
| V sealed arms (after FREEZE-V-1) | see PREREG-V-1 §3 | $350-880 with OD-V2(a); about $880 cached with per-trigger A-O |

## Known gaps (stated, not hidden)

- The live model paths of `run.mjs` (agent sessions through `bridge.py serve`, construction sessions) are written
  against the same executor and bridge as `experiments/autobench/run.mjs` but were not exercised: the $0 rule forbids a
  real session, and no fake-CLI test was built. The scripted path is tested end to end. `blind` mode is declared only.
- A-O is one session per trigger plus NOTES.md, not one long session (PREREG-V-1 OD-V2).
- G7's permutation relation is not implemented (same-instant independent events are rare); rename and base-week shifts are.
- `host.alt` (sqlite-mcp through the facade) is a reserved field; only the AutomationBench host exists.
- The UCI log mines usable SLA thresholds for P3 and P4 only (P1/P2 made_sla is 1-2%); P1/P2 targets are fictional.
