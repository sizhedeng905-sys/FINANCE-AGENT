import { Request } from 'express';

import { RequestContext } from '../types/current-user';

export function getRequestContext(request: Request): RequestContext {
  const userAgent = request.headers['user-agent'];

  return {
    ip: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent.join('; ') : userAgent
  };
}
