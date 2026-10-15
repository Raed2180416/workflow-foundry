// Witness search, v3 (v2 plus the host-consistency checks of consistent.mjs: carriers, systems' refusals, no held-up
// report on an order with a customer cancel).
// Witness search v2 (the one standard on golden inputs). A golden view becomes a journal; the history is
// completed by a simple conforming arm: every lid that any expectation along the way names (views truncated at each item
// and at each window's earliest, iterated to a fixpoint with the completion's own rows) and no history row satisfies is
// committed at its earliest after its predecessors. Variants: one lid moved to a window boundary (+-1 min) or skipped;
// one history step moved (removed and placed by the completion); one permitted pattern added. Each variant is graded by
// gradeCase under the original and the mutant at two horizons; a witness is a variant whose verdict or first divergence
// differs.  node gwit.mjs <mutantDir> <k,...> [golden-name-prefix]
import { pathToFileURL } from 'node:url';
const R = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');   // beds/ebed
const { goldens } = await import(pathToFileURL(`${R}/e8/golden.mjs`).href);
const { oracleItem } = await import(pathToFileURL(`${R}/e8/index.mjs`).href);
const { gradeCase } = await import(pathToFileURL(`${R}/oracle/grade.mjs`).href);
const [dir, kList, only] = process.argv.slice(2);
const MIN = 60_000;
const orig = await import(pathToFileURL(`${dir}/orig.mjs`).href);
const { carrierConsistent, systemsConsistent } = await import('./consistent.mjs');
let rejected = 0;
const reasons = new Map();
const canon = x => JSON.stringify(x, (key, v) => (v instanceof Set ? [...v].sort() : v));
const views = goldens.filter(g => !only || g.name.startsWith(only)).map(g => { const vs = []; try { g.check((w, v) => { vs.push([w, v]); return orig.referenceTransition(w, v); }, orig.recordsOf); } catch { /* */ } return { name: g.name, vs }; });
const fd = v => (v.firstDivergence ? `${v.firstDivergence.layer}/${v.firstDivergence.code}/${v.firstDivergence.lid ?? v.firstDivergence.field ?? ''}` : '');
// The verdict as the grader reports it: the first divergence when there is one (then pass is false whatever `complete` is),
// otherwise pass or censored (complete or not); an oracle error is its own outcome.
const sig = v => (v.oracleError ? 'E' : v.firstDivergence ? `D:${fd(v)}` : v.complete ? 'PASS' : 'OPEN');
const STATUS = { collected: 'collected', inTransit: 'inTransit', delivered: 'delivered', collectionFailed: 'failed' };
const meaningOf = (w, e) => JSON.parse(w.rulebook.editions[0].files['carrier-codes.json']).find(x => x.carrier === e.payload.carrier && x.code === e.payload.code)?.meaning ?? null;
function journal(w, v, rows, horizon) {
  const c = v.case;
  const world = { ...w, truth: { ...w.truth, cases: { ...w.truth.cases, [c]: v.truth } } };
  const items = [
    ...v.events.map(e => ({ k: 'd', at: e.at, ph: 2, s: e.seq, x: e })),
    ...v.taskEvents.map(e => ({ k: 'te', at: e.at, ph: 1, s: e.seq, x: e })),
    ...v.tasks.map(t => ({ k: 't', at: t.at, ph: 3, s: t.seq, x: t })),
    ...rows.map(r => ({ k: 'r', at: r.at, ph: r.callAt < r.at ? 0 : 4, s: r.seq, x: r })),
    // The carriers' own shipment writes (actors.mjs): one per (fulfilment, status) at the time it happened (reportedAt).
    ...[...new Map(v.events.filter(e => e.type === 'carrier.status' && STATUS[meaningOf(w, e)]).map(e => [`${e.payload.fulfilmentRef}|${meaningOf(w, e)}`, e])).values()]
      .map(e => ({ k: 'w', at: Date.parse(e.payload.reportedAt ?? new Date(e.at).toISOString()), ph: -1, s: e.seq, x: { system: 'carrier', table: 'shipments', row: { fulfilmentId: e.payload.fulfilmentRef, status: STATUS[meaningOf(w, e)] }, source: `step:${e.id}` } })),
  ].sort((a, b) => a.at - b.at || a.ph - b.ph || a.s - b.s);
  const b = { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] }, writes = [];
  items.forEach((it, i) => {
    const seq = i + 1;
    if (it.k === 'd') b.deliveries.push({ seq, at: it.at, event: { id: it.x.id, type: it.x.type, source: it.x.source, payload: it.x.payload }, instance: it.x.instance ?? 'i-g', round: 1, route: null, case: c, truth: true });
    else if (it.k === 'te') b.taskEvents.push({ ...it.x, seq, case: c });
    else if (it.k === 't') b.tasks.push({ ...it.x, seq, case: c });
    else if (it.k === 'w') writes.push({ ...it.x, seq, at: it.at });
    else b.ledger.push({ ...it.x, seq, case: c, knows: it.x.knows ?? new Set(), given: it.x.given ?? new Set() });
  });
  return { world, c, idx: { world, horizonMs: horizon, ledger: b.ledger, writes, bucket: x => (x === c ? b : { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] }) } };
}
const grade = (item, J) => { try { return sig(gradeCase({ item, world: J.world, idx: J.idx, c: J.c })); } catch (e) { return `THROW ${String(e.message).slice(0, 60)}`; } };
const rawDiff = (a, b) => canon({ e: a.effects, t: a.humanTasks, term: a.terminal, rec: a.records, d: a.decisions }) !== canon({ e: b.effects, t: b.humanTasks, term: b.terminal, rec: b.records, d: b.decisions });
const matchRow = (r, d) => r.system === d.system && r.op === d.op && Object.keys(d.match).every(q => canon(r.args?.[q] ?? null) === canon(d.match[q]));
const truncate = (v, t, rows) => ({ ...v, at: t, seq: Infinity, events: v.events.filter(e => e.at < t), rows: rows.filter(r => r.at < t), tasks: v.tasks.filter(x => x.at < t), taskEvents: v.taskEvents.filter(x => x.at < t) });
/** Lids named along the way (latest definition per lid), given history + completion rows. */
function namedAlong(tr, w, v, rows) {
  const lids = new Map();
  const ts = new Set([...v.events.map(e => e.at), ...rows.map(r => r.at), ...v.tasks.map(x => x.at), ...v.taskEvents.map(x => x.at)].map(t => t + 1).concat([v.at]));
  for (const t of [...ts].sort((a, b) => a - b)) { if (t > v.at) continue; const E = tr(w, truncate(v, t, rows)); for (const d of E.effects.required) lids.set(d.lid, d); }
  return lids;
}
function completion(tr, w, v, hist, override = new Map(), skip = null) {
  let rows = [...hist], added = [];
  for (let round = 0; round < 5; round++) {
    const lids = namedAlong(tr, w, v, rows);
    const open = [...lids.values()].filter(d => d.lid !== skip && !rows.some(r => r.committed && matchRow(r, d)));
    if (!open.length) break;
    const when = new Map();
    const doneAt = l => { const d = lids.get(l); const r = d && rows.find(x => x.committed && matchRow(x, d)); return r ? r.at : -Infinity; };
    const tOf = d => { if (when.has(d.lid)) return when.get(d.lid); when.set(d.lid, -Infinity); const preds = (d.after ?? []).map(l => open.find(x => x.lid === l)).filter(Boolean);
      const t = override.has(d.lid) ? override.get(d.lid) : Math.max(d.window.earliest, ...preds.map(tOf), ...(d.after ?? []).map(doneAt)); when.set(d.lid, t); return t; };
    const key = d => hist.find(r => r.system === d.system && r.op === d.op && matchRow(r, d))?.key ?? `w:${d.lid}`;
    const fresh = open.map(d => ({ seq: 1e9 + added.length + open.indexOf(d), at: tOf(d), system: d.system, op: d.op, key: key(d), args: d.args ?? d.match, committed: true, status: 'ok', error: null, money: d.system === 'billing', callAt: tOf(d), lid: d.lid }));
    added = added.concat(fresh); rows = rows.concat(fresh);
  }
  return { rows, added };
}
for (const k of kList.split(',').map(Number)) {
  let m; try { m = await import(pathToFileURL(`${dir}/m${k}.mjs`).href); } catch (e) { console.log(JSON.stringify({ k, error: String(e.message).slice(0, 80) })); continue; }
  const mi = { ...oracleItem, referenceTransition: m.referenceTransition, recordsOf: m.recordsOf };
  let found = null, tried = 0, viewsDiff = 0;
  for (const g of views) {
    if (found) break;
    for (const [w, v0] of g.vs) {
      if (found) break;
      const Eo = orig.referenceTransition(w, v0); let Em; try { Em = m.referenceTransition(w, v0); } catch { Em = null; }
      if (Em && !rawDiff(Eo, Em)) continue;
      viewsDiff++;
      // Repair abbreviated history rows and keys (one key per lid over all attempts).
      const all = namedAlong(orig.referenceTransition, w, v0, v0.rows);
      const sub = (r, d) => Object.keys(r.args ?? {}).every(q => q === 'ref' || !(q in (d.args ?? d.match)) || canon(r.args[q]) === canon((d.args ?? d.match)[q]));
      const firstKey = new Map();
      const hist = v0.rows.map(r => { const d = [...all.values()].find(x => x.system === r.system && x.op === r.op && sub(r, x)); if (!d) return r;
        const args = matchRow(r, d) ? r.args : { ...(d.args ?? d.match), ...r.args, ...(d.args ?? d.match) };
        if (!firstKey.has(d.lid)) firstKey.set(d.lid, r.key); return { ...r, args, key: firstKey.get(d.lid) }; });
      const v = { ...v0, rows: hist };
      const both = [...all.values(), ...Eo.effects.required, ...(Em?.effects.required ?? [])];
      const variants = [completion(orig.referenceTransition, w, v, hist).rows];
      if (Em) { try { variants.push(completion(m.referenceTransition, w, v, hist).rows); } catch { /* the mutant throws on a truncated view */ } }
      for (const d of both) {
        for (const t of new Set([d.window.earliest, d.window.latest, d.window.latest + MIN, d.window.earliest - MIN])) {
          const inHist = hist.filter(r => r.committed && matchRow(r, d));
          const h2 = hist.filter(r => !inHist.includes(r));
          const c = completion(orig.referenceTransition, w, v, h2, new Map([[d.lid, t]]));
          variants.push(c.added.some(r => r.lid === d.lid) ? c.rows : c.rows.concat([{ seq: 2e9, at: t, system: d.system, op: d.op, key: inHist[0]?.key ?? `w:${d.lid}`, args: d.args ?? d.match, committed: true, status: 'ok', error: null, money: d.system === 'billing', callAt: t }]));
        }
        variants.push(completion(orig.referenceTransition, w, v, hist, new Map(), d.lid).rows);
      }
      const base = variants[0];
      for (const p of [...Eo.effects.permitted, ...(Em?.effects.permitted ?? [])]) variants.push(base.concat([{ seq: 3e9, at: v.at, system: p.system, op: p.op, key: `p:${p.op}:${canon(p.match)}`, args: p.match, committed: true, status: 'ok', error: null, money: p.system === 'billing', callAt: v.at }]));
      const lastLatest = Math.max(v.at, ...both.map(d => d.window.latest));
      for (const rows of variants) {
        const t = Math.max(v.at, ...rows.map(r => r.at));
        for (const H of [t + MIN, lastLatest + MIN]) {
          tried++;
          { const why = carrierConsistent(w, v, rows, H, orig.collectionAt) || systemsConsistent(w, v, rows); if (why) { rejected++; if (process.env.WHY) reasons.set(why, (reasons.get(why) ?? 0) + 1); continue; } }
          const a = grade(oracleItem, journal(w, v, rows, H)), b = grade(mi, journal(w, v, rows, H));
          if (a !== b) { found = { golden: g.name, rows: rows.filter(r => r.seq >= 1e9).map(r => `${r.key}@${(r.at - v.at) / MIN}`).join(' ').slice(-300), horizon: (H - v.at) / MIN, orig: a, mut: b }; break; }
        }
        if (found) break;
      }
    }
  }
  console.log(JSON.stringify({ k, viewsDiff, tried, rejected, witness: found, ...(process.env.WHY ? { why: Object.fromEntries(reasons) } : {}) })); rejected = 0; reasons.clear();
}
