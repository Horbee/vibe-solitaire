/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from "virtual:pwa-register";

/**
 * Register the service worker. `autoUpdate` checks for a new version on load
 * and applies it; `onOfflineReady` confirms the app can run without network.
 */
export function registerPwa(): void {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      // autoUpdate: a new SW is waiting; reload to activate it.
      window.location.reload();
    },
    onOfflineReady() {
      console.info("Solitaire is ready for offline play.");
    },
  });
}
