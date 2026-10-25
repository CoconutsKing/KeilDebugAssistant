export function arrayCopyOptions(item){
 const options=[];if(item.array)options.push({name:item.name,label:'当前数组 · '+item.name});
 for(const axis of item.indices||[])if(!options.some(option=>option.name===axis.parent))options.push({name:axis.parent,label:'整个数组 · '+axis.parent});
 if(item.children&&!options.some(option=>option.name===item.name))options.push({name:item.name,label:'当前对象 · '+item.name});
 return options;
}
export function arrayCopyMessage(root,job){
 if(!job||job.root!==root)return {text:'',error:false};
 if(job.status==='running')return {text:`读取 ${job.name}：${job.completed} / ${job.total} 项…`,error:false};
 if(job.status==='error'||job.status==='cancelled')return {text:job.error,error:true};
 return {text:'',error:false};
}
export async function copyText(text,{clipboard=globalThis.navigator?.clipboard,fallback}={}){
 try{if(!clipboard?.writeText)throw Error('剪贴板不可用');await clipboard.writeText(text);return true;}catch{fallback?.(text);return false;}
}
