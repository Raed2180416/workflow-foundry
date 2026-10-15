// Regenerate mutate.mjs's mutants for a transition source; write <dir>/orig.mjs and <dir>/m<k>.mjs; print a manifest.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');   // beds/ebed/e8
const [src, dir] = process.argv.slice(2);
const SRC = readFileSync(src, 'utf8');
const msrc = readFileSync(`${REPO}/tools/mutate.mjs`, 'utf8');
const fnText = msrc.slice(msrc.indexOf('function mutants(src)'), msrc.indexOf('const worldsArg'));
const mutants = new Function(`${fnText}; return mutants;`)();
const all = mutants(SRC);
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/orig.mjs`, SRC);
const man = all.map((m, k) => {
  const lines = SRC.split('\n'); lines[m.line] = m.to;
  writeFileSync(`${dir}/m${k}.mjs`, lines.join('\n'));
  // the edit: common prefix/suffix stripped
  let i = 0; while (i < m.from.length && m.from[i] === m.to[i]) i++;
  let j = 0; while (j < m.from.length - i && m.from[m.from.length - 1 - j] === m.to[m.to.length - 1 - j]) j++;
  return { k, line: m.line + 1, cut: m.from.slice(i, m.from.length - j), put: m.to.slice(i, m.to.length - j), from: m.from.trim(), to: m.to.trim() };
});
writeFileSync(`${dir}/manifest.json`, JSON.stringify(man, null, 1));
console.log(`${all.length} mutants -> ${dir}`);
