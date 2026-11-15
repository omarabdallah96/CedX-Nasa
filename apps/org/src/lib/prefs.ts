// Theme and language, remembered in this browser. index.html applies both
// before first paint; this keeps React and the <html> element in step.
import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
export type Lang = 'en' | 'ar';
const THEME_KEY = 'firesight.org.theme';
const LANG_KEY = 'firesight.org.lang';
const NOTIFY_KEY = 'firesight.org.browserNotifications';

const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch {
    // Blocked storage: the choice holds for this visit.
  }
};

let state = {
  theme: (read(THEME_KEY) === 'light' ? 'light' : 'dark') as Theme,
  lang: (read(LANG_KEY) === 'ar' ? 'ar' : 'en') as Lang,
  notify: read(NOTIFY_KEY) === '1',
};
const listeners = new Set<() => void>();

function apply() {
  const d = document.documentElement;
  // Theme swaps skip every transition, so colours change at once instead of smearing.
  d.classList.add('no-motion');
  d.dataset.theme = state.theme;
  d.lang = state.lang;
  d.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  void d.offsetHeight;
  requestAnimationFrame(() => d.classList.remove('no-motion'));
  listeners.forEach((f) => f());
}

export const prefs = {
  get: () => state,
  setTheme(theme: Theme) {
    state = { ...state, theme };
    write(THEME_KEY, theme === 'dark' ? null : theme);
    apply();
  },
  setLang(lang: Lang) {
    state = { ...state, lang };
    write(LANG_KEY, lang === 'en' ? null : lang);
    apply();
  },
  setNotify(notify: boolean) {
    state = { ...state, notify };
    write(NOTIFY_KEY, notify ? '1' : null);
    listeners.forEach((f) => f());
  },
};

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export const usePrefs = () => useSyncExternalStore(subscribe, prefs.get);
