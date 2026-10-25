export function debugView(state,{pending=false,error=''}={}){
 const job=state.mode==='keil'&&(!state.session||state.debugJob?.port===state.session.port)?state.debugJob:null,working=job?.status==='running';
 const phases={queued:'等待当前采样完成…',connecting:'正在连接 Keil…',checking:'正在检查调试状态…',entering:'正在进入 Debug，请等待目标初始化…',running:'正在执行 Run…'};
 const running=state.mode==='keil'&&state.status==='running',halted=state.mode==='keil'&&state.status==='halted';
 return {disabled:pending||working||running||state.update?.phase==='installing',button:working?'正在启动调试…':running?'▶ 目标运行中':halted?'▶ 继续运行':'▶ 进入 Debug 并运行',message:error||(working?`${phases[job.phase]||'正在启动…'}（端口 ${job.port}）`:job?.status==='error'?job.error:job?.status==='done'&&halted?'Run 已执行，目标当前已暂停，请检查断点或目标状态。':''),error:!!error||job?.status==='error'};
}
