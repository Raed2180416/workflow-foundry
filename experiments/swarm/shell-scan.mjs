// A small, quote- and heredoc-aware scanner for the Bash commands of a transcript (swarm ladder, review fix B1, 2026-11-04).
// The regex it replaces in writesOf (spawn-tree.mjs) read `"->"`, `> ''` and `a > b` inside quoted strings, heredoc bodies
// and comments as file redirections, so it returned "" or a word of a Python script as a written path; with `under(p, "")`
// true for every absolute path, the void audit then called any flagged path "self-created".
//
// What it understands (enough for the transcripts of this bed; it is not a full POSIX parser):
//   quotes        '…' (literal), "…" (backslash escapes), $'…'; a backslash outside quotes escapes one character
//   comments      `#` at the start of a word, to the end of the line
//   heredocs      << / <<- with a quoted or bare delimiter: the body lines are text, never shell
//   arithmetic    $(( … )) and (( … )) are skipped (`>` there is a comparison); inside [[ … ]] `<` and `>` are words
//   redirections  [n]> [n]>> >| &> &>> >&word (fd duplications `>&2`, `2>&1`, `>&-` are not files); >( … ) is a process
//                 substitution, not a file
//   commands      the words of every simple command (split at | || & && ; ;; ( ) and newlines), for tee, mkdir, touch, cp,
//                 mv, install and cd
// Nothing here runs a command or touches the filesystem.

const OPS = ['&>>', '<<-', '<<<', ';;', '&&', '||', '>>', '<<', '>|', '&>', '>&', '<&', '<>', '|', '&', ';', '(', ')', '<', '>'];
const REDIR_OUT = new Set(['>', '>>', '>|', '&>', '&>>', '>&']);
const SEP = new Set(['|', '||', '&', '&&', ';', ';;', '(', ')', '\n']);

/** Tokens of a shell command: { t: 'word', v, quoted } | { t: 'op', v, fd }. Heredoc bodies, comments and arithmetic are dropped. */
export function shellTokens(command) {
  const s = String(command ?? ''), out = [], pending = [];
  let i = 0, inTest = false;
  const isBlank = c => c === ' ' || c === '\t';
  const opAt = j => (s[j] === '\n' ? '\n' : OPS.find(o => s.startsWith(o, j)) ?? null);
  const skipHeredocBodies = () => {
    // i is just after a newline: consume each pending body up to its delimiter line
    while (pending.length) {
      const { delim, strip } = pending.shift();
      for (;;) {
        if (i >= s.length) return;
        let end = s.indexOf('\n', i); if (end < 0) end = s.length;
        let line = s.slice(i, end); if (strip) line = line.replace(/^\t+/, '');
        i = end + 1;
        if (line === delim) break;
      }
    }
  };
  // read one word starting at i (quotes joined); returns { v, quoted } or null when no word starts here
  const readWord = () => {
    let v = '', quoted = false, started = false;
    while (i < s.length) {
      const c = s[i];
      if (isBlank(c) || c === '\n') break;
      if (opAt(i) && !(inTest && (c === '<' || c === '>'))) break;   // an operator ends a word ([[ … ]] keeps < > as words)
      started = true;
      if (c === '\\') { v += s[i + 1] ?? ''; i += 2; continue; }
      if (c === "'") { const e = s.indexOf("'", i + 1); const end = e < 0 ? s.length : e; v += s.slice(i + 1, end); i = end + 1; quoted = true; continue; }
      if (c === '$' && s[i + 1] === "'") {
        let j = i + 2; while (j < s.length && s[j] !== "'") j += s[j] === '\\' ? 2 : 1;
        v += s.slice(i + 2, j); i = j + 1; quoted = true; continue;
      }
      if (c === '"') {
        let j = i + 1, buf = '';
        while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && j + 1 < s.length) { buf += s[j + 1]; j += 2; } else { buf += s[j]; j += 1; } }
        v += buf; i = j + 1; quoted = true; continue;
      }
      if (c === '$' && s[i + 1] === '(' && s[i + 2] === '(') { const e = s.indexOf('))', i + 3); i = e < 0 ? s.length : e + 2; v += '$((…))'; continue; }
      if (c === '$' && s[i + 1] === '(') {
        // command substitution: keep it inside the word (its own redirections are scanned by a nested call)
        let depth = 0, j = i + 1;
        for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')') { depth--; if (depth === 0) break; } }
        nestedTargets.push(...redirectTargets(shellTokens(s.slice(i + 2, j))));
        v += s.slice(i, j + 1); i = j + 1; continue;
      }
      if (c === '$' && s[i + 1] === '{') { const e = s.indexOf('}', i + 2); const end = e < 0 ? s.length : e; v += s.slice(i, end + 1); i = end + 1; continue; }
      v += c; i += 1;
    }
    return started ? { v, quoted } : null;
  };
  const nestedTargets = [];
  while (i < s.length) {
    const c = s[i];
    if (isBlank(c)) { i += 1; continue; }
    if (c === '\n') { out.push({ t: 'op', v: '\n' }); i += 1; skipHeredocBodies(); continue; }
    if (c === '#') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue; }
    if (c === '(' && s[i + 1] === '(') { const e = s.indexOf('))', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    // an fd number glued to a redirection: 2>file, 1>>file, 2>&1
    const fdm = /^(\d+)(?=[<>])/.exec(s.slice(i, i + 4));
    const at = fdm ? i + fdm[1].length : i;
    const op = opAt(at);
    if (op && op !== '\n' && !(inTest && (s[at] === '<' || s[at] === '>'))) {
      i = at + op.length;
      if ((op === '>' || op === '<') && s[i] === '(') { out.push({ t: 'op', v: `${op}(` }); continue; }   // process substitution: code, not a file
      if (op === '<<' || op === '<<-') {
        while (isBlank(s[i])) i += 1;
        const w = readWord();
        if (w) pending.push({ delim: w.v, strip: op === '<<-' });
        out.push({ t: 'op', v: op });
        continue;
      }
      out.push({ t: 'op', v: op, fd: fdm ? Number(fdm[1]) : null });
      continue;
    }
    const w = readWord();
    if (!w) { i += 1; continue; }
    if (w.v === '[[' && !w.quoted) inTest = true;
    if (w.v === ']]' && !w.quoted) inTest = false;
    out.push({ t: 'word', v: w.v, quoted: w.quoted });
  }
  for (const v of nestedTargets) out.push({ t: 'nested-target', v });
  return out;
}

/** File targets of output redirections in a token list (fd duplications and /dev/* excluded, empty targets dropped). */
export function redirectTargets(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === 'nested-target') { out.push(tk.v); continue; }
    if (tk.t !== 'op' || !REDIR_OUT.has(tk.v)) continue;
    const next = tokens[k + 1];
    if (!next || next.t !== 'word') continue;
    if (tk.v === '>&' && /^(\d+|-)$/.test(next.v)) continue;           // >&2, 1>&2, >&-
    if (/^&/.test(next.v)) continue;                                     // > &1 written apart
    out.push(next.v);
  }
  return out.filter(isFileTarget);
}

const isFileTarget = v => typeof v === 'string' && v.trim() !== '' && v !== '/' && !/^\/dev\//.test(v) && !/^\/proc\/self\/fd\//.test(v);

/** Simple commands: arrays of words between separators (redirections and their targets removed). */
export function simpleCommands(tokens) {
  const cmds = []; let cur = [];
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === 'nested-target') continue;
    if (tk.t === 'op' && SEP.has(tk.v)) { if (cur.length) cmds.push(cur); cur = []; continue; }
    if (tk.t === 'op') { if (tokens[k + 1]?.t === 'word' && !/[<>]\($/.test(tk.v)) k += 1; continue; }   // a redirection and its word
    cur.push(tk.v);
  }
  if (cur.length) cmds.push(cur);
  return cmds;
}

const args = ws => ws.filter(w => !/^-/.test(w));
const PREFIX = new Set(['sudo', 'command', 'builtin', 'exec', 'nice', 'time', 'env', 'nohup']);
const strip = ws => { let k = 0; while (k < ws.length && (PREFIX.has(ws[k]) || /^\w+=/.test(ws[k]) || (ws[k - 1] === 'nice' && /^-n$|^-\d+$/.test(ws[k])) || (ws[k - 1] === '-n' && /^\d+$/.test(ws[k])))) k += 1; return ws.slice(k); };

/** What a Bash command writes and creates, and where it cds: { redirects, tee, mkdir, touch, copies, cd }. */
export function scanCommand(command) {
  const tokens = shellTokens(command);
  const res = { redirects: redirectTargets(tokens), tee: [], mkdir: [], touch: [], copies: [], cd: [] };
  for (const raw of simpleCommands(tokens)) {
    const ws = strip(raw), name = ws[0], rest = ws.slice(1);
    if (name === 'tee') res.tee.push(...args(rest).filter(isFileTarget));
    else if (name === 'mkdir') res.mkdir.push(...args(rest).filter(w => !/^\d{3,4}$/.test(w)).filter(isFileTarget));
    else if (name === 'touch') res.touch.push(...args(rest).filter(isFileTarget));
    else if (['cp', 'mv', 'install', 'ln'].includes(name)) { const a = args(rest); if (a.length >= 2) res.copies.push(a.at(-1)); }
    else if (name === 'cd' || name === 'pushd') { const a = args(rest); if (a.length) res.cd.push(a[0]); }
  }
  return res;
}
