import { readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const stack = path.resolve(root, '../..');
const names = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN', 'VERCEL', 'VERCEL_ENV'];
const present = Object.fromEntries(names.map(name => [name, typeof process.env[name] === 'string' && process.env[name].length > 0]));
const files = execFileSync('rg', ['--files', '--hidden', '-g', '!**/.git/**', '-g', '!**/__pycache__/**',
  '-g', '!**/.env*', '-g', '!**/*secret*', '-g', '!**/*credential*', '-g', '!**/*token*', '-g', '!**/auth.json',
  'bin', 'config', 'docs'], { cwd: stack, encoding: 'utf8', maxBuffer: 65536 }).trim().split('\n').sort();
const markers = /AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|VERCEL_TOKEN|JEV_API_KEY|VERCEL|\bJev\b|system.?one|ai-gateway|gateway\.vercel|AZURE_GROK_API_KEY|secret-tool/gi;
const inspected = [], skipped = [], matches = [];
for (const file of files) {
  const target = path.join(stack, file), stat = lstatSync(target), actual = realpathSync(target);
  if (!['bin', 'config', 'docs'].some(folder => actual.startsWith(path.join(stack, folder) + path.sep))
    || !stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) { skipped.push(file); continue; }
  const bytes = readFileSync(target);
  inspected.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  for (const [index, line] of bytes.toString('utf8').split('\n').entries()) {
    const found = line.match(markers);
    if (found) matches.push({ file, line: index + 1, markers: [...new Set(found)] });
  }
}
const gatewayReferences = matches.filter(item => item.markers.some(marker => !['AZURE_GROK_API_KEY', 'secret-tool'].includes(marker)));
const result = { checkedAt: new Date().toISOString(), scope: 'Current command process booleans; nonsecret source under bin/config/docs only',
  present, inspected, skipped, matches, gatewayReferences,
  status: present.AI_GATEWAY_API_KEY || present.VERCEL_OIDC_TOKEN ? 'CREDENTIAL_PRESENT_AUTHENTICATION_UNTESTED'
    : gatewayReferences.length ? 'MISSING_PROCESS_CREDENTIAL_REVIEW_SOURCE_REFERENCE' : 'BLOCKED_MISSING_SUPPORTED_CREDENTIAL_INJECTION',
  interpretation: 'Azure Grok launchers are not a Jev injection interface and were not executed. This does not establish absence of credentials elsewhere on the machine.',
  credentialFilesRead: 0, otherProcessEnvironmentsRead: 0, credentialValuesEmittedOrStored: 0, launchersExecuted: 0, inferenceCalls: 0 };
writeFileSync(path.join(root, 'ACCESS.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: result.status, present, sourceFiles: inspected.length, gatewayReferences: gatewayReferences.length, inferenceCalls: 0 }));
