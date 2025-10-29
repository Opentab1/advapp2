import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

// PWA install prompt
let deferredPrompt: any;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  // Show install button or prompt (optional)
  console.log('PWA install prompt ready');
  
  // You can trigger the prompt when user clicks a button:
  // deferredPrompt.prompt();
  // deferredPrompt.userChoice.then((choiceResult) => {
  //   if (choiceResult.outcome === 'accepted') {
  //     console.log('User accepted the install prompt');
  //   }
  //   deferredPrompt = null;
  // });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
