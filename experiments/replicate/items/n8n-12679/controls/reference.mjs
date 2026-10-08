// Known-good control handlers (sync: (event, api) -> void; api is the same call surface candidates get).
//   makeFaithful(cfg, {bugs})  a call-for-call TRANSCRIPTION of the original definition: same calls, same order, same arguments, including the
//                              wasteful and failing ones. Verified against the executed definition (item.test.mjs, run-controls.mjs). It is the
//                              T1/T2 reference solution, the T3 cost baseline, and, with one bug flag set, the near-miss bad controls.
//   makeImproved(cfg)          a T3 solution written from the job, not from the graph: reads the live record instead of the (possibly stale)
//                              event payload, looks the counterpart up before creating, writes each side only when something differs.
import { unixToIso } from '../mocks/common.mjs';

const nz = v => (v === null || v === undefined ? '' : String(v));

// Call-for-call transcription of the original: the same calls, in the same order, with the same arguments, including the
// ones that fail or are wasted (an empty email is sent to KlickTipp and rejected; deleting a record echoes a delete that
// 404s; a missing birthday becomes 1970-01-01). The differential test compares this trace with the one from the executed
// original definition whenever the corpus file is present, so the benchmark can run without it.
const berlinDate = (v, tz = 'Europe/Berlin') => {
  const ms = v * 1000;                                                          // JS coercion, exactly as the definition's expression
  return Number.isFinite(ms) ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)) : 'Invalid Date';
};
export function makeFaithful(cfg, { bugs = {} } = {}) {
  const K = cfg.klicktipp, zf = K.fields.zohoContactId, me = cfg.apiUserName;
  const lists = bugs.swapOptIn ? { soi: K.lists.doi.id, doi: K.lists.soi.id } : { soi: K.lists.soi.id, doi: K.lists.doi.id };
  const created = bugs.swapOptIn ? K.tags.createdViaForm.id : K.tags.created.id, viaForm = bugs.swapOptIn ? K.tags.created.id : K.tags.createdViaForm.id;
  const bodyFields = (b, withId) => ({
    ...(withId ? { [zf]: b.id } : {}), fieldFirstName: b.firstName, fieldLastName: b.lastName, fieldPhone: b.phone, fieldMobilePhone: b.mobile, fieldPrivatePhone: b.homePhone,
    fieldFax: b.fax, fieldBirthday: b.dateOfBirth, fieldCountry: b.mailingCountry, fieldState: b.mailingState, fieldCity: b.mailingCity, fieldStreet1: b.mailingStreet, fieldZip: b.mailingZip,
  });
  const zohoFields = s => ({
    Email: s.email, First_Name: s.fieldFirstName, Last_Name: s.fieldLastName, Phone: s.fieldPhone, Mobile: s.fieldMobilePhone, Home_Phone: s.fieldPrivatePhone, Fax: s.fieldFax,
    Date_of_Birth: berlinDate(s.fieldBirthday), Mailing_Country: s.fieldCountry, Mailing_State: s.fieldState, Mailing_City: s.fieldCity, Mailing_Street: s.fieldStreet1, Mailing_Zip: s.fieldZip,
  });
  const ok = r => r.status >= 200 && r.status < 300;
  const lc = v => String(v ?? '').toLowerCase();
  // Zoho record -> KlickTipp segment tags, one call per segment, in the order of the definition's switch outputs.
  const tagKt = (api, rec) => {
    if (bugs.noSegments) return true;
    for (const sg of cfg.segments) if ((rec.Tag ?? []).some(t => lc(t?.name) === sg.zohoTag.toLowerCase())) { if (!ok(api.klicktipp.tag({ email: rec.Email, tagIds: [K.tags[sg.klicktippTag].id] }))) return false; }
    return true;
  };
  const tagZoho = (api, zohoId, ktTags) => {
    if (bugs.noSegments) return;
    for (const sg of cfg.segments) if ((ktTags ?? []).includes(K.tags[sg.klicktippTag].id)) { if (!ok(api.zoho.addTags({ ids: [zohoId], tags: [{ name: sg.zohoTag }] }))) return; }
  };
  const zohoSide = (event, api) => {
    const b = event.data.body;
    const uiOnly = !bugs.noGuard && b.modifiedBy === me;
    switch (event.trigger) {
      case 'zoho-deleted':                                                       // the original has no guard here
        if (bugs.noDeleteZ) return;
        api.klicktipp.deleteSubscriber({ id: b.klicktippId });
        return;
      case 'zoho-form': {
        if (uiOnly) return;
        const r = api.klicktipp.subscribe({ email: b.email, listId: lists.doi, tagId: viaForm, fields: bodyFields(b, true) });
        if (!ok(r)) return;
        api.zoho.bulkUpdate({ records: [{ id: r.body[zf], ...(bugs.oneWayLink ? {} : { KlickTipp_ID: r.body.id }), Email_Opt_Out: true }] });
        if (bugs.activationEcho) api.klicktipp.tag({ email: b.email, tagIds: [K.tags.activationSend.id] });
        return;
      }
      case 'zoho-created-or-updated': {
        if (uiOnly) return;
        if (!b.klicktippId) {
          const r = api.klicktipp.subscribe({ email: b.email, listId: lists.soi, tagId: created, fields: bodyFields(b, true) });
          if (!ok(r)) return;
          api.zoho.bulkUpdate({ records: [{ id: r.body[zf], ...(bugs.oneWayLink ? {} : { KlickTipp_ID: r.body.id }), Email_Opt_Out: false }] });
          if (bugs.activationEcho) api.klicktipp.tag({ email: b.email, tagIds: [K.tags.activationSend.id] });
        } else {
          if (!ok(api.klicktipp.updateSubscriber({ id: b.klicktippId, email: b.email, fields: bodyFields(b, false) }))) return;
          const st = api.klicktipp.getSubscriber({ id: b.klicktippId });
          if (!ok(st)) return;
          if (!ok(api.zoho.bulkUpdate({ records: [{ id: b.id, Email_Opt_Out: bugs.optOutIgnored ? false : st.body.status !== 'Subscribed' }] }))) return;
        }
        const z = api.zoho.getContact({ id: b.id });
        if (ok(z)) tagKt(api, z.body.data[0]);
        return;
      }
    }
  };
  const ktSide = (event, api) => {
    const s = event.data;
    if (event.trigger === 'kt-deleted') {
      if (bugs.noDeleteK) return;
      api.zoho.deleteContact({ id: s[zf] });
      return;
    }
    let zid;
    if (!s[zf] || bugs.alwaysCreate) {
      const r = api.zoho.createContact({ fields: { ...zohoFields(s), Full_Name: s.fullname, KlickTipp_ID: s.id } });   // the original also sends the computed Full_Name
      if (!ok(r)) return;
      zid = r.body.data[0].details.id;
      if (!ok(api.zoho.bulkUpdate({ records: [{ id: zid, Email_Opt_Out: s.status !== 'Subscribed' }] }))) return;
      if (!bugs.oneWayLink && !ok(api.klicktipp.updateSubscriber({ lookupEmail: s.email, fields: { [zf]: zid } }))) return;
    } else {
      if (!s.fieldLastName) return;
      zid = s[zf];
      if (!ok(api.zoho.updateContact({ id: zid, fields: zohoFields(s) }))) return;
      if (!ok(api.zoho.bulkUpdate({ records: [{ id: zid, Email_Opt_Out: s.status !== 'Subscribed' }] }))) return;
    }
    const kt = api.klicktipp.getSubscriber({ email: s.email });
    if (ok(kt)) tagZoho(api, kt.body[zf] || zid, kt.body.tags);
  };
  return (event, api) => (event.trigger.startsWith('zoho') ? zohoSide(event, api) : ktSide(event, api));
}

export function makeImproved(cfg) {
  const K = cfg.klicktipp, zf = K.fields.zohoContactId, me = cfg.apiUserName;
  const ok = r => r.status >= 200 && r.status < 300;
  const ktOfRecord = z => ({
    [zf]: z.id, fieldFirstName: nz(z.First_Name), fieldLastName: nz(z.Last_Name), fieldPhone: nz(z.Phone), fieldMobilePhone: nz(z.Mobile), fieldPrivatePhone: nz(z.Home_Phone), fieldFax: nz(z.Fax),
    fieldBirthday: nz(z.Date_of_Birth), fieldCountry: nz(z.Mailing_Country), fieldState: nz(z.Mailing_State), fieldCity: nz(z.Mailing_City), fieldStreet1: nz(z.Mailing_Street), fieldZip: nz(z.Mailing_Zip),
  });
  const zohoOfSnap = s => ({
    Email: s.email, First_Name: s.fieldFirstName, Last_Name: s.fieldLastName, Phone: s.fieldPhone, Mobile: s.fieldMobilePhone, Home_Phone: s.fieldPrivatePhone, Fax: s.fieldFax,
    Date_of_Birth: unixToIso(s.fieldBirthday) || null, Mailing_Country: s.fieldCountry, Mailing_State: s.fieldState, Mailing_City: s.fieldCity, Mailing_Street: s.fieldStreet1, Mailing_Zip: s.fieldZip,
  });

  function fromZoho(event, api) {
    const b = event.data.body;
    if (b.modifiedBy === me) return;                                             // our own write coming back: nothing to do
    if (event.trigger === 'zoho-deleted') { if (b.klicktippId) api.klicktipp.deleteSubscriber({ id: b.klicktippId }); return; }
    const form = event.trigger === 'zoho-form';
    const r = api.zoho.getContact({ id: b.id });                                 // live record, not the payload
    if (!ok(r)) return;
    const z = r.body.data[0];
    if (!z.Email) return;
    let sub;
    if (z.KlickTipp_ID) {
      const u = api.klicktipp.updateSubscriber({ id: z.KlickTipp_ID, email: z.Email, fields: ktOfRecord(z) });
      if (ok(u)) sub = u.body;
    }
    if (!sub) {                                                                  // no link yet (or a stale one): subscribe is an upsert by email
      const s = api.klicktipp.subscribe({ email: z.Email, listId: form ? K.lists.doi.id : K.lists.soi.id, tagId: form ? K.tags.createdViaForm.id : K.tags.created.id, fields: ktOfRecord(z) });
      if (!ok(s)) return;
      sub = s.body;
    }
    api.state.put({ key: `dk:${sub.id}`, value: true });                         // we just wrote this subscriber
    const optOut = sub.status !== 'Subscribed';
    if (z.KlickTipp_ID !== sub.id || z.Email_Opt_Out !== optOut) api.zoho.updateContact({ id: z.id, fields: { KlickTipp_ID: sub.id, Email_Opt_Out: optOut } });
    if (!form) {
      const have = new Set(sub.tags), names = (z.Tag ?? []).map(t => nz(t.name).toLowerCase());
      const missing = cfg.segments.filter(s => names.includes(s.zohoTag.toLowerCase())).map(s => K.tags[s.klicktippTag].id).filter(id => !have.has(id));
      if (missing.length) api.klicktipp.tag({ email: sub.email, tagIds: missing });
    }
  }

  function fromKlicktipp(event, api) {
    const snap = event.data;
    if (event.trigger === 'kt-deleted') { if (snap[zf]) api.zoho.deleteContact({ id: snap[zf] }); return; }
    // The payload is a snapshot taken when the tag was applied. If we wrote this subscriber since its last event, that
    // snapshot may be stale (concurrent edit, redelivery): read it live. Otherwise trust it and save the call.
    let s = snap;
    const dirty = api.state.get({ key: `dk:${snap.id}` });
    if (dirty.status === 200 && dirty.body.value) {
      const r = api.klicktipp.getSubscriber({ id: snap.id });
      if (!ok(r)) return;
      s = r.body;
      api.state.put({ key: `dk:${snap.id}`, value: false });
    }
    if (!s.fieldLastName) return;
    const optOut = s.status !== 'Subscribed';
    const fields = { ...zohoOfSnap(s), KlickTipp_ID: s.id, Email_Opt_Out: optOut };
    let zid = null;
    if (s[zf]) { const u = api.zoho.updateContact({ id: s[zf], fields }); if (ok(u)) zid = s[zf]; }
    if (!zid) {
      const f = api.zoho.searchContacts({ email: s.email });                    // link an existing contact instead of duplicating it
      if (f.status === 200) { zid = f.body.data[0].id; api.zoho.updateContact({ id: zid, fields }); }
      else { const c = api.zoho.createContact({ fields }); if (!ok(c)) return; zid = c.body.data[0].details.id; }
      api.klicktipp.updateSubscriber({ id: s.id, fields: { [zf]: zid } });
      api.state.put({ key: `dk:${s.id}`, value: true });
    }
    const tags = cfg.segments.filter(sg => s.tags.includes(K.tags[sg.klicktippTag].id)).map(sg => ({ name: sg.zohoTag }));
    if (tags.length) api.zoho.addTags({ ids: [zid], tags });
  }
  return (event, api) => (event.trigger.startsWith('zoho') ? fromZoho(event, api) : fromKlicktipp(event, api));
}
