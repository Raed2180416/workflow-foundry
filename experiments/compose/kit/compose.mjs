// compose-kit/compose.mjs: checks for YOUR composed program, run from the program's directory.
//   node compose-kit/compose.mjs check   manifest, module files and declarations, as the platform checks them
//   node compose-kit/compose.mjs test    your module contract tests (node --test tests/)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { manifestProblems } from './runtime.mjs';
import { sourceProblems, scriptOf } from './loader.mjs';

const dir = process.cwd();
const cmd = process.argv[2] ?? 'check';

function vocabulary() {
  const ops = [];
  const api = path.join(dir, 'api');
  if (existsSync(api)) for (const f of readdirSync(api).filter(x => x.endsWith('.schema.json'))) {
    const s = JSON.parse(readFileSync(path.join(api, f), 'utf8'));
    const sys = s.system ?? f.replace('.schema.json', '');
    for (const op of Object.keys(s.ops ?? {})) ops.push(`${sys}.${op}`);
  }
  return { ops: ops.length ? ops : null, taskKinds: ['fraudReview'] };
}

function check() {
  const mf = path.join(dir, 'composition.json');
  if (!existsSync(mf)) return ['composition.json is missing'];
  let m;
  try { m = JSON.parse(readFileSync(mf, 'utf8')); } catch (e) { return [`composition.json: ${e.message}`]; }
  const out = manifestProblems(m, vocabulary());
  if (out.length) return out;
  for (const [who, d] of [['parent', m.parent], ...Object.entries(m.modules)]) {
    const p = path.join(dir, d.file);
    if (!existsSync(p)) { out.push(`${who}: ${d.file} is missing`); continue; }
    const src = readFileSync(p, 'utf8');
    const sp = sourceProblems(src);
    if (sp.length) { out.push(...sp.map(x => `${d.file}: ${x}`)); continue; }
    try { new vm.Script(scriptOf(src), { filename: d.file }); } catch (e) { out.push(`${d.file}: syntax: ${e.message}`); continue; }
    const fns = who === 'parent' ? ['tick'] : ['step', 'onEvent'];
    if (!fns.some(f => new RegExp(`export\\s+function\\s+${f}\\b`).test(src))) out.push(`${d.file}: exports none of ${fns.join(', ')}`);
    if (who !== 'parent' && !existsSync(path.join(dir, 'tests', `${who}.test.mjs`))) out.push(`${who}: no contract tests (tests/${who}.test.mjs)`);
  }
  return out;
}

if (cmd === 'check') {
  const p = check();
  if (p.length) { console.log(`${p.length} problem(s):\n${p.map(x => `  - ${x}`).join('\n')}`); process.exit(1); }
  console.log('composition: OK');
} else if (cmd === 'test') {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/*.test.mjs'], { cwd: dir, stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else { console.log('usage: node compose-kit/compose.mjs check | test'); process.exit(2); }
