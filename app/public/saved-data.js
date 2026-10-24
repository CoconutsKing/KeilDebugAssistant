export function savedDataMessage(item,job){
 const saved=item.savedData,record=saved?`已保存 ${saved.count} 项 · ${new Date(saved.savedAt).toLocaleString('zh-CN',{hour12:false})}`:'尚未保存；保存范围为当前显示的数值成员。';
 if(!job||job.root!==item.name)return {text:record,error:false};
 if(job.status==='running')return {text:job.phase==='checking'?`恢复前检查 ${job.checked} / ${job.total} 项…`:`正在${job.action==='save'?'保存':'恢复'} ${job.completed} / ${job.total} 项…`,error:false};
 if(job.status==='error'||job.status==='cancelled')return {text:job.error,error:true};
 return {text:job.action==='restore'?`已恢复 ${job.completed} 项并回读确认。${record}`:record,error:false};
}
