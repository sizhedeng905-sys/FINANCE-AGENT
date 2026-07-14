export const AUTH_SESSION_EXPIRED_EVENT = 'finance-agent:auth-session-expired';

const ACCESS_TOKEN_KEY = 'finance-agent-access-token-v1';

export function getAccessToken(): string | null {
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
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
