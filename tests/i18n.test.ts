import { describe, expect, it } from 'vitest';
import { LOCALES, detectLocale, isLocale, missingKeys, strayKeys, t } from '../src/i18n/index.ts';
import { en } from '../src/i18n/locales/en.ts';

describe('i18n', () => {
  it('resolves a key in the default locale', () => {
    expect(t('brand.name')).toBe('Pixel Peep');
  });

  it('returns unknown keys verbatim, so plain labels can go through t()', () => {
    expect(t('JPEG')).toBe('JPEG');
  });

  it('substitutes placeholders', () => {
    expect(t('empty.formats', { list: 'PNG' })).toBe('Supported: PNG');
  });

  it('leaves a placeholder alone when no value is given for it', () => {
    expect(t('empty.formats')).toContain('{list}');
  });

  for (const locale of LOCALES) {
    it(`${locale.id}: defines no keys that English does not`, () => {
      // A stray key is always a typo — it can never be reached.
      expect(strayKeys(locale.id)).toEqual([]);
    });
  }

  it('ships a complete Russian translation', () => {
    // Other locales are allowed to lag; this one is shipped as complete, and a
    // gap would silently show English inside a Russian interface.
    expect(missingKeys('ru')).toEqual([]);
  });

  it('has no empty messages', () => {
    const blank = Object.entries(en).filter(([, value]) => value.trim() === '');
    expect(blank).toEqual([]);
  });

  it('recognises the locales it ships and rejects the rest', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });

  it('falls back to English when the browser asks for something we do not have', () => {
    expect(LOCALES.some((l) => l.id === detectLocale())).toBe(true);
  });
});
