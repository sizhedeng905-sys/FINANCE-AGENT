import {
  ReportNarrativeReviewCommand,
  ReportNarrativeReviewStage,
  ReportNarrativeReviewStatus
} from '@prisma/client';

import {
  deriveReportNarrativeReviewState,
  reportNarrativeTransition
} from '../src/ai/report-narrative-review-state';

describe('report narrative review state', () => {
  it.each([
    [ReportNarrativeReviewCommand.ACCEPT, ReportNarrativeReviewStatus.NEEDS_BOSS_REVIEW],
    [ReportNarrativeReviewCommand.REQUEST_CHANGES, ReportNarrativeReviewStatus.CHANGES_REQUESTED],
    [ReportNarrativeReviewCommand.REJECT, ReportNarrativeReviewStatus.REJECTED]
  ])('applies finance command %s without changing financial facts', (command, expected) => {
    expect(reportNarrativeTransition(
      ReportNarrativeReviewStage.FINANCE,
      ReportNarrativeReviewStatus.NEEDS_FINANCE_REVIEW,
      command
    )).toMatchObject({ toStatus: expected, reviewVersion: 1 });
  });

  it.each([
    [ReportNarrativeReviewCommand.ACCEPT, ReportNarrativeReviewStatus.ACCEPTED],
    [ReportNarrativeReviewCommand.REQUEST_CHANGES, ReportNarrativeReviewStatus.CHANGES_REQUESTED],
    [ReportNarrativeReviewCommand.REJECT, ReportNarrativeReviewStatus.REJECTED]
  ])('applies boss command %s only after finance acceptance', (command, expected) => {
    expect(reportNarrativeTransition(
      ReportNarrativeReviewStage.BOSS,
      ReportNarrativeReviewStatus.NEEDS_BOSS_REVIEW,
      command
    )).toMatchObject({ toStatus: expected, reviewVersion: 2 });
  });

  it('rejects out-of-order and tampered event histories', () => {
    expect(() => reportNarrativeTransition(
      ReportNarrativeReviewStage.BOSS,
      ReportNarrativeReviewStatus.NEEDS_FINANCE_REVIEW,
      ReportNarrativeReviewCommand.ACCEPT
    )).toThrow('boss narrative review is not allowed');

    expect(() => deriveReportNarrativeReviewState([{
      reviewVersion: 1,
      stage: ReportNarrativeReviewStage.FINANCE,
      command: ReportNarrativeReviewCommand.ACCEPT,
      fromStatus: ReportNarrativeReviewStatus.NEEDS_FINANCE_REVIEW,
      toStatus: ReportNarrativeReviewStatus.ACCEPTED
    }])).toThrow('完整性校验失败');
  });
});
