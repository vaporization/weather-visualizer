import { connectedPads, gamepadAccessMessage } from './gamepad';
import type { FlightData } from './flights';
import type { TornadoData } from './tornado';
import { layerCatalog } from './layers/catalog';
import type { StreetData, StreetOptions } from './StreetOverlay';
import PanelChrome, { panelAction } from './PanelChrome';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Cloud, CloudDrizzle, CloudLightning, CloudRain, Crosshair, Droplets, Globe2, Info, Layers3, LoaderCircle, MapPin, Minus, Navigation, Orbit, Pause, Play, Plus, RotateCcw, Search, Snowflake, Sun, Tornado, Wind, X, Cable, Server, Waves, Activity, Satellite, Flame, Ship, Zap, Bus, Video, Gauge } from 'lucide-react';
import ProviderKeys from './ProviderKeys';
import Globe, { type GlobeAPI, type RenderStats } from './GlobeScene';
import { hourlyIndex, buildAtmosphere, type AtmosphericGrid, type Station, type Quality } from './atmosphere';
import { type GlobalWeather, type MapMode } from './weatherMap';
import { atHour, description, formatCoord, getJSON, places, stormExtentKm, stormShape, stormQuadrantSummary, type Conditions, type Layers, type Location, type Storm, type Weather } from './weather';
const demoConditions: Conditions = { temperature_2m:28, relative_humidity_2m:94, apparent_temperature:33, is_day:1, precipitation:12, rain:12, snowfall:0, weather_code:95, cloud_cover:100, pressure_msl:950, wind_speed_10m:165, wind_direction_10m:75, wind_gusts_10m:210 };
function WeatherIcon({ code=0, size=24 }: {code?:number;size?:number}) {
  const Icon=code>=95?CloudLightning:code>=71&&code<=77||code>=85&&code<=86?Snowflake:code>=61?CloudRain:code>=51?CloudDrizzle:code>=3?Cloud:Sun;
  return <Icon size={size} strokeWidth={1.4}/>;
}
const layerOptions=[{key:'clouds',name:'Clouds',detail:'3D cloud cover',icon:Cloud},{key:'precipitation',name:'Precipitation',detail:'NOAA radar + local rain/snow',icon:CloudRain},{key:'wind',name:'Wind',detail:'Global flow',icon:Wind},{key:'grid',name:'Coordinates',detail:'Latitude & longitude',icon:Globe2}] as const;
export default function App(){
  const [radarStatus,setRadarStatus]=useState('Loading NOAA radar observations…'),[radarOpacity,setRadarOpacity]=useState(75);
  const [flightsOn,setFlightsOn]=useState(false),[flightData,setFlightData]=useState<FlightData|null>(null),[flightStatus,setFlightStatus]=useState('');
  const [gamepadOn,setGamepadOn]=useState(()=>localStorage.getItem('atmo-gamepad')!=='off'),[gamepadStatus,setGamepadStatus]=useState('Connect a controller and press a button.');
  const [tornadoesOn,setTornadoesOn]=useState(false),[tornadoData,setTornadoData]=useState<TornadoData|null>(null),[tornadoStatus,setTornadoStatus]=useState('');
  useEffect(()=>{
    if(!tornadoesOn){setTornadoData(null);return;}
    const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{
      if(document.hidden){timer=setTimeout(load,60000);return;}
      try{
        const d=await getJSON<TornadoData>('/api/tornadoes',c.signal);setTornadoData(d);
        setTornadoStatus(d.warnings.length?`${d.warnings.length} active warned ${d.warnings.length===1?'area':'areas'} · ${d.warnings.filter(w=>w.observed).length} with a tornado observed · ${d.warnings.filter(w=>w.motion).length} tracking a radar-identified cell · ${new Date(d.fetchedAt).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})} UTC`:'No active NWS tornado warnings.');
      }catch(e){if(!c.signal.aborted){setTornadoData(null);setTornadoStatus((e as Error).message);}}
      if(!c.signal.aborted)timer=setTimeout(load,60000);
    };void load();return()=>{c.abort();clearTimeout(timer);};
  },[tornadoesOn]);
  useEffect(()=>{
    if(!flightsOn){setFlightData(null);return;}
    const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{if(document.hidden){timer=setTimeout(load,15000);return;}setFlightStatus('Updating flight positions…');try{const d=await getJSON<FlightData>('/api/flights',c.signal);setFlightData(d);setFlightStatus(`${d.flights.length.toLocaleString()} aircraft · ${new Date(d.timestamp).toLocaleTimeString('en-GB',{timeZone:'UTC'})} UTC`);}catch(e){if(!c.signal.aborted){setFlightData(null);setFlightStatus((e as Error).message);}}if(!c.signal.aborted)timer=setTimeout(load,15000);};void load();return()=>{c.abort();clearTimeout(timer);};
  },[flightsOn]);
  useEffect(()=>{if(!gamepadOn)return;const timer=setInterval(()=>{const p=connectedPads().find(p=>p.mapping==='standard');const other=connectedPads().length>0;setGamepadStatus(gamepadAccessMessage() || (p?'Controller connected · sticks and triggers ready':other?'Controller detected, but its mapping is unsupported.':'No controller detected. Connect it and press A.'));},1000);return()=>clearInterval(timer);},[gamepadOn]);
  const [location,setLocation]=useState<Location>(places[0]);
  const locationRef=useRef(location);locationRef.current=location;
  const layerIcons:Record<string,typeof Cable>={cables:Cable,datacenters:Server,dams:Waves,earthquakes:Activity,satellites:Satellite,fires:Flame,vessels:Ship,power:Zap,transit:Bus,cctv:Video,traffic:Gauge};
  const [extra,setExtra]=useState<Record<string,{on:boolean;data:unknown;status:string}>>({});
  const toggleExtra=(id:string)=>setExtra(e=>({...e,[id]:{on:!e[id]?.on,data:null,status:''}}));
  const loops=useRef(new Map<string,AbortController>());
  const enabledExtra=layerCatalog.filter(s=>extra[s.id]?.on).map(s=>s.id).join(',');
  const regionalKey=`${location.lat.toFixed(2)},${location.lon.toFixed(2)}`,lastRegional=useRef(regionalKey);
  const [keysVersion,setKeysVersion]=useState(0),lastKeys=useRef(0);
  useEffect(()=>{
    const wanted=new Set(enabledExtra?enabledExtra.split(','):[]);
    // Regional layers follow the selection: a move restarts their loops for the new place.
    if(lastRegional.current!==regionalKey){lastRegional.current=regionalKey;for(const spec of layerCatalog) if(typeof spec.url==='function'){loops.current.get(spec.id)?.abort();loops.current.delete(spec.id);}}
    // A newly saved provider key restarts every loop so a layer waiting on it loads now, not at its next refresh.
    if(lastKeys.current!==keysVersion){lastKeys.current=keysVersion;for(const c of loops.current.values())c.abort();loops.current.clear();}
    for(const [id,c] of loops.current) if(!wanted.has(id)){c.abort();loops.current.delete(id);}
    for(const spec of layerCatalog){
      if(!wanted.has(spec.id)||loops.current.has(spec.id))continue;
      const c=new AbortController();loops.current.set(spec.id,c);let timer:ReturnType<typeof setTimeout>;
      const load=async()=>{
        if(document.hidden&&spec.refreshMs){timer=setTimeout(load,spec.refreshMs);return;}
        try{const d=await getJSON<unknown>(typeof spec.url==='function'?spec.url(locationRef.current):spec.url,c.signal);if(c.signal.aborted)return;setExtra(e=>({...e,[spec.id]:{on:true,data:d,status:spec.describe(d)+((d as {stale?:boolean}).stale?' · provider unavailable, last good data':'')}}));}
        catch(e){if(!c.signal.aborted)setExtra(x=>({...x,[spec.id]:{on:true,data:null,status:(e as Error).message}}));}
        if(!c.signal.aborted&&spec.refreshMs)timer=setTimeout(load,spec.refreshMs);
      };
      void load();c.signal.addEventListener('abort',()=>clearTimeout(timer));
    }
  },[enabledExtra,regionalKey,keysVersion]);
  useEffect(()=>()=>{loops.current.forEach(c=>c.abort());},[]);
  const extraLayers=useMemo(()=>Object.fromEntries(layerCatalog.map(s=>[s.id,extra[s.id]?.on?extra[s.id].data:null])),[extra]);
  const [hasSelection,setHasSelection]=useState(false),[streetData,setStreetData]=useState<StreetData|null>(null),[streetStatus,setStreetStatus]=useState(''),[streetRetry,setStreetRetry]=useState(0);
  const [streetOptions,setStreetOptions]=useState<StreetOptions>({roads:false,markers:false,landmarks:false,color:'#ffd166'});
  const [weather,setWeather]=useState<Weather|null>(null),[gridData,setGridData]=useState<AtmosphericGrid|null>(null);
  const [stations,setStations]=useState<Station[]>([]),[observationStatus,setObservationStatus]=useState('Loading airport observations...');
  const [quality,setQuality]=useState<Quality>('high'),[satellite,setSatellite]=useState(false);
  const [mapOpacity,setMapOpacity]=useState(78);
  const [northUp,setNorthUp]=useState(false);
  const [horizonLevel,setHorizonLevel]=useState(false);
  const toggleHorizon=()=>{setHorizonLevel(v=>!v);setNorthUp(false);};
  const [northAngle,setNorthAngle]=useState<number|null>(0);
  const [actualTilt,setActualTilt]=useState(0);
  const [cameraTilt,setCameraTilt]=useState(0),[tiltLocked,setTiltLocked]=useState(false);
  const [mapMode,setMapMode]=useState<MapMode>('natural'),[globalWeather,setGlobalWeather]=useState<GlobalWeather|null>(null),[mapStatus,setMapStatus]=useState('Loading global model...'),[mapRetry,setMapRetry]=useState(0);
  const [stats,setStats]=useState<RenderStats>({fps:0,tiltPercent:0,altitudeKm:17840,gpu:'Starting WebGL2...',terrain:'Loading global elevation...',satellite:'Loading NASA coverage...'});
  const [error,setError]=useState(''),[regionError,setRegionError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const [hour,setHour]=useState(0),[playing,setPlaying]=useState(false);
  const [panelOpacity,setPanelOpacity]=useState(()=>{try{const stored=localStorage.getItem('atmo-panel-opacity');const n=stored===null?94:Number(stored);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):94;}catch{return 94;}});
  useEffect(()=>{try{localStorage.setItem('atmo-panel-opacity',String(panelOpacity));}catch{/* Storage can be disabled. */}},[panelOpacity]);
  const [units,setUnits]=useState<'C'|'F'>(()=>{try{return localStorage.getItem('atmo-units')==='F'?'F':'C';}catch{return 'C';}});
  const [layers,setLayers]=useState<Layers>({clouds:true,precipitation:true,wind:false,grid:true});
  const [query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false),[results,setResults]=useState<Location[]>([]),[searchError,setSearchError]=useState(''),[searching,setSearching]=useState(false);
  const [storms,setStorms]=useState<Storm[]>([]),[stormStatus,setStormStatus]=useState('Loading NHC feed...'),[stormOpen,setStormOpen]=useState(false);
  const [selectedStorm,setSelectedStorm]=useState<Storm|null>(null),[polygons,setPolygons]=useState<number[][][]>([]),[extentStatus,setExtentStatus]=useState('');
  const [demo,setDemo]=useState(false),[info,setInfo]=useState(false),[mobileLayers,setMobileLayers]=useState(false);
  const api=useRef<GlobeAPI|null>(null),searchRef=useRef<HTMLDivElement>(null);
  const choose=(p:Location)=>{setHasSelection(true);setStreetData(null);setLocation(p);setDemo(false);setSelectedStorm(null);setPolygons([]);setPlaying(false);setQuery('');setSearchOpen(false);};
  const needsStreets=hasSelection&&!demo&&(streetOptions.roads||streetOptions.markers||streetOptions.landmarks);
  useEffect(()=>{
    const c=new AbortController();setStreetData(null);setStreetStatus('');
    if(!needsStreets)return()=>c.abort();
    setStreetStatus('Loading streets and places...');
    const timer=setTimeout(()=>getJSON<StreetData>(`/api/roads?lat=${location.lat.toFixed(4)}&lon=${location.lon.toFixed(4)}`,c.signal).then(data=>{if(!c.signal.aborted){setStreetData(data);setStreetStatus(data.segments.length||data.places.length?'':'No mapped roads or places within 3 km.');}}).catch(e=>{if(!c.signal.aborted)setStreetStatus(e.message);}),400);
    return()=>{clearTimeout(timer);c.abort();};
  },[location,needsStreets,streetRetry]);
  useEffect(()=>{try{localStorage.setItem('atmo-units',units);}catch{/* Storage can be disabled. */}},[units]);
  useEffect(()=>{
    const c=new AbortController();setMapStatus('Loading global model...');
    getJSON<GlobalWeather>('/api/global-weather',c.signal).then(d=>{setGlobalWeather(d);setMapStatus(`GFS · ${d.spacingDegrees}° overview grid`);}).catch(e=>{if(e.name!=='AbortError'){setGlobalWeather(null);setMapStatus('Global model unavailable');}});
    return()=>c.abort();
  },[mapRetry,refresh]);
  useEffect(()=>{
    if(demo){setLoading(false);return;}
    const c=new AbortController(),args=`lat=${location.lat.toFixed(4)}&lon=${location.lon.toFixed(4)}`;
    setLoading(true);setWeather(null);setGridData(null);setStations([]);setError('');setRegionError('');setObservationStatus('Loading airport observations...');
    getJSON<Weather>(`/api/weather?${args}`,c.signal).then(setWeather).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    getJSON<AtmosphericGrid>(`/api/atmosphere?${args}`,c.signal).then(setGridData).catch(e=>{if(e.name!=='AbortError')setRegionError('Regional model unavailable · point forecast fallback');});
    getJSON<{stations:Station[]}>(`/api/observations?${args}`,c.signal).then(d=>{setStations(d.stations);setObservationStatus(d.stations.length?`${d.stations.length} nearby airport reports`:'No recent airport reports within 150 km');}).catch(e=>{if(e.name!=='AbortError')setObservationStatus('Airport observations unavailable');});
    return()=>c.abort();
  },[location,refresh,demo]);
  useEffect(()=>{const t=setInterval(()=>setRefresh(v=>v+1),600000);return()=>clearInterval(t);},[]);
  useEffect(()=>{
    const c=new AbortController();getJSON<{activeStorms:Storm[]}>('/api/storms',c.signal).then(d=>{setStorms(d.activeStorms);setStormStatus(d.activeStorms.length?`${d.activeStorms.length} active systems`:'No active systems');}).catch(e=>{if(e.name!=='AbortError')setStormStatus('NHC feed unavailable');});return()=>c.abort();
  },[refresh]);
  useEffect(()=>{
    if(query.trim().length<2){setResults([]);setSearching(false);return;}
    const c=new AbortController();setSearching(true);setSearchError('');
    const t=setTimeout(()=>getJSON<{results?:{name:string;latitude:number;longitude:number;admin1?:string;country?:string}[]}>(`/api/search?q=${encodeURIComponent(query)}`,c.signal).then(d=>setResults((d.results||[]).map(p=>({name:p.name,lat:p.latitude,lon:p.longitude,region:[p.admin1,p.country].filter(Boolean).join(', ')})))).catch(e=>{if(e.name!=='AbortError')setSearchError(e.message);}).finally(()=>{if(!c.signal.aborted)setSearching(false);}),350);
    return()=>{clearTimeout(t);c.abort();};
  },[query]);
  useEffect(()=>{
    const close=(e:PointerEvent)=>{if(!searchRef.current?.contains(e.target as Node))setSearchOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setSearchOpen(false);setInfo(false);setStormOpen(false);}};
    window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{if(!playing)return;const t=setInterval(()=>setHour(h=>h>=24?0:h+1),1500);return()=>clearInterval(t);},[playing]);
  useEffect(()=>{
    setPolygons([]);if(!selectedStorm)return;const c=new AbortController();setExtentStatus('Loading official wind extent...');
    getJSON<{polygons:number[][][]}>(`/api/storms/${selectedStorm.id}/extent`,c.signal).then(d=>{setPolygons(d.polygons);setExtentStatus(d.polygons.length?'Orange outline: NHC analyzed wind extent':'No wind-extent polygons available');}).catch(e=>{if(e.name!=='AbortError')setExtentStatus('Official wind extent unavailable');});return()=>c.abort();
  },[selectedStorm]);
  const stormRadiusKm=useMemo(()=>stormExtentKm(selectedStorm,polygons),[selectedStorm,polygons]);
  const shape=useMemo(()=>stormShape(selectedStorm,polygons),[selectedStorm,polygons]);
  const conditions=useMemo(()=>demo?demoConditions:weather?atHour(weather,hour):null,[demo,weather,hour]);
  const atmosphere=useMemo(()=>buildAtmosphere(demo?null:gridData,stations,conditions,weather?.current.time,hour,demo),[gridData,stations,conditions,weather,hour,demo]);
  const temp=(v:number|undefined)=>v==null?'—':Math.round(units==='C'?v:v*9/5+32);
  const shownTime=conditions?.time?new Date(conditions.time+'Z'):new Date();
  const timeLabel=shownTime.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
  const mapTime=globalWeather?.points[0].time[hourlyIndex(globalWeather?.points[0].time??[],globalWeather?.fetchedAt,hour)];
  const startDemo=()=>{setDemo(true);setHour(0);setPlaying(false);setSelectedStorm(null);setPolygons([]);setLocation({lat:23,lon:-65,name:'Hurricane study',region:'Illustrative scenario · North Atlantic'});setStormOpen(false);setLayers(l=>({...l,clouds:true,precipitation:true,wind:true}));};
  const selectStorm=(s:Storm)=>{choose({lat:s.latitudeNumeric,lon:s.longitudeNumeric,name:s.name,region:`${s.classification} · NHC active tropical system`});setSelectedStorm(s);setStormOpen(false);};
  return <main style={{'--panel-opacity':panelOpacity/100} as React.CSSProperties} className={`app-shell ${stats.altitudeKm<100?'near-surface':''}`}>
    <div className="space-grain"/>
    <header className="topbar">
      <a href="/" className="brand" aria-label="ATMO home"><Orbit size={32} strokeWidth={1.2}/><span>atmo<span className="brand-dot">.</span></span><div className="brand-divider"/><small>A different perspective.</small></a>
      <div className="search-wrap" ref={searchRef}><Search size={17}/><input aria-label="Search for a place" placeholder="Search anywhere on Earth" value={query} onFocus={()=>setSearchOpen(true)} onChange={e=>{setQuery(e.target.value);setSearchOpen(true);}} onKeyDown={e=>{if(e.key==='Enter'&&results[0])choose(results[0]);}}/><kbd>⌕</kbd>
        {searchOpen&&<div className="search-results"><div className="eyebrow">{query.length>=2?'SEARCH RESULTS':'JUMP TO A PLACE'}</div>{searching?<p><LoaderCircle className="spin" size={16}/> Searching the planet...</p>:searchError?<p>{searchError}</p>:(query.length>=2?results:places).map(p=><button key={`${p.lat}-${p.lon}`} onClick={()=>choose(p)}><MapPin size={16}/><span>{p.name}<small>{p.region}</small></span><ArrowUpRight size={14}/></button>)}{!searching&&query.length>=2&&!results.length&&!searchError&&<p>No places found. Try a city or click the globe.</p>}</div>}
      </div>
      <div className="header-right"><details className="panel-menu"><summary>Panels</summary><div><label className="panel-opacity">Panel opacity <output>{panelOpacity}%</output><input aria-label="Panel opacity" type="range" min="0" max="100" step="1" value={panelOpacity} onChange={e=>setPanelOpacity(Number(e.target.value))}/></label><button onClick={()=>panelAction('minimize')}>Minimize all</button><button onClick={()=>panelAction('restore')}>Restore all</button><button onClick={()=>panelAction('reset')}>Reset layout</button></div></details><span className={`data-status ${demo||error||weather?._meta?.stale?'amber':''}`}><i/>{demo?'DEMO MODE':loading?'CONNECTING':error?'WEATHER UNAVAILABLE':weather?._meta?.stale?'CACHED MODEL':hour?'FORECAST':'LIVE MODEL'}</span><button className="icon-button" aria-label="About this experience" onClick={()=>setInfo(true)}><Info size={19}/></button></div>
    </header>
    <Globe extraLayers={extraLayers} tornadoData={tornadoesOn?tornadoData:null} stormActive={!!selectedStorm&&!demo} stormRadiusKm={stormRadiusKm} stormShape={shape} radarOpacity={radarOpacity/100} onRadarStatus={setRadarStatus} horizonLevel={horizonLevel} onToggleHorizon={toggleHorizon} onCompassChange={setNorthAngle} northUp={northUp} flightData={flightsOn?flightData:null} gamepadEnabled={gamepadOn} streetData={demo?null:streetData} streetOptions={streetOptions} onTiltChange={setActualTilt} onLook={value=>{setCameraTilt(value);setTiltLocked(true);}} tiltLocked={tiltLocked} cameraTilt={cameraTilt} mapOpacity={mapOpacity / 100} globalWeather={globalWeather} mapMode={demo?'natural':mapMode} time={globalWeather?.fetchedAt} hour={hour} location={location} atmosphere={atmosphere} layers={layers} polygons={polygons} demo={demo} quality={quality} satellite={satellite && hour===0} onStats={setStats} onSelect={choose} onReady={v=>{api.current=v;}}/>
    <section className="intro"><div className="eyebrow"><span className="tiny-line"/> YOUR PLANET. IN MOTION.</div><h1>Weather, with<br/><span>perspective.</span></h1><p>A living world. A closer look.</p></section>
    <aside className="weather-panel panel" aria-label="Selected location weather"><PanelChrome title="Local conditions"/>
      <div className="panel-kicker"><span><MapPin size={12}/> {demo?'SCENARIO':'LOCAL CONDITIONS'}</span><button className="unit-toggle" onClick={()=>setUnits(units==='C'?'F':'C')} aria-label="Toggle temperature units" aria-pressed={units==='F'} title="Switch Celsius / Fahrenheit"><span className={units==='C'?'active':''}>°C</span><span className={units==='F'?'active':''}>°F</span></button></div>
      <h2>{location.name}</h2>{weather?._meta?.stale&&<p role="status">Provider temporarily unavailable · showing the last weather fetched for this location at {new Date(weather._meta.fetchedAt).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})} UTC.</p>}<p className="location-region">{location.region}</p><div className="coord-line">{formatCoord(location.lat,location.lon)}</div>
      {loading?<div className="weather-loading"><LoaderCircle className="spin"/> Reading the atmosphere...</div>:error&&!demo?<div className="weather-error"><Cloud size={30}/><p>{error}</p><button onClick={()=>setRefresh(v=>v+1)}>Try again</button></div>:<>
        <div className="temperature"><span>{temp(conditions?.temperature_2m)}<sup>°</sup></span><div className="condition-icon"><WeatherIcon code={conditions?.weather_code} size={54}/></div></div>
        <div className="condition-description">{description(conditions?.weather_code??0)}<span>Feels like {temp(conditions?.apparent_temperature)}°</span></div>
        <div className="weather-stats"><div><Wind/><span>Wind<strong>{Math.round(conditions?.wind_speed_10m??0)} <small>km/h</small> <Navigation size={11} style={{transform:`rotate(${conditions?.wind_direction_10m}deg)`}}/></strong></span></div><div><Droplets/><span>Humidity<strong>{conditions?.relative_humidity_2m}<small>%</small></strong></span></div><div><CloudRain/><span>Precipitation<strong>{conditions?.precipitation?.toFixed(1)} <small>mm</small></strong></span></div><div><Cloud/><span>Cloud cover<strong>{conditions?.cloud_cover}<small>%</small></strong></span></div></div>
        <div className="zoom-hint">Scroll to explore · keep zooming for terrain</div><div className="updated"><i/>{demo?'Illustration · not an actual storm':`${hour?'Forecast for':'Model updated'} ${timeLabel} UTC`}</div>
      </>}
    </aside>
    <div className="view-caption"><span className="eyebrow">EARTH / CONTINUOUS ATMOSPHERE</span><span><i/> {demo?'Illustrative hurricane':selectedStorm?'NHC storm analysis':`${stats.altitudeKm<10?stats.altitudeKm.toFixed(2):Math.round(stats.altitudeKm).toLocaleString()} km above sea level`}</span></div>
    <section className="weather-map-panel panel" aria-label="Weather map display"><PanelChrome title="Weather display"/><label>Weather display<select aria-label="Weather display" value={mapMode} disabled={demo} onChange={e=>setMapMode(e.target.value as MapMode)}><option value="natural">Natural atmosphere</option><option value="precipitation">Precipitation</option><option value="wind">Wind speed</option><option value="temperature">Temperature</option></select></label>

      {mapMode!=='natural'&&!demo&&<div className="map-legend" aria-label="Map legend"><div className="map-opacity"><label htmlFor="heatmap-opacity">Opacity<output htmlFor="heatmap-opacity">{mapOpacity}%</output></label><input id="heatmap-opacity" aria-label="Heatmap opacity" aria-valuetext={`${mapOpacity}%`} type="range" min="0" max="100" step="1" value={mapOpacity} onChange={e=>setMapOpacity(Number(e.target.value))}/></div><div className={`legend-ramp ${mapMode}`}/><div className="legend-ticks">{(mapMode==='wind'?['0','25','50','75','100+ km/h']:mapMode==='precipitation'?['0','1','2.5','5+ mm/h']:units==='C'?['-40','-10','20','40 °C']:['-40','14','68','104 °F']).map(t=><span key={t}>{t}</span>)}</div><small>Forecast model · {mapStatus}{mapTime&&` · ${mapTime.replace('T',' ')} UTC`}</small>{!globalWeather&&mapStatus.includes('unavailable')&&<button onClick={()=>setMapRetry(v=>v+1)}>Retry weather map</button>}</div>}

    </section>
    <section className="view-controls-panel panel" aria-label="View controls"><PanelChrome title="View controls"/><label className="north-lock">North-up compass lock<input aria-label="North-up compass lock" type="checkbox" checked={northUp} onChange={e=>{setNorthUp(e.target.checked);if(e.target.checked)setHorizonLevel(false);}}/></label>
      <label className="north-lock horizon-level">Keep horizon level <small>Y</small><input type="checkbox" checked={horizonLevel} onChange={e=>{setHorizonLevel(e.target.checked);if(e.target.checked)setNorthUp(false);}}/></label><details className="street-controls" open><summary>Keyboard &amp; controller</summary><small>Click the globe to focus navigation. Arrow keys: move · +/−: zoom · Enter: select center. Typing in search pauses navigation.</small><label>Enable gamepad<input type="checkbox" checked={gamepadOn} onChange={e=>{setGamepadOn(e.target.checked);localStorage.setItem('atmo-gamepad',e.target.checked?'on':'off');}}/></label><small>{gamepadStatus}</small><small>Left stick: move · Right stick: look · LT/RT: zoom out/in · A: select center · B: reset · Y: toggle horizon leveling. Active while this window has focus.</small></details>
      <div className="camera-tilt"><label htmlFor="camera-tilt">Camera tilt<output htmlFor="camera-tilt">{actualTilt === 0 ? 'Overhead' : `${actualTilt}%`}</output></label><input id="camera-tilt" aria-label="Camera tilt" type="range" min="0" max="100" step="1" value={actualTilt} onChange={e=>{setCameraTilt(Number(e.target.value));setTiltLocked(true);}}/><div><span>Overhead</span><span>Horizon</span></div><label className="tilt-lock"><input type="checkbox" checked={tiltLocked} onChange={e=>{if(e.target.checked)setCameraTilt(actualTilt);setTiltLocked(e.target.checked);}}/>Lock camera tilt</label><small>{tiltLocked?'Your angle stays fixed as you zoom.':'Tilts toward the horizon below 1.5 km.'}</small></div>
      <details className="street-controls"><summary>Roads & places</summary><fieldset disabled={!hasSelection||demo}><legend className="sr-only">Selected area street overlay</legend>
        <label><span>Road lines</span><input aria-label="Road lines" type="checkbox" checked={streetOptions.roads} onChange={e=>setStreetOptions(v=>({...v,roads:e.target.checked}))}/></label>
        <label><span>Place markers</span><input aria-label="Place markers" type="checkbox" checked={streetOptions.markers} onChange={e=>setStreetOptions(v=>({...v,markers:e.target.checked}))}/></label>
        <label><span>Landmarks</span><input aria-label="Landmarks" type="checkbox" checked={streetOptions.landmarks} onChange={e=>setStreetOptions(v=>({...v,landmarks:e.target.checked}))}/></label>
        <label><span>Road color</span><input aria-label="Road color" type="color" value={streetOptions.color} onChange={e=>setStreetOptions(v=>({...v,color:e.target.value}))}/></label>
        <button className="street-focus" onClick={()=>{setCameraTilt(0);setTiltLocked(true);api.current?.streets();}}>View streets <ArrowUpRight size={12}/></button>
      </fieldset><small>{!hasSelection?'Select a location on the globe or search for a place to enable roads.':demo?'Street overlays are unavailable in the hurricane study.':'Within 3 km of your selection · roads appear below 180 km; place labels below 80 km.'}</small>
      {needsStreets&&<><p role="status">{streetStatus||`${streetData?.segments.length.toLocaleString()} road segments · ${streetData?.places.length} places${streetData?.truncated?' · limited to nearby features':''}`}</p>{streetStatus.includes('retry')&&<button onClick={()=>setStreetRetry(v=>v+1)}>Retry street data</button>}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></>}
      </details>
    </section>
    <section className="flights-panel panel" aria-label="Flight traffic"><PanelChrome title="Flight traffic"/><label><span>Live civilian aircraft</span><input aria-label="Live civilian aircraft" type="checkbox" checked={flightsOn} onChange={e=>setFlightsOn(e.target.checked)}/></label><div className="flight-legend"><span style={{color:'#55c9ff'}}>● Airliner types</span><span style={{color:'#ffce70'}}>● Business types</span><span style={{color:'#c198ff'}}>● Light types</span></div><small role="status">{flightsOn?flightStatus:'Enable to load public flight positions.'}</small><small>Five-second trails · motion estimated between 15-second updates. Live traffic stays at the present time during weather forecasts. Supported civilian aircraft types only; coverage is incomplete.</small><a href="https://www.adsb.lol/docs/open-data/api/" target="_blank" rel="noreferrer">ADSB.lol · ODbL attribution</a></section>
    <aside className={`layers-panel panel ${mobileLayers?'mobile-open':''}`}><PanelChrome title="Atmosphere"/><div className="panel-kicker"><span><Layers3 size={14}/> ATMOSPHERE</span><span className="layer-count">{Object.values(layers).filter(Boolean).length}</span></div>
      {layerOptions.map(({key,name,detail,icon:Icon})=><button role="switch" aria-checked={layers[key]} className={`layer-option ${layers[key]?'active':''}`} key={key} onClick={()=>setLayers(p=>({...p,[key]:!p[key]}))}><Icon size={19}/><span>{name}<small>{detail}</small></span><span className="switch"><span/></span></button>)}
      {layers.precipitation&&<details className="radar-controls"><summary>NOAA radar · observed</summary><small>{demo?'Radar paused during the synthetic study.':hour>0?'Observed radar paused during forecasts. The precipitation heatmap shows model forecasts.':mapMode!=='natural'?'Switch to Natural atmosphere to see observed radar.':radarStatus}</small><label>Radar opacity <output>{radarOpacity}%</output><input aria-label="Radar opacity" type="range" min="0" max="100" value={radarOpacity} onChange={e=>setRadarOpacity(Number(e.target.value))}/></label><img src="/api/radar-legend" alt="NOAA radar reflectivity color scale in dBZ"/><small>Reflectivity (dBZ), not rainfall totals. U.S. regional coverage only; gaps are not evidence of no rain. Refreshes every 2 minutes.</small><a href="https://opengeo.ncep.noaa.gov/geoserver/www/index.html" target="_blank" rel="noreferrer">NOAA/NWS MRMS radar</a></details>}
      <button role="switch" disabled={hour>0} aria-checked={satellite && hour===0} className={`layer-option ${satellite && hour===0?'active':''}`} onClick={()=>setSatellite(v=>!v)}><Globe2 size={19}/><span>Satellite clouds<small>{hour>0?'Paused during forecasts':'NASA MODIS · dated observation'}</small></span><span className="switch"><span/></span></button>
      <button role="switch" aria-checked={tornadoesOn} className={`layer-option ${tornadoesOn?'active':''}`} onClick={()=>setTornadoesOn(v=>!v)}><Tornado size={19}/><span>Tornado warnings<small>NWS warned areas · U.S. only</small></span><span className="switch"><span/></span></button>
      {tornadoesOn&&<details className="layer-notes"><summary>NWS warned areas</summary><small role="status">{tornadoStatus||'Loading active warnings…'}</small><small>Red outlines are the official warned polygons, drawn brighter where a tornado has been observed and fainter where the warning is radar-indicated. Where the product reports a radar-identified storm cell and its motion, the funnel hangs at that cell carried forward along the reported track, rather than at the middle of the county-shaped warned area; without one it falls back to the polygon centre. It hangs from the modelled cloud base for that place and widens where the product flags a considerable or catastrophic damage threat. The NWS publishes warned areas and storm cells, never a funnel's position, width, or whether one has reached the ground, so the funnel itself stays an illustration. Zoom below 220 km to see it. Refreshes every minute; an empty list means no warnings are active, not that no severe weather exists.</small><a href="https://www.weather.gov/documentation/services-web-api" target="_blank" rel="noreferrer">NOAA/NWS active alerts</a></details>}
      <details className="layer-notes data-catalog"><summary>More data <small>{layerCatalog.filter(s=>extra[s.id]?.on).length||'off'}</small></summary>
        {layerCatalog.map(spec=>{const on=!!extra[spec.id]?.on,Icon=layerIcons[spec.id]??Layers3;return <div key={spec.id} className="catalog-entry">
          <button role="switch" aria-checked={on} className={`layer-option ${on?'active':''}`} onClick={()=>toggleExtra(spec.id)}><Icon size={19}/><span>{spec.name}<small>{spec.detail}</small></span><span className="switch"><span/></span></button>
          {on&&<><small role="status">{extra[spec.id]?.status||'Loading…'}</small><small>{spec.note}</small><a href={spec.attribution.href} target="_blank" rel="noreferrer">{spec.attribution.text}</a></>}
        </div>;})}
        <ProviderKeys onSaved={()=>setKeysVersion(v=>v+1)}/>
      </details>
      <div className="layer-note" aria-live="polite">{demo?'Synthetic cloud study':satellite&&hour===0?stats.satellite:globalWeather?`Forecast clouds · ${mapTime?.replace('T',' ')} UTC`:mapStatus}<small>{satellite&&hour>0?'Satellite paused; showing model forecast.':'Cloud geometry is illustrative.'}</small>{!globalWeather&&!satellite&&mapStatus.includes('unavailable')&&<button onClick={()=>setMapRetry(v=>v+1)}>Retry cloud forecast</button>}</div><label className="quality-control">Render quality<select aria-label="Render quality" value={quality} onChange={e=>setQuality(e.target.value as Quality)}><option value="balanced">Balanced</option><option value="high">High</option><option value="ultra">Ultra</option></select></label><div className="layer-note"><span className="tiny-dot"/>WebGL2 · {stats.fps} FPS<small>{layers.wind ? (globalWeather ? 'GFS wind · green 0 → yellow 50 → red 100+ km/h' : mapStatus) : 'True-scale terrain · volumetric atmosphere'}</small></div>
    </aside>
    <div className="data-inspector panel"><PanelChrome title="Atmospheric data"/><details><summary>Atmospheric data <ChevronDown size={13}/></summary><div><b>{atmosphere.source}</b><span>Low / mid / high clouds: {Math.round(atmosphere.low)} / {Math.round(atmosphere.mid)} / {Math.round(atmosphere.high)}%</span><span>Cloud base: {(atmosphere.baseKm*1000).toFixed(0)} m above ground</span><small>{atmosphere.baseSource}</small><span>{observationStatus}</span>{stations[0]&&<small>{stations[0].id} · {stations[0].distanceKm} km · {new Date(stations[0].observed).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})} UTC</small>}<span>{stats.satellite}</span><span>{mapStatus}</span><small>Satellite coverage is dated and may have visible gaps. Missing retrievals are not evidence of clear skies. Forecast clouds use a global model; selecting a location does not replace them.</small><span>{stats.terrain}</span><small>Cloud shapes and optical density are reconstructed. Terrain heights use measured DEM data at true scale.</small><small className="gpu-name">{stats.gpu}</small></div></details></div>
    <div className="storm-control panel"><PanelChrome title="Tropical systems"/><button className={`storm-button ${stormOpen?'active':''}`} onClick={()=>setStormOpen(v=>!v)} aria-expanded={stormOpen}><Orbit size={18}/><span>Tropical systems<small>{stormStatus}</small></span><ChevronDown size={14}/></button>{stormOpen&&<div className="storm-popover panel"><div className="eyebrow">NHC · ATLANTIC & EAST/CENTRAL PACIFIC</div>{storms.map(s=><button className="storm-item" key={s.id} onClick={()=>selectStorm(s)}><Orbit size={21}/><span>{s.name}<small>{s.classification} · {s.intensity} kt · {new Date(s.lastUpdate).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}</small></span><ArrowUpRight size={16}/></button>)}{!storms.length&&<p>{stormStatus}. Other basins are not covered by this feed.</p>}<button className="demo-button" onClick={startDemo}>Explore a hurricane study <ArrowUpRight size={14}/><small>Illustrative 3D scenario</small></button></div>}</div>
    {(demo||selectedStorm)&&<div className="scenario-banner"><Orbit size={18}/><span>{demo?'Hurricane study':`${selectedStorm?.name} · ${selectedStorm?.intensity} kt`}<small>{demo?'Synthetic weather · cloud shape, size & winds are illustrative':shape?`${shape.shieldMeasured?`34 kt radii ${stormQuadrantSummary(shape)}`:'No wind radii published · extent estimated from intensity'} · ${shape.eyewallMeasured?`eyewall from the 64 kt radius (~${Math.round(shape.eyewallKm)} km)`:'eyewall and eye inferred, not published'} · ${shape.spin>0?'counterclockwise':'clockwise'} · band placement is illustrative`:extentStatus}</small></span>{selectedStorm?.publicAdvisory&&<a href={selectedStorm.publicAdvisory.url} target="_blank" rel="noreferrer" aria-label="Read NHC advisory"><ArrowUpRight size={17}/></a>}<button aria-label="Exit storm view" onClick={()=>choose(places[0])}><X size={16}/></button></div>}
    <div className="globe-tools"><button className="mobile-layer-toggle" aria-label="Toggle layers panel" onClick={()=>setMobileLayers(v=>!v)}><Layers3 size={18}/></button><button aria-label="Zoom in" onClick={()=>api.current?.zoom(.7)}><Plus size={19}/></button><button aria-label="Zoom out" onClick={()=>api.current?.zoom(1/.7)}><Minus size={19}/></button><span/><button aria-label="Reset globe view" onClick={()=>{setCameraTilt(0);setTiltLocked(false);api.current?.reset();}}><RotateCcw size={17}/></button><button aria-label="Focus selected location" onClick={()=>api.current?.focus()}><Crosshair size={19}/></button></div>
    <button className="compass" aria-label="Toggle north-up compass lock" aria-pressed={northUp} onClick={()=>{setNorthUp(v=>!v);setHorizonLevel(false);}} title={northAngle===null?'North direction undefined at this view': 'Arrow points north · click to toggle north-up lock'}><span>N</span><svg width="24" height="28" viewBox="0 0 24 28" aria-hidden="true" style={{transform:`rotate(${northAngle??0}deg)`,opacity:northAngle===null?.3:1}}><path d="M12 2 L21 25 L12 19 L3 25 Z" fill="none" stroke="currentColor" strokeWidth="2"/></svg><small>{northUp?'LOCKED':'NORTH'}</small></button>
    <section className="timeline panel" aria-label="Weather forecast timeline"><PanelChrome title="Forecast"/><div className="timeline-heading"><div><span className="eyebrow">{demo?'WEATHER STUDY':'FOLLOW THE FORECAST'}</span><span className="forecast-date">{shownTime.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}<span> / {demo?'Illustrative':`${timeLabel} UTC`}</span></span></div><div className="timeline-mode"><button className={hour===0?'active':''} onClick={()=>{setHour(0);setPlaying(false);}}>Now</button><span>24-hour forecast</span></div></div>
      <div className="timeline-track"><button className={`play-button ${playing?'playing':''}`} aria-label={playing?'Pause forecast':'Play forecast'} disabled={!weather||demo||loading} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={17}/>:<Play size={17}/>}</button><div className="slider-wrap"><input aria-label="Forecast hour" type="range" min="0" max="24" step="1" value={hour} disabled={!weather||demo||loading} onChange={e=>{setHour(Number(e.target.value));setPlaying(false);}} style={{'--progress':`${hour/24*100}%`} as React.CSSProperties}/><div className="time-ticks">{[0,3,6,9,12,15,18,21,24].map(h=><button disabled={!weather||demo||loading} key={h} className={h===hour?'active':''} onClick={()=>{setHour(h);setPlaying(false);}}>{h===0?'Now':`+${h}h`}{weather&&!demo&&<WeatherIcon size={14} code={atHour(weather,h).weather_code}/>}</button>)}</div></div><span className="hour-badge">{demo?'STUDY':hour===0?'LIVE':`+${hour}H`}</span></div>
    </section>
    <footer>{needsStreets&&streetData&&<a className="street-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}<span><span className="footer-dot"/>{regionError||'Open-Meteo · NOAA METAR · NASA MODIS · Esri imagery · Mapzen elevation'} <button onClick={()=>setInfo(true)}>Data & credits <ArrowUpRight size={11}/></button></span><span className="interaction-hint">Drag to orbit <span>·</span> Right-drag to pan <span>·</span> Middle-drag to look <span>·</span> Scroll to zoom <span>·</span> Click to explore</span></footer>
    {info&&<div className="modal-backdrop" onClick={()=>setInfo(false)}><section className="info-modal panel" role="dialog" aria-modal="true" aria-label="About ATMO" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" autoFocus aria-label="Close about dialog" onClick={()=>setInfo(false)}><X size={20}/></button><Orbit size={36}/><div className="eyebrow">A DIFFERENT PERSPECTIVE</div><h2>The weather has<br/>a whole new dimension.</h2><p>Scroll continuously from orbit into the atmosphere. Use the timeline to explore the next 24 hours.</p><h3>What you're seeing</h3><ul>
      <li><b>Weather:</b> <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo</a> current estimates and hourly forecasts. The global heatmaps use a coarse 15° GFS sample grid, interpolated for an overview. They are model fields, not observed radar. All times are UTC.</li>
      <li><b>Clouds:</b> a spherical GPU volume uses global GFS low, middle and high cloud forecasts. Layer heights and shapes are illustrative. NASA Terra/Aqua MODIS optical-thickness retrievals are a separate dated observation view at Now. Satellite retrieval gaps remain visible; missing data does not mean clear skies. Reconstructed cloud geometry is illustrative.</li>
      <li><b>Terrain:</b> Mapzen elevation tiles displace the Earth at true scale. Esri World Imagery provides local surface imagery, with NASA Blue Marble via three-globe at global scale. Solar lighting follows the selected time.</li>
      <li><b>Tropical systems:</b> <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">NHC</a> positions and analyzed wind outlines cover its Atlantic and east/central Pacific basins. Satellite data retains its acquisition date. The hurricane study is synthetic.</li></ul><p className="keyboard-help">Keyboard: focus the globe, use arrows to orbit, + / - to zoom, and Enter to select the center.</p><button className="dive-button" onClick={()=>setInfo(false)}>Back to the planet <ArrowUpRight size={16}/></button></section></div>}
  </main>;
}
