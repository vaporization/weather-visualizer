import { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Minus, Maximize2 } from 'lucide-react';

export function panelAction(action: 'minimize' | 'restore' | 'reset') {
  window.dispatchEvent(new CustomEvent('atmo-panels', { detail: action }));
}

export default function PanelChrome({ title }: { title: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const [minimized, setMinimized] = useState(false);
  const drag = useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null);
  const moved = useRef(false);
  const root = () => bar.current!.parentElement!;
  const position = (left:number, top:number) => {
    const panel=root(), box=panel.getBoundingClientRect();
    Object.assign(panel.style,{position:'fixed',left:`${Math.max(8,Math.min(left,innerWidth-box.width-8))}px`,top:`${Math.max(8,Math.min(top,innerHeight-Math.min(box.height,innerHeight-16)-8))}px`,right:'auto',bottom:'auto',width:`${Math.min(box.width,innerWidth-16)}px`,zIndex:'12'});
    moved.current=true;
  };
  useEffect(()=>{root().classList.add('managed-panel');},[]);
  useEffect(()=>{root().dataset.minimized=String(minimized);if(moved.current){const b=root().getBoundingClientRect();position(b.left,b.top);}},[minimized]);
  useEffect(()=>{
    const action=(e:Event)=>{const value=(e as CustomEvent).detail;setMinimized(value==='minimize');if(value==='reset'){root().removeAttribute('style');moved.current=false;}};
    const resize=()=>{if(moved.current){const b=root().getBoundingClientRect();position(b.left,b.top);}};
    window.addEventListener('atmo-panels',action);window.addEventListener('resize',resize);
    return()=>{window.removeEventListener('atmo-panels',action);window.removeEventListener('resize',resize);};
  },[]);
  return <div className="panel-chrome" ref={bar}>
    <button className="panel-grip" aria-label={`Move ${title} panel`} title="Drag to move · arrow keys to nudge" onPointerDown={e=>{if(e.button!==0)return;const b=root().getBoundingClientRect();drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:b.left,top:b.top};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}} onPointerMove={e=>{const d=drag.current;if(d&&d.id===e.pointerId)position(d.left+e.clientX-d.x,d.top+e.clientY-d.y);}} onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}} onKeyDown={e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const b=root().getBoundingClientRect(),step=e.shiftKey?40:10;position(b.left+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),b.top+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0));}}><GripHorizontal size={13}/><span>{title}</span></button>
    <button className="panel-minimize" aria-label={`${minimized?'Restore':'Minimize'} ${title} panel`} aria-expanded={!minimized} onClick={()=>setMinimized(v=>!v)}>{minimized?<Maximize2 size={12}/>:<Minus size={13}/>}</button>
  </div>;
}
