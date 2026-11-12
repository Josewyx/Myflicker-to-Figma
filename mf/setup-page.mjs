import {readFile} from 'node:fs/promises'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import {connectionHealth} from './connection-health.mjs'
import {prepareMfCompanion} from './companion.mjs'
import {openLocal,findDesktopApp} from './platform.mjs'
const html=await readFile(new URL('setup-page.html',import.meta.url),'utf8')
const guideImages=new Map([["/setup/images/01-install.png", "guide-images/01-install.png"], ["/setup/images/02-import-menu.png", "guide-images/02-import-menu.png"], ["/setup/images/03-select-manifest.png", "guide-images/03-select-manifest.png"], ["/setup/images/04-connected.png", "guide-images/04-connected.png"]])
const send=(res,status,value,htmlResponse=false)=>{res.writeHead(status,{'content-type':htmlResponse?'text/html; charset=utf-8':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY',...(htmlResponse?{'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}:{})});res.end(htmlResponse?value:JSON.stringify(value))}
async function body(req){let text='';for await(const part of req){text+=part;if(text.length>2048)throw Error('Request too large')}return JSON.parse(text||'{}')}
export function createSetupPage({hub,reveal=openLocal,launchFigma=async()=>{
  const path=await findDesktopApp('Figma')
  if(!path)throw new Error('Figma desktop not found')
  openLocal(path)
}}){
  let repairing=false
  const nonce=randomBytes(24).toString('hex')
  const validNonce=value=>typeof value==='string'&&Buffer.byteLength(value)===Buffer.byteLength(nonce)&&timingSafeEqual(Buffer.from(value),Buffer.from(nonce))
  return async(req,res)=>{
    const allowedHosts=[`127.0.0.1:${hub.port}`,`localhost:${hub.port}`]
    if(!allowedHosts.includes(req.headers.host))return send(res,403,{error:'Local setup only'})
    const allowedOrigins=allowedHosts.map(h=>'http://'+h)
    if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin))return send(res,403,{error:'Local setup only'})
    if(req.method==='GET'&&guideImages.has(req.url)){
      const bytes=await readFile(new URL(guideImages.get(req.url),import.meta.url))
      res.writeHead(200,{'content-type':'image/png','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);return
    }
    if(req.method==='GET'&&(req.url==='/setup'||req.url==='/setup/'))return send(res,200,html,true)
    if(req.method==='GET'&&req.url==='/setup/status'){
      if(!hub.companion)return send(res,503,{error:'Preparing local connection'})
      const documents=hub.list(),health=await connectionHealth(hub)
      return send(res,200,{health,version:hub.status().version,platform:process.platform,arch:process.arch,connected:documents.length>0,documentCount:documents.length,documentNames:documents.map(d=>d.name),manifest:hub.companion.importManifest??hub.companion.manifest,importFolderName:hub.companion.importFolder?.split('/').pop()??null,actionNonce:nonce})
    }
    if(req.method==='POST'&&['/setup/reveal','/setup/open-figma','/setup/repair'].includes(req.url)){
      if(!String(req.headers['content-type']??'').startsWith('application/json'))return send(res,415,{error:'JSON required'})
      let input;try{input=await body(req)}catch{return send(res,400,{error:'Invalid request'})}
      if(!validNonce(input.nonce))return send(res,403,{error:'请刷新连接向导后重试。'})
      if(req.url==='/setup/repair'){
        if(repairing||hub.list().some(d=>d.busy)||[...(hub.clients?.values()??[])].some(c=>c.pending))return send(res,409,{error:'请等待当前 Figma 操作完成后再准备文件。'})
        repairing=true
        try{hub.companion=await prepareMfCompanion({...hub.config,port:hub.port,token:hub.token});return send(res,200,{prepared:true})}
        catch{return send(res,500,{error:'暂时无法准备导入文件。请让 MyFlicker 检查本地 Figma 插件状态后重试。'})}
        finally{repairing=false}
      }
      if(req.url==='/setup/open-figma'){
        try{await launchFigma();return send(res,200,{opened:true})}catch{return send(res,500,{error:'请手动打开 Figma 桌面端，并进入一个设计文件。'})}
      }
      try{await reveal(hub.companion.importManifest??hub.companion.manifest,{reveal:true});return send(res,200,{opened:true})}catch{return send(res,500,{error:'请在 Figma 文件选择框左侧点“下载”，打开 Myflicker-to-Figma文件夹。'})}
    }
    return send(res,404,{error:'Not found'})
  }
}
