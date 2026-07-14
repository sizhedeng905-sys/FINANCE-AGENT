const PLACEHOLDER_SECRETS = new Set([
  'development-secret-change-me',
  'replace-with-a-long-random-secret',
  'replace-with-a-different-long-random-test-secret'
]);

const AI_PROVIDERS = new Set(['mock', 'openai', 'openai_compatible']);
const OCR_PROVIDERS = new Set(['mock', 'local_paddle']);

export function validateEnvironment(environment: Record<string, unknown>) {
  const databaseUrl = String(environment.DATABASE_URL ?? '');
  const jwtSecret = String(environment.JWT_SECRET ?? '');
  const port = Number(String(environment.PORT ?? '3001'));
  const aiProvider = String(environment.AI_PROVIDER ?? 'mock');
  const maxFileSizeMb = Number(String(environment.MAX_FILE_SIZE_MB ?? '50'));
  const ocrProvider = String(environment.OCR_PROVIDER ?? 'mock');
  const ocrTimeoutMs = Number(String(environment.OCR_TIMEOUT_MS ?? '30000'));
  const ocrLowConfidenceThreshold = Number(String(environment.OCR_LOW_CONFIDENCE_THRESHOLD ?? '0.8'));
  const ocrMaxPdfPages = Number(String(environment.OCR_MAX_PDF_PAGES ?? '20'));
  const ocrMaxRetries = Number(String(environment.OCR_MAX_RETRIES ?? '2'));
  const modelHttpMaxRetries = Number(String(environment.MODEL_HTTP_MAX_RETRIES ?? '1'));
  const modelCircuitFailureThreshold = Number(String(environment.MODEL_CIRCUIT_FAILURE_THRESHOLD ?? '3'));
  const modelCircuitResetMs = Number(String(environment.MODEL_CIRCUIT_RESET_MS ?? '30000'));
  const modelMaxQueue = Number(String(environment.MODEL_MAX_QUEUE ?? '20'));
  const aiMaxConcurrency = Number(String(environment.AI_MAX_CONCURRENCY ?? '1'));
  const ocrMaxConcurrency = Number(String(environment.OCR_MAX_CONCURRENCY ?? '1'));
  const nodeEnv = String(environment.NODE_ENV ?? 'development');
  const corsOrigins = String(environment.CORS_ORIGINS ?? '');
  const swaggerEnabled = environment.SWAGGER_ENABLED;
  const trustProxyHops = Number(String(environment.TRUST_PROXY_HOPS ?? '0'));
  const requestRateLimitWindowMs = Number(String(environment.REQUEST_RATE_LIMIT_WINDOW_MS ?? '60000'));
  const requestRateLimitMax = Number(String(environment.REQUEST_RATE_LIMIT_MAX ?? '600'));

  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (jwtSecret.length < 32 || PLACEHOLDER_SECRETS.has(jwtSecret)) {
    throw new Error('JWT_SECRET must be a non-placeholder secret of at least 32 characters.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  if (!AI_PROVIDERS.has(aiProvider)) {
    throw new Error(`AI_PROVIDER must be one of: ${Array.from(AI_PROVIDERS).join(', ')}.`);
  }
  if (!Number.isInteger(maxFileSizeMb) || maxFileSizeMb < 1 || maxFileSizeMb > 50) {
    throw new Error('MAX_FILE_SIZE_MB must be an integer between 1 and 50.');
  }
  if (!OCR_PROVIDERS.has(ocrProvider)) {
    throw new Error(`OCR_PROVIDER must be one of: ${Array.from(OCR_PROVIDERS).join(', ')}.`);
  }
  if (!Number.isInteger(ocrTimeoutMs) || ocrTimeoutMs < 100 || ocrTimeoutMs > 300000) {
    throw new Error('OCR_TIMEOUT_MS must be an integer between 100 and 300000.');
  }
  if (!Number.isFinite(ocrLowConfidenceThreshold) || ocrLowConfidenceThreshold <= 0 || ocrLowConfidenceThreshold > 1) {
    throw new Error('OCR_LOW_CONFIDENCE_THRESHOLD must be greater than 0 and at most 1.');
  }
  if (!Number.isInteger(ocrMaxPdfPages) || ocrMaxPdfPages < 1 || ocrMaxPdfPages > 200) {
    throw new Error('OCR_MAX_PDF_PAGES must be an integer between 1 and 200.');
  }
  if (!Number.isInteger(ocrMaxRetries) || ocrMaxRetries < 0 || ocrMaxRetries > 10) {
    throw new Error('OCR_MAX_RETRIES must be an integer between 0 and 10.');
  }
  if (!Number.isInteger(modelHttpMaxRetries) || modelHttpMaxRetries < 0 || modelHttpMaxRetries > 5) {
    throw new Error('MODEL_HTTP_MAX_RETRIES must be an integer between 0 and 5.');
  }
  if (!Number.isInteger(modelCircuitFailureThreshold) || modelCircuitFailureThreshold < 1 || modelCircuitFailureThreshold > 20) {
    throw new Error('MODEL_CIRCUIT_FAILURE_THRESHOLD must be an integer between 1 and 20.');
  }
  if (!Number.isInteger(modelCircuitResetMs) || modelCircuitResetMs < 1000 || modelCircuitResetMs > 600000) {
    throw new Error('MODEL_CIRCUIT_RESET_MS must be an integer between 1000 and 600000.');
  }
  if (!Number.isInteger(modelMaxQueue) || modelMaxQueue < 1 || modelMaxQueue > 1000) {
    throw new Error('MODEL_MAX_QUEUE must be an integer between 1 and 1000.');
  }
  if (!Number.isInteger(aiMaxConcurrency) || aiMaxConcurrency < 1 || aiMaxConcurrency > 32) {
    throw new Error('AI_MAX_CONCURRENCY must be an integer between 1 and 32.');
  }
  if (!Number.isInteger(ocrMaxConcurrency) || ocrMaxConcurrency < 1 || ocrMaxConcurrency > 32) {
    throw new Error('OCR_MAX_CONCURRENCY must be an integer between 1 and 32.');
  }
  if (nodeEnv === 'production' && !corsOrigins.trim()) {
    throw new Error('CORS_ORIGINS is required in production.');
  }
  if (corsOrigins && corsOrigins.split(',').some((origin) => {
    const value = origin.trim();
    if (!value) return true;
    try {
      const url = new URL(value);
      return !['http:', 'https:'].includes(url.protocol) || url.origin !== value.replace(/\/$/, '');
    } catch {
      return true;
    }
  })) {
    throw new Error('CORS_ORIGINS must contain comma-separated HTTP(S) origins without paths.');
  }
  if (swaggerEnabled !== undefined && !['true', 'false', true, false].includes(swaggerEnabled as never)) {
    throw new Error('SWAGGER_ENABLED must be true or false.');
  }
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 5.');
  }
  if (!Number.isInteger(requestRateLimitWindowMs) || requestRateLimitWindowMs < 1000 || requestRateLimitWindowMs > 3600000) {
    throw new Error('REQUEST_RATE_LIMIT_WINDOW_MS must be an integer between 1000 and 3600000.');
  }
  if (!Number.isInteger(requestRateLimitMax) || requestRateLimitMax < 10 || requestRateLimitMax > 100000) {
    throw new Error('REQUEST_RATE_LIMIT_MAX must be an integer between 10 and 100000.');
  }

  return environment;
}
