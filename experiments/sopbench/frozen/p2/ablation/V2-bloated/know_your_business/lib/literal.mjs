// Reads the Python-literal text the SOP's list fields arrive as, e.g. "[{'name': 'A Petrov', 'id': 'ID276', 'ownership': 50.0}]".
// JSON is accepted too. Anything else throws a SyntaxError, so the caller can turn it into a finding.
export function parseLiteral(text) {
  const s = String(text);
  let i = 0;
  const fail = () => { throw new SyntaxError(`unreadable literal at ${i}`); };
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const str = q => {
    i++;
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\' && i + 1 < s.length) {
        const e = s[i + 1];
        out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        i += 2;
      } else out += s[i++];
    }
    if (s[i] !== q) fail();
    i++;
    return out;
  };
  const value = () => {
    skip();
    const c = s[i];
    if (c === '[' || c === '(') {
      const close = c === '[' ? ']' : ')';
      i++;
      const out = [];
      skip();
      while (s[i] !== close) {
        out.push(value());
        skip();
        if (s[i] === ',') { i++; skip(); } else if (s[i] !== close) fail();
      }
      i++;
      return out;
    }
    if (c === '{') {
      i++;
      const out = {};
      skip();
      while (s[i] !== '}') {
        const k = value();
        skip();
        if (s[i] !== ':') fail();
        i++;
        out[String(k)] = value();
        skip();
        if (s[i] === ',') { i++; skip(); } else if (s[i] !== '}') fail();
      }
      i++;
      return out;
    }
    if (c === "'" || c === '"') return str(c);
    const num = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    const word = /^[A-Za-z_]+/.exec(s.slice(i));
    const words = { True: true, true: true, False: false, false: false, None: null, null: null };
    if (word && Object.hasOwn(words, word[0])) { i += word[0].length; return words[word[0]]; }
    return fail();
  };
  const out = value();
  skip();
  if (i !== s.length) fail();
  return out;
}
