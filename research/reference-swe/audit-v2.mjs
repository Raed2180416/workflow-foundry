// Post-run audit only. This file never participates in candidate construction,
// execution, or the oracle; run it only after the immutable campaign is closed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readlinkSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const sha = value => createHash('sha256').update(value).digest('hex');
const load = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, object) => writeFileSync(file, JSON.stringify(object, null, 2) + '\n', { flag: 'wx', mode: 0o400 });

export function auditRevision(directory) {
  const failures = [];
  const check = (label, fn) => { try { fn(); } catch (error) { failures.push({ label, error: error.message }); } };
  const result = load(path.join(directory, 'result-v2.json'));
  const frozen = load(path.join(directory, 'freeze-v2.json'));
  const records = load(path.join(directory, 'SHA256SUMS.json'));
  const closure = load(path.join(directory, 'closure.json'));
  const oldDir = path.join(HERE, 'runs/20260913-reference-01');
  const old = load(path.join(oldDir, 'SHA256SUMS.json'));
  for (const [relative, expected] of Object.entries(records)) check(`new artifact ${relative}`, () => assert.equal(sha(readFileSync(path.join(directory, relative))), expected));
  for (const [relative, expected] of Object.entries(old)) check(`historical artifact ${relative}`, () => assert.equal(sha(readFileSync(path.join(oldDir, relative))), expected));
  for (const [relative, expected] of Object.entries(closure)) check(`closure ${relative}`, () => {
    const file = path.join(directory, 'snapshot', relative);
    if (expected.link) assert.equal(readlinkSync(file), expected.link);
    else assert.equal(sha(readFileSync(file)), expected.sha256);
  });
  check('closure identity', () => assert.equal(sha(readFileSync(path.join(directory, 'closure.json'))), frozen.closureHash));
  check('freeze binding', () => assert.equal(result.freezeHash, sha(readFileSync(path.join(directory, 'freeze-v2.json')))));
  check('source stable', () => assert.equal(result.sourceStable, true));
  const candidate = load(path.join(directory, 'candidate-workflow.json'));
  const settings = load(path.join(directory, 'sealed-settings.json'));
  const attempt = result.construction.attempts.find(x => x.constructionPassed && x.mutationControlsPassed);
  const job = load(path.join(directory, `architecture-${attempt.attempt}/job.json`));
  const generatedDir = path.join(directory, 'foundry/.foundry/generation', job.id);
  const response = load(path.join(generatedDir, '01/response.json'));
  const body = response.text.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '');
  check('candidate not hand-patched', () => assert.deepEqual(candidate, JSON.parse(body).workflow));
  check('generator stayed unqualified', () => assert.equal(job.deploymentQualified, false));
  const context = load(path.join(generatedDir, 'context.json'));
  const architectPrompt = readFileSync(path.join(generatedDir, '01/prompt.txt'), 'utf8');
  const leakage = settings.tasks.map(task => ({ task: task.id, functionNameAbsent: !architectPrompt.includes(task.fn),
    descriptionAbsent: !architectPrompt.includes(task.description), hiddenCasesAbsent: !architectPrompt.includes(JSON.stringify(task.hidden)) }));
  check('architect task separation', () => assert.ok(leakage.every(x => x.functionNameAbsent && x.descriptionAbsent && x.hiddenCasesAbsent)));
  const selectedSkills = context.skills.map(skill => {
    const file = path.join(directory, 'snapshot/skills', skill.name, 'SKILL.md');
    check(`selected skill ${skill.name}`, () => assert.equal(skill.text, readFileSync(file, 'utf8')));
    return { name: skill.name, sha256: sha(skill.text) };
  });
  const promptPairs = {}, arms = [];
  for (const task of settings.tasks) {
    const pair = {};
    for (const arm of ['reference', 'foundry']) {
      const dir = path.join(directory, `${task.id}-${arm}`);
      if (!existsSync(path.join(dir, 'outcome.json'))) { pair[arm] = null; continue; }
      const outcome = load(path.join(dir, 'outcome.json'));
      pair[arm] = sha(readFileSync(path.join(dir, 'call-1/prompt.txt')));
      const operations = readdirSync(dir).filter(n => /^operation-\d+\.json$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).map(name => load(path.join(dir, name)).action.op);
      const exports = result.providerEvidence.completed.filter(x => x.directory.startsWith(`${task.id}-${arm}/`));
      check(`${task.id}/${arm} call budget`, () => assert.ok(outcome.calls <= 5));
      check(`${task.id}/${arm} source binding`, () => assert.equal(outcome.closureHash, frozen.closureHash));
      check(`${task.id}/${arm} candidate integrity`, () => assert.equal(outcome.candidateHash, sha(readFileSync(path.join(dir, 'candidate.py')))));
      let nativeIterations = null;
      if (arm === 'reference') {
        const record = load(path.join(dir, 'original-agent.json'));
        if (record.result?.trajectory) {
          check(`${task.id}/original class`, () => assert.equal(record.result.trajectory.info.config.agent_type, 'minisweagent.agents.default.DefaultAgent'));
          check(`${task.id}/original calls`, () => assert.equal(record.result.trajectory.info.model_stats.api_calls, outcome.calls));
        }
      } else {
        const run = load(path.join(dir, 'native-run.json'));
        nativeIterations = run.outputs[candidate.nodes[0].id]?.iterations ?? null;
        if (run.status === 'succeeded') check(`${task.id}/native iterations`, () => assert.equal(nativeIterations, outcome.calls));
      }
      const hidden = load(path.join(dir, 'hidden.json'));
      check(`${task.id}/${arm} sandbox`, () => {
        assert.equal(hidden.processResult.command, '/usr/bin/bwrap');
        assert.ok(hidden.processResult.args.includes('--unshare-all'));
        assert.ok(hidden.processResult.args.includes('--cpu=2'));
      });
      arms.push({ ...outcome, operations, nativeIterations, completedModelExports: exports.length,
        modelGenerationMs: exports.reduce((sum, call) => sum + call.elapsedMs, 0),
        reportedCost: exports.reduce((sum, call) => sum + call.reportedCost, 0),
        tokens: exports.map(call => call.tokens) });
    }
    pair.identical = pair.reference !== null && pair.reference === pair.foundry;
    check(`${task.id} initial prompts match`, () => assert.equal(pair.identical, true));
    promptPairs[task.id] = pair;
  }
  const liveSourceChanged = Object.entries(closure).filter(([relative, entry]) => {
    if (!/^(src\/|skills\/|schemas\/|package)/.test(relative) || !entry.sha256) return false;
    try { return sha(readFileSync(path.join(ROOT, relative))) !== entry.sha256; } catch { return true; }
  }).map(([relative]) => relative);
  const audit = { auditedAt: new Date().toISOString(), mode: 'post-run independent artifact reconciliation; no new model calls',
    run: path.relative(ROOT, directory), sourceIdentity: frozen, manifestHash: sha(readFileSync(path.join(directory, 'SHA256SUMS.json'))),
    auditedNewArtifacts: Object.keys(records).length, auditedHistoricalArtifacts: Object.keys(old).length,
    candidateFileHash: sha(readFileSync(path.join(directory, 'candidate-workflow.json'))), candidateUnmodified: !failures.some(x => x.label === 'candidate not hand-patched'),
    construction: result.construction, selectedSkills, architectSeparation: leakage, promptPairs, arms,
    completedModelExports: result.providerEvidence.completed.length, providerUnavailable: result.providerEvidence.unavailable,
    providerInvalid: result.providerEvidence.invalid, liveSourceChanged, frozenSourceStable: result.sourceStable,
    failures, auditPassed: failures.length === 0,
    qualification: 'Reported per-task outcomes only; construction receipts remain partial, no product or deployment parity' };
  return audit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output) throw Error('Usage: audit-v2.mjs SEALED_RUN NEW_AUDIT_JSON');
  const audit = auditRevision(path.resolve(directory)); write(path.resolve(output), audit);
  console.log(JSON.stringify({ auditPassed: audit.auditPassed, artifacts: audit.auditedNewArtifacts, historical: audit.auditedHistoricalArtifacts,
    completedModelExports: audit.completedModelExports, failures: audit.failures, arms: audit.arms.map(({ task, arm, calls, success, classification, passedCases, totalCases }) => ({ task, arm, calls, success, classification, passedCases, totalCases })) }));
}
