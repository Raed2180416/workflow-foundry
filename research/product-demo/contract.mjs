import assert from 'node:assert/strict';

/** A successful UI receipt requires executed independent outcomes and model provenance. */
export function assertDemoContract(report) {
  assert.equal(report.mode, 'actual-browser/noninteractive-free-model/diagnostic');
  assert.equal(report.sourceIntegrity?.verified, true, 'Frozen source/dependency integrity is required');
  assert.equal(report.stages.length, 2, 'Both model stages must finish');
  for (const [index, stage] of report.stages.entries()) {
    assert.equal(stage.kind, index === 0 ? 'initial' : 'revision');
    assert.ok(stage.calls >= 1 && stage.calls <= 3, 'At most three calls per stage');
    assert.equal(stage.status, 'proposed');
    assert.equal(stage.modelProvenanceVerified, true);
    assert.equal(stage.model, report.model);
    assert.equal(stage.reportedCost, 0);
    assert.equal(stage.evaluation?.passed, true, 'Schema-only acceptance is insufficient');
    assert.equal(stage.evaluation.metrics.passedCount, 7);
    assert.equal(stage.evaluation.metrics.caseCount, 7);
    assert.equal(stage.evaluation.workflowHash, stage.workflowHash);
    assert.equal(stage.evaluation.suiteHash, stage.suiteHash);
    assert.equal(stage.evaluation.registryHash, report.registryHash);
    assert.equal(stage.uiRun?.status, 'succeeded');
    assert.equal(stage.uiRun.workflowHash, stage.workflowHash);
    assert.equal(stage.uiRun.artifactMatches, true);
    assert.equal(stage.requestSource, 'user-ui');
    assert.equal(stage.appliedThroughUI, true);
  }
  assert.equal(report.history?.oldRunUnchanged, true);
  assert.equal(report.history?.oldVersionAddressable, true);
  assert.equal(report.history?.newVersion, report.history?.oldVersion + 1);
  assert.notEqual(report.stages[0].workflowHash, report.stages[1].workflowHash);
  return true;
}
