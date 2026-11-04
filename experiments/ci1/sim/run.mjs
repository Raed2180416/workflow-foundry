// Host side of n8n-sim: build the sandbox bundle (Luxon + the interpreter + a main) and run corpus workflows inside src/sandbox.mjs.
// Corpus definitions are untrusted: their expressions and Code nodes only ever execute in the sandbox (no network, no host files).
// runInProcess() exists for FIRST-PARTY fixtures in tests only.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCode } from '../../../src/sandbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LUXON = path.join(here, 'vendor/luxon-3.5.0/luxon.min.js');
export const LUXON_SHA256 = 'fd365dbd60506d97604fde4080c17a9c32f28e17b741d38ca70e152e791c82ae';
export const SIM_FILE = path.join(here, 'n8n-sim.js');

function luxonText() {
  const text = readFileSync(LUXON, 'utf8');
  const got = createHash('sha256').update(text).digest('hex');
  if (got !== LUXON_SHA256) throw new Error(`vendored luxon changed: ${got}`);
  return text;
}
const MAIN = `
export default async function main(input) {
  const vm = await import('node:vm'); const crypto = await import('node:crypto');
  const sim = createSim({ vm, crypto });
  const out = [];
  for (const [wi, wf] of input.workflows.entries()) {
    for (const world of input.worlds) {
      const r = await sim.run(wf, world, input.binding ?? {}, input.opts ?? {});
      const keep = input.keep === 'all' || (input.keep !== 'effects' && wi === 0);
      out.push({ workflow: wi, world: world.id, ok: r.ok, error: r.error ?? null, effects: r.effects.filter(e => e.kind !== 'sheet.read'),
        sheets: input.sheetsOut ? Object.fromEntries(Object.entries(r.sheets).filter(([k]) => input.sheetsOut.includes(k))) : undefined,
        trace: keep ? r.trace : undefined, steps: r.steps });
    }
  }
  return out;
}`;
let cached = null;
/** The ES module source run inside the sandbox, and its sha256 (recorded with every reference run). */
export function bundle() {
  if (cached) return cached;
  const source = `${luxonText()}\nglobalThis.luxon = luxon;\n${readFileSync(SIM_FILE, 'utf8')}\n${MAIN}\n`;
  cached = { source, sha256: createHash('sha256').update(source).digest('hex'), bytes: Buffer.byteLength(source) };
  return cached;
}

/** Run workflows x worlds inside the sandbox. Splits the worlds so each call's output stays under the sandbox limit. */
export async function runSandboxed({ workflows, worlds, binding = {}, opts = {}, keep = 'first', sheetsOut = null, chunk = 20, timeoutMs = 120000 }) {
  const { source } = bundle();
  const results = [];
  for (let w0 = 0; w0 < worlds.length; w0 += chunk) {
    const part = worlds.slice(w0, w0 + chunk);
    for (let k = 0; k < workflows.length; k += Math.max(1, Math.floor(40 / part.length))) {
      const wfs = workflows.slice(k, k + Math.max(1, Math.floor(40 / part.length)));
      const r = await runCode({ lang: 'js', source, input: { workflows: wfs, worlds: part, binding, opts, keep: k === 0 ? keep : 'effects', sheetsOut }, timeoutMs, maxOutputBytes: 512 * 1024 });
      for (const row of r.value) results.push({ ...row, workflow: row.workflow + k });
    }
  }
  return results;
}

let hostLuxon = null;
/** First-party fixtures only (tests): the same interpreter in this process. */
export async function runInProcess(workflow, world, binding = {}, opts = {}) {
  if (!hostLuxon) { hostLuxon = vm.runInThisContext(`${luxonText()}\n;luxon`); globalThis.luxon = hostLuxon; }
  const { createSim } = await import(SIM_FILE);
  return createSim({ vm, crypto }).run(workflow, world, binding, opts);
}
