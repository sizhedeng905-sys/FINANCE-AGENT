# FINANCE-AGENT Backend

Phase 0 backend skeleton for the logistics AI finance operations system.

## Tech Stack

- Node.js + NestJS
- TypeScript
- PostgreSQL
- Prisma
- class-validator/class-transformer
- Swagger/OpenAPI

## Setup

```bash
cd backend
npm install
copy .env.example .env
npm run prisma:generate
```

Update `DATABASE_URL`, `JWT_SECRET`, and `PORT` in `.env` before connecting to PostgreSQL.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run test
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

## API

- Health check: `GET /api/health`
- Swagger UI: `/api/docs`

Successful responses use:

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

Errors use the same envelope:

```json
{
  "code": 40001,
  "message": "参数错误",
  "data": {}
}
```

## Phase 0 Scope

This phase only provides the runnable backend foundation. It intentionally does not implement users, auth, projects, work orders, attachments, approvals, reports, AI assistants, audit logs, or ledger events yet.
