export const validName=s=>typeof s==='string'&&s.length<=240&&/^[A-Za-z_$][\w$]*(?:(?:\.|->|::)[A-Za-z_$][\w$]*|\[\d+\])*$/.test(s);
export function memberPath(parent,member){
  if(!validName(parent))throw Error('无效父变量');
  if(member.qualifiedName&&validName(member.qualifiedName))return member.qualifiedName;
  const suffix=member.name?.trim();
  const path=/^\[\d+\]$/.test(suffix)?parent+suffix:parent+(member.parentPointer?'->':'.')+suffix;
  if(!validName(path))throw Error('成员路径不受支持，请手动输入完整成员名称');return path;
}
export function validateItem(v){if(!validName(v.name))throw Error('仅支持变量名、结构体成员和固定数组下标');const min=Number(v.min??0),max=Number(v.max??100),step=Number(v.step??1);if(![min,max,step].every(Number.isFinite)||min>=max||step<=0)throw Error('范围须满足最小值 < 最大值，步长 > 0');const item={name:v.name,min,max,step,pinned:!!v.pinned};if(v.members){if(typeof v.members!=='object'||Array.isArray(v.members)||Object.keys(v.members).length>512)throw Error('成员设置无效');item.members={};for(const [name,settings] of Object.entries(v.members)){if(![v.name+'.',v.name+'[',v.name+'->'].some(prefix=>name.startsWith(prefix)))throw Error('成员不属于当前变量');const checked=validateItem({name,...settings,members:undefined});item.members[name]={min:checked.min,max:checked.max,step:checked.step};}}return item;}
export function validateWrite(item,value,type=''){if(typeof value!=='number'||!Number.isFinite(value)||value<item.min||value>item.max)throw Error('写入值超出范围或不是有限数值');if(/char|short|int|long|bool/i.test(type)&&!Number.isInteger(value))throw Error('整数变量不能写入小数');return value;}
export function watchNames(xml){const result=[];for(const section of xml.matchAll(/<WatchWindow\d*>[\s\S]*?<\/WatchWindow\d*>/gi)){for(const m of section[0].matchAll(/<(?:ItemText|Expression)>([\s\S]*?)<\/(?:ItemText|Expression)>/gi)){const s=m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();if(validName(s))result.push(s);}}return [...new Set(result)];}
