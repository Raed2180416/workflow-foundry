# Builder journals moved out of git (2026-10-21)

The `claude -p` route puts the session account's own e-mail address into the model's context (it was in no prompt
Foundry sent; BUILDER-1 found it in model replies). The BUILDER-1 ModelPort journals therefore contain it, and two run
records quoted it. At this tip:
- `runs/*/journal.sqlite` moved to `/var/tmp/foundry-work/surface-20261021/builder-1/journals/<run>/` (not in git;
  `.gitignore` keeps them out). Replay and audits read them from there.
- `runs/b-h-1/records/W2.json` and `runs/b0-h-1/records/I3.json`: the address replaced with `<account-email-redacted>`.
- The orchestrator's pre-commit scan now blocks the address.

Earlier commits on the branch still contain it (autosaves between 16:59Z and 17:10Z). Removing it from history needs a
history rewrite and a force push, which is the owner's call. The engine fix (the Claude CLI provider must not pass
account identity into model context, or the policy must declare it) is an engine-bump follow-up.
