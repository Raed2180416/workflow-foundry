// Authored from the public prose rules, without an existing suite or candidate.
export function classify(id, instruments) {
  if (instruments.screen.error) return { disposition: 'error', reproduce: false };
  const screening = instruments.screen.returned;
  if (screening?.ok !== true || screening.sampleId !== id
      || typeof screening.suspicious !== 'boolean') {
    return { disposition: 'inconclusive', reproduce: false };
  }
  if (!screening.suspicious) return { disposition: 'clear', reproduce: false };
  if (instruments.reproduce.error) return { disposition: 'error', reproduce: true };
  const evidence = instruments.reproduce.returned;
  const complete = evidence?.ok === true && evidence.sampleId === id
    && evidence.independent === true && typeof evidence.evidenceId === 'string'
    && evidence.evidenceId.length > 0 && typeof evidence.reproduced === 'boolean';
  return {
    disposition: complete ? (evidence.reproduced ? 'confirmed' : 'not_reproduced') : 'inconclusive',
    reproduce: true,
  };
}

export function expectedCase(item) {
  const samples = [], requiredAttempts = [];
  let syntheticCost = 0;
  for (const { id } of item.input.samples) {
    const decision = classify(id, item.fixture.observations[id]);
    samples.push({ sampleId: id, disposition: decision.disposition });
    requiredAttempts.push({ sampleId: id, instrument: 'screen' });
    syntheticCost += 1;
    if (decision.reproduce) {
      requiredAttempts.push({ sampleId: id, instrument: 'reproduce' });
      syntheticCost += 10;
    }
  }
  return { manifest: { samples }, requiredAttempts, syntheticCost };
}
