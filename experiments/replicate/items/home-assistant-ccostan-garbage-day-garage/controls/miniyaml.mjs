// A small YAML reader for the subset Home Assistant automation files use: block mappings and sequences, plain / single-quoted /
// double-quoted scalars, flow sequences and mappings, comments, and folded / literal block scalars (>, >-, |, |-).
// It rejects what it does not implement (anchors, tags, multi-document, keep chomping) instead of guessing. It is only a reader for
// this item's control; tests cross-check it against PyYAML's parse of the same file (fixtures/original/parsed.pyyaml.json).

export class YamlUnsupported extends Error {}

const indentOf = raw => raw.length - raw.trimStart().length;

// Remove a trailing comment (a '#' preceded by whitespace, outside quotes) and trailing spaces.
function stripComment(raw) {
  let q = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if ((c === '"' || c === "'") && (i === 0 || /[\s\[{,:]/.test(raw[i - 1]))) { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i).trimEnd();
  }
  return raw.trimEnd();
}

function parseScalar(text) {
  const t = text.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if (t.startsWith("'")) { if (!t.endsWith("'") || t.length < 2) throw new YamlUnsupported(`bad single-quoted scalar: ${t}`); return t.slice(1, -1).replaceAll("''", "'"); }
  if (t.startsWith('"')) {
    if (!t.endsWith('"') || t.length < 2) throw new YamlUnsupported(`bad double-quoted scalar: ${t}`);
    return t.slice(1, -1).replace(/\\(["\\/nrt0]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, (_, e) => ({ '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', 0: '\0' }[e] ?? String.fromCharCode(parseInt(e.slice(1), 16))));
  }
  if (/^[&*!|>]/.test(t)) throw new YamlUnsupported(`anchors, aliases and tags are not supported: ${t}`);
  return t;
}

// Flow collections: [a, b, {c: d}] with nesting and quotes.
function parseFlow(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const value = () => {
    ws();
    if (text[i] === '[') {
      i++; const arr = [];
      for (;;) { ws(); if (text[i] === ']') { i++; return arr; } arr.push(value()); ws(); if (text[i] === ',') i++; else if (text[i] !== ']') throw new YamlUnsupported(`bad flow sequence: ${text}`); }
    }
    if (text[i] === '{') {
      i++; const obj = {};
      for (;;) {
        ws(); if (text[i] === '}') { i++; return obj; }
        const k = atom(':'); ws(); if (text[i] !== ':') throw new YamlUnsupported(`bad flow mapping: ${text}`); i++;
        obj[String(parseScalar(k))] = value(); ws(); if (text[i] === ',') i++; else if (text[i] !== '}') throw new YamlUnsupported(`bad flow mapping: ${text}`);
      }
    }
    return parseScalar(atom(',]}'));
  };
  const atom = stops => {
    ws(); const start = i;
    if (text[i] === '"' || text[i] === "'") { const q = text[i++]; while (i < text.length && text[i] !== q) { if (text[i] === '\\' && q === '"') i++; i++; } i++; return text.slice(start, i); }
    while (i < text.length && !stops.includes(text[i])) i++;
    return text.slice(start, i).trim();
  };
  const v = value(); ws();
  if (i < text.length) throw new YamlUnsupported(`trailing text in flow collection: ${text}`);
  return v;
}

export function parseYaml(src) {
  if (/^---/m.test(src)) throw new YamlUnsupported('multi-document YAML is not supported');
  const lines = src.replace(/\r\n/g, '\n').split('\n').map(raw => ({ raw }));
  let pos = 0;
  const blank = i => stripComment(lines[i].raw).trim() === '';
  const skipBlank = () => { while (pos < lines.length && blank(pos)) pos++; };

  function blockScalar(header, parentIndent) {
    const m = /^([>|])([+-]?)(\d*)$/.exec(header);
    if (!m || m[2] === '+' || m[3]) throw new YamlUnsupported(`block scalar header not supported: ${header}`);
    const folded = m[1] === '>', strip = m[2] === '-';
    const body = [];
    while (pos < lines.length && (lines[pos].raw.trim() === '' || indentOf(lines[pos].raw) > parentIndent)) body.push(lines[pos++].raw);
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    const base = Math.min(...body.filter(l => l.trim() !== '').map(indentOf));
    if (!Number.isFinite(base)) return strip ? '' : '';
    let out = '';
    if (folded) {
      for (const l of body) if (l.trim() !== '' && indentOf(l) !== base) throw new YamlUnsupported('more-indented lines in a folded scalar are not supported');
      const paras = []; let cur = [];
      for (const l of body) { if (l.trim() === '') { if (cur.length) { paras.push(cur.join(' ')); cur = []; } else paras.push(''); } else cur.push(l.slice(base).trimEnd()); }
      if (cur.length) paras.push(cur.join(' '));
      out = paras.join('\n');
    } else out = body.map(l => l.slice(base).trimEnd()).join('\n');
    return strip ? out : `${out}\n`;
  }

  function value(rest, indent) {
    // The text after "key:" on the same line, or '' for a nested block.
    const r = rest.trim();
    if (r === '') {
      skipBlank();
      if (pos >= lines.length) return null;
      const ni = indentOf(lines[pos].raw), nt = stripComment(lines[pos].raw).trim();
      if (ni > indent) return block(ni);
      if (ni === indent && (nt.startsWith('- ') || nt === '-')) return block(ni);       // a sequence may sit at the key's indent
      return null;
    }
    if (/^[>|]/.test(r)) return blockScalar(r, indent);
    if (r.startsWith('[') || r.startsWith('{')) return parseFlow(r);
    return parseScalar(r);
  }

  function block(indent) {
    skipBlank();
    const text = stripComment(lines[pos].raw).trim();
    return text.startsWith('- ') || text === '-' ? sequence(indent) : /^[^'"\s][^:]*:(\s|$)|^['"][^'"]*['"]:(\s|$)/.test(text) ? mapping(indent) : scalarLine();
  }
  function scalarLine() { const t = stripComment(lines[pos++].raw).trim(); return t.startsWith('[') || t.startsWith('{') ? parseFlow(t) : parseScalar(t); }

  function sequence(indent) {
    const out = [];
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const raw = lines[pos].raw, text = stripComment(raw).trim();
      if (indentOf(raw) !== indent || !(text.startsWith('- ') || text === '-')) break;
      if (text === '-') { pos++; out.push(value('', indent)); continue; }
      // Turn "- x" into a line indented past the dash and parse it as a block at that indent.
      const afterDash = text.slice(2), extra = text.slice(1).length - text.slice(1).trimStart().length;
      lines[pos] = { raw: ' '.repeat(indent + 1 + extra) + afterDash.trimStart() };
      out.push(block(indent + 1 + extra));
    }
    return out;
  }

  function mapping(indent) {
    const out = {};
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const raw = lines[pos].raw, text = stripComment(raw).trim();
      if (indentOf(raw) !== indent || text.startsWith('- ')) break;
      const m = /^(?:'([^']*)'|"([^"]*)"|([^'"\s][^:]*?)):(?:\s+(.*))?$/.exec(text);
      if (!m) throw new YamlUnsupported(`line ${pos + 1}: cannot read "${text}"`);
      const key = m[1] ?? m[2] ?? m[3];
      pos++;
      if (key in out) throw new YamlUnsupported(`duplicate key ${key}`);
      out[key] = value(m[4] ?? '', indent);
    }
    return out;
  }

  skipBlank();
  if (pos >= lines.length) return null;
  return block(indentOf(lines[pos].raw));
}
