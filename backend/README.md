# FINANCE-AGENT Backend

Phase 0 through phase 10 backend for the logistics AI finance operations system.

## Tech Stack

- Node.js + NestJS
- TypeScript
- PostgreSQL
- Prisma
- JWT
- class-validator/class-transformer
- Swagger/OpenAPI
- Helmet, CORS allowlist, request/login rate limiting, requestId logging

## Setup

```bash
cd backend
npm install
copy .env.example .env
npm run prisma:generate
```

Update `DATABASE_URL`, `JWT_SECRET`, `PORT`, and `CORS_ORIGINS` in `.env` before connecting to PostgreSQL. Startup rejects a non-PostgreSQL URL, a missing/placeholder JWT secret, invalid HTTP/runtime limits, or an unsupported Provider. Production requires an explicit CORS allowlist and disables Swagger unless `SWAGGER_ENABLED=true`. Use a random JWT secret of at least 32 characters. Then initialize the database:

```bash
npm run prisma:migrate
npm run prisma:seed
```

## Scripts

```bash
npm run dev
npm run start:e2e
npm run build
npm run start
npm run test
npm run test:integration
npm run prisma:generate
npm run prisma:migrate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run db:verify
npm run model:routes -- list
npm run model:check
npm run model:services:init
npm run model:services:resident
npm run model:services:on-demand -- embedding
npm run model:services:restore
```

Root-level Playwright acceptance uses a dedicated PostgreSQL database:

```bash
cd ..
npm run test:e2e
```

The preparation and cleanup scripts reject database names that do not end in `_test`. See `docs/E2E_ACCEPTANCE.md` for covered role, workflow, file, report, Mock/API, and error scenarios.

## API

- Health checks: `GET /api/health`, `GET /api/health/live`, `GET /api/health/ready`
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
- Excel import tasks: `GET/POST /api/import-tasks`, `POST /api/import-tasks/:id/parse`
- Excel mapping and preview: `PUT /api/import-tasks/:id/mappings`, `GET /api/import-tasks/:id/{rows|errors|preview}`
- Excel confirmation: `POST /api/import-tasks/:id/confirm`; field suggestions: `/api/field-suggestions`
- OCR tasks: `GET/POST /api/ocr-tasks`, `POST /api/ocr-tasks/:id/{run|retry|cancel}`
- OCR human review: `PUT /api/ocr-tasks/:id/corrections`, `POST /api/ocr-tasks/:id/confirm`
- Model runtime metadata: `GET /api/model-runtime/deployments`, `/routes`, `/health`
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

Notification visibility is always derived from the authenticated user: a notification must target that user or the user's role. Read state is stored per user in `notification_receipts`, so one user cannot read a shared role notification on behalf of another. Repeated read and read-all requests are idempotent and do not duplicate audit logs.

Reports are real-time views over confirmed `business_records`. Draft, pending-confirmation, and voided records are excluded; money is aggregated with `Prisma.Decimal`, and day/week/month boundaries use `Asia/Shanghai`. The boss AI report tools call the same `ReportsService` used by the normal report APIs.

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

The seed also creates default projects, templates, fields, six risk rules, one pending high-risk work order, and model deployment/route metadata. Only the deterministic Mock deployment is enabled; local Qwen/Paddle/Embedding deployments remain disabled.

## File Storage

Development uploads are stored below `backend/uploads` and are ignored by Git. `UPLOAD_DIR` is configurable and `MAX_FILE_SIZE_MB` must be between 1 and 50. The API accepts validated image, PDF, Excel, CSV, and Word content, records SHA-256 metadata, limits a work order to 20 active attachments, applies work-order authorization, and uses soft deletion. Employee uploads must target their own editable work order; finance project files support manual records. Files referenced by business records are retained. Object storage and antivirus scanning are not implemented yet.

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

OCR defaults to `OCR_PROVIDER=mock`. The repository now includes a buildable `local_paddle` adapter implementing the provider-neutral HTTP contract. Database model routes select the real AI/OCR providers only after `model:routes enable` passes an authenticated health check. Runtime timeout, retry, circuit breaker, queue, concurrency and deployment instructions are documented in `docs/MODEL_DEPLOYMENT.md`.

## Runtime Security

- `CORS_ORIGINS` is a comma-separated exact-origin allowlist.
- `REQUEST_RATE_LIMIT_WINDOW_MS` / `REQUEST_RATE_LIMIT_MAX` configure global per-IP limits; login failures have a separate 5-attempt/15-minute block.
- `TRUST_PROXY_HOPS` stays `0` unless the reverse-proxy topology is known.
- `/api/health/ready` checks PostgreSQL; `/api/health` remains the phase 0 compatibility probe.
- Structured logs include requestId, path, status, latency and authenticated actor, but not request bodies, Tokens, passwords or Provider keys.
- Use `npm run prisma:migrate:deploy` in deployment and allow NestJS shutdown hooks to close connections.

See `docs/SECURITY.md` and `docs/LOCAL_SETUP.md` for the production gap list and repeatable Windows/cross-platform initialization.

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
- Realization batch A: isolated PostgreSQL dev/test databases, repeatable migrations, guarded seed, and real database integration tests.
- Realization batch B: token revocation, authentication audit/rate limiting, boss account protection, request IDs, and frontend real auth/user APIs.
- Realization batch C: all ordered frontend domains through the boss AI assistant use explicit Mock/API repositories, with no API-to-Mock fallback.
- Realization batch D: guarded PostgreSQL test initialization, 21 integration tests, 9 Playwright E2E tests, deterministic cleanup, and a PostgreSQL CI job.
- Phase 9 / realization batch E: real `.xlsx` parsing, persistent task rows/columns, reusable reviewed mappings, field suggestions, partial-row validation, and idempotent transactional import.
- Phase 10 / realization batch F: provider-neutral OCR tasks, PDF preprocessing checks, field evidence/confidence, human corrections, retry, and idempotent record generation.
- Realization batch G: model deployment/route registry, provider contracts, JSON Schema validation, health checks, timeout/retry/circuit breaker and bounded concurrency.
- Local model runtime follow-up: verified local asset indexes, buildable PaddleOCR-VL adapter, resident Qwen/OCR Compose services, on-demand VL/Embedding switching, and health-gated backend routing.
- Realization batch H: PostgreSQL CI, repository hygiene, security headers, CORS, global rate limiting, readiness, structured logs and delivery documentation.

Not implemented yet:

- Real container startup and accuracy tuning against redacted company documents; the current Windows host still needs WSL 2/Docker installation.
- Qwen3-VL startup until its missing third safetensor shard is downloaded.
- Object storage, antivirus scanning, and production backup jobs.
- Shared/distributed rate limiting, centralized observability, managed secrets and production infrastructure validation.
