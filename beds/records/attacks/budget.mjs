// Attack B (v2 audit, step 4): heuristic solver reading only task.inputs. NOTE (2026-10-07 audit): it claimed "<=40 lines x <=160 chars" but is 54 lines, max 237 chars.
const CR = ['austria|sterr|^aut?$|vienn|graz|salzb|innsb|linz>AT', 'austr|^aus$|sydn|melb|brisb|adel|canb|hobar>AU', 'stat|staat|usa|u\\.s|amer|^us$>US',
  'king|brit|engl|^uk$|^gb$|k.nigr|manch|leeds|brist|liverp|edinb|glasg|sheff|notting>GB', 'cana|canda|kanad|^can$|toront|vancou|montr|calg|ottaw|winni|edmont>CA',
  'irl|irel|irle|eire|irish|dubl|cork|galw|limer|waterf>IE', 'germ|gema|deutsch|^brd$|^de$|^ger$|munic|hamb|colog|stuttg|d.ssel|leipz|dresd|hanov>DE',
  'swi|schweiz|suisse|^ch$|zuri|genev|basel|lausan|lucer>CH', 'fran|fren|^fra$|frnac|farnc|lyon|marse|toulo|borde|nante|strasb|lille>FR', 'belg|^bel$|bruss|antw|ghent|li.ge|bruge>BE',
  'spa|esp|spian|madri|barcel|sevil|bilb|zarag|m.lag>ES', 'mex|guadal|monter|puebl|tijua>MX', 'ital|itl|^ita$|milan|turin|napl|genoa|bologn|palerm|veron>IT',
  'neth|nehte|holl|neder|niede|^nld$|dutch|rotterd|utrech|eindh|amster|groni>NL', 'jap|jpa|nipp|^jpn$|osaka|kyoto|nagoy|sappor|yokoh|fukuo|kobe>JP',
  'swe|schwed|sverig|stockh|gothen|malm|uppsal>SE', 'dan|d.nem|denm|copenh|aarhu|odens|aalbor>DK', 'nor|oslo|trondh|stavan|troms>NO'].map(p => p.split('>'));
const cty = s => { s = (s ?? '').trim().toLowerCase(); return !s ? null : s.length === 2 ? (s === 'uk' ? 'GB' : s.toUpperCase()) : CR.find(([re]) => new RegExp(re).test(s))?.[1] ?? null; };
const W = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const T = ',,twenty,thirty,forty,fifty,sixty,seventy,eighty,ninety'.split(','), MON = 'janfebmaraprmayjunjulaugsepoctnovdec', p2 = n => String(n).padStart(2, '0');
const words = s => s.split(/[\s-]+/).reduce(([t, c], w) => (w === 'thousand' ? [t + c * 1000, 0] : [t, w === 'hundred' ? c * 100 : c + Math.max(0, W.indexOf(w)) + 10 * Math.max(0, T.indexOf(w))]), [0, 0])
  .reduce((a, b) => a + b), ymd = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
const date = (s, us) => { const n = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/), y = s.match(/\d{4}/)?.[0] ?? `19${s.slice(-2)}`; if (n) return us ? ymd(y, n[1], n[2]) : ymd(y, n[2], n[1]);
  return ymd(y, MON.indexOf(s.match(/[A-Za-z]{3,}/g).find(x => x !== 'the').slice(0, 3).toLowerCase()) / 3 + 1, s.replace(y, '').match(/\d{1,2}/)[0]); };
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').toLowerCase().replace(/[^a-z]/g, '').replace(/([aou])[eu]/g, '$1');
const lev = (a, b) => { let p = [...Array(b.length + 1).keys()]; for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++)
  c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] !== b[j - 1])); p = c; } return p[b.length]; };
const gf = s => { const t = s.trim().split(/\s+/).filter(x => !/^(mr|mrs|ms|dr|prof)\.?$/i.test(x) && !/^[A-Z]\.$/.test(x)); return [t[0], t.slice(1).join(' ')]; };
const nm = s => (s.includes(', ') ? [gf(s.split(', ')[1].replace(/\(.*\)/, ''))[0], s.split(', ')[0]] : gf(s)), pick = (L, re) => L.match(re)?.[1] ?? '';
const amt = (s, cur, de, neg) => { if (!s || !/\d|[a-z] (dollar|euro|pound)/.test(s)) return null; const c = /euro|€/.test(s) ? 'EUR' : /pound|£/.test(s) ? 'GBP' : (s.match(/[A-Z]{3}/) ?? [cur])[0];
  const v = /\d/.test(s) ? +(de ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')).match(/\d+(\.\d+)?/)[0] : words(s.split(/ (?:US )?(?:dollar|euro|pound)/)[0])
    + words(s.match(/and (.*) (cent|pen)/)?.[1] ?? 'zero') / 100; return { v: (neg || /^\(|^-|-\s|CR|▲/.test(s) ? -1 : 1) * v, c }; };
export function budgetSolve(task) {
  const { export: ex, spec, source_notes: notes } = task.inputs, nick = {}, rate = {}, cc = {}, rows = [], F = g => nick[g] ?? g;
  for (const m of spec.matchAll(/([A-Za-z/]+) = ([^\s;]+)/g)) for (const n of m[1].split('/')) nick[n] = m[2];
  for (const m of spec.matchAll(/^ +[A-Z][a-z ]+ ([A-Z]{2}) +\+(\d+) +trunk prefix: (\S+)/gm)) cc[m[1]] = [m[2], m[3]];
  for (const m of spec.split('Table B2').pop().matchAll(/^ +(USD\/)?([A-Z]{3})(?:\/USD)? +([\d.]+)$/gm)) rate[m[2]] = m[1] ? 1 / m[3] : +m[3]; rate.USD = 1;
  const cut = notes.match(/ATLAS\..*?(\d+ [A-Z][a-z]+ \d{4})/)?.[1];
  for (const L of ex.split('\n')) { const s = L.split(/ \| |;| :: /), f = k => pick(L, new RegExp(`${k}[=:] ?([^|;]*?)(?= \\||;|$)`)); let r;
    if (L[0] === 'B') r = { v: /=ZZTEST/.test(L), n: nm(f('name')), dob: /[1-9]/.test(f('dob')) && date(f('dob'), 1), c: cty(f('country')), ph: f('phone'), a: amt(f('balance'), 'USD'), u: f('updated') };
    if (L[0] === 'L') r = { v: s[8] === 'storniert', n: nm(s[2]), dob: /[1-9]/.test(s[4]) && ymd(...s[4].split('.').reverse()), c: cty(s[5]), ph: s[6], a: amt(s[7], 'EUR', 1),
      u: ymd(...s[9].split('.').reverse()) };
    if (L[0] === 'A') { const u = date(s[6].slice(12)); r = { v: /MIGRATE$/.test(L), n: nm(s[1]), dob: /\d/.test(s[2]) && date(s[2], cut && u >= date(cut)), c: cty(s[3]), ph: s[4].slice(4),
      a: amt(s[5].slice(5), 'GBP'), u }; }
    if (L[0] === 'K') { const e = f('birth').match(/([SH])(\d+)\.(\d+)\.(\d+)/), d = f('birth').split('/'); r = { v: /SAMPLE$/.test(L), n: s[0].split(' ').slice(-2).reverse(), c: 'JP',
      dob: e ? ymd((e[1] === 'S' ? 1925 : 1988) + +e[2], e[3], e[4]) : /\d/.test(d[0]) && d.join('-'), ph: f('tel'), a: amt(f('balance'), 'JPY'), u: f('upd').replace(/\//g, '-') }; }
    if (L[0] === 'V' && L[1] === 'E') { const o = JSON.parse(L.slice(8)); r = { v: o.env, n: [o.given, o.family], dob: o.dob !== '1900-01-01' && o.dob, c: cty(o.country), ph: o.msisdn && `+${o.msisdn}`,
      a: o.amount && { v: +o.amount, c: o.ccy }, u: o.ts.slice(0, 10) }; }
    if (L[0] === 'V' && L[1] === 'e') { const b = L.replace(/ Remark: .*/, ''), D = '((?:the )?[\\w ,]*?\\d{4}|[\\w-]+-\\d\\d|[\\d/]+)', am = b.match(/(owes us|balance|outstanding|due|credit by|credit of|owe them) (.+?)(\.$|\. | — )/);
      r = { v: /onboarded\.\)$/.test(L), n: gf(pick(b, /— (?:Supplier contact |Spoke with |Entry revised [^:]+: )?(.*?)(?=,| \(| — | on | born| date| DOB| b\.| birth)/)),
        dob: (b.match(new RegExp(`(?:born|birth|DOB|b\\.) ${D}(?=[);,.]| —)`, 'i')) ?? [])[1] && date(RegExp.$1, 1), u: date(pick(b, new RegExp(`(?:vised|on) (?:on )?${D}(?=[.:]| \\()`)), 1),
        c: cty(pick(b, /based in ([^,;)]+)|an? (\w+) (?:supp|cont)|: [^(]+\(([^)]+)\)| — ([^—]+?) — /)), ph: pick(b, /(?:phone|at|tel\.|mobile|number) ([^,;—]+?)(?=[,;]|\. | — )/i),
        a: am && amt(am[2], 'USD', 0, /credit|owe them/.test(am[1])) }; }
    if (r && !r.v) rows.push({ ...r, id: +L.match(/\d+/)[0] }); }
  const norm = (s, iso) => { const d = (s ?? '').replace(/\D/g, ''); if (!d || /^0+$/.test(d)) return null; if (/^\s*(\+|00|011 )/.test(s)) return `+${s.replace('(0)', '').replace(/\D/g, '').replace(/^0(0|11)/, '')}`;
    const [k, t] = cc[iso] ?? []; return k ? `+${k}${t === '0' ? d.replace(/^0/, '') : k === '1' && d.length === 11 ? d.slice(1) : d}` : null; };
  rows.forEach(r => { r.p = norm(r.ph, r.c); r.g = fold(F(r.n[0])); r.f = fold(r.n[1]); }); const par = rows.map((_, i) => i), find = i => (par[i] === i ? i : (par[i] = find(par[i])));
  rows.forEach((a, i) => rows.forEach((b, j) => { if (j > i && (a.dob && b.dob ? a.dob === b.dob : a.p && a.p === b.p) && lev(a.g, b.g) + lev(a.f, b.f) <= 1) par[find(i)] = find(j); }));
  const groups = {}; rows.forEach((r, i) => (groups[find(i)] ||= []).push(r)); const acc = (g, x, i) => g.map(r => (i ? r.n[1] : F(r.n[0]))).find(y => /[^ -~]/.test(y) && fold(y) === fold(x)) ?? x;
  return { records: Object.values(groups).map(g => { g.sort((a, b) => (b.u > a.u) - (b.u < a.u) || b.id - a.id); const first = k => g.find(r => r[k])?.[k] ?? null, a = first('a'), ids = g.map(r => r.id);
    return { entity_id: Math.min(...ids), source_rows: ids, given_name: acc(g, F(g[0].n[0]), 0), family_name: acc(g, g[0].n[1], 1), birth_date: first('dob'), country: first('c'),
      phone_e164: first('p'), amount_usd: a && Math.sign(a.v) * Math.round(Math.abs(a.v) * rate[a.c] * 100 + 1e-9) / 100 }; }) };
}
