import { CapabilityRegistry, createDefaultRegistry } from '../src/capabilities.mjs';

// NEW evaluator-owned host treatment. The original task requires three actual
// boolean observations before every remediation (cases/incident-routing.md:9-19).
// This profile enforces their receipt/shape/freshness in Runtime, outside the
// model. It neither chooses an action nor establishes successful recovery.
export const evidenceBoundFixtureTreatment = 'sre-three-booleans-hostcontract-v1';

export function fixtureEvidenceRequirements() {
  return [
    ['metrics', 'cpuSaturated'],
    ['deployment', 'recentChange'],
    ['logs', 'crashLoop'],
  ].map(([probe, field]) => ({
    id: `${probe}_${field}`,
    sourceTool: 'fixture.observe',
    sourceArgs: { probe },
    path: field,
    schema: { type: 'boolean' },
    maxAgeMs: 60000,
  }));
}

/**
 * Return an independent registry with the same default handlers and schemas.
 * Only fixture.remediate gains mandatory evidence requirements, for every action
 * and every dispatch/retry. No default registry, observation output, workflow or
 * historical run is modified. Missing/unsupported diagnostics pass through.
 * Execution must use Runtime; a trusted direct registry.execute call bypasses
 * Runtime admission and is not this evaluated host-enforcement treatment.
 */
export function createEvidenceBoundFixtureRegistry() {
  const defaults = createDefaultRegistry();
  const registry = new CapabilityRegistry();
  for (const { name } of defaults.list()) {
    const { handlerHash, ...spec } = defaults.get(name);
    if (name === 'fixture.remediate') {
      spec.requiresEvidence = [
        ...(spec.requiresEvidence ?? []), ...fixtureEvidenceRequirements(),
      ];
    }
    registry.register(spec);
  }
  return registry;
}
