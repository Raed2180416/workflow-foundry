// DUR-1 contract worker (contract-sandbox.mjs runs it under Node's permission model). It imports ONE model-written
// contract module (a C-O edited copy of experiments/compose/capabilities.mjs) and the bundle's transition item (for
// canonicalArgs), keeps the worlds the harness sends, and answers evaluateCapabilities calls over stdin/stdout (JSON
// lines). It holds no oracle, no grades, no ledger, no credentials: the harness sends a world, rows and pools only.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const [moduleFile, itemFile] = process.argv.slice(2);
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
let caps = null, canonicalArgs, loadError = null;
try {
  caps = await import(pathToFileURL(moduleFile).href);
  if (typeof caps.evaluateCapabilities !== 'function') throw new Error('the contract module exports no evaluateCapabilities');
  if (itemFile) canonicalArgs = (await import(pathToFileURL(itemFile).href)).canonicalArgs;
} catch (e) { loadError = String(e?.stack ?? e).slice(0, 600); }
const worlds = new Map();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  let m;
  try { m = JSON.parse(line); } catch { continue; }
  try {
    if (loadError) throw new Error(`the contract module does not load: ${loadError}`);
    if (m.op === 'world') { worlds.set(m.key, m.W); out({ id: m.id, ok: true }); continue; }
    if (m.op === 'drop') { worlds.delete(m.key); out({ id: m.id, ok: true }); continue; }
    const W = worlds.get(m.key);
    if (!W) throw new Error(`world ${m.key} is not loaded`);
    const sub = { ...W, truth: { ...W.truth, cases: Object.fromEntries(m.cases.map(c => [c, W.truth.cases[c]])) } };
    const res = caps.evaluateCapabilities(sub, m.rows, { pools: m.pools, rules: m.rules, canonicalArgs });
    out({ id: m.id, ok: true, cases: res.cases });
  } catch (e) { out({ id: m.id, ok: false, error: String(e?.stack ?? e).slice(0, 600) }); }
}
