import { afterEach, describe, expect, it } from 'vitest';

import { embedKeyFromHash, requestApiKey, setRequestApiKey } from './apiKey';

const KEY = 'vt_Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78St90Uv1';

describe('embedded app key', () => {
  afterEach(() => setRequestApiKey(''));

  it('reads the key from an embed link', () => {
    expect(embedKeyFromHash(`#embed/${KEY}`)).toBe(KEY);
  });

  it.each(['', '#embed/', '#embed/abc', `#meet/${KEY}`, `#embed/${KEY}/extra`, '#embed/vt_short'])(
    'ignores %s',
    (hash) => {
      expect(embedKeyFromHash(hash)).toBeNull();
    },
  );

  it('remembers the key for requests', () => {
    expect(requestApiKey()).toBe('');
    setRequestApiKey(KEY);
    expect(requestApiKey()).toBe(KEY);
  });
});
