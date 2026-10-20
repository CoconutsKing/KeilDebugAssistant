export const themes=['forest','ocean','violet','amber','dark'];
export function preferences(input={}){return {theme:themes.includes(input.theme)?input.theme:'forest',collapsed:input.collapsed===true,guideOpen:input.guideOpen!==false};}
