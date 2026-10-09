// Adapter: n8n:20281 support-email triage (pilot P3). Effects = what the mock services COMMITTED (the same notion the oracle uses),
// combined with the arguments of the call that committed them. Stream = the mail being processed (order matters within a mail only).
const ROOT = new URL('../../../../../experiments/replicate/items/n8n-20281/', import.meta.url);
const imp = rel => import(new URL(rel, ROOT).href);

export const meta = { id: 'n8n20281', title: 'n8n:20281 support-email triage (P3)', variant: 'T2', difficulty: 3, split: 'dev', logUnit: 'committed external effect, ordered per mail' };
let M;
export async function init() {
  if (M) return M;
  const [idx, env, ref, imp2, broken, spec] = await Promise.all(['index.mjs', 'env.mjs', 'controls/reference.mjs', 'controls/improved.mjs', 'controls/broken.mjs', 'spec.mjs'].map(imp));
  M = { idx, env, ref, imp: imp2, broken, spec };
  return M;
}
export const taskFor = (seed, variant = meta.variant) => M.idx.generate({ seed, split: meta.split, difficulty: meta.difficulty, variant });

const EFFECT_OF = { 'jira.createIssue': 'jira.create', 'jira.addComment': 'jira.comment', 'slack.postMessage': 'slack.post', 'teams.post': 'teams.post',
  'gmail.reply': 'mail', 'gmail.createDraft': 'mail', 'outlook.reply': 'mail', 'outlook.createDraft': 'mail', 'sheets.appendRow': 'sheet.row' };

function keyFor(c, e) {
  const a = c.args ?? {};
  switch (c.name) {
    case 'jira.createIssue': { const f = a.fields ?? {}; return { project: f.project?.key, issuetype: f.issuetype?.name, priority: f.priority?.name, labels: f.labels ?? [], summary: f.summary, description: f.description, issueKey: e.key }; }
    case 'jira.addComment': return { issueKey: e.key ?? a.issueKey, body: a.body };
    case 'slack.postMessage': return { channel: a.channel, text: a.text };
    case 'teams.post': return { url: a.url, text: e.text };
    case 'sheets.appendRow': return { row: a.row };
    default: return { kind: e.type, provider: e.provider, to: e.to, cc: e.cc, subject: e.subject, threadId: e.threadId, text: e.text };
  }
}

export function logOf(task, output) {
  const { env } = M.env.replay(task, output.actions);
  const ev = [];
  for (const sc of env._records()) for (const er of sc.events) {
    const entry = sc.entries[er.entryIndex];
    for (const c of er.calls) {
      if (!EFFECT_OF[c.name] || !c.effects?.length) continue;
      for (const e of c.effects) if (e.type !== 'sheet.rows' || c.name === 'sheets.appendRow')
        ev.push({ case: sc.id, stream: entry.caseId, type: EFFECT_OF[c.name], key: keyFor(c, e), meta: { thread: entry.threadId, sender: entry.fromEmail, name: entry.fromName } });
    }
  }
  return ev;
}
// Expected log = the call-for-call transcription of the original (identical to the executed n8n definition on 14/14 instances, item README).
// T3 tasks (probes) are judged against intent, so there the expected log is the improved reference that the oracle accepts.
export const expectedLog = task => logOf(task, M.env.driveSync(task, (task.variant === 'T3' ? M.imp.makeImproved : M.ref.makeFaithful)(M.spec.configFor(task.difficulty))));
export const oracleOf = (task, output) => { const r = M.idx.oracle(task, output); return { pass: r.pass, score: r.score }; };

const strip = (ev, f) => ev.map(e => (e.type === 'slack.post' ? { ...e, key: { ...e.key, text: f(e.key.text, e) } } : e));
// C3: the review message names the sender by display name only (no address).
const nameOnly = ev => strip(ev, t => (t.startsWith(':mag:') ? t.replace(/ <[^<>\s]+@[^<>\s]+>/, '') : t));
// C4: a <!here> ping on the message about a Critical follow-up.
const hereOnFollowUp = ev => strip(ev, t => (t.startsWith(':speech_balloon:') && /\/ Critical\b/.test(t.split('\n')[0]) ? `<!here> ${t}` : t));

export function candidates() {
  const cfgOf = t => M.spec.configFor(t.difficulty);
  const b = name => M.broken.BROKEN.find(x => x.name === name);
  const list = [
    { id: 'n8n20281/faithful', kind: 'reference', make: t => M.env.driveSync(t, M.ref.makeFaithful(cfgOf(t))) },
    { id: 'n8n20281/improved (T2 core)', kind: 'control-correct', make: t => M.env.driveSync(t, M.imp.makeImproved(cfgOf(t))) },
    { id: 'n8n20281/W1 ref-only-prompt (T3)', cls: 'N20-W1', kind: 'class-wrong', decidedBy: 'harness-mock', variant: 'T3', make: t => b('ref-only-prompt').make(t) },
    { id: 'n8n20281/W2 forged-modelTape (T3)', cls: 'N20-W2', kind: 'class-wrong', decidedBy: 'cost-accounting', variant: 'T3', realisation: 'identity', make: t => M.env.driveSync(t, M.imp.makeImproved(cfgOf(t))) },
    { id: 'n8n20281/W3 drop-critical', cls: 'N20-W3', kind: 'class-wrong', decidedBy: 'battery', make: t => b('drop-critical').make(t) },
    { id: 'n8n20281/W4 notify-before-create', cls: 'N20-W4', kind: 'class-wrong', decidedBy: 'comparison', make: t => b('notify-before-create').make(t) },
    { id: 'n8n20281/W5 mention-dodge-critical (T3)', cls: 'N20-W5', kind: 'class-wrong', decidedBy: 'battery', variant: 'T3', make: t => b('mention-dodge-critical').make(t) },
    { id: 'n8n20281/W6 probe-dodge (T3)', cls: 'N20-W6', kind: 'class-wrong', decidedBy: 'battery', variant: 'T3', make: t => b('probe-dodge').make(t) },
    { id: 'n8n20281/C1 review-names-sender-by-display-name', cls: 'N20-C1', kind: 'class-correct', decidedBy: 'comparison', realisation: 'perturbation', make: t => M.env.driveSync(t, M.ref.makeFaithful(cfgOf(t))), perturb: nameOnly },
    { id: 'n8n20281/C2 here-ping-on-critical-follow-up', cls: 'N20-C2', kind: 'class-correct', decidedBy: 'comparison', realisation: 'perturbation', make: t => M.env.driveSync(t, M.ref.makeFaithful(cfgOf(t))), perturb: hereOnFollowUp },
    { id: 'n8n20281/R1 memorised-answers (no model calls)', cls: 'N20-R1', kind: 'class-residual', decidedBy: 'battery', realisation: 'identity', make: t => M.env.driveSync(t, M.ref.makeFaithful(cfgOf(t))) },
    ...M.broken.BROKEN.filter(x => !x.variant && !['drop-critical', 'notify-before-create'].includes(x.name)).map(x => ({ id: `n8n20281/bad ${x.name}`, kind: 'control-wrong', appliesAt: x.appliesAt, make: t => x.make(t) })),
  ];
  return list;
}
