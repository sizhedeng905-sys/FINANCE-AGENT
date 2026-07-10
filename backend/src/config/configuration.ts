export default () => ({
  port: Number.parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-me',
  databaseUrl: process.env.DATABASE_URL ?? ''
});
