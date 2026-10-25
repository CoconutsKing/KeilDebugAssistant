import {validName} from './model.mjs';
export function validateLayout(layout){
 if(!layout||!['grid','free'].includes(layout.mode)||!layout.widgets||typeof layout.widgets!=='object'||Array.isArray(layout.widgets)||Object.keys(layout.widgets).length>500)throw Error('布局格式无效');
 if(layout.placement!==undefined&&layout.placement!=='canvas')throw Error('布局定位方式无效');
 const widgets={};for(const [name,rect] of Object.entries(layout.widgets)){if(!validName(name)||!rect)throw Error('布局组件无效');const {x,y,width,height}=rect;if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||x>20000||y>20000||width<280||width>4000||height<180||height>10000)throw Error('组件位置或大小超出范围');widgets[name]={x,y,width,height};}return {mode:layout.mode,...(layout.mode==='free'&&layout.placement==='canvas'?{placement:'canvas'}:{}),widgets};
}
