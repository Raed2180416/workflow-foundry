// Wave-A dataset build driver (development evidence). One buildKev per group, every evaluation and training slice,
// sequentially; large outputs under /var/tmp/foundry-work/kev/builds (never in git), a summary per group next to them.
//   node experiments/kev-data/out/assembly/build-wave-a.mjs <group> [--slices a,b] [--seeds slice=n,...] [--no-measure]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKev, loadHeldout } from '../../build.mjs';
import { REPO_ROOT } from '../../lib/contracts.mjs';
import { sha256 } from '../../lib/hash.mjs';
import { STATE, heldoutDigests, poolDigests } from './assembly.mjs';
import { FROZEN_SRC_COMMIT } from '../../exec/frozen-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = process.env.KEV_WAVE_A_OUT ?? '/var/tmp/foundry-work/kev/builds';
const HELDOUT = path.join(REPO_ROOT, '.foundry', 'kev-data', 'heldout');
const POOLS = path.join(REPO_ROOT, '.foundry', 'kev-data', 'pools', 'train');
const ALL_SLICES = ['train', 'calib-in', 'calib-ood', 'dev-select', 'dev-ood', 'test-in', 'test-ood'];
const INNER_FILE = { 'records-notes': 'records-notes', kinetics: 'kinetics', runbook: 'runbook', interactive: 'interactive', 'failures-code': 'failures-code', 'construction-crossfamily': 'construction-crossfamily' };
// static inner opts (data, no held-out text)
const INNER_OPTS = {
  'records-notes': {},
  kinetics: {},
  runbook: {},
  interactive: {},
  'failures-code': { frozenSrc: { commit: FROZEN_SRC_COMMIT }, f1: { cacheDir: path.join(REPO_ROOT, '.foundry', 'kev-data', 'exec-cache'), concurrency: 2 } },
  'construction-crossfamily': {},
};

const args = process.argv.slice(2), group = args[0];
if (!INNER_FILE[group]) { console.error(`usage: build-wave-a.mjs <${Object.keys(INNER_FILE).join('|')}> [--slices a,b] [--seeds slice=n,...] [--no-measure]`); process.exit(2); }
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const slices = opt('--slices') ? opt('--slices').split(',') : ALL_SLICES;
const seeds = {};
if (opt('--seeds')) for (const kv of opt('--seeds').split(',')) { const [s, n] = kv.split('='); seeds[s] = { count: Number(n) }; }
const { wordings, registry } = loadHeldout(HELDOUT);
const registryBase = { n: registry.size, digest: registry.digest };
STATE.registry = registry; STATE.report = {};
const innerFile = path.resolve(HERE, '..', '..', 'ports', `${INNER_FILE[group]}.mjs`);
const opts = { assembly: 'wave-a-dev@1', inner: INNER_OPTS[group], innerSource: `sha256:${sha256(readFileSync(innerFile))}`, assemblySource: `sha256:${sha256(readFileSync(path.join(HERE, 'assembly.mjs')))}`,
  heldout: heldoutDigests(HELDOUT), poolDigests: poolDigests(POOLS), statuses: ['admitted', 'pending-filter', 'carrier'] };
const t0 = Date.now();
mkdirSync(OUT_ROOT, { recursive: true });
let result, error = null;
try {
  result = await buildKev({ root: REPO_ROOT, outRoot: OUT_ROOT, generators: [path.join(HERE, `gen-${group}.mjs`)], slices, seeds, opts, wordings, registry,
    heldoutDir: HELDOUT, poolsDir: POOLS, log: m => console.error(m), ...(args.includes('--no-measure') ? { measure: null } : {}) });
} catch (e) { error = { code: e.code ?? null, message: e.message, details: Array.isArray(e.details) ? e.details.slice(0, 20) : e.details ?? null }; }
const summary = {
  group, slices, seeds, ms: Date.now() - t0, error,
  buildId: result?.buildId ?? null, dir: result?.dir ?? null,
  registry: { base: registryBase, final: { n: registry.size, digest: registry.digest } },
  assembly: STATE.report, recordsLineCounts: STATE.recordsLineCounts ?? null,
  slicesOut: result ? Object.fromEntries(Object.entries(result.manifest.slices).map(([s, x]) => [s, { records: x.records, questions: x.questions, worlds: x.worlds, dropped: x.dropped, perPort: x.perPort, positionCheck: x.positionCheck, unknowable: x.unknowable, files: x.files }])) : null,
  jobMaxState: result?.manifest.jobMaxState ?? null, timing: result?.timing ?? null,
};
const sumDir = path.join(OUT_ROOT, '..', 'summaries');
mkdirSync(sumDir, { recursive: true });
writeFileSync(path.join(sumDir, `${group}.json`), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(path.join(sumDir, `${group}.registry.json`), JSON.stringify(registry.toJSON()) + '\n');
console.log(JSON.stringify({ group, buildId: summary.buildId, error, ms: summary.ms, slices: summary.slicesOut && Object.fromEntries(Object.entries(summary.slicesOut).map(([s, x]) => [s, x.records])) }, null, 1));
process.exitCode = error ? 1 : 0;
