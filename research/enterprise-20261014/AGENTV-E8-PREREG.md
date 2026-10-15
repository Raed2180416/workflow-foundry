# AGENTV-E8 preregistration: agent-H plus a contract validator on E8 (2026-10-15)

**Status: preregistered, not run.** Written before any paid row of this experiment. **Development evidence** (one
world from our own generator, K = 1). Program: F1 Earned structure, first paid row
([FIRST-CLASS-PROGRAMS §1.5](../architecture-20261015/FIRST-CLASS-PROGRAMS.md), "AGENTV-E8"). Code:
[`experiments/agentv/`](../../experiments/agentv/). Tests at $0:
`node --test --test-concurrency=1 experiments/agentv/test/agentv.test.mjs`.

Tags: [M] measured or read in a repository file today; [P] a choice made here.

The runner prints the block below before its first paid call, and refuses to start without it
(`experiments/agentv/run.mjs preregBanner`). Its result records this file's sha256.

```prereg-banner
AGENTV-E8 (F1 §1.5; development evidence; world 1232 d2 size 12, the 14 completed cases graded for agent-H and the built workflows)
ARM        agent-H + V: agent-H unchanged (fresh Haiku 5.5 session per case-tick, same prompt/files/contract, $0.40 and 6 min per
           session, concurrency 4) + validate.mjs in the sandbox (the host's own pre-commit validation, host words) + a
           pre-commit gate with one retry carrying the refusal text. No oracle, no reference transition, no grades.
COMPARATORS (existing rows, not re-run)  built workflows B1L-H l1, B1N-H l2, l3: 14/14 each; agent-H (agenth-e8-s12): 10/14,
           27 invalid outputs, $1.45 reported.
MDE        exact two-sided McNemar at alpha 0.05 needs >= 6 discordant pairs, all one way (5 gives p 0.0625, 4 gives 0.125).
           So: no improvement over agent-H can be significant (it failed only 4 cases: p >= 0.125); a shortfall against the
           workflows is significant only at <= 8/14. Pass-rate 95% CI at n 14: 14/14 [0.77, 1.00], 13/14 [0.66, 1.00],
           10/14 [0.42, 0.92].
HYPOTHESIS "E8's workflow advantage survives the strongest simple agent": SUPPORTED only if agent-H + V <= 10/14; REFUTED only at
           14/14; 11-13/14 inconclusive (it then only decides which agent arm F1, F3, F4 and F7 use as their baseline).
PREDICTION (author's, fixed now) P1 at most 2 invalid outputs reach the host (agent-H: 27). P2 agent-H + V passes >= 13/14.
           P3 metered spend <= $3.00 on the §12 meter. P4 at most 1 case that agent-H passed is failed by agent-H + V.
REFUTED    (the prediction) if >= 3 invalid outputs reach the host (P1, a count from the committed host journal: read as
           written), or metered spend > $3.00 (P3, a measurement: read as written). P2 (<= 12/14 pass) and P4 (>= 2 cases agent-H
           passed are failed) sit below the MDE: a miss is reported as a miss of the author's prediction and reads inconclusive
           unless the 95% interval excludes the threshold (FIRST-CLASS-PROGRAMS §0.3). A missed P2 with P1 holding reads: E8's gap
           is not only the form misreading.
CAP        cap $5 on the PREREG-NEED-V1 §12 meter (each session's bound reserved before launch; unknown cost at its bound).
STOP       the first environment fault (rate limit, model unavailable, no sandbox) stops the run at its last commit (exit 3, no
           result); the same command resumes. A resume with other settings, prereg or code is refused (launch.jsonl).
```

## 1. Question

B1-E8-DEV (2026-10-15) ran agent-H against the built workflows on the identical sized world: workflows 14/14, agent-H
10/14 [M `B1-E8-DEV.md` "Result: agent-H versus the built workflows"]. 25 of agent-H's 27 invalid outputs violate "a
batch op keys its items, not the batch"; the other two put `close: false` [M]. B1-E8-DEV names "an
agent-H-with-validator arm we have not run". This row runs it: the strongest simple agent baseline, on the one bed where
a workflow advantage was measured. If it closes the gap, E8's advantage reads as a contract-reading advantage, not a
structure advantage (a reading, not a claim: §6).

## 2. Arms

| Arm | Row | Run here? |
|---|---|---|
| **agent-H + V** | new, `--label agentv-e8-s12` | yes (paid) |
| agent-H | `runs/agenth-e8-s12` (10/14, 27 invalid outputs, 143 ticks, $1.45 reported, cache-read share 0.84) | no |
| B1L-H lineage 1; B1N-H lineages 2, 3 | `runs/grade-s12-b1lh-e8-1`, `grade-s12-b1nh-e8-2`, `grade-s12-b1nh-e8-3` (14/14 each) | no |
| B1-O | `runs/grade-s12-b1o-e8-1` (5/14) | no |

**agent-H + V, exactly** [P]:
- **agent-H unchanged.** `experiments/ebed/agent-arm.mjs` `agentArm` is imported and used as it is: one fresh sandboxed
  `claude -p` session per case-tick, `TICK_PROMPT`, the same files, `CONTRACT.md` (`build.mjs contractText()`), the
  `ctx.mjs` mailbox, no workspace, model `claude-haiku-5-5` from `policy/models.json`, default effort, $0.40 and 6 minutes
  per session, concurrency 4. These are agent-H s12's settings [M `runs/agenth-e8-s12/result.json`; its concurrency is
  not recorded there and was `run-agent.mjs`'s default, 4].
- **In the session: `validate.mjs`.** `node validate.mjs draft.json` posts the draft through a `.val/` file mailbox (the
  `ctx.mjs` pattern) to the arm process. The arm answers with the host's own pre-commit validation,
  `beds/ebed/host/output.mjs validateCaseOutput`, with the item's schemas as the host binds them
  (`bindItem(e8.binding).schemas`). The problems come back in the host's words. One paragraph appended to the agent-H
  prompt tells the session to check before it writes `output.json` (`experiments/agentv/arm.mjs VALIDATOR_PROMPT`).
- **Pre-commit gate, one retry.** After the session the arm checks `output.json` the same way. On a refusal (or no
  `output.json`, or one that is not JSON) it runs one more fresh session in the same workdir. That session gets the
  refusal text verbatim and the refused output as `rejected-output.json`, not the first session's transcript. An
  environment fault (rate limit, model unavailable, no sandbox) is never retried. The arm never edits an output: what the
  last session wrote goes to the host, which validates it again.
- **The validator's information.** It uses only the contract and the host validation. Its static import closure is
  `beds/ebed/host/{output,schema,time}.mjs` and `beds/lib/canonical.mjs`; the arm's closure contains no oracle, reference
  transition, grader or item module. A test walks both.
- **What the arm side cannot see.** A `merge` is legal only in the first round of a wake-up and only on an instance started
  by an inbound message. Round and origin are host state, so the validator is permissive there and says so; the host
  still enforces both at commit.

**The plan's open question is answered** [M]. FIRST-CLASS-PROGRAMS §1.5 marked "whether the E8 host can check a tick
output without committing it" as not verified. It can: `validateCaseOutput` is a pure function of the output and the
item schemas, used by the host at `beds/ebed/host/host.mjs:672` before anything is applied. So the stronger variant runs,
not the weaker one (schema only, refusal shown to the next tick).

**Deviations from the plan text, recorded** [P]:
1. Code lives in `experiments/agentv/`, not `experiments/earned/`: a new directory, so it cannot collide with the EARN-0
   build stream. EARN-1's `verify-agent.mjs` can import it.
2. The plan says `run-agent.mjs` "used unchanged". Its arm cannot take a validator, and its `capped()` reserves nothing,
   which §0.3's metering rule requires. So `experiments/agentv/run.mjs` is its own runner. It reuses `agentArm`,
   `summarize` and `contractText` unchanged and makes the same generator, reference-pool and host calls.
3. The arm has both validator forms: the in-session tool (the orchestrator's design) and the pre-commit gate with one retry
   (the plan's design). The per-tick validator journal separates their effects (§4).
4. The host call timeout is 13 minutes, not 7, so that a retried tick (two 6-minute sessions) fits in one call.
5. Added at review (2026-10-15, before any paid row; the sha256 the runner records is of this text):
   - **Stop on the first environment fault.** The arm raises a host QuotaStop (`EnvFaultStop`) on a session that ends in
     `MODEL_RATE_LIMIT`, `MODEL_UNAVAILABLE` or `SANDBOX_UNAVAILABLE`. The host freezes at its last commit and discards the
     fault's round, which is the cut-back §6 asks for, done by the host instead of by hand. The runner writes no
     `result.json` (exit code 3), so the same command resumes. agent-H s12's first run kept going for 12 rate-limited
     ticks after its first fault [M `ebed-arms/agenth-e8-s12/contaminated-ratelimit/ticks.jsonl`: 13 `MODEL_RATE_LIMIT` of
     97 sessions].
   - **A paid run refuses to start without the executor sandbox**, and a session that throws before the CLI starts
     (`SANDBOX_UNAVAILABLE`, `EXECUTOR_MODEL`, `EXECUTOR_PATH`) is charged $0, as `label-run.mjs` charges a thrown
     session; any other throw is charged its bound.
   - **Resume stamp.** `launch.jsonl` records each invocation's settings, the prereg sha256 and the sha256 of the arm,
     validator, runner, `agent-arm.mjs` and `host/output.mjs`. A resume with other settings is refused; with other code it
     is refused unless `--allow-changed-code`, which records the change in the result.
   - **Session files are read without following links.** The validator mailbox and the gate open what the session wrote
     with `O_NOFOLLOW`, as regular files of at most 4 MB, and never quote a parse error (V8 quotes the input). Before this,
     a session could plant `.val/req-x.json -> /any/host/file` and get the file's first characters back in the error text,
     or plant the answer's temp file as a link and have the arm write through it. A linked `output.json` is refused at the
     gate and, if still a link after the retry, removed, so the host records no output (an arm error).
   - **P1 and wall time are read from records a kill cannot lose.** P1 counts `arm.error` rows with code `invalid-output`
     in the committed host journal. `validator.jsonl` also holds rounds that a freeze or a killed process discarded and a
     resume re-ran, so the result reports its totals twice: over every attempt and over the committed ticks only.
     `wall.jsonl` gets a heartbeat each minute, so an invocation stopped by a background job limit keeps its wall time to
     the minute.

## 3. Bed

- **World** [M]. E8 dev world 1232, difficulty 2, mix `tail`, size 12: 21 orders, 14 completed cases in the reference
  pools. World digest `56971c9b3aaa4886229ac81fd55dcc4f9d41640a7be06fae2651ba0b087f1bff`, identical to agent-H s12's
  `run.start` digest. The runner refuses any other world under this configuration (`EXPECTED_WORLDS`), and any world
  this file does not name unless `--allow-new-world` is passed after an amendment.
- **Grading** [M]. `e8.oracle` with the reference pools, in the analyst process after the run, exactly as `run-agent.mjs
  summarize` grades agent-H.
- **Not in this row.** World 1233 ("added if the cap allows", §1.5). Adding it needs an amendment here first: no agent-H
  row exists on 1233 at size 12.

## 4. What is reported

- Completed-case passes (n = 14), by class, first-divergence codes, critical violations, arm errors by code. **P1** is
  the count of `arm.error` rows with code `invalid-output` in the committed host journal (`rows[].invalidOutputsAtHost`);
  other arm errors (no output, timeout, crash) are reported beside it.
- **Paired table against agent-H**, with the exact McNemar p. agent-H's journal is regraded at $0 by the same oracle.
  Against the workflows the table is 14/14 by their rows.
- **Validator use**, per tick (`validator.jsonl`): in-session calls, ticks that used it, problem classes it returned,
  first-gate refusals by class, retries, retries that fixed the output, invalid outputs that reached the host.
- **Cost**: reported (the CLI's figure) and metered (§12: max(reported, re-priced per message) when observed, the bound
  when not, reservations in flight). Also tokens and the prompt-cache read share.
- **Time** (F8, LAT-0): wall time summed over invocations; the per-session wall time is in `validator.jsonl`.
- **S1 fields** for back-fill (`claimRow` in `result.json`): origin "our generator", evidence development, K = 1.
  World cost is unrecorded: the E8 world was hand-built (F5).

## 5. Validity gates passed at $0 before the run [M, 2026-10-15]

- **Validator conformance on agent-H's own 143 outputs** (`node experiments/agentv/conformance.mjs`, on the agent-H s12
  host journal):
  - it flagged all 27 outputs the host refused (miss rate 0/27);
  - it refused none of the 116 the host accepted (false-refusal rate 0/116), including 6 merge outputs;
  - its problem list was character-identical to the host's on 143/143.
  - The two classes in those refusals: 46 `effects[i].key: a batch op keys its items, not the batch` and 3
    `close: must be true when present`.
- **agent-H's 10/14 reproduces at $0.** Regrading its journal gives 10/14. The four failures are o0004 (straight),
  o0006 (collection-failed), o0008 (cancel-after-collection) and o0011 (straight). All four are `L3:missed`. Each of those
  cases had 2–6 refused outputs. Five passing cases also had refusals and recovered.
- **Tests** (`experiments/agentv/test/agentv.test.mjs`, scripted sessions, no model):
  - the validator catches both observed classes in the host's words;
  - the import closures contain no oracle;
  - on a real host a scripted session reaches `validate.mjs` through the mailbox, fixes its draft, and no output is refused;
  - the gate retries once with the refusal text, and the wrapper never repairs an output;
  - environment faults are not retried;
  - the §12 meter reserves before launch, stops with a QuotaStop, charges timeouts at their bound and resumes from its
    ledger;
  - an interrupted run resumes from its journal and ends where an uninterrupted run ends;
  - added at review: the first environment fault stops the world at its last commit and the same arm resumes it to the
    end; links planted in the mailbox or as `output.json` are never followed, quoted or written through; a resume with
    other settings or code is refused; a session that throws before the CLI starts is charged $0; P1 and the committed
    validator totals come from the committed journal; a world this file does not name is refused.
  - `--dry --dry-env-fault-at 7` on world 1232 (scripted sessions, $0) stopped with exit code 3 and no result, refused a
    resume with another `--tick-budget`, and resumed to the end with the same command [M, 2026-10-15].

## 6. Reading rules (fixed now)

- **Hypothesis H-E8**: "E8's workflow advantage survives the strongest simple agent". Read as in FIRST-CLASS-PROGRAMS §1.5:
  - **supported** only if agent-H + V ≤ 10/14;
  - **refuted** only at 14/14;
  - **inconclusive** at 11–13/14.

  The MDE (banner) means no outcome is significant against agent-H, and only ≤ 8/14 is significant against the workflows.
  Every reading is development evidence on one world from our own generator. No E8-only claim follows from it (§0.3,
  "No E8-only claims").
- **Which agent arm later programs use.** At ≥ 13/14, F1, F3, F4 and F7 use agent-H + V as their agent baseline. At
  ≤ 12/14, they use it beside agent-H.
- **The author's prediction** (P1–P4 in the banner). P1 and P3 are a count and a measurement, with no sampling reading:
  read as written. P2 and P4 are below the MDE: each is reported as observed, and a miss reads inconclusive unless the
  95% interval excludes the threshold (FIRST-CLASS-PROGRAMS §0.3; for P2 at n = 14, Clopper-Pearson, that takes 10/14 or
  fewer: the upper bound at 10/14 is 0.916 < 13/14, at 11/14 it is 0.953).
- **Censoring.** A QuotaStop freezes the clock. Cases still open are censored and reported as such, never as failures.
  A censored case counts against P2 (the prediction needs 13 passes of 14).
- **Environment faults.** If a session ends in `MODEL_RATE_LIMIT` or `MODEL_UNAVAILABLE` (agent-H s12's first run did,
  from tick 85), the run is contaminated from that tick. The arm stops the run there (§2 deviation 5): the host freezes
  at the last clean commit and discards the fault's round, and re-running the same command resumes from the on-disk
  journal and the spend ledger. The discarded round stays in the journal's freeze record and in `validator.jsonl`, and
  its spend stays on the meter. It is reported, never graded as an outcome.

## 7. Cost and cap

- **Estimate** [P]. About $2–3. agent-H spent $1.45 reported over 143 ticks. Validator calls add a few turns per tick, and
  retries should be rare if the in-session check works.
- **Cap: $5** on the §12 meter (FIRST-CLASS-PROGRAMS §0.3 metering, PREREG-NEED-V1 §12 K5; `label-run.mjs StageBudget`
  and `meterOf`, imported read-only).
  - Each session's $0.40 bound is reserved before launch, with up to 4 in flight. A start that does not fit is a QuotaStop.
  - A session is charged max(reported, re-priced per message at the §12 price table) when its cost was observed, and its
    bound when it was not (a timeout or a killed session).
  - The ledger is `spend.jsonl`, live under `/var/tmp/foundry-work/agentv-arms/<label>/` and copied into the run
    directory when the run ends.
- **Booking.** The soft-cap check counts this row at max($5, metered). It is booked to F1 (OWNER-DECISIONS addendum §12
  decision 1), not to any AutomationBench budget.

## 8. Run command

```sh
node experiments/agentv/run.mjs --model claude-haiku-5-5 --label agentv-e8-s12 --seeds 1232 --difficulties 2 \
  --size 12 --tick-budget 0.4 --tick-minutes 6 --cap 5 --concurrency 4 --retries 1
```

- **Resuming.** Re-running the same command resumes from the journal, at $0 for the committed prefix. A finished run
  refuses to start again (`result.json` exists). Exit code 3 means the run stopped on an environment fault: wait for it
  to clear, then run the same command again.
- **Where things go.** Results go to `research/enterprise-20261014/runs/agentv-e8-s12/`: `result.json`, `ticks.jsonl`,
  `validator.jsonl`, `spend.jsonl`, `wall.jsonl` and `launch.jsonl`. The host journal stays under
  `/var/tmp/foundry-work/agentv-arms/agentv-e8-s12/`.
- **Expected duration.** About 1–2 h, like agent-H. A background job limit stops it, so the same command is run again
  to resume.

## 9. What this row cannot show

- One world, one seed, one difficulty, K = 1, from a generator we wrote: development evidence only.
- No significant difference from agent-H is possible at n = 14, whatever the outcome.
- A closed gap would not show that structure is unnecessary on E8. Two things would still stand:
  - the workflows run each world in seconds, against hours for either agent;
  - the workflows pay their build once.

  LAT-0 and EARN-1 read those.
- The validator checks form only. A misreading of a business rule (SPEC-E) passes it. Agent-H + V's remaining failures,
  if any, are such misreadings, and F4 (spec from a messy business) is where they belong.
