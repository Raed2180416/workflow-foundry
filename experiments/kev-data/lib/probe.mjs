// Bag-of-words logistic probe (JUDGE-PROGRAM.md §2.4 probe-hard quota, §2.5 unknowable acceptance,
// §5 partial-input battery): unigrams and bigrams, multinomial logistic regression with L2, plain
// JavaScript, deterministic (full-batch AdaGrad, no sampling). The battery's variants (decisive span
// only, context only, metadata only, format only) are the same probe fitted on different text.
export function tokenize(text) {
  return String(text).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
export function features(text, { bigrams = true } = {}) {
  const toks = tokenize(text), out = new Set();
  for (let i = 0; i < toks.length; i++) {
    out.add(`u:${toks[i]}`);
    if (bigrams && i + 1 < toks.length) out.add(`b:${toks[i]} ${toks[i + 1]}`);
  }
  return [...out];
}

// examples: [{ text, label }]. Binary presence features scaled by 1/sqrt(n features) per document.
export function trainProbe(examples, { l2 = 1e-4, iterations = 150, learningRate = 0.5, minCount = 1, bigrams = true, labels: fixedLabels } = {}) {
  if (!examples.length) throw new Error('trainProbe needs examples');
  const labels = fixedLabels ?? [...new Set(examples.map(e => String(e.label)))].sort();
  if (labels.length < 2) throw new Error('trainProbe needs at least two labels');
  const df = new Map();
  const docs = examples.map(e => { const f = features(e.text, { bigrams }); for (const x of f) df.set(x, (df.get(x) ?? 0) + 1); return f; });
  const vocab = [...df.keys()].filter(f => df.get(f) >= minCount).sort();
  const index = new Map(vocab.map((f, i) => [f, i]));
  const X = docs.map(f => { const idx = f.map(x => index.get(x)).filter(i => i !== undefined).sort((a, b) => a - b); return { idx, v: idx.length ? 1 / Math.sqrt(idx.length) : 0 }; });
  const y = examples.map(e => labels.indexOf(String(e.label)));
  const K = labels.length, V = vocab.length, n = examples.length;
  const W = new Float64Array(K * V), b = new Float64Array(K), gW = new Float64Array(K * V), gb = new Float64Array(K);
  const hW = new Float64Array(K * V).fill(1e-8), hb = new Float64Array(K).fill(1e-8), z = new Float64Array(K);
  for (let it = 0; it < iterations; it++) {
    gW.fill(0); gb.fill(0);
    for (let d = 0; d < n; d++) {
      const { idx, v } = X[d];
      for (let k = 0; k < K; k++) { let s = b[k]; const o = k * V; for (const j of idx) s += W[o + j] * v; z[k] = s; }
      let m = -Infinity; for (let k = 0; k < K; k++) m = Math.max(m, z[k]);
      let t = 0; for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - m); t += z[k]; }
      for (let k = 0; k < K; k++) {
        const g = z[k] / t - (k === y[d] ? 1 : 0); gb[k] += g; const o = k * V;
        if (g !== 0) for (const j of idx) gW[o + j] += g * v;
      }
    }
    for (let i = 0; i < K * V; i++) { const g = gW[i] / n + l2 * W[i]; hW[i] += g * g; W[i] -= (learningRate * g) / Math.sqrt(hW[i]); }
    for (let k = 0; k < K; k++) { const g = gb[k] / n; hb[k] += g * g; b[k] -= (learningRate * g) / Math.sqrt(hb[k]); }
  }
  return { kind: 'bow-logistic', version: 1, labels, vocab, weights: Array.from(W), bias: Array.from(b), bigrams, n };
}

const INDEX = new WeakMap();
export function predict(model, text) {
  const K = model.labels.length, V = model.vocab.length;
  let index = INDEX.get(model);
  if (!index) { index = new Map(model.vocab.map((f, i) => [f, i])); INDEX.set(model, index); }
  const idx = features(text, { bigrams: model.bigrams }).map(f => index.get(f)).filter(i => i !== undefined);
  const v = idx.length ? 1 / Math.sqrt(idx.length) : 0, z = [];
  for (let k = 0; k < K; k++) { let s = model.bias[k]; for (const j of idx) s += model.weights[k * V + j] * v; z.push(s); }
  const m = Math.max(...z), e = z.map(x => Math.exp(x - m)), t = e.reduce((a, c) => a + c, 0);
  const probabilities = Object.fromEntries(model.labels.map((l, k) => [l, e[k] / t]));
  const label = model.labels[e.indexOf(Math.max(...e))];
  return { label, probabilities };
}

// Accuracy, balanced accuracy (macro recall over labels present) and per-example hits.
export function evaluate(model, examples) {
  const per = {}; let right = 0;
  const hits = examples.map(e => { const p = predict(model, e.text); const ok = p.label === String(e.label); right += ok; const s = (per[e.label] ??= { n: 0, right: 0 }); s.n++; s.right += ok; return ok; });
  const recalls = Object.values(per).map(s => s.right / s.n);
  return { n: examples.length, accuracy: examples.length ? right / examples.length : NaN, balancedAccuracy: recalls.length ? recalls.reduce((a, c) => a + c, 0) / recalls.length : NaN, perLabel: per, hits };
}

export function topFeatures(model, label, k = 10) {
  const K = model.labels.indexOf(label), V = model.vocab.length;
  if (K < 0) throw new Error(`unknown label ${label}`);
  return model.vocab.map((f, j) => [f, model.weights[K * V + j]]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k);
}
