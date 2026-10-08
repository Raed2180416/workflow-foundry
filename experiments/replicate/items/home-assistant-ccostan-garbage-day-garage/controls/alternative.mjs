// An independently structured valid solution, to show the oracle judges effects and not construction: no closure state (everything lives
// in kv, so a fresh process per event would do), its own button action ids, its own wake ids, run cancellation by generation instead of
// sched.cancel, the message split over value1/value2 (with a typographic apostrophe), the buttons in the other order, an explicit
// media_player, the snooze entity in data instead of target, the duration as a number of seconds, icons on the buttons. Async handler.
// Passes the same batteries as the faithful reference.
const GARBAGE = ['wed', 'sun'];
const IDS = { half: 'SNZ_HALF_HOUR', two: 'SNZ_TWO_HOURS' };
const TIMER = 'timer.garbage_reminder_snooze', GROUP = 'group.garage_doors';

export function makeAlternative() {
  return () => async function handler(event, api) {
    const read = key => { const r = api.kv.get({ key }); return r.status === 200 ? r.body.value : null; };
    const write = (key, value) => api.kv.put({ key, value });
    const stateOf = id => { const r = api.ha.get_state({ entity_id: id }); return r.status === 200 ? r.body.state : null; };

    if (event.type === 'state_changed' && event.entity_id === GROUP) {
      if (event.old_state === 'closed' && event.new_state === 'open') {
        write('armed', event.at.epoch);
        api.sched.set({ id: `arm:${event.at.epoch}`, afterSeconds: 20 });
      } else write('armed', null);                       // any other change disarms; the pending wake finds nobody armed
      return;
    }
    if (event.type === 'wake' && event.id.startsWith('arm:')) {
      if (read('armed') !== Number(event.id.slice(4))) return;
      write('armed', null);
      if (!GARBAGE.includes(event.at.weekday) || stateOf(TIMER) !== 'idle') return;
      const gen = (read('gen') ?? 0) + 1;
      write('gen', gen);
      const first = 'Reminder: it\u2019s garbage day.';             // typographic apostrophe (v0.2.0: read as ASCII by the oracle)
      const rest = [event.at.weekday === 'wed' ? 'Both recycling and regular garbage go out today.' : null, 'Please take the cans to the curb before you leave.'].filter(Boolean).join(' ');
      write('run', { gen, text: `${first} ${rest}` });
      api.ha.call_service({ service: 'script.notify_engine_two_button', data: { title: 'Garbage Day Reminder', value1: first, value2: rest, who: 'carlo', group: 'Garbage_Reminders', tag: 'garbage_day_reminder', level: 'active', title1: 'Snooze 2h', action1: IDS.two, icon1: 'sfsymbols:clock.badge.checkmark', title2: 'Snooze 30m', action2: IDS.half, icon2: 'sfsymbols:clock' } });
      api.ha.call_service({ service: 'script.speech_engine', data: { value1: `${first} ${rest}`, media_player: 'media_player.livingroomcc' } });
      api.sched.set({ id: `ann:${gen}:0`, afterSeconds: 30 });
      return;
    }
    if (event.type === 'wake' && event.id.startsWith('ann:')) {
      const [, g, s] = event.id.split(':').map(Number).length === 3 ? ['', ...event.id.split(':').slice(1).map(Number)] : [];
      const run = read('run');
      if (!run || run.gen !== g) return;                  // replaced or stopped
      // a failed check skips only this announcement (documented Home Assistant: a condition inside repeat ends the round)
      const pass = stateOf(GROUP) === 'open' && GARBAGE.includes(event.at.weekday) && stateOf(TIMER) === 'idle';
      if (pass) api.ha.call_service({ service: 'notify.alexa_media_garage', data: { message: run.text, data: { type: 'announce' } } });
      if (s < 2) api.sched.set({ id: `ann:${g}:${s + 1}`, afterSeconds: [60, 90][s] });
      else write('run', null);
      return;
    }
    if (event.type === 'event' && event.event_type === 'mobile_app_notification_action') {
      const key = { [IDS.half]: 1800, [IDS.two]: 7200 }[event.data?.action];
      if (!key) return;
      write('run', null);
      api.ha.call_service({ service: 'timer.start', data: { entity_id: TIMER, duration: key } });
      api.ha.call_service({ service: 'script.send_to_logbook', data: { topic: 'GARBAGE', message: `Garbage reminders snoozed for ${key === 1800 ? '30 minutes' : '2 hours'} from Carlo's phone.` } });
    }
  };
}
