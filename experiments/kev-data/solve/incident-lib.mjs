// State-only solver helpers for the incident ports (JUDGE-PROGRAM.md §2.7 step 1: "solve/<port>.mjs reads only the
// exported state and question; for template ports a template match on the state string with the exported pools").
//
// The incident bed writes every log message from a catalog of template functions `(c, r) => [level, message]` (c a
// per-line context, r a seeded RNG) and then rewrites it per service: word-level synonyms (DIALECT, LEXICON) and one of
// five message styles. A solver sees a state (never a world, a seed, a template id or any meta) and the exported
// catalog (loaded by the caller from the frozen bed copy: this file imports no bed), and works the way
// beds/records/solve-text.mjs does for the records notes: it matches the state's messages against the catalog's templates.
//
// Compiling a template into a pattern is symbolic. The function runs with a context whose every field is a sentinel and
// an RNG whose `pick` returns an alternation marker and whose `int` returns a number that prints as a sentinel; it runs
// three times with different numeric probes, and whatever differs between the three renderings, and every sentinel,
// becomes a wildcard. What the template itself writes stays literal. The synonyms of DIALECT and LEXICON that a literal
// run contains become alternations, so a pattern matches a message whatever wording the service chose.
//
// What each pool is for is declared in POOL_ROLES (solve/incident-roles.mjs): the tags the bed emits lines of that
// pool under, read off the `emit` calls of beds/incident/gen.mjs. The solver combines both: a message is matched to
// patterns, the patterns name pools, the pools name tags, and the tags map to options through the contract's own tag
// table. A message that fits pools of different options is a collision (undecidable from the state); a message that
// fits no pool is unmatched. Neither is guessed.
const OPEN = '\u{E000}', CLOSE = '\u{E001}', ALT_OPEN = '\u{E003}', ALT_CLOSE = '\u{E004}';
const WILD = '\u{E002}', WILD_ANY = '\u{E007}', WILD_SVC = '\u{E008}';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- symbolic execution ----------------------------------------------------------------------------------------------
function sentinel(name, probe) {
  const text = `${OPEN}${name}${CLOSE}`;
  const f = function () { /* callable */ };
  return new Proxy(f, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) return hint => (hint === 'string' ? text : probe);
      if (prop === 'toString' || prop === 'valueOf') return () => text;
      if (prop === 'toUpperCase' || prop === 'toLowerCase' || prop === 'trim') return () => text;
      if (prop === 'replace' || prop === 'slice' || prop === 'concat') return () => text;
      if (typeof prop === 'symbol') return undefined;
      return sentinel(`${name}.${String(prop)}`, probe);
    },
    apply() { return sentinel(`${name}()`, probe); },
  });
}
const NUMERIC_PROBE = [11, 37, 53];
// flags and optional context fields that a few templates test (`c.sym ? ... : ...`, `c.dep || '...'`, `c.u0 ?? ...`)
const FLAGS = new Set(['sym', 'dep', 'u0']);
const context = (probe, falsy = false) => new Proxy({}, { get: (_, prop) => (typeof prop === 'symbol' ? undefined : falsy && FLAGS.has(String(prop)) ? undefined : sentinel(String(prop), NUMERIC_PROBE[probe])) });

function makeRng(alts, probe, branch) {
  let chanceNo = 0;
  return {
    int: (lo, hi) => [lo, Math.floor((lo + hi) / 2), hi][probe % 3],
    float: (lo, hi) => (lo + hi) / 2,
    next: () => 0.5,
    chance: () => branch[chanceNo++] ?? false,
    pick: list => {
      const id = alts.length;
      alts.push(list.map(x => String(x)));
      return new String(`${ALT_OPEN}${id}${ALT_CLOSE}`);
    },
    sample: (list, n) => list.slice(0, n), shuffle: list => [...list], normal: mu => mu, fork() { return makeRng(alts, probe, branch); },
  };
}
const asText = v => { try { return String(v).replace(/(?:undefined|NaN)+/g, `${OPEN}x${CLOSE}`); } catch { return ''; } };
const CHANCE_BRANCHES = [[false], [true]];
// numeric arguments of a template (a percentage, a minute count): three probes of different size, because a few templates
// branch on the value (`v >= 80 ? ' (warning threshold 80%)' : ''`); each set is rendered on its own
const ARG_SETS = [[30, 60, 90], [81, 88, 95], [3, 7, 12]];

// Render fn under three numeric probes and every branch of r.chance; returns [{level, texts: [3 strings], alts: [[...]x3]}]
function renderings(fn, nargs) {
  const src = fn.toString(), out = [], hasChance = /\bchance\b/.test(src), modes = /\b(?:sym|bad)\b|\|\||\?\?/.test(src) ? [false, true] : [false];
  for (const falsy of modes) for (const argSet of nargs ? ARG_SETS : [ARG_SETS[0]]) for (const branch of hasChance ? CHANCE_BRANCHES : [CHANCE_BRANCHES[0]]) {
    const texts = [], altLists = [], levels = [];
    let ok = true;
    for (const probe of [0, 1, 2]) {
      const alts = [];
      try {
        const args = Array.from({ length: nargs }, (_, i) => (falsy && i >= 1 ? false : sentinel(`arg${i}`, argSet[probe])));
        const res = fn(context(probe, falsy), makeRng(alts, probe, branch), ...args);
        const [level, msg] = Array.isArray(res) ? res : [null, res];
        levels.push(level); texts.push(asText(msg)); altLists.push(alts);
      } catch { ok = false; break; }
    }
    if (ok) out.push({ level: new Set(levels).size === 1 ? levels[0] : null, texts, alts: altLists[0] });
  }
  return out;
}

// ---- patterns -------------------------------------------------------------------------------------------------------------
const TOKEN = new RegExp(`${OPEN}[^${CLOSE}]*${CLOSE}|${ALT_OPEN}\\d+${ALT_CLOSE}|\\d+(?:\\.\\d+)?|[A-Za-z_]+|\\s+|[^\\sA-Za-z0-9_]`, 'gu');
// parts: array of literal strings, WILD, or {alt: [..]}
function partsOf(r) {
  const toks = r.texts.map(s => s.match(TOKEN) ?? []);
  const same = toks.every(t => t.length === toks[0].length);
  const parts = [];
  toks[0].forEach((tok, i) => {
    let p;
    if (tok === `${OPEN}svc${CLOSE}`) p = WILD_SVC;
    else if (/^\u{E000}(?:inner|fallback|what|phrase)\u{E001}$/u.test(tok)) p = WILD_ANY;
    else if (tok.startsWith(OPEN) || tok === 'NaN' || tok === 'undefined') p = WILD;
    else if (tok.startsWith(ALT_OPEN)) p = { alt: r.alts[Number(tok.slice(1, -1))] ?? [] };
    else if (!same) p = /^\d/.test(tok) ? WILD : tok;
    else p = toks.every(t => t[i] === tok) ? tok : WILD;
    if (p === WILD && parts.at(-1) === '-' && /^\d/.test(tok) && !/[A-Za-z0-9]$/.test(parts.at(-2) ?? ' ')) parts.pop();   // a negative number from arithmetic
    if ((p === WILD || p === WILD_ANY) && (parts.at(-1) === WILD || parts.at(-1) === WILD_ANY)) { if (p === WILD_ANY) parts[parts.length - 1] = WILD_ANY; return; }
    parts.push(p);
  });
  return parts;
}

// word-level synonyms in the bed's order: a service applies each entry [re, variants] once (one variant, every match),
// in order, so a variant can be rewritten again by a later entry ('connection pool' -> 'client pool' -> 'caller pool').
// closure(text) is every string a service can end up with; a run is cut at punctuation so that the sets stay small.
const globalOf = re => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
function closure(text, from, syn, memo, cap) {
  const key = `${from}\u0000${text}`;
  if (memo.has(key)) return memo.get(key);
  const out = new Set([text]);
  for (let j = from; j < syn.length && out.size <= cap; j++) {
    const g = syn[j].g;
    g.lastIndex = 0;
    if (!g.test(text)) continue;
    for (const v of syn[j].vars) {
      g.lastIndex = 0;
      for (const r of closure(text.replace(g, v), j + 1, syn, memo, cap)) { out.add(r); if (out.size > cap) break; }
    }
  }
  memo.set(key, out);
  return out;
}
function applySynonyms(run, syn) {
  const entries = syn.map(([re, vars]) => ({ g: globalOf(re), vars }));
  // spans of every entry's matches in the run, merged where they overlap: each merged span is closed on its own
  const spans = [];
  for (const e of entries) { e.g.lastIndex = 0; for (const m of run.matchAll(e.g)) if (m[0].length) spans.push([m.index, m.index + m[0].length]); }
  spans.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged = [];
  for (const sp of spans) { const last = merged.at(-1); if (last && sp[0] < last[1]) last[1] = Math.max(last[1], sp[1]); else merged.push([...sp]); }
  const memo = new Map();
  let out = '', at = 0;
  for (const [i, j] of merged) {
    out += esc(run.slice(at, i));
    const set = closure(run.slice(i, j), 0, entries, memo, 600);
    const list = [...set].sort((x, y) => y.length - x.length || (x < y ? -1 : 1));
    out += list.length === 1 ? esc(list[0]) : `(?:${list.map(esc).join('|')})`;
    at = j;
  }
  return out + esc(run.slice(at));
}
// a context value is at most a few tokens (a name, a route, a provider, a pool); only a relayed error body (`inner`) is free text
const ATOM = '\\S*[^\\s:;]';
const TOKENS_RE = `${ATOM}(?: ${ATOM}){0,3}?`;
function altSource(list, syn) {
  const entries = syn.map(([re, vars]) => ({ g: globalOf(re), vars })), memo = new Map(), all = new Set();
  for (const a of list) for (const r of closure(String(a), 0, entries, memo, 200)) all.add(r);
  return [...all].sort((x, y) => y.length - x.length || (x < y ? -1 : 1)).map(esc).join('|');
}
export function regexOfParts(parts, syn) {
  let src = '', run = '', svcSeen = false;
  const flush = () => { if (run) { src += applySynonyms(run, syn); run = ''; } };
  for (const p of parts) {
    if (p === WILD) { flush(); src += TOKENS_RE; }
    else if (p === WILD_ANY) { flush(); src += '.+?'; }
    else if (p === WILD_SVC) { flush(); src += svcSeen ? '\\k<svc>' : '(?<svc>\\S+)'; svcSeen = true; }
    else if (typeof p === 'object') { flush(); src += `(?:${altSource(p.alt, syn) || '.+?'})`; }
    else run += p;
  }
  flush();
  return new RegExp(`^${src.replace(/(?:\\ |\s)+/g, '\\s+')}$`, 'i');
}
const literalLength = parts => parts.reduce((a, p) => a + (typeof p === 'string' && p !== WILD && p !== WILD_ANY && p !== WILD_SVC ? p.replace(/\s+/g, '').length : 0), 0);

// ---- the catalog -------------------------------------------------------------------------------------------------------------
const SKIP = new Set(['ROLES', 'ROLE', 'COMPANIES', 'TEAMS', 'ONCALL', 'EXTERNALS', 'DATA_OPS', 'CLASS_SUMMARY', 'SIBLING_CLASS', 'FAULT_CLASSES', 'NOTES', 'NOTES_MORE', 'NOTE_DATED', 'NOTE_MIXED',
  'SHADOW_NOTE', 'DESCRIBE', 'DIALECT', 'LEXICON', 'STATS_FORM', 'WRAPPABLE', 'PARTNER_HOSTS', 'STRAY_NAMES', 'WRITERS', 'hexs', 'rid', 'LOOKALIKE_GEN', 'STRAY_GEN', 'LOOK_HEAD', 'LOOK_TAIL', 'LOOK_TAIL_ANY']);
// every template function of the catalog with its pool path, e.g. { pool: 'FAULTS.disk_full.onset', index: 2, fn }
export function poolEntries(C) {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === 'function') out.push({ pool: path.join('.'), index: 0, fn: v });
    else if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'function') out.push({ pool: path.join('.'), index: i, fn: x }); else if (x && typeof x.make === 'function') out.push({ pool: path.join('.'), index: i, fn: x.make }); });
    else if (v && typeof v === 'object' && !(v instanceof RegExp) && !(v instanceof Set)) for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  for (const [name, v] of Object.entries(C)) { if (SKIP.has(name)) continue; walk(v, [name]); }
  // composed benign lookalikes (LOOKALIKE_GEN): head + tail, drawn independently
  for (const cls of C.FAULT_CLASSES) {
    let n = 0;
    for (const h of C.LOOK_HEAD?.[cls] ?? []) for (const t of [...(C.LOOK_TAIL_ANY ?? []), ...(C.LOOK_TAIL?.[cls] ?? [])]) {
      out.push({ pool: `LOOKALIKE_GEN.${cls}`, index: n++, fn: (c, r) => [cls === 'bad_config_deploy' || cls === 'poisoned_cache' ? 'INFO' : 'WARN', `${h(c, r)}${t(c, r)}`] });
    }
  }
  return out;
}

const INDEX_MEMO = new WeakMap();
// compileCatalog(C) -> { patterns: [{pool, index, level, parts, re, lit}], syn }; memoised per catalog namespace
export function compileCatalog(C) {
  if (INDEX_MEMO.has(C)) return INDEX_MEMO.get(C);
  const syn = [...(C.DIALECT ?? []), ...(C.LEXICON ?? [])];
  const patterns = [];
  for (const e of poolEntries(C)) {
    const nargs = Math.max(0, e.fn.length - 2);
    for (const r of renderings(e.fn, Math.max(nargs, 1))) {
      let parts = partsOf(r);
      // in the claims a log line makes (MISLEAD, NOTICE, INJECT) `svc` is the service it names, not the one that writes it
      if (/^(?:MISLEAD|NOTICE|INJECT)$/.test(e.pool)) parts = parts.map(x => (x === WILD_SVC ? WILD : x));
      // an all-wildcard pattern says nothing
      if (literalLength(parts) < 6) continue;
      patterns.push({ pool: e.pool, index: e.index, level: r.level, parts, lit: literalLength(parts), svc: parts.includes(WILD_SVC) });
    }
  }
  for (const p of patterns) p.re = regexOfParts(p.parts, syn);
  const out = Object.freeze({ patterns, syn });
  INDEX_MEMO.set(C, out);
  return out;
}

// all patterns that match a message (the bed's own wrapper already removed), as [{pool, index, lit}] sorted by literal length
// `service` (optional) is the name the state gives the emitting service: a pattern that writes the service's own name
// (`${c.svc} (pid ...)`) only matches a message that writes that name there
export function matchMessage(index, message, service = null) {
  const hits = [];
  for (const p of index.patterns) {
    const m = p.re.exec(message);
    if (!m) continue;
    if (p.svc && service && m.groups?.svc !== service) continue;
    hits.push({ pool: p.pool, index: p.index, lit: p.lit });
  }
  return hits.sort((a, b) => b.lit - a.lit || (a.pool < b.pool ? -1 : 1));
}

// ---- lines written by gen.mjs itself (not by a catalog template) --------------------------------------------------------------
// reqText formats of a service (three), with the optional `upstream=<ref>` of a gateway-style request line.
const REQ_FORMS = [
  /^handled ([A-Z]+ \S+) status=(\d+) dur=(\d+)ms(?: note=(.+?))?(?: upstream=(\S+))?$/,
  /^([A-Z]+ \S+) -> (\d+) \((\d+) ms\)(?: \[(.+?)\])?(?: upstream=(\S+))?$/,
  /^([A-Z]+ \S+) (\d+) (\d+)ms(?: (?!upstream=)(.+?))?(?: upstream=(\S+))?$/,
];
export function parseRequest(message) {
  for (const re of REQ_FORMS) {
    const m = re.exec(message);
    if (m) return { route: m[1], status: Number(m[2]), ms: Number(m[3]), note: m[4] ?? '', upstream: m[5] ?? null };
  }
  return null;
}
const NORMAL_STATUS = new Set([200, 201, 400, 401, 404]);
const INLINE = [
  ['GEN.callOk', ['call ', WILD, ' ', WILD, ' -> ok ', WILD, 'ms']],
  ['GEN.callExt', ['call ', WILD, ' ', WILD, ' -> 200 ', WILD, 'ms']],
  ['GEN.ntp', ['ntp offset ', WILD, 'ms']],
  ['GEN.tlsClose', ['connection from ', WILD, ' closed during TLS handshake']],
  ['GEN.tlsEof', ['handshake error from ', WILD, ': EOF']],
];
const INLINE_MEMO = new WeakMap();
function inlineIndex(index) {
  if (!INLINE_MEMO.has(index)) INLINE_MEMO.set(index, INLINE.map(([pool, parts]) => ({ pool, re: regexOfParts(parts, index.syn), lit: literalLength(parts) })));
  return INLINE_MEMO.get(index);
}
const NOTE_MEMO = new Map();
const noteRe = (index, note) => {
  if (!NOTE_MEMO.has(note)) NOTE_MEMO.set(note, regexOfParts(note.split('NEWVER').flatMap((x, i) => (i ? [WILD, x] : [x])), index.syn));
  return NOTE_MEMO.get(note);
};

// every pool a message can come from: catalog patterns, the request-line forms and their status/latency/note rules
// (FAULTS.<class>.rootReq), and gen.mjs's few inline lines. Sorted by specificity.
export function poolsOfMessage(index, C, message, service = null) {
  const hits = matchMessage(index, message, service);
  for (const e of inlineIndex(index)) if (e.re.test(message)) hits.push({ pool: e.pool, index: 0, lit: e.lit + 1000 });
  const q = parseRequest(message);
  if (q) {
    if (!q.note && !q.upstream && NORMAL_STATUS.has(q.status) && q.ms >= 3 && q.ms <= 300) hits.push({ pool: 'GEN.requestOk', index: 0, lit: 2000 });
    else if (q.upstream && NORMAL_STATUS.has(q.status) && !q.note) hits.push({ pool: 'GEN.requestOk', index: 0, lit: 2000 });
    if (!q.upstream) {
      for (const cls of C.FAULT_CLASSES) for (const [, status, lo, hi, note] of C.FAULTS[cls].rootReq ?? []) {
        if (status === q.status && status !== 0 && q.ms >= lo && q.ms <= hi && (note === '' ? q.note === '' : noteRe(index, note).test(q.note))) hits.push({ pool: `FAULTS.${cls}.rootReq`, index: 0, lit: 2000 });
      }
    }
  }
  return hits.sort((a, b) => b.lit - a.lit || (a.pool < b.pool ? -1 : 1));
}

// ---- solver context and the two decisions ---------------------------------------------------------------------------------
import { tagsOfPool, CLASSES } from './incident-roles.mjs';

// makeSolverContext(C, labelTags): C is the bed's catalog namespace (loaded from the frozen copy by the caller); labelTags
// is the I2 contract's tag table (spec/ports.json ports.I2.labelMap.tags: tag -> option, or null for an excluded tag)
export function makeSolverContext(C, labelTags) {
  return { C, index: compileCatalog(C), labelTags, cache: new Map() };
}

// "<ts> <source> <body>" as the kit renders a line -> { ts, source, level, message }
export function splitLine(text) {
  const m = /^(\S+) (\S+) (.*)$/s.exec(text);
  if (!m) return null;
  return { ts: m[1], source: m[2], ...parseBodyOf(m[3]) };
}
// the bed's five message styles (judges/incident.mjs parseBody, repeated here so that a solver imports only the catalog)
const unesc = s => s.replace(/\\(["\\])/g, '$1');
function parseBodyOf(body) {
  let m;
  if ((m = /^(DEBUG|INFO|WARN|ERROR) (.*)$/s.exec(body))) return { level: m[1], message: m[2] };
  if ((m = /^\[(DEBUG|INFO|WARN|ERROR)\] (.*)$/s.exec(body))) return { level: m[1], message: m[2] };
  if ((m = /^level=(debug|info|warn|error) msg="(.*)"$/s.exec(body))) return { level: m[1].toUpperCase(), message: unesc(m[2]) };
  if ((m = /^\{"[a-z_]+":"([^"]*)","[a-z_]+":"(.*)"\}$/s.exec(body))) return { level: m[1].toUpperCase(), message: unesc(m[2]) };
  if ((m = /^([DIWE]): (.*)$/s.exec(body))) return { level: m[1], message: m[2] };
  return { level: null, message: body };
}

// pools of a message (top matches only: within 3 literal characters of the best)
export function topPools(sc, message, service = null) {
  const key = `${service}\u0000${message}`;
  if (sc.cache.has(key)) return sc.cache.get(key);
  const hits = poolsOfMessage(sc.index, sc.C, message, service);
  const top = hits.length ? hits.filter(h => h.lit >= hits[0].lit - 3) : [];
  const pools = [...new Set(top.map(h => h.pool))];
  if (sc.cache.size > 20000) sc.cache.clear();
  sc.cache.set(key, pools);
  return pools;
}
// the I2 options a set of pools can produce: tags -> option through the contract's table; excluded tags are skipped
export function labelsOfPools(sc, pools) {
  const labels = new Set(), excluded = new Set(), unknown = [];
  for (const pool of pools) {
    const tags = tagsOfPool(pool);
    if (!tags) { unknown.push(pool); continue; }
    for (const t of tags) {
      if (!(t in sc.labelTags)) { unknown.push(`tag:${t}`); continue; }
      if (sc.labelTags[t] === null) excluded.add(t); else labels.add(sc.labelTags[t]);
    }
  }
  return { labels, excluded, unknown };
}
// the fault class a pool is evidence for (the class of the incident it is emitted in), or null
export function classOfPool(pool) {
  if (/^(?:CANARY|CANARY_NOVER|PROMOTE)$/.test(pool)) return 'bad_config_deploy';
  for (const c of CLASSES) if (new RegExp(`(?:^|\\.)${c}(?:\\.|$)`).test(pool)) return c;
  return null;
}
const ORIGIN_ONLY = new Set(['onset', 'root', 'precursor', 'shadow']);
// is a pool evidence of its class? Its lines are emitted only under origin tags (shadow replicas aside)
export const isEvidencePool = pool => { const t = tagsOfPool(pool); return Boolean(t) && t.every(x => ORIGIN_ONLY.has(x)) && t.some(x => x !== 'shadow') && classOfPool(pool) !== null; };

// ---- the notes of the service map (X5, X4, X2, X7 and the context filter) ----------------------------------------------------
// Every note of the system document is written from a template of NOTES, NOTES_MORE, NOTE_MIXED, NOTE_DATED or SHADOW_NOTE
// with the services' names (or what they provide) filled in. Compiled the same way as the messages: the arguments are
// sentinels, the result a regex whose named groups `from`, `to` and `to2` capture the services it speaks of.
const NOTE_SOURCES = [
  ['added', C => C.NOTES.added, 2], ['stale', C => C.NOTES.stale, 2], ['optional', C => [...C.NOTES.optional, ...C.NOTES_MORE.optional], 2],
  ['hard', C => [...C.NOTES.hard, ...C.NOTES_MORE.hard], 2], ['provider', C => [...C.NOTES.provider, ...C.NOTES_MORE.provider], 2],
  ['alias', C => C.NOTES.alias, 2], ['legacySource', C => C.NOTES.legacySource, 2], ['mixed', C => C.NOTE_MIXED, 3],
  ['dated-hardThen', C => C.NOTE_DATED.hardThen, 2], ['dated-softNow', C => C.NOTE_DATED.softNow, 2], ['dated-softThen', C => C.NOTE_DATED.softThen, 2], ['dated-hardNow', C => C.NOTE_DATED.hardNow, 2],
  ['shadow', C => C.SHADOW_NOTE, 2],
];
const NOTE_MEMO2 = new WeakMap();
export function compileNotes(C) {
  if (NOTE_MEMO2.has(C)) return NOTE_MEMO2.get(C);
  const patterns = [];
  const names = ['from', 'to', 'to2'];
  for (const [kind, pool, arity] of NOTE_SOURCES) for (const fn of pool(C)) {
    const mk = (extra = {}) => new Proxy({}, { get: (_, p) => (p in extra ? extra[p] : typeof p === 'symbol' ? undefined : `${OPEN}${String(p)}${CLOSE}`) });
    let text;
    try { text = String(fn(`${OPEN}from${CLOSE}`, `${OPEN}to${CLOSE}`, ...(arity === 3 ? [`${OPEN}to2${CLOSE}`] : []), mk())); } catch { continue; }
    // a month name in the template is literal; the month slots are sentinels (m1, m2, month): wildcards
    let src = '', at = 0;
    const seen = new Set();
    for (const m of text.matchAll(new RegExp(`${OPEN}([^${CLOSE}]*)${CLOSE}`, 'gu'))) {
      src += esc(text.slice(at, m.index));
      const n = m[1];
      src += names.includes(n) && !seen.has(n) ? `(?<${n}>.+?)` : names.includes(n) ? `\\k<${n}>` : '.+?';
      seen.add(n); at = m.index + m[0].length;
    }
    src += esc(text.slice(at));
    patterns.push({ kind, re: new RegExp(`^${src.replace(/(?:\\ |\s)+/g, '\\s+')}$`, 'i'), lit: text.replace(new RegExp(`${OPEN}[^${CLOSE}]*${CLOSE}`, 'gu'), '').length });
  }
  const out = Object.freeze({ patterns });
  NOTE_MEMO2.set(C, out);
  return out;
}
// kind of a note, and the services (as written) it names: { kind, from, to, to2 } or { kind: 'unknown' }
export function classifyNote(index, note) {
  let best = null;
  for (const p of index.patterns) { const m = p.re.exec(note); if (m && (!best || p.lit > best.lit)) best = { kind: p.kind, lit: p.lit, ...(m.groups ?? {}) }; }
  if (!best) return /^Known issue:/.test(note) ? { kind: 'noisy' } : { kind: 'unknown' };
  const { lit, ...rest } = best;
  return rest;
}
