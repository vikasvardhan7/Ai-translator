const DEFAULT_BACKEND_URL = 'http://localhost:8000';

export function getBackendUrl(value: string | undefined = import.meta.env.VITE_BACKEND_URL): string {
  const url = value?.trim() || DEFAULT_BACKEND_URL;
  return url.replace(/\/+$/, '');
}
