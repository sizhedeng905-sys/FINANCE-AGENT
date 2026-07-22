import { UserRole, UserStatus } from '@prisma/client';
import { Request } from 'express';

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  department: string;
  phone: string;
  status: UserStatus;
  tokenVersion: number;
  sessionId?: string;
}

export interface AuthenticatedRequest extends Request {
  user: CurrentUser;
}

export interface RequestContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}
