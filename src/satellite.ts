import * as THREE from 'three';
type Entry = { rgb: number[]; value: number };
export function opticalOpacity(tau: number) { return Math.max(0, Math.min(1, tau / (tau + 7.7))); }
export async function loadSatellite(date: string, signal: AbortSignal) {
  const paletteResponse = await fetch('/api/satellite-palette', { signal });
  if (!paletteResponse.ok) throw new Error('Satellite palette unavailable');
  const { entries } = await paletteResponse.json() as { entries: Entry[] };
  if (!entries?.length) throw new Error('Empty satellite palette');
  const cache = new Map<number, number>(); entries.forEach(e => cache.set((e.rgb[0] << 16) | (e.rgb[1] << 8) | e.rgb[2], opticalOpacity(e.value)));
  const opacity = (r: number, g: number, b: number) => {
    const key = (r << 16) | (g << 8) | b; if (cache.has(key)) return cache.get(key)!;
    let nearest = entries[0], distance = Infinity;
    for (const entry of entries) { const d = (r - entry.rgb[0]) ** 2 + (g - entry.rgb[1]) ** 2 + (b - entry.rgb[2]) ** 2; if (d < distance) { distance = d; nearest = entry; } }
    const result = distance < 900 ? opticalOpacity(nearest.value) : 0; cache.set(key, result); return result;
  };
  const images = await Promise.allSettled(['terra', 'aqua'].map(async instrument => {
    const r = await fetch(`/api/satellite/${date}?instrument=${instrument}`, { signal }); if (!r.ok) throw new Error('Satellite image unavailable');
    return createImageBitmap(await r.blob());
  }));
  const valid = images.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  if (!valid.length) throw new Error('Satellite imagery unavailable');
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const result = context.createImageData(2048, 1024);
  for (const bitmap of valid) {
    context.clearRect(0, 0, 2048, 1024); context.drawImage(bitmap, 0, 0, 2048, 1024); bitmap.close();
    const source = context.getImageData(0, 0, 2048, 1024).data;
    for (let i = 0; i < source.length; i += 4) {
      result.data[i] = result.data[i + 1] = result.data[i + 2] = 255;
      if (source[i + 3]) result.data[i + 3] = Math.max(result.data[i + 3], Math.round(opacity(source[i], source[i + 1], source[i + 2]) * source[i + 3]));
    }
  }
  context.putImageData(result, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = THREE.RepeatWrapping; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  return { texture, instruments: valid.length };
}
