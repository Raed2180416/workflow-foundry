// Reference and alternative solvers for the need-constraint bed. Trusted host code: arms never see it.
// names / sentence: seeded constructive generation filtered by the checker's own rules.
// order / schedule: depth-first search with constraint pruning (the contract's "reference solves by search").
import { CODAS, CONSONANTS, FILLER_POOL, INITIALS, LONG_WORDS, ONSETS, VOWELS, VOWEL_CLUSTERS, cap } from './lexicon.mjs';
import { checkNames, checkOrder, checkSchedule, checkSentence } from './check.mjs';

// ---------------------------------------------------------------- coined names (also used for items and people)
/** One coined lowercase name. style 'syll' stitches syllables; style 'cv' alternates consonant/vowel letters. */
export function coin(r, { initial = null, style = 'syll', length = 0, endSet = null, letter = null } = {}) {
  let name = '';
  if (style === 'cv') {
    const L = length || r.int(5, 8);
    for (let i = 0; i < L; i++) {
      const wantVowel = i % 2 === 1;
      if (i === 0 && initial) name += initial;
      else name += r.pick(wantVowel ? VOWELS : CONSONANTS);
    }
    if (endSet) name = name.slice(0, -1) + r.pick(endSet);
  } else {
    const syllables = r.int(2, 3);
    for (let i = 0; i < syllables; i++) {
      const onsets = i === 0 && initial ? ONSETS.filter(o => o[0] === initial) : ONSETS;
      name += r.pick(onsets) + r.pick(VOWEL_CLUSTERS) + (i === syllables - 1 || r.chance(0.2) ? r.pick(CODAS) : '');
    }
  }
  if (letter && !name.includes(letter)) { const at = r.int(1, name.length - 1); name = name.slice(0, at) + letter + name.slice(at); }
  return name;
}

/** n distinct capitalised coined names, 4-8 letters (items for the order task, people for the rota). */
export function coinedNames(r, n, { minLen = 4, maxLen = 8, avoid = [] } = {}) {
  const out = []; const seen = new Set(avoid.map(s => s.toLowerCase()));
  for (let guard = 0; out.length < n && guard < 5000; guard++) {
    const nm = coin(r, {});
    if (nm.length < minLen || nm.length > maxLen || seen.has(nm)) continue;
    seen.add(nm); out.push(cap(nm));
  }
  if (out.length < n) throw new Error('could not coin enough names');
  return out;
}

// ---------------------------------------------------------------- (a) names
/** A spec with only the per-name rules (no set rules), used to filter single candidates. */
export const singleNameSpec = spec => ({ ...spec, n: 1, reserved: [], distinctInitials: false, minWith: null });

/** Names satisfying all rules, drawn with generator `style`. Throws when the budget runs out. */
export function solveNames(spec, r, style = 'syll', { forbidReserved = true } = {}) {
  const single = singleNameSpec(spec);
  const taken = new Set(forbidReserved ? spec.reserved.map(s => s.toLowerCase()) : []);
  const initials = spec.startSet ?? INITIALS.filter(l => !spec.banLetters.includes(l));
  let targets;
  if (spec.distinctInitials) targets = r.sample(initials, spec.n);
  else targets = Array.from({ length: spec.n }, () => (spec.startSet ? r.pick(spec.startSet) : null));
  const out = [];
  for (let i = 0; i < spec.n; i++) {
    const wantLetter = spec.minWith && i < spec.minWith.count ? spec.minWith.letter : (spec.mustContain ?? null);
    let found = null;
    for (let tries = 0; tries < 20000 && !found; tries++) {
      const length = style === 'cv' ? r.int(spec.minLen, spec.maxLen) : 0;
      const cand = coin(r, { initial: targets[i], style, length, endSet: style === 'cv' ? spec.endSet : null, letter: wantLetter });
      if (taken.has(cand) || !checkNames(single, [cand]).pass) continue;
      found = cand;
    }
    if (!found) throw new Error(`names: no candidate for slot ${i}`);
    taken.add(found); out.push(found);
  }
  // Return in a seeded display order with mixed capitalisation style: Capitalised, as a product name would be.
  return r.shuffle(out).map(cap);
}

// ---------------------------------------------------------------- (b) sentence
/** One sentence meeting the spec, assembled from required words and filler words. Throws if it cannot. */
export function solveSentence(spec, r, { allowRepeats = false } = {}) {
  const R = spec.rules; const m = spec.required.length;
  const forbid = new Set(spec.forbidden); const req = new Set(spec.required);
  const anchors = [R.startWord, R.endWord].filter(Boolean);
  const okWord = w => !forbid.has(w) && !req.has(w) && !anchors.includes(w) && !(R.banLetter && w.includes(R.banLetter));
  const pool = FILLER_POOL.filter(okWord);
  const longs = R.longWord ? LONG_WORDS.filter(w => okWord(w) && w.length >= R.longWord) : [];
  if (R.longWord && !longs.length) throw new Error('sentence: no long word available');
  const gap = R.minGap || 0;
  const lowest = m + anchors.length + gap * (m - 1) + (R.longWord ? 1 : 0);
  const L = r.int(Math.max(spec.minWords, lowest), spec.maxWords);
  if (L < lowest) throw new Error('sentence: window too small');
  const F = L - m - anchors.length;
  // fillers
  let fillers;
  if (R.noRepeat || !allowRepeats) fillers = r.sample(pool, F);
  else fillers = Array.from({ length: F }, () => r.pick(pool));
  if (fillers.length < F) throw new Error('sentence: filler pool too small');
  if (R.longWord) fillers[r.int(0, F - 1)] = r.pick(longs);
  // distribute fillers over the m+1 gaps: gap[1..m-1] hold at least `gap` fillers
  const sizes = Array.from({ length: m + 1 }, (_, j) => (j >= 1 && j <= m - 1 ? gap : 0));
  for (let extra = F - gap * (m - 1); extra > 0; extra--) sizes[r.int(0, m)]++;
  const tokens = []; let at = 0;
  if (R.startWord) tokens.push(R.startWord);
  for (let j = 0; j <= m; j++) {
    for (let t = 0; t < sizes[j]; t++) tokens.push(fillers[at++]);
    if (j < m) tokens.push(spec.required[j]);
  }
  if (R.endWord) tokens.push(R.endWord);
  const commaAfter = new Set(r.sample(Array.from({ length: tokens.length - 1 }, (_, i) => i), R.commas ?? 0));
  const body = tokens.map((t, i) => (i === 0 ? cap(t) : t) + (commaAfter.has(i) ? ',' : '')).join(' ');
  const sentence = `${body}.`;
  if (!checkSentence(spec, sentence).pass) throw new Error('sentence: constructed sentence fails its own checker');
  return sentence;
}

// ---------------------------------------------------------------- (c) order
function compileOrder(spec) {
  const n = spec.items.length; const idx = new Map(spec.items.map((x, i) => [x, i]));
  const cons = spec.constraints.map(c => ({ kind: c.kind, a: idx.get(c.a), b: c.b === undefined ? -1 : idx.get(c.b), c: c.c === undefined ? -1 : idx.get(c.c), d: c.d ?? 0, k: c.k ?? 0 }));
  const involve = Array.from({ length: n }, () => []);
  const fixedAt = new Array(n).fill(-1); const fixedPos = new Array(n).fill(-1);
  const succ = new Array(n).fill(-1); const pred = new Array(n).fill(-1);
  let impossible = false;
  for (const c of cons) {
    for (const x of new Set([c.a, c.b, c.c])) if (x >= 0) involve[x].push(c);
    if (c.kind === 'pos') { if (fixedAt[c.k - 1] >= 0 && fixedAt[c.k - 1] !== c.a) impossible = true; fixedAt[c.k - 1] = c.a; fixedPos[c.a] = c.k - 1; }
    if (c.kind === 'next') { if ((succ[c.a] >= 0 && succ[c.a] !== c.b) || (pred[c.b] >= 0 && pred[c.b] !== c.a)) impossible = true; succ[c.a] = c.b; pred[c.b] = c.a; }
  }
  return { n, cons, involve, fixedAt, fixedPos, succ, pred, impossible };
}

/**
 * Depth-first search for orderings. mode: 'index' (item list order), 'reverse', or 'random' (needs rng).
 * Returns { solutions: [[item names]...], nodes, complete } where complete=false means the node budget ran out.
 */
export function solveOrder(spec, { mode = 'index', rng = null, limit = 1, maxNodes = 300000 } = {}) {
  const { n, involve, fixedAt, fixedPos, succ, pred, impossible } = compileOrder(spec);
  const solutions = []; let nodes = 0; let aborted = false;
  if (impossible) return { solutions, nodes, complete: true };
  let base = Array.from({ length: n }, (_, i) => i);
  if (mode === 'reverse') base.reverse();
  if (mode === 'random') base = rng.shuffle(base);
  const pos = new Array(n).fill(-1); const seq = new Array(n).fill(-1);

  const ok = (x, p) => {
    if (fixedPos[x] >= 0 && fixedPos[x] !== p) return false;
    if (fixedAt[p] >= 0 && fixedAt[p] !== x) return false;
    if (pred[x] >= 0 && (p === 0 || seq[p - 1] !== pred[x])) return false;
    if (succ[x] >= 0 && (p === n - 1 || pos[succ[x]] >= 0)) return false;
    for (const c of involve[x]) {
      switch (c.kind) {
        case 'before': if (x === c.b && pos[c.a] < 0) return false; if (x === c.a && pos[c.b] >= 0) return false; break;
        case 'next': if (x === c.b && pos[c.a] !== p - 1) return false; break;
        case 'apart': { const o = x === c.a ? c.b : c.a; if (pos[o] >= 0 && Math.abs(p - pos[o]) < 2) return false; break; }
        case 'gap': { const o = x === c.a ? c.b : c.a; if (pos[o] >= 0 && Math.abs(p - pos[o]) < c.d + 1) return false; break; }
        case 'exact': { const o = x === c.a ? c.b : c.a; if (pos[o] >= 0 && Math.abs(p - pos[o]) !== c.d + 1) return false; break; }
        case 'notEnd': if (p === 0 || p === n - 1) return false; break;
        case 'between':
          if (x === c.a) { if ((pos[c.b] >= 0) === (pos[c.c] >= 0)) return false; }
          else { const o = x === c.b ? c.c : c.b; if (pos[o] >= 0 && pos[c.a] < 0) return false; }
          break;
        default: break;
      }
    }
    return true;
  };

  const rec = p => {
    if (aborted || solutions.length >= limit) return;
    if (++nodes > maxNodes) { aborted = true; return; }
    if (p === n) { solutions.push(seq.map(i => spec.items[i])); return; }
    const prev = p > 0 ? seq[p - 1] : -1;
    const cands = fixedAt[p] >= 0 ? [fixedAt[p]] : (prev >= 0 && succ[prev] >= 0 ? [succ[prev]] : base);
    for (const x of cands) {
      if (pos[x] >= 0 || !ok(x, p)) continue;
      pos[x] = p; seq[p] = x;
      rec(p + 1);
      pos[x] = -1; seq[p] = -1;
      if (aborted || solutions.length >= limit) return;
    }
  };
  rec(0);
  for (const s of solutions) if (!checkOrder(spec, s).pass) throw new Error('order: search returned an invalid ordering');
  return { solutions, nodes, complete: !aborted };
}

// ---------------------------------------------------------------- (d) schedule
/**
 * Depth-first search for rotas, slot by slot (day-major). mode: 'deficit' (people who still need shifts first),
 * 'balance' (fewest shifts so far first, random ties; used to plant), or 'random'.
 * Returns { solutions: [rows...], nodes, complete }.
 */
export function solveSchedule(spec, { mode = 'deficit', rng = null, limit = 1, maxNodes = 200000 } = {}) {
  const { days, shifts, people } = spec; const R = spec.rules;
  const P = people.length; const D = days.length; const K = shifts.length; const S = D * K;
  const names = people.map(p => p.name); const pIdx = new Map(names.map((nm, i) => [nm, i]));
  const isLead = people.map(p => p.role === 'lead'); const isTrainee = people.map(p => p.role === 'trainee');
  const avail = Array.from({ length: P }, () => new Uint8Array(S).fill(1));
  for (const u of spec.unavailable) {
    const p = pIdx.get(u.person); const d = days.indexOf(u.day);
    if (u.shift === null) for (let s = 0; s < K; s++) avail[p][d * K + s] = 0; else avail[p][d * K + shifts.indexOf(u.shift)] = 0;
  }
  const min = names.map(nm => spec.limits[nm].min); const max = names.map(nm => spec.limits[nm].max);
  const availDaysFrom = Array.from({ length: P }, (_, p) => {
    const a = new Int16Array(D + 1);
    for (let d = D - 1; d >= 0; d--) { let any = 0; for (let s = 0; s < K; s++) if (avail[p][d * K + s]) any = 1; a[d] = a[d + 1] + any; }
    return a;
  });
  const apart = Array.from({ length: P }, () => new Set());
  for (const [a, b] of R.apartPairs) { apart[pIdx.get(a)].add(pIdx.get(b)); apart[pIdx.get(b)].add(pIdx.get(a)); }
  const leadShift = new Set(R.leadShifts.map(s => shifts.indexOf(s)));
  const count = new Int16Array(P); const worked = Array.from({ length: P }, () => new Int8Array(D).fill(-1));
  const assign = new Array(S); const solutions = []; let nodes = 0; let aborted = false;

  const reachable = (p, d, s) => {
    // upper bound on the shifts p can still add after finishing slot (d, s)
    let rem = availDaysFrom[p][d + 1];
    if (worked[p][d] < 0) for (let t = s + 1; t < K; t++) if (avail[p][d * K + t]) { rem += 1; break; }
    return count[p] + rem >= min[p];
  };

  const slot = k => {
    if (aborted || solutions.length >= limit) return;
    if (k === S) {
      for (let p = 0; p < P; p++) if (count[p] < min[p]) return;
      const rows = [];
      for (let q = 0; q < S; q++) for (const p of [...assign[q]].sort((a, b) => a - b)) rows.push({ day: days[Math.floor(q / K)], shift: shifts[q % K], person: names[p] });
      solutions.push(rows); return;
    }
    const d = Math.floor(k / K); const s = k % K; const need = spec.need[k];
    let cands = [];
    for (let p = 0; p < P; p++) {
      if (!avail[p][k] || worked[p][d] >= 0 || count[p] >= max[p]) continue;
      if (R.noClopen && K >= 2 && s === 0 && d > 0 && worked[p][d - 1] === K - 1) continue;
      if (R.maxStreak) { let run = 0; for (let e = d - 1; e >= 0 && worked[p][e] >= 0; e--) run++; if (run >= R.maxStreak) continue; }
      cands.push(p);
    }
    if (cands.length < need) return;
    const leadNeeded = leadShift.has(s);
    if (leadNeeded && !cands.some(p => isLead[p])) return;
    const urgency = p => (min[p] - count[p]) - availDaysFrom[p][d];
    if (mode === 'random') cands = rng.shuffle(cands);
    else if (mode === 'balance') cands = rng.shuffle(cands).sort((a, b) => count[a] - count[b]);
    else cands.sort((a, b) => urgency(b) - urgency(a) || count[a] - count[b] || a - b);
    const chosen = [];
    const pick = start => {
      if (aborted || solutions.length >= limit) return;
      if (chosen.length === need) {
        if (++nodes > maxNodes) { aborted = true; return; }
        const hasLead = chosen.some(p => isLead[p]);
        if (leadNeeded && !hasLead) return;
        if (!hasLead && chosen.some(p => isTrainee[p])) return;
        for (const p of chosen) { count[p]++; worked[p][d] = s; }
        assign[k] = [...chosen];
        let feasible = true;
        for (let p = 0; p < P && feasible; p++) feasible = reachable(p, d, s);
        if (feasible) slot(k + 1);
        for (const p of chosen) { count[p]--; worked[p][d] = -1; }
        return;
      }
      for (let i = start; i <= cands.length - (need - chosen.length); i++) {
        const p = cands[i];
        if (chosen.some(q => apart[p].has(q))) continue;
        chosen.push(p); pick(i + 1); chosen.pop();
        if (aborted || solutions.length >= limit) return;
      }
    };
    pick(0);
  };
  slot(0);
  for (const rows of solutions) if (!checkSchedule(spec, rows).pass) throw new Error('schedule: search returned an invalid rota');
  return { solutions, nodes, complete: !aborted };
}

