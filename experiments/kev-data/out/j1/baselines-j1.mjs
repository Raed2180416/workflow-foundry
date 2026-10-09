// $0 baselines on dev-select (JUDGE-PROGRAM.md §5 items 1-2): majority class (from train), the calib-OOD prior
// (§5.1; argmax = calib-OOD majority, probabilities = the prior), and the full bag-of-words probe (§5.2,
// lib/probe.mjs, fitted on train). Rules (§5.3) are not defined yet (group baselines-local is unbuilt).
// Reads train, calib-ood and dev-select only. Output: /var/tmp/foundry-work/kev/j1/baselines-dev-select.json
import { writeFileSync } from 'node:fs';
import { trainProbe, predict } from '../../lib/probe.mjs';
import { manifest, loadSlice, metricsWithCI, majority, priorOf } from './lib-j1.mjs';

const OUT = process.argv[2] ?? '/var/tmp/foundry-work/kev/j1/baselines-dev-select.json';
const textOf = r => `${r.instructions}\n${JSON.stringify(r.state)}`;
const m = manifest(), result = { schema: 'kev-j1/baselines@1', slice: 'dev-select', generatedAt: new Date().toISOString(), groups: {} };
for (const [g, G] of Object.entries(m.groups)) {
  const t0 = Date.now();
  const train = loadSlice(G.dir, 'train'), calib = loadSlice(G.dir, 'calib-ood'), dev = loadSlice(G.dir, 'dev-select');
  const ports = [...new Set(dev.map(r => r.portKey))].sort();
  result.groups[g] = { buildId: G.buildId, ports: {} };
  for (const pk of ports) {
    const d = dev.filter(r => r.portKey === pk), tr = train.filter(r => r.portKey === pk), ca = calib.filter(r => r.portKey === pk);
    const out = { n: d.length, trainN: tr.length, calibOodN: ca.length };
    const prior = ca.length ? priorOf(ca.map(r => r.label)) : null;
    out.prior = prior;
    if (tr.length) {
      const maj = majority(tr.map(r => r.label));
      out.majorityLabel = maj;
      out.majority = metricsWithCI(d.map(r => ({ ...r, pred: maj })), { B: 2000 });
    }
    if (prior) {
      const pmaj = majority(ca.map(r => r.label));
      out.priorArm = metricsWithCI(d.map(r => { const s = r.options.reduce((a, o) => a + (prior[o] ?? 0), 0) || 1; const p = Object.fromEntries(r.options.map(o => [o, (prior[o] ?? 0) / s])); return { ...r, p, pred: pmaj }; }), { prior, B: 2000 });
    }
    const labs = [...new Set(tr.map(r => r.label))];
    if (labs.length >= 2) {
      const model = trainProbe(tr.map(r => ({ text: textOf(r), label: r.label })));
      const items = d.map(r => {
        const pr = predict(model, textOf(r)).probabilities;
        const raw = r.options.map(o => Math.max(pr[o] ?? 0, 1e-6)), s = raw.reduce((a, b) => a + b, 0);
        const p = Object.fromEntries(r.options.map((o, i) => [o, raw[i] / s]));
        const pred = r.options.reduce((b, o) => (p[o] > p[b] ? o : b), r.options[0]);
        return { ...r, p, pred };
      });
      out.probe = metricsWithCI(items, { prior, B: 2000 });
      out.probeUnseenDevLabels = [...new Set(d.map(r => r.label))].filter(l => !labs.includes(l)).length;
    } else out.probe = null;
    result.groups[g].ports[pk] = out;
    console.log(g, pk, 'n', d.length, 'maj', out.majority?.acc?.est, 'probe acc', out.probe?.acc?.est, 'bacc', out.probe?.bacc?.est);
  }
  console.log(g, 'ms', Date.now() - t0);
}
writeFileSync(OUT, JSON.stringify(result, null, 1));
