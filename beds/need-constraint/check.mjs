// Constraint checkers for the need-constraint bed. Each takes the (host-rebuilt) spec and an already
// schema-validated answer and returns { checks: [{ id, ok, detail }], pass, score }.
// score = fraction of the ACTIVE rule categories that hold, so score === 1 exactly when pass is true.
// A checker accepts ANY answer that satisfies the stated rules; it never compares against a reference answer.

export function summarize(checks) {
  const ok = checks.filter(c => c.ok).length;
  return { checks, pass: ok === checks.length && checks.length > 0, score: checks.length ? ok / checks.length : 0 };
}
const mk = (id, ok, detail = '') => ({ id, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 160) });
const firstBad = (items, bad) => items.filter(bad).slice(0, 3).join(', ');

// ---------------------------------------------------------------- (a) names
export function checkNames(spec, names) {
  const cleaned = names.map(s => s.trim());
  const low = cleaned.map(s => s.toLowerCase());
  const checks = [];
  checks.push(mk('count', cleaned.length === spec.n, `expected ${spec.n} names, got ${cleaned.length}`));
  checks.push(mk('format', cleaned.every(s => /^[A-Za-z]+$/.test(s)), `not letters-only: ${firstBad(cleaned, s => !/^[A-Za-z]+$/.test(s))}`));
  checks.push(mk('length', cleaned.every(s => s.length >= spec.minLen && s.length <= spec.maxLen), `length outside ${spec.minLen}-${spec.maxLen}: ${firstBad(cleaned, s => s.length < spec.minLen || s.length > spec.maxLen)}`));
  if (spec.startSet) checks.push(mk('start', low.every(s => spec.startSet.includes(s[0])), `bad first letter: ${firstBad(cleaned, s => !spec.startSet.includes(s.toLowerCase()[0]))}`));
  if (spec.endSet) checks.push(mk('end', low.every(s => spec.endSet.includes(s[s.length - 1])), `bad last letter: ${firstBad(cleaned, s => !spec.endSet.includes(s.toLowerCase().slice(-1)))}`));
  if (spec.mustContain) checks.push(mk('contain', low.every(s => s.includes(spec.mustContain)), `lacks '${spec.mustContain}': ${firstBad(cleaned, s => !s.toLowerCase().includes(spec.mustContain))}`));
  if (spec.banLetters.length) checks.push(mk('banned-letters', low.every(s => !spec.banLetters.some(l => s.includes(l))), `banned letter: ${firstBad(cleaned, s => spec.banLetters.some(l => s.toLowerCase().includes(l)))}`));
  checks.push(mk('forbidden-substrings', low.every(s => !spec.forbidden.some(f => s.includes(f))), `forbidden sequence: ${firstBad(cleaned, s => spec.forbidden.some(f => s.toLowerCase().includes(f)))}`));
  if (spec.maxRepeat) {
    const worst = s => Math.max(0, ...Object.values([...s].reduce((m, c) => { m[c] = (m[c] ?? 0) + 1; return m; }, {})));
    checks.push(mk('repeat', low.every(s => worst(s) <= spec.maxRepeat), `letter repeated too often: ${firstBad(cleaned, s => worst(s.toLowerCase()) > spec.maxRepeat)}`));
  }
  if (spec.vowelRange) {
    const nv = s => [...s].filter(c => 'aeiou'.includes(c)).length;
    const [a, b] = spec.vowelRange;
    checks.push(mk('vowels', low.every(s => nv(s) >= a && nv(s) <= b), `vowel count outside ${a}-${b}: ${firstBad(cleaned, s => nv(s.toLowerCase()) < a || nv(s.toLowerCase()) > b)}`));
  }
  if (spec.reserved.length) {
    const taken = new Set(spec.reserved.map(s => s.toLowerCase()));
    checks.push(mk('reserved', low.every(s => !taken.has(s)), `reserved name used: ${firstBad(cleaned, s => taken.has(s.toLowerCase()))}`));
  }
  checks.push(mk('distinct', new Set(low).size === low.length, 'duplicate names (ignoring case)'));
  if (spec.distinctInitials) checks.push(mk('distinct-initials', new Set(low.map(s => s[0])).size === low.length, 'two names share a first letter'));
  if (spec.minWith) checks.push(mk('min-with-letter', low.filter(s => s.includes(spec.minWith.letter)).length >= spec.minWith.count, `fewer than ${spec.minWith.count} names contain '${spec.minWith.letter}'`));
  return summarize(checks);
}

// ---------------------------------------------------------------- (b) sentence
const FORM_RE = /^[A-Z][A-Za-z]*(?:,? [A-Za-z]+)*\.$/;
export const tokenize = text => text.match(/[A-Za-z]+/g) ?? [];

// Does some choice of occurrences i1 < i2 < ... satisfy tokens[ij] === words[j] with at least `gap` tokens between neighbours?
export function embeds(tokens, words, gap = 0) {
  let feasible = null; // indices where the previous word can end
  for (let j = 0; j < words.length; j++) {
    const here = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== words[j]) continue;
      if (j === 0 || feasible.some(p => i - p - 1 >= gap)) here.push(i);
    }
    if (!here.length) return false;
    feasible = here;
  }
  return true;
}

export function checkSentence(spec, sentence) {
  const text = sentence.trim();
  const formOk = FORM_RE.test(text);
  const toks = tokenize(text).map(t => t.toLowerCase());
  const R = spec.rules;
  const checks = [];
  checks.push(mk('form', formOk, 'must be one sentence: capital first letter, letters/single spaces/commas only, one final period'));
  checks.push(mk('word-count', toks.length >= spec.minWords && toks.length <= spec.maxWords, `${toks.length} words, wanted ${spec.minWords}-${spec.maxWords}`));
  checks.push(mk('required-order', embeds(toks, spec.required, 0), `required words not all present in order: ${spec.required.join(' < ')}`));
  const bad = new Set(spec.forbidden);
  checks.push(mk('forbidden-words', toks.every(t => !bad.has(t)), `forbidden word used: ${[...new Set(toks.filter(t => bad.has(t)))].slice(0, 3).join(', ')}`));
  if (R.noRepeat) checks.push(mk('no-repeat', new Set(toks).size === toks.length, 'a word is used twice'));
  if (R.commas !== null && R.commas !== undefined) checks.push(mk('commas', (text.match(/,/g) ?? []).length === R.commas, `needs exactly ${R.commas} comma(s)`));
  if (R.banLetter) checks.push(mk('banned-letter', !text.toLowerCase().includes(R.banLetter), `contains '${R.banLetter}'`));
  if (R.longWord) checks.push(mk('long-word', toks.some(t => t.length >= R.longWord), `no word of ${R.longWord}+ letters`));
  if (R.startWord) checks.push(mk('first-word', toks[0] === R.startWord, `first word must be '${R.startWord}'`));
  if (R.endWord) checks.push(mk('last-word', toks[toks.length - 1] === R.endWord, `last word must be '${R.endWord}'`));
  if (R.minGap) checks.push(mk('gap', embeds(toks, spec.required, R.minGap), `required words need >= ${R.minGap} other word(s) between them`));
  return summarize(checks);
}

// ---------------------------------------------------------------- (c) order
export const ORDER_KINDS = ['before', 'next', 'apart', 'pos', 'between', 'gap', 'exact', 'notEnd'];

function orderHolds(c, pos, n) {
  const dx = Math.abs(pos[c.a] - pos[c.b]);
  switch (c.kind) {
    case 'before': return pos[c.a] < pos[c.b];
    case 'next': return pos[c.b] === pos[c.a] + 1;
    case 'apart': return dx >= 2;
    case 'pos': return pos[c.a] === c.k - 1;
    case 'between': return (pos[c.b] < pos[c.a] && pos[c.a] < pos[c.c]) || (pos[c.c] < pos[c.a] && pos[c.a] < pos[c.b]);
    case 'gap': return dx >= c.d + 1;
    case 'exact': return dx === c.d + 1;
    case 'notEnd': return pos[c.a] !== 0 && pos[c.a] !== n - 1;
    default: return false;
  }
}

export function checkOrder(spec, order) {
  const cleaned = order.map(s => s.trim());
  const n = spec.items.length;
  const pos = Object.create(null);
  cleaned.forEach((x, i) => { pos[x] = i; });
  const isPerm = cleaned.length === n && new Set(cleaned).size === n && spec.items.every(x => x in pos);
  const checks = [mk('permutation', isPerm, `must list each of the ${n} items exactly once (got ${cleaned.length} entries, ${new Set(cleaned).size} distinct)`)];
  const kinds = ORDER_KINDS.filter(k => spec.constraints.some(c => c.kind === k));
  for (const k of kinds) {
    const mine = spec.constraints.filter(c => c.kind === k);
    const failing = isPerm ? mine.filter(c => !orderHolds(c, pos, n)) : mine;
    checks.push(mk(`c-${k}`, failing.length === 0, isPerm ? `${failing.length} of ${mine.length} '${k}' statements violated` : 'not a permutation'));
  }
  return summarize(checks);
}

// ---------------------------------------------------------------- (d) schedule
export const slotKey = (day, shift) => `${day}|${shift}`;

export function checkSchedule(spec, rows) {
  const { days, shifts, people } = spec;
  const K = shifts.length;
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const shiftIdx = new Map(shifts.map((s, i) => [s, i]));
  const byName = new Map(people.map(p => [p.name, p]));
  const checks = [];
  // rows-valid: known day/shift/person, no repeated (slot, person)
  const seen = new Set();
  const good = [];
  let badRows = 0;
  for (const r of rows) {
    const key = `${r.day}|${r.shift}|${r.person}`;
    if (!dayIdx.has(r.day) || !shiftIdx.has(r.shift) || !byName.has(r.person) || seen.has(key)) { badRows++; continue; }
    seen.add(key);
    good.push({ d: dayIdx.get(r.day), s: shiftIdx.get(r.shift), person: r.person });
  }
  checks.push(mk('rows-valid', badRows === 0, `${badRows} row(s) with an unknown day/shift/person or a repeated row`));
  const inSlot = new Map();
  for (const g of good) { const k = g.d * K + g.s; if (!inSlot.has(k)) inSlot.set(k, []); inSlot.get(k).push(g.person); }
  const slots = days.length * K;
  let wrongCount = 0;
  for (let k = 0; k < slots; k++) if ((inSlot.get(k) ?? []).length !== spec.need[k]) wrongCount++;
  checks.push(mk('slot-counts', wrongCount === 0, `${wrongCount} slot(s) do not have exactly the required number of people`));
  const unavail = new Set();
  for (const u of spec.unavailable) {
    if (u.shift === null) for (let s = 0; s < K; s++) unavail.add(`${u.person}|${dayIdx.get(u.day)}|${s}`);
    else unavail.add(`${u.person}|${dayIdx.get(u.day)}|${shiftIdx.get(u.shift)}`);
  }
  checks.push(mk('availability', good.every(g => !unavail.has(`${g.person}|${g.d}|${g.s}`)), 'someone works a slot they are unavailable for'));
  const perDay = new Map();
  for (const g of good) { const k = `${g.person}|${g.d}`; perDay.set(k, (perDay.get(k) ?? 0) + 1); }
  checks.push(mk('one-per-day', [...perDay.values()].every(v => v <= 1), 'someone works two shifts on one day'));
  const total = new Map(people.map(p => [p.name, 0]));
  for (const g of good) total.set(g.person, total.get(g.person) + 1);
  checks.push(mk('limits', people.every(p => total.get(p.name) >= spec.limits[p.name].min && total.get(p.name) <= spec.limits[p.name].max),
    `weekly shift counts outside limits: ${people.filter(p => total.get(p.name) < spec.limits[p.name].min || total.get(p.name) > spec.limits[p.name].max).map(p => p.name).slice(0, 3).join(', ')}`));
  const R = spec.rules;
  if (R.apartPairs.length) {
    checks.push(mk('never-together', R.apartPairs.every(([a, b]) => ![...inSlot.values()].some(ps => ps.includes(a) && ps.includes(b))), 'a forbidden pair shares a slot'));
  }
  if (R.noClopen && K >= 2) {
    const works = (p, d, s) => seen.has(`${days[d]}|${shifts[s]}|${p}`);
    let viol = false;
    for (const p of people) for (let d = 1; d < days.length; d++) if (works(p.name, d - 1, K - 1) && works(p.name, d, 0)) viol = true;
    checks.push(mk('rest-rule', !viol, `someone works the last shift of a day and the first shift of the next`));
  }
  if (R.leadShifts.length) {
    const leadOf = name => byName.get(name).role === 'lead';
    let viol = false;
    for (let d = 0; d < days.length; d++) for (const sName of R.leadShifts) {
      const k = d * K + shiftIdx.get(sName);
      if (!(inSlot.get(k) ?? []).some(leadOf)) viol = true;
    }
    checks.push(mk('lead-coverage', !viol, `a ${R.leadShifts.join('/')} slot has no lead`));
  }
  if (R.traineeNeedsLead) {
    let viol = false;
    for (const ps of inSlot.values()) if (ps.some(p => byName.get(p).role === 'trainee') && !ps.some(p => byName.get(p).role === 'lead')) viol = true;
    checks.push(mk('trainee-with-lead', !viol, 'a trainee works a slot without a lead'));
  }
  if (R.maxStreak) {
    let viol = false;
    for (const p of people) {
      let run = 0;
      for (let d = 0; d < days.length; d++) {
        const works = shifts.some((_, s) => seen.has(`${days[d]}|${shifts[s]}|${p.name}`));
        run = works ? run + 1 : 0;
        if (run > R.maxStreak) viol = true;
      }
    }
    checks.push(mk('streak', !viol, `someone works more than ${R.maxStreak} days in a row`));
  }
  return summarize(checks);
}
