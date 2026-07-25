import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import en from './locales/en.json';
import zh from './locales/zh.json';
import languages from './locales/languages.json';

// Lightweight i18n to mirror Councils's vue-i18n usage. Locale JSON is shared
// verbatim with the original project so screen text stays identical.
type Messages = Record<string, unknown>;

const messages: Record<string, Messages> = { en, zh };

export const availableLocales = Object.entries(languages)
  .filter(([key]) => messages[key])
  .map(([key, value]) => ({ key, label: (value as { label: string }).label }));

function resolve(obj: Messages, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, obj);
  return typeof value === 'string' ? value : undefined;
}

type Params = Record<string, string | number>;

type I18nContextValue = {
  locale: string;
  setLocale: (locale: string) => void;
  /** Translate a key with optional `{param}` interpolation. */
  t: (key: string, params?: Params) => string;
  /**
   * Translate a key whose `{slots}` should be replaced with React nodes,
   * e.g. the styled hero description. Returns an array of strings/nodes.
   */
  tNodes: (key: string, slots: Record<string, ReactNode>) => ReactNode[];
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'locale';
const DEFAULT_LOCALE = 'en';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return saved && messages[saved] ? saved : DEFAULT_LOCALE;
  });

  const setLocale = useCallback((next: string) => {
    if (!messages[next]) return;
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
  }, []);

  const t = useCallback(
    (key: string, params?: Params) => {
      const raw = resolve(messages[locale], key) ?? resolve(messages[DEFAULT_LOCALE], key) ?? key;
      if (!params) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
    },
    [locale],
  );

  const tNodes = useCallback(
    (key: string, slots: Record<string, ReactNode>) => {
      const raw = resolve(messages[locale], key) ?? resolve(messages[DEFAULT_LOCALE], key) ?? key;
      const parts: ReactNode[] = [];
      const regex = /\{(\w+)\}/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let i = 0;
      while ((match = regex.exec(raw)) !== null) {
        if (match.index > lastIndex) parts.push(raw.slice(lastIndex, match.index));
        const slot = slots[match[1]];
        parts.push(slot !== undefined ? <span key={`slot-${i++}`}>{slot}</span> : match[0]);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < raw.length) parts.push(raw.slice(lastIndex));
      return parts;
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t, tNodes }), [locale, setLocale, t, tNodes]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
