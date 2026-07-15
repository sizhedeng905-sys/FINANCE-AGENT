import { BadRequestException } from '@nestjs/common';

export type ReportPeriod = 'today' | 'week' | 'month';

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new BadRequestException('日期格式必须为 YYYY-MM-DD');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new BadRequestException('日期无效');
  }
  return { year, month: month - 1, day };
}

function nowParts(now: Date) {
  const local = new Date(now.getTime() + CHINA_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate()
  };
}

function rangeResult(startLocal: number, endLocal: number, anchorLocal: number) {
  const start = new Date(startLocal - CHINA_OFFSET_MS);
  const end = new Date(endLocal - CHINA_OFFSET_MS);
  return {
    start,
    end,
    label: formatChinaDate(new Date(anchorLocal - CHINA_OFFSET_MS)),
    startDate: formatChinaDate(start),
    endDate: formatChinaDate(new Date(end.getTime() - 1))
  };
}

export function reportRange(period: ReportPeriod, date?: string, now = new Date()) {
  const parts = date ? dateParts(date) : nowParts(now);
  const anchorLocal = Date.UTC(parts.year, parts.month, parts.day);
  let startLocal = anchorLocal;
  if (period === 'week') {
    const weekday = new Date(anchorLocal).getUTCDay() || 7;
    startLocal -= (weekday - 1) * DAY_MS;
  }
  if (period === 'month') startLocal = Date.UTC(parts.year, parts.month, 1);
  const endLocal =
    period === 'today'
      ? startLocal + DAY_MS
      : period === 'week'
        ? startLocal + 7 * DAY_MS
        : Date.UTC(parts.year, parts.month + 1, 1);
  return rangeResult(startLocal, endLocal, anchorLocal);
}

export function dayRange(date: string | undefined, now = new Date()) {
  return reportRange('today', date, now);
}

export function monthRange(monthValue: string | undefined, now = new Date()) {
  const local = new Date(now.getTime() + CHINA_OFFSET_MS);
  const [year, month] = monthValue
    ? monthValue.split('-').map(Number)
    : [local.getUTCFullYear(), local.getUTCMonth() + 1];
  const startLocal = Date.UTC(year, month - 1, 1);
  const endLocal = Date.UTC(year, month, 1);
  return {
    ...rangeResult(startLocal, endLocal, startLocal),
    label: `${year}-${String(month).padStart(2, '0')}`
  };
}

export function formatChinaDate(date: Date) {
  const local = new Date(date.getTime() + CHINA_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

export function shiftMonthDate(date: string, offset: number) {
  const parts = dateParts(date);
  const shifted = new Date(Date.UTC(parts.year, parts.month + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
