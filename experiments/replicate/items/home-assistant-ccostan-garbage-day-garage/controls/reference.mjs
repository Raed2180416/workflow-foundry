// Reference solutions written by hand from the job description (NOT by interpreting the YAML; that is controls/original-engine.mjs).
//   makeFaithful(opts)  a transcription of the author's logic as an event handler. With default options it behaves like the original
//                       under Home Assistant semantics, including aborting the whole run at the first failed action.
//   makeImproved(opts)  the T3 reference: the same job, but a failed service call does not end the sequence, door state is tracked from
//                       the events instead of being re-read, and old runs are cancelled explicitly by generation.
// The options exist so that broken controls (controls/broken.mjs) are the same code with one decision changed.
// A solution is a factory: create() -> handler(event, api); the factory is called again for every scenario.
import { SPEC, TEXT } from '../spec.mjs';

const DEFAULTS = Object.freeze({
  debounce: SPEC.debounceSeconds,   // 0: no debounce, the reminder starts when the door opens
  weekdayRule: 'at-fire',           // 'at-fire' | 'at-open' | 'never'
  startTimerCheck: true,
  loopDoor: true, loopWeekday: true, loopTimer: true,
  stopOnFail: true,                 // false: a failed check skips that announcement and the run goes on
  restartKills: true,               // a new reminder cancels the one in progress
  singleMode: false,                // a new reminder is ignored while one is in progress
  snoozeKills: true,                // a snooze tap cancels the reminder in progress
  snoozeStartsTimer: true,
  logbook: true,
  actionMatch: 'exact',             // 'exact' | 'any' | 'prefix'
  offsets: SPEC.announceOffsets,    // seconds after the reminder started
  message: 'auto',                  // 'auto' | 'always-recycling' | 'never-recycling'
  snoozeSeconds: SPEC.snooze,
  push: true, speech: true, announce: true,
  abortOnError: true,               // HA: an action that raises ends the run (unless continue_on_error)
  trackDoor: false,                 // improved: the door state comes from the events, not from reads
  polling: 0,                       // >0: poll every N seconds instead of scheduling the exact instants (cost control)
});

const ACTION = { '30m': 'SNOOZE_GARBAGE_REMINDERS_30M', '2h': 'SNOOZE_GARBAGE_REMINDERS_2H' };
const ok = r => r && r.status < 400;

export function makeFaithful(options = {}) {
  const o = { ...DEFAULTS, ...options };
  return function create() {
    let pendingDebounce = false, openedWeekday = null, doorOpen = null, nextRun = 0;
    const runs = new Map();           // run id -> {step, message, startedAt}
    const text = wd => (o.message === 'always-recycling' ? TEXT.reminder('wed') : o.message === 'never-recycling' ? TEXT.reminder('sun') : TEXT.reminder(wd));
    const service = (api, service, data, target) => api.ha.call_service({ service, ...(target ? { target } : {}), data });

    const endRun = (api, id) => { runs.delete(id); };
    const killAll = api => { for (const id of runs.keys()) api.sched.cancel({ id: `seq:${id}` }); runs.clear(); };

    const startRun = (event, api) => {
      const wd = event.at.weekday;
      if (runs.size) { if (o.singleMode) return; if (o.restartKills) killAll(api); }      // mode: a new trigger acts before its conditions are evaluated
      if (o.weekdayRule !== 'never' && !SPEC.garbageDays.includes(o.weekdayRule === 'at-open' ? openedWeekday : wd)) return;
      if (o.startTimerCheck) { const t = api.ha.get_state({ entity_id: SPEC.ids.timer }); if (!ok(t) || t.body.state !== 'idle') return; }
      const id = ++nextRun;
      const message = text(wd);
      runs.set(id, { step: 0, message });
      let failed = false;
      if (o.push) failed = !ok(service(api, 'script.notify_engine_two_button', {
        title: SPEC.push.title, value1: message, who: SPEC.push.who, group: SPEC.push.group, tag: SPEC.push.tag, level: SPEC.push.level,
        title1: SPEC.buttons['30m'], action1: ACTION['30m'], title2: SPEC.buttons['2h'], action2: ACTION['2h'],
      })) || failed;
      if (o.speech) failed = !ok(service(api, 'script.speech_engine', { value1: message })) || failed;
      if (failed && o.abortOnError) { endRun(api, id); return; }
      if (o.polling) api.sched.set({ id: `seq:${id}`, afterSeconds: o.polling });
      else api.sched.set({ id: `seq:${id}`, afterSeconds: o.offsets[0] });
      runs.get(id).startedAt = event.at.epoch;
    };

    const onSeq = (event, api, id) => {
      const run = runs.get(id);
      if (!run) return;                                              // stale wake of a run that has ended
      if (o.polling) {                                               // control: busy-poll, announce when an offset has been reached
        const elapsed = event.at.epoch - run.startedAt;
        if (run.step < o.offsets.length && elapsed >= o.offsets[run.step]) return announceStep(event, api, id, run);
        api.sched.set({ id: `seq:${id}`, afterSeconds: o.polling });
        return;
      }
      announceStep(event, api, id, run);
    };
    const announceStep = (event, api, id, run) => {
      let pass = true;
      if (o.loopDoor) {
        if (o.trackDoor) pass = doorOpen === true;
        else { const d = api.ha.get_state({ entity_id: SPEC.ids.group }); pass = ok(d) && d.body.state === 'open'; }
      }
      if (pass && o.loopWeekday) pass = SPEC.garbageDays.includes(event.at.weekday);
      if (pass && o.loopTimer) { const t = api.ha.get_state({ entity_id: SPEC.ids.timer }); pass = ok(t) && t.body.state === 'idle'; }
      if (!pass && o.stopOnFail) return endRun(api, id);
      if (pass && o.announce) {
        const r = service(api, 'notify.alexa_media_garage', { message: run.message, data: { type: 'announce' } });
        if (!ok(r) && o.abortOnError) return endRun(api, id);
      }
      run.step++;
      if (run.step >= o.offsets.length) return endRun(api, id);
      api.sched.set({ id: `seq:${id}`, afterSeconds: o.polling || o.offsets[run.step] - o.offsets[run.step - 1] });
    };

    const onAction = (event, api) => {
      const a = String(event.data?.action ?? '');
      let key = null;
      if (a === ACTION['30m']) key = '30m'; else if (a === ACTION['2h']) key = '2h';
      else if (o.actionMatch === 'any') key = '30m';
      else if (o.actionMatch === 'prefix' && a.startsWith('SNOOZE_GARBAGE_REMINDERS')) key = a.endsWith('2H') ? '2h' : '30m';
      if (!key) return;
      if (o.snoozeKills) killAll(api);
      if (o.snoozeStartsTimer) {
        const r = service(api, 'timer.start', { duration: durationText(o.snoozeSeconds[key]) }, { entity_id: SPEC.ids.timer });
        if (!ok(r) && o.abortOnError) return;
      }
      if (o.logbook) service(api, 'script.send_to_logbook', { topic: SPEC.logbookTopic, message: TEXT.snoozeLog(TEXT.label[key]) });
    };

    return (event, api) => {
      if (event.type === 'state_changed' && event.entity_id === SPEC.ids.group) {
        doorOpen = event.new_state === 'open';
        if (pendingDebounce) { api.sched.cancel({ id: 'debounce' }); pendingDebounce = false; }
        if (event.old_state === 'closed' && event.new_state === 'open') {
          openedWeekday = event.at.weekday;
          if (o.debounce > 0) { api.sched.set({ id: 'debounce', afterSeconds: o.debounce }); pendingDebounce = true; }
          else startRun(event, api);
        }
      } else if (event.type === 'wake') {
        if (event.id === 'debounce') { pendingDebounce = false; startRun(event, api); }
        else if (event.id.startsWith('seq:')) onSeq(event, api, Number(event.id.slice(4)));
      } else if (event.type === 'event' && event.event_type === SPEC.ids.snoozeEvent) onAction(event, api);
    };
  };
}

const durationText = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// T3 reference. Same job; failures do not end the sequence; door state is tracked from events.
export function makeImproved(options = {}) {
  return makeFaithful({ abortOnError: false, trackDoor: true, ...options });
}
