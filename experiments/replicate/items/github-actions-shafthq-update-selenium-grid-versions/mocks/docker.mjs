// Entry point of the `docker` shim (mocks/bin/docker). Understands exactly `docker compose -f FILE config [-q|--quiet]`; anything else
// is refused with exit 125, so a solution that calls docker for something else is visible, never silently accepted. No daemon.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateCompose } from './compose-validate.mjs';

const args = process.argv.slice(2);
const log = entry => { if (process.env.RBENCH_OUT) appendFileSync(path.join(process.env.RBENCH_OUT, 'docker.jsonl'), JSON.stringify(entry) + '\n'); };
const [sub, flag, file, verb, ...rest] = args;
if (sub !== 'compose' || flag !== '-f' || verb !== 'config' || rest.some(a => a !== '-q' && a !== '--quiet')) {
  log({ args, rc: 125, message: 'unsupported invocation' });
  process.stderr.write(`rbench docker stub: unsupported invocation: docker ${args.join(' ')}\n`);
  process.exit(125);
}
let text;
try { text = readFileSync(file, 'utf8'); }
catch (error) { log({ args, rc: 1, message: error.code }); process.stderr.write(`open ${file}: no such file or directory\n`); process.exit(1); }
let verdict;
try { verdict = validateCompose(text); }
catch (error) { log({ args, rc: 125, message: error.message }); process.stderr.write(`rbench docker stub: cannot judge this file: ${error.message}\n`); process.exit(125); }
log({ args, file, rc: verdict.ok ? 0 : 1, message: verdict.ok ? null : verdict.message });
if (!verdict.ok) { process.stderr.write(verdict.message + '\n'); process.exit(1); }
process.stdout.write(`name: rbench\nservices: ${verdict.services.join(', ')}\n`);
