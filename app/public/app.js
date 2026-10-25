import {createControl} from '/controls.js';
import {createLayout} from '/layout.js';
import {replaceConfiguredItem} from '/editor.js';
import {searchVariables} from '/search.js';
import {sessionChoices,createSessionSwitch,connectionView} from '/session-picker.js';
import {createMemberSelection} from '/member-picker.js';
import {connectionNotices} from '/notices.js';
import {createPreferenceController} from '/preferences.js';
import {savedDataMessage} from '/saved-data.js';
import {createUpdates} from '/updates.js';
import {createIndexControls} from '/indices.js';
import {debugView} from '/debug-view.js';
const $=id=>document.getElementById(id);let state={items:[]},draftSelection=null,onlyPinned=false,editing=null,memberEditing=null,revision=0,connectionError='',serviceError='';
const labels={disconnected:'未连接',connecting:'正在连接',waiting:'等待 Debug',running:'● 目标运行中',halted:'● 目标已暂停',error:'连接异常 / 重试中'};
async function api(path,data,{signal}={}){const context=data.sessionId??state.sessionId;revision++;for(let attempt=0;attempt<40;attempt++){signal?.throwIfAborted();const r=await fetch('/api/'+path,{method:'POST',signal,headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({...data,sessionId:context,...(['write','toggle','data/save','data/restore','index','debug/run'].includes(path)?{sessionKey:data.sessionKey??state.sessionKey}:{})})});const b=await r.json();signal?.throwIfAborted();if(r.status===409){await new Promise(r=>setTimeout(r,150));continue;}if(!r.ok)throw Error(b.error||'请求失败');revision++;state=b;if(['write','toggle','display','selection','data/save','data/restore','index'].includes(path))render();return b;}throw Error('Keil 正忙，请稍后重试');}
function error(e){$('error').textContent=e.message;}
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function configs(){return state.items.map(({name,min,max,step,pinned,members,hex,visibleMembers})=>({name,min,max,step,pinned,...(members?{members}:{}),...(hex!==undefined?{hex}:{}),...(visibleMembers!==undefined?{visibleMembers}:{})}));}
function groupType(v,rows){return v.children?`${v.type||''} · ${rows.length} / ${v.totalMembers} 项`:v.type||'等待采样';}
const cardsByName=new Map();let renderedSession='';
const dataPending=new Map(),dataErrors=new Map(),indexPending=new Set(),indexErrors=new Map();
const updates=createUpdates({document,api,render});let loadedVersion='';
const layoutController=createLayout({container:$('cards'),save:layout=>api('layout',{layout}),onError:error,onMode:editing=>{$('layoutEdit').textContent=editing?'完成排版':'编辑布局';$('layoutHint').hidden=!editing;}});
$('layoutEdit').onclick=()=>layoutController.toggle();$('layoutReset').onclick=()=>layoutController.reset();
const visibleRoots=new Set();let priorityTimer=null,lastPriority='';
const visibility=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visibleRoots.add(entry.target.dataset.root);else visibleRoots.delete(entry.target.dataset.root);}clearTimeout(priorityTimer);priorityTimer=setTimeout(()=>{const names=[...visibleRoots].filter(name=>cardsByName.has(name)).sort(),key=JSON.stringify(names);if(key!==lastPriority){lastPriority=key;void api('priority',{names}).catch(error);}},150);},{rootMargin:'250px'});
function render(){
 updates.update(state.update);if(state.version)for(const label of document.querySelectorAll('[data-version]'))label.textContent='V'+state.version;
 if(renderedSession!==state.sessionId){for(const entry of cardsByName.values()){entry.controls.forEach(c=>c.dispose());visibility.unobserve(entry.card);entry.card.remove();}cardsByName.clear();visibleRoots.clear();dataPending.clear();dataErrors.clear();indexPending.clear();indexErrors.clear();lastPriority='';layoutController.replace(state.layout);renderedSession=state.sessionId;bulkPicker=null;for(const id of ['editor','membersDialog','selectionDialog'])if($(id).open)$(id).close();}

 $('status').textContent=serviceError?'工具服务不可用':labels[state.status]||state.status;$('error').textContent=serviceError||connectionError||connectionNotices(state).error;$('compactStatus').textContent=serviceError?'工具服务不可用':labels[state.status]||state.status;$('compactError').textContent=$('error').textContent||connectionNotices(state).warning;$('count').textContent=`${state.items.length} 个变量`;$('project').textContent=state.projectPath||'尚未选择工程 · 连接窗口自动识别，或点击更换来源';renderSessions();renderConnection();renderDebug();preferenceController.reconcile(state.preferences);
 const query=$('search').value.toLowerCase(),items=state.items.filter(v=>(!onlyPinned||v.pinned)&&v.name.toLowerCase().includes(query));
 const cards=$('cards');
 cards.querySelector('.empty')?.remove();
 for(const [name,entry] of cardsByName)if(!items.some(v=>v.name===name)){entry.controls.forEach(c=>c.dispose());visibility.unobserve(entry.card);visibleRoots.delete(name);entry.card.remove();cardsByName.delete(name);}
 cards.dataset.filtered=String(!!query||onlyPinned);
 if(!items.length){cards.append(element('div','empty','暂无变量。请从下拉列表添加要观测的变量。'));layoutController.sync(state.layout);return;}
 for(const v of items){
  const rows=v.children||[v],signature=JSON.stringify([v.name,rows.map(r=>r.name),v.pinned,(v.indices||[]).map(axis=>axis.dimension)]);let entry=cardsByName.get(v.name);
  if(entry?.signature!==signature){entry?.controls.forEach(c=>c.dispose());if(entry)visibility.unobserve(entry.card);entry?.card.remove();
   const card=element('article',v.children?'card group-card':'card'),head=element('div','card-head');head.append(element('h3','',v.name));
   const pin=element('button','icon',v.pinned?'★':'☆');pin.title='收藏到调参面板';pin.onclick=()=>updateItem(v.name,{pinned:!state.items.find(x=>x.name===v.name)?.pinned});
   const edit=element('button','icon','⚙');edit.title='修改变量与范围';edit.setAttribute('aria-label','配置 '+v.name);edit.onclick=()=>{memberEditing=null;void openEditor(state.items.find(x=>x.name===v.name));};
   const remove=element('button','icon','×');remove.title='移除变量';remove.setAttribute('aria-label','移除 '+v.name);remove.onclick=async()=>{remove.disabled=true;try{await api('items',{items:configs().filter(x=>x.name!==v.name)});render();}catch(e){remove.disabled=false;error(e);}};
   head.append(pin,edit,remove);card.append(head,element('p','type',groupType(v,rows)));
   const indexControls=v.indices?.length?createIndexControls({axes:v.indices,onSelect:(dimension,index)=>switchIndex(v.name,dimension,index)}):null;if(indexControls)card.append(indexControls.element);const indexError=element('p','index-error card-error');card.append(indexError);
   if(v.children){const choose=element('button','choose-members','选择显示成员');choose.setAttribute('aria-label',v.name+' 选择显示成员');choose.onclick=()=>{const context=state.sessionId,current=state.items.find(item=>item.name===v.name);void openMemberPicker(v.name,current?.visibleMembers,selection=>api('selection',{root:v.name,members:selection??null,sessionId:context}));};card.append(choose);}
   if(v.truncated)card.append(element('p','card-error','此组超过 512 项或展开深度限制；请单独选择子数组继续观测。'));
   if(v.missingMembers?.length)card.append(element('p','card-error','部分已选成员在当前工程中不可用，请重新选择显示成员。'));
   if(v.children&&!rows.length)card.append(element('p','group-empty','未选择显示成员'));
   let dataControls=null;
   if(v.children||v.savedData){const actions=element('div','data-actions'),save=element('button','','保存当前数据'),restore=element('button','','恢复已保存数据'),message=element('p','data-status');save.setAttribute('aria-label',v.name+' 保存当前数据');restore.setAttribute('aria-label',v.name+' 恢复已保存数据');save.title='重新读取当前显示的数值成员，保存到本地；不会写入 Keil';restore.title='检查全部保存成员后逐项写回并回读；仅在当前 Debug 中执行';message.setAttribute('role','status');message.setAttribute('aria-live','polite');save.onclick=()=>void groupDataAction(v.name,'save');restore.onclick=()=>void groupDataAction(v.name,'restore');actions.append(save,restore);card.append(actions,message);dataControls={save,restore,message};}
   const controlSession={sessionKey:state.sessionKey,sessionId:state.sessionId};const controls=rows.map(row=>createControl(row,{root:v.name,api:(path,data)=>api(path,{...data,...controlSession}),settings:current=>{memberEditing=v.children?{root:v.name,name:current.name}:null;void openEditor(current);}}));const body=element('div','widget-body');for(const control of controls)body.append(control.element);card.append(body);
   entry={card,controls,signature,dataControls,indexControls,indexError};card.dataset.root=v.name;cardsByName.set(v.name,entry);cards.append(card);visibility.observe(card);
  }
  const connected=!serviceError&&connectionSwitch.pending===null&&state.mode==='keil'&&['running','halted'].includes(state.status),ownJob=state.dataJob?.status==='running'&&state.dataJob.root===v.name,preparing=dataPending.has(v.name);
  entry.controls.forEach((control,i)=>{const name=rows[i].name,overlap=state.dataJob?.status==='running'&&[state.dataJob.root+'.',state.dataJob.root+'['].some(prefix=>name.startsWith(prefix));control.update({...rows[i],editable:rows[i].editable&&connected&&!ownJob&&!preparing&&!overlap});});
  entry.indexControls?.update(v.indices||[],indexPending.has(v.name)||state.debugJob?.status==='running'||ownJob||preparing||entry.controls.some(control=>control.busy));entry.indexError.textContent=indexErrors.get(v.name)||'';
  if(entry.dataControls){const {save,restore,message}=entry.dataControls,working=state.dataJob?.status==='running'||dataPending.size>0,ready=connected&&!!v.children?.length&&!working&&!entry.controls.some(c=>c.busy),notice=savedDataMessage(v,state.dataJob);save.disabled=!ready;restore.disabled=!ready||!v.savedData;message.textContent=dataErrors.get(v.name)||(preparing?'正在准备…':notice.text);message.classList.toggle('data-error',dataErrors.has(v.name)||notice.error);}
  entry.card.querySelector(':scope > .type').textContent=groupType(v,rows);
 }
 items.forEach((item,index)=>{const card=cardsByName.get(item.name).card;if(cards.children[index]!==card)cards.insertBefore(card,cards.children[index]||null);});
 layoutController.sync(state.layout);
 $('updated').textContent='界面更新 '+new Date().toLocaleTimeString();
}
async function switchIndex(root,dimension,index){
 if(indexPending.has(root))return;const entry=cardsByName.get(root);if(entry?.controls.some(control=>control.busy)){indexErrors.set(root,'变量正在写入，请等待回读完成');render();return;}
 if(index!==null&&(!Number.isSafeInteger(index)||index<0)){indexErrors.set(root,'请输入有效的非负整数索引');render();return;}
 const context={sessionId:state.sessionId,sessionKey:state.sessionKey};indexErrors.delete(root);indexPending.add(root);render();
 try{await api('index',{root,dimension,index,layout:layoutController.capture(),...context});}catch(e){if(context.sessionId===state.sessionId)indexErrors.set(root,e.message);}finally{indexPending.delete(root);render();}
}
async function updateItem(name,patch){try{await api('items',{items:configs().map(v=>v.name===name?{...v,...patch}:v)});render();}catch(e){error(e);}}
async function groupDataAction(root,action){
 const entry=cardsByName.get(root);if(entry?.controls.some(c=>c.busy)){dataErrors.set(root,'变量正在写入，请等待回读完成后再操作');render();return;}
 const token={sessionId:state.sessionId,sessionKey:state.sessionKey};dataPending.set(root,token);dataErrors.delete(root);render();
 try{await api('data/'+action,{root,...token});}catch(e){if(state.sessionId===token.sessionId)dataErrors.set(root,e.message);}finally{if(dataPending.get(root)===token)dataPending.delete(root);render();}
}
let variableOptions=[],selectionVersion=0,draftVisibleMembers,draftGroupName='',bulkPicker=null,bulkVersion=0;
const chooseMembers=element('button','choose-members','批量选择显示成员');chooseMembers.type='button';chooseMembers.id='chooseMembers';chooseMembers.hidden=true;$('browseInput').after(chooseMembers);
function updateMemberButton(){chooseMembers.textContent='批量选择显示成员（'+(draftVisibleMembers===undefined?'全部':draftVisibleMembers.length+' 项')+'）';}
chooseMembers.onclick=()=>void openMemberPicker($('name').value,draftVisibleMembers,selection=>{draftVisibleMembers=selection;updateMemberButton();});
async function openMemberPicker(name,selection,save){
 const version=++bulkVersion,context=state.sessionId;bulkPicker=null;$('selectionRoot').textContent=name;$('memberFilter').value='';$('selectionList').replaceChildren();$('selectionCount').textContent='正在加载…';$('selectionWarning').textContent='';$('selectionError').textContent='';$('selectionSave').disabled=true;$('selectionAll').disabled=$('selectionNone').disabled=true;$('selectionDialog').showModal();
 try{const result=await api('group-members',{name,sessionId:context});if(version!==bulkVersion||!$('selectionDialog').open||context!==state.sessionId)return;
  bulkPicker={model:createMemberSelection(result.groupMembers,selection),save,truncated:result.truncated};$('selectionAll').disabled=$('selectionNone').disabled=false;$('selectionSave').disabled=false;renderMemberChoices();
 }catch(e){if(version===bulkVersion&&$('selectionDialog').open){$('selectionCount').textContent='';$('selectionError').textContent=e.message;}}
}
function updateMemberCount(){if(!bulkPicker)return;const model=bulkPicker.model,total=model.rows().length;$('selectionCount').textContent=`已选 ${model.count} / ${total} 项`;$('selectionWarning').textContent=bulkPicker.truncated?'此处最多列出 512 项；可先选择具体子数组或成员，再进行批量选择。':model.count>64?'已选成员较多，刷新一轮需要更长时间。可减少勾选项。':'';}
function renderMemberChoices(){if(!bulkPicker)return;const rows=bulkPicker.model.rows($('memberFilter').value);$('selectionList').replaceChildren();
 for(const row of rows){const label=element('label','member-check'),input=element('input');input.type='checkbox';input.checked=bulkPicker.model.has(row.name);input.setAttribute('aria-label',row.name+' 显示');input.onchange=()=>{bulkPicker.model.set([row.name],input.checked);updateMemberCount();};const text=element('div');text.append(element('strong','',row.name),element('small','',row.type||''));label.append(input,text);$('selectionList').append(label);}
 if(!rows.length)$('selectionList').append(element('p','group-empty','没有匹配成员'));updateMemberCount();
}
$('memberFilter').oninput=renderMemberChoices;
$('memberFilter').onkeydown=event=>{if(event.key==='Enter')event.preventDefault();};
$('selectionDialog').oncancel=()=>{bulkVersion++;bulkPicker=null;};
for(const [id,checked] of [['selectionAll',true],['selectionNone',false]])$(id).onclick=()=>{if(bulkPicker){bulkPicker.model.set(bulkPicker.model.rows($('memberFilter').value).map(row=>row.name),checked);renderMemberChoices();}};
$('selectionCancel').onclick=()=>{$('selectionDialog').close();bulkVersion++;bulkPicker=null;};
$('selectionForm').onsubmit=async event=>{event.preventDefault();if(!bulkPicker)return;$('selectionSave').disabled=true;$('selectionError').textContent='';try{await bulkPicker.save(bulkPicker.model.value());$('selectionDialog').close();bulkVersion++;bulkPicker=null;}catch(e){$('selectionError').textContent=e.message;}finally{$('selectionSave').disabled=false;}};
async function openEditor(v,chosenName){
 draftVisibleMembers=v?.visibleMembers;draftGroupName=chosenName||v?.name||'';chooseMembers.hidden=true;updateMemberButton();
 const selected=chosenName||v?.name||'';editing=v?.name||null;$('name').value=selected;$('name').disabled=false;
 $('dialogTitle').textContent=memberEditing?'设置成员范围':editing?'修改监测变量':'选择监测变量';
 for(const k of ['min','max','step'])$(k).value=v?.[k]??state.defaults?.[k]??({min:0,max:100,step:1}[k]);
 $('pinned').checked=v?.pinned??state.defaults?.pinned??true;$('formError').textContent='';$('variableLevels').replaceChildren();$('variableSearch').value='';$('variableSearchResults').replaceChildren();$('variableSearchResults').hidden=true;$('variableSearchStatus').textContent='正在加载变量列表…';$('selectionValue').textContent='正在加载变量列表…';variableOptions=[];$('variableSearch').disabled=true;$('variableSearchButton').disabled=true;$('editor').showModal();
 try{const result=await api('catalog',{});variableOptions=result.variables;if(selected&&!variableOptions.some(v=>v.name===selected))variableOptions.push({name:selected,type:'当前选中成员'});fillVariableOptions();if(selected){$('variableSelect').value=selected;void selectVariable(selected,0);}else $('selectionValue').textContent=`可选择 ${variableOptions.length} 个变量${result.catalogError?'（仅显示已配置的 Watch，AXF 信息不可用）':''}`;}catch(e){$('selectionValue').textContent=e.message;$('variableSearchStatus').textContent=e.message;}finally{$('variableSearch').disabled=!!memberEditing;$('variableSearchButton').disabled=!!memberEditing;}
}
function fillVariableOptions(){
 const select=$('variableSelect'),query=$('variableSearch').value.trim(),selected=$('name').value,matches=searchVariables(variableOptions,query);
 select.replaceChildren(element('option','',matches.length?'请选择要监测的变量':'没有匹配的变量'));select.options[0].value='';
 for(const v of matches){const option=element('option','',`${v.name}　${v.type||''}`);option.value=v.name;select.append(option);}if(matches.some(v=>v.name===selected))select.value=selected;select.disabled=!!memberEditing||!matches.length;
 const results=$('variableSearchResults');results.replaceChildren();results.hidden=!query;
 $('variableSearchStatus').textContent=query?(matches.length?`找到 ${matches.length} 个变量${matches.length>40?'，显示前 40 项，可继续输入缩小范围':''}。点击结果选择。`:'没有找到匹配变量，请换一个名称片段。'):`共 ${variableOptions.length} 个变量。输入名称或类型即可搜索。`;
 for(const variable of query?matches.slice(0,40):[]){const button=element('button','search-result');button.type='button';button.append(element('strong','',variable.name),element('small','',variable.type||''));button.onclick=()=>chooseSearchResult(variable.name);results.append(button);}
 return matches;
}
function chooseSearchResult(name){$('variableSelect').value=name;$('variableSearchResults').hidden=true;void selectVariable(name,0);}
function runVariableSearch(){selectionVersion++;if(!memberEditing){$('name').value='';chooseMembers.hidden=true;$('variableLevels').replaceChildren();$('selectionValue').textContent='请从搜索结果或下拉列表选择变量。';}return fillVariableOptions();}
async function selectVariable(name,depth){
 const version=++selectionVersion;$('name').value=name;chooseMembers.hidden=true;if(draftGroupName!==name){draftGroupName=name;draftVisibleMembers=state.items.find(item=>item.name===name)?.visibleMembers;}updateMemberButton();const levels=$('variableLevels');while(levels.children.length>depth)levels.lastElementChild.remove();$('selectionValue').textContent='正在读取 '+name+'…';if(!name)return;
 try{
  const preview=await api('preview',{name,metadataOnly:true});if(version!==selectionVersion)return;const v=preview.selected;$('selectionValue').textContent=`${name} = ${v.pointer?'指针（请选择成员）':v.value}　${v.type||''}`;chooseMembers.hidden=!!memberEditing||!v.array&&!v.aggregate;
  if(!v.array&&!v.aggregate&&!v.pointer)return;
  const result=await api('members',{name});if(version!==selectionVersion)return;appendMemberSelect(name,result,depth,version,v);
 }catch(e){if(version===selectionVersion)$('selectionValue').textContent=e.message;}
}
function appendMemberSelect(name,result,depth,version,meta){
 const label=element('label'),heading=element('span','member-select-heading'),select=element('select');heading.append(element('span','','选择数组元素 / 成员'));
 if(!meta.pointer&&(meta.array||meta.aggregate)){const hint=element('span','member-select-hint',meta.array?'不选具体成员，默认调试整个数组；可用批量选择限定范围。':'不选具体成员，默认调试全部成员；可用批量选择限定范围。');hint.id='member-select-hint-'+depth;heading.append(hint);select.setAttribute('aria-describedby',hint.id);}
 select.setAttribute('aria-label',name+' 选择数组元素 / 成员');label.append(heading);const placeholder=element('option','','请选择具体元素或成员');placeholder.value='';select.append(placeholder);
 for(const member of result.members){const option=element('option','',`${member.name}　${member.value??member.type??''}`);option.value=member.name;select.append(option);}
 if(result.nextOffset!==null){const more=element('option','','下一页…');more.value='__more__';select.append(more);}
 label.append(select);$('variableLevels').append(label);
 select.onchange=async()=>{if(select.value==='__more__'){try{const next=await api('members',{name,offset:result.nextOffset});if(!label.isConnected)return;while($('variableLevels').children.length>depth+1)$('variableLevels').lastElementChild.remove();label.remove();appendMemberSelect(name,next,depth,selectionVersion,meta);}catch(e){$('selectionValue').textContent=e.message;}}else if(select.value)void selectVariable(select.value,depth+1);else void selectVariable(name,depth);};
}
$('variableSearch').oninput=runVariableSearch;$('variableSearchButton').onclick=runVariableSearch;
$('variableSearch').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();const matches=runVariableSearch();if(matches.length)chooseSearchResult(matches[0].name);}else if(event.key==='ArrowDown'){event.preventDefault();$('variableSearchResults').querySelector('button')?.focus();}else if(event.key==='Escape'){$('variableSearchResults').hidden=true;event.preventDefault();}};
$('variableSelect').onchange=()=>{$('variableSearchResults').hidden=true;void selectVariable($('variableSelect').value,0);};
function openMembers(name){$('memberRoot').value=name;$('memberTree').replaceChildren();if(!$('membersDialog').open)$('membersDialog').showModal();void loadMembers(name,$('memberTree'));}
async function loadMembers(name,container,offset=0){
 const loading=element('p','','正在读取成员…');container.append(loading);
 try{
  const result=await api('members',{name,offset});loading.remove();
  if(!result.members.length)container.append(element('p','','没有可展开的成员。数值变量可直接添加；指针或类成员是否可见取决于 Keil 调试信息。'));
  for(const member of result.members){
   const branch=element('div','member-branch'),row=element('div','member-row'),text=element('div','member-label');
   text.append(element('strong','',member.name),element('small','',`${member.type||''}${member.value!==undefined?' · '+member.value:''}`));row.append(text);
   const children=element('div','member-children');
   if(member.expandable){const expand=element('button','','展开');let loaded=false;expand.onclick=async()=>{if(loaded){children.hidden=!children.hidden;return;}loaded=true;expand.disabled=true;await loadMembers(member.name,children);expand.disabled=false;};row.append(expand);}
   const select=element('button','primary','选择');select.onclick=()=>{
   const existing=state.items.find(v=>v.name===member.name);memberEditing=null;$('membersDialog').close();if($('editor').open)$('editor').close();void openEditor(existing,member.name);
   };row.append(select);branch.append(row,children);container.append(branch);
  }
  if(result.nextOffset!==null){const more=element('button','','下一页：从下标 '+result.nextOffset+' 开始');more.onclick=()=>{more.remove();void loadMembers(name,container,result.nextOffset);};container.append(more);}
 }catch(e){loading.textContent=e.message;loading.className='card-error';}
}
$('browseInput').onclick=()=>openMembers($('name').value.trim());$('browseRoot').onclick=()=>{const name=$('memberRoot').value.trim();$('memberTree').replaceChildren();void loadMembers(name,$('memberTree'));};$('closeMembers').onclick=()=>$('membersDialog').close();
$('add').onclick=()=>{memberEditing=null;void openEditor();};$('cancel').onclick=()=>$('editor').close();$('form').onsubmit=async e=>{e.preventDefault();try{const item={name:$('name').value.trim(),min:Number($('min').value),max:Number($('max').value),step:Number($('step').value),pinned:$('pinned').checked,visibleMembers:draftVisibleMembers};let next=configs();if(memberEditing){const parent=next.find(v=>v.name===memberEditing.root);if(!parent)throw Error('变量已被移除');parent.members={...parent.members,[memberEditing.name]:{...parent.members?.[memberEditing.name],min:item.min,max:item.max,step:item.step}};}else if(editing)next=replaceConfiguredItem(next,editing,item);else next.push(item);const rename=editing&&!memberEditing&&editing!==item.name?{from:editing,to:item.name,layout:layoutController.capture()}:null;await api('items',{items:next,...(rename?{rename}:{}),...(!editing?{remember:item}:{})});$('editor').close();memberEditing=null;render();}catch(e){$('formError').textContent=e.message;}};
const connectionSwitch=createSessionSwitch({connect:(request,signal)=>api('connect',request,{signal}),onChange:render});
function renderConnection(){const view=connectionView({...state,serviceError},connectionSwitch.pendingRequest);$('connect').textContent=view.button;$('connect').dataset.connected=String(view.connected);$('connect').disabled=connectionSwitch.pendingRequest?.mode==='disconnected';$('connect').title=view.action==='disconnect'?'断开工具连接，不退出 Keil Debug':'连接所选 Keil 窗口';$('connectionLed').dataset.light=view.light;$('connectionText').textContent=view.text;$('connectionState').setAttribute('aria-label',view.text);$('cancelConnection').hidden=!view.cancel;}
let debugStarting=false,debugError='';
function renderDebug(){const view=debugView(state,{pending:debugStarting,error:debugError});$('quickDebug').hidden=state.mode==='keil'&&state.status==='running'&&state.debugJob?.status!=='running';for(const id of ['debugRun','quickDebug']){$(id).textContent=view.button;$(id).disabled=view.disabled;$(id).title='在当前所选 Keil 窗口进入 Debug 并运行；已暂停时继续运行';}for(const id of ['debugFeedback','compactDebugFeedback']){$(id).textContent=view.message===$('error').textContent?'':view.message;$(id).classList.toggle('is-error',view.error);}}
async function debugRun(){if(debugStarting)return;const chosen=$('instance').value,request={port:chosen==='auto'?Number($('port').value):Number(chosen),selection:chosen};debugStarting=true;debugError='';render();try{await api('debug/run',request);draftSelection=null;}catch(e){debugError=e.message;}finally{debugStarting=false;render();}}
$('debugRun').onclick=()=>void debugRun();$('quickDebug').onclick=()=>void debugRun();
async function connectSession(mode='keil'){debugError='';const chosen=$('instance').value;draftSelection=chosen;connectionError='';try{await connectionSwitch.select({mode,port:chosen==='auto'?Number($('port').value):Number(chosen),selection:chosen});}catch(e){if(e.name!=='AbortError')connectionError=e.message;}finally{if(connectionSwitch.pending===null)draftSelection=null;render();}}
$('connect').onclick=()=>void connectSession(connectionView({...state,serviceError},connectionSwitch.pendingRequest).action==='disconnect'?'disconnected':'keil');$('cancelConnection').onclick=()=>void connectSession('disconnected');$('instance').onchange=()=>{debugError='';draftSelection=$('instance').value;if(state.mode==='keil'||connectionSwitch.pendingRequest?.mode==='keil')void connectSession();};
$('refreshSessions').onclick=async()=>{try{$('refreshSessions').disabled=true;await api('sessions',{port:Number($('port').value)});render();}catch(e){error(e);}finally{$('refreshSessions').disabled=!!state.discovering;}};

$('interval').onchange=async()=>{try{await api('interval',{interval:Number($('interval').value)});}catch(e){error(e);}};
$('search').oninput=render;
for(const [id,pinned] of [['all',false],['pins',true]])$(id).onclick=()=>{onlyPinned=pinned;$('all').classList.toggle('active',!pinned);$('pins').classList.toggle('active',pinned);$('panelTitle').textContent=pinned?'我的调参面板':'变量监视';render();};
function projectEditor(){$('projectPath').value=state.projectPath||'';$('projectError').textContent='';$('projectDialog').showModal();}
$('changeProject').onclick=projectEditor;$('cancelProject').onclick=()=>$('projectDialog').close();
$('projectForm').onsubmit=async event=>{event.preventDefault();try{await api('project',{path:$('projectPath').value.trim().replace(/^"|"$/g,'')});$('projectDialog').close();render();}catch(e){$('projectError').textContent=e.message;}};
$('import').onclick=async()=>{if(!state.projectPath){projectEditor();return;}try{await api('project',{path:state.projectPath});render();}catch(e){error(e);projectEditor();}};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({version:2,items:configs(),layout:state.layout},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='keil-panel.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('load').onclick=()=>$('file').click();$('file').onchange=async()=>{try{const file=$('file').files[0];if(!file)return;const config=JSON.parse(await file.text());await api('items',{items:config.items});if(config.layout)await api('layout',{layout:config.layout});render();}catch(e){error(e);}finally{$('file').value='';}};
let sessionOptions='',prefsApplied='';
function renderSessions(){$('refreshSessions').disabled=!!state.discovering;$('refreshSessions').textContent=state.discovering?'正在刷新…':'刷新窗口';const list=state.sessions||[],choice=sessionChoices(list,connectionSwitch.pending??draftSelection??state.selection??'auto',state.session),key=JSON.stringify(choice.options);if(key!==sessionOptions){sessionOptions=key;$('instance').replaceChildren();for(const item of choice.options){const option=new Option(item.label,item.value);option.title=item.title||'';option.disabled=item.disabled;$('instance').append(option);}}$('instance').value=choice.selected;
 $('connectedTarget').textContent=state.session?'当前窗口：'+state.session.title+' · 端口 '+state.session.port:'选择正在调试的 Keil 窗口后自动识别工程';
 $('sessionHint').textContent=connectionNotices(state).warning;}
const preferenceController=createPreferenceController({save:async patch=>(await api('preferences',{preferences:patch})).preferences,onChange:applyPreferences,onError:error});
function applyPreferences(p){const key=JSON.stringify(p);if(key===prefsApplied)return;prefsApplied=key;document.documentElement.dataset.theme=p.theme;document.body.classList.toggle('sidebar-collapsed',p.collapsed);for(const button of document.querySelectorAll('.theme-swatch'))button.setAttribute('aria-pressed',String(button.dataset.theme===p.theme));$('guide').hidden=p.guideDismissed;$('guide').open=p.guideOpen;for(const id of ['sidebarToggle','monitorSidebarToggle']){$(id).setAttribute('aria-expanded',String(!p.collapsed));$(id).setAttribute('aria-label',p.collapsed?'展开侧栏':'收起侧栏');$(id).title=p.collapsed?'展开侧栏':'收起侧栏';}document.body.classList.toggle('chrome-collapsed',p.chromeCollapsed===true);$('workspaceChrome').hidden=p.chromeCollapsed===true;$('chromeToggle').textContent=p.chromeCollapsed?'展开顶部设置 ⌄':'收起顶部设置 ⌃';$('chromeToggle').setAttribute('aria-expanded',String(!p.chromeCollapsed));layoutController.resize();}
function setPreference(patch){preferenceController.set(patch);}
for(const button of document.querySelectorAll('.theme-swatch'))button.onclick=()=>setPreference({theme:button.dataset.theme});for(const id of ['sidebarToggle','monitorSidebarToggle'])$(id).onclick=()=>setPreference({collapsed:!preferenceController.current.collapsed});$('chromeToggle').onclick=()=>setPreference({chromeCollapsed:!preferenceController.current.chromeCollapsed});
$('guideDone').onclick=()=>void setPreference({guideOpen:false});$('guideClose').onclick=event=>{event.preventDefault();event.stopPropagation();setPreference({guideOpen:false,guideDismissed:true});};$('help').onclick=()=>{setPreference({guideOpen:true,guideDismissed:false,chromeCollapsed:false});$('guide').scrollIntoView({behavior:'smooth',block:'start'});};
$('guide').ontoggle=()=>{if($('guide').open!==preferenceController.current.guideOpen)setPreference({guideOpen:$('guide').open});};
async function tick(){try{const version=revision;const editing=!!document.querySelector('dialog[open]:not(#updateDialog),.layout-editing');const r=await fetch('/api/state',{headers:{'X-Keil-UI-Editing':editing?'1':'0'}});if(!r.ok)throw Error('服务不可用');const result=await r.json();if(loadedVersion&&result.version!==loadedVersion){location.reload();return;}loadedVersion=result.version;serviceError='';if(version===revision){state=result;render();}}catch(e){serviceError=state.update?.phase==='installing'?'':'无法连接本地工具服务：'+e.message;render();}setTimeout(tick,500);}tick();
