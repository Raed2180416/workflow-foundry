// E8 mutation-mined latent defects (E-BED §2.10, §9.5 "reference mutants are the source of latent defects"; contract
// §2.4 module `defects.mjs`). $0, no model calls. Analyst-side: imports the oracle, never imported by the host or an arm.
//
// A **reference mutant** is a defective copy of the reference solver: the analyst reference policy
// (`oracle/policy.mjs` `referenceArm`) driven by a mutated copy of `transition.mjs` (the operator set of
// `tools/mutate.mjs`, read from that file as `ledger/mutants-20261015/harness/gen.mjs` does, so `ref-k<k>` is the same edit
// as oracle mutant k), or the policy with one of E-BED §3 E8's hand-proposed candidate defects (a policy `variant`, as the
// controls are built). The mutant runs as the ARM through the real host; the ORACLE stays the original transition.
//
// The miner (tools/defects-mine.mjs) keeps a mutant at the difficulties (its band) where, on every mining world:
//   1. it is **E0-silent, executed**: every case of the first epoch (epoch `ep0`, and the go-live backlog `gl`, which the
//      first epoch processes) is graded by the oracle on the mutant's own journal and none fails (no divergence, oracle
//      error, critical violation, or unfinished completed-pool case);
// and on at least one world of the band:
//   2. it **dies later**: some case of a later epoch fails, and
//   3. it is **revealed in E2 or E3** (§2.10): the first failing case whose failure becomes observable inside
//      [start of ep2, start of ep4) gets a planted revealing event (a customer complaint, carrier claim, warehouse
//      discrepancy or audit finding, `lagMinutes` after the failure), and every failing case observable by then is the
//      **sweep manifest** (the "computed manifest of earlier cases").
// For every true revealing event the plan also plants one **false revealing event** (§2.10, "at the same rate"): the same
// claim form about another case of the same world that the oracle passes on the mutant's trajectory, so the claim is
// invalid under the rulebook; where possible the journal agrees with the claim's facts (the refund really was not paid,
// because none was due), so only the rulebook refutes it (`hardness: 'rulebook'`).
// Revealing events are planned, not delivered: SPEC-E has no complaint vocabulary yet, so the manifests carry them as data
// for the heal-arm world builder (see the CLI `tools/defects-mine.mjs`).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateWorld, referenceRuns, oracleItem, binding, referenceTransition } from './index.mjs';
import { VARIANTS } from './controls.mjs';
import { referenceArm } from '../oracle/policy.mjs';
import { createHost } from '../host/host.mjs';
import { indexJournal, caseView, caseIds } from '../oracle/view.mjs';
import { gradeCase } from '../oracle/grade.mjs';
import { createHash } from 'node:crypto';
import { canonical, hashSeq, sha256 } from '../../lib/canonical.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
export const TRANSITION_FILE = path.join(here, 'transition.mjs');
export const MUTATE_FILE = path.join(here, 'tools', 'mutate.mjs');

/** The miner's declared parameters (recorded in every manifest). */
export const PARAMS = Object.freeze({
  e0Epochs: Object.freeze(['gl', 'ep0']),        // the first epoch and the go-live backlog it processes
  revealEpochs: Object.freeze(['ep2', 'ep3']),   // §2.10: revealed in E2 or E3 (window [start ep2, start ep4))
  lagMinutes: 24 * 60,                           // a claim arrives one day after its failure became observable
  timing: 'earliest',                            // the reference policy's timing for every mutant run
  runawayFactor: 3,                              // a mutant waking more than 3x as often as the reference (+500) is stopped: runaway
});

// ---------------------------------------------------------------------------------------------------------------------
// Mutants

/** tools/mutate.mjs's operator function, read from its source (the harness/gen.mjs method): one operator set, one numbering. */
export function mutateOperators(file = MUTATE_FILE) {
  const msrc = readFileSync(file, 'utf8');
  const a = msrc.indexOf('function mutants(src)'), b = msrc.indexOf('const worldsArg');
  if (a < 0 || b < a) throw new Error('tools/mutate.mjs: mutants(src) not found');
  return new Function(`${msrc.slice(a, b)}; return mutants;`)();
}

/** E-BED §9.5 operator name for one line edit of tools/mutate.mjs (from the edit, as harness/gen.mjs computes it). */
export function operatorOf(from, to) {
  if (to.trim() === 'void 0;') return 'dropped rule row';
  let i = 0; while (i < from.length && from[i] === to[i]) i++;
  let j = 0; while (j < from.length - i && j < to.length - i && from[from.length - 1 - j] === to[to.length - 1 - j]) j++;
  const cut = from.slice(i, from.length - j), put = to.slice(i, to.length - j), e = `${cut}\u2192${put}`;
  if (e === '=\u2192' || e === '\u2192=') return 'relational boundary';
  if (e === '=\u2192!' || e === '!\u2192=') return 'negated condition';
  if (e === '&&\u2192||' || e === '||\u2192&&') return 'connective swap';
  if (e === '12\u21926' || e === '6\u219212') return 'window constant';
  if (e === ' + SEC\u2192') return 'deadline boundary';
  if (e === ' - MIN\u2192') return 'window boundary';
  if (e === 'ax\u2192in' || e === 'in\u2192ax') return 'arithmetic swap (max/min)';
  if (e === '\u2192Last' || e === '[0]\u2192.at(-1)') return 'precedence swap (first to last match)';
  if (/after/.test(cut) && !/after/.test(put)) return 'ordering dependency dropped';
  if (/inTransit/.test(cut) && put === '') return 'deleted condition';
  if (/before\(row, cut/.test(from) && /row\.at < cut/.test(to)) return 'anchor swap (same-instant knowledge)';
  if (put === 'true') return 'deleted guard';
  return 'other';
}

/** The transition mutants: [{ id: 'ref-k<k>', k, kind: 'transition', operator, line, from, to, source }]. */
export function transitionMutants({ src = readFileSync(TRANSITION_FILE, 'utf8'), operators = mutateOperators() } = {}) {
  return operators(src).map((m, k) => {
    const lines = src.split('\n');
    lines[m.line] = m.to;
    return { id: `ref-k${k}`, k, kind: 'transition', operator: operatorOf(m.from, m.to), line: m.line + 1, from: m.from.trim(), to: m.to.trim(), source: lines.join('\n') };
  });
}

/** E-BED §3 E8's hand-proposed candidate defects, as reference-policy variants: admitted only by the same executed check. */
export const HAND_CANDIDATES = Object.freeze([
  { id: 'hc-refund-no-key', kind: 'policy', origin: 'E-BED §3 E8 candidate defect (hand-proposed)', operator: 'missing key', candidate: 'refund retried without a key',
    variant: () => ({ post: out => {
      // The refund goes out without a key; its dependants (releases) wait for it to commit (the next tick), since `after`
      // can only name a key.
      const bare = new Set(out.effects.filter(e => e.system === 'billing' && e.op === 'refund' && e.key).map(e => e.key));
      if (!bare.size) return out;
      return { ...out, effects: out.effects.filter(e => !bare.has(e.after)).map(e => (bare.has(e.key) ? (({ key, ...x }) => x)(e) : e)) };
    } }) },
  { id: 'hc-cancel-keeps-shipment', kind: 'policy', origin: 'E-BED §3 E8 candidate defect (hand-proposed)', operator: 'deleted compensation step', candidate: 'order cancel not cancelling a started child shipment',
    variant: () => ({ drop: e => e.lid.startsWith('csh:') && e.rule === 'R6.2' }) },
  { id: 'hc-late-signal-regresses', kind: 'policy', origin: 'E-BED §3 E8 candidate defect (hand-proposed)', operator: 'deleted guard (monotone status)', candidate: 'late in-transit signal regressing a delivered status',
    variant: world => VARIANTS['last-signal-wins'].variant(world) },
  // E-BED §9.5 "edition by run date" and §2.9 "latest edition always", applied to the reference policy's view of the rulebook.
  { id: 'op-edition-by-publication', kind: 'policy', origin: 'E-BED §9.5 operator', operator: 'edition by run date', candidate: 'an edition applied from its publication, not its effectiveFrom',
    variant: world => VARIANTS['edition-by-publication'].variant(world) },
  { id: 'op-latest-edition-always', kind: 'policy', origin: 'E-BED §2.9 necessity construct as an operator', operator: 'latest edition always', candidate: 'the newest published edition applied to every order',
    variant: world => {
      const w = structuredClone(world);
      const eds = w.rulebook.editions;
      if (eds.length > 1) w.rulebook.editions = [{ ...eds.at(-1), effectiveFrom: eds[0].effectiveFrom, effectiveTo: null }];
      return { armWorld: w };
    } },
  { id: 'hc-timer-first', kind: 'policy', origin: 'E-BED §3 E8 candidate defect (hand-proposed)', operator: 'precedence swap (timer before signal)', candidate: 'cancel-vs-timeout race resolved timer-first',
    variant: world => VARIANTS['timer-first'].variant(world) },
].map(Object.freeze));

/** The policy item hooks for a mutant: transition mutants are written to `dir` and imported (transition.mjs imports nothing). */
export async function armItemOf(mutant, dir) {
  if (mutant.kind !== 'transition') return oracleItem;
  const file = path.join(dir, `${mutant.id}.mjs`);
  writeFileSync(file, mutant.source);
  const mod = await import(pathToFileURL(file).href);
  return { ...oracleItem, referenceTransition: mod.referenceTransition, canonicalArgs: mod.canonicalArgs };
}

export const scratchDir = () => mkdtempSync(path.join(tmpdir(), 'e8-defects-'));
export const removeDir = dir => rmSync(dir, { recursive: true, force: true });

/** Run a mutant (as the arm) over a world through the real host (runReference's wiring, keeping the host so that a run
 * the host stops, a runaway, still yields its journal). Returns { rows, aborted: null | message }. */
export async function runMutant(mutant, world, { item, timing = PARAMS.timing, maxWakeups } = {}) {
  const variant = mutant.kind === 'policy' ? mutant.variant(world) : undefined;
  const holder = {};
  const arm = referenceArm({ item: item ?? oracleItem, world, timing, variant, id: `defect-${mutant.id}`,
    journal: () => ({ committed: holder.host.journal.rows, staged: holder.host.journal.staged }) });
  holder.host = createHost({ item: binding, world, arm, ...(maxWakeups ? { maxWakeups } : {}) });
  try { await holder.host.run(); return { rows: holder.host.journal.contentRows(), aborted: null }; }
  catch (e) { return { rows: holder.host.journal.contentRows(), aborted: String(e?.message ?? e).slice(0, 200) }; }
}

/** The journal's behaviour, independent of the arm's name (run.start names it; run.end digests ledger rows that carry
 * it): equal digests mean the same run. */
export const behaviourDigest = rows => hashSeq(rows.filter(r => r.type !== 'run.start' && r.type !== 'run.end').map(({ arm, ...r }) => r));

// ---------------------------------------------------------------------------------------------------------------------
// Worlds and grading

// The world object's own seed/difficulty fields are commented out in world.mjs's return (the `publicId` line comment),
// so the analyst-side meta is read from the world id `ebed-e8-<split>-<seed>-d<d>-<mix>`.
export function worldMeta(w) {
  const m = /^ebed-e8-([a-z]+)-(\d+)-d(\d)-([a-z]+)/.exec(w.id) ?? [];
  return { world: w.id, seed: Number(m[2]), split: m[1] ?? null, difficulty: Number(m[3]), mix: m[4] ?? null, generator: w.generator };
}

/** A mining world with its reference pools and the unmutated reference run's behaviour digest. */
export async function prepareWorld({ seed, difficulty, mix = 'tail', size = null }) {
  const world = generateWorld({ seed, difficulty, mix, ...(size ? { size } : {}) });
  const ref = await referenceRuns(world);
  const rows = ref.runs[PARAMS.timing].rows;
  const wakeups = rows.filter(r => r.type === 'wakeup').length;
  return { world, difficulty, seed, pools: ref.pools, refDigest: behaviourDigest(rows), maxWakeups: PARAMS.runawayFactor * wakeups + 500 };
}

const epochIndex = (world, atMs) => world.epochBounds.map(Date.parse).reduce((k, s, i) => (atMs >= s ? i : k), 0);
export const e0Cases = world => caseIds(world).filter(c => PARAMS.e0Epochs.includes(world.truth.cases[c].epoch));

/** A case the mutant got wrong (or could not finish where the reference does). */
export const failing = v => !!(v.firstDivergence || v.oracleError || v.critical.length || (v.pool === 'completed' && !v.pass));

const brief = v => ({ case: v.case, epoch: v.epoch, class: v.class, pool: v.pool,
  ...(v.firstDivergence ? { at: v.firstDivergence.at, layer: v.firstDivergence.layer, code: v.firstDivergence.code,
    ...(v.firstDivergence.lid ? { lid: v.firstDivergence.lid } : {}), ...(v.firstDivergence.rule ? { rule: v.firstDivergence.rule } : {}),
    ...(v.firstDivergence.system ? { effect: `${v.firstDivergence.system}.${v.firstDivergence.op}` } : {}),
    ...(v.firstDivergence.field ? { field: v.firstDivergence.field } : {}) } : {}),
  ...(v.critical.length ? { critical: v.critical.map(x => x.code) } : {}),
  ...(v.oracleError ? { oracleError: String(v.oracleError).slice(0, 160) } : {}),
  ...(!v.firstDivergence && !v.oracleError && v.pool === 'completed' && !v.pass ? { code: 'unfinished' } : {}) });

/**
 * Mine one mutant on one prepared world. The E0 cases are graded first (the executed E0-silence check); the rest only
 * when E0 is silent. Returns { meta, digest, inert, e0: { checked, failed }, affected, verdicts?, idx?, rows? }.
 */
export async function mineOnWorld({ mutant, item, prepared, keep = false }) {
  const { world, pools, refDigest } = prepared;
  const { rows, aborted } = await runMutant(mutant, world, { item, maxWakeups: prepared.maxWakeups });
  const digest = behaviourDigest(rows);
  const meta = { ...worldMeta(world), journal: digest };
  const checked = e0Cases(world);
  if (aborted) {
    // A runaway: grade the E0 cases on the journal up to the stop; only divergences strictly before it are real.
    const stop = Math.max(...rows.filter(r => r.type === 'wakeup').map(r => Date.parse(r.at)));
    const idx = indexJournal(world, rows, { canonicalArgs: oracleItem.canonicalArgs });
    const failed = checked.map(c => gradeCase({ item: oracleItem, world, idx, c, pool: pools[c] ?? null }))
      .filter(v => v.firstDivergence?.at && Date.parse(v.firstDivergence.at) < stop).map(brief);
    return { meta, digest, inert: false, aborted, stoppedAt: iso(stop), e0: { checked, failed, graded: true, partial: true }, affected: [] };
  }
  // A run identical to the reference run passes every case (contract §5.6 self-consistency); manifests re-grade it.
  if (digest === refDigest) return { meta, digest, inert: true, e0: { checked, failed: [], graded: false }, affected: [] };
  const idx = indexJournal(world, rows, { canonicalArgs: oracleItem.canonicalArgs });
  const grade = c => gradeCase({ item: oracleItem, world, idx, c, pool: pools[c] ?? null });
  const e0v = checked.map(grade);
  const failed = e0v.filter(failing).map(brief);
  if (failed.length) return { meta, digest, inert: false, e0: { checked, failed, graded: true }, affected: [] };
  const rest = caseIds(world).filter(c => !checked.includes(c)).map(grade);
  const affected = rest.filter(failing).map(brief);
  return { meta, digest, inert: digest === (prepared.refDigest0 ?? prepared.refDigest), e0: { checked, failed, graded: true }, affected, ...(keep ? { verdicts: [...e0v, ...rest], idx, rows } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Claims: revealing events (true) and their invalid twins (false)

const KIND_NAME = { create: 'order record', ost: 'order status', fst: 'fulfilment status', rsv: 'stock reservation', rel: 'stock release', chg: 'charge',
  rf: 'refund', shp: 'shipment booking', csh: 'shipment cancellation', ntf: 'notification', review: 'fraud review', records: 'records', decision: 'decision' };
const SOURCE = { rf: 'customer', chg: 'customer', ntf: 'customer', ost: 'customer', fst: 'customer', create: 'customer',
  rsv: 'warehouse', rel: 'warehouse', shp: 'carrier', csh: 'carrier' };
const CHANNEL = { customer: { type: 'customer.complaint', source: 'customer-service' }, warehouse: { type: 'warehouse.discrepancy', source: 'warehouse' },
  carrier: { type: 'carrier.claim', source: 'carrier-accounts' }, audit: { type: 'audit.finding', source: 'internal-audit' } };
const ASSERT_OF = { missed: 'missing', late: 'late', early: 'premature', order: 'out-of-order', duplicate: 'duplicate', 'key-split': 'key', 'key-reuse': 'key',
  'outside-allowed': 'unwarranted', records: 'records', decision: 'decision', 'over-escalation': 'escalation', 'under-escalation': 'escalation' };

export function parseLid(lid) {
  const [kind, a, b] = String(lid).split(':');
  switch (kind) {
    case 'create': case 'review': return { kind, O: a };
    case 'ost': return { kind, O: a, status: b };
    case 'fst': return { kind, F: a, status: b };
    case 'rsv': case 'rel': return { kind, F: a, sku: b };
    case 'chg': case 'shp': case 'csh': case 'rf': return { kind, F: a };
    case 'ntf': return { kind, about: a, template: b };
    default: return { kind };
  }
}
const lidOf = p => ({ create: `create:${p.O}`, ost: `ost:${p.O}:${p.status}`, fst: `fst:${p.F}:${p.status}`, rsv: `rsv:${p.F}:${p.sku}`, rel: `rel:${p.F}:${p.sku}`,
  chg: `chg:${p.F}`, shp: `shp:${p.F}`, csh: `csh:${p.F}`, rf: `rf:${p.F}`, ntf: `ntf:${p.about}:${p.template}`, review: `review:${p.O}` })[p.kind] ?? null;
function partsOfEffect(system, op, args = {}) {
  if (system === 'orders' && op === 'setStatus') return args.fulfilmentId ? { kind: 'fst', F: args.fulfilmentId, status: args.status } : { kind: 'ost', O: args.orderId, status: args.status };
  const kind = { 'billing.refund': 'rf', 'billing.charge': 'chg', 'carrier.create': 'shp', 'carrier.cancel': 'csh', 'inventory.reserve': 'rsv',
    'inventory.release': 'rel', 'orders.create': 'create', 'notify.send': 'ntf' }[`${system}.${op}`] ?? `${system}.${op}`;
  const p = { kind };
  if (['rf', 'chg', 'shp', 'csh', 'rsv', 'rel'].includes(kind)) p.F = args.fulfilmentId;
  if (['rsv', 'rel'].includes(kind)) p.sku = args.sku;
  if (kind === 'create') p.O = args.orderId;
  if (kind === 'ntf') { p.about = args.about; p.template = args.template; }
  return p;
}
/** The ledger pattern of a lid's effect (system, op, match), for journal checks. */
function effectOf(p, O) {
  switch (p.kind) {
    case 'create': return { system: 'orders', op: 'create', match: { orderId: O } };
    case 'ost': return { system: 'orders', op: 'setStatus', match: { orderId: O, fulfilmentId: null, status: p.status } };
    case 'fst': return { system: 'orders', op: 'setStatus', match: { orderId: O, fulfilmentId: p.F, status: p.status } };
    case 'rsv': return { system: 'inventory', op: 'reserve', match: { fulfilmentId: p.F, sku: p.sku } };
    case 'rel': return { system: 'inventory', op: 'release', match: { fulfilmentId: p.F, sku: p.sku } };
    case 'chg': return { system: 'billing', op: 'charge', match: { fulfilmentId: p.F } };
    case 'rf': return { system: 'billing', op: 'refund', match: { fulfilmentId: p.F } };
    case 'shp': return { system: 'carrier', op: 'create', match: { fulfilmentId: p.F } };
    case 'csh': return { system: 'carrier', op: 'cancel', match: { fulfilmentId: p.F } };
    case 'ntf': return { system: 'notify', op: 'send', match: { about: p.about, template: p.template } };
    default: return null;
  }
}
const argsMatch = (match, args) => Object.keys(match).every(k => args && canonical(args[k] ?? null) === canonical(match[k]));
const committedRows = (idx, c, eff, atMs) => (eff ? idx.bucket(c).ledger.filter(r => r.committed && r.system === eff.system && r.op === eff.op && r.at <= atMs && argsMatch(eff.match, r.args)) : []);
const iso = m => `${new Date(m + 60 * MIN).toISOString().slice(0, 19)}+01:00`;   // E8 worlds: Europe/Amsterdam before 29 March, UTC+01:00

function claimText(assert, p, O, fields) {
  const subj = p.F ? `fulfilment ${p.F} of order ${O}` : p.about && p.about !== O ? `${p.about} (order ${O})` : `order ${O}`;
  const what = KIND_NAME[p.kind] ?? p.kind;
  const tag = p.status ? ` '${p.status}'` : p.template ? ` '${p.template}'` : '';
  const item = p.sku ? ` (item ${p.sku})` : '';
  return {
    missing: `No ${what}${tag}${item} was received for ${subj}.`,
    late: `The ${what}${tag}${item} for ${subj} came late.`,
    premature: `The ${what}${tag}${item} for ${subj} came before it was due.`,
    'out-of-order': `The ${what}${tag}${item} for ${subj} came before the step it depends on.`,
    duplicate: `The ${what}${tag}${item} for ${subj} happened twice.`,
    key: `The ${what}${tag}${item} for ${subj} was sent under two different idempotency keys.`,
    unwarranted: `An unexpected ${what}${tag}${item} was made for ${subj}.`,
    wrong: `The ${what}${item} for ${subj} is wrong (${(fields ?? []).join(', ')}).`,
    records: `The records of ${subj} do not match what happened.`,
    decision: `The order record ${O} is attributed to the wrong order.`,
    escalation: `The fraud review of ${subj} was handled wrongly.`,
  }[assert];
}

function claimEvent({ world, c, p, assert, fields = null, atMs, id }) {
  const t = world.truth.cases[c];
  const O = t.subject;
  const ch = CHANNEL[['records', 'decision', 'escalation', 'key'].includes(assert) ? 'audit' : (SOURCE[p.kind] ?? 'audit')];
  const payload = { claimId: id, orderRef: O, assert, subject: KIND_NAME[p.kind] ?? p.kind };
  if (p.F) payload.fulfilmentRef = p.F;
  if (p.kind === 'ntf' && p.about && p.about !== O) payload.fulfilmentRef = p.about;
  if (p.sku) payload.sku = p.sku;
  if (p.status && assert !== 'wrong') payload.status = p.status;
  if (p.template && assert !== 'wrong') payload.template = p.template;
  if (fields?.length) payload.fields = fields;
  payload.from = ch.type === 'customer.complaint' ? t.email : ch.source;
  payload.text = claimText(assert, p, O, fields);
  return { id, type: ch.type, at: iso(atMs), source: ch.source, payload };
}

/** When a case's failure becomes observable: the divergence's time; for a records divergence (graded at the horizon) the
 * case's last ledger row or end, whichever is later. */
function observableAt(world, idx, v) {
  const d = v.firstDivergence;
  if (!d || d.at === null) return null;
  const at = Date.parse(d.at);
  if (d.layer !== 5) return at;
  const last = Math.max(Date.parse(world.truth.cases[v.case].start), ...idx.bucket(v.case).ledger.map(r => r.at));
  let end = null;
  try { end = referenceTransition(world, caseView(idx, v.case, idx.horizonMs, Infinity)).end?.at ?? null; } catch { /* the trajectory may be past totality */ }
  return Math.max(last, end ?? last);
}

/** The claim a failing case gives rise to (its first divergence, as an observer outside the arm would state it). An effect
 * outside the allowed set that has a required counterpart on the same subject (same order, fulfilment, item or notice
 * recipient) is reported as `wrong` in the fields that differ (a wrong amount, status or template), else `unwarranted`. */
function trueClaim(world, idx, v, atMs) {
  const d = v.firstDivergence;
  const O = world.truth.cases[v.case].subject;
  let assert = ASSERT_OF[d.code] ?? null;
  if (!assert || O === null) return null;
  let p, fields = null;
  if (d.code === 'outside-allowed') {
    p = partsOfEffect(d.system, d.op, d.args);
    const row = idx.bucket(v.case).ledger.find(r => r.at === Date.parse(d.at) && r.system === d.system && r.op === d.op && canonical(r.args) === canonical(d.args));
    let E = null;
    try { if (row) E = referenceTransition(world, caseView(idx, v.case, row.at, row.seq)); } catch { /* past totality */ }
    const subjectKeys = ['orderId', 'fulfilmentId', 'sku', 'about'];
    const exp = (E?.effects.required ?? []).find(e => e.system === d.system && e.op === d.op
      && subjectKeys.every(k => !(k in e.match) || !(k in (d.args ?? {})) || canonical(e.match[k]) === canonical(d.args[k])));
    if (exp) {
      const diff = Object.keys(exp.match).filter(k => canonical(exp.match[k]) !== canonical(d.args?.[k] ?? null));
      if (diff.length) { assert = 'wrong'; p = parseLid(exp.lid); fields = diff.sort(); }
    }
  } else if (d.code === 'records') p = { kind: 'records' };
  else if (d.code === 'decision') p = { kind: 'decision' };
  else if (d.layer === 4 || d.code === 'over-escalation') p = { kind: 'review', O };
  else p = parseLid(d.lid);
  const eff = effectFor(p, O, fields);
  // A missed effect that committed after its window but before the claim is reported as late.
  if (assert === 'missing' && committedRows(idx, v.case, eff, atMs).length) assert = 'late';
  let rule = d.rule ?? null;
  if (!rule && (d.lid || assert === 'wrong')) {
    const lid = d.lid ?? lidOf(p);
    try { rule = referenceTransition(world, caseView(idx, v.case, Date.parse(d.at), Infinity)).effects.required.find(e => e.lid === lid)?.rule ?? null; } catch { /* past totality */ }
  }
  if (!rule && d.code === 'records') rule = 'R7.1';
  if (!rule && d.code === 'outside-allowed') rule = 'SPEC-E §4 (an effect the rules do not ask for)';
  return { assert, p, fields, rule, hardness: hardnessOf(assert, committedRows(idx, v.case, eff, atMs).length > 0) };
}

/** The ledger pattern a claim is about; for `wrong`, the subject only (the claimed-wrong fields left out). */
function effectFor(p, O, fields) {
  const eff = effectOf(p, O);
  if (!eff || !fields?.length) return eff;
  return { ...eff, match: Object.fromEntries(Object.entries(eff.match).filter(([k]) => !fields.includes(k))) };
}

/** 'rulebook': the journal agrees with the claim's facts (the effect is absent for `missing`, present otherwise), so only
 * the rules can refute it; 'journal': the journal alone contradicts it (or the claim is about counts, keys or order). */
function hardnessOf(assert, done) {
  if (assert === 'missing') return done ? 'journal' : 'rulebook';
  if (['unwarranted', 'wrong', 'late', 'premature'].includes(assert)) return done ? 'rulebook' : 'journal';
  if (['duplicate', 'key', 'out-of-order'].includes(assert)) return 'journal';
  return 'rulebook';
}

// Near-miss classes for a false claim: cases where an observer would expect the claimed thing but the rulebook says no.
const NEAR = {
  cancelSide: ['cancel-after-collection', 'action-late', 'cancel-at-collection'],
  forward: ['fraud-reject', 'review-reject', 'review-timeout', 'cancel-wait', 'timeout', 'decline', 'cancel-processing'],
  timeout: ['action-at-deadline', 'amend', 'cancel-wait', 'action-late'],
  failure: ['collection-failed', 'decline', 'f6-carrier', 'f3-refund'],
  compensation: ['cancel-processing', 'collection-failed', 'decline', 'amend-then-cancel', 'f3-refund', 'f6-carrier'],
};
function nearMiss(assert, p, trueClass) {
  const s = p.status ?? p.template;
  const cancelSide = ['rf', 'rel', 'csh'].includes(p.kind) || s === 'cancelled' || s === 'order-cancelled';
  if (assert === 'missing') {
    if (cancelSide) return NEAR.cancelSide;
    if (s === 'timedOut' || s === 'order-timed-out') return NEAR.timeout;
    if (s === 'failed' || s === 'fulfilment-failed') return NEAR.failure;
    if (s === 'cancel-refused') return ['cancel-processing', 'cancel-wait', 'amend-then-cancel'];
    if (['create', 'rsv', 'chg', 'shp'].includes(p.kind) || ['processing', 'dispatched', 'completed'].includes(s)) return NEAR.forward;
  }
  if (assert === 'unwarranted' && cancelSide) return NEAR.compensation;
  return [trueClass];
}

/** Claim parts `p` re-targeted to case c' (order O2): candidate subjects, in a fixed order. */
function retarget(world, p, c2) {
  const t = world.truth.cases[c2];
  const O2 = t.subject;
  const alloc = world.sor['inventory.allocations'].find(a => a.orderId === O2)?.fulfilments ?? [];
  const avail = alloc.filter(f => f.available);
  switch (p.kind) {
    case 'create': case 'review': return [{ ...p, O: O2 }];
    case 'ost': return [{ ...p, O: O2 }];
    case 'fst': return alloc.map(f => ({ ...p, F: f.fulfilmentId }));
    case 'rsv': case 'rel': return avail.flatMap(f => f.items.map(i => ({ ...p, F: f.fulfilmentId, sku: i.sku })));
    case 'chg': case 'shp': case 'csh': case 'rf': return avail.map(f => ({ ...p, F: f.fulfilmentId }));
    case 'ntf': return p.about && /-F\d+$/.test(p.about) ? avail.map(f => ({ ...p, about: f.fulfilmentId })) : [{ ...p, about: O2 }];
    case 'records': case 'decision': return [{ ...p }];
    default: return [];
  }
}

/**
 * The false twin of a true claim: the same claim form about a case the oracle passes on this trajectory (so the claim is
 * invalid under the rulebook), timed the same way (its case's end + lag), inside the reveal window, closest in time to
 * the true event; near-miss classes first. `hardness: 'rulebook'` when the journal agrees with the claim's facts.
 */
function falseClaim({ world, idx, verdicts, affected, claim, trueAt, trueClass, window, lag }) {
  const bad = new Set(affected.map(a => a.case));
  const near = nearMiss(claim.assert, claim.p, trueClass);
  const cands = [];
  for (const v of verdicts) {
    const t = world.truth.cases[v.case];
    if (bad.has(v.case) || t.subject === null || !v.pass || !v.complete || v.critical.length || v.oracleError) continue;
    let E;
    try { E = referenceTransition(world, caseView(idx, v.case, idx.horizonMs, Infinity)); } catch { continue; }
    const anchor = E.end?.at ?? null;
    if (anchor === null) continue;
    const at = anchor + lag;
    if (!(at >= window[0] && at < window[1] && at <= idx.horizonMs)) continue;
    for (const p of retarget(world, claim.p, v.case)) {
      const eff = effectFor(p, t.subject, claim.fields);
      const done = committedRows(idx, v.case, eff, at).length > 0;
      if (claim.assert === 'missing') {
        let req = false;
        try { req = referenceTransition(world, caseView(idx, v.case, at, Infinity)).effects.required.some(e => e.lid === lidOf(p)); } catch { req = true; }
        if (req) continue;
      } else if (eff && !done) continue;        // a claim about an effect that never happened is not the same claim
      const hardness = hardnessOf(claim.assert, done);
      cands.push({ c: v.case, cls: t.class, p, at, hardness, rank: [hardness === 'rulebook' ? 0 : 1, near.includes(t.class) ? 0 : 1, Math.abs(at - trueAt)] });
      break;
    }
  }
  cands.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2] || (a.c < b.c ? -1 : a.c > b.c ? 1 : 0));
  return cands[0] ?? null;
}

/** Non-injected refusals on the affected cases that the world itself returned (409, 400, 404, ...; not declines). */
function naturalSignals(idx, affected) {
  const out = [];
  for (const a of affected) for (const r of idx.bucket(a.case).ledger) {
    if (r.committed || !r.error || r.injected || r.error.code === 402 || r.error.code === 'permanent') continue;
    out.push({ case: a.case, at: iso(r.at), effect: `${r.system}.${r.op}`, code: r.error.code, reason: r.error.reason ?? null });
  }
  return out.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}

/**
 * Plan the revealing events of a latent defect on one world from the mutant's journal and verdicts (mineOnWorld with
 * keep: true). Returns { reveal, falseReveal, sweep, natural } or { reveal: null, why }.
 */
export function planReveal({ world, mined, defectId, lag = PARAMS.lagMinutes * MIN }) {
  const { idx, verdicts } = mined;
  const bounds = world.epochBounds.map(Date.parse);
  const window = [bounds[2], bounds[4]];
  const failingV = verdicts.filter(failing);
  const obs = failingV.map(v => ({ v, at: observableAt(world, idx, v) })).filter(x => x.at !== null).sort((a, b) => a.at - b.at || (a.v.case < b.v.case ? -1 : 1));
  const natural = naturalSignals(idx, mined.affected).slice(0, 3);
  for (const { v, at } of obs) {
    const T = at + lag;
    if (!(T >= window[0] && T < window[1] && T <= idx.horizonMs)) continue;
    if (v.firstDivergence.layer === 0) {
      // A crash reveals itself when it happens (no planted event, no false twin); the rules it blocked are the obligations
      // open at the crash.
      let blocked = [];
      try { blocked = [...new Set(referenceTransition(world, caseView(idx, v.case, at, Infinity)).effects.required.map(e => e.rule))].sort(); } catch { /* past totality */ }
      return { reveal: { case: v.case, class: v.class, epoch: v.epoch, selfRevealing: 'arm-error', at: v.firstDivergence.at, blocked, event: null }, falseReveal: null,
        sweep: sweepOf(obs, at), natural };
    }
    const claim = trueClaim(world, idx, v, T);
    if (!claim) continue;
    const wm = worldMeta(world);
    const ev = claimEvent({ world, c: v.case, p: claim.p, assert: claim.assert, fields: claim.fields, atMs: T, id: `rev-${defectId}-${wm.seed}-d${wm.difficulty}` });
    const reveal = { case: v.case, class: v.class, epoch: v.epoch, observableAt: iso(at), eventEpoch: `ep${epochIndex(world, T)}`, divergence: brief(v),
      event: ev, truth: { valid: true, defect: defectId, rule: claim.rule, hardness: claim.hardness,
        reason: `the oracle fails ${v.case} at ${v.firstDivergence.at} (${v.firstDivergence.code}${v.firstDivergence.lid ? ` ${v.firstDivergence.lid}` : ''}) on the defect's trajectory` } };
    const f = falseClaim({ world, idx, verdicts, affected: mined.affected, claim, trueAt: T, trueClass: v.class, window, lag });
    const falseReveal = f ? { case: f.c, class: f.cls, epoch: world.truth.cases[f.c].epoch, eventEpoch: `ep${epochIndex(world, f.at)}`,
      event: claimEvent({ world, c: f.c, p: f.p, assert: claim.assert, fields: claim.fields, atMs: f.at, id: `inv-${defectId}-${wm.seed}-d${wm.difficulty}` }),
      truth: { valid: false, defect: defectId, hardness: f.hardness,
        reason: `the oracle passes ${f.c} on this trajectory, so the claim (${claim.assert} ${KIND_NAME[f.p.kind] ?? f.p.kind}) is invalid under the rulebook${f.hardness === 'rulebook' ? '; the journal agrees with its facts, only the rules refute it' : '; the journal contradicts it'}` } } : null;
    return { reveal, falseReveal, ...(f ? {} : { falseWhy: 'no passing case of the world fits the claim form inside the window' }), sweep: sweepOf(obs, T), natural };
  }
  return { reveal: null, why: obs.length ? 'no failure observable inside the E2/E3 window' : 'no observable failure', sweep: null, natural };
}

function sweepOf(obs, T) {
  const before = obs.filter(x => x.at <= T).map(x => x.v.case);
  const after = obs.filter(x => x.at > T).map(x => x.v.case);
  return { before, after };
}

// ---------------------------------------------------------------------------------------------------------------------
// Manifests

const git = file => { try { const b = readFileSync(file); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); } catch { return null; } };

/** Git blob ids of the files a manifest rests on (the mutant set, the arm, the oracle, the world). */
export function baseDigests() {
  const f = rel => path.join(here, rel);
  return { transition: git(f('transition.mjs')), mutate: git(f('tools/mutate.mjs')), policy: git(f('../oracle/policy.mjs')), grade: git(f('../oracle/grade.mjs')),
    view: git(f('../oracle/view.mjs')), world: git(f('world.mjs')), controls: git(f('controls.mjs')), defects: git(f('defects.mjs')) };
}

/**
 * One latent defect's manifest. `results` are the mined worlds of the representative mutant (mineOnWorld with keep), with
 * `plan` from planReveal on each; `members` the mutants with the same behaviour on every mining world.
 */
export function defectManifest({ id, mutant, members, membersBand = {}, results, oracleVerdict = null, band = null, outsideBand = null }) {
  const rules = new Set();
  for (const r of results) for (const a of r.affected) if (a.rule) rules.add(a.rule);
  for (const r of results) if (r.plan?.reveal?.truth?.rule) rules.add(r.plan.reveal.truth.rule);
  for (const r of results) for (const x of r.plan?.reveal?.blocked ?? []) rules.add(x);
  return {
    schema: 'ebed-e8-latent-defect/1',
    id,
    evidence: 'development (dev worlds 1001-1199); $0',
    mutant: { id: mutant.id, kind: mutant.kind, operator: mutant.operator,
      ...(mutant.kind === 'transition' ? { file: 'beds/ebed/e8/transition.mjs', line: mutant.line, from: mutant.from, to: mutant.to, sourceSha256: sha256(mutant.source) }
        : { file: 'beds/ebed/e8/defects.mjs', candidate: mutant.candidate, origin: mutant.origin }),
      ...(oracleVerdict ? { asOracleMutant: oracleVerdict } : {}) },
    members,
    ...(Object.keys(membersBand).length ? { membersBand } : {}),
    ...(band ? { band, outsideBand } : {}),
    solver: { policy: 'beds/ebed/oracle/policy.mjs referenceArm', timing: PARAMS.timing, oracle: 'original transition.mjs' },
    contradicts: [...rules].sort(),
    revealedBy: results.some(r => r.plan?.reveal?.event) ? 'in-world event (planted)' : 'self (arm error)',
    params: { e0Epochs: PARAMS.e0Epochs, revealEpochs: PARAMS.revealEpochs, lagMinutes: PARAMS.lagMinutes },
    e0Silence: { executed: true, worlds: results.length, casesChecked: results.reduce((s, r) => s + r.e0.checked.length, 0), failed: 0 },
    worlds: results.map(r => ({
      ...r.meta,
      inert: r.inert,
      e0: { checked: r.e0.checked, failed: r.e0.failed.length, graded: r.e0.graded },
      affected: r.affected,
      ...(r.plan ? { reveal: r.plan.reveal, ...(r.plan.reveal ? { falseReveal: r.plan.falseReveal, ...(r.plan.falseWhy ? { falseWhy: r.plan.falseWhy } : {}), sweep: r.plan.sweep } : { why: r.plan.why }),
        natural: r.plan.natural } : {}),
    })),
  };
}
