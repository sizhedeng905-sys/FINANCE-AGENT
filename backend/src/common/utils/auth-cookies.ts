export const DEVELOPMENT_SESSION_COOKIE = 'finance_agent_session';
export const PRODUCTION_SESSION_COOKIE = '__Host-finance_agent_session';
export const DEVELOPMENT_CSRF_COOKIE = 'finance_agent_csrf';
export const PRODUCTION_CSRF_COOKIE = '__Host-finance_agent_csrf';

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name || !value) return cookies;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed values so they cannot alter authentication parsing.
    }
    return cookies;
  }, {});
}

export function sessionCookieName(production: boolean) {
  return production ? PRODUCTION_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE;
}

export function csrfCookieName(production: boolean) {
  return production ? PRODUCTION_CSRF_COOKIE : DEVELOPMENT_CSRF_COOKIE;
}
