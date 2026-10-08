// The owner's Home Assistant as this job sees it: two garage covers, group.garage_doors, the snooze timer, Carlo's phone,
// and the four helper services the automation calls. Built on ha-core.mjs. Deterministic, no I/O.
import { HAMock, installTimer, PRI } from './ha-core.mjs';
import { CONFIG, RECORDED, SPEC, norm } from '../spec.mjs';

const { covers, group, snoozeTimer: timer, family } = CONFIG.entities;

// Home Assistant's group of covers: 'open' when any member is open, 'closed' when all are closed.
function groupState(w) {
  const s = covers.map(c => w.states.get(c).state);
  return s.some(x => x === 'open') ? 'open' : s.every(x => x === 'closed') ? 'closed' : 'unknown';
}

export function buildGarageWorld({ start, faults = [] }) {
  const w = new HAMock({ start, recorded: RECORDED, faults });
  for (const c of covers) w.init(c, 'closed');
  w.init(group, 'closed');
  w.init(family, 'home');
  installTimer(w, timer, CONFIG.timer.defaultSeconds);
  w.phone = { current: null, history: [] };

  // script.notify_engine_two_button: pushes to the phone named by `who`. Buttons are the (title, action) pairs whose action is non-empty.
  w.register('script.notify_engine_two_button', (world, rec) => {
    const d = rec.data;
    const message = norm([d.value1, d.value2, d.value3].filter(x => x != null && x !== '').join(' '));
    const buttons = [[d.title1, d.action1], [d.title2, d.action2]].filter(([, a]) => a != null && String(a) !== '').map(([title, action]) => ({ title: String(title ?? ''), action: String(action) }));
    if ((d.who ?? 'family') !== CONFIG.phone.who) { world.log.push({ t: world.t, kind: 'push-elsewhere', who: d.who ?? 'family' }); return undefined; }
    const n = { t: world.t, tag: d.tag ?? '', title: d.title ?? '', message, buttons };
    world.phone.history.push(n);
    world.phone.current = n;
    return undefined;
  });
  w.register('script.speech_engine', (world, rec) => { world.log.push({ t: world.t, kind: 'speech', text: norm(rec.data.value1) }); return undefined; });
  w.register('script.send_to_logbook', (world, rec) => {
    if (norm(rec.data.topic) !== '' && norm(rec.data.message) !== '') world.log.push({ t: world.t, kind: 'logbook', name: norm(rec.data.topic), message: norm(rec.data.message) });
    return undefined;       // the helper silently stops on blank fields, as the real one does
  });
  w.register('notify.alexa_media_garage', (world, rec) => {
    if (norm(rec.data.message) === '') return { status: 400, body: { error: 'INVALID_DATA', message: 'message is required' } };
    world.log.push({ t: world.t, kind: 'announce', text: norm(rec.data.message) });
    return undefined;
  });

  // Scripted people and devices.
  w.applyScript = entry => {
    switch (entry.do) {
      case 'cover': {
        const id = SPEC.ids.covers[entry.door];
        if (!id) throw new Error(`scenario script: unknown door ${entry.door}`);
        w.setState(id, entry.state);
        w.setState(group, groupState(w));
        return;
      }
      case 'tap': {
        const b = w.phone.current?.buttons.find(x => norm(x.title).toLowerCase() === norm(entry.button).toLowerCase());
        w.log.push({ t: w.t, kind: 'tap', button: entry.button, delivered: !!b, ...(b ? { action: b.action } : {}) });
        if (b) w.fire(SPEC.ids.snoozeEvent, { action: b.action });
        return;
      }
      case 'timer_start': {
        // Another automation or script starts the shared timer; it is not a call the solver made, so it is not in the recorder.
        const rec = { entity_ids: [SPEC.ids.timer], data: { duration: entry.seconds }, target: {} };
        w.services.get('timer.start')(w, rec);
        w.log.push({ t: w.t, kind: 'external-timer-start', seconds: entry.seconds });
        return;
      }
      case 'foreign_action':
        w.log.push({ t: w.t, kind: 'foreign-action', action: entry.action });
        w.fire(SPEC.ids.snoozeEvent, { action: entry.action });
        return;
      default: throw new Error(`scenario script: unknown step ${entry.do}`);
    }
  };
  w.scheduleScript = script => { for (const e of script) w.schedule(e.t, PRI.script, 'script', { entry: e }); };
  return w;
}
