# foundry-bridge mailbox

This orphan branch is the rendezvous point between the Workflow Foundry cloud session and the
owner's laptop GPU bridge (see `bridge/PROTOCOL.md` on the main branches). **It never merges** into
any other branch and contains nothing but `bridge-state/`.

| Path | Written by | Meaning |
|---|---|---|
| `bridge-state/keys/<label>-<keyid>.pub` | cloud (or the owner) | Ed25519 public keys (PEM SPKI) the laptop daemon trusts. Delete a file to revoke that key; the daemon re-reads keys on every refresh (default every 5 minutes). |
| `bridge-state/endpoint.json` | laptop daemon | Current Cloudflare quick-tunnel URL, daemon version, heartbeat time, GPU summary, running services. No secrets, no paths. |
| `bridge-state/KILL` | anyone with write access | Kill switch. While this file exists the daemon stops every job and service and refuses all signed requests. Delete it to re-enable. |

The trust root is write access to this private repository: whoever can push here can add a key.
Never put private keys, tokens or datasets on this branch. Commits are append-only (never force-push).
