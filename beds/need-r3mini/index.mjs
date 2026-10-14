// `need-r3mini` bed: the W-bed R3 supplier-statement audit cut down to 2-3 statements. Routing anchor for the need
// router (experiments/need-router), not a Tier-A bed: the metamorphic partner of wbed-r3 (same rules text, same document
// dialects, same output form and the rung's own oracle semantics; only the number of statements differs). See README.md
// for the knob, the truth, the controls and the class HYPOTHESIS. Trusted host code: solvers never see the oracle, the
// reference solver or the rung's hidden world.
import { estimateTokens, canonical } from '../lib/canonical.mjs';
import { validate } from '../wbed/lib/contracts.mjs';
import { outputSchema as rungSchema, scoreAudit } from '../wbed/r3/score.mjs';
import { corrupt as _unused } from './noop.mjs';
