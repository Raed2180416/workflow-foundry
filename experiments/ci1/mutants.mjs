// Mutants of an n8n reference workflow, for world distillation (Zhong, Yu & Klein 2020 "distilled test suites": keep the worlds that
// tell the reference from its near misses). Each mutant is one plausible builder mistake: a flipped or shifted condition, a dropped
// filter or step, a missing or extra effect, a swapped recipient, a changed constant. Pure functions over the definition (data).
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
const base = n => String(n.type).split('.').pop();
const OP_SWAP = { gt: 'gte', gte: 'gt', lt: 'lte', lte: 'lt', equals: 'notEquals', notEquals: 'equals', contains: 'notContains', notContains: 'contains',
  after: 'afterOrEquals', afterOrEquals: 'after', before: 'beforeOrEquals', beforeOrEquals: 'before', startsWith: 'notStartsWith', endsWith: 'notEndsWith',
  empty: 'notEmpty', notEmpty: 'empty', exists: 'notExists', notExists: 'exists', true: 'false', false: 'true', larger: 'largerEqual', largerEqual: 'larger', smaller: 'smallerEqual', smallerEqual: 'smaller', equal: 'notEqual', notEqual: 'equal' };
const EFFECT = new Set(['gmail', 'emailSend', 'slack', 'telegram', 'discord', 'respondToWebhook']);

function conditionLists(p) {
  const out = [];
  const visit = v => { if (Array.isArray(v)) v.forEach(visit); else if (isObj(v)) { if (Array.isArray(v.conditions) && v.conditions.some(c => isObj(c?.operator))) out.push(v); Object.values(v).forEach(visit); } };
  visit(p);
  return out;
}
/** Re-wire around a node: its parents feed its children (output 0, or the given output), as if the step were left out. */
function bypass(wf, name, viaOutput = 0) {
  const w = clone(wf);
  const outs = (w.connections[name]?.main ?? [])[viaOutput] ?? [];
  for (const [src, conns] of Object.entries(w.connections)) for (const list of conns.main ?? []) {
    if (!list) continue;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].node === name) { const [t] = list.splice(i, 1); for (const o of outs) list.push({ ...o, index: o.index ?? 0 }); void t; }
  }
  delete w.connections[name];
  w.nodes = w.nodes.filter(n => n.name !== name);
  return w;
}
function removeNode(wf, name) { const w = clone(wf); w.nodes = w.nodes.filter(n => n.name !== name); delete w.connections[name]; for (const conns of Object.values(w.connections)) for (const list of conns.main ?? []) if (list) for (let i = list.length - 1; i >= 0; i--) if (list[i].node === name) list.splice(i, 1); return w; }

export function mutants(wf, { maxPerKind = 6 } = {}) {
  const out = [];
  const add = (kind, label, w) => out.push({ id: `${kind}:${label}`.slice(0, 120), kind, workflow: w });
  const nodes = wf.nodes.filter(n => !String(n.type).endsWith('stickyNote') && !n.disabled);
  for (const n of nodes) {
    const b = base(n);
    // conditions (If v2, Filter v2, Switch v3 rules)
    const lists = conditionLists(n.parameters);
    lists.forEach((cl, li) => cl.conditions.forEach((c, ci) => {
      const op = c.operator?.operation;
      if (OP_SWAP[op]) { const w = clone(wf); const m = conditionLists(w.nodes.find(x => x.name === n.name).parameters)[li].conditions[ci]; m.operator.operation = OP_SWAP[op]; if (['exists', 'notExists', 'empty', 'notEmpty'].includes(OP_SWAP[op])) m.operator.singleValue = true; add('cond-op', `${n.name}#${li}.${ci} ${op}->${OP_SWAP[op]}`, w); }
      const rv = c.rightValue;
      if (typeof rv === 'number' || (typeof rv === 'string' && /^-?\d+(\.\d+)?$/.test(rv))) for (const d of [1, -1]) { const w = clone(wf); const m = conditionLists(w.nodes.find(x => x.name === n.name).parameters)[li].conditions[ci]; m.rightValue = Number(rv) + d * (Number.isInteger(Number(rv)) ? 1 : 0.5); add('cond-const', `${n.name}#${li}.${ci} ${rv}${d > 0 ? '+' : '-'}`, w); }
      else if (typeof rv === 'string' && rv && !rv.startsWith('=')) { const w = clone(wf); conditionLists(w.nodes.find(x => x.name === n.name).parameters)[li].conditions[ci].rightValue = `${rv}x`; add('cond-const', `${n.name}#${li}.${ci} "${rv.slice(0, 20)}"`, w); }
    }));
    lists.forEach((cl, li) => { if (cl.conditions.length > 1) { const w = clone(wf); const m = conditionLists(w.nodes.find(x => x.name === n.name).parameters)[li]; m.combinator = (m.combinator ?? 'and') === 'and' ? 'or' : 'and'; add('cond-comb', `${n.name}#${li}`, w); } });
    // If: swap branches; Filter/If/RemoveDuplicates/Limit/Sort/Code/Set: leave the step out
    if (b === 'if') { const w = clone(wf); const m = w.connections[n.name]?.main; if (m && m.length >= 1) { while (m.length < 2) m.push([]); [m[0], m[1]] = [m[1], m[0]]; add('if-swap', n.name, w); } add('skip', `${n.name} (always true)`, bypass(wf, n.name, 0)); }
    if (['filter', 'removeDuplicates', 'limit', 'sort', 'code', 'function', 'functionItem', 'set', 'aggregate', 'summarize', 'splitOut', 'dateTime', 'merge'].includes(b) && (wf.connections[n.name]?.main ?? []).some(l => l?.length)) add('skip', n.name, bypass(wf, n.name, 0));
    // effects: drop, and duplicate (an extra send)
    if (EFFECT.has(b) || (b === 'googleSheets' && !['read', 'getAll', 'lookup', undefined].includes(n.parameters?.operation))) {
      add('drop-effect', n.name, removeNode(wf, n.name));
      const w = clone(wf); const copy = { ...clone(n), name: `${n.name} (copy)`, position: [(n.position?.[0] ?? 0) + 1, (n.position?.[1] ?? 0) + 1] }; w.nodes.push(copy);
      for (const conns of Object.values(w.connections)) for (const list of conns.main ?? []) if (list?.some(t => t.node === n.name)) list.push({ node: copy.name, type: 'main', index: 0 });
      add('dup-effect', n.name, w);
    }
    // recipients / channels: a static address or channel replaced
    for (const key of ['sendTo', 'toEmail', 'chatId']) { const v = n.parameters?.[key]; if (typeof v === 'string' && v && !v.startsWith('=')) { const w = clone(wf); w.nodes.find(x => x.name === n.name).parameters[key] = key === 'chatId' ? '999000111' : 'someone.else@elsewhere.example'; add('recipient', `${n.name}.${key}`, w); } }
    if (b === 'slack' && n.parameters?.channelId) { const w = clone(wf); w.nodes.find(x => x.name === n.name).parameters.channelId = { __rl: true, mode: 'name', value: '#elsewhere', cachedResultName: 'elsewhere' }; add('recipient', `${n.name}.channel`, w); }
    // Code: shift a numeric comparison constant and flip a strict/non-strict comparison (first two occurrences each)
    const code = n.parameters?.jsCode ?? n.parameters?.functionCode;
    if (typeof code === 'string') {
      const key = n.parameters?.jsCode !== undefined ? 'jsCode' : 'functionCode';
      let k = 0;
      for (const m of code.matchAll(/([<>]=?)\s*(\d+(?:\.\d+)?)(?![\d.])/g)) {
        if (k++ >= maxPerKind) break;
        const at = m.index, len = m[0].length;
        const flip = { '<': '<=', '<=': '<', '>': '>=', '>=': '>' }[m[1]];
        for (const [lab, rep] of [[`${m[1]}->${flip}`, `${flip} ${m[2]}`], [`${m[2]}+1`, `${m[1]} ${Number(m[2]) + 1}`]]) {
          const w = clone(wf); w.nodes.find(x => x.name === n.name).parameters[key] = code.slice(0, at) + rep + code.slice(at + len); add('code-const', `${n.name}@${at} ${lab}`, w);
        }
      }
      let j = 0;
      for (const m of code.matchAll(/(===|!==)/g)) { if (j++ >= 3) break; const w = clone(wf); w.nodes.find(x => x.name === n.name).parameters[key] = code.slice(0, m.index) + (m[1] === '===' ? '!==' : '===') + code.slice(m.index + 3); add('code-eq', `${n.name}@${m.index}`, w); }
    }
    // Set: a literal assignment changed
    for (const [ai, a] of (n.parameters?.assignments?.assignments ?? []).entries()) if (typeof a.value === 'string' && a.value && !a.value.startsWith('=') && ai < maxPerKind) { const w = clone(wf); w.nodes.find(x => x.name === n.name).parameters.assignments.assignments[ai].value = `${a.value}-changed`; add('set-const', `${n.name}.${a.name}`, w); }
  }
  return out;
}
