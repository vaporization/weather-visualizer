import * as THREE from 'three';
/** Smooth automatic tilt between 1.5 km and 0.5 km above sea level. */
export function cameraTiltPercent(altitudeKm: number, manualPercent: number, locked: boolean) {
  if (locked) return manualPercent;
  const t = Math.max(0, Math.min(1, (1.5 - altitudeKm)));
  return 100 * t * t * (3 - 2 * t);
}

/** Align projected geographic north with screen up without changing the aim. */
export function applyNorthUp(camera:THREE.Camera){
 const forward=camera.getWorldDirection(new THREE.Vector3()),normal=camera.position.clone().normalize();
 const north=new THREE.Vector3(0,1,0).addScaledVector(normal,-normal.y);
 north.addScaledVector(forward,-north.dot(forward));
 if(north.lengthSq()>1e-10){const savedUp=camera.up.clone();camera.up.copy(north.normalize());camera.lookAt(camera.position.clone().add(forward));camera.up.copy(savedUp);}
}

/** Clockwise screen angle of local geographic north; null at an undefined pole/view. */
export function northScreenAngle(camera:THREE.Camera){
 const normal=camera.position.clone().normalize();
 const north=new THREE.Vector3(0,1,0).addScaledVector(normal,-normal.y);
 north.applyQuaternion(camera.quaternion.clone().invert());
 return north.x*north.x+north.y*north.y<1e-10?null:Math.atan2(north.x,north.y)*180/Math.PI;
}

/** Screen-relative look, bounded to the visible globe without rotating the camera's position. */
export function lookWithStick(camera:THREE.Camera, x:number, y:number, seconds:number){
 const rate=.65*Math.min(seconds,.05);
 camera.rotateY(-x*rate);
 camera.rotateX(-y*rate);
 const nadir=camera.position.clone().normalize().negate();
 const forward=camera.getWorldDirection(new THREE.Vector3());
 const limit=Math.min(1.4,Math.max(0,Math.asin(Math.min(1,1/camera.position.length()))-.04));
 const angle=Math.acos(THREE.MathUtils.clamp(forward.dot(nadir),-1,1));
 if(angle>limit){
  const tangent=forward.clone().addScaledVector(nadir,-forward.dot(nadir)).normalize();
  const bounded=nadir.clone().multiplyScalar(Math.cos(limit)).addScaledVector(tangent,Math.sin(limit));
  camera.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(forward,bounded));
 }
 camera.updateMatrixWorld();
}

/** Move over the ground in view-relative directions, even while looking toward the horizon. */
export function moveOverGlobe(camera:THREE.Camera,target:THREE.Vector3,x:number,y:number,seconds:number){
 const normal=camera.position.clone().normalize();
 const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
 right.addScaledVector(normal,-right.dot(normal));
 if(right.lengthSq()<1e-10)return;
 right.normalize();const ahead=normal.clone().cross(right).normalize();
 const magnitude=Math.max(1,Math.hypot(x,y));
 const altitude=Math.max(.065,(camera.position.length()-1)*6371);
 const speed=Math.min(seconds,.05)*.65*Math.min(1,altitude/3000);
 const next=normal.clone().addScaledVector(right,x/magnitude*speed).addScaledVector(ahead,-y/magnitude*speed).normalize();
 const turn=new THREE.Quaternion().setFromUnitVectors(normal,next);
 camera.position.applyQuaternion(turn);camera.up.applyQuaternion(turn);camera.quaternion.premultiply(turn);target.applyQuaternion(turn);
 camera.updateMatrixWorld();
}

/** Blend from orbital orientation to a gravity-level horizon on approach.
 * Keep the view direction and position exactly unchanged; only remove camera bank.
 */
export function levelSurfaceHorizon(camera:THREE.Camera,force=false){
 const vertical=camera.position.clone().normalize(),forward=camera.getWorldDirection(new THREE.Vector3());
 const projectedUp=vertical.clone().addScaledVector(forward,-vertical.dot(forward));
 if(projectedUp.lengthSq()<1e-10){if(force)applyNorthUp(camera);return;}
 const inclination=Math.acos(THREE.MathUtils.clamp(-vertical.dot(forward),-1,1));
 const altitude=(camera.position.length()-1)*6371;
 const weight=force?1:(1-THREE.MathUtils.smoothstep(altitude,20,200))*THREE.MathUtils.smoothstep(inclination,.08,.55);
 if(weight<=0)return;
 const screenUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
 projectedUp.normalize();
 const angle=Math.atan2(forward.dot(screenUp.clone().cross(projectedUp)),screenUp.dot(projectedUp));
 camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(forward,angle*weight));
 camera.updateMatrixWorld();
}
