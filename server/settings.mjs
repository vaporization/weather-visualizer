import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Provider keys entered in the browser. Only when the server runs for a browser (the desktop shell
// owns settings.json and passes keys as environment); values apply immediately and persist to
// .env.local. The route answers same-origin requests only, and never returns a key in full.
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
export const PROVIDER_KEYS = {
  FLIGHT_CONTACT: { label: 'Flight contact', max: 200, secret: false, valid: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^https:\/\/\S+$/.test(v), advice: 'an email address or HTTPS project URL' },
  ESRI_API_KEY: { label: 'ArcGIS API key', max: 600, secret: true, valid: v => /^[A-Za-z0-9_.-]+$/.test(v), advice: 'letters, digits, dots, hyphens and underscores' },
  FIRMS_MAP_KEY: { label: 'NASA FIRMS map key', max: 200, secret: true, valid: v => /^[A-Za-z0-9_-]+$/.test(v), advice: 'letters, digits, hyphens and underscores' },
  AISSTREAM_API_KEY: { label: 'AISStream API key', max: 200, secret: true, valid: v => /^[A-Za-z0-9_-]+$/.test(v), advice: 'letters, digits, hyphens and underscores' },
  TOMTOM_API_KEY: { label: 'TomTom API key', max: 200, secret: true, valid: v => /^[A-Za-z0-9_-]+$/.test(v), advice: 'letters, digits, hyphens and underscores' },
};
export function validateKeys(values) {
  const out = {};
  for (const [name, rule] of Object.entries(PROVIDER_KEYS)) {
    if (!(name in values)) continue;
    const v = String(values[name] ?? '').trim();
    if (v.length > rule.max || /[\r\n]/.test(v)) throw new Error(`${rule.label} is too long`);
    if (v && !rule.valid(v)) throw new Error(`${rule.label} should be ${rule.advice}`);
    out[name] = v;
  }
  return out;
}
export function mergeEnv(text, values) {
  const lines = String(text ?? '').split(/\r?\n/), seen = new Set();
  const kept = lines.map(line => { const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line); if (!m || !(m[1] in values)) return line; seen.add(m[1]); return values[m[1]] ? `${m[1]}=${values[m[1]]}` : null; }).filter(l => l !== null);
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  for (const [name, value] of Object.entries(values)) if (!seen.has(name) && value) kept.push(`${name}=${value}`);
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '') + '\n';
}
const mask = (name, value) => !value ? '' : PROVIDER_KEYS[name].secret ? `…${value.slice(-4)}` : value;
const sameOrigin = req => { const site = req.get('sec-fetch-site'); if (site && site !== 'same-origin' && site !== 'none') return false; const origin = req.get('origin'); return !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin); };
export function registerSettings(app) {
  const desktop = !!process.env.WEATHER_DESKTOP;
  const status = () => ({ desktop, keys: Object.fromEntries(Object.entries(PROVIDER_KEYS).map(([name, rule]) => [name, { label: rule.label, set: !!process.env[name], hint: mask(name, process.env[name]) }])) });
  app.get('/api/settings', (req, res) => { if (!sameOrigin(req)) return res.status(403).json({ error: 'Same-origin only' }); res.set('Cache-Control', 'no-store').json(status()); });
  app.post('/api/settings', express.json({ limit: '8kb' }), (req, res) => {
    if (desktop) return res.status(403).json({ error: 'The desktop app keeps keys in File > Settings.' });
    if (!sameOrigin(req) || !req.is('application/json')) return res.status(403).json({ error: 'Same-origin JSON only' });
    let values; try { values = validateKeys(req.body ?? {}); } catch (e) { return res.status(400).json({ error: e.message }); }
    for (const [name, value] of Object.entries(values)) { if (value) process.env[name] = value; else delete process.env[name]; }
    try { fs.writeFileSync(ENV_FILE, mergeEnv(fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '', values), { mode: 0o600 }); }
    catch { return res.status(500).json({ error: 'Keys applied for this session but .env.local could not be written.', ...status() }); }
    res.json({ saved: Object.keys(values), ...status() });
  });
}
