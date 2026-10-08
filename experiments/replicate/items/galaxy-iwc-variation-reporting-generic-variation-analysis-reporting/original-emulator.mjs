// "Original" control: executes the ORIGINAL workflow definition (fixtures/original/*.ga, 35 steps) step by step.
//
// What is real and what is not:
//  * real   : the step graph, every parameter, regex, column list, expression and sort key is read from the
//             .ga at run time. Nothing about the report logic is hard-coded here.
//  * emulated: the Galaxy tool-shed tools themselves (SnpSift 4.3, datamash, text_processing, column_maker,
//             collapse_collections) are re-implemented below from their documented behaviour, because
//             Galaxy, SnpSift and datamash are not installed in this container (see README, "Original control").
//             Tool behaviour that the shipped outputs confirm is marked [confirmed]; behaviour inferred from the
//             tool wrappers is marked [inferred] and is listed in README "Unverified semantics".
// So this is a labelled reference re-implementation structured like the original, NOT a Galaxy run.
import { readFileSync } from 'node:fs';
import { pyFloat, javaFloat, g14, galaxySanitize } from './formats.mjs';
import { compileSnpSift, compilePython } from './miniexpr.mjs';
import { parseVcf } from './reference.mjs';

export const GA_PATH = new URL('./fixtures/original/Generic-variation-analysis-reporting.ga', import.meta.url);
export const loadGa = () => JSON.parse(readFileSync(GA_PATH, 'utf8'));

const bytewise = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lines = text => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
const unlines = ls => (ls.length ? ls.join('\n') + '\n' : '');
const truthy = v => v === true || v === 'true';
const data = text => ({ t: 'data', text });

// ---- tool emulators; each returns a dataset text for its single output ----------------------------

// SnpSift Filter 4.3 [confirmed for "entries" and "--addFilter" by the VCF ##SnpSiftCmd lines and shipped FILTER values]
function snpSiftFilter({ state, text, conn }) {
  const mode = state.filtering.mode;
  const exprSrc = conn['filter_expression|expr'] ?? state.filter_expression.expr;
  const expr = compileSnpSift(exprSrc);
  const out = [];
  for (const line of lines(text)) {
    if (line.startsWith('#')) { out.push(line); continue; }
    const f = line.split('\t');
    const rec = parseVcf(line)[0];
    const hit = expr(rec);
    if (mode === 'entries') { if (hit !== truthy(state.inverse)) out.push(line); continue; }
    if (mode === 'add_filter') {
      if (hit) { const label = galaxySanitize(conn['filtering|add_filter'] ?? state.filtering.add_filter); f[6] = ['PASS', '.', ''].includes(f[6]) ? label : `${f[6]};${label}`; } // [confirmed: doubled labels in shipped tables]
      out.push(f.join('\t')); continue;
    }
    throw new Error(`snpSift_filter mode ${mode} is not emulated`);
  }
  return unlines(out);
}

// SnpSift Extract Fields 4.3 with one_effect_per_line (vcfEffOnePerLine.pl in front) [confirmed for single-effect records]
function snpSiftExtractFields({ state, text }) {
  const types = new Map();
  for (const l of lines(text)) { const m = /^##INFO=<ID=([^,]+),.*?Type=(\w+)/.exec(l); if (m) types.set(m[1], m[2]); }
  const cols = state.extract.split(/\s+/).filter(Boolean), empty = state.empty_text;
  const out = [cols.join('\t')];
  const effField = { IMPACT: 0, FUNCLASS: 1, CODON: 2, AA: 3, GENE: 5, TRID: 8 };
  for (const rec of parseVcf(text)) {
    const effs = [];
    const eff = rec.info.get('EFF');
    if (eff) { let depth = 0, start = 0; for (let i = 0; i <= eff.length; i++) { const c = eff[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (i === eff.length || (c === ',' && depth === 0)) { effs.push(eff.slice(start, i)); start = i + 1; } } }
    const rows = truthy(state.one_effect_per_line) && effs.length ? effs : [effs[0] ?? null];
    for (const e of rows) {
      out.push(cols.map(c => {
        let v;
        if (c === 'CHROM') v = rec.chrom; else if (c === 'POS') v = rec.pos; else if (c === 'FILTER') v = rec.filter; else if (c === 'REF') v = rec.ref; else if (c === 'ALT') v = rec.alt;
        else if (c.startsWith('EFF[*].')) {
          const k = c.slice(7);
          if (e === null) v = '';
          else if (k === 'EFFECT') v = e.slice(0, e.indexOf('('));
          else v = e.slice(e.indexOf('(') + 1, e.lastIndexOf(')')).split('|')[effField[k]] ?? '';
          if (k === 'FUNCLASS' && e !== null && v === '') v = 'NONE'; // [confirmed]
        } else {
          const m = /^(\w+)(?:\[(\d+)\])?$/.exec(c);
          const raw = rec.info.get(m[1]);
          if (raw === undefined) v = '';
          else if (m[2] !== undefined) v = raw.split(',')[Number(m[2])];
          else v = types.get(m[1]) === 'Float' ? javaFloat(Number(raw)) : raw; // [confirmed: 1.000000 prints as 1.0]
        }
        return v === '' ? empty : v;
      }).join('\t'));
    }
  }
  return unlines(out);
}

// Column typing as Galaxy's tabular metadata does it: int, float or str per column over the data lines.
function typedColumns(rows) {
  const n = Math.max(0, ...rows.map(r => r.length)), kinds = [];
  for (let c = 0; c < n; c++) {
    const vals = rows.map(r => r[c] ?? '');
    kinds.push(vals.every(v => /^[+-]?\d+$/.test(v)) ? 'int' : vals.every(v => v !== '' && !Number.isNaN(Number(v))) ? 'float' : 'str');
  }
  return r => Object.fromEntries(r.map((v, c) => [`c${c + 1}`, kinds[c] === 'int' ? BigInt(v) : kinds[c] === 'float' ? Number(v) : v]));
}

// Compute 1.6 (column_maker)
function columnMaker({ state, text }) {
  const [head, ...body] = lines(text);
  const rows = body.map(l => l.split('\t')), typed = typedColumns(rows), py = compilePython(state.cond);
  const hdr = state.header_lines_conditional;
  const out = [];
  if (hdr.header_lines_select === 'yes') out.push(`${head}\t${hdr.header_new_column_name}`); else rows.unshift(head.split('\t'));
  for (const r of rows) out.push(`${r.join('\t')}\t${py.str(py.eval(typed(r)))}`);
  return unlines(out);
}

// Datamash 1.x [confirmed: GroupBy(...) / op(...) header names are cleaned by steps 12 and 31]
function datamash({ state, text }) {
  const group = state.grouping.split(',').map(x => Number(x) - 1), ops = state.operations.map(o => ({ op: o.op_name, col: Number(o.op_column) - 1 }));
  let ls = lines(text), names = null;
  if (truthy(state.header_in)) names = ls.shift().split('\t');
  let rows = ls.map(l => l.split('\t'));
  if (truthy(state.need_sort)) { // datamash -s: sort on the grouping columns (C locale), stable
    rows = rows.map((r, i) => [r, i]).sort((a, b) => { for (const g of group) { const c = bytewise(a[0][g], b[0][g]); if (c) return c; } return a[1] - b[1]; }).map(x => x[0]);
  }
  const groups = [];
  for (const r of rows) {
    const key = group.map(g => r[g]).join('\u0000'), last = groups.at(-1);
    if (last && last.key === key) last.rows.push(r); else groups.push({ key, rows: [r] });
  }
  const apply = (op, vals) => {
    switch (op) {
      case 'collapse': return vals.join(',');
      case 'countunique': return String(new Set(vals).size);
      case 'unique': return [...new Set(vals)].sort(bytewise).join(',');
      case 'min': return g14(Math.min(...vals.map(Number)));
      case 'max': return g14(Math.max(...vals.map(Number)));
      default: throw new Error(`datamash op ${op} is not emulated`);
    }
  };
  const full = truthy(state.print_full_line);
  const out = groups.map(g => [...(full ? g.rows[0] : group.map(c => g.rows[0][c])), ...ops.map(o => apply(o.op, g.rows.map(r => r[o.col])))].join('\t'));
  if (truthy(state.header_out)) {
    const head = [...(full ? names : group.map(c => `GroupBy(${names[c]})`)), ...ops.map(o => `${o.op}(${names[o.col]})`)];
    out.unshift(head.join('\t'));
  }
  return unlines(out);
}

// Replace 1.1.3 (text_processing find_and_replace): Perl-style s///, JS regex is equivalent for the patterns used
function findAndReplace({ state, text }) {
  const perlRepl = s => s.replace(/\\(.)/g, (_, c) => (c === 't' ? '\t' : c === 'n' ? '\n' : c));
  const ls = lines(text);
  const out = ls.map((l, i) => {
    if (i === 0 && truthy(state.skip_first_line)) return l;
    if (!truthy(state.is_regex)) {
      if (state.wholewords === 'true' || state.searchwhere.searchwhere_select !== 'line') throw new Error('find_and_replace option not emulated');
      return truthy(state.global) ? l.split(state.find_pattern).join(state.replace_pattern) : l.replace(state.find_pattern, () => state.replace_pattern);
    }
    const re = new RegExp(state.find_pattern, (truthy(state.global) ? 'g' : '') + (truthy(state.caseinsensitive) ? 'i' : ''));
    return l.replace(re, perlRepl(state.replace_pattern));
  });
  return unlines(out);
}

// Collapse Collection 5.1.0 [confirmed: name column "Sample" first, one header]
function collapseDataset({ state, coll }) {
  if (state.filename.add_name !== 'true' || state.filename.place_name !== 'same_multiple') throw new Error('collapse_dataset option not emulated');
  const out = [];
  coll.elements.forEach((el, k) => {
    const ls = lines(el.v.text);
    if (truthy(state.one_header)) { if (k === 0) out.push(`Sample\t${ls[0]}`); ls.shift(); }
    for (const l of ls) out.push(`${el.id}\t${l}`);
  });
  return unlines(out);
}

// Filter 1.1.1
function filter1({ state, text }) {
  const ls = lines(text), hl = Number(state.header_lines), py = compilePython(state.cond);
  const rows = ls.slice(hl).map(l => l.split('\t')), typed = typedColumns(rows);
  return unlines([...ls.slice(0, hl), ...rows.filter(r => py.eval(typed(r))).map(r => r.join('\t'))]);
}

// Join 1.1.2 (text_processing easyjoin): inner join, output = key, rest of file 1, rest of file 2
function easyJoin({ state, text1, text2 }) {
  if (state.jointype !== ' ') throw new Error(`easyjoin jointype "${state.jointype}" is not emulated (only the default inner join)`);
  const k1 = Number(state.column1) - 1, k2 = Number(state.column2) - 1;
  const [h1, ...r1] = lines(text1), [h2, ...r2] = lines(text2);
  const join = (a, b) => [a[k1], ...a.filter((_, i) => i !== k1), ...b.filter((_, i) => i !== k2)].join('\t');
  const idx = new Map();
  for (const l of r2) { const f = l.split('\t'); if (!idx.has(f[k2])) idx.set(f[k2], []); idx.get(f[k2]).push(f); }
  const rows = [];
  for (const l of r1) { const f = l.split('\t'); for (const g of idx.get(f[k1]) ?? []) rows.push(join(f, g)); }
  rows.sort((a, b) => bytewise(a.split('\t')[0], b.split('\t')[0])); // join emits in key order; steps 25/29 re-sort anyway
  return unlines([join(h1.split('\t'), h2.split('\t')), ...rows]);
}

// Cut 1.0.2
function cut1({ state, text }) {
  const cols = state.columnList.split(',').map(c => Number(c.slice(1)) - 1);
  return unlines(lines(text).map(l => { const f = l.split('\t'); return cols.map(c => f[c]).join('\t'); }));
}

// Sort 1.1.1 (text_processing sort with header): GNU sort keys, last-resort whole-line comparison
function sortWithHeader({ state, text }) {
  const hl = Number(state.header), ls = lines(text);
  const keys = state.sortkeys.map(k => ({ col: Number(k.column) - 1, num: k.style === 'n' || k.style === 'g', rev: k.order === 'r' }));
  const rows = ls.slice(hl);
  rows.sort((a, b) => {
    const fa = a.split('\t'), fb = b.split('\t');
    for (const k of keys) { const c = k.num ? Number(fa[k.col]) - Number(fb[k.col]) : bytewise(fa[k.col], fb[k.col]); if (c) return k.rev ? -c : c; }
    return bytewise(a, b);
  });
  return unlines([...ls.slice(0, hl), ...rows]);
}

// Split file 0.5.0 by column value into a collection (the plotting input; not one of the tested outputs)
function splitFile({ state, text }) {
  const sp = state.split_parms;
  if (sp.split_by.select_split_by !== 'col') throw new Error('split_file_to_collection mode not emulated');
  const top = Number(sp.top), col = Number(sp.split_by.id_col) - 1, ls = lines(text), head = ls.slice(0, top), groups = new Map();
  for (const l of ls.slice(top)) { const k = l.split('\t')[col]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  return { t: 'coll', elements: [...groups].map(([id, rows]) => ({ id, v: data(unlines([...head, ...rows])) })) };
}

const TOOLS = {
  snpSift_filter: ctx => data(snpSiftFilter(ctx)),
  snpSift_extractFields: ctx => data(snpSiftExtractFields(ctx)),
  Add_a_column1: ctx => data(columnMaker(ctx)),
  datamash_ops: ctx => data(datamash(ctx)),
  tp_find_and_replace: ctx => data(findAndReplace(ctx)),
  Filter1: ctx => data(filter1(ctx)),
  Cut1: ctx => data(cut1(ctx)),
  tp_sort_header_tool: ctx => data(sortWithHeader(ctx)),
  tp_easyjoin_tool: ctx => data(easyJoin(ctx)),
  split_file_to_collection: ctx => splitFile(ctx),
};
// Which connected input holds the dataset(s) for each tool (the others are parameters).
const DATA_INPUT = { snpSift_filter: 'input', snpSift_extractFields: 'input', Add_a_column1: 'input', datamash_ops: 'in_file', tp_find_and_replace: 'infile',
  Filter1: 'input', Cut1: 'input', tp_sort_header_tool: 'infile', split_file_to_collection: 'split_parms|input' };

const shortId = id => (id.includes('/repos/') ? id.split('/').slice(-2, -1)[0] : id);

function paramText(c) {
  if (c.select_param_type === 'text') return c.component_value;
  if (c.select_param_type === 'float') return pyFloat(Number(c.component_value));
  if (c.select_param_type === 'integer') return String(c.component_value);
  throw new Error(`compose_text_param type ${c.select_param_type}`);
}

// Run the whole workflow. job = { params: {af, dp, dp_alt}, samples: [{id, vcf}] }.
export function runOriginalWorkflow(job, ga = loadGa()) {
  const values = new Map(); // `${stepId}:${outputName}` -> { t:'data'|'coll'|'param' }
  const byLabel = { 'AF Filter': job.params.af, 'DP Filter': job.params.dp, 'DP_ALT Filter': job.params.dp_alt };
  const steps = Object.values(ga.steps).sort((a, b) => a.id - b.id);
  const wfOut = {};
  for (const s of steps) {
    if (s.type === 'data_collection_input') {
      values.set(`${s.id}:output`, { t: 'coll', elements: job.samples.map(x => ({ id: x.id, v: data(x.vcf) })) });
    } else if (s.type === 'parameter_input') {
      if (!(s.label in byLabel)) throw new Error(`unexpected workflow parameter ${s.label}`);
      values.set(`${s.id}:output`, { t: 'param', value: byLabel[s.label] });
    } else if (s.type === 'tool') {
      const id = shortId(s.tool_id), state = JSON.parse(s.tool_state);
      const conn = Object.fromEntries(Object.entries(s.input_connections).map(([k, c]) => {
        const src = values.get(`${c.id}:${c.output_name}`);
        if (!src) throw new Error(`step ${s.id}: unresolved input ${k}`);
        return [k, src];
      }));
      let result;
      if (id === 'compose_text_param') {
        const text = state.components.map((c, i) => {
          const key = `components_${i}|param_type|component_value`;
          return paramText(conn[key] ? { ...c.param_type, component_value: conn[key].value } : c.param_type);
        }).join('');
        result = { t: 'param', value: text };
      } else if (id === 'collapse_dataset') {
        result = data(collapseDataset({ state, coll: conn.input_list }));
      } else if (id === 'tp_easyjoin_tool') {
        result = data(easyJoin({ state, text1: conn.infile1.text, text2: conn.infile2.text }));
      } else if (TOOLS[id]) {
        const params = Object.fromEntries(Object.entries(conn).filter(([k, v]) => v.t === 'param').map(([k, v]) => [k, v.value]));
        const input = conn[DATA_INPUT[id]];
        const run = text => TOOLS[id]({ state, text, conn: params });
        if (input.t === 'coll') { // map the tool over the collection elements, producing a collection
          const mapped = input.elements.map(el => ({ id: el.id, v: run(el.v.text) }));
          result = { t: 'coll', elements: mapped };
        } else result = run(input.text);
      } else throw new Error(`step ${s.id}: tool ${s.tool_id} has no emulator`);
      values.set(`${s.id}:${s.outputs[0].name}`, result);
    } else throw new Error(`step ${s.id}: type ${s.type} not emulated`);
    for (const o of s.workflow_outputs ?? []) if (o.label) wfOut[o.label] = values.get(`${s.id}:${o.output_name}`);
  }
  const text = k => wfOut[k].text;
  return {
    af_recalculated: Object.fromEntries(wfOut.af_recalculated.elements.map(e => [e.id, e.v.text])),
    all_variants_all_samples: text('all_variants_all_samples'),
    by_variant_report: text('by_variant_report'),
    combined_variant_report: text('combined_variant_report'),
    _all: wfOut,
  };
}
