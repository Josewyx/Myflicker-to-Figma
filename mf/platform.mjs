import {spawnSync} from 'node:child_process'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {access} from 'node:fs/promises'

export async function findDesktopApp(name){
  if(!['MyFlicker','Figma'].includes(name))throw new Error('Unknown desktop app')
  const paths=[...(name==='MyFlicker'&&process.env.MF_FIGMA_APP?[process.env.MF_FIGMA_APP]:[]),`/Applications/${name}.app`,join(homedir(),'Applications',name+'.app')]
  for(const path of paths)try{await access(path);return path}catch{}
  return null
}

export function opener(target,{platform=process.platform,reveal=false}={}){
  if(platform==='darwin')return {command:'open',args:reveal?['-R',target]:[target]}
  if(platform==='win32')return {command:'explorer.exe',args:reveal?['/select,',target]:[target]}
  return {command:'xdg-open',args:[reveal?join(target,'..'):target]}
}
export function openLocal(target,options={}){
  const {command,args}=opener(target,options)
  const out=spawnSync(command,args,{stdio:'ignore',shell:false,timeout:10000,windowsHide:true})
  if(out.error||out.status!==0)throw new Error('无法自动打开，请使用连接向导中的路径。')
}
export function detectMfHost({env=process.env,home=homedir(),run=spawnSync,explicit,platform=process.platform}={}){
  const apps=platform==='darwin'?[env.MF_FIGMA_APP,'/Applications/MyFlicker.app',join(home,'Applications','MyFlicker.app')].filter(Boolean):[]
  const candidates=explicit?[explicit]:[
    ...apps.map(app=>join(app,'Contents','Resources','bin','flick')),
    env.MF_CLI,
    join(home,'.local','bin',process.platform==='win32'?'mf.exe':'mf'),
    join(home,'.myflicker','bin',process.platform==='win32'?'mf.exe':'mf'),
    'flick','mf','mfcli',
  ].filter(Boolean)
  for(const command of [...new Set(candidates)]){
    const result=run(command,['--help'],{encoding:'utf8',shell:false,timeout:10000,windowsHide:true})
    if(!result.error&&result.status===0&&/myflicker/i.test(result.stdout??'')&&/plugin/i.test(result.stdout??'')){
      const help=run(command,['plugin','install','--help'],{encoding:'utf8',shell:false,timeout:10000,windowsHide:true})
      if(help.error||help.status!==0)continue
      if(/--path\b/.test(help.stdout??''))return {command,kind:'desktop'}
      // Legacy MF uses the Claude-compatible marketplace command interface.
      if(/--scope\b/.test(help.stdout??''))return {command,kind:'legacy'}
    }
  }
  throw new Error('没有找到可用的 MyFlicker 插件安装接口。请安装并打开 MyFlicker 桌面应用，再重新运行安装器。应用不在标准位置时可设置 MF_FIGMA_APP 为其 .app 路径。')
}
export function detectMfCli(options){return detectMfHost(options).command}
