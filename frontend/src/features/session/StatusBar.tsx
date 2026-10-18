export type SessionPhase = 'connecting' | 'live' | 'ending' | 'closed';

interface StatusBarProps {
  phase: SessionPhase;
  issue: string | null;
  restarting: boolean;
  onEnd: () => void;
  onRestart: () => void;
  onLeave: () => void;
}

const LABELS: Record<SessionPhase, string> = {
  connecting: 'Connecting',
  live: 'Live',
  ending: 'Finishing the last sentences',
  closed: 'Connection lost',
};

const TONES: Record<SessionPhase, string> = {
  connecting: 'status-pending',
  live: 'status-success',
  ending: 'status-pending',
  closed: 'status-danger',
};

export default function StatusBar({ phase, issue, restarting, onEnd, onRestart, onLeave }: StatusBarProps) {
  return (
    <section className="status-bar" aria-label="Conversation status">
      <p className={`status-item live-status-indicator ${TONES[phase]}`} data-state={phase} aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span>{LABELS[phase]}</span>
      </p>
      <div className="status-actions">
        {phase === 'closed' && (
          <button
            className="button button-primary button-small"
            type="button"
            onClick={onRestart}
            disabled={restarting}
            aria-busy={restarting}
          >
            {restarting ? 'Starting again' : 'Start again'}
          </button>
        )}
        {phase === 'ending' || phase === 'closed' ? (
          <button className="button button-secondary button-small" type="button" onClick={onLeave}>
            Leave
          </button>
        ) : (
          <button className="button button-danger button-small" type="button" onClick={onEnd}>
            End
          </button>
        )}
      </div>
      {issue && (
        <p className="status-issue" role="alert">
          {issue}
        </p>
      )}
    </section>
  );
}
