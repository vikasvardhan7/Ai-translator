import type { SocketStatus } from '../../services/sessionSocket';

interface StatusBarProps {
  socketStatus: SocketStatus;
  channelReady: boolean;
  issue: string | null;
  closeCode: number | null;
  onReconnect: () => void;
  onEnd: () => void;
  onNewSession: () => void;
}

export default function StatusBar({
  socketStatus,
  channelReady,
  issue,
  closeCode,
  onReconnect,
  onEnd,
  onNewSession,
}: StatusBarProps) {
  const isLost = socketStatus === 'closed' || socketStatus === 'error';
  const liveText = isLost
    ? 'Connection lost'
    : channelReady
      ? 'Live channel open'
      : socketStatus === 'connecting'
        ? 'Connecting to live channel'
        : 'Opening live channel';
  const liveTone = isLost ? 'status-danger' : channelReady ? 'status-success' : 'status-pending';

  return (
    <section className="status-bar" aria-label="Connection status" aria-live="polite" aria-atomic="true">
      <div className="status-list">
        <p className="status-item status-success">
          <span className="status-dot" aria-hidden="true" />
          <span>Backend connected</span>
        </p>
        <p
          className={`status-item live-status-indicator ${liveTone}`}
          data-state={isLost ? 'lost' : channelReady ? 'live' : 'pending'}
        >
          <span className="status-dot" aria-hidden="true" />
          <span>{liveText}</span>
        </p>
      </div>
      <div className="status-actions">
        {isLost && closeCode !== 4404 && (
          <button className="button button-secondary button-small button-reconnect" type="button" onClick={onReconnect}>
            Reconnect
          </button>
        )}
        {closeCode === 4404 && (
          <button className="button button-secondary button-small" type="button" onClick={onNewSession}>
            Start a new one
          </button>
        )}
        <button className="button button-secondary button-small" type="button" onClick={onEnd}>
          End
        </button>
      </div>
      {issue && (
        <div className="status-issue" role="alert">
          <p>{issue}</p>
          {closeCode === 4404 && <p>This session has ended. Start a new one.</p>}
        </div>
      )}
    </section>
  );
}
