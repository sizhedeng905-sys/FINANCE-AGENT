import type { ReactNode } from 'react';
import { Card, Statistic } from 'antd';

interface MetricCardProps {
  title: string;
  value: number | string;
  prefix?: ReactNode;
  suffix?: string;
  precision?: number;
  color?: string;
}

export default function MetricCard({
  title,
  value,
  prefix,
  suffix,
  precision,
  color,
}: MetricCardProps) {
  return (
    <Card className="metric-card">
      <Statistic
        title={title}
        value={value}
        prefix={prefix}
        suffix={suffix}
        precision={precision}
        valueStyle={color ? { color } : undefined}
      />
    </Card>
  );
}
