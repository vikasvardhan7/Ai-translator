import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { startInstall } from './features/desktop/install';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found in index.html');
}

startInstall();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
