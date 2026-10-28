// Move 2 on composition: tables and the ATTACK.md success/kill reading from the battery's stored rows
// (research/blockers-20261021/move2/runs/*.json, written by move2-battery.mjs). $0, reads JSON only.
// The thresholds below are the ones written before this run (ATTACK.md §6 Move 2 and the composition sweep's X1,
// 2026-10-21/22); none is derived from these results.
//   node experiments/compose/move2-analyze.mjs [--runs research/blockers-20261021/move2/runs] [--out research/blockers-20261021/move2/analysis.json]
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

export function load(dir) {
  const out = {};
  for (const f of readdirSync(dir).filter(x => x.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    out[`${d.subject}.r${d.runtime}`] = d;
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
  // 6. the monolith band: composed losses under crash (M4b) and dup-same (M4d) against the monoliths' range, per world
  for (const f of ['crash', 'dup-same']) for (const seed of SEEDS) {
    const mono = MONOLITHS.flatMap(m => [1, 2].map(rt => loss(docs, m, rt, seed, f))).filter(x => x !== null);
    if (!mono.length) continue;
    const lo = Math.min(...mono), hi = Math.max(...mono);
    const comp = Object.fromEntries(COMPOSED.flatMap(s => [1, 2].map(rt => [`${s}.r${rt}`, loss(docs, s, rt, seed, f)])));
    res.band[`${f}:${seed}`] = { monolith: [lo, hi], composed: comp,
      r2Inside: COMPOSED.filter(s => comp[`${s}.r2`] !== null && comp[`${s}.r2`] <= hi).length, r1Inside: COMPOSED.filter(s => comp[`${s}.r1`] !== null && comp[`${s}.r1`] <= hi).length, n: COMPOSED.length };
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
  return res;
}

/** The ATTACK/X1 success and kill lines, evaluated. */
export function verdicts(res) {
  const r2dupSame = COMPOSED.map(s => res.duplicates[s]?.['r2:dup-same']).filter(Boolean);
  const r1dupSame = COMPOSED.map(s => res.duplicates[s]?.['r1:dup-same']).filter(Boolean);
  const digestsComposed = res.digests.filter(d => COMPOSED.includes(d.subject));
  return {
    'S1 logical duplicates 0 under M4d outside the universal D4 loss (was 61 in COMP-1)': { r1: sum(r1dupSame.map(x => x.duplicates)), r1OutsideD4: sum(r1dupSame.map(x => x.outsideD4)), r2: sum(r2dupSame.map(x => x.duplicates)), r2OutsideD4: sum(r2dupSame.map(x => x.outsideD4)), cells: r2dupSame.length * 3, holds: r2dupSame.length === 6 && sum(r2dupSame.map(x => x.outsideD4)) === 0 },
    'S2 fault-free digests unchanged (logical journal and business rows)': { equal: digestsComposed.filter(d => d.logicalEqual && d.sorTablesEqual).length, of: digestsComposed.length, monoliths: res.digests.filter(d => MONOLITHS.includes(d.subject) && d.logicalEqual && d.sorTablesEqual).length, holds: digestsComposed.length === 18 && digestsComposed.every(d => d.logicalEqual && d.sorTablesEqual) },
    'S3 the distinct-refunds mutant still flagged': { cells: res.mutants.length, flagged: res.mutants.filter(m => m.flagged).length, actedCells: res.mutants.filter(m => m.acts[1] > 0).length, holds: res.mutants.filter(m => m.acts[1] > 0).every(m => m.flagged) && res.mutants.some(m => m.acts[1] > 0) },
    'S4 no single-writer false positive on the three C-H-T manifests (and C-H flagged)': { cht: COMPOSED.filter(s => s.startsWith('cht')).map(s => res.gate[s]?.flagged), ch: COMPOSED.filter(s => !s.startsWith('cht')).map(s => res.gate[s]?.flagged), holds: COMPOSED.filter(s => s.startsWith('cht')).every(s => res.gate[s] && !res.gate[s].flagged) },
    'X1 ch-e8-2 crash within 3 cases of fault-free on all three worlds': { r1: res.crashCollapse['ch-e8-2.r1'], r2: res.crashCollapse['ch-e8-2.r2'], holds: !!res.crashCollapse['ch-e8-2.r2']?.within3 },
    'X1 identity-conflict findings 0 on every fault-free run': { count: res.identityConflictsFaultFree, holds: res.identityConflictsFaultFree === 0 },
    'X1 universal M4d loss on 1161 unchanged (D4 not claimed)': { d4: res.d4[1161]?.universal.length, composedR2Loss1161: COMPOSED.map(s => res.band['dup-same:1161']?.composed[`${s}.r2`]) },
    'Move 2 COMP M4b/M4d within the monolith band': Object.fromEntries(Object.entries(res.band).map(([k, v]) => [k, { monolith: v.monolith, r1Inside: `${v.r1Inside}/${v.n}`, r2Inside: `${v.r2Inside}/${v.n}` }])),
    'M4a restart journal identical under runtime 2': { identical: res.restart.filter(r => r.sameJournal).length, of: res.restart.length },
  };
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(ROOT, arg('--runs', 'research/blockers-20261021/move2/runs'));
  if (!existsSync(dir)) throw new Error(`no battery output at ${dir}`);
  const res = analyse(load(dir));
  const v = verdicts(res);
  const out = path.resolve(ROOT, arg('--out', 'research/blockers-20261021/move2/analysis.json'));
  writeFileSync(out, JSON.stringify({ evidence: 'development (dev worlds 1161/1162/1164), $0, runtime2 vs frozen runtime1; D28(3)', verdicts: v, ...res }, null, 1));
  console.log(JSON.stringify(v, null, 1));
}
