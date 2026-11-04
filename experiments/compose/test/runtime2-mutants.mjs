// The teeth of runtime2.test.mjs, reproducibly: each hand-written mutant of runtime2.mjs (or bundle2.mjs) is written in
// place, the test file is run in a child process, and the original is restored byte for byte (sha256 checked) before the
// next one. A mutant is killed when the test run fails. $0, no model calls. Review of 2026-11-04, finding D6: the
// builder's 14 mutants were not committed; this script is.
//   nice -n 15 node experiments/compose/test/runtime2-mutants.mjs [--only id,...] [--tests <file,...>] [--out <json>]
//   nice -n 15 node experiments/compose/test/runtime2-mutants.mjs --whole <file>   # the tests against a whole other
//                                                                                   # runtime2.mjs (e.g. the pre-review one)
// A backup of each touched file sits next to it (<file>.mutant-backup) while a mutant is in place; if this process is
// killed hard, restore from it.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE = path.resolve(here, '..');
const RT = path.join(COMPOSE, 'runtime2.mjs');
const B2 = path.join(COMPOSE, 'bundle2.mjs');
const sha = s => createHash('sha256').update(s).digest('hex');

/** [id, find, replace, file?]: `find` must occur exactly once in the file. */
export const MUTANTS = [
  ['caller-key-kept', '        e.key = nk;\n', '        e.key = legacy ?? nk;\n'],
  ['key-less-not-keyed', 'if (ids && ids.identity !== null) {', 'if (ids && ids.identity !== null && legacy) {'],
  ['after-not-rewritten', "      if (typeof e.after === 'string' && local.has(e.after)) e.after = local.get(e.after);\n", ''],
  ['compensates-not-rewritten', "      if (typeof e.compensates === 'string') e.compensates = local.get(e.compensates) ?? legacyMap.get(e.compensates) ?? e.compensates;\n", ''],
  ['compensates-not-across-ticks', ' ?? legacyMap.get(e.compensates) ?? e.compensates;', ' ?? e.compensates;'],
  ['identity-conflict-silenced', "    else if (rec.d !== digest) findings.push({ code: 'identity-conflict', key: nk, emitter: legacy, committed: rec.c === 1 });\n", ''],
  ['digest-kept-after-error', "  if (rec.c !== 1 && (said.status === 'error' || said.status === 'rate-limited')) rec.d = null;", ''],
  ['digest-kept-after-rate-limit', "(said.status === 'error' || said.status === 'rate-limited')) rec.d = null;", "said.status === 'error') rec.d = null;"],
  ['digest-reset-after-unknown', "(said.status === 'error' || said.status === 'rate-limited')) rec.d = null;", "said.status !== 'ok') rec.d = null;"],
  ['unresolved-not-recorded', '      if (legacy) envRecord(x, legacy, legacy, null, findings, { identity: false });   // reads, unknown ops, unresolved\n', ''],
  // D1: the surplus rule
  ['surplus-by-count (pre-review D1)', 'function envSurplus(rec, said) {\n', "function envSurplus(rec, said) {\n  return 'surplus';\n"],
  ['surplus-ok-always-delivered', "  if (said.status === 'ok') return rec.c === 1 ? 'surplus' : 'conflict';", "  if (said.status === 'ok') return 'conflict';"],
  ['surplus-key-conflict-dropped', "  if (said.error?.reason === 'key-conflict') return 'conflict';\n", ''],
  ['surplus-after-commit-delivered', "  if (rec.c === 1) return 'surplus-after-commit';", "  if (rec.c === 1) return 'conflict';"],
  ['surplus-differing-failure-dropped', "  return rec.l === said.digest ? 'surplus' : 'conflict';", "  return 'surplus';"],
  ['last-failure-not-recorded', '  rec.l = said.digest;\n', ''],
  ['partial-batch-dropped', "if (plan.every(p => p.why === 'orphan' || p.why === 'surplus' || p.why === 'surplus-after-commit')) {", "if (plan.some(p => p.why === 'orphan' || p.why === 'surplus' || p.why === 'surplus-after-commit')) {"],
  // D8: first-in first-out
  ['fifo-off (pre-review D8)', '    i = Array.isArray(rec.f) && rec.f.length ? rec.f[0] : rec.e.findIndex(z => z[2] < z[1]);', '    i = rec.e.findIndex(z => z[2] < z[1]);'],
  ['fifo-init-empty', 'rec.f = Array(Math.max(0, rec.e[0][1] - rec.e[0][2])).fill(0);', 'rec.f = [];'],
  ['latest-emitter-not-tracked', '  if (Array.isArray(rec.f)) { rec.f.push(idx); rec.z = idx; }', '  if (Array.isArray(rec.f)) { rec.f.push(idx); }'],
  // inbox basics
  ['timers-filtered', "  if (!r2IsObj(ev) || ev.type !== 'effect.result' || !r2IsObj(ev.payload)) return ev;", "  if (!r2IsObj(ev) || !r2IsObj(ev.payload)) return ev;\n  if (ev.type !== 'effect.result') return null;"],
  ['ctx-status-not-mapped', 'return status0(system, typeof key === \'string\' && m.has(key) ? m.get(key) : key);', 'return status0(system, key);'],
  // D7: eviction
  ['unanswered-evicted (pre-review D7)', '    if (!answered(k)) { i++; continue; }\n', ''],
  ['no-fail-loud', '  if (total > carryLimit) {', '  if (false) {'],
  ['parks-not-evicted-first', '  if (r2IsObj(x.p)) for (const k of Object.keys(x.p)) {', '  if (false) for (const k of Object.keys(x.p)) {'],
  // D2: read-back
  ['read-back-always-on', "export function withEnvelope(solver, { registry, id = null, ...opts } = {}) {", "export function withEnvelope(solver, { registry, id = null, ...opts0 } = {}) {\n  const opts = { ...opts0, reconcile: true };"],
  ['read-back-ignores-after', '!(legacy && afterTargets.has(legacy)) && ', ''],
  ['read-back-parks-own-reads', " && !slots[0].key.startsWith('=?')", ''],
  ['read-back-no-status-guard', ' && registry?.ops?.[`${e.system}.status`]?.read === true', ''],
  ['read-back-parks-ok (pre-review D2)', "\n      && ev.payload.status !== 'ok') {", ') {'],
  ['read-back-ignores-the-read (pre-review D2)', "    if (read !== 'not-found') {", '    if (false) {'],
  ['read-back-expiry-not-reissued', 'delete x.q[k]; x.w.push({ ...v.w, key: v.nk }); findings.push(', 'delete x.q[k]; findings.push('],
  ['park-never-expires', "    for (const [k, v] of Object.entries(x.p)) if (x.t - v.t > R2_PARK_TICKS) { delete x.p[k]; findings.push({ code: 'park-expired', key: k }); }\n", ''],
  // D9: injective identities
  ['values-not-escaped (pre-review D9)', '    const e = r2Esc(v);', '    const e = v;'],
  ['numbers-untyped', '    if (typeof v === \'number\') { if (!Number.isFinite(v)) { ok = false; return \'\'; } return `#${v}`; }', '    if (typeof v === \'number\') return String(v);'],
  ['default-spelling-collides', '    return dflt !== undefined && e === dflt ? `%=${e}` : e;', '    return e;'],
  ['registry-adjacent-slots-allowed', "      if (/\\}[^{:]*\\{/.test(e.identity)) out.push(`${op}: two slots must be separated by text containing ':'`);\n", ''],
  ['digest-second-pass-zeroed', "  return a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');", "  return a.toString(16).padStart(8, '0') + '00000000';"],
  // the static gate
  ['gate-exact-only', '  return true;                                              // equal, or one qualifies the other', '  return pa.length === pb.length;'],
  ['gate-reads-conflict', 'const isRead = k => registry?.ops?.[envKindParts(k)[0]]?.read === true;', 'const isRead = k => false;'],
  ['gate-default-report (pre-review D10)', "gate = 'enforce', envelopeOptions = {} } = {}) {", "gate = 'report', envelopeOptions = {} } = {}) {", B2],
].map(([id, find, replace, file = RT]) => ({ id, find, replace, file }));

function runTests(tests) {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...tests], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 600_000 });
  const failed = [...(r.stdout ?? '').matchAll(/^not ok \d+ - (.*)$/gm)].map(m => m[1]);
  return { code: r.status, failed };
}

function withFile(file, text, fn) {
  const orig = readFileSync(file, 'utf8');
  const h = sha(orig);
  const backup = `${file}.mutant-backup`;
  writeFileSync(backup, orig);
  try {
    writeFileSync(file, text);
    return fn();
  } finally {
    writeFileSync(file, orig);
    if (sha(readFileSync(file, 'utf8')) !== h) throw new Error(`${file} was not restored`);
    unlinkSync(backup);
  }
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const f of [RT, B2]) if (existsSync(`${f}.mutant-backup`)) throw new Error(`${f}.mutant-backup exists: a previous run was killed; restore it first`);
  const tests = (arg('--tests', null)?.split(',') ?? [path.join(here, 'runtime2.test.mjs')]).map(t => path.resolve(t));
  const out = { date: new Date().toISOString(), tests: tests.map(t => path.relative(path.resolve(COMPOSE, '../..'), t)), runtime2: sha(readFileSync(RT, 'utf8')), bundle2: sha(readFileSync(B2, 'utf8')) };
  const base = runTests(tests);
  out.baseline = base;
  if (base.code !== 0) { console.log(JSON.stringify(out, null, 1)); throw new Error('the unmutated tests fail'); }
  const whole = arg('--whole', null);
  if (whole) {
    out.whole = path.resolve(whole);
    out.wholeResult = withFile(RT, readFileSync(whole, 'utf8'), () => runTests(tests));
  } else {
    const only = arg('--only', null)?.split(',') ?? null;
    out.mutants = [];
    for (const m of MUTANTS) {
      if (only && !only.includes(m.id)) continue;
      const src = readFileSync(m.file, 'utf8');
      const n = src.split(m.find).length - 1;
      if (n !== 1) { out.mutants.push({ id: m.id, file: path.basename(m.file), error: `find occurs ${n} times` }); continue; }
      const r = withFile(m.file, src.replace(m.find, () => m.replace), () => runTests(tests));
      out.mutants.push({ id: m.id, file: path.basename(m.file), killed: r.code !== 0, failed: r.failed });
      console.error(`${r.code !== 0 ? 'killed  ' : 'SURVIVED'} ${m.id}${r.failed.length ? `  (${r.failed.length} failing: ${r.failed[0].slice(0, 70)})` : ''}`);
    }
    out.killed = out.mutants.filter(m => m.killed).length;
    out.of = out.mutants.length;
  }
  const o = arg('--out', null);
  if (o) writeFileSync(o, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ killed: out.killed, of: out.of, survivors: out.mutants?.filter(m => !m.killed).map(m => m.id), whole: out.wholeResult }, null, 1));
}
