import {spawn} from 'node:child_process';
import {once} from 'node:events';
let port=Number(process.env.PORT||3210);
try{
 const response=await fetch(`http://127.0.0.1:${port}/api/state`,{signal:AbortSignal.timeout(1000)});
 const state=await response.json();if(!state.version)throw Error('Port in use');
 console.log('Keil Debug Assistant is already running.');
}catch{const {server}=await import('../app/server.mjs');if(!server.listening)await once(server,'listening');port=server.address().port;}
if(process.platform==='win32'&&process.env.KDA_NO_BROWSER!=='1')spawn('cmd.exe',['/c','start','',`http://127.0.0.1:${port}`],{windowsHide:true,stdio:'ignore'}).unref();
