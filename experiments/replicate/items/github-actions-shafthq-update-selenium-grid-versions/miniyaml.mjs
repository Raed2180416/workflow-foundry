// A deliberately small YAML subset parser for the two kinds of document this item handles: a GitHub Actions workflow and a
// docker-compose file. There is no YAML library in the repository (node_modules holds none; installing one is out of bounds),
// so this is ours. Scope: block mappings and sequences, plain / single-quoted / double-quoted one-line scalars, literal block
// scalars (| |- |+), full-line and trailing comments, an optional leading `---`. Scalars stay strings (empty, `null` and `~` give null).
//
// It REJECTS rather than guesses: flow collections, anchors, aliases, tags, folded scalars, multi-line plain/quoted scalars and
// merge keys throw YamlError('UNSUPPORTED', ...). Genuine syntax errors throw YamlError('SYNTAX', ...), with the wording of the
// libraries it stands in for where fixtures/docker-probes.json recorded one.
export class YamlError extends Error {
  constructor(code, message, line = null) { super(line == null ? message : `${message} (line ${line})`); this.name = 'YamlError'; this.code = code; this.line = line; }
}
const syntax = (message, line) => new YamlError('SYNTAX', message, line);
const unsupported = (message, line) => new YamlError('UNSUPPORTED', `unsupported YAML construct: ${message}`, line);

export function parseYaml(text) {
  if (typeof text !== 'string') throw syntax('input is not text');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  let pos = 0;
  if (lines[0]?.trim() === '---') pos = 1;
  for (let i = pos; i < lines.length; i++) {
    if (/^\s*\t/.test(lines[i]) && lines[i].trim() !== '') throw syntax('found character that cannot start any token (tab used for indentation)', i + 1);
    if (/^(---|\.\.\.)(\s|$)/.test(lines[i])) throw unsupported('document marker inside the file', i + 1);
  }
  const skippable = l => /^\s*(#.*)?$/.test(l);
  const indentOf = l => l.length - l.trimStart().length;
  const skip = () => { while (pos < lines.length && skippable(lines[pos])) pos++; };
  const eof = () => { skip(); return pos >= lines.length; };

  // Splits "key: rest" at the first ':' that is followed by a space or the end of the line. Null if the line is not a key line.
  function splitKey(body) {
    if (body[0] === '"' || body[0] === "'") {
      const q = body[0], end = body.indexOf(q, 1);
      if (end < 0) return null;
      const m = /^\s*:(?:\s+(.*))?$/.exec(body.slice(end + 1));
      return m ? { key: body.slice(1, end), rest: (m[1] ?? '').trim() } : null;
    }
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '#' && (i === 0 || /\s/.test(body[i - 1]))) return null;
      if (body[i] === ':' && (i + 1 === body.length || body[i + 1] === ' ')) {
        const key = body.slice(0, i).trimEnd();
        return key ? { key, rest: body.slice(i + 1).trim() } : null;
      }
    }
    return null;
  }
  const isListLine = body => body === '-' || body.startsWith('- ');

  function parseNode(parentIndent) {
    if (eof()) return null;
    const line = lines[pos], ind = indentOf(line);
    if (ind <= parentIndent) return null;
    const body = line.slice(ind);
    if (isListLine(body)) return parseList(ind);
    if (splitKey(body)) return parseMap(ind);
    const value = scalar(body, pos + 1);
    pos++;
    return value;
  }

  function scalar(raw, lineNo) {
    const s = raw.trim();
    if (s[0] === '"' || s[0] === "'") {
      const q = s[0];
      let out = '', i = 1;
      for (; i < s.length; i++) {
        const c = s[i];
        if (q === "'" && c === "'") { if (s[i + 1] === "'") { out += "'"; i++; continue; } break; }
        if (q === '"' && c === '"') break;
        if (q === '"' && c === '\\') {
          const n = s[++i], map = { n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/', r: '\r', 0: '\0', ' ': ' ' };
          if (n === undefined || !(n in map)) throw unsupported(`escape \\${n ?? ''} in a double-quoted scalar`, lineNo);
          out += map[n]; continue;
        }
        out += c;
      }
      if (i >= s.length) throw syntax('found unexpected end of stream while scanning a quoted scalar', lineNo);
      const tail = s.slice(i + 1).trim();
      if (tail && !tail.startsWith('#')) throw syntax('did not find expected key (content after a quoted scalar)', lineNo);
      return out;
    }
    if (/^[\[{]/.test(s)) throw unsupported('flow collection', lineNo);
    if (/^[&*!]/.test(s)) throw unsupported('anchor, alias or tag', lineNo);
    if (/^[>%@`]/.test(s) || s === '?') throw unsupported(`indicator ${s[0]}`, lineNo);
    const value = s.replace(/\s+#.*$/, '').trimEnd();
    if (/:(\s|$)/.test(value)) throw syntax('mapping values are not allowed in this context', lineNo);
    return value === '' || value === 'null' || value === '~' ? null : value;
  }

  function blockScalar(header, parentIndent, lineNo) {
    const m = /^\|([+-]?)\s*(#.*)?$/.exec(header);
    if (!m) throw unsupported(`block scalar header "${header}"`, lineNo);
    const chomp = m[1], body = [];
    while (pos < lines.length && (lines[pos].trim() === '' || indentOf(lines[pos]) > parentIndent)) body.push(lines[pos++]);
    const first = body.find(l => l.trim() !== '');
    if (first === undefined) return chomp === '+' ? '\n'.repeat(body.length) : '';
    const blockIndent = indentOf(first);
    const content = body.map(l => {
      if (l.trim() === '') return l.length > blockIndent ? l.slice(blockIndent) : '';
      if (indentOf(l) < blockIndent) throw syntax('block scalar line is indented less than its first line', lineNo);
      return l.slice(blockIndent);
    });
    let end = content.length;
    while (end > 0 && content[end - 1] === '') end--;
    const kept = content.slice(0, end).join('\n');
    if (chomp === '-') return kept;
    if (chomp === '+') return kept + '\n' + '\n'.repeat(content.length - end);
    return kept === '' ? '' : kept + '\n';
  }

  function value(rest, keyIndent, lineNo, inList = false) {
    if (rest === '' || rest.startsWith('#')) {
      if (eof()) return null;
      const ind = indentOf(lines[pos]), body = lines[pos].slice(ind);
      if (!inList && ind === keyIndent && isListLine(body)) return parseList(ind);
      return parseNode(keyIndent);
    }
    if (rest[0] === '|') return blockScalar(rest, keyIndent, lineNo);
    const v = scalar(rest, lineNo);
    if (typeof v === 'string' && !eof() && indentOf(lines[pos]) > keyIndent && !inList) throw unsupported('multi-line plain scalar', pos + 1);
    return v;
  }

  function parseMap(indent) {
    const out = {};
    for (;;) {
      if (eof()) break;
      const line = lines[pos], ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) throw syntax('bad indentation of a mapping entry', pos + 1);
      const body = line.slice(ind), kv = splitKey(body);
      if (!kv) throw syntax('could not find expected ":"', pos + 1);
      if (kv.key === '<<') throw unsupported('merge key', pos + 1);
      if (/^[&*!]/.test(kv.key)) throw unsupported('anchor, alias or tag in a key', pos + 1);
      if (Object.hasOwn(out, kv.key)) throw syntax(`mapping key "${kv.key}" already defined`, pos + 1);
      const lineNo = pos + 1;
      pos++;
      out[kv.key] = value(kv.rest, indent, lineNo);
    }
    return out;
  }

  function parseList(indent) {
    const out = [];
    for (;;) {
      if (eof()) break;
      const line = lines[pos], ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) throw syntax('bad indentation of a sequence entry', pos + 1);
      const body = line.slice(ind);
      if (!isListLine(body)) break;
      const content = body === '-' ? '' : body.slice(1);
      const spaces = content.length - content.trimStart().length, rest = content.trim();
      const lineNo = pos + 1;
      if (rest === '' || rest.startsWith('#')) { pos++; out.push(value('', indent, lineNo, true)); continue; }
      const childIndent = indent + 1 + spaces;
      if (isListLine(rest) || splitKey(rest)) {
        lines[pos] = ' '.repeat(childIndent) + rest;     // treat "- key: v" as the first line of a mapping nested two columns deeper
        out.push(isListLine(rest) ? parseList(childIndent) : parseMap(childIndent));
      } else { pos++; out.push(value(rest, indent, lineNo, true)); }
    }
    return out;
  }

  const doc = parseNode(-1);
  if (!eof()) throw syntax('did not find expected <document start> (content after the document)', pos + 1);
  return doc;
}
