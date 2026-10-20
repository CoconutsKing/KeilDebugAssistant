export function flattenGroup(name,describe,children,{limit=512,maxDepth=8}={}){
 const rows=[];let truncated=false;
 function walk(path,depth){if(rows.length>=limit){truncated=true;return;}const meta=describe(path);if(!meta)return;
  if((meta.array||meta.aggregate)&&depth<maxDepth){const members=children(path)||[];if(members.length){for(const member of members)walk(member.name,depth+1);return;}}
  if((meta.array||meta.aggregate)&&depth>=maxDepth)truncated=true;
  rows.push({name:path,...meta,editable:false});
 }
 const root=describe(name);if(root?.array||root?.aggregate)walk(name,0);
 return {rows,truncated};
}
