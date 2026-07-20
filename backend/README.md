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
- Helmet, CORS allowlist, Redis-backed global request limiting, bounded login/upload/model guards, requestId/traceId logging
- S3-compatible private object storage, ClamAV, Prometheus metrics, OTLP traces
- Split API/Worker production runtime with PostgreSQL durable task leases

## Setup

Use Node.js 22 or newer. Legacy `.xls` conversion relies on the stable Node permission model and refuses to run on older runtimes.

```bash
cd backend
npm install
copy .env.example .env
npm run prisma:generate
```

Update `DATABASE_URL`, `JWT_SECRET`, `PORT`, and `CORS_ORIGINS` in `.env` before connecting to PostgreSQL. Startup rejects a non-PostgreSQL URL, a missing/low-entropy JWT secret, invalid HTTP/runtime limits, or an unsupported Provider. Production additionally requires `PROCESS_ROLE=api|worker`, verified PostgreSQL TLS, an explicit CORS allowlist, named proxies, `FILE_SCAN_MODE=clamav`, S3 storage, authenticated Redis shared limiting, a Metrics token, and an OTLP trace endpoint; Swagger stays disabled unless explicitly enabled. Then initialize the database:

```bash
npm run prisma:migrate
npm run prisma:seed
```

## Scripts

```bash
npm run dev
npm run dev:worker
npm run start:e2e
npm run build
npm run start
npm run start:worker
npm run test
npm run test:integration
npm run prisma:generate
npm run prisma:migrate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run db:verify
npm run realdata:scan
npm run realdata:xls-profile
npm run realdata:resilience
npm run realdata:model-resilience
npm run model:routes -- list
npm run model:check
npm run model:services:init
npm run model:services:resident
npm run model:services:on-demand -- embedding
npm run model:services:restore
npm run model:services:status
npm run model:lock:test
npm run model:switch:acceptance -- vl
npm run model:switch:acceptance -- embedding
npm run model:ocr:acceptance
npm run model:key:rotate
npm run model:config:check
npm run model:sbom
npm run model:cve:offline
npm run proxy:config:check
npm run proxy:boundary:test
npm run uat:init
npm run uat:validate
npm run uat:reconcile
```

Root-level Playwright acceptance uses a dedicated PostgreSQL database:

```bash
cd ..
npm run test:e2e
```

The preparation and cleanup scripts reject database names that do not end in `_test`. See `docs/E2E_ACCEPTANCE.md` for covered role, workflow, file, report, Mock/API, and error scenarios.

Current verification baseline (2026-07-20, M5.1 OCR approval hardening):

- Backend build and Prisma validation pass. Migration-path verification installs all 36 migrations on an empty database and upgrades the 35-migration predecessor to the current schema.
- Jest: 46/46 suites and 403/403 tests.
- M5.1 targeted PostgreSQL integration passes the OCR approval/commit scenario and project-template serialization scenario. The previous full PostgreSQL baseline remains 7/7 suites and 92/92 tests; it has not yet been rerun after M5.1.
- Root Playwright acceptance: 17/17 tests.
- Backend and frontend production builds pass.
- Root and backend production dependency audits report 0 vulnerabilities.
- R7.1 separates AI call metadata from conversation content and adds a bounded, leased, legal-hold-aware retention inventory. It is dry-run only; H12/H14 still block real deletion.
- R7.2 adds session/action/resource-bound single-use step-up grants, atomic replay prevention, identity-change revocation, and a unified high-risk action guard. Enforcement remains disabled until H10 approves the action and MFA/SoD policy.
- Immutable model snapshots, authenticated identity/capability probes, liveness/readiness separation, cross-process GPU switching, hardened model containers, SBOM/CVE scanning, and Nginx upload boundaries pass.
- Live VL and Embedding transitions each admit one concurrent winner, avoid OOM, and restore resident text; live PaddleOCR accepts an authenticated synthetic PDF.
- B8-08 provides an ignored anonymous eight-scenario manifest, `_test`-only cent reconciliation, issue tracking, and blank signoff templates. Blank input correctly remains `awaiting_input / external_unverified`.
- B8-09 adds split API/Worker roles, Redis limiting/heartbeat, S3 storage and signed downloads, W3C/OTLP tracing, an 18-service TLS Staging topology, immutable runtime DB grants, linked backups, restore drills, and application/data/model rollback scripts.
- R4 upgrades linked backups to `backup-manifest/1.0`, streamed per-object SHA-256, database/object reference checks, isolated database/bucket restore, fault injection, and one-time H13/H14 live-restore authorization. Local synthetic object and empty restore paths pass; target Linux restore, formal RPO/RTO, encryption/offsite retention, and live cutover remain `blocked_external`.
- M5.1 makes OCR posting a strict finance command: a second active finance user must submit the current task/review/validation/payload versions, the exact warning acknowledgements, and a required idempotency key. The final transaction rechecks identity, role, project/file/template state, evidence and deterministic validation before freezing the approval snapshot and creating one record, audit entry, and ledger event.
- H-01 through H-16 as applicable, finance L3 reconciliation, reviewed OCR labels, target infrastructure, independent review, and final UAT remain external gates. See `docs/B8_09_STAGING_REPORT.md`.

## API

- Health checks: `GET /api/health`, `GET /api/health/live`, `GET /api/health/ready`
- Authenticated Prometheus metrics: `GET /api/metrics`
- Login: `POST /api/auth/login`
- Current user: `GET /api/auth/me`
- Logout: `POST /api/auth/logout`
- Authentication capabilities and step-up: `GET /api/auth/security-capabilities`, `POST /api/auth/step-up`
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
- File upload/preview/download/void and short signed object download: `/api/files`, `GET /api/files/:id/signed-download`
- Notifications: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`
- Risk rules and anomalies: `/api/risk-rules`, `/api/reports/anomalies`, `/api/ai/anomalies`
- Reports: `/api/reports/finance`, `/api/reports/boss`, `/api/reports/ranking`, `/api/reports/projects/:projectId/{daily|monthly}`
- Boss AI assistant: `POST /api/ai/chat`
- Boss AI conversations: `GET /api/ai/conversations`, `GET /api/ai/conversations/:id/messages`
- Owner-scoped AI call logs: `GET /api/ai/call-logs`, `GET /api/ai/call-logs/:id`
- Auditor-only redacted AI logs: `GET /api/ai/audit/call-logs`, `GET /api/ai/audit/call-logs/:id`
- Excel import tasks: `GET/POST /api/import-tasks`, `POST /api/import-tasks/:id/inspect`, `POST /api/import-tasks/:id/parse`
- Excel mapping and preview: `PUT /api/import-tasks/:id/mappings`, `GET /api/import-tasks/:id/{rows|errors|preview}`
- Excel confirmation: `POST /api/import-tasks/:id/confirm`; field suggestions: `/api/field-suggestions`
- OCR tasks: `GET/POST /api/ocr-tasks`, atomic file/task creation at `POST /api/ocr-tasks/upload`, and `POST /api/ocr-tasks/:id/{run|retry|cancel}`
- OCR human review: `PUT /api/ocr-tasks/:id/corrections`, `POST /api/ocr-tasks/:id/revalidate`, `POST /api/ocr-tasks/:id/confirm`. Confirmation requires expected task/review/validation/payload versions, exact warning IDs, and `Idempotency-Key`; the uploader cannot approve their own task.
- Model runtime metadata: `GET /api/model-runtime/deployments`, `/routes`, `/health`
- Retention inventory: `GET /api/retention/classes`, `GET/POST /api/retention/runs`, `GET/POST /api/retention/legal-holds`
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

Reports are real-time views over confirmed `business_records`. Draft, pending-confirmation, and voided records are excluded; money and explicit project/customer rankings are aggregated with `Prisma.Decimal`, and day/week/month boundaries use `Asia/Shanghai`. Boss AI providers return only strict Claim JSON; the backend validates the complete source tuple and deterministically renders answers from the same `ReportsService` used by normal report APIs.

All accounting amounts in JSON are fixed-decimal strings, not JavaScript numbers. Templates define immutable `accountingDirection`, `primaryAmountFieldId`, and `primaryDateFieldId`; manual entry, work orders, Excel, and OCR use the shared record policy so top-level amount/date and dynamic values cannot diverge.

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
| `admin` | `123456` | `admin` |
| `auditor` | `123456` | `auditor` |

The seed also creates default projects, templates, fields, six risk rules, one pending high-risk work order, and model deployment/route metadata. Only the deterministic Mock deployment is enabled; local Qwen/Paddle/Embedding deployments remain disabled. Seed is intended for deterministic development/test databases and resets seeded account passwords, statuses, and token versions.

## File Storage

Development uploads are stored below `backend/uploads` and are ignored by Git. `UPLOAD_DIR` and `UPLOAD_QUARANTINE_DIR` are configurable. Production requires S3-compatible private storage; the backend can issue audited 30-300 second attachment URLs after resource authorization. `MAX_FILE_SIZE_MB` must be between 1 and 50 and is inclusive; larger uploads return the unified `41301` response. Uploads stream to a private `0700` quarantine directory with `0600` files, are authorized before scanning, and become usable only after a clean result. File, import, and OCR upload routes share per-user concurrency, in-flight byte, and rate admission controls. The API validates images, PDF, OOXML, CSV, Word, and legacy XLS content structurally; rejects active/forged documents and EICAR; limits image decoded memory and PDF pages/objects/time; records SHA-256 metadata; and enforces user/project quotas plus a storage waterline.

S3 mode requires `S3_LOGICAL_QUOTA_BYTES`; the removed `S3_CAPACITY_BYTES` name is rejected because an S3 connectivity probe cannot prove physical free space. Logical admission uses committed, non-voided PostgreSQL file sizes and repeats the decision under a global transaction advisory lock. `GET /api/health/ready` and Prometheus identify the actual capacity source, freshness, limitations, and admission reason. Unknown, stale, estimated, contradictory, unavailable, or reserve-breaching capacity fails closed with `50301` or `50701`. MinIO physical capacity must be monitored independently; the supplied Staging topology scrapes its private v3 cluster-health metrics.

## Staging

The repository root exposes `staging:init`, `staging:check`, `staging:backup-integrity:test`, `staging:lock-images`, `staging:release`, `staging:smoke`, and `staging:rollback`. The 18-service Compose topology keeps PostgreSQL, Redis, MinIO, and ClamAV private; only the TLS gateway binds host ports. See `docs/B8_09_STAGING_RUNBOOK.md` and `docs/R4_BACKUP_RESTORE_INTEGRITY_REPORT_2026-07-18.md` for secret generation, least-privilege restore roles, strong-hash manifests, observability, pilot checks, and rollback safety gates.

`FILE_SCAN_MODE=basic` is limited to development. Production startup requires `FILE_SCAN_MODE=clamav`; pending files return 423, failed files return 409, and infected files return 403 for preview/download/Excel/OCR. Originals are labeled `untrusted_original` and downloaded as `application/octet-stream` attachments with trust and no-sniff headers. Downloads and storage are streamed with backpressure, unreferenced voided files are physically removed, and evidence referenced by records/import/OCR is retained. Startup removes stale quarantine files and reconciles database records with the selected storage adapter. Development can use `LocalFileStorageService`; production requires the private S3-compatible adapter. Real ClamAV, object-storage backup, encryption/retention policy, and restore evidence remain deployment responsibilities.

The production global request limiter uses Redis. Login throttling, upload admission, and model concurrency gates remain process-local in B8-09, so the supplied Staging topology intentionally runs one API and one Worker. Do not scale either role horizontally until those controls are made distributed and their failover behavior is tested.

## Authentication Boundary

Development accepts only `finance_agent_session` / `finance_agent_csrf`; production accepts only `__Host-finance_agent_session` / `__Host-finance_agent_csrf`. Mixed families, duplicate names (including malformed or empty first values), and environment-incompatible names are rejected and cleared. Cookie writes require exact double-submit CSRF matching. JWT verification is fixed to `HS256`, configured issuer/audience, and `typ=access`.

The `admin` role manages privileged accounts. `finance` and `boss` can manage employee accounts only; `reviewer`, `employee`, and `auditor` cannot use user administration. Privileged role, password, and status changes are audited and notify the target user.

Step-up is disabled by default. When H10 approves a concrete action policy, configure only actions reported as `attached` by `GET /api/auth/security-capabilities`:

```env
STEP_UP_MODE=disabled
STEP_UP_TTL_SECONDS=300
STEP_UP_ENFORCED_ACTIONS=
```

`POST /api/auth/step-up` requires the current password plus `action`, `resourceType`, and `resourceId`. The returned token is sent once in `X-Step-Up-Token`; it is bound to the current access-token session and is atomically consumed from PostgreSQL. Role, password, status, delete, and logout changes revoke active grants. Invalid modes, duplicate/unknown actions, and unattached candidates fail application startup. Access tokens issued before the R7.2 `sid` claim require a new login. MFA remains explicitly `reserved/enabled=false`, and self-approval, dual control, break-glass, and formal SoD remain pending H10. See `docs/R7_2_STEP_UP_AND_SOD_FRAMEWORK_REPORT_2026-07-18.md`.

## Retention Boundary

Retention is disabled by default. The only permitted enabled mode is non-destructive inventory:

```env
DATA_RETENTION_MODE=disabled
DATA_RETENTION_BATCH_SIZE=100
DATA_RETENTION_LEASE_MS=60000
DATA_RETENTION_MAX_ATTEMPTS=3
```

Set `DATA_RETENTION_MODE=dry-run` only in a controlled environment to queue bounded inventory jobs. `execute`, unknown modes, `dryRun=false`, and future cutoffs are rejected. PostgreSQL constraints require every R7.1 run to remain a dry-run with `deletedCount=0`. Admin may create runs and legal holds; auditor has read-only access. Legal-hold release, actual retention days, Provider deletion guarantees, backup propagation, and destructive execution remain disabled pending H12/H14. See `docs/R7_1_DATA_RETENTION_DRY_RUN_REPORT_2026-07-18.md`.

New AI call logs use `ai-call-audit/1.0` and store only hashes, sizes, tool names/field names, version metadata, claim counts, and fallback status. Full questions, tool values, and raw Provider responses are not copied into new `AiCallLog` records. Conversation content and OCR/import evidence remain in their dedicated content stores and are not deleted by R7.1.

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

The server loads a bounded persisted conversation history (16 messages / 12,000 characters), isolates conversations by boss user, treats tool data as untrusted content, and caps provider response bytes and output tokens. Conversation and message history APIs are paginated.

OCR defaults to `OCR_PROVIDER=mock`. The repository now includes a buildable `local_paddle` adapter implementing the provider-neutral HTTP contract. Database model routes select the real AI/OCR providers only after `model:routes enable` passes an authenticated health check. Runtime timeout, retry, circuit breaker, queue, concurrency and deployment instructions are documented in `docs/MODEL_DEPLOYMENT.md`.

## Runtime Security

- `CORS_ORIGINS` is a comma-separated exact-origin allowlist.
- Authentication defaults to an HttpOnly, SameSite=Strict session cookie; cookie-authenticated writes require the matching CSRF cookie/header. Bearer authentication remains available for API clients. Production cookie names use the `__Host-` prefix and `Secure`.
- `REQUEST_RATE_LIMIT_WINDOW_MS` / `REQUEST_RATE_LIMIT_MAX` configure global per-IP limits. Login admission atomically limits IP, username, and pair keys, performs dummy password work for unknown users, and expires stale counters.
- Keep `TRUST_PROXY_HOPS=0` for direct access. Production proxying requires exact `TRUSTED_PROXIES` IP/CIDR entries, and the Nest port must not be publicly reachable around the proxy.
- `/api/health/ready` checks PostgreSQL; `/api/health` remains the phase 0 compatibility probe.
- Structured logs include requestId, path, status, latency and authenticated actor, but not request bodies, Tokens, passwords or Provider keys.
- Demo seed rejects production and ambiguous `NODE_ENV` values and requires an explicit database-bound confirmation before resetting demo users.
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
- Phase 9 / realization batch E: real `.xlsx` and isolated legacy `.xls` parsing, persistent task rows/columns, reusable reviewed mappings, field suggestions, historical partial-row validation, and idempotent transactional import. M5.2 will replace partial posting with whole-batch fail-closed approval.
- Phase 10 / realization batch F: provider-neutral OCR tasks, PDF preprocessing checks, field evidence/confidence, human corrections, retry, and idempotent record generation.
- Realization batch G: model deployment/route registry, provider contracts, JSON Schema validation, health checks, timeout/retry/circuit breaker and bounded concurrency.
- Local model runtime follow-up: verified local asset indexes, buildable PaddleOCR-VL adapter, resident Qwen/OCR Compose services, on-demand VL/Embedding switching, and health-gated backend routing.
- Realization batch H: PostgreSQL CI, repository hygiene, security headers, CORS, global rate limiting, readiness, structured logs and delivery documentation.
- PR #2 audit remediation: accounting direction and primary fields, Decimal-string contracts, record/work-order concurrency and snapshots, immutable template versions, fail-closed files, import/OCR leases, atomic OCR upload, AI history and output bounds, anomaly handling, cookie/CSRF authentication, frontend route splitting, and supply-chain CI hardening.
- Real business data B0-B2: read-only anonymous inventory, hardened image/PDF checks, explicit Sheet and 1-3 row header selection, opt-in cached formula results, background recovery, resource-limited `.xls` sanitization with audit/ledger provenance, and an inclusive 50 MiB upload boundary.
- B8-01 to B8-07: terminal-state hardening, persistent idempotency, asynchronous Excel/OCR, strict financial Claim grounding, security boundaries, and an authenticated GPU/model control plane.
- B8-08 engineering preparation: privacy-safe UAT manifests, integer-cent PostgreSQL reconciliation, issue tracking, and non-overwriting human signoff templates; human acceptance remains external.
- B8-09 engineering implementation: split API/Worker runtime, Redis coordination, private S3 storage, PostgreSQL TLS/least privilege, centralized observability, linked backups, restore drills, and guarded application/data/model rollback; target-environment execution remains external.
- M5.1 OCR approval hardening: immutable approval snapshots, stable validation issue IDs, exact warning acknowledgement, uploader self-approval rejection, final transaction authorization, optimistic concurrency, and request-body-bound idempotent posting.

Explicitly deferred by the user:

- Cross-source duplicate-posting policy and idempotency across separate Excel uploads, OCR tasks, and manual retries (audit P1-07).

Completed audit follow-up:

- Background/chunked 5,000-row Excel processing with 4,999/5,000/5,001/30,196-row memory, persistence, cancellation, lease recovery, and uniqueness benchmarks (audit P1-08).
- Complete 5,001/30,196/49,999-row Excel confirmation with BusinessRecord/RecordValue totals, Decimal sums, unique sources, reports, failure recovery, and bounded resource profiles (B8-03).
- Mock and local Paddle OCR UI flows with Decimal strings, concurrency 1/3/5, queue/heartbeat/cancel/restart behavior, actual provider snapshots, and a measured zero-record delta before human confirmation (B8-04).
- Strict AI Claim tuples, explicit project/customer and highest/lowest ranking, 3-project/2-customer API-built PostgreSQL golden data, owner-scoped boss logs, and 72-case Mock/local-Qwen benchmarks (B8-05).
- Owner-scoped AI audit metadata, production Cookie/JWT separation, admin/auditor duties, active-content/resource/DLP gates, and storage reconciliation (B8-06).
- Immutable model deployment hashes, authenticated identity probes, cross-process GPU state transitions, pinned/hardened model images, SPDX/Grype scanning, and the dynamic 50 MiB Nginx boundary (B8-07).
- Legacy `.xls` conversion in a Node.js 22+ permission-model child process; no Excel/COM dependency and no converted artifact at rest.

Deployment or data work still required:

- M5.2 must remove Excel `valid_rows_only` posting. Under H01, every valid business detail row creates one formal record, subtotal/total rows are not posted again, and any blocking or ambiguous row prevents the whole batch from becoming formally visible until finance resolves and revalidates it.
- Finance review of redacted company documents, L3 cent-level reconciliation, and OCR field labels before any production-accuracy claim.
- GPU container startup, 30-minute residency, OOM/latency observation, text/VL/Embedding switching, service recovery, and simultaneous Qwen/OCR inference have been exercised; production monitoring thresholds still need operational ownership.
- Object storage, a running ClamAV service, production backup/restore, and retention jobs.
- Shared/distributed rate limiting, centralized observability, managed secrets and production infrastructure validation.
