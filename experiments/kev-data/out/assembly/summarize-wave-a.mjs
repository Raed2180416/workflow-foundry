// Small, text-free manifest of the wave-A builds (counts, hashes, token stats, audit verdicts) for experiments/kev-data/out/.
//   node experiments/kev-data/out/assembly/summarize-wave-a.mjs <summaries dir> <audit.json> <out.json>
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const [sumDir, auditFile, outFile] = process.argv.slice(2);
const audit = existsSync(auditFile) ? JSON.parse(readFileSync(auditFile, 'utf8')) : null;
const groups = readdirSync(sumDir).filter(f => f.endsWith('.json') && !f.includes('.registry')).map(f => JSON.parse(readFileSync(path.join(sumDir, f), 'utf8')));
// F1's solve/failures.mjs solveF1 is a state-only RULE (its test requires > 50% coverage; collision groups carry soft targets), not a
// decidability solver: reported, not gated (§2.7 step 1: ports not expected to be code-solvable rely on steps 2 and 6)
const DIAGNOSTIC_SOLVER = new Set(['F1']);
const port = pk => pk.split(':')[0];
const GATE = { accuracyDecided: 0.995, coverage: 0.99, maskedShare: 0.01 };
const out = { schema: 'kev-data/wave-a-dev-manifest@1', status: 'DEVELOPMENT build (authored OOD lines pending the two-model filter; assembly stand-in)', gate: GATE, groups: {}, ports: {} };
for (const s of groups) {
  const g = out.groups[s.group] = { buildId: s.buildId, dir: s.dir, error: s.error, ms: s.ms, jobMaxState: s.jobMaxState, registry: s.registry, assembly: s.assembly, slices: {} };
  if (!s.slicesOut) continue;
  const m = JSON.parse(readFileSync(path.join(s.dir, 'manifest.json'), 'utf8'));
  g.bedPin = m.beds.pin; g.spec = m.spec.hash; g.kev = m.kev; g.heldout = m.config.heldoutWordings;
  for (const [slice, x] of Object.entries(m.slices)) {
    const maxTok = Math.max(0, ...Object.values(x.perPort).map(p => p.stateTokens?.max ?? 0));
    g.slices[slice] = { records: x.records, questions: x.questions, worlds: x.worlds, unknowableSource: x.unknowable, dropped: x.dropped, positionCheck: x.positionCheck,
      kev: { path: path.join(s.dir, x.files.kev.path), sha256: x.files.kev.sha256 }, meta: { path: path.join(s.dir, x.files.meta.path), sha256: x.files.meta.sha256 },
      maxStateTokens: maxTok, fits384: maxTok <= 384,
      perPort: Object.fromEntries(Object.entries(x.perPort).map(([p, y]) => [p, { records: y.records, questions: y.questions, labels: y.labels, stateTokens: y.stateTokens }])) };
  }
}
// port verdicts from the audit (step 1 where a solver exists, step 2 everywhere, step 3)
if (audit) for (const [group, b] of Object.entries(audit.builds)) for (const [slice, x] of Object.entries(b.slices)) for (const [pk, y] of Object.entries(x.ports)) {
  const v = (out.ports[pk] ??= { group, slices: {}, failures: [] });
  const s1 = y.step1, fails = [];
  const diag = DIAGNOSTIC_SOLVER.has(port(pk));
  if (s1 && !diag && s1.decided && s1.accuracyDecided < GATE.accuracyDecided) fails.push(`step1 accuracy ${s1.accuracyDecided.toFixed(4)}`);
  if (s1 && !diag && s1.n >= 20 && s1.coverage < GATE.coverage && !Object.keys(s1.reasons).every(r => r.startsWith('authored-line'))) fails.push(`step1 coverage ${s1.coverage.toFixed(3)}`);
  if (y.step2.exactMultiLabel > 0) fails.push(`step2 exact collisions ${y.step2.exactMultiLabel}`);
  if (y.step2.groups >= 100 && y.step2.nameMaskedShare >= GATE.maskedShare) fails.push(`step2 name-masked collisions ${(y.step2.nameMaskedShare * 100).toFixed(2)}%`);
  if (y.step3.undeclaredKeys.length) fails.push(`step3 undeclared keys ${y.step3.undeclaredKeys.join(',')}`);
  v.slices[slice] = { rows: y.rows, soft: y.soft, step1: s1 && { n: s1.n, coverage: s1.coverage, accuracyDecided: s1.accuracyDecided, reasons: s1.reasons, gated: !diag }, step2: y.step2, minFormsPerLabel: Math.min(...Object.values(y.formsPerLabel)), fails };
  for (const f of fails) v.failures.push(`${slice}: ${f}`);
}
if (audit) { out.leakage = { crossBuildStateOverlaps: audit.crossBuild.stateOverlaps, finalRegistry: audit.registry,
  perSlice: Object.fromEntries(Object.entries(audit.builds).flatMap(([g, b]) => Object.entries(b.slices).map(([s, x]) => [`${g}/${s}`, { forbiddenKeyRecords: x.forbiddenKeyRecords, registryHitsTrainLike: x.registryHitsTrainLike, heldoutWordingOutsideSlice: x.heldoutWordingOutsideSlice }]))) }; }
writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${outFile}`);
