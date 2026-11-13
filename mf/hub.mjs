import {IdempotencyStore} from '../lib/idempotency.mjs'
import {StepTasks} from '../lib/workflows.mjs'
import {readOnlyProgram} from '../lib/readonly-program.mjs'
import {errorDetails} from '../lib/errors.mjs'
import {recoveryResponse} from '../lib/recovery.mjs'
import {variableModeLimitDiagnostic} from '../lib/native-diagnostics.mjs'
import {designSync} from '../lib/design-sync.mjs'
import {scanProject,matchProjectAssets,projectMappings} from '../lib/project-index.mjs'
import {recipes} from '../lib/recipes.mjs'
import {timingSafeEqual} from 'node:crypto'
import {randomUUID} from 'node:crypto'
import {realpath,stat} from 'node:fs/promises'
import {LocalBridge} from '../lib/bridge.mjs'
import {LocalFigmaTasks,FIGMA_USE_CONTRACT} from '../lib/figma-use-contract.mjs'
import {requiredQueryFeatureVersion} from '../lib/catalog.mjs'
import {preflightScript,ScriptPreflightError} from '../lib/script-preflight.mjs'
import {readAssets,saveAssets,localResult} from '../lib/assets.mjs'
import {bridgeToken} from '../lib/storage.mjs'
import {configuration,PACKAGE,PROTOCOL} from './config.mjs'
import {prepareMfCompanion} from './companion.mjs'
import {validateCall,textResult,readGuide} from './tools.mjs'
import {animationSettings,animationScript,validateAnimationAsset} from './animation.mjs'
import {versionHealth} from './connection-health.mjs'
import {createSetupPage} from './setup-page.mjs'

const json=(res,status,value)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value))}}
async function readBody(req){let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>24*1024*1024)throw new Error('Request exceeds 24 MiB');chunks.push(b)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b))

export class MfHub extends LocalBridge{
  constructor(options){super(options);this.config=options;this.clients=new Map();this.tasks=new LocalFigmaTasks();this.idempotency=new IdempotencyStore(options.home);this.stepTasks=new StepTasks(options.home);this.lastUse=Date.now();this.setupPage=createSetupPage({hub:this,reveal:options.reveal})}
  async initialize(){
    await this.start()
    try{this.companion=await prepareMfCompanion({...this.config,port:this.port,token:this.token})}catch(e){await this.close();throw e}
    this.cleanup=setInterval(()=>{
      // Expire abandoned transport state, never an in-flight operation or document.
      for(const [id,c] of this.clients)if(c.pending===0&&Date.now()-c.lastUse>60*60*1000){this.clients.delete(id);this.tasks.close(id)}
      if(!this.clients.size&&!this.documents.size&&Date.now()-this.lastUse>30*60*1000)void this.close()
    },60000);this.cleanup.unref()
    return this
  }
  status(client,{compact=false}={}){
    const documents=this.list().map(d=>({...d,fileKey:d.fileKey??`local:${d.connectionId}`}))
    const previous=client?.binding
    const value={product:'myflicker-to-figma',protocol:PROTOCOL,version:PACKAGE.version,ready:!!this.companion,backend:'local',officialMcpUsed:false,officialMcpQuotaUsed:false,accountPermissionsStillApply:true,bridgePort:this.port,companion:this.companion??null,setupUrl:`http://127.0.0.1:${this.port}/setup`,documents,figmaUseContract:FIGMA_USE_CONTRACT,
      connectionHealth:versionHealth(PACKAGE.version,documents),
      documentBinding:{state:previous?(documents.some(d=>d.connectionId===previous.connectionId)?'connected':'disconnected'):'unbound',lastSelected:previous??null,requiresSelection:previous?!documents.some(d=>d.connectionId===previous.connectionId):documents.length>1},
      limits:'No metered local calls. Figma API/account permissions and technical limits apply. Native export_animation is separate from official cloud export_video.'}
    if(compact){
      value.documents=documents.map(d=>({connectionId:d.connectionId,fileKey:d.fileKey,name:d.name,editorType:d.editorType,busy:d.busy,needsInspection:d.needsInspection,featureVersion:d.featureVersion,companionVersion:d.companionVersion,capabilities:{features:Object.fromEntries(Object.entries(d.capabilities.features).map(([k,v])=>[k,{state:v.state}]))}}))
      value.figmaUseContract={baseline:FIGMA_USE_CONTRACT.baseline,featureVersion:FIGMA_USE_CONTRACT.featureVersion}
    }
    return value
  }
  document(client){
    if(!client.binding){const docs=this.list();if(docs.length!==1)throw Object.assign(new Error(docs.length?'Multiple Figma documents are connected. Select one with figma_select_document.':'Figma 配套插件尚未运行。打开连接向导，在目标文件运行 Myflicker-to-Figma。'),{code:docs.length?'CHOOSE_DOCUMENT':'COMPANION_NOT_RUNNING'});client.binding=docs[0]}
    const doc=this.list().find(d=>d.connectionId===client.binding.connectionId)
    if(!doc)throw new Error('Previously selected document disconnected. Inspect figma_status and explicitly select the intended document again; no automatic switch or replay.')
    return doc
  }
  async execute(client,name,args,signal,internal={}){
    let dispatched=false,lease
    const timing={}
    try{
      const tool=validateCall(name,args)
      if(name==='figma_status')return textResult(this.status(client,args))
      if(name==='figma_setup')return textResult({...this.companion,setupUrl:this.status().setupUrl,instructions:'打开连接向导，在 Figma 文件选择窗口左侧点“下载”，选择 Myflicker-to-Figma（本机专用）中的 manifest.json。首次导入后，在目标文件运行 Myflicker-to-Figma，保持窗口打开或收起。无需用户配置端口、复制密钥或操控电脑。'})
      if(name==='figma_connect'){
        const deadline=Date.now()+1000*(args.waitSeconds??0)
        while(!this.list().length&&Date.now()<deadline){signal?.throwIfAborted();await new Promise(r=>setTimeout(r,250))}
        const status=this.status(client,{compact:true}),connected=status.documents.length>0
        return textResult({connected,state:connected?'connected':'needs_user_action',setupUrl:connected?null:status.setupUrl,showSetupWizard:!connected,requiresConnectionAction:!connected,documents:status.documents,documentBinding:status.documentBinding,connectionHealth:status.connectionHealth,nextAction:connected?(status.documentBinding.requiresSelection?'Use figma_select_document to confirm the intended document.':'Connection is ready. Continue the user task immediately through local tools; do not ask the user to connect again or open setup. Reuse the current task session when available; never close the companion window.'):'请打开连接向导，首次导入后在目标 Figma 文件运行 Myflicker-to-Figma。此步骤由用户完成，Agent 不需要 Computer Use。'})
      }
      if(name==='figma_read_guide')return await readGuide(args.topic)
      if(name==='figma_select_document'){
        if(client.pending)throw new Error('Wait for this connection’s in-flight operations before switching documents')
        const doc=this.list().find(d=>d.connectionId===args.connectionId)
        if(!doc)throw new Error('Document not connected')
        client.binding=doc;return textResult({selected:doc})
      }
      if(tool.hostOnly){
        if(name==='project_index')return textResult(await scanProject(client.workspace,args))
        if(name==='project_match')return textResult(matchProjectAssets(await scanProject(client.workspace,{}),{...args,mappings:(await projectMappings(client.workspace)).mappings}))
        if(name==='project_mappings')return textResult(await projectMappings(client.workspace,args))
        if(name==='local_recipes'){if(args.action==='save')preflightScript(args.code);return textResult(await recipes(client.workspace,args))}
      }
      const doc=this.document(client)
      let wireName=name==='export_animation'?'use_figma':name
      if(doc.featureVersion<requiredQueryFeatureVersion(wireName,args))throw Object.assign(new Error('Figma 配套插件较旧，当前工具不可用。请打开连接向导，先关闭并重新运行 Figma 插件；仍不可用时点击“重新准备导入文件”，重新导入后确认目标文件再继续。'),{code:'COMPANION_UPDATE_REQUIRED'})
      const context=this.tasks.context(client.id,client.workspace,doc,args,name!=='create_session')
      if(name==='create_session')return textResult({...this.tasks.create(client.id,client.workspace,doc,args),scope:'local MF task, scoped to this MCP connection and workspace'})
      if(name==='run_steps'){
        if(args.action==='resolve'&&(doc.busy||doc.needsInspection))throw Object.assign(Error('Inspect affected resources and wait for the active write before resolving this step'),{recovery:{needsInspection:true}})
        return textResult(await this.stepTasks.run([client.id,client.workspace,context.fileKey],args,(method,payload)=>{const {taskPageId,...validated}=payload;return this.execute(client,method,{...validated,...(method==='use_figma'?{fileKey:validated.fileKey??context.fileKey,description:validated.description??'Explicit checkpointed step'}:{})},signal,{taskPageId})}))
      }
      if(tool.mutation&&args.idempotencyKey!==undefined){lease=await this.idempotency.begin([client.id,client.workspace,context.fileKey],args.idempotencyKey,name,args);if(lease.output!==undefined)return lease.output}
      if(name==='operation_status')return textResult(this.operation(doc.connectionId,args.operationId,client.id,args.includeResult))
      if(name==='get_metadata'&&args.responseMode==='recovery'&&(!args.nodeId||args.profile==='summary'||args.offset!==undefined||args.limit!==undefined))throw Error('Recovery response requires affected nodeId, full/default profile and no offset/limit')
      const preparedCode=name==='use_figma'?preflightScript(args.code,{codeLayerCreation:doc.capabilities?.features?.codeLayerCreation?.state}):undefined
      if(name==='use_figma'&&args.verify&&(Boolean(args.verify.nodeId)===Boolean(args.verify.resultPath)||args.verify.resultPath&&!/^(?:\$|[A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(args.verify.resultPath)))throw Error('verify requires exactly one nodeId or resultPath')
      const readProgram=name==='use_figma'&&args.readOnly?readOnlyProgram(preparedCode):undefined
      if(args.readOnly&&args.trackCreated)throw Error('readOnly and trackCreated cannot be combined')
      if(name==='rollback'){const original=this.operation(doc.connectionId,args.operationId,client.id,false);if(original.method!=='use_figma'||original.state!=='failed')throw Error('Rollback requires a failed use_figma operation owned by this MCP connection/file')}

      client.pending++
      try{
        let payload={...args,...(preparedCode!==undefined?{code:preparedCode}:{}),...(readProgram?{readOnlyProgram:readProgram}:{}),...internal}
        if(['get_design_context','get_figjam','get_component_context'].includes(name)&&payload.includeScreenshot===undefined)payload.includeScreenshot=false
        if(name==='design_diff'){wireName='get_design_context';payload={nodeId:args.nodeId,semantic:true,includeScreenshot:false,dedupeStyles:false,dedupeComponents:false,maxNodes:args.maxNodes??1500,maxBytes:args.maxBytes??2097152,depth:30}}

        if(name==='upload_assets')payload={...args,files:undefined,assets:await readAssets(client.workspace,args.files)}
        if(name==='export_animation'){
          payload={code:animationScript(args)}
          preflightScript(payload.code)
        }
        signal?.throwIfAborted()
        const operationId=randomUUID()
        dispatched=true
        const response=await this.call(doc.connectionId,wireName,payload,{signal,mutation:tool.mutation&&!(name==='use_figma'&&args.readOnly),owner:client.id,operationId,...(name==='rollback'?{recoveryOf:args.operationId}:{}),inspect:tool.inspect&&args.profile!=='summary'&&args.offset===undefined&&args.limit===undefined,onMetric:metric=>{for(const key of ['queueMs','bridgeMs'])if(Number.isFinite(metric[key]))timing[key]=Math.round(metric[key]*100)/100}})
        if(name==='design_diff')response.value=await designSync({workspace:client.workspace,fileKey:context.fileKey,nodeId:args.nodeId,snapshot:response.value,captureOptions:payload,action:args.action??'compare',expectedRevision:args.expectedRevision})
        if(name==='get_metadata'&&args.responseMode==='recovery')response.value=recoveryResponse(response.value,response.recovery)
        if(name==='export_animation'){
          validateAnimationAsset(response.assets,animationSettings(args).format)
          response.value={...response.value,files:await saveAssets(client.workspace,response.assets)}
        }
        if(name==='download_assets')response.value={...response.value,files:await saveAssets(client.workspace,response.assets)}
        const files=name==='use_figma'&&response.assets?.length?await saveAssets(client.workspace,response.assets):[]
        if(name==='get_screenshot'&&(!Array.isArray(response.images)||response.images.length!==1))throw Object.assign(new Error('Screenshot response contained no single image. No visual verification was completed; retry get_screenshot or inspect the companion/client connection.'),{code:'SCREENSHOT_MISSING',safeToRetryWithoutCanvasRead:true})
        const out=localResult(response)
        out.structuredContent.operationId=operationId
        if(name==='use_figma')out.structuredContent.execution={fileKey:context.fileKey,sessionId:context.sessionId,description:args.description??null}
        for(const key of ['verification','journal','recovery'])if(response[key]){out.structuredContent[key]=response[key];out.content.push({type:'text',text:JSON.stringify({[key]:response[key]})})}
        const performance={...timing}
        for(const key of ['runtimeMs','exportMs','serializationMs','nodeCount','imageCount','valueBytes'])if(Number.isFinite(response.metrics?.[key])&&response.metrics[key]>=0)performance[key]=Math.round(response.metrics[key]*100)/100
        out.structuredContent.performance=performance
        out.content.push({type:'text',text:JSON.stringify({performance})})
        if(name==='get_screenshot'){
          const screenshots=await saveAssets(client.workspace,response.images.map(image=>({...image,name:'screenshot-'+String(args.nodeId??'node').replace(/[^a-zA-Z0-9_-]/g,'-')+'.png'})))
          out.structuredContent.files=screenshots
          out.content.push({type:'text',text:JSON.stringify({files:screenshots,note:'Actual screenshot saved locally. If the client does not display image attachments, open this PNG; metadata alone is not visual verification.'})})
        }
        if(files.length){out.structuredContent.files=files;out.content.push({type:'text',text:JSON.stringify({files})})}
        if(context.task){context.task.calls++;context.task.files.add(context.fileKey)}
        this.completeOutput(doc.connectionId,operationId,client.id,out.structuredContent)
        if(lease)await this.idempotency.finish(lease,out)
        return out
      }finally{client.pending--}
    }catch(error){
      const value={error:String(error.message??error),safeToRetryWithoutCanvasRead:error.executionState==='unknown'?false:!dispatched||error.safeToRetryWithoutCanvasRead===true,...(error.operationId?{operationId:error.operationId}:{})}
      if(Object.keys(timing).length)value.performance={...timing}
      if(error.code){value.code=error.code;value.setupUrl=this.status().setupUrl}
      if(error instanceof ScriptPreflightError)value.diagnostic={stage:'preflight',...error.diagnostic}
      const nativeDiagnostic=variableModeLimitDiagnostic(error);if(nativeDiagnostic)value.diagnostic=nativeDiagnostic
      Object.assign(value,errorDetails(error,{safe:value.safeToRetryWithoutCanvasRead,diagnostic:value.diagnostic,args}))
      for(const key of ['recovery','cleanup','batchResult','createdNodeIds'])if(error[key])value[key]=error[key]
      const out={...textResult(value),isError:true};if(lease?.id)await this.idempotency.finish(lease,out);return out
    }
  }
  async route(req,res){
    if(req.url==='/setup'||req.url?.startsWith('/setup/'))return this.setupPage(req,res)
    if(!req.url?.startsWith('/mf/'))return super.route(req,res)
    if(this.stopped)return json(res,503,{error:'Bridge stopped'})
    if(![`127.0.0.1:${this.port}`,`localhost:${this.port}`].includes(req.headers.host)||req.headers.origin)return json(res,403,{error:'Local agent requests only'})
    if(!equal(req.headers.authorization,`Bearer ${this.token}`))return json(res,401,{error:'Pairing token required'})
    if(req.method!=='POST')return json(res,405,{error:'POST required'})
    this.lastUse=Date.now()
    const data=await readBody(req)
    if(req.url==='/mf/health')return json(res,200,this.status())
    if(req.url==='/mf/shutdown'){
      if([...this.clients.values()].some(c=>c.pending)||this.list().some(d=>d.busy))return json(res,409,{code:'BRIDGE_BUSY',error:'当前 Figma 操作尚未完成，请等待完成后再更新连接。'})
      json(res,200,{stopping:true});setImmediate(()=>void this.close());return
    }
    if(req.url==='/mf/open'){
      if(!this.companion)return json(res,503,{error:'Preparing companion'})
      if(this.clients.size>=1000)return json(res,429,{error:'Too many concurrent MCP connections'})
      if(typeof data.workspace!=='string')return json(res,400,{error:'Workspace required'})
      const workspace=await realpath(data.workspace),id=randomUUID()
      if(!(await stat(workspace)).isDirectory())return json(res,400,{error:'Workspace must be a directory'})
      this.clients.set(id,{id,workspace,binding:null,pending:0,lastUse:Date.now()})
      return json(res,200,{clientId:id})
    }
    const client=this.clients.get(data.clientId)
    if(!client)return json(res,404,{code:'CLIENT_EXPIRED',error:'本地连接已更新。先调用 figma_status，再明确选择目标文件并创建新的任务会话。'})
    client.lastUse=Date.now()
    if(req.url==='/mf/close'){
      if(client.pending)return json(res,409,{error:'Operations still pending'})
      this.clients.delete(client.id);this.tasks.close(client.id);return json(res,200,{closed:true})
    }
    if(req.url!=='/mf/call')return json(res,404,{error:'Unknown local agent route'})
    const controller=new AbortController()
    res.once('close',()=>{if(!res.writableEnded)controller.abort()})
    return json(res,200,await this.execute(client,data.name,data.arguments??{},controller.signal))
  }
  async close(){clearInterval(this.cleanup);this.tasks.clear();this.clients.clear();await super.close()}
}
export async function startHub(config=configuration()){
  const hub=new MfHub({...config,token:await bridgeToken(config.home)})
  await hub.initialize()
  const close=()=>void hub.close()
  process.once('SIGTERM',close);process.once('SIGINT',close)
  return hub
}
