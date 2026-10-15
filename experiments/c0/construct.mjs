// One construction session (C0): the builder agent (Claude Code headless) gets probe tasks, the probe
// scorer and the model gateway, and must deliver a solver artifact (F: workflow.json, B1: solve.mjs).
// Everything it spends is measured: its own tokens (CLI-reported, or its budget bound when the session was killed)
// plus every gateway model call. Both arms read their construction skill from a read-only kit.
import path from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runClaudeCode, nestedModelUses } from '../../src/executors/claude-code.mjs';
import { runSandboxed } from '../../src/executors/sandboxed-command.mjs';
import { buildKit, SCRIPT_KIT_ALLOW } from '../lib/kit.mjs';
import { makeTasks, loadFamily } from '../lib/beds.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { builderPrompt } from './prompts.mjs';
import { ENV_FAULTS } from '../lib/runner.mjs';

// A construction whose builder session ended in one of these is not an outcome (PREREG-dev §5): the raw attempt is
// kept in construction-faults.jsonl and a resume retries it. The same classes as an execution trial's faults.
export const BUILD_ENV_FAULTS = ENV_FAULTS;

export const SCORE_TOOL = `// node tools/score.mjs <probe-index> <answer.json>
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
const [probe, file] = process.argv.slice(2);
const output = JSON.parse(readFileSync(file, 'utf8'));
const res = await fetch(cfg.url + '/score', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' }, body: JSON.stringify({ probe: Number(probe), output }) });
console.log(JSON.stringify(await res.json()));
`;
// Every call's cost goes to stderr and to ./tools/calls.jsonl (next to this file), so a builder can read where the money went.
// The gateway is a loopback URL during construction and a unix socket next to this file at execution (where the
// script has no network at all); both go through node:http, so the client code path is the same.
export const MODEL_TOOL = `// import { callModel } from './tools/model.mjs'
import { readFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
const here = path.dirname(fileURLToPath(import.meta.url));
function target() {
  if (!cfg.socket) { const u = new URL(cfg.url); return { host: u.hostname, port: u.port }; }
  const abs = path.join(here, cfg.socket), rel = path.relative(process.cwd(), abs);
  return { socketPath: rel.length < abs.length ? rel : abs };
}
function post(route, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({ ...target(), path: route, method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; });
      res.on('end', () => { let body = {}; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode, body }); });
    });
    req.on('error', reject); req.end(data);
  });
}
export async function callModel({ model, system = '', prompt, schema, reasoning = 'none', maxTokens } = {}) {
  const { status, body } = await post('/model', { model, system, prompt, schema, decoding: { reasoning, ...(maxTokens ? { maxTokens } : {}) } });
  const line = JSON.stringify({ at: new Date().toISOString(), model, status, ok: !!body.ok, costUsd: body.costUsd ?? null, spentUsd: body.spentUsd ?? null, error: body.ok ? undefined : (body.error?.code ?? body.error ?? null) });
  process.stderr.write('[model] ' + line + '\\n');
  try { appendFileSync(new URL('./calls.jsonl', import.meta.url), line + '\\n'); } catch {}
  if (status !== 200 || !body.ok) throw new Error('model call failed: ' + status + ' ' + JSON.stringify(body.error ?? body).slice(0, 400));
  return body.value;
}
`;
export const BUDGET_TOOL = `// node tools/budget.mjs -> {"spentUsd","capUsd","reservedUsd","calls","scoreCallsLeft",...}
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
const res = await fetch(cfg.url + '/budget', { headers: { authorization: 'Bearer ' + cfg.token } });
console.log(JSON.stringify(await res.json()));
`;
// Runs ./solve.mjs on a copy of one probe exactly as execution does (minus the execution sandbox's network isolation).
export const RUN_SOLVER = `#!/bin/sh
# ./tools/run-solver <probe-dir>: runs ./solve.mjs on a copy of that probe exactly as execution does
# (PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin, HOME = the task directory, no other environment).
set -e
[ -d "$1" ] || { echo "usage: ./tools/run-solver probes/probe-0" >&2; exit 2; }
src=$(cd "$(dirname "$0")/.." && pwd); d=$(mktemp -d)
cp -r "$1"/. "$d"/; cp "$src/solve.mjs" "$d/"; mkdir -p "$d/tools"; cp "$src/tools/model.mjs" "$src/tools/gateway.json" "$d/tools/"
cd "$d" && exec env -i PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 HOME="$d" node solve.mjs task.json
`;

export function taskFiles(task, prefix = '') {
  const files = {
    [`${prefix}prompt.md`]: task.prompt,
    [`${prefix}inputs.json`]: JSON.stringify(task.inputs ?? {}, null, 1),
    [`${prefix}task.json`]: JSON.stringify({ prompt: task.prompt, inputs: task.inputs ?? {}, ...(task.files ? { files: task.files } : {}) }),
  };
  for (const [rel, content] of Object.entries(task.files ?? {})) files[`${prefix}files/${rel}`] = content;
  return files;
}

const sha = text => createHash('sha256').update(text).digest('hex');
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

// Need router v1 (research/need-router-20261014/DESIGN.md §1, PREREG-NEED-V1.md §4.1): with selfCheck the B1 builder must
// also deliver check.mjs, run after every task on the solver's answer (runSelfCheck) and recorded as selfVerdict. This
// paragraph is appended to the builder prompt only when selfCheck is set, so every other caller's prompt (and its
// promptSha256) is unchanged. Its sha256 is part of the engine stamp (PREREG §4.4).
export const SELF_CHECK_FILE = 'check.mjs';
export const SELF_CHECK_PARAGRAPH = `
Also deliver ./check.mjs, a self-check that runs on every answer your solver gives: node check.mjs task.json answer.json must exit 0 when the answer looks right for that task and exit 1 when it does not. An answer it rejects is not delivered, so it should reject wrong answers and pass right ones. It reads only those two files (task.json as in the probes, answer.json as your solver prints it), makes no model calls and has no network; it runs in the same environment as the solver. Check what can be checked without knowing the right answer: the output schema, the rules the task states, consistency with the inputs. Test it on the probes, for example: ./tools/run-solver probes/probe-0 > a.json; node check.mjs probes/probe-0/task.json a.json; echo $?`;

// Per-message token usage of a stream-json transcript (one entry per assistant message id, its last usage, as
// streamUsageOf counts): [input, output, cacheRead, cacheWrite, model]. A re-pricer prices each request at its own
// prompt-size tier; the session aggregate cannot. null when the transcript is missing.
export function messageUsageOf(transcriptFile) {
  let text;
  try { text = readFileSync(transcriptFile, 'utf8'); } catch { return null; }
  const byMsg = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e?.type === 'assistant' && e.message?.id && e.message.usage) byMsg.set(e.message.id, { model: e.message.model ?? null, u: e.message.usage });
  }
  return [...byMsg.values()].map(({ model, u }) => [u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, model]);
}
// Bash tool uses that ran the build-time test loop (./tools/run-solver): how much the builder tested without an oracle.
export const runSolverCallsOf = (toolUses = []) => toolUses.filter(u => u?.name === 'Bash' && /run-solver/.test(String(u.input?.command ?? ''))).length;

// Need router v1: the hidden-path scan whose hits void work (DESIGN §2 validity gates). The `outside` closure in construct()
// below scans every string of a tool input (Write content, Grep patterns included) and is kept as it is for the C0 record
// and the kev-data C7 baseline, which reads it as text; its hits are for review by hand. Task data often holds host-style
// paths (incident: /var/log, /var/lib/postgresql/data, /srv/objects; ownerci: /home/runner/work/..., /opt/hostedtoolcache),
// so that scan voids honest answers. This one counts only paths a tool use accesses: the path arguments of file tools
// (Read, Write, Edit, Glob, Grep's path, LS, notebooks), a Glob pattern that is absolute, and a Bash command with its
// heredoc bodies removed (data written to a file). Write and Edit content and Grep patterns are never scanned. A path that
// the task itself states (its prompt, inputs or files: `ignore`), or a directory above one at least two segments deep, is
// not an attempt. /tmp is private to the sandbox.
export const HOST_ROOTS = Object.freeze(['home', 'root', 'opt', 'mnt', 'var', 'run', 'srv', 'media', 'etc', 'proc']);
// A host path starts a token (not inside a relative path files/var/x, a URL https://h/var/x or a home path ~/etc/x; a
// traversal ../../etc/x does count) and names a host root itself (/etc, /home/u), not a longer word (/variable).
const hostPathRe = () => new RegExp(`(?<![\\w~-])/(?:${HOST_ROOTS.join('|')})(?![\\w])[\\w./-]*`, 'g');
const PATH_KEYS = Object.freeze(['file_path', 'path', 'notebook_path', 'directory', 'dir', 'cwd']);
/** A path as compared by the scan: `..` resolved, trailing slashes and dots dropped. */
export const normalizeHostPath = p => path.posix.normalize(String(p)).replace(/[/.]+$/, '') || '/';
/** A Bash command without its heredoc bodies (`<<EOF ... EOF`, `<<-'EOF'`): the text a command writes, not paths it opens. */
export function withoutHeredocs(command) {
  return String(command).replace(/<<-?[ \t]*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, '<<$2');
}
/** The strings of one tool use that name paths it accesses (see above). */
export function accessedStrings(u) {
  const input = u?.input;
  if (typeof input === 'string') return [withoutHeredocs(input)];
  if (!input || typeof input !== 'object') return [];
  const out = [];
  if (typeof input.command === 'string') out.push(withoutHeredocs(input.command));
  for (const k of PATH_KEYS) if (typeof input[k] === 'string') out.push(input[k]);
  if (u?.name !== 'Grep' && typeof input.pattern === 'string' && input.pattern.startsWith('/')) out.push(input.pattern);   // Glob
  return out;
}
/** Host paths stated by tasks (prompt, inputs, files, or any string inside them), normalized: the scan's `ignore` set. */
export function taskHostPaths(tasks = []) {
  const out = new Set();
  const visit = v => {
    if (typeof v === 'string') { for (const m of v.match(hostPathRe()) ?? []) out.add(normalizeHostPath(m)); }
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  for (const t of tasks) visit(t);
  return out;
}
/** The directories above a stated path that a session may name while working on it (`grep -rn /var/log files/` for a
 *  task that states /var/log/syslog): two or more segments deep, so a bare host root (/home, /var) is never one. */
export function statedAncestors(paths) {
  const out = new Set();
  for (const p of paths) { const seg = String(p).split('/').filter(Boolean); for (let i = 2; i < seg.length; i++) out.add(`/${seg.slice(0, i).join('/')}`); }
  return out;
}
// The node install the sandbox runs (its PATH starts with it: tools/run-solver, runSandboxed): a builder that copies
// run-solver's command line (env -i PATH=/opt/node24/bin:...) or calls node by its full path reaches no hidden material.
export const RUNTIME_ROOTS = Object.freeze([path.dirname(path.dirname(process.execPath))]);
/** The accessed-path scan: {attempts (tool uses with at least one hit), paths, ignored (task-stated paths seen)}. A path
 *  the task states, or a directory above one (statedAncestors), is not an attempt; a path below a stated one is. Paths
 *  under allowedRoots and the node install (RUNTIME_ROOTS) are not outside. */
export function accessedOutsidePaths(toolUses = [], allowedRoots = [], { ignore = new Set(), runtimeRoots = RUNTIME_ROOTS } = {}) {
  // A runtime root is used only when it is at least two segments deep (/opt/node24, never /opt or /).
  const roots = [...allowedRoots.filter(Boolean).map(normalizeHostPath), ...runtimeRoots.filter(Boolean).map(normalizeHostPath).filter(r => r.split('/').filter(Boolean).length >= 2)];
  const ignored = new Set(), above = statedAncestors(ignore);
  const hits = u => accessedStrings(u).flatMap(s => s.match(hostPathRe()) ?? []).filter(p => {
    const n = normalizeHostPath(p);
    if (roots.some(r => n === r || n.startsWith(r.endsWith('/') ? r : `${r}/`))) return false;
    if (ignore.has(n) || above.has(n)) { ignored.add(n); return false; }
    return true;
  });
  const per = toolUses.map(hits);
  return { attempts: per.filter(x => x.length).length, paths: [...new Set(per.flat())], ignored: [...ignored] };
}

// The repository root: the hidden material (beds, oracles, references, results) every sandboxed session is kept away from.
// The accessed-path scan above skips heredoc bodies, Write/Edit content, ~ and $HOME paths and encoded strings, so a session
// can name the repository there (a `node <<'EOF'` script that reads an oracle, a script it writes and then runs, `ls
// ~/workflow-foundry/beds`, a base64-decoded path) without an attempt being counted. repoPathMentions closes that for the
// repository itself: every string of a tool input is searched for the root in plain, ~/$HOME and base64/hex forms. No task
// states this path (a form the task text contains is skipped), so an honest session has no reason to write it.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The forms of a repository root a tool input may name it in: { form, text, re }. */
export function repoPathForms(root = REPO_ROOT) {
  const out = [], add = (form, text, re) => { if (text && !out.some(x => x.text === text)) out.push({ form, text, re }); };
  const tail = '(?![\\w-])';
  // Not inside a longer path or word (x/home/..., ~/home/..., a relative ./home/...), but a traversal (../../home/...) counts.
  add('absolute', root, new RegExp(`(?<![\\w~-])(?<!(?:^|[^.])\\.)${reEscape(root)}${tail}`));
  const m = /^\/(?:home\/([^/]+)|root)\/(.+)$/.exec(root);
  if (m) {
    const user = m[1] ?? 'root', rest = m[2];
    for (const text of [`~/${rest}`, `~${user}/${rest}`]) add('home', text, new RegExp(`(?<![\\w./~-])${reEscape(text)}${tail}`));
    for (const text of [`$HOME/${rest}`, `\${HOME}/${rest}`]) add('home', text, new RegExp(`${reEscape(text)}${tail}`));
  }
  // The repository's own directory name as a word of its own (`cd ~ && cat workflow-foundry/beds/...`, path.join('/home/user',
  // 'workflow-foundry')), when it is distinctive (8+ characters with a separator); never as a segment of another absolute path
  // (/home/runner/work/workflow-foundry, which ownerci tasks state) or of a longer name.
  const name = path.basename(root);
  if (name.length >= 8 && /[-_.]/.test(name)) add('name', name, new RegExp(`(?<![\\w./~-])${reEscape(name)}${tail}`));
  // Encoded: the base64 characters fixed by the root's bytes alone at each of the three alignments (a string that contains the
  // root encodes to one of them, whatever precedes it), their base64url spelling, and hex. The leading slash is left out, so a
  // path written without it (home/user/...) is found too.
  const bare = Buffer.from(root.replace(/^\/+/, ''));
  for (let k = 0; k < 3; k++) {
    const n = k + bare.length, enc = Buffer.concat([Buffer.alloc(k), bare]).toString('base64').slice(k ? 4 : 0, Math.floor(n / 3) * 4);
    if (enc.length < 16) continue;
    add('base64', enc, new RegExp(reEscape(enc)));
    const url = enc.replace(/\+/g, '-').replace(/\//g, '_');
    add('base64', url, new RegExp(reEscape(url)));
  }
  const hex = bare.toString('hex');
  add('hex', hex, new RegExp(hex, 'i'));
  return out;
}
/**
 * Tool uses that name the repository root (repoPathForms) in any string of their input where the accessed-path scan does not
 * count it: `counted(u)` says whether that scan already counts the tool use as an attempt (it is then not counted twice).
 * ignoreText: the task's own text (prompt, inputs, files, PROCEDURE.md); a form it contains is not searched for.
 * Returns { attempts, forms } (the forms found, for review by hand).
 */
export function repoPathMentions(toolUses = [], { root = REPO_ROOT, ignoreText = '', counted = () => false } = {}) {
  const forms = repoPathForms(root).filter(f => !String(ignoreText).includes(f.text));
  const found = new Set();
  let attempts = 0;
  // Every string of the input as it is (never its JSON text: there a path that starts a line or follows a tab sits behind
  // the letter of a `\n` or `\t` escape, which the forms' "not inside a word" guard would take for part of a word).
  const strings = v => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
  for (const u of toolUses) {
    const ss = strings(u?.input);
    const hits = forms.filter(f => ss.some(s => f.re.test(s)));
    if (!hits.length || counted(u)) continue;
    attempts += 1;
    for (const h of hits) found.add(h.form);
  }
  return { attempts, forms: [...found].sort() };
}

// Post-run self-check: node check.mjs task.json answer.json in a fresh directory beside the trial (task files, the
// answer, check.mjs only), sandboxed with no network and no gateway, so it cannot call a model. Exit 0 = pass, 1 = fail,
// anything else (crash, timeout) = error. No answer: nothing to check (selfVerdict null). runner: tests substitute one.
export async function runSelfCheck({ checkPath, task, output, workdir, timeoutMs = 60 * 1000, runner = runSandboxed }) {
  if (output == null) return { selfVerdict: null, reason: 'no answer' };
  const dir = path.join(workdir, '.selfcheck');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const files = { ...taskFiles(task), [SELF_CHECK_FILE]: readFileSync(checkPath, 'utf8'), 'answer.json': JSON.stringify(output) };
  for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), content); }
  let r;
  try { r = await runner({ command: 'node', args: [SELF_CHECK_FILE, 'task.json', 'answer.json'], workdir: dir, timeoutMs, network: false }); }
  catch (error) { return { selfVerdict: null, error: { code: error.code ?? 'SELF_CHECK_LAUNCH', message: String(error.message ?? error).slice(0, 300) } }; }
  if (!r.sandboxReady && !r.timedOut) return { selfVerdict: null, error: { code: 'SANDBOX_UNAVAILABLE', message: String(r.stderr ?? '').slice(-300) } };
  const selfVerdict = r.timedOut ? 'error' : r.code === 0 ? 'pass' : r.code === 1 ? 'fail' : 'error';
  return { selfVerdict, exitCode: r.code ?? null, timedOut: !!r.timedOut, stderrTail: String(r.stderr ?? '').slice(-400), ms: r.durationMs ?? null };
}

// Probe tasks: probeSeeds is a list of seeds at one difficulty (C0), or of {seed, difficulty, stage?} for per-seed
// difficulty on banded jobs (need router: example set k, each seed at its preregistered difficulty). Builders see dev
// tasks only (L7).
async function probeTasksOf(familyId, probeSeeds, difficulty) {
  if (probeSeeds.every(Number.isInteger)) return { perSeed: false, tasks: (await makeTasks(familyId, { split: 'dev', seeds: probeSeeds, difficulty })).map(t => t.task) };
  const fam = await loadFamily(familyId);
  return { perSeed: true, tasks: probeSeeds.map(p => {
    const s = Number.isInteger(p) ? { seed: p, difficulty } : p;
    if (!Number.isInteger(s?.seed) || !Number.isInteger(s?.difficulty)) throw new Error(`construct: a probe seed needs an integer seed and difficulty: ${JSON.stringify(p)}`);
    if ((s.split ?? 'dev') !== 'dev') throw new Error(`construct: probe tasks come from the dev split only (L7), got ${s.split}`);
    return fam.generate({ seed: s.seed, split: 'dev', difficulty: s.difficulty, ...(s.stage ? { stage: s.stage } : {}) });
  }) };
}

// selfCheck (B1 only): append SELF_CHECK_PARAGRAPH and record check.mjs. executor: the session runner (tests and --dry
// substitute a stub with runClaudeCode's result shape); kitBase: where the kit is built (default /opt/foundry-kit).
export async function construct({ arm, armId = arm, familyId, probeSeeds = [1, 2, 3], difficulty = 3, builderModel = 'claude-opus-5-5', builderEffort = 'high', builderBudgetUsd = 8,
  constructionModelUsd = 2, perTaskUsd = 1, minutes = 45, scoreChecks = 12, modelPort, workRoot, label, models, selfCheck = false, executor = runClaudeCode, kitBase }) {
  if (!['F', 'B1'].includes(arm)) throw new Error(`unknown construction arm ${arm}`);
  if (selfCheck && arm !== 'B1') throw new Error('construct: selfCheck is defined for the B1 arm only');
  // The port must hold exactly the session's models (createModelPort({ allowedModels })): the builder's policy file,
  // the gateway allow-list and execution then agree, and no other model (no local one) is reachable.
  const portIds = modelPort.policy.models.map(m => m.id);
  if (!sameSet(portIds, models)) throw new Error(`construct: the model port policy (${portIds.join(', ')}) must be exactly the session models (${models.join(', ')})`);
  const fam = await loadFamily(familyId);
  const kit = arm === 'F' ? buildKit({ base: kitBase }) : buildKit({ base: kitBase, allow: SCRIPT_KIT_ALLOW });
  const { perSeed, tasks: probes } = await probeTasksOf(familyId, probeSeeds, difficulty);
  const ledger = new Ledger({ capUsd: constructionModelUsd, label });
  // Fresh run id: a re-run after an environment fault must not be served this label's earlier journaled answers.
  const svc = await startServices({ modelPort, ledger, familyId, probes, scoreLimit: scoreChecks, runId: `construct:${label}:${randomUUID()}`, allowedModels: models });
  const workdir = path.join(workRoot, label);
  rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
  const files = {
    'output-schema.json': JSON.stringify(fam.outputSchema, null, 1),
    'tools/gateway.json': JSON.stringify({ url: svc.url, token: svc.token }), 'tools/score.mjs': SCORE_TOOL, 'tools/model.mjs': MODEL_TOOL, 'tools/budget.mjs': BUDGET_TOOL,
  };
  probes.forEach((p, i) => Object.assign(files, taskFiles(p, `probes/probe-${i}/`)));
  if (arm === 'F') {
    // The builder's Foundry CLI validates and runs against the session policy, not the kit's full owner policy.
    const policyFile = path.join(workdir, 'tools/policy.json');
    files['tools/policy.json'] = JSON.stringify(modelPort.policy, null, 1);
    files['tools/foundry'] = `#!/bin/sh\nexport FOUNDRY_MODEL_GATEWAY_URL='${svc.url}'\nexport FOUNDRY_MODEL_GATEWAY_TOKEN='${svc.token}'\ncase "$1" in run|resume|tick|validate) exec node ${kit.dir}/bin/foundry.mjs "$@" --policy '${policyFile}';; esac\nexec node ${kit.dir}/bin/foundry.mjs "$@"\n`;
  }
  if (arm === 'B1') files['tools/run-solver'] = RUN_SOLVER;
  const classes = models.map(id => `${modelPort.policy.models.find(m => m.id === id)?.class} = ${id}`).join(', ');
  const prompt = builderPrompt(arm, { probes: probes.length, minutes, constructionModelUsd, perTaskUsd, scoreChecks, models, classes, kitDir: kit.dir }) + (selfCheck ? SELF_CHECK_PARAGRAPH : '');
  const started = Date.now();
  let r;
  try {
    for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true }); writeFileSync(path.join(workdir, rel), content); }
    for (const exe of ['tools/foundry', 'tools/run-solver']) if (files[exe]) chmodSync(path.join(workdir, exe), 0o755);
    r = await executor({ model: builderModel, prompt, workdir, files: {}, kitDir: kit.dir, budgetUsd: builderBudgetUsd, timeoutMs: minutes * 60 * 1000 + 5 * 60 * 1000, effort: builderEffort,
      env: arm === 'F' ? { FOUNDRY_MODEL_GATEWAY_URL: svc.url, FOUNDRY_MODEL_GATEWAY_TOKEN: svc.token } : {} });
  } catch (error) {
    // runClaudeCode throws only before the CLI starts (model id, sandbox, workspace): nothing was spent.
    r = { costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: null, usage: null, streamUsage: null, toolUses: [], sessionId: null,
      error: { code: error.code === 'SANDBOX_UNAVAILABLE' ? 'SANDBOX_UNAVAILABLE' : 'EXECUTOR_LAUNCH', message: String(error.message ?? error).slice(0, 500) } };
  } finally { await svc.close(); }   // settles in-flight gateway calls: the ledger below is complete
  const artifactName = arm === 'F' ? 'workflow.json' : 'solve.mjs', artifactPath = path.join(workdir, artifactName), artifact = existsSync(artifactPath) ? artifactName : null;
  const builderCostUsd = r.costUsd ?? r.costUpperUsd;   // unknown builder spend is charged at its bound, never $0
  // (/tmp is private to the sandbox, so it is not listed.)
  const outside = u => (JSON.stringify(u.input ?? '').match(/\/(?:home|root|opt|mnt|var|run|srv|media|etc|proc)\/[\w.\/-]*/g) ?? [])
    .filter(p => !p.startsWith(workdir) && !p.startsWith(kit.dir));
  const stated = taskHostPaths(probes.map(p => [p.prompt, p.inputs ?? {}, p.files ?? {}]));
  const accessed = accessedOutsidePaths(r.toolUses, [workdir, kit.dir], { ignore: stated });
  const repo = repoPathMentions(r.toolUses, { ignoreText: JSON.stringify(probes.map(p => [p.prompt, p.inputs ?? {}, p.files ?? {}])),
    counted: u => accessedOutsidePaths([u], [workdir, kit.dir], { ignore: stated }).attempts > 0 });
  const checkPath = path.join(workdir, SELF_CHECK_FILE), check = selfCheck && existsSync(checkPath) ? SELF_CHECK_FILE : null;
  const record = {
    arm, armId, familyId, label, difficulty: perSeed ? null : difficulty, probeSeeds, builderModel, builderEffort, kitHash: kit.hash, kitDir: kit.dir, policyHash: modelPort.policyHash, models, runId: svc.runId,
    promptSha256: sha(prompt), artifact, artifactSha256: artifact ? sha(readFileSync(artifactPath)) : null,
    builderCostUsd, builderCostReportedUsd: r.costUsd ?? null, builderCostUnknown: !!r.costUnknown, builderCostUpperUsd: r.costUpperUsd ?? null, builderBudgetUsd,
    builderUsage: r.usage ?? null, builderStreamUsage: r.streamUsage ?? null, builderSessionId: r.sessionId ?? null,
    gatewayCostUsd: ledger.spentUsd, gatewayCapUsd: ledger.capUsd, gatewayOvershootUsd: Math.max(0, ledger.spentUsd - ledger.capUsd), gatewayCalls: ledger.calls, gatewayErrors: ledger.errors,
    gatewayRefusals: ledger.refusals, gatewayUnknownCalls: ledger.unknownCalls, gatewayUnknownUpperUsd: ledger.unknownUpperUsd, gatewayImputedUsd: ledger.imputedUsd,
    constructionCostUsd: builderCostUsd + ledger.spentUsd, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, minutes, turns: r.turns, toolUses: r.toolUses.length,
    builderError: r.error ?? null, scoreLog: svc.scoreLog, scoreChecks, firstPassAtCheck: svc.scoreLog.findIndex(s => s.pass) + 1 || null,
    notes: existsSync(path.join(workdir, 'BUILD-NOTES.md')) ? readFileSync(path.join(workdir, 'BUILD-NOTES.md'), 'utf8').slice(0, 4000) : null,
    // Transcript scans: nestedModelAttempts > 0 voids the construction (pre-registered); outsidePaths is reviewed by hand.
    hiddenPathAttempts: r.toolUses.filter(u => outside(u).length).length, outsidePaths: [...new Set(r.toolUses.flatMap(outside))].slice(0, 100),
    nestedModelAttempts: nestedModelUses(r.toolUses),
    // Need router v1 (additive): the accessed-path scan (accessedOutsidePaths above), the one whose hits void a lineage;
    // paths the probe tasks state are not attempts.
    hiddenPathAccesses: accessed.attempts, accessedOutsidePaths: accessed.paths.slice(0, 100), taskPathsIgnored: accessed.ignored.length,
    // The repository root named where the accessed scan does not look (heredoc bodies, written content, ~ forms, encodings): it voids too.
    repoPathMentions: repo.attempts, repoPathForms: repo.forms,
    // Need router v1 additions (additive; selfCheck is false and check null for C0 callers).
    runSolverCalls: runSolverCallsOf(r.toolUses), builderMessageUsage: r.transcript ? messageUsageOf(r.transcript) : null,
    selfCheck: !!selfCheck, check, checkSha256: check ? sha(readFileSync(checkPath)) : null,
  };
  writeFileSync(path.join(workdir, 'construction.json'), JSON.stringify(record, null, 1));
  return { record, workdir, artifactPath: artifact ? artifactPath : null, checkPath: check ? checkPath : null };
}
