// Requirement attribution for SPEC-1 / INTENT-1: which SPEC-E ids a failing case implicates, read from the E8 oracle's
// first divergence (beds/ebed/oracle/grade.mjs) and the case's class. Analyst-side, $0, pure.
//
// Approximate by construction, and reported as such:
//   - the oracle stops at a case's first divergence, so a later failure in the same case is masked;
//   - a lid names an effect, not a rule: `ost:O:cancelled` can be owed to six rules, so it implicates all six;
//   - readings (S*) refine rules and have no lids of their own: a reading is implicated only through the class of a
//     failing case that exercises it (CLASS_READINGS).
// An id counts as implemented on a run when no failing completed case implicates it ("requirement recall" in §4.4).
export const LID_RULES = Object.freeze([
  [/^create:/, ['R1.1', 'R1.2', 'R1.3']],
  [/^ost:[^:]+:customerActionRequired$/, ['R3.1']],
  [/^ost:[^:]+:processing$/, ['R4.1']],
  [/^ost:[^:]+:timedOut$/, ['R3.2']],
  [/^ost:[^:]+:cancelled$/, ['R2.1', 'R2.2', 'R3.2', 'R6.1', 'R6.2', 'R6.4']],
  [/^ost:[^:]+:(completed|failed)$/, ['R4.5']],
  [/^fst:.+:processing$/, ['R4.1']],
  [/^fst:.+:(dispatched|completed)$/, ['R4.4']],
  [/^fst:.+:failed$/, ['R5.2']],
  [/^fst:.+:cancelled$/, ['R3.2', 'R6.1', 'R6.2']],
  [/^rsv:/, ['R4.2']],
  [/^chg:/, ['R1.2', 'R4.2']],
  [/^shp:/, ['R4.2']],
  [/^(csh|rf|rel):/, ['R5.1', 'R5.2', 'R6.2']],
  [/:action-required$/, ['R3.1']],
  [/:order-cancelled$/, ['R6.1', 'R6.2']],
  [/:order-timed-out$/, ['R3.2']],
  [/:fulfilment-failed$/, ['R5.2']],
  [/:cancel-refused$/, ['R6.3']],
  [/:unknown-order$/, ['NTF']],
  [/^review:/, ['R2.1', 'R2.2']],
]);

const OP_RULES = Object.freeze({
  'orders.create': ['R1.1', 'R1.4'], 'orders.setStatus': ['R7.2'], 'inventory.reserve': ['R4.2', 'R6.2'], 'inventory.release': ['R5.1'],
  'billing.charge': ['R4.2', 'R5.2', 'R6.2'], 'billing.refund': ['R5.1'], 'carrier.create': ['R4.2', 'R6.2'], 'carrier.cancel': ['R5.1', 'R6.3'], 'notify.send': ['NTF'],
});

/** Readings exercised by a world case class (beds/ebed/e8/world.mjs CLASSES). */
export const CLASS_READINGS = Object.freeze({
  'action-at-deadline': ['S1'], 'action-late': ['S1', 'S5'], timeout: ['S1'], amend: ['S9'], 'cancel-wait': ['S9'],
  'review-approve': ['S3'], 'review-reject': ['S3'], 'review-timeout': ['S1', 'S3'],
  'cancel-processing': ['S7', 'S9'], 'cancel-after-collection': ['S6', 'S7'], 'cancel-at-collection': ['S4', 'S7'], 'amend-then-cancel': ['S5', 'S8'],
  'f3-charge': ['S2'], 'f3-refund': ['S2'], 'f4-reserve': [], 'f6-carrier': [], 'f1-charge': [],
});

export function lidRules(lid) {
  const out = new Set();
  for (const [re, ids] of LID_RULES) if (re.test(String(lid ?? ''))) for (const id of ids) out.add(id);
  return [...out];
}

/** Ids a first divergence implicates (no class information). */
export function attributeDivergence(div) {
  if (!div) return [];
  const s = new Set();
  const add = xs => { for (const x of xs) s.add(x); };
  switch (div.code) {
    case 'missed': add(div.rule ? [div.rule] : []); add(lidRules(div.lid)); break;
    case 'early': case 'late': add(lidRules(div.lid)); add(['U12']); break;
    case 'duplicate': add(lidRules(div.lid)); add(['U12']); break;
    case 'order': add(lidRules(div.lid)); add(/^(csh|rf|rel):/.test(div.lid) ? ['R5.1'] : ['R4.2']); break;
    case 'key-reuse': case 'key-split': add(lidRules(div.lid)); add(['U02']); break;
    case 'outside-allowed': add(OP_RULES[`${div.system}.${div.op}`] ?? []); add(['U12']); break;
    case 'over-escalation': add(['R2.1', 'U12']); break;
    case 'under-escalation': add(['R2.1', 'R2.2']); break;
    case 'decision': add(['U04']); break;
    case 'records': add(['R7.1']); break;
    default: break;
  }
  return [...s].sort();
}

/** Ids a failing case implicates: its divergence's ids plus the readings its class exercises. */
export function implicated(caseVerdict) {
  if (caseVerdict.pass || !caseVerdict.firstDivergence) return [];
  return [...new Set([...attributeDivergence(caseVerdict.firstDivergence), ...(CLASS_READINGS[caseVerdict.class] ?? [])])].sort();
}

/** Requirement recall over a set of stream verdicts: per id, implemented unless a failing completed case implicates it. */
export function requirementRecall(verdicts, ids) {
  const bad = new Set();
  for (const v of verdicts) for (const c of v.cases) if (c.pool === 'completed' && !c.pass) for (const id of implicated(c)) bad.add(id);
  const missed = ids.filter(id => bad.has(id));
  return { ids: ids.length, implemented: ids.length - missed.length, recall: ids.length ? (ids.length - missed.length) / ids.length : null, missed };
}
