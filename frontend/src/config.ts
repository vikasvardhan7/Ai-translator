const DEFAULT_BACKEND_URL = 'http://localhost:8000';

/**
 * Returns the backend address from VITE_BACKEND_URL, or the local default.
 * A trailing slash is removed so paths can be appended safely.
 */
export function getBackendUrl(value: string | undefined = import.meta.env.VITE_BACKEND_URL): string {
  const url = value?.trim() || DEFAULT_BACKEND_URL;
  return url.replace(/\/+$/, '');
}
