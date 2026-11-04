// Static analysis of an n8n workflow for CI-1: which trigger starts it, which world sheets and chat channels it touches, and which
// field paths its expressions and Code nodes read (the input to world generation). Reads the definition as data; evaluates nothing.
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const slug = v => String(v ?? '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sheet';
const rl = v => isObj(v) && v.__rl ? v : { value: v };
export const TRIGGER_TYPES = new Set(['manualTrigger', 'scheduleTrigger', 'cron', 'interval', 'start', 'webhook', 'formTrigger', 'gmailTrigger', 'telegramTrigger', 'googleSheetsTrigger', 'emailReadImap']);

export function analyse(workflow) {
  const nodes = (workflow.nodes ?? []).filter(n => !String(n.type).endsWith('stickyNote') && !n.disabled);
  const base = n => String(n.type).split('.').pop();
  const triggers = nodes.filter(n => TRIGGER_TYPES.has(base(n))).map(n => ({ name: n.name, type: base(n) }));
  const sheets = {}, sheetNodes = {};
  for (const n of nodes.filter(n => base(n) === 'googleSheets' || base(n) === 'googleSheetsTrigger')) {
    const doc = rl(n.parameters?.documentId), sh = rl(n.parameters?.sheetName);
    const key = `${doc.value}|${sh.value}`;
    const label = sh.cachedResultName && !/^sheet\d*$/i.test(sh.cachedResultName) ? sh.cachedResultName : doc.cachedResultName ?? sh.cachedResultName ?? sh.value;
    sheets[key] ??= slug(label);
    sheetNodes[n.name] = { key, op: n.parameters?.operation ?? 'read', dynamic: /^=/.test(String(doc.value)) || /^=/.test(String(sh.value)) };
  }
  // distinct names for distinct keys
  const used = new Map();
  for (const [k, v] of Object.entries(sheets)) { let name = /^[a-z]/.test(v) ? v : `s-${v}`; let i = 2; while (used.has(name) && used.get(name) !== k) name = `${v}-${i++}`; used.set(name, k); sheets[k] = name; }
  const effects = nodes.filter(n => ['gmail', 'emailSend', 'slack', 'telegram', 'discord', 'respondToWebhook'].includes(base(n)) || (base(n) === 'googleSheets' && !['read', 'getAll', 'lookup', undefined].includes(n.parameters?.operation)))
    .map(n => ({ name: n.name, type: base(n), op: n.parameters?.operation ?? null }));
  // field paths read by expressions ($json.a.b, $('X').item.json.a, $node["X"].json.a) and by Code nodes (.json.a)
  const paths = new Set();
  const scan = s => {
    for (const m of String(s).matchAll(/\$json((?:\.[A-Za-z_$][\w$]*|\[["'][^"']+["']\])+)/g)) paths.add(`$json${m[1]}`);
    for (const m of String(s).matchAll(/\$\(\s*["']([^"']+)["']\s*\)\.(?:item|first\(\)|last\(\)|all\(\)\[\d+\])\.json((?:\.[A-Za-z_$][\w$]*|\[["'][^"']+["']\])+)/g)) paths.add(`$('${m[1]}')${m[2]}`);
    for (const m of String(s).matchAll(/\$node\[["']([^"']+)["']\]\.json((?:\.[A-Za-z_$][\w$]*|\[["'][^"']+["']\])+)/g)) paths.add(`$('${m[1]}')${m[2]}`);
    for (const m of String(s).matchAll(/\.json((?:\.[A-Za-z_$][\w$]*|\[["'][^"']+["']\])+)/g)) paths.add(`*.json${m[1]}`);
  };
  const walk = v => { if (typeof v === 'string') scan(v); else if (Array.isArray(v)) v.forEach(walk); else if (isObj(v)) Object.values(v).forEach(walk); };
  for (const n of nodes) walk(n.parameters);
  return { triggers, sheets, sheetNodes, effects, paths: [...paths].sort(), nodeCount: nodes.length };
}
