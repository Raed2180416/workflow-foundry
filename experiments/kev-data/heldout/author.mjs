// heldout-author group driver (JUDGE-PROGRAM.md §2.4; JUDGE-BUILD-PLAN.json "heldout-author").
//   node experiments/kev-data/heldout/author.mjs check   [--authored DIR]     lint and quota report, writes nothing
//   node experiments/kev-data/heldout/author.mjs build   [--authored DIR] [--out DIR]
//   node experiments/kev-data/heldout/author.mjs manifest [--out DIR]          rewrite the committed sha256 manifest
// Reads the authored sources (git-ignored, .foundry/kev-data/heldout/authored/) and writes, under
// .foundry/kev-data/heldout/ only: wordings.jsonl (what build.mjs loadHeldout reads), wordings.json,
// surface/<port>.jsonl, cities.json, registry.json, reject-log.jsonl. The only committed output is
// experiments/kev-data/heldout-manifest.json: sha256 and sizes of those files, counts and statuses, never
// text. No model is called here: the two-model filter is run by the hosted-arms group through
// filter.mjs; until then every selected line is `pending-filter`, none is `admitted`.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { REPO_ROOT, KEV_DATA, loadSpec } from '../lib/contracts.mjs';
import { canonical } from '../lib/hash.mjs';
import { assemble, HELDOUT_SURFACE_PORTS } from './assemble.mjs';
import { QUOTA, SLICE_CUTS, OOD_SLICES, NAMED_REGISTERS } from './pools.mjs';
import { FILTER_MODEL_IDS } from './filter.mjs';
import { WORDING_COUNTS } from './wordings.mjs';

export const HELDOUT_DIR = path.join(REPO_ROOT, '.foundry', 'kev-data', 'heldout');
export const AUTHORED_DIR = path.join(HELDOUT_DIR, 'authored');
export const MANIFEST_PATH = path.join(KEV_DATA, 'heldout-manifest.json');
export const MANIFEST_SCHEMA = 'kev-data/heldout-manifest@1';

const sha = buf => createHash('sha256').update(buf).digest('hex');
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
const put = (file, body) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, body); };

// ---- outputs -----------------------------------------------------------------------------------------------
export function serializeUnit(u) {
  const o = { id: u.id, port: u.port, role: u.role, label: u.label ?? null, slice: u.slice, status: u.status, text: u.text };
  for (const k of ['labels', 'assumption', 'pairId', 'kind', 'value', 'assumptionValue', 'ns', 'about', 'target', 'sourceKind', 'type_label', 'venue', 'title', 'items']) if (u[k] !== undefined && u[k] !== null) o[k] = u[k];
  Object.assign(o, { register: u.register, systems: u.systems, tags: u.tagMap, hard: u.hard, features: u.features, skeleton: u.skeleton, source: u.source, filter: u.filter ?? null });
  return o;
}
export function writeOutputs(model, outDir = HELDOUT_DIR) {
  const files = [];
  const wr = (rel, body) => { put(path.join(outDir, rel), body); files.push(rel); };
  wr('wordings.jsonl', jsonl(model.wordings.map(({ port, id, slice, text, register }) => ({ port, id, slice, text, register }))));
  const byPort = {};
  for (const w of model.wordings) ((byPort[w.port] ??= {})[w.slice] ??= []).push({ id: w.id, text: w.text, register: w.register });
  wr('wordings.json', JSON.stringify({ version: 1, counts: WORDING_COUNTS, ports: byPort }, null, 1) + '\n');
  for (const port of HELDOUT_SURFACE_PORTS) wr(`surface/${port}.jsonl`, jsonl(model.surface[port].map(serializeUnit)));
  wr('cities.json', JSON.stringify({ version: 1, cities: model.cities }, null, 1) + '\n');
  wr('registry.json', JSON.stringify(model.registry.toJSON()) + '\n');
  const rejectLog = path.join(outDir, 'reject-log.jsonl');
  if (!existsSync(rejectLog)) wr('reject-log.jsonl', '');
  return files;
}

export function statusCounts(surface) {
  const c = { admitted: 0, 'pending-filter': 0, reserve: 0, rejected: 0, carrier: 0 };
  for (const units of Object.values(surface)) for (const u of units) c[u.status] = (c[u.status] ?? 0) + 1;
  return c;
}
function describeFiles(outDir) {
  const out = {};
  const walk = (dir, rel = '') => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (r !== 'authored') walk(path.join(dir, e.name), r); }
      else if (e.isFile() && r !== 'manifest.json') { const buf = readFileSync(path.join(dir, e.name)); out[r] = { sha256: sha(buf), bytes: buf.length, lines: buf.toString('utf8').split('\n').filter(Boolean).length }; }
    }
  };
  walk(outDir);
  return out;
}
const readJson = f => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);

export function buildManifest(model, outDir = HELDOUT_DIR, { spec = loadSpec() } = {}) {
  const wordings = {};
  for (const [port] of Object.entries(spec.contracts).filter(([p]) => model.wordings.some(w => w.port === p))) {
    const ws = model.wordings.filter(w => w.port === port);
    wordings[port] = { ...Object.fromEntries(OOD_SLICES.map(s => [s, ws.filter(w => w.slice === s).length])), otherRegister: ws.filter(w => w.register !== 'standard').length, total: ws.length };
  }
  const authoredHash = (() => {
    const ad = path.join(outDir, 'authored'); if (!existsSync(ad)) return null;
    const rows = []; const walk = (d, rel = '') => { for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.isFile()) rows.push([r, sha(readFileSync(path.join(d, e.name)))]); } };
    walk(ad); return { files: rows.length, sha256: sha(canonical(rows)) };
  })();
  const copy = readJson(path.join(outDir, 'copy-filter.json')), topup = readJson(path.join(outDir, 'topup-log.json'));
  const reg = model.registry;
  return {
    schema: MANIFEST_SCHEMA, group: 'heldout-author', specHash: spec.hash, programRevision: 2,
    note: 'sha256 manifest only: the held-out wordings, lines, cities and registry live in .foundry/kev-data/heldout/ (git-ignored) and are never committed (JUDGE-PROGRAM.md §2.4, AGENTS.md).',
    quotas: QUOTA, sliceRule: { by: 'skeletonPercent(skeleton(line)) of lib/hash.mjs', cuts: SLICE_CUTS, note: 'authored lines are never train lines, so the whole hash space is shared 5:3:2; lib/hash.mjs skeletonBucket reserves 60% for bed-rendered train states' },
    authored: authoredHash,
    files: describeFiles(outDir),
    wordings: { perPort: wordings, digest: sha(canonical(model.wordings.map(({ port, id, slice, text }) => ({ port, id, slice, text })).sort((a, b) => (`${a.port}/${a.slice}/${a.id}` < `${b.port}/${b.slice}/${b.id}` ? -1 : 1)))) },
    pools: model.stats,
    surfaceUnits: Object.fromEntries(HELDOUT_SURFACE_PORTS.map(p => [p, model.surface[p].length])),
    status: statusCounts(model.surface),
    cities: { n: model.cities.length, mdy: model.cities.filter(c => c.order === 'mdy').length, dmy: model.cities.filter(c => c.order === 'dmy').length },
    registry: { entries: reg.size, digest: reg.digest, masks: reg.masks },
    twoModelFilter: { models: FILTER_MODEL_IDS, run: Object.values(model.surface).flat().some(u => u.filter), admitted: statusCounts(model.surface).admitted,
      state: statusCounts(model.surface).admitted ? 'partially-run' : 'not-run: deferred to the hosted-arms group (filter.mjs is the harness); every selected line is pending-filter',
      rejectLog: 'reject-log.jsonl' },
    copyFilter: copy ? { threshold: copy.threshold, bedCorpus: copy.bedCorpus, trainPools: copy.trainPools, checked: copy.checked, maxJaccard: copy.maxJaccard, failing: copy.failing?.length ?? 0, sha256: sha(canonical(copy)) } : { state: 'not run' },
    topUp: topup ? { rounds: topup.rounds } : { rounds: [] },
    namedRegisters: NAMED_REGISTERS,
    isolation: 'Written from spec/ports.json and JUDGE-PROGRAM.md only. No file under beds/, no frozen copy and no training pool was read by the author; copy-filter.mjs reads them and reports ids and counts.',
  };
}
export function writeManifest(manifest, file = MANIFEST_PATH) { put(file, JSON.stringify(manifest, null, 1) + '\n'); return file; }

// ---- CLI -------------------------------------------------------------------------------------------------------
function report(model) {
  const rows = [];
  for (const [port, labels] of Object.entries(model.stats)) for (const [label, slices] of Object.entries(labels)) {
    rows.push({ pool: `${port}/${label}`, ...Object.fromEntries(OOD_SLICES.map(s => [s, `${slices[s]?.selected ?? 0}/${slices[s]?.authored ?? 0}`])), authored: OOD_SLICES.reduce((n, s) => n + (slices[s]?.authored ?? 0), 0) });
  }
  console.table(rows);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), opt = Object.fromEntries(rest.map((a, i) => (a.startsWith('--') ? [a.slice(2), rest[i + 1]] : null)).filter(Boolean));
  const authored = path.resolve(opt.authored ?? AUTHORED_DIR), out = path.resolve(opt.out ?? HELDOUT_DIR);
  if (cmd === 'check' || cmd === 'build') {
    let model;
    try { model = assemble(authored, { lenient: cmd === 'check' }); } catch (e) { console.error(e.message); process.exit(1); }
    if (cmd === 'check') { report(model); console.log(`${model.errors.length} problem(s)`); for (const m of model.errors.slice(0, 80)) console.log('  ' + m); process.exit(model.errors.length ? 1 : 0); }
    const files = writeOutputs(model, out);
    const manifest = buildManifest(model, out);
    writeManifest(manifest); put(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
    console.log(`wrote ${files.length} files under ${path.relative(REPO_ROOT, out)} and ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
    console.log(JSON.stringify({ status: manifest.status, wordings: Object.keys(manifest.wordings.perPort).length, registry: manifest.registry.entries }, null, 1));
  } else if (cmd === 'manifest') {
    const model = assemble(authored, { lenient: true });
    const manifest = buildManifest(model, out); writeManifest(manifest); console.log(`wrote ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
  } else { console.error('usage: author.mjs check|build|manifest [--authored DIR] [--out DIR]'); process.exit(2); }
}
