export const RETENTION_POLICY_VERSION = 'retention-framework/1.0-pending-h14';
export const RETENTION_EVIDENCE_SCHEMA_VERSION = 'retention-dry-run/1.0';
export const RETENTION_MODE_DISABLED_REASON = 'DATA_RETENTION_DISABLED_PENDING_H12_H14';

export const RETENTION_RESOURCE_TYPES = [
  'ai_message',
  'ai_call_log',
  'ai_call_attempt',
  'ai_task',
  'ocr_task',
  'import_task',
  'notification',
  'idempotency_key',
  'audit_log',
  'ledger_event'
] as const;

export type RetentionResourceType = (typeof RETENTION_RESOURCE_TYPES)[number];
