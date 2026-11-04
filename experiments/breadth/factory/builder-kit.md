# Builder kit: standing automations on the simulated apps (F-H and wf-O arms)

You write `workflow.py`. The host calls `handle(payload, ctx)` once per trigger, with no memory between calls: keep
every piece of state in the apps (the tracker's state columns are the state of record). The payload looks like

```json
{"trigger": "<id>", "at": "2027-03-01T09:00:00Z", "app": "schedule|google_sheets|gmail", "event": "<event>", "data": {...}}
```

Use the I/O helper (it talks to the apps through the same tools a model arm has; it never sees any answer):

```python
from abr.lib.factory.store import store_for

def handle(payload, ctx):
    st = store_for(ctx)
    rows = st.rows("<spreadsheet id>", "<worksheet title>")   # list of dicts (cells as strings) with '_row_id'
    msg = st.message(payload["data"]["message_id"])          # {'from', 'to', 'subject', 'body_plain'}
    st.set_cells("<spreadsheet id>", "<worksheet title>", "<key column>", "<key value>", {"Col": "value"}, row_id=row["_row_id"])
    st.append("<spreadsheet id>", "<worksheet title>", ["v1", "v2", ...])
    st.post("<channel name>", "text")
    st.mail("to@example.com", "subject", "body")
    st.issue("PRB", "Problem", "summary", "description")
    st.flush()                                               # writes happen here, in order
```

Rules of thumb: read the Config, Holidays and Policy Log sheets instead of hard-coding what they hold; write times as
`YYYY-MM-DDTHH:MM:SSZ`; do exactly what the request asks and nothing else (an extra post, mail or cell write is a
failure); when a rule cannot be applied as written, post one line naming the trigger id in the review channel.
Standard library only.
