import {mkdtemp,readFile,writeFile,mkdir,cp,rm,rename} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {copyPackage,packageFiles} from '../mf/package-files.mjs'
import {packDependencies} from '../mf/dependency-bundle.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const temp=await mkdtemp(join(tmpdir(),'mf-figma-release-'))
const name=`Myflicker-to-Figma-${pkg.version}`,bundle=join(temp,name),stage=bundle
try{
  await copyPackage(root,stage)
  // This artifact is imported by the signed host, never launched in Finder.
  await rm(join(stage,'Install.command'),{force:true})
  pkg.files=pkg.files.filter(path=>path!=='Install.command')
  // Stage a clean install, never copy a developer's node_modules or npm config.
  const deps=join(temp,'dependencies');await mkdir(deps)
  for(const file of ['package.json','package-lock.json'])await cp(join(root,file),join(deps,file))
  const install=spawnSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:deps,stdio:'inherit',shell:false})
  if(install.status!==0)throw new Error('Dependency preparation failed')
  await packDependencies(join(deps,'node_modules'),join(stage,'runtime-payload'),createHash('sha256').update(await readFile(join(stage,'package-lock.json'))).digest('hex'))
  if(!pkg.files.includes('runtime-payload'))pkg.files.push('runtime-payload')
  await writeFile(join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n')
  const files=await packageFiles(stage)
  // Reject local-state paths and personal setup data before creating a shareable artifact.
  for(const path of files){
    if(/(^|\/)(\.installation\.json|bridge-token|runtime\.json|oauth\.json)$/.test(path))throw Error('Private file in release: '+path)
    if(!path.startsWith('runtime-payload/')){
      const text=await readFile(join(stage,path),'utf8')
      if(/\/(?:Users|home)\/[^\s/]+\//.test(text))throw Error('Local identity in release: '+path)
    }
  }
  await writeFile(join(bundle,'安装说明.md'),(await readFile(join(root,'docs','install.md'),'utf8')).replaceAll('../mf/guide-images/','mf/guide-images/'))
  // The one folder Finder extracts must itself be the installable plugin root.
  const declaration=JSON.parse(await readFile(join(bundle,'.claude-plugin','plugin.json'),'utf8'))
  if(declaration.name!==pkg.name)throw Error('Release root is not the declared plugin')
  await readFile(join(bundle,declaration.skills,'SKILL.md'),'utf8')
  const mcp=JSON.parse(await readFile(join(bundle,declaration.mcpServers),'utf8'))
  if(!Object.keys(mcp.mcpServers??{}).length)throw Error('Release root declares no MCP servers')
  const output=join(root,'releases',pkg.version);await mkdir(output,{recursive:true})
  const archive=join(output,name+'.zip'),temporary=archive+'.tmp.zip'
  // Keep exactly one installable root directory in the archive.
  const zip=spawnSync('zip',['-q','-r',temporary,name],{cwd:temp,stdio:'inherit',shell:false})
  if(zip.status!==0)throw Error('ZIP creation failed')
  await rename(temporary,archive)
  const hash=createHash('sha256').update(await readFile(archive)).digest('hex')
  await writeFile(archive+'.sha256',hash+'  '+name+'.zip\n')
  console.log(JSON.stringify({archive,files:files.length,sha256:hash},null,2))
}finally{await rm(temp,{recursive:true,force:true})}
