export const meta = {
  name: 'corpus-agentic-a',
  description: 'Curate agent-orchestration workflows into the corpus (group A: graph-style frameworks): per platform, extract items from pinned official examples, then independently verify',
  phases: [{ title: 'Extract' }, { title: 'Verify' }],
}
const { common, platforms } = args
const results = await pipeline(platforms,
  p => agent(`${common}\n\nYOUR PLATFORM: ${p.id} — ${p.scope}\nTarget: about ${p.n} items.\nTASK (extract): ${args.extract}`, { label: `extract:${p.id}`, phase: 'Extract', model: 'sonnet', effort: 'xhigh' }),
  (rep, p) => agent(`${common}\n\nYOUR PLATFORM: ${p.id} — ${p.scope}\nTASK (verify): ${args.verify}\n\nEXTRACTOR REPORT:\n${rep}`, { label: `verify:${p.id}`, phase: 'Verify', model: 'opus', effort: 'xhigh' }).then(v => ({ platform: p.id, extract: rep, verify: v })),
)
return results