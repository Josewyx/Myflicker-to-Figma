import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {HubClient} from './client.mjs'
import {TOOLS,textResult} from './tools.mjs'
import {PACKAGE} from './config.mjs'

export async function startMcp({workspace}={}){
  const client=new HubClient()
  const server=new Server({name:'myflicker-to-figma',version:PACKAGE.version},{capabilities:{tools:{}},instructions:'Local Myflicker-to-Figma bridge. Read myflicker-to-figma skill. For a new conversation silently check figma_connect with waitSeconds:0. If connected, immediately perform the requested task; never make the user send a separate connection prompt or revisit setup. Reuse confirmed connection/task state on follow-ups. Show setupUrl only when needs_user_action, or when the user explicitly asks for setup via figma_setup. Never ask users to configure ports or copy pairing secrets. Users import the companion once and run it in the intended file; they can collapse it, but closing it disconnects. The Agent has no Computer Use. Status/help recover automatically after idle service upgrades; canvas calls are never replayed and targets/tasks must be explicitly reselected after recovery. Use only advertised tool schemas. Create/edit via create_session and use_figma, not invented create_figma_frame tools. figma_connect only accepts waitSeconds. Scripts keep the current page; pass pageId to bind a known target page before writes. Read plugin-api before scripts and motion guides before animation. Finish creation/editing with bounded structural/keyframe readback and brief text. Playback preview and all exports are manual user steps in Figma. Do not automatically call export_animation, download_assets, node.exportAsync or file-writing helpers for delivery/verification, and do not sample video frames. Retained export tools require an explicit user request for an Agent-generated export. No official MCP quota is used.'})
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
