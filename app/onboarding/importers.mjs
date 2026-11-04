// "Already use n8n? Drop an exported workflow" (SPEC §9.14): the existing importer's honest verdict (app/importers/n8n.mjs; nothing is
// executed) plus a risk card in plain words. Every line of the risk card says whether Foundry READ it from the file or INFERRED it.
// The file is untrusted data: its names are shown as text and never given to a model.
//
// Honesty review 2026-10-21 (M1): a line is ✓ only for what Foundry did. "Translates into Foundry steps" is all a lowered workflow is: its
// connector steps have no host adapter (n8n.mjs throws NOT_CONNECTED), nothing was run, and the importer itself says behaviour
// equivalence with n8n is not shown. Calling the workflow in place, in n8n, is designed (wrap()) but nothing here can configure or call
// it, so that line is Planned, never ✓. status: 'yes' (✓), 'no' (✗) or 'planned'.
import { FoundryError } from '../../src/data.mjs';
import { importN8n, normalise, BLOCKING, n8nConnector } from '../importers/n8n.mjs';

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
  const translated = report.compileVerdict === 'lowered';
  const connectors = [...new Set((report.needsCapabilities ?? []).map(c => (c.from ? n8nConnector(c.from) : null) ?? c.name).filter(Boolean))];
  const line = (key, status, text) => ({ key, status, yes: status === 'yes', text });
  return { name: report.name || 'Untitled workflow', nodes: norm.nodes.length,
    lines: [
      translated ? line('translated', 'yes', 'Translates into Foundry steps without errors. Not run: Foundry ran none of it, and a translation does not show it would behave as it does in n8n.')
        : line('translated', 'no', 'Does not translate into Foundry steps.'),
      ...(translated ? [line('run', 'no', connectors.length ? `Foundry can't run it yet: it needs connectors Foundry doesn't have (${connectors.join(', ')}).` : 'Foundry can\'t run it yet: nothing here has been tested as a Foundry automation.')] : []),
      line('wrap', 'planned', `Leave it in n8n and have Foundry call it through ${report.wrap.via === 'webhook' ? 'its webhook' : 'n8n'}${report.wrap.descriptor.requiresApproval ? ', asking you before each call' : ''}: designed, not built, so nothing here can set that up yet.`),
      ...(!translated ? [line('cannot', 'no', 'Can\'t be translated yet, because:')] : [])],
    reasons: (report.reasons ?? []).map(r => ({ code: r.code, steps: r.steps ?? r.nodes ?? [], text: plainReason(r.code) })),
    risk: riskCard(norm),
    executed: false, note: 'Foundry ran nothing. n8n keeps running your workflow as before.' };
}
