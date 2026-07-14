import { Request } from 'express';

import { RequestContext } from '../types/current-user';
import { RequestWithId } from '../middleware/request-id.middleware';

export function getRequestContext(request: Request | RequestWithId): RequestContext {
  const userAgent = request.headers['user-agent'];

  return {
    ip: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent.join('; ') : userAgent,
    requestId: (request as RequestWithId).requestId
  };
}
