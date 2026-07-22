import { BulbOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ExcelAiSuggestionResult } from '@/types/dataCenter';

export type AiDraftDecision = 'accepted' | 'rejected' | 'edited' | 'ignored';

export interface DisplayExcelAiMapping {
  sourceRef: string;
  sourceName: string;
  targetFieldId: string | null;
  targetFieldKey: string | null;
  targetFieldName: string;
  transformKey: string;
  confidence?: string;
  evidenceRefs: string[];
  ignored: boolean;
  source: 'ai' | 'mapping_profile';
}

interface ExcelAiSuggestionPanelProps {
  suggestion?: ExcelAiSuggestionResult;
  error?: string | null;
  loading: boolean;
  frozenTemplateVersionId?: string;
  suggestedTemplateVersionId?: string | null;
  mappingTemplateVersionId?: string;
  templateMismatch: boolean;
  mappings: DisplayExcelAiMapping[];
  decisions: Record<string, AiDraftDecision>;
  historyCount: number;
  canApply: (mapping: DisplayExcelAiMapping) => boolean;
  onRequest: () => void;
  onApply: (mapping: DisplayExcelAiMapping) => void;
  onReject: (mapping: DisplayExcelAiMapping) => void;
  onIgnore: (mapping: DisplayExcelAiMapping) => void;
  onApplyAll: () => void;
}

function confidencePercent(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? `${Math.round(parsed * 100)}%` : '-';
}

export default function ExcelAiSuggestionPanel({
  suggestion,
  error,
  loading,
  frozenTemplateVersionId,
  suggestedTemplateVersionId,
  mappingTemplateVersionId,
  templateMismatch,
  mappings,
  decisions,
  historyCount,
  canApply,
  onRequest,
  onApply,
  onReject,
  onIgnore,
  onApplyAll,
}: ExcelAiSuggestionPanelProps) {
  const columns: ColumnsType<DisplayExcelAiMapping> = [
    { title: '来源列', dataIndex: 'sourceName' },
    {
      title: '建议目标',
      render: (_, mapping) => (
        <Space direction="vertical" size={2}>
          <span>{mapping.targetFieldName}</span>
          <Typography.Text type="secondary">{mapping.targetFieldKey ?? '-'}</Typography.Text>
        </Space>
      ),
    },
    { title: '转换', dataIndex: 'transformKey' },
    {
      title: '置信度',
      render: (_, mapping) => mapping.source === 'mapping_profile'
        ? <Tag>历史人工规则</Tag>
        : <Tag color="gold">{confidencePercent(mapping.confidence)} · 仅供参考</Tag>,
    },
    {
      title: '证据',
      render: (_, mapping) => mapping.evidenceRefs.map((ref) => <Tag key={ref}>{ref}</Tag>),
    },
    {
      title: '人工决定',
      width: 290,
      render: (_, mapping) => {
        const decision = decisions[mapping.sourceRef];
        return (
          <Space wrap>
            {decision === 'accepted' ? <Tag color="green">已采纳到草稿</Tag> : null}
            {decision === 'rejected' ? <Tag>已拒绝</Tag> : null}
            {decision === 'edited' ? <Tag color="blue">已人工修改</Tag> : null}
            {decision === 'ignored' ? <Tag color="orange">已明确忽略</Tag> : null}
            {!decision ? (
              <>
                <Button
                  size="small"
                  icon={<CheckOutlined />}
                  disabled={!canApply(mapping)}
                  onClick={() => onApply(mapping)}
                >
                  采纳到草稿
                </Button>
                <Button size="small" icon={<CloseOutlined />} onClick={() => onReject(mapping)}>
                  拒绝建议
                </Button>
                <Button size="small" disabled={templateMismatch} onClick={() => onIgnore(mapping)}>
                  忽略此列
                </Button>
              </>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      className="section-row"
      title="AI 映射建议（需人工复核）"
      extra={(
        <Button icon={<BulbOutlined />} loading={loading} onClick={onRequest}>
          {suggestion ? '重新获取 AI 建议' : '获取 AI 映射建议'}
        </Button>
      )}
    >
      {error ? (
        <Alert
          type="warning"
          showIcon
          message="AI 建议不可用，当前人工映射草稿未改变"
          description={error}
        />
      ) : null}
      {!suggestion ? (
        <Empty description="尚未获取 AI 映射建议，人工映射仍可正常使用" />
      ) : suggestion.mode === 'manual' ? (
        <Alert
          type="warning"
          showIcon
          message="AI 建议当前不可用，已保留人工映射路径"
          description={`${suggestion.reasonCode}：${suggestion.message}`}
        />
      ) : (
        <Space direction="vertical" size="middle" className="full-width">
          <Alert
            type="info"
            showIcon
            message="AI 结果仅进入当前页面草稿，不会自动保存、生成复用规则或入账"
          />
          {templateMismatch ? (
            <Alert
              type="error"
              showIcon
              message="建议模板与任务冻结模板不一致"
              description={`任务冻结版本为 ${frozenTemplateVersionId ?? '未知'}，建议版本为 ${suggestedTemplateVersionId ?? '未选择'}。请重建任务或继续人工映射。`}
            />
          ) : null}
          {suggestion.status === 'profile_reused' ? (
            <>
              <Alert
                type="info"
                showIcon
                message="检测到已由财务批准的精确 Mapping Profile，仍需人工确认后保存"
              />
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="任务冻结模板版本">
                  {frozenTemplateVersionId ?? '后端未返回冻结版本，禁止采纳'}
                </Descriptions.Item>
                <Descriptions.Item label="Profile ID">
                  <Typography.Text copyable>{suggestion.profile.id}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Profile 版本">
                  {suggestion.profile.version ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label="Profile 审批快照哈希">
                  <Typography.Text copyable>{suggestion.profile.snapshotHash ?? '-'}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="来源结构指纹">
                  <Typography.Text copyable>{suggestion.profile.structureFingerprint ?? '-'}</Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            </>
          ) : (
            <>
              <Space wrap>
                {suggestion.mock ? <Tag color="warning">Mock（仅测试）</Tag> : null}
                <Tag>{suggestion.classification.provider}</Tag>
                <Tag>{suggestion.classification.model}</Tag>
                <Tag>Prompt {suggestion.classification.promptVersion}</Tag>
                <Tag color="gold">
                  分类置信度 {confidencePercent(suggestion.classification.output.confidence)} · 仅供参考
                </Tag>
                <Tag>{suggestion.classification.output.decision}</Tag>
              </Space>
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="任务冻结模板版本">
                  {frozenTemplateVersionId ?? '后端未返回冻结版本，禁止采纳'}
                </Descriptions.Item>
                <Descriptions.Item label="分类建议模板版本">
                  {suggestedTemplateVersionId ?? '未选择'}
                </Descriptions.Item>
                <Descriptions.Item label="映射输出模板版本">
                  {mappingTemplateVersionId ?? '未生成映射'}
                </Descriptions.Item>
                <Descriptions.Item label="分类理由">
                  {suggestion.classification.output.reasonCodes.join('、') || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="证据引用">
                  {suggestion.classification.output.evidenceRefs.join('、') || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="分类 AI Task ID">
                  <Typography.Text copyable>{suggestion.classification.aiTaskId}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="映射 AI Task ID">
                  <Typography.Text copyable>{suggestion.mapping?.aiTaskId ?? '-'}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="分类输出哈希">
                  <Typography.Text copyable>{suggestion.classification.outputHash}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="映射输出哈希">
                  <Typography.Text copyable>{suggestion.mapping?.outputHash ?? '-'}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="分类版本向量哈希">
                  <Typography.Text copyable>{suggestion.classification.versionVectorHash}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="映射版本向量哈希">
                  <Typography.Text copyable>{suggestion.mapping?.versionVectorHash ?? '-'}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="生成状态哈希">
                  <Typography.Text copyable>
                    {suggestion.mapping?.reviewBasis?.reviewState.stateHash ?? '-'}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="审核基线哈希">
                  <Typography.Text copyable>{suggestion.mapping?.reviewBasis?.basisHash ?? '-'}</Typography.Text>
                </Descriptions.Item>
              </Descriptions>
              {suggestion.classification.output.warnings.map((warning) => (
                <Alert key={`classification:${warning}`} type="warning" showIcon message={warning} />
              ))}
              {(suggestion.mapping?.output.warnings ?? []).map((warning) => (
                <Alert key={`mapping:${warning}`} type="warning" showIcon message={warning} />
              ))}
              {(suggestion.mapping?.output.unresolvedRequiredFields.length ?? 0) > 0 ? (
                <Alert
                  type="error"
                  showIcon
                  message={`未解决必填字段：${suggestion.mapping?.output.unresolvedRequiredFields.join('、')}`}
                />
              ) : null}
              {(suggestion.mapping?.output.unmappedSourceRefs.length ?? 0) > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`未映射来源：${suggestion.mapping?.output.unmappedSourceRefs.join('、')}`}
                />
              ) : null}
            </>
          )}
          <Space wrap>
            <Button
              icon={<CheckOutlined />}
              disabled={templateMismatch || mappings.length === 0 || mappings.some((item) => !canApply(item))}
              onClick={onApplyAll}
            >
              批量采纳到草稿
            </Button>
            <Tag>历史 AI 调用 {historyCount} 条</Tag>
          </Space>
          <Table
            rowKey={(mapping) => `${mapping.sourceRef}:${mapping.targetFieldId ?? 'ignored'}`}
            columns={columns}
            dataSource={mappings}
            pagination={false}
            scroll={{ x: 1180 }}
            onRow={() => ({ className: 'excel-ai-suggestion-row' })}
          />
        </Space>
      )}
    </Card>
  );
}
