export function formatMoney(value: string | number) {
  const normalized = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) return '¥--';
  const sign = match[1] === '-' ? '-' : '';
  const integer = match[2].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (match[3] ?? '').padEnd(2, '0');
  return `${sign}¥${integer}.${fraction}`;
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export function currentTime() {
  return new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
