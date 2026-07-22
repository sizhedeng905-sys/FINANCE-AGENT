const APP_STORAGE_VERSION = '2026-07-11-v8';
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
  'audit-work-order-store-v4',
  'audit-notification-store-v3',
  'audit-data-center-store-v1',
  'audit-data-center-store-v2',
  'audit-data-center-store-v3',
  'audit-data-center-store-v4',
  'audit-data-center-store-v5',
  'audit-data-center-store-v6',
  'audit-data-center-store-v7',
  'audit-data-center-store-mock-v8',
  'audit-data-center-store-api-v1',
  'audit-user-store-v1',
  'finance-agent-access-token-v1',
];

export function clearAppStorage() {
  try {
    APP_KEYS.forEach((key) => window.localStorage.removeItem(key));
    window.sessionStorage.removeItem('finance-agent-access-token-v2');
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
