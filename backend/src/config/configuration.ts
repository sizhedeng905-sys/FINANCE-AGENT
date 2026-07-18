export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  processRole: process.env.PROCESS_ROLE || 'all',
  host: process.env.HOST || '127.0.0.1',
  port: Number.parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || (process.env.NODE_ENV === 'production' ? '30m' : '8h'),
  jwtIssuer: process.env.JWT_ISSUER || 'finance-agent',
  jwtAudience: process.env.JWT_AUDIENCE || 'finance-agent-api',
  jwtAlgorithm: process.env.JWT_ALGORITHM || 'HS256',
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  uploadQuarantineDir: process.env.UPLOAD_QUARANTINE_DIR || '.upload-quarantine',
  maxFileSizeMb: Number.parseInt(process.env.MAX_FILE_SIZE_MB ?? '10', 10),
  uploadAdmission: {
    maxConcurrentPerUser: Number.parseInt(process.env.UPLOAD_MAX_CONCURRENT_PER_USER ?? '5', 10),
    maxInFlightMbPerUser: Number.parseInt(process.env.UPLOAD_MAX_INFLIGHT_MB_PER_USER ?? '260', 10),
    rateWindowMs: Number.parseInt(process.env.UPLOAD_RATE_WINDOW_MS ?? '60000', 10),
    rateMaxPerUser: Number.parseInt(process.env.UPLOAD_RATE_MAX_PER_USER ?? '60', 10)
  },
  uploadQuarantineMaxAgeMs: Number.parseInt(process.env.UPLOAD_QUARANTINE_MAX_AGE_MS ?? '3600000', 10),
  fileQuotas: {
    userMb: Number.parseInt(process.env.FILE_USER_QUOTA_MB ?? '500', 10),
    projectMb: Number.parseInt(process.env.FILE_PROJECT_QUOTA_MB ?? '5000', 10),
    minimumFreeMb: Number.parseInt(process.env.FILE_MINIMUM_FREE_MB ?? '1024', 10)
  },
  storage: {
    driver: process.env.FILE_STORAGE_DRIVER || 'local',
    capacityMaxStalenessSeconds: Number.parseInt(process.env.STORAGE_CAPACITY_MAX_STALENESS_SECONDS ?? '60', 10),
    s3: {
      endpoint: process.env.S3_ENDPOINT || '',
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET || '',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === undefined
        ? true
        : process.env.S3_FORCE_PATH_STYLE === 'true',
      logicalQuotaBytes: process.env.S3_LOGICAL_QUOTA_BYTES || '',
      presignedUrlTtlSeconds: Number.parseInt(process.env.S3_PRESIGNED_URL_TTL_SECONDS ?? '60', 10)
    }
  },
  fileScan: {
    mode: process.env.FILE_SCAN_MODE || 'basic',
    clamavHost: process.env.CLAMAV_HOST || '127.0.0.1',
    clamavPort: Number.parseInt(process.env.CLAMAV_PORT ?? '3310', 10),
    timeoutMs: Number.parseInt(process.env.FILE_SCAN_TIMEOUT_MS ?? '15000', 10)
  },
  fileLimits: {
    imageMaxWidth: Number.parseInt(process.env.FILE_IMAGE_MAX_WIDTH ?? '20000', 10),
    imageMaxHeight: Number.parseInt(process.env.FILE_IMAGE_MAX_HEIGHT ?? '20000', 10),
    imageMaxPixels: Number.parseInt(process.env.FILE_IMAGE_MAX_PIXELS ?? '100000000', 10),
    imageMaxDecodedMb: Number.parseInt(process.env.FILE_IMAGE_MAX_DECODED_MB ?? '400', 10),
    pdfMaxPages: Number.parseInt(process.env.FILE_PDF_MAX_PAGES ?? '200', 10),
    pdfMaxObjects: Number.parseInt(process.env.FILE_PDF_MAX_OBJECTS ?? '100000', 10),
    parseTimeoutMs: Number.parseInt(process.env.FILE_PARSE_TIMEOUT_MS ?? '5000', 10)
  },
  xlsConverter: {
    timeoutMs: Number.parseInt(process.env.XLS_CONVERTER_TIMEOUT_MS ?? '30000', 10),
    maxOutputMb: Number.parseInt(process.env.XLS_CONVERTER_MAX_OUTPUT_MB ?? '50', 10)
  },
  importConfirmation: {
    batchSize: Number.parseInt(process.env.IMPORT_CONFIRM_BATCH_SIZE ?? '500', 10),
    leaseMs: Number.parseInt(process.env.IMPORT_CONFIRM_LEASE_MS ?? '60000', 10),
    maxAttempts: Number.parseInt(process.env.IMPORT_CONFIRM_MAX_ATTEMPTS ?? '3', 10)
  },
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:4173,http://127.0.0.1:4174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  swaggerEnabled: process.env.SWAGGER_ENABLED === undefined
    ? process.env.NODE_ENV !== 'production'
    : process.env.SWAGGER_ENABLED === 'true',
  trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10),
  trustedProxies: (process.env.TRUSTED_PROXIES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  requestRateLimit: {
    store: process.env.REQUEST_RATE_LIMIT_STORE || 'memory',
    windowMs: Number.parseInt(process.env.REQUEST_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    max: Number.parseInt(process.env.REQUEST_RATE_LIMIT_MAX ?? '600', 10)
  },
  redis: {
    url: process.env.REDIS_URL || '',
    required: process.env.NODE_ENV === 'production' || process.env.REQUEST_RATE_LIMIT_STORE === 'redis',
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'finance-agent',
    connectTimeoutMs: Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS ?? '5000', 10)
  },
  worker: {
    pollIntervalMs: Number.parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? '5000', 10),
    heartbeatIntervalMs: Number.parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? '5000', 10),
    heartbeatTtlMs: Number.parseInt(process.env.WORKER_HEARTBEAT_TTL_MS ?? '20000', 10)
  },
  dataRetention: {
    mode: process.env.DATA_RETENTION_MODE || 'disabled',
    batchSize: Number.parseInt(process.env.DATA_RETENTION_BATCH_SIZE ?? '100', 10),
    leaseMs: Number.parseInt(process.env.DATA_RETENTION_LEASE_MS ?? '60000', 10),
    maxAttempts: Number.parseInt(process.env.DATA_RETENTION_MAX_ATTEMPTS ?? '3', 10)
  },
  stepUp: {
    mode: process.env.STEP_UP_MODE || 'disabled',
    ttlSeconds: Number.parseInt(process.env.STEP_UP_TTL_SECONDS ?? '300', 10),
    enforcedActions: (process.env.STEP_UP_ENFORCED_ACTIONS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  },
  metrics: {
    token: process.env.METRICS_TOKEN || ''
  },
  tracing: {
    endpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '',
    serviceName: process.env.OTEL_SERVICE_NAME || 'finance-agent-api',
    batchSize: Number.parseInt(process.env.OTEL_TRACE_BATCH_SIZE ?? '100', 10),
    maxQueue: Number.parseInt(process.env.OTEL_TRACE_MAX_QUEUE ?? '1000', 10),
    flushIntervalMs: Number.parseInt(process.env.OTEL_TRACE_FLUSH_INTERVAL_MS ?? '2000', 10)
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'mock',
    providerClass: process.env.AI_PROVIDER_CLASS
      || ((process.env.AI_PROVIDER || 'mock') === 'mock' ? 'mock' : 'external'),
    ingestionMode: process.env.AI_INGESTION_MODE || 'disabled',
    reportMode: process.env.AI_REPORT_MODE || 'disabled',
    globalKillSwitch: process.env.AI_GLOBAL_KILL_SWITCH === 'true',
    externalProviderMode: process.env.AI_EXTERNAL_PROVIDER_MODE || 'disabled',
    model: process.env.AI_MODEL || 'gpt-5.4-mini',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
    timeoutMs: Number.parseInt(process.env.AI_TIMEOUT_MS ?? '30000', 10),
    maxOutputTokens: Number.parseInt(process.env.AI_MAX_OUTPUT_TOKENS ?? '1200', 10),
    maxResponseBytes: Number.parseInt(process.env.AI_MAX_RESPONSE_BYTES ?? '2097152', 10),
    auditRetentionDays: Number.parseInt(process.env.AI_AUDIT_RETENTION_DAYS ?? '90', 10)
  },
  ocr: {
    provider: process.env.OCR_PROVIDER || 'mock',
    model: process.env.OCR_MODEL || 'mock-ocr-v1',
    modelVersion: process.env.OCR_MODEL_VERSION || '1',
    baseUrl: process.env.OCR_BASE_URL || 'http://127.0.0.1:8868',
    apiKey: process.env.OCR_API_KEY || '',
    timeoutMs: Number.parseInt(process.env.OCR_TIMEOUT_MS ?? '30000', 10),
    lowConfidenceThreshold: Number(process.env.OCR_LOW_CONFIDENCE_THRESHOLD ?? '0.8'),
    maxPdfPages: Number.parseInt(process.env.OCR_MAX_PDF_PAGES ?? '20', 10),
    maxRetries: Number.parseInt(process.env.OCR_MAX_RETRIES ?? '2', 10),
    processingLeaseMs: Number.parseInt(process.env.OCR_PROCESSING_LEASE_MS ?? '90000', 10),
    recoveryIntervalMs: Number.parseInt(process.env.OCR_RECOVERY_INTERVAL_MS ?? '5000', 10),
    maxResponseBytes: Number.parseInt(process.env.OCR_MAX_RESPONSE_BYTES ?? '2097152', 10)
  },
  modelRuntime: {
    httpMaxRetries: Number.parseInt(process.env.MODEL_HTTP_MAX_RETRIES ?? '1', 10),
    circuitFailureThreshold: Number.parseInt(process.env.MODEL_CIRCUIT_FAILURE_THRESHOLD ?? '3', 10),
    circuitResetMs: Number.parseInt(process.env.MODEL_CIRCUIT_RESET_MS ?? '30000', 10),
    maxQueue: Number.parseInt(process.env.MODEL_MAX_QUEUE ?? '20', 10),
    aiMaxConcurrency: Number.parseInt(process.env.AI_MAX_CONCURRENCY ?? '1', 10),
    ocrMaxConcurrency: Number.parseInt(process.env.OCR_MAX_CONCURRENCY ?? '1', 10)
  }
});
