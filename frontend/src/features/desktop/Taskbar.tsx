import { useEffect, useRef, useState, type FormEvent } from 'react';

import { APP_NAMES, type Where } from '../assistant/agent';
import AppIcon, { type IconName } from './AppIcon';
import { APPS, type AppId, type WindowState } from './windows';

export const APP_ICONS: Record<AppId, IconName> = {
  translator: 'translator',
  meetings: 'schedule',
  assistant: 'assistant',
  personalize: 'personalize',
  help: 'help',
  privacy: 'privacy',
  terms: 'terms',
};

const PINNED: AppId[] = ['translator', 'meetings', 'assistant', 'help'];
const SHORTCUTS: Array<{ where: Where; icon: IconName; label: string }> = [
  { where: 'remote', icon: 'remote', label: 'Meet now' },
  { where: 'meeting', icon: 'meeting', label: 'Live captions' },
  { where: 'here', icon: 'here', label: 'Talk here' },
];

interface TaskbarProps {
  windows: WindowState[];
  active: AppId | null;
  live: boolean;
  onApp: (app: AppId) => void;
  onOpen: (app: AppId) => void;
  onStart: (where: Where) => void;
  onAsk: (text: string) => void;
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function AskBox({ id, onAsk, autoFocus }: { id: string; onAsk: (text: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const asked = text.trim();
    if (asked) {
      onAsk(asked);
      setText('');
    }
  }
  return (
    <form className="ask-box" role="search" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={id}>Ask the assistant or give a command</label>
      <AppIcon name="assistant" size="small" />
      <input
        id={id}
        type="text"
        value={text}
        maxLength={4000}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Ask anything or say “schedule a meeting”"
        onChange={(event) => setText(event.target.value)}
      />
    </form>
  );
}

export default function Taskbar({ windows, active, live, onApp, onOpen, onStart, onAsk }: TaskbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<HTMLButtonElement | null>(null);
  const now = useClock();
  const shown = [...PINNED, ...windows.map((window) => window.app).filter((app) => !PINNED.includes(app))];

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    function closeOutside(event: PointerEvent): void {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !startRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        startRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  function pick(action: () => void): void {
    setMenuOpen(false);
    action();
  }

  return (
    <>
      {menuOpen && (
        <div className="start-menu" ref={menuRef} role="dialog" aria-label="Start">
          <AskBox id="start-ask" autoFocus onAsk={(text) => pick(() => onAsk(text))} />
          <h2 className="start-heading">Start a conversation</h2>
          <div className="start-grid">
            {SHORTCUTS.map((shortcut) => (
              <button className="start-tile" type="button" key={shortcut.where} onClick={() => pick(() => onStart(shortcut.where))}>
                <AppIcon name={shortcut.icon} size="large" />
                <span>{shortcut.label}</span>
              </button>
            ))}
          </div>
          <h2 className="start-heading">Apps</h2>
          <div className="start-grid">
            {APPS.map((app) => (
              <button className="start-tile" type="button" key={app} onClick={() => pick(() => onOpen(app))}>
                <AppIcon name={APP_ICONS[app]} size="large" />
                <span>{APP_NAMES[app]}</span>
              </button>
            ))}
          </div>
          <p className="start-footer">Everything stays on this computer while the page is open. Nothing is saved.</p>
        </div>
      )}
      <nav className="taskbar" aria-label="Taskbar">
        <div className="taskbar-middle">
          <button
            className="taskbar-button taskbar-start"
            type="button"
            ref={startRef}
            aria-expanded={menuOpen}
            aria-label="Start"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <AppIcon name="start" />
          </button>
          <AskBox id="taskbar-ask" onAsk={onAsk} />
          {shown.map((app) => {
            const window = windows.find((item) => item.app === app);
            const state = !window ? 'closed' : app === active ? 'active' : window.minimized ? 'minimized' : 'open';
            return (
              <button
                className="taskbar-button"
                type="button"
                key={app}
                data-state={state}
                aria-label={APP_NAMES[app]}
                aria-pressed={app === active}
                title={APP_NAMES[app]}
                onClick={() => onApp(app)}
              >
                <AppIcon name={APP_ICONS[app]} />
                {app === 'translator' && live && <span className="taskbar-live" aria-label="Call running" />}
              </button>
            );
          })}
        </div>
        <p className="taskbar-clock">
          <time dateTime={now.toISOString()}>
            <span>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span>{now.toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
          </time>
        </p>
      </nav>
    </>
  );
}
