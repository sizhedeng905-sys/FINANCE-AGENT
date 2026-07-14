const MONEY_PATTERN = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/;

export function moneyToCents(value: string): bigint {
  const match = value.trim().match(MONEY_PATTERN);
  if (!match) throw new Error('金额格式不合法');
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}

export function centsToMoney(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function sumMoney(values: string[]): string {
  return centsToMoney(values.reduce((sum, value) => sum + moneyToCents(value), 0n));
}

export function subtractMoney(left: string, right: string): string {
  return centsToMoney(moneyToCents(left) - moneyToCents(right));
}

export function moneyRatioPercent(numerator: string, denominator: string): number {
  const denominatorCents = moneyToCents(denominator);
  if (denominatorCents === 0n) return 0;
  const scaledTenths = (moneyToCents(numerator) * 1000n) / denominatorCents;
  return Number(scaledTenths) / 10;
}
