// "Already use n8n? Drop an exported workflow" (SPEC §9.14): the existing importer's honest verdict (app/importers/n8n.mjs; nothing is
// executed) plus a risk card in plain words. Every line of the risk card says whether Foundry READ it from the file or INFERRED it.
// The file is untrusted data: its names are shown as text and never given to a model.
import { FoundryError } from '../../src/data.mjs';
import { importN8n, normalise, BLOCKING } from '../importers/n8n.mjs';

const plainReason = code => BLOCKING[code] ?? `Uses something Foundry can't bring over yet (${code}).`;

export function riskCard(norm) {
  const outside = norm.nodes.filter(n => n.effects === 'write' || n.effects === 'external');
  const retries = outside.filter(n => n.raw?.retryOnFail);
  const humans = norm.nodes.filter(n => n.category === 'human');
  const outsideNames = new Set(outside.map(n => n.name));
  const checksAfter = norm.edges.some(e => outsideNames.has(e.from) && /\.(if|filter|switch)$/.test(norm.nodes.find(n => n.name === e.to)?.type ?? ''));
  return [
    { what: 'What it does to the outside world', answer: outside.length ? outside.map(n => `${n.name}${n.connectors.length ? ` (${n.connectors.join(', ')}${n.opdesc ? `, ${n.opdesc}` : ''})` : ''}`).join('; ') : 'Nothing found: it only reads or reshapes data', source: 'read' },
    { what: 'Safe to repeat?', answer: retries.length ? `No: ${retries.map(n => n.name).join(', ')} retries on failure, and it writes outside, so a retry can do it twice` : outside.length ? 'Unknown: n8n does not say whether these steps are safe to repeat' : 'Yes: nothing outside changes', source: retries.length ? 'read' : 'inferred' },
    { what: 'Does anything check it worked?', answer: checksAfter ? 'Something looks at the result of an outside step' : 'No check of the outside steps\' results was found', source: 'inferred' },
    { what: 'Does anyone approve it?', answer: humans.length ? `${humans.length} step(s) wait for a person` : 'No: nothing in the file asks a person before acting', source: 'read' }
  ];
}

/** The import report for one dropped file: verdict lines, reasons in plain words, the risk card. Nothing runs. */
export function importReport(text) {
  if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) throw new FoundryError('IMPORT_SIZE', 'The file must be text, under 4 MB');
  let json; try { json = JSON.parse(text); } catch { throw new FoundryError('IMPORT_JSON', 'This is not a JSON file. In n8n, use Download on the workflow to get one.'); }
  const report = importN8n(json), norm = normalise(json);
  const verdict = report.compileVerdict === 'lowered' ? 'exact' : 'cannot';
  return { name: report.name || 'Untitled workflow', nodes: norm.nodes.length,
    lines: [
      { key: 'exact', yes: verdict === 'exact', text: verdict === 'exact' ? 'Comes over exactly: Foundry can run this as its own automation (after a test and your yes).' : 'Does not come over exactly.' },
      { key: 'wrap', yes: true, text: `Can be called as it is: it stays in n8n, and Foundry calls it through ${report.wrap.via === 'webhook' ? 'its webhook' : 'n8n'}${report.wrap.descriptor.requiresApproval ? ', asking you before each call' : ''}.` },
      ...(verdict === 'cannot' ? [{ key: 'cannot', yes: false, text: 'Can\'t come over yet, because:' }] : [])],
    reasons: (report.reasons ?? []).map(r => ({ code: r.code, steps: r.steps ?? r.nodes ?? [], text: plainReason(r.code) })),
    risk: riskCard(norm),
    executed: false, note: 'Foundry ran nothing. n8n keeps running your workflow as before.' };
}
