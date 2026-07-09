import { Tag } from 'antd';
import type { RiskLevel } from '@/types/workOrder';
import { riskLabelMap } from '@/utils/statusMap';

const colorMap: Record<RiskLevel, string> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
};

export default function RiskTag({ risk }: { risk: RiskLevel }) {
  return <Tag color={colorMap[risk]}>{riskLabelMap[risk]}风险</Tag>;
}
