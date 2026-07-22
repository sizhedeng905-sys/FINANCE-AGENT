import { ReportSnapshotType } from '@prisma/client';

import { ReportNarrativeGroundingService } from '../src/ai/report-narrative-grounding.service';
import { ReportNarrativeOutput } from '../src/ai/ai-suggestion.schemas';
import {
  CanonicalReportSnapshot,
  REPORT_CANONICALIZATION_VERSION,
  REPORT_QUERY_VERSION,
  REPORT_RETENTION_CLASS,
  REPORT_SNAPSHOT_SCHEMA_VERSION
} from '../src/reports/report-snapshot.contract';

function snapshot(): CanonicalReportSnapshot {
  return {
    schemaVersion: REPORT_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: 'snapshot-1',
    reportType: ReportSnapshotType.DAILY,
    period: { start: '2026-07-20', endExclusive: '2026-07-21', timezone: 'Asia/Shanghai' },
    scope: { organizationId: 'default', scopeType: 'PROJECT', projectIds: ['project-1'] },
    dataPolicy: {
      recordStatus: 'CONFIRMED',
      dataLayer: 'ACTUAL',
      currencies: ['CNY'],
      currencyAggregation: 'SEPARATE_BY_CURRENCY'
    },
    metrics: {
      currency: 'CNY',
      income: '1000.10',
      cost: '400.05',
      profit: '600.05',
      recordCount: 3,
      byCurrency: [{ currency: 'CNY', income: '1000.10', cost: '400.05', profit: '600.05', recordCount: 3 }]
    },
    breakdowns: [],
    warnings: [{ code: 'FORMAL_METRIC_POLICY_PENDING', message: '正式经营指标口径仍待人工签字。' }],
    queryVersion: REPORT_QUERY_VERSION,
    dataWatermark: 'postgres:1:2:;source:hash',
    sourceDigest: 'a'.repeat(64),
    canonicalizationVersion: REPORT_CANONICALIZATION_VERSION,
    snapshotHash: 'b'.repeat(64),
    generatedAt: '2026-07-20T00:00:00.000Z',
    retentionClass: REPORT_RETENTION_CLASS
  };
}

function narrative(): ReportNarrativeOutput {
  return {
    schemaVersion: 'report-narrative/1.0',
    snapshotId: 'snapshot-1',
    title: '经营日报',
    summary: '本期确认记录共 3 条。',
    claims: [
      {
        claimId: 'record-count',
        claimType: 'COUNT',
        text: '本期确认记录共 3 条。',
        sourcePath: '/metrics/recordCount',
        value: '3'
      },
      {
        claimId: 'income',
        claimType: 'MONEY',
        text: '确认收入为 1000.10 CNY。',
        sourcePath: '/metrics/income',
        value: '1000.10'
      },
      {
        claimId: 'warning-1',
        claimType: 'WARNING',
        text: '正式经营指标口径仍待人工签字。',
        sourcePath: '/warnings/0/message',
        value: '正式经营指标口径仍待人工签字。'
      }
    ],
    warningPaths: ['/warnings/0'],
    decision: 'NEEDS_FINANCE_REVIEW'
  };
}

describe('ReportNarrativeGroundingService', () => {
  const service = new ReportNarrativeGroundingService();

  it('accepts exact scalar claims and freezes each source value hash', () => {
    const result = service.validate(snapshot(), narrative());
    expect(result.groundedClaims).toHaveLength(3);
    expect(result.groundedClaims.every((claim) => /^[a-f0-9]{64}$/.test(claim.sourceValueHash))).toBe(true);
  });

  it('rejects a model-modified amount', () => {
    const output = narrative();
    output.claims[1].value = '1000.11';
    expect(() => service.validate(snapshot(), output)).toThrow('claim value does not match source path');
  });

  it('rejects hidden snapshot warnings', () => {
    const output = narrative();
    output.warningPaths = [];
    output.claims = output.claims.filter((claim) => claim.claimType !== 'WARNING');
    expect(() => service.validate(snapshot(), output)).toThrow('warning paths do not exactly cover');
  });

  it('rejects an extra ungrounded number even when the source value is also present', () => {
    const output = narrative();
    output.claims[0].text = '本期确认记录共 3 条，另有 999 条未说明。';
    output.summary = output.claims[0].text;
    expect(() => service.validate(snapshot(), output)).toThrow('ungrounded numeric token');
  });

  it('rejects invented entities even when every number is copied from the snapshot', () => {
    const output = narrative();
    output.claims[1].text = '虚构客户贡献确认收入 1000.10 CNY。';
    expect(() => service.validate(snapshot(), output)).toThrow('server claim catalog');
  });

  it('rejects unsupported causal or comparison language', () => {
    const inferred = narrative();
    inferred.claims[0].text = '由于业务增长，本期确认记录共 3 条。';
    inferred.summary = inferred.claims[0].text;
    expect(() => service.validate(snapshot(), inferred)).toThrow('unsupported inference');

    const compared = narrative();
    compared.claims[0].claimType = 'COMPARISON';
    compared.claims[0].text = '本期确认记录共 3 条，较上期增加。';
    compared.summary = compared.claims[0].text;
    expect(() => service.validate(snapshot(), compared)).toThrow('comparison language is unavailable');

    const english = narrative();
    english.claims[0].text = 'Because demand increased, this period has 3 confirmed records.';
    english.summary = english.claims[0].text;
    expect(() => service.validate(snapshot(), english)).toThrow('unsupported inference');
  });
});
