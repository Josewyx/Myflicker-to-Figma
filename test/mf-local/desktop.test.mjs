import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {detectMfHost} from '../../mf/platform.mjs'
import {installMf} from '../../mf/installer.mjs'

test('Desktop bundle is used with no CLI on PATH, ahead of an unrelated legacy installation',()=>{
 const seen=[]
 const host=detectMfHost({env:{PATH:'/usr/bin:/bin'},home:'/fixture',platform:'darwin',run:(command,args)=>{
  seen.push([command,args])
  assert.equal(command,'/Applications/MyFlicker.app/Contents/Resources/bin/flick')
  return {status:0,stdout:args[0]==='--help'?'MyFlicker plugin':'--path=<dir> --json'}
 }})
 assert.equal(host.kind,'desktop');assert.equal(seen.length,2)
})

test('custom Desktop location and explicit legacy override use their supported installation interface',()=>{
 const run=(command,args)=>({status:0,stdout:args[0]==='--help'?'MyFlicker plugin':command==='old-mf'?'--scope':'--path=<dir>'})
 assert.equal(detectMfHost({env:{MF_FIGMA_APP:'/Volumes/Apps/MyFlicker.app'},platform:'darwin',run}).command,'/Volumes/Apps/MyFlicker.app/Contents/Resources/bin/flick')
 assert.equal(detectMfHost({explicit:'old-mf',run}).kind,'legacy')
 assert.throws(()=>detectMfHost({env:{},run:()=>({status:1})}),/MyFlicker/)
})

test('Desktop installs through the running client; unavailable client leaves installation untouched',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mf-desktop-')),root=join(dir,'source'),home=join(dir,'state'),calls=[]
 t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(root)
 await writeFile(join(root,'package.json'),JSON.stringify({version:'1.0.0',files:['.mcp.json']}))
 await writeFile(join(root,'package-lock.json'),'{}')
 await writeFile(join(root,'.mcp.json'),JSON.stringify({mcpServers:{'myflicker-to-figma':{command:'node',args:['entry']}}}))
 let ready=false,installed=false,oldEnabled=true,failInstall=false
 const run=(command,args)=>{
  calls.push(args)
  if(args[0]==='--help')return {status:0,stdout:'MyFlicker plugin'}
  if(args.join(' ')==='plugin install --help')return {status:0,stdout:'--path=<dir>'}
  if(args[1]==='list')return {status:ready?0:3,stdout:JSON.stringify({health:{status:'ready'},capability:{localInstall:true},plugins:[...(installed?[{name:'myflicker-to-figma',installationId:'sha256:new',version:'1.0.0',enabled:true,availability:{status:'ready'}}]:[]),{pluginId:'myflicker-to-figma',name:'myflicker-to-figma',installationId:'sha256:old',version:'0.9.0',enabled:oldEnabled}]})}
  if(args[1]==='disable'){assert.equal(args[2],'sha256:old');oldEnabled=false}
  if(args[1]==='enable'){assert.equal(args[2],'sha256:old');oldEnabled=true}
  if(args[1]==='install'){assert.equal(oldEnabled,false);if(failInstall)return {status:1};assert.deepEqual(args.slice(0,3),['plugin','install','--path']);installed=true}
  return {status:0}
 }
 const opts={root,home,cli:'desktop-flick',run,open:false,onProgress(){},prepare:async()=>({url:'http://127.0.0.1:3057/setup'})}
 await assert.rejects(installMf(opts),/MyFlicker 尚未就绪/)
 assert.equal(calls.some(args=>args[0]==='ci'),false)
 ready=true;failInstall=true
 await assert.rejects(installMf(opts),/安装步骤失败/)
 assert.equal(oldEnabled,true);assert.equal(installed,false)
 failInstall=false
 const receipt=await installMf(opts)
 assert.equal(receipt.hostKind,'desktop');assert.equal(installed,true)
 const mcp=JSON.parse(await readFile(join(receipt.destination,'.mcp.json'),'utf8'))
 assert.deepEqual(mcp.mcpServers['myflicker-to-figma'].args,[join(receipt.destination,'mf','bootstrap.mjs')])
 assert.equal(calls.some(args=>args[1]==='marketplace'||args[0]==='call'),false)
 assert.equal(receipt.reloadConfirmed,false);assert.equal(oldEnabled,false)
})
