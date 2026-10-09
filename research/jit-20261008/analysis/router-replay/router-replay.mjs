// Row 29 (B16-E1; HANDOFF §5.9; FG P3(d)): router replay on committed ARM TOTALS only. $0, no model calls.
//   node research/jit-20261008/analysis/router-replay/router-replay.mjs [--resamples 4000]
// The per-task rows of the dev streams are lost, so this is a world model built from arm totals:
// - every mode (agent arm or JIT arm) succeeds on a task with its committed per-segment rate (records: d3 tasks 1-16,
//   d4 drift tasks 17-24; kinetics: one rate, no segment split is committed for its agent arms), independently across
//   modes and tasks (nothing about cross-arm correlation survives);
// - an agent mode costs its arm's mean cost per task; a JIT mode costs a one-time compile b (its arm's compile spend) plus
//   r per task ((arm total - b) / tasks). A fixed arm therefore reproduces its committed totals exactly in expectation.
// v0 is experiments/jit/router.mjs decide() itself (imported, read-only), with the committed agent costs as its
// agentCostMean and its own defaults (compile $3, compiled run $0.05). v1 is defined here: Beta posteriors per mode,
// Thompson choice of mode by V*theta - cost, and a learning-augmented ski-rental compile rule with trust lambda.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../../../..');
const { decide, sliderParams } = await import(path.join(REPO, 'experiments/jit/router.mjs'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const R = Number(arg('--resamples', 4000));
const N = 24;

// ---------------------------------------------------------------- committed arm totals
// Records (DEV-NOTES D10/D12; FG §0.1). H/H finished 19 of 24 tasks at FG's snapshot: rates from its 19, cost scaled to 24
// ($4.09, as BLOCKER-SYNTHESIS row 8); its compile spend is not committed, so b = $2.00 is an assumption (H/H is dominated
// at every V either way). Static C0's $1.21 excludes the cost of building it (an earlier experiment): a fixed arm only.
const FAMILIES = {
  records: {
    segOf: t => (t < 16 ? 0 : 1),
    agents: {
      H: { label: 'Haiku agent', c: 2.46 / 24, p: [9 / 16, 6 / 8] },
      S: { label: 'Sonnet agent', c: 7.05 / 24, p: [5 / 16, 8 / 8] },
      O: { label: 'Opus agent', c: 13.54 / 24, p: [16 / 16, 8 / 8] },
    },
    jits: {
      H: { label: 'JIT H/H (19 tasks, scaled)', b: 2.0, r: (3.24 * 24 / 19 - 2.0) / 24, p: [8 / 16, 2 / 3] },
      S: { label: 'JIT S/H', b: 4.83, r: (8.99 - 4.83) / 24, p: [14 / 16, 8 / 8] },
      O: { label: 'JIT O/H', b: 2.07, r: (7.53 - 2.07) / 24, p: [12 / 16, 6 / 8] },
    },
    statics: { C0: { label: 'static C0 (build cost excluded)', c: 1.21 / 24, p: [14 / 16, 2 / 8] } },
  },
  // Kinetics (FG §0.1 at 04:22; JIT arms partial: H/H 12, O/H 17, S/H 8 tasks). Rates from the tasks done; b = compile
  // spend so far (a lower bound for 24 tasks: drift recompiles would add); no Opus agent arm, so v1 cannot interpret with
  // Opus or build O/H here (O/H stays a fixed arm).
  kinetics: {
    segOf: () => 0,
    agents: {
      H: { label: 'Haiku agent', c: 2.10 / 24, p: [17 / 24] },
      S: { label: 'Sonnet agent', c: 7.40 / 24, p: [17 / 24] },
    },
    jits: {
      H: { label: 'JIT H/H (12 tasks)', b: 9.63, r: (12.09 - 9.63) / 12, p: [8 / 12] },
      S: { label: 'JIT S/H (8 tasks)', b: 13.94, r: (15.59 - 13.94) / 8, p: [4 / 8] },
      O: { label: 'JIT O/H (17 tasks)', b: 11.56, r: (17.82 - 11.56) / 17, p: [15 / 17], fixedOnly: true },
    },
    statics: {},
  },
};
const VS = [0.1, 1, 10], LAMBDAS = [0.25, 0.5, 1], SLIDERS = [0, 0.5, 1];

// ---------------------------------------------------------------- deterministic randomness
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hashSeed = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 11);
function gamma(r, k) {   // Marsaglia-Tsang, k > 0
  if (k < 1) return gamma(r, k + 1) * Math.pow(r(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = r(), u2 = r(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const betaDraw = (r, a, b) => { const x = gamma(r, a), y = gamma(r, b); return x / (x + y); };

// ---------------------------------------------------------------- expected values of fixed arms and v0
const pOf = (mode, fam, t) => mode.p[Math.min(fam.segOf(t), mode.p.length - 1)];
const sumP = (mode, fam, from, to) => { let s = 0; for (let t = from; t < to; t++) s += pOf(mode, fam, t); return s; };
function fixedArms(fam) {
  const out = [];
  for (const [k, a] of Object.entries(fam.agents)) out.push({ arm: a.label, kind: 'agent', pass: sumP(a, fam, 0, N), cost: a.c * N });
  for (const [k, j] of Object.entries(fam.jits)) out.push({ arm: j.label, kind: 'jit', pass: sumP(j, fam, 0, N), cost: j.b + j.r * N });
  for (const [k, s] of Object.entries(fam.statics)) out.push({ arm: s.label, kind: 'static', pass: sumP(s, fam, 0, N), cost: s.c * N });
  return out;
}
// v0: router.mjs decide() per task, interpreter m, slider s. Before a compile it sees agentCostMean = the arm's mean;
// compileCostMean and compiledCostMean are unknown (its $3 / $0.05 defaults). A compile switches to the JIT mode m/H
// for the remaining tasks at that mode's committed rates and pays that arm's real compile spend b.
function v0(fam, m, s) {
  const a = fam.agents[m], j = fam.jits[m];
  let traces = 0, compiledAt = null;
  const reasons = [];
  for (let t = 0; t < N; t++) {
    const d = decide({ taskId: `t${t}`, stats: { seen: t, traces, agentCostMean: a.c }, slider: s, expectedRemaining: N - t });
    if (d.action === 'compile' && j && !j.fixedOnly) { compiledAt = t; reasons.push(`t${t}: ${d.reason}`); break; }
    if (t === sliderParams(s).warmup) reasons.push(`t${t}: ${d.reason}`);
    traces++;
  }
  if (compiledAt == null) return { policy: `v0 ${m} s=${s}`, decision: 'interpret every task', pass: sumP(a, fam, 0, N), cost: a.c * N, reasons };
  return { policy: `v0 ${m} s=${s}`, decision: `compile at task ${compiledAt}`, pass: sumP(a, fam, 0, compiledAt) + sumP(j, fam, compiledAt, N),
    cost: a.c * compiledAt + j.b + j.r * (N - compiledAt), reasons };
}
// Clairvoyant bound: the best policy that knows every rate, uses one mode until task w and another after (a JIT mode
// pays its b when first used). No router can beat it in this world model.
function clairvoyant(fam, V) {
  const modes = [...Object.entries(fam.agents).map(([k, a]) => ({ id: `agent ${k}`, a, b: 0, c: a.c })),
    ...Object.entries(fam.jits).filter(([, j]) => !j.fixedOnly).map(([k, j]) => ({ id: `JIT ${k}`, a: j, b: j.b, c: j.r }))];
  let best = null;
  for (const x of modes) for (const y of modes) for (let w = 0; w <= N; w++) {
    const pass = sumP(x.a, fam, 0, w) + sumP(y.a, fam, w, N);
    const used = new Set([...(w > 0 ? [x] : []), ...(w < N ? [y] : [])]);
    const cost = [...used].reduce((s, z) => s + z.b, 0) + x.c * w + y.c * (N - w);
    const nv = V * pass - cost;
    if (!best || nv > best.nv) best = { nv, pass, cost, policy: w === 0 || x === y ? y.id : `${x.id} until task ${w}, then ${y.id}` };
  }
  return best;
}

// ---------------------------------------------------------------- v1
// Modes: agent m (cost c, theta_m) and, once bought, JIT k (cost r, theta_Jk). Feedback 'oracle': after each task the
// chosen mode's outcome updates its Beta posterior (the most favourable case for v1: free, unbiased labels on every task;
// the system view has none). Feedback 'none': posteriors stay at their priors and choices use posterior means.
// Prior of an unbought JIT mode: 'inherit' = Beta(2*mu, 2*(1-mu)) with mu the interpreter's current posterior mean (a
// compiled solver distils its interpreter), or 'uniform' Beta(1,1). A JIT mode becomes buyable after 3 traces of its
// interpreter (the JIT warmup). Ski rental (Purohit, Svitkina, Kumar 2018, deterministic form): per-task advantage
// D = (V*mean_J - r) - (V*mean_best - c_best); if D > 0, break-even B = b / D tasks, prediction y = tasks remaining;
// buy at the start of rental day ceil(lambda*B) if y >= B, else at day ceil(B/lambda). lambda in (0,1]: small = trust y.
function v1Once(r, fam, V, lambda, prior, feedback) {
  const A = Object.entries(fam.agents), J = Object.entries(fam.jits).filter(([, j]) => !j.fixedOnly);
  const post = Object.fromEntries(A.map(([k]) => [`a${k}`, [1, 1]]));
  const traces = Object.fromEntries(A.map(([k]) => [k, 0])), owned = new Set(), days = Object.fromEntries(J.map(([k]) => [k, 0]));
  let pass = 0, cost = 0, buys = [];
  const mean = ([a, b]) => a / (a + b);
  const jitPrior = k => (prior === 'inherit' && post[`a${k}`] ? [2 * mean(post[`a${k}`]), 2 * (1 - mean(post[`a${k}`]))] : [1, 1]);
  const val = (key, c, sample) => V * (sample ? betaDraw(r, ...post[key]) : mean(post[key])) - c;
  for (let t = 0; t < N; t++) {
    // Best current option by posterior mean (for the ski-rental comparison).
    const options = [...A.map(([k, a]) => ({ key: `a${k}`, c: a.c })), ...[...owned].map(k => ({ key: `j${k}`, c: fam.jits[k].r }))];
    const bestMean = Math.max(...options.map(o => val(o.key, o.c, false)));
    for (const [k, j] of J) {
      if (owned.has(k) || !fam.agents[k] || traces[k] < 3) continue;
      const pr = jitPrior(k), mJ = pr[0] / (pr[0] + pr[1]);
      const D = (V * mJ - j.r) - bestMean;
      if (!(D > 0)) continue;
      const B = j.b / D, y = N - t;
      const day = y >= B ? Math.ceil(lambda * B) : Math.ceil(B / lambda);
      days[k]++;
      if (days[k] >= day) { owned.add(k); post[`j${k}`] = pr; cost += j.b; buys.push(`${k}@${t}`); }
    }
    const opts = [...A.map(([k, a]) => ({ key: `a${k}`, c: a.c, mode: a, agent: k })), ...[...owned].map(k => ({ key: `j${k}`, c: fam.jits[k].r, mode: fam.jits[k] }))];
    const sample = feedback === 'oracle';
    let best = null, bestV = -Infinity;
    for (const o of opts) { const v = val(o.key, o.c, sample); if (v > bestV) { bestV = v; best = o; } }
    const ok = r() < pOf(best.mode, fam, t);
    pass += ok ? 1 : 0; cost += best.c;
    if (best.agent) traces[best.agent]++;
    if (feedback === 'oracle') post[best.key] = [post[best.key][0] + (ok ? 1 : 0), post[best.key][1] + (ok ? 0 : 1)];
  }
  return { pass, cost, buys };
}

// ---------------------------------------------------------------- run
const r3 = x => Math.round(x * 1000) / 1000;
const out = { about: 'Router replay on committed arm totals (BLOCKER-SYNTHESIS row 29). Dev, K=1, 24 tasks; per-task rows lost.', resamples: R, families: {} };
const md = [];
for (const [fname, fam] of Object.entries(FAMILIES)) {
  const fixed = fixedArms(fam);
  const v0s = []; for (const m of Object.keys(fam.agents)) for (const s of SLIDERS) v0s.push(v0(fam, m, s));
  const fo = { fixed: fixed.map(f => ({ ...f, pass: r3(f.pass), cost: r3(f.cost) })), v0: v0s.map(v => ({ ...v, pass: r3(v.pass), cost: r3(v.cost) })), byV: [] };
  md.push(`### ${fname}`, '', '| policy | decision | pass /24 | cost $ |', '|---|---|---|---|');
  for (const f of fixed) md.push(`| fixed: ${f.arm} | — | ${f.pass.toFixed(2)} | ${f.cost.toFixed(2)} |`);
  for (const v of v0s) md.push(`| ${v.policy} | ${v.decision} | ${v.pass.toFixed(2)} | ${v.cost.toFixed(2)} |`);
  md.push('', '| V | best fixed (all) | best agent-every-time | best fixed JIT | best v0 | clairvoyant one-switch bound | v1 (λ, prior, feedback) | v1 net value | regret vs best fixed | vs best agent | vs best JIT | vs best v0 | P(v1 > best of agent & JIT) | v1 buys a compile |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const V of VS) {
    const nv = x => V * x.pass - x.cost;
    const bestOf = xs => xs.reduce((a, b) => (nv(b) > nv(a) ? b : a));
    const bf = bestOf(fixed), ba = bestOf(fixed.filter(f => f.kind === 'agent')), bj = bestOf(fixed.filter(f => f.kind === 'jit')), b0 = bestOf(v0s);
    const cv = clairvoyant(fam, V);
    const rows = [];
    for (const lambda of LAMBDAS) for (const prior of ['inherit', 'uniform']) for (const feedback of ['oracle', 'none']) {
      const r = rng(hashSeed(`${fname}|${V}|${lambda}|${prior}|${feedback}`));
      let sNV = 0, beats = 0, buys = 0;
      for (let i = 0; i < R; i++) {
        const x = v1Once(r, fam, V, lambda, prior, feedback), v = V * x.pass - x.cost;
        sNV += v; if (v > Math.max(nv(ba), nv(bj))) beats++; if (x.buys.length) buys++;
      }
      const m = sNV / R;
      rows.push({ V, lambda, prior, feedback, nv: r3(m), regretBestFixed: r3(nv(bf) - m), regretBestAgent: r3(nv(ba) - m), regretBestJit: r3(nv(bj) - m), regretBestV0: r3(nv(b0) - m),
        pBeatsAgentAndJit: r3(beats / R), pBuys: r3(buys / R) });
    }
    fo.byV.push({ V, bestFixed: { arm: bf.arm, nv: r3(nv(bf)) }, bestAgent: { arm: ba.arm, nv: r3(nv(ba)) }, bestJit: { arm: bj.arm, nv: r3(nv(bj)) },
      bestV0: { policy: b0.policy, decision: b0.decision, nv: r3(nv(b0)) }, v0All: v0s.map(v => ({ policy: v.policy, nv: r3(nv(v)) })), clairvoyant: { ...cv, nv: r3(cv.nv) }, v1: rows });
    for (const x of rows) md.push(`| ${V} | ${bf.arm} ${nv(bf).toFixed(2)} | ${ba.arm} ${nv(ba).toFixed(2)} | ${bj.arm} ${nv(bj).toFixed(2)} | ${b0.policy} ${nv(b0).toFixed(2)} | ${cv.nv.toFixed(2)} | λ=${x.lambda}, ${x.prior}, ${x.feedback} | ${x.nv.toFixed(2)} | ${x.regretBestFixed.toFixed(2)} | ${x.regretBestAgent.toFixed(2)} | ${x.regretBestJit.toFixed(2)} | ${x.regretBestV0.toFixed(2)} | ${x.pBeatsAgentAndJit} | ${x.pBuys} |`);
  }
  md.push('');
  out.families[fname] = fo;
}
writeFileSync(path.join(HERE, 'router-replay.json'), JSON.stringify(out, null, 1) + '\n');
writeFileSync(path.join(HERE, 'router-replay.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
