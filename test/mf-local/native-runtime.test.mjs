import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {ensureNativeRuntime} from '../../mf/native-runtime.mjs'

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'mf-native-runtime-')),root=join(dir,'plugin with spaces'),home=join(dir,'state')
 t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(root,'mf'),{recursive:true})
 await writeFile(join(root,'package.json'),JSON.stringify({name:'myflicker-to-figma',version:'1.0.0',files:['mf','vendor']}))
 await writeFile(join(root,'package-lock.json'),'{}')
 await writeFile(join(root,'mf','entry.mjs'),'export const value=1')
 for(const name of ['@modelcontextprotocol/sdk','ajv','acorn']){await mkdir(join(root,'vendor',name),{recursive:true});await writeFile(join(root,'vendor',name,'package.json'),'{}')}
 for(const file of ['@modelcontextprotocol/sdk/dist/esm/server/index.js','ajv/dist/ajv.js','acorn/dist/acorn.js']){const parts=file.split('/');parts.pop();await mkdir(join(root,'vendor',...parts),{recursive:true});await writeFile(join(root,'vendor',file),'')}
 await writeFile(join(root,'vendor','.bundle.json'),JSON.stringify({lockHash:createHash('sha256').update('{}').digest('hex')}))
 return {root,home}
}

test('native host snapshot prepares offline dependencies atomically, handles concurrent starts and survives source deletion',async t=>{
 const {root,home}=await fixture(t)
 const [first,second]=await Promise.all([ensureNativeRuntime(root,{home}),ensureNativeRuntime(root,{home})])
 assert.equal(first,second);assert.ok(first.startsWith(home))
 assert.equal((await stat(join(home,'figma'))).mode&0o777,0o700)
 assert.equal(await ensureNativeRuntime(root,{home}),first)
 await rm(root,{recursive:true})
 for(const name of ['@modelcontextprotocol/sdk','ajv','acorn'])assert.equal(await readFile(join(first,'node_modules',name,'package.json'),'utf8'),'{}')
 assert.equal(await readFile(join(first,'mf','entry.mjs'),'utf8'),'export const value=1')
 assert.equal(await ensureNativeRuntime(first,{home}),first)
})

test('native preparation rejects mismatched bundle metadata and links without executing npm or Git',async t=>{
 const {root,home}=await fixture(t)
 await writeFile(join(root,'package-lock.json'),'changed')
 await assert.rejects(ensureNativeRuntime(root,{home}),/校验失败/)
 await writeFile(join(root,'package-lock.json'),'{}')
 await symlink(join(root,'package.json'),join(root,'mf','link'))
 await assert.rejects(ensureNativeRuntime(root,{home}),/symlink/)
})

test('native startup preserves source installs; partial cached runtimes and linked runtime roots are rejected',async t=>{
 const {root,home}=await fixture(t)
 const cached=await ensureNativeRuntime(root,{home})
 await rm(join(cached,'node_modules','acorn'),{recursive:true})
 await assert.rejects(ensureNativeRuntime(root,{home}),/不完整/)
 const otherHome=join(home,'other');await mkdir(join(otherHome,'figma'),{recursive:true})
 await symlink(join(home,'figma','runtimes'),join(otherHome,'figma','runtimes'),'dir')
 await assert.rejects(ensureNativeRuntime(root,{home:otherHome}),/symlink/)
})

test('native dependency bundle retains dist files when the host strips normal build folders',async t=>{
 const {packDependencies}=await import('../../mf/dependency-bundle.mjs')
 const {root,home}=await fixture(t),payload=join(root,'runtime-payload')
 await packDependencies(join(root,'vendor'),payload,createHash('sha256').update('{}').digest('hex'))
 await writeFile(join(root,'package.json'),JSON.stringify({name:'myflicker-to-figma',version:'1.0.0',files:['mf','runtime-payload']}))
 await rm(join(root,'vendor'),{recursive:true})
 const runtime=await ensureNativeRuntime(root,{home})
 assert.equal(await readFile(join(runtime,'node_modules','@modelcontextprotocol/sdk/dist/esm/server/index.js'),'utf8'),'')
 assert.equal(await ensureNativeRuntime(root,{home}),runtime)
})

test('dependency bundle verifies chunks and rejects traversal before writing files',async t=>{
 const {packDependencies,unpackDependencies}=await import('../../mf/dependency-bundle.mjs')
 const {gzipSync}=await import('node:zlib')
 const {root}=await fixture(t),payload=join(root,'runtime-payload'),lockHash=createHash('sha256').update('{}').digest('hex')
 await packDependencies(join(root,'vendor'),payload,lockHash)
 await writeFile(join(payload,'part-0000.data'),Buffer.from('corrupt'))
 await assert.rejects(unpackDependencies(payload,join(root,'output'),lockHash),/缺失|校验/)
 const bytes=gzipSync(Buffer.from(JSON.stringify([{path:'../escape',data:'aGVsbG8='}])))
 await writeFile(join(payload,'part-0000.data'),bytes)
 await writeFile(join(payload,'manifest.json'),JSON.stringify({format:'mf-js-dependencies-v1',lockHash,files:1,parts:[{name:'part-0000.data',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}))
 await assert.rejects(unpackDependencies(payload,join(root,'output'),lockHash),/Invalid dependency file/)
})


test('internal prerelease snapshots start offline while malformed version paths are rejected',async t=>{
 const {root,home}=await fixture(t),path=join(root,'package.json'),pkg=JSON.parse(await readFile(path,'utf8'))
 pkg.version='0.6.0-internal.1';await writeFile(path,JSON.stringify(pkg))
 const runtime=await ensureNativeRuntime(root,{home});assert.ok(runtime.includes('0.6.0-internal.1'))
 pkg.version='0.6.0/../../escape';await writeFile(path,JSON.stringify(pkg))
 await assert.rejects(ensureNativeRuntime(root,{home}),/完整/)
})
