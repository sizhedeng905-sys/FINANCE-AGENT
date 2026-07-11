# FINANCE-AGENT Backend

Phase 0 through phase 3 backend for the logistics AI finance operations system.

## Tech Stack

- Node.js + NestJS
- TypeScript
- PostgreSQL
- Prisma
- JWT
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
- Login: `POST /api/auth/login`
- Current user: `GET /api/auth/me`
- Logout: `POST /api/auth/logout`
- User management: `GET/POST/PATCH/DELETE /api/users`
- Projects: `GET/POST/PATCH/DELETE /api/projects`
- Project structure: `GET /api/projects/:id/structure`
- Project summary: `GET /api/projects/:id/summary`
- Project templates: `GET/POST /api/projects/:projectId/templates`
- Project template management: `PATCH /api/project-templates/:id`, `PATCH /api/project-templates/:id/disable`
- Templates: `GET/POST/PATCH/DELETE /api/templates`
- Template clone: `POST /api/templates/:id/clone`
- Template fields: `GET/POST /api/templates/:id/fields`
- Template field management: `PATCH/DELETE /api/template-fields/:id`
- Fields: `GET/POST/PATCH /api/fields`
- Field disable: `PATCH /api/fields/:id/disable`
- Field usage: `GET /api/fields/:id/usage`
- Business records: `GET/POST/PATCH/DELETE /api/records`
- Record confirm: `POST /api/records/:id/confirm`
- Project records: `GET /api/projects/:projectId/records`
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

## Seed Accounts

Run:

```bash
npm run prisma:seed
```

Accounts:

| Username | Password | Role |
| --- | --- | --- |
| `员工` | `123456` | `employee` |
| `财务` | `123456` | `finance` |
| `复核员` | `123456` | `reviewer` |
| `老板` | `123456` | `boss` |
| `employee` | `123456` | `employee` |
| `finance` | `123456` | `finance` |
| `reviewer` | `123456` | `reviewer` |
| `boss` | `123456` | `boss` |

## Phase Scope

Completed:

- Phase 0: runnable NestJS/Prisma backend foundation.
- Phase 1: users, roles, login, JWT current user, finance/boss user management, and audit logs.
- Phase 2: projects, templates, field definitions, template fields, project-enabled templates, project structure, and data center audit logs.
- Phase 3: business records, dynamic record values, manual entry, record confirmation/voiding, and simplified ledger events.

Not implemented yet:

- Work orders
- Attachments
- Approval workflow
- Notifications
- Reports
- AI assistant
- Full raw file ledger and import task event flow
