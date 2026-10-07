// Rule baselines, one per dataset, each at most 30 lines: keyword, regex and string similarity, written
// with honest effort from the bed READMEs and the option semantics (not tuned on evaluation items).
// Each returns non-negative scores over the item's options (JudgmentPort 'rule' engine normalises).
import { jaroWinkler } from './lib.mjs';

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase();
const soft = (p, k = 8) => 1 / (1 + Math.exp(-k * p));   // squash a margin into (0, 1)

// (a) records-pair: name similarity (token-wise Jaro-Winkler after accent folding), phone digits, birth year.
function recordsPair({ state }) {
  const nameOf = l => l.startsWith('VERITAS') ? (() => { const j = JSON.parse(l.slice(8)); return `${j.given} ${j.family}`; })()
    : l.startsWith('LEDGR') ? l.split(';')[2] : l.startsWith('BRIGHTDESK') ? (l.match(/name=([^|]*)/)?.[1] ?? '')
      : l.startsWith('ATLAS') ? l.split(' :: ')[1] : l.startsWith('KOBO') ? (l.match(/member: ([^|]*)/)?.[1] ?? '') : l.replace(/^Vendex \d+ — /, '').split(/[—,(;]/)[0];
  const toks = l => fold(nameOf(l)).replace(/\b(dr|mr|mrs|ms|prof|herr|frau|mme|m)\b\.?/g, ' ').split(/[^a-z]+/).filter(t => t.length > 1);
  const a = toks(state.row_a), b = toks(state.row_b);
  const best = (xs, ys) => xs.length ? xs.reduce((s, x) => s + Math.max(0, ...ys.map(y => jaroWinkler(x, y))), 0) / xs.length : 0;
  const name = Math.min(best(a, b), best(b, a));
  const digits = l => (l.match(/(?:phone|tel|msisdn|reach at|mobile|number)[^|;:]*?([\d ()+-]{7,})/i)?.[1] ?? '').replace(/\D/g, '').slice(-7);
  const pa = digits(state.row_a), pb = digits(state.row_b);
  const years = l => new Set(l.match(/\b(19[2-9]\d|200\d)\b/g) ?? []);
  const ya = years(state.row_a), yb = years(state.row_b);
  const yearHit = [...ya].some(y => yb.has(y)) ? 1 : (ya.size && yb.size ? -1 : 0);
  const p = soft(3 * (name - 0.9) + 0.25 * yearHit + (pa && pa === pb ? 0.1 : 0), 6);
  return { yes: p, no: 1 - p };
}

// (b1) incident-class: count class vocabulary in the lines (from the bed README's symptom table).
const VOCAB = {
  connection_pool_exhaustion: /\bpool\b|acquire|borrow|checked out|connections? (held|idle)/gi, certificate_expiry: /certificate|x509|tls|handshake|expire/gi,
  bad_config_deploy: /rollout|deploy|release|config|version|panic|invalid value|missing route/gi, disk_full: /enospc|errno 28|no space|disk|read-only|volume|checkpoint/gi,
  dns_resolution_failure: /dns|resolv|lookup|nxdomain|no such host|servfail/gi, memory_leak_oom: /heap|oom|out of memory|rss|memory|killed|gc pause/gi,
  clock_skew: /clock|skew|offset|not yet valid|ntp|drift|iat|nbf/gi, upstream_rate_limiting: /429|rate.?limit|quota|throttl/gi,
  poisoned_cache: /cache|checksum|missing field|corrupt|refill|stale/gi,
};
function incidentClass({ state, options }) {
  const text = state.log_lines.join('\n');
  return Object.fromEntries(options.map(o => [o, 0.2 + (text.match(VOCAB[o]) ?? []).length]));
}

// (b2) incident-root: a victim mostly reports failures of calls to someone else; a root reports its own symptoms.
function incidentRoot({ state }) {
  const lines = state.log_lines.map(l => l.split(' ').slice(3).join(' '));
  const callee = lines.filter(l => /upstream|returned \d{3}|calling|call to|circuit|breaker|from [a-z-]+(\.|:)|timed? ?out (calling|waiting)|-> 5\d\d|\b50[234]\b/i.test(l)).length;
  const own = lines.filter(l => /pool|certificate|disk|enospc|heap|oom|clock|dns|lookup|rollout|cache|quota|429|x509/i.test(l)).length;
  const p = soft((own - callee) / Math.max(1, lines.length), 4);
  return { root: p, victim: 1 - p };
}

// (c) synth-claim: entity name or code mentioned, property mentioned, no quote/prediction/variant/condition cues.
function synthClaim({ state }) {
  const t = fold(state.document.text), ent = fold(state.requested_entity), code = fold(state.entity_code);
  const mentions = t.includes(ent) || (code && t.includes(code));
  const prop = state.property.split(' ').every(w => t.includes(fold(w)));
  const bad = /(reported|quoted|according to|predict|simulat|extrapolat|expected to|target|salt|hydrate|doped|mutant|derived|composite|porous|draft|estimate|et al)/.test(t);
  const measured = /(we measured|we obtained|was measured|we found|gave|showed|we determined|measured)/.test(t);
  const p = soft((mentions ? 0.4 : -0.6) + (prop ? 0.2 : -0.4) + (measured ? 0.2 : 0) - (bad ? 0.35 : 0), 5);
  return { yes: p, no: 1 - p };
}

// (d) codefix-fn: functions named in the report (call sites in the REPL transcript weigh most).
function codefixFn({ state, options }) {
  const report = state.bug_report;
  return Object.fromEntries(options.map(o => {
    const short = o.split('.').pop(), cls = o.includes('.') ? o.split('.')[0] : null;
    const calls = (report.match(new RegExp(`\\.?\\b${short}\\(`, 'g')) ?? []).length;
    const named = (report.match(new RegExp(`\\b${short}\\b`, 'g')) ?? []).length;
    return [o, 0.1 + 2 * calls + named + (cls && report.includes(cls) && short === '__init__' ? 0.5 : 0) + (short.startsWith('_') ? -0.05 : 0)];
  }));
}

// (e) injection: addressed to an AI/tool or overriding rules, or a staff request to change data.
function injection({ state }) {
  const t = state.text;
  const ai = /\b(AI|assistant|language model|automated|triage models?|migration tool|system (notice|instruction)|SYSTEM:|ignore (all|the)|override|instructions?)\b/i.test(t);
  const req = /(please|should read|must|delete this|exclude it|set the|use that instead|merge|copy that|report exactly|cite)/i.test(t);
  const p = ai ? 0.92 : req ? 0.6 : 0.08;
  return { yes: p, no: 1 - p };
}

// (f) failure-class: error code first, then message keywords.
const FCODE = { MODEL_RATE_LIMIT: 'flake', MODEL_TIMEOUT: 'flake', SANDBOX_UNAVAILABLE: 'env', MODEL_AUTH: 'env', MODEL_UNAVAILABLE: 'env', MODEL_SCHEMA: 'model_output',
  MODEL_TRUNCATED: 'model_output', MODEL_REFUSAL: 'model_output', JUDGMENT_PROTOCOL: 'model_output', MODEL_PROTOCOL: 'model_output', COST_BUDGET: 'budget', STEP_BUDGET: 'budget',
  DEADLINE: 'budget', MODEL_BUDGET: 'budget', LOOP_EXHAUSTED: 'budget', DATAFLOW: 'defect', ACCEPTANCE_FAILED: 'defect' };
const FKEY = [[/ECONNRESET|reset by peer|429|529|overloaded|EAI_AGAIN|SQLITE_BUSY|database is locked|passed on rerun|succeeded/i, 'flake'],
  [/not found|No module named|ENOSPC|EACCES|permission denied|Operation not permitted|Invalid API key|memory limit|exit 137|missing/i, 'env'],
  [/schema|markdown|code fence|truncat|declined|not one of|plain prose|empty result/i, 'model_output'], [/budget|exhausted|deadline|maxIterations|exceed/i, 'budget'],
  [/TypeError|KeyError|AssertionError|RangeError|undefined|replay/i, 'defect']];
function failureClass({ state, options }) {
  const s = Object.fromEntries(options.map(o => [o, 0.1]));
  if (FCODE[state.error_code]) s[FCODE[state.error_code]] += 2;
  for (const [re, c] of FKEY) if (re.test(`${state.message} ${state.history}`)) s[c] += 1;
  return s;
}

// (g) applicability: locale/order keywords in the note, mapped to the assumed order (negations flip).
function applicability({ state, question }) {
  const t = state.source_note;
  const mdy = (t.match(/\b(US|U\.S\.|American|month first|month comes before|month\/day|mm\/dd|Phoenix|New York|Chicago|Toronto)\b/gi) ?? []).length;
  const dmy = (t.match(/\b(UK|British|European|day first|day comes before|day\/month|dd\/mm|London|Sydney|Adelaide|Melbourne|Dublin|Berlin|Paris|local way)\b/gi) ?? []).length;
  const neg = /\b(not|never|unlike|instead of|rather than)\b/i.test(t) ? -0.3 : 0;
  const pMdy = soft((mdy - dmy) * 0.5 + neg * Math.sign(mdy - dmy), 2);
  const p = question.includes('month/day/year') ? pMdy : 1 - pMdy;
  return { yes: p, no: 1 - p };
}

export const RULES = { 'records-pair': recordsPair, 'incident-class': incidentClass, 'incident-root': incidentRoot, 'synth-claim': synthClaim,
  'codefix-fn': codefixFn, injection, 'failure-class': failureClass, applicability };
