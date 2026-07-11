export type ReportPeriod = 'today' | 'week' | 'month';

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function reportRange(period: ReportPeriod, now = new Date()) {
  const local = new Date(now.getTime() + CHINA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const date = local.getUTCDate();
  let startLocal = Date.UTC(year, month, date);
  if (period === 'week') {
    const weekday = local.getUTCDay() || 7;
    startLocal -= (weekday - 1) * 24 * 60 * 60 * 1000;
  }
  if (period === 'month') startLocal = Date.UTC(year, month, 1);
  const endLocal =
    period === 'today'
      ? startLocal + 24 * 60 * 60 * 1000
      : period === 'week'
        ? startLocal + 7 * 24 * 60 * 60 * 1000
        : Date.UTC(year, month + 1, 1);
  return {
    start: new Date(startLocal - CHINA_OFFSET_MS),
    end: new Date(endLocal - CHINA_OFFSET_MS),
    label: formatChinaDate(new Date(startLocal - CHINA_OFFSET_MS))
  };
}

export function dayRange(date: string | undefined, now = new Date()) {
  if (!date) return reportRange('today', now);
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const startLocal = Date.UTC(year, month - 1, day);
  return {
    start: new Date(startLocal - CHINA_OFFSET_MS),
    end: new Date(startLocal + 24 * 60 * 60 * 1000 - CHINA_OFFSET_MS),
    label: date.slice(0, 10)
  };
}

export function monthRange(monthValue: string | undefined, now = new Date()) {
  const local = new Date(now.getTime() + CHINA_OFFSET_MS);
  const [year, month] = monthValue
    ? monthValue.split('-').map(Number)
    : [local.getUTCFullYear(), local.getUTCMonth() + 1];
  const startLocal = Date.UTC(year, month - 1, 1);
  const endLocal = Date.UTC(year, month, 1);
  return {
    start: new Date(startLocal - CHINA_OFFSET_MS),
    end: new Date(endLocal - CHINA_OFFSET_MS),
    label: `${year}-${String(month).padStart(2, '0')}`
  };
}

export function formatChinaDate(date: Date) {
  const local = new Date(date.getTime() + CHINA_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}
