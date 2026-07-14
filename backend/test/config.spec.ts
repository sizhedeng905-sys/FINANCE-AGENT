import { validateEnvironment } from '../src/config/validate-environment';

describe('environment validation', () => {
  const valid = {
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/finance_agent_test',
    JWT_SECRET: 'a-secure-test-secret-with-more-than-32-characters',
    PORT: '3001',
    AI_PROVIDER: 'mock'
  };

  it('accepts a complete safe configuration', () => {
    expect(validateEnvironment({ ...valid })).toMatchObject(valid);
  });

  it.each([
    [{ ...valid, DATABASE_URL: '' }, 'DATABASE_URL'],
    [{ ...valid, JWT_SECRET: 'development-secret-change-me' }, 'JWT_SECRET'],
    [{ ...valid, PORT: '70000' }, 'PORT'],
    [{ ...valid, PORT: '3001invalid' }, 'PORT'],
    [{ ...valid, AI_PROVIDER: 'unknown' }, 'AI_PROVIDER'],
    [{ ...valid, MAX_FILE_SIZE_MB: '0' }, 'MAX_FILE_SIZE_MB'],
    [{ ...valid, MAX_FILE_SIZE_MB: '51' }, 'MAX_FILE_SIZE_MB']
  ])('rejects an invalid required setting', (environment, expectedMessage) => {
    expect(() => validateEnvironment(environment)).toThrow(expectedMessage);
  });

  it.each([
    [{ ...valid, OCR_PROVIDER: 'unknown' }, 'OCR_PROVIDER'],
    [{ ...valid, OCR_TIMEOUT_MS: '99' }, 'OCR_TIMEOUT_MS'],
    [{ ...valid, OCR_LOW_CONFIDENCE_THRESHOLD: '0' }, 'OCR_LOW_CONFIDENCE_THRESHOLD'],
    [{ ...valid, OCR_MAX_PDF_PAGES: '201' }, 'OCR_MAX_PDF_PAGES'],
    [{ ...valid, OCR_MAX_RETRIES: '11' }, 'OCR_MAX_RETRIES']
  ])('rejects an invalid OCR setting', (environment, expectedMessage) => {
    expect(() => validateEnvironment(environment)).toThrow(expectedMessage);
  });

  it.each([
    [{ ...valid, MODEL_HTTP_MAX_RETRIES: '6' }, 'MODEL_HTTP_MAX_RETRIES'],
    [{ ...valid, MODEL_CIRCUIT_FAILURE_THRESHOLD: '0' }, 'MODEL_CIRCUIT_FAILURE_THRESHOLD'],
    [{ ...valid, MODEL_CIRCUIT_RESET_MS: '999' }, 'MODEL_CIRCUIT_RESET_MS'],
    [{ ...valid, MODEL_MAX_QUEUE: '0' }, 'MODEL_MAX_QUEUE'],
    [{ ...valid, AI_MAX_CONCURRENCY: '0' }, 'AI_MAX_CONCURRENCY'],
    [{ ...valid, OCR_MAX_CONCURRENCY: '33' }, 'OCR_MAX_CONCURRENCY']
  ])('rejects an invalid model runtime setting', (environment, expectedMessage) => {
    expect(() => validateEnvironment(environment)).toThrow(expectedMessage);
  });

  it.each([
    [{ ...valid, CORS_ORIGINS: 'http://localhost:5173/path' }, 'CORS_ORIGINS'],
    [{ ...valid, SWAGGER_ENABLED: 'yes' }, 'SWAGGER_ENABLED'],
    [{ ...valid, TRUST_PROXY_HOPS: '6' }, 'TRUST_PROXY_HOPS'],
    [{ ...valid, REQUEST_RATE_LIMIT_WINDOW_MS: '999' }, 'REQUEST_RATE_LIMIT_WINDOW_MS'],
    [{ ...valid, REQUEST_RATE_LIMIT_MAX: '9' }, 'REQUEST_RATE_LIMIT_MAX']
  ])('rejects an invalid HTTP security setting', (environment, expectedMessage) => {
    expect(() => validateEnvironment(environment)).toThrow(expectedMessage);
  });

  it('requires an explicit CORS allowlist in production', () => {
    expect(() => validateEnvironment({ ...valid, NODE_ENV: 'production' })).toThrow('CORS_ORIGINS');
  });
});
