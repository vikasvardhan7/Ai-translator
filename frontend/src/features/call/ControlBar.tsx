import Icon from './icons';

interface ControlBarProps {
  muted: boolean;
  micReady: boolean;
  level: number;
  voiceOn: boolean;
  settingsOpen: boolean;
  transcriptOpen: boolean;
  ended: boolean;
  onMute: () => void;
  onVoice: () => void;
  onSettings: () => void;
  onTranscript: () => void;
  onEnd: () => void;
}

export default function ControlBar({
  muted,
  micReady,
  level,
  voiceOn,
  settingsOpen,
  transcriptOpen,
  ended,
  onMute,
  onVoice,
  onSettings,
  onTranscript,
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
      <button className="control" type="button" data-off={!voiceOn} aria-pressed={!voiceOn} onClick={onVoice} disabled={ended}>
        <Icon name={voiceOn ? 'voice' : 'voice-off'} />
        <span>Captions only</span>
      </button>
      <button className="control" type="button" aria-expanded={settingsOpen} aria-controls="call-settings" onClick={onSettings}>
        <Icon name="settings" />
        <span>Settings</span>
      </button>
      <button className="control" type="button" aria-expanded={transcriptOpen} aria-controls="call-transcript" onClick={onTranscript}>
        <Icon name="transcript" />
        <span>Transcript</span>
      </button>
      <button className="control control-end" type="button" onClick={onEnd}>
        <Icon name="end" />
        <span>{ended ? 'Leave' : 'End'}</span>
      </button>
    </nav>
  );
}
