/* Adapted from Duoasa/DSH-to-Figma, MIT. Connection/recovery semantics retained. */

const base='http://localhost:3057', button=document.querySelector('#connect'), status=document.querySelector('#status')
let endpoint=base,token='',connectionId=null,metadata=null,active=false,inFlight=null,desired=true,connecting=false,blocked=false,generation=0,retryTimer=null,retries=0
// Figma's opaque-origin UI exposes getRandomValues, but not randomUUID.
function newClientId(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`}
const clientId=newClientId(),pending=new Map()
const show=(text,state='connecting')=>{status.textContent=text.split(' / ')[0];document.body.dataset.notice=/操作失败|请等待|正在构建/.test(text)?'true':'false';document.body.dataset.state=state;document.querySelector('#hint').textContent=state==='paused'?'展开连接设置后可恢复连接':'关闭会断开连接，收起不会。';document.querySelector('#state-label').textContent=({connected:'已连接',connecting:'连接中',paused:'已暂停',blocked:'需要检查',unpaired:'等待配对'})[state]}
async function request(path,data,timeout=25000){const response=await fetch(endpoint+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(timeout)});const value=await response.json();if(!response.ok){const error=new Error(value.error||'Bridge unavailable');error.status=response.status;throw error}return value}
function schedule(){clearTimeout(retryTimer);if(desired&&!blocked&&token){const delay=Math.min(10000,1000*2**Math.min(retries++,4));retryTimer=setTimeout(()=>void connect(),delay)}}
function fail(error){active=false;button.disabled=false;if(inFlight){blocked=true;desired=false;show('连接在执行中中断，操作不会重放。请重新打开插件，并先让 MyFlicker 检查画布。 / Interrupted during an operation; reopen and inspect before editing.','blocked');button.textContent='请重新打开插件 / Reopen plugin';button.disabled=true;return}if(error.status===401){desired=false;show('配对已失效。回到 MyFlicker 说“连接本地 Figma”，在向导点“重新准备导入文件”，然后关闭此插件，从下载目录重新导入并运行。 / Pairing expired; use figma_setup.','unpaired');button.textContent='重试 / Retry';return}show('正在等待 Myflicker-to-Figma 本地服务，将自动重连。可回到 MyFlicker 说“连接 Figma”。 / Waiting for local MyFlicker; reconnecting automatically.');button.textContent='立即重试 / Retry now';schedule()}
async function connect(){if(connecting||active||blocked||!desired||!metadata||!token)return;clearTimeout(retryTimer);connecting=true;button.disabled=true;const attempt=++generation
 try{
  if(connectionId){try{await request('/heartbeat',{connectionId},5000)}catch(error){if(error.status!==404&&error.status!==410)throw error;connectionId=null}}
  if(!connectionId){let fileKey=metadata.fileKey||null;const value=document.querySelector('#file').value.trim();if(!fileKey&&value){const url=new URL(value);if(!['figma.com','www.figma.com'].includes(url.hostname)||!['design','file','board','slides'].includes(url.pathname.split('/')[1]))throw new Error('Invalid Figma file URL');fileKey=url.pathname.split('/')[2];if(!/^[A-Za-z0-9]{5,128}$/.test(fileKey))throw new Error('Invalid Figma file URL')}
   const result=await request('/connect',{name:metadata.name,editorType:metadata.editorType,fileKey,clientId,featureVersion:metadata.featureVersion,capabilities:metadata.capabilities,companionVersion:metadata.companionVersion},5000);connectionId=result.connectionId}
  if(attempt!==generation||!desired)return
  active=true;retries=0;button.textContent='暂停连接 / Pause';show('可以回到 MyFlicker 开始操作。请保持此窗口打开。 / Ready. Return to MyFlicker; keep this window open.','connected');void poll(attempt)
 }catch(error){if(attempt===generation&&desired)fail(error)}finally{connecting=false;if(!blocked)button.disabled=false}
}
async function poll(epoch){while(active&&desired&&generation===epoch){try{const job=await request('/poll',{connectionId});if(!active||!desired||generation!==epoch)break;if(job.id){inFlight=job.id;show('正在执行 / Running: '+job.method,'connected');const result=await new Promise(resolve=>{pending.set(job.id,resolve);parent.postMessage({pluginMessage:{type:'execute',...job}},'*')});await request('/result',{connectionId,...result});inFlight=null;show(result.ok?'操作完成，等待下一步。 / Done. Ready for the next task.':'操作失败，请让 MyFlicker 检查画布。 / Failed; inspect canvas.','connected')}}catch(error){if(generation===epoch&&desired)fail(error);break}}}
window.onmessage=event=>{if(event.source!==parent&&!(event.source===top&&['https://www.figma.com','https://figma.com'].includes(event.origin)))return;const message=event.data?.pluginMessage;if(!message)return
 if(message.type==='document'){
  metadata={name:message.name,editorType:message.editorType,fileKey:message.fileKey,featureVersion:message.featureVersion,capabilities:message.capabilities,companionVersion:message.companionVersion??null};document.querySelector('#document').textContent=message.name+' · '+message.editorType
  const config=message.connection
  if(config&&/^[a-f0-9]{64}$/.test(config.token)&&Number.isInteger(config.port)&&config.port>=1024&&config.port<=65535){token=config.token;endpoint='http://localhost:'+config.port;document.querySelector('#version').textContent=config.version||'';void connect()}
  else if(!token){show('首次使用：在 MF 中说“帮我连接 Figma”，导入它提供的已配对 manifest，然后运行该插件。 / Ask MyFlicker to prepare the paired companion and import its manifest once.','unpaired');button.textContent='重试 / Retry'}
 }
 if(message.type==='progress'&&inFlight){const nodes=Array.isArray(message.nodes)?message.nodes:[];show(nodes.length?'正在构建：'+nodes.slice(0,2).map(n=>String(n.name).slice(0,40)).join('、')+(nodes.length>2?' 等 '+nodes.length+' 项':'')+' / Building':'正在执行 / Running','connected')}
 if(message.type==='result'){const resolve=pending.get(message.id);if(resolve){pending.delete(message.id);resolve(message)}}
}
parent.postMessage({pluginMessage:{type:'describe'}},'*')
setInterval(()=>{if(active)void request('/heartbeat',{connectionId},5000).catch(()=>{})},10000)
button.onclick=async()=>{
 if(blocked)return
 if(active||connecting){if(inFlight){show('请等待当前操作完成。 / Wait for the current operation.','connected');return}desired=false;active=false;generation++;clearTimeout(retryTimer);try{if(connectionId)await request('/disconnect',{connectionId},5000)}catch{}connectionId=null;button.textContent='恢复连接 / Resume';show('已暂停。点击恢复连接。 / Paused. Click Resume to reconnect.','paused');return}
 desired=true;if(token)void connect();else{document.querySelector('#advanced').open=true;show('推荐使用 MyFlicker 生成的已配对插件。手动连接可在高级设置粘贴密钥。 / Use the paired companion, or enter a token in Advanced.','unpaired')}
}
document.querySelector('#advanced-connect').onclick=()=>{if(active||connecting||inFlight||blocked)return;const value=document.querySelector('#token').value.trim();if(!/^[a-f0-9]{64}$/.test(value)){show('请输入完整的配对密钥。 / Enter the complete pairing token.','unpaired');return}token=value;document.querySelector('#token').value='';desired=true;void connect()}


// Measure actual rendered content so state changes never reserve phantom space.
const advanced=document.querySelector('#advanced'),settings=document.querySelector('#settings')
let lastPanelHeight=0
function resizePanel(){
 const height=Math.ceil(document.querySelector('#panel').getBoundingClientRect().height)
 if(height!==lastPanelHeight){
  lastPanelHeight=height
  parent.postMessage({pluginMessage:{type:'resize',height}},'*')
 }
 settings.setAttribute('aria-expanded',String(advanced.open))
 button.title=button.textContent.split(' / ')[0];button.setAttribute('aria-label',button.title)
}
settings.onclick=()=>{advanced.open=!advanced.open;resizePanel()}
advanced.ontoggle=resizePanel
if(typeof MutationObserver!=='undefined'){
 new MutationObserver(resizePanel).observe(document.body,{attributes:true,attributeFilter:['data-state','data-notice'],subtree:true,childList:true,characterData:true})
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(resizePanel).observe(document.querySelector('#panel'))
 resizePanel()
}

// Collapse the companion without stopping its polling connection.
const compactButton=document.querySelector('#compact');
compactButton.onclick=()=>{const compact=document.body.dataset.compact!=='true';document.body.dataset.compact=String(compact);compactButton.textContent=compact?'展开':'收起';compactButton.setAttribute('aria-label',compact?'展开插件窗口':'收起插件窗口');resizePanel()};
