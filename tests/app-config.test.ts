/**
 * Environment configuration is a trust boundary.
 *
 * Hosting dashboards store values verbatim, so a locale pasted with its quotes,
 * left blank or written with an underscore reaches `Intl.NumberFormat`, which
 * throws `RangeError: Incorrect locale information provided`. That failed a
 * Vercel build while prerendering `/access` (Sep 2026). The config layer must
 * fall back to the default instead of letting one bad value take the app down.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, readEnv, resolveLocale } from '@/shared/config/app-config';
import { formatMoney, money } from '@/shared/lib/money';

describe('app-config · readEnv', () => {
  it('treats unset and blank values as absent', () => {
    expect(readEnv(undefined)).toBeUndefined();
    expect(readEnv('')).toBeUndefined();
    expect(readEnv('   ')).toBeUndefined();
    expect(readEnv('""')).toBeUndefined();
  });

  it('strips the surrounding quotes and whitespace a dashboard keeps', () => {
    expect(readEnv('"en-AU"')).toBe('en-AU');
    expect(readEnv("'Holdfast'")).toBe('Holdfast');
    expect(readEnv('  en-AU ')).toBe('en-AU');
  });

  it('leaves an unquoted value alone', () => {
    expect(readEnv('en-AU')).toBe('en-AU');
    expect(readEnv('a "quoted" word')).toBe('a "quoted" word');
  });
});

describe('app-config · resolveLocale', () => {
  it.each(['', '   ', 'en_AU', 'not a locale', 'xx-ZZ'])(
    'falls back to the default for %j instead of throwing',
    (raw) => {
      expect(resolveLocale(raw)).toBe(DEFAULT_LOCALE);
    },
  );

  it('falls back to the default when unset', () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it('accepts a well-formed, supported tag', () => {
    expect(resolveLocale('en-AU')).toBe('en-AU');
    expect(resolveLocale('en-US')).toBe('en-US');
  });

  it('recovers a tag pasted with its quotes', () => {
    expect(resolveLocale('"en-AU"')).toBe('en-AU');
  });

  it('never yields a locale that makes formatMoney throw', () => {
    for (const raw of [undefined, '', 'en_AU', '"en-AU"', 'xx-ZZ', 'en-US']) {
      const locale = resolveLocale(raw);
      expect(() => formatMoney(money(186000, 'AUD'), { locale, showCents: true })).not.toThrow();
    }
  });
});
