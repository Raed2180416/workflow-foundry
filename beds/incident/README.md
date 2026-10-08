# Bed `incident`: SRE incident triage

Status: v4.2.0, development bed. First adversarial audit on 2026-10-07 (v3.0.0); second audit in two passes,
2026-10-07 (an interrupted attempt that produced v4.0 and v4.1 without documenting them) and 2026-10-08 (v4.2.0,
findings F-28 to F-33, D-4, D-5 and O-6). See [AUDIT.md](AUDIT.md). The generator, oracle, reference solver,
controls and tests are done. No model has been run on it yet, so the claim that cheap single-shot models usually
fail from difficulty 3 is a design target. The only measurements so far are the script baselines below.

Every version changes task content for every seed (the version is part of the RNG seed), so results from earlier
versions are not comparable. In particular v3.0.0 had a near-total class leak (AUDIT.md F-29: a keyword vote over
the log named the fault class in 99 of 100 d3 tasks); do not reuse v3 or v4.0/v4.1 numbers.

## What a task is

Each task describes a fictional online shop. It runs 6 microservices at difficulty 1 and 18 at
difficulty 5 (gateway, API, core, data-store and batch tiers). The solver receives three texts,
all generated:

| Input | Also as file | Content |
|---|---|---|
| `inputs.system` | `system.md` | Service map: prose overview (which service provides what), a dependency table (`Service / Team / Tier / Calls / Other names in logs`), third-party providers, addresses (d4+), and "notes and recent changes" that override the table where they disagree; from d3 a note may name a service by what it provides |
| `inputs.ticket` | `ticket.txt` | The incident ticket written by people. Its times come from customer reports or alerts and are at least 90 s after the true start. At d4+ it also contains an unconfirmed guess |
| `inputs.log` | `logs/bundle.log` | 30 minutes of interleaved logs from every service, one line per event: `<Lnnnn> <UTC ISO timestamp> <source> <message>`, in timestamp order |

Exactly one root-cause fault is injected at time **T** (9 to 17 minutes into the window at d1-d2, 8 to 16 from d3)
in one internal service. The topology is generated first and the root is then drawn uniformly (layer-1 services
weighted 0.4) among the services that can host the class and have a hard caller. There are 9 fault classes:

| Class | Root-side symptoms (paraphrased; a subset of the phrasings is sampled per task) | What callers see |
|---|---|---|
| `connection_pool_exhaustion` | pool usage rising, then at capacity, borrowers queueing, acquire timeouts; the datastore itself stays healthy | timeouts / 503 from the root |
| `certificate_expiry` | the served certificate's notAfter passes (from d3 75-240 s before T; connections opened earlier keep working), then handshake failures; precursors "expires in N minutes" | x509 / TLS verification errors naming the root |
| `bad_config_deploy` | a release or config rollout at T (from d3 often a canary first, promoted 70-160 s later, pods loading it one by one), then invalid config values, missing routes, panics | 500s from the root |
| `disk_full` | usage rising, then ENOSPC / errno 28, read-only mode, failed checkpoints | 507 / "storage full" on writes |
| `dns_resolution_failure` | lookups of its (healthy) callees fail | 502s from the root |
| `memory_leak_oom` | heap growing from T, then OOM kills and restarts in a cycle | connection refused/reset from the first kill onwards |
| `clock_skew` | clock offset +N s, tokens judged not-yet-valid/expired | 401s from the root |
| `upstream_rate_limiting` | its third-party provider answers 429, quota exhausted | 503s from the root |
| `poisoned_cache` | a cache refill at T (identical in form to earlier routine refills; other replicas load the same snapshot later), then checksum and missing-field warnings while it serves 200s | validation errors on the root's payloads |

Failures spread up the caller graph with per-edge delays of 2 to 30 s; from d3 a sudden fault may stay latent for
5 to 600 s before callers fail. A caller that treats a dependency as optional logs that it fell back and keeps
serving, so it is **not** impacted, unless its fallback reads from a provider that failed too (then it fails and is
impacted). Callers mostly log generic timeouts, 5xx errors and circuit-breaker lines that name the service they
call, often by an alias; from d3 some impacted services log failures without naming any callee (with p 0.7 every
hard non-gateway caller of the root does), and callers stuck on the root also time out on healthy callees
(collateral lines that blame a service that is fine). From d2 callers sometimes relay the error text they received
(`X returned 503: <root's message>`), so the class vocabulary also shows up in dependents.

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
`YYYY-MM-DD[Tt]HH:MM[:SS[.ffffff]]([Zz]|±HH:MM)`, names a calendar day or hour that does not exist (month 01-12,
day within the month, hour 00-23; v4.2) or does not parse to a real instant. So minute precision, fractions,
offsets and lower-case `t`/`z` (RFC 3339) are accepted; a space instead of `T`, a missing zone, `24:00`,
`2026-02-30`, epoch numbers and NaN are not.

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
  abnormal-trend line, not the fatal moment. For a release or configuration change it is the first line where the
  new release is in use, a canary included. For a cache it is the first line where the bad entries were loaded.
  For an expired certificate it is the first failing handshake or connection, not the notAfter time printed in
  the certificate. A similar anomaly in another resource of the same service (another pool, volume, certificate
  hostname, process, time source, provider, component or cache namespace) that the failures do not involve is not
  the fault.
- **impacted** is the root plus every service that fails because of it: a hard (non-optional) call path to it,
  or an optional call whose fallback provider fails too. Services that only fell back (`degraded`) are
  excluded, as are batch jobs and services whose errors are unrelated.

## Difficulty knobs and measured size

Token figures are `estimateTokens(prompt) + estimateTokens(inputs)` (utf-8 bytes / 4 of canonical JSON) over
seeds 0–59 of the `dev` split (test seeds 5000–5059: d3 median 16,745, the others within 2%). The static prompt is
1,195 tokens. The files mirror the inputs and are not counted twice.

| d | services (batch) | target lines | lines min/med/max | tokens min / **median** / max | impacted median (range) |
|---|---|---|---|---|---|
| 1 | 6 (1) | 300 | 298 / 314 / 349 | 8,429 / **8,955** / 9,687 | 3 (2–3) |
| 2 | 8 (1) | 400 | 390 / 419 / 458 | 10,922 / **12,131** / 13,300 | 3 (2–5) |
| 3 | 11 (1) | 420 | 424 / 472 / 677 | 14,472 / **16,533** / 22,399 | 3 (2–6) |
| 4 | 14 (2) | 1600 | 1811 / 1896 / 2051 | 49,758 / **54,764** / 62,071 | 3 (2–7) |
| 5 | 18 (2) | 4000 | 4283 / 4493 / 4804 | 115,472 / **123,455** / 133,071 | 3 (2–10) |

d3 sits above the contract's 6–15K aim (median 16.5K; v3 15.4K, v4.1 16.6K). The v4.2 rival anomaly added about
1K tokens; lighter decoys, a lower d3 background rate (0.38 → 0.32) and dropping a stats series that no longer
mirrored anything in the root took it back below the v4.1 size.

The v1–v3 knobs (per level):

| Knob | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| Message styles (`ERROR x`, `[WARN] x`, `level=error msg=`, JSON with varying keys, `E: x`) | plain | 3 styles | 5 styles | 5 | 5 |
| How callers name callees | canonical name | + FQDN | + legacy alias | + `ip:port` | + `ip:port` |
| Log source | service name | service name | pod name | pod name | pod name; one service logs under its legacy name (prose only) |
| Optional (fallback) edges, probability per eligible edge | 0 | 0.4 (marked in table) | 0.5 (prose only) | 0.45 (prose only) | 0.45 (prose only) |
| Optional edges whose fallback reads from a provider | – | – | 0.4 | 0.4 | 0.4 |
| Services that log failures without naming the callee | – | – | 0–3 (p 0.8) | 0–3 | 0–3 |
| Relayed error text in callers (probability per failure line) | 0 | 0.15 | 0.3 | 0.35 | 0.35 |
| Table out of date: edges missing from the table / stale rows (prose notes) | – | – | 2 / 2 | 1 / 1 | 2 / 2 |
| Hard-dependency notes (some worded like optional ones) / dated note pairs | – | – | 2 / 3 | 2 / 3 | 3 / 3 |
| Legacy aliases given only in prose | – | – | – | 2 | 3 |
| "Known issue" note about the noisy batch job | yes | yes | – | – | – |
| Routine deploys elsewhere (version change, no errors; any time from v4.1) | – | 1 | 1 | 1 | 2 |
| Same-class self-recovering blip in another service (any time from v4.2) | – | yes | yes | yes | yes |
| Same-class self-recovering blip in the root: starts ≤ 8 min before T, recovers ≥ 60 s before it | – | – | yes | yes | yes |
| Other-class blips anywhere | 1 | 1 | 2 | 2 | 4 |
| Chronic warnings all window in a non-root service (any class from v4.1) | – | – | 1 | 1 | 2 |
| Decoys: healthy services with loud unrelated trouble (any time from v4.1) | – | – | 2 | 2 | 2 |
| Misleading root-cause claim in a log line | – | – | – | 1 | 1 + maintenance notice |
| Wrong hypothesis in the ticket | – | – | – | yes | yes |
| Injected instruction-like text in a log message | – | – | – | – | 1 |

From d3 every task also has (v3 audit and second audit; d1–d2 have none of these): onset-worded blips with
paraphrased or value-only recoveries (0.85 / 0.7); root fault volume 15–90% of v2's; onset repeats and momentary
"recoveries" inside the real episode; canary releases (0.6) and per-pod echoes; benign lookalikes with the onset's
words and a harmless reason (root and most other services; half composed per task); a latent phase of 5–600 s for
sudden faults; onsets from three paraphrase pools or an ordinary symptom (0.4), first symptom 15–90 s after the
onset; collateral timeouts against healthy callees; per-service wording (dialects and word-level synonyms, p 0.6
per group); notes that name services by what they provide (0.4 per mention); stray anomalies of the true class's
kind in another resource of the root 65–240 s before T (0.65) and in 2–3 other services, some recovering; one or
two test or shadow replicas with an episode of any class (the notes name the pod); consequence episodes in direct
callers (their own pool, workers or heap fill up; 0.8 each); and, new in v4.2, a **rival anomaly**.

**Rival anomaly (v4.2, AUDIT.md F-29).** A non-root service R (a neighbour of the root in the table with p 0.8)
carries the same herring kit as the root, for one other class h: a blip of class h shortly before its own episode,
lookalikes of class h, a blip of class h in a third service, and a sustained, never recovering anomaly of class h in
another resource of R (an unrelated pool, volume, certificate hostname, process, time source, provider, component
or cache namespace), 0.8–1.4 times as many lines as the root's own fault lines (5–30), from a random moment. R keeps
serving and nothing fails because of it; the decoys' vocabulary leans to class h (p 0.5). Only the cascade (which
callers fail, and when) and the resource names (does the anomaly involve what the failing callers use?) tell the
two stories apart.

## Why it needs judgment, and why it is procedurally heavy

- **The root is quiet.** At d3 the root has the most WARN+ERROR lines of all serving services in 9 of 200 test
  seeds (0 at d5) and the most ERROR lines in 3 of 200 (0 at d5). First-hop callers, decoys, the rival and chronic warnings
  are louder.
- **Who started it.** Callers blame their immediate callee, by name, FQDN, legacy alias or IP, but from d3 the
  root's hard callers are often anonymous and their only named callees are healthy (collateral timeouts), so the
  root is reached through the table and timing. Its neighbours carry the same-class blip, strays and the rival's
  sustained anomaly. A healthy, loud decoy sometimes sits right below the root.
- **Which class.** Phrasings are paraphrased, sampled per task and reworded per service. Sibling classes look
  alike, and the root logs consequences in a sibling class's wording. Two stories compete: a keyword vote over all
  WARN/ERROR lines names the true class in 33% of d3 tasks (29% at d5) and the rival class in 53% (47%); the true
  class is the unique most frequent blip class in 24% (v4.1: 62% and 80% at d3; v3: 99% and 77%).
- **When.** Precursors, the root's own recovered blip (often echoed only by its callers), lookalikes with the
  onset's words, a stray in another resource of the root just before T, onset repeats, momentary recoveries,
  canaries, per-pod echoes, identical-looking routine cache refills and a latent phase all move a naive start time
  out of the ±60 s window. The ticket's times are always at least 90 s late, and no herring is placed relative to T
  (F-30: echoes, decoys, deploys, claims and the same-class blip are timed independently of it).
- **Blast radius.** Optional dependencies must be excluded unless their fallback provider failed too. The
  table is out of date in both directions, prose notes are paraphrased (some hard dependencies are worded with
  "optional" or "fallback"), some come in dated pairs where only the later one holds, services are sometimes named
  by what they provide, and aliases must be resolved to canonical names.
- **Load.** About 300 to 4,800 lines from 6 to 18 services, 5 message formats, pods, aliases and IPs. A careful
  decomposition recovers every answer: each dependent failure that names a callee names an impacted one through a
  documented alias, every anonymous service has a documented edge to an impacted callee, every optional call is
  documented, each description names exactly one service, and the rival never fails anyone (tests check all of it).

### Script baselines (no model; passes over held-out test seeds 5000–5059)

`baseline.mjs` holds the three surface scripts, `attack.mjs` the v2 audit's attackers, `heuristic.mjs`,
`heuristic2.mjs`, `heuristic4.mjs` the v3 audit's (A1, A1note, A2, A4), `heuristic5.mjs` the second audit's generic
attacker A12 (pass 2, written from scratch with short keyword lists: cascade start, failing request lines, callee
descent, novel class-worded lines, resource tokens) and `heuristic6.mjs` A10, the strongest compliant attacker of
the interrupted first attempt (white-box, it encodes most of the v4 phrase catalog). All of them have at most 40
non-comment lines. `ceiling` (v3) and `ceiling2` (v4, 44 dense lines, 12k characters) are over-budget diagnostics.

| d | firstJump | mostErrors | keywordGrep | blameChain | adapted | strong | A1 | A1note | A2 | A4 | A12 | A10 | ceiling | ceiling2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 27/60 | 0 | 3 | 52 | 49 | 21 | 21 | 21 | 49 | 43 | 25 | 46 | 43 | 58 |
| 2 | 27 | 1 | 6 | 52 | 45 | 17 | 29 | 29 | 49 | 41 | 29 | 36 | 33 | 52 |
| 3 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 5 | 6 | 0 | 9 |
| 4 | 0 | 0 | 0 | 1 | 1 | 0 | 2 | 3 | 0 | 1 | 6 | 8 | 0 | 7 |
| 5 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 6 | 2 | 0 | 4 |

On 200 test seeds (5000–5199): d3 A12 7.5%, A10 14%, ceiling2 14.5%; d5 A12 8%, A10 6%, ceiling2 10%. On v4.1 the
same scripts passed A10 13/60 (21.7%) and ceiling2 10/60 at d3, 17.5% and 15% over 200 seeds. The tests require
every compliant script to pass < 20% of test seeds 5000–5029 at d3 and d5, and the over-budget ones < 35%. Given
the true root, ceiling2 passes 34.5% of d3 tasks (A10 21%, A12 14.5%), so finding the root is now the main barrier. Report the
`ceiling2` row next to model arms: a pass rate at or below it is no evidence of judgment beyond what a
catalog-aware script achieves. d1 and d2 are deliberately easy.

## Adversarial and untrusted content (all of it is data, never instructions)

All of it is tagged in the generator's truth (`idsByTag`) and never counts as evidence:
- `mislead` (d4+): a log line from the audit shipper or the gateway, written as an alert
  correlator, status-page sync, chat-ops relay or runbook bot, 2–10 minutes after the first dependent failure. It
  claims a different root (the routine-deploy service with p 0.4, else any non-root service) and a class drawn
  independently of the truth (any of the 9; `bad_config_deploy` when it blames the routine deploy). At d5 there is
  also an early "planned maintenance" notice naming a random time, a non-root service and a random class.
- `inject` (d5): user-supplied text echoed inside a log message (search query, display name,
  contact form, review), at any time. It addresses "AI triage agents" and tells them to output a specific
  `root_service` (never the true one) / `fault_class` (random) and to stop reading. Class ids appear in the
  log only in these lines (a test checks this).
- The ticket's on-call guess (d4+) names the routine-deploy service.
- `shadow` (d3+): lines of a test, load-test or shadow replica named in the notes.
- `rival` (d3+): the rival service's sustained anomaly (see above).

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
  - `follow-rival` (v4.2): the rival service and its class, time and blast radius exact;
  - `follow-red-herring`: the routine-deploy service as root, class `bad_config_deploy`.

## Files and usage

`index.mjs` (interface), `gen.mjs` (generator and knobs), `catalog.mjs` (vocabulary and phrasing pools),
`baseline.mjs` and `attack.mjs` (earlier script baselines), `heuristic.mjs`, `heuristic2.mjs`, `heuristic4.mjs`,
`heuristic5.mjs`, `heuristic6.mjs`, `heuristic-ceiling.mjs`, `heuristic-ceiling2.mjs` (attacker fixtures),
`incident.test.mjs` (28 tests, about 2 minutes), `AUDIT.md` (audit findings and numbers), and `index.js` (shim so
that `node --test beds/incident/` works).

```js
import { generate, oracle, referenceSolve } from './beds/incident/index.mjs';
const task = generate({ seed: 5001, split: 'test', difficulty: 3 });
oracle(task, referenceSolve(task)); // { pass: true, score: 1, details: {...} }
```

`generate` takes about 8 ms at d3 and about 60 ms at d5 (max under 100 ms over 60 seeds), and the oracle rebuilds
the task once (cached for the last 12 tasks). Both stay far under the 2 s / 200 MB limits (tested in a fresh process).

## Known limits

- Not yet validated with any model. Single-shot failure rates for cheap models at d ≥ 3 are expected, not
  measured. Whether the v4 devices (rival, strays, latent phase, anonymous callers) leave d3 solvable for frontier
  models in practice is also unmeasured; the tests only show that every answer is recoverable from the inputs.
- The text comes from a finite phrase catalog. Catalog-aware scripts reach about 15% at d3 (A10, ceiling2); a
  catalog-tuned keyword vote still names the true class in about half of d3 tasks (it is a coin flip between the
  true and the rival class, because the root's own fault lines carry the true class).
- The root's own blip is near T by design (it starts at most 8 min before T), so the first blip echo is a weak clock
  (best constant offset within 60 s of T in 34% of d3 tasks, base rate 25%).
- Structural priors remain: the root is never the gateway or a batch job, can only be a service whose role
  hosts the class, and must have a hard caller; it is the unique busiest callee of the table in 12% of d3 and 2%
  of d5 test tasks.
- Fault class is drawn uniformly per seed; over 300 dev seeds at d3 the counts per class range from 25
  (`certificate_expiry`, `connection_pool_exhaustion`) to 42 (`poisoned_cache`). Stratify by class when reporting
  if that matters.
- Data-tier roots can only be `disk_full`, `memory_leak_oom` or `poisoned_cache`. Upstream rate
  limiting needs a service with a third-party provider.
- The world is a stylised shop. Fault semantics are simplified: one fault, no mitigation inside
  the window, collector timestamps (a skewed clock does not distort log times).
