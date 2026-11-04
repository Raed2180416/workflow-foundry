// GQA-1 amendment A1 transport (PREREG-GQA-1, Amendments, 2026-11-04). Two harness faults of the model transport, fixed
// here without touching the shared provider (src/models/providers/claude-cli.mjs) or the frozen arm logic:
//
// 1. Budget line. When `claude -p` gets `--max-budget-usd X`, Claude Code 2.1.318 adds a meta message
//    "USD budget: $<used>/$<X>; $<remaining> remaining" to the model's context (observed code: the `budget_usd` attachment,
//    built from options.maxBudgetUsd). The arm prompts never contain it, so it is text outside the frozen arm definitions.
//    The agent is the only arm whose model decides when to stop, and in all 5 frozen reps it finished after 4-6 of its 40
//    turns citing the budget. omitCliBudgetFlag() drops the flag (and so the line) for this port's claude-cli provider.
//    Spend stays bounded: makeCaller refuses a call once the run has spent its usdPerRun, and a no-tool, single-turn
//    call costs about $0.001-0.005 at Haiku 5.5 prices.
// 2. Rate limits. An HTTP 429 from the CLI made the construct call of workflow r3-r5 fail, so those runs ended with no
//    model output (100% of calls failed for a non-model reason). withRateLimitRetry() retries a MODEL_RATE_LIMIT result
//    after a wait (60 s, then 180 s) and logs every retry; any other outcome is returned unchanged.
//
// Amendment A2 (2026-11-04, review finding m2: "nothing falls back silently"). omitCliBudgetFlag() used to return the
// port unchanged when it had no claude-cli provider, and to pass the args through when the flag was not there, so a run
// labelled `nb` could still carry the budget line (or a provider change in the engine v2 series could make `nb` and `cli`
// the same thing) without anyone seeing it. It now throws in both cases, and auditCliArgs() logs, for every CLI call, a
// digest of the argument list and whether it holds the budget flag, so each run's calls.jsonl shows which transport its
// calls really had.
import { createHash } from 'node:crypto';

const BUDGET_FLAG = '--max-budget-usd';

/** Make the claude-cli provider of `port` stop passing --max-budget-usd (the CLI then adds no "USD budget" line).
 *  Throws when the port has no claude-cli provider, and (per call) when the provider's arguments no longer hold the flag:
 *  either way the `nb` label could not be told apart from `cli` (A2, finding m2). */
export function omitCliBudgetFlag(port) {
  const provider = port?.providers?.['claude-cli'];
  if (!provider || typeof provider.args !== 'function') throw new Error('omitCliBudgetFlag: the port has no claude-cli provider, so --transport nb cannot drop the CLI budget line');
  if (provider.budgetLineOmitted) return port;
  const args = provider.args.bind(provider);
  provider.args = input => {
    const a = args(input), i = a.indexOf(BUDGET_FLAG);
    if (i < 0) throw new Error(`omitCliBudgetFlag: the claude-cli provider no longer passes ${BUDGET_FLAG}; the nb transport is undefined (re-check the provider before running nb arms)`);
    a.splice(i, 2);
    return a;
  };
  provider.budgetLineOmitted = true;
  return port;
}

/** Log, for every claude-cli call of `port`, whether its argument list holds the budget flag and a digest of the list
 *  (the system prompt is replaced by its length before hashing). Wrap after omitCliBudgetFlag so the final arguments are
 *  seen. The rows have no `ok` field, so the analysis scripts that count model calls ignore them. */
export function auditCliArgs(port, log) {
  const provider = port?.providers?.['claude-cli'];
  if (!provider || typeof provider.args !== 'function') return port;
  if (provider.argsAudited) return port;
  const args = provider.args.bind(provider);
  provider.args = input => {
    const a = args(input);
    const shown = a.map(x => (x === input?.system ? `<system ${String(x).length} chars>` : x));
    log({ transport: 'cli-args', budgetFlag: a.includes(BUDGET_FLAG), budgetUsd: a.includes(BUDGET_FLAG) ? a[a.indexOf(BUDGET_FLAG) + 1] : null,
      argsSha: createHash('sha256').update(JSON.stringify(shown)).digest('hex').slice(0, 16) });
    return a;
  };
  provider.argsAudited = true;
  return port;
}

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const isRateLimit = x => (x?.error?.code ?? x?.code) === 'MODEL_RATE_LIMIT';

/** A port-like object whose call() retries a rate-limited call (returned or thrown) after each wait in `waitsMs`.
 *  The spend of a retried attempt is never dropped: it is added to the costUsd of the result that is returned (an
 *  unobservable spend at its upper bound), so makeCaller's run cap still sees it. */
export function withRateLimitRetry(port, { waitsMs = [60000, 180000], log = () => {}, sleep = sleepMs } = {}) {
  return {
    providers: port.providers,
    async call(req) {
      let carried = 0;
      for (let i = 0; ; i++) {
        let r, thrown = null;
        try { r = await port.call(req); } catch (e) { thrown = e; }
        const limited = thrown ? isRateLimit(thrown) : (!r.ok && isRateLimit(r));
        if (!limited || i >= waitsMs.length) {
          if (thrown) { if (carried) thrown.carriedCostUsd = carried; throw thrown; }
          return carried ? { ...r, costUsd: (r.costUsd ?? 0) + carried } : r;
        }
        const spent = (r?.costUsd ?? 0) + (r?.costUnknown ? (r.costUpperUsd ?? r.costCapUsd ?? 0) : 0);
        carried += spent;
        log({ nodeKey: req.nodeKey, attempt: req.attempt, transport: 'rate-limit-retry', retry: i + 1, waitMs: waitsMs[i], costUsd: spent });
        await sleep(waitsMs[i]);
      }
    },
  };
}
