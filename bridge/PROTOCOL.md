# Foundry laptop bridge: protocol, threat model, operations

The bridge lets the Workflow Foundry cloud session (no inbound connectivity, outbound HTTPS through
an egress proxy) drive GPU work on the owner's laptop (RTX 4060 8 GB). It has three uses: fine-tune
Kev-0.8B on uploaded data, serve Kev for `/v1/systemone`, and optionally serve GGUF models with
llama.cpp for an OpenAI-compatible endpoint.

Status: **built and tested on localhost with stub GPU programs. It has not yet run on the laptop.**
The tests and their results are listed in §9.

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
| `bridge-state/endpoint.json` | laptop daemon | `{schema:"foundry-bridge/endpoint@1", state:"up"\|"stopped", url, tunnelSource, daemonVersion, startedAt, heartbeatAt, gpu:{name,memoryTotalMiB,driver,cuda}, services:[{id,kind,name,state}]}`. It holds no secrets, paths or ports. |
| `bridge-state/KILL` | anyone with write access | Kill switch (§6). |

Each side works in its own clone (default `~/.foundry-bridge/mailbox`), never in a working checkout.
A write fetches the branch (depth 1), resets the clone to the remote tip, applies the change, commits
and pushes. On a non-fast-forward rejection it waits with exponential backoff (1 s, 2 s, 4 s, … up to
60 s, with jitter, at most 7 attempts) and starts again from a fresh fetch. This is the same as
`pull --rebase` with one regenerated commit. It also works in a shallow clone, where a rebase can
fail. The code never force-pushes. Mailbox commits use the identity `foundry-bridge
<foundry-bridge@localhost>`.

**Publisher cadence (laptop).** Every 15 s the publisher looks up the tunnel URL: first from
`--public-url`, then from cloudflared's `GET http://127.0.0.1:20241/quicktunnel`, then from the last
`https://<x>.trycloudflare.com` in `~/foundry-bridge/cloudflared.log`. A changed URL is published at
once. Every 5 min the publisher refreshes keys and the KILL flag with a git fetch. The heartbeat
republishes at least every 15 min, which is also the minimum interval. If a publish fails, it backs
off from 30 s up to 15 min. When the daemon shuts down cleanly it publishes `state:"stopped", url:null`.

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

**The daemon checks in this order:**

1. All four headers are present (`unsigned`).
2. The key id is known (`unknown_key`).
3. `|now − ts| ≤ 120 s` (`stale_timestamp`).
4. The nonce is well formed and unused (`bad_nonce`, `replayed_nonce`).
5. The declared body size is within the limit (413). The limits are 256 MiB for `PUT /files` and
   1 MiB otherwise, set in `limits` in the config.
6. The signature verifies (`bad_signature`). An upload is verified against the announced hash
   **before any byte is written**. The bytes are then hashed as they stream, and the file is
   discarded on a mismatch (`body_hash_mismatch`). Any other request has its body read, bounded by
   the limit, and hashed before verification.
7. The nonce is recorded only after the signature verifies. A forged request therefore cannot use
   up a legitimate nonce. Nonces are kept for 10 min. The cache holds at most 100,000 entries, and
   when it is full the daemon refuses requests (503) instead of evicting nonces, because evicting
   would reopen a replay window.
8. The kill switch is clear (403 `killed`).

Hash comparisons use `crypto.timingSafeEqual`. Errors are JSON:
`{error, message, reason?, details?}`. Every response has a `Date` header. The client uses it after
a `stale_timestamp` refusal to correct its clock offset, then retries once.

## 3. Endpoints

| Method and path | Auth | Result |
|---|---|---|
| `GET /health` | none | `{ok, version}` only. `ok` is false while the kill switch is set. |
| `GET /ping` | signed | `{ok, keyId, version, protocol, time}` |
| `GET /info` | signed | OS (with WSL detection), node, python and Kev commit, GPU (`nvidia-smi`: name, memory, driver, CUDA), free disk in the workdir, services, queue, keys (count and source), mailbox state, tunnel URL, kill flag. |
| `GET /files?dir=<rel>[&recursive=1]` | signed | Lists a directory. Dotfiles are hidden and symlinks are shown but not followed. At most 5,000 entries. |
| `GET /files/<rel>` | signed | Streams the file with `x-bridge-sha256` and `content-length`. The client checks the hash. |
| `PUT /files/<rel>[?overwrite=1]` | signed, hash announced | Accepts `data/` and `runs/` only, because `logs/` belongs to the daemon. The upload streams to a hidden temp file and is renamed into place, then the daemon returns `{path,size,sha256}`. An existing file gets 409 unless `overwrite=1` is given. |
| `POST /jobs` `{kind, params}` | signed | 202 with the job. Unknown kinds and unknown or invalid parameters get 400, with `details[]`. |
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
`PYTHONPATH=<kevDir>` and `PYTHONUNBUFFERED=1`. Variables whose names look secret
(`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, `*CREDENTIAL*`) are passed only if the operator
lists them in `envPassthrough`.

GPU jobs run **one at a time in FIFO order**. Services start immediately, are not queued, and run
until stopped. The program's stdout and stderr go to `logs/<id>.log`, together with a start line and
an end line from the daemon. The daemon takes the last line of the form `FOUNDRY_RESULT <json>` as
`result`. The job record is saved as `jobs/<id>.json`, and after a restart, unfinished jobs are
marked `lost`.

| Kind | Class | Parameters (defaults) | Command |
|---|---|---|---|
| `sys.selftest` | gpu | none | `python -c <script>`: torch and CUDA versions, device, VRAM, bf16 support, a 4096² bf16 matmul (ms and TFLOPS), `import kev`, transformers and peft versions. Exits 1 without CUDA. |
| `kev.train` | gpu | `dataset` (file under `data/`, required), `base` (`Qwen/Qwen3.5-0.8B-Base`, must match `^Qwen/Qwen3(\.N)?-<n>B(-Base)?$`), `initFrom` (`jaredpalmer/kev-0.8b@v1.0`, or `runs/<dir>` with `head.pt`, or `""` for none), `epochs` 1–10 (1), `lr` 1e-6–1e-3 (2e-5), `batch` 1–16 (1), `accum` 1–64 (8), `dtype` bf16\|fp32 (bf16), `maxState` 384–8192 (384), `checkpointing` 0\|1 (1), `lora` 4–64 (16), `extra` (allowlisted flags, below) | `python -m kev.train --data … --out runs/<jobId> --device <config.device> …` |
| `kev.benchmark` | gpu | `run` (hub id or `runs/<dir>`), `data` (file under `data/`), `rotations` 1–8 (1) | `python -m kev.benchmark --run … --data … --out runs/<jobId>` |
| `kev.serve` | service | `run` (`jaredpalmer/kev-0.8b@v1.0`), `port` 8008–8099 (8008) | `python -m kev.serve --run … --host 127.0.0.1 --port …`, ready when `GET /v1/models` returns 200 |
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
- call `GET /health` and learn that a daemon of version 0.1.0 is up;
- send requests that are refused before routing. They cannot even learn which routes exist, because
  an unknown route answers 401 before it answers 404;
- try to flood the daemon. Unauthenticated requests are rejected from their headers alone, before
  the body is read. An upload must announce its hash, so an attacker cannot make the daemon write to
  disk. Cloudflare also limits quick tunnels to 200 requests in flight.

**That attacker cannot:**
- forge a request, which needs the Ed25519 private key;
- replay a request, because of the nonce and the 120 s window;
- alter the method, path, query or body of a captured request, all of which are signed;
- reach any port other than the daemon, which binds 127.0.0.1 only. Local services are reachable only
  through `/svc`, and only while they run;
- run arbitrary commands. Job kinds are a fixed registry, parameters follow explicit schemas,
  processes get argument arrays with no shell, and paths come from the operator's config;
- read or write outside `~/foundry-bridge/work/{data,runs,logs}`. Uploads are limited to `data/` and
  `runs/`.

**Residual risks. These are accepted, not solved:**
- **Cloudflare sees plaintext.** TLS ends at Cloudflare's edge. Datasets, model inputs and outputs
  and job logs are visible to Cloudflare. Responses are not signed, so Cloudflare, or anyone who can
  break TLS to it, could alter a response. Downloads are hash-checked, but the hash travels on the
  same channel. Do not send data that must not leave the owner's control.
- **A leaked cloud private key** gives its holder the same powers as the cloud session until the key
  is revoked: it can submit any registered job, read the files and use the services. It still cannot
  get a shell or reach other files.
- **Authenticated callers learn some laptop paths.** Kev's `/v1/models` reports the absolute run path
  of a local run. Job logs show the program's own output. `/info` shows OS, GPU and versions. Job
  start lines mask the workdir and home directory.
- **Key ids are not secret.** Distinct error reasons (`unknown_key` and `bad_signature`) tell a
  prober whether a key id is trusted. This is accepted because it helps debugging, and a key id is
  useless without its private key.
- **Kev and llama.cpp process trusted inputs only.** A malicious dataset, GGUF file or model could
  exploit a bug in torch, transformers or llama.cpp. GGUF files and `hf` models are limited to `data/`
  and the operator's allowlist, and hub runs to `jaredpalmer/kev-*`.
- **Revocation is not instant.** Revoking a key or setting KILL takes effect at the next refresh: at
  most 5 min, or at once if a signed `git.refresh` arrives or the daemon restarts. If refreshes fail
  for 24 h (`keysMaxAgeHours`), the daemon refuses every key.
- **Quick tunnels come with no uptime guarantee.** The URL changes whenever cloudflared restarts, and
  the mailbox carries the new one.

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

**Cloudflare quick-tunnel limits:**
- Uploads larger than about 100 MB fail at the edge. Split the file, or let the laptop fetch it from
  the Hugging Face Hub.
- An origin response that takes longer than about 100 s returns 524. Jobs are asynchronous for this
  reason, and the client polls them.
- Server-sent events are not supported, so use non-streaming requests to llama-server.

## 8. Deviations from the original specification, and why

| Spec | Built | Why |
|---|---|---|
| Body hash only inside the canonical string | Adds an optional `x-bridge-body-sha256` header, required for uploads. | Without it, an unauthenticated 256 MiB upload would have to reach disk before the signature could be checked. The canonical string is unchanged. |
| `PUT /files` under `data/`, `runs/`, `logs/` | `data/` and `runs/` only. | `logs/` holds the daemon's own job logs and access log, so the cloud could otherwise rewrite the evidence. |
| `maxState` 64–8192 | 384–8192 | `kev.train` refuses `--max_state` below `MAX_STATE` = 384 (kev/model.py at commit 5e42a7a). |
| Python 3.11/3.12 | Python 3.12 (3.13 also works) | Kev's `pyproject.toml` requires `>=3.12,<3.14`. |
| On non-fast-forward: `pull --rebase` | Fetch, reset to the tip, re-apply, commit, push, with backoff. | Gives the same result. It is more robust in a shallow clone, and the daemon regenerates its file anyway. Still never force-pushes. |
| Mailbox branch created by the cloud | The cloud tries first. If the push is refused, the operator runs the same script on the laptop with the cloud's **public** key. | The cloud session's git proxy may only allow pushes to the session branch. This cannot be checked without pushing. `init-mailbox.mjs` prints the fallback when the push fails. |
| Services and the GPU queue | Services (kev.serve, llama.serve) are not queued, and they share VRAM with a training job. | Queuing them behind training would stop serving for hours. On 8 GB, stop the services before a large training run. |
| Not in the spec | `GET /ping`, `GET /jobs`, `POST /jobs/<id>/stop`, CLI `ls`, `jobs`, `req`, `get --dir`, daemon `--check`, `keysMaxAgeHours` fail-closed, `state:"stopped"` on shutdown, `git.refresh` returning the key ids | Additions for diagnosis and for an agent operator. |
| llama `hf` model pinned | `--hf-repo`/`--hf-file` from the allowlist, with no revision pin. | llama-server cannot pin a Hub revision. For a pinned run, download the file at the allowlisted revision, check its sha256, and use `gguf: data/…`. |

## 9. Evidence and unknowns

**Tests.** `node --test bridge/test/*.test.mjs` runs with no network: 65 tests, 63 pass, and 2 are
skipped unless a real Kev checkout and venv are given. They cover:
- canonicalisation;
- every rejection path: unsigned, partial headers, unknown key, wrong key, stale timestamp in both
  directions, replay, malformed nonce, tampered method, path, query or body, announced-hash mismatch,
  oversize declared and chunked, unknown route, revoked key and kill switch;
- path traversal: dot segments, `%2e%2e`, `%2F`, `%5C`, backslashes, NUL, absolute paths, drive
  letters, dotfiles, other top directories, symlink escapes on GET, PUT and listing, symlink targets;
- the job registry and schemas;
- the FIFO queue, cancel, timeout and restart → `lost`;
- services and the proxy, with header stripping;
- the mailbox: orphan creation, idempotence, a non-fast-forward race, keys, KILL and URL republish;
- the CONNECT transport, against a local proxy and a TLS target;
- in-process end-to-end runs: the client, the CLI and `SystemOneClient` through `bridgeFetch`.

**Contract with real Kev.** With `FOUNDRY_BRIDGE_KEV_PYTHON` and `FOUNDRY_BRIDGE_KEV_DIR` set, the
real argument parsers at commit 5e42a7a accept every command line the daemon builds. The bundled
smoke dataset also loads through `kev.data.load_records` and `materialize`. Both passed here with the
CPU venv.

**Unknown until the laptop runs it:**
- real CUDA training time and peak VRAM on the RTX 4060;
- cloudflared behaviour behind the owner's network;
- whether `/quicktunnel` exists in the installed cloudflared version (the log fallback covers it);
- WSL idle shutdown;
- whether this cloud session may push the `foundry-bridge` branch.
