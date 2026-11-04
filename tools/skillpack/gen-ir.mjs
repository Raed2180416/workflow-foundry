#!/usr/bin/env node
// Generates skills/foundry-construct/references/ir.md from schemas/workflow.schema.json, so the skill pack's
// description of the IR cannot drift from the schema the validator enforces. `--check` exits 1 when the file
// on disk differs from what the schema produces (used by tests/skillpack.test.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const schema = JSON.parse(readFileSync(`${root}schemas/workflow.schema.json`, 'utf8'));
const out = `${root}skills/foundry-construct/references/ir.md`;
const defs = schema.definitions, nodeProps = defs.node.properties;

const enumOf = p => p?.enum ? p.enum.join(' | ') : null;
const brief = p => enumOf(p) ?? (p?.$ref ? p.$ref.replace('#/definitions/', '') : p?.type ?? 'any');
const kinds = nodeProps.kind.enum;
const perKind = new Map(kinds.map(k => [k, new Set()]));
const byMethod = new Map();
for (const c of defs.node.allOf) {
  const k = c.if?.properties?.kind?.const; if (!k || !c.then) continue;
  const m = c.if?.properties?.method?.const;
  if (m) { byMethod.set(m, c.then.required ?? []); continue; }
  for (const r of c.then.required ?? []) perKind.get(k).add(r);
}
const kindCell = k => {
  const base = [...perKind.get(k)].map(r => '`' + r + '`').join(', ') || '(none beyond the common fields)';
  if (k !== 'verify' || !byMethod.size) return base;
  return base + '; plus by `method`: ' + [...byMethod].map(([m, req]) => `${m} → ${req.map(r => '`' + r + '`').join(', ')}`).join('; ');
};
const top = schema.properties;
const lines = [
  '# The workflow IR (generated from schemas/workflow.schema.json; do not edit by hand)',
  '',
  `Regenerate with \`node tools/skillpack/gen-ir.mjs\`. Top-level fields: ${Object.keys(top).map(k => '`' + k + '`').join(', ')};`,
  `required: ${schema.required.map(k => '`' + k + '`').join(', ')}.`,
  '',
  `Every node needs ${defs.node.required.map(k => '`' + k + '`').join(', ')}. Node kinds and the fields each kind requires:`,
  '',
  '| kind | requires |', '|---|---|',
  ...kinds.map(k => `| \`${k}\` | ${kindCell(k)} |`),
  '',
  'Enumerated fields:',
  '',
  ...['role', 'method', 'independence', 'failure', 'onError', 'lang', 'op'].map(k => `- \`${k}\`: ${brief(nodeProps[k])}`),
  `- \`model\`: { class | id, maxClass?, justification? } (class names come from policy/models.json classOrder)`,
  `- condition \`op\`: ${defs.condition.oneOf.map(o => o.properties.op.enum ? o.properties.op.enum.join(' | ') : o.properties.op.const).join(' | ')}`,
  '',
  'Limits the validator enforces:',
  '',
  `- \`map.maxItems\` <= ${nodeProps.maxItems.maximum ?? 'see schema'}; \`budget.maxConcurrency\` <= ${top.budget.properties.maxConcurrency.maximum};` +
    ` \`budget.maxSteps\` <= ${top.budget.properties.maxSteps.maximum}; \`budget.maxDurationMs\` <= ${top.budget.properties.maxDurationMs.maximum}`,
  `- \`loop.maxIterations\` <= ${nodeProps.maxIterations?.maximum ?? 'see schema'}; \`code.source\` <= ${nodeProps.source.maxLength} characters`,
  `- \`budget\` fields: ${Object.keys(top.budget.properties).map(k => '`' + k + '`').join(', ')}; required: ${(top.budget.required ?? []).map(k => '`' + k + '`').join(', ') || '(none)'}`,
  '',
  ...(defs.principal ? [
    'Approvals (human nodes):',
    '',
    `- A \`human\` node may name a \`principal\` { ${Object.keys(defs.principal.properties).map(k => '`' + k + '`').join(', ')} }: the role (from the host's role matrix) that may answer it. ` +
      `A \`threshold\` { ${Object.keys(defs.principal.properties.threshold.properties).map(k => '`' + k + '`').join(', ')} } routes answers whose \`amount\` is above \`above\` to another role. Only human nodes take a principal.`,
    ...(top.segregation ? [`- Top-level \`segregation\` (at most ${top.segregation.maxItems} groups) lists ${top.segregation.items.properties.nodes.minItems}–${top.segregation.items.properties.nodes.maxItems} human nodes whose answerers must be pairwise distinct in one run (segregation of duties: requester ≠ approver).`] : []),
    '',
  ] : []),
  'References and runtime contracts (from src/runtime.mjs and src/sandbox.mjs):',
  '',
  '- Values are referenced as `{"$ref": "input.<field>"}`, `{"$ref": "nodes.<id>.<field>"}`, and inside a map body `{"$ref": "item.<field>"}`.',
  '- A `map` outputs `{ items, count, failed? }`; `items[i]` holds the body\'s node outputs; a failed item is `{ "$error": … }`; `failed` exists only with `failure: "collect"`.',
  '- A `code` node runs `export default function main(input)` in a sandbox (no network, PATH only), with `input` = its resolved `args`; `returns` validates the result.',
  '- A `verify` with `method: "code"` receives `main({ subject })`, `subject` being its resolved `subject` (an object of refs is allowed); it returns `{ pass, … }`. Code and capability verifiers have `independence: "execution"`.',
  '- `agent` nodes take `instructions`, typed `returns`, `model`, optional `role`, `context.inputs` (`{ name, ref }`) and `escalation`.',
  '',
];
const text = lines.join('\n');
if (process.argv.includes('--check')) {
  let disk = ''; try { disk = readFileSync(out, 'utf8'); } catch {}
  if (disk !== text) { console.error('ir.md is out of date: run node tools/skillpack/gen-ir.mjs'); process.exit(1); }
  console.log('ir.md is current');
} else { writeFileSync(out, text); console.log(`wrote ${out}`); }
