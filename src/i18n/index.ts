import { type MessageKey, type Messages, en } from './locales/en.ts';
import { ru } from './locales/ru.ts';

export type { MessageKey, Messages };

/**
 * Translation. No framework, no build step: a locale is a plain object of
 * string keys, and adding one is two lines here plus a file next to `en.ts`.
 *
 * Lookup order is locale → English → the key itself. A missing translation
 * therefore degrades to English rather than to an empty label, which is the
 * only behaviour that makes partial contributions safe to merge.
 */

export const LOCALES = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'ru', label: 'Русский', short: 'RU' },
] as const;

export type Locale = (typeof LOCALES)[number]['id'];

const CATALOGUES: Record<Locale, Partial<Messages>> = { en, ru };

const STORAGE_KEY = 'pixel-peep:locale';

export function isLocale(value: string): value is Locale {
  return LOCALES.some((l) => l.id === value);
}

/** Browser preference, narrowed to what we actually ship. English otherwise. */
export function detectLocale(): Locale {
  const candidates = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? [navigator.language])];
  for (const tag of candidates) {
    const base = String(tag).toLowerCase().split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }
  return 'en';
}

function stored(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && isLocale(value) ? value : null;
  } catch {
    // Private mode, disabled storage — the choice simply is not remembered.
    return null;
  }
}

let current: Locale = stored() ?? detectLocale();
const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (current === locale) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not being able to remember it is not a reason to refuse to switch.
  }
  for (const listener of [...listeners]) listener(locale);
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Resolve a message. Unknown keys are returned verbatim, which is what makes
 * it safe to run every user-visible string through `t()` — including codec
 * labels like `JPEG` that need no translation.
 */
export function t(key: MessageKey | (string & {}), vars?: Readonly<Record<string, string | number>>): string {
  const catalogue = CATALOGUES[current];
  const template = catalogue[key as MessageKey] ?? en[key as MessageKey] ?? key;
  return vars ? interpolate(template, vars) : template;
}

function interpolate(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** Keys present in `en` but missing from a locale. Used by the i18n test. */
export function missingKeys(locale: Locale): MessageKey[] {
  const catalogue = CATALOGUES[locale];
  return (Object.keys(en) as MessageKey[]).filter((key) => catalogue[key] === undefined);
}

/** Keys a locale defines that `en` does not — always a typo. */
export function strayKeys(locale: Locale): string[] {
  return Object.keys(CATALOGUES[locale]).filter((key) => !(key in en));
}
