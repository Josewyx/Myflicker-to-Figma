import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {MfHub} from '../../mf/hub.mjs'
import {bridgeToken} from '../../lib/storage.mjs'
import {connect,runJob,fixtureRuntime} from '../fixtures.mjs'

test('standard MCP stdio client discovers and executes the MF tools without DSH or official MCP',async t=>{
  const home=await mkdtemp(join(tmpdir(),'mf-mcp-test-')),workspace=join(home,'workspace')
  await mkdir(workspace)
  const hub=await new MfHub({home,port:0,token:await bridgeToken(home),timeoutMs:2000}).initialize()
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../mf/bootstrap.mjs',import.meta.url))],cwd:workspace,env:{...process.env,MF_FIGMA_HOME:home,MF_FIGMA_PORT:String(hub.port),MF_FIGMA_WORKSPACE:workspace},stderr:'pipe'})
  const client=new Client({name:'mf-integration-test',version:'1.0.0'})
  let stderr='';transport.stderr?.on('data',b=>{stderr+=b})
  t.after(async()=>{await client.close();await hub.close();await rm(home,{recursive:true,force:true})})
  await client.connect(transport)
  const listed=await client.listTools()
  assert.ok(listed.tools.some(x=>x.name==='use_figma'))
  assert.ok(!listed.tools.some(x=>x.name==='export_video'))
  const status=await client.callTool({name:'figma_status',arguments:{}})
  assert.equal(status.structuredContent.backend,'local');assert.equal(status.structuredContent.officialMcpUsed,false)
  const id=await connect(hub,'Test',5),runtime=await fixtureRuntime()
  const task=await client.callTool({name:'create_session',arguments:{fileKey:`local:${id}`,description:'MCP test'}})
  const result=client.callTool({name:'use_figma',arguments:{fileKey:`local:${id}`,sessionId:task.structuredContent.sessionId,description:'MCP test',code:'return {page:figma.currentPage.id};'}})
  await runJob(hub,id,runtime.runtime)
  assert.equal((await result).structuredContent.result.page,runtime.page.id)
  const bad=await client.callTool({name:'use_figma',arguments:{fileKey:`local:${id}`,sessionId:task.structuredContent.sessionId,description:'MCP test',code:'const x=;'}})
  assert.equal(bad.isError,true)
  assert.equal(bad.structuredContent.safeToRetryWithoutCanvasRead,true)
  assert.equal(stderr,'')
})
