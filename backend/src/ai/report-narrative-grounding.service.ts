import { BadGatewayException, Injectable } from '@nestjs/common';

import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import { CanonicalReportSnapshot } from '../reports/report-snapshot.contract';
import { ReportNarrativeOutput } from './ai-suggestion.schemas';

const UNSUPPORTED_INFERENCE_PATTERN = /因为|由于|导致|预计|预测|推测|可能是|建议|应该|必然|归因|原因是|\b(?:because|due\s+to|caused?|forecast|predict(?:ed|ion)?|recommend(?:ed|ation)?|probably|likely)\b/iu;
const COMPARISON_PATTERN = /同比|环比|增加|下降|高于|低于|较上|相比|\b(?:year[-\s]over[-\s]year|month[-\s]over[-\s]month|increas(?:e|ed)|decreas(?:e|ed)|higher\s+than|lower\s+than|compared\s+with)\b/iu;
const NUMERIC_TOKEN_PATTERN = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;

export type GroundedReportClaim = ReportNarrativeOutput['claims'][number] & {
  sourceValueHash: string;
};

export type ReportClaimCatalogItem = ReportNarrativeOutput['claims'][number];

@Injectable()
export class ReportNarrativeGroundingService {
  validate(snapshot: CanonicalReportSnapshot, output: ReportNarrativeOutput) {
    if (output.snapshotId !== snapshot.snapshotId) this.reject('snapshot id does not match immutable input');
    if (output.title !== this.expectedTitle(snapshot.reportType)) this.reject('title is not the server-approved report title');
    if (UNSUPPORTED_INFERENCE_PATTERN.test(this.bodyText(output))) {
      this.reject('narrative contains an unsupported inference or recommendation');
    }
    if (COMPARISON_PATTERN.test(this.bodyText(output))
      || output.claims.some((claim) => claim.claimType === 'COMPARISON')) {
      this.reject('comparison language is unavailable without an explicit comparison fact');
    }

    const catalog = new Map(this.claimCatalog(snapshot).map((claim) => [claim.sourcePath, claim]));
    const seenPaths = new Set<string>();
    const groundedClaims: GroundedReportClaim[] = [];
    for (const claim of output.claims) {
      if (seenPaths.has(claim.sourcePath)) this.reject(`duplicate source path: ${claim.sourcePath}`);
      seenPaths.add(claim.sourcePath);
      const expected = catalog.get(claim.sourcePath);
      if (!expected) this.reject(`source path is not in the server claim catalog: ${claim.sourcePath}`);
      if (claim.claimId !== expected.claimId) this.reject(`claim id does not match source path: ${claim.sourcePath}`);
      if (claim.claimType !== expected.claimType) this.reject(`claim type does not match source path: ${claim.sourcePath}`);
      if (claim.value !== expected.value) this.reject(`claim value does not match source path: ${claim.sourcePath}`);
      this.assertClaimHasNoUngroundedNumbers(claim);
      if (claim.text !== expected.text) this.reject(`claim text does not match the server claim catalog: ${claim.sourcePath}`);
      groundedClaims.push({
        ...claim,
        sourceValueHash: canonicalJsonSha256({ sourcePath: claim.sourcePath, value: expected.value })
      });
    }
    this.assertSummaryHasNoUngroundedNumbers(output);

    const expectedWarningPaths = new Set(snapshot.warnings.map((_warning, index) => `/warnings/${index}`));
    if (!this.sameSet(new Set(output.warningPaths), expectedWarningPaths)) {
      this.reject('warning paths do not exactly cover the immutable snapshot warnings');
    }
    for (let index = 0; index < snapshot.warnings.length; index += 1) {
      const path = `/warnings/${index}/message`;
      const warningClaim = groundedClaims.find((claim) => claim.claimType === 'WARNING' && claim.sourcePath === path);
      if (!warningClaim || warningClaim.text !== snapshot.warnings[index].message) {
        this.reject(`snapshot warning is not surfaced exactly: /warnings/${index}`);
      }
    }

    const nonWarningClaims = groundedClaims.filter((claim) => claim.claimType !== 'WARNING');
    if (!nonWarningClaims.some((claim) => claim.text === output.summary)) {
      this.reject('summary must exactly reuse one grounded non-warning claim');
    }
    return { output, groundedClaims };
  }

  claimCatalog(snapshot: CanonicalReportSnapshot): ReportClaimCatalogItem[] {
    const claims: ReportClaimCatalogItem[] = [
      this.catalogClaim('period-start', 'DATE', `报告期开始日期为 ${snapshot.period.start}。`, '/period/start', snapshot.period.start),
      this.catalogClaim(
        'period-end-exclusive',
        'DATE',
        `报告期结束边界为 ${snapshot.period.endExclusive}。`,
        '/period/endExclusive',
        snapshot.period.endExclusive
      ),
      this.catalogClaim(
        'record-count',
        'COUNT',
        `本期确认记录共 ${snapshot.metrics.recordCount} 条。`,
        '/metrics/recordCount',
        String(snapshot.metrics.recordCount)
      )
    ];
    if (snapshot.metrics.currency && snapshot.metrics.income !== null
      && snapshot.metrics.cost !== null && snapshot.metrics.profit !== null) {
      claims.push(
        this.catalogClaim(
          'income',
          'MONEY',
          `确认收入为 ${snapshot.metrics.income} ${snapshot.metrics.currency}。`,
          '/metrics/income',
          snapshot.metrics.income
        ),
        this.catalogClaim(
          'cost',
          'MONEY',
          `确认成本为 ${snapshot.metrics.cost} ${snapshot.metrics.currency}。`,
          '/metrics/cost',
          snapshot.metrics.cost
        ),
        this.catalogClaim(
          'profit',
          'MONEY',
          `确认利润为 ${snapshot.metrics.profit} ${snapshot.metrics.currency}。`,
          '/metrics/profit',
          snapshot.metrics.profit
        )
      );
    }
    snapshot.metrics.byCurrency.forEach((metrics, index) => {
      const prefix = `currency-${index + 1}`;
      const path = `/metrics/byCurrency/${index}`;
      claims.push(
        this.catalogClaim(
          `${prefix}-income`,
          'MONEY',
          `${metrics.currency} 确认收入为 ${metrics.income}。`,
          `${path}/income`,
          metrics.income
        ),
        this.catalogClaim(
          `${prefix}-cost`,
          'MONEY',
          `${metrics.currency} 确认成本为 ${metrics.cost}。`,
          `${path}/cost`,
          metrics.cost
        ),
        this.catalogClaim(
          `${prefix}-profit`,
          'MONEY',
          `${metrics.currency} 确认利润为 ${metrics.profit}。`,
          `${path}/profit`,
          metrics.profit
        ),
        this.catalogClaim(
          `${prefix}-record-count`,
          'COUNT',
          `${metrics.currency} 确认记录共 ${metrics.recordCount} 条。`,
          `${path}/recordCount`,
          String(metrics.recordCount)
        )
      );
    });
    snapshot.warnings.forEach((warning, index) => {
      claims.push(this.catalogClaim(
        `warning-${index + 1}`,
        'WARNING',
        warning.message,
        `/warnings/${index}/message`,
        warning.message
      ));
    });
    return claims;
  }

  private catalogClaim(
    claimId: string,
    claimType: ReportClaimCatalogItem['claimType'],
    text: string,
    sourcePath: string,
    value: string
  ): ReportClaimCatalogItem {
    return { claimId, claimType, text, sourcePath, value };
  }

  private assertClaimHasNoUngroundedNumbers(claim: ReportClaimCatalogItem) {
    const allowed = new Set(this.numericTokens(claim.value));
    for (const token of this.numericTokens(claim.text)) {
      if (!allowed.has(token)) this.reject(`narrative contains an ungrounded numeric token: ${token}`);
    }
  }

  private assertSummaryHasNoUngroundedNumbers(output: ReportNarrativeOutput) {
    const summaryAllowed = new Set(output.claims.flatMap((claim) => this.numericTokens(claim.value)));
    for (const token of this.numericTokens(`${output.title}\n${output.summary}`)) {
      if (!summaryAllowed.has(token)) this.reject(`narrative contains an ungrounded numeric token: ${token}`);
    }
  }

  private numericTokens(value: string) {
    return (value.normalize('NFKC').match(NUMERIC_TOKEN_PATTERN) ?? []).map((token) => token.replaceAll(',', ''));
  }

  private bodyText(output: ReportNarrativeOutput) {
    return [output.title, output.summary, ...output.claims.map((claim) => claim.text)].join('\n');
  }

  private expectedTitle(reportType: CanonicalReportSnapshot['reportType']) {
    if (reportType === 'WEEKLY') return '经营周报';
    if (reportType === 'MONTHLY') return '经营月报';
    return '经营日报';
  }

  private sameSet(first: Set<string>, second: Set<string>) {
    return first.size === second.size && [...first].every((value) => second.has(value));
  }

  private reject(reason: string): never {
    throw new BadGatewayException(`AI report narrative rejected: ${reason}`);
  }
}
