import { formatMoney } from '@/utils/format';

interface MoneyTextProps {
  value: string | number;
  strong?: boolean;
}

export default function MoneyText({ value, strong }: MoneyTextProps) {
  const text = formatMoney(value);

  return strong ? <strong>{text}</strong> : <span>{text}</span>;
}
