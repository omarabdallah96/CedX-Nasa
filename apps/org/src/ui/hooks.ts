// Data hooks shared by several screens.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { API, type Hotspot, type Site, type Status } from '../lib/api.ts';

/** Live satellite fires (48 h) of every country that holds a site. */
export function useHotspots(sites: Site[], stamp?: string) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const countries = useMemo(() => [...new Set(sites.map((s) => s.country).filter(Boolean))].sort().join(','), [sites]);
  useEffect(() => {
    if (!countries) return setHotspots([]);
    let alive = true;
    Promise.all(countries.split(',').map((slug) =>
      fetch(`${API}/countries/${slug}/live?hours=48`).then((r) => (r.ok ? r.json() : { hotspots: [] })).then((j: { hotspots: Hotspot[] }) => j.hotspots, () => [] as Hotspot[]),
    )).then((lists) => alive && setHotspots(lists.flat().filter((h) => h.confidence !== 'low')));
    return () => {
      alive = false;
    };
  }, [countries, stamp]);
  return hotspots;
}

/** Where sites can be: the boxes of the countries Firesight covers. */
export function useCoverage() {
  const [coverage, setCoverage] = useState<{ name: string; bbox: [number, number, number, number] }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`${API}/countries`).then((r) => r.json()).then(
      (j: { countries: { name: string; bbox: [number, number, number, number] }[] }) => alive && setCoverage(j.countries),
      () => undefined, // The server still refuses a site outside coverage when it is saved.
    );
    return () => {
      alive = false;
    };
  }, []);
  return coverage;
}

/**
 * Status changes a person has not seen yet, per organization in this browser.
 * A site whose status differs from the last one this person saw stays marked
 * until they hover or open it.
 */
export function useUnseenChanges(orgId: string, statuses: Map<string, Status>) {
  const key = `firesight.org.seen.${orgId}`;
  const [seen, setSeen] = useState<Record<string, Status>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? 'null') ?? {};
    } catch {
      return {};
    }
  });
  // The first time, everything on screen counts as seen.
  useEffect(() => {
    if (statuses.size === 0 || Object.keys(seen).length > 0) return;
    const all = Object.fromEntries(statuses);
    setSeen(all);
    try { window.localStorage.setItem(key, JSON.stringify(all)); } catch { /* per visit */ }
  }, [statuses, seen, key]);
  const changed = useMemo(() => new Set([...statuses].filter(([id, s]) => seen[id] !== undefined && seen[id] !== s).map(([id]) => id)), [statuses, seen]);
  const markSeen = (id: string) => {
    const s = statuses.get(id);
    if (!s || seen[id] === s) return;
    const next = { ...seen, [id]: s };
    setSeen(next);
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* per visit */ }
  };
  return { changed, markSeen };
}

/** Rows that move when the ranking changes slide to their new place instead of jumping. */
export function useReorderMotion<T extends HTMLElement>(keys: string[]) {
  const box = useRef<T>(null);
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = new Map<string, number>();
    for (const row of el.querySelectorAll<HTMLElement>('[data-key]')) {
      const k = row.dataset.key!;
      const top = row.getBoundingClientRect().top;
      now.set(k, top);
      const before = last.current.get(k);
      if (!still && before !== undefined && Math.abs(before - top) > 1) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], { duration: 420, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      }
    }
    last.current = now;
  }, [keys.join('|')]);
  return box;
}
