import { registerSW } from 'virtual:pwa-register';

export function setupPWA() {
  const updateSW = registerSW({
    onNeedRefresh() {
      // Could show a toast to the user here
      if (confirm('New content available. Reload?')) {
        updateSW(true);
      }
    },
    onOfflineReady() {
      console.log('App ready to work offline (Static assets only, API still requires network)');
    },
  });
}
