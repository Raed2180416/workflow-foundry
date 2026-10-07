// AUDIT 2026-10-07: OVER-BUDGET white-box parser adapted to generator 3.0.0 (62 code lines, ~10.9K characters),
// written with the generator source open; one regex family per template, plus numeric repair of mislabelled rows
// and swaps. It documents the ceiling for template-aware scripted solvers (see ../AUDIT.md); it is not a trivial
// heuristic and not a bad control. Reads only task.inputs.
import { fitMM } from '../fit.mjs';
const num = t => +String(t).replace(',', '.').replace('×10^', 'e').replace(/E\+?/, 'e'), hm = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const unit = s => { s = String(s).replace(/micro/g, 'u').replace(/(n|m)(ano|illi)/g, '$1').replace(/molar/g, 'M').replace(/ per |_per_|\/L\/| /g, '/').replace(/second|s⁻¹/, 's').replace(/minute|min⁻¹/, 'min').replace(/mol(\/L)?/, 'M');
  const m = s.match(/(µ|u|n|m)M(?:\/(s|min))?/); return m ? { c: { µ: 1, u: 1, n: 1e-3, m: 1e3 }[m[1]], t: m[2] === 'min' ? 60 : 1 } : null; };
const STRONG = /still there|had been there|already there|did not move|only removed after|missed it|could not get|showed up halfway|had formed by|a real (air |small |large |tiny )?bubble|reader log has SAT|flagged OVR anyway|OVR in the reader log|but the enzyme went in twice|added the enzyme twice|went in about two minutes late|added, but late|spilled part|volume spilled|got the wrong buffer|wrong buffer bottle|tip came off|tip slipped|appeared during the read|came back and stayed|not gone by the time|two enzyme additions|not on time:|one tip too many/i;
const NEG = /before (the|reading)|after the read|afterwards|no bubble|bubble-free|speck|no SAT|not saturated|did not flag|no OVR|it did not|tip count|on time|next to the plate|stayed on|was clear|log is clean|not over range|saw none|none in this well|end of the day|on the seal|had disappeared when the read began|once the read was over|practice plate|gone by the time the read began|single addition/i;
const KEY = /\bSAT\b|OVR|saturat|over range|bubble|twice|two enzyme|\blate\b|missed|forgotten|spill|lost|wrong (buffer|reagent)|neighbouring buffer|tip (came off|slipped)/i, CP = /pH ?(\d+[.,]\d+)[ ,/]*(\d+) ?°C|(\d+) ?°?C? ?[,/]? ?pH ?(\d+[.,]\d+)|\bC(\d+)\b/g;
const HDR = /\[S\] \(([^)]+)\) \| v0 \(([^)]+)\)|S in (.+?), rate in (.+)|S_(\w+)[,;]rate_(\w+)|\[S\] in (\S+), initial rates in (.+?)\. |substrate in (\w+) and rates in ([a-z ]+?) throughout|rates in (?=.*?\[S\] in (.+?)\.)(.+?), \[S\]|rates below are (?=.*?given in (\w+))([a-z ]+?) and/, NU = /(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+|×10\^-?\d+)?)(?: ((?:µ|u|n|m)[^ ,:)]*(?: s⁻¹| min⁻¹)?))?/g;
export function heuristicSolve(task) {
  const { study, documents } = task.inputs, P = study.sample_id_pattern.split('-')[0], ID = `${P}-\\d{4}`, conds = study.conditions, rows = {}, raw = {}, msgs = [], BC = {}, R = () => Object.entries(rows), pos = {}, rowsOf = {}, LB = {}, PW = {};
  const condOf = a => [...a.matchAll(CP)].map(m => (m[5] ? `C${m[5]}` : conds.find(c => c.pH === num(m[1] ?? m[4]) && c.temperature_C === +(m[2] ?? m[3]) && !c.inhibitor)?.condition_id)).filter(Boolean)[0];
  const hdr = t => t.match(HDR)?.slice(1).filter(Boolean);
  for (const d of documents) for (const L of d.text.split('\n')) { const m = L.match(/^(?:\[[^\]]+\] ([^:]+)|Addendum \([^)]*\)): (.*)/); if (m) msgs.push([m[1] || d.author, m[2]]); }
  documents.filter(x => /notebook|instrument/.test(x.kind)).forEach((d, di) => {
    const t = d.text, rf = t.match(/template as (.+?)'s (\S+) sheet|as on (.+?)'s export of (\S+) |those of the (\S+) sheet by (.+?)\./), src = rf && documents.find(x => x.author === (rf[1] ?? rf[3] ?? rf[6]) && x.date === (rf[2] ?? rf[4] ?? rf[5]));
    const hs = hdr(t) ?? (src && hdr(src.text)) ?? [], cu = unit(hs[0]); let ru = unit(hs[1]), cond = null, blk = null, w = null, plate = null, rp = null;
    if (ru?.t === 1 && msgs.some(([who, x]) => who === d.author && !x.includes('?') && /per.minute|\/min|min⁻¹/.test(x) && !/^No\b|are not|really are|as labelled|nothing on my|did not affect|as written/.test(x))) ru = { ...ru, t: 60 };
    if (ru?.t === 1 && msgs.some(([who, x], i) => who === d.author && /^(Yes|Good catch|Correct|I just checked)/.test(x) && /per.minute/.test(msgs[i - 1]?.[1] ?? ''))) ru = { ...ru, t: 60 };
    const add = (id, S, Su, v, Vu, cnd, note, b, pl, well, rp) => { if (rp) LB[cnd + '#' + rp] = b; const a = Su ? unit(Su) : cu, r = Vu ? unit(Vu) : ru; rows[id] = { S: num(S) * (a?.c ?? 1), v: num(v) * (r?.c ?? 1) / (r?.t ?? 1), cond: cnd, note, blk: b, win: w, author: d.author }; BC[b] = cnd;
      if (pl && well) { pos[pl + well] = id; PW[id] = [pl, well]; (rowsOf[pl + well[0]] ??= []).push(id); } };
    for (const L of t.split('\n')) { let m;
      if ((m = L.match(/^(?:### Plate (\d+), (.+), replicate (\d+)|Condition: (.+?)   \()/))) { cond = condOf(m[2] ?? m[4]); blk = di + L; plate = m[1]; rp = m[3]; }
      if ((m = L.match(/read(?: started| from)? (\d\d:\d\d)(?:;| for|,) (?:\d+ cycles over )?(\d+) min/i))) w = [hm(m[1]), hm(m[1]) + +m[2]];
      if (d.kind === 'instrument') { const u = unit(t.match(/Rate\((.+?)\)/)[1]); if ((m = L.match(new RegExp(`^\\d+\\s+\\w\\d\\d\\s+(${ID})\\s+(\\S+)`)))) raw[m[1]] = num(m[2]) * u.c / u.t; }
      else if ((m = L.match(new RegExp(`^\\| (${ID}) \\| (\\w+) \\| ([^|]+) \\| ([^|]+) \\| (.*)\\|`)))) add(m[1], m[3], null, m[4], null, cond, m[5], blk, plate, m[2], rp);
      else if ((m = L.match(new RegExp(`^(${ID}),(\\d+),(\\w+),("[^"]*"|[^,]*),(\\d*),([^,]+),([^,]+),[^,]*,(.*)$`)))) add(m[1], m[6], null, m[7], null, condOf(m[4]), m[8], di + m[2] + m[4] + m[5], m[2], m[3], m[5]);
      else if ((m = L.match(/^\s+\[S\] = (\S+?)(?: (\S+))?: (.*)$/))) for (const it of m[3].split(' | ')) { const q = it.match(new RegExp(`^r(\\d+) (\\S+) \\((${ID})(.*)\\)`)); add(q[3], m[1], m[2], q[2], null, cond, q[4], blk + q[1], null, null, q[1]); const g = L0.match(new RegExp(`r${q[1]} = plate (\\d+) row (\\w)`)); if (g) (rowsOf[g[1] + g[2]] ??= []).push(q[3]); }
      else if (/^\d\d:\d\d /.test(L)) { const c = condOf(L.match(/replicate \d+ of (.+?) on plate/)[1]); blk = di + L.slice(0, 40); rp = L.match(/replicate (\d+)/)[1];
        for (const s of L.split(new RegExp(`(?=(?<!\\()(?:Well \\w+ / )?${ID}\\b|(?<![\\d.,:])\\d[\\d.,eE+×^-]*(?: \\S+)? → )`))) { const id = s.match(ID)?.[0], x = s.replace(/Well \w+ \/ |v0 /g, '').replace(id, ''), q = [...x.matchAll(NU)];
          if (id && q.length > 1) { const [a, b] = x.startsWith(': ') ? [q[1], q[0]] : q; add(id, a[1], a[2], b[1], b[2], c, s, blk, null, null, rp); } } }
      if (L.startsWith('Condition:')) L0 = L; } });
  var L0 = '';
  for (const [id, x] of Object.entries(raw)) if (rows[id]) rows[id].v = x;
  const cur = (f, S) => f.vmax * S / (f.km + S), lr = (r, f) => Math.log(r.v / cur(f, r.S)), of = c => R().filter(([, r]) => r.cond === c).map(e => e[1]), medFit = rs => { const by = {}; for (const r of rs) (by[r.S] ??= []).push(r.v); return fitMM(Object.entries(by).map(([S, vs]) => ({ S: +S, v: vs.sort((a, b) => a - b)[vs.length >> 1] }))); };
  // numeric reassign: a row that fits another condition much better than its label
  const F = Object.fromEntries(conds.map(c => [c.condition_id, medFit(of(c.condition_id))]));
  for (const b of Object.keys(BC)) { const rs = R().filter(([, r]) => r.blk === b).map(e => e[1]), e = c => rs.map(r => lr(r, F[c]) ** 2).sort((x, y) => x - y)[rs.length >> 1];
    const best = conds.map(c => c.condition_id).sort((x, y) => e(x) - e(y))[0]; if (best !== BC[b] && e(best) * 4 < e(BC[b])) rs.forEach(r => { r.cond = best; }); }
  const excl = new Map();
  const isEx = r => { const n = r.note ?? '', ts = n.match(/\d\d:\d\d/g); if (r.win && ts && /bubble/.test(n)) { const a = hm(ts[0]), b = ts.length > 1 ? hm(ts.at(-1)) : /first|appeared/.test(n) ? 1e9 : a; return a <= r.win[1] && b >= r.win[0]; } return STRONG.test(n) || (KEY.test(n) && !NEG.test(n)); };
  for (const [k, r] of R()) if (isEx(r)) excl.set(k, true);
  const blkOf = x => { const m = x.match(/replicate (\d+) of (.+?)(?: \(| as |[;:,] |\.$|$)/); return m && LB[condOf(m[2]) + '#' + m[1]]; };
  const conc = x => { const m = x.match(/the (-?[\d.]+(?:e-?\d+)?) ((?:µ|u|n|m)(?:M|mol\/L)) well/i); return m && num(m[1]) * unit(m[2]).c; };
  const near = (ids, S) => ids.sort((a, b) => Math.abs(Math.log(rows[a].S / S)) - Math.abs(Math.log(rows[b].S / S)))[0];
  const refs = x => { const b = blkOf(x), S = conc(x); if (b && S) return [near(R().filter(([, r]) => r.blk === b).map(e => e[0]), S)]; return refs0(x); };
  const refs0 = x => [...new Set([...x.matchAll(new RegExp(`(${ID})|plate (\\d+),? (?:well )?(\\w\\d\\d)|well (\\w\\d\\d) on plate (\\d+)`, 'gi'))].map(q => q[1] ?? pos[q[2] ? q[2] + q[3] : q[5] + q[4]]).filter(Boolean))];
  msgs.forEach(([who, x]) => {
    const rk = x.match(/plate (\d+)[^.]*?row (\w)\b|row (\w) of plate (\d+)/i), lb = blkOf(x);
    if ((rk || lb) && /SAT|OVR|over range|saturation/.test(x) && !/no (SAT|over-range|saturation)/.test(x)) { const r = (lb ? R().filter(([, q]) => q.blk === lb).map(e => e[0]) : [...(rowsOf[(rk[1] ?? rk[4]) + (rk[2] ?? rk[3])] ?? [])]).sort((a, b) => rows[b].S - rows[a].S); const S = conc(x); if (r.length) excl.set(S ? near(r, S) : r[/second|one below|next-to/.test(x) ? 1 : 0], true); return; }
    if (/(range|–|…| to | through ).*(condition|set)|swap|wrong way|exchange|other's/.test(x) && !/belongs to/.test(x)) return;
    const ids = refs(x); if (!ids.length) return;
    if (/^(Ignore what I wrote|Scratch my message|Correction to my own note|Please disregard)|I take back/.test(x)) { excl.set(ids[0], false); return; }
    const col = x.match(/one column to the (right|left)/); if (col && PW[ids[0]]) { const [pl, wl] = PW[ids[0]], y = pos[pl + wl[0] + String(+wl.slice(1) + (col[1] === 'right' ? 1 : -1)).padStart(2, '0')]; excl.set(ids[0], false); if (y) excl.set(y, true); return; }
    if (ids.length === 2 && /belongs to|bubble was in|describes|wrong line|was really in/.test(x)) { const z = x.match(new RegExp(`(${ID}) (?:itself was|was fine|did not have|read clean)|wrong with (${ID})`)) ?? [], zz = z[1] ?? z[2] ?? ids[0], y = ids.find(q => q !== zz); excl.set(y, true); excl.set(zz, false); return; }
    if (ids.length === 1 && rows[ids[0]]?.author === who && /^(Yes|Confirmed|You're right)/.test(x)) { excl.set(ids[0], true); return; }
    if (ids.length === 1 && rows[ids[0]]?.author === who && /^(No,|I checked: nothing|Not in)/.test(x)) { excl.set(ids[0], false); return; }
    if (ids.length === 1 && KEY.test(x) && rows[ids[0]]?.author === who) excl.set(ids[0], isEx({ note: x.replace(/^\d\d:\d\d|\(\d{4}-\d\d-\d\d, \d\d:\d\d\)/g, ''), win: rows[ids[0]].win })); });
  // numeric swap repair + strong-residual exclusion
  const out = conds.map(({ condition_id: id }) => { const rs = R().filter(([k, r]) => r.cond === id && !excl.get(k)).map(e => e[1]); let f = medFit(rs); const ok = (r, S) => Math.abs(Math.log(r.v / cur(f, S))) < 0.15, bad = rs.filter(r => Math.abs(lr(r, f)) > 0.38);
    for (const a of bad) for (const b of bad) if (a !== b && ok(a, b.S) && ok(b, a.S)) [a.S, b.S] = [b.S, a.S];
    f = medFit(rs); for (const [k, r] of R()) if (r.cond === id && Math.abs(lr(r, f)) > 0.65) excl.set(k, true);
    f = fitMM(R().filter(([k, r]) => r.cond === id && !excl.get(k)).map(e => e[1])); return { condition_id: id, vmax: f.vmax, km: f.km }; });
  return { conditions: out, excluded_samples: [...excl].filter(e => e[1]).map(e => e[0]).sort() };
}
