import test from 'node:test'
import assert from 'node:assert/strict'
import {fixtureRuntime} from './fixtures.mjs'
const plain=v=>JSON.parse(JSON.stringify(v))

test('simple creation on pages 2 through 5 stays on the intended page without resolving unrelated instances',async()=>{
 const f=await fixtureRuntime();let reads=0,switches=0
 for(let i=0;i<500;i++){
  const n=f.figma.createFrame();n.type='INSTANCE';f.page.appendChild(n)
  n.getMainComponentAsync=async()=>{reads++;throw Error('Unrelated instance must not block a new frame')}
 }
 const original=f.figma.setCurrentPageAsync;f.figma.setCurrentPageAsync=async p=>{switches++;await original(p)}
 for(let i=2;i<=5;i++){
  const p=f.figma.createPage();f.figma.currentPage=p
  const {value}=await f.runtime.run('use_figma',{code:'const n=figma.createFrame();figma.currentPage.appendChild(n);return {pageId:figma.currentPage.id,nodeId:n.id,parentId:n.parent.id};'})
  assert.equal(value.pageId,p.id);assert.equal(value.parentId,p.id);assert.equal(f.figma.currentPage,p)
 }
 assert.equal(reads,0);assert.equal(switches,0)
})

test('explicit pageId is resolved before writing; invalid targets fail without creating nodes',async()=>{
 const f=await fixtureRuntime(),target=f.figma.createPage()
 const result=await f.runtime.run('use_figma',{pageId:target.id,code:'const n=figma.createFrame();figma.currentPage.appendChild(n);return {parentId:n.parent.id};'})
 assert.equal(result.value.parentId,target.id)
 const count=f.nodes.size
 for(const pageId of ['missing',f.figma.root.id,''])await assert.rejects(f.runtime.run('use_figma',{pageId,code:'return figma.createFrame().id'}),e=>e.safeToRetryWithoutCanvasRead===true&&/pageId/.test(e.message))
 assert.equal(f.nodes.size,count)
})

test('loading a page and reading an instance do not eagerly resolve its component; explicit reads still support selectors',async()=>{
 const f=await fixtureRuntime(),other=f.figma.createPage(),component=f.figma.createComponent(),n=f.figma.createFrame()
 n.type='INSTANCE';other.appendChild(n);let reads=0
 Object.defineProperty(n,'mainComponent',{get(){throw Error('sync not exposed')}})
 n.getMainComponentAsync=async()=>{reads++;return component}
 await f.runtime.run('use_figma',{code:`const p=await figma.getNodeByIdAsync('${other.id}');await p.loadAsync();const n=await figma.getNodeByIdAsync('${n.id}');n.name='Updated';return n.id;`})
 assert.equal(reads,0)
 const {value}=await f.runtime.run('use_figma',{pageId:other.id,code:`const n=await figma.getNodeByIdAsync('${n.id}');await n.getMainComponentAsync();return figma.currentPage.query('INSTANCE[mainComponent=${component.id}]').values(['id']);`})
 assert.equal(reads,1);assert.deepEqual(plain(value),[{id:n.id}])
})
