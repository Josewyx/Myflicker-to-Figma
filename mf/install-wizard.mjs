import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import {fork} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {openLocal,findDesktopApp} from './platform.mjs'

const html=await readFile(new URL('install-page.html',import.meta.url),'utf8')
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version
export function runInstaller(onProgress){
 return new Promise((resolve,reject)=>{
  const child=fork(fileURLToPath(new URL('../setup.mjs',import.meta.url)),['--no-open'],{execPath:process.execPath,execArgv:[],stdio:['ignore','ignore','pipe','ipc']})
  let result,error=''
  child.stderr.on('data',b=>{error=(error+b.toString()).slice(-4000)})
  child.on('message',message=>{
   if(message.type==='progress')onProgress(message.text)
   if(message.type==='installed')result=message.result
   if(message.type==='failed')error=message.error
  })
  child.once('error',reject)
  child.once('exit',code=>code===0&&result?resolve(result):reject(new Error(error.trim()||'安装未完成。请重新打开 MyFlicker 后重试。')))
 })
}
export async function startInstallWizard({install=runInstaller,openApp=openLocal,port=0}={}){
 const nonce=randomBytes(24).toString('hex')
 const state={version,phase:'ready',progress:'等待开始安装',error:'',setupUrl:null}
 const apps={myflicker:await findDesktopApp('MyFlicker'),figma:await findDesktopApp('Figma')}
 let running=false
 const send=(res,status,value,isHtml=false)=>{
  res.writeHead(status,{'content-type':isHtml?'text/html; charset=utf-8':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY',...(isHtml?{'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}:{})})
  res.end(isHtml?value:JSON.stringify(value))
 }
 const server=createServer(async(req,res)=>{
  try{
   const hosts=[`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`]
   if(!hosts.includes(req.headers.host)||req.headers.origin&&!hosts.map(h=>'http://'+h).includes(req.headers.origin))return send(res,403,{error:'Local installer only'})
   if(req.method==='GET'&&req.url==='/')return send(res,200,html,true)
   if(req.method==='GET'&&req.url==='/status')return send(res,200,{...state,nonce,apps:{myflicker:!!apps.myflicker,figma:!!apps.figma}})
   if(req.method!=='POST'||!['/install','/open-myflicker','/open-figma'].includes(req.url))return send(res,404,{error:'Not found'})
   if(!String(req.headers['content-type']??'').startsWith('application/json'))return send(res,415,{error:'JSON required'})
   let text='';for await(const b of req){text+=b;if(text.length>2048)return send(res,413,{error:'Request too large'})}
   let input;try{input=JSON.parse(text)}catch{return send(res,400,{error:'Invalid request'})}
   if(typeof input.nonce!=='string'||Buffer.byteLength(input.nonce)!==Buffer.byteLength(nonce)||!timingSafeEqual(Buffer.from(input.nonce),Buffer.from(nonce)))return send(res,403,{error:'请刷新页面后重试。'})
   if(req.url.startsWith('/open-')){
    const app=apps[req.url.slice(6)]
    if(!app)return send(res,404,{error:'请先将应用安装到“应用程序”目录。'})
    await openApp(app);return send(res,200,{opened:true})
   }
   if(running)return send(res,409,{error:'安装正在进行，请等待完成。'})
   if(state.phase==='done')return send(res,200,{started:false,setupUrl:state.setupUrl})
   running=true;Object.assign(state,{phase:'installing',progress:'正在检查 MyFlicker…',error:''})
   send(res,202,{started:true})
   void (async()=>{
    try{
     const result=await install(text=>{state.progress=String(text).slice(0,400)})
     const target=new URL(result.setupUrl)
     if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.pathname!=='/setup'||!target.port)throw new Error('连接向导地址无效，请重新运行安装器。')
     Object.assign(state,{phase:'done',progress:'MyFlicker 插件已安装',setupUrl:target.href})
    }catch(e){Object.assign(state,{phase:'failed',error:String(e.message).replaceAll(homedir(),'~').replace(/[a-f0-9]{64}/g,'[已隐藏]').slice(-1000),progress:'安装尚未完成'})}
    finally{running=false}
   })()
  }catch{if(!res.headersSent)send(res,500,{error:'无法完成操作，请刷新页面后重试。'})}
 })
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
 // A forgotten setup tab must not leave an installer listening indefinitely.
 const idle=setTimeout(()=>{if(!running)server.close()},30*60*1000);idle.unref()
 server.on('close',()=>clearTimeout(idle))
 return {server,url:`http://127.0.0.1:${server.address().port}/`,state}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--serve')){
  const wizard=await startInstallWizard()
  try{openLocal(wizard.url);process.send?.({url:wizard.url,opened:true})}catch{process.send?.({url:wizard.url,opened:false})}
  process.disconnect?.()
 }else{
  const child=fork(fileURLToPath(import.meta.url),['--serve'],{execPath:process.execPath,execArgv:[],detached:true,stdio:['ignore','ignore','ignore','ipc']})
  const timer=setTimeout(()=>{console.error('未能打开安装向导，请重新运行“开始安装”。');process.exitCode=1;child.disconnect();child.unref()},15000)
  child.once('message',m=>{clearTimeout(timer);console.log((m.opened?'安装向导已打开，此终端窗口可以关闭。':'请在浏览器打开安装向导：')+'\n'+m.url);child.unref()})
  child.once('error',e=>{clearTimeout(timer);console.error(e.message);process.exitCode=1})
 }
}
