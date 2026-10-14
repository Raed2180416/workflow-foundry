// P58 decision table with hit policies (DMN 1.x semantics over a typed subset) — authored blind for E-BED §8.1 step 1
// from outside sources only (FROZEN-P58-P60.json lists them). Fragment (flow, task, x, S) ->
// {decisions: [{id, edition, rules, result}], noMatch: [id]}.
// Slots: ITEMS (path), INPUTS ({input: fn item -> scalar}), OUTPUTS ([{name, values?}]; values = output priority list,
// highest first), HIT_POLICY, AGGREGATION, DISTINCT, EDITIONS ({editions: [{edition, effectiveFrom, effectiveTo?,
// rules: [{id, when: {input: unary test}, then: {output: literal}}]}]}), AS_OF (fn item -> YYYY-MM-DD), ON_NO_MATCH,
// MAX_ITEMS. Unary tests are a FEEL subset: '-' (any), a literal, < <= > >= = != literal, intervals [a..b] (a..b) ]a..b[
// with mixed ends, comma disjunction, not(...); literals are numbers, "strings", true, false, null, date("YYYY-MM-DD").
// Anything else is refused (invariant table-well-formed), never approximated. Deviations from DMN, on purpose: a test
// whose literal type differs from the input value's type deopts (guard input-type) where FEEL yields null and the rule
// silently fails to match; a missing input (undefined) deopts (guard input-present); results are always objects keyed
// by output name (also for one output); COLLECT without an operator returns rule order. No match gives result null and
// lists the id in noMatch (DMN: null), or deopts when ON_NO_MATCH is 'deopt' (a table that must be complete).
// G18 editions: the edition in force on AS_OF(item) (effectiveFrom inclusive, effectiveTo exclusive) decides the item;
// every decision names its edition; a date no edition covers deopts (guard edition-in-force). The wall clock is never read.
export default async function P58(flow, task, x, S) {
  const items = S.ITEMS(task, x);
  flow.guard('bounded', Array.isArray(items) && items.length <= S.MAX_ITEMS, { n: Array.isArray(items) ? items.length : null, max: S.MAX_ITEMS });
  flow.guard('unique-ids', items.every(it => it != null && it.id != null) && new Set(items.map(it => String(it.id))).size === items.length, { n: items.length });
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = d => typeof d === 'string' && DATE.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  const inputs = Object.keys(S.INPUTS), outs = S.OUTPUTS, names = outs.map(o => o.name);
  const scalar = v => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

  // ---- the FEEL unary-test subset ----
  const lit = src => {
    const s = src.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return { t: 'number', v: Number(s) };
    let m = s.match(/^\x22((?:[^\x22\\]|\\.)*)\x22$/);
    if (m) return { t: 'string', v: m[1].replace(/\\(.)/g, '$1') };
    m = s.match(/^date\(\s*\x22(\d{4}-\d{2}-\d{2})\x22\s*\)$/);
    if (m && validDate(m[1])) return { t: 'date', v: m[1] };
    if (s === 'true' || s === 'false') return { t: 'boolean', v: s === 'true' };
    if (s === 'null') return { t: 'null', v: null };
    throw new Error(`unsupported literal ${s}`);
  };
  const splitTop = s => {
    const parts = []; let cur = '', quoted = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted && c === '\\') { cur += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === '\x22') quoted = !quoted;
      if (c === ',' && !quoted) { parts.push(cur); cur = ''; } else cur += c;
    }
    parts.push(cur);
    return parts.map(p => p.trim());
  };
  const ORDERED = new Set(['number', 'string', 'date']);
  const one = s => {
    let m = s.match(/^(<=|>=|!=|<|>|=)\s*(.+)$/s);
    if (m) {
      const a = lit(m[2]);
      if (!['=', '!='].includes(m[1]) && !ORDERED.has(a.t)) throw new Error(`${m[1]} needs a number, string or date: ${s}`);
      return { op: m[1], a };
    }
    m = s.match(/^([[(\]])\s*(.+?)\s*\.\.\s*(.+?)\s*([\])[])$/s);
    if (m) {
      const lo = lit(m[2]), hi = lit(m[3]);
      if (lo.t !== hi.t || !ORDERED.has(lo.t) || lo.v > hi.v) throw new Error(`bad interval ${s}`);
      return { op: 'in', lo, hi, loClosed: m[1] === '[', hiClosed: m[4] === ']' };
    }
    return { op: '=', a: lit(s) };
  };
  const parseTest = src => {
    if (src === undefined) return null;
    if (!scalar(src)) throw new Error(`a test must be FEEL text or a JSON scalar: ${JSON.stringify(src)}`);
    const s = typeof src === 'string' ? src.trim() : JSON.stringify(src);
    if (s === '-' || s === '') return null;
    const m = s.match(/^not\s*\((.*)\)$/s);
    const parts = splitTop(m ? m[1] : s);
    if (parts.some(p => !p)) throw new Error(`empty disjunct in ${s}`);
    return { neg: !!m, any: parts.map(one), src: s };
  };
  // One cell. A literal of another type than the value is a type mismatch (recorded; the item then deopts).
  const fits = (t, v) => (t === 'date' ? typeof v === 'string' && validDate(v) : t === 'number' ? typeof v === 'number' : typeof v === t);
  const lt = (a, b) => a < b;
  const test1 = (u, v, bad) => {
    const ty = u.op === 'in' ? u.lo.t : u.a.t;
    if (u.op === '=' && ty === 'null') return v === null;
    if (u.op === '!=' && ty === 'null') return v !== null;
    if (v === null) return u.op === '!=';
    if (!fits(ty, v)) { bad(ty); return false; }
    if (u.op === 'in') return (u.loClosed ? !lt(v, u.lo.v) : lt(u.lo.v, v)) && (u.hiClosed ? !lt(u.hi.v, v) : lt(v, u.hi.v));
    const a = u.a.v;
    return u.op === '=' ? v === a : u.op === '!=' ? v !== a : u.op === '<' ? lt(v, a) : u.op === '<=' ? !lt(a, v) : u.op === '>' ? lt(a, v) : !lt(v, a);
  };
  const cell = (test, v, bad) => {
    if (test === null) return true;
    const hits = test.any.map(u => test1(u, v, bad));   // every disjunct is evaluated, so a type drift is never masked
    return test.neg ? !hits.some(Boolean) : hits.some(Boolean);
  };

  // ---- the table (checked once; a malformed table is the constructor's defect: invariant) ----
  const compile = () => {
    if (new Set(names).size !== names.length) throw new Error('output names repeat');
    if (S.AGGREGATION !== 'none' && (S.HIT_POLICY !== 'COLLECT' || names.length !== 1)) throw new Error('an aggregation needs COLLECT and exactly one output (DMN: no aggregation on compound outputs)');
    if (S.DISTINCT && !['SUM', 'COUNT'].includes(S.AGGREGATION)) throw new Error('DISTINCT applies to SUM and COUNT only');
    if (S.HIT_POLICY === 'OUTPUT_ORDER' && (names.length !== 1 || !outs[0].values)) throw new Error('OUTPUT_ORDER needs one output with a values list (DMN: not on compound outputs)');
    if (S.HIT_POLICY === 'PRIORITY' && !outs.some(o => o.values)) throw new Error('PRIORITY needs a values list on at least one output');
    const eds = S.EDITIONS?.editions;
    if (!Array.isArray(eds) || !eds.length) throw new Error('no editions');
    eds.forEach((e, i) => {
      if (typeof e?.edition !== 'string' || !e.edition) throw new Error(`edition ${i} has no name`);
      if (!validDate(e.effectiveFrom)) throw new Error(`${e.edition}: effectiveFrom must be YYYY-MM-DD`);
      if (e.effectiveTo != null && !(validDate(e.effectiveTo) && e.effectiveTo > e.effectiveFrom)) throw new Error(`${e.edition}: effectiveTo must be a later YYYY-MM-DD`);
      if (e.effectiveTo == null && i !== eds.length - 1) throw new Error(`${e.edition}: only the last edition may be open-ended`);
      if (i && eds[i - 1].effectiveTo > e.effectiveFrom) throw new Error(`${e.edition} overlaps ${eds[i - 1].edition}`);
    });
    if (new Set(eds.map(e => e.edition)).size !== eds.length) throw new Error('edition names repeat');
    return eds.map(e => {
      if (!Array.isArray(e.rules) || !e.rules.length) throw new Error(`${e.edition}: no rules`);
      if (new Set(e.rules.map(r => r?.id)).size !== e.rules.length || e.rules.some(r => typeof r?.id !== 'string' || !r.id)) throw new Error(`${e.edition}: rule ids must be unique strings`);
      const rules = e.rules.map(r => {
        const extra = Object.keys(r.when ?? {}).find(k => !inputs.includes(k));
        if (extra) throw new Error(`${e.edition}/${r.id}: when names unknown input ${extra}`);
        const got = Object.keys(r.then ?? {});
        if (got.length !== names.length || names.some(n => !got.includes(n))) throw new Error(`${e.edition}/${r.id}: then must give exactly ${names.join(', ')}`);
        for (const o of outs) {
          const v = r.then[o.name];
          if (!scalar(v)) throw new Error(`${e.edition}/${r.id}: ${o.name} must be a literal scalar`);
          if (o.values && !o.values.includes(v)) throw new Error(`${e.edition}/${r.id}: ${o.name} ${JSON.stringify(v)} is not in its values list`);
          if (S.AGGREGATION === 'SUM' && typeof v !== 'number') throw new Error(`${e.edition}/${r.id}: SUM needs numbers`);
        }
        let tests;
        try { tests = Object.fromEntries(inputs.map(k => [k, parseTest(r.when?.[k])])); } catch (err) { throw new Error(`${e.edition}/${r.id}: ${err.message}`); }
        return { id: r.id, tests, then: r.then };
      });
      if (['MIN', 'MAX'].includes(S.AGGREGATION) && new Set(rules.map(r => typeof r.then[names[0]])).size > 1) throw new Error(`${e.edition}: MIN / MAX need outputs of one type`);
      return { edition: e.edition, effectiveFrom: e.effectiveFrom, effectiveTo: e.effectiveTo ?? null, rules };
    });
  };
  let table = null, why = null;
  try { table = compile(); } catch (err) { why = String(err.message); }
  flow.invariant('table-well-formed', table !== null, { why });

  // ---- one item ----
  const resultOf = r => Object.fromEntries(names.map(n => [n, r.then[n]]));
  const rank = r => outs.map(o => (o.values ? o.values.indexOf(r.then[o.name]) : 0));
  const byPriority = (a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]; return 0; };
  const decide = it => {
    const asOf = S.AS_OF(it);
    flow.guard('as-of-date', validDate(asOf), { id: it.id, asOf: asOf ?? null });
    const ed = table.find(e => e.effectiveFrom <= asOf && (e.effectiveTo === null || asOf < e.effectiveTo));
    flow.guard('edition-in-force', ed != null, { id: it.id, asOf, editions: table.map(e => [e.edition, e.effectiveFrom, e.effectiveTo]) });
    const v = {};
    for (const k of inputs) {
      v[k] = S.INPUTS[k](it);
      flow.guard('input-present', v[k] !== undefined, { id: it.id, input: k });
      flow.guard('input-type', scalar(v[k]), { id: it.id, input: k, value: String(v[k]) });
    }
    const mismatches = [];
    const hits = ed.rules.filter(r => {
      let all = true;
      for (const k of inputs) if (!cell(r.tests[k], v[k], t => mismatches.push({ rule: r.id, input: k, expects: t, value: v[k] }))) all = false;
      return all;
    });
    flow.guard('input-type', !mismatches.length, { id: it.id, mismatches: mismatches.slice(0, 5) });
    if (!hits.length) {
      flow.guard('table-complete', S.ON_NO_MATCH !== 'deopt', { id: it.id, asOf, edition: ed.edition });
      return { id: it.id, edition: ed.edition, rules: [], result: null };
    }
    const P = S.HIT_POLICY;
    if (P === 'UNIQUE') flow.guard('hit-policy', hits.length === 1, { id: it.id, policy: P, rules: hits.map(r => r.id) });
    if (P === 'ANY') flow.guard('hit-policy', new Set(hits.map(r => JSON.stringify(resultOf(r)))).size === 1, { id: it.id, policy: P, rules: hits.map(r => r.id) });
    if (P === 'UNIQUE' || P === 'FIRST') return { id: it.id, edition: ed.edition, rules: [hits[0].id], result: resultOf(hits[0]) };
    if (P === 'ANY') return { id: it.id, edition: ed.edition, rules: hits.map(r => r.id), result: resultOf(hits[0]) };
    if (P === 'PRIORITY') { const w = [...hits].sort(byPriority)[0]; return { id: it.id, edition: ed.edition, rules: [w.id], result: resultOf(w) }; }
    const listed = P === 'OUTPUT_ORDER' ? [...hits].sort(byPriority) : hits;   // RULE_ORDER and COLLECT keep rule order
    if (S.AGGREGATION === 'none') return { id: it.id, edition: ed.edition, rules: listed.map(r => r.id), result: listed.map(resultOf) };
    const n = names[0], vals0 = hits.map(r => r.then[n]);
    const vals = S.DISTINCT ? vals0.filter((y, i) => vals0.findIndex(z => JSON.stringify(z) === JSON.stringify(y)) === i) : vals0;
    const agg = S.AGGREGATION === 'SUM' ? vals.reduce((a, b) => a + b, 0) : S.AGGREGATION === 'COUNT' ? vals.length
      : vals.reduce((a, b) => (S.AGGREGATION === 'MIN' ? (lt(b, a) ? b : a) : (lt(a, b) ? b : a)));
    return { id: it.id, edition: ed.edition, rules: hits.map(r => r.id), result: { [n]: agg } };
  };
  const decisions = items.map(decide);
  flow.invariant('one-decision-per-item', decisions.length === items.length && decisions.every((d, i) => d.id === items[i].id), { decisions: decisions.length, items: items.length });
  if (S.AGGREGATION === 'SUM') flow.invariant('sum-finite', decisions.every(d => d.result === null || Number.isFinite(d.result[names[0]])), {});
  flow.note('editions', countBy(decisions, d => d.edition));
  const noMatch = decisions.filter(d => d.result === null).map(d => d.id);
  if (noMatch.length) flow.note('no-match', { n: noMatch.length });
  return { decisions, noMatch };
}
