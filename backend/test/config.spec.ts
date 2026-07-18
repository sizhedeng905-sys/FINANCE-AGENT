import { validateEnvironment } from '../src/config/validate-environment';

describe('environment validation', () => {
  const valid = {
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/finance_agent_test',
    JWT_SECRET: 'a-secure-test-secret-with-more-than-32-characters',
    PORT: '3001',
    AI_PROVIDER: 'mock'
  };
  const productionRequired = {
    PROCESS_ROLE: 'api',
    FILE_STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'https://objects.finance-agent.example.com',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'finance-agent-private',
    S3_ACCESS_KEY_ID: 'finance-runtime',
    S3_SECRET_ACCESS_KEY: 's3-secret-with-enough-entropy-12345',
    S3_LOGICAL_QUOTA_BYTES: '1099511627776',
    REQUEST_RATE_LIMIT_STORE: 'redis',
    REDIS_URL: 'rediss://runtime:redis-secret-12345@redis.example.com:6379',
    METRICS_TOKEN: 'metrics-secret-1234567890-ABCDEFGHIJ-klmnop',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://tempo.finance-agent.example.com/v1/traces'
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
    [{ ...valid, AI_PROVIDER_CLASS: 'trusted' }, 'AI_PROVIDER_CLASS'],
    [{ ...valid, AI_PROVIDER_CLASS: 'external' }, 'AI_PROVIDER_CLASS'],
    [{ ...valid, AI_INGESTION_MODE: 'auto_approve' }, 'AI_INGESTION_MODE'],
    [{ ...valid, AI_REPORT_MODE: 'auto_commit' }, 'AI_REPORT_MODE'],
    [{ ...valid, AI_GLOBAL_KILL_SWITCH: 'yes' }, 'AI_GLOBAL_KILL_SWITCH'],
    [{ ...valid, AI_EXTERNAL_PROVIDER_MODE: 'enabled' }, 'AI_EXTERNAL_PROVIDER_MODE'],
    [{ ...valid, MAX_FILE_SIZE_MB: '0' }, 'MAX_FILE_SIZE_MB'],
    [{ ...valid, MAX_FILE_SIZE_MB: '51' }, 'MAX_FILE_SIZE_MB'],
    [{ ...valid, JWT_ALGORITHM: 'none' }, 'JWT_ALGORITHM'],
    [{ ...valid, JWT_ISSUER: 'x' }, 'JWT_ISSUER'],
    [{ ...valid, UPLOAD_MAX_CONCURRENT_PER_USER: '0' }, 'UPLOAD_MAX_CONCURRENT_PER_USER'],
    [{ ...valid, UPLOAD_MAX_INFLIGHT_MB_PER_USER: '1', MAX_FILE_SIZE_MB: '10' }, 'UPLOAD_MAX_INFLIGHT_MB_PER_USER'],
    [{ ...valid, FILE_IMAGE_MAX_PIXELS: '0' }, 'FILE_IMAGE_MAX_PIXELS'],
    [{ ...valid, FILE_PDF_MAX_OBJECTS: '99' }, 'FILE_PDF_MAX_OBJECTS'],
    [{ ...valid, FILE_PARSE_TIMEOUT_MS: '99' }, 'FILE_PARSE_TIMEOUT_MS'],
    [{ ...valid, AI_AUDIT_RETENTION_DAYS: '0' }, 'AI_AUDIT_RETENTION_DAYS'],
    [{ ...valid, DATA_RETENTION_MODE: 'execute' }, 'DATA_RETENTION_MODE'],
    [{ ...valid, DATA_RETENTION_BATCH_SIZE: '501' }, 'DATA_RETENTION_BATCH_SIZE'],
    [{ ...valid, DATA_RETENTION_LEASE_MS: '9999' }, 'DATA_RETENTION_LEASE_MS'],
    [{ ...valid, DATA_RETENTION_MAX_ATTEMPTS: '0' }, 'DATA_RETENTION_MAX_ATTEMPTS'],
    [{ ...valid, STEP_UP_MODE: 'optional' }, 'STEP_UP_MODE'],
    [{ ...valid, STEP_UP_TTL_SECONDS: '301' }, 'STEP_UP_TTL_SECONDS'],
    [{ ...valid, STEP_UP_MODE: 'enforce' }, 'STEP_UP_ENFORCED_ACTIONS'],
    [{ ...valid, STEP_UP_ENFORCED_ACTIONS: 'unknown.action' }, 'STEP_UP_ENFORCED_ACTIONS'],
    [{ ...valid, STEP_UP_ENFORCED_ACTIONS: 'user.status.update,user.status.update' }, 'STEP_UP_ENFORCED_ACTIONS'],
    [{ ...valid, STEP_UP_MODE: 'enforce', STEP_UP_ENFORCED_ACTIONS: 'model.route.update' }, 'unattached'],
    [{ ...valid, STORAGE_CAPACITY_MAX_STALENESS_SECONDS: '0' }, 'STORAGE_CAPACITY_MAX_STALENESS_SECONDS'],
    [{ ...valid, XLS_CONVERTER_TIMEOUT_MS: '999' }, 'XLS_CONVERTER_TIMEOUT_MS'],
    [{ ...valid, XLS_CONVERTER_MAX_OUTPUT_MB: '101' }, 'XLS_CONVERTER_MAX_OUTPUT_MB']
  ])('rejects an invalid required setting', (environment, expectedMessage) => {
    expect(() => validateEnvironment(environment)).toThrow(expectedMessage);
  });

  it('fails closed to disabled retention and permits only an explicit dry-run', () => {
    expect(validateEnvironment({ ...valid })).toMatchObject(valid);
    expect(validateEnvironment({ ...valid, DATA_RETENTION_MODE: 'dry-run' })).toMatchObject({
      DATA_RETENTION_MODE: 'dry-run'
    });
  });

  it('allows only an explicitly classified local compatible provider or an external OpenAI provider', () => {
    expect(validateEnvironment({
      ...valid,
      AI_PROVIDER: 'openai_compatible',
      AI_PROVIDER_CLASS: 'local'
    })).toMatchObject({ AI_PROVIDER_CLASS: 'local' });
    expect(() => validateEnvironment({
      ...valid,
      AI_PROVIDER: 'openai',
      AI_PROVIDER_CLASS: 'local'
    })).toThrow('AI_PROVIDER=openai');
  });

  it('keeps step-up enforcement disabled until registered actions are explicit', () => {
    expect(validateEnvironment({ ...valid })).toMatchObject(valid);
    expect(validateEnvironment({
      ...valid,
      STEP_UP_MODE: 'enforce',
      STEP_UP_TTL_SECONDS: '60',
      STEP_UP_ENFORCED_ACTIONS: 'user.status.update,user.password.reset'
    })).toMatchObject({ STEP_UP_MODE: 'enforce' });
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
    expect(() => validateEnvironment({
      ...valid,
      ...productionRequired,
      NODE_ENV: 'production',
      FILE_SCAN_MODE: 'clamav'
    })).toThrow('CORS_ORIGINS');
  });

  it('requires production ClamAV, verified remote PostgreSQL TLS, short JWTs, and named proxies', () => {
    const production = {
      ...valid,
      ...productionRequired,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://finance-agent.example.com',
      FILE_SCAN_MODE: 'clamav',
      JWT_EXPIRES_IN: '30m'
    };
    expect(() => validateEnvironment({
      ...production,
      DATABASE_URL: 'postgresql://finance:secret@db.example.com:5432/finance_agent'
    })).toThrow('sslmode=verify-ca');
    expect(() => validateEnvironment({ ...production, FILE_SCAN_MODE: 'basic' })).toThrow('FILE_SCAN_MODE');
    expect(() => validateEnvironment({ ...production, JWT_EXPIRES_IN: '8h' })).toThrow('must not exceed 1h');
    expect(() => validateEnvironment({ ...production, TRUST_PROXY_HOPS: '1' })).toThrow('TRUSTED_PROXIES');
    expect(validateEnvironment({
      ...production,
      DATABASE_URL: 'postgresql://finance:secret@db.example.com:5432/finance_agent?sslmode=verify-full',
      TRUSTED_PROXIES: '127.0.0.1'
    })).toMatchObject({ NODE_ENV: 'production' });
  });

  it('requires split runtime, private object storage, Redis, and metrics credentials in production', () => {
    const production = {
      ...valid,
      ...productionRequired,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://finance-agent.example.com',
      FILE_SCAN_MODE: 'clamav',
      JWT_EXPIRES_IN: '30m'
    };
    expect(() => validateEnvironment({ ...production, PROCESS_ROLE: 'all' })).toThrow('PROCESS_ROLE');
    expect(() => validateEnvironment({ ...production, FILE_STORAGE_DRIVER: 'local' })).toThrow('FILE_STORAGE_DRIVER');
    expect(() => validateEnvironment({ ...production, S3_LOGICAL_QUOTA_BYTES: '' })).toThrow('S3_LOGICAL_QUOTA_BYTES');
    expect(() => validateEnvironment({
      ...production,
      S3_LOGICAL_QUOTA_BYTES: '',
      S3_CAPACITY_BYTES: '1099511627776'
    })).toThrow('not physical capacity');
    expect(() => validateEnvironment({ ...production, REQUEST_RATE_LIMIT_STORE: 'memory' })).toThrow('REQUEST_RATE_LIMIT_STORE');
    expect(() => validateEnvironment({ ...production, METRICS_TOKEN: '' })).toThrow('METRICS_TOKEN');
  });

  it('rejects ambiguous environments and low-entropy secrets', () => {
    expect(() => validateEnvironment({ ...valid, NODE_ENV: 'Production' })).toThrow('NODE_ENV');
    expect(() => validateEnvironment({ ...valid, JWT_SECRET: 'a'.repeat(64) })).toThrow('JWT_SECRET');
  });
});
