export function createMemberSelection(rows,selection){
 const available=new Set(rows.map(row=>row.name)),chosen=new Set(selection===undefined?available:selection.filter(name=>available.has(name)));
 return {
  has:name=>chosen.has(name),
  set(names,checked){for(const name of names)if(available.has(name)){if(checked)chosen.add(name);else chosen.delete(name);}},
  rows(query=''){const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);return rows.filter(row=>words.every(word=>(row.name+' '+(row.type||'')).toLowerCase().includes(word)));},
  get count(){return chosen.size;},
  value(){return chosen.size===available.size?undefined:rows.filter(row=>chosen.has(row.name)).map(row=>row.name);}
 };
}
