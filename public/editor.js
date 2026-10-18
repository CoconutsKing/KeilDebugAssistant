export function replaceConfiguredItem(items,oldName,replacement){
 const index=items.findIndex(item=>item.name===oldName);if(index<0)throw Error('变量已被移除');
 if(items.some((item,i)=>i!==index&&item.name===replacement.name))throw Error('该变量已经在面板中，请选择其他变量');
 const next=items.map(item=>({...item}));next[index]=oldName===replacement.name?{...next[index],...replacement}:{...replacement};return next;
}
