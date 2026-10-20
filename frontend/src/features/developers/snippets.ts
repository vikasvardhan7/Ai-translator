export const KEY_PLACEHOLDER = 'YOUR_API_KEY';

export function widgetSnippet(base: string, key: string = KEY_PLACEHOLDER): string {
  return `<script src="${base}/widget.js" data-key="${key}" async></script>`;
}

export function sessionSnippet(base: string, key: string = KEY_PLACEHOLDER): string {
  return [
    `curl -X POST ${base}/api/sessions \\`,
    `  -H "X-Api-Key: ${key}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '{"consent": true, "participants": [{"id": "A", "name": "Person 1", "preferred_language": "te"}, {"id": "B", "name": "Person 2", "preferred_language": "en"}]}'`,
  ].join('\n');
}

export function streamAddress(base: string): string {
  return `${base.replace(/^http/, 'ws')}/api/sessions/SESSION_ID/stream`;
}

export function usedShare(used: number, limit: number): number {
  if (limit <= 0) {
    return 100;
  }
  return Math.min(100, Math.round((used / limit) * 100));
}
