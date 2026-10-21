// Mercury as the builder from words (Preview; SPEC §12.2, A13). The key never enters the site's process memory beyond the moment it
// is read from the keychain and handed to a child process's environment; the child runs the existing model builder (through
// app/cli.mjs makeBuilder, the same entry the service uses) with a token cap, and returns the builder's result as JSON on stdout.
// The site process never logs, returns or stores the key. Nothing here has been run against the real provider in this build ($0).
//
//   parent: new WorkerBuilder({ keychain, tokenCap, workspace }).build(args) -> spawns `node builder-worker.mjs` with the key in env
//   child:  reads { args, workspace, tokenCap } on stdin, builds, prints { result } on stdout
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryError } from '../../src/data.mjs';
import { templateById, instantiate } from '../core/library.mjs';

const here = fileURLToPath(import.meta.url);
export const WORKER_ID = 'mercury-worker/1 (Preview: Mercury 3 with your key, in a child process; token cap required)';

export class WorkerBuilder {
  constructor({ keychain, tokenCap, workspace, command = [process.execPath, here], env = process.env, timeoutMs = 300000 }) {
    if (!(Number.isInteger(tokenCap) && tokenCap > 0)) throw new FoundryError('BUILDER_TOKEN_CAP', 'Mercury needs a daily token cap');
    Object.assign(this, { keychain, tokenCap, workspace, command, env, timeoutMs });
    this.id = WORKER_ID; this.async = true;
  }
  #key() {
    const k = this.keychain?.get?.('inception') ?? this.env.INCEPTION_API_KEY ?? null;
    if (!k) throw new FoundryError('KEY_MISSING', 'Add your Inception key first (AI keys), or set INCEPTION_API_KEY in your own terminal.');
    return k;
  }
  async build(args) {
    const key = this.#key();
    const [cmd, ...cmdArgs] = this.command;
    // The child's environment: PATH, the proxy settings the person set, and the key. Nothing else from this process.
    const childEnv = { PATH: this.env.PATH ?? '', INCEPTION_API_KEY: key, ...Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'].filter(n => this.env[n]).map(n => [n, this.env[n]])) };
    const child = spawn(cmd, cmdArgs, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.stdin.end(JSON.stringify({ args: { request: args.request, answers: args.answers ?? {}, base: args.base ?? null }, workspace: this.workspace, tokenCap: this.tokenCap }));
    const code = await new Promise(resolve => { const t = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, this.timeoutMs); child.on('close', c => { clearTimeout(t); resolve(c); }); });
    const scrub = s => String(s).split(key).join('[key]').slice(0, 500);
    if (code !== 0) throw new FoundryError('BUILDER_MODEL', `The Mercury builder stopped (${code}): ${scrub(err)}`);
    let parsed; try { parsed = JSON.parse(out); } catch { throw new FoundryError('BUILDER_MODEL', 'The Mercury builder gave no usable answer'); }
    if (JSON.stringify(parsed).includes(key)) throw new FoundryError('BUILDER_LEAK', 'The builder output contained the key; it was discarded');
    return { ...parsed.result, builder: WORKER_ID, modelBuilder: parsed.result?.builder ?? null };
  }
  rebase(built, base) {
    if (built.status !== 'ready') return built;
    return { ...built, workflow: instantiate(templateById(built.template), built.understood.slots, { version: base.version + 1, id: base.id, builder: this.id }) };
  }
}

// ---------------------------------------------------------------------------------------------------- the child
async function child() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { args, workspace, tokenCap } = JSON.parse(input);
  const { makeBuilder } = await import(path.join(path.dirname(here), '..', 'cli.mjs'));
  const builder = await makeBuilder('mercury', { workspace, tokenCap });
  const result = await builder.build(args);
  const { buildReport, ...rest } = result;
  process.stdout.write(JSON.stringify({ result: { ...rest, build: buildReport ? (({ callLog, ...r }) => r)(buildReport) : null } }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === here) child().catch(error => { process.stderr.write(`${error.code ?? 'ERROR'}: ${String(error.message).slice(0, 300)}`); process.exitCode = 1; });
