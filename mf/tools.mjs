import Ajv from 'ajv'
import {readFile} from 'node:fs/promises'
import {LOCAL_TOOLS,objectSchema} from '../lib/catalog.mjs'
import {ROOT} from './config.mjs'
const bool={type:'boolean'},str={type:'string'}
export const GUIDES=['workflow','plugin-api','design-to-code','components-variables','assets-scenes','figjam-slides','motion','text-motion','custom-animation-styles','specs']
export const TOOLS=[
  {name:'figma_status',description:'Show this local MF bridge, paired manifest path, connected documents, capabilities and this MCP connection’s document binding. No official Figma MCP or OAuth is used. Status never changes targets.',inputSchema:objectSchema({compact:bool})},
  {name:'figma_setup',description:'Return the private paired Figma companion manifest path. Import it once in Figma Desktop and run Myflicker-to-Figma. Never read or share generated code, tokens, or paired files.',inputSchema:objectSchema()},
  {name:'figma_connect',description:'Silently check/reuse the local connection. When connected, returns setupUrl:null and showSetupWizard:false: proceed immediately with the user task, without another connection prompt. Only when disconnected return a clickable setup wizard, not raw port or credential instructions. Optionally wait up to 60 seconds for the user to run the Figma companion. This never edits a design or uses Computer Use. When connected, continue with tools; after a disconnected binding or multiple documents, explicitly select the target.',inputSchema:objectSchema({waitSeconds:{type:'integer',minimum:0,maximum:60}})},
  {name:'figma_select_document',description:'Explicitly bind this MCP connection to a connected Figma document, including after reconnect. Get connectionId from figma_status. Never guesses a target after disconnect.',inputSchema:objectSchema({connectionId:str},['connectionId'])},
  {name:'figma_read_guide',description:'Read an upstream local Figma execution guide. Read plugin-api before use_figma, motion before keyframes, text-motion before text animation, and custom-animation-styles before reusable motion styles.',inputSchema:objectSchema({topic:{type:'string',enum:GUIDES}},['topic'])},
  {name:'export_animation',description:'Export an actually animated top-level frame through the native Figma Plugin API as MP4, GIF or WebM. Returns a real encoded file saved in the workspace; no Computer Use or official MCP/cloud export_video tool. Requires the paired companion already running. Use this for animation verification: export then inspect sampled frames locally. Account/API restrictions are returned as errors; never fabricate a preview or bypass them. Defaults: MP4, 12 fps, LOW quality, width 640. Include fileKey and the current task sessionId.',inputSchema:objectSchema({nodeId:str,fileKey:str,sessionId:str,format:{type:'string',enum:['MP4','GIF','WEBM']},fps:{type:'integer',enum:[8,12,15,24,30,60]},width:{type:'integer',minimum:32,maximum:1280},quality:{type:'string',enum:['LOW','MEDIUM','HIGH']},loopCount:{type:'integer',minimum:0,maximum:1000}},['nodeId','fileKey'])},
  ...LOCAL_TOOLS.map(t=>({...t,description:(t.name==='get_screenshot'?t.description+' Also saves a real PNG in the workspace and returns its path; missing image data is an explicit error.':t.description).replaceAll('DSH Work','MF MCP connection').replaceAll('DSH','MF'),inputSchema:t.name==='use_figma'?{...t.inputSchema,required:['code','fileKey','sessionId','description']}:t.inputSchema})),
]
const ajv=new Ajv({allErrors:true,strict:false})
const validators=new Map(TOOLS.map(t=>[t.name,ajv.compile(t.inputSchema)]))
export function validateCall(name,args){
  const validate=validators.get(name)
  if(!validate)throw Object.assign(new Error('Unknown local Figma tool: '+name+'. Create/edit with create_session then use_figma; read guides with figma_read_guide. Only use tools advertised by this server. There are no create_figma_frame/set_figma_node_properties/append_figma_node_child tools or use_skill endpoint.'),{code:'UNKNOWN_TOOL'})
  if(!validate(args))throw Object.assign(new Error('Invalid arguments for '+name+': '+ajv.errorsText(validate.errors)+(name==='figma_connect'?'. figma_connect accepts only optional waitSeconds; it does not accept force or allowAssistantBinding.':name==='use_figma'?'. Required: code, fileKey, sessionId, description; optional pageId binds the target page. Do not use _description.':'')),{code:'INVALID_ARGUMENTS'})
  return TOOLS.find(t=>t.name===name)
}
export function textResult(value){return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value&&typeof value==='object'&&!Array.isArray(value)?value:{result:value}}}
export async function readGuide(topic){
  if(!GUIDES.includes(topic))throw new Error('Unknown guide')
  const body=await readFile(new URL(`skills/figma-workbench/references/${topic}.md`,ROOT),'utf8')
  return {content:[{type:'text',text:'MF LOCAL ADAPTER: Use only this server’s tools. There is no DSH host, official remote backend, cloud rendering, OAuth, or official MCP quota. DSH-specific installation commands in upstream references do not apply. Lowercase dsh.* script helpers remain part of the upstream runtime. Calls are serialized per document. Check get_capabilities before gated features; unavailable APIs stay unavailable.\n\n'+body}]}
}
