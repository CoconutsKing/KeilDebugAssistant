export function isIntegerVariable({type='',pointer=false,array=false,aggregate=false}={}){
 return !pointer&&!array&&!aggregate&&!/\b(?:float|double)\b/i.test(type)&&/\b(?:bool|_Bool|char|short|int|long|signed|unsigned|enum|u?int(?:(?:_fast|_least)?(?:8|16|32|64))?(?:_t)?|__int(?:8|16|32|64)|wchar_t|char(?:8|16|32)_t|u?intptr_t|s?size_t|ptrdiff_t)\b/i.test(type);
}
export function formatValue(variable,hex=variable.hex){
 const text=String(variable.value??'—');if(!isIntegerVariable(variable))return text;
 let integer;try{
  const raw=text.trim(),signedHex=raw.match(/^([+-])0x([\da-f]+)$/i);
  if(signedHex)integer=(signedHex[1]==='-'?-1n:1n)*BigInt('0x'+signedHex[2]);
  else if(/^(?:[+-]?\d+|0x[\da-f]+)$/i.test(raw))integer=BigInt(raw);
  else return text;
 }catch{return text;}
 return hex?(integer<0n?'-':'')+'0x'+(integer<0n?-integer:integer).toString(16).toUpperCase():integer.toString();
}
