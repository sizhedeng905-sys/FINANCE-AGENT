import { AuditOutlined } from '@ant-design/icons';
import { Alert, Card, Descriptions, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import type {
  ImportAiReviewDecision,
  ImportAiReviewDecisionType,
  ImportColumn,
  PaginatedImportAiReviewDecisions,
} from '@/types/dataCenter';

interface ExcelAiReviewEvidenceProps {
  data?: PaginatedImportAiReviewDecisions;
  loading: boolean;
  error?: string | null;
  importColumns: ImportColumn[];
  onPageChange: (page: number, pageSize: number) => void;
}

const decisionLabels: Record<ImportAiReviewDecisionType, { color?: string; text: string }> = {
  accept: { color: 'success', text: '采纳' },
  edit: { color: 'processing', text: '人工修改' },
  reject: { color: 'error', text: '拒绝' },
  ignore: { text: '明确忽略' },
};

function confidencePercent(value: string | null) {
  if (value === null) return '-';
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? `${Math.round(parsed * 100)}%` : '-';
}

function compact(value: string) {
  return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function CopyableValue({ value }: { value: string }) {
  return (
    <Typography.Text copyable={{ text: value }} code style={{ wordBreak: 'break-all' }}>
      {compact(value)}
    </Typography.Text>
  );
}

export default function ExcelAiReviewEvidence({
  data,
  loading,
  error,
  importColumns,
  onPageChange,
}: ExcelAiReviewEvidenceProps) {
  const columnById = useMemo(
    () => new Map(importColumns.map((column) => [column.id, column])),
    [importColumns],
  );
  const columns: ColumnsType<ImportAiReviewDecision> = useMemo(() => [
    {
      title: '来源列',
      render: (_, item) => {
        const column = columnById.get(item.importColumnId);
        return (
          <Space direction="vertical" size={2}>
            <span>{column?.sourceName ?? item.sourceRef}</span>
            <Typography.Text type="secondary" code>{item.sourceRef}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: 'AI 建议',
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <span>{item.suggested.targetFieldKey ?? '未映射'}</span>
          <Tag color="gold">{confidencePercent(item.suggested.confidence)} · 仅供参考</Tag>
        </Space>
      ),
    },
    {
      title: '财务决定',
      render: (_, item) => {
        const label = decisionLabels[item.decision];
        return <Tag color={label.color}>{label.text}</Tag>;
      },
    },
    {
      title: '最终映射',
      render: (_, item) => {
        if (item.final.ignored) return <Tag>明确忽略</Tag>;
        const current = columnById.get(item.importColumnId)?.decision;
        const currentName = current?.targetFieldId === item.final.targetFieldId
          ? current.targetFieldName
          : undefined;
        return (
          <Space direction="vertical" size={2}>
            <span>{currentName ?? '字段 ID'}</span>
            {item.final.targetFieldId ? <CopyableValue value={item.final.targetFieldId} /> : '-'}
          </Space>
        );
      },
    },
    {
      title: '审核人',
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <span>{item.actor.name}</span>
          <Typography.Text type="secondary">{item.actor.username}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '审核时间',
      dataIndex: 'createdAt',
      render: (value: string) => formatDateTime(value),
    },
  ], [columnById]);

  return (
    <Card
      className="section-row"
      title={<Space><AuditOutlined />AI 映射审核证据</Space>}
      extra={data ? <Tag color="blue">共 {data.total} 条</Tag> : undefined}
      loading={loading && !data}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          message="AI 审核证据加载失败，最终批准已暂停"
          description={error}
        />
      ) : null}
      {!error && data?.total === 0 ? <Empty description="本任务未使用 AI 映射建议" /> : null}
      {!error && data && data.total > 0 ? (
        <Table
          rowKey="id"
          className="excel-ai-review-table"
          rowClassName={() => 'excel-ai-review-row'}
          columns={columns}
          dataSource={data.items}
          loading={loading}
          scroll={{ x: 1050 }}
          pagination={{
            current: data.page,
            pageSize: data.pageSize,
            total: data.total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `共 ${total} 条`,
          }}
          onChange={(pagination) => onPageChange(
            pagination.current ?? 1,
            pagination.pageSize ?? 20,
          )}
          expandable={{
            expandedRowRender: (item) => (
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="人工理由" span={2}>{item.reason}</Descriptions.Item>
                <Descriptions.Item label="审核修订">{item.reviewRevision}</Descriptions.Item>
                <Descriptions.Item label="模板版本">{item.templateVersionId}</Descriptions.Item>
                <Descriptions.Item label="转换规则">{item.suggested.transformKey}</Descriptions.Item>
                <Descriptions.Item label="证据引用">{item.suggested.evidenceRefs.join('、')}</Descriptions.Item>
                <Descriptions.Item label="AI Task"><CopyableValue value={item.aiTaskId} /></Descriptions.Item>
                <Descriptions.Item label="最终字段 ID">
                  {item.final.targetFieldId ? <CopyableValue value={item.final.targetFieldId} /> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="输出哈希"><CopyableValue value={item.outputHash} /></Descriptions.Item>
                <Descriptions.Item label="版本向量哈希"><CopyableValue value={item.versionVectorHash} /></Descriptions.Item>
              </Descriptions>
            ),
          }}
        />
      ) : null}
    </Card>
  );
}
