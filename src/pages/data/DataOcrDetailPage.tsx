import { useEffect, useMemo, useState } from 'react';
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
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import AttachmentPreview from '@/components/workOrder/AttachmentPreview';
import { useOCRStore } from '@/store/ocrStore';
import type { OCRAttempt, OCRCorrection, OCRFieldCandidate } from '@/types/dataCenter';
import { fieldTypeMap, ocrStatusMap } from '@/utils/dataCenterMaps';

interface CorrectionForm {
  correctedValue: string;
  reason?: string;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function DataOcrDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [candidate, setCandidate] = useState<OCRFieldCandidate>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [form] = Form.useForm<CorrectionForm>();
  const task = useOCRStore((state) => state.currentTask?.id === id ? state.currentTask : undefined);
  const loading = useOCRStore((state) => state.loading);
  const error = useOCRStore((state) => state.error);
  const fetchTask = useOCRStore((state) => state.fetchTask);
  const runTask = useOCRStore((state) => state.runTask);
  const retryTask = useOCRStore((state) => state.retryTask);
  const correctTask = useOCRStore((state) => state.correctTask);
  const confirmTask = useOCRStore((state) => state.confirmTask);

  useEffect(() => {
    if (id) void fetchTask(id).catch(() => undefined);
  }, [fetchTask, id]);

  useEffect(() => {
    if (!id || !task || !['queued', 'processing'].includes(task.status)) return undefined;
    const timer = window.setInterval(() => void fetchTask(id).catch(() => undefined), 1500);
    return () => window.clearInterval(timer);
  }, [fetchTask, id, task?.status]);

  const unresolved = useMemo(
    () => task?.fields.filter((field) => field.lowConfidence || field.missing || field.validationError) ?? [],
    [task?.fields],
  );

  const openCorrection = (field: OCRFieldCandidate) => {
    setCandidate(field);
    form.setFieldsValue({ correctedValue: displayValue(field.normalizedValue) === '-' ? '' : displayValue(field.normalizedValue), reason: '' });
  };

  const submitCorrection = async () => {
    if (!id || !candidate) return;
    const values = await form.validateFields();
    const correctedValue = ['number', 'money'].includes(candidate.fieldType)
      ? values.correctedValue.trim()
      : values.correctedValue;
    await correctTask(id, { corrections: [{ fieldId: candidate.fieldId, correctedValue, reason: values.reason }] });
    message.success('字段修正已保存并留痕');
    setCandidate(undefined);
    form.resetFields();
  };

  const confirm = async () => {
    if (!id) return;
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
      width: 120,
      render: (_, field) => <Tag color={field.lowConfidence ? 'warning' : 'success'}>{Math.round(field.confidence * 100)}%</Tag>,
    },
    {
      title: '核对状态',
      width: 180,
      render: (_, field) => (
        <Space wrap>
          {field.missing ? <Tag color="error">未识别</Tag> : null}
          {field.lowConfidence && !field.missing ? <Tag color="warning">需人工核对</Tag> : null}
          {field.corrected ? <Tag color="processing">已人工修正</Tag> : null}
          {!field.lowConfidence && !field.corrected ? <Tag color="success">正常</Tag> : null}
        </Space>
      ),
    },
    {
      title: '证据/错误',
      render: (_, field) => (
        <Space direction="vertical" size={2}>
          <span>{field.evidence || '-'}</span>
          {field.validationError ? <Typography.Text type="danger">{field.validationError}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 100,
      render: (_, field) => task?.status === 'pending_confirm' && field.fieldType !== 'file'
        ? <Button type="link" onClick={() => openCorrection(field)}>修正</Button>
        : null,
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
    { title: '字段', dataIndex: 'fieldName' },
    { title: '修正前', dataIndex: 'beforeValue', render: (value?: string) => value || '-' },
    { title: '修正后', dataIndex: 'afterValue' },
    { title: '原因', dataIndex: 'reason', render: (value?: string) => value || '-' },
    { title: '修正人', dataIndex: 'correctedBy' },
    { title: '时间', dataIndex: 'correctedAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
  ];

  if (!id) return <Card><Empty description="OCR任务不存在" /></Card>;

  return (
    <div>
      <PageHeader title="OCR人工确认" description="原始文件和识别结果均保留" extra={<Button onClick={() => navigate('/data/ocr-tasks')}>返回任务</Button>} />
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
                <Descriptions.Item label="平均置信度">{task.avgConfidence === undefined ? '-' : `${Math.round(task.avgConfidence * 100)}%`}</Descriptions.Item>
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
            {unresolved.length ? <Alert className="section-row" type="warning" showIcon message={`${unresolved.length} 个字段需要人工核对`} description="低置信度、缺失或格式异常字段不会自动入账。" /> : null}

            <Row gutter={[16, 16]} className="section-row">
              <Col xs={12} md={6}><Card><Statistic title="字段数" value={task.fields.length} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="待核对" value={unresolved.length} valueStyle={{ color: unresolved.length ? '#d97706' : '#16a34a' }} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="人工修正" value={task.corrections.length} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="识别尝试" value={task.attemptCount} /></Card></Col>
            </Row>

            <Tabs
              className="section-row"
              items={[
                {
                  key: 'fields',
                  label: '结构化字段',
                  children: <Card><Table rowKey="fieldId" columns={fieldColumns} dataSource={task.fields} pagination={false} scroll={{ x: 1100 }} /></Card>,
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
                  label: '纠错记录',
                  children: <Card><Table rowKey="id" columns={correctionColumns} dataSource={task.corrections} pagination={false} scroll={{ x: 900 }} /></Card>,
                },
              ]}
            />

            <Card className="section-row">
              <Space direction="vertical" size="middle">
                {unresolved.length ? (
                  <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>
                    我已人工核对所有低置信度、缺失或格式异常字段
                  </Checkbox>
                ) : null}
                <Space wrap>
                  {(task.status === 'uploaded' || task.status === 'queued') ? (
                    <Button loading={loading} onClick={() => void runTask(task.id).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '识别失败'))}>开始识别</Button>
                  ) : null}
                  {task.status === 'pending_confirm' ? (
                    <Button type="primary" loading={loading} disabled={unresolved.length > 0 && !acknowledged} onClick={() => void confirm().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '确认失败'))}>
                      确认并生成经营记录
                    </Button>
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
          <Form.Item label="修正值" name="correctedValue" rules={[{ required: true, message: '请输入修正值' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="修正原因" name="reason">
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
