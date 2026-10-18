import { describe, expect, it } from 'vitest';

import { loadLanguageOptions } from './languageOptions';

describe('browser language options', () => {
  it('discovers English and native language names from Intl data', async () => {
    const languages = await loadLanguageOptions();

    expect(languages.find((language) => language.code === 'en')).toMatchObject({
      englishName: 'English',
      nativeName: 'English',
    });
    expect(languages.find((language) => language.code === 'te')).toMatchObject({
      englishName: 'Telugu',
      nativeName: 'తెలుగు',
    });
    expect(languages.find((language) => language.code === 'yue')).toMatchObject({
      englishName: 'Cantonese',
    });
  });

  it('does not return unrecognized code strings as language names', async () => {
    const languages = await loadLanguageOptions();

    expect(languages.some((language) => language.code === 'zz')).toBe(false);
    expect(languages.some((language) => language.code === 'aaa')).toBe(false);
  });
});
