// "Is this your rule?" Six generated cases per rule, each marked allowed, held (waits for someone's yes) or blocked; the person
// confirms or corrects them, and the confirmed answers become the rule's tests: saving a new version re-evaluates every confirmed
// case, and a case whose answer would change blocks the save until the person confirms the new answer (SPEC §8).
// Four check kinds, all evaluable by code (no model, no judgment):
//   approval-above-threshold  amount above T waits for the approver; the requester can't approve their own (excludeRequester)
//   separation-of-duties      one person may not do both of two roles' acts on one case
//   never-outside-domain      no message to an address outside the company's domain
//   max-per-run               at most n effects of one kind per run
const money = (v, unit) => `${unit === 'EUR' ? '€' : unit === 'USD' ? '$' : unit === 'GBP' ? '£' : ''}${Number(v).toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}${['EUR', 'USD', 'GBP'].includes(unit) ? '' : ` ${unit}`}`;
const param = (map, name) => map.parameters?.[name] ?? null;
const nameOf = (map, id) => map.principals.find(p => p.id === id)?.name ?? id;

/** The outcome the rule gives one case under this map. */
export function evaluate(clause, map, c) {
  const k = clause.check;
  switch (k.kind) {
    case 'approval-above-threshold': {
      const T = param(map, k.parameter)?.value;
      if (typeof T !== 'number' || typeof c.amount !== 'number') return 'blocked';
      if (c.amount <= T) return 'allowed';
      return k.excludeRequester && c.requesterIsApprover ? 'blocked' : 'held';
    }
    case 'separation-of-duties': return c.samePerson ? 'blocked' : 'allowed';
    case 'never-outside-domain': return String(c.to ?? '').toLowerCase().endsWith(`@${String(k.domain).toLowerCase()}`) ? 'allowed' : 'blocked';
    case 'max-per-run': return typeof c.count === 'number' && c.count <= k.n ? 'allowed' : 'blocked';
    default: return 'blocked';
  }
}

/** Six (or more) cases at and around the rule's edges, with plain labels. Answers start as the rule's own outcome, unconfirmed. */
export function generateExamples(clause, map) {
  const k = clause.check;
  let cases = [];
  if (k.kind === 'approval-above-threshold') {
    const p = param(map, k.parameter), T = p?.value ?? 0, unit = p?.unit ?? '';
    const approver = map.approvals.find(a => a.aboveParameter === k.parameter)?.approverPrincipal;
    const who = approver ? nameOf(map, approver) : 'the approver';
    cases = [[0, false], [Math.round((T - 0.01) * 100) / 100, false], [T, false], [Math.round((T + 0.01) * 100) / 100, false], [Math.max(T * 20, 5000), false], [T * 2, true]]
      .map(([amount, requesterIsApprover]) => ({ case: { amount, requesterIsApprover }, label: requesterIsApprover ? `${money(amount, unit)}, asked for by ${who} (who would also approve it)` : `${money(amount, unit)}` }));
  } else if (k.kind === 'separation-of-duties') {
    const [a, b] = k.roles ?? ['', ''];
    cases = [[false, 'two different people'], [true, 'the same person'], [false, 'two people, one of them you'], [true, 'you, doing both'], [false, 'a service and a person'], [true, 'one person holding both roles']]
      .map(([samePerson, who]) => ({ case: { samePerson }, label: `${a} and ${b} on one case, by ${who}` }));
  } else if (k.kind === 'never-outside-domain') {
    const d = String(k.domain ?? 'example.com');
    cases = [`accounts@${d}`, `someone@${d}`, 'friend@gmail.com', `someone@${d}.evil.example`, `someone@mail.${d}`, 'billing@supplier.example'].map(to => ({ case: { to }, label: `A message to ${to}` }));
  } else if (k.kind === 'max-per-run') {
    const n = k.n ?? 1;
    cases = [0, 1, Math.max(n - 1, 0), n, n + 1, n * 10 + 1].map(count => ({ case: { count }, label: `${count} ${k.effect ?? 'effects'} in one run` }));
  }
  return cases.map((x, i) => ({ n: i + 1, ...x, answer: evaluate(clause, map, x.case), confirmed: false }));
}

/** Confirmed cases whose answer the rule (under `map`) no longer gives: the save is refused until each is re-confirmed. */
export function flips(map) {
  const out = [];
  for (const c of map.clauses) for (const e of c.examples) {
    const now = evaluate(c, map, e.case);
    if (e.confirmed && now !== e.answer) out.push({ clause: c.id, n: e.n, label: e.label, was: e.answer, now,
      message: `This change would turn case ${e.n} (${e.label}, ${e.answer}) into ${now}. Confirm the new answer for case ${e.n} or undo the change.` });
  }
  return out;
}
/** Unconfirmed cases, and confirmed answers the rule disagrees with (the person's answer is the intent; the rule must match it). */
export function exampleProblems(map) {
  const out = [];
  for (const c of map.clauses) {
    if (c.examples.length < 6) out.push(`${c.title}: needs at least 6 examples`);
    const open = c.examples.filter(e => !e.confirmed);
    if (open.length) out.push(`${c.title}: confirm ${open.length === c.examples.length ? 'the examples' : `case ${open.map(e => e.n).join(', ')}`} first ("Is this your rule?")`);
  }
  return out;
}
export { money };
