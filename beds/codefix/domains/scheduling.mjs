// Domain: interval scheduling (fictional room/court booking library).
import { New, Call, Fn, Get, Ref, Case } from './dsl.mjs';

const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default {
  id: 'scheduling',
  domain: 'interval scheduling',
  params(r) {
    const open = r.pick([420, 450, 480, 510, 540]);
    return {
      mod: r.pick(['slotbook', 'roomplanner', 'agenda_core', 'shiftgrid']),
      Cal: r.pick(['RoomCalendar', 'Agenda', 'BookingBook', 'Planner']),
      noun: r.pick(['room', 'bay', 'studio', 'court']),
      org: r.pick(['Lindqvist Clinic', 'Arbor Hall', 'Kestrel Coworking', 'Fennimore Library', 'Ossory Sports Club']),
      minlen: r.pick([15, 20, 30]),
      step: r.pick([15, 30]),
      open, close: open + r.pick([480, 540, 600, 660]),
      rooms: r.sample(['A', 'B', 'C', 'North', 'South', 'Annex'], 3),
    };
  },
  context: p => `We use ${p.mod} for ${p.noun} bookings at ${p.org}; the front desk tool calls it for every booking.`,
  sections: [
    { id: 'core', label: 'time parsing, overlap and merge helpers' },
    { id: 'gaps', label: 'free-slot search' },
    { id: 'calendar', label: 'booking calendar' },
    { id: 'recurring', label: 'weekly recurring bookings' },
    { id: 'stats', label: 'utilisation statistics' },
  ],

  sites: {
    parse_minutes: {
      section: 'core', op: 'off-by-one', fnKey: 'parse_hhmm', fn: () => 'parse_hhmm()',
      title: () => 'parse_hhmm() accepts minute value 60',
      symptom: [
        () => `A typo in the booking form ("10:60") was accepted by parse_hhmm() and turned into 11:00 instead of being rejected.`,
        () => `parse_hhmm() lets through times with 60 in the minutes field. They should be invalid.`,
      ],
      killers: (p, r) => { const h = r.int(7, 20); return [Case('test_parse_rejects_minute_sixty', [Fn('parse_hhmm', [`${h}:60`]), Fn('parse_hhmm', [`${h}:59`]), Fn('parse_hhmm', [` ${h}:05 `])])]; },
    },
    parse_2400: {
      section: 'core', op: 'wrong-comparator', fnKey: 'parse_hhmm', fn: () => 'parse_hhmm()',
      title: () => 'parse_hhmm() rejects "24:00"',
      symptom: [
        () => `Closing time "24:00" is rejected by parse_hhmm() with ValueError, although the docstring says end-of-day 24:00 is allowed.`,
      ],
      herring: [
        () => `parse_hhmm() accepts "24:00". That is not a real clock time; it should be rejected like "24:01" is.`,
      ],
      killers: () => [Case('test_parse_end_of_day', [Fn('parse_hhmm', ['24:00']), Fn('parse_hhmm', ['24:01']), Fn('parse_hhmm', ['0:00'])])],
    },
    overlap_touch: {
      section: 'core', op: 'wrong-comparator', fnKey: 'overlaps', fn: () => 'overlaps()',
      title: () => 'overlaps() treats back-to-back slots as overlapping',
      symptom: [
        p => `overlaps() says a 09:00-10:00 slot and a 10:00-11:00 slot overlap, so our conflict checker refuses back-to-back ${p.noun} bookings.`,
        () => `Adjacent intervals are reported as overlapping. Intervals are supposed to be half-open.`,
      ],
      herring: [
        () => `overlaps([540, 600], [600, 660]) returns False, but both slots contain 10:00, so they clearly touch. I would call that an overlap.`,
      ],
      decoy: () => 'FIXME: touching intervals share the boundary minute; should these be <= ?',
      killers: (p, r) => { const a = r.int(8, 15) * 60; const m = a + r.pick([30, 45, 60]); const e = m + r.pick([15, 30, 60]);
        return [Case('test_back_to_back_do_not_overlap', [Fn('overlaps', [[a, m], [m, e]]), Fn('overlaps', [[m, e], [a, m]]), Fn('overlaps', [[a, m + 1], [m, e]])])]; },
    },
    merge_touch: {
      section: 'core', op: 'off-by-one', fnKey: 'merge', fn: () => 'merge()',
      title: () => 'merge() keeps touching intervals apart',
      symptom: [
        () => `merge() returns two blocks for 09:00-10:00 and 10:00-11:00 instead of one 09:00-11:00 block, so our busy-time display shows a phantom break.`,
      ],
      herring: [
        () => `merge() glues back-to-back bookings into a single block. They are separate bookings with separate holders and I would like them to stay separate in the output.`,
      ],
      killers: (p, r) => { const a = r.int(8, 12) * 60; const b = a + r.pick([30, 60]); const c = b + r.pick([30, 45]); const d = c + r.int(10, 40);
        return [Case('test_merge_joins_touching', [Fn('merge', [[[b, c], [a, b], [d, d + 30]]]), Fn('total_busy', [[[a, b], [b, c]]])])]; },
    },
    merge_contained: {
      section: 'core', op: 'missing-edge-case', fnKey: 'merge', fn: () => 'merge()',
      title: () => 'merge() shortens a block that contains another interval',
      symptom: [
        () => `If one booking lies completely inside another, merge() cuts the outer block short at the end of the inner one. total_busy() then under-reports.`,
        () => `merge([[480, 720], [540, 600]]) gives a block that ends at 10:00 instead of 12:00.`,
      ],
      decoy: () => 'TODO(perf): the list is sorted, so the max() below should be redundant',
      killers: (p, r) => { const a = r.int(8, 10) * 60; const e = a + r.pick([180, 240]); const b = a + 30; const c = b + 60;
        return [Case('test_merge_contained_interval', [Fn('merge', [[[a, e], [b, c]]]), Fn('total_busy', [[[b, c], [a, e], [e + 10, e + 40]]])])]; },
    },
    gap_cmp: {
      section: 'gaps', op: 'wrong-comparator', fnKey: 'free_slots', fn: () => 'free_slots()',
      title: () => 'free_slots() skips gaps of exactly the minimum length',
      symptom: [
        p => `A gap of exactly ${p.minlen} minutes between two bookings never shows up in free_slots(), although ${p.minlen} is the minimum length we ask for.`,
      ],
      herring: [
        p => `free_slots() offers gaps that are exactly min_length (${p.minlen} min) long. People need a minute to change over, so only strictly longer gaps should be offered.`,
      ],
      killers: (p, r) => { const s = p.open; const b1 = s + r.int(1, 3) * 30; const L = r.pick([15, 20, 25]);
        return [Case('test_free_slots_exact_length_gap', [Fn('free_slots', [[[s, b1], [b1 + L, p.close]], s, p.close], { min_length: L }),
          Fn('free_slots', [[[s, b1], [b1 + L, p.close]], s, p.close], { min_length: L + 1 })])]; },
    },
    gap_tail: {
      section: 'gaps', op: 'missing-edge-case', fnKey: 'free_slots', fn: () => 'free_slots()',
      title: () => 'free_slots() never offers the end of the day',
      symptom: [
        () => `free_slots() never returns the gap between the last booking and closing time. Afternoons look fully booked when they are empty.`,
      ],
      decoy: () => 'NOTE: the trailing check below duplicates the loop logic; candidate for removal',
      killers: (p, r) => { const s = p.open; const b = s + r.int(2, 4) * 30;
        return [Case('test_free_slots_includes_tail', [Fn('free_slots', [[[s, b]], s, p.close]), Fn('free_slots', [[], s, s + 90], { min_length: 30 })])]; },
    },
    gap_default: {
      section: 'gaps', op: 'wrong-default', fnKey: 'free_slots', fn: () => 'free_slots()',
      title: () => 'free_slots() default minimum gap is wrong',
      symptom: [
        p => `Without min_length, free_slots() drops gaps of ${p.minlen + 5} minutes, even though the documented default minimum is ${p.minlen}.`,
      ],
      killers: (p, r) => { const s = p.open; const b = s + 60; const g = p.minlen + 5;
        return [Case('test_free_slots_default_min_length', [Fn('free_slots', [[[s, b], [b + g, p.close - 60]], s, p.close])])]; },
    },
    gap_swap: {
      section: 'gaps', op: 'swapped-arguments', fnKey: 'free_slots', fn: () => 'free_slots()',
      title: () => 'free_slots() returns inverted intervals',
      symptom: [
        () => `Some intervals returned by free_slots() have start after end (negative length). It happens for the gaps before a booking, not for the gap at the end of the day.`,
      ],
      killers: (p, r) => { const s = p.open; const b = s + r.int(1, 3) * 60;
        return [Case('test_free_slots_leading_gap', [Fn('free_slots', [[[b, b + 60]], s, b + 60], { min_length: 15 }), Fn('first_fit', [[[b, b + 60]], 45, s, p.close])])]; },
    },
    cand_end: {
      section: 'gaps', op: 'off-by-one', fnKey: 'candidate_starts', fn: () => 'candidate_starts()',
      title: () => 'candidate_starts() never offers the last possible start',
      symptom: [
        () => `candidate_starts() does not offer a start time where the meeting would end exactly when the free gap ends, e.g. 11:00 for a 60-minute meeting in an 11:00-12:00 gap.`,
      ],
      killers: (p, r) => { const s = p.open; const b = s + 2 * p.step; const e = b + 4 * p.step;
        return [Case('test_candidate_starts_fill_gap_exactly', [Fn('candidate_starts', [[[s, b], [e, p.close]], 2 * p.step, s, p.close], { step: p.step }),
          Fn('free_minutes', [[[s, b], [e, p.close]], s, p.close])])]; },
    },
    cal_first_id: {
      section: 'calendar', op: 'off-by-one', fnKey: 'Calendar.__init__', fn: p => `${p.Cal}.book()`,
      title: p => `${p.Cal} booking ids start at 0`,
      symptom: [
        p => `The first booking in a fresh ${p.Cal} gets id 0. Our front end treats 0 as "no booking", so the first booking of the day cannot be cancelled from the UI.`,
      ],
      killers: (p, r) => [Case('test_booking_ids_start_at_one', [New('cal', p.Cal, [p.rooms]), Call('cal', 'book', [p.rooms[0], p.open, p.open + 60, 'Ada']),
        Call('cal', 'book', [p.rooms[1], p.open, p.open + 30, 'Bo']), Call('cal', 'schedule', [p.rooms[0]])])],
    },
    cal_empty: {
      section: 'calendar', op: 'wrong-comparator', fnKey: 'Calendar.book', fn: p => `${p.Cal}.book()`,
      title: () => 'Zero-length bookings are accepted',
      symptom: [
        p => `${p.Cal}.book() accepts a booking whose start equals its end. It then shows up as a 0-minute entry in the schedule.`,
      ],
      herring: [
        () => `book() refuses bookings with start == end. We use zero-length entries as "hold" markers, so they should be allowed.`,
      ],
      killers: (p, r) => { const s = p.open + r.int(1, 6) * 30;
        return [Case('test_zero_length_booking_rejected', [New('cal', p.Cal, [p.rooms]), Call('cal', 'book', [p.rooms[0], s, s, 'Ada']),
          Call('cal', 'book', [p.rooms[0], s, s - 30, 'Ada']), Call('cal', 'schedule', [p.rooms[0]])])]; },
    },
    cal_room: {
      section: 'calendar', op: 'missing-edge-case', fnKey: 'Calendar.book', fn: p => `${p.Cal}.book()`,
      title: p => `Bookings in different ${p.noun}s conflict with each other`,
      symptom: [
        p => `Booking ${p.noun} ${p.rooms[1]} at 10:00 fails with BookingConflict because ${p.noun} ${p.rooms[0]} is booked at 10:00. Different ${p.noun}s should be independent.`,
      ],
      killers: (p, r) => { const s = p.open + r.int(1, 4) * 60;
        return [Case('test_rooms_are_independent', [New('cal', p.Cal, [p.rooms]), Call('cal', 'book', [p.rooms[0], s, s + 60, 'Ada']),
          Call('cal', 'book', [p.rooms[1], s, s + 60, 'Bo']), Call('cal', 'book', [p.rooms[0], s + 30, s + 90, 'Cy']), Call('cal', 'schedule', [p.rooms[1]])])]; },
    },
    resched_id: {
      section: 'calendar', op: 'stale-variable', fnKey: 'Calendar.reschedule', fn: p => `${p.Cal}.reschedule()`,
      title: () => 'reschedule() changes the booking id',
      symptom: [
        p => `After reschedule(), schedule() lists the booking under a different id than the one we moved, and the next new booking gets a duplicate id.`,
      ],
      killers: (p, r) => { const s = p.open + 60;
        return [Case('test_reschedule_keeps_id', [New('cal', p.Cal, [p.rooms]), Call('cal', 'book', [p.rooms[0], s, s + 60, 'Ada']),
          Call('cal', 'book', [p.rooms[0], s + 60, s + 120, 'Bo']), Call('cal', 'reschedule', [1, s + 180, s + 240]),
          Call('cal', 'book', [p.rooms[0], s, s + 30, 'Cy']), Call('cal', 'schedule', [p.rooms[0]])])]; },
    },
    wd_case: {
      section: 'recurring', op: 'missing-edge-case', fnKey: 'expand_weekly', fn: () => 'expand_weekly()',
      title: () => 'expand_weekly() rejects capitalised weekday names',
      symptom: [
        () => `expand_weekly() raises ValueError for weekday names like "Mon" or "THU" coming from the web form. Lower-case names work.`,
      ],
      killers: (p, r) => [Case('test_weekday_names_case_insensitive', [Fn('expand_weekly', [0, 2, ['Mon', 'thu'], p.open, p.open + 60]), Fn('expand_weekly', [7, 1, ['FRI'], p.open, p.open + 30])])],
    },
    weeks_off: {
      section: 'recurring', op: 'off-by-one', fnKey: 'expand_weekly', fn: () => 'expand_weekly()',
      title: () => 'expand_weekly() drops the last week',
      symptom: [
        () => `A recurring booking for 4 weeks only produces 3 weeks of occurrences.`,
        () => `The final week of every recurring series is missing from expand_weekly().`,
      ],
      decoy: () => 'TODO: the UI counts weeks from 1 -- check whether this range is off by one',
      killers: (p, r) => { const w = r.int(2, 4);
        return [Case('test_expand_weekly_all_weeks', [Fn('expand_weekly', [r.int(0, 2), w, ['wed'], p.open, p.open + 45]), Fn('weekly_minutes', [[[3, 60, 120], [10, 60, 90], [12, 0, 30]]])])]; },
    },
    first_cmp: {
      section: 'recurring', op: 'wrong-comparator', fnKey: 'expand_weekly', fn: () => 'expand_weekly()',
      title: () => 'expand_weekly() skips the first day itself',
      symptom: [
        () => `When a series starts on one of its own weekdays, that first day is missing; it starts a week later.`,
      ],
      herring: [
        () => `expand_weekly() includes first_day itself in the series. A series created today should start with the next occurrence, not today.`,
      ],
      killers: (p, r) => { const wk = r.int(0, 3);
        return [Case('test_series_includes_first_day', [Fn('expand_weekly', [7 * wk + 1, 2, ['tue', 'sat'], p.open, p.open + 60], { skip_days: [7 * wk + 12] })])]; },
    },
    idle_stale: {
      section: 'stats', op: 'stale-variable', fnKey: 'longest_idle', fn: () => 'longest_idle()',
      title: () => 'longest_idle() overstates idle time',
      symptom: [
        () => `longest_idle() reports idle stretches longer than the gaps that actually exist; it seems to measure from the start of the day every time.`,
      ],
      killers: (p, r) => { const s = p.open; const b1 = s + 60; const b2 = b1 + 30 + r.int(1, 4) * 30;
        return [Case('test_longest_idle_between_bookings', [Fn('longest_idle', [[[b1, b1 + 30], [b2, b2 + 30]], s, b2 + 60])])]; },
    },
    peak_order: {
      section: 'stats', op: 'wrong-comparator', fnKey: 'peak_concurrency', fn: () => 'peak_concurrency()',
      title: () => 'peak_concurrency() counts back-to-back bookings as simultaneous',
      symptom: [
        () => `peak_concurrency() returns 2 for two back-to-back bookings (09:00-10:00, 10:00-11:00) that never overlap.`,
      ],
      herring: [
        () => `peak_concurrency() returns 1 for meetings 09:00-10:00 and 10:00-11:00, but at 10:00 both groups are in the room during the changeover. It should say 2.`,
      ],
      decoy: () => 'FIXME(review): process starts before ends at the same minute?',
      killers: (p, r) => { const a = p.open + 60; const b = a + 60; const c = b + 60;
        return [Case('test_peak_ignores_touching', [Fn('peak_concurrency', [[[a, b], [b, c], [c, c + 30]]]), Fn('peak_concurrency', [[[a, c], [b, c], [b - 1, b + 1]]])])]; },
    },
    util_clip: {
      section: 'stats', op: 'swapped-arguments', fnKey: 'utilization', fn: () => 'utilization()',
      title: () => 'utilization() reports 0% for booked rooms',
      symptom: [
        p => `utilization() returns 0.0 for every ${p.noun}, including ${p.noun}s that are booked most of the day.`,
        () => `The utilisation report is all zeros since the upgrade. total_busy() on the same bookings gives sensible numbers.`,
      ],
      killers: (p, r) => { const s = p.open; const e = s + 240;
        return [Case('test_utilization_clips_to_window', [Fn('utilization', [{ [p.rooms[0]]: [[s - 60, s + 60]], [p.rooms[1]]: [[s + 30, s + 90], [e - 30, e + 30]] }, s, e])])]; },
    },
  },

  randoms: {
    core(p, r, i) {
      const ivs = Array.from({ length: r.int(3, 6) }, () => { const a = p.open + r.int(0, 16) * 15; return [a, a + r.int(1, 8) * 15]; });
      return Case(`test_interval_helpers_${i}`, [Fn('parse_hhmm', [hhmm(r.int(0, 1439))]), Fn('format_hhmm', [r.int(0, 1440)]),
        Fn('merge', [ivs]), Fn('total_busy', [ivs]), Fn('overlaps', [ivs[0], ivs[1]])]);
    },
    gaps(p, r, i) {
      const ivs = Array.from({ length: r.int(2, 4) }, () => { const a = p.open + r.int(0, 20) * 15; return [a, a + r.int(1, 6) * 15]; });
      return Case(`test_free_slot_search_${i}`, [Fn('free_slots', [ivs, p.open, p.close], { min_length: r.pick([10, 15, 30, 45]) }),
        Fn('first_fit', [ivs, r.pick([30, 60, 90]), p.open, p.close]), Fn('free_minutes', [ivs, p.open, p.close]),
        Fn('candidate_starts', [ivs, r.pick([30, 45, 60]), p.open, p.close])]);
    },
    calendar(p, r, i) {
      const steps = [New('cal', p.Cal, [p.rooms])];
      for (let k = 0; k < 5; k++) { const a = p.open + r.int(0, 10) * 30; steps.push(Call('cal', 'book', [r.pick(p.rooms), a, a + r.int(1, 4) * 30, r.pick(['Ada', 'Bo', 'Cy', 'Dee'])])); }
      steps.push(Call('cal', 'cancel', [r.int(1, 3)]), Call('cal', 'schedule', [p.rooms[0]]), Call('cal', 'schedule', [p.rooms[1]]));
      return Case(`test_calendar_sequence_${i}`, steps);
    },
    recurring(p, r, i) {
      const rows = Fn('expand_weekly', [r.int(0, 10), r.int(1, 3), r.sample(['mon', 'tue', 'wed', 'thu', 'fri'], 2), p.open, p.open + 60], { skip_days: [r.int(0, 20)] });
      const series = [[2, p.open, p.open + 60], [9, p.open, p.open + 60], [16, p.open + 30, p.open + 90]];
      return Case(`test_recurring_series_${i}`, [rows, Fn('weekly_minutes', [[[r.int(0, 6), 60, 90], [r.int(7, 13), 0, 45]]]),
        Fn('next_occurrence', [series, r.int(0, 17)]), Fn('series_conflicts', [series, [[9, p.open + r.int(0, 3) * 30, p.open + 120], [16, p.open, p.open + 30]]])]);
    },
    stats(p, r, i) {
      const ivs = Array.from({ length: r.int(2, 5) }, () => { const a = p.open + r.int(0, 16) * 15; return [a, a + r.int(1, 8) * 15]; });
      return Case(`test_statistics_${i}`, [Fn('longest_idle', [ivs, p.open, p.close]), Fn('peak_concurrency', [ivs]),
        Fn('utilization', [{ [p.rooms[0]]: ivs }, p.open, p.close]), Fn('busiest_room', [{ [p.rooms[0]]: ivs, [p.rooms[1]]: ivs.slice(1) }, p.open, p.close])]);
    },
  },

  render(p, { m, d, inc }) {
    const out = [];
    out.push(`"""${p.mod}: interval arithmetic for ${p.noun} bookings at ${p.org}.

Times are minutes after midnight (0..1440).  Intervals are half-open: [start,
end) contains start but not end, so 09:00-10:00 and 10:00-11:00 do not
overlap.  Functions that take intervals also accept [start, end] pairs.
"""
from dataclasses import dataclass


@dataclass(frozen=True, order=True)
class Interval:
    """A half-open time range [start, end) in minutes."""

    start: int
    end: int

    @property
    def length(self):
        """Duration in minutes."""
        return self.end - self.start


def _iv(value):
    """Accept an Interval or a [start, end] pair."""
    if isinstance(value, Interval):
        return value
    start, end = value
    return Interval(start, end)


def parse_hhmm(text):
    """Parse "HH:MM" (24-hour clock, one or two hour digits) into minutes.

    Surrounding whitespace is ignored.  Minutes must be two digits in 00..59.
    "24:00" (end of day) is allowed but nothing later.  Anything else raises
    ValueError.
    """
    hours, sep, minutes = text.strip().partition(":")
    if not sep or not hours.isdigit() or not minutes.isdigit() or len(minutes) != 2:
        raise ValueError("bad time: %r" % text)
    total_hours, mins = int(hours), int(minutes)
    if not 0 <= mins ${m('parse_minutes', '<', '<=')} 60:
        raise ValueError("bad time: %r" % text)
    total = total_hours * 60 + mins
    if total ${m('parse_2400', '>', '>=')} 24 * 60:
        raise ValueError("bad time: %r" % text)
    return total


def format_hhmm(minutes):
    """Format minutes after midnight as a zero-padded "HH:MM" string."""
    hours, mins = divmod(minutes, 60)
    return "%02d:%02d" % (hours, mins)


def overlaps(a, b):
    """True when intervals a and b share at least one minute.

    Touching intervals (a.end == b.start) do not overlap.
    """
    a, b = _iv(a), _iv(b)
${d('overlap_touch', 4)}    return a.start ${m('overlap_touch', '<', '<=')} b.end and b.start ${m('overlap_touch', '<', '<=')} a.end


def merge(intervals):
    """Merge overlapping or touching intervals into sorted, disjoint blocks.

    Touching intervals are joined: [09:00, 10:00) and [10:00, 11:00) become
    [09:00, 11:00).  An interval inside another one disappears into it.
    """
    blocks = []
    for iv in sorted(_iv(x) for x in intervals):
        if blocks and iv.start ${m('merge_touch', '<=', '<')} blocks[-1].end:
            last = blocks[-1]
${d('merge_contained', 12)}            blocks[-1] = Interval(last.start, ${m('merge_contained', 'max(last.end, iv.end)', 'iv.end')})
        else:
            blocks.append(iv)
    return blocks


def total_busy(intervals):
    """Minutes covered by at least one interval (overlaps counted once)."""
    return sum(block.length for block in merge(intervals))
`);
    if (inc('gaps')) out.push(`

def free_slots(busy, day_start, day_end, min_length=${m('gap_default', String(p.minlen), String(p.minlen + 15))}):
    """Free gaps of at least min_length minutes inside [day_start, day_end).

    busy may contain overlapping intervals and intervals that stick out of the
    day window; only the part inside the window matters.  A gap exactly
    min_length long is returned.  min_length defaults to ${p.minlen}.  Returns a
    sorted list of Interval.
    """
    gaps = []
    cursor = day_start
    for block in merge(busy):
        if block.end <= day_start or block.start >= day_end:
            continue
        if block.start - cursor ${m('gap_cmp', '>=', '>')} min_length:
            gaps.append(Interval(${m('gap_swap', 'cursor, block.start', 'block.start, cursor')}))
        cursor = max(cursor, block.end)
${d('gap_tail', 4)}${m('gap_tail', `    if day_end - cursor >= min_length:
        gaps.append(Interval(cursor, day_end))
`, '')}    return gaps


def free_minutes(busy, day_start, day_end):
    """Total free minutes inside [day_start, day_end), whatever the gap sizes."""
    return sum(gap.length for gap in free_slots(busy, day_start, day_end, min_length=1))


def candidate_starts(busy, length, day_start, day_end, step=${p.step}):
    """Start minutes at which a meeting of length minutes fits entirely into a
    free gap.  Starts lie on the grid day_start, day_start + step, ... (step
    defaults to ${p.step}); a meeting may end exactly when the gap ends."""
    starts = []
    for gap in free_slots(busy, day_start, day_end, min_length=length):
        first = day_start + -(-(gap.start - day_start) // step) * step
        starts.extend(range(first, ${m('cand_end', 'gap.end - length + 1', 'gap.end - length')}, step))
    return starts


def first_fit(busy, length, day_start, day_end):
    """The earliest Interval of exactly length minutes that fits into a free
    gap of [day_start, day_end), or None when nothing fits."""
    for gap in free_slots(busy, day_start, day_end, min_length=length):
        return Interval(gap.start, gap.start + length)
    return None
`);
    if (inc('calendar')) out.push(`

class BookingConflict(Exception):
    """Raised when a booking would overlap another booking of the same ${p.noun}."""


@dataclass
class Booking:
    """One confirmed booking."""

    booking_id: int
    room: str
    slot: Interval
    holder: str


class ${p.Cal}:
    """Bookings for several ${p.noun}s.

    Booking ids are issued 1, 2, 3, ... in booking order and are never reused,
    not even after a cancellation.
    """

    def __init__(self, rooms):
        self.rooms = set(rooms)
        self._bookings = {}
        self._next_id = ${m('cal_first_id', '1', '0')}

    def book(self, room, start, end, holder):
        """Book [start, end) in room for holder and return the new booking id.

        Raises KeyError for an unknown room, ValueError when end <= start and
        BookingConflict when the slot overlaps another booking of the same
        room.  Back-to-back bookings are fine.
        """
        if room not in self.rooms:
            raise KeyError(room)
        if end ${m('cal_empty', '<=', '<')} start:
            raise ValueError("empty or inverted slot")
        slot = Interval(start, end)
        for other in self._bookings.values():
            if ${m('cal_room', 'other.room == room and ', '')}overlaps(other.slot, slot):
                raise BookingConflict(other.booking_id)
        booking_id = self._next_id
        self._next_id += 1
        self._bookings[booking_id] = Booking(booking_id, room, slot, holder)
        return booking_id

    def cancel(self, booking_id):
        """Remove a booking and return it.  Unknown ids raise KeyError."""
        return self._bookings.pop(booking_id)

    def schedule(self, room):
        """Bookings of room as [booking_id, "HH:MM", "HH:MM", holder] rows,
        sorted by start time."""
        rows = []
        for b in sorted(self._bookings.values(), key=lambda b: (b.slot.start, b.booking_id)):
            if b.room == room:
                rows.append([b.booking_id, format_hhmm(b.slot.start), format_hhmm(b.slot.end), b.holder])
        return rows

    def reschedule(self, booking_id, start, end):
        """Move a booking to [start, end) in the same room, keeping its id.

        The booking never conflicts with its own old slot.  On any error the
        original booking is left untouched and the error propagates.  Returns
        the updated Booking.
        """
        old = self._bookings.pop(booking_id)
        try:
            temp_id = self.book(old.room, start, end, old.holder)
        except Exception:
            self._bookings[booking_id] = old
            raise
        moved = self._bookings.pop(temp_id)
        self._next_id = temp_id
        moved.booking_id = ${m('resched_id', 'booking_id', 'temp_id')}
        self._bookings[booking_id] = moved
        return moved
`);
    if (inc('recurring')) out.push(`

WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def expand_weekly(first_day, weeks, weekdays, start, end, skip_days=()):
    """Expand a weekly pattern into [day, start, end] rows sorted by day.

    Days are numbered from 0, which is a Monday.  The pattern covers weeks
    whole weeks, beginning with the week that contains first_day.  Days before
    first_day and days listed in skip_days are left out; first_day itself is
    included when it matches.  weekdays holds names such as "mon" or "Thu"
    (case-insensitive).
    """
    offsets = sorted(WEEKDAYS.index(${m('wd_case', 'name.lower()', 'name')}) for name in weekdays)
    week0 = first_day - first_day % 7
    rows = []
${d('weeks_off', 4)}    for week in range(${m('weeks_off', 'weeks', 'weeks - 1')}):
        for offset in offsets:
            day = week0 + 7 * week + offset
            if day ${m('first_cmp', '<', '<=')} first_day or day in skip_days:
                continue
            rows.append([day, start, end])
    return rows


def next_occurrence(rows, after_day):
    """The first [day, start, end] row whose day is strictly after after_day,
    or None.  rows must be sorted by day (as expand_weekly returns them)."""
    for row in rows:
        if row[0] > after_day:
            return row
    return None


def series_conflicts(rows, busy_rows):
    """Sorted days on which a [day, start, end] row of the series overlaps a
    [day, start, end] row of busy_rows."""
    days = set()
    for day, start, end in rows:
        for busy_day, busy_start, busy_end in busy_rows:
            if busy_day == day and overlaps([start, end], [busy_start, busy_end]):
                days.add(day)
    return sorted(days)


def weekly_minutes(rows):
    """Booked minutes per week index (day // 7) as sorted [week, minutes] pairs."""
    totals = {}
    for day, start, end in rows:
        totals[day // 7] = totals.get(day // 7, 0) + (end - start)
    return sorted([week, minutes] for week, minutes in totals.items())
`);
    if (inc('stats')) out.push(`

def _clip(iv, lo, hi):
    """Part of iv inside [lo, hi), or None when they do not intersect."""
    start, end = max(iv.start, lo), min(iv.end, hi)
    return Interval(start, end) if start < end else None


def utilization(bookings_by_room, day_start, day_end):
    """Percent of [day_start, day_end) during which each room is booked.

    bookings_by_room maps room -> list of intervals.  Parts of bookings outside
    the window are ignored.  Returns {room: percent} with percent rounded to
    one decimal place.
    """
    window = day_end - day_start
    report = {}
    for room, intervals in sorted(bookings_by_room.items()):
        pieces = (_clip(_iv(x), ${m('util_clip', 'day_start, day_end', 'day_end, day_start')}) for x in intervals)
        clipped = [piece for piece in pieces if piece is not None]
        report[room] = round(100.0 * total_busy(clipped) / window, 1)
    return report


def busiest_room(bookings_by_room, day_start, day_end):
    """[room, percent] for the room with the highest utilization() in the
    window (ties go to the alphabetically first room), or None without rooms."""
    report = utilization(bookings_by_room, day_start, day_end)
    if not report:
        return None
    room = min(report, key=lambda name: (-report[name], name))
    return [room, report[room]]


def longest_idle(intervals, day_start, day_end):
    """Length in minutes of the longest stretch of [day_start, day_end) that
    no interval covers."""
    best = 0
    prev_end = day_start
    for block in merge(intervals):
        start = max(block.start, day_start)
        if start > prev_end:
            best = max(best, start - prev_end)
${m('idle_stale', `        prev_end = max(prev_end, min(block.end, day_end))
`, '')}    return max(best, day_end - prev_end)


def peak_concurrency(intervals):
    """Largest number of intervals in progress at the same minute.

    Intervals are half-open, so one ending at 10:00 and another starting at
    10:00 are never in progress together.
    """
    events = []
    for iv in map(_iv, intervals):
        events.append((iv.start, 1))
        events.append((iv.end, -1))
${d('peak_order', 4)}    events.sort(${m('peak_order', '', 'key=lambda e: (e[0], -e[1])')})
    current = peak = 0
    for _, delta in events:
        current += delta
        peak = max(peak, current)
    return peak
`);
    return out.join('');
  },

  notes(p, inc) {
    const out = [`# ${p.mod} design notes

${p.mod} does the time arithmetic behind ${p.org}'s ${p.noun} booking desk. Everything is in whole minutes
after midnight; the UI converts to and from "HH:MM".

## Intervals
- Intervals are half-open [start, end). Back-to-back intervals never overlap, and a booking ending at
  10:00 frees the ${p.noun} for one starting at 10:00.
- merge() produces disjoint blocks; touching intervals are joined into one block, contained intervals
  are absorbed.
- parse_hhmm() accepts 0:00 through 24:00 inclusive; minutes must be 00-59.`];
    if (inc('gaps')) out.push(`
## Free slots
- free_slots() looks only inside the requested window and includes the gap after the last booking.
- A gap counts if it is at least min_length long (default ${p.minlen} minutes); exactly min_length is fine.
- Candidate starts sit on a ${p.step}-minute grid from the start of the window; a meeting may end exactly at the
  end of a gap.`);
    if (inc('calendar')) out.push(`
## Calendar
- Ids start at 1 and are never reused. Each ${p.noun} is booked independently of the others.
- Zero-length and inverted bookings are rejected.
- Rescheduling keeps the booking id and leaves the booking untouched if the new slot conflicts.`);
    if (inc('recurring')) out.push(`
## Recurring bookings
- Day 0 is a Monday. A series runs for the requested number of whole weeks, starting with the week that
  contains first_day, and includes first_day when it is one of the pattern's weekdays.
- Weekday names are case-insensitive.`);
    if (inc('stats')) out.push(`
## Statistics
- utilization() and longest_idle() only consider the part of each interval inside the window.
- peak_concurrency() treats a booking that ends at the minute another starts as not concurrent.`);
    return out.join('\n') + '\n';
  },
};
