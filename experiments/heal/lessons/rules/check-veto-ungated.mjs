// Lesson L-2 (from H-cfx): CHECK_VETO_UNGATED. A heuristic code check whose `false` routes by `when` to a node that produces a
// replacement candidate, while a selector node reads both and nothing gates on which of the two is right. An over-strict check then
// replaces a correct candidate with the repair's output (C0 F-haiku codefix: `check1` flagged a correct default-value fix).
import { refsIn, nodeRef } from '../../ir.mjs';

export const CODE = 'CHECK_VETO_UNGATED';
export const SUMMARY = 'A code check can veto a candidate and route to a replacement that a selector prefers, with no gate comparing the two';

export function check(workflow) {
  const out = [], byId = new Map(workflow.nodes.map(n => [n.id, n]));
  const isCode = n => n && (n.kind === 'code' || (n.kind === 'verify' && n.method === 'code'));
  for (const router of workflow.nodes) {
    if (!router.when) continue;
    for (const checkId of new Set(refsIn(router.when).map(r => nodeRef(r)?.id).filter(Boolean))) {
      const checker = byId.get(checkId);
      if (!isCode(checker) || router.kind !== 'agent') continue;
      // a selector reads the checker, the router's output and (usually) the candidate the checker looked at
      const selectors = workflow.nodes.filter(n => n.kind === 'code' && n.id !== checkId && n.id !== router.id && [router.id, checkId].every(id => refsIn(n.args ?? {}).some(r => nodeRef(r)?.id === id)));
      if (!selectors.length) continue;
      // a veto is silent unless a gate (acceptance, assert, gating verify) reads the checker's verdict or the replacement it routed to
      const gated = [...workflow.acceptance.flatMap(c => refsIn(c)), ...workflow.nodes.filter(n => n.kind === 'assert' || (n.kind === 'verify' && n.gate !== false)).flatMap(n => refsIn(n))].some(r => [router.id, checkId].includes(nodeRef(r)?.id));
      if (gated) continue;
      out.push({ code: CODE, severity: 'warning', path: `workflow.${checkId}`, node: checkId,
        message: `Check ${checkId} can veto its candidate and route to ${router.id}; ${selectors.map(s => s.id).join(', ')} selects between them and no gate compares the two`,
        repair: { action: 'self-test-check', hint: 'Give the check a self-test: a documented-legal change, cited from the task contract, must pass. Prefer the earliest candidate that passes the gating checks. Do not forbid in repair prompts what a named defect class requires.' },
        details: { router: router.id, selectors: selectors.map(s => s.id) } });
    }
  }
  return out;
}
