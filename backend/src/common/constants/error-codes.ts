export const ERROR_CODES: Record<number, number> = {
  400: 40001,
  401: 40101,
  403: 40301,
  404: 40401,
  409: 40901,
  413: 41301,
  422: 42201,
  429: 42901,
  500: 50001
};

export function getErrorCode(status: number): number {
  return ERROR_CODES[status] ?? 50001;
}
