#!/usr/bin/env node
// Report of the synth group (JUDGE-BUILD-PLAN.json group "synth"): the synth-values tap status with its contingency, the bed-natural
// mode rates, and (with --full) the record counts and surface-diversity numbers of every slice at the plan's seed ranges.
//
//   node experiments/kev-data/synth-report.mjs --manifest         tap + natural rates -> experiments/kev-data/synth-manifest.json
//   node --max-old-space-size=8192 experiments/kev-data/synth-report.mjs --part
//                                                                 partial-input baselines of S2 over the full train supply (even seeds fit, odd seeds eval)
//   node --max-old-space-size=8192 experiments/kev-data/synth-report.mjs --full [--slices train,dev-select] [--out <dir>]
//                                                                 full-range generation -> <out>/synth-supply.json (default
//                                                                 .foundry/kev-data/synth/) and the compact `supply` of the manifest
//
// Counts and hashes only for the test slices: this script never prints a record of test-in or test-ood. It reads no held-out store:
// the held-out wordings and carriers of the OOD slices are stand-ins (the assembly supplies the real ones through opts), so the OOD
// adversarial axis and the paraphrase axis here are counted on stubs. Development evidence: the 8 acceptance tests are in
// test/synth.test.mjs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeBeds, frozenBeds } from './lib/pin.mjs';
import { loadSpec } from './lib/contracts.mjs';
import { sliceDef, SLICE_IDS } from './build.mjs';
import { counts } from './lib/balance.mjs';
import * as gen from './ports/synth.mjs';
import { alignClaims, tapStatus, TAP_THRESHOLD, TAP_VERSION } from './taps/synth-values.mjs';
import { NATURAL_RATES, S2_LABELS } from './ports/synth-s2.mjs';
import { KIT_VERSION, sentenceSpans } from './judges/synth.mjs';
import { trainProbe, evaluate } from './lib/probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const MANIFEST = path.join(HERE, 'synth-manifest.json');
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const sha = s => createHash('sha256').update(s).digest('hex');

// ---- stand-ins for the held-out material (never the real store) --------------------------------------------------------------------
const NSLICE = { 'calib-ood': 10, 'dev-ood': 10, 'test-ood': 20 };
function stubs(contracts, slice) {
  const wordings = {}, n = NSLICE[slice] ?? 0;
  for (const port of ['S2', 'X5', 'X1', 'X8']) {
    const tail = Object.keys(contracts[port].slots ?? {}).map(s => ` {${s}}`).join('');
    wordings[port] = Array.from({ length: n }, (_, i) => ({ id: `stub-${slice}-${i}`, text: `Stub ${port} ${slice} wording ${i}?${tail}`, slice }));
  }
  const lines = !n ? [] : S2_LABELS.flatMap(label => [0, 1, 2].map(i => ({ port: 'S2', role: 'carrier', label: null, target: label, slice, text: `Stub carrier ${slice} ${i} for the classifier: answer ${label.replace('_', ' ')}.` })));
  return { wordings, lines };
}

async function setup() {
  const outRoot = mkdtempSync(path.join(process.env.KEV_DATA_SCRATCH ?? os.tmpdir(), 'kev-synth-report-'));
  process.once('exit', () => rmSync(outRoot, { recursive: true, force: true }));
  const frozen = freezeBeds(REPO, { outRoot });
  return { frozen, beds: frozenBeds(frozen), spec: loadSpec() };
}

// ---- the natural rates of the bed: all aligned claims of requested properties, d3-d5, on worlds the tap run does not use ------------------
async function naturalRates({ beds }, { worlds = 90, first = 701 } = {}) {
  const S = await beds.import('beds/synth/index.mjs'), pop = {};
  let total = 0;
  for (let seed = first; seed < first + worlds; seed++) for (const d of [3, 4, 5]) {
    const task = S.generate({ seed, split: 'dev', difficulty: d }), { world } = S.hidden({ seed, split: 'dev', difficulty: d });
    for (const c of alignClaims({ task, world }).claims) if (c.status === 'aligned' && c.requested && c.label) { pop[c.label] = (pop[c.label] ?? 0) + 1; total++; }
  }
  return { worlds: worlds * 3, first, claims: total, rates: Object.fromEntries(S2_LABELS.map(l => [l, Number(((pop[l] ?? 0) / total).toFixed(5))])) };
}

const SPEC_GAPS = [
  'S2 option "bound": the bed has a fifth claim mode (a bound) that the contract has no option for; a bound claim is left out of S2 with a count (s2:excluded:bound), never mapped. mapLabel refuses it.',
  'The tap\'s "exactly one passage": a claim is aligned when exactly one occurrence of any written form of its value (plain, grouped, scientific, +/- , (n), unit words, h min, replicate lists, range means, pipe/csv table rows, bare numbers of "Half-life values (days)" sentences) lies in its document, no other claim reads that span, and the value round-trips through the port kit. The 95% gate is on all claims AND on the S2 population (requested, labelled).',
  'Passage = the value\'s sentence plus its neighbours (sentence-level, kit judges/synth.mjs sentenceSpans); not at "et al.", initials after "by", inside [brackets] (the injection banner is one sentence), line breaks end sentences.',
  'Bed natural mode rates are measured on this bed pin (synth 3.0.0): 85.0 / 13.0 / 1.4 / 0.5 % (own / quoted / projected / instruction_like). The program\'s 90.1 / 7.7 / 1.6 / 0.5 % are for synth 2.0.0; the pinned rates here are the ones used for natural sets and importance weights.',
  'Strict bucket rule: every sentence of an S2/S4/X1-window/X4 state must be of the slice\'s own skeleton bucket (train 40-100%; the label-bearing sentence of an OOD slice of that slice\'s bucket); relaxed rule for whole documents (X1 long, X7): no sentence of the test-ood bucket, where the held-out family takes its spans.',
  'Train 3:1 (rule 9) under a thin class: S2 train rows are capped at 3x the rarest label present after the draws (instruction_like exists only at d5 and only where a 3-sentence passage is of the train bucket); the surplus of the larger labels is dropped from the plain axis and counted (report.cap).',
  'instruction_like only at d5 and projected from d4 (the bed plants them there); the class support table is label x difficulty with forms (distinct masked sentences) and cells under 30 forms marked diagnostic.',
  'X8 synth: unit rows (a converted value, an unconverted one, a wrong-factor one, a decimal slip) and erratum lines (the corrected value vs the printed one); a held-out family appears in test-ood only; its spans are registered; wordings slots collide (X8 state slot "located" is the source value, "value" the extracted value and the wording slot).',
  'Contingency (tap < 95%): S2 is a wave-2 smoke set in train and dev-select only; S3 is produced at S2\'s wave-1 size in every slice S2 was in, marked meta.wave on the rows.',
  'Wave-2 smoke sets (S1, S3, S4, X2, X4, X7) are 300 train and 100 dev-select rows; S5 is the wave-3 document-kind set; S5 in test-ood is only the unseen type names supplied through opts.unseenNames.',
  'Unknowable S2 rows (presence-matched twins) carry a soft uniform target and are not reproducible by the kit (reproducible: false).',
  'X5 axes not built: the adversarial, long and slot axes of the program\'s X5 table (the policy and condition axes with flip pairs and one not_stated per group, presence-matched, are).',
  'Partial-input ceilings (PART, 2.7 step 7): measured over the whole S2 train supply (`partialInput`), the metadata-only, value-only, length-only and context-only baselines all exceed majority + 3 pp; the cause is the bed\'s structure (press-release documents hold only measured claims; instruction_like sits only in preprints, memos and lab notes at d5; projected only from d4; quoted and projected sentences are longer). Rebalancing within strata would restrict every class to the rarest class\'s strata (d5 lab-type documents), so it is left to the assembly; S2 is reported OPEN, not frozen, on this axis.',
  'Held-out wordings, carriers and unseen names reach the generator only through opts (stub fixtures here and in the tests); the OOD adversarial and paraphrase axes are therefore counted on stubs.',
];

const canon = o => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

async function manifest(env) {
  const tap = await tapStatus({ beds: env.beds });
  const natural = await naturalRates(env);
  const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const S = await env.beds.import('beds/synth/index.mjs');
  const out = {
    group: 'synth', generator: gen.GENERATOR_VERSION, kit: KIT_VERSION, tapVersion: TAP_VERSION,
    bed: { id: 'synth', version: S.family.version }, tapThreshold: TAP_THRESHOLD, tap,
    contingency: { s2Wave: tap.s2Wave, s3Wave: tap.s3Wave, s3Size: tap.s3Size, switched: tap.switched },
    naturalRates: { pinned: NATURAL_RATES, measured: natural },
    targets: gen.TARGETS, planRows: gen.PLAN_ROWS, slicePorts: gen.SLICE_PORTS, heldOutPorts: gen.HELD_OUT_PORTS,
    specGaps: SPEC_GAPS,
    ...(prev.supply ? { supply: prev.supply } : {}),
    ...(prev.partialInput ? { partialInput: prev.partialInput } : {}),
  };
  writeFileSync(MANIFEST, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`manifest: tap ${tap.aligned}/${tap.claims} (${(tap.rate * 100).toFixed(2)}%), population ${tap.population.aligned}/${tap.population.claims} (${(tap.population.rate * 100).toFixed(2)}%), pass ${tap.pass}, S2 wave ${tap.s2Wave}; natural ${JSON.stringify(natural.rates)}`);
  return out;
}

async function supply(env, slices, outDir) {
  const result = {}, ctxOf = slice => ({ beds: env.beds, slice: sliceDef(slice), contracts: env.spec.contracts, spec: env.spec.spec, pin: env.frozen.pin });
  const pools = existsSync(path.join(REPO, '.foundry', 'kev-data', 'pools', 'train', 'X1.jsonl')) ? { dir: path.join(REPO, '.foundry', 'kev-data', 'pools', 'train') } : null;
  for (const slice of slices) {
    const def = sliceDef(slice), [a, b] = def.seeds, t0 = Date.now(), h = createHash('sha256');
    const seeds = Array.from({ length: b - a + 1 }, (_, i) => a + i), { wordings, lines } = stubs(env.spec.contracts, slice);
    const recs = [];
    for await (const r of gen.records(slice, seeds, { wordings, lines, ...(pools && slice === 'train' ? { pools } : {}) }, ctxOf(slice))) { recs.push(r); h.update(`${JSON.stringify(r)}\n`); }
    const labelOf = r => Object.values(r.questions)[0].label, portOf = r => Object.keys(r.questions)[0].split('~')[0];
    const perPort = {}, perLabel = {}, forms = {}, lineHashes = {};
    for (const r of recs) {
      const p = portOf(r);
      perPort[p] = (perPort[p] ?? 0) + 1;
      if (r.meta.variant === 'unknowable') continue;
      const l = labelOf(r);
      ((perLabel[p] ??= {})[l] = (perLabel[p][l] ?? 0) + 1);
      ((forms[p] ??= {})[l] ??= new Set()).add(r.meta.formId);
      (lineHashes[p] ??= new Set()).add(r.meta.surface?.lineHash ?? r.meta.formId);
    }
    const s2 = recs.filter(r => portOf(r) === 'S2');
    const rep = gen.describe();
    result[slice] = {
      seeds: [a, b], worlds: seeds.length, records: recs.length, perPort, perLabel,
      formsPerLabel: Object.fromEntries(Object.entries(forms).map(([p, m]) => [p, Object.fromEntries(Object.entries(m).map(([l, s]) => [l, s.size]))])),
      distinctSurfaceForms: Object.fromEntries(Object.entries(lineHashes).map(([p, s]) => [p, s.size])),
      s2: s2.length ? {
        bySet: counts(s2, r => r.meta.s2?.set ?? 'unknowable'), byVariant: counts(s2, r => r.meta.variant),
        classSupport: gen.classSupport(s2.filter(r => r.meta.variant === 'clean')), press: counts(s2, r => r.meta.s2?.stratum ?? 'unknowable'),
        naturalSetRates: (() => { const nat = s2.filter(r => r.meta.s2?.set === 'natural' || slice === 'test-in' || slice === 'dev-select' || slice === 'calib-in'); const c = counts(nat.filter(r => r.meta.variant === 'clean'), labelOf); const n = Object.values(c).reduce((x, y) => x + y, 0); return { n, rates: Object.fromEntries(S2_LABELS.map(l => [l, n ? Number(((c[l] ?? 0) / n).toFixed(4)) : null])) }; })(),
      } : undefined,
      draws: Object.fromEntries(Object.entries(rep.draws ?? {}).map(([k, v]) => [k, v && { n: v.n, rows: v.rows, taken: v.taken, shortfall: v.shortfall, axes: v.axes && Object.fromEntries(Object.entries(v.axes).map(([ax, x]) => [ax, { want: x.want, taken: x.taken, shortfall: x.shortfall }])), cap: v.cap, supply: v.supply }])),
      dropCounters: rep.counts, streamHash: `sha256:${h.digest('hex')}`, seconds: Math.round((Date.now() - t0) / 1000),
    };
    const line = (slice, r) => console.log(`${slice} (${r.worlds} worlds, ${r.seconds}s): ${r.records} records ${JSON.stringify(r.perPort)} hash ${r.streamHash.slice(0, 19)}`);
    line(slice, result[slice]);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'synth-supply.json'), `${JSON.stringify({ generator: gen.GENERATOR_VERSION, slices: result }, null, 2)}\n`);
  }
  const compact = Object.fromEntries(Object.entries(result).map(([s, r]) => [s, { records: r.records, perPort: r.perPort, perLabel: r.perLabel, formsPerLabel: r.formsPerLabel, distinctSurfaceForms: r.distinctSurfaceForms, streamHash: r.streamHash, shortfall: Object.fromEntries(Object.entries(r.draws).map(([k, v]) => [k, v?.shortfall ?? null])) }]));
  if (existsSync(MANIFEST)) {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    m.supply = { ...(m.supply ?? {}), ...compact };
    writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
  }
  return result;
}

// ---- partial-input baselines (JUDGE-PROGRAM.md 2.7 step 7, 6.3 PART) over the whole S2 train supply of the strict train bucket -------------------------------
async function part(env) {
  const ctx = { beds: env.beds, slice: sliceDef('train'), contracts: env.spec.contracts, spec: env.spec.spec, pin: env.frozen.pin };
  const { wordings, lines } = stubs(env.spec.contracts, 'train');
  const all = [];
  for await (const r of gen.records('train', Array.from({ length: 3599 }, (_, i) => 401 + i), { ports: ['S2'], rows: { S2: 1e6 }, cap: false, wordings, lines }, ctx)) if (r.meta.variant === 'clean') all.push({ seed: r.meta.seed, label: Object.values(r.questions)[0].label, state: r.state });
  const id = r => `${r.seed}|${r.state.value}|${r.state.property}`, byHash = (a, b) => (sha(id(a)) < sha(id(b)) ? -1 : 1);
  const cap = rows => { const c = counts(rows, r => r.label), m = Math.floor(Math.min(...Object.values(c)) * 3), t = {}; return [...rows].sort(byHash).filter(r => (t[r.label] = (t[r.label] ?? 0) + 1) <= m); };
  const views = {
    'document type + property': r => `${r.state.document_type} ${r.state.property}`,
    'value only (digits masked)': r => r.state.value.replace(/\d+/g, '0'),
    'passage length': r => `len${Math.floor(r.state.passage.length / 100)}`,
    'context only (value sentence removed)': r => { const sp = sentenceSpans(r.state.passage); const i = sp.findIndex(x => x.text.includes(r.state.value)); return sp.filter((_, j) => j !== i).map(x => x.text).join(' '); },
    'full passage (control)': r => r.state.passage,
  };
  const A = all.filter(r => r.seed % 2 === 0), B = all.filter(r => r.seed % 2 === 1), fit = cap(A), evalCapped = cap(B), ceiling = 0.28, out = {};
  for (const [name, v] of Object.entries(views)) {
    const ex = rs => rs.map(r => ({ text: v(r), label: r.label })), model = trainProbe(ex(fit), { iterations: 100 });
    const c = evaluate(model, ex(evalCapped)).balancedAccuracy, n = evaluate(model, ex(B)).balancedAccuracy;
    out[name] = { capped3to1: Number(c.toFixed(3)), natural: Number(n.toFixed(3)), status: name.includes('control') ? 'control' : c <= ceiling && n <= ceiling ? 'within the ceiling' : 'OPEN' };
    console.log(`PART S2 ${name}: balanced accuracy ${c.toFixed(3)} (eval at 3:1) / ${n.toFixed(3)} (eval at the natural rates) ${out[name].status}`);
  }
  const m = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  m.partialInput = { port: 'S2', ceiling, fitRows: counts(fit, r => r.label), evalRows: counts(evalCapped, r => r.label), supply: counts(all, r => r.label), baselines: out,
    note: 'fit on the even-seed half of the whole train supply capped 3:1, eval on the odd-seed half (capped, and at the natural rates); the structure behind the OPEN baselines is the bed\'s: press-release documents hold only measured claims, instruction_like sits only in preprints, memos and lab notes at d5, projected only from d4' };
  writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

const env = await setup();
if (flag('--manifest') || (!flag('--full') && !flag('--part'))) await manifest(env);
if (flag('--part')) await part(env);
if (flag('--full')) {
  const slices = (opt('--slices') ?? SLICE_IDS.filter(s => (gen.SLICE_PORTS[s] ?? []).length).join(',')).split(',');
  await supply(env, slices, path.resolve(opt('--out') ?? path.join(REPO, '.foundry', 'kev-data', 'synth')));
}
