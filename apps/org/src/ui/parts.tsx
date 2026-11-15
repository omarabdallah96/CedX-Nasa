// Small pieces every screen shares: status marks, the danger strip, the
// history bars, notices, empty states, loading rows, dialogs and toasts.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { LEVELS, type Day, type History, type Status, type Why } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { Icon, type IconName } from './icons.tsx';

/** One circle, three fills: the same geometry as a site on the map. */
export function StatusGlyph({ status, size = 12 }: { status: Status; size?: number }) {
  const r = size / 2 - 1;
  const c = size / 2;
  return (
    <svg className="glyph" data-status={status} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth={1.5} />
      {status === 'act' && <circle cx={c} cy={c} r={r - 2.5} fill="currentColor" />}
      {status === 'watch' && <path d={`M${c} ${c - r + 2.5} A${r - 2.5} ${r - 2.5} 0 0 1 ${c} ${c + r - 2.5} Z`} fill="currentColor" />}
    </svg>
  );
}

export function StatusTag({ status, score }: { status: Status; score?: number }) {
  const { t } = useT();
  return (
    <span className="status-tag" data-status={status}>
      <StatusGlyph status={status} />
      <span>{t.status[status]}</span>
      {score !== undefined && <b className="num">{score}</b>}
    </span>
  );
}

/** One cell per day, coloured by danger class and lettered so colour is never the only cue. Today first, in reading order. */
export function DangerStrip({ days, labels = false, compact = false }: { days: Day[]; labels?: boolean; compact?: boolean }) {
  const { t, f } = useT();
  return (
    <ol className="strip" data-labels={labels || undefined} data-compact={compact || undefined} aria-label={t.site.week}>
      {days.map((d) => (
        <li key={d.date} data-level={d.level} title={`${f.weekday(d.date)} ${f.dayMonth(d.date)}: ${t.level[d.level]} (FWI ${f.one(d.fwi)})`}>
          {labels && <small>{f.weekdayShort(d.date)}</small>}
          <b>{t.levelShort[d.level]}</b>
          <span className="sr-only">{`${f.weekday(d.date)}: ${t.level[d.level]}`}</span>
        </li>
      ))}
    </ol>
  );
}

export function DangerKey() {
  const { t } = useT();
  return (
    <ul className="strip-key" aria-label={t.site.week}>
      {LEVELS.map((l) => <li key={l} data-level={l}><b>{t.levelShort[l]}</b>{t.level[l]}</li>)}
    </ul>
  );
}

/** A site's fire activity per year; the dashed line is where a project started. */
export function YearBars({ history, compact = false }: { history: History; compact?: boolean }) {
  const { t, f } = useT();
  const max = Math.max(1, ...history.years.map((y) => y.value));
  const started = history.project?.startedYear;
  return (
    <figure className="years" data-compact={compact || undefined}>
      <ol>
        {history.years.map((y) => (
          <li
            key={y.year}
            data-partial={!y.complete || undefined}
            data-start={y.year === started || undefined}
            data-worst={history.worstYear?.year === y.year || undefined}
            title={`${y.year}: ${f.one(y.value)}`}
          >
            <i style={{ blockSize: `${Math.max(y.value > 0 ? 3 : 0, (y.value / max) * 100)}%` }} />
            <span className="sr-only">{`${y.year}: ${f.one(y.value)}`}</span>
          </li>
        ))}
      </ol>
      <figcaption>
        <span className="num">{history.years[0]?.year}</span>
        <span>{t.site.historyAxis} · {t.site.peak(f.int(max))}</span>
        <span className="num">{history.years.at(-1)?.year}</span>
      </figcaption>
    </figure>
  );
}

export function WhyText({ why }: { why: Why }) {
  const { t, f } = useT();
  return <>{t.why(why, f)}</>;
}

export function Notice({ tone = 'info', icon, children, role }: { tone?: 'info' | 'warn' | 'done' | 'error'; icon?: IconName; children: ReactNode; role?: 'status' | 'alert' }) {
  const name: IconName = icon ?? (tone === 'warn' ? 'warn' : tone === 'done' ? 'check' : tone === 'error' ? 'warn' : 'info');
  return (
    <p className="notice" data-tone={tone} role={role ?? (tone === 'error' ? 'alert' : undefined)}>
      <Icon name={name} size={16} />
      <span>{children}</span>
    </p>
  );
}

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ inlineSize: `${92 - ((i * 17) % 30)}%` }} />)}
    </div>
  );
}

/** A native modal dialog: focus, Escape and the backdrop come from the browser. */
export function Dialog({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useT();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" data-wide={wide || undefined} onClose={onClose} aria-labelledby="dialog-title">
      <header>
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t.close}><Icon name="x" /></button>
      </header>
      {children}
    </dialog>
  );
}

// ---- Toasts ----
interface ToastItem { id: number; text: string; tone: 'info' | 'done' | 'error' | 'act'; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), t.tone === 'act' ? 12_000 : 4_000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            <Icon name={t.tone === 'act' ? 'fire' : t.tone === 'error' ? 'warn' : 'check'} size={16} />
            <span>{t.text}</span>
            {t.action && <button type="button" className="link" onClick={() => { t.action!.run(); setItems((l) => l.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Copies text and says so. */
export function useCopy() {
  const toast = useToast();
  const { t } = useT();
  return (text: string) => navigator.clipboard.writeText(text).then(
    () => toast({ text: t.common.copied, tone: 'done' }),
    () => toast({ text: t.errors.generic, tone: 'error' }),
  );
}
