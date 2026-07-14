export const AUTH_SESSION_EXPIRED_EVENT = 'finance-agent:auth-session-expired';

const ACCESS_TOKEN_KEY = 'finance-agent-access-token-v2';
const LEGACY_ACCESS_TOKEN_KEY = 'finance-agent-access-token-v1';
let memoryToken: string | null = null;

export function getAccessToken(): string | null {
  try {
    memoryToken ??= window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
    return memoryToken;
  } catch {
    return null;
  }
}

export function setAccessToken(token: string): void {
  memoryToken = token;
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  window.localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
}

export function clearAccessToken(): void {
  try {
    memoryToken = null;
    window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  } catch {
    // The in-memory session is still cleared by the auth store.
  }
}

export function notifySessionExpired(): void {
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
}

export function createRequestId(): string {
  if (typeof window.crypto?.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getCsrfToken(): string | null {
  const cookies = document.cookie.split(';').map((item) => item.trim());
  for (const name of ['__Host-finance_agent_csrf', 'finance_agent_csrf']) {
    const prefix = `${name}=`;
    const match = cookies.find((item) => item.startsWith(prefix));
    if (match) {
      try {
        return decodeURIComponent(match.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}
