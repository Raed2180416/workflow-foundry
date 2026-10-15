// Golden x mutant failure matrix. For each mutant k of <dir>, run every exported golden (golden.mjs) and record
// the goldens it fails with their first failing message.   node gmatrix.mjs <mutantDir> [k0-k1] > out.jsonl
import { pathToFileURL } from 'node:url';
const R = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');   // beds/ebed/e8
const { goldens } = await import(pathToFileURL(`${R}/golden.mjs`).href);
const { unitChecks } = await import(pathToFileURL(`${R}/test/unit-checks.mjs`).href);
const [dir, range] = process.argv.slice(2);
const man = (await import(pathToFileURL(`${dir}/manifest.json`).href, { with: { type: 'json' } })).default;
const [a, b] = (range ?? `0-${man.length - 1}`).split('-').map(Number);
const orig = await import(pathToFileURL(`${dir}/orig.mjs`).href);
const base = goldens.map(g => { let r; try { r = g.check(orig.referenceTransition, orig.recordsOf); } catch (e) { r = `threw ${e.message}`; } return r; });
const bad = goldens.filter((g, i) => base[i] !== true).map(g => g.name);
if (bad.length) { console.error('goldens fail the original:', bad, base.filter(x => x !== true)); process.exit(1); }
for (let k = a; k <= b; k++) {
  let m; try { m = await import(pathToFileURL(`${dir}/m${k}.mjs`).href); } catch (e) { console.log(JSON.stringify({ k, err: String(e.message).slice(0, 80) })); continue; }
  const fails = {}, unit = {};
  for (const g of goldens) { let r; try { r = g.check(m.referenceTransition, m.recordsOf); } catch (e) { r = `threw ${String(e.message).slice(0, 80)}`; } if (r !== true) fails[g.name] = String(r).slice(0, 160); }
  for (const g of unitChecks) { let r; try { r = g.check(m.referenceTransition, m.recordsOf); } catch (e) { r = `threw ${String(e.message).slice(0, 80)}`; } if (r !== true) unit[g.name] = String(r).slice(0, 160); }
  console.log(JSON.stringify({ k, fails, unit }));
}
