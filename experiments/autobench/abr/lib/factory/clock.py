"""Pure clock engine shared by the factory families' generators (truth side only; references carry their own parsing).

Standard library only (zoneinfo), no wall clock, no AutomationBench import: the family generators, the oracle and the
property tests (Hypothesis 6.170.5 in the D16 factory venv) all import it. Holidays are a frozen table of ISO dates
carried in each family.spec (derived once from `holidays` 0.107 by tools/holiday_table.py and re-checked by a golden
test), so streams never depend on an installed package version.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
_ISO = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?\s*$", re.I)


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_instant(s, assume_utc: bool = True) -> datetime | None:
    """'2027-03-26T22:15:00Z', '2027-03-26 22:15 +01:00', '2027-03-26 22:15 UTC' -> aware UTC datetime; else None."""
    m = _ISO.match(str(s or ""))
    if not m:
        return None
    y, mo, d, hh, mm, ss, tz = m.groups()
    try:
        dt = datetime(int(y), int(mo), int(d), int(hh), int(mm), int(ss or 0))
    except ValueError:
        return None
    if tz is None:
        if not assume_utc:
            return None
        return dt.replace(tzinfo=UTC)
    tz = tz.upper()
    if tz in ("Z", "UTC", "GMT"):
        return dt.replace(tzinfo=UTC)
    sign = 1 if tz[0] == "+" else -1
    digits = tz[1:].replace(":", "")
    off = timedelta(hours=int(digits[:2]), minutes=int(digits[2:]))
    return (dt - sign * off).replace(tzinfo=UTC)


def local_to_utc(naive_local: datetime, tz: str) -> datetime:
    """A wall-clock time in `tz` (first occurrence when ambiguous; a nonexistent spring-forward time moves forward)."""
    z = ZoneInfo(tz)
    aware = naive_local.replace(tzinfo=z, fold=0)
    back = aware.astimezone(UTC).astimezone(z)
    if back.replace(tzinfo=None) != naive_local:          # spring-forward gap: the clock jumps, keep absolute time
        aware = (naive_local + timedelta(hours=1)).replace(tzinfo=z, fold=0)
    return aware.astimezone(UTC)


def render_local(dt_utc: datetime, tz: str) -> str:
    """'2027-03-26 22:15 +01:00' (the tracker's local style with an explicit offset)."""
    loc = dt_utc.astimezone(ZoneInfo(tz))
    off = loc.utcoffset()
    mins = int(off.total_seconds() // 60)
    sign = "+" if mins >= 0 else "-"
    mins = abs(mins)
    return f"{loc:%Y-%m-%d %H:%M} {sign}{mins // 60:02d}:{mins % 60:02d}"


def add_months_clipped(d: date, n: int) -> date:
    """Same day number n months later; if that month is shorter, its last day (Reg. 1182/71 Art. 3(2)(c) style)."""
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    last = (nxt - timedelta(days=1)).day
    return date(y, m, min(d.day, last))


def is_business_day(d: date, holidays: frozenset | set) -> bool:
    return d.weekday() < 5 and d.isoformat() not in holidays


def roll_forward(d: date, holidays) -> date:
    """d if it is a working day, else the next working day (Reg. 1182/71 Art. 3(4) style)."""
    while not is_business_day(d, holidays):
        d += timedelta(days=1)
    return d


def end_of_local_day(d: date, tz: str) -> datetime:
    """The instant a local calendar day expires (the next local midnight), in UTC."""
    return local_to_utc(datetime.combine(d + timedelta(days=1), time(0, 0)), tz)


def business_days(start: date, n_days: int, holidays) -> list[date]:
    """Working days among the n_days calendar days from start."""
    return [start + timedelta(days=k) for k in range(n_days) if is_business_day(start + timedelta(days=k), holidays)]


def check_times(start: date, n_days: int, hhmm: list[str], holidays) -> list[datetime]:
    """Scheduled checks: each working day at each HH:MM (UTC)."""
    out = []
    for d in business_days(start, n_days, holidays):
        for t in hhmm:
            h, m = map(int, t.split(":"))
            out.append(datetime(d.year, d.month, d.day, h, m, tzinfo=UTC))
    return out


def last_business_day_of_month(d: date, holidays) -> date:
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    x = nxt - timedelta(days=1)
    while not is_business_day(x, holidays):
        x -= timedelta(days=1)
    return x


def month_ends_in(days: list[date], holidays) -> list[date]:
    """The last working day of each month that falls among `days` (the month-end close days of a stream)."""
    return sorted({last_business_day_of_month(d, holidays) for d in days} & set(days))
