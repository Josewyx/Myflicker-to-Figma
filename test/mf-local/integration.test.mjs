import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,stat,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {request as httpRequest} from 'node:http'
import {MfHub} from '../../mf/hub.mjs'
import {bridgeToken} from '../../lib/storage.mjs'
import {connect,request,runJob,fixtureRuntime,PNG} from '../fixtures.mjs'

async function setup(t){
  const home=await mkdtemp(join(tmpdir(),'mf-figma-test-')),workspace=join(home,'workspace')
  await mkdir(workspace)
  const hub=await new MfHub({home,port:0,token:await bridgeToken(home),timeoutMs:2000}).initialize()
  t.after(async()=>{await hub.close();await rm(home,{recursive:true,force:true})})
  const open=async()=>{const r=await request(hub,'/mf/open',{workspace});assert.equal(r.status,200);return (await r.json()).clientId}
  const call=async(id,name,args={},signal)=>{const r=await request(hub,'/mf/call',{clientId:id,name,arguments:args},{signal});assert.equal(r.status,200);return r.json()}
  return {home,workspace,hub,open,call}
}
async function taskFor(call,client,id){
  const r=await call(client,'create_session',{fileKey:`local:${id}`,description:'Integration test'})
  assert.ok(!r.isError,r.content?.[0]?.text)
  return {fileKey:`local:${id}`,sessionId:r.structuredContent.sessionId,description:'Integration test'}
}

test('paired companion is private, MF branded, and local endpoints reject unauthenticated/browser calls',async t=>{
  const {hub,open,call}=await setup(t),client=await open()
  const setupResult=await call(client,'figma_setup')
  const manifest=JSON.parse(await readFile(setupResult.structuredContent.manifest,'utf8'))
  assert.equal(manifest.name,'Myflicker-to-Figma')
  assert.deepEqual(manifest.networkAccess.devAllowedDomains,[`http://localhost:${hub.port}`])
  assert.equal((await stat(setupResult.structuredContent.manifest)).mode&0o777,0o600)
  const raw=await readFile(join(setupResult.structuredContent.folder,'code.js'),'utf8')
  assert.ok(raw.includes(hub.token));assert.ok(!JSON.stringify(setupResult).includes(hub.token))
  const pairedUI=await readFile(join(setupResult.structuredContent.folder,'ui.html'),'utf8')
  assert.ok(pairedUI.includes('id="compact"'));assert.ok(!pairedUI.includes('data:image'))
  assert.equal((await request(hub,'/mf/health',{}, {headers:{authorization:'Bearer wrong'}})).status,401)
  assert.equal((await request(hub,'/mf/health',{}, {headers:{authorization:`Bearer ${hub.token}`,origin:'https://www.figma.com'}})).status,403)
  // Node fetch rewrites Host, so use raw HTTP to actually exercise host validation.
  const hostile=await new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port:hub.port,path:'/mf/health',method:'POST',headers:{authorization:`Bearer ${hub.token}`,host:'evil.test'}},res=>{res.resume();resolve(res.statusCode)})
    req.on('error',reject);req.end('{}')
  })
  assert.equal(hostile,403)
})

test('real bridge/runtime roundtrip creates native nodes and returns MCP image blocks and files',async t=>{
  const {hub,workspace,open,call}=await setup(t),client=await open(),id=await connect(hub,'Test',8)
  const f=await fixtureRuntime(),task=await taskFor(call,client,id)
  const pending=call(client,'use_figma',{...task,code:'const f=figma.createFrame(); f.name="MF test"; figma.currentPage.appendChild(f); return {id:f.id,name:f.name};'})
  await runJob(hub,id,f.runtime)
  const created=await pending
  assert.ok(!created.isError,created.content[0].text)
  assert.equal(typeof created.structuredContent.performance.queueMs,'number')
  assert.equal(typeof created.structuredContent.performance.bridgeMs,'number')
  assert.equal(typeof created.structuredContent.performance.runtimeMs,'number')
  assert.ok(!JSON.stringify(created.structuredContent.performance).includes(workspace))
  const nodeId=created.structuredContent.result.id
  assert.equal(f.nodes.get(nodeId).name,'MF test')
  const shot=call(client,'get_screenshot',{nodeId});await runJob(hub,id,f.runtime)
  const screenshot=await shot
  assert.ok(screenshot.content.some(b=>b.type==='image'&&b.mimeType==='image/png'))
  assert.deepEqual(await readFile(screenshot.structuredContent.files[0].path),PNG)
  assert.ok(screenshot.content.some(b=>b.type==='text'&&b.text.includes(screenshot.structuredContent.files[0].path)))
  const exported=call(client,'download_assets',{nodeId,format:'PNG'});await runJob(hub,id,f.runtime)
  const files=(await exported).structuredContent.result.files
  assert.ok(files[0].path.startsWith(join(await realpath(workspace),'.figma','assets')))
  assert.deepEqual(await readFile(files[0].path),PNG)
})

test('sessions do not share targets or task UUIDs; reconnect never changes a binding implicitly',async t=>{
  const {hub,open,call}=await setup(t),a=await open(),b=await open()
  const one=await connect(hub,'One',8),two=await connect(hub,'Two',8)
  assert.equal((await call(a,'get_selection')).isError,true)
  await call(a,'figma_select_document',{connectionId:one});await call(b,'figma_select_document',{connectionId:two})
  const task=await taskFor(call,a,one)
  const wrong=await call(b,'use_figma',{...task,code:'return 1'})
  assert.equal(wrong.isError,true);assert.equal(wrong.structuredContent.safeToRetryWithoutCanvasRead,true)
  const stolen=await call(b,'use_figma',{...task,fileKey:`local:${two}`,code:'return 1'})
  assert.equal(stolen.isError,true)
  await request(hub,'/disconnect',{connectionId:one})
  await connect(hub,'One',8)
  const disconnected=await call(a,'get_selection')
  assert.equal(disconnected.isError,true)
  assert.match(disconnected.structuredContent.error,/disconnected/)
  assert.equal((await call(b,'figma_status')).structuredContent.documentBinding.lastSelected.connectionId,two)
})

test('syntax and workspace errors fail before dispatch, with retry information intact',async t=>{
  const {hub,home,open,call}=await setup(t),client=await open(),id=await connect(hub,'Test',8),task=await taskFor(call,client,id)
  const syntax=await call(client,'use_figma',{...task,code:'const broken = ;'})
  assert.equal(syntax.isError,true);assert.equal(syntax.structuredContent.safeToRetryWithoutCanvasRead,true)
  assert.equal(syntax.structuredContent.diagnostic.stage,'preflight')
  await writeFile(join(home,'outside.png'),PNG)
  const escaped=await call(client,'upload_assets',{files:['../outside.png']})
  assert.equal(escaped.isError,true);assert.equal(escaped.structuredContent.safeToRetryWithoutCanvasRead,true)
  assert.equal(hub.documents.get(id).queue.length,0)
  const invalid=await call(client,'use_figma',{code:'return 1'})
  assert.equal(invalid.isError,true)
})

test('animation export uses native exportAsync and saves encoded output without editor automation',async t=>{
  const {hub,open,call}=await setup(t),client=await open(),id=await connect(hub,'Native export test',8)
  const f=await fixtureRuntime(),frame=f.figma.createFrame();f.page.appendChild(frame)
  const task=await taskFor(call,client,id)
  const bytes=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0])
  let settings
  frame.exportAsync=async input=>{settings=input;return new Uint8Array(bytes)}
  const pending=call(client,'export_animation',{fileKey:task.fileKey,sessionId:task.sessionId,nodeId:frame.id,format:'MP4',width:640,fps:12})
  const job=await runJob(hub,id,f.runtime)
  assert.equal(job.method,'use_figma')
  const result=await pending
  assert.ok(!result.isError,result.content[0].text)
  assert.deepEqual(JSON.parse(JSON.stringify(settings)),{format:'MP4',fps:12,constraint:{type:'WIDTH',value:640},quality:'LOW'})
  assert.equal(result.structuredContent.result.nativeRenderer,true)
  assert.equal(result.structuredContent.result.files[0].mimeType,'video/mp4')
  assert.deepEqual(await readFile(result.structuredContent.result.files[0].path),bytes)
  const invalid=await call(client,'export_animation',{fileKey:task.fileKey,nodeId:frame.id,format:'MP4',fps:8})
  assert.equal(invalid.isError,true);assert.equal(invalid.structuredContent.safeToRetryWithoutCanvasRead,true)
})

test('animation export propagates native availability errors and rejects still images as video',async t=>{
  const {hub,open,call}=await setup(t),client=await open(),id=await connect(hub,'Native export test',8)
  const f=await fixtureRuntime(),frame=f.figma.createFrame();f.page.appendChild(frame)
  const task=await taskFor(call,client,id),args={fileKey:task.fileKey,nodeId:frame.id,format:'MP4'}
  frame.exportAsync=async()=>{throw Error('Native MP4 export is unavailable for this account')}
  const denied=call(client,'export_animation',args);await runJob(hub,id,f.runtime)
  assert.equal((await denied).isError,true)
  assert.equal(hub.documents.get(id).uncertain,false)
  frame.exportAsync=async()=>new Uint8Array(PNG)
  const still=call(client,'export_animation',args);await runJob(hub,id,f.runtime)
  const out=await still
  assert.equal(out.isError,true);assert.match(out.structuredContent.error,/valid MP4 container/)
})

test('interrupted writes create a shared write barrier until an actual full metadata read',async t=>{
  const {hub,open,call}=await setup(t),client=await open(),id=await connect(hub,'Test',8),task=await taskFor(call,client,id)
  const controller=new AbortController()
  const pending=call(client,'use_figma',{...task,code:'return 1'},controller.signal).catch(e=>e)
  const polled=await request(hub,'/poll',{connectionId:id}),job=await polled.json()
  controller.abort();await pending
  for(let i=0;i<30&&!hub.documents.get(id).uncertain;i++)await new Promise(r=>setTimeout(r,10))
  assert.equal(hub.documents.get(id).uncertain,true)
  await request(hub,'/result',{connectionId:id,id:job.id,ok:true,result:{value:1,images:[]}})
  const f=await fixtureRuntime()
  const blocked=call(client,'use_figma',{...task,code:'return 2'})
  const poll=request(hub,'/poll',{connectionId:id})
  const blockedResult=await blocked
  assert.equal(blockedResult.isError,true);assert.match(blockedResult.structuredContent.error,/uncertain/)
  const inspect=call(client,'get_metadata',{})
  const next=await (await poll).json()
  assert.equal(next.method,'get_metadata')
  await request(hub,'/result',{connectionId:id,id:next.id,ok:true,result:await f.runtime.run(next.method,next.args)})
  assert.ok(!(await inspect).isError);assert.equal(hub.documents.get(id).uncertain,false)
})


test('metadata-only screenshot responses fail explicitly instead of claiming visual verification',async t=>{
 const {hub,open,call}=await setup(t),client=await open(),id=await connect(hub,'Missing image',8)
 const pending=call(client,'get_screenshot',{nodeId:'1:2'})
 const job=await (await request(hub,'/poll',{connectionId:id})).json()
 await request(hub,'/result',{connectionId:id,id:job.id,ok:true,result:{value:{id:'1:2',name:'Frame'},images:[]}})
 const result=await pending
 assert.equal(result.isError,true)
 assert.equal(result.structuredContent.code,'SCREENSHOT_MISSING')
 assert.equal(result.structuredContent.safeToRetryWithoutCanvasRead,true)
 assert.equal(result.content.some(block=>block.type==='image'),false)
})


test('old companion writes fail before dispatch and invented tools/arguments give local contract guidance',async t=>{
 const {hub,open,call}=await setup(t),client=await open(),id=await connect(hub,'Old companion',4)
 const result=await call(client,'use_figma',{fileKey:`local:${id}`,sessionId:'not-used',description:'Test',code:'return figma.createFrame().id'})
 assert.equal(result.isError,true);assert.equal(result.structuredContent.code,'COMPANION_UPDATE_REQUIRED');assert.equal(hub.documents.get(id).queue.length,0)
 const unknown=await call(client,'create_figma_frame',{})
 assert.equal(unknown.structuredContent.code,'UNKNOWN_TOOL');assert.match(unknown.structuredContent.error,/use_figma/)
 const invalid=await call(client,'figma_connect',{force:true,allowAssistantBinding:true})
 assert.equal(invalid.structuredContent.code,'INVALID_ARGUMENTS');assert.match(invalid.structuredContent.error,/waitSeconds/)
})
