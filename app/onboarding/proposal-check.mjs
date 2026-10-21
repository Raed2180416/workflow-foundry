// The authority map meets the cards (SPEC §8): when an automation is made, a setting the map bounds is prefilled ("€250 · Set by
// Finance") instead of asked, and a value that would widen it is refused ("Not allowed here …"). An address outside the company's
// domain is refused when a never-outside-domain rule exists. Checked at proposal time only: NOT enforced while automations run.
import { AuthorityMaps, LAYER_NAMES } from './authority-map.mjs';
import { loadLibrary } from '../core/library.mjs';
import { money } from './rule-examples.mjs';

/** The limits a saved map puts on one card's settings: [{ slot, max?, domain?, by, layer, unit }]. */
export function limitsFor(map, templateId) {
  if (!map) return [];
  const out = [];
  const nameOf = id => map.principals.find(p => p.id === id)?.name ?? id;
  if (templateId === 'expense-approval') {
    // Money out above the map's threshold needs the approver: the card may approve on its own at most up to that amount.
    for (const a of map.approvals.filter(x => x.actionClass === 'money-out' && x.aboveParameter)) {
      const p = map.parameters[a.aboveParameter]; if (!p) continue;
      const rule = map.clauses.find(c => c.check.kind === 'approval-above-threshold' && c.check.parameter === a.aboveParameter);
      out.push({ slot: 'autoApproveUpTo', max: p.value, unit: p.unit, by: nameOf(rule?.owner.principal ?? a.approverPrincipal ?? 'you'), layer: LAYER_NAMES[rule?.layer ?? 'org-policy'] });
    }
    for (const b of map.bounds.filter(x => x.parameter === 'expenseAutoApproveMax' && typeof x.max === 'number')) out.push({ slot: 'autoApproveUpTo', max: b.max, unit: map.parameters.expenseAutoApproveMax?.unit ?? '', by: nameOf(b.owner), layer: LAYER_NAMES[b.layer] });
  }
  for (const c of map.clauses.filter(x => x.check.kind === 'never-outside-domain' && x.check.domain))
    out.push({ slot: '*email', domain: c.check.domain, by: nameOf(c.owner.principal), layer: LAYER_NAMES[c.layer] });
  return out;
}

/** The form builder's policy hook: (templateId, settings) -> { prefill, refusals, answered }. Reads the current saved map each time. */
export function orgPolicy(root, { emailSlots = {} } = {}) {
  const maps = new AuthorityMaps(root);
  return (templateId, settings) => {
    let map = null; try { map = maps.current()?.map ?? null; } catch { map = null; }
    const limits = limitsFor(map, templateId), prefill = {}, refusals = [], answered = [];
    for (const l of limits.filter(x => typeof x.max === 'number')) {
      const tightest = Math.min(...limits.filter(x => x.slot === l.slot && typeof x.max === 'number').map(x => x.max));
      if (l.max !== tightest) continue;
      const given = settings[l.slot];
      if (given === undefined || given === '' || given === null) { prefill[l.slot] = l.max; answered.push({ slot: l.slot, value: l.max, by: l.by, layer: l.layer, text: `${money(l.max, l.unit)} · Set by ${l.by} (${l.layer})` }); }
      else if (Number(given) > l.max) refusals.push({ slot: l.slot, message: `Not allowed here. ${l.by} set the limit at ${money(l.max, l.unit)} (${l.layer}). This automation can only make it stricter.`, by: l.by, layer: l.layer, max: l.max });
      else answered.push({ slot: l.slot, value: Number(given), by: l.by, layer: l.layer, text: `${money(Number(given), l.unit)} · within ${l.by}'s limit of ${money(l.max, l.unit)} (${l.layer})` });
    }
    for (const l of limits.filter(x => x.domain)) for (const slot of emailSlots[templateId] ?? []) {
      const v = settings[slot];
      if (typeof v === 'string' && v.includes('@') && !v.toLowerCase().endsWith(`@${l.domain.toLowerCase()}`)) refusals.push({ slot, message: `Not allowed here. ${l.by}'s rule keeps messages inside ${l.domain} (${l.layer}).`, by: l.by, layer: l.layer });
    }
    return { prefill, refusals, answered };
  };
}

/** Give a site builder's form builder the workspace's org policy (the site and the MCP server both do this). */
export function withOrgPolicy(builder, root, library = loadLibrary()) {
  const emailSlots = Object.fromEntries(library.map(t => [t.id, t.slots.filter(s => s.type === 'email').map(s => s.name)]));
  if (builder?.form && !builder.form.policy) builder.form.policy = orgPolicy(root, { emailSlots });
  return builder;
}
