// Module order-progress, key: the order id. Owns R4.1 (processing from ready) and R4.5 (the order outcome).
// Calls statuses only. A counted customer cancel stops it, so the order never ends by R4.5 (R6.2).

const FINAL = ['completed', 'failed', 'cancelled'];

export function step(input, ctx) {
  const s = ctx.state ?? { st: 'idle', outcome: null, at: null };
  if (input.op === 'ready') {
    if (s.st === 'idle') {
      s.st = 'processing';
      s.at = input.at;
      ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'processing' });
      for (const f of input.fulfilments ?? []) {
        if (f.available) ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'processing' });
      }
    }
  } else if (input.op === 'ended') {
    if (s.st === 'processing') {
      const g = ctx.call('statuses', ctx.key, { op: 'get' });
      const all = g.fulfilments.length > 0 && g.fulfilments.every(f => FINAL.includes(f.status));
      if (all) {
        const outcome = g.fulfilments.some(f => f.status === 'completed') ? 'completed'
          : g.fulfilments.some(f => f.status === 'failed') ? 'failed' : 'cancelled';
        s.st = 'ended';
        s.outcome = outcome;
        s.at = input.at ?? null;
        ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: outcome });
      }
    }
  } else if (input.op === 'stop') {
    if (s.st === 'idle' || s.st === 'processing') s.st = 'stopped';
  }
  return { output: { state: s.st, outcome: s.outcome, at: s.at, busy: false }, state: s };
}
