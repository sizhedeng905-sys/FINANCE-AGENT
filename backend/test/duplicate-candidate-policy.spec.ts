import {
  buildDuplicateCandidateWindow,
  DUPLICATE_CANDIDATE_MAX_WINDOW_DAYS,
  isWithinDuplicateCandidateWindow,
  normalizeDuplicateCandidateCondition,
  resolveDuplicateCandidatePolicy,
  utcCalendarDayOffset
} from '../src/risk-rules/duplicate-candidate-policy';

describe('duplicate candidate window policy', () => {
  it('defaults legacy empty conditions to a zero-day UTC date-only window', () => {
    const policy = resolveDuplicateCandidatePolicy({});
    const window = buildDuplicateCandidateWindow(new Date('2026-07-18T23:59:59.999Z'), policy);

    expect(policy).toMatchObject({
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
      windowDays: 0,
      maximumWindowDays: 365
    });
    expect(window).toEqual({
      referenceDate: new Date('2026-07-18T00:00:00.000Z'),
      startInclusive: new Date('2026-07-18T00:00:00.000Z'),
      endExclusive: new Date('2026-07-19T00:00:00.000Z')
    });
  });

  it('uses inclusive symmetric boundaries across month and year changes', () => {
    const policy = resolveDuplicateCandidatePolicy({ windowDays: 2 });
    const window = buildDuplicateCandidateWindow(new Date('2026-01-01T00:00:00.000Z'), policy);

    expect(window.startInclusive.toISOString()).toBe('2025-12-30T00:00:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2026-01-04T00:00:00.000Z');
    expect(utcCalendarDayOffset(new Date('2025-12-30T23:59:59.999Z'), window.referenceDate)).toBe(-2);
    expect(utcCalendarDayOffset(new Date('2026-01-03T23:59:59.999Z'), window.referenceDate)).toBe(2);
    expect(utcCalendarDayOffset(new Date('2025-12-29T23:59:59.999Z'), window.referenceDate)).toBe(-3);
    expect(utcCalendarDayOffset(new Date('2026-01-04T00:00:00.000Z'), window.referenceDate)).toBe(3);
    expect(isWithinDuplicateCandidateWindow(new Date('2025-12-30T00:00:00.000Z'), window)).toBe(true);
    expect(isWithinDuplicateCandidateWindow(new Date('2026-01-03T23:59:59.999Z'), window)).toBe(true);
    expect(isWithinDuplicateCandidateWindow(new Date('2025-12-29T23:59:59.999Z'), window)).toBe(false);
    expect(isWithinDuplicateCandidateWindow(new Date('2026-01-04T00:00:00.000Z'), window)).toBe(false);
  });

  it('normalizes timezone-offset instants to their UTC calendar date', () => {
    const policy = resolveDuplicateCandidatePolicy({ windowDays: 1 });
    const window = buildDuplicateCandidateWindow(new Date('2026-01-01T23:30:00-08:00'), policy);

    expect(window.referenceDate.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(window.startInclusive.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2026-01-04T00:00:00.000Z');
  });

  it('supports the maximum window without fixed-duration month or leap-year drift', () => {
    const policy = resolveDuplicateCandidatePolicy({ windowDays: DUPLICATE_CANDIDATE_MAX_WINDOW_DAYS });
    const window = buildDuplicateCandidateWindow(new Date('2024-03-01T00:00:00.000Z'), policy);

    expect(window.startInclusive.toISOString()).toBe('2023-03-02T00:00:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2025-03-02T00:00:00.000Z');
    expect(utcCalendarDayOffset(window.startInclusive, window.referenceDate)).toBe(-365);
    expect(utcCalendarDayOffset(new Date('2025-03-01T00:00:00.000Z'), window.referenceDate)).toBe(365);
  });

  it('makes the legacy default explicit while retaining the fixed H03 policy boundary', () => {
    expect(normalizeDuplicateCandidateCondition({})).toEqual({ windowDays: 0 });
    expect(normalizeDuplicateCandidateCondition({ windowDays: 7 })).toEqual({ windowDays: 7 });
    expect(resolveDuplicateCandidatePolicy({ windowDays: 366 }).windowDays).toBe(0);
    expect(resolveDuplicateCandidatePolicy({ windowDays: -1 }).windowDays).toBe(0);
    expect(resolveDuplicateCandidatePolicy({ windowDays: 1.5 }).windowDays).toBe(0);
  });
});
