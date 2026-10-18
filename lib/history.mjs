export function validHistory(history){return history&&Number.isFinite(history.previous)&&Number.isFinite(history.current)&&['previous','current'].includes(history.selected)&&history.previous!==history.current;}
export function recordInput(history,requested,before){
 const active=validHistory(history)?history[history.selected]:before;
 if(!Number.isFinite(active)||active===requested)return validHistory(history)?{...history}:null;
 return {previous:active,current:requested,selected:'current'};
}
export function toggleTarget(history){if(!validHistory(history))throw Error('请先输入一个新值，建立可切换的两个目标值');return {value:history[history.selected==='current'?'previous':'current'],history:{...history,selected:history.selected==='current'?'previous':'current'}};}
