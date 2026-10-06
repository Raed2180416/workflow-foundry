import path from 'node:path';

// Native evaluation results contain the workspace root, not Store.directory.
export const manifestPath = (workspace, runId) => path.join(workspace, '.foundry', 'artifacts', runId, 'manifest.json');

export function processingDiagnostic(requiredAttempts, audit) {
  let incompleteAtPublication = 0;
  for (const publication of audit.publications) for (const requirement of requiredAttempts) {
    const matches = audit.attempts.filter(attempt => attempt.sampleId === requirement.sampleId
      && attempt.instrument === requirement.instrument);
    if (matches.length !== 1 || !matches[0].valid
      || matches[0].completedSequence >= publication.startedSequence) incompleteAtPublication++;
  }
  return {
    passed: audit.publications.length > 0 && incompleteAtPublication === 0,
    enforced: false, requiredAttempts: requiredAttempts.length, incompleteAtPublication,
  };
}
