// Adapter: n8n:12679 Zoho <-> KlickTipp contact sync (pilot P2). The effect log is the STATE DELTA each effective write call produced in
// the two mock systems (created / updated / deleted records, field values after the write, tag sets), with record ids replaced by the
// record's email and cross-system link ids replaced by the partner record's email. Stream = the person (email). Case = scenario.
// Expected log = the call-for-call transcription of the author's definition (identical to the executed definition on 40/40 instances,
// item README; the corpus file needed to execute the definition is not on this laptop).
const ROOT = new URL('../../../../../experiments/replicate/items/n8n-12679/', import.meta.url);
const imp = rel => import(new URL(rel, ROOT).href);

export const meta = { id: 'n8n12679', title: 'n8n:12679 Zoho/KlickTipp sync (P2)', variant: 'T2', difficulty: 3, split: 'dev', logUnit: 'state delta of an effective write, per person' };
let M;
export async function init() {
  if (M) return M;
  const [idx, env, ref, broken, spec, sc] = await Promise.all(['index.mjs', 'env.mjs', 'controls/reference.mjs', 'controls/broken.mjs', 'spec.mjs', 'scenarios.mjs'].map(imp));
  M = { idx, env, ref, broken, spec, CONFIG: sc.CONFIG };
  return M;
}
export const taskFor = (seed, variant = meta.variant) => M.idx.generate({ seed, split: meta.split, difficulty: meta.difficulty, variant });

const ZF = () => M.CONFIG.klicktipp.fields.zohoContactId;
function views(snap) {
  const zoho = new Map(snap.world.zoho.contacts), kt = new Map(snap.world.kt.subs);
  return { zoho, kt, zEmail: id => zoho.get(id)?.Email ?? `z#${id}`, kEmail: id => kt.get(id)?.email ?? `k#${id}` };
}
function cleanZ(rec, v) {
  const o = {};
  for (const [k, x] of Object.entries(rec)) {
    if (['id', 'Created_Time', 'Modified_Time', 'Modified_By', 'Full_Name', 'Email'].includes(k)) continue;
    if (k === 'Tag') o.Tag = (x ?? []).map(t => t.name).sort();
    else if (k === 'KlickTipp_ID') o.link = x ? v.kEmail(String(x)) : null;
    else o[k] = x;
  }
  return o;
}
function cleanK(rec, v) {
  const o = { status: rec.status, listId: rec.listId, tags: [...rec.tags].sort() };
  for (const [k, x] of Object.entries(rec.fields ?? {})) { if (k === ZF()) o.link = x ? v.zEmail(String(x)) : null; else o[k] = x; }
  return o;
}
const diff = (a, b) => { const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) o[k] = b[k] ?? null; return o; };

function deltas(before, after, sc) {
  const vb = views(before), va = views(after), out = [];
  for (const [sys, mb, ma, cl, em] of [['zoho', vb.zoho, va.zoho, cleanZ, r => r.Email], ['klicktipp', vb.kt, va.kt, cleanK, r => r.email]]) {
    for (const [id, rec] of ma) {
      const old = mb.get(id);
      const nowv = cl(rec, va);
      if (!old) out.push({ case: sc, stream: em(rec), type: `${sys}.create`, key: { email: em(rec), ...nowv } });
      else {
        const was = cl(old, vb), d = diff(was, nowv);
        if (em(old) !== em(rec)) d.email = em(rec);
        if (Object.keys(d).length) out.push({ case: sc, stream: em(old), type: `${sys}.update`, key: { email: em(rec), ...d } });
      }
    }
    for (const [id, rec] of mb) if (!ma.has(id)) out.push({ case: sc, stream: em(rec), type: `${sys}.delete`, key: { email: em(rec) } });
  }
  return out;
}

export function logOf(task, output) {
  const env = M.env.createEnv(task);
  env.reset();
  const ev = [];
  for (const a of output.actions) {
    if (env.observe().done) break;
    const isWrite = a.call !== 'done' && /^(zoho\.(createContact|updateContact|bulkUpdate|deleteContact|addTags)|klicktipp\.(subscribe|updateSubscriber|deleteSubscriber|tag))$/.test(a.call);
    const before = isWrite ? env.snapshot() : null;
    env.step(a);
    if (isWrite) {
      const recs = env._records(), sr = recs[recs.length - 1], c = sr.calls[sr.calls.length - 1];
      if (c?.effective) ev.push(...deltas(before, env.snapshot(), sr.id));
    }
  }
  while (!env.observe().done) env.step({ call: 'done' });
  return ev;
}
export const expectedLog = task => logOf(task, M.env.driveSync(task, M.ref.makeFaithful(M.CONFIG)));
export const oracleOf = (task, output) => { const r = M.idx.oracle(task, output); return { pass: r.pass, score: r.score }; };

// ---- designs copied from the item's own adversarial tests (experiments/replicate/items/n8n-12679/item.test.mjs, "adversarial verification") ----
const wrapApi = (api, f) => { const out = { state: api.state }; for (const svc of ['zoho', 'klicktipp']) out[svc] = Object.fromEntries(Object.entries(api[svc]).map(([k, fn]) => [k, a => f(`${svc}.${k}`, structuredClone(a ?? {}), fn, api)])); return out; };
const via = f => { const base = M.ref.makeFaithful(M.CONFIG); return (e, api) => base(e, wrapApi(api, (n, a, fn, raw) => f(n, a, fn, raw, e))); };
function altDesign() {
  const K = M.CONFIG.klicktipp, zf = K.fields.zohoContactId, ok = r => r.status < 300, nz = v => (v == null ? '' : String(v));
  const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const berlinMidnight = iso => { const [y, m, d] = iso.split('-').map(Number); for (const off of [1, 2]) { const t = Date.UTC(y, m - 1, d, -off); if (berlin.format(new Date(t)).endsWith('00')) return String(t / 1000); } throw new Error('no Berlin midnight'); };
  const berlinIso = u => (u === '' ? null : berlin.format(new Date(Number(u) * 1000)).slice(0, 10));
  return (e, api) => {
    if (e.trigger.startsWith('zoho')) {
      const b = e.data.body; if (b.modifiedBy === M.CONFIG.apiUserName) return;
      if (e.trigger === 'zoho-deleted') { if (b.email) { const g = api.klicktipp.getSubscriber({ email: b.email }); if (ok(g)) api.klicktipp.deleteSubscriber({ id: g.body.id }); } return; }
      const g = api.zoho.getContact({ id: b.id }); if (!ok(g)) return; const z = g.body.data[0]; if (!z.Email) return;
      const form = e.trigger === 'zoho-form';
      const fields = { [zf]: z.id, fieldFirstName: nz(z.First_Name), fieldLastName: nz(z.Last_Name), fieldPhone: nz(z.Phone), fieldMobilePhone: nz(z.Mobile), fieldPrivatePhone: nz(z.Home_Phone), fieldFax: nz(z.Fax),
        fieldBirthday: z.Date_of_Birth ? berlinMidnight(z.Date_of_Birth) : '', fieldCountry: nz(z.Mailing_Country), fieldState: nz(z.Mailing_State), fieldCity: nz(z.Mailing_City), fieldStreet1: nz(z.Mailing_Street), fieldZip: nz(z.Mailing_Zip) };
      let r = z.KlickTipp_ID ? api.klicktipp.updateSubscriber({ id: z.KlickTipp_ID, email: z.Email, fields }) : null;
      if (!r || !ok(r)) r = api.klicktipp.subscribe({ email: z.Email, listId: form ? K.lists.doi.id : K.lists.soi.id, tagId: form ? K.tags.createdViaForm.id : K.tags.created.id, fields });
      if (!ok(r)) return;
      const optOut = r.body.status !== 'Subscribed';
      if (z.KlickTipp_ID !== r.body.id || z.Email_Opt_Out !== optOut) api.zoho.updateContact({ id: z.id, fields: { KlickTipp_ID: r.body.id, Email_Opt_Out: optOut } });
      const has = name => z.Tag.some(t => t.name.toLowerCase() === name.toLowerCase());
      const toKt = M.CONFIG.segments.filter(sg => has(sg.zohoTag) && !r.body.tags.includes(K.tags[sg.klicktippTag].id)).map(sg => K.tags[sg.klicktippTag].id);
      if (toKt.length) api.klicktipp.tag({ email: z.Email, tagIds: toKt });
      const toZoho = M.CONFIG.segments.filter(sg => !has(sg.zohoTag) && r.body.tags.includes(K.tags[sg.klicktippTag].id)).map(sg => ({ name: sg.zohoTag }));
      if (toZoho.length) api.zoho.addTags({ ids: [z.id], tags: toZoho });
      return;
    }
    if (e.trigger === 'kt-deleted') { if (e.data[zf]) api.zoho.deleteContact({ id: e.data[zf] }); return; }
    const g = api.klicktipp.getSubscriber({ id: e.data.id }); if (!ok(g)) return; const s = g.body; if (!s.fieldLastName) return;
    const fields = { Email: s.email, First_Name: s.fieldFirstName, Last_Name: s.fieldLastName, Phone: s.fieldPhone, Mobile: s.fieldMobilePhone, Home_Phone: s.fieldPrivatePhone, Fax: s.fieldFax, Date_of_Birth: berlinIso(s.fieldBirthday),
      Mailing_Country: s.fieldCountry, Mailing_State: s.fieldState, Mailing_City: s.fieldCity, Mailing_Street: s.fieldStreet1, Mailing_Zip: s.fieldZip, KlickTipp_ID: s.id, Email_Opt_Out: s.status !== 'Subscribed' };
    let zid = s[zf];
    if (zid && !ok(api.zoho.updateContact({ id: zid, fields }))) zid = null;
    if (!zid) { const c = api.zoho.createContact({ fields }); if (!ok(c)) return; zid = c.body.data[0].details.id; api.klicktipp.updateSubscriber({ id: s.id, fields: { [zf]: zid } }); }
    const tags = M.CONFIG.segments.filter(sg => s.tags.includes(K.tags[sg.klicktippTag].id)).map(sg => ({ name: sg.zohoTag }));
    if (tags.length) api.zoho.addTags({ ids: [zid], tags });
  };
}

export function candidates() {
  const K = M.CONFIG.klicktipp, { ZOHO_OF, KT_OF } = M.spec;
  const drv = h => t => M.env.driveSync(t, h);
  const forget = [];
  for (const [key, zohoName] of Object.entries(ZOHO_OF)) {
    if (key === 'email') continue;
    forget.push({ id: `n8n12679/W1 forgets ${key} KT->Zoho`, h: via((n, a, fn) => { if (n === 'zoho.updateContact' && a.fields) delete a.fields[zohoName]; return fn(a); }) });
    if (key !== 'last') forget.push({ id: `n8n12679/W1 forgets ${key} Zoho->KT`, h: via((n, a, fn) => { if (n === 'klicktipp.updateSubscriber' && a.fields && Object.keys(a.fields).length > 1) delete a.fields[KT_OF[key]]; return fn(a); }) });
  }
  const bad = name => M.broken.BROKEN.find(x => x.name === name);
  return [
    { id: 'n8n12679/faithful', kind: 'reference', make: drv(M.ref.makeFaithful(M.CONFIG)) },
    { id: 'n8n12679/improved (live-record design)', kind: 'control-correct', make: drv(M.ref.makeImproved(M.CONFIG)) },
    ...forget.map(f => ({ id: f.id, cls: 'N12-W1', kind: 'class-wrong', decidedBy: 'battery', make: drv(f.h) })),
    { id: 'n8n12679/W2 empty-values-never-written', cls: 'N12-W2', kind: 'class-wrong', decidedBy: 'battery', make: drv(via((n, a, fn) => { if (a.fields) for (const k of Object.keys(a.fields)) if (a.fields[k] === '' || a.fields[k] === null) delete a.fields[k]; return fn(a); })) },
    { id: 'n8n12679/W3 case-sensitive-zoho-segment-tags', cls: 'N12-W3', kind: 'class-wrong', decidedBy: 'battery', make: drv(via((n, a, fn) => { const r = fn(a); if (n === 'zoho.getContact' && r.status === 200) for (const rec of r.body.data) rec.Tag = rec.Tag.filter(t => M.CONFIG.segments.some(s => s.zohoTag === t.name)); return r; })) },
    { id: 'n8n12679/W4 kt-segments-to-zoho-on-create-only', cls: 'N12-W4', kind: 'class-wrong', decidedBy: 'battery', make: drv(via((n, a, fn, raw, e) => (n === 'zoho.addTags' && e.trigger === 'kt-tagged' && e.data[K.fields.zohoContactId] ? { status: 200, body: { data: [] } } : fn(a)))) },
    { id: 'n8n12679/W5 form-tag-on-every-new-subscriber', cls: 'N12-W5', kind: 'class-wrong', decidedBy: 'battery', make: drv(via((n, a, fn) => { if (n === 'klicktipp.subscribe') a.tagId = [K.tags.created.id, K.tags.createdViaForm.id]; return fn(a); })) },
    { id: 'n8n12679/W6 bookkeeping-tag-on-every-zoho-contact', cls: 'N12-W6', kind: 'class-wrong', decidedBy: 'battery', make: drv(via((n, a, fn, raw) => { const r = fn(a); if (n === 'zoho.bulkUpdate' && r.status === 200) for (const x of r.body.data) if (x.status === 'success') raw.zoho.addTags({ ids: [x.details.id], tags: [{ name: 'Synced by bot' }] }); return r; })) },
    { id: 'n8n12679/C1 berlin-midnight-birthdays (alternative design)', cls: 'N12-C1', kind: 'class-correct', decidedBy: 'comparison', make: drv(altDesign()) },
    ...M.broken.BROKEN.filter(x => !['shuffled-or-corrupted'].includes(x.name)).map(x => ({ id: `n8n12679/bad ${x.name}`, kind: 'control-wrong', make: t => x.make(t) })),
  ];
}
