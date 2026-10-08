// Rows from the codefix bed (JUDGE-PROGRAM.md §1.2): X1 injected_instruction (train family, wave 1), F2 suspect_function
// (wave-2 smoke over four training domains; two domains are held out), X6 report_triage and Q6 spec_violation (wave 2,
// codefix is their held-out family: test-OOD only). Labels come from the span tap (taps/codefix.mjs) over the bed's own
// world truth; states come from the codefix kit (judges/failures.mjs). Beds are read through ctx.beds only.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spanHash, worldHash } from '../lib/hash.mjs';
import { alignCodefix, maskNames, truthOf } from '../taps/codefix.mjs';
import { codefixKit, MAX_SPAN_CHARS, moduleOutline, threadSegments } from '../judges/failures.mjs';
import { hasAddressee } from '../pools/filters.mjs';
import { bucketAllows, byHash, fail, formOf, makeRecord, paraphraseOf, pick, sha, unit } from './rows.mjs';

export const X1_ROWS = Object.freeze({ train: 323, 'calib-in': 50, 'calib-ood': 100, 'dev-select': 33, 'dev-ood': 100, 'test-in': 83, 'test-ood': 692 });
export const X1_TEST_OOD = Object.freeze({ template: 100, paraphrase: 67, long: 25, natural: 500 });
export const SMOKE_ROWS = Object.freeze({ F2: { train: 300, 'dev-select': 100, 'test-ood': 100 }, X6: { 'test-ood': 100 }, Q6: { 'test-ood': 100 } });
export const TRAIN_DOMAINS = Object.freeze(['inventory', 'scheduling', 'billing', 'tokenizer']);
export const HELDOUT_DOMAINS = Object.freeze(['routing', 'ratelimit']);
const X1_DIFFS = [3, 4, 4, 5, 5], ANY_DIFFS = [1, 2, 3, 3, 4, 4, 5, 5];
const POOL_SPLIT = { train: [0, 8], 'calib-in': [8, 9], 'dev-select': [9, 10] };      // pool lines by hash: 80% / 10% / 10%
export const stats = {};

const kindOfLine = text => (/^\s*#/.test(text) ? 'code comment' : /^\d{4}-\d{2}-\d{2}T/.test(text) || /^(WARN|INFO|ERROR|DEBUG) /.test(text) ? 'service log line' : 'issue comment');

// the pool lines of train-pools for family codefix (X1.jsonl), or [] when the pool was not built
export function poolLines(poolsDir) {
  const file = poolsDir ? path.join(poolsDir, 'X1.jsonl') : null;
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.port === 'X1' && l.family === 'codefix' && !l.slots?.length);
}

export async function codefixRecords({ slice, seeds, opts, ctx, ports }) {
  const { beds, contracts } = ctx;
  const cf = await beds.import('beds/codefix/build.mjs'), idx = await beds.import('beds/codefix/index.mjs'), rng = await beds.import('beds/lib/rng.mjs');
  const split = ctx.slice.bedSplit;
  const need = {};
  if (ports.includes('X1')) need.X1 = opts.rows?.X1?.[slice] ?? opts.codefix?.rows?.X1 ?? X1_ROWS[slice] ?? 0;
  for (const p of ['F2', 'X6', 'Q6']) if (ports.includes(p)) need[p] = opts.rows?.[p]?.[slice] ?? SMOKE_ROWS[p]?.[slice] ?? 0;
  const st = (stats[slice] = { need, worlds: 0, tap: { facts: 0, aligned: 0 }, dropped: {} });
  const drop = (reason, port) => { st.dropped[`${port}:${reason}`] = (st.dropped[`${port}:${reason}`] ?? 0) + 1; };
  const out = [], usedState = new Set();
  // one question per port per state (rule 5): identical states from two worlds are one row
  const fresh = (port, state) => { const k = `${port}|${JSON.stringify(state)}`; if (usedState.has(k)) { drop('duplicate-state', port); return false; } usedState.add(k); return true; };
  const have = { X1: { yes: 0, no: 0, hard: 0, rows: 0 }, F2: 0, X6: {}, Q6: {} };
  const domainOf = (seed, d) => cf.DOMAINS[rng.hashSeed('codefix-domain', split, seed, d) % cf.DOMAINS.length].id;
  const pool = need.X1 && POOL_SPLIT[slice] ? poolLines(ctx.poolsDir).filter(l => { const h = parseInt(sha(`pool|${l.id}`).slice(0, 6), 16) % 10; return h >= POOL_SPLIT[slice][0] && h < POOL_SPLIT[slice][1]; }) : [];
  let poolAt = 0;
  const wantYes = slice === 'train' || !slice.endsWith('-ood') ? 0.35 : 0.4;

  const done = () => (!need.X1 || have.X1.rows >= need.X1) && (!need.F2 || have.F2 >= need.F2) && (!need.X6 || sum(have.X6) >= need.X6) && (!need.Q6 || sum(have.Q6) >= need.Q6);
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const testOod = slice === 'test-ood';
  const x1Plan = testOod ? X1_TEST_OOD : null;
  const paraStates = [];

  for (let i = 0; i < seeds.length && !done(); i++) {
    const seed = seeds[i];
    const diffs = need.X1 && !need.F2 && !need.X6 && !need.Q6 ? X1_DIFFS : ANY_DIFFS;
    const difficulty = diffs[(hashInt(`${slice}|d|${seed}`)) % diffs.length];
    const domain = domainOf(seed, difficulty);
    // F2 families: four training domains outside test-ood, the two held-out domains in test-ood
    const wantF2 = need.F2 && have.F2 < need.F2 && (testOod ? HELDOUT_DOMAINS.includes(domain) : TRAIN_DOMAINS.includes(domain));
    const wantX1 = need.X1 && have.X1.rows < need.X1, wantX6 = need.X6 && sum(have.X6) < need.X6, wantQ6 = need.Q6 && sum(have.Q6) < need.Q6;
    if (!(wantF2 || wantX1 || wantX6 || wantQ6)) continue;
    let b, task;
    try { b = cf.build({ seed, split, difficulty }); task = idx.generate({ seed, split, difficulty }); } catch (e) { drop(`build:${e.message.slice(0, 40)}`, '*'); continue; }
    const truth = truthOf(b), tap = alignCodefix({ truth, inputs: task.inputs }), masks = maskNames(truth, b), wh = worldHash(task);
    st.worlds++; st.tap.facts += tap.stats.facts; st.tap.aligned += tap.stats.aligned;
    const base = { family: 'codefix', bed: 'codefix', seed, difficulty, worldHash: wh, masks };
    const stateOf = (port, slots) => codefixKit.buildState(task, slots, port);
    const spanForm = s => formOf(s.text, masks);

    // ---- X1 -------------------------------------------------------------------------------------------------------------
    if (wantX1) {
      const mk = (span, label, extra = {}) => {
        const text = span.text;
        if (text.length > MAX_SPAN_CHARS) { drop('too-long', 'X1'); return null; }
        const form = spanForm(span);
        if (!bucketAllows(slice, form)) { drop('wrong-bucket', 'X1'); return null; }
        const state = stateOf('X1', { span: span.id });
        if (!fresh('X1', state)) return null;
        return makeRecord({ contract: contracts.X1, slice, opts, key: `${slice}|X1|${seed}|${span.id}${extra.axis ?? ''}`, state, label,
          meta: { ...base, variant: extra.variant ?? 'clean', formId: form, surface: { source: 'bed', slice, lineHash: spanHash(text) }, kit: { port: 'X1', slots: { span: span.id } },
            x1: { role: span.role, hard: Boolean(span.hard), addressee: hasAddressee(text), source: 'bed', span: span.id, axis: extra.axis ?? 'base' } } });
      };
      const spans = [...tap.spans.values()];
      const room = () => need.X1 - have.X1.rows;
      const add = r => { if (!r) return false; out.push(r); const l = Object.values(r.questions)[0].label; have.X1[l]++; if (r.meta.x1.hard) have.X1.hard++; have.X1.rows++; return true; };
      if (testOod) {
        // the template axis (balanced, bed spans of the held-out skeleton bucket), the natural-rate set, the long variant, paraphrases
        const ax = (n, axis) => (have.X1[`ax:${axis}`] ?? 0) < n;
        const order = [...spans].sort((a, c) => byHash(sha(`${seed}|${a.id}`), sha(`${seed}|${c.id}`)));
        const yes = order.filter(s => s.label === 'yes'), hard = order.filter(s => s.hard && s.label === 'no'), plain = order.filter(s => !s.hard && s.label === 'no' && s.role !== 'unclaimed');
        const bump = (axis, r) => { if (add(r)) have.X1[`ax:${axis}`] = (have.X1[`ax:${axis}`] ?? 0) + 1; };
        for (const s of yes.slice(0, 2)) if (ax(x1Plan.template, 'template') && ax(x1Plan.template / 2, 'template-yes')) { const r = mk(s, 'yes', { axis: 'template' }); if (r) { bump('template', r); have.X1['ax:template-yes'] = (have.X1['ax:template-yes'] ?? 0) + 1; } }
        for (const s of hard.slice(0, 2)) if (ax(x1Plan.template, 'template')) bump('template', mk(s, 'no', { axis: 'template' }));
        for (const s of plain.slice(0, 1)) if (ax(x1Plan.template, 'template')) bump('template', mk(s, 'no', { axis: 'template' }));
        // natural rate: spans drawn uniformly, so injections are the rare class they are in a deployed codebase
        for (const s of order.filter(s => s.role === 'log-traffic' || s.role === 'noise' || s.role === 'code-other').slice(0, 4)) if (ax(x1Plan.natural, 'natural')) bump('natural', mk(s, 'no', { axis: 'natural' }));
        for (const s of yes.slice(0, 1)) if (ax(x1Plan.natural, 'natural') && unit(`${slice}|nat|${seed}|${s.id}`) < 0.3) bump('natural', mk(s, 'yes', { axis: 'natural' }));
        // long variant: the injected span inside its whole thread (label by whether the thread carries one)
        if (ax(x1Plan.long, 'long')) {
          const text = task.inputs.bug_report, form = formOf(text, masks);
          if (bucketAllows(slice, form) && text.length <= 4000) {
            const label = (b.knobs.injections ?? 0) > 0 ? 'yes' : 'no', state = stateOf('X1', { span: 'thread:all' });
            if (fresh('X1', state)) bump('long', makeRecord({ contract: contracts.X1, slice, opts, key: `${slice}|X1|${seed}|long`, state, label,
              meta: { ...base, variant: 'long', formId: form, surface: { source: 'bed', slice, lineHash: spanHash(text) }, kit: { port: 'X1', slots: { span: 'thread:all' } }, x1: { role: label === 'yes' ? 'injection' : 'thread', hard: false, addressee: hasAddressee(text), source: 'bed', span: 'thread:all', axis: 'long' } } }));
          } else drop('long-bucket-or-size', 'X1');
        }
        // paraphrase-consistency: a few template-axis states asked with three held-out wordings
        if ((have.X1['ax:paraphrase'] ?? 0) < x1Plan.paraphrase) {
          const cand = [...yes, ...hard].find(s => bucketAllows(slice, spanForm(s)) && s.text.length <= MAX_SPAN_CHARS);
          if (cand) {
            const r = mk(cand, cand.label, { axis: 'paraphrase' }), p = r ? paraphraseOf(r, contracts.X1, opts, `${slice}|X1|${seed}|${cand.id}|para`) : null;
            if (p) { p.meta.x1.axis = 'paraphrase'; out.push(p); have.X1.rows += 3; have.X1['ax:paraphrase'] = (have.X1['ax:paraphrase'] ?? 0) + 3; }
          }
        }
      } else {
        // train-like and OOD-selection slices: positives (every injection), hard negatives, plain negatives; mix wantYes
        const yes = spans.filter(s => s.label === 'yes'), hard = spans.filter(s => s.hard && s.label === 'no'), plain = spans.filter(s => !s.hard && s.label === 'no' && s.role !== 'unclaimed' && s.role !== 'vague-hint');
        const sorted = list => [...list].sort((a, c) => byHash(sha(`${slice}|${seed}|${a.id}`), sha(`${slice}|${seed}|${c.id}`)));
        for (const s of sorted(yes)) if (have.X1.yes < Math.ceil(need.X1 * wantYes) && room() > 0) add(mk(s, 'yes'));
        for (const s of sorted(hard).slice(0, 3)) if (have.X1.hard < Math.ceil(need.X1 * 0.4) && have.X1.no < Math.ceil(need.X1 * (1 - wantYes)) && room() > 0) add(mk(s, 'no'));
        for (const s of sorted(plain).slice(0, 2)) if (have.X1.no < Math.ceil(need.X1 * (1 - wantYes)) && room() > 0) add(mk(s, 'no'));
        // the long variant is 5% of the training rows
        if (slice === 'train' && unit(`${slice}|long|${seed}`) < 0.1 && room() > 0 && task.inputs.bug_report.length <= 4000) {
          const text = task.inputs.bug_report, form = formOf(text, masks);
          if (bucketAllows(slice, form) && fresh('X1', stateOf('X1', { span: 'thread:all' }))) {
            const label = (b.knobs.injections ?? 0) > 0 ? 'yes' : 'no';
            add(makeRecord({ contract: contracts.X1, slice, opts, key: `${slice}|X1|${seed}|long`, state: stateOf('X1', { span: 'thread:all' }), label,
              meta: { ...base, variant: 'long', formId: form, surface: { source: 'bed', slice, lineHash: spanHash(text) }, kit: { port: 'X1', slots: { span: 'thread:all' } }, x1: { role: label === 'yes' ? 'injection' : 'thread', hard: false, addressee: hasAddressee(text), source: 'bed', span: 'thread:all', axis: 'long' } } }));
          }
        }
        // authored lines of train-pools attached to this world (train-like slices only; the pool is a train surface)
        if (pool.length && poolAt < pool.length && room() > 0) {
          const take = pool.slice(poolAt, poolAt + 2);
          poolAt += take.length;
          for (const l of take) {
            const wantL = l.label === 'yes' ? have.X1.yes < Math.ceil(need.X1 * wantYes) : have.X1.no < Math.ceil(need.X1 * (1 - wantYes));
            if (!wantL || room() <= 0) continue;
            const form = formOf(l.text, masks);
            const state = { source_kind: kindOfLine(l.text), text: l.text };
            if (!fresh('X1', state)) continue;
            add(makeRecord({ contract: contracts.X1, slice, opts, key: `${slice}|X1|${seed}|pool|${l.id}`, state, label: l.label,
              meta: { ...base, variant: 'clean', labelSource: 'authored-brief', formId: form, surface: { source: 'authored', slice, lineHash: spanHash(l.text) },
                x1: { role: l.role, hard: l.role === 'hard-negative' || l.role === 'decoy', addressee: Boolean(l.addressee), source: 'pool', pool: l.id, axis: 'base' } } }));
          }
        }
      }
    }

    // ---- F2 -------------------------------------------------------------------------------------------------------------
    if (wantF2) {
      const { names, defs } = moduleOutline(task.inputs.source);
      if (names.length >= 2 && names.length <= 64 && new Set(names).size === names.length) {
        const descriptions = Object.fromEntries(defs.map(d => [d.name, d.line]));
        const family = `codefix:${domain}`;
        const bugsOf = tap.facts.filter(f => f.type === 'bug' && f.status === 'aligned');
        const rows = [];
        for (const f of bugsOf) {
          const site = truth.bugs.find(x => x.id === f.site), shown = site.fn.replace(/\(\)$/, '');
          const label = names.includes(shown) ? shown : names.includes(`${shown}.__init__`) ? `${shown}.__init__` : null;
          if (!label) { drop('label-not-in-outline', 'F2'); continue; }
          rows.push({ span: f.candidates[0], label, site: f.site });
        }
        if (b.bugs.length === 1) rows.push({ span: 'all', label: rows[0]?.label, site: b.bugs[0] });
        for (const rw of rows.filter(r => r.label)) {
          if (have.F2 >= need.F2) break;
          const state = stateOf('F2', { span: rw.span }), text = state.bug_report, form = formOf(text, masks);
          if (!fresh('F2', state)) continue;
          if (!bucketAllows(slice, form) && rw.span !== 'all') { drop('wrong-bucket', 'F2'); continue; }
          if (rw.span === 'all' && !bucketAllows(slice, formOf(text.slice(0, 600), masks))) { drop('wrong-bucket', 'F2'); continue; }
          out.push(makeRecord({ contract: contracts.F2, slice, opts, key: `${slice}|F2|${seed}|${rw.span}|${rw.site}`, state, label: rw.label, options: names, optionDescriptions: descriptions,
            meta: { ...base, family, variant: 'clean', formId: form, surface: { source: 'bed', slice, lineHash: spanHash(text) }, kit: { port: 'F2', slots: { span: rw.span } }, f2: { domain, site: rw.site, options: names.length, op: b.domain.sites[rw.site].op, span: rw.span } } }));
          have.F2++;
        }
      } else drop('outline-size', 'F2');
    }

    // ---- X6 (held-out family: test-ood) and Q6 ----------------------------------------------------------------------------
    if (wantX6) {
      const LABEL = { bug: 'lead', herring: 'designed', injection: 'instruction', noise: 'noise' };
      const per = need.X6 / 4;
      const pickable = [...tap.spans.values()].filter(s => s.kind === 'thread' && LABEL[s.role] && s.text.length <= MAX_SPAN_CHARS)
        .sort((a, c) => byHash(sha(`x6|${seed}|${a.id}`), sha(`x6|${seed}|${c.id}`)));
      for (const s of pickable) {
        const label = LABEL[s.role];
        if ((have.X6[label] ?? 0) >= per) continue;
        const form = spanForm(s);
        if (!bucketAllows(slice, form)) { drop('wrong-bucket', 'X6'); continue; }
        if (!fresh('X6', stateOf('X6', { span: s.id }))) continue;
        out.push(makeRecord({ contract: contracts.X6, slice, opts, key: `${slice}|X6|${seed}|${s.id}`, state: stateOf('X6', { span: s.id }), label,
          meta: { ...base, variant: 'clean', formId: form, surface: { source: 'bed', slice, lineHash: spanHash(s.text) }, kit: { port: 'X6', slots: { span: s.id } }, x6: { role: s.role } } }));
        have.X6[label] = (have.X6[label] ?? 0) + 1;
        if (sum(have.X6) >= need.X6) break;
      }
    }
    if (wantQ6) {
      const sections = threadSegments(task.inputs.bug_report).length ? null : null;
      const per = need.Q6 / 2, LABEL = { bug: 'defect', herring: 'designed' };
      const pickable = [...tap.spans.values()].filter(s => LABEL[s.role] && Number.isInteger(s.section) && s.text.length <= MAX_SPAN_CHARS)
        .sort((a, c) => byHash(sha(`q6|${seed}|${a.id}`), sha(`q6|${seed}|${c.id}`)));
      for (const s of pickable) {
        const label = LABEL[s.role];
        if ((have.Q6[label] ?? 0) >= per) continue;
        const form = spanForm(s);
        if (!bucketAllows(slice, form)) { drop('wrong-bucket', 'Q6'); continue; }
        let state;
        try { state = stateOf('Q6', { span: s.id, section: s.section }); } catch { drop('no-design-section', 'Q6'); continue; }
        if (!fresh('Q6', state)) continue;
        out.push(makeRecord({ contract: contracts.Q6, slice, opts, key: `${slice}|Q6|${seed}|${s.id}`, state, label,
          meta: { ...base, variant: 'clean', formId: form, surface: { source: 'bed', slice, lineHash: spanHash(s.text) }, kit: { port: 'Q6', slots: { span: s.id, section: s.section } }, q6: { role: s.role, section: s.section } } }));
        have.Q6[label] = (have.Q6[label] ?? 0) + 1;
        if (sum(have.Q6) >= need.Q6) break;
      }
    }
  }
  st.have = have; st.records = out.length; st.shortfall = Object.fromEntries(Object.entries(need).map(([p, n]) => [p, n - (p === 'X1' ? have.X1.rows : p === 'F2' ? have.F2 : sum(have[p]))]).filter(([, v]) => v > 0));
  st.tap.rate = st.tap.facts ? st.tap.aligned / st.tap.facts : 1;
  return out;
}
const hashInt = key => parseInt(sha(key).slice(0, 8), 16);
export { fail, pick };
