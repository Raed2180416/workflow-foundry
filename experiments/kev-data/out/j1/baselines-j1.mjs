// $0 baselines on dev-select (JUDGE-PROGRAM.md §5 items 1-2), re-pointed 2026-10-09 to what survived the loss of the cloud builds
// (lib-j1.mjs sources()). What each arm is, and why some of the designed arms are missing:
//  every group
//   - uniform: p = 1/k over the item's options (fitted on nothing); its Brier is the reference for bssUniform. Chance balanced
//     accuracy is analytic (a uniform guesser's expected recall per label = 1/k), so it carries no interval.
//   - devMajority, devPrior: the majority label / label distribution of the port's OWN dev-select rows. LEAKY (fitted on the
//     evaluation rows themselves): an in-sample ceiling for a constant predictor, never a baseline a judge "beats".
//  kinetics only (its rebuild reproduced the manifest's dev-select and calib-in byte for byte; the rebuilt train differs from the
//  manifest's by +1 X3 and -4 K3 records, see rebuild-check.json, and is used with that disclosed)
//   - trainMajority, trainPrior: fitted on train.
//   - calibInPrior: the calib-in label distribution (in-distribution; NOT the §6.1 calib-OOD prior).
//   - probe: the §5.2 bag-of-words probe (lib/probe.mjs) fitted on train.
//  not available
//   - the calib-OOD prior arm (§5.1, the §6.1 BSS reference): calib-ood needs the held-out material that was lost with the container.
//   - interactive / runbook train-fitted arms: their rebuild did not reproduce the manifest (lost pools/train/X1.jsonl), so their
//     train slice is untrustworthy and none is fitted.
//   - the §5 partial-input battery, rules (§5.3) and embedding baselines: never built.
// Reads train, calib-in (kinetics) and dev-select only. Usage: node baselines-j1.mjs [out.json] [rows.jsonl]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { trainProbe, predict } from '../../lib/probe.mjs';
import { WORK, J1_GROUPS, sources, loadDev, loadSlice, metricsWithCI, majority, priorOf } from './lib-j1.mjs';

const OUT = process.argv[2] ?? path.join(WORK, 'baselines', 'baselines-dev-select.json');
const ROWS = process.argv[3] ?? path.join(WORK, 'baselines', 'baselines-rows.jsonl');
const B = Number(process.env.KEV_J1_BOOT ?? 2000);
mkdirSync(path.dirname(OUT), { recursive: true }); mkdirSync(path.dirname(ROWS), { recursive: true });
const textOf = r => `${r.instructions}\n${JSON.stringify(r.state)}`;
const argmax = (opts, p) => opts.reduce((b, o) => (p[o] > p[b] ? o : b), opts[0]);
// a reference distribution restricted (and renormalised) to the item's own options; uniform where it puts no mass on them
const onOptions = (r, prior) => { const s = r.options.reduce((a, o) => a + (prior[o] ?? 0), 0); return Object.fromEntries(r.options.map(o => [o, s ? (prior[o] ?? 0) / s : 1 / r.options.length])); };
const round = x => Math.round(x * 1e6) / 1e6;
const rowsOut = [];
const keep = (group, arm, items) => { for (const it of items) rowsOut.push({ group, arm, portKey: it.portKey, recId: it.recId, qid: it.qid, label: it.label, pred: it.pred, p: it.p ? Object.fromEntries(Object.entries(it.p).map(([k, v]) => [k, round(v)])) : null }); return items; };
const chanceBacc = d => { const labs = [...new Set(d.map(r => r.label))]; return labs.reduce((a, l) => { const xs = d.filter(r => r.label === l); return a + xs.reduce((s, r) => s + 1 / r.options.length, 0) / xs.length; }, 0) / labs.length; };

const src = sources();
const result = { schema: 'kev-j1/baselines@2', slice: 'dev-select', generatedAt: new Date().toISOString(), bootstrap: { B, seed: 7 },
  notes: ['devMajority and devPrior are LEAKY (fitted on the evaluation rows): in-sample references only.',
    'calib-OOD prior arm unavailable: calib-ood needs the lost held-out material. bss (vs the §6.1 calib-OOD prior) is therefore not computed anywhere; bssUniform is vs p = 1/k.',
    'Train-fitted arms exist for kinetics only (verified rebuild); interactive and runbook have none.',
    'Partial-input battery, rules and embedding baselines were never built.'], groups: {} };
for (const g of J1_GROUPS) {
  const s = src[g], t0 = Date.now();
  const dev = loadDev(s);
  const train = s.verified ? loadSlice(s.trainDir, 'train') : null, calibIn = s.verified ? loadSlice(s.trainDir, 'calib-in') : null;
  const ports = [...new Set(dev.map(r => r.portKey))].sort();
  result.groups[g] = { devSha256: s.devSha256, verified: s.verified, clusters: s.clusters, trainFitted: Boolean(train), ports: {} };
  for (const pk of ports) {
    const d = dev.filter(r => r.portKey === pk);
    const out = { n: d.length, labels: priorOf(d.map(r => r.label)) };
    // uniform
    const uni = keep(g, 'uniform', d.map(r => ({ ...r, p: Object.fromEntries(r.options.map(o => [o, 1 / r.options.length])), pred: null })));
    out.uniform = { brier: uni.reduce((a, it) => a + (it.options.length - 1) / it.options.length, 0) / uni.length, chanceBacc: chanceBacc(d), chanceAcc: d.reduce((a, r) => a + 1 / r.options.length, 0) / d.length };
    // leaky in-sample references
    const dmaj = majority(d.map(r => r.label)), dprior = priorOf(d.map(r => r.label));
    out.devMajority = { leaky: true, label: dmaj, ...metricsWithCI(keep(g, 'devMajority', d.map(r => ({ ...r, pred: dmaj }))), { B }) };
    out.devPrior = { leaky: true, ...metricsWithCI(keep(g, 'devPrior', d.map(r => ({ ...r, p: onOptions(r, dprior), pred: dmaj }))), { B }) };
    if (train) {
      const tr = train.filter(r => r.portKey === pk), ci = calibIn.filter(r => r.portKey === pk);
      out.trainN = tr.length; out.calibInN = ci.length;
      if (tr.length) {
        const tmaj = majority(tr.map(r => r.label)), tprior = priorOf(tr.map(r => r.label));
        out.trainMajority = { label: tmaj, ...metricsWithCI(keep(g, 'trainMajority', d.map(r => ({ ...r, pred: tmaj }))), { B }) };
        out.trainPrior = { prior: tprior, ...metricsWithCI(keep(g, 'trainPrior', d.map(r => { const p = onOptions(r, tprior); return { ...r, p, pred: argmax(r.options, p) }; })), { B }) };
      }
      if (ci.length) {
        const cprior = priorOf(ci.map(r => r.label));
        out.calibInPrior = { prior: cprior, ...metricsWithCI(keep(g, 'calibInPrior', d.map(r => { const p = onOptions(r, cprior); return { ...r, p, pred: argmax(r.options, p) }; })), { B }) };
      }
      const labs = [...new Set(tr.map(r => r.label))];
      if (labs.length >= 2) {
        const model = trainProbe(tr.map(r => ({ text: textOf(r), label: r.label })));
        const items = d.map(r => {
          const pr = predict(model, textOf(r)).probabilities;
          const raw = r.options.map(o => Math.max(pr[o] ?? 0, 1e-6)), z = raw.reduce((a, b) => a + b, 0);
          const p = Object.fromEntries(r.options.map((o, i) => [o, raw[i] / z]));
          return { ...r, p, pred: argmax(r.options, p) };
        });
        out.probe = { fittedOn: `train (${tr.length} rows, ${labs.length} labels)`, unseenDevLabels: [...new Set(d.map(r => r.label))].filter(l => !labs.includes(l)), ...metricsWithCI(keep(g, 'probe', items), { B }) };
      } else out.probe = { unavailable: `train has ${labs.length} label(s) for this port` };
    }
    result.groups[g].ports[pk] = out;
    console.log(g, pk, 'n', d.length, 'devMaj acc', out.devMajority.acc.est, 'trainMaj acc', out.trainMajority?.acc?.est ?? '-', 'probe bacc', out.probe?.bacc?.est ?? '-');
  }
  console.log(g, 'ms', Date.now() - t0);
}
writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
writeFileSync(ROWS, rowsOut.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log('wrote', OUT, ROWS, rowsOut.length, 'rows');
