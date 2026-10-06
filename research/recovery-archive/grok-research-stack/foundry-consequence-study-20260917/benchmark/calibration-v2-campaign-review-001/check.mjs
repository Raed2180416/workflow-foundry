// Saved-evidence review only. No Runtime, generator, provider, or writable Store.
// Usage: node check.mjs run-001; choose a fresh output name for a later review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { digest } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
import { validateData, validateWorkflow } from '/home/raed/Projects/workflow-foundry/src/validate.mjs';
import { engineHash } from '/home/raed/Projects/workflow-foundry/src/engine.mjs';
import { registryFactory } from '../capabilities.mjs';
import { verifyFreeze, loadSuite, evaluatorId, aggregate, auditInstruments, PUBLICATION_POLICY } from '../oracle-v2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE), STUDY = path.dirname(BENCH);
const CAMPAIGN = path.join(BENCH, 'campaign-cos-001');
const label = process.argv[2] ?? 'run-001';
assert.match(label, /^run-\d{3}$/);
const OUT = path.join(HERE, label);
fs.mkdirSync(OUT, { mode: 0o700 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = new Map(), checks = [], sections = {};
function bytes(file) {
  const value = fs.readFileSync(file), stat = fs.statSync(file);
  const entry = { path: file, bytes: value.length, sha256: sha(value), mtime: stat.mtime.toISOString() };
  if (inputs.has(file)) assert.equal(entry.sha256, inputs.get(file).sha256, 'Input changed during review');
  else inputs.set(file, entry);
  return value;
}
const json = file => JSON.parse(bytes(file).toString('utf8'));
const cjson = name => json(path.join(CAMPAIGN, name));
const same = (left, right, label) => assert.equal(digest(left), digest(right), label);
const save = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
async function check(name, fn) {
  try { sections[name] = await fn(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: { name: error.name, code: error.code ?? null, message: String(error.message).slice(0, 1000) } }); }
}
function database(workspace) {
  const file = path.join(workspace, '.foundry/foundry.sqlite');
  bytes(file);
  const wal = `${file}-wal`;
  if (fs.existsSync(wal)) bytes(wal);
  return new DatabaseSync(file, { readOnly: true });
}
function body(db, table, id) {
  assert.ok(['runs', 'requests', 'proposals', 'generation_jobs'].includes(table));
  const row = db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id);
  assert.ok(row, `${table} record missing`);
  return JSON.parse(row.body);
}
function readArtifact(workspace, runId) {
  let target = path.join(workspace, '.foundry');
  for (const part of ['artifacts', runId, 'manifest.json']) {
    target = path.join(target, part);
    assert.equal(fs.lstatSync(target).isSymbolicLink(), false, 'Artifact path link');
  }
  const data = bytes(target);
  assert.ok(data.length <= 512 * 1024);
  const text = data.toString('utf8');
  return { manifest: JSON.parse(text), text, sha256: sha(data), bytes: data.length, argsHash: digest({ name: 'manifest.json', content: text }) };
}
function savedRun(workspace, id, candidate, registryHash) {
  const db = database(workspace);
  try {
    const run = body(db, 'runs', id);
    const events = db.prepare('SELECT seq,body,hash FROM events WHERE run_id=? ORDER BY seq').all(id).map(row => {
      const value = JSON.parse(row.body);
      assert.equal(value.seq, row.seq);
      assert.equal(digest(value), row.hash, 'Stored event body digest');
      return { ...value, hash: row.hash };
    });
    let previous = null;
    for (const [index, event] of events.entries()) {
      assert.equal(event.seq, index + 1); assert.equal(event.previousHash, previous); previous = event.hash;
    }
    assert.ok(events.length > 0);
    same(run.eventHead, { seq: events.length, hash: previous }, 'Durable event head');
    assert.equal(run.id, id); assert.equal(run.workflowHash, digest(candidate));
    assert.equal(run.registryHash, registryHash); assert.equal(run.engineHash, engineHash);
    const birth = events[0];
    assert.equal(birth.type, 'run.created'); assert.equal(birth.workflowHash, run.workflowHash);
    assert.equal(birth.registryHash, registryHash); assert.equal(birth.engineHash, engineHash);
    assert.equal(birth.inputHash, digest(run.input)); assert.equal(birth.policyHash, digest(run.policy));
    assert.equal(run.status, 'succeeded'); assert.equal(events.at(-1).type, 'run.succeeded');
    assert.equal(run.error, null); assert.equal(run.owner, null);
    const stored = db.prepare('SELECT body FROM workflows WHERE hash=?').get(run.workflowHash);
    assert.ok(stored); same(JSON.parse(stored.body), candidate, 'Case immutable candidate');
    assert.equal(run.steps, events.filter(e => e.type === 'tool.intent' || e.type === 'node.started').length);
    const lastCompletions = new Map();
    for (const event of events) if (['node.completed', 'node.handled_error'].includes(event.type)) {
      assert.equal(event.outputHash, digest(event.output)); lastCompletions.set(event.nodeKey, event);
    }
    for (const [nodeKey, event] of lastCompletions) {
      const slash = nodeKey.lastIndexOf('/'), frameKey = nodeKey.slice(0, slash), nodeId = nodeKey.slice(slash + 1);
      const frame = frameKey === 'root' ? run : run.frames[frameKey];
      assert.ok(frame); same(frame.outputs[nodeId], event.output, 'Checkpoint output versus event');
      assert.equal(frame.nodes[nodeId].completedSequence, event.seq);
      assert.equal(frame.nodes[nodeId].outputHash, event.outputHash);
    }
    const fixtureRow = db.prepare('SELECT body FROM fixtures WHERE run_id=?').get(id);
    assert.ok(fixtureRow);
    return { run, events, fixture: JSON.parse(fixtureRow.body), artifact: readArtifact(workspace, id) };
  } finally { db.close(); }
}

// Independently check the narrow saved-call/publication claims, using dynamic
// tool/node bindings. This is an audit of existing observations, not execution.
function inspectCalls(item, log, events, run, artifact, registry) {
  const intents = events.filter(e => e.type === 'tool.intent' && ['lab.screen', 'lab.reproduce'].includes(e.tool));
  assert.equal(log.length, intents.length);
  const completions = [];
  for (const [index, entry] of log.entries()) {
    const intent = intents[index]; assert.equal(entry.ordinal, index + 1);
    assert.equal(intent.nodeKey, entry.nodeKey); assert.equal(intent.tool, `lab.${entry.instrument}`);
    assert.equal(intent.argsHash, digest({ sampleId: entry.sampleId }));
    assert.equal(intent.idempotencyKey, entry.idempotencyKey);
    assert.equal(intent.idempotencyKey, digest({ runId: run.id, nodeKey: intent.nodeKey, workflowHash: run.workflowHash, args: { sampleId: entry.sampleId } }));
    const fixture = item.fixture.observations[entry.sampleId]?.[entry.instrument]; assert.ok(fixture);
    const next = events.find(e => e.seq > intent.seq && e.nodeKey === intent.nodeKey && e.type === 'tool.intent');
    const span = events.filter(e => e.seq > intent.seq && e.seq < (next?.seq ?? Infinity) && e.nodeKey === intent.nodeKey);
    const completed = span.filter(e => e.type === 'node.completed');
    const failed = span.filter(e => e.type === 'tool.failed');
    let event;
    if (Object.hasOwn(fixture, 'returned')) {
      assert.equal(entry.outcome, 'returned'); same(entry.observation, fixture.returned);
      assert.equal(completed.length, 1); assert.equal(failed.length, 0); event = completed[0];
      same(event.output, fixture.returned); assert.equal(event.outputHash, digest(event.output));
      validateData(registry.get(intent.tool).outputSchema, event.output);
    } else {
      assert.equal(entry.outcome, 'threw'); assert.equal(entry.errorCode, fixture.error);
      assert.equal(completed.length, 0); assert.equal(failed.length, 1); assert.equal(failed[0].error.code, fixture.error);
      const handled = span.filter(e => e.type === 'node.handled_error'); assert.equal(handled.length, 1); event = handled[0];
      assert.equal(event.output.ok, false); assert.equal(event.output.error.code, fixture.error);
    }
    assert.ok(!span.some(e => e.type === 'effect.uncertain'));
    assert.equal(entry.syntheticCost, entry.instrument === 'screen' ? 1 : 10);
    completions.push({ ...entry, start: intent.seq, end: event.seq, output: event.output });
  }
  let required = 0;
  for (const { id } of item.input.samples) {
    const screens = completions.filter(e => e.sampleId === id && e.instrument === 'screen'); assert.equal(screens.length, 1); required++;
    const value = screens[0].output;
    const suspicious = screens[0].outcome === 'returned' && value.ok === true && value.sampleId === id && value.suspicious === true;
    const reproductions = completions.filter(e => e.sampleId === id && e.instrument === 'reproduce');
    assert.equal(reproductions.length, suspicious ? 1 : 0);
    if (suspicious) { required++; assert.ok(screens[0].end < reproductions[0].start); }
  }
  assert.equal(completions.length, required);
  const publications = events.filter(e => e.type === 'tool.intent' && e.tool === 'core.artifact').map(intent => {
    const next = events.find(e => e.seq > intent.seq && e.nodeKey === intent.nodeKey && e.type === 'tool.intent');
    const completed = events.filter(e => e.seq > intent.seq && e.seq < (next?.seq ?? Infinity) && e.nodeKey === intent.nodeKey && e.type === 'node.completed' && e.output.name === 'manifest.json');
    if (!completed.length) return null;
    assert.equal(completed.length, 1); const output = completed[0].output;
    assert.equal(output.sha256, artifact.sha256); assert.equal(output.bytes, artifact.bytes);
    assert.equal(intent.argsHash, artifact.argsHash);
    assert.equal(intent.idempotencyKey, digest({ runId: run.id, nodeKey: intent.nodeKey, workflowHash: run.workflowHash, args: { name: 'manifest.json', content: artifact.text } }));
    for (const row of artifact.manifest.samples.filter(row => row.disposition === 'confirmed')) {
      const reproduction = completions.filter(e => e.instrument === 'reproduce' && e.sampleId === row.sampleId);
      assert.equal(reproduction.length, 1); const value = reproduction[0].output;
      assert.equal(value.sampleId, row.sampleId); assert.equal(value.ok, true); assert.equal(value.independent, true);
      assert.equal(value.reproduced, true); assert.equal(typeof value.evidenceId, 'string'); assert.ok(value.evidenceId.length > 0);
      assert.ok(reproduction[0].end < intent.seq);
    }
    return { start: intent.seq, end: completed[0].seq, allProcessingFinished: completions.every(e => e.end < intent.seq) };
  }).filter(Boolean);
  assert.ok(publications.length > 0);
  return { permittedAttempts: required, publicationCount: publications.length,
    allProcessingFinished: publications.every(e => e.allProcessingFinished), eventCount: events.length,
    firstEventAt: events[0].at, lastEventAt: events.at(-1).at };
}

const registry = registryFactory(), regHash = registry.hash();
const result = cjson('RESULTS.json'), job = cjson('GENERATION_JOB.json'), candidate = cjson('CANDIDATE.json');
const applied = cjson('APPLIED_RUN.json'), candidateFreeze = cjson('CANDIDATE_FREEZE.json');
const protocol = cjson('PROTOCOL.json'), packetFreeze = cjson('PACKET_FREEZE.json');
const author = cjson('packet/AUTHOR_1.json'), call = cjson('packet/CALL_1.json'), received = cjson('packet/RECEIVED_1.json');
const responseBytes = bytes(path.join(CAMPAIGN, 'packet/RESPONSE_1.json'));
const response = JSON.parse(responseBytes.toString('utf8'));
const jobRoot = path.join(CAMPAIGN, 'workspace/.foundry/generation', job.id);
const attemptRoot = path.join(jobRoot, '01');
const dev = json(path.join(attemptRoot, 'evaluation/REPORT.json')), sealed = cjson('sealed/REPORT.json');
const freeze = json(path.join(BENCH, 'FREEZE_V2.json'));

await check('frozen-sources-and-calibration', () => {
  const current = verifyFreeze(); same(current, freeze);
  for (const file of freeze.files) assert.equal(sha(bytes(file.path)), file.sha256);
  const ready = cjson('EVALUATOR_READY_CHECK.json');
  assert.equal(ready.v2FreezeSha256, sha(bytes(path.join(BENCH, 'FREEZE_V2.json'))));
  assert.equal(ready.auditSha256, sha(bytes(path.join(BENCH, 'calibration-v2-001/run-001/AUDIT.json'))));
  assert.equal(freeze.registryHash, regHash); assert.equal(ready.checksPassed, 18);
  return { files: freeze.files.length, oracleV2Sha256: sha(bytes(path.join(BENCH, 'oracle-v2.mjs'))), freezeSha256: ready.v2FreezeSha256 };
});
await check('candidate-relay-and-prompt', () => {
  same(candidate, response.workflow); assert.equal(digest(candidate), result.workflowHash); assert.equal(candidate.version, 1);
  assert.equal(candidateFreeze.workflowHash, digest(candidate));
  assert.equal(candidateFreeze.candidateBytesSha256, sha(bytes(path.join(CAMPAIGN, 'CANDIDATE.json'))));
  assert.equal(received.responseSha256, sha(responseBytes));
  assert.equal(received.authorReceiptSha256, sha(bytes(path.join(CAMPAIGN, 'packet/AUTHOR_1.json'))));
  const prompt = bytes(path.join(CAMPAIGN, 'packet/PROMPT_1.txt')).toString('utf8');
  assert.equal(prompt, bytes(path.join(attemptRoot, 'prompt.txt')).toString('utf8'));
  for (const record of [packetFreeze, call, received]) assert.equal(record.promptSha256, sha(prompt));
  const context = json(path.join(jobRoot, 'context.json'));
  const { contextHash, ...contextBody } = context; assert.equal(contextHash, digest(contextBody));
  assert.equal(contextHash, packetFreeze.contextHash); assert.equal(contextHash, job.contextHash);
  const start = prompt.indexOf('\n\n') + 2, end = prompt.lastIndexOf('\n\nReturn exactly');
  assert.ok(start > 1 && end > start); same(JSON.parse(prompt.slice(start, end)), context);
  assert.equal(context.currentWorkflow, null); assert.equal(context.diagnosticRepair, null);
  assert.equal(context.registryHash, regHash); same(context.capabilities, registry.list());
  const pub = json(path.join(BENCH, 'PUBLIC.json'));
  const publicTask = [pub.task, 'Public contract:', JSON.stringify({ inputSchema: pub.inputSchema, manifestSchema: pub.manifestSchema, rules: pub.rules, budget: pub.budget })].join('\n\n');
  assert.equal(context.task, publicTask); assert.equal(cjson('REQUEST.json').text, publicTask);
  same(context.workflowSchema, json('/home/raed/Projects/workflow-foundry/schemas/workflow.schema.json'));
  for (const skill of context.skills) {
    assert.equal(skill.sha256, sha(skill.text));
    assert.match(skill.name, /^[a-z0-9-]+$/); assert.equal(skill.reference, 'SKILL.md');
    assert.equal(skill.text, bytes(`/home/raed/Projects/workflow-foundry/skills/${skill.name}/SKILL.md`).toString('utf8'));
  }
  const allowedKeys = ['instruction','task','requestId','baseHash','currentWorkflow','domain','diagnosticRepair','workflowSchema','capabilities','registryHash','selectedSkills','skills','trialPolicy','submission','verification','contextHash'];
  same(Object.keys(context).sort(), allowedKeys.sort());
  assert.ok(!prompt.includes('Previous candidate and independent host feedback'));
  assert.ok(!prompt.includes('sealed/SUITE.json') && !prompt.includes('supplied.mjs'));
  const genResponse = json(path.join(attemptRoot, 'response.json'));
  assert.equal(genResponse.text, responseBytes.toString('utf8')); same(genResponse.evidence, received);
  assert.equal(job.attempts.length, 1); assert.equal(job.attempts[0].promptHash, digest(prompt));
  assert.equal(job.attempts[0].outputHash, digest(genResponse.text));
  assert.equal(job.attempts[0].workflowHash, digest(candidate)); same(job.attempts[0].evidence, received);
  assert.equal(protocol.packetFreezeSha256, sha(bytes(path.join(CAMPAIGN, 'PACKET_FREEZE.json'))));
  assert.equal(protocol.driverSha256, sha(bytes(path.join(STUDY, 'cos-campaign.mjs'))));
  assert.equal(protocol.relaySha256, sha(bytes(path.join(STUDY, 'relay-provider.mjs'))));
  same(result.protocol, protocol);
  return { workflowHash: digest(candidate), responseBytesSha256: sha(responseBytes), promptSha256: sha(prompt), promptBytes: Buffer.byteLength(prompt),
    attemptCount: 1, selectedSkills: context.selectedSkills, explicitPriorFeedback: false,
    v2AddendumInOriginalPacket: prompt.includes('successful manifest publication attempt begins'),
    hiddenness: 'Exact packet reconstructed from public contract, generic schema/skills and registry; ambient context and unrecorded filesystem access are not established by this check.',
    modelIdentity: '6/pro is host/relay-reported; author receipt says settings unobserved. Upstream spawn metadata was not inspected.' };
});
await check('request-proposal-job-qualification-database', () => {
  const db = database(path.join(CAMPAIGN, 'workspace'));
  try {
    const request = body(db, 'requests', result.requestId), proposal = body(db, 'proposals', result.proposalId);
    same(body(db, 'generation_jobs', job.id), job);
    assert.equal(request.status, 'applied'); assert.equal(request.text, cjson('REQUEST.json').text);
    assert.equal(proposal.status, 'applied'); assert.equal(proposal.requestId, request.id);
    assert.equal(proposal.workflowHash, digest(candidate)); same(proposal.workflow, candidate); assert.equal(proposal.rationale, response.rationale);
    assert.equal(job.status, 'proposed'); assert.equal(job.requestId, request.id); assert.equal(job.proposalId, proposal.id);
    assert.equal(candidateFreeze.requestId, request.id); assert.equal(candidateFreeze.proposalId, proposal.id); assert.equal(candidateFreeze.generationJobId, job.id);
    assert.equal(db.prepare('SELECT hash FROM heads WHERE id=?').get(candidate.id).hash, digest(candidate));
    const qualifications = db.prepare('SELECT body FROM qualifications WHERE workflow_hash=?').all(digest(candidate)).map(row => JSON.parse(row.body));
    assert.equal(qualifications.length, 2);
    for (const report of [dev, sealed]) same(qualifications.find(q => q.evaluatorId === report.evaluatorId), report);
    same(job.attempts[0].assessment.evaluation, dev); same(json(path.join(attemptRoot, 'assessment.json')), job.attempts[0].assessment);
    assert.equal(job.limits.maxRounds, protocol.maxRounds); assert.equal(job.limits.maxDurationMs, protocol.maxDurationMs); assert.equal(job.limits.autoApply, false);
    const validation = validateWorkflow(candidate, { registry }); assert.equal(validation.valid, true);
    same(validation, job.attempts[0].assessment.validation);
    return { requestId: request.id, proposalId: proposal.id, generationJobId: job.id, qualifications: qualifications.length,
      proposalCreatedAt: proposal.createdAt, proposalAppliedAt: proposal.appliedAt, jobCreatedAt: job.createdAt, jobFinishedAt: job.finishedAt };
  } finally { db.close(); }
});
await check('development-and-sealed-saved-evidence', () => {
  const summaries = [];
  for (const [split, report, reportPath] of [['development', dev, path.join(attemptRoot, 'evaluation/REPORT.json')], ['sealed', sealed, path.join(CAMPAIGN, 'sealed/REPORT.json')]]) {
    const suite = loadSuite(split); bytes(path.join(BENCH, split, 'SUITE.json'));
    assert.equal(report.evaluatorId, evaluatorId(suite)); assert.equal(report.suiteHash, digest(suite));
    assert.equal(report.workflowHash, digest(candidate)); assert.equal(report.registryHash, regHash); assert.equal(report.passed, true);
    same(report.publicationPolicy, PUBLICATION_POLICY); assert.equal(report.cases.length, suite.cases.length);
    const v1 = json(report.v1ReportPath); assert.equal(v1.workflowHash, digest(candidate)); assert.equal(v1.passed, true);
    let steps = 0, cost = 0, syntheticCost = 0, attempts = 0, eventCount = 0, allProcessing = true;
    const firsts = [], lasts = [], fingerprints = [];
    for (const [index, record] of report.cases.entries()) {
      const item = suite.cases[index]; assert.equal(record.id, item.id); assert.equal(record.passed, true); assert.equal(record.falseSuccess, false);
      const evidence = savedRun(record.workspace, record.runId, candidate, regHash);
      same(evidence.run.input, item.input); same(evidence.fixture, { ...item.fixture, actions: [], wrongActions: 0 });
      const expected = item.expect.artifacts.find(a => a.name === 'manifest.json').json;
      same(evidence.artifact.manifest, expected); assert.equal(item.expect.checks.length, 0);
      assert.equal(record.artifacts.find(a => a.name === 'manifest.json').sha256, evidence.artifact.sha256);
      same(record.evidenceBinding, { passed: true, eventHead: evidence.run.eventHead, eventsHash: digest(evidence.events), instrumentLogHash: digest(record.instrumentLog), manifestSha256: evidence.artifact.sha256 });
      same(record.instrumentLog, v1.cases[index].instrumentLog);
      const observed = inspectCalls(item, record.instrumentLog, evidence.events, evidence.run, evidence.artifact, registry);
      assert.equal(record.instrumentAudit.passed, true);
      assert.equal(record.instrumentAudit.allProcessingBeforePublication.passed, observed.allProcessingFinished);
      for (const field of ['missingCalls','forbiddenCalls','duplicateCalls','logBindingErrors','completionErrors','evidenceOrderErrors','prematureConfirmations','publicationBindingErrors']) assert.equal(record.instrumentAudit[field], 0);
      assert.equal(record.steps, evidence.run.steps); assert.equal(record.cost, evidence.run.cost); assert.equal(record.eventCount, evidence.events.length);
      steps += evidence.run.steps; cost += evidence.run.cost; syntheticCost += record.instrumentLog.reduce((n,e) => n + e.syntheticCost, 0);
      attempts += observed.permittedAttempts; eventCount += observed.eventCount; allProcessing &&= observed.allProcessingFinished;
      firsts.push(observed.firstEventAt); lasts.push(observed.lastEventAt);
      fingerprints.push({ ordinal: index + 1, runId: evidence.run.id, eventsHash: digest(evidence.events), manifestSha256: evidence.artifact.sha256 });
    }
    assert.equal(report.metrics.caseCount, suite.cases.length); assert.equal(report.metrics.passedCount, suite.cases.length);
    assert.equal(report.metrics.totalSteps, steps); assert.equal(report.metrics.totalCost, cost); assert.equal(report.metrics.syntheticCost, syntheticCost);
    summaries.push({ split, casesChecked: suite.cases.length, reportSha256: sha(bytes(reportPath)), passed: true, totalSteps: steps,
      permittedAttempts: attempts, eventsChecked: eventCount, allProcessingBeforePublication: allProcessing,
      firstRunAt: Math.min(...firsts), lastRunEventAt: Math.max(...lasts), caseFingerprints: fingerprints });
  }
  same(aggregate(sealed), cjson('SEALED_AGGREGATE.json')); same(aggregate(sealed), result.sealed);
  return summaries;
});
await check('applied-run-v2-recomputation', () => {
  const workspace = path.join(CAMPAIGN, 'workspace');
  const evidence = savedRun(workspace, result.runId, candidate, regHash);
  same(evidence.run, applied.run); same(evidence.events, applied.events);
  const suite = loadSuite('development'), item = suite.cases.find(item => item.input.samples.length > 0);
  same(evidence.run.input, item.input); same(evidence.fixture, { ...item.fixture, actions: [], wrongActions: 0 });
  same(evidence.artifact.manifest, item.expect.artifacts.find(a => a.name === 'manifest.json').json);
  same(evidence.artifact.manifest, applied.actual); same(applied.expected, applied.actual);
  const independentlyChecked = inspectCalls(item, applied.calls, evidence.events, evidence.run, evidence.artifact, registry);
  const v2 = auditInstruments(item, applied.calls, evidence.events, { run: evidence.run, artifact: evidence.artifact });
  assert.equal(v2.passed, true); assert.equal(applied.audit.passed, true); assert.equal(Object.hasOwn(applied.audit, 'completionErrors'), false);
  const delivery = applied.delivery;
  assert.equal(delivery.localExecutionSucceeded, true); assert.equal(delivery.independentTaskVerified, false);
  for (const key of ['runId','requestId','proposalId','workflowHash','workflowId']) assert.equal(delivery[key], result[key]);
  assert.equal(delivery.inputHash, digest(item.input)); assert.equal(delivery.registryHash, regHash); same(delivery.eventHead, evidence.run.eventHead);
  same(delivery.matchedTaskEvidence.map(q => q.evaluatorId).sort(), [dev.evaluatorId, sealed.evaluatorId].sort());
  save('APPLIED_V2_AUDIT.json', { source: path.join(CAMPAIGN, 'APPLIED_RUN.json'), sourceSha256: sha(bytes(path.join(CAMPAIGN, 'APPLIED_RUN.json'))),
    workflowHash: digest(candidate), registryHash: regHash, runId: evidence.run.id, eventHead: evidence.run.eventHead, manifestSha256: evidence.artifact.sha256,
    noRuntimeReexecution: true, priorAuditVersion: 'v1', recomputedAuditVersion: 'v2', audit: v2 });
  return { passed: true, status: evidence.run.status, ...independentlyChecked, priorAuditVersion: 'v1', nowCheckedWith: 'v2',
    eventHead: evidence.run.eventHead, manifestSha256: evidence.artifact.sha256, v2AuditReceipt: path.join(OUT, 'APPLIED_V2_AUDIT.json') };
});
await check('chronology', () => {
  assert.ok(sections['development-and-sealed-saved-evidence']); assert.ok(sections['request-proposal-job-qualification-database']);
  const before = sections['request-proposal-job-qualification-database'];
  const runs = sections['development-and-sealed-saved-evidence'];
  const ready = cjson('EVALUATOR_READY_CHECK.json'), promotion = cjson('LOCAL_PROMOTION.json');
  const calibration = json(path.join(BENCH, 'calibration-v2-001/run-001/AUDIT.json'));
  const milestones = [
    { name: 'original v1 freeze', time: json(path.join(BENCH, 'FREEZE.json')).frozenAt, basis: 'receipt field' },
    { name: 'public packet freeze', time: packetFreeze.at, basis: 'receipt field' },
    { name: 'v2 commissioned', time: '2026-09-17T03:17:15Z', basis: 'prime message timestamp in this conversation' },
    { name: 'campaign protocol', time: protocol.createdAt, basis: 'receipt field' },
    { name: 'candidate response authored', time: inputs.get(path.join(CAMPAIGN, 'packet/RESPONSE_1.json')).mtime, basis: 'filesystem mtime; no embedded author timestamp' },
    { name: 'authorship receipt written', time: inputs.get(path.join(CAMPAIGN, 'packet/AUTHOR_1.json')).mtime, basis: 'filesystem mtime' },
    { name: 'v2 source freeze', time: freeze.frozenAt, basis: 'receipt field' },
    { name: 'evaluator readiness', time: ready.at, basis: 'receipt field' },
    { name: 'saved response consumed by relay', time: received.receivedAt, basis: 'receipt field; not a new model inference' },
    ...runs.filter(r => r.split === 'development').flatMap(r => [
      { name: 'development first run', time: new Date(r.firstRunAt).toISOString(), basis: 'verified native event time' },
      { name: 'development last run complete', time: new Date(r.lastRunEventAt).toISOString(), basis: 'verified native event time' }]),
    { name: 'candidate frozen for sealed evaluation', time: candidateFreeze.at, basis: 'receipt field' },
    ...runs.filter(r => r.split === 'sealed').flatMap(r => [
      { name: 'sealed first run', time: new Date(r.firstRunAt).toISOString(), basis: 'verified native event time' },
      { name: 'sealed last run complete', time: new Date(r.lastRunEventAt).toISOString(), basis: 'verified native event time' }]),
    { name: 'explicit local promotion', time: promotion.at, basis: 'receipt field' },
    { name: 'proposal applied', time: new Date(before.proposalAppliedAt).toISOString(), basis: 'database record' },
    { name: 'applied run starts', time: new Date(applied.events[0].at).toISOString(), basis: 'verified native event time' },
    { name: 'applied run completes', time: new Date(applied.events.at(-1).at).toISOString(), basis: 'verified native event time' },
    { name: 'campaign finished', time: result.finishedAt, basis: 'receipt field' },
  ];
  for (let i=1; i<milestones.length; i++) assert.ok(Date.parse(milestones[i-1].time) <= Date.parse(milestones[i].time), `Chronology: ${milestones[i-1].name} before ${milestones[i].name}`);
  assert.equal(calibration.passed, true);
  return { milestones, v2FrozenBeforeAuthorship: false, v2FrozenBeforeEvaluation: true, candidateFrozenBeforeSealed: true,
    authorReceiptModelSettingsKnown: author.cosSelectedSettings.known,
    evaluatorAuthorAttestation: 'This evaluator author first read this actual candidate during this saved-campaign review, after the v2 freeze. The v2 repair used independent F1/F2 witnesses and supplied calibration controls.',
    limit: 'Local receipt times and file mtimes are not independently notarized. This is a pre-evaluation, post-authorship evaluator amendment; not a fully pre-authorship v2 precommit.' };
});

const integrity = [...inputs.values()].map(entry => ({ ...entry, finalSha256: sha(fs.readFileSync(entry.path)) }));
const changed = integrity.filter(entry => entry.sha256 !== entry.finalSha256);
checks.push({ name: 'inputs-unchanged-through-review', passed: changed.length === 0, changedPaths: changed.map(e => e.path) });
const audit = { schemaVersion: 'saved-cos-campaign-independent-review-v1', at: new Date().toISOString(), campaign: CAMPAIGN,
  workflowHash: digest(candidate), passed: checks.every(c => c.passed), checks, sections,
  runtimeExecutions: 0, modelProviderCalls: 0, existingFileWrites: 0,
  sourceHash: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  limitations: ['The reviewer authored evaluator v2; independence here is from the campaign constructor and executor, not from v2 implementation.',
    'Model 6/pro is host-reported; saved author receipt does not independently identify settings. No upstream session/spawn audit was performed.',
    'Prompt equality and public-source reconstruction do not prove absence of ambient conversation context or out-of-band reads.',
    'Temporal consistency and observed dataflow do not prove population performance or independent physical instruments.',
    'Original campaign driver uses v1 for the applied audit, omits an explicit applied-run success gate, and does not compare every protocol field. Its actual saved run succeeds; this additive review checks v2 without modifying that history.'] };
save('SOURCE_INTEGRITY.json', integrity); save('AUDIT.json', audit);
console.log(JSON.stringify({ path: path.join(OUT, 'AUDIT.json'), sha256: sha(fs.readFileSync(path.join(OUT, 'AUDIT.json'))),
  passed: audit.passed, checks: checks.map(({name,passed,error})=>({name,passed,...(error?{error}:{})})),
  filesChecked: integrity.length, runtimeExecutions: 0, modelProviderCalls: 0 }, null, 2));
if (!audit.passed) process.exitCode = 1;
