// One-time additive source/fixture freeze. Never overwrites v1 or an existing v2 freeze.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyFreeze as verifyV1 } from '../oracle.mjs';
import { loadSuite, validateFixtures, PUBLIC_V2_RULES, PUBLICATION_POLICY } from '../oracle-v2.mjs';
import { digest } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here), independent = path.join(root, '../benchmark-independent');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const v1 = verifyV1();
const additional = [
  path.join(root, 'FREEZE.json'), path.join(root, 'oracle-v2.mjs'), path.join(root, 'supplied.mjs'),
  path.join(root, 'calibration-001/AUDIT.json'), fileURLToPath(import.meta.url), path.join(here, 'check.mjs'),
  ...['NOTE.md', 'AUDIT.json', 'check.mjs', 'PRE_REVIEW.json'].map(name => path.join(independent, name)),
];
const witnesses = ['early-confirmation', 'early-confirmation-counterfactual', 'observed-positive-control',
  'raw-invalid-reproduction-confirmed', 'raw-invalid-screen', 'reproduction-before-screen',
  'single-screen-error', 'failure-isolation', 'missing-evidence-inconclusive'];
for (const witness of witnesses) for (const file of ['WORKFLOW.json', 'SUITE.json', 'RESULT.json', 'TRACE-0.json', 'LOG-0.json', 'RUN-0.json']) {
  additional.push(path.join(independent, 'run-001', witness, file));
}
const paths = [...new Set([...v1.files.map(file => file.path), ...additional])];
const freeze = {
  schemaVersion: 'sample-consequence-freeze-v2', frozenAt: new Date().toISOString(),
  status: 'FROZEN_BEFORE_V2_CALIBRATION', externalModelCallsByThisTask: 0,
  campaignModelState: 'Reported by prime; this evaluator author has made no provider calls.',
  registryHash: v1.registryHash, nodeVersion: process.version,
  v1FreezeSha256: hash(path.join(root, 'FREEZE.json')),
  independentReview: { path: path.join(independent, 'NOTE.md'), sha256: hash(path.join(independent, 'NOTE.md')) },
  publicAddendum: PUBLIC_V2_RULES, publicationPolicy: PUBLICATION_POLICY,
  publicationPolicyHash: digest(PUBLICATION_POLICY),
  fixtureValidation: Object.fromEntries(['development', 'sealed'].map(split => [split, validateFixtures(loadSuite(split))])),
  calibrationPlan: { suppliedPositives: 2, originalMutants: 6, independentWitnesses: witnesses,
    extraChecks: ['overlapping instruments', 'all-status timing diagnostic', 'log ordinal forgery', 'event tampering', 'Generator and TrialRunner integration'] },
  disclosure: 'F1/F2 are exposed development findings. Sealed scenarios remain fixed and provider-hidden only when withheld by the campaign. No population or causal-use claim.',
  files: paths.map(file => ({ path: file, sha256: hash(file) })),
};
const destination = path.join(root, 'FREEZE_V2.json');
writeFileSync(destination, JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ path: destination, sha256: hash(destination), files: freeze.files.length,
  fixtureValidation: freeze.fixtureValidation, independentReviewSha256: freeze.independentReview.sha256 }, null, 2));
