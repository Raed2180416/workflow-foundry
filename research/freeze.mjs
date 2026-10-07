// Print the freeze record for a pre-registration: git HEAD, whether the tree is clean for the listed
// paths, and the sha256 of every file under them. Paste the output into the pre-registration's
// Amendments section. Usage: node research/freeze.mjs <path> [<path> ...]
import { createHash } from 'node:crypto';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const walk = p => statSync(p).isDirectory() ? readdirSync(p).sort().flatMap(f => walk(path.join(p, f))) : [p];
const paths = process.argv.slice(2);
if (!paths.length) { console.error('usage: node research/freeze.mjs <path> ...'); process.exit(2); }
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--', ...paths], { encoding: 'utf8' }).trim();
const files = paths.flatMap(walk).filter(f => !/(^|\/)(node_modules|\.git)\//.test(f));
const lines = files.map(f => `| \`${f}\` | \`${createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16)}\` |`);
const all = createHash('sha256').update(files.map(f => f + '\0' + createHash('sha256').update(readFileSync(f)).digest('hex')).join('\n')).digest('hex');
console.log(`Frozen at commit \`${head}\`${dirty ? ' (WARNING: uncommitted changes under the frozen paths)' : ''}; combined sha256 \`${all}\`.\n`);
console.log('| File | sha256 (first 16) |\n|---|---|');
console.log(lines.join('\n'));
if (dirty) { console.error('\nuncommitted changes:\n' + dirty); process.exit(1); }
