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
//
// Kinds: 'fn' (self-contained), 'helper' (src/lib, called by callers), 'caller' (calls `p.helper`, the helper's name).
// A family's `can.defect` / `can.decoy` list the classes it can host. Fillers host nothing.

const J = (...ls) => ls.flat().join('\n');
const cap = s => s[0].toUpperCase() + s.slice(1);
const INT = { t: 'int', min: -1e6, max: 1e6 };
const range = n => Array.from({ length: n }, (_, i) => i);
const ints = (r, n, lo = -500, hi = 500) => Array.from({ length: n }, () => r.int(lo, hi));
const pickVariant = (r, role, table) => (role.kind === 'clean' ? null : r.pick(table[role.kind][role.cls]));
const STATUS_WORDS = ['void', 'draft', 'cancelled', 'held', 'archived', 'reversed'];
const DEFAULT_POOL = [['currency', "'EUR'"], ['currency', "'GBP'"], ['pageSize', '50'], ['pageSize', '25'], ['locale', "'en-GB'"], ['locale', "'de-DE'"],
  ['retries', '3'], ['retries', '5'], ['timeoutMs', '5000'], ['timeoutMs', '8000'], ['roundTo', '2']];
function drawDefaults(r) {
  const out = [];
  for (const [k, v] of r.shuffle(DEFAULT_POOL)) if (!out.some(x => x[0] === k) && out.length < r.int(2, 3)) out.push([k, v]);
  return out;
}
const defaultsLit = ds => `{ ${ds.map(([k, v]) => `${k}: ${v}`).join(', ')} }`;
const defaultsText = ds => ds.map(([k, v]) => `${k} ${v}`).join(', ');

export const FAMILIES = {};
const fam = (id, def) => { FAMILIES[id] = { id, kind: 'fn', can: { defect: [], decoy: [] }, ...def }; };

// ===================================================================================================== OFF_BY_ONE hosts
fam('range-check', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    const conv = r.chance(0.4) ? 'house' : r.pick(['incl', 'excl']);
    const incl = conv === 'house' ? ctx.house.band === 'incl' : conv === 'incl';
    const [v, lo, hi] = r.pick([['value', 'lo', 'hi'], ['amount', 'min', 'max'], ['n', 'low', 'high'], ['x', 'start', 'end']]);
    return { name: ctx.name(['is{N}InBand', 'is{N}Within', '{n}InRange', 'within{N}Band', 'is{N}InWindow']), conv, incl, v, lo, hi,
      style: r.int(0, 1), variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['swap'] }, decoy: { OFF_BY_ONE: ['plus'] } }) };
  },
  smell: p => (p.variant === 'plus' ? 'OFF_BY_ONE' : null),
  sig: p => [p.v, p.lo, p.hi],
  doc: p => ({ lines: [`True when ${p.v} lies in the band from ${p.lo} to ${p.hi}${p.conv === 'house' ? ' (bands: docs/CONVENTIONS.md §3)' : p.incl ? ', both ends included' : `, ${p.lo} included and ${p.hi} excluded`}.`],
    params: ['the integer to test', 'lower end of the band', `upper end of the band, not below ${p.lo}`], returns: 'boolean' }),
  domain: () => ({ params: [INT, INT, INT], where: a => a[1] <= a[2] }),
  body(p, which) {
    if (which === 'planted' && p.variant === 'plus') return p.incl ? `return ${p.v} >= ${p.lo} && ${p.v} < ${p.hi} + 1;` : `return ${p.v} >= ${p.lo} && ${p.v} <= ${p.hi} - 1;`;
    const incl = which === 'planted' && p.variant === 'swap' ? !p.incl : p.incl;
    const op = incl ? '<=' : '<';
    return p.style ? J(`if (${p.v} < ${p.lo}) return false;`, `return ${p.v} ${op} ${p.hi};`) : `return ${p.v} >= ${p.lo} && ${p.v} ${op} ${p.hi};`;
  },
  probes(p, r) { const out = []; for (let k = 0; k < 3; k++) { const lo = r.int(-50, 50), hi = lo + r.int(1, 30); for (const v of [lo - 1, lo, lo + 1, hi - 1, hi, hi + 1]) out.push([v, lo, hi]); } return out; },
});

fam('page-slice', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    const conv = r.chance(0.5) ? 'house' : r.pick([0, 1]);
    const base = conv === 'house' ? ctx.house.pageBase : conv;
    const [items, page, size] = r.pick([['items', 'page', 'size'], ['rows', 'pageNo', 'perPage'], ['list', 'page', 'pageSize']]);
    return { name: ctx.name(['{n}Page', 'page{N}s', 'slice{N}Page', '{n}sOnPage']), conv, base, items, page, size, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['base', 'short'] }, decoy: { OFF_BY_ONE: ['decoy'] } }) };
  },
  smell: p => ({ short: 'OFF_BY_ONE', decoy: 'OFF_BY_ONE' }[p.variant] ?? null),
  sig: p => [p.items, p.page, p.size],
  doc: p => ({ lines: [`The items on page ${p.page} when ${p.items} is cut into pages of ${p.size} items (${p.conv === 'house' ? 'page numbering: docs/CONVENTIONS.md §4' : `pages are numbered from ${p.base}`}); an empty array past the last page.`],
    params: ['the items, in order', 'the page number', 'items per page'], returns: 'Array' }),
  domain: p => ({ params: [{ t: 'arr', of: INT, max: 60 }, { t: 'int', min: p.base, max: p.base + 20 }, { t: 'int', min: 1, max: 10 }] }),
  body(p, which) {
    const { items, page, size } = p;
    const v = which === 'planted' ? p.variant : null;
    if (v === 'decoy') return p.base === 1 ? `return ${items}.slice(${page} * ${size} - ${size}, ${page} * ${size});` : J(`const end = (${page} + 1) * ${size};`, `return ${items}.slice(end - ${size}, end);`);
    const base = v === 'base' ? 1 - p.base : p.base;
    const start = base === 1 ? `(${page} - 1) * ${size}` : `${page} * ${size}`;
    if (p.style === 0 || v === 'short') return J(`const start = ${start};`, `return ${items}.slice(start, start + ${size}${v === 'short' ? ' - 1' : ''});`);
    return base === 1 ? `return ${items}.slice((${page} - 1) * ${size}, ${page} * ${size});` : `return ${items}.slice(${page} * ${size}, (${page} + 1) * ${size});`;
  },
  probes(p, r) {
    const out = [];
    for (const n of [0, 3, 12, 25]) for (const size of [1, 3, 5]) for (const k of [0, 1, 2]) out.push([range(n).map(i => i * 10 + r.int(0, 9)), p.base + k, size]);
    return r.shuffle(out).slice(0, 14).concat([[range(12), p.base, 5], [range(12), p.base + 1, 5], [range(12), p.base + 2, 5]]);
  },
});

fam('day-count', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    const [a, b] = r.pick([['fromDay', 'toDay'], ['startDay', 'endDay'], ['firstDay', 'lastDay']]);
    const incl = r.chance(0.5);
    return { name: ctx.name(incl ? ['{n}Days', 'count{N}Days', 'days{N}Spans', '{n}DayCount'] : ['{n}Nights', 'nights{N}', 'count{N}Nights']), incl, a, b,
      style: r.int(0, 1), variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['swap'] }, decoy: { OFF_BY_ONE: ['loop'] } }) };
  },
  smell: p => (p.variant === 'loop' ? 'OFF_BY_ONE' : null),
  sig: p => [p.a, p.b],
  doc: p => ({ lines: [p.incl ? `Number of days from ${p.a} to ${p.b} (day numbers), counting both: day 10 to day 10 is 1 day.`
    : `Number of nights from ${p.a} to ${p.b} (day numbers): ${p.a} counts, ${p.b} does not, so day 10 to day 10 is 0.`],
  params: ['first day number', `last day number, not before ${p.a} and at most 1000 days after it`], returns: 'number' }),
  domain: () => ({ params: [{ t: 'int', min: 0, max: 80000 }, { t: 'int', min: 0, max: 80000 }], where: a => a[1] >= a[0] && a[1] - a[0] <= 1000 }),
  body(p, which) {
    if (which === 'planted' && p.variant === 'loop') return J('let n = 0;', `for (let d = ${p.a}${p.incl ? '' : ' + 1'}; d <= ${p.b}; d++) n++;`, 'return n;');
    const incl = which === 'planted' && p.variant === 'swap' ? !p.incl : p.incl;
    return incl ? (p.style ? `return 1 + ${p.b} - ${p.a};` : `return ${p.b} - ${p.a} + 1;`) : `return ${p.b} - ${p.a};`;
  },
  probes(p, r) { return [0, 1, 2, 7, 30, 365].map(k => { const a = r.int(9000, 12000); return [a, a + k]; }); },
});

fam('pairwise-deltas', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}Deltas', 'deltas{N}', 'step{N}Changes', '{n}Changes']), v: r.pick(['values', 'series', 'points']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['past-end'] }, decoy: { OFF_BY_ONE: ['minus-one'] } }) };
  },
  smell: p => (p.variant ? 'OFF_BY_ONE' : null),
  sig: p => [p.v],
  doc: p => ({ lines: [`Differences between consecutive ${p.v}: result[i] = ${p.v}[i + 1] - ${p.v}[i]. Fewer than two ${p.v} give an empty array.`],
    params: ['integers, in order'], returns: 'number[]' }),
  domain: () => ({ params: [{ t: 'arr', of: INT, max: 50 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    if (v === 'past-end') return J('const out = [];', `for (let i = 0; i < ${p.v}.length; i++) out.push(${p.v}[i + 1] - ${p.v}[i]);`, 'return out;');
    if (v === 'minus-one') return J('const out = [];', `for (let i = 0; i < ${p.v}.length - 1; i++) out.push(${p.v}[i + 1] - ${p.v}[i]);`, 'return out;');
    return p.style ? `return ${p.v}.slice(1).map((x, i) => x - ${p.v}[i]);` : J('const out = [];', `for (let i = 1; i < ${p.v}.length; i++) out.push(${p.v}[i] - ${p.v}[i - 1]);`, 'return out;');
  },
  probes(p, r) { return [0, 1, 2, 3, 6].map(n => [ints(r, n)]); },
});

fam('last-n', {
  can: { defect: ['MISSING_GUARD', 'OFF_BY_ONE'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    const [items, n] = r.pick([['items', 'n'], ['entries', 'count'], ['rows', 'k']]);
    return { name: ctx.name(['last{N}s', 'latest{N}s', 'recent{N}s', 'tail{N}s']), items, n, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['noguard'], OFF_BY_ONE: ['extra'] }, decoy: { MISSING_GUARD: ['or-length'] } }) };
  },
  smell: p => ({ extra: 'OFF_BY_ONE', 'or-length': 'MISSING_GUARD' }[p.variant] ?? null),
  sig: p => [p.items, p.n],
  doc: p => ({ lines: [`The last ${p.n} of ${p.items}, in order: all of them when there are fewer than ${p.n}, none when ${p.n} is 0.`],
    params: ['the items', 'how many to keep, 0 or more'], returns: 'Array' }),
  domain: () => ({ params: [{ t: 'arr', of: INT, max: 50 }, { t: 'int', min: 0, max: 60 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    if (v === 'noguard') return `return ${p.items}.slice(-${p.n});`;
    if (v === 'extra') return `return ${p.items}.slice(Math.max(0, ${p.items}.length - ${p.n} - 1));`;
    if (v === 'or-length') return `return ${p.items}.slice(-${p.n} || ${p.items}.length);`;
    return p.style ? `return ${p.items}.slice(Math.max(0, ${p.items}.length - ${p.n}));` : J(`if (${p.n} === 0) return [];`, `return ${p.items}.slice(-${p.n});`);
  },
  probes(p, r) { const out = []; for (const len of [0, 3, 8]) for (const n of [0, 1, 3, 8, 10]) out.push([ints(r, len), n]); return out; },
});

fam('chunk', {
  can: { defect: ['OFF_BY_ONE'], decoy: ['OFF_BY_ONE'] },
  draw(r, ctx, role) {
    const [items, size] = r.pick([['items', 'size'], ['rows', 'batchSize'], ['list', 'n']]);
    return { name: ctx.name(['chunk{N}s', 'batch{N}s', '{n}Batches', 'split{N}sIntoBatches']), items, size, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['le-length'] }, decoy: { OFF_BY_ONE: ['le-minus-one'] } }) };
  },
  smell: p => (p.variant ? 'OFF_BY_ONE' : null),
  sig: p => [p.items, p.size],
  doc: p => ({ lines: [`Splits ${p.items} into consecutive chunks of ${p.size} items, in order; the last chunk may be shorter. An empty array gives no chunks.`],
    params: ['the items', 'chunk size'], returns: 'Array[]' }),
  domain: () => ({ params: [{ t: 'arr', of: INT, max: 60 }, { t: 'int', min: 1, max: 10 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const cond = v === 'le-length' ? `i <= ${p.items}.length` : v === 'le-minus-one' ? `i <= ${p.items}.length - 1` : `i < ${p.items}.length`;
    if (p.style === 1 && !v) return J('const out = [];', 'let i = 0;', `while (${cond}) {`, `  out.push(${p.items}.slice(i, i + ${p.size}));`, `  i += ${p.size};`, '}', 'return out;');
    return J('const out = [];', `for (let i = 0; ${cond}; i += ${p.size}) out.push(${p.items}.slice(i, i + ${p.size}));`, 'return out;');
  },
  probes(p, r) { const out = []; for (const size of [1, 2, 3, 4]) for (const len of [0, size * 2, size * 2 + 1, 7]) out.push([ints(r, len), size]); return out; },
});

// ==================================================================================================== LOGIC_ERROR hosts
fam('approval-rule', {
  can: { defect: ['LOGIC_ERROR', 'OFF_BY_ONE'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const [role_, amount, limit] = r.pick([['role', 'amountMinor', 'limitMinor'], ['role', 'amount', 'limit'], ['userRole', 'total', 'ceiling']]);
    return { name: ctx.name(['canApprove{N}', 'mayApprove{N}', 'canSign{N}', 'approves{N}']), role: role_, amount, limit,
      sup: r.pick(['admin', 'cfo', 'owner']), app: r.pick(['approver', 'controller', 'signatory', 'manager']), incl: r.chance(0.6), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['or'], OFF_BY_ONE: ['bound'] }, decoy: { LOGIC_ERROR: ['demorgan'] } }) };
  },
  smell: p => (p.variant === 'demorgan' ? 'LOGIC_ERROR' : null),
  sig: p => [p.role, p.amount, p.limit],
  doc: p => ({ lines: [`True when a user with ${p.role} may approve a document of ${p.amount} (minor units): '${p.sup}' always may; '${p.app}' may when ${p.amount} ${p.incl ? 'does not exceed' : 'is below'} ${p.limit}; no other role may.`],
    params: ['the user\'s role name', 'the document amount', 'the approval limit'], returns: 'boolean' }),
  domain: () => ({ params: [{ t: 'str', max: 20 }, { t: 'int', min: 0, max: 1e7 }, { t: 'int', min: 0, max: 1e7 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { role, amount, limit, sup, app } = p;
    if (v === 'demorgan') return `return !(${role} !== '${sup}' && (${role} !== '${app}' || ${amount} ${p.incl ? '>' : '>='} ${limit}));`;
    const op = (v === 'bound' ? !p.incl : p.incl) ? '<=' : '<';
    if (v === 'or') return J(`if (${role} === '${sup}') return true;`, `return ${role} === '${app}' || ${amount} ${op} ${limit};`);
    if (p.style === 1 && !v) return J(`switch (${role}) {`, `  case '${sup}': return true;`, `  case '${app}': return ${amount} ${op} ${limit};`, '  default: return false;', '}');
    return J(`if (${role} === '${sup}') return true;`, `return ${role} === '${app}' && ${amount} ${op} ${limit};`);
  },
  probes(p, r) { const out = []; for (let k = 0; k < 2; k++) { const lim = r.int(100, 100000); for (const ro of [p.sup, p.app, 'viewer', 'clerk']) for (const a of [lim - 1, lim, lim + 1]) out.push([ro, a, lim]); } return out; },
});

fam('retry-policy', {
  can: { defect: ['LOGIC_ERROR', 'OFF_BY_ONE'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const [status, attempt, max] = r.pick([['status', 'attempt', 'maxAttempts'], ['code', 'tries', 'limit'], ['httpStatus', 'attemptNo', 'maxTries']]);
    return { name: ctx.name(['shouldRetry{N}', 'isRetryable{N}', 'retry{N}Allowed', 'canRetry{N}']), status, attempt, max, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['precedence', 'operand'], OFF_BY_ONE: ['bound'] }, decoy: { LOGIC_ERROR: ['floor'] } }) };
  },
  smell: p => (p.variant === 'floor' ? 'LOGIC_ERROR' : null),
  sig: p => [p.status, p.attempt, p.max],
  doc: p => ({ lines: [`True when a failed call should be retried: only while ${p.attempt} (counted from 1) is below ${p.max}, and only for HTTP status 429 or a 5xx status (500-599).`],
    params: ['the HTTP status of the failed call', 'this attempt\'s number', 'the most attempts allowed'], returns: 'boolean' }),
  domain: () => ({ params: [{ t: 'int', min: 100, max: 599 }, { t: 'int', min: 1, max: 20 }, { t: 'int', min: 1, max: 20 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { status, attempt, max } = p;
    if (v === 'precedence') return `return ${status} === 429 || ${status} >= 500 && ${status} <= 599 && ${attempt} < ${max};`;
    if (v === 'operand') return J(`if (${attempt} >= ${max}) return false;`, `return ${status} === 429 || ${status} >= 400;`);
    if (v === 'bound') return J(`if (${attempt} > ${max}) return false;`, `return ${status} === 429 || (${status} >= 500 && ${status} <= 599);`);
    if (v === 'floor') return J(`const transient = ${status} === 429 || Math.floor(${status} / 100) === 5;`, `return transient && !(${attempt} >= ${max});`);
    return p.style ? J(`const transient = ${status} === 429 || (${status} >= 500 && ${status} < 600);`, `return transient && ${attempt} < ${max};`)
      : J(`if (${attempt} >= ${max}) return false;`, `return ${status} === 429 || (${status} >= 500 && ${status} <= 599);`);
  },
  probes(p, r) { const out = []; const m = r.int(3, 5); for (const s of [200, 404, 429, 500, 503, 599]) for (const a of [1, m - 1, m, m + 1]) out.push([s, a, m]); return out; },
});

fam('filter-status', {
  can: { defect: ['LOGIC_ERROR'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const [a, b] = r.sample(STATUS_WORDS, 2);
    return { name: ctx.name(['open{N}s', 'live{N}s', 'active{N}s', 'billable{N}s', 'countable{N}s']), a, b, recs: r.pick(['records', 'items', 'lines']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['or', 'one'] }, decoy: { LOGIC_ERROR: ['not-or'] } }) };
  },
  smell: p => ({ or: 'LOGIC_ERROR', 'not-or': 'LOGIC_ERROR' }[p.variant] ?? null),
  sig: p => [p.recs],
  doc: p => ({ lines: [`The ${p.recs} whose status is neither '${p.a}' nor '${p.b}', in their original order.`], params: ['objects with id and status'], returns: 'Array' }),
  domain: () => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, status: { t: 'str', max: 20 } } }, max: 40 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { recs, a, b } = p;
    if (v === 'or') return `return ${recs}.filter(r => r.status !== '${a}' || r.status !== '${b}');`;
    if (v === 'one') return `return ${recs}.filter(r => r.status !== '${a}');`;
    if (v === 'not-or') return `return ${recs}.filter(r => !(r.status === '${a}' || r.status === '${b}'));`;
    return p.style ? J(`const skip = new Set(['${a}', '${b}']);`, `return ${recs}.filter(r => !skip.has(r.status));`) : `return ${recs}.filter(r => r.status !== '${a}' && r.status !== '${b}');`;
  },
  probes(p, r) { const words = [p.a, p.b, 'open', 'paid', 'sent']; return range(6).map(k => [range(k + 1).map(i => ({ id: i + 1, status: r.pick(words) }))]).concat([[[]], [[{ id: 1, status: p.b }]], [[{ id: 1, status: p.a }]]]); },
});

fam('is-overdue', {
  can: { defect: ['LOGIC_ERROR', 'OFF_BY_ONE'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    const [due, today, paid] = r.pick([['dueDay', 'today', 'paidDay'], ['dueOn', 'asOf', 'paidOn']]);
    return { name: ctx.name(['is{N}Overdue', '{n}IsOverdue', 'overdue{N}', 'is{N}Late']), due, today, paid, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['or'], OFF_BY_ONE: ['ge'] }, decoy: { LOGIC_ERROR: ['not-le'] } }) };
  },
  smell: p => (p.variant === 'not-le' ? 'LOGIC_ERROR' : null),
  sig: p => [p.due, p.today, p.paid],
  doc: p => ({ lines: [`True when the item is unpaid (${p.paid} is null) and ${p.today} is after ${p.due} (day numbers); on the due day itself it is not overdue.`],
    params: ['due day number', 'the day to judge', 'day number it was paid, or null'], returns: 'boolean' }),
  domain: () => ({ params: [{ t: 'int', min: 0, max: 80000 }, { t: 'int', min: 0, max: 80000 }, { t: 'nullable', of: { t: 'int', min: 0, max: 80000 } }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { due, today, paid } = p;
    if (v === 'or') return `return ${paid} === null || ${today} > ${due};`;
    if (v === 'ge') return `return ${paid} === null && ${today} >= ${due};`;
    if (v === 'not-le') return J(`if (${paid} !== null) return false;`, `return !(${today} <= ${due});`);
    return p.style ? J(`if (${paid} !== null) return false;`, `return ${today} > ${due};`) : `return ${paid} === null && ${today} > ${due};`;
  },
  probes(p, r) { const out = []; for (let k = 0; k < 2; k++) { const d = r.int(9000, 12000); for (const t of [d - 1, d, d + 1]) for (const pd of [null, d - 3]) out.push([d, t, pd]); } return out; },
});

fam('max-by', {
  can: { defect: ['LOGIC_ERROR', 'MISSING_GUARD'], decoy: ['LOGIC_ERROR'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['largest{N}', 'top{N}', 'biggest{N}', 'max{N}']), items: r.pick(['items', 'rows', 'entries']), f: r.pick(['amountMinor', 'score', 'weight', 'qty']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { LOGIC_ERROR: ['direction'], MISSING_GUARD: ['noguard'] }, decoy: { LOGIC_ERROR: ['not-le'] } }) };
  },
  smell: p => ({ noguard: 'MISSING_GUARD', 'not-le': 'LOGIC_ERROR' }[p.variant] ?? null),
  sig: p => [p.items],
  doc: p => ({ lines: [`The element of ${p.items} with the largest ${p.f}; the first such element when several tie; null for an empty array.`], params: [`objects with id and ${p.f}`], returns: 'Object|null' }),
  domain: p => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, [p.f]: INT } }, max: 40 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { items, f } = p;
    const loop = cond => J('let best = null;', `for (const it of ${items}) {`, `  if (best === null || ${cond}) best = it;`, '}', 'return best;');
    if (v === 'direction') return loop(`it.${f} < best.${f}`);
    if (v === 'not-le') return loop(`!(it.${f} <= best.${f})`);
    if (v === 'noguard') return `return ${items}.reduce((best, it) => (it.${f} > best.${f} ? it : best));`;
    return p.style ? J(`if (${items}.length === 0) return null;`, `return ${items}.reduce((best, it) => (it.${f} > best.${f} ? it : best));`) : loop(`it.${f} > best.${f}`);
  },
  probes(p, r) { return [0, 1, 3, 5].map(n => [range(n).map(i => ({ id: i + 1, [p.f]: r.int(0, 3) }))]).concat([[[{ id: 1, [p.f]: 5 }, { id: 2, [p.f]: 9 }, { id: 3, [p.f]: 9 }, { id: 4, [p.f]: 2 }]]]); },
});

// ================================================================================================== MISSING_GUARD hosts
fam('average', {
  can: { defect: ['MISSING_GUARD'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['average{N}', 'mean{N}', '{n}Average', 'avg{N}']), v: r.pick(['values', 'amounts', 'xs']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['noguard'] }, decoy: { MISSING_GUARD: ['and'] } }) };
  },
  smell: p => (p.variant ? 'MISSING_GUARD' : null),
  sig: p => [p.v],
  doc: p => ({ lines: [`Arithmetic mean of ${p.v}; 0 for an empty array.`], params: ['integers'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'arr', of: INT, max: 50 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    if (v === 'noguard') return J('let sum = 0;', `for (const x of ${p.v}) sum += x;`, `return sum / ${p.v}.length;`);
    if (v === 'and') return `return ${p.v}.length && ${p.v}.reduce((a, b) => a + b, 0) / ${p.v}.length;`;
    return p.style ? `return ${p.v}.length === 0 ? 0 : ${p.v}.reduce((a, b) => a + b, 0) / ${p.v}.length;`
      : J(`if (${p.v}.length === 0) return 0;`, 'let sum = 0;', `for (const x of ${p.v}) sum += x;`, `return sum / ${p.v}.length;`);
  },
  probes(p, r) { return [0, 1, 2, 5, 9].map(n => [ints(r, n, -1000, 1000)]); },
});

fam('ratio', {
  can: { defect: ['MISSING_GUARD'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    const [part, whole] = r.pick([['part', 'whole'], ['count', 'total'], ['paid', 'due']]);
    return { name: ctx.name(['{n}Share', 'share{N}', '{n}Ratio', 'ratio{N}']), part, whole, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['noguard'] }, decoy: { MISSING_GUARD: ['truthy'] } }) };
  },
  smell: p => (p.variant ? 'MISSING_GUARD' : null),
  sig: p => [p.part, p.whole],
  doc: p => ({ lines: [`${p.part} as a fraction of ${p.whole}; null when ${p.whole} is 0.`], params: ['an integer', 'an integer'], returns: 'number|null' }),
  domain: () => ({ params: [{ t: 'int', min: -1e7, max: 1e7 }, { t: 'int', min: -1e7, max: 1e7 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    if (v === 'noguard') return `return ${p.part} / ${p.whole};`;
    if (v === 'truthy') return `return ${p.whole} ? ${p.part} / ${p.whole} : null;`;
    return p.style ? `return ${p.whole} === 0 ? null : ${p.part} / ${p.whole};` : J(`if (${p.whole} === 0) return null;`, `return ${p.part} / ${p.whole};`);
  },
  probes(p, r) { return [[3, 4], [0, 0], [5, 0], [-2, 8], [r.int(1, 99), r.int(100, 999)], [0, 7]]; },
});

fam('display-name', {
  can: { defect: ['MISSING_GUARD'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}DisplayName', 'label{N}', '{n}Label', 'nameOf{N}']), c: r.pick(['contact', 'person', 'party']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['blank', 'null'] }, decoy: { MISSING_GUARD: ['nullish-or'] } }) };
  },
  smell: p => ({ null: 'MISSING_GUARD', 'nullish-or': 'MISSING_GUARD' }[p.variant] ?? null),
  sig: p => [p.c],
  doc: p => ({ lines: [`The name of ${p.c} without surrounding spaces; ${p.c}.email when the name is null, empty or only spaces.`], params: ['an object with name (string or null) and email'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'obj', props: { name: { t: 'nullable', of: { t: 'str', max: 40 } }, email: { t: 'str', max: 60 } }, keys: ['name', 'email'] }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const c = p.c;
    if (v === 'blank') return `return ${c}.name ? ${c}.name.trim() : ${c}.email;`;
    if (v === 'null') return `return ${c}.name.trim() || ${c}.email;`;
    if (v === 'nullish-or') return `return (${c}.name ?? '').trim() || ${c}.email;`;
    return p.style ? J(`if (${c}.name === null || ${c}.name.trim() === '') return ${c}.email;`, `return ${c}.name.trim();`)
      : J(`const name = ${c}.name === null ? '' : ${c}.name.trim();`, `return name === '' ? ${c}.email : name;`);
  },
  probes() { return [[{ name: ' Ada Lovell ', email: 'a@x.example' }], [{ name: null, email: 'b@x.example' }], [{ name: '   ', email: 'c@x.example' }], [{ name: '', email: 'd@x.example' }], [{ name: 'Bo', email: 'e@x.example' }]]; },
});

fam('first-or', {
  can: { defect: ['MISSING_GUARD'], decoy: ['MISSING_GUARD'] },
  draw(r, ctx, role) {
    const [items, fb] = r.pick([['items', 'fallback'], ['values', 'otherwise'], ['choices', 'defaultValue']]);
    return { name: ctx.name(['first{N}Or', 'first{N}', 'head{N}Or', 'primary{N}']), items, fb, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['or'] }, decoy: { MISSING_GUARD: ['length-truthy'] } }) };
  },
  smell: p => (p.variant ? 'MISSING_GUARD' : null),
  sig: p => [p.items, p.fb],
  doc: p => ({ lines: [`The first element of ${p.items}, or ${p.fb} when ${p.items} is empty; a first element of 0, '' or false is returned as it is.`], params: ['the candidates', 'returned for an empty array'], returns: '*' }),
  domain: () => ({ params: [{ t: 'arr', of: { t: 'scalar' }, max: 20 }, { t: 'nullable', of: { t: 'scalar' } }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    if (v === 'or') return `return ${p.items}[0] || ${p.fb};`;
    if (v === 'length-truthy') return `return ${p.items}.length ? ${p.items}[0] : ${p.fb};`;
    return p.style ? J(`if (${p.items}.length === 0) return ${p.fb};`, `return ${p.items}[0];`) : `return ${p.items}.length > 0 ? ${p.items}[0] : ${p.fb};`;
  },
  probes() { return [[[], 'none'], [[0, 5], 9], [['', 'x'], 'y'], [[false, true], null], [[7], 1], [[], null]]; },
});

fam('safe-get', {
  can: { defect: ['MISSING_GUARD'], decoy: [] },
  draw(r, ctx, role) {
    const [obj, path] = r.pick([['obj', 'path'], ['record', 'keyPath'], ['doc', 'dotted']]);
    return { name: ctx.name(['read{N}Field', 'pick{N}Value', 'get{N}At', 'lookup{N}']), obj, path, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { MISSING_GUARD: ['nocheck', 'undef-only'] } }) };
  },
  smell: p => (p.variant === 'nocheck' ? 'MISSING_GUARD' : null),
  sig: p => [p.obj, p.path],
  doc: p => ({ lines: [`The value at a dotted path such as 'billing.address.city' in ${p.obj}; undefined as soon as a step is missing, null or undefined.`], params: ['any JSON value', 'keys joined by dots'], returns: '*' }),
  domain: () => ({ params: [{ t: 'json', maxBytes: 1500 }, { t: 'str', max: 60 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { obj, path } = p;
    if (v === 'nocheck') return `return ${path}.split('.').reduce((cur, key) => cur[key], ${obj});`;
    const guard = v === 'undef-only' ? 'cur === undefined' : 'cur === null || cur === undefined';
    if (p.style === 1 && !v) return `return ${path}.split('.').reduce((cur, key) => (${guard} ? undefined : cur[key]), ${obj});`;
    return J(`let cur = ${obj};`, `for (const key of ${path}.split('.')) {`, `  if (${guard}) return undefined;`, '  cur = cur[key];', '}', 'return cur;');
  },
  probes() { const o = { a: { b: { c: 1 } }, n: null, list: [4, 5] }; return [[o, 'a.b.c'], [o, 'a.x.c'], [o, 'n.c'], [o, 'a.b'], [o, 'z'], [o, 'list.1'], [null, 'a']]; },
});

// ======================================================================================================= ROUNDING hosts
fam('round-minor', {
  kind: 'helper', can: { defect: ['ROUNDING'], decoy: ['ROUNDING'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['roundMinor', 'roundUnits', 'houseRound']), rule: ctx.house.rounding, v: r.pick(['value', 'x']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { ROUNDING: ['math-round', 'other-rule'] }, decoy: { ROUNDING: ['decoy'] } }) };
  },
  smell: p => (p.variant === 'decoy' ? 'ROUNDING' : null),
  sig: p => [p.v],
  doc: p => ({ lines: [`Rounds ${p.v} (at most four decimal places) to a whole number of minor units by the house rounding rule (docs/CONVENTIONS.md §2).`], params: ['the value to round'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'num', min: -1e9, max: 1e9, dp: 4 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const x = p.v;
    const away = s => (s ? J(`const r = Math.round(Math.abs(${x}));`, `return ${x} < 0 ? -r : r;`) : `return Math.sign(${x}) * Math.round(Math.abs(${x}));`);
    const even = () => J(`const floor = Math.floor(${x});`, `const diff = ${x} - floor;`, 'if (diff > 0.5) return floor + 1;', 'if (diff < 0.5) return floor;', 'return floor % 2 === 0 ? floor : floor + 1;');
    if (v === 'math-round') return `return Math.round(${x});`;
    if (v === 'decoy') return p.rule === 'HALF_AWAY' ? `return Math.trunc(${x} + Math.sign(${x}) * 0.5);` : J(`const n = Math.round(${x});`, `return Math.abs(${x} % 1) === 0.5 && n % 2 !== 0 ? n - 1 : n;`);
    const rule = v === 'other-rule' ? (p.rule === 'HALF_AWAY' ? 'HALF_EVEN' : 'HALF_AWAY') : p.rule;
    return rule === 'HALF_AWAY' ? away(p.style) : even();
  },
  probes() { return [0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 3.5, -3.5, 12.5, -12.5, 2.4999, -2.5001, 7.25, -7.75, 0, 3, -4].map(x => [x]); },
});

fam('line-amount', {
  kind: 'caller', helper: 'round-minor', can: { defect: ['ROUNDING', 'UNIT_MISMATCH'], decoy: [] },
  draw(r, ctx, role) {
    const [qty, unit, disc] = r.pick([['qty', 'unitMinor', 'discountBp'], ['quantity', 'unitPrice', 'discount'], ['units', 'priceMinor', 'rebateBp']]);
    return { name: ctx.name(['{n}LineAmount', 'line{N}Total', 'net{N}Amount', '{n}NetLine']), qty, unit, disc, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { ROUNDING: ['per-unit'], UNIT_MISMATCH: ['percent'] } }) };
  },
  smell: () => null,
  sig: p => [p.qty, p.unit, p.disc],
  doc: p => ({ lines: [`Amount of one line in minor units: ${p.qty} x ${p.unit} less a discount of ${p.disc} basis points (1 bp = 0.01%), rounded once, at the end, with ${p.helper} (the house rule). ${p.qty} is negative on returns.`],
    params: ['quantity, negative on returns', 'unit price in minor units', 'discount in basis points'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'int', min: -100, max: 100 }, { t: 'int', min: 0, max: 1e6 }, { t: 'int', min: 0, max: 10000 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { qty, unit, disc, helper: H } = p;
    if (v === 'per-unit') return J(`const net = ${H}(${unit} * (10000 - ${disc}) / 10000);`, `return ${qty} * net;`);
    if (v === 'percent') return J(`const gross = ${qty} * ${unit};`, `return ${H}(gross * (100 - ${disc}) / 100);`);
    return p.style ? `return ${H}((${qty} * ${unit} * (10000 - ${disc})) / 10000);` : J(`const gross = ${qty} * ${unit};`, `return ${H}(gross * (10000 - ${disc}) / 10000);`);
  },
  probes(p, r) { return [[1, 5, 5000], [-1, 5, 5000], [3, 5, 5000], [-3, 5, 5000], [1, 7, 5000], [-1, 7, 5000], [2, 1999, 250], [-4, 333, 1250], [r.int(1, 9), r.int(100, 9999), r.int(1, 3000)], [5, 120, 0]]; },
});

fam('sum-lines', {
  kind: 'caller', helper: 'round-minor', can: { defect: ['OFF_BY_ONE'], decoy: [] },
  draw(r, ctx, role) {
    return { name: ctx.name(['total{N}s', 'sum{N}Lines', '{n}sTotal', 'add{N}s']), arr: r.pick(['amounts', 'lines', 'parts']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { OFF_BY_ONE: ['skip-first'] } }) };
  },
  smell: p => (p.variant ? 'OFF_BY_ONE' : null),
  sig: p => [p.arr],
  doc: p => ({ lines: [`Total of ${p.arr} (amounts in minor units), passed through ${p.helper} so the result is always a whole number of minor units.`], params: ['integers in minor units'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'arr', of: { t: 'int', min: -1e7, max: 1e7 }, max: 50 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    if (v === 'skip-first') return J('let total = 0;', `for (let i = 1; i < ${p.arr}.length; i++) total += ${p.arr}[i];`, `return ${p.helper}(total);`);
    return p.style ? `return ${p.helper}(${p.arr}.reduce((t, a) => t + a, 0));` : J('let total = 0;', `for (const a of ${p.arr}) total += a;`, `return ${p.helper}(total);`);
  },
  probes(p, r) { return [[[]], [[5]], [ints(r, 3, -9999, 9999)], [ints(r, 6, -9999, 9999)], [[1, 2, 3]]]; },
});

fam('split-evenly', {
  can: { defect: ['ROUNDING', 'OFF_BY_ONE'], decoy: ['ROUNDING'] },
  draw(r, ctx, role) {
    const [t, n] = r.pick([['totalMinor', 'parts'], ['amount', 'n'], ['total', 'ways']]);
    return { name: ctx.name(['split{N}', 'share{N}Evenly', 'spread{N}', 'allocate{N}']), t, n, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { ROUNDING: ['round-each'], OFF_BY_ONE: ['le-extra'] }, decoy: { ROUNDING: ['ceil-trick'] } }) };
  },
  smell: p => ({ 'round-each': 'ROUNDING', 'ceil-trick': 'ROUNDING' }[p.variant] ?? null),
  sig: p => [p.t, p.n],
  doc: p => ({ lines: [`Splits ${p.t} (minor units, not negative) into ${p.n} whole amounts that differ by at most one and add up to exactly ${p.t}; the earlier parts take the extra units.`],
    params: ['the amount to split', 'how many parts'], returns: 'number[]' }),
  domain: () => ({ params: [{ t: 'int', min: 0, max: 1e7 }, { t: 'int', min: 1, max: 50 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { t, n } = p;
    if (v === 'round-each') return J(`const each = Math.round(${t} / ${n});`, `return new Array(${n}).fill(each);`);
    if (v === 'ceil-trick') return `return Array.from({ length: ${n} }, (_, i) => Math.floor((${t} + ${n} - 1 - i) / ${n}));`;
    if (p.style === 1 && !v) return J(`const base = Math.floor(${t} / ${n});`, `const extra = ${t} % ${n};`, `return Array.from({ length: ${n} }, (_, i) => base + (i < extra ? 1 : 0));`);
    return J(`const base = Math.floor(${t} / ${n});`, `const extra = ${t} - base * ${n};`, 'const out = [];', `for (let i = 0; i < ${n}; i++) out.push(i ${v === 'le-extra' ? '<=' : '<'} extra ? base + 1 : base);`, 'return out;');
  },
  probes(p, r) { return [[100, 3], [7, 7], [0, 4], [10, 4], [1, 5], [r.int(0, 99999), r.int(2, 9)], [999, 1]]; },
});

fam('percent-of', {
  can: { defect: ['ROUNDING'], decoy: ['ROUNDING'] },
  draw(r, ctx, role) {
    const [a, pct] = r.pick([['amountMinor', 'pct'], ['amount', 'percent'], ['base', 'pct']]);
    return { name: ctx.name(['{n}Percent', 'percentOf{N}', '{n}Portion', 'part{N}']), a, pct, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { ROUNDING: ['floor', 'round'] }, decoy: { ROUNDING: ['bitor'] } }) };
  },
  smell: p => (p.variant === 'bitor' ? 'ROUNDING' : null),
  sig: p => [p.a, p.pct],
  doc: p => ({ lines: [`${p.pct} percent of ${p.a} (minor units, may be negative), rounded toward zero.`], params: ['an amount in minor units', 'a whole percentage'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'int', min: -1e7, max: 1e7 }, { t: 'int', min: 0, max: 100 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const e = `${p.a} * ${p.pct} / 100`;
    if (v === 'floor') return `return Math.floor(${e});`;
    if (v === 'round') return `return Math.round(${e});`;
    if (v === 'bitor') return `return (${e}) | 0;`;
    return p.style ? J(`const exact = ${e};`, 'return exact < 0 ? Math.ceil(exact) : Math.floor(exact);') : `return Math.trunc(${e});`;
  },
  probes() { const out = []; for (const a of [7, -7, 199, -199, 1234567, -1234567, 50, -50]) for (const pc of [0, 17, 33, 50, 100]) out.push([a, pc]); return out; },
});

fam('fee-rate', {
  can: { defect: ['UNIT_MISMATCH', 'ROUNDING'], decoy: ['UNIT_MISMATCH'] },
  draw(r, ctx, role) {
    const unit = role.kind === 'decoy' ? 'pct' : role.kind === 'defect' && role.cls === 'UNIT_MISMATCH' ? 'bp' : r.pick(['bp', 'pct']);
    return { name: ctx.name(['{n}Fee', 'fee{N}', '{n}Charge', 'commission{N}']), unit, a: r.pick(['amountMinor', 'amount']), rate: 'rate',
      variant: pickVariant(r, role, { defect: { UNIT_MISMATCH: ['percent'], ROUNDING: ['floor'] }, decoy: { UNIT_MISMATCH: ['pct-doc'] } }) };
  },
  smell: p => (p.variant === 'pct-doc' ? 'UNIT_MISMATCH' : null),
  sig: p => [p.a, p.rate],
  doc: p => ({ lines: [`Fee on ${p.a} (minor units, not negative) at ${p.rate} ${p.unit === 'bp' ? 'basis points (1 bp = 0.01%)' : 'percent (2.5 means 2.5%)'}, rounded to the nearest minor unit, halves up.`],
    params: ['an amount in minor units', p.unit === 'bp' ? 'the rate in basis points' : 'the rate in percent'], returns: 'number' }),
  domain: p => ({ params: [{ t: 'int', min: 0, max: 1e7 }, p.unit === 'bp' ? { t: 'int', min: 0, max: 10000 } : { t: 'num', min: 0, max: 100, dp: 1 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const div = p.unit === 'bp' && v !== 'percent' ? 10000 : 100;
    return `return Math.${v === 'floor' ? 'floor' : 'round'}(${p.a} * ${p.rate} / ${div});`;
  },
  probes(p) { const rates = p.unit === 'bp' ? [0, 1, 25, 250, 10000, 333] : [0, 0.5, 2.5, 12.5, 100, 3.3]; const out = []; for (const a of [0, 100, 12345, 99999, 20]) for (const x of rates) out.push([a, x]); return out; },
});

fam('to-major', {
  can: { defect: ['UNIT_MISMATCH'], decoy: [] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}InMajorUnits', 'toMajor{N}', 'major{N}', '{n}Major']), m: r.pick(['minor', 'amountMinor']), cur: r.pick(['currency', 'code']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { UNIT_MISMATCH: ['always-100'] } }) };
  },
  smell: () => null,
  sig: p => [p.m, p.cur],
  doc: p => ({ lines: [`${p.m} (minor units of ${p.cur}) in major units: JPY has no minor unit, every other currency has two decimals (docs/CONVENTIONS.md §1).`], params: ['an amount in minor units', 'ISO currency code'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'int', min: -1e9, max: 1e9 }, { t: 'enum', values: ['USD', 'EUR', 'GBP', 'JPY', 'CHF'] }] }),
  body(p, which) {
    if (which === 'planted' && p.variant === 'always-100') return `return ${p.m} / 100;`;
    return p.style ? J(`if (${p.cur} === 'JPY') return ${p.m};`, `return ${p.m} / 100;`) : J(`const digits = ${p.cur} === 'JPY' ? 0 : 2;`, `return ${p.m} / 10 ** digits;`);
  },
  probes() { return [[12345, 'USD'], [12345, 'JPY'], [-500, 'EUR'], [0, 'JPY'], [99, 'GBP'], [7, 'JPY']]; },
});

fam('timeout-ms', {
  can: { defect: ['UNIT_MISMATCH'], decoy: [] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}TimeoutMs', 'timeoutMsFor{N}', '{n}DeadlineMs', 'ms{N}Timeout']), s: r.pick(['seconds', 'secs']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { UNIT_MISMATCH: ['times-100'] } }) };
  },
  smell: () => null,
  sig: p => [p.s],
  doc: p => ({ lines: [`Timeout in whole milliseconds for a timeout of ${p.s} seconds (fractions allowed), rounded to the nearest millisecond.`], params: ['seconds, at most three decimals'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'num', min: 0, max: 3600, dp: 3 }] }),
  body(p, which) { return `return Math.round(${p.s} * ${which === 'planted' && p.variant ? '100' : p.style ? '1e3' : '1000'});`; },
  probes() { return [[0], [1], [2.5], [0.001], [30], [1.25]].map(x => x); },
});

// ================================================================================================= INPUT_MUTATION hosts
fam('sort-by', {
  can: { defect: ['INPUT_MUTATION'], decoy: ['INPUT_MUTATION'] },
  draw(r, ctx, role) {
    const inPlace = role.kind === 'decoy' ? true : role.kind === 'defect' ? false : r.chance(0.3);
    return { name: ctx.name(['sort{N}s', '{n}sSorted', 'order{N}s', 'rank{N}s']), items: r.pick(['items', 'rows', 'list']), f: r.pick(['amountMinor', 'dueDay', 'score', 'seq']), inPlace, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { INPUT_MUTATION: ['sort-arg'] }, decoy: { INPUT_MUTATION: ['sort-arg'] } }) };
  },
  smell: p => (p.variant ? 'INPUT_MUTATION' : null),
  sig: p => [p.items],
  doc: p => ({ lines: [p.inPlace ? `Sorts ${p.items} by ${p.f} ascending in place (equal ${p.f} keep their order) and returns ${p.items}.`
    : `A new array with the elements of ${p.items} sorted by ${p.f} ascending (equal ${p.f} keep their order); ${p.items} itself is not changed.`], params: [`objects with id and ${p.f}`], returns: 'Array' }),
  domain: p => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, [p.f]: INT } }, max: 30 }] }),
  body(p, which) {
    const cmp = `(a, b) => a.${p.f} - b.${p.f}`;
    if (which === 'planted' && p.variant) return `return ${p.items}.sort(${cmp});`;
    if (p.inPlace) return J(`${p.items}.sort(${cmp});`, `return ${p.items};`);
    return p.style ? `return ${p.items}.slice().sort(${cmp});` : `return [...${p.items}].sort(${cmp});`;
  },
  probes(p, r) { return [0, 1, 4, 7].map(n => [range(n).map(i => ({ id: i + 1, [p.f]: r.int(0, 4) }))]).concat([[[{ id: 1, [p.f]: 3 }, { id: 2, [p.f]: 1 }]]]); },
});

fam('with-defaults', {
  can: { defect: ['INPUT_MUTATION'], decoy: ['INPUT_MUTATION'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}Options', 'with{N}Defaults', '{n}SettingsFor', 'resolve{N}Options']), o: r.pick(['options', 'opts', 'overrides']), defaults: drawDefaults(r), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { INPUT_MUTATION: ['fill-arg'] }, decoy: { INPUT_MUTATION: ['assign-new'] } }) };
  },
  smell: p => (p.variant ? 'INPUT_MUTATION' : null),
  sig: p => [p.o],
  doc: p => ({ lines: [`A new options object: the defaults (${defaultsText(p.defaults)}) overridden by every key present in ${p.o}. ${p.o} itself is not changed.`],
    params: [`an object with any of the keys ${p.defaults.map(d => d[0]).join(', ')} or note`], returns: 'Object' }),
  domain: p => { const keys = [...p.defaults.map(d => d[0]), 'note']; return { params: [{ t: 'obj', props: Object.fromEntries(keys.map(k => [k, { t: 'scalar' }])), optional: keys, keys }] }; },
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const lit = defaultsLit(p.defaults);
    if (v === 'fill-arg') return J(`const defaults = ${lit};`, 'for (const [key, value] of Object.entries(defaults)) {', `  if (!(key in ${p.o})) ${p.o}[key] = value;`, '}', `return ${p.o};`);
    if (v === 'assign-new') return J(`const defaults = ${lit};`, `return Object.assign({}, defaults, ${p.o});`);
    return p.style ? `return { ...${lit}, ...${p.o} };` : J(`const defaults = ${lit};`, `return { ...defaults, ...${p.o} };`);
  },
  probes(p) { const [k1] = p.defaults[0]; return [[{}], [{ [k1]: 'x' }], [Object.fromEntries(p.defaults.map(([k]) => [k, 1]))], [{ note: 'n' }]]; },
});

fam('drop-status', {
  can: { defect: ['INPUT_MUTATION'], decoy: ['INPUT_MUTATION'] },
  draw(r, ctx, role) {
    const s = r.pick(STATUS_WORDS), S = cap(s);
    return { name: ctx.name([`without${S}{N}s`, `remove${S}{N}s`, `drop${S}{N}s`]), s, lines: r.pick(['lines', 'entries', 'items']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { INPUT_MUTATION: ['splice-arg'] }, decoy: { INPUT_MUTATION: ['splice-copy'] } }) };
  },
  smell: p => (p.variant ? 'INPUT_MUTATION' : null),
  sig: p => [p.lines],
  doc: p => ({ lines: [`The ${p.lines} whose status is not '${p.s}', in order; ${p.lines} itself is not changed.`], params: ['objects with id and status'], returns: 'Array' }),
  domain: () => ({ params: [{ t: 'arr', of: { t: 'obj', props: { id: INT, status: { t: 'str', max: 20 } } }, max: 30 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const loop = arr => J(`for (let i = ${arr}.length - 1; i >= 0; i--) {`, `  if (${arr}[i].status === '${p.s}') ${arr}.splice(i, 1);`, '}');
    if (v === 'splice-arg') return J(loop(p.lines), `return ${p.lines};`);
    if (v === 'splice-copy') return J(`const out = ${p.lines}.slice();`, loop('out'), 'return out;');
    return p.style ? J('const out = [];', `for (const l of ${p.lines}) if (l.status !== '${p.s}') out.push(l);`, 'return out;') : `return ${p.lines}.filter(l => l.status !== '${p.s}');`;
  },
  probes(p, r) { const ws = [p.s, 'open', 'paid']; return range(5).map(k => [range(k + 1).map(i => ({ id: i + 1, status: r.pick(ws) }))]).concat([[[]], [[{ id: 1, status: p.s }, { id: 2, status: p.s }]]]); },
});

fam('append-total', {
  can: { defect: ['INPUT_MUTATION'], decoy: ['INPUT_MUTATION'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}RowWithTotal', 'with{N}Total', 'append{N}Total', '{n}sAndTotal']), row: r.pick(['row', 'amounts', 'cells']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { INPUT_MUTATION: ['push-arg'] }, decoy: { INPUT_MUTATION: ['push-copy'] } }) };
  },
  smell: p => (p.variant ? 'INPUT_MUTATION' : null),
  sig: p => [p.row],
  doc: p => ({ lines: [`A copy of ${p.row} (amounts in minor units) with their total appended as the last element; ${p.row} itself is not changed.`], params: ['integers in minor units'], returns: 'number[]' }),
  domain: () => ({ params: [{ t: 'arr', of: { t: 'int', min: -1e7, max: 1e7 }, max: 30 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const sum = `${p.row}.reduce((a, b) => a + b, 0)`;
    if (v === 'push-arg') return J(`${p.row}.push(${sum});`, `return ${p.row};`);
    if (v === 'push-copy') return J(`const out = ${p.row}.slice();`, `out.push(${sum});`, 'return out;');
    return p.style ? J('let total = 0;', `for (const x of ${p.row}) total += x;`, `return ${p.row}.concat([total]);`) : J(`const total = ${sum};`, `return [...${p.row}, total];`);
  },
  probes(p, r) { return [[[]], [[5]], [ints(r, 4, -9999, 9999)]]; },
});

// ===================================================================================================== DATE_ARITH hosts
const LEAP = y => `(${y} % 4 === 0 && ${y} % 100 !== 0) || ${y} % 400 === 0`;
fam('days-in-month', {
  kind: 'helper', can: { defect: ['DATE_ARITH'], decoy: ['DATE_ARITH'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['daysInMonth', 'monthLength', 'daysOfMonth']), y: 'year', m: 'month', style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { DATE_ARITH: ['leap4', 'no400'] }, decoy: { DATE_ARITH: ['date-utc'] } }) };
  },
  smell: p => (p.variant === 'date-utc' ? 'DATE_ARITH' : null),
  sig: p => [p.y, p.m],
  doc: p => ({ lines: [`Number of days in ${p.m} (1-12) of ${p.y} in the Gregorian calendar.`], params: ['a year from 1600 to 2400', 'a month number, 1-12'], returns: 'number' }),
  domain: () => ({ params: [{ t: 'int', min: 1600, max: 2400 }, { t: 'int', min: 1, max: 12 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const { y, m } = p;
    if (v === 'date-utc') return `return new Date(Date.UTC(${y}, ${m}, 0)).getUTCDate();`;
    const leap = v === 'leap4' ? `${y} % 4 === 0` : v === 'no400' ? `${y} % 4 === 0 && ${y} % 100 !== 0` : LEAP(y);
    if (p.style === 1) return J(`const leap = ${leap};`, `return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][${m} - 1];`);
    return J(`if (${m} === 2) {`, `  const leap = ${leap};`, '  return leap ? 29 : 28;', '}', `return [4, 6, 9, 11].includes(${m}) ? 30 : 31;`);
  },
  probes() { return [[1900, 2], [2000, 2], [2024, 2], [2100, 2], [2023, 2], [2023, 4], [2023, 1], [1700, 2], [2400, 2], [1600, 12], [2023, 11]]; },
});

fam('add-months', {
  kind: 'caller', helper: 'days-in-month', can: { defect: ['DATE_ARITH'], decoy: [] },
  draw(r, ctx, role) {
    const [d, n] = r.pick([['isoDate', 'months'], ['date', 'n'], ['start', 'count']]);
    return { name: ctx.name(['shift{N}Date', '{n}DateAfterMonths', 'add{N}Months', 'next{N}Date']), d, n, style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { DATE_ARITH: ['no-clamp'] } }) };
  },
  smell: () => null,
  sig: p => [p.d, p.n],
  doc: p => ({ lines: [`The date ${p.n} calendar months after ${p.d} (YYYY-MM-DD; ${p.n} may be negative). A day that does not exist in the target month becomes that month's last day (${p.helper}).`],
    params: ['a date, YYYY-MM-DD', 'months to add, -120 to 120'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'iso' }, { t: 'int', min: -120, max: 120 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const head = `const [y, m, d] = ${p.d}.split('-').map(Number);`;
    const ym = p.style ? [`const total = y * 12 + m - 1 + ${p.n};`, 'const year = Math.floor(total / 12);', 'const month = (total % 12) + 1;']
      : [`const index = y * 12 + (m - 1) + ${p.n};`, 'const year = Math.floor(index / 12);', 'const month = index - year * 12 + 1;'];
    const day = v === 'no-clamp' ? 'const day = d;' : `const day = Math.min(d, ${p.helper}(year, month));`;
    return J(head, ym, day, "return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');");
  },
  probes() { return [['2023-01-31', 1], ['2024-01-31', 1], ['1900-01-29', 1], ['2100-03-31', -1], ['2000-01-30', 1], ['2023-05-15', -7], ['1800-02-28', 12], ['2023-12-31', 2], ['1700-01-31', 1], ['2023-03-31', -13]]; },
});

fam('month-end', {
  kind: 'caller', helper: 'days-in-month', can: { defect: [], decoy: [] },
  draw(r, ctx) { return { name: ctx.name(['{n}MonthEnd', 'endOf{N}Month', 'last{N}Day', '{n}PeriodEnd']), d: r.pick(['isoDate', 'date', 'day']), style: r.int(0, 1), variant: null }; },
  smell: () => null,
  sig: p => [p.d],
  doc: p => ({ lines: [`The last day of the month of ${p.d}, as YYYY-MM-DD (${p.helper}).`], params: ['a date, YYYY-MM-DD'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'iso' }] }),
  body(p) {
    const ym = p.style ? [`const y = Number(${p.d}.slice(0, 4));`, `const m = Number(${p.d}.slice(5, 7));`] : [`const [y, m] = ${p.d}.split('-').map(Number);`];
    return J(ym, `return ${p.d}.slice(0, 8) + String(${p.helper}(y, m)).padStart(2, '0');`);
  },
  probes() { return [['1900-02-10'], ['2000-02-03'], ['2024-02-29'], ['2023-04-01'], ['2100-02-14'], ['2023-12-25'], ['1800-02-01']]; },
});

fam('is-valid-date', {
  can: { defect: ['DATE_ARITH'], decoy: ['DATE_ARITH'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['isValid{N}Date', 'is{N}DateValid', 'valid{N}Date', 'check{N}Date']), t: r.pick(['text', 'value', 'input']),
      variant: pickVariant(r, role, { defect: { DATE_ARITH: ['any-31', 'leap4'] }, decoy: { DATE_ARITH: ['date-utc'] } }) };
  },
  smell: p => (p.variant === 'date-utc' ? 'DATE_ARITH' : null),
  sig: p => [p.t],
  doc: p => ({ lines: [`True when ${p.t} is a real Gregorian date written YYYY-MM-DD with a year from 1600 to 2400.`], params: ['any string'], returns: 'boolean' }),
  domain: () => ({ params: [{ t: 'str', max: 20 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const head = [`const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(${p.t});`, 'if (!m) return false;', 'const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);',
      'if (y < 1600 || y > 2400 || mo < 1 || mo > 12 || d < 1) return false;'];
    if (v === 'any-31') return J(head, 'return d <= 31;');
    if (v === 'date-utc') return J(head, 'const t = new Date(Date.UTC(y, mo - 1, d));', 'return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;');
    return J(head, `const leap = ${v === 'leap4' ? 'y % 4 === 0' : LEAP('y')};`, 'const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];', 'return d <= lengths[mo - 1];');
  },
  probes() { return ['2023-02-29', '2024-02-29', '1900-02-29', '2000-02-29', '2023-04-31', '2023-04-30', '2023-13-01', '1599-01-01', '2401-01-01', '2023-1-01', 'abc', '2023-02-28', '2100-02-29', '2023-06-31'].map(s => [s]); },
});

// ======================================================================================================= ESCAPING hosts
fam('csv-field', {
  can: { defect: ['ESCAPING'], decoy: ['ESCAPING'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['csv{N}', 'quote{N}ForCsv', '{n}CsvCell', 'toCsv{N}']), v: r.pick(['value', 'text', 'cell']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { ESCAPING: ['first-only', 'no-newline'] }, decoy: { ESCAPING: ['split-join'] } }) };
  },
  smell: p => ({ 'first-only': 'ESCAPING', 'split-join': 'ESCAPING' }[p.variant] ?? null),
  sig: p => [p.v],
  doc: p => ({ lines: [`${p.v} as one CSV field (RFC 4180): wrapped in double quotes when it contains a comma, a double quote, a carriage return or a line feed, with every double quote inside doubled; returned unchanged otherwise.`],
    params: ['any string'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 80 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const x = p.v;
    const re = v === 'no-newline' ? '/[",]/' : '/[",\\r\\n]/';
    if (v === 'split-join') return `return ${re}.test(${x}) ? '"' + ${x}.split('"').join('""') + '"' : ${x};`;
    if (v === 'first-only') return J(`if (${re}.test(${x})) return '"' + ${x}.replace('"', '""') + '"';`, `return ${x};`);
    if (p.style === 1 && !v) return J(`const needsQuotes = ${re}.test(${x});`, `return needsQuotes ? '"' + ${x}.replaceAll('"', '""') + '"' : ${x};`);
    return J(`if (${re}.test(${x})) return '"' + ${x}.replace(/"/g, '""') + '"';`, `return ${x};`);
  },
  probes() { return ['plain', 'a,b', 'say "hi"', '"a" and "b"', 'line1\nline2', 'x\ry', '', 'no "end', '""', 'a,"b",c'].map(s => [s]); },
});

fam('html-text', {
  can: { defect: ['ESCAPING'], decoy: [] },
  draw(r, ctx, role) {
    return { name: ctx.name(['escape{N}Html', '{n}AsHtml', 'html{N}', 'safe{N}Html']), t: r.pick(['text', 's', 'raw']), style: r.int(0, 1),
      variant: pickVariant(r, role, { defect: { ESCAPING: ['amp-last', 'no-apos'] } }) };
  },
  smell: () => null,
  sig: p => [p.t],
  doc: p => ({ lines: [`${p.t} with &, <, >, " and ' replaced by &amp;, &lt;, &gt;, &quot; and &#39;; each character is escaped exactly once.`], params: ['any string'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 80 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const reps = { amp: ".replace(/&/g, '&amp;')", lt: ".replace(/</g, '&lt;')", gt: ".replace(/>/g, '&gt;')", quot: ".replace(/\"/g, '&quot;')", apos: ".replace(/'/g, '&#39;')" };
    if (p.style === 1 && !v) return J(`const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };`, `return ${p.t}.replace(/[&<>"']/g, c => map[c]);`);
    const order = v === 'amp-last' ? ['lt', 'gt', 'quot', 'apos', 'amp'] : v === 'no-apos' ? ['amp', 'lt', 'gt', 'quot'] : ['amp', 'lt', 'gt', 'quot', 'apos'];
    return J(`return ${p.t}`, order.map((k, i) => `  ${reps[k]}${i === order.length - 1 ? ';' : ''}`));
  },
  probes() { return ['plain', '<b>', 'a & b', "it's", 'say "x"', '&lt;', '', '<a href="x">\'q\'</a>'].map(s => [s]); },
});

fam('like-pattern', {
  can: { defect: ['ESCAPING'], decoy: ['ESCAPING'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['{n}LikePattern', 'like{N}', '{n}SearchPattern', 'contains{N}Pattern']), q: r.pick(['term', 'query', 'needle']),
      variant: pickVariant(r, role, { defect: { ESCAPING: ['no-backslash'] }, decoy: { ESCAPING: ['chained'] } }) };
  },
  smell: p => (p.variant === 'chained' ? 'ESCAPING' : null),
  sig: p => [p.q],
  doc: p => ({ lines: [`A SQL LIKE pattern that matches ${p.q} anywhere: '%' + ${p.q} + '%', with every %, _ and backslash in ${p.q} escaped by a backslash (the pattern's escape character).`], params: ['the search text'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 60 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    if (v === 'chained') return J(`const escaped = ${p.q}.replace(/\\\\/g, '\\\\\\\\').replace(/%/g, '\\\\%').replace(/_/g, '\\\\_');`, "return '%' + escaped + '%';");
    return `return '%' + ${p.q}.replace(/[${v === 'no-backslash' ? '' : '\\\\'}%_]/g, '\\\\$&') + '%';`;
  },
  probes() { return ['abc', '50%', 'a_b', 'c:\\temp', '\\%', '', '100% _off_'].map(s => [s]); },
});

// ================================================================================================ SWALLOWED_ERROR hosts
fam('parse-amount', {
  can: { defect: ['SWALLOWED_ERROR'], decoy: ['SWALLOWED_ERROR'] },
  draw(r, ctx, role) {
    const mode = role.kind === 'decoy' ? 'null' : role.kind === 'defect' ? 'throw' : (r.chance(0.35) ? 'null' : 'throw');
    return { name: ctx.name(mode === 'null' ? ['tryParse{N}Amount', 'maybe{N}Amount', 'parse{N}AmountOrNull'] : ['parse{N}Amount', 'read{N}Amount', '{n}AmountFromText', 'to{N}Minor']),
      mode, t: r.pick(['text', 'input', 'raw']),
      variant: pickVariant(r, role, { defect: { SWALLOWED_ERROR: ['catch-zero', 'wrong-type'] }, decoy: { SWALLOWED_ERROR: ['catch-null'] } }) };
  },
  smell: p => ({ 'catch-zero': 'SWALLOWED_ERROR', 'catch-null': 'SWALLOWED_ERROR' }[p.variant] ?? null),
  sig: p => [p.t],
  doc: p => ({ lines: [`Parses an amount such as '1,234.50', '-12' or '7.05' into minor units: thousands separated by commas, no decimals or exactly two, surrounding spaces ignored. ${p.mode === 'null' ? `Returns null` : 'Throws RangeError'} when ${p.t} is not such an amount.`],
    params: ['the text to parse'], returns: p.mode === 'null' ? 'number|null' : 'number' }),
  domain: () => ({ params: [{ t: 'str', max: 40 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const fail = p.mode === 'null' && v !== 'catch-null' ? 'return null;' : `throw new ${v === 'wrong-type' ? 'Error' : 'RangeError'}('not an amount: ' + ${p.t});`;
    const core = [`const m = /^(-?)(\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.(\\d{2}))?$/.exec(${p.t}.trim());`, `if (!m) ${fail}`,
      "const units = Number(m[2].replace(/,/g, ''));", 'const cents = m[3] === undefined ? 0 : Number(m[3]);', "return (m[1] === '-' ? -1 : 1) * (units * 100 + cents);"];
    if (v === 'catch-zero' || v === 'catch-null') return J('try {', core.map(l => `  ${l}`), '} catch (err) {', `  return ${v === 'catch-zero' ? '0' : 'null'};`, '}');
    return J(core);
  },
  probes() { return ['1,234.50', '-12', '7.05', '12.5', 'abc', '', '1,23', ' 42 ', '-0.99', '1234,567', '1,234,567.00'].map(s => [s]); },
});

fam('read-settings', {
  can: { defect: ['SWALLOWED_ERROR'], decoy: ['SWALLOWED_ERROR'] },
  draw(r, ctx, role) {
    return { name: ctx.name(['read{N}Settings', 'parse{N}Config', 'load{N}Settings', '{n}Settings']), j: r.pick(['json', 'text', 'source']), defaults: drawDefaults(r),
      variant: pickVariant(r, role, { defect: { SWALLOWED_ERROR: ['catch-defaults'] }, decoy: { SWALLOWED_ERROR: ['rethrow'] } }) };
  },
  smell: p => (p.variant ? 'SWALLOWED_ERROR' : null),
  sig: p => [p.j],
  doc: p => ({ lines: [`Settings parsed from the JSON text ${p.j}, with the defaults (${defaultsText(p.defaults)}) for keys it does not set; throws SyntaxError when ${p.j} is not valid JSON.`], params: ['JSON text'], returns: 'Object' }),
  domain: () => ({ params: [{ t: 'str', max: 200 }] }),
  body(p, which) {
    const v = which === 'planted' ? p.variant : null;
    const lit = `const defaults = ${defaultsLit(p.defaults)};`;
    if (v === 'catch-defaults') return J(lit, 'let parsed;', 'try {', `  parsed = JSON.parse(${p.j});`, '} catch (err) {', '  parsed = {};', '}', 'return { ...defaults, ...parsed };');
    if (v === 'rethrow') return J(lit, 'try {', `  return { ...defaults, ...JSON.parse(${p.j}) };`, '} catch (err) {', "  throw new SyntaxError('settings: ' + err.message);", '}');
    return J(lit, `return { ...defaults, ...JSON.parse(${p.j}) };`);
  },
  probes() { return ['{}', '{"pageSize": 10}', 'not json', '', '{"a":1', '[1,2]', 'null', '"x"', '{"locale":"fr-FR","extra":true}'].map(s => [s]); },
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
  sig: p => [p.pre, p.n, p.w], doc: p => ({ lines: [`${p.pre}, a hyphen and ${p.n} padded with zeros to ${p.w} digits ('INV', 42, 5 gives 'INV-00042').`], params: ['letters', 'a whole number', 'digits, 1-12'], returns: 'string' }),
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
  sig: p => [p.t], doc: p => ({ lines: [`Upper-case first letters of the words of ${p.t} (words are separated by whitespace).`], params: ['a name'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 60 }] }), body: p => `return ${p.t}.split(/\\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('');`, probes: () => [['ada lovell'], ['  Bo  Chan ']] });
filler('mask-account', ['mask{N}Number', 'masked{N}', 'hide{N}Digits'], r => ({ t: r.pick(['accountNo', 'iban', 'cardNo']) }), {
  sig: p => [p.t], doc: p => ({ lines: [`${p.t} with every character but the last four replaced by *; unchanged when it has four characters or fewer.`], params: ['an account number'], returns: 'string' }),
  domain: () => ({ params: [{ t: 'str', max: 40 }] }), body: p => `return ${p.t}.length <= 4 ? ${p.t} : '*'.repeat(${p.t}.length - 4) + ${p.t}.slice(-4);`, probes: () => [['GB29NWBK60161331926819'], ['1234']] });
filler('is-blank', ['is{N}Blank', 'blank{N}', 'isEmpty{N}Text'], r => ({ t: r.pick(['text', 'value']) }), {
  sig: p => [p.t], doc: p => ({ lines: [`True when ${p.t} is empty or only whitespace.`], params: ['any string'], returns: 'boolean' }),
  domain: () => ({ params: [{ t: 'str', max: 80 }] }), body: p => `return ${p.t}.trim() === '';`, probes: () => [[''], ['  '], ['x']] });

/** Families that can host a defect / a decoy of `cls`, optionally restricted to a kind. */
export const hostsOf = (role, cls) => Object.values(FAMILIES).filter(f => f.can[role].includes(cls));
