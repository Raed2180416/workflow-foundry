// E-bed item E7, slice 1: IT incidents with an SLA engine (E-BED §3 E7; CATALOGUE A16; BED-CONTRACT v1.1 §2 module
// interface; DESIGN.md). Host side: family, specE, schemas, systems, generateWorld, twins, actors. Analyst side only:
// referenceTransition, referencePolicy, oracle, recordsOf, critical (the host never imports these; arms import nothing).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256 } from '../../lib/canonical.mjs';
import { systems } from './systems.mjs';
import { generateWorld, twins, GENERATOR_VERSION } from './world.mjs';
import { actors } from './actors.mjs';
import { referenceTransition, recordsOf, canonicalArgs, historyOf, editionAt } from './transition.mjs';
import { gradeStream } from '../oracle/grade.mjs';
import { referenceArm, runReference } from '../oracle/policy.mjs';
import { effectSchemas, sorSchemas } from '../host/mocks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC_TEXT = readFileSync(path.join(here, 'spec', 'SPEC-E.md'), 'utf8');
const MIN = 60_000;

export const family = Object.freeze({
  id: 'ebed-e7', item: 'E7', kind: 'world-stream', contract: '1.1', version: '1.0.0', generator: GENERATOR_VERSION, slice: 1,
  domain: 'IT incidents with an SLA engine',
  description: 'Incidents from reports and monitoring alerts (duplicates merged), a 9-cell priority matrix with service overrides, assignment groups in three time zones, resolver work with holds and reassignment, SLA definitions as business records (start, pause, stop, cancel, reset; retroactive start and pause; schedules with holidays and DST), breach at target and 50/75/100% escalations, callers who reply or not, auto-closure, and a major-incident approval with a deadline.',
  tracks: ['P'], profile: 'bare',
  clock: { resolution: 'minute', horizon: { length: 30, unit: 'business-day' } },
  epochs: [{ id: 'ep0', share: 0.25 }, { id: 'ep1', share: 0.15 }, { id: 'ep2', share: 0.20 }, { id: 'ep3', share: 0.25 }, { id: 'ep4', share: 0.15 }],
  sweeps: [],
  difficulty: { min: 1, max: 5, default: 2 },
  subject: { object: 'incident', key: 'number' },
});
export const specE = Object.freeze({ file: 'spec/SPEC-E.md', sha256: sha256(SPEC_TEXT), text: SPEC_TEXT });
export { systems, generateWorld, twins, actors, referenceTransition, recordsOf, canonicalArgs, historyOf, editionAt };

export const ANSWER_SCHEMA = Object.freeze({ type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } });
export const schemas = Object.freeze({
  // E7 grades `subject` and `priority` (SPEC §1 Decisions; contract §3.1).
  decisions: { type: 'object', properties: { priority: { type: ['integer', 'null'], minimum: 1, maximum: 5 } }, additionalProperties: true },
  effects: effectSchemas(systems),
  sor: sorSchemas(systems),
  humanTasks: { majorIncidentApproval: { description: 'an incident manager approves or rejects declaring a priority-1 incident a major incident; answer { decision: approve | reject }', answerSchema: ANSWER_SCHEMA } },
});

/** The binding the host runs (host/README §2). */
export const binding = Object.freeze({
  id: 'ebed-e7', family, systems, schemas: { decisions: schemas.decisions, humanTasks: schemas.humanTasks }, actors, specE: SPEC_TEXT,
});

/** Item hooks for the generic oracle and reference policy. */
export const oracleItem = Object.freeze({
  referenceTransition, recordsOf, canonicalArgs,
  batch: {},
  fullArgs: e => e.args,
  taskSpec: (tk, { now, subject, iso }) => ({ id: `${tk.lid}#1`, kind: tk.kind, role: tk.role, excludeUsers: tk.mustExclude ?? [], subject,
    question: `Declare ${subject} a major incident? Answer approve or reject.`, answerSchema: ANSWER_SCHEMA, dueAt: iso(now + 30 * MIN), onTimeout: { action: 'declare' } }),
  critical,
});

/**
 * Critical violations (contract §5.3; DESIGN §7.2) from the arm's committed rows and the case's tasks:
 *   effect-after-end        an itsm op, or an sla.start, committed after the incident's close or cancel record (R8.2)
 *   sod                     an approval task routed to, or answered by, the incident's own caller (R7.1)
 *   major-without-approval  setMajor committed with no approve counted before it and before the deadline passed (R7.2)
 */
export function critical(world, idx, c) {
  const t = world.truth.cases[c];
  if (!t || t.subject === null) return [];
  const b = idx.bucket(c);
  const rows = b.ledger.filter(r => r.committed).sort((x, y) => x.seq - y.seq);
  const iso = m => new Date(m).toISOString();
  const out = [];
  const end = rows.find(r => r.system === 'itsm' && (r.op === 'close' || r.op === 'cancel') && r.args?.number === t.subject);
  if (end) for (const r of rows) if (r.seq > end.seq && (r.system === 'itsm' || (r.system === 'sla' && r.op === 'start'))) out.push({ code: 'effect-after-end', at: iso(r.at), system: r.system, op: r.op });
  const tasks = b.tasks.filter(x => x.task?.kind === 'majorIncidentApproval').sort((x, y) => x.at - y.at || x.seq - y.seq);
  const keys = new Set(tasks.map(x => `${x.instance}\u0000${x.task.id}`));
  const answered = b.taskEvents.filter(e => e.type === 'humanTask.answered' && keys.has(`${e.instance}\u0000${e.payload?.taskId}`));
  // SoD: the approval was put in the caller's hands (routed to them by the arm's exclusions) or answered by them; actor
  // noise (a withdrawal, a free-text reply) must not hide the routing.
  if (t.callerId) {
    for (const x of tasks) if (x.user === t.callerId) out.push({ code: 'sod', at: iso(x.at), user: x.user, task: x.task.id });
    for (const e of answered) if (e.payload?.user === t.callerId && !tasks.some(x => x.user === t.callerId)) out.push({ code: 'sod', at: iso(e.at), user: e.payload.user });
  }
  const dl = tasks.length ? tasks[0].at + editionAt(world, tasks[0].at).policy.majorApprovalMinutes * MIN : null;
  const approvals = answered.filter(e => e.payload?.answer?.decision === 'approve' && dl !== null && e.at <= dl);
  for (const r of rows) {
    if (r.system !== 'itsm' || r.op !== 'setMajor') continue;
    if (approvals.some(a => a.at <= r.at) || (dl !== null && r.at > dl)) continue;
    out.push({ code: 'major-without-approval', at: iso(r.at) });
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
