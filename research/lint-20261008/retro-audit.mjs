// Retro-audit of the strict construction lint over the C0 dev artifacts and the hand-written records-v3 workflow.
//   node research/lint-20261008/retro-audit.mjs [--out research/lint-20261008/retro-audit.json]
// CAVEAT (review synthesis, mutation check): the lint rules were written from these very artifacts, so a rule firing here
// is a description of the artifact, not evidence that the rule predicts failures. Firing is expected and is the point.
// Also recomputes, for the 96 C0 dev trial rows (experiments/runs/c0-dev/results.jsonl, read only), what the run verdict of each
// F trial would be under the new verdict rules. That is a static re-derivation from the stored workflow, not a rerun.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkflow } from '../../src/validate.mjs';
import { verdictOf } from '../../src/verdict.mjs';
import { createDefaultRegistry } from '../../src/capabilities.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { buildRecordsV3Workflow } from '../../experiments/workflows/records-v3.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifacts = path.join(root, 'research/construction-20261006/artifacts');
const registry = createDefaultRegistry(), modelPolicy = loadPolicy();
const targets = readdirSync(artifacts).filter(name => name.startsWith('F-')).sort()
  .map(name => ({ name, workflow: JSON.parse(readFileSync(path.join(artifacts, name, 'workflow.json'), 'utf8')) }));
targets.push({ name: 'records-v3 (hand, buildRecordsV3Workflow())', workflow: buildRecordsV3Workflow() });

const report = targets.map(({ name, workflow }) => {
  const plain = validateWorkflow(workflow, { registry, modelPolicy });
  const strict = validateWorkflow(workflow, { registry, modelPolicy, strict: true });
  return { workflow: name, plainValid: plain.valid, plainWarningCodes: plain.warnings.map(w => w.code), strictValid: strict.valid, acceptance: strict.lint.acceptance.grade,
    counts: strict.lint.counts, codes: strict.lint.codes, findings: strict.lint.findings.map(f => ({ code: f.code, severity: f.severity, path: f.path, ...(f.details?.missing ? { missing: f.details.missing } : {}) })) };
});

// What the stored C0 dev trials would have been told.
const rows = readFileSync(path.join(root, 'experiments/runs/c0-dev/results.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const fRows = rows.filter(r => r.arm.startsWith('F-'));
const byArm = {};
for (const r of fRows) {
  const artifact = targets.find(t => t.name === `${r.arm}-${r.family}-k1`)?.workflow;
  const after = verdictOf({ status: r.meta.status }, { workflow: artifact }).verdict;
  const key = r.arm + ' ' + r.family;
  const cell = byArm[key] ??= { trials: 0, oraclePass: 0, verdictBefore: {}, verdictAfter: {}, falsePassBefore: 0, falsePassAfter: 0 };
  cell.trials++; cell.oraclePass += r.pass ? 1 : 0;
  cell.verdictBefore[r.meta.verdict] = (cell.verdictBefore[r.meta.verdict] ?? 0) + 1;
  cell.verdictAfter[after] = (cell.verdictAfter[after] ?? 0) + 1;
  if (r.meta.verdict === 'pass' && !r.pass) cell.falsePassBefore++;
  if (after === 'pass' && !r.pass) cell.falsePassAfter++;
}
const total = key => Object.values(byArm).reduce((n, c) => n + (c[key] ?? 0), 0);
const sum = key => Object.values(byArm).reduce((acc, c) => { for (const [k, v] of Object.entries(c[key])) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
const trials = { rows: fRows.length, oraclePass: total('oraclePass'), verdictBefore: sum('verdictBefore'), verdictAfter: sum('verdictAfter'), falsePassBefore: total('falsePassBefore'), falsePassAfter: total('falsePassAfter'), byArm };

const out = { generatedFor: 'strict-construction/1', lintOver: report, c0DevFTrials: trials };
const outFlag = process.argv.indexOf('--out');
if (outFlag > 0) writeFileSync(path.resolve(process.argv[outFlag + 1]), JSON.stringify(out, null, 2) + '\n');
else process.stdout.write(JSON.stringify(out, null, 2) + '\n');
