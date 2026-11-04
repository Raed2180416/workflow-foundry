// Leverage classes per site from the perturbation screen, restricted to one slice (the calibration slice C by default),
// as PREREG-TIERDOWN.md fixes them: flip rate = flips / measured perturbations of the site's decisions on that slice's
// rows (leverage.mjs outcomes; unmeasured perturbations excluded and reported).
import { readFileSync } from 'node:fs';
import { clopperPearson } from '../lib/stats-ebed.mjs';
import { leverageClass } from './policy.mjs';
import { sliceOf } from './tier-replay.mjs';

export function classesOf(leverage, { slice = 'C' } = {}) {
  const by = {};
  for (const r of leverage.rows ?? []) {
    if (r.status !== 'screened' || sliceOf(r.taskKey) !== slice) continue;
    for (const p of r.perturbed ?? []) {
      const s = by[p.site] ??= { site: p.site, measured: 0, flips: 0, unmeasured: 0, rows: new Set() };
      s.rows.add(r.id);
      if (p.outcome === 'unmeasured') s.unmeasured++; else { s.measured++; if (p.outcome === 'flip') s.flips++; }
    }
  }
  return Object.fromEntries(Object.values(by).map(s => {
    const rate = s.measured ? s.flips / s.measured : null, ci = clopperPearson(s.flips, s.measured, 'two-sided');
    const c = leverageClass(rate);
    return [s.site, { site: s.site, slice, rows: s.rows.size, measured: s.measured, unmeasured: s.unmeasured, flips: s.flips, flipRate: rate, ci: s.measured ? [ci.lower, ci.upper] : null, class: c.name, delta: c.delta }];
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lev = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(classesOf(lev, { slice: process.argv[3] ?? 'C' }), null, 1));
}
