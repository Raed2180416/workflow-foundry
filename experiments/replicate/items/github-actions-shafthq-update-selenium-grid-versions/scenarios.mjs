// Scenario instances for the SHAFT "update Selenium Grid versions" job: what the repository, the Selenium reference file and the
// pull-request list look like on one Monday, and what the job must then have done. HIDDEN from solvers (the oracle rebuilds them).
//
// Every instance is built from templates, so the expected result is known BY CONSTRUCTION (the generator planted the tags). Two
// expectations are kept per instance:
//   truth.original  what the vendored original does (T1 is judged on this, grep/sed/bash quirks included);
//   truth.intent    what the maintainers evidently want (T2 and T3 are judged on this). Equal to `original` except on the 4 defect kinds
//                   (the original's documented defects; README section 5) and on failure messages.
// controls/ proves the by-construction truth right: the executed original reproduces truth.original, and an independent
// reference implementation reproduces both.
import { rng } from '../../../../beds/lib/rng.mjs';
import { COMPOSE_PATH, KEYS, PR, TRACKED } from './spec.mjs';

export const VERSION = '0.1.0';
const IMAGE = Object.fromEntries(TRACKED.map(t => [t.key, t.image]));
const SHORT = Object.fromEntries(TRACKED.map(t => [t.key, t.image.replace('selenium/', '')]));
export const README_TEXT = '# shaft-fixture\n\nSynthetic repository for the R-bench item. Not the SHAFT repository.\n';

// ---------- tags ---------------------------------------------------------------------------------------------------------------
const pad = n => String(n).padStart(2, '0');
const dated = (minor, day) => { const d = new Date(Date.UTC(2025, 0, 6 + day)); return `4.${minor}.0-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
const minorOf = tag => Number(/^4\.(\d+)\./.exec(tag)[1]);
const dayOf = tag => { const m = /-(\d{4})(\d\d)(\d\d)$/.exec(tag); return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(2025, 0, 6)) / 86400000); };
const newer = (r, tag) => dated(minorOf(tag) + r.int(1, 3), dayOf(tag) + r.int(7, 60));
const older = (r, tag) => dated(Math.max(1, minorOf(tag) - r.int(8, 15)), Math.max(0, dayOf(tag) - r.int(120, 400)));
function drawCurrent(r) {
  const minor = r.int(20, 38), day = r.int(100, 250), shared = r.chance(0.7);
  return Object.fromEntries(KEYS.map(k => [k, shared ? dated(minor, day) : dated(minor - r.int(0, 2), day - r.int(0, 20))]));
}

// ---------- templates ------------------------------------------------------------------------------------------------------------
const NODE_ENV = ['      - SE_EVENT_BUS_HOST=selenium-hub', '      - SE_EVENT_BUS_PUBLISH_PORT=4442', '      - SE_EVENT_BUS_SUBSCRIBE_PORT=4443'];
const nodeService = (name, image) => [`  ${name}:`, image, '    shm_size: 2gb', '    depends_on:', '      - selenium-hub', '    environment:', ...NODE_ENV];
const hubService = image => ['  selenium-hub:', image, '    container_name: selenium-hub', '    ports:', '      - "4442:4442"', '      - "4443:4443"', '      - "4444:4444"'];

/**
 * The repository's selenium4.yml. spec = {tags: {chrome, edge, firefox, hub}, quote: {key: '"'|"'"}, omit: [key], dup: key, comment: bool}.
 * `dup` lists the image a second time on another service (same tag). `comment` adds a comment line that mentions the chrome tag.
 */
export function renderRepo({ tags, quote = {}, omit = [], dup = null, comment = false }) {
  const line = k => `    image: ${quote[k] ?? ''}${IMAGE[k]}:${tags[k]}${quote[k] ?? ''}`;
  const lines = [
    '# Selenium Grid 4 for the engine tests (synthetic fixture, shaped like the real file but not copied from it).',
    '# Browser nodes join the hub below; keep every image on the same dated release.',
    ...(comment ? [`# Pinned for the smoke job: selenium/node-chrome:${tags.chrome} (update together with the hub).`] : []),
    'services:',
    ...hubService(line('hub')),
  ];
  for (const k of ['chrome', 'edge', 'firefox']) {
    if (omit.includes(k)) continue;
    lines.push(...nodeService(k, line(k)));
    if (dup === k) lines.push(...nodeService(`${k}-2`, line(k)));
  }
  return lines.join('\n') + '\n';
}

/**
 * The Selenium reference file (stand-in for docker-selenium's docker-compose-v3.yml).
 * spec = {tags: {key: rawTagText}, order: [key], trail: bool, crlf: bool, comments: {key: oldTag}, omit: [key], dupOlder: {key, tag}}.
 * `comments[key]` puts a commented-out older image line right before that image's real line; `dupOlder` adds a second service that
 * uses the same image with an older tag, after the first one; `trail` leaves trailing spaces after the tag.
 */
export function renderReference({ tags, order = KEYS, trail = false, crlf = false, comments = {}, omit = [], dupOlder = null }) {
  const line = k => [...(comments[k] ? [`    # image: ${IMAGE[k]}:${comments[k]}`] : []), `    image: ${IMAGE[k]}:${tags[k]}${trail ? '  ' : ''}`];
  const lines = ['# Reference Docker Compose file for a Selenium Grid (synthetic stand-in for the docker-selenium project\'s file).', "version: '3'", 'services:'];
  for (const k of order) {
    if (omit.includes(k)) continue;
    if (k === 'hub') lines.push('  selenium-hub:', ...line(k), '    ports:', '      - "4442:4442"', '      - "4443:4443"', '      - "4444:4444"');
    else lines.push(`  ${k}:`, ...line(k), '    shm_size: 2gb', '    depends_on:', '      - selenium-hub', '    environment:', ...NODE_ENV, '    ports:', `      - "${k === 'chrome' ? 6900 : k === 'edge' ? 6901 : 6902}:5900"`);
    if (dupOlder?.key === k) lines.push(`  ${k}-legacy:`, `    image: ${IMAGE[k]}:${dupOlder.tag}`, '    shm_size: 2gb');
  }
  lines.push('  video:', '    image: selenium/video:ffmpeg-7.1-20250909', '    volumes:', '      - ./videos:/videos');
  return lines.join(crlf ? '\r\n' : '\n') + (crlf ? '\r\n' : '\n');
}

// ---------- pull requests -------------------------------------------------------------------------------------------------------------
function openPulls(r, staleCompose) {
  const bot = r.int(30, 60);
  return [
    { number: bot, state: 'open', head: PR.branch, base: PR.base, title: PR.title, body: 'Automated Docker Image Update (older run)', labels: [...PR.labels], commitMessage: 'older run',
      files: { [COMPOSE_PATH]: { status: 'modified', content: staleCompose } } },
    { number: bot + r.int(3, 9), state: 'open', head: 'dependabot/maven/org.testng-testng-7.11.0', base: PR.base, title: 'Bump org.testng:testng from 7.10.2 to 7.11.0', body: '', labels: ['dependencies'], commitMessage: 'Bump testng',
      files: { 'pom.xml': { status: 'modified', content: '<!-- bumped testng -->\n' } } },
  ];
}
// What the solver is told about open pull requests (number, branch, title); bodies and file contents stay with the world.
export const summarisePulls = pulls => pulls.map(p => ({ number: p.number, head: p.head, base: p.base, title: p.title }));

// ---------- building instances ---------------------------------------------------------------------------------------------------------------
const REFERENCE_TOKENS = ['reference', 'docker-compose-v3', 'raw.githubusercontent', 'fetch', 'download'];
const subsetOf = (r, keys, min, max) => r.sample(keys, r.int(min, max));

// The change list and the expected file for "these tags are in the repository, these are the latest, everything else is as the spec says".
function outcomeOf({ spec, cur, lat, pull }) {
  const newTags = { ...cur }, changed = [];
  for (const k of KEYS) if (cur[k] !== '' && lat[k] !== '' && lat[k] !== cur[k]) { newTags[k] = lat[k]; changed.push({ key: k, from: cur[k], to: lat[k] }); }
  const versions = { current: { ...cur }, latest: { ...lat } };
  if (!changed.length) return { status: 'unchanged', versions, changed, composeAfter: null, prAction: null, prNumber: null, message: null };
  return { status: 'updated', versions, changed, composeAfter: renderRepo({ ...spec, tags: newTags }),
    prAction: pull ? 'updated' : 'created', prNumber: pull ? pull.number : null, message: null };
}
const failed = (message = null) => ({ status: 'failed', versions: null, changed: [], composeAfter: null, prAction: null, prNumber: null, message });
const mention = (...groups) => ({ allOf: groups });

function base(r, { commentRate = 0 } = {}) {
  const cur = drawCurrent(r.fork('cur'));
  return { cur, spec: { tags: cur, quote: {}, omit: [], dup: null, comment: r.fork('comment').chance(commentRate) },
    ref: { order: r.fork('order').shuffle([...KEYS]), trail: r.fork('trail').chance(0.3), crlf: r.fork('crlf').chance(0.2), comments: {}, omit: [], dupOlder: null } };
}
const world = ({ spec, refSpec, rawTags, http, pulls = [] }) => ({
  repo: { [COMPOSE_PATH]: renderRepo(spec), 'README.md': README_TEXT },
  http: http ?? { status: 200, body: renderReference({ ...refSpec, tags: rawTags }) },
  openPullRequests: pulls,
});
const same = t => ({ original: t, intent: t });

export const KINDS = Object.freeze([
  { id: 'bump-all', minDifficulty: 1, note: 'every tracked image has a newer stable tag; a comment in the file repeats the chrome tag',
    build(r) {
      const { cur, spec, ref } = base(r, { commentRate: 0.5 }), rr = r.fork('lat');
      const lat = Object.fromEntries(KEYS.map(k => [k, newer(rr, cur[k])]));
      return { world: world({ spec, refSpec: ref, rawTags: lat }), truth: same(outcomeOf({ spec, cur, lat })), meta: {} };
    } },
  { id: 'bump-some', minDifficulty: 1, note: '1-3 of the 4 images have a newer tag, the rest are current',
    build(r) {
      const { cur, spec, ref } = base(r, { commentRate: 0.5 }), rr = r.fork('lat');
      const bump = subsetOf(rr, KEYS, 1, 3), lat = Object.fromEntries(KEYS.map(k => [k, bump.includes(k) ? newer(rr, cur[k]) : cur[k]]));
      return { world: world({ spec, refSpec: ref, rawTags: lat }), truth: same(outcomeOf({ spec, cur, lat })), meta: { bump } };
    } },
  { id: 'no-change', minDifficulty: 1, note: 'the repository is already on the reference tags (the reference has trailing spaces / CRLF)',
    build(r) {
      const { cur, spec, ref } = base(r, { commentRate: 0.5 });
      return { world: world({ spec, refSpec: ref, rawTags: cur }), truth: same(outcomeOf({ spec, cur, lat: cur })), meta: {} };
    } },
  { id: 'prerelease-reducible', minDifficulty: 2, note: 'reference tags carry -nightly/-beta/-dev markers around a stable X.Y.Z-DATE core',
    build(r) {
      const { cur, spec, ref } = base(r), rr = r.fork('lat');
      const marked = subsetOf(rr, KEYS, 1, 3), lat = {}, raw = {};
      const allSame = rr.chance(0.2);
      for (const k of KEYS) {
        lat[k] = allSame || rr.chance(0.35) ? cur[k] : newer(rr, cur[k]);
        raw[k] = marked.includes(k) ? rr.pick([`${lat[k]}-nightly`, `${lat[k]}-beta`, `${lat[k]}-dev`, `${lat[k]}-Nightly`, `${lat[k]}-BETA`, `dev-${lat[k]}`]) : lat[k];
      }
      return { world: world({ spec, refSpec: ref, rawTags: raw }), truth: same(outcomeOf({ spec, cur, lat })), meta: { marked, raw } };
    } },
  { id: 'open-pr-update', minDifficulty: 2, note: 'a bot pull request from the same branch is already open; a bump must update it, not open a second one',
    build(r) {
      const { cur, spec, ref } = base(r), rr = r.fork('lat');
      const bump = subsetOf(rr, KEYS, 1, 4), lat = Object.fromEntries(KEYS.map(k => [k, bump.includes(k) ? newer(rr, cur[k]) : cur[k]]));
      const stale = renderRepo({ ...spec, tags: Object.fromEntries(KEYS.map(k => [k, bump.includes(k) && rr.chance(0.5) ? newer(rr, cur[k]) : cur[k]])) });
      const pulls = openPulls(r.fork('pulls'), stale);
      return { world: world({ spec, refSpec: ref, rawTags: lat, pulls }), truth: same(outcomeOf({ spec, cur, lat, pull: pulls[0] })), meta: { bump } };
    } },
  { id: 'open-pr-no-change', minDifficulty: 2, note: 'a bot pull request is open and the repository is already current: nothing may happen to it',
    build(r) {
      const { cur, spec, ref } = base(r), pulls = openPulls(r.fork('pulls'), renderRepo({ ...spec, tags: cur }));
      return { world: world({ spec, refSpec: ref, rawTags: cur, pulls }), truth: same(outcomeOf({ spec, cur, lat: cur, pull: pulls[0] })), meta: {} };
    } },
  { id: 'repo-missing-image', minDifficulty: 3, note: 'the repository file has no service for one image (never added); the others are bumped or current',
    build(r) {
      const { cur, spec, ref } = base(r), rr = r.fork('lat');
      const missing = rr.pick(['chrome', 'edge', 'firefox']), bump = subsetOf(rr, KEYS.filter(k => k !== missing), rr.chance(0.25) ? 0 : 1, 3);
      const lat = Object.fromEntries(KEYS.map(k => [k, k === missing ? newer(rr, cur[k]) : bump.includes(k) ? newer(rr, cur[k]) : cur[k]]));
      const curSeen = { ...cur, [missing]: '' };
      return { world: world({ spec: { ...spec, omit: [missing] }, refSpec: ref, rawTags: lat }), truth: same(outcomeOf({ spec: { ...spec, omit: [missing] }, cur: curSeen, lat })), meta: { missing, bump } };
    } },
  { id: 'duplicate-lines', minDifficulty: 3, note: 'one image is used by two services in the repository (same tag) and listed twice in the reference (the first line is the current one)',
    build(r) {
      const { cur, spec, ref } = base(r), rr = r.fork('lat');
      const dup = rr.pick(['chrome', 'edge', 'firefox']), bump = [dup, ...subsetOf(rr, KEYS.filter(k => k !== dup), 0, 2)];
      const lat = Object.fromEntries(KEYS.map(k => [k, bump.includes(k) ? newer(rr, cur[k]) : cur[k]]));
      const s = { ...spec, dup };
      return { world: world({ spec: s, refSpec: { ...ref, dupOlder: { key: dup, tag: older(rr, cur[dup]) } }, rawTags: lat }), truth: same(outcomeOf({ spec: s, cur, lat })), meta: { dup, bump } };
    } },
  { id: 'prerelease-unreducible', minDifficulty: 3, note: 'a reference tag is a pre-release with no stable core (nightly, beta, 4.36.0-beta1, ...): the run must fail and change nothing',
    build(r) {
      const { cur, spec, ref } = base(r), rr = r.fork('lat');
      const bad = subsetOf(rr, KEYS, 1, 2), raw = {};
      for (const k of KEYS) raw[k] = bad.includes(k) ? rr.pick(['nightly', 'beta', 'dev', '4.36.0-nightly', '4.36.0-beta1', '4.36-dev-20250915']) : newer(rr, cur[k]);
      const t = failed();
      return { world: world({ spec, refSpec: ref, rawTags: raw }), truth: { original: t, intent: failed(mention(['pre-release', 'prerelease', 'nightly', 'beta', 'dev'])) }, meta: { bad, raw } };
    } },
  { id: 'reference-malformed', minDifficulty: 4, note: 'the fetch answers 404 / 5xx / an HTML page / nothing / another project\'s compose file: the run must fail, say why, change nothing',
    build(r) {
      const { cur, spec } = base(r), rr = r.fork('http');
      const variant = rr.pick(['not-found', 'html', 'empty', 'json', 'other-compose']);
      const http = {
        'not-found': { status: 404, body: '404: Not Found' },
        html: { status: 503, body: '<!DOCTYPE html>\n<html><head><title>Service unavailable</title></head><body>503 Service Unavailable</body></html>\n' },
        empty: { status: 200, body: '' },
        json: { status: 500, body: '{"message":"Internal Server Error"}\n' },
        'other-compose': { status: 200, body: 'services:\n  cache:\n    image: redis:7\n    ports:\n      - "6379:6379"\n' },
      }[variant];
      return { world: world({ spec, http }), truth: { original: failed(), intent: failed(mention(REFERENCE_TOKENS)) }, meta: { variant } };
    } },
  { id: 'reference-missing-image', minDifficulty: 4, note: 'the reference file lacks one of the four images: the run must fail, name the image and the reference, change nothing',
    build(r) {
      const { cur, spec, ref } = base(r), rr = r.fork('lat');
      const gone = rr.pick(KEYS), lat = Object.fromEntries(KEYS.map(k => [k, rr.chance(0.6) ? newer(rr, cur[k]) : cur[k]]));
      return { world: world({ spec, refSpec: { ...ref, omit: [gone] }, rawTags: lat }),
        truth: { original: failed(), intent: failed(mention(REFERENCE_TOKENS, [SHORT[gone], gone])) }, meta: { gone } };
    } },
  { id: 'reference-unreachable', minDifficulty: 4, note: 'the connection to the reference host is cut: the run must fail and say the reference could not be fetched',
    build(r) {
      const { spec } = base(r);
      return { world: world({ spec, http: { error: 'reset' } }), truth: { original: failed(), intent: failed(mention([...REFERENCE_TOKENS, 'connect', 'unreachable', 'network'])) }, meta: {} };
    } },
  { id: 'commented-image-line', minDifficulty: 5, note: 'DEFECT: a commented-out older image line precedes the real one in the reference; grep takes the comment and the original downgrades',
    build(r) {
      const { cur, spec, ref } = base(r), rr = r.fork('lat');
      const commented = subsetOf(rr, KEYS, 1, 2), lat = Object.fromEntries(KEYS.map(k => [k, newer(rr, cur[k])]));
      const old = Object.fromEntries(commented.map(k => [k, `4.${rr.int(0, 9)}.0-2021${pad(rr.int(1, 12))}${pad(rr.int(1, 28))}`]));
      const seenByOriginal = { ...lat, ...old };
      const refSpec = { ...ref, comments: old };
      return { world: world({ spec, refSpec, rawTags: lat }),
        truth: { original: outcomeOf({ spec, cur, lat: seenByOriginal }), intent: outcomeOf({ spec, cur, lat }) }, meta: { commented, old } };
    } },
  { id: 'quoted-image-refs', minDifficulty: 5, note: 'DEFECT: the repository file quotes some image references; grep cannot see them (current tag ""), and the original pastes the new tag in front of the old one',
    build(r) {
      const { cur, spec, ref } = base(r), rr = r.fork('lat');
      const q = rr.pick(['"', "'"]), quoted = subsetOf(rr, KEYS, 1, 4), noop = rr.chance(0.3);
      const lat = Object.fromEntries(KEYS.map(k => [k, noop || !rr.chance(0.7) ? cur[k] : newer(rr, cur[k])]));
      if (!noop && KEYS.every(k => lat[k] === cur[k])) lat.hub = newer(rr, cur.hub);
      const s = { ...spec, quote: Object.fromEntries(quoted.map(k => [k, q])) };
      // What the original does: a quoted image line does not match `image: selenium/IMG:`, so CURRENT is "" and NEW differs from it. The
      // sed pattern is then just `selenium/IMG:` and NEW lands in front of the old tag (valid YAML, wrong image).
      const seen = Object.fromEntries(KEYS.map(k => [k, quoted.includes(k) ? '' : cur[k]]));
      const mangled = { ...cur }, changedOriginal = [];
      for (const k of KEYS) {
        if (quoted.includes(k)) { mangled[k] = lat[k] + cur[k]; changedOriginal.push({ key: k, from: '', to: lat[k] }); }
        else if (lat[k] !== cur[k]) { mangled[k] = lat[k]; changedOriginal.push({ key: k, from: cur[k], to: lat[k] }); }
      }
      const original = { status: 'updated', versions: { current: seen, latest: { ...lat } }, changed: changedOriginal, composeAfter: renderRepo({ ...s, tags: mangled }), prAction: 'created', prNumber: null, message: null };
      return { world: world({ spec: s, refSpec: ref, rawTags: lat }), truth: { original, intent: outcomeOf({ spec: s, cur, lat }) }, meta: { q, quoted, noop } };
    } },
]);
export const KIND_IDS = Object.freeze(KINDS.map(k => k.id));
export const DEFECT_KINDS = Object.freeze(['reference-malformed', 'reference-missing-image', 'reference-unreachable', 'commented-image-line', 'quoted-image-refs']);

export const poolFor = difficulty => KINDS.filter(k => k.minDifficulty <= difficulty);

/** The instance for (seed, split, difficulty): round-robin over the kinds available at that difficulty, content drawn from the seed. */
export function instanceFor({ seed, split = 'dev', difficulty = 3 }) {
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`seed must be a non-negative integer, got ${seed}`);
  const pool = poolFor(difficulty);
  if (!pool.length) throw new Error(`no scenario kinds at difficulty ${difficulty}`);
  return buildKind(pool[seed % pool.length].id, rng('rbench-selenium', VERSION, split, difficulty, seed), { seed, split, difficulty });
}
export function buildKind(kindId, r, id = {}) {
  const kind = KINDS.find(k => k.id === kindId);
  if (!kind) throw new Error(`unknown scenario kind ${kindId}`);
  const inst = kind.build(r);
  return { kind: kind.id, ...id, ...inst, world: { ...inst.world, trigger: r.fork('trigger').chance(0.8) ? 'schedule' : 'workflow_dispatch' } };
}
// The canonical authored suite: one instance of every kind (seeds 0..13 at difficulty 5, split dev), frozen under fixtures/scenarios/.
export const CANONICAL = Object.freeze({ split: 'dev', difficulty: 5, seeds: Object.freeze(KINDS.map((_, i) => i)) });
export const canonicalInstances = () => CANONICAL.seeds.map(seed => instanceFor({ seed, split: CANONICAL.split, difficulty: CANONICAL.difficulty }));
