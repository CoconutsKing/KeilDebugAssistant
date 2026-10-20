import {readFile} from 'node:fs/promises';
try{
  const {port,token}=JSON.parse(await readFile(new URL('../data/runtime.json',import.meta.url),'utf8'));
  if(!Number.isInteger(port)||port<1||port>65535||typeof token!=='string')throw Error('Invalid runtime file.');
  const response=await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({token}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Shutdown refused: '+await response.text());
  console.log('Keil Debug Assistant stopped. Keil is still running.');
}catch(e){if(e.code==='ENOENT')console.log('Keil Debug Assistant is not running.');else{console.error('Could not stop the tool:',e.message);process.exitCode=1;}}
