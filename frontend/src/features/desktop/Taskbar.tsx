import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { AccountUser } from '../../services/api';
import { APP_NAMES, type Where } from '../assistant/agent';
import AppIcon, { type IconName } from './AppIcon';
import { APPS, type AppId, type WindowState } from './windows';

export const APP_ICONS: Record<AppId, IconName> = {
  translator: 'translator',
  meetings: 'schedule',
  trainer: 'trainer',
  assistant: 'assistant',
  developers: 'developers',
  personalize: 'personalize',
  account: 'account',
  help: 'help',
  privacy: 'privacy',
  terms: 'terms',
};

const PINNED: AppId[] = ['translator', 'meetings', 'trainer', 'assistant', 'help'];
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
  user: AccountUser;
  onSignOut: () => void;
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

function initial(user: AccountUser): string {
  return (user.name.trim()[0] ?? '?').toUpperCase();
}

function AccountButton({ user, onOpen, onSignOut }: { user: AccountUser; onOpen: (app: AppId) => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function closeOutside(event: PointerEvent): void {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="taskbar-account">
      <button
        className="taskbar-account-button"
        type="button"
        ref={buttonRef}
        aria-expanded={open}
        aria-label={`Signed in as ${user.name}. Account and sign out`}
        title={`${user.name} (${user.email})`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-avatar" aria-hidden="true">{initial(user)}</span>
      </button>
      {open && (
        <div className="account-popover" ref={panelRef} role="dialog" aria-label="Your account">
          <p className="account-popover-who">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </p>
          <button className="button button-secondary button-small" type="button" onClick={() => { setOpen(false); onOpen('account'); }}>
            Account settings
          </button>
          <button className="button button-primary button-small" type="button" onClick={() => { setOpen(false); onSignOut(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Taskbar({ windows, active, live, onApp, onOpen, onStart, onAsk, user, onSignOut }: TaskbarProps) {
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
          <div className="start-account">
            <span className="account-avatar" aria-hidden="true">{initial(user)}</span>
            <span className="start-account-who">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <button className="button button-small button-secondary" type="button" onClick={() => pick(() => onOpen('account'))}>
              Account
            </button>
            <button className="button button-small button-secondary" type="button" onClick={() => pick(onSignOut)}>
              Sign out
            </button>
          </div>
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
        <AccountButton user={user} onOpen={onOpen} onSignOut={onSignOut} />
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
