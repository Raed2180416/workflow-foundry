// AUDIT 2026-10-07: attack adapted to generator 3.0.0 by the auditor (45 code lines, ~8.6K characters: slightly
// OVER the attack budget). Parses all d3 formats, fixes units (header, preamble, template reference, the author's
// per-minute message or confirmation), repairs mislabelled rows and swaps numerically, classifies row notes and
// messages with keyword lists (including the 3.0.0 phrasings), clock-time windows, plate/row rank flags, moved
// notes, withdrawals and colleague reports with the author's answer. It does not resolve wells named by condition
// label + replicate + concentration. See ../AUDIT.md for its pass rates.
import { fitMM } from '../fit.mjs';
const num = t => +t.replace('×10^', 'e').replace(/E\+?/, 'e'), hm = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const unit = s => { s = String(s).replace(/micro/g, 'u').replace(/(n|m)(ano|illi)/g, '$1').replace(/molar/g, 'M').replace(/ per |_per_|\/L\/| /g, '/').replace(/second|s⁻¹/, 's').replace(/minute|min⁻¹/, 'min').replace(/mol(\/L)?/, 'M');
  const m = s.match(/(µ|u|n|m)M(?:\/(s|min))?/); return m ? { c: { µ: 1, u: 1, n: 1e-3, m: 1e3 }[m[1]], t: m[2] === 'min' ? 60 : 1 } : null; };
const STRONG = /still there|had been|already there|did not move|only removed|missed it|could not get|showed up|had formed by|a real|reader log has|anyway|in the reader log|enzyme went in twice|enzyme twice|minutes late|but late|spilled part|volume spilled|wrong buffer|tip came off|tip slipped|during the read and|came back|not gone|two enzyme add|not on time|too many/i;
const NEG = /before (the|reading)|after the read|afterwards|no bubble|bubble-free|speck|no SAT|not satur|did not flag|no OVR|it did not|tip count|on time|next to the plate|stayed on|was clear|clean|not over|saw none|none in|end of the day|on the seal|disappeared|was over|practice|gone by|single add/i, KEY = /SAT|OVR|satur|over range|bubble|twice|two enzyme|late\b|missed|forgotten|spill|lost|wrong (buffer|reagent)|tip (came|slipped)/i;
const CP = /pH ?(\d+[.,]\d+)[ ,/]*(\d+) ?°C|(\d+) ?°?C? ?[,/]? ?pH ?(\d+[.,]\d+)|\bC(\d+)\b/g, NU = /(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+|×10\^-?\d+)?)(?: ((?:µ|u|n|m)[^ ,:)]*(?: s⁻¹| min⁻¹)?))?/g;
const HDR = /\[S\] \(([^)]+)\) \| v0 \(([^)]+)\)|S in (.+?), rate in (.+)|S_(\w+),rate_(\w+)|\[S\] in (\S+), initial rates in (.+?)\. |substrate in (\w+) and rates in ([a-z ]+?) throughout|rates in (?=.*?\[S\] in (.+?)\.)(.+?), \[S\]|rates below are (?=.*?given in (\w+))([a-z ]+?) and/;
export function heuristicSolve(task) {
  const { study, documents } = task.inputs, ID = study.sample_id_pattern.slice(0, 2) + '-\\d{4}', conds = study.conditions, rows = {}, raw = {}, msgs = [], BC = {}, R = () => Object.entries(rows), pos = {}, rowsOf = {}, X = new Map();
  const condOf = a => [...a.matchAll(CP)].map(m => (m[5] ? `C${m[5]}` : conds.find(c => c.pH === num(m[1] ?? m[4]) && c.temperature_C === +(m[2] ?? m[3]) && !c.inhibitor)?.condition_id)).filter(Boolean)[0];
  for (const d of documents) for (const L of d.text.split('\n')) { const m = L.match(/^(?:\[[^\]]+\] ([^:]+)|Addendum \([^)]*\)): (.*)/); if (m) msgs.push([m[1] || d.author, m[2]]); }
  documents.filter(x => /notebook|instr/.test(x.kind)).forEach((d, di) => {
    const t = d.text, rf = t.match(/template as (.+?)'s (\S+) sheet|as on (.+?)'s export of (\S+) |those of the (\S+) sheet by (.+?)\./), src = rf && documents.find(x => x.author === (rf[1] ?? rf[3] ?? rf[6]) && x.date === (rf[2] ?? rf[4] ?? rf[5]));
    const hs = (t.match(HDR) ?? src?.text.match(HDR) ?? []).slice(1).filter(Boolean), cu = unit(hs[0]); let ru = unit(hs[1]), cond, blk, w, pl, L0 = '';
    if (ru?.t === 1 && msgs.some(([who, x], i) => who === d.author && (/^(Yes|Good catch|Correct|I just)/.test(x) && /per.minute/.test(msgs[i - 1]?.[1]) || !x.includes('?') && /per.minute|\/min|min⁻¹/.test(x) && !/^No\b|are not|really are|as labelled|nothing on|did not affect|as written/.test(x)))) ru = { ...ru, t: 60 };
    const add = (id, S, Su, v, Vu, c, note, b, p, wl) => { const a = Su ? unit(Su) : cu, r = Vu ? unit(Vu) : ru; rows[id] = { S: num(S) * (a?.c ?? 1), v: num(v) * (r?.c ?? 1) / (r?.t ?? 1), cond: c, note, blk: b, win: w, by: d.author }; BC[b] = c; if (p) { pos[p + wl] = id; (rowsOf[p + wl[0]] ??= []).push(id); } };
    for (const L of t.split('\n')) { let m;
      if ((m = L.match(/^(?:### Plate (\d+), (.+), replicate|Condition: (.+?)   \()/))) { cond = condOf(m[2] ?? m[3]); blk = di + L; pl = m[1]; L0 = L; }
      if ((m = L.match(/read(?: started| from)? (\d\d:\d\d)(?:;| for|,) (?:\d+ cycles over )?(\d+) min/i))) w = [hm(m[1]), hm(m[1]) + +m[2]];
      if (d.kind[0] === 'i') { const u = unit(t.match(/Rate\((.+?)\)/)[1]); if ((m = L.match(new RegExp(`^\\d+\\s+\\w\\d\\d\\s+(${ID})\\s+(\\S+)`)))) raw[m[1]] = num(m[2]) * u.c / u.t; }
      else if ((m = L.match(new RegExp(`^\\| (${ID}) \\| (\\w+) \\| ([^|]+) \\| ([^|]+) \\| (.*)\\|`)))) add(m[1], m[3], 0, m[4], 0, cond, m[5], blk, pl, m[2]);
      else if ((m = L.match(new RegExp(`^(${ID}),(\\d+),(\\w+),("[^"]*"|[^,]*),(\\d*),([^,]+),([^,]+),[^,]*,(.*)$`)))) add(m[1], m[6], 0, m[7], 0, condOf(m[4]), m[8], di + m[2] + m[4] + m[5], m[2], m[3]);
      else if ((m = L.match(/^\s+\[S\] = (\S+?)(?: (\S+))?: (.*)$/))) for (const it of m[3].split(' | ')) { const q = it.match(new RegExp(`^r(\\d+) (\\S+) \\((${ID})(.*)\\)`)), g = L0.match(`r${q[1]} = plate (\\d+) row (\\w)`); add(q[3], m[1], m[2], q[2], 0, cond, q[4], blk + q[1]); if (g) (rowsOf[g[1] + g[2]] ??= []).push(q[3]); }
      else if (/^\d\d:\d\d /.test(L)) { const c = condOf(L.match(/of (.+?) on plate/)[1]); blk = di + L.slice(0, 40);
        for (const s of L.split(new RegExp(`(?=(?<!\\()(?:Well \\w+ / )?${ID}\\b|(?<![\\d.,:])\\d[\\d.,eE+×^-]*(?: \\S+)? → )`))) { const id = s.match(ID)?.[0], x = s.replace(/Well \w+ \/ |v0 /g, '').replace(id, ''), q = [...x.matchAll(NU)];
          if (id && q.length > 1) { const [a, b] = x.startsWith(': ') ? [q[1], q[0]] : q; add(id, a[1], a[2], b[1], b[2], c, s, blk); } } } } });
  for (const [id, x] of Object.entries(raw)) if (rows[id]) rows[id].v = x;
  const cur = (f, S) => f.vmax * S / (f.km + S), lr = (r, f) => Math.log(r.v / cur(f, r.S)), of = c => R().filter(([, r]) => r.cond === c).map(e => e[1]), med = rs => { const by = {}; for (const r of rs) (by[r.S] ??= []).push(r.v); return fitMM(Object.entries(by).map(([S, vs]) => ({ S: +S, v: vs.sort((a, b) => a - b)[vs.length >> 1] }))); };
  const F = Object.fromEntries(conds.map(c => [c.condition_id, med(of(c.condition_id))]));
  for (const b in BC) { const rs = R().filter(([, r]) => r.blk === b).map(e => e[1]), e = c => rs.map(r => lr(r, F[c]) ** 2).sort((x, y) => x - y)[rs.length >> 1], best = conds.map(c => c.condition_id).sort((x, y) => e(x) - e(y))[0]; if (e(best) * 4 < e(BC[b])) rs.forEach(r => { r.cond = best; }); }
  const isEx = r => { const n = r.note ?? '', ts = n.match(/\d\d:\d\d/g); if (r.win && ts && /bubble/.test(n)) { const a = hm(ts[0]), b = ts.length > 1 ? hm(ts.at(-1)) : /first/.test(n) ? 1e9 : a; return a <= r.win[1] && b >= r.win[0]; } return STRONG.test(n) || (KEY.test(n) && !NEG.test(n)); };
  for (const [k, r] of R()) if (isEx(r)) X.set(k, true);
  const refs = x => [...new Set([...x.matchAll(new RegExp(`(${ID})|plate (\\d+),? (?:well )?(\\w\\d\\d)|well (\\w\\d\\d) on plate (\\d+)`, 'gi'))].map(q => q[1] ?? pos[q[2] ? q[2] + q[3] : q[5] + q[4]]).filter(Boolean))];
  for (const [who, x] of msgs) { const rk = x.match(/plate (\d+)[^.]*?row (\w)\b|row (\w) of plate (\d+)/i);
    if (rk && /SAT|OVR/.test(x) && !/no (SAT|over|satur)/.test(x)) { const r = (rowsOf[(rk[1] ?? rk[4]) + (rk[2] ?? rk[3])] ?? []).sort((a, b) => rows[b].S - rows[a].S); if (r.length) X.set(r[/second|one below|next-to/.test(x) ? 1 : 0], true); continue; }
    const ids = refs(x), mine = rows[ids[0]]?.by === who; if (!ids.length || /(–|…| to | through ).*(condition|set)|swap|wrong way|exchange|other's/.test(x) && !/belongs to/.test(x)) continue;
    if (/^(Ignore|Scratch|Correction to my own|Please disregard)|take back/.test(x)) X.set(ids[0], false);
    else if (ids.length === 2 && /belongs to|bubble was in|describes|wrong line|really in/.test(x)) { const z = x.match(new RegExp(`(${ID}) (?:itself|was fine|did not have|read clean)|wrong with (${ID})`)) ?? [], zz = z[1] ?? z[2] ?? ids[0]; X.set(ids.find(q => q !== zz), true); X.set(zz, false); }
    else if (ids.length === 1 && mine) X.set(ids[0], /^(Yes|Confirmed|You're right)/.test(x) || !/^(No,|I checked: nothing|Not in)/.test(x) && KEY.test(x) && isEx({ note: x.replace(/\d\d:\d\d\)/g, ''), win: rows[ids[0]].win })); }
  const out = conds.map(({ condition_id: id }) => { const rs = R().filter(([k, r]) => r.cond === id && !X.get(k)).map(e => e[1]); let f = med(rs); const ok = (r, S) => Math.abs(Math.log(r.v / cur(f, S))) < 0.15, bad = rs.filter(r => Math.abs(lr(r, f)) > 0.38);
    for (const a of bad) for (const b of bad) if (a !== b && ok(a, b.S) && ok(b, a.S)) [a.S, b.S] = [b.S, a.S];
    f = fitMM(R().filter(([k, r]) => r.cond === id && !X.get(k)).map(e => e[1])); return { condition_id: id, vmax: f.vmax, km: f.km }; });
  return { conditions: out, excluded_samples: [...X].filter(e => e[1]).map(e => e[0]).sort() };
}
