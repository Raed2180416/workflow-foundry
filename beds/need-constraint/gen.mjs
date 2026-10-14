// Generator for the `need-constraint` bed. build(seed, split, difficulty) -> { task, spec, truth }.
// Pure: every random choice comes from beds/lib/rng.mjs seeded by (family, version, split, seed, difficulty, attempt, tag).
// `spec` is what the oracle checks against (rebuilt from the seed, never read from the task). `truth` holds the
// hidden planted material and the known-good solutions; none of it is rendered into the task.
import { estimateTokens } from '../lib/canonical.mjs';
import { rng } from '../lib/rng.mjs';
import { checkNames } from './check.mjs';
import {
  CATALOGUES, DAYS, END_ANCHORS, FORBID_CONTENT, FUNCTION_WORDS, INITIALS, ORDER_SETTINGS, POSTCARD_TOWNS, PRODUCT_LINES, REQUIRED_POOL,
  RARE_LETTERS, ROTA_PLACES, START_ANCHORS, cap,
} from './lexicon.mjs';
import { coin, coinedNames, singleNameSpec, solveNames, solveOrder, solveSchedule, solveSentence } from './solve.mjs';

export const VERSION = '1.0.0';
export const SUBTYPES = ['names', 'sentence', 'order', 'schedule'];
export const subtypeOf = seed => SUBTYPES[((seed % 4) + 4) % 4];
const MAX_ATTEMPTS = 40;
export const MIN_ORDER_SOLUTIONS = 4;

// ---- difficulty tables (all knobs in one place; documented in README) ----
export const KNOBS = {
  names: {
    1: { n: 3, len: [5, 9], forbidden: 2, ban: 0, reserved: 0 },
    2: { n: 5, len: [5, 8], start: 9, forbidden: 3, ban: 1, reserved: 4 },
    3: { n: 8, len: [5, 8], start: 11, end: 8, forbidden: 5, ban: 2, maxRepeat: 2, reserved: 8 },
    4: { n: 11, len: [6, 8], start: 14, end: 8, must: true, forbidden: 7, ban: 2, maxRepeat: 2, vowels: [2, 3], reserved: 12 },
    5: { n: 14, len: [6, 8], start: 16, end: 7, must: true, forbidden: 9, ban: 2, maxRepeat: 2, vowels: [2, 3], reserved: 16, distinct: true, minWith: 3 },
  },
  sentence: {
    1: { m: 2, forbid: 3, extras: 0, lo: 8, width: 6 },
    2: { m: 3, forbid: 5, extras: 1, lo: 9, width: 5 },
    3: { m: 4, forbid: 8, extras: 2, lo: 10, width: 4 },
    4: { m: 5, forbid: 11, extras: 4, lo: 12, width: 4 },
    5: { m: 6, forbid: 14, extras: 5, lo: 14, width: 3 },
  },
  order: {
    1: { n: 5, c: 4, kinds: ['before', 'next'] },
    2: { n: 7, c: 7, kinds: ['before', 'next', 'apart'] },
    3: { n: 9, c: 11, kinds: ['before', 'next', 'apart', 'pos', 'between'] },
    4: { n: 12, c: 16, kinds: ['before', 'next', 'apart', 'pos', 'between', 'gap', 'notEnd'] },
    5: { n: 15, c: 22, kinds: ['before', 'next', 'apart', 'pos', 'between', 'gap', 'notEnd', 'exact'] },
  },
  schedule: {
    1: { days: 4, shifts: ['day'], P: 4, need: [1, 1], unavail: 0.25, minSlack: [1, 1], maxSlack: [1, 2] },
    2: { days: 5, shifts: ['morning', 'evening'], P: 5, need: [1, 2], unavail: 0.25, minSlack: [1, 1], maxSlack: [1, 2] },
    3: { days: 6, shifts: ['morning', 'evening'], P: 7, need: [1, 2], unavail: 0.25, apart: 1, clopen: true, leadShifts: 1, leads: 3, minSlack: [0, 1], maxSlack: [1, 1] },
    4: { days: 7, shifts: ['morning', 'evening'], P: 8, need: [2, 2], bump: 1, unavail: 0.3, apart: 2, clopen: true, leadShifts: 1, leads: 3, trainees: 1, streak: 5, minSlack: [0, 1], maxSlack: [0, 1] },
    5: { days: 7, shifts: ['morning', 'afternoon', 'evening'], P: 10, need: [1, 2], bump: 1, unavail: 0.3, apart: 3, clopen: true, leadShifts: 'all', leads: 5, trainees: 2, streak: 5, minSlack: [0, 1], maxSlack: [0, 1] },
  },
};

const stream = (split, seed, difficulty, attempt, tag) => rng('need-constraint', VERSION, split, seed, difficulty, attempt, tag);
const upper = list => list.map(x => x.toUpperCase()).join(', ');
const quote = list => list.map(x => `"${x}"`).join(', ');

// ================================================================ (a) names
function buildNames(S, d) {
  const c = KNOBS.names[d]; const r = S('spec');
  const spec = {
    subtype: 'names', n: c.n, minLen: c.len[0], maxLen: c.len[1], startSet: null, endSet: null, mustContain: null, banLetters: [],
    forbidden: [], maxRepeat: c.maxRepeat ?? null, vowelRange: c.vowels ?? null, reserved: [], distinctInitials: Boolean(c.distinct), minWith: null,
    product: r.pick(PRODUCT_LINES), catalogue: r.pick(CATALOGUES),
  };
  spec.banLetters = r.sample(['x', 'z', 'w', 'j', 'v', 'f', 'h'], c.ban).sort();
  const free = l => !spec.banLetters.includes(l);
  if (c.start) spec.startSet = r.sample(INITIALS.filter(free), c.start).sort();
  if (c.end) spec.endSet = r.sample('aeiosnrlmtkd'.split('').filter(free), c.end).sort();
  if (c.must) spec.mustContain = r.pick(['r', 'l', 'n', 's', 't', 'm'].filter(free));
  if (c.minWith) spec.minWith = { letter: r.pick(['k', 'm', 'd', 'b', 'g', 'p'].filter(l => free(l) && l !== spec.mustContain)), count: c.minWith };
  const forb = new Set();
  for (let g = 0; forb.size < c.forbidden && g < 400; g++) {
    const nm = coin(r, {}); const len = r.int(2, 3); const at = r.int(0, Math.max(0, nm.length - len));
    const sub = nm.slice(at, at + len);
    if (sub.length === len && spec.banLetters.every(l => !sub.includes(l))) forb.add(sub);
  }
  spec.forbidden = [...forb].sort();
  // reserved ("already taken") names: half of them obey every per-name rule, so using one breaks that rule alone.
  const single = singleNameSpec(spec); const reserved = new Set();
  for (let g = 0; reserved.size < Math.ceil(c.reserved / 2) && g < 20000; g++) {
    const cand = coin(r, { initial: spec.startSet ? r.pick(spec.startSet) : null, letter: spec.mustContain });
    if (checkNames(single, [cand]).pass) reserved.add(cand);
  }
  for (let g = 0; reserved.size < c.reserved && g < 2000; g++) reserved.add(coin(r, {}));
  spec.reserved = r.shuffle([...reserved]);
  const reference = solveNames(spec, S('ref'), 'syll');
  if (!checkNames(spec, reference).pass) throw new Error('names: reference fails the checker');
  const rules = [
    'Each name is a single word made only of the letters A-Z (either case): no spaces, digits or punctuation.',
    `Each name is between ${spec.minLen} and ${spec.maxLen} letters long, inclusive.`,
  ];
  if (spec.startSet) rules.push(`Each name begins with one of these letters: ${upper(spec.startSet)}.`);
  if (spec.endSet) rules.push(`Each name ends with one of these letters: ${upper(spec.endSet)}.`);
  if (spec.mustContain) rules.push(`Each name contains the letter ${spec.mustContain.toUpperCase()} at least once.`);
  if (spec.banLetters.length) rules.push(`No name contains any of these letters (in either case): ${upper(spec.banLetters)}.`);
  rules.push(`No name contains any of these letter sequences (in either case) anywhere inside it: ${quote(spec.forbidden)}.`);
  if (spec.maxRepeat) rules.push(`No letter occurs more than ${spec.maxRepeat} times in the same name (ignore case).`);
  if (spec.vowelRange) rules.push(`Each name has between ${spec.vowelRange[0]} and ${spec.vowelRange[1]} vowels. Vowels are a, e, i, o, u; y is not a vowel.`);
  if (spec.reserved.length) rules.push('No name equals any entry of "reserved_names" in the inputs (ignore case).');
  rules.push(`The ${spec.n} names are pairwise different (ignore case).`);
  if (spec.distinctInitials) rules.push('No two names begin with the same letter.');
  if (spec.minWith) rules.push(`At least ${spec.minWith.count} of the names contain the letter ${spec.minWith.letter.toUpperCase()}.`);
  const prompt = [
    `You are naming a new line of ${spec.product} for ${spec.catalogue}, a fictional catalogue. Invent exactly ${spec.n} product names.`,
    '',
    'Rules (each rule applies to every name unless it says otherwise):',
    ...rules.map((t, i) => `${i + 1}. ${t}`),
    '',
    `Many different sets of names are acceptable; any set that obeys every rule is accepted. Answer with JSON only, of the form {"names": ["...", "..."]} holding exactly ${spec.n} names.`,
  ].join('\n');
  const inputs = { subtype: 'names', reserved_names: spec.reserved.map(cap) };
  return { spec, prompt, inputs, truth: { solutions: [{ names: reference }] } };
}

// ================================================================ (b) sentence
function buildSentence(S, d) {
  const c = KNOBS.sentence[d]; const r = S('spec');
  const required = r.sample(REQUIRED_POOL, c.m);
  const extraKeys = r.sample(['noRepeat', 'commas', 'banLetter', 'longWord', 'anchors', 'minGap'], c.extras);
  const rules = { noRepeat: false, commas: null, banLetter: null, longWord: null, startWord: null, endWord: null, minGap: 0 };
  if (extraKeys.includes('noRepeat')) rules.noRepeat = true;
  if (extraKeys.includes('commas')) rules.commas = r.int(1, 2);
  if (extraKeys.includes('longWord')) rules.longWord = 9;
  if (extraKeys.includes('minGap')) rules.minGap = 1;
  if (extraKeys.includes('anchors')) { rules.startWord = r.pick(START_ANCHORS); rules.endWord = r.pick(END_ANCHORS); }
  if (extraKeys.includes('banLetter')) {
    const blocked = [...required, rules.startWord, rules.endWord].filter(Boolean).join('');
    const letters = RARE_LETTERS.filter(l => !blocked.includes(l));
    if (letters.length) rules.banLetter = r.pick(letters);
  }
  const anchors = [rules.startWord, rules.endWord].filter(Boolean);
  const lowest = c.m + anchors.length + rules.minGap * (c.m - 1) + (rules.longWord ? 1 : 0);
  const minWords = Math.max(c.lo, lowest + 1);
  const spec = {
    subtype: 'sentence', minWords, maxWords: minWords + c.width, required, forbidden: [], rules, town: r.pick(POSTCARD_TOWNS),
  };
  const blocked = new Set([...required, ...anchors]);
  const funcs = FUNCTION_WORDS.filter(w => !blocked.has(w)); const conts = FORBID_CONTENT.filter(w => !blocked.has(w));
  const nFunc = Math.min(funcs.length, Math.ceil(c.forbid * 0.6));
  spec.forbidden = [...r.sample(funcs, nFunc), ...r.sample(conts, c.forbid - nFunc)].sort();
  const reference = solveSentence(spec, S('ref'));
  const lines = [
    `Write exactly one English sentence for a postcard from ${spec.town}, a fictional town.`,
    '',
    'Rules:',
  ];
  const rl = [
    `The sentence has between ${spec.minWords} and ${spec.maxWords} words, inclusive. A word is a maximal run of letters. Use only letters, single spaces, commas and one final period: no digits, hyphens, apostrophes or other punctuation.`,
    'It starts with a capital letter, ends with a period, and contains no other period.',
    'It contains every word of "required_words" (in the inputs), each as a whole word (so "cat" does not count inside "category"), ignoring capitalisation, in the listed order. Other words may sit between them. If a required word occurs more than once, it is enough that some choice of occurrences meets the order rule (and the spacing rule, if there is one).',
    'It contains none of the words of "forbidden_words" (in the inputs), as whole words, in any capitalisation.',
  ];
  if (rules.noRepeat) rl.push('No word is used twice (ignore capitalisation).');
  if (rules.commas !== null) rl.push(`It contains exactly ${rules.commas} comma${rules.commas === 1 ? '' : 's'}.`);
  if (rules.banLetter) rl.push(`The letter ${rules.banLetter.toUpperCase()} does not appear anywhere in it (in either case).`);
  if (rules.longWord) rl.push(`At least one word has ${rules.longWord} or more letters.`);
  if (rules.startWord) rl.push(`Its first word is "${rules.startWord}" and its last word is "${rules.endWord}" (capitalisation aside).`);
  if (rules.minGap) rl.push(`Between any two consecutive required words there are at least ${rules.minGap} other word${rules.minGap === 1 ? '' : 's'}.`);
  lines.push(...rl.map((t, i) => `${i + 1}. ${t}`), '',
    'Only these rules are checked; any sentence that obeys all of them is accepted. Answer with JSON only, of the form {"sentence": "..."}.');
  const inputs = { subtype: 'sentence', required_words: required, forbidden_words: spec.forbidden };
  return { spec, prompt: lines.join('\n'), inputs, truth: { solutions: [{ sentence: reference }] } };
}

// ================================================================ (c) order
const WEIGHTS = { before: 3, next: 2, apart: 2, pos: 1.5, between: 2, gap: 2, exact: 1.5, notEnd: 1 };

function sampleConstraint(r, kind, perm) {
  const n = perm.length; const swap = (a, b) => (r.chance(0.5) ? [a, b] : [b, a]);
  switch (kind) {
    case 'before': { const i = r.int(0, n - 2); const j = r.int(i + 1, n - 1); return { kind, a: perm[i], b: perm[j] }; }
    case 'next': { const i = r.int(0, n - 2); return { kind, a: perm[i], b: perm[i + 1] }; }
    case 'apart': { const i = r.int(0, n - 3); const j = r.int(i + 2, n - 1); const [a, b] = swap(perm[i], perm[j]); return { kind, a, b }; }
    case 'pos': { const i = r.int(0, n - 1); return { kind, a: perm[i], k: i + 1 }; }
    case 'between': { const i = r.int(0, n - 3); const l = r.int(i + 2, n - 1); const j = r.int(i + 1, l - 1); const [b, c] = swap(perm[i], perm[l]); return { kind, a: perm[j], b, c }; }
    case 'gap': { const i = r.int(0, n - 3); const j = r.int(i + 2, n - 1); const dd = r.int(1, Math.min(3, j - i - 1)); const [a, b] = swap(perm[i], perm[j]); return { kind, a, b, d: dd }; }
    case 'exact': { const i = r.int(0, n - 3); const j = r.int(i + 2, Math.min(n - 1, i + 4)); const [a, b] = swap(perm[i], perm[j]); return { kind, a, b, d: j - i - 1 }; }
    case 'notEnd': { const i = r.int(1, n - 2); return { kind, a: perm[i] }; }
    default: throw new Error(`unknown kind ${kind}`);
  }
}
const conKey = c => JSON.stringify([c.kind, c.kind === 'apart' || c.kind === 'gap' || c.kind === 'exact' ? [c.a, c.b].sort() : [c.a, c.b, c.c], c.k ?? 0, c.d ?? 0]);
const others = d => `${d} other ${d === 1 ? 'item sits' : 'items sit'}`;

export function renderConstraint(c, n) {
  switch (c.kind) {
    case 'before': return `${c.a} comes somewhere before ${c.b}.`;
    case 'next': return `${c.a} comes immediately before ${c.b}.`;
    case 'apart': return `${c.a} and ${c.b} are not next to each other.`;
    case 'pos': return c.k === 1 ? `${c.a} is first.` : c.k === n ? `${c.a} is last.` : `${c.a} is in position ${c.k}.`;
    case 'between': return `${c.a} sits somewhere between ${c.b} and ${c.c}, in either direction.`;
    case 'gap': return `At least ${others(c.d)} between ${c.a} and ${c.b}.`;
    case 'exact': return `Exactly ${others(c.d)} between ${c.a} and ${c.b}.`;
    case 'notEnd': return `${c.a} is neither first nor last.`;
    default: throw new Error(`unknown kind ${c.kind}`);
  }
}

function buildOrder(S, d) {
  const c = KNOBS.order[d]; const r = S('spec');
  const items = coinedNames(r, c.n, { minLen: 4, maxLen: 8 });
  const planted = r.shuffle(items);
  const setting = r.pick(ORDER_SETTINGS);
  const constraints = []; const seen = new Set();
  const add = con => { const k = conKey(con); if (seen.has(k)) return false; seen.add(k); constraints.push(con); return true; };
  // the first two constraints are always a 'before' and a 'next', so reversing or swapping the reference provably breaks the task
  for (let g = 0; constraints.length < 1 && g < 50; g++) add(sampleConstraint(r, 'before', planted));
  for (let g = 0; constraints.length < 2 && g < 50; g++) add(sampleConstraint(r, 'next', planted));
  const kinds = c.kinds; const total = kinds.reduce((s, k) => s + WEIGHTS[k], 0);
  for (let g = 0; constraints.length < c.c && g < c.c * 40; g++) {
    let x = r.next() * total; let kind = kinds[kinds.length - 1];
    for (const k of kinds) { x -= WEIGHTS[k]; if (x < 0) { kind = k; break; } }
    add(sampleConstraint(r, kind, planted));
  }
  // The task must have several valid answers (so the oracle is shown to accept more than one): drop the newest
  // constraint until the search finds MIN_ORDER_SOLUTIONS distinct orderings within budget.
  let spec; let found = null;
  for (let drop = 0; drop < 12; drop++) {
    spec = { subtype: 'order', items: [...items], constraints: constraints.slice(0, constraints.length - drop), setting: setting.noun };
    const res = solveOrder(spec, { mode: 'index', limit: MIN_ORDER_SOLUTIONS, maxNodes: 60000 });
    if (res.solutions.length >= MIN_ORDER_SOLUTIONS) { found = res.solutions; break; }
    if (constraints.length - drop <= 3) break;
  }
  if (!found) throw new Error('order: no constraint set with several solutions');
  const shown = r.shuffle(items);
  if (shown.join() === planted.join()) shown.reverse();
  const shownCons = r.shuffle(spec.constraints);
  const n = c.n;
  const prompt = [
    `${setting.frame.replace('{n}', String(n))}. The ${n} ${setting.noun} are named in "items" (in the inputs), in no particular order. Put them into one single sequence from position 1 (first) to position ${n} (last), using every one exactly once.`,
    '',
    'The "constraints" list (in the inputs) holds statements that must all be true of your sequence. Read them literally:',
    '- "before" means at an earlier position, not necessarily the very next one;',
    '- "immediately before" means exactly one position earlier;',
    '- "next to each other" means positions that differ by exactly 1;',
    '- "other items sit between" counts the items strictly between the two named ones, whichever comes first.',
    '',
    'Several sequences may satisfy every statement; any one that does is accepted. Answer with JSON only, of the form {"order": ["<item at position 1>", "<item at position 2>", ...]}, using the item names exactly as written.',
  ].join('\n');
  const inputs = { subtype: 'order', items: shown, constraints: shownCons.map(con => renderConstraint(con, n)) };
  return { spec, prompt, inputs, truth: { planted, solutions: found.slice(0, 2).map(order => ({ order })) } };
}

// ================================================================ (d) schedule
function buildSchedule(S, d) {
  const c = KNOBS.schedule[d]; const r = S('spec');
  const days = DAYS.slice(0, c.days); const shifts = c.shifts; const K = shifts.length; const D = days.length; const P = c.P;
  const names = coinedNames(r, P, { minLen: 4, maxLen: 6 });
  const roleOf = Array(P).fill('staff');
  const order = r.shuffle(Array.from({ length: P }, (_, i) => i));
  for (let i = 0; i < (c.leads ?? 0); i++) roleOf[order[i]] = 'lead';
  for (let i = 0; i < (c.trainees ?? 0); i++) roleOf[order[(c.leads ?? 0) + i]] = 'trainee';
  const hasRoles = Boolean(c.leads);
  const people = names.map((name, i) => (hasRoles ? { name, role: roleOf[i] } : { name }));
  const need = [];
  for (let day = 0; day < D; day++) for (let s = 0; s < K; s++) {
    let v = r.int(c.need[0], c.need[1]);
    if (c.bump && day >= 5) v = Math.min(v + c.bump, c.need[1] + c.bump);
    need.push(v);
  }
  const total = need.reduce((a, b) => a + b, 0);
  const apartPairs = [];
  for (let g = 0; apartPairs.length < (c.apart ?? 0) && g < 50; g++) {
    const [a, b] = r.sample(names, 2);
    if (!apartPairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) apartPairs.push([a, b]);
  }
  const leadShifts = c.leadShifts === 'all' ? [...shifts] : c.leadShifts ? [r.pick(shifts)] : [];
  const rules = { apartPairs, noClopen: Boolean(c.clopen), leadShifts, traineeNeedsLead: Boolean(c.trainees), maxStreak: c.streak ?? null };
  // 1. plant a balanced rota that obeys the structural rules (no availability, loose limits)
  const cap0 = Math.ceil(total / P) + 1;
  const structural = { subtype: 'schedule', days, shifts, people: people.map(p => ({ role: 'staff', ...p })), need, unavailable: [], rules,
    limits: Object.fromEntries(names.map(nm => [nm, { min: 0, max: Math.min(D, cap0) }])) };
  const planting = solveSchedule(structural, { mode: 'balance', rng: S('plant'), maxNodes: 60000 });
  if (!planting.solutions.length) throw new Error('schedule: could not plant a rota');
  const planted = planting.solutions[0];
  const count = Object.fromEntries(names.map(nm => [nm, planted.filter(row => row.person === nm).length]));
  const worksOn = (nm, day) => planted.find(row => row.person === nm && row.day === day);
  // 2. derive availability that never contradicts the planted rota
  const cand = [];
  for (const nm of names) for (const day of days) {
    const w = worksOn(nm, day);
    if (!w) { cand.push({ person: nm, day, shift: null }); if (K > 1) for (const sh of shifts) cand.push({ person: nm, day, shift: sh }); }
    else if (K > 1) for (const sh of shifts) if (sh !== w.shift) cand.push({ person: nm, day, shift: sh });
  }
  const want = Math.round(c.unavail * P * D);
  const unavailable = []; const dayOff = new Set(); const slotOff = new Set();
  for (const u of r.shuffle(cand)) {
    if (unavailable.length >= want) break;
    const key = `${u.person}|${u.day}`;
    if (dayOff.has(key)) continue;
    if (u.shift === null) { if (slotOff.has(key)) continue; dayOff.add(key); } else slotOff.add(key);
    unavailable.push(u);
  }
  unavailable.sort((a, b) => names.indexOf(a.person) - names.indexOf(b.person) || days.indexOf(a.day) - days.indexOf(b.day) || (a.shift === null ? -1 : shifts.indexOf(a.shift)) - (b.shift === null ? -1 : shifts.indexOf(b.shift)));
  // 3. derive per-person limits around the planted counts; loosen the maxima if only one rota exists
  let spec = null; let solutions = null;
  for (let loosen = 0; loosen < 3 && !solutions; loosen++) {
    const lr = S(`limits${loosen}`);
    const limits = Object.fromEntries(names.map(nm => [nm, {
      min: Math.max(0, count[nm] - lr.int(c.minSlack[0], c.minSlack[1])),
      max: Math.min(D, Math.max(1, count[nm] + lr.int(c.maxSlack[0], c.maxSlack[1]) + loosen)),
    }]));
    spec = { subtype: 'schedule', days, shifts, people, need, unavailable, limits, rules, place: r.pick(ROTA_PLACES) };
    const ref = solveSchedule(spec, { mode: 'deficit', limit: 1, maxNodes: 150000 });
    if (!ref.solutions.length) continue;
    let alt = JSON.stringify(planted) !== JSON.stringify(ref.solutions[0]) ? planted : null;
    for (let t = 0; t < 3 && !alt; t++) {
      const res = solveSchedule(spec, { mode: 'random', rng: S(`alt${loosen}-${t}`), limit: 1, maxNodes: 60000 });
      if (res.solutions.length && JSON.stringify(res.solutions[0]) !== JSON.stringify(ref.solutions[0])) alt = res.solutions[0];
    }
    if (alt) solutions = [ref.solutions[0], alt];
  }
  if (!solutions) throw new Error('schedule: no verified pair of distinct rotas');
  // rendering
  const prompt = [
    `Fill in the weekly staff rota of ${spec.place} (a fictional business) using the tables in the inputs: "days", "shifts", "people", "need" (how many people each slot needs; a slot is one shift on one day), "unavailable", "limits"${rules.apartPairs.length ? ', "never_together"' : ''}.`,
    '',
    'Rules:',
  ];
  const rl = [
    'Every slot is staffed by exactly the number of people given for it in "need": no more, no fewer.',
    'Nobody works more than one shift on the same day.',
    'Nobody works a slot they are listed for in "unavailable". An entry with "shift": null means unavailable for every shift that day.',
    'Over the whole week each person works at least "min" and at most "max" shifts, as given in "limits".',
  ];
  if (rules.apartPairs.length) rl.push('The two people in each pair of "never_together" never work the same slot.');
  if (rules.noClopen) rl.push(`Nobody works the last shift of a day (${shifts[K - 1]}) and then the first shift of the next day (${shifts[0]}).`);
  if (rules.leadShifts.length) rl.push(rules.leadShifts.length === K ? 'Every slot includes at least one person whose role is "lead".' : `Every ${rules.leadShifts.join(' / ')} slot includes at least one person whose role is "lead".`);
  if (rules.traineeNeedsLead) rl.push('A person whose role is "trainee" only works slots that also include at least one "lead".');
  if (rules.maxStreak) rl.push(`Nobody works on more than ${rules.maxStreak} days in a row (working any shift makes it a working day).`);
  prompt.push(...rl.map((t, i) => `${i + 1}. ${t}`), '',
    'Many rotas may work; any rota that obeys every rule is accepted. Answer with JSON only, of the form {"schedule": [{"day": "Mon", "shift": "morning", "person": "Name"}, ...]} with one row for each person in each slot, using the day, shift and person names exactly as written in the inputs.');
  const inputs = {
    subtype: 'schedule', days, shifts, people,
    need: days.flatMap((day, di) => shifts.map((shift, si) => ({ day, shift, count: need[di * K + si] }))),
    unavailable,
    limits: names.map(nm => ({ person: nm, min: spec.limits[nm].min, max: spec.limits[nm].max })),
  };
  if (rules.apartPairs.length) inputs.never_together = apartPairs;
  return { spec, prompt: prompt.join('\n'), inputs, truth: { planted, solutions: solutions.map(schedule => ({ schedule })) } };
}

const BUILDERS = { names: buildNames, sentence: buildSentence, order: buildOrder, schedule: buildSchedule };

export function build(seed, split, difficulty) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer');
  if (!['dev', 'test'].includes(split)) throw new TypeError("split must be 'dev' or 'test'");
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new TypeError('difficulty must be an integer 1..5');
  const subtype = subtypeOf(seed); let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const S = tag => stream(split, seed, difficulty, attempt, `${subtype}:${tag}`);
      const out = BUILDERS[subtype](S, difficulty);
      const tokens = estimateTokens(out.prompt) + estimateTokens(out.inputs);
      const task = {
        id: `need-constraint/${split}/d${difficulty}/s${seed}`, family: 'need-constraint', seed, split, difficulty,
        prompt: out.prompt, inputs: out.inputs,
        budget: { actions: 3, tokens: tokens + 1500 },
      };
      return { task, spec: out.spec, truth: out.truth, attempts: attempt + 1 };
    } catch (error) { lastError = error; }
  }
  throw new Error(`need-constraint: no valid task for seed ${seed} (${split}, d${difficulty}): ${lastError?.message}`);
}
