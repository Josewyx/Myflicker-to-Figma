import {readFile,mkdir,rename,rm,access,writeFile,cp,open as openFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {ROOT,configuration} from './config.mjs'
import {detectMfHost,openLocal} from './platform.mjs'
import {privateJson} from '../lib/storage.mjs'
import {packageFiles,packageFingerprint,copyPackage} from './package-files.mjs'
import {unpackDependencies} from './dependency-bundle.mjs'

export async function installMf(options={}){
  const home=options.home??configuration().home
  await mkdir(home,{recursive:true,mode:0o700})
  const lockPath=join(home,'installer.lock')
  let lock
  for(let attempt=0;attempt<2;attempt++){
    try{lock=await openFile(lockPath,'wx',0o600);break}catch(e){
      if(e.code!=='EEXIST')throw e
      let previous;try{previous=Number(await readFile(lockPath,'utf8'))}catch{}
      let alive=true
      if(Number.isSafeInteger(previous)&&previous>0)try{process.kill(previous,0)}catch(error){if(error.code==='ESRCH')alive=false}
      if(alive)throw new Error('安装正在进行，请等待之前的安装窗口完成。')
      await rm(lockPath,{force:true})
    }
  }
  if(!lock)throw new Error('无法取得安装锁，请稍后重试。')
  try{await lock.writeFile(String(process.pid));return await installUnlocked({...options,home})}
  finally{await lock.close();await rm(lockPath,{force:true})}
}
async function installUnlocked({root=fileURLToPath(ROOT),home,cli,scope='user',open=true,run=spawnSync,onProgress=console.log,prepare}){
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('需要 Node.js 22 或更新版本。')
  if(process.platform==='win32')throw new Error('Windows 一键安装尚未验收。当前请使用独立 MCP 接入方式；此安装器不会修改现有配置。')
  if(!['user','project'].includes(scope))throw new Error('scope must be user or project')
  const host=detectMfHost({explicit:cli,run}),mf=host.command
  let desktopState
  if(host.kind==='desktop'&&scope!=='user')throw new Error('MyFlicker 桌面安装接口仅支持用户级安装，请移除 --scope project。')
  // Verify the Desktop-owned daemon before changing the installation. Never start
  // a separate legacy daemon or edit the client's private configuration files.
  if(host.kind==='desktop'){
    const ready=run(mf,['plugin','list','--json'],{encoding:'utf8',shell:false,timeout:15000,windowsHide:true})
    let state;try{state=JSON.parse(ready.stdout)}catch{}
    if(ready.error||ready.status!==0||state?.health?.status!=='ready'||state?.capability?.localInstall!==true)throw new Error('MyFlicker 尚未就绪或当前版本不支持本地插件安装。请先打开 MyFlicker 并等待启动完成，再重新运行安装器。')
    desktopState=state
  }
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
  const destination=join(home,'installations',pkg.version),staging=destination+'.staging-'+randomUUID()
  const execute=(command,args,cwd)=>{
    const out=run(command,args,{cwd,stdio:'inherit',shell:false,windowsHide:true})
    if(out.error||out.status!==0)throw new Error(`安装步骤失败：${command} ${args[0]??''}。修复后重新运行安装器即可。`)
  }
  await mkdir(join(home,'installations'),{recursive:true,mode:0o700})
  const paths=await packageFiles(root),fingerprint=await packageFingerprint(root,paths)
  let reusable=false
  let existing
  try{existing=JSON.parse(await readFile(join(destination,'.installation.json'),'utf8'));if(existing.fingerprint!==fingerprint)throw Object.assign(new Error('同版本安装包的内容不同。请使用新的正式版本，避免复用旧缓存。'),{code:'IMMUTABLE_VERSION'});await access(join(destination,'node_modules','@modelcontextprotocol','sdk','package.json'));reusable=existing.node===process.execPath&&existing.hostKind===host.kind}catch(e){if(e.code==='IMMUTABLE_VERSION')throw e}
  if(!reusable){
    onProgress('① 准备独立运行环境…')
    await mkdir(staging,{recursive:true,mode:0o700})
    try{
      await copyPackage(root,staging,paths)
      // Use the verified runtime even when the MF GUI does not inherit a shell PATH.
      const mcp=JSON.parse(await readFile(join(staging,'.mcp.json'),'utf8'))
      mcp.mcpServers['myflicker-to-figma'].command=process.execPath
      // Desktop snapshots omit node_modules. Keep execution in the stable,
      // dependency-complete installation rather than its metadata-only snapshot.
      mcp.mcpServers['myflicker-to-figma'].args=[host.kind==='desktop'?join(destination,'mf','bootstrap.mjs'):'${CLAUDE_PLUGIN_ROOT}/mf/bootstrap.mjs']
      await writeFile(join(staging,'.mcp.json'),JSON.stringify(mcp,null,2)+'\n')
      if(pkg.files.includes('runtime-payload')){
        const lockHash=createHash('sha256').update(await readFile(join(root,'package-lock.json'))).digest('hex')
        await unpackDependencies(join(staging,'runtime-payload'),join(staging,'node_modules'),lockHash)
      }else if(pkg.files.includes('vendor')){
        // Release ZIPs carry portable JS dependencies: no npm or download needed.
        // packageFiles has already rejected every symlink and forbidden path.
        const bundle=JSON.parse(await readFile(join(root,'vendor','.bundle.json'),'utf8'))
        const lockHash=createHash('sha256').update(await readFile(join(root,'package-lock.json'))).digest('hex')
        if(bundle.lockHash!==lockHash)throw new Error('安装包的依赖与锁文件不匹配，请重新下载安装包。')
        await cp(join(staging,'vendor'),join(staging,'node_modules'),{recursive:true})
      }else{
        execute('npm',['ci','--ignore-scripts','--no-audit','--no-fund',...(process.env.MF_FIGMA_NPM_REGISTRY?['--registry',process.env.MF_FIGMA_NPM_REGISTRY]:[])],staging)
      }
      await privateJson(join(staging,'.installation.json'),{version:pkg.version,fingerprint,node:process.execPath,hostKind:host.kind})
      let backup
      try{await access(destination);backup=destination+'.backup-'+randomUUID();await rename(destination,backup)}catch(e){if(e.code!=='ENOENT')throw e}
      try{await rename(staging,destination)}catch(e){if(backup)await rename(backup,destination);throw e}
      if(backup)await rm(backup,{recursive:true,force:true})
    }finally{await rm(staging,{recursive:true,force:true})}
  }else onProgress('① 运行环境已就绪，无需重复下载。')
  onProgress('② 接入 MF…')
  let reloadConfirmed=false
  if(host.kind==='desktop'){
    // Active versions consume the host's projection capacity. Temporarily disable
    // only this plugin's older versions, restoring them if installation fails.
    const disabled=[]
    try{
    for(const previous of (desktopState.plugins??[]).filter(p=>p.pluginId==='myflicker-to-figma'&&p.name==='myflicker-to-figma'&&p.version!==pkg.version&&p.enabled===true)){
      if(typeof previous.installationId!=='string'||!previous.installationId.startsWith('sha256:'))throw new Error('旧插件标识无效，请在 MyFlicker 插件设置中停用旧版本。')
      execute(mf,['plugin','disable',previous.installationId,'--json'],root)
      disabled.push(previous.installationId)
    }
    execute(mf,['plugin','install','--path',destination,'--json'],root)
    const inventory=run(mf,['plugin','list','--json'],{encoding:'utf8',shell:false,timeout:15000,windowsHide:true})
    let state;try{state=JSON.parse(inventory.stdout)}catch{}
    const current=state?.plugins?.find(p=>p.name==='myflicker-to-figma'&&p.version===pkg.version&&p.enabled===true&&p.availability?.status==='ready')
    if(inventory.error||inventory.status!==0||!current)throw new Error('MyFlicker 未确认当前版本插件已启用并就绪。请在应用的插件设置中检查后重试。')
    }catch(error){
      for(const id of disabled){
        try{execute(mf,['plugin','enable',id,'--json'],root)}catch{throw new Error(error.message+' 旧版本恢复失败，请在 MyFlicker 插件设置中重新启用旧版本。',{cause:error})}
      }
      throw error
    }
  }else{
    execute(mf,['plugin','marketplace','add',destination],root)
    execute(mf,['plugin','install','myflicker-to-figma@myflicker-to-figma','--scope',scope],root)
    // Native reload uses MF's supported command interface, never desktop automation.
    const reload=run(mf,['call','plugin.reload','--data',JSON.stringify({cwd:root})],{encoding:'utf8',shell:false,timeout:30000,windowsHide:true})
    reloadConfirmed=!reload.error&&reload.status===0&&/"success"\s*:\s*true/.test(reload.stdout??'')
  }
  onProgress('③ 准备 Figma 连接…')
  const setup=prepare?await prepare(destination):await (async()=>{
    const {ensureHub}=await import(pathToFileURL(join(destination,'mf','client.mjs')))
    const {config}=await ensureHub({...configuration(),home})
    return {url:`http://127.0.0.1:${config.port}/setup`}
  })()
  const receipt={version:pkg.version,installedAt:new Date().toISOString(),destination,cli:mf,hostKind:host.kind,reloadConfirmed,setupUrl:setup.url}
  await privateJson(join(home,'installation.json'),receipt)
  if(open)try{openLocal(setup.url)}catch(e){onProgress(e.message)}
  onProgress(`安装完成。连接向导：${setup.url}`)
  if(!reloadConfirmed)onProgress('请回到 MyFlicker 新建会话使用；已有会话可能需要重启应用后加载插件。')
  return receipt
}
