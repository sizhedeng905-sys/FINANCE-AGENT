export default () => ({
  port: Number.parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-me',
  databaseUrl: process.env.DATABASE_URL ?? '',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSizeMb: Number.parseInt(process.env.MAX_FILE_SIZE_MB ?? '50', 10)
});
