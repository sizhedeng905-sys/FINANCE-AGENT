import { DatabaseOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import type { ImportTask } from '@/types/dataCenter';

interface ExcelApprovalEvidenceProps {
  approval: NonNullable<ImportTask['approval']>;
  onOpenRecords: () => void;
}

function compact(value: string) {
  return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

function CopyableValue({ value }: { value: string }) {
  return (
    <Typography.Text copyable={{ text: value }} code style={{ wordBreak: 'break-all' }}>
      {compact(value)}
    </Typography.Text>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export default function ExcelApprovalEvidence({ approval, onOpenRecords }: ExcelApprovalEvidenceProps) {
  const snapshot = approval.snapshot;
  return (
    <Card
      className="section-row"
      title={<Space><SafetyCertificateOutlined />不可变批准快照</Space>}
      extra={<Tag color="success">已批准</Tag>}
    >
      <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="批准人">{snapshot.approval.approvedByUsername}</Descriptions.Item>
        <Descriptions.Item label="批准时间">{formatDateTime(snapshot.approval.approvedAt)}</Descriptions.Item>
        <Descriptions.Item label="批准记录数">{snapshot.output.recordCount} 条</Descriptions.Item>
        <Descriptions.Item label="审核修订">{snapshot.review.reviewRevision}</Descriptions.Item>
        <Descriptions.Item label="快照版本">{snapshot.schemaVersion}</Descriptions.Item>
        <Descriptions.Item label="验证规则">{snapshot.review.validationRuleVersion}</Descriptions.Item>
        <Descriptions.Item label="批准快照哈希"><CopyableValue value={approval.snapshotHash} /></Descriptions.Item>
        <Descriptions.Item label="验证快照哈希"><CopyableValue value={approval.validationSnapshotHash} /></Descriptions.Item>
        <Descriptions.Item label="规范输出哈希"><CopyableValue value={snapshot.output.normalizedOutputHash} /></Descriptions.Item>
        <Descriptions.Item label="请求键哈希"><CopyableValue value={approval.requestKeyHash} /></Descriptions.Item>
      </Descriptions>
      <Button className="section-row" icon={<DatabaseOutlined />} onClick={onOpenRecords}>
        查看本批正式记录
      </Button>
    </Card>
  );
}
