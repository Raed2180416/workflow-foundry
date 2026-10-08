// An interpreter for the subset of Home Assistant automation YAML that the ORIGINAL definition uses, running it as an event handler
// on this item's protocol (so the original goes through the same env and oracle as any solution).
//
// WHAT THIS IS NOT: it is not Home Assistant. Home Assistant core is not installed here (and pulling it in is a dependency decision
// left to the owner), so the original's semantics are those documented for Home Assistant and implemented below:
//   - state trigger with `from`/`to`/`for`: the `for` timer is re-armed by a matching transition and disposed by any state change
//     of the entity; it fires the trigger when it runs out.
//   - event trigger: event_type equal and every event_data key equal (a list value matches any element).
//   - `mode`: restart stops the running instance as soon as a new trigger fires (before its conditions are looked at); single
//     ignores the new trigger. queued/parallel are rejected.
//   - actions run in order; `delay` waits (here: a scheduled wake-up); `condition` as an action ends the WHOLE run quietly when false,
//     also inside choose/repeat (the failure bubbles up through sub-sequences); `stop` ends the run quietly; `parallel` runs its
//     branches (a branch that waits is rejected) and re-raises the first error after all branches ran; `repeat.for_each` runs
//     its sequence per item; a service call that fails ends the run with an error unless continue_on_error is set.
//   - templates: native rendering of a single {{ }}, otherwise a trimmed string (controls/minijinja.mjs).
// Anything not listed throws UnsupportedSemantics instead of being guessed.
import { render, evalCondition } from './minijinja.mjs';
import { strftime, parseDuration } from '../mocks/ha-core.mjs';

export class UnsupportedSemantics extends Error {}
class StopRun extends Error {}
class ConditionFail extends Error {}
class ActionError extends Error {}

const asList = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const deepRender = (v, ctx) => (typeof v === 'string' ? render(v, ctx) : Array.isArray(v) ? v.map(x => deepRender(x, ctx)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepRender(x, ctx)])) : v);
const COMMON_KEYS = ['alias', 'enabled', 'continue_on_error'];

// options.iterationLocalConditions is NOT Home Assistant as documented here; it is the alternative reading (a false condition inside a
// repeat ends only that iteration) used to measure how much of the oracle rests on the documented reading.
export function createAutomationHandler(automation, { coverage = new Set(), iterationLocalConditions = false } = {}) {
  const mode = automation.mode ?? 'single';
  if (!['restart', 'single'].includes(mode)) throw new UnsupportedSemantics(`mode ${mode}`);
  const triggers = asList(automation.trigger ?? automation.triggers);
  for (const t of triggers) if (!['state', 'event'].includes(t.platform ?? t.trigger)) throw new UnsupportedSemantics(`trigger platform ${t.platform ?? t.trigger}`);
  const actions = asList(automation.action ?? automation.actions);

  return function create() {
    let current = null;                 // {it, waiting}
    const pendingFor = new Map();       // trigger index -> {entity_id, from_state, to_state}
    let H = null, EV = null;            // api and event of the invocation in progress

    const nowObj = () => ({ strftime: f => strftime(EV.at.epoch, f), weekday: () => EV.at.weekday });
    const ctxOf = scope => ({ ...scope.vars, trigger: scope.trigger, ...(scope.repeat ? { repeat: scope.repeat } : {}), now: nowObj });
    const tpl = (v, scope) => deepRender(v, ctxOf(scope));

    function condition(c, scope) {
      if (typeof c === 'string') { coverage.add('condition:template'); return evalCondition(c, ctxOf(scope)); }
      const kind = c.condition;
      coverage.add(`condition:${kind}`);
      switch (kind) {
        case 'trigger': return asList(c.id).includes(scope.trigger.id);
        case 'time': {
          if ('after' in c || 'before' in c) throw new UnsupportedSemantics('time condition with after/before');
          return asList(c.weekday).includes(EV.at.weekday);
        }
        case 'state': {
          if ('attribute' in c || 'for' in c || 'match' in c) throw new UnsupportedSemantics('state condition with attribute/for/match');
          const want = asList(c.state).map(String);
          return asList(c.entity_id).every(id => { const r = H.ha.get_state({ entity_id: id }); return r.status < 400 && want.includes(String(r.body.state)); });
        }
        case 'template': return evalCondition(c.value_template, ctxOf(scope));
        case 'and': return asList(c.conditions).every(x => condition(x, scope));
        case 'or': return asList(c.conditions).some(x => condition(x, scope));
        case 'not': return !asList(c.conditions).some(x => condition(x, scope));
        default: throw new UnsupportedSemantics(`condition ${kind}`);
      }
    }

    function* sequence(list, scope) { for (const a of asList(list)) yield* action(a, scope); }

    const only = (a, allowed) => { for (const k of Object.keys(a)) if (!allowed.includes(k) && !COMMON_KEYS.includes(k)) throw new UnsupportedSemantics(`action key ${k}`); };

    function* action(a, scope) {
      if (a.enabled === false) return;
      if ('choose' in a) {
        only(a, ['choose', 'default']);
        coverage.add('action:choose');
        for (const opt of asList(a.choose)) {
          if (asList(opt.conditions).every(c => condition(c, scope))) { yield* sequence(opt.sequence, scope); return; }
        }
        if (a.default) yield* sequence(a.default, scope);
      } else if ('variables' in a) {
        only(a, ['variables']);
        coverage.add('action:variables');
        for (const [k, v] of Object.entries(a.variables)) scope.vars[k] = tpl(v, scope);
      } else if ('service' in a || 'action' in a) {
        only(a, ['service', 'action', 'target', 'data', 'entity_id']);
        coverage.add('action:service');
        const service = tpl(a.service ?? a.action, scope);
        const target = { ...(a.target ? tpl(a.target, scope) : {}), ...(a.entity_id ? { entity_id: tpl(a.entity_id, scope) } : {}) };
        const data = a.data ? tpl(a.data, scope) : {};
        const r = H.ha.call_service({ service, ...(Object.keys(target).length ? { target } : {}), data });
        if (r.status >= 400 && !a.continue_on_error) throw new ActionError(`${service}: ${r.status} ${JSON.stringify(r.body)}`);
      } else if ('stop' in a) {
        only(a, ['stop']);
        coverage.add('action:stop');
        throw new StopRun(String(a.stop));
      } else if ('condition' in a) {
        coverage.add('action:condition');
        if (!condition(a, scope)) throw new ConditionFail();
      } else if ('parallel' in a) {
        only(a, ['parallel']);
        coverage.add('action:parallel');
        let firstError = null;
        for (const branch of asList(a.parallel)) {
          const it = sequence('sequence' in branch ? branch.sequence : [branch], { ...scope, vars: scope.vars });
          try {
            for (;;) { const r = it.next(); if (r.done) break; throw new UnsupportedSemantics('a delay inside a parallel branch'); }
          } catch (e) {
            if (e instanceof ActionError) firstError ??= e;
            else if (e instanceof StopRun || e instanceof ConditionFail) throw new UnsupportedSemantics('stop/condition inside a parallel branch');
            else throw e;
          }
        }
        if (firstError) throw firstError;
      } else if ('repeat' in a) {
        only(a, ['repeat']);
        coverage.add('action:repeat');
        const rep = a.repeat;
        if (!('for_each' in rep) || 'count' in rep || 'while' in rep || 'until' in rep) throw new UnsupportedSemantics('repeat other than for_each');
        const items = tpl(rep.for_each, scope);
        if (!Array.isArray(items)) throw new UnsupportedSemantics('repeat.for_each did not render to a list');
        for (let i = 0; i < items.length; i++) {
          try {
            yield* sequence(rep.sequence, { ...scope, vars: scope.vars, repeat: { item: items[i], index: i + 1, first: i === 0, last: i === items.length - 1 } });
          } catch (e) { if (!(iterationLocalConditions && e instanceof ConditionFail)) throw e; }
        }
      } else if ('delay' in a) {
        only(a, ['delay']);
        coverage.add('action:delay');
        const d = tpl(a.delay, scope);
        let seconds;
        if (typeof d === 'object' && d !== null) {
          const parts = {}; for (const [k, v] of Object.entries(d)) parts[k] = typeof v === 'string' ? Number(v) : v;
          seconds = parseDuration(parts);
        } else seconds = parseDuration(d);
        if (seconds === null || Number.isNaN(seconds)) throw new UnsupportedSemantics(`delay value ${JSON.stringify(d)}`);
        if (seconds > 0) yield { delay: seconds };
      } else throw new UnsupportedSemantics(`action ${JSON.stringify(Object.keys(a))}`);
    }

    function resume() {
      try {
        const r = current.it.next();
        if (r.done) { current = null; return; }
        H.sched.set({ id: 'run', afterSeconds: r.value.delay });
        current.waiting = true;
      } catch (e) {
        current = null;
        if (e instanceof StopRun || e instanceof ConditionFail || e instanceof ActionError) return;     // the run ends; nothing else is affected
        throw e;
      }
    }

    function fire(idx, vars) {
      const trg = triggers[idx];
      const trigger = { id: trg.id ?? String(idx), idx, platform: trg.platform ?? trg.trigger, ...vars };
      if (current) {
        if (mode === 'single') return;
        if (current.waiting) H.sched.cancel({ id: 'run' });          // restart: stop the running instance
        current.it.return();
        current = null;
      }
      current = { it: sequence(actions, { vars: {}, trigger }), waiting: false };
      resume();
    }

    return function handle(event, api) {
      H = api; EV = event;
      if (event.type === 'state_changed') {
        triggers.forEach((trg, idx) => {
          if ((trg.platform ?? trg.trigger) !== 'state' || !asList(trg.entity_id).includes(event.entity_id)) return;
          if ('attribute' in trg) throw new UnsupportedSemantics('state trigger with attribute');
          if (pendingFor.has(idx)) { api.sched.cancel({ id: `for:${idx}` }); pendingFor.delete(idx); }
          const fromOk = trg.from === undefined || asList(trg.from).map(String).includes(String(event.old_state));
          const toOk = trg.to === undefined || asList(trg.to).map(String).includes(String(event.new_state));
          if (!fromOk || !toOk) return;
          coverage.add('trigger:state');
          const vars = { entity_id: event.entity_id, from_state: { state: event.old_state }, to_state: { state: event.new_state } };
          if (trg.for !== undefined) {
            const seconds = parseDuration(trg.for);
            if (seconds === null) throw new UnsupportedSemantics(`for: ${JSON.stringify(trg.for)}`);
            api.sched.set({ id: `for:${idx}`, afterSeconds: seconds }); pendingFor.set(idx, vars);
          } else fire(idx, vars);
        });
      } else if (event.type === 'event') {
        triggers.forEach((trg, idx) => {
          if ((trg.platform ?? trg.trigger) !== 'event' || asList(trg.event_type).length === 0 || !asList(trg.event_type).includes(event.event_type)) return;
          const want = trg.event_data ?? {};
          if (!Object.entries(want).every(([k, v]) => asList(v).includes(event.data?.[k]))) return;
          coverage.add('trigger:event');
          fire(idx, { event: { event_type: event.event_type, data: event.data } });
        });
      } else if (event.type === 'wake') {
        if (event.id.startsWith('for:')) {
          const idx = Number(event.id.slice(4)), vars = pendingFor.get(idx);
          if (vars) { pendingFor.delete(idx); fire(idx, { ...vars, for: triggers[idx].for }); }
        } else if (event.id === 'run' && current?.waiting) { current.waiting = false; resume(); }
      }
    };
  };
}
