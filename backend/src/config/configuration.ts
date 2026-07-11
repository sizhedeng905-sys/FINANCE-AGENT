export default () => ({
  port: Number.parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-me',
  databaseUrl: process.env.DATABASE_URL ?? '',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSizeMb: Number.parseInt(process.env.MAX_FILE_SIZE_MB ?? '50', 10),
  ai: {
    provider: process.env.AI_PROVIDER || 'mock',
    model: process.env.AI_MODEL || 'gpt-5.4-mini',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
    timeoutMs: Number.parseInt(process.env.AI_TIMEOUT_MS ?? '30000', 10)
  }
});
