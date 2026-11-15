// The product page: what Firesight for Organizations answers, shown at work on
// a sample survey plate (labelled as sample data), the four ways to use it,
// how it works, its sources, and the request for access.
import { Link } from 'react-router';
import { ORG_KINDS, type Status } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { Icon } from '../ui/icons.tsx';
import { StatusGlyph } from '../ui/parts.tsx';
import { PublicFrame } from './PublicFrame.tsx';

/** The sample plate: authored contours, a grid and three sites. Sample data, not a customer. */
function SamplePlate() {
  const { t, f } = useT();
  const sites: { name: string; ref: string; status: Status; x: number; y: number; r: number; why: string; days: string[] }[] = [
    { name: 'Qobayat', ref: 'C1', status: 'act', x: 238, y: 72, r: 30, why: t.why({ code: 'fire_near', km: 2.1, compass: 'north-east', at: new Date(Date.now() - 38 * 60_000).toISOString() }, f), days: ['high', 'very_high', 'very_high', 'high', 'moderate', 'moderate', 'low'] },
    { name: 'Hermel', ref: 'D2', status: 'watch', x: 330, y: 150, r: 38, why: t.why({ code: 'danger_peak', level: 'very_high', date: nextWeekday(4) }, f), days: ['moderate', 'moderate', 'high', 'very_high', 'high', 'moderate', 'low'] },
    { name: 'Halba', ref: 'B2', status: 'ok', x: 118, y: 168, r: 24, why: t.why({ code: 'quiet', forecast: true }, f), days: ['low', 'low', 'moderate', 'moderate', 'low', 'low', 'very_low'] },
  ];
  const cols = ['A', 'B', 'C', 'D'];
  return (
    <figure className="plate" aria-label={t.landing.sampleTitle}>
      <div className="plate-map">
        <svg viewBox="0 0 400 240" role="img" aria-label={t.landing.sampleTitle}>
          <g className="plate-contours">
            <path d="M40 210c30-40 20-90 70-120s110-30 150 0 60 70 110 80" />
            <path d="M70 220c20-30 25-70 60-95s80-25 115 0 55 55 95 65" />
            <path d="M200 40c40 10 70 40 110 30s50-30 80-20" />
            <path d="M215 60c30 8 55 30 90 22s45-22 70-15" />
            <path d="M230 82c25 6 42 20 70 15s38-15 55-10" />
            <path d="M20 120c25-10 45-35 80-30s45 30 70 25" />
            <path d="M30 140c22-8 40-25 68-22s40 22 62 20" />
            <path d="M260 230c10-25 40-40 70-38s45 18 60 10" />
          </g>
          <g className="plate-grid">
            {[1, 2, 3].map((i) => <line key={`v${i}`} x1={i * 100} y1={0} x2={i * 100} y2={240} />)}
            {[1, 2].map((j) => <line key={`h${j}`} x1={0} y1={j * 80} x2={400} y2={j * 80} />)}
          </g>
          <rect className="plate-cell" x={200} y={0} width={100} height={80} />
          <circle className="plate-fire" cx={262} cy={52} r={3.5} />
          <circle className="plate-fire" cx={270} cy={47} r={2.5} />
          {sites.map((s) => <circle key={s.name} className="plate-site" data-status={s.status} cx={s.x} cy={s.y} r={s.r} />)}
        </svg>
        <div className="plate-frame" aria-hidden="true">
          {cols.map((c, i) => <span key={c} className="frame-col" style={{ left: `${12.5 + i * 25}%` }}>{c}</span>)}
          {[1, 2, 3].map((r, j) => <span key={r} className="frame-row" style={{ top: `${16.6 + j * 33.3}%` }}>{r}</span>)}
        </div>
      </div>
      <ol className="plate-board">
        {sites.map((s, i) => (
          <li key={s.name} data-hot={i === 0 || undefined}>
            <StatusGlyph status={s.status} size={14} />
            <span className="plate-name">{s.name}</span>
            <span className="ref num">{s.ref}</span>
            <span className="plate-why">{s.why}</span>
            <span className="plate-strip" aria-hidden="true">{s.days.map((d, k) => <i key={k} data-level={d} />)}</span>
          </li>
        ))}
      </ol>
      <figcaption>{t.common.synthetic}</figcaption>
    </figure>
  );
}

/** The days of a sample week: the plate always reads as this week. */
function nextWeekday(ahead: number) {
  return new Date(Date.now() + ahead * 86_400_000).toISOString().slice(0, 10);
}
export function Landing() {
  const { t } = useT();
  const tools: Record<string, string> = { fire_station: t.tools.briefing, insurer: t.tools.exposure, company: t.tools.planner, ngo: t.tools.impact };
  return (
    <PublicFrame wide>
      <section className="hero">
        <div className="hero-copy">
          <h1>{t.landing.title}</h1>
          <p className="hero-lede">{t.landing.lede}</p>
          <div className="hero-actions">
            <Link className="btn btn-big" to="/request-access">{t.landing.request}<Icon name="forward" size={16} /></Link>
            <Link className="btn btn-quiet btn-big" to="/login">{t.landing.signIn}</Link>
          </div>
          <p className="hero-note"><Icon name="shield" size={15} />{t.landing.note}</p>
        </div>
        <SamplePlate />
      </section>

      <section className="band" aria-labelledby="sectors-h">
        <h2 id="sectors-h">{t.landing.sectorsTitle}</h2>
        <dl className="gazetteer">
          {ORG_KINDS.map((k) => (
            <div key={k}>
              <dt>{t.kind[k]}</dt>
              <dd>{t.kindHint[k]}</dd>
              <dd className="gaz-tool">{tools[k]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="band" aria-labelledby="how-h">
        <h2 id="how-h">{t.landing.howTitle}</h2>
        <ol className="steps">
          {t.landing.how.map(([title, text], i) => (
            <li key={title}>
              <span className="step-n num">{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="band" aria-labelledby="sources-h">
        <h2 id="sources-h">{t.landing.sourcesTitle}</h2>
        <div className="sources">
          {t.landing.sources.map(([title, text]) => (
            <div key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <p className="honest"><Icon name="info" size={16} />{t.landing.honest}</p>
      </section>

      <section className="close">
        <h2>{t.landing.closeTitle}</h2>
        <p>{t.landing.closeLede}</p>
        <Link className="btn btn-big" to="/request-access">{t.landing.request}<Icon name="forward" size={16} /></Link>
      </section>
    </PublicFrame>
  );
}
