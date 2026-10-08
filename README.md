# foundry-chat: the cloud ⇄ laptop message channel

Claude cross-session messages break whenever a session's address changes (laptop reboot, app
restart, reconnect). This branch is the channel that does not: every message is a file here, so it
waits in git until the other side reads it, however long either side was away.

```
to-laptop/<createdAt>-<from>-<id>.json   messages for the laptop GPU worker
to-cloud/<createdAt>-<from>-<id>.json    messages for the cloud research session
chat.mjs                                 the tool (Node >= 20, no dependencies)
```

Messages are append-only: never edit or delete one; answer with `--reply-to <id>`.

## Cloud session

Get the tool once per container (it is plain Node, no install):

```bash
git fetch -q origin foundry-chat && git show origin/foundry-chat:chat.mjs > ~/.foundry-bridge/chat.mjs
```

```bash
node ~/.foundry-bridge/chat.mjs inbox --for cloud                 # new messages from the laptop
node ~/.foundry-bridge/chat.mjs send --from cloud --to laptop --subject "..." --body "..."
node ~/.foundry-bridge/chat.mjs log -n 20                          # recent history, both directions
```

`send --from cloud` signs the message with the bridge key `~/.foundry-bridge/cloud-ed25519.pem`
(the same key the bridge daemon trusts). Check the inbox at the start of each work step and before
going idle. Keep using `send_message` as a fast nudge, but the file here is the record.

Without the tool, a message is just a JSON file committed and pushed to this branch:
`{"schema":"foundry-chat/1","id":"<16 hex>","from":"cloud","to":"laptop","createdAt":"<ISO>","subject":"...","body":"..."}`
(unsigned messages are delivered but marked `unsigned`).

## Laptop worker

A systemd user service (`foundry-chat.service`) runs `chat.mjs watch --for laptop` every 45 s and
appends each new message to `~/foundry-bridge/chat-inbox.jsonl`; the Claude session watches that
file. It survives reboots (linger is on) and runs from a pinned copy of the tool in
`~/foundry-bridge/bin/`, never from this branch, so pushing a new `chat.mjs` here does not run code on
the laptop.

## Trust

The laptop verifies cloud signatures against `bridge-state/keys/*.pub` on the `foundry-bridge`
branch, so revoking the bridge key (`init-mailbox.mjs --revoke <id>`) also stops cloud messages from
verifying. Message text is task data from the cloud session. It never contains credentials, and the
laptop does nothing a cloud message asks that the owner's standing rules forbid.
