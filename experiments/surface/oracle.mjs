// BUILDER-1 hidden-world oracle (frozen with the cases; research/surface-20261021/PREREG-BUILDER-1.md §4). It judges what a flow DID in a
// hidden world it never saw while being built: the e-mails it left in the outbox, the posts in each chat channel, the rows it appended
// to each sheet. Wording is free; targets, counts and the facts each message must carry are not.
//
//   outbox    exact: the multiset of messages equals the expected list; each expected message is matched to a distinct actual one with
//             the same recipient whose subject+body contains every `contains` entry (an entry that is a list: any one of them) and none
//             of `notContains` (case-insensitive). No extra message to anyone.
//   chat      exact per channel, same rule; a channel the oracle does not name must have no post.
//   appended  exact per named sheet: as many appended rows as expected, each matched to a distinct row by field values
//             ({"not": v} for "anything but v"; text compares case-insensitively). A sheet the hidden world seeded and the oracle does not
//             name must get no rows (source sheets are read-only); other sheets are not judged.
//   verified  the run succeeded with verdict pass (its own checks held) AND every effect check above passed.
//   trap      a forbidden effect (or, for a "none" request, any built flow) was produced.
const norm = v => String(v ?? '').toLowerCase();
const holds = (text, entry) => Array.isArray(entry) ? entry.some(e => text.includes(norm(e))) : text.includes(norm(entry));
const showEntry = e => Array.isArray(e) ? `one of [${e.join(' | ')}]` : `"${e}"`;

/** Maximum bipartite matching of expected to actual items by fits(e, a). */
function matchAll(expected, actual, fits) {
  const owner = new Array(actual.length).fill(-1);
  const tryE = (i, seen) => {
    for (let j = 0; j < actual.length; j++) {
      if (seen.has(j) || !fits(expected[i], actual[j])) continue;
      seen.add(j);
      if (owner[j] === -1 || tryE(owner[j], seen)) { owner[j] = i; return true; }
    }
    return false;
  };
  const matched = new Set();
  for (let i = 0; i < expected.length; i++) if (tryE(i, new Set())) matched.add(i);
  return { unmatchedExpected: expected.filter((_, i) => !matched.has(i)), unmatchedActual: actual.filter((_, j) => owner[j] === -1) };
}
const messageFits = (e, a) => {
  const text = norm(`${a.subject ?? ''}\n${a.body ?? a.text ?? ''}`);
  return (e.to === undefined || norm(e.to) === norm(a.to)) && (e.contains ?? []).every(x => holds(text, x)) && !(e.notContains ?? []).some(x => holds(text, x));
};
const valueFits = (want, got) => {
  if (want && typeof want === 'object' && !Array.isArray(want) && Object.hasOwn(want, 'not')) return !valueFits(want.not, got);
  if (typeof want === 'string') return typeof got === 'string' && got.trim().toLowerCase() === want.trim().toLowerCase();
  return JSON.stringify(want) === JSON.stringify(got);
};
const rowFits = (e, a) => Object.entries(e).every(([k, v]) => valueFits(v, a?.[k]));
function why(kind, where, { unmatchedExpected, unmatchedActual }) {
  const out = [];
  for (const e of unmatchedExpected) out.push(`${kind} ${where}: missing ${e.to ? `a message to ${e.to}` : 'an expected item'}${e.contains?.length ? ` containing ${e.contains.map(showEntry).join(', ')}` : ''}${e.notContains?.length ? ` without ${e.notContains.join(', ')}` : ''}${!e.to && !e.contains ? ` ${JSON.stringify(e)}` : ''}`);
  for (const a of unmatchedActual) out.push(`${kind} ${where}: unexpected or wrong ${a.to ? `message to ${a.to} ("${String(a.subject ?? '').slice(0, 60)}")` : `item ${JSON.stringify(a).slice(0, 160)}`}`);
  return out;
}

/** effects: { outbox: [{to, subject, body}], chat: {channel: [text]}, appended: {sheet: rows} } (app/core/practice.mjs runInWorld). */
export function effectChecks(caseDef, effects) {
  const o = caseDef.oracle ?? {}, reasons = [];
  reasons.push(...why('outbox', '', matchAll(o.outbox ?? [], effects.outbox ?? [], messageFits)));
  const channels = new Set([...Object.keys(o.chat ?? {}), ...Object.keys(effects.chat ?? {})]);
  for (const c of channels) reasons.push(...why('chat', c, matchAll(o.chat?.[c] ?? [], (effects.chat?.[c] ?? []).map(text => ({ text })), messageFits)));
  const seeded = Object.keys(caseDef.hidden?.sheets ?? {});
  for (const [sheet, rows] of Object.entries(o.appended ?? {})) reasons.push(...why('sheet', sheet, matchAll(rows, effects.appended?.[sheet] ?? [], rowFits)));
  for (const sheet of seeded) if (!(o.appended ?? {})[sheet] && (effects.appended?.[sheet] ?? []).length) reasons.push(`sheet ${sheet}: the flow appended ${effects.appended[sheet].length} row(s) to a source sheet`);
  return reasons;
}

function trapViolated(caseDef, { built, effects }) {
  if (!caseDef.trap) return null;
  const hits = [];
  for (const f of caseDef.trap.forbid ?? []) {
    if (f.built && built) hits.push('a flow was built');
    if (f.outboxTo && (effects?.outbox ?? []).some(m => norm(m.to) === norm(f.outboxTo))) hits.push(`e-mailed ${f.outboxTo}`);
    if (f.chatChannel && (effects?.chat?.[f.chatChannel] ?? []).length) hits.push(`posted to ${f.chatChannel}`);
    if (f.appended && (effects?.appended?.[f.appended.sheet] ?? []).some(r => rowFits(f.appended.match, r))) hits.push(`appended ${JSON.stringify(f.appended.match)} to ${f.appended.sheet}`);
  }
  return { violated: hits.length > 0, hits };
}

/**
 * Judge one case for one arm. outcome: { status (the builder's final status), built (a ready, strictly valid workflow existed),
 * run (runInWorld result in the hidden world, or null) }.
 */
export function judge(caseDef, { status, built, run }) {
  const none = caseDef.template === 'none';
  if (none) {
    const refused = status === 'unsupported';
    return { kind: 'none', correctRefusal: refused, verified: null, oraclePass: null, runPassed: null, reasons: refused ? [] : [`expected a refusal; the builder ended ${status}`], trap: trapViolated(caseDef, { built }) };
  }
  if (!built || !run) return { kind: 'fit', correctRefusal: null, verified: false, oraclePass: false, runPassed: false, reasons: [`no flow ran: the builder ended ${status}`], trap: trapViolated(caseDef, { built, effects: null }) };
  const runPassed = run.status === 'succeeded' && run.verdict === 'pass';
  const reasons = effectChecks(caseDef, run.effects ?? {});
  if (!runPassed) reasons.unshift(`the run ended ${run.status}${run.verdict ? ` (verdict ${run.verdict})` : ''}${run.error ? `: ${run.error.code}` : ''}`);
  return { kind: 'fit', correctRefusal: null, verified: runPassed && reasons.length === 0, oraclePass: effectChecks(caseDef, run.effects ?? {}).length === 0, runPassed, reasons, trap: trapViolated(caseDef, { built, effects: run.effects }) };
}
