// Fan-out sizing from measured probes (engine gap 2, research/skillpack-20261104/ANSWER.md; skill pack scale.md step 2).
//
// The number of model calls in a large job should come from measurement, not from the engine's limits (map.maxItems is
// 1,000; that is a ceiling, not a target). The builder runs the reader on a few probe shards whose answers are known, at
// increasing shard sizes and for each candidate model class, and records how many known items each found and what the
// shard cost. This planner turns those probes into a decision:
//   - the recall at a size is the Clopper-Pearson 95% lower bound over the probes' known items, not the observed rate,
//     so a few lucky probes cannot certify a large shard;
//   - a size is usable when its bound meets the recall bar and so does every smaller probed size of that class (recall
//     is assumed to fall as shards grow, the context-rot pattern; a non-monotone class is used only up to the first
//     size that fails);
//   - for each class the largest usable size is the cheapest per unit; the plan is the class and size with the lowest
//     total cost for the remaining work, never extrapolated past the largest probed size;
//   - if the work fits one shard, there is no fan-out; if nothing meets the bar, or the cheapest plan exceeds the
//     budget, the planner refuses and says what to do instead (filter more by code, sample with a stated guarantee,
//     probe a stronger class, or ask).
// Pure and deterministic: no model calls, no clock. The probes are the builder's measured evidence and are echoed back.

const RECALL_CONFIDENCE = 0.95;

// ln C(n, k) via log-gamma (Lanczos), enough precision for n up to millions.
function logGamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const logChoose = (n, k) => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
// P(X >= k) for X ~ Binomial(n, p).
function upperTail(n, k, p) {
  if (k <= 0) return 1; if (p <= 0) return 0; if (p >= 1) return 1;
  let s = 0;
  for (let i = k; i <= n; i++) s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p));
  return Math.min(1, s);
}
// One-sided Clopper-Pearson lower bound on a proportion: the smallest p with P(X >= found | p) >= 1 - confidence.
export function recallLowerBound(found, total, confidence = RECALL_CONFIDENCE) {
  if (!Number.isInteger(found) || !Number.isInteger(total) || total < 1 || found < 0 || found > total) throw new Error('recallLowerBound needs integers 0 <= found <= total, total >= 1');
  if (found === 0) return 0;
  const alpha = 1 - confidence;
  let lo = 0, hi = found / total;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (upperTail(total, found, mid) < alpha) lo = mid; else hi = mid; }
  return hi;
}

const positiveInt = v => Number.isInteger(v) && v > 0;
const nonNegative = v => Number.isFinite(v) && v >= 0;

// probes: [{ modelClass, shardSize, known, found, costUsd }], one row per probe shard (several rows per size are pooled).
//   shardSize: units per shard; known: items with a known answer in the probe; found: how many the reader got; costUsd: the shard's cost.
// units: the work left after code filtering. budgetUsd: what the fan-out may spend. recallBar: the required recall (0..1].
// classOrder (optional): cheapest first, for ties. minKnownPerSize (default 20): fewer known items at a size give no evidence.
export function planFanOut({ probes, units, budgetUsd, recallBar, classOrder = [], minKnownPerSize = 20 }) {
  if (!Array.isArray(probes) || !probes.length) throw new Error('planFanOut needs measured probes; run the reader on known-answer shards first');
  if (!positiveInt(units)) throw new Error('units must be a positive integer: the work left after code filtering');
  if (!nonNegative(budgetUsd)) throw new Error('budgetUsd must be a non-negative number');
  if (!(recallBar > 0 && recallBar <= 1)) throw new Error('recallBar must be in (0, 1]');
  for (const [i, p] of probes.entries()) {
    if (!p || typeof p.modelClass !== 'string' || !positiveInt(p.shardSize) || !positiveInt(p.known) || !Number.isInteger(p.found) || p.found < 0 || p.found > p.known || !nonNegative(p.costUsd)) {
      throw new Error(`probe ${i} must be { modelClass, shardSize > 0, known > 0, 0 <= found <= known, costUsd >= 0 }`);
    }
  }
  // Pool probes per class and size.
  const byClass = new Map();
  for (const p of probes) {
    const sizes = byClass.get(p.modelClass) ?? new Map(); byClass.set(p.modelClass, sizes);
    const s = sizes.get(p.shardSize) ?? { shardSize: p.shardSize, known: 0, found: 0, cost: 0, shards: 0 };
    s.known += p.known; s.found += p.found; s.cost += p.costUsd; s.shards += 1; sizes.set(p.shardSize, s);
  }
  const evaluated = [];
  for (const [modelClass, sizes] of byClass) {
    let usable = true;
    for (const s of [...sizes.values()].sort((a, b) => a.shardSize - b.shardSize)) {
      const enough = s.known >= minKnownPerSize;
      const bound = recallLowerBound(s.found, s.known);
      const meets = enough && bound >= recallBar;
      usable = usable && meets;
      evaluated.push({ modelClass, shardSize: s.shardSize, probeShards: s.shards, known: s.known, found: s.found, observedRecall: s.found / s.known,
        recallLowerBound: bound, enoughEvidence: enough, meetsBar: meets, usable, costPerShardUsd: s.cost / s.shards, costPerUnitUsd: s.cost / s.shards / s.shardSize });
    }
  }
  const rank = c => { const i = classOrder.indexOf(c); return i < 0 ? classOrder.length : i; };
  const candidates = [];
  for (const modelClass of byClass.keys()) {
    const usable = evaluated.filter(e => e.modelClass === modelClass && e.usable);
    if (!usable.length) continue;
    const best = usable.reduce((a, b) => (b.shardSize > a.shardSize ? b : a));
    const shardCount = Math.ceil(units / best.shardSize);
    // A shard holds at most shardSize units, so the cost scales with the shards actually needed.
    candidates.push({ modelClass, shardSize: best.shardSize, shardCount, estCostUsd: shardCount * best.costPerShardUsd, recallLowerBound: best.recallLowerBound });
  }
  candidates.sort((a, b) => a.estCostUsd - b.estCostUsd || rank(a.modelClass) - rank(b.modelClass) || b.shardSize - a.shardSize);
  const base = { units, budgetUsd, recallBar, confidence: RECALL_CONFIDENCE, evaluated };
  if (!candidates.length) {
    const thin = evaluated.filter(e => !e.enoughEvidence).length;
    return { ...base, decision: 'refuse', reason: 'no-size-meets-recall',
      why: `No probed shard size of any class reaches recall ${recallBar} at ${RECALL_CONFIDENCE * 100}% confidence${thin ? ` (${thin} size${thin === 1 ? ' has' : 's have'} fewer than ${minKnownPerSize} known items)` : ''}.`,
      instead: ['probe smaller shards or a stronger model class', 'filter more of the work by code first', 'sample with a stated guarantee instead of reading everything', 'ask the person'] };
  }
  const pick = candidates[0];
  if (pick.estCostUsd > budgetUsd) {
    return { ...base, decision: 'refuse', reason: 'over-budget', cheapest: pick, alternatives: candidates.slice(1),
      why: `The cheapest plan that meets the recall bar (${pick.modelClass}, ${pick.shardCount} shards of ${pick.shardSize}) costs about $${pick.estCostUsd.toFixed(2)}, over the $${budgetUsd} budget.`,
      instead: ['filter more of the work by code first', 'sample with a stated guarantee instead of reading everything', 'raise the budget (ask)'] };
  }
  const single = pick.shardCount === 1;
  return { ...base, decision: single ? 'single' : 'fan-out', ...pick, alternatives: candidates.slice(1),
    why: single
      ? `The ${units} units fit one ${pick.modelClass} shard of up to ${pick.shardSize} that meets the bar: no fan-out.`
      : `${pick.shardCount} ${pick.modelClass} shards of up to ${pick.shardSize} units: the largest probed size whose recall bound meets ${recallBar}, at about $${pick.estCostUsd.toFixed(2)}.` };
}
