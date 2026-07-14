import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InboxOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Row,
  Col,
  Statistic,
  Space,
  Typography,
  Modal,
  Input,
  InputNumber,
  Form,
  Upload,
} from 'antd';
import type { RcFile, UploadFile } from 'antd/es/upload/interface';
import dayjs from 'dayjs';
import { uploadFile } from '@/api/fileApi';
import PageHeader from '@/components/PageHeader';
import AttachmentPreview from '@/components/workOrder/AttachmentPreview';
import AISummaryCard from '@/components/workOrder/AISummaryCard';
import AuditActionBar, { type AuditActionPayload } from '@/components/workOrder/AuditActionBar';
import AuditTimeline from '@/components/workOrder/AuditTimeline';
import RiskTag from '@/components/workOrder/RiskTag';
import StatusTag from '@/components/workOrder/StatusTag';
import WorkOrderStatusSteps from '@/components/workOrder/WorkOrderStatusSteps';
import ChatBox from '@/components/ai/ChatBox';
import { useAuthStore } from '@/store/authStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import { formatMoney } from '@/utils/format';
import { workOrderTypeMap } from '@/utils/statusMap';

export default function WorkOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [aiOpen, setAiOpen] = useState(false);
  const [urgeOpen, setUrgeOpen] = useState(false);
  const [urgeReason, setUrgeReason] = useState('');
  const [supplementOpen, setSupplementOpen] = useState(false);
  const [supplementComment, setSupplementComment] = useState('');
  const [supplementDescription, setSupplementDescription] = useState('');
  const [supplementFiles, setSupplementFiles] = useState<UploadFile[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const user = useAuthStore((state) => state.user);
  const workOrder = useWorkOrderStore((state) => state.workOrders.find((item) => item.id === id));
  const fetchWorkOrder = useWorkOrderStore((state) => state.fetchWorkOrder);
  const financeReview = useWorkOrderStore((state) => state.financeReview);
  const reviewerReview = useWorkOrderStore((state) => state.reviewerReview);
  const runAiReview = useWorkOrderStore((state) => state.runAiReview);
  const bossApprove = useWorkOrderStore((state) => state.bossApprove);
  const supplementWorkOrder = useWorkOrderStore((state) => state.supplementWorkOrder);
  const updateWorkOrder = useWorkOrderStore((state) => state.updateWorkOrder);
  const submitWorkOrder = useWorkOrderStore((state) => state.submitWorkOrder);
  const urgeWorkOrder = useWorkOrderStore((state) => state.urgeWorkOrder);
  const loading = useWorkOrderStore((state) => state.loading);
  const error = useWorkOrderStore((state) => state.error);

  useEffect(() => {
    if (id) void fetchWorkOrder(id).catch(() => undefined);
  }, [fetchWorkOrder, id]);

  if (!user) return null;

  if (!workOrder) {
    return (
      <Card loading={loading}>
        <Empty description="工单不存在" />
      </Card>
    );
  }

  const handleAction = async (payload: AuditActionPayload) => {
    if (user.role === 'employee' && payload.action === 'supplement') {
      setSupplementComment(payload.comment);
      setSupplementDescription(workOrder.description);
      setSupplementOpen(true);
      return;
    }
    if (user.role === 'finance') {
      await financeReview(workOrder.id, { action: payload.action, comment: payload.comment || undefined });
    } else if (user.role === 'reviewer') {
      await reviewerReview(workOrder.id, { action: payload.action, comment: payload.comment || undefined });
    } else if (user.role === 'boss') {
      await bossApprove(workOrder.id, { action: payload.action, comment: payload.comment || undefined });
    }
    if (user.role === 'boss' && payload.action === 'approve') {
      message.success('审批完成，已生成项目数据记录，可在数据中心查看。');
      return;
    }
    message.success('操作成功');
  };

  const simulateAI = async () => {
    await runAiReview(workOrder.id);
    message.success('AI复核已完成');
  };

  const submitUrgent = async () => {
    const reason = urgeReason.trim();
    if (!reason) {
      message.warning('请输入申请加急原因');
      return;
    }
    await urgeWorkOrder(workOrder.id, reason);
    message.success('催办已发送');
    setUrgeOpen(false);
    setUrgeReason('');
  };

  const submitSupplement = async () => {
    const files = supplementFiles
      .map((item) => item.originFileObj)
      .filter((item): item is RcFile => Boolean(item));
    const uploaded = await Promise.all(files.map((file) => uploadFile(file, workOrder.projectId, workOrder.id)));
    await supplementWorkOrder(workOrder.id, {
      comment: supplementComment.trim(),
      description: supplementDescription.trim() || undefined,
      attachments: uploaded.map((item) => item.id),
    });
    setSupplementOpen(false);
    setSupplementFiles([]);
    message.success('补充材料已提交，工单已返回财务复审');
  };

  const saveDraftChanges = async () => {
    const values = await editForm.validateFields();
    await updateWorkOrder(workOrder.id, {
      amount: values.amount,
      occurredDate: values.occurredDate?.format('YYYY-MM-DD'),
      description: values.description,
    });
    setEditOpen(false);
    message.success('草稿已更新');
  };

  return (
    <div>
      <PageHeader
        title="工单详情"
        description={`${workOrder.orderNo} · ${workOrder.projectName}`}
        extra={<Button onClick={() => navigate(-1)}>返回</Button>}
      />
      {error ? <Alert type="error" showIcon message="工单加载或操作失败" description={error} /> : null}

      <Card className="section-row">
        <WorkOrderStatusSteps status={workOrder.status} />
      </Card>

      <Row gutter={[16, 16]} className="section-row">
        <Col xs={24} xl={user.role === 'employee' ? 24 : 16}>
          <Card title="工单信息">
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="工单编号">{workOrder.orderNo}</Descriptions.Item>
              <Descriptions.Item label="类型">{workOrderTypeMap[workOrder.type]}</Descriptions.Item>
              <Descriptions.Item label="项目">{workOrder.projectName}</Descriptions.Item>
              <Descriptions.Item label="客户">{workOrder.customerName}</Descriptions.Item>
              <Descriptions.Item label="提交人">{workOrder.creatorName}</Descriptions.Item>
              <Descriptions.Item label="申请金额">{formatMoney(workOrder.amount)}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{workOrder.createdAt}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <StatusTag status={workOrder.status} urgent={workOrder.urgent} />
              </Descriptions.Item>
              <Descriptions.Item label="风险">
                <RiskTag risk={workOrder.riskLevel} />
              </Descriptions.Item>
              <Descriptions.Item label="说明" span={2}>
                {workOrder.description}
              </Descriptions.Item>
              {user.role !== 'employee' ? (
                <>
                  <Descriptions.Item label="财务意见" span={2}>
                    {workOrder.financeOpinion || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="复核意见" span={2}>
                    {workOrder.reviewerOpinion || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="老板意见" span={2}>
                    {workOrder.bossOpinion || '-'}
                  </Descriptions.Item>
                </>
              ) : null}
              {workOrder.urgent ? (
                <Descriptions.Item label="加急原因" span={2}>
                  {workOrder.urgentReason}（{workOrder.urgentTime}）
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </Card>
        </Col>
        {user.role !== 'employee' ? (
          <Col xs={24} xl={8}>
            <Card title="收入/成本/利润">
              <Row gutter={[12, 12]}>
                <Col span={24}>
                  <Statistic title="收入" value={workOrder.income} formatter={(value) => formatMoney(Number(value))} />
                </Col>
                <Col span={12}>
                  <Statistic title="成本" value={workOrder.cost} formatter={(value) => formatMoney(Number(value))} />
                </Col>
                <Col span={12}>
                  <Statistic title="利润" value={workOrder.profit} formatter={(value) => formatMoney(Number(value))} />
                </Col>
              </Row>
            </Card>
          </Col>
        ) : null}
      </Row>

      <Row gutter={[16, 16]} className="section-row">
        <Col xs={24} xl={12}>
          <Card title="附件预览">
            <AttachmentPreview
              attachments={workOrder.attachments}
              canDelete={user.role === 'employee' && ['draft', 'returned_for_supplement'].includes(workOrder.status)}
              onDeleted={async () => { await fetchWorkOrder(workOrder.id); }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <AISummaryCard summary={workOrder.aiSummary} riskLevel={workOrder.riskLevel} />
        </Col>
      </Row>

      <Card title="审核时间线" className="section-row">
        <AuditTimeline timeline={workOrder.timeline} />
      </Card>

      <Card title="操作" className="section-row">
        <Space direction="vertical" size={12} className="full-width">
          {user.role === 'employee' ? (
            <Typography.Text type="secondary">员工只能查看进度、补充材料，不能执行审核操作。</Typography.Text>
          ) : null}
          {user.role === 'employee' && workOrder.status === 'draft' ? (
            <Space wrap>
              <Button
                onClick={() => {
                  editForm.setFieldsValue({
                    amount: workOrder.amount || undefined,
                    occurredDate: workOrder.occurredDate ? dayjs(workOrder.occurredDate) : undefined,
                    description: workOrder.description || undefined,
                  });
                  setEditOpen(true);
                }}
              >
                编辑草稿
              </Button>
              <Button
                type="primary"
                loading={loading}
                onClick={() => void submitWorkOrder(workOrder.id)
                  .then(() => message.success('工单已提交，等待财务审核'))
                  .catch((error) => message.error(error instanceof Error ? error.message : '提交失败'))}
              >
                提交审核
              </Button>
            </Space>
          ) : null}
          {user.role === 'employee' && ['finance_reviewing', 'reviewer_reviewing', 'reviewer_rejected', 'ai_reviewing', 'boss_pending'].includes(workOrder.status) ? (
            <Button danger onClick={() => setUrgeOpen(true)}>
              催办
            </Button>
          ) : null}
          <AuditActionBar
            role={user.role}
            workOrder={workOrder}
            onAction={handleAction}
            onAskAI={user.role === 'boss' ? () => setAiOpen(true) : undefined}
            onSimulateAI={simulateAI}
          />
        </Space>
      </Card>

      <Drawer title="询问AI" width={420} open={aiOpen} onClose={() => setAiOpen(false)}>
        <ChatBox compact contextId={workOrder.id} />
      </Drawer>

      <Modal
        title="编辑工单草稿"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => void saveDraftChanges().catch((error) => message.error(error instanceof Error ? error.message : '草稿更新失败'))}
        confirmLoading={loading}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="申请金额" name="amount">
            <InputNumber min={0.01} precision={2} className="full-width" />
          </Form.Item>
          <Form.Item label="发生日期" name="occurredDate">
            <DatePicker className="full-width" />
          </Form.Item>
          <Form.Item label="事由说明" name="description">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="申请加急处理"
        open={urgeOpen}
        onCancel={() => setUrgeOpen(false)}
        onOk={() => void submitUrgent().catch((error) => message.error(error instanceof Error ? error.message : '催办失败'))}
        confirmLoading={loading}
        okText="提交催办"
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary">
          当前工单将通知对应审核角色，请填写明确原因。
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          value={urgeReason}
          onChange={(event) => setUrgeReason(event.target.value)}
          placeholder="例如：客户急需付款，请优先处理。"
        />
      </Modal>

      <Modal
        title="补充材料并重新提交"
        open={supplementOpen}
        onCancel={() => setSupplementOpen(false)}
        onOk={() => void submitSupplement().catch((error) => message.error(error instanceof Error ? error.message : '补充材料失败'))}
        confirmLoading={loading}
        okButtonProps={{ disabled: !supplementComment.trim() }}
        okText="重新提交"
        cancelText="取消"
      >
        <Input.TextArea
          rows={3}
          value={supplementComment}
          onChange={(event) => setSupplementComment(event.target.value)}
          placeholder="说明本次补充内容"
        />
        <Input.TextArea
          className="section-row"
          rows={3}
          value={supplementDescription}
          onChange={(event) => setSupplementDescription(event.target.value)}
          placeholder="更新完整事由说明"
        />
        <Upload.Dragger
          className="section-row"
          beforeUpload={() => false}
          multiple
          maxCount={Math.max(0, 20 - workOrder.attachments.length)}
          fileList={supplementFiles}
          onChange={({ fileList }) => setSupplementFiles(fileList)}
          accept="image/*,.pdf,.xls,.xlsx,.csv,.doc,.docx"
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">新增补充附件</p>
        </Upload.Dragger>
      </Modal>
    </div>
  );
}
