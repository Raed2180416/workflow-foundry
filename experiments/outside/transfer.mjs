// OUT-0 (FIRST-CLASS-PROGRAMS §6.4): the matched-contrast transfer table skeleton, read from S1 claim rows. $0, pure.
// One contrast across beds of different origin: practise in a mock before acting vs act cold, the same arm pair on each
// bed. F6's capability number is the ratio of the outside effect to the in-generator effect, with an interval and a
// same-sign check; it stays pending until an outside bed carries the same contrast. The arms differ in amortisation
// (build once vs rehearse every task). A1 vs A0 (a harness vs the raw official loop) is a different contrast: it gets its
// own rows and is never paired with E8.

/** Exact two-sided McNemar p from discordant counts b, c (binomial, p = 0.5). */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let p = 0;
  for (let i = 0; i <= k; i++) p += binom(n, i) * 0.5 ** n;
  return Math.min(1, 2 * p);
}
function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }

/** The smallest number of discordant pairs, all in one direction, that reaches two-sided p < alpha; and that share of n. */
export function mcnemarMde(n, alpha = 0.05) {
  for (let d = 1; d <= n; d++) if (mcnemarExact(d, 0) < alpha) return { discordant: d, share: d / n, p: mcnemarExact(d, 0) };
  return { discordant: null, share: null, p: null, note: `no split of ${n} pairs reaches p < ${alpha}` };
}

/**
 * Paired comparison of two arms on the same cases. With per-task binary rows the pairs are exact. With count rows
 * (several cases in one row) pairing is only possible when one arm passes every case (then every discordant case favours
 * it); otherwise the discordant split is unknown and p is null.
 */
export function pairArms(aRows, bRows) {
  const byKey = rs => new Map(rs.map(r => [r.task.key, r]));
  const A = byKey(aRows), B = byKey(bRows);
  const keys = [...A.keys()].filter(k => B.has(k));
  let aOnly = 0, bOnly = 0, cases = 0, aS = 0, bS = 0, exact = true;
  const pcA = [], pcB = [];
  for (const k of keys) {
    const a = A.get(k), b = B.get(k);
    if (a.verdict.kind === 'binary' && b.verdict.kind === 'binary') {
      cases += 1; aS += a.verdict.successes; bS += b.verdict.successes;
      if (a.verdict.pass && !b.verdict.pass) aOnly += 1; else if (!a.verdict.pass && b.verdict.pass) bOnly += 1;
      if (Number.isFinite(a.verdict.score) && Number.isFinite(b.verdict.score)) { pcA.push(a.verdict.score); pcB.push(b.verdict.score); }
    } else {
      const n = a.verdict.total;
      if (n !== b.verdict.total) { exact = false; continue; }
      cases += n; aS += a.verdict.successes; bS += b.verdict.successes;
      if (a.verdict.successes === n) aOnly += n - b.verdict.successes;
      else if (b.verdict.successes === n) bOnly += n - a.verdict.successes;
      else exact = false;
    }
  }
  const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return { pairedKeys: keys.length, cases, aSuccesses: aS, bSuccesses: bS, effect: cases ? (aS - bS) / cases : null,
    discordant: exact ? { aOnly, bOnly } : null, mcnemarP: exact ? mcnemarExact(aOnly, bOnly) : null, mde: cases ? mcnemarMde(cases) : null,
    meanScore: pcA.length ? { a: mean(pcA), b: mean(pcB), n: pcA.length } : null };
}

const usable = r => r.rowKind === 'task' && r.verdict.kind !== 'none' && !r.verdict.excluded && !r.refs?.supersededBy;

/** The transfer table skeleton. */
export function transferTable(rows) {
  const u = rows.filter(usable);
  const pick = f => u.filter(f);
  const e8a = pick(r => r.task.bed === 'ebed-e8' && r.run === 'grade-s12-b1lh-e8-1');
  const e8b = pick(r => r.task.bed === 'ebed-e8' && r.run === 'agenth-e8-s12');
  const e8 = pairArms(e8a, e8b);
  const reading = p => (p.mcnemarP === null ? 'inconclusive (discordant split unknown)' : p.mcnemarP < 0.05 ? 'resolved at alpha 0.05' : 'inconclusive (below the MDE)');
  const matched = [
    { bed: 'E8 (world 1232 d2 size 12)', origin: 'ours', practiseFirst: 'B1L-H lineage 1 (build with a smoke loop on practice worlds)', cold: 'agent-H',
      amortisation: 'build once, then run every world; agent-H acts cold on every tick', status: e8.cases ? 'observed (development, K = 1)' : 'missing', ...e8, reading: e8.cases ? reading(e8) : null },
    { bed: 'AB-R', origin: 'ours-grounded', practiseFirst: 'wf-H (built on practice streams)', cold: 'agent-H', status: 'pending: AB-R has not run', cases: 0 },
    { bed: 'AutomationBench', origin: 'outside-world-outside-grader', practiseFirst: 'rehearse-H (MA-0: works a fork, then acts)', cold: 'agent-H',
      amortisation: 'rehearse on every task (nothing to amortise at N = 1)', status: 'pending: MA-0 has not run', cases: 0 },
  ];
  // A1 (harness) vs A0 (raw official loop), per model, on the same dev-train tasks: its own rows.
  const harness = [];
  // Explicit run pairs: same tasks, same settings (the Sonnet pair ran with --date-note on both arms).
  for (const [model, r1, r0] of [['claude-haiku-5-5', 'a1-dev-first6', 'a0-dev-first6'], ['claude-sonnet-5-5', 'a1s-dev-first6', 'a0s-dev-first6']]) {
    const a1 = pick(r => r.task.bed === 'automationbench' && r.run === r1);
    const a0 = pick(r => r.task.bed === 'automationbench' && r.run === r0);
    if (!a1.length || !a0.length) continue;
    const p = pairArms(a1, a0);
    harness.push({ contrast: 'A1 (harness) vs A0 (raw official loop)', model, runs: { a1: r1, a0: r0 },
      note: 'a different contrast from the matched one; never paired with E8', ...p, reading: reading(p) });
  }
  const f6 = { number: null, status: 'pending: needs the matched contrast on an outside bed (MA-0 on AutomationBench, then AB-R)',
    definition: 'outside effect / in-generator effect of the same arm pair, with an interval, and whether the signs agree (§6.1)' };
  return { matched, harness, f6 };
}
