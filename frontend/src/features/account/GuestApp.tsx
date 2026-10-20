import { useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { inviteFromHash, meetingFromHash, type Conversation } from '../../services/conversations';
import ConsentScreen from '../consent/ConsentScreen';
import { CallBridge, CallBridgeContext } from '../desktop/bridge';
import { applyLook, savedCalm, savedTheme } from '../desktop/themes';
import SessionScreen from '../session/SessionScreen';

export function isGuestLink(hash: string): boolean {
  return inviteFromHash(hash) !== null || meetingFromHash(hash) !== null;
}

export default function GuestApp({ onSignIn }: { onSignIn: () => void }) {
  const [invite] = useState(() => inviteFromHash(window.location.hash));
  const [meeting] = useState(() => meetingFromHash(window.location.hash));
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [left, setLeft] = useState(false);
  const bridge = useMemo(() => new CallBridge(), []);

  useLayoutEffect(() => {
    applyLook(savedTheme(), savedCalm());
  }, []);

  const leave = useCallback(() => {
    setConversation(null);
    setLeft(true);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, []);

  if (left) {
    return (
      <main className="sign-in-page">
        <section className="sign-in-card">
          <p className="sign-in-brand">Voice Translator</p>
          <h1>You left the call</h1>
          <p className="form-help">Thanks for joining. To use the translator, the gym trainer and the rest of the app yourself, sign in or create an account.</p>
          <button className="button button-primary sign-in-submit" type="button" onClick={onSignIn}>Sign in or create an account</button>
        </section>
      </main>
    );
  }

  return (
    <CallBridgeContext.Provider value={bridge}>
      <div className="embed guest">
        {conversation ? (
          <SessionScreen
            key={conversation.id}
            conversation={conversation}
            initialTurns={[]}
            onReturnToStart={leave}
            onRestart={null}
          />
        ) : (
          <ConsentScreen
            invite={invite}
            flow={!invite && meeting ? { kind: 'guest', invite: meeting } : null}
            start={null}
            onConversation={setConversation}
            onLeaveInvite={leave}
          />
        )}
      </div>
    </CallBridgeContext.Provider>
  );
}
