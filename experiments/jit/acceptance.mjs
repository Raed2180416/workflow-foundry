// Compile acceptance (SPEC addendum 4, and JIT v2.1's opt-in strict rule). One implementation for compile.mjs (the first
// host check) and stream.mjs (a recheck), so the two verdicts cannot drift apart.
//
// 'named' (the default; byte-identical to the rule before v2.1): the host check is clean (every case ran, no crash, deopt or
// timeout, every regression case passes) and every diff case is named in BUILD-NOTES.md (\b<case id>\b).
//
// 'strict' (compile.acceptance 'strict', opt-in; DEV-NOTES D4: a kinetics solver at partial 0.546 was accepted because each
// disagreement was merely named):
//   1. clean, as above;
//   2. agreement: the mean partial agreement over the labelled trace cases >= minPartial (default 0.9), OR at least one
//      labelled trace case is exact. Trace cases only: regression cases must pass anyway, so counting them would let any
//      recompile with a regression pass this criterion for free. Partial and exact are measured under the check's
//      comparison (tolerant when compile.compare is 'tolerant', which strict acceptance is meant to run with);
//   3. explained: every diff case (trace or regression) is explained in BUILD-NOTES.md by a note block that names the case
//      and quotes, in double quotes (straight, curly or « »), or as a > blockquote, a passage of at least MIN_QUOTE_CHARS
//      characters that occurs verbatim, whitespace-normalised, in THAT case's task: prompt.md, inputs.json (its text and every
//      string inside it) or a task file. A trailing . , ; : may be dropped and a leading or trailing ellipsis is ignored;
//      nothing else is forgiven (case, wording, elisions). Verified by code, here.
// Note blocks: BUILD-NOTES.md split at blank lines, list items (a deeper-indented item stays with its parent), headings
// and table rows; a heading-only block joins the block after it, and a blockquote-only block joins the block before it.
// The result records which criterion passed or failed.
export const ACCEPTANCE_MODES = Object.freeze(['named', 'strict']);
export const DEFAULT_MIN_PARTIAL = 0.9;
export const MIN_QUOTE_CHARS = 12;

export function acceptanceModeOf(v) {
  const m = v ?? 'named';
  if (!ACCEPTANCE_MODES.includes(m)) throw new Error(`acceptance must be one of ${ACCEPTANCE_MODES.join(', ')}, got ${JSON.stringify(v)}`);
  return m;
}
export function minPartialOf(v) {
  const x = v ?? DEFAULT_MIN_PARTIAL;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) throw new Error(`minPartial must be a number in [0, 1], got ${JSON.stringify(v)}`);
  return x;
}

export const normWs = s => String(s).replace(/\s+/g, ' ').trim();
const mentions = (text, id) => new RegExp(`\\b${id}\\b`).test(text ?? '');

// The default rule: diff cases whose id does not occur in the notes.
export const namedUnexplained = (perCase, notes) => (perCase ?? []).filter(c => c.status === 'diff' && !mentions(notes, c.id)).map(c => c.id);

const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+/, HEADING = /^\s{0,3}#{1,6}\s/, TABLE = /^\s*\|/, QUOTE_LINE = /^\s*>/;
export function noteBlocks(notes) {
  const blocks = [];
  let cur = null;
  const flush = () => { if (cur?.lines.length) blocks.push(cur); cur = null; };
  for (const line of String(notes ?? '').split(/\r?\n/)) {
    if (!line.trim()) { flush(); continue; }
    const list = line.match(LIST);
    if (HEADING.test(line) || TABLE.test(line)) { flush(); blocks.push({ lines: [line], heading: HEADING.test(line) }); continue; }
    if (list) {
      const indent = list[1].length;
      if (cur?.listIndent != null && indent > cur.listIndent) { cur.lines.push(line); continue; }   // a sub-item stays with its parent
      flush(); cur = { lines: [line], listIndent: indent }; continue;
    }
    if (!cur) cur = { lines: [] };
    cur.lines.push(line);
  }
  flush();
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.heading && blocks[i + 1] && !blocks[i + 1].heading) { out.push([...b.lines, ...blocks[++i].lines].join('\n')); continue; }
    if (out.length && b.lines.every(l => QUOTE_LINE.test(l))) { out[out.length - 1] += '\n' + b.lines.join('\n'); continue; }
    out.push(b.lines.join('\n'));
  }
  return out;
}

export function quotesIn(block) {
  const out = [];
  for (const m of String(block).matchAll(/"([^"]+)"|“([^”]+)”|«([^»]+)»/g)) out.push(normWs(m[1] ?? m[2] ?? m[3]));
  // Consecutive > lines form one quote.
  let run = [];
  const end = () => { if (run.length) out.push(normWs(run.join(' '))); run = []; };
  for (const l of String(block).split('\n')) { if (QUOTE_LINE.test(l)) run.push(l.replace(/^\s*>\s?/, '')); else end(); }
  end();
  return out.filter(Boolean);
}

// The text a quote may come from: the task as the solver receives it.
export function taskTexts(task) {
  if (!task) return [];
  const strings = [];
  const walk = v => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x); };
  walk(task.inputs);
  return [String(task.prompt ?? ''), JSON.stringify(task.inputs ?? {}, null, 1), ...strings, ...Object.values(task.files ?? {}).map(String)].map(normWs).filter(Boolean);
}

export function quoteOccurs(quote, texts, { minQuoteChars = MIN_QUOTE_CHARS } = {}) {
  let q = normWs(quote).replace(/^(?:\.\.\.|…)\s*/, '').replace(/\s*(?:\.\.\.|…)$/, '');
  if (q.length < minQuoteChars) return false;
  if (texts.some(t => t.includes(q))) return true;
  const trimmed = q.replace(/[.,;:]$/, '');
  return trimmed !== q && trimmed.length >= minQuoteChars && texts.some(t => t.includes(trimmed));
}

// One diff case: is it explained by a verbatim quote from its own task?
export function explainCase(id, notes, task, opts = {}) {
  const blocks = noteBlocks(notes).filter(b => mentions(b, id));
  const quotes = [...new Set(blocks.flatMap(quotesIn))];
  const texts = taskTexts(task);
  const verified = quotes.find(q => quoteOccurs(q, texts, opts)) ?? null;
  const reason = verified ? null : !task ? 'no task text for this case' : !blocks.length ? 'not named in BUILD-NOTES.md' : !quotes.length ? 'named, but nothing quoted'
    : 'no quote occurs verbatim in this case\'s prompt or inputs';
  return { id, mentioned: blocks.length > 0, quotes: quotes.slice(0, 5).map(q => (q.length > 200 ? q.slice(0, 199) + '…' : q)), verified, ok: !!verified, reason };
}

// The verdict. summary: check-traces' aggregate (perCase with id, kind, status, partial). tasks: { [case id]: task }.
// Returns { unexplained, accepted } and, for 'strict', acceptance: the criteria and which passed or failed.
export function judgeAcceptance({ summary, notes, mode = 'named', minPartial, tasks = {}, minQuoteChars = MIN_QUOTE_CHARS }) {
  mode = acceptanceModeOf(mode);
  const perCase = summary?.perCase ?? [], clean = !!summary?.clean;
  if (mode === 'named') { const unexplained = namedUnexplained(perCase, notes); return { unexplained, accepted: clean && unexplained.length === 0 }; }
  minPartial = minPartialOf(minPartial);
  const traces = perCase.filter(c => c.kind === 'trace' && c.status !== 'unlabeled');
  const partial = traces.length ? Math.round((traces.reduce((s, c) => s + (c.partial ?? 0), 0) / traces.length) * 1000) / 1000 : null;
  const exactTraces = traces.filter(c => c.status === 'exact').length;
  const partialOk = partial != null && partial >= minPartial, exactOk = exactTraces >= 1;
  const cases = perCase.filter(c => c.status === 'diff').map(c => explainCase(c.id, notes, tasks[c.id], { minQuoteChars }));
  const unexplained = cases.filter(c => !c.ok).map(c => c.id);
  const criteria = {
    clean: { ok: clean },
    agreement: { ok: partialOk || exactOk, partial, minPartial, partialOk, exactTraces, labelledTraces: traces.length, exactOk },
    explained: { ok: unexplained.length === 0, cases },
  };
  const passed = Object.keys(criteria).filter(k => criteria[k].ok), failed = Object.keys(criteria).filter(k => !criteria[k].ok);
  return { unexplained, accepted: failed.length === 0,
    acceptance: { mode, compare: summary?.compare?.mode ?? 'canonical', minQuoteChars, criteria, passed, failed } };
}

// Case id -> task, as check-traces numbers them: regressions/case-<i>, traces/trace-<i>.
export const caseTasks = (traces = [], regressions = []) => ({
  ...Object.fromEntries(traces.map((t, i) => [`trace-${i}`, t?.task ?? null])),
  ...Object.fromEntries(regressions.map((r, i) => [`case-${i}`, r?.task ?? null])),
});
