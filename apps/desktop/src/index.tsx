import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import type { AuthState } from './types';
import { parakeet as p } from './bridge';
import { Home } from './home';
import { SignIn } from './signin';
import './styles.css';

function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  useEffect(() => {
    p.auth.get().then(setAuth);
    return p.auth.onChange(setAuth);
  }, []);
  if (!auth) return null;
  return auth.user ? <Home email={auth.user.email} /> : <SignIn />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
