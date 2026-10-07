// AUDIT step 4, best within-budget attack against generator 2.x (<=40 code lines, <=7000 characters,
// comment lines excluded). Same approach as regex-v1 plus everything that fit: negation/override
// keyword lists, late messages by sample id or plate/well, author-only corrections with
// red-herring filters, swaps, withdrawn notes, units-by-reference. It has no room left for row-level
// reader-log flags, misattributed notes, clock-time bubble windows or semantic condition references.
import { fitMM } from '../fit.mjs';
const num = t => +String(t).trim().replace(',', '.').replace('×10^', 'e').replace(/E\+?/, 'e');
const unit = s => { s = String(s).replace(/(micro|nano|milli)molar/g, (_, p) => ({ micro: 'u', nano: 'n', milli: 'm' })[p] + 'M').replace(/ per second|\/L\/s| s⁻¹|_per_s\b/g, '/s').replace(/ per minute|\/L\/min| min⁻¹|_per_min\b/g, '/min').replace(/mol(\/L)?/, 'M');
  const m = s.match(/(µ|u|n|m)M(?:\/(s|min))?/); return m ? { c: { µ: 1, u: 1, n: 1e-3, m: 1e3 }[m[1]], t: m[2] === 'min' ? 60 : 1 } : null; };
const STRONG = /still there|had been there|already there|did not move|only removed after|missed it|flagged SAT|said OVR|flagged as over range|SAT flag,|could not get/i, NEG = /before (the|reading)|after the read|afterwards|clean-up|stop (solution|mix)|no bubble|none\b|bubble-free|speck|no SAT|not saturated|did not flag|no OVR|it did not|tip count|on time|next to the plate|stayed on|lower gain|gain reduced/i;
const KEY = /\bSAT\b|OVR|saturat|over range|bubble|twice|two enzyme|\blate\b|missed|forgotten|spill|lost|wrong (buffer|reagent)|neighbouring buffer|tip (came off|slipped)/i, isEx = n => STRONG.test(n) || (KEY.test(n) && !NEG.test(n)), CP = /pH ?(\d+[.,]\d+)[ ,/]*(\d+) ?°C|(\d+) ?°?C? ?[,/]? ?pH ?(\d+[.,]\d+)|\bC(\d+)\b/g;
export function heuristicSolve(task) {
  const { study, documents } = task.inputs, P = study.sample_id_pattern.split('-')[0], ID = `${P}-\\d{4}`, conds = study.conditions;
  const find = (pH, T) => conds.find(c => c.pH === pH && c.temperature_C === T && !c.inhibitor)?.condition_id, mentions = a => [...a.matchAll(CP)].map(m => (m[5] ? `C${m[5]}` : find(num(m[1] ?? m[4]), +(m[2] ?? m[3])))).filter(Boolean);
  const rows = {}, raw = {}, excl = new Map(), pos = {}, rowsOf = {}, msgs = [], authors = {}, range = (a, b) => Array.from({ length: +b.slice(-4) - +a.slice(-4) + 1 }, (_, i) => `${P}-${String(+a.slice(-4) + i).padStart(4, '0')}`);
  const hdr = t => { const H = t.match(/\[S\] \(([^)]+)\) \| v0 \(([^)]+)\)|S in (.+?), rate in (.+)|S_(\w+)[,;]rate_(\w+)|\[S\] in (\S+), initial rates in (.+?)\. |substrate in (\w+) and rates in ([a-z ]+?) throughout/);
    const H2 = t.match(/rates in (.+?), \[S\] in (.+?)\.|rates below are ([a-z ]+?) and substrate is given in (\w+)/); return H ? H.slice(1).filter(Boolean) : H2 ? H2.slice(1).filter(Boolean).reverse() : null; };
  for (const d of documents) for (const L of d.text.split('\n')) { const m = L.match(/^\[[^\]]+\] ([^:]+): (.*)/) ?? L.match(/^Addendum \([^)]*\): ()(.*)/); if (m) msgs.push([m[1] || d.author, m[2]]); }
  for (const d of documents.filter(x => /notebook|instrument/.test(x.kind))) {
    const t = d.text, rf = t.match(/template as (.+?)'s (\S+) sheet|as on (.+?)'s export of (\S+) /), src = rf && documents.find(x => x.author === (rf[1] ?? rf[3]) && x.date === (rf[2] ?? rf[4]));
    const hs = hdr(t) ?? (src && hdr(src.text)) ?? []; const cu = unit(hs[0]); let ru = unit(hs[1]);
    if (ru?.t === 1 && msgs.some(([w, x]) => w === d.author && /per.minute|\/min|min⁻¹/.test(x) && !/^No\b|are not|as labelled|nothing on my|did not affect/.test(x))) ru = { ...ru, t: 60 };
    const add = (id, S, Su, v, Vu, cond, note, pl, well) => { const a = Su ? unit(Su) : cu, b = Vu ? unit(Vu) : ru; rows[id] = { S: num(S) * (a?.c ?? 1), v: num(v) * (b?.c ?? 1) / (b?.t ?? 1), cond };
      authors[id] = d.author; if (isEx(note)) excl.set(id, true); if (pl) { pos[pl + well] = id; (rowsOf[pl + well[0]] ??= []).push(id); } };
    let cond = null, plate = null;
    for (const L of t.split('\n')) { let m; if ((m = L.match(/^(?:### Plate (\d+), (.+), replicate|Condition: (.+?)   \()/))) { cond = mentions(m[2] ?? m[3])[0]; plate = m[1]; }
      if (d.kind === 'instrument') { const u = unit(t.match(/Rate\((.+?)\)/)[1]); if ((m = L.match(new RegExp(`^\\d+\\s+\\w\\d\\d\\s+(${ID})\\s+(\\S+)`)))) raw[m[1]] = num(m[2]) * u.c / u.t; }
      else if ((m = L.match(new RegExp(`^\\| (${ID}) \\| (\\w+) \\| ([^|]+) \\| ([^|]+) \\| (.*)\\|`)))) add(m[1], m[3], null, m[4], null, cond, m[5], plate, m[2]);
      else if ((m = L.match(new RegExp(`^(${ID})[,;](\\d+)[,;](\\w+)[,;]("[^"]*"|[^,;]*)[,;]\\d*[,;]([^,;]+)[,;]([^,;]+)[,;](?:[^,;]*[,;])?(.*)$`)))) add(m[1], m[5], null, m[6], null, mentions(m[4].replace(/(\d),(\d)/g, '$1.$2'))[0], m[7], m[2], m[3]);
      else if ((m = L.match(/^\s+\[S\] = (\S+?)(?: (\S+))?: (.*)$/))) for (const it of m[3].split(' | ')) { const q = it.match(new RegExp(`^r\\d+ (\\S+)(?: → re-read (\\S+))? \\((${ID})(.*)\\)`)); add(q[3], m[1], m[2], q[2] ?? q[1], null, cond, q[4]); }
      else if (/^\d\d:\d\d /.test(L)) { const c = mentions(L.match(/replicate \d+ of (.+?) on plate/)[1])[0], NU = '(-?[\\d.,]+(?:[eE][-+]?\\d+|×10\\^-?\\d+)?)(?: ((?:µ|u|n|m)[^ ,.:)]*(?: s⁻¹| min⁻¹)?))?';
        for (const s of L.split(new RegExp(`(?=(?<!\\()(?:Well \\w+ / )?${ID}\\b|(?<![\\d.,:])\\d[\\d.,eE+×^-]*(?: \\S+)? → )`))) {
          const q = s.match(new RegExp(`(${ID}) \\(${NU}\\): ${NU}\\.|(${ID}) at ${NU} gave ${NU}\\.|^${NU} → ${NU} \\((${ID})\\)\\.|(${ID}), \\[S\\] ${NU}, v0 ${NU}\\.|(${ID}): ${NU} at ${NU}\\.`)), g = q?.slice(1);
          const o = g && [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [14, 10, 11, 12, 13], [15, 16, 17, 18, 19], [20, 23, 24, 21, 22]].find(o => g[o[0]]); if (o) add(g[o[0]], g[o[1]], g[o[2]], g[o[3]], g[o[4]], c, s); } }
  } }
  const refs = x => { const r = [...x.matchAll(new RegExp(`(${ID})(?:–| to | through |…)(${ID})`, 'g'))].flatMap(m => range(m[1], m[2])); if (r.length) return r; const pr = x.match(/plate (\d+),? row (\w)\b/); if (pr) return rowsOf[pr[1] + pr[2]] ?? [];
    return [...new Set([...x.matchAll(new RegExp(`(${ID})|plate (\\d+),? (?:well )?(\\w\\d\\d)`, 'g'))].map(q => q[1] ?? pos[q[2] + q[3]]).filter(Boolean))]; };
  for (const [who, x] of msgs) { const ids = refs(x); if (!ids.length || authors[ids[0]] !== who || /^No\b|really are|stands|no problems|all correct|as my sheet|right order|were not|exactly the/.test(x)) continue;
    const tgt = mentions(x).find(c => c !== rows[ids[0]]?.cond); if (/^(Ignore what|Scratch my|Correction to my own)/.test(x)) excl.set(ids[0], false); else if (ids.length > 2 && tgt) ids.forEach(id => rows[id] && (rows[id].cond = tgt));
    else if (ids.length === 2 && /swap|wrong way|exchange|other's/.test(x)) { if (rows[ids[0]] && rows[ids[1]]) [rows[ids[0]].S, rows[ids[1]].S] = [rows[ids[1]].S, rows[ids[0]].S]; } else if (ids.length === 1 && KEY.test(x)) excl.set(ids[0], isEx(x)); }
  const by = {}; for (const [id, r] of Object.entries(rows)) if (!excl.get(id)) (by[r.cond] ??= []).push({ S: r.S, v: raw[id] ?? r.v });
  return { conditions: conds.map(c => { const f = fitMM(by[c.condition_id] ?? []); return { condition_id: c.condition_id, vmax: f.vmax, km: f.km }; }), excluded_samples: [...excl].filter(e => e[1]).map(e => e[0]).sort() };
}
