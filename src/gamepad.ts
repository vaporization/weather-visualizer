export function deadzone(value:number, threshold=.18){return Math.abs(value)<=threshold?0:Math.sign(value)*(Math.abs(value)-threshold)/(1-threshold);}
export function readPad(pad:Gamepad|null){
 if(!pad?.connected || pad.mapping!=='standard')return null;
 return {moveX:deadzone(pad.axes[0]??0),moveY:deadzone(pad.axes[1]??0),lookX:deadzone(pad.axes[2]??0),lookY:deadzone(pad.axes[3]??0),zoom:(pad.buttons[6]?.value??0)-(pad.buttons[7]?.value??0),select:!!pad.buttons[0]?.pressed,reset:!!pad.buttons[1]?.pressed,level:!!pad.buttons[3]?.pressed};
}

export function connectedPads(): Gamepad[] {
 try{return Array.from(navigator.getGamepads?.()??[]).filter((p):p is Gamepad=>!!p?.connected);}catch{return [];}
}
export function gamepadAccessMessage(){
 if(!navigator.getGamepads)return 'This browser does not support gamepads.';
 try{navigator.getGamepads();return '';}catch{return 'This browser blocks gamepad access. Open the app in Chrome or Edge.';}
}
