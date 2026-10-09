// Declared normalisations for n8n:12679. Frozen before the final scoring run (see PREREG.json).
//   G: item-agnostic. The log is already a state delta with ids replaced by emails (that is the log extraction, see the adapter);
//      text normalisation; per-person streams compared as sequences; every field compared as written; every write call is one effect.
//   I: G plus three declarations:
//      (1) write batching is not judged: all deltas of one person in one scenario, per system, merge into their NET effect
//          (create = final record; update = last value of every touched field; delete). Two designs that reach the same net change in a
//          different number of calls (e.g. one tag call vs two) are the same design. [added after the first dev run showed the item's own
//          improved design and the Berlin-midnight design rejected for batching only]
//      (2) a KlickTipp birthday is unix seconds and stands for a DATE, so a UTC-midnight and a Europe/Berlin-midnight stamp are the same date (unixDate);
//      (3) the order of the remaining net effects of one person is not judged (bag).
export const G = { name: 'G', timeTolerance: null, order: 'auto' };

function netEffects(log) {
  const groups = new Map(), order = [];
  const sys = t => t.split('.')[0], kind = t => t.split('.')[1];
  for (const e of log) {
    const k = `${e.case}\u0000${e.stream}\u0000${sys(e.type)}`;
    if (!groups.has(k)) { groups.set(k, { e, created: false, deleted: false, fields: {}, email: null }); order.push(k); }
    const g = groups.get(k), { email, ...rest } = e.key;
    if (kind(e.type) === 'create') { g.created = true; g.deleted = false; g.fields = { ...rest }; g.email = email; }
    else if (kind(e.type) === 'update') { Object.assign(g.fields, rest); g.email = email ?? g.email; }
    else if (kind(e.type) === 'delete') { g.deleted = true; g.email = email ?? g.email; }
  }
  const out = [];
  for (const k of order) {
    const g = groups.get(k), s = sys(g.e.type);
    if (!g.deleted || g.created) out.push({ case: g.e.case, stream: g.e.stream, type: `${s}.${g.created ? 'create' : 'update'}`, key: { email: g.email, ...g.fields } });
    if (g.deleted) out.push({ case: g.e.case, stream: g.e.stream, type: `${s}.delete`, key: { email: g.email } });
  }
  return out;
}
export const I = { name: 'I:n8n12679 (net effect per person and system; birthday as a date)', timeTolerance: null, order: 'bag', prepare: netEffects, fieldRules: { fieldBirthday: 'unixDate' } };
