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
//      characters and MIN_QUOTE_WORDS words (with letters) that occurs verbatim, whitespace-normalised, in THAT case's task:
//      prompt.md, a string inside inputs.json, or a task file (not the serialised JSON text, whose syntax fragments would
//      otherwise count). A trailing . , ; : may be dropped and a leading or trailing ellipsis is ignored; nothing else is
//      forgiven (case, wording, elisions). Two more rules stop one sentence from explaining everything:
//      - shared text does not count: a quote that also occurs in the task of every other case (the family's boilerplate,
//        e.g. the records prompt is the same for every seed) explains no case, when there is any other case;
//      - one quote per case: each diff case needs its own verified quote, distinct from the quotes credited to the other
//        diff cases (a maximum bipartite matching of cases to their verified quotes).
//      Verified by code, here.
// Case ids in the notes (S0-6; compile.acceptanceIds, opt-in, applies to both rules):
//   'exact' (the default; unchanged): the literal, case-sensitive \b<case id>\b, as check-traces writes it.
//   'lenient': case-insensitive ids plus id lists and ranges: "Trace-0, 2, 4", "traces 1–3", "trace-1 to trace-3",
//     "case-0 and 2". Motivating case, dossier 5 N3 (n = 1): a clean O/H v2 Haiku compile that matched 4/5 traces was
//     rejected because its notes wrote "Trace-0, 2, 4 differ by ≤1e-5" and \btrace-2\b is case-sensitive; the Opus
//     fallback followed ($3.51 for that idx). A bare singular "case 3" is not read as case-3 ("in this case 3 rows");
//     "case-3", "case #3" and "cases 3, 4" are.
//   'structured': verdicts.json, which the compiler writes beside BUILD-NOTES.md: an array of
//     {case, verdict: 'agree' | 'disagree' | 'unsure', reason}, one per diff case. The verdict is the compiler's view of
//     the agent's answer for that case: 'disagree' (the solver is right to differ, for reason) explains the case; 'agree'
//     (the agent is right: a solver defect) and 'unsure' do not. Under 'strict' the reason is the case's note: its quotes
//     must pass every rule above. Read only when the file exists; without it the prose rule runs with 'exact' ids.
//     A file that is present but not an array explains no case. (Its builder prompt text is prompts-verdicts.mjs.)
// allowSharedExplanation (strict only, default false): a verbatim quote that occurs in every other case's task (the SOP
// boilerplate) may explain a case. Motivating case, the same N3 compile: its one real disagreement (trace-3) was argued
// from a quoted SOP sentence, which every kinetics task shares, so the shared-text rule would reject it even with the id
// fixed. One distinct quote per case still applies, so one SOP sentence cannot explain two cases.
// Note blocks: BUILD-NOTES.md split at blank lines, list items (a deeper-indented item stays with its parent), headings
// and table rows; a heading-only block joins the block after it, and a blockquote-only block joins the block before it.
// The result records which criterion passed or failed.
export const ACCEPTANCE_MODES = Object.freeze(['named', 'strict']);
export const ACCEPTANCE_IDS = Object.freeze(['exact', 'lenient', 'structured']);
export const VERDICTS = Object.freeze(['agree', 'disagree', 'unsure']);
export const VERDICTS_FILE = 'verdicts.json';
export const DEFAULT_MIN_PARTIAL = 0.9;
export const MIN_QUOTE_CHARS = 12;
export const MIN_QUOTE_WORDS = 3;

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

export function acceptanceIdsOf(v) {
  const m = v ?? 'exact';
  if (!ACCEPTANCE_IDS.includes(m)) throw new Error(`acceptanceIds must be one of ${ACCEPTANCE_IDS.join(', ')}, got ${JSON.stringify(v)}`);
  return m;
}

export const normWs = s => String(s).replace(/\s+/g, ' ').trim();

// 'lenient' ids: every trace-<n> / case-<n> a text names, lower-cased, with lists and ranges expanded.
const PREFIX = /\b(trace|case)(s?)(\s*[-_#:]?\s*)(?=\d)/giy, NUM = /(\d+)(?![\d.]*\d)/y, MAX_RANGE = 1000;
const RANGE_SEP = /\s*(?:\.\.|[-–—]|\bto\b)\s*(?:(?:trace|case)s?\s*[-_#]?\s*)?(?=\d)/iy;
const LIST_SEP = /\s*(?:,|&|\/|\band\b|\bor\b)\s*(?:(trace|case)(s?)(\s*[-_#:]?\s*))?(?=\d)/iy;
const at = (re, text, i) => { re.lastIndex = i; return re.exec(text); };
export function idsIn(text) {
  const t = String(text ?? ''), out = new Set();
  const okPrefix = (word, plural, sep) => word.toLowerCase() === 'trace' || plural || /[-_#]/.test(sep);
  for (let i = 0; i < t.length; i++) {
    if (!/[tc]/i.test(t[i])) continue;
    const p = at(PREFIX, t, i);
    if (!p || !okPrefix(p[1], p[2], p[3])) continue;
    let kind = p[1].toLowerCase(), j = PREFIX.lastIndex;
    for (;;) {
      const a = at(NUM, t, j); if (!a) break;
      let lo = Number(a[1]), hi = lo; j = NUM.lastIndex;
      const r = at(RANGE_SEP, t, j), b = r ? at(NUM, t, RANGE_SEP.lastIndex) : null;
      if (b) { hi = Number(b[1]); j = NUM.lastIndex; }
      if (hi >= lo && hi - lo <= MAX_RANGE) for (let n = lo; n <= hi; n++) out.add(`${kind}-${n}`); else { out.add(`${kind}-${lo}`); out.add(`${kind}-${hi}`); }
      const l = at(LIST_SEP, t, j);
      if (!l) break;
      if (l[1] && !okPrefix(l[1], l[2], l[3])) break;
      if (l[1]) kind = l[1].toLowerCase();
      j = LIST_SEP.lastIndex;
    }
    i = Math.max(i, j - 1);
  }
  return out;
}
const mentions = (text, id, ids = 'exact') => ids === 'lenient' ? idsIn(text).has(String(id).toLowerCase()) : new RegExp(`\\b${id}\\b`).test(text ?? '');

// The default rule: diff cases whose id does not occur in the notes.
export const namedUnexplained = (perCase, notes, ids = 'exact') => (perCase ?? []).filter(c => c.status === 'diff' && !mentions(notes, c.id, ids)).map(c => c.id);

// verdicts.json (acceptanceIds 'structured'). raw: the parsed file, undefined/null when there is none, or
// {unreadable: message}. Returns null (no file: fall back to prose) or {valid, error?, byCase: Map(case -> entry|{duplicate}), malformed}.
export function parseVerdicts(raw) {
  if (raw == null) return null;
  if (raw?.unreadable) return { valid: false, error: `verdicts.json is unreadable: ${raw.unreadable}`, byCase: new Map(), malformed: 0 };
  if (!Array.isArray(raw)) return { valid: false, error: 'verdicts.json is not an array of {case, verdict, reason}', byCase: new Map(), malformed: 0 };
  const byCase = new Map();
  let malformed = 0;
  for (const v of raw) {
    if (!v || typeof v !== 'object' || typeof v.case !== 'string' || !VERDICTS.includes(v.verdict) || typeof v.reason !== 'string') { malformed++; continue; }
    const id = v.case.trim().toLowerCase();
    byCase.set(id, byCase.has(id) ? { duplicate: true } : { verdict: v.verdict, reason: v.reason });
  }
  return { valid: true, byCase, malformed };
}
// The file a compile leaves beside BUILD-NOTES.md, as parseVerdicts takes it: undefined when absent.
export async function readVerdicts(dir) {
  const { existsSync, readFileSync } = await import('node:fs'), file = (await import('node:path')).join(dir, VERDICTS_FILE);
  if (!existsSync(file)) return undefined;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { unreadable: String(e.message).slice(0, 200) }; }
}
// Why a structured verdict does not explain its case (null when it does, i.e. 'disagree' with a reason).
function verdictProblem(parsed, id) {
  if (!parsed.valid) return parsed.error;
  const v = parsed.byCase.get(String(id).toLowerCase());
  if (!v) return 'no verdict for this case in verdicts.json';
  if (v.duplicate) return 'more than one verdict for this case in verdicts.json';
  if (v.verdict === 'agree') return 'verdict agree: the compiler agrees with the agent answer (a solver defect, not an explained disagreement)';
  if (v.verdict === 'unsure') return 'verdict unsure';
  if (!normWs(v.reason)) return 'verdict disagree without a reason';
  return null;
}

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

// The text a quote may come from: the task as the solver receives it (the prompt, every string inside the inputs, and
// the task files), never the serialised inputs JSON.
export function taskTexts(task) {
  if (!task) return [];
  const strings = [];
  const walk = v => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x); };
  walk(task.inputs);
  return [String(task.prompt ?? ''), ...strings, ...Object.values(task.files ?? {}).map(String)].map(normWs).filter(Boolean);
}

const words = q => q.split(' ').filter(w => /\p{L}/u.test(w)).length;
export function quoteOccurs(quote, texts, { minQuoteChars = MIN_QUOTE_CHARS, minQuoteWords = MIN_QUOTE_WORDS } = {}) {
  let q = normWs(quote).replace(/^(?:\.\.\.|…)\s*/, '').replace(/\s*(?:\.\.\.|…)$/, '');
  if (q.length < minQuoteChars || words(q) < minQuoteWords) return false;
  if (texts.some(t => t.includes(q))) return true;
  const trimmed = q.replace(/[.,;:]$/, '');
  return trimmed !== q && trimmed.length >= minQuoteChars && texts.some(t => t.includes(trimmed));
}

// One diff case: the quotes in the note blocks that name it, which of them occur verbatim in its own task (candidates),
// and which of those are shared with every other case's task (otherTexts: the texts of the other cases' tasks) and so
// explain nothing. verified is the first candidate; judgeAcceptance then requires distinct quotes across cases.
// opts.ids: how notes name the case ('exact' | 'lenient'); opts.blocks: the case's note blocks given directly (a structured
// verdict's reason), in place of the BUILD-NOTES.md blocks that name it; opts.allowSharedExplanation: shared quotes count.
export function explainCase(id, notes, task, opts = {}) {
  const blocks = opts.blocks ?? noteBlocks(notes).filter(b => mentions(b, id, opts.ids));
  const quotes = [...new Set(blocks.flatMap(quotesIn))];
  const texts = taskTexts(task), others = (opts.otherTexts ?? []).filter(t => t.length);
  const occurring = quotes.filter(q => quoteOccurs(q, texts, opts));
  const shared = others.length ? occurring.filter(q => others.every(t => quoteOccurs(q, t, opts))) : [];
  const candidates = opts.allowSharedExplanation ? occurring : occurring.filter(q => !shared.includes(q));
  const verified = candidates[0] ?? null;
  const reason = verified ? null : !task ? 'no task text for this case' : !blocks.length ? 'not named in BUILD-NOTES.md' : !quotes.length ? 'named, but nothing quoted'
    : shared.length ? 'its only verbatim quotes occur in every other case\'s task too (shared text explains no case)'
    : 'no quote occurs verbatim in this case\'s prompt or inputs';
  const cut = q => (q.length > 200 ? q.slice(0, 199) + '…' : q);
  return { id, mentioned: blocks.length > 0, quotes: quotes.slice(0, 5).map(cut), verified, ok: !!verified, reason, candidates, ...(shared.length ? { shared: shared.slice(0, 5).map(cut) } : {}) };
}

// Distinct quotes: a maximum matching of cases to their candidate quotes (Kuhn's augmenting paths).
function distinctQuotes(cases) {
  const owner = new Map();   // quote -> index of the case it is credited to
  const tryCase = (i, seen) => {
    for (const q of cases[i].candidates) {
      if (seen.has(q)) continue;
      seen.add(q);
      if (!owner.has(q) || tryCase(owner.get(q), seen)) { owner.set(q, i); return true; }
    }
    return false;
  };
  cases.forEach((_, i) => tryCase(i, new Set()));
  const credited = new Map([...owner].map(([q, i]) => [i, q]));
  return cases.map((c, i) => {
    const { candidates, ...rest } = c;
    if (!c.ok) return rest;
    if (credited.has(i)) return { ...rest, verified: credited.get(i) };
    return { ...rest, verified: null, ok: false, reason: 'its verbatim quotes are already credited to other cases (one distinct quote per case)' };
  });
}

// The verdict. summary: check-traces' aggregate (perCase with id, kind, status, partial). tasks: { [case id]: task }.
// Returns { unexplained, accepted } and, for 'strict', acceptance: the criteria and which passed or failed.
// S0-6 options (opt-in; at their defaults the result is byte-identical to before): ids ('exact' | 'lenient' | 'structured',
// compile.acceptanceIds), verdicts (the parsed verdicts.json for 'structured', undefined when the compile wrote none; see
// readVerdicts), allowSharedExplanation (strict only). A non-default choice is recorded: result.ids for 'named', and
// acceptance.ids / acceptance.allowSharedExplanation for 'strict'.
export function judgeAcceptance({ summary, notes, mode = 'named', minPartial, tasks = {}, minQuoteChars = MIN_QUOTE_CHARS, minQuoteWords = MIN_QUOTE_WORDS,
  ids = 'exact', verdicts, allowSharedExplanation = false }) {
  mode = acceptanceModeOf(mode); ids = acceptanceIdsOf(ids);
  if (allowSharedExplanation && mode !== 'strict') throw new Error('allowSharedExplanation needs acceptance \'strict\'');
  const perCase = summary?.perCase ?? [], clean = !!summary?.clean;
  // 'structured' without a verdicts.json: the prose rule with exact ids.
  const structured = ids === 'structured' ? parseVerdicts(verdicts) : null;
  const proseIds = ids === 'lenient' ? 'lenient' : 'exact';
  const idsRecord = ids === 'exact' ? null : { mode: ids, source: structured ? 'verdicts' : 'prose',
    ...(structured ? { valid: structured.valid, verdicts: structured.byCase.size, malformed: structured.malformed, ...(structured.error ? { error: structured.error } : {}) } : {}) };
  if (mode === 'named') {
    const unexplained = structured ? perCase.filter(c => c.status === 'diff' && verdictProblem(structured, c.id)).map(c => c.id) : namedUnexplained(perCase, notes, proseIds);
    return { unexplained, accepted: clean && unexplained.length === 0, ...(idsRecord ? { ids: idsRecord } : {}) };
  }
  minPartial = minPartialOf(minPartial);
  const traces = perCase.filter(c => c.kind === 'trace' && c.status !== 'unlabeled');
  const partial = traces.length ? Math.round((traces.reduce((s, c) => s + (c.partial ?? 0), 0) / traces.length) * 1000) / 1000 : null;
  const exactTraces = traces.filter(c => c.status === 'exact').length;
  const partialOk = partial != null && partial >= minPartial, exactOk = exactTraces >= 1;
  // Every case's task text (labelled or not, trace or regression): what "shared with every other case" is measured against.
  const textsOf = Object.fromEntries(Object.entries(tasks).filter(([, t]) => t).map(([id, t]) => [id, taskTexts(t)]));
  const explain = c => {
    const opts = { minQuoteChars, minQuoteWords, ids: proseIds, allowSharedExplanation, otherTexts: Object.entries(textsOf).filter(([id]) => id !== c.id).map(([, t]) => t) };
    if (!structured) return explainCase(c.id, notes, tasks[c.id], opts);
    const problem = verdictProblem(structured, c.id);
    if (problem) return { id: c.id, mentioned: false, quotes: [], verified: null, ok: false, reason: problem, candidates: [] };
    return { ...explainCase(c.id, null, tasks[c.id], { ...opts, blocks: [structured.byCase.get(c.id.toLowerCase()).reason] }), verdict: 'disagree' };
  };
  const cases = distinctQuotes(perCase.filter(c => c.status === 'diff').map(explain));
  const unexplained = cases.filter(c => !c.ok).map(c => c.id);
  const criteria = {
    clean: { ok: clean },
    agreement: { ok: partialOk || exactOk, partial, minPartial, partialOk, exactTraces, labelledTraces: traces.length, exactOk },
    explained: { ok: unexplained.length === 0, cases },
  };
  const passed = Object.keys(criteria).filter(k => criteria[k].ok), failed = Object.keys(criteria).filter(k => !criteria[k].ok);
  return { unexplained, accepted: failed.length === 0,
    acceptance: { mode, compare: summary?.compare?.mode ?? 'canonical', minQuoteChars, minQuoteWords, criteria, passed, failed,
      ...(idsRecord ? { ids: idsRecord } : {}), ...(allowSharedExplanation ? { allowSharedExplanation: true } : {}) } };
}

// Case id -> task, as check-traces numbers them: regressions/case-<i>, traces/trace-<i>.
export const caseTasks = (traces = [], regressions = []) => ({
  ...Object.fromEntries(traces.map((t, i) => [`trace-${i}`, t?.task ?? null])),
  ...Object.fromEntries(regressions.map((r, i) => [`case-${i}`, r?.task ?? null])),
});

// JIT v2.2 (DEV-NOTES D9): domain preservation on recompile. A case whose input the current solver refused (a deopt that
// handed the task to the interpreter) has exactly two acceptable outcomes under the new solver: an exact match with the
// agent's answer (the shape is now handled) or a deopt (the refusal is kept). A different answer ('diff') turns a safe
// hand-back into a silent wrong answer: the refusal is lost and the version must be rejected. So is a refusal case the
// check did not run, or one that crashed or timed out. Deopts on refusal cases do not count against clean. refusalIds are
// check-traces case ids (trace-<i>). Returns the summary judgeAcceptance should see and the refusal record (null when none).
export function applyRefusals(summary, refusalIds = []) {
  if (!summary || !refusalIds?.length) return { summary, refusalCheck: null };
  const ids = [...new Set(refusalIds)], per = summary.perCase ?? [], byId = new Map(per.map(c => [c.id, c]));
  const kept = [], handled = [], lost = [], missing = [], failed = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) missing.push(id); else if (c.status === 'deopt') kept.push(id); else if (c.status === 'exact') handled.push(id);
    else if (c.status === 'diff') lost.push(id); else failed.push(id);
  }
  const keptSet = new Set(kept), deopts = Math.max(0, Number(summary.deopts ?? 0) - kept.length);
  const regressionsOk = Number(summary.regressionsPassed ?? 0) >= Number(summary.regressions ?? 0);
  const clean = !!summary.clean || (summary.complete !== false && Number(summary.crashes ?? 0) === 0 && Number(summary.timeouts ?? 0) === 0 && deopts === 0 && regressionsOk);
  return {
    summary: { ...summary, perCase: per.filter(c => !keptSet.has(c.id)), deopts, clean },
    refusalCheck: { cases: ids, kept, handled, lost, missing, failed, ok: lost.length === 0 && missing.length === 0 && failed.length === 0 },
  };
}
