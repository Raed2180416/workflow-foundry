// Tables for research/org-20261021/README.md from the $0 result files (validity.json, regrade.json). Prints markdown.
//   node experiments/constitution/report.mjs [--validity research/org-20261021/runs/validity.json,...] [--regrade research/org-20261021/runs/regrade.json]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const load = f => (existsSync(path.join(ROOT, f)) ? JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')) : null);
const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) ?? 0), 0);
const merge = (xs, f) => xs.reduce((m, x) => { for (const [k, v] of Object.entries(f(x) ?? {})) if (typeof v === 'number') m[k] = (m[k] ?? 0) + v; return m; }, {});
const fmt = o => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || '0';

export function validityTables(files) {
  const rows = files.map(load).filter(Boolean).flatMap(r => r.rows).filter(r => !r.missing);
  const out = ['| run kind | subject | worlds | cases (completed) | oracle critical cases | observer C1 cases | both | disagreements (kinds) |', '|---|---|---|---|---|---|---|---|'];
  const groups = new Map();
  for (const r of rows) { const k = `${r.kind}|${r.subject}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const [k, rs] of groups) {
    const [kind, subject] = k.split('|');
    const crit = sum(rs, r => r.bothCritical + Object.entries(r.byKind).filter(([x]) => x.startsWith('oracle-only')).reduce((s, [, v]) => s + v, 0));
    const obs = sum(rs, r => r.bothCritical + Object.entries(r.byKind).filter(([x]) => x.startsWith('observer-only')).reduce((s, [, v]) => s + v, 0));
    out.push(`| ${kind} | ${subject} | ${rs.length} | ${sum(rs, r => r.cases)} (${sum(rs, r => r.completed.cases)}) | ${crit} | ${obs} | ${sum(rs, r => r.bothCritical)} | ${sum(rs, r => r.disagreements)}${sum(rs, r => r.disagreements) ? ` (${fmt(merge(rs, r => r.byKind))})` : ''} |`);
  }
  const prog = rows.filter(r => r.kind === 'program');
  const storedMismatch = prog.filter(r => r.stored && (r.stored.passed !== r.oracle.passed || r.stored.completed !== r.oracle.completed || r.stored.critical !== r.oracle.critical));
  return { table: out.join('\n'), totals: { runs: rows.length, cases: sum(rows, r => r.cases), both: sum(rows, r => r.bothCritical), disagreements: sum(rows, r => r.disagreements), byKind: merge(rows, r => r.byKind) },
    storedMismatch: storedMismatch.map(r => `${r.subject} ${r.world}`), reruns: prog.length };
}

export function regradeTables(file) {
  const R = load(file);
  if (!R) return null;
  const sized = r => r.world.endsWith('-s12');
  const out = [];
  const lineages = [...new Set(R.rows.map(r => r.lineage))];
  const arms = ['base', 'W-blind', 'W-S', 'G'].filter(a => R.rows.some(r => r.arm === a));
  for (const scope of ['full', 'sized']) {
    out.push(`\n**${scope === 'full' ? '9 full worlds (1232-1234 × d2, d3, d5)' : 'Sized world 1232 d2 size 12 (the 14 shared cases)'}**\n`);
    out.push('| lineage | arm | E8 oracle | E8 + C2 overlay (declared) | same, wide (post-hoc) | C1 | C2 violations (refunds above pinned T; compliant) | C3 violations | unpinned runs (governed) | stale window (handled under T₁ / band orders) | interventions | arm errors |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const l of lineages) for (const a of arms) {
      const rs = R.rows.filter(r => r.lineage === l && r.arm === a && (scope === 'sized' ? sized(r) : !sized(r)));
      if (!rs.length) continue;
      const e8 = `${sum(rs, r => r.e8.passed)}/${sum(rs, r => r.e8.completed)}`;
      const ov = a === 'base' ? '–' : `${sum(rs, r => r.overlay.passed)}/${sum(rs, r => r.overlay.completed)}`;
      const ow = a === 'base' || !rs[0].overlayWidePostHoc ? '–' : `${sum(rs, r => r.overlayWidePostHoc.passed)}/${sum(rs, r => r.overlayWidePostHoc.completed)}`;
      if (a === 'base') { out.push(`| ${l} | base (no overlay) | ${e8} | – | – | – | – | – | – | – | – | ${sum(rs, r => r.armErrors)} |`); continue; }
      const o = rs.map(r => r.observer);
      const c2 = merge(o, x => ({ ...x.C2, refundsAboveT: 0, compliant: 0, exceptions: 0 }));
      const c3 = merge(o, x => ({ ...x.C3, unpinnedRuns: 0, unpinnedGovernedRuns: 0 }));
      const iv = rs[0].interventions ? merge(rs, r => ({ holds: r.interventions.holds, released: r.interventions.released, open: r.interventions.openAtHorizon, reAsks: r.interventions.reAsks,
        breakGlass: r.interventions.breakGlass, abandoned: r.interventions.abandoned, verified: r.interventions.verified, closeDeferred: r.interventions.closeDeferred, mergeWithHold: r.interventions.mergeWithHold })) : null;
      out.push(`| ${l} | ${a} | ${e8} | ${ov} | ${ow} | ${fmt(merge(o, x => x.C1))} | ${fmt(c2)} (${sum(o, x => x.C2.refundsAboveT)}; ${sum(o, x => x.C2.compliant)}) | ${fmt(c3)} | ${sum(o, x => x.C3.unpinnedRuns)} (${sum(o, x => x.C3.unpinnedGovernedRuns)}) | `
        + `${sum(o, x => x.staleWindow.handledUnderT1)}/${sum(o, x => x.staleWindow.orders)} | ${iv ? fmt(iv) : '–'} | ${sum(rs, r => r.armErrors)} |`);
    }
  }
  // Invisibility: W-blind's E8 verdicts equal base's, case for case.
  const inv = [];
  for (const l of lineages) for (const w of [...new Set(R.rows.map(r => r.world))]) {
    const b = R.rows.find(r => r.lineage === l && r.world === w && r.arm === 'base'), x = R.rows.find(r => r.lineage === l && r.world === w && r.arm === 'W-blind');
    if (b && x && (b.e8.passed !== x.e8.passed || b.e8.completed !== x.e8.completed || JSON.stringify(b.e8.failing) !== JSON.stringify(x.e8.failing))) inv.push(`${l} ${w}`);
  }
  // Auditor (sized world).
  const aud = ['| lineage | arm | evidence | Q1 versions | Q2 constitution | Q3 refunds above T | Q4 interventions | Q5 pin mismatches | walkthrough |', '|---|---|---|---|---|---|---|---|---|'];
  for (const l of lineages) for (const a of arms.filter(x => x !== 'base')) {
    const r = R.rows.find(x => x.lineage === l && x.arm === a && sized(x));
    if (!r?.auditor) continue;
    for (const [k, c] of Object.entries(r.auditor)) {
      const p = q => (c.pass[q] === true ? 'pass' : c.pass[q] === 'n/a' ? 'n/a' : 'FAIL');
      aud.push(`| ${l} | ${a} | ${k === 'today' ? "today's journal" : 'host journal + registry'} | ${p('Q1')} | ${p('Q2')} | ${p('Q3')} | ${p('Q4')} | ${p('Q5')} | ${c.walkthrough} |`);
    }
  }
  const audFull = {};
  for (const r of R.rows.filter(x => !sized(x) && x.auditor)) for (const [k, c] of Object.entries(r.auditor)) {
    const key = `${r.arm}/${k}`; audFull[key] ??= { runs: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, Q5: 0, walk: 0, walkN: 0 };
    const A = audFull[key]; A.runs += 1;
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']) if (c.pass[q] === true) A[q] += 1;
    const [p, n] = c.walkthrough.split('/').map(Number); A.walk += p; A.walkN += n;
  }
  return { tables: out.join('\n'), invisibilityBreaks: inv, auditor: aud.join('\n'), auditorFull: audFull, registry: R.registry };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = validityTables(arg('--validity', 'research/org-20261021/runs/validity.json,research/org-20261021/runs/validity-b1h.json').split(','));
  console.log('## Observer validity\n'); console.log(v.table); console.log(`\ntotals: ${JSON.stringify(v.totals)}; re-runs of graded programs: ${v.reruns}; differing from stored results: ${v.storedMismatch.join(', ') || 'none'}`);
  const g = regradeTables(arg('--regrade', 'research/org-20261021/runs/regrade.json'));
  if (g) {
    console.log('\n## Re-grading\n'); console.log(g.tables);
    console.log(`\ninvisibility breaks (W-blind E8 verdicts differing from base): ${g.invisibilityBreaks.join(', ') || 'none'}`);
    console.log('\n## Auditor (sized world)\n'); console.log(g.auditor);
    console.log('\n## Auditor (full worlds, queries passed / runs)\n'); console.log(JSON.stringify(g.auditorFull, null, 1));
  }
}
