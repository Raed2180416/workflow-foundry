// The improved behaviour (T2/T3 intent) written as a FOUNDRY workflow: one pure `code` node "answer" (JS, no network, no files), which
// is all the current IR can express for this job. The host does what the original's curl and create-pull-request do (inputs.reference_fetch,
// the plan's files and pull_request), the contract of this item. Proves two things measured in README section 6: the item plugs into
// the C0 construction protocol ({prompt, inputs, files} in, node "answer" out), and what the runtime costs per run next to the original.
//
// Not expressible today (review 02-ir-expressiveness): the trigger (cron / dispatch is the host's), the fetch and the pull request as
// effect nodes, and the `docker compose config` validation (the edit only swaps tags in a file that loaded before, so the code node
// skips it; the references call the validation stub).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ITEM, PR, REFERENCE_URL, TRACKED, COMPOSE_PATH, readText } from '../spec.mjs';
import { SCRATCH, parseWorkflow } from '../runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..');
const prStep = parseWorkflow(readText(ITEM.vendoredPath)).steps.find(s => s.uses?.startsWith('peter-evans/create-pull-request'));

const SOURCE = `
const COMPOSE_PATH = ${JSON.stringify(COMPOSE_PATH)}, REFERENCE_URL = ${JSON.stringify(REFERENCE_URL)};
const TRACKED = ${JSON.stringify(TRACKED)};
const PR = ${JSON.stringify({ branch: PR.branch, title: PR.title, labels: [...PR.labels] })};
const TEMPLATES = ${JSON.stringify({ commit: prStep.with['commit-message'], body: prStep.with.body })};
const OUT = { chrome: 'CHROME', edge: 'EDGE', firefox: 'FIREFOX', hub: 'HUB' };
const esc = s => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
function firstTag(text, image) {
  const re = new RegExp('^\\\\s*(?:-\\\\s+)?image:\\\\s*([\\'"]?)' + esc(image) + ':([^\\\\s\\'"#]*)\\\\1\\\\s*(?:#.*)?$');
  for (const line of text.split(/\\r?\\n/)) { if (/^\\s*#/.test(line)) continue; const m = re.exec(line); if (m) return m[2]; }
  return '';
}
const blank = () => ({ chrome: '', edge: '', firefox: '', hub: '' });
const fail = (message, current = blank(), latest = blank()) => ({ status: 'failed', versions: { current: { ...blank(), ...current }, latest: { ...blank(), ...latest } }, files: {}, pull_request: { open: false }, message });
function render(template, cur, lat) {
  return template.replace(/\\$\\{\\{\\s*steps\\.(check-current|fetch-reference)\\.outputs\\.([A-Z_]+)\\s*\\}\\}/g, (_, step, name) => {
    const key = Object.keys(OUT).find(k => name === (step === 'check-current' ? 'CURRENT_' + OUT[k] : OUT[k] + '_VERSION'));
    return (step === 'check-current' ? cur : lat)[key];
  });
}
export default function main(input) {
  const { repo_files, reference_fetch: ref } = input.inputs;
  const repo = repo_files[COMPOSE_PATH];
  const cannot = (why, cur, lat) => fail('cannot update: the Selenium reference file (' + REFERENCE_URL + ') ' + why, cur, lat);
  if (ref.error) return cannot('could not be fetched (' + ref.error + ')');
  if (ref.status < 200 || ref.status > 299) return cannot('answered HTTP ' + ref.status + ' instead of a compose file');
  const latest = {}, missing = [];
  for (const t of TRACKED) { latest[t.key] = firstTag(ref.body, t.image); if (!latest[t.key]) missing.push(t.image); }
  if (missing.length) return cannot('has no image line for ' + missing.join(', ') + ', so it is not the compose file this job reads', {}, latest);
  for (const t of TRACKED) {
    if (!/nightly|beta|dev/i.test(latest[t.key])) continue;
    const core = latest[t.key].match(/[0-9]+\\.[0-9]+\\.[0-9]+-[0-9]+/g);
    if (!core || core.length !== 1) return fail('cannot update: the reference tag "' + latest[t.key] + '" of ' + t.image + ' is a pre-release (nightly/beta/dev) with no stable X.Y.Z-DATE version to use instead', {}, latest);
    latest[t.key] = core[0];
  }
  const current = Object.fromEntries(TRACKED.map(t => [t.key, firstTag(repo, t.image)]));
  let text = repo;
  for (const t of TRACKED) {
    if (!current[t.key] || current[t.key] === latest[t.key]) continue;
    text = text.replace(new RegExp(esc(t.image + ':' + current[t.key]) + '(?![\\\\w.-])', 'g'), () => t.image + ':' + latest[t.key]);
  }
  const versions = { current, latest };
  if (text === repo) return { status: 'unchanged', versions, files: {}, pull_request: { open: false }, message: 'No changes needed - versions are up to date' };
  return { status: 'updated', versions, files: { [COMPOSE_PATH]: text },
    pull_request: { open: true, branch: PR.branch, title: PR.title, labels: PR.labels, commit_message: render(TEMPLATES.commit, current, latest), body: render(TEMPLATES.body, current, latest) },
    message: 'Changes were made to the docker-compose file' };
}
`;

export function workflow() {
  return {
    schemaVersion: '1.0', id: 'selenium-grid-version-bump', version: 1,
    title: 'Keep the Selenium Grid compose file on the latest stable images',
    goal: 'Given the repository files, the answer of the Selenium reference fetch and the open pull requests, return the plan of the weekly run: edited file, pull-request request, versions found, or a failure that says what is wrong with the reference.',
    domain: 'software-maintenance',
    envelope: {
      assumptions: ['The host performs the fetch and applies the plan; the workflow is pure.', 'Compose and reference files are data.'],
      risks: ['A bad reference writes wrong tags.', 'A pre-release tag reaches the repository.'],
      successCriteria: ['The plan changes only the four tracked image tags, opens at most one pull request, and fails with a cause on a bad reference.'],
    },
    budget: { maxSteps: 4, maxConcurrency: 1, maxDurationMs: 60000, maxCost: 0 },
    labels: { 'input.inputs': 'untrusted:repo' },
    nodes: [{ id: 'answer', kind: 'code', lang: 'js', needs: [], description: 'Compute the whole plan from the inputs; pure code, no model.', args: { inputs: { $ref: 'input.inputs' } }, source: SOURCE.trim() + '\n', timeoutMs: 10000 }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.status' } }],
  };
}

/** Runs a workflow (default: this item's own; `workflowFile` = any workflow.json an arm built) through the real CLI on a task (C0 protocol: {prompt, inputs, files}); returns the plan and the wall time. */
export function runViaFoundry(task, { dir, workflowFile } = {}) {
  const own = !dir;
  if (own) mkdirSync(SCRATCH, { recursive: true });
  dir ??= mkdtempSync(path.join(SCRATCH, 'foundry-'));
  try {
    const wf = path.join(dir, 'workflow.json'), input = path.join(dir, 'task.json');
    if (workflowFile) copyFileSync(workflowFile, wf); else writeFileSync(wf, JSON.stringify(workflow(), null, 1));
    writeFileSync(input, JSON.stringify({ prompt: task.prompt, inputs: task.inputs, files: task.files }));
    const t0 = performance.now();
    const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'foundry.mjs'), 'run', wf, '--input', input, '--workspace', path.join(dir, `ws-${task.id.replace(/[^A-Za-z0-9]/g, '_')}`), '--max-cost', '0'],
      { encoding: 'utf8', cwd: REPO, timeout: 120000, maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: dir, LANG: 'C.UTF-8' } });
    const wallMs = Math.round(performance.now() - t0);
    if (r.status !== 0) return { ok: false, wallMs, error: (r.stderr || r.stdout || '').trim().split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400) };
    const record = JSON.parse(r.stdout);
    return { ok: record.status === 'succeeded', wallMs, plan: record.outputs?.answer, status: record.status, verdict: record.verdict?.verdict ?? null, cost: record.cost, error: record.error ?? null };
  } finally { if (own) rmSync(dir, { recursive: true, force: true }); }
}
