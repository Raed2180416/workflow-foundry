# Foundry laptop bridge: protocol, threat model, operations

The bridge lets the Workflow Foundry cloud session (no inbound connectivity, outbound HTTPS through
an egress proxy) drive GPU work on the owner's laptop (RTX 4060 8 GB). It has three uses: fine-tune
Kev-0.8B on uploaded data, serve Kev for `/v1/systemone`, and optionally serve GGUF models with
llama.cpp for an OpenAI-compatible endpoint.

Status: **built and tested on localhost with stub GPU programs, hardened after an adversarial review
(findings F1–F6, §5), and checked against a real cloudflared 2026.10.0 from the cloud container. It
has not yet run on the laptop, and a full round trip through a connected tunnel has not been
observed** (the cloud container cannot open cloudflared's edge connections; §9). The tests and their
results are listed in §9.

```
 cloud session                               GitHub (private repo)                    owner's laptop
 ─────────────                               ─────────────────────                    ──────────────
 bridge/cloud/cli.mjs ── git fetch ────────► branch foundry-bridge ◄── git push ──── daemon publisher
   (signs requests)                          bridge-state/keys/*.pub                  (endpoint.json, heartbeat)
        │                                    bridge-state/endpoint.json
        │                                    bridge-state/KILL (optional)
        │  HTTPS via egress proxy (CONNECT)
        ▼
 https://<random>.trycloudflare.com ──► Cloudflare edge ──► cloudflared ──► 127.0.0.1:8765 daemon
                                                                              ├─ jobs: python -m kev.train/benchmark/serve, llama-server
                                                                              ├─ files: ~/foundry-bridge/work/{data,runs,logs}
                                                                              └─ /svc/kev, /svc/llm/<name> → 127.0.0.1:<port>
```

| Component | File | Role |
|---|---|---|
| Laptop daemon | `bridge/laptop/daemon.mjs` (+ `jobs.mjs`, `config.mjs`, `publisher.mjs`, `tunnel.mjs`, `sysinfo.mjs`) | HTTP server on 127.0.0.1 only. Checks signatures, runs a fixed set of jobs, serves files, proxies to local model servers, publishes its tunnel URL. Node >= 20, no npm dependencies. |
| Cloud client | `bridge/cloud/client.mjs`, `cli.mjs`, `transport.mjs` | Signs requests, sends them through `HTTPS_PROXY` with a CONNECT tunnel, finds the endpoint through the mailbox. |
| Mailbox | `bridge/mailbox.mjs`, `bridge/cloud/init-mailbox.mjs` | Git helpers for the orphan branch `foundry-bridge`, used by both sides. |
| Shared | `bridge/common/protocol.mjs`, `relpath.mjs` | Canonical string, keys, signatures, nonce cache, path rules. |
| Laptop setup | `bridge/laptop/LAPTOP-HANDOFF.md` | Step-by-step instructions for the local Claude Code agent. |

## 1. Rendezvous: the mailbox branch

`foundry-bridge` is an orphan branch of the private repository. It never merges into another branch
and contains only `bridge-state/`:

| Path | Writer | Content |
|---|---|---|
| `bridge-state/README.md` | init | Explains the branch. |
| `bridge-state/keys/<label>-<keyid>.pub` | cloud or owner | Trusted Ed25519 public keys, PEM SPKI, at most 4 KiB each. Delete a file to revoke that key. |
| `bridge-state/endpoint.json` | laptop daemon | `{schema:"foundry-bridge/endpoint@1", state:"up"\|"stopped", url, tunnelSource, tunnelReadyConnections, daemonVersion, startedAt, heartbeatAt, gpu:{name,memoryTotalMiB,driver,cuda}, services:[{id,kind,name,state}]}`. It holds no secrets, paths or ports. `tunnelReadyConnections` is cloudflared's count of edge connections (`GET /ready`) at publish time: `0` means the URL exists but Cloudflare answers 530 / error 1033 until cloudflared connects; `null` means unknown. |
| `bridge-state/KILL` | anyone with write access | Kill switch (§6). |

Each side works in its own clone (default `~/.foundry-bridge/mailbox`), never in a working checkout.
A write fetches the branch (depth 1), resets the clone to the remote tip, applies the change, commits
and pushes. On a non-fast-forward rejection it waits with exponential backoff (1 s, 2 s, 4 s, … up to
60 s, with jitter, at most 7 attempts) and starts again from a fresh fetch. This is the same as
`pull --rebase` with one regenerated commit. It also works in a shallow clone, where a rebase can
fail. The code never force-pushes. Mailbox commits use the identity `foundry-bridge
<foundry-bridge@localhost>`.

**One git operation at a time per clone (F4).** Every git step on a clone (refresh, publish, key and
KILL changes, `daemon --check`) runs under one lock: a promise queue inside the process plus a lock
file `<clone>.lock` across processes. The holder touches the lock file every 30 s; a lock whose owner
process is gone (same host) or that has been silent for 2 min is taken over. Under the lock a leftover
`.git/index.lock` older than 10 s (from a git killed on timeout) is stale by construction and is
removed. In the daemon, refresh callers (the publisher's 5-minute tick and `git.refresh` jobs) are
coalesced: at most one refresh runs and one waits.

**Publisher cadence (laptop).** Every 15 s the publisher looks up the tunnel URL: first from
`--public-url`, then from cloudflared's `GET http://127.0.0.1:20241/quicktunnel`, then from the last
`https://<x>.trycloudflare.com` in `~/foundry-bridge/cloudflared.log`. A changed URL is published at
once. Every 5 min the publisher refreshes keys and the KILL flag with a git fetch. The heartbeat
republishes at least every 15 min, which is also the minimum interval. When cloudflared gains or
loses all of its edge connections, the endpoint is republished (at most once a minute), so
`tunnelReadyConnections` is not stale for a whole heartbeat. If a publish fails, it backs off from
30 s up to 15 min. When the daemon shuts down cleanly it publishes `state:"stopped", url:null`.

**Staleness (cloud).** `discover()` reports `ageMs` since `heartbeatAt`. It marks the endpoint
`stale` after 40 min, which is two missed heartbeats plus slack. A stale endpoint usually means the
laptop is asleep or offline.

## 2. Wire protocol

Every request except `GET /health` carries an Ed25519 signature over this canonical string:

```
METHOD "\n" path-with-query "\n" timestamp-ms "\n" nonce "\n" sha256hex(body)
```

- `METHOD` is upper case. `path-with-query` is the request target exactly as sent on the wire
  (`req.url`), percent-encoding included. Clients send only canonical targets made from the strict
  path alphabet (§4), so proxies have nothing to normalise.
- `timestamp-ms` is decimal milliseconds since the epoch. `nonce` is at least 16 random bytes in
  lowercase hex (32 to 128 characters). The hash of an empty body is `e3b0c442…b855`.

| Header | Value |
|---|---|
| `x-bridge-key` | Key id: the first 16 hex characters of sha256 over the raw 32-byte public key. |
| `x-bridge-ts` | The timestamp. |
| `x-bridge-nonce` | The nonce. |
| `x-bridge-sig` | Base64 Ed25519 signature (64 bytes) of the canonical string, `crypto.sign(null, …)`. |
| `x-bridge-body-sha256` | **Extension.** The body hash, announced in advance. Required for `PUT /files`. Optional elsewhere, but when present it must match the body. |

**The daemon checks in this order, and reads no body byte before step 6 says it may (F5):**

1. All four headers are present (`unsigned`).
2. The key id is known (`unknown_key`). With mailbox keys, if no refresh has succeeded for
   `keysMaxAgeHours` (24 h), every key is refused (503 `keys_stale`).
3. `|now − ts| ≤ 120 s` (`stale_timestamp`; `bad_timestamp` if not decimal).
4. The nonce is well formed and unused (`bad_nonce`, `replayed_nonce`).
5. The declared body size is within the limit (413). The limits are 256 MiB for `PUT /files` and
   1 MiB otherwise (`limits.fileBytes`, `limits.jsonBytes`).
6. The signature verifies (`bad_signature`):
   - **With `x-bridge-body-sha256`** (the client always sends it): the signature is verified against
     the announced hash **before the body is read**. The body is then read (or, for an upload,
     streamed to a temp file) and hashed; a mismatch is `body_hash_mismatch` and an upload is
     discarded. Uploads must announce (`body_hash_required`).
   - **Without it** (older or hand-made clients): the body is read first, so only a small one is
     accepted, at most `limits.unannouncedBodyBytes` (64 KiB). A larger declared or streamed body
     gets 413 with reason `body_hash_required` before anything is read past that bound.
7. The nonce is recorded only after the signature verifies, so a forged request cannot use up a
   legitimate nonce. Nonces are kept for 10 min (anchored in the request's own timestamp, so a
   forgotten nonce can never pass step 3 again). **They are journaled** to
   `<workdir>/state/nonces.log` before the request is acted on and reloaded when the daemon starts,
   so a restart does not reopen the replay window (F2). The journal is appended synchronously but not
   fsynced: it survives a daemon crash or restart, not necessarily a power loss in the same instant.
   It is compacted when most of its lines have expired. If it cannot be written, the daemon logs a
   warning, `/info` shows `nonces.journalError`, and replay protection holds in memory only. The cache
   holds at most 100,000 entries; when it is full the daemon refuses requests (503) instead of
   evicting nonces, because evicting would reopen a replay window.
8. The kill switch is clear (403 `killed`).

Hash comparisons use `crypto.timingSafeEqual`. Errors are JSON:
`{error, message, reason?, details?}`. Every response has a `Date` header. The client uses it after
a `stale_timestamp` refusal to correct its clock offset, then retries once.

## 3. Endpoints

| Method and path | Auth | Result |
|---|---|---|
| `GET /health` | none | `{ok, version}` only. `ok` is false while the kill switch is set. |
| `GET /ping` | signed | `{ok, keyId, version, protocol, time}` |
| `GET /info` | signed | OS (with WSL detection), node, python, torch (version, whether it is >= 2.6), Kev commit, GPU (`nvidia-smi`: name, memory, driver, CUDA), free disk in the workdir, services, queue, job record count, keys (count and source), nonce journal state, mailbox state, tunnel URL and `readyConnections`, kill flag, limits. |
| `GET /files?dir=<rel>[&recursive=1]` | signed | Lists a directory. Dotfiles are hidden and symlinks are shown but not followed. At most 5,000 entries. |
| `GET /files/<rel>` | signed | Streams the file with `x-bridge-sha256` and `content-length`. The client checks the hash. |
| `PUT /files/<rel>[?overwrite=1]` | signed, hash announced | Accepts **`data/` only**. `logs/` belongs to the daemon, and `runs/` holds checkpoints that Kev unpickles, so only jobs write there (F1). The upload streams to a hidden temp file and is renamed into place, then the daemon returns `{path,size,sha256}`. An existing file gets 409 unless `overwrite=1` is given. 507 when the upload would leave less than `limits.minFreeMiB` (2 GiB) free. |
| `POST /jobs` `{kind, params}` | signed | 202 with the job. Unknown kinds and unknown or invalid parameters get 400, with `details[]`. 429 `queue_full` past `limits.maxQueued` (32) queued GPU jobs, 409 for service conflicts, 503 `unsafe_torch` for `kev.*` jobs when the configured python's torch is older than 2.6, 507 when the disk is nearly full. A `git.refresh` submitted while one is already waiting returns that job with `coalesced:true`. |
| `GET /jobs`, `GET /jobs/<id>` | signed | Job list or record: `{id, kind, class, params, state, createdAt, startedAt, endedAt, exitCode, signal, error, result, outputs, log, outputDir, cancelRequested}` |
| `GET /jobs/<id>/log?offset=N[&limit=L]` | signed | `{data, offset, nextOffset, size, done, state}`. At most 1 MiB per call, never splitting a UTF-8 character. |
| `POST /jobs/<id>/cancel` (alias `/stop`) | signed | Cancels a queued or running job, or stops a service. Sends SIGTERM to the process group, then SIGKILL after 10 s. |
| `ANY /svc/kev/<path>` | signed | Proxies to the running `kev.serve` at `127.0.0.1:<port>/<path>`. |
| `ANY /svc/llm/<name>/<path>` | signed | Proxies to the named running `llama.serve`. |

**Proxy rules.** Requests go to the service only while it is `running` (ready); otherwise the
daemon answers 502 `service_not_running`. Upstream errors give 502 and timeouts give 504. The default
timeout is 300 s (`proxyTimeoutSeconds`). Before forwarding, the daemon strips `x-bridge-*`,
`authorization`, `proxy-authorization`, `cookie`, the hop-by-hop headers, `forwarded`,
`x-forwarded-*`, `x-real-ip`, `true-client-ip`, `cf-*` and `cdn-loop`. It sets `host`. Request
bodies are buffered (1 MiB limit) because they are signed. Responses stream through.

## 4. Jobs

Paths to python, the Kev checkout and llama-server come only from `bridge-config.json`, never from a
request. Each process is spawned with an argument array (`shell:false`) in its own process group,
with cwd set to the Kev checkout. The environment is minimal: basics, `CUDA_*`, `HF_*`, `PYTORCH_*`,
`TORCH_*`, `KEV_*` and the proxy and CA variables, then the operator's `env`, then
`PYTHONPATH=<kevDir>`, `PYTHONUNBUFFERED=1`, `PYTHONNOUSERSITE=1` and, always,
`TORCH_FORCE_WEIGHTS_ONLY_LOAD=1` (below). Variables whose names look secret
(`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, `*CREDENTIAL*`) are passed only if the operator
lists them in `envPassthrough`.

GPU jobs run **one at a time in FIFO order**. Services start immediately, are not queued, and run
until stopped. The program's stdout and stderr go to `logs/<id>.log`, together with a start line and
an end line from the daemon. The daemon takes the last line of the form `FOUNDRY_RESULT <json>` as
`result`. The job record is saved as `jobs/<id>.json` (saves of one job are serialized, so an older
state never overwrites a newer one), and after a restart, unfinished jobs are marked `lost`.

**Admission is atomic.** Each limit below is checked and claimed with no `await` in between, so
concurrent submissions cannot all pass a check that only one should pass.

**Resource limits (F3), all in `limits` in the config:**
- `maxQueued` (32): queued GPU jobs; more get 429.
- `maxJobRecords` (1000): finished records kept; older ones are deleted with their logs, at start and
  after every job. Records of successful `kev.train` jobs are never pruned, because they are the
  provenance that lets `runs/<jobId>` be loaded (below).
- `jobLogBytes` (512 MiB): a job whose log grows past this is stopped and marked failed.
- `minFreeMiB` (2048): uploads and new jobs are refused with 507 while the workdir's disk has less
  free space; `0` turns this off.
- One `git.refresh` runs and at most one waits; one `kev.serve`; at most `maxLlamaServices` (2)
  llama services; one service per port. The access log rotates at 10 MiB (one old file is kept).

**Checkpoints are loaded only from the daemon's own runs (F1).** Kev reads a run's `head.pt` with
`torch.load`, which unpickles, so a crafted `head.pt` is code execution unless the unpickler refuses
it. Three independent guards:
1. `runs/` is written only by jobs; the files API refuses uploads there.
2. A `run` or `initFrom` of the form `runs/<dir>` must be exactly `runs/<jobId>` of a `kev.train` job
   this daemon ran to success. When that job ended, the daemon recorded the sha256 of its `head.pt`
   in the job record; the file must still be a regular file (not a symlink) with that hash. Planted
   directories, benchmark outputs, failed runs and modified checkpoints are refused (400). The other
   accepted form is a hub id `jaredpalmer/kev-*`.
3. Every job runs with `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1` (and without
   `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD`): torch then loads every file weights-only, even where code
   passes `weights_only=False`. The config cannot override either variable. `kev.*` jobs are refused
   (503 `unsafe_torch`) unless the configured python has torch >= 2.6, the first release whose
   weights-only unpickler has no known bypass (CVE-2025-32434 affected 2.5.1 and earlier); the version
   is read from package metadata and cached for 10 min. `sys.selftest` checks the guard end to end: it
   pickles an object whose `__reduce__` calls `print` and loads it with `weights_only=False`; the
   selftest fails unless torch refuses it. Checked with the real Kev venv (torch 2.8.0): the gadget is
   refused, and the stock `jaredpalmer/kev-0.8b@v1.0` `head.pt` still loads through
   `kev.checkpoint.read_meta` (`bridge/test/kev-contract.test.mjs`).

| Kind | Class | Parameters (defaults) | Command |
|---|---|---|---|
| `sys.selftest` | gpu | none | `python -c <script>`: torch and CUDA versions, device, VRAM, bf16 support, a 4096² bf16 matmul (ms and TFLOPS), the pickle guard (`torch_weights_only_safe`, `pickle_guard: "refused"`), `import kev`, transformers and peft versions. Exits 1 without CUDA or without the guard. |
| `kev.train` | gpu | `dataset` (file under `data/`, required), `base` (`Qwen/Qwen3.5-0.8B-Base`, must match `^Qwen/Qwen3(\.N)?-<n>B(-Base)?$`), `initFrom` (`jaredpalmer/kev-0.8b@v1.0`, or `runs/<jobId>` of a successful `kev.train`, or `""` for none), `epochs` 1–10 (1), `lr` 1e-6–1e-3 (2e-5), `batch` 1–16 (1), `accum` 1–64 (8), `dtype` bf16\|fp32 (bf16), `maxState` 384–8192 (384), `checkpointing` 0\|1 (1), `lora` 4–64 (16), `extra` (allowlisted flags, below) | `python -m kev.train --data … --out runs/<jobId> --device <config.device> …` |
| `kev.benchmark` | gpu | `run` (hub id or `runs/<jobId>` of a successful `kev.train`), `data` (file under `data/`), `rotations` 1–8 (1) | `python -m kev.benchmark --run … --data … --out runs/<jobId>` |
| `kev.serve` | service | `run` (`jaredpalmer/kev-0.8b@v1.0`, or `runs/<jobId>` as above), `port` 8008–8099 (8008) | `python -m kev.serve --run … --host 127.0.0.1 --port …`, ready when `GET /v1/models` returns 200 |
| `llama.serve` | service | `name` (`^[a-z0-9][a-z0-9-]{0,31}$`), exactly one of `gguf` (a `.gguf` under `data/`) or `hf` (`{repo,file}` listed in the operator's allowlist file), `ctx` 256–131072 (4096), `ngl` 0–999 (99), `port` 8100–8199 (8100) | `llama-server -m … \| --hf-repo … --hf-file … --host 127.0.0.1 --port … -c … -ngl … --alias <name>`, ready when `GET /health` returns 200 |
| `git.refresh` | inline | none | Fetches the mailbox now and reloads keys and KILL. Returns `{head, keys, errors, killed}`. |

Hub ids for `run` and `initFrom` must match `^jaredpalmer/kev-[0-9.]+b(@v[0-9.]+)?$`.

`kev.train` `extra` accepts these flags: `perm_kl`, `perm_frac`, `ord_w`, `brier_w`,
`label_smoothing`, `focal_gamma`, `head_lr`, `weight_decay`, `seed`, `max_steps`, `lora_targets`,
`base_revision` (40 hex), `weights_dtype`, `replay`, `suite` (`evals/…` inside the Kev checkout, must
contain `manifest.json`), `p_none_pair`, `length_sort`, `row_budget` and `shared_prefix`. Each has a
bounded range, and anything else is refused. `bridge/test/kev-contract.test.mjs` checks that the real
`kev.train`, `kev.benchmark` and `kev.serve` parsers at the pinned Kev commit accept every command
line the daemon builds. Kev itself rejects some combinations, for example more than one of
`label_smoothing`, `brier_w` and `focal_gamma`, and such a job fails with Kev's message in its log.

States: `queued → running → succeeded | failed | cancelled` for GPU jobs, and
`starting → running → stopped | failed` for services. `lost` means the daemon restarted while the job
was unfinished. Default timeouts are 15 min for the selftest, 12 h for training and 4 h for
benchmarks. Services have no timeout, but must become ready within 20 min.

**Path rules** (`common/relpath.mjs`, applied by both client and daemon). A path has 1–32 segments.
Each segment matches `^[A-Za-z0-9][A-Za-z0-9._@+=,-]*$`, so there are no dotfiles, no `.`/`..`, no
leading `-`, no spaces, `%`, backslashes, NUL or drive letters, and no empty segments. The first
segment must be `data`, `runs` or `logs`. The daemon percent-decodes each segment before checking it,
so `%2e%2e`, `%2F` and `%5C` are refused. After that it compares realpaths: a symlink may point
anywhere inside its own top directory, but never outside it. Uploads walk the parent directories with
`lstat`, refuse to replace a symlink, and write a hidden temp file first.

## 5. Threat model

**Trust root: write access to the private GitHub repository.** Whoever can push to `foundry-bridge`
can add a key, and anyone holding a trusted private key can run the fixed set of jobs on the laptop
GPU. Today the people who can do that are the owner and the cloud session, through its private key
in `~/.foundry-bridge/cloud-ed25519.pem` (mode 0600, never printed, never committed).

**An attacker who only knows the tunnel URL can:**
- call `GET /health` and learn that a daemon of some version is up;
- send requests that are refused before routing. They cannot even learn which routes exist, because
  an unknown route answers 401 before it answers 404;
- learn whether a key id is trusted (`unknown_key` vs `bad_signature`; accepted, see below);
- try to flood the daemon. A request without a trusted key id is refused from its headers alone.
  A request with a trusted key id and a bad signature is refused before its body is read when it
  announces a body hash, and after reading at most 64 KiB when it does not (F5). Uploads must announce
  their hash, so nothing is written to disk without a valid signature. Cloudflare also limits quick
  tunnels to 200 requests in flight.

**That attacker cannot:**
- forge a request, which needs the Ed25519 private key;
- replay a request it captured: the nonce is refused while remembered (10 min, journaled across
  restarts, F2), and the 120 s window refuses it after that;
- alter the method, path, query or body of a captured request, all of which are signed;
- reach any port other than the daemon, which binds 127.0.0.1 only.

**A holder of a trusted key (the cloud session, or a leaked or prompt-injected one) can:** upload
files to `data/` (256 MiB each, until 2 GiB of disk is left); read files under `data/`, `runs/` and
`logs/`; run the registered jobs with schema-checked parameters (one GPU job at a time, at most 32
queued, each bounded by its timeout and log cap); start and stop the Kev and llama services and call
them through `/svc`; trigger a mailbox refresh. **It cannot:** run a command of its choice (fixed job
registry, argument arrays, no shell, binaries and paths from the operator's config); write outside
`data/`, or read outside `data/`, `runs/`, `logs/`; make Kev load a checkpoint the daemon did not
produce (F1, §4); make torch unpickle code (forced weights-only loading, torch >= 2.6 enforced);
exhaust the queue, job records or disk without hitting a limit (F3); wedge the mailbox with
concurrent git work (F4). Its blast radius is therefore the job registry, the workdir and the GPU's
time, **plus the parsers of the programs those jobs run** (next list).

**Residual risks. These are accepted, not solved:**
- **Cloudflare sees plaintext and sits on the path.** TLS ends at Cloudflare's edge. Datasets, model
  inputs and outputs and job logs are visible to Cloudflare. Responses are not signed, so Cloudflare,
  or anyone who can break TLS to it, could alter a response. Downloads are hash-checked, but the hash
  travels on the same channel. An on-path party can also hold back a signed request and deliver it
  once, later, within its 120 s window; the nonce is recorded only on delivery. Do not send data that
  must not leave the owner's control.
- **Untrusted inputs reach native and Python parsers.** Kev parses uploaded JSONL with Python's
  `json`. llama.cpp parses a `.gguf` from `data/` in C++; GGUF parser memory-safety bugs have been
  reported upstream, so a malicious GGUF from a key holder is a code-execution risk on the laptop. Use `hf` models from the
  operator's allowlist, or GGUF files the operator downloaded and checked (handoff §L), when that
  matters. Hub checkpoints are limited to `jaredpalmer/kev-*` and `Qwen/Qwen3*` bases, loaded with
  `trust_remote_code` off and weights-only.
- **Signatures do not cover the host.** A request signed for one daemon would be accepted by another
  daemon that trusts the same key and has not seen the nonce. Run one daemon per mailbox branch.
- **Repository write access is the root (F6).** Besides adding a key, a writer can point
  `endpoint.json` at another https origin. The cloud would then send its signed requests there; that
  origin sees what Cloudflare sees, can relay the requests unchanged to the real daemon within 120 s,
  and can return crafted responses. This is no more than adding a key already allows. `discover()`
  accepts only `https://` origins. Signing `endpoint.json` with a laptop key would close it; not built.
- **Authenticated callers learn some laptop paths.** Kev's `/v1/models` reports the absolute run path
  of a local run. Job logs show the program's own output. `/info` shows OS, GPU and versions. Job
  start lines mask the workdir and home directory.
- **Key ids are not secret.** Distinct error reasons (`unknown_key` and `bad_signature`) tell a
  prober whether a key id is trusted. This is accepted because it helps debugging, and a key id is
  useless without its private key.
- **Revocation is not instant.** Revoking a key or setting KILL takes effect at the next refresh: at
  most 5 min, or at once if a signed `git.refresh` arrives or the daemon restarts. If refreshes fail
  for 24 h (`keysMaxAgeHours`), the daemon refuses every key.
- **Quick tunnels come with no uptime guarantee.** The URL changes whenever cloudflared restarts, and
  the mailbox carries the new one.

**Adversarial review (2026-10-07).** A live attack battery against a daemon (59 defenses held) found:

| Id | Severity | Finding | Fix | Regression tests |
|---|---|---|---|---|
| F1 | high | A key holder could upload a crafted `head.pt` into `runs/` and have `kev.serve`/`kev.benchmark`/`kev.train --init_from` unpickle it; only torch's 2.6+ default stood in the way, unverified. | No uploads into `runs/`; `runs/<jobId>` provenance with the head.pt hash; `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1` in every job; torch >= 2.6 enforced; selftest checks the guard. | `hardening.test.mjs` F1 ×3, `daemon-files.test.mjs` (runs/ upload), `kev-contract.test.mjs` (real torch) |
| F2 | medium | Nonces were memory-only: a request replayed after a daemon restart, within 120 s, was accepted. | Nonce journal under `state/`, reloaded on start. | `hardening.test.mjs` F2 ×2 |
| F3 | medium | Unbounded queue, job records, logs and disk use from an authenticated caller. | `maxQueued`, `maxJobRecords` pruning, `jobLogBytes`, `minFreeMiB`; atomic admission. | `hardening.test.mjs` F3 ×5 |
| F4 | medium | `git.refresh` ran git on the mailbox clone concurrently with the publisher. | One lock per clone (in-process queue and lock file), coalesced refreshes, stale `index.lock` cleanup. | `hardening.test.mjs` F4 ×4 |
| F5 | low | A trusted key id with a bad signature could make the daemon buffer 1 MiB before verifying. | Verify against the announced hash before reading; unannounced bodies capped at 64 KiB. | `hardening.test.mjs` F5 |
| F6 | low/info | A repository writer can redirect the cloud to another endpoint. | Documented above (inside the trust root). | — |

## 6. Kill switch and revocation

From fastest to slowest:

1. **On the laptop:** run `bash bridge/laptop/run/stop.sh`, which stops the tmux session or the
   systemd units, or stop `cloudflared` alone. The URL dies at once and nothing can reach the daemon.
2. **From anywhere with repo write access:** run `node bridge/cloud/init-mailbox.mjs --kill`, or
   commit an empty `bridge-state/KILL` file. At the next refresh (at most 5 min) the daemon cancels
   every job, stops every service, refuses all signed requests with 403 and reports
   `/health {ok:false}`. Undo it with `--unkill`.
3. **Revoke one key:** run `node bridge/cloud/init-mailbox.mjs --revoke <keyid>`, or delete
   `bridge-state/keys/<file>`.
4. **Revoke repository access:** remove the cloud session's access to the repository, then do 3.

## 7. Using it from the cloud

```bash
node bridge/cloud/cli.mjs keygen                      # once: ~/.foundry-bridge/cloud-ed25519.pem (0600) + .pub
node bridge/cloud/init-mailbox.mjs                    # once: orphan branch + this key (see §8 if the push is refused)
node bridge/cloud/cli.mjs discover                    # endpoint URL, heartbeat age, keys, KILL
node bridge/cloud/cli.mjs ping                        # health + clock skew + a signed round trip
node bridge/cloud/cli.mjs selftest                    # GPU check on the laptop
node bridge/cloud/cli.mjs put mydata.jsonl data/mydata.jsonl
node bridge/cloud/cli.mjs job kev.train dataset=data/mydata.jsonl epochs=2 extra.seed=1   # -> job id
node bridge/cloud/cli.mjs wait <id>                   # streams the log; exit 0 ok, 3 failed/cancelled
node bridge/cloud/cli.mjs get runs/<id> ./runs/<id> --dir
node bridge/cloud/cli.mjs job kev.serve run=runs/<id> port=8008 && node bridge/cloud/cli.mjs wait <serve-id>
node bridge/cloud/cli.mjs req POST /svc/kev/v1/systemone --data @request.json
node bridge/cloud/cli.mjs cancel <serve-id>
```

From code, with the existing `SystemOneClient`:

```js
import { connect } from './bridge/cloud/client.mjs';
import { SystemOneClient } from './src/judgment.mjs';
const { client } = await connect();                    // FOUNDRY_BRIDGE_URL or discover()
const kev = new SystemOneClient({ url: `${client.endpoint}/svc/kev`, fetchImpl: client.bridgeFetch });
// OpenAI-compatible: base URL `${client.endpoint}/svc/llm/<name>/v1`, fetch = client.bridgeFetch
```

`bridgeFetch(input, init)` behaves like `fetch` and returns a WHATWG `Response`. It refuses URLs
outside the endpoint's origin, so it never signs a request for another host. Environment variables:
`FOUNDRY_BRIDGE_URL` skips discovery, and `FOUNDRY_BRIDGE_KEY`, `FOUNDRY_BRIDGE_REMOTE`,
`FOUNDRY_BRIDGE_BRANCH` and `FOUNDRY_BRIDGE_MAILBOX` override the defaults. `FOUNDRY_BRIDGE_ALLOW_LOCAL=1`
accepts `http://127.0.0.1` endpoints, for tests only.

**Egress proxy.** Node's `fetch` ignores `HTTPS_PROXY` unless the process starts with
`NODE_USE_ENV_PROXY=1`, and undici's `ProxyAgent` is not a public module in Node 24. So
`transport.mjs` implements the CONNECT tunnel with `node:http` and `node:tls`. It honours `NO_PROXY`
(exact names, suffixes, `*.` wildcards, IPv4 CIDR and `host:port`) and sends `Proxy-Authorization`
when the proxy URL has credentials. It verifies TLS against Node's default store, which includes
`NODE_EXTRA_CA_CERTS`, or against `/root/.ccr/ca-bundle.crt`. Verification is never disabled.

Checked from this cloud container on 2026-10-07: the egress proxy carries signed requests to an
https origin unchanged (method, path and query, all `x-bridge-*` headers and the body; the signature
verified from what the server received), and it reaches `*.trycloudflare.com` (Cloudflare answered
for a real quick-tunnel hostname). Throughput to Cloudflare through the proxy was 60–95 Mbit/s each
way; the laptop's upstream adds its own limit.

**Cloudflare quick-tunnel behaviour the client handles:**
- **530 with `error code: 1033`** means Cloudflare knows the hostname but no cloudflared is connected
  to it: the laptop is asleep or offline, or its cloudflared cannot reach Cloudflare. The client and
  CLI print that explanation; `cli.mjs discover` shows `tunnelReadyConnections` and warns at 0.
- **A brand-new hostname** is refused by the egress proxy (CONNECT 502) for about 2 s after
  cloudflared prints it. The client retries failures that happen before anything was sent (CONNECT
  refused, connection refused) for up to 10 s (`connectRetryMs`). It never retries a request that may
  have reached the daemon.
- Uploads larger than about 100 MB fail at the edge. Split the file, or let the laptop fetch it from
  the Hugging Face Hub.
- An origin response that takes longer than about 100 s returns 524. Jobs are asynchronous for this
  reason, and the client polls them.
- **Server-sent events do not pass a quick tunnel.** `bridgeFetch` refuses a request with
  `"stream": true` in its JSON body or `accept: text/event-stream` when the endpoint is
  `*.trycloudflare.com`, before sending anything; send `stream:false` to llama-server. (A named tunnel
  can stream: `new BridgeClient({ allowStreaming: true })`.)
- At most 200 requests in flight (429 beyond).

## 8. Deviations from the original specification, and why

| Spec | Built | Why |
|---|---|---|
| Body hash only inside the canonical string | Adds an optional `x-bridge-body-sha256` header, required for uploads. | Without it, an unauthenticated 256 MiB upload would have to reach disk before the signature could be checked. The canonical string is unchanged. |
| `PUT /files` under `data/`, `runs/`, `logs/` | `data/` only. | `logs/` holds the daemon's own job logs and access log, so the cloud could otherwise rewrite the evidence. `runs/` holds checkpoints that Kev unpickles (F1). |
| `run`: `runs/<id>` or an allowlisted hub id | `runs/<jobId>` of a `kev.train` job this daemon finished, with an unchanged `head.pt`, or the hub id. | F1: anything else under `runs/` is not known to be the daemon's own output. |
| Jobs: minimal env plus CUDA/HF variables | Also `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1`, always; `kev.*` refused below torch 2.6. | F1: the guard must not depend on Kev's call sites. |
| Nonce cache 10 min | Also journaled to `<workdir>/state/nonces.log`. | F2: replay after a restart. |
| Body over limit refused | Also: without `x-bridge-body-sha256`, at most 64 KiB is read before the signature check. | F5. |
| `maxState` 64–8192 | 384–8192 | `kev.train` refuses `--max_state` below `MAX_STATE` = 384 (kev/model.py at commit 5e42a7a). |
| Python 3.11/3.12 | Python 3.12 (3.13 also works) | Kev's `pyproject.toml` requires `>=3.12,<3.14`. |
| On non-fast-forward: `pull --rebase` | Fetch, reset to the tip, re-apply, commit, push, with backoff. | Gives the same result. It is more robust in a shallow clone, and the daemon regenerates its file anyway. Still never force-pushes. |
| Mailbox branch created by the cloud | The cloud tries first. If the push is refused, the operator runs the same script on the laptop with the cloud's **public** key. | The cloud session's git proxy may only allow pushes to the session branch. This cannot be checked without pushing. `init-mailbox.mjs` prints the fallback when the push fails. |
| Services and the GPU queue | Services (kev.serve, llama.serve) are not queued, and they share VRAM with a training job. | Queuing them behind training would stop serving for hours. On 8 GB, stop the services before a large training run. |
| Not in the spec | `GET /ping`, `GET /jobs`, `POST /jobs/<id>/stop`, CLI `ls`, `jobs`, `req`, `get --dir`, daemon `--check`, `keysMaxAgeHours` fail-closed, `state:"stopped"` on shutdown, `git.refresh` returning the key ids, `tunnelReadyConnections`, the F3 limits | Additions for diagnosis, for an agent operator, and from the adversarial review. |
| Config file | Must exist; a missing `--config` (or default path) is exit 2, never built-in defaults. The run scripts and the systemd unit do not restart on exit 2. | The e2e run found the daemon silently starting on defaults (a new workdir) after a typo. Write `{}` to a file to run on defaults deliberately. |
| llama `hf` model pinned | `--hf-repo`/`--hf-file` from the allowlist, with no revision pin. | llama-server cannot pin a Hub revision. For a pinned run, download the file at the allowlisted revision, check its sha256, and use `gguf: data/…`. |

## 9. Evidence and unknowns

**Tests.** `node --test bridge/test/*.test.mjs` runs with no network: 86 tests, 83 pass, and 3 are
skipped unless a real Kev checkout and venv are given (with `/opt/kev-venv` and the Kev checkout
here: 86 of 86 pass). They cover:
- canonicalisation;
- every rejection path: unsigned, partial headers, unknown key, wrong key, stale timestamp in both
  directions, replay (live and across a restart), malformed nonce, tampered method, path, query or
  body, announced-hash mismatch, oversize declared and chunked, bad signature before the body is read,
  unannounced bodies over 64 KiB, unknown route, revoked key and kill switch;
- path traversal: dot segments, `%2e%2e`, `%2F`, `%5C`, backslashes, NUL, absolute paths, drive
  letters, dotfiles, other top directories, symlink escapes on GET, PUT and listing, symlink targets,
  uploads into `runs/` and `logs/`;
- the job registry and schemas; checkpoint provenance (planted, disguised, benchmark, failed,
  modified and symlinked runs); the torch version gate; the forced weights-only environment;
- the FIFO queue, its cap under concurrency, cancel, timeout, log cap, record pruning, disk-full 507,
  restart → `lost`;
- services and the proxy, with header stripping; concurrent service submissions;
- the mailbox: orphan creation, idempotence, a non-fast-forward race, keys, KILL and URL republish,
  two instances on one clone, the lock file (live, timed out, dead holder), stale `index.lock`,
  coalesced refreshes, readiness republish;
- the CONNECT transport, against a local proxy and a TLS target; edge-error explanations, connect
  retries, the streaming refusal;
- a missing config file; an abandoned download;
- in-process end-to-end runs: the client, the CLI and `SystemOneClient` through `bridgeFetch`.

Each review finding and e2e follow-up has a regression test in `bridge/test/hardening.test.mjs`; the
queue-cap, service-limit and refresh-coalescing tests fail against the previous `jobs.mjs`.

**Contract with real Kev.** With `FOUNDRY_BRIDGE_KEV_PYTHON` and `FOUNDRY_BRIDGE_KEV_DIR` set, the
real argument parsers at commit 5e42a7a accept every command line the daemon builds, the bundled smoke
dataset loads through `kev.data.load_records` and `materialize`, and under the daemon's job
environment the selftest reports `pickle_guard: "refused"` and the cached `jaredpalmer/kev-0.8b@v1.0`
`head.pt` (snapshot bf75a6a8) loads through `read_meta`. All 3 passed here with the CPU venv
(torch 2.8.0+cpu). Without the forced flag the same venv runs the gadget when `weights_only=False` is
passed, which is why the flag is set rather than relying on Kev's call sites.

**cloudflared, from this container (2026-10-07, cloudflared 2026.10.0, binary sha256
`d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db`, cross-checked against Cloudflare's
apt repository):**
- `cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:20241 --url http://127.0.0.1:8765`
  registers a quick tunnel, and `GET 127.0.0.1:20241/quicktunnel` returns
  `{"hostname":"<words>.trycloudflare.com"}` (the daemon's `--check` found it through the metrics
  source).
- It cannot connect from here: outbound port 7844 (UDP for QUIC, TCP for `--protocol http2`) is
  blocked, and cloudflared dials the edge directly, ignoring `HTTPS_PROXY`. `GET /ready` then answers
  503 with `readyConnections: 0`, and the public URL answers 530 / error 1033.
- **So a full round trip cloud → tunnel → daemon has not been observed.** The same command sequence
  ran locally against the daemon (ping, info, 5 MiB up and down with matching sha256, train, wait,
  download the run, serve, `/svc/kev/v1/systemone`, cancel, 502 afterwards) in 0.1–1.2 s per call.

**Unknown until the laptop runs it:**
- the round trip through a connected quick tunnel;
- real CUDA training time and peak VRAM on the RTX 4060, with `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1`
  (expected to be harmless: Kev's own loads are already weights-only by default on torch 2.8);
- whether the owner's network allows outbound port 7844;
- WSL idle shutdown;
- whether this cloud session may push the `foundry-bridge` branch.

A manually triggered GitHub Actions job could run cloudflared and the daemon with stub programs
(GitHub-hosted runners can reach port 7844) to observe the round trip before the laptop is ready. It
needs a workflow file in the repository and the owner's approval; it has not been done.
