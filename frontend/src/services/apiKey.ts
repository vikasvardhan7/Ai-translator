const EMBED_HASH = /^#embed\/(vt_[A-Za-z0-9_-]{20,200})$/;

let current = '';

export function embedKeyFromHash(hash: string): string | null {
  const match = EMBED_HASH.exec(hash);
  return match ? match[1]! : null;
}

export function setRequestApiKey(key: string): void {
  current = key;
}

export function requestApiKey(): string {
  return current;
}
