import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import ConsentScreen from './features/consent/ConsentScreen';
import { PrivacyPolicy, TermsAndConditions } from './features/legal/LegalPages';
import { createSession } from './services/api';
import type { CreateSessionResponse } from './services/protocol';
import SessionScreen from './features/session/SessionScreen';

type Screen = 'start' | 'session' | 'privacy' | 'terms';
type PublicScreen = Exclude<Screen, 'session'>;

function screenFromHash(): PublicScreen {
  switch (window.location.hash.slice(1)) {
    case 'privacy':
      return 'privacy';
    case 'terms':
      return 'terms';
    default:
      return 'start';
  }
}

interface AppLinkProps {
  screen: PublicScreen;
  currentScreen: Screen;
  onNavigate: (screen: PublicScreen) => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

function AppLink({ screen, currentScreen, onNavigate, children, className, ariaLabel }: AppLinkProps) {
  return (
    <a
      className={className}
      href={`#${screen}`}
      aria-label={ariaLabel}
      aria-current={currentScreen === screen ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(screen);
      }}
    >
      {children}
    </a>
  );
}

interface AppNavigationProps {
  screen: Screen;
  onNavigate: (screen: PublicScreen) => void;
}

function AppNavigation({ screen, onNavigate }: AppNavigationProps) {
  const items: Array<{ screen: PublicScreen; label: string }> = [
    { screen: 'start', label: 'Start' },
    { screen: 'privacy', label: 'Privacy' },
    { screen: 'terms', label: 'Terms' },
  ];

  return (
    <nav className="desktop-navigation" aria-label="Main navigation">
      {items.map((item) => (
        <AppLink key={item.screen} screen={item.screen} currentScreen={screen} onNavigate={onNavigate}>
          {item.label}
        </AppLink>
      ))}
    </nav>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromHash());
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hasChangedScreens, setHasChangedScreens] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const previousScreenRef = useRef<Screen | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    function syncScreenFromHash(): void {
      setScreen((current) => (current === 'session' ? current : screenFromHash()));
    }

    window.addEventListener('hashchange', syncScreenFromHash);
    return () => window.removeEventListener('hashchange', syncScreenFromHash);
  }, []);

  useEffect(() => {
    const previousScreen = previousScreenRef.current;
    if (previousScreen !== null && previousScreen !== screen) {
      setHasChangedScreens(true);
      document.querySelector<HTMLElement>('.screen-transition main h1')?.focus({ preventScroll: true });
      setMobileMenuOpen(false);
    }
    previousScreenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return undefined;
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  useEffect(() => {
    function syncAnimationVisibility(): void {
      document.documentElement.dataset.pageVisible = document.visibilityState === 'visible' ? 'visible' : 'hidden';
    }

    syncAnimationVisibility();
    document.addEventListener('visibilitychange', syncAnimationVisibility);
    return () => document.removeEventListener('visibilitychange', syncAnimationVisibility);
  }, []);

  const navigate = useCallback((nextScreen: PublicScreen) => {
    setScreen(nextScreen);
    if (window.location.hash !== `#${nextScreen}`) {
      window.location.hash = nextScreen;
    }
  }, []);

  const returnToStart = useCallback(() => {
    sessionIdRef.current = null;
    setSession(null);
    setScreen('start');
    if (window.location.hash !== '#start') {
      window.location.hash = 'start';
    }
  }, []);

  function startSession(nextSession: CreateSessionResponse): void {
    sessionIdRef.current = nextSession.session_id;
    setSession(nextSession);
    setScreen('session');
  }

  async function restartSession(): Promise<void> {
    if (!session) {
      return;
    }
    const startedFrom = session.session_id;
    const next = await createSession(session.participants, true, session.mode);
    if (sessionIdRef.current === startedFrom) {
      startSession(next);
    }
  }

  function navigateFromMobile(nextScreen: PublicScreen): void {
    navigate(nextScreen);
    setMobileMenuOpen(false);
  }

  let page: ReactNode;
  if (screen === 'session' && session) {
    page = (
      <SessionScreen
        key={session.session_id}
        session={session}
        onReturnToStart={returnToStart}
        onRestart={restartSession}
      />
    );
  } else if (screen === 'privacy') {
    page = <PrivacyPolicy />;
  } else if (screen === 'terms') {
    page = <TermsAndConditions />;
  } else {
    page = <ConsentScreen onSessionCreated={startSession} />;
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        {screen === 'session' ? (
          <span className="wordmark">Voice Translator</span>
        ) : (
          <>
            <AppLink screen="start" currentScreen={screen} onNavigate={navigate} className="wordmark">
              Voice Translator
            </AppLink>
            <AppNavigation screen={screen} onNavigate={navigate} />
            <div className="mobile-navigation">
              <button
                className="mobile-menu-trigger"
                type="button"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu-panel"
                ref={mobileMenuButtonRef}
                onClick={() => setMobileMenuOpen((open) => !open)}
              >
                Menu
              </button>
              <nav
                className="mobile-menu-panel"
                id="mobile-menu-panel"
                aria-label="Main navigation"
                data-open={mobileMenuOpen}
                aria-hidden={!mobileMenuOpen}
              >
                <AppLink screen="start" currentScreen={screen} onNavigate={navigateFromMobile}>Start</AppLink>
                <AppLink screen="privacy" currentScreen={screen} onNavigate={navigateFromMobile}>Privacy</AppLink>
                <AppLink screen="terms" currentScreen={screen} onNavigate={navigateFromMobile}>Terms</AppLink>
              </nav>
            </div>
          </>
        )}
      </header>

      <div
        className={`screen-transition ${hasChangedScreens ? 'screen-transition-active' : ''}`}
        key={screen}
      >
        {page}
      </div>

      <footer className="site-footer">
        <p>Voice Translator</p>
        {screen !== 'session' && (
          <nav aria-label="Footer links">
            <AppLink screen="privacy" currentScreen={screen} onNavigate={navigate}>Privacy</AppLink>
            <AppLink screen="terms" currentScreen={screen} onNavigate={navigate}>Terms</AppLink>
          </nav>
        )}
      </footer>
    </div>
  );
}
