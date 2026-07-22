import {
  ReportNarrativeReviewCommand,
  ReportNarrativeReviewStage,
  ReportNarrativeReviewStatus
} from '@prisma/client';

export interface ReportNarrativeReviewFact {
  reviewVersion: number;
  stage: ReportNarrativeReviewStage;
  command: ReportNarrativeReviewCommand;
  fromStatus: ReportNarrativeReviewStatus;
  toStatus: ReportNarrativeReviewStatus;
}

export interface ReportNarrativeTransition {
  stage: ReportNarrativeReviewStage;
  fromStatus: ReportNarrativeReviewStatus;
  toStatus: ReportNarrativeReviewStatus;
  reviewVersion: number;
}

export const INITIAL_REPORT_NARRATIVE_REVIEW_STATUS = ReportNarrativeReviewStatus.NEEDS_FINANCE_REVIEW;

export function reportNarrativeTransition(
  stage: ReportNarrativeReviewStage,
  status: ReportNarrativeReviewStatus,
  command: ReportNarrativeReviewCommand
): ReportNarrativeTransition {
  if (stage === ReportNarrativeReviewStage.FINANCE) {
    if (status !== ReportNarrativeReviewStatus.NEEDS_FINANCE_REVIEW) {
      throw new Error('finance narrative review is not allowed from the current status');
    }
    return {
      stage,
      fromStatus: status,
      toStatus: command === ReportNarrativeReviewCommand.ACCEPT
        ? ReportNarrativeReviewStatus.NEEDS_BOSS_REVIEW
        : command === ReportNarrativeReviewCommand.REQUEST_CHANGES
          ? ReportNarrativeReviewStatus.CHANGES_REQUESTED
          : ReportNarrativeReviewStatus.REJECTED,
      reviewVersion: 1
    };
  }
  if (status !== ReportNarrativeReviewStatus.NEEDS_BOSS_REVIEW) {
    throw new Error('boss narrative review is not allowed from the current status');
  }
  return {
    stage,
    fromStatus: status,
    toStatus: command === ReportNarrativeReviewCommand.ACCEPT
      ? ReportNarrativeReviewStatus.ACCEPTED
      : command === ReportNarrativeReviewCommand.REQUEST_CHANGES
        ? ReportNarrativeReviewStatus.CHANGES_REQUESTED
        : ReportNarrativeReviewStatus.REJECTED,
    reviewVersion: 2
  };
}

export function deriveReportNarrativeReviewState(reviews: ReportNarrativeReviewFact[]) {
  let status: ReportNarrativeReviewStatus = INITIAL_REPORT_NARRATIVE_REVIEW_STATUS;
  let version = 0;
  for (const review of [...reviews].sort((left, right) => left.reviewVersion - right.reviewVersion)) {
    const expected = reportNarrativeTransition(review.stage, status, review.command);
    if (
      review.reviewVersion !== expected.reviewVersion
      || review.fromStatus !== expected.fromStatus
      || review.toStatus !== expected.toStatus
    ) {
      throw new Error('报告 AI 叙述复核证据完整性校验失败');
    }
    status = review.toStatus;
    version = review.reviewVersion;
  }
  return { status, version };
}
