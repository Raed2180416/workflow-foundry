// Runtime-learned input profiles: "type feedback" for agent workloads (development code, research/jit-20261008).
//
// A JIT compiles a solver from the tasks its interpreter has solved. The solver's own guards are written by the
// compiler, and a heal can widen them (DEV-NOTES D9); a static solver has none at all (D5). A profile is a second,
// independent fence around the compiled domain: it is learned only from tasks the stream has accepted (the traces a
// version was compiled from), it is checked before a compiled run at $0 (no model call, no oracle, no solver code), and
// it should widen only when the solver's domain does: a recompile from a pool holding the task, or an independent check
// (an agreeing shadow) confirming the solver on it. Widening on every interpretation makes the profile follow the stream
// instead of the solver, and it then waves later drifted tasks through (eval-profiles.mjs, policy 'interp'). A novel task
// can be routed to the interpreter, or run compiled with a forced shadow, instead of trusting compiled code on inputs it
// never saw. Profiles see input shape, not meaning: a drift that only changes what the same-shaped text means is
// invisible here and is left to shadows, invariants and judge checks.
//
//   learnProfile(tasks)          -> profile   (tasks: task.json objects {prompt, inputs, files?}, or trace records {task})
//   checkProfile(profile, task, {ignore?}) -> {novel, score, reasons, near, n}
//   widenProfile(profile, task)  -> a new profile with the task merged (the input profile is not changed)
//
// Every feature is generic: nothing here knows a bed family. The task is walked as JSON (inputs and files; the prompt is
// handled as a skeleton). Paths name positions: `inputs.study.conditions[].ph`; a `files` object (and any object with
// more than PARAMS.mapKeys keys) is a map, whose values live at `<path>{}`.
//
// Features per path (all values pooled over the array elements at that path):
// - shape skeleton: which paths occur, in how many tasks, with which JSON types;
// - numbers: range with a margin, and whether every value was an integer;
// - arrays: element-count range with a margin;
// - strings: length range with a margin; for short single-line strings a pattern class (date-iso, phone, id, ...) and a
//   shape signature ("Ab9-9" style), and an enum value set while the path stays low-cardinality and repetitive;
//   for strings with >= PARAMS.linesMin non-empty lines a line-count range and a set of line-format signatures
//   ('LEDGR~semi:A¦9¦A¦A¦9.9¦...': the leading word, the field delimiter and a coarse class per field) and line families
//   ('LEDGR~semi:10': leading word, delimiter, field count); for strings with
//   >= PARAMS.proseMinWords words a vocabulary (lower-case-initial words of 3+ letters; capitalised words are names);
// - the prompt: sentence skeletons with numbers, quoted text and the task's own short input values masked.
//
// Set features (classes, shape signatures, line signatures, vocabulary, prompt sentences) are document-frequency maps
// (item -> number of tasks that contained it). A task's novelty rate on one is the share of its distinct items never
// seen before. Its threshold adapts to how much that path churns between same-distribution tasks, by the Good-Turing
// estimate of the chance that the next item is unseen: GT = (items seen in exactly one task) / (sum of document
// frequencies), threshold = clamp(k·GT + slack, min, max) (PARAMS.rate). A field whose content is new every task (names in
// an export) gets a loose threshold; a field that repeats (the line formats of a dialect) gets a tight one. With one
// training task GT = 1, so the threshold is the loose max: few tasks give a lenient profile, never a jumpy one.
//
// Thresholds and margins (PARAMS; rate, margins, enum and caps are recorded in the profile and a check uses the profile's
// own values; the observation constants (shortMax, linesMin, field limits ...) are fixed by the schema version):
// - number range: [min − m, max + m], m = max(span·numMargin.span, max(|min|,|max|)·numMargin.rel, 1e-9);
// - counts (array lengths, string lengths, line counts): m = max(countMargin.abs, ceil(span·countMargin.span),
//   ceil(max·countMargin.rel));
// - enum: a short-string path is an enum while it has <= enumMax distinct values, occurred in at least 2 tasks, and its
//   values recur across tasks (Good-Turing on the per-task value sets <= enumGT), so per-task names never become enums
//   even when they repeat inside one task; an unseen value of an enum is novel;
// - free text: a short-string path whose seen pattern classes are all lexical (word, words, sentence, other: names,
//   titles) is checked by type and enum only; pattern class, shape and length are checked on format paths (dates,
//   numbers, phones, ids, codes, ...) and length, lines and vocabulary on long strings. A lexical path that suddenly
//   carries a format class (a name field that now holds a date) is still novel;
// - a path present in every profiled task and absent now, a new path, or a new type at a path is novel;
// - a df map that reached its cap (PARAMS.caps) is no longer checked (it would over-report novelty).
// A reason's ratio is rate/threshold for set features and 1 + excess/margin (or 1 + unseen share) for hard ones; the
// task is novel when any ratio exceeds 1, and score is the largest ratio (0 when nothing was measured).
// Deterministic: no clock, no randomness, keys sorted; JSON-serialisable (no Maps or Sets inside a profile).

export const PROFILE_SCHEMA = 'jit-profile/1';
export const PARAMS = Object.freeze({
  shortMax: 80,          // a single-line string of at most this many chars is "short"
  enumMaxLen: 40,        // only strings this short are enum candidates
  enumMax: 12, enumGT: 0.2,
  linesMin: 3, proseMinWords: 12,
  mapKeys: 32,
  rate: Object.freeze({ k: 2, slack: 0.02, min: 0.05, max: 0.5 }),
  numMargin: Object.freeze({ span: 0.5, rel: 0.25 }),   // wide: a few tasks under-sample a range; this flags scale shifts
  countMargin: Object.freeze({ span: 0.25, rel: 0.15, abs: 1 }),
  caps: Object.freeze({ df: 20000, values: 64, promptValues: 200, examples: 4 }),
  fieldMax: 12, fieldsMax: 24, fieldLenMax: 32, fieldWordsMax: 3, headMax: 24, sentenceMax: 160,
});

// ------------------------------------------------------------------------------------------------ small helpers
const sortDeep = v => {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]));
  return v;
};
const r3 = x => Math.round(x * 1000) / 1000;
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const taskView = x => {
  const t = x && typeof x === 'object' && x.task && typeof x.task === 'object' && 'prompt' in x.task ? x.task : x;
  if (!t || typeof t !== 'object') throw new TypeError('profile: a task must be an object {prompt, inputs, files?}');
  return { prompt: typeof t.prompt === 'string' ? t.prompt : '', inputs: t.inputs ?? null, files: t.files ?? null };
};

// Shape of a value with letters -> A and digits -> 9; digit groups joined by . or , collapse to 9.9, spaced digit groups
// to '9 9', and letter words joined by spaces, hyphens or apostrophes to one A.
export function shapeOf(s) {
  return String(s).replace(/\p{L}+/gu, 'A').replace(/\d+/g, '9').replace(/9(?:[.,]9)+/g, '9.9').replace(/9(?: 9)+/g, '9 9')
    .replace(/A(?:[ '’-]+A)+/g, 'A').replace(/\s+/g, ' ').trim();
}

// Pattern class of a short string (generic formats only).
export function classOf(s) {
  const t = String(s).trim();
  if (!t) return 'empty';
  if (/^[+-]?\d+$/.test(t)) return 'int';
  if (/^[+-]?(\d+[.,]\d+|\d{1,3}([,.]\d{3})+([.,]\d+)?)$/.test(t)) return 'decimal';
  if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(t)) return 'sci';
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(t)) return t.length > 10 ? 'datetime-iso' : 'date-iso';
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(t)) return 'date-num';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return 'time';
  if (/^\+?[\d\s().-]{7,}$/.test(t) && (t.match(/\d/g) ?? []).length >= 7) return 'phone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'email';
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(t)) return 'url';
  if (/^\d{1,2}\s+\p{L}{3,9}\.?\s+\d{2,4}$/u.test(t) || /^\p{L}{3,9}\.?\s+\d{1,2},?\s+\d{2,4}$/u.test(t)) return 'date-text';
  if (/^[\p{Lu}\d]{1,6}$/u.test(t)) return 'code';
  if (!/\s/.test(t) && /\p{L}/u.test(t) && /\d/.test(t)) return 'id';
  if (/^[\p{L}'’-]+$/u.test(t)) return 'word';
  if (/^[\p{L}'’.-]+(\s+[\p{L}'’.-]+){1,5}$/u.test(t)) return 'words';
  if (/\p{L}/u.test(t) && t.split(/\s+/).length > 6) return 'sentence';
  return 'other';
}

const DELIMS = [['\t', 'tab'], [' | ', 'pipe'], ['|', 'pipe'], [' :: ', 'dcolon'], ['::', 'dcolon'], [';', 'semi'], [' — ', 'dash'], [' – ', 'dash'], [',', 'comma']];
const fieldClass = f => {
  const t = f.trim();
  if (!t) return '_';
  const label = /^([\p{L}_][\p{L}\d_ -]{0,19})\s*[=:]/u.exec(t);
  if (label) return `${label[1].trim()}=`;
  if (!/\p{L}/u.test(t)) return shapeOf(t).slice(0, PARAMS.fieldMax);
  return /\d/.test(t) ? 'A9' : 'A';
};
const jsonShape = (v, d = 0) => {
  if (Array.isArray(v)) return d > 2 ? '[]' : `[${v.length ? jsonShape(v[0], d + 1) : ''}]`;
  if (v && typeof v === 'object') return d > 2 ? '{}' : `{${Object.keys(v).sort().map(k => `${k}:${jsonShape(v[k], d + 1)}`).join(',')}}`;
  return typeOf(v)[0];
};
const tryJson = s => { try { return JSON.parse(s); } catch { return undefined; } };

// Line-format signature: the leading word (literal when it is letters only), then JSON key shape, or the field delimiter
// and a coarse class per field (a 'key=' label, '_' empty, A letters, A9 mixed, or the shape of a non-letter field), or
// '~text' for an undelimited line.
// lineFamily is the coarse form: the leading word, then 'json:<key count>', '<delimiter>:<field count>' or 'text'.
export function lineShape(line) {
  const t = line.trim();
  if (/^[[{]/.test(t)) {
    const v = tryJson(t);
    if (v !== undefined) return { sig: `json:${jsonShape(v)}`, family: `json:${v && typeof v === 'object' ? Object.keys(v).length : typeOf(v)}` };
  }
  const m = /^[^\s\p{P}\p{S}]+/u.exec(t);
  const tok = m ? m[0] : '';
  const head = /^\p{L}+$/u.test(tok) ? tok.slice(0, PARAMS.headMax) : shapeOf(tok || t.slice(0, 1));
  const rest = t.slice(tok.length).trim();
  if (rest.startsWith('{')) {
    const v = tryJson(rest);
    if (v !== undefined) return { sig: `${head}~json:${jsonShape(v)}`, family: `${head}~json:${v && typeof v === 'object' ? Object.keys(v).length : typeOf(v)}` };
  }
  // A delimiter counts when it occurs at least twice and the fields it cuts are short (median <= fieldLenMax chars and
  // <= fieldWordsMax words), so prose with commas or semicolons stays 'text' instead of splitting into a different field
  // count every line.
  const median = xs => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const d = DELIMS.find(([s]) => {
    const parts = t.split(s);
    if (parts.length < 3) return false;
    return median(parts.map(x => x.trim().length)) <= PARAMS.fieldLenMax && median(parts.map(x => x.trim().split(/\s+/).filter(Boolean).length)) <= PARAMS.fieldWordsMax;
  });
  if (!d) return { sig: `${head}~text`, family: `${head}~text` };
  const fields = t.split(d[0]).map(fieldClass);
  const shown = fields.slice(0, PARAMS.fieldsMax).join('¦');
  return { sig: `${head}~${d[1]}:${shown}${fields.length > PARAMS.fieldsMax ? `¦+${fields.length - PARAMS.fieldsMax}` : ''}`, family: `${head}~${d[1]}:${fields.length}` };
}
export const lineSig = line => lineShape(line).sig;

export const wordsOf = s => String(s).toLowerCase().match(/\p{L}{3,}/gu) ?? [];
// Vocabulary words: lower-case-initial words of 3+ letters. Capitalised words (names, places, products, sentence starts)
// are entity-like and change with every task, so they are left out of the vocabulary.
export const vocabOf = s => (String(s).match(/(?<![\p{L}\p{N}])\p{Ll}\p{L}{2,}/gu) ?? []).map(w => w.toLowerCase());
const linesOf = s => String(s).split(/\r?\n/).map(l => l.trim()).filter(Boolean);

// Prompt skeleton sentences: the task's own short input values (longest first), quoted text and numbers masked.
export function promptSentences(prompt, inputValues = []) {
  let s = String(prompt);
  for (const v of inputValues) if (v.length >= 3) s = s.split(v).join('‹v›');
  s = s.replace(/"[^"\n]{0,400}"|“[^”\n]{0,400}”|`[^`\n]{0,400}`|'[^'\n]{1,80}'/g, '‹q›').replace(/[+-]?\d+(?:[.,]\d+)*/g, '#');
  const out = [];
  for (const line of s.split(/\r?\n/)) for (const part of line.split(/(?<=[.!?])\s+/)) {
    const p = part.replace(/\s+/g, ' ').trim();
    if (p) out.push(p.length > PARAMS.sentenceMax ? `${p.slice(0, PARAMS.sentenceMax)}…` : p);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ observation
// One task's per-path aggregates (Sets inside; never stored as they are).
function observe(task) {
  const t = taskView(task);
  const paths = new Map(), shortValues = new Set();
  const at = p => {
    if (!paths.has(p)) paths.set(p, { types: new Set(), nums: [], ints: true, alens: [], slens: [], lineCounts: [], classes: new Set(), sigs: new Set(), values: new Map(), lineSigs: new Set(), lineFams: new Set(), vocab: new Set(), keys: new Set() });
    return paths.get(p);
  };
  const walk = (v, p, depth) => {
    const o = at(p), ty = typeOf(v);
    o.types.add(ty);
    if (depth > 12) return;
    if (ty === 'number') { if (Number.isFinite(v)) { o.nums.push(v); if (!Number.isInteger(v)) o.ints = false; } }
    else if (ty === 'string') {
      o.slens.push(v.length);
      const lines = linesOf(v);
      if (v.length <= PARAMS.shortMax && lines.length <= 1) {
        o.classes.add(classOf(v)); o.sigs.add(shapeOf(v).slice(0, 32));
        if (v.length <= PARAMS.enumMaxLen) o.values.set(v, (o.values.get(v) ?? 0) + 1);
        if (v.trim().length >= 3 && v.length <= 64) shortValues.add(v.trim());
      }
      if (lines.length >= PARAMS.linesMin) { o.lineCounts.push(lines.length); for (const l of lines) { const ls = lineShape(l); o.lineSigs.add(ls.sig); o.lineFams.add(ls.family); } }
      const words = wordsOf(v);
      if (words.length >= PARAMS.proseMinWords) for (const w of vocabOf(v)) o.vocab.add(w);
    } else if (ty === 'array') { o.alens.push(v.length); for (const x of v) walk(x, `${p}[]`, depth + 1); }
    else if (ty === 'object') {
      const keys = Object.keys(v);
      if (p === 'files' || keys.length > PARAMS.mapKeys) {
        o.types.delete('object'); o.types.add('map');
        o.alens.push(keys.length);
        for (const k of keys) { o.keys.add(shapeOf(k).slice(0, 32)); walk(v[k], `${p}{}`, depth + 1); }
      } else for (const k of keys) walk(v[k], p ? `${p}.${k}` : k, depth + 1);
    }
  };
  if (t.inputs !== null) walk(t.inputs, 'inputs', 0);
  if (t.files !== null) walk(t.files, 'files', 0);
  const values = [...shortValues].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, PARAMS.caps.promptValues);
  return { paths, prompt: new Set(promptSentences(t.prompt, values)) };
}

// ------------------------------------------------------------------------------------------------ df maps
const emptyDf = () => ({ df: {}, capped: false });
function addDf(m, items) {
  for (const it of items) {
    if (Object.hasOwn(m.df, it)) m.df[it]++;
    else if (Object.keys(m.df).length >= PARAMS.caps.df) m.capped = true;
    else m.df[it] = 1;
  }
}
// Good-Turing: the chance that the next (per-task distinct) item is one never seen before.
export function goodTuring(m) {
  let n1 = 0, n = 0;
  for (const c of Object.values(m.df)) { n += c; if (c === 1) n1++; }
  return n ? n1 / n : 1;
}
export function rateThreshold(m, rate = PARAMS.rate) {
  return Math.min(rate.max, Math.max(rate.min, rate.k * goodTuring(m) + rate.slack));
}
const range = xs => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null);
const mergeRange = (a, b) => (!a ? b : !b ? a : { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) });
const countMargin = (r, cm) => Math.max(cm.abs, Math.ceil((r.max - r.min) * cm.span), Math.ceil(r.max * cm.rel));
const numMargin = (r, nm) => Math.max((r.max - r.min) * nm.span, Math.max(Math.abs(r.min), Math.abs(r.max)) * nm.rel, 1e-9);

// ------------------------------------------------------------------------------------------------ public API
export function emptyProfile(params = PARAMS) {
  return { schema: PROFILE_SCHEMA, n: 0, params: sortDeep(JSON.parse(JSON.stringify(params))), prompt: emptyDf(), paths: {} };
}

export function widenProfile(profile, task) {
  const p = profile ? structuredClone(profile) : emptyProfile();
  if (p.schema !== PROFILE_SCHEMA) throw new Error(`profile: unsupported schema ${p.schema}`);
  const obs = observe(task);
  p.n += 1;
  addDf(p.prompt, obs.prompt);
  for (const [path, o] of obs.paths) {
    const s = p.paths[path] ??= { tasks: 0, types: {} };
    s.tasks += 1;
    for (const ty of o.types) s.types[ty] = (s.types[ty] ?? 0) + 1;
    if (o.nums.length) { s.num = mergeRange(s.num, range(o.nums)); s.int = (s.int ?? true) && o.ints; }
    if (o.alens.length) s.alen = mergeRange(s.alen, range(o.alens));
    if (o.slens.length) s.slen = mergeRange(s.slen, range(o.slens));
    if (o.lineCounts.length) s.lines = mergeRange(s.lines, range(o.lineCounts));
    for (const [k, set] of [['classes', o.classes], ['sigs', o.sigs], ['lineSigs', o.lineSigs], ['lineFams', o.lineFams], ['vocab', o.vocab], ['keys', o.keys]]) {
      if (!set.size) continue;
      s[k] ??= emptyDf(); addDf(s[k], set);
    }
    if (o.values.size) {
      if (!s.values) s.values = { df: {}, overflow: false };
      if (!s.values.overflow) {
        for (const v of o.values.keys()) s.values.df[v] = (s.values.df[v] ?? 0) + 1;
        if (Object.keys(s.values.df).length > PARAMS.caps.values) s.values = { df: {}, overflow: true };
      }
    }
  }
  return sortDeep(p);
}

export function learnProfile(tasks, params = PARAMS) {
  let p = emptyProfile(params);
  for (const t of tasks ?? []) p = widenProfile(p, t);
  return p;
}

const enumOf = (s, P) => {
  const v = s.values;
  if (!v || v.overflow) return null;
  const distinct = Object.keys(v.df).length;
  return distinct && distinct <= P.enumMax && s.tasks >= 2 && goodTuring(v) <= P.enumGT ? new Set(Object.keys(v.df)) : null;
};
// Pattern classes of free text (names, titles, labels); every other class carries a format.
export const LEXICAL = new Set(['word', 'words', 'sentence', 'other', 'empty']);
const isLexical = s => !!s.classes && Object.keys(s.classes.df).every(c => LEXICAL.has(c)) && !s.lines && !s.vocab;
const parentOf = path => { const m = /^(.*?)(\[\]|\{\}|\.[^.[\]{}]+)$/.exec(path); return m ? m[1] : null; };

// Size features (how much input, not what kind): an ablation can ignore them (checkProfile opts.ignore) to see what the
// content features alone detect.
export const SIZE_FEATURES = Object.freeze(['array-length', 'map-size', 'string-length', 'line-count']);

// opts.ignore: feature names left out of the verdict, the reasons, near and score.
export function checkProfile(profile, task, opts = {}) {
  const ignore = new Set(opts.ignore ?? []);
  if (!profile || profile.schema !== PROFILE_SCHEMA) throw new Error('checkProfile: not a profile');
  const P = { ...PARAMS, ...profile.params }, ex = P.caps?.examples ?? 4;
  const obs = observe(task), checks = [];
  if (!profile.n) return { novel: true, score: 2, reasons: [{ feature: 'empty-profile', path: null, ratio: 2 }], near: [], n: 0 };
  const setCheck = (feature, path, m, items) => {
    if (!m || m.capped || !items.size) return;
    const unseen = [...items].filter(it => !Object.hasOwn(m.df, it)), rate = unseen.length / items.size, threshold = rateThreshold(m, P.rate);
    checks.push({ feature, path, rate: r3(rate), threshold: r3(threshold), unseen: unseen.length, of: items.size, examples: unseen.slice(0, ex).map(x => String(x).slice(0, 80)), ratio: r3(rate / threshold) });
  };
  const rangeCheck = (feature, path, r, xs, margin) => {
    if (!r || !xs.length) return;
    const lo = Math.min(...xs), hi = Math.max(...xs), m = margin(r), excess = Math.max(0, r.min - m - lo, hi - (r.max + m));
    checks.push({ feature, path, observed: { min: lo, max: hi }, seen: r, margin: r3(m), ratio: excess > 0 ? r3(1 + excess / m) : r3(Math.max(0, Math.max(r.min - lo, hi - r.max)) / m) });
  };
  setCheck('prompt', null, profile.prompt, obs.prompt);
  for (const [path, o] of obs.paths) {
    const s = profile.paths[path];
    if (!s) {
      const parent = parentOf(path);
      if (!parent || profile.paths[parent]) checks.push({ feature: 'new-path', path, types: [...o.types].sort(), ratio: 2 });
      continue;
    }
    const newTypes = [...o.types].filter(ty => !s.types[ty]);
    if (newTypes.length) checks.push({ feature: 'type', path, unseen: newTypes.sort(), seen: Object.keys(s.types).sort(), ratio: 2 });
    rangeCheck('number-range', path, s.num, o.nums, r => numMargin(r, P.numMargin));
    if (s.int && o.nums.length && !o.ints) checks.push({ feature: 'non-integer', path, ratio: 2 });
    rangeCheck(o.types.has('map') ? 'map-size' : 'array-length', path, s.alen, o.alens, r => countMargin(r, P.countMargin));
    const lexical = isLexical(s);
    if (lexical) {
      const formats = [...o.classes].filter(c => !LEXICAL.has(c));
      if (formats.length) checks.push({ feature: 'pattern-class', path, unseen: formats.sort(), seen: Object.keys(s.classes.df).sort(), note: 'a free-text path now carries a format class', ratio: 2 });
    } else rangeCheck('string-length', path, s.slen, o.slens, r => countMargin(r, P.countMargin));
    rangeCheck('line-count', path, s.lines, o.lineCounts, r => countMargin(r, P.countMargin));
    if (!lexical) { setCheck('pattern-class', path, s.classes, o.classes); setCheck('shape', path, s.sigs, o.sigs); }
    setCheck('line-family', path, s.lineFams, o.lineFams);
    setCheck('line-format', path, s.lineSigs, o.lineSigs);
    setCheck('vocabulary', path, s.vocab, o.vocab);
    setCheck('map-keys', path, s.keys, o.keys);
    const en = enumOf(s, P);
    if (en && o.values.size) {
      const unseen = [...o.values.keys()].filter(v => !en.has(v));
      if (unseen.length) checks.push({ feature: 'enum', path, unseen: unseen.slice(0, ex), seen: [...en].sort().slice(0, 12), ratio: r3(1 + unseen.length / o.values.size) });
    }
  }
  // Paths every profiled task had, absent now (top-most only: the parent is present in this task).
  for (const [path, s] of Object.entries(profile.paths)) {
    if (s.tasks < profile.n || obs.paths.has(path)) continue;
    const parent = parentOf(path);
    if (!parent || obs.paths.has(parent)) checks.push({ feature: 'missing-path', path, ratio: 2 });
  }
  for (let i = checks.length - 1; i >= 0; i--) if (ignore.has(checks[i].feature)) checks.splice(i, 1);
  const order = (a, b) => b.ratio - a.ratio || String(a.feature).localeCompare(String(b.feature)) || String(a.path).localeCompare(String(b.path));
  const reasons = checks.filter(c => c.ratio > 1).sort(order);
  const near = checks.filter(c => c.ratio <= 1).sort(order).slice(0, 3);
  return { novel: reasons.length > 0, score: checks.length ? Math.max(...checks.map(c => c.ratio)) : 0, reasons, near, n: profile.n };
}

// A one-line-per-path summary (for CLIs and notes).
export function describeProfile(profile) {
  const L = [`profile ${profile.schema}: ${profile.n} task(s), prompt sentences ${Object.keys(profile.prompt.df).length} (threshold ${r3(rateThreshold(profile.prompt, profile.params.rate))})`];
  for (const [path, s] of Object.entries(profile.paths)) {
    const bits = [`types ${Object.keys(s.types).join('/')}`, `in ${s.tasks}/${profile.n}`];
    if (s.num) bits.push(`num ${s.num.min}..${s.num.max}${s.int ? ' int' : ''}`);
    if (s.alen) bits.push(`len ${s.alen.min}..${s.alen.max}`);
    if (s.lines) bits.push(`lines ${s.lines.min}..${s.lines.max}`);
    for (const k of ['classes', 'sigs', 'lineFams', 'lineSigs', 'vocab']) if (s[k]) bits.push(`${k} ${Object.keys(s[k].df).length} (thr ${r3(rateThreshold(s[k], profile.params.rate))}${s[k].capped ? ', capped' : ''})`);
    const en = enumOf(s, { ...PARAMS, ...profile.params });
    if (en) bits.push(`enum {${[...en].sort().join(', ')}}`);
    L.push(`  ${path}: ${bits.join('; ')}`);
  }
  return L.join('\n');
}
