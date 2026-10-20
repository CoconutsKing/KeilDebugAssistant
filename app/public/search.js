export function searchVariables(variables,query){
 const normalize=text=>String(text??'').normalize('NFKC').toLocaleLowerCase().trim();
 const tokens=normalize(query).split(/\s+/).filter(Boolean);
 if(!tokens.length)return [...variables];
 return variables.filter(variable=>tokens.every(token=>normalize(variable.name+' '+(variable.type||'')).includes(token)))
  .sort((a,b)=>Number(normalize(b.name).startsWith(tokens[0]))-Number(normalize(a.name).startsWith(tokens[0]))||a.name.localeCompare(b.name));
}
