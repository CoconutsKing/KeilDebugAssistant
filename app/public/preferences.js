export const themes=['forest','ocean','violet','amber','dark'];
export function preferences(input={}){return {theme:themes.includes(input.theme)?input.theme:'forest',collapsed:input.collapsed===true,guideOpen:input.guideOpen!==false,guideDismissed:input.guideDismissed===true};}
export function createPreferenceController({save,onChange=()=>{},onError=()=>{}}){
 let remote=preferences(),pending={},queued={},versions={},generation=0,saving=false;
 const current=()=>preferences({...remote,...pending});
 async function flush(){
  if(saving)return;saving=true;
  try{while(Object.keys(queued).length){
   const patch=queued,sentVersions={...versions};queued={};let failure;
   try{remote=preferences(await save(patch));}catch(e){failure=e;}
   for(const key of Object.keys(patch))if(versions[key]===sentVersions[key])delete pending[key];
   onChange(current());if(failure)onError(failure);
  }}finally{saving=false;}
 }
 return {
  get current(){return current();},
  reconcile(input){remote=preferences(input);onChange(current());},
  set(patch){for(const key of ['theme','collapsed','guideOpen','guideDismissed'])if(Object.hasOwn(patch,key)){pending[key]=queued[key]=patch[key];versions[key]=++generation;}onChange(current());void flush();}
 };
}
