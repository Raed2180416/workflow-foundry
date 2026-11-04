// What a diverse-judges verifier sees (verifier lab, design "diverse-judges"): the task request, the connected apps' records
// before the agent acted, and the changes the agent made (initial vs final world), rendered as bounded text.
//
// Generic by construction (PREREG-AB-v1 H7/H8): no task names, no grader strings, no hidden assertions. Built only from the
// lab's verifierView(row) (prompt, today, services, diff) and the row's initial world. The world's `meta` block is dropped
// whole: it is simulator bookkeeping the acting agent could not read through any app. Apps outside the connected services
// are dropped too, unless the agent changed them. Every string is untrusted data; the renderer only shortens it.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Drop empty values recursively (null, '', [], {}). */
export function compact(v) {
  if (Array.isArray(v)) return v.map(compact);
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const y = compact(x);
      if (y === null || y === undefined || y === '' || (Array.isArray(y) && !y.length) || (isObj(y) && !Object.keys(y).length)) continue;
      o[k] = y;
    }
    return o;
  }
  return v;
}

/** Shorten every string longer than max characters (keeps the head, marks the cut). */
export function clip(v, max) {
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…[+${v.length - max} chars]` : v;
  if (Array.isArray(v)) return v.map(x => clip(x, max));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clip(x, max)]));
  return v;
}

const line = v => JSON.stringify(v);

/** Flatten one level of nested plain objects into dotted keys (a sheet row's cells.Name); lists stay whole. */
function flat(rec) {
  const o = {};
  for (const [k, v] of Object.entries(rec)) {
    if (isObj(v) && Object.values(v).every(x => !isObj(x))) for (const [k2, v2] of Object.entries(v)) o[`${k}.${k2}`] = v2;
    else o[k] = v;
  }
  return o;
}
const cell = v => (v === undefined ? '' : typeof v === 'string' ? v.replace(/\r?\n/g, '⏎').replace(/\|/g, '¦') : JSON.stringify(v).replace(/\|/g, '¦'));

/** A collection of records as a table: one header of columns, one line of values per record (keys are not repeated, which
 *  roughly halves the text of a typical collection). Lines are "| v1 | v2 | ..." in header order; an empty cell is empty. */
export function renderTable(records, maxStr) {
  const rows = records.map(r => (isObj(r) ? flat(clip(r, maxStr)) : { value: clip(r, maxStr) }));
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return [`| ${cols.join(' | ')} |`, ...rows.map(r => `| ${cols.map(c => cell(r[c])).join(' | ')} |`)].join('\n');
}

/** The initial records of the connected apps, as text within capChars. Shortens long strings first, then shows fewer
 *  records per collection (each cut is marked), so the rendering is bounded for any world. */
export function renderRecords(world, { services = [], extraApps = [], capChars = 24000 } = {}) {
  const keep = new Set([...services, ...extraApps]);
  const apps = Object.entries(compact(world ?? {})).filter(([app]) => app !== 'meta' && keep.has(app)).sort(([a], [b]) => a.localeCompare(b));
  const render = (maxStr, maxRecords) => {
    const out = [];
    for (const [app, colls] of apps) {
      if (!isObj(colls)) { out.push(`### ${app}: ${line(clip(colls, maxStr))}`); continue; }
      for (const [coll, x] of Object.entries(colls)) {
        if (Array.isArray(x)) {
          out.push(`### ${app}.${coll} (${x.length} record${x.length === 1 ? '' : 's'})`);
          const shown = x.slice(0, maxRecords);
          out.push(renderTable(shown, maxStr));
          if (x.length > shown.length) out.push(`[… ${x.length - shown.length} more ${app}.${coll} records not shown]`);
        } else out.push(`### ${app}.${coll}: ${line(clip(x, maxStr))}`);
      }
    }
    return out.join('\n');
  };
  let text = '';
  for (const [maxStr, maxRecords] of [[1200, Infinity], [600, Infinity], [300, Infinity], [300, 60], [200, 40], [150, 25], [120, 15], [100, 8]]) {
    text = render(maxStr, maxRecords);
    if (text.length <= capChars) return { text, truncated: maxStr < 1200 || maxRecords !== Infinity, chars: text.length };
  }
  return { text: `${text.slice(0, capChars)}\n[… records cut at ${capChars} characters]`, truncated: true, chars: capChars };
}

// Fields that only record that something was touched (no business meaning on their own).
const TOUCH = /^(updated_at|last_modified(_date|_time)?|modified_at|modified_time|last_activity(_at)?|last_updated|updated_time|is_read|read_at|last_viewed(_at)?)$/;

function findRecord(world, app, coll, id) {
  const x = world?.[app]?.[coll];
  if (Array.isArray(x)) return x.find(r => isObj(r) && (r.id === id || r.row_id === id)) ?? null;
  if (isObj(x)) return x[id] ?? Object.values(x).find(r => isObj(r) && r.id === id) ?? null;
  return null;
}

function fieldChange(path, before, after, maxStr) {
  // Lists are compared whole in the lab diff: show what was appended or removed instead of both copies.
  if (Array.isArray(before) && Array.isArray(after)) {
    const key = v => JSON.stringify(v);
    const b = new Map(before.map(v => [key(v), v])), a = new Map(after.map(v => [key(v), v]));
    const added = after.filter(v => !b.has(key(v))), removed = before.filter(v => !a.has(key(v)));
    return `${path}: ${added.length ? `added ${line(clip(compact(added), maxStr))}` : ''}${added.length && removed.length ? '; ' : ''}${removed.length ? `removed ${line(clip(compact(removed), maxStr))}` : ''}${!added.length && !removed.length ? 'reordered' : ''}`;
  }
  return `${path}: ${line(clip(before ?? null, maxStr))} → ${line(clip(after ?? null, maxStr))}`;
}

/** The agent's changes as text lines: + created, ~ updated (with the record it changed), - deleted, = replaced value.
 *  Updates that only touched read flags or timestamps are counted on one line. */
export function renderChanges(diff, initialWorld, { capChars = 30000, maxStr = 1500 } = {}) {
  const out = [], touchedOnly = new Map();
  for (const c of diff?.changes ?? []) {
    const where = `${c.app}.${c.coll}`;
    if (c.op === 'created') out.push(`+ created ${where} id=${c.id}: ${line(clip(compact(c.record ?? {}), maxStr))}`);
    else if (c.op === 'deleted') out.push(`- deleted ${where} id=${c.id}: ${line(clip(compact(c.record ?? c.ref ?? {}), 400))}`);
    else if (c.op === 'set') out.push(`= replaced ${where}: ${line(clip(c.from ?? null, 400))} → ${line(clip(c.to ?? null, maxStr))}`);
    else if (c.op === 'updated') {
      const fields = Object.entries(c.fields ?? {});
      const meaningful = fields.filter(([p]) => !TOUCH.test(p.split('.').at(-1)));
      if (!meaningful.length) { touchedOnly.set(where, (touchedOnly.get(where) ?? 0) + 1); continue; }
      const rec = findRecord(initialWorld, c.app, c.coll, c.id);
      const changed = new Set(meaningful.map(([p]) => p.split('.')[0]));
      const ident = rec ? Object.fromEntries(Object.entries(compact(rec)).filter(([k]) => !changed.has(k) && !TOUCH.test(k))) : (c.ref ?? null);
      out.push(`~ updated ${where} id=${c.id}${ident ? ` (record before: ${line(clip(ident, 160)).slice(0, 500)})` : ''}: ${meaningful.map(([p, [b, a]]) => fieldChange(p, b, a, maxStr)).join(' | ')}`);
    } else out.push(`? ${c.op} ${where} id=${c.id ?? ''}`);
  }
  for (const [where, n] of touchedOnly) out.push(`(${n} ${where} record${n === 1 ? '' : 's'} only had read flags or timestamps changed)`);
  let text = out.join('\n') || '(no changes: the systems are exactly as they were before the agent ran)';
  if (text.length > capChars) text = `${text.slice(0, capChars)}\n[… changes cut at ${capChars} characters]`;
  return { text, n: (diff?.changes ?? []).length };
}

/** The judge's whole input, split into the part shared by every candidate of one task (request + records) and the part
 *  that belongs to one candidate (its changes). view: verifierView(row); initialWorld: loadWorlds(row).initial. */
export function judgeContext(view, initialWorld, { recordsCap = 24000, changesCap = 30000, withRecords = true } = {}) {
  const changedApps = [...new Set((view.diff?.changes ?? []).map(c => c.app))];
  const records = withRecords ? renderRecords(initialWorld, { services: view.services ?? [], extraApps: changedApps, capChars: recordsCap }) : null;
  const changes = renderChanges(view.diff, initialWorld, { capChars: changesCap });
  const shared = `<request>
<agent_instructions>
${view.prompt?.system ?? ''}
</agent_instructions>
<user_request>
${view.prompt?.user ?? ''}
</user_request>
</request>
<environment>
Connected apps: ${(view.services ?? []).join(', ') || 'none'}.
The simulated systems' clock read ${view.today ?? 'unknown'} when they were set up. That clock may not be the task's date: take the task's dates from the request and the records, as the agent had to. Timestamps on records the agent created come from the machine that ran it and are not errors.
</environment>
${withRecords ? `<records_before>
(Each collection is a table: the first line names the columns, each later line is one record. ⏎ marks a line break inside a value, ¦ a | character.)
${records.text}
</records_before>` : '<records_before>(not shown to this judge)</records_before>'}`;
  const candidate = `<changes>
${changes.text}
</changes>`;
  return { shared, candidate, recordsTruncated: records?.truncated ?? null, recordsChars: records?.chars ?? 0, nChanges: changes.n };
}
