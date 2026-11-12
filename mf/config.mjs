import {homedir} from 'node:os'
import {resolve,join} from 'node:path'
import {readFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
export const ROOT=new URL('../',import.meta.url)
export const PACKAGE=JSON.parse(await readFile(new URL('package.json',ROOT),'utf8'))
export const PROTOCOL=1
export function configuration(env=process.env){
  const home=resolve(env.MF_FIGMA_HOME??join(homedir(),'.mf-figma'))
  let savedPort
  try{const value=JSON.parse(readFileSync(join(home,'runtime.json'),'utf8')).port;if(Number.isInteger(value)&&value>=1024&&value<=65535)savedPort=value}catch{}
  const port=Number(env.MF_FIGMA_PORT??savedPort??3057)
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('MF_FIGMA_PORT must be 1024–65535')
  const importParent=env.MF_FIGMA_IMPORT_PARENT!==undefined?(env.MF_FIGMA_IMPORT_PARENT?resolve(env.MF_FIGMA_IMPORT_PARENT):null):env.MF_FIGMA_HOME?null:join(homedir(),'Downloads')
  return {home,port,importParent,timeoutMs:120000,portExplicit:env.MF_FIGMA_PORT!==undefined}
}
