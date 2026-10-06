// Rendering helpers: Python literals, REPL transcripts and pytest files from DSL cases and
// harness-normalised results.

const BUILTIN_EXC = new Set(['ValueError', 'KeyError', 'TypeError', 'ZeroDivisionError', 'IndexError',
  'AttributeError', 'RuntimeError', 'LookupError', 'OverflowError', 'Exception']);

export function pyStr(s) {
  const useDouble = s.includes("'") && !s.includes('"');
  const q = useDouble ? '"' : "'";
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === q) out += '\\' + q;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (c < 32 || c === 127) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += ch;
  }
  return q + out + q;
}

function pyNum(x) {
  if (Number.isInteger(x)) return String(x);
  return String(x);
}

// Normalised result value -> Python literal (as the REPL would print it).
export function pyValue(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return pyNum(v);
  if (typeof v === 'string') return pyStr(v);
  if (Array.isArray(v)) return `[${v.map(pyValue).join(', ')}]`;
  if ('__tuple__' in v) return v.__tuple__.length === 1 ? `(${pyValue(v.__tuple__[0])},)` : `(${v.__tuple__.map(pyValue).join(', ')})`;
  if ('__map__' in v) return `{${v.__map__.map(([k, x]) => `${pyValue(k)}: ${pyValue(x)}`).join(', ')}}`;
  if ('__set__' in v) return v.__set__.length ? `{${v.__set__.map(pyValue).join(', ')}}` : 'set()';
  if ('__float__' in v) return `float(${pyStr(v.__float__)})`;
  if ('__bigint__' in v) return v.__bigint__;
  if ('__type__' in v) {
    const fields = Object.keys(v).filter(k => k !== '__type__');
    return `${v.__type__}(${fields.map(k => `${k}=${pyValue(v[k])}`).join(', ')})`;
  }
  if ('__raise__' in v) return `<raises ${v.__raise__}>`;
  return '<?>';
}

// DSL argument value (JSON) -> Python source expression.
export function pyArg(v) {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return pyNum(v);
  if (typeof v === 'string') return pyStr(v);
  if (Array.isArray(v)) return `[${v.map(pyArg).join(', ')}]`;
  if ('$ref' in v) return v.$ref;
  if ('$tuple' in v) return v.$tuple.length === 1 ? `(${pyArg(v.$tuple[0])},)` : `(${v.$tuple.map(pyArg).join(', ')})`;
  return `{${Object.entries(v).map(([k, x]) => `${pyStr(k)}: ${pyArg(x)}`).join(', ')}}`;
}

function argList(args, kw) {
  return [...args.map(pyArg), ...Object.entries(kw || {}).map(([k, x]) => `${k}=${pyArg(x)}`)].join(', ');
}

// Python expression for a step (without assignment).
export function stepExpr(step) {
  const [kind] = step;
  if (kind === 'new') return `${step[2]}(${argList(step[3], step[4])})`;
  if (kind === 'call') return `${step[1]}.${step[2]}(${argList(step[3], step[4])})`;
  if (kind === 'fn') return `${step[1]}(${argList(step[2], step[3])})`;
  if (kind === 'get') return `${step[1]}.${step[2]}`;
  throw new Error(`unknown step ${kind}`);
}

const assignTarget = step => (step[0] === 'new' ? step[1] : step[0] === 'call' ? step[5] : step[0] === 'fn' ? step[4] : null);

// Names a case needs imported from the module under test.
export function caseImports(cases, results) {
  const names = new Set();
  cases.forEach((c, ci) => c.steps.forEach((s, si) => {
    if (s[0] === 'new') names.add(s[2]);
    if (s[0] === 'fn') names.add(s[1]);
    const v = results?.[ci]?.[si];
    collectTypes(v, names);
  }));
  return [...names].sort();
}

function collectTypes(v, names) {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { v.forEach(x => collectTypes(x, names)); return; }
  if ('__raise__' in v) { if (!BUILTIN_EXC.has(v.__raise__)) names.add(v.__raise__); return; }
  if ('__type__' in v) { names.add(v.__type__); }
  for (const x of Object.values(v)) collectTypes(x, names);
}

const isPlainObject = v => v && typeof v === 'object' && '__type__' in v && Object.keys(v).length === 1;

// REPL transcript of a case run against a module (results = normalised outputs).
export function replTranscript(modName, c, results) {
  const imports = caseImports([c], [results]);
  const lines = [`>>> from ${modName} import ${imports.join(', ')}`];
  c.steps.forEach((s, i) => {
    const v = results[i];
    const target = assignTarget(s);
    lines.push(`>>> ${target ? `${target} = ` : ''}${stepExpr(s)}`);
    if (v && typeof v === 'object' && '__raise__' in v) {
      lines.push('Traceback (most recent call last):', '  File "<stdin>", line 1, in <module>');
      const qual = BUILTIN_EXC.has(v.__raise__) ? v.__raise__ : `${modName}.${v.__raise__}`;
      lines.push(v.__msg__ ? `${qual}: ${v.__msg__}` : qual);
    } else if (!target && v !== null && v !== undefined && !isPlainObject(v)) {
      lines.push(pyValue(v));
    }
  });
  return lines.join('\n');
}

function isFloatish(v) { return typeof v === 'number' && !Number.isInteger(v); }

// pytest function for a case whose expected values are the reference results.
export function pytestFunction(c, results) {
  const body = [];
  c.steps.forEach((s, i) => {
    const v = results[i];
    const target = assignTarget(s);
    const expr = stepExpr(s);
    if (v && typeof v === 'object' && '__raise__' in v) {
      body.push(`    with pytest.raises(${v.__raise__}):`, `        ${expr}`);
      return;
    }
    if (target) {
      body.push(`    ${target} = ${expr}`);
      if (s[0] !== 'new' && v !== null && !isPlainObject(v)) body.push(`    assert ${target} == ${isFloatish(v) ? `pytest.approx(${pyValue(v)})` : pyValue(v)}`);
      return;
    }
    if (v === null || isPlainObject(v)) { body.push(`    ${expr}`); return; }
    const lit = isFloatish(v) ? `pytest.approx(${pyValue(v)})` : pyValue(v);
    body.push(`    assert ${expr} == ${lit}`);
  });
  return `def ${c.title}():\n${body.join('\n')}\n`;
}

export function pytestFile(modName, cases, results) {
  const imports = caseImports(cases, results);
  const fns = cases.map((c, i) => pytestFunction(c, results[i]));
  return `"""Regression tests for ${modName}.  Run with: python -m pytest tests/"""\nimport pytest\n\nfrom ${modName} import (\n${imports.map(n => `    ${n},`).join('\n')}\n)\n\n\n${fns.join('\n\n')}`;
}
