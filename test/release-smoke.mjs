// Isolated release check; no real Figma file or user pairing data is used.
import assert from 'node:assert/strict'
import {TOOLS} from '../mf/tools.mjs'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createServer} from 'node:net'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
const root=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const temp=await mkdtemp(join(tmpdir(),'mf-release-check-')),home=join(temp,'state');let client,port,token
try{
 const name=`Myflicker-to-Figma-${pkg.version}`,archive=process.argv[2]??join(root,'releases',pkg.version,name+'.zip')
 assert.equal(spawnSync('/usr/bin/unzip',['-q',archive,'-d',temp]).status,0)
 const plugin=join(temp,name),config=JSON.parse(await readFile(join(plugin,'.mcp.json'),'utf8')).mcpServers['myflicker-to-figma']
 const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));port=listener.address().port;await new Promise(r=>listener.close(r))
 client=new Client({name:'isolated-release-check',version:'1.0'})
 await client.connect(new StdioClientTransport({command:config.command,args:config.args.map(a=>a.replaceAll('${CLAUDE_PLUGIN_ROOT}',plugin)),env:{...process.env,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',MF_FIGMA_HOME:home,MF_FIGMA_PORT:String(port),MF_FIGMA_IMPORT_PARENT:join(temp,'Downloads')},stderr:'pipe'}))
 const list=await client.listTools();assert.equal(list.tools.length,TOOLS.length);assert.ok(list.tools.find(t=>t.name==='use_figma').inputSchema.properties.pageId)
 const call=async(name,args={})=>(await client.callTool({name,arguments:args})).structuredContent
 const waiting=await call('figma_connect');assert.equal(waiting.state,'needs_user_action');assert.ok(waiting.setupUrl)
 const setup=await (await fetch(waiting.setupUrl+'/status')).json();assert.equal(setup.health.filesReady,true)
 token=(await readFile(join(home,'figma/bridge-token'),'utf8')).trim()
 const connected=await fetch(`http://127.0.0.1:${port}/connect`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({name:'Synthetic smoke document',editorType:'figma',featureVersion:8,companionVersion:pkg.version})});assert.equal(connected.status,200)
 const reused=await call('figma_connect');assert.equal(reused.connected,true);assert.equal(reused.setupUrl,null);assert.equal(reused.requiresConnectionAction,false)
 const status=await call('figma_status',{compact:true});assert.equal(status.figmaUseContract.featureVersion,8);assert.equal(status.connectionHealth.compatible,true)
 console.log(JSON.stringify({version:pkg.version,isolatedOfflineStartup:true,tools:TOOLS.length,pageIdSchema:true,pairedFilesReady:true,quietConnectionReuse:true,companionProtocol:8,realFigmaModified:false}))
}finally{
 if(client)await client.close()
 if(token)await fetch(`http://127.0.0.1:${port}/mf/shutdown`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'}).catch(()=>{})
 await rm(temp,{recursive:true,force:true})
}
