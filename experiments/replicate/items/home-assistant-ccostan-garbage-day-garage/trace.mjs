// Normal form of the service-call trace. The oracle compares the normalised calls the mock recorded with the normalised calls a
// scenario expects; neither side depends on how a solution produced its calls.
//  - Only the effect-relevant data counts (icons, interruption sound and similar cosmetics are ignored).
//  - Defaults are applied (an absent level is 'active'; an absent timer duration is the timer's configured 30 minutes).
//  - Durations are compared in seconds, text is compared with whitespace collapsed and typographic quotes read as ASCII ones.
//  - The two push buttons are compared as a set of titles (their order on the phone is not judged).
import { canonical } from '../../../../beds/lib/canonical.mjs';
import { parseDuration } from './mocks/ha-core.mjs';
import { CONFIG, SPEC, TEXT, norm } from './spec.mjs';

const LIVING_ROOM = 'media_player.livingroomcc';

export function normalizeCall(rec) {
  const d = rec.data ?? {};
  switch (rec.service) {
    case 'script.notify_engine_two_button':
      return {
        service: rec.service, who: norm(d.who ?? 'family'), title: norm(d.title), text: norm([d.value1, d.value2, d.value3].filter(x => x != null && x !== '').join(' ')),
        group: norm(d.group), tag: norm(d.tag), level: norm(d.level || 'active'),
        // v0.2.0: the button titles as a set (sorted); which button comes first on the phone is not part of the job.
        buttons: [[d.title1, d.action1], [d.title2, d.action2]].filter(([, a]) => a != null && String(a) !== '').map(([t]) => norm(t)).sort(),
      };
    case 'script.speech_engine': {
      const mp = [].concat(d.media_player ?? []).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean);
      return { service: rec.service, text: norm(d.value1), player: mp.length === 0 || (mp.length === 1 && mp[0] === LIVING_ROOM) ? '' : mp.sort().join(',') };
    }
    case 'notify.alexa_media_garage':
      return { service: rec.service, text: norm(d.message), type: norm(d.data?.type ?? '') };
    case 'timer.start': {
      const seconds = d.duration === undefined ? CONFIG.timer.defaultSeconds : parseDuration(d.duration);
      return { service: rec.service, entities: [...rec.entity_ids].sort(), seconds };
    }
    case 'script.send_to_logbook':
      return { service: rec.service, topic: norm(d.topic), text: norm(d.message) };
    default:
      return { service: rec.service, entities: [...rec.entity_ids].sort(), data: d };
  }
}
export const keyOf = n => canonical(n);

// Expected-call constructors (what the author's automation does, in the normal form above).
export const E = {
  push: (t, weekday) => ({ t, norm: { service: 'script.notify_engine_two_button', who: SPEC.push.who, title: SPEC.push.title, text: TEXT.reminder(weekday), group: SPEC.push.group, tag: SPEC.push.tag, level: SPEC.push.level, buttons: [SPEC.buttons['30m'], SPEC.buttons['2h']].map(norm).sort() } }),
  speech: (t, weekday) => ({ t, norm: { service: 'script.speech_engine', text: TEXT.reminder(weekday), player: '' } }),
  announce: (t, weekday) => ({ t, norm: { service: 'notify.alexa_media_garage', text: TEXT.reminder(weekday), type: 'announce' } }),
  timerStart: (t, key) => ({ t, norm: { service: 'timer.start', entities: [SPEC.ids.timer], seconds: SPEC.snooze[key] } }),
  logbook: (t, key) => ({ t, norm: { service: 'script.send_to_logbook', topic: SPEC.logbookTopic, text: TEXT.snoozeLog(TEXT.label[key]) } }),
};

// Multiset match with a time tolerance. Within one key the two lists are sorted by time and matched greedily (optimal for points
// on a line with a symmetric window). Returns what is missing, what is extra, the largest timing error of the matched calls and,
// as a diagnostic, which missing calls have a same-content call outside the window (timing errors).
export function matchTraces(expected, got, tol = SPEC.toleranceSeconds) {
  const EPS = 1e-9;
  const group = list => { const m = new Map(); for (const x of list) { const k = keyOf(x.norm); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } for (const v of m.values()) v.sort((a, b) => a.t - b.t); return m; };
  const ge = group(expected), gg = group(got);
  const missing = [], extra = [];
  let maxErr = 0;
  for (const k of new Set([...ge.keys(), ...gg.keys()])) {
    const e = ge.get(k) ?? [], g = gg.get(k) ?? [];
    const used = g.map(() => false);
    let j = 0;
    for (const x of e) {
      while (j < g.length && g[j].t < x.t - tol - EPS) j++;
      if (j < g.length && Math.abs(g[j].t - x.t) <= tol + EPS) { used[j] = true; maxErr = Math.max(maxErr, Math.abs(g[j].t - x.t)); j++; }
      else missing.push(x);
    }
    g.forEach((y, i) => { if (!used[i]) extra.push(y); });
  }
  const timing = [];
  const pool = [...extra];
  for (const m of missing) {
    const i = pool.findIndex(y => keyOf(y.norm) === keyOf(m.norm));
    if (i >= 0) { timing.push({ expected: m.t, got: pool[i].t, service: m.norm.service }); pool.splice(i, 1); }
  }
  return { ok: missing.length === 0 && extra.length === 0, missing, extra, timing, maxErr };
}
