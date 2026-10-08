// Local probe-hard proxy (JUDGE-PROGRAM.md §2.4 "probe-hard quota"). The audit's number is computed by
// shortcut-audit with the train-fitted probe; this module is the author's own diagnostic and the tie-break
// used when choosing which authored lines fill a slice quota: a line counts as probe-hard here when a
// bag-of-words probe fitted on the other two slices' lines AND a contract-derived keyword rule both miss
// its label. Neither reads any bed or train material. Deterministic.
import { predict, trainProbe } from '../lib/probe.mjs';

// Keyword rules per port, written from the option descriptions in spec/ports.json (negation-blind on purpose).
export const RULES = Object.freeze({
  R1: { dmy: /day[- ]first|day,? (?:then )?month|dd[/.\-]mm|dmy|little[- ]endian|day leads|d\/m\/y|day (?:in|at) the (?:front|start|beginning)/i,
        mdy: /month[- ]first|month,? (?:then )?day|mm[/.\-]dd|mdy|us[- ]style|american|m\/d\/y|month leads|month (?:in|at) the (?:front|start|beginning)/i,
        ymd: /year[- ]first|year,? (?:then )?month|yyyy|ymd|iso|big[- ]endian|four[- ]digit year|year leads/i, fallback: 'dmy' },
  R2: { void: /void|delet|test|junk|ghost|cancel|not (?:a )?real|do not migrate|don't migrate|dont migrate|skip|drop|dead|fake|purge|erased|placeholder|leave out|exclude/i,
        live: /live|active|real|migrate|keep|customer|open|paying|include/i, fallback: 'live' },
  R3: { same: /owe us|receivable|keep|same|our side|as is|unchanged|no flip|not flip|owed to us|asset/i,
        opposite: /we owe|payable|flip|negate|revers|opposite|other side|invert|customer'?s? (?:view|side)|liabilit/i, fallback: 'same' },
  R4: { reliable: /real|genuine|true|reliable|trust|preserv|keeps?|only (?:changes|moves|set|written)|survive/i,
        restamped: /restamp|overwrit|reset|copy|copied|restore|migrat|load|not (?:real|reliable|usable)|unreliable|refresh/i, fallback: 'reliable' },
  X1: { yes: /ignore|disregard|override|you must|whoever|should|must|\bAI\b|assistant|bot\b|system:|approve|instead|do not|don't|skip|treat|record|report|mark|set the|answer|state that|say that/i, no: /$^/, fallback: 'no' },
});
export function ruleLabel(port, text) {
  const r = RULES[port]; if (!r) return null;
  const labels = Object.keys(r).filter(k => k !== 'fallback'), score = Object.fromEntries(labels.map(l => [l, (text.match(new RegExp(r[l].source, `${r[l].flags.replace('g', '')}g`)) ?? []).length]));
  const best = Math.max(...Object.values(score));
  if (port === 'X1') return score.yes > 0 ? 'yes' : 'no';
  const top = labels.filter(l => score[l] === best);
  return best > 0 && top.length === 1 ? top[0] : r.fallback;
}

// units: decisive units of one port with slice and label. Returns Map(id -> {probeWrong, ruleWrong, hard}).
export function hardness(port, units, { slices = ['calib-ood', 'dev-ood', 'test-ood'] } = {}) {
  const out = new Map();
  for (const s of slices) {
    const test = units.filter(u => u.slice === s), train = units.filter(u => u.slice !== s);
    if (!test.length || new Set(train.map(u => u.label)).size < 2) { for (const u of test) out.set(u.id, { probeWrong: false, ruleWrong: false, hard: false }); continue; }
    const model = trainProbe(train.map(u => ({ text: u.text, label: u.label })), { iterations: 120 });
    for (const u of test) {
      const probeWrong = predict(model, u.text).label !== u.label, ruleWrong = ruleLabel(port, u.text) !== u.label;
      out.set(u.id, { probeWrong, ruleWrong, hard: probeWrong && ruleWrong });
    }
  }
  return out;
}
