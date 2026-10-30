export function arrayCopyOptions(item){
 const options=[];if(item.array)options.push({name:item.name,label:'当前数组 · '+item.name});else if(item.children)options.push({name:item.name,label:'当前对象 · '+item.name});
 for(const axis of item.indices||[])if(!options.some(option=>option.name===axis.parent))options.push({name:axis.parent,label:'整个数组 · '+axis.parent});
 if(item.children&&!options.some(option=>option.name===item.name))options.push({name:item.name,label:'当前对象 · '+item.name});
 return options;
}
export function arrayCopyMessage(root,job){
 if(!job||job.root!==root)return {text:'',error:false};
 if(job.status==='running')return {text:`读取 ${job.name}：${job.completed} / ${job.total} 项…${job.skipped?' 已跳过 '+job.skipped+' 项。':''}`,error:false};
 if(job.status==='error'||job.status==='cancelled')return {text:job.error,error:true};
 return {text:'',error:false};
}
export function arrayCopyResult(result,copied=true){
 const warning=Number(result.skipped)>0,skipped=warning?`已跳过 ${result.skipped} 项${result.skippedNames?.length?'（'+result.skippedNames.join('、')+'）':''}；省略成员使用默认初始化，数组缺失项保留 {}。`:'';
 return {text:(copied?`已复制 ${result.name}（${result.total} 个数字）。`:`已读取 ${result.total} 个数字，请在文本窗口复制。`)+skipped,error:false,warning};
}
export async function copyText(text,{clipboard=globalThis.navigator?.clipboard,fallback}={}){
 try{if(!clipboard?.writeText)throw Error('剪贴板不可用');await clipboard.writeText(text);return true;}catch{fallback?.(text);return false;}
}
