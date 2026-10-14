// A rule-following test arm for the E7 world alone ($0; analyst-side fixture, not a solver and not graded). It reads only
// what an arm reads (events, files, ctx.query) and keeps the incident records of SPEC R1-R3, R6 and R7.1 (intake,
// joining alerts, assignment, resolver updates, caller replies, confirmations and withdrawals, the major-incident approval
// task), with no SLA records, no deadline closures and no timers. Its use is to drive the world's actors through the real
// host: if the world's timeline is consistent, every planned resolver step and caller message is delivered and no
// guarded step is suppressed (test/world.test.mjs, tools/world-health.mjs). Stateless across instances except a map of
// hold instants (the incident record has no hold time); every tick closes its instance.
import { addBiz, localDate } from '../world.mjs';

const MIN = 60_000;
const norm = s => String(s ?? '').trim().replace(/^#/, '').trim().toUpperCase();

export function walkerArm({ id = 'walker' } = {}) {
  const holds = new Map();                         // number -> hold instant (ms) of the current awaiting-caller hold
  const p1 = new Set();                            // numbers whose priority has been 1
  return {
    id,
    tick(input, ctx) {
      const F = ctx.files;
      const json = p => JSON.parse(F[p]);
      const master = { cis: json('master/cis.json'), services: json('master/services.json'), groups: json('master/groups.json'), users: json('master/users.json') };
      const editions = Object.keys(F).filter(p => p.endsWith('/edition.json')).map(p => ({ dir: p.slice(0, -'edition.json'.length), ...json(p) }));
      const editionAt = ms => {
        const date = localDate(ms, 'Europe/Amsterdam');
        return editions.filter(e => e.effectiveFrom <= date).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
      };
      const rule = (ms, name) => json(`${editionAt(ms).dir}${name}`);
      const priorityOf = (ms, service, impact, urgency) => rule(ms, 'priority.json').filter(r => r.impact === impact && r.urgency === urgency && (r.service === '*' || r.service === service))
        .sort((a, b) => a.order - b.order)[0].priority;
      const ciOf = ref => { const k = String(ref).trim().toLowerCase(); return master.cis.find(c => c.ci.toLowerCase() === k || c.name.toLowerCase() === k || c.aliases.some(a => a.toLowerCase() === k)); };
      const svcOf = id => master.services.find(s => s.service === id);
      const userOf = id => master.users.find(u => u.userId === id);
      const groupOf = id => master.groups.find(g => g.group === id);
      const incident = number => ctx.query('itsm.incidents', { where: { number } })[0] ?? null;
      const effects = [], tasks = [];
      const out = (subject, priority) => ({ decisions: { subject, priority }, effects, obligations: { upsert: [], cancel: [] }, humanTasks: tasks, close: true, carry: null });
      const eff = (key, system, op, args) => effects.push({ key, system, op, args });
      const notify = (number, to, template, evId) => eff(`ntf:${number}:${template}:${evId}`, 'notify', 'send', { to, about: number, template, text: `${template} ${number}`, ref: null });
      const assign = (number, group, at, evId) => {
        eff(`asg:${number}:${evId}`, 'itsm', 'assign', { number, group, at, ref: `ref-${number}-${evId}` });
        notify(number, groupOf(group).mailbox, 'assignment', evId);
      };
      const approvalTask = (number, callerId, now, evId) => {
        if (p1.has(number)) return;
        p1.add(number);
        tasks.push({ id: `mia:${number}:${evId}`, kind: 'majorIncidentApproval', role: 'incidentManager', excludeUsers: callerId ? [callerId] : [], subject: number,
          question: `Declare ${number} a major incident?`, answerSchema: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } },
          dueAt: new Date(now + 30 * MIN + 60 * MIN).toISOString().replace('Z', '+00:00').replace(/\.\d{3}/, ''), onTimeout: { action: 'declare' } });
      };
      let subject = null, priority = null;
      for (const ev of input.events) {
        const at = ev.at, ms = Date.parse(at), p = ev.payload ?? {};
        if (ev.type === 'incident.reported' || (ev.type === 'alert.raised' && p.severity !== 'warning')) {
          const isAlert = ev.type === 'alert.raised';
          const sourceId = isAlert ? p.alertId : p.reportId;
          const ci = ciOf(p.ci);
          const urgency = isAlert ? rule(ms, 'alert-urgency.json')[p.severity] : p.urgency;
          if (isAlert) {
            const open = ctx.query('itsm.incidents', { where: { ci: ci.ci, check: p.check } })
              .find(x => x.source.kind === 'alert' && !['resolved', 'closed', 'cancelled'].includes(x.state));
            if (open && open.number !== `INC-${sourceId}`) {
              if (!open.alerts.includes(sourceId)) {
                eff(`lnk:${open.number}:${sourceId}`, 'itsm', 'linkAlert', { number: open.number, alertId: sourceId });
                if (urgency < open.urgency) {
                  const pr = priorityOf(ms, open.service, open.impact, urgency);
                  eff(`rcl:${open.number}:${ev.id}`, 'itsm', 'reclassify', { number: open.number, impact: open.impact, urgency, priority: pr, at });
                  if (pr === 1) approvalTask(open.number, open.callerId, ms, ev.id);
                }
              }
              subject = open.number; priority = urgency < open.urgency ? priorityOf(ms, open.service, open.impact, urgency) : open.priority;
              continue;
            }
          }
          const number = `INC-${sourceId}`;
          const have = incident(number);
          if (have) { subject = number; priority = have.priority; continue; }
          const svc = svcOf(ci.service);
          const caller = isAlert ? null : userOf(p.callerId);
          const pr = priorityOf(ms, svc.service, svc.impact, urgency);
          const ciField = 'configurationItem' in json('api/itsm.schema.json').ops.create.args.properties ? 'configurationItem' : 'ci';     // F5 (d5, from ep3)
          eff(`create:${number}`, 'itsm', 'create', { number, source: { kind: isAlert ? 'alert' : 'report', id: sourceId }, callerId: caller?.userId ?? null, [ciField]: ci.ci,
            check: isAlert ? p.check : null, service: svc.service, category: isAlert ? 'monitoring' : p.category, impact: svc.impact, urgency, priority: pr, openedAt: at, summary: 'walker' });
          const region = isAlert ? ci.region : caller.region;
          const category = isAlert ? 'monitoring' : p.category;
          const row = rule(ms, 'assignment.json').filter(r => (r.category === '*' || r.category === category) && (r.region === '*' || r.region === region)).sort((a, b) => a.order - b.order)[0];
          assign(number, row.group === 'ciSupportGroup' ? ci.supportGroup : row.group, at, ev.id);
          if (pr === 1) approvalTask(number, caller?.userId ?? null, ms, ev.id);
          subject = number; priority = pr;
        } else if (ev.type === 'resolver.update') {
          const number = p.number;
          const inc = incident(number);
          if (!inc) continue;
          subject = number; priority = inc.priority;
          if (['resolved', 'closed', 'cancelled'].includes(inc.state)) continue;
          const caller = inc.callerId ? userOf(inc.callerId) : null;
          const key = `${p.action}:${number}:${ev.id}`;
          if (p.action === 'accept') eff(key, 'itsm', 'accept', { number, user: p.user, at });
          if (p.action === 'hold') {
            eff(key, 'itsm', 'hold', { number, reason: p.holdReason, at });
            if (p.holdReason === 'awaitingCaller') { holds.set(number, ms); if (caller) notify(number, caller.email, 'awaiting-caller', ev.id); }
          }
          if (p.action === 'resume') eff(key, 'itsm', 'resume', { number, at });
          if (p.action === 'reassign') { holds.delete(number); assign(number, p.toGroup, at, ev.id); }
          if (p.action === 'reclassify') {
            const impact = p.impact ?? inc.impact, urgency = p.urgency ?? inc.urgency;
            const pr = priorityOf(ms, inc.service, impact, urgency);
            eff(key, 'itsm', 'reclassify', { number, impact, urgency, priority: pr, at });
            if (pr === 1) approvalTask(number, inc.callerId, ms, ev.id);
            priority = pr;
          }
          if (p.action === 'resolve') { eff(key, 'itsm', 'resolve', { number, closeCode: p.closeCode, at }); if (caller) notify(number, caller.email, 'resolved', ev.id); }
        } else if (ev.type === 'caller.message') {
          const number = norm(p.incidentRef);
          const inc = incident(number);
          if (!inc) continue;
          subject = number; priority = inc.priority;
          if (p.intent === 'reply' && inc.state === 'onHold' && inc.holdReason === 'awaitingCaller') {
            const h = holds.get(number);
            const sd = json('calendar/SCH-EU-STD.json');
            if (h !== undefined && ms <= addBiz(sd, sd.tz, h, 3 * 480)) { eff(`res:${number}:${ev.id}`, 'itsm', 'resume', { number, at }); holds.delete(number); }
          }
          if (p.intent === 'confirm' && inc.state === 'resolved') eff(`cls:${number}`, 'itsm', 'close', { number, reason: 'confirmed', at });
          if (p.intent === 'withdraw' && !['resolved', 'closed', 'cancelled'].includes(inc.state)) {
            eff(`cnc:${number}`, 'itsm', 'cancel', { number, at });
            notify(number, userOf(inc.callerId).email, 'incident-cancelled', ev.id);
          }
        } else if (ev.type === 'migration') {
          const inc = ev.payload.records['itsm.incidents']?.[0];
          if (inc) { subject = inc.number; priority = inc.priority; }
          for (const x of ev.payload.events ?? []) if (x.type === 'resolver.update' && x.payload.action === 'hold' && x.payload.holdReason === 'awaitingCaller') holds.set(x.payload.number, Date.parse(x.at));
        }
      }
      return out(subject, priority);
    },
  };
}
