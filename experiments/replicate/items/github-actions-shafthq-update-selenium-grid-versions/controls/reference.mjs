// Two independent JavaScript implementations of the job, used as known-good controls and as the differential check on the
// by-construction truth in scenarios.mjs. Both take what a solver gets (`inputs`, see index.mjs) and return a plan (outputSchema).
//   solveFaithful   a line-by-line port of the vendored original's bash (grep first match, sed strip, the pre-release rule, errexit,
//                   the sed replacement, the validation step, the pull-request step). referenceSolve for T1. It reproduces the original's
//                   defects on purpose and throws 'UNMODELLED' on input whose bash semantics it does not port (`$`, backtick, backslash in a tag).
//   solveImproved   what the maintainers evidently want: reads the files as YAML-ish compose (comments ignored, quotes tolerated),
//                   refuses a reference that is not usable and says why, never writes a pre-release. referenceSolve for T2 and T3.
import { COMPOSE_PATH, ITEM, KEYS, PRERELEASE_RE, REFERENCE_URL, STABLE_CORE_RE, TRACKED, readText } from '../spec.mjs';
import { interpolate, parseWorkflow } from '../runner.mjs';
import { validateCompose } from '../mocks/compose-validate.mjs';
import { splitList } from '../mocks/pull-requests.mjs';

const PR_STEP = parseWorkflow(readText(ITEM.vendoredPath)).steps.find(s => s.uses?.startsWith('peter-evans/create-pull-request'));
const OUT_NAME = { chrome: 'CHROME', edge: 'EDGE', firefox: 'FIREFOX', hub: 'HUB' };

/** The pull request text, rendered from the original's own templates so the two cannot drift apart. */
export function renderPrText(current, latest) {
  const steps = {
    'check-current': { outputs: Object.fromEntries(KEYS.map(k => [`CURRENT_${OUT_NAME[k]}`, current[k]])) },
    'fetch-reference': { outputs: Object.fromEntries(KEYS.map(k => [`${OUT_NAME[k]}_VERSION`, latest[k]])) },
  };
  const w = PR_STEP.with, ctx = { steps };
  return { branch: w.branch, title: interpolate(w.title, ctx), body: interpolate(w.body, ctx), commit_message: interpolate(w['commit-message'], ctx), labels: splitList(w.labels) };
}

const blank = () => Object.fromEntries(KEYS.map(k => [k, '']));
const versionsOf = (current, latest) => ({ current: { ...blank(), ...current }, latest: { ...blank(), ...latest } });
const failedPlan = (message, current = {}, latest = {}) => ({ status: 'failed', versions: versionsOf(current, latest), files: {}, pull_request: { open: false }, message });
const referenceOf = inputs => inputs.reference_fetch;

// ---------- the faithful port ------------------------------------------------------------------------------------------------------
class Unmodelled extends Error { constructor(what) { super(`UNMODELLED: ${what}`); this.code = 'UNMODELLED'; } }
const BASH_DANGER = /[$`\\]/;

// VAR=$(grep 'image: IMG:' FILE | head -1 | sed 's/.*IMG://; s/[[:space:]]*$//')
function grepFirstTag(text, image) {
  const line = text.split('\n').find(l => l.includes(`image: ${image}:`));
  if (line === undefined) return '';
  return line.slice(line.lastIndexOf(`${image}:`) + image.length + 1).replace(/[ \t\n\v\f\r]+$/, '');
}
// sed 's|PATTERN|REPLACEMENT|g' over every line, PATTERN a basic regular expression made of literals and '.'
function sedReplaceAll(text, pattern, replacement) {
  if (/[*[\]^$\\]/.test(pattern) || /[&\\|]/.test(replacement)) throw new Unmodelled(`sed metacharacters in "${pattern}" / "${replacement}"`);
  const re = new RegExp(pattern.replace(/[()+?{}|]/g, c => `\\${c}`).replace(/\./g, '[^\\n]'), 'g');
  return text.replace(re, () => replacement);
}

export function solveFaithful(inputs, flags = {}) {
  const repo = inputs.repo_files[COMPOSE_PATH];
  const ref = referenceOf(inputs);
  // Step "Fetch Latest Selenium Docker Compose Reference": curl -s ... > file (no -f: an error page is just a body; a dead connection fails the step)
  if (ref.error) return failedPlan('');
  const latest = {};
  for (const t of TRACKED) latest[t.key] = grepFirstTag(ref.body, t.image);
  const outputs = {};
  for (const t of TRACKED) {                                        // chrome, edge, firefox, hub, in the original's order
    let v = latest[t.key];
    if (PRERELEASE_RE.test(v)) {                                    // grep -qiE 'nightly|beta|dev'
      const core = v.match(STABLE_CORE_RE);                         // CHROME_VERSION=$(echo ... | grep -oE '[0-9]+\.[0-9]+\.[0-9]+-[0-9]+')  under errexit
      if (!core) return failedPlan(`Warning: ${t.label} version contains pre-release tag: ${v}`);
      v = core.join('\n');
    }
    latest[t.key] = v;
    outputs[t.key] = v;
  }
  for (const k of KEYS) if (outputs[k].includes('\n')) return failedPlan(`Unable to process file command 'output' successfully.\nInvalid format '${outputs[k].split('\n')[1]}'`);
  const current = {};
  for (const t of TRACKED) current[t.key] = grepFirstTag(repo, t.image);
  // Step "Update Docker Compose File": the values are pasted into the script text inside double quotes before bash runs it.
  for (const k of KEYS) for (const v of [latest[k], current[k]]) {
    if (BASH_DANGER.test(v)) throw new Unmodelled(`bash expansion characters in tag "${v}"`);
    if (v.includes('"')) return failedPlan('syntax error: unexpected EOF while looking for matching `"\'', current, latest);
  }
  let text = repo, changes = false;
  for (const t of TRACKED) {
    if (latest[t.key] !== current[t.key]) { text = sedReplaceAll(text, `${t.image}:${current[t.key]}`, `${t.image}:${latest[t.key]}`); changes = true; }
  }
  if (!changes) return { status: 'unchanged', versions: versionsOf(current, latest), files: {}, pull_request: { open: false }, message: 'No changes needed - versions are up to date' };
  const verdict = flags.skipValidation ? { ok: true } : validateCompose(text);   // Step "Validate Docker Compose File": docker compose -f FILE config
  if (!verdict.ok) return failedPlan(verdict.message, current, latest);
  const pr = renderPrText(current, latest);
  return {
    status: text !== repo ? 'updated' : 'unchanged',
    versions: versionsOf(current, latest),
    files: text !== repo ? { [COMPOSE_PATH]: text } : {},
    pull_request: { open: true, ...pr },
    message: 'Changes were made to the docker-compose file',
  };
}

// ---------- the improved reference ----------------------------------------------------------------------------------------------------
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The tag of the first real (uncommented) `image: NAME:TAG` line, quotes and trailing comments not part of it; '' if none. */
export function yamlFirstTag(text, image) {
  const re = new RegExp(`^\\s*(?:-\\s+)?image:\\s*(['"]?)${escapeRe(image)}:([^\\s'"#]*)\\1\\s*(?:#.*)?$`);
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = re.exec(line);
    if (m) return m[2];
  }
  return '';
}

export function solveImproved(inputs, flags = {}) {
  const repo = inputs.repo_files[COMPOSE_PATH];
  const ref = referenceOf(inputs);
  const cannot = (why, current, latest) => failedPlan(`cannot update: the Selenium reference file (${REFERENCE_URL}) ${why}`, current, latest);
  if (ref.error) return cannot(`could not be fetched (${ref.error})`);
  if (ref.status < 200 || ref.status > 299) return cannot(`answered HTTP ${ref.status} instead of a compose file`);
  const latest = {}, missing = [];
  for (const t of TRACKED) { latest[t.key] = yamlFirstTag(ref.body, t.image); if (!latest[t.key]) missing.push(t.image); }
  if (missing.length) return cannot(`has no image line for ${missing.join(', ')}, so it is not the compose file this job reads`, {}, latest);
  for (const t of TRACKED) {
    if (flags.keepPrerelease || !PRERELEASE_RE.test(latest[t.key])) continue;
    const core = latest[t.key].match(STABLE_CORE_RE);
    if (core?.length !== 1) return failedPlan(`cannot update: the reference tag "${latest[t.key]}" of ${t.image} is a pre-release (nightly/beta/dev) with no stable X.Y.Z-DATE version to use instead`, {}, latest);
    latest[t.key] = core[0];
  }
  const current = Object.fromEntries(TRACKED.map(t => [t.key, yamlFirstTag(repo, t.image)]));
  let text = repo;
  for (const t of TRACKED) {
    if (!current[t.key] || current[t.key] === latest[t.key]) continue;
    text = text.replace(new RegExp(`${escapeRe(`${t.image}:${current[t.key]}`)}(?![\\w.-])`, 'g'), () => `${t.image}:${latest[t.key]}`);
  }
  if (text === repo) return { status: 'unchanged', versions: versionsOf(current, latest), files: {}, pull_request: { open: false }, message: 'No changes needed - versions are up to date' };
  const verdict = validateCompose(text);
  if (!verdict.ok) return failedPlan(`cannot update: the edited compose file would be invalid (${verdict.message})`, current, latest);
  return { status: 'updated', versions: versionsOf(current, latest), files: { [COMPOSE_PATH]: text }, pull_request: { open: true, ...renderPrText(current, latest) }, message: 'Changes were made to the docker-compose file' };
}

/** A solution that does nothing: no files, no pull request, "unchanged", and no versions to report. */
export const solveNothing = () => ({ status: 'unchanged', versions: versionsOf({}, {}), files: {}, pull_request: { open: false }, message: '' });
