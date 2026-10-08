// Constants of the job "keep SHAFT's Selenium Grid compose file on the latest stable Selenium images".
// Everything the solver may be told and the oracle checks against. The workflow definition (MIT) is vendored verbatim in
// fixtures/original/; the compose files used by the scenarios are authored here, synthetic, never copied from SHAFT or Selenium.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const here = rel => new URL(rel, import.meta.url);
export const readText = rel => readFileSync(here(rel), 'utf8');
export const sha256 = data => createHash('sha256').update(data).digest('hex');

export const ITEM = Object.freeze({
  id: 'github-actions:shafthq/shaft_engine/.github/workflows/update-selenium-grid-versions.yml',
  safeId: 'github-actions-shafthq-update-selenium-grid-versions',
  title: 'Update Selenium Grid Docker Versions',
  revision: '3b2eae51248d2cf58146a64c48265259ee077a0a',
  rawSha256: 'dff6b15a22a2e6350a68805e1779eb7b3d6a0a42143cc2df8614c3aef50facef',
  corpusRawPath: '/opt/corpus/github-actions/raw/shafthq__shaft_engine@3b2eae51248d2cf58146a64c48265259ee077a0a/.github/workflows/update-selenium-grid-versions.yml',
  vendoredPath: 'fixtures/original/update-selenium-grid-versions.yml',
});

export const REFERENCE_URL = 'https://raw.githubusercontent.com/SeleniumHQ/docker-selenium/trunk/docker-compose-v3.yml';
export const REFERENCE_HOST = 'raw.githubusercontent.com';
export const REFERENCE_PATH = '/SeleniumHQ/docker-selenium/trunk/docker-compose-v3.yml';
export const COMPOSE_PATH = 'src/main/resources/docker-compose/selenium4.yml';

// The four tracked images, in the order the original reports them (Chrome, Edge, Firefox, Hub).
export const TRACKED = Object.freeze([
  Object.freeze({ key: 'chrome', label: 'Chrome', image: 'selenium/node-chrome' }),
  Object.freeze({ key: 'edge', label: 'Edge', image: 'selenium/node-edge' }),
  Object.freeze({ key: 'firefox', label: 'Firefox', image: 'selenium/node-firefox' }),
  Object.freeze({ key: 'hub', label: 'Hub', image: 'selenium/hub' }),
]);
export const KEYS = Object.freeze(TRACKED.map(t => t.key));

export const PR = Object.freeze({
  branch: 'auto-update-selenium-grid-versions',
  base: 'main',
  title: 'Update Selenium Grid Docker images to latest stable versions',
  labels: Object.freeze(['dependencies', 'automated']),
  commitSubject: 'Update Selenium Grid Docker images to latest stable versions',
});

// What the original does with a pre-release tag: grep -qiE 'nightly|beta|dev' decides, grep -oE '[0-9]+\.[0-9]+\.[0-9]+-[0-9]+' reduces.
export const PRERELEASE_RE = /nightly|beta|dev/i;
export const STABLE_CORE_RE = /[0-9]+\.[0-9]+\.[0-9]+-[0-9]+/g;

export const VARIANTS = Object.freeze(['T1', 'T2', 'T3']);
// T1 is judged on how the original behaves (including on odd input), T2 and T3 on the maintainers' intent (README section 3).
export const MODE_OF = Object.freeze({ T1: 'original', T2: 'intent', T3: 'intent' });

// T3 target: no model call per run, and the solver's own wall time no longer than the original's median (fixtures/baseline.json). Frozen with the fixtures.
// The host's fetch and pull-request calls are the same for every plan, so they are not part of the target.
export const T3_TARGET_RULE = Object.freeze({ modelUsdMax: 0, latencyMsMax: 1.0 });

export const STATUSES = Object.freeze(['updated', 'unchanged', 'failed']);
