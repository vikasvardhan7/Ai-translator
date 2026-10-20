import { useCallback, useLayoutEffect, useMemo, useState } from 'react';

import type { Conversation } from '../../services/conversations';
import ConsentScreen from '../consent/ConsentScreen';
import { CallBridge, CallBridgeContext } from '../desktop/bridge';
import { applyLook, savedCalm, savedTheme } from '../desktop/themes';
import SessionScreen from '../session/SessionScreen';

export default function EmbedApp() {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [round, setRound] = useState(0);
  const bridge = useMemo(() => new CallBridge(), []);

  useLayoutEffect(() => {
    applyLook(savedTheme(), savedCalm());
  }, []);

  const returnToStart = useCallback(() => {
    setConversation(null);
    setRound((current) => current + 1);
  }, []);

  return (
    <CallBridgeContext.Provider value={bridge}>
      <div className="embed">
        {conversation ? (
          <SessionScreen
            key={conversation.id}
            conversation={conversation}
            initialTurns={[]}
            onReturnToStart={returnToStart}
            onRestart={null}
          />
        ) : (
          <ConsentScreen
            key={round}
            invite={null}
            flow={null}
            start={null}
            onConversation={setConversation}
            onLeaveInvite={returnToStart}
          />
        )}
      </div>
    </CallBridgeContext.Provider>
  );
}
