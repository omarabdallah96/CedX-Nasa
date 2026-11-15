import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent, MapTouchEvent, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 ships as ES modules and needs to be told where its worker lives.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useI18n } from '../i18n/index.tsx';
import type { Manifest } from '../lib/analysis.ts';
import type { BBox } from '../lib/harmonize.ts';
import { EMBER, SERIES } from '../lib/color.ts';
import type { GlobeView } from '../lib/types.ts';
import type { PointsResult } from '../worker/analysis.worker.ts';

const GIBS =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';

/** Also the base of the organization console's map. */
export const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1, 6, 0] },
  sources: {
    bluemarble: {
      type: 'raster',
      tiles: [GIBS],
      tileSize: 256,
      maxzoom: 8,
      attribution: 'Imagery: NASA GIBS Blue Marble · Borders: Natural Earth · Hotspots: NASA FIRMS',
    },
  },
  layers: [
    { id: 'space', type: 'background', paint: { 'background-color': '#06070a' } },
    {
      id: 'bluemarble',
      type: 'raster',
      source: 'bluemarble',
      paint: { 'raster-brightness-max': 0.6, 'raster-saturation': -0.5, 'raster-contrast': 0.12, 'raster-fade-duration': 300 },
    },
  ],
};

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const MED_VIEW = { center: [14, 37] as [number, number], zoom: 2.7 };
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function bboxPolygon(b: BBox): FeatureCollection {
  const [w, s, e, n] = b;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    }],
  };
}

interface Props {
  phase: 'intro' | 'tool';
  /** Intro only: what the globe is doing behind the story. */
  view: GlobeView;
  countries: Manifest[];
  slug: string;
  bbox: BBox | null;
  drawing: boolean;
  onDraw: (bbox: BBox | null) => void;
  onPick: (slug: string) => void;
  density: Float32Array | null;
  points: PointsResult | null;
  dataUrl: string;
}

export function MapPanel(props: Props) {
  const { phase, view, countries, slug, bbox, drawing, onDraw, onPick, density, points, dataUrl } = props;
  const { t } = useI18n();
  const rtl = t.dir === 'rtl';
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const latest = useRef({ onDraw, onPick });
  latest.current = { onDraw, onPick };
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: el.current,
        style: STYLE,
        center: reducedMotion.current ? MED_VIEW.center : [-30, 25],
        zoom: reducedMotion.current ? MED_VIEW.zoom : 1.9,
        minZoom: 1.2,
        maxZoom: 11,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: false,
      });
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.on('load', () => {
      map.addSource('countries', { type: 'geojson', data: `${dataUrl}countries.geojson` });
      map.addSource('density', { type: 'geojson', data: EMPTY });
      map.addSource('points', { type: 'geojson', data: EMPTY });
      map.addSource('bbox', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'country-glow', type: 'line', source: 'countries',
        paint: { 'line-color': EMBER[6], 'line-width': 7, 'line-blur': 7, 'line-opacity': 0.5 },
      });
      map.addLayer({
        id: 'country-fill', type: 'fill', source: 'countries',
        paint: { 'fill-color': EMBER[6], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.35, 5, 0.03] },
      });
      map.addLayer({
        id: 'country-line', type: 'line', source: 'countries',
        paint: { 'line-color': EMBER[7], 'line-width': 1.2, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'density', type: 'circle', source: 'density',
        paint: {
          // A 0.05° cell is about 4.5 px wide at zoom 7; keep the dots near that size.
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 4, 0.5, 7, 3.4, 10, 27],
          'circle-color': ['interpolate', ['linear'], ['get', 't'], 0, EMBER[3], 0.5, EMBER[5], 1, EMBER[7]],
          'circle-opacity': ['interpolate', ['linear'], ['get', 't'], 0, 0, 0.25, 0.1, 0.6, 0.45, 1, 0.8],
          'circle-blur': 0.5,
        },
      });
      map.addLayer({
        id: 'points', type: 'circle', source: 'points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 8, 3, 11, 5],
          'circle-color': ['match', ['get', 's'], 1, '#fff0c2', '#9cc4f5'],
          'circle-stroke-color': ['match', ['get', 's'], 1, SERIES.viirs, SERIES.modis],
          'circle-stroke-width': 1,
          'circle-opacity': 0.95,
        },
      });
      map.addLayer({ id: 'bbox-fill', type: 'fill', source: 'bbox', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.06 } });
      map.addLayer({
        id: 'bbox-line', type: 'line', source: 'bbox',
        paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [3, 2] },
      });
      setReady(true);
    });
    map.on('error', (e) => {
      // Tile hiccups are routine; only surface failures that leave the map unusable.
      if (!map.loaded() && e.error && /webgl/i.test(e.error.message)) setFailed(e.error.message);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [dataUrl]);

  // Country markers double as the picker on the globe.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers = countries.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'map-marker';
      const name = t.country(c.slug, c.name);
      b.textContent = name;
      b.setAttribute('aria-label', t.map.open(name));
      b.addEventListener('click', () => latest.current.onPick(c.slug));
      const cx = (c.focus[0] + c.focus[2]) / 2;
      const cy = (c.focus[1] + c.focus[3]) / 2;
      // A neighbour close by to the east or west pushes the label to the far side.
      const near = countries.find((o) => o !== c && Math.abs((o.focus[0] + o.focus[2]) / 2 - cx) < 6 && Math.abs((o.focus[1] + o.focus[3]) / 2 - cy) < 3);
      const side = near ? ((near.focus[0] + near.focus[2]) / 2 > cx ? 'right' : 'left') : 'bottom';
      return new maplibregl.Marker({ element: b, anchor: side, offset: side === 'bottom' ? [0, -6] : [side === 'right' ? -10 : 10, 0] })
        .setLngLat(side === 'bottom' ? [cx, c.focus[3]] : [side === 'right' ? c.focus[0] : c.focus[2], cy])
        .addTo(map);
    });
    return () => markers.forEach((m) => m.remove());
  }, [countries, ready, t]);

  // Camera: spin during the intro, settle on the Mediterranean to pick, fly to the country in the tool.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const instant = reducedMotion.current;
    if (phase === 'tool') {
      for (const h of [map.scrollZoom, map.dragPan, map.doubleClickZoom, map.touchZoomRotate, map.keyboard]) h.enable();
      map.touchZoomRotate.disableRotation();
      map.setPadding({ left: 0, top: 0, right: 0, bottom: 0 });
      const target = bbox ?? countries.find((c) => c.slug === slug)?.focus;
      if (target) {
        map.fitBounds([[target[0], target[1]], [target[2], target[3]]], {
          padding: 48, duration: instant ? 0 : 2200, maxZoom: 10, essential: true,
        });
      }
      return;
    }
    for (const h of [map.scrollZoom, map.dragPan, map.doubleClickZoom, map.touchZoomRotate, map.keyboard]) h.disable();
    // Under the veil the globe rests where it is.
    if (view === 'hold') return;
    if (view === 'pick' || instant) {
      const wide = view === 'pick' && window.innerWidth >= 1000;
      map.easeTo({
        ...MED_VIEW,
        // With the card on the right, the view slides west so it does not cover Lebanon.
        center: wide && rtl ? [MED_VIEW.center[0] + 5, MED_VIEW.center[1]] : MED_VIEW.center,
        zoom: wide ? 3.3 : MED_VIEW.zoom,
        // Room for the card of places, which sits on the side where reading starts.
        padding: { left: wide && !rtl ? 640 : 0, top: 0, right: wide && rtl ? 640 : 0, bottom: 0 },
        duration: instant ? 0 : 1800,
        essential: true,
      });
      return;
    }
    map.setPadding({ left: 0, top: 0, right: 0, bottom: 0 });
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng + dt * 0.004, 25], zoom: 1.9 });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // bbox is handled below so drawing does not re-trigger the fly-in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, view, slug, countries, ready, rtl]);

  // Selection rectangle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('bbox') as GeoJSONSource).setData(bbox ? bboxPolygon(bbox) : EMPTY);
    if (phase !== 'tool') return;
    // Frame the drawn box, or go back to the whole country when it is cleared.
    const target = bbox ?? countries.find((c) => c.slug === slug)?.focus;
    if (target) {
      map.fitBounds([[target[0], target[1]], [target[2], target[3]]], {
        padding: bbox ? 64 : 48, duration: reducedMotion.current ? 0 : 900, maxZoom: 10,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, ready]);

  // Draw-a-box interaction.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !drawing) return;
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'crosshair';
    let start: maplibregl.LngLat | null = null;
    const box = (a: maplibregl.LngLat, b: maplibregl.LngLat): BBox => [
      Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat),
    ];
    const down = (e: MapMouseEvent | MapTouchEvent) => {
      e.preventDefault();
      start = e.lngLat;
    };
    const move = (e: MapMouseEvent | MapTouchEvent) => {
      if (!start) return;
      e.preventDefault();
      (map.getSource('bbox') as GeoJSONSource).setData(bboxPolygon(box(start, e.lngLat)));
    };
    const up = (e: MapMouseEvent | MapTouchEvent) => {
      if (!start) return;
      const b = box(start, e.lngLat);
      start = null;
      // Ignore accidental clicks: the box must be at least ~2 km across.
      latest.current.onDraw(b[2] - b[0] > 0.02 && b[3] - b[1] > 0.02 ? (b.map((v) => Math.round(v * 1000) / 1000) as BBox) : null);
    };
    map.on('mousedown', down);
    map.on('mousemove', move);
    map.on('mouseup', up);
    map.on('touchstart', down);
    map.on('touchmove', move);
    map.on('touchend', up);
    return () => {
      map.off('mousedown', down);
      map.off('mousemove', move);
      map.off('mouseup', up);
      map.off('touchstart', down);
      map.off('touchmove', move);
      map.off('touchend', up);
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
    };
  }, [drawing, ready]);

  // All-time harmonized footprint.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!density) {
      (map.getSource('density') as GeoJSONSource).setData(EMPTY);
      return;
    }
    let max = 0;
    for (let i = 2; i < density.length; i += 3) max = Math.max(max, density[i]);
    const features: Feature[] = [];
    for (let i = 0; i < density.length; i += 3) {
      features.push({
        type: 'Feature',
        properties: { t: Math.sqrt(density[i + 2] / max) },
        geometry: { type: 'Point', coordinates: [density[i], density[i + 1]] },
      });
    }
    (map.getSource('density') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [density, ready]);

  // Detections of the selected month.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const features: Feature[] = [];
    if (points) {
      for (let i = 0; i < points.lon.length; i++) {
        features.push({
          type: 'Feature',
          properties: { s: points.sensor[i] },
          geometry: { type: 'Point', coordinates: [points.lon[i], points.lat[i]] },
        });
      }
    }
    (map.getSource('points') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [points, ready]);

  return (
    <div className="map" data-phase={phase} data-drawing={drawing || undefined} data-pick={(phase === 'intro' && view === 'pick') || undefined}>
      <div ref={el} className="map-canvas" role="application" aria-label={t.map.aria} />
      {failed && (
        <p className="map-failed" role="alert">
          {t.map.failed(failed)}
        </p>
      )}
    </div>
  );
}
