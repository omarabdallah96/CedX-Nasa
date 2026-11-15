// The site list: find a site, see its grid square and status; owners add sites
// on the map or from a CSV and edit them in place, then save once.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, type Site, type Status } from '../../lib/api.ts';
import { downloadCsv, parseSitesCsv } from '../../lib/csv.ts';
import { errorText, useT } from '../../lib/i18n.ts';
import { makeGrid, refOf } from '../../lib/grid.ts';
import { useOrg } from '../../lib/session.tsx';
import { useCoverage } from '../../ui/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { Notice, StatusGlyph, useToast } from '../../ui/parts.tsx';
import { PageHead } from '../../ui/Shell.tsx';
import { SurveyMap } from '../../ui/SurveyMap.tsx';

const MAX_SITES = 200;
const byName = (sites: Site[]) => [...sites].sort((a, b) => a.name.localeCompare(b.name));

export function Sites() {
  const { t, f } = useT();
  const { org, board, reloadOrgs, reloadBoard } = useOrg();
  const owner = org.role === 'owner';
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const coverage = useCoverage();
  const saved = useMemo(() => byName(org.sites), [org.sites]);
  const [draft, setDraft] = useState<Site[]>(saved);
  const [adding, setAdding] = useState(params.get('add') === '1' && owner);
  const [refused, setRefused] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<Status | 'all'>('all');
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // A saved list from the server (after saving, or another owner's save) replaces the draft when nothing is pending here.
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  useEffect(() => {
    if (params.get('add')) setParams((p) => { p.delete('add'); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statuses = useMemo(() => new Map<string, Status>(board?.sites.map((s) => [s.site.id, s.status]) ?? []), [board]);
  const scores = useMemo(() => new Map(board?.sites.map((s) => [s.site.id, s.score]) ?? []), [board]);
  const grid = useMemo(() => makeGrid(draft.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))), [draft]);
  const ref = (s: Site) => (grid && Number.isFinite(s.lat) && Number.isFinite(s.lon) ? refOf(grid, s.lat, s.lon) : '–');
  const full = draft.length >= MAX_SITES;

  const shown = draft.filter((s) => {
    if (query && !s.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (only !== 'all' && statuses.get(s.id) !== only) return false;
    return true;
  });

  const patch = (id: string, change: Partial<Site>) => {
    setNote(null);
    setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...change } : s)));
  };
  const optional = (v: string) => (v.trim() === '' ? null : Number(v));

  const addAt = (lat: number, lon: number) => {
    const covered = coverage.length === 0 || coverage.some(({ bbox: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n);
    if (!covered) return setRefused(t.sites.outside(coverage.map((c) => c.name).join(', ')));
    setRefused(null);
    setDraft((d) => (d.length >= MAX_SITES ? d : [...d, {
      id: crypto.randomUUID(), name: t.sites.newName(d.length + 1), lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
      radiusKm: 5, value: null, people: null, startedYear: null,
    }]));
  };

  const importCsv = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    const rows = parseSitesCsv(await picked.text());
    const good = rows.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (file.current) file.current.value = '';
    if (good.length === 0) return setError(t.sites.importNone);
    const room = MAX_SITES - draft.length;
    setDraft([...draft, ...good.slice(0, room)]);
    setNote(t.sites.imported(Math.min(good.length, room), rows.length, rows.length - good.length, good.length > room, MAX_SITES));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { sites } = await api<{ sites: Site[] }>('PUT', `/orgs/${org.id}/sites`, { sites: draft });
      // The server fills in what the draft did not know (the country), so adopt its copy or the list stays dirty.
      setDraft(byName(sites));
      await reloadOrgs();
      void reloadBoard();
      setAdding(false);
      toast({ text: t.sites.saved(sites.length), tone: 'done' });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sites-page">
      <PageHead title={t.sites.title} sub={t.sites.count(draft.length, MAX_SITES)}>
        {owner && (
          <>
            <button type="button" className="btn btn-quiet" aria-pressed={adding} disabled={full && !adding} onClick={() => { setAdding(!adding); setRefused(null); }}>
              <Icon name={adding ? 'check' : 'plus'} size={16} />{adding ? t.sites.addCancel : t.sites.add}
            </button>
            <button type="button" className="btn btn-quiet" disabled={full} onClick={() => file.current?.click()}><Icon name="upload" size={16} />{t.sites.import}</button>
            <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void importCsv(e.target.files?.[0])} />
          </>
        )}
      </PageHead>

      <div className="sites-map">
        <SurveyMap
          sites={draft.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))} status={statuses} grid={grid}
          hover={hover} hoverRef={hover ? ref(draft.find((s) => s.id === hover) ?? draft[0]) : null}
          onHover={setHover} onSelect={(id) => (saved.some((s) => s.id === id) ? navigate(`/app/sites/${id}`) : setHover(id))}
          onAdd={adding ? addAt : null} hint={adding ? { text: refused ?? t.sites.addHint, error: !!refused } : null} country={org.country} label={t.overview.mapLabel}
        />
      </div>

      {(dirty || error || note) && (
        <div className="savebar" role="region" aria-label={t.sites.unsaved}>
          {error ? <Notice tone="error">{error}</Notice> : note ? <Notice tone="info" role="status">{note}</Notice> : <Notice tone="warn">{t.sites.unsaved}</Notice>}
          {dirty && owner && (
            <div className="savebar-actions">
              <button type="button" className="btn btn-quiet" onClick={() => { setDraft(saved); setNote(null); setError(null); }}>{t.sites.discard}</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? t.common.saving : t.sites.save}</button>
            </div>
          )}
        </div>
      )}

      <div className="filters">
        <label className="search">
          <Icon name="search" size={16} />
          <span className="sr-only">{t.sites.search}</span>
          <input type="search" placeholder={t.sites.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="segmented" role="group" aria-label={t.sites.filterStatus}>
          {(['all', 'act', 'watch', 'ok'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={only === k} onClick={() => setOnly(k)}>
              {k !== 'all' && <StatusGlyph status={k} />}{k === 'all' ? t.sites.all : t.status[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="table sites-table" data-editable={owner || undefined}>
          <thead>
            <tr>
              <th scope="col">{t.sites.cols.name}</th>
              <th scope="col">{t.sites.cols.grid}</th>
              <th scope="col">{t.sites.cols.status}</th>
              <th scope="col" className="num">{t.sites.cols.lat}</th>
              <th scope="col" className="num">{t.sites.cols.lon}</th>
              <th scope="col" className="num">{t.sites.cols.radius}</th>
              <th scope="col" className="num">{t.sites.cols.value}</th>
              <th scope="col" className="num">{t.sites.cols.people}</th>
              <th scope="col" className="num">{t.sites.cols.started}</th>
              <th scope="col"><span className="sr-only">{t.common.show}</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const st = statuses.get(s.id);
              const isSaved = saved.some((x) => x.id === s.id);
              return (
                <tr key={s.id} data-hot={hover === s.id || undefined} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
                  <th scope="row">
                    {owner
                      ? <input aria-label={t.sites.cols.name} value={s.name} maxLength={80} onChange={(e) => patch(s.id, { name: e.target.value })} />
                      : <Link to={`/app/sites/${s.id}`}>{s.name}</Link>}
                  </th>
                  <td><span className="ref num">{ref(s)}</span></td>
                  <td>{st ? <span className="status-cell" data-status={st}><StatusGlyph status={st} />{t.status[st]} <b className="num">{scores.get(s.id)}</b></span> : <span className="muted">–</span>}</td>
                  {owner ? (
                    <>
                      <td className="num"><input aria-label={t.sites.cols.lat} type="number" step="any" value={Number.isFinite(s.lat) ? s.lat : ''} onChange={(e) => patch(s.id, { lat: Number(e.target.value) })} /></td>
                      <td className="num"><input aria-label={t.sites.cols.lon} type="number" step="any" value={Number.isFinite(s.lon) ? s.lon : ''} onChange={(e) => patch(s.id, { lon: Number(e.target.value) })} /></td>
                      <td className="num"><input aria-label={t.sites.cols.radius} type="number" min={0.5} max={50} step="0.5" value={s.radiusKm} onChange={(e) => patch(s.id, { radiusKm: Number(e.target.value) })} /></td>
                      <td className="num"><input aria-label={t.sites.cols.value} type="number" min={0} value={s.value ?? ''} onChange={(e) => patch(s.id, { value: optional(e.target.value) })} /></td>
                      <td className="num"><input aria-label={t.sites.cols.people} type="number" min={0} step={1} value={s.people ?? ''} onChange={(e) => patch(s.id, { people: optional(e.target.value) })} /></td>
                      <td className="num"><input aria-label={t.sites.cols.started} type="number" min={2000} max={new Date().getFullYear()} step={1} value={s.startedYear ?? ''} onChange={(e) => patch(s.id, { startedYear: optional(e.target.value) })} /></td>
                    </>
                  ) : (
                    <>
                      <td className="num">{f.one(s.lat)}</td>
                      <td className="num">{f.one(s.lon)}</td>
                      <td className="num">{f.one(s.radiusKm)}</td>
                      <td className="num">{s.value === null ? '–' : f.compact(s.value)}</td>
                      <td className="num">{s.people === null ? '–' : f.int(s.people)}</td>
                      <td className="num">{s.startedYear ?? '–'}</td>
                    </>
                  )}
                  <td className="row-actions">
                    {isSaved && <Link className="icon-btn" to={`/app/sites/${s.id}`} aria-label={`${t.common.show} ${s.name}`}><Icon name="forward" size={16} /></Link>}
                    {owner && <button type="button" className="icon-btn danger" aria-label={`${t.common.remove} ${s.name}`} onClick={() => setDraft((d) => d.filter((x) => x.id !== s.id))}><Icon name="trash" size={16} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="table-empty">{t.sites.none}</p>}
      </div>

      <p className="fine">
        {owner ? (
          <>
            {t.sites.csvHelp}{' '}
            <button type="button" className="link" onClick={() => downloadCsv('firesight_sites_template.csv', [['name', 'lat', 'lon', 'radius_km', 'value', 'people', 'started_year'], ['Akkar orchard', 34.45, 36.24, 10, 400000, 12, 2019]])}>
              {t.sites.template}
            </button>
          </>
        ) : t.sites.memberNote}
      </p>
    </div>
  );
}
