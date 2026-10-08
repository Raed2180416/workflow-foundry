// Worked examples for the T2 task (and the event-shape samples for all variants), generated from a fixed example seed with the
// call-for-call transcription. They show inputs (what people did, which events arrived) and outputs (the state both systems
// ended in). They are data about a DIFFERENT seed than any graded task, so they reveal the job but not the held-out data.
import { driveSync, replay } from './env.mjs';
import { CONFIG } from './scenarios.mjs';
import { makeFaithful } from './controls/reference.mjs';
import { zohoNeutral, ktNeutral } from './spec.mjs';

export const EXAMPLE_TASK = Object.freeze({ seed: 'examples', split: 'dev', difficulty: 2, variant: 'T2' });
export const EXAMPLE_IDS = ['S01', 'S03', 'S05', 'S07'];

const tidy = state => ({
  zoho: state.zoho.map(r => ({ id: r.id, ...zohoNeutral(r), KlickTipp_ID: r.KlickTipp_ID, Email_Opt_Out: r.Email_Opt_Out, tags: r.Tag.map(t => t.name) })),
  klicktipp: state.kt.map(s => ({ id: s.id, ...ktNeutral(s), status: s.status, listId: s.listId, tags: s.tags, [CONFIG.klicktipp.fields.zohoContactId]: s[CONFIG.klicktipp.fields.zohoContactId] })),
});
const NOUN = { 'zoho.create': 'a person creates a contact in Zoho CRM', 'zoho.form': 'a web-form submission creates a contact in Zoho CRM', 'zoho.edit': 'a person edits a contact in Zoho CRM', 'zoho.delete': 'a person deletes a contact in Zoho CRM', 'zoho.seed': 'already there before the run (Zoho CRM)',
  'kt.create': 'a person creates a subscriber in KlickTipp and the automation tags it for sync', 'kt.edit': 'a person edits a subscriber in KlickTipp and the automation tags it for sync', 'kt.unsubscribe': 'a person unsubscribes a subscriber in KlickTipp and the automation tags it for sync',
  'kt.confirm': 'a subscriber confirms the double opt-in in KlickTipp', 'kt.delete': 'a person deletes a subscriber in KlickTipp', 'kt.activate': 'the automation tags a subscriber for sync', 'kt.seed': 'already there before the run (KlickTipp)' };
const summarise = a => ({ what: NOUN[`${a.sys}.${a.op}`] ?? `${a.sys}.${a.op}`, ...(a.person ? { fields: a.person } : {}), ...(a.set ? { changes: a.set } : {}), ...(a.segs?.length ? { segmentTags: a.segs } : {}), ...(a.ref ? { contact: a.ref } : {}) });

export function buildExamples() {
  const out = driveSync(EXAMPLE_TASK, makeFaithful(CONFIG));
  const { env } = replay(EXAMPLE_TASK, out.actions);
  const recs = env._records(), list = env._scenarios();
  const scenarios = EXAMPLE_IDS.map(id => {
    const i = list.findIndex(s => s.id === id), sc = list[i], rec = recs[i];
    return {
      title: sc.title,
      before: sc.setup.length ? sc.setup.map(summarise) : undefined,
      steps: sc.steps.map((st, k) => ({
        happens: st.actions.map(summarise),
        eventsDelivered: rec.events.filter(e => e.step === k).map(e => ({ trigger: e.trigger, data: e.data.body ? { body: e.data.body } : e.data })),   // webhook headers/params/query omitted here; see eventSamples
        resultingState: tidy(rec.steps[k].state),
      })),
    };
  });
  const sample = {};
  for (const e of recs.flatMap(r => r.events)) if (e.origin === 'ui') sample[e.trigger] ??= e.data;
  return { task: EXAMPLE_TASK, scenarios, eventSamples: sample, replayTrace: out.actions };
}
