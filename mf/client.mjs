import {spawn} from 'node:child_process'
import {open} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {bridgeToken,privateDirectory,privateJson} from '../lib/storage.mjs'
import {configuration,PROTOCOL,PACKAGE} from './config.mjs'

export async function hubRequest(config,token,path,data={},signal){
  const response=await fetch(`http://127.0.0.1:${config.port}/mf/${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(data),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs+5000)]):AbortSignal.timeout(config.timeoutMs+5000)})
  if(!response.ok){let body={};try{body=await response.json()}catch{}throw Object.assign(new Error(body.error??`Local bridge ${path} failed (${response.status})`),{status:response.status,code:body.code})}
  return response.json()
}
export async function ensureHub(config=configuration()){
  const token=await bridgeToken(config.home)
  const newer=(a,b)=>{
    if(!/^\d+\.\d+\.\d+$/.test(b))throw Object.assign(new Error('无法识别现有本地服务版本，保留该服务。'),{status:409,code:'INCOMPATIBLE_BRIDGE'})
    const aa=a.split('.').map(Number),bb=b.split('.').map(Number)
    for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]>bb[i]
    return false
  }
  const probe=async()=>{
    try{
      const out=await hubRequest(config,token,'health',{},AbortSignal.timeout(1000))
      if(out.product!=='myflicker-to-figma'||out.protocol!==PROTOCOL)throw Object.assign(new Error('此端口不是兼容的 Myflicker-to-Figma 服务。请保留现有服务，使用另一个 MF_FIGMA_PORT。'),{status:409,code:'INCOMPATIBLE_BRIDGE'})
      if(newer(PACKAGE.version,out.version)){
        // Only our authenticated, compatible service may be upgraded. Busy work is preserved.
        if(out.documents?.some(d=>d.busy))throw Object.assign(new Error('当前 Figma 操作尚未完成，请等待完成后再更新连接。'),{status:409,code:'BRIDGE_BUSY'})
        await hubRequest(config,token,'shutdown',{},AbortSignal.timeout(2000))
        await new Promise(r=>setTimeout(r,150));return null
      }
      return out.ready?out:null
    }catch(e){if(e.status&&e.status!==503)throw e;if(e.name==='TimeoutError')throw new Error('本地服务暂时没有响应。请稍后重试；不会中断或重放正在执行的 Figma 操作。');return null}
  }
  try{if(await probe())return {config,token}}catch(e){
    if(config.portExplicit===false&&!config.alternateSelected&&[401,403,409].includes(e.status)&&e.code!=='BRIDGE_BUSY'){
      // Every process for this home picks the same sequence, so simultaneous starts
      // converge on one daemon rather than racing to publish different ports.
      const base=15000+parseInt(createHash('sha256').update(config.home).digest('hex').slice(0,8),16)%20000
      for(let i=0;i<20;i++){
        const candidate={...config,port:base+i,alternateSelected:true}
        try{
          const found=await hubRequest(candidate,token,'health',{},AbortSignal.timeout(500))
          if(found.product!=='myflicker-to-figma'||found.protocol!==PROTOCOL)continue
        }catch(error){if(error.cause?.code!=='ECONNREFUSED')continue}
        await privateJson(join(config.home,'runtime.json'),{port:candidate.port})
        return ensureHub(candidate)
      }
      throw new Error('无法准备本地连接端口。请稍后重新运行安装器；不会关闭其他程序。')
    }
    throw e
  }
  const dir=await privateDirectory(config.home),log=await open(join(dir,'mf-bridge.log'),'a',0o600)
  try{
    const child=spawn(process.execPath,[fileURLToPath(new URL('daemon.mjs',import.meta.url))],{detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,MF_FIGMA_HOME:config.home,MF_FIGMA_PORT:String(config.port),MF_FIGMA_IMPORT_PARENT:config.importParent??''}})
    child.on('error',()=>{});child.unref()
  }finally{await log.close()}
  for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,100));if(await probe())return {config,token}}
  throw new Error('Local bridge did not start. Check '+join(dir,'mf-bridge.log')+'; the port may be occupied.')
}
export class HubClient{
  constructor(config=configuration()){this.config=config}
  async connect(workspace=process.env.MF_FIGMA_WORKSPACE??process.cwd()){
    this.workspace=resolve(workspace)
    const {token,config}=await ensureHub(this.config);this.token=token;this.config=config
    const out=await hubRequest(this.config,token,'open',{workspace:this.workspace})
    this.id=out.clientId
    return this
  }
  async call(name,args={},signal,retried=false){
    const controls=new Set(['figma_status','figma_setup','figma_connect','figma_read_guide','figma_select_document'])
    if(!this.id){
      if(!controls.has(name))throw Object.assign(new Error('连接需要恢复。先调用 figma_status 并明确选择目标文件，再创建新任务；不会自动重放操作。'),{code:'CONNECTION_RESET'})
      await this.connect(this.workspace)
    }
    if(this.recoveryRequired&&!controls.has(name))throw Object.assign(new Error('本地服务已恢复，请先用 figma_select_document 明确选择目标文件，再创建新任务。'),{code:'DOCUMENT_CONFIRMATION_REQUIRED'})
    let result
    try{result=await hubRequest(this.config,this.token,'call',{clientId:this.id,name,arguments:args},signal)}catch(e){
      if(e.status===404||e.cause?.code==='ECONNREFUSED'||e.cause?.code==='ECONNRESET'){
        this.id=null;this.recoveryRequired=true
        // Retry only connection/help/status, never a canvas action or export.
        if(!retried&&['figma_status','figma_setup','figma_connect','figma_read_guide'].includes(name)){await this.connect(this.workspace);return this.call(name,args,signal,true)}
      }
      throw e
    }
    if(name==='figma_select_document'&&!result.isError)this.recoveryRequired=false
    if(this.recoveryRequired&&result.structuredContent){
      const value={...result.structuredContent,documentBinding:{...result.structuredContent.documentBinding,state:'connection-reset',requiresSelection:true}}
      result={...result,structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]}
    }
    return result
  }
  async close(){if(this.id){const id=this.id;this.id=null;await hubRequest(this.config,this.token,'close',{clientId:id}).catch(()=>{})}}
}
