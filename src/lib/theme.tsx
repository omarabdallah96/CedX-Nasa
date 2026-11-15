// Light or dark: follows the system setting until the visitor picks one.
// index.html sets data-theme before first paint; this module keeps it in step.
import { useSyncExternalStore } from 'react';
import { useI18n } from '../i18n/index.tsx';

export type Theme = 'light' | 'dark';
const KEY = 'firesight.theme';
const system = window.matchMedia('(prefers-color-scheme: light)');
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const systemTheme = (): Theme => (system.matches ? 'light' : 'dark');

// The intro is a night scene (a globe in space) in both themes; only the tool follows the visitor's theme.
// Starts from the same test as the inline script in index.html: a tool route is '#/<place>'.
let nightStage = !/^#\/[a-z-]+$/.test(window.location.hash);

function apply() {
  document.documentElement.dataset.theme = nightStage ? 'dark' : stored() ?? systemTheme();
  listeners.forEach((f) => f());
}

export function setNightStage(on: boolean) {
  if (on === nightStage) return;
  nightStage = on;
  apply();
}
system.addEventListener('change', apply);
apply();

/** The theme on screen, for drawing code outside React. */
export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

/** Picking the theme the system already shows forgets the choice, so the page follows the system again. */
function setTheme(next: Theme) {
  try {
    if (next === systemTheme()) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
  } catch {
    // Storage is blocked: the attribute alone carries the choice for this visit.
    document.documentElement.dataset.theme = next;
    listeners.forEach((f) => f());
    return;
  }
  apply();
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme);
}

export function ThemeSwitch() {
  const theme = useTheme();
  const { t } = useI18n();
  const next: Theme = theme === 'light' ? 'dark' : 'light';
  return (
    <button type="button" className="lang-switch theme-switch" aria-label={t.theme[next]} title={t.theme[next]} onClick={() => setTheme(next)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === 'light' ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}
