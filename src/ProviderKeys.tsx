import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { getJSON } from './weather';
// Browser-mode entry for provider keys. The server only ever reports whether a key is set (plus a
// masked tail), so nothing secret round-trips back to the page; a saved key applies at once.
type KeyStatus = { label: string; set: boolean; hint: string };
type Settings = { desktop: boolean; keys: Record<string, KeyStatus> };
const guidance: Record<string, { about: string; href: string; site: string; placeholder: string }> = {
  FLIGHT_CONTACT: { about: 'Contact sent with flight requests so ADSB.lol can reach you', href: 'https://www.adsb.lol/docs/open-data/api/', site: 'adsb.lol', placeholder: 'you@example.com' },
  ESRI_API_KEY: { about: 'Higher-quota surface imagery', href: 'https://location.arcgis.com/', site: 'location.arcgis.com', placeholder: 'AAPT…' },
  FIRMS_MAP_KEY: { about: 'Active fires (VIIRS)', href: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/', site: 'firms.modaps.eosdis.nasa.gov', placeholder: '32 characters' },
  AISSTREAM_API_KEY: { about: 'Ships (AIS)', href: 'https://aisstream.io/', site: 'aisstream.io', placeholder: 'from your AISStream dashboard' },
  TOMTOM_API_KEY: { about: 'Traffic congestion (flow tiles)', href: 'https://developer.tomtom.com/', site: 'developer.tomtom.com', placeholder: 'from your TomTom dashboard' },
};
export default function ProviderKeys({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    getJSON<Settings>('/api/settings', c.signal).then(s => { setSettings(s); setDraft({}); setMessage(''); }).catch(e => setMessage((e as Error).message));
    return () => c.abort();
  }, [open]);
  const submit = async (values: Record<string, string>) => {
    if (!Object.keys(values).length) { setMessage('Nothing changed.'); return; }
    setBusy(true); setMessage('');
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const body = await r.json() as Settings & { error?: string; saved?: string[] };
      if (!r.ok) throw new Error(body.error || `Save failed (${r.status})`);
      setSettings(body); setDraft({}); setMessage('Saved. Layers that needed a key are reloading.'); onSaved();
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  // Only typed values are sent, so an emptied field keeps the stored key; clearing is explicit.
  const save = () => submit(Object.fromEntries(Object.entries(draft).map(([n, v]) => [n, v.trim()]).filter(([, v]) => v)));
  const clear = (name: string) => submit({ [name]: '' });
  const count = settings ? Object.values(settings.keys).filter(k => k.set).length : 0;
  return <details className="layer-notes provider-keys" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
    <summary><KeyRound size={12}/> Provider keys <small>{settings ? `${count}/${Object.keys(settings.keys).length} set` : ''}</small></summary>
    {!settings && !message && <small role="status"><LoaderCircle size={12} className="spin"/> Checking which keys are set…</small>}
    {settings?.desktop && <small>The desktop app keeps keys under File → Settings. Enter them there and they apply to every layer.</small>}
    {settings && !settings.desktop && <>
      <small>Keys are held by the local server only and saved to <code>.env.local</code> in the project folder. They are never sent anywhere but the provider they belong to, and never shown here in full. A blank field keeps what is already set. <a href="/docs/API-KEYS.html" target="_blank" rel="noreferrer">How to get each key</a>.</small>
      {Object.entries(settings.keys).map(([name, k]) => { const g = guidance[name]; return <label key={name} className="key-field">
        <span>{k.label}<small>{g?.about}{g && <> · <a href={g.href} target="_blank" rel="noreferrer">{g.site}</a></>}</small></span>
        <span className="key-input"><input aria-label={k.label} type={name === 'FLIGHT_CONTACT' ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder={k.set ? `Set (${k.hint})` : g?.placeholder || 'Not set'} value={draft[name] ?? ''} onChange={e => setDraft(d => ({ ...d, [name]: e.target.value }))}/>{k.set && <button type="button" aria-label={`Clear ${k.label}`} disabled={busy} onClick={() => { void clear(name); }}>Clear</button>}</span>
      </label>; })}
      <button className="street-focus" disabled={busy} onClick={() => { void save(); }}>{busy ? <LoaderCircle size={12} className="spin"/> : null} Save keys</button>
    </>}
    {message && <small role="status">{message}</small>}
  </details>;
}
