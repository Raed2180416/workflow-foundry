// Validity gates for checks, at $0, replacing the E8 run's self-made contrast pair (G2), which a writer passes by building both
// mini-traces from the same guesses (research/need-router-20261014/tracker-e8/REPORT.md §7.1).
//
//  realShape(check, views)  The check must activate on a REAL run of some build (exercised), and a violating twin made by mutating that
//                           real instance (remove the answer, move it to the wrong place, duplicate it, swap the order, break the field)
//                           must make the check fail (teeth). A check no run exercises reads unknown (not-exercised); a check whose twin
//                           still passes is suspect (it cannot fail on real shapes).
//  crossBuild(statuses)     G3: a check that is unmet on every one of K >= 3 different builds of the same request is suspect: the
//                           check, or the person's words, may be wrong (CodeT's dual agreement, in its simplest form).
// Neither gate edits a check: a check is written from the person's words and the vocabulary only (G1); builds only validate it.
import { evaluate, matchesAll, linked, semanticsLevel } from './checks.mjs';

const clone = v => structuredClone(v);
const MUT = '__mutated__';

function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const star = parts[i].endsWith('[*]'), key = star ? parts[i].slice(0, -3) : parts[i];
    if (cur == null || typeof cur !== 'object') return false;
    if (i === parts.length - 1) {
      if (star) { if (!Array.isArray(cur[key]) || !cur[key].length) return false; cur[key][0] = value; return true; }
      if (value === undefined) delete cur[key]; else cur[key] = value;
      return true;
    }
    cur = star ? (Array.isArray(cur[key]) ? cur[key][0] : null) : cur[key];
  }
  return false;
}
/** A value that breaks one condition (or undefined to delete the field). */
function breaking(c) {
  switch (c.op) {
    case 'eq': case 'contains': case 'in': case 'inColumn': case 'subsetOf': return MUT;
    case 'ne': return c.value; case 'notIn': return c.values?.[0] ?? c.value;
    case 'notContains': return String(c.value);
    case 'exists': case 'nonEmpty': return undefined;
    case 'absent': return MUT;
    case 'isTrue': return false; case 'isFalse': return true;
    case 'lt': case 'lte': return Number.MAX_SAFE_INTEGER; case 'gt': case 'gte': return -Number.MAX_SAFE_INTEGER;
    default: return MUT;
  }
}
const retext = e => { e.text = Object.values(e.fields ?? {}).filter(v => typeof v === 'string').join('\n'); return e; };

/** Make the violating twin of `view` for one passing instance; null when no mutation applies. */
export function twinOf(check, view, instance) {
  const v = clone(view);
  const byId = id => v.effects.find(e => e.id === id);
  const refs = (instance.refs ?? []).map(byId).filter(Boolean);
  switch (check.template) {
    case 'present':
      v.effects = v.effects.filter(e => !(e.channel === check.channel && e.status === 'applied' && matchesAll(e.fields, check.where ?? [], { view: v, whole: e.text })));
      return v;
    case 'absent': {
      const real = v.effects.find(e => e.channel === check.channel);
      const e = real ? clone(real) : { id: 'twin-1', seq: (v.effects.at(-1)?.seq ?? 0) + 1, at: v.now ?? null, channel: check.channel, status: 'applied', fields: {}, text: '' };
      e.id = `${e.id}-twin`; e.seq = (v.effects.at(-1)?.seq ?? 0) + 1; e.status = 'applied';
      for (const c of check.where ?? []) {
        let val = c.op === 'eq' || c.op === 'contains' ? c.value : c.op === 'in' ? c.values?.[0] : c.op === 'inColumn' ? (v.sources?.[c.source] ?? []).filter(it => matchesAll(it.fields, c.filter ?? [], { view: v })).flatMap(it => [it.fields[c.column]])[0] : c.op === 'exists' || c.op === 'nonEmpty' ? 'x' : undefined;
        if (val === undefined) return null;
        if (c.path === '*') { e.fields.body = `${e.fields.body ?? ''} ${val}`; continue; }
        setPath(e.fields, c.path, val);
      }
      v.effects.push(retext(e));
      return v;
    }
    case 'field': {
      const e = byId(instance.item?.id);
      if (!e) return null;
      const c = (check.require ?? [])[0];
      if (!c) return null;
      if (c.path === '*') { for (const [k, x] of Object.entries(e.fields)) if (typeof x === 'string') e.fields[k] = MUT; retext(e); return v; }
      if (!setPath(e.fields, c.path, breaking(c)) && breaking(c) !== undefined) return null;
      retext(e);
      return v;
    }
    case 'count': {
      const linkedRefs = refs.filter(e => e.channel === check.channel);
      if (check.op === 'atLeast') { const drop = new Set(linkedRefs.map(e => e.id)); v.effects = v.effects.filter(e => !drop.has(e.id)); return drop.size ? v : null; }
      let src = linkedRefs[0] ?? null;
      if (!src) {
        // The passing item had no linked effect: make one from a real effect on the channel, pointed at this item.
        const real = v.effects.find(e => e.channel === check.channel && e.status === 'applied' && matchesAll(e.fields, check.where ?? [], { view: v, whole: e.text }));
        const item = (v.sources?.[check.source] ?? []).find(it => it.id === instance.item?.id);
        if (!real || !item || !check.link) return null;
        src = clone(real); src.id = `${real.id}-linked`;
        const val = check.link.op === 'mentions' ? (item.names?.[0] ?? null) : (check.link.item === '@subject' ? item.subject : item.fields?.[check.link.item]);
        if (val == null) return null;
        if (check.link.effect === '*' || check.link.op === 'mentions') { src.fields.body = `${src.fields.body ?? ''}\n${val}`; src.text = `${src.text}\n${val}`; }
        else if (check.link.effect === '@subject') src.subject = item.subject;
        else { setPath(src.fields, check.link.effect, val); retext(src); }
      }
      for (let k = 0; k <= check.n; k++) { const d = clone(src); d.id = `${src.id}-dup${k}`; d.seq = (v.effects.at(-1)?.seq ?? 0) + 1; v.effects.push(d); }
      return v;
    }
    case 'when-then': case 'scope': {
      const good = refs.filter(e => e.channel === check.channel && e.status === 'applied');
      if (!good.length) return null;
      for (const g of good) g.channel = `${MUT}:${g.channel}`;   // the answer moved to the wrong place; it still names the item
      return v;
    }
    case 'order': {
      const [a, b] = refs;
      if (!a || !b) return null;
      const s = a.seq; a.seq = b.seq; b.seq = s;
      v.effects.sort((x, y) => x.seq - y.seq);
      return v;
    }
    default: return null;
  }
}

/** realShape(check, views) → { exercised, teeth: true|false|null, view, why } */
export function realShape(check, views, { tries = 6, semantics = 'v1' } = {}) {
  let exercised = false;
  for (const view of views) {
    const r = evaluate(check, view, { semantics });
    if (r.decided > 0) exercised = true;
    for (const pass of r.instances.filter(i => i.ok === true).slice(0, tries)) {
      const twin = twinOf(check, view, pass);
      if (!twin) continue;
      const t = evaluate(check, twin, { semantics });
      const same = pass.item ? t.instances.find(i => i.item?.id === pass.item.id) : t.instances[0];
      // v2: a twin that turns undecided (another effect may say it in other words) is no evidence either way; try the next one.
      if (semanticsLevel(semantics) >= 2 && same && same.ok === null && t.violated === 0) continue;
      const failed = t.violated > 0 && (!same || same.ok === false || check.template === 'present' || check.template === 'absent');
      return { exercised: true, teeth: failed, view: view.id ?? null, why: failed ? 'a twin of a real passing instance fails' : 'a twin of a real passing instance still passes' };
    }
  }
  // No passing instance to mutate: an `absent` check on a run with nothing forbidden is tested with a synthesized twin.
  if (check.template === 'absent' && views.length) {
    const twin = twinOf(check, views[0], { refs: [] });
    if (twin) { const t = evaluate(check, twin, { semantics }); return { exercised: true, teeth: t.violated > 0, view: views[0].id ?? null, why: t.violated > 0 ? 'a synthesized forbidden effect fails' : 'a synthesized forbidden effect still passes' }; }
  }
  return { exercised, teeth: null, view: null, why: exercised ? 'no passing instance to mutate' : 'no run exercised it' };
}

/** G3: ids unmet on every one of K >= minBuilds builds. statusesByBuild: [{ <conditionId>: status }]. */
export function crossBuild(statusesByBuild, { minBuilds = 3 } = {}) {
  const out = new Set();
  if (statusesByBuild.length < minBuilds) return out;
  const ids = new Set(statusesByBuild.flatMap(s => Object.keys(s)));
  for (const id of ids) if (statusesByBuild.every(s => s[id] === 'unmet')) out.add(id);
  return out;
}
export { linked };
