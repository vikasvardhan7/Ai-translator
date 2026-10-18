import { describe, expect, it } from 'vitest';

import { getBackendUrl } from './config';

describe('getBackendUrl', () => {
  it('uses the local default when nothing is set', () => {
    expect(getBackendUrl('')).toBe('http://localhost:8000');
  });

  it('uses the configured address', () => {
    expect(getBackendUrl('http://192.168.1.20:8000')).toBe('http://192.168.1.20:8000');
  });

  it('removes trailing slashes', () => {
    expect(getBackendUrl('http://localhost:8000//')).toBe('http://localhost:8000');
  });
});
