// AUDIT 2026-10-07, second pass: OVER-BUDGET white-box parser for generator 4.0.0, written by the second-pass auditor
// with the generator source open (one regex family per template, about 14K characters). Reads only task.inputs; calls
// the bed's NLLS fitter. It documents the ceiling for template-aware scripted solvers on 4.0.0 (../AUDIT.md, F19): any
// template generator admits such a parser. Not a trivial heuristic and not a bad control.
import { fitMM } from '../fit.mjs';
const N = t => +String(t).replace(',', '.').replace('×10^', 'e').replace(/E\+?/, 'e'), H = t => t.slice(0, 2) * 60 + +t.slice(3, 5), md = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen'];
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const U = s => { s = String(s || ''); const m = s.replace(/micro/, 'u').match(/(µ|u|n|m)(M|mol|ano|illi)/); return m && [{ µ: 1, u: 1, n: 1e-3, m: 1e3 }[m[1]], /min/.test(s) ? 60 : 1]; };
const HD = [/\[S\] \((.+?)\) \| v0 \((.+?)\)/, /S in (.+?), rate in (.+)/, /S_(\w+)[,;]rate_(\w+)/, /(?=.*\[S\] in (.+?)\.)rates in (.+?), \[S\]/, /(?=.*given in (\w+))rates below are (.+?) and/, /\[S\] in (\S+), initial rates in (.+?)\. /, /substrate in (\w+) and rates in (.+?) throughout/];
const hd = t => { for (const r of HD) { const m = t.match(r); if (m) return [U(m[1]), U(m[2])]; } };
// side remarks about non-study items
const SIDE = /(Unrelated: |\(|; )(the (blank|standards|pilot|practice|neighbouring|duplicate)|no bubble in the|on the practice|nothing wrong with the|last week|STD-\d|my practice)[^;)|]*\)?/g;
const side = n => n.replace(/^.*as for this well: /, '').replace(SIDE, '');
// order-of-events notes: returns true (excluded), false (kept) or null (not an order note)
const GONE = /popped|tapped out|got the .*?out|knocked|burst|cleared|was gone|was popped|was tapped|still there|not got|not cleared/i, FORMED = /formed|\bappeared|air (had )?got|came up|still clear|no bubble (had|yet)/i;
const START = /read started|read began|first read cycle|started measuring/i, END = /read finished|last read cycle|read ended|stopped measuring/i;
function order(n, w) {
  const LB = /loading bubble|bubble from loading|had seen at loading|that was there at loading/;
  if (!(LB.test(n) || FORMED.test(n)) || !(START.test(n) || END.test(n))) return null;
  const gone = LB.test(n), ys = START.test(n) ? 'start' : 'end';
  const num = n.match(/(\d+|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\b) min/);
  const mins = num ? (WORDS.includes(num[1]) ? WORDS.indexOf(num[1]) : +num[1]) : null;
  if (!gone && ys === 'start') { if (!w || mins == null) return null; return mins < w[1] - w[0]; } // formed N min after the read started
  // which happened first: the bubble event (x) or the read event (y)?
  let xFirst;
  const yPos = n.search(ys === 'start' ? START : END), xPos = n.search(gone ? GONE : FORMED);
  if (/by the time/i.test(n)) xFirst = !/still there|not got|not cleared|still clear|no bubble (had|yet)/.test(n);
  else if (/only once/i.test(n)) xFirst = true;
  else if (/(^|[:;] )first (?!read).*, then/i.test(n.trim())) xFirst = xPos < yPos;
  else { const conn = /\bbefore\b/i.test(n) ? 'before' : 'after'; xFirst = xPos < yPos ? conn === 'before' : conn === 'after'; }
  return gone ? !xFirst : xFirst;
}
const BUB = /stayed until|still there|had been there|did not move|only removed after|already there|missed it|halfway|middle of the read|a real|anyway|came back|not gone/, KEEP = /before|gone|clear|after|was over|disappear|end of the day|no bubble|none|free|speck|seal|practice|right|(?<![Nn]ot )on time|no (SAT|OVR|spill|flag)|not (saturated|over)|it did not|clean|single|stayed on|next to the plate|no tip/i;
const EX = /\bSAT\b|OVR|saturat|over range|bubble|twice|two enzyme|\blate\b|missed|forgotten|spill|lost|wrong (buffer|reagent)|neighbouring buffer|tip (came off|slipped)|air (had )?got|came up/i;
const isEx = (n0, w) => { const n = side(n0.replace(/^"|"$/g, '')); const o = order(n, w); if (o != null) return o; const ts = n.match(/\d\d:\d\d/g); if (w && ts && /bubble/i.test(n)) { const a = H(ts[0]), b = ts[1] ? H(ts.at(-1)) : 1e9; return a <= w[1] && b >= w[0]; } return /has SAT|anyway|flagged SAT|(?<!not )over range|but late|in twice|enzyme twice|too many|wrong buffer|tip (sl|ca)|spilled part/.test(n) || (/bubble/.test(n) && BUB.test(n)) || (EX.test(n) && !KEEP.test(n)); };
export function heuristicSolve(task) {
  const { study: { conditions: C, sample_id_pattern: P }, documents: D } = task.inputs, I = P.slice(0, 2) + '-\\d{4}', R = {}, M = [], pos = {}, LB = {}, raw = {}, rowOf = {}, all = () => Object.entries(R);
  const cid = a => (a.match(/\bC\d\b/) || [])[0] || C.find(c => c.pH === N((a.match(/pH ?(\d+[.,]\d+)/) || [])[1]) && new RegExp(`\\b${c.temperature_C} ?°?C`).test(a))?.condition_id;
  for (const d of D) for (const L of d.text.split('\n')) { const m = L.match(/^(?:\[[^\]]+\] ([^:]+)|Addendum \([^)]*\)): (.*)/); if (m) M.push([m[1] || d.author, m[2]]); }
  for (const d of D.filter(x => /notebook|instrument/.test(x.kind))) {
    const t = d.text, rf = t.match(/(?:template as|as on|those of the) .*?(\d{4}-\d\d-\d\d).*/), src = rf && D.find(x => x.date === rf[1] && rf[0].includes(x.author) && x.kind === 'notebook');
    let [cu, ru] = hd(t) ?? (src && hd(src.text)) ?? [], c, b, w, pl, rp, G = {};
    const add = (id, S, Su, v, Vu, cc, n, bb, p, wl, rr) => { const a = U(Su) ?? cu ?? [1, 1], z = U(Vu) ?? ru ?? [1, 1]; R[id] = { S: N(S) * a[0], v: N(v) * z[0] / z[1], c: cc, n: n || '', b: bb, w, a: d.author, d: d.doc_id, p, wl }; LB[cc + '#' + rr] = bb; if (p) { (rowOf[p + bb.r] ??= []).push(id); if (wl) pos[p + wl] = id; } };
    for (const L of t.split('\n')) { let m;
      if ((m = L.match(/read(?: started| from)? (\d\d:\d\d)(?:; \d+ cycles over|,| for) (\d+) min/i))) w = [H(m[1]), H(m[1]) + +m[2]];
      if (d.kind === 'instrument') { const z = U(t.match(/Rate\((.+?)\)/)[1]); if ((m = L.match(new RegExp(`^\\d+\\s+\\w\\d\\d\\s+(${I})\\s+(\\S+)`)))) raw[m[1]] = N(m[2]) * z[0] / z[1]; }
      else if ((m = L.match(/^### Plate (\d+), (.+), replicate (\d+)/))) { c = cid(m[2]); rp = m[3]; pl = m[1]; b = { k: d.doc_id + L }; }
      else if ((m = L.match(new RegExp(`^\\| (${I}) \\| (\\w+) \\| ([^|]+) \\| ([^|]+) \\| (.*)\\|`)))) { b.r = m[2][0]; add(m[1], m[3], 0, m[4], 0, c, m[5], b, pl, m[2], rp); }
      else if ((m = L.match(new RegExp(`^(${I}),(\\d+),(\\w+),("[^"]*"|[^,]*),(\\d*),([^,]+),([^,]+),[^,]*,(.*)$`)) ?? L.match(new RegExp(`^(${I});(\\d+);(\\w+);([^;]*);(\\d*);([^;]+);([^;]+);(.*)$`)))) { const k = d.doc_id + m[4] + m[5]; G[k] ??= { k, r: m[3][0] }; add(m[1], m[6], 0, m[7], 0, cid(m[4]), m[8], G[k], m[2], m[3], m[5]); }
      else if ((m = L.match(/^Condition: (.+?)   \((.*)\)/))) { c = cid(m[1]); G = {}; for (const q of m[2].matchAll(/r(\d+) = plate (\d+) row (\w)/g)) G[q[1]] = { k: d.doc_id + L + q[1], r: q[3], p: q[2] }; }
      else if ((m = L.match(/^\s+\[S\] = (\S+?)(?: (\S+))?: (.*)$/))) for (const it of m[3].split(' | ')) { const q = it.match(new RegExp(`^r(\\d+) (\\S+) \\((${I});? ?(.*)\\)`)); add(q[3], m[1], m[2], q[2], 0, c, q[4], G[q[1]], G[q[1]].p, 0, q[1]); }
      else if ((m = L.match(/^\d\d:\d\d \w+(?: up)? replicate (\d+) of (.+?) on plate (\d+)\. /))) { c = cid(m[2]); b = { k: d.doc_id + L.slice(0, 30) }; let last;
        for (const s of L.split(/\.\s+/)) { const id = s.match(I)?.[0]; if (!id) { if (last) R[last].n += ' ' + s; continue; }
          const x = s.replace(/Well \w+ \/ |v0 /g, '').replace(id, ''), q = [...x.matchAll(/(-?\d[\d.,]*(?:[eE][-+]?\d+|×10\^-?\d+)?)(?: ([µunm][^ ,:)]*(?: \S+⁻¹)?))?/g)], [A, B] = /^: /.test(x) ? [q[1], q[0]] : q;
          add(id, A[1], A[2], B[1], B[2], c, '', b, m[3], 0, m[1]); last = id; } } } }
  for (const [id, x] of Object.entries(raw)) if (R[id]) R[id].v = x;
  const V = () => Object.values(R), near = (a, b) => Math.abs(Math.log(a / b)) < 0.01;
  for (const d of new Set(V().map(r => r.d))) { const q = V().filter(r => r.d === d).map(r => { const o = V().filter(x => x.d !== d && x.c === r.c && near(x.S, r.S)).map(x => x.v); return o.length && r.v / md(o); }).filter(Boolean); if (q.length > 3 && md(q) > 20) V().filter(r => r.d === d).forEach(r => { r.v /= 60; }); }
  const cur = (f, S) => f.vmax * S / (f.km + S), lr = (r, f) => Math.log(r.v / cur(f, r.S)), mf = rs => { const by = {}; for (const r of rs) (by[r.S] ??= []).push(r.v); return fitMM(Object.entries(by).map(([S, vs]) => ({ S: +S, v: md(vs) }))); };
  const F = Object.fromEntries(C.map(({ condition_id: c }) => [c, mf(V().filter(r => r.c === c))]));
  for (const b of new Set(V().map(r => r.b))) { const rs = V().filter(r => r.b === b), e = c => md(rs.map(r => lr(r, F[c]) ** 2)), best = C.map(x => x.condition_id).sort((x, y) => e(x) - e(y))[0]; if (best !== rs[0].c && e(best) * 4 < e(rs[0].c)) rs.forEach(r => { r.c = best; }); }
  // enzyme dose from the master-mix log (or the keeper's later correction)
  const dose = {};
  const log = D.find(x => /^# Master-mix log/.test(x.text));
  if (log) for (const L of log.text.split('\n')) { const m = L.match(/^- MM-\d+, (.+?): (.*)$/); if (!m || /poured away|discarded|someone asked|almost|pilot plate had|label on the tube/.test(m[2])) continue; const d = /twice the standard|diluted half as much/.test(m[2]) ? 250 : /half the standard|diluted twice as much/.test(m[2]) ? 1000 : [...m[2].matchAll(/1:(\d+)|(\d+)-fold|1 in (\d+)/g)].map(q => +(q[1] ?? q[2] ?? q[3])).find(x => x !== 500); if (d) dose[cid(m[1])] = d / 500; }
  for (const [, x] of M) { const m = x.match(/(?:log: the|log is wrong for|got the enzyme|Found my dilutor note:) ?(.+?)(?: mix| got|:).*?1:(\d+)/); if (m && /master-mix log|dilutor/.test(x) && +m[2] !== 500) { const c = cid(m[1]); if (c) dose[c] = +m[2] / 500; } }
  for (const r of V()) if (dose[r.c]) r.v *= dose[r.c];
  const ex = new Map(); for (const [k, r] of all()) if (r.n && isEx(r.n, r.w)) ex.set(k, 1);
  const conc = x => { const m = x.match(/the ([\d.]+) (\S+) well/i); return m && N(m[1]) * U(m[2])[0]; }, lab = x => { const m = x.match(/replicate (\d+) of (.+?)(?: \(| as | on |[;:] |, \d{4}|\.$|$)/); return m && LB[cid(m[2]) + '#' + m[1]]; };
  const refs = x => { const b = lab(x), S = conc(x); if (b && S) return V().filter(r => r.b === b).map(r => [Math.abs(Math.log(r.S / S)), Object.keys(R).find(k => R[k] === r)]).sort((p, q) => p[0] - q[0]).slice(0, 1).map(p => p[1]);
    const out = [];
    for (const q of x.matchAll(new RegExp(`(${I})|plate (\\d+),? (?:well )?(\\w\\d\\d)|well (\\w\\d\\d) on plate (\\d+)|the (\\w+) study well (?:\\(counting from the left\\) of|from the (?:left|right) in) plate (\\d+),? row (\\w)|plate (\\d+), row (\\w), (\\w+) study well counting from the right`, 'gi'))) {
      let id = q[1] ?? (q[6] ? (rowOf[q[7] + q[8]] ?? [])[ORD.indexOf(q[6])] : q[9] ? (rowOf[q[9] + q[10]] ?? [])[ORD.indexOf(q[11])] : pos[q[2] ? q[2] + q[3] : q[5] + q[4]]);
      if ((q[6] || q[9]) && /from the right|counting from the right/.test(q[0])) { const L = rowOf[(q[7] ?? q[9]) + (q[8] ?? q[10])] ?? []; id = L[L.length - 1 - ORD.indexOf(q[6] ?? q[11])]; }
      if (id && !out.includes(id)) out.push(id); }
    return out; };
  for (const [who, x0] of M) {
    const x = side(x0);
    const rk = x.match(/plate (\d+)\D*?row (\w)\b|row (\w) of plate (\d+)/i), lb = lab(x);
    if ((rk || lb) && /SAT|OVR|over range|saturation/.test(x) && !/no (SAT|over|satur)/.test(x) && !/study well/.test(x)) { const ids = (lb ? Object.keys(R).filter(k => R[k].b === lb) : [...rowOf[(rk[1] ?? rk[4]) + (rk[2] ?? rk[3])] ?? []]).sort((a, b) => R[b].S - R[a].S), S = conc(x); if (ids.length) ex.set(S ? ids.find(k => near(R[k].S, S)) ?? ids[0] : ids[/second|one below|next-to/.test(x) ? 1 : 0], 1); continue; }
    if (/swap|wrong way|exchange|other's|–|…|through\b|\d to [A-Z]/.test(x) && !/belongs|really in|column|wrong well|meant|is about/.test(x)) continue;
    const ids = refs(x); if (!ids.length) continue;
    if (/^(Ignore|Scratch|Correction to my own|Please disregard|What I posted|Forget my|Looked at the photo)|take back/.test(x)) { ex.set(ids[0], 0); continue; }
    const col = x.match(/column to the (right|left)/); if (col) { const r = R[ids[0]]; ex.set(ids[0], 0); const y = pos[r.p + r.wl[0] + String(+r.wl.slice(1) + (col[1] === 'right' ? 1 : -1)).padStart(2, '0')]; if (y) ex.set(y, 1); continue; }
    if (ids.length >= 2) { const z = x.match(new RegExp(`(${I})(?: \\([^)]*\\))? (?:itself|was fine|did not|read clean|had nothing)|with (${I})|not (?:in )?(${I})|typed (${I})`)) ?? [], zz = z[1] ?? z[2] ?? z[3] ?? z[4] ?? ids[0]; ex.set(zz, 0); ex.set(ids.find(q => q !== zz), 1); continue; }
    if (R[ids[0]]?.a !== who) continue;
    if (/\?|I was at the bench|suggest this|I think/.test(x)) continue;
    // an answer to a colleague's report: polarity in the content
    if (/nothing like that|thinking of a different|sheet is complete|clean the whole time|not this one|busy day|practice plate had it|nothing of the sort|perfectly normal|none of that|did not have it|wrong well: not/.test(x)) { ex.set(ids[0], 0); continue; }
    if (/that's right|Confirmed for|You're right about|Yes for|that's on me|No point denying|you are right: it happened|proves you right|I'm afraid|Sadly yes|Nothing to add|as well\.|not imagining|did have it|I saw it myself/.test(x)) { ex.set(ids[0], 1); continue; }
    if (EX.test(x) || /loading|formed|appeared/.test(x)) ex.set(ids[0], isEx(x.replace(/\d{4}-\d\d-\d\d/g, ''), R[ids[0]].w) ? 1 : 0); }
  const out = C.map(({ condition_id: c }) => { const rs = all().filter(([k, r]) => r.c === c && !ex.get(k)).map(e => e[1]); let f = mf(rs); const bad = rs.filter(r => Math.abs(lr(r, f)) > 0.38), g = mf(rs.filter(r => !bad.includes(r))), ok = (r, S) => Math.abs(Math.log(r.v / cur(g, S))) < 0.15;
    for (const a of bad) for (const b of bad) if (a !== b && a.b === b.b && ok(a, b.S) && ok(b, a.S)) [a.S, b.S] = [b.S, a.S];
    f = mf(rs); for (const [k, r] of all()) if (r.c === c && Math.abs(lr(r, f)) > 0.65) ex.set(k, 1);
    f = fitMM(all().filter(([k, r]) => r.c === c && !ex.get(k)).map(e => e[1])); return { condition_id: c, vmax: f.vmax, km: f.km }; });
  return { conditions: out, excluded_samples: [...ex].filter(e => e[1] && e[0]).map(e => e[0]).sort() };
}
