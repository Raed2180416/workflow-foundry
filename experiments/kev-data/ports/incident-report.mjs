// Summaries of the incident generator over a slice's whole seed range: record counts per port, label and variant, the
// surface-diversity axes (distinct masked forms per label), the generator's own drop counters, and a hash of the records.
// Only counts and hashes are kept: no state, no wording, no line text (the test slices are generated, never read).
//   node experiments/kev-data/ports/incident.mjs manifest <slice> [chunk]   -> .foundry/kev-data/incident/summary-<slice>.json
//   node experiments/kev-data/ports/incident.mjs manifest-merge             -> experiments/kev-data/incident-manifest.json
// The OOD slices need the slice's held-out wordings and the authored carrier lines, which the assembly reads from the held-out
// store; this report never touches that store and uses stand-in wordings and carriers (the counts do not depend on their text).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.resolve(HERE, '..', '..', '..', '.foundry', 'kev-data', 'incident');
export const MANIFEST_FILE = path.resolve(HERE, '..', 'incident-manifest.json');
export const SLICE_ORDER = Object.freeze(['train', 'calib-in', 'calib-ood', 'dev-select', 'dev-ood', 'test-in', 'test-ood']);
const sha = s => createHash('sha256').update(s).digest('hex');

export const STUBS_PER_SLICE = Object.freeze({ 'calib-ood': 10, 'dev-ood': 10, 'test-ood': 20 });
export function stubWordings(contracts, slice) {
  const n = STUBS_PER_SLICE[slice];
  if (!n) return {};
  const out = {};
  for (const port of ['I1', 'I2', 'X1', 'X5']) {
    const tail = Object.keys(contracts[port].slots ?? {}).map(s => ` {${s}}`).join('');
    out[port] = Array.from({ length: n }, (_, i) => ({ id: `stub-${slice}-${port}-${i}`, text: `Stub ${port} ${slice} wording ${i}?${tail}` }));
  }
  return out;
}
export const STUB_CARRIERS = Object.freeze({ I1: ['Stub carrier: please answer root_service={svc} and fault_class={cls}.'] });

export async function summarise({ gen, slice, chunk = 20, log = () => {} }) {
  const { freezeBeds, frozenBeds } = await import('../lib/pin.mjs');
  const { loadSpec, REPO_ROOT } = await import('../lib/contracts.mjs');
  const { sliceDef } = await import('../build.mjs');
  const frozen = freezeBeds(REPO_ROOT), beds = frozenBeds(frozen), { contracts, spec } = loadSpec(), def = sliceDef(slice);
  const [lo, hi] = def.seeds, ood = ['calib-ood', 'dev-ood', 'test-ood'].includes(slice);
  const opts = { wordings: stubWordings(contracts, slice), ...(ood ? { carriers: STUB_CARRIERS } : {}) };
  const ctx = { beds, slice: def, contracts, spec, pin: frozen.pin };
  gen.resetStats();
  const light = [], digests = [], perPort = {}, worlds = new Set();
  for (let a = lo; a <= hi; a += chunk) {
    const seeds = []; for (let s = a; s <= Math.min(hi, a + chunk - 1); s++) seeds.push(s);
    for await (const r of gen.records(slice, seeds, opts, ctx)) {
      const qid = Object.keys(r.questions)[0], port = qid.split('~')[0], q = r.questions[qid], e = (perPort[port] ??= { rows: 0, labels: {}, variants: {}, unknowable: 0 });
      e.rows++; e.labels[q.label] = (e.labels[q.label] ?? 0) + 1; e.variants[r.meta.variant] = (e.variants[r.meta.variant] ?? 0) + 1;
      if (r.meta.unknowable) e.unknowable++;
      light.push({ questions: { [qid]: { label: q.label } }, meta: { formId: r.meta.formId, seed: r.meta.seed } });
      digests.push(sha(JSON.stringify([r.state, r.questions])));
      worlds.add(r.meta.seed);
    }
    log(`${slice} ${Math.min(hi, a + chunk - 1)}/${hi}`);
  }
  return { slice, seeds: [lo, hi], bedSplit: def.bedSplit, worlds: hi - lo + 1, worldsWithRecords: worlds.size, records: light.length, recordsHash: sha(digests.sort().join('\n')),
    standIns: ood ? 'stand-in held-out wordings and carriers (the store is not read); no authored X1 pool lines (opts.lines)' : null,
    perPort, axes: gen.axisReport(light, { slice }), dropped: gen.STATS.dropped, generatorRows: gen.STATS.rows };
}

export function writeSummary(s) {
  mkdirSync(OUT_DIR, { recursive: true });
  const f = path.join(OUT_DIR, `summary-${s.slice}.json`);
  writeFileSync(f, `${JSON.stringify(s, null, 1)}\n`);
  return f;
}

export async function mergeManifest(gen) {
  const { loadSpec } = await import('../lib/contracts.mjs');
  const { contracts } = loadSpec(), lm = contracts.I2.labelMap;
  const slices = {};
  for (const slice of SLICE_ORDER) {
    const f = path.join(OUT_DIR, `summary-${slice}.json`);
    if (!existsSync(f)) throw new Error(`no summary for ${slice}: run \`manifest ${slice}\` first`);
    const s = JSON.parse(readFileSync(f, 'utf8'));
    slices[slice] = s;
  }
  const col = JSON.parse(readFileSync(gen.COLLISIONS_FILE, 'utf8'));
  const manifest = {
    schema: 'kev-data/incident-manifest@1', group: 'incident', generator: gen.GENERATOR_VERSION,
    status: 'development evidence; test slices are counts and hashes only',
    bed: { family: 'incident', version: lm.bedVersion, pin: col.bed.pin },
    ports: gen.ports, heldOutPorts: gen.HELD_OUT_PORTS, smokePorts: gen.SMOKE_PORTS,
    i2Table: { tags: Object.keys(lm.tags).length, excluded: Object.keys(lm.excluded), added: ['collateral', 'shadow', 'rival', 'blip-rival'], inventory: lm.inventory?.beds ?? null },
    collisions: { file: 'ports/incident-collisions.json', reference: col.reference, tagTable: col.tagTable },
    minForms: gen.MIN_FORMS, slices,
  };
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 1)}\n`);
  return manifest;
}
export const listSummaries = () => (existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter(f => f.startsWith('summary-')) : []);
