import {decode} from '../lib/assets.mjs'

export function animationSettings(args){
  const format=args.format??'MP4',fps=args.fps??12
  const allowed=format==='GIF'?[8,12,15,24,30]:[12,24,30,60]
  if(!allowed.includes(fps))throw new Error(`Invalid ${format} fps; use ${allowed.join(', ')}`)
  const settings={format,fps,constraint:{type:'WIDTH',value:args.width??640}}
  if(format==='GIF')settings.loopCount=args.loopCount??0
  else settings.quality=args.quality??'LOW'
  return settings
}
export function animationScript(args){
  const settings=animationSettings(args),name='figma-motion.'+settings.format.toLowerCase()
  return `const node=await figma.getNodeByIdAsync(${JSON.stringify(args.nodeId)});
if(!node||node.type!=='FRAME'||node.parent?.type!=='PAGE')throw Error('Native animation export requires a top-level frame directly on a page; choose the containing frame.');
const settings=${JSON.stringify(settings)};
const bytes=await node.exportAsync(settings);
figma.io.write(${JSON.stringify(name)},bytes);
return {nodeId:node.id,format:settings.format,fps:settings.fps,requestedWidth:settings.constraint.value,bytes:bytes.length,nativeRenderer:true,source:'Figma Plugin API exportAsync',timelines:node.timelines};`
}
export function validateAnimationAsset(assets,format){
  if(!Array.isArray(assets)||assets.length!==1)throw new Error('Native animation export returned no single encoded file')
  const bytes=decode(assets[0].data)
  const valid=format==='MP4'?bytes.length>=12&&bytes.toString('ascii',4,8)==='ftyp'
    :format==='GIF'?bytes.length>=6&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6))
    :bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))
  if(!valid)throw new Error('Native export did not return a valid '+format+' container; no preview was fabricated')
  assets[0].mimeType={MP4:'video/mp4',GIF:'image/gif',WEBM:'video/webm'}[format]
}
