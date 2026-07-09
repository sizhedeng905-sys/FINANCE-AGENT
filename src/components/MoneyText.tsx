interface MoneyTextProps {
  value: number;
  strong?: boolean;
}

export default function MoneyText({ value, strong }: MoneyTextProps) {
  const text = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value);

  return strong ? <strong>{text}</strong> : <span>{text}</span>;
}
