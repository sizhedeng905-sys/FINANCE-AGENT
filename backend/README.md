# FINANCE-AGENT Backend

Phase 0 through phase 8 backend for the logistics AI finance operations system.

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

Update `DATABASE_URL`, `JWT_SECRET`, and `PORT` in `.env` before connecting to PostgreSQL. Then initialize the database:

```bash
npm run prisma:migrate
npm run prisma:seed
```

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
- Work orders: `GET/POST/PATCH /api/work-orders`
- Approval actions: `POST /api/work-orders/:id/{finance-review|reviewer-review|run-rules|boss-approve}`
- Work order timeline and urging: `GET /api/work-orders/:id/timeline`, `POST /api/work-orders/:id/urge`
- File upload/preview/download/void: `/api/files`
- Notifications: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`
- Risk rules and anomalies: `/api/risk-rules`, `/api/reports/anomalies`, `/api/ai/anomalies`
- Reports: `/api/reports/finance`, `/api/reports/boss`, `/api/reports/projects/:projectId/{daily|monthly}`
- Boss AI assistant: `POST /api/ai/chat`
- AI call logs: `GET /api/ai/call-logs`
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

The seed also creates default projects, templates, fields, six risk rules, one pending high-risk work order, and a mock AI provider configuration.

## File Storage

Development uploads are stored below `backend/uploads` and are ignored by Git. `UPLOAD_DIR` and `MAX_FILE_SIZE_MB` are configurable. The API accepts image, PDF, Excel, CSV, and Word files, records SHA-256 metadata, applies work-order authorization, and uses soft deletion.

The storage implementation is isolated in `src/files/local-file-storage.service.ts` so OSS/COS/S3 can replace local storage later. Virus scanning is reserved through `scanStatus`; phase 5 does not include a real antivirus engine.

## AI Provider

No local model or API key is required for acceptance. The default is deterministic structured-data mock mode:

```env
AI_PROVIDER=mock
```

OpenAI Responses API mode:

```env
AI_PROVIDER=openai
AI_MODEL=gpt-5.4-mini
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your-key
```

Local or third-party OpenAI-compatible mode:

```env
AI_PROVIDER=openai_compatible
AI_MODEL=your-model-name
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_API_KEY=
```

The compatible endpoint must implement `POST /chat/completions`. The model never receives database access; the backend selects approved tools and sends only their structured results.

## Phase Scope

Completed:

- Phase 0: runnable NestJS/Prisma backend foundation.
- Phase 1: users, roles, login, JWT current user, finance/boss user management, and audit logs.
- Phase 2: projects, templates, field definitions, template fields, project-enabled templates, project structure, and data center audit logs.
- Phase 3: business records, dynamic record values, manual entry, record confirmation/voiding, and simplified ledger events.
- Phase 4: work orders, role-scoped queries, approval state machine, timeline, approvals, and urging.
- Phase 5: local file uploads, attachment authorization, SHA-256 metadata, soft deletion, and notifications.
- Phase 6: configurable risk rules, rule run results, anomalies, and automatic rule review.
- Phase 7: idempotent work-order record generation and real-time finance/boss/project reports.
- Phase 8: boss-only AI chat, approved structured tools, mock/OpenAI-compatible providers, conversations, messages, prompt versions, and call logs.

Not implemented yet:

- Frontend API modules still default to mock data and require a separate integration pass.
- Excel import (phase 9).
- OCR recognition and human confirmation (phase 10).
- Object storage, antivirus scanning, and production backup jobs.
