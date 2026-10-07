// AUDIT step 4, triviality attack v1 (kept for the record). A deterministic regex/keyword solver that
// reads only task.prompt and task.inputs. Written against generator 1.0.0, where it passed 27/30 dev
// seeds at d3 (and 0/30 at d1 only because it ignores swap corrections). Budget: <=40 code lines,
// <=7000 characters (comment lines excluded). See ../AUDIT.md. Uses the bed's NLLS fitter (fitting is
// computation, not judgment).
import { fitMM } from '../fit.mjs';
const num = t => +String(t).trim().replace(',', '.').replace('×10^', 'e').replace(/E\+?/, 'e');
const unit = s => { s = String(s).replace(/micromolar/g, 'uM').replace(/nanomolar/g, 'nM').replace(/millimolar/g, 'mM').replace(/ per second|\/L\/s| s⁻¹|_per_s\b/g, '/s').replace(/ per minute|\/L\/min| min⁻¹|_per_min\b/g, '/min').replace(/mol(\/L)?/, 'M');
  const m = s.match(/(µ|u|n|m)M(?:\/(s|min))?/); return m ? { c: { µ: 1, u: 1, n: 1e-3, m: 1e3 }[m[1]], t: m[2] === 'min' ? 60 : 1 } : null; };
const EXC = /\bSAT\b|OVR|saturat|over range|bubble (in the well during|present when|visible right|at read time|sitting)|could not get the bubble|twice|two enzyme|missed the substrate|forgotten|spill|wrong buffer|neighbouring buffer|tip (came off|slipped)/i;
export function heuristicSolve(task) {
  const { study, documents } = task.inputs, P = study.sample_id_pattern.split('-')[0], ID = `${P}-\\d{4}`, conds = study.conditions;
  const condOf = a => { let m = a.match(/\bC(\d+)\b/); if (m) return `C${m[1]}`; const pH = +(a.match(/pH ?(\d+[.,]\d+)/) || [])[1]?.replace(',', '.'); m = a.match(/(\d+(?:[.,]\d+)?) ?K\b/); const T = m ? Math.round(num(m[1]) - 273.15) : +(a.match(/(\d+) ?°?C\b/) || [])[1];
    const inh = a.match(/(\d+(?:[.,]\d+)?) ?(µM|uM|mM)/), I = inh && !/\b0 µM/.test(a) ? num(inh[1]) * (inh[2] === 'mM' ? 1000 : 1) : null;
    return conds.find(c => c.pH === pH && c.temperature_C === T && (c.inhibitor ? Math.abs(c.inhibitor.concentration_uM - I) < 1e-6 : I == null))?.condition_id; };
  const rows = {}, raw = {}, excl = new Set(), moves = [], unitFix = [];
  const range = (a, b) => { const out = []; for (let i = +a.slice(-4); i <= +b.slice(-4); i++) out.push(`${P}-${String(i).padStart(4, '0')}`); return out; };
  const all = documents.map(d => d.text).join('\n');
  for (const m of all.matchAll(new RegExp(`(${ID})(?: to |–)(${ID})[^\\n]*?(?:set up as the|plate row was the) pH ([\\d.]+), (\\d+) °C`, 'g'))) moves.push([range(m[1], m[2]), condOf(`pH ${m[3]}, ${m[4]} °C`)]);
  for (const d of documents) for (const m of d.text.matchAll(/(?:^\[[^\]]+\] ([^:]+): |Addendum \([^)]*\): )[^\n]*?(?:says (.+?) but|it says (.+?), the values)[^\n]*?(?:numbers are|really) (.+?)(?: \(|\.)/gm)) unitFix.push([m[1] ?? d.author, unit(m[2] ?? m[3]), unit(m[4])]);
  for (const d of documents.filter(x => /notebook|instrument/.test(x.kind))) {
    const t = d.text, H = t.match(/\[S\] \(([^)]+)\) \| v0 \(([^)]+)\)|S in (.+?), rate in (.+)|S_(\w+)[,;]rate_(\w+)|\[S\] in (\S+), initial rates in (.+?)\. |substrate in (\w+) and rates in ([a-z ]+?) throughout/), H2 = t.match(/rates in (.+?), \[S\] in (.+?)\.|rates below are ([a-z ]+?) and substrate is given in (\w+)/);
    const hs = H ? H.slice(1).filter(Boolean) : H2 ? H2.slice(1).filter(Boolean).reverse() : [null, null]; let cu = unit(hs[0]), ru = unit(hs[1]);
    const fix = unitFix.find(f => f[0] === d.author && f[1] && ru && f[1].c === ru.c && f[1].t === ru.t); if (fix) ru = fix[2];
    const F = t.match(/corresponds to ([\d.]+) µM\/min/), E = t.match(/ε340 = ([\d.]+) mM⁻¹ cm⁻¹, and 200 µL in this plate gives a ([\d.]+) cm/), A = F ? num(F[1]) : E ? 1 / (num(E[1]) * num(E[2])) : null;
    const add = (id, S, Su, v, Vu, cond, note) => { const cU = Su ? unit(Su) : cu, rU = Vu ? unit(Vu) : ru; rows[id] = { S: num(S) * (cU?.c ?? 1), v: A ? Math.abs(num(v)) * A / 60 : num(v) * (rU?.c ?? 1) / (rU?.t ?? 1), cond }; if (EXC.test(note) && !/re-read|re-read at lower gain/.test(note)) excl.add(id); };
    let cond = null; const pos = {};
    for (const L of t.split('\n')) {
      let m; if ((m = L.match(/^(?:### Plate \d+, (.+), replicate|Condition: (.+?)   \(|Plate \d+ \| Assay: (.+?) \|)/))) cond = condOf(m[1] ?? m[2] ?? m[3]);
      if (d.kind === 'instrument') { if ((m = L.match(new RegExp(`^\\d+\\s+\\w\\d\\d\\s+(${ID})\\s+(\\S+)\\s+\\S+\\s+\\d+\\s*(\\S*)`)))) { raw[m[1]] = num(m[2]) * unit(t.match(/Rate\((.+?)\)/)[1]).c / unit(t.match(/Rate\((.+?)\)/)[1]).t; if (EXC.test(m[3])) excl.add(m[1]); } continue; }
      if ((m = L.match(new RegExp(`^\\| (${ID}) \\| \\w+ \\| ([^|]+) \\| ([^|]+) \\| (.*)\\|`)))) add(m[1], m[2], null, m[3], null, cond, m[4]);
      else if ((m = L.match(new RegExp(`^(${ID})[,;]\\d+[,;](\\w+)[,;]("[^"]*"|[^,;]*)[,;]\\d*[,;]([^,;]+)[,;]([^,;]+)[,;](?:[^,;]*[,;])?(.*)$`)))) add(m[1], m[4], null, m[5], null, condOf(m[3]), m[6]);
      else if ((m = L.match(new RegExp(`^(\\w\\d\\d)\\s+(${ID})\\s+(\\S+) (\\S+)\\s+(\\S+)\\s*(?:(\\d+\\.\\d)\\s*)?(\\S*)`)))) { pos[m[1]] = m[2]; add(m[2], m[3], m[4], m[5], null, cond, m[7]); }
      else if ((m = L.match(/^  (\w\d\d): (.*)/)) && pos[m[1]]) { if (EXC.test(m[2])) excl.add(pos[m[1]]); }
      else if ((m = L.match(/^\s+\[S\] = (\S+?)(?: (\S+))?: (.*)$/))) for (const it of m[3].split(' | ')) { const q = it.match(new RegExp(`^r\\d+ (\\S+)(?: → re-read (\\S+))? \\((${ID})(.*)\\)`)); add(q[3], m[1], m[2], q[2] ?? q[1], null, cond, q[4]); }
      else if (/^\d\d:\d\d /.test(L)) { const c = condOf(L.match(/replicate \d+ of (.+?) on plate/)[1]); for (const s of L.split(new RegExp(`(?=(?<!\\()(?:Well \\w+ / )?${ID}\\b|(?<![\\d.,])\\d[\\d.,eE+×^-]*(?: \\S+)? → )`))) {
        const NU = '(-?[\\d.,]+(?:[eE][-+]?\\d+|×10\\^-?\\d+)?)(?: ((?:µ|u|n|m)[^ ,.:)]*(?: s⁻¹| min⁻¹)?))?'; const q = s.match(new RegExp(`(${ID}) \\(${NU}\\): ${NU}\\.|(${ID}) at ${NU} gave ${NU}\\.|^${NU} → ${NU} \\((${ID})\\)\\.|(${ID}), \\[S\\] ${NU}, v0 ${NU}\\.|(${ID}): ${NU} at ${NU}\\.`)); if (!q) continue;
        const g = q.slice(1); const o = [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [14, 10, 11, 12, 13], [15, 16, 17, 18, 19], [20, 23, 24, 21, 22]].find(o => g[o[0]]); add(g[o[0]], g[o[1]], g[o[2]], g[o[3]], g[o[4]], c, s); } }
    }
  }
  for (const [ids, c] of moves) for (const id of ids) if (rows[id]) rows[id].cond = c;
  const by = {}; for (const [id, r] of Object.entries(rows)) if (!excl.has(id)) (by[r.cond] ??= []).push({ S: r.S, v: raw[id] ?? r.v });
  return { conditions: conds.map(c => { const f = fitMM(by[c.condition_id] ?? []); return { condition_id: c.condition_id, vmax: f.vmax, km: f.km }; }), excluded_samples: [...excl].sort() };
}
