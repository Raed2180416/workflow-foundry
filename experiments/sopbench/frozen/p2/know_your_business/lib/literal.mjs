// Reads the list and record values the task files and tools carry: JSON, or a Python literal such as
// "[{'name': 'A Person', 'id': 'ID1', 'ownership': 50.0}]" (single or double quotes, True/False/None).
// Returns undefined when the text is neither, so a caller can report the value as unreadable.
export function parseLiteral(source) {
  if (typeof source !== 'string') return source;
  const s = source;
  let i = 0;
  const fail = () => { throw new SyntaxError('not a literal'); };
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const str = q => {
    let out = '';
    i++;
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\' && i + 1 < s.length) {
        const e = s[i + 1];
        i += 2;
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'u') { out += String.fromCharCode(parseInt(s.slice(i, i + 4), 16)); i += 4; }
        else out += e;
      } else out += s[i++];
    }
    if (s[i] !== q) fail();
    i++;
    return out;
  };
  // A bracketed sequence of items separated by commas (a trailing comma is allowed).
  const seq = (close, item) => {
    const out = [];
    i++;
    skip();
    if (s[i] === close) { i++; return out; }
    for (;;) {
      out.push(item());
      skip();
      if (s[i] === ',') {
        i++;
        skip();
        if (s[i] === close) { i++; return out; }
        continue;
      }
      if (s[i] === close) { i++; return out; }
      fail();
    }
  };
  const pair = () => {
    const k = value();
    skip();
    if (s[i] !== ':') fail();
    i++;
    return [k, value()];
  };
  const value = () => {
    skip();
    const c = s[i];
    if (c === '[' || c === '(') return seq(c === '[' ? ']' : ')', value);
    if (c === '{') return Object.fromEntries(seq('}', pair));
    if (c === '"' || c === "'") return str(c);
    const num = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    const word = /^[A-Za-z]+/.exec(s.slice(i));
    if (word) {
      i += word[0].length;
      const words = { True: true, true: true, False: false, false: false, None: null, null: null };
      if (Object.hasOwn(words, word[0])) return words[word[0]];
    }
    return fail();
  };
  try {
    const v = value();
    skip();
    return i === s.length ? v : undefined;
  } catch {
    return undefined;
  }
}
