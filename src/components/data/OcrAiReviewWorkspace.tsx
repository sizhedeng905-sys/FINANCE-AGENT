import { BulbOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Descriptions, Empty, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { reviewOCRAiSuggestions } from '@/api/ocrApi';
import type {
  OCRAiMappingItem,
  OCRAiReviewDecisionType,
  OCRAiSuggestionResult,
  OCRFieldCandidate,
  OCRTask,
  ReviewOCRAiSuggestionsResult,
} from '@/types/dataCenter';

interface OcrAiReviewWorkspaceProps {
  task: OCRTask;
  suggestion?: OCRAiSuggestionResult;
  loading: boolean;
  reviewEvidenceReady: boolean;
  persistedDecisionCount: number;
  onRequest: () => Promise<void>;
  onSaved: (result: ReviewOCRAiSuggestionsResult) => Promise<void>;
  onOpenEvidence: (fieldId: string) => void;
}

interface ReviewDraft {
  sourceRef: string;
  decision?: OCRAiReviewDecisionType;
  finalTargetFieldId?: string;
  finalValue?: string;
  evidenceRefs: string[];
  reason: string;
}

const decisionOptions = [
  { value: 'accept', label: '采纳 AI 映射' },
  { value: 'edit', label: '人工修改' },
  { value: 'reject', label: '拒绝映射并保留原字段' },
  { value: 'ignore', label: '明确忽略该来源' },
] as const;

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join('、');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function editableValue(value: unknown) {
  const displayed = displayValue(value);
  return displayed === '-' ? '' : displayed;
}

function confidencePercent(value: string | number | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? `${Math.round(parsed * 100)}%` : '-';
}

function defaultReason(decision: OCRAiReviewDecisionType) {
  if (decision === 'accept') return '财务逐项核对原始证据后采纳 AI 建议';
  if (decision === 'edit') return '财务依据原始证据人工修改 AI 建议';
  if (decision === 'reject') return '财务核对原始证据后拒绝 AI 映射并保留 OCR 原字段';
  return '财务核对原始证据后明确忽略该来源';
}

export default function OcrAiReviewWorkspace({
  task,
  suggestion,
  loading,
  reviewEvidenceReady,
  persistedDecisionCount,
  onRequest,
  onSaved,
  onOpenEvidence,
}: OcrAiReviewWorkspaceProps) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const mappingExecution = suggestion?.mode === 'suggest' ? suggestion.mapping : undefined;
  const mappingOutput = mappingExecution?.output;
  const sourceFields = useMemo(
    () => task.fields.filter((field) => !field.missing && field.fieldType !== 'file'),
    [task.fields],
  );
  const sourceFieldByRef = useMemo(
    () => new Map(sourceFields.map((field) => [`candidate:${field.fieldId}`, field])),
    [sourceFields],
  );
  const mappingBySource = useMemo(
    () => new Map((mappingOutput?.mappings ?? []).map((mapping) => [mapping.sourceRef, mapping])),
    [mappingOutput?.mappings],
  );
  const executionKey = mappingExecution?.aiTaskId ?? '';

  useEffect(() => {
    if (!executionKey) {
      setDrafts({});
      return;
    }
    setDrafts(Object.fromEntries(sourceFields.map((field) => {
      const sourceRef = `candidate:${field.fieldId}`;
      const mapping = mappingBySource.get(sourceRef);
      return [sourceRef, {
        sourceRef,
        finalTargetFieldId: mapping?.targetFieldId ?? field.fieldId,
        finalValue: editableValue(field.normalizedValue),
        evidenceRefs: [...(mapping?.evidenceRefs ?? field.evidenceRefs)],
        reason: '',
      } satisfies ReviewDraft];
    })));
  }, [executionKey, mappingBySource, sourceFields]);

  const updateDraft = (sourceRef: string, patch: Partial<ReviewDraft>) => {
    setDrafts((current) => ({
      ...current,
      [sourceRef]: { ...current[sourceRef], ...patch },
    }));
  };

  const selectDecision = (sourceRef: string, decision: OCRAiReviewDecisionType) => {
    const field = sourceFieldByRef.get(sourceRef)!;
    const mapping = mappingBySource.get(sourceRef);
    updateDraft(sourceRef, {
      decision,
      finalTargetFieldId: decision === 'edit' ? mapping?.targetFieldId ?? field.fieldId : undefined,
      finalValue: decision === 'edit' ? editableValue(field.normalizedValue) : undefined,
      evidenceRefs: [...(mapping?.evidenceRefs ?? field.evidenceRefs)],
      reason: defaultReason(decision),
    });
  };

  const setMappedToAccept = () => {
    setDrafts((current) => {
      const next = { ...current };
      mappingBySource.forEach((_, sourceRef) => {
        next[sourceRef] = {
          ...next[sourceRef],
          decision: 'accept',
          finalTargetFieldId: undefined,
          finalValue: undefined,
          reason: defaultReason('accept'),
        };
      });
      return next;
    });
  };

  const setUnmappedToIgnore = () => {
    const unmapped = new Set(mappingOutput?.unmappedSourceRefs ?? []);
    setDrafts((current) => {
      const next = { ...current };
      unmapped.forEach((sourceRef) => {
        next[sourceRef] = {
          ...next[sourceRef],
          decision: 'ignore',
          finalTargetFieldId: undefined,
          finalValue: undefined,
          reason: defaultReason('ignore'),
        };
      });
      return next;
    });
  };

  const pending = sourceFields.filter((field) => !drafts[`candidate:${field.fieldId}`]?.decision).length;
  const invalid = sourceFields.some((field) => {
    const draft = drafts[`candidate:${field.fieldId}`];
    return !draft?.decision
      || draft.reason.trim().length < 2
      || (draft.decision === 'edit' && (!draft.finalTargetFieldId || !draft.finalValue?.trim() || draft.evidenceRefs.length === 0));
  });
  const contextReady = Boolean(
    mappingExecution?.aiTaskId
    && mappingExecution.outputHash
    && mappingExecution.versionVectorHash
    && mappingExecution.reviewBasis?.reviewState.stateHash
    && mappingExecution.reviewBasis.basisHash,
  );

  const save = async () => {
    if (!mappingExecution?.aiTaskId || !mappingExecution.outputHash || !mappingExecution.versionVectorHash || !mappingExecution.reviewBasis) {
      message.error('AI 建议缺少服务端审核依据，请重新获取建议');
      return;
    }
    if (invalid) {
      message.warning('请逐项完成决定、理由及人工修改字段');
      return;
    }
    setSaving(true);
    try {
      const result = await reviewOCRAiSuggestions(task.id, {
        expectedVersion: task.version,
        expectedReviewRevision: task.reviewRevision,
        aiTaskId: mappingExecution.aiTaskId,
        outputHash: mappingExecution.outputHash,
        versionVectorHash: mappingExecution.versionVectorHash,
        reviewStateHash: mappingExecution.reviewBasis.reviewState.stateHash,
        reviewBasisHash: mappingExecution.reviewBasis.basisHash,
        reviews: sourceFields.map((field) => {
          const draft = drafts[`candidate:${field.fieldId}`];
          return {
            sourceRef: draft.sourceRef,
            decision: draft.decision!,
            ...(draft.decision === 'edit' ? {
              finalTargetFieldId: draft.finalTargetFieldId,
              finalValue: draft.finalValue,
              evidenceRefs: draft.evidenceRefs,
            } : {}),
            reason: draft.reason.trim(),
          };
        }),
      });
      await onSaved(result);
      message.success(`R${result.reviewRevision} AI 财务复核已保存，旧校验快照已失效`);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<OCRFieldCandidate> = [
    {
      title: 'OCR 原始证据',
      width: 240,
      render: (_, field) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{field.fieldName}</Typography.Text>
          <span>{displayValue(field.rawValue)}</span>
          <span>第 {field.page} 页</span>
          <Space size={[0, 4]} wrap>{field.evidenceRefs.map((ref) => <Tag key={ref}>{ref}</Tag>)}</Space>
          <Button size="small" onClick={() => onOpenEvidence(field.fieldId)}>定位证据</Button>
        </Space>
      ),
    },
    {
      title: 'AI 建议',
      width: 240,
      render: (_, field) => {
        const mapping = mappingBySource.get(`candidate:${field.fieldId}`);
        return mapping ? (
          <Space direction="vertical" size={2}>
            <span>{mapping.targetFieldName ?? mapping.targetFieldKey}</span>
            <Typography.Text type="secondary">{mapping.transformKey}</Typography.Text>
            <Tag color="gold">{confidencePercent(mapping.confidence)} · 仅供参考</Tag>
            <Space size={[0, 4]} wrap>{mapping.evidenceRefs.map((ref) => <Tag key={ref}>{ref}</Tag>)}</Space>
          </Space>
        ) : <Tag color="warning">未映射</Tag>;
      },
    },
    {
      title: '财务决定',
      width: 230,
      render: (_, field) => {
        const sourceRef = `candidate:${field.fieldId}`;
        const mapping = mappingBySource.get(sourceRef);
        return (
          <Select
            aria-label={`复核决定-${field.fieldName}`}
            value={drafts[sourceRef]?.decision}
            placeholder="请选择"
            style={{ width: '100%' }}
            options={decisionOptions.map((option) => ({
              ...option,
              disabled: (option.value === 'accept' || option.value === 'reject') && !mapping,
            }))}
            onChange={(decision: OCRAiReviewDecisionType) => selectDecision(sourceRef, decision)}
          />
        );
      },
    },
    {
      title: '最终值',
      width: 280,
      render: (_, field) => {
        const sourceRef = `candidate:${field.fieldId}`;
        const draft = drafts[sourceRef];
        if (draft?.decision !== 'edit') return <Typography.Text type="secondary">由决定规则确定</Typography.Text>;
        return (
          <Space direction="vertical" className="full-width">
            <Select
              aria-label={`最终字段-${field.fieldName}`}
              value={draft.finalTargetFieldId}
              options={task.fields
                .filter((candidate) => candidate.fieldType !== 'file')
                .map((candidate) => ({ label: candidate.fieldName, value: candidate.fieldId }))}
              onChange={(finalTargetFieldId) => updateDraft(sourceRef, { finalTargetFieldId })}
            />
            <Input
              aria-label={`最终值-${field.fieldName}`}
              value={draft.finalValue}
              maxLength={500}
              onChange={(event) => updateDraft(sourceRef, { finalValue: event.target.value })}
            />
            <Select
              aria-label={`最终证据-${field.fieldName}`}
              mode="multiple"
              value={draft.evidenceRefs}
              options={field.evidenceRefs.map((ref) => ({ label: ref, value: ref }))}
              onChange={(evidenceRefs) => updateDraft(sourceRef, { evidenceRefs })}
            />
          </Space>
        );
      },
    },
    {
      title: '可审计理由',
      width: 300,
      render: (_, field) => {
        const sourceRef = `candidate:${field.fieldId}`;
        return (
          <Input.TextArea
            aria-label={`复核理由-${field.fieldName}`}
            value={drafts[sourceRef]?.reason}
            rows={3}
            maxLength={500}
            showCount
            onChange={(event) => updateDraft(sourceRef, { reason: event.target.value })}
          />
        );
      },
    },
  ];

  return (
    <Card
      className="ocr-ai-review-workspace"
      title="分类与字段映射建议"
      extra={task.status === 'pending_confirm' ? (
        <Button icon={<BulbOutlined />} loading={loading} onClick={() => void onRequest()}>
          {suggestion ? '重新获取建议' : '生成建议'}
        </Button>
      ) : null}
    >
      {!suggestion ? (
        persistedDecisionCount > 0
          ? <Alert type="success" showIcon message="AI 建议已完成财务复核，请查看页面上方的持久化证据" />
          : <Empty description="尚未生成 AI 建议；人工纠错路径始终可用" />
      ) : suggestion.mode === 'manual' ? (
        <Alert
          type="warning"
          showIcon
          message="AI 不可用，已转人工复核"
          description={`${suggestion.reasonCode ?? 'AI_UNAVAILABLE'}：${suggestion.message ?? '请使用现有人工纠错功能'}`}
        />
      ) : (
        <Space direction="vertical" size="middle" className="full-width">
          <Alert type="info" showIcon message="AI 结果仅为建议，必须由财务逐项决定" description="保存复核只会更新隔离审核草稿并使旧校验失效，不会自动批准或入账。" />
          <Space wrap>
            {suggestion.mock || mappingExecution?.providerClass === 'mock' ? <Tag color="warning">Mock Provider（仅测试）</Tag> : null}
            {mappingExecution?.providerClass === 'local' ? <Tag color="processing">本地 Provider</Tag> : null}
            {mappingExecution?.providerClass === 'external' ? <Tag color="error">外部 Provider</Tag> : null}
            <Tag>{mappingExecution?.provider ?? '-'}</Tag>
            <Tag>{mappingExecution?.model ?? '-'}</Tag>
            <Tag>Prompt {mappingExecution?.promptVersion ?? '-'}</Tag>
            <Tag>{mappingOutput?.decision ?? '-'}</Tag>
          </Space>
          <Descriptions bordered size="small" column={{ xs: 1, md: 3 }}>
            <Descriptions.Item label="来源总数">{sourceFields.length}</Descriptions.Item>
            <Descriptions.Item label="已映射">{mappingBySource.size}</Descriptions.Item>
            <Descriptions.Item label="待处理">待处理 {pending}</Descriptions.Item>
            <Descriptions.Item label="分类模板版本">
              {suggestion.classification?.output?.selectedTemplateVersionId ?? '未选择'}
            </Descriptions.Item>
            <Descriptions.Item label="分类理由">
              {suggestion.classification?.output?.reasonCodes.join('、') || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="分类置信度">
              <Tag color="gold">
                {confidencePercent(suggestion.classification?.output?.confidence)} · 仅供参考
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="AI Task" span={3}>
              <Typography.Text code copyable>{mappingExecution?.aiTaskId ?? '-'}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          {(suggestion.classification?.output?.warnings ?? []).map((warning) => (
            <Alert key={`classification:${warning}`} type="warning" showIcon message={warning} />
          ))}
          {!reviewEvidenceReady ? (
            <Alert type="warning" showIcon message="服务端审核历史尚未安全加载，暂不能保存 AI 复核" />
          ) : null}
          {!contextReady ? <Alert type="error" showIcon message="建议缺少服务端审核依据，请重新获取" /> : null}
          <Space wrap>
            <Button disabled={mappingBySource.size === 0} onClick={setMappedToAccept}>将已映射项设为采纳</Button>
            <Button disabled={(mappingOutput?.unmappedSourceRefs.length ?? 0) === 0} onClick={setUnmappedToIgnore}>将未映射项设为忽略</Button>
          </Space>
          <Table
            rowKey="fieldId"
            rowClassName={() => 'ocr-ai-review-draft-row'}
            columns={columns}
            dataSource={sourceFields}
            pagination={false}
            scroll={{ x: 1320 }}
          />
          {(mappingOutput?.unresolvedRequiredFields.length ?? 0) > 0 ? (
            <Alert type="error" showIcon message={`未解决必填字段：${mappingOutput?.unresolvedRequiredFields.join('、')}`} />
          ) : null}
          {(suggestion.conflicts?.length ?? 0) > 0 ? (
            <Alert type="error" showIcon message={`证据冲突：${suggestion.conflicts?.map((item) => item.sourceRef).join('、')}`} />
          ) : null}
          {(mappingOutput?.warnings ?? []).map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!reviewEvidenceReady || !contextReady || invalid || task.status !== 'pending_confirm' || persistedDecisionCount > 0}
            onClick={() => void save().catch((error) => message.error(error instanceof Error ? error.message : '保存复核失败'))}
          >
            保存完整复核
          </Button>
        </Space>
      )}
    </Card>
  );
}
