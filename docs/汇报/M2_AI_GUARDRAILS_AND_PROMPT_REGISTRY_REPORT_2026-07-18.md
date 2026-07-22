# M2 AI Guardrails and Prompt Registry Report

Date: 2026-07-18

Branch: `agent/b8-stable-hardening`

Scope: non-production engineering framework and synthetic/PostgreSQL acceptance

## Status

M2 is `passed` for the engineering framework. This does not assert real-model accuracy, H12 approval for external AI, production readiness, or completion of the empty protected Prompt Catalog source file.

Verified issue closures:

- `M2-STRICT-SCHEMA-001`: strict JSON and request allowlist enforcement;
- `M2-AI-MODE-001`: default-disabled ingestion/report modes, global kill switch and external-provider fail closure;
- `M2-PROMPT-REGISTRY-001`: immutable prompt contracts, content hashes and complete invocation version-vector framework.

Still blocked:

- `M0-INPUT-001`: `docs/ai/FINANCE_AGENT_AI_PROMPT_CATALOG_V0_1.md` is a protected zero-byte user asset, so catalog prose cannot be compared line by line;
- H04-H09/H12/H13/H16: real truth sets, business definitions, external data policy, target infrastructure and final sign-off.

## Implementation

### Strict output boundary

- Strict parser rejects Markdown wrappers, trailing content, duplicate keys, prototype-pollution keys, exponent numbers, excessive bytes/depth/nodes/arrays/strings, control characters, zero-width characters and bidi controls.
- Classification, mapping, template draft, anomaly review, unmapped-field suggestion, report narrative and report fact-check use `additionalProperties: false` schemas.
- Server checks template versions, field keys, evidence refs, transforms, snapshots, claims and source paths against request-local allowlists.
- Model decisions are fixed to `NEEDS_FINANCE_REVIEW`; AI cannot emit an executable approve/commit state.

### Feature and provider policy

- `AI_INGESTION_MODE` and `AI_REPORT_MODE`: `disabled|suggest`, missing defaults to `disabled`.
- `AI_GLOBAL_KILL_SWITCH`: blocks every new AI call before provider dispatch.
- Organization/project/template settings use the most conservative effective mode.
- `AI_EXTERNAL_PROVIDER_MODE`: defaults to `disabled`; `synthetic-only` still rejects real or unknown data pending H12.
- Grounding failure returns an explicit manual path and records the actual provider failure. Silent Mock fallback was removed.

### Prompt Registry

- Reuses `AiPromptVersion`; no parallel prompt table was created.
- Fixed manifest contains `template_draft`, `excel_template_classification`, `excel_column_mapping`, `ocr_document_classification`, `ocr_field_mapping`, `mapping_anomaly_review`, `unmapped_field_suggestion`, `report_narrative` and `report_fact_check`.
- Every invocation composes `finance_core_guard`; legacy boss chat moved to a hashed V2 prompt while V1 remains historical.
- Stored contracts include purpose, input/output schema versions, output schema, provider classes, budget, timeout, redaction version, component refs and SHA-256.
- New calls reject missing, retired, incomplete or hash-drifted versions. Historical retired rows remain readable.

### Complete version vector

`ai-invocation-vector/1.0` freezes source/IR, template and candidate set, Prompt bundle, input/output contracts, Provider/model/config, transform registry, validation rules, mapping profile, redaction, authorization, feature policy and input hash. Output receives a separate content-addressed completion hash.

## Database

Migration: `20260719010000_ai_prompt_registry_contracts`

- Adds Prompt Registry contract columns and JSON/hash/budget/retirement constraints.
- Adds one-active-version-per-key partial unique index and content-hash index.
- Empty install: 30/30 migrations passed.
- Upgrade path: 29 -> 30 passed.
- Seed ran repeatedly in the dedicated `_test` database without drift and populated 11 active executable definitions.

## Test Evidence

| Gate | Result |
| --- | --- |
| Targeted M2 unit | 8/8 suites, 110/110 tests |
| Full backend unit | 44/44 suites, 390/390 tests, 21.512 s |
| Prompt Registry PostgreSQL | 3/3 tests |
| Boss AI PostgreSQL path | 1/1 targeted test |
| Full PostgreSQL integration | 8/8 suites, 87/87 tests, 316.191 s |
| Backend build | passed |
| Prisma validate/generate | passed |
| Migration paths | empty 30/30 and upgrade 29 -> 30 passed |

The full PostgreSQL run included 30,196 and 49,999-row confirmation profiles, OCR/worker recovery, authorization, idempotency, retention and step-up regressions. Expected negative-path storage and HTTP error logs did not fail assertions.

## Next

M3 will reuse `ImportTask/Sheet/Column/Row/FieldSuggestion/MappingProfile`, call AI once per column structure, apply approved mappings deterministically to all rows, add versioned structure fingerprints/profile invalidation, and prevent any failed draft from creating a `BusinessRecord`.
