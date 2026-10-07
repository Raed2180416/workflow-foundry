"""Apple Shortcuts via WorkflowLLM / WorkflowBench seed data -> foundry-corpus-item/1 candidates.

Input (raw, outside git): /opt/corpus/apple-shortcuts/workflowllm/data.zip from
  https://huggingface.co/datasets/openbmb/WorkflowLLM @ d0de182c3f9abac5c4ded9ae2eadcd8155ee1435
  (seed_data.json: 14,523 real shortcuts transcribed by WorkflowLLM into Python-like code;
   statistics.pkl: per-shortcut action counts; dataset_split_keys.json: WorkflowBench splits).

The transcription is pseudo-Python (about 63% of it does not parse with `ast`), so this converter
uses a tolerant line/indent parser. It never executes, imports or evals corpus content.
statistics.pkl is read with an Unpickler whose find_class allows only collections/builtins
container types (no code can run).

  python3 -I consumer-creative-shortcuts.py   -> /opt/corpus/consumer-work/apple-shortcuts.candidates.jsonl
"""
import importlib.util, json, os, pickle, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cc", os.path.join(HERE, "consumer-creative-common.py"))
cc = importlib.util.module_from_spec(spec); spec.loader.exec_module(cc)

RAW = "/opt/corpus/apple-shortcuts/workflowllm"
HF_REV = "d0de182c3f9abac5c4ded9ae2eadcd8155ee1435"
ZIP_SHA = "2c1fc53d3ecabada9b61ca4af4db811af71e20a60839cc295a3b2d342c25393b"
OUT = "/opt/corpus/consumer-work/apple-shortcuts.candidates.jsonl"
SHORTCUT_INPUT_PROMPT = "Please enter the value:"

# ---------------------------------------------------------------- action taxonomy
HUMAN = {"alert", "choosefromlist", "dictatetext", "selectphoto", "documentpicker_open", "file_select",
         "selectcontacts", "takephoto", "takevideo", "recordaudio", "selectphone", "selectemail",
         "scanbarcode", "avairyeditphoto", "share", "airdropdocument", "trimvideo", "ask"}
WAIT = {"delay", "waittoreturn"}
SUBWF = {"runworkflow"}
CODE = {"runsshscript": "external", "runshellscript": "write", "runapplescript": "write",
        "runjavascriptonwebpage": "external", "runjavascriptforautomation": "write"}
TERMINAL = {"exit", "output"}
SKIP = {"getvariable", "nothing", "comment"}
EXTERNAL = {"sendmessage", "sendemail", "email", "tweet", "postonfacebook", "wordpress_post", "tumblr_post",
            "imgur_upload", "cloudapp_upload", "venmo_pay", "venmo_request", "ride_requestride",
            "openurl", "openxcallbackurl", "searchweb", "homeaccessory", "runscene", "print", "intercom",
            "evernote_new", "evernote_append", "evernote_delete", "trello_add_card", "trello_add_list",
            "trello_add_board", "todoist_add", "pocket_add", "instapaper_add", "pinboard_add",
            "dropbox_savefile", "dropbox_appendfile", "handoffplayback", "text_translate"}
READ_NET = {"getwebpagecontents", "url_getheaders", "url_expand", "rss", "rss_extract", "weather_currentconditions",
            "weather_forecast", "searchappstore", "searchitunes", "searchlocalbusinesses", "searchmaps",
            "gettraveltime", "giphy", "getarticle", "getipaddress", "shazamMedia", "evernote_get", "trello_get",
            "pocket_get", "pinboard_get", "searchpodcasts", "gethomeaccessorystate", "evernote_getlink"}
READ_LOCAL = {"getclipboard", "getcurrentlocation", "getdevicedetails", "getbatterylevel", "getwifi",
              "getmyworkflows", "getlastphoto", "getlatestphotos", "getlastscreenshot", "getlastvideo",
              "getlatestlivephotos", "getlatestbursts", "getlatestphotoimport", "takescreenshot", "getcurrentsong",
              "getupcomingevents", "getupcomingreminders", "file_getfoldercontents", "file_getlink", "file",
              "getparkedcarlocation", "dnd_getfocus", "get_playlist", "getpodcastsfromlibrary",
              "getepisodesforpodcast", "safari_geturl", "getonscreencontent", "finder_getselectedfiles",
              "personalhotspot_password_get", "properties_workflow", "posters_get", "getactions_getdevicedetails",
              "geactions_getdevicedetails"}
WRITE = {"documentpicker_save", "file_createfolder", "file_delete", "file_append", "file_move", "file_rename",
         "savetocameraroll", "deletephotos", "photos_createalbum", "removefromalbum", "addnewreminder",
         "removereminders", "setters_reminders", "addnewevent", "removeevents", "setters_calendarevents",
         "addnewcalendar", "addnewcontact", "setters_contacts", "appendnote", "health_quantity_log",
         "health_workout_log", "alarm_create", "alarm_toggle", "timer_start", "setclipboard", "setvolume",
         "setbrightness", "wifi_set", "bluetooth_set", "dnd_set", "lowpowermode_set", "airplanemode_set",
         "cellulardata_set", "cellular_rat_set", "appearance", "flashlight", "wallpaper_set",
         "orientationlock_set", "personalhotspot_set", "personalhotspot_password_set", "vpn_set", "truetone_set",
         "nightshift_set", "setairdropreceiving", "listeningmode_set", "silenceunknowncallers_set",
         "announcenotifications_set", "stagemanager_set", "posters_switch", "setplaybackdestination",
         "playmusic", "pausemusic", "skipforward", "skipback", "seek", "addtoplaylist", "createplaylist",
         "addmusictoupnext", "clearupnext", "playpodcast", "podcasts_subscribe", "lockscreen", "reboot",
         "quit_app", "hide_app", "startscreensaver", "displaysleep", "sleep", "setparkedcar", "workout_start",
         "workout_end", "lightroom_import", "exportsong", "readinglist", "sirikit_donation_handle",
         "file_reveal", "resizewindow", "movewindow", "splitscreen", "dismisssiri"}
DISPLAY = {"notification", "showresult", "previewdocument", "showwebpage", "speaktext", "playsound", "vibrate",
           "viewresult", "shownote", "showincalendar", "showdefinition", "showinstore", "reminders_showlist",
           "openapp", "returntohomescreen", "openin", "useractivity_open", "dropbox_open", "openworkflow",
           "openpasswords", "handoff", "getdirections", "getmapslink"}
FILTER_DEVICE = re.compile(r"^filter_(photos|calendarevents|reminders|notes|contacts|music|health_quantity|"
                           r"locations|apps|windows|eventattendees)$")
SERVICE_OF = {  # action -> connector (built-in app/service family)
    "sendmessage": "messages", "sendemail": "mail", "email": "mail", "tweet": "x-twitter",
    "postonfacebook": "facebook", "wordpress_post": "wordpress", "tumblr_post": "tumblr", "imgur_upload": "imgur",
    "cloudapp_upload": "cloudapp", "venmo_pay": "venmo", "venmo_request": "venmo", "ride_requestride": "ride-hailing",
    "homeaccessory": "homekit", "runscene": "homekit", "gethomeaccessorystate": "homekit",
    "evernote": "evernote", "trello": "trello", "todoist_add": "todoist", "pocket": "pocket",
    "instapaper_add": "instapaper", "pinboard": "pinboard", "dropbox": "dropbox", "health": "apple-health",
    "addnewreminder": "reminders", "filter_reminders": "reminders", "removereminders": "reminders",
    "getupcomingreminders": "reminders", "addnewevent": "calendar", "filter_calendarevents": "calendar",
    "getupcomingevents": "calendar", "removeevents": "calendar", "appendnote": "notes", "filter_notes": "notes",
    "playmusic": "music", "filter_music": "music", "addtoplaylist": "music", "getcurrentsong": "music",
    "playpodcast": "podcasts", "searchpodcasts": "podcasts", "weather": "weather", "searchmaps": "maps",
    "getdirections": "maps", "gettraveltime": "maps", "searchlocalbusinesses": "maps",
    "searchappstore": "app-store", "searchitunes": "itunes", "shazamMedia": "shazam", "giphy": "giphy",
    "runsshscript": "ssh", "readinglist": "safari-reading-list", "text_translate": "apple-translate",
    "savetocameraroll": "photos", "selectphoto": "photos", "filter_photos": "photos", "deletephotos": "photos",
    "selectcontacts": "contacts", "filter_contacts": "contacts", "print": "airprint", "intercom": "homepod-intercom",
}
MODEL_HOSTS = re.compile(r"(api\.openai\.com|openai\.azure\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|"
                         r"api\.cohere\.(ai|com)|api-inference\.huggingface\.co|api\.replicate\.com|api\.stability\.ai|"
                         r"api\.perplexity\.ai|api\.mistral\.ai|api\.groq\.com|openrouter\.ai|api\.deepseek\.com|"
                         r"api\.together\.xyz|aip\.baidubce\.com|dashscope\.aliyuncs\.com|api\.x\.ai)", re.I)
MODEL_INTENT = re.compile(r"openai|chatgpt|anthropic|claude|gemini|perplexity|\bLLM|_LLM", re.I)
CODE_INTENT = re.compile(r"Scriptable_RunScript|ExecuteCommandIntent|Pythonista|Jayson|a_Shell|ish_|RunJavaScript|"
                         r"Pyto|ScriptableRun|RunScript", re.I)
INTENT_RE = re.compile(r"\b((?:com|net|org|dk|io|de|ke|fr|me|co|app|framework|mini|ws|nl|ch|uk|jp|cn|ru|se|at|it|es|"
                       r"pl|be|au|ca|in|eu|ai|tv|us|info|biz|cc|tech|dev|ly|xyz|ink|one|pro|codes|studio)_"
                       r"[A-Za-z0-9]+_[A-Za-z0-9_]+)\s*\(")
ACTION_RE = re.compile(r"\bis_workflow_actions_([A-Za-z0-9_]+)\s*\(")
INPUT_RE = re.compile(r"(?<![A-Za-z0-9_.])input\s*\(")
URL_RE = re.compile(r"\b(https?)://([A-Za-z0-9.-]+\.[A-Za-z]{2,})", re.I)
SCHEME_RE = re.compile(r"(?<![A-Za-z0-9+.-])([a-z][a-z0-9+.-]{2,30})://", re.I)
IDENT_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")
STMT_START = re.compile(r"^\s*(if |elif |else\s*:|for |while |match |case |pass\b|[A-Za-z_][A-Za-z0-9_]*\s*=|"
                        r"is_workflow_actions_)")


def logical_lines(code):
    """Collapse string literals (keeping the raw text) and yield (indent, codeText, rawText)."""
    out, i, n = [], 0, len(code)
    cbuf, rbuf, depth, indent, at_start = [], [], 0, 0, True
    while i < n:
        ch = code[i]
        if at_start:
            j = i
            while j < n and code[j] in " \t":
                j += 1
            indent = code[i:j].replace("\t", "    ").__len__()
            i = j
            at_start = False
            continue
        if ch == "#" and depth == 0:
            while i < n and code[i] != "\n":
                i += 1
            continue
        if ch in "'\"":
            q3 = code[i:i + 3]
            if q3 in ("'''", '"""'):
                j = i + 3
                while j < n and code[j:j + 3] != q3:
                    j += 2 if code[j] == "\\" else 1
                rbuf.append(code[i:j + 3].replace("\n", " ")); cbuf.append("S")
                i = j + 3
                continue
            j = i + 1
            while j < n and code[j] != ch and code[j] != "\n":
                j += 2 if code[j] == "\\" else 1
            if j < n and code[j] == ch:
                rbuf.append(code[i:j + 1]); cbuf.append("S"); i = j + 1
            else:  # unterminated single-line string: keep the rest of the line as raw text
                rbuf.append(code[i:j]); cbuf.append("S"); i = j
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch == "\n":
            if depth > 0:
                # malformed transcriptions leave brackets open; stop swallowing when a new statement starts
                nxt = code[i + 1:i + 200].split("\n", 1)[0]
                lead = len(nxt) - len(nxt.lstrip(" "))
                if STMT_START.match(nxt) and lead <= indent:
                    depth = 0
            if depth == 0:
                c, r = "".join(cbuf).strip(), "".join(rbuf).strip()
                if c:
                    out.append((indent, c, r))
                cbuf, rbuf, at_start = [], [], True
                i += 1
                continue
            cbuf.append(" "); rbuf.append(" "); i += 1
            continue
        cbuf.append(ch); rbuf.append(ch); i += 1
    c, r = "".join(cbuf).strip(), "".join(rbuf).strip()
    if c:
        out.append((indent, c, r))
    return out


def stmt_kind(c):
    for k, rx in (("if", r"^if\b"), ("elif", r"^elif\b"), ("else", r"^else\s*:"), ("for", r"^for\b"),
                  ("while", r"^while\b"), ("match", r"^match\b"), ("case", r"^case\b"), ("pass", r"^pass\b")):
        if re.match(rx, c):
            return k
    return "simple"


def build_tree(lines):
    root = {"kind": "root", "indent": -1, "children": []}
    stack = [root]
    for ind, c, r in lines:
        k = stmt_kind(c)
        st = {"kind": k, "indent": ind, "code": c, "raw": r, "children": []}
        while len(stack) > 1 and stack[-1]["indent"] >= ind:
            stack.pop()
        stack[-1]["children"].append(st)
        if k in ("if", "elif", "else", "for", "while", "match", "case") and c.endswith(":"):
            stack.append(st)
    return root


def calls_in(c, r):
    """Ordered (inner-first) list of ('action'|'intent'|'input', name, prompt, depth)."""
    found = []

    def depth_at(text, pos):
        d = 0
        for ch in text[:pos]:
            if ch == "(":
                d += 1
            elif ch == ")":
                d = max(0, d - 1)
        return d
    for m in ACTION_RE.finditer(r):
        found.append(("action", m.group(1), None, depth_at(r, m.start()), m.start()))
    for m in INTENT_RE.finditer(c):
        name = m.group(1)
        if name in ("coerce_variable", "unit_variable_transform") or name.startswith("is_workflow"):
            continue
        found.append(("intent", name, None, depth_at(c, m.start()), m.start()))
    for m in INPUT_RE.finditer(r):
        tail = r[m.end():m.end() + 300]
        pm = re.match(r"\s*(?:prompt\s*=\s*)?f?(?:'''|\"\"\"|'|\")(.*?)(?:'''|\"\"\"|'|\")", tail)
        found.append(("input", "input", pm.group(1) if pm else "", depth_at(r, m.start()), m.start()))
    found.sort(key=lambda t: (-t[3], t[4]))
    return found


class Conv:
    def __init__(self):
        self.g = cc.Graph()
        self.var = {}            # variable -> producing node
        self.connectors, self.asyncs, self.needs = set(), set(), []
        self.input_node = None
        self.has_code = self.has_model = False
        self.exit_inside_block = False
        self.acts = set()

    # ----- node classification
    def classify(self, kind, name, prompt, raw):
        if kind == "input":
            if (prompt or "").strip() == SHORTCUT_INPUT_PROMPT:
                return None  # Shortcut Input magic variable, handled separately
            return ("shortcuts.ask", "human", "none", "Ask for input")
        if kind == "intent":
            parts = name.split("_")
            app = ".".join(parts[:-1]) if len(parts) > 2 else name
            self.connectors.add("app:" + app.lower()[:60])
            if CODE_INTENT.search(name):
                self.has_code = True
                return ("intent:" + name, "code", "write", f"Run script via app intent {parts[-1]}")
            if MODEL_INTENT.search(name):
                self.has_model = True
                return ("intent:" + name, "model", "external", f"Model app intent {parts[-1]}")
            if re.search(r"CreateMenu|Choose|Ask|Prompt|Picker|Select", name):
                return ("intent:" + name, "human", "none", f"Interactive app intent {parts[-1]}")
            eff = "read" if re.search(r"Get|Check|Fetch|Read|Find|Search|Exists", parts[-1]) else "external"
            if re.search(r"AccessibilityUtilities|MobileTimer|mobilenotes|DataJar_Set|Toolbox", name):
                eff = "write"
            return ("intent:" + name, "action", eff, f"App intent {parts[-1]}")
        a = name
        self.acts.add(a)
        t = "is.workflow.actions." + a.replace("_", ".")
        for k, v in SERVICE_OF.items():
            if a == k or a.startswith(k):
                self.connectors.add(v)
                break
        if a in SKIP:
            return None
        if a in HUMAN:
            return (t, "human", "none", a)
        if a in WAIT:
            self.asyncs.add("wait")
            if a == "waittoreturn":
                self.needs.append("signal-wait")
            return (t, "wait", "none", a)
        if a in SUBWF:
            self.needs.append("subworkflow-call")
            return (t, "subworkflow", "external", "Run another shortcut")
        if a in CODE:
            self.has_code = True
            return (t, "code", CODE[a], a)
        if a in TERMINAL:
            return (t, "other", "none", "Stop shortcut" if a == "exit" else "Stop and output")
        if a == "downloadurl":
            hosts = [h.lower() for _, h in URL_RE.findall(raw)]
            meth = re.search(r"WFHTTPMethod\s*=\s*f?'''(\w+)'''", raw)
            m = (meth.group(1).upper() if meth else "GET")
            if MODEL_HOSTS.search(raw):
                self.has_model = True
                return (t, "model", "external", f"HTTP {m} to hosted model API")
            return (t, "action", "external" if m in ("POST", "PUT", "PATCH", "DELETE") else "read",
                    f"HTTP {m}" + (f" {hosts[0]}" if hosts else ""))
        if a in EXTERNAL:
            if a == "openxcallbackurl":
                self.needs.append("signal-wait")
                self.asyncs.add("wait")
            return (t, "action", "external", a)
        if a in READ_NET or a in READ_LOCAL or FILTER_DEVICE.match(a):
            return (t, "action", "read", a)
        if a in WRITE or a.endswith("_set") or a.startswith("setters_"):
            return (t, "action", "write", a)
        if a in DISPLAY:
            return (t, "action", "none", a)
        return (t, "transform", "none", a)

    # ----- graph emission
    def simple(self, st, preds):
        c, r = st["code"], st["raw"]
        made = []
        for kind, name, prompt, _, _ in calls_in(c, r):
            if kind == "input" and (prompt or "").strip() == SHORTCUT_INPUT_PROMPT:
                if self.input_node is None:
                    self.input_node = self.g.node("shortcuts.input", "trigger", "none",
                                                  "Shortcut input (share sheet, widget, Siri or caller)")
                continue
            cl = self.classify(kind, name, prompt, r)
            if cl is None:
                continue
            nid = self.g.node(*cl)
            made.append((nid, name))
        # data edges from variables referenced on this line
        refs = set(IDENT_RE.findall(r))
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=", c)
        target = m.group(1) if m else None
        if made:
            first = made[0][0]
            for v in refs:
                if v != target and v in self.var and self.var[v] != first:
                    self.g.edge(self.var[v], first, "data")
            if self.input_node and SHORTCUT_INPUT_PROMPT in r:
                self.g.edge(self.input_node, first, "data")
            for p in preds:
                self.g.edge(p, first, "control")
            for (a, _), (b, _) in zip(made, made[1:]):
                self.g.edge(a, b, "control")
            if target:
                self.var[target] = made[-1][0]
            last, lname = made[-1]
            if lname in TERMINAL:
                return []
            return [last]
        if target:  # alias / literal assignment: propagate producer
            srcs = [self.var[v] for v in refs if v != target and v in self.var]
            if srcs:
                self.var[target] = srcs[-1]
            elif self.input_node and SHORTCUT_INPUT_PROMPT in r:
                self.var[target] = self.input_node
        return preds

    def block(self, stmts, preds, depth=0):
        i = 0
        while i < len(stmts):
            st = stmts[i]
            k = st["kind"]
            if k == "simple":
                preds = self.simple(st, preds)
                if not preds and depth > 0:
                    self.exit_inside_block = True
            elif k == "if":
                c = self.g.node("shortcuts.if", "condition", "none", "If " + self.cond_summary(st["code"]))
                self.data_refs(st["raw"], c)
                for p in preds:
                    self.g.edge(p, c)
                exits = self.block(st["children"], [c], depth + 1)
                has_else = False
                while i + 1 < len(stmts) and stmts[i + 1]["kind"] in ("elif", "else"):
                    i += 1
                    nxt = stmts[i]
                    if nxt["kind"] == "else":
                        has_else = True
                        exits += self.block(nxt["children"], [c], depth + 1)
                    else:
                        c2 = self.g.node("shortcuts.if", "condition", "none", "Else if " + self.cond_summary(nxt["code"]))
                        self.g.edge(c, c2)
                        exits += self.block(nxt["children"], [c2], depth + 1)
                        c = c2
                if not has_else:
                    exits.append(c)
                preds = list(dict.fromkeys(exits))
            elif k in ("for", "while"):
                is_each = "enumerate(" in st["code"] or k == "for" and "range(" not in st["code"]
                lbl = "Repeat with each" if is_each else ("Repeat count" if "range(" in st["code"] else "Repeat while")
                L = self.g.node("is.workflow.actions.repeat." + ("each" if is_each else "count"), "loop", "none", lbl)
                self.data_refs(st["raw"], L)
                for p in preds:
                    self.g.edge(p, L)
                body_exits = self.block(st["children"], [L], depth + 1)
                for e in body_exits:
                    self.g.edge(e, L, "loop")
                preds = [L]
            elif k == "match":
                is_menu = bool(INPUT_RE.search(st["raw"]))
                if is_menu:
                    M = self.g.node("is.workflow.actions.choosefrommenu", "human", "none",
                                    f"Choose from menu ({sum(1 for ch in st['children'] if ch['kind'] == 'case')} options)")
                else:
                    M = self.g.node("shortcuts.switch", "condition", "none", "Match value")
                    self.data_refs(st["raw"], M)
                for p in preds:
                    self.g.edge(p, M)
                exits, has_default = [], False
                for ch in st["children"]:
                    if ch["kind"] != "case":
                        continue
                    if re.match(r"^case\s+_\s*:", ch["code"]):
                        has_default = True
                    exits += self.block(ch["children"], [M], depth + 1)
                if not has_default:
                    exits.append(M)
                preds = list(dict.fromkeys(exits))
            elif k in ("else", "elif", "case", "pass"):
                pass  # handled by their parent / no-op
            i += 1
        return preds

    def data_refs(self, raw, nid):
        for v in set(IDENT_RE.findall(raw)):
            if v in self.var and self.var[v] != nid:
                self.g.edge(self.var[v], nid, "data")
        if self.input_node and SHORTCUT_INPUT_PROMPT in raw:
            self.g.edge(self.input_node, nid, "data")

    @staticmethod
    def cond_summary(code):
        ops = re.findall(r"(==|!=|>=|<=|>|<|\bnot in\b|\bin\b|\bnot\b)", code)
        return ("(" + ", ".join(dict.fromkeys(ops)) + ")") if ops else "(has any value)"


def domains_of(acts, connectors, has_model):
    d = {"consumer-mobile"}
    s = " ".join(acts) + " " + " ".join(connectors)
    rules = [("home-automation", r"homekit|homeaccessory|runscene|TVRemote"), ("genai", r"\bmodel\b"),
             ("social-media", r"x-twitter|facebook|tumblr|wordpress|mastodon|reddit|instagram"),
             ("health-fitness", r"health|workout"), ("media", r"image_|encodemedia|makegif|music|podcast|trimvideo|photos"),
             ("productivity", r"reminders|calendar|notes|evernote|todoist|trello|pocket|instapaper"),
             ("web-api", r"downloadurl|getwebpagecontents|rss"), ("device-settings", r"_set\b|appearance|flashlight"),
             ("messaging", r"messages|mail|whatsapp|telegram"), ("finance", r"venmo|monzo|bank"),
             ("files", r"file_|documentpicker|makezip|unzip")]
    for name, rx in rules:
        if re.search(rx, s):
            d.add(name)
    if has_model:
        d.add("genai")
    return sorted(d)


def load_stats():
    allow = {("collections", "defaultdict"), ("collections", "Counter"), ("collections", "OrderedDict"),
             ("builtins", "list"), ("builtins", "dict"), ("builtins", "int"), ("builtins", "set"),
             ("builtins", "str"), ("builtins", "float"), ("builtins", "tuple"), ("builtins", "frozenset")}

    class Safe(pickle.Unpickler):
        def find_class(self, module, name):
            if (module, name) in allow:
                return super().find_class(module, name)
            raise pickle.UnpicklingError(f"blocked {module}.{name}")
    with zipfile.ZipFile(os.path.join(RAW, "data.zip")) as z:
        with z.open("statistics.pkl") as fh:
            return Safe(fh).load()


def main():
    with zipfile.ZipFile(os.path.join(RAW, "data.zip")) as z:
        seed = json.loads(z.read("seed_data.json"))
        splits = json.loads(z.read("dataset_split_keys.json"))
    split_of = {k: s for s, ks in splits.items() for k in ks}
    stats = load_stats()
    items, fails = [], 0
    for idx, e in enumerate(seed):
        code = e["workflow_code"].replace("\x00", "")
        try:
            conv = Conv()
            root = build_tree(logical_lines(code))
            conv.block(root["children"], [])
        except Exception as ex:  # keep going; count
            fails += 1
            continue
        g = conv.g
        if not g.nodes:
            continue
        nodes_n = len(g.nodes)
        needs = list(conv.needs)
        if nodes_n > 500:
            needs.append("split-over-500-nodes")
        connectors = set()
        for c in conv.connectors:
            connectors.add(c)
        for scheme, host in URL_RE.findall(code):
            h = host.lower().rstrip(".")
            parts = h.split(".")
            reg = ".".join(parts[-3:]) if len(parts) > 2 and parts[-2] in ("co", "com", "org", "net", "gov", "ac") else ".".join(parts[-2:])
            if reg not in ("icloud.com", "apple.com", "routinehub.co") or "api" in h:
                connectors.add("web:" + reg)
        for sch in SCHEME_RE.findall(code):
            s = sch.lower()
            if s not in ("http", "https", "shortcuts", "file", "data", "ftp", "mailto"):
                connectors.add("url-scheme:" + s)
        conn = sorted(connectors)
        f = cc.compute_features(g, async_kinds=conv.asyncs, connectors=conn, has_code=conv.has_code,
                                has_model=conv.has_model, domains=domains_of(conv.acts, conn, conv.has_model))
        st = stats.get(e["key"]) or {}
        split = split_of.get(e["key"], "unsplit")
        notes = ("Heuristic verdict from a tolerant parse of the WorkflowLLM Python transcription "
                 "(consumer-creative-shortcuts.py), not a compiled IR. Shortcuts run on demand (manual, share sheet, "
                 "Siri, widget or an on-device automation configured outside the file), so no trigger extension is "
                 "needed. Menus/asks/alerts map to IR human nodes, If/Menu branches to `when` guards, Repeat to loop.")
        if needs:
            notes += " Needs: " + ", ".join(sorted(set(needs))) + "."
        if conv.exit_inside_block:
            notes += " Stops early inside a branch/loop (Stop Shortcut / Stop and Output); expressible by propagating negated `when` guards to downstream nodes."
        if st:
            notes += f" Source action count (WorkflowLLM statistics.pkl): {st.get('num_nodes')}, nesting depth {st.get('depth')}, control statements {st.get('control_statements')}; normalized graph omits Get Variable/Comment/Nothing actions."
        q = e.get("query") or ""
        desc = q if q else f"Apple Shortcut '{e['key']}'"
        item = cc.make_item(
            iid=f"apple-shortcuts:workflowllm-seed-{idx:05d}",
            platform="apple-shortcuts",
            url=f"https://huggingface.co/datasets/openbmb/WorkflowLLM/blob/{HF_REV}/data.zip#seed_data.json[{idx}]",
            revision=f"hf openbmb/WorkflowLLM@{HF_REV}; data.zip sha256:{ZIP_SHA[:16]}; seed_data.json[{idx}] key={e['key'][:80]!r}; code {cc.sha_prefix(code)}",
            license="Apache-2.0",
            license_evidence=("README.md of huggingface.co/datasets/openbmb/WorkflowLLM@" + HF_REV + " ends with "
                              "'license: apache-2.0' (front matter placed at the end, so the HF API shows no licence tag); "
                              "github.com/OpenBMB/WorkflowLLM LICENSE @ 2b5a2dee5fefbb6bf2fe68310393c3cf0c24cfcc is Apache-2.0 "
                              "(read 2026-10-07). Caveat: the seed shortcuts were collected by the dataset authors from public "
                              "sharing sites (inferred from the 'RoutineHub •' key prefixes); the original shortcut authors' "
                              "terms were not re-verified per item."),
            redistributable=True,
            raw_path=f"{RAW}/data.zip#seed_data.json[{idx}]",
            title=e["key"],
            description=desc, desc_provenance="recovered-by-model" if q else "written",
            graph=g, features=f, verdict=cc.verdict_from(needs), ir_notes=notes,
            oracle_notes=("No executable oracle: Shortcuts run only on iOS/macOS. WorkflowBench scores generated code by "
                          f"CodeBLEU and a model-judged pass rate. WorkflowBench split of this key: {split}."),
            extra={"split": split, "srcActions": st.get("num_nodes"), "depth": st.get("depth"),
                   "score": cc.complexity(f)})
        errs = cc.validate(item)
        if errs:
            fails += 1
            continue
        items.append(item)
    cc.write_jsonl(OUT, items)
    json.dump({"seed": len(seed), "converted": len(items), "parseFailures": fails,
               "emptyGraphs": len(seed) - len(items) - fails}, open(OUT.replace(".candidates.jsonl", ".report.json"), "w"), indent=1)
    print(f"seed {len(seed)} converted {len(items)} failed {fails} -> {OUT}")


if __name__ == "__main__":
    main()
