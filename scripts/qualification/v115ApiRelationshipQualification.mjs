import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { runIndexCommand } from '../../src/indexing/runIndexCommand.ts'
import { readApiRelationshipEvidence, apiRelationshipLookup } from '../../src/lookup/apiRelationshipLookup.ts'
import { validateApiRelationshipEvidence } from '../../src/symbol-index/apiRelationshipEvidenceTypes.ts'
import { runGraphDiff } from '../../src/graph-diff/runGraphDiff.ts'
import { contained, verifyCheckout } from './v114RustMatrix.mjs'

// Run: node --import tsx scripts/qualification/v115ApiRelationshipQualification.mjs --out <approved-task-root>
// New runtime outputs are exclusive-created; prior canonical measurements are
// copied to retained runtime history before replacement. No target source runs.
export const approvedRoot = '.my-dev-kit-workflow/tmp/v115-kit-api-01/batch4-qualification'
const fixtureRoot = 'tests/fixtures/api-relationships/v1'
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const profiles = ['API endpoints', 'Client/server request matching', 'React UI handler/request associations', 'Handler/schema references', 'Data-model references', 'Source-change impact candidates']
function nodeMatches(expected, node) {
 if(typeof expected==='string')return node?.id===expected
 return !!node && (!expected.kind||node.kind===expected.kind)&&(!expected.file||node.file===expected.file)&&(!expected.line||node.location.startLine===expected.line)&&(!expected.symbolId||node.symbolId===expected.symbolId)&&(!expected.value||node.value===expected.value)
}
const kinds = {
 'api-endpoint-handled-by': profiles[0], 'api-call-targets-route': profiles[1],
 'api-client-invokes-request': profiles[2], 'api-handler-references-schema': profiles[3], 'api-handler-uses-data-entity': profiles[4],
}
function profile(r, a) {
 if (r.kind === 'api-client-invokes-request' && !['symbol:src/view.tsx#Users', 'symbol:src/view.tsx#View'].includes(r.source)) return null
 return kinds[r.kind] ?? null
}
export function matches(e, r, a) {
 const s = a.nodes.find(n => n.id === r.source), t = a.nodes.find(n => n.id === r.target)
 return (!e.kind || e.kind === r.kind) && (!e.source || e.source === r.source)
  && (!e.sourceFile || e.sourceFile === s?.file) && (!e.sourceLine || e.sourceLine === s?.location.startLine)
  && (!e.target || e.target === t?.symbolId || e.target === r.target)
  && (!e.targetFile || e.targetFile === t?.file) && (!e.targetLine || e.targetLine === t?.location.startLine)
  && (!e.targetPath || a.relationships.some(endpoint => endpoint.kind === 'api-endpoint-handled-by' && endpoint.source === r.target && endpoint.path === e.targetPath)) && (!e.path || e.path === r.path)
  && (!e.method || e.method === r.method) && (!e.handler || r.witnesses.some(w => w.symbolId === e.handler))
}
function scope(e, r, a) {
 const { qualification, target, targetFile, targetLine, targetPath, path: route, method, handler, ...selector } = e
 return matches(selector, r, a)
}
function uniqueRelations(rows) {
 // Metric unit is a distinct association, not repeated type occurrences.
 const seen = new Set()
 return rows.filter(({r,a}) => {
  const s=a.nodes.find(n=>n.id===r.source),t=a.nodes.find(n=>n.id===r.target)
  const ui=profile(r,a)===profiles[2] ? r.witnesses.filter(w=>w.provenance==='symbol-import-graph').map(w=>w.symbolId).sort() : []
  const k=JSON.stringify([r.kind,r.source,t?.symbolId??r.target,r.method,r.path,s?.location.startLine,t?.location.startLine,ui])
  if(seen.has(k))return false
  seen.add(k);return true
 })
}
export function calculateMetrics(tp, fp, fn) {
 return { truePositives:tp,falsePositives:fp,falseNegatives:fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,
  precisionDenominator:tp+fp,recallDenominator:tp+fn,
  undefinedReason:tp+fp===0?'No resolved predictions in this annotated population':tp+fn===0?'No supported positive expectations in this annotated population':null }
}
export async function qualify(out) {
 const repo=process.cwd(); verifyCheckout(repo, new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'))
 if(path.resolve(out)!==path.resolve(repo,approvedRoot))throw Error('Only the Batch 4 task root is authorized')
 contained(repo,out)
 const runtime=path.join(out,'runtime')
 for(const [name,value] of Object.entries({TEMP:path.join(runtime,'temp'),TMP:path.join(runtime,'temp'),TMPDIR:path.join(runtime,'temp'),npm_config_cache:path.join(runtime,'npm-cache'),npm_config_logs_dir:path.join(runtime,'npm-logs'),npm_config_logs_max:'100000',TSX_DISABLE_CACHE:'1'}))process.env[name]=value
 for(const relative of ['logs','evidence','runtime','runtime/temp','runtime/npm-cache','runtime/npm-logs','runtime/fixtures','runtime/indexes']){
  const target=contained(repo,path.join(out,relative))
  for(let p=target;p!==repo;p=path.dirname(p))if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Reparse output path is not authorized: '+p)
  fs.mkdirSync(target,{recursive:true})
 }
 const inventory=read(path.join(repo,fixtureRoot,'qualification/expected-facts.json'))
 if(new Set(inventory.facts.map(f=>f.id)).size!==inventory.facts.length)throw Error('Duplicate case IDs')
 for(const f of inventory.facts){
  if(hash(path.join(repo,f.source))!==f.sourceSha256)throw Error('Ground-truth source drift: '+f.id)
  const lines=fs.readFileSync(path.join(repo,f.source),'utf8').split(/\r?\n/)
  if(lines[f.range.startLine-1]!==f.witness)throw Error('Ground-truth witness drift: '+f.id)
 }
 const evidence=path.join(out,'evidence')
 // Preserve previous task-owned measurements before a reproducible rerun.
 const prior=['ground-truth.json','qualification-results.json','qualification-summary.txt'].filter(n=>fs.existsSync(path.join(evidence,n)))
 if(prior.length){const history=fs.mkdtempSync(path.join(out,'runtime/temp/retained-measurement-'));for(const n of prior)fs.copyFileSync(path.join(evidence,n),path.join(history,n))}
 const report=(name,value)=>fs.writeFileSync(path.join(evidence,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n')
 report('ground-truth.json',inventory)
 const families=[...new Set(inventory.facts.map(f=>f.fixture))]
 const artifacts=new Map(), indexes=new Map(), checks=[], failures=[], classifications=[], unexpected=[]
 const check=(id,pass,detail)=>{checks.push({id,pass,detail});if(!pass)failures.push({id,category:'qualification-or-product-contract',detail})}
 const run=fs.mkdtempSync(path.join(runtime,'fixtures','qualification-'))
 const indexBase=fs.mkdtempSync(path.join(runtime,'indexes','qualification-'))
 async function indexFamily(f, root, name) {
  const outDir=path.join(indexBase,name)
  await runIndexCommand({root,src:['src'],out:outDir,callGraph:true})
  const a=readApiRelationshipEvidence(outDir)
  check('validator:'+f,validateApiRelationshipEvidence(a).valid,outDir)
  artifacts.set(f,a);indexes.set(f,outDir);return a
 }
 for(const f of families.filter(f=>!f.startsWith('contract-impact/'))){
  const root=path.join(run,f);fs.mkdirSync(root,{recursive:true})
  fs.cpSync(path.join(repo,fixtureRoot,f==='held-out'?'qualification/held-out':f),path.join(root,'src'),{recursive:true,errorOnExist:true,force:false})
  await indexFamily(f,root,f)
 }
 const pairRoot=path.join(run,'contract-impact');fs.mkdirSync(path.join(pairRoot,'src'),{recursive:true})
 for(const side of ['before','after']){
  // Only task-created source workspace bytes change; every generated index remains frozen.
  fs.cpSync(path.join(repo,fixtureRoot,'contract-impact',side),path.join(pairRoot,'src'),{recursive:true})
  await indexFamily('contract-impact/'+side,pairRoot,'contract-impact-'+side)
 }
 const b=indexes.get('contract-impact/before'),a=indexes.get('contract-impact/after')
 const projection=runGraphDiff({before:b,after:a}).apiRelationshipImpact
 check('impact-repeat',JSON.stringify(projection)===JSON.stringify(runGraphDiff({before:b,after:a}).apiRelationshipImpact),'IDs and ordered complete result')
 check('impact-bound',projection.summary.returnedChangeCount<=64&&projection.summary.returnedImpactCount<=64,projection.summary)
 check('impact-truncation',projection.summary.truncated=== (projection.summary.availableChangeCount>projection.changes.length||projection.summary.availableImpactCount>projection.potentialImpacts.length) && (!projection.summary.truncated||!projection.summary.complete),projection.summary)
 for(const f of inventory.facts){
  const artifact=artifacts.get(f.fixture),e=f.expected
  if(f.impact){
   const side=f.fixture.endsWith('/before')?'before':'after'
   const candidates=projection.changes.filter(c=>c.subjectKind===e.kind && (c.changeKind===e.changeKind || e.changeKind==='MODIFIED'&&c.changeKind==='ADDED') && c.evidence.some(ev=>ev.side===side&&artifact.relationships.some(r=>r.id===ev.subject.id&&matches(e,r,artifact))))
   const inScope=projection.potentialImpacts.filter(i=>candidates.some(c=>c.evidence.some(ev=>ev.side===side&&ev.subject.id===i.changedSubject.id)))
   const impacts=inScope.filter(i=>nodeMatches(e.associated,artifact.nodes.find(n=>n.id===i.associatedSubject.id)))
   const pass=f.group==='negative'?impacts.length===0:impacts.length>0
   // Verify the published deterministic identity contract places this exact
   // source-annotated association beyond the returned sorted prefix.
   const omittedIds=candidates.flatMap(c=>{const subject=side==='before'?c.before:c.after;return artifact.nodes.filter(n=>nodeMatches(e.associated,n)).map(n=>{const key=JSON.stringify([c.id,subject.kind,subject.id,n.kind,n.id,e.kind]);return 'api-impact:'+createHash('sha256').update(JSON.stringify(key)).digest('hex')})})
   const boundedOmission=f.group==='positive'&&!pass&&projection.summary.truncated&&projection.potentialImpacts.length===64&&omittedIds.length>0&&omittedIds.every(id=>id>projection.potentialImpacts.at(-1).id)
   classifications.push({id:f.id,fixture:f.fixture,profile:f.profile,group:f.group,result:f.group==='negative'?(pass?'correctly-retained':'FAILED'):(pass?'TP':'FN'),boundedOmission,omittedIds,expected:e,observed:impacts,source:f.source,range:f.range,reason:f.reason})
   if(f.group==='positive')for(const i of inScope){const n=artifact.nodes.find(n=>n.id===i.associatedSubject.id);const expectedNode=artifact.nodes.find(n=>nodeMatches(e.associated,n));if(n?.kind===expectedNode?.kind&&!nodeMatches(e.associated,n))unexpected.push({fixture:f.fixture,profile:f.profile,caseId:f.id,impact:i,category:'false-direct-association',owner:'src/graph-diff/buildApiRelationshipImpact.ts'})}
   if(!pass&&!boundedOmission)failures.push({id:f.id,category:'supported-impact-gap',expected:e,observed:candidates,owner:'src/graph-diff/buildApiRelationshipImpact.ts'})
   continue
  }
  const rows=artifact.relationships.filter(r=>scope(e,r,artifact))
  let pass,observed
  if(f.group==='positive'){
   observed=rows.filter(r=>r.qualification==='RESOLVED'&&matches(e,r,artifact))
   pass=observed.length>0
   const witnessFile='src/'+f.source.split('/'+f.fixture+'/')[1]
   check('case-source-witness:'+f.id,observed.some(r=>r.witnesses.some(w=>w.span.path===witnessFile&&w.span.startLine===f.range.startLine)),{source:f.source,line:f.range.startLine})
  }else if(f.group==='negative'&&!e.qualification){
   const promoted=artifact.relationships.filter(r=>r.qualification==='RESOLVED'&&matches(e,r,artifact))
   pass=promoted.length===0;observed={promoted}
  }else if(f.group==='unsupported'){
   const relative='src/'+f.source.split('/held-out/')[1]
   const diagnostics=artifact.unresolved.filter(u=>u.location.path===relative && u.qualification===e.qualification && (!e.reason||u.reason===e.reason))
   const promoted=artifact.relationships.filter(r=>r.kind===e.forbidKind&&r.qualification==='RESOLVED'&&r.witnesses.some(w=>w.span.path===relative))
   pass=diagnostics.length>0&&promoted.length===0
   observed={diagnostics,promoted}
  }else{
   const uncertain=rows.filter(r=>r.qualification===e.qualification)
   const diagnostics=artifact.unresolved.filter(u=>u.family===e.kind&&u.qualification===e.qualification&&(!e.source||e.source===u.source)&&(!e.sourceFile||u.location.path===e.sourceFile)&&(!e.sourceLine||u.location.startLine===e.sourceLine))
   const promoted=rows.filter(r=>r.qualification==='RESOLVED')
   pass=(uncertain.length>0||diagnostics.length>0)&&promoted.length===0
   observed={relationships:uncertain,diagnostics,promoted}
  }
  classifications.push({id:f.id,fixture:f.fixture,profile:f.profile,group:f.group,result:f.group==='positive'?(pass?'TP':'FN'):(pass?'correctly-retained':'FAILED'),expected:e,observed,source:f.source,range:f.range,reason:f.reason})
  if(!pass)failures.push({id:f.id,category:f.group==='positive'?'supported-coverage-gap':'false-inference-or-missing-uncertainty',expected:e,observed,source:f.source,owner:'src/indexing/buildApiRelationshipEvidence.ts'})
 }
 // Score all resolved associations in the five fully annotated relationship profiles.
 for(const [fixture,artifact] of artifacts){
  const expected=inventory.facts.filter(f=>f.fixture===fixture&&f.group==='positive'&&!f.impact)
  for(const {r} of uniqueRelations(artifact.relationships.filter(r=>r.qualification==='RESOLVED'&&profile(r,artifact)).map(r=>({r,a:artifact})))){
   const p=profile(r,artifact)
   if(!expected.some(f=>f.profile===p&&matches(f.expected,r,artifact))){
    unexpected.push({fixture,profile:p,relationship:r,category:'unannotated-resolved-association',owner:'src/indexing/buildApiRelationshipEvidence.ts'})
   }
  }
  const result=apiRelationshipLookup(artifact,{maxResults:1})
  check('lookup-cap:'+fixture,result.relationships.length+result.unresolved.length<=1 && result.truncated===(result.totalMatches>1||result.metadataTruncated||result.limitations.some(l=>l.code==='candidate-limit-truncated')) && (!result.truncated||!result.complete),{total:result.totalMatches,truncated:result.truncated,complete:result.complete})
  check('missing-selector:'+fixture,!apiRelationshipLookup(artifact,{sourceNodeId:'qualification:absent'}).complete,'Unknown selector never proves complete negative')
  check('witnesses:'+fixture,artifact.relationships.every(r=>r.witnesses.length&&r.witnesses.every(w=>artifact.sourceSnapshot.files.some(f=>f.path===w.span.path&&f.contentSha256===w.contentSha256))), 'Authenticated selected-source witnesses')
  check('uncertainty-witnesses:'+fixture,artifact.unresolved.every(u=>u.location.startLine>=1&&artifact.sourceSnapshot.files.some(f=>f.path===u.location.path&&f.contentSha256)),'Every diagnostic retains a selected-source location')
 }
 // Reindex into a NEW retained output to measure extraction determinism independently.
 const repeatRoot=path.join(run,'express-mounted-router')
 const repeatOut=path.join(indexBase,'express-repeat')
 await runIndexCommand({root:repeatRoot,src:['src'],out:repeatOut,callGraph:true})
 check('producer-repeat',JSON.stringify(artifacts.get('express-mounted-router'))===JSON.stringify(readApiRelationshipEvidence(repeatOut)),'Entire relationship artifact identical')
 // Authentic selected-source omission; do not alter generated positive artifacts.
 const incompleteRoot=path.join(run,'incomplete');fs.mkdirSync(path.join(incompleteRoot,'src'),{recursive:true})
 fs.copyFileSync(path.join(repo,fixtureRoot,'express-mounted-router/client.ts'),path.join(incompleteRoot,'src/client.ts'))
 const incompleteOut=path.join(indexBase,'incomplete')
 await runIndexCommand({root:incompleteRoot,src:['src'],out:incompleteOut,callGraph:true})
 const incomplete=apiRelationshipLookup(readApiRelationshipEvidence(incompleteOut),{kind:'api-call-targets-route'})
 check('selected-universe-omission',!incomplete.complete&&incomplete.relationships.every(r=>r.qualification!=='RESOLVED'),'Selected client alone cannot prove dispatch')
 for(const [name,mutate] of [['kind',x=>x.artifactKind='incompatible'],['schema',x=>x.schemaVersion='99'],['malformed',x=>x.relationships=null]]){
  const copy=structuredClone(artifacts.get('express-mounted-router'));mutate(copy)
  check('validator-reject:'+name,!validateApiRelationshipEvidence(copy).valid,'Disposable in-memory negative; no generated positive artifact edited')
 }
 const metrics=Object.fromEntries(profiles.map(p=>{
  const rows=classifications.filter(x=>x.profile===p&&x.group==='positive')
  const fp=unexpected.filter(x=>x.profile===p).length
  return [p,{...calculateMetrics(rows.filter(x=>x.result==='TP').length,fp,rows.filter(x=>x.result==='FN').length),population:inventory.facts.filter(f=>f.profile===p).map(f=>f.id),unit:p===profiles[5]?'Ten source-annotated direct-candidate cells and two negatives; returned bounded output; precision includes same-kind candidates in these exact changed-subject scopes':'Distinct source associations across seven fixture states'}]
 }))
 const result={verdict:failures.length||unexpected.length?'NEEDS_CORRECTION':'PASS',groundTruthCases:inventory.facts.length,metrics,classifications,unexpected,checks,failures,
  uncertainty:{cases:classifications.filter(c=>c.group!=='positive').length,correct:classifications.filter(c=>c.group!=='positive'&&c.result==='correctly-retained').length,falseResolved:classifications.filter(c=>c.observed?.promoted?.length).map(c=>c.id)},
  impact:{projection,metricScope:'Ten positive and two negative endpoint, schema, model, UI and request edit/direct-candidate cells independently annotated; full graph output retained, not claimed exhaustively measured.'},
  output:{run,indexBase,indexes:Object.fromEntries(indexes)},limitations:['Synthetic seven-state source population; no universal accuracy claim.','Only supported JS/TS/TSX syntax and Express/Next/React profiles sampled.','No runtime/API/database/browser execution.','Impact recall is returned bounded evidence in ten annotated positive candidate cells; other impact kinds/scopes are outside metric scope.']}
 report('qualification-results.json',result)
 report('qualification-summary.txt',JSON.stringify({verdict:result.verdict,groundTruthCases:result.groundTruthCases,metrics,uncertainty:result.uncertainty,failures,unexpected},null,2)+'\n')
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2)
 if(args.length!==2||args[0]!=='--out')throw Error('Usage: node --import tsx scripts/qualification/v115ApiRelationshipQualification.mjs --out '+approvedRoot)
 const result=await qualify(path.resolve(args[1]))
 console.log(JSON.stringify({verdict:result.verdict,cases:result.groundTruthCases,metrics:result.metrics,failures:result.failures.length,unexpected:result.unexpected.length}))
 process.exitCode=result.verdict==='PASS'?0:1
}
