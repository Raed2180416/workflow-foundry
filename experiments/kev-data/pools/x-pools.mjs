// train-pools: candidate builders for the cross-bed ports X1 (injected_instruction) and X5
// (precondition_holds, records assumption phrasings). Authored files:
//   authored/x1-<family>.mjs   { family, sourceKind, positives, benign, decoys, hardNegatives }
//   authored/x5.mjs            { assumptions: { 'R1:dmy': [...], ... } }
export const X1_FAMILIES = Object.freeze(['records', 'incident', 'synth', 'runbook', 'codefix', 'gameqa']);
export const X1_ROLES = Object.freeze({ positives: ['yes', 'positive'], benign: ['no', 'benign'], decoys: ['no', 'decoy'], hardNegatives: ['no', 'hard-negative'] });
export const X5_KINDS = Object.freeze({
  'R1:dmy': { system: null, allow: ['S'], require: ['S'] }, 'R1:mdy': { allow: ['S'], require: ['S'] }, 'R1:ymd': { allow: ['S'], require: ['S'] },
  'R2:void': { allow: ['S', 'token'], require: ['S', 'token'] }, 'R2:live': { allow: ['S', 'token'], require: ['S', 'token'] },
  'R3:same': { allow: ['S'], require: ['S'] }, 'R3:opposite': { allow: ['S'], require: ['S'] },
  'R4:reliable': { allow: ['S', 'field'], require: ['S', 'field'] }, 'R4:restamped': { allow: ['S', 'field'], require: ['S', 'field'] },
});
const pad = (n, w = 3) => String(n).padStart(w, '0');

export function buildXCandidates({ authored }) {
  const candidates = [], problems = [];
  for (const family of X1_FAMILIES) {
    // x1-<family>.mjs, plus any x1-<family>-<part>.mjs: sections concatenate in file-name order
    const names = Object.keys(authored).filter(n => n === `x1-${family}` || n.startsWith(`x1-${family}-`)).sort();
    if (!names.length) continue;
    const d = { family, sourceKind: null };
    for (const n of names) {
      const part = authored[n];
      if (part.family !== family) problems.push(`${n}: family field is ${part.family}`);
      if (part.sourceKind) d.sourceKind = d.sourceKind ?? part.sourceKind;
      for (const section of Object.keys(X1_ROLES)) if (part[section]) d[section] = [...(d[section] ?? []), ...part[section]];
    }
    for (const [section, [label, role]] of Object.entries(X1_ROLES)) {
      for (const [j, entry] of (d[section] ?? []).entries()) {
        // an entry is a string, or [text, sourceKind] when the line comes from another kind of source than the file's default
        const [text, sourceKind] = Array.isArray(entry) ? entry : [entry, d.sourceKind];
        candidates.push({ key: `X1:${family}:${role}#${pad(j)}`, port: 'X1', group: 'authored', kind: role, templateId: null, source: null, system: null, label, order: null, family, sourceKind, role,
          text, expectSlots: null, allow: [], require: [], slotCarried: false, pairKey: null, pairIndex: j });
      }
    }
  }
  const x5 = authored.x5?.assumptions;
  if (x5) {
    for (const [key, entries] of Object.entries(x5)) {
      const spec = X5_KINDS[key];
      if (!spec) { problems.push(`x5: unknown assumption kind ${key}`); continue; }
      const [assertsPort, label] = key.split(':');
      entries.forEach((text, j) => candidates.push({ key: `X5:${key}#${pad(j)}`, port: 'X5', group: 'authored', kind: 'assumption', templateId: null, source: null, system: null, label, order: null, assertsPort,
        text, expectSlots: null, allow: spec.allow, require: spec.require, slotCarried: false, pairKey: null, pairIndex: j }));
    }
  }
  return { candidates, problems };
}
