import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,unlink,symlink,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {versionHealth} from '../../mf/connection-health.mjs'
import {MfHub} from '../../mf/hub.mjs'
import {bridgeToken} from '../../lib/storage.mjs'
import {request,connect} from '../fixtures.mjs'

test('version diagnosis distinguishes unknown, mismatched and insufficient feature levels without declaring every mismatch broken',()=>{
 const doc=(companionVersion,featureVersion=4)=>({companionVersion,featureVersion})
 assert.equal(versionHealth('0.5.4',[]).state,'waiting')
 assert.equal(versionHealth('0.5.4',[doc('0.5.4')]).state,'ready')
 const mismatch=versionHealth('0.5.4',[doc('0.5.2'),doc('0.5.5')]);assert.equal(mismatch.state,'version-mismatch');assert.equal(mismatch.compatible,true)
 assert.equal(versionHealth('0.5.4',[doc(null)]).state,'unknown-version')
 assert.equal(versionHealth('0.5.4',[doc('0.5.4',3)]).compatible,false)
 assert.equal(versionHealth('0.5.4',[doc('<script>')]).companions[0].version,null)
})

test('self-check finds missing files; nonce-protected repair recreates only paired files, preserving token and active documents',async t=>{
 const home=await mkdtemp(join(tmpdir(),'mf-health-')),hub=await new MfHub({home,port:0,token:await bridgeToken(home)}).initialize()
 t.after(async()=>{await hub.close();await rm(home,{recursive:true,force:true})})
 const base=`http://127.0.0.1:${hub.port}`,status=async()=>{const r=await fetch(base+'/setup/status');assert.equal(r.status,200);return r.json()}
 const before=await status();assert.equal(before.health.filesReady,true);assert.equal(before.health.state,'waiting')
 const marker=join(hub.companion.folder,'user-notes.txt');await writeFile(marker,'keep')
 await unlink(join(hub.companion.folder,'ui.html'))
 const missing=await status();assert.deepEqual(missing.health.missingFiles,['ui.html'])
 const repair=nonce=>fetch(base+'/setup/repair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nonce})})
 assert.equal((await repair('bad')).status,403)
 assert.equal((await fetch(base+'/setup/repair',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({nonce:before.actionNonce})})).status,403)
 const id=await connect(hub,'PRIVATE NAME',4),doc=hub.documents.get(id);doc.companionVersion='0.1.0'
 doc.active={id:'in-flight'};assert.equal((await repair(before.actionNonce)).status,409);doc.active=null
 assert.equal((await status()).health.filesReady,false)
 assert.equal((await repair(before.actionNonce)).status,200)
 const after=await status();assert.equal(after.health.filesReady,true);assert.equal(after.health.state,'version-mismatch');assert.equal(hub.token,(await bridgeToken(home)))
 assert.equal(hub.documents.has(id),true);assert.equal(doc.queue.length,0);assert.equal(await readFile(marker,'utf8'),'keep')
 assert.ok(!JSON.stringify(after.health).includes('PRIVATE NAME'));assert.ok(!JSON.stringify(after.health).includes(hub.token))
 // A symlink is not accepted as a healthy companion file.
 await unlink(join(hub.companion.folder,'ui.html'));await symlink(marker,join(hub.companion.folder,'ui.html'))
 assert.equal((await status()).health.filesReady,false)
 assert.equal((await repair(before.actionNonce)).status,500)
 assert.equal(await readFile(marker,'utf8'),'keep')
})
