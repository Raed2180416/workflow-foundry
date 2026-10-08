// Deliberately broken variants of the ORIGINAL workflow (control: "a broken variant must fail"). Each is the vendored text with one
// edit, made in memory (nothing is written next to the original). `fails(instance)` says on which instances the oracle MUST reject the
// variant in 'original' mode; on the others it must PASS (they are near misses with a precise blast radius, not noise), with one
// exception: wrong-reference-url is wrong on every instance by design (it exercises the network sandbox and the FETCH check).
// An `equivalent` variant changes the text but not the behaviour on any instance: the oracle must accept it.
const COMPOSE = 'src/main/resources/docker-compose/selenium4.yml';

function removeBlocks(text, startRe, endLine) {
  const lines = text.split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      while (i < lines.length && lines[i] !== endLine) i++;
      if (lines[i + 1] === '') i++;                         // the blank line after the block
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}
function replaceOnce(text, from, to) {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`mutant anchor not found: ${from.slice(0, 60)}`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}
const updated = i => i.truth.original.status === 'updated';
const nonChromeChange = i => updated(i) && i.truth.original.changed.some(c => c.key !== 'chrome');

export const MUTANTS = Object.freeze([
  { id: 'prerelease-filter-dropped', describe: 'the four "if echo ... grep -qiE nightly|beta|dev" blocks are removed: pre-release tags are used as they are',
    apply: t => removeBlocks(t, /^ {10}if echo "\$(CHROME|EDGE|FIREFOX|HUB)_VERSION" \| grep -qiE 'nightly\|beta\|dev'; then$/, '          fi'),
    fails: i => ['prerelease-reducible', 'prerelease-unreducible'].includes(i.kind) },
  { id: 'pr-guard-inverted', describe: 'the Create Pull Request step runs when nothing changed instead of when something did',
    apply: t => { const first = t.indexOf("if: steps.update-file.outputs.changes == 'true'"); const second = t.indexOf("if: steps.update-file.outputs.changes == 'true'", first + 1);
      return t.slice(0, second) + "if: steps.update-file.outputs.changes != 'true'" + t.slice(second + "if: steps.update-file.outputs.changes == 'true'".length); },
    fails: updated },
  { id: 'only-chrome-updated', describe: 'the Edge, Firefox and Hub update blocks are removed: only Chrome is ever rewritten',
    apply: t => removeBlocks(t, /^ {10}if \[ "\$NEW_(EDGE|FIREFOX|HUB)" != "\$CURRENT_(EDGE|FIREFOX|HUB)" \]; then$/, '          fi'),
    fails: nonChromeChange },
  { id: 'last-match-instead-of-first', describe: 'step 2 reads the LAST matching line of the reference (tail -1) instead of the first',
    apply: t => t.split('\n').map(l => (l.includes('/tmp/reference-compose.yml | head -1') ? l.replace('head -1', 'tail -1') : l)).join('\n'),
    fails: i => ['duplicate-lines', 'commented-image-line'].includes(i.kind) },
  { id: 'sed-first-occurrence-only', describe: 'EQUIVALENT variant: the four seds lose their g flag; no instance has two occurrences of an image on one line, so every instance must still pass (the oracle must not reject a different but equivalent workflow)',
    apply: t => t.split('\n').map(l => (/^ {12}sed -i "s\|/.test(l) ? l.replace('|g" ', '|" ') : l)).join('\n'),
    fails: () => false, equivalent: true },
  { id: 'validation-removed', describe: 'the docker compose validation step is removed: a corrupted file goes to review',
    apply: t => { const a = t.indexOf('      - name: Validate Docker Compose File'), b = t.indexOf('      - name: Create Pull Request'); return t.slice(0, a) + t.slice(b); },
    fails: i => ['reference-malformed', 'reference-missing-image'].includes(i.kind) },
  { id: 'branch-input-removed', describe: 'the branch input is removed: the action falls back to its default branch, so an open bot pull request is never updated',
    apply: t => replaceOnce(t, '          branch: auto-update-selenium-grid-versions\n', ''),
    fails: updated },
  { id: 'labels-removed', describe: 'the labels input is removed',
    apply: t => replaceOnce(t, '          labels: |\n            dependencies\n            automated', ''),
    fails: updated },
  { id: 'pr-without-change', describe: 'the job always reports changes and touches the file ("last checked"), so a pull request is opened every week',
    apply: t => replaceOnce(t, '            echo "changes=false" >> $GITHUB_OUTPUT', `            echo "changes=true" >> $GITHUB_OUTPUT\n            echo "# last checked by the weekly job" >> ${COMPOSE}`),
    fails: i => i.truth.original.status === 'unchanged' },
  { id: 'wrong-reference-url', describe: 'the curl URL names docker-compose-v2.yml: a call the recorded mock does not serve (the curl shim blocks it)',
    apply: t => replaceOnce(t, 'docker-compose-v3.yml > /tmp', 'docker-compose-v2.yml > /tmp'),
    fails: () => true },
]);
