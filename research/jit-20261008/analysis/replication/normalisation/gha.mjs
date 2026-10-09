// Declared normalisations for the GHA item. Frozen before scoring.
//   G: item-agnostic. Text normalisation only; each stream is a sequence; every text compared as written (PR text, failure message, labels order).
//   I: item declarations (oracle-like work, listed):
//        - pr.fields.labels: a set (GitHub labels are a set);
//        - pr.text: the facts the contract demands, not the wording: for each changed image, does the text name the image together with its old and
//          its new tag (same section rule as the oracle: a section is the line naming the image plus up to 3 following lines; both tags in the
//          section; "new -> old" reads as backwards and does not count);
//        - run.message: the facts the contract demands: for each required keyword group, is some token present.
//      Declared with the item's contract in hand (README section 3, rules R5, R7); not derived from any model-authored design.
export const G = { name: 'G', timeTolerance: null, order: 'auto' };

const LABELS = ['Chrome', 'Edge', 'Firefox', 'Hub'];
const BACKWARDS = /→|->|=>|⇒|\bto\b/i;
function mentions(text, label, from, to) {
  const lines = String(text ?? '').split('\n'), low = s => s.toLowerCase(), others = LABELS.map(low).filter(l => l !== low(label));
  for (let i = 0; i < lines.length; i++) {
    if (!low(lines[i]).includes(low(label))) continue;
    let j = i + 1; while (j < lines.length && j < i + 4 && !others.some(o => low(lines[j]).includes(o))) j++;
    const s = lines.slice(i, j).join('\n'), f = s.indexOf(from);
    if (f >= 0 && s.indexOf(to, f + from.length) >= 0) return true;
    const t = s.indexOf(to);
    if (t >= 0) { const g = s.indexOf(from, t + to.length); if (g >= 0 && !BACKWARDS.test(s.slice(t + to.length, g))) return true; }
  }
  return false;
}
const LABEL_OF = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', hub: 'Hub' };
export const I = {
  name: 'I:gha (labels set; PR text and failure message as contract facts)', timeTolerance: null, order: 'auto', fieldRules: { labels: 'uset' },
  keyMap(type, key, ev) {
    if (type === 'pr.text') return { field: key.field, mentions: (ev.changes ?? []).map(c => mentions(key.text, LABEL_OF[c.key], c.from, c.to)) };
    if (type === 'run.message' && ev.msg) { const t = String(key.message).toLowerCase(); return { groups: ev.msg.allOf.map(g => g.some(tok => t.includes(tok.toLowerCase()))) }; }
    if (type === 'run.message') return { groups: null };
    return key;
  },
};
