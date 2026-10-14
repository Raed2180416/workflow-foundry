// `need-stage/r2-route`: the homogeneous r2-route family of the need-stage bed (one kind only), so a router that featurises and
// labels per family id sees one class hypothesis. Routing anchor for the need router (experiments/need-router), not a
// Tier-A bed. Same cases, truths, oracle and controls as need-stage with knobs.stage = 'r2-route'; outputSchema is the
// kind's strict schema. Load with experiments/lib/beds.mjs loadFamily('need-stage/r2-route'). See ../README.md.
import { kindFamily } from '../index.mjs';

export const {
  family, outputSchema, generate, oracle, referenceSolve, badControls, deployableCheck, outputSchemaOf, describeTask, surfaceBaseline,
} = kindFamily('r2-route');
