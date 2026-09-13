# Software workflow evidence

Original synthesis, observed 2026-09-13. Upstream source was inspected, not executed for these findings.

- [Codex approval and escalation policy](https://github.com/openai/codex/blob/1715e55076737158ba61d43158ede504de6d4ce1/codex-rs/core/src/tools/orchestrator.rs#L327-L448) motivates treating sandbox escalation as a fresh authority decision.
- [Symphony turn continuation](https://github.com/openai/symphony/blob/e0ccc83720a42a600a53b61c5f8d3e518bebe1db/elixir/lib/symphony_elixir/agent_runner.ex#L88-L171) separates completed turns from still-active work items.
- [mini-swe-agent local execution](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/environments/local.py#L24-L59) is a useful minimal baseline but inherits environment and detects a submission sentinel; external isolation and acceptance remain necessary.
- [SWE-agent recovery](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/agents.py#L1062-L1217) preserves typed failure exits while recovering a partial patch.
- [Claude SDK lifecycle caveats](https://github.com/anthropics/claude-agent-sdk-python/blob/37a52c9fb3f0271de017911914b0d42efea6267e/src/claude_agent_sdk/_internal/query.py#L762-L861) motivate explicit run-terminal events and draining control messages.
- [Skill evaluation recipe](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/skill-creator/SKILL.md#L163-L234) supplies treatment/baseline and resource accounting patterns. Foundry additionally freezes external oracles before candidate generation.
- [Agent Skills disclosure and tool field](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx#L163-L237) defines a portable packaging format, not runtime permission enforcement.
