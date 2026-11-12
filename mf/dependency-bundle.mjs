import {readFile,writeFile,readdir,lstat,mkdir} from 'node:fs/promises'
import {join,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const safePath=path=>typeof path==='string'&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes('\0')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..')
export async function packDependencies(source,target,lockHash){
 const files=[]
 async function walk(relative=''){
  for(const name of (await readdir(join(source,relative))).sort()){
   if(name==='.bin')continue
   const path=relative?relative+'/'+name:name,info=await lstat(join(source,path))
   if(!safePath(path)||info.isSymbolicLink())throw new Error('Invalid dependency file: '+path)
   if(info.isDirectory())await walk(path)
   else if(info.isFile())files.push({path,data:(await readFile(join(source,path))).toString('base64')})
  }
 }
 await walk()
 const compressed=gzipSync(Buffer.from(JSON.stringify(files)),{level:9}),parts=[]
 await mkdir(target,{recursive:true})
 for(let offset=0;offset<compressed.length;offset+=512*1024){
  const bytes=compressed.subarray(offset,offset+512*1024),name='part-'+String(parts.length).padStart(4,'0')+'.data'
  await writeFile(join(target,name),bytes);parts.push({name,size:bytes.length,sha256:hash(bytes)})
 }
 const manifest={format:'mf-js-dependencies-v1',lockHash,files:files.length,parts}
 await writeFile(join(target,'manifest.json'),JSON.stringify(manifest))
 return manifest
}
export async function unpackDependencies(source,target,lockHash){
 const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'))
 if(manifest.format!=='mf-js-dependencies-v1'||manifest.lockHash!==lockHash||!Array.isArray(manifest.parts)||!manifest.parts.length||manifest.parts.length>128)throw new Error('插件离线依赖清单校验失败。')
 const buffers=[];let compressedSize=0
 for(let i=0;i<manifest.parts.length;i++){
  const part=manifest.parts[i]
  if(part.name!=='part-'+String(i).padStart(4,'0')+'.data'||!Number.isInteger(part.size)||part.size<1||part.size>512*1024)throw new Error('插件离线依赖分块无效。')
  const file=join(source,part.name),info=await lstat(file)
  if(!info.isFile()||info.isSymbolicLink()||info.size!==part.size)throw new Error('插件离线依赖分块缺失或被替换。')
  const bytes=await readFile(file)
  if(hash(bytes)!==part.sha256)throw new Error('插件离线依赖分块校验失败。')
  compressedSize+=bytes.length;if(compressedSize>32*1024*1024)throw new Error('Dependency archive too large')
  buffers.push(bytes)
 }
 const files=JSON.parse(gunzipSync(Buffer.concat(buffers),{maxOutputLength:100*1024*1024}).toString('utf8'))
 if(!Array.isArray(files)||files.length!==manifest.files||files.length>40000)throw new Error('Invalid dependency file inventory')
 const seen=new Set()
 for(const file of files){
  if(!safePath(file.path)||seen.has(file.path)||typeof file.data!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw new Error('Invalid dependency file path or data')
  seen.add(file.path)
 }
 await mkdir(target,{recursive:true,mode:0o700})
 if((await lstat(target)).isSymbolicLink())throw new Error('Dependency destination cannot be a symlink')
 for(const file of files){
  const segments=file.path.split('/');segments.pop()
  let parent=target
  for(const segment of segments){parent=join(parent,segment);await mkdir(parent,{recursive:true,mode:0o700});const info=await lstat(parent);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Dependency directory cannot be a symlink')}
  const destination=join(target,file.path)
  try{await lstat(destination);throw new Error('Dependency extraction refuses existing files')}catch(e){if(e.code!=='ENOENT')throw e}
  await writeFile(destination,Buffer.from(file.data,'base64'),{mode:0o600,flag:'wx'})
 }
 return manifest
}
