import { useEffect, useRef, useState } from 'react';

import { getVoices, type RoomAccess, type VoiceOption } from '../../services/api';
import { languageLabel, languageName } from '../../services/languageNames';
import type { Participant, SpeakerId } from '../../services/protocol';
import LanguageSelect from '../consent/LanguageSelect';
import { loadLanguageOptions, type LanguageOption } from '../consent/languageOptions';
import { browserVoicesFor, type BrowserVoice } from '../session/voicePlayer';
import { usePanelFocus } from './usePanelFocus';

type VoiceMode = 'natural' | 'fast';

export interface ListenerSettings {
  mode: VoiceMode;
  naturalVoice: string | null;
  browserVoice: string | null;
  rate: number;
}

interface SettingsPanelProps {
  open: boolean;
  people: Participant[];
  you: SpeakerId | null;
  settings: Record<SpeakerId, ListenerSettings>;
  naturalAvailable: boolean;
  voiceShown: boolean;
  room: RoomAccess | null;
  liveWords: { available: boolean; on: boolean; problem: string | null; onChange: (on: boolean) => void };
  onChange: (id: SpeakerId, settings: ListenerSettings) => void;
  onLanguage: (id: SpeakerId, language: string) => void;
  onClose: () => void;
}

function voiceLabel(voice: VoiceOption): string {
  const details = [voice.gender, voice.description].filter(Boolean).join(', ');
  return details ? `${voice.display_name}: ${details}` : voice.display_name;
}

function PersonSettings({
  person,
  you,
  settings,
  naturalAvailable,
  naturalVoices,
  voiceShown,
  languages,
  onChange,
  onLanguage,
}: {
  person: Participant;
  you: SpeakerId | null;
  settings: ListenerSettings;
  naturalAvailable: boolean;
  naturalVoices: VoiceOption[] | null;
  voiceShown: boolean;
  languages: LanguageOption[];
  onChange: (settings: ListenerSettings) => void;
  onLanguage: (language: string) => void;
}) {
  const [browserVoices, setBrowserVoices] = useState<BrowserVoice[] | null>(null);
  const name = person.id === you ? 'You' : person.name;

  useEffect(() => {
    let cancelled = false;
    setBrowserVoices(null);
    void browserVoicesFor(person.preferred_language).then((voices) => {
      if (!cancelled) {
        setBrowserVoices(voices);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [person.preferred_language]);

  function chooseLanguage(code: string): void {
    if (code && code !== person.preferred_language) {
      onLanguage(code);
    }
  }

  return (
    <section className="settings-person" aria-label={`Settings for ${name}`}>
      <h3>{name}</h3>
      <p className="settings-hint">
        {voiceShown ? 'Hears translations in' : 'Captions in'} {languageLabel(person.preferred_language)}
      </p>
      {languages.length > 0 ? (
        <LanguageSelect label="Language" value={person.preferred_language} languages={languages} onChange={chooseLanguage} />
      ) : (
        <p className="settings-hint">Loading languages</p>
      )}

      {voiceShown && (
        <>
          <fieldset className="settings-voice">
            <legend>Voice</legend>
            <label className="settings-choice">
              <input
                type="radio"
                name={`mode-${person.id}`}
                checked={settings.mode === 'natural'}
                disabled={!naturalAvailable}
                onChange={() => onChange({ ...settings, mode: 'natural' })}
              />
              <span>
                <strong>Natural</strong>
                <small>{naturalAvailable ? 'Gemini voice, smooth and clear, about 2 s slower' : 'Not set up on this server'}</small>
              </span>
            </label>
            <label className="settings-choice">
              <input
                type="radio"
                name={`mode-${person.id}`}
                checked={settings.mode === 'fast'}
                onChange={() => onChange({ ...settings, mode: 'fast' })}
              />
              <span>
                <strong>Fast</strong>
                <small>This browser's own voice, instant</small>
              </span>
            </label>
          </fieldset>

          {settings.mode === 'natural' ? (
            <label className="field-label settings-field">
              Natural voice
              <select
                className="text-input"
                value={settings.naturalVoice ?? ''}
                onChange={(event) => onChange({ ...settings, naturalVoice: event.currentTarget.value || null })}
              >
                <option value="">Automatic</option>
                {(naturalVoices ?? []).map((voice) => (
                  <option value={voice.id} key={voice.id}>{voiceLabel(voice)}</option>
                ))}
              </select>
              {naturalVoices === null && <small className="settings-hint">Loading voices</small>}
            </label>
          ) : (
            <label className="field-label settings-field">
              Browser voice
              <select
                className="text-input"
                value={settings.browserVoice ?? ''}
                disabled={!browserVoices?.length}
                onChange={(event) => onChange({ ...settings, browserVoice: event.currentTarget.value || null })}
              >
                <option value="">Automatic</option>
                {(browserVoices ?? []).map((voice) => (
                  <option value={voice.id} key={voice.id}>{voice.name}</option>
                ))}
              </select>
              {browserVoices !== null && browserVoices.length === 0 && (
                <small className="settings-error">
                  This browser has no {languageName(person.preferred_language)} voice. Use Natural, or try Edge.
                </small>
              )}
            </label>
          )}

          <label className="field-label settings-field">
            Speed: {settings.rate.toFixed(2).replace(/0$/, '')}x
            <input
              className="settings-range"
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={settings.rate}
              onChange={(event) => onChange({ ...settings, rate: Number(event.currentTarget.value) })}
            />
          </label>
        </>
      )}
    </section>
  );
}

export default function SettingsPanel({
  open,
  people,
  you,
  settings,
  naturalAvailable,
  voiceShown,
  room,
  liveWords,
  onChange,
  onLanguage,
  onClose,
}: SettingsPanelProps) {
  const [naturalVoices, setNaturalVoices] = useState<VoiceOption[] | null>(null);
  const [voicesIssue, setVoicesIssue] = useState('');
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const voicesAskedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  usePanelFocus(open, onClose, panelRef);

  useEffect(() => {
    if (!open || !naturalAvailable || !voiceShown || voicesAskedRef.current) {
      return;
    }
    voicesAskedRef.current = true;
    getVoices(room ?? undefined).then(setNaturalVoices, (error: unknown) => {
      setNaturalVoices([]);
      setVoicesIssue(error instanceof Error ? error.message : 'The voice list could not be loaded.');
    });
  }, [naturalAvailable, open, room, voiceShown]);

  useEffect(() => {
    if (!open || languages.length > 0) {
      return;
    }
    loadLanguageOptions().then(setLanguages, () => undefined);
  }, [languages.length, open]);

  return (
    <div
      className="settings-panel"
      id="call-settings"
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label="Settings"
      hidden={!open}
    >
      <header className="settings-header">
        <h2>Settings</h2>
        <button className="button button-small button-secondary" type="button" onClick={onClose}>
          Done
        </button>
      </header>
      {voicesIssue && <p className="settings-error" role="status">{voicesIssue}</p>}
      <section className="settings-person settings-live-words" aria-label="Words while speaking">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={liveWords.available && liveWords.on}
            disabled={!liveWords.available}
            onChange={(event) => liveWords.onChange(event.currentTarget.checked)}
          />
          <span>Show words while they are spoken</span>
        </label>
        <p className="settings-hint">
          {liveWords.available
            ? "Uses this browser's own speech recognition, which sends what the microphone hears to the browser's maker (Microsoft for Edge, Google for Chrome). The final caption still comes from Gemini."
            : 'This browser cannot show words while they are spoken. Captions still appear after each sentence.'}
        </p>
        {liveWords.problem && <p className="settings-error" role="status">{liveWords.problem}</p>}
      </section>
      {people.map((person) => (
        <PersonSettings
          key={person.id}
          person={person}
          you={you}
          settings={settings[person.id]}
          naturalAvailable={naturalAvailable}
          naturalVoices={naturalAvailable ? naturalVoices : []}
          voiceShown={voiceShown}
          languages={languages}
          onChange={(next) => onChange(person.id, next)}
          onLanguage={(language) => onLanguage(person.id, language)}
        />
      ))}
    </div>
  );
}
