#!/usr/bin/env node
// Bootstrap uses Node built-ins only: it works before npm dependencies exist.
import {installMf} from './mf/installer.mjs'
const args=process.argv.slice(2),options={}
try{
  for(let i=0;i<args.length;i++){
    if(args[i]==='--no-open')options.open=false
    else if(args[i]==='--cli'&&args[i+1])options.cli=args[++i]
    else if(args[i]==='--scope'&&args[i+1])options.scope=args[++i]
    else throw new Error('用法：node setup.mjs [--no-open] [--cli PATH] [--scope user|project]')
  }
  if(process.send)options.onProgress=text=>{console.log(text);process.send({type:'progress',text})}
  const result=await installMf(options)
  process.send?.({type:'installed',result:{setupUrl:result.setupUrl,version:result.version}})
}catch(e){console.error('\n安装尚未完成：'+e.message);process.send?.({type:'failed',error:e.message});process.exitCode=1}
