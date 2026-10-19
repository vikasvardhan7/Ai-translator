import { THEME_LIST, type ThemeId } from './themes';

interface PersonalizeAppProps {
  theme: ThemeId;
  calm: boolean;
  onTheme: (theme: ThemeId) => void;
  onCalm: (calm: boolean) => void;
}

export default function PersonalizeApp({ theme, calm, onTheme, onCalm }: PersonalizeAppProps) {
  return (
    <div className="personalize-app">
      <p className="help-lead">Pick a look. It changes at once and is remembered in this browser.</p>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {THEME_LIST.map((item) => (
          <button
            className="theme-card"
            type="button"
            role="radio"
            aria-checked={item.id === theme}
            key={item.id}
            onClick={() => onTheme(item.id)}
          >
            <span className="theme-preview" data-preview={item.id} aria-hidden="true">
              <span className="theme-preview-glow" />
              <span className="theme-preview-wave" />
              <span className="theme-preview-window" />
            </span>
            <span className="theme-name">{item.name}</span>
            <span className="theme-description">{item.description}</span>
          </button>
        ))}
      </div>
      <label className="checkbox-row calm-row">
        <input type="checkbox" checked={calm} onChange={(event) => onCalm(event.currentTarget.checked)} />
        <span>Calm motion: keep the wallpaper still and soften animations</span>
      </label>
    </div>
  );
}
