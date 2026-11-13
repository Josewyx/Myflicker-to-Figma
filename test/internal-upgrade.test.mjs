import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MfHub} from '../mf/hub.mjs'
import {bridgeToken} from '../lib/storage.mjs'
import {fixtureRuntime,connect,runJob} from './fixtures.mjs'
async function rig(t){
 const home=await mkdtemp(join(tmpdir(),'mf-internal-')),workspace=join(home,'workspace');await mkdir(workspace)
 const hub=await new MfHub({home,port:0,token:await bridgeToken(home),timeoutMs:2000}).initialize()
 const client={id:'internal-client',workspace,binding:null,pending:0},id=await connect(hub,'Synthetic',8),f=await fixtureRuntime()
 t.after(async()=>{await hub.close();await rm(home,{recursive:true,force:true})})
 const call=(name,args={})=>hub.execute(client,name,args)
 const native=async(name,args={})=>{const p=call(name,args);await runJob(hub,id,f.runtime);return p}
 const script=code=>({fileKey:`local:${id}`,description:'Internal test',code})
 return {hub,client,id,f,call,native,script}
}
test('automatic tasks create on the explicit page and bounded layout verification exports no image',async t=>{
 const {f,native,script}=await rig(t),page=f.figma.createPage();let exports=0
 f.figma.createFrame=()=>{const n=f.figma.createRectangle();n.type='FRAME';n.exportAsync=async()=>{exports++;throw Error('No automatic export')};return n}
 const out=await native('use_figma',{...script('const n=figma.createFrame();figma.currentPage.appendChild(n);return {id:n.id,parent:n.parent.id};'),pageId:page.id,verify:{resultPath:'id',layout:true}})
 assert.ok(!out.isError,out.content?.[0]?.text);assert.equal(out.structuredContent.result.parent,page.id)
 assert.ok(out.structuredContent.execution.sessionId);assert.equal(out.structuredContent.verification.state,'structure-read');assert.equal(out.structuredContent.verification.layout.state,'observed');assert.equal(exports,0);assert.ok(!out.content.some(x=>x.type==='image'))
})
test('fonts, semantic reads and batch editing roundtrip through the MF tool catalog',async t=>{
 const {f,native}=await rig(t);const n=f.figma.createRectangle();n.opacity=1;f.page.appendChild(n)
 const fonts=await native('resolve_fonts',{specs:[{family:'Unavailable',fallbacks:['Inter']}]});assert.ok(!fonts.isError,fonts.content?.[0]?.text);assert.equal(fonts.structuredContent.result.resolved[0].got.family,'Inter')
 const batch=await native('batch_edit',{ops:[{type:'set_properties',nodeId:n.id,properties:{opacity:0.5}}]});assert.ok(!batch.isError,batch.content?.[0]?.text);assert.equal(n.opacity,0.5)
 const context=await native('get_design_context',{nodeId:n.id,semantic:true,includeScreenshot:false});assert.ok(!context.isError,context.content?.[0]?.text);assert.ok(!context.content.some(x=>x.type==='image'))
})
test('idempotent creation returns retained result without a second dispatch, foreign operation access is denied',async t=>{
 const {hub,client,id,f,native,call,script}=await rig(t),args={...script('const n=figma.createFrame();figma.currentPage.appendChild(n);return {id:n.id}'),idempotencyKey:'once'}
 const first=await native('use_figma',args);assert.ok(!first.isError,first.content?.[0]?.text)
 const second=await call('use_figma',args);assert.deepEqual(second,first);assert.equal(f.page.children.length,1);assert.equal(hub.documents.get(id).queue.length,0)
 const status=await call('operation_status',{operationId:first.structuredContent.operationId,includeResult:true});assert.equal(status.structuredContent.state,'completed')
 const other=await hub.execute({...client,id:'foreign'},'operation_status',{operationId:first.structuredContent.operationId});assert.equal(other.isError,true)
})
test('readOnly errors preserve an earlier uncertain write and incomplete metadata cannot clear it',async t=>{
 const {hub,id,f,native,script}=await rig(t)
 const failed=await native('use_figma',script('const n=figma.createFrame();figma.currentPage.appendChild(n);throw Error("partial")'));assert.equal(failed.isError,true);assert.equal(hub.documents.get(id).uncertain,true)
 const safe=await native('use_figma',{...script('const n=null;return n.name'),readOnly:true});assert.equal(safe.isError,true);assert.equal(safe.structuredContent.executionState,'read-only');assert.equal(hub.documents.get(id).uncertain,true)
 const short=await native('get_metadata',{nodeId:f.page.id,depth:0,responseMode:'recovery'});assert.equal(short.structuredContent.result.evidence.complete,false);assert.equal(hub.documents.get(id).uncertain,true)
 const full=await native('get_metadata',{nodeId:f.page.id,depth:10,responseMode:'recovery'});assert.equal(full.structuredContent.result.evidence.complete,true);assert.equal(hub.documents.get(id).uncertain,false)
})
test('old protocol fails before new writes and preflight transformations are actually executed',async t=>{
 const {hub,id,f,call,native,script}=await rig(t)
 hub.documents.get(id).featureVersion=5
 const blocked=await call('use_figma',script('return figma.createFrame().id'));assert.equal(blocked.structuredContent.code,'COMPANION_UPDATE_REQUIRED');assert.equal(f.page.children.length,0)
 hub.documents.get(id).featureVersion=8
 const out=await native('use_figma',script(`return figma.getNodeById('${f.page.id}').id`));assert.ok(!out.isError,out.content?.[0]?.text);assert.equal(out.structuredContent.result,f.page.id)
})
test('checkpointed steps preserve their original page and do not rerun completed tasks',async t=>{
 const {hub,id,f,call}=await rig(t),args={action:'start',taskKey:'internal-task',steps:[{tool:'use_figma',args:{code:'const n=figma.createFrame();figma.currentPage.appendChild(n);return {id:n.id}'}}]}
 const work=call('run_steps',args)
 // First job establishes original page; second creates the frame.
 await runJob(hub,id,f.runtime);await runJob(hub,id,f.runtime)
 const out=await work;assert.ok(!out.isError,out.content?.[0]?.text);assert.equal(out.structuredContent.state,'completed');assert.equal(f.page.children.length,1)
 const repeated=await call('run_steps',args);assert.equal(repeated.structuredContent.state,'completed');assert.equal(hub.documents.get(id).queue.length,0)
})
test('design references and explicit design baselines keep editable nodes intact',async t=>{
 const {f,native}=await rig(t),n=f.figma.createFrame();f.page.appendChild(n)
 const reference=await native('set_design_reference',{kind:'frame',nodeId:n.id});assert.ok(!reference.isError,reference.content?.[0]?.text)
 const read=await native('get_design_reference',{});assert.equal(read.structuredContent.result.reference.nodeId,n.id)
 const baseline=await native('design_diff',{nodeId:n.id,action:'create'});assert.ok(!baseline.isError,baseline.content?.[0]?.text)
 n.name='Changed'
 const diff=await native('design_diff',{nodeId:n.id});assert.ok(!diff.isError,diff.content?.[0]?.text);assert.equal(f.page.children.length,1)
})
