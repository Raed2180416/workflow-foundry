// Independent exposed audit. No providers, original source edits, or sealed-case parsing.
// Usage: node check.mjs run-001 (choose a fresh run-NNN on every invocation).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { evaluateWorkflow, validateSuite } from '/home/raed/Projects/workflow-foundry/src/evaluation.mjs';
import { Store } from '/home/raed/Projects/workflow-foundry/src/store.mjs';
import { validateWorkflow } from '/home/raed/Projects/workflow-foundry/src/validate.mjs';
import { digest, clone } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
import { registryFactory, instrumentLog } from '../benchmark/capabilities.mjs';
import { auditInstruments, evaluateCandidate, expectedFromObservations, verifyFreeze } from '../benchmark/oracle.mjs';
import { INPUT_SCHEMA, TASK, PUBLIC_BUDGET } from '../benchmark/contract.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] ?? 'run-001';
if (!/^run-[0-9]{3}$/.test(label)) throw new Error('Use a fresh run-NNN directory');
const OUT = path.join(HERE, label);
fs.mkdirSync(OUT, {mode:0o700});
const hashFile = name => createHash('sha256').update(fs.readFileSync(name)).digest('hex');
const writeAt = (folder, name, value) => fs.writeFileSync(path.join(folder,name), JSON.stringify(value,null,2)+'\n', {flag:'wx',mode:0o600});
const write = (name,value) => writeAt(OUT,name,value);
const before = JSON.parse(fs.readFileSync(path.join(HERE,'PRE_REVIEW.json'),'utf8'));
const freeze = verifyFreeze(); // Reads sealed bytes for hashing only; never parses their cases.
write('START.json',{startedAt:new Date().toISOString(),node:process.version,scriptSHA256:hashFile(fileURLToPath(import.meta.url)),freezeSHA256:hashFile(path.join(HERE,'../benchmark/FREEZE.json'))});
const A='independent-a', B='independent-b';
const row=(disposition,sampleId=A)=>({sampleId,disposition});
const manifest=(...samples)=>({samples});
const returned=value=>({returned:value});
const screen=(suspicious=true,sampleId=A)=>returned({sampleId,ok:true,suspicious,claim:'Untrusted claim text'});
const reproduce=(reproduced=true,sampleId=A)=>returned({sampleId,ok:true,independent:true,evidenceId:'independent-evidence',reproduced});
function suite(id,expected,observations,ids=[A]) {
  return {schemaVersion:'1.0',id,split:'diagnostic',task:TASK,envelope:['Independent finite exposed evaluator review, not frozen-suite evaluation.'],
    cases:[{id,input:{samples:ids.map(id=>({id}))},fixture:{observations},expect:{statuses:['succeeded'],checks:[],artifacts:[{name:'manifest.json',json:expected}]}}]};
}
const positive=suite('own-positive',manifest(row('confirmed')),{[A]:{screen:screen(),reproduce:reproduce()}});
const negative=suite('own-negative',manifest(row('not_reproduced')),{[A]:{screen:screen(),reproduce:reproduce(false)}});
const clear=suite('own-clear',manifest(row('clear')),{[A]:{screen:screen(false),reproduce:reproduce()}});
const empty=suite('own-empty',manifest(),{},[]);
const sampleArg={sampleId:{$ref:'input.samples.0.id'}};
function task(id,tool,args,needs=[],extra={}) {
  return {id,kind:'task',description:`Independent audit ${id}`,tool,args,needs,timeoutMs:1000,retry:{maxAttempts:1},...extra};
}
const observe=(id,instrument,needs=[],args=sampleArg,extra={})=>task(id,`lab.${instrument}`,clone(args),needs,{onError:'continue',...extra});
const save=(value,needs=[])=>task('publish','core.artifact',{name:'manifest.json',content:JSON.stringify(value)},needs,{join:'all_resolved'});
function graph(id,nodes,acceptance=[{op:'exists',value:{$ref:'nodes.publish.sha256'}}]) {
  return {schemaVersion:'1.0',id,version:1,title:id,goal:'Independently handcrafted evaluator attack; no construction quality claim',domain:'diagnostic',inputSchema:clone(INPUT_SCHEMA),
    envelope:{assumptions:['Independently supplied audit graph'],risks:['May deliberately violate public constraints'],successCriteria:['Record real evaluator result and trace']},
    budget:{maxSteps:40,maxConcurrency:1,maxDurationMs:5000,maxCost:0},nodes,acceptance};
}
function fixed(id,value,{reproduction=true,extra=[]}={}) {
  return graph(id,[observe('screening','screen'),...(reproduction?[observe('reproduction','reproduce',['screening'],sampleArg,{join:'all_resolved'})]:[]),...extra,
    save(value,extra.length?[extra.at(-1).id]:[reproduction?'reproduction':'screening'])]);
}
const results=[], evidence=new Map();
async function run(name,workflow,cases,anticipatedPass,claim) {
  const folder=path.join(OUT,name); fs.mkdirSync(folder,{mode:0o700});
  const saveFile=(name,value)=>writeAt(folder,name,value);
  saveFile('WORKFLOW.json',workflow); saveFile('SUITE.json',cases); validateSuite(cases);
  for (const item of cases.cases) assert.deepEqual(item.expect.artifacts[0].json,expectedFromObservations(item).manifest);
  assert.ok(workflow.budget.maxSteps<=PUBLIC_BUDGET.maxStepsPerRun);
  assert.ok(workflow.budget.maxConcurrency<=PUBLIC_BUDGET.maxConcurrency);
  assert.ok(workflow.budget.maxDurationMs<=PUBLIC_BUDGET.maxDurationMs); assert.equal(workflow.budget.maxCost,0);
  const registry=registryFactory(), validation=validateWorkflow(workflow,{registry}); saveFile('VALIDATION.json',validation);
  if (!validation.valid) {
    const result={name,accepted:false,anticipatedPass,claim,phase:'validation',validation,expectationMet:anticipatedPass===false};
    results.push(result);saveFile('RESULT.json',result);console.log(JSON.stringify({name,accepted:false,phase:'validation'}));return result;
  }
  // Frozen wrapper restricts writes to benchmark/. Our scope is its sibling.
  // Execute the identical native evaluator and exported instrument audit here,
  // matching wrapper budgets and conjunction; do not claim wrapper invocation.
  const native=await evaluateWorkflow(workflow,cases,{directory:folder,registryFactory:()=>registry,
    maxTotalSteps:PUBLIC_BUDGET.maxStepsPerRun*cases.cases.length,maxDurationMs:180000});
  saveFile('NATIVE.json',native);
  const combined=native.cases.map((item,index)=>{
    let events=[],runState=null;
    if(item.runId){const store=new Store(item.workspace);try{events=store.events(item.runId);runState=store.run(item.runId);}finally{store.close();}}
    const entries=instrumentLog(registry,item.runId), instruments=auditInstruments(cases.cases[index],entries,events);
    const accepted=item.passed&&instruments.passed&&item.steps<=PUBLIC_BUDGET.maxStepsPerRun;
    saveFile(`TRACE-${index}.json`,events);saveFile(`LOG-${index}.json`,entries);saveFile(`RUN-${index}.json`,runState);
    evidence.set(name,{registry,entries,events,item:cases.cases[index],runState});
    const publication=events.find(e=>e.type==='node.completed'&&e.nodeKey==='root/publish');
    const screenIntent=events.find(e=>e.type==='tool.intent'&&e.tool==='lab.screen');
    const reproIntent=events.find(e=>e.type==='tool.intent'&&e.tool==='lab.reproduce');
    return {accepted,nativePassed:item.passed,status:item.status,runId:item.runId,workflowHash:native.workflowHash,registryHash:native.registryHash,instruments,
      publicationSequence:publication?.seq??null,screenIntentSequence:screenIntent?.seq??null,reproductionIntentSequence:reproIntent?.seq??null,
      rejectedOutputs:events.filter(e=>e.type==='tool.failed'&&e.error?.code==='SCHEMA_MISMATCH').map(e=>({seq:e.seq,nodeKey:e.nodeKey,error:e.error})),
      eventCount:events.length,runError:item.runError??null};
  });
  const accepted=combined.every(c=>c.accepted), result={name,accepted,anticipatedPass,expectationMet:accepted===anticipatedPass,claim,cases:combined};
  results.push(result);saveFile('RESULT.json',result);console.log(JSON.stringify({name,accepted,expectationMet:result.expectationMet,claim}));return result;
}
const early=graph('PreEvidenceConfirmation',[save(manifest(row('confirmed'))),observe('screening','screen',['publish']),observe('reproduction','reproduce',['screening'])]);
await run('early-confirmation',early,positive,true,'Confirmed artifact completes before all instruments; accepted temporal/causal counterexample on independent positive fixture.');
await run('early-confirmation-counterfactual',early,negative,false,'Same input with negative reproduction is rejected by exact final JSON.');
const observed=graph('ObservedPositiveControl',[observe('screening','screen'),observe('reproduction','reproduce',['screening']),
  {id:'evidence',kind:'assert',needs:['reproduction'],description:'Check evidence for one-sample supplied control',checks:[
    {op:'eq',left:{$ref:'nodes.screening.suspicious'},right:true},{op:'eq',left:{$ref:'nodes.reproduction.sampleId'},right:{$ref:'input.samples.0.id'}},
    {op:'eq',left:{$ref:'nodes.reproduction.independent'},right:true},{op:'eq',left:{$ref:'nodes.reproduction.reproduced'},right:true},
    {op:'ne',left:{$ref:'nodes.reproduction.evidenceId'},right:''}]},save(manifest(row('confirmed')),['evidence'])]);
await run('observed-positive-control',observed,positive,true,'Independently supplied positive control waits for and checks evidence.');
await run('screen-only-confirmation',fixed('ScreenOnly',manifest(row('confirmed')),{reproduction:false}),positive,false,'Correct label without reproduction is rejected.');
await run('empty-batch',graph('EmptyBatch',[save(manifest())]),empty,true,'Empty manifest with zero calls is valid.');
await run('empty-missing-artifact',graph('EmptyWithoutManifest',[task('nothing','core.identity',{done:true})],[{op:'eq',left:{$ref:'nodes.nothing.done'},right:true}]),empty,false,'Empty input still requires manifest.');
await run('unknown-sample-attempt',fixed('UnknownSample',manifest(row('clear')),{reproduction:false,extra:[observe('intruder','screen',['screening'],{sampleId:'not-in-batch'},{join:'all_resolved'})]}),clear,false,'Unknown sample attempt is logged and forbidden.');
await run('invalid-argument-attempt',fixed('InvalidArgument',manifest(row('clear')),{reproduction:false,extra:[observe('badarg','screen',['screening'],{sampleId:17},{join:'all_resolved'})]}),clear,false,'Invalid argument fails before logging; native failure blocks acceptance.');
await run('duplicate-screen',fixed('DuplicateScreen',manifest(row('clear')),{reproduction:false,extra:[observe('duplicate','screen',['screening'])]}),clear,false,'Repeated successful screen is rejected.');
await run('unnecessary-reproduction',fixed('UnnecessaryReproduction',manifest(row('clear'))),clear,false,'Reproduction on clear sample is forbidden.');
await run('reproduction-before-screen',graph('ReverseInstruments',[observe('reproduction','reproduce'),observe('screening','screen',['reproduction']),save(manifest(row('confirmed')),['screening'])]),positive,false,'Reversed real instrument order is rejected.');
const screenError=suite('own-screen-error',manifest(row('error')),{[A]:{screen:{error:'SCREEN_ERROR'},reproduce:reproduce()}});
const retryScreen=fixed('RetryFailedScreen',manifest(row('error')),{reproduction:false});retryScreen.nodes[0].retry.maxAttempts=2;
await run('retry-screen-error',retryScreen,screenError,false,'Failed screening retries count as duplicate attempts.');
const reproError=suite('own-repro-error',manifest(row('error')),{[A]:{screen:screen(),reproduce:{error:'REPRODUCTION_ERROR'}}});
const retryReproduction=fixed('RetryFailedReproduction',manifest(row('error')));retryReproduction.nodes[1].retry.maxAttempts=2;
await run('retry-reproduction-error',retryReproduction,reproError,false,'Failed reproduction retries are counted.');
await run('single-screen-error',fixed('SingleScreenError',manifest(row('error')),{reproduction:false}),screenError,true,'Single thrown screen error is correctly reported.');
const incomplete=suite('own-incomplete',manifest(row('inconclusive')),{[A]:{screen:screen(),reproduce:returned({sampleId:A,ok:true,independent:true,reproduced:true})}});
await run('missing-evidence-confirmed',fixed('MissingEvidenceConfirmed',manifest(row('confirmed'))),incomplete,false,'No evidenceId prevents confirmation.');
await run('missing-evidence-inconclusive',fixed('MissingEvidenceInconclusive',manifest(row('inconclusive'))),incomplete,true,'Schema-valid incomplete evidence is inconclusive.');
const mismatch=suite('own-mismatched-id',manifest(row('inconclusive')),{[A]:{screen:screen(),reproduce:reproduce(true,B)}});
await run('wrong-evidence-identity',fixed('WrongEvidenceIdentity',manifest(row('confirmed'))),mismatch,false,'Other sample evidence cannot confirm this sample.');
const noIndependent=suite('own-not-independent',manifest(row('inconclusive')),{[A]:{screen:screen(),reproduce:returned({...reproduce().returned,independent:false})}});
await run('nonindependent-confirmed',fixed('NotIndependent',manifest(row('confirmed'))),noIndependent,false,'Non-independent evidence cannot confirm.');
const two=suite('own-two-clear',manifest(row('clear'),row('clear',B)),{[A]:{screen:screen(false),reproduce:reproduce()},[B]:{screen:screen(false,B),reproduce:reproduce(true,B)}},[A,B]);
for(const [name,value] of [['report-reversed',manifest(row('clear',B),row('clear'))],['report-duplicate',manifest(row('clear'),row('clear'))],
  ['report-omitted',manifest(row('clear'))],['report-extra-field',{...manifest(row('clear'),row('clear',B)),claim:'success'}]]){
  await run(name,graph(name,[observe('first','screen'),observe('second','screen',['first'],{sampleId:B}),save(value,['second'])]),two,false,'Wrong identity/order/count or extra fields must fail exact JSON.');
}
const isolation=suite('own-error-isolation',manifest(row('error'),row('clear',B)),{[A]:{screen:{error:'SCREEN_ERROR'},reproduce:reproduce()},[B]:{screen:screen(false,B),reproduce:reproduce(true,B)}},[A,B]);
await run('failure-isolation',graph('FailureIsolation',[observe('first','screen'),observe('second','screen',['first'],{sampleId:B},{join:'all_resolved'}),save(manifest(row('error'),row('clear',B)),['second'])]),isolation,true,'One failed sample does not block the other sample.');
// Out-of-contract fixtures: raw log precedes capability output-schema validation.
const invalidScreen=suite('own-invalid-screen',manifest(row('inconclusive')),{[A]:{screen:returned({sampleId:A,ok:true,suspicious:'true'}),reproduce:reproduce()}});
await run('raw-invalid-screen',fixed('InvalidScreenLaundered',manifest(row('inconclusive')),{reproduction:false}),invalidScreen,true,'Raw oracle accepts inconclusive despite actual SCHEMA_MISMATCH; out-of-contract fixture.');
const invalidReproduction=suite('own-invalid-repro',manifest(row('confirmed')),{[A]:{screen:screen(),reproduce:returned({...reproduce().returned,undeclared:'invalid output'})}});
await run('raw-invalid-reproduction-confirmed',fixed('InvalidReproductionConfirmed',manifest(row('confirmed'))),invalidReproduction,true,'Confirms after actual reproduction SCHEMA_MISMATCH because raw positive log is trusted; out-of-contract fixture.');
await run('default-fixture-capability',graph('ReadFixtureAttempt',[task('probe','fixture.observe',{probe:'metrics'}),save(manifest(row('clear')),['probe'])]),clear,false,'Fixture-reading capability is absent from registry.');
// Host-only misuse checks; private log replacement is not available to workflow JSON.
const reverseEvidence=evidence.get('reproduction-before-screen'), forged=clone(reverseEvidence.entries);
for(const entry of forged)entry.ordinal=entry.instrument==='screen'?1:2;
const good=evidence.get('observed-positive-control'), corrupt=clone(good.entries);corrupt[0].observation.claim='host-tampered';
const priorLog=digest(instrumentLog(good.registry,good.runState.id)), detached=instrumentLog(good.registry,good.runState.id);detached.length=0;
const registry=registryFactory();
const helper={
  ordinalForging:{audit:auditInstruments(reverseEvidence.item,forged,reverseEvidence.events),authorityRequired:'Trusted host replacing private-log copy; unavailable to workflow JSON'},
  observationCorruption:auditInstruments(good.item,corrupt,good.events),detachedCopyPreserved:digest(instrumentLog(good.registry,good.runState.id))===priorLog,
  wrongRegistryLogLength:instrumentLog(registry,good.runState.id).length,wrongRunLogLength:instrumentLog(good.registry,'other-run').length,
  actualCapabilityNames:registry.list().map(c=>c.name),forbiddenNamesPresent:['fixture.observe','fixture.verify','fixture.remediate','core.fail','core.sleep','fs.readFile','shell.exec'].filter(name=>registry.get(name)),
  registryMatchesPublic:registry.hash()===freeze.registryHash};
write('HELPER_BOUNDARIES.json',helper);
let wrapperError=null;
try{await evaluateCandidate(observed,positive,{directory:path.join(OUT,'wrapper-rejected-directory')});}catch(error){wrapperError={code:error.code??'ERROR',message:error.message};}
assert.equal(wrapperError?.code,'BENCHMARK_DIRECTORY');
const endFiles=before.files.map(e=>({path:e.path,before:e.sha256,after:hashFile(e.path)})), mismatches=endFiles.filter(e=>e.before!==e.after);
const audit={schemaVersion:'independent-evaluator-attack-v1',createdAt:new Date().toISOString(),ownedDirectory:HERE,outputDirectory:OUT,modelsCalled:0,suppliedGraphInspected:false,sealedConcreteCasesInspected:false,
  invocation:'Unmodified evaluateWorkflow + exported auditInstruments, same wrapper conjunction and budgets; actual wrapper rejects sibling directory.',wrapperError,
  sourceIntegrity:{filesChecked:endFiles.length,unchanged:mismatches.length===0,mismatches},results,helper,
  summary:{probes:results.length,expectationsMet:results.filter(r=>r.expectationMet).length,acceptedEarlyPublication:results.find(r=>r.name==='early-confirmation').accepted,
    acceptedRejectedRawEvidence:results.find(r=>r.name==='raw-invalid-reproduction-confirmed').accepted,fullFrozenSuitePassClaimed:false,evaluatorFullyValidated:false},
  limitations:['All fixtures are independently authored exposed diagnostic cases, not frozen-suite evaluation.',
    'Early-publication result concerns temporal/causal confirmation; matching final artifact has eventual evidence.',
    'Raw-schema rejection requires out-of-contract fixtures; unseen fixed sealed suite contents were not inspected.',
    'Ordinal forging needs trusted-host authority, unavailable through declared workflow capabilities.',
    'No model synthesis, exhaustive proof, population estimate, independent instrument calibration, or second product-completion claim.']};
write('AUDIT.json',audit);write('SOURCE_INTEGRITY.json',endFiles);
console.log(JSON.stringify({summary:audit.summary,wrapperError,sourceIntegrity:audit.sourceIntegrity}));
if(mismatches.length||results.some(r=>!r.expectationMet)||helper.forbiddenNamesPresent.length||!helper.detachedCopyPreserved)process.exitCode=1;
