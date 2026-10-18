const DEFAULT_BACKEND_URL = 'http://localhost:8000';

export function getBackendUrl(
  value: string | undefined = import.meta.env.VITE_BACKEND_URL,
  pageOrigin: string | undefined = import.meta.env.PROD ? globalThis.location?.origin : undefined,
): string {
  const url = value?.trim() || pageOrigin || DEFAULT_BACKEND_URL;
  return url.replace(/\/+$/, '');
}
