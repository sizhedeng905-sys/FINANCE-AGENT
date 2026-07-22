import { AuditOutlined, RobotOutlined } from '@ant-design/icons';
import { Alert, Card, Descriptions, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import type {
  OCRAiReviewDecision,
  OCRAiReviewDecisionType,
  OCRFieldCandidate,
  PaginatedOCRAiReviewDecisions,
} from '@/types/dataCenter';

interface OcrAiReviewEvidenceProps {
  data?: PaginatedOCRAiReviewDecisions;
  loading: boolean;
  error?: string | null;
  fields: OCRFieldCandidate[];
  onPageChange: (page: number, pageSize: number) => void;
}

const decisionLabels: Record<OCRAiReviewDecisionType, { color?: string; text: string }> = {
  accept: { color: 'success', text: '采纳' },
  edit: { color: 'processing', text: '人工修改' },
  reject: { color: 'error', text: '拒绝映射' },
  ignore: { text: '明确忽略' },
};

const providerLabels = {
  mock: { color: 'warning', text: 'Mock Provider（仅测试）' },
  local: { color: 'processing', text: '本地 Provider' },
  external: { color: 'error', text: '外部 Provider' },
} as const;

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join('、');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

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

export default function OcrAiReviewEvidence({
  data,
  loading,
  error,
  fields,
  onPageChange,
}: OcrAiReviewEvidenceProps) {
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.fieldId, field])), [fields]);
  const columns: ColumnsType<OCRAiReviewDecision> = useMemo(() => [
    {
      title: 'OCR 来源',
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <span>{fieldById.get(item.sourceFieldId)?.fieldName ?? item.sourceRef}</span>
          <Typography.Text type="secondary" code>{item.sourceRef}</Typography.Text>
          <span>{displayValue(item.raw.value)}</span>
        </Space>
      ),
    },
    {
      title: 'AI 建议',
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <span>{item.suggested.targetFieldKey ?? '未映射'}</span>
          <span>{displayValue(item.suggested.value)}</span>
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
      title: '最终结果',
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <span>{item.final.targetFieldId ? fieldById.get(item.final.targetFieldId)?.fieldName ?? '模板字段' : '不写入字段'}</span>
          <span>{displayValue(item.final.value)}</span>
          <Space size={[0, 4]} wrap>
            {item.final.evidenceRefs.map((ref) => <Tag key={ref}>{ref}</Tag>)}
          </Space>
        </Space>
      ),
    },
    {
      title: '审核人 / 时间',
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <span>{item.actor.name}（{item.actor.username}）</span>
          <Typography.Text type="secondary">{formatDateTime(item.createdAt)}</Typography.Text>
        </Space>
      ),
    },
  ], [fieldById]);

  return (
    <Card
      className="section-row ocr-ai-review-evidence"
      title={<Space><AuditOutlined /><span>AI 字段复核证据</span></Space>}
      extra={data ? (
        <Space wrap>
          <Tag color={data.digest.mode === 'ai_reviewed' ? 'blue' : undefined}>
            {data.digest.mode === 'ai_reviewed'
              ? `R${data.digest.taskReviewRevision} 已持久化`
              : '纯人工路径'}
          </Tag>
          <Tag>共 {data.total} 条</Tag>
        </Space>
      ) : undefined}
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
      {!error && data ? (
        <>
          <Descriptions bordered size="small" column={{ xs: 2, md: 6 }}>
            <Descriptions.Item label="总数">{data.digest.summary.total}</Descriptions.Item>
            <Descriptions.Item label="采纳">{data.digest.summary.accept}</Descriptions.Item>
            <Descriptions.Item label="修改">{data.digest.summary.edit}</Descriptions.Item>
            <Descriptions.Item label="拒绝">{data.digest.summary.reject}</Descriptions.Item>
            <Descriptions.Item label="忽略">{data.digest.summary.ignore}</Descriptions.Item>
            <Descriptions.Item label="待处理">{data.digest.summary.pending}</Descriptions.Item>
            <Descriptions.Item label="证据摘要" span={6}>
              <CopyableValue value={data.digest.digestHash} />
            </Descriptions.Item>
          </Descriptions>
          {data.digest.batches.map((batch) => {
            const provider = providerLabels[batch.provider.providerClass];
            return (
              <Descriptions
                key={batch.aiTaskId}
                className="section-row"
                bordered
                size="small"
                column={{ xs: 1, md: 2 }}
                title={<Space><RobotOutlined /><span>AI 调用事实</span><Tag color={provider.color}>{provider.text}</Tag></Space>}
              >
                <Descriptions.Item label="Provider / 模型">
                  {batch.provider.provider} / {batch.provider.modelName}
                  {batch.provider.modelRevision ? ` @ ${batch.provider.modelRevision}` : ''}
                </Descriptions.Item>
                <Descriptions.Item label="Prompt">{batch.prompt.promptKey}:v{batch.prompt.versionNo}</Descriptions.Item>
                <Descriptions.Item label="Schema">{batch.contracts.inputSchemaVersion} → {batch.contracts.outputSchemaVersion}</Descriptions.Item>
                <Descriptions.Item label="建议完成时间">{formatDateTime(batch.completedAt ?? batch.generatedAt)}</Descriptions.Item>
                <Descriptions.Item label="AI Task"><CopyableValue value={batch.aiTaskId} /></Descriptions.Item>
                <Descriptions.Item label="输出哈希"><CopyableValue value={batch.outputHash} /></Descriptions.Item>
                <Descriptions.Item label="版本向量哈希"><CopyableValue value={batch.versionVectorHash} /></Descriptions.Item>
                <Descriptions.Item label="审核基线哈希">
                  {batch.reviewBasisHash ? <CopyableValue value={batch.reviewBasisHash} /> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="AI warning" span={2}>
                  {batch.warnings.length
                    ? batch.warnings.map((warning) => <Tag color="warning" key={warning}>{warning}</Tag>)
                    : '无'}
                </Descriptions.Item>
              </Descriptions>
            );
          })}
        </>
      ) : null}
      {!error && data?.total === 0 ? <Empty description="本任务尚未保存 AI 复核决定，人工纠错路径仍可用" /> : null}
      {!error && data && data.total > 0 ? (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data.items}
          loading={loading}
          scroll={{ x: 1180 }}
          pagination={{
            current: data.page,
            pageSize: data.pageSize,
            total: data.total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `共 ${total} 条`,
          }}
          onChange={(pagination) => onPageChange(pagination.current ?? 1, pagination.pageSize ?? 20)}
          expandable={{
            expandedRowRender: (item) => (
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="人工理由" span={2}>{item.reason}</Descriptions.Item>
                <Descriptions.Item label="审核修订">R{item.reviewRevision}</Descriptions.Item>
                <Descriptions.Item label="模板版本">{item.templateVersionId}</Descriptions.Item>
                <Descriptions.Item label="原始证据">{item.raw.evidenceRefs.join('、') || '-'}</Descriptions.Item>
                <Descriptions.Item label="AI 证据">{item.suggested.evidenceRefs.join('、') || '-'}</Descriptions.Item>
                <Descriptions.Item label="AI Task"><CopyableValue value={item.aiTaskId} /></Descriptions.Item>
                <Descriptions.Item label="输出哈希"><CopyableValue value={item.outputHash} /></Descriptions.Item>
                <Descriptions.Item label="审核基线哈希"><CopyableValue value={item.reviewBasisHash} /></Descriptions.Item>
              </Descriptions>
            ),
          }}
        />
      ) : null}
    </Card>
  );
}
