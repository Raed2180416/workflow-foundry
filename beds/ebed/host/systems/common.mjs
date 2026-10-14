// Shared outbound channels (mail, notify). Messages are business records ("letters as sent", E-BED §2.2). An arm may
// place `ref` in a message; a counterparty reply that quotes that exact ref is delivered on the sender instance's
// channel (BED-CONTRACT-v1.1 §3.2) — the only reply routing the host does, and it is by channel identity, not meaning.
import { defineSystem, MockError } from '../mocks.mjs';
import { S } from '../schema.mjs';

const ID = S.str(80, { minLength: 1 });
const REF = S.nullable(S.str(120, { minLength: 1 }));

export const mail = defineSystem({
  id: 'mail',
  description: 'Outbound letters and e-mails to parties (vendors, customers, cardholders). Keyed sends are exactly-once.',
  latencyMinutes: 1,
  tables: {
    messages: { pk: 'messageId', fields: { messageId: ID, to: S.str(120), about: S.nullable(ID), template: S.nullable(S.str(80)),
      subject: S.str(200), body: S.str(20_000), ref: REF, sentAt: S.str(40) } },
  },
  ops: {
    send: {
      description: 'Send one message; `about` names the business object it concerns; `ref` is echoed by replies.',
      args: S.obj({ to: S.str(120, { minLength: 1 }), about: S.nullable(ID), template: S.nullable(S.str(80)), subject: S.str(200), body: S.str(20_000), ref: REF },
        ['to', 'about', 'subject', 'body']),
      keyed: true, subjectArgs: ['about'],
      apply(db, a, ctx) {
        const messageId = db.nextId('MSG');
        db.insert('messages', { messageId, to: a.to, about: a.about, template: a.template ?? null, subject: a.subject, body: a.body, ref: a.ref ?? null, sentAt: ctx.now });
        return { messageId };
      },
    },
  },
});

export const notify = defineSystem({
  id: 'notify',
  description: 'Notifications to users and groups (assignment, escalation, customer updates).',
  latencyMinutes: 1,
  tables: {
    notifications: { pk: 'notificationId', fields: { notificationId: ID, to: S.str(120), about: S.nullable(ID), template: S.str(80), text: S.str(4000), ref: REF, sentAt: S.str(40) } },
  },
  ops: {
    send: {
      args: S.obj({ to: S.str(120, { minLength: 1 }), about: S.nullable(ID), template: S.str(80), text: S.str(4000), ref: REF }, ['to', 'about', 'template', 'text']),
      keyed: true, subjectArgs: ['about'],
      apply(db, a, ctx) {
        if (!a.to.trim()) throw new MockError(400, 'empty-recipient');
        const notificationId = db.nextId('NTF');
        db.insert('notifications', { notificationId, to: a.to, about: a.about, template: a.template, text: a.text, ref: a.ref ?? null, sentAt: ctx.now });
        return { notificationId };
      },
    },
  },
});
