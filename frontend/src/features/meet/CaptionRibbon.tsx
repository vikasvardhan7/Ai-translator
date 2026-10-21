import type { CaptionLine } from './captions';

export interface PendingLine {
  key: string;
  name: string;
  text: string;
  language: string;
}

interface CaptionRibbonProps {
  lines: CaptionLine[];
  pending: PendingLine[];
  nameOf: (line: CaptionLine) => string;
  emptyText: string;
}

export default function CaptionRibbon({ lines, pending, nameOf, emptyText }: CaptionRibbonProps) {
  const quiet = lines.length === 0 && pending.length === 0;
  return (
    <section className="meet-captions" aria-label="Live captions" data-quiet={quiet}>
      <div className="meet-captions-list" aria-live="polite">
        {quiet && <p className="meet-captions-empty">{emptyText}</p>}
        {lines.map((line) => (
          <p className="meet-caption" key={line.id} data-waiting={line.waiting}>
            <span className="meet-caption-who" dir="auto">{nameOf(line)}</span>
            <span className="meet-caption-text" dir="auto">{line.text}</span>
            {line.translated && line.spokenIn && <span className="meet-caption-from">from {line.spokenIn}</span>}
          </p>
        ))}
      </div>
      {pending.map((line) => (
        <p className="meet-caption meet-caption-live" key={line.key} aria-hidden="true">
          <span className="meet-caption-who" dir="auto">{line.name}</span>
          {line.text ? (
            <span className="meet-caption-text" dir="auto">{line.text}</span>
          ) : (
            <span className="meet-caption-text meet-caption-dots">
              {line.language ? `speaking ${line.language}` : 'speaking'}
              <span className="meet-dots"><i /><i /><i /></span>
            </span>
          )}
        </p>
      ))}
    </section>
  );
}
