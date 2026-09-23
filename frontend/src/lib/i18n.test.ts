import { describe, expect, it } from 'vitest'
import { ALL_KEYS, DICTIONARIES, t } from './i18n'
import type { Lang } from './types'

const OTHER_LANGS: Lang[] = ['hi', 'mr', 'ta']

describe('t()', () => {
  it('fills placeholders from vars', () => {
    expect(t('en', 'notif.newCount', { n: 3 })).toBe('3 new alert(s)')
  })

  it('leaves an unmatched placeholder untouched rather than dropping it', () => {
    expect(t('en', 'notif.aria', {})).toBe('Notifications, {n} unread')
  })

  it('falls back to English when a language is missing a key entirely', () => {
    // hi/mr/ta always carry every English key (checked below), but the
    // fallback chain itself — lang -> en -> the raw key — must still work.
    expect(t('hi' as Lang, '__no_such_key__')).toBe('__no_such_key__')
  })

  it('returns the raw key when nothing defines it, so a missing translation is visible rather than blank', () => {
    expect(t('en', '__totally_unknown__')).toBe('__totally_unknown__')
  })
})

describe('translation parity', () => {
  it.each(OTHER_LANGS)('%s defines every English key', (lang) => {
    const missing = ALL_KEYS.filter((k) => !(k in DICTIONARIES[lang]))
    expect(missing).toEqual([])
  })

  it.each(OTHER_LANGS)('%s defines no keys English does not have (no orphans to drift silently)', (lang) => {
    const extra = Object.keys(DICTIONARIES[lang]).filter((k) => !ALL_KEYS.includes(k))
    expect(extra).toEqual([])
  })

  it.each(OTHER_LANGS)('%s actually translates every key (no key left equal to the English string)', (lang) => {
    // A handful of keys are legitimately identical across languages (e.g. a
    // brand name or a bare number format); everything else should differ.
    const IDENTICAL_OK = new Set(['appName', 'explore.what.osm'])  // 'OpenStreetMap' is a proper noun, correctly identical everywhere
    const untranslated = ALL_KEYS.filter(
      (k) => !IDENTICAL_OK.has(k) && DICTIONARIES[lang][k] === DICTIONARIES.en[k] && /[a-zA-Z]{3,}/.test(DICTIONARIES.en[k]),
    )
    expect(untranslated).toEqual([])
  })
})
