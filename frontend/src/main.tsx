import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { syncOfflineTransfers } from './lib/api'

// Register Service Worker for PWA offline caching — production only.
// In dev mode we actively UNREGISTER any stale workers so they don't
// intercept Vite HMR requests or serve cached code after a rebuild.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('ServiceWorker registered:', reg.scope))
        .catch((err) => console.error('ServiceWorker registration failed:', err));
    } else {
      // Dev: unregister all service workers so the browser always fetches fresh from Vite
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          reg.unregister();
          console.log('[dev] ServiceWorker unregistered to allow fresh HMR');
        }
      });
    }
  });
}


// Perform initial sync of any offline transfers queued in localStorage
if (navigator.onLine) {
  syncOfflineTransfers();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
