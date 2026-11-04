// Move 2 on composition: tables and the ATTACK.md success/kill reading from the battery's stored rows
// (research/blockers-20261021/move2/runs/*.json, written by move2-battery.mjs). $0, reads JSON only.
// The thresholds are ATTACK.md §6 Move 2's and the composition sweep's X1 (2026-10-21/22). This file was first
// committed (2026-10-28 18:56) after the r1/r2 rows of ch-e8-1 and cht-e8-1 and the r1 rows of ch-e8-2 and cht-e8-2
// existed, and before any monolith row, so the monolith band could not be tuned to the rows it is read against.
// Review of 2026-11-04 (D3-D5): S1 is a mechanism check, circular by construction (the registry mirrors identityOf,
// duplicates are counted with identityOf, and the host deduplicates any resolved identity); the non-circular readouts are
// case loss against the monolith band (graded by the E8 oracle) and the key-free business rows. The band is computed
// like for like (composed and monoliths under the same runtime) and against the frozen runtime's monoliths alone, each
// with a computed `holds`. ATTACK's Move 2 kill lines need Move 1's Δ* and the replay gate, so they are reported as not
// evaluated; the composition analogue is labelled as such.
//   node experiments/compose/move2-analyze.mjs [--runs dir[,dir2...]] [--out research/blockers-20261021/move2/analysis.json]
// With several run directories, a later one supersedes an earlier one cell by cell (subject, runtime, world, fault);
// every cell keeps the runtime2 sha256 it ran under (`provenance`).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProgram } from './bundle.mjs';
import { singleWriterProblems } from './runtime2.mjs';
import { E8_REGISTRY } from './bundle2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
export const COMPOSED = ['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3'];
export const MONOLITHS = ['b1lh-e8-1', 'b1nh-e8-2', 'b1nh-e8-3'];
export const SEEDS = [1161, 1162, 1164];

export function load(dirs) {
  const out = {};
  for (const dir of [].concat(dirs)) {
    for (const f of readdirSync(dir).filter(x => x.endsWith('.json'))) {
      const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const rt2 = d.harness?.['experiments/compose/runtime2.mjs']?.slice(0, 8) ?? null;
      const rows = d.results.map(r => ({ ...r, provenance: r.provenance ?? { dir: path.basename(dir), runtime2: d.runtime === 2 ? rt2 : null } }));
      const k = `${d.subject}.r${d.runtime}`;
      if (!out[k]) { out[k] = { ...d, results: rows }; continue; }
      const keep = out[k].results.filter(r => !rows.some(n => n.seed === r.seed && n.fault === r.fault));
      out[k] = { ...out[k], results: [...keep, ...rows] };
    }
  }
  return out;
}
const cell = (docs, label, rt, seed, fault) => docs[`${label}.r${rt}`]?.results.find(r => r.seed === seed && r.fault === fault) ?? null;
const loss = (docs, label, rt, seed, fault) => { const a = cell(docs, label, rt, seed, 'none'), b = cell(docs, label, rt, seed, fault); return a && b ? a.oracle.passed - b.oracle.passed : null; };
const sum = xs => xs.reduce((a, b) => a + (b ?? 0), 0);

export function analyse(docs) {
  const subjects = [...COMPOSED, ...MONOLITHS];
  const res = { faultTable: [], digests: [], restart: [], duplicates: {}, d4: {}, crashCollapse: {}, band: {}, gate: {}, fixes: [], mutants: [], findings: {}, carry: {}, armErrors: [] };
  // 1. the fault table (passed/completed, loss against the subject's own fault-free run, duplicates)
  for (const s of subjects) for (const rt of [1, 2]) for (const seed of SEEDS) for (const f of ['none', 'restart', 'crash', 'dup-delayed', 'dup-same', 'downstream']) {
    const c = cell(docs, s, rt, seed, f);
    if (!c) continue;
    res.faultTable.push({ subject: s, runtime: rt, seed, fault: f, passed: c.oracle.passed, completed: c.oracle.completed, lossVsNone: f === 'none' ? 0 : loss(docs, s, rt, seed, f),
      critical: c.oracle.critical, dup: c.exactlyOnce.duplicates, money: c.exactlyOnce.money, keyConflicts: c.exactlyOnce.keyConflicts, comp: `${c.compensation.complete}/${c.compensation.due}`,
      env: c.envelope.byCode, hostDeduped: c.hostDeduped, armErrors: c.armErrors });
    if (c.armErrors) res.armErrors.push({ subject: s, runtime: rt, seed, fault: f, armErrors: c.armErrors });
  }
  // 2. transparency: fault-free journals equal modulo key spelling, and the same business rows at the end
  for (const s of subjects) for (const seed of SEEDS) {
    const a = cell(docs, s, 1, seed, 'none'), b = cell(docs, s, 2, seed, 'none');
    if (!a || !b) continue;
    res.digests.push({ subject: s, seed, logicalEqual: a.digest.logical === b.digest.logical, sorTablesEqual: a.digest.sorTables === b.digest.sorTables,
      passingEqual: JSON.stringify(a.passing) === JSON.stringify(b.passing), envFindings: b.envelope.byCode });
  }
  // 3. restart under runtime 2: the journal equals runtime 2's fault-free journal (M4a)
  for (const s of subjects) for (const seed of SEEDS) {
    const a = cell(docs, s, 2, seed, 'none'), b = cell(docs, s, 2, seed, 'restart');
    if (a && b) res.restart.push({ subject: s, seed, sameJournal: a.digest.logical === b.digest.logical });
  }
  // 4. duplicates under dup-same (M4d) and crash (M4b), runtime 1 vs 2; the universal D4 set from runtime 1
  const failing = (s, rt, seed, f) => new Set(cell(docs, s, rt, seed, f)?.failingCases ?? []);
  const lostCases = (s, rt, seed, f) => { const base = new Set(cell(docs, s, rt, seed, 'none')?.passing ?? []); return [...failing(s, rt, seed, f)].filter(c => base.has(c)); };
  for (const seed of SEEDS) {
    const sets = MONOLITHS.map(m => new Set(lostCases(m, 1, seed, 'dup-same')));
    const universal = sets.length ? [...sets[0]].filter(c => sets.every(x => x.has(c))).sort() : [];
    res.d4[seed] = { universal, monolithLosses: Object.fromEntries(MONOLITHS.map((m, i) => [m, [...sets[i]].sort()])) };
  }
  for (const s of subjects) {
    const row = {};
    for (const rt of [1, 2]) for (const f of ['dup-same', 'crash', 'dup-delayed', 'restart', 'downstream']) {
      const cs = SEEDS.map(seed => cell(docs, s, rt, seed, f)).filter(Boolean);
      if (!cs.length) continue;
      const dupCases = cs.flatMap((c, i) => (c.exactlyOnce.dupCases ?? []).map(x => ({ seed: c.seed, case: x })));
      row[`r${rt}:${f}`] = { worlds: cs.length, duplicates: sum(cs.map(c => c.exactlyOnce.duplicates)), money: sum(cs.map(c => c.exactlyOnce.money)), keyConflicts: sum(cs.map(c => c.exactlyOnce.keyConflicts)),
        outsideD4: dupCases.filter(d => !res.d4[d.seed]?.universal.includes(d.case)).length };
    }
    res.duplicates[s] = row;
  }
  // 5. ch-e8-2 crash collapse (X1: within 3 cases of its fault-free run on all three worlds)
  for (const s of subjects) for (const rt of [1, 2]) {
    const l = SEEDS.map(seed => loss(docs, s, rt, seed, 'crash'));
    if (l.every(x => x !== null)) res.crashCollapse[`${s}.r${rt}`] = { loss: l, within3: l.every(x => x <= 3), critical: SEEDS.map(seed => cell(docs, s, rt, seed, 'crash')?.oracle.critical) };
  }
  // 6. the monolith band: composed losses under crash (M4b) and dup-same (M4d) against the monoliths' range, per world.
  // ATTACK names "the monolith band" without fixing its rows; the three COMP-1 monolith comparator rows are taken here.
  // Two bands, each with a computed `holds` (review D4): like for like (composed rX against monoliths rX; read-back
  // against monoliths with read-back), and the frozen band (monoliths under runtime 1 only), the stricter reading.
  const monoBand = (seed, f, rt, label = m => m) => {
    const xs = MONOLITHS.map(m => loss(docs, label(m), rt, seed, f)).filter(x => x !== null);
    return xs.length === MONOLITHS.length ? [Math.min(...xs), Math.max(...xs)] : null;
  };
  for (const f of ['crash', 'dup-same']) for (const seed of SEEDS) {
    const comp = Object.fromEntries(COMPOSED.flatMap(s => [1, 2].map(rt => [`${s}.r${rt}`, loss(docs, s, rt, seed, f)])));
    for (const s of COMPOSED) { const v = loss(docs, `${s}+readback`, 2, seed, f); if (v !== null) comp[`${s}+readback.r2`] = v; }
    const bands = { r1: monoBand(seed, f, 1), r2: monoBand(seed, f, 2), readback: monoBand(seed, f, 2, m => `${m}+readback`) };
    const inside = (suffix, band) => (band ? COMPOSED.filter(s => comp[`${s}${suffix}`] !== undefined && comp[`${s}${suffix}`] !== null && comp[`${s}${suffix}`] <= band[1]).length : null);
    const present = suffix => COMPOSED.filter(s => comp[`${s}${suffix}`] !== undefined && comp[`${s}${suffix}`] !== null).length;
    res.band[`${f}:${seed}`] = { monolith: bands, composed: comp, n: COMPOSED.length,
      likeForLike: { r1: inside('.r1', bands.r1), r2: inside('.r2', bands.r2), readback: present('+readback.r2') ? inside('+readback.r2', bands.readback) : null },
      frozenBand: { r1: inside('.r1', bands.r1), r2: inside('.r2', bands.r1), readback: present('+readback.r2') ? inside('+readback.r2', bands.r1) : null } };
  }
  // 7. the static single-writer gate on the six manifests
  for (const s of COMPOSED) {
    const p = readProgram(path.join(ROOT, 'research/composition-20261021/runs', s, 'program'));
    const probs = singleWriterProblems(p.manifest, E8_REGISTRY);
    res.gate[s] = { flagged: probs.length > 0, pairs: probs.length, examples: probs.slice(0, 4).map(x => `${x.owners.join(' & ')}: ${x.kinds.join(' / ')}`) };
  }
  // 8. the skeptic's one-line source fixes against the envelope
  for (const [label, base] of [['ch-e8-2+fix-d3', 'ch-e8-2'], ['cht-e8-1+fix-d2', 'cht-e8-1'], ['cht-e8-2+fix-d2', 'cht-e8-2'], ['cht-e8-3+fix-d2', 'cht-e8-3']]) {
    for (const seed of SEEDS) for (const f of ['none', 'crash', 'dup-same']) {
      const row = { label, seed, fault: f };
      for (const [k, s, rt] of [['r1', base, 1], ['r1+fix', label, 1], ['r2', base, 2], ['r2+fix', label, 2]]) {
        const c = cell(docs, s, rt, seed, f);
        row[k] = c ? { passed: c.oracle.passed, completed: c.oracle.completed, dup: c.exactlyOnce.duplicates, crit: c.oracle.critical } : null;
      }
      res.fixes.push(row);
    }
  }
  // 9. the distinct-refunds mutant
  for (const label of ['cht-e8-1+mut-splitrefund', 'b1lh-e8-1+mut-splitrefund']) for (const seed of SEEDS) for (const f of ['none', 'downstream']) {
    const a = cell(docs, label, 1, seed, f), b = cell(docs, label, 2, seed, f);
    if (!a || !b) continue;
    res.mutants.push({ label, seed, fault: f, acts: [a.mutantActs, b.mutantActs], r1: { dup: a.exactlyOnce.duplicates, money: a.exactlyOnce.money, keyConflicts: a.exactlyOnce.keyConflicts },
      r2: { dup: b.exactlyOnce.duplicates, money: b.exactlyOnce.money, keyConflicts: b.exactlyOnce.keyConflicts, identityConflict: b.envelope.byCode['identity-conflict'] ?? 0, hostKeyConflict: b.envelope.byCode['host-key-conflict'] ?? 0 },
      flagged: (b.exactlyOnce.keyConflicts > 0) || (b.envelope.byCode['identity-conflict'] ?? 0) > 0 });
  }
  // 10. envelope findings by fault (runtime 2), identity conflicts on fault-free runs, carry
  for (const s of subjects) for (const seed of SEEDS) for (const f of ['none', 'restart', 'crash', 'dup-delayed', 'dup-same', 'downstream']) {
    const c = cell(docs, s, 2, seed, f);
    if (!c) continue;
    const t = (res.findings[f] ??= {});
    for (const [k, v] of Object.entries(c.envelope.byCode)) t[k] = (t[k] ?? 0) + v;
    const cb = (res.carry[s] ??= { total: 0, envelope: 0 });
    cb.total = Math.max(cb.total, c.carryBytes.total); cb.envelope = Math.max(cb.envelope, c.carryBytes.envelope);
  }
  for (const s of subjects) for (const seed of SEEDS) {
    const c = cell(docs, s, 1, seed, 'none');
    if (c) { const cb = (res.carry[s] ??= { total: 0, envelope: 0 }); cb.r1Total = Math.max(cb.r1Total ?? 0, c.carryBytes.total); }
  }
  res.identityConflictsFaultFree = sum(subjects.flatMap(s => SEEDS.map(seed => cell(docs, s, 2, seed, 'none')?.envelope.byCode['identity-conflict'] ?? 0)));
  // 11. the read-back variant (runtime2 option reconcile): fault-free equal to plain runtime 2; crash losses against both
  res.readback = {};
  for (const s of subjects) {
    const rb = `${s}+readback`;
    if (!docs[`${rb}.r2`]) continue;
    const row = { noneEqual: [], crash: [] };
    for (const seed of SEEDS) {
      const a = cell(docs, s, 2, seed, 'none'), b = cell(docs, rb, 2, seed, 'none');
      if (a && b) row.noneEqual.push(a.digest.logical === b.digest.logical && a.digest.sorTables === b.digest.sorTables);
      const c = cell(docs, rb, 2, seed, 'crash');
      if (c && b) row.crash.push({ seed, r1: loss(docs, s, 1, seed, 'crash'), r2: loss(docs, s, 2, seed, 'crash'), r2rb: b.oracle.passed - c.oracle.passed,
        critical: [cell(docs, s, 1, seed, 'crash')?.oracle.critical, cell(docs, s, 2, seed, 'crash')?.oracle.critical, c.oracle.critical],
        outsideAllowed: [1, 2].map(rt => cell(docs, s, rt, seed, 'crash')?.oracle.codes?.['L2:outside-allowed'] ?? 0).concat([c.oracle.codes?.['L2:outside-allowed'] ?? 0]),
        env: c.envelope.byCode });
    }
    res.readback[s] = row;
  }
  return res;
}

/** The ATTACK/X1 success and kill lines, evaluated. */
export function verdicts(res) {
  const r2dupSame = COMPOSED.map(s => res.duplicates[s]?.['r2:dup-same']).filter(Boolean);
  const r1dupSame = COMPOSED.map(s => res.duplicates[s]?.['r1:dup-same']).filter(Boolean);
  const digestsComposed = res.digests.filter(d => COMPOSED.includes(d.subject));
  const bandCells = Object.values(res.band);
  const bandLine = which => {
    const o = {};
    for (const rt of ['r1', 'r2', 'readback']) {
      const xs = Object.entries(res.band).filter(([, b]) => b[which][rt] !== null && b[which][rt] !== undefined);
      const n = xs.length * COMPOSED.length, v = sum(xs.map(([, b]) => b[which][rt]));
      o[rt] = n ? `${v}/${n}` : 'not run';
      o[`holds_${rt}`] = n ? v === n : null;
      if (n && xs.length < bandCells.length) o[`${rt}_faults`] = [...new Set(xs.map(([k]) => k.split(':')[0]))];
    }
    return o;
  };
  return {
    'S1 [code: mechanism check, circular by construction] logical duplicates 0 under M4d outside the universal D4 loss (was 61 in COMP-1)': { r1: sum(r1dupSame.map(x => x.duplicates)), r1OutsideD4: sum(r1dupSame.map(x => x.outsideD4)), r2: sum(r2dupSame.map(x => x.duplicates)), r2OutsideD4: sum(r2dupSame.map(x => x.outsideD4)), cells: r2dupSame.length * 3, holds: r2dupSame.length === 6 && sum(r2dupSame.map(x => x.outsideD4)) === 0,
      note: 'the registry equals identityOf, the counter uses identityOf, and the host deduplicates any resolved identity: 0 is guaranteed; the non-circular readouts are the band lines and S2' },
    'S2 fault-free digests unchanged (logical journal and business rows)': { equal: digestsComposed.filter(d => d.logicalEqual && d.sorTablesEqual).length, of: digestsComposed.length, monoliths: res.digests.filter(d => MONOLITHS.includes(d.subject) && d.logicalEqual && d.sorTablesEqual).length, holds: digestsComposed.length === 18 && digestsComposed.every(d => d.logicalEqual && d.sorTablesEqual) },
    'S3 the distinct-refunds mutant still flagged': { cells: res.mutants.length, flagged: res.mutants.filter(m => m.flagged).length, actedCells: res.mutants.filter(m => m.acts[1] > 0).length, holds: res.mutants.filter(m => m.acts[1] > 0).every(m => m.flagged) && res.mutants.some(m => m.acts[1] > 0) },
    'S4 no single-writer false positive on the three C-H-T manifests (and C-H flagged)': { cht: COMPOSED.filter(s => s.startsWith('cht')).map(s => res.gate[s]?.flagged), ch: COMPOSED.filter(s => !s.startsWith('cht')).map(s => res.gate[s]?.flagged), holds: COMPOSED.filter(s => s.startsWith('cht')).every(s => res.gate[s] && !res.gate[s].flagged) },
    'X1 ch-e8-2 crash within 3 cases of fault-free on all three worlds': { r1: res.crashCollapse['ch-e8-2.r1'], r2: res.crashCollapse['ch-e8-2.r2'], holds: !!res.crashCollapse['ch-e8-2.r2']?.within3 },
    'X1 identity-conflict findings 0 on every fault-free run': { count: res.identityConflictsFaultFree, holds: res.identityConflictsFaultFree === 0 },
    'X1 universal M4d loss on 1161 unchanged (D4 not claimed)': { d4: res.d4[1161]?.universal.length, composedR2Loss1161: COMPOSED.map(s => res.band['dup-same:1161']?.composed[`${s}.r2`]) },
    'Move 2 COMP M4b/M4d within the monolith band, like for like (non-circular: oracle case loss)': bandLine('likeForLike'),
    'Move 2 COMP M4b/M4d within the monolith band of the frozen runtime (monoliths under r1 only)': bandLine('frozenBand'),
    'Move 2 band per cell': Object.fromEntries(Object.entries(res.band).map(([k, v]) => [k, { monolith: v.monolith, likeForLike: v.likeForLike, frozenBand: v.frozenBand, n: v.n }])),
    'ATTACK Move 2 kill lines (> 1 false refusal on passing worlds; an admitted write that Δ* cannot explain)': { evaluated: false, why: 'they need Move 1\'s Δ* and the replay gate (A1-C v2.1), neither of which exists yet' },
    'Composition analogue of a kill line (not ATTACK\'s): the envelope changes fault-free behaviour, or the gate flags a C-H-T manifest': { crossed: !(digestsComposed.length === 18 && digestsComposed.every(d => d.logicalEqual && d.sorTablesEqual)) || COMPOSED.filter(s => s.startsWith('cht')).some(s => res.gate[s]?.flagged) },
    'M4a restart journal identical under runtime 2': { identical: res.restart.filter(r => r.sameJournal).length, of: res.restart.length },
    'Read-back variant (reconcile): fault-free unchanged, crash losses r1 / r2 / r2+read-back summed over the three worlds': Object.fromEntries(Object.entries(res.readback ?? {}).map(([s, v]) => [s, {
      noneEqual: `${v.noneEqual.filter(Boolean).length}/${v.noneEqual.length}`, crashLoss: [sum(v.crash.map(c => c.r1)), sum(v.crash.map(c => c.r2)), sum(v.crash.map(c => c.r2rb))],
      outsideAllowed: [0, 1, 2].map(i => sum(v.crash.map(c => c.outsideAllowed[i]))) }])),
  };
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = arg('--runs', 'research/blockers-20261021/move2/runs').split(',').map(d => path.resolve(ROOT, d));
  for (const dir of dirs) if (!existsSync(dir)) throw new Error(`no battery output at ${dir}`);
  const res = analyse(load(dirs));
  const v = verdicts(res);
  const out = path.resolve(ROOT, arg('--out', 'research/blockers-20261021/move2/analysis.json'));
  writeFileSync(out, JSON.stringify({ evidence: 'development (dev worlds 1161/1162/1164), $0, runtime2 vs frozen runtime1; D28(3)', runs: dirs.map(d => path.relative(ROOT, d)), verdicts: v, ...res }, null, 1));
  console.log(JSON.stringify(v, null, 1));
}
