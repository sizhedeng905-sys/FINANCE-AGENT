const PLACEHOLDER_SECRETS = new Set([
  'development-secret-change-me',
  'replace-with-a-long-random-secret',
  'replace-with-a-different-long-random-test-secret'
]);

const AI_PROVIDERS = new Set(['mock', 'openai', 'openai_compatible']);
const OCR_PROVIDERS = new Set(['mock', 'local_paddle']);
const NODE_ENVIRONMENTS = new Set(['development', 'test', 'production']);
const FILE_SCAN_MODES = new Set(['basic', 'clamav']);

export function validateEnvironment(environment: Record<string, unknown>) {
  const databaseUrl = String(environment.DATABASE_URL ?? '');
  const jwtSecret = String(environment.JWT_SECRET ?? '');
  const host = String(environment.HOST ?? '127.0.0.1');
  const port = Number(String(environment.PORT ?? '3001'));
  const jwtExpiresIn = String(environment.JWT_EXPIRES_IN ?? (environment.NODE_ENV === 'production' ? '30m' : '8h'));
  const aiProvider = String(environment.AI_PROVIDER ?? 'mock');
  const maxFileSizeMb = Number(String(environment.MAX_FILE_SIZE_MB ?? '10'));
  const fileUserQuotaMb = Number(String(environment.FILE_USER_QUOTA_MB ?? '500'));
  const fileProjectQuotaMb = Number(String(environment.FILE_PROJECT_QUOTA_MB ?? '5000'));
  const fileMinimumFreeMb = Number(String(environment.FILE_MINIMUM_FREE_MB ?? '1024'));
  const fileScanMode = String(environment.FILE_SCAN_MODE ?? 'basic');
  const clamavHost = String(environment.CLAMAV_HOST ?? '127.0.0.1');
  const clamavPort = Number(String(environment.CLAMAV_PORT ?? '3310'));
  const fileScanTimeoutMs = Number(String(environment.FILE_SCAN_TIMEOUT_MS ?? '15000'));
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
  const trustedProxies = String(environment.TRUSTED_PROXIES ?? '');
  const aiMaxOutputTokens = Number(String(environment.AI_MAX_OUTPUT_TOKENS ?? '1200'));
  const aiMaxResponseBytes = Number(String(environment.AI_MAX_RESPONSE_BYTES ?? '2097152'));
  const ocrMaxResponseBytes = Number(String(environment.OCR_MAX_RESPONSE_BYTES ?? '2097152'));

  if (!NODE_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of: ${Array.from(NODE_ENVIRONMENTS).join(', ')}.`);
  }

  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (jwtSecret.length < 32 || PLACEHOLDER_SECRETS.has(jwtSecret) || thisSecretHasLowEntropy(jwtSecret)) {
    throw new Error('JWT_SECRET must be a non-placeholder secret of at least 32 characters.');
  }
  if (!['15m', '30m', '1h', '8h'].includes(jwtExpiresIn)) {
    throw new Error('JWT_EXPIRES_IN must be one of: 15m, 30m, 1h, 8h.');
  }
  if (nodeEnv === 'production' && !['15m', '30m', '1h'].includes(jwtExpiresIn)) {
    throw new Error('JWT_EXPIRES_IN must not exceed 1h in production.');
  }
  if (!/^(?:localhost|[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]|[0-9A-Fa-f:.]+)$/.test(host)) {
    throw new Error('HOST must be a valid bind host or IP address.');
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
  if (!Number.isInteger(fileUserQuotaMb) || fileUserQuotaMb < maxFileSizeMb || fileUserQuotaMb > 100000) {
    throw new Error('FILE_USER_QUOTA_MB must be an integer between MAX_FILE_SIZE_MB and 100000.');
  }
  if (!Number.isInteger(fileProjectQuotaMb) || fileProjectQuotaMb < fileUserQuotaMb || fileProjectQuotaMb > 1000000) {
    throw new Error('FILE_PROJECT_QUOTA_MB must be an integer between FILE_USER_QUOTA_MB and 1000000.');
  }
  if (!Number.isInteger(fileMinimumFreeMb) || fileMinimumFreeMb < 100 || fileMinimumFreeMb > 1000000) {
    throw new Error('FILE_MINIMUM_FREE_MB must be an integer between 100 and 1000000.');
  }
  if (!FILE_SCAN_MODES.has(fileScanMode)) {
    throw new Error(`FILE_SCAN_MODE must be one of: ${Array.from(FILE_SCAN_MODES).join(', ')}.`);
  }
  if (nodeEnv === 'production' && fileScanMode !== 'clamav') {
    throw new Error('FILE_SCAN_MODE must be clamav in production.');
  }
  if (!clamavHost.trim() || /[\s/\\]/.test(clamavHost)) {
    throw new Error('CLAMAV_HOST must be a host name or IP address.');
  }
  if (!Number.isInteger(clamavPort) || clamavPort < 1 || clamavPort > 65535) {
    throw new Error('CLAMAV_PORT must be an integer between 1 and 65535.');
  }
  if (!Number.isInteger(fileScanTimeoutMs) || fileScanTimeoutMs < 100 || fileScanTimeoutMs > 300000) {
    throw new Error('FILE_SCAN_TIMEOUT_MS must be an integer between 100 and 300000.');
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
  if (!Number.isInteger(aiMaxOutputTokens) || aiMaxOutputTokens < 64 || aiMaxOutputTokens > 8192) {
    throw new Error('AI_MAX_OUTPUT_TOKENS must be an integer between 64 and 8192.');
  }
  if (!Number.isInteger(aiMaxResponseBytes) || aiMaxResponseBytes < 1024 || aiMaxResponseBytes > 10485760) {
    throw new Error('AI_MAX_RESPONSE_BYTES must be an integer between 1024 and 10485760.');
  }
  if (!Number.isInteger(ocrMaxResponseBytes) || ocrMaxResponseBytes < 1024 || ocrMaxResponseBytes > 10485760) {
    throw new Error('OCR_MAX_RESPONSE_BYTES must be an integer between 1024 and 10485760.');
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
  if (nodeEnv === 'production' && trustProxyHops > 0) {
    throw new Error('TRUST_PROXY_HOPS is not allowed in production; configure TRUSTED_PROXIES instead.');
  }
  if (trustedProxies && trustedProxies.split(',').some((value) => !/^[A-Za-z0-9.:/-]+$/.test(value.trim()))) {
    throw new Error('TRUSTED_PROXIES must contain comma-separated proxy IPs, host names, or CIDR ranges.');
  }
  if (!Number.isInteger(requestRateLimitWindowMs) || requestRateLimitWindowMs < 1000 || requestRateLimitWindowMs > 3600000) {
    throw new Error('REQUEST_RATE_LIMIT_WINDOW_MS must be an integer between 1000 and 3600000.');
  }
  if (!Number.isInteger(requestRateLimitMax) || requestRateLimitMax < 10 || requestRateLimitMax > 100000) {
    throw new Error('REQUEST_RATE_LIMIT_MAX must be an integer between 10 and 100000.');
  }

  if (nodeEnv === 'production') {
    const parsedDatabaseUrl = new URL(databaseUrl);
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    const sslMode = parsedDatabaseUrl.searchParams.get('sslmode');
    if (!localHosts.has(parsedDatabaseUrl.hostname) && !['verify-ca', 'verify-full'].includes(sslMode ?? '')) {
      throw new Error('Remote production DATABASE_URL must use sslmode=verify-ca or sslmode=verify-full.');
    }
  }

  return environment;
}

function thisSecretHasLowEntropy(secret: string) {
  if (new Set(secret).size < 10 || /(.)\1{7,}/.test(secret)) return true;
  const counts = new Map<string, number>();
  for (const character of secret) counts.set(character, (counts.get(character) ?? 0) + 1);
  const entropy = [...counts.values()].reduce((sum, count) => {
    const probability = count / secret.length;
    return sum - probability * Math.log2(probability);
  }, 0);
  return entropy < 3.5;
}
