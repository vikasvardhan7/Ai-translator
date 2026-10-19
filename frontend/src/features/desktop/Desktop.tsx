import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { createSession } from '../../services/api';
import { inviteFromHash, sessionConversation, type Conversation, type Invite } from '../../services/conversations';
import type { Participant } from '../../services/protocol';
import AssistantApp, { type ChatEntry, type Prompt } from '../assistant/AssistantApp';
import { APP_NAMES, type DesktopHandlers, type Where } from '../assistant/agent';
import ConsentScreen from '../consent/ConsentScreen';
import { PrivacyPolicy, TermsAndConditions } from '../legal/LegalPages';
import type { Turn } from '../session/conversation';
import SessionScreen from '../session/SessionScreen';
import AppIcon, { type IconName } from './AppIcon';
import AppWindow from './AppWindow';
import { CallBridge, CallBridgeContext } from './bridge';
import DesktopWidget from './DesktopWidget';
import HelpApp from './HelpApp';
import PersonalizeApp from './PersonalizeApp';
import Taskbar, { APP_ICONS } from './Taskbar';
import { applyLook, particles, savedCalm, savedTheme, saveLook, themeOf, type ThemeId } from './themes';
import {
  activeApp,
  clickTaskbar,
  close,
  EMPTY_DESK,
  fit,
  focus,
  minimize,
  move,
  open,
  toggleMaximize,
  type Area,
  type AppId,
  type Desk,
} from './windows';

const TASKBAR_HEIGHT = 64;
const PARTICLES = particles();

interface Launch {
  where: Where | null;
  key: number;
}

interface Shortcut {
  label: string;
  icon: IconName;
  run: () => void;
}

function currentArea(): Area {
  return { width: window.innerWidth, height: Math.max(320, window.innerHeight - TASKBAR_HEIGHT) };
}

function firstApp(): AppId {
  const hash = window.location.hash.slice(1);
  return hash === 'privacy' || hash === 'terms' ? hash : 'translator';
}

function conversationTitle(conversation: Conversation | null): string {
  if (!conversation) {
    return APP_NAMES.translator;
  }
  if (conversation.mode === 'call') {
    return 'Meeting captions';
  }
  return conversation.mode === 'remote' ? 'Call' : 'Conversation';
}

export default function Desktop() {
  const [area, setArea] = useState<Area>(currentArea);
  const [desk, setDesk] = useState<Desk>(() => open(EMPTY_DESK, firstApp(), currentArea()));
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [carriedTurns, setCarriedTurns] = useState<Turn[]>([]);
  const [invite, setInvite] = useState<Invite | null>(() => inviteFromHash(window.location.hash));
  const [launch, setLaunch] = useState<Launch>({ where: null, key: 0 });
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>(savedTheme);
  const [calm, setCalm] = useState(savedCalm);
  const bridge = useMemo(() => new CallBridge(), []);
  const sessionIdRef = useRef<string | null>(null);
  const promptIdRef = useRef(1);
  const active = activeApp(desk);

  useLayoutEffect(() => {
    applyLook(theme, calm);
    saveLook(theme, calm);
  }, [calm, theme]);

  useEffect(() => {
    function resize(): void {
      const next = currentArea();
      setArea(next);
      setDesk((current) => fit(current, next));
    }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    function syncFromHash(): void {
      const hash = window.location.hash.slice(1);
      const found = inviteFromHash(window.location.hash);
      if (found) {
        setInvite(found);
        setDesk((current) => open(current, 'translator', currentArea()));
      } else if (hash === 'privacy' || hash === 'terms') {
        setDesk((current) => open(current, hash, currentArea()));
      }
    }
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  useEffect(() => {
    function syncAnimationVisibility(): void {
      document.documentElement.dataset.pageVisible = document.visibilityState === 'visible' ? 'visible' : 'hidden';
    }
    syncAnimationVisibility();
    document.addEventListener('visibilitychange', syncAnimationVisibility);
    return () => document.removeEventListener('visibilitychange', syncAnimationVisibility);
  }, []);

  const openApp = useCallback((app: AppId) => setDesk((current) => open(current, app, currentArea())), []);

  const returnToStart = useCallback(() => {
    sessionIdRef.current = null;
    setConversation(null);
    setCarriedTurns([]);
    setInvite(null);
    if (window.location.hash.startsWith('#join')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  const startConversation = useCallback((next: Conversation, turns: Turn[] = []) => {
    if (window.location.hash.startsWith('#join')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    sessionIdRef.current = next.id;
    setCarriedTurns(turns);
    setConversation(next);
    setDesk((current) => focus(current, 'translator'));
  }, []);

  async function restartSession(participants: Participant[], turns: Turn[]): Promise<void> {
    if (!conversation || conversation.mode === 'remote') {
      return;
    }
    const startedFrom = conversation.id;
    const next = await createSession(participants, true, conversation.mode);
    if (sessionIdRef.current === startedFrom) {
      startConversation(sessionConversation(next), turns);
    }
  }

  const start = useCallback((where: Where) => {
    if (!sessionIdRef.current) {
      setInvite(null);
      setLaunch((current) => ({ where, key: current.key + 1 }));
    }
    setDesk((current) => open(current, 'translator', currentArea()));
  }, []);

  const closeApp = useCallback((app: AppId) => {
    if (app === 'translator' && sessionIdRef.current) {
      const controls = bridge.get();
      if (controls?.actions.includes('end_conversation')) {
        controls.run('end_conversation', {});
      }
      returnToStart();
    }
    setDesk((current) => close(current, app));
  }, [bridge, returnToStart]);

  const ask = useCallback((text: string) => {
    setPrompt({ id: promptIdRef.current++, text });
    setDesk((current) => open(current, 'assistant', currentArea()));
  }, []);

  const handlers: DesktopHandlers = useMemo(
    () => ({ open: openApp, close: closeApp, start, theme: setTheme }),
    [closeApp, openApp, start],
  );

  const shortcuts: Shortcut[] = [
    { label: 'Translator', icon: 'translator', run: () => openApp('translator') },
    { label: 'Meeting captions', icon: 'meeting', run: () => start('meeting') },
    { label: 'Call another device', icon: 'remote', run: () => start('remote') },
    { label: 'Talk next to me', icon: 'here', run: () => start('here') },
    { label: 'Assistant', icon: 'assistant', run: () => openApp('assistant') },
    { label: 'Personalize', icon: 'personalize', run: () => openApp('personalize') },
    { label: 'Help', icon: 'help', run: () => openApp('help') },
    { label: 'Privacy', icon: 'privacy', run: () => openApp('privacy') },
    { label: 'Terms', icon: 'terms', run: () => openApp('terms') },
  ];

  function iconKey(event: KeyboardEvent<HTMLButtonElement>, shortcut: Shortcut): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      shortcut.run();
    }
  }

  function content(app: AppId): ReactNode {
    switch (app) {
      case 'translator':
        return conversation ? (
          <SessionScreen
            key={conversation.id}
            conversation={conversation}
            initialTurns={carriedTurns}
            onReturnToStart={returnToStart}
            onRestart={conversation.mode === 'remote' ? null : restartSession}
            onAsk={() => openApp('assistant')}
          />
        ) : (
          <ConsentScreen
            key={invite ? `invite/${invite.roomId}` : `start/${launch.key}`}
            invite={invite}
            start={launch.where}
            onConversation={startConversation}
            onLeaveInvite={returnToStart}
          />
        );
      case 'assistant':
        return (
          <AssistantApp
            chat={chat}
            onChat={setChat}
            prompt={prompt}
            onPromptTaken={() => setPrompt(null)}
            running={conversation !== null}
            desktop={handlers}
          />
        );
      case 'personalize':
        return <PersonalizeApp theme={theme} calm={calm} onTheme={setTheme} onCalm={setCalm} />;
      case 'help':
        return <HelpApp onTry={ask} />;
      case 'privacy':
        return <PrivacyPolicy />;
      case 'terms':
        return <TermsAndConditions />;
    }
  }

  return (
    <CallBridgeContext.Provider value={bridge}>
      <div className="desktop">
        <div className="wallpaper" aria-hidden="true" key={theme}>
          <div className="wallpaper-glow" />
          <div className="aurora">
            <span />
            <span />
            <span />
          </div>
          <div className="particles" data-kind={themeOf(theme).particles}>
            {PARTICLES.map((item, index) => (
              <span
                key={index}
                style={{
                  ['--left' as string]: `${item.left}%`,
                  ['--size' as string]: `${item.size}px`,
                  ['--delay' as string]: `${item.delay}s`,
                  ['--duration' as string]: `${item.duration}s`,
                  ['--drift' as string]: `${item.drift}px`,
                }}
              />
            ))}
          </div>
          <svg className="wave wave-back" viewBox="0 0 1440 320" preserveAspectRatio="none">
            <path d="M0 160c120-40 240-60 360-40s240 80 360 80 240-60 360-80 240 0 360 40v160H0z" />
          </svg>
          <svg className="wave wave-middle" viewBox="0 0 1440 320" preserveAspectRatio="none">
            <path d="M0 200c160 40 320 40 480 0s320-80 480-60 320 80 480 60v120H0z" />
          </svg>
          <svg className="wave wave-front" viewBox="0 0 1440 320" preserveAspectRatio="none">
            <path d="M0 240c120 20 240 30 360 10s240-60 360-60 240 50 360 60 240-20 360-30v100H0z" />
          </svg>
        </div>

        <main className="desktop-surface" aria-label="Desktop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelected(null);
          }
        }}>
          <h1 className="visually-hidden">Voice Translator</h1>
          <DesktopWidget />
          <ul className="desktop-icons" aria-label="Desktop icons">
            {shortcuts.map((shortcut, index) => (
              <li key={shortcut.label} style={{ ['--order' as string]: index }}>
                <button
                  className="desktop-icon"
                  type="button"
                  data-selected={selected === shortcut.label}
                  onClick={(event) => {
                    setSelected(shortcut.label);
                    if ((event.nativeEvent as PointerEvent).pointerType === 'touch') {
                      shortcut.run();
                    }
                  }}
                  onDoubleClick={shortcut.run}
                  onKeyDown={(event) => iconKey(event, shortcut)}
                >
                  <AppIcon name={shortcut.icon} size="large" />
                  <span>{shortcut.label}</span>
                </button>
              </li>
            ))}
          </ul>

          {desk.windows.map((state) => (
            <AppWindow
              key={state.app}
              window={state}
              title={state.app === 'translator' ? conversationTitle(conversation) : APP_NAMES[state.app]}
              icon={state.app === 'translator' && conversation?.mode === 'call' ? 'meeting' : APP_ICONS[state.app]}
              active={state.app === active}
              area={area}
              onFocus={() => {
                if (state.app !== active) {
                  setDesk((current) => focus(current, state.app));
                }
              }}
              onMinimize={() => setDesk((current) => minimize(current, state.app))}
              onMaximize={() => setDesk((current) => toggleMaximize(current, state.app))}
              onClose={() => closeApp(state.app)}
              onMove={(x, y) => setDesk((current) => move(current, state.app, x, y, currentArea()))}
            >
              {content(state.app)}
            </AppWindow>
          ))}
        </main>

        <Taskbar
          windows={desk.windows}
          active={active}
          live={conversation !== null}
          onApp={(app) => setDesk((current) => clickTaskbar(current, app, currentArea()))}
          onOpen={openApp}
          onStart={start}
          onAsk={ask}
        />
      </div>
    </CallBridgeContext.Provider>
  );
}
