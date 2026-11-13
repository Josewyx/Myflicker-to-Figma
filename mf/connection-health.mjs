import {lstat} from 'node:fs/promises'
import {dirname,join} from 'node:path'

const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value)?value:null
export function versionHealth(bridgeVersion,documents=[]){
  const companions=documents.map(d=>({version:version(d.companionVersion),featureVersion:Number.isInteger(d.featureVersion)?d.featureVersion:0}))
  const compatible=companions.every(d=>d.featureVersion>=5)
  const state=!companions.length?'waiting':!compatible?'limited':companions.some(d=>!d.version)?'unknown-version':companions.some(d=>d.version!==bridgeVersion)?'version-mismatch':'ready'
  const messages={waiting:'尚未收到 Figma 连接。先在目标文件运行插件；首次使用才需要导入。',limited:'Figma 配套插件较旧，部分工具不可用。请关闭它，再从 Development 菜单重新运行；仍提示较旧时，重新准备并导入配套文件。','unknown-version':'已连接，但无法确认 Figma 插件版本。建议关闭插件后重新运行，以确认两端版本。','version-mismatch':'两端版本不同，当前工具协议仍兼容。建议关闭 Figma 插件后重新运行；若 Figma 端仍比本地服务新，请更新 MyFlicker 端插件。',ready:'两端版本一致，可以继续操作。'}
  return {state,compatible,bridgeVersion,companions,message:messages[state]}
}
export async function connectionHealth(hub){
  const versions=versionHealth(hub.status().version,hub.list())
  const folder=dirname(hub.companion.importManifest??hub.companion.manifest)
  const missing=[]
  let safeFolder=false
  try{const info=await lstat(folder);safeFolder=info.isDirectory()&&!info.isSymbolicLink()}catch{}
  for(const name of ['manifest.json','code.js','ui.html']){
    try{const info=await lstat(join(folder,name));if(!safeFolder||!info.isFile()||info.isSymbolicLink())missing.push(name)}catch{missing.push(name)}
  }
  return {...versions,filesReady:missing.length===0,missingFiles:missing,needsRepair:missing.length>0,
    message:missing.length?'配套导入文件不完整。点击“重新准备导入文件”，然后按引导重新导入；已有设计不会改变。':versions.message}
}
