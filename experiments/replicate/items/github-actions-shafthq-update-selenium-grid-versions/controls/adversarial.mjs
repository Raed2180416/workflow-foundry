// Adversarial probes of the oracle, written by the verifier on 2026-10-08 (README "Known limits"). One independent implementation of the
// rules R1-R8 (not copied from controls/reference.mjs) with knobs that make (a) WRONG solutions the oracle should reject and (b) CORRECT
// alternatives it should accept. `expect` is what the oracle does TODAY on the intent mode (T2/T3) of every task: item.test.mjs pins it, so a
// change to the oracle or the generator that closes a known limit (or opens a new hole) shows up as a failing test, not silently.
//   expect 'pass'  : the oracle accepts it on every task      expect 'fail-some': it rejects it on at least one task
const COMPOSE = 'src/main/resources/docker-compose/selenium4.yml';
const IMG = { chrome: 'selenium/node-chrome', edge: 'selenium/node-edge', firefox: 'selenium/node-firefox', hub: 'selenium/hub' };
const LABEL = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', hub: 'Hub' };
const KEYS = Object.keys(IMG);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blank = () => ({ chrome: '', edge: '', firefox: '', hub: '' });
const cmpVer = (a, b) => { const pa = a.split(/[.-]/).map(Number), pb = b.split(/[.-]/).map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; } return 0; };

function tagsOf(text, image, { includeComments = false, pick = 'first' } = {}) {
  const found = [];
  for (let line of text.split('\n')) {
    line = line.replace(/\r$/, '');
    let l = line.trim();
    if (l.startsWith('#')) { if (!includeComments) continue; l = l.replace(/^#\s*/, ''); }
    const m = new RegExp(`^(?:-\\s+)?image:\\s*(["']?)${esc(image)}:([^\\s"'#]+)\\1\\s*(#.*)?$`).exec(l);
    if (m) found.push(m[2]);
  }
  if (!found.length) return '';
  if (pick === 'max') return [...found].sort(cmpVer).at(-1);
  if (pick === 'last') return found.at(-1);
  return found[0];
}

function makeSolver(o = {}) {
  return function solve(inputs) {
    const ref = inputs.reference_fetch, repo = inputs.repo_files[COMPOSE];
    const fail = (msg, cur = blank(), lat = blank()) => ({ status: 'failed', versions: { current: { ...blank(), ...cur }, latest: { ...blank(), ...lat } }, files: {}, pull_request: { open: false }, message: o.failMessage ?? msg });
    if (ref.error) return fail(`could not fetch the reference ${ref.url}: ${ref.error}`);
    if (!o.ignoreHttpStatus && (ref.status < 200 || ref.status >= 300)) return fail(`reference ${ref.url} answered HTTP ${ref.status}`);
    const latest = {};
    for (const k of KEYS) latest[k] = tagsOf(ref.body, IMG[k], { includeComments: o.refIncludeComments, pick: o.refPick ?? 'first' });
    const gone = KEYS.filter(k => !latest[k]);
    if (gone.length) return fail(`the reference ${ref.url} has no tag for ${gone.map(k => IMG[k]).join(', ')}`, {}, latest);
    for (const k of KEYS) {
      if (o.noPrereleaseRule || !/nightly|beta|dev/i.test(latest[k])) continue;
      const m = latest[k].match(/\d+\.\d+\.\d+-\d+/);
      if (!m) return fail(`pre-release tag ${latest[k]} for ${IMG[k]} has no stable part`, {}, latest);
      latest[k] = m[0];
    }
    const current = {};
    for (const k of KEYS) current[k] = tagsOf(repo, IMG[k]);
    let text = repo;
    const changed = [];
    for (const k of KEYS) {
      if (!current[k] || current[k] === latest[k]) continue;
      if (o.noDowngrade && cmpVer(latest[k], current[k]) < 0) continue;
      const re = new RegExp(`${esc(`${IMG[k]}:${current[k]}`)}(?![\\w.-])`, 'g');
      if (o.imageLinesOnly) text = text.split('\n').map(l => (/^\s*image:/.test(l) ? l.replace(re, `${IMG[k]}:${latest[k]}`) : l)).join('\n');
      else text = text.replace(re, `${IMG[k]}:${latest[k]}`);
      changed.push(k);
    }
    if (text === repo) return { status: 'unchanged', versions: { current, latest }, files: {}, pull_request: { open: false }, message: 'nothing to do' };
    const fmt = o.prFormat ?? 'arrow';
    const lines = changed.map(k => {
      const L = LABEL[k], a = current[k], b = latest[k];
      if (fmt === 'arrow') return `- ${L}: ${a} -> ${b}`;
      if (fmt === 'was') return `- ${L} now ${b} (was ${a})`;
      if (fmt === 'block') return `### ${L}\n- old: ${a}\n- new: ${b}`;
      if (fmt === 'image-name') return `- ${IMG[k]}: ${a} -> ${b}`;
      if (fmt === 'table-new-first') return `| ${L} | ${b} | ${a} |`;
      throw new Error(fmt);
    });
    let body = `Weekly bump of the Selenium Grid images.\n\n${(fmt === 'table-new-first' ? ['| Image | New | Old |', '|---|---|---|'] : []).concat(lines).join('\n')}\n`;
    let commit = `Update Selenium Grid Docker images to latest stable versions\n\n${lines.join('\n')}\n`;
    if (o.stuffedText) {
      const all = `${KEYS.map(k => LABEL[k]).join(' ')} ${KEYS.map(k => current[k]).join(' ')} ${KEYS.map(k => latest[k]).join(' ')}`;
      body = `bump ${all}`; commit = `bump ${all}`;
    }
    return { status: 'updated', versions: { current, latest }, files: { [COMPOSE]: text },
      pull_request: { open: true, branch: 'auto-update-selenium-grid-versions', title: 'Update Selenium Grid Docker images to latest stable versions',
        commit_message: commit, body, labels: o.labels ?? ['dependencies', 'automated'] },
      message: 'updated' };
  };
}

const leftovers = solve => inputs => {
  const p = solve(inputs);
  if (p.status !== 'failed') return p;
  return { ...p, files: { [COMPOSE]: `${inputs.repo_files[COMPOSE]}# half-done edit\n` }, pull_request: { open: true, branch: 'auto-update-selenium-grid-versions' } };
};
const backwards = solve => inputs => {
  const p = solve(inputs);
  if (p.status !== 'updated') return p;
  const { current, latest } = p.versions;
  const lines = KEYS.filter(k => current[k] && current[k] !== latest[k]).map(k => `- ${LABEL[k]}: ${latest[k]} -> ${current[k]}`).join('\n');
  return { ...p, pull_request: { ...p.pull_request, body: lines, commit_message: `Update\n\n${lines}` } };
};

export const ADVERSARIAL = Object.freeze([
  // correct alternatives: must pass
  { name: 'independent-correct', correct: true, expect: 'pass', why: 'R1-R8 as written, without a validation step', solve: makeSolver() },
  { name: 'pr-text-new-then-old', correct: true, expect: 'pass', why: '"Chrome now NEW (was OLD)": R5 does not prescribe the order (failed before the verifier fix)', solve: makeSolver({ prFormat: 'was' }) },
  { name: 'pr-text-block', correct: true, expect: 'pass', why: 'a heading per image with old:/new: lines (failed before the verifier fix)', solve: makeSolver({ prFormat: 'block' }) },
  { name: 'pr-text-table-new-first', correct: true, expect: 'pass', why: 'a | Image | New | Old | table (failed before the verifier fix)', solve: makeSolver({ prFormat: 'table-new-first' }) },
  { name: 'labels-twice', correct: true, expect: 'pass', why: 'a label listed twice: labels are a set on GitHub (failed before the verifier fix)', solve: makeSolver({ labels: ['dependencies', 'automated', 'dependencies'] }) },
  { name: 'failed-with-leftovers', correct: true, expect: 'pass', why: 'a failed plan that still carries files and a PR request, which the contract says the host discards (failed before the verifier fix)', solve: leftovers(makeSolver()) },
  { name: 'no-downgrade', correct: true, expect: 'pass', why: 'refuses to move a tag backwards (no instance needs a downgrade)', solve: makeSolver({ noDowngrade: true }) },
  // wrong solutions the oracle rejects
  { name: 'reads-last-reference-line', correct: false, expect: 'fail-some', why: 'R1: the first line, not the last', solve: makeSolver({ refPick: 'last' }) },
  { name: 'no-prerelease-rule', correct: false, expect: 'fail-some', why: 'R2 ignored', solve: makeSolver({ noPrereleaseRule: true }) },
  { name: 'pr-text-backwards', correct: false, expect: 'fail-some', why: 'the PR text says every change goes new -> old', solve: backwards(makeSolver()) },
  { name: 'catch-all-message-reference-only', correct: false, expect: 'fail-some', why: 'every failure says only "reference": misses the pre-release and the missing image', solve: makeSolver({ failMessage: 'reference' }) },
  // KNOWN LIMITS: wrong solutions the oracle ACCEPTS (README "Known limits"); flip these to 'fail-some' when the limit is closed
  { name: 'LIMIT-catch-all-misleading-message', correct: false, expect: 'pass', why: 'one fixed message stuffed with every keyword, false for most failures (MESSAGE is a keyword check that follows the R7 wording)', solve: makeSolver({ failMessage: 'The reference tag is a nightly pre-release for node-chrome, node-edge, node-firefox and hub' }) },
  { name: 'LIMIT-reads-commented-lines-takes-max', correct: false, expect: 'pass', why: 'R1 violated (commented lines read) but rescued by taking the highest tag: the generator never puts a NEWER tag on a commented or second line', solve: makeSolver({ refIncludeComments: true, refPick: 'max' }) },
  { name: 'LIMIT-stuffed-pr-text', correct: false, expect: 'pass', why: 'one uninformative line with every label and every tag satisfies the PR-text check', solve: makeSolver({ stuffedText: true }) },
]);
