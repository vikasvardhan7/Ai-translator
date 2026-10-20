import Icon from './icons';

interface MeetingControl {
  connected: boolean;
  busy: boolean;
}

interface PeopleControl {
  count: number;
  open: boolean;
}

interface ControlBarProps {
  people: PeopleControl | null;
  meeting: MeetingControl | null;
  muted: boolean;
  micReady: boolean;
  level: number;
  voiceOn: boolean;
  settingsOpen: boolean;
  transcriptOpen: boolean;
  ended: boolean;
  onMute: () => void;
  onMeeting: () => void;
  onVoice: () => void;
  onSettings: () => void;
  onPeople: () => void;
  onTranscript: () => void;
  onAsk?: () => void;
  onEnd: () => void;
}

export default function ControlBar({
  people,
  meeting,
  muted,
  micReady,
  level,
  voiceOn,
  settingsOpen,
  transcriptOpen,
  ended,
  onMute,
  onMeeting,
  onVoice,
  onSettings,
  onPeople,
  onTranscript,
  onAsk,
  onEnd,
}: ControlBarProps) {
  const glow = muted || !micReady ? 0 : Math.min(1, level * 1.6);
  return (
    <nav className="control-bar" aria-label="Call controls">
      <button
        className="control"
        type="button"
        data-off={muted}
        aria-pressed={muted}
        disabled={ended || !micReady}
        onClick={onMute}
        style={{ ['--level' as string]: glow }}
      >
        <Icon name={muted ? 'mic-off' : 'mic'} />
        <span>Mute</span>
      </button>
      {meeting ? (
        <button
          className="control"
          type="button"
          data-off={!meeting.connected}
          aria-pressed={meeting.connected}
          aria-busy={meeting.busy}
          onClick={onMeeting}
          disabled={ended || meeting.busy}
        >
          <Icon name="meeting" />
          <span>Meeting sound</span>
        </button>
      ) : (
        <button className="control" type="button" data-off={!voiceOn} aria-pressed={!voiceOn} onClick={onVoice} disabled={ended}>
          <Icon name={voiceOn ? 'voice' : 'voice-off'} />
          <span>Captions only</span>
        </button>
      )}
      {people && (
        <button className="control" type="button" aria-expanded={people.open} aria-controls="call-people" onClick={onPeople}>
          <Icon name="people" />
          <span className="control-count" aria-hidden="true">{people.count}</span>
          <span>People</span>
        </button>
      )}
      <button className="control" type="button" aria-expanded={settingsOpen} aria-controls="call-settings" onClick={onSettings}>
        <Icon name="settings" />
        <span>Settings</span>
      </button>
      <button className="control" type="button" aria-expanded={transcriptOpen} aria-controls="call-transcript" onClick={onTranscript}>
        <Icon name="transcript" />
        <span>Transcript</span>
      </button>
      {onAsk && (
        <button className="control" type="button" onClick={onAsk}>
          <Icon name="assistant" />
          <span>Ask</span>
        </button>
      )}
      <button className="control control-end" type="button" onClick={onEnd}>
        <Icon name="end" />
        <span>{ended ? 'Leave' : 'End'}</span>
      </button>
    </nav>
  );
}
