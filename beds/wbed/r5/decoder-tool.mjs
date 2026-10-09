// The "proprietary" format's decoder (R5 format `decoder-tool`). The dump ships decoder.mjs as a TEXT file; its body is
// built from the functions below with Function.prototype.toString, so the bed's in-process decoder and the shipped
// text are the same code (a test imports the shipped text from a data: URL and compares). Deterministic, no I/O except
// when run as a command: `node decoder.mjs --key=<run number> --layout=<1-4> < LEDGER.PDX`.
//
// Encoding: each record is "type|f1|...|f7" in the dump's field layout, then every character in ALPHABET is rotated
// forward by (key + its position in the record) within ALPHABET; characters in KEEP stay; any other character is
// written "~" + four hexadecimal digits of its UTF-16 code unit. The first line of the file is "RUN <run number>".

export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const KEEP = ' |.,/-:;=';
export const LAYOUTS = {
  1: ['invoice', 'system', 'row', 'date', 'currency', 'amount', 'status'],
  2: ['row', 'invoice', 'amount', 'currency', 'status', 'date', 'system'],
  3: ['system', 'date', 'invoice', 'status', 'row', 'amount', 'currency'],
  4: ['status', 'amount', 'date', 'row', 'system', 'currency', 'invoice'],
};

export function encodeRecord(plain, key) {
  let out = '';
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i], k = ALPHABET.indexOf(ch);
    if (k >= 0) out += ALPHABET[(k + key + i) % ALPHABET.length];
    else if (KEEP.includes(ch)) out += ch;
    else out += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

export function decodeRecord(text, key) {
  let out = '', i = 0;
  for (let j = 0; j < text.length; j++, i++) {
    const ch = text[j];
    if (ch === '~') { out += String.fromCharCode(parseInt(text.slice(j + 1, j + 5), 16)); j += 4; continue; }
    const k = ALPHABET.indexOf(ch);
    if (k < 0) { out += ch; continue; }
    const n = ALPHABET.length;
    out += ALPHABET[(((k - key - i) % n) + n) % n];
  }
  return out;
}

export function decode(text, flags = {}) {
  const key = Number(flags.key ?? 0), layout = LAYOUTS[Number(flags.layout ?? 1)] ?? LAYOUTS[1];
  const canon = LAYOUTS[1];
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('RUN ')) continue;
    const plain = decodeRecord(line, key);
    const parts = plain.split('|');
    const type = parts[0];
    if (type === 'D' || type === 'V') {
      const byName = {};
      layout.forEach((f, i) => { byName[f] = parts[i + 1] ?? ''; });
      out.push([type, ...canon.map(f => byName[f])].join('|'));
    } else out.push(plain);
  }
  return out.join('\n');
}

export function parseFlags(argv) {
  const flags = {};
  for (const a of argv) { const m = /^--([a-z]+)=(.*)$/.exec(a); if (m) flags[m[1]] = m[2]; }
  return flags;
}

const HEADER = `// decoder.mjs: decoder for the RIVET-LD archive format (receivables extract), version 2.3.
// Usage:  node decoder.mjs --key=<run number> --layout=<field layout 1-4> < LEDGER.PDX > decoded.txt
// Output: one line per record, "type|invoice|system|row|date|currency|amount|status" for D and V records; other
// records (the T trailer) are printed as stored. Without --layout the decoder assumes field layout 1; without --key it
// assumes key 0. It does not check either: wrong flags give wrong text, not an error.
`;
const CLI = `
if (typeof process !== 'undefined' && process.argv[1] && /decoder\\.mjs$/.test(process.argv[1])) {
  const { readFileSync } = await import('node:fs');
  process.stdout.write(decode(readFileSync(0, 'utf8'), parseFlags(process.argv.slice(2))) + '\\n');
}
`;
/** The text of decoder.mjs as shipped in the dump. */
export const DECODER_TEXT = [
  HEADER,
  `export const ALPHABET = ${JSON.stringify(ALPHABET)};`,
  `export const KEEP = ${JSON.stringify(KEEP)};`,
  `export const LAYOUTS = ${JSON.stringify(LAYOUTS)};`,
  `export ${encodeRecord.toString()}`,
  `export ${decodeRecord.toString()}`,
  `export ${decode.toString()}`,
  `export ${parseFlags.toString()}`,
  CLI,
].join('\n');
