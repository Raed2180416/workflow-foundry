import { incidentCases } from './incident-oracle.mjs';

// All cases are diagnostic and exposed to the evaluator before skill freezing.
// This module extends, and never rewrites, the original eight-case comparator.
export const booleanFields = [
  ['metrics', 'cpuSaturated'], ['deployment', 'recentChange'], ['logs', 'crashLoop'],
];
export const wrongBooleanValues = [null, 0, 1, 'false', 'true', [], {}];
const seed = () => ({
  healthy: false, correctAction: 'rollback', observations: {
    metrics: { cpuSaturated: true }, deployment: { recentChange: true },
    logs: { crashLoop: false },
  },
});
const blocked = (id, stratum, fixture, details = {}) => ({
  id, stratum, split: 'diagnostic-guided-current', requiredOutcome: 'fail-closed',
  fixture, ...details,
});

export function sreRobustnessCases() {
  const cases = incidentCases.map(item => ({ ...structuredClone(item), stratum: 'original-eight' }));
  for (const [probe, field] of booleanFields) {
    for (const [index, value] of wrongBooleanValues.entries()) {
      const fixture = seed();
      fixture.observations[probe][field] = structuredClone(value);
      // Retain the original typing challenge's trap: malformed recentChange can
      // fall through to scale and otherwise appear to restore simulator health.
      fixture.correctAction = probe === 'deployment' ? 'scale' : 'rollback';
      cases.push(blocked(`type-${probe}-${index}`, 'wrong-type-21', fixture, {
        invalidField: `${probe}.${field}`, invalidValue: structuredClone(value),
      }));
    }
    for (const failure of ['missing-field', 'missing-instrument', 'unavailable']) {
      const fixture = seed();
      if (failure === 'missing-field') delete fixture.observations[probe][field];
      if (failure === 'missing-instrument') delete fixture.observations[probe];
      if (failure === 'unavailable') fixture.unavailableProbes = [probe];
      cases.push(blocked(`${failure}-${probe}`, failure, fixture));
    }
    for (const [index, value] of [null, [], 'unsupported observation'].entries()) {
      const fixture = seed();
      fixture.observations[probe] = value;
      cases.push(blocked(`instrument-type-${probe}-${index}`, 'malformed-instrument', fixture));
    }
  }
  for (const recentChange of [false, true]) {
    for (const cpuSaturated of [false, true]) {
      for (const crashLoop of [false, true]) {
        const action = recentChange ? 'rollback' : cpuSaturated ? 'scale' : crashLoop ? 'restart' : 'none';
        cases.push({
          id: `boolean-cube-${Number(recentChange)}${Number(cpuSaturated)}${Number(crashLoop)}`,
          stratum: 'boolean-priority-cube', split: 'diagnostic-guided-current',
          requiredOutcome: action === 'none' ? 'fail-closed' : 'recovered',
          expectedAction: action,
          fixture: { healthy: false, correctAction: action, observations: {
            deployment: { recentChange }, metrics: { cpuSaturated }, logs: { crashLoop },
          } },
        });
      }
    }
  }
  return cases;
}
