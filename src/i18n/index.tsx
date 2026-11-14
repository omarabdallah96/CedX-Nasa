// Language of the website: which wording is in use, and how it is chosen.
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { ar } from './ar.tsx';
import { en, type Lang, type Strings } from './en.tsx';

const STRINGS: Record<Lang, Strings> = { en, ar };
const STORAGE_KEY = 'firesight.lang';

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ar';

/** A `?lang=` in the address wins, then the visitor's last choice, then the browser's language. */
function initialLang(): Lang {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Storage is blocked: fall through to the browser's language.
  }
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

interface I18n {
  /** The wording in use. */
  t: Strings;
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const Context = createContext<I18n>({ t: en, lang: 'en', setLang: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const t = STRINGS[lang];

  // Before paint, so the page never shows one language laid out for the other.
  useLayoutEffect(() => {
    document.documentElement.lang = t.lang;
    document.documentElement.dir = t.dir;
  }, [t]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
    // Keep a shared link's `?lang=` in step with what is on screen.
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', next);
      history.replaceState(null, '', url);
    }
  }, []);

  const value = useMemo(() => ({ t, lang, setLang }), [t, lang, setLang]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  return useContext(Context);
}

/** Switches to the other language; labelled in that language so its readers can find it. */
export function LangSwitch() {
  const { t, setLang } = useI18n();
  return (
    <button type="button" className="lang-switch" lang={t.switchTo.lang} aria-label={t.switchTo.aria} onClick={() => setLang(t.switchTo.lang)}>
      {t.switchTo.label}
    </button>
  );
}
