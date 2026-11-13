import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import vm from 'node:vm'
import {MfHub} from '../../mf/hub.mjs'
import {HubClient,ensureHub,hubRequest} from '../../mf/client.mjs'
import {bridgeToken} from '../../lib/storage.mjs'
import {installMf} from '../../mf/installer.mjs'
import {configuration} from '../../mf/config.mjs'
import {connect,request} from '../fixtures.mjs'

async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'mf-onboard-')),workspace=join(home,'workspace'),reveals=[];await mkdir(workspace)
 const hub=await new MfHub({home,port:0,token:await bridgeToken(home),reveal:(...args)=>reveals.push(args)}).initialize()
 t.after(async()=>{await hub.close();await rm(home,{recursive:true,force:true})})
 return {hub,home,workspace,reveals,config:{home,port:hub.port,timeoutMs:2000,portExplicit:true}}
}
test('wizard checks connection without credentials and reveal is local, nonce-protected and path-fixed',async t=>{
 const {hub,reveals}=await fixture(t),base=`http://127.0.0.1:${hub.port}`
 const page=await fetch(base+'/setup');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/)
 let state=await (await fetch(base+'/setup/status')).json();assert.equal(state.connected,false);assert.ok(!JSON.stringify(state).includes(hub.token))
 const post=input=>fetch(base+'/setup/reveal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})
 assert.equal((await post({nonce:'wrong'})).status,403)
 assert.equal((await fetch(base+'/setup/status',{headers:{origin:'https://evil.example'}})).status,403)
 assert.equal((await fetch(base+'/setup/code.js')).status,404)
 assert.match(page.headers.get('content-security-policy'),/img-src 'self'/)
 for(const name of ['01-install','02-import-menu','03-select-manifest','04-connected']){
  const image=await fetch(base+'/setup/images/'+name+'.png');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png')
  assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a')
 }
 assert.equal((await fetch(base+'/setup/images/unknown.png')).status,404)
 assert.equal((await fetch(base+'/setup/images/%2e%2e%2fcompanion/code.js')).status,404)
 assert.equal((await fetch(base+'/setup/images/01-install.png',{headers:{origin:'https://evil.example'}})).status,403)
 assert.equal((await post({nonce:state.actionNonce,path:'/arbitrary/path'})).status,200)
 assert.deepEqual(reveals,[[hub.companion.manifest,{reveal:true}]])
 await connect(hub,'<img src=x onerror=alert(1)>',5)
 state=await (await fetch(base+'/setup/status')).json();assert.equal(state.connected,true);assert.equal(state.documentCount,1)
 assert.equal(state.documentNames[0],'<img src=x onerror=alert(1)>')
 assert.equal([...hub.documents.values()][0].queue.length,0)
})
test('connect waits for the user and client expiry recovers status without replaying canvas actions',async t=>{
 const {hub,config,workspace}=await fixture(t),client=await new HubClient(config).connect(workspace)
 t.after(()=>client.close())
 assert.equal((await client.call('figma_connect')).structuredContent.state,'needs_user_action')
 const waiting=client.call('figma_connect',{waitSeconds:2}),id=await connect(hub,'Example',5)
 const ready=(await waiting).structuredContent
 assert.equal(ready.connected,true);assert.equal(ready.setupUrl,null);assert.equal(ready.showSetupWizard,false);assert.equal(ready.requiresConnectionAction,false)
 const reused=(await client.call('figma_connect')).structuredContent
 assert.equal(reused.connected,true);assert.equal(reused.setupUrl,null);assert.equal(reused.requiresConnectionAction,false)
 // A service upgrade/expired transport has lost its task state, not the user's canvas.
 hub.clients.delete(client.id)
 const recovered=await client.call('figma_status',{compact:true})
 assert.equal(recovered.structuredContent.documentBinding.requiresSelection,true)
 await assert.rejects(client.call('use_figma',{code:'return figma.createFrame()'}),{code:'DOCUMENT_CONFIRMATION_REQUIRED'})
 assert.equal(hub.documents.get(id).queue.length,0)
 await client.call('figma_select_document',{connectionId:id})
 assert.ok(!(await client.call('create_session',{fileKey:`local:${id}`,description:'New task after recovery'})).isError)
 hub.clients.delete(client.id)
 await assert.rejects(client.call('use_figma',{code:'return figma.createFrame()'}),{status:404})
 assert.equal(client.id,null);assert.equal(hub.documents.get(id).queue.length,0)
})
test('busy work prevents automatic service replacement',async t=>{
 const {hub,config}=await fixture(t),id=await connect(hub,'Busy',5)
 hub.documents.get(id).active={id:'pending-operation',settled:true}
 const res=await request(hub,'/mf/shutdown',{})
 assert.equal(res.status,409);assert.equal((await res.json()).code,'BRIDGE_BUSY');assert.equal(hub.stopped,false)
 // Model an older authenticated daemon that rejects an upgrade while busy.
 const original=hub.status.bind(hub);hub.status=(...args)=>({...original(...args),version:'0.1.2'})
 await assert.rejects(ensureHub(config),{code:'BRIDGE_BUSY'})
 assert.equal(hub.stopped,false);hub.documents.get(id).active=null
})
test('an unrelated default-port service is preserved and an alternate port is remembered',async t=>{
 const home=await mkdtemp(join(tmpdir(),'mf-port-'))
 const foreign=createServer((req,res)=>{res.writeHead(401);res.end('{}')})
 await new Promise(r=>foreign.listen(0,'127.0.0.1',r))
 let selected
 t.after(async()=>{if(selected)await hubRequest(selected.config,selected.token,'shutdown').catch(()=>{});await new Promise(r=>foreign.close(r));await rm(home,{recursive:true,force:true})})
 selected=await ensureHub({home,port:foreign.address().port,timeoutMs:2000,portExplicit:false})
 assert.notEqual(selected.config.port,foreign.address().port)
 assert.equal(configuration({MF_FIGMA_HOME:home}).port,selected.config.port)
 assert.equal((await fetch(`http://127.0.0.1:${foreign.address().port}`)).status,401)
 assert.equal((await hubRequest(selected.config,selected.token,'health')).ready,true)
})

test('compact companion keeps polling and delivers a job while collapsed',async()=>{
 const script=await readFile(new URL('../../mf/companion-client.js',import.meta.url),'utf8'),elements=new Map(),messages=[]
 const element=()=>({value:'',textContent:'',setAttribute(){},getBoundingClientRect(){return {height:64}}})
 const document={body:{dataset:{}},querySelector(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}}
 const parent={postMessage:m=>messages.push(m)},window={};let deliver,polls=0
 const ok=value=>({ok:true,status:200,json:async()=>value})
 const ctx=vm.createContext({document,parent,window,top:{},crypto,URL,AbortSignal,setInterval(){},setTimeout(){},clearTimeout(){},fetch:async url=>{
  if(url.endsWith('/connect'))return ok({connectionId:'test'})
  if(url.endsWith('/poll')){polls++;return new Promise(r=>{deliver=r})}
  throw Error('Unexpected endpoint: '+url)
 }})
 vm.runInContext(script,ctx)
 window.onmessage({source:parent,data:{pluginMessage:{type:'document',name:'Canvas',editorType:'figma',connection:{token:'a'.repeat(64),port:3057,version:'test'}}}})
 for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))
 assert.equal(polls,1)
 elements.get('#compact').onclick();assert.equal(document.body.dataset.compact,'true');assert.equal(vm.runInContext('active',ctx),true)
 deliver(ok({id:'job-1',method:'get_metadata',args:{}}))
 for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))
 assert.equal(messages.filter(m=>m.pluginMessage.type==='execute').length,1)
 assert.equal(vm.runInContext('active',ctx),true)
 elements.get('#compact').onclick();assert.equal(document.body.dataset.compact,'false')
})

test('installer copies a clean stable runtime, is repeatable and preserves an installation on preparation failure',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mf-install-')),root=join(dir,'source'),home=join(dir,'state')
 t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(root)
 const pkg={name:'fixture',version:'1.0.0',files:['.mcp.json','public.txt']}
 const writePkg=()=>writeFile(join(root,'package.json'),JSON.stringify(pkg))
 await writePkg();await writeFile(join(root,'package-lock.json'),'{}');await writeFile(join(root,'.mcp.json'),JSON.stringify({mcpServers:{'myflicker-to-figma':{command:'node',args:['entry']}}}))
 await writeFile(join(root,'public.txt'),'hello');await writeFile(join(root,'PRIVATE.txt'),'do not distribute')
 let downloads=0,fail=false
 const run=(cmd,args,{cwd}={})=>{
  if(args[0]==='--help')return {status:0,stdout:'MyFlicker plugin'}
  if(args.join(' ')==='plugin install --help')return {status:0,stdout:'--scope user|project'}
  if(cmd==='npm'){
   downloads++;if(fail)return {status:1}
   // A synchronous spawn stub is enough; access check is done on the next install.
   return {status:0}
  }
  return {status:0,stdout:'{"success":true}'}
 }
 const opts={root,home,cli:'fake-mf',open:false,run,onProgress(){},prepare:async()=>({url:'http://127.0.0.1:3057/setup'})}
 const first=await installMf(opts)
 assert.ok(first.destination.startsWith(home));assert.equal(downloads,1)
 await assert.rejects(access(join(first.destination,'PRIVATE.txt')))
 const mcp=JSON.parse(await readFile(join(first.destination,'.mcp.json'),'utf8'));assert.equal(mcp.mcpServers['myflicker-to-figma'].command,process.execPath)
 await mkdir(join(first.destination,'node_modules','@modelcontextprotocol','sdk'),{recursive:true});await writeFile(join(first.destination,'node_modules','@modelcontextprotocol','sdk','package.json'),'{}')
 await installMf(opts);assert.equal(downloads,1)
 await writeFile(join(root,'public.txt'),'changed same version')
 await assert.rejects(installMf(opts),{code:'IMMUTABLE_VERSION'})
 assert.equal(await readFile(join(first.destination,'public.txt'),'utf8'),'hello')
 pkg.version='1.0.1';await writePkg();fail=true
 await assert.rejects(installMf(opts),/安装步骤失败/)
 assert.equal(await readFile(join(first.destination,'public.txt'),'utf8'),'hello')
 await assert.rejects(access(join(home,'installations','1.0.1')))
})
