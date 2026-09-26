import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { SessionProvider } from '@/lib/session';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <SessionProvider>
        <App />
      </SessionProvider>
    </AuthGate>
  </StrictMode>
);
