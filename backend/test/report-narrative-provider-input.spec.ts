import { ReportSnapshotType } from '@prisma/client';

import { ReportNarrativesService } from '../src/ai/report-narratives.service';
import {
  CanonicalReportSnapshot,
  REPORT_CANONICALIZATION_VERSION,
  REPORT_QUERY_VERSION,
  REPORT_RETENTION_CLASS,
  REPORT_SNAPSHOT_SCHEMA_VERSION
} from '../src/reports/report-snapshot.contract';

function snapshot(reportType: ReportSnapshotType): CanonicalReportSnapshot {
  return {
    schemaVersion: REPORT_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: 'snapshot-provider-input',
    reportType,
    period: { start: '2026-07-24', endExclusive: '2026-07-25', timezone: 'Asia/Shanghai' },
    scope: { organizationId: 'default', scopeType: 'PROJECT', projectIds: ['project-1'] },
    dataPolicy: {
      recordStatus: 'CONFIRMED',
      dataLayer: 'ACTUAL',
      currencies: ['CNY'],
      currencyAggregation: 'SEPARATE_BY_CURRENCY'
    },
    metrics: {
      currency: 'CNY',
      income: '0.00',
      cost: '10045.93',
      profit: '-10045.93',
      recordCount: 2,
      byCurrency: [{
        currency: 'CNY',
        income: '0.00',
        cost: '10045.93',
        profit: '-10045.93',
        recordCount: 2
      }]
    },
    breakdowns: [],
    warnings: [],
    queryVersion: REPORT_QUERY_VERSION,
    dataWatermark: 'postgres:test',
    sourceDigest: 'a'.repeat(64),
    canonicalizationVersion: REPORT_CANONICALIZATION_VERSION,
    snapshotHash: 'b'.repeat(64),
    generatedAt: '2026-07-24T00:00:00.000Z',
    retentionClass: REPORT_RETENTION_CLASS
  };
}

describe('ReportNarrativesService provider input', () => {
  const requiredSummary = '本期确认记录共 2 条。';
  const service = new ReportNarrativesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      claimCatalog: jest.fn(() => [{
        claimId: 'record-count',
        claimType: 'COUNT',
        text: requiredSummary,
        sourcePath: '/metrics/recordCount',
        value: '2'
      }])
    } as never,
    {} as never,
    {} as never
  );

  it.each([
    [ReportSnapshotType.DAILY, '经营日报'],
    [ReportSnapshotType.WEEKLY, '经营周报'],
    [ReportSnapshotType.MONTHLY, '经营月报']
  ])('supplies the exact server title for %s', (reportType, expectedTitle) => {
    const input = (service as unknown as {
      providerInput(value: CanonicalReportSnapshot): Record<string, unknown>;
    }).providerInput(snapshot(reportType));

    expect(input).toMatchObject({
      schemaVersion: 'report-narrative-input/1.2',
      reportType,
      title: expectedTitle,
      requiredSummary,
      decision: 'NEEDS_FINANCE_REVIEW'
    });
  });
});
