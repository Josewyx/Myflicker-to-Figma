#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {HubClient,ensureHub,hubRequest} from './client.mjs'
import {TOOLS} from './tools.mjs'
import {configuration} from './config.mjs'
import {bridgeToken} from '../lib/storage.mjs'

const command=process.argv[2]??'help',args=process.argv.slice(3)
async function main(){
  if(['help','--help','-h'].includes(command)){
    console.log('mf-figma mcp | setup [--open] | connect | status [--json] | stop | restart | list-tools | call-tool NAME --args-file PATH | run-script --args-file PATH | install-mf [--cli PATH] [--scope user|project]\nLocal-only. Requires Node 22+, Figma Desktop and a running paired companion. No official MCP/OAuth quota. Figma API permissions still apply.\nMF_FIGMA_HOME defaults to ~/.mf-figma; MF_FIGMA_PORT to 3057. Each CLI command has its own connection; use run-script to create a task and run code together.');return
  }
  if(command==='mcp'){const {startMcp}=await import('./mcp.mjs');await startMcp();return}
  if(command==='list-tools'){console.log(JSON.stringify(TOOLS,null,2));return}
  if(command==='stop'||command==='restart'){
    const config=configuration(),token=await bridgeToken(config.home)
    try{await hubRequest(config,token,'shutdown');console.log('Local bridge stopped. Rerun the Figma companion and explicitly reselect its document.')}catch(e){if(e.cause?.code!=='ECONNREFUSED')throw e;console.log('Local bridge is not running.')}
    if(command==='restart'){await new Promise(r=>setTimeout(r,200));await ensureHub(config);console.log('Local bridge restarted.')}
    return
  }
  if(command==='install-mf'){
    const options={}
    for(let i=0;i<args.length;i++){
      if(args[i]==='--no-open')options.open=false
      else if(['--cli','--scope'].includes(args[i])&&args[i+1])options[args[i].slice(2)]=args[++i]
      else throw new Error('Use --cli PATH, --scope user|project, or --no-open')
    }
    await (await import('./installer.mjs')).installMf(options);return
  }
  if(!['setup','connect','status','call-tool','run-script'].includes(command))throw new Error('Unknown command; use help')
  const client=await new HubClient().connect()
  try{
    let result
    if(command==='run-script'){
      if(args.length!==2||args[0]!=='--args-file')throw new Error('Use run-script --args-file PATH')
      const {connectionId,...input}=JSON.parse(await readFile(resolve(args[1]),'utf8'))
      if(connectionId){const selected=await client.call('figma_select_document',{connectionId});if(selected.isError)throw new Error(selected.structuredContent.error)}
      const task=await client.call('create_session',{fileKey:input.fileKey,description:input.description})
      result=task.isError?task:await client.call('use_figma',{...input,sessionId:task.structuredContent.sessionId})
    }else if(command==='call-tool'){
      if(args.length!==3||args[1]!=='--args-file')throw new Error('Use call-tool NAME --args-file PATH')
      result=await client.call(args[0],JSON.parse(await readFile(resolve(args[2]),'utf8')))
    }else result=await client.call(command==='setup'?'figma_setup':command==='connect'?'figma_connect':'figma_status',command==='status'?{compact:true}:{})
    const images=result.content?.filter(b=>b.type==='image')??[]
    if(images.length){
      const dir=resolve('.figma','screenshots');await mkdir(dir,{recursive:true})
      for(let i=0;i<images.length;i++){const file=join(dir,`${Date.now()}-${i}.png`);await writeFile(file,Buffer.from(images[i].data,'base64'));images[i].path=file;delete images[i].data}
    }
    if(['setup','connect','status'].includes(command)&&!args.includes('--json')){
      const value=result.structuredContent
      if(result.isError)throw new Error(value.error)
      console.log(value.connected||value.documents?.length?'Figma 已连接，可以回到 MF 继续操作。':'等待 Figma 配套插件运行。')
      console.log('连接向导：'+value.setupUrl)
      if(command==='setup')console.log('首次导入后，在目标文件运行 Myflicker-to-Figma；窗口可收起，不要关闭。')
      if(args.includes('--open')){const {openLocal}=await import('./platform.mjs');openLocal(value.setupUrl)}
    }else console.log(JSON.stringify(result,null,2))
    if(result.isError)process.exitCode=1
  }finally{await client.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
