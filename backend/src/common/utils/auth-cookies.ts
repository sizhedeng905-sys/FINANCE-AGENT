export const DEVELOPMENT_SESSION_COOKIE = 'finance_agent_session';
export const PRODUCTION_SESSION_COOKIE = '__Host-finance_agent_session';
export const DEVELOPMENT_CSRF_COOKIE = 'finance_agent_csrf';
export const PRODUCTION_CSRF_COOKIE = '__Host-finance_agent_csrf';

export interface ParsedCookieHeader {
  cookies: Record<string, string>;
  names: Set<string>;
  duplicateNames: Set<string>;
}

export function parseCookieHeaderDetails(header: string | undefined): ParsedCookieHeader {
  const result: ParsedCookieHeader = {
    cookies: {},
    names: new Set<string>(),
    duplicateNames: new Set<string>()
  };
  if (!header) return result;
  return header.split(';').reduce<ParsedCookieHeader>((parsed, part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return parsed;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) return parsed;
    if (parsed.names.has(name)) parsed.duplicateNames.add(name);
    parsed.names.add(name);
    if (!value) return parsed;
    try {
      if (!Object.prototype.hasOwnProperty.call(parsed.cookies, name)) parsed.cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed values so they cannot alter authentication parsing.
    }
    return parsed;
  }, result);
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  return parseCookieHeaderDetails(header).cookies;
}

export function sessionCookieName(production: boolean) {
  return production ? PRODUCTION_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE;
}

export function csrfCookieName(production: boolean) {
  return production ? PRODUCTION_CSRF_COOKIE : DEVELOPMENT_CSRF_COOKIE;
}

export function rejectedCookieNames(production: boolean) {
  return production
    ? [DEVELOPMENT_SESSION_COOKIE, DEVELOPMENT_CSRF_COOKIE]
    : [PRODUCTION_SESSION_COOKIE, PRODUCTION_CSRF_COOKIE];
}
