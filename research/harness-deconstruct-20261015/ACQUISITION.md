# Acquisition: research harnesses for deconstruction (2026-10-15)

Owner request (2026-10-15): clone OpenScience and K-Dense locally and deconstruct them with subagents, to see how much of what they do our product can already do.

All three are shallow, inert clones (`--depth 1`, no submodules, no LFS smudge) in `corpus/`, which is git-ignored. No install script, start script, package-manager install or hook was run. They are research material only; their LICENSE and NOTICE files stay in place in `corpus/`.

| repo | URL | commit | committed | license | outcome |
|---|---|---|---|---|---|
| OpenScience (synthetic-sciences) | https://github.com/synthetic-sciences/openscience | `722ad051b7f601bab9e33749aedf942faf8c4737` | 2026-10-13 | Apache-2.0 (LICENSE + NOTICE) | ok, 110 MB |
| K-Dense BYOK ("Kady") | https://github.com/K-Dense-AI/k-dense-byok | `44c52cee8e9fdc343c6132909769f49accf14a82` | 2026-10-03 | MIT | ok, 28 MB |
| K-Dense scientific-agent-skills | https://github.com/K-Dense-AI/scientific-agent-skills | `a1043ef544e3a100c28e70a736b6cf32554d0677` | 2026-10-12 | MIT (LICENSE.md) | ok, 521 MB, 177 skill entries |

Acquired 2026-10-15 by the session on branch `claude/intelligent-hamilton-vg1f9a`.
