// False-negative probes for the ownerci audit (AUDIT.md F6): semantically equivalent rewrites of
// the ORIGINAL module that a correct solver might return. Every one must pass the oracle.
import { tokenize } from '../mutate.mjs';

const reindent = (src, unit) => src.split('\n').map(l => l.replace(/^( {2})+/, m => unit.repeat(m.length / 2))).join('\n');

// Rename every top-level helper that is not exported (function or const), as code tokens only:
// not after `.`, not an object key, not a shorthand property.
function renameHelpers(src) {
  const toks = tokenize(src);
  const exported = new Set(toks.filter((t, k) => toks[k - 1]?.value === 'export' || (toks[k - 2]?.value === 'export' && ['function', 'const', 'class', 'let'].includes(toks[k - 1]?.value)))
    .map((t, k, all) => t.type === 'ident' && !['function', 'const', 'class', 'let', 'async'].includes(t.value) ? t.value : null).filter(Boolean));
  for (let k = 0; k < toks.length; k++) if (toks[k].value === 'export') { let j = k + 1; while (['async', 'function', 'const', 'class', 'let', '*'].includes(toks[j]?.value)) j++; if (toks[j]) exported.add(toks[j].value); }
  const names = new Set();
  toks.forEach((t, k) => { if (['function', 'const'].includes(t.value) && toks[k + 1]?.type === 'ident' && toks[k - 1]?.value !== 'export' && t.line === toks[k + 1].line && src.lastIndexOf('\n', t.start - 1) + 1 === t.start) names.add(toks[k + 1].value); });
  for (const n of exported) names.delete(n);
  const edits = toks.filter((t, k) => t.type === 'ident' && names.has(t.value) && toks[k - 1]?.value !== '.' && toks[k - 1]?.value !== '?.' && toks[k + 1]?.value !== ':'
    && !(['{', ','].includes(toks[k - 1]?.value) && ['}', ','].includes(toks[k + 1]?.value) && !['(', '['].includes(toks[k - 2]?.value)));
  let out = src;
  for (const t of [...edits].reverse()) out = `${out.slice(0, t.start)}${t.value}Renamed${out.slice(t.end)}`;
  return { source: out, renamed: [...names] };
}

// Inline `export function f` / `export const X` become declarations plus one `export { ... }` list.
function exportList(src) {
  const names = [];
  const out = src.replace(/^export (async function\*?|function\*?|const|let|class) ([A-Za-z_$][\w$]*)/gm, (_, kind, name) => { names.push(name); return `${kind} ${name}`; });
  return `${out.replace(/\n*$/, '\n')}\nexport { ${names.join(', ')} };\n`;
}

export const EQUIVALENTS = Object.freeze([
  ['crlf', src => src.replace(/\n/g, '\r\n')],
  ['four-space-indent', src => reindent(src, '    ')],
  ['tab-indent', src => reindent(src, '\t')],
  ['trailing-space-no-final-newline', src => src.split('\n').map(l => (l ? `${l}  ` : l)).join('\n').replace(/\s+$/, '')],
  ['comment-with-banned-words', src => `/**\n * Repaired module. Must not use process.env, globalThis, eval() or node:test (comment only).\n */\n${src}`],
  ['message-with-common-words', src => `${src.replace(/\n*$/, '\n')}const NOTE = 'cannot process the global. input; see eval (docs)';\nvoid NOTE;\n`],
  ['double-quoted-imports', src => src.replace(/^(import .* from )'([^']+)';/gm, '$1"$2";')],
  ['export-list', exportList],
  ['renamed-helpers', src => renameHelpers(src).source],
]);
export { renameHelpers };
