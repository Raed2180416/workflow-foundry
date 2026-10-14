// The contract-fuzz script: a $0 deterministic triviality attack on R3', registered as the text controls
// `contract-fuzz-script` (one task) and `contract-fuzz-stream` (the task plus earlier tasks' files as an UNLABELLED
// corpus, as a stream or library arm would have them). Ported from the 2026-10-14 adversarial review
// (/var/tmp/foundry-work/review-R3prime/attack-r3p.mjs, 59 lines); the logic is the reviewer's, line for line, except
// two options: `keyMode: 'numbers'` also abstracts numbers in the contract key (a stronger grouping than the
// reviewer's), and `parts` switches the two halves off for diagnosis. It reads `task.files` and nothing else: no
// manifest, no generator, no model. NOTES §17 has its measured results.
//
//   1. generic contract properties, run on inputs drawn from the machine-readable @param domains: no argument changes
//      unless the contract says "in place" (CONVENTIONS §7); "Throws X" really throws X; no crash, NaN or Infinity
//      unless the contract throws; the house rounding rule (CONVENTIONS §2) on a one-argument house-rounding helper;
//      Gregorian month lengths on a year/month helper;
//   2. a differential vote: functions whose contracts are the same text (parameter names and quoted literals
//      abstracted) must behave the same; a function in the minority is reported;
//   3. root cause: a reported function that calls another reported function is dropped.
import vm from 'node:vm';

const STR = ['', ' ', '   ', 'abc', 'a,b', 'say "hi"', '"a" and "b"', 'x\ny', 'x\ry', '<b>&', "it's", '50%', 'a_b', 'c:\\t', '1,234.50', '-12', '7.05', '12.5', ' 42 ', '1,23',
  'not json', '{}', '{"pageSize": 10}', '[1,2]', 'null', '2023-02-29', '2024-02-29', '1900-02-29', '2023-04-31', 'open', 'paid'];
const DATES = ['2023-01-31', '2024-01-31', '1900-01-29', '2100-03-31', '2000-01-30', '2023-05-15', '2023-12-31', '1700-01-31', '2024-02-29', '1900-02-10', '2023-03-31', '2100-02-14'];
const canon = v => (v === undefined ? '"$u"' : typeof v === 'number' && !Number.isFinite(v) ? `"$${v}"` : JSON.stringify(v));
const CALL = new vm.Script('__r = globalThis[__n](...__a)');

function makeGen() {
  let sd = 7;
  const R = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648), pick = a => a[Math.floor(R() * a.length)];
  function gen(d, toks) {
    let m; d = d.trim();
    if ((m = /^(.*), or null$/.exec(d))) return R() < 0.3 ? null : gen(m[1], toks);
    if ((m = /^one of (.*)$/.exec(d))) return pick(m[1].split(', '));
    if ((m = /^array of at most (\d+): (.*)$/.exec(d))) return Array.from({ length: Math.min(+m[1], pick([0, 1, 2, 3, 4, 5, 8, 13])) }, () => gen(m[2], toks));
    if ((m = /^object \{(.*)\}( \(keys optional\))?$/.exec(d))) return Object.fromEntries(m[1].split('; ').map(kv => kv.split(/: (.*)/)).filter(() => !m[2] || R() < 0.5).map(([k, v]) => [k, gen(v, toks)]));
    if ((m = /^integer from (\S+) to (\S+)$/.exec(d))) {
      const [lo, hi] = [+m[1], +m[2]], c = [lo, hi, 0, 1, 2, 3, 5, 7, 10, 12, 30, 99, 100, 101, 2000, 2023, 2024, 1900, 2100, 429, 500, 503, 404, 200, -1, -3].filter(x => x >= lo && x <= hi);
      return R() < 0.7 && c.length ? pick(c) : lo + Math.floor(R() * (Math.min(hi, lo + 40) - lo + 1));
    }
    if ((m = /^number from (\S+) to (\S+) with/.exec(d))) return pick([0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 3.5, 12.5, 2.4999, 7.25, -7.75, 1, 3, 0.001, 1.25, 3.3, 100].filter(x => x >= +m[1] && x <= +m[2]));
    if ((m = /^string of at most (\d+)/.exec(d))) return pick([...STR, ...toks, ...toks, ...toks].filter(s => s.length <= +m[1]));
    if (/^date YYYY/.test(d)) return pick(DATES);
    if (/^number, string or boolean/.test(d)) return pick([0, 5, '', 'x', false, true, 7, ...toks]);
    return /^boolean/.test(d) ? R() < 0.5 : pick([null, { a: { b: { c: 1 } }, n: null, list: [4, 5] }, 3, 'x']); // any JSON value
  }
  return gen;
}

const sub = (s, f, back) => f.lits.reduce((t, l, k) => (back ? t.replaceAll(JSON.stringify(l), `"@L${k}@"`) : t.replaceAll(`"@L${k}@"`, JSON.stringify(l))), s);

/** One vm context per repository; each exported function with its contract key (param names and quoted literals
 *  abstracted; with keyMode 'numbers' also every number). */
function repo(files, keyMode) {
  const fns = [], ctx = vm.createContext({}), conv = (files['docs/CONVENTIONS.md'] ?? '').replace(/\s+/g, ' ');
  for (const [path, text] of Object.entries(files)) {
    if (!/^src\/.*\.js$/.test(path)) continue;
    vm.runInContext(text.replace(/^import .*$/gm, '').replace(/^export /gm, ''), ctx);
    for (const m of text.matchAll(/^export function (\w+)\(([^)]*)\) \{\n([\s\S]*?)^\}/gm)) {
      const f = { name: m[1], ps: m[2].split(', ').filter(Boolean), code: m[3], path, ctx };
      f.doc = text.slice(0, m.index).split('/**').pop().split('\n').map(l => l.replace(/^\s*\*\/?\s?/, '')).join(' ').replace(/\s+/g, ' ');
      f.doms = f.doc.split(' @param ').slice(1).map(s => /^\{[^}]*\} \w+ (.*) \(((?:integer|number|string|one of|boolean|date|any JSON|array|object).*)\)\.$/.exec(s.split(' @returns')[0].trim())).filter(Boolean);
      f.lits = [...new Set([...f.doc.matchAll(/'([^']{1,20})'/g)].map(x => x[1]))];
      f.key = f.ps.reduce((k, p, i) => k.replace(new RegExp(`\\b${p}\\b`, 'g'), `$${i}`), f.lits.reduce((k, l, i) => k.replaceAll(`'${l}'`, `'$L${i}'`), f.doc)) + (/CONVENTIONS|house/.test(f.doc) ? conv : '');
      if (keyMode === 'numbers') f.key = f.key.replace(/-?\d+(\.\d+)?/g, '#');
      fns.push(f);
    }
  }
  return fns;
}
function run(f, args) { // [result, args after]
  const a = JSON.parse(sub(JSON.stringify(args), f));
  Object.assign(f.ctx, { __a: a, __n: f.name });
  try { CALL.runInContext(f.ctx, { timeout: 100 }); return [sub(canon(f.ctx.__r), f, 1), sub(canon(a), f, 1)]; } catch (e) { return ['!' + e.name, sub(canon(a), f, 1)]; }
}
const edgy = v => v === null || v === 0 || v === false || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && (!v.length || edgy(v[0]))) || (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some(edgy));
function classOf(f, ws) { // ws: [[args, got, want]] differing observations; the largest |want| first
  const d = f.doc, [, got, want] = ws.sort((x, y) => Math.abs(+y[2][0] || 0) - Math.abs(+x[2][0] || 0))[0], bool = /^(true|false)$/.test(got[0]);
  const edge = ([a]) => { const n = a.filter(Number.isInteger); return n.some((x, i) => n.some((y, j) => i !== j && Math.abs(x - y) <= 1)); };
  if (got[1] !== want[1]) return 'INPUT_MUTATION';
  if (/[Tt]hrows/.test(d) && ws.some(([, g, w]) => g[0][0] === '!' || w[0][0] === '!')) return 'SWALLOWED_ERROR';
  if (/CSV|HTML|LIKE/.test(d)) return 'ESCAPING';
  if (/YYYY-MM-DD|Gregorian/.test(d)) return 'DATE_ARITH';
  if (/basis points|percent|milliseconds|major units/.test(d) && Math.abs(+got[0] - +want[0]) > 0.5 * Math.abs(+want[0]) && Math.abs(+got[0] - +want[0]) > 1) return 'UNIT_MISMATCH';
  if (ws.some(([, g]) => /^\[.*"\$NaN"/.test(g[0]))) return 'OFF_BY_ONE';
  if (!bool && (ws.some(([, g]) => g[0][0] === '!' || /^"\$(NaN|-?Infinity)"$/.test(g[0])) || ws.every(([a]) => a.some(edgy)))) return 'MISSING_GUARD';
  const J = t => { try { return JSON.parse(t); } catch { return null; } };
  const one = Array.isArray(J(got[0])) && Array.isArray(J(want[0])) && J(got[0]).filter((x, i) => x !== J(want[0])[i]).length === 1;
  if (/round|add up/i.test(d) && !one) return 'ROUNDING';
  if (bool) return ws.every(edge) ? 'OFF_BY_ONE' : 'LOGIC_ERROR';
  return /status/.test(d) || /^\{/.test(got[0]) ? 'LOGIC_ERROR' : 'OFF_BY_ONE';
}

/** Findings for `task` from its files alone; `corpus` = other tasks' `files` objects (unlabelled). */
export function contractFuzz(task, corpus = [], { tries = 150, keyMode = 'exact', parts = { generic: true, vote: true } } = {}) {
  const gen = makeGen();
  const mine = repo(task.files, keyMode), groups = new Map(), flagged = new Map(), conv = task.files['docs/CONVENTIONS.md'] ?? '';
  for (const f of [...mine, ...corpus.flatMap(c => repo(c, keyMode))]) groups.set(f.key, [...(groups.get(f.key) ?? []), f]);
  const away = x => Math.sign(x) * Math.round(Math.abs(x)), even = x => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));
  const oracles = [[f => /house rounding rule/.test(f.doc) && f.ps.length === 1, a => canon((/away from zero/.test(conv) ? away : even)(a[0]))],
    [f => /Gregorian/.test(f.doc) && f.ps.length === 2 && /year/.test(f.doc), a => canon(new Date(Date.UTC(a[0], a[1], 0)).getUTCDate())]];
  for (const f of mine.filter(x => x.doms.length === x.ps.length)) {
    const g = [f, ...groups.get(f.key).filter(x => x !== f).slice(0, 24)], toks = f.lits.map((_, k) => `@L${k}@`), ws = [], ref = oracles.find(([when]) => when(f))?.[1];
    for (let i = 0; i < tries && ws.length < 6; i++) {
      const args = f.doms.map(m => gen(m[2], toks)); // domain cross-conditions stated in prose:
      f.doms.forEach((m, j) => { const k = f.ps.findIndex(p => new RegExp(`not (below|before) ${p}\\b`).test(m[1])); if (k >= 0 && args[j] < args[k]) [args[j], args[k]] = [args[k], args[j]]; });
      const na = /\((\w+) not above (\w+)\)/.exec(f.doc), [a, b] = na ? [f.ps.indexOf(na[1]), f.ps.indexOf(na[2])] : [-1, -1];
      if (a >= 0 && args[a] > args[b]) [args[a], args[b]] = [args[b], args[a]];
      if (/at most 1000 days after/.test(f.doc) && args[1] - args[0] > 1000) continue;
      const got = run(f, args), tally = {}, th = /[Tt]hrows (\w+)/.exec(f.doc);
      if (parts.generic) {
        if (!/in place/.test(f.doc) && got[1] !== sub(canon(args), f, 1)) { ws.push([args, got, [got[0], sub(canon(args), f, 1)]]); continue; }
        if (th && ['abc', 'not json'].includes(args[0]) && got[0] !== '!' + th[1]) { ws.push([args, got, ['!' + th[1], got[1]]]); continue; }
        if ((!th && got[0][0] === '!') || /"\$(NaN|-?Infinity)"/.test(got[0])) { ws.push([args, got, ['?', got[1]]]); continue; }
        if (ref) { const w = ref(args); if (w !== got[0]) ws.push([args, got, [w, got[1]]]); continue; }
      }
      if (!parts.vote || g.length < 3) continue;
      for (const x of g) { const o = run(x, args).join('\u0002'); tally[o] = (tally[o] ?? 0) + 1; }
      const [top, n] = Object.entries(tally).sort((x, y) => y[1] - x[1])[0];
      if (n > g.length / 2 && got.join('\u0002') !== top) ws.push([args, got, top.split('\u0002')]);
    }
    if (ws.length) flagged.set(f.name, { f, cls: classOf(f, ws), args: ws[0][0] });
  }
  for (const [name, x] of flagged) if ([...flagged.keys()].some(o => o !== name && new RegExp(`\\b${o}\\(`).test(x.f.code))) flagged.delete(name); // root cause
  return { findings: [...flagged.values()].map(x => ({ file: x.f.path, function: x.f.name, class: x.cls, witness: { args: JSON.parse(sub(JSON.stringify(x.args), x.f)) } })) };
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI (dev seeds only; $0): node beds/wbed/r3p/attack.mjs --difficulty 3 --targets 449-472 [--corpus 425-448 | --loo]
//   [--key exact|numbers] [--parts generic|vote]. --loo uses every other target as the corpus (leave one out).
// Prints one JSON row per target and a summary line: pass count, mean and max precision / recall / F1.
async function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const rg = s => { const [a, b] = s.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); };
  const bed = await import('./index.mjs');
  const d = Number(arg('--difficulty', '3')), targets = rg(arg('--targets', '449-460')), keyMode = arg('--key', 'exact');
  const parts = { generic: arg('--parts', 'both') !== 'vote', vote: arg('--parts', 'both') !== 'generic' };
  const files = s => bed.generate({ seed: s, split: 'dev', difficulty: d }).files;
  const fixed = arg('--corpus', null) ? rg(arg('--corpus')).map(files) : null;
  const rows = [];
  for (const seed of targets) {
    const task = bed.generate({ seed, split: 'dev', difficulty: d });
    const corpus = fixed ?? (argv.includes('--loo') ? targets.filter(s => s !== seed).map(files) : []);
    const t0 = Date.now(), res = bed.oracle(task, contractFuzz(task, corpus, { keyMode, parts })), x = res.details;
    rows.push({ seed, pass: res.pass, precision: x.precision, recall: x.recall, f1: x.f1, fp: x.falsePositives, ms: Date.now() - t0 });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  const mean = k => (rows.reduce((s, r) => s + (r[k] ?? 0), 0) / rows.length).toFixed(3), max = k => Math.max(...rows.map(r => r[k] ?? 0)).toFixed(3);
  console.log(`contract-fuzz d${d} targets ${targets[0]}-${targets[targets.length - 1]} corpus ${fixed ? arg('--corpus') : argv.includes('--loo') ? 'leave-one-out' : 'none'} key ${keyMode} parts ${arg('--parts', 'both')}: `
    + `pass ${rows.filter(r => r.pass).length}/${rows.length}; mean P ${mean('precision')} R ${mean('recall')} F1 ${mean('f1')}; max R ${max('recall')} F1 ${max('f1')}`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main(process.argv.slice(2)).catch(e => { console.error(e?.stack ?? e); process.exit(1); });
