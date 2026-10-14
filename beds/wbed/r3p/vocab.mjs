// Vocabulary for W-bed R3' "planted-defect sweep": defect classes (closed enum, with the definitions the task states),
// the classes in scope per difficulty (new classes enter only at higher difficulty: the drift knob), the house
// conventions drawn per task, the repository areas and file names, and the generic comment pools.

/** Every class the output schema admits, in a fixed order. A task states the ones in scope (inputs.defect_classes). */
export const CLASSES = ['OFF_BY_ONE', 'LOGIC_ERROR', 'MISSING_GUARD', 'ROUNDING', 'INPUT_MUTATION', 'DATE_ARITH', 'ESCAPING', 'SWALLOWED_ERROR', 'UNIT_MISMATCH'];

export const DEFINITIONS = {
  OFF_BY_ONE: 'a count, index, page number or range bound that is off by exactly one from the contract: an inclusive end treated as exclusive or the reverse, 0- and 1-based numbering confused, one item too many or too few.',
  LOGIC_ERROR: 'a condition that does not express the contract\'s rule: negated, the wrong connective (and/or), the wrong operand, the wrong comparison direction, or one case of a several-case rule left out. A range bound off by one is OFF_BY_ONE; an empty, null or zero input is MISSING_GUARD; a calendar rule is DATE_ARITH; a unit or currency factor is UNIT_MISMATCH.',
  MISSING_GUARD: 'an empty, null, blank, zero or falsy input that the contract covers explicitly is not handled as it says: the function crashes, returns NaN or Infinity, or returns the wrong fallback.',
  ROUNDING: 'a rounding that does not follow the contract or the house rule: the wrong direction, the wrong rule for halves, or rounding at the wrong step (for example each part rounded on its own, so that the parts no longer add up to the total).',
  INPUT_MUTATION: 'the function changes an argument that its contract says is left unchanged.',
  DATE_ARITH: 'calendar arithmetic that is wrong for some valid date: leap years, month lengths, days past the end of a month.',
  ESCAPING: 'text escaped or quoted incompletely, or in the wrong order, for the format the contract names.',
  SWALLOWED_ERROR: 'an error the contract says is thrown is caught and replaced by a value, or a different error type is thrown.',
  UNIT_MISMATCH: 'a quantity converted with the wrong unit factor: percent and basis points, minor and major currency units, seconds and milliseconds.',
};

export const MIN_D = 2, MAX_D = 5;
// Knobs per difficulty. files: source files under src/ (the fan-out width, including the two src/lib helper modules);
// fns: functions per file; defects / decoys: planted per task; helperDefects: defective src/lib helpers (their callers
// inherit the wrong behaviour; the root-cause rule decides where it is reported).
export const LEVELS = {
  2: { files: 8, fns: [5, 7], defects: 6, decoys: 6, helperDefects: [1, 1], classes: ['OFF_BY_ONE', 'LOGIC_ERROR', 'MISSING_GUARD', 'ROUNDING'] },
  3: { files: 16, fns: [6, 8], defects: 10, decoys: 10, helperDefects: [1, 1], classes: ['OFF_BY_ONE', 'LOGIC_ERROR', 'MISSING_GUARD', 'ROUNDING', 'INPUT_MUTATION'] },
  4: { files: 32, fns: [8, 10], defects: 16, decoys: 16, helperDefects: [1, 2], classes: ['OFF_BY_ONE', 'LOGIC_ERROR', 'MISSING_GUARD', 'ROUNDING', 'INPUT_MUTATION', 'DATE_ARITH', 'ESCAPING'] },
  5: { files: 48, fns: [8, 10], defects: 24, decoys: 24, helperDefects: [2, 2], classes: CLASSES },
};
/** Minimum planted defects per in-scope class (quotas make the class-confusion control decisive). */
export const CLASS_MIN = { 2: 1, 3: 1, 4: 2, 5: 2 };
export const classesAt = d => LEVELS[d].classes;
/** The difficulty at which a class first appears (drift: new classes only at higher difficulty). */
export const CLASS_FROM = Object.fromEntries(CLASSES.map(c => [c, Math.min(...Object.keys(LEVELS).map(Number).filter(d => LEVELS[d].classes.includes(c)))]));

// House conventions drawn per task and stated in docs/CONVENTIONS.md. A function contract may defer to them, so the
// same code is correct in one task and a defect in another.
export const HOUSE = {
  rounding: { HALF_AWAY: 'halves are rounded away from zero (2.5 -> 3, -2.5 -> -3)', HALF_EVEN: 'halves are rounded to the nearest even number (2.5 -> 2, 3.5 -> 4, -2.5 -> -2)' },
  band: { incl: 'a band from lo to hi includes both lo and hi', excl: 'a band from lo to hi includes lo and excludes hi' },
  pageBase: { 1: 'pages are numbered from 1', 0: 'pages are numbered from 0' },
};

// Repository areas: directory under src/, file names, and the function families each file draws from.
export const AREAS = [
  { dir: 'billing', files: ['invoices', 'credit-notes', 'line-items', 'discounts', 'fees', 'taxes', 'quotes', 'rebates'],
    families: ['line-amount', 'sum-lines', 'split-evenly', 'percent-of', 'fee-rate', 'approval-rule', 'filter-status', 'max-by', 'sum-field', 'format-ref', 'append-total', 'drop-status', 'range-check', 'to-major', 'average', 'month-end'] },
  { dir: 'payments', files: ['payments', 'remittance', 'refunds', 'payouts', 'allocations', 'dunning'],
    families: ['is-overdue', 'retry-policy', 'split-evenly', 'parse-amount', 'percent-of', 'fee-rate', 'filter-status', 'last-n', 'chunk', 'unique-ids', 'line-amount', 'sum-lines', 'ratio', 'range-check', 'add-months', 'is-valid-date'] },
  { dir: 'calendar', files: ['schedules', 'terms', 'periods', 'holidays', 'billing-runs', 'cutoffs'],
    families: ['add-months', 'month-end', 'is-valid-date', 'day-count', 'is-overdue', 'compare-by-date', 'range-check', 'pairwise-deltas', 'chunk', 'clamp'] },
  { dir: 'export', files: ['csv', 'html', 'search', 'text', 'statements', 'labels'],
    families: ['csv-field', 'html-text', 'like-pattern', 'slugify', 'normalize-spaces', 'initials', 'mask-account', 'display-name', 'is-blank', 'format-ref', 'parse-amount'] },
  { dir: 'platform', files: ['config', 'http', 'pagination', 'cache', 'collections', 'jobs', 'limits', 'flags'],
    families: ['with-defaults', 'read-settings', 'retry-policy', 'timeout-ms', 'page-slice', 'chunk', 'first-or', 'safe-get', 'group-by', 'unique-ids', 'pairwise-deltas', 'last-n', 'clamp', 'sort-by'] },
  { dir: 'reporting', files: ['summaries', 'metrics', 'rankings', 'aging', 'dashboards', 'trends'],
    families: ['average', 'ratio', 'max-by', 'pairwise-deltas', 'sort-by', 'count-by', 'sum-field', 'percent-of', 'page-slice', 'last-n', 'append-total', 'month-end'] },
  { dir: 'customers', files: ['contacts', 'accounts', 'addresses', 'segments', 'consent', 'notes'],
    families: ['display-name', 'first-or', 'safe-get', 'filter-status', 'drop-status', 'mask-account', 'initials', 'group-by', 'with-defaults', 'is-blank', 'sort-by', 'approval-rule', 'is-valid-date'] },
];
/** The two helper modules; their helpers are called from other areas (root-cause attribution). */
export const LIB = [
  { path: 'src/lib/money.js', helper: 'round-minor', families: ['clamp', 'sum-field', 'to-major', 'ratio', 'split-evenly', 'percent-of'] },
  { path: 'src/lib/dates.js', helper: 'days-in-month', families: ['is-valid-date', 'compare-by-date', 'day-count', 'clamp', 'pairwise-deltas'] },
];

export const NOUNS = ['Amount', 'Invoice', 'Payment', 'Credit', 'Order', 'Line', 'Batch', 'Fee', 'Tax', 'Discount', 'Refund', 'Charge',
  'Deposit', 'Payout', 'Shipment', 'Voucher', 'Ledger', 'Account', 'Statement', 'Remittance', 'Quote', 'Rebate', 'Levy', 'Claim',
  'Balance', 'Entry', 'Item', 'Booking', 'Settlement', 'Transfer', 'Receipt', 'Journal', 'Contract'];
export const PACKAGES = ['ledgerkit', 'backoffice-core', 'billing-utils', 'finops-lib', 'accounts-toolkit', 'payables-core'];
export const ORGS = ['hollin', 'kestrel-group', 'linden-co', 'marlow-ops', 'oriel-finance', 'wexford-it'];

// Comment pools. Generic on purpose: a TODO says nothing about whether its function is correct (the generator places
// them independently of the planted sites; the leak test checks that no comment names a class).
export const TODOS = [
  'TODO: move this into the shared utils package', 'TODO(perf): cache this per request', 'FIXME: log the caller id here',
  'TODO: add a metric for this path', 'XXX: remove after the Q3 migration', 'TODO: support more locales',
  'HACK: kept for the legacy importer', 'TODO: document the error codes', 'TODO: rename once the API is versioned',
  'FIXME: the name is confusing, see the wiki', 'TODO: share the constants with the reports team', 'XXX: duplicated in the admin app',
];
export const NOTES = ['Used by the nightly export.', 'Kept small on purpose; callers handle logging.', 'Pure: no I/O, no clock.',
  'Shared by the API and the batch jobs.', 'See docs/CONVENTIONS.md for the house rules.', 'Called on every request; keep it cheap.'];
