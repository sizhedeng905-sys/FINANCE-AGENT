export const DUPLICATE_CANDIDATE_MAX_WINDOW_DAYS = 365;
export const DUPLICATE_CANDIDATE_DEFAULT_WINDOW_DAYS = 0;

export const DUPLICATE_CANDIDATE_MATCH_SIGNALS = [
  'AMOUNT_EXACT',
  'ATTACHMENT_SHA256_EXACT',
  'BUSINESS_REFERENCE_EXACT'
] as const;

export type DuplicateCandidateMatchSignal = (typeof DUPLICATE_CANDIDATE_MATCH_SIGNALS)[number];

export interface DuplicateCandidatePolicy {
  schemaVersion: 'duplicate-candidate-policy/1.0';
  policyStatus: 'pending_human_decision';
  candidateOnly: true;
  automaticAction: 'none';
  calendarBasis: 'UTC_DATE_ONLY';
  timeZone: 'UTC';
  windowSemantics: 'SYMMETRIC_INCLUSIVE_CALENDAR_DAYS';
  sourceScope: 'WORK_ORDER_ONLY';
  fingerprintPolicy: 'H03_PENDING_PROVISIONAL_SIGNALS';
  amountTolerancePolicy: 'H03_PENDING_EXACT_MATCH_ONLY';
  crossSourceNormalizationPolicy: 'H03_PENDING_NOT_APPLIED';
  dispositionPolicy: 'H03_PENDING_MANUAL_REVIEW_ONLY';
  windowDays: number;
  maximumWindowDays: typeof DUPLICATE_CANDIDATE_MAX_WINDOW_DAYS;
  provisionalMatchSignals: readonly DuplicateCandidateMatchSignal[];
}

export interface DuplicateCandidateWindow {
  referenceDate: Date;
  startInclusive: Date;
  endExclusive: Date;
}

export function resolveDuplicateCandidatePolicy(condition: Record<string, unknown>): DuplicateCandidatePolicy {
  const configuredWindow = condition.windowDays;
  const windowDays = typeof configuredWindow === 'number' &&
    Number.isInteger(configuredWindow) &&
    configuredWindow >= 0 &&
    configuredWindow <= DUPLICATE_CANDIDATE_MAX_WINDOW_DAYS
    ? configuredWindow
    : DUPLICATE_CANDIDATE_DEFAULT_WINDOW_DAYS;

  return {
    schemaVersion: 'duplicate-candidate-policy/1.0',
    policyStatus: 'pending_human_decision',
    candidateOnly: true,
    automaticAction: 'none',
    calendarBasis: 'UTC_DATE_ONLY',
    timeZone: 'UTC',
    windowSemantics: 'SYMMETRIC_INCLUSIVE_CALENDAR_DAYS',
    sourceScope: 'WORK_ORDER_ONLY',
    fingerprintPolicy: 'H03_PENDING_PROVISIONAL_SIGNALS',
    amountTolerancePolicy: 'H03_PENDING_EXACT_MATCH_ONLY',
    crossSourceNormalizationPolicy: 'H03_PENDING_NOT_APPLIED',
    dispositionPolicy: 'H03_PENDING_MANUAL_REVIEW_ONLY',
    windowDays,
    maximumWindowDays: DUPLICATE_CANDIDATE_MAX_WINDOW_DAYS,
    provisionalMatchSignals: DUPLICATE_CANDIDATE_MATCH_SIGNALS
  };
}

export function normalizeDuplicateCandidateCondition(condition: Record<string, unknown>) {
  return {
    ...condition,
    windowDays: resolveDuplicateCandidatePolicy(condition).windowDays
  };
}

export function buildDuplicateCandidateWindow(
  occurredDate: Date,
  policy: DuplicateCandidatePolicy
): DuplicateCandidateWindow {
  const referenceDate = utcDateOnly(occurredDate);
  const startInclusive = new Date(referenceDate);
  startInclusive.setUTCDate(startInclusive.getUTCDate() - policy.windowDays);
  const endExclusive = new Date(referenceDate);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + policy.windowDays + 1);
  return { referenceDate, startInclusive, endExclusive };
}

export function utcCalendarDayOffset(candidateDate: Date, referenceDate: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((utcDateOnly(candidateDate).getTime() - utcDateOnly(referenceDate).getTime()) / millisecondsPerDay);
}

export function isWithinDuplicateCandidateWindow(candidateDate: Date, window: DuplicateCandidateWindow) {
  const timestamp = candidateDate.getTime();
  return timestamp >= window.startInclusive.getTime() && timestamp < window.endExclusive.getTime();
}

function utcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
