// Host CLI. Standard output is aggregate-only even for sealed evaluation.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { aggregate, evaluateCandidate, loadSuite, verifyFreeze } from './oracle.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const [candidatePath, split, outputName] = process.argv.slice(2);
if (!candidatePath || !['development', 'sealed'].includes(split) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(outputName ?? '')) {
  throw new Error('Usage: node run.mjs CANDIDATE.json development|sealed NEW_OUTPUT_NAME');
}
verifyFreeze();
const source = readFileSync(path.resolve(candidatePath));
const parsed = JSON.parse(source.toString('utf8'));
const workflow = parsed.workflow ?? parsed;
const out = path.join(root, outputName);
mkdirSync(out, { mode: 0o700 });
const save = (name, value) => writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
save('CANDIDATE_FREEZE.json', { frozenAt: new Date().toISOString(), sourcePath: path.resolve(candidatePath),
  sourceSha256: createHash('sha256').update(source).digest('hex'), split,
  note: 'Candidate bytes frozen before this evaluation. No provider is invoked.' });
save('candidate.json', workflow);
try {
  const report = await evaluateCandidate(workflow, loadSuite(split), { directory: path.join(out, 'execution') });
  const summary = aggregate(report);
  save('AGGREGATE.json', summary);
  console.log(JSON.stringify({ reportPath: path.join(out, 'execution/REPORT.json'),
    aggregatePath: path.join(out, 'AGGREGATE.json'), ...summary }, null, 2));
  process.exitCode = report.passed ? 0 : 1;
} catch (error) {
  save('FAILURE.json', { code: error.code ?? 'ERROR', message: error.message, details: error.details ?? null });
  console.log(JSON.stringify({ passed: false, errorCode: error.code ?? 'ERROR', evidencePath: out }));
  process.exitCode = 2;
}
