export function connectionNotices(state){
 return {error:['error','waiting'].includes(state.status)?state.lastError||'':'',warning:[state.sessionError,(state.sessions||[]).some(s=>!s.port)?'发现未监听端口的 Keil 窗口：请在各窗口的 Other 配置中设置不同端口。':''].filter(Boolean).join(' ')};
}
