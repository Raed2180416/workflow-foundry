// Held-out wordings (JUDGE-PROGRAM.md §1.0, §3.2): 40 per wave-1 port, 10 calib-OOD / 10 dev-OOD /
// 20 test-OOD, at least a third in another register, none equal (whitespace-normalised) to Q0-Q3.
// Source: .foundry/kev-data/heldout/authored/wordings/<port>.txt, one wording per line:
//   `cal|dev|tst,<register>@@<wording with {slots}>`
// Written from the contracts' options and slots only. Option names and descriptions are fixed per
// port (§1.0), so a wording changes the question text only.
import { normalizeWs, wordingPattern } from '../lib/render.mjs';
import { questionFromContract, fillWording, slotNames } from '../judges/kit.mjs';
import { ngramSet, jaccard, parseSource, AuthorError } from './pools.mjs';

export const WORDING_PORTS = Object.freeze(['R1', 'R2', 'R3', 'R4', 'I1', 'I2', 'S2', 'Q4', 'X1', 'X3', 'X5', 'X8', 'F1']);
export const WORDING_SLICES = Object.freeze({ cal: 'calib-ood', dev: 'dev-ood', tst: 'test-ood' });
export const WORDING_COUNTS = Object.freeze({ 'calib-ood': 10, 'dev-ood': 10, 'test-ood': 20 });
export const WORDING_REGISTERS = Object.freeze({ s: 'standard', t: 'terse', f: 'formal', n: 'non-native', c: 'colloquial', i: 'imperative' });
// Slots a wording must carry so the question names what the state alone does not (R2: which marker).
export const REQUIRED_SLOTS = Object.freeze({ R1: ['system'], R2: ['system', 'value'], R3: ['system'], R4: ['system'], X5: ['assumption'] });
const SAMPLE = { system: 'ATLAS', value: '[QX7]', field: 'updated', assumption: 'ATLAS writes numeric birth dates day first' };
export const MAX_Q_OVERLAP = 0.6;                       // word 3-gram Jaccard against any Q0-Q3 of the port

export const parseWordings = (text, port) => parseSource(text, { file: `${port}.txt` });

// entries: parseSource results of one port's wording file. Returns {wordings, errors}.
export function buildWordings(port, entries, contract) {
  const errors = [], out = [], counters = { 'calib-ood': 0, 'dev-ood': 0, 'test-ood': 0 };
  for (const e of entries) {
    const where = `${e.file}:${e.lineNo}`;
    const code = Object.keys(e.meta.tags).find(t => WORDING_SLICES[t]);
    const regCode = Object.keys(e.meta.tags).find(t => WORDING_REGISTERS[t]);
    if (!code || !regCode) { errors.push(`${where}: wording meta needs a slice (cal|dev|tst) and a register (${Object.keys(WORDING_REGISTERS).join('|')})`); continue; }
    const slice = WORDING_SLICES[code], text = e.fields[0];
    const id = `${code === 'cal' ? 'cal' : code === 'dev' ? 'dev' : 'tst'}-${String(++counters[slice]).padStart(2, '0')}`;
    out.push({ port, id, slice, text, register: WORDING_REGISTERS[regCode], where });
  }
  const allowed = new Set(Object.keys(contract.slots ?? {}));
  const q = ['Q0', 'Q1', 'Q2', 'Q3'].map(k => contract.wordings[k]);
  const qNorm = q.map(normalizeWs), qGrams = q.map(t => ngramSet(t, 3));
  const seen = new Map();
  for (const w of out) {
    const used = slotNames(w.text);
    for (const s of used) if (!allowed.has(s)) errors.push(`${w.where}: slot {${s}} is not a ${port} slot`);
    for (const s of REQUIRED_SLOTS[port] ?? []) if (!used.includes(s)) errors.push(`${w.where}: ${port} wording must carry {${s}}`);
    const bare = w.text.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '');
    if (/[{}]/.test(bare)) errors.push(`${w.where}: stray brace`);
    if (w.text.length < 12 || w.text.length > 600) errors.push(`${w.where}: wording length ${w.text.length}`);
    if (w.text !== normalizeWs(w.text)) errors.push(`${w.where}: wording has irregular whitespace`);
    const sample = Object.fromEntries(used.map(s => [s, s === 'system' ? contract.slots.system.values[0] : SAMPLE[s]]));
    try { questionFromContract(contract, { wordingText: w.text, slots: sample }); fillWording(w.text, sample, contract.slots); }
    catch (err) { errors.push(`${w.where}: does not render through the contract: ${err.message}`); }
    const n = normalizeWs(w.text);
    if (qNorm.includes(n)) errors.push(`${w.where}: equals a training wording Q0-Q3`);
    const g = ngramSet(w.text, 3);
    qGrams.forEach((qg, i) => { if (jaccard(g, qg) >= MAX_Q_OVERLAP) errors.push(`${w.where}: ${(jaccard(g, qg) * 100) | 0}% word-3-gram overlap with Q${i}`); });
    const key = n.toLowerCase().replace(/[^\p{L}\p{N}{}]+/gu, ' ').trim();
    if (seen.has(key)) errors.push(`${w.where}: duplicates ${seen.get(key)}`); else seen.set(key, w.where);
  }
  for (const [slice, n] of Object.entries(WORDING_COUNTS)) {
    const have = out.filter(w => w.slice === slice).length;
    if (have !== n) errors.push(`${port}: ${slice} has ${have} wordings, needs ${n}`);
  }
  // A wording pattern must not match another slice's wording (WordingGuard would flag the record).
  const pats = out.map(w => ({ w, re: wordingPattern(w.text) }));
  for (const a of pats) for (const b of out) if (a.w !== b && a.w.slice !== b.slice && a.re.test(normalizeWs(b.text.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, m => `<${m.slice(1, -1)}>`)))) errors.push(`${a.w.where}: pattern matches ${b.slice} wording ${b.where}`);
  const other = out.filter(w => w.register !== 'standard');
  for (const slice of Object.keys(WORDING_COUNTS)) {
    const inSlice = out.filter(w => w.slice === slice), o = inSlice.filter(w => w.register !== 'standard').length;
    if (inSlice.length && o < Math.ceil(inSlice.length / 3)) errors.push(`${port}: ${slice} has ${o}/${inSlice.length} wordings in another register (needs at least a third)`);
  }
  if (out.length && other.length < Math.ceil(out.length / 3)) errors.push(`${port}: ${other.length}/${out.length} wordings in another register (needs at least a third)`);
  return { wordings: out, errors };
}
export { AuthorError };
