// Durability of one arm of a JIT stream (development code, research/jit-20261008). report.mjs answers "how many and at
// what cost"; this answers "does the compiled path settle, and does it stay settled": version churn, deopt and guard-fire
// rates, silent compiled misses, shadow disagreement, cost per task, each over a sliding window, and time-to-durable.
// It reads only the files stream.mjs writes (results.jsonl rows and events.jsonl lines of one arm directory).
//
//   computeDurability(rows, events, { window = 6, minSuccess = 0.8, kind }) -> summary (JSON)
//   CLI: node experiments/jit/durability.mjs <runDir> [--window 6] [--min-success 0.8] [--series] [--json]
//
// Definitions (rows sorted by idx, one per idx, the last one kept; "position" p is the row's place in that order, so a
// gap in idx is skipped, never counted as a task):
// - version in force at a row: row.version (the compiled version that ran or would have run); for a static arm the
//   constant 'static'; null for warmup, agent rows and JIT rows with no version yet.
// - version change: two consecutive rows with non-null, different versions; the change is at the later row's idx.
//   tasksBetweenChanges lists the rows from the first adoption to the first change, between changes, and from the last
//   change to the end (the last one is open: still running when the stream ended).
// - compiled attempt: a row with compiledStatus set (compiled code ran). Deopt: compiledStatus is not 'ok' (deopt,
//   crash, timeout, invalid; by kind from row.deoptKind). Guard fire: deoptKind 'guard'.
// - silent miss (oracle-scored, the experimenter's view, never the system's): delivered 'compiled' and pass false: the
//   system delivered compiled code's wrong answer with no signal. Rate = silent misses / compiled deliveries.
//   Overruled (system view): delivered 'adjudicated' (a shadow's majority replaced the compiled answer). Caught miss
//   (oracle view, only where stream.mjs recorded compiledPass): an overruled row whose compiled answer was wrong.
// - shadow disagreement: 'disagree' events / 'shadow' events with agree true or false (a shadow that gave no answer
//   is not counted).
// - window: the W rows ending at a position (fewer at the start); every rate is null when its denominator is 0.
// - time-to-durable: position p is a durable start when p + W <= N, the version in force is the same non-null value on
//   all of rows p..p+W-1, and the share of those W rows that were *delivered by compiled code and passed* is >= S
//   (oracle view; the system view uses "compiled status ok and no shadow disagreement" instead of the oracle's pass).
//   Durable starts of one version at consecutive positions form an episode {fromIdx, confirmedIdx (the row at which the
//   first window closes, when the claim becomes knowable), untilIdx (last row covered), version}. timeToDurable is the
//   first episode's fromIdx, with tasksToConfirm (rows through confirmedIdx) and usdToConfirm (cumulative $ through it);
//   null when there is no episode ("never durable"). holdsToEnd: the last episode covers the last row. relapses: episodes
//   after the first one began only after an earlier episode broke.
// The gap between the system view and the oracle view of durability is the silent-failure problem (DEV-NOTES D5): a
// static solver that never deopts is "durable" to itself while the oracle sees it fail.
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = Object.freeze({ window: 6, minSuccess: 0.8 });
const r4 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
const rate = (a, b) => (b ? r4(a / b) : null);
const has = (r, kind) => (r.events ?? []).some(e => e.kind === kind);
export const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

export function computeDurability(rows, events = [], opts = {}) {
  const W = Math.max(1, Math.floor(opts.window ?? DEFAULTS.window)), S = opts.minSuccess ?? DEFAULTS.minSuccess;
  const byIdx = new Map();
  for (const r of rows ?? []) if (r && Number.isInteger(r.idx)) byIdx.set(r.idx, r);
  const R = [...byIdx.values()].sort((a, b) => a.idx - b.idx), N = R.length;
  const kind = opts.kind ?? R[0]?.kind ?? null;
  const verOf = r => r.version ?? (kind === 'static' ? 'static' : null);

  // Per-row facts.
  const F = R.map(r => {
    const shadows = (r.events ?? []).filter(e => e.kind === 'shadow' && (e.agree === true || e.agree === false));
    const attempted = r.compiledStatus != null;
    return {
      idx: r.idx, version: verOf(r), costUsd: Number(r.costUsd) || 0, attempted, deopt: attempted && r.compiledStatus !== 'ok',
      deoptKind: attempted && r.compiledStatus !== 'ok' ? (r.compiledStatus === 'deopt' ? r.deoptKind ?? 'unknown' : r.compiledStatus) : null,
      compiledDelivered: r.delivered === 'compiled', pass: !!r.pass,
      silentMiss: r.delivered === 'compiled' && !r.pass, caughtMiss: r.delivered !== 'compiled' && r.compiledPass === false, overruled: r.delivered === 'adjudicated',
      shadows: shadows.length, disagree: (r.events ?? []).filter(e => e.kind === 'disagree').length,
      oracleOk: r.delivered === 'compiled' && !!r.pass, systemOk: attempted && r.compiledStatus === 'ok' && !has(r, 'disagree'),
    };
  });

  // Versions.
  const changes = [], spans = [];
  let first = null;
  for (let p = 0; p < N; p++) {
    const v = F[p].version;
    if (v == null) continue;
    const last = spans.at(-1);
    if (!last) { first = F[p].idx; spans.push({ version: v, fromIdx: F[p].idx, toIdx: F[p].idx, tasks: 1 }); continue; }
    if (last.version === v) { last.toIdx = F[p].idx; last.tasks++; continue; }
    changes.push({ idx: F[p].idx, from: last.version, to: v });
    spans.push({ version: v, fromIdx: F[p].idx, toIdx: F[p].idx, tasks: 1 });
  }
  const tasksBetweenChanges = spans.map(s => s.tasks);
  const ev = [...R.flatMap(r => (r.events ?? []).map(e => ({ ...e, idx: r.idx })))];
  const count = k => ev.filter(e => e.kind === k).length;

  // Windows.
  const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) ? 1 : 0), 0);
  const windows = F.map((f, p) => {
    const w = F.slice(Math.max(0, p - W + 1), p + 1), att = w.filter(x => x.attempted), del = w.filter(x => x.compiledDelivered);
    const sh = w.reduce((s, x) => s + x.shadows, 0);
    return {
      idx: f.idx, n: w.length, compiledAttempts: att.length, deoptRate: rate(sum(att, x => x.deopt), att.length), guardRate: rate(sum(att, x => x.deoptKind === 'guard'), att.length),
      compiledDeliveries: del.length, silentMissRate: rate(sum(del, x => x.silentMiss), del.length), shadows: sh, disagreeRate: rate(w.reduce((s, x) => s + x.disagree, 0), sh),
      usdPerTask: r4(w.reduce((s, x) => s + x.costUsd, 0) / w.length), compiledSuccessRate: rate(sum(w, x => x.oracleOk), w.length), systemOkRate: rate(sum(w, x => x.systemOk), w.length),
    };
  });

  // Durable episodes.
  let cum = 0;
  const cumUsd = F.map(f => (cum += f.costUsd));
  const episodesOf = okKey => {
    const out = [];
    for (let p = 0; p + W <= N; p++) {
      const w = F.slice(p, p + W), v = w[0].version;
      const durable = v != null && w.every(x => x.version === v) && sum(w, x => x[okKey]) / W >= S;
      if (!durable) continue;
      const last = out.at(-1);
      if (last && last.version === v && last.lastStart === p - 1) { last.lastStart = p; last.untilIdx = F[p + W - 1].idx; continue; }
      out.push({ version: v, fromIdx: F[p].idx, confirmedIdx: F[p + W - 1].idx, untilIdx: F[p + W - 1].idx, tasksToConfirm: p + W, usdToConfirm: r4(cumUsd[p + W - 1]), lastStart: p });
    }
    return out.map(({ lastStart, ...e }) => e);
  };
  const durableView = okKey => {
    const episodes = episodesOf(okKey), e0 = episodes[0] ?? null;
    return {
      timeToDurable: e0 ? e0.fromIdx : null, confirmedIdx: e0?.confirmedIdx ?? null, tasksToConfirm: e0?.tasksToConfirm ?? null, usdToConfirm: e0?.usdToConfirm ?? null,
      version: e0?.version ?? null, holdsToEnd: !!episodes.length && episodes.at(-1).untilIdx === F[N - 1].idx, relapses: Math.max(0, episodes.length - 1), episodes,
      note: episodes.length ? null : 'never durable',
    };
  };

  const att = F.filter(f => f.attempted), del = F.filter(f => f.compiledDelivered), shadowsAnswered = F.reduce((s, f) => s + f.shadows, 0);
  const deoptsByKind = {};
  for (const f of F) if (f.deoptKind) deoptsByKind[f.deoptKind] = (deoptsByKind[f.deoptKind] ?? 0) + 1;
  const billed = new Set(R.flatMap(r => r.spendIds ?? []));
  const unbilledUsd = (events ?? []).filter(e => e?.kind === 'spend' && !billed.has(e.id)).reduce((s, e) => s + (Number(e.costUsd) || 0), 0);
  const rowsUsd = F.reduce((s, f) => s + f.costUsd, 0);
  return {
    arm: R[0]?.arm ?? null, kind, tasks: N, params: { window: W, minSuccess: S },
    versions: {
      firstAdoptedIdx: first, count: spans.length, changes: changes.length, changeList: changes, spans, tasksBetweenChanges,
      meanTasksBetweenChanges: spans.length ? r4(tasksBetweenChanges.reduce((a, b) => a + b, 0) / spans.length) : null,
      compiles: count('compile'), recompiles: count('recompile'), rejected: count('rejected'), compileFailed: count('compile-failed'),
    },
    totals: {
      compiledAttempts: att.length, deopts: sum(att, f => f.deopt), deoptsByKind, deoptRate: rate(sum(att, f => f.deopt), att.length), guardRate: rate(sum(att, f => f.deoptKind === 'guard'), att.length),
      compiledDeliveries: del.length, silentMisses: sum(del, f => f.silentMiss), silentMissRate: rate(sum(del, f => f.silentMiss), del.length), caughtMisses: sum(F, f => f.caughtMiss), overruled: sum(F, f => f.overruled),
      shadowsAnswered, disagreements: F.reduce((s, f) => s + f.disagree, 0), disagreeRate: rate(F.reduce((s, f) => s + f.disagree, 0), shadowsAnswered),
      rowsUsd: r4(rowsUsd), unbilledUsd: r4(unbilledUsd), usdPerTask: N ? r4((rowsUsd + unbilledUsd) / N) : null,
      lastWindowUsdPerTask: windows.at(-1)?.usdPerTask ?? null,
    },
    durable: { oracle: durableView('oracleOk'), system: durableView('systemOk') },
    windows,
  };
}

// ---------------------------------------------------------------------------------------------- run directory + CLI
export function loadArms(runDir) {
  const out = [];
  for (const d of readdirSync(runDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(runDir, d.name);
    if (!existsSync(path.join(dir, 'results.jsonl'))) continue;
    const meta = existsSync(path.join(dir, 'arm.json')) ? JSON.parse(readFileSync(path.join(dir, 'arm.json'), 'utf8')) : { slug: d.name };
    out.push({ dir, meta, rows: readJsonl(path.join(dir, 'results.jsonl')), events: readJsonl(path.join(dir, 'events.jsonl')) });
  }
  return out.sort((a, b) => String(a.meta.spec ?? a.meta.slug).localeCompare(String(b.meta.spec ?? b.meta.slug)));
}

export function durabilityOfRun(runDir, opts = {}) {
  return loadArms(runDir).map(a => ({ spec: a.meta.spec ?? a.meta.slug, ...computeDurability(a.rows, a.events, { ...opts, kind: a.meta.kind ?? a.rows[0]?.kind }) }));
}

const pct = x => (x == null ? '–' : `${(100 * x).toFixed(0)}%`);
const usd = x => (x == null ? '–' : `$${x.toFixed(3)}`);
export function renderTable(results, { series = false } = {}) {
  const short = s => String(s).replace(/^static:.*\/([^/]+)\/solve\.mjs$/, 'static:$1');
  const p = results[0]?.params ?? DEFAULTS;
  const L = [`window W=${p.window}, durable needs one version for W rows with >= ${p.minSuccess} of them delivered by compiled code and passing (oracle view) or compiled ok with no shadow disagreement (system view)`, '',
    '| arm | n | versions (changes) | rows per version | deopt rate (guard) | silent-miss rate (n) | overruled (caught) | disagree rate | $/task (last window) | durable: oracle from / confirmed / holds | durable: system from / confirmed / holds |',
    '|---|---|---|---|---|---|---|---|---|---|---|'];
  const dv = d => (d.timeToDurable == null ? 'never' : `${d.timeToDurable} / ${d.confirmedIdx} (${usd(d.usdToConfirm)}) / ${d.holdsToEnd ? 'yes' : 'no'}${d.relapses ? `, ${d.relapses} relapse(s)` : ''}`);
  for (const a of results) {
    const t = a.totals, v = a.versions;
    L.push(`| ${short(a.spec ?? a.arm)} | ${a.tasks} | ${v.count} (${v.changes}) | ${v.tasksBetweenChanges.join(', ') || '–'} | ${pct(t.deoptRate)} (${pct(t.guardRate)}) | ${pct(t.silentMissRate)} (${t.silentMisses}/${t.compiledDeliveries}) | ${t.overruled} (${t.caughtMisses}) | ${pct(t.disagreeRate)} (${t.disagreements}/${t.shadowsAnswered}) | ${usd(t.usdPerTask)} (${usd(t.lastWindowUsdPerTask)}) | ${dv(a.durable.oracle)} | ${dv(a.durable.system)} |`);
  }
  if (series) for (const a of results) {
    L.push('', `### ${short(a.spec ?? a.arm)}`, '', '| idx | deopt | guard | silent miss | disagree | compiled success | system ok | $/task |', '|---|---|---|---|---|---|---|---|');
    for (const w of a.windows) L.push(`| ${w.idx} | ${pct(w.deoptRate)} | ${pct(w.guardRate)} | ${pct(w.silentMissRate)} | ${pct(w.disagreeRate)} | ${pct(w.compiledSuccessRate)} | ${pct(w.systemOkRate)} | ${usd(w.usdPerTask)} |`);
  }
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), dir = args.find(a => !a.startsWith('--') && !/^\d/.test(a));
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
  if (!dir || !existsSync(dir)) { console.error('usage: node experiments/jit/durability.mjs <runDir> [--window 6] [--min-success 0.8] [--series] [--json]'); process.exit(2); }
  const res = durabilityOfRun(path.resolve(dir), { window: val('--window', DEFAULTS.window), minSuccess: val('--min-success', DEFAULTS.minSuccess) });
  console.log(args.includes('--json') ? JSON.stringify(res, null, 1) : renderTable(res, { series: args.includes('--series') }));
}
