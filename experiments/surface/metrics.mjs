// BUILDER-1 metric formulas (frozen with the cases; PREREG-BUILDER-1.md §5). Pure functions over the per-case records the runner writes.
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x, d = 4) => x === null ? null : Math.round(x * 10 ** d) / 10 ** d;

/** One slot check: equality (text ignoring case and spaces) or {contains}. */
export function slotOk(want, got) {
  if (want && typeof want === 'object' && Object.hasOwn(want, 'contains')) return typeof got === 'string' && got.toLowerCase().includes(String(want.contains).toLowerCase());
  if (typeof want === 'string') return typeof got === 'string' && got.trim().toLowerCase() === want.trim().toLowerCase();
  return JSON.stringify(want) === JSON.stringify(got);
}

/** Per-record derived numbers (also stored in each record). */
export function recordNumbers(caseDef, rec) {
  const required = (caseDef.questions ?? []).map(q => q.id);
  const askedIds = new Set(rec.questions.flatMap(q => q.matched));
  const seen = new Set(); let repeats = 0;
  for (const q of rec.questions) { if (q.matched.length && q.matched.every(id => seen.has(id))) repeats++; q.matched.forEach(id => seen.add(id)); }
  const answers = rec.questions.length;
  const verified = rec.judgement.verified === true;
  return {
    requiredQuestions: required.length, requiredAsked: required.filter(id => askedIds.has(id)).length,
    unnecessaryQuestions: rec.questions.filter(q => q.matched.length === 0).length, repeatQuestions: repeats, questionsAsked: answers,
    personActions: verified ? answers + 1 + (rec.hidden?.approvals?.asked ?? 0) : null,
    personActionsBeforeRun: verified ? answers + 1 : null,
    // Slot checks apply to the template arms only (B0 has no slots; its effects are judged by the oracle alone).
    slotChecks: rec.templateArm ? Object.keys(caseDef.slotChecks ?? {}).length : 0,
    slotChecksOk: rec.templateArm && rec.slots ? Object.entries(caseDef.slotChecks ?? {}).filter(([k, v]) => slotOk(v, rec.slots[k])).length : 0
  };
}

/** Arm-level aggregates. */
export function summarize(records, cases) {
  const byId = new Map(cases.map(c => [c.id, c]));
  const fit = records.filter(r => byId.get(r.case).template !== 'none'), none = records.filter(r => byId.get(r.case).template === 'none');
  const nums = records.map(r => ({ r, n: r.numbers ?? recordNumbers(byId.get(r.case), r) }));
  const sum = f => nums.reduce((s, x) => s + (f(x) ?? 0), 0);
  const verifiedRecs = fit.filter(r => r.judgement.verified);
  const pa = nums.filter(x => x.n.personActions !== null).map(x => x.n.personActions);
  const traps = records.filter(r => byId.get(r.case).trap);
  const cost = records.map(r => r.cost?.usd ?? 0), tokens = records.map(r => r.cost?.tokens ?? 0), wall = records.map(r => r.builderWallMs ?? 0);
  const templateArm = records.some(r => r.templateArm);
  return {
    cases: records.length, fitCases: fit.length, noneCases: none.length,
    verified: verifiedRecs.length, verifiedRate: round(fit.length ? verifiedRecs.length / fit.length : null),
    oraclePassIgnoringVerdict: fit.filter(r => r.judgement.oraclePass).length,
    builtAndValid: fit.filter(r => r.builtValid).length,
    correctRefusals: none.filter(r => r.judgement.correctRefusal).length, falseRefusals: fit.filter(r => r.outcome === 'unsupported').length,
    outcomes: Object.fromEntries([...new Set(records.map(r => r.outcome))].map(o => [o, records.filter(r => r.outcome === o).length])),
    templateCorrect: templateArm ? records.filter(r => (r.template ?? (r.outcome === 'unsupported' ? 'none' : null)) === byId.get(r.case).template).length : null,
    slotChecks: { ok: sum(x => x.n.slotChecksOk), total: sum(x => x.n.slotChecks) },
    requiredQuestions: { asked: sum(x => x.n.requiredAsked), total: sum(x => x.n.requiredQuestions) },
    questionRecall: round(sum(x => x.n.requiredQuestions) ? sum(x => x.n.requiredAsked) / sum(x => x.n.requiredQuestions) : null),
    unnecessaryQuestions: sum(x => x.n.unnecessaryQuestions), repeatQuestions: sum(x => x.n.repeatQuestions), questionsAsked: sum(x => x.n.questionsAsked),
    modelProposedQuestions: templateArm ? records.reduce((s, r) => s + (r.modelQuestions?.length ?? 0), 0) : null,
    traps: { total: traps.length, avoided: traps.filter(r => !r.judgement.trap?.violated).length, violated: traps.filter(r => r.judgement.trap?.violated).map(r => r.case) },
    personActionsToFirstVerifiedRun: { mean: round(mean(pa), 2), median: median(pa), beforeRunMean: round(mean(nums.filter(x => x.n.personActionsBeforeRun !== null).map(x => x.n.personActionsBeforeRun)), 2) },
    cost: { usdTotal: round(cost.reduce((a, b) => a + b, 0), 4), usdPerRequest: round(mean(cost), 5), tokensTotal: tokens.reduce((a, b) => a + b, 0), tokensPerRequest: round(mean(tokens), 0),
      calls: records.reduce((s, r) => s + (r.cost?.calls ?? 0), 0), costUnknownCalls: records.reduce((s, r) => s + (r.cost?.unknown ?? 0), 0) },
    wallSeconds: { mean: round(mean(wall) / 1000, 1), median: round(median(wall) / 1000, 1), total: round(wall.reduce((a, b) => a + b, 0) / 1000, 1) },
    repairs: { rounds: records.reduce((s, r) => s + (r.repairs ?? 0), 0), casesWithRepair: records.filter(r => (r.repairs ?? 0) > 0).length },
    errors: records.filter(r => r.outcome === 'error').map(r => ({ case: r.case, error: r.error }))
  };
}
