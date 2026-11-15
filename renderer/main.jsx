import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './styles.css';

// Not on the dev server: there, module URLs never change, so any caching hides edits.
if ('serviceWorker' in navigator && window.location.protocol !== 'file:' && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  window.__mimirDeferredInstallPrompt = event;
  window.dispatchEvent(new Event('mimir:install-available'));
});

createRoot(document.getElementById('root')).render(<App />);
