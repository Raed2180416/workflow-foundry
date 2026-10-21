// Primitive detectors for the need router (ROUTER-1, research/need-router-20261014/router1/PREREG-ROUTER-1.md).
//
// Each detector reads the request text (and optional structured context) and returns a score in [0, 1] with the words that
// fired it. Eight primitives raise the need for a workflow; five dampeners lower it. Scores combine weighted cues by
// noisy-OR (1 - prod(1 - w)), each distinct cue counted once, so repeating a word does not raise a score and a long text
// raises it only through distinct cues. Sentence-level scoping applies the rubric's edge rules inside the detectors:
//   - a bare reminder ("remind me every Monday") is not a recurring job;
//   - configuring another system's scheduler or CI ("add a GitHub Actions workflow that runs on every push", "set up a
//     Slack alert when the nightly job fails") is coding, not running a process;
//   - frequency words that describe existing code or the past ("the ETL runs nightly", "each month last year") or name an
//     artifact ("a weekly meal plan") are not a schedule.
//
// The request text is data: nothing in it is executed or followed; it is only matched.

export const PRIMITIVES = Object.freeze(['recurrence', 'waits', 'effects', 'multiParty', 'rules', 'volume', 'audit', 'reuse']);
export const DAMPENERS = Object.freeze(['question', 'mention', 'hypothetical', 'singleAction', 'coding']);
export const FEATURES = Object.freeze([...PRIMITIVES, ...DAMPENERS]);
export const DETECTOR_VERSION = 'need-primitives/1';
export const MAX_SCAN_CHARS = 20000;

const DAY = '(?:day|morning|afternoon|evening|night|weekday|weekend|week|month|quarter|year|hour|business day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)';
const N = '(?:\\d+|two|three|four|five|six|ten|twelve|fifteen|thirty)';
const UNIT = '(?:minutes?|mins?|hours?|hrs?|days?|business days?|weeks?|months?|quarters?)';

// A cue: [id, RegExp source (matched case-insensitively), weight]. Ids are stable: they appear in evidence and tests.
const RECURRENCE = [
  ['every-period', `\\bevery\\s+(?:single\\s+|other\\s+|(?:1st|2nd|3rd|first|second|third|last)\\s+)?${DAY}s?\\b`, 0.9],
  ['every-n-units', `\\bevery\\s+${N}\\s*${UNIT}\\b`, 0.9],
  ['each-period', `\\beach\\s+${DAY}\\b`, 0.85],
  ['once-a-period', `\\b(?:once|twice|three times)\\s+(?:a|an|per|every)\\s+${DAY}\\b`, 0.9],
  ['periodic-adverb', '\\b(?:daily|weekly|monthly|nightly|quarterly|hourly|bi-?weekly|fortnightly|annually|yearly)\\b', 0.55],
  ['on-schedule-day', `\\bon\\s+(?:${DAY})s\\b`, 0.6],
  ['whenever', '\\bwhenever\\b', 0.9],
  ['each-new', '\\b(?:every|each|any)\\s+(?:new|incoming|newly)\\b', 0.85],
  ['every-time', '\\b(?:every|each)\\s+time\\b', 0.7],
  ['as-they-come', '\\bas\\s+(?:they|it|soon as they|soon as it|new ones)\\s+(?:come|comes|arrive|arrives|land|lands|show up|get submitted)\\b', 0.9],
  ['from-now-on', '\\b(?:from now on|going forward|moving forward|on an ongoing basis|from here on|until (?:i|we) say (?:stop|otherwise))\\b', 0.9],
  ['ongoing', '\\bongoing\\b', 0.45],
  ['keep-watch', '\\b(?:keep an eye on|keep watch|keep tabs on|watch for)\\b', 0.7],
  ['monitor', '\\bmonitor(?:s|ing)?\\b', 0.5],
  ['keep-synced', '\\bkeep\\s+(?:\\w+\\s+){0,4}(?:in sync|synced|up to date|updated|tracked|current)\\b', 0.6],
  ['take-over', '\\b(?:take over|takes over|be in charge of|you (?:now )?own|own our|own the|you curate|you handle|you manage)\\b', 0.6],
  ['recurring-word', '\\b(?:recurring|recurrent|repeating|standing (?:task|job|duty|order))\\b(?!\\s+(?:workflows?|automations?|process(?:es)?)\\b)', 0.6],
  ['standing-policy', '\\b(?:standing policy|this automation runs|runs on every event|each run handles|case-tick)\\b', 0.95],
  ['start-doing', '\\b(?:start|begin|keep)\\s+(?:sending|doing|posting|tracking|running|checking|pulling|chasing|reviewing|logging|collecting|curating)\\b', 0.6],
  ['the-periodic-run', '\\bthe\\s+(?:daily|weekly|monthly|quarterly|nightly|annual|yearly)\\s+(?:\\w+\\s+){0,2}(?:scan|run|close|reconciliation|review|update|check|digest|sync|batch|audit|report|check-in|newsletter|sweep|cycle)\\b', 0.6],
  ['same-as-last', '\\b(?:same (?:format|way|process|workflow|steps|template) as (?:last|before|usual|always)|as (?:usual|always)|like last (?:time|week|month))\\b', 0.6],
  ['for-next-period', `\\bfor\\s+the\\s+next\\s+${N}\\s*(?:days?|weeks?|months?)\\b`, 0.7],
  ['on-each-event', '\\b(?:on|after|with)\\s+(?:each|every)\\s+(?:push|commit|merge|release|deploy|submission|order|signup|sign-up|request|batch)\\b', 0.5],
  ['when-someone', '\\bwhen(?:ever)?\\s+(?:someone|anyone|a customer|a user|an employee|a new|new)\\b', 0.6],
  ['verb-periodic', '\\b(?:send|post|email|share|publish|run|do|generate|produce|pull|compile|prepare|deliver|give)\\s+(?:me\\s+|us\\s+|them\\s+|the team\\s+)?(?:a|an|the|our|my)\\s+(?:\\w+\\s)?(?:daily|weekly|monthly|quarterly|nightly|morning|weekend)\\b', 0.85],
  ['weekday-artifact', `\\bthe\\s+(?:${DAY})\\s+(?:\\w+\\s)?(?:report|update|digest|sync|check-in|newsletter|email|summary|standup|stand-up|review|recap|roundup|round-up|status)\\b`, 0.8],
  ['take-over-doing', '\\b(?:take over|takes over|handle|own|run)\\s+(?:the\\s+|our\\s+)?(?:sending|posting|running|doing|writing|preparing|compiling|chasing|reviewing|publishing)\\b', 0.8],
  ['auto-trigger', '\\b(?:automatically|auto-?(?:merge|approve|close|assign|reply|post))\\s*(?:\\w+\\s+){0,3}(?:when|whenever|once|after|if|as soon as)\\b', 0.7]
];
const WAITS = [
  ['wait-for', '\\bwait(?:s|ing)?\\s+(?:for|until|on)\\b', 0.85],
  ['until', '\\buntil\\b', 0.4],
  ['get-approval', '\\b(?:get|gets|obtain|collect|secure|chase|request|need|needs|await|route (?:it|them) to [^.]{0,40} for)\\b[^.]{0,50}\\b(?:approval|approvals|sign-?off|signature|signatures|consent|go-ahead)\\b', 0.85],
  ['approval-word', '\\b(?:approval|approvals|sign-?off|signature|signed|countersign\\w*)\\b', 0.35],
  ['once-done', '\\b(?:once|after|when)\\s+(?:it is |it\'s |they are |they\'re )?(?:approved|signed|confirmed|they (?:reply|respond|confirm|approve|sign)|the (?:cfo|manager|board|customer|client) (?:approves|signs|confirms|replies))\\b', 0.9],
  ['only-then', '\\b(?:only then|and only then|then and only then)\\b', 0.6],
  ['follow-up-until', '\\bfollow(?:\\s|-)?up\\b(?!\\s+(?:email|message|note|call|letter))[^.]{0,60}\\b(?:if|until|within|unless|before)\\b', 0.75],
  ['within-period', `\\bwithin\\s+${N}\\s*${UNIT}\\b`, 0.55],
  ['period-end', '\\b(?:at|on)\\s+the\\s+end\\s+of\\s+(?:the|their|its)\\s+(?:billing period|billing cycle|term|trial|contract|month|quarter|notice period)\\b', 0.75],
  ['track-status', '\\btrack\\s+(?:the\\s+|its\\s+|their\\s+)?(?:status|progress)\\b', 0.7],
  ['sequence', '\\b(?:meeting sequence|sequence of (?:meetings|emails|steps)|at each step|one after another)\\b', 0.3],
  ['staged', '\\b(?:one (?:service|region|team|site|cluster|server|store|wave|office|country|market) at a time|in waves|canary|staged rollout|roll(?:ing)? (?:it )?out (?:to|across)|rollout (?:to|across|plan)|(?:service|region|site|store) by (?:service|region|site|store))\\b', 0.7],
  ['stop-if-fails', '\\b(?:stop|halt|pause|abort|kill|roll ?back)\\w*\\s+(?:\\w+\\s+){0,3}(?:if|when|on|once)\\b[^.]{0,40}\\b(?:fail|fails|failure|anything|error|errors|diverge\\w*|regress\\w*|breach\\w*)\\b', 0.6],
  ['for-next-period', `\\b(?:for|over)\\s+the\\s+next\\s+${N}\\s*(?:days?|weeks?|months?)\\b`, 0.7],
  ['deadline-date', '\\b(?:before|by)\\s+(?:the\\s+)?(?:\\d{1,2}(?:st|nd|rd|th)|end of (?:the )?(?:month|quarter)|next (?:week|month))\\b', 0.3],
  ['next-meeting', '\\bat\\s+the\\s+next\\s+(?:board\\s+)?meeting\\b', 0.6],
  ['then-step', '\\bthen\\s+(?:deploy|send|submit|release|pay|schedule|route|notify|publish|merge|release|forward|escalate)\\b', 0.35],
  ['escalate', '\\bescalat(?:e|es|ed|ing|ion)\\b', 0.3],
  ['case-tick', '\\b(?:case-tick|process instance|instance of your process|over days|across days|several days)\\b', 0.8]
];
const EFFECTS = [
  ['communicate', '\\b(?:send|sends|sending|email|emails|e-mail|post|posts|posting|notify|notifies|message|sms|text them|ping|cc|dm|announce|reply to|respond to)\\b', 0.35],
  ['release', '\\b(?:deploy|deploys|deploying|release|releases|ship|publish|merge|merged)\\b', 0.35],
  ['money', '\\b(?:pay|pays|paid|payout|payouts|payment|payments|refund|charge|wire|transfer|reimburse\\w*|payroll|invoice|invoices)\\b', 0.35],
  ['destroy', '\\b(?:delete|deleting|drop|purge|wipe|revoke|deactivate|terminate|decommission|cancel|disable)\\b', 0.4],
  ['write-record', '\\b(?:create|add|update|upsert|log|record|file|book|schedule|assign|route|tag|flag|move)\\b', 0.15],
  ['submit', '\\b(?:submit|submits|submitting|file it|lodge|apply for)\\b', 0.35],
  ['production', '\\b(?:production|prod|live (?:site|system|database|traffic))\\b', 0.35],
  ['mass', '\\b\\d[\\d,]{2,}\\s+(?:\\w+\\s)?(?:customers|users|recipients|subscribers|employees|people|accounts|contacts|patients)\\b', 0.35],
  ['amount', '\\$\\s?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:k|m|million)?\\b', 0.15]
];
// Strong irreversible effects: the checklist signal (mode rule) when nothing raises the need above the threshold.
const IRREVERSIBLE = [
  ['delete-many', '\\b(?:delete|drop|purge|wipe|destroy)\\b[^.]{0,60}\\b(?:every|all|each|bucket|buckets|database|databases|table|tables|cluster|prod|production|account|accounts)\\b', 0.9],
  ['prod-change', '\\b(?:migrat\\w+|upgrade|deploy|cut ?over|failover|restore|rotate|change|patch)\\b[^.]{0,60}\\b(?:production|prod)\\b|\\b(?:production|prod)\\b[^.]{0,40}\\b(?:migrat\\w+|upgrade|cut ?over|failover|restore|downtime)\\b', 0.85],
  ['money-move', '\\b(?:wire|transfer|pay|send)\\b[^.]{0,40}\\$\\s?\\d[\\d,]{4,}', 0.8],
  ['mass-send', '\\b(?:send|email|announce|notify|message)\\b[^.]{0,60}\\b(?:all|every|\\d[\\d,]{3,})\\s+(?:\\w+\\s)?(?:customers|users|subscribers|employees|recipients)\\b', 0.8],
  ['downtime', '\\b(?:downtime|rollback plan|roll back plan|maintenance window)\\b', 0.6]
];
const SYSTEMS = ['salesforce', 'hubspot', 'jira', 'confluence', 'slack', 'teams', 'zendesk', 'freshdesk', 'zoho', 'helpcrunch', 're:amaze', 'reamaze',
  'quickbooks', 'xero', 'stripe', 'gusto', 'asana', 'trello', 'airtable', 'notion', 'google sheets', 'spreadsheet', 'sheet', 'google drive', 'shared drive', 'drive',
  'dropbox', 'github', 'gitlab', 'w&b', 'wandb', 'calendly', 'zoom', 'gmail', 'outlook', 'docusign', 'shopify', 'netsuite', 'workday', 'bamboohr', 'servicenow',
  'pagerduty', 'datadog', 'feedly', 'intercom', 'mailchimp', 'twilio', 'crm', 'erp', 'hris', 'ats', 'bank', 'ledger', 'tracker', 'dashboard', 'dashboards', 'calendar',
  'arxiv', 'linkedin', 'monday.com', 'clickup', 'linear', 'sharepoint', 'okta', 'greenhouse', 'lever', 'paypal', 'square', 'bill.com', 'expensify', 'brex', 'ramp',
  'freshbooks', 'wave', 'pipedrive', 'marketo', 'segment', 'mixpanel', 'amplitude', 'sentry', 'opsgenie', 'statuspage', 'webflow', 'wordpress', 'typeform', 'qualtrics', 'redcap'];
const ROLES = ['cfo', 'ceo', 'cto', 'coo', 'controller', 'finance', 'finance team', 'payroll', 'legal', 'general counsel', 'counsel', 'board', 'manager', 'managers', 'pi', 'reviewer',
  'reviewers', 'on-call', 'oncall', 'security team', 'compliance team', 'hr', 'support team', 'account manager', 'csm', 'vp', 'director', 'auditor', 'approver', 'customer',
  'customers', 'client', 'clients', 'vendor', 'vendors', 'recipient', 'employee', 'employees', 'team lead', 'analysts', 'the team', 'the lab', 'project manager',
  'sales team', 'procurement', 'second person', 'third reviewer', 'a third'];
const RULES = [
  ['policy', '\\b(?:policy|policies|rulebook|playbook|sop|standard operating procedure)\\b', 0.5],
  ['latest-policy', '\\b(?:latest|current|updated|recent|new|our|the)\\s+(?:\\w+\\s){0,2}(?:policy|policies|guidelines|rules|criteria|playbook|guidance|program guidelines)\\b', 0.4],
  ['rules', '\\b(?:rules|guidelines|criteria|requirements|procedure|protocol)\\b', 0.4],
  ['regulation', '\\b(?:compliance|regulat\\w+|sla|slas|irb|prisma|hipaa|gdpr|ccpa|sox|pci(?:-dss)?|iso ?\\d+|soc ?2|fda|gxp|chain[- ]of[- ]custody|de-?identif\\w+|kyc|aml)\\b', 0.45],
  ['follow-our', '\\b(?:follow|following|per|according to|as per|in line with|comply with|respect)\\s+(?:our|the|all|these|its|their|any)\\b', 0.45],
  ['exactly', '\\b(?:exactly|verbatim|strictly|precisely|to the letter|without exception)\\b', 0.4],
  ['must', '\\b(?:must|mustn\'t|must not|never|always|required to|shall)\\b', 0.25],
  ['only-if', '\\bonly\\s+(?:if|when|for|after|once|then)\\b', 0.4],
  ['threshold', '\\b(?:if|when|unless|anything|any)\\b[^.]{0,60}\\b(?:over|above|below|under|exceeds?|more than|less than|greater than|at least|>|<)\\s*\\$?\\d', 0.5],
  ['age-threshold', '(?:>|>=|\\bover\\s|\\bolder than\\s|\\bmore than\\s|\\bpast\\s|\\bunder\\s|\\bbelow\\s|\\babove\\s)\\s*\\$?\\d+(?:[.,]\\d+)?\\s*(?:d|days?|hours?|h|hrs?|weeks?|k|%|minutes?)?\\b', 0.35],
  ['tolerance', '\\b(?:tolerance|threshold|thresholds|limit|limits|band|bands|tier|tiers)\\b', 0.3],
  ['locked', '\\b(?:locked|preregist\\w+|pre-regist\\w+|registered protocol|independent(?:ly)?|blind(?:ed)?|second person|four-eyes|two-person)\\b', 0.45],
  ['match-on', '\\b(?:match on|matched against|cross-check|three-way match|reconcile against|verify (?:that|each|every))\\b', 0.35]
];
const VOLUME = [
  ['for-each', '\\b(?:for\\s+)?(?:each|every)\\s+(?:one\\s+)?(?:of\\s+(?:the|our|these|those|its)\\s+)?(?:\\d[\\d,]*\\s+)?(?:[\\w-]+\\s)?(?:row|item|ticket|lead|package|employee|invoice|order|customer|record|request|sample|service|microservice|page|file|vendor|candidate|account|transaction|payout|claim|case|event|submission|repo|repository|user|contact|deal|opportunity|configuration|batch|receipt|referral|site|store|region|project|form|message|report|entry|document|patient|participant|subject)s?\\b', 0.65],
  ['all-the', '\\ball\\s+(?:of\\s+)?(?:the\\s+|our\\s+|open\\s+|pending\\s+|unassigned\\s+|new\\s+|incoming\\s+|outstanding\\s+|overdue\\s+|unpaid\\s+|active\\s+)+(?:\\w+\\s)?(?:leads|tickets|requests|invoices|orders|packages|items|records|customers|employees|pages|services|cases|claims|accounts|vendors|receipts|referrals|submissions|deals|contacts|sites)\\b', 0.6],
  ['n-things', '\\b\\d[\\d,]*\\s+(?:\\w+\\s){0,2}(?:employees|customers|tickets|leads|invoices|orders|abstracts|records|rows|samples|services|microservices|configurations|pages|payouts|transactions|accounts|files|strings|names|users|vendors|sites|repos|repositories|requests|items|entries|stores|clients|contracts|candidates|papers)\\b', 0.35],
  ['batch-queue', '\\b(?:batch|batches|queue|queues|backlog|inbox|pending|unassigned|incoming)\\b', 0.3],
  ['process-the', '\\b(?:process|processes|processing|triage|triaging|route|routing|handle|handling)\\s+(?:the\\s+|all\\s+|our\\s+|any\\s+|incoming\\s+|pending\\s+|new\\s+|unassigned\\s+)+(?:\\w+\\s)?\\w+s\\b', 0.5],
  ['work-queue', '\\b(?:chase|process|review|triage|route|reconcile|follow up on|handle|flag|tag|dedupe|enrich|qualify|score|approve|reject|onboard|offboard|screen|answer|respond to|reply to|sort out|clean up)\\s+(?:the\\s+|all\\s+|any\\s+|our\\s+|new\\s+|unpaid\\s+|overdue\\s+|open\\s+|pending\\s+|incoming\\s+|late\\s+|outstanding\\s+|stale\\s+)*(?:[\\w,-]+\\s)?(?:invoices|tickets|leads|requests|orders|packages|claims|receipts|referrals|submissions|deals|applications|candidates|expenses|payments|refunds|returns|reviews|questions|conversations|mentions|escalations|incidents|alerts|bills|signups|sign-ups|abstracts|samples|prs|pull requests|issues)\\b', 0.55],
  ['bulk', '\\b(?:in bulk|bulk|en masse|fan[- ]out)\\b', 0.4]
];
const AUDIT = [
  ['log', '\\b(?:log|logs|logged|logging)\\b', 0.35],
  ['audit', '\\b(?:audit|audits|audit trail|auditor|auditable)\\b', 0.4],
  ['record-every', '\\b(?:record|document|note|log)\\s+(?:every|each|all|the decision|who|why|when|the reason)\\b', 0.6],
  ['custody', '\\b(?:chain[- ]of[- ]custody|who (?:accessed|approved|did|changed|viewed)|access log)\\b', 0.7],
  ['changelog', '\\b(?:change ?log|changelog|history|timestamps?|paper trail)\\b', 0.3],
  ['evidence', '\\b(?:evidence|proof|traceab\\w+|accountab\\w+|attribution)\\b', 0.3],
  ['so-can-track', '\\b(?:so (?:that )?(?:finance|audit|they|we|the team|legal) can (?:track|see|verify|audit)|keep (?:a|an) (?:record|log|trail))\\b', 0.5],
  ['report-to', '\\b(?:report|summary|digest)\\s+(?:to|for)\\s+(?:the\\s+)?(?:pi|cfo|controller|board|me|finance|management|team|lab)\\b', 0.3]
];
const REUSE = [
  ['standard', '\\b(?:standard|usual|regular|routine (?:report|process|run)|the template|our template|same template|our process|our procedure|our playbook|house style)\\b', 0.4],
  ['again', '\\b(?:again|as before|like last time|same as last|same format|every cycle|each cycle|next time)\\b', 0.45],
  ['template-word', '\\b(?:template|playbook|sop|runbook|checklist)\\b', 0.2],
  ['ongoing-duty', '\\b(?:going forward|from now on|whenever|standing|each new|every new|as they come)\\b', 0.6],
  ['periodic-name', '\\bthe\\s+(?:daily|weekly|monthly|quarterly|nightly|annual)\\s+\\w+', 0.45]
];
// Dampeners.
const QUESTION = [
  ['wh-head', '^\\s*(?:hey,?\\s+|hi,?\\s+|quick question:?\\s+|so,?\\s+)?(?:what|what\'s|whats|which|why|how|is|are|does|do|did|should|would|when|where|who|whom|is it|am i)\\b', 0.75],
  ['question-mark-end', '\\?\\s*$', 0.3],
  ['inform-verb', '^\\s*(?:hey,?\\s+|hi,?\\s+|please\\s+|can you\\s+|could you\\s+|would you\\s+|i need you to\\s+|i need help\\s+)?(?:explain|summari[sz]e|compare|translate|proofread|rewrite|rephrase|shorten|draft|write|format|outline|suggest|recommend|brainstorm|tell me|remind me (?:what|of|how|which)|list|analy[sz]e|calculate|convert|estimate|review this|look at|read|find out|figure out|help me (?:draft|write|summari[sz]e|understand|decide)|sort|proof|edit|polish|critique|give me|create a (?:\\w+ )?(?:plan|outline|summary|template|draft|list|checklist|guide)|make (?:me )?a (?:\\w+ )?(?:plan|list|summary|checklist|template|outline))\\b', 0.55],
  ['given-material', '\\b(?:pasted|attached|below|above|these \\d+|this (?:csv|file|document|contract|paper|email|pr|pull request|text|list|report|code|spreadsheet|note|notes|draft|letter|intro|section|manual)|the (?:attached|following))\\b', 0.4],
  ['task-inputs', '\\binputs\\.\\w+|\\bthe inputs give\\b|\\bas module_source\\b|\\battached files?\\b', 0.4],
  ['json-only', '\\b(?:return only json|return json|answer with json|reply with only)\\b', 0.6],
  ['retrospective', '\\b(?:last|previous|past)\\s+(?:year|quarter|month|week|season)\\b|\\bin 20\\d\\d\\b', 0.3],
  ['writing-output', '\\b(?:draft|write|rewrite|compose)\\s+(?:a|an|the|my|our)\\s+(?:\\w+\\s){0,3}(?:email|reply|response|letter|post|announcement|section|paragraph|summary|template|note|message|memo|intro|bio|proposal|request|writeup|write-up|blurb|tweet|thread)\\b', 0.5]
];
const MENTION = [
  ['explain-process', '\\b(?:explain|what is|what\'s|what are|describe|define|difference between|differences between|compare|comparing|pros and cons|write (?:a|an) (?:blog|article|essay|post|paragraph) (?:about|on)|how do(?:es)?)\\b[^.?]{0,80}\\b(?:workflow|workflows|automation|automations|pipeline|pipelines|ci|cd|ci/cd|approval|approvals|compliance|schedule|scheduler|recurring|process|processes|cron|policy|policies|section|act|regulation)\\b', 0.8],
  ['product-feature', '\\b(?:workflows?|approval workflows?|automations?|pipelines?)\\s+in\\s+[A-Z]', 0.5],
  ['quoted-keyword', '[\'"\\u2018\\u201c](?:workflow|automation|process|pipeline)[\'"\\u2019\\u201d]', 0.6],
  // Talk about the classification itself, or an attempt to steer it: the text is data, never an instruction to the router.
  ['about-the-label', '\\b(?:ignore (?:all |any )?(?:previous|prior|above|earlier|the) (?:rules|instructions|prompt)|(?:classify|label|mark|treat|flag) (?:this|it|the request) as|(?:say|answer|decide|output) (?:that )?(?:this|it) (?:needs|is|requires)|this (?:needs|requires|is) (?:a|an) (?:\\w+ )?(?:workflow|automation)\\b)', 0.8],
  ['vs', '\\b(?:vs\\.?|versus|or)\\b[^.?]{0,40}\\?\\s*$', 0.3]
];
const HYPOTHETICAL = [
  ['what-if', '\\bwhat\\s+(?:happens|would happen|if|would it take|would be)\\b', 0.8],
  ['if-we-were', '\\bif\\s+(?:i|we|you)\\s+(?:were to|wanted to|decided to|had to)\\b', 0.6],
  ['suppose', '\\b(?:suppose|hypothetical(?:ly)?|imagine|in theory|theoretically)\\b', 0.7],
  ['would-it', '\\b(?:would it be|is it (?:worth|possible|okay|ok|safe|wise)|should (?:i|we))\\b', 0.5]
];
const SINGLE = [
  ['bare-reminder', '^\\s*(?:hey,?\\s+|hi,?\\s+|please\\s+|can you\\s+|could you\\s+|pls\\s+)?(?:remind me\\b(?!\\s+(?:what|of|how|which|who|where|when we))|set (?:a|an|up a) (?:recurring )?(?:reminder|timer|alarm))', 0.85],
  ['reminder-also', '\\bremind\\s+me\\b(?!\\s+(?:what|of|how|which|who|where|when we))', 0.2],
  ['negation', '\\b(?:no need to (?:automate|set up|make)|don\'t (?:automate|set up|need a workflow)|just (?:this )?once|one-?off|one time only|only this once|a single time)\\b', 0.85],
  ['one-thing', '\\b(?:one|a single|this one|that one)\\s+(?:email|message|record|task|ticket|meeting|call|refund|field|row|order|invoice|booking|flight|reply)\\b', 0.4],
  ['verb-head', '^\\s*(?:hey,?\\s+|hi,?\\s+|please\\s+|can you\\s+|could you\\s+|can u\\s+|pls\\s+)?(?:refund|update|create|add|book|cancel|push|move|reschedule|send|approve|set|change|schedule|invite|reply|forward|archive|rename|fix|bump|merge|close|open|tag|assign|delete|remove|order|buy|pay)\\b', 0.35],
  ['casual-short', '^.{0,90}$', 0.25],
  ['specific-record', '\\b(?:order|invoice|ticket|lead|issue|pr|case|account)\\s+#?[A-Z0-9-]*\\d{2,}\\b', 0.3]
];
const CODING = [
  ['code-noun', '\\b(?:bug|bugs|error|exception|stack ?trace|function|method|class|module|refactor\\w*|unit tests?|test suite|tests? green|typescript|javascript|python|rust|golang|java|kotlin|swift|react|next\\.js|angular|angularjs|vue|node\\.js|api|endpoint|cli|cli flag|--[a-z][\\w-]+|repo|repository|codebase|pull request|commit|compiler|script|sql|schema|regex|library|dependency|dependencies|docker|kubernetes|helm|terraform|yaml|config file|spark|etl|frontend|backend|webassembly|b\\+ tree|latency|p99|index|indexer|parser|typescript|ts|tsx|seurat|r script)\\b', 0.3],
  ['code-file', '\\b[\\w/-]+\\.(?:py|ts|tsx|js|mjs|cjs|go|rs|java|rb|php|cs|cpp|c|h|sql|yaml|yml|toml|json|sh)\\b', 0.5],
  ['code-verb', '\\b(?:fix|implement|refactor|port|rewrite|debug|profile|optimi[sz]e|repair|lint|unit-test)\\b', 0.3],
  ['configure-other', '\\b(?:add|create|write|set up|setup|configure|install|build)\\b[^.]{0,40}\\b(?:github actions?|gitlab ci|ci (?:job|step|pipeline|config)|cron ?(?:job|line|entry|tab)?|crontab|workflow file|yaml|alert|alerting rule|alarm|webhook|dashboard|staging environment|environment|terraform|helm chart|dockerfile|pre-commit hook|git hook|monitoring|metrics|health ?checks?|logging)\\b', 0.7],
  ['ci-red', '\\b(?:ci is (?:now )?red|tests? (?:are )?failing|build (?:is )?broken|make (?:the )?tests pass|keep(?:ing)? (?:all )?(?:\\d+ )?(?:existing )?tests green)\\b', 0.6]
];

const TABLES = { recurrence: RECURRENCE, waits: WAITS, effects: EFFECTS, rules: RULES, volume: VOLUME, audit: AUDIT, reuse: REUSE,
  question: QUESTION, mention: MENTION, hypothetical: HYPOTHETICAL, singleAction: SINGLE, coding: CODING };
const COMPILED = Object.fromEntries(Object.entries(TABLES).map(([k, cues]) => [k, cues.map(([id, src, w]) => ({ id, re: new RegExp(src, 'gi'), w }))]));
const IRREVERSIBLE_C = IRREVERSIBLE.map(([id, src, w]) => ({ id, re: new RegExp(src, 'gi'), w }));
// Cues whose regex anchors on the start or end of the text are matched against the whole text, not per sentence.
const WHOLE_TEXT = new Set(['question:wh-head', 'question:question-mark-end', 'question:inform-verb', 'singleAction:verb-head', 'singleAction:casual-short', 'singleAction:bare-reminder', 'mention:vs']);

// Sentence scoping. A sentence is "scoped out" for recurrence when it is a bare reminder, configures another system's
// scheduler/CI, describes existing code or the past, or names an artifact after a period.
const SCOPE = {
  reminder: /\bremind\s+me\b(?!\s+(?:what|of|how|which|who|where))|\breminder\b/i,
  configure: /\b(?:add|create|write|set up|setup|configure|install)\b[^.]{0,40}\b(?:github actions?|gitlab ci|ci (?:job|step|pipeline|config)|cron ?(?:job|line|entry|tab)?|crontab|workflow file|yaml|alert|alerts|alerting rule|alarm|webhook|pre-commit hook|git hook|monitoring|metrics|health ?checks?|logging)\b/i,
  descriptive: /\b(?:currently|current|right now|at the moment|today it|it runs|which runs|that runs|runs nightly|instead of|rather than|used to|the old|the existing|existing|keeps? (?:rebuilding|failing|finding)|i keep|we keep finding|every time (?:it|we|the page|the user|i))\b/i,
  retrospective: /\b(?:last|previous|past)\s+(?:year|quarter|month|week)\b|\bin 20\d\d\b|\bhistorically\b/i,
  artifact: /\b(?:daily|weekly|monthly|quarterly)\s+(?:meal plan|plan|planner|schedule|budget|spreadsheet|sheet|calendar|workout|routine|template|chart|tracker|pipeline spreadsheet|pipeline sheet)\b/i,
  // A standing preference about how the assistant itself writes or behaves is not a job that runs.
  preference: /\b(?:from now on|going forward|moving forward|in future|in the future)\b,?\s+(?:please\s+)?(?:always\s+|never\s+)?(?:use|write|answer|reply|respond|call me|speak|talk|format|be (?:more|less)|keep (?:it|your|answers|replies)|don't|do not|address me|refer to|spell|sign (?:off|emails)|add emojis|stop)\b/i
};

function splitSentences(text) {
  return text.split(/(?<=[.!?;:])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}
function noisyOr(ws) { return 1 - ws.reduce((acc, w) => acc * (1 - w), 1); }

function scoreTable(key, text, sentences, { scopeOut = null } = {}) {
  const hits = [];
  for (const cue of COMPILED[key]) {
    const whole = WHOLE_TEXT.has(`${key}:${cue.id}`);
    const pools = whole ? [text] : sentences;
    let best = null;
    for (const s of pools) {
      cue.re.lastIndex = 0;
      const m = cue.re.exec(s);
      if (!m) continue;
      const w = scopeOut ? cue.w * scopeOut(s, cue) : cue.w;
      if (w > 0 && (!best || w > best.w)) best = { id: cue.id, w, match: m[0].slice(0, 80) };
    }
    if (best) hits.push(best);
  }
  return { score: noisyOr(hits.map(h => h.w)), hits };
}

function scopeRecurrence(sentence) {
  if (SCOPE.reminder.test(sentence)) return 0;
  if (SCOPE.preference.test(sentence)) return 0.1;
  if (SCOPE.configure.test(sentence)) return 0.2;
  if (SCOPE.retrospective.test(sentence)) return 0.2;
  if (SCOPE.descriptive.test(sentence)) return 0.25;
  if (SCOPE.artifact.test(sentence)) return 0.3;
  return 1;
}

function countParties(lower) {
  const systems = new Set(), parties = new Set();
  for (const s of SYSTEMS) if (new RegExp(`(?:^|[^\\w])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\w])`, 'i').test(lower)) systems.add(s);
  for (const r of ROLES) if (new RegExp(`\\b${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) parties.add(r);
  const channels = new Set((lower.match(/(?:^|\s)#[a-z][\w-]{1,40}/g) ?? []).map(c => c.trim()));
  const emails = new Set(lower.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []);
  // Overlapping names (sheet / spreadsheet / google sheets; drive / google drive / shared drive) count once.
  for (const [a, b] of [['sheet', 'spreadsheet'], ['sheet', 'google sheets'], ['spreadsheet', 'google sheets'], ['drive', 'google drive'], ['drive', 'shared drive'], ['dashboard', 'dashboards']]) if (systems.has(a) && systems.has(b)) systems.delete(a);
  for (const [a, b] of [['finance', 'finance team'], ['customer', 'customers'], ['client', 'clients'], ['vendor', 'vendors'], ['employee', 'employees'], ['manager', 'managers'], ['reviewer', 'reviewers'], ['counsel', 'general counsel'], ['operations', 'ops']]) if (parties.has(a) && parties.has(b)) parties.delete(a);
  return { systems: [...systems], parties: [...parties], channels: [...channels], emails: [...emails] };
}
const PARTY_SCORE = [0, 0.3, 0.6, 0.78, 0.88, 0.94];

// Distinct outside effects the request asks for (verbs that write to another system or reach another person). A word after
// a determiner or preposition is a noun ("via email", "the update", "a post") and is not counted.
const EFFECT_VERB = /\b(send|email|e-mail|post|notify|message|sms|text|ping|cc|reply|respond|announce|deploy|release|publish|merge|ship|pay|refund|charge|wire|transfer|reimburse|submit|delete|drop|purge|revoke|cancel|deactivate|create|add|update|log|record|file|book|schedule|assign|route|tag|flag|move|escalate|document|invite|upload|sync|archive|approve|reject|decline|forward|mark|close|label|enroll|register|order|issue|invoice)\b/gi;
const NOUN_BEFORE = /\b(?:a|an|the|via|by|in|this|that|these|those|your|my|our|their|his|her|its|of|for|with|from|each|every|any|no|new|weekly|daily|monthly|first|last|next|same|one)\s*$/i;
const LEMMA = { 'e-mail': 'email', emailed: 'email', emailing: 'email', posted: 'post', posting: 'post', sending: 'send', sends: 'send', notifies: 'notify', notified: 'notify',
  messages: 'message', messaging: 'message', updating: 'update', updated: 'update', updates: 'update', created: 'create', creating: 'create', creates: 'create', added: 'add',
  adding: 'add', logged: 'log', logging: 'log', logs: 'log', filed: 'file', filing: 'file', scheduled: 'schedule', scheduling: 'schedule', assigned: 'assign', routed: 'route',
  routing: 'route', tagged: 'tag', tagging: 'tag', flagged: 'flag', flagging: 'flag', moved: 'move', escalated: 'escalate', escalating: 'escalate', documented: 'document',
  invited: 'invite', uploaded: 'upload', synced: 'sync', archived: 'archive', approved: 'approve', rejected: 'reject', declined: 'decline', forwarded: 'forward', marked: 'mark',
  closed: 'close', deployed: 'deploy', deploying: 'deploy', released: 'release', published: 'publish', merged: 'merge', paid: 'pay', refunded: 'refund', charged: 'charge',
  submitted: 'submit', submitting: 'submit', deleted: 'delete', deleting: 'delete', revoked: 'revoke', cancelled: 'cancel', canceled: 'cancel', booked: 'book', replied: 'reply',
  replies: 'reply', responded: 'respond', announced: 'announce', recorded: 'record', recording: 'record', ordered: 'order', issued: 'issue', invoiced: 'invoice' };
export function effectVerbs(text) {
  const seen = new Map();
  EFFECT_VERB.lastIndex = 0;
  for (let m; (m = EFFECT_VERB.exec(text));) {
    if (NOUN_BEFORE.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
    const w = m[0].toLowerCase(), lemma = LEMMA[w] ?? w.replace(/(?:es|s)$/, '');
    if (!seen.has(lemma)) seen.set(lemma, m[0]);
  }
  return [...seen.keys()];
}

/**
 * Detect the primitives and dampeners in a request.
 * @param {string} text the request (data, never instructions)
 * @param {object} [context] optional structured hints that raise a primitive to at least the given strength:
 *   { recurrence: true|'weekly'|..., waits: true, systems: string[], parties: string[], volume: number, irreversible: true,
 *     audit: true, rules: true|string[], reuse: true }
 * @returns {{ features: Record<string, number>, evidence: Record<string, object[]>, irreversible: {score:number, hits:object[]}, detector: string }}
 */
export function detectPrimitives(text, context = {}) {
  const raw = String(text ?? '').slice(0, MAX_SCAN_CHARS);
  const sentences = splitSentences(raw);
  const features = {}, evidence = {};
  for (const key of ['recurrence', 'waits', 'effects', 'rules', 'volume', 'audit', 'reuse', 'question', 'mention', 'hypothetical', 'singleAction', 'coding']) {
    const r = scoreTable(key, raw, sentences, key === 'recurrence' || key === 'reuse' ? { scopeOut: scopeRecurrence } : {});
    features[key] = r.score; evidence[key] = r.hits;
  }
  const verbs = effectVerbs(raw);
  let gateParties = false;
  const addCue = (key, id, w, match) => { evidence[key] = [...evidence[key], { id, w, match }]; features[key] = 1 - (1 - features[key]) * (1 - w); };
  if (verbs.length >= 5) addCue('effects', 'many-effects', 0.75, verbs.slice(0, 6).join(', '));
  else if (verbs.length >= 3) addCue('effects', 'several-effects', 0.5, verbs.join(', '));
  if (verbs.length === 1 && features.volume < 0.5 && features.recurrence < 0.5 && features.waits < 0.5) {
    addCue('singleAction', 'one-effect', 0.45, verbs[0]);
    // Rubric: rules or systems read in order to choose one action do not make a process (W2 needs a set of items and two or
    // more effects). Without a wait, the rule and party signals of a one-effect request are halved.
    if (features.waits < 0.5) { features.rules *= 0.5; evidence.rules = [...evidence.rules, { id: 'one-effect-gate', w: 0.5, match: verbs[0] }]; gateParties = true; }
  }
  // No outside effect, no repetition, no wait, no set of items: the work is on the material itself (rubric: analysis or
  // transformation of material, however long or rule-dense, is none).
  if (!verbs.length && features.recurrence < 0.5 && features.waits < 0.5 && features.volume < 0.5) addCue('question', 'no-outside-effect', 0.35, 'no effect verb');
  const p = countParties(raw);
  const k = p.systems.length + p.parties.length + p.channels.length + p.emails.length;
  features.multiParty = PARTY_SCORE[Math.min(k, PARTY_SCORE.length - 1)] * (gateParties ? 0.5 : 1);
  evidence.multiParty = [...p.systems.map(s => ({ id: 'system', match: s })), ...p.parties.map(s => ({ id: 'party', match: s })),
    ...p.channels.map(s => ({ id: 'channel', match: s })), ...p.emails.map(s => ({ id: 'email', match: s }))];
  const irr = (() => {
    const hits = [];
    for (const cue of IRREVERSIBLE_C) for (const s of sentences) { cue.re.lastIndex = 0; const m = cue.re.exec(s); if (m) { hits.push({ id: cue.id, w: cue.w, match: m[0].slice(0, 80) }); break; } }
    return { score: noisyOr(hits.map(h => h.w)), hits };
  })();
  applyContext(features, evidence, irr, context ?? {});
  for (const f of FEATURES) features[f] = Math.round(features[f] * 1e6) / 1e6;
  return { features, evidence, irreversible: irr, detector: DETECTOR_VERSION };
}

function applyContext(features, evidence, irr, ctx) {
  const raise = (key, value, why) => { if (value > features[key]) { features[key] = value; evidence[key] = [...evidence[key], { id: 'context', w: value, match: why }]; } };
  if (ctx.recurrence) raise('recurrence', 0.95, `context.recurrence=${ctx.recurrence}`);
  if (ctx.recurrence) raise('reuse', 0.6, 'context.recurrence');
  if (ctx.waits) raise('waits', 0.9, 'context.waits');
  if (ctx.audit) raise('audit', 0.8, 'context.audit');
  if (ctx.reuse) raise('reuse', 0.8, 'context.reuse');
  if (ctx.rules) raise('rules', 0.8, 'context.rules');
  const parties = [...new Set([...(ctx.systems ?? []), ...(ctx.parties ?? [])].map(String))];
  if (parties.length) raise('multiParty', PARTY_SCORE[Math.min(parties.length, PARTY_SCORE.length - 1)], `context: ${parties.join(', ')}`.slice(0, 80));
  if (Number.isFinite(ctx.volume) && ctx.volume > 1) raise('volume', Math.min(0.95, 0.3 + 0.15 * Math.log10(ctx.volume) * 2), `context.volume=${ctx.volume}`);
  if (ctx.irreversible) {
    raise('effects', 0.8, 'context.irreversible');
    if (irr.score < 0.9) { irr.score = 0.9; irr.hits.push({ id: 'context', w: 0.9, match: 'context.irreversible' }); }
  }
}
