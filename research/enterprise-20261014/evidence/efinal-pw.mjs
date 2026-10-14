// Power of the E-bed family rule (sign >= 8/9 or Wilcoxon W- <= 8 on d_i + delta) when (g) equals (c) exactly,
// with per-item gap SE taken from stats.mjs pairedPower (m=40, rho=0.1). Also H-E2 "every world >= 0.95" pass rates.
let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const norm = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function fam(se, trueGap, delta = 0.10, n = 9, it = 200000) {
  let sign = 0, wil = 0;
  for (let k = 0; k < it; k++) {
    const d = Array.from({ length: n }, () => trueGap + delta + se * norm());
    if (d.filter(x => x > 0).length >= 8) sign++;
    const r = d.map((x, i) => [Math.abs(x), x]).sort((a, b) => a[0] - b[0]);
    let wm = 0; r.forEach((x, i) => { if (x[1] < 0) wm += i + 1; });
    if (wm <= 8) wil++;
  }
  return { sign: +(sign / it).toFixed(3), wilcoxon: +(wil / it).toFixed(3) };
}
for (const [K, se] of [[2, 0.139], [4, 0.098]]) for (const g of [0, -0.05, -0.10]) console.log('K', K, 'SE', se, 'true gap', g, JSON.stringify(fam(se, g)));
const binom = (n, p, kmin) => { let t = 0, c = 1; for (let k = 0; k <= n; k++) { if (k > 0) c = c * (n - k + 1) / k; if (k >= kmin) t += c * p ** k * (1 - p) ** (n - k); } return t; };
for (const n of [50, 100, 300]) for (const p of [0.93, 0.95, 0.96, 0.98, 0.99]) { const one = binom(n, p, Math.ceil(0.95 * n)); console.log(`H-E2 n=${n} p=${p}: one world ${one.toFixed(3)}, all 4 worlds ${(one ** 4).toFixed(3)}, all 2 ${(one ** 2).toFixed(3)}`); }
