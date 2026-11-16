/* Defines window.PocketRTANative inside the iOS app (Capacitor). Does nothing in a browser.
   Must load before app.js: the app locks Pro features only where this object exists. */
(() => {
  'use strict';
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const Pro = C.registerPlugin('Pro'), Audio = C.registerPlugin('AudioSession');
  const N = {
    price: undefined,                                    // the store's localized price, filled in once loaded
    isPro: async () => !!(await Pro.isPro()).pro,
    buyPro: async () => !!(await Pro.buy()).pro,
    restorePro: async () => !!(await Pro.restore()).pro,
    prepareAudio: async () => { try { await Audio.prepare(); } catch (e) { /* carry on with the default session */ } },
  };
  Pro.getProduct().then(r => { if (r && r.price) N.price = r.price; }).catch(() => {});
  window.PocketRTANative = N;
})();
