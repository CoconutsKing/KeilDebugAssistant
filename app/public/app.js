import {createControl} from '/controls.js';
import {createLayout} from '/layout.js';
import {replaceConfiguredItem} from '/editor.js';
import {searchVariables} from '/search.js';
const $=id=>document.getElementById(id);let state={items:[]},onlyPinned=false,editing=null,memberEditing=null,revision=0;
const labels={disconnected:'未连接',connecting:'正在连接',waiting:'等待 Debug',running:'● 目标运行中',halted:'● 目标已暂停',demo:'● 演示模式',error:'连接异常 / 重试中'};
async function api(path,data){const context=data.sessionId??state.sessionId;revision++;for(let attempt=0;attempt<40;attempt++){const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Keil-Client':'1'},body:JSON.stringify({...data,sessionId:context,...(['write','toggle'].includes(path)?{sessionKey:data.sessionKey??state.sessionKey}:{})})});const b=await r.json();if(r.status===409){await new Promise(r=>setTimeout(r,150));continue;}if(!r.ok)throw Error(b.error||'请求失败');revision++;state=b;if(path==='write'||path==='toggle')render();return b;}throw Error('Keil 正忙，请稍后重试');}
function error(e){$('error').textContent=e.message;}
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function configs(){return state.items.map(({name,min,max,step,pinned,members})=>({name,min,max,step,pinned,...(members?{members}:{})}));}
const cardsByName=new Map();let renderedSession='';
const layoutController=createLayout({container:$('cards'),save:layout=>api('layout',{layout}),onError:error,onMode:editing=>{$('layoutEdit').textContent=editing?'完成排版':'编辑布局';$('layoutHint').hidden=!editing;}});
$('layoutEdit').onclick=()=>layoutController.toggle();$('layoutReset').onclick=()=>layoutController.reset();
const visibleRoots=new Set();let priorityTimer=null,lastPriority='';
const visibility=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visibleRoots.add(entry.target.dataset.root);else visibleRoots.delete(entry.target.dataset.root);}clearTimeout(priorityTimer);priorityTimer=setTimeout(()=>{const names=[...visibleRoots].filter(name=>cardsByName.has(name)).sort(),key=JSON.stringify(names);if(key!==lastPriority){lastPriority=key;void api('priority',{names}).catch(error);}},150);},{rootMargin:'250px'});
function render(){
 if(renderedSession!==state.sessionId){for(const entry of cardsByName.values()){entry.controls.forEach(c=>c.dispose());visibility.unobserve(entry.card);entry.card.remove();}cardsByName.clear();visibleRoots.clear();lastPriority='';layoutController.replace(state.layout);renderedSession=state.sessionId;for(const id of ['editor','membersDialog'])if($(id).open)$(id).close();}

 $('status').textContent=labels[state.status]||state.status;$('error').textContent=state.lastError||state.compatibility||'';$('count').textContent=`${state.items.length} 个变量`;$('session').textContent=state.mode==='demo'?'演示数据 · 不连接硬件':'127.0.0.1 · UVSOCK';$('project').textContent=state.projectPath||'尚未选择工程 · 连接窗口自动识别，或点击更换来源';renderSessions();applyPreferences();
 const query=$('search').value.toLowerCase(),items=state.items.filter(v=>(!onlyPinned||v.pinned)&&v.name.toLowerCase().includes(query));
 const cards=$('cards');
 cards.querySelector('.empty')?.remove();
 for(const [name,entry] of cardsByName)if(!items.some(v=>v.name===name)){entry.controls.forEach(c=>c.dispose());visibility.unobserve(entry.card);visibleRoots.delete(name);entry.card.remove();cardsByName.delete(name);}
 cards.dataset.filtered=String(!!query||onlyPinned);
 if(!items.length){cards.append(element('div','empty','暂无变量。请从下拉列表添加要观测的变量。'));layoutController.sync(state.layout);return;}
 for(const v of items){
  const rows=v.children||[v],signature=JSON.stringify([v.name,rows.map(r=>r.name),v.pinned]);let entry=cardsByName.get(v.name);
  if(entry?.signature!==signature){entry?.controls.forEach(c=>c.dispose());if(entry)visibility.unobserve(entry.card);entry?.card.remove();
   const card=element('article',v.children?'card group-card':'card'),head=element('div','card-head');head.append(element('h3','',v.name));
   const pin=element('button','icon',v.pinned?'★':'☆');pin.title='收藏到调参面板';pin.onclick=()=>updateItem(v.name,{pinned:!state.items.find(x=>x.name===v.name)?.pinned});
   const edit=element('button','icon','⚙');edit.title='修改变量与范围';edit.setAttribute('aria-label','配置 '+v.name);edit.onclick=()=>{memberEditing=null;void openEditor(state.items.find(x=>x.name===v.name));};
   const remove=element('button','icon','×');remove.title='移除变量';remove.setAttribute('aria-label','移除 '+v.name);remove.onclick=async()=>{remove.disabled=true;try{await api('items',{items:configs().filter(x=>x.name!==v.name)});render();}catch(e){remove.disabled=false;error(e);}};
   head.append(pin,edit,remove);card.append(head,element('p','type',v.children?`${v.type||''} · ${rows.length} 项 · 滑条上滚轮可直接调节`:v.type||'等待采样'));
   if(v.truncated)card.append(element('p','card-error','此组超过 512 项或展开深度限制；请单独选择子数组继续观测。'));
   const controlSession={sessionKey:state.sessionKey,sessionId:state.sessionId};const controls=rows.map(row=>createControl(row,{root:v.name,api:(path,data)=>api(path,{...data,...controlSession}),settings:current=>{memberEditing=v.children?{root:v.name,name:current.name}:null;void openEditor(current);}}));const body=element('div','widget-body');for(const control of controls)body.append(control.element);card.append(body);
   entry={card,controls,signature};card.dataset.root=v.name;cardsByName.set(v.name,entry);cards.append(card);visibility.observe(card);
  }
  entry.controls.forEach((control,i)=>control.update({...rows[i],editable:rows[i].editable&&['running','halted','demo'].includes(state.status)}));
  entry.card.querySelector(':scope > .type').textContent=v.children?`${v.type||''} · ${rows.length} 项 · 滑条上滚轮可直接调节`:v.type||'等待采样';
 }
 items.forEach((item,index)=>{const card=cardsByName.get(item.name).card;if(cards.children[index]!==card)cards.insertBefore(card,cards.children[index]||null);});
 layoutController.sync(state.layout);
 $('updated').textContent='界面更新 '+new Date().toLocaleTimeString();
}
async function updateItem(name,patch){try{await api('items',{items:configs().map(v=>v.name===name?{...v,...patch}:v)});render();}catch(e){error(e);}}
let variableOptions=[],selectionVersion=0;
async function openEditor(v,chosenName){
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
function runVariableSearch(){selectionVersion++;if(!memberEditing){$('name').value='';$('variableLevels').replaceChildren();$('selectionValue').textContent='请从搜索结果或下拉列表选择变量。';}return fillVariableOptions();}
async function selectVariable(name,depth){
 const version=++selectionVersion;$('name').value=name;const levels=$('variableLevels');while(levels.children.length>depth)levels.lastElementChild.remove();$('selectionValue').textContent='正在读取 '+name+'…';if(!name)return;
 try{
  const preview=await api('preview',{name});if(version!==selectionVersion)return;const v=preview.selected;$('selectionValue').textContent=`${name} = ${v.pointer?'指针（请选择成员）':v.value}　${v.type||''}`;
  if(!v.array&&!v.aggregate&&!v.pointer)return;
  const result=await api('members',{name});if(version!==selectionVersion)return;appendMemberSelect(name,result,depth,version);
 }catch(e){if(version===selectionVersion)$('selectionValue').textContent=e.message;}
}
function appendMemberSelect(name,result,depth,version){
 const label=element('label','','选择数组元素 / 成员'),select=element('select');const placeholder=element('option','','请选择具体元素或成员');placeholder.value='';select.append(placeholder);
 for(const member of result.members){const option=element('option','',`${member.name}　${member.value??member.type??''}`);option.value=member.name;select.append(option);}
 if(result.nextOffset!==null){const more=element('option','','下一页…');more.value='__more__';select.append(more);}
 label.append(select);$('variableLevels').append(label);
 select.onchange=async()=>{if(select.value==='__more__'){try{const next=await api('members',{name,offset:result.nextOffset});if(!label.isConnected)return;while($('variableLevels').children.length>depth+1)$('variableLevels').lastElementChild.remove();label.remove();appendMemberSelect(name,next,depth,selectionVersion);}catch(e){$('selectionValue').textContent=e.message;}}else if(select.value)void selectVariable(select.value,depth+1);else void selectVariable(name,depth);};
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
$('add').onclick=()=>{memberEditing=null;void openEditor();};$('cancel').onclick=()=>$('editor').close();$('form').onsubmit=async e=>{e.preventDefault();try{const item={name:$('name').value.trim(),min:Number($('min').value),max:Number($('max').value),step:Number($('step').value),pinned:$('pinned').checked};let next=configs();if(memberEditing){const parent=next.find(v=>v.name===memberEditing.root);if(!parent)throw Error('变量已被移除');parent.members={...parent.members,[memberEditing.name]:{min:item.min,max:item.max,step:item.step}};}else if(editing)next=replaceConfiguredItem(next,editing,item);else next.push(item);const rename=editing&&!memberEditing&&editing!==item.name?{from:editing,to:item.name,layout:layoutController.capture()}:null;await api('items',{items:next,...(rename?{rename}:{}),...(!editing?{remember:item}:{})});$('editor').close();memberEditing=null;render();}catch(e){$('formError').textContent=e.message;}};
async function connectSession(){try{const chosen=$('instance').value;await api('connect',{mode:$('mode').value,port:chosen==='auto'?Number($('port').value):Number(chosen),selection:chosen});render();}catch(e){error(e);}}
$('connect').onclick=connectSession;$('instance').onchange=()=>{if(state.mode==='keil')void connectSession();};
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
function renderSessions(){$('refreshSessions').disabled=!!state.discovering;$('refreshSessions').textContent=state.discovering?'正在识别…':'刷新窗口';const list=state.sessions||[],key=JSON.stringify(list.map(v=>[v.pid,v.port,v.status,v.title]));if(key!==sessionOptions){const selected=$('instance').value;sessionOptions=key;$('instance').replaceChildren(new Option('自动 · 寻找 Debug 会话','auto'));for(const session of list){const label=(session.title||'Keil')+' · '+(session.port?'端口 '+session.port+' · '+(labels[session.status]||session.status):'无端口，请配置 UVSOCK');const option=new Option(label,session.port||'pid:'+session.pid);option.disabled=!session.port;$('instance').append(option);}if([...$('instance').options].some(o=>o.value===selected))$('instance').value=selected;}
 $('connectedTarget').textContent=state.session?'当前窗口：'+state.session.title+' · 端口 '+state.session.port:'选择正在调试的 Keil 窗口后自动识别工程';
 $('sessionHint').textContent=state.sessionError||((state.discovering?(['running','halted'].includes(state.status)?'正在后台识别窗口，当前会话的变量仍持续采样。 ':'正在后台识别 Keil 窗口，首次连接请稍候。 '):'')+(list.some(s=>!s.port)?'发现未监听端口的 Keil 窗口：请在各窗口的 Other 配置中设置不同端口。 ':'')+(state.mode==='keil'?'自动模式保留当前 Debug 会话；需要切换时请在下拉列表选择窗口。':'连接前可点击“刷新窗口”查看已打开的 Keil。'));}
function applyPreferences(){const p=state.preferences||{},key=JSON.stringify(p);if(key===prefsApplied)return;prefsApplied=key;document.documentElement.dataset.theme=p.theme||'forest';document.body.classList.toggle('sidebar-collapsed',!!p.collapsed);$('theme').value=p.theme||'forest';$('guide').open=p.guideOpen!==false;$('sidebarToggle').setAttribute('aria-expanded',String(!p.collapsed));$('sidebarToggle').setAttribute('aria-label',p.collapsed?'展开侧栏':'收起侧栏');}
async function setPreference(patch){try{await api('preferences',{preferences:patch});applyPreferences();}catch(e){error(e);}}
$('theme').onchange=()=>void setPreference({theme:$('theme').value});$('sidebarToggle').onclick=()=>void setPreference({collapsed:!state.preferences?.collapsed});
$('guideDone').onclick=()=>void setPreference({guideOpen:false});$('help').onclick=()=>{void setPreference({guideOpen:true});$('guide').scrollIntoView({behavior:'smooth',block:'start'});};
$('guide').ontoggle=()=>{if(state.preferences&&$('guide').open!==state.preferences.guideOpen)void setPreference({guideOpen:$('guide').open});};
$('demoStart').onclick=()=>{$('mode').value='demo';void connectSession();};
async function tick(){try{const version=revision;const r=await fetch('/api/state');if(!r.ok)throw Error('服务不可用');const result=await r.json();if(version===revision){state=result;render();}}catch(e){error(e);}setTimeout(tick,500);}tick();
