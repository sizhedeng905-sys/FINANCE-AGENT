export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number.parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET,
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSizeMb: Number.parseInt(process.env.MAX_FILE_SIZE_MB ?? '50', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:4173,http://127.0.0.1:4174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  swaggerEnabled: process.env.SWAGGER_ENABLED === undefined
    ? process.env.NODE_ENV !== 'production'
    : process.env.SWAGGER_ENABLED === 'true',
  trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10),
  requestRateLimit: {
    windowMs: Number.parseInt(process.env.REQUEST_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    max: Number.parseInt(process.env.REQUEST_RATE_LIMIT_MAX ?? '600', 10)
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'mock',
    model: process.env.AI_MODEL || 'gpt-5.4-mini',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
    timeoutMs: Number.parseInt(process.env.AI_TIMEOUT_MS ?? '30000', 10)
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
    maxRetries: Number.parseInt(process.env.OCR_MAX_RETRIES ?? '2', 10)
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
