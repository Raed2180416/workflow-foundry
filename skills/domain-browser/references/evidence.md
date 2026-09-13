# Browser workflow evidence

Original synthesis, observed 2026-09-13. These findings come from pinned public source inspection.

- [Browser Use batch guards](https://github.com/browser-use/browser-use/blob/50f205533fe10ba35b553d2a3689c77b87bd5d0a/browser_use/agent/service.py#L2730-L2828) stop queued actions after navigation or focus change; same-URL DOM changes remain a separate falsifier.
- [Browser Use judge semantics](https://github.com/browser-use/browser-use/blob/50f205533fe10ba35b553d2a3689c77b87bd5d0a/browser_use/agent/service.py#L1593-L1644) keep self-reported success separate from the judge verdict.
- [Browser Harness tool surface](https://github.com/browser-use/browser-harness/blob/afbcc381b963040c19627d788e40c7e7663171ee/src/mcp_server.py#L192-L280) includes raw JS/CDP and returns screenshot path metadata; tool count is not an authority boundary.
- [Stagehand cache replay](https://github.com/browserbase/stagehand/blob/b771930d2b4d858e5bd9670203c66260b385a8fa/packages/extension/services/actService.ts#L237-L405) and [fallback](https://github.com/browserbase/stagehand/blob/b771930d2b4d858e5bd9670203c66260b385a8fa/packages/extension/services/cacheService.ts#L191-L313) motivate testing partial replay before a whole-operation fallback. Duplicate effects are a design concern to test, not a reproduced upstream defect.
- [Skyvern stale-output invalidation](https://github.com/Skyvern-AI/skyvern/blob/35cfb314f4777ad77130dae087b26aa3ef99c489/skyvern/forge/sdk/workflow/models/block.py#L1505-L1664) prevents prior loop values from masquerading as current results.
- [AgentS3 structure](https://github.com/simular-ai/Agent-S/blob/3aa272d23d2994c7bbde1acbbe0ef8e8d06b8693/gui_agents/s3/agents/agent_s.py#L48-L94) provides a non-hierarchical design with optional reflection to include in complexity ablations.
- [MCP cancellation](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/cc2a84f5ca5404b2949683f7d7876f623344294f/docs/specification/2026-07-28/basic/patterns/cancellation.mdx#L35-L89) permits races and non-cancellable work; cancellation cannot stand in for effect reconciliation.
