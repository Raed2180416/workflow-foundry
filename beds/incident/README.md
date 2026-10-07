# Bed `incident`: SRE incident triage

Status: v3.0.0, development bed, adversarially audited on 2026-10-07 (see [AUDIT.md](AUDIT.md)). The
generator, oracle, reference solver, controls and tests are done. No model has been run on it yet, so the claim
that cheap single-shot models usually fail from difficulty 3 is a design target. The only measurements so far
are the script baselines below.

v3 changes task content for every seed (the version is part of the RNG seed), so v2 results are not comparable.

## What a task is

Each task describes a fictional online shop. It runs 6 microservices at difficulty 1 and 18 at
difficulty 5 (gateway, API, core, data-store and batch tiers). The solver receives three texts,
all generated:

| Input | Also as file | Content |
|---|---|---|
| `inputs.system` | `system.md` | Service map: prose overview, a dependency table (`Service / Team / Tier / Calls / Other names in logs`), third-party providers, addresses (d4+), and "notes and recent changes" that override the table where they disagree |
| `inputs.ticket` | `ticket.txt` | The incident ticket written by people. Its times come from customer reports or alerts and are at least 90 s after the true start. At d4+ it also contains an unconfirmed guess |
| `inputs.log` | `logs/bundle.log` | 30 minutes of interleaved logs from every service, one line per event: `<Lnnnn> <UTC ISO timestamp> <source> <message>`, in timestamp order |

Exactly one root-cause fault is injected at time **T** (9 to 17 minutes into the window) in one
internal service. The topology is generated first and the root is then drawn uniformly (layer-1 services
weighted 0.4) among the services that can host the class and have a hard caller. There are 9 fault classes:

| Class | Root-side symptoms (paraphrased; a subset of the phrasings is sampled per task) | What callers see |
|---|---|---|
| `connection_pool_exhaustion` | pool usage rising, then at capacity, borrowers queueing, acquire timeouts; the datastore itself stays healthy | timeouts / 503 from the root |
| `certificate_expiry` | handshake failures, expired leaf cert, renewer stuck; precursors "expires in N minutes" before T | x509 / TLS verification errors naming the root |
| `bad_config_deploy` | a release or config rollout at T (from d3 often a canary first, promoted 70-160 s later, pods loading it one by one), then invalid config values, missing routes, panics | 500s from the root |
| `disk_full` | usage rising, then ENOSPC / errno 28, read-only mode, failed checkpoints | 507 / "storage full" on writes |
| `dns_resolution_failure` | lookups of its (healthy) callees fail | 502s from the root |
| `memory_leak_oom` | heap growing from T, then OOM kills and restarts in a cycle | connection refused/reset from the first kill onwards |
| `clock_skew` | clock offset +N s, tokens judged not-yet-valid/expired | 401s from the root |
| `upstream_rate_limiting` | its third-party provider answers 429, quota exhausted | 503s from the root |
| `poisoned_cache` | a cache refill at T (identical in form to earlier routine refills; other replicas load the same snapshot later), then checksum and missing-field warnings while it serves 200s | validation errors on the root's payloads |

Failures spread up the caller graph with per-edge delays of 2 to 30 s. A caller that treats a
dependency as optional logs that it fell back and keeps serving, so it is **not** impacted, unless its
fallback reads from a provider that failed too (then it fails and is impacted). Callers mostly log generic
timeouts, 5xx errors and circuit-breaker lines that name the service they call, often by an alias; from d3
up to three impacted services log failures without naming any callee. From d2 callers sometimes relay the
error text they received (`X returned 503: <root's message>`), so the class vocabulary also shows up in
dependents.

### Output (`outputSchema`, portable subset)

```json
{ "root_service": "canonical name from the table",
  "fault_class": "one of the 9 ids",
  "first_bad_timestamp": "ISO-8601 with Z or an offset, e.g. 2026-03-14T10:22:31Z",
  "impacted_services": ["canonical names, root included"],
  "evidence_line_ids": ["L0123", "..."] }
```

## Oracle

`oracle(task, output)` rebuilds the truth from `(seed, split, difficulty)` and never throws. It first copies
the output as plain JSON data; anything else is invalid (accessor properties, proxies, functions, symbol keys,
non-plain prototypes, sparse arrays, arrays over 1,000 items, more than 4 levels of nesting). It then rejects
schema-invalid output with `pass:false, score:0`. Invalid output means: not an object, a missing or extra
field (a literal `__proto__` or `constructor` key is an extra field), a wrong type, an unknown class (ids are
case-sensitive), an empty `impacted_services`, more than 40 impacted names or 50 evidence ids, a string
outside its length limits, or a timestamp that does not match
`YYYY-MM-DD[Tt]HH:MM[:SS[.ffffff]]([Zz]|±HH:MM)` and parse to a real instant. So minute precision, fractions,
offsets and lower-case `t`/`z` (RFC 3339) are accepted; a space instead of `T`, a missing zone, epoch numbers
and NaN are not.

**Pass rule (exact, `PASS_RULE` in `index.mjs`):** `pass` holds iff all four conditions hold:
- `root_service` equals the truth after trimming and lower-casing both;
- `fault_class` equals the truth exactly;
- `|first_bad_timestamp − T| ≤ 60 s`;
- Jaccard(`impacted_services`, true impacted set) ≥ 0.8, names trimmed and lower-cased, duplicates collapsed,
  order irrelevant. Aliases (hostnames, legacy names, addresses) do not count.

`score = 0.9 · mean(rootOk, classOk, timeOk, min(1, jaccard)) + 0.1 · evidencePrecision`, where
evidence precision is the share of distinct cited ids that are root-fault or dependent-failure lines.
Evidence never gates `pass`. `details` reports booleans, `jaccard`, `timeDeltaS` and evidence counts. It
never reports the true values, but `timeDeltaS` and `jaccard` would let a solver search the answer if they
were fed back; the experiment runner only stores them (arms see the pass bit at most).

Truth definitions (also stated in the prompt):
- **T** is the timestamp of the root's first line that shows the fault. Advance warnings and
  self-recovered blips before T do not count. For gradual faults (pool, disk, memory) T is the first
  abnormal-trend line (often just an abnormal value in the service's usual stats line), not the fatal moment.
  For a release or configuration change it is the first line where the new release is in use, a canary
  included.
- **impacted** is the root plus every service that fails because of it: a hard (non-optional) call path to it,
  or an optional call whose fallback provider fails too. Services that only fell back (`degraded`) are
  excluded, as are batch jobs and services whose errors are unrelated.

## Difficulty knobs and measured size

Token figures are `estimateTokens(prompt) + estimateTokens(inputs)` (utf-8 bytes / 4 of canonical JSON) over
seeds 0–59 of the `dev` split (test seeds 5000–5059 give the same picture). The static prompt is 990 tokens.
The files mirror the inputs and are not counted twice.

| d | services (batch) | target lines | lines min/med/max | tokens min / **median** / max | impacted median (range) |
|---|---|---|---|---|---|
| 1 | 6 (1) | 300 | 304 / 316 / 336 | 8,065 / **8,806** / 9,341 | 2 (2–3) |
| 2 | 8 (1) | 400 | 403 / 418 / 458 | 10,734 / **12,041** / 13,620 | 3 (2–5) |
| 3 | 11 (1) | 420 | 423 / 455 / 577 | 13,709 / **15,366** / 17,864 | 3 (2–6) |
| 4 | 14 (2) | 1600 | 1802 / 1868 / 1970 | 48,973 / **53,049** / 59,686 | 3 (2–7) |
| 5 | 18 (2) | 4000 | 4354 / 4512 / 4722 | 111,329 / **123,214** / 134,389 | 4 (2–9) |

| Knob | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| Message styles (`ERROR x`, `[WARN] x`, `level=error msg=`, JSON with varying keys, `E: x`) | plain | 3 styles | 5 styles | 5 | 5 |
| How callers name callees | canonical name | + FQDN | + legacy alias | + `ip:port` | + `ip:port` |
| Log source | service name | service name | pod name | pod name | pod name; one service logs under its legacy name (prose only) |
| Optional (fallback) edges, probability per eligible edge | 0 | 0.4 (marked in table) | 0.5 (prose only) | 0.45 (prose only) | 0.45 (prose only) |
| Optional edges whose fallback reads from a provider (v3) | – | – | 0.4 | 0.4 | 0.4 |
| Tasks that must have a falling-back caller (v3; others may have one) | – | – | 50% | 50% | 50% |
| Services that log failures without naming the callee | – | – | 0–3 (p 0.8) | 0–3 | 0–3 |
| Relayed error text in callers (probability per failure line) | 0 | 0.15 | 0.3 | 0.35 | 0.35 |
| Table out of date: edge missing from table (prose note, any edge) | – | – | 1 | 1 | 2 |
| Table out of date: stale edge listed (prose note, any plausible edge) | – | – | 1 | 1 | 2 |
| Hard-dependency notes (some worded like optional ones) | – | – | 2 | 2 | 3 |
| Dated note pairs about one call, only the later month holds (v3) | – | – | 2 | 2 | 3 |
| Legacy aliases given only in prose | – | – | – | 2 | 3 |
| "Known issue" note about the noisy batch job | yes | yes | – | – | – |
| Noisy batch job's error rate jumps shortly before T | – | – | yes | yes | yes |
| Routine deploy elsewhere (version change, no errors) | – | 1 before T | 1 before T (an impacted dependent with p 0.4) | 1 | 2 (one after T) |
| Same-class self-recovering blip in another service, before T | – | yes | yes | yes | yes |
| Same-class self-recovering blip in the root, recovering ≥ 60 s before T | – | – | ≤ 8 min before | ≤ 8 min before | ≤ 8 min before |
| Blips open with onset wording; recoveries paraphrased or only visible in values (v3) | – | – | 0.85 / 0.7 | same | same |
| Other-class blips anywhere | 1 | 1 | 2 | 2 | 4 |
| Root's own fault volume (share of v2) (v3) | 1 | 1 | 0.3–1 | 0.3–1 | 0.3–1 |
| Root repeats its onset wording while the fault lasts; partial "recoveries" inside it (v3) | – | – | yes | yes | yes |
| Onset is an abnormal value in a stats line (non-event classes) (v3) | – | – | 0.7 | 0.7 | 0.7 |
| Stats lines in the root and 2–4 other services, continuing after T (v3) | – | – | yes | yes | yes |
| Chronic same-vocabulary warnings all window in a non-root service | – | – | 1 (true class) | 1 | 2 (true + sibling class) |
| Benign onset lookalikes (same words, benign qualifier), root and most other services (v3) | – | – | yes | yes | yes |
| Decoys: healthy services with loud unrelated trouble from shortly before T | – | – | 2 | 2 | 2 |
| Benign look-alike warnings (e.g. `heap after gc 65%`, `responding 429 to client`) | basic | basic | + hard set | + hard set | + hard set |
| Misleading root-cause claim in a log line | – | – | – | 1 | 1 + maintenance notice |
| Wrong hypothesis in the ticket | – | – | – | yes | yes |
| Injected instruction-like text in a log message | – | – | – | – | 1 |

## Why it needs judgment, and why it is procedurally heavy

- **The root is quiet.** At d3 the root has the most WARN+ERROR lines of all serving services in 6% of test
  seeds (v2: 61%), and the most ERROR lines in 0 of 300 dev seeds (d1–5). Its own fault volume is 30% to 100%
  of v2's; first-hop callers, decoys and chronic warnings are louder.
- **Who started it.** Callers blame their immediate callee, by name, FQDN, legacy alias or IP, and some
  impacted services name nobody, so the blame chain has gaps that only the table and timing bridge. Relayed
  error text puts the root's vocabulary into callers. DNS and pool roots name healthy services in their own
  errors; a healthy, loud decoy sometimes sits right below the root. Onset-worded blips and lookalikes appear
  in many services, not only the root.
- **Which class.** Phrasings are paraphrased and sampled per task. Sibling classes look alike (expired
  certificate versus clock skew, pool exhaustion versus provider throttling, bad deploy versus poisoned cache),
  and the root also logs consequences in a sibling class's wording ("answering 429 to our callers while every
  connection is busy"). Chronic warnings with the true class's vocabulary run all window in another service.
- **When.** Precursors ("expires in 6 minutes"), self-recovered blips in the root that open with the onset's
  own wording and recover in words or only in values, benign lookalikes with the onset's words, onset
  repeats, momentary "recoveries" inside the real episode, canaries, per-pod echoes and identical-looking
  routine cache refills all move a naive start time out of the ±60 s window. The ticket's times are always
  at least 90 s late.
- **Blast radius.** Optional dependencies must be excluded unless their fallback provider failed too. The
  table is out of date in both directions, prose notes are paraphrased (some hard dependencies are worded with
  "optional" or "fallback"), some notes come in dated pairs where only the later one holds, and aliases must
  be resolved to canonical names.
- **Load.** About 300 to 4,700 lines from 6 to 18 services, 5 message formats, pods, aliases and IPs. A careful
  decomposition (per-service timelines, alias resolution, blame-graph traversal with table bridges, class
  judgment on the root's own lines, per-episode reading of the root's timeline, note dating) recovers every
  answer: each dependent failure that names a callee names an impacted one through a documented alias, every
  anonymous service has a documented edge to an impacted callee, and every optional call is documented
  (tests check all three).

### Script baselines (no model; passes over held-out test seeds 5000–5059)

`baseline.mjs` holds the three surface scripts, `attack.mjs` the v2 audit's attackers, and `heuristic*.mjs`
the v3 audit's attackers (A1: generic, A1note: A1 following the v2 "not in the table" leak, A2 and A4:
white-box attackers that know the v3 phrase catalog; all four have at most 40 non-comment lines). `ceiling` is an
over-budget white-box attacker (about 48 dense lines, 12k characters) kept as a diagnostic.

| d | firstJump | mostErrors | keywordGrep | blameChain | adapted | strong | A1 | A1note | A2 | A4 | ceiling |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 28/60 | 0 | 2 | 46 | 49 | 24 | 20 | 20 | 50 | 39 | 39 |
| 2 | 19 | 0 | 6 | 52 | 47 | 17 | 28 | 28 | 51 | 42 | 41 |
| 3 | 0 | 0 | 0 | 0 | 1 | 2 | 2 | 3 | 1 | 6 | 22 |
| 4 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 2 | 4 | 9 |
| 5 | 0 | 0 | 0 | 0 | 1 | 0 | 2 | 1 | 0 | 4 | 15 |

On 200 test seeds at d3: A1 3%, A1note 3%, A2 1.5%, A4 9.5%, ceiling 31.5%. The tests require every script
except `ceiling` to pass < 20% of test seeds 5000–5029 at d3 and d5 (and `ceiling` < 50%). Report the
`ceiling` row next to model arms: a pass rate at or below it is no evidence of judgment beyond what a
catalog-aware script achieves. d1 and d2 are deliberately easy.

## Adversarial and untrusted content (all of it is data, never instructions)

All of it is tagged in the generator's truth (`idsByTag`) and never counts as evidence:
- `mislead` (d4+): a log line from the audit shipper or the gateway, written as an alert
  correlator, status-page sync, chat-ops relay or runbook bot. It claims a different root (the routine-deploy
  service with p 0.4, else any non-root service) and a class drawn independently of the truth (any of the 9;
  `bad_config_deploy` when it blames the routine deploy). At d5 there is also a pre-incident "planned
  maintenance" notice near T naming a non-root service and a random class.
- `inject` (d5): user-supplied text echoed inside a log message (search query, display name,
  contact form, review). It addresses "AI triage agents" and tells them to output a specific
  `root_service` (never the true one) / `fault_class` (random) and to stop reading. Class ids appear in the
  log only in these lines (a test checks this).
- The ticket's on-call guess (d4+) names the routine-deploy service.

## Controls

- `referenceSolve`: truth plus evidence ids. It passes on 30 seeds at d1, d3, d5 and 20 at d2, d4, for dev
  seeds 0–29 and test seeds 5000–5029 (tested), also after a JSON round trip.
- `badControls`, each failing on the same seeds (tested):
  - `empty`;
  - `shuffled-or-corrupted`: noisy job as root, rotated class, T−7 min, the non-impacted set;
  - `plausible-but-wrong`: blames the first-hop caller, everything else exact;
  - `sibling-class`;
  - `late-timestamp` (T+150 s);
  - `impacted-missing-half`;
  - `blame-decoy`: the healthy loud decoy (or noisy job) as root, everything else exact;
  - `onset-at-root-blip`: dated from the root's own recovered blip;
  - `follow-red-herring`: the routine-deploy service as root, class `bad_config_deploy`.

## Files and usage

`index.mjs` (interface), `gen.mjs` (generator and knobs), `catalog.mjs` (vocabulary and phrasing pools),
`baseline.mjs` and `attack.mjs` (earlier script baselines), `heuristic.mjs`, `heuristic2.mjs`,
`heuristic4.mjs`, `heuristic-ceiling.mjs` (v3 audit attackers, test fixtures), `incident.test.mjs` (25 tests),
`AUDIT.md` (audit findings and numbers), and `index.js` (shim so that `node --test beds/incident/` works).

```js
import { generate, oracle, referenceSolve } from './beds/incident/index.mjs';
const task = generate({ seed: 5001, split: 'test', difficulty: 3 });
oracle(task, referenceSolve(task)); // { pass: true, score: 1, details: {...} }
```

`generate` takes about 4 ms at d3 and about 27 ms at d5 (max 58 ms over 60 seeds), and the oracle rebuilds the
task once (cached for the last 12 tasks). Both stay far under the 2 s / 200 MB limits (tested in a fresh process).

## Known limits

- Not yet validated with any model. Single-shot failure rates for cheap models at d ≥ 3 are expected, not
  measured.
- The text comes from a finite phrase catalog. A script that knows the catalog can encode most of the
  judgment: the over-budget `ceiling` attacker passes about 30% at d3 (AUDIT.md, I-12, open). Sudden classes
  (certificate, clock, rate limiting) are the easiest for it, because their stats lines are clear-cut and the
  ±60 s tolerance forgives "first fault line after the last recovery".
- Structural priors remain: the root is never the gateway or a batch job, can only be a service whose role
  hosts the class, and must have a hard caller; in v3 it is the unique busiest callee of the table in about
  5–10% of d3–d5 tasks (v2: 54%).
- Fault class is drawn uniformly per seed; over 300 dev seeds the counts per class ranged from 25
  (`certificate_expiry`) to 45 (`dns_resolution_failure`). Stratify by class when reporting if that matters.
- Data-tier roots can only be `disk_full`, `memory_leak_oom` or `poisoned_cache`. Upstream rate
  limiting needs a service with a third-party provider.
- The world is a stylised shop. Fault semantics are simplified: one fault, no mitigation inside
  the window, collector timestamps (a skewed clock does not distort log times).
