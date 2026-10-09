// Declared normalisations for the Home Assistant item (garbage_day_garage). Frozen before scoring (see PREREG.json).
//   G: item-agnostic. Text normalisation (quotes, whitespace), time tolerance 1 s (the item's own declared +-1 s), raw call data compared as is.
//   I: G plus what a person declares about this platform's service calls: which data fields are effect-relevant, how a
//      message split over value1..3 is joined, button titles are a set, durations are seconds, solver-chosen action ids and icons are cosmetic.
import { parseDuration, textNorm } from '../lib/conformance.mjs';

export const G = { name: 'G', timeTolerance: 1, order: 'auto' };

const LIVING_ROOM = 'media_player.livingroomcc';
export const I = {
  name: 'I:ha', timeTolerance: 1, order: 'auto',
  fieldRules: { buttons: 'set', entities: 'set' },
  keyMap(type, key) {
    const d = key.data ?? {};
    switch (type) {
      case 'ha.service:script.notify_engine_two_button':
        return { who: d.who ?? 'family', title: d.title ?? '', text: [d.value1, d.value2, d.value3].filter(x => x != null && x !== '').join(' '), group: d.group ?? '', tag: d.tag ?? '', level: d.level || 'active',
          buttons: [[d.title1, d.action1], [d.title2, d.action2]].filter(([, a]) => a != null && String(a) !== '').map(([t]) => t) };
      case 'ha.service:script.speech_engine': {
        const mp = [].concat(d.media_player ?? []).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean);
        return { text: d.value1 ?? '', player: mp.length === 0 || (mp.length === 1 && mp[0] === LIVING_ROOM) ? '' : mp.sort().join(',') };
      }
      case 'ha.service:notify.alexa_media_garage': return { text: d.message ?? '', type: d.data?.type ?? '' };
      case 'ha.service:timer.start': return { entities: key.entities, seconds: d.duration === undefined ? 1800 : parseDuration(d.duration) };
      case 'ha.service:script.send_to_logbook': return { topic: d.topic ?? '', text: d.message ?? '' };
      default: return { entities: key.entities, data: d };
    }
  },
};
export const sources = { textNorm: textNorm.name };
