// Lesson L-3 (from H-p1): CHECK_SELF_EXEMPTION. An `any` in a node's checks with a branch that reads only model-chosen fields and
// not the decision field its sibling branches constrain: the model can exempt itself from checking the field that matters
// (records-v3 STATUS_CHECKS: with relation "none" nothing looks at `meaning`).
import { refsIn, nodeRef, decisionFields } from '../../ir.mjs';

export const CODE = 'CHECK_SELF_EXEMPTION';
export const SUMMARY = 'A check branch lets the model choose a value that exempts it from checking the decision field its sibling branches constrain';

const outputFields = c => refsIn(c).map(nodeRef).filter(x => x?.id === '_output' || x?.id === 'output').map(x => x.path[0]);
const rawFields = c => refsIn(c).filter(r => r.startsWith('output.')).map(r => r.split('.')[1]);
const fieldsOf = c => [...new Set([...outputFields(c), ...rawFields(c)])];

function walkAny(c, f) {
  if (!c || typeof c !== 'object') return;
  if (c.op === 'any') f(c);
  for (const child of c.conditions ?? (c.condition ? [c.condition] : [])) walkAny(child, f);
}

export function check(workflow) {
  const out = [];
  const visit = (flow, trail) => {
    for (const node of flow.nodes ?? []) {
      if (node.body) visit(node.body, [...trail, node.id]);
      if (node.kind !== 'agent' || !(node.checks ?? []).length) continue;
      const decisions = new Set(decisionFields(node.returns));
      for (const c of node.checks) walkAny(c, any => {
        const per = any.conditions.map(fieldsOf), union = new Set(per.flat().filter(f => decisions.has(f)));
        any.conditions.forEach((branch, i) => {
          const mine = new Set(per[i].filter(f => decisions.has(f))), missing = [...union].filter(f => !mine.has(f));
          if (mine.size && missing.length && per.some((p, j) => j !== i && missing.every(f => p.includes(f)))) {
            const path = `workflow.${[...trail, node.id].join('.')}`;
            if (!out.some(o => o.path === path && o.details.exemptedBy === [...mine].join(',') && o.details.fields.join(',') === missing.join(','))) out.push({ code: CODE, severity: 'warning', path, node: node.id,
              message: `A branch of the checks of ${node.id} reads ${[...mine].join(', ')} only, so choosing it exempts the output from the checks on ${missing.join(', ')}`,
              repair: { action: 'unconditional-check', hint: 'Constrain the decision field in every branch, or add a second independent read of it' }, details: { exemptedBy: [...mine].join(','), fields: missing } });
          }
        });
      });
    }
  };
  visit(workflow, []);
  return out;
}
