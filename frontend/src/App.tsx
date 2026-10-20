import { useState } from 'react';

import Desktop from './features/desktop/Desktop';
import EmbedApp from './features/embed/EmbedApp';
import { embedKeyFromHash, setRequestApiKey } from './services/apiKey';

function embedded(): boolean {
  const key = embedKeyFromHash(window.location.hash);
  if (key) {
    setRequestApiKey(key);
  }
  return key !== null;
}

export default function App() {
  const [embed] = useState(embedded);
  return embed ? <EmbedApp /> : <Desktop />;
}
