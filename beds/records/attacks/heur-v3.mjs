// AUDIT 2026-10-07 attack H3 (records v3.0.0): <=40 lines x <=160 chars, white-box regex heuristics on task.inputs only; see AUDIT.md
const CR=('MX:mex;'+'AT:tria|ster|aut;'+'AU:aus;'+'GB:king|brit|engl|uk;'+'US:sta|usa|u\\.s|amer|^us$;'+'CA:can|kan;'+'IE:ir|eire;'+'CH:swi|schweiz|sui;'+
'DE:ger|deu|brd;'+'FR:fr|farn;'+'BE:bel;'+'ES:sp|esp;'+'IT:it;'+'NL:ne|hol|nie|nld;'+'JP:jap|nip|jpn;'+'SE:swe|schwed;'+'DK:dan|den|dnk;'+'NO:nor').split(';').
map(x=>x.split(':')),M=Math.max,mn=Math.min,U=/\D/g,MO='JanFebMarAprMayJunJulAugSepOctNovDec',cty=s=>(s=(s||'').trim().toLowerCase(),!s||/not st/.test(s)?null:s
.length==2?(s=='uk'?'GB':s.toUpperCase()):CR.find(([,r])=>RegExp(r).test(s))?.[0]),p2=n=>String(+n).padStart(2,'0'),ymd=(y,m,d)=>`${y}-${p2(m)}-${p2(d)}`,D=(s,f
)=>{let m=s.match(/(\d+)[/.](\d+)[/.](\d+)/),y;if(m)return y=m[3].length<3?'19'+m[3]:m[3],f?ymd(y,m[1],m[2]):ymd(y,m[2],m[1]);y=s.match(/\d{4}/)?.[0]??'19'+s.
slice(-2);return ymd(y,MO.indexOf(s.match(/[A-Z][a-z]{2}/))/3+1,s.replace(y,'').match(/\d+/))},gf=s=>(s=s.trim().split(/\s+/).filter(x=>!
/^(mr|mrs|ms|dr|prof)\.?$/i.test(x)&&!/^[A-Z]\.$/.test(x)),[s[0],s.slice(1).join(' ')]),DT='[\\w ,]*?\\d{4}|\\d+-\\w+-\\d\\d|[\\d/]+',nm=s=>s.includes(', ')?[gf
(s.split(', ')[1].replace(/\(.*/,''))[0],s.split(', ')[0]]:gf(s),b=s=>s.normalize('NFC').toLowerCase().replace(/['’\x60\-\s.]/g,'').replace(/ß/g,'ss'),pd=(a,c
)=>os(fs(a),fs(c)),fs=s=>b(s).replace(/æ/g,'ae').replace(/ø/g,'o').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/([aou])[aeu]/g,'$1'),os=(a,c)=>{if(a
==c)return 0;let i=0;while(a[i]==c[i])i++;a=a.slice(i);c=c.slice(i);const h=(x,y)=>x.slice(1)==y;return h(a,c)||h(c,a)||a.slice(1)==c.slice(1)||a[0]==c[1]&&a[1]
==c[0]&&a.slice(2)==c.slice(2)?1:2},A=(s,cu,de,ng)=>{s=(s||'').trim();if(!/\d/.test(s))return null;const c=(s.match(/[A-Z]{3}/)||[/€/.test(s)?'EUR':cu])[0],v=+(
de?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'')).match(/\d+(\.\d+)?/)[0];return{v:(ng||/^\(|^-|-\s|CR|▲/.test(s)?-1:1)*v,c}};export function 
heurSolve(task){const{export:ex,spec:sp,source_notes:no}=task.inputs,nk={},cc={},R={USD:1},rows=[],F=g=>nk[g]??g,P=[],G={},mm=(s,r)=>s.matchAll(r);for(const m 
of mm(sp,/([A-Za-z/]+) = ([^\s;]+)/g))for(const n of m[1].split('/'))nk[n]=m[2];for(const m of mm(sp,/ ([A-Z]{2}) +\+(\d+) .*: (\S+)/g))cc[m[1]]=m;for(const m 
of mm(sp,/^ +(USD\/)?([A-Z]{3})(?:\/USD)? +([\d.]+)$/gm))R[m[2]]=m[1]?1/m[3]:+m[3];const Q=x=>(no.match(RegExp('\\n'+x+'\\.[^\\n]*'))||[''])[0],AQ=Q('ATLAS'),VQ
=Q('VENDEX'),BQ=Q('BRIGHTDESK'),FV=[],bm=/h\/day|MM\/DD|kept|Brit/.test(BQ),am=/h\/day|MM\/DD\/YYYY, n|h comes|UK inst|ted Sta/.test(AQ),vm=!
/n convention|DD\/MM|is the day|month-f/.test(VQ),mi=(no.match(/\n(\w+)\.[^\n]*(?:ract c|ed every|y job|overw|re-imp)/)||[])[1];for(const x of no.split(
/(?<=\.) /))if(/marked |only means|marks appl|confuse/.test(x)&&
/load-t|abort|reject|not real|bought|auditor|counts|not keep|like (the Z|"st|lines e|SAMP|sandb)/.test(x))FV.push((x.match(
/(?:marked |^|confuse )(?:stage=(\w+)|Status "(\w+)"|":: ([A-Z ]+)"|"flag: (\w+)"|"env":"(\w+)")/)||[]).slice(1).find(v=>v));const PY={B:
/posits we|e is money we owe|oppos|chang/,A:/n is what we owe|payab|Do not|of ours/,L:/side, not|o is money we owe|oppos|chang/,K:
/d store|money we owe|chang|payab/},PS={B:PY.B.test(BQ),A:PY.A.test(AQ),L:PY.L.test(Q('LEDGR')),K:PY.K.test(Q('KOBO'))};const N=(s,i)=>{s=(s||'').trim();const d
=s.replace(U,''),[,,k,t]=cc[i]||[];if(!d||/^0+$/.test(d))return null;if(/^(\+|00)/.test(s))return'+'+s.replace(U,'').replace(/^00/,'');return k?'+'+k+(t=='0'?d.
replace(/^0/,''):k=='1'&&d.length==11?d.slice(1):d):null};for(const L of ex.split('\n')){const g=k=>(L.match(RegExp(`[|] ${k}[=:] ?([^|]*)`))||[])[1]?.trim()??
'',B=L.replace(/ Remark: .*| \(Application withdrawn.*/,''),y=(r,f='i')=>B.match(RegExp(r,f))?.slice(1).find(v=>v),s=L.split(/ :: |;/),l=L[0]+L[1],q=g('birth');
let r,c;if(l=='BR')c=cty(g('country')),r={v:/=ZZTEST/.test(L)||FV.includes(g('stage')),n:nm(g('name')),dob:/[1-9]/.test(g('dob'))&&D(g('dob'),bm),p:N(g('phone')
,c),a:A(g('balance'),'USD'),u:g('updated')};if(l=='LE')c=cty(s[5]),r={v:s[8]=='storniert'||FV.includes(s[8]),n:nm(s[2]),dob:/[1-9]/.test(s[4])&&D(s[4]),p:N(s[6]
,c),a:A(s[7],'EUR',1),u:D(s[9])};if(l=='AT')c=cty(s[3]),r={v:/ MIGRATE$/.test(L)||FV.includes(s.at(-1)),n:nm(s[1]),dob:/\d/.test(s[2])&&D(s[2],am),p:N(s[4].
slice(4),c),a:A(s[5].slice(5),'GBP'),u:D(s[6])};if(l=='KO'){const t=y('member: (.+?) \\|').split(' ');c='JP',r={v:/SAMPLE$/.test(L)||FV.includes(g('flag')),n:[t
.pop(),t.join(' ')],p:N(g('tel'),c),dob:/^\d/.test(q)&&q.replace(/\//g,'-'),a:A(g('balance'),'JPY'),u:g('upd').replace(/\//g,'-')}}if(l=='VE'){const o=JSON.
parse(L.slice(8));c=cty(o.country),r={v:o.env=='sandbox'||FV.includes(o.env),n:[o.given,o.family],dob:o.dob!='1900-01-01'&&o.dob,p:o.msisdn&&'+'+o.msisdn,a:o.
amount&&{v:+o.amount,c:o.ccy},u:o.ts.slice(0,10)}}if(l=='Ve'){const t4=B.split(' — '),db=y(`(?:[Bb]orn|of birth|DOB|b\\.) (${DT})`,'');c=cty(t4.length>5?t4[2]:y
('based in ([^,;)]+)|'+'an? (\\w+) (?:supp|cont)'));r={v:L.endsWith('onboarded.)'),n:gf(y('— (?:Supplier contact |Spoke with |[^:]+: )?'+
'(.+?)(?=,| \\(| — | on | b| date| DOB)','')),dob:db&&D(db,vm),u:D(y(`(?:revised(?: on)?|\\bon) (${DT})`),vm),p:N(y('(?:phone|at|tel\\.|mobile|ber) '+
'(.+?)(?=[,;]| — |\\. |\\.$)'),c)}}if(r&&!r.v&&PS[L[0]]&&r.a)r.a.v=-r.a.v;if(r&&!r.v)rows.push({...r,c,k:L.startsWith(mi),id:+L.match(/\d+/)[0],gn:F(r.n[0])})}
const f=i=>(P[i]??i)==i?i:(P[i]=f(P[i]));rows.forEach((a,i)=>rows.forEach((c,j)=>{if(j>i&&(a.dob&&c.dob?a.dob==c.dob:a.p&&a.p==c.p)){const q=pd(a.gn,c.gn);if(q+
(q<2?pd(a.n[1],c.n[1]):2)<2)P[f(i)]=f(j)}}));rows.forEach((r,i)=>(G[f(i)]||=[]).push(r));return{records:Object.values(G).map(g=>{g.sort((a,c)=>a.k-c.k||(c.u>a.u
)-(c.u<a.u)||c.id-a.id);const k=q=>g.find(r=>r[q])?.[q]??null,a=k('a'),ids=g.map(r=>r.id).sort((x,y)=>x-y);return{entity_id:ids[0],source_rows:ids,given_name:g[
0].gn,family_name:g[0].n[1],birth_date:k('dob'),country:k('c'),phone_e164:k('p'),amount_usd:a?Math.round(a.v*R[a.c]*100)/100:null}})}}
