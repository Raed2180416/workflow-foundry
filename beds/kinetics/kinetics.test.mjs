// Oracle-health tests for the `kinetics` bed (see beds/CONTRACT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, estimateTokens } from '../lib/canonical.mjs';
import * as bed from './index.mjs';
import { buildWorld, TOL } from './world.mjs';
import { renderTask } from './render.mjs';
import { fitMM, relErr } from './fit.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const SEEDS30 = Array.from({ length: 30 }, (_, i) => i + 1);
const seedsFor = d => ([1, 3, 5].includes(d) ? SEEDS30 : SEEDS); // AUDIT step 5: 30/30 at d1, d3, d5
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

test('interface shape', () => {
  assert.equal(bed.family.id, 'kinetics');
  assert.equal(bed.family.kind, 'oneshot');
  for (const k of ['id', 'domain', 'version', 'description']) assert.equal(typeof bed.family[k], 'string');
  assert.equal(typeof bed.generate, 'function');
  assert.equal(typeof bed.oracle, 'function');
  assert.equal(typeof bed.referenceSolve, 'function');
  const names = bed.badControls.map(c => c.name);
  assert.ok(names.includes('empty'));
  assert.ok(names.includes('shuffled-or-corrupted'));
  assert.ok(names.some(n => n.startsWith('plausible-but-wrong')));
  // portable schema subset
  const banned = ['pattern', 'oneOf', 'uniqueItems', '$ref', 'format'];
  const walk = o => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { assert.ok(!banned.includes(k), `schema uses ${k}`); walk(v); } };
  walk(bed.outputSchema);
});

test('outputSchema is inside the repo portable subset (src/schema-subset.mjs) [AUDIT F4]', async () => {
  const { portableSchemaViolations } = await import('../../src/schema-subset.mjs');
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
});

test('determinism: identical calls give byte-identical tasks; seeds and splits differ', () => {
  for (const d of DIFFS) {
    for (const seed of [1, 2, 17]) {
      bed._clearCache();
      const a = canonical(bed.generate({ seed, split: 'dev', difficulty: d }));
      bed._clearCache();
      const b = canonical(bed.generate({ seed, split: 'dev', difficulty: d }));
      assert.equal(a, b, `d${d} seed ${seed}`);
      // independent of the cache: a fresh world + render gives the same prompt/inputs
      const w = buildWorld({ seed, split: 'dev', difficulty: d });
      const r = renderTask(w, { seed, split: 'dev', difficulty: d });
      assert.equal(canonical({ p: r.prompt, i: r.inputs }), canonical({ p: JSON.parse(a).prompt, i: JSON.parse(a).inputs }));
    }
    const x = canonical(bed.generate({ seed: 5, split: 'dev', difficulty: d }).inputs);
    const y = canonical(bed.generate({ seed: 6, split: 'dev', difficulty: d }).inputs);
    const z = canonical(bed.generate({ seed: 5, split: 'test', difficulty: d }).inputs);
    assert.notEqual(x, y); assert.notEqual(x, z);
  }
});

test('task shape: contract fields, JSON-serialisable', () => {
  const t = bed.generate({ seed: 3, split: 'test', difficulty: 3 });
  for (const k of ['id', 'family', 'seed', 'split', 'difficulty', 'prompt', 'inputs']) assert.ok(k in t, k);
  assert.equal(t.family, 'kinetics');
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t);
  assert.ok(Array.isArray(t.inputs.documents) && t.inputs.documents.length >= 5);
  assert.ok(Array.isArray(t.inputs.study.conditions));
});

test('referenceSolve passes for >=20 seeds at every difficulty (30 at d1/d3/d5; dev and test) and the evaluator is healthy', () => {
  for (const d of DIFFS) {
    for (const split of ['dev', 'test']) {
      for (const seed of seedsFor(d)) {
        const t = bed.generate({ seed, split, difficulty: d });
        const r = bed.oracle(t, bed.referenceSolve(t));
        assert.equal(r.details.evaluatorValid, true, `evaluator d${d} ${split} ${seed}`);
        assert.equal(r.pass, true, `reference d${d} ${split} ${seed}: ${JSON.stringify(r.details)}`);
        assert.equal(r.score, 1);
      }
    }
  }
});

test('every bad control fails for >=20 seeds at every difficulty (30 at d1/d3/d5)', () => {
  for (const d of DIFFS) {
    for (const c of bed.badControls) {
      let fails = 0;
      for (const seed of seedsFor(d)) {
        const t = bed.generate({ seed, split: 'dev', difficulty: d });
        const r = bed.oracle(t, c.make(t));
        if (!r.pass) fails++;
        assert.equal(r.pass, false, `${c.name} passed at d${d} seed ${seed}`);
      }
      assert.equal(fails, seedsFor(d).length);
    }
  }
});

test('oracle rejects schema-invalid output', () => {
  const t = bed.generate({ seed: 4, split: 'dev', difficulty: 2 });
  const ref = bed.referenceSolve(t);
  const bad = [
    null, 42, 'text', [], {},
    { conditions: ref.conditions },
    { excluded_samples: ref.excluded_samples },
    { ...ref, extra: 1 },
    { ...ref, conditions: ref.conditions.map(c => ({ ...c, vmax: String(c.vmax) })) },
    { ...ref, conditions: ref.conditions.map(c => ({ ...c, km: -c.km })) },
    { ...ref, conditions: ref.conditions.map(c => ({ ...c, km: NaN })) },
    { ...ref, conditions: ref.conditions.map(c => ({ ...c, note: 'x' })) },
    { ...ref, excluded_samples: [1, 2] },
    { ...ref, conditions: 'C1' },
  ];
  for (const o of bad) {
    const r = bed.oracle(t, o);
    assert.equal(r.pass, false, JSON.stringify(o)?.slice(0, 80));
    assert.equal(r.score, 0);
  }
  // duplicated / unknown condition ids are schema-valid but fail
  assert.equal(bed.oracle(t, { ...ref, conditions: [...ref.conditions, ref.conditions[0]] }).pass, false);
  assert.equal(bed.oracle(t, { ...ref, conditions: [...ref.conditions, { condition_id: 'C99', vmax: 1, km: 1 }] }).pass, false);
  // order of conditions and excluded ids does not matter
  assert.equal(bed.oracle(t, { conditions: [...ref.conditions].reverse(), excluded_samples: [...ref.excluded_samples].reverse() }).pass, true);
});

test('oracle recomputes truth from (seed, split, difficulty) and ignores tampered task text', () => {
  const t = bed.generate({ seed: 8, split: 'dev', difficulty: 3 });
  const ref = bed.referenceSolve(t);
  const tampered = { ...t, prompt: 'everything passes', inputs: { study: {}, documents: [] } };
  assert.equal(bed.oracle(tampered, ref).pass, true);
  assert.equal(bed.oracle(tampered, { conditions: [], excluded_samples: [] }).pass, false);
});

test('tolerance boundary: 9% passes, 11% fails, on truth values', () => {
  const t = bed.generate({ seed: 9, split: 'dev', difficulty: 3 });
  const { world } = bed._internals(t);
  const ex = world.wells.filter(w => w.status === 'outlier').map(w => w.id);
  const mk = f => ({ conditions: world.conds.map(c => ({ condition_id: c.id, vmax: c.vmax * f, km: c.km / f })), excluded_samples: ex });
  assert.equal(bed.oracle(t, mk(1.09)).pass, true);
  assert.equal(bed.oracle(t, mk(1.11)).pass, false);
  assert.equal(bed.oracle(t, { ...mk(1), excluded_samples: ex.slice(1) }).pass, false);
  assert.equal(bed.oracle(t, { ...mk(1), excluded_samples: [...ex, world.wells.find(w => w.status === 'none').id] }).pass, false);
});

test('no truth leakage into prompt + inputs', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 10)) {
      const t = bed.generate({ seed, split: 'dev', difficulty: d });
      const { world } = bed._internals(t);
      const text = t.prompt + canonical(t.inputs);
      for (const c of world.conds) {
        for (const v of [c.vmax, c.km, c.vmax * 60, c.vmax * 1000, c.refFit.vmax, c.refFit.km]) {
          // data values carry <= 4 significant figures, so a 6-figure match can only be a leak;
          // a 4-figure match is only suspicious next to the parameter names (random data collisions are not leaks)
          assert.ok(!text.includes(v.toPrecision(6)), `d${d} seed ${seed}: ${v.toPrecision(6)} leaked`);
          const four = v.toPrecision(4).replace('.', '\\.');
          assert.ok(!new RegExp(`(Km|Vmax|K_m|V_max)[^\\n]{0,40}${four}`, 'i').test(text), `d${d} seed ${seed}: ${v.toPrecision(4)} near a parameter name`);
        }
        if (c.inhibitor) assert.ok(!/\bKi\b|K_i|inhibition constant/.test(text), 'inhibition constant not disclosed');
      }
      // no hidden fields in the inputs
      const keys = new Set();
      const walk = o => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } };
      walk(t.inputs);
      for (const k of ['vmax', 'km', 'status', 'reason', 'excluded', 'truth', 'factor', 'rateTrue', 'typo', 'traps', 'claims', 'silent', 'late', 'dev', 'tricky', 'timed', 'grid', 'readStart', 'noteFor', 'noteFrom'])
        assert.ok(!keys.has(k), `inputs carry key ${k}`);
      // the exclusion set is never written down as a list
      const ex = world.wells.filter(w => w.status === 'outlier').map(w => w.id).sort();
      if (ex.length >= 2) assert.ok(!text.includes(`${ex[0]}, ${ex[1]}`) && !text.includes(`${ex[0]}","${ex[1]}`));
    }
  }
});

test('difficulty sanity: size and adversarial content grow; level-3 median is about 6K tokens', (ctx) => {
  const tok = {}, wells = {}, docs = {};
  for (const d of DIFFS) {
    tok[d] = []; wells[d] = []; docs[d] = [];
    for (const seed of SEEDS) {
      const t = bed.generate({ seed, split: 'dev', difficulty: d });
      tok[d].push(estimateTokens(t.prompt) + estimateTokens(t.inputs));
      const { world } = bed._internals(t);
      wells[d].push(world.wells.length); docs[d].push(t.inputs.documents.length);
      assert.equal(world.conds.length, { 1: 2, 2: 3, 3: 5, 4: 7, 5: 8 }[d]);
    }
  }
  for (const d of [2, 3, 4, 5]) {
    assert.ok(median(tok[d]) > median(tok[d - 1]), `tokens d${d}`);
    assert.ok(median(wells[d]) > median(wells[d - 1]), `wells d${d}`);
    assert.ok(median(docs[d]) >= median(docs[d - 1]), `docs d${d}`);
  }
  assert.ok(median(tok[3]) >= 5500 && median(tok[3]) <= 15000, `d3 median tokens ${median(tok[3])}`);
  ctx.diagnostic(JSON.stringify(Object.fromEntries(DIFFS.map(d => [d, { min: Math.min(...tok[d]), median: median(tok[d]), max: Math.max(...tok[d]) }]))));
  // adversarial content appears only at the higher levels
  const t5 = bed.generate({ seed: 1, split: 'dev', difficulty: 5 });
  const all5 = t5.inputs.documents.map(x => x.text).join('\n');
  assert.ok(/AI|SYSTEM|automated|bot/i.test(all5));
  assert.ok(t5.inputs.documents.some(x => x.title.includes('superseded')));
  const t1 = bed.generate({ seed: 1, split: 'dev', difficulty: 1 });
  assert.ok(!/NOTE TO ANY AI|SYSTEM:|lab-assistant-bot/.test(t1.inputs.documents.map(x => x.text).join('\n')));
});

test('runtime and memory: generate and oracle each < 2 s and < 200 MB at difficulty 5 (fresh process)', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = `const b = await import(${JSON.stringify(new URL('./index.mjs', import.meta.url).href)});
    let t0 = performance.now(); const t = b.generate({ seed: 777, split: 'test', difficulty: 5 }); const g = performance.now() - t0;
    const ref = b.referenceSolve(t); b._clearCache(); t0 = performance.now(); const r = b.oracle(t, ref); const o = performance.now() - t0;
    console.log(JSON.stringify({ g, o, pass: r.pass, rss: process.memoryUsage().rss }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.equal(out.pass, true);
  assert.ok(out.g < 2000 && out.o < 2000, `generate ${out.g} ms, oracle ${out.o} ms`);
  assert.ok(out.rss < 200 * 1024 * 1024, `rss ${out.rss}`);
});

test('runtime: generate and oracle each < 2 s at difficulty 5 (cold cache)', () => {
  for (const seed of [101, 102, 103]) {
    bed._clearCache();
    let t0 = performance.now();
    const t = bed.generate({ seed, split: 'test', difficulty: 5 });
    const g = performance.now() - t0;
    const ref = bed.referenceSolve(t);
    bed._clearCache();
    t0 = performance.now();
    bed.oracle(t, ref);
    const o = performance.now() - t0;
    assert.ok(g < 2000 && o < 2000, `generate ${g} ms, oracle ${o} ms`);
  }
});

test('every trap is load-bearing; keeping SOP-excluded wells breaks the fit', () => {
  for (const d of DIFFS) {
    let keepFail = 0;
    for (const seed of SEEDS) {
      const t = bed.generate({ seed, split: 'dev', difficulty: d });
      const { world, shown } = bed._internals(t);
      assert.ok(world.traps.length >= 1);
      for (const tr of world.traps) assert.equal(tr.loadBearing, true, `d${d} seed ${seed} ${tr.type}`);
      for (const c of world.conds) assert.ok(c.noiseAttempts > 0, `noise accepted for ${c.id}`);
      const kept = bed._fitAll(world, bed._assemble(world, shown, { keepOutliers: true }));
      if (world.conds.some(c => relErr(kept[c.id].vmax, c.vmax) > TOL || relErr(kept[c.id].km, c.km) > TOL)) keepFail++;
      if (world.rawExport) assert.equal(world.rawExport.typos.length, world.knobs.rawExport.typos, 'typos placed');
    }
    // 3.0.0: at d3+ most exclusions are silent (they read normally), so keeping them breaks a fit less
    // often (34-38/50 over dev seeds 1-50); the exact-set rule makes every exclusion count regardless
    assert.ok(keepFail >= (d <= 2 ? 18 : 8), `d${d}: keeping outliers broke the fit in only ${keepFail}/20`);
  }
});

test('fit: recovers parameters from exact data, with and without fixed Vmax', () => {
  const pts = [];
  for (const S of [2, 5, 10, 20, 50, 100, 200, 500]) pts.push({ S, v: 3.3 * S / (41 + S) });
  const f = fitMM(pts);
  assert.ok(relErr(f.vmax, 3.3) < 1e-6 && relErr(f.km, 41) < 1e-6);
  const g = fitMM(pts, { fixedV: 3.3 });
  assert.ok(relErr(g.km, 41) < 1e-6);
});

// ---------------------------------------------------------------------------------------
// Text supports the answer: an independent parser for the rendered formats recovers, from
// the document text and the units it states, the same numbers the reference fit uses.
const NUM = String.raw`-?\d+(?:[.,]\d+)?(?:e-?\d+|E[-+]\d+|×10\^-?\d+)?`;
const UNIT = String.raw`(?:µ|u|n|m)(?:M|mol\/L)(?:\/s|\/min|\/L\/s|\/L\/min| s⁻¹| min⁻¹)?`;
const num = t => Number(String(t).trim().replace(',', '.').replace('×10^', 'e').replace(/E\+?/, 'e'));
function unitInfo(label) {
  let l = label.trim()
    .replace(/micromolar/, 'uM').replace(/nanomolar/, 'nM').replace(/millimolar/, 'mM')
    .replace(' per second', '/s').replace(' per minute', '/min').replace(' s⁻¹', '/s').replace(' min⁻¹', '/min')
    .replace(/^µ/, 'u').replace(/^(u|n|m)mol\/L/, '$1M');
  const m = l.match(/^(u|n|m)M(?:\/(s|min))?$/);
  if (!m) throw new Error(`unparsed unit label ${label}`);
  const amount = { u: 1, n: 1000, m: 0.001 }[m[1]];
  return { amount, time: m[2] ? { s: 1, min: 60 }[m[2]] : null };
}
const concOf = (txt, label) => num(txt) / unitInfo(label).amount;
const rateOf = (txt, label) => { const u = unitInfo(label); return num(txt) / (u.amount * u.time); };
function preambleUnits(text) {
  let m = text.match(/rates below are ([a-z ]+?) and substrate is given in ([a-z]+)/);
  if (m) return { ru: m[1], cu: m[2] };
  m = text.match(/\(Units today: \[S\] in (\S+), initial rates in (.+?)\. /);
  if (m) return { cu: m[1], ru: m[2] };
  m = text.match(/writing substrate in ([a-z]+) and rates in ([a-z ]+?) throughout/);
  if (m) return { cu: m[1], ru: m[2] };
  return null;
}
// units stated in a sheet's own header line(s), in the same { cu, ru } shape as preambleUnits
function headerUnits(text) {
  let m = text.match(/\| \[S\] \((.+?)\) \| v0 \((.+?)\) \|/); if (m) return { cu: m[1], ru: m[2] };
  m = text.match(/# units: S in (.+?), rate in (.+)/); if (m) return { cu: m[1], ru: m[2].trim() };
  m = text.match(/S_(uM|mM|nM)[,;]rate_(\w+)_per_(s|min)/); if (m) return { cu: m[1], ru: `${m[2]}/${m[3]}` };
  m = text.match(/Units on this sheet: rates in (.+?), \[S\] in (.+?)\./); if (m) return { cu: m[2], ru: m[1] };
  return null;
}
// "Same reader template as <author>'s <date> sheet": the units are those stated on that sheet
function refUnits(text, docs) {
  const m = text.match(/template as (.+?)'s (\d{4}-\d\d-\d\d) sheet|Units: as on (.+?)'s export of (\d{4}-\d\d-\d\d)|those of the (\d{4}-\d\d-\d\d) sheet by (.+?)\./);
  if (!m) return null;
  const author = m[1] ?? m[3] ?? m[6], date = m[2] ?? m[4] ?? m[5];
  const src = docs.find(d => d.kind === 'notebook' && d.author === author && d.date === date);
  return src ? (headerUnits(src.text) ?? preambleUnits(src.text)) : null;
}
function csvSplit(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
function parseDoc(doc, prefix, reader, docs) {
  const ID = `${prefix}-\\d{4}`;
  const rows = []; // { id, S (µM), rate (µM/s) }
  const text = doc.text, lines = text.split('\n');
  const pre = preambleUnits(text) ?? refUnits(text, docs);
  if (doc.kind === 'instrument') {
    const ru = text.match(/Rate\((.+?)\)/)[1];
    for (const l of lines) { const m = l.match(new RegExp(`^\\d+\\s+\\w\\d\\d\\s+(${ID})\\s+(\\S+)`)); if (m) rows.push({ id: m[1], rate: rateOf(m[2], ru), src: 'export' }); }
    return rows;
  }
  if (doc.title.startsWith('Notebook p.')) {
    const h = text.match(/\| Sample \| Well \| \[S\] \((.+?)\) \| v0 \((.+?)\) \| Notes \|/);
    const cu = h ? h[1] : pre.cu, ru = h ? h[2] : pre.ru;
    for (const l of lines) { const m = l.match(new RegExp(`^\\| (${ID}) \\| \\w+ \\| ([^|]+) \\| ([^|]+) \\|`)); if (m) rows.push({ id: m[1], S: concOf(m[2], cu), rate: rateOf(m[3], ru) }); }
  } else if (doc.title.startsWith('CSV export')) {
    let cu, ru;
    const c1 = text.match(/# units: S in (.+?), rate in (.+)/), c2 = text.match(/S_(uM|mM|nM),rate_(\w+)_per_(s|min)/);
    if (c1) { cu = c1[1]; ru = c1[2].trim(); } else if (c2) { cu = c2[1]; ru = `${c2[2]}/${c2[3]}`; } else { cu = pre.cu; ru = pre.ru; }
    for (const l of lines) { if (!new RegExp(`^${ID},`).test(l)) continue; const f = csvSplit(l); rows.push({ id: f[0], S: concOf(f[5], cu), rate: rateOf(f[6], ru) }); }
  } else if (doc.title.startsWith('Instrument PC export')) {
    const h = text.match(/S_(uM|mM|nM);rate_(\w+)_per_(s|min)/);
    for (const l of lines) { if (!new RegExp(`^${ID};`).test(l)) continue; const f = l.split(';'); rows.push({ id: f[0], S: concOf(f[5], h[1]), rate: rateOf(f[6], `${h[2]}/${h[3]}`) }); }
  } else if (doc.title.startsWith('Summary sheet')) {
    const h = text.match(/Units on this sheet: rates in (.+?), \[S\] in (.+?)\./);
    const cu = h ? h[2] : pre.cu, ru = h ? h[1] : pre.ru;
    for (const l of lines) {
      const m = l.match(/^\s+\[S\] = (\S+?)(?: \S+)?: (.*)$/); if (!m) continue;
      for (const item of m[2].split(' | ')) {
        const im = item.match(new RegExp(`^r\\d+ (\\S+)(?: → re-read (\\S+))? \\((${ID})`));
        rows.push({ id: im[3], S: concOf(m[1], cu), rate: rateOf(im[1], ru), reread: im[2] ? rateOf(im[2], ru) : null });
      }
    }
  } else if (doc.title.startsWith('Bench log')) {
    const U = `(?: (${UNIT}))?`;
    const pats = [
      [new RegExp(`(${ID}) \\((${NUM})${U}\\): (${NUM})${U}\\.`, 'g'), m => [m[1], m[2], m[3], m[4], m[5]]],
      [new RegExp(`(${ID}) at (${NUM})${U} gave (${NUM})${U}\\.`, 'g'), m => [m[1], m[2], m[3], m[4], m[5]]],
      [new RegExp(`(${NUM})${U} → (${NUM})${U} \\((${ID})\\)\\.`, 'g'), m => [m[5], m[1], m[2], m[3], m[4]]],
      [new RegExp(`Well \\w+ / (${ID}), \\[S\\] (${NUM})${U}, v0 (${NUM})${U}\\.`, 'g'), m => [m[1], m[2], m[3], m[4], m[5]]],
      [new RegExp(`(${ID}): (${NUM})${U} at (${NUM})${U}\\.`, 'g'), m => [m[1], m[4], m[5], m[2], m[3]]],
    ];
    for (const [re, pick] of pats) for (const m of text.matchAll(re)) {
      const [id, S, Su, r, Ru] = pick(m);
      rows.push({ id, S: concOf(S, Su ?? pre.cu), rate: rateOf(r, Ru ?? pre.ru) });
    }
  } else if (doc.title.startsWith(`${reader} export`)) {
    const f1 = text.match(/corresponds to ([\d.]+) µM\/min/), f2 = text.match(/ε340 = ([\d.]+) mM⁻¹ cm⁻¹, and 200 µL in this plate gives a ([\d.]+) cm/);
    const F = f1 ? Number(f1[1]) : 1 / (Number(f2[1]) * Number(f2[2])); // µM/min per mAU/min
    for (const l of lines) { const m = l.match(new RegExp(`^\\w\\d\\d\\s+(${ID})\\s+(\\S+) (\\S+)\\s+(\\S+)`)); if (m) rows.push({ id: m[1], S: concOf(m[2], m[3]), rate: Math.abs(num(m[4])) * F / 60 }); }
  } else throw new Error(`unknown notebook format: ${doc.title}`);
  return rows;
}

test('documents support the reference data: parsed numbers x stated units == values the reference fits', () => {
  for (const d of DIFFS) {
    for (const seed of SEEDS.slice(0, 12)) {
      const t = bed.generate({ seed, split: 'dev', difficulty: d });
      const { world, shown } = bed._internals(t);
      const seen = new Map();
      let exportRows = 0;
      for (const doc of t.inputs.documents.filter(x => x.kind === 'notebook' || x.kind === 'instrument')) {
        for (const row of parseDoc(doc, world.meta.prefix, world.meta.reader, t.inputs.documents)) {
          const w = world.wellById[row.id], s = shown[row.id];
          assert.ok(w, `unknown id ${row.id}`);
          if (row.src === 'export') { exportRows++; assert.ok(relErr(row.rate, s.rate) < 1e-9, `export ${row.id}`); continue; }
          assert.ok(!seen.has(row.id), `${row.id} transcribed twice`);
          seen.set(row.id, row);
          assert.ok(relErr(row.S, s.rowS) < 1e-9, `d${d} s${seed} ${row.id} S ${row.S} vs ${s.rowS} (${doc.title})`);
          if (w.status === 'reread') { if (row.reread != null) assert.ok(relErr(row.reread, s.rateHeader) < 1e-9, `reread ${row.id}`); continue; }
          const expect = s.rateHeaderTranscribed ?? s.rateHeader;
          assert.ok(relErr(row.rate, expect) < 1e-9, `d${d} s${seed} ${row.id} rate ${row.rate} vs ${expect} (${doc.title})`);
        }
      }
      assert.equal(seen.size, world.wells.length, `d${d} seed ${seed}: every study well transcribed exactly once`);
      assert.equal(exportRows, world.rawExport ? world.rawExport.series.reduce((n, k) => n + world.seriesByKey[k].wells.length, 0) : 0);
      // careful-reader canonical values stay within display rounding of the generated rates
      for (const w of world.wells) assert.ok(relErr(shown[w.id].rate, w.rate) < 0.006, `${w.id} display rounding`);
    }
  }
});

test('README documents the version, the measured token sizes and the oracle rule; AUDIT.md exists [AUDIT F16]', async () => {
  const { readFile } = await import('node:fs/promises');
  const readme = await readFile(new URL('./README.md', import.meta.url), 'utf8');
  for (const s of ['## Oracle', '10%', 'excluded_samples', 'estimateTokens', 'prompt-injection', `**Version:** ${bed.family.version}`, 'AUDIT.md']) assert.ok(readme.includes(s), s);
  // [AUDIT F16] the audit record the README and the tests cite exists, is dated, and covers this version
  const audit = await readFile(new URL('./AUDIT.md', import.meta.url), 'utf8');
  assert.match(audit.split('\n')[0], /^# kinetics adversarial audit, \d{4}-\d\d-\d\d/);
  assert.ok(audit.includes(`-> ${bed.family.version}`) && audit.includes('| id | severity | finding | evidence (before) | fix | regression test |'));
});

// ---------------------------------------------------------------------------------------
// AUDIT regressions (see AUDIT.md). Each test names the finding it pins down.

test('oracle bypass attempts fail; score is 1 only for a pass [AUDIT F1, F2]', () => {
  const t = bed.generate({ seed: 4, split: 'dev', difficulty: 3 });
  const ref = bed.referenceSolve(t);
  const { world } = bed._internals(t);
  const allIds = world.wells.map(w => w.id);
  assert.equal(bed.oracle(t, ref).pass, true);
  const attempts = {
    protoIds: { ...ref, conditions: [...ref.conditions, ...['__proto__', 'toString', 'constructor', 'hasOwnProperty'].map(id => ({ condition_id: id, vmax: 1, km: 1 }))] },
    unknownExtra: { ...ref, conditions: [...ref.conditions, { condition_id: 'C99', vmax: 1, km: 1 }] },
    duplicatedCondition: { ...ref, conditions: [...ref.conditions, { ...ref.conditions[0], km: ref.conditions[0].km * 3 }] },
    allCandidates: { ...ref, excluded_samples: allIds },
    hugeExcluded: { ...ref, excluded_samples: [...ref.excluded_samples, ...Array.from({ length: 50000 }, (_, i) => `X-${i}`)] },
    hugeConditions: { ...ref, conditions: [...ref.conditions, ...Array.from({ length: 20000 }, (_, i) => ({ condition_id: `Z${i}`, vmax: 1, km: 1 }))] },
    infinity: { ...ref, conditions: ref.conditions.map(c => ({ ...c, vmax: Infinity })) },
    zero: { ...ref, conditions: ref.conditions.map(c => ({ ...c, km: 0 })) },
    boxedNumber: { ...ref, conditions: ref.conditions.map(c => ({ ...c, vmax: new Number(c.vmax) })) },
    idWhitespace: { ...ref, conditions: ref.conditions.map(c => ({ ...c, condition_id: ` ${c.condition_id}` })) },
    lowercaseSamples: { ...ref, excluded_samples: ref.excluded_samples.map(x => x.toLowerCase()) },
    arrayLike: { ...ref, excluded_samples: { length: 0 } },
    nestedTruthGuess: { ...ref, conditions: ref.conditions.map(c => ({ ...c, vmax: [c.vmax] })) },
  };
  for (const [name, out] of Object.entries(attempts)) {
    const r = bed.oracle(t, out);
    assert.equal(r.pass, false, name);
    assert.ok(r.score < 1, `${name} score ${r.score}`);
  }
  // duplicate excluded ids do not change the set (documented): passes, and cannot help a wrong answer
  assert.equal(bed.oracle(t, { ...ref, excluded_samples: [...ref.excluded_samples, ...ref.excluded_samples] }).pass, true);
  // score == 1 iff pass, over the controls
  for (const seed of SEEDS.slice(0, 5)) for (const d of DIFFS) {
    const tt = bed.generate({ seed, split: 'dev', difficulty: d });
    for (const c of bed.badControls) { const r = bed.oracle(tt, c.make(tt)); assert.equal(r.score === 1, r.pass, `${c.name} d${d}`); }
  }
});

test('generate returns an independent copy: mutating a task does not change later tasks [AUDIT F3]', () => {
  const a = bed.generate({ seed: 11, split: 'dev', difficulty: 3 });
  const before = canonical(a);
  a.inputs.documents.length = 0; a.inputs.study.conditions[0].pH = 99; a.prompt = '';
  const b = bed.generate({ seed: 11, split: 'dev', difficulty: 3 });
  assert.equal(canonical(b), before);
  assert.equal(bed.oracle(b, bed.referenceSolve(b)).pass, true);
});

test('no structural give-aways: shared dilution series, distinct pilot range [AUDIT F6, F7]', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = bed.generate({ seed, split: 'dev', difficulty: d });
    const { world } = bed._internals(t);
    const grids = new Set(world.conds.map(c => c.grid.join(',')));
    assert.equal(grids.size, 1, `d${d} seed ${seed}: one dilution series for the study`);
    if (world.pilot) for (const p of world.pilot) assert.notEqual(p.wells.map(w => w.S).join(','), world.conds[0].grid.join(','), 'pilot range differs');
  }
});

test('the register and the replicate numbers do not give a mislabelled row away [AUDIT F8]', () => {
  let moves = 0, kept = 0;
  for (const d of [3, 4, 5]) for (const [split, s0] of [['dev', 1], ['test', 5000]]) for (let seed = s0; seed < s0 + 20; seed++) {
    const t = bed.generate({ seed, split, difficulty: d });
    const { world } = bed._internals(t);
    for (const c of t.inputs.study.conditions) assert.deepEqual(Object.keys(c).sort(), ['condition_id', 'inhibitor', 'pH', 'planned_substrate_levels', 'temperature_C']);
    const lab = {}, tru = {};
    for (const s of world.series) { (lab[s.labelCondId] ??= []).push(s.displayRep); tru[s.condId] = (tru[s.condId] ?? 0) + 1; }
    // replicate numbers as written: exactly 1..n per labelled condition (no duplicate, no gap, no excess)
    for (const reps of Object.values(lab)) assert.deepEqual([...reps].sort((a, b) => a - b), reps.map((_, i) => i + 1));
    const multiset = o => Object.values(o).map(x => (Array.isArray(x) ? x.length : x)).sort().join(',');
    for (const tr of world.traps.filter(x => x.type === 'reassign' || x.type === 'omitted-inhibitor')) {
      moves++;
      if (tr.countsKept) { kept++; assert.equal(multiset(lab), multiset(tru), `d${d} ${split} ${seed}: label row counts are a permutation of the true ones`); }
    }
  }
  assert.ok(moves >= 100 && kept / moves >= 0.97, `${kept}/${moves} mislabels keep the row-count profile`);
});

test('a swapped pair is not visible from the plate order [AUDIT F10]', () => {
  let random = 0, ordered = 0;
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = bed.generate({ seed, split: 'test', difficulty: d });
    const { world } = bed._internals(t);
    for (const s of world.series) {
      const shownS = s.wells.map(id => world.wellById[id].displayS ?? world.wellById[id].S);
      if (s.layout === 'random') { random++; continue; }
      ordered++;
      const sorted = [...shownS].sort((a, b) => (s.layout === 'asc' ? a - b : b - a));
      assert.deepEqual(shownS, sorted, `d${d} seed ${seed} ${s.key}: ${s.layout} row is monotonic as displayed`);
    }
    for (const x of [...world.traps.filter(tr => ['swap', 'retracted'].includes(tr.type)), ...world.claims.filter(c => c.kind === 'swap')]) {
      assert.equal(world.seriesByKey[x.series].layout, 'random', `d${d} seed ${seed}: swap only in a randomised row`);
    }
  }
  assert.ok(random > 100 && ordered > 100, `${random} randomised and ${ordered} ordered rows`);
});

test('judgment content: every d3+ task needs prose reading that keywords and residuals cannot replace [AUDIT F5]', () => {
  for (const d of DIFFS) for (const seed of SEEDS) {
    const t = bed.generate({ seed, split: 'dev', difficulty: d });
    const { world } = bed._internals(t);
    const W = world.wells, k = world.knobs;
    assert.ok(W.some(w => w.status === 'decoy' && w.dev), `d${d} s${seed}: a kept well that really deviates (residual rules fail)`);
    assert.ok(world.claims.length >= 1, `d${d} s${seed}: a rejected suggestion`);
    if (d < 3) continue;
    assert.ok(W.some(w => w.silent), 'an excluded well that reads normally');
    assert.ok(W.some(w => w.late === 'fact'), 'an exclusion reported only in a later message');
    assert.ok(W.some(w => w.late === 'rowflag'), 'a reader-log flag given by plate, row and [S] rank');
    assert.ok(W.some(w => w.late === 'misattributed') && W.some(w => w.kind === 'misattributed'), 'a note moved to the neighbouring well');
    assert.ok(W.some(w => w.kind === 'late-withdrawn') && W.some(w => w.kind === 'late-cleared'), 'late reports that keep the well');
    // 3.0.0 [AUDIT F9, F14]: a colleague's report the author denies, two deviant kept wells, five silent exclusions
    assert.ok(W.some(w => w.kind === 'late-denied'), 'a colleague report that the author denies');
    assert.ok(W.filter(w => w.status === 'decoy' && w.dev).length >= 2, 'two kept wells that really deviate');
    assert.ok(W.filter(w => w.status === 'outlier' && w.silent).length >= 4, 'silent exclusions');
    const chat = t.inputs.documents.find(x => x.kind === 'chat').text;
    assert.ok(/went on the reader straight after|next to .* on the same day|share a master mix/.test(chat), 'range-plus-condition red herring');
    assert.ok(/No swap on my side|right order|were not; the tube labels/.test(chat), 'swap-shaped red herring');
    // ablation: exclusions read from the rows alone differ from the SOP set
    const rowsOnly = new Set([...W.filter(w => w.status === 'outlier' && !w.late), ...W.filter(w => w.kind === 'misattributed')].map(w => w.id));
    const truth = new Set(W.filter(w => w.status === 'outlier').map(w => w.id));
    assert.notDeepEqual(rowsOnly, truth);
    assert.ok(k.herrings && k.withdrawn && k.rowFlag && k.misattributed);
  }
});

// Attack budget for a "<=40-line heuristic": <=40 code lines and <=7000 characters (comment lines excluded).
const attackSize = src => { const code = src.split('\n').filter(l => l.trim() && !l.trim().startsWith('//')); return { lines: code.length, chars: [...code.join('\n')].length }; };
async function attackRate(name, d, split, s0) {
  const { heuristicSolve } = await import(`./attacks/${name}.mjs`);
  let pass = 0;
  for (let seed = s0; seed < s0 + 30; seed++) {
    const t = bed.generate({ seed, split, difficulty: d });
    let out; try { out = heuristicSolve(structuredClone(t)); } catch { continue; }
    for (const c of out.conditions ?? []) for (const f of ['vmax', 'km']) if (!(Number.isFinite(c[f]) && c[f] > 0)) c[f] = 1e-9;
    if (bed.oracle(t, out).pass) pass++;
  }
  return pass;
}

test('triviality: within-budget attacks pass < 20% of d3 tasks (30 test seeds from 5000, 30 dev seeds) [AUDIT step 5, F9]', async (ctx) => {
  const { readFile } = await import('node:fs/promises');
  const rates = {};
  for (const name of ['regex-v1', 'regex-budget', 'residual-hybrid']) {
    const size = attackSize(await readFile(new URL(`./attacks/${name}.mjs`, import.meta.url), 'utf8'));
    assert.ok(size.lines <= 40 && size.chars <= 7000, `${name} is outside the attack budget: ${JSON.stringify(size)}`);
    const test = await attackRate(name, 3, 'test', 5000), dev = await attackRate(name, 3, 'dev', 1);
    rates[name] = { test, dev, ...size };
    assert.ok(test < 6 && dev < 6, `${name} passes ${test}/30 test and ${dev}/30 dev d3 tasks`);
  }
  ctx.diagnostic(JSON.stringify(rates));
});

test('triviality: over-budget attacks are documented, not hidden (AUDIT.md) [AUDIT step 5]', async (ctx) => {
  const { readFile } = await import('node:fs/promises');
  const rates = {};
  for (const name of ['adapted-v3', 'whitebox-parser', 'whitebox-v3']) {
    const size = attackSize(await readFile(new URL(`./attacks/${name}.mjs`, import.meta.url), 'utf8'));
    assert.ok(size.lines > 40 || size.chars > 7000, `${name} is within budget and belongs in the budget test`);
    rates[name] = { test: await attackRate(name, 3, 'test', 5000), dev: await attackRate(name, 3, 'dev', 1), ...size };
  }
  // regression guards at the documented values (AUDIT.md): a generator change that makes them easier must be noticed
  assert.ok(rates['adapted-v3'].test <= 5 && rates['whitebox-parser'].test <= 2, JSON.stringify(rates));
  assert.ok(rates['whitebox-v3'].test <= 16 && rates['whitebox-v3'].dev <= 12, `white-box ceiling moved: ${JSON.stringify(rates['whitebox-v3'])}`);
  ctx.diagnostic(JSON.stringify(rates));
});

test('residuals: at d3+ no fixed threshold separates excluded from kept wells; late exclusions read normally [AUDIT F9]', () => {
  for (const d of [3, 4, 5]) {
    const tasks = [];
    for (let seed = 5000; seed < 5030; seed++) {
      const t = bed.generate({ seed, split: 'test', difficulty: d });
      const { world, shown } = bed._internals(t);
      for (const w of world.wells.filter(x => x.status === 'outlier' && x.late)) assert.equal(w.silent, true, `d${d} ${seed}: late exclusion ${w.id} is silent`);
      const ref = bed._fitAll(world, bed._assemble(world, shown));
      tasks.push(world.wells.map(w => { const f = ref[w.condId], s = shown[w.id]; return { out: w.status === 'outlier', silent: !!w.silent, x: Math.abs(Math.log(s.rate / (f.vmax * s.S / (f.km + s.S)))) }; }));
    }
    let best = 0;
    // even granting every silent exclusion (perfect prose reading), a residual threshold for the rest rarely works
    for (let th = 0.1; th <= 1.0; th += 0.01) best = Math.max(best, tasks.filter(ws => ws.every(w => (w.out ? w.silent || w.x > th : w.x <= th))).length);
    assert.ok(best <= 8, `d${d}: a fixed residual threshold classifies every non-silent well in ${best}/30 tasks`);
  }
});

test('oracle validation equals outputSchema: holes, 0, inherited fields [AUDIT F11, F12]', () => {
  const t = bed.generate({ seed: 5001, split: 'test', difficulty: 3 });
  const ref = bed.referenceSolve(t);
  const holes = { conditions: new Array(3), excluded_samples: [] };
  const holes2 = { ...ref, excluded_samples: [...ref.excluded_samples] }; holes2.excluded_samples.length += 2;
  for (const o of [holes, holes2, { ...ref, conditions: ref.conditions.map(c => Object.create(c)) }]) {
    let r; assert.doesNotThrow(() => { r = bed.oracle(t, o); });
    assert.equal(r.pass, false); assert.equal(r.score, 0); assert.equal(r.details.reason, 'schema-invalid');
  }
  // 0 satisfies the published schema (minimum: 0): graded, not schema-invalid, and it misses the tolerance
  const zero = bed.oracle(t, { ...ref, conditions: ref.conditions.map((c, i) => (i ? c : { ...c, km: 0 })) });
  assert.equal(zero.pass, false); assert.equal(zero.details.reason, undefined); assert.ok(zero.score > 0 && zero.score < 1);
  assert.equal(bed.validateOutput({ conditions: [{ condition_id: 'C1', vmax: 0, km: 0 }], excluded_samples: [] }).length, 0);
});

test('splits: test seeds >= 5000 never collide with dev seeds [AUDIT step 1]', async () => {
  const { hashSeed } = await import('../lib/rng.mjs');
  for (const d of DIFFS) {
    const dev = new Set(), devR = new Set();
    for (let s = 0; s < 5000; s++) { dev.add(hashSeed('kinetics', bed.family.version, 'dev', s, d)); devR.add(hashSeed('kinetics-render', 'dev', s, d)); }
    for (let s = 5000; s < 6000; s++) {
      assert.ok(!dev.has(hashSeed('kinetics', bed.family.version, 'test', s, d)), `d${d} test ${s}: world seed collides with a dev seed`);
      assert.ok(!devR.has(hashSeed('kinetics-render', 'test', s, d)), `d${d} test ${s}: render seed collides with a dev seed`);
    }
    assert.notEqual(canonical(bed.generate({ seed: 5000, split: 'test', difficulty: d }).inputs), canonical(bed.generate({ seed: 5000, split: 'dev', difficulty: d }).inputs));
  }
});

test('prose: clock-time shapes occur with both outcomes; colleague reports are answered by the author; articles [AUDIT F13, F14, F15]', async () => {
  let confirmed = 0, denied = 0;
  const SHAPES = { formed: /bubble formed at \d\d:\d\d/, popped: /bubble seen at \d\d:\d\d; popped it at/, tapped: /noticed an? [a-z ]*bubble at \d\d:\d\d and tapped it out at/ }, shapes = {};
  for (const d of [3, 4, 5]) for (const seed of SEEDS) {
    const t = bed.generate({ seed, split: 'test', difficulty: d });
    const { world } = bed._internals(t);
    const all = t.inputs.documents.map(x => x.text).join('\n');
    assert.ok(!/\b[Aa] (air|[aeiou]\w*) bubble/.test(all), 'a/an before bubble words');
    assert.ok(!/first noticed/.test(all), '"first noticed" after the read is ambiguous about the read window');
    const chat = t.inputs.documents.find(x => x.kind === 'chat').text.split('\n');
    for (const w of world.wells.filter(x => x.via === 'colleague' || x.kind === 'late-denied')) {
      const author = world.docs.find(x => x.series.includes(w.series)).author;
      const names = [w.id, `plate ${w.plate} ${w.pos}`];
      const ans = chat.filter(l => l.includes(`] ${author}: `) && names.some(n => l.includes(n)));
      if (w.status === 'outlier') { confirmed++; assert.ok(ans.some(l => /: (Yes|Confirmed|You're right)/.test(l)), `d${d} ${seed}: ${w.id} confirmed by ${author}`); }
      else { denied++; assert.ok(ans.some(l => /: (No,|I checked: nothing|Not in)/.test(l)), `d${d} ${seed}: ${w.id} denied by ${author}`); }
    }
  }
  assert.ok(confirmed > 20 && denied > 20, `${confirmed} confirmed and ${denied} denied colleague reports`);
  // every clock-time sentence shape is used both for a bubble during the read (excluded) and for one
  // outside it (kept): the times decide, not the words
  const { _timedBubble } = await import('./render.mjs');
  const { rng } = await import('../lib/rng.mjs');
  const r = rng('shapes'), row = { readStart: 600, readMin: 10 };
  for (const mode of ['during', 'before', 'after']) for (let i = 0; i < 300; i++) {
    const text = _timedBubble({ status: 'decoy' }, row, r, mode);
    for (const [shape, re] of Object.entries(SHAPES)) if (re.test(text)) (shapes[shape] ??= new Set()).add(mode === 'during');
  }
  for (const shape of Object.keys(SHAPES)) assert.deepEqual([...(shapes[shape] ?? [])].sort(), [false, true], `shape ${shape}`);
});
