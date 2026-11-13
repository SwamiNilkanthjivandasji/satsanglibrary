// Service worker નોંધણી + "એપ ઇન્સ્ટોલ" બટન
const installBtn = document.querySelector('#btn-install');
const dialog = document.querySelector('#install-dialog');
let deferredPrompt = null;

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function showButton() {
  if (!isStandalone()) installBtn.hidden = false;
}

export function initPwa({ toast }) {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.hidden = true;
    toast('એપ ઇન્સ્ટોલ થઈ ગઈ છે.');
  });

  // iOS Safari માં beforeinstallprompt નથી; ત્યાં રીત બતાવતું બટન
  if (isIOS()) showButton();

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      installBtn.hidden = true;
      return;
    }
    if (dialog && dialog.showModal) dialog.showModal();
  });

  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
}
