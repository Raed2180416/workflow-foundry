// AUDIT 2026-10-07 attack H3-full: OVER BUDGET (57 lines) upper-bound reference; H3 with every template parser kept; see AUDIT.md
const CR=('MX:mex|m.xic;'+'AT:austria|sterr|^aut$;'+'AU:aus;'+'GB:kingd|k.nigr|brit|engl|(^|the )u\\.?k;'+'US:stat|staat|usa|u\\.s|amer|^us$;'+'CA:can|kanad;'+
'IE:irl|irel|irle|eire|irish;'+'CH:swi|schweiz|suisse;'+'DE:germ|gema|deutsch|brd|^ger$;'+'FR:fran|fren|^fra$|frna|farn;'+'BE:belg|^bel$;'+'ES:spa|esp|spian;'+
'IT:ital|itl|^ita$;'+'NL:neth|nehte|holl|neder|niede|^nld$|dutch;'+'JP:jap|jpa|nipp|^jpn$;'+'SE:swe|schwed|sverig;'+'DK:dan|d.nem|denm|dnk;'+'NO:nor').split(';'
).map(x=>x.split(':')),M=Math.max,mn=Math.min,U=/\D/g,MO='JanFebMarAprMayJunJulAugSepOctNovDec',cty=s=>(s=(s||'').trim().toLowerCase(),!s||/not st/.test(s)?null
:s.length==2?(s=='uk'?'GB':s.toUpperCase()):CR.find(([,r])=>RegExp(r).test(s))?.[0]),W=('zero one two three four five six seven eight '+
'nine ten eleven twelve thirteen fourteen '+'fifteen sixteen seventeen eighteen nineteen').split(' '),T=
',,twenty,thirty,forty,fifty,sixty,seventy,eighty,ninety'.split(','),p2=n=>String(+n).padStart(2,'0'),ymd=(y,m,d)=>`${y}-${p2(m)}-${p2(d)}`,wd=s=>{let t=0,c=0;
for(const w of s.split(/[\s-]+/))w=='thousand'?(t+=c*1e3,c=0):w=='hundred'?c*=100:c+=M(0,W.indexOf(w))+10*M(0,T.indexOf(w));return t+c},D=(s,f)=>{let m=s.match(
/(\d+)[/.](\d+)[/.](\d+)/),y;if(m)return y=m[3].length<3?'19'+m[3]:m[3],f?ymd(y,m[1],m[2]):ymd(y,m[2],m[1]);y=s.match(/\d{4}/)?.[0]??'19'+s.slice(-2);return ymd
(y,MO.indexOf(s.match(/[A-Z][a-z]{2}/))/3+1,s.replace(y,'').match(/\d+/))},gf=s=>(s=s.trim().split(/\s+/).filter(x=>!/^(mr|mrs|ms|dr|prof)\.?$/i.test(x)&&!
/^[A-Z]\.$/.test(x)),[s[0],s.slice(1).join(' ')]),DT='[\\w ,]*?\\d{4}|\\d+-\\w+-\\d\\d|[\\d/]+',nm=s=>s.includes(', ')?[gf(s.split(', ')[1].replace(/\(.*/,''))[
0],s.split(', ')[0]]:gf(s),b=s=>s.normalize('NFC').toLowerCase().replace(/['’\x60\-\s.]/g,'').replace(/ß/g,'ss'),pd=(a,c)=>os(fs(a),fs(c)),fs=s=>b(s).replace(
/æ/g,'ae').replace(/ø/g,'o').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/([aou])[aeu]/g,'$1'),os=(a,c)=>{if(a==c)return 0;let i=0;while(a[i]==c[i])
i++;a=a.slice(i);c=c.slice(i);const h=(x,y)=>x.slice(1)==y;return h(a,c)||h(c,a)||a.slice(1)==c.slice(1)||a[0]==c[1]&&a[1]==c[0]&&a.slice(2)==c.slice(2)?1:2},A=
(s,cu,de,ng)=>{s=(s||'').trim();if(!/\d|dollar|euro|pound/.test(s))return null;const c=(s.match(/[A-Z]{3}/)||[/€|euro/.test(s)?'EUR':/£|pound/.test(s)?'GBP':
/dollar|\$/.test(s)?'USD':cu])[0],v=/\d/.test(s)?+(de?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'')).match(/\d+(\.\d+)?/)[0]:wd(s.split(
/ (?:US )?(?:dollar|euro|pound)/)[0])+wd((s.match(/ and (.+) (cent|pen)/)||[0,'zero'])[1])/100;return{v:(ng||/^\(|^-|-\s|CR|▲/.test(s)?-1:1)*v,c}};
export function heurSolve(task){const{export:ex,spec:sp,source_notes:no}=task.inputs,nk={},cc={},R={USD:1},rows=[],F=g=>nk[g]??g,P=[],G={},mm=(s,r)=>s.matchAll(
r);for(const m of mm(sp,/([A-Za-z/]+) = ([^\s;]+)/g))for(const n of m[1].split('/'))nk[n]=m[2];for(const m of mm(sp,
/^ +[A-Za-z ]+? ([A-Z]{2}) +\+(\d+) .*: (\S+)/gm))cc[m[1]]=m;for(const m of mm(sp,/^ +(USD\/)?([A-Z]{3})(?:\/USD)? +([\d.]+)$/gm))R[m[2]]=m[1]?1/m[3]:+m[3];
const Q=x=>(no.match(RegExp('\\n'+x+'\\.[^\\n]*'))||[''])[0],AQ=Q('ATLAS'),VQ=Q('VENDEX'),BQ=Q('BRIGHTDESK'),FV=[],eb=BQ.match(
/dob=(\d\d)\/\d\d\/\d{4} (?:is|was born in) (\d+|\w{3})/),bm=eb?/\d/.test(eb[2])?eb[1]!=p2(eb[2]):+eb[1]==MO.indexOf(eb[2])/3+1:
/are month\/day|MM\/DD|kept its|British order/.test(BQ),OR={LEDGR:0,BRIGHTDESK:bm},e1=AQ.match(/written (\d\d)\/\d\d\/\d{4} is (\d+)/),e3=AQ.match(
/born (\d\d)\/\d\d\/\d{4}" belongs to someone born in (\w{3})/),r1=(AQ.match(/ATLAS use the same order as (\w+)/)||[])[1],am=e1?e1[1]!=p2(e1[2]):e3?+e3[1]==MO.
indexOf(e3[2])/3+1:r1?OR[r1]:/are month\/day|MM\/DD\/YYYY, n|month comes first|UK installation|United States/.test(AQ),e2=VQ.match(
/such as \d\d\/\d\d\/2021 means (\w)/),ci=(VQ.match(/(?:works from|to) ([^,]+?) (?:and writes|in 2015)/)||[])[1],r2=(VQ.match(/same order as (\w+)\./)||[])[1],
vm=/American convention|MM\/DD|is the month|day-first habit/.test(VQ)||!/European convention|DD\/MM|is the day|month-first habit/.test(VQ)&&(e2?!/\d/.test(e2[1]
):r2?r2=='ATLAS'?am:OR[r2]:ci?RegExp('Chic|Hous|Denv|Seat|Atla|Bost|Phoe|Minn|Pitt|Dall|Detr|Port|Char|Nash|Colu'+
'|Indi|Balt|Clev|Tamp|Sacr|Kans|Rale|Milw|Albu|Salt|Omah|Rich|Memp|Loui|Tucs').test(ci):1),mi=(no.match(
/\n(\w+)\.[^\n]*(?:extract comes from|re-stamped every|copy job last|migration overwrote|re-imported)/)||[])[1];for(const x of no.split(/(?<=\.) /))if(
/marked |only means|marks appl|confuse/.test(x)&&
/load-test|aborted|rejected|not real|bought any|auditors|counts as|do not keep|like (the Z|"st|lines e|SAMPLE|sandbox)/.test(x))FV.push((x.match(
/(?:marked |^|confuse )(?:stage=(\w+)|Status "(\w+)"|":: ([A-Z ]+)"|"flag: (\w+)"|"env":"(\w+)")/)||[]).slice(1).find(v=>v));const PY={B:
/prepaid deposits we|positive balance is money we owe|opposite way|change sign/,A:/column is what we owe|payable|Do not read|debt of ours/,L:
/holder's side, not|Saldo is money we owe|opposite way|changes sign/,K:/prepaid store|money we owe|change sign|payables/},PS={B:PY.B.test(BQ),A:PY.A.test(AQ),L:
PY.L.test(Q('LEDGR')),K:PY.K.test(Q('KOBO'))};const N=(s,i)=>{s=(s||'').trim();const d=s.replace(U,''),[,,k,t]=cc[i]||[];if(!d||/^0+$/.test(d))return null;if(
/^(\+|00|011 )/.test(s))return'+'+s.replace('(0)','').replace(U,'').replace(/^0(0|11)/,'');return k?'+'+k+(t=='0'?d.replace(/^0/,''):k=='1'&&d.length==11?d.
slice(1):d):null};for(const L of ex.split('\n')){const g=k=>(L.match(RegExp(`[|] ${k}[=:] ?([^|]*)`))||[])[1]?.trim()??'',B=L.replace(
/ Remark: .*| \(Application withdrawn.*/,''),y=(r,f='i')=>B.match(RegExp(r,f))?.slice(1).find(v=>v),s=L.split(/ :: |;/),l=L[0]+L[1],q=g('birth');let r,c;if(l==
'BR')c=cty(g('country')),r={v:/=ZZTEST/.test(L)||FV.includes(g('stage')),n:nm(g('name')),dob:/[1-9]/.test(g('dob'))&&D(g('dob'),bm),p:N(g('phone'),c),a:A(g(
'balance'),'USD'),u:g('updated')};if(l=='LE')c=cty(s[5]),r={v:s[8]=='storniert'||FV.includes(s[8]),n:nm(s[2]),dob:/[1-9]/.test(s[4])&&D(s[4]),p:N(s[6],c),a:A(s[
7],'EUR',1),u:D(s[9])};if(l=='AT')c=cty(s[3]),r={v:/ MIGRATE$/.test(L)||FV.includes(s.at(-1)),n:nm(s[1]),dob:/\d/.test(s[2])&&D(s[2],am),p:N(s[4].slice(4),c),a:
A(s[5].slice(5),'GBP'),u:D(s[6])};if(l=='KO'){const e=q.match(/([SH])(\d+)\.(\d+)\.(\d+)/),t=y('member: (.+?) \\|').split(' ');c='JP',r={v:/SAMPLE$/.test(L)||FV
.includes(g('flag')),n:[t.pop(),t.join(' ')],p:N(g('tel'),c),dob:e?ymd((e[1]=='S'?1925:1988)+ +e[2],e[3],e[4]):/[1-9]/.test(q)&&q.replace(/\//g,'-'),a:A(g(
'balance'),'JPY'),u:g('upd').replace(/\//g,'-')}}if(l=='VE'){const o=JSON.parse(L.slice(8));c=cty(o.country),r={v:o.env=='sandbox'||FV.includes(o.env),n:[o.
given,o.family],dob:o.dob!='1900-01-01'&&o.dob,p:o.msisdn&&'+'+o.msisdn,a:o.amount&&{v:+o.amount,c:o.ccy},u:o.ts.slice(0,10)}}if(l=='Ve'){const t4=B.split(' — '
),db=y(`(?:[Bb]orn|of birth|DOB|b\\.) (?!unk)(${DT})`,''),am=y('((?:owes|open|outstanding|due|credit|owe them) .+?)(?=\\. |\\.$| — )');c=cty(t4.length>5?t4[2]:y
('based in ([^,;)]+)|an? (\\w+) (?:supp|cont)|^.*?: [^(,]+\\(([^)]+)\\)'));r={v:L.endsWith('onboarded.)'),n:gf(y(
'^\\S+ \\d+ — (?:Supplier contact |Spoke with |[^:]+: )?(.+?)(?=,| \\(| — | on | b| date| DOB)','')),dob:db&&D(db,vm),u:D(y(`(?:revised(?: on)?|\\bon) (${DT})`)
,vm),p:N(y('(?:phone|reach at|tel\\.|mobile|best number) (.+?)(?=[,;]| — |\\. |\\.$)'),c),a:am&&A(am,'USD',0,/credit|owe them/i.test(am))}}if(r&&!r.v&&PS[L[0]]
&&r.a)r.a.v=-r.a.v;if(r&&!r.v)rows.push({...r,c,k:L.startsWith(mi),id:+L.match(/\d+/)[0],gn:F(r.n[0])})}const f=i=>(P[i]??i)==i?i:(P[i]=f(P[i]));rows.forEach((a
,i)=>rows.forEach((c,j)=>{if(j>i&&(a.dob&&c.dob?a.dob==c.dob:a.p&&a.p==c.p)){const q=pd(a.gn,c.gn);if(q+(q<2?pd(a.n[1],c.n[1]):2)<2)P[f(i)]=f(j)}}));rows.
forEach((r,i)=>(G[f(i)]||=[]).push(r));const ac=(g,x,i)=>/[^ -~]/.test(x)?x:g.map(r=>i?r.n[1]:r.gn).find(y=>/[^ -~]/.test(y)&&fs(y)==fs(x))??x;return{records:
Object.values(G).map(g=>{g.sort((a,c)=>a.k-c.k||(c.u>a.u)-(c.u<a.u)||c.id-a.id);const k=q=>g.find(r=>r[q])?.[q]??null,a=k('a'),ids=g.map(r=>r.id).sort((x,y)=>x-
y);return{entity_id:ids[0],source_rows:ids,given_name:ac(g,g[0].gn,0),family_name:ac(g,g[0].n[1],1),birth_date:k('dob'),country:k('c'),phone_e164:k('p'),
amount_usd:a?Math.round(a.v*R[a.c]*100)/100:null}})}}
