import net from 'node:net';
import {validName} from './model.mjs';
export function matchesTarget(actual,requested,type=''){const number=Number(actual);return Number.isFinite(number)&&(number===requested||(/float/i.test(type)&&number===Math.fround(requested)));}
export function numericLiteral(value,type=''){if(/float|double/i.test(type)){const text=String(value);return /[.e]/i.test(text)?text:text+'.0';}return (value<0?'-':'')+'0x'+Math.abs(value).toString(16);}
export function packet(cmd, data=Buffer.alloc(0)) {
  const b=Buffer.alloc(32+data.length); b.writeUInt32LE(b.length); b.writeUInt32LE(cmd,4); b.writeUInt32LE(data.length,8); data.copy(b,32); return b;
}
export function sstr(s) { const raw=Buffer.from(s+'\0'); if(raw.length>256) throw Error('表达式过长'); const b=Buffer.alloc(260); b.writeUInt32LE(raw.length); raw.copy(b,4); return b; }
function stringAt(b,off) { if(b.length<off+4) throw Error(`Keil 字符串头不完整（${b.length} 字节，偏移 ${off}）`); const n=b.readUInt32LE(off); if(n>256||off+4+n>b.length) throw Error(`Keil 字符串长度无效（${b.length} 字节，偏移 ${off}，长度 ${n}）`);if(n&&b[off+3+n]!==0)throw Error('Keil 字符串缺少结束符');return b.subarray(off+4,off+4+Math.max(0,n-1)).toString(); }
function responseError(frame){const status=frame.readUInt32LE(36),detail=frame.subarray(52).toString().replace(/\0.*$/s,'');const error=Error(`Keil 状态 ${status}: ${detail||'操作被拒绝'}`);error.keilStatus=status;return error;}
export function parseVariable(b) {
 if(b.length<20)throw Error(`Keil VARINFO 头不完整（收到 ${b.length} 字节）`);
 const flags=b.readUInt32LE(16);
 // SDK structs have fixed string slots, but the wire may omit unused trailing bytes.
 const field=(offset,flag)=>offset>=b.length&&!(flags&flag)?'':stringAt(b,offset);
 return {id:b.readInt32LE(0),index:b.readInt32LE(4),count:b.readInt32LE(8),editable:!!(flags&1),pointer:!!(flags&2),aggregate:!!(flags&0x78),array:!!(flags&0x40),value:field(20,1<<12),type:field(280,1<<25),name:field(540,1<<26),qualifiedName:field(800,1<<27)};
}
export function parseLegacyValue(b,name){
 if(b.length<12)throw Error(`Keil TVAL 头不完整（${b.length} 字节）`);
 const kind=b.readUInt32LE(0),types={1:'bool',2:'char',3:'unsigned char',4:'int',5:'unsigned int',6:'short',7:'unsigned short',8:'long',9:'unsigned long',10:'float',11:'double',12:'pointer',13:'union',14:'struct',15:'function',16:'string',17:'enum',19:'int64',20:'uint64'};
 if(!types[kind])throw Error(`变量 ${name} 不可用或超出作用域（Keil 类型 ${kind}）`);
 let value;switch(kind){case 1:value=b.readUInt32LE(4)&1;break;case 2:value=b.readInt8(4);break;case 3:value=b.readUInt8(4);break;case 4:case 8:case 17:value=b.readInt32LE(4);break;case 5:case 9:case 12:value=b.readUInt32LE(4);break;case 6:value=b.readInt16LE(4);break;case 7:value=b.readUInt16LE(4);break;case 10:value=b.readFloatLE(4);break;case 11:value=b.readDoubleLE(4);break;case 19:value=b.readBigInt64LE(4).toString();break;case 20:value=b.readBigUInt64LE(4).toString();break;}
 const scalar=value!==undefined&&kind!==12;
 return {name,qualifiedName:name,type:types[kind]||'unknown',value:value===undefined?'{…}':String(value),editable:scalar&&Number.isFinite(Number(value))&&(![19,20].includes(kind)||Number.isSafeInteger(Number(value))),aggregate:[13,14].includes(kind),pointer:kind===12,array:false,count:0,legacy:true};
}
export class UVSock {
  constructor(){this.buffer=Buffer.alloc(0);this.pending=null;}
  async connect(port) {
    this.socket=net.createConnection({host:'127.0.0.1',port});
    this.socket.on('data',data=>{try{this.receive(data);}catch(e){this.close(e);}});
    this.socket.on('error',e=>this.close(e)); this.socket.on('close',()=>this.close(Error('Keil 连接已关闭')));
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.socket.destroy();reject(Error('连接超时'));},3000);this.socket.once('connect',()=>{clearTimeout(timer);resolve();});this.socket.once('error',e=>{clearTimeout(timer);reject(e);});});
    await this.enableExtended();
  }
  async enableExtended(){const options=Buffer.alloc(4);options.writeUInt32LE(1);try{await this.request(0x000d,options);this.legacy=false;this.compatibility='';}catch(e){if(![10,11,28].includes(e.keilStatus))throw e;this.legacy=true;this.compatibility='兼容读取模式：进入 Debug 前连接可启用类成员枚举；退出 Debug 后工具会自动重试。';}}
  receive(data){
    this.buffer=Buffer.concat([this.buffer,data]);
    while(this.buffer.length>=32){const n=this.buffer.readUInt32LE(0);if(n<32||n>32768)throw Error('无效的 UVSOCK 帧');if(this.buffer.length<n)return;
      const frame=this.buffer.subarray(0,n);this.buffer=this.buffer.subarray(n);
      if(frame.readUInt32LE(8)!==n-32)throw Error('UVSOCK 长度不匹配');
      if(n<40)continue;
      const outer=frame.readUInt32LE(4),operation=frame.readUInt32LE(32);
      if(outer===0x4000&&this.lifecycle?.cmd===operation){const wait=this.lifecycle;this.lifecycle=null;clearTimeout(wait.timer);frame.readUInt32LE(36)?wait.reject(responseError(frame)):wait.resolve();continue;}
      if(outer===0x4000&&this.enumeration&&[0x5040,0x5041,0x5042].includes(operation)){
        const enumeration=this.enumeration;
        if(frame.readUInt32LE(36)){enumeration.reject(Error('Keil 成员枚举失败'));this.enumeration=null;continue;}
        if(operation===0x5041){const data=frame.subarray(40);for(let i=0;i<data.length;i+=1060){if(enumeration.items.length>=256)throw Error('成员枚举超过 256 项，请使用完整成员路径添加');enumeration.items.push(parseVariable(data.subarray(i,Math.min(i+1060,data.length))));}}
        if(operation===0x5042){enumeration.resolve(enumeration.items);this.enumeration=null;}
        continue;
      }
      if(outer!==0x3000)continue;
      const p=this.pending;if(!p||frame.readUInt32LE(32)!==p.cmd)continue;
      clearTimeout(p.timer);this.pending=null;
      const status=frame.readUInt32LE(36);if(status)p.reject(responseError(frame));else p.resolve(frame.subarray(40));
    }
  }
  request(cmd,data,{timeout=5000}={}){if(this.pending)throw Error('调试请求必须串行');if(!this.socket||this.socket.destroyed)throw Error('尚未连接 Keil');return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.close(Error('Keil 请求超时，连接已断开以避免迟到响应错配')),timeout);this.pending={cmd,resolve,reject,timer};this.socket.write(packet(cmd,data));});}
  async status(options){const b=await this.request(0x2004,undefined,options);if(b.length<4)throw Error('状态响应不完整');return b.readUInt32LE(0)?'running':'halted';}
  async debugCommand(cmd,{timeout=60000,signal}={}){
    if(this.lifecycle)throw Error('另一个调试控制请求尚未完成');signal?.throwIfAborted();let wait;
    const completion=new Promise((resolve,reject)=>{wait={cmd,resolve,reject,timer:setTimeout(()=>this.close(Error((cmd===0x2000?'进入 Debug':'Run')+' 等待完成超时，请检查 ST-Link、开发板供电及 Keil 弹窗')),timeout)};this.lifecycle=wait;});
    const abort=()=>this.close(signal.reason||Error('调试控制已取消'));signal?.addEventListener('abort',abort,{once:true});
    try{await Promise.all([this.request(cmd,undefined,{timeout:Math.min(timeout,10000)}),completion]);}
    finally{clearTimeout(wait.timer);if(this.lifecycle===wait)this.lifecycle=null;signal?.removeEventListener('abort',abort);}
  }
  async enterAndRun({signal,onPhase=()=>{},assertCurrent=()=>{},timeout=60000}={}){
    const check=()=>{signal?.throwIfAborted();assertCurrent();};let state;check();onPhase('checking');
    try{state=await this.status({timeout:10000});}catch(e){if(e.keilStatus!==6)throw e;state='waiting';}check();
    if(state==='waiting'){
      if(this.legacy)await this.enableExtended();check();onPhase('entering');
      try{await this.debugCommand(0x2000,{signal,timeout});}catch(e){if(![10,11].includes(e.keilStatus))throw e;}
      check();state=await this.status({timeout:10000});check();
    }
    if(state!=='running'){
      onPhase('running');check();try{await this.debugCommand(0x2002,{signal,timeout});}catch(e){if(e.keilStatus!==11)throw e;}
      check();state=await this.status({timeout:10000});check();
    }
    return state;
  }
  async read(name){
    if(!validName(name))throw Error('无效变量路径');
    const b=Buffer.alloc(272);sstr(name).copy(b,12);
    const evaluate=async()=>parseLegacyValue(await this.request(0x200a,b),name);
    if(this.legacy)return evaluate();
    let watch;
    try{watch=parseVariable(await this.request(0x202b,b));}
    catch(e){if(e.keilStatus!==28)throw e;this.legacy=true;this.compatibility='扩展 Watch 接口不可用，已切换兼容读取；可输入完整成员路径。';return evaluate();}
    if(watch.aggregate||watch.array||watch.pointer)return watch;
    // The extended Watch value can stay cached after an IDE edit or while running.
    // Keep its ID/type for member enumeration and writes, but evaluate each scalar
    // independently for both polling and write confirmation. Never use a stale
    // Watch value as a successful read when the live evaluation fails.
    const actual=await evaluate();
    return {...watch,value:actual.value,editable:watch.editable&&actual.editable};
  }
  async members(name){
    if(this.legacy)throw Error('当前 Keil 使用兼容接口，不能枚举成员。可直接添加 joints[0].成员；如需展开，请先退出 Debug，让工具连接后再进入 Debug。');
    const parent=await this.read(name);if(!parent.count&&!parent.aggregate&&!parent.array&&!parent.pointer)return [];
    const request=Buffer.alloc(16);request.writeInt32LE(parent.id);request.writeUInt32LE(256,12);
    let timer;const results=new Promise((resolve,reject)=>{timer=setTimeout(()=>this.close(Error('Keil 成员枚举超时')),5000);this.enumeration={items:[],resolve,reject};});
    // Register the rejection handler before sending: disconnect can reject both promises.
    try{const [,members]=await Promise.all([this.request(0x202e,request),results]);return members;}finally{clearTimeout(timer);this.enumeration=null;}
  }
  async write(name,value){
    if(!validName(name)||typeof value!=='number'||!Number.isFinite(value))throw Error('无效写入请求');
    const before=await this.read(name);if(!before.editable||before.aggregate||before.array||before.pointer)throw Error('变量不可写');if(/char|short|int|long|bool|enum/i.test(before.type)&&!Number.isInteger(value))throw Error('整数变量不能写入小数');
    let assignmentError;
    // Extended VARIABLE_SET can take over five seconds per member after applying
    // the value. Numeric expression assignment avoids that slow path while keeping
    // extended reads/member browsing. Send once, then confirm independently.
    try{const b=Buffer.alloc(272);sstr(`${name} = ${numericLiteral(value,before.type)}`).copy(b,12);await this.request(0x200a,b);}
    catch(e){if(e.keilStatus!==13)throw e;assignmentError=e;}
    let actual,readError;
    for(let attempt=0;attempt<3;attempt++){try{actual=await this.read(name);break;}catch(e){readError=e;if(e.keilStatus!==13)break;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,60));}}
    if(!actual)throw Error(`变量 ${name}：${assignmentError?'写入未确认':'写入请求已发送'}，回读失败：${readError.message}`);
    if(assignmentError&&!matchesTarget(actual.value,value,actual.type)){const error=Error(`变量 ${name} 写入未确认：${assignmentError.message}；实际回读 ${actual.value}，请求 ${value}`);error.variableName=name;error.actual=actual;throw error;}
    return {...actual,beforeValue:before.value,...(assignmentError?{writeDiagnostic:'Keil 返回状态 13，但独立回读已确认目标值'}:{}),...(!matchesTarget(actual.value,value,actual.type)?{writeNotice:`请求 ${value}，实际回读 ${actual.value}`}:{})};
  }
  close(error=Error('连接已断开')){const p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);p.reject(error);}const wait=this.lifecycle;this.lifecycle=null;if(wait){clearTimeout(wait.timer);wait.reject(error);}this.enumeration?.reject(error);this.enumeration=null;this.socket?.destroy();}
}

