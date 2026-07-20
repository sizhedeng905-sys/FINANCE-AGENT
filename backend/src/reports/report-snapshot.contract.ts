import { ReportSnapshotType } from '@prisma/client';

export const REPORT_SNAPSHOT_SCHEMA_VERSION = 'report-snapshot/1.0';
export const REPORT_QUERY_VERSION = 'confirmed-actual-report/1.0';
export const REPORT_CANONICALIZATION_VERSION = 'report-c14n/1.0';
export const REPORT_RETENTION_CLASS = 'REPORT_AUDIT_PENDING_H14';

export interface ReportSnapshotWarning {
  code: string;
  message: string;
}

export interface ReportCurrencyMetrics {
  currency: string;
  income: string;
  cost: string;
  profit: string;
  recordCount: number;
}

export interface ReportSnapshotMetrics {
  currency: string | null;
  income: string | null;
  cost: string | null;
  profit: string | null;
  recordCount: number;
  byCurrency: ReportCurrencyMetrics[];
}

export interface ReportSnapshotBreakdown extends ReportCurrencyMetrics {
  projectId: string;
  projectName: string;
}

export interface CanonicalReportSnapshot {
  schemaVersion: typeof REPORT_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  reportType: ReportSnapshotType;
  period: {
    start: string;
    endExclusive: string;
    timezone: 'Asia/Shanghai';
  };
  scope: {
    organizationId: 'default';
    scopeType: 'COMPANY' | 'PROJECT' | 'PROJECT_SET';
    projectIds: string[];
  };
  dataPolicy: {
    recordStatus: 'CONFIRMED';
    dataLayer: 'ACTUAL';
    currencies: string[];
    currencyAggregation: 'SEPARATE_BY_CURRENCY';
  };
  metrics: ReportSnapshotMetrics;
  breakdowns: ReportSnapshotBreakdown[];
  warnings: ReportSnapshotWarning[];
  queryVersion: typeof REPORT_QUERY_VERSION;
  dataWatermark: string;
  sourceDigest: string;
  canonicalizationVersion: typeof REPORT_CANONICALIZATION_VERSION;
  snapshotHash: string;
  generatedAt: string;
  retentionClass: typeof REPORT_RETENTION_CLASS;
}

export type ReportSnapshotHashInput = Omit<
  CanonicalReportSnapshot,
  'snapshotId' | 'dataWatermark' | 'snapshotHash' | 'generatedAt'
>;

export function reportSnapshotHashInput(
  snapshot: Omit<CanonicalReportSnapshot, 'snapshotHash'>
): ReportSnapshotHashInput {
  const { snapshotId: _snapshotId, dataWatermark: _dataWatermark, generatedAt: _generatedAt, ...facts } = snapshot;
  return facts;
}
