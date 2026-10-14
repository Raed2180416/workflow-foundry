// Text rendering for W-bed R3': the repository files (src/ modules with JSDoc contracts, src/lib helpers, test/ files that
// pass against the planted code, docs/CONVENTIONS.md with the per-task house rules, README.md, package.json), the
// function spans (the inventory truth), the prompt and the inputs. Rendering never changes the truth, and nothing here
// writes a class name, a role or a manifest entry into the task.
import { estimateTokens } from '../lib/prng.mjs';
import { CLASSES, DEFINITIONS, HOUSE, LIB } from './vocab.mjs';

const WRAP = 108;
function wrap(text, width = WRAP) {
  const out = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + w.length > width) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}
export function typeOf(s) {
  switch (s.t) {
    case 'int': case 'num': return 'number';
    case 'str': case 'iso': case 'enum': return 'string';
    case 'bool': return 'boolean';
    case 'arr': return 'Array';
    case 'obj': return 'Object';
    case 'nullable': return `?${typeOf(s.of)}`;
    default: return '*';
  }
}
export function domainText(s) {
  switch (s.t) {
    case 'int': return `integer from ${s.min} to ${s.max}`;
    case 'num': return `number from ${s.min} to ${s.max} with at most ${s.dp} decimal${s.dp === 1 ? '' : 's'}`;
    case 'str': return `string of at most ${s.max} characters`;
    case 'enum': return `one of ${s.values.join(', ')}`;
    case 'bool': return 'boolean';
    case 'scalar': return 'number, string or boolean';
    case 'nullable': return `${domainText(s.of)}, or null`;
    case 'iso': return 'date YYYY-MM-DD, years 1600-2400';
    case 'json': return 'any JSON value';
    case 'arr': return `array of at most ${s.max}: ${domainText(s.of)}`;
    case 'obj': return `object {${Object.entries(s.props ?? {}).map(([k, v]) => `${k}: ${domainText(v)}`).join('; ')}}${s.optional ? ' (keys optional)' : ''}`;
    default: return '';
  }
}

function renderFn(f) {
  const doc = ['/**', ...f.contract.lines.flatMap(l => wrap(l)).map(l => ` * ${l}`)];
  if (f.note) doc.push(` * ${f.note}`);
  doc.push(' *');
  f.params.forEach((name, i) => {
    const s = f.domain.params[i];
    for (const [j, l] of wrap(`@param {${typeOf(s)}} ${name} ${f.contract.params[i]} (${domainText(s)}).`).entries()) doc.push(` * ${j ? '  ' : ''}${l}`);
  });
  doc.push(` * @returns {${f.contract.returns}}`, ' */');
  const body = f.plantedBody.split('\n').map(l => `  ${l}`);
  if (f.todo) body.unshift(`  // ${f.todo}`);
  return [...doc, `export function ${f.name}(${f.params.join(', ')}) {`, ...body, '}'];
}

const AREA_LINE = {
  billing: 'invoices, credit notes and the amounts on them', payments: 'incoming and outgoing payments', calendar: 'dates, terms and billing periods',
  export: 'text formats for exports and search', platform: 'configuration, HTTP and collection helpers', reporting: 'figures for reports and dashboards',
  customers: 'customer and contact records', lib: 'shared helpers used across the modules',
};

export function renderRepo(world) {
  const { fns, files, house, pkg, spec } = world;
  const out = {};
  const spans = new Map();
  const srcText = {};
  const helperFile = Object.fromEntries(LIB.map(l => [l.helper, l.path]));
  for (const file of files) {
    const mine = fns.filter(f => f.path === file.path);
    const lines = [`// ${file.path.replace(/^src\//, '')}: ${AREA_LINE[file.area]}.`];
    const imports = new Map();
    for (const f of mine) if (f.calls) { const from = helperFile[f.helperFamily]; if (!imports.has(from)) imports.set(from, new Set()); imports.get(from).add(f.calls); }
    for (const [from, names] of imports) lines.push(`import { ${[...names].sort().join(', ')} } from '${relImport(file.path, from)}';`);
    for (const f of mine) {
      lines.push('');
      const start = lines.length + 1;
      lines.push(...renderFn(f));
      spans.set(f.name, { path: file.path, start, end: lines.length });
    }
    srcText[file.path] = `${lines.join('\n')}\n`;
  }
  // tests: one file per source file with tested functions; they pass against the planted code.
  const testText = {};
  for (const file of files) {
    const tested = fns.filter(f => f.path === file.path && f.tested);
    if (!tested.length) continue;
    const tpath = file.path.replace(/^src\//, 'test/').replace(/\.js$/, '.test.js');
    const lines = ["import test from 'node:test';", "import assert from 'node:assert/strict';",
      `import { ${tested.map(f => f.name).sort().join(', ')} } from '${relImport(tpath, file.path)}';`];
    for (const f of tested) {
      lines.push('', `test('${f.name}', () => {`);
      for (const c of f.testable) lines.push(`  assert.deepEqual(${f.name}(${c.args.map(a => JSON.stringify(a)).join(', ')}), ${JSON.stringify(c.expected)});`);
      lines.push('});');
    }
    testText[tpath] = `${lines.join('\n')}\n`;
  }
  const sourceFiles = files.map(f => f.path);
  out['package.json'] = `${JSON.stringify({ name: `@${pkg.org}/${pkg.name}`, version: pkg.version, private: true, type: 'module',
    description: 'Shared back-office helpers: billing, payments, calendar, exports, reporting.', main: 'src/index.js',
    scripts: { test: 'node --test' }, engines: { node: '>=20' } }, null, 2)}\n`;
  out['README.md'] = [`# @${pkg.org}/${pkg.name}`, '', 'Shared helpers of the back office: billing, payments, calendar, exports, platform, reporting and customer records.',
    'Every exported function documents its contract in a JSDoc comment; house rules that several modules share are in',
    '[docs/CONVENTIONS.md](docs/CONVENTIONS.md).', '', '## Layout', '', ...sourceFiles.map(p => `- \`${p}\``), '', '## Tests', '',
    'Run `npm test` (Node 20 or later). The suite covers part of the code.', ''].join('\n');
  out['docs/CONVENTIONS.md'] = conventions(house);
  for (const p of sourceFiles) out[p] = srcText[p];
  for (const p of Object.keys(testText).sort()) out[p] = testText[p];

  const classes = world.L.classes;
  const inputs = {
    package: { name: `@${pkg.org}/${pkg.name}`, version: pkg.version },
    source_files: sourceFiles,
    defect_classes: classes.map(code => ({ code, definition: DEFINITIONS[code] })),
    sweep_spec: sweepSpec(),
  };
  const prompt = promptText(world, sourceFiles.length, classes.length);
  const fileTokens = new Map(sourceFiles.map(p => [p, estimateTokens(srcText[p])]));
  const fixedTokens = estimateTokens(prompt) + estimateTokens(JSON.stringify(inputs, null, 1)) + estimateTokens(out['package.json']) + estimateTokens(out['README.md']) + estimateTokens(out['docs/CONVENTIONS.md']);
  return { files: out, spans, prompt, inputs, sourceFiles, testFiles: Object.keys(testText).sort(), fileTokens, fixedTokens, seedSalt: spec.seed };
}

function relImport(fromPath, toPath) {
  const a = fromPath.split('/').slice(0, -1), b = toPath.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  return `${up ? '../'.repeat(up) : './'}${b.slice(i).join('/')}`;
}

function conventions(house) {
  return ['# House conventions', '', 'These rules apply to every module unless a function\'s own contract says otherwise.', '',
    '## 1. Money', '', 'Amounts are integers in minor units. JPY has no minor unit; every other currency has two decimals.', '',
    '## 2. Rounding', '', `Where a contract says "the house rounding rule", ${HOUSE.rounding[house.rounding]}.`, '',
    '## 3. Bands', '', `Where a contract defers to this section, ${HOUSE.band[house.band]}.`, '',
    '## 4. Pages', '', `Where a contract defers to this section, ${HOUSE.pageBase[house.pageBase]}.`, '',
    '## 5. Dates', '', 'Dates are strings YYYY-MM-DD in the Gregorian calendar. A day number is an integer count of days.', '',
    '## 6. Errors', '', 'A function whose contract says it throws an error type throws exactly that type. A function whose contract says it',
    'returns null for bad input never throws for it.', '',
    '## 7. Arguments', '', 'Functions never change their arguments unless the contract says "in place".', '',
    '## 8. Text formats', '', 'CSV follows RFC 4180. HTML text uses the five entities &amp; &lt; &gt; &quot; &#39;. SQL LIKE patterns use the',
    'backslash as the escape character.', '',
    '## 9. Text', '', 'A character is one UTF-16 code unit (what a JavaScript string\'s length counts). Whitespace is what',
    'String.prototype.trim removes.', ''].join('\n');
}

export function sweepSpec() {
  return ['1. Scope: functions in src/ only. Tests, docs and package files contain no defects.',
    '2. A defect is a function whose own code does not do what its contract says for some input the contract allows. The contract is the function\'s JSDoc comment, plus docs/CONVENTIONS.md where the comment refers to it or does not override it.',
    '3. Correct code is not a defect, however unusual it looks.',
    '4. Root cause: when a function misbehaves only because a function it calls is defective, report the called function, not the caller.',
    '5. One finding per defect: {file, function, class}; optional line (inside the function) and witness {args}: arguments the contract allows on which the result, the thrown error or an argument after the call differs from the contract. Witnesses are run against the code.',
    '6. Class: exactly one code from defect_classes.',
    '7. Scoring: a finding is verified when (file, function, class) is a defect of the repository. Precision = verified / findings, recall = verified / defects. Duplicates, wrong classes, callers and correct functions count against precision. Pass: precision >= 0.90 (one false positive is always tolerated) and recall >= 0.80.'].join('\n');
}

function promptText(world, nFiles, nClasses) {
  return [`You are reviewing @${world.pkg.org}/${world.pkg.name} ${world.pkg.version}, a fictional internal JavaScript library of a back-office group.`,
    `Its files are in files/: ${nFiles} source files in src/, tests in test/, the house rules in docs/CONVENTIONS.md.`, '',
    'Find the defects in src/: functions whose own code does not do what their contract says, for some input the contract allows.',
    'The contract is the function\'s JSDoc comment, together with docs/CONVENTIONS.md. Code that looks unusual but does what its contract',
    'says is not a defect, and reporting it costs precision. The existing tests pass; that does not make the code correct.', '',
    'Report each defect once, at the function whose own code is wrong: when a function misbehaves only because a function it calls is',
    `defective, report the called function. Give each defect exactly one of the ${nClasses} classes in inputs.defect_classes.`, '',
    'Answer with JSON {"findings": [{"file": "src/...", "function": "<name>", "class": "<code>", "line": <optional>, "witness": {"args": [...]} }]}.',
    'A witness (optional) is a list of arguments the contract allows on which the function\'s result, thrown error or changed argument',
    'differs from what the contract requires; witnesses are run. The rules are in inputs.sweep_spec. Pass: precision >= 0.90 (one false',
    'positive is always tolerated) and recall >= 0.80 over (file, function, class).'].join('\n');
}

export { CLASSES };
