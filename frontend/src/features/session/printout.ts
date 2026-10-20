import type { TranscriptEntry } from './transcript';

const REMOVE_AFTER_MS = 300_000;

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function transcriptPage(title: string, subtitle: string, entries: readonly TranscriptEntry[]): string {
  const items = entries.map((entry) => `<section>
<p class="who"><strong>${escape(entry.speaker)}</strong> <span>${escape(entry.time)} · ${escape(entry.languageName)}</span></p>
<p dir="auto">${escape(entry.text)}</p>
${entry.heard.map((line) => `<p class="heard" dir="auto"><span>${escape(line.who)} (${escape(line.languageName)}):</span> <em>${escape(line.text)}</em></p>`).join('\n')}
</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(title)}</title>
<style>
@page { margin: 16mm; }
body { margin: 0; color: #10202e; font: 11pt/1.5 'Segoe UI', 'Nirmala UI', 'Noto Sans', system-ui, sans-serif; }
h1 { margin: 0 0 4px; color: #14659f; font-size: 20pt; }
.sub { margin: 0 0 18px; color: #5b6b7a; }
section { margin: 0 0 12px; break-inside: avoid; }
p { margin: 0 0 3px; }
.who span, .heard span { color: #5b6b7a; }
.heard { margin-left: 14px; }
</style>
</head>
<body>
<h1>${escape(title)}</h1>
<p class="sub">${escape(subtitle)}</p>
${items}
</body>
</html>`;
}

export function printPage(html: string): void {
  const frame = document.createElement('iframe');
  frame.title = 'Transcript to print';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  const remove = (): void => frame.remove();
  frame.addEventListener('load', () => {
    const view = frame.contentWindow;
    if (!view) {
      remove();
      return;
    }
    view.addEventListener('afterprint', () => window.setTimeout(remove, 1_000));
    window.setTimeout(remove, REMOVE_AFTER_MS);
    view.focus();
    view.print();
  }, { once: true });
  frame.srcdoc = html;
  document.body.append(frame);
}
