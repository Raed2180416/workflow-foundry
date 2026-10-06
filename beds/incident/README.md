# Bed `incident`: SRE incident triage

Status: v1.0.0, development bed. Generator, oracle, reference solver, controls and tests are
done. No model has been run on it yet, so the claim that cheap single-shot models usually fail
from difficulty 3 is a design target. The only measurements so far are the script baselines below.

## What a task is

Each task describes a fictional online shop. It runs 6 microservices at difficulty 1 and 18 at
difficulty 5 (gateway, API, core, data-store and batch tiers). The solver receives three texts,
all generated:

| Input | Also as file | Content |
|---|---|---|
| `inputs.system` | `system.md` | Service map: prose overview, a dependency table (`Service / Team / Tier / Calls / Other names in logs`), third-party providers, addresses (d4+), and "notes and recent changes" that override the table where they disagree |
| `inputs.ticket` | `ticket.txt` | The incident ticket written by people. Its times come from customer reports or alerts and are at least 90 s after the true start. At d4+ it also contains an unconfirmed wrong guess |
| `inputs.log` | `logs/bundle.log` | 30 minutes of interleaved logs from every service, one line per event: `<Lnnnn> <UTC ISO timestamp> <source> <message>`, in timestamp order |

Exactly one root-cause fault is injected at time **T** (9 to 17 minutes into the window) in one
internal service. It comes from 9 fault classes:

| Class | Root-side symptoms (paraphrased; a subset of the phrasings is sampled per task) | What callers see |
|---|---|---|
| `connection_pool_exhaustion` | pool at capacity, borrowers queueing, acquire timeouts; the datastore itself stays healthy | timeouts / 503 from the root |
| `certificate_expiry` | handshake failures, expired leaf cert, renewer stuck; precursors "expires in N minutes" before T | x509 / TLS verification errors naming the root |
| `bad_config_deploy` | rollout with a version change at T, then invalid config values, missing routes, panics | 500s from the root |
| `disk_full` | ENOSPC / errno 28, read-only mode, failed checkpoints | 507 / "storage full" on writes |
| `dns_resolution_failure` | lookups of its (healthy) callees fail | 502s from the root |
| `memory_leak_oom` | heap growing from T, then OOM kills and restarts in a cycle | connection refused/reset from the first kill onwards |
| `clock_skew` | clock offset +N s, tokens judged not-yet-valid/expired | 401s from the root |
| `upstream_rate_limiting` | its third-party provider answers 429, quota exhausted | 503s from the root |
| `poisoned_cache` | a cache refill at T (identical in form to earlier routine refills), then checksum and missing-field warnings while it serves 200s | validation errors on the root's payloads |

Failures spread up the caller graph with per-edge delays of 2 to 30 s. A caller that treats a
dependency as optional logs that it fell back and keeps serving, so it is **not** impacted.
Callers mostly log generic timeouts, 5xx errors and circuit-breaker lines that name the service
they call, often by an alias. From d2 they sometimes relay the error text they received (`X
returned 503: <root's message>`), so the class vocabulary also shows up in dependents.

### Output (`outputSchema`, portable subset)

```json
{ "root_service": "canonical name from the table",
  "fault_class": "one of the 9 ids",
  "first_bad_timestamp": "ISO-8601 with Z or offset",
  "impacted_services": ["canonical names, root included"],
  "evidence_line_ids": ["L0123", "..."] }
```

## Oracle

`oracle(task, output)` rebuilds the truth from `(seed, split, difficulty)`. It rejects
schema-invalid output with `pass:false, score:0`. Invalid output means: not an object, a missing
or extra field, a wrong type, an unknown class, an empty `impacted_services`, more than 50
evidence ids, or a timestamp that is not ISO-8601 with an offset.

**Pass rule (exact):** `pass` holds iff all four conditions hold:
- `root_service` equals the truth (case-insensitive, trimmed);
- `fault_class` equals the truth;
- `|first_bad_timestamp − T| ≤ 60 s`;
- Jaccard(`impacted_services`, true impacted set) ≥ 0.8. Names compare case-insensitively and
  aliases do not count.

`score = 0.9 · mean(rootOk, classOk, timeOk, min(1, jaccard)) + 0.1 · evidencePrecision`, where
evidence precision is the share of cited ids that are root-fault or dependent-failure lines.
Evidence never gates `pass`. `details` reports booleans, `jaccard`, `timeDeltaS` and evidence
counts. It never reports the true values.

Truth definitions (also stated in the prompt):
- **T** is the timestamp of the root's first line that shows the fault. Advance warnings and
  self-recovered blips before T do not count. For gradual faults (memory leak) T is the first
  abnormal-trend line, not the first OOM kill.
- **impacted** is the root plus every service with a hard (non-optional) call path to it. Such
  services fail and log failures. Services that only fell back (`degraded`) are excluded, as are
  batch jobs and services whose errors are unrelated.

## Difficulty knobs and measured size

Token figures are `estimateTokens(prompt) + estimateTokens(inputs)` (utf-8 bytes / 4 of
canonical JSON) over seeds 0–59 of the `dev` split. The static prompt is 945 tokens. The files
mirror the inputs and are not counted twice.

| d | services (batch) | target lines | lines min/med/max | tokens min / **median** / max | impacted median (range) |
|---|---|---|---|---|---|
| 1 | 6 (1) | 300 | 302 / 327 / 359 | 8,204 / **9,144** / 9,974 | 4 (2–5) |
| 2 | 8 (1) | 400 | 394 / 424 / 463 | 10,908 / **12,331** / 13,258 | 4 (2–6) |
| 3 | 11 (1) | 420 | 431 / 472 / 544 | 12,841 / **14,432** / 16,985 | 4 (2–9) |
| 4 | 14 (2) | 1600 | 1675 / 1751 / 1821 | 44,592 / **49,072** / 55,678 | 5 (2–11) |
| 5 | 18 (2) | 4000 | 4082 / 4250 / 4567 | 100,293 / **114,709** / 128,910 | 5 (2–14) |

| Knob | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| Message styles (`ERROR x`, `[WARN] x`, `level=error msg=`, JSON with varying keys, `E: x`) | plain | 3 styles | 5 styles | 5 | 5 |
| How callers name callees | canonical name | + FQDN | + legacy alias | + `ip:port` | + `ip:port` |
| Log source | service name | service name | pod name | pod name | pod name; one service logs under its legacy name (prose only) |
| Optional (fallback) edges, probability per eligible edge | 0 | 0.4 (marked in table) | 0.4 (prose only) | 0.3 (prose only) | 0.3 (prose only) |
| Relayed error text in callers (probability per failure line) | 0 | 0.15 | 0.3 | 0.35 | 0.35 |
| Table out of date: edge missing from table (prose note) | – | – | 1 | 1 | 2 |
| Table out of date: stale edge listed (prose note) | – | – | – | 1 | 1 |
| Legacy aliases given only in prose | – | – | – | 2 | 3 |
| "Known issue" note about the noisy batch job | yes | yes | – | – | – |
| Noisy batch job's error rate jumps shortly before T | – | – | yes | yes | yes |
| Routine deploy elsewhere (version change, no errors) | – | 1 before T | 1 before T, usually in an impacted dependent | 1 | 2 (one after T) |
| Same-class self-recovering blip in another service, before T | – | yes | yes | yes | yes |
| Same-class self-recovering blip in the root, 5.5–12 min before T | – | – | yes | yes | yes |
| Other-class blips anywhere | 1 | 1 | 2 | 2 | 4 |
| Chronic same-vocabulary warnings all window in a non-root service | – | – | 1 (true class) | 1 | 2 (true + sibling class) |
| Benign look-alike warnings (e.g. `heap after gc 65%`, `responding 429 to client`) | basic | basic | + hard set | + hard set | + hard set |
| Misleading root-cause claim in a log line | – | – | – | 1 | 1 + maintenance notice |
| Wrong hypothesis in the ticket | – | – | – | yes | yes |
| Injected instruction-like text in a log message | – | – | – | – | 1 |

## Why it needs judgment, and why it is procedurally heavy

- **The root is quiet.** The root is the top ERROR emitter in 1 of 300 seeds (dev 0–59, d1–5).
  The test allows at most 20%. The gateway and first-hop callers log several times more errors, and many root symptoms
  are WARN or even INFO (poisoned cache serves `200 cache=hit`).
- **Who started it.** Callers blame their immediate callee, by name, FQDN, legacy alias or IP.
  Relayed error text puts the root's vocabulary into callers. DNS and pool roots name healthy
  services in their own errors. Certificate and clock-skew roots name the callers whose
  connections they reject. Telling origin from relay needs reading, not counting.
- **Which class.** Phrasings are paraphrased and sampled per task. Sibling classes look alike
  (expired certificate versus clock skew, pool exhaustion versus provider throttling, bad deploy
  versus poisoned cache). Chronic warnings with the true class's vocabulary run all window in
  another service.
- **When.** Precursors ("expires in 6 minutes"), self-recovered blips in the root, identical-looking
  routine cache refills, and leaks whose first OOM comes minutes after T all move a naive start
  time out of the ±60 s window. The ticket's times are always at least 90 s late.
- **Blast radius.** Optional dependencies (fallback lines) must be excluded. So must unrelated
  sporadic errors after T and the noisy batch job. Edges that are stale or missing in the table
  are documented only in prose, and aliases must be resolved to canonical names.
- **Load.** 300 to 4,500 lines from 6 to 18 services, 5 message formats, pods, aliases and IPs.
  A careful decomposition (per-service timelines, alias resolution, blame-graph traversal, class
  judgment on the root's own lines) can recover every answer: each dependent failure names an
  impacted callee through a documented alias, and a test checks this.

### Script baselines (no model; `baseline.mjs`, passes over dev seeds 0–59)

| d | first sustained error jump | most ERROR lines | keyword grep |
|---|---|---|---|
| 1 | 17/60 | 0/60 | 21/60 |
| 2 | 25/60 | 0/60 | 17/60 |
| 3 | 4/60 | 0/60 | 1/60 |
| 4 | 2/60 | 0/60 | 0/60 |
| 5 | 0/60 | 0/60 | 0/60 |

The tests require every script to pass ≤ 25% of seeds at d ≥ 3. Use these scripts as the
"simple baseline" row when reporting model arms.

## Adversarial and untrusted content (all of it is data, never instructions)

All of it is tagged in the generator's truth (`idsByTag`) and never counts as evidence:
- `mislead` (d4+): a log line from the audit shipper or the gateway, written as an alert
  correlator, status-page sync, chat-ops relay or runbook bot. It claims a different root (often
  the routine-deploy service or a first-hop caller) and a different class. At d5 there is also a
  pre-incident "planned maintenance" notice near T that names a wrong class and service.
- `inject` (d5): user-supplied text echoed inside a log message (search query, display name,
  contact form, review). It addresses "AI triage agents" and tells them to output a specific
  wrong `root_service` / `fault_class` and to stop reading. Class ids appear in the log only in
  these lines (a test checks this).
- The ticket's on-call guess (d4+) names the routine-deploy service.

## Controls

- `referenceSolve`: truth plus evidence ids. It passes on 20 seeds × 5 difficulties × 2 splits
  (tested).
- `badControls`, each failing on 20 seeds per difficulty (tested):
  - `empty`;
  - `shuffled-or-corrupted`: noisy job as root, rotated class, T−7 min, the non-impacted set;
  - `plausible-but-wrong`: blames the first-hop caller, everything else exact;
  - `sibling-class`;
  - `late-timestamp` (T+150 s);
  - `impacted-missing-half`;
  - `follow-red-herring`: the routine-deploy service as root, class `bad_config_deploy`.

## Files and usage

`index.mjs` (interface), `gen.mjs` (generator and knobs), `catalog.mjs` (vocabulary and
phrasing pools), `baseline.mjs` (script baselines), `incident.test.mjs` (13 tests), and
`index.js` (shim so that `node --test beds/incident/` works).

```js
import { generate, oracle, referenceSolve } from './beds/incident/index.mjs';
const task = generate({ seed: 1, split: 'dev', difficulty: 3 });
oracle(task, referenceSolve(task)); // { pass: true, score: 1, details: {...} }
```

`generate` takes about 3 ms at d3 and about 40 ms at d5, and the oracle rebuilds the task once.
Both stay far under the 2 s / 200 MB limits (tested in a fresh process).

## Known limits

- Not yet validated with any model. Single-shot failure rates for cheap models at d ≥ 3 are
  expected, not measured.
- Fault class is drawn uniformly per seed; over 300 seeds the counts per class ranged from 21
  (`upstream_rate_limiting`) to 41. Stratify by class when reporting if that matters.
- Data-tier roots can only be `disk_full`, `memory_leak_oom` or `poisoned_cache`. Upstream rate
  limiting needs a service with a third-party provider.
- The world is a stylised shop. Fault semantics are simplified: one fault, no mitigation inside
  the window, collector timestamps (a skewed clock does not distort log times).
