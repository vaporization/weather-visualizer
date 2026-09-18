// Shared by the wind heatmap and animated flow trails. Speeds are km/h.
export const windPaletteGLSL = `
vec3 windSpeedColor(float speed) {
  float v=clamp(speed/100.,0.,1.);
  vec3 color=mix(vec3(.12,.76,.37),vec3(1.,.84,.14),smoothstep(0.,.5,v));
  return mix(color,vec3(.93,.12,.12),smoothstep(.5,1.,v));
}`;
