"""Home Assistant automations, scripts and blueprints -> foundry-corpus-item/1 candidates.

Run with the pinned venv (PyYAML 6.0.3, consumer-creative-requirements.txt):
  /opt/corpus/.venv-consumer/bin/python -I consumer-creative-homeassistant.py
  -> /opt/corpus/consumer-work/home-assistant.candidates.jsonl

Inputs (raw, outside git):
  /opt/corpus/home-assistant/git/<owner>__<repo>/**.yaml   (git-manifest.json: SHA, licence)
  /opt/corpus/home-assistant/forum/<topic>.yaml            (forum-manifest.json: import URL, licence)
  home-assistant.io docs: ```yaml blocks in source/_docs/{automation,scripts}* and source/_cookbook

YAML is loaded with a SafeLoader subclass; every custom tag (!input, !secret, !include, ...) becomes an
inert {"__tag__": ..., "v": ...} placeholder. Nothing is executed or templated. Node summaries carry
service/trigger types and entity *domains* only (no entity ids, names or message text).
"""
import glob, html, importlib.util, json, os, re, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cc", os.path.join(HERE, "consumer-creative-common.py"))
cc = importlib.util.module_from_spec(spec); spec.loader.exec_module(cc)

ROOT = "/opt/corpus/home-assistant"
OUT = "/opt/corpus/consumer-work/home-assistant.candidates.jsonl"


class Loader(yaml.SafeLoader):
    pass


def _tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return {"__tag__": suffix, "v": loader.construct_scalar(node)}
    if isinstance(node, yaml.SequenceNode):
        return {"__tag__": suffix, "v": loader.construct_sequence(node, deep=True)}
    return {"__tag__": suffix, "v": loader.construct_mapping(node, deep=True)}


Loader.add_multi_constructor("!", _tag)

EVENT_TRIG = {"state", "numeric_state", "event", "mqtt", "zone", "geo_location", "device", "tag", "homeassistant",
              "template", "conversation", "persistent_notification", "sentence", "zwave_js.value_updated",
              "zwave_js.event", "state_changed", "entity", "trigger"}
SCHEDULE_TRIG = {"time", "time_pattern", "sun", "calendar"}
HUMAN_EVENTS = re.compile(r"mobile_app_notification_action|ios\.action_fired|telegram_callback|html5_notification\.clicked|"
                          r"alexa_actionable_notification|telegram_command|signal_received|ios\.notification_action_fired")
INTERNAL_DOMAINS = {"homeassistant", "input_boolean", "input_number", "input_select", "input_text", "input_datetime",
                    "input_button", "counter", "timer", "script", "automation", "scene", "group", "persistent_notification",
                    "logbook", "system_log", "variable", "var", "recorder", "logger", "python_script", "shell_command",
                    "pyscript", "frontend", "browser_mod", "notify", "tts", "update", "template"}
DEVICE_DOMAINS = {"light", "switch", "climate", "cover", "lock", "fan", "media_player", "vacuum", "alarm_control_panel",
                  "siren", "water_heater", "humidifier", "valve", "button", "number", "select", "remote", "camera",
                  "lawn_mower", "scene", "input_button", "text", "date", "time", "datetime", "valve", "wled", "hue",
                  "sonos", "zwave_js", "zha", "mqtt", "esphome", "tuya", "shelly", "nest", "ecobee", "roomba", "neato",
                  "xiaomi_miio", "denonavr", "yamaha", "harmony", "androidtv", "webostv", "samsungtv", "cast",
                  "spotify", "squeezebox", "alexa_media", "kodi", "plex", "sonos", "unifi", "frigate"}
MODEL_SVC = re.compile(r"^(conversation\.process|ai_task\.|openai_conversation\.|google_generative_ai_conversation\.|ollama\.|"
                       r"extended_openai_conversation\.|llmvision\.|anthropic\.|gpt4vision\.|image_processing\.scan|"
                       r"assist_satellite\.ask_question|mistral|groq|azure_openai)")
CODE_SVC = re.compile(r"^(shell_command|python_script|pyscript|command_line|script_runner)\.")
READ_SVC = re.compile(r"(\.get_|homeassistant\.update_entity|\.reload|calendar\.list|todo\.get_items|weather\.get|"
                      r"sensor\.|\.list_|\.search|\.fetch|\.query|\.check)")
WRITE_SVC = re.compile(r"^(input_\w+|counter|timer|variable|var|persistent_notification|logbook|system_log|recorder|"
                       r"todo|shopping_list|homeassistant\.set_location|frontend|browser_mod|input_datetime|text|notify\.persistent_notification|"
                       r"camera\.snapshot|camera\.record|scene\.create|scene\.apply|group\.set|automation\.(turn_on|turn_off|toggle|reload)|"
                       r"script\.(turn_off|reload)|logger)")
EXT_HUMAN_HINT = re.compile(r"^(assist_satellite\.ask_question|assist_satellite\.start_conversation)")


def as_list(x):
    if x is None:
        return []
    if isinstance(x, list):
        return x
    return [x]


def is_input(x):
    return isinstance(x, dict) and x.get("__tag__") == "input"


def entity_domains(step):
    ents = []
    for k in ("entity_id",):
        for src in (step, step.get("target") or {}, step.get("data") or {}):
            if isinstance(src, dict) and k in src:
                v = src[k]
                for e in as_list(v):
                    if isinstance(e, str) and "." in e and "{" not in e:
                        ents.append(e.split(".", 1)[0])
                    elif is_input(e) or is_input(v):
                        ents.append("!input")
    return sorted(set(ents))


def duration_seconds(v):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.match(r"^\s*(\d+):(\d+)(?::(\d+(?:\.\d+)?))?\s*$", v)
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3) or 0)
        if v.strip().isdigit():
            return float(v)
        return None  # template or tag
    if isinstance(v, dict) and "__tag__" not in v:
        total = 0.0
        for k, mult in (("days", 86400), ("hours", 3600), ("minutes", 60), ("seconds", 1), ("milliseconds", 0.001)):
            x = v.get(k, 0) or 0
            if isinstance(x, (int, float)):
                total += x * mult
            elif isinstance(x, str) and x.replace(".", "", 1).isdigit():
                total += float(x) * mult
            else:
                return None
        return total
    return None


class Conv:
    def __init__(self):
        self.g = cc.Graph()
        self.asyncs, self.needs, self.conns, self.notes = set(), set(), set(), []
        self.has_code = self.has_model = False
        self.templates = 0
        self.continue_on_error = 0
        self.long_waits = 0
        self.human_response_trigger = False
        self.parallel = 0

    def count_templates(self, x):
        s = json.dumps(x, default=str)
        self.templates += len(re.findall(r"\{\{|\{%", s))

    # ---------------- triggers
    def trigger(self, t):
        if is_input(t):
            self.asyncs.add("event")
            self.needs.add("event-trigger")
            return self.g.node("ha.trigger.!input", "trigger", "none", "Triggers supplied by blueprint input")
        if not isinstance(t, dict):
            return self.g.node("ha.trigger.?", "trigger", "none", "Trigger")
        p = str(t.get("trigger") or t.get("platform") or "?")
        if p in SCHEDULE_TRIG:
            self.asyncs.add("schedule"); self.needs.add("schedule-trigger")
        elif p == "webhook":
            self.asyncs.add("webhook"); self.needs.add("webhook-trigger"); self.conns.add("webhook")
        else:
            self.asyncs.add("event"); self.needs.add("event-trigger")
        if p == "mqtt":
            self.conns.add("mqtt")
        if p == "device" and isinstance(t.get("domain"), str):
            self.conns.add(t["domain"])
        if p in ("conversation", "sentence"):
            self.conns.add("assist-voice")
        ev = json.dumps(t.get("event_type"), default=str) if p == "event" else ""
        extra = ""
        if HUMAN_EVENTS.search(ev):
            self.human_response_trigger = True
            extra = " (response to an actionable notification)"
        doms = entity_domains(t)
        return self.g.node(f"ha.trigger.{p}", "trigger", "none",
                           f"{p} trigger" + (f" on {', '.join(doms)}" if doms else "") + extra)

    # ---------------- conditions
    def cond_types(self, c):
        out = []
        for x in as_list(c):
            if isinstance(x, str):
                out.append("template" if "{{" in x else "shorthand")
            elif is_input(x):
                out.append("!input")
            elif isinstance(x, dict):
                ct = x.get("condition", "?")
                out.append(str(ct) if not isinstance(ct, dict) else "!input")
        return out

    def condition(self, c, preds, label="Condition"):
        types = self.cond_types(c)
        nid = self.g.node("ha.condition." + (types[0] if len(types) == 1 else "multi"), "condition", "none",
                          f"{label}: {', '.join(types[:6])}")
        for p in preds:
            self.g.edge(p, nid)
        return nid

    # ---------------- actions
    def seq(self, steps, preds):
        if is_input(steps):
            nid = self.g.node("ha.action.!input", "other", "external", "User-supplied action sequence (blueprint input slot)")
            self.needs.add("parametric-action-input")
            for p in preds:
                self.g.edge(p, nid)
            return [nid]
        for st in as_list(steps):
            preds = self.step(st, preds)
        return preds

    def link(self, nid, preds):
        for p in preds:
            self.g.edge(p, nid)

    def step(self, st, preds):
        if is_input(st):
            return self.seq(st, preds)
        if isinstance(st, str):
            nid = self.g.node("ha.condition.template", "condition", "none", "Shorthand template condition")
            self.link(nid, preds)
            return [nid]
        if not isinstance(st, dict):
            return preds
        dis = " (disabled)" if st.get("enabled") is False else ""
        if st.get("continue_on_error"):
            self.continue_on_error += 1
        if "choose" in st:
            opts = [o for o in as_list(st["choose"]) if isinstance(o, dict)]
            if is_input(st["choose"]):
                opts = []
            gtypes = sorted({t for o in opts for t in self.cond_types(o.get("conditions"))})
            nid = self.g.node("ha.action.choose", "condition", "none",
                              f"Choose: {len(opts)} option(s){' + default' if 'default' in st else ''}; guards {', '.join(gtypes[:6])}{dis}")
            self.link(nid, preds)
            exits = []
            for o in opts:
                exits += self.seq(o.get("sequence"), [nid])
            if "default" in st:
                exits += self.seq(st["default"], [nid])
            else:
                exits.append(nid)
            return list(dict.fromkeys(exits))
        if "if" in st:
            nid = self.condition(st["if"], preds, "If")
            exits = self.seq(st.get("then"), [nid])
            exits += self.seq(st["else"], [nid]) if "else" in st else [nid]
            return list(dict.fromkeys(exits))
        if "repeat" in st and isinstance(st["repeat"], dict):
            r = st["repeat"]
            kind = next((k for k in ("for_each", "count", "while", "until") if k in r), "?")
            nid = self.g.node(f"ha.action.repeat.{kind}", "loop", "none", f"Repeat ({kind}){dis}")
            self.link(nid, preds)
            body = self.seq(r.get("sequence"), [nid])
            for b in body:
                self.g.edge(b, nid, "loop")
            if kind in ("while", "until"):
                self.notes.append("unbounded repeat while/until needs an IR maxIterations cap")
            return [nid]
        if "parallel" in st:
            self.parallel += 1
            exits = []
            for br in as_list(st["parallel"]):
                if isinstance(br, dict) and "sequence" in br and len(br) <= 3:
                    exits += self.seq(br["sequence"], preds)
                else:
                    exits += self.step(br, preds)
            return list(dict.fromkeys(exits)) or preds
        if "sequence" in st:
            return self.seq(st["sequence"], preds)
        if "wait_for_trigger" in st:
            trigs = as_list(st["wait_for_trigger"])
            human = HUMAN_EVENTS.search(json.dumps(trigs, default=str))
            to = duration_seconds(st.get("timeout")) if "timeout" in st else None
            self.asyncs.add("wait")
            self.needs.add("signal-wait")
            if "timeout" not in st or to is None or (to and to > 3600):
                self.long_waits += 1
            if human:
                nid = self.g.node("ha.action.wait_for_trigger", "human", "none",
                                  f"Wait for actionable-notification response{' (timeout)' if 'timeout' in st else ' (no timeout)'}{dis}")
            else:
                ptypes = sorted({str(t.get('trigger') or t.get('platform')) for t in trigs if isinstance(t, dict)})
                nid = self.g.node("ha.action.wait_for_trigger", "wait", "none",
                                  f"Wait for trigger ({', '.join(ptypes) or '?'}){' with timeout' if 'timeout' in st else ''}{dis}")
            self.link(nid, preds)
            return [nid]
        if "wait_template" in st:
            to = duration_seconds(st.get("timeout")) if "timeout" in st else None
            self.asyncs.add("wait"); self.needs.add("signal-wait")
            if "timeout" not in st or to is None or (to and to > 3600):
                self.long_waits += 1
            self.templates += 1
            nid = self.g.node("ha.action.wait_template", "wait", "none",
                              f"Wait until template is true{' with timeout' if 'timeout' in st else ''}{dis}")
            self.link(nid, preds)
            return [nid]
        if "delay" in st:
            d = duration_seconds(st["delay"])
            self.asyncs.add("wait")
            if d is None or d > 3600:
                self.long_waits += 1
            nid = self.g.node("ha.action.delay", "wait", "none",
                              f"Delay {int(d)}s{dis}" if d is not None else f"Delay (templated/input){dis}")
            self.link(nid, preds)
            return [nid]
        if "condition" in st and not ("action" in st and isinstance(st.get("action"), str)) and "service" not in st:
            ct = st["condition"]
            nid = self.g.node(f"ha.condition.{ct if isinstance(ct, str) else '!input'}", "condition", "none",
                              f"Gate condition: {ct if isinstance(ct, str) else '!input'}{dis}")
            if ct == "template":
                self.templates += 1
            self.link(nid, preds)
            return [nid]
        if "stop" in st:
            nid = self.g.node("ha.action.stop", "other", "none", f"Stop{' with error' if st.get('error') else ''}{dis}")
            self.link(nid, preds)
            return []
        if "variables" in st and len([k for k in st if k not in ("alias", "enabled")]) == 1:
            nid = self.g.node("ha.action.variables", "transform", "none", f"Set variables ({len(st['variables']) if isinstance(st['variables'], dict) else '?'}){dis}")
            self.count_templates(st["variables"])
            self.link(nid, preds)
            return [nid]
        if "event" in st and "service" not in st and not isinstance(st.get("action"), str):
            nid = self.g.node("ha.action.event", "action", "write", f"Fire event{dis}")
            self.link(nid, preds)
            return [nid]
        if "scene" in st and "service" not in st and not isinstance(st.get("action"), str):
            nid = self.g.node("ha.action.scene", "action", "external", f"Activate scene{dis}")
            self.link(nid, preds)
            return [nid]
        svc = st.get("service") or st.get("action")
        if isinstance(svc, str) or is_input(svc):
            return [self.service(svc, st, preds, dis)]
        if "device_id" in st and "domain" in st:
            dom = str(st.get("domain"))
            self.conns.add(dom)
            nid = self.g.node(f"ha.device_action.{dom}.{st.get('type', '?')}", "action", "external",
                              f"Device action {dom}.{st.get('type', '?')}{dis}")
            self.link(nid, preds)
            return [nid]
        nid = self.g.node("ha.action.unknown", "other", "none", f"Step with keys {', '.join(sorted(map(str, st.keys()))[:5])}{dis}")
        self.link(nid, preds)
        return [nid]

    def service(self, svc, st, preds, dis):
        if is_input(svc):
            nid = self.g.node("ha.service.!input", "action", "external", "Service chosen by blueprint input")
            self.link(nid, preds)
            return nid
        if "{{" in svc:
            self.templates += 1
            nid = self.g.node("ha.service.templated", "action", "external", f"Templated service call{dis}")
            self.link(nid, preds)
            return nid
        dom, _, name = svc.partition(".")
        doms = entity_domains(st)
        self.count_templates(st.get("data"))
        tgt = f" on {', '.join(doms)}" if doms else ""
        if dom == "notify":
            plat = re.sub(r"_[0-9a-z]+$", "", name) if name.startswith(("mobile_app", "alexa_media", "telegram", "pushover", "signal")) else name
            plat = plat if plat in ("mobile_app", "alexa_media", "telegram", "pushover", "signal", "notify", "send_message",
                                    "persistent_notification", "html5", "smtp", "discord", "slack", "matrix", "ntfy",
                                    "pushbullet", "gotify", "whatsapp", "twilio", "lametric", "nfandroidtv") else "notify-group"
            self.conns.add("notify:" + plat)
            actionable = bool(re.search(r'"actions"\s*:', json.dumps(st.get("data"), default=str)))
            cat, eff = "action", ("write" if plat == "persistent_notification" else "external")
            return self._n(f"ha.service.notify.{plat}", cat, eff,
                           f"Notify via {plat}{' (actionable)' if actionable else ''}{dis}", preds)
        if dom in ("script",) and name not in ("turn_off", "reload"):
            self.needs.add("subworkflow-call")
            return self._n("ha.service.script", "subworkflow", "external", f"Call script{dis}", preds)
        if svc in ("automation.trigger",):
            self.needs.add("subworkflow-call")
            return self._n("ha.service.automation.trigger", "subworkflow", "external", f"Trigger another automation{dis}", preds)
        if MODEL_SVC.search(svc):
            self.has_model = True
            self.conns.add(dom)
            return self._n(f"ha.service.{svc}", "model", "external", f"Model call {svc}{dis}", preds)
        if CODE_SVC.search(svc):
            self.has_code = True
            self.conns.add(dom)
            return self._n(f"ha.service.{dom}", "code", "external" if dom == "shell_command" else "write", f"Run {dom}{dis}", preds)
        if EXT_HUMAN_HINT.search(svc):
            return self._n(f"ha.service.{svc}", "human", "external", f"Voice prompt to a person {svc}{dis}", preds)
        if dom not in INTERNAL_DOMAINS:
            self.conns.add(dom)
        if dom == "tts":
            self.conns.add("tts")
            return self._n(f"ha.service.{svc}", "action", "external", f"Speak (TTS){tgt}{dis}", preds)
        if dom == "rest_command":
            return self._n("ha.service.rest_command", "action", "external", f"REST command{dis}", preds)
        if WRITE_SVC.search(svc):
            return self._n(f"ha.service.{svc}", "action", "write", f"{svc}{tgt}{dis}", preds)
        if READ_SVC.search(svc) or st.get("response_variable") and not re.search(r"turn_|set_|play|send|press", name):
            return self._n(f"ha.service.{svc}", "action", "read", f"{svc}{tgt}{' -> response' if st.get('response_variable') else ''}{dis}", preds)
        return self._n(f"ha.service.{svc}", "action", "external", f"{svc}{tgt}{dis}", preds)

    def _n(self, t, cat, eff, summ, preds):
        nid = self.g.node(t, cat, eff, summ)
        self.link(nid, preds)
        return nid

    # ---------------- top level
    def automation(self, a):
        trig_ids = [self.trigger(t) for t in as_list(a.get("triggers", a.get("trigger")))]
        if is_input(a.get("triggers", a.get("trigger"))):
            trig_ids = [self.trigger(a.get("triggers", a.get("trigger")))]
        preds = trig_ids
        conds = a.get("conditions", a.get("condition"))
        if conds:
            if is_input(conds):
                preds = [self.condition(conds, preds, "Conditions")]
            else:
                for c in as_list(conds):
                    preds = [self.condition(c, preds, "Condition")]
                    if isinstance(c, dict) and c.get("condition") == "template" or isinstance(c, str):
                        self.templates += 1
        self.seq(a.get("actions", a.get("action")), preds)
        self.mode(a)

    def script(self, s):
        if s.get("fields"):
            self.notes.append(f"{len(s['fields']) if isinstance(s['fields'], dict) else '?'} typed input field(s)")
        self.seq(s.get("sequence"), [])
        self.mode(s)

    def mode(self, a):
        m = a.get("mode")
        if isinstance(m, str) and m in ("restart", "queued", "parallel"):
            self.needs.add(f"run-mode-{m}")


def domains_of(conv, text):
    d = {"home-automation"}
    rules = [("notifications", r"notify|tts|persistent_notification"), ("security", r"alarm_control_panel|lock|camera|frigate|siren"),
             ("energy", r"energy|power|solar|battery|tariff|kwh"), ("climate", r"climate|thermostat|humid|temperature|fan"),
             ("lighting", r"light\b|lights|brightness|lux"), ("media", r"media_player|spotify|sonos|cast|plex|kodi"),
             ("presence", r"person|device_tracker|zone|presence|occupancy"), ("voice", r"conversation|assist|sentence|alexa"),
             ("appliances", r"washing|dryer|dishwasher|appliance|vacuum|roomba|lawn"), ("covers", r"cover|blind|shade|shutter|awning"),
             ("calendar", r"calendar|todo")]
    for name, rx in rules:
        if re.search(rx, text, re.I):
            d.add(name)
    if conv.has_model:
        d.add("genai")
    return sorted(d)


def finish(conv, *, iid, url, revision, lic, lic_ev, redis, raw_path, title, kind, extra_notes="", oracle_notes=None,
           desc=None, desc_prov="written", x=None):
    g = conv.g
    if len(g.nodes) < 2:
        return None
    needs = set(conv.needs)
    if conv.long_waits:
        needs.add("durable-wait>1h")
    if len(g.nodes) > 500:
        needs.add("split-over-500-nodes")
    text = json.dumps([n["type"] + " " + n["summary"] for n in g.nodes]) + " " + title
    f = cc.compute_features(g, async_kinds=conv.asyncs, connectors=sorted(conv.conns), has_code=conv.has_code,
                            has_model=conv.has_model, domains=domains_of(conv, text))
    notes = (f"Heuristic verdict (consumer-creative-homeassistant.py), not a compiled IR. {kind}: choose/if map to `when` "
             f"guards, repeat to IR loop, parallel to independent `needs` branches, continue_on_error to onError:continue, "
             f"wait_for_trigger/wait_template to a signal wait (IR wait is timer-only).")
    if conv.templates:
        notes += f" {conv.templates} Jinja template expression(s) would compile to IR code nodes."
    if conv.continue_on_error:
        notes += f" {conv.continue_on_error} step(s) continue_on_error."
    if conv.human_response_trigger:
        notes += " Triggered by a person's response to an actionable notification (human step split across automations)."
    if conv.long_waits:
        notes += f" {conv.long_waits} wait(s)/delay(s) are untimed, templated or longer than the IR's 1 h wait limit."
    if conv.notes:
        notes += " " + "; ".join(dict.fromkeys(conv.notes)) + "."
    notes += extra_notes
    item = cc.make_item(iid=iid, platform="home-assistant", url=url, revision=revision, license=lic,
                        license_evidence=lic_ev, redistributable=redis, raw_path=raw_path, title=title,
                        description=desc or (f"Home Assistant {kind.lower()}: {len(g.nodes)} nodes, triggers "
                                             f"{sum(1 for n in g.nodes if n['category'] == 'trigger')}, "
                                             f"services {sum(1 for n in g.nodes if n['type'].startswith('ha.service'))}"
                                             f"{', waits ' + str(sum(1 for n in g.nodes if n['category'] in ('wait', 'human'))) if any(n['category'] in ('wait', 'human') for n in g.nodes) else ''}."),
                        desc_provenance=desc_prov, graph=g, features=f, verdict=cc.verdict_from(sorted(needs)),
                        ir_notes=notes, oracle_notes=oracle_notes or "No executable oracle shipped with the source item.",
                        extra=dict(x or {}, score=cc.complexity(f), kind=kind))
    errs = cc.validate(item)
    if errs:
        print("invalid", iid, errs[:3], file=sys.stderr)
        return None
    return item


REDIS = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "Unlicense", "CC0-1.0", "CC-BY-4.0", "GPL-3.0", "GPL-2.0",
         "AGPL-3.0", "LGPL-3.0", "MPL-2.0"}
PII = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+|\+\d[\d -]{8,}\d")


def safe_title(t):
    return PII.sub("[redacted]", re.sub(r"\s+", " ", str(t or "")).strip())[:200]


def is_auto(x):
    return isinstance(x, dict) and ("trigger" in x or "triggers" in x) and ("action" in x or "actions" in x)


def find_objects(doc, path=()):
    """Yield (kind, obj, keypath) for automations, scripts and blueprints in one YAML document."""
    if isinstance(doc, dict) and "blueprint" in doc and isinstance(doc["blueprint"], dict):
        dom = doc["blueprint"].get("domain", "automation")
        yield ("blueprint-" + str(dom), doc, path)
        return
    if is_auto(doc):
        yield ("automation", doc, path)
        return
    if isinstance(doc, dict):
        if isinstance(doc.get("sequence"), list) and len(path) >= 1:
            yield ("script", doc, path)
            return
        for k, v in doc.items():
            if len(path) < 5:
                yield from find_objects(v, path + (str(k),))
    elif isinstance(doc, list):
        for i, v in enumerate(doc):
            if len(path) < 5:
                yield from find_objects(v, path + (str(i),))


def convert_obj(kind, obj):
    conv = Conv()
    if kind == "script" or kind == "blueprint-script":
        conv.script(obj)
    else:
        conv.automation(obj)
    return conv


def from_git(items):
    man = [e for e in json.load(open(os.path.join(ROOT, "git-manifest.json"))) if e.get("outcome") == "acquired"]
    for e in man:
        repo, base = e["repo"], e["localPath"]
        if repo == "home-assistant/home-assistant.io":
            continue
        for p in sorted(glob.glob(os.path.join(base, "**", "*.yaml"), recursive=True)):
            rel = os.path.relpath(p, base)
            if rel.startswith(".") or re.search(r"(lovelace|dashboards?|themes?|ui-lovelace|esphome|\.github|customize|"
                                                r"secrets|known_devices|node_modules|zigbee2mqtt|appdaemon/apps)", rel, re.I):
                continue
            try:
                docs = list(yaml.load_all(open(p, encoding="utf-8"), Loader=Loader))
            except Exception:
                continue
            for di, doc in enumerate(docs):
                for n, (kind, obj, kp) in enumerate(find_objects(doc)):
                    conv = convert_obj(kind, obj)
                    name = (obj.get("blueprint") or {}).get("name") if kind.startswith("blueprint") else (obj.get("alias") or obj.get("id") or (kp[-1] if kp else None))
                    keyp = "/".join(kp)[:80] or str(n)
                    lic = e.get("license", "unknown")
                    item = finish(conv, iid=re.sub(r"[^A-Za-z0-9_.:/#-]+", "-", f"home-assistant:{repo}/{rel}#{keyp}")[:180],
                                  url=f"https://github.com/{repo}/blob/{e['sha']}/{rel}", revision=f"git {e['sha']} ({e.get('commitDate')}); {cc.sha_prefix(json.dumps(obj, sort_keys=True, default=str))}",
                                  lic=lic, lic_ev=e.get("licenseEvidence", ""), redis=lic in REDIS, raw_path=p,
                                  title=safe_title(name or f"{kind} {keyp}"), kind=kind.replace("-", " ").capitalize(),
                                  x={"src": "git", "repo": repo, "role": e.get("role")})
                    if item:
                        items.append(item)


def from_forum(items):
    mp = os.path.join(ROOT, "forum-manifest.json")
    if not os.path.exists(mp):
        return
    for r in json.load(open(mp)):
        if r.get("outcome") != "acquired":
            continue
        try:
            doc = yaml.load(open(r["rawPath"], encoding="utf-8"), Loader=Loader)
        except Exception:
            continue
        if not isinstance(doc, dict) or "blueprint" not in doc:
            continue
        kind = "blueprint-" + str((doc.get("blueprint") or {}).get("domain", "automation"))
        conv = convert_obj(kind, doc)
        lic = r.get("license", "unknown")
        url = r.get("rawUrl") if r.get("via") in ("github", "gist") else r["url"]
        if r.get("via") == "github" and r.get("sha") and r.get("repo"):
            url = f"https://github.com/{r['repo']}/blob/{r['sha']}/{r['path']}"
        rev = (f"git {r['sha']}" if r.get("sha") else f"forum post v{r.get('postVersion')} updated {r.get('postUpdatedAt')}") + \
            f"; {cc.sha_prefix(open(r['rawPath'], 'rb').read())}"
        item = finish(conv, iid=f"home-assistant:forum-{r['topic']}", url=url, revision=rev, lic=lic,
                      lic_ev=r.get("licenseEvidence", ""), redis=lic in REDIS, raw_path=r["rawPath"],
                      title=safe_title((doc.get("blueprint") or {}).get("name") or r.get("title")),
                      kind=kind.replace("-", " ").capitalize(),
                      extra_notes=f" Blueprint Exchange topic {r['url']} ({r.get('likes')} likes, {r.get('views')} views).",
                      x={"src": "forum", "likes": r.get("likes"), "views": r.get("views"), "topic": r["topic"]})
        if item:
            items.append(item)


def from_docs(items):
    man = {e["repo"]: e for e in json.load(open(os.path.join(ROOT, "git-manifest.json")))}
    e = man.get("home-assistant/home-assistant.io")
    if not e or e.get("outcome") != "acquired":
        return
    base = e["localPath"]
    files = sorted(glob.glob(os.path.join(base, "source", "_docs", "**", "*.markdown"), recursive=True) +
                   glob.glob(os.path.join(base, "source", "_docs", "*.markdown")) +
                   glob.glob(os.path.join(base, "source", "_cookbook", "*.markdown")))
    for p in files:
        rel = os.path.relpath(p, base)
        text = open(p, encoding="utf-8").read()
        for bi, m in enumerate(re.finditer(r"```yaml\s*\n(.*?)```", text, re.S)):
            block = re.sub(r"\{%\s*(raw|endraw)\s*%\}", "", m.group(1))
            try:
                doc = yaml.load(block, Loader=Loader)
            except Exception:
                continue
            for n, (kind, obj, kp) in enumerate(find_objects(doc)):
                conv = convert_obj(kind, obj)
                name = obj.get("alias") if isinstance(obj, dict) else None
                item = finish(conv, iid=re.sub(r"[^A-Za-z0-9_.:/#-]+", "-", f"home-assistant:docs/{rel}#block{bi}.{n}")[:180],
                              url=f"https://github.com/home-assistant/home-assistant.io/blob/{e['sha']}/{rel}",
                              revision=f"git {e['sha']}; yaml block {bi}; {cc.sha_prefix(block)}",
                              lic=e.get("license", "CC-BY-NC-SA-4.0"), lic_ev=e.get("licenseEvidence", ""), redis=False,
                              raw_path=p, title=safe_title(name or f"Docs example {os.path.basename(rel)} #{bi}"),
                              kind="Docs " + kind.replace("-", " "),
                              x={"src": "docs", "repo": "home-assistant/home-assistant.io"})
                if item:
                    items.append(item)


def main():
    items = []
    from_git(items)
    from_forum(items)
    from_docs(items)
    seen, out = set(), []
    for it in items:  # de-duplicate identical graphs within the same source repo (copy-pasted automations)
        key = (it["x"].get("repo") or it["x"].get("src"), json.dumps(it["graph"], sort_keys=True))
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    cc.write_jsonl(OUT, out)
    print("items", len(items), "unique", len(out), "->", OUT)


if __name__ == "__main__":
    main()
