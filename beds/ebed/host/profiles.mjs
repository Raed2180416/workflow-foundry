// Platform profiles (E-BED §2.2; BED-CONTRACT-v1.1 §4.1). Declared per item in spec-E and identical for every arm of
// an item, the literal OSS port included. A profile states what the platform guarantees; nothing else differs.
//
//   bare           no retry, no dedupe, no correlation, no ordering beyond the wake-up rounds          E1–E7, E9 (Track P)
//   temporal-like  activity retry on retryable results (F1 rate-limited, F2 retryable error, F3 unknown):
//                  the host re-issues the same call with the same arguments and key after
//                  1 s × 2.0^(n-1), capped at 100 s, unlimited attempts (Temporal's documented default
//                  [web✓, E-BED §2.2]); intermediate failures are journaled, only the final outcome is
//                  delivered (activity retries are invisible to workflow code); durable timers as §3.4    E8, every arm
//   product        Track C: the configured product engine computes product-computed fields after every
//                  round and they are readable through sor.query; no retries                              Track C items
//
// Under temporal-like an arm without idempotency keys is charged twice after an F3 (the retry is applied again), and
// F6 is never retried: the literal port fails only where the bar's specification differs from the app's.

export const PROFILES = Object.freeze({
  bare: Object.freeze({ id: 'bare', retry: null, product: false }),
  'temporal-like': Object.freeze({ id: 'temporal-like', product: false,
    retry: Object.freeze({ initialSeconds: 1, coefficient: 2.0, maximumSeconds: 100, maximumAttempts: 0 /* unlimited */ }) }),
  product: Object.freeze({ id: 'product', retry: null, product: true }),
});

export function profileOf(id) {
  const p = PROFILES[id];
  if (!p) throw new Error(`unknown platform profile ${JSON.stringify(id)} (bare | temporal-like | product)`);
  return p;
}

/** Seconds before re-issuing after the n-th failed attempt (n >= 1): initial × coefficient^(n-1), capped. */
export function backoffSeconds(retry, n) {
  if (!retry || n < 1) throw new Error('backoff needs a retry policy and n >= 1');
  return Math.min(retry.initialSeconds * retry.coefficient ** (n - 1), retry.maximumSeconds);
}

/** Retryable outcomes under a retry policy: F1-style rate limits, explicitly retryable errors, unknown outcomes. */
export const isRetryable = outcome => outcome.status === 'rate-limited' || outcome.status === 'unknown'
  || (outcome.status === 'error' && outcome.error?.retryable === true);

export const mayRetry = (retry, attempts) => !!retry && (retry.maximumAttempts === 0 || attempts < retry.maximumAttempts);
