# Workflow  (wf_0ef730df-c61)

status: running (no final record yet); finished agents: 1

## Script

```js
(script not recorded)
```

## Agent result 1

I built Kev JSONL files for all six wave-A generator groups, in all seven slices, at the §4.3 sizes for the 20K curve point (the largest size the build supports today), and they passed the build's leakage checks. Two ports fail the §2.7 decidability audit and are excluded: F1 and R1. The OOD slices are development-only, because the held-out authored lines have not been through the required two-model filter.

The other groups (heldout-author, train-pools, served-scorer-jobs) supply inputs or job tooling and have no datasets of their own. Incident and synth (wave B) were not built and are deferred. No hosted calls ($0), no GPU or `kev.train` jobs, and no git or `src/` changes.

**One thing I had to add.** The assembly group, which is supposed to feed held-out material into the generators for the OOD slices, isn't written yet. I wrote a development stand-in under `experiments/kev-data/out/assembly/`:
- `assembly.mjs` reads the held-out store per slice through `heldout/surface.mjs` and converts held-out lines into the records line format.
- It caps the per-world kinetics, runbook and interactive generators at the §4.3 row counts, keeping pairs together.
- It registers held-out family spans into the span registry while each build runs.
- It drops and counts any state that hits a registered span, and any repeated state per port in the test slices.
- Build manifests carry only digests, never held-out text.

**Build manifest** (full details are in `experiments/kev-data/out/wave-a-manifest.json`):
- Builds: `/var/tmp/foundry-work/kev/builds/<buildId>/kev/<slice>.jsonl`, each with a `.meta.jsonl` sidecar (228 MB in total).
- Bed pin: sha256:d5ea2724…; spec: sha256:12c0b03d….
- Kev 5e42a7a0 with tokenizer Qwen3.5-0.8B-Base@dc7cdfe2.
- Every record passed Kev `fits()` at its build's job maxState (p99.9).
- Rebuilding kinetics gave a byte-identical manifest and identical file hashes.

Each cell is records / sha256 of the Kev file. "fits384" means every state in the slice is at most 384 real tokens, which is the condition for sending a file to `kev.benchmark --data` in J1.

| group (buildId, job maxState) | train | calib-in | calib-ood | dev-select | dev-ood | test-in | test-ood |
|---|---|---|---|---|---|---|---|
| records-notes (kd-f96cdf39cf05af26, 1855) | 4799 e50c119f33560d4aef6a93861bcc4233891362bf5ebcdf91ba8bd7b38938654f | 1410 76849e7a67d196de9b5175ab89cc87a9e78a8262a415a41d4dd2b362baa8e597 | 2728 5f0f72e10ccf358dfdded581604187ee07a3453cb6fb8594a7c1dd745bf1188c | 935 80331e3475211d42806983ebc6315f5f0c5979ba99775c5cbf4d0f00e6cdf146 | 3270 a78d6243c50e7e8b2634be6259d893edc5df8e2fed1814032e5c10825a12c4f6 | 2410 6da0d73466430d5f639b3316e820bf88b0bb471fa83fa04b329812279b47c154 | 20193 231d598b231fb63fef0e9a796560fc74a928aa30472b37ab06e8a741ea75da07 |
| kinetics (kd-066639ecd1eed9f9, 2056) | 4026 ee18cf2df32de61c664c6d826b3d384219d3f141b7c9059441d12a3ff54c03dc | 450 73540b52da4799c287d1bab2e8d4c15c68ae60d1df155dd83b66a276fabdbff4 | 750 6f5f245b351322babd51b34e495acd68526ddc0ec4f7463ce81c5bd808fe446d | 461 d1d34f6fa6adc40a0a621b00185b697f361600cf42ad339e2a3a7b98c67c40a6 | 900 33702049acb9dc37cfb8f9ed934367d9f61a9a401f16e638ecfefba4d1317cc6 | 750 ff1d06dd74075b49dc9e9608ade20cd1eb12b28dec09b5b69191b7c66e18ce0d | 3915 6fcf19cbdf5f1ae102c91acffd8d09c8d56b3c905ddca7df6f398c14c9c1362d |
| runbook (kd-0b31edcda341fe60, 1721) | 1349 bd8cafb63eb0a59047468f3ff549af6549a7973dd38507e1d757591bb38057c0 | 183 491e8f030cc55ac55d1958219c0606a3ca031460ed0ddccbe68fb7c2c7d3f141 | 342 2bbe68a014544d5d13e047858672765ee7df25e849a9462808c3a74878700420 | 158 e431400e7d8b7502ba329b22e06ae505b0821da012cbed4587a69078a2160f53 | 398 d79b4daf3aef106b57bd5aca5064ea0522b12a6bcfd0567fe391c8b45902f7e0 | 333 5135e9f65fa4fda236df6c95c510491944ef8158c433c5b410fce55c6e46e071 | 2141 d6367620ae1cf4e83485a9d6e4c34e221a2533e10e9d47483f6a2bc8c78362b6 |
| interactive (kd-b75fbe30ad81c032, 384) | 2496 ca7c9147cea62646f521d1ce4e348b5a016e1e13c65e8414a5dde00902ede627 | 198 38fe8439fc962a143fe9b91d4e77ea15228d229068228e3a96400551e758af34 | 350 d63ea241d9508d5fa9207afe5a90d5aa0f03515f26c83ac86508e17c612d74c0 | 487 9459e2fce44872aa5d0ae0a29587b13b125081f3d73f7afe71aa4a1d3eac32f7 | 400 8afc61ad8dfdcbcbd306cdb395210004fb3198ce2890b9d7ffa265e19388caa2 | 333 c3b9f900095c314925a6a7c01a1c81ab903d82448d0c500f587165156051acf0 | 2154 a6cfac48ecd73c16d49d8c5f94a8ba40c4f9a886fc97e5e6142fdf9f3525e11c |
| failures-code (kd-12e1aac515c0dbcb, 726) | 2483 e3001c1d4c38e3baafbddef5b48f7aca373185956a1943a8e6069df5b0ed3a55 | 332 041b4cd6671e9f6653cd33f6aa95b4d9c93543fb17c9f3d284974a6f0d4c2760 | 590 ec26174e0b020b4ce3d2a602417e5b3116a2b37e25a7e582eff241324cf2a5c5 | 327 eb1bd1e3cfc9a572821d98873205604ab2f1e8e750c902a3efa1945701934e0e | 658 8c4d422b5ff21e9d254b372a8167e2261f8bc580050bf68fab79e23f28eb47c5 | 580 fbbf95939e3f2b519f5fea1aa1b95d2cd2cb0ad20fef22ae9be0488fb198d536 | 2012 6599d2e0a450e407f5c54af65441ee357232e638fe2ae91c6857b22d37f81f92 |
| construction-crossfamily (kd-d6e318eda0d2e986, 3194) | 1700 e471a73bbeb3fc8217a4de256ff028e2c9556c63d6c1f9d98ba217e32a1154ec | 75 aba787de12b958bbd77e23a9ea2f8228efdde00eb8ef9682af1ec0c643d41c9e | 250 86326a23a5224f76f9739b935ba2fb8c768f3a1e4cef0465300e09a091bc4443 | 459 2138bc0c136d30f03ad9af8638d5fc17e352a7bb8c707c9a42ac91f914099e9a | 250 d7636b4e2f27c3a41f65e4be6765455d0a3b35bb85bd88d529055a5b8b73da5a | 125 5232962207ea4d5377a4138896a09080e8411b02ab4321a5580389e922ab31e3 | 1304 d744615955abacaf11a18f7489e533e241443219fd2a74702c0d5cb32edf4a39 |

- **Token fit:** all interactive slices fit 384. Kinetics fits 384 except train and test-ood, runbook except test-ood, and failures-code only in calib-in, calib-ood, dev-ood and test-in. Records and construction never fit 384, so those files go through `score-served` in J1. Per-port token p50/p90/max are in the manifest.
- **Shortfalls against the targets** (reported, not padded):
  - Records R1 train: 1182 of 1290.
  - Runbook: X1 train 222 of 323, X4 159 of 300. Pool-line states repeat across slices and the build keeps each state in the evaluation slice that claims it first.
  - Smoke-set gaps: kinetics dev-select K2 10, K3 12 and X4 42 of 100 each; failures-code F2 test-ood 82 of 100.
  - X1:records test-ood: 142 of the 192 rows in its §4.3 axes.

**Audit results** (§2.7 steps 1–3 and 8 over the built files; full numbers in `experiments/kev-data/out/audit-wave-a.json`). For held-out and test slices I read counts only, never content.
- **Leakage:**
  - Every build passed its own record, wording, span-registry and reserved-world checks, plus its post-write verification.
  - A re-scan found no forbidden state keys and no held-out wording outside its slice.
  - It also found no train, calib-in or dev-select state matching the combined registry (heldout-author entries plus every group's registered held-out spans).
  - No state hash appears in more than one build.
  - The stand-in dropped 64 records for span leaks; records-notes was the only group affected (counts are in its summary).
- **Passing:** every other port and family. Where a state-only solver exists, label accuracy on decided rows is 100% (coverage is ≥ 99% except X1:runbook, where authored lines are labelled by their brief). Name-masked collisions are under 1% and there are no exact-state collisions.
- **R1 excluded:** solver coverage is 98.4% in calib-in and 98.8% in test-ood, below the 99% gate; the solver never disagrees with a label.
  - The misses are mostly train-pool paraphrases where the label sits in a filled example date or city. The records solver reports those as conflicts; I added an audit-only second path that reads the filling and resolves most of them.
  - There are also a few OOD lines with no deciding sentence.
  - The program's remedy is to drop the undecided rows, about 0.5–1.6% per slice.
- **F1 excluded:** its states carry `last_events` and `env_diff`, but the frozen contract in `spec/ports.json` declares neither, so they have no provenance (step 3). Train also has 1.06% name-masked collisions.
  - The fix is a contracts-lib spec amendment.
  - F1's solver (`solveF1`) is a heuristic rule, so its 92–95% agreement is reported but not used as a gate.
- **Not run:** steps 6 and 7 (blind read, partial-input ceilings) and the probe-hard quota belong to shortcut-audit, which isn't built.

**Tests:** `node --test --test-concurrency=2 experiments/kev-data/test/*.test.mjs` ran 399 tests: 394 pass, 4 fail, 1 skipped.
- Three failures are in `incident.test.mjs`, the parked wave-B group.
- One is in `heldout-author.test.mjs`: `heldout-manifest.json` was built against spec sha256:001433d7…, but the current spec is 12c0b03d…. The held-out material needs a rebuild and copy-filter run against the current spec.

**What blocked or limits these files:**
- The two-model filter (Sonnet and Opus) has not run. Every authored OOD line is still pending, so calib-OOD, dev-OOD and test-OOD are not claim-bearing.
- The real assembly group doesn't exist; my stand-in replaces it.
- Records doesn't use the held-out X8 conventions lines. It drops nondeciding, carrier and assumption lines that contain `{S2}`, `{city}` or `{country}` (counted per slice), and it splits held-out X1 negatives into benign and decoy by hash, because the store only labels them yes/no.
- Not built: X1 deepset, X8 records-real and the end-to-end reserve slices.

Files are in `experiments/kev-data/out/`:
- `wave-a-manifest.json`
- `audit-wave-a.json`
- `assembly/` (`assembly.mjs`, `build-wave-a.mjs`, `audit-wave-a.mjs`, `summarize-wave-a.mjs`, `gen-*.mjs`)

The `out/` directory isn't gitignored. Per-group summaries and registry hashes are in `/var/tmp/foundry-work/kev/builds-summaries/` and logs in `/var/tmp/foundry-work/kev/logs/`.
