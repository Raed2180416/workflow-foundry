// AUDIT 2026-10-07 (F8, F9): residual-hybrid triviality attack, written against generator 2.0.0 within the
// attack budget (<=40 code lines, <=7000 characters; comment lines excluded). It reads only task.inputs and
// barely reads prose: it parses the sheets and the raw export, takes the units-trap fix from the author's
// message, then finds the mislabelled row from register planned_replicates vs labelled row counts (F8), repairs
// swaps numerically, and excludes wells whose rate is more than e^0.38 off a robust fit, plus row notes by
// keyword (F9). Against 2.0.0 it passed 16/30 d3 test seeds (5000-5029) and 13/30 dev seeds (1-30); against
// 3.0.0 it passes 0/30. Uses the bed's NLLS fitter (fitting is computation, not judgment).
import { fitMM } from '../fit.mjs';
const num = t => +t.replace('×10^', 'e').replace(/E\+?/, 'e'), hm = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const unit = s => { s = String(s).replace(/micro/g, 'u').replace(/(n|m)(ano|illi)/g, '$1').replace(/molar/g, 'M').replace(/ per |_per_|\/L\/| /g, '/').replace(/second|s⁻¹/, 's').replace(/minute|min⁻¹/, 'min').replace(/mol(\/L)?/, 'M');
  const m = s.match(/(µ|u|n|m)M(?:\/(s|min))?/); return m ? { c: { µ: 1, u: 1, n: 1e-3, m: 1e3 }[m[1]], t: m[2] === 'min' ? 60 : 1 } : null; };
const STRONG = /still there|had been there|already there|did not move|only removed after|missed it|could not get/i, NEG = /before (the|reading)|after the read|afterwards|no bubble|bubble-free|speck|no SAT|not saturated|did not flag|no OVR|it did not|tip count|on time|next to the plate|stayed on|was clear/i, KEY = /\bSAT\b|OVR|saturat|over range|bubble|twice|two enzyme|\blate\b|missed|forgotten|spill|lost|wrong (buffer|reagent)|neighbouring buffer|tip (came off|slipped)/i, CP = /pH ?(\d+[.,]\d+)[ ,/]*(\d+) ?°C|(\d+) ?°?C? ?[,/]? ?pH ?(\d+[.,]\d+)|\bC(\d+)\b/g;
const HDR = /\[S\] \(([^)]+)\) \| v0 \(([^)]+)\)|S in (.+?), rate in (.+)|S_(\w+)[,;]rate_(\w+)|\[S\] in (\S+), initial rates in (.+?)\. |substrate in (\w+) and rates in ([a-z ]+?) throughout|rates in (?=.*?\[S\] in (.+?)\.)(.+?), \[S\]|rates below are (?=.*?given in (\w+))([a-z ]+?) and/, NU = /(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+|×10\^-?\d+)?)(?: ((?:µ|u|n|m)[^ ,:)]*(?: s⁻¹| min⁻¹)?))?/g;
export function heuristicSolve(task) {
  const { study, documents } = task.inputs, P = study.sample_id_pattern.split('-')[0], ID = `${P}-\\d{4}`, conds = study.conditions, rows = {}, raw = {}, msgs = [], BC = {}, R = () => Object.entries(rows);
  const condOf = a => [...a.matchAll(CP)].map(m => (m[5] ? `C${m[5]}` : conds.find(c => c.pH === num(m[1] ?? m[4]) && c.temperature_C === +(m[2] ?? m[3]) && !c.inhibitor)?.condition_id)).filter(Boolean)[0];
  const hdr = t => t.match(HDR)?.slice(1).filter(Boolean);
  for (const d of documents) for (const L of d.text.split('\n')) { const m = L.match(/^(?:\[[^\]]+\] ([^:]+)|Addendum \([^)]*\)): (.*)/); if (m) msgs.push([m[1] || d.author, m[2]]); }
  documents.filter(x => /notebook|instrument/.test(x.kind)).forEach((d, di) => {
    const t = d.text, rf = t.match(/template as (.+?)'s (\S+) sheet|as on (.+?)'s export of (\S+) |those of the (\S+) sheet by (.+?)\./), src = rf && documents.find(x => x.author === (rf[1] ?? rf[3] ?? rf[6]) && x.date === (rf[2] ?? rf[4] ?? rf[5]));
    const hs = hdr(t) ?? (src && hdr(src.text)) ?? [], cu = unit(hs[0]); let ru = unit(hs[1]), cond = null, blk = null, w = null;
    if (ru?.t === 1 && msgs.some(([who, x]) => who === d.author && !x.includes('?') && /per.minute|\/min|min⁻¹/.test(x) && !/^No\b|are not|really are|as labelled|nothing on my|did not affect|as written/.test(x))) ru = { ...ru, t: 60 };
    const add = (id, S, Su, v, Vu, cnd, note, b) => { const a = Su ? unit(Su) : cu, r = Vu ? unit(Vu) : ru; rows[id] = { S: num(S) * (a?.c ?? 1), v: num(v) * (r?.c ?? 1) / (r?.t ?? 1), cond: cnd, note, blk: b, win: w }; BC[b] = cnd; };
    for (const L of t.split('\n')) { let m;
      if ((m = L.match(/^(?:### Plate \d+, (.+), replicate|Condition: (.+?)   \()/))) { cond = condOf(m[1] ?? m[2]); blk = di + L; }
      if ((m = L.match(/read(?: started| from)? (\d\d:\d\d)(?:;| for|,) (?:\d+ cycles over )?(\d+) min/i))) w = [hm(m[1]), hm(m[1]) + +m[2]];
      if (d.kind === 'instrument') { const u = unit(t.match(/Rate\((.+?)\)/)[1]); if ((m = L.match(new RegExp(`^\\d+\\s+\\w\\d\\d\\s+(${ID})\\s+(\\S+)`)))) raw[m[1]] = num(m[2]) * u.c / u.t; }
      else if ((m = L.match(new RegExp(`^\\| (${ID}) \\| \\w+ \\| ([^|]+) \\| ([^|]+) \\| (.*)\\|`)))) add(m[1], m[2], null, m[3], null, cond, m[4], blk);
      else if ((m = L.match(new RegExp(`^(${ID}),(\\d+),\\w+,("[^"]*"|[^,]*),(\\d*),([^,]+),([^,]+),[^,]*,(.*)$`)))) add(m[1], m[5], null, m[6], null, condOf(m[3]), m[7], di + m[2] + m[3] + m[4]);
      else if ((m = L.match(/^\s+\[S\] = (\S+?)(?: (\S+))?: (.*)$/))) for (const it of m[3].split(' | ')) { const q = it.match(new RegExp(`^r(\\d+) (\\S+) \\((${ID})(.*)\\)`)); add(q[3], m[1], m[2], q[2], null, cond, q[4], blk + q[1]); }
      else if (/^\d\d:\d\d /.test(L)) { const c = condOf(L.match(/replicate \d+ of (.+?) on plate/)[1]); blk = di + L.slice(0, 40);
        for (const s of L.split(new RegExp(`(?=(?<!\\()(?:Well \\w+ / )?${ID}\\b|(?<![\\d.,:])\\d[\\d.,eE+×^-]*(?: \\S+)? → )`))) { const id = s.match(ID)?.[0], x = s.replace(/Well \w+ \/ |v0 /g, '').replace(id, ''), q = [...x.matchAll(NU)];
          if (id && q.length > 1) { const [a, b] = x.startsWith(': ') ? [q[1], q[0]] : q; add(id, a[1], a[2], b[1], b[2], c, s, blk); } } } } });
  for (const [id, x] of Object.entries(raw)) if (rows[id]) rows[id].v = x;
  const cur = (f, S) => f.vmax * S / (f.km + S), lr = (r, f) => Math.log(r.v / cur(f, r.S)), of = c => R().filter(([, r]) => r.cond === c).map(e => e[1]), medFit = rs => { const by = {}; for (const r of rs) (by[r.S] ??= []).push(r.v); return fitMM(Object.entries(by).map(([S, vs]) => ({ S: +S, v: vs.sort((a, b) => a - b)[vs.length >> 1] }))); };
  const cnt = {}; for (const c of Object.values(BC)) cnt[c] = (cnt[c] ?? 0) + 1; const [Y] = conds.filter(c => cnt[c.condition_id] > c.planned_replicates), [X] = conds.filter(c => (cnt[c.condition_id] ?? 0) < c.planned_replicates);
  if (X && Y) { const fX = medFit(of(X.condition_id)), fY = medFit(of(Y.condition_id)), sc = b => R().filter(([, r]) => r.blk === b).reduce((s, [, r]) => s + lr(r, fX) ** 2 - lr(r, fY) ** 2, 0);
    const best = Object.keys(BC).filter(b => BC[b] === Y.condition_id).sort((a, b) => sc(a) - sc(b))[0]; R().forEach(([, r]) => { if (r.blk === best) r.cond = X.condition_id; }); }
  const CL = new Set(msgs.filter(([, x]) => /fine|clear|did not have|wrong (row|line)|row off|belongs to|describes/.test(x)).flatMap(([, x]) => x.match(new RegExp(ID, 'g')) ?? []));
  const isEx = r => { const n = r.note ?? '', ts = n.match(/\d\d:\d\d/g); if (r.win && ts && /bubble/.test(n)) { const a = hm(ts[0]), b = ts.length > 1 ? hm(ts.at(-1)) : /first|appeared/.test(n) ? 1e9 : a; return a <= r.win[1] && b >= r.win[0]; } return STRONG.test(n) || (KEY.test(n) && !NEG.test(n)); };
  const excl = new Set(), out = conds.map(({ condition_id: id }) => { const rs = of(id); let f = medFit(rs); const far = r => Math.abs(lr(r, f)) > 0.38, ok = (r, S) => Math.abs(Math.log(r.v / cur(f, S))) < 0.15, bad = rs.filter(far);
    for (const a of bad) for (const b of bad) if (a !== b && ok(a, b.S) && ok(b, a.S)) [a.S, b.S] = [b.S, a.S];
    for (let i = 0; i < 3; i++) f = fitMM(rs.filter(r => !far(r)));
    for (const [k, r] of R()) if (r.cond === id && (far(r) || (isEx(r) && !CL.has(k)))) excl.add(k);
    f = fitMM(R().filter(([k, r]) => r.cond === id && !excl.has(k)).map(e => e[1])); return { condition_id: id, vmax: f.vmax, km: f.km }; }); return { conditions: out, excluded_samples: [...excl].sort() };
}
