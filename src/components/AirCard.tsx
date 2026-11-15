import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { airUrl, readAir, type AirReport } from '../lib/air.ts';

interface Point {
  lat: number;
  lon: number;
}

interface Props {
  /** Middle of the area on the map; used until the visitor shares a location. */
  centre: Point;
  /** Name of that area. */
  place: string;
  /** The backend's /api/v1/ address when it is reachable; Open-Meteo is asked directly otherwise. */
  api: string | null;
}

async function loadAir(at: Point, api: string | null, signal: AbortSignal): Promise<AirReport> {
  if (api) {
    try {
      const res = await fetch(`${api}air?lat=${at.lat.toFixed(3)}&lon=${at.lon.toFixed(3)}`, { signal });
      if (res.ok) return (await res.json()) as AirReport;
    } catch {
      // The backend is unreachable or busy: ask the weather service directly.
    }
  }
  const res = await fetch(airUrl(at.lat, at.lon), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readAir(await res.json());
}

const ltr = (text: string) => <span dir="ltr">{text}</span>;

/** Is the air safe to breathe here: the index, what drives it, CO2, and what to do. */
export function AirCard({ centre, place, api }: Props) {
  const { t } = useI18n();
  const a = t.air;
  const [mine, setMine] = useState<Point | null>(null);
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  const [state, setState] = useState<{ key: string; report?: AirReport; failed?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const at = mine ?? centre;
  const key = `${at.lat.toFixed(3)},${at.lon.toFixed(3)}`;

  useEffect(() => {
    const stop = new AbortController();
    loadAir(at, api, stop.signal).then(
      (report) => setState({ key, report }),
      () => !stop.signal.aborted && setState({ key, failed: true }),
    );
    return () => stop.abort();
    // `key` captures the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api, attempt]);

  const locate = () => {
    if (!navigator.geolocation) {
      setDenied(true);
      return;
    }
    setLocating(true);
    setDenied(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setMine({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setDenied(true);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  };

  const current = state?.key === key ? state : null;
  const r = current?.report;
  const main = r?.main ? r.pollutants[r.main] : null;

  return (
    <section className="now air" aria-labelledby="air-h" aria-busy={!current}>
      <div className="now-head">
        <h2 id="air-h" className="side-h">{a.title} <small>{mine ? a.atYou : a.atCentre(place)}</small></h2>
      </div>

      {!current && <p className="note" role="status">{a.loading}</p>}
      {current?.failed && (
        <>
          <p className="form-error" role="alert">{a.failed}</p>
          <button type="button" className="btn btn-quiet" onClick={() => setAttempt((n) => n + 1)}>{a.retry}</button>
        </>
      )}

      {r && (
        <>
          <p className="now-figure">
            <strong>{r.usAqi}</strong> {a.aqi}
            <span className="verdict-badge" data-air={r.level}><span aria-hidden="true">{r.safe ? '●' : '▲'}</span> {a.level[r.level]}</span>
          </p>
          <p className="now-line">{a.headline[r.level]}</p>

          <dl className="facts">
            {r.main && main && (
              <>
                <dt>{a.mainPollutant}</dt>
                <dd>{a.pollutant[r.main]}{main.value !== null && <> · {ltr(`${main.value} µg/m³`)}</>}</dd>
              </>
            )}
            {r.co2 && (
              <>
                <dt>{a.co2}</dt>
                <dd><strong>{ltr(`${r.co2.percent.toFixed(3)}%`)}</strong> · {ltr(`${r.co2.ppm} ppm`)} · {a.co2Level[r.co2.level]}</dd>
              </>
            )}
            {r.carbonMonoxidePpm !== null && (
              <>
                <dt>{a.co}</dt>
                <dd>{ltr(`${r.carbonMonoxidePpm} ppm`)}{r.pollutants.carbon_monoxide.level && <> · {a.level[r.pollutants.carbon_monoxide.level]}</>}</dd>
              </>
            )}
          </dl>
          {r.next24h && <p className="note">{a.next(r.next24h.peakAqi, a.level[r.next24h.peakLevel], r.next24h.peakAt.slice(11, 16))}</p>}

          <h3 className="side-sub">{a.whatToDo}</h3>
          <ul className="air-list">{a.advice[r.level].map((line) => <li key={line}>{line}</li>)}</ul>

          <details className="air-more">
            <summary>{a.co2}</summary>
            {r.co2 && <p className="note">{a.co2Note(r.co2.ppm, r.co2.percent)}</p>}
            <ul className="air-list">{a.tips.indoor.map((line) => <li key={line}>{line}</li>)}</ul>
          </details>
          <details className="air-more">
            <summary>{a.tips.smokeTitle}</summary>
            <ul className="air-list">{a.tips.smoke.map((line) => <li key={line}>{line}</li>)}</ul>
          </details>
        </>
      )}

      {denied && <p className="form-error" role="alert">{a.denied}</p>}
      <div className="area-actions">
        {mine
          ? <button type="button" className="btn btn-quiet" onClick={() => setMine(null)}>{a.backToPlace}</button>
          : <button type="button" className="btn" disabled={locating} onClick={locate}>{locating ? a.locating : a.useMine}</button>}
      </div>
      <p className="note air-model">{a.model}</p>
    </section>
  );
}
