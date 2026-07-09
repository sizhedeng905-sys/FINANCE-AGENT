const APP_STORAGE_VERSION = '2026-07-08-v3';
const VERSION_KEY = 'financial-agent-storage-version';

const APP_KEYS = [
  'audit-auth-store',
  'audit-work-order-store',
  'audit-notification-store',
  'audit-auth-store-v2',
  'audit-work-order-store-v2',
  'audit-notification-store-v2',
  'audit-auth-store-v3',
  'audit-work-order-store-v3',
  'audit-notification-store-v3',
  'audit-data-center-store-v1',
];

export function clearAppStorage() {
  try {
    APP_KEYS.forEach((key) => window.localStorage.removeItem(key));
    window.localStorage.removeItem(VERSION_KEY);
  } catch {
    // localStorage can be blocked in some browser privacy modes.
  }
}

export function clearLegacyAppStorageOnce() {
  try {
    const version = window.localStorage.getItem(VERSION_KEY);
    if (version === APP_STORAGE_VERSION) {
      return;
    }

    clearAppStorage();
    window.localStorage.setItem(VERSION_KEY, APP_STORAGE_VERSION);
  } catch {
    // Ignore storage errors and let the app run with in-memory Zustand state.
  }
}
