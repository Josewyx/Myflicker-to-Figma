import {readFile,readdir,lstat,mkdir,copyFile,chmod} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join,dirname,isAbsolute} from 'node:path'

export async function packageFiles(root){
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),paths=new Set()
  async function walk(path){
    const parts=path.split(/[\\/]/)
    if(isAbsolute(path)||parts.some(p=>['..','.git','.figma'].includes(p))||(parts.includes('node_modules')&&parts[0]!=='vendor'))throw new Error('Invalid distributable path: '+path)
    const info=await lstat(join(root,path))
    if(info.isSymbolicLink())throw new Error('Distributable cannot contain symlinks: '+path)
    if(info.isDirectory())for(const name of await readdir(join(root,path)))await walk(join(path,name))
    else if(info.isFile())paths.add(path)
  }
  for(const entry of [...pkg.files,'package.json','package-lock.json'])await walk(entry)
  return [...paths].sort()
}
export async function packageFingerprint(root,paths){
  paths??=await packageFiles(root)
  const hash=createHash('sha256')
  for(const path of paths)hash.update(path).update('\0').update(await readFile(join(root,path))).update('\0')
  return hash.digest('hex')
}
export async function copyPackage(root,destination,paths){
  paths??=await packageFiles(root)
  for(const path of paths){
    const target=join(destination,path);await mkdir(dirname(target),{recursive:true})
    await copyFile(join(root,path),target)
    await chmod(target,(await lstat(join(root,path))).mode&0o777)
  }
}
