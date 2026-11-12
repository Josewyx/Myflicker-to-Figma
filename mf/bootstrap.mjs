#!/usr/bin/env node
// stdout is reserved for MCP JSON-RPC, including first-run preparation.
import {fileURLToPath,pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {ensureNativeRuntime} from './native-runtime.mjs'
try{
  const root=await ensureNativeRuntime(fileURLToPath(new URL('../',import.meta.url)))
  const {startMcp}=await import(pathToFileURL(join(root,'mf','mcp.mjs')))
  await startMcp()
}catch(e){
  console.error('Myflicker-to-Figma 启动失败：'+e.message+'\n请在 MyFlicker → 设置 → Plugins 中检查本地插件是否已启用，必要时重新导入完整插件文件夹。')
  process.exitCode=1
}
