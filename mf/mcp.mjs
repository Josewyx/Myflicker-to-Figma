import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {HubClient} from './client.mjs'
import {TOOLS,textResult} from './tools.mjs'
import {PACKAGE} from './config.mjs'

export async function startMcp({workspace}={}){
  const client=new HubClient()
  const server=new Server({name:'myflicker-to-figma',version:PACKAGE.version},{capabilities:{tools:{}},instructions:'Local Myflicker-to-Figma bridge. Read myflicker-to-figma skill. Start with figma_connect: give the user its clickable setupUrl only if the companion is not running. Never ask users to configure ports or copy pairing secrets. Users import the companion once and run it in the intended file; they can collapse it, but closing it disconnects. The Agent has no Computer Use. Status/help recover automatically after idle service upgrades; canvas calls are never replayed and targets/tasks must be explicitly reselected after recovery. Read plugin-api before scripts and motion guides before animation. No official MCP quota is used.'})
  let connecting
  const connected=()=>connecting??=(client.connect(workspace).catch(e=>{connecting=undefined;throw e}))
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:TOOLS.map(({name,description,inputSchema})=>({name,description,inputSchema}))}))
  server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
    try{await connected();return await client.call(request.params.name,request.params.arguments??{},extra.signal)}catch(e){return {...textResult({error:e.message,code:e.code??null,safeToRetryWithoutCanvasRead:false}),isError:true}}
  })
  const close=async()=>{await client.close();await server.close()}
  process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());process.stdin.once('end',()=>void client.close())
  await server.connect(new StdioServerTransport())
  return {server,client,close}
}
