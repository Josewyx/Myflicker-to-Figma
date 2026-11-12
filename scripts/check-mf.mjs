import {readFile,readdir,access} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import vm from 'node:vm'
const root=fileURLToPath(new URL('../',import.meta.url))
const shell=spawnSync('/bin/sh',['-n',join(root,'mf','launch-mcp.sh')],{encoding:'utf8'})
if(shell.status)throw new Error(shell.stderr)
for(const name of ['setup-page.html','install-page.html'])new vm.Script((await readFile(join(root,'mf',name),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1],{filename:name})
const bootstrap=spawnSync(process.execPath,['--check',join(root,'setup.mjs')],{encoding:'utf8'})
if(bootstrap.status)throw new Error(bootstrap.stderr)
for(const dir of ['mf','lib','companion','scripts'])for(const name of await readdir(join(root,dir)))if(/\.(mjs|js)$/.test(name)){
  const result=spawnSync(process.execPath,['--check',join(root,dir,name)],{encoding:'utf8'})
  if(result.status)throw new Error(result.stderr)
}
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
for(const path of pkg.files)await access(join(root,path))
for(const path of ['.mcp.json','.claude-plugin/plugin.json','.claude-plugin/marketplace.json','companion/manifest.json'])JSON.parse(await readFile(join(root,path),'utf8'))
const manifest=JSON.parse(await readFile(join(root,'.claude-plugin/plugin.json'),'utf8'))
const marketplace=JSON.parse(await readFile(join(root,'.claude-plugin/marketplace.json'),'utf8'))
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'))
if([manifest.version,marketplace.plugins[0].version,lock.version,lock.packages[''].version].some(v=>v!==pkg.version))throw new Error('Package, lockfile and MF plugin versions must match')
const discovered=[]
for(const entry of await readdir(join(root,'skills'))){
  try{await access(join(root,'skills',entry,'SKILL.md'));discovered.push(entry)}catch{}
}
if(discovered.length!==1||discovered[0]!=='myflicker-to-figma')throw new Error('MF must discover only the local adapter skill, not the archived DSH workflow')
console.log('PASS: syntax, plugin manifests, package files')
