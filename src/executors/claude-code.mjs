// Claude Code headless as a bounded, opaque executor (ROADMAP §2.1 `executor`, P10).
// Inside it is a full agent loop; outside it is bounded: a workspace, a budget, a timeout,
// an allowed tool set, a private mount+pid namespace (repo, oracles, corpus, other sessions and
// every other executor's workdir are invisible; the host filesystem is read-only; /dev holds only basic nodes) and an
// allow-listed environment (no host credentials but the CLI auth). Its output is labelled `executor:claude-code`.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, statSync, readlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FoundryError } from '../data.mjs';
import { CHILD_ENV_ALLOWED } from '../models/policy.mjs';
import { lifeline, trackChild } from '../children.mjs';

// An executor sees only its own workdir under WORK_ROOT and at most one kit under KIT_ROOT.
export const WORK_ROOT = '/var/tmp/foundry-work', KIT_ROOT = '/opt/foundry-kit';
// Hidden = replaced by an empty private tmpfs (when the path exists). /root/.claude holds every session's
// transcripts, task output and hooks, /tmp other sessions' scratchpads and sockets, /home/user the repo and sibling
// projects, /run host service sockets, /opt/rclone* sync configuration; the rest is corpus, model and venv data.
// Hiding all of /root also keeps a builder from planting configuration (~/.claude.json, ~/.bashrc) for host sessions.
// Not all of /home: the CLI's managed login needs a path there (live-tested 2026-10-07: hiding /home fails auth).
export const DEFAULT_HIDDEN = Object.freeze(['/home/user', '/home/claude', '/home/ubuntu', '/root', '/tmp', '/var/tmp', '/mnt', '/run', '/srv', '/media', '/old_root', '/dev/shm',
  '/opt/corpus', '/opt/models', '/opt/hf-cache', '/opt/kev-venv', '/opt/llamacpp', '/opt/rclone', '/opt/rclone-attach', '/opt/env-runner', WORK_ROOT, KIT_ROOT,
  // Host logs (journal, package and service logs): nothing an executor needs (ISOLATION-PROBE-laptop §5.5).
  '/var/log',
  // Any other host (the owner's laptop): the invoking user's home holds the repository, oracles, sibling projects, the
  // CLI login and every session transcript (~/.claude), SSH and git credentials. The names above are the cloud's.
  ...(['/', '/root'].includes(os.homedir()) ? [] : [os.homedir()])]);

// The binaries an executor session must run, as the paths that make them reachable: each symlink on the way (kept as
// a symlink) and the resolved real file (kept as a read-only file bind). `names` are looked up on `pathEnv` like a
// shell would (first executable hit). A directory symlink inside the chain is resolved (realpath of the link's parent),
// so a recreated link points at the canonical path of the next hop. Exported for tests (fake trees).
export function binaryKeeps(names = ['claude', 'node'], pathEnv = process.env.PATH ?? '') {
  const out = [];
  const exec = p => { try { const s = statSync(p); return s.isFile() && (s.mode & 0o111) !== 0; } catch { return false; } };
  for (const name of names) {
    const dirs = String(pathEnv).split(':').filter(d => path.isAbsolute(d));
    let p = dirs.map(d => path.join(d, name)).find(exec);
    if (!p) continue;
    for (let hops = 0; hops < 40; hops++) {
      let s; try { s = lstatSync(p); } catch { p = null; break; }
      if (!s.isSymbolicLink()) break;
      out.push(p);
      let parent; try { parent = realpathSync(path.dirname(p)); } catch { p = null; break; }
      p = path.resolve(parent, readlinkSync(p));
    }
    if (p) { try { out.push(realpathSync(p)); } catch {} }
  }
  return [...new Set(out)];
}
// Kept visible, read-only, inside a hidden path. Cloud: /root/.ccr holds the proxy CA bundle (NODE_EXTRA_CA_CERTS);
// /home/claude/.claude/remote/.oauth_token is the CLI's managed login (live-tested 2026-10-07: hiding it fails auth); the rest of
// that account directory (.ssh, .npm, .gitconfig, other .claude state, and remote/.session_ingress_token) is hidden.
// Binaries: only `claude` and `node` and the paths their symlinks resolve through (on the laptop the link
// ~/.local/bin/claude and its target ~/.local/share/claude/versions/<v>), never whole tool directories: the earlier
// ~/.local/bin keep exposed 402 owner tools and scripts (ISOLATION-PROBE-laptop §5.3). Entries outside every hidden
// root are already visible read-only and are skipped by maskSteps. Not ~/.claude: there the login sits beside every
// session transcript, so a builder authenticates with CLAUDE_CODE_OAUTH_TOKEN from the environment instead
// (owner-provisioned; see EXECUTOR_ENV_ALLOWED).
// Cloud, 2026-10-14: only the login file itself is kept. The directory also holds .session_ingress_token, the parent
// cloud session's own ingress credential, which no builder session needs; keeping the directory exposed it read-only to
// every interpreter, shadow, adjudicator and builder (cloud-ops verify, wf_30a7255d-88f). maskSteps keeps single files.
export const CLOUD_LOGIN_FILE = '/home/claude/.claude/remote/.oauth_token';
export const DEFAULT_KEEP_RO = Object.freeze(['/root/.ccr', CLOUD_LOGIN_FILE, ...binaryKeeps()]);
// Device nodes an executor keeps (bound from the host /dev into a fresh tmpfs /dev). Everything else is absent: GPUs
// (/dev/nvidia*, /dev/dri: a builder could start GPU work beside a running job), disks, input, sound, kvm, the host's
// devpts (other terminals) and its /dev/shm. A private /dev/shm and a fresh devpts instance (own ptys) are added.
export const DEFAULT_DEVICES = Object.freeze(['null', 'zero', 'full', 'random', 'urandom', 'tty']);
export const DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
// Repository credentials, plus the parent Claude session's identity, sockets and tuning (else every nested CLI runs
// as the parent session, shares its scratchpad and gets ~530 extra prompt tokens). Model access keeps the CLI's own
// managed auth (live-tested 2026-10-07: auth still works without these). The executor no longer passes the host
// environment through this deny-list (EXECUTOR_ENV_ALLOWED below); it remains the claude-cli provider's scrub and the
// executor's refusal list for extraEnv.
export const SCRUBBED_ENV = /^(GH_TOKEN|GITHUB_TOKEN|GIT_CONFIG_.*|GIT_ASKPASS|CLOUDSDK_AUTH_ACCESS_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|MAX_THINKING_TOKENS|CLAUDE_AFTER_LAST_COMPACT|CLAUDE_AUTOCOMPACT_PCT_OVERRIDE|CLAUDE_AUTO_BACKGROUND_TASKS|CLAUDE_ADDITIONAL_DIRECTORIES|CLAUDE_SESSION_INGRESS_TOKEN_FILE|SBX_TELEMETRY_SOCKET|CLAUDE_CODE_(SESSION_ID|REMOTE_SESSION_ID|MESSAGING_SOCKET|MESSAGING_TOKEN|TEE_SDK_STDOUT|DIAGNOSTICS_FILE|CHILD_SESSION|POST_FOR_SESSION_INGRESS_V2|REMOTE_SEND_KEEPALIVES|REMOTE_TOOLS_FORWARD|SYNC_.*|WORKER_EPOCH|ARTIFACT_ASSETS|BG_TASKS_REPORT_RUNNING|HOLD_UNANSWERED_PARKED_PERMISSION|SESSION_ATTENDED|ADDITIONAL_DIRECTORIES_CLAUDE_MD|BASE_REF))$/;
export const scrubEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k, v]) => typeof v === 'string' && !SCRUBBED_ENV.test(k)));

// The executor session's environment is an allow-list (ISOLATION-PROBE-laptop §5.1: the deny-list above let 27
// third-party model and agent API keys from the owner's shell into every builder). From the host environment only:
//   PATH                       the sandbox script execs `claude` (and the session's Bash tool runs tools) by PATH lookup;
//                              host-only entries resolve to the empty masks.
//   LANG, LC_ALL, LC_*         locale (UTF-8 handling of prompts, file names and tool output).
//   TERM                       terminal type for tools the session's Bash tool runs (absent when not on a tty).
//   USER, LOGNAME              the account name some tools read before falling back to getpwuid (git, Python getpass).
//   CLAUDE_CODE_OAUTH_TOKEN    the owner-provisioned CLI auth (CLAUDE.md: credentials only from env vars). The login
//                              under ~/.claude is hidden with every session transcript beside it.
//   CHILD_ENV_ALLOWED          the model policy's closed childEnv list (src/models/policy.mjs: transport, telemetry and
//                              cache-pricing switches such as CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC and
//                              FORCE_PROMPT_CACHING_5M). They change the recorded cost, so the session keeps whatever the
//                              run's shell sets, as before.
//   NODE_EXTRA_CA_CERTS, NODE_USE_SYSTEM_CA
//                              TLS trust for the CLI: a host behind a TLS-inspecting egress proxy (the cloud) needs its CA.
//   HTTPS_PROXY, HTTP_PROXY, NO_PROXY (and lower case)
//                              egress routing to the model API where the host has only a proxy (the cloud). Unset here.
// Set by the executor: TMPDIR=/tmp (a host value may point into a hidden path; /tmp is the session's private tmpfs) and
// HOME, which must lie in a hidden root, so the session sees an empty private tmpfs there (executorHome).
// No host FOUNDRY_* variable passes: the gateway the session may use arrives explicitly as extraEnv
// (experiments/c0/construct.mjs arm F: FOUNDRY_MODEL_GATEWAY_URL and FOUNDRY_MODEL_GATEWAY_TOKEN, a per-session token
// the host-side gateway minted, which enforces the policy and budget). FOUNDRY_SYSTEMONE_* (src/judgment.mjs) and the
// host's own FOUNDRY_MODEL_GATEWAY_* are host-side and stay out. Everything else is dropped, including ANTHROPIC_BASE_URL
// and the parent session's CLAUDE_CODE_* identity, sockets and tuning.
export const EXECUTOR_ENV_ALLOWED = Object.freeze(['PATH', 'LANG', 'LC_ALL', 'TERM', 'USER', 'LOGNAME', 'CLAUDE_CODE_OAUTH_TOKEN', ...CHILD_ENV_ALLOWED,
  'NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']);
const EXECUTOR_ENV_PATTERN = /^LC_[A-Z_]+$/;
// Credential-like names (the probe's own pattern). extraEnv may carry one only when it is listed here: a value the host
// minted for this session, never a key copied from the owner's environment.
export const CREDENTIAL_NAME = /token|key|secret|pass|auth|cred/i;
export const EXTRA_ENV_CREDENTIALS = Object.freeze(['FOUNDRY_MODEL_GATEWAY_TOKEN']);
const covered = (p, roots) => roots.some(r => p === r || inside(p, r));
// HOME inside the session: the host home when a hidden root covers it (an empty private tmpfs there), else refused, so a
// session can never read the real ~/.claude, ~/.ssh or shell configuration through $HOME.
export function executorHome(env = process.env, hidden = DEFAULT_HIDDEN) {
  const home = path.resolve(env.HOME || os.homedir());
  if (home === '/' || !covered(home, hidden.map(h => path.resolve(h)))) throw new FoundryError('SANDBOX_ENV', `HOME ${home} is not hidden in the sandbox`);
  return home;
}
/** The exact environment runClaudeCode gives the sandbox: allow-listed host names, TMPDIR, HOME, then extraEnv. */
export function executorEnv({ env = process.env, extraEnv = {}, hidden = DEFAULT_HIDDEN } = {}) {
  for (const k of Object.keys(extraEnv)) {
    // Defensive second check: repository and parent-session credentials are refused outright, and so is any other
    // credential-like name the host did not mint for the session.
    if (SCRUBBED_ENV.test(k) || (CREDENTIAL_NAME.test(k) && !EXTRA_ENV_CREDENTIALS.includes(k))) throw new FoundryError('SANDBOX_ENV', `refusing to pass credential variable ${k}`);
    if (typeof extraEnv[k] !== 'string') throw new FoundryError('SANDBOX_ENV', `extra environment variable ${k} must be a string`);
    if (k === 'HOME') throw new FoundryError('SANDBOX_ENV', 'HOME is set by the executor (a hidden path), not by the caller');
  }
  const base = Object.fromEntries(Object.entries(env).filter(([k, v]) => typeof v === 'string' && (EXECUTOR_ENV_ALLOWED.includes(k) || EXECUTOR_ENV_PATTERN.test(k))));
  return { ...base, TMPDIR: '/tmp', HOME: executorHome(env, hidden), ...extraEnv };
}

// Transcript scan (pre-registered: a count > 0 voids the run). Tool uses that start a nested Claude CLI or call the
// model API directly, i.e. spend outside every ledger: a Bash command with `claude` in command position (also after
// exec/env/nohup/timeout/npx or a path), or any Bash/Write/Edit input naming the API host or SDK, or code that
// spawns `claude`. Mentions of the word (grep claude, ~/.claude, model ids like claude-opus-5-5) do not count.
const NESTED_CLI = /(?:^|[;&|(`\n]|\$\()\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:exec|env|nohup|command|time|timeout\s+\S+|npx(?:\s+-y)?|sudo)\s+(?:-\S+\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)*(?:\S*\/)?claude(?:\s|$|[;&|)])/;
const NESTED_API = /api\.anthropic\.com|@anthropic-ai\/(?:sdk|claude-code|claude-agent-sdk)|\banthropic\.(?:Anthropic|AsyncAnthropic)\b|\/v1\/(?:messages|complete)\b/;
const NESTED_KIT = /foundry-kit\/[0-9a-f]+\/bin\/foundry\.mjs\s+(?:run|resume|tick|trial)\b/;
const NESTED_SPAWN = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|execa|Popen|run|check_output|call|system)\s*\(\s*\[?\s*['"`](?:\S*\/)?claude(?:['"`\s])/;
export function nestedModelUses(toolUses = []) {
  return toolUses.filter(u => {
    const input = u?.input ?? {};
    if (u?.name === 'Bash') { const cmd = String(input.command ?? ''); return NESTED_CLI.test(cmd) || NESTED_API.test(cmd) || NESTED_SPAWN.test(cmd) || NESTED_KIT.test(cmd); }
    if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(u?.name)) {
      const text = [input.content, input.new_string, input.new_source, ...(Array.isArray(input.edits) ? input.edits.map(e => e?.new_string) : [])].filter(x => typeof x === 'string').join('\n');
      return NESTED_API.test(text) || NESTED_SPAWN.test(text);
    }
    return false;
  }).length;
}

// The program starts one user namespace deeper, as the host uid/gid: Claude Code refuses
// --permission-mode bypassPermissions when getuid() is 0 (as under --map-root-user), and the nested namespace drops both
// that uid and every capability over the mount namespace (no mount, umount or remount of a mask, even after a further
// unshare). Only the setup steps run as the namespace root.
// A root host (the cloud container runs every process as uid 0) has no unprivileged host uid to map: there the program
// runs as UNPRIVILEGED_ID, mapped onto the same host uid 0. Host file access is unchanged (the CLI's managed login under
// /home/claude/.claude/remote stays readable), but getuid() is not 0 and execve as a non-root uid clears every capability
// (live-tested 2026-10-14: uid 65534, CapEff 0, mount/umount fail, CLI root check passes, auth loggedIn).
export const UNPRIVILEGED_ID = 65534;
export const dropUidArgs = (uid = process.getuid(), gid = process.getgid()) => {
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) throw new FoundryError('SANDBOX_UNAVAILABLE', 'The sandbox needs a numeric host uid and gid');
  const root = uid === 0;
  return ['unshare', '--user', `--map-user=${root ? UNPRIVILEGED_ID : uid}`, `--map-group=${root ? UNPRIVILEGED_ID : gid}`];
};
// The availability probe has the full sandbox shape: the outer root namespace with mount and pid namespaces, then the
// nested uid drop.
export const sandboxProbeArgs = (uid = process.getuid(), gid = process.getgid()) => ['--user', '--map-root-user', '--mount', '--pid', '--fork', '--mount-proc', ...dropUidArgs(uid, gid), 'true'];
let unshareOk;
export function sandboxAvailable() {
  if (unshareOk === undefined) unshareOk = spawnSync('unshare', sandboxProbeArgs(), { timeout: 10000 }).status === 0;
  return unshareOk;
}
// The namespace flags every executor sandbox uses: its own user, mount and pid namespace with a fresh /proc
// (the host /proc would expose /proc/<pid>/root, i.e. the unmasked host filesystem, and other processes' environ).
export const UNSHARE_ARGS = Object.freeze(['--user', '--map-root-user', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc']);

export const shellQuote = s => `'${String(s).replaceAll("'", `'\\''`)}'`;
const inside = (a, b) => a.startsWith(b === '/' ? '/' : b + '/');
const isDir = p => { try { return lstatSync(p).isDirectory(); } catch { return false; } };

// Mount steps run as the namespace root before the executor starts (sh, set -e):
// 1. a private tmpfs on the staging point (it is also the mask of /mnt); every kept path is rbind-copied there
//    while its source is still writable;
// 2. every inherited mount (except the fresh /proc, /sys and the staging area) is remounted read-only, so the executor
//    cannot alter the host filesystem;
// 3. each hidden path becomes an empty private tmpfs; paths nested in another hidden path are skipped (mounting on
//    them would fail once the parent is masked);
// 4. the kept paths are moved back to their own locations: the workdir writable, the kit and keepRo read-only;
//    a kept symlink inside a hidden root is recreated (pointing at the canonical path of its target);
// 5. /dev becomes a fresh read-only tmpfs holding only `devices` (bound from the host), the fd/std* links, a private
//    /dev/shm and a new devpts instance (devices: null keeps the host /dev, read-only remounted as in step 2).
// keepRo entries may be directories, files or symlinks. A file or symlink outside every hidden root is already visible
// (read-only) and needs no step; a symlink inside a kept directory is visible through that directory.
export function maskSteps({ workdir, kitDir = null, hidden = DEFAULT_HIDDEN, keepRo = [], stage = '/mnt', devices = DEFAULT_DEVICES }) {
  const kind = p => { try { const s = lstatSync(p); return s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null; } catch { return null; } };
  const all = [...new Set([WORK_ROOT, KIT_ROOT, ...hidden].map(p => path.resolve(p)))].filter(p => p !== '/' && isDir(p));
  // A hidden path under the staging point is already masked by the staging tmpfs.
  const roots = all.filter(p => !all.some(o => o !== p && inside(p, o)) && !inside(p, stage));
  const masked = p => roots.some(r => p === r || inside(p, r));
  const requested = [...new Set(keepRo.map(p => path.resolve(p)))];
  const rw = path.resolve(workdir);
  const roDirs = [...(kitDir ? [path.resolve(kitDir)] : []), ...requested.filter(p => kind(p) === 'dir')];
  const roFiles = requested.filter(p => kind(p) === 'file' && masked(p));
  const ro = [...roDirs, ...roFiles], keeps = [rw, ...ro];
  if (!isDir(stage)) throw new FoundryError('EXECUTOR_PATH', `The sandbox staging point ${stage} does not exist`);
  for (const k of keeps) {
    if (k === '/' || k === stage || inside(k, stage) || k === '/proc' || inside(k, '/proc') || k === '/dev' || inside(k, '/dev')) throw new FoundryError('EXECUTOR_PATH', `Cannot keep ${k} visible in the sandbox`);
    for (const o of keeps) if (o !== k && (inside(k, o))) throw new FoundryError('EXECUTOR_PATH', `Kept paths may not nest: ${k} is inside ${o}`);
  }
  for (const p of roots) if (keeps.some(k => k === p || inside(p, k))) throw new FoundryError('EXECUTOR_PATH', `Cannot hide ${p}: it is or contains a kept path`);
  const links = requested.filter(p => kind(p) === 'link' && masked(p) && !keeps.some(k => inside(p, k)))
    .map(p => [p, path.resolve(realpathSync(path.dirname(p)), readlinkSync(p))]);
  const steps = [`mount -t tmpfs -o mode=0700 foundry-stage ${shellQuote(stage)}`];
  keeps.forEach((k, i) => steps.push(roFiles.includes(k) ? `: > ${shellQuote(`${stage}/k${i}`)}` : `mkdir ${shellQuote(`${stage}/k${i}`)}`, `mount --rbind ${shellQuote(k)} ${shellQuote(`${stage}/k${i}`)}`));
  // /sys stays as inherited: the CLI's Bash tool clones each command into a cgroup under /sys/fs/cgroup (EROFS otherwise).
  const skip = `${stage}|${stage}/*|/proc|/proc/*|/sys|/sys/*`;
  // Inside a user namespace a remount must keep the mount's locked flags (nosuid, nodev, noexec and the atime mode) or
  // it fails with EPERM (e.g. a strictatime /tmp on a desktop host). nsfs mounts (namespace handles such as
  // /run/docker/netns/*) cannot be remounted and hold no file data. For stacked mounts only the top one (the last
  // mountinfo line) is addressable by path. A remount that still fails is tolerated only when the mount point cannot
  // be reached by path at all (e.g. container overlays under a root-only /var/lib/docker: the executor runs with the
  // same host uid, so it cannot reach them either) or lies under a hidden root, which step 3 covers with an empty
  // tmpfs; anywhere else the sandbox fails closed.
  const tolerated = roots.filter(p => p !== stage).flatMap(p => [shellQuote(p), `${shellQuote(p)}/*`]).join('|') || "''";
  steps.push(`while read -r mp opts fs; do case "$mp" in *\\\\*) echo "foundry-executor: unsupported mount point name" >&2; exit 97;; ${skip}) continue;; esac; [ "$fs" = nsfs ] && continue; keep=; for f in nosuid nodev noexec noatime nodiratime relatime; do case ",$opts," in *",$f,"*) keep="$keep,$f";; esac; done; case ",$opts," in *,noatime,*|*,relatime,*) ;; *) keep="$keep,strictatime";; esac; mount -o "remount,bind,ro$keep" "$mp" 2>/dev/null || [ ! -e "$mp" ] || case "$mp" in ${tolerated}) ;; *) echo "foundry-executor: cannot make $mp read-only" >&2; exit 1;; esac; done <<FOUNDRY_MOUNTS\n$(awk '{for(i=7;i<=NF;i++)if($i=="-"){m[$5]=$6" "$(i+1);break}} END{for(k in m)print k, m[k]}' /proc/self/mountinfo)\nFOUNDRY_MOUNTS`);
  for (const p of roots) if (p !== stage) steps.push(`mount -t tmpfs -o mode=0755 foundry-hidden ${shellQuote(p)}`);
  keeps.forEach((k, i) => steps.push(...(roFiles.includes(k) ? [`mkdir -p ${shellQuote(path.dirname(k))}`, `: > ${shellQuote(k)}`] : [`mkdir -p ${shellQuote(k)}`]),
    `mount --move ${shellQuote(`${stage}/k${i}`)} ${shellQuote(k)}`));
  for (const k of ro) steps.push(`mount -o remount,bind,ro ${shellQuote(k)}`);
  for (const [link, target] of links) steps.push(`mkdir -p ${shellQuote(path.dirname(link))}`, `ln -s ${shellQuote(target)} ${shellQuote(link)}`);
  if (devices) {
    // The host /dev is a devtmpfs: a read-only mount does not stop writes to device nodes (the probe found /dev/nvidia0
    // writable), so the nodes an executor may use are bound into a fresh tmpfs instead.
    const dev = `${stage}/dev`, q = n => shellQuote(`${dev}/${n}`);
    steps.push(`mkdir ${shellQuote(dev)}`, `mount -t tmpfs -o nosuid,mode=0755 foundry-dev ${shellQuote(dev)}`);
    for (const n of devices) {
      if (!/^[a-z][a-z0-9]*$/.test(n)) throw new FoundryError('EXECUTOR_PATH', `Unsupported device name ${n}`);
      steps.push(`if [ -c /dev/${n} ]; then : > ${q(n)}; mount --bind /dev/${n} ${q(n)}; fi`);
    }
    steps.push(`ln -s /proc/self/fd ${q('fd')}`, `ln -s fd/0 ${q('stdin')}`, `ln -s fd/1 ${q('stdout')}`, `ln -s fd/2 ${q('stderr')}`,
      `mkdir ${q('shm')} ${q('pts')}`, `mount -t tmpfs -o nosuid,nodev,mode=1777 foundry-shm ${q('shm')}`,
      // Own ptys for tools that need one; a host without devpts support in user namespaces runs without them.
      `if mount -t devpts -o newinstance,ptmxmode=0666,mode=0620 foundry-devpts ${q('pts')} 2>/dev/null; then ln -s pts/ptmx ${q('ptmx')}; fi`,
      `mount --move ${shellQuote(dev)} /dev`, 'mount -o remount,bind,ro,nosuid /dev');
  }
  // sysfs read-only; /sys/fs/cgroup is its own mount and stays writable for the CLI's per-command cgroups (gate G2 live test).
  steps.push('mount -o remount,bind,ro /sys');
  return steps;
}
// The marker line on stderr separates a sandbox that could not be set up (an environment fault: nothing ran, nothing
// was spent) from a program that started and failed.
export const SANDBOX_READY = 'foundry-sandbox-ready';
// The program is exec'd through dropUidArgs (CLI root check; the nested namespace drops uid 0 and the mount capability).
export const sandboxScript = (steps, workdir, argv, { uid = process.getuid(), gid = process.getgid() } = {}) =>
  `set -e\n${steps.join('\n')}\ncd ${shellQuote(workdir)}\necho ${SANDBOX_READY} >&2\nexec ${dropUidArgs(uid, gid).join(' ')} ${argv.map(shellQuote).join(' ')}`;
export const splitReady = stderr => { const i = stderr.indexOf(`${SANDBOX_READY}\n`); return i < 0 ? { ready: false, stderr } : { ready: true, stderr: stderr.slice(0, i) + stderr.slice(i + SANDBOX_READY.length + 1) }; };

export function materialize(workdir, files = {}) {
  mkdirSync(workdir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(workdir, rel);
    if (!target.startsWith(path.resolve(workdir) + path.sep)) throw new FoundryError('EXECUTOR_PATH', `File escapes workspace: ${rel}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}

// Usage per assistant message id (stream-json repeats a message once per content block, with the usage so far):
// a lower bound on what a killed session consumed, kept for review. Its cost bound is the session budget.
export function streamUsageOf(events) {
  const byMsg = new Map();
  for (const e of events) if (e?.type === 'assistant' && e.message?.id && e.message.usage) byMsg.set(e.message.id, e.message.usage);
  return [...byMsg.values()].reduce((s, u) => ({ inputTokens: s.inputTokens + (u.input_tokens ?? 0), outputTokens: s.outputTokens + (u.output_tokens ?? 0),
    cacheReadTokens: s.cacheReadTokens + (u.cache_read_input_tokens ?? 0), cacheWriteTokens: s.cacheWriteTokens + (u.cache_creation_input_tokens ?? 0) }),
  { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
}
const LIMITED = /rate.?limit|overloaded|usage limit|hit your (usage )?limit|limit reached/i;
// Classify one session's end from the CLI's result event (null: none was printed). Exported for tests.
export function sessionError({ result, stderr = '', timedOut = false, sandboxReady = true, cancelled = false }) {
  const status = Number(result?.api_error_status);
  // The caller's own abort (orch-20261021 d3, probe L3): a session killed because its caller cancelled it ends without a result. That is
  // CANCELLED, not EXECUTOR_PROTOCOL or SANDBOX_UNAVAILABLE, which runners retry as environment faults. A session that printed its result
  // before the abort landed keeps its own classification.
  if (cancelled && !result) return 'CANCELLED';
  if (!sandboxReady && !result) return 'SANDBOX_UNAVAILABLE';
  if (timedOut) return 'EXECUTOR_TIMEOUT';
  if (result?.subtype === 'error_max_budget_usd') return 'EXECUTOR_BUDGET';
  if ((status === 429 || status === 529 || LIMITED.test(`${result?.result ?? ''} ${stderr}`)) && (result?.is_error || !result)) return 'MODEL_RATE_LIMIT';
  if (!result) return 'EXECUTOR_PROTOCOL';
  if (result.is_error && (status >= 500 || status === 401 || status === 403)) return 'MODEL_UNAVAILABLE';
  return result.is_error ? 'EXECUTOR_ERROR' : null;
}

// Run one headless Claude Code session. Returns raw facts; callers decide success with an oracle.
// costUsd is the CLI-reported spend, or null when the session ended without a result (killed on timeout, crashed):
// then costUnknown is true and costUpperUsd is the session budget (a soft bound: the CLI checks it between turns).
export async function runClaudeCode({
  model, prompt, workdir, files = {}, budgetUsd = 1, timeoutMs = 15 * 60 * 1000, tools = DEFAULT_TOOLS,
  hidden = DEFAULT_HIDDEN, keepRo = DEFAULT_KEEP_RO, kitDir = null, systemPrompt = null, appendSystemPrompt = null, effort = null, binary = 'claude', signal,
  env: extraEnv = {}, hostEnv = process.env,
} = {}) {
  if (!model) throw new FoundryError('EXECUTOR_MODEL', 'An explicit model id from the policy file is required');
  if (!sandboxAvailable()) throw new FoundryError('SANDBOX_UNAVAILABLE', 'User/mount/pid namespaces are required to hide oracles from executors');
  // Extra variables for the whole session (C0: the model gateway, so even a direct call of the kit's CLI is policed).
  // hostEnv is the environment the allow-list draws from (tests seed a fake one).
  const env = executorEnv({ env: hostEnv, extraEnv, hidden });
  materialize(workdir, files);
  const args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands',
    '--tools', tools.join(','), '--permission-mode', 'bypassPermissions', '--max-budget-usd', String(budgetUsd)];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  if (effort) args.push('--effort', effort);
  const script = sandboxScript(maskSteps({ workdir, kitDir, hidden, keepRo }), workdir, [binary, ...args]);
  const started = Date.now();
  // lifeline: the session dies with this process; trackChild: a run executing it can find it after a crash (orch-20261021 B3).
  const child = spawn(...lifeline('unshare', [...UNSHARE_ARGS, 'sh', '-c', script]), { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const untrack = trackChild(child, 'executor');
  child.once('close', untrack);
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { if (stderr.length < 64 * 1024) stderr += d; });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  let cancelled = false;
  const onAbort = () => { cancelled = true; kill(); };
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
  const { ready, stderr: errText } = splitReady(stderr);
  const events = stdout.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  writeFileSync(path.join(workdir, '.executor-transcript.jsonl'), stdout);
  const result = [...events].reverse().find(e => e.type === 'result');
  const toolUses = events.filter(e => e.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c.type === 'tool_use').map(c => ({ name: c.name, input: c.input })));
  const init = events.find(e => e.type === 'system' && e.subtype === 'init');
  const errorCode = sessionError({ result, stderr: errText, timedOut, sandboxReady: ready, cancelled });
  const reported = typeof result?.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd);
  // A CLI that emitted no stream event never reached the agent loop (system/init precedes the first model call), so
  // nothing was spent; this covers both a sandbox that never got ready and a CLI that bailed at startup.
  const neverStarted = !result && !events.length;
  return {
    ok: !errorCode, error: errorCode ? { code: errorCode, exitCode: code, stderr: errText.slice(-2000) } : null, sandboxReady: ready,
    result: result?.result ?? null, costUsd: reported ? result.total_cost_usd : neverStarted ? 0 : null, costUnknown: !reported && !neverStarted,
    costUpperUsd: reported ? result.total_cost_usd : neverStarted ? 0 : budgetUsd,
    streamUsage: streamUsageOf(events), turns: result?.num_turns ?? null, sessionId: init?.session_id ?? result?.session_id ?? null,
    usage: result?.usage ?? null, durationMs: Date.now() - started, toolUses,
    label: `executor:claude-code:${model}`, transcript: path.join(workdir, '.executor-transcript.jsonl'),
  };
}

export const readJsonFile = (workdir, name) => {
  try { return JSON.parse(readFileSync(path.join(workdir, name), 'utf8')); } catch { return null; }
};
