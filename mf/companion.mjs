import {mkdir,chmod,lstat,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {privateJson} from '../lib/storage.mjs'
import {PACKAGE,ROOT} from './config.mjs'
import {open,rename,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'

async function privateText(path,text){
  try{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())throw new Error('Companion destination must be a regular file')}catch(e){if(e.code!=='ENOENT')throw e}
  const temporary=path+'.'+randomUUID()+'.tmp'
  try{const f=await open(temporary,'wx',0o600);try{await f.writeFile(text)}finally{await f.close()}await rename(temporary,path)}finally{await rm(temporary,{force:true})}
}
export async function prepareMfCompanion({home,port,token,importParent}){
  if(!Number.isInteger(port)||port<1024||port>65535||!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid local pairing configuration')
  const folder=join(home,'figma','companion')
  await mkdir(folder,{recursive:true,mode:0o700})
  if((await lstat(folder)).isSymbolicLink())throw new Error('Companion directory cannot be a symlink')
  await chmod(folder,0o700)
  const manifest=JSON.parse(await readFile(new URL('companion/manifest.json',ROOT),'utf8'))
  manifest.id='myflicker-to-figma-'+createHash('sha256').update(token).digest('hex').slice(0,12)
  manifest.name='Myflicker-to-Figma'
  manifest.networkAccess.reasoning='Connect only to this computer’s paired Myflicker-to-Figma bridge.'
  manifest.networkAccess.devAllowedDomains=[`http://localhost:${port}`]
  const client=await readFile(new URL('companion-client.js',import.meta.url),'utf8')
  const ui=(await readFile(new URL('companion-ui.html',import.meta.url),'utf8')).replace('/*CLIENT*/',()=>client)
  const code=(await readFile(new URL('companion/code.js',ROOT),'utf8')).replace('Math.max(158, Math.min(520','Math.max(64, Math.min(520').replace('height: 210','height: 128')
  const featherLicense=await readFile(new URL('assets/companion/FEATHER-LICENSE',ROOT),'utf8')
  const files={'FEATHER-LICENSE':featherLicense,'code.js':`globalThis.DSH_FIGMA_BOOTSTRAP = ${JSON.stringify({version:PACKAGE.version,port,token})};\n`+code,'ui.html':ui,'LICENSE':await readFile(new URL('LICENSE',ROOT),'utf8')}
  files['README.txt']=`Myflicker-to-Figma ${PACKAGE.version}\n本机专用配套插件，包含连接凭证，请勿分享或上传。\n首次导入 manifest.json，然后在目标文件运行 Myflicker-to-Figma。\n保持窗口打开；可以“收起”，关闭会断开。\n连接向导：http://127.0.0.1:${port}/setup\nLocal mode uses no official MCP quota. Native Figma permissions still apply.\n`
  for(const [name,value] of Object.entries(files))if(name!=='manifest.json')await privateText(join(folder,name),value)
  await privateJson(join(folder,'manifest.json'),manifest)
  let importManifest=null,importFolder=null
  if(importParent){
    // A complete, per-machine import folder is visible in Downloads. Figma still
    // has to read neighbouring code/UI files, so never export a lone manifest.
    const owner=createHash('sha256').update(home).digest('hex')
    await mkdir(importParent,{recursive:true})
    for(let attempt=0;attempt<20;attempt++){
      const candidate=join(importParent,'Myflicker-to-Figma（本机专用）'+(attempt?' '+(attempt+1):''))
      try{await mkdir(candidate,{mode:0o700})}
      catch(e){
        if(e.code!=='EEXIST')throw e
        const info=await lstat(candidate)
        if(!info.isDirectory()||info.isSymbolicLink())continue
        try{
          const marker=join(candidate,'.mf-import.json'),s=await lstat(marker)
          if(!s.isFile()||s.isSymbolicLink())continue
          const value=JSON.parse(await readFile(marker,'utf8'))
          if(value.product!=='mf-to-figma-import'||value.owner!==owner)continue
        }catch{continue}
      }
      await chmod(candidate,0o700)
      await privateJson(join(candidate,'.mf-import.json'),{product:'mf-to-figma-import',owner})
      for(const [name,value] of Object.entries(files))await privateText(join(candidate,name),value)
      await privateJson(join(candidate,'manifest.json'),manifest)
      importFolder=candidate;importManifest=join(candidate,'manifest.json');break
    }
    if(!importManifest)throw new Error('无法在下载目录准备导入文件夹，请移走旧的同名文件夹后重试。')
  }
  return {manifest:importManifest??join(folder,'manifest.json'),folder:importFolder??folder,importManifest,importFolder,paired:true,private:true,port}
}
