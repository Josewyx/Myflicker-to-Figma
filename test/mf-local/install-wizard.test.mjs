import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {startInstallWizard} from '../../mf/install-wizard.mjs'

async function fixture(t,install){
 const wizard=await startInstallWizard({install,openApp:()=>{}})
 t.after(()=>new Promise(r=>wizard.server.close(r)))
 const state=await (await fetch(wizard.url+'status')).json()
 const post=(path,input={nonce:state.nonce},headers={})=>fetch(wizard.url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})
 return {...wizard,post}
}
async function settled(wizard){
 for(let i=0;i<50;i++){
  const s=await (await fetch(wizard.url+'status')).json()
  if(s.phase!=='installing')return s
  await new Promise(r=>setTimeout(r,10))
 }
 throw new Error('Installer did not settle')
}

test('installer page does not install on load; requires local origin and nonce, serializes work, and reports progress',async t=>{
 let calls=0,finish
 const wizard=await fixture(t,onProgress=>{calls++;onProgress('正在接入 MyFlicker');return new Promise(r=>{finish=r})})
 const page=await fetch(wizard.url)
 assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/)
 assert.equal(calls,0)
 assert.equal((await wizard.post('install',{nonce:'wrong'})).status,403)
 assert.equal((await wizard.post('install',undefined,{origin:'https://evil.example'})).status,403)
 assert.equal((await fetch(wizard.url+'setup.mjs')).status,404)
 assert.equal((await wizard.post('install')).status,202)
 assert.equal(calls,1)
 assert.equal((await (await fetch(wizard.url+'status')).json()).progress,'正在接入 MyFlicker')
 assert.equal((await wizard.post('install')).status,409)
 finish({setupUrl:'http://127.0.0.1:3057/setup'})
 const state=await settled(wizard);assert.equal(state.phase,'done');assert.equal(state.setupUrl,'http://127.0.0.1:3057/setup')
 assert.equal((await wizard.post('install')).status,200);assert.equal(calls,1)
})

test('installer displays failures, redacts credentials and allows a safe retry; nonlocal redirects are rejected',async t=>{
 let calls=0
 const wizard=await fixture(t,async()=>{
  calls++
  if(calls===1)throw new Error('配对 '+ 'a'.repeat(64))
  return {setupUrl:calls===2?'https://evil.example/setup':'http://127.0.0.1:3057/setup'}
 })
 await wizard.post('install');let state=await settled(wizard)
 assert.equal(state.phase,'failed');assert.ok(!state.error.includes('a'.repeat(64)));assert.match(state.error,/已隐藏/)
 await wizard.post('install');state=await settled(wizard);assert.equal(state.phase,'failed');assert.match(state.error,/地址无效/)
 await wizard.post('install');state=await settled(wizard);assert.equal(state.phase,'done')
})

test('connection wizard guides import, switches to runtime and confirms actual connections; copy diagnostics excludes file identity',async()=>{
 const html=await readFile(new URL('../../mf/setup-page.html',import.meta.url),'utf8')
 const elements=new Map(),clipboard=[]
 const $=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',dataset:{}});return elements.get(id)}
 let connected=false,reachable=true,compatible=true
 const document={body:{dataset:{}},getElementById:$}
 const state=()=>({version:'test',platform:'darwin',arch:'arm64',health:{state:compatible?'ready':'limited',compatible,filesReady:true,missingFiles:[],companions:connected?[{version:'test',featureVersion:5}]:[],message:'health'},manifest:'/private/manifest.json',actionNonce:'nonce',connected,documentCount:connected?1:0,documentNames:connected?['PRIVATE-FILE']:[]})
 const ctx=vm.createContext({document,navigator:{clipboard:{writeText:async text=>clipboard.push(text)}},fetch:async()=>({ok:reachable,json:async()=>state()}),setTimeout:()=>1,clearTimeout(){}})
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx)
 for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r))
 assert.equal($('copy').disabled,false)
 $('imported').onclick();assert.equal($('import').hidden,true);assert.equal($('run').hidden,false)
 connected=true;await vm.runInContext('refresh()',ctx)
 assert.equal($('done').hidden,false);assert.equal($('run').hidden,true)
 await $('diagnostics').onclick();assert.ok(!clipboard[0].includes('PRIVATE-FILE'));assert.ok(!clipboard[0].includes('/private/'));assert.ok(!clipboard[0].includes('nonce'))
 compatible=false;await vm.runInContext('refresh()',ctx)
 assert.equal($('done').hidden,true);assert.equal($('run').hidden,false)
 compatible=true;await vm.runInContext('refresh()',ctx);assert.equal($('done').hidden,false)
 reachable=false;await vm.runInContext('refresh()',ctx)
 assert.equal($('done').hidden,true);assert.equal(document.body.dataset.connected,'false');assert.equal($('repair').disabled,true)
 reachable=true;connected=false;await vm.runInContext('refresh()',ctx)
 assert.equal($('done').hidden,true);assert.equal($('run').hidden,false)
})

test('a complete visible import folder is prepared without overwriting user folders or following symlinks',async t=>{
 const {mkdtemp,mkdir,writeFile,stat,lstat,symlink,rm}=await import('node:fs/promises')
 const {join}=await import('node:path')
 const {tmpdir}=await import('node:os')
 const {prepareMfCompanion}=await import('../../mf/companion.mjs')
 const dir=await mkdtemp(join(tmpdir(),'mf-visible-import-')),home=join(dir,'state'),downloads=join(dir,'Downloads')
 t.after(()=>rm(dir,{recursive:true,force:true}))
 const existing=join(downloads,'Myflicker-to-Figma（本机专用）')
 await mkdir(existing,{recursive:true});await writeFile(join(existing,'keep.txt'),'user file')
 const target=join(downloads,'Myflicker-to-Figma（本机专用） 2');await symlink(existing,target,'dir')
 const options={home,port:3057,token:'a'.repeat(64),importParent:downloads}
 const companion=await prepareMfCompanion(options)
 assert.equal(companion.importFolder,join(downloads,'Myflicker-to-Figma（本机专用） 3'))
 for(const name of ['manifest.json','code.js','ui.html','LICENSE','README.txt']){
  const info=await stat(join(companion.importFolder,name));assert.ok(info.isFile());assert.equal(info.mode&0o777,0o600)
 }
 assert.ok((await lstat(target)).isSymbolicLink());assert.equal(await readFile(join(existing,'keep.txt'),'utf8'),'user file')
 const manifest=JSON.parse(await readFile(companion.importManifest,'utf8'))
 assert.equal(manifest.main,'code.js');assert.equal(manifest.ui,'ui.html')
 assert.equal((await prepareMfCompanion(options)).importFolder,companion.importFolder)
})
