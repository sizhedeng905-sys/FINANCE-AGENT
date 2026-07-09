import type { ApiResponse } from '@/types/dataCenter';

export const delay = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function ok<T>(data: T, message = 'success'): ApiResponse<T> {
  return { code: 0, message, data };
}
