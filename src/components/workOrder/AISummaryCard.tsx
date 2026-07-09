import { RobotOutlined } from '@ant-design/icons';
import { Card, Space, Typography } from 'antd';
import RiskTag from './RiskTag';
import type { RiskLevel } from '@/types/workOrder';

interface AISummaryCardProps {
  summary?: string;
  riskLevel: RiskLevel;
  title?: string;
}

export default function AISummaryCard({ summary, riskLevel, title = 'AI分析摘要' }: AISummaryCardProps) {
  return (
    <Card title={title}>
      <Space direction="vertical" size={10} className="full-width">
        <Space>
          <RobotOutlined className="ai-icon" />
          <RiskTag risk={riskLevel} />
        </Space>
        <Typography.Paragraph className="no-margin">
          {summary || 'AI 暂未发现可展示的异常摘要。'}
        </Typography.Paragraph>
      </Space>
    </Card>
  );
}
