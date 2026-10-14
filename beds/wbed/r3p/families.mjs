// Function families for W-bed R3' "planted-defect sweep". A family generates one function of the fictional repository:
// a JSDoc contract, a parameter domain (the valid inputs the contract states), a correct body in one of several styles,
// and, when the planner asks for one, a planted body: a DEFECT of a stated class (behaviour differs from the contract on
// some valid input) or a DECOY (correct code that looks like that class's mistake). Probes are valid inputs used to
// prove both facts by execution (world.mjs) and to write the repository's own tests (render.mjs).
//
//   draw(r, ctx, role) -> p      instance parameters; role = { kind: 'clean' | 'defect' | 'decoy', cls }
//   doc(p)  -> { lines, params, returns }     the contract (rendered as JSDoc with the domain of each parameter)
//   domain(p) -> { params: [spec], where? }   exec.mjs valueOk specs
//   body(p, 'planted' | 'correct') -> text    function body (no braces, relative indentation)
//   probes(p, r) -> [args]                    valid inputs; must include inputs that separate every defect variant
//   smell(p) -> class | null                  the class a pattern-reading reviewer would report for the planted variant
//   accept?: { variant: [classes] }           classes the oracle also accepts for a variant whose class two
//                                             definitions fit (the manifest's first class is the primary one)
//
// Kinds: 'fn' (self-contained), 'helper' (src/lib, called by callers), 'caller' (calls `p.helper`, the helper's name).
// A family's `can.defect` / `can.decoy` list the classes it can host. Fillers host nothing.
//
// v1.1 (review 2026-10-14, NOTES §17): every defect-hosting family draws SEMANTIC KNOBS that change what the correct
// function does (band ends, page base, grace days, tie rule, empty-input result, rounding rule, units, separators ...)
// and are stated in the contract, plus independent WORDING slots (paraphrases of the main sentence, nouns, parameter
// descriptions, numeric domain bounds). Most defect variants behave exactly like a correct instance with another knob
// setting, so only the contract tells them apart; and the same contract text rarely recurs within or across tasks, so a
// script that votes among functions with the same contract text has (almost) nobody to vote with. `p.order` permutes
// the parameters for some families (world.mjs applies it to the signature, the domain and the probes).

const J = (...ls) => ls.flat().join('\n');
const cap = s => s[0].toUpperCase() + s.slice(1);
const INT = { t: 'int', min: -1e6, max: 1e6 };
const intR = R => ({ t: 'int', min: -R, max: R });
const RANGES = [1e4, 1e5, 1e6, 1e7];
const AMAX = [20, 30, 40, 50, 60];
const ORD2 = [[0, 1], [1, 0]];
const ORD3 = [[0, 1, 2], [1, 2, 0]];
const range = n => Array.from({ length: n }, (_, i) => i);
const ints = (r, n, lo = -500, hi = 500) => Array.from({ length: n }, () => r.int(lo, hi));
const pickVariant = (r, role, table) => (role.kind === 'clean' ? null : r.pick(table[role.kind][role.cls]));
const STATUS_WORDS = ['void', 'draft', 'cancelled', 'held', 'archived', 'reversed'];
const DEFAULT_POOL = [['currency', "'EUR'"], ['currency', "'GBP'"], ['pageSize', '50'], ['pageSize', '25'], ['locale', "'en-GB'"], ['locale', "'de-DE'"],
  ['retries', '3'], ['retries', '5'], ['timeoutMs', '5000'], ['timeoutMs', '8000'], ['roundTo', '2']];
function drawDefaults(r) {
  const out = [], n = r.int(2, 3);
  for (const [k, v] of r.shuffle(DEFAULT_POOL)) if (!out.some(x => x[0] === k) && out.length < n) out.push([k, v]);
  return out;
}
const defaultsLit = ds => `{ ${ds.map(([k, v]) => `${k}: ${v}`).join(', ')} }`;
const defaultsText = ds => ds.map(([k, v]) => `${k} ${v}`).join(', ');
const quoteList = (ws, conj) => (ws.length === 1 ? `'${ws[0]}'` : `${ws.slice(0, -1).map(w => `'${w}'`).join(', ')} ${conj} '${ws[ws.length - 1]}'`);

/** Wording slots: one index per slot. Slot 0 is the main sentence; its LAST option is held-out wording, drawn only on the
 *  test split (half of the time there), never on dev. Other slots are free. */
export function words(r, ctx, sizes) {
  return sizes.map((n, i) => (i === 0 ? (ctx.split === 'test' && r.chance(0.5) ? n - 1 : r.int(0, n - 2)) : r.int(0, n - 1)));
}

export const FAMILIES = {};
const fam = (id, def) => { FAMILIES[id] = { id, kind: 'fn', can: { defect: [], decoy: [] }, accept: {}, ...def }; };

// ===================================================================================================== OFF_BY_ONE hosts
const BAND_ENDS = {
  'true,true': () => [', both ends included', ' (inclusive at both ends)'],
  'true,false': p => [`, ${p.lo} included and ${p.hi} excluded`, ` (closed at ${p.lo}, open at ${p.hi})`],
  'false,true': p => [`, ${p.lo} excluded and ${p.hi} included`, ` (open at ${p.lo}, closed at ${p.hi})`],
  'false,false': () => [', both ends excluded', ' (exclusive at both ends)'],
};
fam('range-check', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    const house = r.chance(0.35);
    const [loIncl, hiIncl] = house ? [true, ctx.house.band === 'incl'] : r.pick([[true, true], [true, false], [false, true], [false, false]]);
    const [v, lo, hi] = r.pick([['value', 'lo', 'hi'], ['amount', 'min', 'max'], ['n', 'low', 'high'], ['x', 'start', 'end']]);
    return { name: ctx.name(['is{N}InBand', 'is{N}Within', '{n}InRange', 'within{N}Band', 'is{N}InWindow']), house, loIncl, hiIncl, v, lo, hi,
      R: r.pick(RANGES), w: words(r, ctx, [4, 2, 3, 2]), style: r.int(0, 1), order: r.pick(ORD3),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['swap-hi', 'swap-lo'] }, decoy: { OFF_BY_ONE: ['plus', 'minus'] } }) };
  },
  smell: p => (p.variant === 'plus' || p.variant === 'minus' ? 'OFF_BY_ONE' : null),
  sig: p => [p.v, p.lo, p.hi],
  doc: p => {
    const N = ['band', 'range', 'window'][p.w[2]];
    const ends = p.house ? ` (${N} ends: docs/CONVENTIONS.md §3)` : BAND_ENDS[`${p.loIncl},${p.hiIncl}`](p)[p.w[1]];
    const main = [`True when ${p.v} lies in the ${N} from ${p.lo} to ${p.hi}${ends}.`, `Whether ${p.v} falls inside the ${N} ${p.lo}..${p.hi}${ends}.`,
      `Checks that ${p.v} is within the ${N} ${p.lo} to ${p.hi}${ends}.`, `Reports whether ${p.v} sits in the ${N} bounded by ${p.lo} and ${p.hi}${ends}.`][p.w[0]];
    return { lines: [main], params: p.w[3] ? ['the value checked', `the ${N}'s lower end`, `the ${N}'s upper end, not below ${p.lo}`]
      : ['the integer to test', `lower end of the ${N}`, `upper end of the ${N}, not below ${p.lo}`], returns: 'boolean' };
  },
  domain: p => ({ params: [intR(p.R), intR(p.R), intR(p.R)], where: a => a[1] <= a[2] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { v, lo, hi } = p;
    const loIn = vr === 'swap-lo' ? !p.loIncl : p.loIncl, hiIn = vr === 'swap-hi' ? !p.hiIncl : p.hiIncl;
    const loOk = vr === 'minus' ? (loIn ? `${v} > ${lo} - 1` : `${v} >= ${lo} + 1`) : (loIn ? `${v} >= ${lo}` : `${v} > ${lo}`);
    const loBad = vr === 'minus' ? (loIn ? `${v} <= ${lo} - 1` : `${v} < ${lo} + 1`) : (loIn ? `${v} < ${lo}` : `${v} <= ${lo}`);
    const hiOk = vr === 'plus' ? (hiIn ? `${v} < ${hi} + 1` : `${v} <= ${hi} - 1`) : (hiIn ? `${v} <= ${hi}` : `${v} < ${hi}`);
    return p.style ? J(`if (${loBad}) return false;`, `return ${hiOk};`) : `return ${loOk} && ${hiOk};`;
  },
  probes(p, r) {
    const out = [];
    for (let k = 0; k < 3; k++) { const lo = r.int(-50, 50), hi = lo + r.int(1, 30); for (const v of [lo - 1, lo, lo + 1, hi - 1, hi, hi + 1]) out.push([v, lo, hi]); }
    const m = r.int(-20, 20);
    return out.concat([[m, m, m], [m - 1, m, m], [m + 1, m, m]]);
  },
});

fam('page-slice', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    const house = r.chance(0.5);
    const base = house ? ctx.house.pageBase : r.pick([0, 1]);
    const [items, page, size] = r.pick([['items', 'page', 'size'], ['rows', 'pageNo', 'perPage'], ['list', 'page', 'pageSize']]);
    return { name: ctx.name(['{n}Page', 'page{N}s', 'slice{N}Page', '{n}sOnPage']), house, base, items, page, size,
      fixed: r.chance(0.4) ? r.pick([5, 10, 20, 25]) : null, past: r.pick(['empty', 'null']), amax: r.pick([50, 60]), w: words(r, ctx, [3, 2, 2]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['base', 'short'] }, decoy: { OFF_BY_ONE: ['decoy'] } }) };
  },
  smell: p => ({ short: 'OFF_BY_ONE', decoy: 'OFF_BY_ONE' }[p.variant] ?? null),
  sig: p => (p.fixed ? [p.items, p.page] : [p.items, p.page, p.size]),
  doc: p => {
    const per = `${p.fixed ?? p.size} items`;
    const baseT = p.house ? 'page numbering: docs/CONVENTIONS.md §4' : [`pages are numbered from ${p.base}`, `the first page is page ${p.base}`][p.w[1]];
    const pastT = p.past === 'empty' ? ['an empty array past the last page', 'past the last page the result is empty'][p.w[2]]
      : ['null past the last page (an empty list has no pages)', 'null for a page after the last one (an empty list has no pages)'][p.w[2]];
    const main = [`The ${p.items} on page ${p.page} when ${p.items} is cut into pages of ${per} (${baseT}); ${pastT}.`,
      `Page ${p.page} of ${p.items}, ${per} to a page (${baseT}); ${pastT}.`,
      `Returns one page of ${p.items}: page ${p.page} at ${per} per page (${baseT}); ${pastT}.`][p.w[0]];
    return { lines: [main], params: ['the items, in order', 'the page number', ...(p.fixed ? [] : ['items per page'])], returns: p.past === 'null' ? 'Array|null' : 'Array' };
  },
  domain: p => ({ params: [{ t: 'arr', of: INT, max: p.amax }, { t: 'int', min: p.base, max: p.base + 20 }, ...(p.fixed ? [] : [{ t: 'int', min: 1, max: 10 }])] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { items, page } = p, S = p.fixed ? String(p.fixed) : p.size;
    const nul = p.past === 'null';
    if (vr === 'decoy') {
      const end = p.base === 1 ? `${page} * ${S}` : `(${page} + 1) * ${S}`;
      return J(`const end = ${end};`, nul ? [`if (end - ${S} >= ${items}.length) return null;`] : [], `return ${items}.slice(end - ${S}, end);`);
    }
    const base = vr === 'base' ? 1 - p.base : p.base;
    const start = base === 1 ? `(${page} - 1) * ${S}` : `${page} * ${S}`;
    const cut = vr === 'short' ? ' - 1' : '';
    if (p.style === 0) return J(`const start = ${start};`, nul ? [`if (start >= ${items}.length) return null;`] : [], `return ${items}.slice(start, start + ${S}${cut});`);
    const end = base === 1 ? `${page} * ${S}` : `(${page} + 1) * ${S}`;
    return J(nul ? [`if (${start} >= ${items}.length) return null;`] : [], `return ${items}.slice(${start}, ${end}${cut});`);
  },
  probes(p, r) {
    const sizes = p.fixed ? [p.fixed] : [1, 3, 5], out = [];
    const lens = [0, 3, 12, 25, ...(p.fixed ? [p.fixed - 1, p.fixed, 2 * p.fixed + 1] : [])].filter(n => n <= p.amax);
    for (const n of lens) for (const size of sizes) for (const k of [0, 1, 2]) out.push([range(n).map(i => i * 10 + r.int(0, 9)), p.base + k, ...(p.fixed ? [] : [size])]);
    const L = p.fixed ? Math.min(p.amax, 2 * p.fixed + 1) : 12, extra = p.fixed ? [] : [5];
    return r.shuffle(out).slice(0, 14).concat([0, 1, 2, 3].map(k => [range(L), p.base + k, ...extra]), [[[], p.base, ...extra]]);
  },
});

fam('day-count', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    const [a, b] = r.pick([['fromDay', 'toDay'], ['startDay', 'endDay'], ['firstDay', 'lastDay']]);
    const rule = r.pick(['both', 'start', 'between']);
    const names = { both: ['{n}Days', 'count{N}Days', 'days{N}Spans', '{n}DayCount'], start: ['{n}Nights', 'nights{N}', 'count{N}Nights'], between: ['{n}DaysBetween', 'daysInside{N}', 'gap{N}Days'] }[rule];
    return { name: ctx.name(names), rule, a, b, M: r.pick([366, 1000, 3650]), w: words(r, ctx, [3, 2]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['swap'] }, decoy: { OFF_BY_ONE: ['loop'] } }) };
  },
  smell: p => (p.variant === 'loop' ? 'OFF_BY_ONE' : null),
  sig: p => [p.a, p.b],
  doc: p => {
    const { a, b } = p;
    const T = {
      both: [`Number of days from ${a} to ${b} (day numbers), counting both: day 10 to day 10 is 1 day.`, `How many days ${a} through ${b} cover (day numbers), both days included; day 10 to day 12 is 3.`,
        `Days covered from ${a} to ${b} (day numbers), inclusive of both (10 to 10 gives 1).`],
      start: [`Number of nights from ${a} to ${b} (day numbers): ${a} counts, ${b} does not, so day 10 to day 10 is 0.`, `Nights from ${a} to ${b} (day numbers), counting ${a} but not ${b}: day 10 to day 12 is 2.`,
        `Nights stayed from ${a} to ${b} (day numbers), the last day not counted (10 to 10 gives 0).`],
      between: [`Number of days strictly between ${a} and ${b} (day numbers), neither counted: day 10 to day 12 is 1, day 10 to day 10 is 0.`,
        `Days lying strictly between ${a} and ${b} (day numbers, both excluded); 0 when there are none.`, `Count of the days after ${a} and before ${b} (day numbers); 0 when there are none.`],
    }[p.rule];
    return { lines: [T[p.w[0]]], params: p.w[1] ? ['the first day number', `the last day number, not before ${a} and at most ${p.M} days after it`]
      : ['first day number', `last day number, not before ${a} and at most ${p.M} days after it`], returns: 'number' };
  },
  domain: p => ({ params: [{ t: 'int', min: 0, max: 80000 }, { t: 'int', min: 0, max: 80000 }], where: a => a[1] >= a[0] && a[1] - a[0] <= p.M }),
  body(p, which) {
    const { a, b } = p, vr = which === 'planted' ? p.variant : null;
    if (vr === 'loop') return J('let n = 0;', `for (let d = ${p.rule === 'both' ? a : `${a} + 1`}; d ${p.rule === 'between' ? '<' : '<='} ${b}; d++) n++;`, 'return n;');
    const rule = vr === 'swap' ? { both: 'start', start: 'both', between: 'start' }[p.rule] : p.rule;
    if (rule === 'both') return p.style ? `return 1 + ${b} - ${a};` : `return ${b} - ${a} + 1;`;
    if (rule === 'start') return `return ${b} - ${a};`;
    return p.style ? `return ${b} > ${a} ? ${b} - ${a} - 1 : 0;` : `return Math.max(0, ${b} - ${a} - 1);`;
  },
  probes(p, r) { return [0, 1, 2, 7, 30, 365].filter(k => k <= p.M).map(k => { const a = r.int(9000, 12000); return [a, a + k]; }); },
});

fam('pairwise-deltas', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}Deltas', 'deltas{N}', 'step{N}Changes', '{n}Changes']), v: r.pick(['values', 'series', 'points']), k: r.pick([1, 1, 1, 2, 3, 7, 12]),
      fwd: r.chance(0.6), amax: r.pick(AMAX), R: r.pick(RANGES), w: words(r, ctx, [3, 2]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['past-end', 'skip-last'] }, decoy: { OFF_BY_ONE: ['minus-k'] } }) };
  },
  smell: p => (p.variant ? 'OFF_BY_ONE' : null),
  sig: p => [p.v],
  doc: p => {
    const { v, k } = p, rel = p.fwd ? `${v}[i + ${k}] - ${v}[i]` : `${v}[i] - ${v}[i + ${k}]`;
    const main = [`Differences of ${v} ${k} position${k > 1 ? 's' : ''} apart: result[i] = ${rel}.`, `For each position i of ${v}, the change over ${k} step${k > 1 ? 's' : ''}: result[i] = ${rel}.`,
      `${k === 1 ? 'Step' : 'Lagged'} differences of ${v}, result[i] = ${rel}.`][p.w[0]];
    return { lines: [main, [`Fewer than ${k + 1} ${v} give an empty array.`, `With ${k} or fewer ${v} the result is empty.`][p.w[1]]], params: ['integers, in order'], returns: 'number[]' };
  },
  domain: p => ({ params: [{ t: 'arr', of: intR(p.R), max: p.amax }] }),
  body(p, which) {
    const { v, k } = p, vr = which === 'planted' ? p.variant : null;
    const at = i => (p.fwd ? `${v}[${i} + ${k}] - ${v}[${i}]` : `${v}[${i}] - ${v}[${i} + ${k}]`);
    const loop = cond => J('const out = [];', `for (let i = 0; ${cond}; i++) out.push(${at('i')});`, 'return out;');
    if (p.style === 1) {
      if (vr === 'past-end') return `return ${v}.map((x, i) => ${at('i')});`;
      if (vr === 'minus-k') return `return ${v}.slice(0, ${v}.length - ${k}).map((x, i) => ${p.fwd ? `${v}[i + ${k}] - x` : `x - ${v}[i + ${k}]`});`;
      return `return ${v}.slice(${k}${vr === 'skip-last' ? ', -1' : ''}).map((x, i) => ${p.fwd ? `x - ${v}[i]` : `${v}[i] - x`});`;
    }
    if (vr === 'past-end') return loop(`i < ${v}.length`);
    if (vr === 'skip-last') return loop(`i + ${k} < ${v}.length - 1`);
    if (vr === 'minus-k') return loop(`i < ${v}.length - ${k}`);
    return J('const out = [];', `for (let i = ${k}; i < ${v}.length; i++) out.push(${p.fwd ? `${v}[i] - ${v}[i - ${k}]` : `${v}[i - ${k}] - ${v}[i]`});`, 'return out;');
  },
  probes(p, r) { return [0, 1, p.k, p.k + 1, p.k + 2, p.k + 5].filter(n => n <= p.amax).map(n => [ints(r, n)]); },
});

fam('last-n', {
  can: { defect: ['MISSING_GUARD', 'OFF_BY_ONE'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    const [items, n] = r.pick([['items', 'n'], ['entries', 'count'], ['rows', 'k']]);
    return { name: ctx.name(['last{N}s', 'latest{N}s', 'recent{N}s', 'tail{N}s']), items, n, rev: r.chance(0.35), short: r.pick(['all', 'null']), amax: r.pick(AMAX),
      nmax: r.pick([20, 60, 100]), w: words(r, ctx, [3, 2, 2]), style: r.int(0, 1), order: r.pick(ORD2),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['noguard'], OFF_BY_ONE: ['extra'] }, decoy: { MISSING_GUARD: ['or-length'] } }) };
  },
  smell: p => ({ extra: 'OFF_BY_ONE', 'or-length': 'MISSING_GUARD' }[p.variant] ?? null),
  sig: p => [p.items, p.n],
  doc: p => {
    const { items, n } = p;
    const ord = p.rev ? ['newest first (the last item first)', 'in reverse order, the last item first'][p.w[1]] : ['in their original order', 'in order'][p.w[1]];
    const sh = p.short === 'all' ? `all of them when there are fewer than ${n}` : `null when there are fewer than ${n}`;
    const zero = [`none when ${n} is 0`, `an empty array when ${n} is 0`][p.w[2]];
    const main = [`The last ${n} of ${items}, ${ord}: ${sh}; ${zero}.`, `Keeps the final ${n} ${items}, ${ord}; ${sh}; ${zero}.`, `Tail of ${items} of length ${n}, ${ord}; ${sh}; ${zero}.`][p.w[0]];
    return { lines: [main], params: ['the items', 'how many to keep, 0 or more'], returns: p.short === 'null' ? 'Array|null' : 'Array' };
  },
  domain: p => ({ params: [{ t: 'arr', of: INT, max: p.amax }, { t: 'int', min: 0, max: p.nmax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { items, n } = p, rev = p.rev ? '.reverse()' : '';
    const sh = p.short === 'null' ? [`if (${items}.length < ${n}) return null;`] : [];
    if (vr === 'noguard') return J(sh, `return ${items}.slice(-${n})${rev};`);
    if (vr === 'extra') return J(sh, `return ${items}.slice(Math.max(0, ${items}.length - ${n} - 1))${rev};`);
    if (vr === 'or-length') return J(sh, `return ${items}.slice(-${n} || ${items}.length)${rev};`);
    return p.style ? J(sh, `return ${items}.slice(Math.max(0, ${items}.length - ${n}))${rev};`) : J(`if (${n} === 0) return [];`, sh, `return ${items}.slice(-${n})${rev};`);
  },
  probes(p, r) { const out = []; for (const len of [0, 3, 8]) for (const n of [0, 1, 3, 8, 10]) out.push([ints(r, len), n]); return out; },
});

fam('chunk', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  accept: { 'le-length': ['OFF_BY_ONE', 'MISSING_GUARD'] }, // on [] it also returns [[]]: the empty-input clause is broken too
  draw(r, ctx, role) {
    const [items, size] = r.pick([['items', 'size'], ['rows', 'batchSize'], ['list', 'n']]);
    const last = r.pick(['short', 'short', 'drop']);
    return { name: ctx.name(['chunk{N}s', 'batch{N}s', '{n}Batches', 'split{N}sIntoBatches']), items, size, last, fixed: r.chance(0.35) ? r.pick([2, 3, 5, 10]) : null,
      amax: r.pick([30, 40, 50, 60]), w: words(r, ctx, [3, 2]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: [last === 'short' ? 'le-length' : 'lt'] }, decoy: { OFF_BY_ONE: [last === 'short' ? 'le-minus-one' : 'minus-one'] } }) };
  },
  smell: p => (p.variant && p.variant !== 'lt' ? 'OFF_BY_ONE' : null),
  sig: p => (p.fixed ? [p.items] : [p.items, p.size]),
  doc: p => {
    const S = p.fixed ?? p.size;
    const lastT = p.last === 'short' ? ['the last chunk may be shorter', 'a final partial chunk is kept'][p.w[1]] : [`a last chunk of fewer than ${S} items is dropped`, 'an incomplete final chunk is left out'][p.w[1]];
    const main = [`Splits ${p.items} into consecutive chunks of ${S} items, in order; ${lastT}. An empty array gives no chunks.`, `Batches ${p.items} ${S} at a time, keeping their order; ${lastT}; no batches for an empty array.`,
      `Groups ${p.items} into runs of ${S}, in order; ${lastT}; [] for an empty array.`][p.w[0]];
    return { lines: [main], params: p.fixed ? ['the items'] : ['the items', 'chunk size'], returns: 'Array[]' };
  },
  domain: p => ({ params: [{ t: 'arr', of: INT, max: p.amax }, ...(p.fixed ? [] : [{ t: 'int', min: 1, max: 10 }])] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { items } = p, S = p.fixed ? String(p.fixed) : p.size;
    const cond = { 'le-length': `i <= ${items}.length`, 'le-minus-one': `i <= ${items}.length - 1`, lt: `i + ${S} < ${items}.length`, 'minus-one': `i + ${S} - 1 < ${items}.length` }[vr]
      ?? (p.last === 'short' ? `i < ${items}.length` : `i + ${S} <= ${items}.length`);
    if (p.style === 1) return J('const out = [];', 'let i = 0;', `while (${cond}) {`, `  out.push(${items}.slice(i, i + ${S}));`, `  i += ${S};`, '}', 'return out;');
    return J('const out = [];', `for (let i = 0; ${cond}; i += ${S}) out.push(${items}.slice(i, i + ${S}));`, 'return out;');
  },
  probes(p, r) {
    const out = [];
    for (const size of p.fixed ? [p.fixed] : [1, 2, 3, 4]) for (const len of [0, size * 2, size * 2 + 1, 7]) if (len <= p.amax) out.push([ints(r, len), ...(p.fixed ? [] : [size])]);
    return out;
  },
});

// ==================================================================================================== LOGIC_ERROR hosts
fam('approval-rule', {
  can: { defect: ['LOGIC_ERROR', 'OFF_BY_ONE'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const [role_, amount, limit] = r.pick([['role', 'amountMinor', 'limitMinor'], ['role', 'amount', 'limit'], ['userRole', 'total', 'ceiling']]);
    return { name: ctx.name(['canApprove{N}', 'mayApprove{N}', 'canSign{N}', 'approves{N}']), role: role_, amount, limit,
      sup: r.pick(['admin', 'cfo', 'owner']), app: r.pick(['approver', 'controller', 'signatory', 'manager']), incl: r.chance(0.6), mult: r.chance(0.4) ? r.pick([2, 5, 10]) : null,
      w: words(r, ctx, [3, 2]), style: r.int(0, 1), order: r.pick(ORD3),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['or'], OFF_BY_ONE: ['bound'] }, decoy: { LOGIC_ERROR: ['demorgan'] } }) };
  },
  smell: p => (p.variant === 'demorgan' ? 'LOGIC_ERROR' : null),
  sig: p => [p.role, p.amount, p.limit],
  doc: p => {
    const { role, amount, limit, sup, app } = p;
    const supT = p.mult ? [`'${sup}' may up to ${p.mult} times ${limit}`, `'${sup}' may when ${amount} is at most ${p.mult} times ${limit}`][p.w[1]]
      : [`'${sup}' always may`, `'${sup}' may approve any amount`][p.w[1]];
    const cmp = p.incl ? ['does not exceed', 'is at most', '<='] : ['is below', 'is less than', '<'];
    const main = [`True when a user with ${role} may approve a document of ${amount} (minor units): ${supT}; '${app}' may when ${amount} ${cmp[0]} ${limit}; no other role may.`,
      `Whether ${role} can sign off ${amount} (minor units) against ${limit}: ${supT}; '${app}' only when ${amount} ${cmp[1]} ${limit}; every other role is refused.`,
      `Approval check for ${amount} (minor units) by ${role}: ${supT}; '${app}' needs ${amount} ${cmp[2]} ${limit}; any other role never.`][p.w[0]];
    return { lines: [main], params: ['the user\'s role name', 'the document amount', 'the approval limit'], returns: 'boolean' };
  },
  domain: () => ({ params: [{ t: 'str', max: 20 }, { t: 'int', min: 0, max: 1e7 }, { t: 'int', min: 0, max: 1e7 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { role, amount, limit, sup, app } = p;
    const supRet = p.mult ? `${amount} <= ${p.mult} * ${limit}` : 'true';
    const op = (vr === 'bound' ? !p.incl : p.incl) ? '<=' : '<';
    if (vr === 'demorgan') {
      const notSup = p.mult ? `(${role} !== '${sup}' || ${amount} > ${p.mult} * ${limit})` : `${role} !== '${sup}'`;
      return `return !(${notSup} && (${role} !== '${app}' || ${amount} ${p.incl ? '>' : '>='} ${limit}));`;
    }
    if (p.style === 1) {
      return J(`switch (${role}) {`, `  case '${sup}': return ${supRet};`, `  case '${app}': return ${vr === 'or' ? 'true' : `${amount} ${op} ${limit}`};`,
        `  default: return ${vr === 'or' ? `${amount} ${op} ${limit}` : 'false'};`, '}');
    }
    return J(`if (${role} === '${sup}') return ${supRet};`, `return ${role} === '${app}' ${vr === 'or' ? '||' : '&&'} ${amount} ${op} ${limit};`);
  },
  probes(p, r) {
    const out = [];
    for (let k = 0; k < 2; k++) {
      const lim = r.int(100, 100000);
      for (const ro of [p.sup, p.app, 'viewer', 'clerk']) for (const a of [lim - 1, lim, lim + 1]) out.push([ro, a, lim]);
      if (p.mult) for (const a of [p.mult * lim - 1, p.mult * lim, p.mult * lim + 1]) out.push([p.sup, a, lim]);
    }
    return out;
  },
});

const RETRY_SETS = {
  a: ['HTTP status 429 or a 5xx status (500-599)', 'a 429 or any status from 500 to 599'],
  b: ['HTTP status 408, 429 or a 5xx status (500-599)', 'a 408, a 429 or any status from 500 to 599'],
  c: ['HTTP status 429, 502, 503 or 504', 'only the statuses 429, 502, 503 and 504'],
};
fam('retry-policy', {
  can: { defect: ['LOGIC_ERROR', 'OFF_BY_ONE'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const [status, attempt, max] = r.pick([['status', 'attempt', 'maxAttempts'], ['code', 'tries', 'limit'], ['httpStatus', 'attemptNo', 'maxTries']]);
    return { name: ctx.name(['shouldRetry{N}', 'isRetryable{N}', 'retry{N}Allowed', 'canRetry{N}']), status, attempt, max, set: r.pick(['a', 'b', 'c']),
      w: words(r, ctx, [3, 2]), style: r.int(0, 1), order: r.pick(ORD3),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['precedence', 'operand'], OFF_BY_ONE: ['bound'] }, decoy: { LOGIC_ERROR: ['floor'] } }) };
  },
  smell: p => (p.variant === 'floor' ? 'LOGIC_ERROR' : null),
  sig: p => [p.status, p.attempt, p.max],
  doc: p => {
    const { attempt, max } = p, setT = RETRY_SETS[p.set][p.w[1]];
    const main = [`True when a failed call should be retried: only while ${attempt} (counted from 1) is below ${max}, and only for ${setT}.`,
      `Whether to try a failed call again: retryable are ${setT}, and only while ${attempt} (the 1-based attempt number) is less than ${max}.`,
      `Retry decision for a failed call: retry ${setT} while ${attempt} < ${max} (attempts counted from 1).`][p.w[0]];
    return { lines: [main], params: ['the HTTP status of the failed call', 'this attempt\'s number', 'the most attempts allowed'], returns: 'boolean' };
  },
  domain: () => ({ params: [{ t: 'int', min: 100, max: 599 }, { t: 'int', min: 1, max: 20 }, { t: 'int', min: 1, max: 20 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { status: s, attempt: a, max: m } = p;
    const parts = { a: [`${s} === 429`, `(${s} >= 500 && ${s} <= 599)`], b: [`${s} === 408`, `${s} === 429`, `(${s} >= 500 && ${s} <= 599)`] };
    const cond = kind => {
      if (p.set === 'c') {
        if (kind === 'operand') return `[429, 500, 503, 504].includes(${s})`;
        if (kind === 'floor') return `${s} === 429 || (Math.floor(${s} / 100) === 5 && ${s} % 100 >= 2 && ${s} % 100 <= 4)`;
        return `[429, 502, 503, 504].includes(${s})`;
      }
      const xs = parts[p.set].slice();
      if (kind === 'operand') xs[xs.length - 1] = `${s} >= 400`;
      if (kind === 'floor') xs[xs.length - 1] = `Math.floor(${s} / 100) === 5`;
      return xs.join(' || ');
    };
    if (vr === 'precedence') {
      const head = p.set === 'c' ? [`${s} === 429`] : parts[p.set].slice(0, -1);
      const tail = p.set === 'c' ? `[502, 503, 504].includes(${s}) && ${a} < ${m}` : `${s} >= 500 && ${s} <= 599 && ${a} < ${m}`;
      return `return ${[...head, tail].join(' || ')};`;
    }
    if (vr === 'floor') return J(`const transient = ${cond('floor')};`, `return transient && !(${a} >= ${m});`);
    const c = cond(vr);
    if (p.style) return J(`const transient = ${c};`, `return transient && ${a} ${vr === 'bound' ? '<=' : '<'} ${m};`);
    return J(`if (${a} ${vr === 'bound' ? '>' : '>='} ${m}) return false;`, `return ${c};`);
  },
  probes(p, r) { const out = [], m = r.int(3, 5); for (const s of [200, 404, 408, 429, 500, 502, 503, 504, 599]) for (const a of [1, m - 1, m, m + 1]) out.push([s, a, m]); return out; },
});

fam('filter-status', {
  can: { defect: ['LOGIC_ERROR'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const mode = r.pick(['exclude', 'exclude', 'include']);
    const ws = r.sample(STATUS_WORDS, r.chance(0.35) ? 3 : 2);
    return { name: ctx.name(mode === 'exclude' ? ['open{N}s', 'live{N}s', 'active{N}s', 'billable{N}s', 'countable{N}s'] : ['held{N}s', 'flagged{N}s', 'stalled{N}s', 'parked{N}s']),
      mode, ws, recs: r.pick(['records', 'items', 'lines']), amax: r.pick(AMAX), w: words(r, ctx, [3, 2]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['or', 'one'] }, decoy: { LOGIC_ERROR: ['not-or'] } }) };
  },
  smell: p => (p.variant === 'or' || p.variant === 'not-or' ? 'LOGIC_ERROR' : null),
  sig: p => [p.recs],
  doc: p => {
    const ord = ['in their original order', 'order kept'][p.w[1]], nor = quoteList(p.ws, 'nor'), or = quoteList(p.ws, 'or');
    const T = p.mode === 'exclude' ? [`The ${p.recs} whose status is neither ${nor}, ${ord}.`, `Drops the ${p.recs} with status ${or}; the rest, ${ord}.`, `Every element of ${p.recs} except those in status ${or}, ${ord}.`]
      : [`The ${p.recs} whose status is ${or}, ${ord}.`, `Keeps only the ${p.recs} with status ${or}, ${ord}.`, `Just the ${p.recs} in status ${or}, ${ord}.`];
    return { lines: [T[p.w[0]]], params: ['objects with id and status'], returns: 'Array' };
  },
  domain: p => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, status: { t: 'str', max: 20 } } }, max: p.amax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { recs } = p;
    const q = (vr === 'one' ? p.ws.slice(0, -1) : p.ws).map(w => `'${w}'`);
    const all = (op, conn) => q.map(x => `r.status ${op} ${x}`).join(` ${conn} `);
    if (p.mode === 'exclude') {
      if (vr === 'or') return `return ${recs}.filter(r => ${all('!==', '||')});`;
      if (vr === 'not-or') return `return ${recs}.filter(r => !(${all('===', '||')}));`;
      return p.style ? J(`const skip = new Set([${q.join(', ')}]);`, `return ${recs}.filter(r => !skip.has(r.status));`) : `return ${recs}.filter(r => ${all('!==', '&&')});`;
    }
    if (vr === 'or') return `return ${recs}.filter(r => ${all('===', '&&')});`;
    if (vr === 'not-or') return `return ${recs}.filter(r => !(${all('!==', '&&')}));`;
    return p.style ? J(`const keep = new Set([${q.join(', ')}]);`, `return ${recs}.filter(r => keep.has(r.status));`) : `return ${recs}.filter(r => ${all('===', '||')});`;
  },
  probes(p, r) {
    const words_ = [...p.ws, 'open', 'paid', 'sent'], last = p.ws[p.ws.length - 1];
    return range(6).map(k => [range(k + 1).map(i => ({ id: i + 1, status: r.pick(words_) }))])
      .concat([[[]], [[{ id: 1, status: last }]], [[{ id: 1, status: p.ws[0] }]], [[{ id: 1, status: p.ws[0] }, { id: 2, status: last }, { id: 3, status: 'open' }]]]);
  },
});

fam('is-overdue', {
  can: { defect: ['LOGIC_ERROR', 'OFF_BY_ONE'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const [due, today, paid] = r.pick([['dueDay', 'today', 'paidDay'], ['dueOn', 'asOf', 'paidOn']]);
    return { name: ctx.name(['is{N}Overdue', '{n}IsOverdue', 'overdue{N}', 'is{N}Late']), due, today, paid, g: r.pick([0, 0, 3, 7, 14, 30]), w: words(r, ctx, [3]), style: r.int(0, 1),
      order: r.pick([[0, 1, 2], [1, 0, 2]]), variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['or'], OFF_BY_ONE: ['ge'] }, decoy: { LOGIC_ERROR: ['not-le'] } }) };
  },
  smell: p => (p.variant === 'not-le' ? 'LOGIC_ERROR' : null),
  sig: p => [p.due, p.today, p.paid],
  doc: p => {
    const { due, today, paid, g } = p;
    const T = g === 0 ? [`True when the item is unpaid (${paid} is null) and ${today} is after ${due} (day numbers); on the due day itself it is not overdue.`,
      `Whether an unpaid item (${paid} null) is late on ${today}: it is late from the day after ${due} (day numbers).`, `Overdue check (day numbers): ${paid} must be null and ${today} later than ${due}.`]
      : [`True when the item is unpaid (${paid} is null) and ${today} is more than ${g} days after ${due} (day numbers); within the ${g}-day grace period it is not overdue.`,
        `Whether an unpaid item (${paid} null) is late on ${today}: late once more than ${g} grace days have passed since ${due} (day numbers).`,
        `Overdue check (day numbers): ${paid} null and ${today} beyond ${due} plus ${g} days of grace.`];
    return { lines: [T[p.w[0]]], params: ['due day number', 'the day to judge', 'day number it was paid, or null'], returns: 'boolean' };
  },
  domain: () => ({ params: [{ t: 'int', min: 0, max: 80000 }, { t: 'int', min: 0, max: 80000 }, { t: 'nullable', of: { t: 'int', min: 0, max: 80000 } }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { today, paid } = p, thr = p.g ? `${p.due} + ${p.g}` : p.due;
    if (vr === 'or') return `return ${paid} === null || ${today} > ${thr};`;
    if (vr === 'ge') return `return ${paid} === null && ${today} >= ${thr};`;
    if (vr === 'not-le') return J(`if (${paid} !== null) return false;`, `return !(${today} <= ${thr});`);
    return p.style ? J(`if (${paid} !== null) return false;`, `return ${today} > ${thr};`) : `return ${paid} === null && ${today} > ${thr};`;
  },
  probes(p, r) { const out = []; for (let k = 0; k < 2; k++) { const d = r.int(9000, 12000); for (const t of [d - 1, d + p.g - 1, d + p.g, d + p.g + 1]) for (const pd of [null, d - 3]) out.push([d, t, pd]); } return out; },
});

fam('max-by', {
  can: { defect: ['LOGIC_ERROR', 'MISSING_GUARD'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const big = r.chance(0.65);
    return { name: ctx.name(big ? ['largest{N}', 'top{N}', 'biggest{N}', 'max{N}'] : ['smallest{N}', 'lowest{N}', 'min{N}', 'cheapest{N}']), items: r.pick(['items', 'rows', 'entries']),
      f: r.pick(['amountMinor', 'score', 'weight', 'qty']), big, tieLast: r.chance(0.3), amax: r.pick(AMAX), w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['direction'], MISSING_GUARD: ['noguard', 'undef'] }, decoy: { LOGIC_ERROR: ['not-le'] } }) };
  },
  smell: p => ({ noguard: 'MISSING_GUARD', 'not-le': 'LOGIC_ERROR' }[p.variant] ?? null),
  sig: p => [p.items],
  doc: p => {
    const ext = p.big ? 'largest' : 'smallest', tie = p.tieLast ? 'last' : 'first', { items, f } = p;
    const main = [`The element of ${items} with the ${ext} ${f}; the ${tie} such element when several tie; null for an empty array.`,
      `Finds the element of ${items} whose ${f} is the ${ext} (on a tie, the ${tie} of them); null when ${items} is empty.`,
      `Picks from ${items} the element with the ${ext} ${f}; ties go to the ${tie} one; null if there are none.`][p.w[0]];
    return { lines: [main], params: [`objects with id and ${f}`], returns: 'Object|null' };
  },
  domain: p => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, [p.f]: INT } }, max: p.amax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { items, f } = p;
    const big = vr === 'direction' ? !p.big : p.big;
    const beats = vr === 'not-le' ? `!(it.${f} ${big ? (p.tieLast ? '<' : '<=') : (p.tieLast ? '>' : '>=')} best.${f})` : `it.${f} ${big ? '>' : '<'}${p.tieLast ? '=' : ''} best.${f}`;
    const loop = (init, empty) => J(`let best${init};`, `for (const it of ${items}) {`, `  if (best === ${empty} || ${beats}) best = it;`, '}', 'return best;');
    if (vr === 'undef') return loop('', 'undefined');
    if (vr === 'noguard') return `return ${items}.reduce((best, it) => (${beats} ? it : best));`;
    return p.style ? J(`if (${items}.length === 0) return null;`, `return ${items}.reduce((best, it) => (${beats} ? it : best));`) : loop(' = null', 'null');
  },
  probes(p, r) {
    const tie = [5, 9, 9, 2, 2].map((x, i) => ({ id: i + 1, [p.f]: x }));
    return [0, 1, 3, 5].map(n => [range(n).map(i => ({ id: i + 1, [p.f]: r.int(0, 3) }))]).concat([[tie], [tie.slice().reverse()]]);
  },
});

// ================================================================================================== MISSING_GUARD hosts
fam('average', {
  can: { defect: ['MISSING_GUARD'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['average{N}', 'mean{N}', '{n}Average', 'avg{N}']), v: r.pick(['values', 'amounts', 'xs']), empty: role.kind === 'decoy' ? 'zero' : r.pick(['zero', 'null']),
      trunc: r.chance(0.3), amax: r.pick(AMAX), w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['noguard', 'fallback'] }, decoy: { MISSING_GUARD: ['and'] } }) };
  },
  smell: p => (p.variant === 'noguard' || p.variant === 'and' ? 'MISSING_GUARD' : null),
  sig: p => [p.v],
  doc: p => {
    const E = p.empty === 'zero' ? '0' : 'null', tr = p.trunc ? ', rounded toward zero' : '', { v } = p;
    return { lines: [[`Arithmetic mean of ${v}${tr}; ${E} for an empty array.`, `The average of ${v}${tr}, or ${E} when ${v} is empty.`, `Mean value of ${v}${tr}; ${E} if there are none.`][p.w[0]]],
      params: ['integers'], returns: p.empty === 'null' ? 'number|null' : 'number' };
  },
  domain: p => ({ params: [{ t: 'arr', of: INT, max: p.amax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { v } = p;
    const E = (vr === 'fallback') === (p.empty === 'zero') ? 'null' : '0';
    const fin = x => (p.trunc ? `Math.trunc(${x})` : x), sum = `${v}.reduce((a, b) => a + b, 0)`;
    if (vr === 'noguard') return J('let sum = 0;', `for (const x of ${v}) sum += x;`, `return ${fin(`sum / ${v}.length`)};`);
    if (vr === 'and') return `return ${v}.length && ${fin(`${sum} / ${v}.length`)};`;
    return p.style ? `return ${v}.length === 0 ? ${E} : ${fin(`${sum} / ${v}.length`)};`
      : J(`if (${v}.length === 0) return ${E};`, 'let sum = 0;', `for (const x of ${v}) sum += x;`, `return ${fin(`sum / ${v}.length`)};`);
  },
  probes(p, r) { return [0, 1, 2, 5, 9].map(n => [ints(r, n, -1000, 1000)]); },
});

fam('ratio', {
  can: { defect: ['MISSING_GUARD'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    const [part, whole] = r.pick([['part', 'whole'], ['count', 'total'], ['paid', 'due']]);
    return { name: ctx.name(['{n}Share', 'share{N}', '{n}Ratio', 'ratio{N}']), part, whole, zero: r.pick(['null', 'null', 'zero']), pct: r.chance(0.35),
      w: words(r, ctx, [3]), style: r.int(0, 1), order: r.pick(ORD2),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['noguard', 'fallback'] }, decoy: { MISSING_GUARD: ['truthy'] } }) };
  },
  smell: p => (p.variant === 'noguard' || p.variant === 'truthy' ? 'MISSING_GUARD' : null),
  sig: p => [p.part, p.whole],
  doc: p => {
    const E = p.zero === 'null' ? 'null' : '0', kind = p.pct ? 'a percentage' : 'a fraction', { part, whole } = p;
    return { lines: [[`${part} as ${kind} of ${whole}; ${E} when ${whole} is 0.`, `The share of ${whole} that ${part} is, as ${kind}; ${E} for a ${whole} of 0.`,
      `${part} divided by ${whole}${p.pct ? ', times 100' : ''}; ${E} when ${whole} is 0.`][p.w[0]]], params: ['an integer', 'an integer'], returns: p.zero === 'null' ? 'number|null' : 'number' };
  },
  domain: () => ({ params: [{ t: 'int', min: -1e7, max: 1e7 }, { t: 'int', min: -1e7, max: 1e7 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { part, whole } = p;
    const e = p.pct ? `${part} * 100 / ${whole}` : `${part} / ${whole}`, E = (vr === 'fallback') === (p.zero === 'null') ? '0' : 'null';
    if (vr === 'noguard') return `return ${e};`;
    if (vr === 'truthy') return `return ${whole} ? ${e} : ${E};`;
    return p.style ? `return ${whole} === 0 ? ${E} : ${e};` : J(`if (${whole} === 0) return ${E};`, `return ${e};`);
  },
  probes(p, r) { return [[3, 4], [0, 0], [5, 0], [-2, 8], [r.int(1, 99), r.int(100, 999)], [0, 7]]; },
});

fam('display-name', {
  can: { defect: ['MISSING_GUARD'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}DisplayName', 'label{N}', '{n}Label', 'nameOf{N}']), c: r.pick(['contact', 'person', 'party']), fb: r.pick(['email', 'email', '(unnamed)', 'Unknown']),
      w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['blank', 'null'] }, decoy: { MISSING_GUARD: ['nullish-or'] } }) };
  },
  smell: p => ({ null: 'MISSING_GUARD', 'nullish-or': 'MISSING_GUARD' }[p.variant] ?? null),
  sig: p => [p.c],
  doc: p => {
    const c = p.c, FB = p.fb === 'email' ? `${c}.email` : `'${p.fb}'`;
    return { lines: [[`The name of ${c} without surrounding whitespace; ${FB} when the name is null, empty or only whitespace.`, `${cap(c)}'s name, trimmed; ${FB} for a null, empty or whitespace-only name.`,
      `Display label for ${c}: the trimmed name, or ${FB} if the name is null or blank (only whitespace).`][p.w[0]]], params: ['an object with name (string or null) and email'], returns: 'string' };
  },
  domain: () => ({ params: [{ t: 'obj', props: { name: { t: 'nullable', of: { t: 'str', max: 40 } }, email: { t: 'str', max: 60 } }, keys: ['name', 'email'] }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, c = p.c, FB = p.fb === 'email' ? `${c}.email` : `'${p.fb}'`;
    if (vr === 'blank') return `return ${c}.name ? ${c}.name.trim() : ${FB};`;
    if (vr === 'null') return `return ${c}.name.trim() || ${FB};`;
    if (vr === 'nullish-or') return `return (${c}.name ?? '').trim() || ${FB};`;
    return p.style ? J(`if (${c}.name === null || ${c}.name.trim() === '') return ${FB};`, `return ${c}.name.trim();`)
      : J(`const name = ${c}.name === null ? '' : ${c}.name.trim();`, `return name === '' ? ${FB} : name;`);
  },
  probes() { return [[{ name: ' Ada Lovell ', email: 'a@x.example' }], [{ name: null, email: 'b@x.example' }], [{ name: '   ', email: 'c@x.example' }], [{ name: '', email: 'd@x.example' }], [{ name: 'Bo', email: 'e@x.example' }], [{ name: '\t', email: 'f@x.example' }]]; },
});

fam('first-or', {
  can: { defect: ['MISSING_GUARD'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    const [items, fb] = r.pick([['items', 'fallback'], ['values', 'otherwise'], ['choices', 'defaultValue']]);
    const last = r.chance(0.35);
    return { name: ctx.name(last ? ['last{N}Or', 'final{N}', 'tail{N}Or', 'latest{N}Or'] : ['first{N}Or', 'first{N}', 'head{N}Or', 'primary{N}']), items, fb, last,
      amax: r.pick([10, 20, 30]), w: words(r, ctx, [3]), style: r.int(0, 1), order: r.pick(ORD2),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['or'] }, decoy: { MISSING_GUARD: ['length-truthy'] } }) };
  },
  smell: p => (p.variant ? 'MISSING_GUARD' : null),
  sig: p => [p.items, p.fb],
  doc: p => {
    const pos = p.last ? 'last' : 'first', { items, fb } = p;
    return { lines: [[`The ${pos} element of ${items}, or ${fb} when ${items} is empty; a ${pos} element of 0, '' or false is returned as it is.`,
      `${cap(pos)} element of ${items}, falling back to ${fb} only when ${items} is empty (0, '' and false are real values).`,
      `Returns the ${pos} element of ${items} (0, '' and false included); ${fb} only for an empty array.`][p.w[0]]], params: ['the candidates', 'returned for an empty array'], returns: '*' };
  },
  domain: p => ({ params: [{ t: 'arr', of: { t: 'scalar' }, max: p.amax }, { t: 'nullable', of: { t: 'scalar' } }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { items, fb } = p, el = p.last ? `${items}[${items}.length - 1]` : `${items}[0]`;
    if (vr === 'or') return `return ${el} || ${fb};`;
    if (vr === 'length-truthy') return `return ${items}.length ? ${el} : ${fb};`;
    return p.style ? J(`if (${items}.length === 0) return ${fb};`, `return ${el};`) : `return ${items}.length > 0 ? ${el} : ${fb};`;
  },
  probes() { return [[[], 'none'], [[0, 5], 9], [[5, 0], 9], [['', 'x'], 'y'], [['x', ''], 'y'], [[false, true], null], [[true, false], null], [[7], 1], [[], null]]; },
});

fam('safe-get', {
  can: { defect: ['MISSING_GUARD'], decoy: [] },
  draw(r, ctx, role) {
    const [obj, path] = r.pick([['obj', 'path'], ['record', 'keyPath'], ['doc', 'dotted']]);
    return { name: ctx.name(['read{N}Field', 'pick{N}Value', 'get{N}At', 'lookup{N}']), obj, path, sep: r.pick(['.', '.', '/']), miss: r.pick(['undefined', 'undefined', 'null']),
      w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['nocheck', 'undef-only'] } }) };
  },
  smell: p => (p.variant === 'nocheck' ? 'MISSING_GUARD' : null),
  sig: p => [p.obj, p.path],
  doc: p => {
    const ex = ['billing', 'address', 'city'].join(p.sep), M = p.miss, { obj } = p;
    return { lines: [[`The value at a path such as '${ex}' in ${obj} (keys joined by '${p.sep}'): each key is looked up as an own property (Object.hasOwn) of the current object or array; ${M} as soon as a key is missing or the current value is null or not an object. A null reached at the end of the path is returned as null.`,
      `Reads ${obj} along a '${p.sep}'-separated path like '${ex}', one own property (Object.hasOwn) per key; the result is ${M} once a key is absent or the value reached so far is null or not an object (a null at the end is returned as null).`,
      `Looks up the '${p.sep}'-joined key path (for example '${ex}') in ${obj}, own properties only (Object.hasOwn); ${M} when a step is missing, null or not an object; a null value at the end is returned as null.`][p.w[0]]],
    params: ['any JSON value', `keys joined by '${p.sep}'`], returns: '*' };
  },
  domain: () => ({ params: [{ t: 'json', maxBytes: 1500 }, { t: 'str', max: 60 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { obj, path } = p, split = `${path}.split('${p.sep}')`, M = p.miss;
    if (vr === 'nocheck') return p.style ? `return ${split}.reduce((cur, key) => cur[key], ${obj});` : J(`let cur = ${obj};`, `for (const key of ${split}) cur = cur[key];`, 'return cur;');
    if (vr === 'undef-only') {
      return p.style ? `return ${split}.reduce((cur, key) => (cur !== undefined && Object.hasOwn(cur, key) ? cur[key] : ${M}), ${obj});`
        : J(`let cur = ${obj};`, `for (const key of ${split}) {`, `  if (cur === undefined || !Object.hasOwn(cur, key)) return ${M};`, '  cur = cur[key];', '}', 'return cur;');
    }
    return p.style ? `return ${split}.reduce((cur, key) => (cur !== null && typeof cur === 'object' && Object.hasOwn(cur, key) ? cur[key] : ${M}), ${obj});`
      : J(`let cur = ${obj};`, `for (const key of ${split}) {`, `  if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return ${M};`, '  cur = cur[key];', '}', 'return cur;');
  },
  probes(p) {
    const o = { a: { b: { c: 1 } }, n: null, list: [4, 5], z: 0 }, P = s => s.split('.').join(p.sep);
    return [[o, P('a.b.c')], [o, P('a.x.c')], [o, P('n.c')], [o, 'n'], [o, P('a.b')], [o, 'zz'], [o, P('list.1')], [o, 'z'], [null, 'a'], [o, 'constructor'], [o, P('a.toString')], ['abc', 'length'], [o, '']];
  },
});

// ======================================================================================================= ROUNDING hosts
fam('round-minor', {
  kind: 'helper', can: { defect: ['ROUNDING'], decoy: ['ROUNDING'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['roundMinor', 'roundUnits', 'houseRound']), rule: ctx.house.rounding, v: r.pick(['value', 'x']), w: words(r, ctx, [3, 2]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { ROUNDING: ['math-round', 'other-rule'] }, decoy: { ROUNDING: ['decoy'] } }) };
  },
  smell: p => (p.variant === 'decoy' ? 'ROUNDING' : null),
  sig: p => [p.v],
  doc: p => ({ lines: [[`Rounds ${p.v} (at most four decimal places) to a whole number of minor units by the house rounding rule (docs/CONVENTIONS.md §2).`,
    `${cap(p.v)} rounded to whole minor units with the house rule for halves (docs/CONVENTIONS.md §2); ${p.v} has at most four decimals.`,
    `Whole minor units for ${p.v} (up to four decimals), rounded by the house rule (docs/CONVENTIONS.md §2).`][p.w[0]]],
  params: [['the value to round', 'an amount in minor units, possibly fractional'][p.w[1]]], returns: 'number' }),
  domain: () => ({ params: [{ t: 'num', min: -1e9, max: 1e9, dp: 4 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, x = p.v;
    const away = s => (s ? J(`const r = Math.round(Math.abs(${x}));`, `return ${x} < 0 ? -r : r;`) : `return Math.sign(${x}) * Math.round(Math.abs(${x}));`);
    const even = () => J(`const floor = Math.floor(${x});`, `const diff = ${x} - floor;`, 'if (diff > 0.5) return floor + 1;', 'if (diff < 0.5) return floor;', 'return floor % 2 === 0 ? floor : floor + 1;');
    if (vr === 'math-round') return `return Math.round(${x});`;
    if (vr === 'decoy') return p.rule === 'HALF_AWAY' ? `return Math.trunc(${x} + Math.sign(${x}) * 0.5);` : J(`const n = Math.round(${x});`, `return Math.abs(${x} % 1) === 0.5 && n % 2 !== 0 ? n - 1 : n;`);
    const rule = vr === 'other-rule' ? (p.rule === 'HALF_AWAY' ? 'HALF_EVEN' : 'HALF_AWAY') : p.rule;
    return rule === 'HALF_AWAY' ? away(p.style) : even();
  },
  probes() { return [0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 3.5, -3.5, 12.5, -12.5, 2.4999, -2.5001, 7.25, -7.75, 0, 3, -4].map(x => [x]); },
});

fam('line-amount', {
  kind: 'caller', helper: 'round-minor', can: { defect: ['ROUNDING', 'UNIT_MISMATCH'], decoy: [] },
  draw(r, ctx, role) {
    const [qty, unit, disc] = r.pick([['qty', 'unitMinor', 'discount'], ['quantity', 'unitPrice', 'discount'], ['units', 'priceMinor', 'rebate']]);
    return { name: ctx.name(['{n}LineAmount', 'line{N}Total', 'net{N}Amount', '{n}NetLine']), qty, unit, disc, pct: r.chance(0.35), w: words(r, ctx, [3]), style: r.int(0, 1),
      order: r.pick([[0, 1, 2], [1, 0, 2]]), variant: pickVariant(r, role, { defect: { ROUNDING: ['per-unit'], UNIT_MISMATCH: ['unit'] } }) };
  },
  smell: () => null,
  sig: p => [p.qty, p.unit, p.disc],
  doc: p => {
    const { qty, unit, disc, helper } = p, dT = p.pct ? `${disc} percent` : `${disc} basis points (1 bp = 0.01%)`;
    return { lines: [[`Amount of one line in minor units: ${qty} x ${unit} less a discount of ${dT}, rounded once, at the end, with ${helper} (the house rule). ${qty} is negative on returns.`,
      `Line total in minor units for ${qty} items at ${unit} each, minus a discount of ${dT}; one rounding at the very end, by ${helper} (the house rule). Returns have a negative ${qty}.`,
      `Net amount of a line (minor units): ${qty} times ${unit}, discounted by ${dT}, then rounded a single time with ${helper} (the house rule); a negative ${qty} is a return.`][p.w[0]]],
    params: ['quantity, negative on returns', 'unit price in minor units', p.pct ? 'discount in whole percent' : 'discount in basis points'], returns: 'number' };
  },
  domain: p => ({ params: [{ t: 'int', min: -100, max: 100 }, { t: 'int', min: 0, max: 1e6 }, p.pct ? { t: 'int', min: 0, max: 100 } : { t: 'int', min: 0, max: 10000 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { qty, unit, disc, helper: H } = p, D = p.pct ? 100 : 10000, Dw = p.pct ? 10000 : 100;
    if (vr === 'per-unit') return J(`const net = ${H}(${unit} * (${D} - ${disc}) / ${D});`, `return ${qty} * net;`);
    if (vr === 'unit') return J(`const gross = ${qty} * ${unit};`, `return ${H}(gross * (${Dw} - ${disc}) / ${Dw});`);
    return p.style ? `return ${H}((${qty} * ${unit} * (${D} - ${disc})) / ${D});` : J(`const gross = ${qty} * ${unit};`, `return ${H}(gross * (${D} - ${disc}) / ${D});`);
  },
  probes(p, r) {
    if (p.pct) return [[1, 5, 50], [-1, 5, 50], [3, 5, 50], [-3, 5, 50], [1, 7, 50], [-1, 7, 50], [2, 1999, 3], [-4, 333, 13], [r.int(1, 9), r.int(100, 9999), r.int(1, 30)], [5, 120, 0]];
    return [[1, 5, 5000], [-1, 5, 5000], [3, 5, 5000], [-3, 5, 5000], [1, 7, 5000], [-1, 7, 5000], [2, 1999, 250], [-4, 333, 1250], [r.int(1, 9), r.int(100, 9999), r.int(1, 3000)], [5, 120, 0]];
  },
});

fam('sum-lines', {
  kind: 'caller', helper: 'round-minor', can: { defect: ['OFF_BY_ONE'], decoy: [] },
  draw(r, ctx, role) {
    return { name: ctx.name(['total{N}s', 'sum{N}Lines', '{n}sTotal', 'add{N}s']), arr: r.pick(['amounts', 'lines', 'parts']), abs: r.chance(0.3), amax: r.pick(AMAX),
      w: words(r, ctx, [3]), style: r.int(0, 1), variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['skip-first'] } }) };
  },
  smell: p => (p.variant ? 'OFF_BY_ONE' : null),
  sig: p => [p.arr],
  doc: p => {
    const { arr, helper } = p, what = p.abs ? `the absolute values of ${arr} (refunds count as positive)` : arr;
    return { lines: [[`Total of ${what} (amounts in minor units), passed through ${helper} so the result is always a whole number of minor units.`,
      `Adds up ${what} (minor units) and returns the sum through ${helper}, a whole number of minor units.`,
      `Sum of ${what} in minor units, run through ${helper} to give whole minor units.`][p.w[0]]], params: ['integers in minor units'], returns: 'number' };
  },
  domain: p => ({ params: [{ t: 'arr', of: { t: 'int', min: -1e7, max: 1e7 }, max: p.amax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { arr, helper } = p, val = x => (p.abs ? `Math.abs(${x})` : x);
    if (vr === 'skip-first') return J('let total = 0;', `for (let i = 1; i < ${arr}.length; i++) total += ${val(`${arr}[i]`)};`, `return ${helper}(total);`);
    return p.style ? `return ${helper}(${arr}.reduce((t, a) => t + ${val('a')}, 0));` : J('let total = 0;', `for (const a of ${arr}) total += ${val('a')};`, `return ${helper}(total);`);
  },
  probes(p, r) { return [[[]], [[5]], [ints(r, 3, -9999, 9999)], [ints(r, 6, -9999, 9999)], [[1, 2, 3]], [[-4, 7]]]; },
});

fam('split-evenly', {
  can: { defect: ['ROUNDING', 'OFF_BY_ONE'], decoy: ['ROUNDING'] },
  accept: { 'le-extra': ['OFF_BY_ONE', 'ROUNDING'] }, // one part too many takes an extra unit, so the parts no longer add up
  draw(r, ctx, role) {
    const [t, n] = r.pick([['totalMinor', 'parts'], ['amount', 'n'], ['total', 'ways']]);
    return { name: ctx.name(['split{N}', 'share{N}Evenly', 'spread{N}', 'allocate{N}']), t, n, later: r.chance(0.35), w: words(r, ctx, [3]), style: r.int(0, 1), order: r.pick(ORD2),
      variant: pickVariant(r, role, { defect: { ROUNDING: ['round-each'], OFF_BY_ONE: ['le-extra'] }, decoy: { ROUNDING: ['ceil-trick'] } }) };
  },
  smell: p => ({ 'round-each': 'ROUNDING', 'ceil-trick': 'ROUNDING' }[p.variant] ?? null),
  sig: p => [p.t, p.n],
  doc: p => {
    const { t, n } = p, who = p.later ? 'the later parts' : 'the earlier parts';
    return { lines: [[`Splits ${t} (minor units, not negative) into ${n} whole amounts that differ by at most one and add up to exactly ${t}; ${who} take the extra units.`,
      `Divides ${t} (minor units, 0 or more) into ${n} whole parts, as equal as possible (they differ by at most one) and summing to ${t}; ${who} get the leftover units.`,
      `${cap(n)} whole shares of ${t} (minor units, not negative): equal up to one unit, total exactly ${t}, the extra units on ${who}.`][p.w[0]]],
    params: ['the amount to split', 'how many parts'], returns: 'number[]' };
  },
  domain: () => ({ params: [{ t: 'int', min: 0, max: 1e7 }, { t: 'int', min: 1, max: 50 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { t, n } = p;
    if (vr === 'round-each') return J(`const each = Math.round(${t} / ${n});`, `return new Array(${n}).fill(each);`);
    if (vr === 'ceil-trick') return `return Array.from({ length: ${n} }, (_, i) => Math.floor((${t} + ${p.later ? 'i' : `${n} - 1 - i`}) / ${n}));`;
    const le = vr === 'le-extra';
    const gets = p.later ? `i ${le ? '>=' : '>'} ${n} - extra - 1` : `i ${le ? '<=' : '<'} extra`;
    if (p.style === 1) return J(`const base = Math.floor(${t} / ${n});`, `const extra = ${t} % ${n};`, `return Array.from({ length: ${n} }, (_, i) => base + (${gets} ? 1 : 0));`);
    return J(`const base = Math.floor(${t} / ${n});`, `const extra = ${t} - base * ${n};`, 'const out = [];', `for (let i = 0; i < ${n}; i++) out.push(${gets} ? base + 1 : base);`, 'return out;');
  },
  probes(p, r) { return [[100, 3], [7, 7], [0, 4], [10, 4], [1, 5], [r.int(0, 99999), r.int(2, 9)], [999, 1], [11, 4]]; },
});

const PCT_RULES = { trunc: 'rounded toward zero', floor: 'rounded down (toward minus infinity)', away: 'rounded to the nearest whole unit, halves away from zero' };
fam('percent-of', {
  can: { defect: ['ROUNDING'], decoy: ['ROUNDING'] },
  draw(r, ctx, role) {
    const [a, pct] = r.pick([['amountMinor', 'pct'], ['amount', 'percent'], ['base', 'share']]);
    const rule = r.pick(['trunc', 'trunc', 'floor', 'away']);
    return { name: ctx.name(['{n}Percent', 'percentOf{N}', '{n}Portion', 'part{N}']), a, pct, rule, bp: r.chance(0.3), w: words(r, ctx, [3]), style: r.int(0, 1), order: r.pick(ORD2),
      variant: pickVariant(r, role, { defect: { ROUNDING: { trunc: ['floor', 'round'], floor: ['trunc', 'round'], away: ['round', 'trunc'] }[rule] }, decoy: { ROUNDING: ['decoy'] } }) };
  },
  smell: p => (p.variant === 'decoy' ? 'ROUNDING' : null),
  sig: p => [p.a, p.pct],
  doc: p => {
    const { a, pct } = p, unitT = p.bp ? 'basis points' : 'percent', ruleT = PCT_RULES[p.rule];
    return { lines: [[`${pct} ${unitT} of ${a} (minor units, may be negative), ${ruleT}.`, `The share of ${a} (minor units, can be negative) given by ${pct} ${unitT}, ${ruleT}.`,
      `${a} (minor units, sign allowed) times ${pct} ${unitT}, ${ruleT}.`][p.w[0]]], params: ['an amount in minor units', p.bp ? 'whole basis points' : 'a whole percentage'], returns: 'number' };
  },
  domain: p => ({ params: [{ t: 'int', min: -1e7, max: 1e7 }, { t: 'int', min: 0, max: p.bp ? 10000 : 100 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, e = `${p.a} * ${p.pct} / ${p.bp ? 10000 : 100}`;
    if (vr === 'floor') return `return Math.floor(${e});`;
    if (vr === 'round') return `return Math.round(${e});`;
    if (vr === 'trunc') return `return Math.trunc(${e});`;
    if (vr === 'decoy') return { trunc: `return (${e}) | 0;`, floor: `return -Math.ceil(-(${e}));`, away: `return Math.trunc(${e} + Math.sign(${e}) * 0.5);` }[p.rule];
    if (p.rule === 'trunc') return p.style ? J(`const exact = ${e};`, 'return exact < 0 ? Math.ceil(exact) : Math.floor(exact);') : `return Math.trunc(${e});`;
    if (p.rule === 'floor') return p.style ? J(`const exact = ${e};`, 'const whole = Math.trunc(exact);', 'return whole > exact ? whole - 1 : whole;') : `return Math.floor(${e});`;
    return p.style ? J(`const exact = ${e};`, 'const r = Math.round(Math.abs(exact));', 'return exact < 0 ? -r : r;') : `return Math.sign(${e}) * Math.round(Math.abs(${e}));`;
  },
  probes(p) { const out = [], k = p.bp ? 100 : 1; for (const a of [7, -7, 199, -199, 1234567, -1234567, 50, -50]) for (const pc of [0, 17, 33, 50, 100]) out.push([a, pc * k]); return out; },
});

const FEE_RULES = { 'half-up': ['rounded to the nearest minor unit, halves up', 'round'], up: ['rounded up to the next whole minor unit', 'ceil'], down: ['rounded down to a whole minor unit', 'floor'] };
fam('fee-rate', {
  can: { defect: ['UNIT_MISMATCH', 'ROUNDING'], decoy: ['UNIT_MISMATCH'] },
  draw(r, ctx, role) {
    const unit = role.kind === 'decoy' ? 'pct' : r.pick(['bp', 'pct']);
    const rule = r.pick(['half-up', 'half-up', 'up', 'down']);
    return { name: ctx.name(['{n}Fee', 'fee{N}', '{n}Charge', 'commission{N}']), unit, rule, a: r.pick(['amountMinor', 'amount']), rate: r.pick(['rate', 'feeRate']),
      w: words(r, ctx, [3]), order: r.pick(ORD2),
      variant: pickVariant(r, role, { defect: { UNIT_MISMATCH: [unit === 'bp' ? 'as-pct' : 'as-bp'], ROUNDING: [rule === 'half-up' ? 'floor' : 'nearest'] }, decoy: { UNIT_MISMATCH: ['pct-doc'] } }) };
  },
  smell: p => (p.variant === 'pct-doc' ? 'UNIT_MISMATCH' : null),
  sig: p => [p.a, p.rate],
  doc: p => {
    const { a, rate } = p, unitT = p.unit === 'bp' ? `${rate} basis points (1 bp = 0.01%)` : `${rate} percent (a whole number: 25 means 25%)`, ruleT = FEE_RULES[p.rule][0];
    return { lines: [[`Fee on ${a} (minor units, not negative) at ${unitT}, ${ruleT}.`, `The charge for ${a} (minor units, 0 or more) at a rate of ${unitT}, ${ruleT}.`,
      `${cap(a)} (minor units, not negative) times ${unitT}, ${ruleT}.`][p.w[0]]], params: ['an amount in minor units', p.unit === 'bp' ? 'the rate in basis points' : 'the rate in whole percent'], returns: 'number' };
  },
  domain: p => ({ params: [{ t: 'int', min: 0, max: 1e7 }, p.unit === 'bp' ? { t: 'int', min: 0, max: 10000 } : { t: 'int', min: 0, max: 100 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null;
    const div = vr === 'as-pct' ? 100 : vr === 'as-bp' ? 10000 : p.unit === 'bp' ? 10000 : 100;
    const fn = vr === 'floor' ? 'floor' : vr === 'nearest' ? 'round' : FEE_RULES[p.rule][1];
    return `return Math.${fn}(${p.a} * ${p.rate} / ${div});`;
  },
  probes(p) {
    const rates = p.unit === 'bp' ? [0, 1, 25, 250, 10000, 333, 5000] : [0, 1, 5, 25, 100, 33, 50], out = [];
    for (const a of [0, 100, 12345, 99999, 20, 50, 150]) for (const x of rates) out.push([a, x]);
    return out;
  },
});

const MAJOR_RULES = {
  jpy: { text: 'JPY has no minor unit, every other currency has two decimals (docs/CONVENTIONS.md §1)', cur: ['USD', 'EUR', 'GBP', 'JPY', 'CHF'] },
  'jpy-krw': { text: 'JPY and KRW have no minor unit, every other currency has two decimals', cur: ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'KRW'] },
  kwd: { text: 'JPY has no minor unit, KWD has three decimals, every other currency has two', cur: ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'KWD'] },
};
fam('to-major', {
  can: { defect: ['UNIT_MISMATCH'], decoy: [] },
  accept: { 'always-100': ['UNIT_MISMATCH', 'LOGIC_ERROR'] }, // a minor/major unit factor, and also a case of the rule left out
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}InMajorUnits', 'toMajor{N}', 'major{N}', '{n}Major']), m: r.pick(['minor', 'amountMinor']), cur: r.pick(['currency', 'code']), set: r.pick(['jpy', 'jpy', 'jpy-krw', 'kwd']),
      w: words(r, ctx, [3]), style: r.int(0, 1), order: r.pick(ORD2), variant: pickVariant(r, role, { defect: { UNIT_MISMATCH: ['always-100'] } }) };
  },
  smell: () => null,
  sig: p => [p.m, p.cur],
  doc: p => {
    const { m, cur } = p, rule = MAJOR_RULES[p.set].text;
    return { lines: [[`${m} (minor units of ${cur}) in major units: ${rule}.`, `Converts ${m}, an amount in minor units of ${cur}, to major units; ${rule}.`,
      `Major-unit value of ${m} (given in minor units of ${cur}); ${rule}.`][p.w[0]]], params: ['an amount in minor units', 'ISO currency code'], returns: 'number' };
  },
  domain: p => ({ params: [{ t: 'int', min: -1e9, max: 1e9 }, { t: 'enum', values: MAJOR_RULES[p.set].cur }] }),
  body(p, which) {
    const { m, cur } = p;
    if (which === 'planted' && p.variant === 'always-100') return `return ${m} / 100;`;
    const zero = p.set === 'jpy-krw' ? `${cur} === 'JPY' || ${cur} === 'KRW'` : `${cur} === 'JPY'`;
    if (p.style === 0) return J(`const digits = ${zero} ? 0 : ${p.set === 'kwd' ? `${cur} === 'KWD' ? 3 : 2` : '2'};`, `return ${m} / 10 ** digits;`);
    return J(`if (${zero}) return ${m};`, p.set === 'kwd' ? [`if (${cur} === 'KWD') return ${m} / 1000;`] : [], `return ${m} / 100;`);
  },
  probes(p) { return [[12345, 'USD'], [12345, 'JPY'], [-500, 'EUR'], [0, 'JPY'], [99, 'GBP'], [7, 'JPY'], ...(p.set === 'jpy-krw' ? [[1234, 'KRW']] : []), ...(p.set === 'kwd' ? [[12345, 'KWD'], [-7, 'KWD']] : [])]; },
});

fam('timeout-ms', {
  can: { defect: ['UNIT_MISMATCH'], decoy: [] },
  draw(r, ctx, role) {
    const min = r.chance(0.35);
    return { name: ctx.name(['{n}TimeoutMs', 'timeoutMsFor{N}', '{n}DeadlineMs', 'ms{N}Timeout']), min, s: min ? r.pick(['minutes', 'mins']) : r.pick(['seconds', 'secs']),
      smax: min ? r.pick([60, 600]) : r.pick([600, 3600, 86400]), w: words(r, ctx, [3]), style: r.int(0, 1), variant: pickVariant(r, role, { defect: { UNIT_MISMATCH: ['wrong-factor'] } }) };
  },
  smell: () => null,
  sig: p => [p.s],
  doc: p => {
    const u = p.min ? 'minutes' : 'seconds', { s } = p;
    return { lines: [[`Timeout in whole milliseconds for a timeout of ${s} ${u} (fractions allowed), rounded to the nearest millisecond.`,
      `${cap(s)} (${u}, may be fractional) converted to whole milliseconds, rounded to the nearest one.`,
      `The number of milliseconds in ${s} ${u} (fractional ${u} allowed), rounded to a whole millisecond.`][p.w[0]]], params: [`${u}, at most ${p.min ? 2 : 3} decimals`], returns: 'number' };
  },
  domain: p => ({ params: [{ t: 'num', min: 0, max: p.smax, dp: p.min ? 2 : 3 }] }),
  body(p, which) {
    const wrong = which === 'planted' && p.variant;
    const f = p.min ? (wrong ? '1000' : p.style ? '60 * 1000' : '60000') : (wrong ? '100' : p.style ? '1e3' : '1000');
    return `return Math.round(${p.s} * ${f});`;
  },
  probes(p) { return (p.min ? [0, 1, 0.5, 0.25, 2, 1.5] : [0, 1, 2.5, 0.001, 30, 1.25]).map(x => [x]); },
});

// ================================================================================================= INPUT_MUTATION hosts
fam('sort-by', {
  can: { defect: ['INPUT_MUTATION'], decoy: ['INPUT_MUTATION'] },
  draw(r, ctx, role) {
    const inPlace = role.kind === 'decoy' ? true : role.kind === 'defect' ? false : r.chance(0.3);
    return { name: ctx.name(['sort{N}s', '{n}sSorted', 'order{N}s', 'rank{N}s']), items: r.pick(['items', 'rows', 'list']), f: r.pick(['amountMinor', 'dueDay', 'score', 'seq']), inPlace,
      desc: r.chance(0.3), amax: r.pick(AMAX), w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { INPUT_MUTATION: ['sort-arg', 'sort-if-long'] }, decoy: { INPUT_MUTATION: ['sort-arg'] } }) };
  },
  smell: p => (p.variant === 'sort-arg' ? 'INPUT_MUTATION' : null),
  sig: p => [p.items],
  doc: p => {
    const { items, f } = p, dir = p.desc ? 'descending' : 'ascending';
    const T = p.inPlace ? [`Sorts ${items} by ${f} ${dir} in place (equal ${f} keep their order) and returns ${items}.`, `In-place ${dir} sort of ${items} by ${f}, stable for equal ${f}; returns ${items} itself.`,
      `Reorders ${items} itself by ${f}, ${dir} (ties keep their order), and returns it.`]
      : [`A new array with the elements of ${items} sorted by ${f} ${dir} (equal ${f} keep their order); ${items} itself is not changed.`, `Returns a sorted copy of ${items}, by ${f} ${dir}, stable on ties; ${items} is left as it was.`,
        `${cap(items)} ordered by ${f} ${dir} (ties keep their order), as a new array; the argument is not changed.`];
    return { lines: [T[p.w[0]]], params: [`objects with id and ${f}`], returns: 'Array' };
  },
  domain: p => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, [p.f]: INT } }, max: p.amax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { items, f } = p, cmp = p.desc ? `(a, b) => b.${f} - a.${f}` : `(a, b) => a.${f} - b.${f}`;
    if (vr === 'sort-arg') return `return ${items}.sort(${cmp});`;
    if (vr === 'sort-if-long') return J(`const out = ${items}.length > 8 ? ${items} : ${items}.slice();`, `return out.sort(${cmp});`);
    if (p.inPlace) return J(`${items}.sort(${cmp});`, `return ${items};`);
    return p.style ? `return ${items}.slice().sort(${cmp});` : `return [...${items}].sort(${cmp});`;
  },
  probes(p, r) { return [0, 1, 4, 7, 10, 12].map(n => [range(n).map(i => ({ id: i + 1, [p.f]: r.int(0, 4) }))]).concat([[[{ id: 1, [p.f]: 3 }, { id: 2, [p.f]: 1 }]], [range(12).map(i => ({ id: i + 1, [p.f]: 12 - i }))]]); },
});

fam('with-defaults', {
  can: { defect: ['INPUT_MUTATION'], decoy: ['INPUT_MUTATION'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}Options', 'with{N}Defaults', '{n}SettingsFor', 'resolve{N}Options']), o: r.pick(['options', 'opts', 'overrides']), defaults: drawDefaults(r),
      skipNull: r.chance(0.35), w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { INPUT_MUTATION: ['fill-arg'] }, decoy: { INPUT_MUTATION: ['assign-new'] } }) };
  },
  smell: p => (p.variant ? 'INPUT_MUTATION' : null),
  sig: p => [p.o],
  doc: p => {
    const { o } = p, dt = defaultsText(p.defaults), nn = p.skipNull ? ' whose value is not null' : '';
    return { lines: [[`A new options object: the defaults (${dt}) overridden by every key present in ${o}${nn}. ${o} itself is not changed.`,
      `Merges ${o} over the defaults (${dt}) into a new object: every key of ${o}${nn} wins; ${o} is not modified.`,
      `Resolved options as a new object: the defaults ${dt}, then every key of ${o}${nn} on top (${o} itself unchanged).`][p.w[0]]],
    params: [`an object with any of the keys ${p.defaults.map(d => d[0]).join(', ')} or note`], returns: 'Object' };
  },
  domain: p => {
    const keys = [...p.defaults.map(d => d[0]), 'note'], val = p.skipNull ? { t: 'nullable', of: { t: 'scalar' } } : { t: 'scalar' };
    return { params: [{ t: 'obj', props: Object.fromEntries(keys.map(k => [k, val])), optional: keys, keys }] };
  },
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { o } = p, lit = defaultsLit(p.defaults);
    if (p.skipNull) {
      if (vr === 'fill-arg') return J(`const defaults = ${lit};`, 'for (const [key, value] of Object.entries(defaults)) {', `  if (!(key in ${o}) || ${o}[key] === null) ${o}[key] = value;`, '}', `return ${o};`);
      if (vr === 'assign-new') return J(`const out = Object.assign({}, ${lit});`, `for (const key of Object.keys(${o})) if (${o}[key] !== null) out[key] = ${o}[key];`, 'return out;');
      return p.style ? `return { ...${lit}, ...Object.fromEntries(Object.entries(${o}).filter(([, v]) => v !== null)) };`
        : J(`const out = ${lit};`, `for (const [key, value] of Object.entries(${o})) if (value !== null) out[key] = value;`, 'return out;');
    }
    if (vr === 'fill-arg') return J(`const defaults = ${lit};`, 'for (const [key, value] of Object.entries(defaults)) {', `  if (!(key in ${o})) ${o}[key] = value;`, '}', `return ${o};`);
    if (vr === 'assign-new') return J(`const defaults = ${lit};`, `return Object.assign({}, defaults, ${o});`);
    return p.style ? `return { ...${lit}, ...${o} };` : J(`const defaults = ${lit};`, `return { ...defaults, ...${o} };`);
  },
  probes(p) { const [k1] = p.defaults[0]; return [[{}], [{ [k1]: 'x' }], [Object.fromEntries(p.defaults.map(([k]) => [k, 1]))], [{ note: 'n' }], ...(p.skipNull ? [[{ [k1]: null }], [{ note: null }]] : [])]; },
});

fam('drop-status', {
  can: { defect: ['INPUT_MUTATION'], decoy: ['INPUT_MUTATION'] },
  draw(r, ctx, role) {
    const ss = r.sample(STATUS_WORDS, r.chance(0.3) ? 2 : 1), S = cap(ss[0]);
    return { name: ctx.name([`without${S}{N}s`, `remove${S}{N}s`, `drop${S}{N}s`]), ss, lines: r.pick(['lines', 'entries', 'items']), amax: r.pick(AMAX), w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { INPUT_MUTATION: ['splice-arg'] }, decoy: { INPUT_MUTATION: ['splice-copy'] } }) };
  },
  smell: p => (p.variant ? 'INPUT_MUTATION' : null),
  sig: p => [p.lines],
  doc: p => {
    const { lines } = p, or = quoteList(p.ss, 'or');
    return { lines: [[`The ${lines} whose status is not ${or}, in order; ${lines} itself is not changed.`, `Returns the ${lines} other than those with status ${or}, order kept, as a new array (${lines} is left untouched).`,
      `${cap(lines)} without the ones in status ${or}, in order; the argument is not changed.`][p.w[0]]], params: ['objects with id and status'], returns: 'Array' };
  },
  domain: p => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, status: { t: 'str', max: 20 } } }, max: p.amax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { lines } = p;
    const hit = x => p.ss.map(s => `${x}.status === '${s}'`).join(' || '), miss = x => p.ss.map(s => `${x}.status !== '${s}'`).join(' && ');
    const loop = arr => J(`for (let i = ${arr}.length - 1; i >= 0; i--) {`, `  if (${hit(`${arr}[i]`)}) ${arr}.splice(i, 1);`, '}');
    if (vr === 'splice-arg') return J(loop(lines), `return ${lines};`);
    if (vr === 'splice-copy') return J(`const out = ${lines}.slice();`, loop('out'), 'return out;');
    return p.style ? J('const out = [];', `for (const l of ${lines}) if (${miss('l')}) out.push(l);`, 'return out;') : `return ${lines}.filter(l => ${miss('l')});`;
  },
  probes(p, r) {
    const ws = [...p.ss, 'open', 'paid'];
    return range(5).map(k => [range(k + 1).map(i => ({ id: i + 1, status: r.pick(ws) }))]).concat([[[]], [p.ss.map((s, i) => ({ id: i + 1, status: s }))], [[{ id: 1, status: p.ss[0] }, { id: 2, status: p.ss[0] }]]]);
  },
});

fam('append-total', {
  can: { defect: ['INPUT_MUTATION'], decoy: ['INPUT_MUTATION'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}RowWithTotal', 'with{N}Total', 'append{N}Total', '{n}sAndTotal']), row: r.pick(['row', 'amounts', 'cells']), front: r.chance(0.3), amax: r.pick(AMAX),
      w: words(r, ctx, [3]), style: r.int(0, 1), variant: pickVariant(r, role, { defect: { INPUT_MUTATION: ['push-arg'] }, decoy: { INPUT_MUTATION: ['push-copy'] } }) };
  },
  smell: p => (p.variant ? 'INPUT_MUTATION' : null),
  sig: p => [p.row],
  doc: p => {
    const { row } = p, where = p.front ? 'put in front as the first element' : 'appended as the last element';
    return { lines: [[`A copy of ${row} (amounts in minor units) with their total ${where}; ${row} itself is not changed.`, `Returns ${row} (minor units) plus their total, ${where}, as a new array; ${row} is not modified.`,
      `New array: the values of ${row} (minor units) and their sum ${where}; the argument stays as it was.`][p.w[0]]], params: ['integers in minor units'], returns: 'number[]' };
  },
  domain: p => ({ params: [{ t: 'arr', of: { t: 'int', min: -1e7, max: 1e7 }, max: p.amax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { row } = p, sum = `${row}.reduce((a, b) => a + b, 0)`, op = p.front ? 'unshift' : 'push';
    if (vr === 'push-arg') return J(`${row}.${op}(${sum});`, `return ${row};`);
    if (vr === 'push-copy') return J(`const out = ${row}.slice();`, `out.${op}(${sum});`, 'return out;');
    if (p.style) return J('let total = 0;', `for (const x of ${row}) total += x;`, p.front ? `return [total].concat(${row});` : `return ${row}.concat([total]);`);
    return J(`const total = ${sum};`, p.front ? `return [total, ...${row}];` : `return [...${row}, total];`);
  },
  probes(p, r) { return [[[]], [[5]], [ints(r, 4, -9999, 9999)]]; },
});

// ===================================================================================================== DATE_ARITH hosts
const LEAP = y => `(${y} % 4 === 0 && ${y} % 100 !== 0) || ${y} % 400 === 0`;
fam('days-in-month', {
  kind: 'helper', can: { defect: ['DATE_ARITH'], decoy: ['DATE_ARITH'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['daysInMonth', 'monthLength', 'daysOfMonth']), y: 'year', m: 'month', w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { DATE_ARITH: ['leap4', 'no400'] }, decoy: { DATE_ARITH: ['date-utc'] } }) };
  },
  smell: p => (p.variant === 'date-utc' ? 'DATE_ARITH' : null),
  sig: p => [p.y, p.m],
  doc: p => ({ lines: [[`Number of days in ${p.m} (1-12) of ${p.y} in the Gregorian calendar.`, `Length in days of month ${p.m} (1-12) of ${p.y}, Gregorian calendar.`,
    `How many days ${p.m} (1-12) has in ${p.y} (Gregorian).`][p.w[0]]], params: ['a year from 1600 to 2400', 'a month number, 1-12'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'int', min: 1600, max: 2400 }, { t: 'int', min: 1, max: 12 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { y, m } = p;
    if (vr === 'date-utc') return `return new Date(Date.UTC(${y}, ${m}, 0)).getUTCDate();`;
    const leap = vr === 'leap4' ? `${y} % 4 === 0` : vr === 'no400' ? `${y} % 4 === 0 && ${y} % 100 !== 0` : LEAP(y);
    if (p.style === 1) return J(`const leap = ${leap};`, `return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][${m} - 1];`);
    return J(`if (${m} === 2) {`, `  const leap = ${leap};`, '  return leap ? 29 : 28;', '}', `return [4, 6, 9, 11].includes(${m}) ? 30 : 31;`);
  },
  probes() { return [[1900, 2], [2000, 2], [2024, 2], [2100, 2], [2023, 2], [2023, 4], [2023, 1], [1700, 2], [2400, 2], [1600, 12], [2023, 11]]; },
});

const ISO_OUT = (Y, M, D) => `String(${Y}) + '-' + String(${M}).padStart(2, '0') + '-' + String(${D}).padStart(2, '0')`;
fam('add-months', {
  kind: 'caller', helper: 'days-in-month', can: { defect: ['DATE_ARITH'], decoy: [] },
  draw(r, ctx, role) {
    const [d, n] = r.pick([['isoDate', 'months'], ['date', 'n'], ['start', 'count']]);
    const roll = r.chance(0.35);
    return { name: ctx.name(['shift{N}Date', '{n}DateAfterMonths', 'add{N}Months', 'next{N}Date']), d, n, roll, nmax: r.pick([24, 120, 600]), w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { DATE_ARITH: roll ? ['no-roll', 'clamp'] : ['no-clamp'] } }) };
  },
  smell: () => null,
  sig: p => [p.d, p.n],
  doc: p => {
    const { d, n, helper } = p;
    const rule = p.roll ? `A day past the end of the target month rolls over into the next month (31 January plus one month is 3 March in a common year; month lengths from ${helper}).`
      : `A day that does not exist in the target month becomes that month's last day (${helper}).`;
    return { lines: [[`The date ${n} calendar months after ${d} (YYYY-MM-DD; ${n} may be negative). ${rule}`, `Adds ${n} months (negative to go back) to the date ${d}, YYYY-MM-DD. ${rule}`,
      `Shifts ${d} (YYYY-MM-DD) by ${n} calendar months, in either direction. ${rule}`][p.w[0]]], params: ['a date, YYYY-MM-DD', `months to add, -${p.nmax} to ${p.nmax}`], returns: 'string' };
  },
  domain: p => ({ params: [{ t: 'iso' }, { t: 'int', min: -p.nmax, max: p.nmax }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, H = p.helper;
    const head = `const [y, m, d] = ${p.d}.split('-').map(Number);`;
    const ym = p.style ? [`const total = y * 12 + m - 1 + ${p.n};`, 'const year = Math.floor(total / 12);', 'const month = (total % 12) + 1;']
      : [`const index = y * 12 + (m - 1) + ${p.n};`, 'const year = Math.floor(index / 12);', 'const month = index - year * 12 + 1;'];
    const roll = p.roll ? vr !== 'clamp' && vr !== 'no-roll' : vr === 'roll';
    if (vr === 'no-clamp' || vr === 'no-roll') return J(head, ym, `return ${ISO_OUT('year', 'month', 'd')};`);
    if (!roll) return J(head, ym, `const day = Math.min(d, ${H}(year, month));`, `return ${ISO_OUT('year', 'month', 'day')};`);
    return J(head, ym, `const last = ${H}(year, month);`, `if (d <= last) return ${ISO_OUT('year', 'month', 'd')};`, 'const next = year * 12 + month;', 'const ny = Math.floor(next / 12);',
      'const nm = next - ny * 12 + 1;', `return ${ISO_OUT('ny', 'nm', 'd - last')};`);
  },
  probes() { return [['2023-01-31', 1], ['2024-01-31', 1], ['1900-01-29', 1], ['2100-03-31', -1], ['2000-01-30', 1], ['2023-05-15', -7], ['1800-02-28', 12], ['2023-12-31', 2], ['1700-01-31', 1], ['2023-03-31', -13], ['2000-03-31', -1], ['2400-01-30', 1]]; },
});

fam('month-end', {
  kind: 'caller', helper: 'days-in-month', can: { defect: [], decoy: [] },
  draw(r, ctx) {
    const which = r.pick(['same', 'same', 'previous', 'next']);
    const names = { same: ['{n}MonthEnd', 'endOf{N}Month', 'last{N}Day', '{n}PeriodEnd'], previous: ['previous{N}MonthEnd', 'prior{N}PeriodEnd', '{n}LastMonthEnd'], next: ['next{N}MonthEnd', 'following{N}PeriodEnd', '{n}NextMonthEnd'] }[which];
    return { name: ctx.name(names), which, d: r.pick(['isoDate', 'date', 'day']), w: words(r, ctx, [3]), style: r.int(0, 1), variant: null };
  },
  smell: () => null,
  sig: p => [p.d],
  doc: p => {
    const { d, helper } = p, mo = { same: `the month of ${d}`, previous: `the month before the month of ${d}`, next: `the month after the month of ${d}` }[p.which];
    return { lines: [[`The last day of ${mo}, as YYYY-MM-DD (${helper}).`, `Last calendar day of ${mo}, written YYYY-MM-DD (month lengths from ${helper}).`,
      `Date of the final day of ${mo}, YYYY-MM-DD (${helper}).`][p.w[0]]], params: ['a date, YYYY-MM-DD'], returns: 'string' };
  },
  domain: () => ({ params: [{ t: 'iso' }] }),
  body(p) {
    const H = p.helper, ym = p.style ? [`const y = Number(${p.d}.slice(0, 4));`, `const m = Number(${p.d}.slice(5, 7));`] : [`const [y, m] = ${p.d}.split('-').map(Number);`];
    if (p.which === 'same') return J(ym, `return ${p.d}.slice(0, 8) + String(${H}(y, m)).padStart(2, '0');`);
    return J(ym, `const index = y * 12 + m - 1 ${p.which === 'previous' ? '- 1' : '+ 1'};`, 'const year = Math.floor(index / 12);', 'const month = index - year * 12 + 1;',
      `return ${ISO_OUT('year', 'month', `${H}(year, month)`)};`);
  },
  probes() { return [['1900-02-10'], ['2000-02-03'], ['2024-02-29'], ['2023-04-01'], ['2100-02-14'], ['2023-12-25'], ['1800-02-01'], ['1900-03-10'], ['2000-03-03'], ['2100-03-14'], ['1900-01-10'], ['2000-01-20'], ['2100-01-05'], ['2400-03-01'], ['2400-01-31']]; },
});

fam('is-valid-date', {
  can: { defect: ['DATE_ARITH'], decoy: ['DATE_ARITH'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['isValid{N}Date', 'is{N}DateValid', 'valid{N}Date', 'check{N}Date']), t: r.pick(['text', 'value', 'input']), dmy: r.chance(0.35),
      yr: r.pick([[1600, 2400], [1600, 2400], [1900, 2100]]), w: words(r, ctx, [3]),
      variant: pickVariant(r, role, { defect: { DATE_ARITH: ['any-31', 'leap4'] }, decoy: { DATE_ARITH: ['date-utc'] } }) };
  },
  smell: p => (p.variant === 'date-utc' ? 'DATE_ARITH' : null),
  sig: p => [p.t],
  doc: p => {
    const f = p.dmy ? 'DD/MM/YYYY' : 'YYYY-MM-DD', [y0, y1] = p.yr, { t } = p;
    return { lines: [[`True when ${t} is a real Gregorian date written ${f} with a year from ${y0} to ${y1}.`, `Whether ${t} is a valid ${f} date in the Gregorian calendar, year ${y0} to ${y1}.`,
      `Checks that ${t} names a day that exists in the Gregorian calendar, in the form ${f}, years ${y0}-${y1}.`][p.w[0]]], params: ['any string'], returns: 'boolean' };
  },
  domain: () => ({ params: [{ t: 'str', max: 20 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, [y0, y1] = p.yr;
    const head = p.dmy ? [`const m = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(${p.t});`, 'if (!m) return false;', 'const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);']
      : [`const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(${p.t});`, 'if (!m) return false;', 'const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);'];
    head.push(`if (y < ${y0} || y > ${y1} || mo < 1 || mo > 12 || d < 1) return false;`);
    if (vr === 'any-31') return J(head, 'return d <= 31;');
    if (vr === 'date-utc') return J(head, 'const t = new Date(Date.UTC(y, mo - 1, d));', 'return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;');
    return J(head, `const leap = ${vr === 'leap4' ? 'y % 4 === 0' : LEAP('y')};`, 'const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];', 'return d <= lengths[mo - 1];');
  },
  probes(p) {
    const [y0, y1] = p.yr, pad = (x, n) => String(x).padStart(n, '0');
    const fmt = (y, m, d) => (p.dmy ? `${pad(d, 2)}/${pad(m, 2)}/${pad(y, 4)}` : `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`);
    const dates = [[2023, 2, 29], [2024, 2, 29], [1900, 2, 29], [2000, 2, 29], [2023, 4, 31], [2023, 4, 30], [2023, 13, 1], [y0 - 1, 1, 1], [y1 + 1, 1, 1], [2100, 2, 29], [2023, 6, 31], [2023, 2, 28], [2023, 1, 32]];
    return [...dates.map(x => fmt(...x)), 'abc', p.dmy ? '1/02/2023' : '2023-1-01', p.dmy ? '2023-02-01' : '01/02/2023'].map(s => [s]);
  },
});

// ======================================================================================================= ESCAPING hosts
fam('csv-field', {
  can: { defect: ['ESCAPING'], decoy: ['ESCAPING'] },
  draw(r, ctx, role) {
    const always = r.chance(0.3);
    return { name: ctx.name(['csv{N}', 'quote{N}ForCsv', '{n}CsvCell', 'toCsv{N}']), v: r.pick(['value', 'text', 'cell']), semi: r.chance(0.3), always, w: words(r, ctx, [3]), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { ESCAPING: always ? ['first-only'] : ['first-only', 'no-newline'] }, decoy: { ESCAPING: ['split-join'] } }) };
  },
  smell: p => ({ 'first-only': 'ESCAPING', 'split-join': 'ESCAPING' }[p.variant] ?? null),
  sig: p => [p.v],
  doc: p => {
    const { v } = p, sep = p.semi ? 'a semicolon (the field separator)' : 'a comma';
    const T = p.always ? [`${v} as one CSV field (RFC 4180): always wrapped in double quotes, with every double quote inside doubled.`, `Quoted CSV field for ${v}: double quotes around it in every case, each inner double quote doubled (RFC 4180).`,
      `${cap(v)} as an always-quoted CSV field: "..." around it and every " inside written as "" (RFC 4180).`]
      : [`${v} as one CSV field (RFC 4180): wrapped in double quotes when it contains ${sep}, a double quote, a carriage return or a line feed, with every double quote inside doubled; returned unchanged otherwise.`,
        `CSV field for ${v} (RFC 4180): quoted only when it holds ${sep}, a double quote, CR or LF, and then every inner double quote is doubled; otherwise ${v} as it is.`,
        `${cap(v)} written as a CSV cell (RFC 4180): if it contains ${sep}, ", CR or LF it is wrapped in double quotes with each " doubled; else unchanged.`];
    return { lines: [T[p.w[0]]], params: ['any string'], returns: 'string' };
  },
  domain: () => ({ params: [{ t: 'str', max: 80 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, x = p.v, d = p.semi ? ';' : ',';
    const inner = vr === 'first-only' ? `${x}.replace('"', '""')` : vr === 'split-join' ? `${x}.split('"').join('""')` : p.style ? `${x}.replaceAll('"', '""')` : `${x}.replace(/"/g, '""')`;
    if (p.always) return `return '"' + ${inner} + '"';`;
    const re = vr === 'no-newline' ? `/["${d}]/` : `/["${d}\\r\\n]/`;
    if (p.style === 1) return J(`const needsQuotes = ${re}.test(${x});`, `return needsQuotes ? '"' + ${inner} + '"' : ${x};`);
    return J(`if (${re}.test(${x})) return '"' + ${inner} + '"';`, `return ${x};`);
  },
  probes() { return ['plain', 'a,b', 'a;b', 'say "hi"', '"a" and "b"', 'line1\nline2', 'x\ry', '', 'no "end', '""', 'a,"b",c', 'a;"b";c'].map(s => [s]); },
});

fam('html-text', {
  can: { defect: ['ESCAPING'], decoy: [] },
  draw(r, ctx, role) {
    return { name: ctx.name(['escape{N}Html', '{n}AsHtml', 'html{N}', 'safe{N}Html']), t: r.pick(['text', 's', 'raw']), apos: r.pick(['&#39;', '&#39;', '&#x27;', '&apos;']), quot: r.pick(['&quot;', '&quot;', '&#34;']),
      w: words(r, ctx, [3]), style: r.int(0, 1), variant: pickVariant(r, role, { defect: { ESCAPING: ['amp-last', 'no-apos'] } }) };
  },
  smell: () => null,
  sig: p => [p.t],
  doc: p => {
    const { t, quot: Q, apos: A } = p;
    return { lines: [[`${t} with &, <, >, " and ' replaced by &amp;, &lt;, &gt;, ${Q} and ${A}; each character is escaped exactly once.`,
      `HTML-escapes ${t}: & becomes &amp;, < &lt;, > &gt;, " ${Q} and ' ${A}, each exactly once.`,
      `${cap(t)} made safe for HTML text: &amp; for &, &lt; for <, &gt; for >, ${Q} for " and ${A} for '; nothing is escaped twice.`][p.w[0]]], params: ['any string'], returns: 'string' };
  },
  domain: () => ({ params: [{ t: 'str', max: 80 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null;
    const reps = { amp: ".replace(/&/g, '&amp;')", lt: ".replace(/</g, '&lt;')", gt: ".replace(/>/g, '&gt;')", quot: `.replace(/"/g, '${p.quot}')`, apos: `.replace(/'/g, '${p.apos}')` };
    if (p.style === 1 && vr !== 'amp-last') {
      const noApos = vr === 'no-apos';
      return J(`const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '${p.quot}'${noApos ? '' : `, "'": '${p.apos}'`} };`, `return ${p.t}.replace(/[&<>"${noApos ? '' : "'"}]/g, c => map[c]);`);
    }
    const order = vr === 'amp-last' ? ['lt', 'gt', 'quot', 'apos', 'amp'] : vr === 'no-apos' ? ['amp', 'lt', 'gt', 'quot'] : ['amp', 'lt', 'gt', 'quot', 'apos'];
    return J(`return ${p.t}`, order.map((k, i) => `  ${reps[k]}${i === order.length - 1 ? ';' : ''}`));
  },
  probes() { return ['plain', '<b>', 'a & b', "it's", 'say "x"', '&lt;', '', '<a href="x">\'q\'</a>'].map(s => [s]); },
});

fam('like-pattern', {
  can: { defect: ['ESCAPING'], decoy: ['ESCAPING'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}LikePattern', 'like{N}', '{n}SearchPattern', 'contains{N}Pattern']), q: r.pick(['term', 'query', 'needle']), match: r.pick(['any', 'any', 'prefix', 'suffix']),
      bang: r.chance(0.3), w: words(r, ctx, [3]), variant: pickVariant(r, role, { defect: { ESCAPING: ['no-escape-char'] }, decoy: { ESCAPING: ['chained'] } }) };
  },
  smell: p => (p.variant === 'chained' ? 'ESCAPING' : null),
  sig: p => [p.q],
  doc: p => {
    const { q } = p, E = p.bang ? '!' : 'backslash';
    const shape = { any: `matches ${q} anywhere: '%' + ${q} + '%'`, prefix: `matches values that start with ${q}: ${q} + '%'`, suffix: `matches values that end with ${q}: '%' + ${q}` }[p.match];
    const esc = p.bang ? `every %, _ and ! in ${q} escaped by a ! (the pattern's escape character, ESCAPE '!')` : `every %, _ and backslash in ${q} escaped by a backslash (the pattern's escape character)`;
    return { lines: [[`A SQL LIKE pattern that ${shape}, with ${esc}.`, `LIKE pattern for ${q} that ${shape}; ${esc}.`, `Builds a SQL LIKE pattern from ${q} (escape character ${E}): it ${shape}, with ${esc}.`][p.w[0]]],
      params: ['the search text'], returns: 'string' };
  },
  domain: () => ({ params: [{ t: 'str', max: 60 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { q } = p;
    const wrap = x => ({ any: `'%' + ${x} + '%'`, prefix: `${x} + '%'`, suffix: `'%' + ${x}` }[p.match]);
    if (vr === 'chained') {
      const esc = p.bang ? `${q}.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')` : `${q}.replace(/\\\\/g, '\\\\\\\\').replace(/%/g, '\\\\%').replace(/_/g, '\\\\_')`;
      return J(`const escaped = ${esc};`, `return ${wrap('escaped')};`);
    }
    const skip = vr === 'no-escape-char';
    const cls = p.bang ? `${skip ? '' : '!'}%_` : `${skip ? '' : '\\\\'}%_`;
    return `return ${wrap(`${q}.replace(/[${cls}]/g, '${p.bang ? '!' : '\\\\'}$&')`)};`;
  },
  probes() { return ['abc', '50%', 'a_b', 'c:\\temp', '\\%', '', '100% _off_', 'hi!', '!%'].map(s => [s]); },
});

// ================================================================================================ SWALLOWED_ERROR hosts
fam('parse-amount', {
  can: { defect: ['SWALLOWED_ERROR'], decoy: ['SWALLOWED_ERROR'] },
  accept: { 'blank-zero': ['SWALLOWED_ERROR', 'MISSING_GUARD'] }, // a blank input mapped to 0 instead of the stated error
  draw(r, ctx, role) {
    const mode = role.kind === 'decoy' ? 'null' : role.kind === 'defect' ? 'throw' : (r.chance(0.35) ? 'null' : 'throw');
    return { name: ctx.name(mode === 'null' ? ['tryParse{N}Amount', 'maybe{N}Amount', 'parse{N}AmountOrNull'] : ['parse{N}Amount', 'read{N}Amount', '{n}AmountFromText', 'to{N}Minor']),
      mode, eu: r.chance(0.3), t: r.pick(['text', 'input', 'raw']), w: words(r, ctx, [3]),
      variant: pickVariant(r, role, { defect: { SWALLOWED_ERROR: ['catch-zero', 'wrong-type', 'blank-zero'] }, decoy: { SWALLOWED_ERROR: ['catch-null'] } }) };
  },
  smell: p => ({ 'catch-zero': 'SWALLOWED_ERROR', 'catch-null': 'SWALLOWED_ERROR' }[p.variant] ?? null),
  sig: p => [p.t],
  doc: p => {
    const { t } = p, ex = p.eu ? "'1.234,50', '-12' or '7,05'" : "'1,234.50', '-12' or '7.05'", th = p.eu ? 'dots' : 'commas', dec = p.eu ? 'a comma' : 'a dot';
    const fail = p.mode === 'null' ? 'Returns null' : 'Throws RangeError', failLc = p.mode === 'null' ? 'returns null' : 'throws RangeError';
    return { lines: [[`Parses an amount such as ${ex} into minor units: thousands separated by ${th}, no decimals or exactly two after ${dec}, surrounding whitespace ignored. ${fail} when ${t} is not such an amount.`,
      `Minor units for the amount text ${t} (examples: ${ex}): an optional minus, ${th} between thousands, either no decimals or two after ${dec}, whitespace around it ignored; ${failLc} for any other text.`,
      `Reads ${t}, an amount like ${ex}, as minor units (${th} group the thousands; no decimals or exactly two after ${dec}; outer whitespace ignored). ${fail} when ${t} is not such an amount.`][p.w[0]]],
    params: ['the text to parse'], returns: p.mode === 'null' ? 'number|null' : 'number' };
  },
  domain: () => ({ params: [{ t: 'str', max: 40 }] }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { t } = p;
    const fail = p.mode === 'null' && vr !== 'catch-null' ? 'return null;' : `throw new ${vr === 'wrong-type' ? 'Error' : 'RangeError'}('not an amount: ' + ${t});`;
    const re = p.eu ? '/^(-?)(\\d{1,3}(?:\\.\\d{3})*|\\d+)(?:,(\\d{2}))?$/' : '/^(-?)(\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.(\\d{2}))?$/';
    const core = [`const m = ${re}.exec(${t}.trim());`, `if (!m) ${fail}`, `const units = Number(m[2].replace(${p.eu ? '/\\./g' : '/,/g'}, ''));`, 'const cents = m[3] === undefined ? 0 : Number(m[3]);',
      "return (m[1] === '-' ? -1 : 1) * (units * 100 + cents);"];
    if (vr === 'catch-zero' || vr === 'catch-null') return J('try {', core.map(l => `  ${l}`), '} catch (err) {', `  return ${vr === 'catch-zero' ? '0' : 'null'};`, '}');
    if (vr === 'blank-zero') return J(`if (${t}.trim() === '') return 0;`, core);
    return J(core);
  },
  probes(p) {
    const xs = p.eu ? ['1.234,50', '-12', '7,05', '12,5', 'abc', '', '1.23', ' 42 ', '-0,99', '1234.567', '1.234.567,00', '   ', '1,234.50']
      : ['1,234.50', '-12', '7.05', '12.5', 'abc', '', '1,23', ' 42 ', '-0.99', '1234,567', '1,234,567.00', '   ', '1.234,50'];
    return xs.map(s => [s]);
  },
});

const isObjectJson = s => { try { const v = JSON.parse(s); return v !== null && typeof v === 'object' && !Array.isArray(v); } catch { return true; } };
fam('read-settings', {
  can: { defect: ['SWALLOWED_ERROR'], decoy: ['SWALLOWED_ERROR'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['read{N}Settings', 'parse{N}Config', 'load{N}Settings', '{n}Settings']), j: r.pick(['json', 'text', 'source']), defaults: drawDefaults(r), known: r.chance(0.35),
      w: words(r, ctx, [3]), variant: pickVariant(r, role, { defect: { SWALLOWED_ERROR: ['catch-defaults', 'empty-as-object'] }, decoy: { SWALLOWED_ERROR: ['rethrow'] } }) };
  },
  smell: p => ({ 'catch-defaults': 'SWALLOWED_ERROR', rethrow: 'SWALLOWED_ERROR' }[p.variant] ?? null),
  sig: p => [p.j],
  doc: p => {
    const { j } = p, dt = defaultsText(p.defaults), kn = p.known ? '; keys without a default are ignored' : '';
    return { lines: [[`Settings parsed from the JSON text ${j} (an object), with the defaults (${dt}) for keys it does not set${kn}; throws SyntaxError when ${j} is not valid JSON.`,
      `Reads the settings object in the JSON text ${j}: the defaults (${dt}) fill the keys it leaves out${kn}. Text that is not valid JSON throws SyntaxError.`,
      `Settings from ${j}, JSON text of an object, merged over the defaults (${dt})${kn}; invalid JSON throws SyntaxError.`][p.w[0]]], params: ['JSON text of an object'], returns: 'Object' };
  },
  domain: () => ({ params: [{ t: 'str', max: 200 }], where: a => isObjectJson(a[0]) }),
  body(p, which) {
    const vr = which === 'planted' ? p.variant : null, { j } = p, lit = `const defaults = ${defaultsLit(p.defaults)};`;
    const merge = p.known ? ['const out = { ...defaults };', 'for (const key of Object.keys(defaults)) if (Object.hasOwn(parsed, key)) out[key] = parsed[key];', 'return out;'] : ['return { ...defaults, ...parsed };'];
    if (vr === 'catch-defaults') return J(lit, 'let parsed;', 'try {', `  parsed = JSON.parse(${j});`, '} catch (err) {', '  parsed = {};', '}', merge);
    if (vr === 'rethrow') return J(lit, 'let parsed;', 'try {', `  parsed = JSON.parse(${j});`, '} catch (err) {', "  throw new SyntaxError('settings: ' + err.message);", '}', merge);
    return J(lit, `const parsed = JSON.parse(${vr === 'empty-as-object' ? `${j} || '{}'` : j});`, merge);
  },
  probes() { return ['{}', '{"pageSize": 10}', 'not json', '', '{"a":1', '{"locale":"fr-FR","extra":true}', '   ', '{"retries": 9, "note": "x"}'].map(s => [s]); },
});

// ======================================================================================================= fillers (clean)
const filler = (id, names, draw, def) => fam(id, { draw(r, ctx) { return { name: ctx.name(names), variant: null, ...draw(r) }; }, smell: () => null, ...def });
filler('slugify', ['slugify{N}', '{n}Slug', 'slugFor{N}'], r => ({ t: r.pick(['text', 'title']) }), {
  sig: p => [p.t], doc: p => ({ lines: [`Lower-case slug of ${p.t}: every run of characters other than a-z and 0-9 becomes one hyphen; no hyphen at either end.`], params: ['any string'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 80 }] }), body: p => `return ${p.t}.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');`,
  probes: () => [['Hello World'], ['  Q3 -- Report! '], ['']] });
filler('group-by', ['group{N}s', '{n}sByKey', 'bucket{N}s'], r => ({ items: r.pick(['items', 'rows']), f: r.pick(['status', 'currency', 'region']) }), {
  sig: p => [p.items], doc: p => ({ lines: [`${p.items} grouped by ${p.f}: an object from each ${p.f} value to the elements with that value, in order.`], params: [`objects with id and ${p.f}`], returns: 'Object' }),
  domain: p => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, [p.f]: { t: 'enum', values: ['a', 'b', 'c', 'EUR', 'USD', 'north', 'south'] } } }, max: 30 }] }),
  body: p => J('const out = {};', `for (const it of ${p.items}) {`, `  const key = it.${p.f};`, '  if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = [];', '  out[key].push(it);', '}', 'return out;'),
  probes: p => [[[]], [[{ id: 1, [p.f]: 'a' }, { id: 2, [p.f]: 'b' }, { id: 3, [p.f]: 'a' }]]] });
filler('unique-ids', ['unique{N}s', 'dedupe{N}s', 'distinct{N}s'], r => ({ items: r.pick(['items', 'records']) }), {
  sig: p => [p.items], doc: p => ({ lines: [`The elements of ${p.items} with only the first occurrence of each id kept, in order.`], params: ['objects with id'], returns: 'Array' }),
  domain: () => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT } }, max: 30 }] }),
  body: p => J('const seen = new Set();', 'const out = [];', `for (const it of ${p.items}) {`, '  if (seen.has(it.id)) continue;', '  seen.add(it.id);', '  out.push(it);', '}', 'return out;'),
  probes: () => [[[]], [[{ id: 1 }, { id: 2 }, { id: 1 }]]] });
filler('sum-field', ['sum{N}s', '{n}Sum', 'total{N}'], r => ({ items: r.pick(['items', 'rows']), f: r.pick(['amountMinor', 'qty', 'weight']) }), {
  sig: p => [p.items], doc: p => ({ lines: [`Sum of ${p.f} over ${p.items}; 0 for an empty array.`], params: [`objects with ${p.f}`], returns: 'number' }),
  domain: p => ({ params: [{ t: 'arr', of: { t: 'obj', props: { [p.f]: INT } }, max: 40 }] }),
  body: p => `return ${p.items}.reduce((t, it) => t + it.${p.f}, 0);`, probes: p => [[[]], [[{ [p.f]: 3 }, { [p.f]: -1 }]]] });
filler('format-ref', ['format{N}Ref', '{n}Reference', '{n}Number'], r => ({ pre: 'prefix', n: r.pick(['n', 'seq']), w: 'width' }), {
  sig: p => [p.pre, p.n, p.w], doc: p => ({ lines: [`${p.pre}, a hyphen and ${p.n} padded with zeros to ${p.w} digits ('INV', 42, 5 gives 'INV-00042'); ${p.n} keeps all its digits when it has more.`], params: ['letters', 'a whole number', 'digits, 1-12'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 10 }, { t: 'int', min: 0, max: 1e9 }, { t: 'int', min: 1, max: 12 }] }),
  body: p => `return ${p.pre} + '-' + String(${p.n}).padStart(${p.w}, '0');`, probes: () => [['INV', 42, 5], ['CN', 123456, 3]] });
filler('normalize-spaces', ['normalize{N}Spaces', 'tidy{N}', 'squash{N}Spaces'], r => ({ t: r.pick(['text', 'line']) }), {
  sig: p => [p.t], doc: p => ({ lines: [`${p.t} with every run of whitespace replaced by one space and no space at either end.`], params: ['any string'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 80 }] }), body: p => `return ${p.t}.replace(/\\s+/g, ' ').trim();`, probes: () => [[' a  b\tc '], ['']] });
filler('compare-by-date', ['compare{N}sByDate', 'by{N}Date', '{n}DateOrder'], () => ({}), {
  sig: () => ['a', 'b'], doc: () => ({ lines: ['Comparator for sort(): negative when a.date (YYYY-MM-DD) is earlier than b.date, positive when later, 0 when equal.'], params: ['an object with date', 'an object with date'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'obj', props: { date: { t: 'iso' } } }, { t: 'obj', props: { date: { t: 'iso' } } }] }),
  body: () => 'return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;', probes: () => [[{ date: '2024-01-02' }, { date: '2024-01-10' }], [{ date: '2024-03-01' }, { date: '2024-03-01' }]] });
filler('count-by', ['count{N}sByStatus', '{n}StatusCounts', 'tally{N}s'], r => ({ items: r.pick(['items', 'records']) }), {
  sig: p => [p.items], doc: p => ({ lines: [`How many elements of ${p.items} have each status: an object from status to count.`], params: ['objects with status'], returns: 'Object' }),
  domain: () => ({ params: [{ t: 'arr', of: { t: 'obj', props: { status: { t: 'enum', values: STATUS_WORDS.concat(['open', 'paid']) } } }, max: 40 }] }),
  body: p => J('const counts = {};', `for (const it of ${p.items}) counts[it.status] = (counts[it.status] ?? 0) + 1;`, 'return counts;'),
  probes: () => [[[]], [[{ status: 'open' }, { status: 'paid' }, { status: 'open' }]]] });
filler('clamp', ['clamp{N}', 'bound{N}', 'limit{N}'], r => { const [v, lo, hi] = r.pick([['value', 'lo', 'hi'], ['x', 'min', 'max']]); return { v, lo, hi }; }, {
  sig: p => [p.v, p.lo, p.hi], doc: p => ({ lines: [`${p.v} limited to the range ${p.lo}..${p.hi} (${p.lo} not above ${p.hi}).`], params: ['a number', 'lower limit', 'upper limit'], returns: 'number' }),
  domain: () => ({ params: [INT, INT, INT], where: a => a[1] <= a[2] }), body: p => `return Math.min(${p.hi}, Math.max(${p.lo}, ${p.v}));`, probes: () => [[5, 0, 10], [-3, 0, 10], [12, 0, 10]] });
filler('initials', ['{n}Initials', 'initials{N}', 'monogram{N}'], r => ({ t: r.pick(['name', 'fullName']) }), {
  sig: p => [p.t], doc: p => ({ lines: [`Upper-case first characters of the words of ${p.t} (words are separated by whitespace; docs/CONVENTIONS.md §9 says what a character is).`], params: ['a name'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 60 }] }), body: p => `return ${p.t}.split(/\\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('');`, probes: () => [['ada lovell'], ['  Bo  Chan ']] });
filler('mask-account', ['mask{N}Number', 'masked{N}', 'hide{N}Digits'], r => ({ t: r.pick(['accountNo', 'iban', 'cardNo']) }), {
  sig: p => [p.t], doc: p => ({ lines: [`${p.t} with every character but the last four replaced by *; unchanged when it has four characters or fewer.`], params: ['an account number'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 40 }] }), body: p => `return ${p.t}.length <= 4 ? ${p.t} : '*'.repeat(${p.t}.length - 4) + ${p.t}.slice(-4);`, probes: () => [['GB29NWBK60161331926819'], ['1234']] });
filler('is-blank', ['is{N}Blank', 'blank{N}', 'isEmpty{N}Text'], r => ({ t: r.pick(['text', 'value']) }), {
  sig: p => [p.t], doc: p => ({ lines: [`True when ${p.t} is empty or only whitespace.`], params: ['any string'], returns: 'boolean' }),
  domain: () => ({ params: [{ t: 'str', max: 80 }] }), body: p => `return ${p.t}.trim() === '';`, probes: () => [[''], ['  '], ['x']] });

/** Families that can host a defect / a decoy of `cls`. */
export const hostsOf = (role, cls) => Object.values(FAMILIES).filter(f => f.can[role].includes(cls));
/** Classes the oracle accepts for a planted defect: its class first, then any class the family accepts for its variant. */
export const acceptedClasses = (familyId, variant, cls) => [cls, ...(FAMILIES[familyId].accept[variant] ?? []).filter(c => c !== cls)];
