const PLACEHOLDER_SECRETS = new Set([
  'development-secret-change-me',
  'replace-with-a-long-random-secret',
  'replace-with-a-different-long-random-test-secret'
]);

const AI_PROVIDERS = new Set(['mock', 'openai', 'openai_compatible']);
const OCR_PROVIDERS = new Set(['mock', 'local_paddle']);
const NODE_ENVIRONMENTS = new Set(['development', 'test', 'production']);
const FILE_SCAN_MODES = new Set(['basic', 'clamav']);
const PROCESS_ROLES = new Set(['api', 'worker', 'all']);
const FILE_STORAGE_DRIVERS = new Set(['local', 's3']);
const RATE_LIMIT_STORES = new Set(['memory', 'redis']);
const DATA_RETENTION_MODES = new Set(['disabled', 'dry-run']);

export function validateEnvironment(environment: Record<string, unknown>) {
  const databaseUrl = String(environment.DATABASE_URL ?? '');
  const jwtSecret = String(environment.JWT_SECRET ?? '');
  const jwtIssuer = String(environment.JWT_ISSUER ?? 'finance-agent');
  const jwtAudience = String(environment.JWT_AUDIENCE ?? 'finance-agent-api');
  const jwtAlgorithm = String(environment.JWT_ALGORITHM ?? 'HS256');
  const host = String(environment.HOST ?? '127.0.0.1');
  const port = Number(String(environment.PORT ?? '3001'));
  const jwtExpiresIn = String(environment.JWT_EXPIRES_IN ?? (environment.NODE_ENV === 'production' ? '30m' : '8h'));
  const aiProvider = String(environment.AI_PROVIDER ?? 'mock');
  const maxFileSizeMb = Number(String(environment.MAX_FILE_SIZE_MB ?? '10'));
  const uploadMaxConcurrentPerUser = Number(String(environment.UPLOAD_MAX_CONCURRENT_PER_USER ?? '5'));
  const uploadMaxInFlightMbPerUser = Number(String(environment.UPLOAD_MAX_INFLIGHT_MB_PER_USER ?? '260'));
  const uploadRateWindowMs = Number(String(environment.UPLOAD_RATE_WINDOW_MS ?? '60000'));
  const uploadRateMaxPerUser = Number(String(environment.UPLOAD_RATE_MAX_PER_USER ?? '60'));
  const uploadQuarantineMaxAgeMs = Number(String(environment.UPLOAD_QUARANTINE_MAX_AGE_MS ?? '3600000'));
  const fileUserQuotaMb = Number(String(environment.FILE_USER_QUOTA_MB ?? '500'));
  const fileProjectQuotaMb = Number(String(environment.FILE_PROJECT_QUOTA_MB ?? '5000'));
  const fileMinimumFreeMb = Number(String(environment.FILE_MINIMUM_FREE_MB ?? '1024'));
  const fileScanMode = String(environment.FILE_SCAN_MODE ?? 'basic');
  const clamavHost = String(environment.CLAMAV_HOST ?? '127.0.0.1');
  const clamavPort = Number(String(environment.CLAMAV_PORT ?? '3310'));
  const fileScanTimeoutMs = Number(String(environment.FILE_SCAN_TIMEOUT_MS ?? '15000'));
  const imageMaxWidth = Number(String(environment.FILE_IMAGE_MAX_WIDTH ?? '20000'));
  const imageMaxHeight = Number(String(environment.FILE_IMAGE_MAX_HEIGHT ?? '20000'));
  const imageMaxPixels = Number(String(environment.FILE_IMAGE_MAX_PIXELS ?? '100000000'));
  const imageMaxDecodedMb = Number(String(environment.FILE_IMAGE_MAX_DECODED_MB ?? '400'));
  const pdfMaxPages = Number(String(environment.FILE_PDF_MAX_PAGES ?? '200'));
  const pdfMaxObjects = Number(String(environment.FILE_PDF_MAX_OBJECTS ?? '100000'));
  const fileParseTimeoutMs = Number(String(environment.FILE_PARSE_TIMEOUT_MS ?? '5000'));
  const xlsConverterTimeoutMs = Number(String(environment.XLS_CONVERTER_TIMEOUT_MS ?? '30000'));
  const xlsConverterMaxOutputMb = Number(String(environment.XLS_CONVERTER_MAX_OUTPUT_MB ?? '50'));
  const importConfirmBatchSize = Number(String(environment.IMPORT_CONFIRM_BATCH_SIZE ?? '500'));
  const importConfirmLeaseMs = Number(String(environment.IMPORT_CONFIRM_LEASE_MS ?? '60000'));
  const importConfirmMaxAttempts = Number(String(environment.IMPORT_CONFIRM_MAX_ATTEMPTS ?? '3'));
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
  const processRole = String(environment.PROCESS_ROLE ?? 'all');
  const fileStorageDriver = String(environment.FILE_STORAGE_DRIVER ?? 'local');
  const s3Endpoint = String(environment.S3_ENDPOINT ?? '');
  const s3Region = String(environment.S3_REGION ?? 'us-east-1');
  const s3Bucket = String(environment.S3_BUCKET ?? '');
  const s3AccessKeyId = String(environment.S3_ACCESS_KEY_ID ?? '');
  const s3SecretAccessKey = String(environment.S3_SECRET_ACCESS_KEY ?? '');
  const s3ForcePathStyle = environment.S3_FORCE_PATH_STYLE ?? 'true';
  const s3LogicalQuotaBytes = String(environment.S3_LOGICAL_QUOTA_BYTES ?? '');
  const legacyS3CapacityBytes = String(environment.S3_CAPACITY_BYTES ?? '');
  const storageCapacityMaxStalenessSeconds = Number(String(environment.STORAGE_CAPACITY_MAX_STALENESS_SECONDS ?? '60'));
  const s3PresignedUrlTtlSeconds = Number(String(environment.S3_PRESIGNED_URL_TTL_SECONDS ?? '60'));
  const corsOrigins = String(environment.CORS_ORIGINS ?? '');
  const swaggerEnabled = environment.SWAGGER_ENABLED;
  const trustProxyHops = Number(String(environment.TRUST_PROXY_HOPS ?? '0'));
  const requestRateLimitWindowMs = Number(String(environment.REQUEST_RATE_LIMIT_WINDOW_MS ?? '60000'));
  const requestRateLimitMax = Number(String(environment.REQUEST_RATE_LIMIT_MAX ?? '600'));
  const requestRateLimitStore = String(environment.REQUEST_RATE_LIMIT_STORE ?? 'memory');
  const redisUrl = String(environment.REDIS_URL ?? '');
  const redisKeyPrefix = String(environment.REDIS_KEY_PREFIX ?? 'finance-agent');
  const redisConnectTimeoutMs = Number(String(environment.REDIS_CONNECT_TIMEOUT_MS ?? '5000'));
  const workerPollIntervalMs = Number(String(environment.WORKER_POLL_INTERVAL_MS ?? '5000'));
  const workerHeartbeatIntervalMs = Number(String(environment.WORKER_HEARTBEAT_INTERVAL_MS ?? '5000'));
  const workerHeartbeatTtlMs = Number(String(environment.WORKER_HEARTBEAT_TTL_MS ?? '20000'));
  const metricsToken = String(environment.METRICS_TOKEN ?? '');
  const traceEndpoint = String(environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? '');
  const traceServiceName = String(environment.OTEL_SERVICE_NAME ?? 'finance-agent-api');
  const traceBatchSize = Number(String(environment.OTEL_TRACE_BATCH_SIZE ?? '100'));
  const traceMaxQueue = Number(String(environment.OTEL_TRACE_MAX_QUEUE ?? '1000'));
  const traceFlushIntervalMs = Number(String(environment.OTEL_TRACE_FLUSH_INTERVAL_MS ?? '2000'));
  const trustedProxies = String(environment.TRUSTED_PROXIES ?? '');
  const aiMaxOutputTokens = Number(String(environment.AI_MAX_OUTPUT_TOKENS ?? '1200'));
  const aiMaxResponseBytes = Number(String(environment.AI_MAX_RESPONSE_BYTES ?? '2097152'));
  const aiAuditRetentionDays = Number(String(environment.AI_AUDIT_RETENTION_DAYS ?? '90'));
  const ocrMaxResponseBytes = Number(String(environment.OCR_MAX_RESPONSE_BYTES ?? '2097152'));
  const dataRetentionMode = String(environment.DATA_RETENTION_MODE ?? 'disabled');
  const dataRetentionBatchSize = Number(String(environment.DATA_RETENTION_BATCH_SIZE ?? '100'));
  const dataRetentionLeaseMs = Number(String(environment.DATA_RETENTION_LEASE_MS ?? '60000'));
  const dataRetentionMaxAttempts = Number(String(environment.DATA_RETENTION_MAX_ATTEMPTS ?? '3'));

  if (!NODE_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of: ${Array.from(NODE_ENVIRONMENTS).join(', ')}.`);
  }
  if (!PROCESS_ROLES.has(processRole)) {
    throw new Error(`PROCESS_ROLE must be one of: ${Array.from(PROCESS_ROLES).join(', ')}.`);
  }
  if (nodeEnv === 'production' && processRole === 'all') {
    throw new Error('PROCESS_ROLE must be api or worker in production.');
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
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(jwtIssuer)) {
    throw new Error('JWT_ISSUER must be a stable identifier between 3 and 128 characters.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(jwtAudience)) {
    throw new Error('JWT_AUDIENCE must be a stable identifier between 3 and 128 characters.');
  }
  if (jwtAlgorithm !== 'HS256') {
    throw new Error('JWT_ALGORITHM must be HS256.');
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
  if (!Number.isInteger(uploadMaxConcurrentPerUser) || uploadMaxConcurrentPerUser < 1 || uploadMaxConcurrentPerUser > 10) {
    throw new Error('UPLOAD_MAX_CONCURRENT_PER_USER must be an integer between 1 and 10.');
  }
  if (!Number.isInteger(uploadMaxInFlightMbPerUser) || uploadMaxInFlightMbPerUser < maxFileSizeMb || uploadMaxInFlightMbPerUser > 1000) {
    throw new Error('UPLOAD_MAX_INFLIGHT_MB_PER_USER must be between MAX_FILE_SIZE_MB and 1000.');
  }
  if (!Number.isInteger(uploadRateWindowMs) || uploadRateWindowMs < 1000 || uploadRateWindowMs > 3600000) {
    throw new Error('UPLOAD_RATE_WINDOW_MS must be an integer between 1000 and 3600000.');
  }
  if (!Number.isInteger(uploadRateMaxPerUser) || uploadRateMaxPerUser < 1 || uploadRateMaxPerUser > 1000) {
    throw new Error('UPLOAD_RATE_MAX_PER_USER must be an integer between 1 and 1000.');
  }
  if (!Number.isInteger(uploadQuarantineMaxAgeMs) || uploadQuarantineMaxAgeMs < 60000 || uploadQuarantineMaxAgeMs > 604800000) {
    throw new Error('UPLOAD_QUARANTINE_MAX_AGE_MS must be between 60000 and 604800000.');
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
  if (!FILE_STORAGE_DRIVERS.has(fileStorageDriver)) {
    throw new Error(`FILE_STORAGE_DRIVER must be one of: ${Array.from(FILE_STORAGE_DRIVERS).join(', ')}.`);
  }
  if (
    !Number.isInteger(storageCapacityMaxStalenessSeconds) ||
    storageCapacityMaxStalenessSeconds < 1 ||
    storageCapacityMaxStalenessSeconds > 3600
  ) {
    throw new Error('STORAGE_CAPACITY_MAX_STALENESS_SECONDS must be an integer between 1 and 3600.');
  }
  if (nodeEnv === 'production' && fileStorageDriver !== 's3') {
    throw new Error('FILE_STORAGE_DRIVER must be s3 in production.');
  }
  if (fileStorageDriver === 's3') {
    if (legacyS3CapacityBytes) {
      throw new Error('S3_CAPACITY_BYTES is not physical capacity; replace it with S3_LOGICAL_QUOTA_BYTES.');
    }
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(s3Endpoint);
    } catch {
      throw new Error('S3_ENDPOINT must be a valid HTTP(S) URL.');
    }
    if (!['http:', 'https:'].includes(parsedEndpoint.protocol) || parsedEndpoint.username || parsedEndpoint.password) {
      throw new Error('S3_ENDPOINT must be an HTTP(S) URL without embedded credentials.');
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(s3Bucket)) {
      throw new Error('S3_BUCKET must be a valid private bucket name.');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(s3Region)) {
      throw new Error('S3_REGION must be a valid region identifier.');
    }
    if (s3AccessKeyId.length < 3 || s3SecretAccessKey.length < 16) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required for S3 storage.');
    }
    if (!['true', 'false', true, false].includes(s3ForcePathStyle as never)) {
      throw new Error('S3_FORCE_PATH_STYLE must be true or false.');
    }
    let logicalQuotaBytes: bigint;
    try {
      logicalQuotaBytes = BigInt(s3LogicalQuotaBytes);
    } catch {
      throw new Error('S3_LOGICAL_QUOTA_BYTES must be a positive integer.');
    }
    if (logicalQuotaBytes < BigInt(fileMinimumFreeMb + maxFileSizeMb) * 1024n * 1024n) {
      throw new Error('S3_LOGICAL_QUOTA_BYTES must exceed the configured minimum reserve and upload size.');
    }
    if (!Number.isInteger(s3PresignedUrlTtlSeconds) || s3PresignedUrlTtlSeconds < 30 || s3PresignedUrlTtlSeconds > 300) {
      throw new Error('S3_PRESIGNED_URL_TTL_SECONDS must be an integer between 30 and 300.');
    }
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
  if (!Number.isInteger(imageMaxWidth) || imageMaxWidth < 1 || imageMaxWidth > 100000) {
    throw new Error('FILE_IMAGE_MAX_WIDTH must be an integer between 1 and 100000.');
  }
  if (!Number.isInteger(imageMaxHeight) || imageMaxHeight < 1 || imageMaxHeight > 100000) {
    throw new Error('FILE_IMAGE_MAX_HEIGHT must be an integer between 1 and 100000.');
  }
  if (!Number.isInteger(imageMaxPixels) || imageMaxPixels < 1 || imageMaxPixels > 1000000000) {
    throw new Error('FILE_IMAGE_MAX_PIXELS must be an integer between 1 and 1000000000.');
  }
  if (!Number.isInteger(imageMaxDecodedMb) || imageMaxDecodedMb < 1 || imageMaxDecodedMb > 4096) {
    throw new Error('FILE_IMAGE_MAX_DECODED_MB must be an integer between 1 and 4096.');
  }
  if (!Number.isInteger(pdfMaxPages) || pdfMaxPages < 1 || pdfMaxPages > 1000) {
    throw new Error('FILE_PDF_MAX_PAGES must be an integer between 1 and 1000.');
  }
  if (!Number.isInteger(pdfMaxObjects) || pdfMaxObjects < 100 || pdfMaxObjects > 1000000) {
    throw new Error('FILE_PDF_MAX_OBJECTS must be an integer between 100 and 1000000.');
  }
  if (!Number.isInteger(fileParseTimeoutMs) || fileParseTimeoutMs < 100 || fileParseTimeoutMs > 300000) {
    throw new Error('FILE_PARSE_TIMEOUT_MS must be an integer between 100 and 300000.');
  }
  if (!Number.isInteger(xlsConverterTimeoutMs) || xlsConverterTimeoutMs < 1000 || xlsConverterTimeoutMs > 300000) {
    throw new Error('XLS_CONVERTER_TIMEOUT_MS must be an integer between 1000 and 300000.');
  }
  if (!Number.isInteger(xlsConverterMaxOutputMb) || xlsConverterMaxOutputMb < 1 || xlsConverterMaxOutputMb > 100) {
    throw new Error('XLS_CONVERTER_MAX_OUTPUT_MB must be an integer between 1 and 100.');
  }
  if (!Number.isInteger(importConfirmBatchSize) || importConfirmBatchSize < 100 || importConfirmBatchSize > 500) {
    throw new Error('IMPORT_CONFIRM_BATCH_SIZE must be an integer between 100 and 500.');
  }
  if (!Number.isInteger(importConfirmLeaseMs) || importConfirmLeaseMs < 10000 || importConfirmLeaseMs > 600000) {
    throw new Error('IMPORT_CONFIRM_LEASE_MS must be an integer between 10000 and 600000.');
  }
  if (!Number.isInteger(importConfirmMaxAttempts) || importConfirmMaxAttempts < 1 || importConfirmMaxAttempts > 10) {
    throw new Error('IMPORT_CONFIRM_MAX_ATTEMPTS must be an integer between 1 and 10.');
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
  if (!Number.isInteger(aiAuditRetentionDays) || aiAuditRetentionDays < 1 || aiAuditRetentionDays > 3650) {
    throw new Error('AI_AUDIT_RETENTION_DAYS must be an integer between 1 and 3650.');
  }
  if (!Number.isInteger(ocrMaxResponseBytes) || ocrMaxResponseBytes < 1024 || ocrMaxResponseBytes > 10485760) {
    throw new Error('OCR_MAX_RESPONSE_BYTES must be an integer between 1024 and 10485760.');
  }
  if (!DATA_RETENTION_MODES.has(dataRetentionMode)) {
    throw new Error('DATA_RETENTION_MODE must be one of: disabled, dry-run. Deletion is pending H12/H14 approval.');
  }
  if (!Number.isInteger(dataRetentionBatchSize) || dataRetentionBatchSize < 1 || dataRetentionBatchSize > 500) {
    throw new Error('DATA_RETENTION_BATCH_SIZE must be an integer between 1 and 500.');
  }
  if (!Number.isInteger(dataRetentionLeaseMs) || dataRetentionLeaseMs < 10000 || dataRetentionLeaseMs > 600000) {
    throw new Error('DATA_RETENTION_LEASE_MS must be an integer between 10000 and 600000.');
  }
  if (!Number.isInteger(dataRetentionMaxAttempts) || dataRetentionMaxAttempts < 1 || dataRetentionMaxAttempts > 10) {
    throw new Error('DATA_RETENTION_MAX_ATTEMPTS must be an integer between 1 and 10.');
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
  if (!RATE_LIMIT_STORES.has(requestRateLimitStore)) {
    throw new Error(`REQUEST_RATE_LIMIT_STORE must be one of: ${Array.from(RATE_LIMIT_STORES).join(', ')}.`);
  }
  if (nodeEnv === 'production' && requestRateLimitStore !== 'redis') {
    throw new Error('REQUEST_RATE_LIMIT_STORE must be redis in production.');
  }
  if (redisUrl) {
    let parsedRedisUrl: URL;
    try {
      parsedRedisUrl = new URL(redisUrl);
    } catch {
      throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL.');
    }
    if (!['redis:', 'rediss:'].includes(parsedRedisUrl.protocol)) {
      throw new Error('REDIS_URL must use redis:// or rediss://.');
    }
    if (nodeEnv === 'production' && !parsedRedisUrl.password) {
      throw new Error('Production REDIS_URL must include authentication.');
    }
  } else if (requestRateLimitStore === 'redis' || nodeEnv === 'production') {
    throw new Error('REDIS_URL is required for Redis-backed runtime services.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{2,63}$/.test(redisKeyPrefix)) {
    throw new Error('REDIS_KEY_PREFIX must be between 3 and 64 safe characters.');
  }
  if (!Number.isInteger(redisConnectTimeoutMs) || redisConnectTimeoutMs < 500 || redisConnectTimeoutMs > 30000) {
    throw new Error('REDIS_CONNECT_TIMEOUT_MS must be an integer between 500 and 30000.');
  }
  if (!Number.isInteger(workerPollIntervalMs) || workerPollIntervalMs < 500 || workerPollIntervalMs > 60000) {
    throw new Error('WORKER_POLL_INTERVAL_MS must be an integer between 500 and 60000.');
  }
  if (!Number.isInteger(workerHeartbeatIntervalMs) || workerHeartbeatIntervalMs < 1000 || workerHeartbeatIntervalMs > 60000) {
    throw new Error('WORKER_HEARTBEAT_INTERVAL_MS must be an integer between 1000 and 60000.');
  }
  if (
    !Number.isInteger(workerHeartbeatTtlMs) ||
    workerHeartbeatTtlMs < workerHeartbeatIntervalMs * 2 ||
    workerHeartbeatTtlMs > 300000
  ) {
    throw new Error('WORKER_HEARTBEAT_TTL_MS must be at least twice the heartbeat interval and at most 300000.');
  }
  if (metricsToken && (metricsToken.length < 32 || thisSecretHasLowEntropy(metricsToken))) {
    throw new Error('METRICS_TOKEN must be a high-entropy secret of at least 32 characters.');
  }
  if (nodeEnv === 'production' && !metricsToken) {
    throw new Error('METRICS_TOKEN is required in production.');
  }
  if (traceEndpoint) {
    let parsedTraceEndpoint: URL;
    try {
      parsedTraceEndpoint = new URL(traceEndpoint);
    } catch {
      throw new Error('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be a valid HTTP(S) URL.');
    }
    if (!['http:', 'https:'].includes(parsedTraceEndpoint.protocol) || parsedTraceEndpoint.username || parsedTraceEndpoint.password) {
      throw new Error('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be an HTTP(S) URL without embedded credentials.');
    }
  } else if (nodeEnv === 'production') {
    throw new Error('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is required in production.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(traceServiceName)) {
    throw new Error('OTEL_SERVICE_NAME must be between 3 and 64 safe characters.');
  }
  if (!Number.isInteger(traceBatchSize) || traceBatchSize < 1 || traceBatchSize > 500) {
    throw new Error('OTEL_TRACE_BATCH_SIZE must be an integer between 1 and 500.');
  }
  if (!Number.isInteger(traceMaxQueue) || traceMaxQueue < traceBatchSize || traceMaxQueue > 10000) {
    throw new Error('OTEL_TRACE_MAX_QUEUE must be between OTEL_TRACE_BATCH_SIZE and 10000.');
  }
  if (!Number.isInteger(traceFlushIntervalMs) || traceFlushIntervalMs < 500 || traceFlushIntervalMs > 30000) {
    throw new Error('OTEL_TRACE_FLUSH_INTERVAL_MS must be an integer between 500 and 30000.');
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
