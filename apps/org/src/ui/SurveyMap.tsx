// The survey map: NASA imagery toned down to a printed plate, country borders
// as hairlines, the lettered survey grid over the organization's sites, every
// site as a circle in its status ink, and live satellite fires. Hovering a
// site lights its grid square; the list beside it does the same through
// `hover`, so a row and its square always point at each other.
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { API, type Hotspot, type Site, type Status } from '../lib/api.ts';
import { cellPolygon, colLetter, gridLines, north, type Grid } from '../lib/grid.ts';
import { useT } from '../lib/i18n.ts';
import { usePrefs } from '../lib/prefs.ts';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const WORLD: FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } }] };
/** Portugal to Lebanon: every country a site can be in. */
const COVERAGE: [[number, number], [number, number]] = [[-10.5, 33], [37, 42.5]];

const COUNTRY_BOUNDS: Record<string, [[number, number], [number, number]]> = {
  portugal: [[-9.5, 36.9], [-6.2, 42.15]],
  greece: [[19.4, 34.8], [28.3, 41.75]],
  lebanon: [[35.1, 33.05], [36.65, 34.7]],
  cyprus: [[32.27, 34.56], [34.6, 35.7]],
};

function countryBounds(country?: string | null): [[number, number], [number, number]] | null {
  if (!country) return null;
  const c = country.trim().toLowerCase();
  return COUNTRY_BOUNDS[c]
    ?? (c.includes('portugal') || c.includes('البرتغال') ? COUNTRY_BOUNDS.portugal : null)
    ?? (c.includes('greece') || c.includes('اليونان') ? COUNTRY_BOUNDS.greece : null)
    ?? (c.includes('lebanon') || c.includes('لبنان') ? COUNTRY_BOUNDS.lebanon : null)
    ?? (c.includes('cyprus') || c.includes('قبرص') ? COUNTRY_BOUNDS.cyprus : null)
    ?? null;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function palette() {
  return {
    ground: css('--ground'), plate: css('--map-tint'), tint: Number(css('--map-tint-opacity') || 0.4), line: css('--contour'), grid: css('--grid-line'),
    act: css('--act'), watch: css('--watch'), ok: css('--ok'), draft: css('--ink-2'), fire: css('--fire'), focus: css('--action'),
    bright: css('--map-bright') === 'light',
  };
}

function circle(site: Site, status: string, hot: boolean): Feature {
  const ring: [number, number][] = [];
  const dLat = site.radiusKm / 111.32;
  const dLon = dLat / Math.max(0.01, Math.cos((site.lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([site.lon + dLon * Math.cos(a), site.lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: { id: site.id, status, hot }, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function style(p: ReturnType<typeof palette>): StyleSpecification {
  return {
    version: 8,
    sources: {
      imagery: { type: 'raster', tiles: [GIBS], tileSize: 256, maxzoom: 8, attribution: 'NASA GIBS · Natural Earth · NASA FIRMS' },
      tint: { type: 'geojson', data: WORLD },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': p.ground } },
      {
        id: 'imagery', type: 'raster', source: 'imagery',
        paint: p.bright
          ? { 'raster-saturation': -1, 'raster-brightness-min': 0.62, 'raster-brightness-max': 1, 'raster-contrast': -0.2, 'raster-fade-duration': 200 }
          : { 'raster-saturation': -0.85, 'raster-brightness-max': 0.5, 'raster-contrast': 0.1, 'raster-fade-duration': 200 },
      },
      { id: 'tint', type: 'fill', source: 'tint', paint: { 'fill-color': p.plate, 'fill-opacity': p.tint } },
    ],
  };
}

interface Props {
  sites: Site[];
  status: Map<string, Status>;
  grid: Grid | null;
  hotspots?: Hotspot[];
  hover: string | null;
  onHover(id: string | null): void;
  onSelect(id: string): void;
  /** When set, the next click on the map drops a site there. */
  onAdd?: ((lat: number, lon: number) => void) | null;
  /** A message over the map (adding hint, refusal). */
  hint?: { text: string; error?: boolean } | null;
  /** A site to bring into view. */
  focus?: string | null;
  /** Focus the map on this country when there is nothing else to frame. */
  country?: string | null;
  label: string;
  hoverRef?: string | null;
}

export function SurveyMap({ sites, status, grid, hotspots = [], hover, onHover, onSelect, onAdd, hint, focus, country, label, hoverRef }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState<{ cols: { x: number; label: string }[]; rows: { y: number; label: string }[] }>({ cols: [], rows: [] });
  const latest = useRef({ onHover, onSelect, onAdd, grid });
  latest.current = { onHover, onSelect, onAdd, grid };
  const { theme } = usePrefs();
  const { t } = useT();
  const instant = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fitted = useRef('');

  // ---- The map, once ----
  useEffect(() => {
    if (!el.current) return;
    let map: MlMap;
    const initial = countryBounds(country) ?? COVERAGE;
    try {
      map = new maplibregl.Map({
        container: el.current, style: style(palette()), bounds: initial, fitBoundsOptions: { padding: 24 },
        minZoom: 2, maxZoom: 12, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    const addLayers = () => {
      const p = palette();
      for (const id of ['countries', 'grid', 'cell', 'sites', 'fires']) if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: id === 'countries' ? `${API}/data/countries.geojson` : EMPTY });
      }
      map.addLayer({ id: 'country-line', type: 'line', source: 'countries', paint: { 'line-color': p.line, 'line-width': 1, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'cell-fill', type: 'fill', source: 'cell', paint: { 'fill-color': p.focus, 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'cell-line', type: 'line', source: 'cell', paint: { 'line-color': p.focus, 'line-width': 1.5 } });
      map.addLayer({
        id: 'grid-line', type: 'line', source: 'grid',
        paint: { 'line-color': p.grid, 'line-width': ['case', ['get', 'edge'], 1.25, 0.75], 'line-dasharray': ['case', ['get', 'edge'], ['literal', [1, 0]], ['literal', [4, 3]]] as unknown as number[] },
      });
      const color = ['match', ['get', 'status'], 'act', p.act, 'watch', p.watch, 'ok', p.ok, p.draft] as unknown as string;
      map.addLayer({ id: 'site-fill', type: 'fill', source: 'sites', paint: { 'fill-color': color, 'fill-opacity': ['case', ['get', 'hot'], 0.32, 0.14] } });
      map.addLayer({ id: 'site-line', type: 'line', source: 'sites', paint: { 'line-color': color, 'line-width': ['case', ['get', 'hot'], 2.5, 1.25] } });
      map.addLayer({
        id: 'fires', type: 'circle', source: 'fires',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 8, 3.5, 11, 6],
          'circle-color': p.fire, 'circle-stroke-color': p.ground, 'circle-stroke-width': 1,
        },
      });
    };

    map.on('load', () => {
      addLayers();
      map.on('mousemove', 'site-fill', (e) => {
        if (latest.current.onAdd) return;
        map.getCanvas().style.cursor = 'pointer';
        latest.current.onHover(String(e.features?.[0]?.properties?.id ?? '') || null);
      });
      map.on('mouseleave', 'site-fill', () => {
        if (!latest.current.onAdd) map.getCanvas().style.cursor = '';
        latest.current.onHover(null);
      });
      map.on('click', (e) => {
        const add = latest.current.onAdd;
        if (add) return add(e.lngLat.lat, e.lngLat.lng);
        const hit = map.queryRenderedFeatures(e.point, { layers: ['site-fill'] })[0];
        if (hit?.properties?.id) latest.current.onSelect(String(hit.properties.id));
      });
      setReady(true);
    });
    // The grid's letters and numbers ride the frame's edges as the map moves.
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const g = latest.current.grid;
        if (!g || !el.current) return setFrame({ cols: [], rows: [] });
        const { clientWidth: w, clientHeight: h } = el.current;
        const n = north(g);
        const midLat = n - (g.rows * g.step) / 2;
        const midLon = g.west + (g.cols * g.step) / 2;
        const cols = Array.from({ length: g.cols }, (_, i) => ({ x: map.project([g.west + (i + 0.5) * g.step, midLat]).x, label: colLetter(i) })).filter((c) => c.x > 12 && c.x < w - 12);
        const rows = Array.from({ length: g.rows }, (_, j) => ({ y: map.project([midLon, n - (j + 0.5) * g.step]).y, label: String(j + 1) })).filter((r) => r.y > 12 && r.y < h - 12);
        setFrame({ cols, rows });
      });
    };
    map.on('move', place);
    map.on('resize', place);
    map.on('load', place);
    map.on('error', (e) => {
      if (!map.loaded() && e.error && /webgl/i.test(e.error.message)) setFailed(true);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    (map as MlMap & { _place?: () => void })._place = place;
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- Theme: the plate is redrawn in the other palette ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const p = palette();
    map.setPaintProperty('ground', 'background-color', p.ground);
    map.setPaintProperty('tint', 'fill-color', p.plate);
    map.setPaintProperty('tint', 'fill-opacity', p.tint);
    const imagery = style(p).layers.find((l) => l.id === 'imagery')!.paint as Record<string, number>;
    for (const k of ['raster-saturation', 'raster-brightness-min', 'raster-brightness-max', 'raster-contrast']) {
      map.setPaintProperty('imagery', k as 'raster-saturation', imagery[k] ?? (k === 'raster-brightness-min' ? 0 : k === 'raster-brightness-max' ? 1 : 0));
    }
    map.setPaintProperty('country-line', 'line-color', p.line);
    map.setPaintProperty('grid-line', 'line-color', p.grid);
    map.setPaintProperty('cell-fill', 'fill-color', p.focus);
    map.setPaintProperty('cell-line', 'line-color', p.focus);
    map.setPaintProperty('fires', 'circle-color', p.fire);
    map.setPaintProperty('fires', 'circle-stroke-color', p.ground);
    const color = ['match', ['get', 'status'], 'act', p.act, 'watch', p.watch, 'ok', p.ok, p.draft] as unknown as string;
    map.setPaintProperty('site-fill', 'fill-color', color);
    map.setPaintProperty('site-line', 'line-color', color);
  }, [theme, ready]);

  // ---- Data ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('grid') as GeoJSONSource).setData(grid ? gridLines(grid) : EMPTY);
    (map as MlMap & { _place?: () => void })._place?.();
  }, [grid, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('sites') as GeoJSONSource).setData({ type: 'FeatureCollection', features: sites.map((s) => circle(s, status.get(s.id) ?? 'draft', s.id === hover || s.id === focus)) });
  }, [sites, status, hover, focus, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('cell') as GeoJSONSource).setData(grid && hoverRef ? cellPolygon(grid, hoverRef) : EMPTY);
  }, [grid, hoverRef, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('fires') as GeoJSONSource).setData({ type: 'FeatureCollection', features: hotspots.map((h) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } })) });
  }, [hotspots, ready]);

  // ---- Camera: the whole grid when it changes, one site when focused, or the country when empty ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pick = sites.find((s) => s.id === focus);
    const cb = countryBounds(country);
    const key = pick
      ? `site:${pick.id}:${pick.radiusKm}`
      : grid
        ? `grid:${grid.west}:${grid.south}:${grid.step}:${grid.cols}:${grid.rows}`
        : cb ? `country:${country}` : '';
    if (!key || key === fitted.current) return;
    fitted.current = key;
    const pad = { top: 36, bottom: 36, left: 40, right: 40 };
    if (pick) {
      const d = (pick.radiusKm * 2.4) / 111.32;
      const dl = d / Math.max(0.01, Math.cos((pick.lat * Math.PI) / 180));
      map.fitBounds([[pick.lon - dl, pick.lat - d], [pick.lon + dl, pick.lat + d]], { padding: pad, maxZoom: 11, duration: instant.current ? 0 : 700 });
    } else if (grid) {
      map.fitBounds([[grid.west, grid.south], [grid.west + grid.cols * grid.step, north(grid)]], { padding: pad, maxZoom: 10, duration: instant.current ? 0 : 700 });
    } else if (cb) {
      map.fitBounds(cb, { padding: pad, maxZoom: 10, duration: instant.current ? 0 : 700 });
    }
  }, [sites, grid, focus, ready, country]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) map.getCanvas().style.cursor = onAdd ? 'crosshair' : '';
  }, [onAdd, ready]);

  return (
    <div className="survey" data-adding={onAdd ? '' : undefined}>
      <div ref={el} className="survey-canvas" role="application" aria-label={label} />
      <div className="survey-frame" aria-hidden="true">
        {/* Map pixels are physical: left and top, in either reading direction. */}
        {frame.cols.map((c) => <span key={c.label} className="frame-col" style={{ left: c.x }}>{c.label}</span>)}
        {frame.rows.map((r) => <span key={r.label} className="frame-row" style={{ top: r.y }}>{r.label}</span>)}
      </div>
      {hint && <p className="survey-hint" data-error={hint.error || undefined} role="status">{hint.text}</p>}
      {failed && <p className="survey-hint" data-error="" role="alert">{t.map.failed}</p>}
    </div>
  );
}
