import {startHub} from './hub.mjs'
try{await startHub()}catch(e){
  // Simultaneous MCP startups may race; one owns the port and the others reuse it.
  if(e.code!=='EADDRINUSE')console.error(e.message)
  process.exitCode=e.code==='EADDRINUSE'?0:1
}
