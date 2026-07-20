import { useEffect, useMemo, useState } from 'react';
import {
  BulbOutlined,
  EditOutlined,
  EyeOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { requestOCRAiSuggestions } from '@/api/ocrApi';
import OcrEvidencePreview from '@/components/data/OcrEvidencePreview';
import PageHeader from '@/components/PageHeader';
import AttachmentPreview from '@/components/workOrder/AttachmentPreview';
import { useOCRStore } from '@/store/ocrStore';
import type {
  OCRAiSuggestionResult,
  OCRAttempt,
  OCRCorrection,
  OCRFieldCandidate,
} from '@/types/dataCenter';
import { fieldTypeMap, ocrStatusMap } from '@/utils/dataCenterMaps';

interface CorrectionForm {
  correctedValue: string;
  reason: string;
  evidenceRefs: string[];
}

type AiMapping = NonNullable<NonNullable<OCRAiSuggestionResult['mapping']>['output']>['mappings'][number];

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function confidencePercent(value: string | number | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? `${Math.round(parsed * 100)}%` : '-';
}

export default function DataOcrDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [candidate, setCandidate] = useState<OCRFieldCandidate>();
  const [evidenceFieldId, setEvidenceFieldId] = useState<string>();
  const [activeTab, setActiveTab] = useState('fields');
  const [acknowledged, setAcknowledged] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<OCRAiSuggestionResult>();
  const [aiLoading, setAiLoading] = useState(false);
  const [form] = Form.useForm<CorrectionForm>();
  const task = useOCRStore((state) => state.currentTask?.id === id ? state.currentTask : undefined);
  const loading = useOCRStore((state) => state.loading);
  const error = useOCRStore((state) => state.error);
  const fetchTask = useOCRStore((state) => state.fetchTask);
  const runTask = useOCRStore((state) => state.runTask);
  const retryTask = useOCRStore((state) => state.retryTask);
  const correctTask = useOCRStore((state) => state.correctTask);
  const revalidateTask = useOCRStore((state) => state.revalidateTask);
  const confirmTask = useOCRStore((state) => state.confirmTask);

  useEffect(() => {
    if (id) void fetchTask(id).catch(() => undefined);
  }, [fetchTask, id]);

  useEffect(() => {
    if (!id || !task || !['queued', 'processing'].includes(task.status)) return undefined;
    const timer = window.setInterval(() => void fetchTask(id).catch(() => undefined), 1500);
    return () => window.clearInterval(timer);
  }, [fetchTask, id, task?.status]);

  useEffect(() => {
    setAiSuggestion(undefined);
  }, [id, task?.reviewRevision]);

  const unresolved = useMemo(
    () => task?.fields.filter((field) => (
      field.lowConfidence || field.missing || field.validationError || field.evidenceConflict
    )) ?? [],
    [task?.fields],
  );
  const evidenceField = useMemo(
    () => task?.fields.find((field) => field.fieldId === evidenceFieldId),
    [evidenceFieldId, task?.fields],
  );

  useEffect(() => {
    if (!task?.fields.length) {
      setEvidenceFieldId(undefined);
      return;
    }
    if (!task.fields.some((field) => field.fieldId === evidenceFieldId)) {
      const first = task.fields.find((field) => (
        field.evidenceConflict || field.lowConfidence || field.missing || field.validationError
      )) ?? task.fields[0];
      setEvidenceFieldId(first.fieldId);
    }
  }, [evidenceFieldId, task?.fields]);

  const currentValidation = task && task.validation?.reviewRevision === task.reviewRevision
    ? task.validation
    : null;
  const validationWarnings = currentValidation?.snapshot.warnings ?? [];
  const needsAcknowledgement = unresolved.length > 0 || validationWarnings.length > 0;
  const canConfirm = task?.status === 'pending_confirm'
    && Boolean(currentValidation?.snapshot.valid)
    && (!needsAcknowledgement || acknowledged);

  const availableEvidenceRefs = useMemo(() => {
    if (!candidate) return [];
    return [...new Set([
      ...candidate.evidenceRefs,
      ...candidate.alternatives.flatMap((alternative) => alternative.evidenceRefs),
      ...collectPageEvidenceRefs(task?.textBlocks ?? [], candidate.page),
    ])].slice(0, 256);
  }, [candidate, task?.textBlocks]);

  const openEvidence = (field: OCRFieldCandidate) => {
    setEvidenceFieldId(field.fieldId);
    setActiveTab('evidence');
  };

  const openCorrection = (field: OCRFieldCandidate) => {
    setCandidate(field);
    setEvidenceFieldId(field.fieldId);
    form.setFieldsValue({
      correctedValue: displayValue(field.normalizedValue) === '-' ? '' : displayValue(field.normalizedValue),
      reason: '',
      evidenceRefs: [...field.evidenceRefs],
    });
  };

  const submitCorrection = async () => {
    if (!id || !candidate || !task) return;
    const values = await form.validateFields();
    const correctedValue = ['number', 'money'].includes(candidate.fieldType)
      ? values.correctedValue.trim()
      : values.correctedValue;
    await correctTask(id, {
      expectedVersion: task.version,
      expectedReviewRevision: task.reviewRevision,
      corrections: [{
        fieldId: candidate.fieldId,
        correctedValue,
        reason: values.reason.trim(),
        evidenceRefs: values.evidenceRefs,
      }],
    });
    message.success('字段修正已保存，旧校验结果已失效');
    setCandidate(undefined);
    setAcknowledged(false);
    form.resetFields();
  };

  const revalidate = async () => {
    if (!id || !task) return;
    const next = await revalidateTask(id, {
      expectedVersion: task.version,
      expectedReviewRevision: task.reviewRevision,
    });
    setAcknowledged(false);
    if (next.validation?.snapshot.valid) message.success('确定性校验通过');
    else message.warning(`校验完成，仍有 ${next.validation?.snapshot.blockingErrors.length ?? 0} 个阻断问题`);
  };

  const requestSuggestions = async () => {
    if (!id) return;
    setAiLoading(true);
    try {
      const result = await requestOCRAiSuggestions(id);
      setAiSuggestion(result);
      setActiveTab('ai');
      if (result.mode === 'manual') message.warning('AI 建议不可用，已保留人工复核路径');
      else message.success('AI 建议已生成，尚未应用或入账');
    } finally {
      setAiLoading(false);
    }
  };

  const confirm = async () => {
    if (!id || !canConfirm) {
      message.warning('请先完成当前修订版本的确定性校验并处理阻断问题');
      return;
    }
    const result = await confirmTask(id, acknowledged);
    message.success(result.alreadyConfirmed ? '该任务已确认，本次未重复生成记录' : 'OCR结果已确认并生成经营记录');
    navigate('/data/records');
  };

  const fieldColumns: ColumnsType<OCRFieldCandidate> = [
    {
      title: '模板字段',
      render: (_, field) => (
        <Space>
          <span>{field.fieldName}</span>
          {field.isRequired ? <Tag color="blue">必填</Tag> : null}
        </Space>
      ),
    },
    { title: '类型', dataIndex: 'fieldType', render: (value) => fieldTypeMap[value as OCRFieldCandidate['fieldType']] },
    { title: '识别值', render: (_, field) => displayValue(field.normalizedValue) },
    {
      title: '置信度',
      width: 130,
      render: (_, field) => (
        <Tooltip title="模型置信度仅供参考，不作为自动批准依据">
          <Tag color={field.lowConfidence ? 'warning' : 'success'}>{confidencePercent(field.confidence)} · 仅供参考</Tag>
        </Tooltip>
      ),
    },
    {
      title: '核对状态',
      width: 190,
      render: (_, field) => (
        <Space wrap>
          {field.missing ? <Tag color="error">未识别</Tag> : null}
          {field.evidenceConflict ? <Tag color="error">证据冲突</Tag> : null}
          {field.lowConfidence && !field.missing ? <Tag color="warning">需人工核对</Tag> : null}
          {field.valueSource === 'MANUAL_OVERRIDE' ? <Tag color="processing">人工修订 R{field.reviewRevision}</Tag> : null}
          {!field.lowConfidence && !field.corrected && !field.evidenceConflict ? <Tag color="success">正常</Tag> : null}
        </Space>
      ),
    },
    {
      title: '证据/错误',
      render: (_, field) => (
        <Space direction="vertical" size={2}>
          <Typography.Text ellipsis={{ tooltip: field.evidence }}>{field.evidence || '-'}</Typography.Text>
          <Space size={[0, 4]} wrap>
            {field.evidenceRefs.slice(0, 3).map((ref) => <Tag key={ref}>{ref}</Tag>)}
            {field.evidenceRefs.length > 3 ? <Tag>+{field.evidenceRefs.length - 3}</Tag> : null}
          </Space>
          {field.validationError ? <Typography.Text type="danger">{field.validationError}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 104,
      fixed: 'right',
      render: (_, field) => (
        <Space size={2}>
          <Tooltip title="查看证据">
            <Button
              type="text"
              shape="circle"
              aria-label="查看证据"
              icon={<EyeOutlined />}
              onClick={() => openEvidence(field)}
            />
          </Tooltip>
          {task?.status === 'pending_confirm' && field.fieldType !== 'file' ? (
            <Tooltip title="人工修正">
              <Button
                type="text"
                shape="circle"
                aria-label="修正"
                icon={<EditOutlined />}
                onClick={() => openCorrection(field)}
              />
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
  ];

  const attemptColumns: ColumnsType<OCRAttempt> = [
    { title: '次数', dataIndex: 'attemptNo', width: 70 },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'failed' ? 'error' : value === 'succeeded' ? 'success' : 'default'}>{value}</Tag> },
    { title: 'Provider / 模型', render: (_, attempt) => `${attempt.provider} / ${attempt.modelName}` },
    { title: '耗时', dataIndex: 'latencyMs', render: (value?: number) => value === undefined ? '-' : `${value} ms` },
    { title: '关联编号', dataIndex: 'correlationId' },
    { title: '错误', dataIndex: 'errorMessage', render: (value?: string) => value || '-' },
  ];

  const correctionColumns: ColumnsType<OCRCorrection> = [
    { title: '修订', dataIndex: 'reviewRevision', width: 80, render: (value) => `R${value}` },
    { title: '字段', dataIndex: 'fieldName' },
    { title: '修正前', dataIndex: 'beforeValue', render: (value?: string) => value || '-' },
    { title: '修正后', dataIndex: 'afterValue' },
    { title: '证据', dataIndex: 'evidenceRefs', render: (refs: string[]) => refs.length ? refs.map((ref) => <Tag key={ref}>{ref}</Tag>) : '-' },
    { title: '原因', dataIndex: 'reason' },
    { title: '修正人', dataIndex: 'correctedBy' },
    { title: '时间', dataIndex: 'correctedAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
  ];

  const aiMappingColumns: ColumnsType<AiMapping> = [
    { title: '来源', dataIndex: 'sourceRef' },
    { title: '目标字段', render: (_, item) => item.targetFieldName ?? item.targetFieldKey },
    { title: '确定性转换', dataIndex: 'transformKey' },
    { title: '证据', dataIndex: 'evidenceRefs', render: (refs: string[]) => refs.map((ref) => <Tag key={ref}>{ref}</Tag>) },
    {
      title: '置信度',
      dataIndex: 'confidence',
      render: (value: string) => <Tag color="gold">{confidencePercent(value)} · 仅供参考</Tag>,
    },
  ];

  if (!id) return <Card><Empty description="OCR任务不存在" /></Card>;

  return (
    <div>
      <PageHeader
        title="OCR人工确认"
        description="原始证据、人工修订和校验版本均保留"
        extra={<Button onClick={() => navigate('/data/ocr-tasks')}>返回任务</Button>}
      />
      {error ? <Alert type="error" showIcon message="OCR任务请求失败" description={error} /> : null}
      <Spin spinning={loading && !task}>
        {!task && !loading ? <Card><Empty description="OCR任务不存在" /></Card> : null}
        {task ? (
          <>
            <Card>
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
                <Descriptions.Item label="文件名">{task.rawFile.fileName}</Descriptions.Item>
                <Descriptions.Item label="项目">{task.projectName}</Descriptions.Item>
                <Descriptions.Item label="模板">{task.templateName}</Descriptions.Item>
                <Descriptions.Item label="状态"><Tag>{ocrStatusMap[task.status]}</Tag></Descriptions.Item>
                <Descriptions.Item label="Provider">{task.provider}</Descriptions.Item>
                <Descriptions.Item label="模型">{task.modelName}{task.modelVersion ? ` / ${task.modelVersion}` : ''}</Descriptions.Item>
                <Descriptions.Item label="页数">{task.pageCount}</Descriptions.Item>
                <Descriptions.Item label="平均置信度">{task.avgConfidence === undefined ? '-' : `${confidencePercent(task.avgConfidence)}（仅供参考）`}</Descriptions.Item>
                <Descriptions.Item label="任务版本">V{task.version}</Descriptions.Item>
                <Descriptions.Item label="审核修订">R{task.reviewRevision}</Descriptions.Item>
                <Descriptions.Item label="文件哈希" span={2}>{task.rawFile.sha256.slice(0, 16)}…</Descriptions.Item>
              </Descriptions>
            </Card>

            {task.status === 'failed' ? (
              <Alert
                className="section-row"
                type="error"
                showIcon
                message="OCR识别失败"
                description={task.errorMessage}
                action={<Button loading={loading} onClick={() => void retryTask(task.id).then(() => message.success('重试成功')).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '重试失败'))}>重试</Button>}
              />
            ) : null}
            {['queued', 'processing'].includes(task.status) ? (
              <Alert
                className="section-row"
                type="info"
                showIcon
                message={task.status === 'queued' ? 'OCR 任务正在排队' : 'OCR 模型正在识别'}
                description="页面会自动刷新状态，可以安全离开后再返回。"
              />
            ) : null}
            {unresolved.length ? <Alert className="section-row" type="warning" showIcon message={`${unresolved.length} 个字段需要人工核对`} description="低置信度、缺失、证据冲突或格式异常字段不能直接入账。" /> : null}
            {task.status === 'pending_confirm' && !currentValidation ? (
              <Alert
                className="section-row"
                type="warning"
                showIcon
                message={task.validation ? '审核内容已变化，旧校验结果失效' : '当前审核版本尚未执行确定性校验'}
              />
            ) : null}
            {currentValidation ? (
              <Alert
                className="section-row"
                type={currentValidation.snapshot.valid ? 'success' : 'error'}
                showIcon
                message={currentValidation.snapshot.valid ? `R${currentValidation.reviewRevision} 校验通过` : `R${currentValidation.reviewRevision} 存在 ${currentValidation.snapshot.blockingErrors.length} 个阻断问题`}
                description={currentValidation.snapshot.blockingErrors.length
                  ? currentValidation.snapshot.blockingErrors.map((item) => item.message).join('；')
                  : validationWarnings.length ? `${validationWarnings.length} 个非阻断警告仍需人工确认` : `规则 ${currentValidation.ruleVersion}`}
              />
            ) : null}

            <Row gutter={[16, 16]} className="section-row">
              <Col xs={12} md={6}><Card><Statistic title="字段数" value={task.fields.length} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="待核对" value={unresolved.length} valueStyle={{ color: unresolved.length ? '#d97706' : '#16a34a' }} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="人工修订" value={task.reviewRevision} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="识别尝试" value={task.attemptCount} /></Card></Col>
            </Row>

            <Tabs
              className="section-row"
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'fields',
                  label: '结构化字段',
                  children: <Card><Table rowKey="fieldId" columns={fieldColumns} dataSource={task.fields} pagination={false} scroll={{ x: 1240 }} /></Card>,
                },
                {
                  key: 'evidence',
                  label: '证据定位',
                  children: (
                    <Card>
                      <OcrEvidencePreview
                        rawFileId={task.rawFileId}
                        fileName={task.rawFile.fileName}
                        mimeType={task.rawFile.mimeType}
                        pages={task.pages}
                        textBlocks={task.textBlocks}
                        field={evidenceField}
                      />
                    </Card>
                  ),
                },
                {
                  key: 'ai',
                  label: 'AI建议',
                  children: (
                    <Card
                      title="分类与字段映射建议"
                      extra={task.status === 'pending_confirm' ? (
                        <Button icon={<BulbOutlined />} loading={aiLoading} onClick={() => void requestSuggestions().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : 'AI建议生成失败'))}>
                          生成建议
                        </Button>
                      ) : null}
                    >
                      {!aiSuggestion ? <Empty description="尚未生成 AI 建议" /> : aiSuggestion.mode === 'manual' ? (
                        <Alert type="warning" showIcon message="已转人工复核" description={`${aiSuggestion.reasonCode ?? 'AI_UNAVAILABLE'}：${aiSuggestion.message ?? 'AI建议不可用'}`} />
                      ) : (
                        <Space direction="vertical" size="middle" className="full-width">
                          <Alert type="info" showIcon message="AI 结果仅为建议，不会自动应用、批准或入账" />
                          <Space wrap>
                            {aiSuggestion.mock ? <Tag color="warning">Mock（仅测试）</Tag> : null}
                            <Tag>{aiSuggestion.classification?.provider ?? '-'}</Tag>
                            <Tag>{aiSuggestion.classification?.model ?? '-'}</Tag>
                            <Tag>Prompt {aiSuggestion.classification?.promptVersion ?? '-'}</Tag>
                            <Tag>{aiSuggestion.classification?.output?.decision ?? '-'}</Tag>
                            <Tag color="gold">分类置信度 {confidencePercent(aiSuggestion.classification?.output?.confidence)} · 仅供参考</Tag>
                          </Space>
                          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                            <Descriptions.Item label="候选模板版本">
                              {aiSuggestion.classification?.output?.selectedTemplateVersionId ?? '未选择'}
                            </Descriptions.Item>
                            <Descriptions.Item label="分类理由">
                              {aiSuggestion.classification?.output?.reasonCodes.join('、') || '-'}
                            </Descriptions.Item>
                          </Descriptions>
                          {(aiSuggestion.classification?.output?.warnings ?? []).map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}
                          <Table
                            rowKey={(item) => `${item.sourceRef}:${item.targetFieldKey}`}
                            columns={aiMappingColumns}
                            dataSource={aiSuggestion.mapping?.output?.mappings ?? []}
                            pagination={false}
                            scroll={{ x: 760 }}
                          />
                          {(aiSuggestion.mapping?.output?.unresolvedRequiredFields.length ?? 0) > 0 ? (
                            <Alert type="error" showIcon message={`未解决必填字段：${aiSuggestion.mapping?.output?.unresolvedRequiredFields.join('、')}`} />
                          ) : null}
                          {(aiSuggestion.mapping?.output?.unmappedSourceRefs.length ?? 0) > 0 ? (
                            <Alert type="warning" showIcon message={`未映射来源：${aiSuggestion.mapping?.output?.unmappedSourceRefs.join('、')}`} />
                          ) : null}
                          {(aiSuggestion.conflicts?.length ?? 0) > 0 ? (
                            <Alert type="error" showIcon message={`证据冲突：${aiSuggestion.conflicts?.map((item) => item.sourceRef).join('、')}`} />
                          ) : null}
                          {(aiSuggestion.mapping?.output?.warnings ?? []).map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}
                        </Space>
                      )}
                    </Card>
                  ),
                },
                {
                  key: 'text',
                  label: '原始识别文本',
                  children: <Card><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{task.extractedText || '暂无识别文本'}</Typography.Paragraph></Card>,
                },
                {
                  key: 'file',
                  label: '原始文件',
                  children: <Card><AttachmentPreview attachments={[task.rawFileId]} /></Card>,
                },
                {
                  key: 'attempts',
                  label: '识别尝试',
                  children: <Card><Table rowKey="id" columns={attemptColumns} dataSource={task.attempts} pagination={false} scroll={{ x: 900 }} /></Card>,
                },
                {
                  key: 'corrections',
                  label: '修订记录',
                  children: <Card><Table rowKey="id" columns={correctionColumns} dataSource={task.corrections} pagination={false} scroll={{ x: 1100 }} /></Card>,
                },
              ]}
            />

            <Card className="section-row">
              <Space direction="vertical" size="middle">
                {needsAcknowledgement && currentValidation?.snapshot.valid ? (
                  <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>
                    我已核对当前 R{task.reviewRevision} 的全部异常字段和非阻断警告
                  </Checkbox>
                ) : null}
                <Space wrap>
                  {(task.status === 'uploaded' || task.status === 'queued') ? (
                    <Button loading={loading} onClick={() => void runTask(task.id).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '识别失败'))}>开始识别</Button>
                  ) : null}
                  {task.status === 'pending_confirm' ? (
                    <>
                      <Button
                        icon={<BulbOutlined />}
                        loading={aiLoading}
                        onClick={() => void requestSuggestions().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : 'AI建议生成失败'))}
                      >
                        生成 AI 建议
                      </Button>
                      <Button
                        icon={<ReloadOutlined />}
                        loading={loading}
                        onClick={() => void revalidate().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '重新校验失败'))}
                      >
                        重新校验
                      </Button>
                      <Tooltip title={canConfirm ? undefined : '当前修订版本必须先通过确定性校验，并处理所有阻断问题'}>
                        <span>
                          <Button
                            type="primary"
                            icon={<SafetyCertificateOutlined />}
                            loading={loading}
                            disabled={!canConfirm}
                            onClick={() => void confirm().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '确认失败'))}
                          >
                            确认并生成经营记录
                          </Button>
                        </span>
                      </Tooltip>
                    </>
                  ) : null}
                  {task.status === 'confirmed' ? <Button onClick={() => navigate('/data/records')}>查看经营记录</Button> : null}
                </Space>
              </Space>
            </Card>
          </>
        ) : null}
      </Spin>

      <Modal
        title={candidate ? `修正字段：${candidate.fieldName}` : '修正字段'}
        open={Boolean(candidate)}
        okText="保存修正"
        confirmLoading={loading}
        onOk={() => void submitCorrection().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '修正失败'))}
        onCancel={() => { setCandidate(undefined); form.resetFields(); }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="修正值" name="correctedValue" rules={[{ required: true, whitespace: true, message: '请输入修正值' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label="证据引用"
            name="evidenceRefs"
            rules={[
              { type: 'array', min: 1, message: '至少选择一个原始证据引用' },
              { type: 'array', max: 32, message: '一次最多选择 32 个证据引用' },
            ]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              options={availableEvidenceRefs.map((ref) => ({ label: ref, value: ref }))}
              placeholder="选择同页 OCR block/token"
            />
          </Form.Item>
          {candidate?.alternatives.length ? (
            <div className="ocr-alternative-list">
              <Typography.Text strong>冲突候选</Typography.Text>
              {candidate.alternatives.map((alternative, index) => (
                <div className="ocr-alternative-row" key={`${alternative.page}:${alternative.evidenceRefs.join(':')}:${index}`}>
                  <div>
                    <Typography.Text>{displayValue(alternative.normalizedValue)}</Typography.Text>
                    <Typography.Text type="secondary"> · 第 {alternative.page} 页 · {confidencePercent(alternative.confidence)}（仅供参考）</Typography.Text>
                  </div>
                  <Button
                    size="small"
                    onClick={() => form.setFieldsValue({
                      correctedValue: displayValue(alternative.normalizedValue) === '-' ? '' : displayValue(alternative.normalizedValue),
                      evidenceRefs: [...alternative.evidenceRefs],
                    })}
                  >
                    采用该证据
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <Form.Item label="修正原因" name="reason" rules={[{ required: true, whitespace: true, message: '请输入可审计的修正原因' }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function collectPageEvidenceRefs(textBlocks: Array<Record<string, unknown>>, page: number) {
  const refs: string[] = [];
  for (const block of textBlocks) {
    if (block.page !== page) continue;
    if (typeof block.blockId === 'string') refs.push(block.blockId);
    if (!Array.isArray(block.tokens)) continue;
    for (const rawToken of block.tokens) {
      if (!rawToken || typeof rawToken !== 'object' || Array.isArray(rawToken)) continue;
      const tokenId = (rawToken as Record<string, unknown>).tokenId;
      if (typeof tokenId === 'string') refs.push(tokenId);
    }
  }
  return refs;
}
