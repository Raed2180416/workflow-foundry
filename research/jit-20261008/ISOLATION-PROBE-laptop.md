# ISOLATION-PROBE-laptop: the §0.4 cross-arm probe, re-run on the owner's laptop (S0-3)

*2026-10-09, laptop session (Claude Opus 5.5, delegated). Step-0 item S0-3 of [BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md) §2.0;
critique C7; FRONTIER-GAPS P2 item 4. $0: no model was called, and a scripted command stood in for the CLI. Engine: HEAD
`7b8fc47`, with `src/` unchanged since `38f74fd`, which includes the sandbox fix `2f9862a`.*

## 0. Result first

**Filesystem isolation holds on the laptop.** Cross-arm reads are impossible. Inside the executor sandbox:
- the home directory, repository, `.git`, sealed beds, `~/.claude`, `~/.ssh`, gh config, bridge data and Kev data are all
  hidden;
- a sibling arm's workdir is invisible;
- `/var/tmp/foundry-work` shows only the path down to the probe's own workdir.

This confirms the cloud refutation in [FRONTIER-GAPS](FRONTIER-GAPS.md) §0.4 for this host after `2f9862a`.

**Two channels are not covered by the filesystem mask: the environment and the network.**

1. **Credentials in the environment (sensitive; not fixed, owner action needed).**
   - `runClaudeCode` (JIT interpreter, shadows, compile builders) passes the host environment through `scrubEnv()`. That
     is a deny-list of cloud and git variable names.
   - On this laptop the session environment holds **27 variables whose names match `token|key|secret|pass|auth|cred`**.
     Most are API keys for third-party model and agent services, of the form `<SERVICE>_API_KEY[_An]`.
   - All 27 survive `scrubEnv()` and are readable inside the sandbox with `env`. The probe printed names only, never
     values.
   - `runSandboxed` (B1 scripts, compile host check) and `runCode` (code nodes) are **not** affected. They build a minimal
     environment: `PATH`, `LANG`, `HOME` / `PATH`, `LC_CTYPE`.
2. **Shared host network namespace (by design for the CLI, but wider on the laptop).**
   - `runClaudeCode` and `runSandboxed({ network: true })` share the host netns (same `net:[4026531833]` inode).
   - Every loopback service is reachable. A TCP connect succeeded to local Ollama (11434), PostgreSQL (5432, 5433) and
     ports 8765, 3000, 7331 and 631.
   - The 26 abstract unix sockets of the host netns are visible, including systemd bus sockets and X11 `X0`. X11 refused
     the unauthenticated setup.
   - Together with item 1, a sandboxed builder could call non-Claude model APIs, or a local model, outside every ledger.
     `nestedModelUses` detects only Claude and Anthropic calls.
   - `runSandboxed({ network: false })` and `runCode` are fully cut off: "Network is unreachable", no DNS, no abstract
     sockets.

Per the brief, nothing under `src/` was changed. The fixes proposed in §5 are for the owner or the engine lane.

## 1. Method

**Entry points.** These are the real ones, imported from the working tree:
- `src/executors/claude-code.mjs`: `maskSteps`, `sandboxScript`, `splitReady`, `UNSHARE_ARGS`, `DEFAULT_HIDDEN`,
  `DEFAULT_KEEP_RO`, `scrubEnv`, `sandboxAvailable`.
- `src/executors/sandboxed-command.mjs`: `runSandboxed`.
- `src/sandbox.mjs`: `runCode`.

**Three sandboxes were probed.**
| sandbox | used by | construction in the probe |
|---|---|---|
| **executor** | `runClaudeCode`: JIT interpreter, shadows, adjudicator, compile builders | Exactly `runClaudeCode`'s construction, with the CLI argv replaced by `bash -c <probe body>`:<br>`spawn('unshare', [...UNSHARE_ARGS, 'sh', '-c', sandboxScript(maskSteps({ workdir, kitDir: null, hidden: DEFAULT_HIDDEN, keepRo: DEFAULT_KEEP_RO }), workdir, ['bash','-c', body])], { env: { ...scrubEnv(), TMPDIR: '/tmp', PROBE_WRITES: '1' } })` |
| **command** | `runSandboxed`: B1 scripts, compile host check (`network: false`) | `runSandboxed({ command: 'bash', args: ['-c', body], workdir, network })`, with `network` true and then false |
| **code** | `runCode`: workflow code nodes | `runCode({ lang: 'python', source })`, with a Python `main` that does `os.path.exists`/`os.access` and socket connects |

**Flags.**
- `UNSHARE_ARGS` = `--user --map-root-user --mount --pid --fork --kill-child --mount-proc`.
- `runSandboxed({ network: false })` adds `--net`.
- `runCode` uses `--user --map-root-user --net --mount --pid --fork --kill-child --mount-proc`, plus a pivot to an
  allow-list root, run as an unmapped inner user.

**Layout.** It mirrors a stream:
- The probe's own workdir is `/var/tmp/foundry-work/jit/isolation-probe-laptop-20261009/arm-own/i000-probe`.
- A sibling arm's workdir holds a decoy `answer.json`: `.../arm-sibling/i000-sibling/answer.json`.

**Generated mask steps.** These are for the laptop: `os.homedir()` = `/home/raed`, so it is appended to `DEFAULT_HIDDEN`.
- tmpfs on `/mnt`, used as staging.
- rbind of the workdir, `~/.local/bin` and `~/.local/share/claude` into the staging area.
- Read-only remount of every inherited mount.
- An empty tmpfs over `/root`, `/tmp`, `/var/tmp`, `/run`, `/srv`, `/dev/shm` and `/home/raed`. The other
  `DEFAULT_HIDDEN` paths do not exist on this host.
- The kept paths moved back: the workdir read-write, the two `~/.local` paths read-only.
- `/sys` read-only.

**Host.**
- Linux 7.1.8-1-cachyos, util-linux 2.42.4 `unshare`, `kernel.unprivileged_userns_clone = 1`.
- Node v24.21.0 (`/opt/node24/bin/node`). `sandboxAvailable()` = true.

**Probe body.** Existence and readability tests (`test -e`, `test -r`, `test -w`), `ls` of directories, and connects
only. No file content is read: sealed beds and credential paths get `test` only. The same body also ran on the host,
unsandboxed and without the write probes, as the baseline. The probe directory and the decoy remain under
`/var/tmp/foundry-work/jit/isolation-probe-laptop-20261009/` for re-runs.

<details><summary>Probe body (bash) and how it was driven</summary>

```sh
R=/home/raed/projects/workflow-foundry
S=/var/tmp/foundry-work/jit/isolation-probe-laptop-20261009
p() { label=$1; shift; out=$("$@" 2>&1); rc=$?; printf '%s\t%s\t%s\n' "$label" "$rc" "$(printf %s "$out" | tr '\n' ' ' | cut -c1-240)"; }
p id id -u
p home.exists test -e /home/raed
p home.ls ls -A /home/raed
p claude.exists test -e /home/raed/.claude
p claude.json.exists test -e /home/raed/.claude.json
p ssh.exists test -e /home/raed/.ssh
p gh.exists test -e /home/raed/.config/gh
p gitconfig.exists test -e /home/raed/.gitconfig
p repo.exists test -e $R
p repo.git.exists test -e $R/.git
p sealed.exists test -e $R/beds/sealed
p sealed.readable test -r $R/beds/sealed
p bridge.exists test -e /home/raed/foundry-bridge
p kev.exists test -e /home/raed/kev
p kevvenv.exists test -e /home/raed/kev-venv
p hfcache.exists test -e /home/raed/hf-cache
p scratch.exists test -e /home/raed/.cache
p local.ls ls -A /home/raed/.local
p localshare.ls ls -A /home/raed/.local/share
p work.ls ls -A /var/tmp/foundry-work
p jit.ls ls -A /var/tmp/foundry-work/jit
p stream.ls ls -A $S
p sibling.answer.exists test -e $S/arm-sibling/i000-sibling/answer.json
p sibling.glob sh -c "ls -d $S/*/i000*"
p kevwork.exists test -e /var/tmp/foundry-work/kev
p c0testbed.exists test -e /var/tmp/foundry-work/c0-testbed
p vartmp.count sh -c 'ls -A /var/tmp | wc -l'
p tmp.count sh -c 'ls -A /tmp | wc -l'
p run.ls ls -A /run
p runuser.exists test -e /run/user/1000
p dockersock.exists test -e /var/run/docker.sock
p devshm.count sh -c 'ls -A /dev/shm | wc -l'
p proc.pids sh -c 'ls /proc | grep -c "^[0-9]"'
p root.ls ls -A /
p opt.ls ls -A /opt
p etcshadow.readable test -r /etc/shadow
p nvme.readable test -r /dev/nvme0n1
p nvidia.rw test -w /dev/nvidia0
p journal.readable test -r /var/log/journal
p netns readlink /proc/self/ns/net
p mntns readlink /proc/self/ns/mnt
p home.fstype findmnt -n -o FSTYPE --target /home/raed
p abstract.sockets sh -c "awk '\$8 ~ /^@/ {print \$8}' /proc/net/unix | sort -u | tr '\n' ' '"
p env.names sh -c "env | cut -d= -f1 | grep -iE 'token|key|secret|pass|auth|cred' | sort | tr '\n' ' '"
p dns getent hosts api.anthropic.com
p https.anthropic curl -sS -o /dev/null -m 8 -w '%{http_code}' https://api.anthropic.com/
for port in 11434 5432 5433 8765 3000 7331 631; do p tcp.127.0.0.1:$port timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port"; done
p x11.abstract.X0 python3 -I -c '
import socket,struct,sys
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.settimeout(3); s.connect("\0/tmp/.X11-unix/X0")
s.sendall(struct.pack("<BxHHHHxx",0x6c,11,0,0,0)); b=s.recv(1)
print("setup-reply", b[0] if b else None); sys.exit(0 if b and b[0]==1 else 3)'
if [ "${PROBE_WRITES:-0}" = 1 ]; then
  p write.workdir touch ./probe-write-ok
  p write.home.tmpfs touch /home/raed/probe-write-x
  p write.localbin touch /home/raed/.local/bin/probe-write-x
  p write.etc touch /etc/probe-write-x
  p write.usr touch /usr/probe-write-x
  p write.sysfs sh -c 'echo x > /sys/kernel/probe-write-x'
fi
```

**Driver.** A 34-line Node module in the session scratchpad, not committed. It imports the entry points above, creates the
two workdirs and the decoy, and then does one of two things:
- `executor` mode: spawns the `unshare` line from the method table and prints the exit code and `sandboxReady`;
- `command` mode: calls `runSandboxed` with `network: true`, then `false`.

The `env.names` line was run as shown. The report keeps only the count and the name pattern, never the values.
</details>

## 2. Results

**Exit codes.** `0` = the test succeeded (exists, readable or connected). `1` = false. `2` = `ls` found no such path.
Host = unsandboxed baseline. Exec = executor sandbox. Cmd+net and Cmd−net = `runSandboxed` with `network` true and false.
Code = `runCode` (Python), which reports booleans.

### 2.1 Paths that must be hidden

| path | host | exec | cmd+net | cmd−net | code |
|---|---|---|---|---|---|
| `/home/raed` exists | 0 (396 entries) | 0, **empty tmpfs**; only `.local` (the keepRo mounts) | 0, empty | 0, empty | false |
| `~/.claude`, `~/.claude.json` | 0 | **1** | 1 | 1 | false |
| `~/.ssh`, `~/.config/gh`, `~/.gitconfig` | 0 | **1** | 1 | 1 | false |
| repo `/home/raed/projects/workflow-foundry` and its `.git` | 0 | **1** | 1 | 1 | false |
| `beds/sealed` (`test -e`, `test -r`; never listed, never read) | 0 | **1** | 1 | 1 | false |
| `~/foundry-bridge`, `~/kev`, `~/kev-venv`, `~/hf-cache`, `~/.cache` (session scratchpads) | 0 | **1** | 1 | 1 | — |
| `/var/tmp/foundry-work` listing | `c0-testbed jit kev .sock` and 3 logs | **`jit`** | `jit` | `jit` | false |
| `…/jit` listing | the probe stream | the probe stream | same | same | — |
| stream root listing | `arm-own arm-sibling` | **`arm-own`** | `arm-own` | `arm-own` | — |
| sibling's `answer.json` | 0 | **1** | 1 | 1 | — |
| glob `…/*/i000*` (the §0.4 S/H pattern) | both workdirs | **own workdir only** | own only | own only | — |
| `/var/tmp/foundry-work/kev`, `…/c0-testbed` | 0 | **1** | 1 | 1 | — |
| `/var/tmp` entries | 34 | 1 (path to the workdir) | 1 | 1 | — |
| `/tmp` entries | 101 | **0** | 0 | 0 | private |
| `/dev/shm` entries | 41 | **0** | 0 | 0 | — |
| `/run` listing | host services, `docker.sock`, `user/1000`, `credentials` | **`mount` only** | `mount` only | `mount` only | false |
| `/var/run/docker.sock` (user is in group `docker`) | 0 | **1** | 1 | 1 | — |
| `/proc` pids | 605 | **5** | 5 | 5 | own pid ns |
| mount ns | `4026531832` | private | private | private | private |
| `/etc/shadow` readable | 1 | 1 | 1 | 1 | false |
| `/dev/nvme0n1` readable | 1 | 1 | 1 | 1 | — |

### 2.2 What stays visible or reachable

| item | host | exec | cmd+net | cmd−net | code |
|---|---|---|---|---|---|
| **credential-like env names** (`token\|key\|secret\|pass\|auth\|cred`) | 28 | **27**: third-party model and agent API keys, plus OAuth flags; `scrubEnv` removed only one | **0** | **0** | **0** (env = `PATH`, `LC_CTYPE`) |
| `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` | unset in this session | unset | — | — | — |
| net ns | `4026531833` | **same as host** | **same as host** | private | private |
| DNS `api.anthropic.com` | 0 | 0 | 0 | 2 (no resolution) | — |
| HTTPS `api.anthropic.com` | 404 | 404 (reachable) | 404 | `curl` exit 6 | — |
| TCP 127.0.0.1: 11434 (Ollama), 5432, 5433 (PostgreSQL), 8765, 3000, 7331, 631 (CUPS) | all 0 | **all 0** | **all 0** | all 1 (unreachable) | 11434 unreachable |
| abstract unix sockets (host netns) | 26 | **visible** (systemd bus, logind, oomd, timesyncd, X11 `X0`, …) | visible | none | none |
| X11 `X0` unauthenticated setup | refused (0) | refused (0) | refused (0) | no socket | refused |
| `~/.local/bin` (402 owner entries) and `~/.local/share/claude` (CLI versions) | rw | **read-only, visible** | hidden (keepRo is `[]`) | hidden | — |
| `/opt` (installed apps; `/opt/node24`) | visible | visible, read-only | visible | visible | empty mask |
| `/dev/nvidia0` writable | 0 | **0** (GPU usable) | 0 | 0 | absent |
| `/var/log/journal` readable (directory) | 0 | 0 | 0 | 0 | absent |
| `/`, `/usr`, `/etc` writes; `/sys` writes | — | EROFS | — | — | read-only root |
| write to the hidden `/home/raed` | — | 0, into the private tmpfs; **absent on the host afterwards** | — | — | — |
| write in its own workdir | — | 0 (`probe-write-ok` landed on the host) | — | — | — |

## 3. Differences from the cloud measurement (FRONTIER-GAPS §0.4 correction)

| | cloud (main session, 2026-10-09) | laptop (this probe) |
|---|---|---|
| home holding repo and login | `/root`, `/home/user` in `DEFAULT_HIDDEN` | `/home/raed` via `os.homedir()` (`2f9862a`); before that fix it was **visible** |
| `~/.claude` | `/root/.claude` absent | `/home/raed/.claude` absent |
| CLI login | the `/root/.ccr` and `/home/claude/.claude/remote` keepRo | not visible: builders must get `CLAUDE_CODE_OAUTH_TOKEN` from the env (unset now, so live builders cannot authenticate yet) |
| work root | the probe saw only its own path under `jit-dev-records-1/` (8 entries on the host) | same result: only `arm-own` of 2 |
| §0.4 glob | matched nothing | matched only the probe's own workdir |
| environment | not measured. The cloud env had no third-party keys | **27 credential-like variables pass** |
| network | not measured. The cloud loopback had only the session proxy | **all loopback services reachable** |
| keepRo | `/root/.ccr`, `/root/.local` | the whole `~/.local/bin` (402 entries), not only the `claude` link |
| remount loop | worked | needs the locked-flag handling from `2f9862a` (strictatime `/tmp`, nsfs, docker overlays) |

## 4. What this means for C7 and R0

- The **filesystem** half of C7 is closed for runs on this engine. A builder or interpreter cannot read:
  - a sibling arm's workdir;
  - the repository (beds, oracles, sealed);
  - `~/.claude` transcripts;
  - git or SSH credentials.

  Hidden-path attempts in R0's compile records can be classified as "attempted, provably empty" when they target those
  roots, by this probe's evidence. The classification itself is still to be done when R0 exists.
- The hidden-path scan (`compile.mjs` `outside`, `interpret.mjs` `outsidePathsOf`) looks only at **paths**. It cannot
  see:
  - a credential read through `env`;
  - a call to Ollama, PostgreSQL or a third-party API made with those keys.

  The pre-registered nested-model scan covers only `claude` and Anthropic. A run's spend ledger is therefore complete only
  if the builder environment holds no other keys.

## 5. What remains exposed, and proposed fixes (not applied; `src/` belongs to the engine lane / owner)

1. **Env credentials (high).**
   - Replace `scrubEnv`'s deny-list with an allow-list for `runClaudeCode`: `PATH`, `HOME`, `LANG`/`LC_*`, `TERM`,
     `TMPDIR`, `CLAUDE_CODE_OAUTH_TOKEN`, `NODE_EXTRA_CA_CERTS`, the policy's closed `childEnv` list, and an explicit
     `extraEnv`.
   - Until that lands, start experiment shells with `env -i` plus the needed variables, so no third-party key reaches
     a builder.
   - Add an env-name assertion to the executor tests.
2. **Shared netns (medium).** Options:
   - give the executor a private netns with only an egress proxy to the model endpoint (for example `pasta`/`slirp4netns`
     and an allow-list);
   - at minimum, have a run refuse to start while loopback model servers (Ollama 11434) are listening;
   - extend the nested-model scan to non-Claude endpoints.

   PostgreSQL on 0.0.0.0:5432 is reachable from the sandbox, as from any local process.
3. **`~/.local/bin` keepRo (low–medium).** It exposes the owner's 402 tools and scripts read-only. Their contents were
   not inspected, because reading them is outside this probe's rules. Keep only `~/.local/share/claude/versions/<v>`,
   and put the CLI on `PATH` from there.
4. **GPU device (low).** `/dev/nvidia*` is world-writable, so a builder could start GPU work and disturb a running job.
   Mask `/dev/nvidia*` in the executor unless a run needs it.
5. **Host logs (low).** `/var/log/journal` is readable as a directory. Journal files were not tested. Consider adding
   `/var/log` to `DEFAULT_HIDDEN`.
