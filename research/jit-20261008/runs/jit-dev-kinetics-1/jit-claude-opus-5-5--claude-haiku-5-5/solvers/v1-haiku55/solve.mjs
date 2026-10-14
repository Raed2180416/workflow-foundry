// solve.mjs: initial-rate enzyme kinetics under SOP-XX-NN (exclusions, corrections, dilution rescale, MM fits).
// Procedure in code: number/unit parsing, unit conversion, temperature rule, dilution rescale, fitting, assembly.
// Prose decisions (which notes count, corrections, dilutions in logs) go to judges; every quote they give must occur in the documents.
import { createFlow } from './tools/flow.mjs';

const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const { study, documents: docs } = task.inputs;
const CONDS = study.conditions;
const IDS = CONDS.map(c => c.condition_id);

// ---------- guards: the shape of input and SOP this solver was compiled for
flow.guard('conditions-shape', Array.isArray(CONDS) && CONDS.length > 0 && CONDS.every(c =>
  /^C\d+$/.test(c.condition_id) && typeof c.pH === 'number' && typeof c.temperature_C === 'number' &&
  (c.inhibitor === null || typeof c.inhibitor?.name === 'string')), { n: CONDS.length });
const pm = /^([A-Z]+)-N{4}\b/.exec(study.sample_id_pattern ?? '');
flow.guard('sample-id-pattern', !!pm, { pattern: study.sample_id_pattern });
const PREFIX = pm[1];
const ID_RE = new RegExp(`^${PREFIX}-\\d{4}$`);
const ID_FIND = new RegExp(`\\b${PREFIX}-\\d{4}\\b`, 'g');

const sopDocs = docs.filter(d => d.kind === 'sop');
flow.guard('one-sop', sopDocs.length === 1, { n: sopDocs.length, titles: docs.map(d => d.title) });
const SOP = sopDocs[0].text;
const TEMP_TOL = Number(/more than ([\d.]+) ?°C/.exec(SOP)?.[1]);
const STD_DIL = Number(/working dilution is 1:(\d+)/.exec(SOP)?.[1]);
flow.guard('sop-rules-known', Number.isFinite(TEMP_TOL) && STD_DIL > 0 &&
  SOP.includes('(SAT, OVR)') && SOP.includes('bubble') && SOP.includes('Lineweaver-Burk') &&
  SOP.includes('v = Vmax·[S]/(Km + [S])') && SOP.includes(`(dilution used ÷ ${STD_DIL})`) &&
  /fix Vmax to the value fitted/.test(SOP), { TEMP_TOL, STD_DIL });

// ---------- unit tables (code does the arithmetic; judges only name the unit)
const S_FACTOR = { M: 1e6, mM: 1e3, uM: 1, nM: 1e-3 };                // to µM
const RATE_FACTOR = {                                                  // to µM/s
  'uM/s': 1, 'umol/L/s': 1, 'mM/s': 1e3, 'mmol/L/s': 1e3, 'nM/s': 1e-3, 'nmol/L/s': 1e-3,
  'uM/min': 1 / 60, 'umol/L/min': 1 / 60, 'nM/min': 1e-3 / 60, 'nmol/L/min': 1e-3 / 60,
  'mAU/min': null,                                                     // needs the document's own conversion factor
};
const RATE_UNITS = Object.keys(RATE_FACTOR);

// Verbatim numbers as written: "4000", "8×10^-3", "1.5E+05", "2.528e3", "0.0195", "−" minus signs.
function num(raw) {
  const s = String(raw).replace(/\s+/g, '').replace(/[×x*]10\^?/i, 'e').replace(/−/g, '-').replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const norm = s => String(s).normalize('NFC').replace(/\s+/g, ' ').trim();
const docText = norm(docs.map(d => d.text).join('\n'));
const inDocs = q => docText.includes(norm(q));
const inDoc = (d, q) => norm(d.text).includes(norm(q));
const sampleIdsIn = text => new Set(text.match(ID_FIND) ?? []);

// ---------- step 1: extract study-well rows per document (judge; numbers are kept verbatim and checked)
const EXTRACT = {
  type: 'object', additionalProperties: false, required: ['observations'],
  properties: {
    observations: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['sample_id', 's_raw', 's_unit', 'rate_raw', 'rate_unit', 'temp_raw', 'temp_unit', 'cond_label', 'cond_pH', 'cond_temp_C', 'cond_inhibitor', 'flag'],
      properties: {
        sample_id: { type: 'string' },
        s_raw: { type: 'string', description: 'substrate number as written, "" if this document does not give it' },
        s_unit: { type: 'string', enum: ['M', 'mM', 'uM', 'nM', ''], description: '"" if the unit is not stated in this document' },
        rate_raw: { type: 'string' }, rate_unit: { type: 'string', enum: [...RATE_UNITS, ''], description: '"" if the unit is not stated in this document' },
        temp_raw: { type: 'string' }, temp_unit: { type: 'string', enum: ['C', 'K', ''] },
        cond_label: { type: 'string' }, cond_pH: { type: 'string' }, cond_temp_C: { type: 'string' }, cond_inhibitor: { type: 'string' },
        flag: { type: 'string', enum: ['', 'SAT', 'OVR', 'LOW', 'OTHER'] },
      } } },
  },
};
const EXTRACT_SYSTEM = 'You copy measurement rows out of one lab document into JSON. Copy every number and string exactly as written in the document (verbatim substrings). Do not convert or compute anything.';
const extractPrompt = d => `Document id ${d.doc_id} | title: ${d.title} | kind: ${d.kind} | date: ${d.date}

Task: list every measured well of this document whose id matches ${PREFIX}-NNNN (four digits). Ignore BLK-, STD-, PLT- ids and ignore standard curves.
For each well output one observation:
- sample_id: the id as written.
- s_raw: the substrate concentration number exactly as written in the document; s_unit: M, mM, uM or nM, from the row or the column header or the section title (the unit that applies to this number). If this document does not state the substrate concentration for the well (e.g. an instrument export with only rates), use "" for s_raw and s_unit.
- rate_raw: the rate/slope number exactly as written; rate_unit: the unit of that number from the header, column name or row, one of: ${RATE_UNITS.join(', ')}. Use "nM/min" for "nM min⁻¹" and "nmol/L/s" for nanomolar-per-second text. If the document says the rate column's unit is different from its header, use the unit the document says is correct.
- temp_raw / temp_unit: the block or well temperature logged for this well, if any (unit C or K); else "".
- cond_label: the condition label written for this well's section or row ("" if none). cond_pH, cond_temp_C, cond_inhibitor: the pH, setpoint temperature (°C) and inhibitor name written for that section ("" if not written).
- flag: SAT, OVR, LOW or OTHER if the reader flagged this well (in a Flag column or the reader log), else "".

<document>
${d.text}
</document>`;

const docObs = await flow.map(docs.map((d, i) => ({ d, i })), async ({ d, i }) => {
  const r = await flow.judge(`extract-${d.doc_id}`, {
    tiers: ['claude-haiku-5-5', 'claude-opus-5-5'], system: EXTRACT_SYSTEM, prompt: extractPrompt(d), schema: EXTRACT,
    check: v => {
      const seen = new Set();
      for (const o of v.observations) {
        if (!ID_RE.test(o.sample_id)) return `bad id ${o.sample_id}`;
        if (!inDoc(d, o.sample_id)) return `id not in doc ${o.sample_id}`;
        if (seen.has(o.sample_id)) return `duplicate id in doc ${o.sample_id}`;
        seen.add(o.sample_id);
        if (!o.rate_raw || !inDoc(d, o.rate_raw)) return `rate not verbatim ${o.sample_id}`;
        if (!Number.isFinite(num(o.rate_raw))) return `rate not numeric ${o.sample_id}`;
        if (o.s_raw && (!inDoc(d, o.s_raw) || !Number.isFinite(num(o.s_raw)))) return `s not verbatim ${o.sample_id}`;
        if (!o.s_raw && o.s_unit) return `unit without s ${o.sample_id}`;
        if (o.temp_raw && (!inDoc(d, o.temp_raw) || !o.temp_unit)) return `temp not verbatim ${o.sample_id}`;
      }
      return null;
    },
  });
  return { doc: { ...d, order: i }, ...r };
}, { concurrency: 4, name: 'extract' });

const observations = [];
for (const { doc, observations: rows } of docObs) {
  // Header conversion for absorbance slopes, e.g. "1 mAU/min corresponds to 0.3092 µM/min of NADH" (code reads the number).
  const mau = /1 mAU\/min[^\n]{0,80}?([\d.]+)\s*(?:µM|uM)\/min/.exec(doc.text);
  const mauFactor = mau ? Number(mau[1]) : null;
  for (const o of rows) observations.push({ ...o, docId: doc.doc_id, docKind: doc.kind, docDate: doc.date, order: doc.order, mauFactor });
}
flow.note('extracted', { docs: docObs.length, observations: observations.length });
flow.guard('observations-found', observations.length > 0, { docs: docs.length });

// ---------- step 2: per-condition master-mix dilution (judge; the default is the SOP standard)
const DIL = {
  type: 'object', additionalProperties: false, required: ['dilutions'],
  properties: { dilutions: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['condition_id', 'dilution_denominator', 'quote'],
    properties: { condition_id: { type: 'string', enum: IDS }, dilution_denominator: { type: 'string' }, quote: { type: 'string' } } } } },
};
const dilPrompt = `The SOP says: the standard enzyme working dilution is 1:${STD_DIL}; a condition whose wells got the enzyme at another dilution must be rescaled.
Decide, for EACH condition below, the enzyme dilution that the wells of that condition actually received, as the denominator of 1:N (e.g. "1000" for 1:1000).
Use the master-mix log and any later correction by the person who made the entry. Notes from others count only if the entry's author confirms them; a withdrawn correction does not count; an unused or discarded mix does not matter. If the record does not say otherwise, use "${STD_DIL}".
For each condition give the verbatim quote from the documents that decides it ("" only if the answer is ${STD_DIL} with no record of another dilution).
Conditions (condition_id: pH, temperature_C, inhibitor):
${CONDS.map(c => `${c.condition_id}: pH ${c.pH}, ${c.temperature_C} °C, inhibitor ${c.inhibitor ? c.inhibitor.name + ' ' + c.inhibitor.concentration_uM + ' uM' : 'none (DMSO vehicle)'}`).join('\n')}

Documents:
${docs.map(d => `=== ${d.doc_id} | ${d.title} | ${d.author} | ${d.kind} | ${d.date}\n${d.text}`).join('\n\n')}`;
const dil = await flow.judge('dilutions', {
  tiers: ['claude-haiku-5-5', 'claude-opus-5-5'], system: 'You read lab records and report one enzyme dilution per condition. Quotes must be verbatim.',
  prompt: dilPrompt, schema: DIL,
  check: v => {
    if (v.dilutions.length !== IDS.length || new Set(v.dilutions.map(x => x.condition_id)).size !== IDS.length) return 'need one entry per condition';
    for (const x of v.dilutions) {
      if (!(Number(x.dilution_denominator) > 0)) return `bad denominator ${x.dilution_denominator}`;
      if (x.quote && !inDocs(x.quote)) return `quote not verbatim ${x.condition_id}`;
      if (!x.quote && Number(x.dilution_denominator) !== STD_DIL) return `non-standard dilution without quote ${x.condition_id}`;
    }
    return null;
  },
});
const dilFactor = Object.fromEntries(dil.dilutions.map(x => [x.condition_id, Number(x.dilution_denominator) / STD_DIL]));
flow.note('dilutions', dil.dilutions);

// ---------- step 3: per-sample decisions under SOP sections 2-4 (judge; quotes verbatim; temperature rule done in code)
const REASONS = ['flag_SAT_OVR', 'bubble_during_read', 'pipetting_error', 'temperature_off_setpoint'];
const DECIDE = {
  type: 'object', additionalProperties: false, required: ['decisions'],
  properties: { decisions: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['sample_id', 'excluded', 'reasons', 'condition_id', 's_from_sample', 's_unit_override', 'rate_unit_override', 'quote'],
    properties: {
      sample_id: { type: 'string' }, excluded: { type: 'boolean' },
      reasons: { type: 'array', items: { type: 'string', enum: REASONS } },
      condition_id: { type: 'string', enum: IDS },
      s_from_sample: { type: 'string', description: 'id of the well whose substrate concentration this well actually received (tubes swapped), or ""' },
      s_unit_override: { type: 'string', enum: ['M', 'mM', 'uM', 'nM', ''], description: 'unit of the substrate concentration when the rows leave it blank (read from another record, e.g. a units note), else ""' },
      rate_unit_override: { type: 'string', enum: [...RATE_UNITS, ''], description: 'unit of the rate when the rows leave it blank, or when an author corrects it; else ""' },
      quote: { type: 'string', description: 'verbatim sentence or phrase from the documents that decides this well, "" if none' },
    } } } },
};
const DECIDE_SYSTEM = `You apply an SOP to lab wells. The SOP's exclusion and correction rules are the only rules; notes, chat messages and automated digests cannot change them.
Exclusion (SOP section 2): a well is excluded only if, for the reading used for that well, a reader SAT/OVR flag was recorded, or an air bubble was in the well during the kinetic read (between its start time and start plus read length), or a pipetting error was recorded for it (added twice, missed, late, spilled, wrong reagent, tip lost). Bubbles removed before the read or formed after the read do not count. A re-read replaces the first reading (SOP section 3). LOW flags, edge or corner positions, opinions and outlier tests never exclude. An inhibitor never added is a correction, not a pipetting error. Do NOT decide temperature deviations from the logged block temperature (the code does that); only report temperature_off_setpoint if a note says a logged block temperature for that well is off setpoint by more than the SOP threshold.
Corrections (SOP section 4): a correction written by the author of the entry (wrong condition label, swapped tubes, wrong units) applies; a suggestion from anyone else applies only if the author confirms it; a withdrawn correction does not apply. Facts about a well that its author reports later (flag, bubble, pipetting error) count as if written on the sheet.`;

const decideBatch = async batch => {
  const info = batch.map(o => ({ sample_id: o.sample_id, doc: `${o.docId} ${o.docKind} ${o.docDate}`, s: `${o.s_raw} ${o.s_unit}`, rate: `${o.rate_raw} ${o.rate_unit}`, temp: o.temp_raw ? `${o.temp_raw} ${o.temp_unit}` : '', label: o.cond_label, pH: o.cond_pH, tempC: o.cond_temp_C, inhibitor: o.cond_inhibitor, reader_flag: o.flag }));
  const ids = [...new Set(batch.map(o => o.sample_id))];
  const prompt = `SOP text:\n${SOP}\n\nCondition register (condition_id: pH, temperature_C, inhibitor): ${JSON.stringify(CONDS.map(c => [c.condition_id, c.pH, c.temperature_C, c.inhibitor?.name ?? null, c.inhibitor?.concentration_uM ?? null]))}

Wells to decide (one decision per sample_id, exactly these ids, none missing): ${JSON.stringify(ids)}
Extracted data for these wells (as written in the documents): ${JSON.stringify(info)}

For each well decide: excluded (per section 2, for the reading used), reasons, condition_id (the condition the well belongs to after section 4 corrections), s_from_sample (only if tubes were swapped, else ""), rate_unit_override (only if an author's correction changes the unit of this well's rate, else ""), quote (verbatim text that decides it; required when excluded or corrected).

All documents:
${docs.map(d => `=== ${d.doc_id} | ${d.title} | ${d.author} | ${d.kind} | ${d.date}\n${d.text}`).join('\n\n')}`;
  const r = await flow.judge(`decide-${ids[0]}`, {
    tiers: ['claude-haiku-5-5', 'claude-opus-5-5'], system: DECIDE_SYSTEM, prompt, schema: DECIDE,
    check: v => {
      const got = v.decisions.map(d => d.sample_id);
      if (got.length !== ids.length || new Set(got).size !== ids.length || ids.some(i => !got.includes(i))) return 'decisions must cover each sample exactly once';
      for (const d of v.decisions) {
        if (d.excluded !== d.reasons.length > 0) return `excluded/reasons disagree ${d.sample_id}`;
        if ((d.excluded || d.reasons.length || d.rate_unit_override || d.s_from_sample) && !norm(d.quote)) return `correction or exclusion without quote ${d.sample_id}`;
        if (d.quote && !inDocs(d.quote)) return `quote not verbatim ${d.sample_id}`;
        if (d.s_from_sample && !ID_RE.test(d.s_from_sample)) return `bad s_from_sample ${d.sample_id}`;
        const rows = batch.filter(o => o.sample_id === d.sample_id);
        if (rows.some(o => !o.s_unit && o.s_raw) && !d.s_unit_override) return `s unit missing ${d.sample_id}`;
        if (rows.some(o => !o.rate_unit) && !d.rate_unit_override) return `rate unit missing ${d.sample_id}`;
      }
      return null;
    },
  });
  return r.decisions;
};

const allObsIds = [...new Set(observations.map(o => o.sample_id))];
const batches = [];
for (let i = 0; i < observations.length; i += 25) batches.push(observations.slice(i, i + 25));
const decided = (await flow.map(batches, decideBatch, { concurrency: 3, name: 'decide' })).flat();
const decision = new Map(decided.map(d => [d.sample_id, d]));
flow.guard('decisions-cover-wells', allObsIds.every(id => decision.has(id)), { missing: allObsIds.filter(id => !decision.has(id)) });

// ---------- step 4: assemble wells (code: reading choice, units, temperature rule, dilution rescale)
// Per well: the rate comes from the automatic raw export when it has one (SOP section 1), otherwise the last notebook row;
// the substrate concentration and logged temperature come from the last row that states them.
const byId = new Map();
for (const o of observations) byId.set(o.sample_id, [...(byId.get(o.sample_id) ?? []), o]);
const last = list => (list.length ? list.reduce((a, b) => (b.order >= a.order ? b : a)) : undefined);
const sources = new Map();
for (const [id, list] of byId) {
  const inst = list.filter(o => o.docKind === 'instrument');
  const rateObs = last(inst.length ? inst : list);
  const sObs = last(list.filter(o => o.s_raw));
  const tObs = last(list.filter(o => o.temp_raw));
  sources.set(id, { rateObs, sObs, tObs });
}
flow.note('sources', { wells: sources.size, duplicated: [...byId.values()].filter(l => l.length > 1).length });

const wells = new Map();
for (const [id, { rateObs: o, sObs, tObs }] of sources) {
  const d = decision.get(id);
  const cond = CONDS.find(c => c.condition_id === d.condition_id);
  flow.guard(`s-known-${id}`, !!sObs, { id });
  const sUnit = d.s_unit_override || sObs.s_unit;
  flow.guard(`s-unit-${id}`, sUnit in S_FACTOR, { id, sUnit });
  const sUnitVal = num(sObs.s_raw) * S_FACTOR[sUnit];
  const rateUnit = d.rate_unit_override || o.rate_unit;
  const factor = RATE_FACTOR[rateUnit] ?? (rateUnit === 'mAU/min' ? o.mauFactor / 60 : null);
  flow.guard(`rate-factor-${rateUnit}`, factor !== null && Number.isFinite(factor), { id, rateUnit, mau: o.mauFactor });
  wells.set(id, { id, cond: cond.condition_id, dec: d, obs: o, tObs, s: sUnitVal, rateRaw: num(o.rate_raw), factor, tempC: null });
}
// swapped tubes (SOP section 4): the substrate concentration is the one the other well actually received
const s0 = new Map([...wells].map(([id, w]) => [id, w.s]));
for (const w of wells.values()) {
  if (w.dec.s_from_sample) {
    flow.guard('swap-source-present', s0.has(w.dec.s_from_sample), { id: w.id, from: w.dec.s_from_sample });
    w.s = s0.get(w.dec.s_from_sample);
  }
}
// temperature rule (SOP 2.4): logged block temperature vs condition setpoint
for (const w of wells.values()) {
  const setpoint = CONDS.find(c => c.condition_id === w.cond).temperature_C;
  if (w.tObs) {
    const t = w.tObs.temp_unit === 'K' ? num(w.tObs.temp_raw) - 273.15 : num(w.tObs.temp_raw);
    w.tempC = t;
    if (Math.abs(t - setpoint) > TEMP_TOL) w.dec = { ...w.dec, excluded: true, reasons: [...new Set([...w.dec.reasons, 'temperature_off_setpoint'])] };
  }
}
for (const w of wells.values()) {
  w.rate = w.rateRaw * w.factor * (dilFactor[w.cond] ?? 1);
  w.dilution = dilFactor[w.cond] ?? 1;
}
const excluded = [...wells.values()].filter(w => w.dec.excluded).map(w => w.id).sort();
const kept = [...wells.values()].filter(w => !w.dec.excluded);
flow.invariant('wells-conserved', kept.length + excluded.length === wells.size, { kept: kept.length, excluded: excluded.length, wells: wells.size });
flow.invariant('no-kept-excluded-overlap', kept.every(w => !excluded.includes(w.id)), {});
flow.invariant('excluded-ids-valid', excluded.every(id => ID_RE.test(id)), {});

// ---------- step 5: Michaelis-Menten fits (unweighted NLS; inhibitor conditions use the shared Vmax of their matching control)
const fitMM = (pts, Vfixed) => {
  const S = pts.map(p => p.s), v = pts.map(p => p.rate);
  const sse = K => {
    const f = S.map(s => s / (K + s));
    const V = Vfixed ?? f.reduce((a, x, i) => a + x * v[i], 0) / f.reduce((a, x) => a + x * x, 0);
    return { V, e: f.reduce((a, x, i) => a + (v[i] - V * x) ** 2, 0) };
  };
  const lo = Math.log(Math.min(...S) * 1e-3), hi = Math.log(Math.max(...S) * 1e3), N = 4000;
  const grid = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N);
  let best = 0;
  grid.forEach((g, i) => { if (sse(Math.exp(g)).e < sse(Math.exp(grid[best])).e) best = i; });
  let a = grid[Math.max(0, best - 1)], b = grid[Math.min(N, best + 1)];
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 200; it++) {
    const c = b - gr * (b - a), d = a + gr * (b - a);
    if (sse(Math.exp(c)).e < sse(Math.exp(d)).e) b = d; else a = c;
  }
  const K = Math.exp((a + b) / 2);
  return { vmax: sse(K).V, km: K };
};
const out = [];
const fits = new Map();
const groups = IDS.map(id => [id, kept.filter(w => w.cond === id)]);
for (const [id, pts] of groups) {
  const c = CONDS.find(x => x.condition_id === id);
  if (c.inhibitor) continue;
  flow.guard(`fit-points-${id}`, pts.length >= 3, { id, n: pts.length });
  fits.set(id, fitMM(pts, null));
}
for (const [id, pts] of groups) {
  const c = CONDS.find(x => x.condition_id === id);
  if (!c.inhibitor) continue;
  const control = CONDS.find(x => !x.inhibitor && x.pH === c.pH && x.temperature_C === c.temperature_C);
  flow.guard(`control-for-${id}`, !!control && fits.has(control.condition_id), { id });
  flow.guard(`fit-points-${id}`, pts.length >= 3, { id, n: pts.length });
  const V = fits.get(control.condition_id).vmax;
  fits.set(id, { vmax: V, km: fitMM(pts, V).km });
}
for (const c of CONDS) {
  const f = fits.get(c.condition_id);
  out.push({ condition_id: c.condition_id, vmax: f.vmax, km: f.km });
}
flow.note('fit', out);
flow.guard('fit-finite', out.every(x => Number.isFinite(x.vmax) && Number.isFinite(x.km) && x.vmax > 0 && x.km > 0), { out });

flow.done({ conditions: out, excluded_samples: excluded });
