// Triviality attack H2 (AUDIT.md step 5): a deterministic test-driven repairer. It runs the
// VISIBLE tests only (the workspace a solver gets), tries every single-token edit from a small
// operator set and greedily keeps the edit that makes the most visible tests pass.
import { runAsync } from '../runner.mjs';
import { MODULES } from '../modules.mjs';

const RULES = [[/<=/g, '<'], [/(?<![<=])<(?![<=])/g, '<='], [/>=/g, '>'], [/(?<![>=])>(?![>=])/g, '>='], [/===/g, '!=='], [/!==/g, '==='],
  [/&&/g, '||'], [/\|\|/g, '&&'], [/\btrue\b/g, 'false'], [/\bfalse\b/g, 'true'], [/!(?!=)/g, ''],
  [/(?<![\w.])\d+(?![\w.])/g, n => String(+n + 1)], [/(?<![\w.])\d+(?![\w.])/g, n => String(Math.max(0, +n - 1))],
  [/\(([^(),]+), ([^(),]+)\)/g, (_, a, b) => `(${b}, ${a})`]];

function candidates(src) {
  const lines = src.split('\n'), out = [];
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const [re, rep] of RULES) for (const m of line.matchAll(re)) {
      const edited = line.slice(0, m.index) + m[0].replace(new RegExp(re.source), rep) + line.slice(m.index + m[0].length);
      if (edited !== line) out.push([...lines.slice(0, i), edited, ...lines.slice(i + 1)].join('\n'));
    }
  });
  return [...new Set(out)];
}
async function visiblePasses(id, src) {
  const r = await runAsync(id, src, { includeHidden: false });
  const top = r.tests.filter(t => t.nesting === 0);
  return top.filter(t => t.status === 'pass').length - (top.length - top.filter(t => t.status === 'pass').length) / 1000;
}

export async function searchRepair(task, { concurrency = 4, rounds = 4 } = {}) {
  const id = Object.keys(MODULES).find(k => MODULES[k].modulePath === task.inputs.module_path);
  let cur = task.inputs.module_source, best = await visiblePasses(id, cur);
  for (let round = 0; round < rounds && best % 1 !== 0; round++) {
    const cands = candidates(cur), scores = new Array(cands.length);
    for (let i = 0; i < cands.length; i += concurrency) await Promise.all(cands.slice(i, i + concurrency).map(async (c, j) => { scores[i + j] = await visiblePasses(id, c); }));
    const k = scores.reduce((bi, s, i) => (s > scores[bi] ? i : bi), 0);
    if (!(scores[k] > best)) break;
    [cur, best] = [cands[k], scores[k]];
  }
  return { patched_source: cur };
}
