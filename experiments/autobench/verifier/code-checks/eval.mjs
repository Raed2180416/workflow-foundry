// Evaluate the code-checks verifier on a verifier-lab dataset (leave-task-out), at $0 (Haiku facts are read from a file).
//
//   node experiments/autobench/verifier/code-checks/eval.mjs --vlab <verifier-lab dir> --facts <facts.json> --out <dir>
//        [--design-folds 0,1,2] [--exclude-tasks a,b,...]
//
// Protocol (vlab README): the checks were designed reading rows of the design folds only (0-2); folds 3-4 are held out.
// Reported splits: heldout (folds 3-4, the clean number), design (in-sample), all. A fitted variant (logistic weights
// over check failures) is fit on 4 folds and scored on the 5th, rotating over all 5. The scorer reads labels; the
// verifier never does: verify() gets verifierView(row) (prompt, today, services, diff), the initial world and, in the
// "+facts" variant, the Haiku facts extracted from the request text alone.
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { verify, VERSION } from './verify.mjs';
import { factsKey } from './facts.mjs';
import { effectAtoms, pick } from './select.mjs';

const { values: a } = parseArgs({ options: { vlab: { type: 'string' }, facts: { type: 'string' }, out: { type: 'string' },
  'design-folds': { type: 'string', default: '0,1,2' }, 'exclude-tasks': { type: 'string', default: '' } } });
if (!a.vlab || !a.out) { console.error('usage: eval.mjs --vlab <dir> --facts <facts.json> --out <dir>'); process.exit(2); }
const lab = await import(pathToFileURL(path.join(path.resolve(a.vlab), 'load.mjs')).href);
const facts = a.facts ? JSON.parse(readFileSync(a.facts, 'utf8')) : {};
const designFolds = a['design-folds'].split(',').map(Number);
const excluded = new Set(a['exclude-tasks'].split(',').filter(Boolean));
const ARM_ORDER = lab.ARM_ORDER;

// ---------- run the verifier on every canonical outcome row ----------
const rows = lab.loadRows({ canonicalOnly: true });
const items = [];
let msTotal = 0;
for (const r of rows) {
  const view = lab.verifierView(r);
  const { initial } = lab.loadWorlds(r);
  const f = facts[factsKey(view.prompt.user, view.services)];
  const t0 = performance.now();
  const v0 = verify({ view, world0: initial });
  const v1 = verify({ view, world0: initial, hf: f?.ok ? f.facts : null });
  msTotal += performance.now() - t0;
  items.push({ rowId: r.rowId, task: r.task, domain: r.domain, arm: r.arm, fold: r.fold, y: lab.passed(r), pc: r.label.partial_credit, costUsd: r.costUsd ?? null,
    atoms: effectAtoms(r.diff), factsOk: Boolean(f?.ok), factsCostUsd: f?.costUsd ?? 0,
    v: { code: pick3(v0), facts: pick3(v1) }, checks: Object.fromEntries(v1.checks.map(c => [c.id, c.status])) });
}
function pick3(v) { return { accept: v.accept, score: v.score, failed: v.failed }; }

// ---------- fitted variant: logistic weights over check failures, leave-one-fold-out ----------
const CHECK_IDS = [...new Set(items.flatMap(x => Object.keys(x.checks)))].sort();
const feat = x => CHECK_IDS.map(id => (x.checks[id] === 'fail' ? 1 : 0));
function fitLogistic(xs, ys, { l2 = 1, iters = 3000, lr = 0.5 } = {}) {
  const d = xs[0].length; let w = new Array(d).fill(0), b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < xs.length; i++) {
      const z = b + xs[i].reduce((s, v, j) => s + v * w[j], 0), p = 1 / (1 + Math.exp(-z)), e = p - ys[i];
      gb += e; for (let j = 0; j < d; j++) gw[j] += e * xs[i][j];
    }
    b -= lr * gb / xs.length; w = w.map((wj, j) => wj - lr * (gw[j] / xs.length + l2 * wj / xs.length));
  }
  return { w, b, predict: x => 1 / (1 + Math.exp(-(b + x.reduce((s, v, j) => s + v * w[j], 0)))) };
}
const fitted = {};
for (let k = 0; k < lab.NFOLDS; k++) {
  const train = items.filter(x => x.fold !== k);
  const m = fitLogistic(train.map(feat), train.map(x => (x.y ? 1 : 0)));
  // Accept threshold: the training-fold F1 maximiser.
  let best = { f1: -1, t: 0.5 };
  for (const t of [...new Set(train.map(x => m.predict(feat(x))))].sort((p, q) => p - q)) {
    const c = confusion(train, x => m.predict(feat(x)) >= t - 1e-12);
    if (c.f1 > best.f1) best = { f1: c.f1, t };
  }
  for (const x of items.filter(x => x.fold === k)) { const p = m.predict(feat(x)); x.v.fitted = { accept: p >= best.t - 1e-12, score: p }; }
  fitted[k] = { threshold: best.t, weights: Object.fromEntries(CHECK_IDS.map((id, j) => [id, Math.round(m.w[j] * 1000) / 1000])), bias: Math.round(m.b * 1000) / 1000 };
}

// ---------- metrics ----------
function confusion(xs, acceptFn) {
  const c = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const x of xs) { const d = acceptFn(x); if (d && x.y) c.tp++; else if (d) c.fp++; else if (x.y) c.fn++; else c.tn++; }
  const n = c.tp + c.fp + c.tn + c.fn, prec = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null, rec = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  return { ...c, n, base: (c.tp + c.fn) / n, precision: prec, recall: rec, f1: prec && rec ? 2 * prec * rec / (prec + rec) : 0, accuracy: (c.tp + c.tn) / n,
    failRecall: c.tn + c.fp ? c.tn / (c.tn + c.fp) : null, acceptRate: (c.tp + c.fp) / n };
}
function auroc(xs, scoreFn) {
  const pos = xs.filter(x => x.y).map(scoreFn), neg = xs.filter(x => !x.y).map(scoreFn);
  if (!pos.length || !neg.length) return null;
  let s = 0; for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
  return s / (pos.length * neg.length);
}
const VARIANTS = ['code', 'facts', 'fitted'];
const SPLITS = {
  heldout: x => !designFolds.includes(x.fold),
  design: x => designFolds.includes(x.fold),
  all: () => true,
  ...(excluded.size ? { 'all-minus-excluded': x => !excluded.has(x.task), 'heldout-minus-excluded': x => !designFolds.includes(x.fold) && !excluded.has(x.task) } : {}),
};
const metrics = {};
for (const [split, f] of Object.entries(SPLITS)) {
  const xs = items.filter(f);
  metrics[split] = { rows: xs.length, tasks: new Set(xs.map(x => x.task)).size, pass: xs.filter(x => x.y).length };
  for (const v of VARIANTS) metrics[split][v] = { ...confusion(xs, x => x.v[v].accept), auroc: auroc(xs, x => x.v[v].score) };
}

// Per-check table (facts variant).
const perCheck = {};
for (const [split, f] of Object.entries({ heldout: SPLITS.heldout, all: SPLITS.all })) {
  perCheck[split] = {};
  for (const id of CHECK_IDS) {
    const xs = items.filter(f);
    const fires = xs.filter(x => x.checks[id] === 'fail'), applies = xs.filter(x => x.checks[id] && x.checks[id] !== 'na');
    perCheck[split][id] = { applies: applies.length, fires: fires.length, firesOnFail: fires.filter(x => !x.y).length, firesOnPass: fires.filter(x => x.y).length,
      failPrecision: fires.length ? fires.filter(x => !x.y).length / fires.length : null };
  }
}

// ---------- selection ----------
const ARM_SETS = {
  'all-10-arms': null,
  'date-note-8': ARM_ORDER.filter(x => !x.endsWith('-pre')),
  'reported-6': ['haiku-a0', 'haiku-a1', 'haiku-a1c', 'sonnet-a0', 'sonnet-a1', 'm3-a1c'],
  'k3-forks (m3-a1c, haiku-a1c, haiku-a1)': ['m3-a1c', 'haiku-a1c', 'haiku-a1'],
  'm3-a1c + sonnet-a1': ['m3-a1c', 'sonnet-a1'],
  'm3-a1c + haiku-a1c': ['m3-a1c', 'haiku-a1c'],
};
function selection(taskFilter) {
  const res = {};
  for (const [name, arms] of Object.entries(ARM_SETS)) {
    const g = new Map();
    for (const x of items) { if (!taskFilter(x) || (arms && !arms.includes(x.arm))) continue; if (!g.has(x.task)) g.set(x.task, []); g.get(x.task).push(x); }
    for (const [t, xs] of g) if (new Set(xs.map(x => x.arm)).size < 2) g.delete(t);
    const armPass = {};
    for (const xs of g.values()) for (const x of xs) armPass[x.arm] = (armPass[x.arm] ?? 0) + (x.y ? 1 : 0);
    const [bestArm, bestPass] = Object.entries(armPass).sort((p, q) => q[1] - p[1] || ARM_ORDER.indexOf(p[0]) - ARM_ORDER.indexOf(q[0]))[0] ?? [null, 0];
    const priorArm = (arms ?? ARM_ORDER).find(x => armPass[x] !== undefined);
    const oracle = [...g.values()].filter(xs => xs.some(x => x.y)).length;
    const mixed = [...g.values()].filter(xs => xs.some(x => x.y) && !xs.every(x => x.y)).length;
    const randomPick = [...g.values()].reduce((s, xs) => s + xs.filter(x => x.y).length / xs.length, 0);
    const sel = {};
    for (const v of VARIANTS) for (const tb of ['order', 'consensus']) {
      let n = 0, expRandTie = 0;
      for (const xs of g.values()) {
        const cands = xs.map(x => ({ score: x.v[v].score, atoms: x.atoms, order: ARM_ORDER.indexOf(x.arm) }));
        if (xs[pick(cands, { tiebreak: tb })].y) n++;
        const top = Math.max(...cands.map(c => c.score)), tied = xs.filter((_, i) => Math.abs(cands[i].score - top) < 1e-9);
        expRandTie += tied.filter(x => x.y).length / tied.length;
      }
      sel[`${v}/${tb}`] = n;
      if (tb === 'order') sel[`${v}/random-tie`] = Math.round(expRandTie * 10) / 10;
    }
    let consensusOnly = 0;
    for (const xs of g.values()) if (xs[pick(xs.map(x => ({ score: 0, atoms: x.atoms, order: ARM_ORDER.indexOf(x.arm) })), { tiebreak: 'consensus' })].y) consensusOnly++;
    res[name] = { tasks: g.size, mixed, oracle, bestSingle: { arm: bestArm, pass: bestPass }, priorArm: { arm: priorArm, pass: armPass[priorArm] ?? 0 },
      randomPick: Math.round(randomPick * 10) / 10, consensusOnly, selector: sel };
  }
  return res;
}
const selectionResults = { all: selection(() => true), heldout: selection(SPLITS.heldout), design: selection(SPLITS.design) };
if (excluded.size) selectionResults['all-minus-excluded'] = selection(x => !excluded.has(x.task));

// ---------- cost ----------
const tasks = [...new Set(items.map(x => x.task))];
const factsCostPerTask = tasks.map(t => items.find(x => x.task === t).factsCostUsd);
const k3 = ['m3-a1c', 'haiku-a1c', 'haiku-a1'];
const forkCost = tasks.map(t => k3.map(arm => items.find(x => x.task === t && x.arm === arm)?.costUsd).filter(c => typeof c === 'number'));
const mean = xs => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : null);
const cost = {
  haikuFactsCallsPerTask: 1, haikuFactsUsdPerTaskMean: mean(factsCostPerTask), haikuFactsUsdTotal: factsCostPerTask.reduce((p, q) => p + q, 0),
  codeMsPerRowMean: msTotal / items.length / 2,
  storedForkUsdPerTask: Object.fromEntries(k3.map(arm => [arm, mean(items.filter(x => x.arm === arm && typeof x.costUsd === 'number').map(x => x.costUsd))])),
  k3ForksUsdPerTaskMean: mean(forkCost.filter(c => c.length === 3).map(c => c.reduce((p, q) => p + q, 0))), k3TasksWithAllCosts: forkCost.filter(c => c.length === 3).length,
};

const summary = { version: VERSION, evidence: 'development (devTrain dev60, stored runs; checks designed on folds ' + designFolds.join(',') + ')',
  designFolds, excludedTasks: [...excluded], rows: items.length, metrics, perCheck, selection: selectionResults, fitted, cost };
mkdirSync(a.out, { recursive: true });
writeFileSync(path.join(a.out, 'eval.json'), JSON.stringify(summary, null, 1));
writeFileSync(path.join(a.out, 'rows.jsonl'), items.map(x => JSON.stringify({ rowId: x.rowId, task: x.task, arm: x.arm, fold: x.fold, y: x.y, pc: x.pc, v: x.v, checks: x.checks })).join('\n') + '\n');

const pct = x => (x == null ? '-' : (100 * x).toFixed(1) + '%'), f3 = x => (x == null ? '-' : x.toFixed(3));
console.log(`code-checks ${VERSION}: ${items.length} rows`);
for (const [split, m] of Object.entries(metrics)) {
  console.log(`\n[${split}] rows ${m.rows}, tasks ${m.tasks}, pass ${m.pass} (${pct(m.pass / m.rows)})`);
  for (const v of VARIANTS) { const x = m[v]; console.log(`  ${v.padEnd(7)} P ${f3(x.precision)} R ${f3(x.recall)} F1 ${f3(x.f1)} acc ${f3(x.accuracy)} failRecall ${f3(x.failRecall)} AUROC ${f3(x.auroc)} (tp ${x.tp} fp ${x.fp} tn ${x.tn} fn ${x.fn})`); }
}
for (const [split, s] of Object.entries(selectionResults)) {
  console.log(`\nselection [${split}]`);
  for (const [name, r] of Object.entries(s)) console.log(`  ${name}: tasks ${r.tasks} mixed ${r.mixed} oracle ${r.oracle} best ${r.bestSingle.arm}=${r.bestSingle.pass} prior ${r.priorArm.arm}=${r.priorArm.pass} random ${r.randomPick} consensusOnly ${r.consensusOnly} | ${Object.entries(r.selector).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}
console.log('\ncost', JSON.stringify(cost));
