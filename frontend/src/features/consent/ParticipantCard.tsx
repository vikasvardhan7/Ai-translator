import type { Participant } from '../../services/protocol';
import type { LanguageOption } from './languageOptions';
import LanguageSelect from './LanguageSelect';

interface ParticipantCardProps {
  participant: Participant;
  languages: LanguageOption[];
  languagesLoading: boolean;
  languagesFailed: boolean;
  onChange: (participant: Participant) => void;
}

export default function ParticipantCard({
  participant,
  languages,
  languagesLoading,
  languagesFailed,
  onChange,
}: ParticipantCardProps) {
  const nameId = `participant-${participant.id.toLowerCase()}-name`;
  const personLabel = participant.id === 'A' ? 'Person 1' : 'Person 2';

  return (
    <section className="participant-card" aria-labelledby={`${nameId}-heading`}>
      <div className="participant-heading">
        <span className="participant-marker" aria-hidden="true">{participant.id}</span>
        <h3 id={`${nameId}-heading`}>{personLabel}</h3>
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor={nameId}>Name</label>
        <input
          className="text-input"
          id={nameId}
          name={`participant-${participant.id.toLowerCase()}-name`}
          type="text"
          minLength={1}
          maxLength={40}
          required
          value={participant.name}
          onChange={(event) => onChange({ ...participant, name: event.currentTarget.value })}
        />
      </div>
      <div className="field-group">
        {languagesLoading ? (
          <div className="language-picker-loading">
            <span className="field-label">Preferred language</span>
            <div className="language-picker-skeleton" aria-hidden="true" />
          </div>
        ) : languagesFailed ? (
          <div className="language-picker-loading">
            <span className="field-label">Preferred language</span>
            <p className="language-empty-state">Language options are unavailable.</p>
          </div>
        ) : (
          <LanguageSelect
            label="Preferred language"
            value={participant.preferred_language}
            languages={languages}
            onChange={(languageCode) => onChange({ ...participant, preferred_language: languageCode })}
          />
        )}
      </div>
    </section>
  );
}
