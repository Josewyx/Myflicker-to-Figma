import {readFile,writeFile} from 'node:fs/promises'
const root=new URL('../companion/',import.meta.url)
const parts=await Promise.all(['helpers.js','capabilities.js','context.js','media.js','authoring.js','operations.js','reference.js','icons.js','quality.js','recovery.js','readonly.js','runtime.js','main.js'].map(file=>readFile(new URL(file,root),'utf8')))
await writeFile(new URL('code.js',root),parts.join('\n'))
