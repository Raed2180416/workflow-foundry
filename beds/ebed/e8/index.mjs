// E-bed item E8: order fulfilment with compensation (E-BED §3 E8; BED-CONTRACT v1.1 §2 module interface).
// Host side: family, specE, schemas, systems, generateWorld, twins, actors. Analyst side only: referenceTransition,
// referencePolicy, oracle, recordsOf, critical (the host never imports these; arms import nothing).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256 } from '../../lib/canonical.mjs';
import { systems } from './systems.mjs';
import { generateWorld, twins, GENERATOR_VERSION } from './world.mjs';
import { actors } from './actors.mjs';
import { referenceTransition, recordsOf, canonicalArgs } from './transition.mjs';
import { gradeStream } from '../oracle/grade.mjs';
import { referenceArm, runReference } from '../oracle/policy.mjs';
import { effectSchemas, sorSchemas } from '../host/mocks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC_TEXT = readFileSync(path.join(here, 'spec', 'SPEC-E.md'), 'utf8');

export const family = Object.freeze({
  id: 'ebed-e8', item: 'E8', kind: 'world-stream', contract: '1.1', version: '1.0.0', generator: GENERATOR_VERSION,
  domain: 'order fulfilment saga with compensation',
  description: 'Per-location fulfilments: reserve, charge, ship; customer action racing a deadline; customer cancel until collection; compensation of committed steps in reverse order; carriers with their own vocabularies, repeats and out-of-order reports.',
  tracks: ['P'], profile: 'temporal-like',
  clock: { resolution: 'second', horizon: { length: 14, unit: 'calendar-day' } },
  epochs: [{ id: 'ep0', share: 0.25 }, { id: 'ep1', share: 0.15 }, { id: 'ep2', share: 0.20 }, { id: 'ep3', share: 0.25 }, { id: 'ep4', share: 0.15 }],
  sweeps: [],
  difficulty: { min: 1, max: 5, default: 2 },
  subject: { object: 'order', key: 'orderId' },
});
export const specE = Object.freeze({ file: 'spec/SPEC-E.md', sha256: sha256(SPEC_TEXT), text: SPEC_TEXT });
export { systems, generateWorld, twins, actors, referenceTransition, recordsOf, canonicalArgs };

export const ANSWER_SCHEMA = Object.freeze({ type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } });
export const schemas = Object.freeze({
  decisions: { type: 'object', properties: {}, additionalProperties: true },          // E8 grades `subject` only (contract §3.1)
  effects: effectSchemas(systems),
  sor: sorSchemas(systems),
  humanTasks: { fraudReview: { description: 'a fraud analyst approves or rejects an order under review; answer { decision: approve | reject }', answerSchema: ANSWER_SCHEMA } },
});

/** The binding the host runs (host/README §2). */
export const binding = Object.freeze({
  id: 'ebed-e8', family, systems, schemas: { decisions: schemas.decisions, humanTasks: schemas.humanTasks }, actors, specE: SPEC_TEXT,
});

const MIN = 60_000;
/** Item hooks for the generic oracle and reference policy. */
export const oracleItem = Object.freeze({
  referenceTransition, recordsOf, canonicalArgs,
  batch: { 'inventory.reserve': {
    group: e => e.match.fulfilmentId,
    envelope: e => ({ orderId: e.match.orderId, fulfilmentId: e.match.fulfilmentId, location: e.match.location }),
    item: e => ({ sku: e.match.sku, qty: e.match.qty }),
  } },
  fullArgs: (e, { lidRef }) => (e.system === 'carrier' && e.op === 'create' ? { ...e.args, ref: `ref-${lidRef}` } : e.args),
  taskSpec: (tk, { now, subject, iso }) => ({ id: `${tk.lid}#1`, kind: tk.kind, role: tk.role, excludeUsers: tk.mustExclude ?? [], subject,
    question: `Fraud review for order ${subject}: approve or reject?`, answerSchema: ANSWER_SCHEMA, dueAt: iso(now + 24 * 60 * MIN), onTimeout: { action: 'cancel' } }),
  critical,
});

/** Critical violations from the arm's final records (contract §5.3): orphaned charges and reservations of a fulfilment that failed or was cancelled. */
export function critical(world, idx, c) {
  const rec = recordsOf(world, idx, c);
  if (!rec || !['cancelled', 'failed', 'timedOut', 'completed'].includes(rec.order)) return [];
  const out = [];
  for (const [F, st] of Object.entries(rec.fulfilments)) {
    if (!['failed', 'cancelled'].includes(st)) continue;
    const ch = rec.charges[F];
    if (ch && ch.refundedMinor < ch.amountMinor) out.push({ code: 'orphan-charge', fulfilment: F });
    for (const [k, v] of Object.entries(rec.reservations)) if (k.startsWith(`${F}/`) && v === 'active') out.push({ code: 'orphan-reservation', fulfilment: F, sku: k.slice(F.length + 1) });
  }
  return out;
}

/** referencePolicy(world, { timing }) → an arm for the host (analyst-side; needs the host's journal, see runReference). */
export const referencePolicy = (world, { timing = 'earliest', journal }) => referenceArm({ item: oracleItem, world, timing, journal });

/** The two reference runs and the pools they define (contract §5.6, §6). */
export async function referenceRuns(world) {
  const runs = {};
  for (const timing of ['earliest', 'latest']) runs[timing] = await runReference({ item: oracleItem, binding, world, timing });
  const v = {};
  for (const timing of ['earliest', 'latest']) v[timing] = gradeStream({ item: oracleItem, world, rows: runs[timing].rows });
  const pools = {};
  for (const cv of v.earliest.cases) {
    const other = v.latest.cases.find(x => x.case === cv.case);
    pools[cv.case] = cv.complete && other?.complete ? 'completed' : 'censored';
  }
  return { runs, verdicts: v, pools };
}

/** oracle(world, journalRows, { pools }) → StreamVerdict (CL mode). */
export function oracle(world, rows, { pools = null, arm = null } = {}) {
  return gradeStream({ item: oracleItem, world, rows, pools, arm });
}
