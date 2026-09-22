// Peta 2D (F-DT-09) dengan basemap satelit/topografi. Semua koordinat proyek dalam UTM 49S.
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { utmToLngLat } from '../lib/utm';
import { Seg } from './ui';

export interface MapZone { id: number; code: string; polygon: { x: number; y: number }[]; color: string; label?: string }
export interface MapPoint { id: number; code: string; x: number; y: number; color: string; label?: string; ring?: string }

const BASEMAPS = {
  satelit: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Citra © Esri, Maxar, Earthstar Geographics' },
  topo: { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attribution: '© kontributor OpenStreetMap' },
};

export function MapView({ zones, points, alignment, height = 360, onZone, onPoint, focus }: {
  zones: MapZone[]; points: MapPoint[]; alignment?: { x: number; y: number; sta: number }[]; height?: number | string;
  onZone?: (id: number) => void; onPoint?: (id: number) => void; focus?: { x: number; y: number; zoom?: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [base, setBase] = useState<'satelit' | 'topo'>('satelit');
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const handlers = useRef({ onZone, onPoint });
  handlers.current = { onZone, onPoint };

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: { base: { type: 'raster', tiles: BASEMAPS.satelit.tiles, tileSize: 256, attribution: BASEMAPS.satelit.attribution, maxzoom: 19 } },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#11161b' } }, { id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -0.35, 'raster-brightness-max': 0.8 } }],
      },
      center: [110.57, -6.93], zoom: 14, attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    // gambar zona begitu style siap, tanpa menunggu semua tile basemap termuat
    m.once('style.load', () => setReady(true));
    m.once('load', () => setReady(true));
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource('base') as maplibregl.RasterTileSource | undefined;
    if (src && 'setTiles' in src) (src as any).setTiles(BASEMAPS[base].tiles);
    m.setPaintProperty('base', 'raster-saturation', base === 'satelit' ? -0.35 : -0.6);
  }, [base, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const zfc = {
      type: 'FeatureCollection' as const,
      features: zones.map((z) => ({
        type: 'Feature' as const, id: z.id,
        properties: { id: z.id, code: z.code, color: z.color, label: z.label ?? z.code },
        geometry: { type: 'Polygon' as const, coordinates: [[...z.polygon, z.polygon[0]].map((p) => utmToLngLat(p.x, p.y))] },
      })),
    };
    const pfc = {
      type: 'FeatureCollection' as const,
      features: points.map((p) => ({ type: 'Feature' as const, properties: { id: p.id, code: p.code, color: p.color, ring: p.ring ?? p.color, label: p.label ?? p.code }, geometry: { type: 'Point' as const, coordinates: utmToLngLat(p.x, p.y) } })),
    };
    const afc = {
      type: 'FeatureCollection' as const,
      features: alignment?.length ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: alignment.map((p) => utmToLngLat(p.x, p.y)) } }] : [],
    };
    const set = (id: string, data: any) => {
      const s = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (s) s.setData(data); else m.addSource(id, { type: 'geojson', data });
    };
    set('zones', zfc); set('pts', pfc); set('align', afc);
    if (!m.getLayer('zones-fill')) {
      m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.28 } });
      m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 } });
      m.addLayer({ id: 'align', type: 'line', source: 'align', paint: { 'line-color': '#E8772E', 'line-width': 1.5, 'line-dasharray': [4, 2] } });
      m.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-radius': 4.5, 'circle-color': ['get', 'color'], 'circle-stroke-color': ['get', 'ring'], 'circle-stroke-width': 1.5 } });
      m.on('click', 'zones-fill', (e) => { const id = e.features?.[0]?.properties?.id; if (id) handlers.current.onZone?.(Number(id)); });
      m.on('click', 'pts', (e) => { const id = e.features?.[0]?.properties?.id; if (id) handlers.current.onPoint?.(Number(id)); });
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
      m.on('mousemove', 'pts', (e) => { m.getCanvas().style.cursor = 'pointer'; const f = e.features?.[0]; if (f) popup.setLngLat(e.lngLat).setHTML(`<span style="font-family:IBM Plex Mono">${f.properties?.label}</span>`).addTo(m); });
      m.on('mouseleave', 'pts', () => { m.getCanvas().style.cursor = ''; popup.remove(); });
      m.on('mouseenter', 'zones-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'zones-fill', () => { m.getCanvas().style.cursor = ''; });
    }
    // bingkai awal saat zona pertama kali tersedia
    const all = zfc.features.flatMap((f) => f.geometry.coordinates[0]);
    if (!fitted.current && all.length) {
      const b = new maplibregl.LngLatBounds(all[0] as [number, number], all[0] as [number, number]);
      all.forEach((c) => b.extend(c as [number, number]));
      m.fitBounds(b, { padding: 40, duration: 0, bearing: 0 });
      fitted.current = true;
    }
  }, [zones, points, alignment, ready]);

  // label STA tiap 100 m sebagai marker HTML (tanpa server glyph)
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !alignment?.length) return;
    const markers = alignment.filter((q) => q.sta % 100 === 0).map((a) => {
      const d = document.createElement('div');
      d.textContent = `${Math.floor(a.sta / 1000)}+${String(a.sta % 1000).padStart(3, '0')}`;
      d.style.cssText = 'font:10px IBM Plex Mono,monospace;color:#E6E9EC;text-shadow:0 0 3px #0F1419,0 0 3px #0F1419;transform:translateY(-12px);pointer-events:none';
      return new maplibregl.Marker({ element: d }).setLngLat(utmToLngLat(a.x, a.y)).addTo(m);
    });
    return () => markers.forEach((mk) => mk.remove());
  }, [alignment, ready]);

  useEffect(() => {
    if (!focus || !map.current || !ready) return;
    map.current.flyTo({ center: utmToLngLat(focus.x, focus.y), zoom: focus.zoom ?? 17, duration: 800 });
  }, [focus, ready]);

  return (
    <div style={{ position: 'relative', height }}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      <div className="glass" style={{ position: 'absolute', top: 8, left: 8, padding: 3 }}>
        <Seg value={base} onChange={setBase} options={[{ value: 'satelit', label: 'Satelit' }, { value: 'topo', label: 'Topografi' }]} />
      </div>
    </div>
  );
}
