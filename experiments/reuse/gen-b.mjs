// Program B's data: suppliers' product masters, B's labelled history (the pool a builder learns from) and the shipment
// stream (research/reuse-20261021/PREREG-C2-1.md §1). Deterministic from a seed. The manifest written here holds no
// SOP-Bench text: products in the proof text style reference a proven row by id (`textRef.row`), and their texts are
// read from the proof bank at run time (LIVE_ROOT, outside the repo; SOP-Bench is CC BY-NC). GHS-style texts are
// authored here for B.
import { COMPONENTS, TEXT_FIELDS } from './world-b.mjs';
import { SOURCES, rawOf, truthOf } from './program-b.mjs';
import { pick, rng, sha256, shuffled, canon } from './lib.mjs';

export const MANIFEST_SCHEMA = 'c2-manifest/1';
export const DEFAULT_SIZES = Object.freeze({ pool: 15, build: 5, shipments: 10, itemWeights: [0.3, 0.4, 0.3], zeroRate: 0.03 });
export const EDGE_KINDS = Object.freeze(['miss1', 'miss2', 'miss3', 'badid', 'blank1', 'unknownid']);
const FIELD_OF = Object.freeze({ safety: 'sds_label_text', handling: 'handling_and_storage_guidelines', transportation: 'transportation_requirements', disposal: 'disposal_guidelines' });

// GHS-style documents for supplier S1, by component and SOP severity 1–5 (authored for program B; GHS hazard (H) and
// precautionary (P) statement wording is the UN GHS standard phrasing).
export const GHS_TEXT = Object.freeze({
  safety: {
    1: ['Not classified under GHS. No signal word, no hazard statements.', 'GHS: no classification required; no pictogram.'],
    2: ['Warning. H303 May be harmful if swallowed. H316 Causes mild skin irritation.', 'Warning. H333 May be harmful if inhaled.'],
    3: ['Warning. H315 Causes skin irritation. H319 Causes serious eye irritation. H335 May cause respiratory irritation.', 'Warning. H226 Flammable liquid and vapour. H336 May cause drowsiness or dizziness.'],
    4: ['Danger. H301 Toxic if swallowed. H311 Toxic in contact with skin. H331 Toxic if inhaled.', 'Danger. H225 Highly flammable liquid and vapour. H314 Causes severe skin burns and eye damage.'],
    5: ['Danger. H200 Unstable explosive. H250 Catches fire spontaneously if exposed to air.', 'Danger. H330 Fatal if inhaled. H310 Fatal in contact with skin. H370 Causes damage to organs.'],
  },
  handling: {
    1: ['P262 Avoid contact with eyes. Store in a dry place (P402). No special storage class.', 'General warehouse storage; P103 Read label before use.'],
    2: ['P264 Wash hands thoroughly after handling. P402 Store in a dry place.', 'P270 Do not eat, drink or smoke when using this product. Store at ambient temperature.'],
    3: ['P280 Wear protective gloves/eye protection. P403+P233 Store in a well-ventilated place. Keep container tightly closed.', 'P210 Keep away from heat, sparks and open flames. Storage class 3 cabinet.'],
    4: ['P260 Do not breathe vapours. P405 Store locked up. P403+P235 Keep cool in a well-ventilated place.', 'P231+P232 Handle under inert gas; protect from moisture. P405 Store locked up.'],
    5: ['P230 Keep wetted. P250 Do not subject to grinding, shock or friction. P401 Store in a licensed explosives magazine.', 'P222 Do not allow contact with air. P422 Store contents under inert gas. Restricted-access vault only.'],
  },
  transportation: {
    1: ['Not regulated for transport (non-dangerous goods under ADR, IMDG and IATA).', 'No UN number; ships as general cargo.'],
    2: ['Limited quantity, UN 3082 Class 9, PG III; excepted packaging allowed.', 'UN 1993, Class 3, PG III, limited quantity provisions apply.'],
    3: ['UN 1263, Class 3, PG II; ADR/IMDG compliant packaging, orange-panel marking.', 'UN 1760, Class 8, PG III; IATA PI 852 packaging.'],
    4: ['UN 2810, Class 6.1, PG II; segregated from foodstuffs; IATA cargo aircraft only.', 'UN 1830, Class 8, PG II; tank or IBC with corrosion-resistant lining.'],
    5: ['UN 0081, Class 1.1D; forbidden on passenger and cargo aircraft; escorted road transport.', 'UN 1381, Class 4.2, PG I; carried under water, special provision 503.'],
  },
  disposal: {
    1: ['P501 Dispose of contents/container in accordance with local regulations; household waste acceptable.', 'Recyclable packaging; no hazardous waste code.'],
    2: ['P501 Dispose of contents/container to an approved waste disposal plant. EWC 16 05 09.', 'Collect for licensed chemical recycling; EWC 07 01 99.'],
    3: ['P501 Dispose of contents/container to a hazardous waste collector. EWC 16 05 08*.', 'Neutralise before disposal by a licensed contractor; EWC 06 01 06*.'],
    4: ['Incinerate in a permitted hazardous-waste incinerator with scrubber. EWC 16 05 06*.', 'P501 Licensed hazardous-waste contractor only; manifest required. EWC 07 01 03*.'],
    5: ['Render safe by explosive-ordnance disposal specialists only. EWC 16 04 01*.', 'Controlled destruction under inert atmosphere by a licensed specialist; EWC 16 05 07*.'],
  },
});

// German documents for supplier H5 (held-out language drift), by component and SOP severity 1–5 (authored for program B).
export const DE_TEXT = Object.freeze({
  safety: {
    1: ['Geringe Gesundheitsgefahr', 'Kein Gefahrstoff'], 2: ['Leicht reizend', 'Mögliche Hautreizung'],
    3: ['Reizt Augen und Haut', 'Entzündbare Flüssigkeit'], 4: ['Giftig beim Verschlucken', 'Stark ätzend'],
    5: ['Explosionsgefährlich', 'Lebensgefahr beim Einatmen'],
  },
  handling: {
    1: ['Normale Lagerung', 'Trocken lagern'], 2: ['Kühl und trocken lagern', 'Behälter geschlossen halten'],
    3: ['Belüfteter Lagerraum', 'Von Zündquellen fernhalten'], 4: ['Unter Verschluss aufbewahren', 'Lagerung unter Schutzgas'],
    5: ['Lagerung im Sprengstofflager', 'Zutritt nur für Befugte'],
  },
  transportation: {
    1: ['Kein Gefahrgut', 'Normaler Versand'], 2: ['Begrenzte Menge', 'Freigestellte Verpackung'],
    3: ['Gefahrgutverpackung erforderlich', 'Kennzeichnung nach ADR'], 4: ['Getrennter Transport', 'Nur Frachtflugzeug'],
    5: ['Transport mit Begleitung', 'Luftfracht verboten'],
  },
  disposal: {
    1: ['Normale Entsorgung', 'Hausmüll zulässig'], 2: ['Chemische Entsorgung', 'Wertstoffsammlung'],
    3: ['Sondermüll', 'Entsorgung durch Fachbetrieb'], 4: ['Verbrennung in Sonderanlage', 'Nur zugelassener Entsorger'],
    5: ['Vernichtung durch Spezialisten', 'Kontrollierte Zerstörung'],
  },
});

/** Split a total T (4–20) into four component scores 1–5 uniformly over compositions. */
function compose(r, T) {
  for (let tries = 0; tries < 10_000; tries++) {
    const a = COMPONENTS.map(() => 1 + Math.floor(r() * 5));
    if (a.reduce((x, y) => x + y, 0) === T) return a;
  }
  throw new Error(`compose: no composition for ${T}`);
}

const BAD_IDS = [n => `P_${String(n).slice(0, 4)}`, n => `X_${n}`, n => `P_${String(n).slice(0, 2)}A${String(n).slice(3)}`, n => `p_${n}`, n => `P_${n}9`, n => `P${n}`];

/**
 * generate({ seed, bank: [{row, total}], sizes }) -> manifest. bank: the proven rows' ids and score totals (the proof
 * bank without its texts). Every product id is unique across the manifest.
 */
export function generate({ seed, bank, sizes = DEFAULT_SIZES, sources }) {
  if (!sources?.length) throw new Error('generate: sources required');
  if (!bank?.length) throw new Error('generate: the proof bank is empty');
  const r = rng(`c2-gen:${seed}`);
  const usedNums = new Set();
  const newNum = () => { for (;;) { const n = 20000 + Math.floor(r() * 80000); if (!usedNums.has(n) && n < 100000) { usedNums.add(n); return n; } } };
  const nearestRow = T => {
    const best = Math.min(...bank.map(b => Math.abs(b.total - T)));
    return pick(r, bank.filter(b => Math.abs(b.total - T) === best)).row;
  };
  const products = [], shipments = [], perSource = {};
  let pIndex = 0;
  const makeProduct = (source, role, edgeKind) => {
    const spec = SOURCES[source];
    const n = newNum();
    let id = spec.idStyle === 'hyphen' ? `P-${n}` : spec.idStyle === 'lower' ? `p_${n}` : `P_${n}`;
    const T = 4 + Math.floor(r() * 17);
    const comp = compose(r, T);
    const s = Object.fromEntries(COMPONENTS.map((c, i) => [c, r() < sizes.zeroRate ? 0 : comp[i]]));
    let inMaster = true, blank = null;
    if (edgeKind === 'miss1' || edgeKind === 'miss2' || edgeKind === 'miss3') {
      const k = Number(edgeKind.at(-1));
      for (const c of shuffled(COMPONENTS, r).slice(0, k)) s[c] = null;
    } else if (edgeKind === 'badid') { id = pick(r, BAD_IDS)(n); inMaster = false; }
    else if (edgeKind === 'blank1') blank = FIELD_OF[pick(r, COMPONENTS)];
    else if (edgeKind === 'unknownid') inMaster = false;
    const raw = Object.fromEntries(COMPONENTS.map(c => [c, rawOf(source, s[c], r())]));
    const textRef = spec.textStyle === 'ghs' || spec.textStyle === 'de'
      ? { style: spec.textStyle, pick: Object.fromEntries(COMPONENTS.map(c => [c, Math.floor(r() * 2)])), level: Object.fromEntries(COMPONENTS.map(c => [c, Math.max(1, s[c] ?? comp[COMPONENTS.indexOf(c)])])) }
      : { style: 'proof', row: nearestRow(T) };
    const p = { index: pIndex++, source, role, id, edgeKind: edgeKind ?? null, sop: s, raw, inMaster, blank, textRef };
    p.truth = truthOf({ source, id, raw, inMaster, texts: Object.fromEntries(TEXT_FIELDS.map(f => [f, f === blank ? '' : 'x'])) });
    products.push(p);
    return p;
  };
  for (const source of sources) {
    const edge = SOURCES[source].edge;
    const edgeOf = i => (edge ? EDGE_KINDS[i % EDGE_KINDS.length] : null);
    const pool = Array.from({ length: sizes.pool }, (_, i) => makeProduct(source, 'pool', edgeOf(i)));
    const ships = [];
    let e = 0;
    for (let k = 0; k < sizes.shipments; k++) {
      const x = r(); let nItems = 1, acc = 0;
      for (let i = 0; i < sizes.itemWeights.length; i++) { acc += sizes.itemWeights[i]; if (x < acc) { nItems = i + 1; break; } }
      const items = Array.from({ length: nItems }, () => makeProduct(source, 'eval', edgeOf(e++)));
      ships.push({ id: `${source}-sh${String(k + 1).padStart(2, '0')}`, source, mode: pick(r, ['air', 'sea', 'road']), items: items.map(p => p.id) });
    }
    shipments.push(...ships);
    perSource[source] = { build: pool.slice(0, sizes.build).map(p => p.id), repair: pool.slice(sizes.build).map(p => p.id), shipments: ships.map(s => s.id) };
  }
  const order = shuffled(shipments.map(s => s.id), r);
  const manifest = { schema: MANIFEST_SCHEMA, seed, sizes, bank: bank.map(b => ({ row: b.row, total: b.total })), sources: perSource, products, shipments, order };
  manifest.sha256 = sha256(canon({ ...manifest, sha256: undefined }));
  return manifest;
}

/** The documents of one product: proof-style texts from the bank (row -> inputs), GHS texts from GHS_TEXT. */
export function textsOf(product, bankTexts) {
  let t;
  if (product.textRef.style === 'ghs' || product.textRef.style === 'de') {
    const bankOf = product.textRef.style === 'ghs' ? GHS_TEXT : DE_TEXT;
    t = Object.fromEntries(COMPONENTS.map(c => [FIELD_OF[c], bankOf[c][product.textRef.level[c]][product.textRef.pick[c]]]));
  }
  else {
    const row = bankTexts.get(product.textRef.row);
    if (!row) throw new Error(`textsOf: proof row ${product.textRef.row} is not in the bank`);
    t = Object.fromEntries(TEXT_FIELDS.map(f => [f, row[f]]));
  }
  if (product.blank) t[product.blank] = '';
  return t;
}

/** The sub-task as the proven workflow takes it (SOP-Bench task.json shape): inputs in the procedure's column order. */
export function subtaskOf(product, bankTexts) {
  const texts = textsOf(product, bankTexts);
  const inputs = { product_id: product.id, ...texts };
  return { sop: 'dangerous_goods', row: product.index, inputs, task_text: Object.entries(inputs).map(([k, v]) => `${k}: ${v}`).join('\n'), output_columns: ['hazard_class'] };
}

/** The proof bank's texts by row (inputs of the proven rows), for textsOf. */
export const bankTextsOf = bank => new Map(bank.map(b => [b.row, b.inputs]));

/**
 * The supplier worlds of a manifest: one per source, holding every product of that source that is in its master (an id
 * the master cannot resolve is left out). allowed (optional): { [source]: [ids] } restricts what a world serves.
 */
export function worldsOf(manifest, { toolOrder, allowed = null, makeWorld }) {
  const out = {};
  for (const source of Object.keys(manifest.sources)) {
    const products = manifest.products.filter(p => p.source === source && p.inMaster).map(p => ({ id: p.id, raw: p.raw }));
    out[source] = makeWorld({ name: `B:${source}`, products, response: SOURCES[source].response, allowed: allowed?.[source] ?? null, toolOrder });
  }
  return out;
}

/** Products by id, and each eval item with its shipment (parent) in stream order. */
export function itemsOf(manifest) {
  const byId = new Map(manifest.products.map(p => [p.id, p]));
  const ships = new Map(manifest.shipments.map(s => [s.id, s]));
  const items = [];
  for (const sid of manifest.order) {
    const s = ships.get(sid);
    for (const pid of s.items) items.push({ product: byId.get(pid), shipment: s.id, source: s.source });
  }
  return { byId, ships, items };
}
