// Text-only tools for W-bed R3': they read the rendered repository files and nothing else (no manifest, no roles), so the
// controls built on them are what a script without the generator could do. `parseFunctions` is also how a solver would
// inventory the repository; the tests pin it to the generator's spans.
//
//   linter-only     a rule-based linter in the style of eslint plus a "money" plugin: each rule flags a code pattern
//                   and names the class it suggests. It cannot compare code with a contract.
//   grep-for-TODO   every function containing TODO / FIXME / XXX / HACK, reported once.
//   report-everything  every function, once per class in scope.
const FN_RE = /^export function (\w+)\(([^)]*)\) \{$/;

/** Exported functions of one JS file: name, params, 1-based start (the JSDoc line) and end, doc text, code text. */
export function parseFunctions(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FN_RE.exec(lines[i]);
    if (!m) continue;
    let s = i;
    if (i > 0 && lines[i - 1].trim() === '*/') { s = i - 1; while (s > 0 && !lines[s].trim().startsWith('/**')) s--; }
    let e = i + 1;
    while (e < lines.length && lines[e] !== '}') e++;
    out.push({ name: m[1], params: m[2].split(',').map(x => x.trim()).filter(Boolean), start: s + 1, end: e + 1,
      doc: lines.slice(s, i).join('\n'), code: lines.slice(i + 1, e).join('\n') });
  }
  return out;
}
const codeOnly = code => code.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Each rule: id, class, test(fn) on the parsed function.
export const LINT_RULES = [
  { id: 'le-length', cls: 'OFF_BY_ONE', test: f => /<=\s*[\w.]+\.length\b/.test(f.code) },
  { id: 'length-minus-one', cls: 'OFF_BY_ONE', test: f => /\.length\s*-\s*1\b/.test(f.code) },
  { id: 'slice-minus-one', cls: 'OFF_BY_ONE', test: f => /\.slice\([^;]*-\s*1\)/.test(f.code) },
  { id: 'bound-plus-minus-one', cls: 'OFF_BY_ONE', test: f => /[<>]=?\s*\w+\s*[+-]\s*1\s*;/.test(f.code) },
  { id: 'negated-condition', cls: 'LOGIC_ERROR', test: f => /!\(\s*[\w.]+\s*(!==|===|<=|>=|<|>)/.test(f.code) },
  { id: 'ne-or-ne', cls: 'LOGIC_ERROR', test: f => /!==\s*'[^']*'\s*\|\|\s*[\w.]+\s*!==/.test(f.code) },
  { id: 'unguarded-division', cls: 'MISSING_GUARD', test: f => /\/\s*[\w.]+(\.length)?\s*;/.test(f.code) && !/(===\s*0|\?\s|&&)/.test(f.code) && /\/ \w/.test(f.code) },
  { id: 'or-fallback', cls: 'MISSING_GUARD', test: f => /return [^;]*\|\|\s*[\w.]+;/.test(f.code) },
  { id: 'reduce-without-initial', cls: 'MISSING_GUARD', test: f => /\.reduce\(\((\w+), (\w+)\) => \([^;]*\)\);/.test(f.code) && !/\.reduce\([^;]*,\s*[\w{[0-9-]+\);/.test(f.code) },
  { id: 'money-rounding', cls: 'ROUNDING', test: f => /minor units/.test(f.doc) && /Math\.(round|floor|ceil|trunc)\(|\|\s*0\b/.test(f.code) },
  { id: 'bitwise-truncation', cls: 'ROUNDING', test: f => /\)\s*\|\s*0\b/.test(f.code) },
  { id: 'param-mutated', cls: 'INPUT_MUTATION', test: f => f.params.some(p => new RegExp(`\\b${esc(p)}\\.(sort|splice|push|reverse|fill|pop|shift|unshift)\\(|\\b${esc(p)}\\[[^\\]]+\\]\\s*=[^=]`).test(f.code)) },
  { id: 'object-assign', cls: 'INPUT_MUTATION', test: f => /Object\.assign\(/.test(f.code) },
  { id: 'catch-without-throw', cls: 'SWALLOWED_ERROR', test: f => /catch\s*\(\w*\)\s*\{(?![^}]*\bthrow\b)[^}]*\}/.test(f.code) },
  { id: 'string-replace', cls: 'ESCAPING', test: f => /\.replace\('/.test(f.code) },
  { id: 'manual-escaping', cls: 'ESCAPING', test: f => /\.split\('"'\)\.join|replace\(\/\\\\\/g/.test(f.code) },
  { id: 'date-object', cls: 'DATE_ARITH', test: f => /new Date\(/.test(f.code) },
  { id: 'leap-by-four', cls: 'DATE_ARITH', test: f => /% 4 === 0(?!\s*&&)/.test(f.code) },
  { id: 'percent-divisor', cls: 'UNIT_MISMATCH', test: f => /basis point|percent/.test(f.doc) && /\/ 100\b/.test(f.code) },
];

const srcFiles = files => Object.keys(files).filter(p => p.startsWith('src/') && p.endsWith('.js')).sort();

export function linterFindings(files, scope) {
  const out = [];
  for (const path of srcFiles(files)) for (const f of parseFunctions(files[path])) {
    const fn = { ...f, code: codeOnly(f.code) };
    const classes = new Set(LINT_RULES.filter(r => scope.includes(r.cls) && r.test(fn)).map(r => r.cls));
    for (const cls of classes) out.push({ file: path, function: f.name, class: cls, line: f.start });
  }
  return { findings: out };
}

export function todoFindings(files, scope, guess = 'LOGIC_ERROR') {
  const cls = scope.includes(guess) ? guess : scope[0];
  const out = [];
  for (const path of srcFiles(files)) for (const f of parseFunctions(files[path])) {
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(`${f.doc}\n${f.code}`)) out.push({ file: path, function: f.name, class: cls, line: f.start });
  }
  return { findings: out };
}

export function everythingFindings(files, scope) {
  const out = [];
  for (const path of srcFiles(files)) for (const f of parseFunctions(files[path])) for (const cls of scope) out.push({ file: path, function: f.name, class: cls });
  return { findings: out };
}
