export type OrbState = 'connecting' | 'listening' | 'speaking' | 'stopped';

interface ListeningOrbProps {
  state: OrbState;
  level: number;
  speakingTo: string | null;
}

function caption(state: OrbState, speakingTo: string | null): string {
  switch (state) {
    case 'connecting':
      return 'Getting ready';
    case 'listening':
      return 'Listening';
    case 'speaking':
      return speakingTo ? `Speaking to ${speakingTo}` : 'Speaking';
    default:
      return 'Not listening';
  }
}

export default function ListeningOrb({ state, level, speakingTo }: ListeningOrbProps) {
  const value = Math.round(Math.max(0, Math.min(1, level)) * 100);
  const scale = state === 'listening' ? 1 + value / 250 : 1;

  return (
    <div className="listening" data-state={state}>
      <div
        className="listening-orb"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state === 'listening' ? value : 0}
        style={{ transform: `scale(${scale})` }}
      >
        <span className="listening-ring" aria-hidden="true" />
        <span className="listening-ring listening-ring-late" aria-hidden="true" />
      </div>
      <p className="listening-caption" aria-live="polite">
        {caption(state, speakingTo)}
      </p>
    </div>
  );
}
