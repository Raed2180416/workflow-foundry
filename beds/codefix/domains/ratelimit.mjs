// Domain: rate limiting (fictional throttling library). Clock values are integer milliseconds.
import { New, Call, Fn, Get, Case } from './dsl.mjs';

export default {
  id: 'ratelimit',
  domain: 'rate limiting',
  params(r) {
    return {
      mod: r.pick(['throttle', 'ratekeeper', 'quota_guard', 'flowcap']),
      service: r.pick(['the Marlow public API', 'Quillfeather webhooks', 'the Tamsin SMS gateway', 'the Brockley image service']),
      win: r.pick([1000, 2000, 5000]),
      idle: r.pick([30000, 60000, 120000]),
      base: r.pick([100, 200, 250]),
      cap: r.pick([5000, 8000, 10000]),
      keys: r.sample(['acct-17', 'acct-42', 'acct-99', 'tenant-a', 'tenant-b', 'bot-7'], 3),
    };
  },
  context: p => `${p.mod} throttles every request to ${p.service}; the gateway calls it with its own millisecond clock.`,
  sections: [
    { id: 'core', label: 'token bucket' },
    { id: 'window', label: 'fixed-window counter' },
    { id: 'sliding', label: 'sliding-log limiter' },
    { id: 'keyed', label: 'per-client limiter registry' },
    { id: 'backoff', label: 'retry backoff and reporting' },
  ],

  sites: {
    clock_back: {
      section: 'core', op: 'missing-edge-case', fnKey: 'TokenBucket._refill', fn: () => 'TokenBucket.allow()',
      title: () => 'Clock going backwards drains the bucket',
      symptom: [
        () => `When a request arrives with a slightly older timestamp (our gateways' clocks differ by a few ms), the TokenBucket loses tokens, sometimes going below zero, and later requests are rejected for a long time.`,
      ],
      decoy: () => 'NOTE: the max() below is defensive only; production clocks are monotonic, safe to drop',
      killers: (p, r) => [Case('test_backwards_clock_is_ignored', [New('b', 'TokenBucket', [2, 3], { now_ms: 10000 }), Call('b', 'allow', [10000]),
        Call('b', 'tokens', [9000]), Call('b', 'allow', [9500]), Call('b', 'allow', [10000]), Call('b', 'tokens', [10000])])],
    },
    cap_missing: {
      section: 'core', op: 'missing-edge-case', fnKey: 'TokenBucket._refill', fn: () => 'TokenBucket.allow()',
      title: () => 'TokenBucket fills above its burst size',
      symptom: [
        () => `After a quiet period, a client can fire far more than burst requests in a row; tokens() reports values way above the burst size.`,
      ],
      killers: (p, r) => { const burst = r.int(2, 5); return [Case('test_bucket_capped_at_burst', [New('b', 'TokenBucket', [1, burst]), Call('b', 'tokens', [60000]),
        ...Array.from({ length: burst + 1 }, () => Call('b', 'allow', [60000]))])]; },
    },
    last_stale: {
      section: 'core', op: 'stale-variable', fnKey: 'TokenBucket._refill', fn: () => 'TokenBucket.allow()',
      title: () => 'TokenBucket refills the same interval again and again',
      symptom: [
        () => `A bucket seems to refill on every call: two calls at the same timestamp both get the refill for the time since the bucket was created, so clients get far more than the configured rate.`,
      ],
      killers: (p, r) => [Case('test_refill_counts_each_interval_once', [New('b', 'TokenBucket', [1, 3]), Call('b', 'allow', [0], { cost: 3 }), Call('b', 'allow', [1000]),
        Call('b', 'allow', [1000]), Call('b', 'tokens', [1500]), Call('b', 'tokens', [1500])])],
    },
    allow_cmp: {
      section: 'core', op: 'wrong-comparator', fnKey: 'TokenBucket.allow', fn: () => 'TokenBucket.allow()',
      title: () => 'The last token in the bucket can never be used',
      symptom: [
        () => `A TokenBucket with burst 3 only lets 2 requests through in a burst; the request that would take the last token is always rejected.`,
      ],
      herring: [
        () => `TokenBucket.allow() lets a request through when exactly the needed tokens are left, emptying the bucket completely. I would expect it to keep a small reserve and only allow when strictly more tokens are present.`,
      ],
      killers: (p, r) => { const burst = r.int(2, 4); return [Case('test_bucket_can_be_emptied', [New('b', 'TokenBucket', [1, burst]),
        ...Array.from({ length: burst + 1 }, () => Call('b', 'allow', [0])), Call('b', 'allow', [1000])])]; },
    },
    wait_round: {
      section: 'core', op: 'off-by-one', fnKey: 'TokenBucket.wait_ms', fn: () => 'TokenBucket.wait_ms()',
      title: () => 'wait_ms() tells clients to retry too early',
      symptom: [
        () => `Clients that sleep for exactly wait_ms() and retry are rejected again, because the answer is rounded down instead of up.`,
      ],
      killers: (p, r) => [Case('test_wait_ms_rounds_up', [New('b', 'TokenBucket', [3, 1]), Call('b', 'allow', [0]), Call('b', 'wait_ms', [0]),
        Call('b', 'wait_ms', [100]), Call('b', 'wait_ms', [100], { cost: 2 })])],
    },
    fw_cmp: {
      section: 'window', op: 'off-by-one', fnKey: 'FixedWindow.allow', fn: () => 'FixedWindow.allow()',
      title: () => 'FixedWindow allows one request too many',
      symptom: [
        () => `A FixedWindow with limit 5 lets 6 requests through in the same window.`,
      ],
      killers: (p, r) => { const lim = r.int(2, 4); return [Case('test_fixed_window_limit', [New('w', 'FixedWindow', [lim, 1000]),
        ...Array.from({ length: lim + 1 }, (_, k) => Call('w', 'allow', [100 + k])), Call('w', 'allow', [1000])])]; },
    },
    fw_reset: {
      section: 'window', op: 'missing-edge-case', fnKey: 'FixedWindow.reset_at', fn: () => 'FixedWindow.reset_at()',
      title: () => 'reset_at() returns the current time on window boundaries',
      symptom: [
        () => `For a request made exactly at the start of a window, reset_at() returns that same timestamp instead of the start of the next window, so our Retry-After header says 0.`,
      ],
      killers: (p, r) => [Case('test_reset_at_on_boundary', [New('w', 'FixedWindow', [3, 1000]), Call('w', 'reset_at', [5000]), Call('w', 'reset_at', [5001]), Call('w', 'reset_at', [0])])],
    },
    fw_default: {
      section: 'window', op: 'wrong-default', fnKey: 'FixedWindow.__init__', fn: () => 'FixedWindow()',
      title: () => 'FixedWindow default window length is wrong',
      symptom: [
        p => `FixedWindow(limit) without an explicit window_ms keeps counting across what should be separate ${p.win} ms windows.`,
      ],
      killers: (p, r) => [Case('test_fixed_window_default_length', [New('w', 'FixedWindow', [1]), Get('w', 'window_ms'), Call('w', 'allow', [p.win - 1]), Call('w', 'allow', [p.win])])],
    },
    fw_remaining: {
      section: 'window', op: 'stale-variable', fnKey: 'FixedWindow.remaining', fn: () => 'FixedWindow.remaining()',
      title: () => 'remaining() reports the previous window',
      symptom: [
        () => `remaining() keeps reporting the count of the previous window until the next request arrives, so our X-RateLimit-Remaining header is 0 at the start of a fresh window.`,
      ],
      killers: (p, r) => [Case('test_remaining_in_new_window', [New('w', 'FixedWindow', [2, 1000]), Call('w', 'allow', [10]), Call('w', 'allow', [20]),
        Call('w', 'remaining', [30]), Call('w', 'remaining', [1500])])],
    },
    log_expire: {
      section: 'sliding', op: 'wrong-comparator', fnKey: 'SlidingLog._expire', fn: () => 'SlidingLog.allow()',
      title: () => 'SlidingLog keeps requests one millisecond too long',
      symptom: [
        () => `With SlidingLog(1, 1000), a request at t=0 still blocks a request at t=1000, although it should have expired exactly then.`,
      ],
      herring: [
        () => `SlidingLog lets a new request in exactly window_ms after an old one. At that instant the old request is still "within the window" in my book, so the new one should be refused.`,
      ],
      decoy: () => 'FIXME: should entries exactly window_ms old still count (<)?',
      killers: (p, r) => { const w = r.pick([500, 1000, 2000]); return [Case('test_sliding_log_expiry_boundary', [New('s', 'SlidingLog', [1, w]), Call('s', 'allow', [0]),
        Call('s', 'allow', [w - 1]), Call('s', 'allow', [w]), Call('s', 'in_window', [w])])]; },
    },
    log_denied: {
      section: 'sliding', op: 'missing-edge-case', fnKey: 'SlidingLog.allow', fn: () => 'SlidingLog.allow()',
      title: () => 'Rejected requests extend the lockout',
      symptom: [
        () => `A client that keeps retrying while limited by SlidingLog stays locked out forever: rejected attempts seem to be counted as well.`,
      ],
      killers: (p, r) => [Case('test_denied_requests_not_logged', [New('s', 'SlidingLog', [2, 1000]), Call('s', 'allow', [0]), Call('s', 'allow', [10]),
        Call('s', 'allow', [500]), Call('s', 'allow', [900]), Call('s', 'in_window', [950]), Call('s', 'allow', [1010])])],
    },
    next_off: {
      section: 'sliding', op: 'off-by-one', fnKey: 'SlidingLog.next_allowed_ms', fn: () => 'SlidingLog.next_allowed_ms()',
      title: () => 'next_allowed_ms() is one millisecond late',
      symptom: [
        () => `next_allowed_ms() returns a time one millisecond after the moment allow() would actually succeed.`,
      ],
      killers: (p, r) => [Case('test_next_allowed_time', [New('s', 'SlidingLog', [2, 1000]), Call('s', 'allow', [100]), Call('s', 'allow', [300]),
        Call('s', 'next_allowed_ms', [400]), Call('s', 'next_allowed_ms', [1200]), Call('s', 'allow', [1100])])],
    },
    keyed_args: {
      section: 'keyed', op: 'swapped-arguments', fnKey: 'KeyedLimiter.allow', fn: () => 'KeyedLimiter.allow()',
      title: () => 'Per-client buckets use the wrong rate and burst',
      symptom: [
        () => `KeyedLimiter(rate=1, burst=5) behaves like rate 5 and burst 1 for every client: only one request goes through in a burst, but they recover very fast.`,
      ],
      killers: (p, r) => { const k = p.keys[0]; return [Case('test_keyed_rate_and_burst', [New('k', 'KeyedLimiter', [1, 4]),
        ...Array.from({ length: 5 }, () => Call('k', 'allow', [k, 0])), Call('k', 'allow', [k, 400])])]; },
    },
    sweep_cmp: {
      section: 'keyed', op: 'wrong-comparator', fnKey: 'KeyedLimiter.sweep', fn: () => 'KeyedLimiter.sweep()',
      title: () => 'sweep() forgets clients exactly at the idle limit',
      symptom: [
        () => `sweep() removes clients whose last request was exactly idle_ms ago. Only clients idle for longer than idle_ms should be forgotten.`,
      ],
      herring: [
        () => `sweep() keeps clients that have been idle for exactly idle_ms. "Idle for idle_ms" should be enough to forget them.`,
      ],
      killers: (p, r) => [Case('test_sweep_idle_boundary', [New('k', 'KeyedLimiter', [1, 2], { idle_ms: 1000 }), Call('k', 'allow', [p.keys[0], 0]), Call('k', 'allow', [p.keys[1], 500]),
        Call('k', 'sweep', [1000]), Call('k', 'keys'), Call('k', 'sweep', [1501])])],
    },
    seen_stale: {
      section: 'keyed', op: 'stale-variable', fnKey: 'KeyedLimiter.allow', fn: () => 'KeyedLimiter.allow()',
      title: () => 'Active clients are swept as idle',
      symptom: [
        () => `sweep() forgets clients that are actively sending requests, as if only their first request counted, which resets their bucket to full.`,
      ],
      killers: (p, r) => [Case('test_sweep_uses_last_request', [New('k', 'KeyedLimiter', [1, 2], { idle_ms: 1000 }), Call('k', 'allow', [p.keys[0], 0]), Call('k', 'allow', [p.keys[0], 900]),
        Call('k', 'sweep', [1500]), Call('k', 'keys')])],
    },
    backoff_exp: {
      section: 'backoff', op: 'off-by-one', fnKey: 'backoff_ms', fn: () => 'backoff_ms()',
      title: () => 'First retry waits twice the base delay',
      symptom: [
        p => `backoff_ms(1) returns ${p.base * 2} instead of the base delay ${p.base}; every retry waits twice as long as documented.`,
      ],
      decoy: () => 'TODO: should the first retry already double (2 ** attempt)?',
      killers: (p, r) => [Case('test_backoff_doubles_from_base', [Fn('backoff_ms', [1]), Fn('backoff_ms', [3]), Fn('backoff_ms', [30])])],
    },
    sched_swap: {
      section: 'backoff', op: 'swapped-arguments', fnKey: 'retry_schedule', fn: () => 'retry_schedule()',
      title: () => 'retry_schedule() uses the cap as the base delay',
      symptom: [
        () => `retry_schedule() gives absurd retry times: the first retry is scheduled after the cap delay, not the base delay.`,
      ],
      killers: (p, r) => [Case('test_retry_schedule_values', [Fn('retry_schedule', [4]), Fn('retry_schedule', [3], { base_ms: 100, cap_ms: 250 })])],
    },
    attempt_zero: {
      section: 'backoff', op: 'missing-edge-case', fnKey: 'backoff_ms', fn: () => 'backoff_ms()',
      title: () => 'backoff_ms(0) returns a fraction',
      symptom: [
        () => `backoff_ms(0) returns a float like 50.0 instead of rejecting the attempt number, and our scheduler then crashes on the float.`,
      ],
      killers: (p, r) => [Case('test_backoff_rejects_attempt_zero', [Fn('backoff_ms', [0]), Fn('backoff_ms', [-1]), Fn('backoff_ms', [2])])],
    },
  },

  randoms: {
    core(p, r, i) {
      const steps = [New('b', 'TokenBucket', [r.int(1, 5), r.int(1, 6)])]; let t = 0;
      for (let k = 0; k < 8; k++) { t += r.int(0, 900); steps.push(r.chance(0.7) ? Call('b', 'allow', [t], { cost: r.int(1, 3) }) : Call('b', 'tokens', [t])); }
      steps.push(Call('b', 'peek', [t], { cost: r.int(1, 3) }), Call('b', 'wait_ms', [t], { cost: r.int(1, 4) }), Call('b', 'reset', [t + 5]), Call('b', 'tokens', [t + 5]));
      return Case(`test_bucket_trace_${i}`, steps);
    },
    window(p, r, i) {
      const steps = [New('w', 'FixedWindow', [r.int(1, 4), r.pick([500, 1000])])]; let t = r.int(0, 2000);
      for (let k = 0; k < 7; k++) { t += r.int(0, 400); steps.push(Call('w', 'allow', [t])); }
      steps.push(Call('w', 'remaining', [t]), Call('w', 'used', [t]), Call('w', 'reset_at', [t]));
      return Case(`test_window_trace_${i}`, steps);
    },
    sliding(p, r, i) {
      const steps = [New('s', 'SlidingLog', [r.int(1, 4), r.pick([500, 1000])])]; let t = 0;
      for (let k = 0; k < 7; k++) { t += r.int(0, 450); steps.push(Call('s', 'allow', [t])); }
      steps.push(Call('s', 'in_window', [t]), Call('s', 'oldest', [t]), Call('s', 'next_allowed_ms', [t]));
      return Case(`test_sliding_trace_${i}`, steps);
    },
    keyed(p, r, i) {
      const steps = [New('k', 'KeyedLimiter', [r.int(1, 3), r.int(1, 4)], { idle_ms: r.pick([500, 1000]) })]; let t = 0;
      for (let k = 0; k < 7; k++) { t += r.int(0, 600); steps.push(Call('k', 'allow', [r.pick(p.keys), t])); }
      steps.push(Call('k', 'sweep', [t + r.int(0, 1200)]), Call('k', 'forget', [r.pick(p.keys)]), Call('k', 'keys'));
      return Case(`test_keyed_trace_${i}`, steps);
    },
    backoff(p, r, i) {
      const decisions = Array.from({ length: 6 }, () => [r.pick(p.keys), r.chance(0.6)]);
      return Case(`test_backoff_values_${i}`, [Fn('backoff_ms', [r.int(1, 8)], { base_ms: r.pick([50, 100]), cap_ms: r.pick([1000, 3000]) }),
        Fn('retry_schedule', [r.int(1, 5)]), Fn('summarize', [decisions]), Fn('jittered_backoff', [r.int(1, 6), r.pick([0, 0.25, 0.5, 1])])]);
    },
  },

  render(p, { m, d, inc }) {
    const out = [];
    out.push(`"""${p.mod}: request throttling for ${p.service}.

Clock values are integer milliseconds supplied by the caller (now_ms), so the
module never reads a real clock.  Token counts are kept internally in
thousandths of a token so that refills stay exact.
"""


class TokenBucket:
    """Token bucket limiter.

    The bucket starts full with burst tokens and refills continuously at rate
    tokens per second, never holding more than burst.  A request costing cost
    tokens is allowed when at least cost tokens are present (it may empty the
    bucket exactly); the tokens are then removed.  A clock that goes backwards
    is treated as no time passing.
    """

    def __init__(self, rate, burst, now_ms=0):
        if rate <= 0 or burst <= 0:
            raise ValueError("rate and burst must be positive")
        self.rate = rate
        self.burst = burst
        self._milli = burst * 1000
        self._last = now_ms

    def _refill(self, now_ms):
${d('clock_back', 8)}        elapsed = ${m('clock_back', 'max(0, now_ms - self._last)', 'now_ms - self._last')}
        self._milli = ${m('cap_missing', 'min(self.burst * 1000, self._milli + elapsed * self.rate)', 'self._milli + elapsed * self.rate')}
${m('last_stale', `        self._last = max(self._last, now_ms)
`, '')}
    def tokens(self, now_ms):
        """Tokens available at now_ms (may be fractional)."""
        self._refill(now_ms)
        return self._milli / 1000

    def allow(self, now_ms, cost=1):
        """Spend cost tokens at now_ms if possible; return True when allowed."""
        self._refill(now_ms)
        need = cost * 1000
        if self._milli ${m('allow_cmp', '>=', '>')} need:
            self._milli -= need
            return True
        return False

    def peek(self, now_ms, cost=1):
        """True when allow(now_ms, cost) would succeed; spends nothing."""
        self._refill(now_ms)
        return self._milli >= cost * 1000

    def reset(self, now_ms):
        """Refill the bucket completely as of now_ms."""
        self._milli = self.burst * 1000
        self._last = now_ms

    def wait_ms(self, now_ms, cost=1):
        """Milliseconds from now_ms until cost tokens are available, rounded up
        to a whole millisecond (0 when they already are).  A cost above burst
        can never be met and gives None."""
        self._refill(now_ms)
        if cost > self.burst:
            return None
        missing = cost * 1000 - self._milli
        if missing <= 0:
            return 0
        return ${m('wait_round', '-(-missing // self.rate)', 'missing // self.rate')}
`);
    if (inc('window')) out.push(`

class FixedWindow:
    """At most limit requests per window of window_ms milliseconds (default
    ${p.win}).

    Windows are aligned to multiples of window_ms: [0, w), [w, 2w), ...  The
    count starts again from zero in every new window.
    """

    def __init__(self, limit, window_ms=${m('fw_default', String(p.win), String(p.win * 2))}):
        self.limit = limit
        self.window_ms = window_ms
        self._window = None
        self._count = 0

    def allow(self, now_ms):
        """Count a request at now_ms; return True when it is within the limit."""
        window = now_ms // self.window_ms
        if window != self._window:
            self._window = window
            self._count = 0
        if self._count ${m('fw_cmp', '<', '<=')} self.limit:
            self._count += 1
            return True
        return False

    def remaining(self, now_ms):
        """Requests still allowed in the window that contains now_ms."""
${m('fw_remaining', `        if now_ms // self.window_ms != self._window:
            return self.limit
`, '')}        return self.limit - self._count

    def used(self, now_ms):
        """Requests already counted in the window that contains now_ms."""
        return self.limit - self.remaining(now_ms)

    def reset_at(self, now_ms):
        """Start time (ms) of the window after the one containing now_ms."""
        return ${m('fw_reset', '(now_ms // self.window_ms + 1) * self.window_ms', '-(-now_ms // self.window_ms) * self.window_ms')}
`);
    if (inc('sliding')) out.push(`

class SlidingLog:
    """At most limit requests within any window_ms-long sliding window.

    An allowed request at time t counts against requests made before
    t + window_ms; at t + window_ms exactly it has expired.  Rejected requests
    are not recorded and do not extend the lockout.
    """

    def __init__(self, limit, window_ms):
        self.limit = limit
        self.window_ms = window_ms
        self._log = []

    def _expire(self, now_ms):
        cutoff = now_ms - self.window_ms
${d('log_expire', 8)}        while self._log and self._log[0] ${m('log_expire', '<=', '<')} cutoff:
            self._log.pop(0)

    def allow(self, now_ms):
        """Return True and record the request when it fits in the window."""
        self._expire(now_ms)
${m('log_denied', `        allowed = len(self._log) < self.limit
        if allowed:
            self._log.append(now_ms)
`, `        allowed = len(self._log) < self.limit
        self._log.append(now_ms)
`)}        return allowed

    def in_window(self, now_ms):
        """Number of recorded requests that still count at now_ms."""
        self._expire(now_ms)
        return len(self._log)

    def oldest(self, now_ms):
        """Timestamp of the oldest request still counted at now_ms, or None."""
        self._expire(now_ms)
        return self._log[0] if self._log else None

    def next_allowed_ms(self, now_ms):
        """Earliest time >= now_ms at which allow() would succeed."""
        self._expire(now_ms)
        if len(self._log) < self.limit:
            return now_ms
        return self._log[len(self._log) - self.limit] + self.window_ms${m('next_off', '', ' + 1')}
`);
    if (inc('keyed')) out.push(`

class KeyedLimiter:
    """One TokenBucket per client key, created on the key's first request with
    this limiter's rate and burst.

    sweep() forgets keys whose last request is more than idle_ms (default
    ${p.idle}) in the past; a forgotten key starts again with a full bucket.
    """

    def __init__(self, rate, burst, idle_ms=${p.idle}):
        self.rate = rate
        self.burst = burst
        self.idle_ms = idle_ms
        self._buckets = {}
        self._seen = {}

    def allow(self, key, now_ms, cost=1):
        """TokenBucket.allow() for key's bucket."""
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = TokenBucket(${m('keyed_args', 'self.rate, self.burst', 'self.burst, self.rate')}, now_ms)
            self._buckets[key] = bucket
${m('seen_stale', `        self._seen[key] = now_ms
`, `            self._seen[key] = now_ms
`)}        return bucket.allow(now_ms, cost)

    def sweep(self, now_ms):
        """Forget keys idle for more than idle_ms; return them sorted."""
        gone = sorted(key for key, last in self._seen.items() if now_ms - last ${m('sweep_cmp', '>', '>=')} self.idle_ms)
        for key in gone:
            del self._buckets[key]
            del self._seen[key]
        return gone

    def forget(self, key):
        """Drop key's bucket now; return True if the key was tracked."""
        self._seen.pop(key, None)
        return self._buckets.pop(key, None) is not None

    def keys(self):
        """Keys currently tracked, sorted."""
        return sorted(self._buckets)
`);
    if (inc('backoff')) out.push(`

def backoff_ms(attempt, base_ms=${p.base}, cap_ms=${p.cap}):
    """Delay before retry number attempt (1 for the first retry).

    Delays double each attempt -- base_ms, 2 * base_ms, 4 * base_ms, ... -- and
    never exceed cap_ms.  attempt below 1 raises ValueError.
    """
${m('attempt_zero', `    if attempt < 1:
        raise ValueError("attempt numbers start at 1")
`, '')}${d('backoff_exp', 4)}    return min(cap_ms, base_ms * 2 ** ${m('backoff_exp', '(attempt - 1)', 'attempt')})


def retry_schedule(attempts, base_ms=${p.base}, cap_ms=${p.cap}):
    """Retry times in ms after the first failure, one per attempt, each
    retry waiting backoff_ms(attempt) after the previous one."""
    times = []
    elapsed = 0
    for attempt in range(1, attempts + 1):
        elapsed += backoff_ms(attempt, ${m('sched_swap', 'base_ms, cap_ms', 'cap_ms, base_ms')})
        times.append(elapsed)
    return times


def jittered_backoff(attempt, fraction, base_ms=${p.base}, cap_ms=${p.cap}):
    """backoff_ms(attempt) scaled into [50%, 100%] of itself by fraction
    (0.0 .. 1.0), rounded down to whole ms: delay * (0.5 + fraction / 2)."""
    if not 0.0 <= fraction <= 1.0:
        raise ValueError("fraction must be within [0, 1]")
    delay = backoff_ms(attempt, base_ms, cap_ms)
    return int(delay * (0.5 + fraction / 2))


def summarize(decisions):
    """Summarise [key, allowed] pairs as [[key, allowed, denied, denied_pct],
    ...] sorted by key; denied_pct is a percentage rounded to one decimal."""
    stats = {}
    for key, ok in decisions:
        row = stats.setdefault(key, [0, 0])
        row[0 if ok else 1] += 1
    out = []
    for key in sorted(stats):
        allowed, denied = stats[key]
        out.append([key, allowed, denied, round(100.0 * denied / (allowed + denied), 1)])
    return out
`);
    return out.join('');
  },

  notes(p, inc) {
    const out = [`# ${p.mod} design notes

${p.mod} is the throttling layer of ${p.service}. All functions take the caller's clock (integer ms) so they
are deterministic and easy to test.

## Token bucket
- Starts full; refills at rate tokens per second; never above burst.
- A request may take the last token(s): "at least cost tokens" is enough.
- Time going backwards counts as no time passing; every interval is refilled exactly once.
- wait_ms() rounds up, so sleeping for the returned value always suffices.`];
    if (inc('window')) out.push(`
## Fixed window
- Windows are aligned to multiples of window_ms (default ${p.win}); at most limit requests per window.
- remaining() and reset_at() describe the window that contains the given time, even before any request
  has been made in it.`);
    if (inc('sliding')) out.push(`
## Sliding log
- A request stops counting exactly window_ms after it was made.
- Rejected requests are never logged.`);
    if (inc('keyed')) out.push(`
## Per-client registry
- Each client gets its own bucket with the registry's rate and burst.
- A client is forgotten only when idle for strictly more than idle_ms (default ${p.idle}), measured from its
  latest request.`);
    if (inc('backoff')) out.push(`
## Backoff
- Retry 1 waits base_ms (default ${p.base}), retry 2 waits twice that, and so on, capped at ${p.cap} ms.
- Attempt numbers start at 1.`);
    return out.join('\n') + '\n';
  },
};
