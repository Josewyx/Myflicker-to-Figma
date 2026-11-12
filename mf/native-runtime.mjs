import {access,cp,lstat,mkdir,mkdtemp,readFile,rename,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {homedir} from 'node:os'
import {copyPackage,packageFiles,packageFingerprint} from './package-files.mjs'
import {privateDirectory,privateJson} from '../lib/storage.mjs'
import {unpackDependencies} from './dependency-bundle.mjs'

const dependencies=['@modelcontextprotocol/sdk/package.json','@modelcontextprotocol/sdk/dist/esm/server/index.js','ajv/package.json','ajv/dist/ajv.js','acorn/package.json','acorn/dist/acorn.js']
async function complete(root){
 try{for(const name of dependencies)await access(join(root,'node_modules',name));return true}catch{return false}
}
async function privateFolder(path){
 await mkdir(path,{recursive:true,mode:0o700})
 if(!(await lstat(path)).isDirectory()||(await lstat(path)).isSymbolicLink())throw new Error('Runtime directory must not be a symlink')
}
export async function ensureNativeRuntime(root,{home=resolve(process.env.MF_FIGMA_HOME??join(homedir(),'.mf-figma'))}={}){
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('MyFlicker 内置 Node 版本过旧，请更新 MyFlicker。')
 // Source installs and legacy stable installations already have dependencies.
 if(await complete(root))return root
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
 const packed=pkg.files?.includes('runtime-payload')
 if(pkg.name!=='myflicker-to-figma'||!/^\d+\.\d+\.\d+$/.test(pkg.version)||!packed&&!pkg.files?.includes('vendor'))throw new Error('请使用完整的 MyFlicker 本地插件发行包；不需要另装 Node 或 npm。')
 const lock=await readFile(join(root,'package-lock.json'))
 const bundle=JSON.parse(await readFile(join(root,packed?'runtime-payload/manifest.json':'vendor/.bundle.json'),'utf8'))
 if(bundle.lockHash!==createHash('sha256').update(lock).digest('hex'))throw new Error('插件依赖校验失败，请重新获取完整发行包。')
 const paths=await packageFiles(root),fingerprint=await packageFingerprint(root,paths)
 const runtimeBase=join(await privateDirectory(home),'runtimes')
 await privateFolder(runtimeBase)
 const parent=join(runtimeBase,pkg.version)
 await privateFolder(parent)
 const destination=join(parent,fingerprint)
 const ready=async()=>{
  let info
  try{info=await lstat(destination)}catch(e){if(e.code==='ENOENT')return false;throw e}
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Runtime destination must be a regular directory')
  try{
   const receipt=JSON.parse(await readFile(join(destination,'.native-runtime.json'),'utf8'))
   if(receipt.fingerprint!==fingerprint||!await complete(destination))throw new Error('本地插件运行文件不完整，请移走损坏的运行目录后重试。')
   return true
  }catch(e){if(e.code==='ENOENT')throw new Error('本地插件运行文件不完整，请移走损坏的运行目录后重试。');throw e}
 }
 if(await ready())return destination
 const staging=await mkdtemp(join(parent,'.preparing-'))
 try{
  await copyPackage(root,staging,paths)
  if(packed)await unpackDependencies(join(staging,'runtime-payload'),join(staging,'node_modules'),bundle.lockHash)
  else await cp(join(staging,'vendor'),join(staging,'node_modules'),{recursive:true})
  if(!await complete(staging))throw new Error('发行包缺少运行依赖，请重新获取完整插件包。')
  await privateJson(join(staging,'.native-runtime.json'),{version:pkg.version,fingerprint})
  try{await rename(staging,destination)}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code)||!await ready())throw e}
 }finally{await rm(staging,{recursive:true,force:true})}
 return destination
}
