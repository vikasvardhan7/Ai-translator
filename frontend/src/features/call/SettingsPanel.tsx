import { useEffect, useRef, useState } from 'react';

import { getVoices, type VoiceOption } from '../../services/api';
import { languageLabel, languageName } from '../../services/languageNames';
import type { Participant, SpeakerId } from '../../services/protocol';
import LanguageSelect from '../consent/LanguageSelect';
import { loadLanguageOptions, type LanguageOption } from '../consent/languageOptions';
import { browserVoicesFor, type BrowserVoice } from '../session/voicePlayer';
import { usePanelFocus } from './usePanelFocus';

export type VoiceMode = 'natural' | 'fast';

export interface ListenerSettings {
  mode: VoiceMode;
  naturalVoice: string | null;
  browserVoice: string | null;
  rate: number;
}

interface SettingsPanelProps {
  open: boolean;
  people: Participant[];
  others: Participant[];
  you: SpeakerId | null;
  settings: Record<SpeakerId, ListenerSettings>;
  naturalAvailable: boolean;
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
  others,
  you,
  settings,
  naturalAvailable,
  naturalVoices,
  languages,
  onChange,
  onLanguage,
}: {
  person: Participant;
  others: Participant[];
  you: SpeakerId | null;
  settings: ListenerSettings;
  naturalAvailable: boolean;
  naturalVoices: VoiceOption[] | null;
  languages: LanguageOption[];
  onChange: (settings: ListenerSettings) => void;
  onLanguage: (language: string) => void;
}) {
  const [browserVoices, setBrowserVoices] = useState<BrowserVoice[] | null>(null);
  const [languageIssue, setLanguageIssue] = useState('');
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
    if (others.some((other) => other.preferred_language === code)) {
      setLanguageIssue(`${languageName(code)} is the other person's language. Pick a different one.`);
      return;
    }
    setLanguageIssue('');
    if (code && code !== person.preferred_language) {
      onLanguage(code);
    }
  }

  return (
    <section className="settings-person" aria-label={`Settings for ${name}`}>
      <h3>{name}</h3>
      <p className="settings-hint">Hears translations in {languageLabel(person.preferred_language)}</p>
      {languages.length > 0 ? (
        <LanguageSelect label="Language" value={person.preferred_language} languages={languages} onChange={chooseLanguage} />
      ) : (
        <p className="settings-hint">Loading languages</p>
      )}
      {languageIssue && <p className="settings-error" role="alert">{languageIssue}</p>}

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
    </section>
  );
}

export default function SettingsPanel({
  open,
  people,
  others,
  you,
  settings,
  naturalAvailable,
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
    if (!open || !naturalAvailable || voicesAskedRef.current) {
      return;
    }
    voicesAskedRef.current = true;
    getVoices().then(setNaturalVoices, (error: unknown) => {
      setNaturalVoices([]);
      setVoicesIssue(error instanceof Error ? error.message : 'The voice list could not be loaded.');
    });
  }, [naturalAvailable, open]);

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
      {people.map((person) => (
        <PersonSettings
          key={person.id}
          person={person}
          others={[...others, ...people].filter((other) => other.id !== person.id)}
          you={you}
          settings={settings[person.id]}
          naturalAvailable={naturalAvailable}
          naturalVoices={naturalAvailable ? naturalVoices : []}
          languages={languages}
          onChange={(next) => onChange(person.id, next)}
          onLanguage={(language) => onLanguage(person.id, language)}
        />
      ))}
    </div>
  );
}
