// Domain: invoice proration (fictional billing arithmetic library). Money is integer cents.
import { New, Call, Fn, Get, Case } from './dsl.mjs';

export default {
  id: 'billing',
  domain: 'invoice proration',
  params(r) {
    return {
      mod: r.pick(['billing_math', 'invoicer', 'prorata', 'chargebook']),
      company: r.pick(['Tallis & Crane', 'Moorfield Utilities', 'Brightwater Telecom', 'Okapi Cloud', 'Vesper Fibre']),
      taxbp: r.pick([700, 825, 1500, 1900, 2000]),
      grace: r.pick([5, 7, 10, 14]),
      ratebp: r.pick([100, 150, 200]),
      cap: r.pick([2500, 5000, 7500]),
      customers: r.sample(['ACME-17', 'BLUEJAY-3', 'CORMORANT-8', 'DOVETAIL-21', 'EGRET-5', 'FINCH-40'], 3),
    };
  },
  context: p => `${p.company} bills every customer through ${p.mod}; the monthly invoice run and the support refund tool both call it.`,
  sections: [
    { id: 'core', label: 'rounding and proration' },
    { id: 'invoice', label: 'invoice lines, tax and credits' },
    { id: 'planchange', label: 'mid-period plan changes' },
    { id: 'allocation', label: 'payment allocation and statements' },
    { id: 'latefees', label: 'late fees and dunning' },
  ],

  sites: {
    half_cmp: {
      section: 'core', op: 'wrong-comparator', fnKey: 'round_half_up', fn: () => 'round_half_up()',
      title: () => 'Half-cent amounts are rounded down',
      symptom: [
        () => `Amounts that land exactly on half a cent are rounded down instead of up. A customer on 1 day of a 2-day trial priced 45 cents was billed 22 cents, not 23.`,
        () => `round_half_up(5, 2) returns 2. The name and the docstring both say halves go up (away from zero).`,
      ],
      herring: [
        () => `round_half_up(5, 2) returns 3. Python's own round() gives 2 for 2.5 and our auditor says banker's rounding (halves to even) is the standard, so this looks wrong to me.`,
      ],
      decoy: () => 'NOTE: using > here would give banker-style results on exact halves',
      killers: (p, r) => [Case('test_round_half_up_on_exact_halves', [Fn('round_half_up', [5, 2]), Fn('round_half_up', [-7, 2]), Fn('round_half_up', [7, 3]),
        Fn('prorate', [r.pick([45, 135, 2025]), 1, 2])])],
    },
    prorate_full: {
      section: 'core', op: 'wrong-comparator', fnKey: 'prorate', fn: () => 'prorate()',
      title: () => 'prorate() rejects a full period',
      symptom: [
        () => `prorate() raises "days_used out of range" when the service was used for the whole period (days_used == days_in_period).`,
      ],
      killers: (p, r) => { const a = r.int(10, 90) * 100; return [Case('test_prorate_full_period', [Fn('prorate', [a, 30, 30]), Fn('prorate', [a, 31, 30]), Fn('prorate', [a, 0, 30])])]; },
    },
    prorate_default: {
      section: 'core', op: 'wrong-default', fnKey: 'prorate', fn: () => 'prorate()',
      title: () => 'prorate() default period length is wrong',
      symptom: [
        () => `When we leave out days_in_period, prorate() charges slightly less than expected, as if the month had 31 days. The docstring says the default is 30.`,
      ],
      killers: (p, r) => [Case('test_prorate_default_period', [Fn('prorate', [3000 + 300 * r.int(0, 5), 10]), Fn('prorate', [r.int(10, 50) * 100, r.int(1, 29)])])],
    },
    days_neg: {
      section: 'core', op: 'missing-edge-case', fnKey: 'billable_days', fn: () => 'billable_days()',
      title: () => 'billable_days() goes negative',
      symptom: [
        () => `billable_days() returns a negative number when the service ended before the billing period started, and period_charge() then raises for that customer.`,
      ],
      killers: (p, r) => { const ps = r.int(10, 40); return [Case('test_billable_days_outside_period', [Fn('billable_days', [ps - 9, ps - 2, ps, ps + 30]),
        Fn('billable_days', [ps + 5, ps + 60, ps, ps + 30]), Fn('period_charge', [3000, ps - 9, ps - 2, ps, ps + 30])])]; },
    },
    charge_swap: {
      section: 'core', op: 'swapped-arguments', fnKey: 'period_charge', fn: () => 'period_charge()',
      title: () => 'period_charge() fails for partial periods',
      symptom: [
        () => `period_charge() raises ValueError ("days_used out of range") for every customer who joined mid-period. Full-period customers are fine.`,
      ],
      killers: (p, r) => { const a = r.int(5, 20); return [Case('test_period_charge_partial', [Fn('period_charge', [r.int(20, 80) * 100, a, a + r.int(5, 15), 0, 30]),
        Fn('period_charge', [4500, 0, 30, 0, 30])])]; },
    },
    fmt_neg: {
      section: 'core', op: 'missing-edge-case', fnKey: 'format_cents', fn: () => 'format_cents()',
      title: () => 'Negative amounts are printed wrongly',
      symptom: [
        () => `Refund lines print as "--13.95" instead of "-12.05". Positive amounts look fine.`,
      ],
      killers: (p, r) => [Case('test_format_negative_cents', [Fn('format_cents', [-1205]), Fn('format_cents', [-7]), Fn('format_cents', [r.int(100, 99999)]),
        Fn('split_evenly', [r.int(100, 1000), 3])])],
    },
    taxable_default: {
      section: 'invoice', op: 'wrong-default', fnKey: 'Invoice.add_line', fn: () => 'Invoice.add_line()',
      title: () => 'Invoices without explicit taxable flag carry no tax',
      symptom: [
        () => `Since the last release our invoices show zero tax unless we pass taxable=True on every line. The docstring says lines are taxable by default.`,
      ],
      killers: (p, r) => [Case('test_lines_are_taxable_by_default', [New('inv', 'Invoice', [p.customers[0]]), Call('inv', 'add_line', ['Fibre 300', r.int(1, 3), r.int(1000, 4000)]),
        Call('inv', 'add_line', ['Router rental', 1, r.int(200, 900)], { taxable: false }), Call('inv', 'tax'), Call('inv', 'total')])],
    },
    disc_swap: {
      section: 'invoice', op: 'swapped-arguments', fnKey: 'Invoice.add_line', fn: () => 'Invoice.add_line()',
      title: () => 'add_line() crashes on lines without a discount',
      symptom: [
        () => `add_line() raises "denominator must be positive" for every line that has no discount, and discounted lines come out negative.`,
      ],
      killers: (p, r) => [Case('test_line_discounts', [New('inv', 'Invoice', [p.customers[0]]), Call('inv', 'add_line', ['Seats', 3, 1250]),
        Call('inv', 'add_line', ['Support', 1, r.int(10, 40) * 100], { discount_pct: 15 }), Call('inv', 'subtotal')])],
    },
    qty_zero: {
      section: 'invoice', op: 'wrong-comparator', fnKey: 'Invoice.add_line', fn: () => 'Invoice.add_line()',
      title: () => 'add_line() accepts zero quantity',
      symptom: [
        () => `A line with quantity 0 is accepted and printed on the invoice as a 0.00 line. Quantities below 1 should be rejected.`,
      ],
      herring: [
        () => `add_line() rejects quantity 0. We add zero-quantity placeholder lines for bundled items, so 0 should be accepted (it just adds nothing).`,
      ],
      killers: (p, r) => [Case('test_zero_quantity_rejected', [New('inv', 'Invoice', [p.customers[1]]), Call('inv', 'add_line', ['Placeholder', 0, r.int(100, 900)]),
        Call('inv', 'add_line', ['Seats', 2, 500]), Get('inv', 'lines')])],
    },
    credit_floor: {
      section: 'invoice', op: 'missing-edge-case', fnKey: 'Invoice.amount_due', fn: () => 'Invoice.amount_due()',
      title: () => 'Amount due goes negative after a large credit',
      symptom: [
        () => `After a credit note bigger than the invoice, amount_due() is negative and our payment page tries to pay the customer.`,
      ],
      herring: [
        () => `amount_due() is floored at zero. When the credit is larger than the invoice I would expect to see the negative amount, so we know what we owe the customer.`,
      ],
      decoy: () => 'FIXME: finance may want negative amounts due here',
      killers: (p, r) => { const u = r.int(10, 40) * 100; return [Case('test_credit_larger_than_invoice', [New('inv', 'Invoice', [p.customers[2]], { tax_rate_bp: 0 }),
        Call('inv', 'add_line', ['Plan', 1, u]), Call('inv', 'apply_credit', [u + 500]), Call('inv', 'amount_due'), Call('inv', 'apply_credit', [0])])]; },
    },
    change_range: {
      section: 'planchange', op: 'wrong-comparator', fnKey: 'plan_change', fn: () => 'plan_change()',
      title: () => 'plan_change() refuses a change at the end of the period',
      symptom: [
        () => `plan_change() raises ValueError when change_day equals period_days, which our renewal job uses for "switch at the end of this period".`,
      ],
      herring: [
        () => `plan_change() accepts change_day == period_days. A change on the last boundary is meaningless and I would expect it to be refused.`,
      ],
      killers: (p, r) => [Case('test_plan_change_at_period_end', [Fn('plan_change', [r.int(20, 50) * 100, r.int(20, 50) * 100, 30, 30]), Fn('plan_change', [3000, 6000, 30, 31])])],
    },
    remaining_off: {
      section: 'planchange', op: 'off-by-one', fnKey: 'plan_change', fn: () => 'plan_change()',
      title: () => 'plan_change() is a day short',
      symptom: [
        () => `Upgrades are under-charged: switching on day 10 of a 30-day period credits and charges only 19 days instead of 20.`,
      ],
      killers: (p, r) => [Case('test_plan_change_remaining_days', [Fn('plan_change', [3000, 4500, 30, r.int(5, 20)]), Fn('plan_change', [3000, 4500, 30, 0])])],
    },
    plan_swap: {
      section: 'planchange', op: 'swapped-arguments', fnKey: 'plan_change', fn: () => 'plan_change()',
      title: () => 'Upgrades produce a refund',
      symptom: [
        () => `Customers who upgrade to a more expensive plan mid-period get money back, and downgrades are charged extra.`,
      ],
      killers: (p, r) => [Case('test_upgrade_costs_more', [Fn('plan_change', [r.int(20, 30) * 100, r.int(40, 60) * 100, 30, r.int(5, 20)]),
        Fn('upgrade_quote', [{ basic: 3000, pro: 6000 }, 'basic', 'pro', 30, 15])])],
    },
    table_end: {
      section: 'planchange', op: 'off-by-one', fnKey: 'proration_table', fn: () => 'proration_table()',
      title: () => 'proration_table() stops before the end of the period',
      symptom: [
        () => `proration_table(price, 30, 10) has rows for days 0, 10 and 20 but not for day 30 (charge 0), which the docstring says is included.`,
      ],
      killers: (p, r) => [Case('test_proration_table_includes_period_end', [Fn('proration_table', [r.int(20, 90) * 100, 30, 10]), Fn('proration_table', [3100, 28, 9])])],
    },
    alloc_order: {
      section: 'allocation', op: 'swapped-arguments', fnKey: 'allocate_payment', fn: () => 'allocate_payment()',
      title: () => 'Payments go to the wrong invoice first',
      symptom: [
        () => `allocate_payment() pays invoices in invoice-number order instead of oldest-due first, so an overdue invoice stays overdue while a newer one is paid.`,
      ],
      killers: (p, r) => [Case('test_allocation_oldest_due_first', [Fn('allocate_payment', [r.int(4, 9) * 100, [[7, 3, 500], [9, 1, 400], [8, 1, 300]]])])],
    },
    alloc_zero: {
      section: 'allocation', op: 'missing-edge-case', fnKey: 'allocate_payment', fn: () => 'allocate_payment()',
      title: () => 'allocate_payment() lists settled and credit invoices',
      symptom: [
        () => `allocate_payment() lists invoices with nothing due as receiving 0, and a credit invoice (negative amount due) even increases the unapplied amount.`,
      ],
      herring: [
        () => `allocate_payment() silently skips invoices with nothing due. For the audit trail I would like every invoice listed, with 0 applied where nothing was taken.`,
      ],
      decoy: () => 'NOTE: zero-due rows could simply flow through min() below',
      killers: (p, r) => [Case('test_allocation_skips_nothing_due', [Fn('allocate_payment', [r.int(4, 8) * 100, [[1, 1, 0], [2, 2, 300], [3, 3, -50], [4, 4, 900]]])])],
    },
    alloc_stale: {
      section: 'allocation', op: 'stale-variable', fnKey: 'allocate_payment', fn: () => 'allocate_payment()',
      title: () => 'allocate_payment() applies more than was paid',
      symptom: [
        () => `When a payment covers one invoice fully and the next one partly, allocate_payment() applies more money than the payment and reports a negative unapplied amount.`,
      ],
      killers: (p, r) => [Case('test_allocation_never_exceeds_payment', [Fn('allocate_payment', [700, [[1, 1, 400], [2, 2, 500], [3, 5, 100]]]),
        Fn('statement_balance', [[[p.customers[0], 500], [p.customers[1], 200]], [[p.customers[0], 500], [p.customers[1], 50]]])])],
    },
    aging_edge: {
      section: 'allocation', op: 'off-by-one', fnKey: 'aging_buckets', fn: () => 'aging_buckets()',
      title: () => 'Invoices exactly 30 days overdue land in the 31-60 bucket',
      symptom: [
        () => `aging_buckets() puts an invoice that is exactly 30 days overdue into "31-60" instead of "1-30"; same at 60 and 90 days.`,
      ],
      killers: (p, r) => { const t = r.int(100, 200); return [Case('test_aging_bucket_edges', [Fn('aging_buckets', [[[1, t - 30, 100], [2, t - 60, 200], [3, t - 91, 300], [4, t + 5, 50], [5, t, 7]], t])])]; },
    },
    grace_cmp: {
      section: 'latefees', op: 'wrong-comparator', fnKey: 'late_fee', fn: () => 'late_fee()',
      title: () => 'Late fee charged on the last grace day',
      symptom: [
        p => `Customers who pay exactly ${p.grace} days late (the last day of the grace period) are charged a late fee.`,
      ],
      herring: [
        p => `late_fee() does not charge anything on day ${p.grace}, the last grace day. Our terms say the grace period ends at the start of that day, so a fee should already apply.`,
      ],
      killers: (p, r) => { const b = r.int(50, 150) * 100; return [Case('test_no_fee_within_grace', [Fn('late_fee', [b, p.grace]), Fn('late_fee', [b, p.grace + 1]), Fn('late_fee', [0, 90])])]; },
    },
    blocks_off: {
      section: 'latefees', op: 'off-by-one', fnKey: 'late_fee', fn: () => 'late_fee()',
      title: () => 'An extra fee block on exact multiples of 30 days',
      symptom: [
        () => `A balance that is exactly 60 days late is charged three blocks of late fee instead of two.`,
      ],
      decoy: () => 'TODO(perf): days_late // 30 + 1 would avoid the double negation',
      killers: (p, r) => { const b = r.int(50, 200) * 100; return [Case('test_fee_blocks_on_multiples_of_30', [Fn('late_fee', [b, 60]), Fn('late_fee', [b, 61]), Fn('late_fee', [b, 30])])]; },
    },
    fee_cap: {
      section: 'latefees', op: 'missing-edge-case', fnKey: 'late_fee', fn: () => 'late_fee()',
      title: () => 'Late fees exceed the cap',
      symptom: [
        p => `Large balances get late fees far above the ${p.cap}-cent cap.`,
      ],
      killers: (p, r) => [Case('test_late_fee_cap', [Fn('late_fee', [r.int(5, 9) * 100000, 45]), Fn('late_fee', [r.int(5, 9) * 100000, 45], { cap: 100 })])],
    },
    grace_default: {
      section: 'latefees', op: 'wrong-default', fnKey: 'late_fee', fn: () => 'late_fee()',
      title: () => 'Default grace period is too long',
      symptom: [
        p => `With the default arguments late_fee() waits longer than the documented ${p.grace}-day grace period before charging anything.`,
      ],
      killers: (p, r) => [Case('test_default_grace_period', [Fn('late_fee', [r.int(50, 150) * 100, p.grace + 2]), Fn('late_fee', [r.int(50, 150) * 100, p.grace + 1])])],
    },
    stage_cmp: {
      section: 'latefees', op: 'off-by-one', fnKey: 'dunning_stage', fn: () => 'dunning_stage()',
      title: () => 'Dunning stages start a day late',
      symptom: [
        () => `dunning_stage(15) still says "reminder"; the final notice is supposed to start on day 15, not day 16. Day 1 also shows "current".`,
      ],
      killers: () => [Case('test_dunning_stage_boundaries', [Fn('dunning_stage', [15]), Fn('dunning_stage', [1]), Fn('dunning_stage', [0]), Fn('dunning_stage', [44])])],
    },
  },

  randoms: {
    core(p, r, i) {
      const per = r.pick([28, 30, 31]);
      return Case(`test_proration_values_${i}`, [Fn('split_evenly', [r.int(-50, 5000), r.int(1, 7)]), Fn('format_cents', [r.int(-99999, 99999)]),
        Fn('round_half_up', [r.int(-500, 500), r.int(1, 9)]), Fn('prorate', [r.int(1, 99) * 100 + r.int(0, 99), r.int(0, per), per]),
        Fn('billable_days', [r.int(0, 20), r.int(10, 60), r.int(0, 10), r.int(20, 40)]), Fn('period_charge', [r.int(10, 90) * 100, r.int(0, 10), r.int(11, 40), 0, 30])]);
    },
    invoice(p, r, i) {
      const steps = [New('inv', 'Invoice', [r.pick(p.customers)])];
      for (let k = 0; k < 3; k++) steps.push(Call('inv', 'add_line', [`Item ${k + 1}`, r.int(1, 4), r.int(100, 5000)], { taxable: r.chance(0.6), discount_pct: r.pick([0, 0, 5, 10, 25]) }));
      steps.push(Call('inv', 'subtotal'), Call('inv', 'tax'), Call('inv', 'apply_credit', [r.int(1, 30) * 100]), Call('inv', 'total'), Call('inv', 'amount_due'),
        Call('inv', 'summary'));
      return Case(`test_invoice_totals_${i}`, steps);
    },
    planchange(p, r, i) {
      return Case(`test_plan_change_values_${i}`, [Fn('plan_change', [r.int(10, 90) * 100, r.int(10, 90) * 100, r.pick([28, 30, 31]), r.int(0, 28)]),
        Fn('upgrade_quote', [{ lite: 1500, team: 4200, corp: 9900 }, r.pick(['lite', 'team']), r.pick(['team', 'corp']), 30, r.int(0, 30)]),
        Fn('monthly_equivalent', [r.int(100, 2000) * 10]), Fn('proration_table', [r.int(10, 60) * 100, r.pick([28, 30, 31]), r.pick([7, 10, 14])])]);
    },
    allocation(p, r, i) {
      const inv = Array.from({ length: 4 }, (_, k) => [k + 1, r.int(1, 9), r.int(-1, 9) * 100]);
      return Case(`test_allocation_values_${i}`, [Fn('allocate_payment', [r.int(1, 20) * 100, inv]), Fn('aging_buckets', [inv, r.int(0, 100)]),
        Fn('statement_balance', [[[p.customers[0], r.int(1, 9) * 100], [p.customers[1], 300]], [[p.customers[1], 300], [p.customers[2], 100]]])]);
    },
    latefees(p, r, i) {
      return Case(`test_late_fee_values_${i}`, [Fn('late_fee', [r.int(1, 300) * 100, r.int(0, 120)]), Fn('late_fee', [r.int(1, 300) * 100, r.int(0, 120)], { grace_days: r.int(0, 20) }),
        Fn('dunning_stage', [r.int(0, 80)]),
        Fn('late_fee_report', [p.customers.map(c => [c, r.int(0, 300) * 100, r.int(0, 60)]), r.int(30, 120)])]);
    },
  },

  render(p, { m, d, inc }) {
    const out = [];
    out.push(`"""${p.mod}: invoice arithmetic for ${p.company}.

All money values are integer cents.  Rounding is "half up" on whole cents
(half a cent rounds away from zero) and is applied once per computed amount.
Billing periods are counted in whole days.
"""


def round_half_up(numerator, denominator):
    """numerator / denominator rounded to an integer, halves away from zero.

    denominator must be positive.  round_half_up(5, 2) == 3 and
    round_half_up(-5, 2) == -3.
    """
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    sign = -1 if numerator < 0 else 1
    quotient, remainder = divmod(abs(numerator), denominator)
${d('half_cmp', 4)}    if 2 * remainder ${m('half_cmp', '>=', '>')} denominator:
        quotient += 1
    return sign * quotient


def prorate(amount, days_used, days_in_period=${m('prorate_default', '30', '31')}):
    """Charge for days_used days of a period of days_in_period days (default
    30) that costs amount cents in full, rounded half up.

    days_used may be anything from 0 to the whole period inclusive; other
    values raise ValueError.
    """
    if days_in_period <= 0:
        raise ValueError("empty period")
    if days_used < 0 or days_used ${m('prorate_full', '>', '>=')} days_in_period:
        raise ValueError("days_used out of range")
    return round_half_up(amount * days_used, days_in_period)


def billable_days(start_day, end_day, period_start, period_end):
    """Days of service [start_day, end_day) that fall inside the billing
    period [period_start, period_end).  Never negative."""
    first = max(start_day, period_start)
    last = min(end_day, period_end)
    return ${m('days_neg', 'max(0, last - first)', 'last - first')}


def split_evenly(amount, parts):
    """Split amount cents into parts whole-cent shares that add up to amount
    and differ by at most one cent; the larger shares come first.  parts must
    be positive."""
    if parts <= 0:
        raise ValueError("parts must be positive")
    base, extra = divmod(amount, parts)
    return [base + 1] * extra + [base] * (parts - extra)


def format_cents(cents):
    """Format cents as a decimal amount with two places: 1205 -> "12.05",
    -7 -> "-0.07"."""
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(${m('fmt_neg', 'abs(cents)', 'cents')}, 100)
    return "%s%d.%02d" % (sign, whole, frac)


def period_charge(price, start_day, end_day, period_start, period_end):
    """Prorated charge for a service active on [start_day, end_day) within the
    billing period [period_start, period_end) whose full price is price."""
    used = billable_days(start_day, end_day, period_start, period_end)
    return prorate(price, ${m('charge_swap', 'used, period_end - period_start', 'period_end - period_start, used')})
`);
    if (inc('invoice')) out.push(`

class Invoice:
    """Invoice lines, tax and credit notes for one customer.

    Tax is tax_rate_bp basis points (hundredths of a percent, default ${p.taxbp})
    of the sum of the taxable line amounts, rounded half up once on that sum,
    never line by line.
    """

    def __init__(self, customer, tax_rate_bp=${p.taxbp}):
        self.customer = customer
        self.tax_rate_bp = tax_rate_bp
        self.lines = []
        self.credits = 0

    def add_line(self, description, quantity, unit_cents, taxable=${m('taxable_default', 'True', 'False')}, discount_pct=0):
        """Append a line and return its net amount in cents.

        net = quantity * unit_cents minus discount_pct percent of that amount
        (the discount is rounded half up).  Lines are taxable unless
        taxable=False is passed.  quantity must be at least 1.
        """
        if quantity ${m('qty_zero', '<=', '<')} 0:
            raise ValueError("quantity must be at least 1")
        gross = quantity * unit_cents
        discount = round_half_up(${m('disc_swap', 'gross * discount_pct, 100', 'gross * 100, discount_pct')})
        net = gross - discount
        self.lines.append([description, net, taxable])
        return net

    def subtotal(self):
        """Sum of the line amounts."""
        return sum(net for _, net, _ in self.lines)

    def tax(self):
        """Tax on the taxable lines (see the class docstring)."""
        taxable = sum(net for _, net, is_taxable in self.lines if is_taxable)
        return round_half_up(taxable * self.tax_rate_bp, 10000)

    def total(self):
        """Subtotal plus tax, before credits."""
        return self.subtotal() + self.tax()

    def apply_credit(self, cents):
        """Record a credit note of cents (must be positive); return amount_due()."""
        if cents <= 0:
            raise ValueError("credit must be positive")
        self.credits += cents
        return self.amount_due()

    def summary(self):
        """Printable totals: {"customer", "lines", "subtotal", "tax", "total",
        "credits", "due"} with the money fields formatted by format_cents()."""
        return {
            "customer": self.customer,
            "lines": len(self.lines),
            "subtotal": format_cents(self.subtotal()),
            "tax": format_cents(self.tax()),
            "total": format_cents(self.total()),
            "credits": format_cents(self.credits),
            "due": format_cents(self.amount_due()),
        }

    def amount_due(self):
        """Total minus credits, but never below zero: excess credit is kept on
        account, it is not paid out."""
${d('credit_floor', 8)}        return ${m('credit_floor', 'max(0, self.total() - self.credits)', 'self.total() - self.credits')}
`);
    if (inc('planchange')) out.push(`

def plan_change(old_price, new_price, period_days, change_day):
    """Credit and charge for switching plans part-way through a period.

    The period has days 0 .. period_days - 1 and the new plan applies from the
    start of change_day, so the old plan was used for change_day days.  The
    unused part of the old plan is credited and the remaining part of the new
    plan is charged, each prorated separately.  change_day may be 0 (switch
    before the period starts) up to period_days (switch at its very end).
    Returns {"credit": credit, "charge": charge, "net": charge - credit}.
    """
    if not 0 <= change_day ${m('change_range', '<=', '<')} period_days:
        raise ValueError("change_day out of range")
    remaining = ${m('remaining_off', 'period_days - change_day', 'period_days - change_day - 1')}
    credit = prorate(${m('plan_swap', 'old_price', 'new_price')}, remaining, period_days)
    charge = prorate(${m('plan_swap', 'new_price', 'old_price')}, remaining, period_days)
    return {"credit": credit, "charge": charge, "net": charge - credit}


def monthly_equivalent(annual_price, months=12):
    """Monthly price of a prepaid plan covering months months, rounded half up."""
    return round_half_up(annual_price, months)


def proration_table(price, period_days, step_days):
    """[[day, charge], ...] for a plan started on day = 0, step_days,
    2 * step_days, ... up to and including period_days, where charge is the
    prorated price of the days left in the period."""
    return [[day, prorate(price, period_days - day, period_days)] for day in range(0, ${m('table_end', 'period_days + 1', 'period_days')}, step_days)]


def upgrade_quote(prices, current_plan, target_plan, period_days, change_day):
    """plan_change() for plans named in prices (plan name -> full price).

    Unknown plan names raise KeyError.  Staying on the same plan is free:
    {"credit": 0, "charge": 0, "net": 0}.
    """
    old_price = prices[current_plan]
    new_price = prices[target_plan]
    if current_plan == target_plan:
        return {"credit": 0, "charge": 0, "net": 0}
    return plan_change(old_price, new_price, period_days, change_day)
`);
    if (inc('allocation')) out.push(`

def allocate_payment(payment, open_invoices):
    """Apply a payment to open invoices, oldest due day first.

    open_invoices is a list of [invoice_id, due_day, amount_due].  Ties on due
    day go to the lower invoice id.  Invoices with nothing due (0 or less) are
    skipped.  Returns {"applied": [[invoice_id, cents], ...], "unapplied":
    cents}; invoices that receive nothing are not listed.
    """
    remaining = payment
    applied = []
    for invoice_id, due_day, amount_due in sorted(open_invoices, key=lambda row: (${m('alloc_order', 'row[1], row[0]', 'row[0], row[1]')})):
        if remaining <= 0:
            break
${d('alloc_zero', 8)}${m('alloc_zero', `        if amount_due <= 0:
            continue
`, '')}        take = min(${m('alloc_stale', 'remaining', 'payment')}, amount_due)
        applied.append([invoice_id, take])
        remaining -= take
    return {"applied": applied, "unapplied": remaining}


def aging_buckets(open_invoices, today, limits=(30, 60, 90)):
    """Total amount due per age bucket, as a dict.

    open_invoices holds [invoice_id, due_day, amount_due] rows; age is
    today - due_day.  Invoices that are not overdue (age <= 0) are "current".
    With the default limits the other keys are "1-30", "31-60", "61-90" and
    "over 90": an invoice exactly 30 days overdue is in "1-30".  Every key is
    present, even when its total is 0.
    """
    labels = ["current"]
    lower = 1
    for upper in limits:
        labels.append("%d-%d" % (lower, upper))
        lower = upper + 1
    labels.append("over %d" % limits[-1])
    totals = dict.fromkeys(labels, 0)
    for _, due_day, amount_due in open_invoices:
        age = today - due_day
        label = labels[-1]
        if age <= 0:
            label = "current"
        else:
            for i, upper in enumerate(limits):
                if age ${m('aging_edge', '<=', '<')} upper:
                    label = labels[i + 1]
                    break
        totals[label] += amount_due
    return totals


def statement_balance(invoices, payments):
    """Outstanding balance per customer.

    invoices and payments are lists of [customer, cents].  Returns sorted
    [[customer, balance], ...] for customers whose balance is not zero; a
    negative balance means the customer is in credit.
    """
    balances = {}
    for customer, cents in invoices:
        balances[customer] = balances.get(customer, 0) + cents
    for customer, cents in payments:
        balances[customer] = balances.get(customer, 0) - cents
    return sorted([customer, balance] for customer, balance in balances.items() if balance != 0)
`);
    if (inc('latefees')) out.push(`

def late_fee(balance, days_late, grace_days=${m('grace_default', String(p.grace), String(p.grace + 3))}, monthly_rate_bp=${p.ratebp}, cap=${p.cap}):
    """Late fee in cents for an overdue balance.

    No fee while days_late <= grace_days (default ${p.grace}) or when the balance
    is zero or negative.  Otherwise the fee is monthly_rate_bp basis points of
    the balance for every started 30-day block of lateness counted from the
    due date (30 days late is one block, 31 days is two), rounded half up and
    capped at cap cents.
    """
    if balance <= 0 or days_late ${m('grace_cmp', '<=', '<')} grace_days:
        return 0
${d('blocks_off', 4)}    blocks = ${m('blocks_off', '-(-days_late // 30)', 'days_late // 30 + 1')}
    fee = round_half_up(balance * monthly_rate_bp * blocks, 10000)
    return ${m('fee_cap', 'min(fee, cap)', 'fee')}


def late_fee_report(accounts, today):
    """[[account, days_late, fee], ...] for the accounts that owe a late fee
    today under the default late_fee() terms; accounts is a list of [account,
    balance, due_day].  Largest fee first, ties by account."""
    rows = []
    for account, balance, due_day in accounts:
        days_late = today - due_day
        fee = late_fee(balance, days_late)
        if fee > 0:
            rows.append([account, days_late, fee])
    rows.sort(key=lambda row: (-row[2], row[0]))
    return rows


DUNNING_STAGES = ((1, "reminder"), (15, "final notice"), (45, "collections"))


def dunning_stage(days_late, stages=DUNNING_STAGES):
    """Name of the dunning stage for days_late: the last stage whose start day
    is <= days_late, or "current" when days_late is before the first stage."""
    name = "current"
    for start, label in stages:
        if days_late ${m('stage_cmp', '>=', '>')} start:
            name = label
    return name
`);
    return out.join('');
  },

  notes(p, inc) {
    const out = [`# ${p.mod} design notes

${p.mod} holds the money arithmetic for ${p.company}'s billing. It never touches a database; callers pass
plain integers (cents, day numbers).

## Rounding and proration
- Every computed amount is rounded once, half up (away from zero) on whole cents. Not banker's rounding:
  finance signed this off for the whole product line.
- prorate() covers 0 days up to the full period, inclusive. The default period is 30 days.
- Service outside the billing period contributes 0 days, never a negative number.
- Negative amounts print with a single leading minus sign ("-12.05").`];
    if (inc('invoice')) out.push(`
## Invoices
- Lines are taxable unless marked otherwise; tax is computed once on the taxable sum (default rate
  ${p.taxbp} basis points).
- Quantities start at 1. Discounts are a whole percentage of the line's gross amount.
- Credit notes reduce the amount due but never below zero; any excess stays on the account.`);
    if (inc('planchange')) out.push(`
## Plan changes
- A change on day d means the old plan was used for d days and the new plan applies for the remaining
  period_days - d days. d = period_days is valid (switch at the end of the period).
- The old plan's unused part is credited, the new plan's remaining part charged.
- Proration tables run from day 0 up to and including the last day of the period.`);
    if (inc('allocation')) out.push(`
## Payments
- Payments go to the invoice with the earliest due day first (lower invoice id on ties).
- Invoices with nothing due are skipped and not listed; nothing is ever applied beyond the payment.
- Aging buckets are inclusive at their upper limit (30 days overdue is "1-30").`);
    if (inc('latefees')) out.push(`
## Late fees
- No fee up to and including the last grace day (default ${p.grace} days).
- Fees accrue per started 30-day block and are capped (default cap ${p.cap} cents).
- Dunning stages start on their listed day (day 1 reminder, day 15 final notice, day 45 collections).`);
    return out.join('\n') + '\n';
  },
};
