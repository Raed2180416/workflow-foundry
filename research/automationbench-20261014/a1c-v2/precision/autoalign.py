import json, re
EM=re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
def norm(s): return re.sub(r'\s+',' ',str(s).lower().replace('’',"'")).strip()
APPMAP={'gmail':'gmail','slack':'slack','salesforce':'salesforce','google':'google','intercom':'intercom','helpcrunch':'helpcrunch','zoho':'zoho_desk','jira':'jira','asana':'asana','monday':'monday','reamaze':'reamaze','freshdesk':'freshdesk','docusign':'docusign','zoom':'zoom','linkedin':'linkedin','chatgpt':'chatgpt','hubspot':'hubspot','gorgias':'gorgias','twilio':'twilio','trello':'trello','notion':'notion','confluence':'confluence','airtable':'airtable','calendly':'calendly'}
def a_app(x):
    t=x['type']
    if t.startswith('google_sheets'): return 'google_sheets'
    if t.startswith('google_calendar'): return 'google_calendar'
    return APPMAP.get(t.split('_')[0], t.split('_')[0])
def a_lits(x):
    P=x['params']; L=[]
    for k in ('body_contains','text_contains','subject_contains','subject','value','cell_contains','summary_contains','summary','tag','status','name_contains','prompt_contains','content_contains','name','priority','company','body_not_contains','phone','event_name'):
        v=P.get(k)
        if isinstance(v,str): L.append(v)
        elif isinstance(v,list): L+= [str(i) for i in v]
    if isinstance(P.get('cells'),dict): L+=[str(v) for v in P['cells'].values()]
    if isinstance(P.get('params'),dict): L+=[str(v) for v in P['params'].values() if isinstance(v,(str,int,float))]
    return L
def a_ents(x):
    s=json.dumps(x['params']).lower()
    E=set(EM.findall(s))
    for k in ('record_id','contact_id','conversation_id','ticket_id','parent_id','message_id','row_id','spreadsheet_id','channel','channel_name','channel_id','company_id','user_id','customer_id'):
        v=x['params'].get(k)
        if isinstance(v,str): E.add(v.lower().lstrip('#'))
    return E
def p_ents(p):
    P=p['params']; E=set()
    s=json.dumps(P).lower()
    E|=set(EM.findall(s))
    if 'ptr' in P:
        parts=P['ptr'].split(':'); E.add(parts[-1].lower()); E|={q.lower() for q in re.split(r'[/#]',parts[-1])}
    if 'channel' in P and isinstance(P['channel'],dict):
        for v in P['channel'].values():
            if v: E.add(str(v).lower())
    if P.get('spreadsheetId'): E.add(P['spreadsheetId'].lower())
    return E
def p_lits(p):
    P=p['params']; L=[]
    for k in ('subject','body','text','values'):
        if isinstance(P.get(k),list): L+= [str(v) for v in P[k]]
    if 'value' in P: L.append(str(P['value']))
    return L
COMPAT={'gmail_sent':('gmail',),'gmail_not_sent':('gmail',),'slack_posted':('slack',),'slack_not_posted':('slack',),'sheet_row':('google_sheets',)}
def score(p,x):
    aa=a_app(x); pt=p['type']
    if pt in COMPAT and aa not in COMPAT[pt]: return 0,''
    if pt in ('record_field','record_deleted'):
        app=p['params']['ptr'].split(':')[0]
        if app!=aa and not (app=='google_sheets' and aa=='google_sheets'): return 0,''
    if pt=='record_created' and p['params'].get('app')!=aa: return 0,''
    if pt=='judged' and p.get('app') and p['app']!=aa: return 0,''
    neg_a = '_not_' in x['type'] or x['type'].endswith('_not_exists')
    if pt in ('gmail_not_sent','slack_not_posted') and not neg_a: return 0,''
    pe=p_ents(p); ae=a_ents(x)
    ent = bool(pe & ae)
    al=[norm(v) for v in a_lits(x)]; pl=[norm(v) for v in p_lits(p)]
    lit = any(a and any(a in q or q in a for q in pl if q) for a in al) if al else None
    if pt=='judged':
        st=norm(p['statement'])
        lit = any(a and a in st for a in al) if al else None
        ent = ent or any(e in st for e in ae if len(e)>3)
    sc = (2 if ent else 0) + (1 if lit else 0)
    if not ent and pt in ('record_created','judged') and lit: sc=1
    return sc, ('E' if ent else '')+('L' if lit else ('l' if lit is False else ''))
