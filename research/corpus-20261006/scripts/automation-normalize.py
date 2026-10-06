#!/usr/bin/env python3
"""Normalize automation-cluster raw downloads (/opt/corpus/*) into foundry-corpus-item/1 records.

Usage: python3 -I automation-normalize.py [--out ../parts/automation.jsonl] [--stats stats.json]

Inputs are the raw copies written by automation-fetch-*.py (n8n, node-red, dify, activepieces, zapier)
and the shallow sparse git clones (langflow, flowise, coze-studio) described in automation-ledger.md.
All corpus content is untrusted data: it is parsed as JSON/YAML only, never executed, and no text from
it is interpreted as an instruction. For items whose licence is unknown or ToS-governed
(redistributable:false) the output keeps only the URL, title, a derived graph (synthetic node ids,
derived summaries) and features; descriptions are written by this script from the features.

Heuristics (documented, not validated against a runtime):
  category/effects come from per-platform node-type tables below; `effects` is read for
  get/list/search-like operations, write for create/update/send-like operations, external for
  connector calls whose effect cannot be read off the operation, none for pure steps (incl. model calls).
  branching = condition-category nodes + other nodes with >=2 used non-error output ports.
  loops = loop-category nodes + back edges (DFS) that do not enter a loop-category node.
"""
import argparse, collections, glob, gzip, hashlib, json, os, random, re, sys
import yaml

sys.dont_write_bytecode = True

RETRIEVED = '2026-10-06'
SEED = 20261006
HERE = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------------------- helpers

def sha(b):
    if isinstance(b, str):
        b = b.encode()
    return hashlib.sha256(b).hexdigest()


def kebab(s):
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1-\2', s or '')
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-').lower()
    return s


def clip(s, n=200):
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    return s if len(s) <= n else s[: n - 1] + '…'


READ_OP = re.compile(r'^(get|getall|list|search|read|lookup|find|download|query|fetch|retrieve|select|count|exists|check|scrape|crawl|load|watch|poll|extract|parse|search_or|inspect|export|transcribe)', re.I)
WRITE_OP = re.compile(r'(create|update|delete|remove|send|post|append|upsert|insert|upload|add|^set|move|copy|publish|reply|archive|share|cancel|clear|patch|put|mark|label|tweet|like|invite|complete|close|write|edit|save|submit|respond|notify|assign|pause|subscribe|unsubscribe|book|charge|refund|invoice|forward|approve|reject)', re.I)


def op_effect(op, default='external'):
    if not op:
        return default
    op = str(op)
    if READ_OP.search(op) and not WRITE_OP.search(op.split('_')[0] if '_' in op else op):
        return 'read'
    if WRITE_OP.search(op):
        return 'write'
    if READ_OP.search(op):
        return 'read'
    return default


class Graph:
    def __init__(self, redistributable):
        self.redis = redistributable
        self.nodes = []          # dicts with private keys _ports, _async, _connectors, _human, _ext
        self.by_key = {}
        self.edges = []
        self.edge_set = set()

    def add(self, key, ntype, category, effects, summary, label=None, **priv):
        nid = key if self.redis else f'n{len(self.nodes) + 1}'
        if self.redis and label:
            summary = f'{label} — {summary}' if summary and summary != label else label
        n = {'id': str(nid), 'type': str(ntype), 'category': category, 'effects': effects,
             'summary': clip(summary)}
        n.update({'_' + k: v for k, v in priv.items()})
        self.nodes.append(n)
        self.by_key[key] = n
        return n

    def edge(self, a, b, kind='data', port=0, tool=False):
        if a not in self.by_key or b not in self.by_key:
            return False
        s, t = self.by_key[a]['id'], self.by_key[b]['id']
        k = (s, t, kind)
        if k in self.edge_set:
            return False
        self.edge_set.add(k)
        self.edges.append({'from': s, 'to': t, 'kind': kind, '_port': port, '_tool': tool})
        return True

    def has_edge(self, a, b):
        if a not in self.by_key or b not in self.by_key:
            return False
        s, t = self.by_key[a]['id'], self.by_key[b]['id']
        return any((s, t, k) in self.edge_set for k in ('data', 'control', 'error', 'loop'))


def mark_back_edges(g):
    """Iterative DFS from sources; edges closing a cycle become kind 'loop' (unless 'error').
    Edges a converter already labelled 'loop' (explicit loop-back edges) are not traversed, and control
    edges are explored before data edges, so reference edges are not mistaken for loop-backs."""
    adj = collections.defaultdict(list)
    indeg = collections.Counter()
    rank = {'control': 0, 'error': 1, 'data': 2}
    for i, e in sorted(enumerate(g.edges), key=lambda x: (rank.get(x[1]['kind'], 3), x[0])):
        if e['kind'] == 'loop':
            continue
        adj[e['from']].append(i)
        indeg[e['to']] += 1
    ids = [n['id'] for n in g.nodes]
    color = {i: 0 for i in ids}
    back = []
    roots = [i for i in ids if indeg[i] == 0] + ids
    for r in roots:
        if color.get(r):
            continue
        stack = [(r, iter(adj[r]))]
        color[r] = 1
        while stack:
            v, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                color[v] = 2
                stack.pop()
                continue
            w = g.edges[nxt]['to']
            c = color.get(w, 0)
            if c == 1:
                back.append(nxt)
            elif c == 0:
                color[w] = 1
                stack.append((w, iter(adj[w])))
    for i in back:
        if g.edges[i]['kind'] != 'error':
            g.edges[i]['kind'] = 'loop'
    return back


EXT_ORDER = ['schedule-trigger', 'webhook-trigger', 'event-trigger', 'chat-session', 'stream',
             'error-branch', 'retry-policy', 'subworkflow-call', 'agent-tool-loop', 'conversation-state',
             'unstructured-cycle', 'dynamic-fan-out', 'external-state-store', 'signal-resume']


CONN_ALIAS = {'open-ai': 'openai', 'azure-open-ai': 'azure-openai', 'hub-spot': 'hubspot', 'you-tube': 'youtube',
              'linked-in': 'linkedin', 'woo-commerce': 'woocommerce', 'mongo-db': 'mongodb', 'git-hub': 'github',
              'git-lab': 'gitlab', 'word-press': 'wordpress', 'drop-box': 'dropbox', 'click-up': 'clickup',
              'ring-central': 'ringcentral', 'serp-api': 'serpapi', 'open-router': 'openrouter', 'google-mail': 'gmail',
              'deep-seek': 'deepseek', 'mistral-cloud': 'mistral', 'mistral-ai': 'mistral', 'git-hub-api': 'github',
              'open-weather-map': 'openweathermap', 'post-gres': 'postgres', 'my-sql': 'mysql', 'pg-vector': 'pgvector',
              'whats-app': 'whatsapp', 'postgres-chat': 'postgres', 'redis-chat': 'redis', 'mongo-db-chat': 'mongodb',
              'table': 'zapier-tables', 'storage': 'zapier-storage', 'zapier-mail': 'zapier-email'}


def finalize(g, base, domains, ext, oracle, notes, written_desc_prefix):
    back = mark_back_edges(g)
    loop_ids = {n['id'] for n in g.nodes if n['category'] == 'loop'}
    wait_ids = {n['id'] for n in g.nodes if n['category'] in ('wait', 'human')}
    preds = collections.defaultdict(set)
    succ = collections.defaultdict(set)
    for e in g.edges:
        succ[e['from']].add(e['to'])
        preds[e['to']].add(e['from'])
    cyc = poll = 0
    for i in back:
        e = g.edges[i]
        if e['to'] not in loop_ids and e['from'] not in loop_ids:
            cyc += 1
            # nodes on the cycle: reachable from target and reaching source
            fw, st = {e['to']}, [e['to']]
            while st:
                v = st.pop()
                for w in succ[v]:
                    if w not in fw:
                        fw.add(w); st.append(w)
            bw, st = {e['from']}, [e['from']]
            while st:
                v = st.pop()
                for w in preds[v]:
                    if w not in bw:
                        bw.add(w); st.append(w)
            if (fw & bw) & wait_ids:
                poll += 1
    for n in g.nodes:
        if 'agent-tool-loop?' in (n.get('_ext') or ()):
            n['_ext'] = set(n['_ext']) - {'agent-tool-loop?'}
            if any(e['to'] == n['id'] and e.get('_tool') for e in g.edges):
                n['_ext'].add('agent-tool-loop')
        n['_connectors'] = [CONN_ALIAS.get(c, c) for c in (n.get('_connectors') or [])]
    if cyc:
        notes = (notes or '') + f'{cyc} back-edge(s) outside loop constructs ({poll} pass through a wait/human step, i.e. poll-until loops); rewrite to IR loop needed. '
    outs = collections.defaultdict(set)
    ports = collections.defaultdict(set)
    for e in g.edges:
        outs[e['from']].add(e['to'])
        if e['kind'] != 'error':
            ports[e['from']].add(e['_port'])
    branching = 0
    for n in g.nodes:
        if n['category'] == 'condition':
            branching += 1
        elif len(ports[n['id']]) >= 2:
            branching += 1
    asyncs = set()
    connectors = set()
    human = 0
    for n in g.nodes:
        for a in n.get('_async') or []:
            asyncs.add(a)
        for c in n.get('_connectors') or []:
            if c:
                connectors.add(c)
        if n['category'] == 'human':
            human += 1
        for x in n.get('_ext') or []:
            ext.add(x)
    if cyc:
        ext.add('unstructured-cycle')
    if any(e['kind'] == 'error' for e in g.edges) or any(n['category'] == 'error-handler' for n in g.nodes):
        ext.add('error-branch')
    if any(n['category'] == 'subworkflow' for n in g.nodes):
        ext.add('subworkflow-call')
    if 'schedule' in asyncs:
        ext.add('schedule-trigger')
    if 'webhook' in asyncs:
        ext.add('webhook-trigger')
    if 'event' in asyncs or 'poll' in asyncs:
        ext.add('event-trigger')
    eff = collections.Counter(n['effects'] for n in g.nodes)
    feats = {
        'nodeCount': len(g.nodes), 'edgeCount': len(g.edges),
        'maxFanOut': max([len(v) for v in outs.values()] or [0]),
        'branching': branching, 'loops': len(loop_ids) + cyc,
        'async': sorted(asyncs), 'humanSteps': human,
        'effects': {'read': eff['read'], 'write': eff['write'], 'external': eff['external']},
        'connectors': sorted(connectors),
        'hasCode': any(n['category'] == 'code' for n in g.nodes),
        'hasModelCalls': any(n['category'] == 'model' for n in g.nodes),
        'subworkflows': sum(1 for n in g.nodes if n['category'] == 'subworkflow'),
        'domains': sorted({kebab(d) for d in domains if d}),
    }
    unsupported = [x for x in ext if x.startswith('unsupported:')]
    exts = [x for x in EXT_ORDER if x in ext] + sorted(x for x in ext if x not in EXT_ORDER and not x.startswith('unsupported:'))
    if not g.nodes:
        verdict = 'unsupported:empty-graph'
    elif unsupported:
        verdict = unsupported[0]
    elif exts:
        verdict = 'via-extension:' + '+'.join(exts)
    else:
        verdict = 'native'
    inote = 'Heuristic verdict from node categories (automation-normalize.py), not a compiled IR. '
    if exts:
        inote += 'Needs: ' + ', '.join(exts) + '. '
    if unsupported and exts:
        inote += 'Also: ' + ', '.join(exts) + '. '
    inote += notes or ''
    nodes = [{k: v for k, v in n.items() if not k.startswith('_')} for n in g.nodes]
    edges = [{k: v for k, v in e.items() if not k.startswith('_')} for e in g.edges]
    item = dict(base)
    if not item['source']['redistributable'] or not item.get('description', {}).get('text'):
        item['description'] = {'text': written_description(written_desc_prefix, feats, g), 'provenance': 'written'}
    item['graph'] = {'nodes': nodes, 'edges': edges}
    item['features'] = feats
    item['ir'] = {'verdict': verdict, 'notes': clip(inote, 600)}
    item['oracle'] = oracle
    return item


def written_description(prefix, f, g):
    cats = collections.Counter(n['category'] for n in g.nodes)
    trig = sorted({n['type'] for n in g.nodes if n['category'] == 'trigger'})[:3]
    parts = [prefix.strip()]
    parts.append(f"{f['nodeCount']} nodes, {f['edgeCount']} edges")
    if trig:
        parts.append('trigger: ' + ', '.join(trig))
    detail = []
    for c in ('model', 'code', 'condition', 'loop', 'human', 'wait', 'subworkflow', 'error-handler'):
        if cats[c]:
            detail.append(f'{cats[c]} {c}')
    if detail:
        parts.append('; '.join(detail))
    if f['connectors']:
        parts.append('connectors: ' + ', '.join(f['connectors'][:12]) + (' …' if len(f['connectors']) > 12 else ''))
    return clip('. '.join(parts) + '.', 600)


def base_item(platform, sid, url, revision, license_, evidence, redis, raw, title, desc=None):
    return {
        'schema': 'foundry-corpus-item/1',
        'id': f'{platform}:{sid}',
        'source': {'platform': platform, 'url': url, 'revision': revision, 'retrievedAt': RETRIEVED,
                   'license': license_, 'licenseEvidence': evidence, 'redistributable': redis, 'rawPath': raw},
        'title': clip(title, 200),
        'description': {'text': clip(desc, 600) if (desc and redis) else '', 'provenance': 'original'},
    }


ORACLE_NONE = {'kind': 'none', 'notes': 'No executable oracle shipped with the source item.'}

# ----------------------------------------------------------------------------- n8n

N8N_CORE = set('''set if switch filter merge code function functionItem splitInBatches wait noOp splitOut aggregate
sort limit removeDuplicates dateTime crypto html markdown xml renameKeys summarize extractFromFile convertToFile
itemLists executeWorkflow executeWorkflowTrigger manualTrigger scheduleTrigger cron interval start stickyNote
respondToWebhook webhook form formTrigger stopAndError errorTrigger compareDatasets editImage compression
moveBinaryData spreadsheetFile readWriteFile readBinaryFile readBinaryFiles writeBinaryFile executeCommand jwt
evaluation evaluationTrigger debugHelper httpRequest httpRequestTool totp aiTransform executionData simulate
simulateTrigger sseTrigger localFileTrigger workflowTrigger n8nTrigger respondWith dataTable dataTableTool
emailSend emailReadImap rssFeedRead rssFeedReadTrigger ftp ssh graphql'''.split())
N8N_LC_NONCONN = set('''agent agentTool chainLlm chainRetrievalQa chainSummarization outputParserStructured
outputParserAutofixing outputParserItemList memoryBufferWindow memoryManager vectorStoreInMemory
vectorStoreInMemoryInsert vectorStoreInMemoryLoad toolCode toolThink toolCalculator toolWorkflow toolVectorStore
toolHttpRequest chatTrigger chat manualChatTrigger documentDefaultDataLoader documentBinaryInputLoader
documentJsonInputLoader textClassifier informationExtractor sentimentAnalysis retrieverVectorStore
retrieverWorkflow retrieverMultiQuery retrieverContextualCompression textSplitterRecursiveCharacterTextSplitter
textSplitterTokenSplitter textSplitterCharacterTextSplitter mcpTrigger mcpClientTool code modelSelector
guardrails toolExecutor'''.split())
LC_PREFIX = re.compile(r'^(lmChat|lm|embeddings|vectorStore|memory|tool|reranker|retriever|document)')
N8N_MODEL = re.compile(r'^(agent|agentTool|chainLlm|chainRetrievalQa|chainSummarization|lmChat.*|lm[A-Z].*|openAi|googleGemini|anthropic|ollama|mistralAi|embeddings.*|textClassifier|informationExtractor|sentimentAnalysis|outputParserAutofixing|reranker.*|modelSelector|guardrails|aiTransform|perplexity|xAiGrok|deepSeek|groq)$')


def n8n_connector(t):
    pkg, _, base = t.rpartition('.')
    if pkg == 'n8n-nodes-base':
        if base in N8N_CORE:
            return None
        b = re.sub(r'(Trigger|Tool)$', '', base)
        if b in N8N_CORE:
            return None
        return kebab(b)
    if pkg == '@n8n/n8n-nodes-langchain':
        if base in N8N_LC_NONCONN:
            return None
        b = LC_PREFIX.sub('', base)
        b = re.sub(r'(Tool|Trigger|Insert|Load)$', '', b)
        if not b or b in ('Chat', 'Window'):
            return None
        return kebab(b)
    # community node package
    m = re.match(r'^(?:@[^/]+/)?(?:n8n-nodes-)?([^.]+)', pkg)
    return 'community:' + kebab(m.group(1) if m else base)


def n8n_node(t, p, node):
    """Return category, effects, async list, ext set, op summary."""
    pkg, _, base = t.rpartition('.')
    p = p or {}
    op = p.get('operation') or p.get('mode') if isinstance(p.get('operation') or p.get('mode'), str) else None
    res = p.get('resource') if isinstance(p.get('resource'), str) else None
    opdesc = '.'.join(x for x in (res, op) if x)
    asyncs, ext = [], set()
    if base == 'stickyNote':
        return None
    if base == 'errorTrigger':
        return 'error-handler', 'none', ['event'], ext, opdesc
    if base in ('manualTrigger', 'start', 'executeWorkflowTrigger', 'evaluationTrigger', 'manualChatTrigger', 'workflowTrigger'):
        return 'trigger', 'none', [], ext, opdesc
    if base in ('scheduleTrigger', 'cron', 'interval'):
        return 'trigger', 'none', ['schedule'], ext, opdesc
    if base in ('webhook', 'formTrigger', 'mcpTrigger', 'sseTrigger'):
        return 'trigger', 'none', ['webhook'], ext, opdesc
    if base == 'chatTrigger':
        ext.add('chat-session')
        return 'trigger', 'none', ['webhook'], ext, opdesc
    if base.endswith('Trigger') or base in ('emailReadImap',):
        a = 'poll' if ('pollTimes' in p or base in ('emailReadImap', 'rssFeedReadTrigger')) else 'event'
        return 'trigger', 'read', [a], ext, opdesc
    if base in ('if', 'switch', 'filter', 'compareDatasets'):
        return 'condition', 'none', [], ext, opdesc
    if base == 'splitInBatches':
        return 'loop', 'none', [], ext, opdesc
    if base == 'merge':
        return 'merge', 'none', [], ext, opdesc
    if base == 'wait':
        resume = p.get('resume')
        if resume == 'form':
            return 'human', 'none', ['wait'], ext, 'resume=form'
        if resume == 'webhook':
            ext.add('signal-resume')
            return 'wait', 'none', ['wait', 'webhook'], ext, 'resume=webhook'
        return 'wait', 'none', ['wait'], ext, 'resume=' + str(resume or 'timeInterval')
    if base == 'form':
        return 'human', 'none', ['wait'], ext, opdesc
    if op == 'sendAndWait' or (isinstance(p.get('operation'), str) and p.get('operation') == 'sendAndWait'):
        return 'human', 'write', ['wait'], ext, opdesc
    if base in ('code', 'function', 'functionItem', 'toolCode', 'aiTransform') and pkg != '@n8n/n8n-nodes-langchain' or base == 'toolCode':
        return 'code', 'none', [], ext, opdesc + (' lang=' + str(p.get('language')) if p.get('language') else '')
    if pkg == '@n8n/n8n-nodes-langchain' and base == 'code':
        return 'code', 'none', [], ext, opdesc
    if base == 'executeCommand':
        return 'code', 'external', [], ext, 'host shell command'
    if base in ('executeWorkflow', 'toolWorkflow', 'retrieverWorkflow'):
        return 'subworkflow', 'external', [], ext, opdesc
    if base == 'stopAndError':
        return 'error-handler', 'none', [], ext, opdesc
    if pkg == '@n8n/n8n-nodes-langchain' and base.startswith('memory'):
        ext.add('conversation-state')
        eff = 'none' if base in ('memoryBufferWindow', 'memoryManager') else 'write'
        return 'other', eff, [], ext, opdesc
    if pkg == '@n8n/n8n-nodes-langchain' and base.startswith('vectorStore'):
        m = str(p.get('mode') or 'retrieve')
        return 'action', ('write' if 'insert' in m.lower() or 'update' in m.lower() else 'read'), [], ext, 'mode=' + m
    if N8N_MODEL.match(base) or (pkg == 'n8n-nodes-base' and base in ('openAi', 'mistralAi', 'perplexity')):
        if base in ('agent', 'agentTool'):
            ext.add('agent-tool-loop?')
        return 'model', 'none', [], ext, opdesc
    if base in ('set', 'splitOut', 'aggregate', 'sort', 'limit', 'removeDuplicates', 'dateTime', 'crypto', 'html',
                'markdown', 'xml', 'renameKeys', 'summarize', 'extractFromFile', 'convertToFile', 'itemLists',
                'spreadsheetFile', 'moveBinaryData', 'compression', 'editImage', 'jwt', 'outputParserStructured',
                'outputParserItemList', 'documentDefaultDataLoader', 'documentBinaryInputLoader',
                'documentJsonInputLoader', 'toolCalculator', 'totp', 'globalConstants') or base.startswith('textSplitter'):
        return 'transform', 'none', [], ext, opdesc
    if base in ('noOp', 'toolThink', 'stickyNote', 'debugHelper', 'evaluation', 'executionData'):
        return 'other', 'none', [], ext, opdesc
    if base == 'respondToWebhook':
        return 'action', 'write', [], ext, 'respond ' + str(p.get('respondWith') or '')
    if base in ('httpRequest', 'httpRequestTool', 'toolHttpRequest'):
        m = str(p.get('method') or p.get('requestMethod') or 'GET').upper()
        return 'action', ('read' if m == 'GET' else 'external'), [], ext, m
    if base in ('dataTable', 'dataTableTool'):
        ext.add('external-state-store')
        return 'action', op_effect(op, 'read'), [], ext, opdesc
    if base == 'readWriteFile' or base.startswith('readBinary') or base == 'writeBinaryFile':
        return 'action', ('write' if 'write' in (op or base).lower() else 'read'), [], ext, opdesc
    if base.endswith('Tool') or base.startswith('tool') or base == 'mcpClientTool':
        return 'action', op_effect(op, 'external'), [], ext, opdesc
    return 'action', op_effect(op, 'external'), [], ext, opdesc


def n8n_items(limit_complex=95, limit_rep=40):
    root = '/opt/corpus/n8n'
    cands = json.load(open(f'{root}/candidates.json'))
    idx = json.load(open(f'{root}/index.json'))
    pool_b = set(cands['poolB'])
    out = []
    for fn in sorted(glob.glob(f'{root}/workflows/*.json.gz')):
        raw = gzip.open(fn).read()
        d = json.loads(raw)['workflow']
        wf = d.get('workflow') or {}
        tid = d['id']
        g = Graph(False)
        names = {}
        n8n_has_pin = bool(wf.get('pinData'))
        has_eval = False
        retry = 0
        ext = set()
        for node in wf.get('nodes') or []:
            t = node.get('type', '')
            r = n8n_node(t, node.get('parameters'), node)
            if r is None:
                continue
            cat, eff, asy, x, opdesc = r
            if 'evaluation' in t:
                has_eval = True
            if node.get('retryOnFail'):
                retry += 1
            if node.get('onError') in ('continueRegularOutput', 'continueErrorOutput'):
                x = set(x) | {'error-branch'}
            conn = n8n_connector(t)
            short = t.split('.')[-1]
            g.add(node['name'], t, cat, eff, f'{short}' + (f' {opdesc}' if opdesc else ''),
                  **{'async': asy, 'connectors': [conn] if conn else [], 'ext': x})
            names[node['name']] = node
        for src, conns in (wf.get('connections') or {}).items():
            srcnode = names.get(src)
            for ctype, outputs in (conns or {}).items():
                for port, targets in enumerate(outputs or []):
                    for tgt in targets or []:
                        kind = 'data'
                        if ctype == 'ai_tool':
                            kind = 'control'
                        elif ctype == 'error':
                            kind = 'error'
                        elif ctype == 'main' and srcnode is not None and srcnode.get('onError') == 'continueErrorOutput' \
                                and port == len(outputs) - 1 and len(outputs) >= 2:
                            kind = 'error'
                        g.edge(src, tgt.get('node'), kind, port if ctype == 'main' else f'{ctype}:{port}', tool=(ctype == 'ai_tool'))
        if retry:
            ext.add('retry-policy')
        meta = idx.get(str(tid), {})
        cats = [c.get('name') for c in d.get('categories') or []]
        if has_eval:
            oracle = {'kind': 'test-profile', 'notes': 'Workflow embeds n8n Evaluation nodes (dataset-driven self-test); dataset itself not shipped with the template.'}
        elif n8n_has_pin:
            oracle = {'kind': 'mocked-execution', 'notes': f'Template ships pinData for {len(wf.get("pinData") or {})} node(s); pinned outputs allow partial mocked replay (not a success oracle).'}
        else:
            oracle = ORACLE_NONE
        rev = f'template {tid}; createdAt {d.get("createdAt")}; sha256:{sha(raw)[:16]}'
        base = base_item('n8n', tid, f'https://n8n.io/workflows/{tid}', rev,
                         'ToS:https://n8n.io/legal/self-serve-terms/',
                         'api.n8n.io template API response has no licence field; creator-submitted content, no open licence found on n8n.io/legal (checked 2026-10-06)',
                         False, fn, d.get('name') or meta.get('name') or str(tid))
        notes = ''
        comm = sorted({n['_connectors'][0] for n in g.nodes if n.get('_connectors') and n['_connectors'][0].startswith('community:')})
        if comm:
            notes += 'Uses community (non-core) node packages: ' + ', '.join(comm[:5]) + '. '
        item = finalize(g, base, cats, ext, oracle, notes, 'n8n template-library workflow')
        out.append((item, 'rep' if tid in pool_b else 'pool'))
    return select(out, limit_complex, limit_rep, 'n8n')


def complexity(item):
    f = item['features']
    nonlin = f['branching'] + f['loops'] + f['humanSteps'] + f['subworkflows']
    return (f['nodeCount'] + 2 * f['branching'] + 3 * f['loops'] + 4 * f['humanSteps'] + 2 * f['subworkflows']
            + 2 * len(f['async']) + 1.5 * len(f['connectors']) + 2 * (1 if 'error-branch' in item['ir']['verdict'] else 0)
            + (2 if f['hasCode'] else 0) + (2 if f['hasModelCalls'] else 0) + (3 if nonlin >= 4 else 0))


def signature(item):
    return tuple(sorted(collections.Counter(n['type'] for n in item['graph']['nodes']).items()))


def select(rows, n_complex, n_rep, platform):
    """rows: [(item, pool)] -> list of (item, stratum). Complex = top score (dedup by node-type multiset);
    representative = seeded sample from the 'rep' pool (or everything not chosen)."""
    seen = set()
    chosen = []
    rows = [r for r in rows if r[0]['features']['nodeCount'] >= 2 and r[0]['features']['edgeCount'] >= 1]
    ranked = sorted(rows, key=lambda r: (-complexity(r[0]), r[0]['id']))
    for it, pool in ranked:
        if len(chosen) >= n_complex:
            break
        s = signature(it)
        if s in seen or it['features']['nodeCount'] == 0:
            continue
        seen.add(s)
        chosen.append((it, 'complex'))
    ids = {it['id'] for it, _ in chosen}
    rep_pool = [it for it, pool in rows if pool == 'rep' and it['id'] not in ids]
    if len(rep_pool) < n_rep:
        rep_pool = [it for it, pool in rows if it['id'] not in ids]
    rep_pool.sort(key=lambda it: it['id'])
    rng = random.Random(f'{SEED}:{platform}')
    rep = rng.sample(rep_pool, min(n_rep, len(rep_pool)))
    chosen += [(it, 'representative') for it in sorted(rep, key=lambda it: it['id'])]
    return chosen

# ----------------------------------------------------------------------------- Node-RED

NR_SKIP = {'tab', 'comment', 'group', 'junction', 'subflow'}
NR_STREAM = re.compile(r'(mqtt in|websocket in|tcp in|udp in|serial in|amqp in|kafka.*consumer|nats in|opcua.*(subscribe|listener)|modbus-read|modbus-flex-getter|s7 in|ble|zigbee|server-state-changed|trigger-state|server-events|events: all|events: state|ha-.*-in|zwave-js|deconz-input|tasmota|websocket-listener|socketio.*in)', re.I)
NR_HUMAN = re.compile(r'^(ui_(button|form|text_input|switch|slider|dropdown|numeric|date_picker|colour_picker|toast)|ui-(button|form|text-input|switch|slider|dropdown|number-input|date-picker|radio-group|button-group|file-input|notification)|telegram (command|callback)|discord.*(interaction|button)|.*approval.*)$', re.I)
NR_MODEL = re.compile(r'(openai|chatgpt|gpt|llm|ollama|gemini|claude|anthropic|langchain|ai-agent|ai agent|huggingface|tensorflow|tf-|mistral|groq|perplexity|deepseek)', re.I)


def nr_category(n):
    t = n.get('type', '')
    tl = t.lower()
    if tl == 'inject':
        sched = bool(n.get('repeat') or n.get('crontab'))
        return 'trigger', 'none', ['schedule'] if sched else [], set(), 'repeat/cron' if sched else 'manual inject'
    if tl == 'http in':
        return 'trigger', 'none', ['webhook'], set(), str(n.get('method') or '').upper()
    if tl == 'catch':
        return 'error-handler', 'none', ['event'], set(), 'catch scope=' + ('all' if not n.get('scope') else str(len(n['scope'])))
    if tl in ('status', 'complete'):
        return 'trigger', 'none', ['event'], set(), tl
    if tl in ('link in', 'link out'):
        return 'other', 'none', [], set(), tl
    if tl == 'link call':
        return 'subworkflow', 'none', [], set(), 'link call'
    if tl.startswith('subflow:'):
        return 'subworkflow', 'none', [], set(), 'subflow instance'
    if re.search(r'approv', tl):
        return 'human', 'none', ['wait'], set(), t
    if NR_HUMAN.match(t):
        # dashboard / chat input widgets: human-initiated events on a long-lived UI, not in-run human steps
        return 'trigger', 'none', ['event'], set(), 'UI input widget ' + t
    if NR_STREAM.search(t):
        return 'trigger', 'read', ['event'], {'stream'}, t
    if tl in ('switch', 'rbe', 'filter', 'ha-switch', 'api-current-state', 'current-state'):
        return 'condition', ('read' if 'state' in tl else 'none'), [], set(), tl
    if tl in ('function', 'python3-function', 'pythonshell in', 'function-npm', 'jsonata'):
        return 'code', 'none', [], set(), tl
    if tl in ('exec', 'daemon'):
        return 'code', 'external', [], set(), 'host process'
    if tl == 'split':
        return 'loop', 'none', [], {'dynamic-fan-out'}, 'split message into parts'
    if tl in ('join', 'batch'):
        return 'merge', 'none', [], set(), tl
    if tl in ('delay', 'trigger', 'cronplus', 'bigtimer', 'stoptimer', 'looptimer', 'timerswitch', 'schedex', 'eztimer'):
        if tl in ('cronplus', 'bigtimer', 'schedex', 'eztimer', 'timerswitch'):
            return 'trigger', 'none', ['schedule'], set(), tl
        return 'wait', 'none', ['wait'], set(), tl
    if tl in ('change', 'template', 'json', 'xml', 'csv', 'yaml', 'html', 'sort', 'range', 'moment', 'base64', 'buffer-parser', 'string', 'smooth', 'split-text'):
        return 'transform', 'none', [], set(), tl
    if tl in ('debug', 'ui_text', 'ui_gauge', 'ui_chart', 'ui_template', 'ui_audio', 'ui_ui_control', 'ui-text', 'ui-chart', 'ui-gauge', 'ui-template', 'ui-markdown', 'ui-table', 'ui_table'):
        return 'other', 'none', [], set(), tl
    if NR_MODEL.search(t):
        return 'model', 'none', [], set(), t
    if tl in ('http request',):
        m = str(n.get('method') or 'GET').upper()
        return 'action', ('read' if m == 'GET' else 'external'), [], set(), m
    if tl in ('http response', 'websocket out', 'mqtt out', 'tcp out', 'udp out', 'e-mail', 'file', 'serial out', 'twitter out', 'pushbullet', 'pushover', 'api-call-service', 'call-service', 'ha-api'):
        return 'action', 'write', [], set(), tl
    if tl in ('file in', 'watch', 'tail', 'e-mail in', 'feedparse', 'rss'):
        if tl in ('watch', 'tail', 'e-mail in', 'feedparse'):
            return 'trigger', 'read', ['poll' if tl in ('e-mail in', 'feedparse') else 'event'], set(), tl
        return 'action', 'read', [], set(), tl
    if tl in ('global-config',) or tl.startswith('ui_') or tl.startswith('ui-'):
        return 'other', 'none', [], set(), tl
    if re.search(r'(sql|mongo|influx|redis|postgres|mysql|sqlite|firebase|firestore|couch|mssql|oracle|database|db)', tl):
        return 'action', 'external', [], {'external-state-store'}, tl
    if re.search(r'( in|-in|_in|listener|receive|subscribe|watcher)$', tl):
        return 'trigger', 'read', ['event'], {'stream'}, tl
    if re.search(r'( out|-out|_out|send|write|publish|set|notify|command|control)$', tl):
        return 'action', 'write', [], set(), tl
    return 'action', 'external', [], set(), tl


NR_NONCONN = {'inject', 'debug', 'function', 'change', 'switch', 'template', 'json', 'xml', 'csv', 'yaml', 'html',
              'split', 'join', 'sort', 'batch', 'range', 'delay', 'trigger', 'exec', 'catch', 'status', 'complete',
              'link in', 'link out', 'link call', 'comment', 'rbe', 'filter', 'file', 'file in', 'watch', 'tail',
              'python3-function', 'moment', 'base64', 'jsonata', 'smooth', 'junction'}


def nr_connector(t):
    tl = t.lower()
    if tl in NR_NONCONN or tl.startswith('subflow:'):
        return None
    if tl.startswith('ui_') or tl.startswith('ui-'):
        return 'node-red-dashboard'
    if tl.startswith('http'):
        return 'http'
    if tl in ('api-call-service', 'call-service', 'server-state-changed', 'trigger-state', 'poll-state', 'api-current-state',
              'current-state', 'server-events', 'ha-entity', 'ha-api', 'ha-button', 'ha-switch', 'ha-sensor', 'ha-get-entities',
              'ha-wait-until', 'ha-time', 'ha-device', 'ha-tag', 'ha-zone', 'ha-webhook', 'ha-fire-event', 'ha-sentence',
              'ha-number', 'ha-select', 'ha-text', 'ha-time-entity', 'ha-date', 'ha-binary-sensor', 'ha-update-config',
              'api-render-template', 'api-get-history') or tl.startswith('ha-'):
        return 'home-assistant'
    b = re.sub(r'( in| out| request| response|-in|-out|_in|_out|-request|-response| node)$', '', tl)
    b = re.sub(r'\s+', '-', b)
    return kebab(b) or None


def nodered_items(n_complex=32, n_rep=13):
    rows = []
    for fn in sorted(glob.glob('/opt/corpus/node-red/pages/*.json.gz')):
        for thing in json.load(gzip.open(fn)).get('data') or []:
            fid = thing.get('_id') or thing.get('id')
            try:
                flow = json.loads(thing.get('flow') or '[]')
            except Exception:
                continue
            if isinstance(flow, dict):
                flow = flow.get('flows') or [flow]
            if not isinstance(flow, list):
                continue
            g = Graph(False)
            ext = set()
            wires = []
            catches = []
            types = collections.Counter()
            for n in flow:
                if not isinstance(n, dict):
                    continue
                t = str(n.get('type', ''))
                if t in NR_SKIP or 'wires' not in n and t not in ('link in', 'catch', 'status', 'complete'):
                    continue
                cat, eff, asy, x, sm = nr_category(n)
                conn = nr_connector(t)
                g.add(n.get('id'), t, cat, eff, sm, **{'async': asy, 'connectors': [conn] if conn else [], 'ext': x})
                types[t] += 1
                for port, outs in enumerate(n.get('wires') or []):
                    for tgt in outs or []:
                        wires.append((n.get('id'), tgt, 'data', port))
                if t in ('link out', 'link call'):
                    for tgt in n.get('links') or []:
                        wires.append((n.get('id'), tgt, 'control' if t == 'link call' else 'data', 'link'))
                if t == 'catch':
                    catches.append(n)
            for a, b, k, p in wires:
                g.edge(a, b, k, p)
            for c in catches:
                for s in c.get('scope') or []:
                    g.edge(s, c.get('id'), 'error', 'catch')
            nui = sum(v for k, v in types.items() if k.lower().startswith('ui_') or k.lower().startswith('ui-'))
            if g.nodes and nui / max(1, len(g.nodes)) > 0.4:
                ext.add('unsupported:interactive-dashboard-state')
            uses_ctx = any(isinstance(n, dict) and n.get('type') in ('function', 'change') and re.search(r'(flow|global)\.(get|set)|"(flow|global)"', json.dumps(n)) for n in flow)
            if uses_ctx:
                ext.add('external-state-store')
            tags = []
            for tg in thing.get('tags') or []:
                tags += [x.strip() for x in str(tg).split(',') if x.strip()]
            raw = json.dumps(thing, sort_keys=True)
            rev = f'gist {fid}; updated_at {thing.get("updated_at")}; sha256:{sha(raw)[:16]}'
            base = base_item('node-red', fid, f'https://flows.nodered.org/flow/{fid}', rev, 'unknown',
                             'flows.nodered.org library entry is a GitHub gist with no licence field; site terms https://terms-of-use.openjsf.org (checked 2026-10-06)',
                             False, fn + f'#{fid}', clip(thing.get('description') or fid, 120))
            notes = 'Node-RED flows are long-lived message-passing programs; a run is not naturally bounded. '
            if uses_ctx:
                notes += 'Uses flow/global context (persistent state). '
            item = finalize(g, base, tags[:6], ext, ORACLE_NONE, notes, 'Node-RED flow-library flow')
            if item['features']['nodeCount'] >= 3:
                rows.append((item, 'rep'))
    return select(rows, n_complex, n_rep, 'node-red')

# ----------------------------------------------------------------------------- Activepieces

AP_BUILTIN = {'schedule', 'webhook', 'forms', 'http', 'store', 'data-mapper', 'date-helper', 'text-helper', 'json',
              'delay', 'approval', 'subflows', 'tables', 'math-helper', 'csv', 'file-helper', 'pdf', 'crypto', 'connections',
              'manual-task', 'utility-ai', 'ai', 'agent', 'text-ai', 'image-ai', 'graphql', 'xml', 'qrcode', 'image-helper',
              'tags', 'data-summarizer', 'sftp', 'smtp', 'imap', 'rss', 'mcp', 'todos'}
AP_MODEL = re.compile(r'piece-(ai|utility-ai|text-ai|image-ai|agent|openai|anthropic|claude|gemini|google-gemini|mistral-ai|perplexity-ai|groq|deepseek|ollama|azure-openai|cohere|hugging-face|elevenlabs|stability-ai|replicate|vertex-ai|openrouter|xai|grok|together-ai|deepgram|assemblyai)$')


def ap_piece(name):
    return re.sub(r'^@activepieces/piece-', '', name or '')


def ap_classify(pieceName, actionName, is_trigger=False):
    p = ap_piece(pieceName)
    a = actionName or ''
    x = set()
    if is_trigger:
        if p == 'schedule':
            return 'trigger', 'none', ['schedule'], x
        if p in ('webhook',):
            return 'trigger', 'none', ['webhook'], x
        if p == 'forms':
            if 'chat' in a:
                x.add('chat-session')
            return 'trigger', 'none', ['webhook'], x
        if p == 'manual-trigger':
            return 'trigger', 'none', [], x
        if p == 'subflows':
            return 'trigger', 'none', [], x
        return 'trigger', 'read', ['event'], x
    if p == 'approval' or p == 'manual-task' or 'approval' in a.lower() or a in ('wait_for_approval', 'create_approval_link'):
        return 'human', 'none', ['wait'], x
    if p == 'todos':
        return 'human', 'write', ['wait'], x
    if p == 'delay':
        if 'next_webhook' in a or 'webhook' in a:
            x.add('signal-resume')
            return 'wait', 'none', ['wait', 'webhook'], x
        return 'wait', 'none', ['wait'], x
    if p == 'subflows':
        if 'response' in a:
            return 'action', 'write', [], x
        return 'subworkflow', 'external', [], x
    if AP_MODEL.search(pieceName or ''):
        if p == 'agent':
            x.add('agent-tool-loop')
        return 'model', 'none', [], x
    if p in ('data-mapper', 'date-helper', 'text-helper', 'json', 'math-helper', 'csv', 'file-helper', 'pdf', 'crypto', 'xml', 'qrcode', 'image-helper', 'data-summarizer'):
        return 'transform', 'none', [], x
    if p == 'store' or p == 'tables':
        x.add('external-state-store')
        return 'action', op_effect(a, 'read'), [], x
    if p == 'forms':
        return 'action', 'write', [], x
    if p == 'http':
        return 'action', 'external', [], x
    return 'action', op_effect(a, 'external'), [], x


def activepieces_items(n_complex=27, n_rep=13):
    fn = '/opt/corpus/activepieces/templates-all.json'
    raw = open(fn, 'rb').read()
    rows = []
    for t in json.loads(raw)['data']:
        g = Graph(False)
        ext = set()
        refs = []
        counter = [0]

        def add(key, a, cat, eff, asy, x, sm):
            pn = (a.get('settings') or {}).get('pieceName')
            c = ap_piece(pn) if pn else None
            conn = [c] if c and c not in AP_BUILTIN else []
            if c in ('ai', 'utility-ai', 'text-ai', 'image-ai', 'agent'):
                conn = []
            g.add(key, a.get('type') + (':' + c if c else ''), cat, eff, sm, **{'async': asy, 'connectors': conn, 'ext': x})
            inp = json.dumps((a.get('settings') or {}).get('input') or {})
            for m in sorted(set(re.findall(r"\{\{\s*(step_\d+|trigger|loop_\d+|step_[A-Za-z0-9_]+)", inp))):
                refs.append((m, key))
            eho = (a.get('settings') or {}).get('errorHandlingOptions') or {}
            if (eho.get('continueOnFailure') or {}).get('value'):
                ext.add('error-branch')
            if (eho.get('retryOnFailure') or {}).get('value'):
                ext.add('retry-policy')

        def chain(a, preds, prefix, kind='control'):
            """walk an action chain; returns exit keys"""
            exits = preds
            first = True
            while a:
                key = prefix + a['name']
                s = a.get('settings') or {}
                ty = a['type']
                if ty == 'CODE':
                    add(key, a, 'code', 'none', [], set(), 'code step')
                elif ty == 'LOOP_ON_ITEMS':
                    add(key, a, 'loop', 'none', [], set(), 'loop on items')
                elif ty == 'ROUTER':
                    br = s.get('branches') or []
                    add(key, a, 'condition', 'none', [], set(), f'router {len(br)} branches, mode={s.get("executionType", "")}')
                elif ty == 'BRANCH':
                    add(key, a, 'condition', 'none', [], set(), 'branch')
                else:
                    cat, eff, asy, x = ap_classify(s.get('pieceName'), s.get('actionName'))
                    add(key, a, cat, eff, asy, x, f'{ap_piece(s.get("pieceName"))}.{s.get("actionName")}')
                for p in exits:
                    g.edge(p, key, kind if first else 'control')
                first = False
                exits = [key]
                if ty == 'LOOP_ON_ITEMS':
                    body_exits = chain(a.get('firstLoopAction'), [key], prefix)
                    for b in body_exits:
                        if b != key:
                            g.edge(b, key, 'loop')
                elif ty == 'ROUTER':
                    outs = []
                    for i, ch in enumerate(a.get('children') or []):
                        if ch is None:
                            outs.append(key)
                            continue
                        before = len(g.edges)
                        e = chain(ch, [key], prefix)
                        for ed in g.edges[before:before + 1]:
                            ed['_port'] = i
                        outs += e
                    exits = sorted(set(outs)) or [key]
                elif ty == 'BRANCH':
                    outs = chain(a.get('onSuccessAction'), [key], prefix) + chain(a.get('onFailureAction'), [key], prefix)
                    exits = sorted(set(outs)) or [key]
                a = a.get('nextAction')
            return exits

        for fi, f in enumerate(t.get('flows') or []):
            tr = f.get('trigger') or {}
            prefix = f'f{fi}.' if len(t.get('flows') or []) > 1 else ''
            s = tr.get('settings') or {}
            cat, eff, asy, x = ap_classify(s.get('pieceName'), s.get('triggerName'), True)
            add(prefix + 'trigger', tr, cat, eff, asy, x, f'{ap_piece(s.get("pieceName"))}.{s.get("triggerName")}')
            chain(tr.get('nextAction'), [prefix + 'trigger'], prefix)
        for src, dst in refs:
            pref = dst.split('.')[0] + '.' if '.' in dst else ''
            sk = pref + src
            if sk in g.by_key and sk != dst and not g.has_edge(sk, dst):
                g.edge(sk, dst, 'data')
        rev = f'template {t["id"]}; updated {t.get("updated")}; sha256:{sha(json.dumps(t, sort_keys=True))[:16]}'
        base = base_item('activepieces', t['id'], f'https://www.activepieces.com/templates/{t["id"]}', rev,
                         'ToS:https://www.activepieces.com/terms',
                         'cloud.activepieces.com/api/v1/templates response has no licence field (repo code is MIT but templates are served content); checked 2026-10-06',
                         False, fn + f'#{t["id"]}', t.get('name') or t['id'])
        item = finalize(g, base, t.get('categories') or [], ext, ORACLE_NONE, '', 'Activepieces official template')
        rows.append((item, 'rep'))
    return select(rows, n_complex, n_rep, 'activepieces')

# ----------------------------------------------------------------------------- Dify

DIFY_CAT = {
    'start': ('trigger', 'none', []), 'end': ('other', 'none', []), 'answer': ('action', 'write', []),
    'llm': ('model', 'none', []), 'agent': ('model', 'none', []), 'question-classifier': ('model', 'none', []),
    'parameter-extractor': ('model', 'none', []), 'knowledge-retrieval': ('action', 'read', []),
    'if-else': ('condition', 'none', []), 'code': ('code', 'none', []), 'template-transform': ('transform', 'none', []),
    'http-request': ('action', 'external', []), 'tool': ('action', 'external', []),
    'variable-aggregator': ('merge', 'none', []), 'variable-assigner': ('merge', 'none', []),
    'assigner': ('transform', 'none', []), 'iteration': ('loop', 'none', []), 'iteration-start': ('other', 'none', []),
    'loop': ('loop', 'none', []), 'loop-start': ('other', 'none', []), 'loop-end': ('other', 'none', []),
    'document-extractor': ('transform', 'none', []), 'list-operator': ('transform', 'none', []),
    'human-input': ('human', 'none', ['wait']), 'trigger-schedule': ('trigger', 'none', ['schedule']),
    'trigger-webhook': ('trigger', 'none', ['webhook']), 'trigger-plugin': ('trigger', 'read', ['event']),
    'knowledge-index': ('action', 'write', []), 'datasource': ('action', 'read', []),
}


def dify_graph(y, redis):
    g = Graph(redis)
    ext = set()
    mode = (y.get('app') or {}).get('mode')
    graph = ((y.get('workflow') or {}).get('graph') or {})
    if mode == 'advanced-chat':
        ext.add('chat-session')
    for n in graph.get('nodes') or []:
        d = n.get('data') or {}
        t = d.get('type') or n.get('type')
        if t in ('custom-note', None) or n.get('type') == 'custom-note':
            continue
        cat, eff, asy = DIFY_CAT.get(t, ('action', 'external', []))
        x = set()
        conns = []
        sm = t
        if t == 'tool':
            prov = d.get('provider_id') or d.get('provider_name') or ''
            conns = [kebab(str(prov).split('/')[-1])] if prov else []
            sm = f'tool {prov}/{d.get("tool_name", "")}'
            eff = op_effect(d.get('tool_name'), 'external')
        elif t in ('llm', 'question-classifier', 'parameter-extractor', 'agent'):
            m = (d.get('model') or {})
            prov = m.get('provider') or ''
            conns = [kebab(str(prov).split('/')[-1])] if prov else []
            sm = f'{t} {m.get("name", "")}'.strip()
            if t == 'agent':
                x.add('agent-tool-loop')
            if (d.get('memory') or {}) and mode == 'advanced-chat':
                x.add('conversation-state')
        elif t == 'http-request':
            meth = str(d.get('method') or 'get').upper()
            eff = 'read' if meth == 'GET' else 'external'
            sm = f'http {meth}'
        elif t == 'trigger-plugin':
            conns = [kebab(str(d.get('provider_id') or d.get('plugin_id') or 'plugin').split('/')[-1])]
        elif t == 'iteration':
            if d.get('is_parallel'):
                sm = f'iteration parallel={d.get("parallel_nums")}'
        elif t == 'code':
            sm = f'code {d.get("code_language", "")}'
        es = d.get('error_strategy')
        if es:
            x.add('error-branch')
        if (d.get('retry_config') or {}).get('retry_enabled'):
            x.add('retry-policy')
        g.add(n['id'], t, cat, eff, sm, label=d.get('title'), **{'async': asy, 'connectors': conns, 'ext': x})
    for n in graph.get('nodes') or []:
        d = n.get('data') or {}
        par = n.get('parentId') or d.get('iteration_id') or d.get('loop_id')
        if par and d.get('type') in ('iteration-start', 'loop-start'):
            g.edge(par, n['id'], 'loop', 'body')
    for e in graph.get('edges') or []:
        h = e.get('sourceHandle') or 'source'
        kind = 'error' if h == 'fail-branch' else 'control'
        g.edge(e.get('source'), e.get('target'), kind, h)
    return g, ext


def dify_items(n_complex=27, n_rep=13):
    rows = []
    listing = {}
    for fn in sorted(glob.glob('/opt/corpus/dify/marketplace/list-*.json.gz')):
        for t in json.load(gzip.open(fn))['data']['templates']:
            listing[t['id']] = t
    skipped = collections.Counter()
    for fn in sorted(glob.glob('/opt/corpus/dify/marketplace/dsl/*.yaml.gz')):
        tid = os.path.basename(fn).split('.')[0]
        raw = gzip.open(fn).read()
        try:
            y = yaml.safe_load(raw)
        except Exception:
            skipped['yaml-error'] += 1
            continue
        mode = (y.get('app') or {}).get('mode')
        if mode not in ('workflow', 'advanced-chat'):
            skipped[mode] += 1
            continue
        meta = listing.get(tid, {})
        g, ext = dify_graph(y, False)
        rev = f'template {tid}; dsl version {y.get("version")}; updated {meta.get("updated_at")}; sha256:{sha(raw)[:16]}'
        base = base_item('dify', 'mkt-' + tid, f'https://marketplace.dify.ai/templates/{tid}', rev,
                         'ToS:https://marketplace.dify.ai/terms',
                         'marketplace.dify.ai/api/v1/templates has no per-template licence; publisher-submitted; marketplace terms apply (checked 2026-10-06)',
                         False, fn, meta.get('template_name') or (y.get('app') or {}).get('name') or tid)
        item = finalize(g, base, meta.get('categories') or [], ext, ORACLE_NONE, f'Dify app mode={mode}.', f'Dify marketplace {mode} app')
        rows.append((item, 'rep'))
    chosen = select(rows, n_complex, n_rep, 'dify-mkt')
    # repo built-in recommended apps (licensed, all workflow / advanced-chat apps)
    repo = glob.glob('/opt/corpus/dify/repo-*')[0]
    shaid = open(f'{repo}/SHA').read().strip()
    fn = f'{repo}/api__constants__recommended_apps.json'
    ra = json.load(open(fn))
    en = {a['app_id']: a for a in ra['recommended_apps']['en-US']['recommended_apps']}
    for aid, det in sorted(ra['app_details'].items()):
        y = yaml.safe_load(det['export_data'])
        mode = (y.get('app') or {}).get('mode')
        if mode not in ('workflow', 'advanced-chat'):
            skipped['repo-' + str(mode)] += 1
            continue
        g, ext = dify_graph(y, True)
        meta = en.get(aid, {})
        base = base_item('dify', 'repo-' + aid, f'https://github.com/langgenius/dify/blob/{shaid}/api/constants/recommended_apps.json',
                         f'langgenius/dify@{shaid} api/constants/recommended_apps.json app {aid}',
                         'LicenseRef-Dify-Open-Source-License', f'{repo}/LICENSE (modified Apache-2.0; extra conditions on multi-tenant hosting and frontend branding, not on redistribution)',
                         True, fn + f'#{aid}', (y.get('app') or {}).get('name') or aid,
                         (y.get('app') or {}).get('description') or meta.get('description'))
        item = finalize(g, base, meta.get('categories') or [], ext, ORACLE_NONE, f'Dify app mode={mode}.', f'Dify built-in {mode} app')
        chosen.append((item, 'all-licensed'))
    print('dify skipped modes', dict(skipped), file=sys.stderr)
    return chosen

# ----------------------------------------------------------------------------- Langflow

LF_CAT = [
    (r'^(ChatInput|TextInput|Webhook|File|Directory)$', 'trigger', 'none', []),
    (r'^(ChatOutput|TextOutput)$', 'action', 'write', []),
    (r'^(Agent|LanguageModelComponent|OpenAIModel|AnthropicModel|.*Model|StructuredOutput|LLMRouter|BatchRunComponent|Prompt.*|.*Embeddings.*)$', 'model', 'none', []),
    (r'^(ConditionalRouter|SmartRouter|DataConditionalRouter|If.*)$', 'condition', 'none', []),
    (r'^(LoopComponent|Loop)$', 'loop', 'none', []),
    (r'^(parser|ParserComponent|ParseData|SplitText|TypeConverter.*|Combine.*|Merge.*|DataFrame.*|CurrentDate|CalculatorComponent)$', 'transform', 'none', []),
    (r'^(MemoryBase|Memory|MessageHistory|StoreMessage)$', 'other', 'read', []),
    (r'^(PythonREPL.*|CustomComponent|PythonFunction.*|PythonCodeStructuredTool)$', 'code', 'none', []),
    (r'^(SaveToFile)$', 'action', 'write', []),
    (r'^(RunFlow|SubFlow|FlowTool)$', 'subworkflow', 'external', []),
]


def lf_classify(t):
    for pat, cat, eff, asy in LF_CAT:
        if re.match(pat, t or ''):
            return cat, eff, asy
    return 'action', 'read' if re.search(r'(Search|URL|Retriev|Knowledge|AstraDB|ArXiv|SQL|Wikipedia|News|RSS|Transcri|Fetch|API)', t or '') else 'external', []


def langflow_items():
    root = '/opt/corpus/langflow/repo'
    shaid = os.popen(f'git -C {root} rev-parse HEAD').read().strip()
    rows = []
    for fn in sorted(glob.glob(f'{root}/src/backend/base/langflow/initial_setup/starter_projects/*.json')):
        d = json.load(open(fn))
        g = Graph(True)
        ext = set()
        for n in (d.get('data') or {}).get('nodes') or []:
            nd = n.get('data') or {}
            t = nd.get('type')
            if n.get('type') == 'noteNode' or t in ('note', None):
                continue
            cat, eff, asy = lf_classify(t)
            node = nd.get('node') or {}
            x = set()
            conns = []
            tpl = node.get('template') or {}
            if t == 'Agent':
                x.add('agent-tool-loop?')
                prov = (tpl.get('agent_llm') or {}).get('value')
                if isinstance(prov, str) and prov:
                    conns.append(kebab(prov))
            if t in ('ChatInput',):
                x.add('chat-session')
                asy = ['webhook']
            if t in ('MemoryBase', 'Memory', 'MessageHistory'):
                x.add('conversation-state')
            if cat == 'action' and t not in ('ChatOutput', 'TextOutput', 'SaveToFile'):
                conns.append(kebab(re.sub(r'Component$', '', t)))
            g.add(n['id'], t, cat, eff, t, label=node.get('display_name'), **{'async': asy, 'connectors': conns, 'ext': x})
        for e in (d.get('data') or {}).get('edges') or []:
            sh = (e.get('data') or {}).get('sourceHandle') or {}
            th = (e.get('data') or {}).get('targetHandle') or {}
            kind = 'control' if th.get('fieldName') == 'tools' else 'data'
            g.edge(e.get('source'), e.get('target'), kind, sh.get('name') or 0, tool=(kind == 'control'))
        rel = os.path.relpath(fn, root)
        tags = d.get('tags') or []
        base = base_item('langflow', kebab(os.path.basename(fn)[:-5]), f'https://github.com/langflow-ai/langflow/blob/{shaid}/{rel}',
                         f'langflow-ai/langflow@{shaid} {rel}', 'MIT', f'{root}/LICENSE (MIT)', True, fn,
                         d.get('name') or os.path.basename(fn), d.get('description'))
        item = finalize(g, base, tags if isinstance(tags, list) else [], ext, ORACLE_NONE,
                        'Langflow edges are typed component data dependencies; agents with tool edges run a model-driven tool loop.',
                        'Langflow starter project')
        rows.append((item, 'all-licensed'))
    return rows

# ----------------------------------------------------------------------------- Flowise

FW_CAT = {
    'Chat Models': ('model', 'none'), 'LLMs': ('model', 'none'), 'Embeddings': ('model', 'none'), 'Chains': ('model', 'none'),
    'Agents': ('model', 'none'), 'Engine': ('model', 'none'), 'Response Synthesizer': ('model', 'none'),
    'Multi Agents': ('model', 'none'), 'Memory': ('other', 'read'), 'Vector Stores': ('action', 'read'),
    'Document Loaders': ('action', 'read'), 'Text Splitters': ('transform', 'none'), 'Prompts': ('transform', 'none'),
    'Output Parsers': ('transform', 'none'), 'Tools': ('action', 'external'), 'Moderation': ('model', 'none'),
    'Retrievers': ('action', 'read'), 'Record Manager': ('action', 'write'), 'Cache': ('other', 'none'),
}
FW_AF = {
    'startAgentflow': ('trigger', 'none'), 'llmAgentflow': ('model', 'none'), 'agentAgentflow': ('model', 'none'),
    'conditionAgentflow': ('condition', 'none'), 'conditionAgentAgentflow': ('condition', 'none'),
    'loopAgentflow': ('loop', 'none'), 'iterationAgentflow': ('loop', 'none'), 'humanInputAgentflow': ('human', 'none'),
    'toolAgentflow': ('action', 'external'), 'httpAgentflow': ('action', 'external'), 'retrieverAgentflow': ('action', 'read'),
    'customFunctionAgentflow': ('code', 'none'), 'directReplyAgentflow': ('action', 'write'),
    'executeFlowAgentflow': ('subworkflow', 'external'),
    'seqStart': ('trigger', 'none'), 'seqEnd': ('other', 'none'), 'seqAgent': ('model', 'none'), 'seqLLMNode': ('model', 'none'),
    'seqToolNode': ('action', 'external'), 'seqCondition': ('condition', 'none'), 'seqConditionAgent': ('condition', 'none'),
    'seqLoop': ('loop', 'none'), 'seqState': ('other', 'none'), 'seqCustomFunction': ('code', 'none'),
    'seqExecuteFlow': ('subworkflow', 'external'), 'supervisor': ('model', 'none'), 'worker': ('model', 'none'),
    'customFunction': ('code', 'none'), 'ifElseFunction': ('condition', 'none'),
}
FW_NONCONN = re.compile(r'^(stickyNote|bufferMemory|bufferWindowMemory|conversationSummaryMemory|agentMemory|memoryVectorStore|promptTemplate|chatPromptTemplate|fewShotPromptTemplate|.*TextSplitter|.*OutputParser|llmChain|conversationChain|.*Chain|.*Agent|toolAgent|customTool|calculator|retrieverTool|chainTool|readFile|writeFile|requestsGet|requestsPost|customFunction|ifElseFunction|textFile|plainText|documentStore|queryEngine.*|.*Engine|compactrefine.*|refine.*|simpleChatEngine|inputModeration.*|seq.*|supervisor|worker|.*Agentflow)$')


def flowise_items():
    root = '/opt/corpus/flowise/repo'
    shaid = os.popen(f'git -C {root} rev-parse HEAD').read().strip()
    rows = []
    for sub in ('agentflowsv2', 'agentflows', 'chatflows'):
        for fn in sorted(glob.glob(f'{root}/packages/server/marketplaces/{sub}/*.json')):
            d = json.load(open(fn))
            g = Graph(True)
            ext = set()
            label2id = {}
            for n in d.get('nodes') or []:
                nd = n.get('data') or {}
                name = nd.get('name') or ''
                if name in ('stickyNote', 'stickyNoteAgentflow'):
                    continue
                if name in FW_AF:
                    cat, eff = FW_AF[name]
                else:
                    cat, eff = FW_CAT.get(nd.get('category'), ('action', 'external'))
                    if name in ('customFunction',):
                        cat, eff = 'code', 'none'
                    if name == 'ifElseFunction':
                        cat, eff = 'condition', 'none'
                x = set()
                asy = []
                if cat == 'trigger':
                    x.add('chat-session')
                    asy = ['webhook']
                if name in ('csvAgent', 'openAIAssistant') or (name == 'agentAgentflow' and (nd.get('inputs') or {}).get('agentTools')):
                    x.add('agent-tool-loop')
                elif name in ('agentAgentflow', 'seqAgent', 'toolAgent', 'conversationalAgent', 'reactAgentChat', 'worker', 'supervisor'):
                    x.add('agent-tool-loop?')
                if nd.get('category') == 'Memory' or name in ('agentMemory',):
                    x.add('conversation-state')
                if name == 'humanInputAgentflow':
                    asy = ['wait']
                conns = []
                if not FW_NONCONN.match(name):
                    conns = [kebab(re.sub(r'(_LlamaIndex|_LLMs|Embeddings?|VectorStore|Chat|LlamaIndex)$', '', name)) or kebab(name)]
                if name.startswith('chat') and nd.get('category') == 'Chat Models':
                    conns = [kebab(name[4:])]
                g.add(n['id'], name, cat, eff, nd.get('type') or name, label=nd.get('label'), **{'async': asy, 'connectors': conns, 'ext': x})
                label2id[nd.get('label')] = n['id']
                lbl = (nd.get('inputs') or {}).get('seqAgentName') or (nd.get('inputs') or {}).get('llmNodeName')
                if lbl:
                    label2id[lbl] = n['id']
            for e in d.get('edges') or []:
                sh = e.get('sourceHandle') or ''
                m = re.search(r'-output-(\d+)$', sh)
                port = int(m.group(1)) if m else sh.split('-output-')[-1][:40]
                th = e.get('targetHandle') or ''
                kind = 'control' if sub != 'chatflows' and e.get('type') == 'agentFlow' else 'data'
                if sub != 'chatflows' and ('seq' in e.get('source', '') or 'seq' in e.get('target', '')):
                    kind = 'control'
                is_tool = bool(re.search(r'-input-tools-', th))
                if is_tool:
                    kind = 'control'
                g.edge(e.get('source'), e.get('target'), kind, port, tool=is_tool)
            for n in d.get('nodes') or []:
                nd = n.get('data') or {}
                ins = nd.get('inputs') or {}
                if nd.get('name') == 'loopAgentflow' and ins.get('loopBackToNode'):
                    g.edge(n['id'], str(ins['loopBackToNode']).split('-')[0], 'loop', 'loop')
                if nd.get('name') == 'seqLoop' and ins.get('loopToName') in label2id:
                    g.edge(n['id'], label2id[ins['loopToName']], 'loop', 'loop')
                if n.get('parentNode'):
                    g.edge(n['parentNode'], n['id'], 'loop', 'body')
            rel = os.path.relpath(fn, root)
            uc = d.get('usecases') or []
            base = base_item('flowise', kebab(sub + '-' + os.path.basename(fn)[:-5]), f'https://github.com/FlowiseAI/Flowise/blob/{shaid}/{rel}',
                             f'FlowiseAI/Flowise@{shaid} {rel}', 'Apache-2.0',
                             f'{root}/LICENSE.md (Apache-2.0 outside packages/server/src/enterprise; marketplaces/ is outside it)',
                             True, fn, os.path.basename(fn)[:-5], d.get('description'))
            kind_note = {'chatflows': 'Flowise v1 chatflow: edges are LangChain/LlamaIndex component composition (dependency injection), not control flow.',
                         'agentflows': 'Flowise v1 agentflow (sequential/multi-agent LangGraph style).',
                         'agentflowsv2': 'Flowise AgentflowV2: explicit control-flow graph.'}[sub]
            item = finalize(g, base, uc, ext, ORACLE_NONE, kind_note, f'Flowise {sub} marketplace template')
            rows.append((item, 'all-licensed'))
    return rows

# ----------------------------------------------------------------------------- Coze Studio fixtures

COZE = {'1': ('Entry', 'trigger', 'none'), '2': ('Exit', 'other', 'none'), '3': ('LLM', 'model', 'none'),
        '4': ('Plugin', 'action', 'external'), '5': ('CodeRunner', 'code', 'none'), '6': ('KnowledgeRetriever', 'action', 'read'),
        '8': ('Selector', 'condition', 'none'), '9': ('SubWorkflow', 'subworkflow', 'external'),
        '12': ('DatabaseCustomSQL', 'action', 'external'), '13': ('OutputEmitter', 'action', 'write'),
        '15': ('TextProcessor', 'transform', 'none'), '18': ('QuestionAnswer', 'human', 'none'), '19': ('Break', 'other', 'none'),
        '20': ('VariableAssignerWithinLoop', 'transform', 'none'), '21': ('Loop', 'loop', 'none'),
        '22': ('IntentDetector', 'model', 'none'), '27': ('KnowledgeIndexer', 'action', 'write'), '28': ('Batch', 'loop', 'none'),
        '29': ('Continue', 'other', 'none'), '30': ('InputReceiver', 'human', 'none'), '31': ('Comment', None, None),
        '32': ('VariableAggregator', 'merge', 'none'), '37': ('MessageList', 'action', 'read'),
        '38': ('ClearConversationHistory', 'action', 'write'), '39': ('CreateConversation', 'action', 'write'),
        '40': ('VariableAssigner', 'transform', 'none'), '42': ('DatabaseUpdate', 'action', 'write'),
        '43': ('DatabaseQuery', 'action', 'read'), '44': ('DatabaseDelete', 'action', 'write'), '45': ('HTTPRequester', 'action', 'external'),
        '46': ('DatabaseInsert', 'action', 'write'), '51': ('ConversationUpdate', 'action', 'write'), '52': ('ConversationDelete', 'action', 'write'),
        '53': ('ConversationList', 'action', 'read'), '54': ('ConversationHistory', 'action', 'read'), '55': ('CreateMessage', 'action', 'write'),
        '56': ('EditMessage', 'action', 'write'), '57': ('DeleteMessage', 'action', 'write'), '58': ('JsonSerialization', 'transform', 'none'),
        '59': ('JsonDeserialization', 'transform', 'none'), '60': ('KnowledgeDeleter', 'action', 'write'), '1000': ('Lambda', 'code', 'none')}


def coze_items(n=22):
    root = '/opt/corpus/coze/repo'
    shaid = os.popen(f'git -C {root} rev-parse HEAD').read().strip()
    rows = []
    for fn in sorted(glob.glob(f'{root}/backend/domain/workflow/internal/canvas/examples/**/*.json', recursive=True)):
        rel = os.path.relpath(fn, root)
        if '/validate/' in rel or '/get_canvas/' in rel:
            continue
        try:
            d = json.load(open(fn))
        except Exception:
            continue
        if not isinstance(d, dict) or 'nodes' not in d:
            continue
        g = Graph(True)
        ext = set()

        def walk(nodes, edges, parent=None):
            for nd in nodes or []:
                t = str(nd.get('type'))
                key, cat, eff = COZE.get(t, (f'type{t}', 'action', 'external'))
                if cat is None:
                    continue
                data = nd.get('data') or {}
                x = set()
                asy = []
                if cat == 'human':
                    asy = ['wait']
                inp = data.get('inputs') or {}
                if isinstance(inp, dict):
                    if (inp.get('settingOnError') or {}).get('switch') or (inp.get('settingOnError') or {}).get('processType') in (2, 3):
                        x.add('error-branch')
                title = ((data.get('nodeMeta') or {}).get('title'))
                g.add(str(nd.get('id')), f'{t}:{key}', cat, eff, key, label=title, **{'async': asy, 'connectors': [], 'ext': x})
                if nd.get('blocks'):
                    walk(nd['blocks'], nd.get('edges') or [], str(nd.get('id')))
            for e in edges or []:
                sp = str(e.get('sourcePortID') or '')
                kind = 'error' if 'exception' in sp or 'error' in sp else 'control'
                g.edge(str(e.get('sourceNodeID')), str(e.get('targetNodeID')), kind, sp or 0)
        walk(d.get('nodes'), d.get('edges'))
        base = base_item('coze', kebab(rel.split('examples/')[-1][:-5]), f'https://github.com/coze-dev/coze-studio/blob/{shaid}/{rel}',
                         f'coze-dev/coze-studio@{shaid} {rel}', 'Apache-2.0', f'{root}/LICENSE-APACHE', True, fn,
                         'Coze Studio canvas fixture: ' + rel.split('examples/')[-1][:-5])
        oracle = {'kind': 'test-profile', 'notes': 'Canvas fixture consumed by coze-studio Go tests (backend/domain/workflow/...); expected behaviour lives in *_test.go (not acquired).'}
        item = finalize(g, base, ['test-fixture'], ext, oracle, 'Upstream test fixture, not a user workflow: development evidence of platform semantics (interrupts, batch, exception branches).',
                        'Coze Studio workflow canvas test fixture')
        rows.append((item, 'all-licensed'))
    rows.sort(key=lambda r: (-complexity(r[0]), r[0]['id']))
    return [(it, 'complex') for it, _ in rows[:n]]

# ----------------------------------------------------------------------------- Zapier

ZAP_BUILTIN = {'Engine', 'Filter', 'Branching', 'ZapierFormatter', 'Code', 'Delay', 'SubZap', 'ZapierLooping', 'Schedule',
               'WebHook', 'Digest', 'Path'}


def zap_app(app):
    a = re.sub(r'(CLIAPI|API)(@.*)?$', '', app or '')
    a = re.sub(r'V\d+$', '', a)
    return a


def zapier_items(n_complex=17, n_rep=8):
    spec = __import__('importlib.util').util.spec_from_file_location('fz', f'{HERE}/automation-fetch-zapier.py')
    fz = __import__('importlib.util').util.module_from_spec(spec)
    spec.loader.exec_module(fz)
    sample = json.load(open('/opt/corpus/zapier/sample.json'))['sample']
    url_of = {hashlib.sha1(u.encode()).hexdigest()[:16]: u for u in sample}
    rows = []
    for fn in sorted(glob.glob('/opt/corpus/zapier/pages/*.html.gz')):
        h = gzip.open(fn).read().decode('utf-8', 'replace')
        try:
            z, _ = fz.extract_zsl(h)
        except Exception:
            z = None
        if not z:
            continue
        key = os.path.basename(fn).split('.')[0]
        url = url_of.get(key, '')
        g = Graph(False)
        ext = set()
        state = {'first': True}
        refs = []

        def leaf(s, preds, kind):
            app = s.get('app') or ''
            a = zap_app(app)
            ty = s.get('type')
            act = s.get('action') or ''
            asy = []
            x = set()
            if state['first'] and ty == 'read':
                cat, eff = 'trigger', 'read'
                asy = ['webhook'] if a == 'WebHook' else ['schedule'] if a == 'Schedule' else ['event']
                if a in ('WebHook', 'Schedule'):
                    eff = 'none'
            elif a in ('Filter', 'Branching') or ty == 'filter':
                cat, eff = 'condition', 'none'
            elif a == 'ZapierFormatter':
                cat, eff = 'transform', 'none'
            elif a == 'Code':
                cat, eff = 'code', 'none'
            elif a == 'Delay':
                cat, eff = 'wait', 'none'
                asy = ['wait']
            elif a == 'SubZap':
                cat, eff = ('subworkflow', 'external') if 'call' in act or ty != 'read' else ('trigger', 'none')
            elif a == 'ZapierLooping':
                cat, eff = 'loop', 'none'
                x.add('dynamic-fan-out')
            elif re.search(r'(ChatGPT|^AI$|Anthropic|Claude|Gemini|OpenAI|Perplexity|Mistral|Agents?$|Copilot)', a):
                cat, eff = 'model', 'none'
            elif re.search(r'(HumanInTheLoop|Approval)', a):
                cat, eff = 'human', 'none'
                asy = ['wait']
            elif a == 'Digest':
                cat, eff = 'merge', 'write'
            elif a in ('Storage', 'Table'):
                x.add('external-state-store')
                cat, eff = 'action', 'read' if ty in ('search', 'read') else 'write'
            else:
                cat = 'action'
                eff = 'read' if ty in ('read', 'search') else 'write' if ty in ('write', 'search_or_write') else 'external'
            state['first'] = False
            conn = [] if a in ZAP_BUILTIN or cat in ('condition', 'transform', 'code', 'wait', 'loop') else [kebab(a)]
            g.add(s['id'], app.split('@')[0], cat, eff, f'{a}.{ty}:{act}', **{'async': asy, 'connectors': conn, 'ext': x})
            for p in preds:
                g.edge(p, s['id'], kind)
            for m in sorted(set(re.findall(r'\{\{\s*(_GEN_\d+)__', json.dumps(s.get('params') or {})))):
                refs.append((m, s['id']))
            return [s['id']]

        def build(s, preds, kind='control'):
            if s.get('app') == 'EngineAPI':
                act = s.get('action')
                ch = s.get('steps') or []
                if act == 'parallel_paths':
                    g.add(s['id'], 'EngineAPI:parallel_paths', 'condition', 'none', f'split into {len(ch)} paths', **{'async': [], 'connectors': [], 'ext': set()})
                    for p in preds:
                        g.edge(p, s['id'], kind)
                    outs = []
                    for i, c in enumerate(ch):
                        before = len(g.edges)
                        outs += build(c, [s['id']])
                        for ed in g.edges[before:before + 1]:
                            ed['_port'] = i
                    return outs
                if act == 'error_wrapper':
                    tr = [c for c in ch if c.get('action') == 'error_try']
                    hd = [c for c in ch if c.get('action') == 'error_handler']
                    n0 = len(g.nodes)
                    outs = build(tr[0], preds, kind) if tr else preds
                    try_ids = [n['id'] for n in g.nodes[n0:]]
                    if hd:
                        hn0 = len(g.nodes)
                        h_outs = build(hd[0], [], 'error')
                        if len(g.nodes) > hn0:
                            first = g.nodes[hn0]['id']
                            for tid in try_ids:
                                g.edge(tid, first, 'error')
                        outs = outs + h_outs
                    return outs
                cur = preds
                for i, c in enumerate(ch):
                    cur = build(c, cur, kind if i == 0 else 'control')
                return cur
            return leaf(s, preds, kind)

        for zp in z.get('zaps') or []:
            state['first'] = True
            build(zp.get('zdl') or {}, [])
        for src, dst in refs:
            if src in g.by_key and dst in g.by_key and not g.has_edge(src, dst):
                g.edge(src, dst, 'data')
        extra = sum(1 for k in ('agents', 'tables', 'interfaces', 'chatbots', 'canvases') if z.get(k))
        raw = gzip.open(fn).read()
        slug = url.rstrip('/').split('/')[-1]
        tid = slug.split('-')[-1] if slug else key
        base = base_item('zapier', tid, url, f'template page {slug}; sha256:{sha(raw)[:16]}',
                         'ToS:https://zapier.com/legal/terms-of-service',
                         'Public template page; no licence granted; robots.txt (2026-10-06) allows Claude-User and declares Content-Signal ai-train=yes, ai-input=yes',
                         False, fn, z.get('name') or slug)
        note = 'Zapier ZDL (embedded ZSL); steps are sequential with Paths/error_wrapper containers; params marked $$$$GUESS$$$ are unfilled template slots. '
        if extra:
            note += 'Template also bundles Zapier tables/interfaces/agents. '
        item = finalize(g, base, [], ext, ORACLE_NONE, note, 'Zapier public template')
        rows.append((item, 'rep'))
    return select(rows, n_complex, n_rep, 'zapier')

# ----------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'parts', 'automation.jsonl'))
    ap.add_argument('--strata', default='/opt/corpus/automation-misc/strata.json')
    a = ap.parse_args()
    groups = {
        'n8n': n8n_items(), 'node-red': nodered_items(), 'activepieces': activepieces_items(),
        'dify': dify_items(), 'langflow': langflow_items(), 'flowise': flowise_items(), 'coze': coze_items(),
        'zapier': zapier_items(),
    }
    items, strata = [], collections.defaultdict(list)
    for gname, rows in groups.items():
        for it, st in rows:
            items.append(it)
            strata[st].append(it['id'])
    seen = set()
    with open(a.out, 'w') as f:
        for it in items:
            if it['id'] in seen:
                continue
            seen.add(it['id'])
            f.write(json.dumps(it, ensure_ascii=False, sort_keys=False) + '\n')
    json.dump({k: sorted(v) for k, v in strata.items()}, open(a.strata, 'w'), indent=1)
    c = collections.Counter(i['source']['platform'] for i in items)
    print(json.dumps({'items': len(seen), 'byPlatform': c}, indent=1))


if __name__ == '__main__':
    main()
