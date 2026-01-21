import React from 'react';
import ReactDOM from 'react-dom/client';
import './config/initAmplify';
import App from './App';
import './index.css';

// Initialize theme before render to prevent flash
import themeService from './services/theme.service';
themeService.loadTheme();

// Expose diagnostic services on window for console debugging
import songLogService from './services/song-log.service';
import dynamoDBService from './services/dynamodb.service';
(window as any).songLogService = songLogService;
(window as any).dynamoDBService = dynamoDBService;

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
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  
  // Show install button or prompt (optional)
  console.log('PWA install prompt ready');
  
  // You can trigger the prompt when user clicks a button:
  // e.prompt();
  // e.userChoice.then((choiceResult) => {
  //   if (choiceResult.outcome === 'accepted') {
  //     console.log('User accepted the install prompt');
  //   }
  // });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
